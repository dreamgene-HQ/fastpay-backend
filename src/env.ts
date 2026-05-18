import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url().default("http://localhost:4000"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY_SECONDS: z.coerce.number().int().min(60).default(900),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(100),
  PLATFORM_FEE_FIXED_UNITS: z
    .string()
    .default("0")
    .transform((value) => BigInt(value)),
  INVOICE_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(60 * 24 * 30).default(60),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  STELLAR_HORIZON_URL: z.string().url(),
  STELLAR_ASSET_CODE: z.string().min(1).max(12),
  STELLAR_ASSET_ISSUER: z.string().regex(/^G[A-Z2-7]{55}$/),
  PLATFORM_TREASURY_PUBLIC_KEY: z.string().regex(/^G[A-Z2-7]{55}$/),
  RECONCILIATION_START_CURSOR: z.string().optional(),
  COMPLIANCE_BLOCKED_ADDRESSES: z.string().default(""),
  WEBHOOK_SIGNING_SECRET: z.string().min(32)
});

export const env = envSchema.parse(process.env);
