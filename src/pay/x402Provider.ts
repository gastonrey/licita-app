// X402PaymentProvider — REAL x402 v2 machine-to-machine payments via the
// official @x402/core + @x402/evm packages (Coinbase CDP facilitator, USDC on
// Base via EIP-3009 transferWithAuthorization).
//
// Integration path: custom server implementation on @x402/core (NOT
// @x402/fastify), because our 402 error envelope, per-endpoint price table,
// MCP inline verify, and payments audit inserts must stay intact.
//
// Flow (verify()):
//   1. decode the client proof (base64 JSON) — v2 PAYMENT-SIGNATURE or v1
//      X-PAYMENT value; both carry a signed payment payload
//   2. match the payload against THIS endpoint's exact requirement
//      (network/scheme/asset/amount/payTo) built from ENDPOINT_PRICES
//   3. x402ResourceServer.verifyPayment → facilitator POST /verify
//   4. x402ResourceServer.settlePayment → facilitator POST /settle
//      (settle BEFORE serving content; fail closed on any facilitator error)
//   5. audit insert into payments (proof = sha256 of the payload; UNIQUE →
//      replay). The facilitator's on-chain EIP-3009 nonce is the second
//      replay layer.
//
// Note: x402ResourceServer.initialize() (facilitator /supported discovery) is
// deliberately NOT called at boot: it adds a hard boot-time dependency on
// facilitator availability, and verifyPayment/settlePayment fall back to the
// registered facilitator client when the capability map is empty. Requirement
// building uses the @x402/evm asset table + @x402/core amount helpers
// directly instead.

import { createHash } from 'node:crypto';
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
} from '@x402/core/server';
import { SettleError, VerifyError, type SettleResponse } from '@x402/core/types';
import type { Network, PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  isPaymentPayloadV1,
  isPaymentPayloadV2,
  type PaymentPayloadV1,
  type PaymentPayloadV2,
} from '@x402/core/schemas';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { convertToTokenAmount } from '@x402/core/utils';
import { getDefaultAsset } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import {
  ENDPOINT_PRICES,
  type PaymentProvider,
  type PaymentRequirement,
  type PaymentVerification,
} from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';

/** Bounded facilitator call deadline (headers + body). */
const FACILITATOR_TIMEOUT_MS = 10_000;
/** Authorization validity window advertised in requirements. */
const MAX_TIMEOUT_SECONDS = 300;
/** Sanity bound for a base64 payment payload header value. */
const MAX_PROOF_LENGTH = 16 * 1024;

/** Settle result shape used by the retry loop (transaction may be absent when
 *  the on-chain guard confirmed a landed transfer after a flaky response). */
type SettleAttemptResult = { success: boolean; transaction?: string; payer?: string };

/** Reasons that indicate a transient facilitator/RPC failure worth retrying.
 *  These are NOT client-caused: the payload may be perfectly valid but the
 *  facilitator's RPC flaked (observed on public mainnet facilitators: a
 *  `balanceOf` call reverting with CALL_EXCEPTION, `simulation_reverted`, or
 *  generic `invalid_payment` / `unexpected_error`). Deterministic rejections
 *  (replay, wrong_pay_to, amount_mismatch, expired, etc.) never retry. */
const TRANSIENT_REASONS = new Set([
  'simulation_reverted',
  'invalid_payment',
  'unexpected_error',
  'CALL_EXCEPTION',
  'facilitator_unavailable',
]);

function isTransientReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    TRANSIENT_REASONS.has(reason) ||
    /revert|call_exception|missing revert data|rpc|timeout|simulation/i.test(reason)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a facilitator-bound operation with bounded attempts and backoff.
 *  Only transient failures are retried; deterministic failures return
 *  immediately. After the last attempt the final error is returned. */
async function withFacilitatorRetry<T>(
  attempts: number,
  label: string,
  op: () => Promise<{ ok: boolean; reason?: string; result?: T }>,
  onRetry?: (reason: string, attempt: number) => void,
): Promise<{ ok: boolean; reason?: string; result?: T }> {
  const max = Math.max(0, attempts);
  let last: { ok: boolean; reason?: string; result?: T } | undefined;
  for (let i = 0; i <= max; i++) {
    last = await op();
    if (last.ok) return last;
    if (!isTransientReason(last.reason) || i === max) return last;
    onRetry?.(last.reason ?? 'unknown', i + 1);
    await sleep(250 * (i + 1));
  }
  return last ?? { ok: false, reason: `${label}_failed` };
}

