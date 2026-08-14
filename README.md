# licita-agent

Agent-native procurement intelligence API for the Spanish public sector
(IT / software / cybersecurity vertical, CPV 72*/48*), built from TED
(Tenders Electronic Daily) award notices.

An external AI agent can — with **no human operator and no prior knowledge** —
discover the service (`GET /llms.txt`), understand it (`/openapi.json`,
`/docs`), read the price ladder (`GET /v1/pricing`), pay per call
(x402-compatible 402 flow with a dev faucet), and consume data over **REST**
or **MCP** (8 tools at `/mcp`). Every data row carries provenance
(source + source_ref + TED URL). Nulls are never fabricated.

Questions it answers: who bought, who won, for how much, under which CPV codes,
when contracts start/end, which active tenders look similar to a company's
track record, and which contracts are likely to be re-tendered soon.

## Architecture

```
                    ┌──────────────────────────── app (Fastify, src/index.ts) ───────────────────────────┐
                    │                                                                                    │
 TED Search API ──► │ ingestion              REST /v1            payments           MCP            web   │
 v3 (no auth)       │ src/ingest/ted.ts      src/api/server.ts   src/pay/*          src/mcp/       src/   │
 (poll, 24 mo)      │ src/ingest/normalize   src/api/routes/*    middleware 402 →   server.ts      web/   │
                    │ src/ingest/scheduler   openapi, ratelimit  X-PAYMENT verify   8 tools,       pages   │
                    │ src/forecast/signals   src/obs/* (logs,    dev faucet +       /mcp           /docs   │
                    │ (renewal signals)      metrics, request    replay protection                 /llms  │
                    │                        _log rows)                                                  │
                    └──────────────┬─────────────────────────────────────────────────────────────────────┘
                                   │ pg (node-postgres, raw SQL)
                                   ▼
                          PostgreSQL 16+ (migrations/001_core.sql)
```

| Area | Files |
|---|---|
| Wiring / config / DB | `src/index.ts`, `src/config.ts`, `src/config.validate.ts`, `src/db/{client,migrate}.ts`, `migrations/001_core.sql` |
| Ingestion + scheduler | `src/ingest/{ted,normalize,scheduler,cli}.ts`, `scripts/ingest-once.ts` |
| Forecast signals | `src/forecast/signals.ts` |
| REST API + observability | `src/api/{server,openapi,validate,ratelimit}.ts`, `src/api/routes/*`, `src/obs/*` |
| Payments | `src/pay/{provider,devProvider,middleware}.ts` |
| MCP | `src/mcp/server.ts` |
| Discovery surfaces | `src/web/pages.ts` (`/`, `/docs`, `/pricing`, `/llms.txt`, `/robots.txt`) |
| Acceptance test | `scripts/smoke-agent.ts`, `test/integration/**` |

## Quickstart (Docker)

```bash
cp .env.example .env          # edit secrets at minimum
docker compose up --build -d  # db (postgres:16-alpine) + app (migrate → start)
docker compose logs -f app
```

The app container runs `node dist/db/migrate.js && node dist/index.js` on boot;
migrations are idempotent. The API is then at `http://localhost:3000`.

### Without Docker (local dev)

Requires Node 20+ and a PostgreSQL 16+ — or use the bundled embedded Postgres:

```bash
npm install
npx tsx scripts/dev-db.ts &   # embedded postgres on :5433, prints DATABASE_URL
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=licita PGPASSWORD=licita PGDATABASE=licita
npm run migrate               # idempotent
npm run dev                   # tsx src/index.ts, listens on :3000
```

## Environment variables

