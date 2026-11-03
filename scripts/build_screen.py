"""
PLUTUS — stock screener data (v33)
----------------------------------
Builds data/screen/universe.json: ~45 key numbers for every company in an index (Nifty 500 by default), so the
website's Screen page can filter instantly in the browser ("Market Cap > 5000 AND ROCE > 20").

  python scripts/build_screen.py --full            # weekly: read every company's screener.in page (through the Worker)
  python scripts/build_screen.py --prices          # daily: refresh prices and every price-based ratio from Yahoo
  python scripts/build_screen.py --full --limit 20 # a quick test run

Money is in ₹ crore, percentages are plain numbers (ROCE 20 = 20 %), days are days.
"""
import argparse
import datetime as dt
import json
import math
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_report as pr  # noqa: E402  (reuses the Worker route, downloads, index lists, logging)
from bs4 import BeautifulSoup  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data" / "screen" / "universe.json"
log = pr.log

# the stored columns, in order (rows are arrays, to keep the file small)
FIELDS = [
    "s", "n", "sec", "ind", "bank",
    "price", "mcap", "pe", "ipe", "pb", "dy", "ey", "evebitda", "peg", "h52", "l52", "fromhigh",
    "roce", "roe", "roce3", "opm", "npm",
    "sales", "pat", "ebitda", "eps", "salesg", "profitg", "sales3", "sales5", "profit3", "profit5",
    "qsalesg", "qprofitg", "debt", "de", "icr", "cfo", "cfopat", "payout",
    "prom", "promchg", "fii", "dii", "pub", "holders", "debtor", "wcdays", "ccc",
    # bases for the daily price refresh (not shown)
    "_sh", "_bv", "_dps", "_ebitda", "_pat",
]


def num(t):
    t = re.sub(r"[,₹%\s]|Cr\.?|Rs\.?", "", str(t or ""), flags=re.I)
    if t in ("", "-", "--"):
        return None
    try:
        v = float(t)
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def table(soup, sid):
    sec = soup.find(id=sid)
    t = sec.find("table") if sec else None
    if not t:
        return None
    head = [th.get_text(" ", strip=True) for th in (t.find("thead").find_all("th") if t.find("thead") else [])][1:]
    rows = {}
    for tr in (t.find("tbody") or t).find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 2:
            continue
        name = re.sub(r"\s*\+$", "", tds[0].get_text(" ", strip=True)).strip().lower()
        if name and name not in rows:
            rows[name] = [num(td.get_text(" ", strip=True)) for td in tds[1:]]
    return {"labels": head, "rows": rows}


def row(t, *names):
    if not t:
        return None
    for n in names:
        for k, v in t["rows"].items():
            if (n.match(k) if hasattr(n, "match") else k == n):
                return v
    return None


def annual(t, vals):
    """values for the March-year columns only (drop TTM / half-year columns)."""
    if not t or not vals:
        return []
    return [v for lab, v in zip(t["labels"], vals) if re.match(r"^[A-Za-z]{3}\s+\d{4}$", lab or "")]


def last(vals):
    for v in reversed(vals or []):
        if v is not None:
            return v
    return None


def ttm(t, vals):
    if not t or not vals:
        return None
    if t["labels"] and t["labels"][-1].upper() == "TTM" and vals[-1] is not None:
        return vals[-1]
    return last(annual(t, vals))


def cagr(vals, years):
    v = [x for x in vals if x is not None]
    if len(v) < years + 1:
        return None
    a, b = v[-1 - years], v[-1]
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return round(((b / a) ** (1 / years) - 1) * 100, 1)


def growth(a, b):
    if a is None or b is None or a <= 0:
        return None
    return round((b / a - 1) * 100, 1)


def r2(v, d=2):
    return None if v is None or not math.isfinite(v) else round(v, d)


