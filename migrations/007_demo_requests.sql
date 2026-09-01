-- Human demand capture from the public homepage. Additive and replay-safe.
CREATE TABLE IF NOT EXISTS demo_requests (
  id bigserial PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email)),
  channel text NOT NULL DEFAULT 'direct' CHECK (channel <> ''),
  source_url text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'used', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);
