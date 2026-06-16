import { expirePendingInvoices } from "../invoices/service.js";
import type { PoolClient } from "pg";
import { pool, transaction } from "../database/pool.js";
import { env } from "../env.js";
import { parseUsdcUnits } from "../money.js";
import { expirePendingInvoices, recordTransition } from "../invoices/service.js";

const EXPIRE_INTERVAL_MS = 60_000;

async function runExpiry() {
  try {
    const expired = await expirePendingInvoices();
    if (expired > 0) {
      console.log(`expired ${expired} pending invoice(s)`);
    }
  } catch (error) {
    console.error("invoice expiry failed:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runExpiry();

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
