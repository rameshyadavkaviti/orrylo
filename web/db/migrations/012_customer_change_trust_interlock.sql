-- Durable, cross-session ChangeTrust interlock for customer Testnet issuance.
-- 012 adds guard evidence only; it does not alter issuer issuance attempts,
-- signer roles, the trustline fee payer, or migrations 001-011.

CREATE TABLE public.project_customer_change_trust_handoffs (
  handoff_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.project_profiles(project_id),
  owner_public_key char(56) NOT NULL
    CHECK (owner_public_key ~ '^G[A-Z2-7]{55}$'),
  network text NOT NULL CHECK (network = 'testnet'),
  asset_code varchar(12) NOT NULL CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  issuer_public_key char(56) NOT NULL
    CHECK (issuer_public_key = 'GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV'),
  destination_public_key char(56) NOT NULL
    CHECK (destination_public_key = owner_public_key),
  amount numeric(30, 7) NOT NULL CHECK (amount > 0),
  transaction_hash char(64) NOT NULL UNIQUE
    CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  unsigned_envelope_xdr text NOT NULL
    CHECK (length(unsigned_envelope_xdr) BETWEEN 1 AND 4096),
  source_sequence numeric(20, 0) NOT NULL CHECK (source_sequence >= 0),
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_change_trust_handoff_hash_unique
    UNIQUE (handoff_id, transaction_hash)
);

CREATE INDEX customer_change_trust_project_history_idx
  ON public.project_customer_change_trust_handoffs
  (project_id, created_at DESC, handoff_id DESC);

-- Append-only terminal reconciliation, written through the same independently
-- provisioned confirmation-writer identity already required for issuer proof.
CREATE TABLE public.project_customer_change_trust_resolutions (
  handoff_id uuid PRIMARY KEY
    REFERENCES public.project_customer_change_trust_handoffs(handoff_id),
  transaction_hash char(64) NOT NULL
    CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  resolution text NOT NULL
    CHECK (resolution IN ('failed', 'expired_not_found')),
  observed_ledger bigint NOT NULL CHECK (observed_ledger > 0),
  observed_ledger_closed_at timestamptz NOT NULL,
  observed_source_sequence numeric(20, 0),
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_change_trust_resolution_exact_hash
    FOREIGN KEY (handoff_id, transaction_hash)
    REFERENCES public.project_customer_change_trust_handoffs
      (handoff_id, transaction_hash),
  CONSTRAINT customer_change_trust_resolution_observation
    CHECK (
      (resolution = 'failed' AND observed_source_sequence IS NULL)
      OR
      (resolution = 'expired_not_found' AND observed_source_sequence IS NOT NULL)
    )
);

CREATE TRIGGER customer_change_trust_handoffs_append_only
  BEFORE UPDATE OR DELETE ON public.project_customer_change_trust_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_issuance_evidence_mutation();

CREATE TRIGGER customer_change_trust_resolutions_append_only
  BEFORE UPDATE OR DELETE ON public.project_customer_change_trust_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_issuance_evidence_mutation();

-- A direct ordinary app SQL connection cannot forge terminal proof, regardless
-- of its ability to read pending records or invoke the reservation gate.
CREATE FUNCTION public.assert_trusted_customer_change_trust_resolution()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  prior public.project_customer_change_trust_handoffs%ROWTYPE;
  writer_is_superuser boolean;
BEGIN
  SELECT role.rolsuper INTO writer_is_superuser
  FROM pg_catalog.pg_roles AS role WHERE role.rolname = session_user;

  IF session_user <> current_user
    OR writer_is_superuser
    OR pg_catalog.pg_get_userbyid(
      (SELECT relowner FROM pg_catalog.pg_class
       WHERE oid = 'public.project_customer_change_trust_resolutions'::regclass)
    ) = session_user
    OR NOT pg_catalog.pg_has_role(
      session_user, 'orrylo_confirmation_writer', 'MEMBER'
    )
  THEN
    RAISE EXCEPTION 'dedicated trusted reconciliation writer required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior
  FROM public.project_customer_change_trust_handoffs
  WHERE handoff_id = NEW.handoff_id;

  IF NOT FOUND OR NEW.transaction_hash <> prior.transaction_hash THEN
    RAISE EXCEPTION 'ChangeTrust hash does not match saved handoff'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution = 'expired_not_found'
     AND (
       NEW.observed_ledger_closed_at <= prior.valid_until
       OR NEW.observed_source_sequence <> prior.source_sequence
     )
  THEN
    RAISE EXCEPTION 'post-expiry non-inclusion and sequence evidence required'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_change_trust_resolution_writer_guard
  BEFORE INSERT ON public.project_customer_change_trust_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_trusted_customer_change_trust_resolution();

