CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge_id text PRIMARY KEY,
  purpose text NOT NULL,
  domain text NOT NULL,
  network text NOT NULL CHECK (network IN ('testnet', 'public')),
  nonce text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload text NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS auth_challenges_expiry_idx
  ON auth_challenges (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash char(64) PRIMARY KEY,
  public_key char(56) NOT NULL
    CHECK (public_key = upper(public_key) AND public_key ~ '^G[A-Z2-7]{55}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_public_key_idx
  ON auth_sessions (public_key);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
  ON auth_sessions (expires_at)
  WHERE invalidated_at IS NULL;

CREATE TABLE IF NOT EXISTS workflow_intents (
  request_id uuid PRIMARY KEY,
  workflow_scope text NOT NULL,
  workflow_type text NOT NULL,
  subject_public_key char(56)
    CHECK (
      subject_public_key IS NULL OR
      (subject_public_key = upper(subject_public_key) AND subject_public_key ~ '^G[A-Z2-7]{55}$')
    ),
  state text NOT NULL CHECK (
    state IN ('created', 'approved', 'signed', 'submitted', 'confirmed', 'failed', 'cancelled')
  ),
  idempotency_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  terminal_at timestamptz,
  failure_code text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  policy_version text NOT NULL,
  external_reference text,
  onchain_reference text,
  UNIQUE (workflow_scope, idempotency_key),
  CHECK (
    terminal_at IS NULL OR state IN ('confirmed', 'failed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS workflow_intents_subject_idx
  ON workflow_intents (subject_public_key, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  chain_id text PRIMARY KEY,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_event_hash char(64)
);

INSERT INTO audit_chain_heads (chain_id, last_sequence, last_event_hash)
VALUES ('application', 0, NULL)
ON CONFLICT (chain_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_events (
  event_id uuid PRIMARY KEY,
  chain_id text NOT NULL REFERENCES audit_chain_heads(chain_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  request_id uuid,
  event_type text NOT NULL,
  source text NOT NULL,
  target_public_key char(56)
    CHECK (
      target_public_key IS NULL OR
      (target_public_key = upper(target_public_key) AND target_public_key ~ '^G[A-Z2-7]{55}$')
    ),
  occurred_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  metadata jsonb NOT NULL,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL UNIQUE,
  UNIQUE (chain_id, sequence)
);

CREATE INDEX IF NOT EXISTS audit_events_request_idx
  ON audit_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TABLE IF NOT EXISTS eligibility_records (
  eligibility_id uuid PRIMARY KEY,
  wallet_public_key char(56) NOT NULL
    CHECK (wallet_public_key = upper(wallet_public_key) AND wallet_public_key ~ '^G[A-Z2-7]{55}$'),
  eligibility_type text NOT NULL,
  reason text NOT NULL,
  became_eligible_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('eligible', 'revoked')),
  revocation_state text NOT NULL DEFAULT 'not_revoked'
    CHECK (revocation_state IN ('not_revoked', 'revoked')),
  revoked_at timestamptz,
  policy_version text NOT NULL,
  UNIQUE (wallet_public_key, eligibility_type)
);

CREATE TABLE IF NOT EXISTS reward_records (
  reward_id uuid PRIMARY KEY,
  wallet_public_key char(56) NOT NULL
    CHECK (wallet_public_key = upper(wallet_public_key) AND wallet_public_key ~ '^G[A-Z2-7]{55}$'),
  reward_type text NOT NULL,
  amount numeric(30, 7) NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (
    status IN ('created', 'approved', 'signed', 'submitted', 'confirmed', 'failed', 'cancelled')
  ),
  idempotency_key text NOT NULL,
  reward_uniqueness_key text NOT NULL UNIQUE,
  qualifying_event_reference text,
  launch_window_evidence jsonb,
  onchain_transaction_reference text,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (reward_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS reward_records_wallet_idx
  ON reward_records (wallet_public_key, created_at DESC);

CREATE TABLE IF NOT EXISTS protected_operation_intents (
  operation_id uuid PRIMARY KEY,
  workflow_request_id uuid NOT NULL UNIQUE REFERENCES workflow_intents(request_id),
  operation_type text NOT NULL CHECK (
    operation_type IN ('mint', 'authorization', 'treasury_transfer', 'liquidity')
  ),
  target_public_key char(56)
    CHECK (
      target_public_key IS NULL OR
      (target_public_key = upper(target_public_key) AND target_public_key ~ '^G[A-Z2-7]{55}$')
    ),
  parameters jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
