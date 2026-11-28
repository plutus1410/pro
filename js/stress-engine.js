/* ============================================================
   PLUTUS — portfolio stress test engine (v48)
   Pure maths, no page code: js/stress.js calls it, and it also runs under Node for tests.
   Returns are plain fractions (-0.25 = a 25 % fall). Daily series are arrays on one shared trading calendar
   (data/risk/factors.json); null = no trade that day.
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- scenarios */
  // Historical windows: every trading day from `from` to `to` (both included) is compounded.
  const SCENARIOS = [
    { id: 'y2026', name: 'Early-2026 sell-off', from: '2026-01-05', to: '2026-03-30', kind: 'bear', note: 'FII outflows, weak rupee' },
    { id: 'fii', name: 'FII exodus 2024–25', from: '2024-09-27', to: '2025-03-04', kind: 'bear', note: 'Mid and small-cap froth unwinding' },
    { id: 'elec24', name: 'Election result day', from: '2024-06-04', to: '2024-06-04', kind: 'day', note: 'One-day political shock' },
    { id: 'rates22', name: '2022 global rate hikes', from: '2022-04-05', to: '2022-06-17', kind: 'bear', note: 'Monetary tightening' },
    { id: 'ukraine', name: 'Russia–Ukraine invasion', from: '2022-02-16', to: '2022-03-07', kind: 'bear', note: 'Geopolitical and commodity shock' },
    { id: 'covid', name: 'COVID crash', from: '2020-01-21', to: '2020-03-23', kind: 'bear', note: 'Fastest crash; everything falls together' },
    { id: 'covidday', name: 'COVID worst day', from: '2020-03-23', to: '2020-03-23', kind: 'day', note: 'Gap risk' },
    { id: 'ilfs', name: 'IL&FS / NBFC crisis', from: '2018-08-29', to: '2018-10-26', kind: 'bear', note: 'Credit and liquidity; NBFCs and midcaps' },
    { id: 'demo', name: 'Demonetisation', from: '2016-11-09', to: '2016-12-26', kind: 'bear', note: 'Consumption and cash-heavy sectors' },
    { id: 'china', name: 'China crash and yuan devaluation', from: '2015-08-11', to: '2016-02-29', kind: 'bear', note: 'Emerging-market sell-off' },
    { id: 'taper', name: 'Taper tantrum', from: '2013-05-22', to: '2013-08-28', kind: 'bear', note: 'Rupee shock: banks fall, IT exporters gain' },
    { id: 'euro', name: 'European debt crisis', from: '2011-07-27', to: '2011-12-20', kind: 'bear', note: 'Global risk aversion' },
    { id: 'gfc', name: 'Global financial crisis', from: '2008-01-08', to: '2008-10-27', kind: 'bear', note: 'Deepest bear market' },
    { id: 'e2004', name: '2004 election shock', from: '2004-05-17', to: '2004-05-17', kind: 'day', note: 'Political regime change' }
  ];

  // Hypothetical presets: market move, optional sector moves (absolute), USD/INR and crude moves.
  const PRESETS = [
    { id: 'n10', name: 'Nifty −10%', s: { NIFTY: -0.10 } },
    { id: 'n20', name: 'Nifty −20%', s: { NIFTY: -0.20 } },
    { id: 'n30', name: 'Nifty −30%', s: { NIFTY: -0.30 } },
    { id: 'rupee', name: 'Rupee −10%', s: { NIFTY: -0.05, FX: 0.10 } },
    { id: 'crude', name: 'Crude +50%', s: { NIFTY: -0.06, OIL: 0.50 } },
    { id: 'itcrash', name: 'IT −25% (US recession)', s: { NIFTY: -0.08, sectors: { IT: -0.25 } } },
    { id: 'banks', name: 'Rate shock: banks −20%', s: { NIFTY: -0.08, sectors: { BANK: -0.20, FIN: -0.22, PSUBANK: -0.25, REALTY: -0.25 } } },
    { id: 'psu', name: 'PSU de-rating', s: { NIFTY: -0.06, sectors: { PSUBANK: -0.30, ENERGY: -0.25, INFRA: -0.20 } } }
  ];

  // Which sector index tracks a company, from screener.in's sector / industry words.
  function sectorKey(sec, ind) {
    const s = String(sec || '').toLowerCase(), i = String(ind || '').toLowerCase();
    if (/bank/.test(i) && !/non[- ]?bank/.test(i)) return /public sector|psu/.test(i) ? 'PSUBANK' : 'BANK';
    if (/financ/.test(s)) return 'FIN';
    if (/information technology|software|it -|it services/.test(s + ' ' + i)) return 'IT';
    if (/fast moving|fmcg|consumer staples/.test(s)) return 'FMCG';
    if (/health|pharma/.test(s + ' ' + i)) return 'PHARMA';
    if (/auto/.test(s)) return 'AUTO';
    if (/metal|mining/.test(s)) return 'METAL';
    if (/realty|real estate/.test(s + ' ' + i)) return 'REALTY';
    if (/oil|gas|power|energy|fuel/.test(s)) return 'ENERGY';
    if (/capital goods|construction|infra/.test(s)) return 'INFRA';
    if (/media|entertainment/.test(s)) return 'MEDIA';
    return '';
  }

  /* ---------------------------------------------------------------- helpers */
  const bp = (x) => (x == null ? null : x / 10000);
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  function indexOn(dates, d, after) { // first index with date >= d (after) or last with date <= d
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (after ? dates[m] >= d : dates[m] <= d) { ans = m; if (after) hi = m - 1; else lo = m + 1; } else if (after) lo = m + 1; else hi = m - 1;
    }
    return ans;
  }
  // value of a series at calendar index t (series start at offset o)
  const at = (ser, t) => { if (!ser) return null; const k = t - (ser.o || 0); return k >= 0 && k < ser.r.length ? ser.r[k] : null; };

  function compound(ser, i0, i1) {
    let g = 1, n = 0, seen = false;
    for (let t = i0; t <= i1; t++) { const x = at(ser, t); if (x != null) { g *= 1 + x; n++; seen = true; } }
    return { ret: seen ? g - 1 : null, cover: (n / Math.max(1, i1 - i0 + 1)) };
  }

  /* ---------------------------------------------------------------- linear algebra */
  function solve(A, b) { // Gaussian elimination with partial pivoting; returns null if singular
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  function ols(y, X) { // X: rows of regressors (with the constant first)
    const k = X[0].length, XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
    for (let i = 0; i < y.length; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
    const beta = solve(XtX, Xty); if (!beta) return null;
    let ss = 0, st = 0; const my = y.reduce((s, v) => s + v, 0) / y.length;
    for (let i = 0; i < y.length; i++) { const f = X[i].reduce((s, v, a) => s + v * beta[a], 0); ss += (y[i] - f) ** 2; st += (y[i] - my) ** 2; }
    return { beta, r2: st > 0 ? 1 - ss / st : 0, ss, n: y.length, k };
  }

  /* ---------------------------------------------------------------- factor model (weekly, last 3 years) */
  // weekly blocks of 5 trading days ending at the last calendar day
  function weekly(ser, end, weeks) {
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const i1 = end - w * 5, i0 = i1 - 4; if (i0 < 0) break;
      const c = compound(ser, i0, i1); out.push(c.cover >= 0.6 ? c.ret : null);
    }
    return out.reverse();
  }
  function fit(h, cal) {
    const F = cal.f, end = cal.dates.length - 1, W = 156;
    const N = weekly(F.NIFTY, end, W), Y = weekly(h, end, W);
    const sk = h.fk && F[h.fk] ? h.fk : '';
    const S = sk ? weekly(F[sk], end, W) : null, FX = F.FX ? weekly(F.FX, end, W) : null, OIL = F.OIL ? weekly(F.OIL, end, W) : null;
    // sector index on the market → beta of the sector (so the sector term is what the sector does beyond the market)
    let bsn = 1;
    if (S) {
      const ys = [], xs = [];
      N.forEach((n, i) => { if (n != null && S[i] != null) { ys.push(S[i]); xs.push([1, n]); } });
      const r = ys.length >= 40 ? ols(ys, xs) : null; if (r) bsn = r.beta[1];
    }
    const ys = [], xs = [];
    N.forEach((n, i) => {
      if (n == null || Y[i] == null) return;
      const row = [1, n];
      if (S) { if (S[i] == null) return; row.push(S[i] - bsn * n); }
      if (FX) { if (FX[i] == null) return; row.push(FX[i]); }
      if (OIL) { if (OIL[i] == null) return; row.push(OIL[i]); }
      ys.push(Y[i]); xs.push(row);
    });
    const out = { bm: 1, bmRaw: 1, bs: 0, bsn, bfx: 0, boil: 0, r2: 0, n: ys.length, sk, dflt: true, sw: 0.05 };
    if (ys.length < 52) return out; // too little history: market beta 1
    const r = ols(ys, xs); if (!r) return out;
    let k = 1; out.bm = r.beta[k++];
    if (S) out.bs = r.beta[k++];
    if (FX) out.bfx = r.beta[k++];
    if (OIL) out.boil = r.beta[k++];
    out.r2 = r.r2; out.dflt = false; out.sw = Math.sqrt(r.ss / Math.max(1, r.n - r.k)); // weekly residual volatility
    out.bmRaw = out.bm; out.bm = 0.67 * out.bm + 0.33; // Blume adjustment: estimated betas drift toward 1 over time
    // keep wild estimates (thin trading, few weeks) inside sane bounds
    out.bm = Math.max(-0.5, Math.min(3, out.bm)); out.bs = Math.max(-1, Math.min(3, out.bs));
    out.bfx = Math.max(-3, Math.min(3, out.bfx)); out.boil = Math.max(-1, Math.min(1, out.boil));
    return out;
  }

  /* ---------------------------------------------------------------- scenarios */
  function windowIdx(cal, sc) {
    const i0 = indexOn(cal.dates, sc.from, true), i1 = indexOn(cal.dates, sc.to, false);
    return i0 < 0 || i1 < 0 || i1 < i0 ? null : [i0, i1];
  }
  function factorMove(cal, key, w) { const s = cal.f[key]; return s ? compound(s, w[0], w[1]).ret : null; }
  const clampRet = (r) => Math.max(-0.95, Math.min(5, r));

  // one holding in one historical window: its own return if it traded through it, else the factor-model estimate
  function scenarioRet(h, beta, cal, w) {
    const own = compound(h, w[0], w[1]);
    if (own.ret != null && own.cover >= 0.8 && (h.o || 0) <= w[0]) return { ret: own.ret, est: false };
    const N = factorMove(cal, 'NIFTY', w); if (N == null) return { ret: null, est: true };
    const S = beta.sk ? factorMove(cal, beta.sk, w) : null, FX = factorMove(cal, 'FX', w), OIL = factorMove(cal, 'OIL', w);
    let r = beta.bm * N;
    if (S != null) r += beta.bs * (S - beta.bsn * N);
    if (FX != null) r += beta.bfx * FX;
    if (OIL != null) r += beta.boil * OIL;
    const days = w[1] - w[0] + 1, band = 1.645 * (beta.sw || 0.05) * Math.sqrt(days / 5); // 90 % range from the model's unexplained moves
    return { ret: clampRet(r), est: true, band };
  }
  function runScenarios(P, cal) { // P = { holdings:[{…, value, beta}] , total }
    return SCENARIOS.map((sc) => {
      const w = windowIdx(cal, sc);
      if (!w) return { ...sc, ret: null, pnl: null, nifty: null, rows: [], est: 0, days: 0 };
      const rows = P.holdings.map((h) => { const r = scenarioRet(h, h.beta, cal, w); return { h, ret: r.ret, est: r.est, band: r.band || 0, pnl: r.ret == null ? 0 : h.value * r.ret }; });
      const pnl = rows.reduce((s, x) => s + x.pnl, 0);
      const band = Math.sqrt(rows.reduce((a, x) => a + (x.est ? (x.h.value * x.band) ** 2 : 0), 0)) / P.total; // independent errors
      return { ...sc, ret: pnl / P.total, pnl, band, nifty: factorMove(cal, 'NIFTY', w), rows, est: rows.filter((x) => x.est).length, days: w[1] - w[0] + 1, from: cal.dates[w[0]], to: cal.dates[w[1]] };
    });
  }

  /* ---------------------------------------------------------------- hypothetical shocks */
  function shockRet(beta, s) {
    const N = s.NIFTY || 0, sec = s.sectors || {};
    const S = beta.sk && isNum(sec[beta.sk]) ? sec[beta.sk] : beta.bsn * N; // a sector not shocked moves with the market
    return clampRet(beta.bm * N + beta.bs * (S - beta.bsn * N) + beta.bfx * (s.FX || 0) + beta.boil * (s.OIL || 0));
  }
  function runShock(P, s) {
    const rows = P.holdings.map((h) => { const r = shockRet(h.beta, s); return { h, ret: r, pnl: h.value * r }; });
    const pnl = rows.reduce((a, x) => a + x.pnl, 0);
    return { ret: pnl / P.total, pnl, rows };
  }
  function sensitivity(P, steps) {
    return (steps || [-0.05, -0.10, -0.15, -0.20, -0.25, -0.30, -0.35, -0.40]).map((n) => ({ nifty: n, ret: runShock(P, { NIFTY: n }).ret }));
  }
  // Reverse stress test: how far must the market fall (sectors moving with it) to lose `loss` (e.g. 0.30)?
  function reverse(P, loss) {
    const bp = P.holdings.reduce((s, h) => s + (h.value / P.total) * h.beta.bm, 0); // shockRet with only NIFTY = bm·N
    if (bp <= 0.05) return { nifty: null, beta: bp };
    const n = -loss / bp;
    return { nifty: n < -1 ? null : n, beta: bp };
  }

  /* ---------------------------------------------------------------- daily portfolio history */
  // Portfolio daily returns over the last `n` calendar days; a holding with no trade that day is filled from the
  // factor model on the market's move (so a newly listed stock still counts).
  function portfolioDaily(P, cal, n, parts) {
    const end = cal.dates.length - 1, start = Math.max(1, end - (n || 2500) + 1), out = [], nifty = [], dates = [], comp = parts ? P.holdings.map(() => []) : null;
    for (let t = start; t <= end; t++) {
      const N = at(cal.f.NIFTY, t); if (N == null) continue;
      let r = 0;
      P.holdings.forEach((h, i) => {
        let x = at(h, t);
        if (x == null) {
          const b = h.beta; x = b.bm * N;
          const S = b.sk ? at(cal.f[b.sk], t) : null; if (S != null) x += b.bs * (S - b.bsn * N);
        }
        const c = (h.value / P.total) * x; r += c; if (comp) comp[i].push(c);
      });
      out.push(r); nifty.push(N); dates.push(cal.dates[t]);
    }
    return { r: out, nifty, dates, comp };
  }
  function varES(daily, conf) {
    const s = daily.slice().sort((a, b) => a - b), k = Math.max(0, Math.floor((1 - conf) * s.length) - 1);
    const tail = s.slice(0, k + 1);
    return { var: -s[k], es: -(tail.reduce((a, v) => a + v, 0) / tail.length) };
  }
  // Kupiec proportion-of-failures test on a rolling 1-day 99 % historical VaR (window 500 days)
  function kupiec(daily, conf, win) {
    conf = conf || 0.99; win = win || 500;
    let x = 0, T = 0;
    for (let t = win; t < daily.length; t++) {
      const v = varES(daily.slice(t - win, t), conf).var;
      if (-daily[t] > v) x++;
      T++;
    }
    if (T < 100) return null;
    const p = 1 - conf, ph = x / T;
    const ll = (q) => (q <= 0 || q >= 1 ? 0 : (T - x) * Math.log(1 - q) + x * Math.log(q));
    const lr = x === 0 ? -2 * (T * Math.log(1 - p)) : -2 * (ll(p) - ll(ph));
    return { breaches: x, expected: p * T, days: T, lr, pass: lr < 3.841 };
  }

  /* ---------------------------------------------------------------- diversification in crashes */
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  function cov(a, b) { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / (a.length - 1); }
  function corr(a, b) { const c = cov(a, b), va = cov(a, a), vb = cov(b, b); return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : null; }
  function crashCheck(P, cal, n, cut) {
    cut = cut == null ? -0.02 : cut;
    const end = cal.dates.length - 1, start = Math.max(1, end - (n || 2500) + 1);
    const hs = P.holdings.slice().sort((a, b) => b.value - a.value).slice(0, 25); // the 25 largest are plenty
    const days = { all: [], crash: [] };
    for (let t = start; t <= end; t++) {
      const N = at(cal.f.NIFTY, t); if (N == null) continue;
      const xs = hs.map((h) => at(h, t)); if (xs.some((x) => x == null)) continue;
      let p = 0; hs.forEach((h, i) => { p += (h.value / P.total) * xs[i]; });
      const row = { N, p, xs }; days.all.push(row); if (N <= cut) days.crash.push(row);
    }
    const stats = (rows) => {
      if (rows.length < 15) return null;
      const N = rows.map((r) => r.N), p = rows.map((r) => r.p), vn = cov(N, N);
      let cs = 0, cn = 0;
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        const c = corr(rows.map((r) => r.xs[i]), rows.map((r) => r.xs[j])); if (c != null) { cs += c; cn++; }
      }
      return { beta: vn > 0 ? cov(p, N) / vn : null, corr: cn ? cs / cn : null, days: rows.length, avg: mean(p) };
    };
    return { all: stats(days.all), crash: stats(days.crash), n: hs.length };
  }

  /* ---------------------------------------------------------------- liquidity (AMFI method) */
  // AMFI: sell pro-rata at 10 % of 3× the average daily volume, after setting aside the 20 % least liquid holdings.
  function liquidity(P, which) {
    const key = which || 'adv3';
    const rows = P.holdings.map((h) => {
      if (h.kind === 'mf') return { h, cap: Infinity, days: 1 };
      const adv = h[key] || h.adv3 || h.adv12, cap = adv && h.px ? 0.10 * 3 * adv * h.px : null;
      return { h, cap, days: cap ? h.value / cap : null };
    });
    const known = rows.filter((r) => r.days != null);
    // least liquid first; drop holdings until 20 % of the portfolio's value is set aside
    const order = known.slice().sort((a, b) => b.days - a.days);
    let dropped = 0; const keep = [];
    for (const r of order) { if (dropped + r.h.value <= 0.20 * P.total) dropped += r.h.value; else keep.push(r); }
    const pr = (f) => (keep.length ? Math.max(...keep.map((r) => (f * r.h.value) / r.cap)) : null);
    const all = (f) => (known.length ? Math.max(...known.map((r) => (f * r.h.value) / r.cap)) : null);
    return { d25: pr(0.25), d50: pr(0.5), d100: all(1), rows, unknown: rows.length - known.length };
  }

  /* ---------------------------------------------------------------- Monte Carlo (block bootstrap) */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // paths of `days` trading days made of `block`-day runs of real history (keeps fat tails and calm/storm clustering)
  function monteCarlo(daily, paths, days, block, seed, from, to) {
    days = days || 250; block = block || 10;
    const R = rng(seed || 7), out = [], dd = [];
    const n = daily.length - block;
    for (let p = from || 0; p < (to == null ? paths : to); p++) {
      let g = 1, peak = 1, md = 0, d = 0;
      while (d < days) {
        const s = Math.floor(R() * n);
        for (let k = 0; k < block && d < days; k++, d++) { g *= 1 + daily[s + k]; if (g > peak) peak = g; else md = Math.min(md, g / peak - 1); }
      }
      out.push(g - 1); dd.push(md);
    }
    return { ret: out, dd };
  }
  function pct(sorted, q) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1)))); return sorted[i]; }


  /* ---------------------------------------------------------------- more risk measures (v50) */
  // h-day returns from overlapping windows of real history (no √h shortcut)
  function horizon(daily, h) {
    if (h <= 1) return daily.slice();
    const out = [];
    for (let i = 0; i + h <= daily.length; i++) { let g = 1; for (let k = i; k < i + h; k++) g *= 1 + daily[k]; out.push(g - 1); }
    return out;
  }
  function moments(d) {
    const m = mean(d); let v = 0, s3 = 0, s4 = 0;
    d.forEach((x) => { const e = x - m; v += e * e; s3 += e ** 3; s4 += e ** 4; });
    const n = d.length, sd = Math.sqrt(v / (n - 1));
    return { mean: m, sd, skew: (s3 / n) / sd ** 3, kurt: (s4 / n) / sd ** 4 - 3 };
  }
  function ewmaVol(d, lambda) { // RiskMetrics: recent days count more, so it reflects today's conditions
    lambda = lambda || 0.94;
    let v = d.slice(0, 60).reduce((a, x) => a + x * x, 0) / 60;
    for (let i = 60; i < d.length; i++) v = lambda * v + (1 - lambda) * d[i] * d[i];
    return Math.sqrt(v);
  }
  const ZQ = { 0.95: 1.6449, 0.99: 2.3263 }, phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  // three ways to measure a bad h-day loss at confidence `conf`
  function riskTable(daily, horizons, conf) {
    const z = ZQ[conf], m = moments(daily), ew = ewmaVol(daily);
    const zc = -z, S = Math.max(-2, Math.min(2, m.skew)), K = Math.max(0, Math.min(12, m.kurt));
    const zcf = zc + (zc * zc - 1) * S / 6 + (zc ** 3 - 3 * zc) * K / 24 - (2 * zc ** 3 - 5 * zc) * S * S / 36; // Cornish-Fisher
    return horizons.map((h) => {
      const hist = varES(horizon(daily, h), conf), sq = Math.sqrt(h);
      return { h, hist: hist.var, histES: hist.es, ewma: z * ew * sq, ewmaES: ew * sq * phi(z) / (1 - conf), cf: -zcf * m.sd * sq };
    });
  }
  // Stressed VaR (Basel): the 1-day VaR measured over the worst 250-day stretch in the whole history
  function stressedVaR(daily, dates, conf, win) {
    conf = conf || 0.99; win = win || 250;
    let best = null;
    for (let i = 0; i + win <= daily.length; i += 5) {
      const v = varES(daily.slice(i, i + win), conf);
      if (!best || v.var > best.var) best = { var: v.var, es: v.es, from: dates[i], to: dates[i + win - 1] };
    }
    return best;
  }
  function drawdown(daily, dates) {
    let g = 1, peak = 1, pk = 0, best = { dd: 0 };
    for (let i = 0; i < daily.length; i++) {
      g *= 1 + daily[i];
      if (g >= peak) { peak = g; pk = i; }
      const d = g / peak - 1;
      if (d < best.dd) best = { dd: d, peak: dates[pk], trough: dates[i], pk, ti: i, level: peak };
    }
    if (best.dd < 0) { // when did it get back to the old high?
      let g2 = 1; const curve = daily.map((x) => (g2 *= 1 + x)), target = curve[best.pk];
      best.recovered = null;
      for (let i = best.ti + 1; i < curve.length; i++) if (curve[i] >= target) { best.recovered = dates[i]; best.days = i - best.ti; break; }
    }
    return best;
  }
  function concentration(P) {
    const w = P.holdings.map((h) => ({ h, w: h.value / P.total })).sort((a, b) => b.w - a.w);
    const hhi = w.reduce((a, x) => a + x.w * x.w, 0), sec = {};
    P.holdings.forEach((h) => { sec[h.secName || 'Other'] = (sec[h.secName || 'Other'] || 0) + h.value / P.total; });
    const secs = Object.entries(sec).sort((a, b) => b[1] - a[1]);
    return { top: w[0], top5: w.slice(0, 5).reduce((a, x) => a + x.w, 0), effN: 1 / hhi, n: w.length, sectors: secs, topSector: secs[0] };
  }
  // Each holding's share of the losses on the portfolio's worst days (component expected shortfall)
  function contributions(P, daily, conf) {
    const qs = daily.r.slice().sort((a, b) => a - b), cut = qs[Math.max(0, Math.floor((1 - (conf || 0.99)) * qs.length) - 1)];
    const tail = []; daily.r.forEach((x, t) => { if (x <= cut) tail.push(t); });
    const tot = tail.reduce((a, t) => a + daily.r[t], 0);
    return P.holdings.map((h, i) => ({ h, share: tot ? tail.reduce((a, t) => a + daily.comp[i][t], 0) / tot : 0, weight: h.value / P.total })).sort((a, b) => b.share - a.share);
  }
  // How the portfolio compares with the market across the long bear markets
  function vsMarket(scen) {
    const r = scen.filter((s) => s.kind === 'bear' && s.ret != null && s.nifty != null && s.nifty < -0.05).map((s) => s.ret / s.nifty);
    if (!r.length) return null;
    const x = mean(r);
    const label = x < 0.85 ? 'Lower than the market' : x <= 1.15 ? 'In line with the market' : x <= 1.4 ? 'Higher than the market' : 'Much higher than the market';
    const level = x < 0.85 ? 1 : x <= 1.15 ? 2 : x <= 1.4 ? 3 : 4;
    return { ratio: x, label, level, n: r.length };
  }


  /* ================================================================ v56: the full framework
     (historical · hypothetical · factor · business · Monte Carlo · reverse · liquidity · risk aggregation) */

  // Hypothetical scenario library. Moves are for the whole period; sector moves are absolute (not on top of the market).
  // MID / SMALL: the Nifty Midcap / Smallcap index moves. Illustrative assumptions, not predictions.
  const HYPO = [
    { id: 'mild', group: 'market', name: 'Mild correction', s: { NIFTY: -0.10, MID: -0.15, SMALL: -0.20 }, what: 'Nifty down 10%, midcaps 15%, smallcaps 20%' },
    { id: 'moderate', group: 'market', name: 'Moderate crash', s: { NIFTY: -0.20, MID: -0.30, SMALL: -0.35 }, what: 'Nifty down 20%, midcaps 30%, smallcaps 35%' },
    { id: 'severe', group: 'market', name: 'Severe crash', s: { NIFTY: -0.30, MID: -0.40, SMALL: -0.50 }, what: 'Nifty down 30%, midcaps 40%, smallcaps 50%' },
    { id: 'extreme', group: 'market', name: 'Extreme crash', s: { NIFTY: -0.40, MID: -0.55, SMALL: -0.65 }, what: 'Nifty down 40%, midcaps 55%, smallcaps 65%' },
    { id: 'rates', group: 'macro', name: 'Interest rates up 2%', s: { NIFTY: -0.06, sectors: { BANK: -0.09, FIN: -0.12, PSUBANK: -0.10, REALTY: -0.16, AUTO: -0.09, INFRA: -0.08 } }, what: 'RBI repo rate up 200 bp; rate-sensitive sectors fall most' },
    { id: 'rupee', group: 'macro', name: 'Rupee falls 12%', s: { NIFTY: -0.05, FX: 0.12 }, what: 'Dollar up 12% against the rupee; exporters cushioned, importers hurt' },
    { id: 'crude', group: 'macro', name: 'Crude oil up 50%', s: { NIFTY: -0.06, OIL: 0.50 }, what: 'Brent crude up 50%; higher input and fuel costs' },
    { id: 'stagflation', group: 'macro', name: 'Stagflation', s: { NIFTY: -0.15, MID: -0.22, SMALL: -0.27, FX: 0.12, OIL: 0.50, sectors: { BANK: -0.20, FIN: -0.25, REALTY: -0.30, AUTO: -0.22 } }, what: 'Rates up 2%, rupee down 12%, crude up 50%, growth slows' },
    { id: 'sbank', group: 'sector', name: 'Banking: 3× credit losses', s: { NIFTY: -0.08, sectors: { BANK: -0.25, PSUBANK: -0.30, FIN: -0.22 } }, what: 'Bad loans triple; bank and NBFC profits fall' },
    { id: 'sit', group: 'sector', name: 'IT: global spending down 20%', s: { NIFTY: -0.05, FX: 0.05, sectors: { IT: -0.30 } }, what: 'Clients cut tech budgets; revenue shrinks' },
    { id: 'sfmcg', group: 'sector', name: 'FMCG: input costs up 15%', s: { NIFTY: -0.03, sectors: { FMCG: -0.15 } }, what: 'Raw-material inflation squeezes margins' },
    { id: 'sauto', group: 'sector', name: 'Auto: demand down 25%', s: { NIFTY: -0.05, sectors: { AUTO: -0.30, METAL: -0.10 } }, what: 'Vehicle sales fall a quarter' },
    { id: 'spharma', group: 'sector', name: 'Pharma: compliance costs up 15%', s: { NIFTY: -0.02, sectors: { PHARMA: -0.15 } }, what: 'Regulatory action and higher costs' },
    { id: 'senergy', group: 'sector', name: 'Oil & gas: crude up 50%', s: { NIFTY: -0.04, OIL: 0.50, sectors: { ENERGY: -0.12 } }, what: 'Refiners and marketers squeezed' },
    { id: 'srealty', group: 'sector', name: 'Real estate: rates up 2%', s: { NIFTY: -0.05, sectors: { REALTY: -0.30, FIN: -0.10 } }, what: 'Home loans less affordable' },
    { id: 'sinfra', group: 'sector', name: 'Infrastructure: orders down 20%', s: { NIFTY: -0.04, sectors: { INFRA: -0.25, METAL: -0.10 } }, what: 'Order inflows dry up' }
  ];
  const HYPO_GROUPS = [['market', 'Market crashes'], ['macro', 'Economic shocks'], ['sector', 'Sector shocks']];

  // SEBI size classes: top 100 by market cap = large, 101–250 = mid, the rest = small
  function sizeOf(rank, kind, cat) {
    if (kind === 'mf') return /small/i.test(cat || '') ? 'small' : /mid/i.test(cat || '') ? 'mid' : 'large';
    if (!rank) return 'small';
    return rank <= 100 ? 'large' : rank <= 250 ? 'mid' : 'small';
  }
  // how much the midcap / smallcap index usually moves per 1% Nifty move (so only the extra size move is added)
  function sizeBetas(cal) {
    const out = { mid: 1.15, small: 1.3 };
    [['MID', 'mid'], ['SMALL', 'small']].forEach(([k, b]) => {
      const S = cal.f[k], N = cal.f.NIFTY; if (!S) return;
      const end = cal.dates.length - 1, W = 156;
      const ys = [], xs = [];
      const sw = weekly(S, end, W), nw = weekly(N, end, W);
      nw.forEach((n, i) => { if (n != null && sw[i] != null) { ys.push(sw[i]); xs.push([1, n]); } });
      const r = ys.length >= 40 ? ols(ys, xs) : null; if (r) out[b] = Math.max(0.6, Math.min(2, r.beta[1]));
    });
    return out;
  }
  // one holding under a hypothetical shock, with the size move on top for mid and small caps
  function shockRet2(h, s, bb) {
    let r = shockRet(h.beta, s);
    const N = s.NIFTY || 0;
    if (h.size === 'mid' && isNum(s.MID)) r += s.MID - (bb ? bb.mid : 1.15) * N;
    if (h.size === 'small' && isNum(s.SMALL)) r += s.SMALL - (bb ? bb.small : 1.3) * N;
    return clampRet(r);
  }
  function runShock2(P, s) {
    const rows = P.holdings.map((h) => { const r = shockRet2(h, s, P.bb); return { h, ret: r, pnl: h.value * r }; });
    const pnl = rows.reduce((a, x) => a + x.pnl, 0);
    return { ret: pnl / P.total, pnl, rows };
  }
  function runLibrary(P) { return HYPO.map((x) => ({ ...x, ...runShock2(P, x.s) })); }

  // a historical crisis, day by day: worst day / week / month, the deepest fall inside it, and how long recovery took
  function windowStats(full, sc) {
    const i0 = indexOn(full.dates, sc.from, true), i1 = indexOn(full.dates, sc.to, false);
    if (i0 < 0 || i1 < i0) return null;
    const r = full.r, path = [];
    let g = 1; for (let t = i0; t <= i1; t++) { g *= 1 + r[t]; path.push(g); }
    const roll = (k) => { let w = 0; for (let t = i0; t + k - 1 <= i1; t++) { let x = 1; for (let u = t; u < t + k; u++) x *= 1 + r[u]; w = Math.min(w, x - 1); } return k > i1 - i0 + 1 ? null : w; };
    let peak = 1, dd = 0, troughAt = i0; let gg = 1;
    for (let t = i0; t <= i1; t++) { gg *= 1 + r[t]; if (gg > peak) peak = gg; const d = gg / peak - 1; if (d < dd) { dd = d; troughAt = t; } }
    // recovery: from the low, back to the value the portfolio had just before the crisis
    let lvl = 1, low = Infinity, lowAt = i0;
    for (let t = i0; t <= i1; t++) { lvl *= 1 + r[t]; if (lvl < low) { low = lvl; lowAt = t; } }
    let cur = 1; for (let t = i0; t <= lowAt; t++) cur *= 1 + r[t];
    let rec = null;
    for (let t = lowAt + 1; t < r.length; t++) { cur *= 1 + r[t]; if (cur >= 1) { rec = { date: full.dates[t], days: t - lowAt }; break; } }
    return { worstDay: Math.min(...r.slice(i0, i1 + 1)), worstWeek: roll(5), worstMonth: roll(21), maxDD: dd, low: full.dates[lowAt], recovered: rec, days: i1 - i0 + 1 };
  }

  // portfolio volatility and each holding's (and sector's) share of it — Euler / component risk contribution
  function volContrib(P, daily, n) {
    const k = Math.min(n || 750, daily.r.length), p = daily.r.slice(-k), vp = cov(p, p);
    const rows = P.holdings.map((h, i) => { const c = daily.comp[i].slice(-k); return { h, w: h.value / P.total, share: vp > 0 ? cov(c, p) / vp : 0 }; }).sort((a, b) => b.share - a.share);
    const sec = {}; rows.forEach((x) => { const s = x.h.secName || 'Other'; sec[s] = (sec[s] || 0) + x.share; });
    return { vol: Math.sqrt(vp * 250), rows, sectors: Object.entries(sec).sort((a, b) => b[1] - a[1]) };
  }

  // factor exposures of the whole portfolio: how much it moves for a move in each driver
  function exposures(P, cal) {
    const w = (h) => h.value / P.total, sum = (f) => P.holdings.reduce((a, h) => a + w(h) * f(h), 0);
    const sec = {};
    P.holdings.forEach((h) => { if (h.beta.sk) sec[h.beta.sk] = (sec[h.beta.sk] || 0) + w(h) * h.beta.bs; });
    const size = { large: 0, mid: 0, small: 0 }; P.holdings.forEach((h) => { size[h.size || 'large'] += w(h); });
    return {
      market: sum((h) => h.beta.bm), fx: cal.f.FX ? sum((h) => h.beta.bfx) : null, oil: cal.f.OIL ? sum((h) => h.beta.boil) : null,
      sectors: Object.entries(sec).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])), size
    };
  }

  /* ---- business (fundamental) stress: revenue, margins, interest, valuation → stressed EPS → stressed price ---- */
  const FUND = [
    { id: 'fmild', name: 'Mild', p: { rev: 0.10, margin: 0.02, int: 0.20, pe: 0.10, credit: 0.15 } },
    { id: 'fmod', name: 'Moderate', p: { rev: 0.20, margin: 0.04, int: 0.40, pe: 0.20, credit: 0.35 } },
    { id: 'fsev', name: 'Severe', p: { rev: 0.30, margin: 0.06, int: 0.60, pe: 0.30, credit: 0.60 } }
  ];
  function fundStress(h, p) {
    const f = h.fund; if (!f || h.kind === 'mf') return { ok: false, why: 'No company financials' };
    const px0 = f.price || h.px, pe = f.pe, pat = f.pat;
    if (!(px0 > 0)) return { ok: false, why: 'No price' };
    const bv = f.pb > 0 ? px0 / f.pb : null;
    if (f.bank) { // banks: credit losses eat into profit; valued on profit and book
      if (!(pat > 0)) return { ok: false, why: 'Loss-making' };
      const pat1 = pat * (1 - p.credit), ratio = pat1 / pat;
      const px1 = Math.max(px0 * ratio * (1 - p.pe), bv ? bv * 0.5 : 0);
      return { ok: true, bank: true, eps0: f.eps, eps1: f.eps != null ? f.eps * ratio : null, px0, px1, ret: Math.max(-0.95, px1 / px0 - 1) };
    }
    if (!(pe > 0) || !(pat > 0) || !(f.sales > 0) || !(f.ebitda > 0)) return { ok: false, why: 'Loss-making or missing figures' };
    const t = 0.25, pbt = pat / (1 - t);
    const intr = f.icr > 1 ? pbt / (f.icr - 1) : f.icr > 0 ? pbt : 0;   // interest cover = EBIT ÷ interest
    const ebit = pbt + intr, da = Math.max(0, f.ebitda - ebit), m = f.ebitda / f.sales;
    const sales1 = f.sales * (1 - p.rev), ebitda1 = sales1 * Math.max(-0.5, m - p.margin), ebit1 = ebitda1 - da, int1 = intr * (1 + p.int);
    const pbt1 = ebit1 - int1, pat1 = pbt1 > 0 ? pbt1 * (1 - t) : pbt1, ratio = pat1 / pat;
    const eps1 = f.eps != null ? f.eps * ratio : null;
    let px1 = ratio > 0 ? px0 * ratio * (1 - p.pe) : 0;           // stressed price = stressed EPS × stressed P/E
    if (bv) px1 = Math.max(px1, bv * 0.6);                         // a business still has assets: floor at 0.6× book
    else if (ratio <= 0) px1 = px0 * 0.3;
    return { ok: true, eps0: f.eps, eps1, ratio, px0, px1, ret: Math.max(-0.95, px1 / px0 - 1), margin0: m, margin1: m - p.margin };
  }
  function runFund(P, p) {
    const rows = P.holdings.map((h) => ({ h, ...fundStress(h, p) }));
    const ok = rows.filter((x) => x.ok), cov = ok.reduce((a, x) => a + x.h.value, 0);
    const pnl = ok.reduce((a, x) => a + x.h.value * x.ret, 0);
    return { rows, coverage: cov / P.total, ret: cov ? pnl / cov : null, pnl };
  }

  /* ---- Monte Carlo, fat-tailed (Student-t, 5 degrees of freedom) at the portfolio's own mean and volatility ---- */
  function monteCarloT(daily, paths, days, seed, from, to, nu) {
    days = days || 250; nu = nu || 5;
    const m = moments(daily.slice(-750)), sc = m.sd * Math.sqrt((nu - 2) / nu), R = rng(seed || 11);
    const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
    const out = [], dd = [];
    for (let p = from || 0; p < (to == null ? paths : to); p++) {
      let g = 1, peak = 1, md = 0;
      for (let d = 0; d < days; d++) {
        let chi = 0; for (let k = 0; k < nu; k++) { const z = gauss(); chi += z * z; }
        const x = m.mean + sc * gauss() / Math.sqrt(chi / nu);
        g *= 1 + Math.max(-0.5, x); if (g > peak) peak = g; else md = Math.min(md, g / peak - 1);
      }
      out.push(g - 1); dd.push(md);
    }
    return { ret: out, dd };
  }
  function mcSummary(ret) {
    const s = ret.slice().sort((a, b) => a - b), q = (x) => pct(s, x), tail = (c) => { const k = Math.max(1, Math.floor((1 - c) * s.length)); return s.slice(0, k).reduce((a, v) => a + v, 0) / k; };
    return { sorted: s, var95: -q(0.05), var99: -q(0.01), es95: -tail(0.95), es99: -tail(0.99), median: q(0.5), pLoss: s.filter((x) => x < 0).length / s.length, p20: s.filter((x) => x <= -0.2).length / s.length };
  }

  /* ---- reverse stress test: five ways to reach a loss you can't accept ---- */
  function reverseAll(P, L, scen, cal) {
    const rows = [];
    const lin = (s) => -runShock2(P, s).ret;                         // loss for a shock (losses are linear in the shock size)
    const m = reverse(P, L);
    rows.push({ id: 'market', path: 'The market alone falls', need: m.nifty == null ? null : `the Nifty falls ${dn(m.nifty)}`, k: m.nifty == null ? null : -m.nifty, ref: 0.60 });
    const broad = lin({ NIFTY: -0.10, MID: -0.14, SMALL: -0.165 });
    const kb = broad > 0.001 ? L / broad : null;
    rows.push({ id: 'broad', path: 'A broad crash (mid and small caps fall more)', need: kb && kb * 0.1 < 0.95 ? `the Nifty falls ${dn(-0.1 * kb)}, midcaps ${dn(-Math.min(0.95, 0.14 * kb))}, smallcaps ${dn(-Math.min(0.95, 0.165 * kb))}` : null, k: kb ? 0.1 * kb : null, ref: 0.60 });
    const ok = scen.filter((x) => x.ret != null && x.ret < 0);
    if (ok.length) { const w = ok.reduce((a, b) => (b.ret < a.ret ? b : a)); const k = L / -w.ret; rows.push({ id: 'repeat', rep: true, path: `A repeat of the ${w.name}`, need: `${k.toFixed(1)}× as severe as it was (you'd have lost ${dn(w.ret)} then)`, k, ref: 1, isMult: true }); }
    const ex = exposures(P, cal), top = ex.sectors.find(([, v]) => v > 0.02);
    if (top) { const loss = lin({ NIFTY: 0, sectors: { [top[0]]: -0.10 } }); const S = loss > 0.0005 ? -0.10 * L / loss : null; rows.push({ id: 'sector', path: `One sector collapses (${cal.names[top[0]] || top[0]})`, need: S != null && S > -1 ? `the sector index falls ${dn(S)} while the rest of the market is flat` : null, k: S != null ? -S : null, ref: 0.6 }); }
    let lo = 0, hi = 3, hit = null;
    const fl = (k) => { const r = runFund(P, { rev: 0.2 * k, margin: 0.04 * k, int: 0.4 * k, pe: Math.min(0.9, 0.2 * k), credit: Math.min(0.95, 0.35 * k) }); return r.ret == null ? null : -r.ret; };
    if (fl(3) != null && fl(3) >= L) { for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fl(mid) >= L) hi = mid; else lo = mid; } hit = hi; }
    rows.push({ id: 'business', biz: true, path: 'Business conditions deteriorate', need: hit != null ? `revenue down ${Math.round(20 * hit)}%, margins down ${Math.round(400 * hit)} bp, interest costs up ${Math.round(40 * hit)}%, P/E down ${Math.round(Math.min(90, 20 * hit))}%` : null, k: hit, ref: 1.5, isMult: true });
    return rows;
  }
  const dn = (x) => `${Math.abs(Math.round(x * 100))}%`; // a fall, in words around it (no minus signs)

  /* ---- liquidity: AMFI days to sell, under normal and stressed volume, plus the cost of selling (impact) ---- */
  const SPREAD = { large: 0.0005, mid: 0.0015, small: 0.004 };
  function exitCost(P, stress) {
    const volMult = stress ? 2 : 1, advMult = stress ? 0.5 : 1;
    const rows = P.holdings.map((h) => {
      if (h.kind === 'mf') return { h, cost: 0 };
      const adv = (h.adv3 || h.adv12 || 0) * (h.px || 0) * advMult;
      const last = h.r.slice(-250).filter((x) => x != null), sd = last.length > 20 ? Math.sqrt(cov(last, last)) : 0.02;
      if (!(adv > 0)) return { h, cost: null };
      const c = (SPREAD[h.size] || 0.002) * volMult / 2 + 0.7 * sd * volMult * Math.sqrt(h.value / adv); // square-root impact model
      return { h, cost: Math.min(0.5, c) };
    });
    const known = rows.filter((x) => x.cost != null);
    return { rows, pnl: -known.reduce((a, x) => a + x.h.value * x.cost, 0), pct: -known.reduce((a, x) => a + x.h.value * x.cost, 0) / P.total };
  }
  function liquidityStressed(P) { // AMFI capacity with trading volume halved
    const half = { ...P, holdings: P.holdings.map((h) => ({ ...h, adv3: h.adv3 ? h.adv3 / 2 : h.adv3, adv12: h.adv12 ? h.adv12 / 2 : h.adv12 })) };
    return liquidity(half, 'adv3');
  }

  /* ---- what moves the worst case most (information, not advice) ---- */
  function levers(P, sc) {
    if (!sc || !sc.rows) return [];
    return sc.rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 3).filter((x) => x.pnl < 0).map((x) => {
      const w = x.h.value / P.total, cut = Math.min(0.10, w), rest = 1 - w;
      let ret = 0;
      sc.rows.forEach((y) => { const wy = y.h.value / P.total; const nw = y === x ? wy - cut : rest > 0 ? wy + cut * (wy / rest) : wy; ret += nw * (y.ret || 0); });
      return { h: x.h, from: sc.ret, to: ret, cut };
    }).filter((x) => Math.abs(x.to - x.from) >= 0.005); // only changes worth showing
  }

  /* ---------------------------------------------------------------- explanation (rule-based, no AI) */
  function explain(P, scen) {
    const ok = scen.filter((s) => s.ret != null);
    if (!ok.length) return [];
    const worst = ok.reduce((a, b) => (b.ret < a.ret ? b : a));
    const lines = [];
    const fmt = (x) => `${Math.abs(Math.round(x * 100))}%`;
    if (worst.nifty != null) {
      const gap = worst.ret - worst.nifty;
      lines.push(`Your worst case is the ${worst.name}: a fall of ${fmt(worst.ret)}, against ${fmt(worst.nifty)} for the Nifty 50` +
        (Math.abs(gap) < 0.02 ? ', so the portfolio moved roughly with the market.' : gap < 0 ? ', so it fell harder than the market.' : ', so it held up better than the market.'));
    }
    const top = worst.rows.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 2).filter((r) => r.pnl < 0);
    const lost = worst.rows.reduce((s, r) => s + Math.min(0, r.pnl), 0);
    if (top.length && lost < 0) {
      const share = top.reduce((s, r) => s + r.pnl, 0) / lost;
      lines.push(`${top.map((r) => r.h.n).join(' and ')} account for ${Math.round(share * 100)}% of that loss.`);
    }
    const bySec = {};
    P.holdings.forEach((h) => { const k = h.secName || 'Other'; bySec[k] = (bySec[k] || 0) + h.value / P.total; });
    const big = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0];
    if (big && big[1] >= 0.4 && P.holdings.length > 1) lines.push(`${Math.round(big[1] * 100)}% of the portfolio is in one sector (${big[0]}), so a shock to that sector hits most of it at once.`);
    const est = P.holdings.filter((h) => worst.rows.find((r) => r.h === h && r.est)).length;
    if (est) lines.push(`${est} holding${est > 1 ? 's were' : ' was'} not listed then, so ${est > 1 ? 'their losses are' : 'its loss is'} estimated from how ${est > 1 ? 'they move with the market and their sectors' : 'it moves with the market and its sector'} today.`);
    return lines;
  }

  /* ---------------------------------------------------------------- data alignment (used for live data) */
  // closes: [[YYYY-MM-DD, close], …] oldest first → { o, r } on the calendar, the same rules as scripts/build_risk.py
  function alignCloses(closes, dates) {
    const by = new Map(closes), r = []; let last = null;
    for (const d of dates) {
      const c = by.get(d);
      if (c == null) { r.push(null); continue; }
      if (last == null) r.push(null);
      else { const x = c / last - 1; r.push(Math.abs(x) > 0.40 ? null : Math.round(x * 10000)); }
      last = c;
    }
    let o = 0; while (o < r.length && r[o] == null) o++;
    return { o, r: r.slice(o) };
  }

  /* ================================================================ v61: the dashboard metrics */
  // Portfolio beta (weighted factor betas) and downside beta (only the days the Nifty fell), last n days
  function betas(P, daily, n) {
    const k = Math.min(n || 750, daily.r.length), p = daily.r.slice(-k), m = daily.nifty.slice(-k);
    const dp = [], dm = []; m.forEach((x, i) => { if (x < 0) { dp.push(p[i]); dm.push(x); } });
    const vm = dm.length > 20 ? cov(dm, dm) : 0, vAll = cov(m, m);
    return {
      beta: P.holdings.reduce((a, h) => a + (h.value / P.total) * h.beta.bm, 0),
      raw: vAll > 0 ? cov(p, m) / vAll : null,
      down: vm > 0 ? cov(dp, dm) / vm : null, downDays: dm.length
    };
  }
  // Volatility, yearly: over the last n days, and inside a stress window (dates from…to) of the full history
  function volOf(r) { return r.length > 20 ? Math.sqrt(cov(r, r) * 250) : null; }
  function stressedVol(full, from, to) {
    const r = []; full.dates.forEach((d, i) => { if (d >= from && d <= to) r.push(full.r[i]); });
    return volOf(r);
  }
  // Holding-by-holding correlations: normal (last n days) and in crises (days inside the historical crisis windows).
  // Only days both holdings actually traded count; pairs with too few shared days are left blank.
  function corrMatrix(P, cal, pick, n) {
    const end = cal.dates.length - 1, start = Math.max(1, end - (n || 750) + 1);
    const crisis = new Set();
    SCENARIOS.forEach((sc) => { const w = windowIdx(cal, sc); if (w) for (let t = w[0]; t <= w[1]; t++) crisis.add(t); });
    const one = (days, min) => {
      const M = pick.map(() => pick.map(() => null)), sumW = { v: 0, w: 0 };
      for (let i = 0; i < pick.length; i++) {
        M[i][i] = 1;
        for (let j = i + 1; j < pick.length; j++) {
          const a = [], b = [];
          days.forEach((t) => { const x = at(pick[i], t), y = at(pick[j], t); if (x != null && y != null) { a.push(x); b.push(y); } });
          const c = a.length >= min ? corr(a, b) : null;
          M[i][j] = M[j][i] = c;
          if (c != null) { const w = (pick[i].value || 1) * (pick[j].value || 1); sumW.v += w * c; sumW.w += w; }
        }
      }
      return { M, avg: sumW.w ? sumW.v / sumW.w : null };
    };
    const normalDays = []; for (let t = start; t <= end; t++) normalDays.push(t);
    return { normal: one(normalDays, 120), crisis: one([...crisis].sort((x, y) => x - y), 40), crisisDays: crisis.size };
  }
  // Component VaR and marginal VaR (Euler, on the last n days). Marginal: extra 1-day VaR per ₹1 added to a holding.
  function componentVaR(P, daily, conf, n) {
    const z = ZQ[conf || 0.99], k = Math.min(n || 750, daily.r.length), p = daily.r.slice(-k), vp = cov(p, p), sp = Math.sqrt(vp);
    const rows = P.holdings.map((h, i) => {
      const w = h.value / P.total, c = daily.comp[i].slice(-k), cip = cov(c, p); // = w · cov(r_i, r_p)
      const mvar = w > 0 && sp > 0 ? (z * (cip / w)) / sp : 0;
      return { h, w, mvar, cvar: w * mvar * P.total, share: vp > 0 ? cip / vp : 0 };
    }).sort((a, b) => b.cvar - a.cvar);
    return { var1: z * sp, varRs: z * sp * P.total, rows };
  }
  // P/E compression: the market's P/E falls `cut` and stocks above the median P/E also lose half their premium
  function peCompression(P, medPE, cut) {
    cut = cut == null ? 0.2 : cut;
    const rows = P.holdings.map((h) => {
      const pe = h.fund && h.fund.pe;
      let r;
      if (pe > 0 && medPE > 0) { const tgt = (1 - cut) * (pe > medPE ? medPE + 0.5 * (pe - medPE) : pe); r = tgt / pe - 1; }
      else r = -cut * Math.max(0.5, h.beta.bm); // funds and loss-makers: move with the market's de-rating
      return { h, ret: r, pnl: h.value * r, known: pe > 0 };
    });
    const pnl = rows.reduce((a, x) => a + x.pnl, 0);
    return { ret: pnl / P.total, pnl, rows };
  }
  // Long-run yearly growth of the portfolio (geometric), from the full history
  function cagr(full) { const n = full.r.length; if (n < 250) return null; let g = 0; full.r.forEach((x) => { g += Math.log(1 + x); }); return Math.exp((g / n) * 250) - 1; }
  // Recovery: the return needed to get back to today's value after a loss, and how long at a given yearly growth
  function recovery(loss, growth) {
    if (!(loss < 0)) return { need: 0, years: 0 };
    const need = 1 / (1 + loss) - 1;
    return { need, years: growth > 0 ? Math.log(1 + need) / Math.log(1 + growth) : null };
  }
  // The stress zone: one 0–100 score from six readings, each scored 0–100 (higher = more stress)
  const ZONES = [[20, 'Low', 1], [40, 'Moderate', 2], [60, 'Elevated', 3], [80, 'High', 4], [101, 'Severe', 5]];
  function stressZone(x) {
    const cl = (v) => Math.max(0, Math.min(100, v));
    const parts = [
      { k: 'loss', label: 'Worst-case loss vs your limit', w: 0.30, s: cl((x.worstLoss / (x.limit * 1.6)) * 100) },
      { k: 'var', label: 'Loss in a bad month (VaR 99%)', w: 0.20, s: cl((x.var30 / 0.30) * 100) },
      { k: 'beta', label: 'Market sensitivity (beta)', w: 0.15, s: cl(((x.beta - 0.6) / 1.0) * 100) },
      { k: 'conc', label: 'Concentration (HHI)', w: 0.15, s: cl(((x.hhi - 0.05) / 0.30) * 100) },
      { k: 'liq', label: 'Days to sell everything', w: 0.10, s: x.days == null ? 30 : cl((Math.log(Math.max(1, x.days)) / Math.log(20)) * 100) },
      { k: 'now', label: 'Today\'s volatility vs normal', w: 0.10, s: x.volNow && x.volLong ? cl(((x.volNow / x.volLong - 0.7) / 0.9) * 100) : 40 }
    ];
    const score = parts.reduce((a, p) => a + p.w * p.s, 0), z = ZONES.find((q) => score < q[0]);
    return { score, zone: z[1], level: z[2], parts };
  }

  /* ---- v62: the portfolio against the Nifty 50 ---- */
  function vsNifty(daily, full, scen) {
    const p = daily.r, m = daily.nifty, n = p.length, yrs = n / 250;
    const ann = (r) => { let g = 0; r.forEach((x) => { g += Math.log(1 + x); }); return Math.exp(g / yrs) - 1; };
    // capture ratios on calendar-free 21-day blocks
    const P = [], M = [];
    for (let i = n % 21; i + 21 <= n; i += 21) { let a = 1, b = 1; for (let k = i; k < i + 21; k++) { a *= 1 + p[k]; b *= 1 + m[k]; } P.push(a - 1); M.push(b - 1); }
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const up = M.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0), dn = M.map((x, i) => (x < 0 ? i : -1)).filter((i) => i >= 0);
    const cap = (ix) => { const b = avg(ix.map((i) => M[i])); return b ? avg(ix.map((i) => P[i])) / b : null; };
    const beat = P.filter((x, i) => x > M[i]).length;
    const v3 = (r) => volOf(r.slice(-750));
    const v1m = (r) => varES(horizon(r, 21), 0.99);
    const hist = scen.filter((s) => s.ret != null && s.nifty != null);
    const better = hist.filter((s) => s.ret > s.nifty).length;
    const worst = hist.slice().sort((a, b) => a.ret - b.ret)[0];
    const you = { ret: ann(p), vol: v3(p), var1m: v1m(p).var, es1m: v1m(p).es, dd: drawdown(full.r, full.dates), worst: worst ? worst.ret : null };
    const nif = { ret: ann(m), vol: v3(m), var1m: v1m(m).var, es1m: v1m(m).es, dd: drawdown(full.nifty, full.dates), worst: worst ? worst.nifty : null };
    // growth of ₹100 over the last n days, weekly points
    const gY = [], gN = [], gD = []; let a = 100, b = 100;
    for (let i = 0; i < n; i++) { a *= 1 + p[i]; b *= 1 + m[i]; if (i % 5 === 0 || i === n - 1) { gY.push(+a.toFixed(2)); gN.push(+b.toFixed(2)); gD.push(daily.dates[i]); } }
    return { you, nif, up: cap(up), down: cap(dn), months: P.length, beatMonths: beat, crises: hist.length, better, worstName: worst ? worst.name : '', hist, growth: { you: gY, nif: gN, dates: gD }, years: yrs };
  }

  const API = { vsNifty, betas, volOf, stressedVol, corrMatrix, componentVaR, peCompression, cagr, recovery, stressZone, ZONES, HYPO, HYPO_GROUPS, FUND, sizeOf, sizeBetas, shockRet2, runShock2, runLibrary, windowStats, volContrib, exposures, fundStress, runFund, monteCarloT, mcSummary, reverseAll, exitCost, liquidityStressed, levers, horizon, moments, ewmaVol, riskTable, stressedVaR, drawdown, concentration, contributions, vsMarket, SCENARIOS, PRESETS, sectorKey, fit, windowIdx, runScenarios, runShock, shockRet, sensitivity, reverse, portfolioDaily, varES, kupiec, crashCheck, liquidity, monteCarlo, pct, explain, alignCloses, bp, indexOn, compound, at };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.PlutusRisk = API;
})(typeof window !== 'undefined' ? window : globalThis);