-- The only ordinary-app mutation path: a migration-owned transactional gate.
-- Locking the project's row serializes all browser/session GETs. Existing
-- unresolved history wins, even when an incoming request proposes another XDR.
CREATE FUNCTION public.reserve_customer_change_trust_handoff(
  p_handoff_id uuid,
  p_project_id uuid,
  p_owner_public_key char(56),
  p_asset_code varchar(12),
  p_issuer_public_key char(56),
  p_destination_public_key char(56),
  p_amount numeric,
  p_transaction_hash char(64),
  p_unsigned_envelope_xdr text,
  p_source_sequence numeric,
  p_valid_until timestamptz
)
RETURNS TABLE (
  result_handoff_id uuid,
  result_claimed boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  unresolved_id uuid;
BEGIN
  IF session_user <> 'orrylo_app'
    OR NOT EXISTS (
      SELECT 1 FROM public.project_profiles p
      JOIN public.project_profile_owners o ON o.project_id = p.project_id
      WHERE p.project_id = p_project_id
        AND o.owner_public_key = p_owner_public_key
        AND p.asset_code = p_asset_code
        AND p.network = 'testnet'
        AND p.issuer_model = 'shared'
        AND p.issuer_public_key IS NULL
        AND p_owner_public_key = p_destination_public_key
        AND p_issuer_public_key =
          'GBW4IKGPC5Q4YRKGRMNNXTVRZNQZ3DFWFHXSQUAMWLXES75MWTY3TWOV'
    )
  THEN
    RAISE EXCEPTION 'unauthorized Testnet ChangeTrust reservation'
      USING ERRCODE = '42501';
  END IF;

  -- Prevent concurrent signable plans, including when there is no prior row.
  PERFORM p.project_id
    FROM public.project_profiles AS p
    WHERE p.project_id = p_project_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = '42501';
  END IF;

  SELECT h.handoff_id INTO unresolved_id
  FROM public.project_customer_change_trust_handoffs h
  WHERE h.project_id = p_project_id
    AND NOT EXISTS (
      SELECT 1 FROM public.project_customer_change_trust_resolutions r
      WHERE r.handoff_id = h.handoff_id
    )
  ORDER BY h.created_at DESC, h.handoff_id DESC
  LIMIT 1;

  IF unresolved_id IS NOT NULL THEN
    RETURN QUERY SELECT unresolved_id, false;
    RETURN;
  END IF;

  IF p_valid_until <= now() THEN
    RAISE EXCEPTION 'expired Testnet ChangeTrust plan'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.project_customer_change_trust_handoffs(
    handoff_id, project_id, owner_public_key, network, asset_code,
    issuer_public_key, destination_public_key, amount,
    transaction_hash, unsigned_envelope_xdr, source_sequence, valid_until
  ) VALUES (
    p_handoff_id, p_project_id, p_owner_public_key, 'testnet', p_asset_code,
    p_issuer_public_key, p_destination_public_key, p_amount,
    p_transaction_hash, p_unsigned_envelope_xdr, p_source_sequence, p_valid_until
  );

  RETURN QUERY SELECT p_handoff_id, true;
END;
$$;

REVOKE ALL ON public.project_customer_change_trust_handoffs FROM PUBLIC;
REVOKE ALL ON public.project_customer_change_trust_resolutions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_customer_change_trust_handoff(
  uuid, uuid, char(56), varchar(12), char(56), char(56), numeric,
  char(64), text, numeric, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_trusted_customer_change_trust_resolution()
  FROM PUBLIC;

-- Production login may be provisioned after migrations. The application can
-- inspect nonsecret history and invoke ONLY the locked reserve function.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'orrylo_app') THEN
    GRANT SELECT ON public.project_customer_change_trust_handoffs TO orrylo_app;
    GRANT SELECT ON public.project_customer_change_trust_resolutions TO orrylo_app;
    GRANT EXECUTE ON FUNCTION public.reserve_customer_change_trust_handoff(
      uuid, uuid, char(56), varchar(12), char(56), char(56), numeric,
      char(64), text, numeric, timestamptz
    ) TO orrylo_app;
  END IF;
END;
$$;

GRANT SELECT ON public.project_customer_change_trust_handoffs
  TO orrylo_confirmation_writer;
GRANT INSERT, SELECT ON public.project_customer_change_trust_resolutions
  TO orrylo_confirmation_writer;
