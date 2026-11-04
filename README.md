## PLUTUS — Your AI Stock Analysis Companion

A futuristic dashboard (light mode by default, dark mode one tap away) that turns Yahoo Finance data into plain-English, gamified insights. **Facts only — no buy/sell/hold calls.** Fully responsive for desktop, tablet and mobile.

### Dashboard sections (in order)
- **About the Company** — business summary (justified, with Read more), sector, industry, HQ, website
- **Health Scan** — 0–100 score ring, six power stats
- **Key Numbers** — 12 KPI cards in 3 clickable categories of 4, full width (Growth & Profit, Value & Returns, Safety & Cash) with tap/hover explanations
- **Trajectory** — price (1Y/5Y), P/E history and Yearly/Quarterly business charts
- **Shareholding Pattern** — a crowd of 100 people (1 person = 1% of shares; a circle on phones) coloured by holder type, the change since the previous filing, and the biggest institutional and mutual-fund holders (Yahoo Finance)
- **Peer Arena** — companies from the **same industry**, medals, head-to-head chart and comparison table
- **Strengths & Weaknesses** — plain-English facts, including "VS INDUSTRY" items

The home page's **Try** chips are 3 Indian (Reliance, TCS, HDFC Bank) and 3 US (Apple, Microsoft, NVIDIA) companies. Search favours Indian listings (NSE, then BSE), marked with an IN tag, and matches on the **company name** (not the ticker).

### What changed in v48 — Portfolio stress test (`#/stress`)
- **New page, "Stress test"** (top bar, home page, and a "Stress test these" button on screener results). Add holdings by search, a broker holdings CSV (Zerodha / Groww / Upstox / generic), mutual funds (via MFapi.in), or the sample portfolio. Holdings are saved only in the browser; "Copy share link" puts them in the URL.
- **What it shows:** 10 Indian crash replays (2004 election → early-2026 sell-off) next to the Nifty; loss by holding with a "−10%" what-if; loss by sector heat map; a shock builder (Nifty, two sectors, USD/INR, crude, 8 presets); loss vs Nifty fall; reverse stress test; 1-day / 10-day VaR and expected shortfall with a Kupiec model check; crash-day beta and correlation; days to sell 25 / 50 / 100 % by SEBI's AMFI method; a 10,000-path one-year Monte Carlo; a plain-language summary; Save as PDF.
- **How:** `js/stress-engine.js` (all maths, testable under Node) + `js/stress.js` (page) + `css/stress.css`. Stocks not listed during a crash are estimated with a factor model (3 years of weekly returns on the Nifty, their sector index, USD/INR and crude) and marked "est.".
- **Data:** new job `scripts/build_risk.py` + `.github/workflows/risk-data.yml` → `data/risk/factors.json` and `data/risk/s/<SYMBOL>.json` (daily returns since 2004 in basis points, 3-month / 1-year average volume). Runs on weekdays at 18:10 IST. Until it has run once, the page falls back to live Yahoo data (market and rupee only).
- **Worker:** `api.mfapi.in` added to the proxy allow-list, fetched without Yahoo's cookies. Redeploy the Worker for mutual funds to work when MFapi blocks direct browser calls.
- **Setup:** upload the files → redeploy the Worker → Actions → "Build stress test data" → Run workflow (about 10–20 minutes for the Nifty 500). Assets `?v=81`, cache `plutus-v81`.

### What changed in v47
- Screener: **Run query** now shows a loading state (spinner on the button, "Screening N companies…" with skeleton rows) for at least 0.7 s, then the results fade in. Ready-made chips and links from the home page get the same. Assets `?v=80`, cache `plutus-v80`.

### What changed in v46
- Home page is about 20% smaller on tablets and desktops (title, toggle, search box, chips, Compare button). Phones unchanged. Assets `?v=79`, cache `plutus-v79`.

### What changed in v45
- Home page rows now follow the toggle: **Search a stock** shows the "Try" company chips and "Compare stocks side by side"; **Screen stocks** shows only the "Screens" chips. Assets `?v=78`, cache `plutus-v78`.

