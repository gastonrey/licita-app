// DevPaymentProvider (PAYMENTS_MODE=dev) + dev faucet route (SPEC §6).
// Tokens are `base64url(JSON{endpoint, amount, exp, nonce}).hmac` where hmac is
// base64url(HMAC-SHA256(payload, PAY_HMAC_SECRET)). Tokens expire after 5 minutes
// and are single-use: verify() performs a unique insert into payments.proof and
// a unique-violation / conflict means replay.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ENDPOINT_PRICES,
  type PaymentProvider,
  type PaymentRequirement,
  type PaymentVerification,
} from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { errorEnvelope } from '../api/routes/common.js';

export const DEV_TOKEN_TTL_SEC = 300; // 5 minutes

export interface DevTokenPayload {
  endpoint: string;
  amount: string;
  /** unix seconds */
  exp: number;
  nonce: string;
}

export interface DevProviderOpts {
  secret: string;
  /** required for verify() (replay protection); the faucet only signs, so it may omit it */
  db?: Db;
  /** clock override for tests (unix seconds) */
  now?: () => number;
}

const b64u = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');

export class DevPaymentProvider implements PaymentProvider {
  readonly name = 'dev';
  private readonly secret: string;
  private readonly db?: Db;
  private readonly now: () => number;

  constructor(opts: DevProviderOpts) {
    this.secret = opts.secret;
    this.db = opts.db;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  price(endpoint: string): string {
    return ENDPOINT_PRICES[endpoint] ?? '0.00';
  }

  requiredResponse(endpoint: string): PaymentRequirement {
    const amount = this.price(endpoint);
    return {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'dev',
          asset: 'USD',
          amount,
          payTo: 'dev-faucet',
          resource: endpoint,
        },
      ],
      hint: `POST /v1/dev-faucet with {"endpoint":"${endpoint}"} to get a dev token; retry with header X-PAYMENT: <token>`,
    };
  }

  /** Sign a fresh dev token for a priced endpoint. Caller must validate endpoint first. */
  createToken(endpoint: string): { token: string; expires_at: string } {
    const exp = this.now() + DEV_TOKEN_TTL_SEC;
    const payload: DevTokenPayload = {
      endpoint,
      amount: this.price(endpoint),
      exp,
      nonce: randomBytes(16).toString('base64url'),
    };
    const payloadB64 = b64u(JSON.stringify(payload));
    const sig = createHmac('sha256', this.secret).update(payloadB64).digest();
    return { token: `${payloadB64}.${b64u(sig)}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  private hmac(payloadB64: string): Buffer {
    return createHmac('sha256', this.secret).update(payloadB64).digest();
  }

  /** Decode + authenticate the token. Returns the payload or a failure reason. */
  decode(proof: string): { payload: DevTokenPayload } | { reason: string } {
    if (typeof proof !== 'string' || proof.length > 2048) return { reason: 'malformed' };
    const dot = proof.lastIndexOf('.');
    if (dot <= 0) return { reason: 'malformed' };
    const payloadB64 = proof.slice(0, dot);
    const sigB64 = proof.slice(dot + 1);
    let sig: Buffer;
    try {
      sig = Buffer.from(sigB64, 'base64url');
    } catch {
      return { reason: 'malformed' };
    }
    const expected = this.hmac(payloadB64);
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
      return { reason: 'invalid_signature' };
    }
    let payload: DevTokenPayload;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      const p = parsed as Partial<DevTokenPayload>;
      if (
        typeof p !== 'object' ||
        p === null ||
        typeof p.endpoint !== 'string' ||
        typeof p.amount !== 'string' ||
        typeof p.exp !== 'number' ||
        typeof p.nonce !== 'string'
      ) {
        return { reason: 'malformed' };
      }
      payload = p as DevTokenPayload;
    } catch {
      return { reason: 'malformed' };
    }
    return { payload };
  }

  /**
   * Full verification: signature → expiry → endpoint match → replay check via
   * unique insert into payments.proof (conflict = replay). A successful verify
   * consumes the token and records the payment row (status 'success').
   */
  async verify(proof: string, endpoint: string): Promise<PaymentVerification> {
    const decoded = this.decode(proof);
    if ('reason' in decoded) return { ok: false, reason: decoded.reason };
    const { payload } = decoded;

    if (payload.exp <= this.now()) return { ok: false, reason: 'expired' };
    if (payload.endpoint !== endpoint) return { ok: false, reason: 'wrong_endpoint' };
    const amount = this.price(endpoint);
    if (payload.amount !== amount) return { ok: false, reason: 'amount_mismatch' };

    const clientKey = `dev_${createHmac('sha256', this.secret)
      .update(`client:${proof}`)
      .digest('hex')
      .slice(0, 16)}`;

    if (!this.db) return { ok: false, reason: 'replay_store_unavailable' };
    try {
      // Unique insert doubles as the replay check: payments.proof is UNIQUE,
      // so reusing a consumed proof raises a unique-violation (23505).
      await this.db.query(
        `INSERT INTO payments (client_id, endpoint, amount_usd, provider, proof, status)
         VALUES (NULL, $1, $2, $3, $4, 'success')`,
        [endpoint, amount, this.name, proof],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return { ok: false, reason: 'replay' };
      throw err;
    }
    return { ok: true, clientKey, amount };
  }
}

// --- dev faucet route -----------------------------------------------------------

const faucetBodySchema = z.object({
  endpoint: z.string().min(1).max(100),
});

/**
 * POST /v1/dev-faucet {"endpoint": "<METHOD PATH>"} → { token, proof, expires_at }.
 * Dev mode only: when PAYMENTS_MODE != 'dev' OR NODE_ENV === 'production' NO
 * route is registered at all (the path 404s like any unknown route), so the
 * faucet's existence is undiscoverable on non-dev deployments.
 * No auth — this endpoint exists so autonomous agents can complete the dev x402
 * flow without a human operator.
 */
export function registerDevFaucet(app: FastifyInstance, config: AppConfig): void {
  if (config.paymentsMode !== 'dev' || config.nodeEnv === 'production') {
    return;
  }

  const signer = new DevPaymentProvider({ secret: config.payHmacSecret });

  app.post('/v1/dev-faucet', async (req, reply) => {
    const parsed = faucetBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          errorEnvelope(
            'invalid_query',
            'Body must be JSON like {"endpoint":"GET /v1/search"}.',
            'Use an endpoint key from GET /v1/pricing (METHOD PATH form).',
          ),
        );
    }
    const { endpoint } = parsed.data;
    const price = ENDPOINT_PRICES[endpoint];
    if (price === undefined) {
      return reply
        .code(400)
        .send(
          errorEnvelope(
            'invalid_query',
            `Unknown endpoint "${endpoint}".`,
            `Known endpoint keys: ${Object.keys(ENDPOINT_PRICES).join(' | ')}`,
          ),
        );
    }
    if (price === '0.00') {
      return reply
        .code(400)
        .send(
          errorEnvelope(
            'invalid_query',
            `Endpoint "${endpoint}" is free; no payment token is needed.`,
            'Call it directly without an X-PAYMENT header.',
          ),
        );
    }
    const { token, expires_at } = signer.createToken(endpoint);
    return reply.send({ token, proof: token, endpoint, amount: price, expires_at });
  });
}
