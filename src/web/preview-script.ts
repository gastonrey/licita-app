// Client script for the public renewal table and the radar page.
// Locale strings arrive as data-* attributes so this source stays identical
// on every page. Every dynamic value is escaped before it touches innerHTML.

const PREVIEW_JS = `
function relicitaEsc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function relicitaUrl(u){
  if (typeof u !== 'string') return '';
  var s = u.trim();
  if (!s || s === 'null' || s === 'undefined') return '';
  try {
    var x = new URL(s);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
    var path = x.pathname;
    while (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    if (!path) path = '/';
    if (path === '/null' || path.slice(-5) === '/null') return '';
    return s;
  } catch (e) {}
  return '';
}
function relicitaMoney(value, currency, notReported){
  if (value == null || value === '') return relicitaEsc(notReported);
  var n = Number(value);
  if (!isFinite(n)) return relicitaEsc(notReported);
  var formatted = new Intl.NumberFormat(document.documentElement.lang || 'es', { maximumFractionDigits: 0 }).format(n);
  if (!currency) return relicitaEsc(formatted) + ' · ' + relicitaEsc(notReported);
  try {
    return relicitaEsc(new Intl.NumberFormat(document.documentElement.lang || 'es', { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(n));
  } catch (e) {
    return relicitaEsc(formatted + ' ' + currency);
  }
}
function relicitaDay(iso, notReported){
  if (!iso) return relicitaEsc(notReported);
  var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return relicitaEsc(iso);
  return relicitaEsc(new Intl.DateTimeFormat(document.documentElement.lang || 'es', { dateStyle: 'medium' }).format(d));
}
function relicitaLabels(el){
  var d = el.dataset;
  return {
    notReported: d.notReported || 'Not reported',
    empty: d.empty || '',
    error: d.error || '',
    retry: d.retry || 'Retry',
    countMid: d.countMid || 'of',
    sig: { duration_expiry: d.sigDuration || 'duration_expiry', framework_expiry: d.sigFramework || 'framework_expiry', recurrence: d.sigRecurrence || 'recurrence' },
    conf: { low: d.confLow || 'low', medium: d.confMedium || 'medium', high: d.confHigh || 'high' }
  };
}
function relicitaSignal(type, labels){
  return labels.sig[type] || type || labels.notReported;
}
function relicitaConf(value, labels){
  return (value && labels.conf[value]) || value || labels.notReported;
}
function relicitaCount(shown, total, labels){
  return relicitaEsc(shown) + ' ' + relicitaEsc(labels.countMid) + ' ' + relicitaEsc(total);
}
function relicitaCell(label, html){
  return '<td data-label="' + relicitaEsc(label) + '">' + html + '</td>';
}
function relicitaSource(row){
  var name = row.source ? String(row.source).toUpperCase() : '';
  var href = relicitaUrl(row.url) || relicitaUrl(row.source_ref);
  var ref = row.source_ref ? relicitaEsc(row.source_ref) : '';
  var badge = name ? '<span class="source-badge">' + relicitaEsc(name) + '</span>' : '';
  var link = href && ref ? ' <a href="' + relicitaEsc(href) + '" rel="noreferrer">' + ref + '</a>' : (ref ? ' ' + ref : '');
  return badge + link;
}
function relicitaRenewalTable(rows, labels, heads){
  var head = '<table class="data-table stack"><caption class="visually-hidden">' + relicitaEsc(heads.caption || '') + '</caption><thead><tr>'
    + ['contract','buyer','holder','value','window','confidence','source','calculation'].map(function(key){
      return '<th scope="col">' + relicitaEsc(heads[key] || key) + '</th>';
    }).join('') + '</tr></thead><tbody>';
  var body = rows.map(function(row){
    var contract = (row.contract && row.contract.title) || relicitaSignal(row.signal_type, labels);
    var buyer = row.buyer && row.buyer.name;
    var holder = row.incumbent && row.incumbent.name;
    var amount = row.contract ? relicitaMoney(row.contract.value, row.contract.currency, labels.notReported) : relicitaEsc(labels.notReported);
    var windowText = relicitaDay(row.window_start, labels.notReported) + ' – ' + relicitaDay(row.window_end, labels.notReported);
    return '<tr>'
      + relicitaCell(heads.contract, '<span class="row-title">' + relicitaEsc(contract || labels.notReported) + '</span>' + (row.cpv ? '<span class="row-meta">CPV ' + relicitaEsc(row.cpv) + '</span>' : ''))
      + relicitaCell(heads.buyer, relicitaEsc(buyer || labels.notReported))
      + relicitaCell(heads.holder, relicitaEsc(holder || labels.notReported))
      + relicitaCell(heads.value, amount)
      + relicitaCell(heads.window, windowText)
      + relicitaCell(heads.confidence, relicitaEsc(relicitaConf(row.confidence, labels)))
      + relicitaCell(heads.source, relicitaSource(row) || relicitaEsc(labels.notReported))
      + relicitaCell(heads.calculation, relicitaEsc(row.calculation || labels.notReported))
      + '</tr>';
  }).join('');
  return head + body + '</tbody></table>';
}
function relicitaOpportunityTable(rows, labels, heads){
  var cols = ['title','buyer','cpv','value','published','deadline','region','source'];
  var head = '<table class="data-table stack"><thead><tr>' + cols.map(function(key){
    return '<th scope="col">' + relicitaEsc(heads[key] || key) + '</th>';
  }).join('') + '</tr></thead><tbody>';
  var body = rows.map(function(row){
    return '<tr>'
      + relicitaCell(heads.title, relicitaEsc(row.title || labels.notReported))
      + relicitaCell(heads.buyer, relicitaEsc((row.buyer && row.buyer.name) || labels.notReported))
      + relicitaCell(heads.cpv, relicitaEsc(row.cpv || labels.notReported))
      + relicitaCell(heads.value, relicitaMoney(row.estimated_value, row.currency, labels.notReported))
      + relicitaCell(heads.published, relicitaDay(row.published_at, labels.notReported))
      + relicitaCell(heads.deadline, row.deadline ? relicitaEsc(new Intl.DateTimeFormat(document.documentElement.lang || 'es', { dateStyle: 'medium' }).format(new Date(row.deadline))) : relicitaEsc(labels.notReported))
      + relicitaCell(heads.region, relicitaEsc(row.region || labels.notReported))
      + relicitaCell(heads.source, relicitaSource(row) || relicitaEsc(labels.notReported))
      + '</tr>';
  }).join('');
  return head + body + '</tbody></table>';
}
function relicitaEmpty(message){
  return '<p class="empty-note">' + relicitaEsc(message) + '</p>';
}
function relicitaFail(labels){
  return '<p class="empty-note">' + relicitaEsc(labels.error) + ' <button type="button" class="btn btn-secondary btn-sm" data-retry="1">' + relicitaEsc(labels.retry) + '</button></p>';
}
function relicitaFill(target, html, state){
  target.dataset.state = state;
  target.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  target.innerHTML = html;
}
function bootDemoSample(sample){
  if (!sample) return;
  if (sample._relicitaLoad) { sample._relicitaLoad(); return; }
  var lab = function(key, fb){ return (sample.dataset && sample.dataset[key]) || fb || ''; };
  function paint(state, html){
    sample.dataset.state = state;
    sample.setAttribute('aria-busy', 'false');
    sample.innerHTML = html;
  }
  function lines(xs){
    var list = Array.isArray(xs) ? xs.filter(function(x){ return typeof x === 'string' && x; }) : [];
    if (!list.length) return '';
    return '<ul class="evidence-lines">' + list.map(function(x){ return '<li>' + relicitaEsc(x) + '</li>'; }).join('') + '</ul>';
  }
  function field(value){
    return value == null || value === '' ? relicitaEsc(lab('notReported', 'Not reported')) : relicitaEsc(value);
  }
  function render(data, meta){
    var t = data.tender && typeof data.tender === 'object' ? data.tender : null;
    var r = data.renewal && typeof data.renewal === 'object' ? data.renewal : null;
    if (!t && !r) {
      paint('empty', '<p class="empty-note">' + relicitaEsc(lab('empty', 'No sample row.')) + '</p><p class="source-stamp">' + relicitaEsc(lab('sourceStamp', 'GET /v1/demo')) + '</p>');
      return;
    }
    var html = '';
    if (t) {
      html += '<h3>' + field(t.title) + '</h3><p class="finding-meta"><strong>' + relicitaEsc(lab('buyer', 'Buyer')) + ':</strong> ' + field(t.buyer && t.buyer.name) + ' · <strong>' + relicitaEsc(lab('value', 'Value')) + ':</strong> ' + relicitaMoney(t.estimated_value, t.currency, lab('notReported', 'Not reported')) + ' · <strong>' + relicitaEsc(lab('published', 'Published')) + ':</strong> ' + relicitaDay(t.published_at, lab('notReported', 'Not reported')) + '</p>' + lines(t.evidence);
    }
    if (r) {
      html += '<p class="finding-meta"><strong>' + relicitaEsc(lab('renewal', 'Renewal')) + ':</strong> ' + field(r.signal_type) + ' · ' + field(r.confidence) + ' · ' + relicitaDay(r.contract && r.contract.end_date, lab('notReported', 'Not reported')) + '</p>' + lines(r.evidence);
    }
    var source = (t && t.source) || (r && r.source) || '';
    var ref = (t && t.source_ref) || (r && r.source_ref) || '';
    var when = meta && meta.generated_at ? ' · ' + relicitaEsc(meta.generated_at) : '';
    html += '<p class="source-stamp">' + field(source) + ' · ' + field(ref) + when + '</p>';
    var href = relicitaUrl(t && t.url) || relicitaUrl(r && r.url);
    if (href) {
      html += '<p><a class="upstream" href="' + relicitaEsc(href) + '" target="_blank" rel="noreferrer">' + relicitaEsc(lab('upstream', 'Open upstream source')) + '</a></p>';
    }
    var metaRows = Array.isArray(data.source_metadata) ? data.source_metadata : [];
    html += '<p class="source-stamp">source_metadata: ' + relicitaEsc(JSON.stringify(metaRows)) + '</p>';
    paint('ready', html);
  }
  function fail(){
    paint('error', '<p class="empty-note">' + relicitaEsc(lab('error', 'Sample unavailable.')) + ' <button type="button" class="btn btn-secondary btn-sm" data-retry="1">' + relicitaEsc(lab('retry', 'Retry')) + '</button></p>');
  }
  function load(){
    sample.dataset.state = 'loading';
    sample.setAttribute('aria-busy', 'true');
    sample.innerHTML = '<p>' + relicitaEsc(lab('loading', 'Loading…')) + '</p>';
    var opts = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') opts.signal = AbortSignal.timeout(8000);
    fetch('/v1/demo', opts).then(function(res){
      if (!res.ok) throw new Error('sample ' + res.status);
      return res.json();
    }).then(function(body){
      var data = body && body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('sample shape');
      render(data, (body && body.meta) || {});
    }).catch(fail);
  }
  sample._relicitaLoad = load;
  sample.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('[data-retry]');
    if (b) load();
  });
  load();
}
function bootRenewalTable(root){
  var labels = relicitaLabels(root);
  var heads = {
    caption: root.dataset.caption || '',
    contract: root.dataset.hContract, buyer: root.dataset.hBuyer, holder: root.dataset.hHolder,
    value: root.dataset.hValue, window: root.dataset.hWindow, confidence: root.dataset.hConfidence,
    source: root.dataset.hSource, calculation: root.dataset.hCalculation
  };
  function load(){
    relicitaFill(root, '<p class="empty-note">' + relicitaEsc(root.dataset.loading || '') + '</p>', 'loading');
    fetch('/v1/radar/preview?window_months=12').then(function(r){
      if (!r.ok) throw new Error('preview ' + r.status);
      return r.json();
    }).then(function(body){
      var block = body.data && body.data.renewals;
      var rows = (block && block.rows) || [];
      if (!rows.length) { relicitaFill(root, relicitaEmpty(labels.empty), 'empty'); return; }
      var count = '<p class="table-count">' + relicitaCount(block.shown, block.total, labels) + '</p>';
      relicitaFill(root, count + relicitaRenewalTable(rows, labels, heads), 'ready');
    }).catch(function(){
      relicitaFill(root, relicitaFail(labels), 'error');
    });
  }
  root.addEventListener('click', function(e){
    var b = e.target.closest('[data-retry]');
    if (b) load();
  });
  load();
}
function bootRadar(root){
  var labels = relicitaLabels(root);
  var renewalsEl = document.getElementById('radar-renewals');
  var oppsEl = document.getElementById('radar-opportunities');
  var statusEl = document.getElementById('radar-status');
  var form = document.getElementById('radar-filters');
  var heads = {
    caption: root.dataset.caption || '',
    contract: root.dataset.hContract, buyer: root.dataset.hBuyer, holder: root.dataset.hHolder,
    value: root.dataset.hValue, window: root.dataset.hWindow, confidence: root.dataset.hConfidence,
    source: root.dataset.hSource, calculation: root.dataset.hCalculation
  };
  var oppHeads = {
    title: root.dataset.oTitle, buyer: root.dataset.oBuyer, cpv: root.dataset.oCpv, value: root.dataset.oValue,
    published: root.dataset.oPublished, deadline: root.dataset.oDeadline, region: root.dataset.oRegion, source: root.dataset.oSource
  };
  function paramsFromForm(){
    var data = new FormData(form);
    var params = new URLSearchParams();
    ['cpv','buyer','region','window_months'].forEach(function(key){
      var value = String(data.get(key) || '').trim();
      if (value) params.set(key, value);
    });
    return params;
  }
  function paramsFromUrl(){
    return new URLSearchParams(location.search);
  }
  function applyParams(params){
    if (!form) return;
    ['cpv','buyer','region','window_months'].forEach(function(key){
      var field = form.elements[key];
      if (field) field.value = params.get(key) || (key === 'window_months' ? '12' : '');
    });
  }
  function load(params, push){
    if (push) history.pushState({}, '', location.pathname + (params.toString() ? '?' + params.toString() : ''));
    if (statusEl) statusEl.textContent = root.dataset.loading || '';
    if (renewalsEl) relicitaFill(renewalsEl, '', 'loading');
    if (oppsEl) relicitaFill(oppsEl, '', 'loading');
    fetch('/v1/radar/preview?' + params.toString()).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(body){ throw new Error((body.error && body.error.message) || ('preview ' + r.status)); });
      return r.json();
    }).then(function(body){
      var data = body.data || {};
      var renewals = data.renewals || { rows: [], shown: 0, total: 0 };
      var opps = data.opportunities || { rows: [], shown: 0, total: 0 };
      if (statusEl) statusEl.textContent = '';
      if (renewalsEl) {
        relicitaFill(renewalsEl, renewals.rows.length
          ? '<p class="table-count">' + relicitaCount(renewals.shown, renewals.total, labels) + '</p>' + relicitaRenewalTable(renewals.rows, labels, heads)
          : relicitaEmpty(labels.empty), renewals.rows.length ? 'ready' : 'empty');
      }
      if (oppsEl) {
        relicitaFill(oppsEl, opps.rows.length
          ? '<p class="table-count">' + relicitaCount(opps.shown, opps.total, labels) + '</p>' + relicitaOpportunityTable(opps.rows, labels, oppHeads)
          : relicitaEmpty(root.dataset.emptyOpps || labels.empty), opps.rows.length ? 'ready' : 'empty');
      }
    }).catch(function(err){
      if (statusEl) statusEl.textContent = err.message || labels.error;
      if (renewalsEl) relicitaFill(renewalsEl, relicitaFail(labels), 'error');
      if (oppsEl) relicitaFill(oppsEl, '', 'error');
    });
  }
  if (form) {
    form.addEventListener('submit', function(e){
      e.preventDefault();
      load(paramsFromForm(), true);
    });
  }
  root.addEventListener('click', function(e){
    if (e.target.closest('[data-retry]')) load(paramsFromUrl(), false);
  });
  window.addEventListener('popstate', function(){
    var params = paramsFromUrl();
    applyParams(params);
    load(params, false);
  });
  var initial = paramsFromUrl();
  applyParams(initial);
  load(initial, false);
}
function relicitaApplyPlan(){
  var params = new URLSearchParams(location.search);
  var plan = params.get('plan') || '';
  if (plan !== 'free' && plan !== 'radar' && plan !== 'pro' && plan !== 'team') plan = '';
  var interval = params.get('interval') === 'annual' ? 'annual' : 'monthly';
  if (plan === 'team' || plan === 'free') interval = 'monthly';
  if (plan) {
    document.querySelectorAll('input[name=plan]').forEach(function(el){ el.value = plan; });
  }
  document.querySelectorAll('input[name=interval]').forEach(function(el){ el.value = interval; });
  var note = document.getElementById('plan-choice');
  if (!note) return;
  var text = plan ? (note.dataset[plan] || '') : '';
  note.hidden = !text;
  note.textContent = text;
}
function bindExtraSignups(){
  document.querySelectorAll('form[data-signup-source]').forEach(function(f){
    f.addEventListener('submit', function(e){
      e.preventDefault();
      var m = f.querySelector('[data-signup-message]');
      var b = f.querySelector('button');
      if (m) m.textContent = f.dataset.pending || '';
      if (b) b.disabled = true;
      function done(){ if (b) b.disabled = false; }
      function fail(err){ if (m) m.textContent = err.message; done(); }
      function registerInterest(){
        var url = '/v1/demo/request?source=' + encodeURIComponent(f.dataset.signupSource || 'signup')
          + '&cpv=' + encodeURIComponent(f.cpv ? f.cpv.value : '')
          + '&region=' + encodeURIComponent(f.region ? f.region.value : '')
          + '&plan=' + encodeURIComponent(f.plan ? f.plan.value : '');
        if (f.interval && f.interval.value) url += '&interval=' + encodeURIComponent(f.interval.value);
        return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.email.value }) })
          .then(function(r){ if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(body){ throw new Error((body.error && (body.error.hint || body.error.message)) || f.dataset.error || 'Error'); }); return r.json(); })
          .then(function(){ if (m) m.textContent = f.dataset.success || ''; f.reset(); relicitaApplyPlan(); done(); })
          .catch(fail);
      }
      if (f.dataset.checkout === '1' && f.plan && f.plan.value && f.plan.value !== 'free') {
        fetch('/v1/creem/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: f.email.value,
            plan: f.plan.value,
            interval: (f.interval && f.interval.value) || 'monthly',
            successUrl: location.origin + '/?checkout=success',
            cancelUrl: location.origin + location.pathname + location.search
          })
        }).then(function(r){
          if (r.status === 409) return registerInterest();
          if (r.status !== 303 && !r.ok) return r.json().catch(function(){ return {}; }).then(function(body){ throw new Error((body.error && (body.error.hint || body.error.message)) || f.dataset.error || 'Error'); });
          return r.json().then(function(body){
            var url = body && body.data && body.data.url;
            if (!url) throw new Error(f.dataset.error || 'Error');
            location.assign(url);
          });
        }).catch(fail);
        return;
      }
      registerInterest();
    });
  });
}
relicitaApplyPlan();
bindExtraSignups();
`;

