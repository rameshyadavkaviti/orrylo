-- Testnet Shared Issuer application intent only. No signer, transaction, or on-chain execution.
CREATE TABLE project_issuance_intents (
  project_id uuid PRIMARY KEY REFERENCES project_profiles(project_id),
  request_id uuid NOT NULL UNIQUE REFERENCES workflow_intents(request_id),
  network text NOT NULL CHECK (network = 'testnet'),
  asset_code varchar(12) NOT NULL
    CHECK (asset_code ~ '^[A-Z0-9]{1,12}$'),
  status text NOT NULL DEFAULT 'awaiting_issuer_integration'
    CHECK (status IN (
      'awaiting_issuer_integration', 'pending_execution', 'submitted',
      'confirmed', 'failed', 'reconciliation_required'
    )),
  issuer_public_key char(56)
    CHECK (
      issuer_public_key IS NULL OR
      (issuer_public_key = upper(issuer_public_key)
        AND issuer_public_key ~ '^G[A-Z2-7]{55}$')
    ),
  transaction_hash char(64)
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^[0-9a-f]{64}$'),
  ledger_sequence bigint CHECK (ledger_sequence IS NULL OR ledger_sequence > 0),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_issuance_updated_after_created
    CHECK (updated_at >= created_at),
  CONSTRAINT project_issuance_confirmed_evidence_check
    CHECK (
      status <> 'confirmed' OR
      (issuer_public_key IS NOT NULL
        AND transaction_hash IS NOT NULL
        AND ledger_sequence IS NOT NULL)
    ),
  CONSTRAINT project_issuance_unavailable_evidence_check
    CHECK (
      status <> 'awaiting_issuer_integration' OR
      (issuer_public_key IS NULL
        AND transaction_hash IS NULL
        AND ledger_sequence IS NULL
        AND failure_code IS NULL)
    ),
  CONSTRAINT project_issuance_submitted_hash_check
    CHECK (status <> 'submitted' OR transaction_hash IS NOT NULL),
  CONSTRAINT project_issuance_unique_asset_code UNIQUE (network, asset_code)
);

CREATE INDEX project_issuance_status_idx
  ON project_issuance_intents (status, updated_at DESC);
