CREATE TABLE IF NOT EXISTS project_profiles (
  project_id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  asset_code varchar(12) NOT NULL
    CHECK (asset_code = upper(asset_code) AND asset_code ~ '^[A-Z0-9]{1,12}$'),
  display_name varchar(80) NOT NULL
    CHECK (char_length(display_name) BETWEEN 2 AND 80),
  description text
    CHECK (description IS NULL OR char_length(description) <= 280),
  category varchar(80),
  logo_url text,
  website_url text,
  community_url text,
  metadata_home text,
  issuer_model text NOT NULL
    CHECK (issuer_model IN ('shared', 'dedicated')),
  network text NOT NULL
    CHECK (network IN ('testnet', 'public')),
  issuer_public_key char(56)
    CHECK (
      issuer_public_key IS NULL
      OR (
        issuer_public_key = upper(issuer_public_key)
        AND issuer_public_key ~ '^G[A-Z2-7]{55}$'
      )
    ),
  explorer_url text,
  public_status text NOT NULL DEFAULT 'draft'
    CHECK (public_status IN ('draft', 'published')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_profiles_updated_after_created
    CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS project_profiles_public_status_idx
  ON project_profiles (public_status);
