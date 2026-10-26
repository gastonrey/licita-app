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
    brand: 'Relicita',
    home: 'Inicio',
    useCases: 'Casos de uso',
    coverageAndMethodology: 'Cobertura y metodología',
    pricing: 'Precios',
    docs: 'Documentación',
    mcp: 'MCP',
    radar: 'Radar',
    developers: 'Desarrolladores',
    toggleMenu: 'Alternar menú',
    requestDemo: 'Empieza gratis',
  },
  home: {
    title: 'Contratos públicos de software y ciberseguridad, antes de que vuelvan a salir',
    metaDescription:
      'Relicita indica a tu pyme de software o ciberseguridad qué contratos públicos se van a volver a licitar, quién los tiene hoy y cuándo moverte. Evidencia de TED y PLACSP. Empieza gratis, sin tarjeta.',
    heroEyebrow: 'Pymes de software y ciberseguridad',
    heroEyebrowTag: 'Evidencia, no una suposición',
    heroTitle: 'Antes de que se publique la licitación, ya sabes cuál va a ser.',
    heroSubtitle:
      'Relicita indica a tu pyme de software o ciberseguridad qué contratos públicos se van a volver a licitar, quién los tiene hoy y cuándo moverte, con la evidencia de cada señal.',
    heroCtas: { demo: 'Empieza gratis', sample: 'Ver el radar' },
    heroCaption:
      'Radar semanal por email en unos dos minutos. Sin tarjeta. La tabla es una muestra real del índice, no un ejemplo inventado.',
    evidenceCard: {
      aria: 'Una fila etiquetada del índice en vivo',
      title: 'Una fila etiquetada del índice en vivo',
      stamp: 'Muestra',
      loading: 'Cargando…',
      empty: 'Ahora mismo el índice no tiene una fila de muestra. No hemos inventado datos.',
      error: 'No se ha podido cargar la fila de muestra.',
      retry: 'Reintentar',
      notReported: 'No consta',
      sourceStamp: 'GET /v1/demo · estado de la muestra',
      upstream: 'Abrir la fuente',
    },
    renewalTable: {
      title: 'Contratos que vencen en los próximos 12 meses',
      intro:
        'Quién los tiene hoy y por cuánto. Son contratos de software e IT (CPV 48 y 72) cuya ventana sigue abierta y empieza como tarde dentro de 12 meses. La confianza es alta, media o baja; baja es una estimación a partir de poca evidencia, no una probabilidad. Si la fuente no trae un dato, la celda dice No consta.',
      loading: 'Cargando la muestra del índice…',
      empty:
        'El índice no tiene ahora mismo señales de renovación de software o servicios TI en esta ventana. No hemos inventado filas.',
      error: 'No se ha podido cargar la muestra del índice.',
      retry: 'Reintentar',
      sampleNote: 'Muestra pública, hasta 8 filas. El radar de pago es el listado completo de tu CPV y tu zona.',
      notReported: 'No consta',
      openRadar: 'Abrir el radar con filtros',
      countMid: 'de',
      headers: {
        contract: 'Contrato',
        buyer: 'Órgano de contratación',
        holder: 'Adjudicatario',
        value: 'Importe',
        window: 'Ventana',
        confidence: 'Confianza',
        source: 'Fuente',
        calculation: 'Cálculo',
      },
      signals: {
        duration: 'Fin de contrato',
        framework: 'Fin de acuerdo marco',
        recurrence: 'Patrón de adjudicaciones',
      },
      confidence: { low: 'Baja · estimación', medium: 'Media', high: 'Alta' },
    },
    evidencePromise: {
      title: 'Cada alerta cita su fuente y su cálculo',
      body: 'Cada fila nombra TED o PLACSP y la regla guardada con la señal (fecha de fin, tope del acuerdo marco o hueco entre adjudicaciones anteriores). No hay texto generado ni una puntuación que no podamos enseñar. Las fechas que no vienen en la fuente quedan en No consta. Si la fuente publica un enlace, puedes abrir el anuncio de origen.',
    },
    plansIntro: {
      title: 'Empieza gratis. Sube de plan cuando el listado te sirva.',
      body: 'Precios sin IVA. El acceso a la API de pago por llamada sigue disponible para quien integre, en su propia página.',
    },
    signupExtra: {
      cpvLabel: 'CPV con el que vendes',
      regionLabel: 'Zona (NUTS, opcional)',
      cpvIt: '72 — servicios de TI, incluida la ciberseguridad',
      cpvSoftware: '48 — paquetes de software',
      cpvBoth: '48 y 72',
      regionPlaceholder: 'ES511',
      pending: 'Guardando el email…',
      error: 'Revisa el email e inténtalo de nuevo.',
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
      title: 'Empieza gratis',
      body: 'Un resumen semanal de 5 renovaciones de tu CPV y tu zona. Sin tarjeta. Si no pasas a cliente, el email de alta se borra a los 12 meses.',
      emailLabel: 'Email de trabajo',
      emailPlaceholder: 'nombre@empresa.com',
      submit: 'Empieza gratis',
      success: 'Alta recibida. Te escribiremos por email; no se ha reservado ninguna reunión y no se ha cobrado ninguna tarjeta.',
      noscript: 'Escribe a <a href="mailto:{email}">{email}</a> para empezar el radar gratuito.',
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
          desc: 'Un pago mensual desbloquea los endpoints de pago: las llamadas de suscriptor descuentan créditos de un solo uso y la cuenta sigue activa durante 30 días. Creem gestiona el pago; Relicita nunca ve un número de tarjeta.',
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
          answer: 'No. Relicita es de pago por llamada — sin registro, sin asientos, sin suscripciones.',
        },
        creditsAndKeys: {
          question: '¿Cómo funcionan los créditos o las claves de cliente?',
          answer:
            'Compra paquetes de créditos en dólares, de $5 a $25, en <code>POST /v1/billing/credits/5</code> (o /10, /25) con tu propia cadena <code>x-client-key</code>, y envía esa misma clave como cabecera <code>x-client-key</code> en las llamadas de pago para pagar desde tu saldo. Guarda bien la clave: es el único identificador de tu saldo y, si se pierde, el saldo no se puede recuperar actualmente.',
        },
        usdcWallet: {
          question: '¿Necesito USDC o una cartera cripto para la suscripción mensual?',
          answer:
            'No. La suscripción mensual se paga con tarjeta a través de Creem (Merchant of Record); Relicita nunca ve tu número de tarjeta. El flujo x402/USDC es solo para el pago por llamada y los créditos prepagados — sin suscripción, sin cartera cripto.',
        },
        demoRetention: {
          question: '¿Cuánto tiempo conserváis los emails de demo?',
          answer:
            'Si no pasas a cliente, el email de alta se borra a los <strong>12 meses</strong>. Si la alta queda marcada como pagada, esa fila no entra en esa purga.',
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
      'Misiones concretas de agente para Relicita: endpoints exactos, herramientas MCP, costes y formas reales de respuesta.',
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
        'Qué indexa Relicita, de dónde procede y cómo pueden validarlo los agentes antes de pagar. Los recuentos se actualizan en cada ingesta: son hechos operativos, no proyecciones.',
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
      'Precios por llamada en USD para cada endpoint de Relicita, paquetes de créditos prepagados y cómo funciona el pago.',
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
      body: '<p>Relicita presenta filas de fuentes y heurísticas deterministas con su evidencia. La confianza es la fuerza de la evidencia, no una probabilidad. Los recuentos de cobertura, los rangos indexados y la actualización se muestran solo cuando el índice en vivo los proporciona; los valores desconocidos figuran como No consta.</p>',
    },
    security: {
      title: 'Seguridad',
      body: '<p>Las estadísticas de operador y los detalles de los leads requieren la clave de operador del lado del servidor. La captura pública de la demo está limitada en tasa y almacena solo un email normalizado, el canal, la URL de origen y las marcas de tiempo del ciclo de vida. Relicita no declara una certificación ni un SLA en esta página.</p>',
    },
    privacy: {
      title: 'Política de privacidad',
      body: `
<h2>Responsable</h2>
<p>Gastón Leonardo Rey Fernández, persona física (autónomo). NIF 02769985A. Domicilio: C/ Pobla de Segur 15, 3C, 28033 Madrid, España. Contacto: <a href="mailto:{email}">{email}</a>. Más datos de identificación en el <a href="/legal">aviso legal</a>.</p>
<h2>Qué tratamos y con qué base</h2>
<ul>
  <li><strong>Alta gratuita.</strong> Email, canal, URL de origen, estado (nueva, contactada, usada, pagada o perdida) y fechas, incluida la de baja del radar. Base: consentimiento, al enviar el formulario.</li>
  <li><strong>Acuse de alta.</strong> Si hay clave de Resend, enviamos un correo con el asunto «Alta recibida en Relicita». El envío automático se puede apagar con DEMO_AUTOREPLY_ENABLED. Base: el mismo consentimiento.</li>
  <li><strong>Radar semanal.</strong> Cuando el envío está activado (DIGEST_ENABLED), cada email de alta que no se ha dado de baja recibe como mucho un correo en castellano por semana UTC, con hasta 5 renovaciones. También puede lanzarlo el operador. Base: consentimiento. La baja es un clic en el enlace del correo (<a href="/radar/baja">/radar/baja</a>). No hay un proceso que interprete la palabra «baja» en una respuesta.</li>
  <li><strong>Suscripción.</strong> Tras un checkout de Creem completado guardamos el email, un hash de la clave de API, el tipo de cuenta y el fin del periodo. La clave en claro se envía una sola vez por email y no se guarda. Base: contrato.</li>
  <li><strong>Pagos x402 y créditos.</strong> Importe, endpoint, proveedor y estado. En x402, también la dirección del pagador, el identificador de la transacción y la red. La tarjeta no pasa por nosotros: la cobra Creem. Base: contrato.</li>
  <li><strong>Registros técnicos.</strong> Ruta, estado, agente de usuario, referer y, si no hay clave de cliente, un hash de la IP. La IP en claro y la clave de API en claro no se guardan. Base: interés legítimo de seguridad y operación. Estos registros no tienen borrado automático.</li>
</ul>
<h2>Conservación</h2>
<p>Una alta que no es de cliente se borra a los 12 meses desde su creación. Cliente, a estos efectos, es la fila marcada como pagada: esa fila no entra en la purga. La purga corre al registrar una alta nueva; no hay un barrido diario. La cuenta de suscriptor y los pagos no los borra esa purga: se conservan mientras la cuenta sigue y el tiempo que exijan la contabilidad y la conciliación. El acuse de envío semanal (email y semana) se borra cuando la alta ya no existe.</p>
<h2>Encargados</h2>
<p>No vendemos datos. Acceden quienes operan el servicio, con clave de operador. Encargados:</p>
<ul>
  <li><strong>Hetzner</strong> — alojamiento, en la Unión Europea.</li>
  <li><strong>Cloudflare</strong> — DNS y proxy.</li>
  <li><strong>Resend</strong> — envío de email, con la cuenta en región UE.</li>
  <li><strong>Creem</strong> — pagos con tarjeta, como Merchant of Record. El cargo puede implicar una transferencia fuera del Espacio Económico Europeo; cuando ocurre, se ampara en las cláusulas contractuales tipo del encargado.</li>
  <li><strong>Facilitador x402</strong> — verificación y liquidación del comprobante USDC (por defecto el de x402.org; la URL es configurable). Puede estar fuera del EEE; cuando la transferencia sale del EEE, se ampara en cláusulas contractuales tipo si el encargado las ofrece.</li>
</ul>
<h2>Comunicaciones comerciales</h2>
<p>El producto no envía correo a direcciones genéricas tomadas de la web de una empresa. Los correos descritos arriba salen del email que la persona escribió al darse de alta o al pagar. Si el titular escribe, fuera de esta aplicación, a un email genérico de empresa publicado en su web, la base es el interés legítimo en una comunicación B2B, el origen del dato es esa web pública, y la baja es un correo a <a href="mailto:{email}">{email}</a> con la palabra «baja». Esa respuesta se atiende a mano: el código no la automatiza.</p>
<h2>Cookies</h2>
<p>El código del sitio no instala cookies ni de seguimiento ni de analítica. No hay píxel ni herramienta de medición de terceros. El panel de operador guarda su clave en sessionStorage del navegador: no es una cookie y no se envía a terceros. Si Cloudflare actúa como proxy, puede fijar cookies técnicas propias; no las usamos para publicidad.</p>
<h2>Derechos</h2>
<p>Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad en <a href="mailto:{email}">{email}</a>. Respondemos en el plazo de un mes. También puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es">www.aepd.es</a>).</p>
<p><em>Última actualización: octubre de 2026.</em></p>`,
    },
    terms: {
      title: 'Términos del servicio',
      body: `
<h2>Prestador</h2>
<p>Gastón Leonardo Rey Fernández, persona física (autónomo). NIF 02769985A. Domicilio: C/ Pobla de Segur 15, 3C, 28033 Madrid, España. Email: <a href="mailto:{email}">{email}</a>. Identificación completa en el <a href="/legal">aviso legal</a>.</p>
<h2>A quién se dirige</h2>
<p>El servicio es solo para empresas y profesionales (B2B), para valorar contratación pública e integrarlo en herramientas propias. No está dirigido a consumidores.</p>
<h2>Servicio</h2>
<p>Relicita ofrece inteligencia de contratación pública con evidencia: licitaciones de la UE (TED) y de España (PLACSP, cuando está activado), compradores, proveedores y señales deterministas de renovación, por la web, REST y MCP. Los valores salen de fuentes públicas o de heurísticas sobre ellas. No se inventan datos.</p>
<h2>Uso</h2>
<p>Sujeto a estos términos y a los de TED y PLACSP. No uses el servicio para infringir la ley, saturar la API, revender el índice en bruto como producto competidor ni eludir el pago.</p>
<h2>Precio y pago</h2>
<p>Los precios por llamada están en <a href="/v1/pricing">/v1/pricing</a>. Se paga con comprobantes x402, con créditos prepagados (<code>x-client-key</code>) o con suscripción vía checkout de Creem. Los comprobantes son de un solo uso y caducan a los 5 minutos. Creem es el Merchant of Record de la suscripción con tarjeta: Relicita no ve ni guarda el número de tarjeta. La aplicación no tiene un endpoint propio de reembolso ni de cancelación de la suscripción.</p>
<h2>Cancelación y reembolso</h2>
<p>Puedes cancelar la suscripción en cualquier momento, con efecto al final del periodo ya pagado. El primer mes se reembolsa si lo pides en los 14 días siguientes al primer cargo. La petición se hace por email a <a href="mailto:{email}">{email}</a>; la ejecuta Creem. Este reembolso no cubre créditos prepagados ni un pago x402 ya liquidado. Los créditos prepagados no caducan y no se reembolsan por este cauce.</p>
<h2>Claves de API</h2>
<p>La clave se envía una sola vez por email tras el checkout y solo se guarda un hash. Es el identificador del saldo. Si se pierde, el saldo no se puede recuperar con el código actual.</p>
<h2>Responsabilidad</h2>
<p>Las señales son heurísticas: la confianza mide la evidencia, no una probabilidad. No hay certificación ni SLA de disponibilidad. No respondemos de una decisión de licitación tomada solo con estos datos, ni de cortes de TED, PLACSP, Creem o el facilitador x402, en la medida en que la ley española lo permite. Nada de esta cláusula limita la responsabilidad por dolo ni lo que la ley impide excluir.</p>
<h2>Ley y fuero</h2>
<p>Ley española. Juzgados y tribunales de Madrid.</p>
<h2>Propiedad intelectual</h2>
<p>El código es MIT (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). Los datos indexados siguen las condiciones de su fuente.</p>
<h2>Cambios</h2>
<p>Estos términos pueden actualizarse. El uso posterior a la publicación del cambio implica aceptarlo.</p>
<p><em>Última actualización: octubre de 2026.</em></p>`,
    },
    legal: {
      title: 'Aviso legal',
      body: `
<h2>Titular</h2>
<p>Información del artículo 10 de la Ley 34/2002 (LSSI):</p>
<ul>
  <li><strong>Titular:</strong> Gastón Leonardo Rey Fernández, persona física que actúa como autónomo. No hay una sociedad detrás de este sitio.</li>
  <li><strong>NIF:</strong> 02769985A</li>
  <li><strong>Domicilio:</strong> C/ Pobla de Segur 15, 3C, 28033 Madrid, España</li>
  <li><strong>Email:</strong> <a href="mailto:{email}">{email}</a></li>
  <li><strong>Sitio y marca:</strong> eutendersai.com, marca Relicita</li>
  <li><strong>Actividad:</strong> servicio de inteligencia de contratación pública. Indexa anuncios públicos de TED y, cuando está activado, de PLACSP, y se consultan por la web, por REST y por MCP.</li>
</ul>
<h2>Propiedad intelectual</h2>
<p>El código de la aplicación se publica bajo licencia MIT (<a href="https://github.com/gastonrey/licita-app">github.com/gastonrey/licita-app</a>). Los datos indexados proceden de fuentes públicas (TED y PLACSP) y siguen sujetos a las condiciones de esas fuentes. Los textos de este sitio y la marca Relicita corresponden al titular.</p>
<h2>Ley aplicable</h2>
<p>Legislación española. Para una controversia, los juzgados y tribunales de Madrid, sin perjuicio de las normas imperativas que no quepa excluir. El servicio se dirige a empresas y profesionales. Privacidad: <a href="/privacy">/privacy</a>. Condiciones: <a href="/terms">/terms</a>.</p>
<p><em>Última actualización: octubre de 2026.</em></p>`,
    },
    status: {
      title: 'Estado',
      body: '<p>El estado del servicio y la actualización de las fuentes son valores operativos, no garantías. Consulta los metadatos de la respuesta y contacta con nosotros para informar de una incidencia. Aquí no se declara ningún SLA de disponibilidad.</p>',
    },
  },
  notFound: { title: 'No encontrado', heading: 'No encontrado' },
  footer: {
    desc: 'Relicita indica a las pymes de software y ciberseguridad qué contratos públicos se van a volver a licitar, con la evidencia de cada señal.',
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
    legal: 'Aviso legal',
    status: 'Estado',
    github: 'GitHub (MIT)',
    tenderIntelligence: 'Inteligencia de licitaciones',
    provenance:
      'Evidencia: cada fila de datos expone <code>meta.provenance</code> como <code>[{ source, source_ref, url }]</code>.',
    copyright: '© {year} Relicita',
    backToLicita: 'Volver a Relicita',
  },
  jsonLd: {
    description:
      'Relicita indica a las pymes de software y ciberseguridad qué contratos públicos se van a volver a licitar, quién los tiene hoy y cuándo moverte. Evidencia de TED y PLACSP.',
  },
  plans: {
    vat: 'Precios sin IVA.',
    free: {
      name: 'Gratis',
      price: '0 €',
      period: 'email semanal',
      desc: 'Resumen semanal de 5 renovaciones de tu CPV y tu zona. Sin tarjeta.',
      cta: 'Empieza gratis',
    },
    radar: {
      name: 'Radar',
      price: '39 €',
      period: 'al mes',
      desc: 'El listado de renovaciones de tu mercado, cada semana. 390 € al año si se factura anualmente.',
      cta: 'Quiero Radar',
    },
    pro: {
      name: 'Pro',
      price: '99 €',
      period: 'al mes',
      desc: 'Radar más el contexto del órgano de contratación y del adjudicatario, para una lista corta de trabajo. 990 € al año si se factura anualmente.',
      cta: 'Quiero Pro',
    },
    team: {
      name: 'Team',
      price: '199 €',
      period: 'al mes',
      desc: 'Cinco usuarios en Pro, más acceso de lectura a la API para vuestras herramientas.',
      cta: 'Quiero Team',
    },
    interestCta: 'Guardar mi interés',
    payCta: 'Continuar al pago',
    intervalLabel: 'Periodicidad',
    monthlyRadar: 'Mensual, 39 €',
    annualRadar: 'Anual, 390 €',
    monthlyPro: 'Mensual, 99 €',
    annualPro: 'Anual, 990 €',
    chosenFree: 'Has elegido el plan Gratis. El alta no pide tarjeta.',
    chosenRadar: 'Has elegido Radar (39 € al mes o 390 € al año). Deja tu email y guardamos el interés. No se pide la tarjeta.',
    chosenPro: 'Has elegido Pro (99 € al mes o 990 € al año). Deja tu email y guardamos el interés. No se pide la tarjeta.',
    chosenTeam: 'Has elegido Team (199 € al mes, 5 usuarios y API de lectura). Deja tu email y guardamos el interés. No se pide la tarjeta.',
    payRadarMonthly: 'Has elegido Radar, 39 € al mes. El pago continúa en Creem. No vemos los datos de la tarjeta.',
    payRadarAnnual: 'Has elegido Radar, 390 € al año. El pago continúa en Creem. No vemos los datos de la tarjeta.',
    payProMonthly: 'Has elegido Pro, 99 € al mes. El pago continúa en Creem. No vemos los datos de la tarjeta.',
    payProAnnual: 'Has elegido Pro, 990 € al año. El pago continúa en Creem. No vemos los datos de la tarjeta.',
    payTeamMonthly: 'Has elegido Team, 199 € al mes. El pago continúa en Creem. No vemos los datos de la tarjeta.',
    checkoutNoscript: 'Sin JavaScript guardamos el email como interés y no se abre el pago.',
  },
  radarPage: {
    title: 'Radar de renovaciones',
    metaDescription:
      'Contratos públicos de software y ciberseguridad que se van a volver a licitar: quién los tiene, por cuánto y la fuente de cada señal.',
    h1: 'Qué contratos vuelven y quién los tiene',
    intro:
      'Filtra la muestra pública por CPV, órgano de contratación, zona y horizonte (6 o 12 meses). Solo entran ventanas que siguen abiertas. La confianza baja va marcada como estimación: es la fuerza de la evidencia, no una probabilidad.',
    filtersLabel: 'Filtrar la muestra',
    cpvLabel: 'CPV',
    windowLabel: 'Ventana',
    window6: 'Próximos 6 meses',
    window12: 'Próximos 12 meses',
    buyerLabel: 'Órgano de contratación',
    buyerPlaceholder: 'Nombre del organismo',
    regionLabel: 'Zona',
    regionPlaceholder: 'ES511',
    apply: 'Actualizar',
    renewalsTitle: 'Renovaciones',
    opportunitiesTitle: 'Licitaciones ya publicadas',
    opportunitiesIntro:
      'Anuncios recientes del mismo corte de CPV. Es lo que ya está en el mercado, al lado de los contratos que todavía no se han vuelto a licitar.',
    oppHeaders: {
      title: 'Licitación',
      buyer: 'Órgano de contratación',
      cpv: 'CPV',
      value: 'Importe estimado',
      published: 'Publicación',
      deadline: 'Plazo',
      region: 'Zona',
      source: 'Fuente',
    },
    noscript: 'Esta tabla se carga del índice en vivo. Sin JavaScript, abre GET /v1/radar/preview.',
  },
  developersPage: {
    title: 'Desarrolladores',
    metaDescription:
      'Acceso de pago por llamada al índice de Relicita por REST y MCP. USDC vía x402, o créditos prepagados. Los planes para personas están en Precios.',
    h1: 'API y MCP para integraciones',
    intro:
      'Si quieres que una persona lea el radar, empieza en Precios. Esta página es la interfaz para máquinas: llamadas REST de pago y herramientas MCP. No hace falta nada de aquí para recibir el email semanal.',
    docsCta: 'Leer la documentación',
    mcpCta: 'Servidor MCP',
    ladderTitle: 'Pago por llamada',
  },
};