import assert from "node:assert/strict";
import test from "node:test";
import { registerSchema, updateProfileSchema } from "../src/contracts.js";

// 56-char Stellar G address, all chars in A-Z/2-7
const VALID_STELLAR = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W47";
// 55 chars (one too short)
const INVALID_STELLAR_SHORT = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W4";
// 56 chars but contains '8' which is not in Stellar base32 (A-Z, 2-7)
const INVALID_STELLAR_DIGIT = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W48";

test("registerSchema accepts valid Stellar address", () => {
  const result = registerSchema.safeParse({
    businessName: "Acme",
    email: "a@example.com",
    password: "correct-horse-battery-staple",
    stellarAddress: VALID_STELLAR
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.stellarAddress, VALID_STELLAR);
  }
});

test("registerSchema rejects invalid Stellar address", () => {
  for (const bad of [INVALID_STELLAR_SHORT, INVALID_STELLAR_DIGIT]) {
    const result = registerSchema.safeParse({
      businessName: "Acme",
      email: "a@example.com",
      password: "correct-horse-battery-staple",
      stellarAddress: bad
    });
    assert.equal(result.success, false);
  }
});

test("registerSchema allows omitting stellarAddress", () => {
  const result = registerSchema.safeParse({
    businessName: "Acme",
    email: "a@example.com",
    password: "correct-horse-battery-staple"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.stellarAddress, undefined);
  }
});

test("updateProfileSchema accepts valid Stellar address", () => {
  const result = updateProfileSchema.safeParse({ stellarAddress: VALID_STELLAR });
  assert.equal(result.success, true);
});

test("updateProfileSchema rejects invalid Stellar address", () => {
  const result = updateProfileSchema.safeParse({ stellarAddress: INVALID_STELLAR_SHORT });
  assert.equal(result.success, false);
});

test("updateProfileSchema requires stellarAddress", () => {
  const result = updateProfileSchema.safeParse({});
  assert.equal(result.success, false);
});
