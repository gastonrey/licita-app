// pg-mem test database with the subset of migrations/001_core.sql +
// 003_identity.sql needed by ingest/forecast. Differences vs production DDL
// (kept intentional):
// - no `unaccent` extension (name_norm is computed in JS, see normalize.ts)
// - no generated `fts` tsvector column on tenders (pg-mem lacks to_tsvector)
// - no CHECK on company_identifiers.scheme, no partial nif indexes (pg-mem)
// Everything else (columns, uniques incl. the COALESCE expression index on
// awards) mirrors 001_core.sql.
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';

export const TEST_SCHEMA_SQL = `
CREATE TABLE sources (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL,
  base_url text, license_note text
);
CREATE TABLE buyers (
  id bigserial PRIMARY KEY, source_id int NOT NULL, source_ref text NOT NULL,
  name text NOT NULL, name_norm text NOT NULL, country text, nuts text,
  org_type text, nif text, raw jsonb, UNIQUE(source_id, source_ref)
);
CREATE TABLE companies (
  id bigserial PRIMARY KEY, source_id int NOT NULL, source_ref text NOT NULL,
  name text NOT NULL, name_norm text NOT NULL, country text, nif text,
  raw jsonb, UNIQUE(source_id, source_ref)
);
-- mirrors migrations/003_identity.sql (CHECK/partial indexes omitted: pg-mem)
CREATE TABLE company_aliases (
  id bigserial PRIMARY KEY, company_id bigint NOT NULL, alias text NOT NULL,
  alias_norm text NOT NULL, source_id int, created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, alias_norm)
);
CREATE TABLE company_identifiers (
  id bigserial PRIMARY KEY, company_id bigint NOT NULL, scheme text NOT NULL,
  value text NOT NULL, created_at timestamptz DEFAULT now(),
  UNIQUE(scheme, value)
);
CREATE TABLE cpvs (code text PRIMARY KEY, label_en text, label_es text);
CREATE TABLE tenders (
  id bigserial PRIMARY KEY, source_id int NOT NULL, source_ref text NOT NULL,
  notice_type text, publication_date date, buyer_id bigint, title text,
  description text, cpv_main text, cpv_all text[], procedure_type text,
  deadline timestamptz, estimated_value numeric, currency text, nuts text,
  url text, raw jsonb, UNIQUE(source_id, source_ref)
);
CREATE TABLE awards (
  id bigserial PRIMARY KEY, tender_id bigint NOT NULL, source_ref text NOT NULL,
  award_date date, winner_company_id bigint, lot text, value numeric,
  currency text, bidders_count int, framework boolean DEFAULT false,
  duration_months numeric, start_date date, end_date date, raw jsonb
);
CREATE UNIQUE INDEX uq_awards_dedup ON awards(tender_id, COALESCE(lot, ''), source_ref);
CREATE TABLE contracts (
  id bigserial PRIMARY KEY, award_id bigint UNIQUE NOT NULL, buyer_id bigint,
  company_id bigint, cpv text, title text, value numeric, currency text,
  start_date date, end_date date, duration_months numeric,
  framework boolean DEFAULT false, renewal_window_start date,
  renewal_window_end date, status text DEFAULT 'active'
);
CREATE TABLE contract_events (
  id bigserial PRIMARY KEY, contract_id bigint NOT NULL, event_type text NOT NULL,
  event_date date, details jsonb, source_ref text
);
CREATE TABLE forecast_signals (
  id bigserial PRIMARY KEY, buyer_id bigint, cpv text,
  incumbent_company_id bigint, contract_id bigint, signal_type text NOT NULL,
  window_start date, window_end date, confidence text, basis jsonb,
  computed_at timestamptz DEFAULT now()
);
-- mirrors migrations/001_core.sql + 002_payments_x402.sql
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
-- mirrors migrations/006_credits.sql (P2 prepaid credit bundles)
CREATE TABLE credit_accounts (
  client_key text PRIMARY KEY,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- mirrors migrations/004_observability.sql (partial zero_result index kept)
CREATE TABLE request_logs (
  id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(),
  client_key text, endpoint text, method text, status int, latency_ms int,
  cpv text, buyer text, company text, error text, paid boolean DEFAULT false,
  q text, zero_result boolean DEFAULT false, user_agent text,
  source text NOT NULL DEFAULT 'rest' CHECK (source IN ('rest', 'mcp'))
);
CREATE INDEX idx_request_logs_source ON request_logs(source);
CREATE INDEX idx_request_logs_zero_result ON request_logs(zero_result) WHERE zero_result = true;
CREATE INDEX idx_request_logs_status ON request_logs(status);
`;

export async function makeTestDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await pool.query(TEST_SCHEMA_SQL);
  return pool as unknown as Db;
}

export async function countRows(db: Db, table: string): Promise<number> {
  const res = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  return (res.rows[0] as { n: number }).n;
}