### What changed in v44 — the screener, up front on the home page
- **Search / Screen toggle (home):** a two-way switch above the big box. "Screen stocks" turns it into a condition box with field suggestions and a Run screen button; Enter opens `#/screen/<query>`. The choice is remembered for the browser session.
- **Ready-made screens (home):** a "Screens" row of one-tap chips (Quality compounders, Debt-free & growing, Cheap and growing, High dividend, Promoters buying) plus "All screens →". Phones show the first three.
- **Top bar:** the funnel icon is now a labelled "Screener" pill (icon only on phones). The duplicate "Stock screener" link under the search box is gone; "Compare stocks" stays.
- The splash screen no longer flashes when a screener link is opened directly. Assets are `?v=77`, cache `plutus-v77`.

### What changed in v43 — the mic, made reliable and free
- **The Worker had lost its `/caps` and `/stt` routes**, so the mic always fell back to the browser's own speech recognition. That fails in Brave and Firefox, in many installed-app windows, on flaky networks, and whenever Chrome can't reach Google's speech servers. Both routes are back.
- **How the mic works now:**
  1. The browser records your question (works in Chrome, Edge, Safari, Firefox and the installed app).
  2. The Worker turns it into text with **Groq Whisper** (free; uses the `GROQ_API_KEY` the Worker already has) and detects the language.
  3. If Groq is busy or down, it uses **Cloudflare Workers AI Whisper** (free daily allowance). This needs an AI binding named `AI`: Worker → Settings → Bindings → Add → Workers AI → name `AI`.
  4. If the Worker can't be reached at all, the browser's own recognition takes over for the rest of the visit.
- A blocked microphone now gets exact steps (🔒 icon → Microphone → Allow).

### What changed in v41
- Screener subtitle stays on one line on wide screens.
- **Peer Arena only lists companies that open properly on PLUTUS.**
  - Each candidate peer's 1-year price history is checked first. Companies with no share-price data (many SME / BSE-only listings such as numeric BSE codes) are skipped, and the next-closest company takes their place.
  - The same check fills each peer's **1-year return**, which used to show "—".

### What changed in v40
- Ask Plutus no longer refuses questions about the newest quarter (e.g. "AUM in Q2 FY27" for Bajaj Finance) when the Q2 FY27 call is loaded.
  - Each call's financial year now comes from its own label ("Q2 FY2027") or date (Indian April–March year), not from a stored value that could be wrong (FY2010, FY2004…).
  - The bot only refuses when no document mentions the year at all.
- Report job: con-call periods are taken from the call's date, so mislabels like "Q4 FY2025" for an April 2026 call no longer happen. Existing reports are corrected on their next refresh, or straight away with force.

### What changed in v39
- Screener subtitle shortened to the example query, the units and the index covered.
- Business Model: the AI sometimes leaked one of its own field names ("edge") into the expenditure list as an item. Such entries are now dropped, including from cached answers.
- Business Metrics:
  - Sources are always readable ("Con call · Oct 2026 · p. 3", "Investor presentation · Oct 2026", "Annual report FY26"), never a file label or link.
  - The change pill appears only for a real comparison ("up 26.5% YoY"), not a restatement like "came in at 4.6%".
  - The report job gives NSE transcripts readable titles.

### What changed in v38
- Visitors no longer see setup or technical messages (Worker, Groq key, GitHub, Cloudflare, "v11"…) in Ask Plutus, Peer Arena, the Business Model or the screener. They get a plain "not available right now" message instead, and the technical reason goes to the browser console for the site owner.
- **Business Metrics cards redesigned:**
  - 2–4 roomy cards per row (they were 5 cramped ones).
  - The name is in normal case; a note in brackets becomes a sub-line ("Utilization · including trainees").
  - A large value with a light unit.
  - The period and a neutral ▲/▼ change pill. No green/red, because for attrition, DSO or costs "down" is good.
  - A quiet footer with the source (tap for the quote and document link) and "Ask ›".

