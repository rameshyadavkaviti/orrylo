-- Exact owner-authorized bounded recovery for the expired TEST8926 attempt.
-- This migration permits at most one successor transaction (attempt 2) for the
-- same immutable issuance intent. It does not construct, sign, or submit it.

CREATE TABLE project_issuance_recovery_authorizations (
  issuance_request_id uuid NOT NULL,
  project_id uuid NOT NULL,
  owner_public_key char(56) NOT NULL
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$'),
  superseded_attempt_id uuid NOT NULL,
  superseded_transaction_hash char(64) NOT NULL
    CHECK (superseded_transaction_hash ~ '^[0-9a-f]{64}$'),
  next_attempt_number integer NOT NULL CHECK (next_attempt_number = 2),
  network text NOT NULL CHECK (network = 'testnet'),
  issuer_public_key char(56) NOT NULL
    CHECK (issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  destination_public_key char(56) NOT NULL
    CHECK (destination_public_key ~ '^G[A-Z2-7]{55}$'),
  asset_code varchar(12) NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  authorization_policy_version text NOT NULL,
  authorized_at timestamptz NOT NULL,
  PRIMARY KEY (issuance_request_id, superseded_attempt_id),
  UNIQUE (issuance_request_id, next_attempt_number)
);

INSERT INTO project_issuance_recovery_authorizations (
  issuance_request_id, project_id, owner_public_key,
  superseded_attempt_id, superseded_transaction_hash,
  next_attempt_number, network, issuer_public_key,
  destination_public_key, asset_code, amount,
  authorization_policy_version, authorized_at
) VALUES (
  'cda25e25-322b-46fa-9081-fe4c382b5614',
  'cabb5cec-0140-4d7f-93a5-d37d7b7a5f13',
  'GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB',
  '96708101-1afc-4897-b141-fa6839fe6307',
  '478da69fea287435c93ae284dad2d0de90993c2f92dd758f5f706f77f0eac124',
  2,
  'testnet',
  'GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV',
  'GBJIM6BH2WYV3BLAFR4F6KW6Y7XZV36FBXZFICMWQ5Y7DVL4RGV2CYPB',
  'TEST8926',
  991100.0000000,
  'test8926-owner-bounded-recovery-v1',
  '2026-10-16T07:12:00Z'
);

CREATE TABLE project_issuance_recovery_evidence (
  issuance_request_id uuid NOT NULL,
  superseded_attempt_id uuid NOT NULL,
  issuance_intent_fingerprint char(64) NOT NULL
    CHECK (issuance_intent_fingerprint ~ '^[0-9a-f]{64}$'),
  superseded_transaction_hash char(64) NOT NULL
    CHECK (superseded_transaction_hash ~ '^[0-9a-f]{64}$'),
  network text NOT NULL CHECK (network = 'testnet'),
  lookup_status text NOT NULL CHECK (lookup_status = 'not_found'),
  lookup_observed_ledger bigint NOT NULL CHECK (lookup_observed_ledger > 0),
  lookup_observed_ledger_closed_at timestamptz NOT NULL,
  sequence_observed_ledger bigint NOT NULL CHECK (sequence_observed_ledger > 0),
  sequence_observed_ledger_closed_at timestamptz NOT NULL,
  issuer_public_key char(56) NOT NULL
    CHECK (issuer_public_key ~ '^G[A-Z2-7]{55}$'),
  issuer_sequence numeric(20, 0) NOT NULL CHECK (issuer_sequence >= 0),
  verifier_identity text NOT NULL CHECK (char_length(verifier_identity) > 0),
  verification_policy_version text NOT NULL
    CHECK (char_length(verification_policy_version) > 0),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (issuance_request_id, superseded_attempt_id),
  UNIQUE (superseded_transaction_hash),
  CHECK (sequence_observed_ledger >= lookup_observed_ledger),
  CHECK (
    verified_at >= lookup_observed_ledger_closed_at
    AND verified_at >= sequence_observed_ledger_closed_at
  )
);

CREATE OR REPLACE FUNCTION assert_trusted_recovery_evidence_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  login_is_superuser boolean;
  login_owns_evidence_table boolean;
  login_owns_enforcement_function boolean;
BEGIN
  SELECT role.rolsuper
  INTO login_is_superuser
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = session_user;

  SELECT pg_catalog.pg_get_userbyid(relation.relowner) = session_user
  INTO login_owns_evidence_table
  FROM pg_catalog.pg_class AS relation
  WHERE relation.oid =
    'public.project_issuance_recovery_evidence'::pg_catalog.regclass;

  SELECT pg_catalog.pg_get_userbyid(procedure.proowner) = session_user
  INTO login_owns_enforcement_function
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'assert_trusted_recovery_evidence_writer'
  LIMIT 1;

  IF login_is_superuser
    OR login_owns_evidence_table
    OR login_owns_enforcement_function
    OR NOT pg_catalog.pg_has_role(
      session_user,
      'orrylo_confirmation_writer',
      'MEMBER'
    )
  THEN
    RAISE EXCEPTION 'dedicated trusted recovery evidence writer login required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project_issuance_recovery_authorizations AS authorization
    JOIN public.project_issuance_full_intents AS intent
      ON intent.issuance_request_id = authorization.issuance_request_id
    JOIN public.project_issuance_transaction_attempts AS attempt
      ON attempt.attempt_id = authorization.superseded_attempt_id
     AND attempt.issuance_request_id = authorization.issuance_request_id
     AND attempt.issuance_intent_fingerprint =
       intent.issuance_intent_fingerprint
    WHERE authorization.issuance_request_id = NEW.issuance_request_id
      AND authorization.superseded_attempt_id = NEW.superseded_attempt_id
      AND authorization.superseded_transaction_hash =
        NEW.superseded_transaction_hash
      AND authorization.next_attempt_number = 2
      AND authorization.project_id = intent.project_id
      AND authorization.owner_public_key = intent.owner_public_key
      AND authorization.network = intent.network
      AND authorization.issuer_public_key = intent.issuer_public_key
      AND authorization.destination_public_key = intent.destination_public_key
      AND authorization.asset_code = intent.asset_code
      AND authorization.amount = intent.amount
      AND attempt.attempt_number = 1
      AND attempt.transaction_hash = NEW.superseded_transaction_hash
      AND attempt.signing_mode = 'manual'
      AND attempt.signed_envelope_xdr_sha256 IS NULL
      AND NEW.issuance_intent_fingerprint =
        intent.issuance_intent_fingerprint
      AND NEW.network = 'testnet'
      AND NEW.lookup_status = 'not_found'
      AND NEW.issuer_public_key = intent.issuer_public_key
      AND NEW.issuer_sequence = attempt.source_sequence
      AND NEW.lookup_observed_ledger_closed_at >
        to_timestamp(attempt.valid_until)
      AND NEW.sequence_observed_ledger_closed_at >
        to_timestamp(attempt.valid_until)
      AND NOT EXISTS (
        SELECT 1
        FROM public.project_issuance_ledger_confirmations AS confirmation
        WHERE confirmation.issuance_request_id = authorization.issuance_request_id
      )
  ) THEN
    RAISE EXCEPTION 'recovery evidence does not satisfy the exact owner-authorized expired attempt'
      USING ERRCODE = '23514',
        CONSTRAINT = 'project_issuance_recovery_evidence_exact';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
  ON FUNCTION assert_trusted_recovery_evidence_writer()
  FROM PUBLIC;