export interface X402ProviderDeps {
  /** Test seam: inject a mock facilitator. Defaults to HTTPFacilitatorClient. */
  facilitator?: FacilitatorClient;
  /** Facilitator request timeout (ms). Default 10_000. */
  timeoutMs?: number;
  /** Retries for transient facilitator/RPC failures. Default 3. */
  retries?: number;
  /** Stable RPC for the settle-retry nonce guard. Optional; when absent the
   *  nonce guard is skipped (settle is only retried after verify succeeded). */
  rpcUrl?: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Fail-closed classification for facilitator transport failures: timeouts
 * (FacilitatorTimeoutError), DNS/connection errors, and malformed responses
 * all mean we cannot prove payment, so the request is rejected. Protocol-level
 * rejections (VerifyError/SettleError) are handled by their own branches.
 */
function facilitatorErrorReason(_err: unknown): string {
  return 'facilitator_unavailable';
}

export class X402PaymentProvider implements PaymentProvider {
  readonly name = 'x402';
  private readonly network: Network;
  private readonly payTo: string;
  private readonly db?: Db;
  private readonly server: x402ResourceServer;
  private readonly retries: number;
  private readonly rpcUrl?: string;

  constructor(x402: AppConfig['x402'], db?: Db, deps: X402ProviderDeps = {}) {
    if (!x402.payTo) {
      throw new Error(
        'X402PaymentProvider requires X402_PAY_TO (the Ethereum address receiving USDC). ' +
          'Refusing to start an x402 provider without a pay destination.',
      );
    }
    this.network = x402.network as Network;
    this.payTo = x402.payTo;
    this.db = db;
    this.retries = deps.retries ?? x402.facilitatorRetries ?? 3;
    this.rpcUrl = deps.rpcUrl ?? x402.rpcUrl;
    // Validates the network's asset table entry eagerly (throws on unknown network).
    getDefaultAsset(this.network);
    const facilitator =
      deps.facilitator ??
      new HTTPFacilitatorClient({
        url: x402.facilitatorUrl,
        timeoutMs: deps.timeoutMs ?? FACILITATOR_TIMEOUT_MS,
      });
    this.server = new x402ResourceServer(facilitator).register(
      this.network,
      new ExactEvmScheme(),
    );
  }

  price(endpoint: string): string {
    return ENDPOINT_PRICES[endpoint] ?? '0.00';
  }

  /**
   * The exact v2 requirement for an endpoint, built from ENDPOINT_PRICES with
   * the official asset table (USDC address + EIP-3009 domain for the network)
   * and base-unit conversion helpers. Mirrors what
   * x402ResourceServer.buildPaymentRequirements produces via
   * ExactEvmScheme.parsePrice for the exact/EVM scheme, without requiring
   * facilitator /supported discovery.
   */
  requirementsFor(endpoint: string): PaymentRequirements {
    const asset = getDefaultAsset(this.network);
    // ExactEvmScheme.defaultMoneyConversion: EIP-712 domain is included unless
    // the asset forces permit2; Base USDC uses EIP-3009, so { name, version }.
    const includeEip712Domain = !asset.assetTransferMethod || asset.supportsEip2612 === true;
    return {
      scheme: 'exact',
      network: this.network,
      amount: convertToTokenAmount(this.price(endpoint), asset.decimals),
      asset: asset.address,
      payTo: this.payTo,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: {
        ...(includeEip712Domain ? { name: asset.name, version: asset.version } : {}),
        ...(asset.assetTransferMethod ? { assetTransferMethod: asset.assetTransferMethod } : {}),
      },
    };
  }

  requiredResponse(endpoint: string): PaymentRequirement {
    const price = this.price(endpoint);
    return {
      x402Version: 2,
      resource: {
        url: endpoint,
        description: `licita-agent ${endpoint}`,
        mimeType: 'application/json',
      },
      accepts: [this.requirementsFor(endpoint)],
      hint:
        `Pay $${price} USDC on ${this.network} (scheme "exact", EIP-3009 transferWithAuthorization) ` +
        `to ${this.payTo} using an x402 client, then retry with the base64 payment payload in the ` +
        `PAYMENT-SIGNATURE header (v2) or X-PAYMENT header (v1). Settlement via the configured ` +
        `facilitator (X402_FACILITATOR_URL).`,
    };
  }

