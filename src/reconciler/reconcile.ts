import type { PoolClient } from "pg";
import { pool, transaction } from "../database/pool.js";
import { env } from "../env.js";
import { parseUsdcUnits } from "../money.js";
import { expirePendingInvoices, recordTransition } from "../invoices/service.js";

type HorizonPayment = {
  id: string;
  paging_token: string;
  transaction_hash: string;
  type: string;
  from?: string;
  to_muxed_id?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  transaction_successful?: boolean;
  _links?: { transaction?: { href?: string } };
};

type HorizonPage = {
  _embedded?: { records?: HorizonPayment[] };
};

type InvoiceMatch = {
  id: string;
  merchant_id: string;
  state: "pending" | "paid" | "expired" | "settled" | "failed";
  gross_amount_units: string;
  platform_fee_amount_units: string;
  merchant_net_amount_units: string;
  asset_code: string;
  asset_issuer: string;
  expires_at: Date;
};

export async function reconcileOnce() {
  const cursor = await loadCursor();
  const records = await fetchPaymentRecords(cursor);

  for (const record of records) {
    await processPayment(record);
    await saveCursor(record.paging_token);
  }

  return records.length;
}

async function loadCursor() {
  const result = await pool.query<{ last_paging_token: string | null }>(
    "SELECT last_paging_token FROM stellar_reconciliation_cursors WHERE id = 'treasury_payments'"
  );
  return result.rows[0]?.last_paging_token ?? env.RECONCILIATION_START_CURSOR ?? "now";
}

async function saveCursor(cursor: string) {
  await pool.query(
    `INSERT INTO stellar_reconciliation_cursors (id, last_paging_token, updated_at)
     VALUES ('treasury_payments', $1, now())
     ON CONFLICT (id)
     DO UPDATE SET last_paging_token = EXCLUDED.last_paging_token, updated_at = now()`,
    [cursor]
  );
}

async function fetchPaymentRecords(cursor: string) {
  const url = new URL(`/accounts/${env.PLATFORM_TREASURY_PUBLIC_KEY}/payments`, env.STELLAR_HORIZON_URL);
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", "200");
  url.searchParams.set("cursor", cursor);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`horizon_fetch_failed:${response.status}`);
  }

  const page = (await response.json()) as HorizonPage;
  return page._embedded?.records ?? [];
}

