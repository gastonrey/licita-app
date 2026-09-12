// Locale dictionary contract for the bilingual public web (SDD change
// bilingual-es-en-ux-refresh, slice S1). Every human-facing string of the
// public site lives in src/web/locales/{en,es}.ts; src/web/i18n.ts resolves
// them with hard failure on missing keys (spec R2 — no silent English leak).
//
// Placeholders are {var} tokens substituted by t(). Mandated set:
//   {creemPrice}   — configured Creem monthly price in EUR ("49.50" -> "€49.50")
//   {researchPrice}— config.researchPriceUsd ("0.50" -> "$0.50")
//   {mcpEndpoint}  — absolute URL of the MCP endpoint
// Additional vars used by embedded copy: {email}, {year}, {paymentsMode}.
//
// Design decision (b): dictionaries are self-contained — the EN dict writes
// /en-prefixed hrefs for human pages and bare /… hrefs for dev surfaces
// (/docs, /v1/*, /mcp, /llms.txt, /openapi.json, …); the ES dict writes bare
// /… hrefs throughout (root is Spanish).

export type LocaleCode = 'es' | 'en';

export type UseCaseSlug =
  | 'tender-intelligence'
  | 'company-research'
  | 'buyer-intelligence'
  | 'renewals-forecasting';

export type TrustPageSlug = 'methodology' | 'security' | 'privacy' | 'terms' | 'status';

export interface UseCaseDetailDict {
  title: string;
  problem: string;
  tools: string;
  honestNote: string;
}

export interface TrustPageDict {
  title: string;
  body: string;
}

export interface FaqItemDict {
  question: string;
  answer: string;
}

export interface Locale {
  nav: {
    skipToContent: string;
    navLabel: string;
    brand: string;
    home: string;
    useCases: string;
    coverageAndMethodology: string;
    pricing: string;
    docs: string;
    mcp: string;
    toggleMenu: string;
    requestDemo: string;
  };
  home: {
    title: string;
    metaDescription: string;
    heroEyebrow: string;
    heroEyebrowTag: string;
    heroTitle: string;
    heroSubtitle: string;
    heroCtas: { demo: string; sample: string };
    heroCaption: string;
    evidenceCard: { aria: string; title: string; stamp: string; loading: string; sourceStamp: string };
    builtOn: string;
    trustStrip: {
      eu: { kicker: string; label: string };
      es: { kicker: string; label: string };
      dates: { kicker: string; label: string };
      openSource: { kicker: string; label: string };
      status: { kicker: string; label: string };
    };
    ctaDemo: {
      title: string;
      body: string;
      emailLabel: string;
      emailPlaceholder: string;
      submit: string;
      success: string;
      noscript: string;
    };
    usecases: {
      title: string;
      cards: Record<UseCaseSlug, { title: string; desc: string }>;
    };
    pricing: {
      title: string;
      introCreem: string;
      intro: string;
      cards: {
        monthly: { plan: string; amountN: string; amountU: string; desc: string; tag: string };
        research: { plan: string; amountN: string; amountU: string; desc: string; tag: string };
        core: { plan: string; amountN: string; amountU: string; desc: string; tag: string };
        credits: { plan: string; amountN: string; amountU: string; desc: string; tag: string };
      };
      note: string;
    };
    coverage: { title: string; body: string; dataLinks: string };
    developers: { title: string; body: string };
    faq: {
      title: string;
      items: {
        accountSubscription: FaqItemDict & { answerCreem: string };
        creditsAndKeys: FaqItemDict;
        usdcWallet: FaqItemDict;
        demoRetention: FaqItemDict;
      };
    };
    connect: { title: string; body: string; docsLink: string; sampleLink: string };
  };
  usecases: {
    title: string;
    metaDescription: string;
    intro: string;
    freeTitle: string;
    freeBody: string;
    detail: { toolsTitle: string; exampleTitle: string; honestyTitle: string; allUseCases: string };
  };
  usecaseDetail: Record<UseCaseSlug, UseCaseDetailDict>;
  data: {
    overview: {
      h1: string;
      intro: string;
      bullets: [string, string, string];
      accessTitle: string;
      accessBody: string;
    };
    spain: { h1: string; intro: string; bullets: [string, string, string]; overviewLink: string };
    eu: { h1: string; intro: string; bullets: [string, string, string]; overviewLink: string };
  };
  pricing: {
    title: string;
    metaDescription: string;
    intro: string;
    priceTable: { endpointHeader: string; priceHeader: string; freeTag: string };
    demoFreeNote: string;
    creditsTitle: string;
    creditsIntroCreem: string;
    creditsIntro: string;
    bundles: { bundleHeader: string; priceHeader: string };
    twoRails: string;
    monthlyTitle: string;
    monthlyBody: string;
    buyLine: string;
    howPaymentTitle: string;
    steps: [string, string, string, string];
  };
  trust: Record<TrustPageSlug, TrustPageDict>;
  notFound: { title: string; heading: string };
  footer: {
    desc: string;
    product: string;
    company: string;
    contact: string;
    useCases: string;
    pricing: string;
    docs: string;
    mcp: string;
    coverageAndMethodology: string;
    methodology: string;
    security: string;
    privacy: string;
    terms: string;
    status: string;
    github: string;
    provenance: string;
    copyright: string;
    backToLicita: string;
  };
  jsonLd: { description: string };
}