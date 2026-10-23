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
import argparse, csv, io, json, re, statistics, sys, time, traceback
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


def get(url, headers=None, **kw):
    r = requests.get(url, headers={**UA, **(headers or {})}, timeout=25, **kw)
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
    try:  # intraday path for the spot chart: 5-minute closes over the last ~20h
        h = yf().Ticker("CAD=X").history(period="2d", interval="5m")
        cut = NOW - timedelta(hours=20)
        D["fx"]["intraday"] = [[i.to_pydatetime().astimezone(timezone.utc).isoformat(timespec="minutes"), round(float(c), 5)]
                               for i, c in h["Close"].items() if i.to_pydatetime() >= cut and 1.2 < float(c) < 1.6]
    except Exception as e:
        print("  intraday skipped:", e)
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


def _daily_closes(sym, scale=1.0, period="6mo"):
    """{YYYY-MM-DD: close} for a Yahoo symbol (CFTC report-date price tags / weekly means)."""
    h = yf().Ticker(sym).history(period=period, interval="1d")
    return {idx.date().isoformat(): round(float(row["Close"]) * scale, 5) for idx, row in h.iterrows() if row["Close"] == row["Close"]}


def _week_means(dates, closes):
    """Mean close of the sessions in each CFTC report week: (previous report date, this report date]."""
    days = sorted(closes)
    out = {}
    for i, d in enumerate(dates):
        lo = dates[i - 1] if i else (datetime.fromisoformat(d) - timedelta(days=7)).date().isoformat()
        w = [closes[x] for x in days if lo < x <= d]
        if w:
            out[d] = (round(sum(w) / len(w), 5), len(w))
    return out


def _fund_basis(rows, means, invert=False):
    """Estimated average entry of the current net position: weekly net additions are priced at that week's mean
    (CFTC is a lagging Tuesday snapshot, so the week's average is the best estimate of where the change was done).
    Adding in the same direction re-weights the average; cutting keeps it; flipping sides restarts at that week's mean."""
    N = B = None
    used = 0
    for x in rows:
        m = means.get(x["date"])
        if not m:
            continue
        P = 1.0 / m[0] if invert else m[0]
        n = x["net"]
        if N is None or N == 0 or (N > 0) != (n > 0):
            B = P
        elif abs(n) > abs(N):
            B = (abs(N) * B + (abs(n) - abs(N)) * P) / abs(n)
        N = n
        used += 1
    if B is None:
        return None
    return {"avg_entry": round(1.0 / B if invert else B, 5), "net": N, "weeks": used,
            "since": next((x["date"] for x in rows if x["date"] in means), None)}


def _tag_prices(series, closes, label):
    """Attach the close on each report date (or the last trading day before it) as 'px' and the week change as 'px_chg'."""
    if not closes:
        return
    days = sorted(closes)
    prev = None
    for x in series:
        d = next((dd for dd in reversed(days) if dd <= x["date"]), None)
        if d is None or (datetime.fromisoformat(x["date"]) - datetime.fromisoformat(d)).days > 5:
            x.pop("px", None); x.pop("px_chg", None); prev = None
            continue
        x["px"] = closes[d]; x["px_date"] = d
        x["px_chg"] = round(x["px"] - prev, 5) if prev is not None else None
        prev = x["px"]
    wm = _week_means([x["date"] for x in series], closes)
    pm = None
    for x in series:
        m = wm.get(x["date"])
        if m:
            x["px_mean"], x["px_n"] = m
            x["px_mean_chg"] = round(m[0] - pm, 5) if pm is not None else None
            pm = m[0]
    print(f"  {label}: tagged {sum(1 for x in series if 'px' in x)}/{len(series)} report weeks with prices")


def _fieldnum(row, pat):
    k = next((k for k in row if re.search(pat, k)), None)
    return (int(float(row[k])) if k and _num(row[k]) is not None else None), k


def _pos_kpis(rows, spec_long, spec_short, comm_long_pat, comm_short_pat, oi_key="open_interest_all", means=None):
    """CFTC positioning KPIs: 52-wk z-score, 3-yr COT index, flow velocity (% OI), streak, OI change, commercial-spec spread."""
    import statistics as st_
    net, oi, comm, dates = [], [], [], []
    keys_used = {}
    for x in rows:
        lo, sh = _num(x.get(spec_long)), _num(x.get(spec_short))
        if lo is None or sh is None:
            continue
        net.append(lo - sh); oi.append(_num(x.get(oi_key)) or 0); dates.append(x["report_date_as_yyyy_mm_dd"][:10])
        cl, kl = _fieldnum(x, comm_long_pat); cs, ks = _fieldnum(x, comm_short_pat)
        keys_used = {"comm_long": kl, "comm_short": ks}
        comm.append(cl - cs if cl is not None and cs is not None else None)
    if len(net) < 10:
        return None
    n = net[-1]
    w52 = net[-52:]
    sd = st_.pstdev(w52) or 1
    z52 = (n - st_.mean(w52)) / sd
    w156 = net[-156:]
    cot = 100.0 * (n - min(w156)) / ((max(w156) - min(w156)) or 1)
    d1 = net[-1] - net[-2]
    vel = 100.0 * d1 / oi[-1] if oi[-1] else None
    streak = 0
    sgn_ = 1 if d1 > 0 else -1 if d1 < 0 else 0
    for i in range(len(net) - 1, 0, -1):
        d = net[i] - net[i - 1]
        if sgn_ and ((d > 0 and sgn_ > 0) or (d < 0 and sgn_ < 0)):
            streak += 1
        else:
            break
    doi = (oi[-1] / oi[-2] - 1) * 100 if oi[-2] else None
    out = {"date": dates[-1], "net": n, "oi": oi[-1], "z52": round(z52, 2), "cot3": round(cot, 1), "d1": d1,
           "vel_pct_oi": round(vel, 2) if vel is not None else None, "streak": streak * sgn_, "doi_pct": round(doi, 2) if doi is not None else None,
           "z_hist": [], "cot_hist": [], "net_hist": [[dates[i], net[i]] for i in range(max(0, len(net) - 52), len(net))],
           "oi_hist": [[dates[i], oi[i]] for i in range(max(0, len(net) - 26), len(net))], "fields": keys_used}
    for i in range(max(52, len(net) - 26), len(net)):
        w = net[i - 51:i + 1]; sdv = st_.pstdev(w) or 1
        out["z_hist"].append([dates[i], round((net[i] - st_.mean(w)) / sdv, 2)])
        w3 = net[max(0, i - 155):i + 1]; out["cot_hist"].append([dates[i], round(100.0 * (net[i] - min(w3)) / ((max(w3) - min(w3)) or 1), 1)])
    cv = [c for c in comm if c is not None]
    if len(cv) == len(comm) and len(cv) >= 10:
        spread = [net[i] - comm[i] for i in range(len(net))]
        sw = spread[-156:]
        out.update(comm_net=comm[-1], comm_d1=comm[-1] - comm[-2], spread=spread[-1],
                   spread_idx=round(100.0 * (spread[-1] - min(sw)) / ((max(sw) - min(sw)) or 1), 1),
                   spread_z=round((spread[-1] - st_.mean(spread[-52:])) / (st_.pstdev(spread[-52:]) or 1), 2),
                   comm_hist=[[dates[i], comm[i]] for i in range(max(0, len(net) - 52), len(net))])
    if means:
        m1, m0 = means.get(dates[-1]), means.get(dates[-2]) if len(dates) > 1 else None
        if m1 and m0:
            out["px_chg_pct"] = round((m1[0] / m0[0] - 1) * 100, 2)
    return out


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
    try:
        D["fx"]["pos"]["kpi"] = _pos_kpis(rows, "lev_money_positions_long", "lev_money_positions_short", r"^dealer_positions_long", r"^dealer_positions_short")
    except Exception as e:
        print("  CAD positioning KPIs failed:", e)
    try:
        cl = _daily_closes("CAD=X", period="4y")
        _tag_prices(series, cl, "USD/CAD")
        allrows = [{"date": x["report_date_as_yyyy_mm_dd"][:10], "net": int(float(x["lev_money_positions_long"])) - int(float(x["lev_money_positions_short"]))} for x in rows]
        D["fx"]["pos"]["basis"] = _fund_basis(allrows, _week_means([x["date"] for x in allrows], cl), invert=True)
    except Exception as e:
        print("  USD/CAD price tags failed:", e)
    D["fx"]["pos"].update(net=net, long=lo, short=sh, oi=oi, pct_oi=pct, wow=net - nets[-2], label=label,
                          p1y=pctile(nets[-52:], net), p3y=pctile(nets[-156:], net), series=series)
    d = r["report_date_as_yyyy_mm_dd"][:10]
    D["meta"]["asof"]["cftc_fx"] = d + "T15:30:00-04:00"
    return True


