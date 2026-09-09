-- 009_trial_api_keys.sql — activate the dormant api_clients table (001_core.sql)
-- for trial/pro keys (fiat-revenue-rails).
--
-- Additive and replay-safe: schema_migrations bookkeeping means this runs once;
-- safe for older app versions that ignore the new columns. NO new CHECK on
-- kind: the domain ('agent' | 'trial' | 'pro') is enforced by Zod in-app
-- (src/api/validate.ts apiClientKindSchema) — avoids the 008 dual-constraint-
-- name dance for pg-mem portability. NULL emails are distinct in PostgreSQL
-- and pg-mem unique indexes, so legacy agent rows are unaffected.
ALTER TABLE api_clients ADD COLUMN email text;
ALTER TABLE api_clients ADD COLUMN calls_remaining integer;
ALTER TABLE api_clients ADD COLUMN expires_at timestamptz;
ALTER TABLE api_clients ADD COLUMN current_period_end timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS api_clients_email_lower_ux ON api_clients (lower(email));