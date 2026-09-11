-- 011_web_traffic.sql — web traffic analytics columns (GTM backlog: human web
-- traffic measurement without touching the public UI or dashboard).
--
-- request_logs gains:
-- - kind: 'page' for public web page views (status 200 + text/html served from
--   the known public web routes: /, /pricing, /docs, /use-cases(/...), /data(/...),
--   /methodology, /security, /privacy, /terms, /status). 'api' is the default for
--   everything else written by the REST onResponse hook. MCP rows keep source='mcp'
--   and kind defaults to 'api', so kind partitions request_logs into page vs api
--   while source='mcp' is a cross-cut count.
-- - referer: the HTTP Referer header of page views, truncated to 200 chars by the
--   writer (strField). Used to group acquisition by host in /v1/stats.
-- Additive and replay-safe: ADD COLUMN IF NOT EXISTS.

ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'api'
  CHECK (kind IN ('api', 'page', 'mcp'));
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS referer text;
