"""Grain blocks: roll rule and contracts, quotes, live yields, energy, crosses, news, settles and the sigma fan, options flow, export sales, WASDE, farm inputs.

Split out of update_data.py (Nov 2026). Functions were moved unchanged; update_data.py re-exports every name, so
`import update_data as U; U.<name>` keeps working. The run clock lives in ud_common.NOW (read here as UDC.NOW) so the
live loop can advance it for every module at once.
"""

import argparse, csv, io, json, os, re, statistics, sys, time, traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

import requests

import ud_common as UDC
from ud_common import TOR, UA, WASDE_DATES, _fred, _num, get, iso, recent_release, valet, yahoo_last, yf
from ud_fx import GRAIN_YF, _closes_yf, us_curve


# ------------------------------------------------------------------ desk roll rule
# CBOT grains: first notice day = last business day of the month before the contract month; the desk exits the front one
# business day earlier (hard exit). From the day after the hard exit the contract is gone from the desk: the next month
# becomes the front everywhere (quotes, fan, curve, tiles) and the curve gets the following listed month.
MCODE = "FGHJKMNQUVXZ"
GRAIN_MONTHS = {"corn": "HKNUZ", "wheat": "HKNUZ", "soybeans": "FHKNQUX"}
US_HOL = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-04-02", "2027-05-31", "2027-06-18",
          "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}


def _bday(d):
    return d.weekday() < 5 and d.isoformat() not in US_HOL


def contract_dates(code):
    """('ZSX26') -> (first notice day, hard exit day) as dates."""
    m, y = MCODE.index(code[-3]) + 1, 2000 + int(code[-2:])
    first = datetime(y, m, 1).date()
    d = first - timedelta(days=1)
    while not _bday(d):
        d -= timedelta(days=1)
    fnd = d
    d -= timedelta(days=1)
    while not _bday(d):
        d -= timedelta(days=1)
    return fnd, d


def next_contract(code, grain):
    root, m, y = code[:-3], code[-3], int(code[-2:])
    ms = GRAIN_MONTHS[grain]
    i = ms.index(m)
    return root + (ms[i + 1] + f"{y:02d}" if i + 1 < len(ms) else ms[0] + f"{y + 1:02d}")


def last_trade(code):
    """CBOT grains trade to the business day before the 15th of the contract month."""
    d = datetime(2000 + int(code[-2:]), MCODE.index(code[-3]) + 1, 14).date()
    while not _bday(d):
        d -= timedelta(days=1)
    return d


def archive_pair(D, grain, front, deferred):
    """Keep an expired pair for Spread traceability: it stops being the default at the roll, and its data is kept till it is out."""
    X = D.setdefault("rolls_expired", {}).setdefault(grain, [])
    if any(e["front"] == front for e in X):
        return
    fnd = contract_dates(front)[0]
    X.append({"front": front, "def": deferred, "fnd": fnd.strftime("%a %b %d, %Y"), "last_trade": last_trade(front).isoformat(),
              "rows": list((D.get("rolls_add") or {}).get(grain) or []), "follow": [], "done": False})


def merge_follow(e, front_settles, def_settles, today):
    """Common settle dates of an expired pair, from its FND on; marks the pair done once the front has stopped trading."""
    start = datetime.strptime(e["fnd"], "%a %b %d, %Y").date().isoformat()
    D2 = dict(def_settles)
    rows = {r[0]: r for r in e.get("follow") or []}
    for d, v in front_settles:
        if d >= start and d in D2:
            rows[d] = [d, v, D2[d]]
    e["follow"] = [rows[d] for d in sorted(rows)]
    if today.isoformat() > e["last_trade"]:
        e["done"] = True
    return e


def expired_track(D, N):
    """Once a day after the settle: follow each expired pair till its front is completely out."""
    now = datetime.now(TOR)
    for pair in (("soybeans", "ZSX26", "ZSF27"),):   # the pair already on the desk when collection began
        archive_pair(D, *pair)
    for k, L in (D.get("rolls_expired") or {}).items():
        for e in L:
            if e.get("done") or e.get("checked") == now.date().isoformat() or now.hour < 17:
                continue
            try:
                merge_follow(e, _yahoo_settles(e["front"]), _yahoo_settles(e["def"]), now.date())
                e["checked"] = now.date().isoformat()
            except Exception as ex:
                print(f"  expired pair {e['front']}: kept last copy ({type(ex).__name__})")


def season_contract(grain, y, m):
    """The contract that is front for the whole of month (y, m): the nearest listed month at least two months out (its FND falls after month end)."""
    best = None
    for yy in (y, y + 1):
        for L in GRAIN_MONTHS[grain]:
            k = yy * 12 + MCODE.index(L) + 1
            if k >= y * 12 + m + 2 and (best is None or k < best[0]):
                best = (k, {"corn": "ZC", "wheat": "ZW", "soybeans": "ZS"}[grain] + L + str(yy)[-2:])
    return best[1]


def season_month(closes, y, m):
    """% change over month (y, m) on one contract: its last close of the month against its last close of the month before."""
    py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
    end = [v for d, v in closes if d[:7] == f"{y}-{m:02d}"]
    prev = [v for d, v in closes if d[:7] == f"{py}-{pm:02d}"]
    if not end or not prev:
        return None
    return round((end[-1] / prev[-1] - 1) * 100, 2)


def seasonality_track(D, N):
    """Seasonality grid (BRD G2): seeded once from two years of month-end closes, then one new month added after each month ends."""
    S = D.get("seasonality")
    if not S:
        seed = Path(__file__).with_name("seasonality_seed.json")
        if not seed.exists():
            return
        S = D["seasonality"] = json.loads(seed.read_text(encoding="utf-8"))
    now = datetime.now(TOR)
    y, m = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)   # the month just finished
    key = f"{y}-{m:02d}"
    for g in ("corn", "wheat", "soybeans"):
        G = S.setdefault(g, {})
        if key in G:
            continue
        c = season_contract(g, y, m)
        try:
            v = season_month(_yahoo_settles(c, "3mo"), y, m)
        except Exception as ex:
            print(f"  seasonality {g} {key}: kept last copy ({type(ex).__name__})")
            continue
        if v is not None:
            G[key] = [v, c]


def roll_fronts(D, today=None):
    """Drop fronts past the desk's hard exit; returns [(grain, old, new)]."""
    today = today or UDC.NOW.astimezone(TOR).date()
    done = []
    for k, g in D["grains"].items():
        R = g.get("roll") or []
        while len(R) > 1 and today > contract_dates(R[0]["contract"])[1]:
            old = R.pop(0)
            nxt = next_contract(R[-1]["contract"], k)
            R.append({"contract": nxt, "expiry": datetime(2000 + int(nxt[-2:]), MCODE.index(nxt[-3]) + 1, 1).strftime("%b-%y"),
                      "settle": None, "prev": None, "oi_pct": 0.0})
            (g.get("quotes") or {}).pop(old["contract"], None)
            g["fan"]["settle_date"] = "2000-01-01"   # forces the fan/history rebuild on the new front
            g["fan"].pop("front", None)
            archive_pair(D, k, old["contract"], R[0]["contract"])
            done.append((k, old["contract"], R[0]["contract"]))
        g["roll"] = R
        fnd, hard = contract_dates(R[0]["contract"])
        g["front_dates"] = {"contract": R[0]["contract"], "fnd": fnd.isoformat(), "hard_exit": hard.isoformat()}
    return done


