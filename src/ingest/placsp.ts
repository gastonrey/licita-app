// PLACSP ingester — STRETCH goal (SPEC §8), NOT enabled.
//
// Status: deliberately disabled. The TED path (ted.ts + normalize.ts) is the
// MVP data source; this module exists so callers can feature-detect PLACSP
// support without faking coverage.
//
// TODO (precise) to implement for real:
// 1. Source: PLACSP CODICE syndication — ATOM feeds per contracting body and
//    the global "licitaciones" feed, documented at
//    https://contrataciondelestado.es (sindicación CODICE, e.g.
//    /sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom
//    with ?page=N pagination). Entries are CODICE 3.2 XML (UBL-ish).
// 2. Fetch feed pages newest→oldest until entries older than the harvest
//    window (INGEST_MONTHS); respect robots/rate limits (>= 1 req/s pause).
// 3. Map CODICE → our tables via a placspNoticeToNormalized() parser:
//    - cbc:ID + issue date → source_ref ("placsp:<id>")
//    - ContractFolderStatus codes: only award/result folders
//      (ProcurementProject / ContractAward notice equivalents)
//    - cac:Party (ContractingParty → buyers, TenderingParty/winners →
//      companies; PartyIdentification/cbc:ID → companies.nif)
//    - cac:RequiredClassification (CPV codes) → cpvs/tenders.cpv_*
//    - cbc:TotalAmount / cac:LegalMonetaryTotal → awards.value/currency
//    - cac:ContractPeriod (start/end dates) → awards/contract derivation
// 4. Register source row: sources.code = 'placsp' (license: open data,
//    reuse per PLACSP legal notice; base_url https://contrataciondelestado.es).
// 5. Reuse persistNotice()-style upserts; add unit fixtures from a real ATOM
//    page before enabling. Do NOT enable without fixture-backed tests.

export const PLACSP_ENABLED = false;

export function placspEnabled(): boolean {
  return PLACSP_ENABLED;
}

/** Always throws: PLACSP ingestion is not implemented (see module TODO). */
export async function harvestPlacsp(): Promise<never> {
  const entry = {
    level: 'warn',
    msg: 'placsp ingest not enabled',
    reason: 'stretch goal; CODICE ATOM ingester not implemented (see src/ingest/placsp.ts TODO)',
    ts: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
  throw new Error('PLACSP ingestion is not enabled (stretch goal, see src/ingest/placsp.ts)');
}
