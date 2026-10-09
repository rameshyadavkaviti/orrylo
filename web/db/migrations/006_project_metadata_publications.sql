CREATE TABLE IF NOT EXISTS project_metadata_publications (
  project_id uuid PRIMARY KEY
    REFERENCES project_profiles(project_id) ON DELETE CASCADE,
  metadata_home text NOT NULL
    CHECK (char_length(metadata_home) BETWEEN 1 AND 255),
  network text NOT NULL
    CHECK (network IN ('testnet', 'public')),
  asset_code varchar(12) NOT NULL
    CHECK (asset_code = upper(asset_code) AND asset_code ~ '^[A-Z0-9]{1,12}$'),
  issuer_public_key char(56) NOT NULL
    CHECK (
      issuer_public_key = upper(issuer_public_key)
      AND issuer_public_key ~ '^G[A-Z2-7]{55}$'
    ),
  currency_toml text NOT NULL,
  content_hash char(64) NOT NULL
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 1
    CHECK (revision >= 1),
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  reachable boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  last_verification_at timestamptz,
  verification_error_code varchar(64),
  CONSTRAINT project_metadata_publications_updated_after_published
    CHECK (updated_at >= published_at),
  CONSTRAINT project_metadata_publications_reachable_verified
    CHECK (
      reachable = false
      OR (
        verified_at IS NOT NULL
        AND last_verification_at IS NOT NULL
      )
    ),
  CONSTRAINT project_metadata_publications_verified_attempted
    CHECK (
      verified_at IS NULL
      OR last_verification_at IS NOT NULL
    ),
  CONSTRAINT project_metadata_publications_asset_identity_unique
    UNIQUE (network, metadata_home, asset_code, issuer_public_key)
);

CREATE INDEX IF NOT EXISTS project_metadata_publications_host_idx
  ON project_metadata_publications (
    network,
    metadata_home,
    asset_code,
    issuer_public_key,
    project_id
  );