GRAIN_CFTC = {"corn": "002602", "wheat": "001602", "soybeans": "005602"}


def cftc_grains(D, N):
    last = None
    for k, code in GRAIN_CFTC.items():
        rows = socrata("72hh-3qpy", code, 160)  # Disaggregated futures-only, ~3 years
        full = []
        for r in rows:
            lo, sh = int(float(r["m_money_positions_long_all"])), int(float(r["m_money_positions_short_all"]))
            full.append({"date": r["report_date_as_yyyy_mm_dd"][:10], "long": lo, "short": sh, "net": lo - sh,
                         "oi": int(float(r.get("open_interest_all") or 0))})
        ser = [dict(x) for x in full[-10:]]
        nets = [x["net"] for x in full]
        st = {"p1y": pctile(nets[-52:], nets[-1]), "p3y": pctile(nets, nets[-1]), "weeks_hist": len(nets),
              "pct_oi": round(100.0 * full[-1]["net"] / full[-1]["oi"], 1) if full[-1]["oi"] else None,
              "max3y": max(nets), "min3y": min(nets)}
        try:
            cl = _daily_closes(GRAIN_YF[k], 0.01, period="4y")   # Yahoo grains are cents/bu
            _tag_prices(ser, cl, k)
            st["basis"] = _fund_basis(full, _week_means([x["date"] for x in full], cl))
        except Exception as e:
            print(f"  {k} price tags failed:", e)
        try:
            wm_ = _week_means([x["date"] for x in full], cl)
        except Exception:
            wm_ = None
        try:
            st["kpi"] = _pos_kpis(rows, "m_money_positions_long_all", "m_money_positions_short_all", r"^prod_merc_positions_long", r"^prod_merc_positions_short", means=wm_)
        except Exception as e:
            print(f"  {k} positioning KPIs failed:", e)
        D["grains"][k]["cftc_stats"] = st
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


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None  # BLS prints "-" for months it never published


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
    meta["releases_checked"] = iso(NOW)
    newest = max(D["fx"]["releases"], key=lambda x: x["released"])["released"]
    meta["asof"]["releases"] = newest
    return True


# ------------------------------------------------------------------ macro monitor
# (key, name, group, source, series id, transform, unit, decimals, good-direction, sanity range of the RAW series)
#   transform: level | yoy (% vs 12 months earlier) | diff (change vs prior, K) | pct (% change vs prior)
#   good: "up" / "down" = which way is economically stronger; "heat" = inflation (up = hotter)
MACRO = [
    ("us_cpi",      "CPI",                 "us", "fred", "CPIAUCSL",        "yoy",   "%",  1, "heat", (200, 500)),
    ("us_core_cpi", "Core CPI",            "us", "fred", "CPILFESL",        "yoy",   "%",  1, "heat", (200, 500)),
    ("us_core_pce", "Core PCE",            "us", "fred", "PCEPILFE",        "yoy",   "%",  1, "heat", (80, 200)),
    ("us_nfp",      "Nonfarm payrolls",    "us", "fred", "PAYEMS",          "diff",  "K",  0, "up",   (120000, 200000)),
    ("us_ur",       "Unemployment rate",   "us", "fred", "UNRATE",          "level", "%",  1, "down", (2, 15)),
    ("us_claims",   "Initial jobless claims", "us", "fred", "ICSA",         "level", "K",  0, "down", (100000, 1500000)),
    ("us_cclaims",  "Continuing claims",   "us", "fred", "CCSA",            "level", "K",  0, "down", (800000, 6000000)),
    ("us_ahe",      "Avg hourly earnings", "us", "fred", "CES0500000003",   "yoy",   "%",  1, "heat", (20, 60)),
    ("us_retail",   "Retail sales",        "us", "fred", "RSAFS",           "pct",   "%",  1, "up",   (400000, 1200000)),
    ("us_gdp",      "Real GDP (q/q ann.)", "us", "fred", "A191RL1Q225SBEA", "level", "%",  1, "up",   (-40, 40)),
    ("us_umich",    "UMich sentiment",     "us", "fred", "UMCSENT",         "level", "",   1, "up",   (20, 120)),
    ("ca_cpi",      "CPI",                 "ca", "valet", "V41690973",      "yoy",   "%",  1, "heat", (100, 250)),
    ("ca_trim",     "CPI-trim",            "ca", "valet", "CPI_TRIM",       "level", "%",  1, "heat", (-2, 12)),
    ("ca_median",   "CPI-median",          "ca", "valet", "CPI_MEDIAN",     "level", "%",  1, "heat", (-2, 12)),
    ("ca_emp",      "Employment change",   "ca", "statcan", 2062811,        "diff",  "K",  1, "up",   (15000, 25000)),
    ("ca_ur",       "Unemployment rate",   "ca", "statcan", 2062815,        "level", "%",  1, "down", (2, 20)),
    ("ca_gdp",      "Real GDP",            "ca", "statcan", 65201210,       "pct",   "%",  1, "up",   (1500000, 3500000)),
    # chart-only series for the Macro sub-tab (quarterly GDP bars, policy-rate panels)
    ("ca_gdpq",     "Real GDP (q/q ann.)", "ca", "statcan", 62305752,       "qann",  "%",  1, "up",   (1500000, 3800000)),
    ("us_policy",   "Fed funds target (upper)", "us", "fred", "DFEDTARU",   "level", "%",  2, "heat", (0, 10)),
    ("ca_policy",   "BoC overnight target", "ca", "valet", "V39079",        "level", "%",  2, "heat", (0, 10)),
]
MACRO_LONG = {"us_cpi", "ca_cpi", "us_core_cpi", "us_ur", "ca_ur", "us_gdp", "ca_gdpq", "us_policy", "ca_policy"}


