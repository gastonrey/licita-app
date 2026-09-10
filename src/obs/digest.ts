// C1.3 Weekly Renewal Radar digest (fiat-revenue-rails RD).
//
// Two pieces:
// - buildWeeklyDigest(db, window): reads api_clients + payments and groups
//   subscribers into the three radar buckets the operator cares about:
//     renewed   — stripe plan active at window end (or a completed payment
//                 landed inside the window);
//     watchlist — any client running low on calls (< 10 remaining);
//     churnRisk — stripe subscriber with no renewal for 30+ days (expired
//                 current_period_end AND no completed payment inside 30d).
//   Rows with NULL email (legacy agent rows) are never reported; empty
//   buckets render an honest empty state, never invented data.
// - sendWeeklyDigest(env): builds the current weekly window (now-7d → now),
//   composes the email and posts it through the generalized Resend transport
//   (notify.sendEmail). RATE-GUARD: recipients are ONLY DIGEST_FROM_EMAIL
//   (as To) and the DIGEST_BCC list — external addresses can never appear,
//   so test/dev digest runs cannot spam strangers. Missing from/bcc/key →
//   skip silently (no-op), the same posture as lead emails.

import type { Db } from '../db/client.js';
import { sendEmail, type NotifyLogger, type ResendEmailPayload } from './notify.js';

export const DIGEST_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** Churn-risk threshold: no payment for this many days (30). */
export const DIGEST_CHURN_DAYS = 30;
/** Watchlist threshold: remaining calls below this number. */
export const DIGEST_WATCHLIST_CALLS = 10;

export interface DigestWindow {
  from: Date;
  to: Date;
}

export interface DigestClientEntry {
  email: string;
  tier: string;
  calls_remaining: number | null;
  current_period_end: string | null;
  last_payment_at: string | null;
}

export interface DigestData {
  window: DigestWindow;
  renewed: DigestClientEntry[];
  watchlist: DigestClientEntry[];
  churnRisk: DigestClientEntry[];
  /** Distinct api_clients rows with a non-null email (digestable clients). */
  activeCount: number;
}

interface AccumulatedClient {
  email: string;
  tier: string;
  callsRemaining: number | null;
  currentPeriodEnd: Date | null;
  lastPaymentAt: Date | null;
}

function toDateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Group api_clients (non-null email) with their payments history into the
 * renewed / watchlist / churnRisk radar buckets for the given window.
 * Deterministic: rows are ordered by lower(email).
 */
