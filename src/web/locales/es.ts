// Spanish dictionary (root locale). Human-authored ES (Spain), professional
// procurement terminology: licitación, adjudicación, contrato, pliego,
// licitador, CPV. Same key tree and {placeholders} as en.ts (parity is
// enforced by test/unit/web.locales.test.ts).
//
// REVIEW FLAGS (slice S1.6 — for human review before shipping):
//   - trust.privacy / trust.terms are legal copy: Spanish phrasing needs
//     domain validation (GDPR/legal, payments).
//   - trust.security and status wording ("no SLA claim") mirrors the EN
//     intent; confirm the tone matches the Spanish product voice.
//   - "No consta" is the Spain procurement idiom for "not reported"; keep it.
//   - Prices keep currency symbols and decimals as the EN copy (EUR/USD per
//     rail) — only the surrounding text is translated.
import type { Locale } from './types.js';

export const es: Locale = {
  nav: {
    skipToContent: 'Saltar al contenido',
    navLabel: 'Principal',
    brand: 'Licita',
    home: 'Inicio',
    useCases: 'Casos de uso',
    coverageAndMethodology: 'Cobertura y metodología',
    pricing: 'Precios',
    docs: 'Documentación',
    mcp: 'MCP',
    toggleMenu: 'Alternar menú',
    requestDemo: 'Solicitar demo',
  },
  home: {
    title: 'Inteligencia de contratación pública para la UE y España',
    metaDescription:
      'Licitaciones, compradores, proveedores y señales deterministas de renovación con evidencia, de TED (UE) y PLACSP (España), para equipos profesionales. API REST + MCP.',
    heroEyebrow: 'Inteligencia de Contratación Pública de la UE',
    heroEyebrowTag: 'Evidencia Primero',
    heroTitle: 'Descubre qué contratos públicos merecen tu próxima conversación.',
    heroSubtitle:
      'Licita convierte los anuncios de contratación indexados en oportunidades, compradores, proveedores y señales deterministas de renovación con evidencia, para equipos profesionales.',
    heroCtas: { demo: 'Solicitar la demo del producto', sample: 'GET /v1/demo — muestra gratuita' },
    heroCaption:
      'Una muestra gratuita etiquetada del índice en vivo: licitación reciente y señal de renovación, con evidencia.',
    evidenceCard: {
      aria: 'Muestra en vivo — GET /v1/demo',
      title: 'Muestra en vivo — GET /v1/demo',
      stamp: 'Muestra',
      loading: 'Cargando…',
      sourceStamp: 'GET /v1/demo · estado de la muestra',
    },
    builtOn: 'Construido sobre fuentes primarias',
    trustStrip: {
      eu: { kicker: 'UE — TED', label: 'Tenders Electronic Daily' },
      es: { kicker: 'ES — PLACSP', label: 'Contratos de España cuando esté activado' },
      dates: { kicker: 'Fechas', label: 'No consta cuando se desconoce' },
      openSource: { kicker: 'Código abierto', label: 'MIT — auditable' },
      status: { kicker: 'Estado', label: 'Actualización en vivo' },
    },
    ctaDemo: {
      title: 'Descubre tu próxima oportunidad en contexto.',
      body: 'Una muestra gratuita etiquetada del índice actual, seguida de una revisión guiada de tu mercado. Los emails de demo se conservan mientras la solicitud es nueva; cuando un lead pasa a contactado, usado, pagado o perdido, se purga a los 180 días.',
      emailLabel: 'Email de trabajo',
      emailPlaceholder: 'nombre@empresa.com',
      submit: 'Solicitar la demo del producto',
      success: 'Solicitud de demo recibida. Te escribiremos por email; no se ha reservado ninguna reunión.',
      noscript: 'Envía un email a <a href="mailto:{email}">{email}</a> para solicitar una demo.',
    },
    usecases: {
      title: 'Casos de uso',
      cards: {
        'tender-intelligence': {
          title: 'Inteligencia de licitaciones',
          desc: 'Encuentra licitaciones recientes y quién las ganó, con evidencia.',
        },
        'company-research': {
          title: 'Estudio de proveedores',
          desc: 'Historial y oportunidades en vivo que encajan con la empresa.',
        },
        'buyer-intelligence': {
          title: 'Inteligencia de compradores',
          desc: 'Actividad, concentración de proveedores, recurrencia.',
        },
        'renewals-forecasting': {
          title: 'Previsión de renovaciones',
          desc: 'Qué contratos se volverán a licitar, con evidencia.',
        },
      },
    },
    pricing: {
      title: 'Precios',
      introCreem:
        'Paga por llamada — sin registro, máquina a máquina. O suscríbete mensualmente con el checkout de Creem. Empieza en <a href="/v1/pricing">GET /v1/pricing</a> para ver la escalera completa.',
      intro:
        'Paga por llamada — sin suscripciones, sin registro, máquina a máquina. Empieza en <a href="/v1/pricing">GET /v1/pricing</a> para ver la escalera completa.',
      cards: {
        monthly: {
          plan: 'Plan mensual',
          amountN: '€{creemPrice}',
          amountU: 'al mes',
          desc: 'Un pago mensual desbloquea los endpoints de pago: las llamadas de suscriptor descuentan créditos de un solo uso y la cuenta sigue activa durante 30 días. Creem gestiona el pago; Licita nunca ve un número de tarjeta.',
          tag: 'POST /v1/creem/checkout',
        },
        research: {
          plan: 'Informe de investigación',
          amountN: '${researchPrice}',
          amountU: 'por llamada',
          desc: 'Una llamada de pago convierte un tema en un informe de investigación determinista con evidencia. SIN LLM, totalmente auditable.',
          tag: 'POST /v1/research',
        },
        core: {
          plan: 'Endpoints principales',
          amountN: 'desde $0,02',
          amountU: 'por llamada',
          desc: 'Datos de contratos, señales de renovación, perfiles de compradores y proveedores: cada fila lleva su evidencia.',
          tag: 'GET /v1/search',
        },
        credits: {
          plan: 'Créditos',
          amountN: '$5–$25',
          amountU: 'paquetes',
          desc: 'Créditos denominados en dólares para mayor comodidad. Sin registro, sin asientos, sin suscripciones.',
          tag: 'Prepago',
        },
      },
      note: 'Precios transparentes por llamada: mira la escalera completa en <a href="/v1/pricing">GET /v1/pricing</a>.',
    },
    coverage: {
      title: 'Cobertura y metodología',
      body: 'La cobertura es más fuerte en las verticales indexadas de IT, software y ciber. Consulta <a href="/data">el alcance de fuentes y la metodología</a> para ver las fuentes activadas, los rangos de fechas y la última ingesta con éxito. Cada hallazgo lleva una referencia de fuente y un enlace al origen cuando se conoce.',
      dataLinks:
        '<a href="/data/spain">España (PLACSP)</a> · <a href="/data/eu">UE (TED)</a> · <a href="/data">Resumen de datos</a>',
    },
    developers: {
      title: 'Para desarrolladores',
      body: 'REST de pago + MCP por HTTP en streaming. Empieza en <a href="/llms.txt">/llms.txt</a> → <a href="/openapi.json">/openapi.json</a> → <a href="/v1/pricing">/v1/pricing</a>.',
    },
    faq: {
      title: 'Preguntas frecuentes',
      items: {
        accountSubscription: {
          question: '¿Necesito una cuenta o una suscripción?',
          answerCreem:
            'No necesitas cuenta para pagar por llamada — sin registro. ¿Prefieres un plan? Hay una suscripción mensual disponible con el checkout de Creem en <code>POST /v1/creem/checkout</code>: tu clave de API se envía por email justo después del checkout, marcada <code>kind=creem</code>, y permanece activa 30 días.',
          answer: 'No. Licita es de pago por llamada — sin registro, sin asientos, sin suscripciones.',
        },
        creditsAndKeys: {
          question: '¿Cómo funcionan los créditos o las claves de cliente?',
          answer:
            'Compra paquetes de créditos en dólares, de $5 a $25, en <code>POST /v1/billing/credits/5</code> (o /10, /25) con tu propia cadena <code>x-client-key</code>, y envía esa misma clave como cabecera <code>x-client-key</code> en las llamadas de pago para pagar desde tu saldo. Guarda bien la clave: es el único identificador de tu saldo y, si se pierde, el saldo no se puede recuperar actualmente.',
        },
        usdcWallet: {
          question: '¿Necesito USDC o una cartera cripto para la suscripción mensual?',
          answer:
            'No. La suscripción mensual se paga con tarjeta a través de Creem (Merchant of Record); Licita nunca ve tu número de tarjeta. El flujo x402/USDC es solo para el pago por llamada y los créditos prepagados — sin suscripción, sin cartera cripto.',
        },
        demoRetention: {
          question: '¿Cuánto tiempo conserváis los emails de demo?',
          answer:
            'Los emails de demo se conservan mientras la solicitud es nueva; cuando un lead pasa a contactado, usado, pagado o perdido, se purga a los <strong>180 días</strong>.',
        },
      },
    },
    connect: {
      title: 'Conectable ahora mismo.',
      body: 'Apunta un cliente MCP a <code>{mcpEndpoint}</code> y prueba la demo gratuita antes de pagar.',
      docsLink: 'Leer la documentación',
      sampleLink: 'GET /v1/demo',
    },
  },
  usecases: {
    title: 'Casos de uso',
    metaDescription:
      'Misiones concretas de agente para Licita: endpoints exactos, herramientas MCP, costes y formas reales de respuesta.',
    intro:
      'Misiones concretas de agente, los endpoints exactos y las herramientas MCP que las resuelven, su coste y cómo es una respuesta real. Cada ejemplo es una muestra etiquetada: los agentes reciben las mismas formas tras pagar por llamada.',
    freeTitle: 'Primera vista gratuita',
    freeBody:
      'Valida los datos antes de pagar: <a href="/v1/demo">GET /v1/demo</a> devuelve una muestra etiquetada de la licitación y la señal de renovación más recientes, sin coste.',
    detail: {
      toolsTitle: 'Herramientas',
      exampleTitle: 'Ejemplo de respuesta (muestra etiquetada)',
      honestyTitle: 'Nota de honestidad',
      allUseCases: 'todos los casos de uso',
    },
  },
  usecaseDetail: {
    'tender-intelligence': {
      title: 'Inteligencia de licitaciones — encuentra licitaciones recientes y quién ganó',
      problem:
        'Un agente necesita actividad de contratación reciente sobre un tema: qué licitaciones se publicaron o adjudicaron, por quién, por cuánto y con qué evidencia.',
      tools:
        '<code>GET /v1/search</code> ($0,02/llamada) para filas compactas, <code>GET /v1/tenders/:id</code> ($0,02/llamada) para el detalle completo de licitación y adjudicación. MCP: <code>search_tenders</code>, <code>get_tender</code>.',
      honestNote:
        'Cada fila expone meta.provenance (source + source_ref + url del origen). Los nulos nunca se inventan.',
    },
    'company-research': {
      title: 'Estudio de proveedores — historial y oportunidades en vivo',
      problem:
        'Un agente que evalúa a un proveedor necesita las adjudicaciones ganadas, el valor total adjudicado, los principales CPV y compradores, además de las licitaciones que encajan con ese perfil ahora mismo.',
      tools:
        '<code>GET /v1/companies/:id</code> ($0,05), <code>GET /v1/companies/:id/awards</code> ($0,05), <code>GET /v1/companies/:id/opportunities</code> ($0,10). MCP: <code>get_company</code>, <code>get_company_awards</code>, <code>get_company_opportunities</code>.',
      honestNote:
        'La identidad de la empresa es un multicruce de fuentes (NIF + alias + identificadores de fuente); los agregados se calculan solo sobre el histórico indexado y cada respuesta expone meta.provenance.',
    },
    'buyer-intelligence': {
      title: 'Inteligencia de compradores — actividad, concentración, recurrencia',
      problem:
        'Un agente necesita un perfil de comprador: historial de adjudicaciones, concentración de proveedores (cuota del proveedor principal) y recurrencia por CPV para cronometrar el contacto.',
      tools: '<code>GET /v1/buyers/:id/history</code> ($0,05/llamada). MCP: <code>get_buyer_history</code>.',
      honestNote:
        'La concentración y la recurrencia se derivan de las adjudicaciones indexadas; los históricos pequeños pueden mostrar una concentración de 1,0: lee los recuentos junto con los ratios. Cada respuesta expone meta.provenance.',
    },
    'renewals-forecasting': {
      title: 'Previsión de renovaciones — qué contratos se volverán a licitar',
      problem:
        'Un agente que busca cartera quiere contratos y acuerdos marco que probablemente se vuelvan a licitar en una ventana, con evidencia por señal.',
      tools:
        '<code>GET /v1/renewals?window_months=12</code> ($0,25/llamada) o <code>POST /v1/research</code> ($0,50/llamada) para un informe completo. MCP: <code>get_renewals</code>, <code>research</code>.',
      honestNote:
        'Las señales son una heurística determinista sobre adjudicaciones y fechas históricas, con confianza baja|media|alta — nunca una estimación de probabilidad. Cada señal expone su evidencia completa en basis, y el sobre lleva meta.provenance.',
    },
  },
  data: {
    overview: {
      h1: 'Datos',
      intro:
        'Qué indexa Licita, de dónde procede y cómo pueden validarlo los agentes antes de pagar. Los recuentos se actualizan en cada ingesta: son hechos operativos, no proyecciones.',
      bullets: [
        '<strong>Registros actuales y rangos indexados</strong> se devuelven desde los metadatos en vivo de la fuente; no se hace ninguna afirmación fija de cobertura.',
        '<strong>TED</strong> (Tenders Electronic Daily) — anuncios de adjudicación de la UE, en vivo por defecto: <a href="/data/eu">página de datos de la UE</a>.',
        '<strong>PLACSP</strong> — contratos del sector público español (refs <code>2026/CONTRAT/…</code>) cuando la ingesta de PLACSP está activada: <a href="/data/spain">página de datos de España</a>.',
      ],
      accessTitle: 'Acceso',
      accessBody:
        'Gratis: <a href="/v1/demo">GET /v1/demo</a> (muestra etiquetada), <a href="/v1/pricing">escalera de precios</a>, <a href="/llms.txt">/llms.txt</a>, <a href="/openapi.json">OpenAPI</a>. De pago: cada fila devuelve <code>meta.provenance</code> (source + source_ref + url del origen); los nulos nunca se inventan.',
    },
    spain: {
      h1: 'Datos — España (PLACSP)',
      intro:
        'Contratos del sector público español ingeridos de PLACSP cuando está activado. Las referencias de publicación tienen el formato <code>2026/CONTRAT/000064</code>.',
      bullets: [
        '<strong>Cobertura</strong> — adjudicaciones con comprador, adjudicatario, códigos CPV, importes y referencias de publicación; entidades del sector público español (ayuntamientos, gobiernos autonómicos, organismos).',
        '<strong>Ejemplos de filas</strong> — adjudicación de la Alcaldía del Ayuntamiento de Oleiros a APDTIC PROFESIONALES S.L. (ref <code>2026/CONTRAT/000064</code>); adjudicación de la Dirección General de IBERMUTUA a Mnemo Evolution &amp; Integration Services, S.A.',
        '<strong>Consulta</strong> — <code>GET /v1/search?q=…&amp;type=award</code>, <code>GET /v1/companies/:id</code>, <code>GET /v1/buyers/:id/history</code>, <code>GET /v1/renewals</code>.',
      ],
      overviewLink: 'resumen de datos',
    },
    eu: {
      h1: 'Datos — UE (TED)',
      intro:
        'Anuncios de adjudicación de contratación pública de la UE ingeridos de TED (Tenders Electronic Daily). La evidencia enlaza con el anuncio original (<code>ted.europa.eu/udl?uri=TED:NOTICE:…</code>).',
      bullets: [
        '<strong>Cobertura</strong> — anuncios con número de publicación, comprador, adjudicatario, CPV, importes, ofertas recibidas e indicadores de acuerdo marco en todos los Estados miembros de la UE.',
        '<strong>Señales de renovación</strong> — las señales de vencimiento de duración, vencimiento de marco y recurrencia se derivan de adjudicaciones históricas (heurística determinista, confianza baja|media|alta).',
        '<strong>Consulta</strong> — <code>GET /v1/search</code>, <code>GET /v1/tenders/:id</code>, <code>POST /v1/research</code> (informe de tema), <code>GET /v1/renewals</code>.',
      ],
      overviewLink: 'resumen de datos',
    },
  },
  pricing: {
    title: 'Precios',
    metaDescription:
      'Precios por llamada en USD para cada endpoint de Licita, paquetes de créditos prepagados y cómo funciona el pago.',
    intro:
      'Precios por llamada en USD. Versión legible por máquina: <a href="/v1/pricing">/v1/pricing</a>. Modo de pago: <code>{paymentsMode}</code>. <code>POST /v1/research</code> cuesta <code>${researchPrice}</code> por llamada (configurable).',
    priceTable: { endpointHeader: 'Endpoint', priceHeader: 'Precio (USD / llamada)', freeTag: 'gratis' },
    demoFreeNote:
      '<code>GET /v1/demo</code> es gratuito: una muestra etiquetada de los datos de pago (licitación reciente + señal de renovación), para que los agentes validen la calidad antes de pagar.',
    creditsTitle: 'Créditos y facturación',
    creditsIntroCreem:
      'Paquetes de créditos prepagados: una compra única. Compra un paquete y luego paga cada llamada desde tu saldo enviando <code>x-client-key: &lt;tu clave&gt;</code> en la solicitud (en lugar de una prueba de pago por llamada).',
    creditsIntro:
      'Paquetes de créditos prepagados: una compra única, sin suscripción. Compra un paquete y luego paga cada llamada desde tu saldo enviando <code>x-client-key: &lt;tu clave&gt;</code> en la solicitud (en lugar de una prueba de pago por llamada).',
    bundles: { bundleHeader: 'Paquete', priceHeader: 'Precio (USD)' },
    twoRails:
      'Dos vías de pago, según cómo compres: la suscripción mensual se paga en <strong>EUR</strong> con tarjeta a través de Creem (sin cartera cripto); el pago por llamada y los créditos prepagados se facturan en <strong>USD</strong> y se pagan con pruebas USDC vía x402.',
    monthlyTitle: 'Suscripción mensual',
    monthlyBody:
      '<strong>Creem MoR</strong>: suscríbete en <code>POST /v1/creem/checkout</code> por\n<code>€{creemPrice}/mes</code> (configurable — siempre el\n<code>CREEM_PRICE_CENTS</code> configurado). Tras el pago, Creem llama a <code>POST /v1/creem/webhook</code>\n(con firma verificada) y la cuenta queda marcada <code>kind=creem</code> durante 30 días. Las llamadas de suscriptor\ndescuentan créditos de un solo uso: agotarlos devuelve <code>402</code> hasta que recargues.',
    buyLine:
      'Compra: <code>POST /v1/billing/credits/5</code> (o <code>/10</code> <code>/25</code>) con el flujo de pago máquina a máquina normal (402 → reintento <code>PAYMENT-SIGNATURE</code>). Consulta el saldo: <code>GET /v1/billing</code> con la cabecera <code>x-client-key: &lt;tu clave&gt;</code>. MCP: <code>billing_purchase_credits</code> / <code>billing_get_balance</code>.',
    howPaymentTitle: 'Cómo funciona el pago',
    steps: [
      'Llama a un endpoint de pago → <code>402</code> con una cabecera <code>PAYMENT-REQUIRED</code> en base64 que describe el requisito exacto de USDC (esquema <code>exact</code>, EIP-3009 transferWithAuthorization).',
      'Firma la autorización con un cliente x402 y reintenta con <code>PAYMENT-SIGNATURE: &lt;payload&gt;</code> (v2; la cabecera heredada <code>X-PAYMENT</code> sigue funcionando).',
      'El servidor verifica y liquida el pago antes de servir el contenido; las pruebas son de un solo uso.',
      'Solo desarrollo local (<code>PAYMENTS_MODE=dev</code>): <code>POST /v1/dev-faucet {"endpoint":"&lt;MÉTODO RUTA&gt;"}</code> → <code>{ token, expires_at }</code>, y reintenta con <code>X-PAYMENT</code> (REST) o <code>payment_token</code> (MCP). No disponible en producción.',
    ],
  },
  trust: {
    methodology: {
      title: 'Metodología',
      body: '<p>Licita presenta filas de fuentes y heurísticas deterministas con su evidencia. La confianza es la fuerza de la evidencia, no una probabilidad. Los recuentos de cobertura, los rangos indexados y la actualización se muestran solo cuando el índice en vivo los proporciona; los valores desconocidos figuran como No consta.</p>',
    },
    security: {
      title: 'Seguridad',
      body: '<p>Las estadísticas de operador y los detalles de los leads requieren la clave de operador del lado del servidor. La captura pública de la demo está limitada en tasa y almacena solo un email normalizado, el canal, la URL de origen y las marcas de tiempo del ciclo de vida. Licita no declara una certificación ni un SLA en esta página.</p>',
    },
    privacy: {
      title: 'Política de privacidad',
      body: `
<h2>Qué datos conserva Licita</h2>
<p>Licita es un servicio de inteligencia de contratación pública nativo de agentes. Indexa datos públicos de TED y PLACSP y los expone vía REST y MCP. Los datos personales que tratamos se limitan a lo necesario para operar el servicio:</p>
<ul>
  <li><strong>Solicitudes de demo</strong> — cuando solicitas una demo, almacenamos solo el email que nos facilitas, además del canal, la URL de origen y las marcas de tiempo del ciclo de vida.</li>
  <li><strong>Emails de suscripción</strong> — cuando te suscribes con el checkout de Creem, almacenamos el email del checkout para crear tu clave de API y tu cuenta de facturación.</li>
  <li><strong>Claves de API</strong> — generamos tu clave de cliente en el checkout y te la enviamos por email. Solo se almacena un hash criptográfico de la clave en el servidor; la clave en claro nunca se persiste tras su entrega.</li>
  <li><strong>Comprobantes de pago</strong> — los pagos por llamada (x402) y las compras de créditos se registran como filas de comprobante con importe, endpoint, proveedor y estado. Los pagos con tarjeta los gestiona Creem de principio a fin (Merchant of Record); nunca vemos ni almacenamos números de tarjeta.</li>
</ul>
<h2>Cuánto tiempo conservamos los datos</h2>
<p>Los emails de demo se conservan mientras la solicitud es nueva; cuando un lead pasa a contactado, usado, pagado o perdido, se purga a los 180 días. Los leads nuevos nunca se eliminan automáticamente. Los registros de suscripción y pago se conservan mientras la cuenta esté activa y durante el periodo exigido por las normas aplicables de pago y conciliación.</p>
<h2>Quién puede acceder a los datos</h2>
<p>El acceso se limita a los operadores mediante una clave de operador del lado del servidor. No vendemos, alquilamos ni compartimos datos personales con terceros con fines de marketing. Dependemos de encargados de tratamiento acotados: Creem (pagos), Resend (email transaccional) y el facilitador de x402 (verificación de comprobantes).</p>
<h2>Tus derechos</h2>
<p>Solicita la eliminación o plantea una pregunta sobre privacidad por email en <a href="mailto:{email}">{email}</a>.</p>`,
    },
    terms: {
      title: 'Términos del servicio',
      body: `
<h2>Servicio</h2>
<p>Licita ofrece inteligencia de contratación pública con evidencia: licitaciones de la UE (TED) y de España (PLACSP), compradores, proveedores y señales deterministas de renovación, consultables vía REST y MCP. Todos los valores proceden de fuentes públicas o de heurísticas deterministas sobre ellas; Licita nunca inventa datos.</p>
<h2>Uso</h2>
<p>Puedes usar el servicio para la evaluación profesional de oportunidades de contratación pública y para integrarlo en tus propias herramientas y agentes, con sujeción a estos términos y a los términos aplicables de las fuentes de origen (TED, PLACSP). No debes usar el servicio para infringir la ley, abusar o saturar la API, revender el índice en bruto como producto competidor ni eludir el pago.</p>
<h2>Precios y pago</h2>
<p>Los endpoints tienen precio por llamada; los precios completos se publican en <a href="/v1/pricing">/v1/pricing</a>. Pagas con comprobantes x402, con paquetes de créditos prepagados (<code>x-client-key</code>) o con una suscripción mensual vía checkout de Creem (<code>POST /v1/creem/checkout</code>). Los comprobantes son de un solo uso y caducan a los 5 minutos. Los pagos con tarjeta los procesa Creem como Merchant of Record; nunca vemos los datos de la tarjeta.</p>
<h2>Claves de API y créditos</h2>
<p>Tu clave de API se emite una sola vez y se te envía por email tras el checkout; solo se almacena un hash. Guárdala bien: es el único identificador de tu saldo de créditos, y un saldo perdido no se puede recuperar actualmente. Los créditos prepagados no caducan nunca.</p>
<h2>Calidad de los datos</h2>
<p>Los valores indexados proceden de fuentes públicas con evidencia. Las señales de renovación y de oportunidad son heurísticas deterministas; la confianza refleja la fuerza de la evidencia, no una probabilidad. Licita no declara una certificación, un SLA de disponibilidad ni idoneidad para una decisión concreta. Verifica antes de basar una decisión material en los datos.</p>
<h2>Propiedad intelectual</h2>
<p>La aplicación Licita es de código abierto bajo licencia MIT (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). Los datos indexados siguen sujetos a los términos de sus fuentes de origen.</p>
<h2>Cambios y contacto</h2>
<p>Podemos actualizar estos términos; el uso continuado tras publicar un cambio constituye aceptación. ¿Preguntas? Email a <a href="mailto:{email}">{email}</a>.</p>
<p><em>Última actualización: septiembre de 2026.</em></p>`,
    },
    status: {
      title: 'Estado',
      body: '<p>El estado del servicio y la actualización de las fuentes son valores operativos, no garantías. Consulta los metadatos de la respuesta y contacta con nosotros para informar de una incidencia. Aquí no se declara ningún SLA de disponibilidad.</p>',
    },
  },
  notFound: { title: 'No encontrado', heading: 'No encontrado' },
  footer: {
    desc: 'Inteligencia de contratación pública europea con evidencia, para equipos profesionales y agentes de IA.',
    product: 'Producto',
    company: 'Empresa',
    contact: 'Contacto',
    useCases: 'Casos de uso',
    pricing: 'Precios',
    docs: 'Documentación',
    mcp: 'MCP',
    coverageAndMethodology: 'Cobertura y metodología',
    methodology: 'Metodología',
    security: 'Seguridad',
    privacy: 'Privacidad',
    terms: 'Términos',
    status: 'Estado',
    github: 'GitHub (MIT)',
    provenance:
      'Evidencia: cada fila de datos expone <code>meta.provenance</code> como <code>[{ source, source_ref, url }]</code>.',
    copyright: '© {year} Licita',
    backToLicita: 'Volver a Licita',
  },
  jsonLd: {
    description:
      'Inteligencia de contratación pública con evidencia: licitaciones, compradores, proveedores y señales deterministas de renovación de la UE (TED) y de España (PLACSP), consultables vía REST y MCP.',
  },
};