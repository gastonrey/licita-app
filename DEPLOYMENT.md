# DEPLOYMENT.md — licita-agent production ops runbook

Single-owner, single-VM deployment for public launch. No Kubernetes, no
microservices, no ORM: one `node:20-alpine` container in front of one
`postgres:16-alpine` container, orchestrated by `docker compose
-f docker-compose.prod.yml`. Total bill of materials: one VM, one domain, one
Postgres data volume.

The whole flow is testable in minutes on a laptop: build, boot, hit `/health`,
run the migrate step, then start the app. This file assumes the app directory
(checkout of `app/`) is present on the VM at `/opt/licita`.

---

## 1. Topology

```
Internet
   │  HTTPS (TLS termination)
   ▼
Reverse proxy (Caddy / nginx / Cloudflare Tunnel)   ← the only public listener
   │  proxies to 127.0.0.1:3000 (X-Forwarded-For)
   ▼
app container  (Fastify, NODE_ENV=production, PAYMENTS_MODE=x402)
   │  connects to `db:5432` over the compose network as role `licita_app`
   ▼
db container  (postgres:16-alpine, volume `pgdata`)
   └─ 127.0.0.1:5432 published for host-side ops only (pg_dump, backfill)
```

- The app binds **127.0.0.1:3000 only**. Postgres binds **127.0.0.1:5432
  only**. Nothing listens on a public interface.
- Migrations are an explicit deploy step: the `migrate` one-shot service
  applies DDL on the admin connection (`DATABASE_URL`) and exits 0; the `app`
  service starts only after `migrate` exits 0. App traffic runs as the
  low-privilege `licita_app` role (no DDL). The app CMD re-runs the idempotent
  migrate on boot as a safety net — it is a no-op when nothing is pending.

---

## 2. Prerequisites

1. **A VM** with Docker Engine + Compose v2 and enough disk for the Postgres
   volume. Sizing guidance in §9 (2 vCPU / 4 GB is comfortable).
2. **The app directory** at `/opt/licita` (this checkout: `docker-compose.prod.yml`,
   `Dockerfile`, `docker/db/init/`, `migrations/`, `.env.example`). A plain
   `git clone`/`scp` is fine; do not add dev-only files.
3. **A wallet address** that will receive USDC (`X402_PAY_TO`). This is a
   public address, not a secret. It must be controlled by you — see §7.
4. **DNS + TLS.** Create an `A`/`CNAME` record to the VM and put a reverse
   proxy in front (Caddy with an automatic certificate is the least effort;
   nginx, Traefik or Cloudflare Tunnel also work). The proxy must forward
   `X-Forwarded-For` (Caddy does by default) because `TRUST_PROXY=true`.
   Example Caddyfile:
   ```
   api.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```
5. **Secrets generator**: `openssl rand -hex 32` three times (see below).
6. **Sepolia test assets** (for the x402 smoke run in §5): a Base Sepolia
   throwaway wallet funded with a little ETH (gas) and USDC.

### Required vs optional variables

Required in the prod profile (compose aborts or the app refuses to boot if
unset — `docker-compose.prod.yml` documents them):

| Var | Meaning |
|---|---|
| `POSTGRES_PASSWORD` | admin DB password (migrations). Random string |
| `LICITA_APP_PASSWORD` | password for the low-privilege `licita_app` role. Random string |
| `OPERATOR_KEY` | `x-operator-key` header value for `GET /v1/stats`. Random string |
| `X402_PAY_TO` | `0x` + 40 hex — the USDC recipient wallet |
| `X402_FACILITATOR_URL` | `https://www.x402.org/facilitator` (default in code) |
| `X402_NETWORK` | CAIP-2: `eip155:84532` (Base Sepolia, default) or `eip155:8453` (Base mainnet) |

Optional with prod defaults (override in `.env` to change):

| Var | Prod default | Note |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` for verbose JSON logs |
| `TRUST_PROXY` | `true` | keep `true` behind a reverse proxy |
| `RATE_LIMIT_MAX_KEYS` | `10000` | in-memory rate limiter bucket size |
| `INGEST_MONTHS` | `24` | harvest window in months |
| `INGEST_ON_BOOT` | `true` | arms the daily scheduler (first run at `INGEST_CRON_HOUR`) |
| `INGEST_CRON_HOUR` | `4` | UTC hour of the daily ingest |
| `PLACSP_ENABLED` | `true` | PLACSP on in production |
| `PLACSP_MAX_PAGES` | `5` | RFC 5005 pages per PLACSP feed |
| `PLACSP_DELAY_MS` | `1000` | minimum delay between PLACSP feed requests |
| `PLACSP_SCHEDULE` | `true` | include PLACSP in the daily scheduler run |
| `PAY_HMAC_SECRET` | *(empty)* | unused by x402; surfaced so it can never be `change-me-in-prod` |

---

## 3. One-time deploy

```bash
cd /opt/licita

