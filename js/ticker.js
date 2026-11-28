/* PLUTUS — home-page market ticker (v60)
   A strip that moves continuously across the top of the home page: world indices, gold, silver, crude and other
   commodities, the rupee, and the day's biggest gainer and loser in the Nifty 500. Data comes from the Worker's
   ?ticker=1 route (shared 2-minute cache); if that route isn't deployed yet, the markets are fetched through the
   Worker's Yahoo proxy instead (no gainer / loser then). Refreshes every 2 minutes while the home page is open.
   Falls are shown in brackets with a down arrow, never in red text; the arrow icon carries the colour. */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const base = () => (CFG.WORKER_URL ? String(CFG.WORKER_URL).replace(/\/?$/, '/') : '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REFRESH_MS = 120000;
  const MARKETS = [
    ['^NSEI', 'Nifty 50', 'idx'], ['^BSESN', 'Sensex', 'idx'], ['^NSEBANK', 'Nifty Bank', 'idx'], ['^INDIAVIX', 'India VIX', 'idx'],
    ['^GSPC', 'S&P 500', 'idx'], ['^DJI', 'Dow Jones', 'idx'], ['^IXIC', 'Nasdaq', 'idx'], ['^FTSE', 'FTSE 100', 'idx'],
    ['^GDAXI', 'DAX', 'idx'], ['^FCHI', 'CAC 40', 'idx'], ['^N225', 'Nikkei 225', 'idx'], ['^HSI', 'Hang Seng', 'idx'], ['000001.SS', 'Shanghai', 'idx'],
    ['GC=F', 'Gold', 'usd'], ['SI=F', 'Silver', 'usd'], ['BZ=F', 'Brent crude', 'usd'], ['CL=F', 'WTI crude', 'usd'], ['NG=F', 'Natural gas', 'usd'], ['HG=F', 'Copper', 'usd'],
    ['INR=X', 'USD / INR', 'inr'],
  ];
  const UNIT = { 'GC=F': '/oz', 'SI=F': '/oz', 'BZ=F': '/bbl', 'CL=F': '/bbl', 'NG=F': '/MMBtu', 'HG=F': '/lb' };
  const INDIAN = /^\^(NSEI|BSESN|NSEBANK|INDIAVIX)$|\.(NS|BO)$/;

  const num = (v, d, loc) => Math.abs(v).toLocaleString(loc || 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const br = (txt, neg) => (neg ? `(${txt})` : txt);
  function price(x) {
    const d = x.px >= 1000 ? 2 : x.px >= 10 ? 2 : 3;
    if (x.k === 'usd') return `$${num(x.px, d)}<small>${UNIT[x.s] || ''}</small>`;
    if (x.k === 'inr') return `₹${num(x.px, 2)}`;
    if (x.k === 'gain' || x.k === 'lose') return `₹${num(x.px, 2, 'en-IN')}`;
    return num(x.px, 2, INDIAN.test(x.s) ? 'en-IN' : 'en-US');
  }
  const UP = '<svg class="mk-ic up" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5l4 6H2z"/></svg>';
  const DOWN = '<svg class="mk-ic down" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 9.5l-4-6h8z"/></svg>';
  const FLAT = '<svg class="mk-ic flat" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5" width="8" height="2" rx="1"/></svg>';
  function item(x) {
    const neg = x.pct < 0, flat = Math.abs(x.pct) < 0.005;
    const dir = flat ? 'unchanged' : neg ? 'down' : 'up';
    const chg = `${br(num(x.chg, 2, INDIAN.test(x.s) ? 'en-IN' : 'en-US'), neg)} · ${br(num(x.pct, 2) + '%', neg)}`;
    const tag = x.k === 'gain' ? '<span class="mk-tag up">Top gainer</span>' : x.k === 'lose' ? '<span class="mk-tag down">Top loser</span>' : '';
    const name = x.k === 'gain' || x.k === 'lose' ? String(x.n).replace(/\s+(Ltd|Limited)\.?$/i, '') : x.n;
    const inner = `${tag}<span class="mk-n">${esc(name)}</span><span class="mk-p">${price(x)}</span><span class="mk-c ${dir}">${flat ? FLAT : neg ? DOWN : UP}${chg}</span>`;
    const label = `${name}${tag ? (x.k === 'gain' ? ', top Nifty 500 gainer' : ', top Nifty 500 loser') : ''}: ${dir} ${num(x.pct, 2)}%`;
    return x.k === 'gain' || x.k === 'lose'
      ? `<a class="mk-i mk-mover" href="#/s/${encodeURIComponent(x.s)}" aria-label="${esc(label)}">${inner}</a>`
      : `<span class="mk-i" aria-label="${esc(label)}">${inner}</span>`;
  }

  // order: India first, then the movers, then the world, then commodities and the rupee
  function order(d) {
    const items = d.items || [], idx = items.filter((x) => x.k === 'idx'), ind = idx.filter((x) => INDIAN.test(x.s)), world = idx.filter((x) => !INDIAN.test(x.s));
    return [...ind, ...(d.gainer ? [d.gainer] : []), ...(d.loser ? [d.loser] : []), ...world, ...items.filter((x) => x.k !== 'idx')];
  }

  async function okJSON(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  async function fetchData() {
    const b = base(); if (!b) throw new Error('no worker');
    try { const d = await fetch(`${b}?ticker=1`).then(okJSON); if (d && (d.items || []).length) return d; } catch (e) { /* fall back below */ }
    // fallback: the markets only, through the Worker's Yahoo proxy
    const u = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(MARKETS.map((m) => m[0]).join(','))}&range=1d&interval=1d`;
    const j = await fetch(`${b}?url=${encodeURIComponent(u)}`).then(okJSON);
    const list = j.spark && j.spark.result ? j.spark.result.map((x) => ({ s: x.symbol, m: (x.response && x.response[0] && x.response[0].meta) || {} })) : Object.values(j).map((x) => ({ s: x.symbol, m: x }));
    const by = new Map(list.map((x) => [x.s, x.m]));
    const items = MARKETS.map(([s, n, k]) => {
      const m = by.get(s); if (!m) return null;
      const px = m.regularMarketPrice ?? (m.close && m.close[m.close.length - 1]), pc = m.chartPreviousClose ?? m.previousClose;
      return isFinite(px) && isFinite(pc) && pc ? { s, n, k, px, chg: px - pc, pct: ((px - pc) / pc) * 100 } : null;
    }).filter(Boolean);
    if (!items.length) throw new Error('no data');
    return { items };
  }

  let el = null, timer = null, last = '', lastAt = 0;
  function render(d) {
    const list = order(d); if (!list.length) return;
    const html = list.map(item).join('<span class="mk-sep" aria-hidden="true"></span>');
    if (html === last) return; last = html;
    const track = el.querySelector('.mk-track');
    // two identical copies side by side; the strip slides by exactly one copy, so the loop is seamless
    track.innerHTML = `<div class="mk-set">${html}<span class="mk-sep" aria-hidden="true"></span></div><div class="mk-set" aria-hidden="true">${html}<span class="mk-sep" aria-hidden="true"></span></div>`;
    track.querySelectorAll('.mk-set[aria-hidden] a').forEach((a) => a.setAttribute('tabindex', '-1'));
    requestAnimationFrame(() => {
      const w = track.firstElementChild.getBoundingClientRect().width;
      track.style.setProperty('--mk-dur', `${Math.max(30, Math.round(w / 55))}s`); // about 55 px a second, whatever the screen
    });
    el.classList.add('ready');
    el.querySelector('.mk-at').textContent = d.at ? `Updated ${new Date(d.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '';
  }
  async function refresh(soft) {
    if (!el || !document.body.classList.contains('on-home') || document.hidden) return;
    if (soft && last && Date.now() - lastAt < 60000) return;
    lastAt = Date.now();
    try { render(await fetchData()); } catch (e) { if (!last) el.classList.add('failed'); }
  }
  function init() {
    el = document.getElementById('mktTicker'); if (!el) return;
    el.innerHTML = `<div class="mk-view"><div class="mk-track"><div class="mk-set mk-skel">${'<span class="mk-i"><span class="mk-n">&nbsp;</span><span class="mk-p">&nbsp;</span></span>'.repeat(8)}</div></div></div><span class="mk-at sr-only" aria-live="off"></span>`;
    new MutationObserver(() => { el.hidden = !document.body.classList.contains('on-home'); if (!el.hidden) refresh(true); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    el.hidden = !document.body.classList.contains('on-home');
    setTimeout(() => refresh(true), 0);
    timer = setInterval(() => refresh(), REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
    window.addEventListener('hashchange', () => setTimeout(() => refresh(true), 50));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