async function processPayment(record: HorizonPayment) {
  if (!isRelevantPayment(record)) {
    return;
  }

  await transaction(async (client) => {
    const rawEventId = await upsertRawEvent(client, record);
    const invoice = await findInvoice(client, record);

    if (!invoice) {
      await recordException(client, rawEventId, null, "unmatched_payment", { operationId: record.id });
      return;
    }

    const idempotencyKey = `stellar:${record.transaction_hash}:${record.id}`;
    const amountUnits = parseUsdcUnits(record.amount ?? "0");
    const expectedUnits = BigInt(invoice.gross_amount_units);

    if (invoice.state !== "pending") {
      await recordException(client, rawEventId, invoice.id, "invoice_not_pending", { state: invoice.state });
      return;
    }

    if (invoice.expires_at.getTime() <= Date.now()) {
      await recordException(client, rawEventId, invoice.id, "late_payment", { expiresAt: invoice.expires_at.toISOString() });
      return;
    }

    if (amountUnits !== expectedUnits) {
      await recordException(client, rawEventId, invoice.id, "amount_mismatch", {
        expected: expectedUnits.toString(),
        received: amountUnits.toString()
      });
      return;
    }

    const inserted = await client.query(
      `INSERT INTO payments (
        invoice_id, raw_event_id, transaction_hash, operation_id, payer_account, amount_units,
        asset_code, asset_issuer, confirmed_ledger, confirmed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [
        invoice.id,
        rawEventId,
        record.transaction_hash,
        record.id,
        record.from ?? null,
        amountUnits.toString(),
        record.asset_code,
        record.asset_issuer,
        ledgerFromOperationId(record.id).toString()
      ]
    );

    if (!inserted.rowCount) {
      return;
    }

    await client.query(
      `UPDATE invoices
       SET state = 'paid', paid_at = now(), updated_at = now(), version = version + 1
       WHERE id = $1 AND state = 'pending'`,
      [invoice.id]
    );
    await recordTransition(client, invoice.id, "pending", "paid", "stellar_payment_confirmed", idempotencyKey, {
      transactionHash: record.transaction_hash,
      operationId: record.id
    });
    await insertLedgerEntries(client, invoice, idempotencyKey);
  });
}

function isRelevantPayment(record: HorizonPayment) {
  return (
    record.transaction_successful !== false &&
    ["payment", "path_payment_strict_receive", "path_payment_strict_send"].includes(record.type) &&
    record.asset_code === env.STELLAR_ASSET_CODE &&
    record.asset_issuer === env.STELLAR_ASSET_ISSUER
  );
}

async function upsertRawEvent(client: PoolClient, record: HorizonPayment) {
  await client.query(
    `INSERT INTO stellar_raw_events (source, ledger_sequence, transaction_hash, operation_id, paging_token, payload)
     VALUES ('horizon_account_payments', $1, $2, $3, $4, $5::jsonb)
     ON CONFLICT DO NOTHING`,
    [ledgerFromOperationId(record.id).toString(), record.transaction_hash, record.id, record.paging_token, JSON.stringify(record)]
  );

  const result = await client.query<{ id: string }>(
    `SELECT id FROM stellar_raw_events
     WHERE source = 'horizon_account_payments'
       AND transaction_hash = $1
       AND COALESCE(operation_id, '') = COALESCE($2, '')`,
    [record.transaction_hash, record.id]
  );
  return result.rows[0].id;
}

async function findInvoice(client: PoolClient, record: HorizonPayment) {
  if (record.to_muxed_id) {
    const result = await client.query<InvoiceMatch>("SELECT * FROM invoices WHERE stellar_muxed_id = $1 FOR UPDATE", [
      record.to_muxed_id
    ]);
    if (result.rows[0]) {
      return result.rows[0];
    }
  }

  const memo = await fetchMemo(record);
  if (!memo) {
    return null;
  }

  const result = await client.query<InvoiceMatch>("SELECT * FROM invoices WHERE stellar_memo = $1 FOR UPDATE", [memo]);
  return result.rows[0] ?? null;
}

const MEMO_FETCH_TIMEOUT_MS = 5000;

async function fetchMemo(record: HorizonPayment) {
  const href = record._links?.transaction?.href;
  if (!href) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEMO_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(href, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`fetchMemo timed out after ${MEMO_FETCH_TIMEOUT_MS}ms for ${href}`);
    } else {
      console.error(`fetchMemo failed for ${href}:`, error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return null;
  }
  const tx = (await response.json()) as { memo_type?: string; memo?: string };
  return tx.memo_type === "id" ? tx.memo ?? null : null;
}

async function recordException(
  client: PoolClient,
  rawEventId: string,
  invoiceId: string | null,
  reason: string,
  metadata: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO payment_exceptions (raw_event_id, invoice_id, reason, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [rawEventId, invoiceId, reason, JSON.stringify(metadata)]
  );
}

async function insertLedgerEntries(client: PoolClient, invoice: InvoiceMatch, idempotencyKey: string) {
  const entries = [
    ["treasury:usdc", "debit", invoice.gross_amount_units],
    [`merchant_liability:${invoice.merchant_id}`, "credit", invoice.merchant_net_amount_units],
    ["platform_fee_revenue:usdc", "credit", invoice.platform_fee_amount_units]
  ] as const;

  for (const [account, direction, amount] of entries) {
    await client.query(
      `INSERT INTO internal_ledger_entries (
        invoice_id, account, direction, amount_units, asset_code, asset_issuer, idempotency_key
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING`,
      [invoice.id, account, direction, amount, invoice.asset_code, invoice.asset_issuer, idempotencyKey]
    );
  }
}

function ledgerFromOperationId(operationId: string) {
  return BigInt(operationId) / 4_294_967_296n;
}

const RECONCILE_INTERVAL_MS = 10_000;
const EXPIRE_INTERVAL_MS = 60_000;

async function runReconcile() {
  try {
    const count = await reconcileOnce();
    if (count > 0) {
      console.log(`processed ${count} records`);
    }
  } catch (error) {
    console.error("reconciliation failed:", error);
  }
}

async function runExpiry() {
  try {
    const expired = await expirePendingInvoices();
    console.log(`expired ${expired} pending invoice(s)`);
  } catch (error) {
    console.error("invoice expiry failed:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runReconcile();
  void runExpiry();
  setInterval(runReconcile, RECONCILE_INTERVAL_MS);
  setInterval(runExpiry, EXPIRE_INTERVAL_MS);
}