def grains_quote(D, N):
    """Delayed quote of the desk's FRONT contract (e.g. ZSX26), not Yahoo's continuous symbol: ZS=F rolls to the next
    month before the desk does (it showed the January price under ZSX26). Continuous is a fallback only, and only when
    it still tracks the front contract (closer to the front settle than to the deferred settle)."""
    newest = None
    for k, cont in GRAIN_YF.items():
        g = D["grains"][k]
        roll = g.get("roll") or []
        front = roll[0]["contract"] if roll else None
        px = ts = None
        src = None
        if front:
            try:
                px, ts, _ = yahoo_last(f"{front}.CBT")
                src = f"{front}.CBT"
            except Exception as e:
                print(f"  {front}.CBT intraday unavailable ({type(e).__name__}) - checking {cont}")
        if px is None:
            px, ts, _ = yahoo_last(cont)
            src = cont
            if len(roll) > 1 and roll[0].get("settle") and roll[1].get("settle"):
                fs, ds_ = roll[0]["settle"], roll[1]["settle"]
                if abs(px / 100.0 - ds_) < abs(px / 100.0 - fs) and abs(ds_ - fs) > 0.02:
                    raise RuntimeError(f"{cont} has rolled to {roll[1]['contract']} - not shown under {front}")
        sym = src
        px = px / 100.0  # Yahoo quotes grains in cents/bu
        f = g["fan"]
        f["intraday_src"] = src
        if not 0.5 * f["anchor"] < px < 1.5 * f["anchor"]:
            raise RuntimeError(f"{sym} {px} implausible vs settle {f['anchor']}")
        label = ts.astimezone(TOR).strftime("%-I:%M%p").lower() + " ET"
        f["intraday"] = [round(px, 4), label]
        f["intraday_ts"] = iso(ts)
        newest = max(newest or ts, ts)
        option_month_quotes(g)
    D["meta"]["asof"]["grains_quote"] = iso(newest)
    return True


def option_month_quotes(g):
    """Delayed quotes for the futures under the NEAR and FAR option months (e.g. soybeans: Jan-27 options on ZSF27, Mar-27
    on ZSH27) plus the front contract, so every grain sub-tab can show them. One contract failing never fails the block:
    it keeps its last quote, flagged stale, with the original time. Change is vs that contract's own prior settle."""
    Q = g.setdefault("quotes", {})
    roll = {r["contract"]: r for r in (g.get("roll") or []) if r.get("contract")}
    want = []
    for leg in ("near", "far"):
        c = (g.get(leg) or {}).get("contract")
        if c and c not in want:
            want.append(c)
    front = (g.get("roll") or [{}])[0].get("contract")
    if front and front not in want:
        want.insert(0, front)
    for c in want:
        try:
            px, ts, prev = yahoo_last(f"{c}.CBT")
            px /= 100.0
            ref = (roll.get(c) or {}).get("settle")
            if ref and not 0.5 * ref < px < 1.5 * ref:
                raise RuntimeError(f"{c} {px} implausible vs settle {ref}")
            settle = ref if ref else (round(prev / 100.0, 4) if prev else None)
            Q[c] = {"px": round(px, 4), "ts": iso(ts), "label": ts.astimezone(TOR).strftime("%-I:%M%p").lower() + " ET",
                    "settle": settle, "settle_date": (roll.get(c) or {}).get("settle_date"), "src": f"Yahoo {c}.CBT (delayed)"}
        except Exception as e:
            if c in Q:
                Q[c]["stale"] = True
                Q[c]["err"] = f"{type(e).__name__}: {str(e)[:80]}"
            print(f"  {c}.CBT quote unavailable ({type(e).__name__}) - kept last copy" if c in Q else f"  {c}.CBT quote unavailable ({type(e).__name__})")
        else:
            Q[c].pop("stale", None)
            Q[c].pop("err", None)
    for c in [k for k in Q if k not in want]:   # drop contracts that left the near/far window after a roll
        del Q[c]


YIELD_YF = {"3M": "^IRX", "5Y": "^FVX", "10Y": "^TNX", "30Y": "^TYX"}   # Yahoo/CBOE Treasury yield indexes, % (no 2Y index exists)


# Tenors with no live yield index: the move is estimated from a live proxy (futures / federal-bond ETF) scaled by its
# MEASURED sensitivity to that official yield (daily regression, refitted once a day) - never by an assumed duration.
YIELD_PROXY = {("US", "2Y"): "ZT=F", ("CA", "2Y"): "ZFS.TO", ("CA", "5Y"): "ZFM.TO", ("CA", "10Y"): "ZFM.TO", ("CA", "30Y"): "ZFL.TO"}
PROXY_MIN_R2, PROXY_MAX_BP = 0.5, 30.0


def fit_sensitivity(px, yld, n=150):
    """Slope b (bp of yield per 1% proxy return) and R^2 from consecutive common days of a proxy close series and an official
    yield series ({date: value}). Pure, unit-tested. None when fewer than 40 day-pairs."""
    ds = sorted(set(px) & set(yld))
    pairs = [((px[b] / px[a] - 1) * 100, (yld[b] - yld[a]) * 100) for a, b in zip(ds, ds[1:]) if px[a] and px[b] is not None and yld[a] is not None and yld[b] is not None]
    pairs = [p for p in pairs if abs(p[0]) < 5 and abs(p[1]) < 60][-n:]
    if len(pairs) < 40:
        return None
    mx, my = sum(p[0] for p in pairs) / len(pairs), sum(p[1] for p in pairs) / len(pairs)
    sxx = sum((p[0] - mx) ** 2 for p in pairs); sxy = sum((p[0] - mx) * (p[1] - my) for p in pairs); syy = sum((p[1] - my) ** 2 for p in pairs)
    if sxx <= 0 or syy <= 0:
        return None
    b = sxy / sxx
    return {"b": round(b, 3), "r2": round(sxy * sxy / (sxx * syy), 3), "n": len(pairs)}


def _proxy_fits(D):
    """Refit the proxy sensitivities at most once a day (cached in fx.yl_model)."""
    fx = D["fx"]
    M = fx.get("yl_model") or {}
    today = UDC.NOW.astimezone(TOR).date().isoformat()
    if M.get("date") == today and M.get("fit"):
        return M["fit"]
    us = us_curve()
    j = valet("observations/group/bond_yields_benchmark/json?start_date=" + (UDC.NOW - timedelta(days=420)).date().isoformat())
    codes = {}
    for code in j.get("seriesDetail", {}):
        m = re.search(r"\.(\d+)YR\.", code.upper())
        if m:
            codes[m.group(1) + "Y"] = code
        elif "LONG" in code.upper():
            codes["30Y"] = code
    ca = {}
    for o in j["observations"]:
        for t, c in codes.items():
            v = _num((o.get(c) or {}).get("v"))
            if v is not None:
                ca.setdefault(t, {})[o["d"]] = v
    fit = {}
    for (cty, t), sym in YIELD_PROXY.items():
        try:
            h = yf().Ticker(sym).history(period="1y", interval="1d")   # auto-adjusted: ETF distributions do not look like yield moves
            px = {i.date().isoformat(): float(v) for i, v in zip(h.index, h["Close"])}
            yl = {d: v[t] for d, v in us.items() if t in v} if cty == "US" else ca.get(t, {})
            f = fit_sensitivity(px, yl)
            if f:
                fit[f"{cty}{t}"] = dict(f, sym=sym)
        except Exception as e:
            print(f"  proxy fit {cty} {t} ({sym}) failed: {type(e).__name__}: {str(e)[:80]}")
    fx["yl_model"] = {"date": today, "fit": fit, "note": "bp of yield per 1% proxy return, OLS on up to 150 daily changes vs the official yield"}
    print("  proxy fits:", {k: (v["b"], v["r2"]) for k, v in fit.items()})
    return fit


