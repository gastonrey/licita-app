// buildServer(config, db) — Fastify instance wiring validation, payment, rate
// limiting, error envelope, request logging and all /v1 routes (SPEC §5 + §9).

import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createLogger } from '../obs/log.js';
import { createMetrics } from '../obs/metrics.js';
import { logRequest } from '../obs/requestlog.js';
import { paymentPreHandler, initPayments } from '../pay/middleware.js';
import { createRateLimiter } from './ratelimit.js';
import { buildOpenApi } from './openapi.js';
import { errorEnvelope, HttpError, type RouteCtx } from './routes/common.js';
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
import { pricingHandler } from './routes/pricing.js';
import { statsAuth, statsHandler } from './routes/stats.js';

/** Rate-limit identity: X-PAYMENT-derived (proof hash) when present, else client IP. */
export function rateLimitKey(req: FastifyRequest): string {
  const pay = req.headers['x-payment'];
  if (typeof pay === 'string' && pay.length > 0) {
    return `pay:${createHash('sha256').update(pay).digest('hex').slice(0, 24)}`;
  }
  return `ip:${req.ip}`;
}

function strField(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.slice(0, 200);
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
      client_key: req.payment?.clientKey ?? req.ip ?? null,
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
      error: req.errorCode ?? null,
      paid: req.payment?.paid ?? false,
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
  // free endpoints
  app.get('/v1/pricing', pricingHandler(ctx));
  app.get('/v1/stats', { preHandler: [statsAuth(config.operatorKey)] }, statsHandler(ctx));
  app.get('/openapi.json', async (_req, reply) => reply.send(buildOpenApi()));

  return app;
}
