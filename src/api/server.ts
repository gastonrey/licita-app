// buildServer(config, db) — Fastify instance wiring validation, payment, rate
// limiting, error envelope, request logging and all /v1 routes (SPEC §5 + §9).

import { createHash, randomUUID } from 'node:crypto';
import { parse as parseQueryString } from 'node:querystring';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createLogger } from '../obs/log.js';
import { createMetrics } from '../obs/metrics.js';
import { logRequest, hashIp, strField } from '../obs/requestlog.js';
import { paymentPreHandler, initPayments } from '../pay/middleware.js';
import { createRateLimiter } from './ratelimit.js';
import { buildOpenApi } from './openapi.js';
import { errorEnvelope, HttpError, type RouteCtx, validate } from './routes/common.js';
import { searchHandler, searchValidation } from './routes/search.js';
import { tenderHandler, tenderIdValidation } from './routes/tenders.js';
import {
  companyAwardsHandler,
  companyAwardsValidation,
  companyIdValidation,
  companyProfileHandler,
  opportunitiesHandler,
  opportunitiesValidation,
} from './routes/companies.js';
import { buyerHistoryHandler, buyerIdValidation } from './routes/buyers.js';
import { renewalsHandler, renewalsValidation } from './routes/renewals.js';
import { researchHandler, researchBodyValidation } from './routes/research.js';
import { demoHandler, demoRequestHandler, demoRequestValidation } from './routes/demo.js';
import { pricingHandler } from './routes/pricing.js';
import { billingAmountValidation, billingGetHandler, billingPurchaseHandler } from './routes/billing.js';
import { demoStatsHandler, recentStatsHandler, statsAuth, statsHandler, statsQueryValidation } from './routes/stats.js';

/** Rate-limit identity: X-PAYMENT-derived (proof hash) when present, else client IP. */
export function rateLimitKey(req: FastifyRequest): string {
  const pay = req.headers['x-payment'];
  if (typeof pay === 'string' && pay.length > 0) {
    return `pay:${createHash('sha256').update(pay).digest('hex').slice(0, 24)}`;
  }
  return `ip:${req.ip}`;
}

