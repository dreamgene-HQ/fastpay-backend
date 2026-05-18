import type { InvoiceState, PayoutState } from "./contracts.js";

const invoiceTransitions: Record<InvoiceState, InvoiceState[]> = {
  pending: ["paid", "expired", "failed"],
  paid: ["settled", "failed"],
  expired: [],
  settled: [],
  failed: []
};

const payoutTransitions: Record<PayoutState, PayoutState[]> = {
  queued: ["submitted", "failed"],
  submitted: ["settled", "failed"],
  failed: ["queued", "dead_lettered"],
  settled: [],
  dead_lettered: []
};

export function canTransitionInvoice(from: InvoiceState, to: InvoiceState) {
  return invoiceTransitions[from].includes(to);
}

export function canTransitionPayout(from: PayoutState, to: PayoutState) {
  return payoutTransitions[from].includes(to);
}
