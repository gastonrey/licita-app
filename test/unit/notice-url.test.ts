// Notice links must be absolute http(s) URLs. A null, the string "null", or a
// relative path must never be resolved against a site origin into "/null".

import { describe, expect, it } from 'vitest';
import { absoluteHttpUrl, publicNoticeUrl, tedUrl } from '../../src/api/routes/common.js';

const TED = 'https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML';
const PLACSP = 'https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=abc%3D';

describe('absoluteHttpUrl', () => {
  it('accepts absolute http(s) urls and keeps upstream encoding', () => {
    expect(absoluteHttpUrl(PLACSP)).toBe(PLACSP);
    expect(absoluteHttpUrl('  https://ted.europa.eu/en/notice/-/detail/1-2026  ')).toBe(
      'https://ted.europa.eu/en/notice/-/detail/1-2026',
    );
  });

  it('rejects null, the string null, relative paths and /null', () => {
    expect(absoluteHttpUrl(null)).toBeUndefined();
    expect(absoluteHttpUrl(undefined)).toBeUndefined();
    expect(absoluteHttpUrl('null')).toBeUndefined();
    expect(absoluteHttpUrl(' undefined ')).toBeUndefined();
    expect(absoluteHttpUrl('/radar')).toBeUndefined();
    expect(absoluteHttpUrl('detalle_licitacion')).toBeUndefined();
    expect(absoluteHttpUrl('https://eutendersai.com/null')).toBeUndefined();
    expect(absoluteHttpUrl('https://eutendersai.com/en/radar/null')).toBeUndefined();
    expect(absoluteHttpUrl('javascript:alert(1)')).toBeUndefined();
  });
});

describe('tedUrl', () => {
  it('prefers a stored absolute url and otherwise builds the canonical notice', () => {
    expect(tedUrl('111-2026', 'https://stored.example/x')).toBe('https://stored.example/x');
    expect(tedUrl('111-2026')).toBe(TED);
    expect(tedUrl('111-2026', 'null')).toBe(TED);
    expect(tedUrl('111-2026', '/relative')).toBe(TED);
  });

  it('does not invent a TED url from a PLACSP id or from nothing', () => {
    expect(tedUrl(null)).toBeUndefined();
    expect(tedUrl('placsp:S-02027-2026')).toBeUndefined();
    expect(tedUrl('null')).toBeUndefined();
  });
});

describe('publicNoticeUrl', () => {
  it('builds a TED notice from the publication number when no url is stored', () => {
    expect(publicNoticeUrl('ted', '111-2026', null)).toBe(TED);
    expect(publicNoticeUrl('ted', '111-2026', 'null')).toBe(TED);
  });

  it('uses a stored PLACSP detail link and does not invent one from the folder id', () => {
    expect(publicNoticeUrl('placsp', 'placsp:S-02027-2026', PLACSP)).toBe(PLACSP);
    expect(publicNoticeUrl('placsp', '333-2026', null)).toBeNull();
    expect(publicNoticeUrl('placsp', 'placsp:S-02027-2026', 'null')).toBeNull();
  });
});
