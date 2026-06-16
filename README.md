# FastPay Backend

FastPay turns a USDC payment into a link. A merchant creates an invoice, shares the link, and gets paid directly to their own Stellar wallet. The blockchain — not FastPay — confirms the payment, so "paid" can't be faked by the frontend, the backend, or anyone in between.

## What FastPay v0 is

FastPay v0 is invoice-to-merchant's-own-wallet by design. There is no platform custody and none is planned for v0. When a payment lands, it goes directly to the merchant's Stellar address — FastPay is never in the middle of the money.

This is a deliberate architecture choice, not a limitation. It makes the trust model legible: the only entity whose correctness matters for "did the merchant get paid" is the Stellar network itself.

**Who it's for**: crypto-native freelancers, small agencies, and cross-border gig workers who already have a Stellar wallet and want a payment link that works like Stripe but settles on-chain.

## Architecture

- **Runtime**: Node.js 22, TypeScript, native HTTP server (no Express).
- **Database**: PostgreSQL — invoices, payments, and state transitions all live here.
- **Validation**: Zod schemas in `src/contracts.ts`; `openapi.yaml` is the authoritative API contract.
- **Payment rail**: Stellar Horizon via `@stellar/stellar-sdk`. The backend prepares unsigned transaction XDR; the payer's wallet signs it; the frontend submits to Horizon and then sends the tx hash to the backend for on-chain verification.
- **Source of truth for "paid"**: `POST /payments/:publicId/submit` — the backend fetches the transaction from Horizon, matches the operation against the invoice, and records the confirmed ledger. The frontend cannot mark an invoice paid.

## Setup

```sh
npm install
cp .env.example .env          # fill in values
docker compose up -d          # start Postgres
npm run db:migrate
npm run dev
```

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Access-token signing secret |
| `FRONTEND_ORIGIN` | Allowed browser origin (CORS) |
| `STELLAR_HORIZON_URL` | Horizon API base URL |
| `STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase |
| `STELLAR_ASSET_CODE` | Asset code (`USDC`) |
| `STELLAR_ASSET_ISSUER` | USDC issuer public key |
| `PLATFORM_FEE_BPS` | Platform fee in basis points (accounting only in v0) |
| `PLATFORM_FEE_FIXED_UNITS` | Fixed fee in atomic USDC units |
| `INVOICE_EXPIRY_MINUTES` | Default invoice lifetime |
| `AUTH_RATE_LIMIT_MAX` | Max auth requests per window |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Rate-limit window for auth endpoints |
| `PREPARE_TX_RATE_LIMIT_MAX` | Max prepare-tx requests per window |
| `PREPARE_TX_RATE_LIMIT_WINDOW_SECONDS` | Rate-limit window for prepare-tx |

## Scripts

```sh
npm run dev           # start server with hot reload
npm run db:migrate    # apply pending SQL migrations
npm run jobs:reconcile # run invoice expiry daemon
npm test              # run test suite
npm run typecheck     # tsc --noEmit
npm run build         # compile to dist/
```

## API Surface

See `openapi.yaml` for the full contract. Key endpoints:

- `GET /health`
- `POST /auth/register` — accepts optional `stellarAddress`
- `POST /auth/login`
- `PATCH /merchant/profile` — update merchant Stellar address
- `GET /invoices` — list merchant invoices
- `POST /invoices` — create invoice (requires `stellarAddress` to be set)
- `GET /invoices/:id`
- `GET /invoices/public/:publicId`
- `GET /payments/:publicId/prepare-tx?payer=G...`
- `POST /payments/:publicId/submit` — verify on-chain and mark paid
- `GET /payments/:invoiceId/stream` — SSE status stream
- `POST /compliance/screen`

## Invoice States

`pending` → `paid` (on-chain confirmed) or `expired` (past expiry time).

Gross amount, platform fee, and merchant net are stored separately on every invoice row. Fee collection mechanics are a v2 concern — v0 records the accounting but does not sweep fees.

## Repo Boundary

This repo does not depend on `fastpay-frontend` or `fastpay-contract`. Integration happens through HTTP/SSE endpoints and `openapi.yaml`. Do not reintroduce a shared local package — that collapses the split back into a monorepo.

## What's Next

- **Payout aggregation** (v2): optional upsell for merchants who want FastPay to batch and route funds, with fee collection and settlement reporting.
- **Webhook delivery**: event push for merchant systems that prefer pull-less integration.
- **Real sanctions screening**: replace the stub compliance endpoint with an actual OFAC/sanctions data provider.
- **Broader wallet support**: multi-wallet signing, hardware wallet flows.
