// B1.2 trial key module — key material + hashing for api_clients (payments).
//
// Key format: 'lct_' + base64url(randomBytes(24)) → 36 chars total (128-bit
// prefix distinguishes the format from legacy x402 proofs/keys; 192 raw bits
// of entropy survives base64url encoding as 32 chars).
//
// Only hashes ever touch the DB / request_logs:
//  - key_hash      sha256(key) hex — api_clients.key_hash (UNIQUE, exact match)
//  - hashKeyLog    'key_' + first 24 hex chars (96 bits) — operator-facing logs
//                  (request log 'client' field), never the raw secret.

import { createHash, randomBytes } from 'node:crypto';

/** 128-bit lct_ prefix + 32 base64url chars (192 raw bits). */
export const KEY_PREFIX = 'lct_';

/** Public-key format for a trial/pro client key. */
export function generateKey(): string {
  return KEY_PREFIX + randomBytes(24).toString('base64url');
}

/**
 * Canonical api_clients.key_hash: lowercase hex sha256. Deterministic; safe to
 * compare directly against the UNIQUE key_hash column.
 */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Seam-named alias of hashKey (design seam for deprecation: consumers should
 * call deriveKeyHash today; if the digest scheme ever changes, only this
 * module changes). Identical to hashKey.
 */
export function deriveKeyHash(key: string): string {
  return hashKey(key);
}

/**
 * Short, safe log label for a key — 'key_' + 96 bits of the digest. Stable per
 * key and cheap to correlate in request logs without exposing the secret.
 */
export function hashKeyLog(key: string): string {
  return `key_${hashKey(key).slice(0, 24)}`;
}

/**
 * Rotation helper: issues a brand-new key alongside its new stored hash and
 * the OLD hash so callers can delete/archive the previous key_hash row.
 */
export function rotateKey(oldKey: string): { key: string; keyHash: string; oldHash: string } {
  const key = generateKey();
  return { key, keyHash: hashKey(key), oldHash: hashKey(oldKey) };
}