def _fred(sid, start):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"
    rows = list(csv.reader(io.StringIO(get(url).text)))
    return [(r[0], float(r[1])) for r in rows[1:] if len(r) > 1 and _num(r[1]) is not None]


def _valet_series(sid, n, start=None):
    j = valet(f"observations/{sid}/json?" + (f"start_date={start}" if start else f"recent={n}"))
    return sorted((o["d"], _num(o.get(sid, {}).get("v"))) for o in j["observations"] if _num(o.get(sid, {}).get("v")) is not None)


def _statcan(vec, n):
    for attempt in range(3):
        try:
            return _statcan1(vec, n)
        except requests.exceptions.ConnectionError:
            if attempt == 2:
                raise
            time.sleep(3 + attempt * 4)


def _statcan1(vec, n):
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods",
                      headers={**UA, "Content-Type": "application/json"},
                      data=json.dumps([{"vectorId": vec, "latestN": n}]), timeout=25)
    r.raise_for_status()
    obj = r.json()[0]
    if obj.get("status") != "SUCCESS":
        raise RuntimeError(f"StatCan v{vec}: {obj.get('status')}")
    return sorted((p["refPer"][:10], float(p["value"])) for p in obj["object"]["vectorDataPoint"] if p.get("value") is not None)


def _label(d, freq):
    y, m, day = int(d[:4]), int(d[5:7]), int(d[8:10])
    if freq in ("W", "D"):
        return f"{MONTHS[m-1]} {day}"
    if freq == "Q":
        return f"Q{(m-1)//3+1} '{str(y)[2:]}"
    return f"{MONTHS[m-1]} '{str(y)[2:]}"


def _freq(points):
    if len(points) < 3:
        return "M"
    a, b = datetime.fromisoformat(points[-2][0]), datetime.fromisoformat(points[-1][0])
    gap = (b - a).days
    return "D" if gap <= 4 else "W" if gap <= 8 else "Q" if gap >= 80 else "M"


def _transform(points, how):
    out = []
    byd = dict(points)
    for i, (d, v) in enumerate(points):
        if how == "level":
            out.append((d, v))
        elif how in ("diff", "pct") and i > 0:
            pv = points[i-1][1]
            out.append((d, (v - pv) if how == "diff" else (v / pv - 1) * 100))
        elif how == "qann" and i > 0:
            out.append((d, ((v / points[i-1][1]) ** 4 - 1) * 100))
        elif how == "yoy":
            base = byd.get(f"{int(d[:4]) - 1}{d[4:]}")
            if base:
                out.append((d, (v / base - 1) * 100))
    return out


def _track(m, prev, pts_all):
    """Keep 24 readings, note revisions to the prior period and when a new period first appeared (≈ release time)."""
    m["hist24"] = [[_label(d, m["freq"]), round(v, m["dec"] + 1)] for d, v in pts_all]
    if prev and prev.get("period") == m["period"]:
        m["seen_at"] = prev.get("seen_at")
        if prev.get("rev"):
            m["rev"] = prev["rev"]
    else:
        m["seen_at"] = iso(NOW) if prev else None
        if prev:
            ph = dict((h[0], h[1]) for h in prev.get("hist24") or prev.get("history") or [])
            lab = m["history"][-2][0] if len(m["history"]) > 1 else None
            if lab in ph and abs(ph[lab] - m["prior"]) >= 10 ** (-m["dec"]) / 2:
                m["rev"] = {"period": lab, "from": ph[lab], "to": m["prior"]}