/** Homepage script: labeled /v1/demo sample, free signup, and the renewal table. */
export function homeScript(contactEmail: string): string {
  return `<script>const sample=document.getElementById('demo-sample');${PREVIEW_JS}
bootDemoSample(sample);
document.getElementById('demo-request').addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,m=document.getElementById('demo-message'),b=f.querySelector('button');m.textContent=f.dataset.pending||'Saving…';b.disabled=true;try{const r=await fetch('/v1/demo/request?source=homepage'+'&cpv='+encodeURIComponent(f.cpv?f.cpv.value:'')+'&region='+encodeURIComponent(f.region?f.region.value:'')+'&plan='+encodeURIComponent(f.plan?f.plan.value:''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.email.value})});if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body.error?.hint||body.error?.message||f.dataset.error||'Check your email and try again.')}m.textContent=f.dataset.success||'Signup received. We will follow up by email; no meeting was booked.';f.reset()}catch(err){m.textContent=err.message+' You can also email ${contactEmail}.'}finally{b.disabled=false}});
if(document.getElementById('renewal-table'))bootRenewalTable(document.getElementById('renewal-table'));</script>`;
}

export function radarScript(): string {
  return `<script>${PREVIEW_JS}if(document.getElementById('radar-app'))bootRadar(document.getElementById('radar-app'));</script>`;
}

export function signupScript(): string {
  return `<script>${PREVIEW_JS}</script>`;
}
