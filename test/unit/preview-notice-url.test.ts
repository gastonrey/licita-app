// The radar page (and the homepage table / /v1/demo card) build notice links
// in the browser. new URL(null, location.origin) is the bug: it navigates to
// https://<host>/null. A missing url must render the source reference as text.

import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { radarScript } from '../../src/web/preview-script.js';

function loadClient(): {
  relicitaUrl: (value: unknown) => string;
  relicitaSource: (row: Record<string, unknown>) => string;
} {
  const js = radarScript().replace(/^<script>/, '').replace(/<\/script>$/, '');
  const sandbox: Record<string, unknown> = {
    location: {
      origin: 'https://eutendersai.com',
      href: 'https://eutendersai.com/en/radar',
      search: '',
      pathname: '/en/radar',
    },
    document: {
      documentElement: { lang: 'en' },
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    history: { pushState() {} },
    fetch: () => Promise.reject(new Error('unused')),
    URL,
    URLSearchParams,
    FormData: class {},
    AbortSignal,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox);
  return sandbox as {
    relicitaUrl: (value: unknown) => string;
    relicitaSource: (row: Record<string, unknown>) => string;
  };
}

describe('radar notice links', () => {
  const client = loadClient();

  it('never resolves a missing url against the page origin', () => {
    expect(client.relicitaUrl(null)).toBe('');
    expect(client.relicitaUrl(undefined)).toBe('');
    expect(client.relicitaUrl('null')).toBe('');
    expect(client.relicitaUrl('undefined')).toBe('');
    expect(client.relicitaUrl('/radar')).toBe('');
    expect(client.relicitaUrl('https://eutendersai.com/null')).toBe('');
    expect(client.relicitaUrl('https://eutendersai.com/en/radar/null')).toBe('');
    expect(client.relicitaUrl('https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML')).toBe(
      'https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML',
    );
  });

  it('renders the source reference as text when there is no absolute url', () => {
    const html = client.relicitaSource({
      source: 'placsp',
      source_ref: 'placsp:S-02027-2026',
      url: null,
    });
    expect(html).toContain('PLACSP');
    expect(html).toContain('placsp:S-02027-2026');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('/null');
    expect(html).not.toContain('href="null"');
  });

  it('links a real TED or PLACSP url and still ignores a literal null', () => {
    const ted = client.relicitaSource({
      source: 'ted',
      source_ref: '111-2026',
      url: 'https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML',
    });
    expect(ted).toContain('href="https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML"');
    const placsp = client.relicitaSource({
      source: 'placsp',
      source_ref: 'placsp:S-02027-2026',
      url: 'https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=abc',
    });
    expect(placsp).toContain('href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=abc"');
    const missing = client.relicitaSource({ source: 'ted', source_ref: '111-2026', url: 'null' });
    expect(missing).not.toContain('<a ');
    expect(missing).not.toContain('/null');
  });

  it('uses the same guard for the /v1/demo upstream link', () => {
    const src = radarScript();
    expect(src).toContain('relicitaUrl(t && t.url) || relicitaUrl(r && r.url)');
    expect(src).not.toContain('new URL(u, location.origin)');
  });
});