def _proxy_estimate(sym, fit, close, close_date):
    """Live yield estimate = official close + b x proxy return since its prior close. None when the fit is weak, the move is
    implausible, or the official close is already as new as the proxy's latest bar (no double counting after ~6 pm ET)."""
    if not fit or fit["r2"] < PROXY_MIN_R2 or close is None:
        return None
    px, ts, prev = yahoo_last(sym)
    if not prev:
        return None
    if close_date and ts.astimezone(TOR).date().isoformat() <= close_date:
        return None
    dy = fit["b"] * (px / prev - 1) * 100
    if abs(dy) > PROXY_MAX_BP:
        raise RuntimeError(f"{sym} implies {dy:.1f} bp - rejected (roll or bad print?)")
    return {"y": round(close + dy / 100, 3), "ts": iso(ts), "label": ts.astimezone(TOR).strftime("%-I:%M%p").lower() + " ET", "close": close,
            "close_date": close_date, "chg_bp": round(dy, 1), "method": "futures" if sym.endswith("=F") else "etf", "proxy": sym,
            "fit": {"b": fit["b"], "r2": fit["r2"], "n": fit["n"]}, "src": f"estimated from {sym} (delayed) x fitted sensitivity"}


def yields_live(D, N):
    """Delayed intraday US Treasury yields (Yahoo ^IRX/^FVX/^TNX/^TYX, ~10-15 min) on top of the official daily curve.
    Change is in bp vs the latest OFFICIAL close (US Treasury par curve), so the move matches the rest of the desk. A tenor
    that fails, or disagrees with the official close by > 75 bp (wrong symbol / bad print), is left out - never guessed."""
    fx = D["fx"]
    T = fx.get("treasury") or {}
    close_date = (D["meta"]["asof"].get("yields") or "")[:10] or None
    out, newest = dict(fx.get("yields_live") or {}), None
    for t, sym in YIELD_YF.items():
        try:
            y, ts, prev = yahoo_last(sym)
            close = T.get(t)
            basis = "official close"
            if t == "3M" and prev:   # ^IRX is a discount-basis bill rate; Treasury's 3M is bond-equivalent - compare like with like
                close, basis = prev, "prior ^IRX close (discount basis)"
            if close is not None and abs(y - close) > 0.75:
                raise RuntimeError(f"{sym} {y:.3f} vs official {close:.3f} - rejected")
            out[t] = {"y": round(y, 3), "ts": iso(ts), "label": ts.astimezone(TOR).strftime("%-I:%M%p").lower() + " ET",
                      "close": close, "close_date": close_date if basis == "official close" else None, "basis": basis, "chg_bp": round((y - close) * 100, 1) if close is not None else None,
                      "prev_yahoo": round(prev, 3) if prev else None, "src": f"Yahoo {sym} (CBOE yield index, delayed)"}
            newest = max(newest or ts, ts)
        except Exception as e:
            if t in out:
                out[t]["stale"] = True
            print(f"  {sym} live yield unavailable ({type(e).__name__}: {str(e)[:80]})")
        else:
            out[t].pop("stale", None)
    if newest is None:
        raise RuntimeError("no live Treasury yield returned")
    for t in out:
        out[t].setdefault("method", "index")
    # ---- estimated tenors: US 2Y (2-year note futures), Canada 2Y/5Y/10Y/30Y (federal-bond ETFs); US 1Y / 20Y interpolated
    try:
        fits = _proxy_fits(D)
    except Exception as e:
        fits = (fx.get("yl_model") or {}).get("fit") or {}
        print(f"  proxy fits unavailable ({type(e).__name__}: {str(e)[:80]}) - using cached: {list(fits)}")
    R = {r["t"]: r for r in fx.get("rates", [])}
    ca_out = dict(fx.get("yields_live_ca") or {})
    for (cty, t), sym in YIELD_PROXY.items():
        close = T.get(t) if cty == "US" else (R.get(t) or {}).get("ca")
        cdate = close_date if cty == "US" else ((R.get(t) or {}).get("asof") or close_date)
        tgt = out if cty == "US" else ca_out
        try:
            e = _proxy_estimate(sym, fits.get(f"{cty}{t}"), close, cdate)
            if e:
                tgt[t] = e
                newest = max(newest, datetime.fromisoformat(e["ts"]))
            elif t in tgt and tgt[t].get("method") in ("futures", "etf"):
                del tgt[t]                       # weak fit / official close caught up: fall back to the close
        except Exception as ex:
            if t in tgt:
                tgt[t]["stale"] = True
            print(f"  {cty} {t} estimate from {sym} unavailable ({type(ex).__name__}: {str(ex)[:80]})")
    def chg(t):
        v = out.get(t)
        if not v or v.get("stale"):
            return None
        return v["chg_bp"]
    for t, (a_, b_, w) in {"1Y": ("3M", "2Y", (2 - 1) / (2 - 0.25)), "20Y": ("10Y", "30Y", 0.5)}.items():
        ca_, cb_, close = chg(a_), chg(b_), T.get(t)
        if ca_ is not None and cb_ is not None and close is not None:
            dy = w * ca_ + (1 - w) * cb_
            ref = out[a_] if out[a_]["ts"] < out[b_]["ts"] else out[b_]
            out[t] = {"y": round(close + dy / 100, 3), "ts": ref["ts"], "label": ref["label"], "close": close, "close_date": close_date,
                      "chg_bp": round(dy, 1), "method": "interp", "src": f"interpolated from the live {a_} and {b_} moves"}
        elif out.get(t, {}).get("method") == "interp":
            del out[t]
    fx["yields_live_ca"] = ca_out
    ca10 = (ca_out.get("10Y") or {}).get("y") if not (ca_out.get("10Y") or {}).get("stale") else None
    ca10_close = (R.get("10Y") or {}).get("ca")
    if "10Y" in out and (ca10 or ca10_close) is not None:
        leg = ca10 if ca10 is not None else ca10_close
        out["10Y"]["sp_ca"] = round((out["10Y"]["y"] - leg) * 100, 1)   # live US 10Y minus Canada 10Y (estimate, else close)
        out["10Y"]["ca_close"] = ca10_close
        out["10Y"]["ca_leg"] = "est" if ca10 is not None else "close"
    fx["yields_live"] = out
    D["meta"]["asof"]["yields_live"] = iso(newest)
    D["meta"].setdefault("sources", {})["yields_live"] = "Yahoo/CBOE Treasury yield indexes (delayed ~10-15 min); change vs US Treasury official close"
    return True


def energy(D, N):
    fx = D["fx"]
    for e in fx["energy"]:
        sym = {"WTI Crude": "CL=F", "Brent Crude": "BZ=F"}.get(e["name"])
        if not sym:
            continue
        px, ts, prev = yahoo_last(sym)
        e.update(last=round(px, 2), delay="Yahoo, ~10-min delay")
        if prev:
            e.update(chg=round(px - prev, 2), pct=round((px / prev - 1) * 100, 2))
        if e["name"] == "WTI Crude":
            wcs = next((x for x in fx["energy"] if x["name"].startswith("Western")), None)
            if wcs:
                fx["wcs_diff"].update(value=round(px - wcs["last"], 2), obs_ts=ts.isoformat(timespec="seconds"),
                                      note="WTI leg refreshed from Yahoo; WCS leg is the last stored read (different delay)")
        D["meta"]["asof"]["energy"] = iso(ts)
    return True