def parse_company(html, sym):
    soup = BeautifulSoup(html, "lxml")
    top = {}
    for li in soup.select("#top-ratios li"):
        name = (li.select_one(".name") or li).get_text(" ", strip=True).lower()
        nums = [num(x.get_text()) for x in li.select(".number")]
        if "market cap" in name: top["mcap"] = nums[0] if nums else None
        elif "current price" in name: top["price"] = nums[0] if nums else None
        elif "high / low" in name: top["h52"], top["l52"] = (nums + [None, None])[:2]
        elif "stock p/e" in name: top["pe"] = nums[0] if nums else None
        elif "book value" in name: top["bv"] = nums[0] if nums else None
        elif "dividend yield" in name: top["dy"] = nums[0] if nums else None
        elif name.startswith("roce"): top["roce"] = nums[0] if nums else None
        elif name.startswith("roe"): top["roe"] = nums[0] if nums else None
    cls = {a.get("title", "").strip().lower(): a.get_text(" ", strip=True) for a in soup.select("#peers a[title]")}
    name = (soup.select_one("#top h1") or soup.select_one("h1"))
    pl, qr, bs, cf, ra, sh = (table(soup, x) for x in ("profit-loss", "quarters", "balance-sheet", "cash-flow", "ratios", "shareholding"))
    sales_v = row(pl, "sales", "revenue", re.compile(r"^revenue"))
    if not sales_v or all(v is None for v in sales_v):
        return None
    bank = bool(row(pl, "financing profit") or row(bs, "deposits"))
    op_v = row(pl, "operating profit", "financing profit")
    pat_v = row(pl, "net profit", re.compile(r"^net profit"))
    eps_v = row(pl, "eps in rs")
    int_v = row(pl, "interest")
    pbt_v = row(pl, "profit before tax")
    div_v = row(pl, "dividend payout %")
    sales_a, pat_a = annual(pl, sales_v), annual(pl, pat_v)
    sales, pat, ebitda = ttm(pl, sales_v), ttm(pl, pat_v), ttm(pl, op_v)
    out = {"s": sym, "n": name.get_text(" ", strip=True) if name else sym,
           "sec": cls.get("sector") or cls.get("broad sector") or "", "ind": cls.get("industry") or cls.get("broad industry") or "",
           "bank": 1 if bank else 0, **{k: top.get(k) for k in ("price", "mcap", "pe", "dy", "roce", "roe", "h52", "l52")}}
    out["sales"], out["pat"], out["ebitda"], out["eps"] = r2(sales, 0), r2(pat, 0), r2(ebitda, 0), r2(ttm(pl, eps_v))
    out["opm"] = r2(ebitda / sales * 100, 1) if ebitda is not None and sales else None
    out["npm"] = r2(pat / sales * 100, 1) if pat is not None and sales else None
    yoy = lambda vals: (lambda xs: growth(xs[-2], xs[-1]) if len(xs) >= 2 else None)([x for x in vals if x is not None])  # noqa: E731
    out["salesg"], out["profitg"] = yoy(sales_a), yoy(pat_a)
    out["sales3"], out["sales5"] = cagr(sales_a, 3), cagr(sales_a, 5)
    out["profit3"], out["profit5"] = cagr(pat_a, 3), cagr(pat_a, 5)
    # last quarter vs the same quarter a year ago
    qs, qp = row(qr, "sales", "revenue"), row(qr, "net profit", re.compile(r"^net profit"))
    out["qsalesg"] = growth(qs[-5], qs[-1]) if qs and len(qs) >= 5 else None
    out["qprofitg"] = growth(qp[-5], qp[-1]) if qp and len(qp) >= 5 else None
    # balance sheet / cash
    debt = last(row(bs, "borrowings", "borrowing"))
    eq = (last(row(bs, "equity capital")) or 0) + (last(row(bs, "reserves")) or 0)
    out["debt"] = r2(debt, 0)
    out["de"] = r2(debt / eq, 2) if debt is not None and eq > 0 and not bank else None
    i_ttm, pbt = ttm(pl, int_v), ttm(pl, pbt_v)
    out["icr"] = r2((pbt + i_ttm) / i_ttm, 1) if (pbt is not None and i_ttm and i_ttm > 0 and not bank) else None
    cfo = last(row(cf, "cash from operating activity", re.compile(r"^cash from operating")))
    out["cfo"] = r2(cfo, 0)
    pat_last = last(pat_a)
    out["cfopat"] = r2(cfo / pat_last, 2) if cfo is not None and pat_last and pat_last > 0 else None
    out["payout"] = r2(last(annual(pl, div_v)), 1) if div_v else None
    roce_hist = [x for x in annual(ra, row(ra, "roce %") or []) if x is not None]
    out["roce3"] = r2(sum(roce_hist[-3:]) / len(roce_hist[-3:]), 1) if len(roce_hist) >= 3 else None
    out["debtor"] = r2(last(row(ra, "debtor days")), 0)
    out["wcdays"] = r2(last(row(ra, "working capital days")), 0)
    out["ccc"] = r2(last(row(ra, "cash conversion cycle")), 0)
    # shareholding (the quarterly table)
    pv = row(sh, re.compile(r"^promoter"))
    out["prom"] = r2(last(pv), 2)
    out["promchg"] = r2(pv[-1] - pv[-5], 2) if pv and len(pv) >= 5 and pv[-1] is not None and pv[-5] is not None else None
    out["fii"], out["dii"], out["pub"] = r2(last(row(sh, re.compile(r"^fii"))), 2), r2(last(row(sh, re.compile(r"^dii"))), 2), r2(last(row(sh, re.compile(r"^public"))), 2)
    hv = row(sh, re.compile(r"^no\.? of shareholders"))
    out["holders"] = last(hv)
    # bases for the daily price refresh
    price, mcap = out.get("price"), out.get("mcap")
    out["_sh"] = mcap / price if price and mcap else None                                # crore of shares × ₹ = ₹ crore
    out["_bv"] = top.get("bv")
    out["_dps"] = (out["dy"] or 0) * price / 100 if price else None
    # P/E follows screener's own figure: the earnings it implies (market cap ÷ P/E) are kept for the daily refresh
    out["_ebitda"] = ebitda
    out["_pat"] = mcap / top["pe"] if mcap and top.get("pe") and top["pe"] > 0 else (pat if pat is not None and pat <= 0 else pat)
    return out


