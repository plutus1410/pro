"""
PLUTUS — portfolio stress test data (v48)
-----------------------------------------
Builds the files the Stress test page (#/stress, js/stress.js) reads, so every calculation can run in the browser:

  data/risk/factors.json   one shared trading calendar (Nifty 50 days since 2004) + daily returns of the market,
                           sector indices, USD/INR and Brent crude
  data/risk/s/<SYM>.json   per stock: daily returns on that calendar, 3-month and 1-year average daily volume, price

Returns are stored as whole basis points (1 bp = 0.01 %), so a 2.5 % fall is -250. Missing days are null.
All Yahoo requests go through the Cloudflare Worker (WORKER_URL), like the screener job.

  python scripts/build_risk.py                # everything in data/screen/universe.json (Nifty 500)
  python scripts/build_risk.py --limit 20     # a quick test run
  python scripts/build_risk.py --factors-only # only the market / sector / FX / crude series
"""
import argparse
import datetime as dt
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_report as pr  # noqa: E402  (Worker route, HTTP helper, index lists, logging)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "risk"
UNIVERSE = ROOT / "data" / "screen" / "universe.json"
log = pr.log
START = "2004-01-01"            # covers the May-2004 election shock and everything after
SUSPECT = 0.40                  # a one-day move beyond ±40 % is almost always a bad print / unadjusted split

# key → (Yahoo ticker, label). The market (NIFTY) sets the calendar; the others are optional — a ticker Yahoo
# doesn't serve is skipped and stocks in that sector simply use the market factor alone.
FACTORS = {
    "NIFTY":  ("^NSEI", "Nifty 50"),
    "BANK":   ("^NSEBANK", "Nifty Bank"),
    "FIN":    ("NIFTY_FIN_SERVICE.NS", "Nifty Financial Services"),
    "PSUBANK": ("^CNXPSUBANK", "Nifty PSU Bank"),
    "IT":     ("^CNXIT", "Nifty IT"),
    "FMCG":   ("^CNXFMCG", "Nifty FMCG"),
    "PHARMA": ("^CNXPHARMA", "Nifty Pharma"),
    "AUTO":   ("^CNXAUTO", "Nifty Auto"),
    "METAL":  ("^CNXMETAL", "Nifty Metal"),
    "REALTY": ("^CNXREALTY", "Nifty Realty"),
    "ENERGY": ("^CNXENERGY", "Nifty Energy"),
    "INFRA":  ("^CNXINFRA", "Nifty Infrastructure"),
    "MEDIA":  ("^CNXMEDIA", "Nifty Media"),
    "FX":     ("INR=X", "USD/INR"),
    "OIL":    ("BZ=F", "Brent crude"),
}


def yahoo_daily(ticker):
    """[(date 'YYYY-MM-DD', close, volume)] since START, oldest first. Adjusted close when Yahoo gives it."""
    p1 = int(dt.datetime.fromisoformat(START).replace(tzinfo=dt.timezone.utc).timestamp())
    p2 = int(dt.datetime.now(dt.timezone.utc).timestamp()) + 86400
    u = (f"https://query2.finance.yahoo.com/v8/finance/chart/{quote(ticker)}"
         f"?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=true")
    url = f"{pr.WORKER_URL}/?url={quote(u, safe='')}" if pr.WORKER_URL else u
    j = pr.http_get(url, headers={"User-Agent": pr.BROWSER_UA}, timeout=60, tries=3).json()
    res = (j.get("chart") or {}).get("result") or []
    if not res:
        return []
    r = res[0]
    ts = r.get("timestamp") or []
    q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    adj = ((r.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
    closes = adj or q.get("close") or []
    vols = q.get("volume") or [None] * len(ts)
    # Yahoo stamps Indian closes at 09:15 IST; shift by +5:30 so the date is the trading day
    out = []
    for t, c, v in zip(ts, closes, vols):
        if c is None or not math.isfinite(c) or c <= 0:
            continue
        d = dt.datetime.fromtimestamp(t + 19800, dt.timezone.utc).strftime("%Y-%m-%d")
        if out and out[-1][0] == d:
            out[-1] = (d, c, v)
        else:
            out.append((d, c, v))
    return out


def align(series, dates):
    """Daily returns (bp ints / None) on the shared calendar. A day the series didn't trade is None; the next traded
    day's return is measured from the last close, so nothing is lost."""
    by = {d: c for d, c, _ in series}
    out, last = [], None
    for d in dates:
        c = by.get(d)
        if c is None:
            out.append(None)
            continue
        if last is None:
            out.append(None)
        else:
            r = c / last - 1
            out.append(None if abs(r) > SUSPECT else int(round(r * 10000)))
        last = c
    return out


def first_index(r):
    for i, x in enumerate(r):
        if x is not None:
            return i
    return len(r)


def build_factors():
    nifty = yahoo_daily(FACTORS["NIFTY"][0])
    if len(nifty) < 500:
        raise SystemExit("Nifty 50 history unavailable — check the Worker (WORKER_URL)")
    dates = [d for d, _, _ in nifty]
    f, names = {}, {}
    for key, (tk, label) in FACTORS.items():
        try:
            s = nifty if key == "NIFTY" else yahoo_daily(tk)
        except Exception as e:  # noqa: BLE001
            log(f"factor {key} ({tk}) skipped: {e}")
            continue
        if len(s) < 250:
            log(f"factor {key} ({tk}) skipped: only {len(s)} days")
            continue
        f[key] = align(s, dates)
        names[key] = label
        log(f"factor {key}: {len(s)} days from {s[0][0]}")
    OUT.mkdir(parents=True, exist_ok=True)
    doc = {"v": 1, "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "dates": dates, "f": f, "names": names}
    (OUT / "factors.json").write_text(json.dumps(doc, separators=(",", ":")))
    return dates


def avg(xs):
    xs = [x for x in xs if isinstance(x, (int, float)) and x > 0]
    return round(sum(xs) / len(xs)) if xs else None


def build_stock(row, dates):
    sym = row["s"]
    s = yahoo_daily(sym)
    if len(s) < 60:
        return False
    r = align(s, dates)
    o = first_index(r)
    vols = [v for _, _, v in s]
    doc = {"s": sym, "n": row.get("n") or sym, "sec": row.get("sec") or "", "ind": row.get("ind") or "",
           "o": o, "r": r[o:], "adv3": avg(vols[-63:]), "adv12": avg(vols[-250:]), "px": round(s[-1][1], 2),
           "asof": s[-1][0]}
    p = OUT / "s" / (sym.replace("/", "_") + ".json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, separators=(",", ":")))
    return True


def universe(limit=None):
    if UNIVERSE.exists():
        j = json.loads(UNIVERSE.read_text())
        rows = [dict(zip(j["fields"], a)) for a in j["rows"]]
    else:
        rows = [{"s": s} for s in pr.index_symbols("nifty500")]
    return rows[:limit] if limit else rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--factors-only", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    dates = build_factors()
    if a.factors_only:
        return
    rows = universe(a.limit)

    def one(row):
        try:
            return build_stock(row, dates)
        except Exception as e:  # noqa: BLE001
            log(f"{row.get('s')}: {e}")
            return False
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        ok = sum(ex.map(one, rows))
    idx = {"built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "symbols": sorted(p.stem for p in (OUT / "s").glob("*.json"))}
    (OUT / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    log(f"risk data: {ok}/{len(rows)} stocks written")


if __name__ == "__main__":
    main()
