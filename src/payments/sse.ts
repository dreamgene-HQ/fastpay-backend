import type { ServerResponse } from "node:http";
import { query } from "../database/pool.js";

export async function streamInvoiceStatus(invoiceId: string, res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const send = async () => {
    const result = await query<{ state: string; paid_at: Date | null }>(
      "SELECT state, paid_at FROM invoices WHERE id = $1",
      [invoiceId]
    );
    const row = result.rows[0];
    if (!row) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "invoice_not_found" })}\n\n`);
      res.end();
      return;
    }

    res.write(`event: status\ndata: ${JSON.stringify({ status: row.state, paidAt: row.paid_at?.toISOString() ?? null })}\n\n`);
    if (["paid", "expired", "settled", "failed"].includes(row.state)) {
      res.end();
    }
  };

  await send();
  const interval = setInterval(() => {
    send().catch((error) => {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "stream_error" })}\n\n`);
      res.end();
    });
  }, 3000);

  res.on("close", () => clearInterval(interval));
}
