// Weekly customer radar.
//
// One Spanish email per demo_requests address that has not unsubscribed,
// with up to 5 real CPV 48/72 renewals from the same query as
// GET /v1/radar/preview. A row in radar_digest_sends claims the UTC week
// so a second run does not send again. A failed delivery releases the claim.
//
// Scheduled by the existing digest runner (DIGEST_ENABLED +
// SCHEDULED_GENERATION_EVENTS + DIGEST_CRON). Also runnable by hand:
//   npm run radar:digest
//   POST /v1/radar/digest  (header x-operator-key)
// Unsubscribe links are signed with OPERATOR_KEY. No new environment variables.
// Tests pass `deliver` and never call Resend.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { absoluteUrl } from '../config.js';
import type { Db } from '../db/client.js';
import { radarPreviewData, type RadarPreviewQuery } from '../api/routes/radar.js';
import { envelope, HttpError, type RouteCtx } from '../api/routes/common.js';
import type { NotifyLogger } from './notify.js';

export const CUSTOMER_RADAR_LIMIT = 5;

export interface RadarMailRow {
  title: string | null;
  buyer: string | null;
  value: number | null;
  currency: string | null;
  source: string | null;
  windowStart: string | null;
  confidence: string | null;
}

export interface RadarMailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export type CustomerRadarBlock = 'missing_resend' | 'missing_from' | 'missing_secret';

export interface CustomerRadarResult {
  week_start: string;
  recipients: number;
  sent: number;
  already_sent: number;
  failed: number;
  blocked: CustomerRadarBlock | null;
}

export interface CustomerRadarEnv {
  db: Db;
  log: NotifyLogger;
  resendApiKey: string;
  from: string;
  baseUrl: string;
  operatorKey: string;
  now?: Date;
  /** Test seam. Production uses Resend. */
  deliver?: (message: RadarMailMessage) => Promise<boolean>;
}

interface Subscriber {
  email: string;
  source_url: string | null;
}

interface SignupFilter {
  cpv?: string;
  region?: string;
}

/** Monday (UTC) of the week containing `now`, as YYYY-MM-DD. */
export function weekStartIso(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = day.getUTCDay();
  const delta = dow === 0 ? 6 : dow - 1;
  day.setUTCDate(day.getUTCDate() - delta);
  return day.toISOString().slice(0, 10);
}

