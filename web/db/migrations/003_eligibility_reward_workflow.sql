CREATE TABLE IF NOT EXISTS token_creation_qualifying_events (
  event_reference text PRIMARY KEY,
  event_fingerprint char(64) NOT NULL,
  wallet_public_key char(56) NOT NULL
    CHECK (wallet_public_key = upper(wallet_public_key) AND wallet_public_key ~ '^G[A-Z2-7]{55}$'),
  event_type text NOT NULL
    CHECK (event_type = 'TOKEN_CREATION_SUCCEEDED'),
  event_occurred_at timestamptz NOT NULL,
  associated_reference text,
  source text NOT NULL,
  policy_version text NOT NULL,
  processing_state text NOT NULL DEFAULT 'received'
    CHECK (processing_state IN ('received', 'processed')),
  result jsonb,
  received_at timestamptz NOT NULL,
  processed_at timestamptz
);

ALTER TABLE eligibility_records
ADD COLUMN IF NOT EXISTS qualifying_event_reference text;

ALTER TABLE eligibility_records
ADD CONSTRAINT eligibility_records_qualifying_event_fk
FOREIGN KEY (qualifying_event_reference)
REFERENCES token_creation_qualifying_events(event_reference);

CREATE UNIQUE INDEX IF NOT EXISTS eligibility_records_qualifying_event_unique
  ON eligibility_records (qualifying_event_reference)
  WHERE qualifying_event_reference IS NOT NULL;

ALTER TABLE reward_records
ADD CONSTRAINT reward_records_first_token_amount_check
CHECK (
  reward_type <> 'FIRST_TOKEN_CREATION_REWARD'
  OR amount = 150.0000000
);
