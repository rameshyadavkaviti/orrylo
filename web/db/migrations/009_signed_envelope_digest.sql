-- Bind ledger confirmation evidence to the exact decorated envelope submitted.
-- The signed digest has one permitted transition (NULL -> digest) before
-- submission; every other attempt field remains immutable.

ALTER TABLE project_issuance_transaction_attempts
  ADD COLUMN signed_envelope_xdr_sha256 char(64),
  ADD CONSTRAINT project_issuance_attempt_signed_envelope_hash
    CHECK (
      signed_envelope_xdr_sha256 IS NULL
      OR signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE project_issuance_ledger_confirmations
  ADD COLUMN signed_envelope_xdr_sha256 char(64),
  ADD CONSTRAINT project_issuance_confirmation_signed_envelope_hash
    CHECK (
      signed_envelope_xdr_sha256 IS NULL
      OR signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'
    );

-- Any draft-008 confirmation predates the signed-envelope binding and cannot
-- continue authorizing a reachable metadata publication after this upgrade.
UPDATE project_metadata_publications AS publication
SET reachable = false,
    verified_at = NULL,
    last_verification_at = now(),
    verification_error_code = 'signed_envelope_provenance_required',
    updated_at = GREATEST(publication.updated_at, now())
FROM project_issuance_ledger_confirmations AS confirmation
WHERE publication.confirmation_id = confirmation.confirmation_id
  AND confirmation.signed_envelope_xdr_sha256 IS NULL;

DROP TRIGGER project_issuance_transaction_attempts_append_only
  ON project_issuance_transaction_attempts;

CREATE OR REPLACE FUNCTION protect_issuance_transaction_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'issuance evidence is append-only';
  END IF;

  IF OLD.signed_envelope_xdr_sha256 IS NULL
    AND NEW.signed_envelope_xdr_sha256 IS NOT NULL
    AND NEW.attempt_id = OLD.attempt_id
    AND NEW.issuance_request_id = OLD.issuance_request_id
    AND NEW.issuance_intent_fingerprint = OLD.issuance_intent_fingerprint
    AND NEW.attempt_number = OLD.attempt_number
    AND NEW.transaction_hash = OLD.transaction_hash
    AND NEW.envelope_xdr_sha256 = OLD.envelope_xdr_sha256
    AND NEW.source_sequence = OLD.source_sequence
    AND NEW.fee_stroops = OLD.fee_stroops
    AND NEW.valid_from = OLD.valid_from
    AND NEW.valid_until = OLD.valid_until
    AND NEW.transaction_source_public_key = OLD.transaction_source_public_key
    AND NEW.operation_count = OLD.operation_count
    AND NEW.operation_type = OLD.operation_type
    AND NEW.operation_source_public_key = OLD.operation_source_public_key
    AND NEW.asset_code = OLD.asset_code
    AND NEW.issuer_public_key = OLD.issuer_public_key
    AND NEW.destination_public_key = OLD.destination_public_key
    AND NEW.amount = OLD.amount
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'issuance evidence is append-only';
END;
$$;

CREATE TRIGGER project_issuance_transaction_attempts_append_only
BEFORE UPDATE OR DELETE ON project_issuance_transaction_attempts
FOR EACH ROW EXECUTE FUNCTION protect_issuance_transaction_attempt();

CREATE OR REPLACE FUNCTION assert_trusted_confirmation_writer()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  login_is_superuser boolean;
  login_owns_confirmation_table boolean;
  login_owns_enforcement_function boolean;
BEGIN
  SELECT role.rolsuper
  INTO login_is_superuser
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = session_user;

  SELECT pg_get_userbyid(relation.relowner) = session_user
  INTO login_owns_confirmation_table
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid = 'project_issuance_ledger_confirmations'::regclass;

  SELECT pg_get_userbyid(procedure.proowner) = session_user
  INTO login_owns_enforcement_function
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = current_schema()
    AND procedure.proname = 'assert_trusted_confirmation_writer'
  LIMIT 1;

  IF session_user <> current_user
    OR login_is_superuser
    OR login_owns_confirmation_table
    OR login_owns_enforcement_function
    OR NOT pg_has_role(session_user, 'orrylo_confirmation_writer', 'MEMBER')
  THEN
    RAISE EXCEPTION 'dedicated trusted confirmation writer login required'
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
      AND a.signed_envelope_xdr_sha256 = NEW.signed_envelope_xdr_sha256
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