def crosses(D, N):
    x = D["fx"]["fxcross"]
    dxy, ts, prev = yahoo_last("DX-Y.NYB")
    x.update(dxy=round(dxy, 3), dxy_chg=round((dxy / prev - 1) * 100, 3) if prev else x["dxy_chg"])
    x["eurusd"] = round(yahoo_last("EURUSD=X")[0], 4)
    x["usdjpy"] = round(yahoo_last("JPY=X")[0], 2)
    x["usdcad_ref"] = round(yahoo_last("CAD=X")[0], 4)
    D["meta"]["asof"]["crosses"] = iso(ts)
    return True


NEWS_Q = {
    "corn": "corn futures OR CBOT corn OR corn exports",
    "wheat": "wheat futures OR wheat prices OR wheat exports",
    "soybeans": "soybean futures OR soybeans China OR soybean exports",
    "fx": "Canadian dollar OR loonie OR USD/CAD OR Bank of Canada",
    "geo": "(tariffs OR sanctions OR Black Sea OR export ban OR trade war) (grain OR wheat OR soybeans OR Canada)",
    "macro": "Federal Reserve OR Bank of Canada OR inflation OR jobs report OR GDP Canada OR US economy",
}


def news(D, N):
    old = json.dumps(N, sort_keys=True)
    for key, q in NEWS_Q.items():
        url = f"https://news.google.com/rss/search?q={quote_plus(q + ' when:3d')}&hl=en-CA&gl=CA&ceid=CA:en"
        root = ET.fromstring(get(url).content)
        items, seen = [], set()
        for it in root.iter("item"):
            title, link = it.findtext("title") or "", it.findtext("link") or ""
            src = it.find("source")
            pub = src.text if src is not None and src.text else ""
            dom = urlparse(src.get("url")).netloc if src is not None and src.get("url") else "news.google.com"
            if pub and title.endswith(" - " + pub):
                title = title[: -len(" - " + pub)]
            if title.lower() in seen:
                continue
            seen.add(title.lower())
            try:
                when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
            except Exception:
                continue
            items.append((when, [when.strftime("%Y-%m-%d %H:%M UTC"), dom, title, link]))
        items.sort(key=lambda x: x[0], reverse=True)
        if len(items) >= 3:
            N[key] = [row for _, row in items[:8]]
    if json.dumps(N, sort_keys=True) == old:
        return False  # same headlines — keep the old pull time so we don't commit for nothing
    D["meta"]["asof"]["news"] = iso(UDC.NOW)
    D["meta"].setdefault("sources", {})["news"] = "Google News RSS search, refreshed every 15 min"
    return True


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _set_release(D, key, hist, sub=None):
    """Update one release: last 8 readings; a new period means a fresh print today (consensus unknown)."""
    rel = next(r for r in D["fx"]["releases"] if r["key"] == key)
    period, actual = hist[-1]
    if period != rel["period"]:
        rel.update(period=period, consensus=None,
                   released=datetime.now(TOR).replace(hour=8, minute=30, second=0, microsecond=0).isoformat(timespec="seconds"))
    rel.update(actual=actual, history=[[p, v] for p, v in hist[-8:]])
    if sub is not None:
        rel["sub"]["history"] = [[p, v] for p, v in sub[-8:]]
    return rel


