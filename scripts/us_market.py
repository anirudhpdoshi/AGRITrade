#!/usr/bin/env python3
"""US market seasonality -> market.json on the `earnings` branch (read by the US Earnings tab).

Five-year monthly-return heatmap for the Dow Jones Industrial Average (^DJI), Nasdaq Composite (^IXIC) and Russell 2000
(^RUT). Source: Yahoo Finance daily closes (free, keyless — the desk's existing provider), reduced to month-end closes.
Index levels are PRICE indices: dividends are excluded, and the page says so.

  monthly return  = month-end close / previous month-end close − 1      (January uses the prior December close)
  annual return   = December close / prior December close − 1           (compounded, never an average of months)
  5-year average  = arithmetic mean of that calendar month across the five complete years
The current year is shown as YTD beside the matrix and is excluded from every average.

No FMP calls. The live header (last, change, status) comes from world.json, which the World tab already refreshes.
Usage: python scripts/us_market.py [--dry-run]
"""
import json, os, subprocess, sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH, FILE, WT = "earnings", "market.json", "/tmp/market-wt"
INDICES = {"dji": ("^DJI", "Dow Jones Industrial Average"), "ixic": ("^IXIC", "Nasdaq Composite"), "rut": ("^RUT", "Russell 2000")}
YEARS = 5
FLAT = 0.25          # |monthly return| below this (in %) reads as "flat" in the summary


SECTORS = {"XLK": "Technology", "XLC": "Communication Services", "XLY": "Consumer Discretionary", "XLP": "Consumer Staples", "XLE": "Energy",
           "XLF": "Financials", "XLV": "Health Care", "XLI": "Industrials", "XLB": "Materials", "XLRE": "Real Estate", "XLU": "Utilities"}
INDEX_PERIODS = {"^GSPC": "S&P 500", "^NDX": "Nasdaq 100", "^IXIC": "Nasdaq Composite", "^DJI": "Dow Jones", "^RUT": "Russell 2000"}


# ---------------------------------------------------------------- pure functions (unit-tested, no network)
def period_returns(rows):
    """[(YYYY-MM-DD, close)] daily -> % change of the last close against each period's base close.
    day = previous session; week = last close before this ISO week; month / qtd / ytd = last close before that period began.
    A period whose base close is not in the history is None, never estimated."""
    rows = sorted(r for r in rows if r[1] is not None)
    if not rows:
        return None
    from datetime import date
    last_d, last = rows[-1]
    y, m, d = map(int, last_d.split("-"))
    wk = date(y, m, d).isocalendar()[:2]
    q0 = f"{y}-{(m - 1) // 3 * 3 + 1:02d}-01"

    def base(test):
        c = [r[1] for r in rows[:-1] if test(r[0])]
        return c[-1] if c else None
    return {"date": last_d, "last": last, "day": pct(last, rows[-2][1]) if len(rows) > 1 else None,
            "week": pct(last, base(lambda x: date(*map(int, x.split("-"))).isocalendar()[:2] < wk)),
            "month": pct(last, base(lambda x: x < last_d[:7] + "-01")), "qtd": pct(last, base(lambda x: x < q0)),
            "ytd": pct(last, base(lambda x: x < f"{y}-01-01")), "closes": [round(r[1], 4) for r in rows[-60:]]}


def sma_above(closes, n):
    return None if len(closes) < n else closes[-1] > sum(closes[-n:]) / n


def breadth_row(sym, sector, rows):
    """One constituent's line in the breadth table; 52-week flags compare the last close with the prior 251 closes."""
    r = period_returns(rows)
    if not r:
        return None
    c = [x[1] for x in sorted(rows) if x[1] is not None]
    prior = c[-252:-1]
    rnd = lambda v: None if v is None else round(v, 2)
    return {"s": sym, "x": sector, "d": r["date"], "l": round(r["last"], 2), "day": rnd(r["day"]), "week": rnd(r["week"]), "month": rnd(r["month"]), "ytd": rnd(r["ytd"]),
            "a20": sma_above(c, 20), "a50": sma_above(c, 50), "a200": sma_above(c, 200),
            "nh": bool(len(prior) >= 200 and c[-1] > max(prior)), "nl": bool(len(prior) >= 200 and c[-1] < min(prior))}


