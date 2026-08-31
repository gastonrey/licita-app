// statsAuth: timing-safe operator key check — 401 on missing/wrong key
// (including different-length keys), pass-through on the right key.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { statsAuth } from '../../src/api/routes/stats.js';

const OPERATOR_KEY = 'correct-horse-battery-staple';

function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    void reply.code(status).send({ error: { code: 'invalid_query', message: err.message } });
  });
  app.get('/v1/stats', { preHandler: [statsAuth(OPERATOR_KEY)] }, async () => ({ ok: true }));
  app.get('/v1/stats/demo', { preHandler: [statsAuth(OPERATOR_KEY)] }, async () => ({ ok: true }));
  return app;
}

describe('statsAuth', () => {
  it('401 without the header', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('protects the demo admin feed without the header', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stats/demo' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401 on a wrong key of the same length', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-operator-key': 'xorrect-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('401 on a wrong key of a different length (no length oracle crash)', async () => {
    const app = buildApp();
    for (const key of ['short', 'x'.repeat(256)]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/stats',
        headers: { 'x-operator-key': key },
      });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('passes with the right key', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-operator-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
