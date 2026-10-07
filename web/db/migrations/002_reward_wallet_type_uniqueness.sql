ALTER TABLE reward_records
ADD CONSTRAINT reward_records_wallet_reward_type_unique
UNIQUE (wallet_public_key, reward_type);
