#!/usr/bin/env python3
"""US market cap tracker (owner, Nov 20 2026) -> mcap.json

The listed-company universe is the S&P 500 (about 80% of US listed market value). For every constituent:
  market cap(t) = shares outstanding (Yahoo, refreshed weekly) x official daily close(t)
Shares are held constant over the window, so the change in market cap is the price effect on today's share count
(buybacks and issuance inside the window are not counted) — the same convention as index weights between rebalances.

Output:
  weekly    — Mon–Fri weeks: total market cap at each week's last close, $ and % change on the prior week
  daily     — total market cap per session (last ~65 sessions)
  movers    — top 10 companies by $ market cap gained and lost over the last week (5 sessions) and month (21 sessions);
              share classes of one company (Alphabet A/C, Fox, News Corp) are combined
  sectors   — GICS sector $ change over the week and the month
Run:  python scripts/mcap.py [--dry-run]
"""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = UDC.ROOT
OUT = os.path.join(ROOT, "mcap.json")
CACHE = os.path.join(ROOT, "scripts", "data", "mcap_universe.json")
SHARES_MAX_AGE = 7 * 86400


def strip(x):
    x = re.sub(r"<[^>]+>", "", x)
    return re.sub(r"\s+", " ", x.replace("&amp;", "&").replace("&#39;", "'").replace("&nbsp;", " ")).strip()


