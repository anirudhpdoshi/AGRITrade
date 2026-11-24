#!/usr/bin/env python3
"""Five-year daily closes for every Market pulse tile (owner, Nov 24 2026) -> history.json on the `history` branch.

Sources (all free, no key):
  Yahoo Finance daily bars  — grains (continuous front month), USD/CAD, DXY, crude, nat gas, metals, copper, VIX
  FRED (St. Louis Fed) CSV  — US Treasury constant-maturity yields 3M…30Y, Fed funds target range
  Bank of Canada Valet API  — Government of Canada 2Y / 10Y benchmark yields, BoC policy rate
Spreads (US–CA 2Y/10Y, 2s10s, Brent–WTI) are computed from the same dates. The page draws the chart and the
20/50/100/200-day moving averages from these closes; nothing here is estimated.
Run: python scripts/history.py [--dry-run]
"""
import csv, io, json, os, subprocess, sys, urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = str(UDC.ROOT)
WT = os.path.join(ROOT, ".history-wt")
YEARS = 5
YAHOO = {   # tile key: (yahoo symbol, name, decimals)
    "corn": ("ZC=F", "Corn (CBOT, continuous front month, $/bu)", 4), "soybeans": ("ZS=F", "Soybeans (CBOT, continuous front month, $/bu)", 4),
    "wheat": ("ZW=F", "Wheat (CBOT, continuous front month, $/bu)", 4), "usdcad": ("CAD=X", "USD/CAD", 4), "dxy": ("DX-Y.NYB", "US Dollar Index (DXY)", 2),
    "wti": ("CL=F", "WTI crude (NYMEX front month, $/bbl)", 2), "brent": ("BZ=F", "Brent crude (ICE front month, $/bbl)", 2), "natgas": ("NG=F", "Natural gas (Henry Hub, $/MMBtu)", 3),
    "gold": ("GC=F", "Gold (COMEX, $/oz)", 1), "silver": ("SI=F", "Silver (COMEX, $/oz)", 3), "platinum": ("PL=F", "Platinum (NYMEX, $/oz)", 1),
    "palladium": ("PA=F", "Palladium (NYMEX, $/oz)", 1), "copper": ("HG=F", "Copper (COMEX, $/lb)", 4), "vix": ("^VIX", "VIX (S&P 500 implied volatility)", 2),
}
FRED = {"3M": "DGS3MO", "1Y": "DGS1", "2Y": "DGS2", "5Y": "DGS5", "10Y": "DGS10", "20Y": "DGS20", "30Y": "DGS30", "fed_hi": "DFEDTARU", "fed_lo": "DFEDTARL"}
VALET = {"ca2y": "BD.CDN.2YR.DQ.YLD", "ca10y": "BD.CDN.10YR.DQ.YLD", "boc": "V39079"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (desk history; contact via repo)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def yahoo(sym):
    h = UDC.yf().Ticker(sym).history(period=f"{YEARS}y", interval="1d", auto_adjust=False)["Close"].dropna()
    return [[d.strftime("%Y-%m-%d"), round(float(v), 6)] for d, v in h.items() if float(v) == float(v)]


def fred(sid, start):
    t = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}")
    out = []
    for row in csv.reader(io.StringIO(t)):
        if len(row) < 2 or not row[0][:4].isdigit():
            continue
        try:
            out.append([row[0], round(float(row[1]), 4)])
        except ValueError:
            pass   # '.' = no observation that day
    return out


def valet(sid, start):
    j = json.loads(get(f"https://www.bankofcanada.ca/valet/observations/{sid}/json?start_date={start}"))
    out = []
    for o in j.get("observations", []):
        v = (o.get(sid) or {}).get("v")
        try:
            out.append([o["d"], round(float(v), 4)])
        except (TypeError, ValueError):
            pass
    return out


def diff(a, b, mult=1.0, nd=2):   # a − b on common dates
    B = dict(b)
    return [[d, round((v - B[d]) * mult, nd)] for d, v in a if d in B]