def releases(D, N):
    meta = D["meta"]
    last = meta.get("releases_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=3):
        print("  checked <3h ago — skipping (BLS keyless limit)")
        return False
    # Canada CPI, all-items, NSA index -> y/y %
    j = valet("observations/V41690973/json?recent=24")
    idx = sorted((o["d"], _num(o.get("V41690973", {}).get("v"))) for o in j["observations"])
    idx = [(d, v) for d, v in idx if v is not None]
    byd = dict(idx)
    cpi = []
    for d, v in idx:
        y, m = int(d[:4]), int(d[5:7])
        base = byd.get(f"{y-1}-{m:02d}-01")
        if base:
            cpi.append((f"{MONTHS[m-1]} {y}", round((v / base - 1) * 100, 1)))
    if len(cpi) < 3:
        raise RuntimeError("too few CPI points")
    _set_release(D, "ca_cpi", cpi)
    # US payrolls (level, thousands) -> m/m change; unemployment rate
    r = requests.post("https://api.bls.gov/publicAPI/v1/timeseries/data/", headers={**UA, "Content-Type": "application/json"},
                      data=json.dumps({"seriesid": ["CES0000000001", "LNS14000000"]}), timeout=25)
    r.raise_for_status()
    out = {}
    for ser in r.json()["Results"]["series"]:
        pts = sorted((int(x["year"]), int(x["period"][1:]), _num(x["value"])) for x in ser["data"]
                     if x["period"].startswith("M") and x["period"] != "M13" and _num(x["value"]) is not None)
        out[ser["seriesID"]] = pts
    lv, ur = out["CES0000000001"], out["LNS14000000"]
    def consecutive(a, b):
        return (b[0] * 12 + b[1]) - (a[0] * 12 + a[1]) == 1
    nfp = [(f"{MONTHS[m-1]} {y}", int(round(v - lv[i-1][2]))) for i, (y, m, v) in enumerate(lv)
           if i > 0 and consecutive(lv[i-1], (y, m))]
    urh = [(f"{MONTHS[m-1]} {y}", v) for y, m, v in ur]
    _set_release(D, "us_nfp", nfp, urh)
    meta["releases_checked"] = iso(UDC.NOW)
    newest = max(D["fx"]["releases"], key=lambda x: x["released"])["released"]
    meta["asof"]["releases"] = newest
    return True


# ------------------------------------------------------------------ settles -> sigma fan + curve
def _yahoo_settles(sym, period="9mo"):
    """Daily settles for one contract (Yahoo 'ZCZ26.CBT'); today's bar only once the day session has settled."""
    h = yf().Ticker(f"{sym}.CBT").history(period=period, interval="1d")
    if h.empty:
        raise RuntimeError(f"no daily bars for {sym}.CBT")
    now = datetime.now(TOR)
    out = []
    for idx, row in h.iterrows():
        d = idx.date()
        if d > now.date() or (d == now.date() and not (17 <= now.hour < 20)):
            continue  # today's bar: only 5pm-8pm ET (at 3pm the bar can still be the last trade, not the settlement); after 8pm it is the overnight session
        out.append((d.isoformat(), round(float(row["Close"]) / 100.0, 4)))  # cents -> $/bu
    return out


def _fan_from(settles):
    t = [v for _, v in settles]
    diffs = [t[i] - t[i-1] for i in range(1, len(t))]
    sig = statistics.stdev(diffs[-30:])
    a = t[-1]
    ma = lambda n, i=None: sum(t[:i][-n:] if i else t[-n:]) / n
    ma20, ma50 = ma(20), ma(50)
    ma100 = ma(100) if len(t) >= 100 else None
    z = (a - ma20) / statistics.stdev(t[-20:])
    w5, w10 = sig * 5 ** .5, sig * 10 ** .5
    hist = []
    for j in range(len(t) - 25, len(t)):
        hist.append({"d": settles[j][0] + "T00:00:00", "s": t[j],
                     "ma20": round(sum(t[j-19:j+1]) / 20, 4), "ma50": round(sum(t[j-49:j+1]) / 50, 4)})
    return {"anchor": a, "sig": sig, "settle_date": settles[-1][0],
            "r5": [round(a - 1.96*w5, 2), round(a + 1.96*w5, 2)], "r10": [round(a - 1.96*w10, 2), round(a + 1.96*w10, 2)],
            "r10_99": [round(a - 2.576*w10, 2), round(a + 2.576*w10, 2)],
            "z": f"{z:.2f}", "ma20": f"{ma20:.2f}", "ma50": f"{ma50:.2f}", "ma100": (f"{ma100:.2f}" if ma100 else None)}, hist, t[-50:]


def settles(D, N):
    done, errs = [], {}
    for k, g in D["grains"].items():
        try:   # one grain's bad source must not hold the other two back
            front = g["roll"][0]["contract"]
            st_ = _yahoo_settles(front)
            if len(st_) < 76:
                raise RuntimeError(f"{front}: only {len(st_)} settles")
            # verify the source against the desk's verified settles before trusting it
            # the newest stored day may have been captured before the settlement was final -> it is re-read, not used as proof
            mine = {h["d"][:10]: h["s"] for h in g["history"]} if g["fan"].get("front", front) == front and g["fan"].get("settle_date") != "2000-01-01" else {}   # new front after a roll: nothing to verify against
            newest = max(mine) if mine else ""
            both = [(mine[d], v) for d, v in st_ if d in mine and d != newest]
            if mine and len(both) < 5:
                raise RuntimeError(f"{front}: only {len(both)} dates overlap the verified history")
            worst = max((abs(a - b) for a, b in both), default=0)
            if worst > 0.0101:
                raise RuntimeError(f"{front}: source differs from verified settles by up to {worst:.4f} — not used")
            if st_[-1][0] <= g["fan"]["settle_date"] and g["fan"].get("ma50") and abs(dict(st_).get(newest, mine.get(newest, 0)) - mine.get(newest, 0)) < 1e-9:
                continue  # nothing new
            fan, hist, tail = _fan_from(st_)
            g["fan"].update(fan)
            g["fan"]["front"] = front
            g["history"], g["tail50"] = hist, tail
            # curve: front + next two contracts
            for leg in g["roll"]:
                try:
                    ls = _yahoo_settles(leg["contract"], "1mo")
                    if ls:
                        leg["prev"] = ls[-2][1] if len(ls) > 1 else leg.get("settle")
                        leg["settle"], leg["settle_date"] = round(ls[-1][1], 4), ls[-1][0]
                except Exception as e:
                    print(f"  curve leg {leg['contract']} skipped: {e}")
            # forward months for the Prices tab: the roll legs plus every following listed month with a settle, up to 12 (settles only)
            try:
                curve, code = [], g["roll"][0]["contract"]
                for i in range(12):
                    leg = next((r for r in g["roll"] if r["contract"] == code), None)
                    if leg and leg.get("settle") is not None:
                        curve.append({"contract": code, "settle": leg["settle"], "prev": leg.get("prev"), "settle_date": leg.get("settle_date")})
                    else:
                        try:
                            ls = _yahoo_settles(code, "1mo")
                            if ls:
                                curve.append({"contract": code, "settle": round(ls[-1][1], 4), "prev": ls[-2][1] if len(ls) > 1 else None, "settle_date": ls[-1][0]})
                        except Exception as e:
                            print(f"  forward month {code} skipped: {e}")
                    code = next_contract(code, k)
                g["curve"] = curve
            except Exception as e:
                print(f"  forward months {k} skipped: {e}")
            done.append(f"{k} {fan['settle_date']} {fan['anchor']}")
        except Exception as e:
            errs[k] = str(e)[:200]
            print(f"  settles {k}: {e}")
    if errs and not done:
        raise RuntimeError("; ".join(errs.values()))
    if not done:
        return False
    last_settle = max(g["fan"]["settle_date"] for g in D["grains"].values())
    D["meta"]["asof"]["grains_settle"] = datetime.fromisoformat(last_settle + "T14:20:00").replace(tzinfo=TOR).isoformat()
    print("  settles:", done)
    return True


# ------------------------------------------------------------------ options flow & expiration intelligence (daily tier)
def _yahoo_hl(sym, period="2mo"):
    """{date: (high, low, close)} for completed sessions of one CBOT contract ($/bu)."""
    h = yf().Ticker(f"{sym}.CBT").history(period=period, interval="1d")
    now = datetime.now(TOR)
    out = {}
    for idx, row in h.iterrows():
        d = idx.date()
        if d > now.date() or (d == now.date() and not (17 <= now.hour < 20)):
            continue
        out[d.isoformat()] = (round(float(row["High"]) / 100, 4), round(float(row["Low"]) / 100, 4), round(float(row["Close"]) / 100, 4))
    return out


def optflow(D, N):
    import optflow as OF
    prev_all = D.get("optflow") or {}
    out, errs = {}, {}
    for k, g in D["grains"].items():
        try:
            front = g["roll"][0]["contract"]
            try:
                hl = _yahoo_hl(front)
            except Exception as e:
                hl, errs[k + "_hl"] = {}, str(e)[:120]
            # settlements from the desk's own (verified) history win over the bar's close
            for h in g.get("history") or []:
                d = h["d"][:10]
                hl[d] = (hl[d][0], hl[d][1], h["s"]) if d in hl else (None, None, h["s"])
            prev = prev_all.get(k)
            if not prev or not prev.get("hist"):   # first run: seed the record book from the stored IV history
                setl = {h["d"][:10]: h["s"] for h in g.get("history") or []}
                seed = []
                for row in g.get("vol_hist") or []:
                    d, iv = row[0], row[1]
                    if d in setl and iv:
                        S = setl[d]; em = S * iv / 100 * (1 / 252) ** 0.5
                        seed.append({"d": d, "s": S, "iv": iv, "em": round(em, 4), "lo": round(S - em, 4), "hi": round(S + em, 4), "seeded": True})
                prev = {"hist": seed}
            out[k] = OF.build_grain(g, hl, UDC.NOW, prev)
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:200]
            if k in prev_all:
                out[k] = prev_all[k]
    if not out:
        raise RuntimeError(f"optflow failed: {errs}")
    D["optflow"] = out
    D["meta"]["asof"]["optflow"] = iso(UDC.NOW)
    if errs:
        D["meta"]["optflow_errors"] = errs
    else:
        D["meta"].pop("optflow_errors", None)
    return True


# ------------------------------------------------------------------ USDA export sales (needs FAS_API_KEY)
FAS = "https://api.fas.usda.gov/api/esr"   # key goes in the X-Api-Key header
ESR_MATCH = {"corn": ["corn"], "soybeans": ["soybeans"], "wheat": ["all wheat", "wheat - all", "wheat"]}


_ESR_COUNTRIES = {}


