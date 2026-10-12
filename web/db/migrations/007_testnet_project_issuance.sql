-- Testnet application reservation only; no token issuance or authority activation.
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
  -- Evidence below is NULL until an independently reviewed ledger integration exists.
  issuer_public_key char(56)
    CHECK (issuer_public_key IS NULL OR issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  transaction_hash char(64)
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^[0-9a-f]{64}$'),
  ledger_sequence bigint CHECK (ledger_sequence IS NULL OR ledger_sequence > 0),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_updated_after_created CHECK (updated_at >= created_at),
  CONSTRAINT project_issuance_issuer_evidence_matches CHECK (
    issuer_public_key IS NULL OR issuer_public_key = reservation_issuer_public_key
  ),
  CONSTRAINT project_issuance_confirmed_evidence_check CHECK (
    status <> 'confirmed' OR
    (issuer_public_key IS NOT NULL AND transaction_hash IS NOT NULL AND ledger_sequence IS NOT NULL)
  ),
  CONSTRAINT project_issuance_unavailable_evidence_check CHECK (
    status <> 'awaiting_issuer_integration' OR
    (issuer_public_key IS NULL AND transaction_hash IS NULL
      AND ledger_sequence IS NULL AND failure_code IS NULL)
  ),
  CONSTRAINT project_issuance_submitted_hash_check CHECK (
    status <> 'submitted' OR transaction_hash IS NOT NULL
  ),
  CONSTRAINT project_issuance_unique_asset_code
    UNIQUE (network, reservation_issuer_public_key, asset_code)
);

-- Prevent one wallet from indefinitely squatting multiple unexecuted names.
-- No release/reassignment automation exists in this foundation.
CREATE UNIQUE INDEX project_issuance_one_outstanding_per_wallet
  ON project_issuance_intents (owner_public_key)
  WHERE status <> 'confirmed';

CREATE INDEX project_issuance_status_idx
  ON project_issuance_intents (status, updated_at DESC);

CREATE OR REPLACE FUNCTION prevent_issuance_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.project_id, NEW.request_id, NEW.owner_public_key, NEW.network,
      NEW.reservation_issuer_public_key, NEW.asset_code, NEW.reservation_fingerprint, NEW.created_at)
     IS DISTINCT FROM
     (OLD.project_id, OLD.request_id, OLD.owner_public_key, OLD.network,
      OLD.reservation_issuer_public_key, OLD.asset_code, OLD.reservation_fingerprint, OLD.created_at)
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