export async function buildWeeklyDigest(db: Db, window: DigestWindow): Promise<DigestData> {
  const res = await db.query(
    `SELECT
       c.email, c.kind, c.calls_remaining, c.current_period_end,
       p.created_at AS payment_created_at, p.status AS payment_status
     FROM api_clients c
     LEFT JOIN payments p ON p.client_id = c.id
     WHERE c.email IS NOT NULL`,
  );

  const byEmail = new Map<string, AccumulatedClient>();
  for (const row of res.rows as Array<{
    email: string;
    kind: string;
    calls_remaining: number | null;
    current_period_end: unknown;
    payment_created_at: unknown;
    payment_status: string | null;
  }>) {
    if (!row.email || row.email.trim() === '') continue; // legacy agent rows
    let acc = byEmail.get(row.email.toLowerCase());
    if (!acc) {
      acc = {
        email: row.email,
        tier: row.kind,
        callsRemaining: row.calls_remaining ?? null,
        currentPeriodEnd: toDateOrNull(row.current_period_end),
        lastPaymentAt: null,
      };
      byEmail.set(row.email.toLowerCase(), acc);
    }
    // The newest completed payment wins (rows are ordered DESC per client).
    if (row.payment_status === 'completed' && !acc.lastPaymentAt) {
      acc.lastPaymentAt = toDateOrNull(row.payment_created_at);
    }
  }

  const normalizedEmail = (email: string): string => email.trim().toLowerCase();
  const churnCutoff = new Date(window.to.getTime() - DIGEST_CHURN_DAYS * 24 * 3600 * 1000);

  const renewed: DigestClientEntry[] = [];
  const watchlist: DigestClientEntry[] = [];
  const churnRisk: DigestClientEntry[] = [];

  // Deterministic ordering: by normalized email (mirrors the SQL ORDER BY).
  const ordered = [...byEmail.values()].sort((a, b) =>
    normalizedEmail(a.email).localeCompare(normalizedEmail(b.email), 'en'),
  );

  for (const acc of ordered) {
    const entry: DigestClientEntry = {
      email: acc.email,
      tier: acc.tier,
      calls_remaining: acc.callsRemaining,
      current_period_end: acc.currentPeriodEnd ? acc.currentPeriodEnd.toISOString() : null,
      last_payment_at: acc.lastPaymentAt ? acc.lastPaymentAt.toISOString() : null,
    };

    const paidInWindow =
      acc.lastPaymentAt !== null && acc.lastPaymentAt >= window.from && acc.lastPaymentAt < window.to;
    const activeAtWindowEnd =
      acc.tier === 'stripe' && acc.currentPeriodEnd !== null && acc.currentPeriodEnd >= window.to;
    if (paidInWindow || activeAtWindowEnd) {
      renewed.push(entry);
    }

    if (acc.callsRemaining !== null && acc.callsRemaining < DIGEST_WATCHLIST_CALLS) {
      watchlist.push(entry);
    }

    const expiredPastGrace =
      acc.tier === 'stripe' &&
      (acc.currentPeriodEnd === null || acc.currentPeriodEnd < churnCutoff) &&
      (acc.lastPaymentAt === null || acc.lastPaymentAt < churnCutoff);
    if (expiredPastGrace) {
      churnRisk.push(entry);
    }
  }

  return {
    window,
    renewed,
    watchlist,
    churnRisk,
    activeCount: byEmail.size,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

function renderList(entries: DigestClientEntry[]): string {
  if (entries.length === 0) {
    return '<p style="font-size: 14px; color: #666;">None this window — no fabricated findings.</p>';
  }
  return (
    '<ul style="font-size: 14px; line-height: 1.6;">' +
    entries
      .map(
        (e) =>
          `<li><strong>${escapeHtml(e.email)}</strong> · tier ${escapeHtml(e.tier)} · calls left ${e.calls_remaining ?? 'n/a'} · period end ${e.current_period_end ? fmtDate.format(new Date(e.current_period_end)) : 'n/a'}</li>`,
      )
      .join('') +
    '</ul>'
  );
}

export interface DigestEmail {
  subject: string;
  html: string;
  from: string;
  to: [string, ...string[]];
  bcc: string[];
}

/** Render the digest email (subject + html). Pure and deterministic (UTC). */
export function renderDigestEmail(data: DigestData, baseUrl: string, from: string): DigestEmail {
  const fromLabel = fmtDate.format(data.window.from);
  const toLabel = fmtDate.format(data.window.to);
  const subject = `Weekly Renewal Radar — ${fromLabel} → ${toLabel} (UTC)`;
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
<h1 style="font-size: 18px; margin: 0 0 8px;">EU Tech-Policy Deadlines — Renewal Radar</h1>
<p style="font-size: 14px; color: #666; margin: 0 0 20px;">Weekly digest window: <strong>${fromLabel} → ${toLabel}</strong> (UTC) · ${data.activeCount} active client(s) with an email on record.</p>

<h2 style="font-size: 15px; margin: 20px 0 8px;">Renewed (plan active / payment this window)</h2>
${renderList(data.renewed)}

<h2 style="font-size: 15px; margin: 20px 0 8px;">Watchlist (calls remaining &lt; ${DIGEST_WATCHLIST_CALLS})</h2>
${renderList(data.watchlist)}

<h2 style="font-size: 15px; margin: 20px 0 8px;">Churn risk (no payment for ${DIGEST_CHURN_DAYS}d)</h2>
${renderList(data.churnRisk)}

<p style="font-size: 12px; color: #999; margin-top: 28px;">Licita · EU public procurement intelligence · ${escapeHtml(baseUrl || 'deployment origin unset')} · Data is evidence-backed from the live index; nulls are shown honestly.</p>
</body></html>`;
  return { subject, html, from, to: [from], bcc: [] };
}

export interface DigestSendEnv {
  db: Db;
  log: NotifyLogger;
  /** RESEND_API_KEY. Empty → skip (dev/test without secrets). */
  resendApiKey: string;
  /** DIGEST_FROM_EMAIL — the only To recipient allowed. */
  from: string;
  /** DIGEST_BCC — comma-separated recipient list, the only Bcc allowed. */
  bcc: string;
  /** Deployment origin for the footer link. */
  baseUrl: string;
  /** Injection seam: current time used to derive the weekly window. */
  now?: Date;
  /** Injection seam: transport (defaults to notify.sendEmail). */
  send?: (log: NotifyLogger, apiKey: string, payload: ResendEmailPayload, tag: string) => void;
}

/**
 * Build and send the weekly digest. RATE-GUARD: recipients are exactly
 * `from` (To) and the `bcc` list — never any other address. Returns true
 * when an email was handed to the transport; false when the guard skipped it.
 */
export async function sendWeeklyDigest(env: DigestSendEnv): Promise<boolean> {
  const { db, log, resendApiKey, from, bcc, baseUrl, now = new Date(), send = sendEmail } = env;
  if (!from || !bcc || !resendApiKey) {
    log.debug('weekly digest skipped: DIGEST_FROM_EMAIL / DIGEST_BCC / RESEND_API_KEY not fully set', {
      from,
      bcc,
    });
    return false;
  }

  const to = now;
  const fromDate = new Date(to.getTime() - DIGEST_WINDOW_MS);
  const data = await buildWeeklyDigest(db, { from: fromDate, to });
  const bccList = bcc
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const email = renderDigestEmail(data, baseUrl, from);
  send(log, resendApiKey, { ...email, bcc: bccList }, 'digest');
  return true;
}