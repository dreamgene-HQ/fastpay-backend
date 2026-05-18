import { z } from "zod";

export const registerSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(12).max(200)
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200)
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;

export type AuthTokens = {
  accessToken: string;
  expiresIn: number;
  merchant: {
    id: string;
    businessName: string;
    email: string;
  };
};

export const invoiceStates = ["pending", "paid", "expired", "settled", "failed"] as const;
export const payoutStates = ["queued", "submitted", "settled", "failed", "dead_lettered"] as const;

export type InvoiceState = (typeof invoiceStates)[number];
export type PayoutState = (typeof payoutStates)[number];

export const createInvoiceSchema = z.object({
  description: z.string().trim().min(2).max(240),
  amount: z.string().trim().regex(/^\d+(\.\d{1,7})?$/, "USDC amount must use at most 7 decimals"),
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).optional()
});

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;

export type Invoice = {
  id: string;
  merchantId: string;
  publicId: string;
  description: string;
  state: InvoiceState;
  grossAmountUnits: string;
  platformFeeAmountUnits: string;
  merchantNetAmountUnits: string;
  assetCode: string;
  assetIssuer: string;
  destinationAccount: string;
  destinationMuxedAccount: string;
  stellarMemo: string;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  merchantName?: string;
};

export type PaymentEvent = {
  id: string;
  invoiceId: string;
  transactionHash: string;
  operationId: string | null;
  amountUnits: string;
  confirmedLedger: string;
  confirmedAt: string;
};

export const screenWalletSchema = z.object({
  address: z.string().regex(/^G[A-Z2-7]{55}$/, "address must be a Stellar G public key")
});

export type ScreenWalletDto = z.infer<typeof screenWalletSchema>;
export type ComplianceDecision = "clear" | "review" | "blocked";

export type ComplianceScreenResult = {
  address: string;
  decision: ComplianceDecision;
  reason: string | null;
};

export const createWebhookSchema = z.object({
  url: z.string().url().refine((url) => url.startsWith("https://"), "webhook URL must use HTTPS"),
  events: z.array(z.enum(["invoice.paid", "invoice.expired", "invoice.settled", "payout.failed"])).min(1)
});

export type CreateWebhookDto = z.infer<typeof createWebhookSchema>;

export type WebhookEvent = {
  id: string;
  eventType: string;
  deliveryState: "queued" | "delivered" | "failed" | "dead_lettered";
  attempts: number;
  createdAt: string;
};
