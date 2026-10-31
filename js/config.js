/* ============================================================
   PLUTUS — configuration
   ------------------------------------------------------------
   Yahoo Finance blocks direct browser calls (CORS), so requests
   go through your Cloudflare Worker (see /worker/worker.js).
   If WORKER_URL is empty, the app falls back to public CORS
   proxies — unreliable, demo only.
   ============================================================ */
window.APP_CONFIG = {
  WORKER_URL: "https://sparkling-hill-66aa.plutus1410.workers.dev/",
  LOGODEV_KEY: "pk_bhlc52p0TIy8HasyFvNnVA",
  PUBLIC_PROXIES: [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?url="
  ],
  CACHE_MINUTES: 15,      // browser-side cache per Yahoo response
  REQUEST_TIMEOUT_MS: 15000,

  // Plutus voice bot ("Ask Plutus"). It needs the Worker (WORKER_URL above) to be v7 — see VOICE_SETUP.md.
  VOICE_BOT: true,                 // false hides the button completely
  REPORTS_PATH: "data/reports/",   // where the GitHub Actions job saves annual reports + conference-call transcripts
  VOICE_LANG: "en-IN",             // English locale for the browser's speech recognition + preferred device voice (Indian English).
                                   // v11: the mic defaults to 🌐 Auto (the Worker's /stt detects the spoken language); answers come back in
                                   // the language of the question, or the one the visitor asks for ("answer in Tamil")
  VOICE_REFINE: true,              // an extra AI call rewrites each English question before searching (better on messy speech; set false to save tokens).
                                   // Hindi / Hinglish questions always get this step: the source documents are usually in English, so they must be translated for the search

  // v19: cost-of-capital assumptions for the WACC estimate and the ROIC − WACC spread (Key Numbers → Quality & Risk).
  // rf = 10-year government bond yield, erp = equity risk premium. Update them now and then (e.g. once a quarter).
  // Sources (Oct 2026): India 10Y G-Sec ≈ 7.0%; US 10Y Treasury ≈ 5.0%; Damodaran mature-market ERP 4.2% (Jul 2026),
  // India total ERP ≈ 6.5% (mature 4.2% + country risk ≈ 2.3%).
  WACC: {
    IN:    { rf: 0.070, erp: 0.065 },
    US:    { rf: 0.050, erp: 0.042 },
    OTHER: { rf: 0.050, erp: 0.050 }
  },

  // Company logos. Yahoo Finance has no logo API, so logos are looked up by the
  // company's website domain. Sources are tried in order; if all fail, a
  // coloured initials badge is shown. Use {domain} as the placeholder.
  // To use a dedicated logo service, put it first, e.g.
  //   "https://img.logo.dev/{domain}?token=YOUR_PUBLISHABLE_TOKEN&size=128"
  LOGO_SOURCES: [
    "https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=https://{domain}&size=128",
    "https://icons.duckduckgo.com/ip3/{domain}.ico"
  ]
};