### What changed in v36
- **Shareholding over time → Show numbers:** a table of each group's actual holding % (Promoters, FIIs, DIIs, Government, Public) plus the number of shareholders, quarter by quarter (or year by year with the Yearly switch), with the latest quarter on the right.

### What changed in v35 — Business Metrics
- **New dashboard section, "Business Metrics":** the operating numbers each company reports about itself, e.g. Jio ARPU and subscribers, retail store count, order book, volumes, realisation, deal wins, AUM, CASA. Latest value only, grouped by segment.
  - Each card shows the period and any change the company states, a source link (document and page) with the exact quoted line, and an "Ask Plutus ›" shortcut.
  - Picked by AI through the Worker's new `/kpis` route. A figure is kept only if it appears word for word in the passage it cites. Results are cached per company and document set.
- **Investor presentations:** the report job now also reads the newest 2 investor presentations listed on screener.in (doc type `presentation`). They hold most KPI tables, and Ask Plutus can use them too. Existing reports pick them up on their next refresh, or straight away if you run **Prepare annual report** with force.
- Companies whose documents aren't prepared yet show a "Prepare them with Ask Plutus" button.

### What changed in v33 — Stock screener (`#/screen`)
- **Screen page:** filter the Nifty 500 with screener.in-style queries, e.g. `Market Capitalization > 5000 AND ROCE > 20 AND Debt to equity < 0.5`.
  - AND / OR / NOT, brackets, + − × ÷, comparing two fields (`Price to Earning < Industry PE * 0.8`), and short names (mcap, roce, pe, d/e…). Money is in ₹ crore, % are plain numbers, and `5k` / `5,000` both work.
  - Field names autocomplete as you type. A misspelled name gets "Did you mean…?". **All fields** lists the 45 fields with short explanations.
  - Ten ready-made screens (quality compounders, debt-free and growing, GARP, high dividend, below industry P/E…). You can save your own; they're kept in the browser.
  - Results are a sortable table showing the columns your query uses. Click a company to open its dashboard, tick 2–4 to **Compare**, or download a CSV. The query is in the link (`#/screen/<query>`), so a screen can be shared.
  - Opened from the home page ("Stock screener") and the ⧩ button in the top bar.
- **Data:** `data/screen/universe.json` comes from `scripts/build_screen.py` through the new workflow `.github/workflows/screen-data.yml`.
  - Weekly (Sunday 02:00 IST): every Nifty 500 company's screener.in page is read through the Worker (~30–60 min).
  - Weekdays at 17:30 IST: prices, market cap and the price-based ratios (P/E, P/B, yield, EV/EBITDA, PEG, distance from the 52-week high) are refreshed from Yahoo.
  - Run it once by hand with mode `full`.

### What changed in v32
- Ask Plutus: the "Answer from" switch is laid out properly. A generic `.loading` style had stretched the Annual report button; it now uses its own class. Con calls shows a spinner while it loads instead of "none found".
- Con calls: when screener.in's newest listed call is older than ~6 months (e.g. ITC's 2023 hotels-demerger call), the job also searches NSE filings and the company website, and the newest calls win. If even the newest call is over ~9 months old, the bot warns that the company may not hold regular earnings calls. The status line shows the latest call's date.

### What changed in v31 — "Answer from" switch in Ask Plutus
- A switch above the input, **All · Annual report · Con calls**. It is remembered between visits and defaults to All, which keeps the automatic choice. A question that names a source ("in the con call…", "in the annual report…") uses that source for that question only.
- Every answer shows where it came from, e.g. "From: Q2 FY27 call + Annual report FY26".
- The suggested questions and the input placeholder follow the switch.
- "Con calls · none found" is dimmed (tap to search again), and "Annual report" shows a spinner while it is still loading. A question for the annual report waits for it and is then answered automatically.

### What changed in v30 — better guidance answers
- Guidance, outlook, demand, pricing and "what did management say" questions now search the **con-call transcripts first**: at least 5 of the 9 passages sent to the AI come from the calls, latest call first.
- The answer prompt (Worker): when no numeric guidance is given, the bot says so **once**, then gives management's direction, drivers, targets and what they told analysts, naming the call it came from.

