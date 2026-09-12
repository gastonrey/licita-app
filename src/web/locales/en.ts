// English dictionary — current pages.ts copy moved VERBATIM (SDD slice S1,
// spec N1 byte fidelity). No rewording: every string was lifted byte-for-byte
// from src/web/pages.ts (nav/footer/shell copy, homepage, use-cases + detail,
// data pages, pricing page, trust pages, 404, JSON-LD description). The only
// transformations are mechanical and auditable:
//   - runtime values became {var} placeholders ({creemPrice}, {researchPrice},
//     {mcpEndpoint}, {email}, {year}, {paymentsMode});
//   - human-page links are /en-prefixed (design decision b); dev-surface links
//     (/docs, /v1/*, /mcp, /llms.txt, /openapi.json, /styles.css, /sitemap.xml)
//     stay bare on purpose.
import type { Locale } from './types.js';

export const en: Locale = {
  nav: {
    skipToContent: 'Skip to content',
    navLabel: 'Primary',
    brand: 'Licita',
    home: 'Home',
    useCases: 'Use cases',
    coverageAndMethodology: 'Coverage & methodology',
    pricing: 'Pricing',
    docs: 'Docs',
    mcp: 'MCP',
    toggleMenu: 'Toggle menu',
    requestDemo: 'Request demo',
  },
  home: {
    title: 'Public procurement intelligence for EU & Spain',
    metaDescription:
      'Evidence-backed tenders, buyers, suppliers and deterministic renewal signals from TED (EU) and PLACSP (Spain) for professional teams. REST API + MCP.',
    heroEyebrow: 'EU Public Procurement Intelligence',
    heroEyebrowTag: 'Evidence First',
    heroTitle: 'Know which public contracts deserve your next conversation.',
    heroSubtitle:
      'Licita turns indexed procurement notices into evidence-backed opportunities, buyers, suppliers and deterministic renewal signals for professional teams.',
    heroCtas: { demo: 'Request the product demo', sample: 'GET /v1/demo — free sample' },
    heroCaption:
      'A free labeled sample from the live index—recent tender and renewal signal, with evidence.',
    evidenceCard: {
      aria: 'Live sample — GET /v1/demo',
      title: 'Live sample — GET /v1/demo',
      stamp: 'Sample',
      loading: 'Loading…',
      sourceStamp: 'GET /v1/demo · sample status',
    },
    builtOn: 'Built on primary sources',
    trustStrip: {
      eu: { kicker: 'EU — TED', label: 'Tenders Electronic Daily' },
      es: { kicker: 'ES — PLACSP', label: 'Spain contracts when enabled' },
      dates: { kicker: 'Dates', label: 'Not reported when unknown' },
      openSource: { kicker: 'Open source', label: 'MIT — auditable' },
      status: { kicker: 'Status', label: 'Live freshness' },
    },
    ctaDemo: {
      title: 'See your next opportunity in context.',
      body: 'A free labeled sample from the current index, followed by a guided review of your market. Demo emails are kept while the request is new; once a lead advances to contacted, used, paid or lost it is purged after 180 days.',
      emailLabel: 'Work email',
      emailPlaceholder: 'name@company.com',
      submit: 'Request the product demo',
      success: 'Demo request received. We will follow up by email; no meeting was booked.',
      noscript: 'Email <a href="mailto:{email}">{email}</a> to request a demo.',
    },
    usecases: {
      title: 'Use cases',
      cards: {
        'tender-intelligence': {
          title: 'Tender intelligence',
          desc: 'Find recent tenders and who won, with provenance.',
        },
        'company-research': {
          title: 'Company research',
          desc: 'Track record and live matching opportunities.',
        },
        'buyer-intelligence': {
          title: 'Buyer intelligence',
          desc: 'Activity, supplier concentration, recurrence.',
        },
        'renewals-forecasting': {
          title: 'Renewals forecasting',
          desc: 'Which contracts will be re-tendered, with evidence.',
        },
      },
    },
    pricing: {
      title: 'Pricing',
      introCreem:
        'Pay per call — no signup, machine-to-machine. Or subscribe monthly via Creem checkout. Start at <a href="/v1/pricing">GET /v1/pricing</a> for the full ladder.',
      intro:
        'Pay per call — no subscriptions, no signup, machine-to-machine. Start at <a href="/v1/pricing">GET /v1/pricing</a> for the full ladder.',
      cards: {
        monthly: {
          plan: 'Monthly plan',
          amountN: '€{creemPrice}',
          amountU: 'per month',
          desc: 'One monthly payment unlocks the paid endpoints: subscriber calls debit one-time credits, and the account stays active for 30 days. Creem handles payment; Licita never sees a card number.',
          tag: 'POST /v1/creem/checkout',
        },
        research: {
          plan: 'Research brief',
          amountN: '${researchPrice}',
          amountU: 'per call',
          desc: 'One paid call turns a topic into a deterministic, evidence-backed research brief. NO LLM, fully auditable.',
          tag: 'POST /v1/research',
        },
        core: {
          plan: 'Core endpoints',
          amountN: 'from $0.02',
          amountU: 'per call',
          desc: 'Contract data, renewals signals, buyer and supplier profiles — every row carries provenance.',
          tag: 'GET /v1/search',
        },
        credits: {
          plan: 'Credits',
          amountN: '$5–$25',
          amountU: 'packs',
          desc: 'Dollar-denominated credits for convenience. No signup, no seats, no subscriptions.',
          tag: 'Prepaid',
        },
      },
      note: 'Transparent per-call pricing — see the full ladder at <a href="/v1/pricing">GET /v1/pricing</a>.',
    },
    coverage: {
      title: 'Coverage & methodology',
      body: 'Coverage is strongest in the indexed IT, software and cyber vertical. See <a href="/en/data">source scope and methodology</a> for enabled sources, date ranges and last successful ingestion. Every finding carries a source reference and upstream link where known.',
      dataLinks:
        '<a href="/en/data/spain">Spain (PLACSP)</a> · <a href="/en/data/eu">EU (TED)</a> · <a href="/en/data">Data overview</a>',
    },
    developers: {
      title: 'For developers',
      body: 'Priced REST + Streamable-HTTP MCP. Start at <a href="/llms.txt">/llms.txt</a> → <a href="/openapi.json">/openapi.json</a> → <a href="/v1/pricing">/v1/pricing</a>.',
    },
    faq: {
      title: 'FAQ',
      items: {
        accountSubscription: {
          question: 'Do I need an account or subscription?',
          answerCreem:
            'No account needed for pay-per-call — no signup. Prefer a plan? A monthly subscription is available via Creem checkout at <code>POST /v1/creem/checkout</code> — your API key is emailed right after checkout, marked <code>kind=creem</code>, and stays active for 30 days.',
          answer: 'No. Licita is pay-per-call — no signup, no seats, no subscriptions.',
        },
        creditsAndKeys: {
          question: 'How do credits or client keys work?',
          answer:
            'Buy dollar-denominated credits in $5–$25 packs at <code>POST /v1/billing/credits/5</code> (or /10, /25) with your own <code>x-client-key</code> string, then send that same key as the <code>x-client-key</code> header on priced calls to pay from your balance. Keep the key safe — it is the only identifier of your balance, and if it is lost the balance cannot currently be recovered.',
        },
        usdcWallet: {
          question: 'Do I need USDC or a crypto wallet for the monthly subscription?',
          answer:
            'No. The monthly subscription is paid by card through Creem (Merchant of Record); Licita never sees your card number. The x402/USDC flow is only for pay-per-call and prepaid credits — no subscription, no crypto wallet needed.',
        },
        demoRetention: {
          question: 'How long do you keep demo emails?',
          answer:
            'Demo emails are kept while the request is new; once a lead advances to contacted, used, paid or lost it is purged after <strong>180 days</strong>.',
        },
      },
    },
    connect: {
      title: 'Connectable right now.',
      body: 'Point an MCP client at <code>{mcpEndpoint}</code> and try the free demo before paying.',
      docsLink: 'Read the docs',
      sampleLink: 'GET /v1/demo',
    },
  },
  usecases: {
    title: 'Use cases',
    metaDescription:
      'Concrete agent missions for Licita: exact endpoints, MCP tools, costs and real response shapes.',
    intro:
      'Concrete agent missions, the exact endpoints and MCP tools that solve them, their cost, and what a real response looks like. Every example is a labeled sample — agents get the same shapes after paying per call.',
    freeTitle: 'Free first look',
    freeBody:
      'Validate the data before paying: <a href="/v1/demo">GET /v1/demo</a> returns a labeled sample of the most recent tender + renewal signal at no cost.',
    detail: {
      toolsTitle: 'Tools',
      exampleTitle: 'Example response (labeled sample)',
      honestyTitle: 'Honesty note',
      allUseCases: 'all use cases',
    },
  },
  usecaseDetail: {
    'tender-intelligence': {
      title: 'Tender intelligence — find recent tenders and who won',
      problem:
        'An agent needs recent procurement activity on a topic: which tenders were published or awarded, by whom, for how much, with provenance.',
      tools:
        '<code>GET /v1/search</code> ($0.02/call) for compact rows, <code>GET /v1/tenders/:id</code> ($0.02/call) for full tender + award detail. MCP: <code>search_tenders</code>, <code>get_tender</code>.',
      honestNote:
        'Every row exposes meta.provenance (source + source_ref + upstream url). Nulls are never fabricated.',
    },
    'company-research': {
      title: 'Company research — track record and live opportunities',
      problem:
        'An agent evaluating a supplier needs wins, total awarded value, top CPVs and buyers, plus tenders matching that company profile right now.',
      tools:
        '<code>GET /v1/companies/:id</code> ($0.05), <code>GET /v1/companies/:id/awards</code> ($0.05), <code>GET /v1/companies/:id/opportunities</code> ($0.10). MCP: <code>get_company</code>, <code>get_company_awards</code>, <code>get_company_opportunities</code>.',
      honestNote:
        'Company identity is cross-source (NIF + aliases + source identifiers); aggregates are computed over the indexed history only and every response exposes meta.provenance.',
    },
    'buyer-intelligence': {
      title: 'Buyer intelligence — activity, concentration, recurrence',
      problem:
        'An agent needs a buyer profile: award history, supplier concentration (top-supplier share) and per-CPV recurrence so it can time outreach.',
      tools:
        '<code>GET /v1/buyers/:id/history</code> ($0.05/call). MCP: <code>get_buyer_history</code>.',
      honestNote:
        'Concentration/recurrence are derived from indexed awards; small histories can show 1.0 concentration — read counts alongside ratios. Every response exposes meta.provenance.',
    },
    'renewals-forecasting': {
      title: 'Renewals forecasting — which contracts will be re-tendered',
      problem:
        'An agent hunting pipeline wants contracts and frameworks likely to be re-tendered in a window, with per-signal evidence.',
      tools:
        '<code>GET /v1/renewals?window_months=12</code> ($0.25/call) or <code>POST /v1/research</code> ($0.50/call) for a full brief. MCP: <code>get_renewals</code>, <code>research</code>.',
      honestNote:
        'Signals are a deterministic heuristic over historical awards and dates with confidence low|medium|high — never a probability estimate. Every signal exposes its full evidence in basis, and the envelope carries meta.provenance.',
    },
  },
  data: {
    overview: {
      h1: 'Data',
      intro:
        'What Licita indexes, where it comes from, and how agents can validate it before paying. Counts are updated on ingestion — they are operational facts, not projections.',
      bullets: [
        '<strong>Current records and indexed ranges</strong> are returned from live source metadata; no fixed coverage claim is made.',
        '<strong>TED</strong> (Tenders Electronic Daily) — EU award notices, live by default: <a href="/en/data/eu">EU data page</a>.',
        '<strong>PLACSP</strong> — Spanish public-sector contracts (<code>2026/CONTRAT/…</code> refs) when PLACSP ingestion is enabled: <a href="/en/data/spain">Spain data page</a>.',
      ],
      accessTitle: 'Access',
      accessBody:
        'Free: <a href="/v1/demo">GET /v1/demo</a> (labeled sample), <a href="/v1/pricing">price ladder</a>, <a href="/llms.txt">/llms.txt</a>, <a href="/openapi.json">OpenAPI</a>. Paid: every row returns <code>meta.provenance</code> (source + source_ref + upstream url); nulls are never fabricated.',
    },
    spain: {
      h1: 'Data — Spain (PLACSP)',
      intro:
        'Spanish public-sector procurement contracts ingested from PLACSP when enabled. Publication references look like <code>2026/CONTRAT/000064</code>.',
      bullets: [
        '<strong>Coverage</strong> — awards with buyer, winner, CPV codes, values and publication refs; Spanish public-sector entities (city councils, regional governments, agencies).',
        '<strong>Example rows</strong> — award by Alcaldía del Ayuntamiento de Oleiros to APDTIC PROFESIONALES S.L. (ref <code>2026/CONTRAT/000064</code>); award by Dirección General de IBERMUTUA to Mnemo Evolution &amp; Integration Services, S.A.',
        '<strong>Query</strong> — <code>GET /v1/search?q=…&amp;type=award</code>, <code>GET /v1/companies/:id</code>, <code>GET /v1/buyers/:id/history</code>, <code>GET /v1/renewals</code>.',
      ],
      overviewLink: 'data overview',
    },
    eu: {
      h1: 'Data — EU (TED)',
      intro:
        'EU public procurement award notices ingested from TED (Tenders Electronic Daily). Provenance links to the original notice (<code>ted.europa.eu/udl?uri=TED:NOTICE:…</code>).',
      bullets: [
        '<strong>Coverage</strong> — notices with publication-number, buyer, winner, CPV, values, submissions and framework-agreement flags across EU member states.',
        '<strong>Renewal signals</strong> — duration-expiry, framework-expiry and recurrence signals are derived from historical awards (deterministic heuristic, confidence low|medium|high).',
        '<strong>Query</strong> — <code>GET /v1/search</code>, <code>GET /v1/tenders/:id</code>, <code>POST /v1/research</code> (topic brief), <code>GET /v1/renewals</code>.',
      ],
      overviewLink: 'data overview',
    },
  },
  pricing: {
    title: 'Pricing',
    metaDescription:
      'Per-call USD prices for every Licita endpoint, prepaid credit bundles, and how payment works.',
    intro:
      'Per-call prices in USD. Machine-readable version: <a href="/v1/pricing">/v1/pricing</a>. Payments mode: <code>{paymentsMode}</code>. <code>POST /v1/research</code> costs <code>${researchPrice}</code> per call (config-driven).',
    priceTable: { endpointHeader: 'Endpoint', priceHeader: 'Price (USD / call)', freeTag: 'free' },
    demoFreeNote:
      '<code>GET /v1/demo</code> is free: a labeled sample of the paid data (recent tender + renewal signal), so agents can validate quality before paying.',
    creditsTitle: 'Credits & billing',
    creditsIntroCreem:
      'Prepaid credit bundles — a one-time purchase. Buy a bundle, then\npay every call from your balance by sending <code>x-client-key: &lt;your key&gt;</code> on the request\n(instead of a per-call payment proof).',
    creditsIntro:
      'Prepaid credit bundles — a one-time purchase, no subscription. Buy a bundle, then\npay every call from your balance by sending <code>x-client-key: &lt;your key&gt;</code> on the request\n(instead of a per-call payment proof).',
    bundles: { bundleHeader: 'Bundle', priceHeader: 'Price (USD)' },
    twoRails:
      'Two payment rails, chosen by how you buy: the monthly subscription is paid in <strong>EUR</strong> by card via Creem (no crypto wallet); pay-per-call and prepaid credits are priced in <strong>USD</strong> and paid with USDC proofs via x402.',
    monthlyTitle: 'Monthly subscription',
    monthlyBody:
      '<strong>Creem MoR</strong>: subscribe at <code>POST /v1/creem/checkout</code> for\n<code>€{creemPrice}/month</code> (config-driven — always the configured\n<code>CREEM_PRICE_CENTS</code>). After payment Creem calls <code>POST /v1/creem/webhook</code>\n(signature-verified) and the account is marked <code>kind=creem</code> for 30 days. Subscriber calls\ndebit one-time credits — running out returns <code>402</code> until you refill.',
    buyLine:
      'Buy: <code>POST /v1/billing/credits/5</code> (or <code>/10</code> <code>/25</code>) with the normal machine-to-machine payment flow (402 → <code>PAYMENT-SIGNATURE</code> retry). Check balance: <code>GET /v1/billing</code> with header <code>x-client-key: &lt;your key&gt;</code>. MCP: <code>billing_purchase_credits</code> / <code>billing_get_balance</code>.',
    howPaymentTitle: 'How payment works',
    steps: [
      'Call a paid endpoint → <code>402</code> with a base64 <code>PAYMENT-REQUIRED</code> header describing the exact USDC requirement (scheme <code>exact</code>, EIP-3009 transferWithAuthorization).',
      'Sign the authorization with an x402 client and retry with <code>PAYMENT-SIGNATURE: &lt;payload&gt;</code> (v2; the legacy <code>X-PAYMENT</code> header still works).',
      'The server verifies and settles the payment before serving content; proofs are single-use.',
      'Local dev only (<code>PAYMENTS_MODE=dev</code>): <code>POST /v1/dev-faucet {"endpoint":"&lt;METHOD PATH&gt;"}</code> → <code>{ token, expires_at }</code>, then retry with <code>X-PAYMENT</code> (REST) or <code>payment_token</code> (MCP). Not available in production.',
    ],
  },
  trust: {
    methodology: {
      title: 'Methodology',
      body: '<p>Licita presents source rows and deterministic heuristics with their evidence. Confidence is evidence strength, not a probability. Coverage counts, indexed ranges and freshness are shown only when supplied by the live index; unknown values are Not reported.</p>',
    },
    security: {
      title: 'Security',
      body: '<p>Operator statistics and lead details require the server-side operator key. Public demo capture is rate limited and stores only a normalized email, channel, source URL and lifecycle timestamps. Licita does not claim a certification or SLA on this page.</p>',
    },
    privacy: {
      title: 'Privacy Policy',
      body: `
<h2>What data Licita holds</h2>
<p>Licita is an agent-native public procurement intelligence service. It indexes public data from TED and PLACSP and exposes it through REST and MCP. The personal data we process is limited to what is needed to operate the service:</p>
<ul>
  <li><strong>Demo requests</strong> — when you request a demo, we store only the email address you provide, plus the channel, the source URL and lifecycle timestamps.</li>
  <li><strong>Subscription emails</strong> — when you subscribe via Creem checkout, we store the checkout email to set up your API key and billing account.</li>
  <li><strong>API keys</strong> — we generate your client key at checkout and send it to you by email. Only a cryptographic hash of the key is stored server-side; the raw key is never persisted after delivery.</li>
  <li><strong>Payment proofs</strong> — per-call payments (x402) and credit purchases are recorded as proof rows with amount, endpoint, provider and status. Card payments are handled end-to-end by Creem (Merchant of Record); we never see or store card numbers.</li>
</ul>
<h2>How long we keep data</h2>
<p>Demo emails are kept while the request is new; once a lead advances to contacted, used, paid or lost it is purged after 180 days. New leads are never auto-deleted. Subscription and payment records are kept while an account is active and for the period required by applicable payment and reconciliation rules.</p>
<h2>Who can access data</h2>
<p>Access is restricted to operators via a server-side operator key. We do not sell, rent or share personal data with third parties for marketing. We rely on limited processors: Creem (payments), Resend (transactional email) and the x402 facilitator (proof verification).</p>
<h2>Your rights</h2>
<p>Request deletion or ask a privacy question by email at <a href="mailto:{email}">{email}</a>.</p>`,
    },
    terms: {
      title: 'Terms of Service',
      body: `
<h2>Service</h2>
<p>Licita provides evidence-backed public procurement intelligence: EU (TED) and Spain (PLACSP) tenders, buyers, suppliers and deterministic renewal signals, queryable over REST and MCP. All values come from public sources or deterministic heuristics over them; Licita never fabricates data.</p>
<h2>Use</h2>
<p>You may use the service for professional evaluation of public procurement opportunities and for integration into your own tools and agents, subject to these terms and to the applicable terms of the upstream sources (TED, PLACSP). You must not use the service to violate law, to abuse or overload the API, to resell the raw index as a competing product, or to circumvent payment.</p>
<h2>Pricing and payment</h2>
<p>Endpoints are priced per call; full prices are published at <a href="/v1/pricing">/v1/pricing</a>. You pay with x402 payment proofs, with prepaid credit bundles (<code>x-client-key</code>), or with a monthly subscription via Creem checkout (<code>POST /v1/creem/checkout</code>). Proofs are single-use and expire after 5 minutes. Card payments are processed by Creem as Merchant of Record; we never see card details.</p>
<h2>API keys and credits</h2>
<p>Your API key is issued once and sent to you by email after checkout; only a hash is stored server-side. Keep the key safe — it is the only identifier of your credit balance, and a lost balance cannot currently be recovered. Prepaid credits never expire.</p>
<h2>Data quality</h2>
<p>Indexed values come from public sources with provenance. Renewal and opportunity signals are deterministic heuristics; confidence reflects evidence strength, not a probability. Licita does not claim a certification, an uptime SLA, or fitness for a particular decision. Verify before relying on the data for a material decision.</p>
<h2>Intellectual property</h2>
<p>The Licita application is open source under the MIT license (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). The indexed data remains subject to the terms of its upstream sources.</p>
<h2>Changes and contact</h2>
<p>We may update these terms; continued use after a change is posted constitutes acceptance. Questions? Email <a href="mailto:{email}">{email}</a>.</p>
<p><em>Last updated: September 2026.</em></p>`,
    },
    status: {
      title: 'Status',
      body: '<p>Service status and source freshness are operational values, not guarantees. Check the response metadata and contact us to report an issue. No uptime SLA is claimed here.</p>',
    },
  },
  notFound: { title: 'Not found', heading: 'Not found' },
  footer: {
    desc: 'Evidence-backed EU public procurement intelligence for professional teams and AI agents.',
    product: 'Product',
    company: 'Company',
    contact: 'Contact',
    useCases: 'Use cases',
    pricing: 'Pricing',
    docs: 'Docs',
    mcp: 'MCP',
    coverageAndMethodology: 'Coverage & methodology',
    methodology: 'Methodology',
    security: 'Security',
    privacy: 'Privacy',
    terms: 'Terms',
    status: 'Status',
    github: 'GitHub (MIT)',
    provenance:
      'Provenance: every data row exposes <code>meta.provenance</code> as <code>[{ source, source_ref, url }]</code>.',
    copyright: '© {year} Licita',
    backToLicita: 'Back to Licita',
  },
  jsonLd: {
    description:
      'Evidence-backed public procurement intelligence: EU (TED) and Spain (PLACSP) tenders, buyers, suppliers and deterministic renewal signals, queryable over REST and MCP.',
  },
};