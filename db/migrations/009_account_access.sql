BEGIN;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS token_valid_after timestamptz;
COMMIT;
