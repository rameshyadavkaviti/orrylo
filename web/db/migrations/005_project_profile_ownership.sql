CREATE TABLE IF NOT EXISTS project_profile_owners (
  project_id uuid PRIMARY KEY
    REFERENCES project_profiles(project_id) ON DELETE CASCADE,
  owner_public_key char(56) NOT NULL,
  creation_request_id uuid NOT NULL UNIQUE
    REFERENCES workflow_intents(request_id),
  created_at timestamptz NOT NULL,
  CONSTRAINT project_profile_owners_wallet_check
    CHECK (
      owner_public_key = upper(owner_public_key)
      AND owner_public_key ~ '^G[A-Z2-7]{55}$'
    )
);

CREATE INDEX IF NOT EXISTS project_profile_owners_wallet_idx
  ON project_profile_owners (owner_public_key, created_at DESC);
