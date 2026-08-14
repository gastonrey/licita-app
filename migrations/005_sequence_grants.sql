-- 005_sequence_grants.sql — P0.8 prod-deploy hardening: least-privilege role
-- gets sequence USAGE.
--
-- The `licita_app` role (created by docker/db/init/01_roles.sh) already has
-- SELECT/INSERT/UPDATE/DELETE on all tables, but INSERTs into serial/identity
-- columns (request_logs.id, payments.id, ...) call nextval(), which requires
-- USAGE on the owning sequence. Without this grant, observability and payment
-- logging fail in production with "permission denied for sequence ..._id_seq".
--
-- This migration makes the grant self-healing for databases already deployed
-- before 01_roles.sh learned about sequences, and is idempotent for fresh
-- ones. It runs as the admin user via the `migrate` step. Role provisioning
-- stays in 01_roles.sh — this only guards: when `licita_app` does not exist
-- (e.g. throwaway/integration databases without the init script), it is a
-- no-op instead of an error.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'licita_app') THEN
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO licita_app;
    -- Sequences created by later migrations inherit the same grant.
    ALTER DEFAULT PRIVILEGES FOR ROLE licita IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO licita_app;
  END IF;
END $$;