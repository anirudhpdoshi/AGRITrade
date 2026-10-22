#!/usr/bin/env python3
"""Refresh data.json for the Grain & USD/CAD desk.

Run by .github/workflows/refresh-data.yml every 15 minutes on weekdays.
Each source is patched independently: if one feed is down or changes shape,
its block keeps the previous values (and its old as-of time, so the page's
freshness pill goes amber/red) while every other block still updates.

What it refreshes                         Source (all free, no key)
  fx.feed (USD/CAD mid)                    Yahoo Finance CAD=X, ~delayed
  fx.closes, fx.spot.ref, fx.levels        Bank of Canada Valet FXUSDCAD + Yahoo prior-day OHLC (pivot)
  fx.rates, fx.treasury, fx.widest         US Treasury daily par curve + BoC Valet benchmark yields
  fx.policy.corra_now                      BoC Valet V39079 (target for the overnight rate)
  fx.pos (CAD leveraged funds)             CFTC TFF futures-only (Socrata gpe5-46if)
  grains.*.cftc (managed money)            CFTC disaggregated futures-only (Socrata 72hh-3qpy)
  grains.*.fan.intraday                    Yahoo ZC=F / ZW=F / ZS=F, delayed
  fx.energy (WTI, Brent), fx.wcs_diff      Yahoo CL=F / BZ=F (WCS leg stays as stored)
  fx.fxcross                               Yahoo DX-Y.NYB, EURUSD=X, JPY=X, CAD=X
  NEWS                                     Google News RSS search
Left as stored (no free source / model output): grain settlements & fan math,
options chains, roll, export sales, Fed odds, CORRA futures, retail sentiment,
FX options, forecast/scenarios/bias, trade template, calendar.

Usage:  python scripts/update_data.py [--only fx_spot,news] [--dry-run]
"""
import argparse, csv, io, json, re, statistics, sys, traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data.json"
TOR = ZoneInfo("America/Toronto")
UA = {"User-Agent": "usd-cad-desk-live/1.0 (+https://github.com/anirudhpdoshi/usd-cad-desk-live)"}
NOW = datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(TOR).isoformat(timespec="seconds")


def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=25, **kw)
    r.raise_for_status()
    return r


def yf():
    import yfinance  # imported lazily so non-Yahoo blocks still run if it's missing
    return yfinance


def yahoo_last(symbol, interval="5m"):
    """(last price, bar time UTC, previous close) from Yahoo intraday bars."""
    t = yf().Ticker(symbol)
    h = t.history(period="2d", interval=interval)
    if h.empty:
        raise RuntimeError(f"no bars for {symbol}")
    last_ts = h.index[-1].to_pydatetime().astimezone(timezone.utc)
    d = t.history(period="7d", interval="1d")
    prev = None
    if len(d) >= 2:
        # previous session's close = the last daily bar dated before the latest bar's date
        days = [i for i in d.index if i.date() < h.index[-1].date()]
        prev = float(d.loc[days[-1], "Close"]) if days else float(d["Close"].iloc[-2])
    return float(h["Close"].iloc[-1]), last_ts, prev


def pctile(values, x):
    vals = [v for v in values if v is not None]
    return round(100.0 * sum(1 for v in vals if v <= x) / len(vals), 1) if vals else None


def valet(path):
    return get("https://www.bankofcanada.ca/valet/" + path).json()


# ------------------------------------------------------------------ blocks
def fx_spot(D, N):
    mid, ts, _ = yahoo_last("CAD=X", "1m")
    f = D["fx"]["feed"]
    if not 1.2 < mid < 1.6:
        raise RuntimeError(f"implausible USD/CAD {mid}")
    D["fx"]["feed"] = {"mid": round(mid, 5), "bid": None, "ask": None, "ts": iso(ts),
                       "source": "Yahoo Finance CAD=X (delayed mid, no dealable bid/ask)"}
    D["meta"]["asof"]["fx_spot"] = iso(ts)
    return f["mid"] != D["fx"]["feed"]["mid"]


