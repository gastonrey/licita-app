-- Customer weekly radar: unsubscribe flag and one send per address per week.
-- Additive and replay-safe. Unsubscribed addresses stay in demo_requests
-- (the lead is still a lead) and are simply skipped by the mailer.

ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

CREATE TABLE IF NOT EXISTS radar_digest_sends (
  id bigserial PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email)),
  week_start date NOT NULL,
  -- Distinguishes the insert that won the week from a conflict. pg-mem's
  -- ON CONFLICT DO NOTHING RETURNING yields the existing id, so the mailer
  -- compares this token instead of trusting RETURNING.
  claim_token text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, week_start)
);
