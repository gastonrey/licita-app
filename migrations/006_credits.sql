-- Prepaid credit bundles (P2): one balance row per x-client-key. Paid calls
-- debit atomically (UPDATE ... WHERE balance_cents >= cost); purchases upsert
-- via POST /v1/billing/credits/:amount.
CREATE TABLE IF NOT EXISTS credit_accounts (
  client_key text PRIMARY KEY,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
