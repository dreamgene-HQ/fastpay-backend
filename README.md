# FastPay Backend

FastPay Backend is the money-moving source of truth for USDC payment links. It owns merchant auth, invoice creation, fee accounting, Stellar transaction preparation, PostgreSQL persistence, and reconciliation.

The backend does not trust browser payment success. The frontend can submit a signed transaction to Stellar, but only the reconciler may mark an invoice `paid`.

## Architecture

- Runtime: Node.js 22, TypeScript, native HTTP server.
- Database: PostgreSQL.
- Validation: Zod schemas in `src/contracts.ts`.
- API contract: `openapi.yaml`.
- Payment rail: Stellar Horizon testnet/mainnet via `@stellar/stellar-sdk`.
- Reconciliation: `src/reconciler/reconcile.ts`.

## Repo Boundary

This repo does not depend on `fastpay-frontend` or `fastpay-contracts`.

Frontend integration happens through:

- HTTP JSON endpoints.
- Server-sent events for invoice status.
- The versioned `openapi.yaml` contract.

Do not reintroduce a local shared TypeScript package. That collapses the split back into a monorepo.

## Setup

```sh
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run dev
```

Required environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Access-token signing secret |
| `FRONTEND_ORIGIN` | Allowed browser origin |
| `STELLAR_HORIZON_URL` | Horizon API URL |
| `STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase |
| `STELLAR_ASSET_CODE` | Asset code, usually `USDC` |
| `STELLAR_ASSET_ISSUER` | Stellar issuer public key |
| `PLATFORM_TREASURY_PUBLIC_KEY` | Platform treasury public key |

## Scripts

```sh
npm run dev
npm run db:migrate
npm run jobs:reconcile
npm test
npm run typecheck
npm run build
```

## API Surface

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /invoices`
- `POST /invoices`
- `GET /invoices/:id`
- `GET /invoices/public/:publicId`
- `GET /payments/:publicId/prepare-tx?payer=G...`
- `GET /payments/:invoiceId/stream`
- `POST /compliance/screen`

Keep `openapi.yaml` updated whenever this surface changes.

## State Rules

Invoice states:

- `pending`
- `paid`
- `expired`
- `settled`
- `failed`

Payout states:

- `queued`
- `submitted`
- `settled`
- `failed`
- `dead_lettered`

Gross amount, platform fee, and merchant net are stored separately. Do not calculate merchant receivables in the frontend.

## Production Gaps

Before real money: add KYB, sanctions screening, idempotent webhook delivery, payout signing through KMS/HSM, reconciliation replay controls, dead-letter operations, structured metrics, audit export, and legal review.
