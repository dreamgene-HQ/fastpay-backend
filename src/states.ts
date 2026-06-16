import type { InvoiceState } from "./contracts.js";

const invoiceTransitions: Record<InvoiceState, InvoiceState[]> = {
  pending: ["paid", "expired", "failed"],
  paid: ["settled", "failed"],
  expired: [],
  settled: [],
  failed: []
};

export function canTransitionInvoice(from: InvoiceState, to: InvoiceState) {
  return invoiceTransitions[from].includes(to);
}
