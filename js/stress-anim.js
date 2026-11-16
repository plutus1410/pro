/* ============================================================
   PLUTUS — stress test animation (v57)
   "Crisis replay": your portfolio's value, day by day, through a past crisis — against the Nifty 50 and your loss
   limit — then on into the recovery. Canvas, no libraries; respects "reduce motion" (draws the finished picture).
   Also: count-up numbers for the summary cards.
   window.PlutusStressAnim.mount(el, { full, scen, total, limit, list })
   ============================================================ */
(function () {
  'use strict';
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (v, f) => (getComputedStyle(document.documentElement).getPropertyValue(v) || '').trim() || f;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = (d) => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const mon = (d) => `${MON[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}`;
  const money = (v) => { const a = Math.abs(v); return a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${Math.round(a).toLocaleString('en-IN')}`; };
  const pct = (x, d) => { const r = +(x * 100).toFixed(d == null ? 1 : d); return r < 0 ? `(${Math.abs(r).toFixed(d == null ? 1 : d)}%)` : `${r.toFixed(d == null ? 1 : d)}%`; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function indexOn(dates, d, after) {
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (after ? dates[m] >= d : dates[m] <= d) { ans = m; if (after) hi = m - 1; else lo = m + 1; } else if (after) lo = m + 1; else hi = m - 1; }
    return ans;
  }
  // the path for one crisis: a little before it, the crisis, then on until the old value is back (or ~6 months)
  function path(o, sc) {
    const d = o.full.dates, i0 = indexOn(d, sc.from, true), i1 = indexOn(d, sc.to, false);
    if (i0 < 1 || i1 < i0) return null;
    const a = Math.max(1, i0 - 10);
    let g = 1, n = 1, low = Infinity, lowAt = 0, recAt = null; const pv = [], nv = [], ds = [];
    for (let t = a; t < d.length; t++) {
      if (t >= i0) { g *= 1 + o.full.r[t]; n *= 1 + o.full.nifty[t]; }
      pv.push(g); nv.push(n); ds.push(d[t]);
      if (t >= i0 && t <= i1 && g < low) { low = g; lowAt = pv.length - 1; }
      if (t > i1 && recAt == null && g >= 1) recAt = pv.length - 1;
      if (t > i1 && (recAt != null ? pv.length - 1 >= recAt + 15 : t - i1 >= 130)) break;
      if (pv.length > 900) break;
    }
    return { pv, nv, ds, s0: i0 - a, s1: i1 - a, lowAt, recAt };
  }

  function mount(el, o) {
    const crises = o.scen.filter((s) => s.ret != null && s.from !== s.to).sort((x, y) => x.ret - y.ret);
    if (!crises.length) { el.innerHTML = ''; return; }
    let cur = crises[0], P = path(o, cur), prog = 0, playing = false, raf = 0, speed = 1, breached = false, lastT = 0, seen = false;
    el.innerHTML = `
      <div class="sa-head">
        <div><h3 class="st-h3 sa-title">Watch your portfolio live through a crisis</h3>
        <p class="st-lead">Your holdings' real day-by-day moves, replayed on today's ₹ value — against the <b>Nifty 50</b> and your <b>loss limit</b>.</p></div>
        <div class="sa-ctl">
          <button type="button" class="sa-play" aria-label="Play">${icon('play')}</button>
          <button type="button" class="sa-btn sa-replay" aria-label="Replay from the start">${icon('replay')}</button>
          <div class="st-seg sa-speed" role="radiogroup" aria-label="Speed">${[1, 2, 4].map((v) => `<button type="button" data-sp="${v}" role="radio" aria-checked="${v === 1}" class="${v === 1 ? 'on' : ''}">${v}×</button>`).join('')}</div>
        </div>
      </div>
      <div class="sa-pills" role="radiogroup" aria-label="Crisis">${crises.slice(0, 8).map((s, i) => `<button type="button" role="radio" aria-checked="${!i}" class="sa-pill${i ? '' : ' on'}" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      <div class="sa-stage">
        <div class="sa-read" aria-live="off">
          <div class="sa-r"><span>Date</span><b class="sa-date">—</b></div>
          <div class="sa-r big"><span>Your portfolio</span><b class="sa-val">—</b><em class="sa-chg">—</em></div>
          <div class="sa-r"><span>Nifty 50</span><b class="sa-nifty">—</b></div>
          <div class="sa-r"><span>Phase</span><b class="sa-phase">—</b></div>
        </div>
        <div class="sa-canvas"><canvas role="img" aria-label="Animated line chart of the portfolio's value through the crisis"></canvas><div class="sa-breach" hidden>Loss limit crossed</div></div>
      </div>
      <p class="sa-sum st-note" aria-live="polite"></p>`;
    const cv = el.querySelector('canvas'), ctx = cv.getContext('2d'), wrap = el.querySelector('.sa-canvas');
    const playBtn = el.querySelector('.sa-play'), badge = el.querySelector('.sa-breach');
    let W = 0, H = 0;
    const size = () => {
      const r = wrap.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, r.width); H = Math.max(220, Math.min(360, W * 0.45));
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    };
    function draw() {
      if (!P || !W) return;
      const n = P.pv.length, show = Math.max(1, Math.min(n, Math.floor(prog) + 1));
      const lim = 1 - o.limit, all = P.pv.concat(P.nv, [lim]);
      let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.08 || 0.05; lo -= pad; hi += pad;
      const L = 64, Rm = 16, T = 18, B = 30, X = (i) => L + (i / Math.max(1, n - 1)) * (W - L - Rm), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const acc = css('--accent', '#2a49c4'), mut = css('--dim', '#9aa3b2'), warn = css('--warn', '#c2410c'), line = css('--line', 'rgba(0,0,0,.1)'), txt = css('--muted', '#667');
      ctx.clearRect(0, 0, W, H);
      ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif'; ctx.textBaseline = 'middle';
      // crisis window
      ctx.fillStyle = 'rgba(127,127,127,0.08)'; ctx.fillRect(X(P.s0), T, X(P.s1) - X(P.s0), H - T - B);
      ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.fillText('Crisis', X(P.s0) + 6, T + 10);
      // grid + ₹ axis
      for (let k = 0; k <= 4; k++) {
        const v = lo + ((hi - lo) * k) / 4, y = Y(v);
        ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - Rm, y); ctx.stroke();
        ctx.fillStyle = txt; ctx.textAlign = 'right'; ctx.fillText(money(v * o.total), L - 8, y);
      }
      // month ticks
      ctx.textAlign = 'center'; let lastM = '';
      const step = Math.max(1, Math.round(n / 6));
      for (let i = 0; i < n; i += step) { const m = mon(P.ds[i]); if (m !== lastM) { ctx.fillText(m, X(i), H - B + 16); lastM = m; } }
      // loss limit
      ctx.setLineDash([6, 5]); ctx.strokeStyle = warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(L, Y(lim)); ctx.lineTo(W - Rm, Y(lim)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = warn; ctx.textAlign = 'right'; ctx.fillText(`Your ${Math.round(o.limit * 100)}% loss limit`, W - Rm - 4, Y(lim) - 9);
      // Nifty (dashed)
      ctx.setLineDash([4, 4]); ctx.strokeStyle = mut; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < show; i++) { const x = X(i), y = Y(P.nv[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); ctx.setLineDash([]);
      // portfolio: area + line
      const grad = ctx.createLinearGradient(0, T, 0, H - B); grad.addColorStop(0, hexA(acc, 0.28)); grad.addColorStop(1, hexA(acc, 0));
      ctx.beginPath(); ctx.moveTo(X(0), Y(P.pv[0]));
      for (let i = 1; i < show; i++) ctx.lineTo(X(i), Y(P.pv[i]));
      ctx.lineTo(X(show - 1), H - B); ctx.lineTo(X(0), H - B); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = acc; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = 0; i < show; i++) { const x = X(i), y = Y(P.pv[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      // low point, once reached
      if (show - 1 >= P.lowAt) {
        const x = X(P.lowAt), y = Y(P.pv[P.lowAt]);
        ctx.fillStyle = warn; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css('--text', '#111'); ctx.textAlign = x > W * 0.7 ? 'right' : 'left';
        ctx.fillText(`Low ${pct(P.pv[P.lowAt] - 1)} · ${dt(P.ds[P.lowAt])}`, x + (x > W * 0.7 ? -10 : 10), Math.min(H - B - 10, y + 16));
      }
      // head: glowing dot
      const hi_ = show - 1, hx = X(hi_), hy = Y(P.pv[hi_]), pulse = 6 + 3 * Math.sin(performance.now() / 180);
      ctx.fillStyle = hexA(acc, 0.22); ctx.beginPath(); ctx.arc(hx, hy, pulse + 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = css('--surface', '#fff'); ctx.lineWidth = 2; ctx.stroke();
      readout(hi_);
    }
    function readout(i) {
      const v = P.pv[i], nv = P.nv[i];
      el.querySelector('.sa-date').textContent = dt(P.ds[i]);
      el.querySelector('.sa-val').textContent = money(v * o.total);
      el.querySelector('.sa-chg').textContent = `${pct(v - 1)} · ${v < 1 ? `(${money((1 - v) * o.total)})` : money((v - 1) * o.total)}`;
      el.querySelector('.sa-nifty').textContent = pct(nv - 1);
      const ph = i < P.s0 ? 'Before the crisis' : i <= P.s1 ? 'In the crisis' : P.recAt != null && i >= P.recAt ? 'Recovered' : 'Recovering';
      el.querySelector('.sa-phase').textContent = ph;
      el.querySelector('.sa-phase').dataset.p = ph;
      if (!breached && v <= 1 - o.limit) { breached = true; badge.hidden = false; badge.classList.remove('pop'); void badge.offsetWidth; badge.classList.add('pop'); }
    }
    function summary() {
      const low = P.pv[P.lowAt] - 1, rec = P.recAt;
      el.querySelector('.sa-sum').innerHTML = `In the <b>${esc(cur.name)}</b>, your portfolio would have fallen <b>${pct(low).replace(/[()]/g,'')}</b> at its lowest (a loss of ${money(-low * o.total).replace(/[()]/g,'')}) on ${dt(P.ds[P.lowAt])}, when the Nifty was down <b>${pct(P.nv[P.lowAt] - 1).replace(/[()]/g,'')}</b>. ${rec != null ? `It was back to its starting value by <b>${dt(P.ds[rec])}</b>.` : 'It had not regained its starting value within six months of the crisis.'}`;
    }
    function frame(t) {
      if (!el.isConnected) { cancelAnimationFrame(raf); return; }
      const dtm = lastT ? Math.min(64, t - lastT) : 16; lastT = t;
      if (playing) {
        const total = P.pv.length, dur = Math.min(9000, Math.max(3500, total * 18)) / speed; // ms for the whole replay
        prog = Math.min(total - 1, prog + (dtm / dur) * total * (0.6 + 0.8 * ease(Math.min(1, prog / total + 0.05))));
        if (prog >= total - 1) { playing = false; setPlay(); summary(); }
      }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function setPlay() { playBtn.innerHTML = icon(playing ? 'pause' : 'play'); playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
    function start(fromZero) {
      if (fromZero || prog >= P.pv.length - 1) { prog = 0; breached = false; badge.hidden = true; el.querySelector('.sa-sum').textContent = ''; }
      if (reduce()) { prog = P.pv.length - 1; playing = false; setPlay(); draw(); summary(); return; }
      playing = true; setPlay();
    }
    playBtn.onclick = () => { if (playing) { playing = false; setPlay(); } else start(false); };
    el.querySelector('.sa-replay').onclick = () => start(true);
    el.querySelector('.sa-speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sp]'); if (!b) return; speed = +b.dataset.sp;
      el.querySelectorAll('.sa-speed button').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    });
    el.querySelector('.sa-pills').addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      el.querySelectorAll('.sa-pill').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      cur = crises.find((s) => s.id === b.dataset.id); P = path(o, cur); start(true);
    });
    if (window.ResizeObserver) new ResizeObserver(size).observe(wrap); else window.addEventListener('resize', size);
    size();
    raf = requestAnimationFrame(frame);
    // start playing the first time it scrolls into view
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !seen) { seen = true; start(true); io.disconnect(); } }, { threshold: 0.4 });
      io.observe(el);
    } else start(true);
  }
  function hexA(c, a) { // any CSS colour → rgba with alpha
    const d = document.createElement('span'); d.style.color = c; document.body.appendChild(d);
    const m = getComputedStyle(d).color.match(/\d+(\.\d+)?/g) || [0, 0, 0]; d.remove();
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  }
  function icon(k) {
    const p = { play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${p[k]}</svg>`;
  }

  // summary cards: numbers count up the first time they come into view
  function countUp(root) {
    if (reduce()) return;
    const els = [...root.querySelectorAll('.st-card b')].filter((b) => /\d/.test(b.textContent) && !b.dataset.cu);
    const run = (b) => {
      const txt = b.textContent, m = txt.match(/(\d[\d,]*\.?\d*)/); if (!m) return;
      const target = parseFloat(m[1].replace(/,/g, '')), dec = (m[1].split('.')[1] || '').length, t0 = performance.now(), D = 900;
      b.dataset.cu = '1';
      const tick = (t) => {
        const k = ease(Math.min(1, (t - t0) / D)), v = target * k;
        b.textContent = txt.replace(m[1], v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
        if (k < 1 && b.isConnected) requestAnimationFrame(tick); else b.textContent = txt;
      };
      requestAnimationFrame(tick);
    };
    if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.6 });
    els.forEach((b) => io.observe(b));
  }

  window.PlutusStressAnim = { mount, countUp };
})();
