// GET /v1/stats — operator-only observability aggregates (SPEC §5/§9, P0.7).
// One JSON document answering the agent-native experiment questions:
// requests, unique clients/agents, endpoint + source usage, queries, zero-result
// queries, payment-required responses, payments, revenue, repeat clients,
// top-searched CPVs/buyers/companies, failed requests, data gaps.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { envelope, HttpError, type RouteCtx } from './common.js';

/**
 * Constant-time key comparison: both sides are SHA-256 hashed first (which
 * normalizes length, so timingSafeEqual never early-exits on length mismatch
 * and the digest comparison does not leak key length or content timing).
 */
function operatorKeyMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Requires header x-operator-key === config.operatorKey, else 401 error envelope. */
export function statsAuth(operatorKey: string): preHandlerHookHandler {
  return async (req) => {
    const key = req.headers['x-operator-key'];
    if (typeof key !== 'string' || !operatorKeyMatches(key, operatorKey)) {
      throw new HttpError(
        401,
        'invalid_query',
        'Missing or invalid x-operator-key header',
        'Operator only: set header x-operator-key to the OPERATOR_KEY value.',
      );
    }
  };
}

const UNIQUE_CLIENTS_SQL = `SELECT count(DISTINCT client_key)::int AS n FROM request_logs WHERE client_key IS NOT NULL`;
const BY_ENDPOINT_SQL = `
SELECT endpoint, count(*)::int AS requests,
       count(*) FILTER (WHERE paid)::int AS paid_requests
FROM request_logs
GROUP BY endpoint ORDER BY requests DESC, endpoint
`;
const BY_SOURCE_SQL = `
SELECT source, count(*)::int AS requests
FROM request_logs GROUP BY source ORDER BY requests DESC, source
`;
const ZERO_RESULT_SQL = `
SELECT sum(CASE WHEN zero_result THEN 1 ELSE 0 END)::int AS zero_result_count,
       count(*)::int AS total
FROM request_logs
`;
const PAYMENT_REQUIRED_SQL = `
SELECT count(*)::int AS n FROM request_logs WHERE status = 402 OR error = 'payment_required'
`;
const PAYMENTS_SQL = `
SELECT status, count(*)::int AS n, coalesce(sum(amount_usd), 0) AS amount
FROM payments GROUP BY status ORDER BY status
`;
const PAYMENTS_BY_NETWORK_SQL = `
SELECT provider, coalesce(network, provider) AS network,
       count(*)::int AS n, coalesce(sum(amount_usd), 0) AS amount
FROM payments GROUP BY provider, network
`;
const REPEAT_CLIENTS_SQL = `
SELECT client_key, count(*)::int AS paid_requests
FROM request_logs WHERE paid GROUP BY client_key HAVING count(*) >= 2
ORDER BY paid_requests DESC, client_key LIMIT 10
`;
const TOP_FIELD_SQL = (col: 'cpv' | 'buyer' | 'company') => `
SELECT ${col} AS value, count(*)::int AS n
FROM request_logs WHERE ${col} IS NOT NULL
GROUP BY ${col} ORDER BY n DESC, ${col} LIMIT 10
`;
const TOP_SEARCHES_SQL = `
SELECT q, count(*)::int AS n
FROM request_logs WHERE q IS NOT NULL
GROUP BY q ORDER BY n DESC, q LIMIT 10
`;
const UNIQUE_USER_AGENTS_SQL = `
SELECT count(DISTINCT user_agent)::int AS n FROM request_logs WHERE user_agent IS NOT NULL
`;
const TOP_USER_AGENTS_SQL = `
SELECT user_agent, count(*)::int AS n
FROM request_logs WHERE user_agent IS NOT NULL
GROUP BY user_agent ORDER BY n DESC, user_agent LIMIT 10
`;
const FAILED_SQL = `SELECT count(*)::int AS n FROM request_logs WHERE status >= 400 OR error IS NOT NULL`;
const FAILED_RATE_SQL = `
SELECT sum(CASE WHEN status >= 400 OR error IS NOT NULL THEN 1 ELSE 0 END)::int AS failed,
       count(*)::int AS total
FROM request_logs
`;
const NULL_RATES_SQL = `
SELECT
  count(*)::int AS awards_total,
  count(*) FILTER (WHERE value IS NULL)::int AS value_null,
  count(*) FILTER (WHERE winner_company_id IS NULL)::int AS winner_null
FROM awards
`;

// GET /v1/stats/recent — operator-only raw request-log feed for the operator
// dashboard. Returns the newest rows first; the dashboard re-polls it on a timer.
const RECENT_SQL = `
SELECT ts, client_key, endpoint, method, status, latency_ms, paid, source,
       user_agent, q, cpv, buyer, company, error
FROM request_logs
ORDER BY ts DESC
LIMIT $1
`;

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10000) / 10000 : null;
}

/** ?limit= — default 50, clamped to [1, 200]; anything invalid falls back to 50. */
export function parseRecentLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 50;
  return Math.min(n, 200);
}

