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

/** Thirty days in milliseconds (subscription period length, design B2). */
export const CREEM_PERIOD_MS = 30 * 24 * 3600 * 1000;

/**
 * Deterministic, inert key_hash for email-only creem clients: a brand-new
 * subscriber has no lct_ key yet, but api_clients.key_hash is UNIQUE NOT
 * NULL. 'creem:' prefix can never collide with an lct_ key hash (the
 * middleware only matches sha256 of lct_ keys), so the row is pure
 * lifecycle accounting until C2 wires key delivery.
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
      `SELECT id, kind FROM api_clients WHERE lower(email) = lower($1)`,
      [email],
    );
    let clientId: number;
    let created: boolean;
    let kindBefore: string | undefined;
    if (found.rows.length === 1) {
      const row = found.rows[0] as { id: number; kind: string };
      clientId = row.id;
      kindBefore = row.kind;
      created = false;
      await client.query(
        `UPDATE api_clients
         SET kind = 'creem', current_period_end = $2
         WHERE id = $1 AND lower(email) = lower($3)`,
        [clientId, periodEnd, email],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO api_clients (key_hash, kind, email, current_period_end)
         VALUES ($1, 'creem', $2, $3)
         ON CONFLICT (lower(email)) DO NOTHING
         RETURNING id`,
        [creemKeyHash(email), email, periodEnd],
      );
      if (inserted.rows.length === 0) {
        // lost a concurrent race (same email inserted between SELECT and
        // INSERT): the row exists — upgrade it instead, mirroring the
        // found-branch semantics.
        const raced = await client.query(
          `SELECT id, kind FROM api_clients WHERE lower(email) = lower($1)`,
          [email],
        );
        const row = raced.rows[0] as { id: number; kind: string };
        clientId = row.id;
        kindBefore = row.kind;
        created = false;
        await client.query(
          `UPDATE api_clients
           SET kind = 'creem', current_period_end = $2
           WHERE id = $1 AND lower(email) = lower($3)`,
          [clientId, periodEnd, email],
        );
      } else {
        clientId = (inserted.rows[0] as { id: number }).id;
        created = true;
      }
    }
    await client.query('COMMIT');
    return { ok: true, clientId, created, ...(kindBefore !== undefined ? { kindBefore } : {}) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
