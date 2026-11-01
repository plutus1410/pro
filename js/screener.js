/* ============================================================
   PLUTUS — screener.in data layer (v20)
   ------------------------------------------------------------
   Indian stocks only. One screener.in company page gives almost everything the dashboard needs:
   10+ years of P&L, balance sheet and cash flow, 12 quarters, ratios, shareholding, profile, sector
   / industry, the peer list and the company's documents (annual reports, con-call transcripts).
   Yahoo Finance is used only for share prices (and the few balance-sheet detail lines screener's
   page doesn't show, e.g. receivables, current assets, capex).

   This file turns a screener page into the same shapes Yahoo returns (a "timeseries" result and a
   "quoteSummary" result), so js/analysis.js builds the model exactly as before — every section,
   chart and metric works unchanged. Screener figures are in ₹ crore; they are converted to rupees.
   ============================================================ */
(function () {
  'use strict';
  const CR = 1e7;
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (s) => {
    const t = String(s == null ? '' : s).replace(/[,₹%\s]|Cr\.?|Rs\.?/gi, '');
    if (!t || t === '-' || t === '--') return null;
    const v = parseFloat(t);
    return isFinite(v) ? v : null;
  };
  const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // "Mar 2025" → "2025-03-31" (last day of that month, the way Yahoo dates statements)
  function isoOf(label) {
    const m = clean(label).match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (!m || !MONTHS[m[1].toLowerCase()]) return null;
    const y = +m[2], mo = MONTHS[m[1].toLowerCase()];
    const d = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // symbol ↔ screener code. RELIANCE.NS ↔ RELIANCE · 500325.BO ↔ 500325
  const codeOf = (symbol) => String(symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
  const symbolOf = (code) => (/^\d+$/.test(code) ? code + '.BO' : code.toUpperCase() + '.NS');
  const codeFromUrl = (href) => { const m = String(href || '').match(/\/company\/([^/]+)\//i); return m ? decodeURIComponent(m[1]) : ''; };
  const pageUrls = (symbol) => {
    const c = encodeURIComponent(codeOf(symbol));
    return [`https://www.screener.in/company/${c}/consolidated/`, `https://www.screener.in/company/${c}/`];
  };

  // ---------- a statement table: { labels, dates, rows: { normalised name: [values] } } ----------
  function readTable(section) {
    if (!section) return null;
    const tbl = section.querySelector('table.data-table') || section.querySelector('table');
    if (!tbl) return null;
    let head = Array.from(tbl.querySelectorAll('thead th')).map((th) => clean(th.textContent));
    if (!head.length) { const tr = tbl.querySelector('tr'); head = tr ? Array.from(tr.querySelectorAll('th,td')).map((c) => clean(c.textContent)) : []; }
    const labels = head.slice(1);
    if (!labels.length) return null;
    const rows = {};
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length < 2) return;
      const name = clean(cells[0].textContent).replace(/\s*\+$/, '').toLowerCase();
      if (!name || rows[name]) return;
      rows[name] = cells.slice(1).map((td) => num(td.textContent));
    });
    return { labels, dates: labels.map(isoOf), rows };
  }
  const pick = (t, ...names) => {
    if (!t) return null;
    for (const n of names) {
      const k = Object.keys(t.rows).find((x) => (n instanceof RegExp ? n.test(x) : x === n));
      if (k) return t.rows[k];
    }
    return null;
  };

  /* ---------- v22: "About the Company" = what the business does ----------
     screener's About text often (from the exchange filings) is the company's legal history: "incorporated as … on …",
     "name changed to …", "converted into a public limited company …". Those sentences are dropped; the business
     sentences are kept and the Key Points (segments, products, customers) are added after them. */
  const HISTORY_RE = /\b(incorporated|incorporation|was (originally |initially )?(formed|registered|established|set up|promoted)|name (of the company )?(was )?changed|changed its name|renamed|formerly known|erstwhile|converted (in)?to a public|public limited company|private limited company|registrar of companies|certificate of|\bCIN\b|pursuant to|vide (a |special )?resolution|fresh certificate|amalgamat|scheme of arrangement|listed on (the )?(bse|nse|stock exchange)|initial public offer|\bIPO\b|registered office|was (taken over|acquired by))/i;
  // a history sentence that also says what the business does ("…incorporated in 2015, operates India's largest trucking platform") stays
  const DOES_RE = /\b(engaged in|engages in|operates|manufactur\w*|provid\w*|offers|sells|business of|makes|produces|develops|distribut\w*)\b/i;
  function sentences(t) { return String(t || '').replace(/\s+/g, ' ').match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || []; }
  function businessSummary(about, keyPoints) {
    // also dropped: the founder / promoter / ownership story, and fragments like "43% in Jio Platforms (RJIL)."
    const OWN_RE = /\b(founded by|promoted (and managed )?by|promoters?|shareholding|stake in|holding in|family (owns|holds|has)|managing director|chairman)\b/i;
    const ok = (x) => x.length >= 40 && !/^[\d%(~]/.test(x) && !OWN_RE.test(x) && (!HISTORY_RE.test(x) || DOES_RE.test(x));
    let txt = sentences(about).map((x) => x.trim()).filter((x) => x.length > 20 && ok(x)).join(' ');
    let extra = '';
    for (const x of sentences(keyPoints).map((y) => y.trim()).filter(ok)) {
      if ((txt + ' ' + extra).length > 900) break;
      extra += (extra ? ' ' : '') + x;
    }
    txt = [txt, extra].filter(Boolean).join(' ').trim();
    return txt.length >= 60 ? txt : '';
  }

  // ---------- the whole company page ----------
  function parse(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const $ = (s) => doc.querySelector(s);
    const out = { ok: false };
    out.name = clean(($('#top h1') || $('h1') || {}).textContent);
    const info = $('[data-warehouse-id]');
    out.warehouseId = info ? info.getAttribute('data-warehouse-id') : '';
    out.companyId = info ? info.getAttribute('data-company-id') : '';
    // top ratios
    const top = {};
    doc.querySelectorAll('#top-ratios li').forEach((li) => {
      const n = clean((li.querySelector('.name') || {}).textContent).toLowerCase();
      const nums = Array.from(li.querySelectorAll('.number')).map((x) => num(x.textContent));
      if (/market cap/.test(n)) top.marketCap = nums[0];
      else if (/current price/.test(n)) top.price = nums[0];
      else if (/high \/ low/.test(n)) { top.high = nums[0]; top.low = nums[1]; }
      else if (/stock p\/e/.test(n)) top.pe = nums[0];
      else if (/book value/.test(n)) top.bookValue = nums[0];
      else if (/dividend yield/.test(n)) top.divYield = nums[0];
      else if (/^roce/.test(n)) top.roce = nums[0];
      else if (/^roe/.test(n)) top.roe = nums[0];
      else if (/face value/.test(n)) top.faceValue = nums[0];
    });
    out.top = top;
    // profile
    const about = $('.company-profile .about') || $('.about');
    out.about = clean(about ? Array.from(about.querySelectorAll('p')).map((p) => p.textContent).join(' ') || about.textContent : '').replace(/\s*\[\d+\]\s*/g, ' ').trim();
    // v22: screener's "Key Points" (business segments, products, market share …) — about the business, not its history
    const kp = $('.company-profile .commentary');
    out.keyPoints = kp ? Array.from(kp.querySelectorAll('p, li')).map((x) => clean(x.textContent)).filter(Boolean).join(' ').replace(/\s*\[\d+\]\s*/g, ' ').replace(/\s+/g, ' ').trim() : '';
    out.summary = businessSummary(out.about, out.keyPoints);
    const links = Array.from(doc.querySelectorAll('.company-links a[href]')).map((a) => a.getAttribute('href'));
    out.website = links.find((h) => /^https?:\/\//.test(h) && !/screener\.in|bseindia|nseindia/i.test(h)) || '';
    // sector / industry: the classification links above the peer table (newer pages) or "Sector: … | Industry: …"
    const cls = {};
    doc.querySelectorAll('#peers a[title]').forEach((a) => { cls[clean(a.getAttribute('title')).toLowerCase()] = clean(a.textContent); });
    const subTxt = clean(($('#peers .sub') || {}).textContent);
    out.broadSector = cls['broad sector'] || '';
    out.sector = cls['sector'] || cls['broad sector'] || ((subTxt.match(/Sector:\s*([^|]+)/i) || [])[1] || '').trim();
    out.industry = cls['industry'] || cls['broad industry'] || ((subTxt.match(/Industry:\s*(.+)$/i) || [])[1] || '').trim();
    out.broadIndustry = cls['broad industry'] || '';
    // v21: the industry's own company list (/market/…/) — a second way to find peers if the peers API is unavailable
    const indA = doc.querySelector('#peers a[title="Industry"][href], #peers a[title="Broad Industry"][href]');
    out.industryUrl = indA ? indA.getAttribute('href') : '';
    // screener's own pros / cons lists (used by the Ask Plutus quick mode)
    const li = (sel) => Array.from(doc.querySelectorAll(sel)).map((x) => clean(x.textContent)).filter(Boolean).slice(0, 8);
    out.pros = li('.pros li'); out.cons = li('.cons li');
    // statements
    out.pl = readTable($('#profit-loss'));
    out.qr = readTable($('#quarters'));
    out.bs = readTable($('#balance-sheet'));
    out.cf = readTable($('#cash-flow'));
    out.ratios = readTable($('#ratios'));
    out.consolidated = /consolidated/i.test(clean(($('#profit-loss .sub, #profit-loss p') || {}).textContent)) || !!$('[data-consolidated="true"]');
    out.docs = parseDocs(doc);
    const sales = pick(out.pl, 'sales', 'revenue', /^revenue/);
    out.ok = !!(out.pl && sales && sales.some(isNum));
    out.isBank = !!(out.pl && (pick(out.pl, 'financing profit') || pick(out.bs, 'deposits')));
    return out;
  }

  // annual reports + con-call transcripts listed on the page
  function parseDocs(doc) {
    const annual = [], concalls = [];
    doc.querySelectorAll('.annual-reports a[href]').forEach((a) => {
      const t = clean(a.textContent), y = (t.match(/(20\d\d)/) || [])[1];
      annual.push({ year: y ? +y : null, title: t.replace(/from (bse|nse).*/i, '').trim(), url: a.getAttribute('href') });
    });
    doc.querySelectorAll('.concalls li').forEach((li) => {
      const when = clean((li.querySelector('div') || {}).textContent);
      const tr = Array.from(li.querySelectorAll('a[href]')).find((a) => /transcript/i.test(a.textContent + ' ' + (a.getAttribute('title') || '')));
      if (tr) concalls.push({ when, url: tr.getAttribute('href') });
    });
    return { annual, concalls };
  }

  // ---------- peers: /api/company/<warehouse id>/peers/ (an HTML table) ----------
  function parsePeers(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ths = Array.from(doc.querySelectorAll('th')).map((th) => clean(th.textContent).toLowerCase());
    const col = (rx) => ths.findIndex((h) => rx.test(h));
    const ci = { cmp: col(/^cmp/), pe: col(/^p\/e/), mcap: col(/^mar cap/), dy: col(/div yld/), roce: col(/^roce/) };
    const out = [];
    doc.querySelectorAll('tr').forEach((tr) => {
      const a = tr.querySelector('a[href*="/company/"]'); if (!a) return;
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.textContent));
      const v = (i) => (i >= 0 ? num(tds[i]) : null);
      const code = codeFromUrl(a.getAttribute('href'));
      if (code) out.push({ code, symbol: symbolOf(code), name: clean(a.getAttribute('title') || a.textContent), url: a.getAttribute('href'),
        price: v(ci.cmp), pe: v(ci.pe), marketCap: isNum(v(ci.mcap)) ? v(ci.mcap) * CR : null, divYield: v(ci.dy), roce: v(ci.roce) });
    });
    return out;
  }
  // ---------- company search: /api/company/search/?q= (JSON) ----------
  function parseSearch(json) {
    return (Array.isArray(json) ? json : []).filter((x) => x && x.url && x.name).map((x) => {
      const code = codeFromUrl(x.url);
      return code ? { symbol: symbolOf(code), name: clean(x.name), code } : null;
    }).filter(Boolean);
  }

  /* ---------- screener page → Yahoo-shaped results ----------
     yahooTs (optional): Yahoo's own timeseries result. Screener's figures win for every line it publishes; Yahoo fills in
     the detail lines screener's page doesn't show (receivables, inventory, current assets / liabilities, cash, capex …). */
  function toYahoo(p, yahooTs, extra) {
    extra = extra || {};
    const series = new Map();      // type → Map(date → value)
    const put = (type, date, v) => { if (!date || !isNum(v)) return; if (!series.has(type)) series.set(type, new Map()); series.get(type).set(date, v); };
    // 1. Yahoo first (detail lines), then screener on top
    const yres = (yahooTs && yahooTs.timeseries && yahooTs.timeseries.result) || [];
    yres.forEach((r) => {
      const type = r.meta && r.meta.type && r.meta.type[0];
      (r[type] || []).filter(Boolean).forEach((x) => put(type, x.asOfDate, x.reportedValue && x.reportedValue.raw));
    });
    const screenerOcf = new Set();
    const addTable = (t, prefix, map) => {
      if (!t) return;
      t.dates.forEach((dt, i) => {
        if (!dt) return;   // "TTM" column
        Object.entries(map).forEach(([type, fn]) => { const v = fn(i); if (isNum(v)) put(prefix + type, dt, v); });
      });
    };
    const pl = p.pl, bs = p.bs, cf = p.cf;
    const P = (t, ...n) => pick(t, ...n) || [];
    const sales = P(pl, 'sales', 'revenue', /^revenue/), op = P(pl, 'operating profit', 'financing profit'), oi = P(pl, 'other income');
    const intr = P(pl, 'interest'), dep = P(pl, 'depreciation'), pbt = P(pl, 'profit before tax'), taxp = P(pl, 'tax %');
    const np = P(pl, 'net profit'), eps = P(pl, /^eps/), payout = P(pl, /dividend payout/);
    const cr = (arr, i) => (isNum(arr[i]) ? arr[i] * CR : null);
    const ebitAt = (i) => (isNum(op[i]) && isNum(dep[i]) && !p.isBank ? (op[i] - dep[i]) * CR : isNum(pbt[i]) && isNum(intr[i]) && !p.isBank ? (pbt[i] + intr[i]) * CR : null);
    const plMap = {
      TotalRevenue: (i) => cr(sales, i), NetIncome: (i) => cr(np, i), NetIncomeCommonStockholders: (i) => cr(np, i),
      EBITDA: (i) => (p.isBank ? null : cr(op, i)), EBIT: ebitAt, OperatingIncome: ebitAt,
      PretaxIncome: (i) => cr(pbt, i), TaxProvision: (i) => (isNum(pbt[i]) && isNum(taxp[i]) ? pbt[i] * taxp[i] / 100 * CR : null),
      InterestExpense: (i) => (p.isBank ? null : cr(intr, i)),
      DilutedEPS: (i) => (isNum(eps[i]) ? eps[i] : null), BasicEPS: (i) => (isNum(eps[i]) ? eps[i] : null),
      // shares ≈ profit ÷ EPS when Yahoo hasn't got the count for that year
      DilutedAverageShares: (i) => (isNum(np[i]) && isNum(eps[i]) && eps[i] !== 0 ? Math.abs(np[i] * CR / eps[i]) : null)
    };
    if (p.isBank) plMap.NetInterestIncome = (i) => (isNum(sales[i]) && isNum(intr[i]) ? (sales[i] - intr[i]) * CR : null);
    addTable(pl, 'annual', plMap);
    // balance sheet
    const eqc = P(bs, 'equity capital'), res = P(bs, 'reserves'), bor = P(bs, 'borrowings', 'borrowing'), ta = P(bs, 'total assets');
    const fa = P(bs, 'fixed assets', /^net block/), cwip = P(bs, 'cwip');
    addTable(bs, 'annual', {
      StockholdersEquity: (i) => (isNum(eqc[i]) && isNum(res[i]) ? (eqc[i] + res[i]) * CR : null),
      TotalDebt: (i) => cr(bor, i), TotalAssets: (i) => cr(ta, i), NetPPE: (i) => cr(fa, i), ConstructionInProgress: (i) => cr(cwip, i),
      TotalLiabilitiesNetMinorityInterest: (i) => (isNum(ta[i]) && isNum(eqc[i]) && isNum(res[i]) ? (ta[i] - eqc[i] - res[i]) * CR : null)
    });
    // cash flow
    const cfo = P(cf, /cash from operating/);
    addTable(cf, 'annual', { OperatingCashFlow: (i) => { const v = cr(cfo, i); if (isNum(v)) screenerOcf.add(cf.dates[i]); return v; } });
    // Yahoo's own free cash flow was built on Yahoo's OCF: recompute it from screener's OCF + Yahoo's capex instead
    if (series.has('annualFreeCashFlow')) screenerOcf.forEach((dt) => series.get('annualFreeCashFlow').delete(dt));
    // quarters
    const q = p.qr;
    const qs = P(q, 'sales', 'revenue', /^revenue/), qop = P(q, 'operating profit', 'financing profit'), qdep = P(q, 'depreciation');
    const qnp = P(q, 'net profit'), qeps = P(q, /^eps/), qpbt = P(q, 'profit before tax'), qint = P(q, 'interest');
    addTable(q, 'quarterly', {
      TotalRevenue: (i) => cr(qs, i), NetIncome: (i) => cr(qnp, i), NetIncomeCommonStockholders: (i) => cr(qnp, i),
      EBITDA: (i) => (p.isBank ? null : cr(qop, i)),
      OperatingIncome: (i) => (p.isBank ? null : isNum(qop[i]) && isNum(qdep[i]) ? (qop[i] - qdep[i]) * CR : isNum(qpbt[i]) && isNum(qint[i]) ? (qpbt[i] + qint[i]) * CR : null),
      DilutedEPS: (i) => (isNum(qeps[i]) ? qeps[i] : null), BasicEPS: (i) => (isNum(qeps[i]) ? qeps[i] : null)
    });
    const ts = { timeseries: { result: [...series.entries()].map(([type, m]) => ({ meta: { type: [type] },
      [type]: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ asOfDate: d, currencyCode: 'INR', reportedValue: { raw: v } })) })), error: null } };

    // quoteSummary-shaped profile + headline numbers
    const t = p.top || {}, R = (v) => (isNum(v) ? { raw: v } : undefined);
    const ttm = (arr) => (pl && /ttm/i.test(pl.labels[pl.labels.length - 1]) ? arr[pl.labels.length - 1] : null);
    const ttmEps = ttm(eps), lastPayout = [...payout].reverse().find(isNum);
    const price = isNum(extra.price) ? extra.price : t.price;
    // screener's market cap / P/E / yield use its own last price: rescale them to the live price used everywhere else
    const k = isNum(extra.price) && isNum(t.price) && t.price > 0 ? extra.price / t.price : 1;
    const mcap = isNum(t.marketCap) ? t.marketCap * CR * k : null;
    const pe = isNum(ttmEps) && ttmEps > 0 && isNum(price) ? price / ttmEps : isNum(t.pe) ? t.pe * k : null;
    const dy = isNum(t.divYield) ? t.divYield / 100 / k : null;
    const sum = { quoteSummary: { result: [{
      price: { longName: p.name || undefined, shortName: p.name || undefined, currency: 'INR', regularMarketPrice: R(price), marketCap: R(mcap), exchangeName: extra.exchange || 'NSE' },
      summaryDetail: { trailingPE: R(pe), dividendYield: R(dy), marketCap: R(mcap),
        fiftyTwoWeekHigh: R(t.high), fiftyTwoWeekLow: R(t.low), beta: R(extra.beta), payoutRatio: R(isNum(lastPayout) ? lastPayout / 100 : null) },
      defaultKeyStatistics: { trailingEps: R(ttmEps), bookValue: R(t.bookValue), priceToBook: R(isNum(price) && isNum(t.bookValue) && t.bookValue > 0 ? price / t.bookValue : null),
        enterpriseValue: undefined },
      financialData: { financialCurrency: 'INR' },
      assetProfile: { sector: p.sector || p.broadSector || '', industry: p.industry || p.broadIndustry || '', longBusinessSummary: p.summary || '',
        website: p.website || '', country: 'India' }
    }], error: null } };
    return { ts, sum };
  }

  // beta from weekly returns against the Nifty 50 (Yahoo ^NSEI), over the overlapping weeks
  function betaFrom(stockChart, indexChart) {
    const pts = (c) => { const r = c && c.chart && c.chart.result && c.chart.result[0]; if (!r || !r.timestamp) return null;
      const q = (r.indicators && (r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose)) || (r.indicators.quote[0] || {}).close || [];
      const m = new Map(); r.timestamp.forEach((t, i) => { if (isNum(q[i])) m.set(Math.round(t / 604800), q[i]); }); return m; };
    const s = pts(stockChart), x = pts(indexChart); if (!s || !x) return null;
    const weeks = [...s.keys()].filter((k) => x.has(k)).sort((a, b) => a - b);
    const rs = [], rx = [];
    for (let i = 1; i < weeks.length; i++) {
      const a = weeks[i - 1], b = weeks[i]; if (b - a !== 1) continue;
      rs.push(s.get(b) / s.get(a) - 1); rx.push(x.get(b) / x.get(a) - 1);
    }
    if (rs.length < 52) return null;
    const mean = (v) => v.reduce((p, c) => p + c, 0) / v.length, ms = mean(rs), mx = mean(rx);
    let cov = 0, vx = 0; for (let i = 0; i < rs.length; i++) { cov += (rs[i] - ms) * (rx[i] - mx); vx += (rx[i] - mx) ** 2; }
    return vx > 0 ? cov / vx : null;
  }

  /* ---------- v21: the page as text chunks, so Ask Plutus can answer at once (before / without the annual-report job) ---------- */
  function quickChunks(p, extra) {
    extra = extra || {};
    if (!p || !p.ok) return [];
    const out = [];
    const add = (section, tag, text) => { if (text && text.trim()) out.push({ id: 'q' + (out.length + 1), section, tag, page: null, page_kind: 'html', document: 'screener.in company page', doc_type: 'financials', text: text.trim() }); };
    const fmt = (v) => (isNum(v) ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-IN') : String(+v.toFixed(2))) : '–');
    const tableText = (t, title, unit, keep) => {
      if (!t) return '';
      const idx = t.labels.map((_, i) => i).slice(-(keep || 6));
      const lines = Object.entries(t.rows).filter(([, v]) => v.some(isNum)).slice(0, 18)
        .map(([k, v]) => `${k.replace(/^\w/, (c) => c.toUpperCase())}: ` + idx.map((i) => `${t.labels[i]} ${fmt(v[i])}`).join('; '));
      return lines.length ? `${title}${unit ? ' (' + unit + ')' : ''}:\n` + lines.join('\n') : '';
    };
    const t = p.top || {};
    add('Company overview', 'business', [`${p.name || extra.name || ''}${p.sector ? ' — sector: ' + p.sector : ''}${p.industry ? ', industry: ' + p.industry : ''}.`, p.about].filter(Boolean).join('\n'));
    if (p.keyPoints) add('Key points about the business', 'business', p.keyPoints.slice(0, 1500));
    add('Key ratios', 'highlights', [
      isNum(t.marketCap) && `Market cap ₹${fmt(t.marketCap)} crore`, isNum(t.price) && `share price ₹${fmt(t.price)}`,
      isNum(t.high) && `52-week high / low ₹${fmt(t.high)} / ₹${fmt(t.low)}`, isNum(t.pe) && `P/E ${fmt(t.pe)}`,
      isNum(t.bookValue) && `book value ₹${fmt(t.bookValue)} per share`, isNum(t.divYield) && `dividend yield ${fmt(t.divYield)}%`,
      isNum(t.roce) && `ROCE ${fmt(t.roce)}%`, isNum(t.roe) && `ROE ${fmt(t.roe)}%`].filter(Boolean).join('; ') + '.');
    if (p.pros && p.pros.length) add('Strengths (pros)', 'highlights', 'Strengths: ' + p.pros.join(' '));
    if (p.cons && p.cons.length) add('Weaknesses (cons) and risks', 'risk', 'Weaknesses / risks: ' + p.cons.join(' '));
    add('Profit and loss — annual', 'financials', tableText(p.pl, 'Annual profit & loss', '₹ crore, EPS in ₹, OPM and tax in %', 7));
    add('Quarterly results', 'financials', tableText(p.qr, 'Quarterly results', '₹ crore', 6));
    add('Balance sheet', 'financials', tableText(p.bs, 'Balance sheet — borrowings, reserves, assets, debt', '₹ crore', 6));
    add('Cash flow statement', 'cashflow', tableText(p.cf, 'Cash flows — operating, investing, financing activities', '₹ crore', 6));
    add('Ratios — working capital and returns', 'financials', tableText(p.ratios, 'Ratios (debtor days, inventory days, working capital days, ROCE %)', '', 6));
    if (p.docs && p.docs.concalls && p.docs.concalls.length) add('Conference calls listed', 'other', 'Conference calls on record: ' + p.docs.concalls.slice(0, 8).map((c) => c.when).filter(Boolean).join(', ') + '.');
    return out;
  }

  window.Screener = { parse, parsePeers, quickChunks, parseSearch, toYahoo, betaFrom, codeOf, symbolOf, codeFromUrl, pageUrls, isoOf };
})();
