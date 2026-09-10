// B2.2 Billing lifecycle — the single place that turns a completed Creem
// MoR checkout into api_clients state.
//
// completeCheckout(email) runs ONLY from the checkout.completed
// webhook (never at checkout session creation):
//  - email unknown → INSERT api_clients row kind='creem' (+30d period);
//  - email known (trial/agent/pro legacy) → UPGRADE to kind='creem'
//    (+30d period, renew from now), preserving the row id.
// Replay-safe: SELECT-first upsert against the lower(email) UNIQUE index —
// a replayed event id never creates a second row and never re-grants
// anything. Full event-id idempotency (webhook_events table) lands in
// C1/C2 with migration 100.
//
// Credits: NO credits are granted at checkout. The Creem subscriber's
// per-call entitlement is ONE-TIME credits — the existing credit_accounts
// facade (P2 bundles) — which they top up themselves (B2.4 fall-through).
// Keep switch: CREEM_ENABLED=false → throw (fail closed).

import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { generateKey, hashKey } from './keys.js';

/** Thirty days in milliseconds (subscription period length, design B2). */
export const CREEM_PERIOD_MS = 30 * 24 * 3600 * 1000;

/**
 * Deterministic, inert key_hash for email-only creem clients: a brand-new
 * subscriber has no lct_ key yet, but api_clients.key_hash is UNIQUE NOT
 * NULL. 'creem:' prefix can never collide with an lct_ key hash (the
 * middleware only matches sha256 of lct_ keys), so the row is pure
 * lifecycle accounting until C2 wires key delivery.
 *
 * @deprecated Used only by legacy rows in production and existing tests.
 * New checkout completions use generateKey()/hashKey() from keys.ts instead.
 * Kept exported for backward compatibility; do NOT use in new code paths.
 */
export function creemKeyHash(email: string): string {
  return `creem:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
}

export interface CompleteCheckoutInput {
  email: string;
  /** Creem event id (carried for C2 webhook_events idempotency). */
  eventId?: string;
}

export interface CompleteCheckoutResult {
  ok: true;
  clientId: number;
  /** true when the api_clients row was created by this call. */
  created: boolean;
  /** The previous kind when upgrading an existing row ('trial'|'agent'|'pro'|'creem'). */
  kindBefore?: string;
  /** Real lct_ API key — present only when a NEW key was generated (new row
   *  or legacy 'creem:' hash repaired). The key is never persisted to DB;
   *  only the hash is stored. Callers must deliver it (e.g. by email) and
   *  never log or persist the raw value. */
  issuedKey?: string;
}

export async function completeCheckout(
  db: Db,
  config: AppConfig,
  input: CompleteCheckoutInput,
): Promise<CompleteCheckoutResult> {
  if (!config.creem?.enabled) {
    throw new Error('CREEM_ENABLED is false — checkout completion is disabled (kill switch).');
  }
  const email = input.email.trim().toLowerCase();
  const periodEnd = new Date(Date.now() + CREEM_PERIOD_MS);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, kind, key_hash FROM api_clients WHERE lower(email) = lower($1)`,
      [email],
    );
    let clientId: number;
    let created: boolean;
    let kindBefore: string | undefined;
    let issuedKey: string | undefined;
    if (found.rows.length === 1) {
      const row = found.rows[0] as { id: number; kind: string; key_hash: string };
      clientId = row.id;
      kindBefore = row.kind;
      created = false;
      // Legacy repair: a subscriber whose key_hash still has the inert 'creem:'
      // prefix has never had a real lct_ key. Generate one now so they can
      // authenticate via x-client-key.
      if (row.kind === 'creem' && row.key_hash.startsWith('creem:')) {
        const key = generateKey();
        issuedKey = key;
        await client.query(
          `UPDATE api_clients
           SET kind = 'creem', current_period_end = $2, key_hash = $3
           WHERE id = $1 AND lower(email) = lower($4)`,
          [clientId, periodEnd, hashKey(key), email],
        );
      } else {
        await client.query(
          `UPDATE api_clients
           SET kind = 'creem', current_period_end = $2
           WHERE id = $1 AND lower(email) = lower($3)`,
          [clientId, periodEnd, email],
        );
      }
    } else {
      const key = generateKey();
      const keyHash = hashKey(key);
      const inserted = await client.query(
        `INSERT INTO api_clients (key_hash, kind, email, current_period_end)
         VALUES ($1, 'creem', $2, $3)
         ON CONFLICT (lower(email)) DO NOTHING
         RETURNING id`,
        [keyHash, email, periodEnd],
      );
      if (inserted.rows.length === 0) {
        // lost a concurrent race (same email inserted between SELECT and
        // INSERT): the row exists — upgrade it instead, mirroring the
        // found-branch semantics.
        const raced = await client.query(
          `SELECT id, kind, key_hash FROM api_clients WHERE lower(email) = lower($1)`,
          [email],
        );
        const row = raced.rows[0] as { id: number; kind: string; key_hash: string };
        clientId = row.id;
        kindBefore = row.kind;
        created = false;
        if (row.kind === 'creem' && row.key_hash.startsWith('creem:')) {
          const raceKey = generateKey();
          issuedKey = raceKey;
          await client.query(
            `UPDATE api_clients
             SET kind = 'creem', current_period_end = $2, key_hash = $3
             WHERE id = $1 AND lower(email) = lower($4)`,
            [clientId, periodEnd, hashKey(raceKey), email],
          );
        } else {
          await client.query(
            `UPDATE api_clients
             SET kind = 'creem', current_period_end = $2
             WHERE id = $1 AND lower(email) = lower($3)`,
            [clientId, periodEnd, email],
          );
        }
      } else {
        clientId = (inserted.rows[0] as { id: number }).id;
        created = true;
        issuedKey = key;
      }
    }
    await client.query('COMMIT');
    return {
      ok: true,
      clientId,
      created,
      ...(kindBefore !== undefined ? { kindBefore } : {}),
      ...(issuedKey !== undefined ? { issuedKey } : {}),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
