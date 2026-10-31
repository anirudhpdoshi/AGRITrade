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
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH, FILE, WT = "earnings", "market.json", "/tmp/market-wt"
INDICES = {"dji": ("^DJI", "Dow Jones Industrial Average"), "ixic": ("^IXIC", "Nasdaq Composite"), "rut": ("^RUT", "Russell 2000")}
YEARS = 5
FLAT = 0.25          # |monthly return| below this (in %) reads as "flat" in the summary


# ---------------------------------------------------------------- pure functions (unit-tested, no network)
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
    body = {"updated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "provider": "Yahoo Finance daily closes (delayed, free)",
            "basis": "Price return — index levels, dividends excluded. Month-end close to month-end close; annual = Dec close to prior Dec close.",
            "seasonality": out, "health": health}
    if "--dry-run" in sys.argv:
        for k, v in out.items():
            print(k, "annual", {y: round(r, 1) for y, r in v["annual"].items() if r is not None}, "ytd", v["ytd"]["total"] and round(v["ytd"]["total"], 1))
        return
    if not out:
        sys.exit("no index history fetched")
    publish(body)


if __name__ == "__main__":
    main()
