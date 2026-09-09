-- Lead funnel fix (P0.x retention + operator management). Additive, replay-safe.
--
-- Scope notes:
-- - There is NO 30-day auto-delete trigger to drop: migrations 001-007 never
--   created one. The sweep was an unconditional DELETE in the insert path
--   (src/api/routes/demo.ts) and is replaced there by the 180-day
--   terminal-status rule ('new' leads are never auto-deleted).
-- - Widen the lifecycle domain with 'lost' so leads can actually reach a
--   terminal state (previously no status transition existed at all).
-- - Unique email per mailbox: resubmission must not create duplicate leads
--   (the API insert path is conflict-tolerant; this index bounds abuse).

-- The canonical name PostgreSQL assigned to the inline 007 CHECK.
ALTER TABLE demo_requests DROP CONSTRAINT IF EXISTS demo_requests_status_check;
-- pg-mem (the unit-test harness) auto-names the same inline CHECK
-- positionally instead; this is a no-op on real PostgreSQL and lets the
-- unit suite apply this file verbatim.
ALTER TABLE demo_requests DROP CONSTRAINT IF EXISTS demo_requests_constraint_3;
ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_status_check
  CHECK (status IN ('new', 'contacted', 'used', 'paid', 'lost'));

-- Collapse historical duplicates (keep the oldest row per address) so the
-- unique index can be created on an already-live table without aborting boot.
-- NOT-IN-min(id) form (not DELETE...USING) for pg-mem portability of the
-- unit suite, which executes this file verbatim.
DELETE FROM demo_requests
 WHERE id NOT IN (SELECT min(id) FROM demo_requests GROUP BY lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS demo_requests_email_lower_ux
  ON demo_requests (lower(email));
