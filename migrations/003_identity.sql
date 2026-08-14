-- 003_identity.sql — cross-source company/buyer identity (P0.4).
--
-- Identity model (conservative: exact NIF equality only, never name-based
-- cross-source merges — a wrong merge is worse than a duplicate):
-- - buyers gain an optional nif column (PLACSP declares it via schemeName=NIF;
--   TED buyer-identifier when trivially parseable).
-- - company_identifiers is the cross-source backbone: scheme 'nif' holds the
--   normalized fiscal id, schemes 'ted'/'placsp' hold each source's source_ref
--   for the row. UNIQUE(scheme, value) makes an identifier belong to exactly
--   one company.
-- - company_aliases records alternative normalized names observed for the same
--   company (e.g. TED 'INDRA SISTEMAS SA' vs PLACSP 'INDRA SISTEMAS S.A.'),
--   never fabricated — only names actually seen in a source payload.

ALTER TABLE buyers ADD COLUMN IF NOT EXISTS nif text;

CREATE TABLE IF NOT EXISTS company_aliases (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id),
  alias text NOT NULL,
  alias_norm text NOT NULL,
  source_id int REFERENCES sources(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(company_id, alias_norm)
);

CREATE TABLE IF NOT EXISTS company_identifiers (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id),
  scheme text NOT NULL CHECK (scheme IN ('nif', 'ted', 'placsp')),
  value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(scheme, value)
);

CREATE INDEX IF NOT EXISTS idx_companies_nif ON companies(nif) WHERE nif IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buyers_nif ON buyers(nif) WHERE nif IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_identifiers_company ON company_identifiers(company_id);
