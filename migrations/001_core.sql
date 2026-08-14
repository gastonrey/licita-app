CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS sources (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  base_url text,
  license_note text
);

CREATE TABLE IF NOT EXISTS buyers (
  id bigserial PRIMARY KEY,
  source_id int NOT NULL REFERENCES sources(id),
  source_ref text NOT NULL,
  name text NOT NULL,
  name_norm text NOT NULL,
  country text,
  nuts text,
  org_type text,
  raw jsonb,
  UNIQUE(source_id, source_ref)
);

CREATE TABLE IF NOT EXISTS companies (
  id bigserial PRIMARY KEY,
  source_id int NOT NULL REFERENCES sources(id),
  source_ref text NOT NULL,
  name text NOT NULL,
  name_norm text NOT NULL,
  country text,
  nif text,
  raw jsonb,
  UNIQUE(source_id, source_ref)
);

CREATE TABLE IF NOT EXISTS cpvs (
  code text PRIMARY KEY,
  label_en text,
  label_es text
);

CREATE TABLE IF NOT EXISTS tenders (
  id bigserial PRIMARY KEY,
  source_id int NOT NULL REFERENCES sources(id),
  source_ref text NOT NULL,
  notice_type text,
  publication_date date,
  buyer_id bigint REFERENCES buyers(id),
  title text,
  description text,
  cpv_main text REFERENCES cpvs(code),
  cpv_all text[],
  procedure_type text,
  deadline timestamptz,
  estimated_value numeric,
  currency text,
  nuts text,
  url text,
  raw jsonb,
  fts tsvector GENERATED ALWAYS AS (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(description,''))) STORED,
  UNIQUE(source_id, source_ref)
);

CREATE TABLE IF NOT EXISTS awards (
  id bigserial PRIMARY KEY,
  tender_id bigint NOT NULL REFERENCES tenders(id),
  source_ref text NOT NULL,
  award_date date,
  winner_company_id bigint REFERENCES companies(id),
  lot text,
  value numeric,
  currency text,
  bidders_count int,
  framework boolean DEFAULT false,
  duration_months numeric,
  start_date date,
  end_date date,
  raw jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_awards_dedup ON awards(tender_id, COALESCE(lot,''), source_ref);

CREATE TABLE IF NOT EXISTS contracts (
  id bigserial PRIMARY KEY,
  award_id bigint UNIQUE NOT NULL REFERENCES awards(id),
  buyer_id bigint REFERENCES buyers(id),
  company_id bigint REFERENCES companies(id),
  cpv text,
  title text,
  value numeric,
  currency text,
  start_date date,
  end_date date,
  duration_months numeric,
  framework boolean DEFAULT false,
  renewal_window_start date,
  renewal_window_end date,
  status text DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS contract_events (
  id bigserial PRIMARY KEY,
  contract_id bigint NOT NULL REFERENCES contracts(id),
  event_type text NOT NULL,
  event_date date,
  details jsonb,
  source_ref text
);

CREATE TABLE IF NOT EXISTS forecast_signals (
  id bigserial PRIMARY KEY,
  buyer_id bigint REFERENCES buyers(id),
  cpv text,
  incumbent_company_id bigint REFERENCES companies(id),
  contract_id bigint REFERENCES contracts(id),
  signal_type text NOT NULL,
  window_start date,
  window_end date,
  confidence text,
  basis jsonb,
  computed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_clients (
  id bigserial PRIMARY KEY,
  key_hash text UNIQUE NOT NULL,
  kind text NOT NULL DEFAULT 'agent',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id bigserial PRIMARY KEY,
  client_id bigint REFERENCES api_clients(id),
  endpoint text NOT NULL,
  amount_usd numeric NOT NULL,
  provider text NOT NULL,
  proof text UNIQUE NOT NULL,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_logs (
  id bigserial PRIMARY KEY,
  ts timestamptz DEFAULT now(),
  client_key text,
  endpoint text,
  method text,
  status int,
  latency_ms int,
  cpv text,
  buyer text,
  company text,
  error text,
  paid boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tenders_cpv ON tenders(cpv_main);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer ON tenders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_tenders_pubdate ON tenders(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_fts ON tenders USING gin(fts);
CREATE INDEX IF NOT EXISTS idx_companies_norm ON companies(name_norm);
CREATE INDEX IF NOT EXISTS idx_buyers_norm ON buyers(name_norm);
CREATE INDEX IF NOT EXISTS idx_awards_winner ON awards(winner_company_id);
CREATE INDEX IF NOT EXISTS idx_awards_date ON awards(award_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_end ON contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_signals_buyer_cpv ON forecast_signals(buyer_id, cpv);
CREATE INDEX IF NOT EXISTS idx_signals_windows ON forecast_signals(window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts DESC);
