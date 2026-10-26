// The homepage evidence card hydrates from GET /v1/demo. Production often
// returns 200 with note + priced_endpoints and null tender/renewal. The card
// must leave "Cargando…" for an empty or error state, never stay busy.

import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import Fastify from 'fastify';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';

const openWindows: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const w of openWindows) w.close();
  openWindows.length = 0;
});

async function homeHtml(): Promise<string> {
  const app = Fastify({ logger: false });
  registerWeb(app, makeTestConfig());
  const res = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  return res.body;
}

function sampleScript(html: string): string {
  const start = html.indexOf('<script>const sample=document.getElementById');
  if (start < 0) throw new Error('homepage sample script missing');
  const end = html.indexOf('</script>', start);
  return html.slice(start + '<script>'.length, end);
}

async function boot(payload: unknown, ok = true) {
  const html = await homeHtml();
  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  openWindows.push(dom.window);
  dom.window.fetch = async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith('/v1/demo')) {
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => payload,
      };
    }
    if (u.startsWith('/v1/radar/preview')) {
      return { ok: true, status: 200, json: async () => ({ data: { renewals: { rows: [], shown: 0, total: 0 } } }) };
    }
    throw new Error('unexpected fetch ' + u);
  };
  dom.window.eval(sampleScript(html));
  const sample = () => dom.window.document.getElementById('demo-sample');
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (sample()?.dataset.state && sample()?.dataset.state !== 'loading') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return sample()!;
}

describe('homepage live sample card', () => {
  it('shows an empty state when the demo payload has no row', async () => {
    const sample = await boot({ data: { note: 'Free sample', priced_endpoints: [], tender: null, renewal: null } });
    expect(sample.dataset.state).toBe('empty');
    expect(sample.getAttribute('aria-busy')).toBe('false');
    expect(sample.textContent).toContain('no tiene una fila de muestra');
    expect(sample.textContent).not.toContain('Cargando');
  });

  it('renders a real tender row and its source metadata', async () => {
    const sample = await boot({
      data: {
        note: 'Free sample',
        priced_endpoints: [],
        tender: {
          title: 'Servicios de ciberseguridad',
          buyer: { name: 'Ayuntamiento de Madrid' },
          estimated_value: 120000,
          currency: 'EUR',
          published_at: '2026-04-01',
          source: 'ted',
          source_ref: '123-2026',
          evidence: ['Tender title: Servicios de ciberseguridad'],
          url: 'https://ted.europa.eu/udl?uri=TED:NOTICE:123-2026',
        },
        renewal: null,
        source_metadata: [{ source: 'ted', records: 1 }],
      },
      meta: { generated_at: '2026-10-26T08:00:00.000Z' },
    });
    expect(sample.dataset.state).toBe('ready');
    expect(sample.textContent).toContain('Servicios de ciberseguridad');
    expect(sample.querySelector('.evidence-lines')).not.toBeNull();
    expect(sample.textContent).toContain('source_metadata');
    expect(sample.textContent).not.toContain('Cargando');
  });

  it('shows an error with retry when the sample request fails', async () => {
    const sample = await boot({}, false);
    expect(sample.dataset.state).toBe('error');
    expect(sample.getAttribute('aria-busy')).toBe('false');
    expect(sample.textContent).toContain('No se ha podido cargar la fila de muestra');
    expect(sample.querySelector('[data-retry]')).not.toBeNull();
    expect(sample.textContent).not.toContain('Cargando');
  });
});