def main():
    start = (datetime.now(timezone.utc) - timedelta(days=365 * YEARS + 10)).strftime("%Y-%m-%d")
    S, errs = {}, {}
    for k, (sym, name, dec) in YAHOO.items():
        try:
            S[k] = {"name": name, "src": f"Yahoo Finance {sym} daily close", "dec": dec, "unit": "", "d": yahoo(sym)}
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:160]
    for k, sid in FRED.items():
        try:
            S["ust" + k if not k.startswith("fed") else k] = {"name": ("US Treasury " + k + " constant-maturity yield (%)") if not k.startswith("fed") else ("Fed funds target, " + ("upper" if k == "fed_hi" else "lower") + " bound (%)"),
                                                            "src": f"FRED {sid}", "dec": 3 if not k.startswith("fed") else 2, "unit": "%", "d": fred(sid, start)}
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:160]
    for k, sid in VALET.items():
        try:
            S[k] = {"name": {"ca2y": "Government of Canada 2Y benchmark yield (%)", "ca10y": "Government of Canada 10Y benchmark yield (%)", "boc": "Bank of Canada policy rate (%)"}[k],
                    "src": f"Bank of Canada Valet {sid}", "dec": 3 if k != "boc" else 2, "unit": "%", "d": valet(sid, start)}
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:160]
    # derived
    if "ust2Y" in S and "ust10Y" in S:
        S["s2s10s"] = {"name": "US 2s10s curve (10Y − 2Y, bp)", "src": "FRED DGS10 − DGS2", "dec": 1, "unit": "bp", "d": diff(S["ust10Y"]["d"], S["ust2Y"]["d"], 100, 1)}
    if "ust2Y" in S and "ca2y" in S:
        S["usca2y"] = {"name": "US − Canada 2Y yield gap (bp)", "src": "FRED DGS2 − BoC 2Y", "dec": 1, "unit": "bp", "d": diff(S["ust2Y"]["d"], S["ca2y"]["d"], 100, 1)}
    if "ust10Y" in S and "ca10y" in S:
        S["usca10y"] = {"name": "US − Canada 10Y yield gap (bp)", "src": "FRED DGS10 − BoC 10Y", "dec": 1, "unit": "bp", "d": diff(S["ust10Y"]["d"], S["ca10y"]["d"], 100, 1)}
    if "brent" in S and "wti" in S:
        S["brentwti"] = {"name": "Brent − WTI spread ($/bbl)", "src": "Yahoo BZ=F − CL=F", "dec": 2, "unit": "$", "d": diff(S["brent"]["d"], S["wti"]["d"], 1, 2)}
    if "copper" in S and "gold" in S:
        S["cugold"] = {"name": "Copper/gold ratio (×1000)", "src": "Yahoo HG=F ÷ GC=F", "dec": 3, "unit": "", "d": [[d, round(v / g * 1000, 4)] for (d, v), g in ((x, dict(S["gold"]["d"]).get(x[0])) for x in S["copper"]["d"]) if g]}
    for k, v in S.items():
        print(f"{k:10s} {len(v['d']):5d} pts  {v['d'][0][0] if v['d'] else '-'} → {v['d'][-1][0] if v['d'] else '-'}")
    for k, e in errs.items():
        print(f"! {k}: {e}")
    if not S:
        raise SystemExit("nothing fetched")
    body = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "years": YEARS, "series": S, "errors": errs}
    if "--dry-run" in sys.argv:
        return
    publish(body)
    print("published history.json to the history branch")


def sh(*a, cwd=None, check=True):
    return subprocess.run(list(a), cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-history-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=ROOT)
    sh("rm", "-rf", WT, check=False); sh("git", "worktree", "prune", cwd=ROOT, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "history", cwd=ROOT, check=False).returncode == 0
    if exists:
        sh("git", "fetch", "-q", "--depth", "1", "origin", "history:refs/remotes/origin/history", cwd=ROOT, check=False)
        sh("git", "worktree", "add", "-f", "-B", "history", WT, "origin/history", cwd=ROOT)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=ROOT)
        sh("git", "checkout", "-q", "--orphan", "history", cwd=WT); sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "history.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "history.json", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "history: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "history", cwd=WT)


if __name__ == "__main__":
    main()
