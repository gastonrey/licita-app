// PLACSP CODICE 3.2 / ATOM parsing (pure, no I/O) — P0.3.
//
// Verified against the live feeds on 2026-08-14 (fixtures in test/fixtures are
// unmodified slices of the real downloads):
// - Licitaciones: https://contrataciondelsectorpublico.gob.es/sindicacion/
//   sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom
// - Contratos menores: .../sindicacion_1143/contratosMenoresPerfilesContratantes.atom
//
// Real-world structure notes (divergences from the old stub TODO):
// - Paging is RFC 5005 (`<link rel="next">` timestamped files), NOT ?page=N.
// - Each ATOM <entry> EMBEDS the full CODICE document
//   (cac-place-ext:ContractFolderStatus) — no per-entry secondary fetch.
// - Entry lifecycle: the same expediente reappears as it transitions
//   ContractFolderStatusCode PUB → EV → ADJ → RES (SyndicationContractFolder
//   StatusCode-2.04). Upserts keyed on the expediente fold updates in place.
// - Awards live in cac:TenderResult. ResultCode (TenderResultCode-2.09):
//   1/2/8/9/11 mean awarded/formalized; 3-7 (void, abandoned, revoked) are
//   NOT awards and never produce award rows. Code 10 (highest rated) is
//   evaluative, not an award.
// - NIF is cac:PartyIdentification/cbc:ID with schemeName="NIF" only. Other
//   schemes (DIR3, ID_PLATAFORMA, OTROS) are NOT fiscal ids and never fill
//   companies.nif (no fabrication: unknown stays null).
// - No documented rate limit; the server answers chunked and rejects HEAD.
//   We stay polite with >= 500ms between requests (see placsp.ts).

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  isoDate,
  monthsFromDuration,
  normalizeName,
  num,
  pickNuts,
} from './normalize.js';

/** ResultCodes (TenderResultCode-2.09) that mean "awarded/formalized". */
export const AWARDED_RESULT_CODES = new Set(['1', '2', '8', '9', '11']);

/** ContractingSystemTypeCode-2.08 values meaning framework agreement
 *  (1 = establishes a framework, 3 = contract based on a framework).
 *  2/4 are dynamic purchasing systems, 0 = not applicable. */
export const FRAMEWORK_SYSTEM_CODES = new Set(['1', '3']);

const ARRAY_TAGS = new Set([
  'entry',
  'link',
  'at:deleted-entry',
  'cac:PartyIdentification',
  'cac:RequiredCommodityClassification',
  'cac:TenderResult',
  'cac:ProcurementProjectLot',
  'cac:WinningParty',
  'cac-place-ext:ValidNoticeInfo',
  'cac:RealizedLocation',
]);

export const placspXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep tag values as strings: expediente ids like "020120230187" must not
  // lose their leading zero; we convert to numbers explicitly via num().
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

type Node = Record<string, unknown>;

function asArr(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Text of a parsed element: "x" | { '#text': 'x', '@_attr': ... } → "x". */
function txt(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const inner = (v as Node)['#text'];
    return txt(inner);
  }
  return null;
}

function attr(v: unknown, name: string): string | null {
  if (v && typeof v === 'object') {
    const a = (v as Node)[`@_${name}`];
    return typeof a === 'string' && a.trim() ? a.trim() : null;
  }
  return null;
}

function child(node: unknown, tag: string): unknown {
  if (node && typeof node === 'object') return (node as Node)[tag];
  return undefined;
}

/** Amount with currencyID attribute → { value, currency }. */
function amount(node: unknown): { value: number | null; currency: string | null } {
  return { value: num(txt(node)), currency: attr(node, 'currencyID') };
}

// ---------------------------------------------------------------------------
// ATOM feed page
// ---------------------------------------------------------------------------

export interface PlacspFeedEntry {
  /** Which feed the entry came from (provenance). */
  feed: string;
  /** ATOM <id>, e.g. https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/19900639 */
  entryId: string;
  /** Deeplink to the notice detail page. */
  url: string | null;
  /** ATOM <updated> (RFC 3339 with tz). */
  updated: string | null;
  /** Parsed cac-place-ext:ContractFolderStatus node (raw, JSON-serializable). */
  statusNode: unknown;
  /** Whole parsed entry object — persisted verbatim in raw jsonb. */
  raw: unknown;
}

export interface PlacspAtomPage {
  entries: PlacspFeedEntry[];
  /** <at:deleted-entry> count (archived/annulled; skipped, never parsed). */
  deletedCount: number;
  /** <link rel="next"> href (RFC 5005 paged feeds) or null on the last page. */
  nextUrl: string | null;
}

