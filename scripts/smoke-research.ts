// Real x402 payment test for POST /v1/research (P0.1) + Bazaar extension echo.
// Usage: SMOKE_PAY_MODE=x402 BASE_URL=https://eutenders.duckdns.org npx tsx scripts/smoke-research.ts
import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { isPaymentPayloadV2, isPaymentRequired } from '@x402/core/schemas';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http as viemHttp } from 'viem';
import { base } from 'viem/chains';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const mode = process.env.SMOKE_PAY_MODE ?? 'dev';
const privateKey = process.env.SMOKE_WALLET_PRIVATE_KEY;
if (mode === 'x402' && !privateKey) {
  console.error('SMOKE_WALLET_PRIVATE_KEY required for x402 mode');
  process.exit(2);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const walletClient = createWalletClient({ account, chain: base, transport: viemHttp() });
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

async function payResearch(query: string) {
  const url = `${BASE_URL}/v1/research`;
  // 1. no proof → 402 + payment-required header
  const bare = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  console.log('step 1  no-proof status:', bare.status);
  if (bare.status !== 402) throw new Error(`expected 402, got ${bare.status}`);
  const raw = bare.headers.get('payment-required');
  if (!raw) throw new Error('missing PAYMENT-REQUIRED header');
  const requirement = decodePaymentRequiredHeader(raw);
  if (!isPaymentRequired(requirement)) throw new Error('invalid x402 requirement');
  console.log('step 2  amount(base):', requirement.accepts?.[0]?.amount, 'asset:', requirement.accepts?.[0]?.asset);
  const bz = (requirement as any).extensions?.bazaar as any;
  console.log('step 3  extensions.bazaar present:', !!bz);
  if (bz?.schema) {
    console.log('         input.type:', bz.schema.info?.input?.type);
    console.log('         routeTemplate:', bz.schema.routeTemplate ?? '(static)');
  }
  // 2. sign payment payload (client SDK builds payload incl. extensions)
  const payload = await client.createPaymentPayload(requirement as any);
  console.log('step 4  isPaymentPayloadV2:', isPaymentPayloadV2(payload));
  console.log('         payload.extensions.bazaar present:', !!(payload as any).extensions?.bazaar);
  const proof = encodePaymentSignatureHeader(payload);
  // 3. retry with payment proof
  const paid = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'payment-signature': proof },
    body: JSON.stringify({ query }),
  });
  const body = await paid.json();
  console.log('step 5  paid status:', paid.status);
  if (!paid.ok) {
    console.log('         error:', JSON.stringify(body).slice(0, 400));
    process.exit(1);
  }
  console.log('step 6  price_usd:', body.meta?.price_usd, 'paid:', body.meta?.paid);
  console.log('         topic:', body.data?.topic, 'confidence:', body.data?.confidence, 'findings:', body.data?.findings?.length);
  console.log('RESEARCH PAID OK');
}

await payResearch('IT support services in Galicia');