  /**
   * Full payment verification: decode → endpoint binding → facilitator verify
   * → facilitator settle → audit insert. Any failure returns ok:false with a
   * machine-readable reason; paid content is never served on facilitator
   * failure (fail closed).
   */
  async verify(proof: string, endpoint: string): Promise<PaymentVerification> {
    const requirements = this.requirementsFor(endpoint);

    // 1. decode + shape-check the payload (v2 PAYMENT-SIGNATURE or v1 X-PAYMENT)
    if (proof.length > MAX_PROOF_LENGTH) return { ok: false, reason: 'invalid_payload' };
    let payload: PaymentPayloadV1 | PaymentPayloadV2;
    try {
      const decoded: unknown = decodePaymentSignatureHeader(proof);
      if (!isPaymentPayloadV2(decoded) && !isPaymentPayloadV1(decoded)) {
        return { ok: false, reason: 'invalid_payload' };
      }
      payload = decoded;
    } catch {
      return { ok: false, reason: 'invalid_payload' };
    }

    // 2. endpoint binding: the payload must match THIS endpoint's requirement
    const mismatch = this.matchRequirements(requirements, payload);
    if (mismatch !== null) return { ok: false, reason: mismatch };

    // 3. facilitator verify (retry transient failures; verify does not
    //    consume the on-chain nonce, so retrying is safe)
    let payer: string | undefined;
    let verifyAttempts = 1;
    const verifyOutcome = await withFacilitatorRetry(
      this.retries,
      'verify',
      async () => {
        try {
          const verifyResult = await this.server.verifyPayment(
            payload as PaymentPayload,
            requirements,
          );
          if (!verifyResult.isValid) {
            return { ok: false, reason: verifyResult.invalidReason ?? 'verify_failed' };
          }
          payer = verifyResult.payer;
          return { ok: true, result: verifyResult };
        } catch (err) {
          if (err instanceof VerifyError) {
            return { ok: false, reason: err.invalidReason ?? 'verify_failed' };
          }
          return { ok: false, reason: facilitatorErrorReason(err) };
        }
      },
      (_reason, attempt) => {
        verifyAttempts = attempt + 1;
      },
    );
    if (!verifyOutcome.ok) {
      return {
        ok: false,
        reason: verifyOutcome.reason,
        ...(verifyAttempts > 1 ? { attempts: verifyAttempts } : {}),
      };
    }

    // 4. facilitator settle (BEFORE serving content). Transient failures are
    //    retried ONLY when the on-chain guard is available (rpcUrl configured).
    //    The guard runs only on retries (attempt > 1): a Transfer(payer ->
    //    payTo, amount) log lookup on the stable RPC tells us whether the
    //    previous flaky attempt already landed. If it landed, the payment
    //    succeeded — retrying the same payload would only get a deterministic
    //    replay rejection and risk the client re-paying with a fresh proof
    //    (double charge). Without the guard, settle is a single attempt that
    //    fails closed.
    let txHash: string | undefined;
    let settleAttempts = 1;
    const settleRetries = this.rpcUrl ? this.retries : 0;
    const settleOutcome = await withFacilitatorRetry(
      settleRetries,
      'settle',
      async (): Promise<{ ok: boolean; reason?: string; result?: SettleAttemptResult }> => {
        // On-chain guard: only before RETRY attempts. The first attempt cannot
        // have a landed transfer yet (nothing was settled before it).
        const payerAddr = payer;
        if (
          settleAttempts > 1 &&
          payerAddr &&
          (await this.hasTransferLanded(payerAddr, requirements.amount))
        ) {
          return { ok: true, result: { success: true, transaction: undefined } };
        }
        try {
          const settleResult = await this.server.settlePayment(
            payload as PaymentPayload,
            requirements,
          );
          if (!settleResult.success) {
            return { ok: false, reason: settleResult.errorReason ?? 'settle_failed' };
          }
          payer = settleResult.payer ?? payer;
          txHash = settleResult.transaction || undefined;
          return { ok: true, result: settleResult };
        } catch (err) {
          if (err instanceof SettleError) {
            return { ok: false, reason: err.errorReason ?? 'settle_failed' };
          }
          // A settle timeout is indeterminate: the facilitator may have settled
          // but lost the response. The next retry starts with the on-chain
          // guard, which decides success (landed) vs retry (not landed).
          return { ok: false, reason: facilitatorErrorReason(err) };
        }
      },
      (_reason, attempt) => {
        settleAttempts = attempt + 1;
      },
    );
    if (!settleOutcome.ok) {
      const totalAttempts = verifyAttempts + settleAttempts;
      return {
        ok: false,
        reason: settleOutcome.reason,
        // attempts only when retries actually happened (baseline is verify 1 + settle 1)
        ...(totalAttempts > 2 ? { attempts: totalAttempts } : {}),
      };
    }

    // 5. audit + replay: unique payments.proof on the payload hash
    if (!this.db) return { ok: false, reason: 'replay_store_unavailable' };
    const amount = this.price(endpoint);
    try {
      await this.db.query(
        `INSERT INTO payments (client_id, endpoint, amount_usd, provider, proof, status, payer_address, tx_hash, network)
         VALUES (NULL, $1, $2, $3, $4, 'settled', $5, $6, $7)`,
        [endpoint, amount, this.name, sha256Hex(proof), payer ?? null, txHash ?? null, this.network],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') return { ok: false, reason: 'replay' };
      throw err;
    }

    return {
      ok: true,
      clientKey: payer ? `x402_${payer}` : undefined,
      amount,
      attempts: verifyAttempts + settleAttempts,
      ...(payer ? { payer } : {}),
      ...(txHash ? { txHash } : {}),
    };
  }

  /**
   * On-chain settle guard. Looks up Transfer(from=payer, to=payTo, value=amount)
   * logs on the network's USDC contract via the configured stable RPC (NOT the
   * flaky facilitator RPC). A matching log means a previous flaky settle attempt
   * actually landed, so the payment must be treated as settled. Returns false on
   * any RPC error or when no matching log exists (safe: the caller retries the
   * facilitator settle).
   */
  private async hasTransferLanded(payer: string, amountBaseUnits: string): Promise<boolean> {
    if (!this.rpcUrl) return false;
    try {
      const asset = getDefaultAsset(this.network);
      // keccak256("Transfer(address,address,uint256)")
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const pad = (addr: string) => `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
      const amountHex = BigInt(amountBaseUnits).toString(16).padStart(64, '0');
      const latest = await this.rpcBlockNumber();
      if (latest === undefined) return false;
      // ~25 blocks back (Base ~2s/block ⇒ ~50s window) to catch the settle.
      const fromBlock = latest > 25 ? `0x${(latest - 25).toString(16)}` : '0x0';
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getLogs',
          params: [
            {
              address: asset.address,
              fromBlock,
              toBlock: 'latest',
              topics: [transferTopic, pad(payer), pad(this.payTo)],
            },
          ],
        }),
      });
      const j = (await res.json()) as { result?: Array<{ data?: string }>; error?: { message?: string } };
      if (!Array.isArray(j.result)) return false;
      return j.result.some((log) => (log.data ?? '').toLowerCase() === `0x${amountHex}`);
    } catch {
      return false;
    }
  }

  /** Latest block number via the stable RPC, or undefined on failure. */
  private async rpcBlockNumber(): Promise<number | undefined> {
    if (!this.rpcUrl) return undefined;
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      const j = (await res.json()) as { result?: string };
      return j.result ? Number.parseInt(j.result, 16) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Match the client payload against the endpoint's exact requirement and
   * return a machine-readable mismatch reason, or null when it matches.
   * v2 payloads carry the full accepted requirement; v1 payloads only carry
   * scheme+network (the facilitator enforces the rest at verify time).
   */
  private matchRequirements(
    requirements: PaymentRequirements,
    payload: PaymentPayloadV1 | PaymentPayloadV2,
  ): string | null {
    if (isPaymentPayloadV2(payload)) {
      const accepted = payload.accepted;
      if (accepted.network !== requirements.network) return 'network_mismatch';
      if (accepted.scheme !== requirements.scheme) return 'unsupported_scheme';
      if (accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) return 'wrong_pay_to';
      if (
        accepted.amount !== requirements.amount ||
        accepted.asset.toLowerCase() !== requirements.asset.toLowerCase()
      ) {
        return 'amount_mismatch';
      }
      const matched = this.server.findMatchingRequirements([requirements], payload as PaymentPayload);
      return matched ? null : 'wrong_endpoint';
    }
    // v1 legacy payload: { x402Version: 1, scheme, network, payload }
    if (payload.network !== requirements.network) return 'network_mismatch';
    if (payload.scheme !== requirements.scheme) return 'unsupported_scheme';
    return null;
  }
}
