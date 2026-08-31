// GET /v1/stats — operator-only observability aggregates (SPEC §5/§9, P0.7).
// One JSON document answering the agent-native experiment questions:
// requests, unique clients/agents, endpoint + source usage, queries, zero-result
// queries, payment-required responses, payments, revenue, repeat clients,
// top-searched CPVs/buyers/companies, failed requests, data gaps.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { envelope, HttpError, type RouteCtx } from './common.js';
import { validate } from './common.js';
import { z } from 'zod';

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === Number(value.slice(0, 4))
    && date.getUTCMonth() + 1 === Number(value.slice(5, 7))
    && date.getUTCDate() === Number(value.slice(8, 10));
}

const calendarDate = z.string().refine(isValidCalendarDate, 'invalid calendar date');
export const statsQuerySchema = z.object({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
}).refine(({ from, to }) => !from || !to || from <= to, { message: 'from must be on or before to', path: ['to'] });
export const statsQueryValidation = validate(statsQuerySchema, 'query');

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
// Zero-result queries: what clients search that the index cannot answer. These
// are the concrete data gaps the crawler should fill next, surfaced operator-side.
const TOP_ZERO_RESULT_SQL = `
SELECT q, count(*)::int AS n
FROM request_logs WHERE q IS NOT NULL AND zero_result
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
// MCP discovery: handshake rows (mcp:initialize / mcp:tools/list) written by
// logMcpHandshake, plus tool-call rows (mcp:<tool>). Distinct client_key per
// source answers "how many agents discovered the server" vs "how many paid".
// CASE WHEN (not FILTER) keeps the query pg-mem-compatible in tests.
const MCP_DISCOVERY_SQL = `
SELECT
  sum(CASE WHEN source = 'mcp' AND endpoint = 'mcp:initialize' THEN 1 ELSE 0 END)::int AS initialize_count,
  sum(CASE WHEN source = 'mcp' AND endpoint = 'mcp:tools/list' THEN 1 ELSE 0 END)::int AS tools_list_count,
  count(DISTINCT CASE WHEN source = 'mcp' THEN client_key END)::int AS mcp_clients,
  count(DISTINCT CASE WHEN source = 'mcp' AND endpoint IN ('mcp:initialize', 'mcp:tools/list')
                      AND status = 200 AND paid = false THEN client_key END)::int AS discovered_clients
FROM request_logs
`;
const MCP_HANDSHAKES_BY_UA_SQL = `
SELECT user_agent, count(*)::int AS n
FROM request_logs
WHERE source = 'mcp' AND (endpoint = 'mcp:initialize' OR endpoint = 'mcp:tools/list')
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