# 3a. Environment file (secrets have NO defaults)
cp .env.example .env
#    POSTGRES_PASSWORD=$(openssl rand -hex 32)
#    LICITA_APP_PASSWORD=$(openssl rand -hex 32)
#    OPERATOR_KEY=$(openssl rand -hex 32)
#    X402_PAY_TO=0x<your public USDC recipient address>
#    (X402_FACILITATOR_URL and X402_NETWORK have defaults — start on Sepolia:
#     X402_NETWORK=eip155:84532)

# 3b. Database first — creates roles via docker/db/init/01_roles.sh on first
#     init, then becomes healthy.
docker compose -f docker-compose.prod.yml up -d db

# 3c. Apply migrations as an explicit step (admin connection, DDL). Exits 0
#     when done; the app will not start until it does.
docker compose -f docker-compose.prod.yml up -d migrate
#     watch it:  docker compose -f docker-compose.prod.yml ps migrate
#     (expect "Exited (0)")

# 3d. Start the app. It waits for migrate to exit 0, then serves.
docker compose -f docker-compose.prod.yml up -d app
#     watch it:  docker compose -f docker-compose.prod.yml ps
#     (app should become "healthy" within ~30s)

# 3e. Sanity check from the VM
curl -s http://127.0.0.1:3000/health        # {"status":"ok","db":"up"}
curl -s http://127.0.0.1:3000/v1/pricing    # free endpoint; 200
```

**Every later deploy** (code update, or new `migrations/*.sql`) is the same
two-step: `up -d migrate` then `up -d app`. Migrations are idempotent and
safe to run repeatedly. For a code update, rebuild first:
`docker compose -f docker-compose.prod.yml build`.

> **Existing databases (deployed before this runbook).** If the DB already
> exists and was initialized with an old `01_roles.sh`, the `licita_app` role
> may lack `USAGE` on sequences — without it, observability and payment
> logging fail with `permission denied for sequence ..._id_seq`. The
> `005_sequence_grants.sql` migration fixes that automatically; it is applied
> by the `migrate` step above.

---

## 4. First ingest

The scheduler **arms** when the app boots (`INGEST_ON_BOOT=true`) but does
**not** ingest at boot — it fires at the next `INGEST_CRON_HOUR` (04:00 UTC by
default). The first harvest is therefore a manual, explicit run so data is
usable immediately:

```bash
cd /opt/licita

# 4a. TED full window + PLACSP (both sources). Idempotent and resumable.
docker compose -f docker-compose.prod.yml run --rm app \
  node dist/ingest/cli.js --once --source all
#     Expect the final line: {"level":"info","msg":"ingest summary",
#     "notices_seen":..., "upserted":..., ..., "errors":0}
#     Any errors is exit code 1 (see §8, "ingest partial failures").

# 4b. Identity backfill (one-time, host-side — the script is not in the image).
#     Needs Node 20 + dev deps once on the VM, and reaches the DB on loopback:
cd /opt/licita
npm ci
DATABASE_URL="postgres://licita:${POSTGRES_PASSWORD}@127.0.0.1:5432/licita" \
npm run backfill-identity
#     Expect {"level":"info","msg":"identity backfill done",...,"conflicts":0}
```

After 4a/4b the data is live and the scheduler handles everything from the
next 04:00 UTC onward (TED + PLACSP, idempotent upserts). A partial or failed
run is safe to re-run.

---

## 5. Smoke tests

### Local dev-mode smoke (before touching Sepolia)

Build and run the stack locally (`PAYMENTS_MODE=dev`, faucet on — never in
production):

```bash
docker compose up --build -d            # dev profile
curl -s http://localhost:3000/health    # {"status":"ok","db":"up"}
BASE_URL=http://localhost:3000 npm run smoke   # 11-step autonomous-agent acceptance test
docker compose down
```

### x402 smoke on Base Sepolia

Against a deployed app that already runs `PAYMENTS_MODE=x402`, run the real
x402 v2 flow from any machine with the checkout:

```bash
BASE_URL=https://api.yourdomain.com \
SMOKE_PAY_MODE=x402 \
SMOKE_WALLET_PRIVATE_KEY=0x<64 hex Base Sepolia throwaway> \
SMOKE_RPC_URL=https://sepolia.base.org \
npm run smoke
```

Requirements and failure modes are in README ("Run the agent smoke test with
real x402 payments"). Rules that matter operationally:

- The wallet key is a **testnet throwaway only** — never a mainnet key.
- Every step mints a fresh proof, so a `insufficient_funds` failure is fixed
  by funding the wallet and re-running; nothing to clean up.
- On a public URL you are exposing the live server — that is the point of the
  launch; the Sepolia wallet just pays for testnet USDC (~$0.44 per full run).

---

## 6. Daily operations

1. **Nothing to do** — the scheduler ingests TED + PLACSP daily at
   `INGEST_CRON_HOUR` (04:00 UTC) and recomputes forecast signals.
2. **Health.** `curl https://api.yourdomain.com/health` →
   `{"status":"ok","db":"up"}`. A `503`/`degraded` means the app cannot reach
   Postgres. The container HEALTHCHECK hits the same endpoint.
3. **Usage / revenue.** `GET /v1/stats` with the operator key:
   ```bash
   curl -s https://api.yourdomain.com/v1/stats -H "x-operator-key: $OPERATOR_KEY" | jq .
   ```
   Returns clients, per-endpoint paid counts, `revenue_usd` (x402 settlements),
   repeat clients, top searches, null-data rates, and the in-memory metrics
   snapshot.
4. **Logs.** `docker compose -f docker-compose.prod.yml logs -f app --since 1h`
   — structured JSON on stdout. Watch for `facilitator_unavailable` (see §8)
   and for scheduled ingest lines (`scheduled ingest done` / `failed`).
5. **Deploying updates.** `git pull` on the VM, then
   `docker compose -f docker-compose.prod.yml build && up -d migrate && up -d app`.

---

## 7. Backups

Documented strategy only — implement the cron on the VM host. Postgres data
lives in the `pgdata` volume; the host publishes `127.0.0.1:5432`, so the
host's `pg_dump`/`psql` reach it directly with the `.env` values.

**Volume strategy (first line of defence):** snapshot `pgdata` only while
Postgres is stopped (a filesystem-level copy of a running PG data dir is not
safe). Treat volume snapshots as a last resort; logical dumps below are the
primary backup.

**Logical dumps (primary).** Add to the VM's crontab (`crontab -e`):

```cron
# Daily at 03:10 UTC (before the 04:00 ingest), keep 14 days
10 3 * * * cd /opt/licita && \
  . ./.env 2>/dev/null || true; \
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U licita -d licita -Fc \
    -f /var/backups/licita/$(date +\%F).dump && \
  find /var/backups/licita -name '*.dump' -mtime +14 -delete
```

`-Fc` (custom format) gives compressed, restore-able dumps. Test a restore at
least once:
```bash
PGPASSWORD=$POSTGRES_PASSWORD pg_restore -h 127.0.0.1 -U licita -d licita_restore /var/backups/licita/$(date +%F).dump
```
Replicate `/var/backups/licita` off-VM (rsync/scp/object storage) — a disk
failure takes the VM *and* its backups otherwise.

**Migration rollback** is a schema concern, not a data one — see §8.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose ... up -d app` hangs at "starting" | app waits for `migrate` to exit 0. Check `docker compose -f docker-compose.prod.yml ps migrate`; if it shows `Exited (1)`, read `docker compose logs migrate`. Most often a wrong `POSTGRES_PASSWORD` (DB reachable, auth fails) |
| `migrate` fails with `database "licita" does not exist` / connection refused | `db` not healthy yet, or `POSTGRES_PASSWORD` mismatch with the existing volume. Never change `POSTGRES_PASSWORD` after first init |
| App logs `facilitator_unavailable` | the x402 facilitator is down or unreachable. The app fails closed (paid calls get a 402). Check egress/HTTPS from the VM; verify `curl https://www.x402.org/facilitator`. No data is at risk — retry when it returns |
| App logs `insufficient_funds` on smoke | client wallet ran out of Sepolia USDC/ETH — fund and re-run; nothing to clean up |
| App logs `scheduled ingest failed` | TED/PLACSP endpoint hiccup or a partial harvest. Re-run `docker compose -f docker-compose.prod.yml run --rm app node dist/ingest/cli.js --once --source all` — ingests are idempotent upserts |
| **Ingest partial failures** | per-notice errors are counted in the summary (`errors`) and logged with `source_ref`; the harvest continues. Rows already written are kept. Re-running only touches the missing/updated ones. Exit code 1 on any error is the signal to re-run |
| `permission denied for sequence ..._id_seq` | DB initialized with an old role script. Apply the grants (idempotent) and re-run migrate: `docker compose -f docker-compose.prod.yml run --rm migrate`, or run the SQL from `migrations/005_sequence_grants.sql` manually |
| **Migration rollback** | there is no down-migration. Migrations are append-only and idempotent; to roll back a bad release, deploy the previous app image (it never *needs* newer schema to boot) and, if schema must be undone, take a `pg_dump` first and consult the migration SQL to reverse specific DDL manually. Never `DROP` a table from memory |
| Postgres down / `pgdata` corrupt | this is the only single point of failure. Restore the latest dump: create a fresh volume (`docker compose -f docker-compose.prod.yml down -v` loses data — do NOT do this casually), start `db`, then `pg_restore`. Volume snapshots (taken with PG stopped) are the fallback |
| Changed `NODE_ENV`/`PAYMENTS_MODE` accidentally | boot fails fast and lists every violation — fix `.env`/compose, never run `PAYMENTS_MODE=dev` in production (the faucet is gated at code level, but the boot check refuses anyway) |

---

## 9. Monthly cost estimate (single VM, no Kubernetes)

Assumptions: 1× 2 vCPU / 4 GB VM with 40 GB disk; Postgres 16 in the same
compose stack (self-hosted, `pgdata` volume); ~8,000 TED award notices per
24-month window plus PLACSP feeds, ~200–400 MB of data; 1 TB egress/month.

| Item | Cost/month |
|---|---|
| VM (2 vCPU / 4 GB, e.g. Hetzner CPX21, Vultr 2GB/4GB tier, DO Droplet 4GB) | **$12–24** |
| Disk (40 GB) included in most plans; add snapshots if the plan charges per GB | $0–3 |
| Managed Postgres (optional — if you use e.g. Neon/Supabase instead of self-hosted) | $0–19 (free tier up to small) |
| TLS/certs (Caddy auto, Cloudflare free, Let's Encrypt) | $0 |
| Domain | ~$1–2 |

**Total: ≈ $15–45/month.** Self-hosted Postgres on the same VM keeps it at
the bottom of that range; a managed DB roughly doubles it but removes the
`pgdata` single point of failure and the §7 dump burden. If egress or log
volume grows, the levers are the rate limiter (`RATE_LIMIT_MAX_KEYS`), a
smaller `INGEST_MONTHS`, and `PLACSP_MAX_PAGES`.

No Kubernetes, no microservices, no multi-node — this stack fits entirely on
one small VM with the reverse proxy, app and DB colocated.

---

## 10. Mainnet flip checklist

Do this only after Sepolia has run clean for a few days and a real smoke test
passed.

- [ ] Re-confirm **you control the wallet** at `X402_PAY_TO` (sign a test
      transaction; the x402 flow pays into this address).
- [ ] Set `X402_NETWORK=eip155:8453` (Base mainnet) in `/opt/licita/.env`.
- [ ] Keep `X402_FACILITATOR_URL=https://www.x402.org/facilitator` (same
      facilitator serves mainnet).
- [ ] `cd /opt/licita && docker compose -f docker-compose.prod.yml up -d app`
      (env change only; `db`/`migrate` untouched).
- [ ] Verify the app booted and armed the scheduler:
      `docker compose -f docker-compose.prod.yml logs --tail 20 app` → expect
      `listening` and `ingest scheduler armed`.
- [ ] Run the **real** x402 smoke (§5) — this time with a mainnet wallet you
      control, funded with a small, deliberate amount of USDC + ETH. Expect
      settlement on-chain and `revenue_usd` > 0 in `/v1/stats`.
- [ ] Update the public `/v1/pricing` copy expectation: amounts are now
      mainnet USDC, `X402_NETWORK` is `eip155:8453`.
- [ ] Watch `docker compose logs -f app` for 24h for `facilitator_unavailable`
      or ingest failures before trusting it fully.

### PLACSP WAF / rate throttling

El portal de PLACSP (contrataciondelsectorpublico.gob.es) está detrás de un WAF que puede responder HTTP 200 con una página HTML "Request Rejected" cuando una IP hace ráfagas de peticiones. El harvester detecta esa página y reintenta con backoff largo (30 s, 3 intentos); si persiste, la fuente se aborta y se cuenta en el summary como `waf_blocks > 0` (no en silencio). La ingestión diaria educada (≥500 ms entre peticiones) no debería disparar el bloqueo. Si `waf_blocks > 0` de forma repetida, sube `PLACSP_DELAY_MS` (por ejemplo a 2000).
