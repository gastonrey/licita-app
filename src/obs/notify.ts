// Fire-and-forget emails via the Resend HTTP API (P0.x):
// - notifyNewLead: operator notification on new demo lead.
// - notifyLeadAck: branded confirmation to the lead (demo auto-reply).
// No new runtime dependency — uses global
// fetch. Never throws, never blocks the request path.
//
// Behavior:
// - If RESEND_API_KEY is empty (dev/test runs without secrets): skip silently.
// - Else POST to https://api.resend.com/emails with a 5s AbortController timeout.
// - On non-2xx or network error: log warn with lead id and a sanitized hint of
//   the response body. The request that triggered the notification already
//   succeeded (the lead was inserted), so the email is best-effort.

import type { Db } from '../db/client.js';
import { absoluteUrl } from '../config.js';

/** Minimal log surface we depend on. Compatible with the project Logger and
 *  with Fastify's FastifyBaseLogger (which has debug/info/warn/error methods). */
export interface NotifyLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface NotifyLead {
  id: number;
  email: string;
  channel: string;
  source_url: string | null;
}

export interface NotifyConfig {
  notifyEmail: string;
  resendApiKey: string;
  resendFrom: string;
  /** DEMO_AUTOREPLY_ENABLED gate for the lead confirmation email (default true). */
  demoAutoReplyEnabled?: boolean;
  /** Deployment origin (env BASE_URL) for links inside emails. Empty when
   *  unset — links fall back to root-relative form, never a hardcoded host. */
  baseUrl?: string;
}

interface ResendPayload {
  from: string;
  to: [string, ...string[]];
  subject: string;
  html: string;
  reply_to?: string;
}

/** Shared fire-and-forget POST to the Resend HTTP API. Never throws; `tag`
 *  namespaces the log lines ('lead notification' | 'lead auto-reply'). */
function resendSend(log: NotifyLogger, tag: string, leadId: number, apiKey: string, payload: ResendPayload): void {
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.warn(`${tag} failed`, {
          leadId,
          status: res.status,
          statusText: res.statusText,
          body: text.slice(0, 200),
        });
      } else {
        log.info(`${tag} sent`, { leadId, to: payload.to[0] });
      }
    })
    .catch((err: unknown) => {
      log.warn(`${tag} error`, {
        leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => clearTimeout(timer));
}

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 5_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function buildHtml(lead: NotifyLead, dashboardUrl: string): string {
  const safeEmail = escapeHtml(lead.email);
  const safeChannel = escapeHtml(lead.channel);
  const safeSource = lead.source_url ? escapeHtml(lead.source_url) : null;
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
<h1 style="font-size: 18px; margin: 0 0 16px;">New demo lead</h1>
<table style="border-collapse: collapse; font-size: 14px;">
  <tr><td style="padding: 4px 12px 4px 0; color: #666;">Email</td><td style="padding: 4px 0;"><strong>${safeEmail}</strong></td></tr>
  <tr><td style="padding: 4px 12px 4px 0; color: #666;">Channel</td><td style="padding: 4px 0;">${safeChannel}</td></tr>
  ${safeSource ? `<tr><td style="padding: 4px 12px 4px 0; color: #666;">Source URL</td><td style="padding: 4px 0;"><a href="${safeSource}">${safeSource}</a></td></tr>` : ''}
  <tr><td style="padding: 4px 12px 4px 0; color: #666;">Lead ID</td><td style="padding: 4px 0;">${lead.id}</td></tr>
</table>
<p style="margin-top: 24px;"><a href="${escapeHtml(dashboardUrl)}" style="background: #B9472E; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none; display: inline-block;">Open operator dashboard</a></p>
</body></html>`;
}

/**
 * Send an operator-notification email for a new lead. Fire-and-forget. Returns
 * void; never throws. If `resendApiKey` is empty, this is a no-op (dev/test).
 */
export function notifyNewLead(_db: Db, log: NotifyLogger, lead: NotifyLead, cfg: NotifyConfig): void {
  if (!cfg.resendApiKey) {
    log.debug('lead notification skipped: RESEND_API_KEY is empty', { leadId: lead.id });
    return;
  }
  const html = buildHtml(lead, absoluteUrl(cfg.baseUrl ?? '', '/dashboard?view=leads'));
  resendSend(log, 'lead notification', lead.id, cfg.resendApiKey, {
    from: cfg.resendFrom,
    to: [cfg.notifyEmail],
    subject: `New demo lead: ${lead.email}`,
    html,
  });
}

function buildAckHtml(email: string, baseUrl: string): string {
  const safeEmail = escapeHtml(email);
  const demoUrl = absoluteUrl(baseUrl, '/v1/demo');
  const docsUrl = absoluteUrl(baseUrl, '/docs');
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
<h1 style="font-size: 18px; margin: 0 0 16px;">Your Licita demo request is in</h1>
<p>Hi ${safeEmail},</p>
<p>Thanks for requesting a Licita demo. Here is what happens next:</p>
<ul style="font-size: 14px; line-height: 1.6;">
  <li>A guided review of your market — the tenders, buyers and renewal signals relevant to you.</li>
  <li>An evidence-backed sample from the live index, so you see the actual output before any meeting.</li>
</ul>
<p style="font-size: 14px; line-height: 1.6;">In the meantime you can get instant value without signup:</p>
<ul style="font-size: 14px; line-height: 1.6;">
  <li>Free sample endpoint: <a href="${demoUrl}">${demoUrl}</a></li>
  <li>Developer docs: <a href="${docsUrl}">${docsUrl}</a></li>
</ul>
<p style="font-size: 14px; line-height: 1.6;">To schedule your review, simply reply to this email.</p>
<p style="font-size: 13px; color: #666;">— The Licita team · Public procurement intelligence for professionals</p>
</body></html>`;
}

/**
 * Send the branded confirmation email to the lead after a successful demo
 * request. Fire-and-forget; never throws. Skipped silently when
 * `resendApiKey` is empty or `demoAutoReplyEnabled` is false — same semantics
 * as the operator notification.
 */
export function notifyLeadAck(log: NotifyLogger, lead: NotifyLead, cfg: NotifyConfig): void {
  if (!cfg.resendApiKey) {
    log.debug('lead auto-reply skipped: RESEND_API_KEY is empty', { leadId: lead.id });
    return;
  }
  if (cfg.demoAutoReplyEnabled === false) {
    log.debug('lead auto-reply skipped: DEMO_AUTOREPLY_ENABLED is false', { leadId: lead.id });
    return;
  }
  resendSend(log, 'lead auto-reply', lead.id, cfg.resendApiKey, {
    from: cfg.resendFrom,
    to: [lead.email],
    subject: 'Licita demo request received — what happens next',
    html: buildAckHtml(lead.email, cfg.baseUrl ?? ''),
    reply_to: cfg.notifyEmail,
  });
}
