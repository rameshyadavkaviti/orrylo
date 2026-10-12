-- Inert Shared Issuer Testnet persistence contract.
-- This migration reserves asset identity and defines immutable full-intent,
-- transaction-attempt, and ledger-confirmation records. It does not authorize
-- signing, submission, confirmation reads, or metadata publication.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orrylo_confirmation_writer') THEN
    CREATE ROLE orrylo_confirmation_writer NOLOGIN;
  END IF;
END;
$$;

CREATE TABLE project_issuance_intents (
  project_id uuid PRIMARY KEY REFERENCES project_profiles(project_id),
  request_id uuid NOT NULL UNIQUE REFERENCES workflow_intents(request_id),
  owner_public_key char(56) NOT NULL
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$'),
  network text NOT NULL DEFAULT 'testnet' CHECK (network = 'testnet'),
  reservation_issuer_public_key char(56) NOT NULL
    CHECK (reservation_issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  asset_code varchar(12) NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  reservation_fingerprint char(64) NOT NULL
    CHECK (reservation_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'awaiting_issuer_integration'
    CHECK (status IN (
      'awaiting_issuer_integration', 'pending_execution', 'submitted',
      'confirmed', 'failed', 'reconciliation_required'
    )),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_updated_after_created CHECK (updated_at >= created_at),
  CONSTRAINT project_issuance_unique_asset_code
    UNIQUE (network, reservation_issuer_public_key, asset_code),
  CONSTRAINT project_issuance_reservation_identity_unique
    UNIQUE (
      project_id, request_id, owner_public_key, network,
      reservation_issuer_public_key, asset_code, reservation_fingerprint
    )
);

CREATE INDEX project_issuance_status_idx
  ON project_issuance_intents (status, updated_at DESC);

CREATE OR REPLACE FUNCTION prevent_issuance_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.project_id, NEW.request_id, NEW.owner_public_key, NEW.network,
      NEW.reservation_issuer_public_key, NEW.asset_code,
      NEW.reservation_fingerprint, NEW.created_at)
     IS DISTINCT FROM
     (OLD.project_id, OLD.request_id, OLD.owner_public_key, OLD.network,
      OLD.reservation_issuer_public_key, OLD.asset_code,
      OLD.reservation_fingerprint, OLD.created_at)
  THEN
    RAISE EXCEPTION 'immutable issuance reservation identity cannot change';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'awaiting_issuer_integration' AND NEW.status IN ('pending_execution', 'failed'))
    OR (OLD.status = 'pending_execution' AND NEW.status IN ('submitted', 'failed', 'reconciliation_required'))
    OR (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'failed', 'reconciliation_required'))
    OR (OLD.status = 'reconciliation_required' AND NEW.status IN ('submitted', 'confirmed', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'pending_execution')
  ) THEN
    RAISE EXCEPTION 'invalid issuance state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_issuance_immutable
BEFORE UPDATE ON project_issuance_intents
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_identity_mutation();

CREATE OR REPLACE FUNCTION prevent_issuance_workflow_fingerprint_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.workflow_type = 'shared_asset_issuance' AND
    (NEW.workflow_type, NEW.workflow_scope, NEW.idempotency_key,
     NEW.subject_public_key, NEW.policy_version, NEW.payload_hash, NEW.payload)
    IS DISTINCT FROM
    (OLD.workflow_type, OLD.workflow_scope, OLD.idempotency_key,
     OLD.subject_public_key, OLD.policy_version, OLD.payload_hash, OLD.payload)
  THEN
    RAISE EXCEPTION 'immutable issuance workflow fingerprint cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_issuance_workflow_immutable
BEFORE UPDATE ON workflow_intents
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_workflow_fingerprint_mutation();

CREATE OR REPLACE FUNCTION assert_issuance_reservation_workflow_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workflow_intents w
    WHERE w.request_id = NEW.request_id
      AND w.workflow_type = 'shared_asset_issuance'
      AND w.workflow_scope = 'asset:testnet-shared-issuance'
      AND w.subject_public_key = NEW.owner_public_key
      AND w.payload_hash = NEW.reservation_fingerprint
  ) THEN
    RAISE EXCEPTION 'issuance reservation workflow fingerprint mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_issuance_workflow_link
BEFORE INSERT OR UPDATE ON project_issuance_intents
FOR EACH ROW EXECUTE FUNCTION assert_issuance_reservation_workflow_link();

