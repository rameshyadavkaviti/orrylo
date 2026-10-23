-- Mainnet customer payment orders. Additive; does not touch Testnet tables.
-- Payment confirmation alone never authorizes an issuance without the corresponding
-- owner-bound order and an independent confirmed ledger check.
CREATE TABLE mainnet_token_orders (
  order_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project_profiles(project_id),
  owner_public_key text NOT NULL,
  issuer_public_key text NOT NULL,
  treasury_public_key text NOT NULL,
  asset_code text NOT NULL,
  destination_public_key text NOT NULL,
  initial_supply text NOT NULL,
  network_passphrase text NOT NULL
    DEFAULT 'Public Global Stellar Network ; September 2015'
    CHECK (network_passphrase = 'Public Global Stellar Network ; September 2015'),
  price_stroops bigint NOT NULL DEFAULT 100000000 CHECK (price_stroops = 100000000),
  memo text NOT NULL UNIQUE CHECK (memo ~ '^o[0-9a-f]{27}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'paid', 'reconciling', 'issued', 'refunded')),
  payment_transaction_hash char(64) UNIQUE
    CHECK (payment_transaction_hash ~ '^[0-9a-f]{64}$'),
  payment_ledger bigint CHECK (payment_ledger > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'pending' AND payment_transaction_hash IS NULL AND payment_ledger IS NULL AND paid_at IS NULL)
    OR
    (state <> 'pending' AND payment_transaction_hash IS NOT NULL AND payment_ledger IS NOT NULL AND paid_at IS NOT NULL)
  ),
  UNIQUE (project_id),
  UNIQUE (issuer_public_key, asset_code)
);

CREATE INDEX mainnet_token_orders_owner_idx
  ON mainnet_token_orders (owner_public_key, created_at DESC);

-- Only the authenticated application role can create/read/settle orders.
-- Database owner retains migration authority; PUBLIC receives no privileges.
REVOKE ALL ON mainnet_token_orders FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mainnet_token_orders TO orrylo_app;