export function parseAtomFeed(xml: string, feed: string): PlacspAtomPage {
  const invalid = XMLValidator.validate(xml);
  if (invalid !== true) {
    throw new Error(`placsp: malformed ATOM page (${invalid.err.msg})`);
  }
  const parsed = placspXmlParser.parse(xml) as Node;
  const feedNode = child(parsed, 'feed') as Node | undefined;
  if (!feedNode) throw new Error('placsp: not an ATOM feed document');

  const links = asArr(child(feedNode, 'link'));
  const nextUrl =
    links
      .map((l) => ({ rel: attr(l, 'rel'), href: attr(l, 'href') }))
      .find((l) => l.rel === 'next' && l.href)?.href ?? null;

  const entries: PlacspFeedEntry[] = [];
  for (const e of asArr(child(feedNode, 'entry'))) {
    const entryId = txt(child(e, 'id'));
    const statusNode = child(e, 'cac-place-ext:ContractFolderStatus');
    if (!entryId || !statusNode) continue; // partial entry: skipped (counted via pages stats)
    const link = asArr(child(e, 'link'))
      .map((l) => attr(l, 'href'))
      .find((h): h is string => !!h);
    entries.push({
      feed,
      entryId,
      url: link ?? null,
      updated: txt(child(e, 'updated')),
      statusNode,
      raw: e,
    });
  }
  return {
    entries,
    deletedCount: asArr(child(feedNode, 'at:deleted-entry')).length,
    nextUrl,
  };
}

// ---------------------------------------------------------------------------
// CODICE ContractFolderStatus → normalized doc
// ---------------------------------------------------------------------------

export interface PlacspParty {
  sourceRef: string;
  name: string;
  country: string | null;
  nif: string | null;
}

export interface PlacspAwardRow {
  sourceRef: string;
  lot: string | null;
  resultCode: string | null;
  awardDate: string | null;
  winner: PlacspParty | null;
  value: number | null;
  currency: string | null;
  biddersCount: number | null;
}

export interface PlacspNormalizedDoc {
  sourceRef: string; // placsp:<ContractFolderID>
  folderId: string;
  statusCode: string | null;
  publicationDate: string | null;
  buyer: PlacspParty & { nuts: string | null };
  title: string | null;
  description: string | null; // CODICE entries carry no free-text abstract: null
  cpvs: string[];
  nuts: string | null;
  procedureType: string | null;
  deadline: string | null;
  estimatedValue: number | null;
  budgetCurrency: string | null;
  framework: boolean;
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  awards: PlacspAwardRow[];
  raw: unknown;
}

/** PartyIdentification[] → first cbc:ID whose schemeName is exactly `scheme`. */
function idWithScheme(party: unknown, scheme: string): string | null {
  for (const pi of asArr(child(party, 'cac:PartyIdentification'))) {
    const idNode = child(pi, 'cbc:ID');
    if ((attr(idNode, 'schemeName') ?? '').toUpperCase() === scheme.toUpperCase()) {
      return txt(idNode);
    }
  }
  return null;
}

function partyName(party: unknown): string | null {
  return txt(child(child(party, 'cac:PartyName'), 'cbc:Name'));
}

function partyCountry(party: unknown, addressTag: string): string | null {
  const addr = child(party, addressTag);
  return txt(child(child(addr, 'cac:Country'), 'cbc:IdentificationCode'));
}

/** Dedupe key for a party: the fiscal id when the source declares one, else
 *  name_norm|country (same convention as TED, scoped per source). */
function partySourceRef(name: string, country: string | null, nif: string | null): string {
  return nif ? `nif:${nif}` : `name:${normalizeName(name)}|${country ?? ''}`;
}

function parseParty(party: unknown, addressTag: string): PlacspParty | null {
  const name = partyName(party);
  if (!name) return null;
  const country = partyCountry(party, addressTag);
  const nif = idWithScheme(party, 'NIF');
  return { sourceRef: partySourceRef(name, country, nif), name, country, nif };
}

/** UN/CEFACT DurationMeasure unitCode → months (ANN/MON/WEE/DAY seen live). */
function durationMonths(node: unknown): number | null {
  const unitMap: Record<string, string> = { ANN: 'YEAR', MON: 'MONTH', WEE: 'WEEK', DAY: 'DAY' };
  const unit = unitMap[(attr(node, 'unitCode') ?? '').toUpperCase()];
  return unit ? monthsFromDuration(txt(node), unit) : null;
}

function cpvCodes(scope: unknown): string[] {
  const out: string[] = [];
  for (const rc of asArr(child(scope, 'cac:RequiredCommodityClassification'))) {
    const code = txt(child(rc, 'cbc:ItemClassificationCode'));
    if (code && /^\d{8}/.test(code)) out.push(code.slice(0, 8));
  }
  return out;
}

/**
 * Parse one feed entry into a normalized doc. Returns null when the entry
 * lacks the minimum identity (ContractFolderID, buyer name) — never
 * fabricates. Awards are emitted only for TenderResults whose ResultCode is
 * an awarded/formalized code (see AWARDED_RESULT_CODES).
 */
