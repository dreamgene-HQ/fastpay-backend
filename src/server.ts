import { registerMerchant, loginMerchant } from "./auth/service.js";
import { screenWallet } from "./compliance/service.js";
import { env } from "./env.js";
import { Router, pathId, requireSession, writeJson, type RequestContext } from "./http.js";
import { createInvoice, getInvoice, getPublicInvoice, listInvoices, prepareInvoicePayment } from "./invoices/service.js";
import { clientIp, RateLimiter } from "./middleware/rate-limit.js";
import { streamInvoiceStatus } from "./payments/sse.js";

const router = new Router();

const authRateLimiter = new RateLimiter(env.AUTH_RATE_LIMIT_MAX, env.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000);
const prepareTxRateLimiter = new RateLimiter(
  env.PREPARE_TX_RATE_LIMIT_MAX,
  env.PREPARE_TX_RATE_LIMIT_WINDOW_SECONDS * 1000
);

/** Returns false (and writes a 429 response) if the request should be rejected. */
function enforceRateLimit(limiter: RateLimiter, { req, res }: RequestContext): boolean {
  const result = limiter.consume(clientIp(req));
  if (!result.allowed) {
    res.setHeader("retry-after", result.retryAfterSeconds.toString());
    writeJson(res, 429, { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds });
    return false;
  }
  return true;
}

router.add("GET", /^\/health$/, async () => ({ ok: true }));

router.add("POST", /^\/auth\/register$/, async (context) => {
  if (!enforceRateLimit(authRateLimiter, context)) {
    return null;
  }
  return registerMerchant(context.body);
});

router.add("POST", /^\/auth\/login$/, async (context) => {
  if (!enforceRateLimit(authRateLimiter, context)) {
    return null;
  }
  const tokens = await loginMerchant(context.body);
  if (!tokens) {
    const error = new Error("unauthorized");
    error.name = "UnauthorizedError";
    throw error;
  }
  return tokens;
});

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

const streamPayment = /^\/payments\/(?<id>[0-9a-f-]+)\/stream$/;
router.add("GET", streamPayment, async ({ url, res }) => {
  await streamInvoiceStatus(pathId(streamPayment, url.pathname), res);
  return null;
});

router.add("POST", /^\/compliance\/screen$/, async ({ body }) => screenWallet(body));

router.server().listen(env.PORT, () => {
  console.log(`fastpay backend listening on ${env.PORT}`);
});
