import { screenWalletSchema, type ComplianceScreenResult } from "../contracts.js";
import { env } from "../env.js";

const blocked = new Set(
  env.COMPLIANCE_BLOCKED_ADDRESSES.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

export function screenWallet(input: unknown): ComplianceScreenResult {
  const { address } = screenWalletSchema.parse(input);
  if (blocked.has(address)) {
    return { address, decision: "blocked", reason: "configured_blocklist" };
  }

  return { address, decision: "clear", reason: null };
}