Secrets have **no defaults**. Boot fails fast with an error listing every
missing/invalid variable (`src/config.validate.ts`, called from `src/index.ts`).

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | `production` enables the strict boot checks below |
| `DATABASE_URL` | — | Admin Postgres URL; overrides the PG* parts. Used by migrations |
| `APP_DATABASE_URL` | — | Optional low-privilege role URL for app traffic (falls back to `DATABASE_URL`) |
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | `db/5432/licita/licita/licita` | Connection parts (compose sets these) |
| `LOG_LEVEL` | `info` | `error`/`info`/`debug` for structured JSON logs |
| `TRUST_PROXY` | `false` | `true`/`false`/hop count → Fastify `trustProxy`. Set `true` only behind a reverse proxy |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Max distinct client keys tracked by the in-memory rate limiter |
| `PAYMENTS_MODE` | `dev` | `dev` = built-in HMAC faucet; `x402` = real facilitator seam (see Payments) |
| `PAY_HMAC_SECRET` | **required in dev mode** | HMAC secret signing dev payment tokens |
| `OPERATOR_KEY` | **required always** | Header `x-operator-key` required by `GET /v1/stats` |
| `INGEST_MONTHS` | `24` | Harvest window (months back from today) |
| `INGEST_ON_BOOT` | `false` | `true` = start the daily ingest scheduler inside the app process |
| `INGEST_CRON_HOUR` | `4` | Hour (server-local) the scheduler fires the daily ingest |
| `X402_FACILITATOR_URL` `X402_PAY_TO` `X402_NETWORK` | facilitator/network defaulted; `X402_PAY_TO` required in production | Real x402 facilitator config (CAIP-2 network: `eip155:84532` / `eip155:8453`) |

## First ingestion

Either trigger one harvest manually:

```bash
# docker:   docker compose exec app npx tsx src/ingest/cli.ts --once
npm run ingest -- --once                 # full window (INGEST_MONTHS)
npm run ingest -- --once --max-notices 25   # small slice
```

or let the app do it: `INGEST_ON_BOOT=true` runs an immediate harvest plus a
daily re-harvest at `INGEST_CRON_HOUR`.

Ingestion is idempotent (upserts keyed by `(source_id, source_ref)`) and safe
to kill/re-run. Verified live run against TED (2026-08-13, CPV 72*/48*, Spain,
last 24 months, capped at 25 notices):

```
notices_seen=25 → tenders=25, awards=44, companies=44, buyers=25,
contracts=44, forecast_signals=28, skipped=0, errors=0
```

A full 24-month harvest sees ~8,000 award notices. After each run the
deterministic forecast signals (`duration_expiry`, `framework_expiry`,
`recurrence`) are deleted and recomputed.

## Using it as an agent

Discovery order: `/llms.txt` → `/openapi.json` → `/v1/pricing` → paid calls
(or MCP at `/mcp`).

### REST: the 402 → faucet → retry flow (dev mode)

```bash
BASE=http://localhost:3000

# 1. Paid endpoint without payment → 402 with x402-shaped body
curl -i "$BASE/v1/search?cpv=72&type=award"
# {"x402Version":1,"accepts":[{"scheme":"exact","network":"dev","asset":"USD",
#   "amount":"0.02","payTo":"dev-faucet","resource":"GET /v1/search"}],
#  "hint":"POST /v1/dev-faucet ...","error":{"code":"payment_required",...}}

# 2. Mint a single-use dev token
TOKEN=$(curl -s -X POST "$BASE/v1/dev-faucet" \
  -H 'content-type: application/json' \
  -d '{"endpoint":"GET /v1/search"}' | jq -r .token)

# 3. Retry with the proof
curl -s "$BASE/v1/search?cpv=72&type=award" -H "X-PAYMENT: $TOKEN"
# {"data":[...],"meta":{"request_id":"...","price_usd":"0.02","paid":true,"provenance":[...]}}
```

Endpoint keys for the faucet are the `METHOD PATH` strings from
`GET /v1/pricing`, e.g. `"GET /v1/renewals"`. Tokens expire after 5 minutes
and are single-use (replay → 402 with reason `replay`).

The full autonomous flow is executable as the acceptance test:

```bash
BASE_URL=http://localhost:3000 npm run smoke   # 11 steps; exits 0 only if all pass
```

### MCP