export function unsubscribeToken(email: string, secret: string): string {
  const normalized = email.trim().toLowerCase();
  const payload = Buffer.from(normalized, 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(normalized).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret || !token || token.length > 500) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let email = '';
  try {
    email = Buffer.from(payload, 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email || email.includes('\n') || email.includes('\r')) return null;
  const expected = createHmac('sha256', secret).update(email).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return email;
}

/** CPV and NUTS prefix captured on the signup URL, when they are valid. */
export function signupFilters(sourceUrl: string | null): SignupFilter {
  if (!sourceUrl) return {};
  let params: URLSearchParams;
  try {
    const url = sourceUrl.startsWith('http') ? new URL(sourceUrl) : new URL(sourceUrl, 'https://local.invalid');
    params = url.searchParams;
  } catch {
    return {};
  }
  const cpv = params.get('cpv') ?? '';
  const region = params.get('region') ?? '';
  const out: SignupFilter = {};
  if (/^(48|72)\d{0,6}$/.test(cpv)) out.cpv = cpv;
  if (/^[A-Za-z0-9]{2,5}$/.test(region)) out.region = region;
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function sourceLabel(code: string | null): string {
  if (!code) return 'No consta';
  const lower = code.toLowerCase();
  if (lower === 'ted') return 'TED';
  if (lower === 'placsp') return 'PLACSP';
  return code.toUpperCase();
}

function formatMoney(value: number | null, currency: string | null): string {
  if (value == null) return 'No consta';
  const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value);
  if (!currency) return `${number} (moneda no consta)`;
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${number} ${currency}`;
  }
}

function confidenceLabel(value: string | null): string {
  if (value === 'high') return 'Alta';
  if (value === 'medium') return 'Media';
  if (value === 'low') return 'Baja · estimación';
  return 'No consta';
}

function formatDay(iso: string | null): string {
  if (!iso) return 'No consta';
  const day = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return 'No consta';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(day);
}

export function customerRadarSubject(count: number): string {
  if (count === 0) return 'Relicita: sin renovaciones de software e IT esta semana';
  if (count === 1) return 'Relicita: 1 renovación de software e IT';
  return `Relicita: ${count} renovaciones de software e IT`;
}

export function renderCustomerRadarEmail(input: {
  rows: RadarMailRow[];
  total: number;
  filter: SignupFilter;
  radarUrl: string;
  unsubscribeUrl: string;
}): string {
  const filterBits = [
    input.filter.cpv ? `CPV ${input.filter.cpv}` : 'CPV 48 y 72',
    input.filter.region ? `zona ${input.filter.region}` : 'todas las zonas',
  ];
  const items = input.rows
    .map((row) => {
      const title = escapeHtml(row.title ?? 'Contrato sin título');
      return `<li style="margin: 0 0 14px;">
<strong>${title}</strong><br>
Comprador: ${escapeHtml(row.buyer ?? 'No consta')}<br>
Importe: ${escapeHtml(formatMoney(row.value, row.currency))}<br>
Fuente: ${escapeHtml(sourceLabel(row.source))}<br>
Confianza: ${escapeHtml(confidenceLabel(row.confidence))}<br>
Fecha estimada de renovación: ${escapeHtml(formatDay(row.windowStart))}
</li>`;
    })
    .join('');
  const list = input.rows.length
    ? `<ul style="padding-left: 18px;">${items}</ul>`
    : '<p>Esta semana no hay renovaciones de software o servicios IT (CPV 48 y 72) en los próximos 12 meses para este filtro.</p>';
  const countLine = input.total > input.rows.length
    ? `<p>${input.rows.length} de ${input.total} señales. El resto está en el radar.</p>`
    : `<p>${input.rows.length} señal${input.rows.length === 1 ? '' : 'es'} en los próximos 12 meses.</p>`;
  return `<!doctype html>
<html lang="es"><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
<h1 style="font-size: 18px; margin: 0 0 12px;">Tu radar semanal</h1>
<p>Hasta 5 renovaciones reales de contratos públicos de software e IT. Son las mismas filas que la muestra pública: si el importe o la fecha no están, la fuente no los trajo. La fecha estimada es el inicio de la ventana guardada, no una probabilidad.</p>
<p>Filtro de tu alta: ${escapeHtml(filterBits.join(', '))}.</p>
${countLine}
${list}
<p><a href="${escapeHtml(input.radarUrl)}">Ver el radar</a></p>
<p style="font-size: 13px; color: #666;">Si no quieres recibir este correo, <a href="${escapeHtml(input.unsubscribeUrl)}">date de baja</a>. Es un solo clic.</p>
<p style="font-size: 13px; color: #666;">El equipo de Relicita</p>
</body></html>`;
}

function unsubscribeHtml(ok: boolean): string {
  const title = ok ? 'Baja hecha' : 'Enlace no válido';
  const body = ok
    ? 'Esta dirección no recibirá más el radar semanal de Relicita.'
    : 'Este enlace de baja no es válido. Usa el enlace del último correo.';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${title} — Relicita</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1.25rem; color: #1a1a1a;">
<h1>${title}</h1>
<p>${body}</p>
<p><a href="/radar">Volver al radar</a></p>
</body></html>`;
}

function mapRow(row: Record<string, unknown>): RadarMailRow {
  const buyer = row.buyer as { name?: string } | null;
  const contract = row.contract as { title?: string | null; value?: number | null; currency?: string | null } | null;
  return {
    title: contract?.title ?? null,
    buyer: buyer?.name ?? null,
    value: contract?.value ?? null,
    currency: contract?.currency ?? null,
    source: (row.source as string | null) ?? null,
    windowStart: (row.window_start as string | null) ?? null,
    confidence: (row.confidence as string | null) ?? null,
  };
}

async function renewalsFor(
  db: Db,
  filter: SignupFilter,
  cache: Map<string, { rows: RadarMailRow[]; total: number }>,
): Promise<{ rows: RadarMailRow[]; total: number }> {
  const key = `${filter.cpv ?? ''}|${filter.region ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const query: RadarPreviewQuery = {
    window_months: 12,
    ...(filter.cpv ? { cpv: filter.cpv } : {}),
    ...(filter.region ? { region: filter.region } : {}),
  };
  const data = await radarPreviewData(db, query);
  const block = data.renewals as { rows: Array<Record<string, unknown>>; total: number };
  const packed = {
    rows: block.rows.slice(0, CUSTOMER_RADAR_LIMIT).map(mapRow),
    total: block.total,
  };
  cache.set(key, packed);
  return packed;
}

/** POST https://api.resend.com/emails. Returns false on any failure. Never throws. */
export async function deliverResendEmail(apiKey: string, message: RadarMailMessage): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, html: message.html }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendCustomerRadarDigest(env: CustomerRadarEnv): Promise<CustomerRadarResult> {
  const now = env.now ?? new Date();
  const week = weekStartIso(now);
  const result: CustomerRadarResult = {
    week_start: week,
    recipients: 0,
    sent: 0,
    already_sent: 0,
    failed: 0,
    blocked: null,
  };
  if (!env.resendApiKey) result.blocked = 'missing_resend';
  else if (!env.from.trim()) result.blocked = 'missing_from';
  else if (!env.operatorKey) result.blocked = 'missing_secret';
  if (result.blocked) {
    env.log.warn('customer radar digest skipped', { blocked: result.blocked, week_start: week });
    return result;
  }

  const subscribers = await env.db.query(
    `SELECT email, source_url FROM demo_requests WHERE unsubscribed_at IS NULL ORDER BY id ASC`,
  );
  const rows = subscribers.rows as Subscriber[];
  result.recipients = rows.length;
  const deliver = env.deliver ?? ((message: RadarMailMessage) => deliverResendEmail(env.resendApiKey, message));
  const cache = new Map<string, { rows: RadarMailRow[]; total: number }>();
  const radarUrl = absoluteUrl(env.baseUrl, '/radar');

  for (const subscriber of rows) {
    const claimToken = randomUUID();
    await env.db.query(
      `INSERT INTO radar_digest_sends (email, week_start, claim_token)
       VALUES ($1, CAST($2 AS date), $3)
       ON CONFLICT (email, week_start) DO NOTHING`,
      [subscriber.email, week, claimToken],
    );
    const owner = await env.db.query(
      `SELECT claim_token FROM radar_digest_sends WHERE email = $1 AND week_start = CAST($2 AS date)`,
      [subscriber.email, week],
    );
    if (owner.rows[0]?.claim_token !== claimToken) {
      result.already_sent += 1;
      continue;
    }
    try {
      const filter = signupFilters(subscriber.source_url);
      const packed = await renewalsFor(env.db, filter, cache);
      const token = unsubscribeToken(subscriber.email, env.operatorKey);
      const unsubscribeUrl = `${absoluteUrl(env.baseUrl, '/radar/baja')}?token=${encodeURIComponent(token)}`;
      const html = renderCustomerRadarEmail({
        rows: packed.rows,
        total: packed.total,
        filter,
        radarUrl,
        unsubscribeUrl,
      });
      const ok = await deliver({
        from: env.from,
        to: subscriber.email,
        subject: customerRadarSubject(packed.rows.length),
        html,
      });
      if (!ok) throw new Error('deliver failed');
      result.sent += 1;
    } catch (err) {
      await env.db.query(
        `DELETE FROM radar_digest_sends WHERE email = $1 AND week_start = CAST($2 AS date) AND claim_token = $3`,
        [subscriber.email, week, claimToken],
      );
      result.failed += 1;
      env.log.warn('customer radar digest delivery failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  env.log.info('customer radar digest done', {
    week_start: week,
    recipients: result.recipients,
    sent: result.sent,
    already_sent: result.already_sent,
    failed: result.failed,
  });
  return result;
}

export function unsubscribeHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = (req.query as { token?: unknown }).token;
    const email = verifyUnsubscribeToken(typeof token === 'string' ? token : '', ctx.config.operatorKey);
    if (!email) {
      return reply.code(400).type('text/html; charset=utf-8').send(unsubscribeHtml(false));
    }
    await ctx.db.query(
      `UPDATE demo_requests SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE lower(email) = $1`,
      [email],
    );
    return reply.type('text/html; charset=utf-8').send(unsubscribeHtml(true));
  };
}

export function customerRadarDigestHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await sendCustomerRadarDigest({
      db: ctx.db,
      log: ctx.log,
      resendApiKey: ctx.config.resendApiKey,
      from: ctx.config.digestFromEmail || ctx.config.resendFrom,
      baseUrl: ctx.config.baseUrl,
      operatorKey: ctx.config.operatorKey,
    });
    if (result.blocked) {
      throw new HttpError(
        409,
        'invalid_query',
        'Customer radar digest is not configured',
        result.blocked,
      );
    }
    return reply.send(envelope(req, result));
  };
}
