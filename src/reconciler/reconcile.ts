import { expirePendingInvoices } from "../invoices/service.js";

const EXPIRE_INTERVAL_MS = 60_000;

async function runExpiry() {
  try {
    const expired = await expirePendingInvoices();
    if (expired > 0) {
      console.log(`expired ${expired} pending invoice(s)`);
    }
  } catch (error) {
    console.error("invoice expiry failed:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runExpiry();
  setInterval(runExpiry, EXPIRE_INTERVAL_MS);
}
