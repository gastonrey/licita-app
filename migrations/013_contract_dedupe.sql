-- 013_contract_dedupe.sql — mark duplicate contracts. Do not delete them.
-- Additive and replay-safe: a nullable column, a partial index, and an
-- idempotent function. schema_migrations applies this file once; the
-- statements themselves are safe to run again.
--
-- Canonical row in each group, in order: (1) has end_date, (2) PLACSP
-- (sources.id = 2) over TED, (3) older publication, (4) smaller id.
-- Reversible without dropping the column:
--   UPDATE contracts SET dup_of = NULL;
-- then recomputeSignals. Do not recompute via the ingest CLI while this
-- build is deployed: it calls refresh_contract_dups() first and re-marks.

-- No destructivo: marca duplicados con contracts.dup_of = id del contrato canónico.
-- Reversible: UPDATE contracts SET dup_of = NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS dup_of bigint REFERENCES contracts(id);
CREATE INDEX IF NOT EXISTS idx_contracts_dup_of ON contracts(dup_of) WHERE dup_of IS NOT NULL;

CREATE OR REPLACE FUNCTION refresh_contract_dups() RETURNS TABLE(groups int, marked int) AS $$
DECLARE g int; m int;
BEGIN
  DROP TABLE IF EXISTS _cx,_g,_r;
  UPDATE contracts SET dup_of = NULL WHERE dup_of IS NOT NULL;

  CREATE TEMP TABLE _cx ON COMMIT DROP AS
  SELECT c.id, c.end_date, c.start_date, t.id AS tender_id, t.source_id AS tsrc, t.publication_date AS pub,
         b.name_norm AS bn, COALESCE(co.nif, co.name_norm) AS ckey,
         COALESCE(c.cpv,'') AS cpv, lower(left(btrim(c.title),30)) AS tk, c.value
  FROM contracts c
  JOIN awards a  ON a.id = c.award_id
  JOIN tenders t ON t.id = a.tender_id
  JOIN buyers b  ON b.id = c.buyer_id
  JOIN companies co ON co.id = c.company_id
  WHERE c.value > 0 AND c.title IS NOT NULL;

  -- Grupos duplicados: misma clave, >1 licitación distinta (no lotes de una misma licitación),
  -- y (mismo start_date o fuentes distintas TED/PLACSP).
  CREATE TEMP TABLE _g ON COMMIT DROP AS
  SELECT bn, ckey, value, cpv, tk FROM _cx
  GROUP BY bn, ckey, value, cpv, tk
  HAVING count(DISTINCT tender_id) > 1
     AND (count(DISTINCT start_date) = 1 OR count(DISTINCT tsrc) > 1);

  CREATE TEMP TABLE _r ON COMMIT DROP AS
  SELECT x.id,
         first_value(x.id) OVER w AS keeper,
         row_number()      OVER w AS rn
  FROM _cx x JOIN _g USING (bn, ckey, value, cpv, tk)
  WINDOW w AS (PARTITION BY x.bn, x.ckey, x.value, x.cpv, x.tk
               ORDER BY (x.end_date IS NOT NULL) DESC, (x.tsrc = 2) DESC, x.pub ASC, x.id ASC);

  UPDATE contracts c SET dup_of = r.keeper FROM _r r WHERE c.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS m = ROW_COUNT;
  SELECT count(*) INTO g FROM _g;
  RETURN QUERY SELECT g, m;
END $$ LANGUAGE plpgsql;
