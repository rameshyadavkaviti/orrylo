-- Final MVP Lite database hardening for Gate A.
-- This migration is additive: migrations 001-009 remain immutable.

-- MVP Lite permits exactly one immutable transaction attempt. Enforce this in
-- PostgreSQL so an authorized application identity cannot bypass repository
-- validation with a direct INSERT.
ALTER TABLE project_issuance_transaction_attempts
  ADD CONSTRAINT project_issuance_attempt_number_mvp_lite
  CHECK (attempt_number = 1) NOT VALID;

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
