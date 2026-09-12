// i18n resolver for the bilingual UX refresh (slice S1).
//
// Design decision (b) — self-contained dictionaries:
//   - ES dict (root locale): all hrefs are bare ("/data/spain", "/v1/pricing", …).
//   - EN dict: human-page hrefs are /en-prefixed (/en/data, /en/pricing, …),
//     dev-surface hrefs stay bare (/docs, /v1/*, /mcp, /llms.txt, /openapi.json,
//     /styles.css, /sitemap.xml, /robots.txt, /.well-known, /health).
//     That makes 'href' the only router-level concern; the EN dict doesn't
//     need to mirror the router.
//
// t():  Hard-fails on a missing key AND on a missing variable (fail-fast).
//       No silent English leak.
//
// href(): ES → passthrough; idempotent for /en-prefixed; dev surfaces bare;
//         "/" → "/en"; "/#…" → "/en" + path.slice(1); else → "/en" + path.
import { es } from './locales/es.js';
import { en } from './locales/en.js';
import type { Locale } from './locales/types.js';

// ---- types ----------------------------------------------------------------

export type LocaleCode = 'es' | 'en';

// ---- internals ------------------------------------------------------------

export const LOCALES: Record<LocaleCode, Locale> = { es, en };

// Regex patterns for dev-surface paths that should NOT receive /en prefix.
const DEV_SURFACE_PATTERNS: readonly RegExp[] = [
  /^\/docs(\/|$)/,
  /^\/v1(\/|$)/,
  /^\/mcp(\/|$)/,
  /^\/llms\.txt(\/|$)/,
  /^\/openapi\.json(\/|$)/,
  /^\/styles\.css(\/|$)/,
  /^\/sitemap\.xml(\/|$)/,
  /^\/robots\.txt(\/|$)/,
  /^\/\.well-known(\/|$)/,
  /^\/health(\/|$)/,
];

/**
 * Walk a dot-separated key path into an object tree.
 * Throws immediately if any intermediate node is missing (fail-fast).
 */
function leafAt(obj: Locale, dotPath: string): string {
  const parts = dotPath.split('.');
  let cursor: unknown = obj;

  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') {
      throw new Error(`Missing locale key: ${dotPath}`);
    }
    const next = (cursor as Record<string, unknown>)[part];
    if (next === undefined) {
      throw new Error(`Missing locale key: ${dotPath}`);
    }
    cursor = next;
  }

  if (typeof cursor !== 'string') {
    throw new Error(`Missing locale key: ${dotPath}`);
  }
  return cursor;
}

/**
 * Replace {placeholder} tokens in a string with the corresponding value from
 * `vars`. Throws if any token referenced in the template is not provided —
 * including when no vars at all were passed. This keeps t() fail-fast: a key
 * that requires variables can never be rendered with placeholders left in.
 */
function substitute(template: string, vars?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = vars?.[token];
    if (value === undefined) {
      throw new Error(`Missing variable "${token}" in t() call`);
    }
    return String(value);
  });
}

// ---- public API -----------------------------------------------------------

/**
 * Return a translated string for the given locale and dot-path.
 *
 * **Fail-fast**: throws if the key is missing OR if any required variable
 * is absent — no silent fallback, no English leak.
 */
export function t(locale: LocaleCode, key: string, vars?: Record<string, string | number>): string {
  const template = leafAt(LOCALES[locale], key);
  return substitute(template, vars);
}

/**
 * Prefix a path for English readers; passthrough for ES.
 *
 * Rules (design decision b):
 *   1. ES  → passthrough.
 *   2. `/en` or `/en/…` → passthrough (idempotent).
 *   3. Dev surfaces (/docs, /v1/*, /mcp, /llms.txt, /openapi.json,
 *      /styles.css, /sitemap.xml, /robots.txt, /.well-known, /health)
 *      → passthrough (bare — EN dict already carries the correct hrefs).
 *   4. "/" → "/en".
 *   5. "/#…" → "/en" + path.slice(1)   (e.g. "/#demo" → "/en#demo").
 *   6. Else → "/en" + path.
 */
export function href(locale: LocaleCode, path: string): string {
  // 1. ES — passthrough.
  if (locale === 'es') return path;

  // 2. Idempotent: already /en-prefixed.
  if (path === '/en' || path.startsWith('/en/')) return path;

  // 3. Dev surfaces — bare, no prefix.
  if (DEV_SURFACE_PATTERNS.some((rx) => rx.test(path))) return path;

  // 4. Root.
  if (path === '/') return '/en';

  // 5. Hash-only fragment.
  if (path.startsWith('/#')) return `/en${path.slice(1)}`;

  // 6. Human page — add /en prefix.
  return `/en${path}`;
}

/**
 * Derive locale from a request path.
 * `/en`, `/en/…` → 'en'; everything else → 'es'.
 */
export function localeFromPath(path: string): LocaleCode {
  if (path === '/en' || path.startsWith('/en/')) return 'en';
  return 'es';
}

/**
 * Flip the current locale to the other one.
 */
export function otherLocale(locale: LocaleCode): LocaleCode {
  return locale === 'es' ? 'en' : 'es';
}

/**
 * Invariant display name of a locale in that locale's own language.
 * Deliberately NOT a dictionary key — it is used by the path-preserving
 * `.lang-switch` element on both locales, so the ES page must render the
 * target language "English" and the EN page "Español".
 */
export function languageName(locale: LocaleCode): string {
  return locale === 'es' ? 'Español' : 'English';
}