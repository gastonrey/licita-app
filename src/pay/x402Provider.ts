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
import { SettleError, VerifyError } from '@x402/core/types';
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

export interface X402ProviderDeps {
  /** Test seam: inject a mock facilitator. Defaults to HTTPFacilitatorClient. */
  facilitator?: FacilitatorClient;
  /** Facilitator request timeout (ms). Default 10_000. */
  timeoutMs?: number;
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

    // 3. facilitator verify
    let payer: string | undefined;
    try {
      const verifyResult = await this.server.verifyPayment(payload as PaymentPayload, requirements);
      if (!verifyResult.isValid) {
        return { ok: false, reason: verifyResult.invalidReason ?? 'verify_failed' };
      }
      payer = verifyResult.payer;
    } catch (err) {
      if (err instanceof VerifyError) {
        return { ok: false, reason: err.invalidReason ?? 'verify_failed' };
      }
      return { ok: false, reason: facilitatorErrorReason(err) };
    }

    // 4. facilitator settle (BEFORE serving content)
    let txHash: string | undefined;
    try {
      const settleResult = await this.server.settlePayment(payload as PaymentPayload, requirements);
      if (!settleResult.success) {
        return { ok: false, reason: settleResult.errorReason ?? 'settle_failed' };
      }
      payer = settleResult.payer ?? payer;
      txHash = settleResult.transaction || undefined;
    } catch (err) {
      if (err instanceof SettleError) {
        return { ok: false, reason: err.errorReason ?? 'settle_failed' };
      }
      // A settle timeout is indeterminate (the facilitator may still have
      // settled); we fail closed — the on-chain nonce prevents a second
      // settlement when the client retries.
      return { ok: false, reason: facilitatorErrorReason(err) };
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
      ...(payer ? { payer } : {}),
      ...(txHash ? { txHash } : {}),
    };
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
