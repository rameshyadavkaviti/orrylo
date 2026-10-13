-- Final MVP Lite database hardening for Gate A.
-- This migration is additive: migrations 001-009 remain immutable.

-- MVP Lite permits exactly one immutable transaction attempt. Enforce this in
-- PostgreSQL so an authorized application identity cannot bypass repository
-- validation with a direct INSERT.
ALTER TABLE project_issuance_transaction_attempts
  ADD CONSTRAINT project_issuance_attempt_number_mvp_lite
  CHECK (attempt_number = 1) NOT VALID;

-- Migration 009 created the trusted confirmation trigger before the dedicated
-- writer identity existed. Pin it to real public evidence so a writer retaining
-- PostgreSQL TEMP privilege cannot shadow immutable intent/attempt relations.
CREATE OR REPLACE FUNCTION assert_trusted_confirmation_writer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  login_is_superuser boolean;
  login_owns_confirmation_table boolean;
  login_owns_enforcement_function boolean;
BEGIN
  SELECT role.rolsuper
  INTO login_is_superuser
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = session_user;

  SELECT pg_catalog.pg_get_userbyid(relation.relowner) = session_user
  INTO login_owns_confirmation_table
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid =
    'public.project_issuance_ledger_confirmations'::pg_catalog.regclass;

  SELECT pg_catalog.pg_get_userbyid(procedure.proowner) = session_user
  INTO login_owns_enforcement_function
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'assert_trusted_confirmation_writer'
  LIMIT 1;

  IF session_user <> current_user
    OR login_is_superuser
    OR login_owns_confirmation_table
    OR login_owns_enforcement_function
    OR NOT pg_catalog.pg_has_role(
      session_user,
      'orrylo_confirmation_writer',
      'MEMBER'
    )
  THEN
    RAISE EXCEPTION 'dedicated trusted confirmation writer login required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project_issuance_full_intents AS intent
    JOIN public.project_issuance_transaction_attempts AS attempt
      ON attempt.attempt_id = NEW.attempt_id
     AND attempt.issuance_request_id = intent.issuance_request_id
     AND attempt.issuance_intent_fingerprint =
       intent.issuance_intent_fingerprint
    WHERE intent.issuance_request_id = NEW.issuance_request_id
      AND intent.issuance_intent_fingerprint = NEW.issuance_intent_fingerprint
      AND intent.project_id = NEW.project_id
      AND intent.owner_public_key = NEW.owner_public_key
      AND intent.network = NEW.network
      AND intent.network_passphrase_hash = NEW.network_passphrase_hash
      AND intent.asset_code = NEW.asset_code
      AND intent.issuer_public_key = NEW.issuer_public_key
      AND intent.destination_public_key = NEW.destination_public_key
      AND intent.amount = NEW.amount
      AND attempt.transaction_hash = NEW.transaction_hash
      AND attempt.envelope_xdr_sha256 = NEW.envelope_xdr_sha256
      AND attempt.signed_envelope_xdr_sha256 = NEW.signed_envelope_xdr_sha256
      AND attempt.source_sequence = NEW.source_sequence
      AND attempt.transaction_source_public_key =
        NEW.transaction_source_public_key
      AND attempt.operation_count = NEW.operation_count
      AND attempt.operation_type = NEW.operation_type
      AND attempt.operation_source_public_key =
        NEW.operation_source_public_key
      AND attempt.asset_code = NEW.asset_code
      AND attempt.issuer_public_key = NEW.issuer_public_key
      AND attempt.destination_public_key = NEW.destination_public_key
      AND attempt.amount = NEW.amount
  ) THEN
    RAISE EXCEPTION 'ledger confirmation does not match immutable intent and attempt';
  END IF;

  RETURN NEW;
END;
$function$;

-- Metadata may become reachable only when its exact immutable confirmation is
-- post-009 evidence bound to a decorated signed envelope. SECURITY DEFINER is
-- used solely so the trigger can inspect the protected confirmation table
-- without granting the ordinary application role additional read authority.
CREATE OR REPLACE FUNCTION assert_metadata_reachability_signed_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.reachable THEN
    IF NEW.confirmation_id IS NULL
      OR NEW.owner_public_key IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.project_issuance_ledger_confirmations AS confirmation
        WHERE confirmation.confirmation_id = NEW.confirmation_id
          AND confirmation.project_id = NEW.project_id
          AND confirmation.owner_public_key = NEW.owner_public_key
          AND confirmation.issuance_request_id = NEW.issuance_request_id
          AND confirmation.issuance_intent_fingerprint =
            NEW.issuance_fingerprint
          AND confirmation.network = NEW.network
          AND confirmation.asset_code = NEW.asset_code
          AND confirmation.issuer_public_key = NEW.issuer_public_key
          AND confirmation.signed_envelope_xdr_sha256 IS NOT NULL
          AND confirmation.signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'
      )
    THEN
      RAISE EXCEPTION
        'reachable metadata requires signed-envelope-bound immutable confirmation'
        USING ERRCODE = '23514',
          CONSTRAINT =
            'project_metadata_publications_signed_confirmation_required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
  ON FUNCTION assert_metadata_reachability_signed_confirmation()
  FROM PUBLIC;

-- Repair any row that may have been made reachable in the gap between
-- migrations 009 and 010. After this statement and the trigger below, the
-- invariant is true for both existing and future rows.
UPDATE project_metadata_publications AS publication
SET reachable = false,
    verified_at = NULL,
    last_verification_at = now(),
    verification_error_code = 'signed_envelope_provenance_required',
    updated_at = GREATEST(publication.updated_at, now())
WHERE publication.reachable = true
  AND NOT EXISTS (
    SELECT 1
    FROM project_issuance_ledger_confirmations AS confirmation
    WHERE confirmation.confirmation_id = publication.confirmation_id
      AND confirmation.project_id = publication.project_id
      AND confirmation.owner_public_key = publication.owner_public_key
      AND confirmation.issuance_request_id = publication.issuance_request_id
      AND confirmation.issuance_intent_fingerprint =
        publication.issuance_fingerprint
      AND confirmation.network = publication.network
      AND confirmation.asset_code = publication.asset_code
      AND confirmation.issuer_public_key = publication.issuer_public_key
      AND confirmation.signed_envelope_xdr_sha256 IS NOT NULL
      AND confirmation.signed_envelope_xdr_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE TRIGGER project_metadata_publications_signed_confirmation_guard
BEFORE INSERT OR UPDATE ON project_metadata_publications
FOR EACH ROW
EXECUTE FUNCTION assert_metadata_reachability_signed_confirmation();
