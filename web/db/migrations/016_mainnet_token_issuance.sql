-- Complete the existing Mainnet payment order with trustline, issuance and
-- publication state. This migration does not enable Mainnet or submit a tx.

ALTER TABLE mainnet_token_orders
  DROP CONSTRAINT mainnet_token_orders_state_check,
  ADD CONSTRAINT mainnet_token_orders_state_check CHECK (state IN (
    'pending', 'paid', 'trustline_pending', 'trustline_confirmed',
    'issuance_pending', 'reconciling', 'issued', 'refunded'
  )),
  ADD COLUMN publication_status text NOT NULL DEFAULT 'pending'
    CHECK (publication_status IN ('pending', 'verified', 'failed')),
  ADD COLUMN publication_error_code varchar(64),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE mainnet_trustline_attempts (
  order_id uuid PRIMARY KEY REFERENCES mainnet_token_orders(order_id),
  transaction_hash char(64) NOT NULL UNIQUE CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  unsigned_xdr text NOT NULL,
  unsigned_xdr_sha256 char(64) NOT NULL CHECK (unsigned_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence > 0),
  fee_stroops bigint NOT NULL CHECK (fee_stroops > 0),
  valid_from bigint NOT NULL CHECK (valid_from >= 0),
  valid_until bigint NOT NULL CHECK (valid_until > valid_from),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
  ledger_sequence bigint,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'pending' AND ledger_sequence IS NULL AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL))
);

