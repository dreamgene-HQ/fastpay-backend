CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'suspended')),
    fee_bps INTEGER NOT NULL DEFAULT 100 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
    fee_fixed_units BIGINT NOT NULL DEFAULT 0 CHECK (fee_fixed_units >= 0),
    settlement_stellar_address TEXT,
    kyb_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX merchants_email_lower_idx ON merchants (lower(email));

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    public_id TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'paid', 'expired', 'settled', 'failed')),
    gross_amount_units BIGINT NOT NULL CHECK (gross_amount_units > 0),
    platform_fee_amount_units BIGINT NOT NULL CHECK (platform_fee_amount_units >= 0),
    merchant_net_amount_units BIGINT NOT NULL CHECK (merchant_net_amount_units >= 0),
    asset_code TEXT NOT NULL,
    asset_issuer TEXT NOT NULL,
    destination_account TEXT NOT NULL,
    destination_muxed_account TEXT NOT NULL,
    stellar_muxed_id NUMERIC(20, 0) NOT NULL,
    stellar_memo TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    failed_reason TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (gross_amount_units = platform_fee_amount_units + merchant_net_amount_units)
);

CREATE INDEX invoices_merchant_created_idx ON invoices (merchant_id, created_at DESC);
CREATE INDEX invoices_state_expires_idx ON invoices (state, expires_at);
CREATE UNIQUE INDEX invoices_muxed_id_idx ON invoices (stellar_muxed_id);
CREATE UNIQUE INDEX invoices_memo_idx ON invoices (stellar_memo);

CREATE TABLE invoice_state_transitions (
    id BIGSERIAL PRIMARY KEY,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    from_state TEXT,
    to_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (invoice_id, idempotency_key)
);

CREATE TABLE stellar_raw_events (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    ledger_sequence BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    operation_id TEXT,
    paging_token TEXT,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX stellar_raw_events_unique_idx
    ON stellar_raw_events (source, transaction_hash, COALESCE(operation_id, ''));

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    raw_event_id BIGINT REFERENCES stellar_raw_events(id) ON DELETE SET NULL,
    transaction_hash TEXT NOT NULL,
    operation_id TEXT,
    payer_account TEXT,
    amount_units BIGINT NOT NULL CHECK (amount_units > 0),
    asset_code TEXT NOT NULL,
    asset_issuer TEXT NOT NULL,
    confirmed_ledger BIGINT NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payments_unique_onchain_idx
    ON payments (transaction_hash, COALESCE(operation_id, ''));
CREATE INDEX payments_invoice_id_idx ON payments (invoice_id);

CREATE TABLE payment_exceptions (
    id BIGSERIAL PRIMARY KEY,
    raw_event_id BIGINT REFERENCES stellar_raw_events(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    resolution_state TEXT NOT NULL DEFAULT 'open'
        CHECK (resolution_state IN ('open', 'resolved', 'ignored')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'submitted', 'settled', 'failed', 'dead_lettered')),
    amount_units BIGINT NOT NULL CHECK (amount_units > 0),
    destination_account TEXT NOT NULL,
    transaction_hash TEXT,
    failure_reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payouts_merchant_created_idx ON payouts (merchant_id, created_at DESC);
CREATE INDEX payouts_state_idx ON payouts (state);

CREATE TABLE internal_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    payout_id UUID REFERENCES payouts(id) ON DELETE SET NULL,
    account TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount_units BIGINT NOT NULL CHECK (amount_units > 0),
    asset_code TEXT NOT NULL,
    asset_issuer TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account, idempotency_key)
);

CREATE TABLE stellar_reconciliation_cursors (
    id TEXT PRIMARY KEY,
    last_paging_token TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO stellar_reconciliation_cursors (id, last_paging_token)
VALUES ('treasury_payments', 'now')
ON CONFLICT DO NOTHING;

CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL,
    signing_secret_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'queued'
        CHECK (delivery_state IN ('queued', 'delivered', 'failed', 'dead_lettered')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