CREATE TRIGGER project_issuance_recovery_evidence_trusted_writer
BEFORE INSERT ON project_issuance_recovery_evidence
FOR EACH ROW
EXECUTE FUNCTION assert_trusted_recovery_evidence_writer();

CREATE TRIGGER project_issuance_recovery_authorizations_append_only
BEFORE UPDATE OR DELETE ON project_issuance_recovery_authorizations
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_evidence_mutation();

CREATE TRIGGER project_issuance_recovery_evidence_append_only
BEFORE UPDATE OR DELETE ON project_issuance_recovery_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_issuance_evidence_mutation();

ALTER TABLE project_issuance_transaction_attempts
  DROP CONSTRAINT project_issuance_attempt_number_mvp_lite,
  ADD CONSTRAINT project_issuance_attempt_number_bounded_recovery
    CHECK (attempt_number IN (1, 2)) NOT VALID,
  ADD CONSTRAINT project_issuance_attempt_2_manual_mode
    CHECK (
      attempt_number <> 2
      OR signing_mode IS NULL
      OR signing_mode = 'manual'
    ) NOT VALID;

CREATE OR REPLACE FUNCTION assert_bounded_recovery_attempt_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.attempt_number = 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.attempt_number <> 2 THEN
    RAISE EXCEPTION 'only bounded recovery attempt 2 is permitted'
      USING ERRCODE = '23514',
        CONSTRAINT = 'project_issuance_attempt_number_bounded_recovery';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project_issuance_recovery_authorizations AS authorization
    JOIN public.project_issuance_recovery_evidence AS evidence
      ON evidence.issuance_request_id = authorization.issuance_request_id
     AND evidence.superseded_attempt_id = authorization.superseded_attempt_id
     AND evidence.superseded_transaction_hash =
       authorization.superseded_transaction_hash
    JOIN public.project_issuance_full_intents AS intent
      ON intent.issuance_request_id = authorization.issuance_request_id
    JOIN public.project_issuance_transaction_attempts AS previous
      ON previous.attempt_id = authorization.superseded_attempt_id
     AND previous.issuance_request_id = authorization.issuance_request_id
     AND previous.issuance_intent_fingerprint =
       intent.issuance_intent_fingerprint
    WHERE authorization.issuance_request_id = NEW.issuance_request_id
      AND authorization.next_attempt_number = 2
      AND authorization.project_id = intent.project_id
      AND authorization.owner_public_key = intent.owner_public_key
      AND authorization.network = intent.network
      AND authorization.issuer_public_key = intent.issuer_public_key
      AND authorization.destination_public_key = intent.destination_public_key
      AND authorization.asset_code = intent.asset_code
      AND authorization.amount = intent.amount
      AND previous.attempt_number = 1
      AND previous.signing_mode = 'manual'
      AND previous.signed_envelope_xdr_sha256 IS NULL
      AND previous.transaction_hash =
        authorization.superseded_transaction_hash
      AND evidence.issuance_intent_fingerprint =
        intent.issuance_intent_fingerprint
      AND evidence.lookup_status = 'not_found'
      AND evidence.issuer_public_key = intent.issuer_public_key
      AND evidence.issuer_sequence = previous.source_sequence
      AND evidence.lookup_observed_ledger_closed_at >
        to_timestamp(previous.valid_until)
      AND evidence.sequence_observed_ledger_closed_at >
        to_timestamp(previous.valid_until)
      AND NEW.issuance_intent_fingerprint =
        intent.issuance_intent_fingerprint
      AND NEW.transaction_source_public_key = intent.issuer_public_key
      AND NEW.operation_source_public_key = intent.issuer_public_key
      AND NEW.asset_code = intent.asset_code
      AND NEW.issuer_public_key = intent.issuer_public_key
      AND NEW.destination_public_key = intent.destination_public_key
      AND NEW.amount = intent.amount
      AND NEW.source_sequence = evidence.issuer_sequence
      AND NEW.valid_from > previous.valid_until
      AND NEW.created_at >= evidence.verified_at
      AND NEW.attempt_id <> previous.attempt_id
      AND NEW.transaction_hash <> previous.transaction_hash
      AND NEW.envelope_xdr_sha256 <> previous.envelope_xdr_sha256
      AND NEW.signing_mode IS NULL
      AND NEW.signed_envelope_xdr_sha256 IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.project_issuance_ledger_confirmations AS confirmation
        WHERE confirmation.issuance_request_id = authorization.issuance_request_id
      )
  ) THEN
    RAISE EXCEPTION 'bounded recovery attempt lacks protected authorization or authoritative evidence'
      USING ERRCODE = '23514',
        CONSTRAINT = 'project_issuance_bounded_recovery_gate';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
  ON FUNCTION assert_bounded_recovery_attempt_insert()
  FROM PUBLIC;

CREATE TRIGGER project_issuance_bounded_recovery_attempt_insert
BEFORE INSERT ON project_issuance_transaction_attempts
FOR EACH ROW
EXECUTE FUNCTION assert_bounded_recovery_attempt_insert();

REVOKE ALL
  ON project_issuance_recovery_authorizations,
     project_issuance_recovery_evidence
  FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'orrylo_app'
  ) THEN
    EXECUTE
      'REVOKE ALL ON TABLE public.project_issuance_recovery_authorizations, public.project_issuance_recovery_evidence FROM orrylo_app';
  END IF;
END;
$acl$;

GRANT SELECT, INSERT
  ON project_issuance_recovery_evidence
  TO orrylo_confirmation_writer;