### What changed in v29 — news for shareholders
- **Short or acronym company names** (EPL, SRF, ITC…) are searched as "EPL Ltd" / "EPL Limited", with football, cricket and film words excluded. A headline is kept only when it is clearly about the listed company: shares, NSE/BSE, crore, results, dividend, the company's industry (e.g. packaging), or its full legal name.
- Sport, film and celebrity headlines are dropped for every company unless they're plainly about the business.
- **Ranked for shareholders:** results, guidance, dividends, buybacks, orders, deals, stake and promoter moves, ratings, management changes and regulatory action come first. Expansion, demand and policy come next. "Stocks to buy", "top gainers", live market blogs and multi-stock lists sink. Nothing older than about 4 months is shown.
- A second company search looks specifically for those shareholder events.

### What changed in v28 — Ask Plutus con-call answers
- **"List all the questions"** appears at once, with each question shortened locally; the AI's cleaner wording replaces it in place a few seconds later (all batches at once). No more second "typing" box.
- **"What answers did management give?"** (or the new button under the question list) shows each question with management's reply, who answered, and the exact words. Short AI summaries come from the Worker's new `/alist` route. Asking about answers no longer repeats the questions.
- Typed English questions skip the extra "rewrite the question" AI call (kept for speech, follow-ups and other languages), so answers come back faster.
- The same note never shows twice in a row.

### What changed in v27 — documents ready faster
- **Con calls first:** the job reads the transcripts (in parallel) before the annual report and publishes them straight away, so con-call questions work about a minute in. The annual report follows, and the bot switches over automatically. If the annual report fails, the con calls stay usable.
- **No waiting for GitHub Pages:** the bot and the bank cards also read the file straight from the repo (`REPORTS_RAW` in `js/config.js`) the moment it's saved. The bot checks every 5 s for the first 5 minutes.
- **Faster job:** a company request downloads only the scripts and that company's file, not every report already made. The slow table detection runs only on the financial-statement pages (at most 60).

### What changed in v26 — con-call transcripts found again
- The report job (`scripts/prepare_report.py`) reads screener.in **through the Cloudflare Worker**: screener blocks GitHub's machines, so its con-call list and annual-report links were never reached and only NSE's (often empty) filings were tried. BSE/NSE PDFs are downloaded with exchange-style headers, and through the Worker's new `?doc=` route if the exchange refuses.
- Worker: `?doc=` route for BSE/NSE document files. Only accepted GitHub jobs count towards the hourly limits.
- Ask Plutus shows the real reason when a job can't start: your hourly limit, the site-wide limit, or a GitHub setup problem with its status code.
- Bank CAR/CASA cards no longer start the document job on their own.
- **Nifty 200 pre-built:** a new workflow, `.github/workflows/prebuild-nifty200.yml`, prepares the annual report and con calls for every Nifty 200 company in advance (list read from NSE each run), so Ask Plutus opens instantly for them. Run it once by hand; after that it runs every Sunday night and only rebuilds what changed. It can also do `nifty100` / `nifty50`.

### What changed in v25
- About the Company is back to the v23 behaviour: screener's business text, with the AI summary only when screener has none. Reliance is removed from the home page's Try chips and the search placeholder.
- Valuation History: Show numbers sits on the same line as 1M–3Y, at the same height.
- Number tables: negative values are shown in brackets, (200), not in red.

### What changed in v24
- **About the Company** is the AI's plain-English summary of what the business does, for every stock, labelled as AI-written. Screener's own About text is often the founder or promoter story; it is now only a stand-in while the summary loads, with ownership sentences and fragments removed.
- **Bank CAR and CASA** load automatically from the annual report: the figure quoted most often wins. If the report hasn't been processed yet, the job is started and the cards fill in when it's done. NBFCs show ROA instead of CASA.
- The WACC card no longer mentions internal files.
- **Show numbers** stays in the same top-right spot on Valuation History and Efficiency & Returns.
- **Business Results** has a single Show numbers / Show graphs button. It swaps all five charts for one table (revenue, profit, margins, EPS, cash flow, debt, equity) and follows the Yearly/Quarterly switch.
- **Compare → Highlights:** the ★ tally runs across the top, and "At a glance" sits below it in two columns, with no empty space.

