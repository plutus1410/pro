/* ============================================================
   PLUTUS — Portfolio stress test page (#/stress) · v48
   The maths lives in js/stress-engine.js (window.PlutusRisk). Data: data/risk/ (scripts/build_risk.py, nightly);
   anything missing is fetched live from Yahoo / MFapi through the Worker. Holdings stay in this browser.
   ============================================================ */
(function () {
  'use strict';
  const R = window.PlutusRisk;
  const CFG = window.APP_CONFIG || {};
  const P = () => window.PlutusApp || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const KEY = 'plutus.stress.v1';
  const SAMPLE = [['HDFCBANK.NS', 'HDFC Bank', 200000], ['RELIANCE.NS', 'Reliance Industries', 150000], ['TCS.NS', 'Tata Consultancy Services', 150000], ['ITC.NS', 'ITC', 100000], ['BAJFINANCE.NS', 'Bajaj Finance', 100000], ['SUNPHARMA.NS', 'Sun Pharmaceutical', 100000], ['LT.NS', 'Larsen & Toubro', 100000], ['POLYCAB.NS', 'Polycab India', 50000], ['DIXON.NS', 'Dixon Technologies', 50000]];

  const st = { list: load(), out: null, charts: [], mcSeq: 0, pick: null, shock: { NIFTY: -0.2, s1: '', v1: 0, s2: '', v2: 0, FX: 0, OIL: 0 }, scen: '' };

  /* ---------------------------------------------------------------- storage + sharing */
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st.list)); } catch (e) { /* private mode */ } }
  const b64 = { enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))) };
  function shareHash() { return '#/stress/' + b64.enc(JSON.stringify(st.list.map((x) => [x.kind, x.s, x.mode, x.v, x.n, x.code || '']))); }
  function fromHash(arg) {
    try {
      const a = JSON.parse(b64.dec(arg));
      return a.map(([kind, s, mode, v, n, code]) => ({ kind, s, mode, v: +v, n, code: code || undefined })).filter((x) => x.s && x.v > 0);
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- formatting (negatives in brackets) */
  const inr = (v, d) => Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  const neg = (s, v) => (v < 0 ? `(${s})` : s);
  const pc = (x, d) => (isNum(x) ? neg(`${Math.abs(x * 100).toFixed(d == null ? 0 : d)}%`, Math.round(x * 100 * 10 ** (d || 0)) < 0 ? -1 : 1) : '—');
  const rs = (v) => (isNum(v) ? neg(`₹${inr(v)}`, Math.round(v) < 0 ? -1 : 1) : '—');
  function rsShort(v) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v), s = a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${inr(a)}`;
    return neg(s, Math.round(v) < 0 ? -1 : 1);
  }
  const days = (d) => (!isNum(d) ? '—' : d < 1 ? 'under 1 day' : `${Math.ceil(d)} day${Math.ceil(d) > 1 ? 's' : ''}`);

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

  const memo = new Map();
  async function loadSeries(item, cal) {
    const k = item.kind + ':' + (item.code || item.s);
    if (memo.has(k)) return memo.get(k);
    const p = (async () => {
      if (item.kind === 'mf') {
        const u = `https://api.mfapi.in/mf/${encodeURIComponent(item.code)}`;
        let j; try { j = await fetch(u).then(okJSON); } catch (e) { j = await fetch(viaWorker(u)).then(okJSON); }
        const closes = (j.data || []).map((x) => { const [d, m, y] = String(x.date).split('-'); return [`${y}-${m}-${d}`, parseFloat(x.nav)]; }).filter((x) => isNum(x[1]) && x[1] > 0).reverse();
        if (closes.length < 30) throw new Error('no NAV history');
        const a = R.alignCloses(closes, cal.dates);
        return { ...toFrac(a.o, a.r), px: closes[closes.length - 1][1], sec: 'Mutual funds', ind: (j.meta && j.meta.scheme_category) || '', n: (j.meta && j.meta.scheme_name) || item.n };
      }
      const uni = await universe(), u = uni.get(item.s) || {};
      try {
        const j = await siteJSON(`s/${encodeURIComponent(item.s.replace(/\//g, '_'))}.json?t=${bust()}`);
        return { ...toFrac(j.o, j.r), adv3: j.adv3, adv12: j.adv12, px: j.px, sec: j.sec || u.sec, ind: j.ind || u.ind, n: u.n || (j.n && j.n !== item.s ? j.n : '') || item.n };
      } catch (e) {
        const y = await yahooDaily(item.s);
        if (y.closes.length < 20) throw new Error('no prices');
        const a = R.alignCloses(y.closes, cal.dates);
        return { ...toFrac(a.o, a.r), adv3: avg(y.vols.slice(-63)), adv12: avg(y.vols.slice(-250)), px: y.closes[y.closes.length - 1][1], sec: u.sec || '', ind: u.ind || '', n: u.n || item.n };
      }
    })();
    memo.set(k, p); p.catch(() => memo.delete(k));
    return p;
  }

  /* ---------------------------------------------------------------- page shell */
  function shell() {
    const v = $('#viewStress'); if (v.dataset.ready) return;
    v.dataset.ready = '1';
    v.innerHTML = `
      <section class="sx-head">
        <p class="eyebrow">Portfolio stress test</p>
        <h1>How would your portfolio do in a crash?</h1>
        <p class="sx-sub">Replays 10 Indian market crashes on your holdings, plus shocks you design. Everything runs in your browser — your holdings never leave this device.</p>
      </section>
      <section class="sx-box st-edit">
        <div class="st-add">
          <div class="st-search"><input id="stQ" type="text" autocomplete="off" spellcheck="false" placeholder="Add a stock — e.g. HDFC Bank" aria-label="Add a stock" /><ul class="suggest" id="stSug" role="listbox"></ul></div>
          <select id="stMode" aria-label="Amount type"><option value="amt">₹ amount</option><option value="qty">Shares</option></select>
          <input id="stAmt" type="number" min="0" step="any" inputmode="decimal" placeholder="100000" aria-label="Amount" />
          <button type="button" class="sx-btn" id="stAdd">Add</button>
        </div>
        <div class="st-err hidden" id="stErr" role="alert"></div>
        <div class="st-more">
          <label class="sx-btn st-file">Import holdings CSV<input type="file" id="stCsv" accept=".csv,text/csv" hidden /></label>
          <button type="button" class="sx-btn" id="stMf" aria-expanded="false">Add a mutual fund</button>
          <button type="button" class="sx-btn" id="stDemo">Try a sample portfolio</button>
          <button type="button" class="sx-btn" id="stClear">Clear all</button>
        </div>
        <div class="st-mfbox hidden" id="stMfBox">
          <div class="st-search"><input id="stMfQ" type="text" autocomplete="off" placeholder="Fund name — e.g. Parag Parikh Flexi Cap Direct Growth" aria-label="Find a mutual fund" /><ul class="suggest" id="stMfSug" role="listbox"></ul></div>
        </div>
        <div id="stList"></div>
        <div class="sx-actions"><button type="button" class="sx-run" id="stRun">Run stress test</button><span class="st-hint" id="stHint"></span></div>
      </section>
      <section id="stRes" class="st-res"></section>`;
    wireEditor();
  }

  /* ---------------------------------------------------------------- editor */
  function err(msg) { const e = $('#stErr'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }
  function wireEditor() {
    const q = $('#stQ'), amt = $('#stAmt');
    const pick = (it) => { st.pick = { s: it.symbol, n: it.name || it.symbol }; q.value = st.pick.n; err(''); amt.focus(); };
    if (P().attachSearch) P().attachSearch(q, $('#stSug'), pick);
    q.addEventListener('input', () => { st.pick = null; });
    const add = () => {
      const v = parseFloat(amt.value);
      let it = st.pick;
      if (!it && q.value.trim()) { const t = q.value.trim().toUpperCase(); if (/^[A-Z0-9&\-.]{2,20}$/.test(t)) it = { s: /\./.test(t) ? t : t + '.NS', n: t }; }
      if (!it) return err('Pick a company from the list first.');
      if (!(v > 0)) return err('Enter an amount above zero.');
      const mode = $('#stMode').value, ex = st.list.find((x) => x.kind === 'eq' && x.s === it.s);
      if (ex && ex.mode === mode) ex.v += v; else if (ex) { ex.mode = mode; ex.v = v; } else st.list.push({ kind: 'eq', s: it.s, n: it.n, mode, v });
      st.pick = null; q.value = ''; amt.value = ''; err(''); save(); renderList(); q.focus();
    };
    $('#stAdd').onclick = add;
    amt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    amt.addEventListener('input', () => err(''));
    $('#stDemo').onclick = () => { st.list = SAMPLE.map(([s, n, v]) => ({ kind: 'eq', s, n, mode: 'amt', v })); save(); renderList(); run(); };
    $('#stClear').onclick = () => { st.list = []; save(); renderList(); $('#stRes').innerHTML = ''; destroyCharts(); history.replaceState(null, '', '#/stress'); };
    $('#stRun').onclick = () => run();
    $('#stCsv').onchange = (e) => { const f = e.target.files[0]; if (f) f.text().then(importCsv); e.target.value = ''; };
    $('#stMf').onclick = () => { const b = $('#stMfBox'), on = b.classList.toggle('hidden'); $('#stMf').setAttribute('aria-expanded', String(!on)); if (!on) $('#stMfQ').focus(); };
    wireMf();
    $('#stList').addEventListener('input', (e) => {
      const i = e.target.dataset.v; if (i == null) return;
      const v = parseFloat(e.target.value); if (v > 0) { st.list[+i].v = v; save(); weights(); }
    });
    $('#stList').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { st.list.splice(+b.dataset.del, 1); save(); renderList(); } });
  }
  function wireMf() {
    const q = $('#stMfQ'), ul = $('#stMfSug'); let t = null, seq = 0;
    q.addEventListener('input', () => {
      clearTimeout(t); const s = q.value.trim(); if (s.length < 3) { ul.classList.remove('open'); return; }
      t = setTimeout(async () => {
        const my = ++seq, u = `https://api.mfapi.in/mf/search?q=${encodeURIComponent(s)}`;
        let j = []; try { j = await fetch(u).then(okJSON); } catch (e) { try { j = await fetch(viaWorker(u)).then(okJSON); } catch (e2) { j = []; } }
        if (my !== seq) return;
        ul.innerHTML = (j || []).slice(0, 12).map((f) => `<li role="option" data-code="${esc(f.schemeCode)}" data-n="${esc(f.schemeName)}"><span class="s-main"><span class="s-name">${esc(f.schemeName)}</span></span></li>`).join('') || '<li class="s-info">No fund matches that name.</li>';
        ul.classList.add('open');
      }, 300);
    });
    ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-code]'); if (!li) return; e.preventDefault();
      const v = parseFloat(prompt(`Amount invested now in ₹ for\n${li.dataset.n}`, '100000') || '');
      if (v > 0) { st.list.push({ kind: 'mf', s: 'MF' + li.dataset.code, code: li.dataset.code, n: li.dataset.n, mode: 'amt', v }); save(); renderList(); }
      q.value = ''; ul.classList.remove('open');
    });
    q.addEventListener('blur', () => setTimeout(() => ul.classList.remove('open'), 150));
  }
  function renderList() {
    const el = $('#stList');
    if (!st.list.length) { el.innerHTML = '<p class="st-empty">Add a few holdings, import your broker\'s holdings file, or try the sample portfolio.</p>'; $('#stHint').textContent = ''; return; }
    el.innerHTML = `<table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Amount</th><th>Weight</th><th></th></tr></thead><tbody>${st.list.map((x, i) => `
      <tr><td class="l"><b>${esc(x.n)}</b><span class="st-sym">${esc(x.kind === 'mf' ? 'Mutual fund' : x.s.replace(/\.NS$/, ''))}</span></td>
      <td><span class="st-amt">${x.mode === 'qty' ? '' : '₹'}<input type="number" min="0" step="any" value="${x.v}" data-v="${i}" aria-label="Amount for ${esc(x.n)}" />${x.mode === 'qty' ? ' sh' : ''}</span></td>
      <td class="st-w" data-w="${i}">—</td><td><button type="button" class="st-del" data-del="${i}" aria-label="Remove ${esc(x.n)}">×</button></td></tr>`).join('')}</tbody></table>`;
    weights();
  }
  function weights() { // amounts in ₹ are exact; share counts become ₹ once prices load, so they show "—" until a run
    const vals = st.list.map((x) => (x.mode === 'amt' ? x.v : x.px ? x.v * x.px : null));
    const tot = vals.every(isNum) ? vals.reduce((a, b) => a + b, 0) : null;
    document.querySelectorAll('[data-w]').forEach((td) => { const v = vals[+td.dataset.w]; td.textContent = tot && v ? `${((v / tot) * 100).toFixed(1)}%` : '—'; });
    $('#stHint').textContent = `${st.list.length} holding${st.list.length > 1 ? 's' : ''}${tot ? ' · ' + rsShort(tot) : ''}`;
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
    if (hi < 0) return err('Couldn\'t find a stock or symbol column in that file.');
    const H = rows[hi].map((c) => c.toLowerCase());
    const col = (re) => H.findIndex((c) => re.test(c));
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
    err(ok ? (skip ? `Imported ${ok} holdings; skipped ${skip} rows without a quantity or value.` : '') : 'No holdings with a quantity or value were found in that file.');
  }

  /* ---------------------------------------------------------------- run */
  let runSeq = 0;
  async function run() {
    if (!st.list.length) { err('Add at least one holding first.'); return; }
    const my = ++runSeq, res = $('#stRes'), btn = $('#stRun');
    btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
    destroyCharts();
    res.innerHTML = `<div class="sx-load" role="status" aria-live="polite"><div class="sx-load-top"><div class="orbit sm"><span></span></div><div><b id="stStep">Loading market history…</b><span>Twenty years of daily prices for each holding, the market, sectors, the rupee and crude</span></div></div><div class="sx-skel" aria-hidden="true">${'<i></i>'.repeat(5)}</div></div>`;
    res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const done = () => { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); };
    let cal;
    try { cal = await calendar(); } catch (e) {
      done(); console.warn('[PLUTUS stress]', e);
      res.innerHTML = '<div class="sx-empty"><h2>Market history couldn\'t be loaded right now.</h2><p>Please try again in a minute.</p></div>'; return;
    }
    const step = $('#stStep');
    let n = 0; const fails = [];
    const loaded = await Promise.all(st.list.map(async (it) => {
      try { const s = await loadSeries(it, cal); if (step && my === runSeq) step.textContent = `Loading holdings… ${++n} of ${st.list.length}`; return { it, s }; } catch (e) { console.warn('[PLUTUS stress]', it.s, e); fails.push(it.n); return null; }
    }));
    if (my !== runSeq) return;
    const hs = [];
    loaded.filter(Boolean).forEach(({ it, s }) => {
      it.px = s.px; // lets the editor show weights for share counts
      const value = it.mode === 'qty' ? it.v * (s.px || 0) : it.v;
      if (!(value > 0)) return;
      const fk = it.kind === 'mf' ? '' : R.sectorKey(s.sec, s.ind);
      hs.push({ ...s, kind: it.kind, s: it.s, n: s.n || it.n, value, fk: cal.f[fk] ? fk : '', secName: s.sec || 'Other', item: it });
    });
    if (!hs.length) { done(); res.innerHTML = '<div class="sx-empty"><h2>None of these holdings could be loaded.</h2><p>Check the names and try again.</p></div>'; return; }
    if (step) step.textContent = 'Running scenarios…';
    await new Promise((r) => setTimeout(r, 30));
    const Pf = { holdings: hs, total: hs.reduce((a, h) => a + h.value, 0) };
    hs.forEach((h) => { h.beta = R.fit(h, cal); });
    const daily = R.portfolioDaily(Pf, cal, 2500);
    const out = {
      cal, Pf, fails,
      scen: R.runScenarios(Pf, cal),
      sens: R.sensitivity(Pf),
      daily,
      v95: R.varES(daily.r, 0.95), v99: R.varES(daily.r, 0.99), kup: R.kupiec(daily.r, 0.99, 500),
      crash: R.crashCheck(Pf, cal, 2500), liq: R.liquidity(Pf, 'adv3'), liq12: R.liquidity(Pf, 'adv12')
    };
    out.text = R.explain(Pf, out.scen);
    st.out = out; done(); weights();
    history.replaceState(null, '', shareHash());
    render(out);
    monteCarlo(out);
  }

  /* ---------------------------------------------------------------- results */
  function destroyCharts() { st.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* gone */ } }); st.charts = []; }
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || f;
  function render(o) {
    const res = $('#stRes'), sc = o.scen.filter((s) => s.ret != null);
    const worst = sc.length ? sc.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
    const est = o.Pf.holdings.filter((h) => h.beta.dflt).length;
    if (!st.scen || !sc.find((s) => s.id === st.scen)) st.scen = worst ? worst.id : '';
    const secKeys = Object.keys(o.cal.f).filter((k) => !['NIFTY', 'FX', 'OIL'].includes(k));
    res.innerHTML = `
      <div class="st-cards">
        <div class="st-card"><span>Worst historical crash</span><b>${worst ? pc(worst.ret) : '—'}</b><em>${worst ? `${esc(worst.name)} · ${rsShort(worst.pnl)}` : ''}</em></div>
        <div class="st-card"><span>Bad day (1-day VaR, 99%)</span><b>${pc(-o.v99.var, 1)}</b><em>${rsShort(-o.v99.var * o.Pf.total)} · about 1 day in 100</em></div>
        <div class="st-card"><span>Average of the worst 1% of days</span><b>${pc(-o.v99.es, 1)}</b><em>${rsShort(-o.v99.es * o.Pf.total)} (expected shortfall)</em></div>
        <div class="st-card"><span>Days to sell half (AMFI method)</span><b>${o.liq.d50 == null ? '—' : days(o.liq.d50)}</b><em>${o.liq.d100 == null ? '' : `All of it: ${days(o.liq.d100)}`}</em></div>
      </div>
      ${o.text.length ? `<div class="st-explain">${o.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
      ${o.fails.length ? `<p class="st-note">Left out (no price history found): ${o.fails.map(esc).join(', ')}.</p>` : ''}
      ${o.cal.live ? '<p class="st-note">Sector, crude and full history files are still being prepared, so this run uses the market and the rupee only.</p>' : ''}

      <section class="st-sec">
        <h2>Historical crashes</h2>
        <p class="st-lead">Each bar is what your current holdings would have done over that crash, next to the Nifty 50.${est ? ` Holdings not listed at the time are estimated from how they move with the market and their sector today, marked "est."` : ''}</p>
        <div class="st-chart"><canvas id="stScChart" aria-label="Portfolio versus Nifty in each crash"></canvas></div>
        <table class="nt st-tbl"><thead><tr><th class="l">Scenario</th><th class="l">Window</th><th>Your portfolio</th><th>In ₹</th><th>Nifty 50</th><th>Estimated</th></tr></thead><tbody>
          ${o.scen.map((s) => `<tr><td class="l"><b>${esc(s.name)}</b><span class="st-sym">${esc(s.note)}</span></td><td class="l">${s.from ? (s.from === s.to ? esc(s.from) : `${esc(s.from)} → ${esc(s.to)}`) : 'Before the data starts'}</td><td>${pc(s.ret, 1)}</td><td>${rs(s.pnl)}</td><td>${pc(s.nifty, 1)}</td><td>${s.ret == null ? '—' : s.est ? `${s.est} of ${s.rows.length}` : 'none'}</td></tr>`).join('')}
        </tbody></table>
      </section>

      <section class="st-sec">
        <h2>Loss by holding</h2>
        <p class="st-lead">Which holdings drive the loss. Try trimming one by 10% to see how much the result moves.</p>
        <label class="st-pick">Scenario <select id="stScen">${sc.map((s) => `<option value="${s.id}"${s.id === st.scen ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <div id="stContrib"></div>
      </section>

      <section class="st-sec">
        <h2>Loss by sector</h2>
        <p class="st-lead">Your sectors across every crash. Darker cells lost more.</p>
        <div class="st-scroll" id="stHeat"></div>
      </section>

      <section class="st-sec">
        <h2>Design your own shock</h2>
        <p class="st-lead">Move the market, up to two sectors, the rupee and crude. Each holding moves by its measured sensitivity to each of them (3 years of weekly data).</p>
        <div class="st-presets">${R.PRESETS.map((p) => `<button type="button" class="sx-chip" data-pre="${p.id}">${esc(p.name)}</button>`).join('')}</div>
        <div class="st-shock">
          ${slider('NIFTY', 'Nifty 50', -60, 30)}
          <div class="st-srow"><select id="stS1" aria-label="First sector">${secOpts(secKeys, o.cal, st.shock.s1)}</select>${slider('v1', '', -60, 40, true)}</div>
          <div class="st-srow"><select id="stS2" aria-label="Second sector">${secOpts(secKeys, o.cal, st.shock.s2)}</select>${slider('v2', '', -60, 40, true)}</div>
          ${o.cal.f.FX ? slider('FX', 'USD/INR (rupee weaker = up)', -15, 30) : ''}
          ${o.cal.f.OIL ? slider('OIL', 'Brent crude', -60, 100) : ''}
        </div>
        <div id="stShockOut" class="st-shockout"></div>
      </section>

      <section class="st-sec">
        <h2>How the loss grows</h2>
        <p class="st-lead">Your portfolio's loss as the Nifty falls further, all sectors moving with the market.</p>
        <div class="st-chart sm"><canvas id="stSensChart" aria-label="Portfolio loss versus Nifty fall"></canvas></div>
      </section>

      <section class="st-sec">
        <h2>What would it take?</h2>
        <p class="st-lead">A reverse stress test: pick a loss you can't accept and see how big a market fall causes it.</p>
        <div class="st-rev"><label>A loss of <input id="stRevIn" type="number" min="1" max="90" value="30" aria-label="Loss in percent" />%</label><div id="stRevOut"></div></div>
      </section>

      <section class="st-sec">
        <h2>Day-to-day risk</h2>
        <p class="st-lead">From the last ${o.daily.r.length.toLocaleString('en-IN')} trading days of your holdings' actual moves (historical simulation). 10-day figures scale the 1-day ones by √10.</p>
        <table class="nt st-tbl"><thead><tr><th class="l">Measure</th><th>95%</th><th>99%</th><th>99% in ₹</th></tr></thead><tbody>
          <tr><td class="l">1-day VaR (a bad day)</td><td>${pc(-o.v95.var, 1)}</td><td>${pc(-o.v99.var, 1)}</td><td>${rs(-o.v99.var * o.Pf.total)}</td></tr>
          <tr><td class="l">1-day expected shortfall (average of the days beyond VaR)</td><td>${pc(-o.v95.es, 1)}</td><td>${pc(-o.v99.es, 1)}</td><td>${rs(-o.v99.es * o.Pf.total)}</td></tr>
          <tr><td class="l">10-day VaR</td><td>${pc(-o.v95.var * Math.sqrt(10), 1)}</td><td>${pc(-o.v99.var * Math.sqrt(10), 1)}</td><td>${rs(-o.v99.var * Math.sqrt(10) * o.Pf.total)}</td></tr>
        </tbody></table>
        ${o.kup ? `<p class="st-note">Model check (Kupiec test): over ${o.kup.days.toLocaleString('en-IN')} days the 99% VaR was beaten ${o.kup.breaches} times against about ${Math.round(o.kup.expected)} expected — ${o.kup.pass ? 'consistent with a 1-in-100 measure.' : 'more often than it should be, so treat VaR as a floor, not a ceiling.'}</p>` : ''}
      </section>

      <section class="st-sec">
        <h2>Does diversification hold in a crash?</h2>
        ${crashHTML(o.crash)}
      </section>

      <section class="st-sec">
        <h2>How fast could you sell?</h2>
        <p class="st-lead">SEBI's mutual fund method (AMFI): sell pro-rata at 10% of three times the 3-month average daily volume, after setting aside the 20% least liquid holdings. The 1-year column uses the calmer 1-year volume.</p>
        <table class="nt st-tbl"><thead><tr><th class="l">Sell</th><th>3-month volume</th><th>1-year volume</th></tr></thead><tbody>
          <tr><td class="l">25% of the portfolio</td><td>${days(o.liq.d25)}</td><td>${days(o.liq12.d25)}</td></tr>
          <tr><td class="l">50% of the portfolio</td><td>${days(o.liq.d50)}</td><td>${days(o.liq12.d50)}</td></tr>
          <tr><td class="l">All of it (every holding)</td><td>${days(o.liq.d100)}</td><td>${days(o.liq12.d100)}</td></tr>
        </tbody></table>
        ${liqHoldings(o.liq)}
      </section>

      <section class="st-sec">
        <h2>The next 12 months, simulated</h2>
        <p class="st-lead">Thousands of possible years built from 10-day stretches of your holdings' real history, so calm and stormy spells both show up. Not a forecast — a range of what has been possible.</p>
        <div id="stMc"><div class="sx-wait"><div class="orbit sm"><span></span></div><span>Simulating…</span></div></div>
      </section>

      <div class="st-foot">
        <button type="button" class="sx-btn" id="stPrint">Save as PDF</button>
        <button type="button" class="sx-btn" id="stShare">Copy share link</button>
        <p>Historical scenarios show what happened, not what will happen. Estimates for holdings that weren't listed are approximate. This is an educational tool, not investment advice, and it doesn't recommend buying, selling or holding any security.</p>
      </div>`;
    drawScenarioChart(o);
    drawContrib(o);
    drawHeat(o);
    wireShock(o);
    drawSens(o);
    wireReverse(o);
    $('#stScen').onchange = (e) => { st.scen = e.target.value; drawContrib(o); };
    $('#stPrint').onclick = () => window.print();
    $('#stShare').onclick = async () => { const u = location.href.split('#')[0] + shareHash(); try { await navigator.clipboard.writeText(u); $('#stShare').textContent = 'Link copied'; } catch (e) { prompt('Copy this link', u); } setTimeout(() => { const b = $('#stShare'); if (b) b.textContent = 'Copy share link'; }, 2000); };
    res.classList.remove('sx-in'); void res.offsetWidth; res.classList.add('sx-in');
  }
  function slider(id, label, min, max, bare) {
    const v = Math.round((st.shock[id] || 0) * 100);
    return `<label class="st-slider${bare ? ' bare' : ''}">${label ? `<span>${esc(label)}</span>` : ''}<input type="range" min="${min}" max="${max}" step="1" value="${v}" data-sh="${id}" aria-label="${esc(label || 'Sector move')}" /><output id="stO_${id}">${v > 0 ? '+' : ''}${v}%</output></label>`;
  }
  function secOpts(keys, cal, cur) { return `<option value="">Sector…</option>${keys.map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(cal.names[k] || k)}</option>`).join('')}`; }
  function crashHTML(c) {
    if (!c || !c.all || !c.crash) return '<p class="st-lead">Not enough shared trading history across these holdings to compare crash days with normal days.</p>';
    const f = (x) => (isNum(x) ? x.toFixed(2) : '—');
    const worse = c.crash.beta > c.all.beta + 0.1;
    return `<p class="st-lead">On days the Nifty fell 2% or more (${c.crash.days} of them), compared with all days. Beta is how much the portfolio moves for a 1% market move; correlation is how alike your holdings move (1 = identical).</p>
      <table class="nt st-tbl"><thead><tr><th class="l">Measure</th><th>All days</th><th>Crash days</th></tr></thead><tbody>
      <tr><td class="l">Portfolio beta to the Nifty</td><td>${f(c.all.beta)}</td><td>${f(c.crash.beta)}</td></tr>
      ${c.n > 1 ? `<tr><td class="l">Average correlation between holdings</td><td>${f(c.all.corr)}</td><td>${f(c.crash.corr)}</td></tr>` : ''}
      <tr><td class="l">Average portfolio day</td><td>${pc(c.all.avg, 2)}</td><td>${pc(c.crash.avg, 2)}</td></tr></tbody></table>
      <p class="st-note">${worse ? 'Your portfolio gets more sensitive to the market on bad days than on normal ones, so normal-day numbers understate crash risk.' : 'Your portfolio\'s sensitivity to the market stays about the same on bad days.'}${c.n > 1 && c.crash.corr > c.all.corr + 0.1 ? ' Your holdings also move more alike in crashes, so diversification gives less protection exactly when it\'s needed.' : ''}</p>`;
  }
  function liqHoldings(L) {
    const rows = L.rows.filter((r) => isNum(r.days) && r.h.kind !== 'mf').sort((a, b) => b.days - a.days).slice(0, 8);
    if (!rows.length) return '';
    return `<details class="st-more-d"><summary>Slowest holdings to sell in full</summary><table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Value</th><th>Sellable a day (AMFI)</th><th>Days to sell all</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="l">${esc(r.h.n)}</td><td>${rs(r.h.value)}</td><td>${rs(r.cap)}</td><td>${days(r.days)}</td></tr>`).join('')}</tbody></table></details>`;
  }

  function chartBase() { if (P().setupChartDefaults) try { P().setupChartDefaults(); } catch (e) { /* ok */ } }
  function drawScenarioChart(o) {
    if (!window.Chart) return; chartBase();
    const sc = o.scen.filter((s) => s.ret != null), acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    const c = new Chart($('#stScChart'), {
      type: 'bar',
      data: { labels: sc.map((s) => s.name), datasets: [{ label: 'Your portfolio', data: sc.map((s) => +(s.ret * 100).toFixed(1)), backgroundColor: acc, borderRadius: 3 }, { label: 'Nifty 50', data: sc.map((s) => (s.nifty == null ? null : +(s.nifty * 100).toFixed(1))), backgroundColor: mut, borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { ticks: { callback: (v) => pc(v / 100) } }, y: { grid: { display: false } } } }
    });
    st.charts.push(c);
  }
  function drawContrib(o) {
    const s = o.scen.find((x) => x.id === st.scen); const el = $('#stContrib'); if (!s || !el) return;
    const rows = s.rows.slice().sort((a, b) => a.pnl - b.pnl);
    el.innerHTML = `<table class="nt st-tbl"><thead><tr><th class="l">Holding</th><th>Value now</th><th>Move</th><th>Loss in ₹</th><th>Share of loss</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="l"><b>${esc(r.h.n)}</b>${r.est ? '<span class="st-est">est.</span>' : ''}</td><td>${rs(r.h.value)}</td><td>${pc(r.ret, 1)}</td><td>${rs(r.pnl)}</td><td>${s.pnl < 0 && r.pnl < 0 ? `${Math.round((r.pnl / s.pnl) * 100)}%` : '—'}</td><td><button type="button" class="st-trim" data-trim="${esc(r.h.s)}" title="Reduce this holding by 10% and run again">−10%</button></td></tr>`).join('')}
      <tr class="st-total"><td class="l">Portfolio</td><td>${rs(o.Pf.total)}</td><td>${pc(s.ret, 1)}</td><td>${rs(s.pnl)}</td><td></td><td></td></tr></tbody></table>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-trim]'); if (!b) return;
      const it = st.list.find((x) => x.s === b.dataset.trim); if (!it) return;
      it.v = Math.round(it.v * 0.9 * 100) / 100; save(); renderList();
      const y = window.scrollY; run().then(() => window.scrollTo(0, y));
    };
  }
  function drawHeat(o) {
    const sc = o.scen.filter((s) => s.ret != null), secs = {};
    o.Pf.holdings.forEach((h) => { (secs[h.secName] = secs[h.secName] || { v: 0, hs: [] }).v += h.value; secs[h.secName].hs.push(h); });
    const names = Object.keys(secs).sort((a, b) => secs[b].v - secs[a].v);
    const cell = (x) => { if (!isNum(x)) return '<td>—</td>'; const a = Math.min(1, Math.max(0, -x / 0.5)); return `<td style="background:color-mix(in srgb, var(--accent) ${Math.round(a * 45)}%, transparent)">${pc(x)}</td>`; };
    $('#stHeat').innerHTML = `<table class="nt st-tbl st-heat"><thead><tr><th class="l">Sector</th><th>Weight</th>${sc.map((s) => `<th title="${esc(s.name)}">${esc(s.name.replace(/ \(.*\)$/, ''))}</th>`).join('')}</tr></thead><tbody>
      ${names.map((n) => { const g = secs[n]; return `<tr><td class="l">${esc(n)}</td><td>${Math.round((g.v / o.Pf.total) * 100)}%</td>${sc.map((s) => { const rr = s.rows.filter((r) => g.hs.includes(r.h)); const p = rr.reduce((a, r) => a + r.pnl, 0); return cell(p / g.v); }).join('')}</tr>`; }).join('')}</tbody></table>`;
  }
  function wireShock(o) {
    const sec = document.querySelectorAll('[data-sh]');
    const read = () => {
      sec.forEach((i) => { const v = +i.value; st.shock[i.dataset.sh] = v / 100; const out = $(`#stO_${i.dataset.sh}`); if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`; });
      st.shock.s1 = $('#stS1').value; st.shock.s2 = $('#stS2').value;
      const s = { NIFTY: st.shock.NIFTY, FX: st.shock.FX || 0, OIL: st.shock.OIL || 0, sectors: {} };
      if (st.shock.s1) s.sectors[st.shock.s1] = st.shock.v1;
      if (st.shock.s2) s.sectors[st.shock.s2] = st.shock.v2;
      const r = R.runShock(o.Pf, s), top = r.rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 5);
      $('#stShockOut').innerHTML = `<div class="st-big"><b>${pc(r.ret, 1)}</b><span>${rs(r.pnl)} on ${rsShort(o.Pf.total)}</span></div>
        <table class="nt st-tbl"><thead><tr><th class="l">Biggest moves</th><th>Move</th><th>In ₹</th><th>Sensitivity to Nifty</th></tr></thead><tbody>${top.map((x) => `<tr><td class="l">${esc(x.h.n)}${x.h.beta.dflt ? '<span class="st-est">est.</span>' : ''}</td><td>${pc(x.ret, 1)}</td><td>${rs(x.pnl)}</td><td>${x.h.beta.bm.toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
    };
    const set = (k, v) => { const i = document.querySelector(`[data-sh="${k}"]`); if (i) i.value = Math.round(v * 100); };
    document.querySelector('.st-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pre]'); if (!b) return;
      const p = R.PRESETS.find((x) => x.id === b.dataset.pre).s, secs = Object.entries(p.sectors || {}).filter(([k]) => o.cal.f[k]);
      set('NIFTY', p.NIFTY || 0); set('FX', p.FX || 0); set('OIL', p.OIL || 0);
      $('#stS1').value = secs[0] ? secs[0][0] : ''; set('v1', secs[0] ? secs[0][1] : 0);
      $('#stS2').value = secs[1] ? secs[1][0] : ''; set('v2', secs[1] ? secs[1][1] : 0);
      read();
    });
    sec.forEach((i) => i.addEventListener('input', read));
    $('#stS1').onchange = read; $('#stS2').onchange = read;
    read();
  }
  function drawSens(o) {
    if (!window.Chart) return;
    const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
    st.charts.push(new Chart($('#stSensChart'), {
      type: 'line',
      data: { labels: o.sens.map((x) => pc(x.nifty)), datasets: [{ label: 'Your portfolio', data: o.sens.map((x) => +(x.ret * 100).toFixed(1)), borderColor: acc, backgroundColor: acc, tension: 0.2 }, { label: 'Nifty 50', data: o.sens.map((x) => +(x.nifty * 100).toFixed(1)), borderColor: mut, backgroundColor: mut, borderDash: [4, 4], pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${pc(x.raw / 100, 1)}` } } }, scales: { x: { title: { display: true, text: 'Nifty 50 fall' } }, y: { ticks: { callback: (v) => pc(v / 100) } } } }
    }));
  }
  function wireReverse(o) {
    const go = () => {
      const L = Math.min(90, Math.max(1, +$('#stRevIn').value || 30)) / 100, r = R.reverse(o.Pf, L);
      const hit = o.scen.filter((s) => s.ret != null && s.ret <= -L * 0.8).map((s) => `${esc(s.name)} (${pc(s.ret)})`);
      $('#stRevOut').innerHTML = r.nifty == null
        ? `<p>A market fall alone is unlikely to cause a ${Math.round(L * 100)}% loss: your portfolio moves only ${r.beta.toFixed(2)}% for each 1% the Nifty moves.</p>`
        : `<p>The Nifty would need to fall about <b>${Math.round(-r.nifty * 100)}%</b>, with sectors moving with the market. Your portfolio moves ${r.beta.toFixed(2)}% for each 1% the Nifty moves.</p><p class="st-note">${hit.length ? `Past crashes that came within 80% of that loss: ${hit.join(', ')}.` : 'None of the 10 past crashes came close to that loss for these holdings.'}</p>`;
    };
    $('#stRevIn').addEventListener('input', go); go();
  }

  /* ---------------------------------------------------------------- Monte Carlo (in slices, so the page never freezes) */
  function monteCarlo(o) {
    const my = ++st.mcSeq, total = P().isMobile && P().isMobile() ? 2000 : 10000, step = 1000, ret = [], dd = [];
    if (o.daily.r.length < 300) { $('#stMc').innerHTML = '<p class="st-lead">Not enough history to simulate.</p>'; return; }
    let done = 0;
    const tick = () => {
      if (my !== st.mcSeq || !$('#stMc')) return;
      const r = R.monteCarlo(o.daily.r, total, 250, 10, 7, done, Math.min(total, done + step));
      ret.push(...r.ret); dd.push(...r.dd); done += step;
      if (done < total) { setTimeout(tick, 0); return; }
      const s = ret.slice().sort((a, b) => a - b), d = dd.slice().sort((a, b) => a - b);
      const p20 = s.filter((x) => x <= -0.2).length / s.length;
      $('#stMc').innerHTML = `<div class="st-cards st-cards-sm">
          <div class="st-card"><span>1 year in 100 is worse than</span><b>${pc(R.pct(s, 0.01))}</b></div>
          <div class="st-card"><span>1 year in 20 is worse than</span><b>${pc(R.pct(s, 0.05))}</b></div>
          <div class="st-card"><span>A middle year</span><b>${pc(R.pct(s, 0.5))}</b></div>
          <div class="st-card"><span>Chance of losing 20% or more</span><b>${Math.round(p20 * 100)}%</b></div>
        </div>
        <div class="st-chart sm"><canvas id="stMcChart" aria-label="Distribution of simulated one-year returns"></canvas></div>
        <p class="st-note">${total.toLocaleString('en-IN')} simulated years. In 1 in 20 of them the portfolio fell at least ${pc(R.pct(d, 0.05)).replace(/[()]/g, '')} from a high at some point during the year.</p>`;
      if (!window.Chart) return;
      const lo = Math.max(-0.8, s[0]), hi = Math.min(2, s[s.length - 1]), B = 30, w = (hi - lo) / B, bins = Array(B).fill(0);
      s.forEach((x) => { const i = Math.min(B - 1, Math.max(0, Math.floor((x - lo) / w))); bins[i]++; });
      const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2');
      st.charts.push(new Chart($('#stMcChart'), {
        type: 'bar',
        data: { labels: bins.map((_, i) => pc(lo + (i + 0.5) * w)), datasets: [{ label: 'Simulated years', data: bins, backgroundColor: bins.map((_, i) => (lo + (i + 1) * w <= 0 ? mut : acc)), barPercentage: 1, categoryPercentage: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'One-year return' }, ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'Simulated years' } } } }
      }));
    };
    setTimeout(tick, 50);
  }

  /* ---------------------------------------------------------------- entry */
  function show(arg) {
    shell();
    document.title = 'Portfolio stress test — PLUTUS';
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
  }
  // used by the screener ("Stress test these")
  function linkFor(list) { return '#/stress/' + b64.enc(JSON.stringify(list.map((x) => ['eq', x.s, 'amt', x.v || 100000, x.n, '']))); }
  window.PlutusStress = { show, linkFor };
})();
