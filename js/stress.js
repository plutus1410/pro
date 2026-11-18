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
  const TABS = [
    ['hist', 'Historical', 'Historical stress', 'Past Indian crises, replayed on what you own today'],
    ['hypo', 'Hypothetical', 'Hypothetical stress', 'Shocks that could happen next'],
    ['factors', 'Factors', 'Factor sensitivity', 'What drives your portfolio up and down'],
    ['business', 'Business', 'Business stress', 'Can the companies themselves take a hit?'],
    ['mc', 'Monte Carlo', 'Monte Carlo simulation', 'Thousands of possible next years'],
    ['reverse', 'Reverse', 'Reverse stress test', 'What it would take to break your limit'],
    ['liq', 'Liquidity', 'Liquidity stress', 'How fast, and at what cost, you could sell'],
    ['risk', 'Risk breakdown', 'Risk breakdown', 'Where the risk sits, by every standard measure'],
    ['data', 'Method', 'Data and method', 'Inputs, checks and definitions']
  ];

  const st = { list: load(), limit: loadLimit(), mc: null, out: null, charts: [], mcSeq: 0, pick: null, pending: null, tab: 'overview', drawn: new Set(), conf: 0.99, shock: { NIFTY: -0.2, s1: '', v1: 0, s2: '', v2: 0, FX: 0, OIL: 0 }, scen: '' };

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
    if (st.out) { const y = window.scrollY; render(st.out); window.scrollTo(0, y); }
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
    destroyCharts(); st.mc = null; st.mcSeq++;
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
    const out = {
      cal, Pf, fails, ltNotes, daily, full, scen,
      lib: R.runLibrary(Pf), sens: R.sensitivity(Pf), exp: R.exposures(Pf, cal),
      fund: R.FUND.map((f) => ({ ...f, ...R.runFund(Pf, f.p) })),
      risk: { 0.95: R.riskTable(daily.r, [1, 10, 21], 0.95), 0.99: R.riskTable(daily.r, [1, 10, 21], 0.99) },
      kup: R.kupiec(daily.r, 0.99, 500), svar: R.stressedVaR(full.r, full.dates, 0.99, 250), dd: R.drawdown(full.r, full.dates),
      contrib: R.contributions(Pf, daily, 0.99), vc: R.volContrib(Pf, daily, 750), conc: R.concentration(Pf),
      crash: R.crashCheck(Pf, cal, 2500), liq: R.liquidity(Pf, 'adv3'), liqS: R.liquidityStressed(Pf), exit: R.exitCost(Pf, false), exitS: R.exitCost(Pf, true)
    };
    out.vs = R.vsMarket(scen);
    out.text = R.explain(Pf, scen);
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


  /* ---------------------------------------------------------------- v57: key terms, emphasised and explained
     The first time each term appears in a section it is highlighted, with its meaning on hover / focus / tap. */
  const GLOSSARY = [
    [/\bstressed VaR\b/, 'Stressed VaR', 'Value at risk measured only over the worst 12-month stretch in history — a bad day in a bad year (the Basel bank rule).'],
    [/\bvalue at risk\b|\bVaR\b/i, 'VaR', 'Value at risk: a loss that is beaten only rarely. A 99% one-day VaR of 3% means 1 day in 100 is expected to be worse than −3%.'],
    [/\bexpected shortfall\b|\bES\b/, 'ES', 'Expected shortfall: the average loss on the days worse than VaR — how bad "bad" gets.'],
    [/\bbeta\b/i, 'Beta', 'How much the portfolio moves for a 1% move in the Nifty 50. Above 1 = swings more than the market.'],
    [/\bvolatility\b/i, 'Volatility', 'How much returns swing around their average in a typical year (annualised standard deviation).'],
    [/\bmaximum drawdown\b|\bdeepest fall\b/i, 'Drawdown', 'Maximum drawdown: the biggest peak-to-trough fall before a new high.'],
    [/\bcorrelation\b/i, 'Correlation', 'How alike two things move: 1 = in lockstep, 0 = unrelated. High correlation means less diversification.'],
    [/\bMonte Carlo\b/, 'Monte Carlo', 'Simulating thousands of possible futures from the portfolio\'s own behaviour, to see the range of outcomes.'],
    [/\breverse stress test\b/i, 'Reverse stress test', 'Starting from a loss you can\'t accept and working out what would have to happen to cause it.'],
    [/\bfactor model\b/i, 'Factor model', 'Explains each holding\'s moves by a few drivers — the market, its sector, size, the rupee and crude.'],
    [/\bsensitivit(?:y|ies)\b/i, 'Sensitivity', 'How much something moves for a 1% move in a driver (a beta).'],
    [/\brisk contribution\b|\bshare of risk\b/i, 'Risk contribution', 'Each holding\'s share of the portfolio\'s total volatility. The shares add up to 100%.'],
    [/\bloss limit\b/i, 'Loss limit', 'The loss you have said you couldn\'t accept. Scenarios beyond it are flagged.'],
    [/\bP\/E\b/, 'P/E', 'Price-to-earnings ratio: what investors pay for each rupee of yearly profit.'],
    [/\bEPS\b/, 'EPS', 'Earnings per share: yearly profit divided by the number of shares.'],
    [/\bcredit losses\b/i, 'Credit losses', 'Loans that borrowers don\'t repay — the main way a downturn hits a bank\'s profit.'],
    [/\bprice impact\b/i, 'Price impact', 'How much a sale itself pushes the price down — bigger for large orders in thinly traded stocks.'],
    [/\bbootstrap\b/i, 'Bootstrap', 'Building simulated years from real stretches of past days, picked at random.'],
    [/\bStudent-t\b/, 'Student-t', 'A bell curve with fatter tails, so extreme days happen more often than a normal curve allows.'],
    [/\bKupiec\b/, 'Kupiec test', 'A back-test: checks that a 99% VaR has been beaten on about 1 day in 100, not more.'],
    [/\bliquidity\b/i, 'Liquidity', 'How quickly something can be sold without pushing its price down.']
  ];
  const SKIP = 'dfn, .st-term, button, select, option, input, textarea, label.st-pick, canvas, svg, .st-q, .sa-pills, .sa-read, .st-key, h1, h2, h3, .section-head, .st-flag, .st-badge, .st-card > span';
  function emphasise(root) {
    if (!root) return;
    const blocks = [...root.querySelectorAll('.st-summary, .st-pane, #stMc')];
    blocks.forEach((box) => {
      const used = new Set([...box.querySelectorAll('dfn')].map((d) => (GLOSSARY.find(([re]) => re.test(d.textContent)) || [])[1]).filter(Boolean));
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.data.trim() || (n.parentElement && n.parentElement.closest(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        let n = node;
        for (;;) {
          let best = null;
          GLOSSARY.forEach(([re, key, def]) => { if (used.has(key)) return; const m = re.exec(n.data); if (m && (!best || m.index < best.m.index)) best = { m, key, def }; });
          if (!best) break;
          used.add(best.key);
          const after = n.splitText(best.m.index); const rest = after.splitText(best.m[0].length);
          const d = document.createElement('dfn'); d.className = 'st-term key'; d.tabIndex = 0; d.dataset.q = best.def; d.textContent = after.data;
          after.replaceWith(d); n = rest;
        }
      });
    });
  }

  /* ---------------------------------------------------------------- results: helpers */
  function destroyCharts() { st.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* gone */ } }); st.charts = []; }
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || f;
  const tip = (t) => `<span class="st-q" tabindex="0" role="note" aria-label="${esc(t)}" data-q="${esc(t)}">?</span>`;
  const term = (word, def) => `<dfn class="st-term" tabindex="0" data-q="${esc(def)}">${word}</dfn>`; // a key term, explained on hover / focus
  const num = (x) => `<strong class="st-num">${x}</strong>`;                                         // a number that matters
  const SIZE = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' };
  const breach = (ret) => isNum(ret) && ret <= -st.limit;
  const flag = (ret) => (breach(ret) ? '<span class="st-flag" title="Beyond your loss limit">Over limit</span>' : '');
  function card(label, big, sub, help, cls) { return `<div class="st-card${cls ? ' ' + cls : ''}"><span>${esc(label)}${help ? ' ' + tip(help) : ''}</span><b>${big}</b><em>${sub || ''}</em></div>`; }
  function takeaway(html) { return `<p class="st-take"><span class="st-take-k">Key finding</span>${html}</p>`; }
  const pane = (id, html) => {
    const i = TABS.findIndex((t) => t[0] === id), t = TABS[i];
    return `<section class="section st-pane" id="stPane-${id}" data-pane="${id}" aria-labelledby="stH-${id}"><div class="section-head"><span class="idx">${String(i + 1).padStart(2, '0')}</span><h2 id="stH-${id}">${t[2]}</h2><p>${esc(t[3])}</p></div>${html}</section>`;
  };
  // every scenario on one scale: historical crises + hypothetical shocks
  function allScenarios(o) {
    return o.scen.filter((s) => s.ret != null).map((s) => ({ name: s.name, ret: s.ret, pnl: s.pnl, kind: 'Historical' }))
      .concat(o.lib.map((s) => ({ name: s.name, ret: s.ret, pnl: s.pnl, kind: 'Hypothetical' })))
      .sort((a, b) => a.ret - b.ret);
  }

  /* ---------------------------------------------------------------- results: page */
  function render(o) {
    destroyCharts();
    const res = $('#stRes'), all = allScenarios(o), worst = all[0], over = all.filter((x) => breach(x.ret));
    const r30 = o.risk[0.99][2], lim = Math.round(st.limit * 100);
    if (!st.scen || !o.scen.find((s) => s.id === st.scen && s.ret != null)) { const w = o.scen.filter((s) => s.ret != null).sort((a, b) => a.ret - b.ret)[0]; st.scen = w ? w.id : ''; }
    res.innerHTML = `
      <section class="st-summary" aria-labelledby="stSumH">
        <div class="st-sum-top">
          <h2 id="stSumH" class="st-h2">Results at a glance</h2>
          ${o.vs ? `<span class="st-badge lv${o.vs.level}">Risk vs the market: ${esc(o.vs.label)}</span>` : ''}
        </div>
        <div class="st-alert ${over.length ? 'warn' : 'ok'}" role="status">
          ${over.length
            ? `<b>${over.length} of ${all.length} scenarios</b> would cost you more than your <b>${lim}% loss limit</b> — the worst is the <b>${esc(worst.name)}</b> at <b>${pcLoss(worst.ret)}</b>.`
            : `<b>None of the ${all.length} scenarios</b> goes past your <b>${lim}% loss limit</b>. The worst is the <b>${esc(worst.name)}</b> at <b>${pcLoss(worst.ret)}</b>.`}
        </div>
        <div class="st-cards st-cards-6">
          ${card('Portfolio value', rsShort(o.Pf.total, true), `${o.Pf.holdings.length} holding${o.Pf.holdings.length > 1 ? 's' : ''}`)}
          ${card('Worst-case loss', pcLoss(worst.ret), `${rsShort(worst.pnl, true)} lost · ${esc(worst.name)}`, 'The biggest loss across all past crises and what-if shocks below. A stress result, not a forecast — it is not a likely outcome.', 'main')}
          ${card('Loss in a bad month', pcLoss(r30.hist, 1), `${rsShort(r30.hist * o.Pf.total, true)} · 1 month in 100 is worse`, '30-day value at risk (VaR) at 99%: from overlapping 21-trading-day stretches of the last 10 years.')}
          <div id="stKpiMc">${card('Loss in a bad year', '…', 'Simulating…', '1-year value at risk at 95% from the Monte Carlo simulation: 1 year in 20 is expected to be worse.')}</div>
          ${card('Volatility', pc(o.vc.vol, 1), 'typical yearly swing', 'Annualised standard deviation of daily returns over the last 3 years. Higher means a bumpier ride.')}
          ${card('Selling half', o.liq.d50 == null ? '—' : days(o.liq.d50), o.liqS.d50 == null ? '' : `${days(o.liqS.d50).toLowerCase()} if trading halves`, 'Days to sell half the portfolio without moving prices much, by SEBI\'s mutual fund (AMFI) method.')}
        </div>
        <div class="st-anim" id="stAnim"></div>
        <h3 class="st-h3">Every scenario, side by side</h3>
        <p class="st-lead">Your loss in each past crisis and what-if shock, worst first.</p>
        <ul class="st-key" aria-label="Chart key"><li><i class="k-hist"></i>Past crisis</li><li><i class="k-hypo"></i>What-if shock</li><li><i class="k-over"></i>Beyond your limit</li><li><i class="k-line"></i>Your ${lim}% loss limit</li></ul>
        <div class="st-chart tall"><canvas id="stAllChart" aria-label="Portfolio loss in every scenario"></canvas></div>
        ${o.text.length ? `<div class="st-explain"><h3>What this means</h3>${o.text.map((t) => `<p>${esc(t)}</p>`).join('')}${leversHTML(o)}</div>` : ''}
        ${ltHTML(o)}
        ${o.fails.length ? `<p class="st-note warn">Left out (no price history found): ${o.fails.map(esc).join(', ')}.</p>` : ''}
        ${o.cal.live ? '<p class="st-note warn">Sector, size, crude and full history files are still being prepared, so this run uses the market and the rupee only.</p>' : ''}
      </section>
      <nav class="secnav st-tabs" aria-label="Jump to a section"><div class="sn-track">${TABS.map(([id, label], i) => `<button type="button" class="sn-tab${i ? '' : ' on'}" data-tab="${id}" aria-controls="stPane-${id}">${label}</button>`).join('')}</div></nav>
      ${pane('hist', histHTML(o))}
      ${pane('hypo', hypoHTML(o))}
      ${pane('factors', factorsHTML(o))}
      ${pane('business', businessHTML(o))}
      ${pane('mc', '<div id="stMc"><div class="sx-wait"><div class="orbit sm"><span></span></div><span>Simulating…</span></div></div>')}
      ${pane('reverse', reverseHTML(o))}
      ${pane('liq', liqHTML(o))}
      ${pane('risk', riskHTML(o))}
      ${pane('data', dataHTML(o))}
      <div class="st-foot">
        <button type="button" class="sx-btn" id="stPrint">Save as PDF</button>
        <button type="button" class="sx-btn" id="stShare">Copy share link</button>
        <p>Historical, hypothetical and Monte Carlo results answer different questions, so they are kept apart — and none of them is a forecast. Figures for holdings that weren't listed at the time are estimates. This is an educational tool, not investment advice, and it doesn't recommend buying, selling or holding any security.</p>
      </div>`;
    wireNav(o);
    drawAll(o); drawHist(o); drawContrib(o); drawHeat(o); wireShock(o); drawSens(o);
    $('#stScen').onchange = (e) => { st.scen = e.target.value; drawContrib(o); };
    $('#stFundSel').onchange = (e) => { st.fund = e.target.value; drawFund(o); }; drawFund(o);
    $('#stConf').onchange = (e) => { st.conf = +e.target.value; $('#stRiskT').innerHTML = riskTable(o); };
    const rl = $('#stRevLimit'); rl.value = lim; rl.addEventListener('change', () => setLimit(+rl.value));
    $('#stPrint').onclick = () => window.print();
    $('#stShare').onclick = async () => { const u = location.href.split('#')[0] + shareHash(); try { await navigator.clipboard.writeText(u); $('#stShare').textContent = 'Link copied'; } catch (e) { prompt('Copy this link', u); } setTimeout(() => { const b = $('#stShare'); if (b) b.textContent = 'Copy share link'; }, 2000); };
    if (st.mc) showMc(o, st.mc);
    if (window.PlutusStressAnim) { window.PlutusStressAnim.mount($('#stAnim'), { full: o.full, scen: o.scen, total: o.Pf.total, limit: st.limit }); window.PlutusStressAnim.countUp($('.st-summary')); }
    emphasise(res);
    res.classList.remove('sx-in'); void res.offsetWidth; res.classList.add('sx-in');
  }
  function leversHTML(o) {
    const w = o.scen.filter((s) => s.ret != null).sort((a, b) => a.ret - b.ret)[0], L = R.levers(o.Pf, w);
    if (!L.length) return '';
    return `<h3>What moves the worst crisis most</h3><ul class="st-levers">${L.map((x) => `<li>With <b>${esc(x.h.n)}</b> ${Math.round(x.cut * 100)} percentage points smaller (the rest scaled up), the ${esc(w.name)} loss goes from <b>${pcLoss(x.from, 1)}</b> to <b>${pcLoss(x.to, 1)}</b>.</li>`).join('')}</ul><p class="st-note">This shows what drives the result. It is not a recommendation to buy or sell.</p>`;
  }

  /* ---- shared navigation (stacked sections; the bar jumps and follows the scroll) */
  let spy = null;
  function wireNav() {
    const nav = $('.st-tabs'), track = $('.sn-track', nav), tabs = $$('.sn-tab', nav);
    const barH = () => { const tb = $('#topbar'); return tb ? tb.getBoundingClientRect().height : 68; };
    const offset = () => barH() + nav.offsetHeight + 16;
    const mark = (id) => {
      tabs.forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      const on = tabs.find((b) => b.dataset.tab === id);
      if (on && track.scrollWidth > track.clientWidth + 2) track.scrollTo({ left: Math.max(0, on.offsetLeft - (track.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' });
    };
    let jumping = 0;
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      const sec = $(`#stPane-${b.dataset.tab}`); if (!sec) return;
      mark(b.dataset.tab); jumping = Date.now();
      window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - offset() + 4, behavior: 'smooth' });
    });
    if (spy) window.removeEventListener('scroll', spy);
    let raf = 0, last = '';
    spy = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!nav.isConnected) { window.removeEventListener('scroll', spy); return; }
        if (Date.now() - jumping < 700) return;
        const line = offset() + 8; let cur = TABS[0][0];
        TABS.forEach(([id]) => { const el = $(`#stPane-${id}`); if (el && el.getBoundingClientRect().top <= line) cur = id; });
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = TABS[TABS.length - 1][0];
        if (cur !== last) { last = cur; mark(cur); }
      });
    };
    window.addEventListener('scroll', spy, { passive: true });
  }

  /* ---- 01 historical stress */
  function histHTML(o) {
    const sc = o.scen.filter((s) => s.ret != null), w = sc.slice().sort((a, b) => a.ret - b.ret)[0], est = o.scen.some((s) => s.est);
    const rec = (x) => (!x.win ? '—' : x.win.recovered ? `${Math.max(1, Math.round(x.win.recovered.days / 21))} mo` : 'Not yet');
    return `
      ${w ? takeaway(`If the <b>${esc(w.name)}</b> happened to what you own today, you would lose ${num(pcLoss(w.ret))} (${num(rsShort(w.pnl, true))})${w.nifty != null ? `, against ${num(pcLoss(w.nifty))} for the Nifty 50` : ''}.`) : ''}
      <p class="st-lead">Each crisis replays the <b>actual day-by-day moves</b> of your holdings, so the way they fell together is kept. ${est ? 'Holdings that weren\'t listed then are estimated from how they move with the market and their sector today, with a likely range.' : ''}</p>
      <h3 class="st-h3">Your portfolio vs the Nifty 50</h3>
      <div class="st-chart tall"><canvas id="stHistChart" aria-label="Portfolio versus Nifty in each crisis"></canvas></div>
      <h3 class="st-h3">Crisis by crisis</h3>
      <div class="st-scroll"><table class="nt st-tbl st-wide"><thead><tr><th class="l">Crisis</th><th class="l">When</th><th>Your loss</th><th>In ₹</th><th>Nifty 50</th><th>Worst day ${tip('The single worst day for your portfolio inside the crisis.')}</th><th>Worst month ${tip('The worst 21-trading-day stretch inside the crisis.')}</th><th>Deepest fall ${tip('Peak-to-trough fall inside the crisis (maximum drawdown).')}</th><th>Recovery ${tip('How long it took, from the low, to get back to the value before the crisis.')}</th></tr></thead><tbody>
        ${o.scen.map((s) => `<tr${breach(s.ret) ? ' class="st-over"' : ''}><td class="l"><b>${esc(s.name)}</b><span class="st-sym">${esc(s.note)}${s.est && s.band > 0.002 ? ` · likely ${pc(s.ret - s.band)} to ${pc(s.ret + s.band)}` : ''}</span>${flag(s.ret)}</td><td class="l">${s.from ? (s.from === s.to ? dt(s.from) : `${mon(s.from)} – ${mon(s.to)}`) : 'Before the data starts'}</td><td><b>${pc(s.ret, 1)}</b></td><td>${rs(s.pnl)}</td><td>${pc(s.nifty, 1)}</td><td>${s.win ? pc(s.win.worstDay, 1) : '—'}</td><td>${s.win && s.win.worstMonth != null ? pc(s.win.worstMonth, 1) : '—'}</td><td>${s.win ? pc(s.win.maxDD, 1) : '—'}</td><td>${rec(s)}</td></tr>`).join('')}
      </tbody></table></div>
      <h3 class="st-h3">Which holdings drove the loss</h3>
      <label class="st-pick">Crisis <select id="stScen">${sc.map((s) => `<option value="${s.id}"${s.id === st.scen ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div id="stContrib"></div>
      <h3 class="st-h3">Loss by sector</h3>
      <p class="st-lead">Your sectors across every crisis. Darker cells lost more.</p>
      <div class="st-scroll" id="stHeat"></div>`;
  }
  function chartBase() { if (P().setupChartDefaults) try { P().setupChartDefaults(); } catch (e) { /* ok */ } }
  const limitLine = { id: 'stLimit', afterDatasetsDraw(c) { const x = c.scales.x, y = c.chartArea; if (!x || !isNum(c.options.plugins.stLimit && c.options.plugins.stLimit.v)) return; const px = x.getPixelForValue(c.options.plugins.stLimit.v); const g = c.ctx; g.save(); g.strokeStyle = css('--warn', '#c2410c'); g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, y.top); g.lineTo(px, y.bottom); g.stroke(); g.restore(); } };
  // long scenario names are shortened on narrow screens (the full name is in the tooltip and the tables)
  function shortLabel(v) { const t = this.getLabelForValue(v), max = window.innerWidth < 640 ? 18 : 40; return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t; }
  function drawAll(o) {
    if (!window.Chart) return; chartBase();
    const all = allScenarios(o), acc = css('--accent', '#2a49c4'), warn = css('--warn', '#c2410c'), mut = css('--dim', '#9aa3b2');
    const cv = $('#stAllChart'); cv.parentElement.style.height = `${Math.max(320, all.length * 22 + 60)}px`;
    st.charts.push(new Chart(cv, {
      type: 'bar', plugins: [limitLine],
      data: { labels: all.map((s) => s.name), datasets: [{ label: 'Your loss', data: all.map((s) => +(s.ret * 100).toFixed(1)), backgroundColor: all.map((s) => (breach(s.ret) ? warn : s.kind === 'Historical' ? acc : mut)), borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { stLimit: { v: -st.limit * 100 }, legend: { display: false }, tooltip: { callbacks: { title: (x) => all[x[0].dataIndex].name, label: (x) => `${all[x.dataIndex].kind}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { ticks: { callback: (v) => pc(v / 100) } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 }, callback: shortLabel } } } }
    }));
  }
  function drawHist(o) {
    if (!window.Chart) return; chartBase();
    const sc = o.scen.filter((s) => s.ret != null), acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    const cv = $('#stHistChart'); cv.parentElement.style.height = `${Math.max(320, sc.length * 30 + 60)}px`;
    st.charts.push(new Chart(cv, {
      type: 'bar', plugins: [limitLine],
      data: { labels: sc.map((s) => s.name), datasets: [{ label: 'Your portfolio', data: sc.map((s) => +(s.ret * 100).toFixed(1)), backgroundColor: acc, borderRadius: 3 }, { label: 'Nifty 50', data: sc.map((s) => (s.nifty == null ? null : +(s.nifty * 100).toFixed(1))), backgroundColor: mut, borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { stLimit: { v: -st.limit * 100 }, legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { ticks: { callback: (v) => pc(v / 100) } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback: shortLabel } } } }
    }));
  }
  function drawContrib(o) {
    const s = o.scen.find((x) => x.id === st.scen), el = $('#stContrib'); if (!s || !el) return;
    const rows = s.rows.slice().sort((a, b) => a.pnl - b.pnl);
    el.innerHTML = `<table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Value now</th><th>Move</th><th>Loss in ₹</th><th>Share of loss</th><th><span class="sr-only">Try it smaller</span></th></tr></thead><tbody>
      ${capRows(rows.map((r) => `<tr><td class="l"><b>${esc(r.h.n)}</b>${tagHTML(r.h)}${r.est ? '<span class="st-est" title="Not listed then — estimated">estimate</span>' : ''}</td><td>${rs(r.h.value)}</td><td>${pc(r.ret, 1)}</td><td>${rs(r.pnl)}</td><td>${s.pnl < 0 && r.pnl < 0 ? `<b>${Math.round((r.pnl / s.pnl) * 100)}%</b>` : '—'}</td><td>${r.h.direct > 0 || r.h.kind === 'mf' ? `<button type="button" class="st-trim" data-trim="${esc(r.h.item.code || r.h.s)}" title="Reduce this holding by 10% and run again">−10%</button>` : ''}</td></tr>`), 6)}
      <tr class="st-total"><td class="l">Portfolio</td><td>${rs(o.Pf.total)}</td><td>${pc(s.ret, 1)}</td><td>${rs(s.pnl)}</td><td></td><td></td></tr></tbody></table>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-trim]'); if (!b) return;
      const it = st.list.find((x) => (x.code || x.s) === b.dataset.trim); if (!it) return;
      it.v = Math.round(it.v * 0.9 * 100) / 100; save(); refreshList();
      const y = window.scrollY; run().then(() => window.scrollTo(0, y));
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

  /* ---- 02 hypothetical stress */
  function hypoHTML(o) {
    const w = o.lib.slice().sort((a, b) => a.ret - b.ret)[0];
    const secKeys = Object.keys(o.cal.f).filter((k) => !['NIFTY', 'FX', 'OIL', 'MID', 'SMALL'].includes(k));
    const group = (g, title) => {
      const rows = o.lib.filter((x) => x.group === g);
      return `<h3 class="st-h3">${title}</h3><table class="nt st-tbl"><thead><tr><th class="l">Scenario</th><th class="l">Assumption</th><th>Your loss</th><th>In ₹</th></tr></thead><tbody>
        ${rows.map((x) => `<tr${breach(x.ret) ? ' class="st-over"' : ''}><td class="l"><b>${esc(x.name)}</b>${flag(x.ret)}</td><td class="l st-dim">${esc(x.what)}</td><td><b>${pc(x.ret, 1)}</b></td><td>${rs(x.pnl)}</td></tr>`).join('')}</tbody></table>`;
    };
    return `
      ${w ? takeaway(`The hardest what-if is <b>${esc(w.name)}</b>: you would lose ${num(pcLoss(w.ret))} (${num(rsShort(w.pnl, true))}).`) : ''}
      <p class="st-lead">Shocks that may never have happened in exactly this combination. Each holding moves by its <b>measured sensitivity</b> to the market, its size group, its sector, the rupee and crude. The moves are <b>illustrative assumptions, not predictions</b>.</p>
      ${R.HYPO_GROUPS.map(([g, t]) => group(g, t)).join('')}
      ${o.cal.f.MID ? '' : '<p class="st-note">Midcap and smallcap index data is still being prepared; until then mid and small caps move with the Nifty by their own beta.</p>'}
      <h3 class="st-h3">Build your own</h3>
      <div class="st-presets">${R.HYPO.map((p) => `<button type="button" class="sx-chip" data-pre="${p.id}">${esc(p.name)}</button>`).join('')}</div>
      <div class="st-shockgrid">
        <div class="st-shock">
          ${slider('NIFTY', 'Nifty 50', -60, 30)}
          ${slider('MID', 'Midcaps', -70, 30)}
          ${slider('SMALL', 'Smallcaps', -80, 30)}
          <div class="st-srow"><select id="stS1" aria-label="First sector">${secOpts(secKeys, o.cal, st.shock.s1)}</select>${slider('v1', '', -60, 40, true)}</div>
          <div class="st-srow"><select id="stS2" aria-label="Second sector">${secOpts(secKeys, o.cal, st.shock.s2)}</select>${slider('v2', '', -60, 40, true)}</div>
          ${o.cal.f.FX ? slider('FX', 'Dollar vs rupee', -15, 30) : ''}
          ${o.cal.f.OIL ? slider('OIL', 'Brent crude', -60, 100) : ''}
          <p class="st-note">Dollar vs rupee: up means a weaker rupee. A sector left as "Sector…" moves with the market. Midcap and smallcap moves apply to your mid- and small-cap holdings.</p>
        </div>
        <div id="stShockOut" class="st-shockout" aria-live="polite"></div>
      </div>`;
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
      const s = { NIFTY: st.shock.NIFTY, MID: st.shock.MID, SMALL: st.shock.SMALL, FX: st.shock.FX || 0, OIL: st.shock.OIL || 0, sectors: {} };
      if (st.shock.s1) s.sectors[st.shock.s1] = st.shock.v1;
      if (st.shock.s2) s.sectors[st.shock.s2] = st.shock.v2;
      const r = R.runShock2(o.Pf, s), top = r.rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 6);
      $('#stShockOut').innerHTML = `<div class="st-big"><span>Your portfolio</span><b>${pc(r.ret, 1)}</b><em>${rs(r.pnl)} on ${rsShort(o.Pf.total, true)}${breach(r.ret) ? ' · <span class="st-flag">Over limit</span>' : ''}</em></div>
        <table class="nt st-tbl"><thead><tr><th class="l">Biggest moves</th><th>Move</th><th>In ₹</th></tr></thead><tbody>${top.map((x) => `<tr><td class="l">${esc(x.h.n)}</td><td>${pc(x.ret, 1)}</td><td>${rs(x.pnl)}</td></tr>`).join('')}</tbody></table>`;
    };
    const set = (k, v) => { const i = $(`[data-sh="${k}"]`); if (i) i.value = Math.round((v || 0) * 100); };
    $('.st-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pre]'); if (!b) return;
      $$('.st-presets [data-pre]').forEach((x) => x.classList.toggle('on', x === b));
      const p = R.HYPO.find((x) => x.id === b.dataset.pre).s, secs = Object.entries(p.sectors || {}).filter(([k]) => o.cal.f[k]);
      const N = p.NIFTY || 0;
      set('NIFTY', N); set('MID', isNum(p.MID) ? p.MID : N * o.Pf.bb.mid); set('SMALL', isNum(p.SMALL) ? p.SMALL : N * o.Pf.bb.small); set('FX', p.FX); set('OIL', p.OIL);
      $('#stS1').value = secs[0] ? secs[0][0] : ''; set('v1', secs[0] ? secs[0][1] : 0);
      $('#stS2').value = secs[1] ? secs[1][0] : ''; set('v2', secs[1] ? secs[1][1] : 0);
      read();
    });
    sl.forEach((i) => i.addEventListener('input', () => { $$('.st-presets [data-pre]').forEach((x) => x.classList.remove('on')); read(); }));
    $('#stS1').onchange = read; $('#stS2').onchange = read;
    if (!isNum(st.shock.MID)) { st.shock.MID = st.shock.NIFTY * o.Pf.bb.mid; st.shock.SMALL = st.shock.NIFTY * o.Pf.bb.small; set('MID', st.shock.MID); set('SMALL', st.shock.SMALL); }
    read();
  }

  /* ---- 03 factor sensitivity */
  function factorsHTML(o) {
    const e = o.exp, row = (name, sens, help, extra) => `<tr><td class="l"><b>${name}</b>${help ? ` ${tip(help)}` : ''}</td><td><b>${sens.toFixed(2)}</b></td><td>${pc(-0.1 * sens, 1)}</td><td>${pc(0.1 * sens, 1)}</td><td class="l st-dim">${extra || ''}</td></tr>`;
    const hs = o.Pf.holdings.slice().sort((a, b) => b.value - a.value);
    return `
      ${takeaway(`For every ${num('1%')} the Nifty 50 moves, your portfolio moves about ${num(`${e.market.toFixed(2)}%`)} — ${e.market > 1.1 ? 'more than the market' : e.market < 0.9 ? 'less than the market' : 'roughly with the market'}.`)}
      <p class="st-lead">A <b>factor model</b> splits each holding's moves into the drivers below, fitted on 3 years of weekly returns. The <b>sensitivity</b> (beta) is how much you move for a 1% move in the driver.</p>
      <h3 class="st-h3">Your portfolio's drivers</h3>
      <table class="nt st-tbl"><thead><tr><th class="l">Driver</th><th>Sensitivity</th><th>If it falls 10%</th><th>If it rises 10%</th><th class="l">Notes</th></tr></thead><tbody>
        ${row('Nifty 50 (the market)', e.market, 'Market beta, weighted across holdings (adjusted toward 1, the Blume method).')}
        ${e.size.mid ? row('Midcaps, beyond the market', e.size.mid, 'Your mid-cap weight: an extra 1% midcap fall (beyond what the Nifty explains) costs you this much.', `${pc(e.size.mid)} of the portfolio is mid cap`) : ''}
        ${e.size.small ? row('Smallcaps, beyond the market', e.size.small, 'Your small-cap weight: an extra 1% smallcap fall costs you this much.', `${pc(e.size.small)} of the portfolio is small cap`) : ''}
        ${e.sectors.slice(0, 6).map(([k, v]) => row(`${esc(o.cal.names[k] || k)}, beyond the market`, v, 'How much you move when this sector index moves 1% more than the market would explain.')).join('')}
        ${e.fx != null ? row('Dollar vs rupee', e.fx, 'Positive: a weaker rupee helps (exporters). Negative: it hurts (importers, foreign debt).') : ''}
        ${e.oil != null ? row('Brent crude', e.oil, 'Negative: costlier oil hurts. Positive: it helps (producers).') : ''}
      </tbody></table>
      <h3 class="st-h3">How the loss grows with the market</h3>
      <div class="st-chart sm"><canvas id="stSensChart" aria-label="Portfolio loss versus Nifty fall"></canvas></div>
      <details class="st-more-d"><summary>Each holding's sensitivities</summary>
        <div class="st-scroll"><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Size</th><th>Market</th><th>Sector (beyond market)</th><th>Rupee</th><th>Crude</th><th>Fit ${tip('R²: how much of the weekly moves these drivers explain.')}</th></tr></thead><tbody>
          ${capRows(hs.map((h) => `<tr><td class="l">${esc(h.n)}${tagHTML(h)}</td><td>${SIZE[h.size] || '—'}</td><td>${h.beta.bm.toFixed(2)}</td><td>${h.beta.sk ? `${h.beta.bs.toFixed(2)} <span class="st-dim">${esc(o.cal.names[h.beta.sk] || h.beta.sk)}</span>` : '—'}</td><td>${o.cal.f.FX ? h.beta.bfx.toFixed(2) : '—'}</td><td>${o.cal.f.OIL ? h.beta.boil.toFixed(2) : '—'}</td><td>${h.beta.dflt ? '—' : `${Math.round(h.beta.r2 * 100)}%`}</td></tr>`), 7)}
        </tbody></table></div></details>`;
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

  /* ---- 04 business (fundamental) stress */
  function businessHTML(o) {
    const m = o.fund[1];
    if (!st.fund) st.fund = 'fmod';
    return `
      ${m.ret != null ? takeaway(`If business conditions worsen moderately, the companies you own would be worth ${num(pcLoss(m.ret))} less on today's valuation logic (${num(rsShort(m.pnl, true))}).`) : takeaway('Company financials aren\'t available for these holdings yet, so business stress can\'t be run.')}
      <p class="st-lead">Price shocks are only half the story. This asks whether the <b>businesses</b> can absorb a hit: lower <b>revenue</b>, thinner <b>margins</b>, higher <b>interest costs</b> — and whether investors would pay a lower <b>P/E</b> for them. Banks are stressed through <b>credit losses</b> instead.</p>
      <p class="st-formula"><span>Stressed share price</span> = <b>stressed EPS</b> × <b>stressed P/E</b></p>
      <h3 class="st-h3">Three levels of business stress</h3>
      <table class="nt st-tbl"><thead><tr><th class="l">Level</th><th>Revenue</th><th>Operating margin</th><th>Interest cost</th><th>P/E</th><th>Bank credit losses</th><th>Value change</th><th>In ₹</th></tr></thead><tbody>
        ${o.fund.map((f) => `<tr${breach(f.ret) ? ' class="st-over"' : ''}><td class="l"><b>${f.name}</b>${flag(f.ret)}</td><td>down ${Math.round(f.p.rev * 100)}%</td><td>down ${Math.round(f.p.margin * 10000)} bp</td><td>up ${Math.round(f.p.int * 100)}%</td><td>down ${Math.round(f.p.pe * 100)}%</td><td>profit down ${Math.round(f.p.credit * 100)}%</td><td><b>${pc(f.ret, 1)}</b></td><td>${rs(f.pnl)}</td></tr>`).join('')}
      </tbody></table>
      <p class="st-note">Covers ${num(pc(o.fund[0].coverage))} of your portfolio (companies with screener.in financials; mutual funds and loss-making companies are left out). A stressed price never goes below 0.6× book value for companies, 0.5× for banks.</p>
      <h3 class="st-h3">Company by company</h3>
      <label class="st-pick">Level <select id="stFundSel">${o.fund.map((f) => `<option value="${f.id}"${f.id === st.fund ? ' selected' : ''}>${f.name}</option>`).join('')}</select></label>
      <div id="stFund"></div>`;
  }
  function drawFund(o) {
    const f = o.fund.find((x) => x.id === st.fund) || o.fund[1], el = $('#stFund'); if (!el) return;
    const rows = f.rows.slice().sort((a, b) => (a.ok ? a.ret : 1) - (b.ok ? b.ret : 1));
    el.innerHTML = `<div class="st-scroll"><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>EPS now</th><th>Stressed EPS</th><th>Price now</th><th>Stressed price</th><th>Change</th></tr></thead><tbody>
      ${rows.map((r) => r.ok ? `<tr><td class="l"><b>${esc(r.h.n)}</b>${r.bank ? '<span class="st-est">bank: credit losses</span>' : ''}</td><td>${isNum(r.eps0) ? `₹${r.eps0.toFixed(1)}` : '—'}</td><td>${isNum(r.eps1) ? br(`₹${Math.abs(r.eps1).toFixed(1)}`, r.eps1) : '—'}</td><td>₹${inr(r.px0)}</td><td>₹${inr(r.px1)}</td><td><b>${pc(r.ret, 1)}</b></td></tr>` : `<tr><td class="l">${esc(r.h.n)}</td><td colspan="5" class="l st-dim">Not modelled — ${esc(r.why)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  /* ---- 05 Monte Carlo (two methods, in slices so the page never freezes) */
  function monteCarlo(o) {
    const my = ++st.mcSeq, total = P().isMobile && P().isMobile() ? 2000 : 10000, step = 1000, boot = [], fat = [], dd = [];
    if (o.daily.r.length < 300) { const el = $('#stMc'); if (el) el.innerHTML = '<p class="st-lead">Not enough history to simulate.</p>'; return; }
    let done = 0;
    const tick = () => {
      if (my !== st.mcSeq) return;
      const to = Math.min(total, done + step);
      const a = R.monteCarlo(o.daily.r, total, 250, 10, 7, done, to), b = R.monteCarloT(o.daily.r, total, 250, 11, done, to);
      boot.push(...a.ret); dd.push(...a.dd); fat.push(...b.ret); done = to;
      if (done < total) { setTimeout(tick, 0); return; }
      st.mc = { total, boot: R.mcSummary(boot), fat: R.mcSummary(fat), dd: dd.slice().sort((x, y) => x - y) };
      showMc(st.out, st.mc);
    };
    setTimeout(tick, 50);
  }
  function showMc(o, mc) {
    const el = $('#stMc'); if (!el || !o) return;
    const b = mc.boot, f = mc.fat, worse = Math.max(b.var95, f.var95);
    const k = $('#stKpiMc'); if (k) k.innerHTML = card('Loss in a bad year', pcLoss(worse), `${rsShort(worse * o.Pf.total, true)} · 1 year in 20 is worse`, '1-year value at risk at 95% from the Monte Carlo simulation (the larger of the two methods).');
    const row = (name, s, help) => `<tr><td class="l"><b>${name}</b> ${tip(help)}</td><td><b>${pcLoss(s.var95)}</b><span class="st-sub">${rsShort(s.var95 * o.Pf.total, true)}</span></td><td>${pcLoss(s.var99)}<span class="st-sub">${rsShort(s.var99 * o.Pf.total, true)}</span></td><td>${pcLoss(s.es95)}<span class="st-sub">${rsShort(s.es95 * o.Pf.total, true)}</span></td><td>${Math.round(s.pLoss * 100)}%</td><td>${pc(s.median)}</td></tr>`;
    el.innerHTML = `
      ${takeaway(`In ${num('1 year in 20')}, the portfolio could fall ${num(`${pcLoss(worse)} or more`)} (${num(rsShort(worse * o.Pf.total, true))}). The chance of ending a year with any loss is about ${num(`${Math.round(Math.max(b.pLoss, f.pLoss) * 100)}%`)}.`)}
      <p class="st-lead">Instead of one crash, ${mc.total.toLocaleString('en-IN')} possible next years are simulated, two different ways. When the methods disagree, the larger loss is the safer guide.</p>
      <h3 class="st-h3">One-year risk</h3>
      <table class="nt st-tbl"><thead><tr><th class="l">Method</th><th>95% VaR ${tip('Value at risk: 1 year in 20 is expected to be worse than this.')}</th><th>99% VaR</th><th>95% expected shortfall ${tip('The average loss in the worst 1 year in 20 — how bad "bad" gets.')}</th><th>Chance of a loss</th><th>Middle year</th></tr></thead><tbody>
        ${row('Historical bootstrap', b, 'Years stitched together from real 10-day stretches of your holdings\' history — keeps real crashes, fat tails and how holdings moved together.')}
        ${row('Fat-tailed simulation', f, 'Random days drawn from a Student-t distribution (5 degrees of freedom) matched to your portfolio\'s average and volatility — allows extreme days rarer than history shows.')}
      </tbody></table>
      <h3 class="st-h3">The range of simulated years</h3>
      <div class="st-chart sm"><canvas id="stMcChart" aria-label="Distribution of simulated one-year returns"></canvas></div>
      <p class="st-note">Historical bootstrap shown. In 1 year in 20, the portfolio fell at least ${pcLoss(R.pct(mc.dd, 0.05))} from a high at some point during the year, even when it ended higher.</p>`;
    emphasise(el);
    if (!window.Chart) return; chartBase();
    const s = b.sorted, lo = Math.max(-0.8, s[0]), hi = Math.min(2, s[s.length - 1]), B = 30, w = (hi - lo) / B, bins = Array(B).fill(0);
    s.forEach((x) => { bins[Math.min(B - 1, Math.max(0, Math.floor((x - lo) / w)))]++; });
    const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    st.charts.push(new Chart($('#stMcChart'), {
      type: 'bar',
      data: { labels: bins.map((_, i) => pc(lo + (i + 0.5) * w)), datasets: [{ label: 'Simulated years', data: bins, backgroundColor: bins.map((_, i) => (lo + (i + 1) * w <= 0 ? mut : acc)), barPercentage: 1, categoryPercentage: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'One-year return' }, ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'Simulated years' } } } }
    }));
  }

  /* ---- 06 reverse stress test */
  function reverseHTML(o) {
    const L = st.limit, rows = R.reverseAll(o.Pf, L, o.scen, o.cal);
    const seen = (r) => {
      if (!r.need || r.k == null) return '<span class="st-dim">—</span>';
      if (r.biz) return r.k <= 0.5 ? '<b>Milder than the mild case</b> in Business stress' : r.k <= 1 ? '<b>Between mild and moderate</b> business stress' : r.k <= 1.5 ? 'Between moderate and severe business stress' : 'Beyond the severe business-stress case';
      if (r.rep) return r.k <= 1 ? '<b>Yes</b> — milder than the real crisis' : r.k <= 1.5 ? 'Worse than the real crisis, but conceivable' : 'Far beyond anything seen';
      return r.k <= 0.2 ? '<b>Often</b> — falls this size come every few years' : r.k <= 0.4 ? '<b>Yes, several times</b> (2008, 2020)' : r.k <= 0.6 ? '<b>Yes</b> — the Nifty fell about 60% in 2008' : 'Never in the Nifty\'s history';
    };
    const easiest = rows.filter((r) => r.need).sort((a, b) => (a.isMult ? a.k / 1.5 : a.k / 0.6) - (b.isMult ? b.k / 1.5 : b.k / 0.6))[0];
    return `
      ${easiest ? takeaway(`The shortest route to a ${num(`${Math.round(L * 100)}% loss`)}: <b>${esc(easiest.path.toLowerCase())}</b> — ${esc(easiest.need)}.`) : takeaway(`No single path below gets you to a ${num(`${Math.round(L * 100)}% loss`)}.`)}
      <p class="st-lead">Normal stress tests ask "how much would I lose if…?". A <b>reverse stress test</b> starts from the loss you can't accept and works backwards to <b>what would have to happen</b>.</p>
      <div class="st-rev"><label for="stRevLimit">Loss limit</label><span class="st-minput sm"><input id="stRevLimit" type="number" min="5" max="90" step="1" inputmode="numeric" /><span>%</span></span><span class="st-dim">Same as the limit above your holdings — change either one.</span></div>
      <table class="nt st-tbl"><thead><tr><th class="l">Route</th><th class="l">What would have to happen</th><th class="l">Has it happened before?</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l"><b>${esc(r.path)}</b></td><td class="l">${r.need ? esc(r.need) : '<span class="st-dim">Even a total collapse wouldn\'t do it</span>'}</td><td class="l">${seen(r)}</td></tr>`).join('')}
      </tbody></table>
      <p class="st-note">Each route changes one thing at a time; in a real crisis several happen together, so the true threshold is usually closer than any single row suggests.</p>`;
  }

  /* ---- 07 liquidity stress */
  function liqHTML(o) {
    const rows = o.liq.rows.filter((r) => isNum(r.days) && r.h.kind !== 'mf').sort((a, b) => b.days - a.days).slice(0, 10);
    const w = o.scen.filter((s) => s.ret != null).sort((a, b) => a.ret - b.ret)[0];
    return `
      ${takeaway(`Selling half the portfolio takes ${num(days(o.liq.d50).toLowerCase())} normally and ${num(days(o.liqS.d50).toLowerCase())} if trading dries up. Selling everything in a crisis could cost about ${num(pcLoss(o.exitS.pct, 1))} (${num(rsShort(-o.exitS.pnl, true))}) in price impact.`)}
      <p class="st-lead">A portfolio can look liquid in calm markets and be hard to sell in a crash, when <b>trading volume falls</b> and <b>price impact</b> rises. This uses SEBI's method for mutual funds (AMFI): sell a slice of every holding each day at no more than 10% of three times the average daily trading, after setting aside the 20% least liquid holdings.</p>
      <h3 class="st-h3">Days to sell</h3>
      <table class="nt st-tbl"><thead><tr><th class="l">To sell</th><th>Normal trading</th><th>Trading halved (stress)</th></tr></thead><tbody>
        <tr><td class="l">A quarter of the portfolio</td><td>${days(o.liq.d25)}</td><td><b>${days(o.liqS.d25)}</b></td></tr>
        <tr><td class="l">Half of the portfolio</td><td>${days(o.liq.d50)}</td><td><b>${days(o.liqS.d50)}</b></td></tr>
        <tr><td class="l">Everything</td><td>${days(o.liq.d100)}</td><td><b>${days(o.liqS.d100)}</b></td></tr>
      </tbody></table>
      <h3 class="st-h3">Cost of selling everything ${tip('Half the bid-ask spread (by size class) plus price impact from the square-root model: 0.7 × daily volatility × √(position ÷ daily traded value). Stress: volatility doubled, trading halved.')}</h3>
      <table class="nt st-tbl"><thead><tr><th class="l">Conditions</th><th>Cost</th><th>In ₹</th></tr></thead><tbody>
        <tr><td class="l">Normal market</td><td>${pcLoss(o.exit.pct, 2)}</td><td>${rsShort(-o.exit.pnl, true)}</td></tr>
        <tr><td class="l">Stressed market</td><td><b>${pcLoss(o.exitS.pct, 2)}</b></td><td><b>${rsShort(-o.exitS.pnl, true)}</b></td></tr>
        ${w ? `<tr class="st-total"><td class="l">Liquidity-adjusted worst crisis ${tip('The worst historical crisis loss plus the stressed cost of selling.')}</td><td>${pcLoss(w.ret + o.exitS.pct, 1)}</td><td>${rsShort(-(w.pnl + o.exitS.pnl), true)}</td></tr>` : ''}
      </tbody></table>
      ${o.liq.unknown ? `<p class="st-note">${o.liq.unknown} holding${o.liq.unknown > 1 ? 's have' : ' has'} no trading-volume data and ${o.liq.unknown > 1 ? 'are' : 'is'} left out. Mutual funds are treated as sellable within a day at no impact.</p>` : ''}
      ${rows.length ? `<details class="st-more-d"><summary>Slowest holdings to sell in full</summary><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Size</th><th>Value</th><th>Sellable a day</th><th>Days to sell all</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l">${esc(r.h.n)}</td><td>${SIZE[r.h.size] || '—'}</td><td>${rs(r.h.value)}</td><td>${rs(r.cap)}</td><td>${days(r.days)}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
  }

  /* ---- 08 risk breakdown (aggregation) */
  function riskHTML(o) {
    const c = o.conc, vc = o.vc, top = vc.rows[0], r1 = o.risk[0.99][0], r30 = o.risk[0.99][2];
    const maxS = Math.max(...vc.rows.map((x) => Math.abs(x.share)), 0.01), maxSec = Math.max(...vc.sectors.map((x) => Math.abs(x[1])), 0.01);
    const bar = (v, m) => `<span class="st-bar"><i style="width:${Math.max(2, Math.round((Math.abs(v) / m) * 100))}%"></i></span>`;
    const worst = allScenarios(o)[0];
    return `
      ${takeaway(`<b>${esc(top.h.n)}</b> is ${num(pc(top.w))} of the money but ${num(pc(top.share))} of the risk. The portfolio swings about ${num(pc(vc.vol))} a year.`)}
      <h3 class="st-h3">Key measures</h3>
      <table class="nt st-tbl st-kv"><tbody>
        <tr><th class="l">Worst-case loss (all scenarios)</th><td><b>${pcLoss(worst.ret, 1)}</b> · ${rsShort(worst.pnl, true)}</td><td class="l st-dim">${esc(worst.name)}</td></tr>
        <tr><th class="l">${term('Maximum drawdown', 'The deepest peak-to-trough fall, replayed day by day since 2004.')} since 2004</th><td><b>${o.dd && o.dd.dd < 0 ? pcLoss(o.dd.dd, 1) : '—'}</b></td><td class="l st-dim">${o.dd && o.dd.peak ? `${mon(o.dd.peak)} → ${mon(o.dd.trough)}; ${o.dd.recovered ? `back by ${mon(o.dd.recovered)}` : 'not yet recovered'}` : ''}</td></tr>
        <tr><th class="l">${term('Value at risk', 'VaR: a loss that is exceeded only rarely — at 99%, on 1 period in 100.')} (99%)</th><td><b>${pcLoss(r1.hist, 1)}</b> a day · <b>${pcLoss(r30.hist, 1)}</b> a month</td><td class="l st-dim">${rsShort(r30.hist * o.Pf.total, true)} in a bad month</td></tr>
        <tr><th class="l">${term('Expected shortfall', 'The average loss beyond VaR: how bad the worst days are on average.')} (99%, 1 day)</th><td><b>${pcLoss(r1.histES, 1)}</b></td><td class="l st-dim">${rsShort(r1.histES * o.Pf.total, true)}</td></tr>
        <tr><th class="l">${term('Volatility', 'Annualised standard deviation of daily returns (last 3 years).')}</th><td><b>${pc(vc.vol, 1)}</b> a year</td><td class="l st-dim"></td></tr>
        <tr><th class="l">${term('Beta', 'How much the portfolio moves for a 1% move in the Nifty 50.')}</th><td><b>${o.exp.market.toFixed(2)}</b></td><td class="l st-dim">${o.crash && o.crash.crash && isNum(o.crash.crash.beta) ? `${o.crash.crash.beta.toFixed(2)} on crash days` : ''}</td></tr>
        <tr><th class="l">${term('Correlation', 'How alike your holdings move: 1 = identical, 0 = unrelated.')} between holdings</th><td><b>${o.crash && o.crash.all && isNum(o.crash.all.corr) ? o.crash.all.corr.toFixed(2) : '—'}</b></td><td class="l st-dim">${o.crash && o.crash.crash && isNum(o.crash.crash.corr) ? `${o.crash.crash.corr.toFixed(2)} on crash days` : ''}</td></tr>
        <tr><th class="l">Largest holding · top 5</th><td><b>${pc(c.top.w)}</b> · <b>${pc(c.top5)}</b></td><td class="l st-dim">${esc(c.top.h.n)}; acts like ${c.effN.toFixed(1)} equal holdings</td></tr>
        <tr><th class="l">Biggest sector</th><td><b>${pc(c.topSector[1])}</b></td><td class="l st-dim">${esc(c.topSector[0])}</td></tr>
        <tr><th class="l">Liquidity-adjusted worst crisis</th><td><b>${(() => { const w = o.scen.filter((s) => s.ret != null).sort((a, b) => a.ret - b.ret)[0]; return w ? pcLoss(w.ret + o.exitS.pct, 1) : '—'; })()}</b></td><td class="l st-dim">including the stressed cost of selling</td></tr>
      </tbody></table>
      <h3 class="st-h3">Risk contribution by holding ${tip('Each holding\'s share of portfolio volatility (component risk: weight × its covariance with the portfolio ÷ portfolio variance). The shares add up to 100%.')}</h3>
      <p class="st-lead">A holding can be a small part of the money and a big part of the risk, if it is volatile and moves with the rest.</p>
      <table class="nt st-tbl st-contrib"><thead><tr><th class="l">Holding</th><th>Weight</th><th class="l st-barcol">Share of risk</th><th>Share of worst-day losses ${tip('Share of the losses on the portfolio\'s worst 1% of days (component expected shortfall).')}</th></tr></thead><tbody>
        ${capRows(vc.rows.map((x) => { const es = o.contrib.find((y) => y.h === x.h); return `<tr><td class="l">${esc(x.h.n)}${tagHTML(x.h)}${x.share > x.w * 1.4 && x.share > 0.08 ? '<span class="st-est warn">above its weight</span>' : ''}</td><td>${pc(x.w, 1)}</td><td class="l st-barcol">${bar(x.share, maxS)}<b>${pc(x.share)}</b></td><td>${es ? pc(es.share) : '—'}</td></tr>`; }), 4)}
      </tbody></table>
      <h3 class="st-h3">Risk contribution by sector</h3>
      <table class="nt st-tbl st-contrib"><thead><tr><th class="l">Sector</th><th>Weight</th><th class="l st-barcol">Share of risk</th></tr></thead><tbody>
        ${vc.sectors.map(([n, v]) => `<tr><td class="l">${esc(n)}</td><td>${pc((c.sectors.find((x) => x[0] === n) || [0, 0])[1], 1)}</td><td class="l st-barcol">${bar(v, maxSec)}<b>${pc(v)}</b></td></tr>`).join('')}
      </tbody></table>
      <h3 class="st-h3">Value at risk, three ways</h3>
      <label class="st-pick">Confidence <select id="stConf"><option value="0.99"${st.conf === 0.99 ? ' selected' : ''}>99% — 1 in 100</option><option value="0.95"${st.conf === 0.95 ? ' selected' : ''}>95% — 1 in 20</option></select></label>
      <div id="stRiskT">${riskTable(o)}</div>
      <div class="st-cards st-cards-sm">
        ${o.svar ? card('Stressed VaR (1 day, 99%)', pcLoss(o.svar.var, 1), `Worst year in history: ${mon(o.svar.from)} – ${mon(o.svar.to)}`, 'The bank-regulation (Basel) version of VaR: measured only over the worst 12-month stretch since 2004.') : ''}
        ${o.kup ? card('Model check', o.kup.pass ? 'Passed' : 'Failed', `${o.kup.breaches} breaches vs ${Math.round(o.kup.expected)} expected in ${o.kup.days.toLocaleString('en-IN')} days`, 'Kupiec test: a 99% VaR should be beaten on about 1 day in 100. Too many breaches means the VaR has been too low.') : ''}
      </div>
      ${o.kup && !o.kup.pass ? '<p class="st-note warn">Historical VaR has been beaten more often than it should be, so treat these numbers as a floor, not a ceiling.</p>' : ''}
      <h3 class="st-h3">Does diversification hold in a crash?</h3>
      ${crashHTML(o.crash)}`;
  }
  function riskTable(o) {
    const t = o.risk[st.conf], H = { 1: '1 day', 10: '10 days', 21: '30 days' };
    return `<table class="nt st-tbl"><thead><tr><th class="l">Period</th><th>Historical VaR</th><th>In ₹</th><th>Expected shortfall</th><th>Recent conditions ${tip('EWMA (RiskMetrics): recent days count more, so it rises quickly when markets get jumpy.')}</th><th>Fat-tail adjusted ${tip('Cornish-Fisher: a normal-curve estimate corrected for lopsided returns and extreme days.')}</th></tr></thead><tbody>
      ${t.map((r) => `<tr><td class="l">${H[r.h]}</td><td><b>${pcLoss(r.hist, 1)}</b></td><td>${rsShort(r.hist * o.Pf.total, true)}</td><td>${pcLoss(r.histES, 1)}</td><td>${pcLoss(r.ewma, 1)}</td><td>${pcLoss(r.cf, 1)}</td></tr>`).join('')}
    </tbody></table><p class="st-note">All figures are losses: a ${Math.round(st.conf * 100)}% VaR of ${pcLoss(t[0].hist, 1)} means ${st.conf === 0.99 ? '1 day in 100' : '1 day in 20'} has been worse than that. 10- and 30-day figures come from overlapping stretches of real history.</p>`;
  }
  function crashHTML(c) {
    if (!c || !c.all || !c.crash) return '<p class="st-lead">Not enough shared trading history across these holdings to compare crash days with normal days.</p>';
    const f = (x) => (isNum(x) ? x.toFixed(2) : '—');
    const worse = c.crash.beta > c.all.beta + 0.1, together = c.n > 1 && c.crash.corr > c.all.corr + 0.1;
    return `<p class="st-lead">Compares the ${c.crash.days} days the Nifty fell 2% or more with all days.</p>
      <table class="nt st-tbl"><thead><tr><th class="l">Measure</th><th>All days</th><th>Crash days</th></tr></thead><tbody>
      <tr><td class="l">Portfolio beta to the Nifty</td><td>${f(c.all.beta)}</td><td><b>${f(c.crash.beta)}</b></td></tr>
      ${c.n > 1 ? `<tr><td class="l">Average correlation between holdings</td><td>${f(c.all.corr)}</td><td><b>${f(c.crash.corr)}</b></td></tr>` : ''}
      <tr><td class="l">Average portfolio day</td><td>${pc(c.all.avg, 2)}</td><td>${pc(c.crash.avg, 2)}</td></tr></tbody></table>
      <p class="st-note">${worse ? 'Your portfolio gets more sensitive to the market on bad days, so calm-day numbers understate crash risk.' : 'Your portfolio\'s sensitivity to the market stays about the same on bad days.'}${together ? ' Your holdings also move more alike in crashes, so diversification protects less exactly when you need it.' : ''}</p>`;
  }

  /* ---- 09 data and method */

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
      <h3 class="st-h3">Data checks</h3>
      <p class="st-lead">Flags point to holdings whose results deserve a second look.</p>
      <div class="st-scroll"><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Size</th><th>History from</th><th>Market beta ${tip('Adjusted (Blume): 0.67 × measured + 0.33. Measured value in brackets.')}</th><th>Fit ${tip('R²: how much of the weekly moves the market, sector, rupee and crude explain.')}</th><th class="l">Flags</th></tr></thead><tbody>
        ${capRows(hs.map((h) => `<tr><td class="l"><b>${esc(h.n)}</b>${tagHTML(h)}<span class="st-sym">${esc(h.secName)}${h.fk ? ` · vs ${esc(o.cal.names[h.fk] || h.fk)}` : ''}</span></td><td>${SIZE[h.size] || '—'}</td><td>${mon(h.dq.start)}</td><td>${h.beta.bm.toFixed(2)} <span class="st-dim">(${h.beta.bmRaw.toFixed(2)})</span></td><td>${h.beta.dflt ? '—' : `${Math.round(h.beta.r2 * 100)}%`}</td><td class="l">${h.dq.flags.length ? h.dq.flags.map((f) => `<span class="st-est warn">${esc(f)}</span>`).join(' ') : '<span class="st-dim">None</span>'}</td></tr>`), 6)}
      </tbody></table></div>
      <h3 class="st-h3">How each test works</h3>
      <dl class="st-gloss">
        <dt>Historical stress</dt><dd>Compounds each holding's real daily returns over the crisis window, so holdings fall together as they really did. A holding not listed then is estimated from a factor model (market, sector beyond the market, rupee, crude; 3 years of weekly returns), with a 90% range.</dd>
        <dt>Hypothetical stress</dt><dd>Applies designed shocks through the same factor model. Mid and small caps (SEBI's market-cap ranks 101–250 and beyond) also take the extra size move. Rate shocks use assumed sector moves, as no free daily bond-yield series is available.</dd>
        <dt>Mutual funds</dt><dd>An equity fund is tested through its stocks (look-through), using its latest published portfolio from Groww: up to its ${LT_MAX} biggest stocks, matched to NSE listings by name, with cash, bonds and unmatched stocks spread across them in proportion. A fund under ${LT_MIN_EQ}% in stocks, or one whose stocks can't be matched, is tested on its daily NAV from MFapi.in.</dd>
        <dt>Factor sensitivity</dt><dd>Portfolio betas are the value-weighted holding betas.</dd>
        <dt>Business stress</dt><dd>From screener.in figures: interest = (profit before tax) ÷ (interest cover − 1); stressed EBITDA = stressed revenue × (margin − cut); stressed profit after a 25% tax; stressed price = price × (stressed profit ÷ profit) × (1 − P/E cut), floored at 0.6× book value (0.5× for banks, which take credit losses instead).</dd>
        <dt>Monte Carlo</dt><dd>${(st.mc ? st.mc.total : 10000).toLocaleString('en-IN')} one-year paths each way: a block bootstrap (random 10-day blocks of real history) and a Student-t simulation (5 degrees of freedom) at the portfolio's mean and volatility.</dd>
        <dt>Reverse stress test</dt><dd>Solves for the size of each kind of shock that produces your loss limit (losses are linear in the shock size; the business route is solved numerically).</dd>
        <dt>Liquidity stress</dt><dd>AMFI's liquidity stress-test method (10% of 3× average daily volume, pro-rata, 20% least liquid set aside), with volume halved for stress; exit cost from half the spread plus a square-root price-impact model.</dd>
        <dt>Risk breakdown</dt><dd>VaR and expected shortfall from the last ${o.daily.r.length.toLocaleString('en-IN')} trading days (days before a stock listed filled from the factor model); stressed VaR over every 250-day window since ${mon(o.full.dates[0])}; risk contributions from the covariance of each holding with the portfolio (last 3 years).</dd>
      </dl>
      <p class="st-note">Market data ${o.cal.built ? `updated ${dt(String(o.cal.built).slice(0, 10))}` : 'loaded live'} · last trading day ${dt(o.cal.dates[o.cal.dates.length - 1])} · prices from Yahoo Finance, sectors and financials from screener.in, fund NAVs from MFapi.in, fund portfolios from Groww.</p>`;
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