Streamable-HTTP MCP endpoint at `POST /mcp` (stateless per request). Tools:
`search_tenders`, `get_tender`, `get_company`, `get_company_awards`,
`get_company_opportunities`, `get_buyer_history`, `get_renewals`,
`get_pricing`. Every tool accepts an optional `payment_token` argument; unpaid
paid-tools return `{"payment_required": true, "price_usd": ..., "how_to_pay": ...}`
as normal content (`isError=false`) — parse it, mint a token at the faucet,
retry with `payment_token`.

Client config snippet:

```json
{
  "mcpServers": {
    "licita": { "type": "streamable-http", "url": "http://localhost:3000/mcp" }
  }
}
```

Raw JSON-RPC example:

```bash
curl -s -X POST "$BASE/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"search_tenders",
                 "arguments":{"cpv":"72","type":"award","payment_token":"<token>"}}}'
```

## Payments

- **`PAYMENTS_MODE=dev` (default).** Priced endpoints return 402 in x402 shape.
  Proofs are HMAC-signed tokens (`base64url(json).sig`, secret =
  `PAY_HMAC_SECRET`) minted by the open dev faucet `POST /v1/dev-faucet`.
  Verification checks signature, endpoint match, amount match, 5-minute expiry,
  and replay via a unique insert into `payments.proof` (unique violation =
  replay). Every attempt is audit-logged. The faucet exists so agents can
  complete the flow without a human — disable it by leaving dev mode.
- **`PAYMENTS_MODE=x402` (production).** Real x402 v2 payments via the
  official `@x402/core` + `@x402/evm` packages: priced endpoints return 402
  with a base64 `PAYMENT-REQUIRED` header (v2) describing the exact USDC
  requirement (scheme `exact`, EIP-3009 `transferWithAuthorization`, asset and
  amount in base units for the configured CAIP-2 network — `eip155:84532`
  Base Sepolia or `eip155:8453` Base mainnet). Clients pay and retry with the
  base64 payment payload in `PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1
  legacy). The server verifies AND settles through the configured facilitator
  (`X402_FACILITATOR_URL`, default `https://www.x402.org/facilitator`) before
  serving content, fails closed (`facilitator_unavailable`) on facilitator
  errors, and records settled payments with payer address, tx hash and
  network in the `payments` table (unique payload hash = replay protection).
  The dev faucet route is removed entirely in this mode (it 404s like any
  unknown path). No private keys are stored anywhere — settlement is
  gasless for the server; funds go straight to `X402_PAY_TO`.

## Security model

- **Fail-fast configuration.** No secret has a default. At boot,
  `validateConfig` requires `OPERATOR_KEY` always and `PAY_HMAC_SECRET` in dev
  mode; with `NODE_ENV=production` it additionally requires
  `PAYMENTS_MODE=x402`, a valid `X402_PAY_TO` (`0x` + 40 hex), an https
  `X402_FACILITATOR_URL`, a CAIP-2 `X402_NETWORK` (`eip155:84532` Base Sepolia
  or `eip155:8453` Base mainnet; other `eip155:<chainId>` values are accepted
  as explicit overrides), and rejects known placeholder secrets
  (`change-me`, `change-me-in-prod`). All violations are reported in one error.
- **Faucet gating.** `POST /v1/dev-faucet` exists only when
  `PAYMENTS_MODE=dev` AND `NODE_ENV != 'production'`; otherwise no route is
  registered at all (generic 404 — the faucet is undiscoverable).
- **Rate limit:** 60 req/min per client (in-memory token bucket; key = payment
  proof hash when present, else client IP). The bucket map is bounded
  (`RATE_LIMIT_MAX_KEYS`, default 10,000; oldest-activity eviction + periodic
  sweep of expired windows). Over limit → 429 + `retry-after`. Per-instance;
  not shared across replicas.
- **Replay protection** on payment proofs (single-use, unique DB constraint),
  5-minute token expiry, timing-safe HMAC comparison.
- `GET /v1/stats` requires `x-operator-key: $OPERATOR_KEY` (401 otherwise);
  the comparison is constant-time (SHA-256 digests + `crypto.timingSafeEqual`).
- **`GET /health`** is free and unauthenticated: 200 `{status:'ok',db:'up'}`,
  or 503 `{status:'degraded',db:'down'}` when `SELECT 1` fails/times out.
