-- Phase 1: adopt merchant-owned destination model.
-- All dropped objects confirmed zero live references in src/ via grep before this migration was written.

-- Drop FK from internal_ledger_entries to payouts before dropping the table.
ALTER TABLE internal_ledger_entries DROP COLUMN IF EXISTS payout_id;

-- Drop payouts (custodial payout engine: v2 feature, not part of v0 scope).
DROP TABLE IF EXISTS payouts;

-- Drop webhook scaffolding (WEBHOOK_SIGNING_SECRET removed from env; no routes wired up).
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS webhook_endpoints;

-- Drop unused per-merchant overrides and KYB column from merchants.
ALTER TABLE merchants DROP COLUMN IF EXISTS kyb_verified_at;
ALTER TABLE merchants DROP COLUMN IF EXISTS fee_bps;
ALTER TABLE merchants DROP COLUMN IF EXISTS fee_fixed_units;

-- Rename settlement_stellar_address to merchant_stellar_address for clarity.
-- Column was already nullable; application layer enforces it before invoice creation.
ALTER TABLE merchants RENAME COLUMN settlement_stellar_address TO merchant_stellar_address;