### What changed in v22
- **Home page** fits the screen exactly: no scrolling, with a compact footer. Very short screens, like a phone in landscape, can still scroll.
- Search box placeholder: "e.g. Reliance, TCS". The **IN badge** is removed from search results and the Compare page.
- **About the Company** describes what the business does. Screener's legal-history sentences ("incorporated as…", "name changed to…", "converted into a public limited company…") are dropped, and screener's Key Points (segments, products, customers) are added. If nothing about the business is left, the AI business-model summary fills in, marked as AI-written.
- **Key Numbers:** six cards in every category, including Sales and Profit CAGR 5Y, P/B, ROCE, Interest Coverage, Promoter Holding and WACC. Banks and NBFCs get lender-specific cards (Payout, CFO, FII, CASA).
- **Show numbers (all options):** the Valuation History table lists every measure (P/E, PEG, EV/EBITDA, P/B, Market Cap/Sales) month by month for 3 years, plus a Sales & OPM table by quarter. The Efficiency & Returns table lists all six ratios year by year. The drop-down and range only choose what the graph shows, so they are hidden in table view.
- **Show numbers / Show graph** on every Trajectory chart except Share Price: a screener-style table of the chart's figures, latest period on the right. Valuation history is shown month by month. Medians appear under the table. The choice is remembered per chart.

### What changed in v21 — faster peers, quick-answer bot, centred home
- **Peers load at once.** Peer Arena and the industry median appear as soon as screener's peer list arrives (price, P/E, market cap, dividend yield, ROCE). Each peer's full figures then fill in, two at a time, and the table updates as they land. If the peers API is unavailable, the industry's company list (`/market/…/`) is used instead; Yahoo's slow industry lookup is only a last resort.
- **Faster pages.** Screener pages are slimmed (no scripts, icons or styles: about half the bytes) by the Worker and before they're stored in the tab. A page asked for twice at once is fetched once. The slow public proxies are skipped when the Worker has answered.
- **Ask Plutus quick mode.** The bot opens ready to answer from the company's screener figures (overview, pros and cons, P&L, quarters, balance sheet, cash flow, ratios). It does this while the annual report and con calls load or are prepared for the first time, and switches to them automatically. Con-call questions wait for the transcripts.
- **No more yellow "profile unavailable" bar** when data comes from screener.
- **Home:** PLUTUS and the search box are centred on the screen.
- **Key Numbers:** five cards in every category. ROCE, P/B and Interest Coverage are added. Banks and NBFCs get Profit CAGR 5Y and Promoter Holding instead.
- Worker: allows screener's `/market/…/` industry pages, slims HTML, and sends the XHR header for the peers and search endpoints. Redeploy `worker/worker.js`.

### What changed in v20 — data sources streamlined (Indian stocks only)
- **Two sources instead of six.** screener.in for fundamentals (10–12 years of P&L, balance sheet, cash flow, 12 quarters,
  ratios, shareholding, sector / industry, peer list, annual-report and con-call links); Yahoo Finance for share prices
  (and a few balance-sheet detail lines screener's page doesn't show: receivables, inventory, current assets / liabilities,
  cash, capex). Yahoo's profile, holder and ~40 peer lookups are gone.
- **About 7 requests to open a stock** (1 screener page, 1 peer list, 4 price charts incl. Nifty for beta and MAX history,
  1 statements call) plus 5 peer pages in the background — down from ~45. All screener responses are cached at the Worker.
- **Same layout.** `js/screener.js` turns a screener page into the shapes the model already used, so every section works
  unchanged; charts now show up to 12 years.
- **Peers** come from screener's own industry peer list (6 closest in size); the industry median uses them.
- **Search** uses screener's company search (Indian listings only); Try chips and Compare presets are Indian.
- **Beta** is calculated from 5 years of weekly returns against the Nifty 50.
- **Fallback:** if a screener page can't be read, the dashboard falls back to Yahoo's own profile and statements.
- **Ask Plutus documents:** `prepare_report.py` takes the annual report and con-call transcripts from screener's document
  list first (BSE / NSE / company website only as fallbacks).