// --- growth (P0.8): agent-funnel + North Star metric ---------------------------
// x402 payments are the only rows with payer_address (status 'settled'); dev rows
// carry status 'success' and no payer, so every payer metric is scoped to x402.
// CASE WHEN (not FILTER) keeps the queries pg-mem-portable in tests, and "last 7
// days" uses now() - interval '7 days' because pg-mem cannot cast `date` to
// `timestamptz` (CURRENT_DATE - 7 would throw there). LIKE avoids backslash
// escapes (pg-mem does not honor `\_`).
const GROWTH_PAYERS_SQL = `
SELECT
  count(DISTINCT payer_address)::int AS paid_agents,
  count(DISTINCT CASE WHEN created_at >= (now() - interval '7 days') THEN payer_address END)::int AS weekly_active,
  coalesce(sum(CASE WHEN status = 'settled' THEN amount_usd ELSE 0 END), 0) AS settled_revenue
FROM payments
WHERE payer_address IS NOT NULL
`;
// Per-payer payment timestamps (ascending). First/second-payment milestones,
// repeat detection (>=2 payments) and the 1st->2nd gap are derived from this
// grouped fetch in TS: pg-mem ignores `HAVING count(*) >= 2`, and the pure-SQL
// "min over payments after the payer's first" self-join adds portability risk
// for no gain. The aggregates above stay in SQL.
const GROWTH_PAYER_TIMELINE_SQL = `
SELECT payer_address, created_at
FROM payments
WHERE payer_address IS NOT NULL
ORDER BY payer_address, created_at
`;
// Paid-agent call volume: match request_logs.client_key = 'x402_' || payer_address.
// An IN subquery (not a join) so a payer with N payments never multiplies the
// call count, and no outer-alias reference (pg-mem cannot see correlated
// EXISTS/join aliases). CASE WHEN (not FILTER) keeps it pg-mem-portable.
const GROWTH_CALLS_SQL = `
SELECT
  count(*)::int AS calls,
  count(DISTINCT client_key)::int AS agents
FROM request_logs
WHERE client_key IN (
  SELECT 'x402_' || payer_address
  FROM payments
  WHERE payer_address IS NOT NULL
)
`;
// REST endpoints are logged with a method prefix ('GET /v1/demo',
// 'POST /v1/research'); the suffix match also covers the bare '/v1/demo'
// spelling. discovered/queried are both distinct client_key per the spec's own
// definitions; the funnel stages are kept as numbers only (the dashboard
// renders them via source_labels).
const GROWTH_FUNNEL_SQL = `
SELECT
  count(DISTINCT client_key)::int AS discovered,
  count(DISTINCT client_key)::int AS queried,
  sum(CASE WHEN endpoint LIKE '%/v1/demo' AND source = 'rest' THEN 1 ELSE 0 END)::int AS demo,
  sum(CASE WHEN endpoint LIKE '%/v1/research' THEN 1 ELSE 0 END)::int AS research_calls,
  sum(CASE WHEN endpoint LIKE '%/v1/research' AND paid THEN 1 ELSE 0 END)::int AS research_paid
FROM request_logs
`;
const GROWTH_FUNNEL_LABELS = ['discovered', 'initialized', 'queried', 'demo', 'paid', 'repeated', 'revenue'] as const;

// GET /v1/stats/recent — operator-only raw request-log feed for the operator
// dashboard. Returns the newest rows first; the dashboard re-polls it on a timer.
const RECENT_SQL = `
SELECT ts, client_key, endpoint, method, status, latency_ms, paid, source,
       user_agent, q, cpv, buyer, company, error
FROM request_logs
ORDER BY ts DESC
LIMIT $1
`;