def _destinations(rows, H):
    """Latest week by destination: net sales, prior week, MY commitments and shipments (metric tons)."""
    if not _ESR_COUNTRIES:
        for c in get(f"{FAS}/countries", headers=H).json():
            nm = (c.get("countryDescription") or c.get("countryName") or "").strip()
            _ESR_COUNTRIES[str(c.get("countryCode"))] = nm.title() if nm.isupper() else nm
    weeks = sorted({r_["weekEndingDate"][:10] for r_ in rows})
    if not weeks:
        return None
    cur, prev = weeks[-1], (weeks[-2] if len(weeks) > 1 else None)
    by = {}
    for r_ in rows:
        d = r_["weekEndingDate"][:10]
        if d not in (cur, prev):
            continue
        name = _ESR_COUNTRIES.get(str(r_.get("countryCode")), str(r_.get("countryCode")))
        x = by.setdefault(name, {"country": name, "net": 0, "prev": 0, "commit": 0, "shipped": 0, "outstanding": 0, "ship_wk": 0})
        if d == cur:
            x["net"] += r_.get("currentMYNetSales") or 0
            x["commit"] += r_.get("currentMYTotalCommitment") or 0
            x["shipped"] += r_.get("accumulatedExports") or 0
            x["outstanding"] += r_.get("outstandingSales") or 0
            x["ship_wk"] += r_.get("weeklyExports") or 0
        else:
            x["prev"] += r_.get("currentMYNetSales") or 0
    allc = list(by.values())
    tot = {k: sum(x[k] for x in allc) for k in ("net", "prev", "commit", "shipped", "outstanding", "ship_wk")}
    top_week = sorted([x for x in allc if x["net"] > 0], key=lambda x: -x["net"])[:10]
    top_my = sorted(allc, key=lambda x: -x["commit"])[:10]
    rnd = lambda x: {k: (round(v) if isinstance(v, (int, float)) else v) for k, v in x.items()}
    return {"week": cur, "prev_week": prev, "total": rnd(tot),
            "top_week": [rnd(x) for x in top_week], "top_my": [rnd(x) for x in top_my]}


