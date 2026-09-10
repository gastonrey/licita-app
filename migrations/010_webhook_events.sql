-- 010_webhook_events.sql — webhook event idempotency table (C1.1).
--
-- Records every Stripe webhook delivery by event_id (UNIQUE). The INSERT
-- ON CONFLICT DO NOTHING pattern gives idempotent processing: first delivery
-- inserts a row and proceeds; duplicate deliveries see the existing row and
-- return 200 without re-applying effects.
--
-- PII minimization: only the event id and type are stored — no payload.
-- Status tracks lifecycle: processing → completed | failed.
-- Additive and replay-safe: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS webhook_events (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  type text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