- **Least-privilege DB role.** `docker/db/init/01_roles.sh` creates
  `licita_app` (CONNECT + SELECT/INSERT/UPDATE/DELETE on all tables, no DDL).
  Set `APP_DATABASE_URL` so app traffic uses it; migrations always run on the
  admin `DATABASE_URL`.
- All inputs zod-validated (max lengths, CPV/date formats); parameterized SQL
  only; secrets via env only; no keys in any response body.
- Error envelope `{ "error": { "code", "message", "hint" } }` with an
  agent-actionable hint.

## Production configuration

Use the hardened profile:

```bash
export POSTGRES_PASSWORD=... LICITA_APP_PASSWORD=... OPERATOR_KEY=...
export X402_FACILITATOR_URL=https://www.x402.org/facilitator X402_PAY_TO=0x... X402_NETWORK=eip155:8453
docker compose -f docker-compose.prod.yml up --build -d
```

- `docker-compose.prod.yml` sets `NODE_ENV=production` + `PAYMENTS_MODE=x402`
  and requires every secret via compose `:?` interpolation — nothing has a
  working default.
- The app port binds to **127.0.0.1 only**: a reverse proxy must terminate
  TLS in front. With a proxy, keep `TRUST_PROXY=true` (default in the prod
  file) so rate limiting keys on the real client IP from `X-Forwarded-For`;
  set `TRUST_PROXY=false` if the app is ever exposed directly.
- App traffic runs as `licita_app` (`APP_DATABASE_URL`); migrations run as
  the admin user (`DATABASE_URL`) on container boot.
- The image builds with `npm ci`, runs as the `node` user, and carries a
  `HEALTHCHECK` hitting `/health` (busybox wget).

## Observability

- Every request writes one async, non-blocking `request_logs` row (endpoint,
  status, latency, cpv/buyer/company filters, paid flag, error code).
- Every payment (success/failure/replay) writes a `payments` row.
- Structured JSON logs on stdout (payment events, harvest progress, errors).
- `GET /v1/stats` (operator key) returns: `unique_clients`,
  `requests_by_endpoint` (incl. paid counts), `payments` (attempts, successes,
  `revenue_usd`, by status), `top_requested` (cpvs/buyers/companies),
  `failed_queries`, `data_null_rates` (award value/winner null share), and the
  in-memory metrics snapshot.

## Testing

```bash
npm test                 # 124 unit tests (vitest, pg-mem + fixtures)
npm run test:api-smoke   # server wiring smoke (payment middleware stubbed)
npm run test:integration # REAL app + REAL embedded postgres + live TED slice
npm run smoke            # autonomous-agent acceptance test (needs a running,
                         # ingested instance; BASE_URL env, default :3000)
```

The integration suite starts `scripts/dev-db.ts` (embedded Postgres 18 on port
5433), runs migrations, ingests 25 live TED notices, boots
`buildServer → registerWeb → mountMcp` on an ephemeral port, and asserts the
402→faucet→paid flow, envelope shape, replay rejection, renewals and the MCP
tool list. **It skips gracefully if `api.ted.europa.eu` is unreachable.**

## Limitations (honest list)

- **PLACSP/CODICE ingester is a stub** (`src/ingest/placsp.ts` logs "not
  enabled"); TED is the only live source.
- **No LLM anywhere** — search is Postgres FTS (`spanish` config), forecast
  signals are deterministic SQL/date math.
- **x402 real-facilitator settlement is not wired** (see Payments).
- Framework agreement values are **ceiling amounts**, not actual spend.
- Unit tests use `pg-mem`, which lacks window functions and has
  `count(*) FILTER` / `ON CONFLICT...RETURNING` quirks — full-app SQL is
  therefore only covered by the integration suite against real Postgres.
- `scripts/dev-db.ts` (embedded-postgres) requires system libraries the
  bundled binaries link against (e.g. libicu); if `initdb` fails in your
  environment, use `docker compose up db` instead.
- Single-process in-memory rate limiter (per-instance; not shared across
  replicas).
