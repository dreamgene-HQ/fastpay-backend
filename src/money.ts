const SCALE = 10_000_000n;

export function parseUsdcUnits(input: string) {
  const match = input.trim().match(/^(\d+)(?:\.(\d{1,7})?)?$/);
  if (!match) {
    throw new Error("USDC amount must use up to 7 decimals");
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(7, "0"));
  const units = whole * SCALE + fractional;
  if (units <= 0n) {
    throw new Error("amount must be greater than zero");
  }

  return units;
}

export function formatUsdcUnits(units: bigint) {
  const whole = units / SCALE;
  const fractional = (units % SCALE).toString().padStart(7, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

export function calculateFee(grossUnits: bigint, feeBps: number, fixedFeeUnits: bigint) {
  const platformFeeAmountUnits = (grossUnits * BigInt(feeBps)) / 10_000n + fixedFeeUnits;
  if (platformFeeAmountUnits >= grossUnits) {
    throw new Error("platform fee must be less than gross amount");
  }

  return {
    grossAmountUnits: grossUnits,
    platformFeeAmountUnits,
    merchantNetAmountUnits: grossUnits - platformFeeAmountUnits
  };
}
