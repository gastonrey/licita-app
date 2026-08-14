// PLACSP ATOM/CODICE parser tests against REAL feed slices (test/fixtures,
// downloaded 2026-08-14 from the official sindicación endpoints; values are
// unmodified upstream data, only the entry count was trimmed).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AWARDED_RESULT_CODES,
  parseAtomFeed,
  parsePlacspEntry,
  placspXmlParser,
  type PlacspFeedEntry,
} from '../../src/ingest/placsp-parse.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const licXml = readFileSync(join(fixturesDir, 'placsp-atom-licitaciones.xml'), 'utf8');
const menXml = readFileSync(join(fixturesDir, 'placsp-atom-menores.xml'), 'utf8');

function entryByFolder(xml: string, folderId: string): PlacspFeedEntry {
  const page = parseAtomFeed(xml, 'licitaciones');
  const found = page.entries.find((x) => JSON.stringify(x.statusNode).includes(folderId));
  if (!found) throw new Error(`fixture entry not found: ${folderId}`);
  return found;
}

describe('parseAtomFeed', () => {
  it('parses entries, RFC 5005 next link and deleted-entry count (licitaciones)', () => {
    const page = parseAtomFeed(licXml, 'licitaciones');
    expect(page.entries).toHaveLength(3);
    expect(page.deletedCount).toBe(1); // at:deleted-entry (ANULADA) is skipped
    expect(page.nextUrl).toMatch(
      /^https:\/\/contrataciondelestado\.es\/sindicacion\/sindicacion_643\/licitacionesPerfilesContratanteCompleto3_\d{8}_\d{6}\.atom$/,
    );
    const first = page.entries[0];
    expect(first.entryId).toBe(
      'https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/19900639',
    );
    expect(first.updated).toBe('2026-08-10T19:34:01.738+02:00');
    expect(first.url).toContain('deeplink:detalle_licitacion');
    expect(first.url).not.toContain('&amp;'); // XML entities decoded
  });

  it('parses the contratos menores feed page', () => {
    const page = parseAtomFeed(menXml, 'menores');
    expect(page.entries).toHaveLength(2);
    expect(page.deletedCount).toBe(0);
    expect(page.nextUrl).toContain('sindicacion_1143/contratosMenoresPerfilesContratantes_');
  });

  it('rejects malformed XML and non-feed documents', () => {
    expect(() => parseAtomFeed('<feed><entry>', 'x')).toThrow(/malformed ATOM/);
    expect(() => parseAtomFeed('<html><body>redirect</body></html>', 'x')).toThrow(
      /not an ATOM feed/,
    );
  });
});

describe('parsePlacspEntry — licitación (EV, no TenderResult)', () => {
  const doc = parsePlacspEntry(entryByFolder(licXml, 'S-02027-2026'))!;

  it('maps identity, buyer with NIF, CPVs, budget, planned period', () => {
    expect(doc).not.toBeNull();
    expect(doc.sourceRef).toBe('placsp:S-02027-2026');
    expect(doc.statusCode).toBe('EV');
    expect(doc.title).toBe(
      'Servicio de validación metadatado y lenguas cooficiales para RTVE.es',
    );
    expect(doc.buyer.name).toBe(
      'Compras de la Corporación de Radio y Televisión Española S.A.',
    );
    expect(doc.buyer.nif).toBe('A84818558'); // schemeName="NIF", not DIR3
    expect(doc.buyer.sourceRef).toBe('nif:A84818558');
    expect(doc.buyer.country).toBe('ES');
    expect(doc.nuts).toBe('ES300');
    expect(doc.cpvs).toEqual(['72512000', '79530000']);
    expect(doc.estimatedValue).toBe(717120); // TaxExclusiveAmount
    expect(doc.budgetCurrency).toBe('EUR');
    expect(doc.durationMonths).toBe(36); // DurationMeasure 3 ANN
    expect(doc.deadline).toBe('2026-07-20T14:00:00');
    expect(doc.procedureType).toBe('1');
    expect(doc.framework).toBe(false); // ContractingSystemCode 0
    expect(doc.publicationDate).toBe('2026-06-19'); // earliest IssueDate
  });

  it('produces no award rows for a licitación-only document', () => {
    expect(doc.awards).toEqual([]);
    expect(doc.description).toBeNull(); // CODICE carries no abstract; never fabricated
  });
});

describe('parsePlacspEntry — adjudicación (RES, single winner)', () => {
  const doc = parsePlacspEntry(entryByFolder(licXml, '020120230187'))!;

  it('maps the TenderResult award with winner NIF, value, bidders', () => {
    expect(doc.statusCode).toBe('RES');
    expect(doc.sourceRef).toBe('placsp:020120230187'); // leading zero preserved
    expect(doc.buyer.nif).toBe('S2813060G');
    expect(doc.awards).toHaveLength(1);
    const a = doc.awards[0];
    expect(a.sourceRef).toBe('placsp:020120230187'); // no suffix when single result
    expect(a.resultCode).toBe('9'); // Formalized
    expect(a.awardDate).toBe('2024-02-14');
    expect(a.winner?.name).toBe('TRANSVIA,S.L.');
    expect(a.winner?.nif).toBe('B46036398');
    expect(a.winner?.sourceRef).toBe('nif:B46036398');
    expect(a.value).toBe(770234.4); // TaxExclusiveAmount
    expect(a.currency).toBe('EUR');
    expect(a.biddersCount).toBe(1);
    expect(a.lot).toBeNull();
    expect(doc.durationMonths).toBe(24); // 2 ANN
    expect(doc.cpvs).toEqual(['60130000']);
    expect(doc.publicationDate).toBe('2023-10-19');
  });
});