def sp500():
    """[(symbol, company, sector)] from Wikipedia's S&P 500 constituents table"""
    req = urllib.request.Request("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", headers={"User-Agent": "AGRITrade desk (market cap)"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    t = html[html.index('id="constituents"'):]
    t = t[:t.index("</table>")]
    out = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        c = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
        if len(c) < 3:
            continue
        sym = strip(c[0]).replace(".", "-")
        if re.fullmatch(r"[A-Z][A-Z\-]{0,6}", sym):
            out.append((sym, strip(c[1]), strip(c[2])))
    if not 480 <= len(out) <= 520:
        raise ValueError(f"constituents table looks wrong ({len(out)} rows)")
    return out


def company(name):
    """one company across share classes: 'Alphabet Inc. (Class A)' -> 'Alphabet Inc.'"""
    return re.sub(r"\s*\((?:Class|Series) [A-Z]\)\s*$", "", name).strip()


def load_cache():
    try:
        return json.load(open(CACHE))
    except Exception:
        return {}


def shares_for(sym):
    for k in range(3):
        try:
            fi = UDC.yf().Ticker(sym).fast_info
            v = fi["shares"]
            if v and v > 0:
                return float(v)
        except Exception:
            time.sleep(1 + k)
    return None


def universe():
    """constituents + shares, refreshed weekly; the cached copy is used if a refresh fails"""
    C = load_cache()
    fresh = C.get("at") and time.time() - C["at"] < SHARES_MAX_AGE and C.get("rows")
    if fresh:
        return C
    try:
        rows = sp500()
        src = "Wikipedia S&P 500 constituents"
    except Exception as e:
        print(f"! constituents unavailable ({type(e).__name__}: {e}); using cache")
        if C.get("rows"):
            return C
        raise
    old = {r["s"]: r.get("sh") for r in C.get("rows", [])}
    with ThreadPoolExecutor(max_workers=12) as ex:
        sh = list(ex.map(shares_for, [r[0] for r in rows]))
    out = []
    for (s, n, sec), v in zip(rows, sh):
        v = v or old.get(s)
        out.append({"s": s, "n": n, "co": company(n), "sec": sec, "sh": v})
    miss = [r["s"] for r in out if not r["sh"]]
    if miss:
        print(f"  shares unavailable for {len(miss)}: {', '.join(miss[:20])}")
    C = {"at": time.time(), "asof": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "src": src, "rows": out}
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(C, open(CACHE, "w"), indent=0)
    return C


def closes(syms):
    """{sym: [(date, close)]} official daily closes, last ~8 months"""
    out = {}
    for i in range(0, len(syms), 100):
        part = syms[i:i + 100]
        d = UDC.yf().download(part, period="8mo", interval="1d", group_by="ticker", auto_adjust=False, progress=False, threads=True)
        for s in part:
            try:
                c = d[s]["Close"].dropna() if len(part) > 1 else d["Close"].dropna()
                out[s] = [(x.strftime("%Y-%m-%d"), float(v)) for x, v in c.items()]
            except Exception:
                pass
    return out


def r1(x, n=1):
    return None if x is None else round(x, n)


def main():
    U = universe()
    rows = [r for r in U["rows"] if r.get("sh")]
    px = closes([r["s"] for r in rows])
    # the session calendar: dates on which at least 90% of the universe printed a close
    cnt = {}
    for s in px:
        for d, _ in px[s]:
            cnt[d] = cnt.get(d, 0) + 1
    print("  closes per date (last 4):", [(d, cnt[d]) for d in sorted(cnt)[-4:]], "of", len(rows))
    days = sorted(d for d, n in cnt.items() if n >= 0.9 * len(rows))
    # the newest session counts once most of the universe has printed (intraday Yahoo bars arrive symbol by symbol);
    # the few still missing carry their last close forward, as for any gap
    lastd = max(cnt) if cnt else None
    if lastd and lastd not in days and cnt[lastd] >= 0.6 * len(rows):
        days.append(lastd)
    if len(days) < 30:
        raise SystemExit(f"too few sessions ({len(days)})")
    # each company's cap on each session; a missing close carries the last one forward
    cap = {}
    for r in rows:
        ser = dict(px.get(r["s"], []))
        if not ser:
            continue
        last, v = None, []
        for d in days:
            last = ser.get(d, last)
            v.append(None if last is None else last * r["sh"])
        cap[r["s"]] = v
    used = [r for r in rows if r["s"] in cap and cap[r["s"]][-1] is not None]
    tot = [sum(cap[r["s"]][k] or 0 for r in used) for k in range(len(days))]

    # Mon–Fri weeks, at each week's last session
    wk = {}
    for k, d in enumerate(days):
        dt = datetime.strptime(d, "%Y-%m-%d")
        wk[(dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")] = k
    W = sorted(wk.items())
    weekly = []
    for j, (w, k) in enumerate(W):
        if j == 0:
            continue
        p = tot[W[j - 1][1]]
        weekly.append({"wk": w, "end": days[k], "cap": round(tot[k] / 1e9, 1), "chg": round((tot[k] - p) / 1e9, 1),
                       "pct": r1((tot[k] / p - 1) * 100, 2), "sessions": sum(1 for d in days if wk.get(w) is not None and d >= w and d <= days[k])})

    def movers(n):
        b = len(days) - 1 - n
        if b < 0:
            return None
        co = {}
        for r in used:
            v0, v1 = cap[r["s"]][b], cap[r["s"]][-1]
            if v0 is None or v1 is None:
                continue
            c = co.setdefault(r["co"], {"co": r["co"], "syms": [], "sec": r["sec"], "v0": 0.0, "v1": 0.0})
            c["syms"].append(r["s"]); c["v0"] += v0; c["v1"] += v1
        L = [{"co": c["co"], "syms": c["syms"], "sec": c["sec"], "cap": round(c["v1"] / 1e9, 1), "chg": round((c["v1"] - c["v0"]) / 1e9, 1),
              "pct": r1((c["v1"] / c["v0"] - 1) * 100, 2)} for c in co.values() if c["v0"]]
        L.sort(key=lambda x: x["chg"])
        t0 = tot[b]
        sec = {}
        for r in used:
            v0, v1 = cap[r["s"]][b], cap[r["s"]][-1]
            if v0 is None or v1 is None:
                continue
            z = sec.setdefault(r["sec"], [0.0, 0.0, 0])
            z[0] += v0; z[1] += v1; z[2] += 1
        S = sorted([{"sec": k, "cap": round(v[1] / 1e9, 1), "chg": round((v[1] - v[0]) / 1e9, 1), "pct": r1((v[1] / v[0] - 1) * 100, 2), "n": v[2]}
                    for k, v in sec.items() if v[0]], key=lambda x: -x["chg"])
        up = sum(1 for x in L if x["chg"] > 0)
        return {"from": days[b], "to": days[-1], "sessions": n, "total_from": round(t0 / 1e9, 1), "total_to": round(tot[-1] / 1e9, 1),
                "chg": round((tot[-1] - t0) / 1e9, 1), "pct": r1((tot[-1] / t0 - 1) * 100, 2), "gainers": L[::-1][:10], "losers": L[:10],
                "up": up, "down": len(L) - up, "companies": len(L), "sectors": S}

    ny = datetime.now(ZoneInfo("America/New_York"))
    intraday = days[-1] == ny.strftime("%Y-%m-%d") and (ny.hour, ny.minute) < (16, 15)   # today's bar is still trading
    body = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "asof": days[-1], "intraday": intraday,
            "universe": {"name": "S&P 500 constituents", "listed": len(U["rows"]), "used": len(used), "src": U.get("src"), "shares_asof": U.get("asof")},
            "method": "Market cap = shares outstanding (Yahoo, refreshed weekly) × official daily close (Yahoo, delayed). Shares held constant across the window, so changes are price-driven.",
            "total": round(tot[-1] / 1e9, 1), "weekly": weekly[-26:],
            "daily": [{"d": d, "cap": round(v / 1e9, 1)} for d, v in list(zip(days, tot))[-65:]],
            "periods": {"week": movers(5), "month": movers(21)}}
    if "--dry-run" in sys.argv:
        print(json.dumps({k: body[k] for k in ("asof", "universe", "total")}))
        print("weekly", [(w["end"], w["chg"], w["pct"]) for w in body["weekly"][-6:]])
        for k, p in body["periods"].items():
            print(k, p["from"], "->", p["to"], p["chg"], p["pct"], "top", [(g["co"], g["chg"]) for g in p["gainers"][:3]], "bottom", [(g["co"], g["chg"]) for g in p["losers"][:3]])
        return
    json.dump(body, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote mcap.json — {len(used)} companies, total ${body['total']:,}bn as of {days[-1]}")


if __name__ == "__main__":
    main()
