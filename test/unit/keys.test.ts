// B1.2 trial key module (src/pay/keys.ts) — RED-first unit tests.
//
// Key format: 'lct_' + base64url(randomBytes(24)) = 36 chars total.
// Hashing: sha256 hex (64 chars) — stored hash for api_clients.key_hash.
// hashKeyLog: 'key_' + first 24 hex chars of the sha256 — safe to persist in
// request_logs/operator surfaces (no collision pressure: 96 bits).

import { describe, expect, it } from 'vitest';
import { generateKey, hashKey, deriveKeyHash, hashKeyLog, rotateKey } from '../../src/pay/keys.js';

const KEY_RE = /^lct_[A-Za-z0-9_-]{32}$/;

describe('trial key module (src/pay/keys.ts)', () => {
  it('generateKey emits the documented lct_ format with 96 bits of entropy', () => {
    const key = generateKey();
    expect(key).toMatch(KEY_RE);
    expect(key.length).toBe(36); // 'lct_' (4) + 32 base64url chars
    // 24 random bytes → 32 base64 chars without padding
  });

  it('generateKey is collision-resistant across several draws', () => {
    const keys = new Set(Array.from({ length: 3 }, () => generateKey()));
    expect(keys.size).toBe(3);
  });

  it('hashKey is a 64-char lowercase hex digest and is deterministic', () => {
    const key = generateKey();
    const digest = hashKey(key);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(key)).toBe(digest);
    // different key → different digest
    expect(hashKey(key + 'x')).not.toBe(digest);
  });

  it('deriveKeyHash is the seam-named alias of hashKey (identical output)', () => {
    const key = generateKey();
    expect(deriveKeyHash(key)).toBe(hashKey(key));
  });

  it('hashKeyLog returns a key_ + 24 hex chars, stable per key, distinct per key', () => {
    const a = generateKey();
    const b = generateKey();
    const logA = hashKeyLog(a);
    expect(logA).toMatch(/^key_[0-9a-f]{24}$/);
    expect(hashKeyLog(a)).toBe(logA); // deterministic
    expect(hashKeyLog(b)).not.toBe(logA); // distinct keys → distinct labels
  });

  it('rotateKey issues a fresh key, its new hash, and the old hash', () => {
    const oldKey = generateKey();
    const rotated = rotateKey(oldKey);

    expect(rotated.key).toMatch(KEY_RE);
    expect(rotated.key).not.toBe(oldKey); // never reuses the old secret
    expect(rotated.keyHash).toBe(hashKey(rotated.key));
    expect(rotated.oldHash).toBe(hashKey(oldKey));
  });
});