def ca_retail(D, N):
    """Canada retail trade (StatCan 20-10-0056-01, seasonally adjusted): total and ex motor vehicle & parts dealers."""
    meta = D["meta"]
    last = meta.get("ca_retail_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=1):
        print("  checked <6h ago — skipping")
        return False
    acc, dims = {}, {"naics": set(), "adj": set()}
    cols = {}
    for row in _sc_table(20100056):
        if row.get("GEO") != "Canada":
            continue
        for c_, v_ in row.items():
            if c_ not in ("REF_DATE", "VALUE", "DGUID", "COORDINATE", "VECTOR", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS", "SCALAR_ID", "UOM_ID"):
                cols.setdefault(c_, set()).add(v_)
        nai = next((row[c] for c in row if c.startswith("North American Industry")), "")
        adj = row.get("Adjustments", "")
        dims["naics"].add(nai); dims["adj"].add(adj)
        if adj.lower() != "seasonally adjusted":
            continue
        sales = (row.get("Sales") or "").lower()
        n = nai.lower()
        key = None
        if sales.startswith("total retail"):
            key = "tot" if n.startswith("retail trade [44-45]") else "auto" if "[441]" in n else "gas" if "[457]" in n else None
        elif sales.startswith("retail e-commerce") and n.startswith("retail trade [44-45]"):
            key = "ecom"
        v = _num(row.get("VALUE"))
        if key and v is not None:
            acc.setdefault(key, {})[row["REF_DATE"][:10] if len(row["REF_DATE"]) > 7 else row["REF_DATE"] + "-01"] = v
    meta["ca_retail_dims"] = {c_: sorted(v_)[:40] for c_, v_ in cols.items()}
    if acc.get("tot") and acc.get("auto"):
        acc["ex"] = {d: v - acc["auto"][d] for d, v in acc["tot"].items() if d in acc["auto"]}
        if acc.get("gas"):
            acc["core"] = {d: acc["ex"][d] - acc["gas"][d] for d in acc["ex"] if d in acc["gas"]}
    if not acc.get("tot"):
        raise RuntimeError(f"no total retail line; NAICS seen: {sorted(dims['naics'])[:15]} adj: {sorted(dims['adj'])}"[:700])
    old = {m["key"]: m for m in D.get("macro_extra", [])}
    out = []
    for key, name, k in (("ca_retail", "Retail sales", "tot"), ("ca_retail_ex", "Retail sales ex-autos", "ex"), ("ca_retail_core", "Retail ex gas & autos", "core")):
        if k not in acc:
            continue
        raw = sorted(acc[k].items())
        pts = _transform(raw, "pct")
        pts_all = pts[-24:]
        h = pts[-12:]
        lvl = raw[-1][1] / 1e6     # thousands of dollars -> C$ billions
        yoy = None
        byd = dict(raw)
        d0 = raw[-1][0]
        base = byd.get(f"{int(d0[:4]) - 1}{d0[4:]}")
        if base:
            yoy = round((raw[-1][1] / base - 1) * 100, 2)
        m = {"key": key, "name": name, "group": "ca", "unit": "%", "dec": 1, "good": "up", "freq": "M", "measure": "m/m",
             "period": _label(h[-1][0], "M"), "obs_date": h[-1][0], "value": round(h[-1][1], 2), "prior": round(h[-2][1], 2),
             "chg": round(h[-1][1] - h[-2][1], 2), "history": [[_label(d, "M"), round(v, 2)] for d, v in h],
             "level_b": round(lvl, 2), "yoy": yoy, "src": "Statistics Canada 20-10-0056-01" + ("" if k == "tot" else " (derived: total minus " + ("auto dealers" if k == "ex" else "auto dealers and gasoline stations") + ")")}
        if k == "tot" and acc.get("ecom"):
            e_ = sorted(acc["ecom"].items())
            m["ecom_b"] = round(e_[-1][1] / 1e6, 2)
            m["ecom_share"] = round(e_[-1][1] / raw[-1][1] * 100, 1) if e_[-1][0] == raw[-1][0] else None
        _track(m, old.get(key), pts_all)
        out.append(m)
    D["macro_extra"] = out
    meta["ca_retail_checked"] = iso(NOW)
    meta["asof"]["ca_retail"] = iso(NOW)
    print("  ca_retail:", [(m["key"], m["period"], m["value"]) for m in out])
    return True


def macro(D, N):
    meta = D["meta"]
    last = meta.get("macro_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=2):
        print("  checked <2h ago — skipping")
        return False
    old = {m["key"]: m for m in D.get("macro", [])}
    start = (NOW - timedelta(days=2650)).date().isoformat()   # ~7 years: 5-yr averages of y/y series
    out, errs = [], {}
    for key, name, group, src, sid, how, unit, dec, good, (lo, hi) in MACRO:
        try:
            raw = (_fred(sid, start) if src == "fred" else _valet_series(sid, 0, start) if src == "valet" else _statcan(sid, 90))
            if len(raw) < 3:
                raise RuntimeError("too few points")
            if not all(lo <= v <= hi for _, v in raw[-6:]):
                raise RuntimeError(f"values outside sanity range {lo}-{hi}: {raw[-1][1]} — wrong series id?")
            fq = _freq(raw)
            age = (NOW.date() - datetime.fromisoformat(raw[-1][0][:10]).date()).days
            if age > {"D": 10, "W": 30, "M": 130, "Q": 250}.get(fq, 130):
                raise RuntimeError(f"latest observation {raw[-1][0]} is {age} days old — discontinued series?")
            pts = _transform(raw, how)
            if how == "diff" or (unit == "K" and how == "level"):
                pts = [(d, v / 1000 if (how == "level" and src == "fred") else v) for d, v in pts]  # FRED claims are persons -> K
            longp = None
            if key in MACRO_LONG:
                lp = pts
                if fq == "D":   # daily policy rates -> month-end readings
                    me = {}
                    for d, v in lp:
                        me[d[:7]] = (d, v)
                    lp = [me[m] for m in sorted(me)]
                longp = [[d[:10], round(v, dec + 1)] for d, v in lp[-(24 if fq == "Q" else 72):]]
            pts_all = pts[-24:]
            pts = pts[-12:]
            if len(pts) < 2:
                raise RuntimeError("too few transformed points")
            val, prv = pts[-1][1], pts[-2][1]
            out.append({"key": key, "name": name, "group": group, "unit": unit, "dec": dec, "good": good,
                        "freq": fq, "measure": {"yoy": "y/y", "diff": "m/m", "pct": "m/m", "level": "", "qann": ""}[how],
                        "period": _label(pts[-1][0], fq), "obs_date": pts[-1][0],
                        "value": round(val, dec + 1), "prior": round(prv, dec + 1), "chg": round(val - prv, dec + 1),
                        "history": [[_label(d, fq), round(v, dec + 1)] for d, v in pts],
                        "src": {"fred": "FRED", "valet": "Bank of Canada Valet", "statcan": "Statistics Canada"}[src] + f" {sid}"})
            if longp:
                out[-1]["long"] = longp
            _track(out[-1], old.get(key), pts_all)
            if key in ("ca_gdpq", "us_policy", "ca_policy"):
                out[-1]["chart_only"] = True
        except Exception as e:
            errs[key] = f"{type(e).__name__}: {e}"[:200]
            if key in old:
                out.append(old[key])  # keep the last good reading
    if not out:
        raise RuntimeError(f"all macro series failed: {errs}")
    D["macro"] = out
    # a failed chart series retries on the next 15-min run instead of waiting the full 2 h
    meta["macro_checked"] = iso(NOW - timedelta(minutes=105)) if any(k in MACRO_LONG for k in errs) else iso(NOW)
    meta["asof"]["macro"] = iso(NOW)
    if errs:
        meta["macro_errors"] = errs
    else:
        meta.pop("macro_errors", None)
    print(f"  macro: {len(out) - len(errs)} fresh, {len(errs)} failed {list(errs)}")
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
        if d > now.date() or (d == now.date() and not (15 <= now.hour < 20)):
            continue  # today's bar: settle final only 3pm-8pm ET; after 8pm it is the overnight session
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
    done = []
    for k, g in D["grains"].items():
        front = g["roll"][0]["contract"]
        st_ = _yahoo_settles(front)
        if len(st_) < 76:
            raise RuntimeError(f"{front}: only {len(st_)} settles")
        # verify the source against the desk's verified settles before trusting it
        mine = {h["d"][:10]: h["s"] for h in g["history"]}
        both = [(mine[d], v) for d, v in st_ if d in mine]
        if len(both) < 5:
            raise RuntimeError(f"{front}: only {len(both)} dates overlap the verified history")
        worst = max(abs(a - b) for a, b in both)
        if worst > 0.0101:
            raise RuntimeError(f"{front}: source differs from verified settles by up to {worst:.4f} — not used")
        if st_[-1][0] <= g["fan"]["settle_date"] and g["fan"].get("ma50"):
            continue  # nothing new
        fan, hist, tail = _fan_from(st_)
        g["fan"].update(fan)
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
        done.append(f"{k} {fan['settle_date']} {fan['anchor']}")
    if not done:
        return False
    last_settle = max(g["fan"]["settle_date"] for g in D["grains"].values())
    D["meta"]["asof"]["grains_settle"] = datetime.fromisoformat(last_settle + "T14:20:00").replace(tzinfo=TOR).isoformat()
    print("  settles:", done)
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6):
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
            for my in years + [y for y in (NOW.year + 1, NOW.year) if y not in years]:
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
    meta["exports_checked"] = iso(NOW)
    if changed:
        meta["asof"]["exports"] = iso(NOW)
    print("  exports refreshed:", changed)
    return bool(changed)


# ------------------------------------------------------------------ WASDE U.S. S&D (USDA PSD API)
PSD = "https://api.fas.usda.gov/api/psd"
PSD_CODE = {"corn": "0440000", "soybeans": "2222000", "wheat": "0410000"}
BU_PER_MT = {"corn": 39.3679, "soybeans": 36.7437, "wheat": 36.7437}
HA_TO_AC = 2.47105
WASDE_DATES = ["2026-01-12", "2026-02-10", "2026-03-10", "2026-04-09", "2026-05-12", "2026-06-11", "2026-07-10",
               "2026-08-12", "2026-09-11", "2026-10-09", "2026-11-10", "2026-12-10"]
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    today = datetime.now(TOR).date().isoformat()
    latest = max(d for d in WASDE_DATES if d <= today)
    label = datetime.fromisoformat(latest).strftime("%b %Y")
    W = D.get("wasde") or {}
    changed = []
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
    meta["wasde_checked"] = iso(NOW)
    if changed:
        meta["asof"]["wasde"] = iso(NOW)
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=24) and D.get("sd_hist"):
        print("  checked <24h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    out, errs = {}, {}
    for k, code in PSD_CODE.items():
        w = (D.get("wasde") or {}).get(k)
        new_my = int(w["new"]["my"][:4]) if w else NOW.year
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
    meta["sd_hist_checked"] = iso(NOW)
    meta["asof"]["sd_hist"] = iso(NOW)
    if errs:
        meta["sd_hist_errors"] = errs
    else:
        meta.pop("sd_hist_errors", None)
    print("  sd_hist:", {k: list(v["years"]) for k, v in out.items()}, "errors", len(errs))
    return True


# ------------------------------------------------------------------ trade & fiscal balances (US vs Canada)
EXT_FRED = [("us_trade_bal", "BOPGSTB"), ("us_exports", "BOPTEXP"), ("us_imports", "BOPTIMP"), ("us_deficit", "MTSDS133FMS"),
            ("us_goods_bal", "BOPGTB"), ("us_serv_bal", "BOPSTB"), ("us_receipts", "MTSR133FMS"), ("us_outlays", "MTSO133FMS")]
MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _ca_trade():
    """Canada merchandise trade, balance-of-payments basis, seasonally adjusted, all countries (StatCan 12-10-0011-01), C$ millions."""
    acc, dims = {}, {"trade": set(), "basis": set(), "sa": set(), "partner": set()}
    for row in _sc_table(12100011):
        if row.get("GEO") != "Canada":
            continue
        tr, ba, sa = row.get("Trade", ""), row.get("Basis", ""), row.get("Seasonal adjustment", "")
        pa = row.get("Principal trading partners", "")
        dims["trade"].add(tr); dims["basis"].add(ba); dims["sa"].add(sa); dims["partner"].add(pa)
        if "balance of payments" not in ba.lower() or not sa.lower().startswith("seasonally adjusted") or pa.lower() not in ("all countries", "united states"):
            continue
        t = tr.lower()
        key = "bal" if "balance" in t else "imp" if t.startswith("import") else "exp" if ("total export" in t or t == "export") else None
        if key and pa.lower() == "united states":
            key = key + "_us"
        v = _num(row.get("VALUE"))
        if key and v is not None:
            acc.setdefault(key, {})[row["REF_DATE"][:7]] = v
    if not acc.get("exp") or not acc.get("imp"):
        raise RuntimeError(f"Canada trade: no export/import lines; dims {{k: sorted(v)[:12] for k, v in dims.items()}}"[:600])
    if not acc.get("bal"):
        acc["bal"] = {m: acc["exp"][m] - acc["imp"][m] for m in acc["exp"] if m in acc["imp"]}
    return {k: sorted(v.items())[-30:] for k, v in acc.items() if v}


def _ca_fiscal(old):
    """Federal budgetary balance by month from Finance Canada's Fiscal Monitor pages (C$ billions; + surplus, - deficit)."""
    mon = dict((old or {}).get("monthly") or [])
    ytd = (old or {}).get("ytd")
    found = 0
    for back in range(1, 27):
        y, m = NOW.year, NOW.month - back
        while m <= 0:
            m += 12; y -= 1
        key = f"{y}-{m:02d}"
        if key in mon and back > 4 and key in ((old or {}).get("components") or {}):
            continue
        try:
            r_ = requests.get(f"https://www.canada.ca/en/department-finance/services/publications/fiscal-monitor/{y}/{m:02d}.html", headers=UA, timeout=25)
            if r_.status_code != 200:
                continue
            txt = _strip_html(r_.text)
        except Exception:
            continue
        pats = [(r"budgetary (surplus|deficit) of \$([\d.,]+) (billion|million) in (\w+) (\d{4})", True),
                (r"compared to a (surplus|deficit) of \$([\d.,]+) (billion|million) in (\w+) (\d{4})", False)]
        for pat, overwrite in pats:
            for sign_word, amt, unit, mname, yy in re.findall(pat, txt):
                if mname not in MONTHS_FULL:
                    continue
                k2 = f"{yy}-{MONTHS_FULL.index(mname) + 1:02d}"
                if overwrite or k2 not in mon:
                    mon[k2] = round((1 if sign_word == "surplus" else -1) * float(amt.replace(",", "")) * (1 if unit == "billion" else 0.001), 3)
                    found += 1
        comp = _fm_components(r_.text)
        if comp:
            cm = (old or {}).get("components") or {}
            cm.update(comp)
            old = dict(old or {}); old["components"] = cm
        if back <= 3:
            notes = [x.strip() for x in re.findall(r"((?:Revenues|Program expenses|Public debt charges)[^.]{10,260}\.)", txt)][:3]
            if notes and not (old or {}).get("notes_ref", "") > key:
                old = dict(old or {}); old["notes"] = notes; old["notes_ref"] = key
        mt = re.search(r"posted a budgetary (surplus|deficit) of \$([\d.,]+) (billion|million) for the (April to \w+) period of the (\d{4}-\d{2}) fiscal year", txt)
        if mt and (not ytd or key >= ytd.get("ref", "")):
            v = float(mt.group(2).replace(",", "")) * (1 if mt.group(3) == "billion" else 0.001)
            pr = re.search(r"compared to a (surplus|deficit) of \$([\d.,]+) (billion|million) (?:reported )?for the same period", txt)
            pv = (float(pr.group(2).replace(",", "")) * (1 if pr.group(3) == "billion" else 0.001) * (1 if pr.group(1) == "surplus" else -1)) if pr else None
            ytd = {"ref": key, "period": mt.group(4) + " " + mt.group(5), "value": round((1 if mt.group(1) == "surplus" else -1) * v, 3), "prior": pv}
    if not mon:
        raise RuntimeError("no Fiscal Monitor pages parsed")
    return {"monthly": sorted(mon.items())[-30:], "ytd": ytd, "parsed": found,
            "components": dict(sorted(((old or {}).get("components") or {}).items())[-30:]),
            "notes": (old or {}).get("notes"), "notes_ref": (old or {}).get("notes_ref")}


def _fm_components(html):
    """Monthly revenues / program expenses / public debt charges / actuarial losses (C$ billions, expenses positive) from the
    Fiscal Monitor 'Summary statement of transactions'. Header is split in two rows: month name (e.g. 'June') above the years
    ('2025' | '2026' | '2025-26' | '2026-27'); data columns = [month prior yr, month current yr, YTD prior, YTD current]."""
    import html as _h
    out = {}
    for tb in re.findall(r"(?is)<table.*?</table>", html):
        rows = []
        for tr in re.findall(r"(?is)<tr.*?</tr>", tb):
            cells = [re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"(?is)<t[hd][^>]*>(.*?)</t[hd]>", tr)]
            if cells:
                rows.append(cells)
        if not any(c and c[0].lower().startswith("budgetary balance (deficit") for c in rows):
            continue
        head = " ".join(" ".join(c) for c in rows[:3]) + " " + _strip_html(tb[:500])
        mname = next((m_ for m_ in re.findall(r"(January|February|March|April|May|June|July|August|September|October|November|December)", head)), None)
        years = [int(y) for y in re.findall(r"\b(20\d\d)\b(?!-)", head)]
        if not mname or not years:
            continue
        cur_y = max(years)
        rec_c, rec_p = {}, {}
        for c in rows:
            lab = c[0].lower()
            nums = [_num(x.replace(",", "").replace("\u2212", "-").replace("\u2013", "-")) for x in c[1:]]
            k = ("rev" if lab.startswith("revenues") else "prog" if lab.startswith("program expenses") else
                 "debt" if lab.startswith("public debt charges") else "act" if lab.startswith("net actuarial") else
                 "bal" if lab.startswith("budgetary balance (deficit") else None)
            if not k or len(nums) < 2:
                continue
            for rec, v in ((rec_p, nums[0]), (rec_c, nums[1])):
                if v is not None and k not in rec:
                    rec[k] = round((abs(v) if k in ("prog", "debt", "act") else v) / 1000, 3)
        mi = MONTHS_FULL.index(mname) + 1
        if "rev" in rec_c and "bal" in rec_c:
            out[f"{cur_y}-{mi:02d}"] = rec_c
        if "rev" in rec_p and "bal" in rec_p:
            out[f"{cur_y - 1}-{mi:02d}"] = rec_p
        break
    return out


def external(D, N):
    meta = D["meta"]
    last = meta.get("ext_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6) and D.get("ext"):
        print("  checked <6h ago — skipping")
        return False
    old = D.get("ext") or {}
    X, errs = {}, {}
    start = (NOW - timedelta(days=31 * 30)).date().isoformat()
    for key, sid in EXT_FRED:
        try:
            pts = _fred(sid, start)
            X[key] = {"src": f"FRED {sid}", "pts": [[d[:7], round(v / 1000, 3)] for d, v in pts][-30:]}   # $ millions -> $ billions
        except Exception as e:
            errs[key] = f"{type(e).__name__}: {e}"[:200]
    try:
        ct = _ca_trade()
        for k, nm in (("bal", "ca_trade_bal"), ("exp", "ca_exports"), ("imp", "ca_imports"), ("exp_us", "ca_exports_us"), ("imp_us", "ca_imports_us"), ("bal_us", "ca_trade_bal_us")):
            if k not in ct:
                continue
            X[nm] = {"src": "Statistics Canada 12-10-0011-01 (BOP basis, SA)", "pts": [[d, round(v / 1000, 3)] for d, v in ct[k]]}
    except Exception as e:
        errs["ca_trade"] = f"{type(e).__name__}: {e}"[:600]
    try:
        cf = _ca_fiscal(old.get("ca_fiscal"))
        X["ca_fiscal"] = cf
    except Exception as e:
        errs["ca_fiscal"] = f"{type(e).__name__}: {e}"[:200]
    for k, v in old.items():
        if k not in X and k not in ("errors",):
            X[k] = v
    X["errors"] = errs
    D["ext"] = X
    meta["ext_checked"] = iso(NOW - timedelta(hours=5, minutes=45)) if errs else iso(NOW)
    meta["asof"]["ext"] = iso(NOW)
    print("  ext:", sorted(k for k in X if k != "errors"), "errors", errs)
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=12) and D.get("inputs"):
        print("  checked <12h ago — skipping")
        return False
    start = (NOW - timedelta(days=31 * 30)).date().isoformat()     # ~2.5 years
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
    meta["inputs_checked"] = iso(NOW)
    meta["asof"]["inputs"] = iso(NOW)
    print("  inputs:", sorted(I["series"]), "errors:", I["errors"])
    return True


# ------------------------------------------------------------------ Canada / Ontario (Statistics Canada)
SC_CROP = {"corn": r"^corn for grain", "soybeans": r"^soybeans?$|^soybeans? \[", "wheat": r"^wheat, all"}
SC_PRICE = {"corn": r"^corn", "soybeans": r"^soybean", "wheat": r"^(ontario )?(winter )?wheat(?!.*including payments)"}
SC_GEOS = ("Ontario", "Canada")


def _sc_table(pid):
    """Stream a full StatCan table (CSV inside a zip) row by row as dicts."""
    import zipfile
    j = get(f"https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/{pid}/en").json()
    url = j.get("object") if isinstance(j, dict) else None
    if not url:
        raise RuntimeError(f"StatCan {pid}: no download URL ({str(j)[:120]})")
    r_ = requests.get(url, headers=UA, timeout=180)
    r_.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r_.content))
    name = next(n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n)
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def _sc_release_times():
    """Latest release timestamp of each StatCan table we track (cheap metadata call) — a change means new data."""
    out = {}
    try:
        r_ = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata", headers={**UA, "Content-Type": "application/json"},
                           data=json.dumps([{"productId": p} for p in (32100359, 32100077, 32100007)]), timeout=25)
        r_.raise_for_status()
        for o in r_.json():
            ob = o.get("object") or {}
            if o.get("status") == "SUCCESS" and ob.get("productId"):
                out[str(ob["productId"])] = ob.get("releaseTime")
    except Exception as e:
        print("  StatCan metadata check failed:", e)
    return out