def latest_fact(facts, tags):
    """Newest balance-sheet value over several possible tags (earlier tag wins a tie): (end, val, form, filed)."""
    best = None
    for t in tags:
        for f in usd(facts, t):
            if best is None or f["end"] > best["end"]:
                best = f
    return (best["end"], best["val"], best.get("form"), best.get("filed")) if best else None


def usd(facts, tag):
    return (facts.get(tag) or {}).get("units", {}).get("USD") or []


def days_between(a, b):
    from datetime import date
    return (date(*map(int, b.split("-"))) - date(*map(int, a.split("-")))).days


def quarterly(entries):
    """Cash-flow facts are year-to-date in 10-Qs -> {YYYY-MM quarter end: value}. A ~3-month fact is used as is; otherwise
    the year-to-date figure less the same-start year-to-date figure one quarter earlier. No base, no value."""
    ded = {}
    for f in entries:
        if f.get("start"):
            ded[(f["start"], f["end"])] = f["val"]
    out = {}
    for (st, en), v in ded.items():
        n = days_between(st, en)
        if 80 <= n <= 100:
            out[en[:7]] = v
    for (st, en), v in ded.items():
        n = days_between(st, en)
        if n <= 100 or n > 380 or en[:7] in out:
            continue
        prev = [k for k in ded if k[0] == st and 70 <= days_between(k[1], en) <= 110]
        if prev:
            out[en[:7]] = v - ded[prev[0]]
    return out


def merged_quarterly(facts, tags):
    out = {}
    for t in tags:
        for k, v in quarterly(usd(facts, t)).items():
            out.setdefault(k, v)
    return out


WALL = ["InNextTwelveMonths", "InYearTwo", "InYearThree", "InYearFour", "InYearFive", "AfterYearFive"]


def maturity_wall(facts):
    """Principal due by bucket from the newest report that gives all six buckets; otherwise None."""
    maps = [{f["end"]: f for f in usd(facts, "LongTermDebtMaturitiesRepaymentsOfPrincipal" + w)} for w in WALL]
    ends = set(maps[0])
    for m in maps[1:]:
        ends &= set(m)
    if not ends:
        return None
    e = max(ends)
    return {"end": e, "b": [m[e]["val"] for m in maps], "filed": maps[0][e].get("filed")}


def month_end_closes(rows):
    """[(YYYY-MM-DD, close)] daily -> {YYYY-MM: last close of that month}."""
    out = {}
    for d, c in sorted(rows):
        if c is not None:
            out[d[:7]] = c
    return out


def pct(a, b):
    return None if a is None or b in (None, 0) else (a / b - 1) * 100


def seasonality(me, years, current_ym):
    """Heatmap matrix for `years` (complete calendar years) plus YTD for the current year.
    `current_ym` is the running month; it is incomplete and never counted."""
    def ret(y, m):
        k, pk = f"{y}-{m:02d}", (f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}")
        if k >= current_ym:
            return None
        return pct(me.get(k), me.get(pk))
    grid = {y: [ret(y, m) for m in range(1, 13)] for y in years}
    annual = {y: pct(me.get(f"{y}-12"), me.get(f"{y - 1}-12")) for y in years}
    avg = []
    for m in range(12):
        v = [grid[y][m] for y in years if grid[y][m] is not None]
        avg.append({"mean": sum(v) / len(v) if v else None, "n": len(v), "pos": sum(1 for x in v if x > 0),
                    "min": min(v) if v else None, "max": max(v) if v else None})
    an = [annual[y] for y in years if annual[y] is not None]
    cy = int(current_ym[:4])
    ytd_m = [ret(cy, m) for m in range(1, 13)]
    last_full = max((k for k in me if k < current_ym), default=None)
    ytd = pct(me.get(last_full), me.get(f"{cy - 1}-12")) if last_full and last_full[:4] == str(cy) else None
    cells = [(grid[y][m], y, m) for y in years for m in range(12) if grid[y][m] is not None]
    means = [(a["mean"], m) for m, a in enumerate(avg) if a["mean"] is not None]
    return {
        "years": years, "grid": {str(y): grid[y] for y in years}, "annual": {str(y): annual[y] for y in years},
        "avg": avg, "avg_annual": sum(an) / len(an) if an else None,
        "ytd": {"year": cy, "months": ytd_m, "total": ytd, "through": last_full},
        "summary": {
            "best_cell": max(cells)[:3] if cells else None, "worst_cell": min(cells)[:3] if cells else None,
            "best_avg_month": max(means)[1] if means else None, "worst_avg_month": min(means)[1] if means else None,
            "positive_share": (sum(1 for c in cells if c[0] > 0) / len(cells)) if cells else None,
            "flat_cells": sum(1 for c in cells if abs(c[0]) < FLAT), "cells": len(cells),
        },
    }


