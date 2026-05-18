import assert from "node:assert/strict";
import test from "node:test";
import { calculateFee, formatUsdcUnits, parseUsdcUnits } from "../src/money.js";

test("USDC units are parsed with 7 decimal precision", () => {
  assert.equal(parseUsdcUnits("1").toString(), "10000000");
  assert.equal(parseUsdcUnits("1.25").toString(), "12500000");
  assert.equal(parseUsdcUnits("0.0000001").toString(), "1");
  assert.equal(formatUsdcUnits(12_500_000n), "1.25");
});

test("fee math preserves gross, fee, and net separately", () => {
  const amounts = calculateFee(10_000_000n, 150, 100_000n);
  assert.equal(amounts.grossAmountUnits, 10_000_000n);
  assert.equal(amounts.platformFeeAmountUnits, 250_000n);
  assert.equal(amounts.merchantNetAmountUnits, 9_750_000n);
});
