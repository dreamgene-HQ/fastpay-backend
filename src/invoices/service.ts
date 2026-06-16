import { createInvoiceSchema, type Invoice } from "../contracts.js";
import type { PoolClient } from "pg";
import { query, transaction } from "../database/pool.js";
import { env } from "../env.js";
import { AppError } from "../http.js";
import { publicId, uint63String } from "../ids.js";
import { calculateFee, formatUsdcUnits, parseUsdcUnits } from "../money.js";
import { makeMuxedAddress, preparePaymentTransaction } from "../stellar.js";

type InvoiceRow = {
  id: string;
  merchant_id: string;
  merchant_name?: string;
  public_id: string;
  description: string;
  state: Invoice["state"];
  gross_amount_units: string;
  platform_fee_amount_units: string;
  merchant_net_amount_units: string;
  asset_code: string;
  asset_issuer: string;
  destination_account: string;
  destination_muxed_account: string;
  stellar_memo: string;
  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
};

export async function createInvoice(merchantId: string, input: unknown) {
  const dto = createInvoiceSchema.parse(input);

  const merchantResult = await query<{ merchant_stellar_address: string | null }>(
    "SELECT merchant_stellar_address FROM merchants WHERE id = $1",
    [merchantId]
  );
  const merchantStellarAddress = merchantResult.rows[0]?.merchant_stellar_address;
  if (!merchantStellarAddress) {
    throw new AppError("merchant_stellar_address_required", 400);
  }

  const grossUnits = parseUsdcUnits(dto.amount);
  const amounts = calculateFee(grossUnits, env.PLATFORM_FEE_BPS, env.PLATFORM_FEE_FIXED_UNITS);
  const muxedId = uint63String();
  const id = publicId("pay");
  const expiresAt = new Date(Date.now() + (dto.expiresInMinutes ?? env.INVOICE_EXPIRY_MINUTES) * 60_000);

  const row = await transaction(async (client) => {
    const result = await client.query<InvoiceRow>(
      `INSERT INTO invoices (
        merchant_id, public_id, description,
        gross_amount_units, platform_fee_amount_units, merchant_net_amount_units,
        asset_code, asset_issuer, destination_account, destination_muxed_account,
        stellar_muxed_id, stellar_memo, expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        merchantId,
        id,
        dto.description,
        amounts.grossAmountUnits.toString(),
        amounts.platformFeeAmountUnits.toString(),
        amounts.merchantNetAmountUnits.toString(),
        env.STELLAR_ASSET_CODE,
        env.STELLAR_ASSET_ISSUER,
        merchantStellarAddress,
        makeMuxedAddress(merchantStellarAddress, muxedId),
        muxedId,
        muxedId,
        expiresAt
      ]
    );

    await recordTransition(client, result.rows[0].id, null, "pending", "invoice_created", `invoice_created:${result.rows[0].id}`);
    return result.rows[0];
  });

  return invoiceFromRow(row);
}

export async function listInvoices(merchantId: string) {
  const result = await query<InvoiceRow>(
    `SELECT *
     FROM invoices
     WHERE merchant_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [merchantId]
  );
  return result.rows.map(invoiceFromRow);
}

export async function getInvoice(merchantId: string, invoiceId: string) {
  const result = await query<InvoiceRow>("SELECT * FROM invoices WHERE id = $1 AND merchant_id = $2", [invoiceId, merchantId]);
  return result.rows[0] ? invoiceFromRow(result.rows[0]) : null;
}

export async function getPublicInvoice(publicId: string) {
  const result = await query<InvoiceRow>(
    `SELECT invoices.*, merchants.business_name AS merchant_name
     FROM invoices
     JOIN merchants ON merchants.id = invoices.merchant_id
     WHERE invoices.public_id = $1`,
    [publicId]
  );
  return result.rows[0] ? invoiceFromRow(result.rows[0]) : null;
}

export async function prepareInvoicePayment(publicId: string, payer: string) {
  const invoice = await getPublicInvoice(publicId);
  if (!invoice) {
    throw new AppError("invoice_not_found", 404);
  }
  if (invoice.state !== "pending" || new Date(invoice.expiresAt).getTime() <= Date.now()) {
    throw new AppError("invoice_not_payable", 409);
  }

  const xdr = await preparePaymentTransaction({
    payer,
    destination: invoice.destinationMuxedAccount,
    amount: formatUsdcUnits(BigInt(invoice.grossAmountUnits)),
    memo: invoice.stellarMemo
  });

  return {
    xdr,
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
    horizonUrl: env.STELLAR_HORIZON_URL
  };
}

export async function expirePendingInvoices() {
  await query(
    `UPDATE invoices
     SET state = 'expired', updated_at = now(), version = version + 1
     WHERE state = 'pending' AND expires_at < now()`
  );
}

export async function recordTransition(
  client: PoolClient,
  invoiceId: string,
  fromState: string | null,
  toState: string,
  reason: string,
  idempotencyKey: string,
  metadata: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO invoice_state_transitions (invoice_id, from_state, to_state, reason, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [invoiceId, fromState, toState, reason, idempotencyKey, JSON.stringify(metadata)]
  );
}

function invoiceFromRow(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    publicId: row.public_id,
    description: row.description,
    state: row.state,
    grossAmountUnits: row.gross_amount_units,
    platformFeeAmountUnits: row.platform_fee_amount_units,
    merchantNetAmountUnits: row.merchant_net_amount_units,
    assetCode: row.asset_code,
    assetIssuer: row.asset_issuer,
    destinationAccount: row.destination_account,
    destinationMuxedAccount: row.destination_muxed_account,
    stellarMemo: row.stellar_memo,
    expiresAt: row.expires_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    merchantName: row.merchant_name
  };
}