# ---------------------------------------------------------------- network + publish
def fetch(sym, start):
    import yfinance as yf
    h = yf.Ticker(sym).history(start=start, interval="1d", auto_adjust=False)
    return [(i.strftime("%Y-%m-%d"), float(c)) for i, c in zip(h.index, h["Close"]) if c == c]


def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-earnings-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v)
    sh("git", "worktree", "prune", check=False)
    sh("git", "fetch", "-q", "origin", BRANCH, check=False)
    if sh("git", "rev-parse", "--verify", "-q", "FETCH_HEAD", check=False).returncode == 0 and \
            sh("git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False).returncode == 0:
        sh("git", "worktree", "add", "-f", "--detach", WT, "FETCH_HEAD")
    else:
        sh("git", "worktree", "add", "-f", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", BRANCH, cwd=WT)
        sh("git", "rm", "-rqf", ".", cwd=WT, check=False)
    with open(os.path.join(WT, FILE), "w") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    sh("git", "add", FILE, cwd=WT)
    if sh("git", "diff", "--cached", "--quiet", cwd=WT, check=False).returncode == 0:
        print("no change"); return
    sh("git", "commit", "-qm", "us market " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "origin", f"HEAD:{BRANCH}", cwd=WT)
    print("published")


CONSTITUENTS = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
PREV = "https://raw.githubusercontent.com/anirudhpdoshi/AGRITrade/earnings/market.json"
ISSUERS = {"full": ["MSFT", "GOOGL", "AMZN", "META", "ORCL", "NVDA"], "native": ["CRWV", "APLD", "CORZ", "IREN"]}
DEBT = ["LongTermDebt", "DebtInstrumentCarryingAmount", "DebtLongtermAndShorttermCombinedAmount", "LongTermDebtNoncurrent"]
ISSUE = ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt", "ProceedsFromIssuanceOfSeniorLongTermDebt", "ProceedsFromNotesPayable", "ProceedsFromConvertibleNotesPayable"]
EQUITY = ["ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceInitialPublicOffering"]
INTEREST = ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating"]


def get_url(u, headers=None):
    import urllib.request
    h = {"User-Agent": "Mozilla/5.0 (desk market job)", "Accept-Encoding": "identity"}
    h.update(headers or {})
    with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=40) as r:
        return r.read()


def build_breadth():
    import csv, io
    import yfinance as yf
    rows = list(csv.DictReader(io.StringIO(get_url(CONSTITUENTS).decode())))
    sec = {r["Symbol"]: r["GICS Sector"] for r in rows}
    yahoo = {s.replace(".", "-"): s for s in sec}
    d = yf.download(list(yahoo), start=(datetime.now(timezone.utc) - timedelta(days=400)).strftime("%Y-%m-%d"), end=(datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d"), interval="1d", auto_adjust=False, progress=False, threads=4)["Close"]
    out = []
    for y, s in yahoo.items():
        if y not in d:
            continue
        col = d[y].dropna()
        r = breadth_row(s, sec[s], [(i.strftime("%Y-%m-%d"), float(v)) for i, v in col.items()])
        if r:
            out.append(r)
    dates = [r["d"] for r in out]
    date = max(set(dates), key=dates.count) if dates else None
    out = [r for r in out if r["d"] == date]   # a stale or partial symbol is left out and counted, never mixed in
    return {"date": date, "listed": len(sec), "rows": out} if len(out) >= 400 else None


def build_northbook(now):
    contact = os.environ.get("SEC_CONTACT", "").strip()
    if not contact:
        raise RuntimeError("SEC_CONTACT missing")
    ua = {"User-Agent": "AGRITrade desk " + contact}
    tick = {v["ticker"]: v["cik_str"] for v in json.loads(get_url("https://www.sec.gov/files/company_tickers.json", ua)).values()}
    out = []
    for scope, names in ISSUERS.items():
        for s in names:
            if s not in tick:
                continue
            try:
                f = json.loads(get_url(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{tick[s]:010d}.json", ua))["facts"].get("us-gaap", {})
            except Exception as e:
                print(f"! {s}: {e}")
                continue
            debt = latest_fact(f, DEBT)
            iq = merged_quarterly(f, INTEREST)
            ik = sorted(iq)[-4:]
            ttm = sum(iq[k] for k in ik) if len(ik) == 4 else None
            q0 = f"{now.year - 3}-01"
            out.append({"s": s, "scope": scope, "debt": debt and debt[1], "debt_end": debt and debt[0], "filed": debt and debt[3], "ttm_int": ttm,
                        "wall": maturity_wall(f), "iss": {k: v for k, v in merged_quarterly(f, ISSUE).items() if k >= q0},
                        "eq": {k: v for k, v in merged_quarterly(f, EQUITY).items() if k >= q0}})
            import time
            time.sleep(0.2)
    return {"fetched": now.strftime("%Y-%m-%d"), "issuers": out} if out else None


def main():
    now = datetime.now(timezone.utc)
    cur = now.strftime("%Y-%m")
    years = list(range(now.year - YEARS, now.year))
    start = f"{years[0] - 1}-12-01"
    out, health = {}, {}
    for k, (sym, name) in INDICES.items():
        try:
            rows = fetch(sym, start)
            me = month_end_closes(rows)
            out[k] = dict(seasonality(me, years, cur), symbol=sym, name=name, last_close_date=rows[-1][0] if rows else None,
                          month_end=me)
            health[k] = {"ok": True, "rows": len(rows)}
        except Exception as e:
            health[k] = {"ok": False, "error": str(e)[:160]}
            print(f"! {sym}: {e}")
    periods = {"indexes": [], "sectors": []}
    for bucket, names in (("indexes", INDEX_PERIODS), ("sectors", SECTORS)):
        for sym, name in names.items():
            try:
                r = period_returns(fetch(sym, f"{now.year - 1}-12-01"))
                if r:
                    periods[bucket].append(dict(r, sym=sym, name=name))
            except Exception as e:
                print(f"! {sym}: {e}")
    try:
        prev = json.loads(get_url(PREV))
    except Exception:
        prev = {}
    # US Markets is on demand (owner, Nov 10 2026): no background per-stock loading. S&P 500 breadth (~500 stocks) and the
    # Northbook issuer set are no longer built; the functions stay for reference. Index, sector-ETF and seasonality data stay.
    breadth, nb = None, None
    body = {"updated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "provider": "Yahoo Finance daily closes (delayed, free)",
            "basis": "Price return — index levels, dividends excluded. Month-end close to month-end close; annual = Dec close to prior Dec close.",
            "seasonality": out, "periods": periods, "breadth": breadth, "northbook": nb, "health": health}
    if "--dry-run" in sys.argv:
        for k, v in out.items():
            print(k, "annual", {y: round(r, 1) for y, r in v["annual"].items() if r is not None}, "ytd", v["ytd"]["total"] and round(v["ytd"]["total"], 1))
        return
    if not out:
        sys.exit("no index history fetched")
    publish(body)


if __name__ == "__main__":
    main()
