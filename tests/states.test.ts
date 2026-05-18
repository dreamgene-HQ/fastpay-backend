import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionInvoice, canTransitionPayout } from "../src/states.js";

test("invoice transitions are constrained", () => {
  assert.equal(canTransitionInvoice("pending", "paid"), true);
  assert.equal(canTransitionInvoice("paid", "settled"), true);
  assert.equal(canTransitionInvoice("settled", "paid"), false);
  assert.equal(canTransitionInvoice("expired", "paid"), false);
});

test("payout transitions are constrained", () => {
  assert.equal(canTransitionPayout("queued", "submitted"), true);
  assert.equal(canTransitionPayout("submitted", "settled"), true);
  assert.equal(canTransitionPayout("failed", "dead_lettered"), true);
  assert.equal(canTransitionPayout("settled", "failed"), false);
});
