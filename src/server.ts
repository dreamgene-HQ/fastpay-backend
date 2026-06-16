import { registerMerchant, loginMerchant, updateMerchantProfile } from "./auth/service.js";
import { screenWallet } from "./compliance/service.js";
import { env } from "./env.js";
import { Router, pathId, requireSession, writeJson } from "./http.js";
import { createInvoice, getInvoice, getPublicInvoice, listInvoices, prepareInvoicePayment } from "./invoices/service.js";
import { confirmPayment } from "./payments/confirm.js";
import { streamInvoiceStatus } from "./payments/sse.js";
import { submitPaymentSchema } from "./contracts.js";

const router = new Router();

router.add("GET", /^\/health$/, async () => ({ ok: true }));

router.add("POST", /^\/auth\/register$/, async ({ body }) => registerMerchant(body));

router.add("POST", /^\/auth\/login$/, async ({ body }) => {
  const tokens = await loginMerchant(body);
  if (!tokens) {
    const error = new Error("unauthorized");
    error.name = "UnauthorizedError";
    throw error;
  }
  return tokens;
});

router.add("PATCH", /^\/merchant\/profile$/, async ({ session, body }) =>
  updateMerchantProfile(requireSession(session).sub, body)
);

router.add("GET", /^\/invoices$/, async ({ session }) => listInvoices(requireSession(session).sub));

router.add("POST", /^\/invoices$/, async ({ session, body }) => createInvoice(requireSession(session).sub, body));

const invoiceById = /^\/invoices\/(?<id>[0-9a-f-]+)$/;
router.add("GET", invoiceById, async ({ session, url }) => {
  const invoice = await getInvoice(requireSession(session).sub, pathId(invoiceById, url.pathname));
  return invoice ?? { error: "invoice_not_found" };
});

const publicInvoice = /^\/invoices\/public\/(?<id>[^/]+)$/;
router.add("GET", publicInvoice, async ({ url, res }) => {
  const invoice = await getPublicInvoice(pathId(publicInvoice, url.pathname));
  if (!invoice) {
    writeJson(res, 404, { error: "invoice_not_found" });
    return null;
  }
  return invoice;
});

const preparePayment = /^\/payments\/(?<id>[^/]+)\/prepare-tx$/;
router.add("GET", preparePayment, async ({ url }) => {
  const payer = url.searchParams.get("payer");
  if (!payer) {
    return { error: "payer_required" };
  }
  return prepareInvoicePayment(pathId(preparePayment, url.pathname), payer);
});

const submitPayment = /^\/payments\/(?<id>[^/]+)\/submit$/;
router.add("POST", submitPayment, async ({ url, body }) => {
  const { txHash } = submitPaymentSchema.parse(body);
  return confirmPayment(pathId(submitPayment, url.pathname), txHash);
});

const streamPayment = /^\/payments\/(?<id>[0-9a-f-]+)\/stream$/;
router.add("GET", streamPayment, async ({ url, res }) => {
  await streamInvoiceStatus(pathId(streamPayment, url.pathname), res);
  return null;
});

router.add("POST", /^\/compliance\/screen$/, async ({ body }) => screenWallet(body));

router.server().listen(env.PORT, () => {
  console.log(`fastpay backend listening on ${env.PORT}`);
});
