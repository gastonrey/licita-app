-- 004_observability.sql — P0.7 experiment-metrics on request_logs.
--
-- Adds the fields that let the founder answer "who asked, what, did it return
-- results, did they pay, via REST or MCP":
--   q           the validated search query text (truncated to 200 chars)
--   zero_result true when a search/renewals/awards/opportunities/history call
--               returned an empty data set (explicit flag set by the handler)
--   user_agent  standard client metadata header (not personal data, truncated)
--   source      'rest' (default) or 'mcp' — which interface served the call
--
-- Data minimization: raw IP addresses are NOT stored in new rows — the REST
-- and MCP loggers write sha256(ip + OPERATOR_KEY) as client_key instead. Rows
-- written before this migration are left untouched (see P0.7 report).

ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS q text;
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS zero_result boolean DEFAULT false;
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'rest' CHECK (source IN ('rest', 'mcp'));

CREATE INDEX IF NOT EXISTS idx_request_logs_source ON request_logs(source);
CREATE INDEX IF NOT EXISTS idx_request_logs_zero_result ON request_logs(zero_result) WHERE zero_result = true;
CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status);