AAFC_INDEX = "https://agriculture.canada.ca/en/sector/crops/reports-statistics"
_MDY = r"((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d)"


def _strip_html(h):
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", h))))


def ca_calendar(D, N):
    """Canada/Ontario agri calendar from AAFC's latest 'Outlook for Principal Field Crops': its next release date,
    the Statistics Canada releases it announces, and the Chatham (Ontario) corn/soybean price forecasts."""
    meta = D["meta"]
    last = meta.get("ca_calendar_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago — skipping")
        return False
    idx = get(AAFC_INDEX).text
    links = sorted(set(re.findall(r'href="([^"]*canada-outlook-principal-field-crops-(20\d\d-\d\d-\d\d))"', idx)), key=lambda x: x[1])
    if not links:
        raise RuntimeError("no Outlook links on the AAFC index page")
    href, rdate = links[-1]
    url = href if href.startswith("http") else "https://agriculture.canada.ca" + href
    txt = _strip_html(get(url).text)
    ev = []
    m = re.search(r"next AAFC Outlook for Principal Field Crops is scheduled for release on " + _MDY, txt)
    if m:
        ev.append({"date": datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat(), "time": None, "src": "AAFC",
                   "label": "AAFC Outlook for Principal Field Crops", "tables": [], "quote": m.group(0)[:200]})
    for s_ in re.split(r"(?<=[.!?])\s+", txt):
        if not re.search(r"\bSTC\b|Statistics Canada", s_) or not re.search(_MDY, s_):
            continue
        for dm in re.findall(_MDY, s_):
            d = datetime.strptime(dm, "%B %d, %Y").date()
            if d < (NOW - timedelta(days=1)).date():
                continue
            low = s_.lower()
            lab = ("StatCan model-based crop estimates" if "model" in low else
                   "StatCan field crop production (survey)" if "production" in low else
                   "StatCan stocks of principal field crops" if "stock" in low else
                   "StatCan field crop areas" if "area" in low or "seeding" in low else "Statistics Canada field-crop release")
            tables = ["32100359"] if re.search(r"production|model|area", low) else ["32100007"] if "stock" in low else []
            ev.append({"date": d.isoformat(), "time": "08:30", "src": "Statistics Canada", "label": lab, "tables": tables, "quote": s_.strip()[:240]})
    prices = {}
    mc = re.search(r"Chatham average corn price is projected at \$(\d+)\s*/\s*t", txt)
    if mc:
        prices["corn"] = int(mc.group(1))
    ms = re.findall(r"soybean price forecast, track Chatham, (?:is|was)[a-z ]*? (?:to|at) \$(\d+)\s*/\s*t", txt)
    if ms:
        prices["soybeans"] = int(ms[-1])
    seen, uniq = set(), []
    for e in sorted(ev, key=lambda e: e["date"]):
        k = (e["date"], e["label"])
        if k not in seen:
            seen.add(k); uniq.append(e)
    old = D.get("ca_calendar") or {}
    keep = [e for e in old.get("events", []) if e.get("date", "") >= (NOW - timedelta(days=1)).date().isoformat() and (e["date"], e["label"]) not in seen]
    D["ca_calendar"] = {"events": sorted(uniq + keep, key=lambda e: e["date"]), "report": rdate, "report_url": url,
                        "chatham": prices or old.get("chatham", {}), "chatham_report": rdate if prices else old.get("chatham_report")}
    meta["ca_calendar_checked"] = iso(NOW)
    meta["asof"]["ca_calendar"] = iso(NOW)
    print(f"  ca_calendar: report {rdate}, {len(uniq)} new dates, chatham {prices}")
    return True


