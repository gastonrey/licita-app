// X402PaymentProvider: requirement building (v2 shape, per-network USDC
// asset/amount), proof decoding (v1/v2), endpoint binding reasons, facilitator
// verify+settle mapping (mocked facilitator), replay via unique payments.proof,
// and fail-closed facilitator-unavailable handling.

import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';
import type { Db } from '../../src/db/client.js';
import { X402PaymentProvider } from '../../src/pay/x402Provider.js';

const PAY_TO = '0x3bF0F00f4c8e46CA4bFEa5D77cCDdCFC95c5ac5E';
const SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAYER = '0x1111111111111111111111111111111111111111';

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
`;

function makeDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as unknown as Db;
  return pool.query(PAYMENTS_DDL).then(() => pool);
}

const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

/** Mock facilitator; counters assert whether it was (not) called. */
function mockFacilitator(behavior: {
  verify?: VerifyResponse | ((payload: PaymentPayload) => VerifyResponse);
  settle?: SettleResponse | ((payload: PaymentPayload) => SettleResponse);
  verifyError?: unknown;
  settleError?: unknown;
}): FacilitatorClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async verify(payload: PaymentPayload): Promise<VerifyResponse> {
      calls.push('verify');
      if (behavior.verifyError) throw behavior.verifyError;
      const v = behavior.verify ?? { isValid: true, payer: PAYER };
      return typeof v === 'function' ? v(payload) : v;
    },
    async settle(payload: PaymentPayload): Promise<SettleResponse> {
      calls.push('settle');
      if (behavior.settleError) throw behavior.settleError;
      const s = behavior.settle ?? {
        success: true,
        transaction: '0xtxhash',
        network: payload.accepted?.network ?? 'eip155:84532',
        payer: PAYER,
      };
      return typeof s === 'function' ? s(payload) : s;
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
  };
}

function makeProvider(
  facilitator: FacilitatorClient,
  db?: Db,
  network = 'eip155:84532',
): X402PaymentProvider {
  return new X402PaymentProvider(
    { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network },
    db,
    { facilitator },
  );
}

/** v2 proof for `endpoint` built from the provider's own requirement. */
function v2Proof(provider: X402PaymentProvider, endpoint: string): string {
  const accepted = provider.requirementsFor(endpoint);
  return b64({ x402Version: 2, accepted, payload: { signature: '0xsig', authorization: {} } });
}

describe('X402PaymentProvider requirement building', () => {
  const facilitator = mockFacilitator({});

  it('builds v2 requirements for Base Sepolia (USDC, base units, EIP-3009 domain)', () => {
    const provider = makeProvider(facilitator);
    const req = provider.requirementsFor('GET /v1/search');
    expect(req).toEqual({
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '20000', // $0.02 at 6 decimals
      asset: SEPOLIA_USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2' },
    });
    const res = provider.requiredResponse('GET /v1/search');
    expect(res.x402Version).toBe(2);
    if (res.x402Version !== 2) throw new Error('unreachable');
    expect(res.resource.url).toBe('GET /v1/search');
    expect(res.accepts).toHaveLength(1);
    expect(res.accepts[0]).toEqual(req);
    expect(res.hint).toContain('PAYMENT-SIGNATURE');
  });

  it('builds mainnet requirements with the mainnet USDC asset', () => {
    const provider = makeProvider(facilitator, undefined, 'eip155:8453');
    const req = provider.requirementsFor('GET /v1/renewals');
    expect(req.amount).toBe('250000'); // $0.25
    expect(req.asset).toBe(MAINNET_USDC);
    expect(req.extra).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('throws without X402_PAY_TO (no pay destination)', () => {
    expect(
      () => new X402PaymentProvider({ facilitatorUrl: 'https://f.test', network: 'eip155:84532' }),
    ).toThrow(/X402_PAY_TO/);
  });

  it('throws on an unknown network (no default asset)', () => {
    expect(
      () =>
        new X402PaymentProvider({
          facilitatorUrl: 'https://f.test',
          payTo: PAY_TO,
          network: 'eip155:99999999',
        }),
    ).toThrow();
  });
});

describe('X402PaymentProvider.verify', () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeDb();
  });

  it('rejects malformed proofs with invalid_payload (never calls the facilitator)', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    for (const bad of ['not-base64!!', b64('not json'), b64({ hello: 'world' }), b64({ x402Version: 3 })]) {
      expect(await provider.verify(bad, 'GET /v1/search')).toEqual({ ok: false, reason: 'invalid_payload' });
    }
    expect(facilitator.calls).toEqual([]);
  });

  it('maps endpoint-binding mismatches to machine-readable reasons (no facilitator call)', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    const base = provider.requirementsFor('GET /v1/search');

    const cases: Array<[Partial<PaymentRequirements>, string]> = [
      [{ network: 'eip155:8453' }, 'network_mismatch'],
      [{ scheme: 'upto' }, 'unsupported_scheme'],
      [{ payTo: '0x2222222222222222222222222222222222222222' }, 'wrong_pay_to'],
      [{ amount: '999999' }, 'amount_mismatch'],
      [{ asset: '0x2222222222222222222222222222222222222222' }, 'amount_mismatch'],
      [{ maxTimeoutSeconds: 9999 }, 'wrong_endpoint'],
    ];
    for (const [patch, reason] of cases) {
      const proof = b64({ x402Version: 2, accepted: { ...base, ...patch }, payload: {} });
      const res = await provider.verify(proof, 'GET /v1/search');
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(reason);
    }
    expect(facilitator.calls).toEqual([]);
  });

  it('happy path: verify + settle, audit row settled with payer/tx, clientKey from payer', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    const proof = v2Proof(provider, 'GET /v1/search');

    const res = await provider.verify(proof, 'GET /v1/search');
    expect(res).toEqual({
      ok: true,
      clientKey: `x402_${PAYER}`,
      amount: '0.02',
      payer: PAYER,
      txHash: '0xtxhash',
    });
    expect(facilitator.calls).toEqual(['verify', 'settle']);

    const rows = await db.query(
      `SELECT endpoint, amount_usd::text AS amount, provider, status, payer_address, tx_hash, network, proof
       FROM payments`,
    );
    expect(rows.rows).toEqual([
      {
        endpoint: 'GET /v1/search',
        amount: '0.02',
        provider: 'x402',
        status: 'settled',
        payer_address: PAYER,
        tx_hash: '0xtxhash',
        network: 'eip155:84532',
        proof: expect.stringMatching(/^[0-9a-f]{64}$/), // sha256 of the payload, not the payload itself
      },
    ]);
  });

  it('replay: the same payload twice → second verify fails with reason replay', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    const proof = v2Proof(provider, 'GET /v1/search');

    expect((await provider.verify(proof, 'GET /v1/search')).ok).toBe(true);
    const second = await provider.verify(proof, 'GET /v1/search');
    expect(second).toEqual({ ok: false, reason: 'replay' });
    // both layers engaged: facilitator saw both attempts, the DB unique proof
    // rejected the second AFTER settle (the facilitator nonce is the on-chain layer)
    expect(facilitator.calls).toEqual(['verify', 'settle', 'verify', 'settle']);
    const rows = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(rows.rows[0].n).toBe(1);
  });

  it('maps facilitator verify rejection (insufficient_funds passes through)', async () => {
    const facilitator = mockFacilitator({
      verify: { isValid: false, invalidReason: 'insufficient_funds' },
    });
    const provider = makeProvider(facilitator, db);
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'insufficient_funds' });
    expect(facilitator.calls).toEqual(['verify']); // never settles an invalid payment
  });

  it('maps generic verify invalid to verify_failed', async () => {
    const facilitator = mockFacilitator({ verify: { isValid: false } });
    const provider = makeProvider(facilitator, db);
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'verify_failed' });
  });

  it('maps settle rejection to settle_failed / its errorReason', async () => {
    const facilitator = mockFacilitator({
      settle: { success: false, errorReason: 'invalid_exact_evm_payload_signature', transaction: '', network: 'eip155:84532' },
    });
    const provider = makeProvider(facilitator, db);
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'invalid_exact_evm_payload_signature' });
    const rows = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(rows.rows[0].n).toBe(0); // no audit row without a settlement
  });

  it('fails closed with facilitator_unavailable when the facilitator is unreachable', async () => {
    const facilitator = mockFacilitator({ verifyError: new TypeError('fetch failed') });
    const provider = makeProvider(facilitator, db);
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'facilitator_unavailable' });
  });

  it('fails closed with facilitator_unavailable on settle timeout (indeterminate)', async () => {
    const facilitator = mockFacilitator({ settleError: new Error('Facilitator request timed out') });
    const provider = makeProvider(facilitator, db);
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'facilitator_unavailable' });
    const rows = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(rows.rows[0].n).toBe(0);
  });

  it('fails closed when no replay store is available (no db)', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator); // no db
    const res = await provider.verify(v2Proof(provider, 'GET /v1/search'), 'GET /v1/search');
    expect(res).toEqual({ ok: false, reason: 'replay_store_unavailable' });
  });

  it('accepts a v1 legacy payload (scheme+network binding only)', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    const proof = b64({ x402Version: 1, scheme: 'exact', network: 'eip155:84532', payload: { signature: '0x' } });
    const res = await provider.verify(proof, 'GET /v1/search');
    expect(res.ok).toBe(true);
    expect(res.clientKey).toBe(`x402_${PAYER}`);
  });

  it('rejects a v1 payload for the wrong network', async () => {
    const facilitator = mockFacilitator({});
    const provider = makeProvider(facilitator, db);
    const proof = b64({ x402Version: 1, scheme: 'exact', network: 'eip155:8453', payload: {} });
    expect(await provider.verify(proof, 'GET /v1/search')).toEqual({
      ok: false,
      reason: 'network_mismatch',
    });
    expect(facilitator.calls).toEqual([]);
  });
});
