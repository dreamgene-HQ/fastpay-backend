import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionInvoice } from "../src/states.js";

test("invoice transitions are constrained", () => {
  assert.equal(canTransitionInvoice("pending", "paid"), true);
  assert.equal(canTransitionInvoice("paid", "settled"), true);
  assert.equal(canTransitionInvoice("settled", "paid"), false);
  assert.equal(canTransitionInvoice("expired", "paid"), false);
});