def _num0(x):
    v = _num(x)
    return v


def canada(D, N):
    meta = D["meta"]
    last = meta.get("canada_checked")
    rel_old = meta.get("canada_release", {})
    rel_new = _sc_release_times()
    changed = [k for k, v in rel_new.items() if v and v != rel_old.get(k)]
    if rel_new:
        meta["canada_watch"] = iso(NOW)
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=20) and not changed:
        print("  no new StatCan release since", last, "— skipping")
        return False
    if changed:
        print("  new StatCan release detected:", changed)
        meta["canada_new_release"] = {"tables": changed, "at": iso(NOW)}
    C = D.setdefault("canada", {})
    seen = {"crops": set(), "disp": set(), "prices": set(), "stocks": set(), "stock_kinds": set()}
    errs = []
    # ---- annual area / yield / production / price (32-10-0359-01) ----
    try:
        acc = {}
        for row in _sc_table(32100359):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            crop, disp = row.get("Type of crop", ""), row.get("Harvest disposition", "")
            seen["crops"].add(crop); seen["disp"].add(disp)
            for k, pat in SC_CROP.items():
                if re.search(pat, crop.strip().lower()):
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        acc.setdefault(k, {}).setdefault(geo, {}).setdefault(disp, {})[row["REF_DATE"][:4]] = v
        MEAS = {"seeded_ac": r"^seeded area \(acres", "harv_ac": r"^harvested area \(acres", "seeded_ha": r"^seeded area \(hectares",
                "harv_ha": r"^harvested area \(hectares", "yield_bu": r"^average yield \(bushels", "yield_kg": r"^average yield \(kilograms",
                "prod_bu": r"^production \(bushels", "prod_t": r"^production \(metric", "price_t": r"^average farm price \(dollars per tonne\)", "value": r"^total farm value"}
        for k, geos in acc.items():
            for geo, disps in geos.items():
                years = sorted({y for d in disps.values() for y in d})[-16:]
                out = {"years": years}
                for key, pat in MEAS.items():
                    src = next((d for name, d in disps.items() if re.search(pat, name.strip().lower())), None)
                    out[key] = [src.get(y) if src else None for y in years]
                C.setdefault(k, {}).setdefault("annual", {})[geo] = out
        if not acc:
            raise RuntimeError("no matching crops")
    except Exception as e:
        errs.append(f"32100359: {e} | crops seen: {sorted(seen['crops'])[:40]} | disp: {sorted(seen['disp'])[:30]}")
    # ---- monthly farm prices (32-10-0077-01) ----
    try:
        pr = {}
        for row in _sc_table(32100077):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            prod = (row.get("Farm products") or "").strip()
            seen["prices"].add(prod)
            for k, pat in SC_PRICE.items():
                pl = prod.lower()
                if k == "wheat" and "durum" in pl and "except durum" not in pl:
                    continue   # durum is a western crop; Ontario wheat is "Wheat (except durum wheat)"
                if re.search(pat, pl) and "dollars per metric tonne" in (row.get("UOM") or "").lower():
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        pr.setdefault(k, {}).setdefault(geo, {}).setdefault(prod, {})[row["REF_DATE"][:7]] = v
        for k, geos in pr.items():
            for geo, prods in geos.items():
                best = max(prods.items(), key=lambda kv: max(kv[1]))     # the product line with the latest data
                ser = sorted(best[1].items())[-36:]
                C.setdefault(k, {}).setdefault("prices", {})[geo] = {"product": best[0], "series": ser}
        if not pr:
            raise RuntimeError("no matching price series")
    except Exception as e:
        errs.append(f"32100077: {e} | products seen: {sorted(seen['prices'])[:40]}")
    # ---- stocks (32-10-0007-01) ----
    try:
        st = {}
        for row in _sc_table(32100007):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            crop = (row.get("Type of crop") or "").strip()
            kind = next((row[c] for c in row if c not in ("REF_DATE", "GEO", "DGUID", "UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID", "VECTOR",
                                                          "COORDINATE", "VALUE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS", "Type of crop")), "")
            seen["stocks"].add(crop); seen["stock_kinds"].add(kind)
            for k, pat in SC_CROP.items():
                if re.search(pat, crop.lower()):
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        st.setdefault(k, {}).setdefault(geo, {}).setdefault(row["REF_DATE"][:7], {})[kind] = v
        for k, geos in st.items():
            for geo, dates in geos.items():
                C.setdefault(k, {}).setdefault("stocks", {})[geo] = [[d, v] for d, v in sorted(dates.items())[-9:]]
        if not st:
            raise RuntimeError("no matching stocks")
    except Exception as e:
        errs.append(f"32100007: {e} | crops: {sorted(seen['stocks'])[:30]} | kinds: {sorted(seen['stock_kinds'])[:20]}")
    meta["canada_dims"] = {"disp": sorted(seen["disp"])[:30], "prices_on": sorted(
        p for p in seen["prices"] if re.search(r"wheat|corn|soy", p.lower()))[:30]}
    if errs:
        meta["canada_errors"] = errs
    else:
        meta.pop("canada_errors", None)
    if not C:
        raise RuntimeError("; ".join(errs)[:1100])
    meta["canada_checked"] = iso(NOW)
    meta["asof"]["canada"] = iso(NOW)
    if rel_new:
        meta["canada_release"] = {**rel_old, **{k: v for k, v in rel_new.items() if v}}
    print("  canada:", {k: list(v) for k, v in C.items()}, "errors:", len(errs))
    return True


BLOCKS = [("fx_spot", fx_spot), ("fx_closes", fx_closes), ("yields", yields), ("cftc_fx", cftc_fx),
          ("cftc_grains", cftc_grains), ("grains_quote", grains_quote), ("energy", energy),
          ("crosses", crosses), ("news", news), ("releases", releases), ("macro", macro), ("settles", settles), ("exports", exports), ("wasde", wasde), ("canada", canada), ("ca_calendar", ca_calendar), ("sd_hist", sd_hist), ("inputs", inputs), ("ext", external), ("ca_retail", ca_retail)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated block names")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    doc = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    D, N = doc["DATA"], doc["NEWS"]
    before = json.dumps(doc, sort_keys=True)
    only = set(a.only.split(",")) if a.only else None
    ok, failed, errors = [], [], {}
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
            errors[name] = f"{type(e).__name__}: {e}"[:1200]
            print(f"  FAILED: {e}")
            traceback.print_exc(limit=1, file=sys.stdout)
    if errors:
        D["meta"]["last_errors"] = errors  # no timestamp: a repeating failure won't commit every run
    else:
        D["meta"].pop("last_errors", None)
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