def derive(r):
    """every price-based number, from the price and the stored bases (the same rules on the weekly and daily runs)."""
    p = r.get("price")
    if p and r.get("_sh"):
        r["mcap"] = r2(p * r["_sh"], 0)
    mcap = r.get("mcap")
    if mcap and r.get("_pat") and r["_pat"] > 0:
        r["pe"] = r2(mcap / r["_pat"], 1)
    elif r.get("_pat") is not None and r["_pat"] <= 0:
        r["pe"] = None
    r["pb"] = r2(p / r["_bv"], 2) if p and r.get("_bv") else None
    r["dy"] = r2(r["_dps"] / p * 100, 2) if p and r.get("_dps") is not None else r.get("dy")
    r["ey"] = r2(100 / r["pe"], 2) if r.get("pe") else None
    ev = (mcap or 0) + (r.get("debt") or 0)
    r["evebitda"] = r2(ev / r["_ebitda"], 1) if mcap and r.get("_ebitda") and r["_ebitda"] > 0 and not r.get("bank") else None
    g = r.get("profit3")
    r["peg"] = r2(r["pe"] / g, 2) if r.get("pe") and g and g > 0 else None
    r["fromhigh"] = r2((p / r["h52"] - 1) * 100, 1) if p and r.get("h52") else None
    if p and r.get("h52") and p > r["h52"]:
        r["h52"] = p
    if p and r.get("l52") and p < r["l52"]:
        r["l52"] = p
    return r


