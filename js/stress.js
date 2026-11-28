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
  // v56: the framework's sections, one after another (the bar jumps to a section and follows the scroll)

  const st = { list: load(), limit: loadLimit(), out: null, charts: [], pick: null, sc: null, pending: null, hz: 2, cm: 'normal', explain: false };

  /* ---------------------------------------------------------------- storage + sharing */
  function loadLimit() { try { const v = +localStorage.getItem('plutus.stress.limit'); return v >= 5 && v <= 90 ? v / 100 : 0.3; } catch (e) { return 0.3; } }
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.s && x.v > 0) : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st.list.map(({ kind, s, n, mode, v, code, lt }) => ({ kind, s, n, mode, v, code, ...(lt === false ? { lt } : {}) })))); } catch (e) { /* private mode */ } }
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
      .then((j) => {
        const m = new Map(), rows = j.rows.map((a) => Object.fromEntries(j.fields.map((f, i) => [f, a[i]])));
        rows.slice().sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).forEach((r, i) => { r.rank = r.mcap ? i + 1 : null; }); // SEBI size classes use market-cap rank
        rows.forEach((r) => m.set(r.s, r)); return m;
      })
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
        return { ...toFrac(j.o, j.r), adv3: j.adv3, adv12: j.adv12, px: j.px, asof: j.asof, sec: j.sec || u.sec, ind: j.ind || u.ind, n: u.n || (j.n && j.n !== item.s ? j.n : '') || item.n, fund: u.s ? u : null, rank: u.rank || null };
      } catch (e) {
        const y = await yahooDaily(item.s);
        if (y.closes.length < 20) throw new Error('no prices');
        const a = R.alignCloses(y.closes, cal.dates);
        return { ...toFrac(a.o, a.r), adv3: avg(y.vols.slice(-63)), adv12: avg(y.vols.slice(-250)), px: y.closes[y.closes.length - 1][1], asof: y.closes[y.closes.length - 1][0], sec: u.sec || '', ind: u.ind || '', n: u.n || item.n, fund: u.s ? u : null, rank: u.rank || null };
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

  /* ---------------------------------------------------------------- v58: a mutual fund's stocks (look-through)
     The fund's latest portfolio comes from Groww through the Worker (?mfh=). Its equity holdings are matched to NSE
     symbols (screener universe by name, then Yahoo search), and the fund is tested as those stocks. Hybrid and debt
     funds (under 80% in stocks), and funds whose stocks can't be matched, are tested on their NAV as before. */
  const MFH = new Map();
  const LT_MAX = 250, LT_MIN_EQ = 80;
  const workerBase = () => (CFG.WORKER_URL ? String(CFG.WORKER_URL).replace(/\/?$/, '/') : '');
  const coKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|the|co|company|corporation|corp|inc|plc|india|of)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
  const NOT_STOCK = /\b(treps|tri-?party|reverse repo|repo|net receivables?|net current assets|cash|margin|t-?bill|treasury|government|goi|sdl|state development|bond|debenture|ncd|commercial paper|certificate of deposit|cblo|mutual fund|etf|units of|reit|invit|futures?|options?|deposit)\b/i;
  let NAMEIX = null;
  function nameIndex() {
    if (!NAMEIX) NAMEIX = universe().then((uni) => { const m = new Map(); uni.forEach((r) => { if (r.n) { const k = coKey(r.n); if (k && !m.has(k)) m.set(k, r.s); } }); return m; });
    return NAMEIX;
  }
  const symMemo = new Map();
  function findSymbol(name) {
    const k = coKey(name); if (!k) return Promise.resolve(null);
    if (symMemo.has(k)) return symMemo.get(k);
    const p = (async () => {
      const ix = await nameIndex(); if (ix.has(k)) return { s: ix.get(k) };
      try {
        const q = String(name).replace(/\b(ltd|limited)\.?$/i, '').trim();
        const j = await fetch(viaWorker(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0&region=IN&lang=en-IN`)).then(okJSON);
        const qs = (j.quotes || []).filter((x) => x.symbol && /EQUITY/i.test(x.quoteType || ''));
        const pick = qs.find((x) => /\.NS$/.test(x.symbol)) || qs.find((x) => /\.BO$/.test(x.symbol)) || qs[0];
        return pick ? { s: pick.symbol, foreign: !/\.(NS|BO)$/.test(pick.symbol) } : null;
      } catch (e) { return null; }
    })();
    symMemo.set(k, p); return p;
  }
  // { status: 'ok' | 'mixed' | 'none', name, asof, eq (%), stocks: [{ s, n, w (share of the fund, 0–1), sec, foreign }], skipped }
  function fundStocks(item) {
    if (!item.code) return Promise.resolve({ status: 'none' });
    if (MFH.has(item.code)) return MFH.get(item.code);
    const p = (async () => {
      const base = workerBase(); if (!base) return { status: 'none', why: 'no worker' };
      let j;
      try { j = await fetch(`${base}?mfh=${encodeURIComponent(item.code)}&q=${encodeURIComponent(item.n || '')}`).then(okJSON); } catch (e) { return { status: 'none', why: 'unreachable' }; }
      const all = (j.holdings || []).filter((h) => h.w > 0);
      // Groww's own type label decides first; the name check only applies when there is no label
      const isEq = (h) => (h.t ? /EQ/.test(h.t) && !/DEBT|BOND|CASH|MONEY|GOV/.test(h.t) && !/^(treps\b|net receivables?|net current assets|cash( (and|&) cash equivalents?)?$|cash margin)/i.test(h.n.trim()) : !NOT_STOCK.test(h.n) && !!h.sec && !/debt|cash|gov|money|sovereign/i.test(h.sec));
      const eqs = all.filter(isEq).sort((a, b) => b.w - a.w), eq = eqs.reduce((a, h) => a + h.w, 0);
      const out = { status: 'ok', name: j.name || item.n, asof: j.asof || '', eq, total: all.length, stocks: [], unmatched: [], other: all.filter((h) => !isEq(h)).sort((a, b) => b.w - a.w).map((h) => ({ n: h.n, w: h.w / 100, t: h.t })), skipped: 0 };
      if (eq < LT_MIN_EQ) { out.status = 'mixed'; return out; }
      const pickd = eqs.slice(0, LT_MAX);
      const found = await pool(pickd, 10, async (h) => ({ h, m: await findSymbol(h.n) }));
      found.forEach(({ h, m }) => { if (m) out.stocks.push({ s: m.s, n: h.n.replace(/\s+(Ltd|Limited)\.?$/i, ' Ltd'), w: h.w / 100, sec: h.sec, foreign: !!m.foreign }); else out.unmatched.push({ n: h.n, w: h.w / 100 }); });
      out.skipped = out.unmatched.length + Math.max(0, eqs.length - LT_MAX);
      out.matched = out.stocks.reduce((a, x) => a + x.w, 0) * 100;
      out.cover = out.matched / eq; // share of the fund's stocks that will be tested
      if (out.cover < 0.6) out.status = 'none';
      return out;
    })();
    MFH.set(item.code, p); p.then((r) => { if (r.status === 'none' && r.why) MFH.delete(item.code); });
    return p;
  }
  async function pool(xs, n, fn) {
    const out = new Array(xs.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]); } }));
    return out;
  }
  const shortFund = (n) => String(n || '').split(/\s+-\s+/)[0].replace(/\s+(Fund|Scheme)$/i, '').trim();
  const lookThrough = (x) => x.kind === 'mf' && x.lt !== false;

  /* ---------------------------------------------------------------- page shell */
  function shell() {
    const v = $('#viewStress'); if (v.dataset.ready) return;
    v.dataset.ready = '1';
    v.innerHTML = `
      <section class="sx-head st-head">
        <p class="eyebrow">Portfolio stress test</p>
        <h1>How would your portfolio hold up in a crash?</h1>
        <p class="st-intro">Eight professional stress tests in one place — <strong>past crises</strong>, <strong>what-if shocks</strong>, <strong>factor sensitivity</strong>, <strong>business stress</strong>, <strong>Monte Carlo</strong>, a <strong>reverse stress test</strong>, <strong>liquidity</strong> and a full <strong>risk breakdown</strong> — explained in plain words.</p>
        <ol class="st-steps" aria-label="How it works"><li><b>1</b>Add what you own</li><li><b>2</b>Set the loss you can't accept</li><li><b>3</b>Run the test and read the results</li></ol>
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
        <div class="st-limit">
          <label for="stLimit"><b>Your loss limit</b><span>The fall you couldn't live with. Every scenario that goes past it is flagged.</span></label>
          <span class="st-minput sm"><input id="stLimit" type="number" min="5" max="90" step="1" inputmode="numeric" aria-describedby="stLimitHelp" /><span>%</span></span>
        </div>
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
    const lim = $('#stLimit'); lim.value = Math.round(st.limit * 100);
    lim.addEventListener('change', () => setLimit(+lim.value));
    $('#stCsv').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(importCsv); e.target.value = ''; };
    $('#stMf').onclick = () => toggleMf();
    wireMf();
    const list = $('#stList');
    list.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.v != null) { const i = +t.dataset.v, v = parseFloat(t.value); if (!(v > 0)) removeAt(i); else { st.list[i].v = v; save(); refreshList(); } }
      else if (t.dataset.w != null) setWeight(+t.dataset.w, parseFloat(t.value));
      else if (t.id === 'stTotal') setTotal(parseFloat(String(t.value).replace(/,/g, '')));
      else if (t.dataset.lt != null) { const x = st.list[+t.dataset.lt]; if (x) { if (t.checked) delete x.lt; else x.lt = false; save(); mfInfo(); } }
    });
    list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); } });
    list.addEventListener('click', (e) => {
      if (e.target.closest('#stEqual')) equalWeights();
      if (e.target.closest('#stClear')) clearAll();
      const d = e.target.closest('[data-del]'); if (d) removeAt(+d.dataset.del);
    });
  }
  function setLimit(v) {
    if (!(v >= 5 && v <= 90)) { $$('#stLimit, #stRevLimit').forEach((i) => { i.value = Math.round(st.limit * 100); }); return; }
    st.limit = v / 100; try { localStorage.setItem('plutus.stress.limit', String(v)); } catch (e) { /* ok */ }
    $$('#stLimit, #stRevLimit').forEach((i) => { if (+i.value !== v) i.value = v; });
    if (st.out) { const o = st.out, w = allScenarios(o)[0]; o.zone = R.stressZone({ worstLoss: Math.max(0, -w.ret), limit: st.limit, var30: o.risk[0.99][2].hist, beta: o.bt.beta, hhi: o.conc.hhi, days: o.liq.d100, volNow: o.volNow, volLong: o.vc.vol }); const y = window.scrollY; render(o); window.scrollTo(0, y); }
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
      <table class="nt st-tbl st-hold"><thead><tr><th class="l">Holding</th><th>Value</th><th>Weight</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${st.list.map((x, i) => `
        <tr><td class="l"><b>${esc(x.n)}</b><span class="st-sym">${esc(x.kind === 'mf' ? 'Mutual fund' : x.s.replace(/\.(NS|BO)$/, ''))}</span></td>
        <td><span class="st-amt">${x.mode === 'qty' ? '' : '₹'}<input type="number" min="0" step="any" value="${x.v}" data-v="${i}" aria-label="Value of ${esc(x.n)}" />${x.mode === 'qty' ? `<em>${x.kind === 'mf' ? 'units' : 'shares'}</em>` : ''}</span><span class="st-rowval" data-rv="${i}"></span></td>
        <td><span class="st-amt"><input type="number" min="0" max="100" step="0.1" data-w="${i}" aria-label="Weight of ${esc(x.n)} in percent" /><em>%</em></span></td>
        <td class="st-delcell"><button type="button" class="st-del" data-del="${i}" aria-label="Remove ${esc(x.n)}" title="Remove ${esc(x.n)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button></td></tr>${x.kind === 'mf' ? `
        <tr class="st-mfrow"><td colspan="4" class="l"><div class="st-mfinfo" data-mfh="${i}"></div></td></tr>` : ''}`).join('')}</tbody></table>
      <p class="st-tip">Change a value or a weight and press Enter. Changing a weight keeps the total the same.</p>`;
    refreshList(); mfInfo();
  }
  // v58: under each fund — whether it is tested through its stocks, and which stocks
  function mfInfo() {
    st.list.forEach((x, i) => {
      if (x.kind !== 'mf') return;
      const el = $(`[data-mfh="${i}"]`); if (!el) return;
      const sw = (on) => `<label class="st-lt"><input type="checkbox" data-lt="${i}"${on ? ' checked' : ''} /><span>Test its stocks</span></label>`;
      if (!lookThrough(x)) { el.innerHTML = `${sw(false)}<span class="st-dim">Tested as one fund, on its daily NAV.</span>`; return; }
      el.innerHTML = `${sw(true)}<span class="st-dim"><span class="st-spin" aria-hidden="true"></span>Looking up the fund's stocks…</span>`;
      fundStocks(x).then((f) => {
        if (!el.isConnected || !lookThrough(x)) return;
        if (f.status === 'mixed') { el.innerHTML = `${sw(true)}<span class="st-dim">Only <b>${Math.round(f.eq)}%</b> of this fund is in stocks, so it is tested as one fund on its daily NAV.</span>`; return; }
        if (f.status !== 'ok') { el.innerHTML = `${sw(true)}<span class="st-dim">Its stocks couldn't be found right now, so it is tested as one fund on its daily NAV.</span>`; return; }
        const asof = /^\d{4}-\d{2}/.test(f.asof || '') ? ` · portfolio of <b>${mon(f.asof)}</b>` : '';
        const max = Math.max(...f.stocks.map((y) => y.w), 0.01);
        const li = (y, cls) => `<li${cls ? ` class="${cls}"` : ''}><span class="st-mfn">${esc(y.n)}${y.foreign ? ' <em class="st-est">overseas</em>' : ''}</span><span class="st-mfbar"><i style="width:${Math.max(3, (y.w / max) * 100).toFixed(0)}%"></i></span><b>${(y.w * 100).toFixed(2)}%</b></li>`;
        const sum = (xs) => xs.reduce((a, y) => a + y.w, 0) * 100;
        const n = f.stocks.length + f.unmatched.length;
        el.innerHTML = `${sw(true)}<span>Tested through <b>${f.stocks.length} of its ${n} stocks</b> (${Math.round(f.cover * 100)}% of the fund's equity)${asof}</span>
          <details class="st-mfd"><summary>Show all ${f.total} holdings</summary>
          <h4 class="st-mfh">Stocks tested <span>${f.stocks.length} · ${sum(f.stocks).toFixed(1)}% of the fund</span></h4><ol class="st-mfstocks">${f.stocks.map((y) => li(y)).join('')}</ol>
          ${f.unmatched.length ? `<h4 class="st-mfh">Stocks that couldn't be matched to an NSE listing <span>${f.unmatched.length} · ${sum(f.unmatched).toFixed(1)}%</span></h4><ol class="st-mfstocks st-mfoff">${f.unmatched.map((y) => li(y, 'off')).join('')}</ol>` : ''}
          ${f.other.length ? `<h4 class="st-mfh">Cash, bonds and other assets <span>${f.other.length} · ${sum(f.other).toFixed(1)}%</span></h4><ol class="st-mfstocks st-mfoff">${f.other.map((y) => li(y, 'off')).join('')}</ol>` : ''}
          <p class="st-note">From Groww's published fund portfolio. The test uses the stocks in the first list; the grey lines are spread across them in proportion, so the fund's full value is tested.</p></details>`;
      });
    });
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
    destroyCharts();
    res.innerHTML = `<div class="sx-load" role="status"><div class="sx-load-top"><div class="orbit sm"><span></span></div><div><b id="stStep">Loading market history…</b><span>Twenty years of daily prices for each holding, the market, sectors, the rupee and crude</span></div></div><div class="sx-skel" aria-hidden="true">${'<i></i>'.repeat(5)}</div></div>`;
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const done = () => { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); };
    let cal;
    try { cal = await calendar(); } catch (e) {
      done(); console.warn('[PLUTUS stress]', e);
      res.innerHTML = '<div class="sx-empty"><h2>Market history couldn\'t be loaded right now.</h2><p>Please try again in a minute.</p></div>'; return;
    }
    const step = $('#stStep'); let n = 0; const fails = [], ltNotes = [];
    // v58: mutual funds are split into their stocks where their portfolio can be found
    if (step && st.list.some(lookThrough)) step.textContent = 'Looking inside your mutual funds…';
    const funds = await Promise.all(st.list.map((it) => (lookThrough(it) ? fundStocks(it).catch(() => ({ status: 'none' })) : null)));
    if (my !== runSeq) return;
    const jobs = st.list.map((it) => ({ it }));
    st.list.forEach((it, i) => { const f = funds[i]; if (f && f.status === 'ok') f.stocks.forEach((x) => jobs.push({ it: { kind: 'stock', s: x.s, n: x.n, mode: 'amt', v: 0 }, parent: it, w: x.w })); });
    const loaded = await pool(jobs, 10, async (j) => {
      try { const s = await loadSeries(j.it, cal); if (step && my === runSeq) step.textContent = `Loading holdings… ${++n} of ${jobs.length}`; return { ...j, s }; } catch (e) { console.warn('[PLUTUS stress]', j.it.s, e); if (!j.parent) fails.push(j.it.n); return null; }
    });
    if (my !== runSeq) return;
    const kidsOf = new Map();
    loaded.forEach((j) => { if (j && j.parent) { if (!kidsOf.has(j.parent)) kidsOf.set(j.parent, []); kidsOf.get(j.parent).push(j); } });
    const byKey = new Map(), hs = [];
    const add = (it, s, value, via) => {
      const k = it.kind + ':' + it.s, ex = byKey.get(k);
      if (ex) { ex.value += value; if (via) ex.via.push(via); else ex.direct += value; return; }
      const fk = it.kind === 'mf' ? '' : R.sectorKey(s.sec, s.ind);
      const h = { ...s, kind: it.kind, s: it.s, n: s.n || it.n, value, fk: cal.f[fk] ? fk : '', secName: s.sec || 'Other', item: it, size: R.sizeOf(s.rank, it.kind, s.ind), via: via ? [via] : [], direct: via ? 0 : value };
      byKey.set(k, h); hs.push(h);
    };
    loaded.forEach((j) => {
      if (!j || j.parent) return;
      const { it, s } = j, i = st.list.indexOf(it), f = funds[i];
      it.px = s.px;
      const value = it.mode === 'qty' ? it.v * (s.px || 0) : it.v;
      if (!(value > 0)) return;
      const kids = kidsOf.get(it) || [], got = kids.reduce((a, k) => a + k.w, 0);
      if (f && f.status === 'ok' && got > 0 && got / (f.eq / 100) >= 0.6) {
        kids.forEach((k) => add(k.it, k.s, (value * k.w) / got, { fund: it.n, v: (value * k.w) / got }));
        ltNotes.push({ n: it.n, stocks: kids.length, all: f.stocks.length + f.unmatched.length, noPrice: f.stocks.length - kids.length, unmatched: f.unmatched.length, asof: f.asof, cover: got / (f.eq / 100), eq: f.eq, total: f.total });
        return;
      }
      if (it.kind === 'mf') ltNotes.push({ n: it.n, nav: true, why: !lookThrough(it) ? 'off' : f && f.status === 'mixed' ? 'mixed' : 'none', eq: f && f.eq });
      add(it, s, value, null);
    });
    hs.forEach((h) => { const fs = [...new Set(h.via.map((v) => v.fund))]; h.tag = !fs.length ? '' : h.direct > 0 ? `direct + ${fs.length === 1 ? 'via ' + shortFund(fs[0]) : `via ${fs.length} funds`}` : fs.length === 1 ? `via ${shortFund(fs[0])}` : `via ${fs.length} funds`; });
    refreshList();
    if (!hs.length) { done(); res.innerHTML = '<div class="sx-empty"><h2>None of these holdings could be loaded.</h2><p>Check the names and try again.</p></div>'; return; }
    if (step) step.textContent = 'Running the stress tests…';
    await new Promise((r) => setTimeout(r, 30));
    const Pf = { holdings: hs, total: hs.reduce((a, h) => a + h.value, 0), bb: R.sizeBetas(cal) };
    hs.forEach((h) => { h.beta = R.fit(h, cal); h.dq = quality(h, cal); });
    const full = R.portfolioDaily(Pf, cal, cal.dates.length, true); // since 2004 (estimates before a stock listed)
    const K = Math.min(2500, full.r.length);
    const daily = { r: full.r.slice(-K), nifty: full.nifty.slice(-K), dates: full.dates.slice(-K), comp: full.comp.map((c) => c.slice(-K)) };
    const scen = R.runScenarios(Pf, cal);
    scen.forEach((sc) => { sc.win = sc.ret == null ? null : R.windowStats(full, sc); });
    const lib = R.runLibrary(Pf), conc = R.concentration(Pf); conc.hhi = 1 / conc.effN;
    const svar = R.stressedVaR(full.r, full.dates, 0.99, 250), vc = R.volContrib(Pf, daily, 750);
    const uni = await universe().catch(() => new Map()), pes = [...uni.values()].map((r) => r.pe).filter((x) => x > 0 && x < 500).sort((a, b) => a - b);
    const medPE = pes.length ? pes[Math.floor(pes.length / 2)] : null;
    const cmPick = Pf.holdings.slice().sort((a, b) => b.value - a.value).slice(0, 10);
    const out = {
      cal, Pf, fails, ltNotes, daily, full, scen, lib, conc, svar, vc, medPE, cmPick,
      risk: { 0.95: R.riskTable(daily.r, [1, 10, 21], 0.95), 0.99: R.riskTable(daily.r, [1, 10, 21], 0.99) },
      svarH: [1, 10, 21].map((h, i) => (i ? R.stressedVaR(R.horizon(full.r, h), full.dates.slice(h - 1), 0.99, 250) : svar)),
      dd: R.drawdown(full.r, full.dates), liq: R.liquidity(Pf, 'adv3'), liqS: R.liquidityStressed(Pf), exitS: R.exitCost(Pf, true),
      bt: R.betas(Pf, daily, 750), svol: R.stressedVol(full, svar.from, svar.to), volNow: R.ewmaVol(daily.r) * Math.sqrt(250),
      cvar: R.componentVaR(Pf, daily, 0.99, 750), cm: R.corrMatrix(Pf, cal, cmPick, 750), pe: R.peCompression(Pf, medPE, 0.2),
      growth: Math.max(0.06, Math.min(0.18, R.cagr(full) || 0.12)),
      sens2: { mkt: R.runShock2(Pf, { NIFTY: -0.10, MID: -0.15, SMALL: -0.20 }), rates: lib.find((x) => x.id === 'rates'), fx: R.runShock2(Pf, { FX: 0.10 }), oil: R.runShock2(Pf, { OIL: 0.25 }) }
    };
    const worst = allScenarios(out)[0];
    out.zone = R.stressZone({ worstLoss: Math.max(0, -worst.ret), limit: st.limit, var30: out.risk[0.99][2].hist, beta: out.bt.beta, hhi: conc.hhi, days: out.liq.d100, volNow: out.volNow, volLong: vc.vol });
    st.out = out; done();
    history.replaceState(null, '', shareHash());
    render(out);
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


  /* ---------------------------------------------------------------- results: helpers */
  function destroyCharts() { st.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* gone */ } }); st.charts = []; }
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || f;
  const SIZE = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };
  const breach = (ret) => isNum(ret) && ret <= -st.limit;
  /* ================================================================ v61: the stress dashboard
     One screen of numbers that matter, grouped the way a risk desk reads them: the stress zone first, then what a
     stress does to the portfolio, downside risk, market and macro sensitivity, diversification and liquidity.
     Every number has an "i" that opens its definition; the explanations stay hidden until asked for. */
  const SECTIONS = [
    ['zone', 'Overview'], ['impact', 'Stress impact'], ['downside', 'Downside risk'], ['market', 'Market & macro'],
    ['divers', 'Diversification'], ['liq', 'Liquidity'], ['method', 'Method']
  ];
  const HZ = [[0, '1 day', 1], [1, '10 days', 10], [2, '1 month', 21]];
  // every scenario on one scale: historical crises + hypothetical shocks
  function allScenarios(o) {
    return o.scen.filter((s) => s.ret != null).map((s) => ({ id: s.id, name: s.name, ret: s.ret, pnl: s.pnl, kind: 'Historical', ref: s }))
      .concat(o.lib.map((s) => ({ id: s.id, name: s.name, ret: s.ret, pnl: s.pnl, kind: 'Hypothetical', ref: s })))
      .sort((a, b) => a.ret - b.ret);
  }
  const loss = (x, d) => (isNum(x) ? (x < -0.00005 ? `(${pcLoss(x, d == null ? 1 : d)})` : pc(x, d == null ? 1 : d)) : '—'); // a fall, in brackets
  const ICON_I = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>';
  // one metric: label, the number, one short line under it, and a hidden definition
  function M(label, value, sub, def, cls) {
    return `<div class="sd-m${cls ? ' ' + cls : ''}"><div class="sd-mh"><span class="sd-l">${label}</span>${def ? `<button type="button" class="sd-i" aria-expanded="false" aria-label="What is ${esc(label.replace(/<[^>]+>/g, ''))}?">${ICON_I}</button>` : ''}</div><b class="sd-v">${value}</b>${sub ? `<span class="sd-s">${sub}</span>` : ''}${def ? `<p class="sd-def">${def}</p>` : ''}</div>`;
  }
  const sec = (id, title, body, lead) => `<section class="sd-sec" id="sd-${id}" data-sec="${id}" aria-labelledby="sdH-${id}"><div class="sd-head"><h2 id="sdH-${id}">${title}</h2>${lead ? `<span class="sd-lead">${lead}</span>` : ''}</div>${body}</section>`;
  const ZCOL = ['', '#1f9d6b', '#6aa84f', '#e0a526', '#e0702a', '#cf2e3e'];
  const ZTXT = { Low: 'Your portfolio would hold up well in a severe stress.', Moderate: 'Some strain in a severe stress, but within normal limits.', Elevated: 'A severe stress would hurt noticeably. Worth watching.', High: 'A severe stress would cause heavy losses.', Severe: 'A severe stress would cause losses well beyond your limit.' };

  function gaugeSVG(score, level) {
    const cx = 120, cy = 112, r = 92, a = (v) => Math.PI * (1 - v / 100);
    const pt = (v, rr) => [cx + rr * Math.cos(a(v)), cy - rr * Math.sin(a(v))];
    const seg = (v0, v1, c) => { const [x0, y0] = pt(v0, r), [x1, y1] = pt(v1, r); return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${c}" />`; };
    const [nx, ny] = pt(Math.max(1, Math.min(99, score)), r - 26);
    return `<svg class="sd-gauge" viewBox="0 0 240 132" role="img" aria-label="Stress score ${Math.round(score)} out of 100">
      <g fill="none" stroke-width="16" stroke-linecap="butt" class="sd-g-arc">${[0, 20, 40, 60, 80].map((v, i) => seg(v + (i ? 0.8 : 0), v + 20 - (i < 4 ? 0.8 : 0), ZCOL[i + 1])).join('')}</g>
      <line class="sd-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke-width="3.5" stroke-linecap="round" style="--rot:${(score / 100) * 180 - 90}deg" />
      <circle cx="${cx}" cy="${cy}" r="7" class="sd-hub" />
    </svg>`;
  }

  /* ---- the page */
  function render(o) {
    destroyCharts();
    const res = $('#stRes'), all = allScenarios(o);
    if (!st.sc || !all.find((x) => x.id === st.sc)) st.sc = (all.find((x) => x.kind === 'Historical') || all[0]).id;
    if (st.hz == null) st.hz = 2;
    const z = o.zone, lim = Math.round(st.limit * 100), over = all.filter((x) => breach(x.ret)).length;
    const parts = z.parts.map((p) => `<li><span>${esc(p.label)}</span><i><em style="width:${Math.max(3, p.s).toFixed(0)}%;background:${ZCOL[Math.min(5, 1 + Math.floor(p.s / 20))]}"></em></i><b>${Math.round(p.s)}</b></li>`).join('');
    res.innerHTML = `
      <div class="sd ${st.explain ? 'explain' : ''}" id="sdRoot">
      <section class="sd-hero" id="sd-zone" data-sec="zone" aria-labelledby="sdZoneH">
        <div class="sd-zone lv${z.level}">
          ${gaugeSVG(z.score, z.level)}
          <div class="sd-zone-t"><span class="sd-k">Current stress zone</span><h2 id="sdZoneH" style="color:${ZCOL[z.level]}">${z.zone} <span class="sd-zs">${Math.round(z.score)}<small>/100</small></span></h2><p>${ZTXT[z.zone]}</p></div>
        </div>
        <div class="sd-hero-r">
          <div class="sd-hero-nums">
            <div><span>Portfolio value</span><b>${rsShort(o.Pf.total, true)}</b><em>${o.Pf.holdings.length} holding${o.Pf.holdings.length > 1 ? 's' : ''}</em></div>
            <div><span>Worst stress loss</span><b>${loss(all[0].ret)}</b><em>${esc(all[0].name)}</em></div>
            <div><span>Over your ${lim}% limit</span><b>${over} of ${all.length}</b><em>scenarios</em></div>
          </div>
          <div class="sd-hero-foot"><details class="sd-why"><summary>What sets the zone</summary><ul class="sd-parts">${parts}</ul><p class="sd-def-s">Each reading is scored 0–100 and weighted: worst-case loss vs your limit 30%, 1-month VaR 20%, beta 15%, concentration 15%, liquidity 10%, today's volatility 10%. Zones: under 20 Low, 20–40 Moderate, 40–60 Elevated, 60–80 High, 80+ Severe.</p></details>
          <button type="button" class="sd-explain" id="sdExplain" aria-pressed="${!!st.explain}">${st.explain ? 'Hide' : 'Show'} explanations</button></div>
        </div>
      </section>
      <nav class="secnav st-tabs" aria-label="Jump to a section"><div class="sn-track">${SECTIONS.map(([id, label], i) => `<button type="button" class="sn-tab${i ? '' : ' on'}" data-tab="${id}">${label}</button>`).join('')}</div></nav>

      ${sec('impact', 'Stress impact', `
        <label class="sd-pick">Scenario <select id="sdPick">${['Historical', 'Hypothetical'].map((k) => `<optgroup label="${k === 'Historical' ? 'Past crises' : 'What-if shocks'}">${all.filter((x) => x.kind === k).map((x) => `<option value="${x.id}"${x.id === st.sc ? ' selected' : ''}>${esc(x.name)} · ${loss(x.ret, 0)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <div class="sd-grid g5" id="sdImpact">${impactHTML(o)}</div>
        <div class="sd-chart-h"><h3>Every scenario</h3><ul class="st-key"><li><i class="k-hist"></i>Past crisis</li><li><i class="k-hypo"></i>What-if</li><li><i class="k-over"></i>Over limit</li><li><i class="k-line"></i>${lim}% limit</li></ul></div>
        <div class="st-chart" id="sdAllWrap"><canvas id="stAllChart" aria-label="Portfolio loss in every scenario"></canvas></div>
        <details class="sd-fold" id="sdReplay"><summary>Watch a crisis replay</summary><div class="st-anim" id="stAnim"></div></details>`)}

      ${sec('downside', 'Downside risk', `
        <div class="sd-seg" role="group" aria-label="Horizon">${HZ.map(([i, t]) => `<button type="button" data-hz="${i}" class="${i === st.hz ? 'on' : ''}" aria-pressed="${i === st.hz}">${t}</button>`).join('')}</div>
        <div class="sd-grid g5" id="sdDown">${downHTML(o)}</div>
        <div class="sd-charts2">
          <div><h3 class="sd-ch" id="sdHistH">${HZ[st.hz][1] === '1 day' ? 'Daily' : HZ[st.hz][1]} returns, last ${Math.round(o.daily.r.length / 250)} years</h3><div class="st-chart sm"><canvas id="sdHist" aria-label="Histogram of daily returns with VaR lines"></canvas></div></div>
          <div><h3 class="sd-ch">Drawdown since ${o.full.dates[0].slice(0, 4)}</h3><div class="st-chart sm"><canvas id="sdDD" aria-label="Drawdown from the previous high"></canvas></div></div>
        </div>`)}

      ${sec('market', 'Market & macro', `
        <div class="sd-grid g4">
          ${M('Portfolio beta', o.bt.beta.toFixed(2), `Nifty ±10% → you ${o.bt.beta >= 0 ? '±' : '∓'}${Math.abs(o.bt.beta * 10).toFixed(1)}%`, 'How much the portfolio moves for a 1% move in the Nifty 50 (value-weighted, Blume-adjusted holding betas). Above 1 swings more than the market.')}
          ${M('Downside beta', isNum(o.bt.down) ? o.bt.down.toFixed(2) : '—', isNum(o.bt.down) && isNum(o.bt.raw) ? (o.bt.down > o.bt.raw + 0.05 ? 'Falls harder than it rises' : o.bt.down < o.bt.raw - 0.05 ? 'Falls less than it rises' : 'Same up and down') : '', `Beta measured only on the ${o.bt.downDays} days the Nifty fell (last 3 years). Higher than beta means the portfolio falls harder in down markets.`)}
          ${M('Stressed volatility', pc(o.svol, 0), `normal ${pc(o.vc.vol, 0)} · today ${pc(o.volNow, 0)}`, `Yearly volatility inside the worst 12 months on record (${mon(o.svar.from)} – ${mon(o.svar.to)}), against the last 3 years and today's (EWMA) level.`)}
          ${M('Rates up 2%', loss(o.sens2.rates.ret), rsShort(o.sens2.rates.pnl), 'RBI repo rate up 200 bp: the market down 6% and rate-sensitive sectors (banks, NBFCs, real estate, autos, infrastructure) down more, through each holding\'s sector and market betas.')}
          ${M('Rupee 10% weaker', loss(o.sens2.fx.ret), rsShort(o.sens2.fx.pnl), 'Dollar up 10% against the rupee, nothing else changing: from each holding\'s measured rupee beta. Exporters gain, importers lose.')}
          ${M('Crude up 25%', loss(o.sens2.oil.ret), rsShort(o.sens2.oil.pnl), 'Brent crude up 25%, nothing else changing: from each holding\'s measured crude beta.')}
          ${M('P/E down 20%', loss(o.pe.ret), rsShort(o.pe.pnl), `Valuation de-rating: every P/E falls 20%, and stocks priced above the Nifty 500 median P/E (${o.medPE ? o.medPE.toFixed(0) + '×' : '—'}) also lose half their premium. Earnings unchanged.`)}
          ${M('Market down 10%', loss(o.sens2.mkt.ret), rsShort(o.sens2.mkt.pnl), 'Nifty 50 down 10%, with mid and small caps down more (15% and 20%), through each holding\'s market, sector and size betas.')}
        </div>
        <h3 class="sd-ch">Sensitivity to each shock</h3>
        <div class="st-chart" id="sdTornWrap"><canvas id="sdTorn" aria-label="Portfolio loss for each macro shock"></canvas></div>`)}

      ${sec('divers', 'Diversification', `
        <div class="sd-grid g4">
          ${M('Top 5 holdings', pc(o.conc.top5, 0), `largest: ${esc(o.conc.top.h.n)} ${pc(o.conc.top.w, 0)}`, 'Share of the portfolio in its five largest holdings. Above 60% is concentrated.')}
          ${M('HHI', Math.round(o.conc.hhi * 10000).toLocaleString('en-IN'), `like ${o.conc.effN.toFixed(1)} equal holdings · ${o.conc.hhi < 0.10 ? 'diversified' : o.conc.hhi < 0.18 ? 'moderately concentrated' : 'highly concentrated'}`, 'Herfindahl-Hirschman Index: the sum of squared weights × 10,000. Under 1,000 is diversified, 1,000–1,800 moderate, above 1,800 concentrated.')}
          ${M('Average correlation', isNum(o.cm.normal.avg) ? o.cm.normal.avg.toFixed(2) : '—', 'between holdings, last 3 years', 'Value-weighted average correlation between pairs of holdings: 1 = they move in lockstep, 0 = unrelated. Lower means more diversification.')}
          ${M('Stressed correlation', isNum(o.cm.crisis.avg) ? o.cm.crisis.avg.toFixed(2) : '—', isNum(o.cm.crisis.avg) && isNum(o.cm.normal.avg) ? `${o.cm.crisis.avg > o.cm.normal.avg ? '+' : ''}${(o.cm.crisis.avg - o.cm.normal.avg).toFixed(2)} in crises` : 'too little shared history', `The same average, but only on days inside past crises (${o.cm.crisisDays} days). Correlations usually rise in crises, so diversification fades exactly when it's needed.`, isNum(o.cm.crisis.avg) && isNum(o.cm.normal.avg) && o.cm.crisis.avg > o.cm.normal.avg + 0.05 ? 'warn' : '')}
        </div>
        <div class="sd-charts2">
          <div><div class="sd-chart-h"><h3>Correlation matrix</h3><div class="sd-seg sm" role="group" aria-label="Period"><button type="button" data-cm="normal" class="${st.cm !== 'crisis' ? 'on' : ''}">Normal</button><button type="button" data-cm="crisis" class="${st.cm === 'crisis' ? 'on' : ''}">In crises</button></div></div><div class="sd-heat" id="sdHeat">${heatHTML(o)}</div></div>
          <div><h3 class="sd-ch">Sector concentration</h3><ul class="sd-bars">${o.conc.sectors.slice(0, 8).map(([n, w]) => `<li><span>${esc(n)}</span><i><em style="width:${(w / o.conc.sectors[0][1]) * 100}%"></em></i><b>${pc(w, 0)}</b></li>`).join('')}${o.conc.sectors.length > 8 ? `<li class="sd-more"><span>${o.conc.sectors.length - 8} more</span><i></i><b>${pc(o.conc.sectors.slice(8).reduce((a, x) => a + x[1], 0), 0)}</b></li>` : ''}</ul></div>
        </div>
        <div class="sd-chart-h"><h3>Risk contribution by holding</h3><ul class="st-key"><li><i class="k-hypo"></i>Weight</li><li><i class="k-hist"></i>Share of risk</li></ul></div>
        <div class="st-chart" id="sdCompWrap"><canvas id="sdComp" aria-label="Weight and share of risk by holding"></canvas></div>
        <div class="st-scroll"><table class="nt st-tbl sd-tbl"><thead><tr><th class="l">Holding</th><th>Weight</th><th>Share of risk</th><th>Component VaR</th><th>Marginal VaR <span class="sd-th-s">per ₹1 L more</span></th></tr></thead><tbody>
          ${capRows(o.cvar.rows.map((x) => `<tr><td class="l"><b>${esc(x.h.n)}</b>${tagHTML(x.h)}</td><td>${pc(x.w, 1)}</td><td><b>${pc(x.share, 1)}</b></td><td>${rsShort(x.cvar, true)}</td><td>${rsShort(x.mvar * 1e5, true)}</td></tr>`), 5)}
        </tbody></table></div>
        <p class="sd-def-s sd-tdef">Component VaR: each holding's part of the 1-day 99% VaR (${rsShort(o.cvar.varRs, true)}); they add up to the total. Marginal VaR: how much that VaR rises if you add ₹1 lakh more to the holding.</p>`)}

      ${sec('liq', 'Liquidity', `
        <div class="sd-grid g4" id="sdLiq">${liqCards(o)}</div>`)}

      ${sec('method', 'Method & data', `
        <details class="sd-fold"><summary>How it works, and data checks</summary>${dataHTML(o)}</details>
        ${ltHTML(o)}
        ${o.fails.length ? `<p class="st-note warn">Left out (no price history found): ${o.fails.map(esc).join(', ')}.</p>` : ''}
        ${o.cal.live ? '<p class="st-note warn">Sector, size, crude and full history files are still being prepared, so this run uses the market and the rupee only.</p>' : ''}`)}

      <div class="st-foot">
        <button type="button" class="sx-btn" id="stPrint">Save as PDF</button>
        <button type="button" class="sx-btn" id="stShare">Copy share link</button>
        <p>Stress results are not forecasts. Educational tool, not investment advice.</p>
      </div>
      </div>`;
    wireDash(o);
    drawAll(o); drawDown(o); drawTorn(o); drawComp(o);
    if (window.PlutusStressAnim) window.PlutusStressAnim.countUp($('.sd-hero'));
    res.classList.remove('sx-in'); void res.offsetWidth; res.classList.add('sx-in');
  }

  /* ---- 1–3, 24–25: what the chosen stress does */
  function picked(o) { return allScenarios(o).find((x) => x.id === st.sc) || allScenarios(o)[0]; }
  function impactHTML(o) {
    const s = picked(o), T = o.Pf.total, rec = R.recovery(s.ret, o.growth);
    const real = s.kind === 'Historical' && s.ref.win && s.ref.win.recovered ? s.ref.win.recovered.days : null;
    const period = real != null ? `${Math.max(1, Math.round(real / 21))} months` : rec.years == null ? '—' : rec.years < 1 ? `${Math.max(1, Math.round(rec.years * 12))} months` : `${rec.years.toFixed(1)} years`;
    const periodSub = real != null ? 'how long it actually took' : `estimate at ${pc(o.growth, 0)} a year${s.kind === 'Historical' && s.ref.win && !s.ref.win.recovered ? ' · it hadn\'t recovered in the data' : ''}`;
    return [
      M('Stressed P&amp;L', rsShort(s.pnl), esc(s.name), 'Rupee gain or loss on today\'s holdings if this scenario happened now.', breach(s.ret) ? 'bad' : ''),
      M('Stressed return', loss(s.ret), breach(s.ret) ? `over your ${Math.round(st.limit * 100)}% limit` : `within your ${Math.round(st.limit * 100)}% limit`, 'The same loss as a share of the portfolio.', breach(s.ret) ? 'bad' : ''),
      M('Stressed value', rsShort(T + s.pnl, true), `from ${rsShort(T, true)} today`, 'What the portfolio would be worth after the stress (stressed NAV).'),
      M('Return to recover', s.ret < 0 ? `+${pcLoss(rec.need, 1)}` : '0%', 'to get back to today\'s value', 'After a fall of x, the gain needed to recover is x ÷ (1 − x): a 50% fall needs a 100% gain.'),
      M('Recovery period', period, periodSub, 'For a past crisis: how long your holdings actually took to regain their pre-crisis value. Otherwise: years at the portfolio\'s own long-run yearly growth (kept between 6% and 18%).')
    ].join('');
  }
  /* ---- 4–7: downside risk at the chosen horizon */
  function downHTML(o) {
    const [i, label, h] = HZ[st.hz], a = o.risk[0.95][i], b = o.risk[0.99][i], sv = o.svarH[i], T = o.Pf.total, dd = o.dd;
    return [
      M('VaR 95%', `(${pcLoss(a.hist, 1)})`, `${rsShort(-a.hist * T)} · 1 ${h === 1 ? 'day' : h === 21 ? 'month' : '10-day stretch'} in 20 worse`, `Historical value at risk: the ${label} loss beaten in only 5% of the ${h === 1 ? 'days' : `overlapping ${label} stretches`} of the last ${Math.round(o.daily.r.length / 250)} years.`),
      M('VaR 99%', `(${pcLoss(b.hist, 1)})`, `${rsShort(-b.hist * T)} · 1 ${h === 1 ? 'day' : h === 21 ? 'month' : '10-day stretch'} in 100 worse`, `The ${label} loss beaten in only 1% of the history.`),
      M('Stressed VaR 99%', sv ? `(${pcLoss(sv.var, 1)})` : '—', sv ? `${rsShort(-sv.var * T)} · ${mon(sv.from)}–${mon(sv.to)}` : '', `VaR 99% measured only over the worst 12-month stretch on record (the Basel rule) — a bad ${label} in a bad year.`, 'warn'),
      M('Expected shortfall', `(${pcLoss(b.histES, 1)})`, `${rsShort(-b.histES * T)} · avg beyond VaR 99%`, 'The average loss on the occasions worse than VaR 99% — how bad "bad" gets.'),
      M('Max drawdown', loss(dd.dd), `${mon(dd.peak)} → ${mon(dd.trough)}${dd.recovered ? ` · back by ${mon(dd.recovered)}` : ' · not yet recovered'}`, 'The deepest peak-to-trough fall of today\'s holdings over the whole history.', 'bad')
    ].join('');
  }
  /* ---- 18–19 */
  function liqCards(o) {
    const s = picked(o), adj = s.ret + o.exitS.pct, T = o.Pf.total;
    return [
      M('Days to sell everything', o.liq.d100 == null ? '—' : days(o.liq.d100).replace(' trading', ''), o.liqS.d100 == null ? '' : `${days(o.liqS.d100).replace(' trading', '').toLowerCase()} if volume halves`, 'Trading days to sell 100% at no more than 30% of a stock\'s average daily volume (AMFI method: 10% × 3× volume).'),
      M('Half sold in', o.liq.d50 == null ? '—' : days(o.liq.d50).replace(' trading', ''), o.liq.unknown ? `${o.liq.unknown} holding${o.liq.unknown > 1 ? 's' : ''} without volume data` : 'the most liquid half first', 'Days to sell half the portfolio, setting aside the 20% least liquid holdings (AMFI method).'),
      M('Cost of selling', loss(o.exitS.pct, 2), `${rsShort(o.exitS.pnl)} in a stressed market`, 'Spread plus price impact (square-root model) of selling everything with volume halved and volatility doubled.'),
      M('Liquidity-adjusted loss', loss(adj), `${rsShort(adj * T)} · ${esc(s.name)}`, 'The stressed loss of the chosen scenario plus the cost of selling everything in that market.', breach(adj) ? 'bad' : '')
    ].join('');
  }
  /* ---- 11–12: correlation heatmap (largest 10 holdings) */
  function heatHTML(o) {
    const m = st.cm === 'crisis' ? o.cm.crisis : o.cm.normal, hs = o.cmPick, short = (n) => String(n).replace(/\s+(Ltd|Limited)\.?$/i, '').slice(0, 14);
    const col = (c) => (c == null ? 'transparent' : c >= 0 ? `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, c) * 85)}%, transparent)` : `color-mix(in srgb, var(--warn) ${Math.round(Math.min(1, -c) * 85)}%, transparent)`);
    return `<table class="sd-cm" style="--n:${hs.length}"><thead><tr><th></th>${hs.map((h) => `<th title="${esc(h.n)}"><span>${esc(short(h.n))}</span></th>`).join('')}</tr></thead><tbody>${hs.map((h, i) => `<tr><th class="l" title="${esc(h.n)}">${esc(short(h.n))}</th>${hs.map((_, j) => { const c = m.M[i][j]; return `<td style="background:${col(c)}" class="${c != null && Math.abs(c) > 0.55 ? 'hi' : ''}" title="${esc(h.n)} · ${esc(hs[j].n)}: ${c == null ? 'too little shared history' : c.toFixed(2)}">${i === j ? '' : c == null ? '·' : c.toFixed(2).replace(/^(-?)0\./, '$1.')}</td>`; }).join('')}</tr>`).join('')}</tbody></table>${o.Pf.holdings.length > hs.length ? `<p class="sd-def-s">Largest ${hs.length} holdings.</p>` : ''}`;
  }

  function wireDash(o) {
    wireNav();
    const root = $('#sdRoot');
    root.addEventListener('click', (e) => {
      const i = e.target.closest('.sd-i');
      if (i) { const m = i.closest('.sd-m'), on = m.classList.toggle('open'); i.setAttribute('aria-expanded', String(on)); return; }
      const hz = e.target.closest('[data-hz]');
      if (hz) { st.hz = +hz.dataset.hz; $$('[data-hz]').forEach((b) => { const on = b === hz; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); $('#sdDown').innerHTML = downHTML(o); drawDown(o, true); return; }
      const cm = e.target.closest('[data-cm]');
      if (cm) { st.cm = cm.dataset.cm; $$('[data-cm]').forEach((b) => b.classList.toggle('on', b === cm)); $('#sdHeat').innerHTML = heatHTML(o); }
    });
    $('#sdExplain').onclick = (e) => { st.explain = root.classList.toggle('explain'); e.currentTarget.textContent = `${st.explain ? 'Hide' : 'Show'} explanations`; e.currentTarget.setAttribute('aria-pressed', String(st.explain)); };
    $('#sdPick').onchange = (e) => { st.sc = e.target.value; $('#sdImpact').innerHTML = impactHTML(o); $('#sdLiq').innerHTML = liqCards(o); highlightPick(); };
    const rp = $('#sdReplay');
    rp.addEventListener('toggle', () => { if (rp.open && !rp.dataset.on && window.PlutusStressAnim) { rp.dataset.on = 1; window.PlutusStressAnim.mount($('#stAnim'), { full: o.full, scen: o.scen, total: o.Pf.total, limit: st.limit }); } });
    $('#stPrint').onclick = () => { $$('.sd-fold').forEach((d) => { d.open = true; }); window.print(); };
    $('#stShare').onclick = async () => { const u = location.href.split('#')[0] + shareHash(); try { await navigator.clipboard.writeText(u); $('#stShare').textContent = 'Link copied'; } catch (e) { prompt('Copy this link', u); } setTimeout(() => { const b = $('#stShare'); if (b) b.textContent = 'Copy share link'; }, 2000); };
  }

  /* ---- shared navigation (the bar jumps and follows the scroll) */
  let spy = null;
  function wireNav() {
    const nav = $('.st-tabs'), track = $('.sn-track', nav), tabs = $$('.sn-tab', nav);
    const barH = () => { const tb = $('#topbar'); return tb ? tb.getBoundingClientRect().height : 68; };
    const offset = () => barH() + nav.offsetHeight + 12;
    const mark = (id) => {
      tabs.forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      const on = tabs.find((b) => b.dataset.tab === id);
      if (on && track.scrollWidth > track.clientWidth + 2) track.scrollTo({ left: Math.max(0, on.offsetLeft - (track.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' });
    };
    let jumping = 0;
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      const el = $(`#sd-${b.dataset.tab}`); if (!el) return;
      mark(b.dataset.tab); jumping = Date.now();
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset() + 4, behavior: 'smooth' });
    });
    if (spy) window.removeEventListener('scroll', spy);
    let raf = 0, last = '';
    spy = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!nav.isConnected) { window.removeEventListener('scroll', spy); return; }
        if (Date.now() - jumping < 700) return;
        const line = offset() + 8; let cur = SECTIONS[0][0];
        SECTIONS.forEach(([id]) => { const el = $(`#sd-${id}`); if (el && el.getBoundingClientRect().top <= line) cur = id; });
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1][0];
        if (cur !== last) { last = cur; mark(cur); }
      });
    };
    window.addEventListener('scroll', spy, { passive: true });
  }

  /* ---- charts */
  function chartBase() { if (P().setupChartDefaults) try { P().setupChartDefaults(); } catch (e) { /* ok */ } }
  const limitLine = { id: 'stLimit', afterDatasetsDraw(c) { const x = c.scales.x, y = c.chartArea; if (!x || !isNum(c.options.plugins.stLimit && c.options.plugins.stLimit.v)) return; const px = x.getPixelForValue(c.options.plugins.stLimit.v); const g = c.ctx; g.save(); g.strokeStyle = css('--warn', '#c2410c'); g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, y.top); g.lineTo(px, y.bottom); g.stroke(); g.restore(); } };
  const vLines = { id: 'sdV', afterDatasetsDraw(c) { const L = c.options.plugins.sdV && c.options.plugins.sdV.lines; if (!L) return; const x = c.scales.x, a = c.chartArea, g = c.ctx; L.forEach((l) => { const px = x.getPixelForValue(l.i); g.save(); g.strokeStyle = l.c; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, a.top + 14); g.lineTo(px, a.bottom); g.stroke(); g.fillStyle = l.c; g.font = '600 10px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(l.t, px, a.top + 9); g.restore(); }); } };
  // long names are shortened on narrow screens (the full name is in the tooltip)
  function shortLabel(v) { const t = this.getLabelForValue(v), max = window.innerWidth < 640 ? 16 : 34; return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; }
  const pctTick = (v) => pc(v / 100);
  function highlightPick() {
    const c = st.charts.find((x) => x.canvas && x.canvas.id === 'stAllChart'); if (!c) return;
    const all = c.$all; c.data.datasets[0].borderWidth = all.map((s) => (s.id === st.sc ? 2 : 0)); c.update('none');
  }
  function drawAll(o) {
    if (!window.Chart) return; chartBase();
    const all = allScenarios(o), acc = css('--accent', '#2a49c4'), warn = css('--warn', '#c2410c'), mut = css('--dim', '#9aa3b2'), hi = css('--hi', '#111');
    const cv = $('#stAllChart'); cv.parentElement.style.height = `${Math.max(300, all.length * 19 + 50)}px`;
    const c = new Chart(cv, {
      type: 'bar', plugins: [limitLine],
      data: { labels: all.map((s) => s.name), datasets: [{ label: 'Your loss', data: all.map((s) => +(s.ret * 100).toFixed(1)), backgroundColor: all.map((s) => (breach(s.ret) ? warn : s.kind === 'Historical' ? acc : mut)), borderColor: hi, borderWidth: all.map((s) => (s.id === st.sc ? 2 : 0)), borderRadius: 3, barPercentage: 0.8 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        onClick: (e, els) => { if (!els.length) return; st.sc = all[els[0].index].id; const sel = $('#sdPick'); if (sel) { sel.value = st.sc; sel.dispatchEvent(new Event('change')); } },
        plugins: { stLimit: { v: -st.limit * 100 }, legend: { display: false }, tooltip: { callbacks: { title: (x) => all[x[0].dataIndex].name, label: (x) => `${all[x.dataIndex].kind}: ${loss(x.raw / 100)} · ${rsShort(all[x.dataIndex].pnl)}`, footer: () => 'Click to see its numbers' } } },
        scales: { x: { ticks: { callback: pctTick } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 }, callback: shortLabel } } }
      }
    });
    c.$all = all; st.charts.push(c);
  }
  function drawDown(o, redraw) {
    if (!window.Chart) return; chartBase();
    if (redraw) { st.charts = st.charts.filter((c) => { if (c.canvas && /^sd(Hist|DD)$/.test(c.canvas.id)) { c.destroy(); return false; } return true; }); }
    const acc = css('--accent', '#2a49c4'), warn = css('--warn', '#c2410c'), bad = css('--bad', '#cf2e3e'), mut = css('--dim', '#9aa3b2');
    // histogram of returns at the chosen horizon, with VaR 95 / 99 lines
    const hh = $('#sdHistH'); if (hh) hh.textContent = `${st.hz ? HZ[st.hz][1] : 'Daily'} returns, last ${Math.round(o.daily.r.length / 250)} years`;
    const h = HZ[st.hz][2], r = R.horizon(o.daily.r, h), lo = Math.max(-0.4, Math.min(...r)), hiV = Math.min(0.4, Math.max(...r));
    const B = 40, wd = (hiV - lo) / B || 0.001, bins = Array(B).fill(0);
    r.forEach((x) => { const k = Math.min(B - 1, Math.max(0, Math.floor((x - lo) / wd))); bins[k]++; });
    const mid = bins.map((_, k) => lo + (k + 0.5) * wd), v95 = -o.risk[0.95][st.hz].hist, v99 = -o.risk[0.99][st.hz].hist;
    const idx = (v) => Math.max(0, Math.min(B - 1, (v - lo) / wd - 0.5));
    st.charts.push(new Chart($('#sdHist'), {
      type: 'bar', plugins: [vLines],
      data: { labels: mid.map((m) => pc(m, 1)), datasets: [{ data: bins, backgroundColor: mid.map((m) => (m <= v99 ? bad : m <= v95 ? warn : acc)), borderRadius: 2, barPercentage: 1, categoryPercentage: 0.95 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { sdV: { lines: [{ i: idx(v99), c: bad, t: 'VaR 99' }, { i: idx(v95), c: warn, t: 'VaR 95' }] }, legend: { display: false }, tooltip: { callbacks: { title: (x) => `Around ${x[0].label}`, label: (x) => `${x.raw} ${h === 1 ? 'days' : 'periods'}` } } }, scales: { x: { ticks: { maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } }, y: { ticks: { maxTicksLimit: 4 } } } }
    }));
    if (redraw && $('#sdDD') && st.charts.some((c) => c.canvas && c.canvas.id === 'sdDD')) return;
    // drawdown ("underwater") curve over the full history, sampled weekly
    let g = 1, pk = 1; const dd = [], lab = [];
    o.full.r.forEach((x, i) => { g *= 1 + x; pk = Math.max(pk, g); if (i % 5 === 0) { dd.push(+((g / pk - 1) * 100).toFixed(2)); lab.push(o.full.dates[i]); } });
    st.charts.push(new Chart($('#sdDD'), {
      type: 'line',
      data: { labels: lab, datasets: [{ data: dd, borderColor: bad, backgroundColor: `color-mix(in srgb, ${bad} 18%, transparent)`, fill: 'origin', pointRadius: 0, borderWidth: 1.4, tension: 0.1 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (x) => mon(x[0].label), label: (x) => `From the previous high: ${loss(x.raw / 100)}` } } }, scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0, callback(v) { return String(this.getLabelForValue(v)).slice(0, 4); } }, grid: { display: false } }, y: { max: 0, ticks: { maxTicksLimit: 5, callback: pctTick } } } }
    }));
  }
  function drawTorn(o) {
    if (!window.Chart) return; chartBase();
    const s = o.sens2, rows = [['Market down 10%', s.mkt.ret], ['Rates up 2%', s.rates.ret], ['Rupee 10% weaker', s.fx.ret], ['Crude up 25%', s.oil.ret], ['P/E down 20%', o.pe.ret]].sort((a, b) => a[1] - b[1]);
    const good = css('--good', '#0a875a'), bad = css('--bad', '#cf2e3e');
    $('#sdTornWrap').style.height = `${rows.length * 38 + 40}px`;
    st.charts.push(new Chart($('#sdTorn'), {
      type: 'bar',
      data: { labels: rows.map((x) => x[0]), datasets: [{ data: rows.map((x) => +(x[1] * 100).toFixed(2)), backgroundColor: rows.map((x) => (x[1] < 0 ? bad : good)), borderRadius: 3, barPercentage: 0.7 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${loss(x.raw / 100)} · ${rsShort((x.raw / 100) * o.Pf.total)}` } } }, scales: { x: { ticks: { callback: pctTick } }, y: { grid: { display: false } } } }
    }));
  }
  function drawComp(o) {
    if (!window.Chart) return; chartBase();
    const rows = o.vc.rows.slice(0, 10), acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    $('#sdCompWrap').style.height = `${rows.length * 34 + 50}px`;
    st.charts.push(new Chart($('#sdComp'), {
      type: 'bar',
      data: { labels: rows.map((x) => x.h.n.replace(/\s+(Ltd|Limited)\.?$/i, '')), datasets: [{ label: 'Weight', data: rows.map((x) => +(x.w * 100).toFixed(1)), backgroundColor: mut, borderRadius: 3 }, { label: 'Share of risk', data: rows.map((x) => +(x.share * 100).toFixed(1)), backgroundColor: acc, borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { ticks: { callback: pctTick } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback: shortLabel } } } }
    }));
  }

  // v58: which funds were tested through their stocks
  function ltHTML(o) {
    const ns = o.ltNotes || []; if (!ns.length) return '';
    const why = { mixed: (n) => `only ${Math.round(n.eq)}% in stocks`, none: () => 'its stocks couldn\'t be found', off: () => 'look-through switched off' };
    return `<div class="st-ltnote"><h3>Your mutual funds</h3><ul>${ns.map((n) => n.nav
      ? `<li><b>${esc(shortFund(n.n))}</b> — tested as one fund on its daily NAV (${why[n.why](n)}).</li>`
      : `<li><b>${esc(shortFund(n.n))}</b> — tested through <b>${n.stocks} of its ${n.all} stocks</b>${/^\d{4}-\d{2}/.test(n.asof || '') ? `, portfolio of ${mon(n.asof)}` : ''}${n.unmatched || n.noPrice ? ` (${[n.unmatched ? `${n.unmatched} not matched to an NSE listing` : '', n.noPrice ? `${n.noPrice} without price history` : ''].filter(Boolean).join(', ')}; their weight is spread across the rest)` : ''}. Stocks you also hold directly are combined.</li>`).join('')}</ul></div>`;
  }
  const tagHTML = (h) => (h.tag ? `<span class="st-via">${esc(h.tag)}</span>` : '');
  // long holding tables: the first 15 rows, the rest behind "Show all"
  const CAP = 15;
  const capRows = (rows, cols) => rows.length <= CAP + 2 ? rows.join('') : rows.map((r, i) => (i < CAP ? r : r.replace(/^<tr/, '<tr data-extra'))).join('') + `<tr class="st-showall"><td colspan="${cols}"><button type="button" class="sx-btn" data-showall>Show all ${rows.length} holdings</button></td></tr>`;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-showall]'); if (!b) return; const t = b.closest('table'); const on = t.classList.toggle('st-open'); b.textContent = on ? 'Show fewer' : `Show all ${t.querySelectorAll('tbody tr:not(.st-showall):not(.st-total)').length} holdings`; });
  function dataHTML(o) {
    const hs = o.Pf.holdings.slice().sort((a, b) => b.value - a.value);
    return `
      <dl class="st-gloss">
        <dt>Stress scenarios</dt><dd>${o.scen.filter((x) => x.ret != null).length} past Indian crises replay each holding's real daily returns over the crisis window; ${o.lib.length} what-if shocks run through a factor model (market, sector beyond the market, size, rupee, crude; 3 years of weekly returns, Blume-adjusted betas). Holdings not listed during a crisis are estimated from the same model.</dd>
        <dt>VaR, stressed VaR, expected shortfall</dt><dd>Historical, from the last ${o.daily.r.length.toLocaleString('en-IN')} trading days of today's holdings (overlapping stretches for 10 days and 1 month). Stressed VaR uses the worst 250-day window since ${mon(o.full.dates[0])}.</dd>
        <dt>Beta, downside beta, volatility</dt><dd>Beta: value-weighted holding betas. Downside beta: regression on the days the Nifty fell (last 3 years). Today's volatility: EWMA (λ 0.94).</dd>
        <dt>Correlation</dt><dd>Normal: last 3 years. In crises: only days inside the past-crisis windows. Only days both holdings traded count.</dd>
        <dt>Component and marginal VaR</dt><dd>Euler allocation of the 1-day 99% parametric VaR, from each holding's covariance with the portfolio (last 3 years).</dd>
        <dt>Liquidity</dt><dd>AMFI's liquidity stress method; selling cost from half the spread plus a square-root price-impact model, with volume halved and volatility doubled.</dd>
        <dt>Mutual funds</dt><dd>Equity funds are tested through their stocks (Groww's published portfolio, up to ${LT_MAX} stocks); funds under ${LT_MIN_EQ}% in stocks on their daily NAV (MFapi.in).</dd>
      </dl>
      <div class="st-scroll"><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Size</th><th>History from</th><th>Beta</th><th>Fit (R²)</th><th class="l">Flags</th></tr></thead><tbody>
        ${capRows(hs.map((h) => `<tr><td class="l"><b>${esc(h.n)}</b>${tagHTML(h)}<span class="st-sym">${esc(h.secName)}</span></td><td>${SIZE[h.size] || '—'}</td><td>${mon(h.dq.start)}</td><td>${h.beta.bm.toFixed(2)}</td><td>${h.beta.dflt ? '—' : `${Math.round(h.beta.r2 * 100)}%`}</td><td class="l">${h.dq.flags.length ? h.dq.flags.map((f) => `<span class="st-est warn">${esc(f)}</span>`).join(' ') : '<span class="st-dim">None</span>'}</td></tr>`), 6)}
      </tbody></table></div>
      <p class="st-note">Market data ${o.cal.built ? `updated ${dt(String(o.cal.built).slice(0, 10))}` : 'loaded live'} · last trading day ${dt(o.cal.dates[o.cal.dates.length - 1])} · Yahoo Finance, screener.in, MFapi.in, Groww.</p>`;
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
      st.sc = p; $('#stQ').value = p.n; setTimeout(() => $('#stAmt').focus(), 60);
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
