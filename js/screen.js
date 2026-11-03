/* ============================================================
   PLUTUS — Stock screener (#/screen) · v33
   ------------------------------------------------------------
   Filter the Nifty 500 with a screener.in-style query:
       Market Capitalization > 5000 AND ROCE > 20 AND Debt to equity < 0.5
   • AND / OR / NOT, brackets, + − × ÷, comparisons > < >= <= = !=
   • field names are matched by name or short alias (mcap, roce, pe …), case-insensitive
   • units: money in ₹ crore, percentages as plain numbers (ROCE 20 = 20 %)
   Data: data/screen/universe.json (built by scripts/build_screen.py — weekly fundamentals, daily prices).
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const P = () => window.PlutusApp || {};
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const PAGE = 50;
  const SAVE_KEY = 'plutus.screens.v1';

  /* ---------------------------------------------------------------- the fields
     [key, label, unit, aliases, what it means]   unit: cr = ₹ crore · rs = ₹ · pct = % · x = times · d = days · n = number */
  const F = [
    ['price', 'Current price', 'rs', ['cmp', 'price', 'current market price', 'share price'], 'Latest share price.'],
    ['mcap', 'Market Capitalization', 'cr', ['market cap', 'market capitalisation', 'mcap', 'mkt cap', 'm cap'], 'Value of all shares, in ₹ crore.'],
    ['pe', 'Price to Earning', 'x', ['p/e', 'pe', 'pe ratio', 'stock p/e', 'price to earnings'], 'Share price ÷ earnings per share (trailing 12 months).'],
    ['ipe', 'Industry PE', 'x', ['industry p/e', 'industry pe', 'sector pe'], 'Median P/E of the company’s industry within the Nifty 500.'],
    ['pb', 'Price to book value', 'x', ['p/b', 'pb', 'price to book', 'pbv'], 'Share price ÷ book value per share.'],
    ['dy', 'Dividend yield', 'pct', ['dividend yield', 'yield', 'div yield'], 'Dividends of the last year ÷ share price.'],
    ['ey', 'Earnings yield', 'pct', ['earnings yield'], 'Earnings ÷ share price (the inverse of P/E).'],
    ['evebitda', 'EV / EBITDA', 'x', ['ev/ebitda', 'ev to ebitda', 'evebitda', 'enterprise value to ebitda'], '(Market cap + debt) ÷ operating profit (approx.; not for banks).'],
    ['peg', 'PEG Ratio', 'x', ['peg', 'peg ratio'], 'P/E ÷ 3-year profit growth.'],
    ['h52', 'High price', 'rs', ['52 week high', '52w high', 'year high'], '52-week high.'],
    ['l52', 'Low price', 'rs', ['52 week low', '52w low', 'year low'], '52-week low.'],
    ['fromhigh', 'Down from 52w high', 'pct', ['% from 52w high', 'from high', 'from 52w high', 'drawdown'], 'How far the price is below its 52-week high (negative %).'],
    ['roce', 'Return on capital employed', 'pct', ['roce', 'return on capital'], 'Latest-year ROCE %.'],
    ['roe', 'Return on equity', 'pct', ['roe'], 'Latest-year ROE %.'],
    ['roce3', 'Average return on capital employed 3Years', 'pct', ['roce 3y', 'roce 3years', 'avg roce 3y', 'average roce 3y', 'roce 3 years'], 'Average ROCE % of the last 3 years.'],
    ['opm', 'OPM', 'pct', ['operating profit margin', 'opm', 'operating margin', 'ebitda margin'], 'Operating profit ÷ sales (trailing 12 months).'],
    ['npm', 'Net profit margin', 'pct', ['npm', 'net margin', 'profit margin'], 'Net profit ÷ sales (trailing 12 months).'],
    ['sales', 'Sales', 'cr', ['revenue', 'sales ttm', 'turnover'], 'Sales of the trailing 12 months, ₹ crore.'],
    ['pat', 'Net profit', 'cr', ['profit', 'pat', 'net profit ttm', 'profit after tax'], 'Net profit of the trailing 12 months, ₹ crore.'],
    ['ebitda', 'Operating profit', 'cr', ['ebitda', 'operating profit ttm'], 'Operating profit (EBITDA) of the trailing 12 months, ₹ crore.'],
    ['eps', 'EPS', 'rs', ['earnings per share', 'eps ttm'], 'Earnings per share, trailing 12 months.'],
    ['salesg', 'Sales growth', 'pct', ['revenue growth', 'sales growth 1year', 'sales growth yoy'], 'Latest year’s sales vs the year before, %.'],
    ['profitg', 'Profit growth', 'pct', ['profit growth 1year', 'profit growth yoy', 'pat growth'], 'Latest year’s net profit vs the year before, %.'],
    ['sales3', 'Sales growth 3Years', 'pct', ['sales cagr 3y', 'sales growth 3y', 'sales growth 3 years', 'revenue cagr 3y'], 'Sales CAGR over 3 years, %.'],
    ['sales5', 'Sales growth 5Years', 'pct', ['sales cagr 5y', 'sales growth 5y', 'sales growth 5 years', 'revenue cagr 5y'], 'Sales CAGR over 5 years, %.'],
    ['profit3', 'Profit growth 3Years', 'pct', ['profit cagr 3y', 'profit growth 3y', 'profit growth 3 years'], 'Net-profit CAGR over 3 years, %.'],
    ['profit5', 'Profit growth 5Years', 'pct', ['profit cagr 5y', 'profit growth 5y', 'profit growth 5 years'], 'Net-profit CAGR over 5 years, %.'],
    ['qsalesg', 'YOY Quarterly sales growth', 'pct', ['quarterly sales growth', 'qtr sales growth', 'qoq sales'], 'Latest quarter’s sales vs the same quarter last year, %.'],
    ['qprofitg', 'YOY Quarterly profit growth', 'pct', ['quarterly profit growth', 'qtr profit growth'], 'Latest quarter’s profit vs the same quarter last year, %.'],
    ['debt', 'Debt', 'cr', ['borrowings', 'total debt'], 'Borrowings, ₹ crore (latest balance sheet).'],
    ['de', 'Debt to equity', 'x', ['d/e', 'debt equity', 'debt/equity', 'de ratio'], 'Borrowings ÷ shareholders’ equity (not for banks).'],
    ['icr', 'Interest Coverage Ratio', 'x', ['interest coverage', 'icr'], '(Profit before tax + interest) ÷ interest.'],
    ['cfo', 'Cash from operations', 'cr', ['cfo', 'operating cash flow', 'cash from operations last year'], 'Cash from operating activities, latest year, ₹ crore.'],
    ['cfopat', 'CFO to PAT', 'x', ['cash conversion', 'cfo/pat', 'cfo to profit'], 'Operating cash flow ÷ net profit, latest year.'],
    ['payout', 'Dividend Payout', 'pct', ['dividend payout ratio', 'payout ratio', 'payout'], 'Share of profit paid as dividend, latest year %.'],
    ['prom', 'Promoter holding', 'pct', ['promoter', 'promoters', 'promoter holding %'], 'Promoter shareholding %, latest quarter.'],
    ['promchg', 'Change in promoter holding', 'pct', ['promoter change', 'change in promoter holding 1year'], 'Change in promoter holding over 4 quarters, percentage points.'],
    ['fii', 'FII holding', 'pct', ['fii', 'fiis', 'foreign institutional holding'], 'Foreign institutional holding %.'],
    ['dii', 'DII holding', 'pct', ['dii', 'diis', 'domestic institutional holding'], 'Domestic institutional holding %.'],
    ['pub', 'Public holding', 'pct', ['public', 'retail holding'], 'Public (retail and others) holding %.'],
    ['holders', 'Number of Shareholders', 'n', ['shareholders', 'no of shareholders'], 'Number of shareholders, latest quarter.'],
    ['debtor', 'Debtor days', 'd', ['receivable days', 'debtor days'], 'Days customers take to pay, latest year.'],
    ['wcdays', 'Working Capital Days', 'd', ['working capital days', 'wc days'], 'Working capital in days of sales, latest year.'],
    ['ccc', 'Cash Conversion Cycle', 'd', ['cash conversion cycle', 'ccc'], 'Debtor + inventory − payable days, latest year.']
  ].map(([key, label, unit, al, what]) => ({ key, label, unit, al, what }));
  const FBY = Object.fromEntries(F.map((f) => [f.key, f]));
  // every spelling → key, longest first (so "Sales growth 3Years" wins over "Sales")
  const NAMES = [];
  F.forEach((f) => [f.label, f.key, ...f.al].forEach((n) => NAMES.push([n.toLowerCase().replace(/\s+/g, ' '), f.key])));
  NAMES.sort((a, b) => b[0].length - a[0].length);

  /* ---------------------------------------------------------------- the query language */
  function err(msg, at) { const e = new Error(msg); e.at = at; return e; }
  function tokenize(src) {
    const s = src.replace(/[–—]/g, '-').replace(/[×]/g, '*').replace(/[÷]/g, '/');
    const low = s.toLowerCase(), out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      // numbers: 5000, 5,000, 0.5, 5k / 5 cr / 20% (units are ignored: money is in crore, % are plain numbers)
      const nm = s.slice(i).match(/^(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|cr|crore|%)?(?![a-z])/i);
      if (nm) { let v = parseFloat(nm[1].replace(/,/g, '')); if (/^k$/i.test(nm[2] || '')) v *= 1000; out.push({ t: 'num', v, at: i }); i += nm[0].length; continue; }
      const op = s.slice(i).match(/^(>=|<=|!=|<>|==|=|>|<|\+|-|\*|\/|\(|\)|&&|\|\|)/);
      if (op) {
        const o = op[1] === '<>' ? '!=' : op[1] === '==' ? '=' : op[1] === '&&' ? 'and' : op[1] === '||' ? 'or' : op[1];
        out.push({ t: /^(and|or)$/.test(o) ? 'kw' : 'op', v: o, at: i }); i += op[1].length; continue;
      }
      const kw = low.slice(i).match(/^(and|or|not)(?![a-z0-9])/);
      if (kw) { out.push({ t: 'kw', v: kw[1], at: i }); i += kw[1].length; continue; }
      // a field name (flexible spaces)
      const rest = low.slice(i).replace(/\s+/g, ' ');
      const hit = NAMES.find(([n]) => rest.startsWith(n) && !/[a-z0-9]/.test(rest[n.length] || ''));
      if (hit) {
        // walk the original string forward by the same number of non-space characters
        let k = i, need = hit[0].replace(/ /g, '').length;
        while (need > 0 && k < s.length) { if (!/\s/.test(s[k])) need--; k++; }
        out.push({ t: 'field', v: hit[1], at: i }); i = k; continue;
      }
      const word = (s.slice(i).match(/^[A-Za-z][A-Za-z0-9 %/.&'-]*?(?=\s*(?:>=|<=|!=|<>|==|=|>|<|\)|$|\s(?:and|or)\s))/i) || [s.slice(i).split(/\s/)[0]])[0].trim();
      throw err(`I don’t know “${word}”.${suggest(word)}`, i);
    }
    return out;
  }
  function suggest(word) {
    if (window.Fuse) {
      const fz = new window.Fuse(F.flatMap((f) => [f.label, ...f.al].map((n) => ({ n, f }))), { keys: ['n'], threshold: 0.45 });
      const r = fz.search(word).slice(0, 3).map((x) => x.item.f.label);
      const u = [...new Set(r)];
      if (u.length) return ` Did you mean ${u.map((x) => `“${x}”`).join(' or ')}?`;
    }
    return ' Open “All fields” to see what you can use.';
  }
  function parse(src) {
    const tk = tokenize(src); let p = 0;
    if (!tk.length) throw err('Type a condition, e.g. Market Capitalization > 5000 AND ROCE > 20', 0);
    const peek = () => tk[p], next = () => tk[p++];
    const isKw = (w) => peek() && peek().t === 'kw' && peek().v === w;
    const isOp = (o) => peek() && peek().t === 'op' && peek().v === o;
    function orE() { let l = andE(); while (isKw('or')) { next(); const r = andE(); bool(l); bool(r); l = { k: 'or', l, r, b: 1 }; } return l; }
    function andE() { let l = notE(); while (isKw('and')) { next(); const r = notE(); bool(l); bool(r); l = { k: 'and', l, r, b: 1 }; } return l; }
    function notE() { if (isKw('not')) { next(); const x = notE(); bool(x); return { k: 'not', x, b: 1 }; } return cmpE(); }
    function cmpE() {
      const l = sumE();
      const t = peek();
      if (t && t.t === 'op' && /^(>|<|>=|<=|=|!=)$/.test(t.v)) { next(); const r = sumE(); numx(l); numx(r); return { k: 'cmp', op: t.v, l, r, b: 1 }; }
      return l;
    }
    function sumE() { let l = mulE(); while (isOp('+') || isOp('-')) { const o = next().v; const r = mulE(); numx(l); numx(r); l = { k: 'ar', op: o, l, r }; } return l; }
    function mulE() { let l = unE(); while (isOp('*') || isOp('/')) { const o = next().v; const r = unE(); numx(l); numx(r); l = { k: 'ar', op: o, l, r }; } return l; }
    function unE() { if (isOp('-')) { next(); const x = unE(); numx(x); return { k: 'neg', x }; } return prim(); }
    function prim() {
      const t = next();
      if (!t) throw err('The condition ends too early — something is missing after the last word.', src.length);
      if (t.t === 'num') return { k: 'num', v: t.v };
      if (t.t === 'field') return { k: 'f', f: t.v };
      if (t.t === 'op' && t.v === '(') { const x = orE(); if (!isOp(')')) throw err('A bracket “(” is not closed.', t.at); next(); return x; }
      throw err(`Unexpected “${t.t === 'kw' ? t.v.toUpperCase() : t.v}”.`, t.at);
    }
    function bool(x) { if (!x.b) throw err('Each part joined by AND / OR needs a comparison, e.g. ROCE > 20.', 0); }
    function numx(x) { if (x.b) throw err('A comparison can’t be used inside arithmetic.', 0); }
    const ast = orE();
    if (p < tk.length) throw err(`Unexpected “${tk[p].v}” — join conditions with AND / OR.`, tk[p].at);
    if (!ast.b) throw err('Add a comparison, e.g. ROCE > 20.', 0);
    return ast;
  }
  function evalN(n, r) {
    switch (n.k) {
      case 'num': return n.v;
      case 'f': return isNum(r[n.f]) ? r[n.f] : null;
      case 'neg': { const v = evalN(n.x, r); return v == null ? null : -v; }
      case 'ar': { const a = evalN(n.l, r), b = evalN(n.r, r); if (a == null || b == null) return null; return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : (b === 0 ? null : a / b); }
      case 'cmp': { const a = evalN(n.l, r), b = evalN(n.r, r); if (a == null || b == null) return false;
        return n.op === '>' ? a > b : n.op === '<' ? a < b : n.op === '>=' ? a >= b : n.op === '<=' ? a <= b : n.op === '=' ? Math.abs(a - b) < 1e-9 : Math.abs(a - b) >= 1e-9; }
      case 'and': return evalN(n.l, r) && evalN(n.r, r);
      case 'or': return evalN(n.l, r) || evalN(n.r, r);
      case 'not': return !evalN(n.x, r);
      default: return null;
    }
  }
  const fieldsOf = (n, out = []) => { if (!n) return out; if (n.k === 'f' && !out.includes(n.f)) out.push(n.f); ['l', 'r', 'x'].forEach((k) => fieldsOf(n[k], out)); return out; };

  /* ---------------------------------------------------------------- ready-made screens */
  const PRESETS = [
    ['Quality compounders', 'Return on capital employed > 20 AND Average return on capital employed 3Years > 18 AND Sales growth 5Years > 12 AND Debt to equity < 0.5'],
    ['Debt-free & growing', 'Debt to equity < 0.1 AND Sales growth 3Years > 15 AND Profit growth 3Years > 15'],
    ['Cheap and growing (GARP)', 'PEG Ratio < 1 AND Profit growth 3Years > 15 AND Return on equity > 15'],
    ['High dividend', 'Dividend yield > 3 AND Dividend Payout < 80 AND Debt to equity < 1'],
    ['Below industry P/E', 'Price to Earning < Industry PE * 0.8 AND Return on capital employed > 15 AND Market Capitalization > 5000'],
    ['Coffee-can style', 'Market Capitalization > 10000 AND Average return on capital employed 3Years > 15 AND Sales growth 5Years > 10'],
    ['Promoters buying', 'Change in promoter holding > 1 AND Promoter holding > 40'],
    ['Strong latest quarter', 'YOY Quarterly sales growth > 20 AND YOY Quarterly profit growth > 25'],
    ['Near 52-week low', 'Down from 52w high < -30 AND Return on capital employed > 15'],
    ['Cash-rich earners', 'CFO to PAT > 1 AND OPM > 20 AND Interest Coverage Ratio > 10']
  ];

  /* ---------------------------------------------------------------- data */
  let DATA = null, DATA_P = null;
  function loadData() {
    if (DATA_P) return DATA_P;
    const bust = Math.floor(Date.now() / 3600e3);
    const raw = CFG.REPORTS_RAW ? String(CFG.REPORTS_RAW).replace(/data\/reports\/?$/, 'data/screen/') : '';
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    DATA_P = get(`data/screen/universe.json?t=${bust}`).catch(() => (raw ? get(`${raw}universe.json?t=${Date.now()}`) : Promise.reject(new Error('missing'))))
      .then((j) => { DATA = { ...j, rows: j.rows.map((a) => Object.fromEntries(j.fields.map((f, i) => [f, a[i]]))) }; return DATA; })
      .catch((e) => { DATA_P = null; throw e; });
    return DATA_P;
  }

  /* ---------------------------------------------------------------- formatting */
  const inr = (v, d = 0) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmt(k, v) {
    if (!isNum(v)) return '—';
    const u = (FBY[k] || {}).unit;
    if (u === 'cr') return Math.abs(v) >= 1e5 ? `${inr(v / 1e5, 2)} L Cr` : `${inr(v, 0)} Cr`;
    if (u === 'rs') return '₹' + inr(v, v >= 1000 ? 0 : 2);
    if (u === 'pct') return `${v.toFixed(1)}%`;
    if (u === 'x') return `${v.toFixed(v >= 100 ? 0 : 1)}×`;
    if (u === 'd') return `${Math.round(v)}`;
    return inr(v, 0);
  }
  const ago = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };

  /* ---------------------------------------------------------------- state + page */
  const st = { q: '', ast: null, res: [], sort: 'mcap', dir: -1, page: 0, cols: [], picked: new Set() };
  const root = () => $('#viewScreen');
  const saved = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch (e) { return []; } };
  const setSaved = (a) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(a.slice(0, 30))); } catch (e) { /* quota */ } };

  function shell() {
    const r = root(); if (!r || r.dataset.ready) return;
    r.dataset.ready = '1';
    r.innerHTML = `
      <section class="sx-head">
        <p class="eyebrow">Stock screener</p>
        <h1>Find companies by the numbers</h1>
        <p class="sx-sub">Money is in ₹ crore, percentages are plain numbers. Covers the <span id="sxIdx">Nifty 500</span>.</p>
      </section>
      <section class="sx-box">
        <div class="sx-qwrap">
          <textarea id="sxQ" rows="3" spellcheck="false" autocomplete="off" placeholder="e.g.  Market Capitalization > 5000 AND ROCE > 20 AND Debt to equity < 0.5" aria-label="Screening query"></textarea>
          <ul class="sx-ac suggest" id="sxAc" role="listbox"></ul>
        </div>
        <div class="sx-err hidden" id="sxErr" role="alert"></div>
        <div class="sx-actions">
          <button type="button" class="sx-run" id="sxRun">Run query <kbd>Ctrl ↵</kbd></button>
          <button type="button" class="sx-btn" id="sxFields" aria-expanded="false">All fields</button>
          <button type="button" class="sx-btn" id="sxSave">Save screen</button>
          <button type="button" class="sx-btn" id="sxClear">Clear</button>
          <span class="sx-savebox hidden" id="sxSaveBox"><input id="sxSaveName" maxlength="40" placeholder="Name this screen" /><button type="button" class="sx-btn" id="sxSaveOk">Save</button></span>
        </div>
        <div class="sx-fields hidden" id="sxFieldList"></div>
        <div class="sx-presets"><span class="sx-k">Ready-made</span>${PRESETS.map(([n, q], i) => `<button type="button" class="sx-chip" data-p="${i}" title="${esc(q)}">${esc(n)}</button>`).join('')}</div>
        <div class="sx-presets" id="sxSaved"></div>
      </section>
      <section class="sx-results" id="sxRes"></section>`;
    const q = $('#sxQ');
    $('#sxRun').onclick = () => run(q.value, true);
    q.addEventListener('keydown', (e) => {
      if (acKeys(e)) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); closeAc(); run(q.value, true); }
    });
    q.addEventListener('input', () => { $('#sxErr').classList.add('hidden'); openAc(); });
    q.addEventListener('blur', () => setTimeout(closeAc, 150));
    $('#sxClear').onclick = () => { q.value = ''; st.q = ''; st.ast = null; $('#sxErr').classList.add('hidden'); location.hash = '#/screen'; renderRes(); q.focus(); };
    $('#sxFields').onclick = () => { const l = $('#sxFieldList'), on = l.classList.toggle('hidden'); $('#sxFields').setAttribute('aria-expanded', String(!on)); if (!on) renderFields(); };
    $('#sxSave').onclick = () => { if (!q.value.trim()) return; $('#sxSaveBox').classList.remove('hidden'); $('#sxSaveName').focus(); };
    $('#sxSaveOk').onclick = () => {
      const n = $('#sxSaveName').value.trim() || 'My screen';
      setSaved([[n, q.value.trim()], ...saved().filter(([x]) => x !== n)]);
      $('#sxSaveBox').classList.add('hidden'); $('#sxSaveName').value = ''; renderSaved();
    };
    $('#sxSaveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#sxSaveOk').click(); });
    r.querySelector('.sx-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { q.value = PRESETS[+b.dataset.p][1]; run(q.value, true); } });
    $('#sxSaved').addEventListener('click', (e) => {
      const x = e.target.closest('[data-del]'); if (x) { setSaved(saved().filter((_, i) => i !== +x.dataset.del)); renderSaved(); return; }
      const b = e.target.closest('[data-s]'); if (b) { q.value = saved()[+b.dataset.s][1]; run(q.value, true); }
    });
    $('#sxFieldList').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) insertField(FBY[b.dataset.f].label); });
    $('#sxRes').addEventListener('click', onResClick);
    $('#sxRes').addEventListener('change', (e) => { const c = e.target.closest('input[data-pick]'); if (c) { c.checked ? st.picked.add(c.dataset.pick) : st.picked.delete(c.dataset.pick); if (st.picked.size > 4) { st.picked.delete(c.dataset.pick); c.checked = false; } renderCmpBar(); } });
    renderSaved();
  }
  function renderSaved() {
    const el = $('#sxSaved'); if (!el) return;
    const s = saved();
    el.innerHTML = s.length ? `<span class="sx-k">Saved</span>${s.map(([n, q], i) => `<span class="sx-chip saved"><button type="button" data-s="${i}" title="${esc(q)}">${esc(n)}</button><button type="button" class="sx-x" data-del="${i}" aria-label="Delete ${esc(n)}">×</button></span>`).join('')}` : '';
  }
  function renderFields() {
    const groups = [['Valuation', ['mcap', 'price', 'pe', 'ipe', 'pb', 'peg', 'evebitda', 'dy', 'ey', 'h52', 'l52', 'fromhigh']],
      ['Returns & margins', ['roce', 'roce3', 'roe', 'opm', 'npm']],
      ['Size & growth', ['sales', 'pat', 'ebitda', 'eps', 'salesg', 'profitg', 'sales3', 'sales5', 'profit3', 'profit5', 'qsalesg', 'qprofitg']],
      ['Safety & cash', ['debt', 'de', 'icr', 'cfo', 'cfopat', 'payout', 'debtor', 'wcdays', 'ccc']],
      ['Ownership', ['prom', 'promchg', 'fii', 'dii', 'pub', 'holders']]];
    $('#sxFieldList').innerHTML = groups.map(([g, ks]) => `<div class="sx-fg"><h4>${g}</h4>${ks.map((k) => { const f = FBY[k]; return `<button type="button" data-f="${k}" title="${esc(f.what)}"><b>${esc(f.label)}</b><span>${esc(f.al.slice(0, 2).join(' · '))}</span></button>`; }).join('')}</div>`).join('');
  }

  /* ---------------------------------------------------------------- autocomplete */
  let acList = [], acI = -1;
  function curWord() {
    const q = $('#sxQ'), pos = q.selectionStart, before = q.value.slice(0, pos);
    const m = before.match(/([A-Za-z][A-Za-z0-9 %/.&'-]*)$/);
    if (!m) return null;
    // the name being typed starts after the last operator / AND / OR / bracket
    let w = m[1].replace(/^.*\b(?:and|or|not)\s+/i, '');
    w = w.replace(/^\s+/, '');
    return w.length >= 2 ? { w, start: pos - w.length, end: pos } : null;
  }
  function openAc() {
    const c = curWord(), ul = $('#sxAc');
    if (!c) return closeAc();
    const lw = c.w.toLowerCase();
    const seen = new Set();
    acList = F.filter((f) => [f.label, f.key, ...f.al].some((n) => n.toLowerCase().startsWith(lw) || (lw.length >= 3 && n.toLowerCase().includes(lw))))
      .filter((f) => !seen.has(f.key) && seen.add(f.key)).slice(0, 8);
    if (!acList.length || (acList.length === 1 && acList[0].label.toLowerCase() === lw)) return closeAc();
    acI = 0;
    // the matching part in bold; the short alias that matched, if the label itself doesn't contain the typed words
    const mark = (t) => { const i = t.toLowerCase().indexOf(lw); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + lw.length)) + '</mark>' + esc(t.slice(i + lw.length)); };
    ul.innerHTML = acList.map((f, i) => {
      const via = f.label.toLowerCase().includes(lw) ? '' : (f.al.find((a) => a.toLowerCase().includes(lw)) || '');
      return `<li role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}"><span class="s-main"><span class="s-name">${mark(f.label)}${via ? `<span class="sx-al">(${esc(via)})</span>` : ''}</span><span class="kx-li-d">${esc(f.what)}${/crore|%|days|₹|÷|×/.test(f.what) ? '' : ' · ' + unitWord(f.unit)}</span></span></li>`;
    }).join('');
    ul.classList.add('open');
    ul.onmousedown = (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pickAc(+li.dataset.i); } };
  }
  const unitWord = (u) => ({ cr: 'in ₹ crore', rs: 'in ₹', pct: 'in %', x: 'times (×)', d: 'in days', n: 'a count' }[u] || '');
  function closeAc() { const ul = $('#sxAc'); if (ul) { ul.classList.remove('open'); ul.innerHTML = ''; } acList = []; acI = -1; }
  function acKeys(e) {
    if (!acList.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acI = (acI + (e.key === 'ArrowDown' ? 1 : acList.length - 1)) % acList.length; $('#sxAc').querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === acI)); return true; }
    if ((e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) && acI >= 0) { e.preventDefault(); pickAc(acI); return true; }
    if (e.key === 'Escape') { closeAc(); return true; }
    return false;
  }
  function pickAc(i) {
    const f = acList[i], c = curWord(), q = $('#sxQ'); if (!f || !c) return;
    q.value = q.value.slice(0, c.start) + f.label + ' ' + q.value.slice(c.end);
    const p = c.start + f.label.length + 1; q.setSelectionRange(p, p); q.focus(); closeAc();
  }
  function insertField(label) {
    const q = $('#sxQ'), v = q.value.trimEnd();
    q.value = v + (v && !/(and|or|\()$/i.test(v) ? ' AND ' : v ? ' ' : '') + label + ' > ';
    q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  }

  /* ---------------------------------------------------------------- run + results */
  async function run(q, push) {
    q = String(q || '').trim(); st.q = q;
    const errEl = $('#sxErr');
    if (!q) { st.ast = null; renderRes(); return; }
    try { st.ast = parse(q); errEl.classList.add('hidden'); } catch (e) {
      errEl.innerHTML = `<b>Can’t read that query.</b> ${esc(e.message)}`; errEl.classList.remove('hidden'); return;
    }
    if (push) { const h = '#/screen/' + encodeURIComponent(q); if (location.hash !== h) history.replaceState(null, '', h); }
    $('#sxRes').innerHTML = '<div class="sx-wait"><div class="orbit sm"><span></span></div><span>Screening…</span></div>';
    let d; try { d = await loadData(); } catch (e) { renderMissing(); return; }
    st.res = d.rows.filter((r) => evalN(st.ast, r));
    const used = fieldsOf(st.ast).filter((k) => !['price', 'pe', 'mcap'].includes(k));
    st.cols = ['price', 'pe', 'mcap', ...used, ...(used.includes('roce') ? [] : ['roce'])].slice(0, 10);
    if (!st.cols.includes(st.sort)) { st.sort = 'mcap'; st.dir = -1; }
    st.page = 0; st.picked.clear();
    renderRes();
  }
  function renderMissing() {
    console.warn('[PLUTUS screener] data/screen/universe.json not found — run Actions → “Build screener data” (mode: full) in the GitHub repo.');
    $('#sxRes').innerHTML = `<div class="sx-empty"><h2>The screener is getting its data ready.</h2><p>Please check back a little later.</p></div>`;
  }
  function sorted() {
    const k = st.sort, d = st.dir;
    return st.res.slice().sort((a, b) => {
      if (k === 'n') return d * String(a.n).localeCompare(String(b.n));
      const x = a[k], y = b[k];
      if (!isNum(x) && !isNum(y)) return 0; if (!isNum(x)) return 1; if (!isNum(y)) return -1;
      return d * (x - y);
    });
  }
  function renderRes() {
    const el = $('#sxRes'); if (!el) return;
    if (!st.ast) { el.innerHTML = `<div class="sx-empty"><h2>Start with a ready-made screen, or write your own conditions above.</h2><p>Combine as many as you like with AND / OR, use brackets, and compare two fields — e.g. <code>Price to Earning &lt; Industry PE</code>.</p></div>`; return; }
    const rows = sorted(), n = rows.length, pages = Math.max(1, Math.ceil(n / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const pg = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
    const th = (k, lab) => `<th class="${k === 'n' ? 'l' : ''}${st.sort === k ? ' on' : ''}" data-sort="${k}" title="${esc((FBY[k] || {}).what || '')}">${esc(lab)}${st.sort === k ? (st.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`;
    const head = `<tr><th class="sx-pk"></th><th class="sx-no">#</th>${th('n', 'Company')}${st.cols.map((k) => th(k, short(k))).join('')}</tr>`;
    const body = pg.map((r, i) => `<tr><td class="sx-pk"><input type="checkbox" data-pick="${esc(r.s)}" aria-label="Pick ${esc(r.n)} to compare"${st.picked.has(r.s) ? ' checked' : ''}></td><td class="sx-no">${st.page * PAGE + i + 1}</td>
      <td class="l"><a href="#/s/${encodeURIComponent(r.s)}" class="sx-co"><b>${esc(r.n)}</b><span>${esc(r.s.replace(/\.NS$/, ''))}${r.ind ? ' · ' + esc(r.ind) : ''}</span></a></td>
      ${st.cols.map((k) => `<td>${fmt(k, r[k])}</td>`).join('')}</tr>`).join('');
    el.innerHTML = `
      <div class="sx-rhead"><p><b>${n}</b> ${n === 1 ? 'company matches' : 'companies match'} <span class="sx-of">of ${DATA ? DATA.count : '—'} in the ${esc(idxName())}</span></p>
        <div class="sx-ract"><span id="sxCmpBar"></span><button type="button" class="sx-btn" id="sxCsv"${n ? '' : ' disabled'}>Download CSV</button></div></div>
      ${n ? `<div class="sx-tw"><table class="sx-t"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      ${pages > 1 ? `<div class="sx-pager"><button type="button" class="sx-btn" data-pg="-1"${st.page ? '' : ' disabled'}>← Prev</button><span>Page ${st.page + 1} of ${pages}</span><button type="button" class="sx-btn" data-pg="1"${st.page < pages - 1 ? '' : ' disabled'}>Next →</button></div>` : ''}`
      : `<div class="sx-empty"><h2>No company meets every condition.</h2><p>Try loosening one of them — for example a lower ROCE or a smaller market cap.</p></div>`}`;
    renderCmpBar();
  }
  const SHORT = { mcap: 'Mar Cap', price: 'CMP', pe: 'P/E', ipe: 'Ind P/E', pb: 'P/B', dy: 'Div Yld', ey: 'Earn Yld', evebitda: 'EV/EBITDA', peg: 'PEG', h52: '52w High', l52: '52w Low', fromhigh: 'From High', roce: 'ROCE', roe: 'ROE', roce3: 'ROCE 3Y', opm: 'OPM', npm: 'NPM', sales: 'Sales', pat: 'Profit', ebitda: 'EBITDA', eps: 'EPS', salesg: 'Sales Gr', profitg: 'Profit Gr', sales3: 'Sales 3Y', sales5: 'Sales 5Y', profit3: 'Profit 3Y', profit5: 'Profit 5Y', qsalesg: 'Qtr Sales', qprofitg: 'Qtr Profit', debt: 'Debt', de: 'D/E', icr: 'Int Cov', cfo: 'CFO', cfopat: 'CFO/PAT', payout: 'Payout', prom: 'Promoter', promchg: 'Prom Δ', fii: 'FII', dii: 'DII', pub: 'Public', holders: 'Holders', debtor: 'Debtor Days', wcdays: 'WC Days', ccc: 'CCC' };
  const short = (k) => SHORT[k] || (FBY[k] || {}).label || k;
  const idxName = () => ({ nifty500: 'Nifty 500', nifty200: 'Nifty 200', nifty100: 'Nifty 100', nifty50: 'Nifty 50' }[(DATA || {}).index] || 'Nifty 500');
  function renderCmpBar() {
    const b = $('#sxCmpBar'); if (!b) return;
    const n = st.picked.size;
    b.innerHTML = n >= 2 ? `<a class="sx-run sm" href="#/compare/${[...st.picked].map(encodeURIComponent).join(',')}">Compare ${n} selected</a>` : n === 1 ? '<span class="sx-hint">Pick 1–3 more to compare</span>' : '<span class="sx-hint">Tick 2–4 companies to compare them</span>';
  }
  function onResClick(e) {
    const s = e.target.closest('th[data-sort]');
    if (s) { const k = s.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'n' ? 1 : -1; } st.page = 0; renderRes(); return; }
    const p = e.target.closest('[data-pg]');
    if (p) { st.page += +p.dataset.pg; renderRes(); $('#sxRes').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (e.target.closest('#sxCsv')) csv();
  }
  function csv() {
    const cols = ['n', 's', 'ind', ...st.cols];
    const head = ['Company', 'Symbol', 'Industry', ...st.cols.map((k) => `${(FBY[k] || {}).label || k}${{ cr: ' (Rs Cr)', pct: ' (%)', rs: ' (Rs)', x: ' (x)', d: ' (days)' }[(FBY[k] || {}).unit] || ''}`)];
    const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const text = [head, ...sorted().map((r) => cols.map((k) => r[k]))].map((a) => a.map(cell).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = 'plutus-screen.csv'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------------------------------------------------------- entry */
  async function show(query) {
    shell();
    document.title = 'Stock screener — PLUTUS';
    const q = $('#sxQ');
    loadData().then(() => { const a = $('#sxIdx'); if (a) a.textContent = idxName(); }).catch(() => {});
    if (query && query !== st.q) { q.value = query; run(query, false); }
    else if (!query && !st.q) renderRes();
    if (!(P().isMobile && P().isMobile())) setTimeout(() => q.focus(), 60);
  }
  window.PlutusScreen = { show, _parse: parse, _eval: evalN, _fields: F };
})();