CREATE TABLE mainnet_issuance_attempts (
  order_id uuid PRIMARY KEY REFERENCES mainnet_token_orders(order_id),
  attempt_id uuid NOT NULL UNIQUE,
  transaction_hash char(64) NOT NULL UNIQUE CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  unsigned_xdr text NOT NULL,
  unsigned_xdr_sha256 char(64) NOT NULL CHECK (unsigned_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence > 0),
  fee_stroops bigint NOT NULL CHECK (fee_stroops > 0),
  valid_from bigint NOT NULL CHECK (valid_from >= 0),
  valid_until bigint NOT NULL CHECK (valid_until > valid_from),
  signed_envelope_xdr_sha256 char(64)
    CHECK (signed_envelope_xdr_sha256 IS NULL OR signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN (
    'prepared', 'signing', 'submitted', 'reconciliation_required', 'confirmed'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (order_id, attempt_id, transaction_hash),
  CHECK (updated_at >= created_at)
);

CREATE TABLE mainnet_issuance_confirmations (
  confirmation_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES mainnet_token_orders(order_id),
  attempt_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_public_key char(56) NOT NULL,
  network text NOT NULL CHECK (network = 'public'),
  transaction_hash char(64) NOT NULL UNIQUE CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  signed_envelope_xdr_sha256 char(64) NOT NULL CHECK (signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_xdr_sha256 char(64) NOT NULL CHECK (envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  result_xdr_sha256 char(64) NOT NULL CHECK (result_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  ledger_sequence bigint NOT NULL CHECK (ledger_sequence > 0),
  ledger_closed_at timestamptz NOT NULL,
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence > 0),
  issuer_public_key char(56) NOT NULL,
  destination_public_key char(56) NOT NULL,
  asset_code varchar(12) NOT NULL,
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  verifier_identity text NOT NULL,
  verified_at timestamptz NOT NULL,
  CHECK (signed_envelope_xdr_sha256 = envelope_xdr_sha256),
  FOREIGN KEY (order_id, attempt_id, transaction_hash)
    REFERENCES mainnet_issuance_attempts(order_id, attempt_id, transaction_hash)
);

CREATE TABLE mainnet_metadata_publications (
  project_id uuid PRIMARY KEY REFERENCES project_profiles(project_id),
  order_id uuid NOT NULL UNIQUE REFERENCES mainnet_token_orders(order_id),
  confirmation_id uuid NOT NULL UNIQUE REFERENCES mainnet_issuance_confirmations(confirmation_id),
  owner_public_key char(56) NOT NULL,
  metadata_home text NOT NULL CHECK (metadata_home = 'assets.orrylo.com'),
  network text NOT NULL CHECK (network = 'public'),
  asset_code varchar(12) NOT NULL,
  issuer_public_key char(56) NOT NULL,
  currency_toml text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reachable boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  last_verification_at timestamptz,
  verification_error_code varchar(64),
  UNIQUE (network, metadata_home, asset_code, issuer_public_key),
  CHECK (reachable = false OR (verified_at IS NOT NULL AND last_verification_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION protect_mainnet_token_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Mainnet orders cannot be deleted'; END IF;
  IF (NEW.order_id, NEW.project_id, NEW.owner_public_key, NEW.issuer_public_key,
      NEW.treasury_public_key, NEW.asset_code, NEW.destination_public_key,
      NEW.initial_supply, NEW.network_passphrase, NEW.price_stroops, NEW.memo,
      NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.order_id, OLD.project_id, OLD.owner_public_key, OLD.issuer_public_key,
      OLD.treasury_public_key, OLD.asset_code, OLD.destination_public_key,
      OLD.initial_supply, OLD.network_passphrase, OLD.price_stroops, OLD.memo,
      OLD.created_at, OLD.expires_at)
  THEN RAISE EXCEPTION 'immutable Mainnet order identity cannot change'; END IF;
  IF (NEW.payment_transaction_hash, NEW.payment_ledger, NEW.paid_at)
      IS DISTINCT FROM
     (OLD.payment_transaction_hash, OLD.payment_ledger, OLD.paid_at)
     AND NOT (
       OLD.state = 'pending' AND NEW.state = 'paid'
       AND OLD.payment_transaction_hash IS NULL
       AND NEW.payment_transaction_hash IS NOT NULL
       AND NEW.payment_ledger IS NOT NULL AND NEW.paid_at IS NOT NULL
     )
  THEN RAISE EXCEPTION 'immutable Mainnet payment evidence cannot change'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state = 'pending' AND NEW.state = 'paid') OR
    (OLD.state = 'paid' AND NEW.state IN ('trustline_pending', 'trustline_confirmed')) OR
    (OLD.state = 'trustline_pending' AND NEW.state = 'trustline_confirmed') OR
    (OLD.state = 'trustline_confirmed' AND NEW.state = 'issuance_pending') OR
    (OLD.state = 'issuance_pending' AND NEW.state = 'reconciling') OR
    (OLD.state IN ('issuance_pending', 'reconciling') AND NEW.state = 'issued')
  ) THEN RAISE EXCEPTION 'invalid Mainnet order state transition'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mainnet_token_orders_issuance_guard
BEFORE UPDATE OR DELETE ON mainnet_token_orders
FOR EACH ROW EXECUTE FUNCTION protect_mainnet_token_order();

CREATE OR REPLACE FUNCTION protect_mainnet_trustline_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending'
    AND NEW.status IN ('confirmed', 'failed') AND NEW.resolved_at IS NOT NULL
    AND (NEW.order_id, NEW.transaction_hash, NEW.unsigned_xdr,
      NEW.unsigned_xdr_sha256, NEW.source_sequence, NEW.fee_stroops,
      NEW.valid_from, NEW.valid_until, NEW.created_at)
      IS NOT DISTINCT FROM
      (OLD.order_id, OLD.transaction_hash, OLD.unsigned_xdr,
      OLD.unsigned_xdr_sha256, OLD.source_sequence, OLD.fee_stroops,
      OLD.valid_from, OLD.valid_until, OLD.created_at)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Mainnet trustline attempt identity is immutable';
END;
$$;

CREATE TRIGGER mainnet_trustline_attempts_guard
BEFORE UPDATE OR DELETE ON mainnet_trustline_attempts
FOR EACH ROW EXECUTE FUNCTION protect_mainnet_trustline_attempt();

CREATE OR REPLACE FUNCTION protect_mainnet_issuance_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (NEW.order_id, NEW.attempt_id, NEW.transaction_hash, NEW.unsigned_xdr,
      NEW.unsigned_xdr_sha256, NEW.source_sequence, NEW.fee_stroops,
      NEW.valid_from, NEW.valid_until, NEW.created_at)
      IS NOT DISTINCT FROM
      (OLD.order_id, OLD.attempt_id, OLD.transaction_hash, OLD.unsigned_xdr,
      OLD.unsigned_xdr_sha256, OLD.source_sequence, OLD.fee_stroops,
      OLD.valid_from, OLD.valid_until, OLD.created_at)
    AND ((OLD.status = 'prepared' AND NEW.status = 'signing'
          AND NEW.signed_envelope_xdr_sha256 IS NULL)
      OR (OLD.status = 'signing' AND NEW.status = 'submitted'
          AND NEW.signed_envelope_xdr_sha256 IS NOT NULL)
      OR (OLD.status IN ('signing', 'submitted', 'reconciliation_required')
          AND NEW.status = 'confirmed'
          AND NEW.signed_envelope_xdr_sha256 IS NOT NULL))
    AND (OLD.signed_envelope_xdr_sha256 IS NULL
      OR NEW.signed_envelope_xdr_sha256 = OLD.signed_envelope_xdr_sha256)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Mainnet issuance attempt identity is immutable';
END;
$$;

CREATE TRIGGER mainnet_issuance_attempts_guard
BEFORE UPDATE OR DELETE ON mainnet_issuance_attempts
FOR EACH ROW EXECUTE FUNCTION protect_mainnet_issuance_attempt();

CREATE OR REPLACE FUNCTION assert_mainnet_confirmation_matches_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM mainnet_token_orders AS orders
    JOIN mainnet_issuance_attempts AS attempt USING (order_id)
    WHERE orders.order_id = NEW.order_id
      AND orders.project_id = NEW.project_id
      AND orders.owner_public_key = NEW.owner_public_key
      AND orders.issuer_public_key = NEW.issuer_public_key
      AND orders.destination_public_key = NEW.destination_public_key
      AND orders.asset_code = NEW.asset_code
      AND orders.initial_supply = NEW.amount
      AND orders.state IN ('issuance_pending', 'reconciling')
      AND attempt.attempt_id = NEW.attempt_id
      AND attempt.transaction_hash = NEW.transaction_hash
      AND attempt.source_sequence = NEW.source_sequence
      AND attempt.status IN ('signing', 'submitted', 'reconciliation_required')
      AND (attempt.signed_envelope_xdr_sha256 IS NULL
        OR attempt.signed_envelope_xdr_sha256 = NEW.signed_envelope_xdr_sha256)
  ) THEN RAISE EXCEPTION 'Mainnet confirmation does not match immutable order'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mainnet_issuance_confirmation_guard
BEFORE INSERT ON mainnet_issuance_confirmations
FOR EACH ROW EXECUTE FUNCTION assert_mainnet_confirmation_matches_order();

CREATE OR REPLACE FUNCTION prevent_mainnet_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Mainnet ledger evidence is append-only'; END;
$$;

CREATE TRIGGER mainnet_issuance_confirmations_append_only
BEFORE UPDATE OR DELETE ON mainnet_issuance_confirmations
FOR EACH ROW EXECUTE FUNCTION prevent_mainnet_evidence_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_app') THEN
    REVOKE UPDATE ON mainnet_token_orders FROM orrylo_app;
    GRANT SELECT, INSERT ON mainnet_token_orders TO orrylo_app;
    GRANT UPDATE (state, payment_transaction_hash, payment_ledger, paid_at,
      payment_plan_hash, payment_plan_xdr, payment_plan_prepared_at,
      publication_status, publication_error_code, updated_at)
      ON mainnet_token_orders TO orrylo_app;
    GRANT SELECT, INSERT, UPDATE (status, ledger_sequence, resolved_at)
      ON mainnet_trustline_attempts TO orrylo_app;
    GRANT SELECT, INSERT, UPDATE (status, signed_envelope_xdr_sha256, updated_at)
      ON mainnet_issuance_attempts TO orrylo_app;
    GRANT SELECT, INSERT ON mainnet_issuance_confirmations TO orrylo_app;
    GRANT SELECT, INSERT, UPDATE (currency_toml, content_hash, revision,
      updated_at, reachable, verified_at, last_verification_at,
      verification_error_code) ON mainnet_metadata_publications TO orrylo_app;
  END IF;
END;
$$;