export function statsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const db = ctx.db;
    const [
      clients,
      byEndpoint,
      bySource,
      zeroResult,
      paymentRequired,
      payments,
      paymentsByNetwork,
      repeatClients,
      topCpv,
      topBuyer,
      topCompany,
      topSearches,
      uniqueUserAgents,
      topUserAgents,
      failed,
      failedRate,
      nullRates,
    ] = await Promise.all([
      db.query(UNIQUE_CLIENTS_SQL),
      db.query(BY_ENDPOINT_SQL),
      db.query(BY_SOURCE_SQL),
      db.query(ZERO_RESULT_SQL),
      db.query(PAYMENT_REQUIRED_SQL),
      db.query(PAYMENTS_SQL),
      db.query(PAYMENTS_BY_NETWORK_SQL),
      db.query(REPEAT_CLIENTS_SQL),
      db.query(TOP_FIELD_SQL('cpv')),
      db.query(TOP_FIELD_SQL('buyer')),
      db.query(TOP_FIELD_SQL('company')),
      db.query(TOP_SEARCHES_SQL),
      db.query(UNIQUE_USER_AGENTS_SQL),
      db.query(TOP_USER_AGENTS_SQL),
      db.query(FAILED_SQL),
      db.query(FAILED_RATE_SQL),
      db.query(NULL_RATES_SQL),
    ]);

    const paymentsByStatus: Record<string, { count: number; amount_usd: number }> = {};
    let attempts = 0;
    let successes = 0;
    let revenue = 0;
    for (const r of payments.rows) {
      const status = String(r.status);
      const n = Number(r.n);
      const amount = Number(r.amount);
      paymentsByStatus[status] = { count: n, amount_usd: amount };
      attempts += n;
      if (status === 'success') {
        successes += n;
        revenue += amount;
      }
    }

    const revenueByNetwork = paymentsByNetwork.rows.map((r) => ({
      provider: String(r.provider),
      network: String(r.network),
      count: Number(r.n),
      amount_usd: Math.round(Number(r.amount) * 100) / 100,
    }));

    const repeatRows = repeatClients.rows;
    const repeatTotal = repeatRows.reduce((s, r) => s + Number(r.paid_requests), 0);

    const nr = nullRates.rows[0] ?? { awards_total: 0, value_null: 0, winner_null: 0 };
    const awardsTotal = Number(nr.awards_total);

    const zr = zeroResult.rows[0] ?? { zero_result_count: 0, total: 0 };
    const zeroCount = Number(zr.zero_result_count);
    const zeroTotal = Number(zr.total);

    const fr = failedRate.rows[0] ?? { failed: 0, total: 0 };
    const failedCount = Number(fr.failed);
    const requestTotal = Number(fr.total);

    const data = {
      unique_clients: Number(clients.rows[0]?.n ?? 0),
      requests_by_endpoint: byEndpoint.rows.map((r) => ({
        endpoint: String(r.endpoint),
        requests: Number(r.requests),
        paid_requests: Number(r.paid_requests),
      })),
      requests_by_source: bySource.rows.map((r) => ({
        source: String(r.source),
        requests: Number(r.requests),
      })),
      zero_result_queries: {
        count: zeroCount,
        rate: rate(zeroCount, zeroTotal),
      },
      payment_required_responses: Number(paymentRequired.rows[0]?.n ?? 0),
      payments: {
        attempts,
        successes,
        revenue_usd: Math.round(revenue * 100) / 100,
        by_status: paymentsByStatus,
        by_network_provider: revenueByNetwork,
      },
      repeat_clients: {
        count: repeatRows.length,
        paid_requests_total: repeatTotal,
        top: repeatRows.map((r) => ({
          client_key: String(r.client_key),
          paid_requests: Number(r.paid_requests),
        })),
      },
      top_searches: topSearches.rows.map((r) => ({ q: String(r.q), requests: Number(r.n) })),
      unique_user_agents: {
        count: Number(uniqueUserAgents.rows[0]?.n ?? 0),
        top: topUserAgents.rows.map((r) => ({
          user_agent: String(r.user_agent),
          requests: Number(r.n),
        })),
      },
      top_requested: {
        cpvs: topCpv.rows.map((r) => ({ cpv: String(r.value), requests: Number(r.n) })),
        buyers: topBuyer.rows.map((r) => ({ buyer: String(r.value), requests: Number(r.n) })),
        companies: topCompany.rows.map((r) => ({ company: String(r.value), requests: Number(r.n) })),
      },
      failed_queries: Number(failed.rows[0]?.n ?? 0),
      failed_requests_rate: {
        count: failedCount,
        total: requestTotal,
        rate: rate(failedCount, requestTotal),
      },
      data_null_rates: {
        awards_total: awardsTotal,
        award_value_null_rate: rate(Number(nr.value_null), awardsTotal),
        award_winner_null_rate: rate(Number(nr.winner_null), awardsTotal),
      },
      in_memory_metrics: ctx.metrics.snapshot(),
    };

    return reply.send(envelope(req, data));
  };
}

/** GET /v1/stats/recent — newest request_logs rows (free, operator-only auth). */
export function recentStatsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const limit = parseRecentLimit((req.query as Record<string, unknown> | undefined)?.limit);
    const { rows } = await ctx.db.query(RECENT_SQL, [limit]);
    return reply.send(envelope(req, rows));
  };
}
