// GET /v1/stats — operator-only observability aggregates (SPEC §5/§9).

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { envelope, HttpError, type RouteCtx } from './common.js';

/** Requires header x-operator-key === config.operatorKey, else 401 error envelope. */
export function statsAuth(operatorKey: string): preHandlerHookHandler {
  return async (req) => {
    const key = req.headers['x-operator-key'];
    if (typeof key !== 'string' || key !== operatorKey) {
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
const PAYMENTS_SQL = `
SELECT status, count(*)::int AS n, coalesce(sum(amount_usd), 0) AS amount
FROM payments GROUP BY status ORDER BY status
`;
const TOP_FIELD_SQL = (col: 'cpv' | 'buyer' | 'company') => `
SELECT ${col} AS value, count(*)::int AS n
FROM request_logs WHERE ${col} IS NOT NULL
GROUP BY ${col} ORDER BY n DESC, ${col} LIMIT 10
`;
const FAILED_SQL = `SELECT count(*)::int AS n FROM request_logs WHERE status >= 400 OR error IS NOT NULL`;
const NULL_RATES_SQL = `
SELECT
  count(*)::int AS awards_total,
  count(*) FILTER (WHERE value IS NULL)::int AS value_null,
  count(*) FILTER (WHERE winner_company_id IS NULL)::int AS winner_null
FROM awards
`;

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10000) / 10000 : null;
}

export function statsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const db = ctx.db;
    const [clients, byEndpoint, payments, topCpv, topBuyer, topCompany, failed, nullRates] =
      await Promise.all([
        db.query(UNIQUE_CLIENTS_SQL),
        db.query(BY_ENDPOINT_SQL),
        db.query(PAYMENTS_SQL),
        db.query(TOP_FIELD_SQL('cpv')),
        db.query(TOP_FIELD_SQL('buyer')),
        db.query(TOP_FIELD_SQL('company')),
        db.query(FAILED_SQL),
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

    const nr = nullRates.rows[0] ?? { awards_total: 0, value_null: 0, winner_null: 0 };
    const awardsTotal = Number(nr.awards_total);

    const data = {
      unique_clients: Number(clients.rows[0]?.n ?? 0),
      requests_by_endpoint: byEndpoint.rows.map((r) => ({
        endpoint: String(r.endpoint),
        requests: Number(r.requests),
        paid_requests: Number(r.paid_requests),
      })),
      payments: {
        attempts,
        successes,
        revenue_usd: Math.round(revenue * 100) / 100,
        by_status: paymentsByStatus,
      },
      top_requested: {
        cpvs: topCpv.rows.map((r) => ({ cpv: String(r.value), requests: Number(r.n) })),
        buyers: topBuyer.rows.map((r) => ({ buyer: String(r.value), requests: Number(r.n) })),
        companies: topCompany.rows.map((r) => ({ company: String(r.value), requests: Number(r.n) })),
      },
      failed_queries: Number(failed.rows[0]?.n ?? 0),
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