def industry_pe(rows):
    by = {}
    for r in rows:
        if r.get("ind") and r.get("pe") and 0 < r["pe"] < 400:
            by.setdefault(r["ind"], []).append(r["pe"])
    for r in rows:
        v = by.get(r.get("ind")) or []
        r["ipe"] = r2(statistics.median(v), 1) if len(v) >= 3 else None


def fetch_page(sym):
    code = quote(sym.rsplit(".", 1)[0])
    last_err = None
    for path in (f"https://www.screener.in/company/{code}/consolidated/", f"https://www.screener.in/company/{code}/"):
        url = f"{pr.WORKER_URL}/?url={quote(path, safe='')}" if pr.WORKER_URL else path
        try:
            r = pr.http_get(url, headers={"User-Agent": pr.BROWSER_UA, "Accept": "text/html"}, timeout=40, tries=3)
            row = parse_company(r.text, sym)
            if row:
                return row
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(0.4)
    raise RuntimeError(f"no statements ({last_err})" if last_err else "no statements")


def save(rows, meta):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = {"built_at": meta.get("built_at"), "prices_at": meta.get("prices_at"), "index": meta.get("index"),
            "count": len(rows), "fields": FIELDS, "rows": [[r.get(k) for k in FIELDS] for r in rows]}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"saved {len(rows)} companies → {OUT} ({OUT.stat().st_size // 1024} KB)")


def load():
    j = json.loads(OUT.read_text(encoding="utf-8"))
    return [dict(zip(j["fields"], r)) for r in j["rows"]], j


def full(index, limit=None, workers=3):
    syms = pr.index_symbols(index)
    if limit:
        syms = syms[:limit]
    old = {}
    if OUT.exists():
        try:
            old = {r["s"]: r for r in load()[0]}
        except Exception:  # noqa: BLE001
            old = {}
    rows, failed = [], []

    def one(sym):
        try:
            return fetch_page(sym)
        except Exception as e:  # noqa: BLE001
            failed.append(f"{sym}: {str(e)[:80]}")
            return old.get(sym)                       # keep last week's numbers rather than dropping the company
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for k, r in enumerate(ex.map(one, syms), 1):
            if r:
                rows.append(derive(r))
            if k % 50 == 0:
                log(f"{k}/{len(syms)} read")
    industry_pe(rows)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save(rows, {"built_at": now, "prices_at": now, "index": index})
    log(f"{len(rows)} companies, {len(failed)} could not be read" + (": " + "; ".join(failed[:12]) if failed else ""))


def prices(workers=8):
    rows, meta = load()

    def quote_of(r):
        u = f"https://query2.finance.yahoo.com/v8/finance/chart/{quote(r['s'])}?range=5d&interval=1d"
        url = f"{pr.WORKER_URL}/?url={quote(u, safe='')}" if pr.WORKER_URL else u
        try:
            j = pr.http_get(url, headers={"User-Agent": pr.BROWSER_UA}, timeout=30, tries=2).json()
            m = j["chart"]["result"][0]["meta"]
            p = m.get("regularMarketPrice")
            return p if isinstance(p, (int, float)) and p > 0 else None
        except Exception:  # noqa: BLE001
            return None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        ps = list(ex.map(quote_of, rows))
    n = 0
    for r, p in zip(rows, ps):
        if p:
            r["price"] = round(p, 2); n += 1
        derive(r)
    industry_pe(rows)
    meta["prices_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save(rows, meta)
    log(f"prices refreshed for {n}/{len(rows)} companies")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--prices", action="store_true")
    ap.add_argument("--index", default="nifty500")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    if a.full:
        full(a.index, a.limit)
    elif a.prices:
        if not OUT.exists():
            log("no screener data yet — running the full build first")
            full(a.index, a.limit)
        else:
            prices()
    else:
        ap.error("give --full or --prices")


if __name__ == "__main__":
    main()