export async function buildServer(config: AppConfig, db: Db): Promise<FastifyInstance> {
  // Own payment initialization: REST payment enforcement must not depend on
  // mountMcp. mountMcp reuses this initialized runtime via getPaymentProvider().
  initPayments(config, db);

  const log = createLogger(config.logLevel);
  const metrics = createMetrics();
  const limiter = createRateLimiter({ capacity: 60, refillPerMinute: 60, maxKeys: config.rateLimitMaxKeys });
  const ctx: RouteCtx = { config, db, log, metrics };

  const app = Fastify({
    logger: false, // structured JSON logs go through src/obs/log.ts
    genReqId: () => randomUUID(),
    trustProxy: config.trustProxy,
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, parseQueryString(body as string)); } catch (error) { done(error as Error, undefined); }
  });

  // --- rate limiting (per client key, 60 req/min token bucket) ----------------
  app.addHook('onRequest', (req, reply, done) => {
    const r = limiter.take(rateLimitKey(req));
    if (!r.allowed) {
      metrics.inc('rate_limited_total');
      req.errorCode = 'rate_limited';
      void reply
        .code(429)
        .header('retry-after', String(r.retryAfterSec))
        .send(
          errorEnvelope(
            'rate_limited',
            `Rate limit exceeded: ${r.limit} requests per minute per client.`,
            `Retry after ${r.retryAfterSec}s. Reduce polling; results are also available via pagination.`,
          ),
        );
      return; // do not call done() — response already sent
    }
    done();
  });

  // --- async, fire-and-forget request logging ----------------------------------
  app.addHook('onResponse', (req, reply, done) => {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const params = (req.params ?? {}) as Record<string, unknown>;
    const routeUrl = req.routeOptions?.url;
    logRequest(db, log, {
      client_key: req.payment?.clientKey ?? hashIp(req.ip, config.operatorKey),
      endpoint: `${req.method} ${typeof routeUrl === 'string' ? routeUrl : req.url.split('?')[0]}`,
      method: req.method,
      status: reply.statusCode,
      latency_ms: reply.elapsedTime,
      cpv: strField(query.cpv),
      buyer:
        strField(query.buyer) ??
        (typeof routeUrl === 'string' && routeUrl.startsWith('/v1/buyers/')
          ? strField(String(params.id ?? ''))
          : null),
      company:
        strField(query.company) ??
        (typeof routeUrl === 'string' && routeUrl.startsWith('/v1/companies/')
          ? strField(String(params.id ?? ''))
          : null),
      // `paymentFailureKind` (set by the pay middleware) carries the granular
      // payment-rejection reason — falls back to the public `errorCode` for
      // non-payment failures (rate limit, internal, etc.). Operator-only.
      error: req.paymentFailureKind ?? req.errorCode ?? null,
      paid: req.payment?.paid ?? false,
      q: strField(query.q),
      zero_result: req.zeroResult === true,
      user_agent: strField(req.headers['user-agent']),
      source: 'rest',
    });
    done();
  });

  // --- error envelope ------------------------------------------------------------
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      req.errorCode = err.code;
      metrics.inc('api_errors', { code: err.code });
      return reply.code(err.statusCode).send(errorEnvelope(err.code, err.message, err.hint));
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      req.errorCode = 'internal';
      log.error('unhandled error', { error: String(err), stack: err.stack, url: req.url });
      metrics.inc('api_errors', { code: 'internal' });
      return reply
        .code(500)
        .send(
          errorEnvelope(
            'internal',
            'Internal server error.',
            'Retry; if it persists, report meta request id to the operator.',
          ),
        );
    }
    const code =
      status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'invalid_query';
    req.errorCode = code;
    metrics.inc('api_errors', { code });
    return reply.code(status).send(errorEnvelope(code, err.message));
  });

  app.setNotFoundHandler((req, reply) => {
    req.errorCode = 'not_found';
    void reply
      .code(404)
      .send(
        errorEnvelope(
          'not_found',
          `Route ${req.method} ${req.url.split('?')[0]} not found.`,
          'See GET /openapi.json or /llms.txt for available endpoints.',
        ),
      );
  });

  // --- routes -------------------------------------------------------------------
  app.get(
    '/v1/search',
    { preHandler: [paymentPreHandler('GET /v1/search'), searchValidation] },
    searchHandler(ctx),
  );
  app.get(
    '/v1/tenders/:id',
    { preHandler: [paymentPreHandler('GET /v1/tenders/:id'), tenderIdValidation] },
    tenderHandler(ctx),
  );
  app.get(
    '/v1/companies/:id',
    { preHandler: [paymentPreHandler('GET /v1/companies/:id'), companyIdValidation] },
    companyProfileHandler(ctx),
  );
  app.get(
    '/v1/companies/:id/awards',
    { preHandler: [paymentPreHandler('GET /v1/companies/:id/awards'), companyIdValidation, companyAwardsValidation] },
    companyAwardsHandler(ctx),
  );
  app.get(
    '/v1/companies/:id/opportunities',
    { preHandler: [paymentPreHandler('GET /v1/companies/:id/opportunities'), companyIdValidation, opportunitiesValidation] },
    opportunitiesHandler(ctx),
  );
  app.get(
    '/v1/buyers/:id/history',
    { preHandler: [paymentPreHandler('GET /v1/buyers/:id/history'), buyerIdValidation] },
    buyerHistoryHandler(ctx),
  );
  app.get(
    '/v1/renewals',
    { preHandler: [paymentPreHandler('GET /v1/renewals'), renewalsValidation] },
    renewalsHandler(ctx),
  );
  app.post(
    '/v1/research',
    { preHandler: [paymentPreHandler('POST /v1/research'), researchBodyValidation] },
    researchHandler(ctx),
  );
  // free endpoints
  app.get('/v1/demo', { preHandler: [paymentPreHandler('GET /v1/demo')] }, demoHandler(ctx));
  app.post('/v1/demo/request', { preHandler: [demoRequestValidation] }, demoRequestHandler(ctx));
  app.get('/v1/pricing', pricingHandler(ctx));
  app.get('/v1/billing', { preHandler: [paymentPreHandler('GET /v1/billing')] }, billingGetHandler(ctx));
  app.post(
    '/v1/billing/credits/:amount',
    {
      preHandler: [
        // The bundle price is keyed by the concrete amount (5|10|25), so the
        // payment preHandler is resolved from the route param per request.
        async (req: FastifyRequest, reply: FastifyReply) => {
          const amount = String((req.params as { amount?: unknown }).amount ?? '');
          // paymentPreHandler hooks are implemented async (they never call
          // done); invoke with a no-op done.
          const hook = paymentPreHandler(`POST /v1/billing/credits/${amount}`) as unknown as (
            req: FastifyRequest,
            reply: FastifyReply,
            done: () => void,
          ) => Promise<void>;
          await hook(req, reply, () => undefined);
        },
        billingAmountValidation,
      ],
    },
    billingPurchaseHandler(ctx),
  );
  app.get('/v1/stats', { preHandler: [statsAuth(config.operatorKey), statsQueryValidation] }, statsHandler(ctx));
  app.get('/v1/stats/demo', { preHandler: [statsAuth(config.operatorKey)] }, demoStatsHandler(ctx));
  app.get('/v1/stats/recent', { preHandler: [statsAuth(config.operatorKey)] }, recentStatsHandler(ctx));
  app.get('/openapi.json', async (_req, reply) => reply.send(buildOpenApi()));

  // Liveness/readiness: 200 when `SELECT 1` succeeds within a short timeout,
  // 503 otherwise. Free, no payment hook (used by Docker HEALTHCHECK).
  app.get('/health', async (_req, reply) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('db health check timed out')), 1000);
          timer.unref();
        }),
      ]);
      return reply.send({ status: 'ok', db: 'up' });
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  return app;
}