def fx_closes(D, N):
    j = valet("observations/FXUSDCAD/json?recent=60")
    obs = sorted((o["d"], float(o["FXUSDCAD"]["v"])) for o in j["observations"] if o.get("FXUSDCAD", {}).get("v"))
    if len(obs) < 25:
        raise RuntimeError("too few BoC observations")
    fx = D["fx"]
    fx["closes"] = [[d, v] for d, v in obs[-18:]]
    fx["spot"]["ref"] = obs[-1][1]
    c20, c50 = [v for _, v in obs[-20:]], [v for _, v in obs[-50:]]
    L = fx["levels"]
    L.update(s20=round(min(c20), 5), r20=round(max(c20), 5), s50=round(min(c50), 5), r50=round(max(c50), 5))
    try:  # prior-session floor pivot from Yahoo daily OHLC
        d = yf().Ticker("CAD=X").history(period="10d", interval="1d")
        today = datetime.now(TOR).date()
        prior = d[[i.date() < today for i in d.index]].iloc[-1]
        H, Lo, C = float(prior["High"]), float(prior["Low"]), float(prior["Close"])
        L.update(pivot=round((H + Lo + C) / 3, 5), pivot_h=round(H, 5), pivot_l=round(Lo, 5), pivot_c=round(C, 5))
    except Exception as e:
        print("  pivot skipped:", e)
    D["meta"]["asof"]["fx_closes"] = obs[-1][0] + "T16:30:00-04:00"
    D["meta"].setdefault("sources", {})["fx_closes"] = "Bank of Canada daily exchange rate (FXUSDCAD)"
    return True


US_COLS = {"3M": "3 Mo", "1Y": "1 Yr", "2Y": "2 Yr", "3Y": "3 Yr", "5Y": "5 Yr", "7Y": "7 Yr",
           "10Y": "10 Yr", "20Y": "20 Yr", "30Y": "30 Yr"}
CA_LABEL = {"2Y": "2 year", "5Y": "5 year", "10Y": "10 year", "30Y": "long"}


def us_curve():
    rows = []
    for yr in (NOW.year - 1, NOW.year):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
               f"{yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value={yr}&page&_format=csv")
        try:
            rows += list(csv.DictReader(io.StringIO(get(url).text)))
        except Exception as e:
            print("  treasury", yr, e)
    out = {}
    for r in rows:
        d = datetime.strptime(r["Date"], "%m/%d/%Y").date().isoformat()
        out[d] = {k: float(r[c]) for k, c in US_COLS.items() if r.get(c) not in (None, "", "N/A")}
    if not out:
        raise RuntimeError("no Treasury rows")
    return out


def ca_curve():
    j = valet("observations/group/bond_yields_benchmark/json?recent=40")
    code_for = {}
    for code, det in j.get("seriesDetail", {}).items():
        m = re.search(r"\.(\d+)YR\.", code.upper())
        if m and m.group(1) + "Y" in CA_LABEL:
            code_for[m.group(1) + "Y"] = code
        elif "LONG" in code.upper():
            code_for["30Y"] = code
    for code, det in j.get("seriesDetail", {}).items():  # label fallback for anything unmapped
        lab = (det.get("label", "") + " " + det.get("description", "")).lower().replace("-", " ")
        for tenor, key in CA_LABEL.items():
            if key in lab and tenor not in code_for:
                code_for[tenor] = code
    print("  Canada series:", code_for)
    out = {}
    for o in j["observations"]:
        row = {t: float(o[c]["v"]) for t, c in code_for.items() if o.get(c, {}).get("v")}
        if row:
            out[o["d"]] = row
    if not out:
        raise RuntimeError(f"no BoC yield rows (mapped {code_for})")
    return out


