-- Exactly one unsigned, server-owned Mainnet payment plan per immutable order.
-- An uncertain wallet outcome can be checked by hash; it must never cause a new payment XDR.
ALTER TABLE mainnet_token_orders
  ADD COLUMN payment_plan_hash char(64) UNIQUE
    CHECK (payment_plan_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN payment_plan_xdr text
    CHECK (length(payment_plan_xdr) BETWEEN 1 AND 4096),
  ADD COLUMN payment_plan_prepared_at timestamptz,
  ADD CONSTRAINT mainnet_payment_plan_together CHECK (
    (payment_plan_hash IS NULL AND payment_plan_xdr IS NULL AND payment_plan_prepared_at IS NULL)
    OR
    (payment_plan_hash IS NOT NULL AND payment_plan_xdr IS NOT NULL AND payment_plan_prepared_at IS NOT NULL)
  );
