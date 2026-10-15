-- Durable one-winner signing-mode ownership for Shared Issuer attempt 1.
-- Existing rows remain valid with NULL signing_mode. New execution must claim
-- exactly one mode before an unsigned envelope can reach any signer.

ALTER TABLE project_issuance_transaction_attempts
  ADD COLUMN signing_mode text,
  ADD CONSTRAINT project_issuance_attempt_signing_mode
    CHECK (
      signing_mode IS NULL
      OR signing_mode IN ('private', 'manual')
    );

-- The application runtime login is provisioned operationally rather than by
-- schema migrations. When the existing production role is present, extend only
-- its already-column-scoped attempt UPDATE authority for the new ownership
-- claim. Do not grant table-wide UPDATE or any unrelated mutation privilege.
DO $
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'orrylo_app'
  ) THEN
    EXECUTE
      'GRANT UPDATE (signing_mode) ON TABLE public.project_issuance_transaction_attempts TO orrylo_app';
  END IF;
END;
$;

CREATE OR REPLACE FUNCTION protect_issuance_transaction_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'issuance evidence is append-only';
  END IF;

  -- First and only signing-mode claim. A mode claim cannot also attach a
  -- signed envelope, and it cannot occur after signed provenance exists.
  IF OLD.signing_mode IS NULL
    AND NEW.signing_mode IN ('private', 'manual')
    AND OLD.signed_envelope_xdr_sha256 IS NULL
    AND NEW.signed_envelope_xdr_sha256 IS NULL
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

  -- After a mode has been claimed, exactly one later NULL -> digest transition
  -- is permitted. The mode itself is immutable.
  IF OLD.signing_mode IS NOT NULL
    AND NEW.signing_mode = OLD.signing_mode
    AND OLD.signed_envelope_xdr_sha256 IS NULL
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