export function parsePlacspEntry(entry: PlacspFeedEntry): PlacspNormalizedDoc | null {
  const s = entry.statusNode;
  const folderId = txt(child(s, 'cbc:ContractFolderID'));
  if (!folderId) return null;
  const sourceRef = `placsp:${folderId}`;

  const buyerParty = child(child(s, 'cac-place-ext:LocatedContractingParty'), 'cac:Party');
  const buyerBase = parseParty(buyerParty, 'cac:PostalAddress');
  if (!buyerBase) return null;

  const project = child(s, 'cac:ProcurementProject');
  const nuts = pickNuts([
    ...asArr(child(project, 'cac:RealizedLocation')).map((l) =>
      txt(child(l, 'cbc:CountrySubentityCode')),
    ),
  ]);

  // CPVs: project level plus per-lot classifications.
  const lots = asArr(child(s, 'cac:ProcurementProjectLot'));
  const cpvs = [
    ...new Set([
      ...cpvCodes(project),
      ...lots.flatMap((lot) => cpvCodes(child(lot, 'cac:ProcurementProject'))),
    ]),
  ];

  const planned = child(project, 'cac:PlannedPeriod');
  const budget = child(project, 'cac:BudgetAmount');
  const budgetAmount = ((): { value: number | null; currency: string | null } => {
    const excl = amount(child(budget, 'cbc:TaxExclusiveAmount'));
    if (excl.value !== null) return excl;
    return amount(child(budget, 'cbc:EstimatedOverallContractAmount'));
  })();

  const process = child(s, 'cac:TenderingProcess');
  const deadlinePeriod = child(process, 'cac:TenderSubmissionDeadlinePeriod');
  const deadlineDate = isoDate(txt(child(deadlinePeriod, 'cbc:EndDate')));
  const deadlineTime = txt(child(deadlinePeriod, 'cbc:EndTime'));

  const issueDates = asArr(child(s, 'cac-place-ext:ValidNoticeInfo'))
    .map((vni) =>
      isoDate(
        txt(
          child(
            child(
              child(vni, 'cac-place-ext:AdditionalPublicationStatus'),
              'cac-place-ext:AdditionalPublicationDocumentReference',
            ),
            'cbc:IssueDate',
          ),
        ),
      ),
    )
    .filter((d): d is string => d !== null)
    .sort();

  const awards: PlacspAwardRow[] = [];
  const results = asArr(child(s, 'cac:TenderResult')).filter((tr) => {
    const code = txt(child(tr, 'cbc:ResultCode'));
    return code !== null && AWARDED_RESULT_CODES.has(code);
  });
  results.forEach((tr, i) => {
    const awardedProject = child(tr, 'cac:AwardedTenderedProject');
    const lot = txt(child(awardedProject, 'cbc:ProcurementProjectLotID'));
    const total = child(awardedProject, 'cac:LegalMonetaryTotal');
    const val = ((): { value: number | null; currency: string | null } => {
      const excl = amount(child(total, 'cbc:TaxExclusiveAmount'));
      if (excl.value !== null) return excl;
      return amount(child(total, 'cbc:PayableAmount'));
    })();
    const winnerParty = asArr(child(tr, 'cac:WinningParty'))[0];
    const winner = winnerParty ? parseParty(winnerParty, 'cac:PhysicalLocation') : null;
    const suffix = results.length === 1 ? '' : `#${lot ?? i}`;
    awards.push({
      sourceRef: `${sourceRef}${suffix}`,
      lot,
      resultCode: txt(child(tr, 'cbc:ResultCode')),
      awardDate:
        isoDate(txt(child(tr, 'cbc:AwardDate'))) ??
        isoDate(txt(child(child(tr, 'cac:Contract'), 'cbc:IssueDate'))),
      winner,
      value: val.value,
      currency: val.currency,
      biddersCount: num(txt(child(tr, 'cbc:ReceivedTenderQuantity'))),
    });
  });

  return {
    sourceRef,
    folderId,
    statusCode: txt(child(s, 'cbc-place-ext:ContractFolderStatusCode')),
    publicationDate: issueDates[0] ?? null,
    buyer: { ...buyerBase, nuts },
    title: txt(child(project, 'cbc:Name')),
    description: null,
    cpvs,
    nuts,
    procedureType: txt(child(process, 'cbc:ProcedureCode')),
    deadline: deadlineDate ? `${deadlineDate}T${deadlineTime ?? '00:00:00'}` : null,
    estimatedValue: budgetAmount.value,
    budgetCurrency: budgetAmount.currency,
    framework: FRAMEWORK_SYSTEM_CODES.has(
      txt(child(process, 'cbc:ContractingSystemCode')) ?? '',
    ),
    durationMonths: durationMonths(child(planned, 'cbc:DurationMeasure')),
    startDate: isoDate(txt(child(planned, 'cbc:StartDate'))),
    endDate: isoDate(txt(child(planned, 'cbc:EndDate'))),
    url: entry.url,
    awards,
    raw: { feed: entry.feed, entry_id: entry.entryId, updated: entry.updated, entry: entry.raw },
  };
}