- **Re-deploy `worker/worker.js`** (allows screener's search and peer endpoints).
- Cache version 51.

### What changed in v19
- **Key Numbers → new "Quality & Risk" tab** (shown by default):
  - Non-financial companies: **Piotroski F-Score** (9 health tests, each shown ✓/✗ in the ⓘ), **Altman Z-Score** (bankruptcy risk), **Beneish M-Score** (earnings-manipulation screen), **Cash Conversion** (CFO ÷ net profit, 3-year) and **ROIC − WACC spread**.
  - Banks / NBFCs: **Gross NPA %**, **Net NPA %**, **Provision Coverage (approx.)** (from screener.in, Indian banks), **Net Interest Margin (approx.)**, and **CAR** / **CASA** cards that ask Plutus to read them from the annual report.
- **New in "Add a metric":** FCF ÷ Net Profit, Net Debt ÷ EBITDA, FCF Yield, Share Count Change (dilution), Net Shareholder Yield, Gross Profitability (GP ÷ assets), Rule of 40 (software), WACC (estimated, with its assumptions).
- **Strengths & Weaknesses** now also flag: F-Score ≥7 / ≤3, Z-Score distress, M-Score red flag, cash conversion, ROIC vs cost of capital, dilution ≥3%, net debt/EBITDA >3.5×.
- **WACC assumptions** live in `js/config.js` → `WACC` (risk-free rate and equity risk premium for India / US / other). Update them occasionally.
- Industry-median comparison works for all the new metrics.
- Cache version 50.

### What changed in v18
- **Dark mode redesigned:** midnight black `#02070A` (page), electric blue `#0297DE` (main accent, charts, active toggles) and violet `#9D8CFF` (second accent, industry-median markers). All tokens in `css/style.css` → `:root[data-theme="dark"]`.
- **Trajectory → Efficiency & Returns:** a third trend chart with Debtor days, Inventory days, Days payable, Cash conversion cycle, Working capital days and ROCE %. Indian listings use screener.in's published figures (10-12 years); others are calculated from Yahoo Finance yearly statements (usually 4-5 years).
- **Business Model:** the flow legend now sits above the map.
- Cache version 48.

### What changed in v16
- **Industry median** instead of average everywhere (switch, Key Numbers, Power Stats, P/E and margin charts, peer table, strengths/weaknesses) — one unusual peer can no longer drag the comparison.
- **Key Numbers:** ROIIC and PEG are no longer shown by default; add them from the "Add a metric" search.
- **Business Model:** headline left-aligned, summary justified; the "Where each ₹100 of revenue went" chart removed; "Mini Income Statement" renamed **Income Statement**.
- **Smoother animations:** the Latest In News sidebar glides open/shut (width, height and content cross-fade; charts resize once at the end); light/dark switch reveals the new theme in a circle from the button (cross-fade on browsers without View Transitions).
- **Ask Plutus:**
  - "List all the questions asked in the con call" is answered from the **whole transcript** (every analyst, every question, in order, with the exact words one tap away); buttons list the questions from the other calls held.
  - If no con-call transcript was found, the bot says so and offers **Search again for con calls** (also in the status bar).
  - Suggested questions are half con call, half annual report.
- **Worker v16:** re-deploy `worker/worker.js` — adds `/qlist` (tidies the wording of the listed questions; the site falls back to the exact words without it), plus v15's screener.in pages and `/bizmodel`.
- Cache version 47 (`sw.js`, `?v=47` in index.html).

### What changed in v11
- **Compare stocks** — a new page (`#/compare/AAPL,MSFT,NVDA`, 2–4 companies): a card per company, plain-English
  highlights, share-price performance rebased to 100 (1Y / 5Y), a Health Scan radar, net margin by year and a full table
  with ★ on the best figure of each line. Open it from **Compare with other stocks** on any dashboard, **Compare these side
  by side** under the Peer Arena, or **Compare stocks side by side** on the home page. New files: `js/compare.js`, `css/compare.css`.
- **Photos in Corporate Governance** — officers are looked up on Wikipedia; a photo is shown only when the page clearly
  matches the person (name + business role / company). Everyone else keeps the initials badge.
- **Voice bot in any language** — see VOICE_SETUP.md ("What's new in v11"). Re-deploy `worker/worker.js` (v11).
- Cache version 31 (`sw.js`, `?v=31` in index.html).

### What changed in v6
1. **Light mode** (the default; "ivory & navy": warm paper background, white cards with soft shadows, navy text, royal-blue and gold accents) and the original dark mode. The sun / moon button in the top bar switches between them; the choice is remembered in the browser (`plutus.theme.v1`). Charts redraw in the new colours. All colours are tokens at the top of `css/style.css` (`:root` = light, `:root[data-theme="dark"]` = dark).
2. **Collapsible news sidebar** on desktop / laptop screens (1280 px and wider). It starts collapsed to a slim "Latest In News" rail with a headline count, so the dashboard fills the screen; click the rail to open it and » to close it. On smaller screens the news stays below the content.
3. **Far fewer "Signal lost" errors:**
   - **Worker bug fixed:** answers served from Cloudflare's edge cache carried `Access-Control-Allow-Origin: *, *`, which browsers reject. Every cache hit (any stock someone opened in the previous 10 minutes) failed as "Failed to fetch" — it looked like a network problem, but it wasn't. **Re-deploy `worker/worker.js` (v6)** to fix it at the source; the site also works around it with the old Worker.
   - Requests go through a small queue (max 6 at once) where the stock you're opening goes ahead of the background peer lookups, and lookups for a stock you've already left are dropped.
   - Failed requests are retried up to 4 times with growing waits, switching between Yahoo's twin hosts; then the whole page tries once more ("DATA SERVICE BUSY · RETRYING") before showing an error. As a last resort an older copy from this tab's cache is used.
   - The error screen explains what happened in plain English and has a **Try again** button (it also reloads by itself when the device comes back online).
   - Worker v6 also shares one Yahoo cookie/crumb handshake between requests that arrive together, retries a refused request on the twin host, and keeps a 24-hour "last good copy" for when Yahoo refuses.

### What changed in v4
1. Top bar (logo + search) is now fixed to the top of the screen on the stock page.
2. Search ranks results by company name only; ticker is shown as secondary text.
3. Achievements removed from Health Scan.
4. Peers are real industry peers (verified against Yahoo's industry label), chosen closest in size.
5. Company logo beside the name in search suggestions, the stock header and the peer table.
6. Industry averages are available for every metric (strip, power stats, KPI cards, P/E and margin charts, peer table) — switched on with the **Compare with industry average** switch.

### Structure
index.html
manifest.webmanifest  ← PWA manifest (name, icons, colours)
sw.js                 ← service worker (installability + offline shell)
icons/                ← app icons (192, 512, maskable, Apple touch)
css/style.css
css/news.css
css/pwa.css       ← "Install app" modal
js/config.js      ← WORKER_URL, LOGO_SOURCES
js/analysis.js    ← metrics, scores, peer ranks, strengths/weaknesses
js/app.js         ← UI, search, logos, industry peers, shareholding, routing, charts
js/news.js        ← "Latest In News" sidebar (max 10: 5 company, then 5 industry)
js/pwa.js         ← service-worker registration + one-time install modal
worker/worker.js  ← Cloudflare Worker v6 (deploy on Cloudflare, not GitHub)

### Compare with industry average
- The switch is in the fixed **top bar**, labelled **Compare with industry** on wide screens and **Industry avg** on tablets and phones. It's off by default; the choice is remembered in the browser (`plutus.compare.v1`). Each change is confirmed with a short message, which also explains the chips (↑ higher / ↓ lower, green = better, red = worse).
- When on, numbers are labelled in words: **INDUSTRY AVG 25.2×** under each headline number and in each Key Number card, with a chip such as **↑ 4% higher** / **↓ 0.5 pts lower** (narrow boxes shorten this to "AVG" and the arrow). Green = better for the company, red = worse, grey = neither. Hover or tap a chip for the full sentence, e.g. "Industry average 25.2×. This company: 4% higher than the industry — worse (lower is better here)." Power Stats get the same chip plus a marker on the meter; the score ring and the P/E and margin charts get the average too.
- Switching it on or off never moves the layout. If peers can't be found the switch is greyed out and says why on hover.

### Install as an app (PWA)
- The site is a Progressive Web App. **Every time a visitor lands on the home page** (each fresh visit or reload, or the first time they reach the home page during a visit) a modal offers to install it, until it is installed: one-tap **Install app** on Chrome/Edge/Android; the matching "menu → Install / Add to Home Screen" steps on browsers without an install button (iPhone/iPad, Firefox, in-app browsers).
- "Not now" / "Got it" only closes it for that visit. It stops for good when the app is installed (the browser reports it), when it's opened as the installed app, or when the visitor taps **I've already added it** (needed on iPhone/iPad, where Safari can't tell a website that it's on the home screen). That choice is stored in `plutus.installed.v1`; clear it to see the modal again.
- Desktop browsers get the modal when they offer one-tap install (Chrome/Edge). **To force it while testing, open the site with `?install=1`.**
- One-tap install and offline support need **HTTPS** (GitHub Pages is fine) or `localhost`.
- After you change files, bump `CACHE_VERSION` in `sw.js` and the `?v=` number in `index.html`.
- Live data (Yahoo via the Worker, Bing news, logos) is never cached by the service worker.

### Deploy
- **Worker (re-deploy — it changed in v6):** Cloudflare → Workers → your worker → Edit code → paste worker/worker.js → Deploy. Copy your current code somewhere first as a backup. v6 fixes the cache-hit CORS bug behind most "Signal lost" errors and also covers Bing News RSS and the `?og=` thumbnail lookup used by the news sidebar. Without the update the site still works (it retries around the bug), just with more requests to Yahoo.
- Put the Worker URL in js/config.js (WORKER_URL).
- **GitHub Pages:** upload the folder contents (with index.html at the top level) → Settings → Pages → Deploy from branch main / root.
- _(Recommended)_ Set ALLOWED_ORIGINS = ['https://<user>.github.io'] in the Worker and redeploy.
Run locally: python -m http.server 8080.

### Notes
- Industry median = the median of up to 6 listed peers in the same industry (closest in size), computed the same way as the company's own figures. EPS is per-share and isn't comparable across companies, so it shows n/a.
- Logos come from the company's website domain via public favicon services (see LOGO_SOURCES in config.js); a dedicated logo API can be added there. If none is found, an initials badge is shown.
- Yahoo's free data covers about 4–5 annual periods and up to 8 quarters. Many Indian companies publish cash flow and balance sheets only half-yearly or yearly, so those quarterly charts may say "No quarterly data published".
- Yahoo's endpoints are unofficial and can change without notice.
- Educational use only. Not investment advice.

### v7 — Section navigation + "Ask Plutus" voice bot
- **Sticky section bar** at the top of every stock page, above the company name and price: tabs for About the Company, Health Scan, Key Numbers, Trajectory, Shareholding, Peer Arena and Strengths & Weaknesses. Tapping a tab scrolls to that section; the tab of the section you're reading is highlighted. It stays pinned under the top bar while you scroll, and scrolls sideways on phones.
- **Ask Plutus** (voice + typed questions) answers from the company's latest annual report, with sources. Setup, how it works, limits and troubleshooting: see `VOICE_SETUP.md`.
- New files: `js/voice.js`, `css/voice.css`, `scripts/prepare_report.py`, `scripts/requirements.txt`, `.github/workflows/prepare-report.yml`, `data/report_sources.json`, `data/reports/` (filled automatically). `worker/worker.js` is now v7 (adds `POST /ask` and `POST /prepare`).
- Hide the voice bot with `VOICE_BOT: false` in `js/config.js`.