def yields(D, N):
    us, ca = us_curve(), ca_curve()
    dates = sorted(set(us) & set(ca))
    if not dates:
        raise RuntimeError("no common US/CA dates")
    d0 = dates[-1]
    fx = D["fx"]
    fx["treasury"].update({k: v for k, v in us[d0].items()})
    changed = []
    for row in fx["rates"]:
        t = row["t"]
        if t not in CA_LABEL or t not in us[d0] or t not in ca[d0]:
            continue  # 1Y / 20Y: no matching Canada benchmark — keep stored row
        series = [(d, (us[d][t] - ca[d][t]) * 100) for d in dates if t in us[d] and t in ca[d]]
        sp = [v for _, v in series]
        row.update(us=round(us[d0][t], 3), ca=round(ca[d0][t], 3), sp=round(sp[-1], 1),
                   dod=round(sp[-1] - sp[-2], 1) if len(sp) > 1 else None,
                   wow=round(sp[-1] - sp[-6], 1) if len(sp) > 5 else None,
                   pct=pctile(sp[-20:], sp[-1]), asof=d0)
        changed.append(t)
    fx["widest"] = max(fx["rates"], key=lambda r: r["sp"])["t"]
    D["meta"]["asof"]["yields"] = d0 + "T17:00:00-04:00"
    print("  tenors refreshed:", changed, "as of", d0)
    try:
        v = valet("observations/V39079/json?recent=1")["observations"][-1]["V39079"]["v"]
        if 0 < float(v) < 10:
            fx["policy"]["corra_now"] = float(v)
    except Exception as e:
        print("  BoC target skipped:", e)
    return bool(changed)


def socrata(dataset, code, n):
    url = (f"https://publicreporting.cftc.gov/resource/{dataset}.json?cftc_contract_market_code={code}"
           f"&$order=report_date_as_yyyy_mm_dd%20DESC&$limit={n}")
    rows = get(url).json()
    if not rows:
        raise RuntimeError(f"no CFTC rows for {code}")
    return list(reversed(rows))


def cftc_fx(D, N):
    rows = socrata("gpe5-46if", "090741", 160)  # CAD, CME — Traders in Financial Futures
    nets = [int(float(r["lev_money_positions_long"])) - int(float(r["lev_money_positions_short"])) for r in rows]
    r = rows[-1]
    lo, sh, oi = int(float(r["lev_money_positions_long"])), int(float(r["lev_money_positions_short"])), int(float(r["open_interest_all"]))
    net = lo - sh
    pct = round(100.0 * net / oi, 1)
    label = ("Extreme Crowded Short (High short-squeeze risk)" if pct <= -20 else "Crowded Short" if pct <= -10
             else "Extreme Crowded Long" if pct >= 20 else "Crowded Long" if pct >= 10 else "Balanced")
    series = [{"date": x["report_date_as_yyyy_mm_dd"][:10],
               "long": int(float(x["lev_money_positions_long"])), "short": int(float(x["lev_money_positions_short"])),
               "net": int(float(x["lev_money_positions_long"])) - int(float(x["lev_money_positions_short"]))} for x in rows[-10:]]
    D["fx"]["pos"].update(net=net, long=lo, short=sh, oi=oi, pct_oi=pct, wow=net - nets[-2], label=label,
                          p1y=pctile(nets[-52:], net), p3y=pctile(nets[-156:], net), series=series)
    d = r["report_date_as_yyyy_mm_dd"][:10]
    D["meta"]["asof"]["cftc_fx"] = d + "T15:30:00-04:00"
    return True


GRAIN_CFTC = {"corn": "002602", "wheat": "001602", "soybeans": "005602"}


def cftc_grains(D, N):
    last = None
    for k, code in GRAIN_CFTC.items():
        rows = socrata("72hh-3qpy", code, 10)  # Disaggregated futures-only
        ser = []
        for r in rows:
            lo, sh = int(float(r["m_money_positions_long_all"])), int(float(r["m_money_positions_short_all"]))
            ser.append({"date": r["report_date_as_yyyy_mm_dd"][:10], "long": lo, "short": sh, "net": lo - sh})
        D["grains"][k]["cftc"] = ser
        last = ser[-1]["date"]
    D["meta"]["asof"]["cftc_grains"] = last + "T15:30:00-04:00"
    return True


