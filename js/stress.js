/* ============================================================
   PLUTUS — Portfolio stress test page (#/stress) · v50
   The maths lives in js/stress-engine.js (window.PlutusRisk). Data: data/risk/ (scripts/build_risk.py, nightly);
   anything missing is fetched live from Yahoo / MFapi through the Worker. Holdings stay in this browser.
   Layout: 1) holdings (amounts or weights)  2) run  3) results — a summary on top, details in tabs.
   ============================================================ */
(function () {
  'use strict';
  const R = window.PlutusRisk;
  const CFG = window.APP_CONFIG || {};
  const P = () => window.PlutusApp || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const KEY = 'plutus.stress.v1';
  const SAMPLE = [['HDFCBANK.NS', 'HDFC Bank', 200000], ['RELIANCE.NS', 'Reliance Industries', 150000], ['TCS.NS', 'Tata Consultancy Services', 150000], ['ITC.NS', 'ITC', 100000], ['BAJFINANCE.NS', 'Bajaj Finance', 100000], ['SUNPHARMA.NS', 'Sun Pharmaceutical', 100000], ['LT.NS', 'Larsen & Toubro', 100000], ['POLYCAB.NS', 'Polycab India', 50000], ['DIXON.NS', 'Dixon Technologies', 50000]];
  const TABS = [['overview', 'Overview'], ['crashes', 'Past crashes'], ['shock', 'What if…'], ['risk', 'Risk numbers'], ['liq', 'Selling'], ['mc', 'Next 12 months'], ['data', 'Data and method']];

  const st = { list: load(), out: null, charts: [], mcSeq: 0, pick: null, pending: null, tab: 'overview', drawn: new Set(), conf: 0.99, shock: { NIFTY: -0.2, s1: '', v1: 0, s2: '', v2: 0, FX: 0, OIL: 0 }, scen: '' };

  /* ---------------------------------------------------------------- storage + sharing */
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.s && x.v > 0) : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st.list.map(({ kind, s, n, mode, v, code }) => ({ kind, s, n, mode, v, code })))); } catch (e) { /* private mode */ } }
  const b64 = { enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
  function shareHash() { return '#/stress/' + b64.enc(JSON.stringify(st.list.map((x) => [x.kind, x.s, x.mode, x.v, x.n, x.code || '']))); }
  function fromHash(arg) {
    try { return JSON.parse(b64.dec(arg)).map(([kind, s, mode, v, n, code]) => ({ kind, s, mode, v: +v, n, code: code || undefined })).filter((x) => x.s && x.v > 0); } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- formatting (negatives in brackets) */
  const inr = (v, d) => Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  const br = (s, v) => (v < 0 ? `(${s})` : s);
  const pc = (x, d) => { if (!isNum(x)) return '—'; d = d == null ? 0 : d; const r = +(x * 100).toFixed(d); return br(`${Math.abs(r).toFixed(d)}%`, r); };
  const pcLoss = (x, d) => (isNum(x) ? `${Math.abs(+(x * 100).toFixed(d == null ? 0 : d)).toFixed(d == null ? 0 : d)}%` : '—'); // a loss already named as a loss
  const rs = (v) => (isNum(v) ? br(`₹${inr(v)}`, Math.round(v)) : '—');
  function rsShort(v, plain) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v), s = a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${inr(a)}`;
    return plain ? s : br(s, Math.round(v));
  }
  const days = (d) => (!isNum(d) ? '—' : d < 1 ? 'Under a day' : `${Math.ceil(d)} trading day${Math.ceil(d) > 1 ? 's' : ''}`);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = (d) => (d ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '—');
  const mon = (d) => (d ? `${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '—');

  /* ---------------------------------------------------------------- data */
  const bust = () => Math.floor(Date.now() / 3600e3);
  const rawBase = () => (CFG.REPORTS_RAW ? String(CFG.REPORTS_RAW).replace(/data\/reports\/?$/, 'data/risk/') : '');
  const okJSON = (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  async function siteJSON(path) {
    try { return await fetch(`data/risk/${path}`, { cache: 'no-cache' }).then(okJSON); } catch (e) {
      if (!rawBase()) throw e;
      return fetch(rawBase() + path).then(okJSON);
    }
  }
  const viaWorker = (u) => (CFG.WORKER_URL ? `${String(CFG.WORKER_URL).replace(/\/?$/, '/')}?url=${encodeURIComponent(u)}` : u);
  async function yahooDaily(ticker) {
    const p2 = Math.floor(Date.now() / 1000) + 86400;
    const u = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=1072915200&period2=${p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
    const j = await fetch(viaWorker(u)).then(okJSON);
    const r = j && j.chart && j.chart.result && j.chart.result[0];
    if (!r || !r.timestamp) throw new Error('no prices');
    const q = (r.indicators.quote || [{}])[0], adj = ((r.indicators.adjclose || [{}])[0] || {}).adjclose, cl = adj || q.close || [];
    const closes = [], vols = [];
    r.timestamp.forEach((t, i) => {
      const c = cl[i]; if (!isNum(c) || c <= 0) return;
      const d = new Date((t + 19800) * 1000).toISOString().slice(0, 10);
      if (closes.length && closes[closes.length - 1][0] === d) { closes[closes.length - 1] = [d, c]; vols[vols.length - 1] = q.volume && q.volume[i]; } else { closes.push([d, c]); vols.push(q.volume && q.volume[i]); }
    });
    return { closes, vols };
  }
  const avg = (xs) => { const v = xs.filter((x) => isNum(x) && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const toFrac = (o, r) => ({ o, r: r.map(R.bp) });

  let CAL = null;
  function calendar() {
    if (CAL) return CAL;
    CAL = siteJSON(`factors.json?t=${bust()}`)
      .then((j) => ({ dates: j.dates, f: Object.fromEntries(Object.entries(j.f).map(([k, a]) => [k, toFrac(0, a)])), names: j.names || {}, built: j.built, live: false }))
      .catch(async () => { // the nightly job hasn't run yet: build a market-only calendar live
        console.warn('[PLUTUS stress] data/risk/factors.json missing — run Actions → "Build stress test data". Using live Yahoo data for now.');
        const n = await yahooDaily('^NSEI'); const dates = n.closes.map((c) => c[0]);
        const f = { NIFTY: R.alignCloses(n.closes, dates) };
        try { const fx = await yahooDaily('INR=X'); f.FX = R.alignCloses(fx.closes, dates); } catch (e) { /* optional */ }
        Object.values(f).forEach((s) => { const pad = Array(s.o).fill(null); s.r = pad.concat(s.r).map(R.bp); s.o = 0; });
        return { dates, f, names: { NIFTY: 'Nifty 50', FX: 'USD/INR' }, live: true };
      })
      .catch((e) => { CAL = null; throw e; });
    return CAL;
  }
  let UNI = null;
  function universe() {
    if (UNI) return UNI;
    UNI = fetch(`data/screen/universe.json?t=${bust()}`, { cache: 'no-cache' }).then(okJSON)
      .then((j) => { const m = new Map(); j.rows.forEach((a) => { const r = Object.fromEntries(j.fields.map((f, i) => [f, a[i]])); m.set(r.s, r); }); return m; })
      .catch(() => new Map());
    return UNI;
  }
  async function mfFetch(path) {
    const u = `https://api.mfapi.in/mf/${path}`;
    try { return await fetch(u).then(okJSON); } catch (e) { return fetch(viaWorker(u)).then(okJSON); }
  }

  const memo = new Map();
  async function loadSeries(item, cal) {
    const k = item.kind + ':' + (item.code || item.s);
    if (memo.has(k)) return memo.get(k);
    const p = (async () => {
      if (item.kind === 'mf') {
        const j = await mfFetch(encodeURIComponent(item.code));
        const closes = (j.data || []).map((x) => { const [d, m, y] = String(x.date).split('-'); return [`${y}-${m}-${d}`, parseFloat(x.nav)]; }).filter((x) => isNum(x[1]) && x[1] > 0).reverse();
        if (closes.length < 30) throw new Error('no NAV history');
        const a = R.alignCloses(closes, cal.dates);
        return { ...toFrac(a.o, a.r), px: closes[closes.length - 1][1], asof: closes[closes.length - 1][0], sec: 'Mutual funds', ind: (j.meta && j.meta.scheme_category) || '', n: (j.meta && j.meta.scheme_name) || item.n };
      }
      const uni = await universe(), u = uni.get(item.s) || {};
      try {
        const j = await siteJSON(`s/${encodeURIComponent(item.s.replace(/\//g, '_'))}.json?t=${bust()}`);
        return { ...toFrac(j.o, j.r), adv3: j.adv3, adv12: j.adv12, px: j.px, asof: j.asof, sec: j.sec || u.sec, ind: j.ind || u.ind, n: u.n || (j.n && j.n !== item.s ? j.n : '') || item.n };
      } catch (e) {
        const y = await yahooDaily(item.s);
        if (y.closes.length < 20) throw new Error('no prices');
        const a = R.alignCloses(y.closes, cal.dates);
        return { ...toFrac(a.o, a.r), adv3: avg(y.vols.slice(-63)), adv12: avg(y.vols.slice(-250)), px: y.closes[y.closes.length - 1][1], asof: y.closes[y.closes.length - 1][0], sec: u.sec || '', ind: u.ind || '', n: u.n || item.n };
      }
    })();
    memo.set(k, p); p.catch(() => memo.delete(k));
    return p;
  }
  // the latest price only — so share and unit counts can show a ₹ value and a weight before the test runs
  const pxMemo = new Map();
  function ensurePx(item) {
    if (item.px || item.mode !== 'qty') return;
    const k = item.kind + ':' + (item.code || item.s); if (pxMemo.has(k)) return;
    pxMemo.set(k, true);
    (async () => {
      let px = null;
      if (item.kind === 'mf') { try { const j = await mfFetch(`${encodeURIComponent(item.code)}/latest`); px = parseFloat(j.data && j.data[0] && j.data[0].nav); } catch (e) { /* later */ } }
      else {
        try { px = (await siteJSON(`s/${encodeURIComponent(item.s)}.json?t=${bust()}`)).px; } catch (e) {
          try { const u = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.s)}?range=5d&interval=1d`; const j = await fetch(viaWorker(u)).then(okJSON); px = j.chart.result[0].meta.regularMarketPrice; } catch (e2) { /* later */ }
        }
      }
      if (isNum(px) && px > 0) { st.list.filter((x) => (x.code || x.s) === (item.code || item.s)).forEach((x) => { x.px = px; }); refreshList(); } else pxMemo.delete(k);
    })();
  }

  /* ---------------------------------------------------------------- page shell */
  function shell() {
    const v = $('#viewStress'); if (v.dataset.ready) return;
    v.dataset.ready = '1';
    v.innerHTML = `
      <section class="sx-head st-head">
        <p class="eyebrow">Portfolio stress test</p>
        <h1>How would your portfolio hold up in a crash?</h1>
        <ol class="st-steps" aria-label="How it works"><li><b>1</b>Add what you own</li><li><b>2</b>Run the test</li><li><b>3</b>See what could go wrong — and why</li></ol>
      </section>
      <section class="st-panel" id="stEdit" aria-labelledby="stEditH">
        <div class="st-panel-h"><h2 id="stEditH">Your holdings</h2><span class="st-count" id="stCount"></span></div>
        <div class="st-add">
          <div class="st-search"><input id="stQ" type="text" autocomplete="off" spellcheck="false" placeholder="Search a stock you own — e.g. HDFC Bank" aria-label="Search a stock you own" /><ul class="suggest" id="stSug" role="listbox"></ul></div>
          <div class="st-seg" id="stMode" role="radiogroup" aria-label="Enter as"><button type="button" class="on" data-m="amt" role="radio" aria-checked="true">₹ value</button><button type="button" data-m="qty" role="radio" aria-checked="false">Shares</button></div>
          <label class="st-minput st-addamt"><span id="stAmtPre">₹</span><input id="stAmt" type="number" min="0" step="any" inputmode="decimal" placeholder="1,00,000" aria-label="Value" /></label>
          <button type="button" class="sx-run st-addbtn" id="stAdd">Add</button>
        </div>
        <div class="st-err hidden" id="stErr" role="alert"></div>
        <div class="st-quick"><span>Or</span>
          <label class="sx-btn st-file">Import your broker's holdings (CSV)<input type="file" id="stCsv" accept=".csv,text/csv" hidden /></label>
          <button type="button" class="sx-btn" id="stMf" aria-expanded="false">Add a mutual fund</button>
          <button type="button" class="sx-btn" id="stDemo">Use a sample portfolio</button>
        </div>
        <div class="st-mfbox hidden" id="stMfBox">
          <div class="st-search"><input id="stMfQ" type="text" autocomplete="off" placeholder="Fund name — e.g. Parag Parikh Flexi Cap Direct Growth" aria-label="Find a mutual fund" /><ul class="suggest st-mfsug" id="stMfSug" role="listbox"></ul></div>
        </div>
        <div id="stList"></div>
        <div class="st-runrow"><button type="button" class="sx-run st-runbtn" id="stRun">Run stress test</button><span class="st-hint" id="stHint"></span></div>
      </section>
      <section id="stRes" class="st-res" aria-live="polite"></section>`;
    wireEditor();
  }

  /* ---------------------------------------------------------------- editor */
  function err(msg, soft) { const e = $('#stErr'); if (!e) return; e.textContent = msg || ''; e.classList.toggle('hidden', !msg); e.classList.toggle('soft', !!soft); }
  let addMode = 'amt';
  function wireEditor() {
    const q = $('#stQ'), amt = $('#stAmt');
    const pick = (it) => { st.pick = { s: it.symbol, n: it.name || it.symbol }; q.value = st.pick.n; err(''); amt.focus(); };
    if (P().attachSearch) P().attachSearch(q, $('#stSug'), pick);
    q.addEventListener('input', () => { st.pick = null; });
    $('#stMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return; addMode = b.dataset.m;
      $$('#stMode button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      $('#stAmtPre').textContent = addMode === 'qty' ? 'Shares' : '₹'; amt.placeholder = addMode === 'qty' ? '50' : '1,00,000'; amt.focus();
    });
    const add = () => {
      const v = parseFloat(amt.value);
      let it = st.pick;
      if (!it && q.value.trim()) { const t = q.value.trim().toUpperCase(); if (/^[A-Z0-9&\-.]{2,20}$/.test(t)) it = { s: /\./.test(t) ? t : t + '.NS', n: t }; }
      if (!it) return err('Pick a company from the list first.');
      if (!(v > 0)) return err(addMode === 'qty' ? 'Enter how many shares you hold.' : 'Enter the value of this holding.');
      const ex = st.list.find((x) => x.kind === 'eq' && x.s === it.s);
      if (ex && ex.mode === addMode) ex.v += v; else if (ex) { ex.mode = addMode; ex.v = v; } else st.list.push({ kind: 'eq', s: it.s, n: it.n, mode: addMode, v });
      st.pick = null; q.value = ''; amt.value = ''; err(''); save(); renderList(); q.focus();
    };
    $('#stAdd').onclick = add;
    amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    amt.addEventListener('input', () => err(''));
    $('#stDemo').onclick = () => loadSample(true);
    $('#stRun').onclick = () => run();
    $('#stCsv').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(importCsv); e.target.value = ''; };
    $('#stMf').onclick = () => toggleMf();
    wireMf();
    const list = $('#stList');
    list.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.v != null) { const i = +t.dataset.v, v = parseFloat(t.value); if (!(v > 0)) removeAt(i); else { st.list[i].v = v; save(); refreshList(); } }
      else if (t.dataset.w != null) setWeight(+t.dataset.w, parseFloat(t.value));
      else if (t.id === 'stTotal') setTotal(parseFloat(String(t.value).replace(/,/g, '')));
    });
    list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); } });
    list.addEventListener('click', (e) => {
      if (e.target.closest('#stEqual')) equalWeights();
      if (e.target.closest('#stClear')) clearAll();
    });
  }
  function toggleMf(open) {
    const b = $('#stMfBox'), on = open == null ? b.classList.contains('hidden') : open;
    b.classList.toggle('hidden', !on); $('#stMf').setAttribute('aria-expanded', String(on)); if (on) $('#stMfQ').focus();
  }
  function loadSample(go) { st.list = SAMPLE.map(([s, n, v]) => ({ kind: 'eq', s, n, mode: 'amt', v })); save(); renderList(); err('This is a sample. Change any value or weight below — then run the test again.', true); if (go) run(); }
  function removeAt(i) { const x = st.list.splice(i, 1)[0]; save(); renderList(); if (x) err(`Removed ${x.n}.`, true); }
  function clearAll() {
    if (!st.list.length) return;
    st.list = []; save(); renderList(); destroyCharts(); st.out = null;
    $('#stRes').innerHTML = ''; err(''); history.replaceState(null, '', '#/stress');
  }
  // ₹ value of a row: exact for ₹ rows; shares / units × the latest price once it's known
  const rowVal = (x) => (x.mode === 'amt' ? x.v : isNum(x.px) ? x.v * x.px : null);
  function totals() { const vals = st.list.map(rowVal); return { vals, tot: vals.every(isNum) ? vals.reduce((a, b) => a + b, 0) : null }; }
  function toAmt(x, val) { x.mode = 'amt'; x.v = Math.max(1, Math.round(val)); }
  function setWeight(i, w) {
    const { vals, tot } = totals(); if (!tot) return;
    if (!(w >= 0)) { refreshList(); return; }
    if (w <= 0) { removeAt(i); return; }
    w = Math.min(100, w) / 100;
    const old = vals[i] / tot, rest = 1 - old;
    if (st.list.length === 1 || rest <= 0) { refreshList(); return; }
    const k = (1 - w) / rest; // the other holdings shrink or grow together so the weights still add up to 100%
    st.list.forEach((x, j) => toAmt(x, j === i ? w * tot : vals[j] * k));
    save(); refreshList();
  }
  function setTotal(t) { const { vals, tot } = totals(); if (!tot || !(t > 0)) { refreshList(); return; } st.list.forEach((x, j) => toAmt(x, (vals[j] / tot) * t)); save(); refreshList(); }
  function equalWeights() { const { tot } = totals(); if (!tot) return; st.list.forEach((x) => toAmt(x, tot / st.list.length)); save(); refreshList(); }

  function renderList() {
    const el = $('#stList'); if (!el) return;
    st.list.forEach(ensurePx);
    if (!st.list.length) {
      el.innerHTML = '<div class="st-empty"><b>No holdings yet.</b><span>Search a stock above, import your broker\'s holdings file, or start from the sample portfolio.</span></div>';
      $('#stCount').textContent = ''; $('#stHint').textContent = ''; $('#stRun').disabled = false; return;
    }
    el.innerHTML = `
      <div class="st-listbar">
        <label class="st-totlab">Portfolio value <span class="st-minput sm"><span>₹</span><input id="stTotal" type="text" inputmode="numeric" aria-label="Total portfolio value" /></span></label>
        <div class="st-listtools"><button type="button" class="sx-btn" id="stEqual" title="Give every holding the same weight">Equal weights</button><button type="button" class="sx-btn st-danger" id="stClear">Clear all</button></div>
      </div>
      <table class="nt st-tbl st-hold"><thead><tr><th class="l">Holding</th><th>Value</th><th>Weight</th></tr></thead><tbody>${st.list.map((x, i) => `
        <tr><td class="l"><b>${esc(x.n)}</b><span class="st-sym">${esc(x.kind === 'mf' ? 'Mutual fund' : x.s.replace(/\.(NS|BO)$/, ''))}</span></td>
        <td><span class="st-amt">${x.mode === 'qty' ? '' : '₹'}<input type="number" min="0" step="any" value="${x.v}" data-v="${i}" aria-label="Value of ${esc(x.n)}" />${x.mode === 'qty' ? `<em>${x.kind === 'mf' ? 'units' : 'shares'}</em>` : ''}</span><span class="st-rowval" data-rv="${i}"></span></td>
        <td><span class="st-amt"><input type="number" min="0" max="100" step="0.1" data-w="${i}" aria-label="Weight of ${esc(x.n)} in percent" /><em>%</em></span></td></tr>`).join('')}</tbody></table>
      <p class="st-tip">Change a value or a weight and press Enter. Changing a weight keeps the total the same; set a value or weight to 0 to remove a holding.</p>`;
    refreshList();
  }
  function refreshList() { // update numbers in place, so typing isn't interrupted
    const { vals, tot } = totals(), focus = document.activeElement;
    st.list.forEach((x, i) => {
      const vi = $(`[data-v="${i}"]`); if (vi && vi !== focus) vi.value = x.mode === 'amt' ? Math.round(x.v) : x.v;
      const rv = $(`[data-rv="${i}"]`); if (rv) rv.textContent = x.mode === 'qty' ? (isNum(vals[i]) ? `≈ ${rsShort(vals[i], true)}` : 'price loading…') : '';
      const wi = $(`[data-w="${i}"]`); if (wi) { wi.disabled = !tot; if (wi !== focus) wi.value = tot ? ((vals[i] / tot) * 100).toFixed(1) : ''; }
    });
    const ti = $('#stTotal'); if (ti) { ti.disabled = !tot; if (ti !== focus) ti.value = tot ? Math.round(tot).toLocaleString('en-IN') : ''; }
    $('#stCount').textContent = st.list.length ? `${st.list.length} holding${st.list.length > 1 ? 's' : ''}` : '';
    $('#stHint').textContent = tot ? `Total ${rsShort(tot, true)}` : st.list.length ? 'Loading prices for share counts…' : '';
  }

  /* ---------------------------------------------------------------- mutual funds */
  function wireMf() {
    const q = $('#stMfQ'), ul = $('#stMfSug'); let t = null, seq = 0, act = -1;
    const rank = (n) => (/direct/i.test(n) ? 2 : 0) + (/growth/i.test(n) ? 1 : 0) - (/idcw|dividend|bonus/i.test(n) ? 1 : 0);
    const choose = (li) => { ul.classList.remove('open'); mfModal(li.dataset.code, li.dataset.n); };
    q.addEventListener('keydown', (e) => {
      const items = $$('li[data-code]', ul); if (!ul.classList.contains('open') || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items.forEach((li, i) => li.classList.toggle('active', i === act)); items[act].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); choose(items[act]); }
      else if (e.key === 'Escape') ul.classList.remove('open');
    });
    q.addEventListener('input', () => {
      clearTimeout(t); const s = q.value.trim(); if (s.length < 3) { ul.classList.remove('open'); return; }
      t = setTimeout(async () => {
        const my = ++seq; let j = [];
        try { j = await mfFetch(`search?q=${encodeURIComponent(s)}`); } catch (e) { j = []; }
        if (my !== seq) return;
        const words = s.toLowerCase().split(/\s+/).filter(Boolean);
        const mark = (x) => esc(x).replace(new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'), '<mark>$1</mark>');
        const list = (j || []).slice().sort((a, b) => rank(b.schemeName) - rank(a.schemeName)).slice(0, 15);
        ul.innerHTML = list.map((f, i) => { const [name, ...rest] = String(f.schemeName).split(/\s+-\s+/); return `<li role="option" data-i="${i}" data-code="${esc(f.schemeCode)}" data-n="${esc(f.schemeName)}"><span class="s-main"><span class="s-name">${mark(name)}</span>${rest.length ? `<span class="s-sub">${esc(rest.join(' · '))}</span>` : ''}</span></li>`; }).join('') || '<li class="s-info">No fund matches that name.</li>';
        ul.classList.add('open'); act = -1;
      }, 300);
    });
    ul.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-code]'); if (!li) return; e.preventDefault(); choose(li); });
    q.addEventListener('blur', () => setTimeout(() => ul.classList.remove('open'), 150));
  }
  function mfModal(code, name) {
    const old = $('#stModal'); if (old) old.remove();
    const back = document.activeElement, m = document.createElement('div');
    m.id = 'stModal'; m.className = 'st-modal';
    m.innerHTML = `<div class="st-dialog" role="dialog" aria-modal="true" aria-labelledby="stMTitle">
        <p class="eyebrow">Add a mutual fund</p>
        <h3 id="stMTitle">${esc(name)}</h3>
        <div class="st-mrow">
          <div class="st-seg" role="radiogroup" aria-label="Enter as"><button type="button" class="on" data-m="amt" role="radio" aria-checked="true">₹ value now</button><button type="button" data-m="qty" role="radio" aria-checked="false">Units</button></div>
          <label class="st-minput"><span id="stMPre">₹</span><input id="stMAmt" type="number" min="0" step="any" inputmode="decimal" placeholder="100000" aria-label="Amount" /></label>
        </div>
        <p class="st-merr hidden" id="stMErr" role="alert"></p>
        <p class="st-mhint" id="stMHint">The current value of your holding in this fund, as shown in your app or statement.</p>
        <div class="st-mact"><button type="button" class="sx-btn" id="stMCancel">Cancel</button><button type="button" class="sx-run" id="stMOk">Add fund</button></div>
      </div>`;
    document.body.appendChild(m);
    let mode = 'amt';
    const inp = $('#stMAmt'), errEl = $('#stMErr');
    const close = () => { m.remove(); document.removeEventListener('keydown', key, true); const mq = $('#stMfQ'); if (mq) mq.value = ''; if (back && back.focus) back.focus(); };
    const ok = () => {
      const v = parseFloat(inp.value);
      if (!(v > 0)) { errEl.textContent = mode === 'qty' ? 'Enter the number of units, above zero.' : 'Enter an amount above zero.'; errEl.classList.remove('hidden'); inp.focus(); return; }
      const ex = st.list.find((x) => x.kind === 'mf' && x.code === String(code));
      if (ex) { ex.mode = mode; ex.v = v; } else st.list.push({ kind: 'mf', s: 'MF' + code, code: String(code), n: name, mode, v });
      save(); renderList(); close();
    };
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); ok(); }
      else if (e.key === 'Tab') { const f = $$('button, input', m), i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    }
    document.addEventListener('keydown', key, true);
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    $('#stMCancel').onclick = close; $('#stMOk').onclick = ok;
    inp.addEventListener('input', () => errEl.classList.add('hidden'));
    $('.st-seg', m).addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m;
      $$('.st-seg button', m).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      $('#stMPre').textContent = mode === 'qty' ? 'Units' : '₹'; inp.placeholder = mode === 'qty' ? '250.5' : '100000';
      $('#stMHint').textContent = mode === 'qty' ? 'The number of units you hold. Its value is worked out from the latest NAV.' : 'The current value of your holding in this fund, as shown in your app or statement.';
      inp.focus();
    });
    setTimeout(() => inp.focus(), 30);
  }

  /* ---------------------------------------------------------------- CSV import (Zerodha, Groww, Upstox, generic) */
  function csvRows(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
      if (c === '"') q = true; else if (c === ',' || c === '\t' || c === ';') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
  }
  async function importCsv(text) {
    const rows = csvRows(text);
    const hi = rows.findIndex((r) => r.some((c) => /instrument|symbol|scrip|stock|company|security/i.test(c)));
    if (hi < 0) return err('That file has no stock or symbol column. Export "Holdings" from your broker as CSV and try again.');
    const H = rows[hi].map((c) => c.toLowerCase()), col = (re) => H.findIndex((c) => re.test(c));
    const cs = col(/^(instrument|symbol|tradingsymbol|trading symbol|scrip|stock symbol|nse symbol)/), cn = col(/(stock name|company|security name|name)/);
    const cq = col(/^(qty|quantity|shares|available qty|total qty|quantity available|qty\.)/), cv = col(/(cur\.? ?val|current value|present value|market value|closing value)/);
    const uni = await universe(), byName = [...uni.values()];
    let ok = 0, skip = 0;
    for (const r of rows.slice(hi + 1)) {
      let sym = cs >= 0 ? r[cs] : '', name = cn >= 0 ? r[cn] : '';
      sym = sym.replace(/-(EQ|BE|BZ)$/i, '').toUpperCase();
      if (!sym && name) { const n = name.toLowerCase(); const m = byName.find((u) => String(u.n || '').toLowerCase().startsWith(n.slice(0, 14))); if (m) sym = m.s; }
      if (!sym || /total/i.test(sym)) { skip++; continue; }
      if (!/\./.test(sym)) sym += '.NS';
      const qty = cq >= 0 ? parseFloat(String(r[cq]).replace(/,/g, '')) : NaN, val = cv >= 0 ? parseFloat(String(r[cv]).replace(/[,₹]/g, '')) : NaN;
      const it = isNum(qty) && qty > 0 ? { mode: 'qty', v: qty } : isNum(val) && val > 0 ? { mode: 'amt', v: val } : null;
      if (!it) { skip++; continue; }
      const ex = st.list.find((x) => x.s === sym);
      if (ex) Object.assign(ex, it); else st.list.push({ kind: 'eq', s: sym, n: (uni.get(sym) || {}).n || name || sym.replace(/\.NS$/, ''), ...it });
      ok++;
    }
    save(); renderList();
    if (ok) err(`Imported ${ok} holding${ok > 1 ? 's' : ''}${skip ? `; skipped ${skip} row${skip > 1 ? 's' : ''} without a quantity or value` : ''}.`, true);
    else err('No holdings with a quantity or value were found in that file.');
  }

  /* ---------------------------------------------------------------- run */
  let runSeq = 0;
  async function run() {
    if (!st.list.length) { err('Add at least one holding first.'); return; }
    const my = ++runSeq, res = $('#stRes'), btn = $('#stRun');
    btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
    destroyCharts(); st.drawn.clear();
    res.innerHTML = `<div class="sx-load" role="status"><div class="sx-load-top"><div class="orbit sm"><span></span></div><div><b id="stStep">Loading market history…</b><span>Twenty years of daily prices for each holding, the market, sectors, the rupee and crude</span></div></div><div class="sx-skel" aria-hidden="true">${'<i></i>'.repeat(5)}</div></div>`;
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const done = () => { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); };
    let cal;
    try { cal = await calendar(); } catch (e) {
      done(); console.warn('[PLUTUS stress]', e);
      res.innerHTML = '<div class="sx-empty"><h2>Market history couldn\'t be loaded right now.</h2><p>Please try again in a minute.</p></div>'; return;
    }
    const step = $('#stStep'); let n = 0; const fails = [];
    const loaded = await Promise.all(st.list.map(async (it) => {
      try { const s = await loadSeries(it, cal); if (step && my === runSeq) step.textContent = `Loading holdings… ${++n} of ${st.list.length}`; return { it, s }; } catch (e) { console.warn('[PLUTUS stress]', it.s, e); fails.push(it.n); return null; }
    }));
    if (my !== runSeq) return;
    const hs = [];
    loaded.filter(Boolean).forEach(({ it, s }) => {
      it.px = s.px;
      const value = it.mode === 'qty' ? it.v * (s.px || 0) : it.v;
      if (!(value > 0)) return;
      const fk = it.kind === 'mf' ? '' : R.sectorKey(s.sec, s.ind);
      hs.push({ ...s, kind: it.kind, s: it.s, n: s.n || it.n, value, fk: cal.f[fk] ? fk : '', secName: s.sec || 'Other', item: it });
    });
    refreshList();
    if (!hs.length) { done(); res.innerHTML = '<div class="sx-empty"><h2>None of these holdings could be loaded.</h2><p>Check the names and try again.</p></div>'; return; }
    if (step) step.textContent = 'Running 10 crash scenarios and the risk models…';
    await new Promise((r) => setTimeout(r, 30));
    const Pf = { holdings: hs, total: hs.reduce((a, h) => a + h.value, 0) };
    hs.forEach((h) => { h.beta = R.fit(h, cal); h.dq = quality(h, cal); });
    const full = R.portfolioDaily(Pf, cal, cal.dates.length, true); // since 2004 (estimates before a stock listed)
    const K = Math.min(2500, full.r.length);
    const daily = { r: full.r.slice(-K), nifty: full.nifty.slice(-K), dates: full.dates.slice(-K), comp: full.comp.map((c) => c.slice(-K)) };
    const out = {
      cal, Pf, fails, daily, full,
      scen: R.runScenarios(Pf, cal), sens: R.sensitivity(Pf),
      risk: { 0.95: R.riskTable(daily.r, [1, 10, 21], 0.95), 0.99: R.riskTable(daily.r, [1, 10, 21], 0.99) },
      kup: R.kupiec(daily.r, 0.99, 500), svar: R.stressedVaR(full.r, full.dates, 0.99, 250), dd: R.drawdown(full.r, full.dates),
      contrib: R.contributions(Pf, daily, 0.99), conc: R.concentration(Pf),
      crash: R.crashCheck(Pf, cal, 2500), liq: R.liquidity(Pf, 'adv3'), liq12: R.liquidity(Pf, 'adv12')
    };
    out.vs = R.vsMarket(out.scen);
    out.text = R.explain(Pf, out.scen);
    st.out = out; done();
    history.replaceState(null, '', shareHash());
    render(out);
    monteCarlo(out);
  }
  // data checks per holding, shown in "Data and method"
  function quality(h, cal) {
    const flags = [], last = h.r.slice(-250).filter((x) => x != null), zero = last.length ? last.filter((x) => x === 0).length / last.length : 0;
    const start = cal.dates[h.o || 0], years = (cal.dates.length - (h.o || 0)) / 250;
    if (years < 3) flags.push('Short history');
    if (zero > 0.2) flags.push('Thinly traded');
    if (h.asof && cal.dates.length && h.asof < cal.dates[Math.max(0, cal.dates.length - 6)]) flags.push('Price may be stale');
    if (h.beta && h.beta.dflt) flags.push('Too little data: market beta of 1 assumed');
    return { start, years, flags };
  }

  /* ---------------------------------------------------------------- results */
  function destroyCharts() { st.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* gone */ } }); st.charts = []; }
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || f;
  const tip = (t) => `<span class="st-q" tabindex="0" role="note" aria-label="${esc(t)}" data-q="${esc(t)}">?</span>`;
  function render(o) {
    const res = $('#stRes'), sc = o.scen.filter((s) => s.ret != null);
    const worst = sc.length ? sc.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
    const r1 = o.risk[0.99][0], r30 = o.risk[0.99][2];
    const est = o.Pf.holdings.filter((h) => h.o > 0 && h.dq.start > '2008-01-08').length;
    if (!st.scen || !sc.find((s) => s.id === st.scen)) st.scen = worst ? worst.id : '';
    res.innerHTML = `
      <div class="st-summary">
        <div class="st-verdict">
          ${o.vs ? `<span class="st-badge lv${o.vs.level}">Risk compared with the market: ${esc(o.vs.label)}</span>
          <p>Across the long bear markets, your portfolio fell about <b>${o.vs.ratio.toFixed(1)}×</b> as much as the Nifty 50.</p>` : '<p>Here is how your portfolio would have done.</p>'}
        </div>
        <div class="st-cards">
          ${card('Worst past crash', worst ? pcLoss(worst.ret) : '—', worst ? `${esc(worst.name)}: ${rsShort(worst.pnl, true)} lost` : '', 'If the worst of the 10 crashes happened to what you own today.', true)}
          ${card('A bad day', pcLoss(r1.hist, 1), `${rsShort(r1.hist * o.Pf.total, true)} · 1 day in 100 is worse`, 'One-day value at risk at 99%, from the last 10 years of real daily moves.')}
          ${card('A bad month', pcLoss(r30.hist, 1), `${rsShort(r30.hist * o.Pf.total, true)} · 1 month in 100 is worse`, '30-day value at risk at 99% (21 trading days), from overlapping 21-day stretches of real history.')}
          ${card('Selling half', o.liq.d50 == null ? '—' : days(o.liq.d50), o.liq.d100 == null ? '' : `All of it: ${days(o.liq.d100).toLowerCase()}`, 'How long it takes to sell without moving prices much, by SEBI\'s mutual fund method.')}
        </div>
        ${o.text.length ? `<div class="st-explain"><h3>What this means</h3>${o.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
        ${o.fails.length ? `<p class="st-note warn">Left out (no price history found): ${o.fails.map(esc).join(', ')}.</p>` : ''}
        ${o.cal.live ? '<p class="st-note warn">Sector, crude and full history files are still being prepared, so this run uses the market and the rupee only.</p>' : ''}
      </div>
      <div class="st-tabs" role="tablist" aria-label="Stress test details">${TABS.map(([id, label]) => `<button type="button" role="tab" id="stTab-${id}" aria-controls="stPane-${id}" aria-selected="${id === st.tab}" class="${id === st.tab ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      ${pane('overview', overviewHTML(o))}
      ${pane('crashes', crashesHTML(o, est))}
      ${pane('shock', shockHTML(o))}
      ${pane('risk', riskHTML(o))}
      ${pane('liq', liqHTML(o))}
      ${pane('mc', `<p class="st-lead">Thousands of possible next years, each stitched together from 10-day stretches of your holdings' real history — so calm and stormy spells both show up. It's a range of what has been possible, not a forecast.</p><div id="stMc"><div class="sx-wait"><div class="orbit sm"><span></span></div><span>Simulating…</span></div></div>`)}
      ${pane('data', dataHTML(o))}
      <div class="st-foot">
        <button type="button" class="sx-btn" id="stPrint">Save as PDF</button>
        <button type="button" class="sx-btn" id="stShare">Copy share link</button>
        <p>Past crashes show what happened, not what will happen. Figures for holdings that weren't listed at the time are estimates. This is an educational tool, not investment advice, and it doesn't recommend buying, selling or holding any security.</p>
      </div>`;
    wireTabs(o);
    $('#stPrint').onclick = () => { TABS.forEach(([id]) => drawTab(id, o)); setTimeout(() => window.print(), 300); };
    $('#stShare').onclick = async () => { const u = location.href.split('#')[0] + shareHash(); try { await navigator.clipboard.writeText(u); $('#stShare').textContent = 'Link copied'; } catch (e) { prompt('Copy this link', u); } setTimeout(() => { const b = $('#stShare'); if (b) b.textContent = 'Copy share link'; }, 2000); };
    res.classList.remove('sx-in'); void res.offsetWidth; res.classList.add('sx-in');
  }
  function card(label, big, sub, help, main) { return `<div class="st-card${main ? ' main' : ''}"><span>${esc(label)} ${tip(help)}</span><b>${big}</b><em>${sub}</em></div>`; }
  const pane = (id, html) => `<section class="st-pane${id === st.tab ? '' : ' hidden'}" role="tabpanel" id="stPane-${id}" aria-labelledby="stTab-${id}" data-pane="${id}">${html}</section>`;
  function wireTabs(o) {
    const bar = $('.st-tabs');
    const go = (id, focus) => {
      st.tab = id;
      $$('.st-tabs [data-tab]').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      $$('.st-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== id));
      drawTab(id, o);
    };
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault();
      const i = TABS.findIndex(([id]) => id === st.tab); go(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0], true);
    });
    $$('.st-tabs [data-tab]').forEach((b) => { b.tabIndex = b.dataset.tab === st.tab ? 0 : -1; });
    drawTab(st.tab, o);
  }
  function drawTab(id, o) { // charts are drawn when their tab first opens (a hidden canvas has no size)
    if (st.drawn.has(id)) return; st.drawn.add(id);
    if (id === 'overview') wireReverse(o);
    if (id === 'crashes') { drawScenarioChart(o); drawContrib(o); drawHeat(o); $('#stScen').onchange = (e) => { st.scen = e.target.value; drawContrib(o); }; }
    if (id === 'shock') { wireShock(o); drawSens(o); }
    if (id === 'risk') { $('#stConf').onchange = (e) => { st.conf = +e.target.value; $('#stRiskT').innerHTML = riskTable(o); }; }
    if (id === 'mc' && st.mcDone) st.mcDone();
  }

  /* ---- overview */
  function overviewHTML(o) {
    const c = o.conc, top = o.contrib.slice(0, 8), maxS = Math.max(...top.map((x) => Math.abs(x.share)), 0.01);
    return `
      <h2 class="st-h">Where the risk comes from ${tip('Each holding\'s share of the losses on the portfolio\'s worst 1% of days over the last 10 years (component expected shortfall).')}</h2>
      <p class="st-lead">On the portfolio's worst days, these holdings caused most of the damage. A holding whose share of the losses is well above its weight carries more risk than its size suggests.</p>
      <table class="nt st-tbl st-contrib"><thead><tr><th class="l">Holding</th><th>Weight</th><th class="l st-barcol">Share of worst-day losses</th></tr></thead><tbody>
        ${top.map((x) => `<tr><td class="l">${esc(x.h.n)}${x.share > x.weight * 1.4 && x.share > 0.08 ? '<span class="st-est warn">above its weight</span>' : ''}</td><td>${pc(x.weight, 1)}</td><td class="l st-barcol"><span class="st-bar"><i style="width:${Math.max(2, Math.round((Math.abs(x.share) / maxS) * 100))}%"></i></span><b>${pc(x.share)}</b></td></tr>`).join('')}
      </tbody></table>
      <h2 class="st-h">How concentrated is it?</h2>
      <div class="st-cards st-cards-sm">
        ${card('Largest holding', pc(c.top.w), esc(c.top.h.n), 'The single biggest position as a share of the portfolio.')}
        ${card('Top 5 holdings', pc(c.top5), `of ${c.n} holdings`, 'How much of the money sits in the five biggest positions.')}
        ${card('Acts like', `${c.effN.toFixed(1)} stocks`, c.effN < c.n * 0.6 ? 'Uneven weights shrink your real diversification' : 'Weights are fairly even', 'Effective number of holdings (1 ÷ the sum of squared weights). Ten equal holdings act like 10; one big one and nine tiny ones act like far fewer.')}
        ${card('Biggest sector', pc(c.topSector[1]), esc(c.topSector[0]), 'Sector from screener.in. One sector above 40% means one bad news story can hit most of the money.')}
      </div>
      <h2 class="st-h">Does diversification hold in a crash?</h2>
      ${crashHTML(o.crash)}
      <h2 class="st-h">What would it take?</h2>
      <p class="st-lead">A reverse stress test: pick a loss you couldn't live with and see how big a market fall would cause it.</p>
      <div class="st-rev"><label>A loss of <input id="stRevIn" type="number" min="1" max="90" value="30" aria-label="Loss in percent" />%</label><div id="stRevOut"></div></div>
      <h2 class="st-h">The worst fall since 2004 ${tip('The deepest peak-to-trough fall of today\'s holdings, replayed day by day since 2004. Before a stock listed, its moves are estimated from the market and its sector.')}</h2>
      ${o.dd && o.dd.dd < 0 ? `<p class="st-big-line"><b>${pcLoss(o.dd.dd)}</b> from ${mon(o.dd.peak)} to ${mon(o.dd.trough)}. ${o.dd.recovered ? `It took until ${mon(o.dd.recovered)} to get back to the old high.` : 'It hasn\'t yet climbed back to that old high.'}</p>` : '<p class="st-lead">Not enough history.</p>'}`;
  }
  function crashHTML(c) {
    if (!c || !c.all || !c.crash) return '<p class="st-lead">Not enough shared trading history across these holdings to compare crash days with normal days.</p>';
    const f = (x) => (isNum(x) ? x.toFixed(2) : '—');
    const worse = c.crash.beta > c.all.beta + 0.1, together = c.n > 1 && c.crash.corr > c.all.corr + 0.1;
    return `<p class="st-lead">Compares the ${c.crash.days} days the Nifty fell 2% or more with all days. <b>Beta</b> is how much the portfolio moves for each 1% the market moves; <b>correlation</b> is how alike your holdings move (1 = identical).</p>
      <table class="nt st-tbl"><thead><tr><th class="l">Measure</th><th>All days</th><th>Crash days</th></tr></thead><tbody>
      <tr><td class="l">Portfolio beta to the Nifty</td><td>${f(c.all.beta)}</td><td>${f(c.crash.beta)}</td></tr>
      ${c.n > 1 ? `<tr><td class="l">Average correlation between holdings</td><td>${f(c.all.corr)}</td><td>${f(c.crash.corr)}</td></tr>` : ''}
      <tr><td class="l">Average portfolio day</td><td>${pc(c.all.avg, 2)}</td><td>${pc(c.crash.avg, 2)}</td></tr></tbody></table>
      <p class="st-note">${worse ? 'Your portfolio gets more sensitive to the market on bad days, so calm-day numbers understate crash risk.' : 'Your portfolio\'s sensitivity to the market stays about the same on bad days.'}${together ? ' Your holdings also move more alike in crashes, so diversification protects less exactly when you need it.' : ''}</p>`;
  }
  function wireReverse(o) {
    const go = () => {
      const L = Math.min(90, Math.max(1, +$('#stRevIn').value || 30)) / 100, r = R.reverse(o.Pf, L);
      const hit = o.scen.filter((s) => s.ret != null && s.ret <= -L * 0.8).map((s) => `${esc(s.name)} (${pcLoss(s.ret)})`);
      $('#stRevOut').innerHTML = r.nifty == null
        ? `<p>A market fall alone is unlikely to cause a ${Math.round(L * 100)}% loss: your portfolio moves only ${r.beta.toFixed(2)}% for each 1% the Nifty moves.</p>`
        : `<p>The Nifty would need to fall about <b>${Math.round(-r.nifty * 100)}%</b> (with sectors moving along with it). Your portfolio moves ${r.beta.toFixed(2)}% for each 1% the Nifty moves.</p><p class="st-note">${hit.length ? `Past crashes that came within 80% of that loss: ${hit.join(', ')}.` : 'None of the 10 past crashes came close to that loss for these holdings.'}</p>`;
    };
    $('#stRevIn').addEventListener('input', go); go();
  }

  /* ---- past crashes */
  function crashesHTML(o, est) {
    const sc = o.scen.filter((s) => s.ret != null);
    return `
      <p class="st-lead">What your current holdings would have done in each of 10 Indian market crashes, next to the Nifty 50.${est ? ' Holdings that weren\'t listed at the time are estimated from how they move with the market and their sector today; those rows show a likely range.' : ''}</p>
      <div class="st-chart"><canvas id="stScChart" aria-label="Portfolio versus Nifty in each crash"></canvas></div>
      <table class="nt st-tbl"><thead><tr><th class="l">Crash</th><th class="l">When</th><th>Your portfolio</th><th>In ₹</th><th>Nifty 50</th><th>Likely range ${tip('For crashes where some holdings are estimated: the range the portfolio\'s result falls in 9 times out of 10, given how far each estimate can be off.')}</th></tr></thead><tbody>
        ${o.scen.map((s) => `<tr><td class="l"><b>${esc(s.name)}</b><span class="st-sym">${esc(s.note)}</span></td><td class="l">${s.from ? (s.from === s.to ? dt(s.from) : `${mon(s.from)} – ${mon(s.to)}`) : 'Before the data starts'}</td><td>${pc(s.ret, 1)}</td><td>${rs(s.pnl)}</td><td>${pc(s.nifty, 1)}</td><td>${s.ret == null ? '—' : s.est && s.band > 0.002 ? `${pc(s.ret - s.band)} to ${pc(s.ret + s.band)}` : 'Exact'}</td></tr>`).join('')}
      </tbody></table>
      <h2 class="st-h">Loss by holding</h2>
      <p class="st-lead">Which holdings drive the loss in one crash. Use "−10%" to trim a holding and run the test again.</p>
      <label class="st-pick">Crash <select id="stScen">${sc.map((s) => `<option value="${s.id}"${s.id === st.scen ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div id="stContrib"></div>
      <h2 class="st-h">Loss by sector</h2>
      <p class="st-lead">Your sectors across every crash. Darker cells lost more.</p>
      <div class="st-scroll" id="stHeat"></div>`;
  }
  function chartBase() { if (P().setupChartDefaults) try { P().setupChartDefaults(); } catch (e) { /* ok */ } }
  function drawScenarioChart(o) {
    if (!window.Chart) return; chartBase();
    const sc = o.scen.filter((s) => s.ret != null), acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    st.charts.push(new Chart($('#stScChart'), {
      type: 'bar',
      data: { labels: sc.map((s) => s.name), datasets: [{ label: 'Your portfolio', data: sc.map((s) => +(s.ret * 100).toFixed(1)), backgroundColor: acc, borderRadius: 3 }, { label: 'Nifty 50', data: sc.map((s) => (s.nifty == null ? null : +(s.nifty * 100).toFixed(1))), backgroundColor: mut, borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { ticks: { callback: (v) => pc(v / 100) } }, y: { grid: { display: false } } } }
    }));
  }
  function drawContrib(o) {
    const s = o.scen.find((x) => x.id === st.scen), el = $('#stContrib'); if (!s || !el) return;
    const rows = s.rows.slice().sort((a, b) => a.pnl - b.pnl);
    el.innerHTML = `<table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Value now</th><th>Move</th><th>Loss in ₹</th><th>Share of loss</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="l"><b>${esc(r.h.n)}</b>${r.est ? `<span class="st-est" title="Not listed then — estimated">estimate</span>` : ''}</td><td>${rs(r.h.value)}</td><td>${pc(r.ret, 1)}</td><td>${rs(r.pnl)}</td><td>${s.pnl < 0 && r.pnl < 0 ? `${Math.round((r.pnl / s.pnl) * 100)}%` : '—'}</td><td><button type="button" class="st-trim" data-trim="${esc(r.h.item.code || r.h.s)}" title="Reduce this holding by 10% and run again">−10%</button></td></tr>`).join('')}
      <tr class="st-total"><td class="l">Portfolio</td><td>${rs(o.Pf.total)}</td><td>${pc(s.ret, 1)}</td><td>${rs(s.pnl)}</td><td></td><td></td></tr></tbody></table>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-trim]'); if (!b) return;
      const it = st.list.find((x) => (x.code || x.s) === b.dataset.trim); if (!it) return;
      it.v = Math.round(it.v * 0.9 * 100) / 100; save(); refreshList();
      const y = window.scrollY, tab = st.tab; run().then(() => { st.tab = tab; window.scrollTo(0, y); });
    };
  }
  function drawHeat(o) {
    const sc = o.scen.filter((s) => s.ret != null), secs = {};
    o.Pf.holdings.forEach((h) => { (secs[h.secName] = secs[h.secName] || { v: 0, hs: [] }).v += h.value; secs[h.secName].hs.push(h); });
    const names = Object.keys(secs).sort((a, b) => secs[b].v - secs[a].v);
    const cell = (x) => { if (!isNum(x)) return '<td>—</td>'; const a = Math.min(1, Math.max(0, -x / 0.5)); return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(a * 45)}%, transparent)">${pc(x)}</td>`; };
    $('#stHeat').innerHTML = `<table class="nt st-tbl st-heat"><thead><tr><th class="l">Sector</th><th>Weight</th>${sc.map((s) => `<th title="${esc(s.name)}">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>
      ${names.map((n) => { const g = secs[n]; return `<tr><td class="l">${esc(n)}</td><td>${Math.round((g.v / o.Pf.total) * 100)}%</td>${sc.map((s) => { const p = s.rows.filter((r) => g.hs.includes(r.h)).reduce((a, r) => a + r.pnl, 0); return cell(p / g.v); }).join('')}</tr>`; }).join('')}</tbody></table>`;
  }

  /* ---- what if */
  function shockHTML(o) {
    const secKeys = Object.keys(o.cal.f).filter((k) => !['NIFTY', 'FX', 'OIL'].includes(k));
    return `
      <p class="st-lead">Pick a ready-made scenario or set your own. Each holding moves by how it has actually reacted to the market, its sector, the rupee and crude over the last 3 years of weekly data.</p>
      <div class="st-presets">${R.PRESETS.map((p) => `<button type="button" class="sx-chip" data-pre="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <div class="st-shockgrid">
        <div class="st-shock">
          ${slider('NIFTY', 'Nifty 50', -60, 30)}
          <div class="st-srow"><select id="stS1" aria-label="First sector">${secOpts(secKeys, o.cal, st.shock.s1)}</select>${slider('v1', '', -60, 40, true)}</div>
          <div class="st-srow"><select id="stS2" aria-label="Second sector">${secOpts(secKeys, o.cal, st.shock.s2)}</select>${slider('v2', '', -60, 40, true)}</div>
          ${o.cal.f.FX ? slider('FX', 'Dollar vs rupee', -15, 30) : ''}
          ${o.cal.f.OIL ? slider('OIL', 'Brent crude', -60, 100) : ''}
          <p class="st-note">Dollar vs rupee: up means a weaker rupee. A sector left as "Sector…" moves along with the market.</p>
        </div>
        <div id="stShockOut" class="st-shockout"></div>
      </div>
      <h2 class="st-h">How the loss grows</h2>
      <p class="st-lead">Your portfolio's loss as the Nifty falls further, with every sector moving along with it.</p>
      <div class="st-chart sm"><canvas id="stSensChart" aria-label="Portfolio loss versus Nifty fall"></canvas></div>`;
  }
  function slider(id, label, min, max, bare) {
    const v = Math.round((st.shock[id] || 0) * 100);
    return `<label class="st-slider${bare ? ' bare' : ''}">${label ? `<span>${esc(label)}</span>` : ''}<input type="range" min="${min}" max="${max}" step="1" value="${v}" data-sh="${id}" aria-label="${esc(label || 'Sector move')}" /><output id="stO_${id}">${v > 0 ? '+' : ''}${v}%</output></label>`;
  }
  function secOpts(keys, cal, cur) { return `<option value="">Sector…</option>${keys.map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(cal.names[k] || k)}</option>`).join('')}`; }
  function wireShock(o) {
    const sl = $$('[data-sh]');
    const read = () => {
      sl.forEach((i) => { const v = +i.value; st.shock[i.dataset.sh] = v / 100; const out = $(`#stO_${i.dataset.sh}`); if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`; });
      st.shock.s1 = $('#stS1').value; st.shock.s2 = $('#stS2').value;
      const s = { NIFTY: st.shock.NIFTY, FX: st.shock.FX || 0, OIL: st.shock.OIL || 0, sectors: {} };
      if (st.shock.s1) s.sectors[st.shock.s1] = st.shock.v1;
      if (st.shock.s2) s.sectors[st.shock.s2] = st.shock.v2;
      const r = R.runShock(o.Pf, s), top = r.rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 6);
      $('#stShockOut').innerHTML = `<div class="st-big"><span>Your portfolio</span><b>${pc(r.ret, 1)}</b><em>${rs(r.pnl)} on ${rsShort(o.Pf.total, true)}</em></div>
        <table class="nt st-tbl"><thead><tr><th class="l">Biggest moves</th><th>Move</th><th>In ₹</th></tr></thead><tbody>${top.map((x) => `<tr><td class="l">${esc(x.h.n)}</td><td>${pc(x.ret, 1)}</td><td>${rs(x.pnl)}</td></tr>`).join('')}</tbody></table>`;
    };
    const set = (k, v) => { const i = $(`[data-sh="${k}"]`); if (i) i.value = Math.round(v * 100); };
    $('.st-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pre]'); if (!b) return;
      $$('.st-presets [data-pre]').forEach((x) => x.classList.toggle('on', x === b));
      const p = R.PRESETS.find((x) => x.id === b.dataset.pre).s, secs = Object.entries(p.sectors || {}).filter(([k]) => o.cal.f[k]);
      set('NIFTY', p.NIFTY || 0); set('FX', p.FX || 0); set('OIL', p.OIL || 0);
      $('#stS1').value = secs[0] ? secs[0][0] : ''; set('v1', secs[0] ? secs[0][1] : 0);
      $('#stS2').value = secs[1] ? secs[1][0] : ''; set('v2', secs[1] ? secs[1][1] : 0);
      read();
    });
    sl.forEach((i) => i.addEventListener('input', () => { $$('.st-presets [data-pre]').forEach((x) => x.classList.remove('on')); read(); }));
    $('#stS1').onchange = read; $('#stS2').onchange = read;
    read();
  }
  function drawSens(o) {
    if (!window.Chart) return; chartBase();
    const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    st.charts.push(new Chart($('#stSensChart'), {
      type: 'line',
      data: { labels: o.sens.map((x) => pc(x.nifty)), datasets: [{ label: 'Your portfolio', data: o.sens.map((x) => +(x.ret * 100).toFixed(1)), borderColor: acc, backgroundColor: acc, tension: 0.2 }, { label: 'Nifty 50', data: o.sens.map((x) => +(x.nifty * 100).toFixed(1)), borderColor: mut, backgroundColor: mut, borderDash: [4, 4], pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { title: { display: true, text: 'Nifty 50 fall' } }, y: { ticks: { callback: (v) => pc(v / 100) } } } }
    }));
  }

  /* ---- risk numbers */
  function riskHTML(o) {
    return `
      <p class="st-lead">Value at risk (VaR) answers "how bad is a bad day, or a bad month?". Three methods are shown side by side — when they disagree, the larger number is the safer guide.</p>
      <label class="st-pick">Confidence <select id="stConf"><option value="0.99"${st.conf === 0.99 ? ' selected' : ''}>99% — 1 in 100</option><option value="0.95"${st.conf === 0.95 ? ' selected' : ''}>95% — 1 in 20</option></select></label>
      <div id="stRiskT">${riskTable(o)}</div>
      <div class="st-cards st-cards-sm">
        ${o.svar ? card('Stressed VaR (1 day, 99%)', pcLoss(o.svar.var, 1), `Worst year in history: ${mon(o.svar.from)} – ${mon(o.svar.to)}`, 'The bank-regulation (Basel) version of VaR: measured only over the worst 12-month stretch since 2004, so it shows a bad day in a bad year.') : ''}
        ${o.kup ? card('Model check', o.kup.pass ? 'Passed' : 'Failed', `${o.kup.breaches} breaches vs ${Math.round(o.kup.expected)} expected in ${o.kup.days.toLocaleString('en-IN')} days`, 'Kupiec test: a 99% VaR should be beaten on about 1 day in 100. Too many breaches means the VaR has been too low.') : ''}
      </div>
      ${o.kup && !o.kup.pass ? '<p class="st-note warn">Historical VaR has been beaten more often than it should be, so treat these numbers as a floor, not a ceiling.</p>' : ''}
      <details class="st-more-d"><summary>What do these methods mean?</summary><ul class="st-gloss">
        <li><b>Historical</b> — the actual worst days (or 10- and 21-day stretches) of your holdings over the last 10 years. No assumptions about shapes of returns.</li>
        <li><b>Recent conditions (EWMA)</b> — weights recent days more (the RiskMetrics method), so it rises quickly when markets get jumpy.</li>
        <li><b>Fat-tail adjusted</b> — a normal-curve estimate corrected for lopsided returns and extreme days (Cornish-Fisher).</li>
        <li><b>Expected shortfall</b> — the average loss on the days worse than VaR: how bad "bad" gets.</li>
        <li>The 30-day figures use 21 trading days. 10- and 21-day historical figures come from overlapping stretches of real history, not by scaling the 1-day number.</li>
      </ul></details>`;
  }
  function riskTable(o) {
    const t = o.risk[st.conf], H = { 1: '1 day', 10: '10 days', 21: '30 days' };
    return `<table class="nt st-tbl"><thead><tr><th class="l">Period</th><th>Historical VaR</th><th>In ₹</th><th>Expected shortfall</th><th>Recent conditions</th><th>Fat-tail adjusted</th></tr></thead><tbody>
      ${t.map((r) => `<tr><td class="l">${H[r.h]}</td><td>${pcLoss(r.hist, 1)}</td><td>${rsShort(r.hist * o.Pf.total, true)}</td><td>${pcLoss(r.histES, 1)}</td><td>${pcLoss(r.ewma, 1)}</td><td>${pcLoss(r.cf, 1)}</td></tr>`).join('')}
    </tbody></table><p class="st-note">All figures are losses: a ${Math.round(st.conf * 100)}% VaR of ${pcLoss(t[0].hist, 1)} means ${st.conf === 0.99 ? '1 day in 100' : '1 day in 20'} has been worse than that.</p>`;
  }

  /* ---- selling */
  function liqHTML(o) {
    const rows = o.liq.rows.filter((r) => isNum(r.days) && r.h.kind !== 'mf').sort((a, b) => b.days - a.days).slice(0, 10);
    return `
      <p class="st-lead">How long it would take to sell without pushing prices down much. This uses SEBI's method for mutual funds (published by AMFI): sell a slice of every holding each day, at no more than 10% of three times the stock's average daily trading, after setting aside the 20% least liquid holdings.</p>
      <table class="nt st-tbl"><thead><tr><th class="l">To sell</th><th>Using 3-month trading</th><th>Using 1-year trading</th></tr></thead><tbody>
        <tr><td class="l">A quarter of the portfolio</td><td>${days(o.liq.d25)}</td><td>${days(o.liq12.d25)}</td></tr>
        <tr><td class="l">Half of the portfolio</td><td>${days(o.liq.d50)}</td><td>${days(o.liq12.d50)}</td></tr>
        <tr><td class="l">Everything</td><td>${days(o.liq.d100)}</td><td>${days(o.liq12.d100)}</td></tr>
      </tbody></table>
      ${o.liq.unknown ? `<p class="st-note">${o.liq.unknown} holding${o.liq.unknown > 1 ? 's have' : ' has'} no trading-volume data and ${o.liq.unknown > 1 ? 'are' : 'is'} left out. Mutual funds are treated as sellable within a day.</p>` : ''}
      ${rows.length ? `<h2 class="st-h">Slowest to sell in full</h2><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Value</th><th>Sellable a day</th><th>Days to sell all</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${esc(r.h.n)}</td><td>${rs(r.h.value)}</td><td>${rs(r.cap)}</td><td>${days(r.days)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  /* ---- data and method */
  function dataHTML(o) {
    const hs = o.Pf.holdings.slice().sort((a, b) => b.value - a.value);
    return `
      <p class="st-lead">Every number above comes from these inputs. Flags point to holdings whose results deserve a second look.</p>
      <table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>History from</th><th>Market beta ${tip('Adjusted (Blume): 0.67 × measured + 0.33, the standard way to correct for betas drifting toward 1. Measured value in brackets.')}</th><th>Fit ${tip('R² — how much of the holding\'s weekly moves the market, sector, rupee and crude explain. Low fit means estimates for it are rougher.')}</th><th class="l">Flags</th></tr></thead><tbody>
        ${hs.map((h) => `<tr><td class="l"><b>${esc(h.n)}</b><span class="st-sym">${esc(h.secName)}${h.fk ? ` · vs ${esc(o.cal.names[h.fk] || h.fk)}` : ''}</span></td><td>${mon(h.dq.start)}</td><td>${h.beta.bm.toFixed(2)} <span class="st-dim">(${h.beta.bmRaw.toFixed(2)})</span></td><td>${h.beta.dflt ? '—' : `${Math.round(h.beta.r2 * 100)}%`}</td><td class="l">${h.dq.flags.length ? h.dq.flags.map((f) => `<span class="st-est warn">${esc(f)}</span>`).join(' ') : '<span class="st-dim">None</span>'}</td></tr>`).join('')}
      </tbody></table>
      <h2 class="st-h">Method</h2>
      <ul class="st-gloss">
        <li><b>Past crashes</b> compound each holding's real daily returns over the crash window. A holding not listed at the time (or with gaps over 20%) is estimated from a factor model: its measured sensitivity to the Nifty 50, its sector index (beyond the market), the rupee and crude, fitted on 3 years of weekly returns. Estimates carry a 90% range from the model's unexplained moves.</li>
        <li><b>What if</b> applies the same factor model to the shocks you set. A sector you don't set moves with the market.</li>
        <li><b>VaR and expected shortfall</b> use the last ${o.daily.r.length.toLocaleString('en-IN')} trading days. Days before a holding listed are filled from the factor model. Stressed VaR scans every 250-day window since ${mon(o.full.dates[0])}.</li>
        <li><b>Selling</b> follows AMFI's liquidity stress-test formula for small and mid-cap funds, applied to your holdings.</li>
        <li><b>Next 12 months</b> is a block bootstrap: 10,000 years (2,000 on phones) built from random 10-day blocks of the portfolio's real daily history.</li>
      </ul>
      <p class="st-note">Market data ${o.cal.built ? `updated ${dt(String(o.cal.built).slice(0, 10))}` : 'loaded live'} · last trading day ${dt(o.cal.dates[o.cal.dates.length - 1])} · prices from Yahoo Finance, sectors from screener.in, fund NAVs from MFapi.in.</p>`;
  }

  /* ---------------------------------------------------------------- Monte Carlo (in slices, so the page never freezes) */
  function monteCarlo(o) {
    const my = ++st.mcSeq, total = P().isMobile && P().isMobile() ? 2000 : 10000, step = 1000, ret = [], dd = [];
    st.mcDone = null;
    if (o.daily.r.length < 300) { $('#stMc').innerHTML = '<p class="st-lead">Not enough history to simulate.</p>'; return; }
    let done = 0;
    const tick = () => {
      if (my !== st.mcSeq || !$('#stMc')) return;
      const r = R.monteCarlo(o.daily.r, total, 250, 10, 7, done, Math.min(total, done + step));
      ret.push(...r.ret); dd.push(...r.dd); done += step;
      if (done < total) { setTimeout(tick, 0); return; }
      const s = ret.slice().sort((a, b) => a - b), d = dd.slice().sort((a, b) => a - b), p20 = s.filter((x) => x <= -0.2).length / s.length;
      $('#stMc').innerHTML = `<div class="st-cards st-cards-sm">
          ${card('1 year in 100 is worse than', pc(R.pct(s, 0.01)), rsShort(R.pct(s, 0.01) * o.Pf.total), 'The 1st percentile of simulated one-year returns.')}
          ${card('1 year in 20 is worse than', pc(R.pct(s, 0.05)), rsShort(R.pct(s, 0.05) * o.Pf.total), 'The 5th percentile of simulated one-year returns.')}
          ${card('A middle year', pc(R.pct(s, 0.5)), 'Half the simulated years did better', 'The median simulated one-year return.')}
          ${card('Chance of losing 20% or more', `${Math.round(p20 * 100)}%`, 'over the next 12 months', 'Share of simulated years ending 20% or more below where they started.')}
        </div>
        <div class="st-chart sm"><canvas id="stMcChart" aria-label="Distribution of simulated one-year returns"></canvas></div>
        <p class="st-note">${total.toLocaleString('en-IN')} simulated years. In 1 year in 20, the portfolio fell at least ${pcLoss(R.pct(d, 0.05))} from a high at some point during the year, even when it ended higher.</p>`;
      const draw = () => {
        if (!window.Chart || !$('#stMcChart') || $('#stPane-mc').classList.contains('hidden')) return false;
        chartBase();
        const lo = Math.max(-0.8, s[0]), hi = Math.min(2, s[s.length - 1]), B = 30, w = (hi - lo) / B, bins = Array(B).fill(0);
        s.forEach((x) => { bins[Math.min(B - 1, Math.max(0, Math.floor((x - lo) / w)))]++; });
        const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
        st.charts.push(new Chart($('#stMcChart'), {
          type: 'bar',
          data: { labels: bins.map((_, i) => pc(lo + (i + 0.5) * w)), datasets: [{ label: 'Simulated years', data: bins, backgroundColor: bins.map((_, i) => (lo + (i + 1) * w <= 0 ? mut : acc)), barPercentage: 1, categoryPercentage: 1 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'One-year return' }, ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'Simulated years' } } } }
        }));
        return true;
      };
      st.mcDone = () => { if (draw()) st.mcDone = null; };
      st.mcDone();
    };
    setTimeout(tick, 50);
  }

  /* ---------------------------------------------------------------- entry */
  function show(arg) {
    shell();
    document.title = 'Portfolio stress test — PLUTUS';
    let csv = null, open = null;
    try { csv = sessionStorage.getItem('plutus.stress.csv'); open = sessionStorage.getItem('plutus.stress.open'); sessionStorage.removeItem('plutus.stress.csv'); sessionStorage.removeItem('plutus.stress.open'); } catch (e) { /* ok */ }
    if (arg === 'sample') { history.replaceState(null, '', '#/stress'); loadSample(true); return; }
    if (arg) {
      const l = fromHash(arg);
      if (l && l.length) {
        const same = st.out && JSON.stringify(l.map((x) => [x.s, x.mode, x.v])) === JSON.stringify(st.list.map((x) => [x.s, x.mode, x.v]));
        st.list = l; save(); renderList();
        if (!same) run();
        return;
      }
    }
    renderList();
    if (csv) importCsv(csv);
    if (open === 'mf') toggleMf(true);
    if (st.pending) {
      const p = st.pending; st.pending = null;
      st.pick = p; $('#stQ').value = p.n; setTimeout(() => $('#stAmt').focus(), 60);
      err(`Enter the value of your ${p.n} holding (or switch to shares), then press Add.`, true);
    }
  }
  // used by the screener ("Stress test these")
  function linkFor(list) { return '#/stress/' + b64.enc(JSON.stringify(list.map((x) => ['eq', x.s, 'amt', x.v || 100000, x.n, '']))); }

  /* ---------------------------------------------------------------- home page: the "Stress test" tab */
  function initHome() {
    const q = $('#homeStress'); if (!q) return;
    if (P().attachSearch) P().attachSearch(q, $('#homeStressSug'), (it) => { st.pending = { s: it.symbol, n: it.name || it.symbol }; q.value = ''; location.hash = '#/stress'; });
    const chips = $('#stressChips');
    if (st.list.length) chips.insertAdjacentHTML('afterbegin', `<span class="chips-label">Or</span><button type="button" data-st="saved">Your saved portfolio (${st.list.length})</button>`) ;
    if (st.list.length) { const lab = chips.querySelectorAll('.chips-label')[1]; if (lab) lab.remove(); }
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      if (b.dataset.st === 'sample') location.hash = '#/stress/sample';
      else if (b.dataset.st === 'saved') location.hash = '#/stress';
      else if (b.dataset.st === 'mf') { try { sessionStorage.setItem('plutus.stress.open', 'mf'); } catch (e2) { /* ok */ } location.hash = '#/stress'; }
    });
    $('#homeStressCsv').onchange = (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      f.text().then((t) => { try { sessionStorage.setItem('plutus.stress.csv', t); } catch (e2) { /* ok */ } location.hash = '#/stress'; });
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHome); else initHome();

  window.PlutusStress = { show, linkFor };
})();
