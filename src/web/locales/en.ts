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
    brand: 'Relicita',
    home: 'Home',
    useCases: 'Use cases',
    coverageAndMethodology: 'Coverage & methodology',
    pricing: 'Pricing',
    docs: 'Docs',
    mcp: 'MCP',
    radar: 'Radar',
    developers: 'Developers',
    toggleMenu: 'Toggle menu',
    requestDemo: 'Start free',
  },
  home: {
    title: 'Software and cyber public contracts, before they are re-tendered',
    metaDescription:
      'Relicita tells IT and cybersecurity SMEs which software and cyber public contracts will be re-tendered, who holds them today and when to move. Evidence from TED and PLACSP. Start free, no card.',
    heroEyebrow: 'IT and cybersecurity SMEs',
    heroEyebrowTag: 'Evidence, not a guess',
    heroTitle: 'Before the tender is published, you already know which one it will be.',
    heroSubtitle:
      'Relicita tells your IT SME which software and cyber public contracts will be re-tendered, who holds them today and when to move, with the evidence behind each signal.',
    heroCtas: { demo: 'Start free', sample: 'See the radar' },
    heroCaption:
      'Weekly email radar in about two minutes. No card. The table is a real sample of the index, not an illustration.',
    evidenceCard: {
      aria: 'One labeled row from the live index',
      title: 'One labeled row from the live index',
      stamp: 'Sample',
      loading: 'Loading…',
      empty: 'The index has no sample row right now. No data was invented.',
      error: 'The sample row could not be loaded.',
      retry: 'Retry',
      notReported: 'Not reported',
      sourceStamp: 'GET /v1/demo · sample status',
      upstream: 'Open the source',
    },
    renewalTable: {
      title: 'Contracts expiring in the next 12 months',
      intro:
        'Who holds them today, and for how much. These are software and IT contracts (CPV 48 and 72) whose window is still open and starts no later than 12 months from today. Confidence is high, medium or low; low is an estimate from thin evidence, not a probability. If a value was not in the source, the cell says Not reported.',
      loading: 'Loading the index sample…',
      empty:
        'The index has no software or IT renewal signals in this window right now. No rows were invented.',
      error: 'The index sample could not be loaded.',
      retry: 'Retry',
      sampleNote: 'Public sample, up to 8 rows. The paid radar is the full list for your CPV and region.',
      notReported: 'Not reported',
      openRadar: 'Open the radar with filters',
      countMid: 'of',
      headers: {
        contract: 'Contract',
        buyer: 'Buyer',
        holder: 'Held by',
        value: 'Amount',
        window: 'Window',
        confidence: 'Confidence',
        source: 'Source',
        calculation: 'Calculation',
      },
      signals: {
        duration: 'Contract end',
        framework: 'Framework end',
        recurrence: 'Award pattern',
      },
      confidence: { low: 'Low · estimate', medium: 'Medium', high: 'High' },
    },
    evidencePromise: {
      title: 'Every alert cites its source and its calculation',
      body: 'Each row names TED or PLACSP and the rule stored with the signal (end date, framework cap, or the gap between past awards). There is no generated text and no score we cannot show. Unknown dates stay Not reported. Where the source publishes a link, you can open the upstream notice.',
    },
    plansIntro: {
      title: 'Start free. Move up when the list is useful.',
      body: 'Prices exclude VAT. Pay-per-call API access stays available for developers, on its own page.',
    },
    signupExtra: {
      cpvLabel: 'CPV you sell',
      regionLabel: 'Region (NUTS, optional)',
      cpvIt: '72 — IT services, including cybersecurity',
      cpvSoftware: '48 — software packages',
      cpvBoth: '48 and 72',
      regionPlaceholder: 'ES511',
      pending: 'Saving your email…',
      error: 'Check the email and try again.',
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
      title: 'Start free',
      body: 'A weekly summary of 5 renewals for your CPV and region. No card. If you do not become a customer, the signup email is deleted after 12 months.',
      emailLabel: 'Work email',
      emailPlaceholder: 'name@company.com',
      submit: 'Start free',
      success: 'Signup received. We will follow up by email; no meeting was booked and no card was charged.',
      noscript: 'Email <a href="mailto:{email}">{email}</a> to start the free radar.',
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
          desc: 'One monthly payment unlocks the paid endpoints: subscriber calls debit one-time credits, and the account stays active for 30 days. Creem handles payment; Relicita never sees a card number.',
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
          answer: 'No. Relicita is pay-per-call — no signup, no seats, no subscriptions.',
        },
        creditsAndKeys: {
          question: 'How do credits or client keys work?',
          answer:
            'Buy dollar-denominated credits in $5–$25 packs at <code>POST /v1/billing/credits/5</code> (or /10, /25) with your own <code>x-client-key</code> string, then send that same key as the <code>x-client-key</code> header on priced calls to pay from your balance. Keep the key safe — it is the only identifier of your balance, and if it is lost the balance cannot currently be recovered.',
        },
        usdcWallet: {
          question: 'Do I need USDC or a crypto wallet for the monthly subscription?',
          answer:
            'No. The monthly subscription is paid by card through Creem (Merchant of Record); Relicita never sees your card number. The x402/USDC flow is only for pay-per-call and prepaid credits — no subscription, no crypto wallet needed.',
        },
        demoRetention: {
          question: 'How long do you keep demo emails?',
          answer:
            'If you do not become a customer, the signup email is deleted after <strong>12 months</strong>. A signup marked paid is left out of that purge.',
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
      'Concrete agent missions for Relicita: exact endpoints, MCP tools, costs and real response shapes.',
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
        'What Relicita indexes, where it comes from, and how agents can validate it before paying. Counts are updated on ingestion — they are operational facts, not projections.',
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
      'Per-call USD prices for every Relicita endpoint, prepaid credit bundles, and how payment works.',
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
      body: '<p>Relicita presents source rows and deterministic heuristics with their evidence. Confidence is evidence strength, not a probability. Coverage counts, indexed ranges and freshness are shown only when supplied by the live index; unknown values are Not reported.</p>',
    },
    security: {
      title: 'Security',
      body: '<p>Operator statistics and lead details require the server-side operator key. Public demo capture is rate limited and stores only a normalized email, channel, source URL and lifecycle timestamps. Relicita does not claim a certification or SLA on this page.</p>',
    },
    privacy: {
      title: 'Privacy Policy',
      body: `
<h2>Controller</h2>
<p>Gastón Leonardo Rey Fernández, a natural person operating as a sole trader. NIF 02769985A. Address: C/ Pobla de Segur 15, 3C, 28033 Madrid, Spain. Contact: <a href="mailto:{email}">{email}</a>. Identification details are also on the <a href="/en/legal">legal notice</a>.</p>
<h2>What we process, and the legal basis</h2>
<ul>
  <li><strong>Free signup.</strong> Email, channel, source URL, status (new, contacted, used, paid or lost) and timestamps, including radar unsubscribe. Basis: consent, when you submit the form.</li>
  <li><strong>Signup acknowledgement.</strong> When a Resend key is set, we send one email with the subject «Alta recibida en Relicita». DEMO_AUTOREPLY_ENABLED can turn that send off. Basis: the same consent.</li>
  <li><strong>Weekly radar.</strong> When sending is enabled (DIGEST_ENABLED), each signup address that has not unsubscribed receives at most one Spanish email per UTC week, with up to 5 renewals. An operator can also trigger that send. Basis: consent. Unsubscribe is one click on the link in the email (<a href="/radar/baja">/radar/baja</a>). Nothing in the code reads a reply that says “baja”.</li>
  <li><strong>Subscription.</strong> After a completed Creem checkout we store the email, a hash of the API key, the account kind and the period end. The raw key is emailed once and is not stored. Basis: contract.</li>
  <li><strong>x402 payments and credits.</strong> Amount, endpoint, provider and status. For x402, also the payer address, the transaction id and the network. Card numbers never reach us: Creem charges the card. Basis: contract.</li>
  <li><strong>Technical logs.</strong> Path, status, user agent, referer and, when there is no client key, a hash of the IP. The raw IP and the raw API key are not stored. Basis: legitimate interest in security and operation. These logs have no automatic deletion.</li>
</ul>
<h2>Retention</h2>
<p>A signup that is not a customer is deleted 12 months after it was created. For this purge, a customer is a row marked paid: that row is kept. The purge runs when a new signup is stored; there is no daily sweep. Subscriber accounts and payments are not deleted by that purge: they are kept while the account remains and for as long as accounting and payment reconciliation require. A weekly-send record (email and week) is deleted once the signup no longer exists.</p>
<h2>Processors</h2>
<p>We do not sell data. Access is limited to operators, with an operator key. Processors:</p>
<ul>
  <li><strong>Hetzner</strong> — hosting, in the European Union.</li>
  <li><strong>Cloudflare</strong> — DNS and proxy.</li>
  <li><strong>Resend</strong> — email delivery, with the account set to the EU region.</li>
  <li><strong>Creem</strong> — card payments, as Merchant of Record. The charge may involve a transfer outside the European Economic Area; where it does, it relies on the processor’s standard contractual clauses.</li>
  <li><strong>x402 facilitator</strong> — verification and settlement of the USDC proof (default host x402.org; the URL is configurable). It may sit outside the EEA; where the transfer leaves the EEA, it relies on standard contractual clauses if that processor offers them.</li>
</ul>
<h2>Commercial email</h2>
<p>The product does not email generic addresses taken from a company’s website. The messages above go to the address the person typed at signup or checkout. If the controller writes, outside this application, to a generic company address published on that company’s website, the basis is legitimate interest in a B2B message, the source of the address is that public website, and opt-out is an email to <a href="mailto:{email}">{email}</a> containing the word «baja». That reply is handled by hand: the code does not automate it.</p>
<h2>Cookies</h2>
<p>The site code sets no cookies, tracking or otherwise. There is no pixel and no third-party analytics. The operator console keeps its key in the browser’s sessionStorage: that is not a cookie and it is not sent to third parties. If Cloudflare is proxying the site, it may set its own technical cookies; we do not use them for advertising.</p>
<h2>Your rights</h2>
<p>You may request access, rectification, erasure, objection, restriction and portability at <a href="mailto:{email}">{email}</a>. We answer within one month. You may also complain to the Spanish Data Protection Agency (<a href="https://www.aepd.es">www.aepd.es</a>).</p>
<p><em>Last updated: October 2026.</em></p>`,
    },
    terms: {
      title: 'Terms of Service',
      body: `
<h2>Provider</h2>
<p>Gastón Leonardo Rey Fernández, a natural person operating as a sole trader. NIF 02769985A. Address: C/ Pobla de Segur 15, 3C, 28033 Madrid, Spain. Email: <a href="mailto:{email}">{email}</a>. Full identification is on the <a href="/en/legal">legal notice</a>.</p>
<h2>Who it is for</h2>
<p>The service is for companies and professionals only (B2B), to evaluate public procurement and to integrate it into their own tools. It is not directed at consumers.</p>
<h2>Service</h2>
<p>Relicita provides evidence-backed public procurement intelligence: EU tenders (TED) and Spanish tenders (PLACSP, when enabled), buyers, suppliers and deterministic renewal signals, over the web, REST and MCP. Values come from public sources or from heuristics over them. Nothing is invented.</p>
<h2>Use</h2>
<p>Subject to these terms and to the terms of TED and PLACSP. Do not use the service to break the law, overload the API, resell the raw index as a competing product, or circumvent payment.</p>
<h2>Price and payment</h2>
<p>Per-call prices are at <a href="/v1/pricing">/v1/pricing</a>. You pay with x402 proofs, with prepaid credits (<code>x-client-key</code>), or with a subscription through Creem checkout. Proofs are single-use and expire after 5 minutes. Creem is the Merchant of Record for the card subscription: Relicita does not see or store the card number. The application has no refund endpoint and no subscription-cancellation endpoint of its own.</p>
<h2>Cancellation and refunds</h2>
<p>You may cancel the subscription at any time, effective at the end of the period already paid. The first month is refunded if you ask within 14 days of the first charge. Ask by email at <a href="mailto:{email}">{email}</a>; Creem carries it out. This refund does not cover prepaid credits or an x402 payment already settled. Prepaid credits do not expire and are not refunded on this path.</p>
<h2>API keys</h2>
<p>The key is emailed once after checkout and only a hash is stored. It identifies the balance. If it is lost, the current code cannot recover the balance.</p>
<h2>Liability</h2>
<p>Signals are heuristics: confidence measures evidence, not a probability. There is no certification and no uptime SLA. We are not liable for a procurement decision made on this data alone, nor for outages of TED, PLACSP, Creem or the x402 facilitator, to the extent Spanish law allows. Nothing here limits liability for wilful misconduct or for anything the law forbids excluding.</p>
<h2>Law and venue</h2>
<p>Spanish law. Courts of Madrid.</p>
<h2>Intellectual property</h2>
<p>The code is MIT (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). Indexed data stays under the terms of its source.</p>
<h2>Changes</h2>
<p>These terms may be updated. Use after a change is posted is acceptance of that change.</p>
<p><em>Last updated: October 2026.</em></p>`,
    },
    legal: {
      title: 'Legal notice',
      body: `
<h2>Provider</h2>
<p>Information required by article 10 of Spanish Law 34/2002 (LSSI):</p>
<ul>
  <li><strong>Provider:</strong> Gastón Leonardo Rey Fernández, a natural person operating as a sole trader. There is no company behind this site.</li>
  <li><strong>NIF:</strong> 02769985A</li>
  <li><strong>Address:</strong> C/ Pobla de Segur 15, 3C, 28033 Madrid, Spain</li>
  <li><strong>Email:</strong> <a href="mailto:{email}">{email}</a></li>
  <li><strong>Site and brand:</strong> eutendersai.com, brand Relicita</li>
  <li><strong>Activity:</strong> a public-procurement intelligence service. It indexes public notices from TED and, when enabled, from PLACSP, and they are queried on the web, over REST and over MCP.</li>
</ul>
<h2>Intellectual property</h2>
<p>The application code is published under the MIT license (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). Indexed data comes from public sources (TED and PLACSP) and stays subject to those sources’ terms. The text of this site and the Relicita brand belong to the provider.</p>
<h2>Governing law</h2>
<p>Spanish law. Disputes go to the courts of Madrid, except for mandatory rules that cannot be waived. The service is for companies and professionals. Privacy: <a href="/en/privacy">/en/privacy</a>. Terms: <a href="/en/terms">/en/terms</a>.</p>
<p><em>Last updated: October 2026.</em></p>`,
    },
    status: {
      title: 'Status',
      body: '<p>Service status and source freshness are operational values, not guarantees. Check the response metadata and contact us to report an issue. No uptime SLA is claimed here.</p>',
    },
  },
  notFound: { title: 'Not found', heading: 'Not found' },
  footer: {
    desc: 'Relicita tells IT and cybersecurity SMEs which software and cyber public contracts will be re-tendered, with the evidence behind each signal.',
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
    legal: 'Legal notice',
    status: 'Status',
    github: 'GitHub (MIT)',
    tenderIntelligence: 'Tender intelligence',
    provenance:
      'Provenance: every data row exposes <code>meta.provenance</code> as <code>[{ source, source_ref, url }]</code>.',
    copyright: '© {year} Relicita',
    backToLicita: 'Back to Relicita',
  },
  jsonLd: {
    description:
      'Relicita tells IT and cybersecurity SMEs which software and cyber public contracts will be re-tendered, who holds them today and when to move. Evidence from TED and PLACSP.',
  },
  plans: {
    vat: 'Prices exclude VAT.',
    free: {
      name: 'Free',
      price: '€0',
      period: 'weekly email',
      desc: 'A weekly summary of 5 renewals for your CPV and region. No card.',
      cta: 'Start free',
    },
    radar: {
      name: 'Radar',
      price: '€39',
      period: 'per month',
      desc: 'The renewal list for your market, every week. €390 per year when billed annually.',
      cta: 'I want Radar',
    },
    pro: {
      name: 'Pro',
      price: '€99',
      period: 'per month',
      desc: 'Radar plus buyer and incumbent context for a working shortlist. €990 per year when billed annually.',
      cta: 'I want Pro',
    },
    team: {
      name: 'Team',
      price: '€199',
      period: 'per month',
      desc: 'Five users on Pro, plus read access to the API for your own tools.',
      cta: 'I want Team',
    },
    interestCta: 'Save my interest',
    payCta: 'Continue to payment',
    intervalLabel: 'Billing period',
    monthlyRadar: 'Monthly, €39',
    annualRadar: 'Yearly, €390',
    monthlyPro: 'Monthly, €99',
    annualPro: 'Yearly, €990',
    chosenFree: 'You chose the Free plan. Signup does not ask for a card.',
    chosenRadar: 'You chose Radar (€39 a month or €390 a year). Leave your email and we save your interest. No card is requested.',
    chosenPro: 'You chose Pro (€99 a month or €990 a year). Leave your email and we save your interest. No card is requested.',
    chosenTeam: 'You chose Team (€199 a month, 5 users and a read API). Leave your email and we save your interest. No card is requested.',
    payRadarMonthly: 'You chose Radar, €39 a month. Payment continues on Creem. We never see the card details.',
    payRadarAnnual: 'You chose Radar, €390 a year. Payment continues on Creem. We never see the card details.',
    payProMonthly: 'You chose Pro, €99 a month. Payment continues on Creem. We never see the card details.',
    payProAnnual: 'You chose Pro, €990 a year. Payment continues on Creem. We never see the card details.',
    payTeamMonthly: 'You chose Team, €199 a month. Payment continues on Creem. We never see the card details.',
    checkoutNoscript: 'Without JavaScript we save the email as interest and do not open payment.',
  },
  radarPage: {
    title: 'Renewal radar',
    metaDescription:
      'Software and cybersecurity public contracts due to be re-tendered: who holds them, for how much, and the source of each signal.',
    h1: 'Which contracts come back, and who holds them',
    intro:
      'Filter the public sample by CPV, buyer, region and horizon (6 or 12 months). Only windows that are still open are listed. Low confidence is marked as an estimate: it is the strength of the evidence, not a probability.',
    filtersLabel: 'Filter the sample',
    cpvLabel: 'CPV',
    windowLabel: 'Window',
    window6: 'Next 6 months',
    window12: 'Next 12 months',
    buyerLabel: 'Buyer',
    buyerPlaceholder: 'Name of the contracting authority',
    regionLabel: 'Region',
    regionPlaceholder: 'ES511',
    apply: 'Update',
    renewalsTitle: 'Renewals',
    opportunitiesTitle: 'Tenders already published',
    opportunitiesIntro:
      'Recent notices in the same CPV slice. This is what is already on the market, next to the contracts that have not been re-tendered yet.',
    oppHeaders: {
      title: 'Tender',
      buyer: 'Buyer',
      cpv: 'CPV',
      value: 'Estimated amount',
      published: 'Published',
      deadline: 'Deadline',
      region: 'Region',
      source: 'Source',
    },
    noscript: 'This table is loaded from the live index. Without JavaScript, open GET /v1/radar/preview.',
  },
  developersPage: {
    title: 'Developers',
    metaDescription:
      'Pay-per-call access to the Relicita index over REST and MCP. USDC via x402, or prepaid credits. Human plans live on the pricing page.',
    h1: 'API and MCP for integrations',
    intro:
      'Teams that want a person to read the radar should start on the pricing page. This page is the machine interface: priced REST calls and MCP tools. Nothing here is required to receive the weekly email.',
    docsCta: 'Read the docs',
    mcpCta: 'MCP server',
    ladderTitle: 'Pay per call',
  },
};