def exports(D, N):
    import os
    key = os.environ.get("FAS_API_KEY", "").strip()
    if not key:
        print("  FAS_API_KEY not set — export sales stay manual")
        return False
    meta = D["meta"]
    last = meta.get("exports_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6) and not recent_release(D, "exports"):
        print("  checked <6h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    comms = get(f"{FAS}/commodities", headers=H).json()
    try:
        latest_my = {str(x.get("commodityCode")): int(x["marketYear"]) for x in get(f"{FAS}/datareleasedates", headers=H).json() if x.get("marketYear")}
    except Exception:
        latest_my = {}
    E = D.setdefault("exports", {})
    changed = []
    for k, names in ESR_MATCH.items():
        ex = E.get(k)
        if not ex:
            continue
        cand = [c for n in names for c in comms if n == c.get("commodityName", "").strip().lower()] or \
               [c for n in names for c in comms if n in c.get("commodityName", "").strip().lower()]
        if not cand:
            raise RuntimeError(f"no ESR commodity matches {names}")
        stored = {w[0]: w[2] for w in ex["weeks"]}
        best = None
        for c in cand[:3]:
            years = [latest_my[str(c["commodityCode"])]] if str(c["commodityCode"]) in latest_my else []
            for my in years + [y for y in (UDC.NOW.year + 1, UDC.NOW.year) if y not in years]:
                try:
                    rows = get(f"{FAS}/exports/commodityCode/{c['commodityCode']}/allCountries/marketYear/{my}", headers=H).json()
                except Exception:
                    continue
                wk = {}
                for r_ in rows:
                    d = r_["weekEndingDate"][:10]
                    wk[d] = wk.get(d, 0) + (r_.get("currentMYNetSales") or 0)
                if not wk:
                    continue
                overlap = [(stored[d], v) for d, v in wk.items() if d in stored and stored[d]]
                err = max((abs(v - s_) / abs(s_) for s_, v in overlap), default=9)
                if best is None or err < best[0]:
                    best = (err, c["commodityName"], my, wk, rows)
        if not best or best[0] > 0.02:
            raise RuntimeError(f"{k}: USDA figures don't match the stored weeks (best error {best[0] if best else 'n/a'}) — not used")
        _, cname, my, wk, rows = best
        try:
            ex["dest"] = _destinations(rows, H)
        except Exception as e:
            print(f"  {k} destinations skipped: {e}")
        cons = {w[0]: (w[3], w[4]) for w in ex["weeks"]}
        weeks = sorted(wk.items())[-10:]
        ex["weeks"] = [[d, (datetime.fromisoformat(d) + timedelta(days=7)).date().isoformat(), round(v),
                        *cons.get(d, (None, None))] for d, v in weeks]
        ys = [w[2] for w in ex["weeks"]]
        n = len(ys); xm = (n - 1) / 2; ym = sum(ys) / n
        b = sum((i - xm) * (y - ym) for i, y in enumerate(ys)) / sum((i - xm) ** 2 for i in range(n))
        a0 = ym - b * xm
        ex["trend"] = [b, a0, a0 + b * (n - 1)]
        ex["source"] = f"USDA FAS ESR · {cname} · MY {my - 1}/{str(my)[2:]}"
        changed.append(k)
    meta["exports_checked"] = iso(UDC.NOW)
    if changed:
        meta["asof"]["exports"] = iso(UDC.NOW)
    print("  exports refreshed:", changed)
    return bool(changed)


# ------------------------------------------------------------------ WASDE U.S. S&D (USDA PSD API)
PSD = "https://api.fas.usda.gov/api/psd"
PSD_CODE = {"corn": "0440000", "soybeans": "2222000", "wheat": "0410000"}
BU_PER_MT = {"corn": 39.3679, "soybeans": 36.7437, "wheat": 36.7437}
HA_TO_AC = 2.47105
# dashboard rows -> how to read them from PSD attribute names (lower-case)
SD_ROWS = {
    "corn": [("Area Planted", None), ("Area Harvested", "area harvested"), ("Yield per Acre", "yield"),
             ("Beginning Stocks", "beginning stocks"), ("Production", "production"), ("Imports", "imports"),
             ("Total Supply", "total supply"), ("Feed & Residual", "feed dom. consumption"),
             ("Food, Seed & Industrial", "fsi consumption"), ("Domestic Total", "domestic consumption"),
             ("Exports", "exports"), ("Total Use", "=dom+exp"), ("Ending Stocks", "ending stocks"), ("Avg Farm Price", None)],
    "soybeans": [("Area Planted", None), ("Area Harvested", "area harvested"), ("Yield per Acre", "yield"),
                 ("Beginning Stocks", "beginning stocks"), ("Production", "production"), ("Imports", "imports"),
                 ("Total Supply", "total supply"), ("Crushings", "crush"), ("Exports", "exports"),
                 ("Seed & Residual", "=dom-crush"), ("Total Use", "=dom+exp"), ("Ending Stocks", "ending stocks"), ("Avg Farm Price", None)],
    "wheat": [("Area Planted", None), ("Area Harvested", "area harvested"), ("Yield per Acre", "yield"),
              ("Beginning Stocks", "beginning stocks"), ("Production", "production"), ("Imports", "imports"),
              ("Total Supply", "total supply"), ("Food, Seed & Industrial", "fsi consumption"),
              ("Feed & Residual", "feed dom. consumption"), ("Domestic Total", "domestic consumption"),
              ("Exports", "exports"), ("Total Use", "=dom+exp"), ("Ending Stocks", "ending stocks"), ("Avg Farm Price", None)],
}


def _psd_us(code, year, H, k):
    rows = get(f"{PSD}/commodity/{code}/country/US/year/{year}", headers=H).json()
    if not rows:
        raise RuntimeError(f"PSD {code} {year}: no rows")
    if not _PSD_REF:
        _PSD_REF["attr"] = {str(a["attributeId"]): (a.get("attributeName") or "").strip().lower() for a in get(f"{PSD}/commodityAttributes", headers=H).json()}
        _PSD_REF["unit"] = {str(u["unitId"]): (u.get("unitDescription") or "").strip().lower() for u in get(f"{PSD}/unitsOfMeasure", headers=H).json()}
    latest_month = max((int(r_.get("month") or 0) for r_ in rows), default=0)
    _LAST_PSD["names"] = sorted({_PSD_REF["attr"].get(str(r_.get("attributeId")), str(r_.get("attributeId"))) + "|" + _PSD_REF["unit"].get(str(r_.get("unitId")), str(r_.get("unitId"))) for r_ in rows})
    _LAST_PSD["sample"] = rows[:2]
    v = {}
    for r_ in rows:
        if latest_month and int(r_.get("month") or 0) != latest_month:
            continue
        name = _PSD_REF["attr"].get(str(r_.get("attributeId")), "")
        unit = _PSD_REF["unit"].get(str(r_.get("unitId")), "")
        val = float(r_.get("value") or 0)
        if "mt/ha" in unit:
            val = val * BU_PER_MT[k] / HA_TO_AC               # MT/HA -> bu/acre (check before HA)
        elif "ha)" in unit or unit.endswith("ha"):
            val = val * HA_TO_AC / 1000                       # 1000 HA -> million acres
        elif "1000 mt" in unit or "(1000 mt)" in unit:
            val = val * BU_PER_MT[k] / 1000                   # 1000 MT -> million bushels
        if name.startswith("my ") or name.startswith("ty "):  # PSD prefixes: MY/TY Imports, MY/TY Exports
            if name.startswith("ty "):
                continue
            name = name[3:]
        v[name] = val
    return v


_PSD_REF = {}
_LAST_PSD = {}


def _sd_values(k, raw):
    out = {}
    def find(key):
        for n, val in raw.items():
            if n == key:
                return val
        for n, val in raw.items():
            if n.startswith(key) or key in n:
                return val
        return None
    dom, crush, exp = find("domestic consumption"), find("crush"), find("exports")
    for label, src in SD_ROWS[k]:
        if src is None:
            out[label] = None
        elif src == "=dom+exp":
            out[label] = (dom + exp) if dom is not None and exp is not None else None
        elif src == "=dom-crush":
            out[label] = (dom - crush) if dom is not None and crush is not None else None
        else:
            out[label] = find(src)
    rnd = lambda lab, x: None if x is None else (round(x, 1) if lab.startswith(("Area", "Yield")) else round(x))
    return {lab: rnd(lab, x) for lab, x in out.items()}


def wasde(D, N):
    import os
    key = os.environ.get("FAS_API_KEY", "").strip()
    if not key:
        return False
    meta = D["meta"]
    last = meta.get("wasde_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6) and not recent_release(D, "wasde"):
        print("  checked <6h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    # a report only counts once its 12:00 ET release time has passed — not from midnight of release day
    latest = max(d for d in WASDE_DATES if datetime.fromisoformat(d + "T12:00").replace(tzinfo=TOR) <= UDC.NOW)
    label = datetime.fromisoformat(latest).strftime("%b %Y")
    W = D.get("wasde") or {}
    changed, pending = [], False
    for k, code in PSD_CODE.items():
        w = W.get(k)
        if not w:
            continue
        new_my = int(w["new"]["my"][:4]); old_my = new_my - 1
        cur = {}
        for crop, yr in (("new", new_my), ("old", old_my)):
            vals = _sd_values(k, _psd_us(code, yr, H, k))
            stored = {row[0]: row[2] for row in w[crop]["rows"]}
            for lab in ("Production", "Area Harvested"):        # sanity: same crop year, same units
                a, b = vals.get(lab), stored.get(lab)
                if a is None or not b or abs(a / b - 1) > (0.08 if lab == "Production" else 0.05):
                    names = sorted(_LAST_PSD.get("names", []))
                    raise RuntimeError(f"{k} {crop} {yr}: PSD {lab} {a} vs stored {b} — not used; PSD lines: {names}"[:900])
            cur[crop] = vals
        same_month = (w.get("report") == label)
        if not same_month:
            # a new month is taken only when USDA's PSD actually carries it: if every line still equals the stored report,
            # PSD has not been updated yet — keep the old month and look again on the next run (no "Nov" label on Oct numbers)
            stale = all(cur[c].get(r[0]) == r[2] for c in ("new", "old") for r in w[c]["rows"] if cur[c].get(r[0]) is not None)
            if stale:
                print(f"  {k}: PSD not yet updated for {label} — holding {w.get('report')}")
                pending = True
                continue
        for crop in ("new", "old"):
            rows = []
            for lab, prior, current, *_ in w[crop]["rows"]:
                nv = cur[crop].get(lab)
                if nv is None and lab in ("Area Planted", "Avg Farm Price"):
                    nv = None  # not in PSD: shown as "—" for the new month until a WASDE drop-in
                if same_month:                     # revision of the current report
                    rows.append([lab, prior, nv if nv is not None else current])
                else:                              # new report: current becomes prior
                    rows.append([lab, current, nv])
            w[crop]["rows"] = rows
        if not same_month:
            w["prior_report"], w["report"] = w["report"], label
        w["source"] = "USDA PSD (FAS Open Data) · converted from metric to U.S. units"
        changed.append(k)
    if not pending:
        meta["wasde_checked"] = iso(UDC.NOW)   # while a new report is still pending in PSD, keep checking every run
    if changed:
        meta["asof"]["wasde"] = iso(UDC.NOW)
    print("  wasde:", changed, label)
    return bool(changed)


def sd_hist(D, N):
    """US balance sheets for the last four marketing years (latest USDA estimate of each) for the crop-year comparison table."""
    import os
    key = os.environ.get("FAS_API_KEY", "").strip()
    if not key:
        return False
    meta = D["meta"]
    last = meta.get("sd_hist_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=24) and D.get("sd_hist"):
        print("  checked <24h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    out, errs = {}, {}
    for k, code in PSD_CODE.items():
        w = (D.get("wasde") or {}).get(k)
        new_my = int(w["new"]["my"][:4]) if w else UDC.NOW.year
        yrs = {}
        for yr in range(new_my - 3, new_my + 1):
            try:
                vals = _sd_values(k, _psd_us(code, yr, H, k))
                if not vals.get("Production"):
                    raise RuntimeError("no production line")
                yrs[str(yr)] = vals
            except Exception as e:
                errs[f"{k} {yr}"] = str(e)[:160]
        if yrs:
            out[k] = {"years": yrs, "my_label": {y: f"{y}/{str(int(y) + 1)[2:]}" for y in yrs},
                      "units": "mil acres · bu/acre · mil bu", "source": "USDA PSD (FAS Open Data), latest estimate per marketing year"}
    if not out:
        raise RuntimeError(f"no PSD history: {errs}")
    D["sd_hist"] = out
    meta["sd_hist_checked"] = iso(UDC.NOW)
    meta["asof"]["sd_hist"] = iso(UDC.NOW)
    if errs:
        meta["sd_hist_errors"] = errs
    else:
        meta.pop("sd_hist_errors", None)
    print("  sd_hist:", {k: list(v["years"]) for k, v in out.items()}, "errors", len(errs))
    return True


# ------------------------------------------------------------------ farm input costs (fertilizer, chemicals, energy)
INPUT_FRED = [
    # key, label, FRED id, unit, kind
    ("ulsd", "Diesel (ULSD, NY Harbor)", "DDFUELNYH", "$/gal", "energy"),
    ("natgas", "Natural gas (Henry Hub)", "DHHNGSP", "$/MMBtu", "energy"),
    ("propane", "Propane (Mont Belvieu)", "DPROPANEMBTX", "$/gal", "energy"),
    ("wti", "Crude oil (WTI)", "DCOILWTICO", "$/bbl", "energy"),
    ("ppi_n", "Nitrogen fertilizer PPI (nitrogenates)", "WPU065201", "index", "fert"),
    ("ppi_p", "Phosphate fertilizer PPI", "WPU065202", "index", "fert"),
    ("ppi_fert", "All fertilizer materials PPI", "WPS0652", "index", "fert"),
    ("ppi_chem", "Pesticide & ag-chemical PPI (herbicides, fungicides)", "PCU325320325320", "index", "chem"),
]
WB_COLS = {"urea": ("Urea", r"^urea"), "dap": ("DAP", r"^dap"), "potash": ("Potash (potassium chloride)", r"^potassium chloride"),
           "tsp": ("TSP (triple superphosphate)", r"^tsp")}


def _weekly(points):
    """Daily -> last observation of each ISO week (keeps 2+ years small)."""
    wk = {}
    for d, v in points:
        y, w, _ = datetime.fromisoformat(d).isocalendar()
        wk[(y, w)] = (d, v)
    return [wk[k] for k in sorted(wk)]


def _worldbank_monthly():
    """World Bank 'Pink Sheet' monthly prices workbook (urea, DAP, potash, TSP in $/mt); the file URL changes monthly, so discover it."""
    import openpyxl
    page = get("https://www.worldbank.org/en/research/commodity-markets").text
    m = re.search(r'href="([^"]+CMO-Historical-Data-Monthly\.xlsx)"', page)
    if not m:
        raise RuntimeError("monthly workbook link not found on the World Bank page")
    url = m.group(1) if m.group(1).startswith("http") else "https://www.worldbank.org" + m.group(1)
    wb = openpyxl.load_workbook(io.BytesIO(requests.get(url, headers=UA, timeout=90).content), read_only=True, data_only=True)
    ws = wb["Monthly Prices"]
    rows = list(ws.iter_rows(values_only=True))
    hdr_i = next(i for i, r_ in enumerate(rows[:12]) if r_ and any(isinstance(c, str) and c.strip().lower().startswith("urea") for c in r_))
    hdr = [str(c or "").strip() for c in rows[hdr_i]]
    cols = {}
    for key, (_, pat) in WB_COLS.items():
        ci = next((i for i, h in enumerate(hdr) if re.search(pat, h.lower())), None)
        if ci is not None:
            cols[key] = ci
    out = {k: [] for k in cols}
    for r_ in rows[hdr_i + 1:]:
        lab = str(r_[0] or "")
        mm = re.match(r"^(\d{4})M(\d{2})$", lab)
        if not mm:
            continue
        d = f"{mm.group(1)}-{mm.group(2)}-01"
        for k, ci in cols.items():
            v = _num(r_[ci]) if ci < len(r_) else None
            if v is not None:
                out[k].append((d, v))
    return out, url


def inputs(D, N):
    meta = D["meta"]
    last = meta.get("inputs_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=12) and D.get("inputs"):
        print("  checked <12h ago — skipping")
        return False
    start = (UDC.NOW - timedelta(days=31 * 30)).date().isoformat()     # ~2.5 years
    I = {"series": {}, "errors": {}}
    for key, label, sid, unit, kind in INPUT_FRED:
        try:
            pts = _fred(sid, start)
            if len(pts) < 10:
                raise RuntimeError("too few points")
            if (datetime.fromisoformat(pts[1][0]) - datetime.fromisoformat(pts[0][0])).days < 7:
                pts = _weekly(pts)
            I["series"][key] = {"label": label, "unit": unit, "kind": kind, "src": f"FRED {sid}", "pts": [[d[:10], round(v, 4)] for d, v in pts]}
        except Exception as e:
            I["errors"][key] = f"{type(e).__name__}: {e}"[:200]
    try:
        wbm, url = _worldbank_monthly()
        for key, pts in wbm.items():
            pts = [p for p in pts if p[0] >= start]
            if len(pts) >= 6:
                I["series"][key] = {"label": WB_COLS[key][0], "unit": "$/mt", "kind": "fert", "src": "World Bank Pink Sheet", "pts": [[d, round(v, 2)] for d, v in pts]}
        I["wb_url"] = url
    except Exception as e:
        I["errors"]["worldbank"] = f"{type(e).__name__}: {e}"[:300]
    if not I["series"]:
        raise RuntimeError(f"no input series: {I['errors']}")
    old = D.get("inputs") or {}
    for k, v in (old.get("series") or {}).items():       # keep last good copy of anything that failed today
        I["series"].setdefault(k, v)
    I["events"] = old.get("events", [])                    # curated, sourced event labels (edited by hand)
    D["inputs"] = I
    meta["inputs_checked"] = iso(UDC.NOW)
    meta["asof"]["inputs"] = iso(UDC.NOW)
    print("  inputs:", sorted(I["series"]), "errors:", I["errors"])
    return True


def grain_long(D, N):
    """~18 months of daily bars per grain for the interactive price chart (chunk 5): Yahoo continuous front month
    (ZC=F / ZW=F / ZS=F, $/bu). It rolls to the next contract, so it is a reference series, not one executable contract.
    Refreshed once per day after the close (or when missing)."""
    G = D.get("grain_long") or {}
    today = datetime.now(TOR).date().isoformat()
    if G.get("other") and (G.get("day") == today and datetime.now(TOR).hour < 15 or (G.get("day") == today and G.get("after_close"))):
        return
    out = {}
    for k, sym in GRAIN_YF.items():
        h = yf().Ticker(sym).history(period="18mo", interval="1d")
        rows = []
        for idx, r in h.iterrows():
            if r["Close"] != r["Close"]:
                continue
            rows.append([idx.date().isoformat(), round(float(r["Open"]) / 100, 4), round(float(r["High"]) / 100, 4), round(float(r["Low"]) / 100, 4),
                         round(float(r["Close"]) / 100, 4), int(r["Volume"]) if r["Volume"] == r["Volume"] else None])
        if len(rows) > 30:
            out[k] = rows
    if not out:
        raise RuntimeError("no grain history from Yahoo")
    # other markets for the macro-release window (daily closes, same 18 months)
    other = {}
    for k, (sym, sc) in {"usdcad": ("CAD=X", 1.0), "wti": ("CL=F", 1.0), "us10y": ("^TNX", 1.0), "dxy": ("DX-Y.NYB", 1.0)}.items():
        try:
            other[k] = [[d, round(v, 5)] for d, v in sorted(_closes_yf(sym, "18mo", sc).items())]
        except Exception as e:
            print(f"  grain_long: {k} failed: {e}")
    D["grain_long"] = {"other": other, "day": today, "after_close": datetime.now(TOR).hour >= 15, "asof": UDC.NOW.isoformat(timespec="seconds"),
                       "src": "Yahoo Finance continuous front month (ZC=F, ZW=F, ZS=F), daily bars, $/bu", "series": out,
                       "wasde": sorted(WASDE_DATES)}
    print("  grain_long:", {k: len(v) for k, v in out.items()})
