// Fire-and-forget lead notification via the Resend HTTP API (P0.x: operator
// notification on new demo lead). No new runtime dependency — uses global
// fetch. Never throws, never blocks the request path.
//
// Behavior:
// - If RESEND_API_KEY is empty (dev/test runs without secrets): skip silently.
// - Else POST to https://api.resend.com/emails with a 5s AbortController timeout.
// - On non-2xx or network error: log warn with lead id and a sanitized hint of
//   the response body. The request that triggered the notification already
//   succeeded (the lead was inserted), so the email is best-effort.

import type { Db } from '../db/client.js';

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
  const html = buildHtml(lead, 'https://licita.app/dashboard?view=leads');
  const body = JSON.stringify({
    from: cfg.resendFrom,
    to: [cfg.notifyEmail],
    subject: `New demo lead: ${lead.email}`,
    html,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.warn('lead notification failed', {
          leadId: lead.id,
          status: res.status,
          statusText: res.statusText,
          body: text.slice(0, 200),
        });
      } else {
        log.info('lead notification sent', { leadId: lead.id, to: cfg.notifyEmail });
      }
    })
    .catch((err: unknown) => {
      log.warn('lead notification error', {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => clearTimeout(timer));
}