CREATE TABLE project_issuance_full_intents (
  issuance_request_id uuid PRIMARY KEY,
  issuance_intent_fingerprint char(64) NOT NULL
    CHECK (issuance_intent_fingerprint ~ '^[0-9a-f]{64}$'),
  reservation_fingerprint char(64) NOT NULL
    CHECK (reservation_fingerprint ~ '^[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  owner_public_key char(56) NOT NULL
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$'),
  network text NOT NULL CHECK (network = 'testnet'),
  network_passphrase_hash char(64) NOT NULL
    CHECK (network_passphrase_hash = 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472'),
  asset_code varchar(12) NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  issuer_public_key char(56) NOT NULL
    CHECK (issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  destination_public_key char(56) NOT NULL
    CHECK (destination_public_key ~ '^G[A-Z2-7]{55}$'),
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_full_intent_identity_unique
    UNIQUE (issuance_request_id, issuance_intent_fingerprint),
  CONSTRAINT project_issuance_full_intent_reservation_fk
    FOREIGN KEY (
      project_id, issuance_request_id, owner_public_key, network,
      issuer_public_key, asset_code, reservation_fingerprint
    ) REFERENCES project_issuance_intents (
      project_id, request_id, owner_public_key, network,
      reservation_issuer_public_key, asset_code, reservation_fingerprint
    ),
  CONSTRAINT project_issuance_distinct_destination
    CHECK (destination_public_key <> issuer_public_key)
);

CREATE TABLE project_issuance_transaction_attempts (
  attempt_id uuid PRIMARY KEY,
  issuance_request_id uuid NOT NULL,
  issuance_intent_fingerprint char(64) NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  transaction_hash char(64) NOT NULL
    CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  envelope_xdr_sha256 char(64) NOT NULL
    CHECK (envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence > 0),
  fee_stroops bigint NOT NULL CHECK (fee_stroops > 0),
  valid_from bigint NOT NULL CHECK (valid_from >= 0),
  valid_until bigint NOT NULL CHECK (valid_until > valid_from),
  transaction_source_public_key char(56) NOT NULL
    CHECK (transaction_source_public_key ~ '^G[A-Z2-7]{55}$'),
  operation_count integer NOT NULL CHECK (operation_count = 1),
  operation_type text NOT NULL CHECK (operation_type = 'payment'),
  operation_source_public_key char(56) NOT NULL
    CHECK (operation_source_public_key ~ '^G[A-Z2-7]{55}$'),
  asset_code varchar(12) NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  issuer_public_key char(56) NOT NULL
    CHECK (issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  destination_public_key char(56) NOT NULL
    CHECK (destination_public_key ~ '^G[A-Z2-7]{55}$'),
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_attempt_intent_fk
    FOREIGN KEY (issuance_request_id, issuance_intent_fingerprint)
    REFERENCES project_issuance_full_intents (
      issuance_request_id, issuance_intent_fingerprint
    ),
  CONSTRAINT project_issuance_attempt_number_unique
    UNIQUE (issuance_request_id, attempt_number),
  CONSTRAINT project_issuance_attempt_hash_unique UNIQUE (transaction_hash),
  CONSTRAINT project_issuance_attempt_confirmation_identity_unique
    UNIQUE (
      attempt_id, issuance_request_id, issuance_intent_fingerprint,
      transaction_hash
    ),
  CONSTRAINT project_issuance_attempt_source_match
    CHECK (
      transaction_source_public_key = issuer_public_key
      AND operation_source_public_key = issuer_public_key
    )
);

CREATE OR REPLACE FUNCTION assert_issuance_attempt_matches_intent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM project_issuance_full_intents i
    WHERE i.issuance_request_id = NEW.issuance_request_id
      AND i.issuance_intent_fingerprint = NEW.issuance_intent_fingerprint
      AND i.asset_code = NEW.asset_code
      AND i.issuer_public_key = NEW.issuer_public_key
      AND i.destination_public_key = NEW.destination_public_key
      AND i.amount = NEW.amount
  ) THEN
    RAISE EXCEPTION 'transaction attempt does not match immutable issuance intent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_issuance_attempt_matches_intent
BEFORE INSERT ON project_issuance_transaction_attempts
FOR EACH ROW EXECUTE FUNCTION assert_issuance_attempt_matches_intent();

CREATE TABLE project_issuance_ledger_confirmations (
  confirmation_id uuid PRIMARY KEY,
  issuance_request_id uuid NOT NULL,
  issuance_intent_fingerprint char(64) NOT NULL,
  attempt_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_public_key char(56) NOT NULL
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$'),
  network text NOT NULL CHECK (network = 'testnet'),
  network_passphrase_hash char(64) NOT NULL
    CHECK (network_passphrase_hash = 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472'),
  transaction_hash char(64) NOT NULL
    CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  envelope_xdr_sha256 char(64) NOT NULL
    CHECK (envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  result_xdr_sha256 char(64) NOT NULL
    CHECK (result_xdr_sha256 ~ '^[0-9a-f]{64}$'),
  result_success boolean NOT NULL CHECK (result_success),
  ledger_sequence bigint NOT NULL CHECK (ledger_sequence > 0),
  ledger_closed_at timestamptz NOT NULL,
  transaction_source_public_key char(56) NOT NULL,
  operation_count integer NOT NULL CHECK (operation_count = 1),
  operation_type text NOT NULL CHECK (operation_type = 'payment'),
  operation_source_public_key char(56) NOT NULL,
  asset_code varchar(12) NOT NULL,
  issuer_public_key char(56) NOT NULL,
  destination_public_key char(56) NOT NULL,
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence > 0),
  verifier_identity text NOT NULL CHECK (char_length(verifier_identity) > 0),
  verification_policy_version text NOT NULL
    CHECK (char_length(verification_policy_version) > 0),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_confirmation_intent_fk
    FOREIGN KEY (issuance_request_id, issuance_intent_fingerprint)
    REFERENCES project_issuance_full_intents (
      issuance_request_id, issuance_intent_fingerprint
    ),
  CONSTRAINT project_issuance_confirmation_attempt_fk
    FOREIGN KEY (
      attempt_id, issuance_request_id, issuance_intent_fingerprint,
      transaction_hash
    ) REFERENCES project_issuance_transaction_attempts (
      attempt_id, issuance_request_id, issuance_intent_fingerprint,
      transaction_hash
    ),
  CONSTRAINT project_issuance_confirmation_provenance_unique
    UNIQUE (confirmation_id, issuance_request_id, issuance_intent_fingerprint),
  CONSTRAINT project_issuance_confirmation_request_unique
    UNIQUE (issuance_request_id),
  CONSTRAINT project_issuance_confirmation_transaction_unique
    UNIQUE (transaction_hash),
  CONSTRAINT project_issuance_confirmation_time_order
    CHECK (verified_at >= ledger_closed_at AND created_at >= verified_at)
);

CREATE OR REPLACE FUNCTION assert_trusted_confirmation_writer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_has_role(current_user, 'orrylo_confirmation_writer', 'MEMBER') THEN
    RAISE EXCEPTION 'trusted confirmation writer role required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM project_issuance_full_intents i
    JOIN project_issuance_transaction_attempts a
      ON a.attempt_id = NEW.attempt_id
     AND a.issuance_request_id = i.issuance_request_id
     AND a.issuance_intent_fingerprint = i.issuance_intent_fingerprint
    WHERE i.issuance_request_id = NEW.issuance_request_id
      AND i.issuance_intent_fingerprint = NEW.issuance_intent_fingerprint
      AND i.project_id = NEW.project_id
      AND i.owner_public_key = NEW.owner_public_key
      AND i.network = NEW.network
      AND i.network_passphrase_hash = NEW.network_passphrase_hash
      AND i.asset_code = NEW.asset_code
      AND i.issuer_public_key = NEW.issuer_public_key
      AND i.destination_public_key = NEW.destination_public_key
      AND i.amount = NEW.amount
      AND a.transaction_hash = NEW.transaction_hash
      AND a.envelope_xdr_sha256 = NEW.envelope_xdr_sha256
      AND a.source_sequence = NEW.source_sequence
      AND a.transaction_source_public_key = NEW.transaction_source_public_key
      AND a.operation_count = NEW.operation_count
      AND a.operation_type = NEW.operation_type
      AND a.operation_source_public_key = NEW.operation_source_public_key
      AND a.asset_code = NEW.asset_code
      AND a.issuer_public_key = NEW.issuer_public_key
      AND a.destination_public_key = NEW.destination_public_key
      AND a.amount = NEW.amount
  ) THEN
    RAISE EXCEPTION 'ledger confirmation does not match immutable intent and attempt';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_issuance_confirmation_trusted_writer
BEFORE INSERT ON project_issuance_ledger_confirmations
FOR EACH ROW EXECUTE FUNCTION assert_trusted_confirmation_writer();

CREATE OR REPLACE FUNCTION prevent_issuance_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issuance evidence is append-only';
END;
$$;

CREATE TRIGGER project_issuance_full_intents_append_only
BEFORE UPDATE OR DELETE ON project_issuance_full_intents
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_evidence_mutation();

CREATE TRIGGER project_issuance_transaction_attempts_append_only
BEFORE UPDATE OR DELETE ON project_issuance_transaction_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_evidence_mutation();

CREATE TRIGGER project_issuance_ledger_confirmations_append_only
BEFORE UPDATE OR DELETE ON project_issuance_ledger_confirmations
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_evidence_mutation();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON project_issuance_ledger_confirmations FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO orrylo_confirmation_writer;
GRANT SELECT ON project_issuance_full_intents,
  project_issuance_transaction_attempts
  TO orrylo_confirmation_writer;
GRANT INSERT, SELECT ON project_issuance_ledger_confirmations
  TO orrylo_confirmation_writer;

-- Migration 006 may already contain rows created against the superseded
-- reservation/status model. Retain them for audit, but make every such row
-- unreachable until it is rebound to immutable confirmation provenance.
ALTER TABLE project_metadata_publications
  ADD COLUMN confirmation_id uuid;

UPDATE project_metadata_publications
SET reachable = false,
    verified_at = NULL,
    last_verification_at = now(),
    verification_error_code = 'confirmation_contract_unavailable',
    updated_at = GREATEST(updated_at, now());

ALTER TABLE project_metadata_publications
  ADD CONSTRAINT project_metadata_publications_confirmation_fk
  FOREIGN KEY (confirmation_id, issuance_request_id, issuance_fingerprint)
  REFERENCES project_issuance_ledger_confirmations (
    confirmation_id, issuance_request_id, issuance_intent_fingerprint
  ),
  ADD CONSTRAINT project_metadata_publications_confirmation_unique
  UNIQUE (confirmation_id),
  ADD CONSTRAINT project_metadata_publications_confirmation_required
  CHECK (confirmation_id IS NOT NULL OR reachable = false);