const EMPTY_DEMO = { rows: [] as Record<string, unknown>[] };
async function optionalQuery(db: RouteCtx['db'], sql: string, values: unknown[] = []) {
  try { const result = await db.query(sql, values); return { rows: result.rows, missing: false }; }
  catch { return { ...EMPTY_DEMO, missing: true }; }
}

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
    const query = (req.query ?? {}) as { from?: string; to?: string };
    const rangeValues: Date[] = [];
    let range = '';
    if (query.from || query.to) {
      const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(0);
      const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : new Date('9999-12-31T00:00:00.000Z');
      to.setUTCDate(to.getUTCDate() + 1);
      rangeValues.push(from, to);
      range = ' WHERE created_at >= $1 AND created_at < $2';
    }
    const scope = (sql: string, table: 'request_logs' | 'payments', column: 'ts' | 'created_at') => {
      if (!range) return sql;
      const condition = `${column} >= $1 AND ${column} < $2`;
      return sql.includes(`FROM ${table} WHERE`)
        ? sql.replace(`FROM ${table} WHERE`, `FROM ${table} WHERE ${condition} AND`)
        : sql.replace(`FROM ${table}`, `FROM ${table} WHERE ${condition}`);
    };
    const requestSql = (sql: string) => scope(sql, 'request_logs', 'ts');
    const paymentSql = (sql: string) => scope(sql, 'payments', 'created_at');
    const growthPayersSql = range ? `${GROWTH_PAYERS_SQL} AND created_at >= $1 AND created_at < $2` : GROWTH_PAYERS_SQL;
    const growthTimelineSql = range ? `${GROWTH_PAYER_TIMELINE_SQL.replace('WHERE payer_address IS NOT NULL', 'WHERE payer_address IS NOT NULL AND created_at >= $1 AND created_at < $2')}` : GROWTH_PAYER_TIMELINE_SQL;
    const growthCallsSql = range ? `${GROWTH_CALLS_SQL.replace('WHERE client_key IN', 'WHERE ts >= $1 AND ts < $2 AND client_key IN').replace('WHERE payer_address IS NOT NULL', 'WHERE payer_address IS NOT NULL AND created_at >= $1 AND created_at < $2')}` : GROWTH_CALLS_SQL;
    const growthFunnelSql = range ? `${GROWTH_FUNNEL_SQL.replace('FROM request_logs', 'FROM request_logs WHERE ts >= $1 AND ts < $2')}` : GROWTH_FUNNEL_SQL;
    const mcpDiscoverySql = range ? `${MCP_DISCOVERY_SQL} WHERE ts >= $1 AND ts < $2` : MCP_DISCOVERY_SQL;
    const mcpHandshakesSql = range ? `${MCP_HANDSHAKES_BY_UA_SQL.replace('GROUP BY user_agent', 'AND ts >= $1 AND ts < $2 GROUP BY user_agent')}` : MCP_HANDSHAKES_BY_UA_SQL;
    const growthArgs = rangeValues;
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
      topZeroQueries,
      uniqueUserAgents,
      topUserAgents,
      mcpDiscovery,
      mcpHandshakesByUa,
      failed,
      failedRate,
      nullRates,
      growthPayers,
      growthTimeline,
      growthCalls,
      growthFunnel,
    ] = await Promise.all([
       db.query(requestSql(UNIQUE_CLIENTS_SQL), rangeValues),
       db.query(requestSql(BY_ENDPOINT_SQL), rangeValues),
       db.query(requestSql(BY_SOURCE_SQL), rangeValues),
       db.query(requestSql(ZERO_RESULT_SQL), rangeValues),
       db.query(requestSql(PAYMENT_REQUIRED_SQL), rangeValues),
       db.query(paymentSql(PAYMENTS_SQL), rangeValues),
       db.query(paymentSql(PAYMENTS_BY_NETWORK_SQL), rangeValues),
       db.query(requestSql(REPEAT_CLIENTS_SQL), rangeValues),
       db.query(requestSql(TOP_FIELD_SQL('cpv')), rangeValues),
       db.query(requestSql(TOP_FIELD_SQL('buyer')), rangeValues),
       db.query(requestSql(TOP_FIELD_SQL('company')), rangeValues),
       db.query(requestSql(TOP_SEARCHES_SQL), rangeValues),
       db.query(requestSql(TOP_ZERO_RESULT_SQL), rangeValues),
       db.query(requestSql(UNIQUE_USER_AGENTS_SQL), rangeValues),
       db.query(requestSql(TOP_USER_AGENTS_SQL), rangeValues),
       db.query(mcpDiscoverySql, range ? growthArgs : []),
       db.query(mcpHandshakesSql, range ? growthArgs : []),
       db.query(requestSql(FAILED_SQL), rangeValues),
       db.query(requestSql(FAILED_RATE_SQL), rangeValues),
      db.query(NULL_RATES_SQL),
       db.query(growthPayersSql, range ? growthArgs : []),
       db.query(growthTimelineSql, range ? growthArgs : []),
       db.query(growthCallsSql, range ? growthArgs : []),
       db.query(growthFunnelSql, range ? growthArgs : []),
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

    // --- growth (P0.8): derive the agent funnel + North Star --------------------
    const gp = growthPayers.rows[0] ?? { paid_agents: 0, weekly_active: 0, settled_revenue: 0 };
    const paidAgents = Number(gp.paid_agents);
    const weeklyActivePayingAgents = Number(gp.weekly_active);
    const settledRevenue = Math.round(Number(gp.settled_revenue) * 100) / 100;

    // First/second payment milestones, repeat detection and the average 1st->2nd
    // gap, from the grouped timeline fetch (rows arrive sorted by payer,
    // created_at ascending). Repeat needs >=2 payments per payer — derived here
    // because pg-mem ignores `HAVING count(*) >= 2`.
    const timeline = new Map<string, Date[]>();
    for (const r of growthTimeline.rows) {
      const times = timeline.get(String(r.payer_address)) ?? [];
      times.push(r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)));
      timeline.set(String(r.payer_address), times);
    }
    let repeatAgents = 0;
    let firstPayment: string | null = null;
    let secondPayment: string | null = null;
    let secondGapSum = 0;
    let secondGapCount = 0;
    for (const times of timeline.values()) {
      if (times.length === 0) continue;
      const firstMs = times[0].getTime();
      if (firstPayment === null || firstMs < Date.parse(firstPayment)) firstPayment = times[0].toISOString();
      if (times.length >= 2) {
        repeatAgents += 1;
        const secondMs = times[1].getTime();
        if (secondPayment === null || secondMs < Date.parse(secondPayment)) secondPayment = times[1].toISOString();
        secondGapSum += (secondMs - firstMs) / 86400000;
        secondGapCount += 1;
      }
    }
    const timeToSecondPurchaseDays = secondGapCount > 0 ? Math.round((secondGapSum / secondGapCount) * 10) / 10 : 0;

    const gfc = growthFunnel.rows[0] ?? { discovered: 0, queried: 0, demo: 0, research_calls: 0, research_paid: 0 };
    const researchCalls = Number(gfc.research_calls);
    const researchPaidCalls = Number(gfc.research_paid);
    const freeDemoCalls = Number(gfc.demo);
    const gc = growthCalls.rows[0] ?? { calls: 0, agents: 0 };

    const growth = {
      weekly_active_paying_agents: weeklyActivePayingAgents,
      paid_agents: paidAgents,
      repeat_paid_agents: repeatAgents,
      first_payment: firstPayment,
      second_payment: secondPayment,
      time_to_second_purchase_days: timeToSecondPurchaseDays,
      revenue_per_agent: paidAgents > 0 ? Math.round((settledRevenue / paidAgents) * 100) / 100 : 0,
      calls_per_agent: paidAgents > 0 ? Math.round((Number(gc.calls) / paidAgents) * 10) / 10 : 0,
      free_demo_calls: freeDemoCalls,
      research_calls: researchCalls,
      research_paid_calls: researchPaidCalls,
      research_conversion: researchCalls > 0 ? Math.round((researchPaidCalls / researchCalls) * 10000) / 10000 : 0,
      funnel: {
        discovered: Number(gfc.discovered),
        initialized: Number(mcpDiscovery.rows[0]?.initialize_count ?? 0),
        queried: Number(gfc.queried),
        demo: freeDemoCalls,
        paid: paidAgents,
        repeated: repeatAgents,
        revenue: settledRevenue,
      },
      source_labels: [...GROWTH_FUNNEL_LABELS],
    };

    const data = {
      unique_clients: Number(clients.rows[0]?.n ?? 0),
      total_requests: requestTotal,
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
        top: topZeroQueries.rows.map((r) => ({ q: String(r.q), requests: Number(r.n) })),
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
      mcp_discovery: {
        initialize_count: Number(mcpDiscovery.rows[0]?.initialize_count ?? 0),
        tools_list_count: Number(mcpDiscovery.rows[0]?.tools_list_count ?? 0),
        mcp_clients: Number(mcpDiscovery.rows[0]?.mcp_clients ?? 0),
        discovered_clients: Number(mcpDiscovery.rows[0]?.discovered_clients ?? 0),
        top_handshake_user_agents: mcpHandshakesByUa.rows.map((r) => ({
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
      growth,
      in_memory_metrics: ctx.metrics.snapshot(),
    };

    // New product-quality pillars deliberately live beside the legacy document.
    // Queries are optional for old test fixtures and pre-007 databases.
    const reqRange = range ? ' WHERE ts >= $1 AND ts < $2' : '';
    const reqArgs = rangeValues;
    const [caq, demos, statuses, economics, gaps, paymentTimeline, paidByEndpoint] = await Promise.all([
      optionalQuery(db, `SELECT source AS channel, count(*)::int AS requests,
        sum(CASE WHEN paid THEN 1 ELSE 0 END)::int AS paid_requests,
        count(DISTINCT client_key)::int AS unique_clients FROM request_logs${reqRange} GROUP BY source ORDER BY source`, reqArgs),
      optionalQuery(db, `SELECT id,email,channel,source_url,status,created_at FROM demo_requests${range} ORDER BY id DESC LIMIT 50`, rangeValues),
      optionalQuery(db, `SELECT status,count(*)::int AS n FROM demo_requests${range} GROUP BY status`, rangeValues),
      optionalQuery(db, `SELECT endpoint,count(*)::int AS requests,
        sum(CASE WHEN paid THEN 1 ELSE 0 END)::int AS paid_requests
        FROM request_logs${reqRange} GROUP BY endpoint ORDER BY requests DESC`, reqArgs),
      optionalQuery(db, `SELECT endpoint,
        sum(CASE WHEN zero_result THEN 1 ELSE 0 END)::int AS zero_result_requests,
        count(*)::int AS total_requests FROM request_logs${reqRange}
        GROUP BY endpoint HAVING sum(CASE WHEN zero_result THEN 1 ELSE 0 END) > 0 ORDER BY endpoint`, reqArgs),
      optionalQuery(db, `SELECT payer_address,amount_usd,created_at FROM payments
        WHERE payer_address IS NOT NULL AND status = 'settled'${range ? ' AND created_at >= $1 AND created_at < $2' : ''}
        ORDER BY payer_address,created_at`, rangeValues),
       optionalQuery(db, `SELECT endpoint, sum(amount_usd) AS revenue
         FROM payments WHERE status = 'settled'${range ? ' AND created_at >= $1 AND created_at < $2' : ''} GROUP BY endpoint`, rangeValues),
    ]);
    const byStatus: Record<string, number> = { new: 0, contacted: 0, used: 0, paid: 0 };
    for (const row of statuses.rows) if (row.status in byStatus) byStatus[String(row.status)] = Number(row.n);
    const timelineByPayer = new Map<string, Record<string, unknown>[]>();
    for (const row of paymentTimeline.rows) {
      const list = timelineByPayer.get(String(row.payer_address)) ?? [];
      list.push(row); timelineByPayer.set(String(row.payer_address), list);
    }
    let newRevenue = 0, repeatRevenue = 0, newPayments = 0, repeatPayments = 0;
    for (const rows of timelineByPayer.values()) rows.forEach((row, i) => {
      const amount = Number(row.amount_usd);
      if (i === 0) { newRevenue += amount; newPayments++; } else { repeatRevenue += amount; repeatPayments++; }
    });
    const stage = [Number((data.growth as { funnel: Record<string, unknown> }).funnel.discovered),
      Number((data.growth as { funnel: Record<string, unknown> }).funnel.initialized), Number(growthFunnel.rows[0]?.queried ?? 0),
       Object.values(byStatus).reduce((sum, count) => sum + count, 0), paidAgents, repeatAgents, settledRevenue];
    const names = GROWTH_FUNNEL_LABELS;
    const conversions = names.slice(0, -1).map((from, i) => {
      const value = rate(stage[i + 1], stage[i]);
      return { from, to: names[i + 1], rate: value, ...(value !== null && value > 1 ? { note: 'initialized counts MCP handshake rows, queried counts distinct clients — rate may exceed 1.0' } : {}) };
    });
    const demoRows = demos.rows.map((row) => ({ ...row, converted: row.status === 'paid' }));
    (data as Record<string, unknown>).caq_by_channel = caq.rows.map((r) => ({ channel: String(r.channel), requests: Number(r.requests), paid_requests: Number(r.paid_requests), unique_clients: Number(r.unique_clients) }));
    const growthObject = data.growth as unknown as Record<string, unknown>;
    // Keep the legacy funnel enumerable shape for pre-007 fixtures; once the
    // demo table exists the richer conversion series is exposed as specified.
    (data as Record<string, unknown>).growth = demos.missing
      ? growthObject
      : { ...growthObject, funnel: { ...(growthObject.funnel as Record<string, unknown>), conversions } };
    (data as Record<string, unknown>).revenue_new_vs_repeat = { new_revenue_usd: Math.round(newRevenue * 100) / 100, repeat_revenue_usd: Math.round(repeatRevenue * 100) / 100, new_payments: newPayments, repeat_payments: repeatPayments };
    (data as Record<string, unknown>).demo_pipeline = { by_status: byStatus, requests: demoRows };
    const usageByEndpoint = new Map(economics.rows.map((r) => [String(r.endpoint), {
      requests: Number(r.requests), paid_requests: Number(r.paid_requests),
    }]));
    const revenueByEndpoint = new Map(paidByEndpoint.rows.map((r) => [String(r.endpoint), Number(r.revenue)]));
    // Payments are authoritative for revenue. Keep payment-only endpoints so an
    // accounting event cannot disappear merely because its request log was lost;
    // with no usage, revenue_per_call is explicitly zero rather than fabricated.
    for (const endpoint of revenueByEndpoint.keys()) if (!usageByEndpoint.has(endpoint)) usageByEndpoint.set(endpoint, { requests: 0, paid_requests: 0 });
    (data as Record<string, unknown>).endpoint_economics = [...usageByEndpoint.entries()].map(([endpoint, usage]) => {
      const revenue = revenueByEndpoint.get(endpoint) ?? 0;
      return { endpoint, requests: usage.requests, paid_requests: usage.paid_requests, revenue_usd: Math.round(revenue * 100) / 100, revenue_per_call: usage.requests ? Math.round((revenue / usage.requests) * 10000) / 10000 : 0, paid_ratio: rate(usage.paid_requests, usage.requests) };
    });
    (data as Record<string, unknown>).zero_result_by_endpoint = gaps.rows.map((r) => ({ endpoint: String(r.endpoint), zero_result_requests: Number(r.zero_result_requests), total_requests: Number(r.total_requests) }));

    return reply.send(envelope(req, data));
  };
}

export function demoStatsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const query = (req.query as { limit?: unknown; from?: string; to?: string } | undefined) ?? {};
    const limit = parseRecentLimit(query.limit);
    const values: unknown[] = [limit];
    const range = query.from || query.to
      ? { from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(0), to: query.to ? new Date(`${query.to}T00:00:00.000Z`) : new Date('9999-12-31T00:00:00.000Z') }
      : null;
    if (range) range.to.setUTCDate(range.to.getUTCDate() + 1);
    const requestSql = range ? 'SELECT id,email,channel,source_url,status,created_at FROM demo_requests WHERE created_at >= $2 AND created_at < $3 ORDER BY id DESC LIMIT $1' : 'SELECT id,email,channel,source_url,status,created_at FROM demo_requests ORDER BY id DESC LIMIT $1';
    if (range) values.push(range.from, range.to);
    const [requests, statuses] = await Promise.all([
      ctx.db.query(requestSql, values),
      ctx.db.query(range ? 'SELECT status,count(*)::int AS n FROM demo_requests WHERE created_at >= $1 AND created_at < $2 GROUP BY status' : 'SELECT status,count(*)::int AS n FROM demo_requests GROUP BY status', range ? [range.from, range.to] : []),
    ]);
    const by_status: Record<string, number> = { new: 0, contacted: 0, used: 0, paid: 0 };
    for (const row of statuses.rows) if (row.status in by_status) by_status[String(row.status)] = Number(row.n);
    return reply.send(envelope(req, { requests: requests.rows, by_status }));
  };
}

/** GET /v1/stats/recent — newest request_logs rows (free, operator-only auth). */
export function recentStatsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const query = (req.query as { limit?: unknown; from?: string; to?: string } | undefined) ?? {};
    const limit = parseRecentLimit(query.limit);
    const values: unknown[] = [limit];
    let sql = RECENT_SQL;
    if (query.from || query.to) {
      const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(0);
      const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : new Date('9999-12-31T00:00:00.000Z');
      to.setUTCDate(to.getUTCDate() + 1);
      sql = RECENT_SQL.replace('ORDER BY', 'WHERE ts >= $2 AND ts < $3 ORDER BY');
      values.push(from, to);
    }
    const { rows } = await ctx.db.query(sql, values);
    return reply.send(envelope(req, rows));
  };
}