GRAIN_YF = {"corn": "ZC=F", "wheat": "ZW=F", "soybeans": "ZS=F"}


def grains_quote(D, N):
    newest = None
    for k, sym in GRAIN_YF.items():
        px, ts, _ = yahoo_last(sym)
        px = px / 100.0  # Yahoo quotes grains in cents/bu
        f = D["grains"][k]["fan"]
        if not 0.5 * f["anchor"] < px < 1.5 * f["anchor"]:
            raise RuntimeError(f"{sym} {px} implausible vs settle {f['anchor']}")
        label = ts.astimezone(TOR).strftime("%-I:%M%p").lower() + " ET"
        f["intraday"] = [round(px, 4), label]
        f["intraday_ts"] = iso(ts)
        newest = max(newest or ts, ts)
    D["meta"]["asof"]["grains_quote"] = iso(newest)
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
    D["meta"]["asof"]["news"] = iso(NOW)
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=3):
        print("  checked <3h ago — skipping (BLS keyless limit)")
        return False
    # Canada CPI, all-items, NSA index -> y/y %
    j = valet("observations/V41690973/json?recent=24")
    idx = sorted((o["d"], float(o["V41690973"]["v"])) for o in j["observations"] if o.get("V41690973", {}).get("v"))
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
        pts = sorted((int(x["year"]), int(x["period"][1:]), float(x["value"])) for x in ser["data"] if x["period"].startswith("M") and x["period"] != "M13")
        out[ser["seriesID"]] = pts
    lv, ur = out["CES0000000001"], out["LNS14000000"]
    nfp = [(f"{MONTHS[m-1]} {y}", int(round(v - lv[i-1][2]))) for i, (y, m, v) in enumerate(lv) if i > 0]
    urh = [(f"{MONTHS[m-1]} {y}", v) for y, m, v in ur]
    _set_release(D, "us_nfp", nfp, urh)
    meta["releases_checked"] = iso(NOW)
    newest = max(D["fx"]["releases"], key=lambda x: x["released"])["released"]
    meta["asof"]["releases"] = newest
    return True


BLOCKS = [("fx_spot", fx_spot), ("fx_closes", fx_closes), ("yields", yields), ("cftc_fx", cftc_fx),
          ("cftc_grains", cftc_grains), ("grains_quote", grains_quote), ("energy", energy),
          ("crosses", crosses), ("news", news), ("releases", releases)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated block names")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    doc = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    D, N = doc["DATA"], doc["NEWS"]
    before = json.dumps(doc, sort_keys=True)
    only = set(a.only.split(",")) if a.only else None
    ok, failed = [], []
    for name, fn in BLOCKS:
        if only and name not in only:
            continue
        print(f"[{name}]")
        snapshot = json.dumps({"D": D, "N": N})
        try:
            fn(D, N)
            ok.append(name)
        except Exception as e:  # restore this block's partial edits, keep going
            restored = json.loads(snapshot)
            D.clear(); D.update(restored["D"]); N.clear(); N.update(restored["N"])
            failed.append(name)
            print(f"  FAILED: {e}")
            traceback.print_exc(limit=1, file=sys.stdout)
    if json.dumps(doc, sort_keys=True) == before:
        print("no changes")
        return 1 if not ok else 0
    D["meta"]["updated_at"] = iso(NOW)
    D["meta"]["updated_by"] = "GitHub Action refresh"
    D["meta"]["last_run"] = {"ok": ok, "failed": failed, "at": iso(NOW)}
    if a.dry_run:
        print("dry run — not writing")
    else:
        DATA_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("ok:", ok, "| failed:", failed)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