describe('parsePlacspEntry — multi-lot RES (one award per awarded lot)', () => {
  const doc = parsePlacspEntry(entryByFolder(licXml, 'CON/2026/6'))!;

  it('suffixes source_ref per lot, winner NIFs per TenderResult', () => {
    expect(doc.awards).toHaveLength(2);
    const [a1, a2] = doc.awards;
    expect(a1.lot).toBe('1');
    expect(a1.sourceRef).toBe('placsp:CON/2026/6#1');
    expect(a1.winner?.nif).toBe('B74408725');
    expect(a1.value).toBe(60728.36);
    expect(a2.lot).toBe('2');
    expect(a2.sourceRef).toBe('placsp:CON/2026/6#2');
    expect(a2.winner?.nif).toBe('B22600928');
    expect(a2.value).toBe(12987.64);
  });
});

describe('parsePlacspEntry — contratos menores (RES)', () => {
  const page = parseAtomFeed(menXml, 'menores');
  const docs = page.entries.map((e) => parsePlacspEntry(e)!);

  it('maps menor award with winner NIF and payable amounts', () => {
    const d = docs[0];
    expect(d.sourceRef).toBe('placsp:CMENOR/2026/39N25/0266-2026/10529');
    expect(d.statusCode).toBe('RES');
    expect(d.buyer.name).toBe('Conselleria de Educación, Cultura y Universidades');
    expect(d.buyer.nif).toBe('S4611001A');
    expect(d.procedureType).toBe('6');
    expect(d.cpvs).toEqual(['92521210']);
    expect(d.awards).toHaveLength(1);
    const a = d.awards[0];
    expect(a.awardDate).toBe('2026-05-18');
    expect(a.winner?.name).toBe('LACASA DIAZ MARIA MERCEDES');
    expect(a.winner?.nif).toBe('18162397X');
    expect(a.value).toBe(3000);
    expect(a.currency).toBe('EUR');
    expect(d.startDate).toBe('2026-05-18');
    expect(d.durationMonths).toBe(2); // DurationMeasure 2 MON
    expect(d.publicationDate).toBe('2026-08-14');
  });

  it('never fabricates a NIF from non-NIF schemes (schemeName="OTROS")', () => {
    const d = docs[1];
    const a = d.awards[0];
    expect(a.winner?.name).toBe('ELSEVIER B.V.');
    expect(a.winner?.nif).toBeNull(); // OTROS id is not a Spanish NIF
    expect(a.winner?.sourceRef).toMatch(/^name:elsevier b\.v\.\|/);
    expect(a.value).toBe(2400);
  });
});

describe('parsePlacspEntry — missing fields stay null (synthetic minimal doc)', () => {
  const minimal: PlacspFeedEntry = {
    feed: 'licitaciones',
    entryId: 'https://example/x/1',
    url: null,
    updated: null,
    statusNode: (placspXmlParser.parse(
      `<cac-place-ext:ContractFolderStatus
        xmlns:cac-place-ext="urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2"
        xmlns:cbc-place-ext="urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2"
        xmlns:cac="urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2"
        xmlns:cbc="urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2">
        <cbc:ContractFolderID>MIN-1</cbc:ContractFolderID>
        <cac-place-ext:LocatedContractingParty>
          <cac:Party><cac:PartyName><cbc:Name>Órgano X</cbc:Name></cac:PartyName></cac:Party>
        </cac-place-ext:LocatedContractingParty>
      </cac-place-ext:ContractFolderStatus>`,
    ) as Record<string, unknown>)['cac-place-ext:ContractFolderStatus'],
    raw: null,
  };
  const doc = parsePlacspEntry(minimal)!;

  it('nulls everything absent; buyer keyed by name when no NIF', () => {
    expect(doc.sourceRef).toBe('placsp:MIN-1');
    expect(doc.buyer.name).toBe('Órgano X');
    expect(doc.buyer.nif).toBeNull();
    expect(doc.buyer.sourceRef).toBe('name:organo x|');
    expect(doc.statusCode).toBeNull();
    expect(doc.publicationDate).toBeNull();
    expect(doc.title).toBeNull();
    expect(doc.cpvs).toEqual([]);
    expect(doc.nuts).toBeNull();
    expect(doc.procedureType).toBeNull();
    expect(doc.deadline).toBeNull();
    expect(doc.estimatedValue).toBeNull();
    expect(doc.framework).toBe(false);
    expect(doc.durationMonths).toBeNull();
    expect(doc.startDate).toBeNull();
    expect(doc.endDate).toBeNull();
    expect(doc.awards).toEqual([]);
  });

  it('returns null without ContractFolderID or buyer name', () => {
    expect(parsePlacspEntry({ ...minimal, statusNode: {} })).toBeNull();
    const noBuyer = {
      ...minimal,
      statusNode: { 'cbc:ContractFolderID': 'X-1' },
    };
    expect(parsePlacspEntry(noBuyer)).toBeNull();
  });
});

describe('award result-code gate', () => {
  it('void/abandoned/revoked codes (3-7) and evaluative 10 are not awards', () => {
    expect(AWARDED_RESULT_CODES.has('3')).toBe(false);
    expect(AWARDED_RESULT_CODES.has('7')).toBe(false);
    expect(AWARDED_RESULT_CODES.has('10')).toBe(false);
    for (const code of ['1', '2', '8', '9', '11']) {
      expect(AWARDED_RESULT_CODES.has(code)).toBe(true);
    }
  });
});
