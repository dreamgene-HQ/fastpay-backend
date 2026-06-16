import { pool, transaction } from "../database/pool.js";
import { env } from "../env.js";
import { AppError } from "../http.js";
import { recordTransition } from "../invoices/service.js";
import { parseUsdcUnits } from "../money.js";

type HorizonOperation = {
  id: string;
  type: string;
  from?: string;
  to?: string;
  to_muxed_id?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
};

type InvoiceForConfirm = {
  id: string;
  merchant_id: string;
  state: string;
  gross_amount_units: string;
  platform_fee_amount_units: string;
  merchant_net_amount_units: string;
  asset_code: string;
  asset_issuer: string;
  destination_account: string;
  stellar_muxed_id: string;
  expires_at: Date;
};

export async function confirmPayment(publicId: string, txHash: string) {
  const { rows } = await pool.query<InvoiceForConfirm>(
    `SELECT id, merchant_id, state, gross_amount_units, platform_fee_amount_units,
            merchant_net_amount_units, asset_code, asset_issuer, destination_account,
            stellar_muxed_id, expires_at
     FROM invoices WHERE public_id = $1`,
    [publicId]
  );
  const invoice = rows[0];
  if (!invoice) throw new AppError("invoice_not_found", 404);
  if (invoice.state !== "pending") throw new AppError("invoice_not_pending", 409);
  if (invoice.expires_at.getTime() <= Date.now()) throw new AppError("invoice_expired", 409);

  const tx = await fetchHorizon<{ successful: boolean }>(`/transactions/${txHash}`);
  if (!tx.successful) throw new AppError("transaction_failed", 422);

  const ops = await fetchHorizon<{ _embedded?: { records?: HorizonOperation[] } }>(
    `/transactions/${txHash}/operations`
  );
  const op = (ops._embedded?.records ?? []).find((o) => isMatchingPayment(o, invoice));
  if (!op) throw new AppError("payment_not_found_in_transaction", 422);

  const idempotencyKey = `stellar:${txHash}:${op.id}`;

  await transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO payments (
        invoice_id, transaction_hash, operation_id, payer_account, amount_units,
        asset_code, asset_issuer, confirmed_ledger, confirmed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT DO NOTHING
      RETURNING id`,
      [
        invoice.id,
        txHash,
        op.id,
        op.from ?? null,
        parseUsdcUnits(op.amount ?? "0").toString(),
        invoice.asset_code,
        invoice.asset_issuer,
        ledgerFromOperationId(op.id).toString()
      ]
    );

    if (!inserted.rowCount) return;

    await client.query(
      `UPDATE invoices
       SET state = 'paid', paid_at = now(), updated_at = now(), version = version + 1
       WHERE id = $1 AND state = 'pending'`,
      [invoice.id]
    );
    await recordTransition(client, invoice.id, "pending", "paid", "stellar_payment_confirmed", idempotencyKey, {
      transactionHash: txHash,
      operationId: op.id
    });
  });

  return { status: "paid" };
}

function isMatchingPayment(op: HorizonOperation, invoice: InvoiceForConfirm) {
  if (!["payment", "path_payment_strict_receive", "path_payment_strict_send"].includes(op.type)) {
    return false;
  }
  if (op.asset_code !== invoice.asset_code || op.asset_issuer !== invoice.asset_issuer) {
    return false;
  }
  if (parseUsdcUnits(op.amount ?? "0") !== BigInt(invoice.gross_amount_units)) {
    return false;
  }
  return op.to_muxed_id === invoice.stellar_muxed_id || op.to === invoice.destination_account;
}

async function fetchHorizon<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${env.STELLAR_HORIZON_URL}${path}`, { signal: controller.signal });
    if (!res.ok) throw new AppError(`horizon_fetch_failed:${res.status}`, 502);
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("horizon_timeout", 504);
    }
    throw new AppError("horizon_unreachable", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function ledgerFromOperationId(operationId: string) {
  return BigInt(operationId) / 4_294_967_296n;
}
