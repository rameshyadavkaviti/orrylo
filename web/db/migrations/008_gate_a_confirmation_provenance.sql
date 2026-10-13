-- Gate A hardening for the migration-007 issuance contract.
-- Existing rows remain fail-closed; no login receives an application or
-- confirmation-writer role in this migration.

ALTER TABLE project_issuance_ledger_confirmations
  ADD CONSTRAINT project_issuance_confirmation_publication_identity_unique
  UNIQUE (
    confirmation_id,
    project_id,
    owner_public_key,
    issuance_request_id,
    issuance_intent_fingerprint
  );

ALTER TABLE project_metadata_publications
  ADD COLUMN owner_public_key char(56)
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$');

UPDATE project_metadata_publications AS publication
SET owner_public_key = confirmation.owner_public_key
FROM project_issuance_ledger_confirmations AS confirmation
WHERE publication.confirmation_id = confirmation.confirmation_id
  AND publication.project_id = confirmation.project_id
  AND publication.issuance_request_id = confirmation.issuance_request_id
  AND publication.issuance_fingerprint =
    confirmation.issuance_intent_fingerprint;

ALTER TABLE project_metadata_publications
  ADD CONSTRAINT project_metadata_publications_confirmation_scope_fk
  FOREIGN KEY (
    confirmation_id,
    project_id,
    owner_public_key,
    issuance_request_id,
    issuance_fingerprint
  ) REFERENCES project_issuance_ledger_confirmations (
    confirmation_id,
    project_id,
    owner_public_key,
    issuance_request_id,
    issuance_intent_fingerprint
  ),
  ADD CONSTRAINT project_metadata_publications_owner_required
  CHECK (owner_public_key IS NOT NULL OR reachable = false);

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
