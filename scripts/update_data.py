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
import argparse, csv, io, json, os, re, statistics, sys, time, traceback
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
UA = {"User-Agent": "agritrade-desk/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)"}
NOW = datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(TOR).isoformat(timespec="seconds")


SECRET_ENV = ("FAS_API_KEY", "ALPHAVANTAGE_API_KEY", "FINNHUB_API_KEY", "DESK_PASSCODE", "BEA_API_KEY")


def redact(text):
    """Strip every secret value from text that may reach logs or the public data.json."""
    import os
    text = str(text)
    for n in SECRET_ENV:
        v = os.environ.get(n, "").strip()
        if v:
            text = text.replace(v, "***")
    return re.sub(r"(?i)(apikey|api_key|token|key|userid)=[^&\s'\"]+", r"\1=***", text)


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


US_COLS = {"1M": "1 Mo", "2M": "2 Mo", "3M": "3 Mo", "4M": "4 Mo", "6M": "6 Mo", "1Y": "1 Yr", "2Y": "2 Yr", "3Y": "3 Yr", "5Y": "5 Yr", "7Y": "7 Yr",
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
    # forward-curve inputs: both curves' short ends on one close (US CMT bills + BoC T-bill mid yields) and the 2Y/5Y benchmarks
    try:
        ids = {"1M": "TB.CDN.30D.MID", "3M": "TB.CDN.90D.MID", "6M": "TB.CDN.180D.MID", "1Y": "TB.CDN.1Y.MID"}
        obs = valet("observations/" + ",".join(ids.values()) + "/json?recent=20")["observations"]
        bills, bdates = {}, {}
        for o in sorted(obs, key=lambda o: o["d"]):   # oldest -> newest, so each tenor ends on its latest print (1Y bill is not quoted daily)
            for t, c in ids.items():
                v = _num((o.get(c) or {}).get("v"))
                if v is not None and 0 <= v < 15:
                    bills[t], bdates[t] = v, o["d"]
        if len(bills) < 3:
            raise RuntimeError(f"too few T-bill tenors: {bdates}")
        bdate = max(bdates.values())
        cad = ca[d0] if d0 in ca else ca[max(ca)]
        fx["fwd_inputs"] = {
            "us": {"date": d0, "src": "US Treasury daily par yield curve (CMT, bond-equivalent)",
                   "nodes": {k: us[d0][k] for k in ("1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "5Y") if k in us[d0]}},
            "ca": {"date": bdate, "src": "Bank of Canada: T-bill mid yields + GoC benchmark bonds",
                   "nodes": {**bills, **{k: cad[k] for k in ("2Y", "5Y") if k in cad}}, "bond_date": d0 if d0 in ca else max(ca), "node_dates": bdates}}
        for row in fx["rates"]:   # the 1Y row had no Canada benchmark and was never refreshed: use the 1Y bills
            if row["t"] == "1Y" and "1Y" in us[d0]:
                row.update(us=round(us[d0]["1Y"], 3), ca=round(bills["1Y"], 3), sp=round((us[d0]["1Y"] - bills["1Y"]) * 100, 1), asof=d0, ca_src="BoC 1Y T-bill")
        print("  fwd inputs:", fx["fwd_inputs"]["us"]["nodes"], fx["fwd_inputs"]["ca"]["nodes"])
        # forward-curve history: the same inputs as they stood at each of the last official closes (spot = BoC close that day),
        # so the page can reprice yesterday's and last week's curves and show where forward pricing moved
        try:
            byd = {}
            for o in sorted(obs, key=lambda o: o["d"]):
                row = dict(byd[max(byd)]) if byd else {}          # 1Y bill is not quoted daily: carry the last print forward
                for t, c in ids.items():
                    v = _num((o.get(c) or {}).get("v"))
                    if v is not None and 0 <= v < 15:
                        row[t] = v
                byd[o["d"]] = row
            closes = {d: v for d, v in (fx.get("closes") or [])}
            hist = []
            for d in sorted(set(us) & set(ca) & set(byd) & set(closes))[-8:]:
                if len(byd[d]) < 3:
                    continue
                hist.append({"date": d, "spot": closes[d],
                             "us": {k: us[d][k] for k in ("1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "5Y") if k in us[d]},
                             "ca": {**byd[d], **{k: ca[d][k] for k in ("2Y", "5Y") if k in ca[d]}}})
            fx["fwd_hist"] = hist
            print("  fwd history:", [h["date"] for h in hist])
        except Exception as e:
            print("  forward history skipped:", e)
    except Exception as e:
        print("  forward-curve inputs skipped:", e)
    try:
        o = valet("observations/V39079/json?recent=1")["observations"][-1]
        v = o["V39079"]["v"]
        if 0 < float(v) < 10 and (fx["policy"].get("corra_date") or "") <= o["d"]:   # never step back behind a decision already read
            fx["policy"]["corra_now"], fx["policy"]["corra_date"] = float(v), o["d"]
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


def fx_alpha(D, N):
    """USD/CAD from Alpha Vantage CURRENCY_EXCHANGE_RATE — second-tier spot behind the browser's Finnhub stream.
    Free key = 25 requests/day, shared: this backup takes at most 12 (hourly, weekdays 08:00-19:30 ET); the earnings
    board takes up to 12 for adjusted-EPS checks (scripts/earn_watch.py).
    The key is server-only (GitHub secret); every error is redacted before it can reach logs or data.json."""
    import os
    key = os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()
    if not key:
        print("  ALPHAVANTAGE_API_KEY not set - tier skipped")
        return False
    meta, et = D["meta"], NOW.astimezone(TOR)
    if et.weekday() >= 5 or not (8 * 60 <= et.hour * 60 + et.minute <= 19 * 60 + 30):
        print("  outside 08:00-19:30 ET weekdays - skipped")
        return False
    last = meta.get("alpha_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(minutes=59):
        print("  checked <60 min ago - skipping")
        return False
    day = et.date().isoformat()
    cnt = meta.get("alpha_calls") or {}
    if cnt.get("d") != day:
        cnt = {"d": day, "n": 0}
    if cnt["n"] >= 12:
        print("  daily cap (12) reached - skipping")
        return False
    cnt["n"] += 1
    meta["alpha_calls"], meta["alpha_checked"] = cnt, iso(NOW)
    try:
        r_ = requests.get("https://www.alphavantage.co/query", headers=UA, timeout=25,
                          params={"function": "CURRENCY_EXCHANGE_RATE", "from_currency": "USD", "to_currency": "CAD", "apikey": key})
        status = r_.status_code
        j = r_.json() if status == 200 else {}
    except Exception as e:
        raise RuntimeError("Alpha Vantage request failed: " + type(e).__name__) from None   # no URL / key in the message
    q = j.get("Realtime Currency Exchange Rate")
    if not q:
        note = (j.get("Note") or j.get("Information") or j.get("Error Message") or f"HTTP {status}")
        raise RuntimeError("Alpha Vantage: " + redact(note)[:160])
    mid = _num(q.get("5. Exchange Rate"))
    ref = D["fx"]["feed"].get("mid") or mid
    if not mid or abs(mid / ref - 1) > 0.03:
        raise RuntimeError(f"Alpha Vantage USD/CAD {mid} implausible vs {ref}")
    ts = datetime.strptime(q["6. Last Refreshed"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    D["fx"]["alpha"] = {"mid": round(mid, 5), "bid": _num(q.get("8. Bid Price")), "ask": _num(q.get("9. Ask Price")),
                        "ts": iso(ts), "src": "Alpha Vantage (30-min server check)"}
    meta["asof"]["fx_alpha"] = iso(ts)
    print(f"  Alpha Vantage USD/CAD {mid} @ {iso(ts)} (call {cnt['n']}/24 today)")
    return True


# ------------------------------------------------------------------ economic calendar (live, weekly)
FF_FEEDS = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"]
CAL_TZ = ZoneInfo("America/Denver")   # the page's calendar renderer reads stored times as US Mountain


def calendar(D, N):
    """USD + CAD economic calendar (this week and next) from the public ForexFactory JSON feed — replaces the
    week that used to be stored by hand. Keeps any stored event still in the future that the feed does not carry."""
    meta = D["meta"]
    last = meta.get("calendar_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=1):
        print("  checked <1h ago - skipping")
        return False
    rows = []
    for u in FF_FEEDS:
        try:
            rows += get(u).json()
        except Exception as e:
            print("  feed skipped:", u.rsplit("/", 1)[-1], type(e).__name__)
    if not rows:
        raise RuntimeError("no calendar rows from either feed")
    out, seen = [], set()
    for x in rows:
        if x.get("country") not in ("USD", "CAD") or x.get("impact") not in ("High", "Medium", "Low"):
            continue
        try:
            t = datetime.fromisoformat(x["date"]).astimezone(CAL_TZ)
        except Exception:
            continue
        k = (x["country"], x.get("title"), t.isoformat())
        if k in seen:
            continue
        seen.add(k)
        out.append({"date": t.date().isoformat(), "time": t.strftime("%-I:%M%p").lower(), "ccy": x["country"], "event": x.get("title", ""),
                    "impact": x["impact"], "fc": x.get("forecast") or None, "prev": x.get("previous") or None})
    out.sort(key=lambda e: (e["date"], datetime.strptime(e["time"], "%I:%M%p").time() if re.match(r"\d", e["time"]) else datetime.min.time()))
    if len(out) < 5:
        raise RuntimeError(f"only {len(out)} USD/CAD events - feed shape changed?")
    D["fx"]["events"] = out
    meta["calendar_checked"] = iso(NOW)
    meta["asof"]["calendar"] = iso(NOW)
    meta.setdefault("sources", {})["calendar"] = "ForexFactory weekly calendar feed (USD, CAD), times stored as US Mountain"
    print(f"  calendar: {len(out)} USD/CAD events {out[0]['date']}..{out[-1]['date']}")
    return True


# ------------------------------------------------------------------ USD/CAD model: 1-day bias + OLS forecast / scenarios (recomputed daily)
def _closes_yf(sym, period="1y", scale=1.0):
    h = yf().Ticker(sym).history(period=period, interval="1d")
    return {i.date().isoformat(): float(r["Close"]) * scale for i, r in h.iterrows() if r["Close"] == r["Close"]}


def fx_model(D, N):
    """Re-runs the desk's model panel from live inputs instead of leaving a stored run:
    - 1-day bias: sign-weighted driver score (same drivers and weights as the stored model):
      2Y spread d/d (w1.0), 10Y spread d/d (0.8), DXY d/d (1.0), WTI d/d (0.7, oil up -> CAD firmer), CFTC crowding contrarian (0.8),
      25D risk reversal (0.4, only while the FX-options read is <= 7 days old). score = sum(sign*w) / sum(w).
    - OLS 1-day forecast: next-day USD/CAD log return regressed on today's [2Y spread change, DXY return, WTI return] over the
      last 90 day-pairs; P50 = fitted value from the latest day; normal N(P50, residual sigma) gives P10/P90 and the
      bearish / neutral (+-0.25 sigma) / bullish probabilities with conditional expected moves. Backtest MAE vs a zero-return
      forecast over the same window is reported so the panel can say when the model does not beat 'no change'."""
    import math
    meta, fx = D["meta"], D["fx"]
    last = meta.get("model_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=3):
        print("  model ran <3h ago - skipping")
        return False
    R = {r["t"]: r for r in fx["rates"]}
    sg = lambda v: 1 if v and v > 0 else -1 if v and v < 0 else 0
    drivers = []
    def add(name, sign, w, detail):
        drivers.append({"name": name, "sign": sign, "weight": w, "detail": detail})
    for t, w in (("2Y", 1.0), ("10Y", 0.8)):
        dd = (R.get(t) or {}).get("dod")
        if dd is not None:
            add(f"{t} spread 1D change", sg(dd), w, f"{dd:+.1f} bps DoD" + (" (widening US-CA spread supports USD/CAD)" if dd > 0 else " (narrowing spread weighs on USD/CAD)" if dd < 0 else ""))
    dx = fx["fxcross"].get("dxy_chg")
    if dx is not None:
        add("DXY 1D change", sg(dx), 1.0, f"{dx:+.2f}% DoD (broad USD)")
    wti = next((e for e in fx["energy"] if e["name"].startswith("WTI")), None)
    if wti and wti.get("pct") is not None:
        add("WTI 1D change", -sg(wti["pct"]), 0.7, f"{wti['pct']:+.2f}% DoD (oil {'up -> CAD firmer -> USD/CAD down' if wti['pct'] > 0 else 'down -> CAD softer -> USD/CAD up'})")
    po = fx["pos"].get("pct_oi")
    if po is not None:
        s_ = -1 if po <= -20 else 1 if po >= 20 else 0
        add("CFTC crowding (contrarian)", s_, 0.8, f"funds net {po:+.1f}% of OI" + (" - extreme crowded short CAD, squeeze risk argues against chasing USD/CAD up" if s_ < 0 else " - extreme crowded long CAD" if s_ > 0 else " - not crowded"))
    fo = fx.get("fxopt") or {}
    fo_t = (meta["asof"].get("fxopt") or "")
    if fo.get("rr") is not None and fo_t and NOW - datetime.fromisoformat(fo_t) < timedelta(days=7):
        add("25D risk reversal", sg(fo["rr"]), 0.4, f"RR {fo['rr']:+.2f} pp")
    if drivers:
        sc = sum(d["sign"] * d["weight"] for d in drivers) / sum(d["weight"] for d in drivers)
        lab = ("Bullish" if sc >= 0.5 else "Conditional Bullish" if sc >= 0.15 else "Bearish" if sc <= -0.5 else "Conditional Bearish" if sc <= -0.15 else "Neutral") + " USD/CAD"
        fx["bias"] = {"label": lab, "score": round(sc, 3), "drivers": drivers, "asof": iso(NOW),
                      "method": "sign-weighted driver score: sum(sign x weight) / sum(weight); |score| >= 0.15 conditional, >= 0.5 directional"}
    # ---- OLS forecast
    start = (NOW - timedelta(days=260)).date().isoformat()
    cad = dict(_valet_series("FXUSDCAD", 0, start))
    us2 = dict(_fred("DGS2", start))
    grp = valet(f"observations/group/bond_yields_benchmark/json?start_date={start}")
    c2code = next((c for c in grp.get("seriesDetail", {}) if ".2YR." in c.upper()), None)
    ca2 = {o["d"]: _num((o.get(c2code) or {}).get("v")) for o in grp.get("observations", [])} if c2code else {}
    dxy, wti_c = _closes_yf("DX-Y.NYB"), _closes_yf("CL=F")
    days = sorted(d for d in cad if d in us2 and ca2.get(d) is not None and d in dxy and d in wti_c)
    X, Y = [], []
    for i in range(1, len(days) - 1):
        a, b, c = days[i - 1], days[i], days[i + 1]
        X.append([1.0, ((us2[b] - ca2[b]) - (us2[a] - ca2[a])) * 100, math.log(dxy[b] / dxy[a]) * 100, math.log(wti_c[b] / wti_c[a]) * 100])
        Y.append(math.log(cad[c] / cad[b]) * 100)
    X, Y = X[-90:], Y[-90:]
    if len(X) < 40:
        raise RuntimeError(f"model: only {len(X)} aligned day-pairs")
    def solve(A, y):   # normal equations (4x4), Gaussian elimination
        k = len(A[0]); M = [[sum(A[r][i] * A[r][j] for r in range(len(A))) for j in range(k)] + [sum(A[r][i] * y[r] for r in range(len(A)))] for i in range(k)]
        for i in range(k):
            p = max(range(i, k), key=lambda r_: abs(M[r_][i])); M[i], M[p] = M[p], M[i]
            for r_ in range(k):
                if r_ != i:
                    f = M[r_][i] / M[i][i]; M[r_] = [M[r_][j] - f * M[i][j] for j in range(k + 1)]
        return [M[i][k] / M[i][i] for i in range(k)]
    beta = solve(X, Y)
    res = [Y[i] - sum(beta[j] * X[i][j] for j in range(4)) for i in range(len(Y))]
    sig = (sum(e * e for e in res) / max(1, len(res) - 4)) ** 0.5
    a, b = days[-2], days[-1]
    xl = [1.0, ((us2[b] - ca2[b]) - (us2[a] - ca2[a])) * 100, math.log(dxy[b] / dxy[a]) * 100, math.log(wti_c[b] / wti_c[a]) * 100]
    p50 = sum(beta[j] * xl[j] for j in range(4))
    base = cad[b]
    mae = sum(abs(e) for e in res) / len(res) * 100   # bps
    zmae = sum(abs(y) for y in Y) / len(Y) * 100
    Phi = lambda z: 0.5 * (1 + math.erf(z / 2 ** 0.5))
    phi = lambda z: math.exp(-z * z / 2) / (2 * math.pi) ** 0.5
    lo, hi = -0.25 * sig, 0.25 * sig     # neutral = a move within +-0.25 sigma of no change (bands sit around zero, not around P50)
    def band(l, h):   # probability and conditional mean of N(p50, sig) on (l, h)
        zl = -1e9 if l is None else (l - p50) / sig; zh = 1e9 if h is None else (h - p50) / sig
        pr = Phi(zh) - Phi(zl)
        m = p50 + sig * (phi(zl) - phi(zh)) / pr if pr > 1e-9 else p50
        return pr, m
    pb, mb = band(None, lo); pn, mn = band(lo, hi); pu, mu = band(hi, None)
    lvl = lambda pct: round(base * math.exp(pct / 100), 4)
    fx["fc"] = {**{k: v for k, v in (fx.get("fc") or {}).items() if k.endswith("_reason")},
                "p50_pct": round(p50, 3), "p10": round(p50 - 1.2816 * sig, 3), "p90": round(p50 + 1.2816 * sig, 3), "spot50": lvl(p50),
                "mae": round(mae, 2), "zero_mae": round(zmae, 2), "hit": round(sum(1 for i in range(len(Y)) if (Y[i] > 0) == (Y[i] - res[i] > 0)) / len(Y), 4),
                "beta": [round(x, 4) for x in beta], "sigma_pct": round(sig, 3), "train_pairs": len(Y), "origin_date": b, "asof": iso(NOW),
                "features": ["2Y US-CA spread change (bps)", "DXY log return (%)", "WTI log return (%)"]}
    fx["scen"] = {"status": "ok", "horizon": "1D", "model": "OLS baseline",
                  "asof": {"origin_date": b, "base_spot_close": round(base, 4), "base_source": "Bank of Canada FXUSDCAD close at origin", "train_pairs": len(Y)},
                  "method": "normal forecast distribution N(P50, residual sigma); neutral band = no change +/-0.25 sigma; probabilities and conditional expected moves from that distribution",
                  "bullish_usdcad": {"probability_pct": round(pu * 100, 1), "expected_move_pct": round(mu, 3), "range": [lvl(hi), lvl(p50 + 1.2816 * sig)]},
                  "neutral": {"probability_pct": round(pn * 100, 1), "expected_move_pct": round(mn, 3), "range": [lvl(lo), lvl(hi)]},
                  "bearish_usdcad": {"probability_pct": round(pb * 100, 1), "expected_move_pct": round(mb, 3), "range": [lvl(p50 - 1.2816 * sig), lvl(lo)]},
                  "spot_base": round(base, 4), "spot_module_mid": fx["feed"].get("mid")}
    meta["model_checked"] = iso(NOW)
    meta["asof"]["model"] = iso(NOW)
    print(f"  model: bias {fx.get('bias', {}).get('score')} · P50 {p50:+.3f}% sigma {sig:.3f}% · MAE {mae:.1f} vs zero {zmae:.1f} bps · {len(Y)} pairs to {b}")
    return True


# ------------------------------------------------------------------ Fed odds from fed funds futures (FedWatch-style)
def _month_code(y, m):
    return "FGHJKMNQUVXZ"[m - 1] + str(y)[2:]


def fed_odds(D, N):
    """Meeting-by-meeting Fed target probabilities from CBOT 30-day fed funds futures (Yahoo ZQ<m><yy>.CBT) and the
    NY Fed effective rate, the same arithmetic as CME FedWatch: the month average implied by each contract is split into
    pre- and post-meeting days; the implied change is spread over 25 bp steps and chained meeting to meeting."""
    import calendar as _cal, math
    meta, fx = D["meta"], D["fx"]
    last = meta.get("fedodds_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=1):
        print("  checked <1h ago - skipping")
        return False
    effr_j = get("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json").json()["refRates"][0]
    effr, lo0, hi0 = float(effr_j["percentRate"]), float(effr_j["targetRateFrom"]), float(effr_j["targetRateTo"])
    meets = [datetime.fromisoformat(s_).date() for s_ in (D.get("release_cal", {}).get("us_policy", {}).get("dates") or [])]
    today = NOW.astimezone(TOR).date()
    meets = [m for m in meets if m >= today][:3]
    if not meets:
        raise RuntimeError("no upcoming FOMC dates in release_cal.us_policy")
    def avg_rate(y, m):
        px, _, _ = yahoo_last(f"ZQ{_month_code(y, m)}.CBT", "1h")
        if not 90 < px < 100:
            raise RuntimeError(f"ZQ {y}-{m} price {px} implausible")
        return 100 - px
    dist = {0: 1.0}            # number of 25 bp moves vs today's range -> probability
    r_pre = effr
    out = []
    for i, md in enumerate(meets):
        ndays = _cal.monthrange(md.year, md.month)[1]
        nxt = (md.year + (md.month == 12), md.month % 12 + 1)
        next_has_meeting = any((m.year, m.month) == nxt for m in meets)
        if md.day > ndays - 7 and not next_has_meeting:      # late-month meeting: use the following month's contract
            r_post = avg_rate(*nxt)
        else:
            a = avg_rate(md.year, md.month)
            pre_days = md.day
            r_post = (a * ndays - r_pre * pre_days) / (ndays - pre_days)
        steps = (r_post - r_pre) / 0.25
        k = math.floor(steps); w = steps - k
        new = {}
        for n, p in dist.items():
            new[n + k] = new.get(n + k, 0) + p * (1 - w)
            new[n + k + 1] = new.get(n + k + 1, 0) + p * w
        dist = {n: p for n, p in new.items() if p > 0.0005}
        tot = sum(dist.values())
        rng = lambda n: f"{int(round((lo0 + 0.25 * n) * 100))}-{int(round((hi0 + 0.25 * n) * 100))}" + (" (current)" if n == 0 else "")
        out.append({"meeting": md.isoformat(),
                    "no_change_pct": round(dist.get(0, 0) / tot * 100, 1),
                    "hike_pct": round(sum(p for n, p in dist.items() if n > 0) / tot * 100, 1),
                    "ease_pct": round(sum(p for n, p in dist.items() if n < 0) / tot * 100, 1),
                    "ranges": [{"label": rng(n), "prob_pct": round(p / tot * 100, 1)} for n, p in sorted(dist.items())]})
        r_pre = r_post
    fx["policy"]["fed"] = out
    if out:   # Fed expectations revision: keep a snapshot whenever the next-meeting odds change (owner story)
        H = D.setdefault("fed_odds_hist", [])
        snap = {"t": iso(NOW), "meeting": out[0]["meeting"], "hold": out[0]["no_change_pct"], "hike": out[0]["hike_pct"], "ease": out[0]["ease_pct"]}
        if not H or any(H[-1].get(k) != snap[k] for k in ("meeting", "hold", "hike", "ease")):
            H.append(snap)
            del H[:-400]
    fx["policy"]["fed_range"] = f"{int(lo0 * 100)}-{int(hi0 * 100)} (NY Fed target range) · EFFR {effr:.2f}%"
    meta["fedodds_checked"] = iso(NOW)
    meta["asof"]["policy"] = iso(NOW)
    print("  fed odds:", [(o["meeting"], o["no_change_pct"], o["hike_pct"], o["ease_pct"]) for o in out])
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
    today = today or NOW.astimezone(TOR).date()
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
    today = NOW.astimezone(TOR).date().isoformat()
    if M.get("date") == today and M.get("fit"):
        return M["fit"]
    us = us_curve()
    j = valet("observations/group/bond_yields_benchmark/json?start_date=" + (NOW - timedelta(days=420)).date().isoformat())
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
    # labour & demand
    ("us_jolts",    "JOLTS job openings",  "us", "fred", "JTSJOL",          "raw",   "K",  0, "up",   (3000, 15000)),
    ("us_adp",      "ADP private payrolls", "us", "fred", "ADPMNUSNERSA",   "diffk", "K",  0, "up",   (100000000, 160000000)),
    ("us_factory",  "Factory orders",      "us", "fred", "AMTMNO",          "pct",   "%",  1, "up",   (300000, 800000)),
    ("us_durable",  "Durable goods orders", "us", "fred", "DGORDER",        "pct",   "%",  1, "up",   (150000, 450000)),
    ("us_indpro",   "Industrial production", "us", "fred", "INDPRO",        "pct",   "%",  1, "up",   (70, 140)),
    # prices & income
    ("us_ppi",      "PPI final demand",    "us", "fred", "PPIFIS",          "yoy",   "%",  1, "heat", (100, 250)),
    ("us_pce",      "PCE prices",          "us", "fred", "PCEPI",           "yoy",   "%",  1, "heat", (80, 200)),
    ("us_pinc",     "Personal income",     "us", "fred", "PI",              "pct",   "%",  1, "up",   (15000, 40000)),
    ("us_pspend",   "Personal spending",   "us", "fred", "PCE",             "pct",   "%",  1, "up",   (12000, 35000)),
    ("us_import",   "Import prices",       "us", "fred", "IR",              "yoy",   "%",  1, "heat", (80, 220)),
    # housing (thousands of units, seasonally adjusted annual rate)
    ("us_starts",   "Housing starts (SAAR)",      "us", "fred", "HOUST",           "raw",   "K",  0, "up",   (500, 2500)),
    ("us_permits",  "Building permits (SAAR)",    "us", "fred", "PERMIT",          "raw",   "K",  0, "up",   (500, 2500)),
    ("us_nhs",      "New home sales (SAAR)",      "us", "fred", "HSN1F",           "raw",   "K",  0, "up",   (300, 1500)),
    ("us_ism",      "ISM Manufacturing PMI", "us", "ism", "manufacturing",  "level", "",   1, "up",   (25, 80)),
    ("us_ism_svc",  "ISM Services PMI",    "us", "ism", "services",         "level", "",   1, "up",   (25, 80)),
    ("ca_cpi",      "CPI",                 "ca", "valet", "V41690973",      "yoy",   "%",  1, "heat", (100, 250)),
    ("ca_trim",     "CPI-trim",            "ca", "valet", "CPI_TRIM",       "level", "%",  1, "heat", (-2, 12)),
    ("ca_median",   "CPI-median",          "ca", "valet", "CPI_MEDIAN",     "level", "%",  1, "heat", (-2, 12)),
    ("ca_emp",      "Employment change",   "ca", "statcan", 2062811,        "diff",  "K",  1, "up",   (15000, 25000)),
    ("ca_ur",       "Unemployment rate",   "ca", "statcan", 2062815,        "level", "%",  1, "down", (2, 20)),
    ("ca_gdp",      "Real GDP",            "ca", "statcan", 65201210,       "pct",   "%",  1, "up",   (1500000, 3500000)),
    ("ca_starts",   "Housing starts (SAAR)",      "ca", "statcan", 52300157,       "raw",   "K",  1, "up",   (100, 400)),
    ("ca_permits",  "Building permits, value", "ca", "statcan", 1675115467,  "yoy",   "%",  1, "up",   (3000000, 30000000)),
    ("ca_mfg",      "Manufacturing sales (unadj.)", "ca", "statcan", 800025,   "yoy",   "%",  1, "up",   (40000000, 120000000)),
    ("ca_whl",      "Wholesale sales",     "ca", "statcan", 52367637,       "pct",   "%",  1, "up",   (5000000, 200000000)),
    ("ca_ippi",     "Industrial product prices", "ca", "statcan", 1230996007, "yoy", "%",  1, "heat", (80, 200)),
    ("ca_vac",      "Job vacancies",       "ca", "statcan", 1481212145,     "lvlk",  "K",  0, "up",   (100000, 1500000)),
    ("ca_ivey",     "Ivey PMI (s.a.)",     "ca", "ivey", "sa",              "level", "",   1, "up",   (20, 85)),
    # cycle-composite inputs (owner's FRED map): leading hours and financial conditions, lagging credit and labour slack
    ("us_hours",    "Avg weekly hours, manufacturing", "us", "fred", "AWHMAN",  "raw",   "",   1, "up",   (30, 50)),
    ("us_nfci",     "Financial conditions (Chicago Fed NFCI)", "us", "fred", "NFCI", "raw", "", 2, "down", (-3, 10)),
    ("us_udur",     "Avg duration of unemployment (weeks)", "us", "fred", "UEMPMEAN", "raw", "", 1, "down", (3, 60)),
    ("us_isratio",  "Inventories to sales ratio", "us", "fred", "ISRATIO",  "raw",   "",   2, "down", (0.8, 2.5)),
    ("us_busloans", "Commercial & industrial loans", "us", "fred", "BUSLOANS", "yoy", "%",  1, "up",   (1000, 6000)),
    ("us_ccinc",    "Consumer credit to income", "us", "fred", "TOTALSL:1000/PI", "raw",  "%",  1, "up",   (5, 60)),
    # chart-only series for the Macro sub-tab (quarterly GDP bars, policy-rate panels)
    ("ca_gdpq",     "Real GDP (q/q ann., chained 2017 $)", "ca", "statcan", 62305752,       "qann",  "%",  1, "up",   (1500000, 3800000)),
    ("us_policy",   "Fed funds target (upper)", "us", "fred", "DFEDTARU",   "level", "%",  2, "heat", (0, 10)),
    ("ca_policy",   "BoC overnight target", "ca", "valet", "V39079",        "level", "%",  2, "heat", (0, 10)),
]
# Valet series that are StatCan vectors re-published by the BoC: if Valet fails, read the vector from StatCan WDS directly
VALET_TO_STATCAN = {"V41690973": 41690973}   # CPI all-items, 2002=100, NSA (StatCan 18-10-0004-01)
MACRO_LONG = {"us_cpi", "ca_cpi", "us_core_cpi", "us_ur", "ca_ur", "us_gdp", "ca_gdpq", "us_policy", "ca_policy"}


# BLS straight from the source on release mornings. FRED re-posts BLS data with a lag (Nov 6 payrolls: released 8:30 ET,
# on FRED ~10:45 ET), so for these series the desk asks BLS itself while a release is fresh and keeps FRED for history.
BLS_SRC = {"us_nfp": "CES0000000001", "us_ur": "LNS14000000", "us_ahe": "CES0500000003",
           "us_cpi": "CUSR0000SA0", "us_core_cpi": "CUSR0000SA0L1E", "us_ppi": "WPSFD4"}   # identical series to the FRED ids used
BLS_KEY = os.environ.get("BLS_API_KEY", "").strip()


class _KeepNewer(Exception):
    """A source is behind what the desk already shows: keep the newer stored print (not a failure)."""


def _bls_batch(ids):
    """{series id: [(YYYY-MM-01, value)]} in one request; v2 with BLS_API_KEY (never printed), else keyless v1 (25/day per IP)."""
    body = {"seriesid": list(ids), "startyear": str(NOW.year - 2), "endyear": str(NOW.year)}
    if BLS_KEY:
        body["registrationkey"] = BLS_KEY
    url = "https://api.bls.gov/publicAPI/" + ("v2" if BLS_KEY else "v1") + "/timeseries/data/"
    try:
        r = requests.post(url, headers={**UA, "Content-Type": "application/json"}, data=json.dumps(body), timeout=25)
        r.raise_for_status()
        j = r.json()
    except Exception as e:   # scrub: the key is in the body, never the message
        raise RuntimeError(f"BLS request failed ({type(e).__name__})") from None
    if j.get("status") and j["status"] != "REQUEST_SUCCEEDED":   # e.g. keyless daily limit reached: say so instead of returning nothing
        raise RuntimeError(f"BLS {j.get('status')}: {' '.join(j.get('message') or [])[:160]}")
    out = {}
    for ser in (j.get("Results") or {}).get("series", []):
        pts = [(f"{d['year']}-{d['period'][1:]}-01", float(d["value"])) for d in ser.get("data", [])
               if str(d.get("period", "")).startswith("M") and d["period"] != "M13" and _num(d.get("value")) is not None]
        out[ser["seriesID"]] = sorted(pts)
    return out


def _fred(sid, start):
    if "/" in sid:   # calculated ratio of two FRED series on matching dates, in % (e.g. TOTALSL/PI)
        a, b = sid.split("/")
        a, k = (a.split(":") + ["1"])[:2]   # "TOTALSL:1000" = numerator is in millions, divide to match a billions denominator
        den = dict(_fred(b, start))
        return [(d, v / float(k) / den[d] * 100) for d, v in _fred(a, start) if den.get(d)]
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"
    rows = list(csv.reader(io.StringIO(get(url).text)))
    return [(r[0], float(r[1])) for r in rows[1:] if len(r) > 1 and _num(r[1]) is not None]


# Direct BEA read for the BEA-published series. FRED re-posts these with a lag (today: GDP +45 min), while BEA's own
# API carries them the minute the release goes out. The key lives only in the BEA_API_KEY secret: it is sent as a
# request parameter, never printed, and every error raised from here is scrubbed of the URL.
BEA_KEY = os.environ.get("BEA_API_KEY", "").strip()
BEA_SRC = {   # macro key -> (NIPA table, frequency, line description)
    "us_gdp": ("T10101", "Q", "Gross domestic product"),
    "us_core_pce": ("T20804", "M", "PCE excluding food and energy"),
}


def _bea(table, freq, line, years=8):
    yrs = ",".join(str(NOW.year - i) for i in range(years))
    try:
        r = requests.get("https://apps.bea.gov/api/data", headers=UA, timeout=20,
                         params={"UserID": BEA_KEY, "method": "GetData", "datasetname": "NIPA", "TableName": table,
                                 "Frequency": freq, "Year": yrs, "ResultFormat": "JSON"})
        code = getattr(r, "status_code", 200)
        res = r.json()["BEAAPI"]
        res = res.get("Results", res)
        res = res[0] if isinstance(res, list) else res
        err = res.get("Error") or (r.json()["BEAAPI"].get("Error") if isinstance(r.json()["BEAAPI"], dict) else None)
        if err:
            err = err[0] if isinstance(err, list) else err
            raise RuntimeError("API: " + str(err.get("APIErrorDescription") or err.get("ErrorDetail") or err)[:160])
        rows = res["Data"]
    except Exception as e:
        why = str(e) if str(e).startswith("API: ") else type(e).__name__
        if "code" in locals() and code != 200:
            why = f"HTTP {code}"
        raise RuntimeError(redact(f"BEA {table} unavailable ({why})")) from None   # no URL / key in the message
    want = line.lower()
    lines = [x for x in rows if x.get("LineDescription", "").strip().lower() == want]
    if not lines:
        raise RuntimeError(f"BEA {table}: line '{line}' not found")
    ln = min(int(x["LineNumber"]) for x in lines)
    out = []
    for x in lines:
        if int(x["LineNumber"]) != ln:
            continue
        tp, v = x["TimePeriod"], _num(str(x.get("DataValue", "")).replace(",", ""))
        if v is None:
            continue
        if "Q" in tp:
            y, q = tp.split("Q"); d = f"{y}-{(int(q) - 1) * 3 + 1:02d}-01"
        elif "M" in tp:
            y, m = tp.split("M"); d = f"{y}-{int(m):02d}-01"
        else:
            continue
        out.append((d, v))
    return sorted(out)


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
        if how in ("level", "raw"):
            out.append((d, v))
        elif how == "lvlk":
            out.append((d, v / 1000))
        elif how == "diffk" and i > 0:
            out.append((d, (v - points[i-1][1]) / 1000))
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


def _release_times(D, kind):
    """Scheduled release instants (aware datetimes) in the last 8 days for a block."""
    today = NOW.astimezone(TOR).date()
    days = [today - timedelta(days=i) for i in range(8)]
    at = lambda d, h, m: datetime(d.year, d.month, d.day, h, m, tzinfo=TOR)
    if kind == "macro":
        out = []
        for v in (D.get("release_cal") or {}).values():
            for s_ in v.get("dates", []):
                try:
                    out.append(datetime.fromisoformat(s_).replace(tzinfo=TOR))
                except ValueError:
                    pass
            if v.get("rule") == "thu0830":
                out += [at(d, 8, 30) for d in days if d.weekday() == 3]
        return out
    if kind == "exports":
        return [at(d, 8, 30) for d in days if d.weekday() == 3]
    if kind == "cftc":
        return [at(d, 15, 30) for d in days if d.weekday() == 4]
    if kind == "wasde":
        return [at(datetime.fromisoformat(d).date(), 12, 0) for d in WASDE_DATES]
    return []


def recent_release(D, kind, hours=3):
    """True while a scheduled release for this block happened within the last `hours` —
    the 2-6 h 'checked recently' throttles are lifted so new numbers land within minutes."""
    return any(NOW - timedelta(hours=hours) <= t <= NOW for t in _release_times(D, kind))


# ---- purchasing managers' indexes (free, public pages; no keys) ----
# ISM publishes each Report On Business through PR Newswire; the headline value is in the release title / URL
# ("manufacturing-pmi-at-54-5-september-2026-..."). Ivey PMI (Canada) is published by Ivey Business School as a table.
_MN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
_ISM_CACHE = {}


def _ism(kind):
    if "rows" not in _ISM_CACHE:
        rows = {}
        for u in ("https://www.prnewswire.com/news/institute-for-supply-management/",
                  "https://www.prnewswire.com/news/institute-for-supply-management/?page=2&pagesize=100"):
            try:
                t = get(u, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36"}).text
            except Exception:
                continue
            for k, v, mon, yr in re.findall(r"(manufacturing|services)-pmi-at-(\d{2}(?:-\d)?)-(" + "|".join(_MN) + r")-(\d{4})", t, re.I):
                rows[(k.lower(), f"{yr}-{_MN.index(mon.lower()) + 1:02d}-01")] = float(v.replace("-", "."))
        _ISM_CACHE["rows"] = rows
    out = sorted((d, v) for (k, d), v in _ISM_CACHE["rows"].items() if k == kind)
    if not out:
        raise RuntimeError("ISM release list not readable")
    return out


def _ivey(_sid=None):
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", get("https://iveypmi.uwo.ca/historic-data/").text))
    i = t.find("Seasonally Adjusted")   # the seasonally adjusted table comes first on the page
    seen = {}
    for mo, yr, v in re.findall(r"\b(\d{1,2})/(\d{4}) (\d{2}\.\d)(?: \d{2}\.\d){4}", t[i:] if i >= 0 else t):
        seen.setdefault(f"{yr}-{int(mo):02d}-01", float(v))
    if len(seen) < 3:
        raise RuntimeError("Ivey PMI table not readable")
    return sorted(seen.items())


def _bizday(y, m, n):
    """n-th business day of a month (weekends skipped; Jan 1 and US Labor Day skipped)."""
    d, k = datetime(y, m, 1).date(), 0
    while True:
        hol = (d.month == 1 and d.day == 1) or (d.month == 9 and d.weekday() == 0 and d.day <= 7)
        if d.weekday() < 5 and not hol:
            k += 1
            if k == n:
                return d
        d += timedelta(days=1)


FF_MAP = {("USD", "ISM Manufacturing PMI"): "us_ism", ("USD", "ISM Services PMI"): "us_ism_svc", ("CAD", "Ivey PMI"): "ca_ivey",
          ("USD", "JOLTS Job Openings"): "us_jolts", ("USD", "ADP Non-Farm Employment Change"): "us_adp", ("USD", "Factory Orders m/m"): "us_factory",
          ("USD", "Durable Goods Orders m/m"): "us_durable", ("USD", "Industrial Production m/m"): "us_indpro", ("USD", "PPI m/m"): "us_ppi",
          ("USD", "Personal Income m/m"): "us_pinc", ("USD", "Personal Spending m/m"): "us_pspend", ("USD", "Import Prices m/m"): "us_import",
          ("USD", "Housing Starts"): "us_starts", ("USD", "Building Permits"): "us_permits", ("USD", "New Home Sales"): "us_nhs",
          ("USD", "Core PCE Price Index m/m"): "us_pce",
          ("CAD", "Housing Starts"): "ca_starts", ("CAD", "Building Permits m/m"): "ca_permits", ("CAD", "Manufacturing Sales m/m"): "ca_mfg",
          ("CAD", "Wholesale Sales m/m"): "ca_whl", ("CAD", "IPPI m/m"): "ca_ippi"}
# the weekly feed's forecast is used only where it is in the desk's own unit (m/m % vs m/m %, level vs level); otherwise date only
FF_UNIT = {"us_jolts": 1000, "us_adp": 1, "us_factory": 1, "us_durable": 1, "us_indpro": 1, "us_pinc": 1, "us_pspend": 1,
           "us_starts": 1000, "us_permits": 1000, "us_nhs": 1000, "ca_starts": 1, "ca_whl": 1, "us_ism": 1, "us_ism_svc": 1, "ca_ivey": 1}


def _ffnum(x):
    """'7.20M' -> 7.2 (millions), '245K' -> 245, '0.3%' -> 0.3 — in the feed's own unit; FF_UNIT converts to the desk's."""
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*([KMB%]?)\s*$", str(x or ""))
    if not m:
        return None
    v = float(m.group(1))
    return v * {"K": 1, "M": 1, "B": 1, "%": 1, "": 1}[m.group(2)]


def pmi_calendar(D):
    """Release times for the PMIs: ISM = 1st / 3rd business day 10:00 ET; this week's exact times and the market
    forecast from the public weekly calendar feed (no key)."""
    cal = D.setdefault("release_cal", {})
    t0 = NOW.astimezone(TOR)
    for key, nth in (("us_ism", 1), ("us_ism_svc", 3)):
        ds = []
        for i in range(-1, 3):
            y, m = t0.year + (t0.month - 1 + i) // 12, (t0.month - 1 + i) % 12 + 1
            ds.append(_bizday(y, m, nth).isoformat() + "T10:00")
        cal[key] = {"dates": ds, "src": "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/"}
    cons = D.setdefault("macro_cons", {})
    try:
        for e in get("https://nfs.faireconomy.media/ff_calendar_thisweek.json").json():
            key = FF_MAP.get((e.get("country"), e.get("title")))
            if not key:
                continue
            at = datetime.fromisoformat(e["date"]).astimezone(TOR).strftime("%Y-%m-%dT%H:%M")
            c = cal.setdefault(key, {"dates": [], "src": "https://iveypmi.uwo.ca/" if key == "ca_ivey" else "weekly economic calendar (official agency schedules)"})
            if at not in c["dates"]:
                c["dates"] = sorted(set(c["dates"] + [at]))[-6:]
            fc = _ffnum(e.get("forecast"))
            if fc is not None and key in FF_UNIT:
                pv = _ffnum(e.get("previous"))
                cons[key] = {"at": at, "forecast": round(fc * FF_UNIT[key], 2), "previous": None if pv is None else round(pv * FF_UNIT[key], 2)}
    except Exception as e:
        print(f"  pmi calendar: weekly feed unavailable ({type(e).__name__})")


def macro(D, N, only=None):
    """only = set of keys: re-read just those (the fast lane, minutes after a release); the rest are kept as they are."""
    meta = D["meta"]
    last = meta.get("macro_checked")
    if not only and last and NOW - datetime.fromisoformat(last) < timedelta(hours=2) and not recent_release(D, "macro"):
        print("  checked <2h ago — skipping")
        return False
    old = {m["key"]: m for m in D.get("macro", [])}
    try:
        if not only:   # the fast lane only re-reads the awaited series
            pmi_calendar(D)
    except Exception as e:
        print(f"  pmi calendar: {type(e).__name__}")
    start = (NOW - timedelta(days=2650)).date().isoformat()   # ~7 years: 5-yr averages of y/y series
    bls_box = {}
    bls_ok = any(NOW - timedelta(hours=6) <= datetime.fromisoformat(t).replace(tzinfo=TOR) <= NOW
                 for k in BLS_SRC for t in ((D.get("release_cal") or {}).get(k, {}).get("dates") or []))   # a BLS release in the last 6 h

    def bls_new_for(key):
        """Lazy, at most one BLS call per run and one per 4 min across runs (keyless v1 = 25 calls/day)."""
        if "j" not in bls_box:
            bls_box["j"] = None
            lastb = meta.get("bls_fast_at")
            if bls_ok and not (lastb and NOW - datetime.fromisoformat(lastb) < timedelta(minutes=4)):
                meta["bls_fast_at"] = iso(NOW)
                try:
                    bls_box["j"] = _bls_batch(sorted(set(BLS_SRC.values())))
                except Exception as e:
                    print(f"  BLS fast lane unavailable: {e}")
        return (bls_box["j"] or {}).get(BLS_SRC[key], [])
    out, errs = [], {}
    for key, name, group, src, sid, how, unit, dec, good, (lo, hi) in MACRO:
        if only and key not in only:
            if key in old:
                out.append(old[key])
            continue
        label = {"fred": "FRED", "valet": "Bank of Canada Valet", "statcan": "Statistics Canada", "ism": "ISM Report On Business",
                 "ivey": "Ivey PMI"}[src] + ("" if src in ("ism", "ivey") else f" {sid}")
        try:
            raw = None
            if key in BEA_SRC and BEA_KEY:
                try:
                    raw = _bea(*BEA_SRC[key]) or None
                    label = f"BEA {BEA_SRC[key][0]}"
                    meta["bea_status"] = {"ok": True, "at": iso(NOW)}
                except Exception as e_bea:
                    print(f"  {key}: {e_bea}; using {label}")
                    meta["bea_status"] = {"ok": False, "at": iso(NOW), "why": str(e_bea)[:200]}
            if raw is None and src == "valet" and sid in VALET_TO_STATCAN:
                try:
                    raw = _valet_series(sid, 0, start)
                except Exception as e_valet:   # BoC Valet down (e.g. decision-day load): same series straight from StatCan WDS
                    print(f"  {key}: Valet failed ({e_valet}); falling back to StatCan v{VALET_TO_STATCAN[sid]}")
                    raw = _statcan(VALET_TO_STATCAN[sid], 90)
            elif raw is None:
                raw = (_fred(sid, start) if src == "fred" else _ism(sid) if src == "ism" else _ivey(sid) if src == "ivey" else _valet_series(sid, 0, start) if src == "valet" else _statcan(sid, 90))
            prevp = (old.get(key) or {}).get("obs_date") or ""
            if src == "fred" and key in BLS_SRC and bls_ok and raw[-1][0] <= prevp:   # FRED has nothing new yet: ask BLS itself
                got = bls_new_for(key)
                extra = [(d, v) for d, v in got if d > raw[-1][0]]
                if not extra:
                    print(f"  {key}: BLS has nothing newer than {raw[-1][0][:7]} yet ({len(got)} points read)")
                if extra:
                    raw = raw + extra
                    label = "BLS (release) + FRED history"
                    print(f"  {key}: {len(extra)} newer month(s) straight from BLS")
            if prevp and raw[-1][0][:10] < prevp[:10]:   # never step back: a lagging source (FRED before its re-post) cannot replace a newer print
                raise _KeepNewer(f"source still at {raw[-1][0][:10]}; the desk already holds {prevp[:10]}")
            if len(raw) < 3:
                raise RuntimeError("too few points")
            if not all(lo <= v <= hi for _, v in raw[-6:]):
                raise RuntimeError(f"values outside sanity range {lo}-{hi}: {raw[-1][1]} — wrong series id?")
            fq = _freq(raw)
            age = (NOW.date() - datetime.fromisoformat(raw[-1][0][:10]).date()).days
            if age > {"D": 10, "W": 30, "M": 130, "Q": 250}.get(fq, 130):
                raise RuntimeError(f"latest observation {raw[-1][0]} is {age} days old — discontinued series?")
            pts = _transform(raw, how)
            gap = None
            if how == "yoy" and pts and raw[-1][0][:7] > pts[-1][0][:7]:
                # the agency published a newer month, but its year-earlier index does not exist (e.g. BLS did not collect Oct 2025),
                # so no 12-month change exists for it: keep the latest y/y and say what the new month shows
                pm_ = raw[-2][0][:7]; y_, m_ = int(raw[-1][0][:4]), int(raw[-1][0][5:7]); want_ = f"{y_ - 1}-12" if m_ == 1 else f"{y_}-{m_ - 1:02d}"
                gap = {"period": raw[-1][0][:7], "mm": round((raw[-1][1] / raw[-2][1] - 1) * 100, 1) if pm_ == want_ else None,
                       "why": "no 12-month change is published for this month: the year-earlier index was not collected"}
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
                        "freq": fq, "measure": {"yoy": "y/y", "diff": "m/m", "pct": "m/m", "level": "", "qann": "", "raw": "", "lvlk": "", "diffk": "m/m"}[how],
                        "period": _label(pts[-1][0], fq), "obs_date": pts[-1][0],
                        "value": round(val, dec + 1), "prior": round(prv, dec + 1), "chg": round(val - prv, dec + 1),
                        "history": [[_label(d, fq), round(v, dec + 1)] for d, v in pts],
                        "src": label})
            if longp:
                out[-1]["long"] = longp
            _track(out[-1], old.get(key), pts_all)
            if not out[-1].get("seen_at"):   # first time on the desk: if its scheduled release just passed, that is when it printed
                for at in sorted((D.get("release_cal") or {}).get(key, {}).get("dates", []), reverse=True):
                    t_ = datetime.fromisoformat(at).replace(tzinfo=TOR)
                    if t_ <= NOW:
                        if NOW - t_ < timedelta(hours=36):
                            out[-1]["seen_at"] = iso(t_)
                        break
            if key in ("ca_gdpq", "us_policy", "ca_policy"):
                out[-1]["chart_only"] = True
            if gap:
                out[-1]["gap"] = gap
        except _KeepNewer as e:
            print(f"  {key}: {e} — kept")
            out.append(old[key])
        except Exception as e:
            errs[key] = f"{type(e).__name__}: {e}"[:200]
            if key in old:
                out.append(old[key])  # keep the last good reading
    if not out:
        raise RuntimeError(f"all macro series failed: {errs}")
    D["macro"] = out
    for m in out:
        c = (D.get("macro_cons") or {}).get(m["key"])
        if c:
            m["cons"] = c
        else:
            m.pop("cons", None)
    if only:
        meta["asof"]["macro"] = iso(NOW)
        print(f"  macro (fast, {sorted(only)}): {len(only) - len(errs)} fresh, failed {list(errs)}")
        return True
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
            out[k] = OF.build_grain(g, hl, NOW, prev)
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:200]
            if k in prev_all:
                out[k] = prev_all[k]
    if not out:
        raise RuntimeError(f"optflow failed: {errs}")
    D["optflow"] = out
    D["meta"]["asof"]["optflow"] = iso(NOW)
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6) and not recent_release(D, "exports"):
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
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6) and not recent_release(D, "wasde"):
        print("  checked <6h ago — skipping")
        return False
    H = {"X-Api-Key": key}
    # a report only counts once its 12:00 ET release time has passed — not from midnight of release day
    latest = max(d for d in WASDE_DATES if datetime.fromisoformat(d + "T12:00").replace(tzinfo=TOR) <= NOW)
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
        meta["wasde_checked"] = iso(NOW)   # while a new report is still pending in PSD, keep checking every run
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



def policy_watch(D, N):
    """Central-bank decisions (BoC, Fed): adopt the fast lane's earliest sighting from live.json, then check the
    official statement directly if a decision is in its 3-hour window."""
    import policy_watch as PW
    PW.TOR = TOR
    try:
        r_ = requests.get("https://raw.githubusercontent.com/anirudhpdoshi/AGRITrade/live/live.json", headers=UA, timeout=20)
        if r_.ok:
            pw = ((r_.json().get("rel") or {}).get("policy_watch") or {}).get("set", {}).get("policy_watch")
            PW.merge(D, pw)
    except Exception as e:
        print("  live.json carry-over skipped:", e)
    if PW.watch(D, NOW, TOR):
        D["meta"]["asof"]["policy_watch"] = iso(NOW)

# ------------------------------------------------------------------ US Treasury debt maturity wall (official, no key)
FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
UST_TYPES = [("Bills", "Treasury Bills"), ("Notes", "Treasury Notes"), ("Bonds", "Treasury Bonds"),
             ("Treasury Inflation-Protected Securities", "Treasury Inflation-Protected Securities (TIPS)"), ("Floating Rate Notes", "Floating Rate Notes (FRN)")]


def _fd(path, **params):
    q = "&".join(f"{k.replace('[', '%5B').replace(']', '%5D')}={v}" for k, v in params.items())
    return get(FISCAL + path + "?" + q).json().get("data") or []


def ust(D, N):
    """Debt to the Penny (daily) + Monthly Statement of the Public Debt (every marketable security with its maturity) +
    average interest rates. Everything on the tab is computed from these official figures; nothing is modelled."""
    meta = D["meta"]
    last = meta.get("ust_checked")
    if last and NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago - skipping")
        return False
    pen = _fd("v2/accounting/od/debt_to_penny", sort="-record_date", **{"page[size]": 1})[0]
    t1 = _fd("v1/debt/mspd/mspd_table_1", sort="-record_date", **{"page[size]": 40})
    rd = t1[0]["record_date"]
    t1 = [r for r in t1 if r["record_date"] == rd]
    rates = [r for r in _fd("v2/accounting/od/avg_interest_rates", sort="-record_date", **{"page[size]": 40}) if r["security_type_desc"] == "Marketable"]
    rrd = rates[0]["record_date"] if rates else None
    rates = {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in rates if r["record_date"] == rrd}
    rows = _fd("v1/debt/mspd/mspd_table_3_market", filter=f"record_date:eq:{rd}", **{"page[size]": 10000})
    asof = datetime.fromisoformat(rd).date()
    sec = []
    for r in rows:
        amt, mat, cls = _num(r.get("outstanding_amt")), r.get("maturity_date"), r.get("security_class1_desc") or ""
        if amt is None or not mat or mat == "null" or not re.fullmatch(r"[0-9A-Z]{9}", r.get("security_class2_desc") or ""):
            continue   # subtotal / header lines
        cl = cls.lower()
        typ = "Treasury Inflation-Protected Securities" if "inflation" in cl else "Floating Rate Notes" if "floating" in cl else \
              next((k for k in ("Bills", "Notes", "Bonds") if cl.startswith(k.lower())), None)
        if not typ:
            continue
        sec.append((typ, datetime.fromisoformat(mat).date(), amt / 1000.0))   # $ millions -> $ billions
    if len(sec) < 200:
        raise RuntimeError(f"MSPD table 3 looks incomplete ({len(sec)} securities)")
    tot = lambda typ=None: sum(a for t, m, a in sec if (typ is None or t == typ) and m > asof)   # outstanding at the statement date
    marketable = tot()
    ref = asof   # windows run from the statement date: a consistent snapshot (bills maturing since were rolled into new bills not yet in MSPD)
    months = lambda d: (d.year - ref.year) * 12 + d.month - ref.month + (d.day - ref.day) / 30.4
    due = lambda n, typ=None: sum(a for t, m, a in sec if (typ is None or t == typ) and 0 < months(m) <= n)
    live = [(t, m, a) for t, m, a in sec if m > ref]
    wam = sum(a * months(m) for t, m, a in live) / sum(a for t, m, a in live)
    wall = {}
    for t, m, a in sec:
        if 0 < months(m) <= 24.99:
            k = m.strftime("%Y-%m")
            wall[k] = wall.get(k, 0) + a
    buckets = [("< 6M", 0, 6), ("6–12M", 6, 12), ("1–2Y", 12, 24), ("2–5Y", 24, 60), ("5–10Y", 60, 120), ("> 10Y", 120, 9999)]
    prof = [{"label": l, "bn": round(sum(a for t, m, a in sec if lo < months(m) <= hi), 1)} for l, lo, hi in buckets]
    d24 = due(24)
    rate_of = lambda k: next((v for d_, v in rates.items() if ("inflation" in d_.lower()) == ("Inflation" in k) and ("floating" in d_.lower()) == ("Floating" in k)
                              and (k.split()[0].lower() in d_.lower() or "Inflation" in k or "Floating" in k)), None)
    comp = [{"type": lab, "rate": rate_of(k), "due24": round(due(24, k), 1), "pct24": round(due(24, k) / d24 * 100, 1) if d24 else None,
             "out": round(tot(k), 1)} for k, lab in UST_TYPES]
    D["ust"] = {"asof": rd, "penny_date": pen["record_date"], "rates_date": rrd,
                "total_debt_t": round(float(pen["tot_pub_debt_out_amt"]) / 1e12, 3), "public_t": round(float(pen["debt_held_public_amt"]) / 1e12, 3),
                "intragov_t": round(float(pen["intragov_hold_amt"]) / 1e12, 3), "marketable_t": round(marketable / 1000, 3),
                "due12_t": round(due(12) / 1000, 3), "due24_t": round(d24 / 1000, 3), "wam_months": round(wam, 1),
                "wa_rate": rates.get("Total Marketable"), "wall": {k: round(v, 1) for k, v in sorted(wall.items())},
                "profile": prof, "composition": comp, "n_securities": len(sec),
                "src": {"penny": "Treasury Fiscal Data — Debt to the Penny", "mspd": "Monthly Statement of the Public Debt (MSPD), tables 1 and 3",
                        "rates": "Average Interest Rates on U.S. Treasury Securities"}}
    meta["ust_checked"] = iso(NOW)
    meta["asof"]["ust"] = iso(NOW)
    print(f"  ust: debt ${D['ust']['total_debt_t']}T, marketable ${D['ust']['marketable_t']}T, 24M ${D['ust']['due24_t']}T, WAM {wam:.1f} mo, {len(sec)} securities")
    return True


# ------------------------------------------------------------------ US Treasury debt dashboard (us-debt-dashboard.json)
# Official sources only (FiscalData, FRED via fredgraph.csv, CBO carried forward).
# Fast sections (Debt to the Penny, MSPD snapshot, TGA, FRED yields, average rates) re-check
# every 6h like ust(); the MTS / annual-history extension re-checks monthly and only extends
# when a new fiscal year has completed AND its MTS + GDP are published; the CBO Feb 2026
# baseline is carried forward verbatim — a new CBO baseline is a manual update, never fetched.
# Fail-soft: the file is written once, at the end, after validation; any failure raises before
# the write, so the last good JSON stays live and main() logs the error.
DASH_PATH = ROOT / "us-debt-dashboard.json"
DASH_FRED_YIELDS = ("DGS2", "DGS5", "DGS10", "DGS30", "T5YIE", "DTWEXBGS", "BAMLH0A0HYM2", "BAA10Y", "DTB3", "DGS1")
# Blended refinancing yield: bills at live DTB3, notes at live mean(DGS2, DGS5). The FRN / TIPS /
# bond legs have no live series in this dashboard's source set, so they stay the fixed assumptions
# from the Nov 2026 research build, labelled with their vintage in the methods text.
DASH_REFI_FIXED = {"Floating Rate Notes": 4.15, "Inflation-Protected Securities": 4.50, "Bonds": 5.00}


def _fd_paged(path, **params):
    """All pages of a FiscalData query (research used page[size]=10000, 0.2s between pages)."""
    import urllib.parse
    out, page = [], 1
    while True:
        p = dict(params); p["page[size]"] = 10000; p["page[number]"] = page
        d = get(FISCAL + path + "?" + urllib.parse.urlencode(p)).json()
        out.extend(d.get("data") or [])
        if page >= (d.get("meta") or {}).get("total-pages", 1):
            return out
        page += 1
        time.sleep(0.2)


def _fy_end_bday(fy):
    """Sep 30 of a fiscal year, or the preceding Friday when Sep 30 falls on a weekend
    (Debt to the Penny publishes business days only: FY2017 Sat -> Sep 29, FY2018 Sun -> Sep 28,
    FY2023 Sat -> Sep 29)."""
    d = datetime(fy, 9, 30).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _mspd_months(mat, ref):
    return (mat.year - ref.year) * 12 + (mat.month - ref.month) + (mat.day - ref.day) / 30.44


def _mspd_snapshot(rows, ref):
    """Aggregate a security-level MSPD Table 3 pull (marketable only) the way the Nov 2026
    research did (compute_annual.py): marketable outstanding, WAM, maturities by fiscal year
    and by month, and the 12M/24M refinancing class profile with WA coupon. Amounts are
    $ millions in the file, $ billions here."""
    tot, wam_num, wam_den = 0.0, 0.0, 0.0
    by_fy, by_month = {}, {}
    prof = {w: {"cls": {}, "cw": 0.0, "cb": 0.0, "tot": 0.0} for w in ("12M", "24M")}
    for r in rows:
        amt = _num(r.get("outstanding_amt"))
        mat_s = r.get("maturity_date")
        if amt is None or not mat_s or mat_s == "null":
            continue
        amt_b = amt / 1000.0
        mat = datetime.fromisoformat(mat_s).date()
        tot += amt_b
        fy_label = mat.year + 1 if mat.month >= 10 else mat.year
        by_fy[fy_label] = by_fy.get(fy_label, 0.0) + amt_b
        by_month[mat_s[:7]] = by_month.get(mat_s[:7], 0.0) + amt_b
        m = _mspd_months(mat, ref)
        if m > 0:
            wam_num += amt_b * m; wam_den += amt_b
        for win, hi in (("12M", 12), ("24M", 24)):
            if 0 < m <= hi:
                p = prof[win]
                p["tot"] += amt_b
                cls = r.get("security_class1_desc") or "?"
                p["cls"][cls] = p["cls"].get(cls, 0.0) + amt_b
                c = _num(r.get("interest_rate_pct"))
                if c is not None:
                    p["cw"] += amt_b * c; p["cb"] += amt_b
    out = {"marketable_B": round(tot, 3), "wam_months": round(wam_num / wam_den, 2) if wam_den else None,
           "by_fy_B": {str(k): round(v, 3) for k, v in sorted(by_fy.items())},
           "by_month_B": {k: round(v, 3) for k, v in sorted(by_month.items())},
           "profile": {}}
    for win in ("12M", "24M"):
        p = prof[win]
        out["profile"][win] = {"principal_B": round(p["tot"], 1),
                               "by_class_B": {k: round(v, 1) for k, v in sorted(p["cls"].items(), key=lambda x: -x[1])},
                               "coupon_bearing_B": round(p["cb"], 1),
                               "wa_coupon_pct": round(p["cw"] / p["cb"], 2) if p["cb"] else None}
    return out


def _dash_window_total(by_month, start_ym, end_ym):
    return sum(v for k, v in by_month.items() if start_ym <= k <= end_ym)


def _dtp_on(date_s):
    rows = _fd("v2/accounting/od/debt_to_penny", filter=f"record_date:eq:{date_s}",
               fields="record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt")
    return rows[0] if rows else None


def _air_on(date_s):
    rows = _fd("v2/accounting/od/avg_interest_rates", filter=f"record_date:eq:{date_s}",
               fields="record_date,security_desc,avg_interest_rate_amt", **{"page[size]": 50})
    return {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in rows}


def _auctions_fy_gross(fy):
    """Gross marketable issuance in a fiscal year: sum of auction awards (total_accepted)
    by issue date, FiscalData auctions API. $ billions."""
    rows = _fd_paged("v1/accounting/od/auctions_query",
                     filter=f"issue_date:gte:{fy-1}-10-01,issue_date:lte:{fy}-09-30",
                     fields="auction_date,issue_date,total_accepted")
    return round(sum(_num(r.get("total_accepted")) or 0 for r in rows) / 1e9, 3)


def _mts_fy(fy_end):
    """MTS Table 5 at a fiscal year-end (Sep 30): the four totals the dashboard needs.
    Receipts are not a Table 5 row — they are the identity outlays + surplus (the research
    cross-checked that identity to FRED FYFR)."""
    rows = _fd_paged("v1/accounting/mts/mts_table_5", filter=f"record_date:eq:{fy_end}",
                     fields="record_date,classification_desc,current_fytd_net_outly_amt")
    want = {"Total--Interest on Treasury Debt Securities (Gross)": "gross_interest",
            "Total--Interest Received by Trust Funds": "trust_interest",
            "Total Surplus (+) or Deficit (-)": "surplus",
            "Total Outlays": "outlays"}
    out = {}
    for r in rows:
        k = want.get(r.get("classification_desc"))
        if k:
            out[k] = _num(r.get("current_fytd_net_outly_amt"))
    return out


class _DashNotReady(Exception):
    """A source the extension needs is not published yet (expected, e.g. MTS mid-October
    or BEA Q3 GDP late October) — retry next month, not an error."""


def _dash_annual_row(fy, prev_total_T, prior_mspd):
    """Build one annual-history row for a completed fiscal year, from the live official
    sources, with the research's exact formulas (compute_annual.py + assemble_dashboard.py).
    Returns None (via _DashNotReady) when a source is not published yet."""
    fy_end = _fy_end_bday(fy)
    dtp = _dtp_on(str(fy_end))
    if not dtp:
        raise _DashNotReady(f"Debt to the Penny for FY{fy}-end {fy_end} not published yet")
    total_T = float(dtp["tot_pub_debt_out_amt"]) / 1e12
    held_T = float(dtp["debt_held_public_amt"]) / 1e12
    air = _air_on(str(fy_end))
    wa = air.get("Total Marketable")
    if wa is None:
        raise _DashNotReady(f"average interest rates for FY{fy}-end {fy_end} not published yet")
    gross_B = _auctions_fy_gross(fy)
    net_T = total_T - prev_total_T
    refi_T = gross_B / 1000.0 - net_T
    sched_T = None
    if prior_mspd is not None:
        sched_T = prior_mspd["by_fy_B"].get(str(fy), 0) / 1000.0
    mts = _mts_fy(str(fy_end))
    if not all(k in mts and mts[k] is not None for k in ("gross_interest", "trust_interest", "surplus", "outlays")):
        raise _DashNotReady(f"MTS Table 5 for FY{fy}-end {fy_end} not published yet")
    outlays_T = mts["outlays"] / 1e12
    deficit_T = -mts["surplus"] / 1e12
    receipts_T = (mts["outlays"] + mts["surplus"]) / 1e12
    gross_int_T = mts["gross_interest"] / 1e12
    net_int_T = (mts["gross_interest"] + mts["trust_interest"]) / 1e12
    gdp_obs = dict(_fred("GDP", f"{fy-2}-01-01"))
    qs = [f"{fy-1}-10-01", f"{fy}-01-01", f"{fy}-04-01", f"{fy}-07-01"]
    vals = [gdp_obs[q] for q in qs if q in gdp_obs]
    if len(vals) < 4:
        raise _DashNotReady(f"BEA/FRED quarterly GDP for FY{fy} incomplete ({len(vals)}/4 quarters)")
    fy_gdp_T = sum(vals) / len(vals) / 1000.0
    for sid, ours, label in (("FYFR", receipts_T, "receipts"), ("FYONET", outlays_T, "outlays"), ("FYFSD", -deficit_T, "surplus")):
        try:
            fobs = dict(_fred(sid, f"{fy-1}-10-01"))
            fval = fobs.get(f"{fy}-09-30")
            if fval is not None and abs(fval / 1e6 - ours) > max(0.005, abs(ours) * 0.005):
                print(f"  WARNING: FRED {sid} {label} {fval/1e6:.3f}T vs MTS {ours:.3f}T — keeping MTS")
        except Exception as e:
            print(f"  WARNING: FRED {sid} cross-check failed ({redact(str(e))}) — keeping MTS")
    return {
        "fiscal_year": fy, "fy_end": str(fy_end),
        "total_debt_T": round(total_T, 3), "debt_held_public_T": round(held_T, 3),
        "debt_held_public_pct_gdp": round(held_T / fy_gdp_T * 100, 1) if fy_gdp_T else None,
        "total_debt_pct_gdp": round(total_T / fy_gdp_T * 100, 1) if fy_gdp_T else None,
        "fy_nominal_gdp_T": round(fy_gdp_T, 3),
        "wa_marketable_rate_pct": wa,
        "gross_marketable_issuance_T": round(gross_B / 1000.0, 3),
        "net_new_borrowing_T": round(net_T, 3),
        "refinancing_issuance_T": round(refi_T, 3),
        "maturities_actual_T": round(refi_T, 3),
        "scheduled_maturities_at_prior_year_end_T": round(sched_T, 3) if sched_T is not None else None,
        "receipts_T": round(receipts_T, 3), "outlays_T": round(outlays_T, 3), "deficit_T": round(deficit_T, 3),
        "gross_interest_T": round(gross_int_T, 3), "net_interest_T": round(net_int_T, 3),
        "primary_deficit_T": round(deficit_T - net_int_T, 3),
        "net_interest_pct_receipts": round(net_int_T / receipts_T * 100, 2) if receipts_T else None,
    }


def _dash_refi_cost(snap, rates, rates_date, yields):
    """Refinancing cost from an MSPD snapshot profile + latest average rates + live FRED yields.
    Blended yield: bills at live DTB3, notes at live mean(DGS2, DGS5); FRN/TIPS/bond legs are the
    fixed assumptions from the Nov 2026 build. Existing cost: bills at the latest WA bill rate,
    coupon-bearing debt at its WA coupon from the snapshot. Returns (cost_dict, legs) or
    (None, legs) when a live input is missing — the caller then keeps the stored section."""
    wa_mkt = rates.get("Total Marketable")
    wa_bill = rates.get("Treasury Bills")
    dtb3 = yields.get("DTB3", (None, None))[0]
    d2, d5 = yields.get("DGS2", (None, None))[0], yields.get("DGS5", (None, None))[0]
    notes_y = (d2 + d5) / 2 if d2 is not None and d5 is not None else None
    legs = {"dtb3": dtb3, "notes": notes_y,
            "yield_date": None}
    _yd = max([d for _, d in (yields.get("DTB3", (None, None)), yields.get("DGS2", (None, None)), yields.get("DGS5", (None, None))) if d] or [None])
    if _yd:
        legs["yield_date"] = datetime.fromisoformat(_yd).strftime("%b %d, %Y").replace(" 0", " ")

    def blended(win):
        cls = snap["profile"][win]["by_class_B"]
        w = {"Bills Maturity Value": dtb3, "Notes": notes_y,
             "Floating Rate Notes": DASH_REFI_FIXED["Floating Rate Notes"],
             "Inflation-Protected Securities": DASH_REFI_FIXED["Inflation-Protected Securities"],
             "Bonds": DASH_REFI_FIXED["Bonds"]}
        num = sum(cls.get(k, 0) * v for k, v in w.items() if v is not None)
        den = sum(cls.get(k, 0) for k, v in w.items() if v is not None)
        return round(num / den, 2) if den else None

    def exist_cost(win):
        cls = snap["profile"][win]["by_class_B"]
        tot = snap["profile"][win]["principal_B"]
        bills = cls.get("Bills Maturity Value", 0)
        cb = snap["profile"][win]["coupon_bearing_B"]
        wc = snap["profile"][win]["wa_coupon_pct"]
        if wa_bill is None or wc is None or not tot:
            return None
        return round((bills * wa_bill + cb * wc) / tot, 2)

    def incr(principal, old, new):
        return round(principal * (new - old) / 100, 1) if old is not None and new is not None else None

    b12, b24 = blended("12M"), blended("24M")
    e12, e24 = exist_cost("12M"), exist_cost("24M")
    if None in (b12, b24, e12, e24, wa_mkt, wa_bill):
        return None, legs
    p12 = snap["profile"]["12M"]["principal_B"]
    p24 = snap["profile"]["24M"]["principal_B"]
    return {
        "existing_wa_marketable_rate_pct": wa_mkt,
        "existing_wa_marketable_rate_date": rates_date,
        "wa_bill_rate_pct": wa_bill,
        "wa_bill_rate_date": rates_date,
        "maturing_12M": {"principal_B": p12,
                         "wa_coupon_pct_coupon_bearing_only": snap["profile"]["12M"]["wa_coupon_pct"],
                         "coupon_bearing_B": snap["profile"]["12M"]["coupon_bearing_B"],
                         "estimated_existing_cost_pct": e12, "blended_refinancing_yield_pct": b12,
                         "incremental_annual_interest_B": incr(p12, e12, b12),
                         "incremental_vs_all_marketable_avg_B": incr(p12, wa_mkt, b12)},
        "maturing_24M": {"principal_B": p24,
                         "wa_coupon_pct_coupon_bearing_only": snap["profile"]["24M"]["wa_coupon_pct"],
                         "coupon_bearing_B": snap["profile"]["24M"]["coupon_bearing_B"],
                         "estimated_existing_cost_pct": e24, "blended_refinancing_yield_pct": b24,
                         "incremental_annual_interest_B": incr(p24, e24, b24)},
        "sensitivity_12M_B_per_year": {"+50bps": round(p12 * 0.005, 1), "+100bps": round(p12 * 0.01, 1), "+200bps": round(p12 * 0.02, 1)},
        "sensitivity_24M_B_per_year": {"+50bps": round(p24 * 0.005, 1), "+100bps": round(p24 * 0.01, 1), "+200bps": round(p24 * 0.02, 1)},
        "cumulative_2yr_incremental_B": round(incr(p12, e12, b12) + incr(p24 - p12, e24, b24), 1),
    }, legs


def ust_dashboard(D, N):
    """Regenerate us-debt-dashboard.json (Treasury tab) from the official sources.
    Fast sections (Debt to the Penny, MSPD snapshot, TGA, FRED yields, average rates) re-check
    every 6h like ust(); the MTS / annual-history extension re-checks monthly and only extends
    when a new fiscal year has completed AND its MTS + GDP are published; the CBO Feb 2026
    baseline is carried forward verbatim. Each fast sub-section is attempted independently — a
    dead feed keeps its stored values (with a warning) instead of failing the block. The file is
    written once, at the end, after validation; any structural failure raises before the write,
    so the last good JSON stays live and main() logs the error."""
    meta = D["meta"]
    last6 = meta.get("ust_dashboard_checked")
    last_mts = meta.get("ust_dashboard_mts_checked")
    do_fast = not last6 or NOW - datetime.fromisoformat(last6) >= timedelta(hours=6)
    do_mts = not last_mts or NOW - datetime.fromisoformat(last_mts) >= timedelta(days=30)
    if not do_fast and not do_mts:
        print("  checked <6h ago (MTS <30d) - skipping")
        return False
    if not DASH_PATH.exists():
        raise RuntimeError("us-debt-dashboard.json not found — a full rebuild is a manual research step, not a pipeline refresh")
    stored = json.loads(DASH_PATH.read_text(encoding="utf-8"))
    new = json.loads(json.dumps(stored))
    src_dates = []

    def _window_ym(ref_date, n_months):
        y, m = ref_date.year, ref_date.month
        out = []
        for _ in range(n_months):
            m += 1
            if m > 12:
                m = 1; y += 1
            out.append(f"{y:04d}-{m:02d}")
        return out

    # ---- fast sections (6h) ----
    if do_fast:
        # Debt to the Penny, latest
        try:
            pen = _fd("v2/accounting/od/debt_to_penny", sort="-record_date", **{"page[size]": 1})[0]
            total_T = float(pen["tot_pub_debt_out_amt"]) / 1e12
            old_total = (stored.get("current_snapshot_crosscheck") or {}).get("total_debt_T")
            if old_total and abs(total_T - old_total) / old_total > 0.01:
                raise RuntimeError(f"Debt to the Penny jumped {old_total}T -> {total_T}T — refusing to publish")
            if not (30 < total_T < 60):
                raise RuntimeError(f"Debt to the Penny implausible: {total_T}T")
            new["current_snapshot_crosscheck"]["total_debt_T"] = round(total_T, 3)
            new["current_snapshot_crosscheck"]["total_debt_date"] = pen["record_date"]
            src_dates.append(pen["record_date"])
            print(f"  debt to the penny: ${total_T:.3f}T at {pen['record_date']}")
        except Exception as e:
            print(f"  WARNING: debt to the penny refresh failed ({redact(str(e))}) — keeping stored")
        # MSPD: Table 1 gives the latest statement date cheaply; Table 3 only re-fetches on a new statement
        snap = None
        snap_date = (stored.get("current_snapshot_crosscheck") or {}).get("mspd_date")
        try:
            t1 = _fd("v1/debt/mspd/mspd_table_1", sort="-record_date", **{"page[size]": 40})
            rd = t1[0]["record_date"]
            t1_mkt = sum((_num(r.get("total_mil_amt")) or 0) for r in t1
                         if r["record_date"] == rd and r.get("security_type_desc") == "Marketable") / 1000.0
            if snap_date and rd <= snap_date:
                print(f"  MSPD still {snap_date} — forward schedule unchanged")
            else:
                rows = _fd_paged("v1/debt/mspd/mspd_table_3",
                                 filter=f"record_date:eq:{rd},security_type_desc:eq:Marketable",
                                 fields="record_date,security_type_desc,security_class1_desc,security_class2_desc,security_class3_desc,interest_rate_pct,issue_date,maturity_date,issued_amt,outstanding_amt")
                ref = datetime.fromisoformat(rd).date()
                snap = _mspd_snapshot(rows, ref)
                if abs(snap["marketable_B"] - t1_mkt) / t1_mkt > 0.01:
                    raise RuntimeError(f"MSPD Table 3 (${snap['marketable_B']:,.1f}B) vs Table 1 (${t1_mkt:,.1f}B) disagree >1%")
                first_fy = ref.year + 1 if ref.month >= 10 else ref.year
                months24 = _window_ym(ref, 24)
                w12 = _dash_window_total(snap["by_month_B"], months24[0], months24[11])
                w24 = _dash_window_total(snap["by_month_B"], months24[0], months24[23])
                if abs(w12 - snap["profile"]["12M"]["principal_B"]) > 0.5 or abs(w24 - snap["profile"]["24M"]["principal_B"]) > 0.5:
                    raise RuntimeError(f"MSPD window totals {w12:.1f}/{w24:.1f}B disagree with class profile "
                                       f"{snap['profile']['12M']['principal_B']:.1f}/{snap['profile']['24M']['principal_B']:.1f}B")
                if snap["wam_months"] is None or not (20 <= snap["wam_months"] <= 150):
                    raise RuntimeError(f"MSPD WAM implausible: {snap['wam_months']}")
                label = ref.strftime("%b %d, %Y")
                new["forward_maturity_schedule"] = {
                    "snapshot": f"MSPD Table 3, {label} (marketable securities only)",
                    "total_marketable_B": snap["marketable_B"],
                    "wam_months": snap["wam_months"],
                    "maturing_12M_B": snap["profile"]["12M"]["principal_B"],
                    "maturing_24M_B": snap["profile"]["24M"]["principal_B"],
                    "maturing_by_fiscal_year_B": {str(fy): snap["by_fy_B"].get(str(fy), 0.0) for fy in range(first_fy, first_fy + 4)},
                    "maturing_by_month_B": {k: v for k, v in sorted(snap["by_month_B"].items()) if k in months24},
                    "maturity_profile_by_tenor_B": {"0-12M": snap["profile"]["12M"]["principal_B"],
                                                    "12-24M": round(snap["profile"]["24M"]["principal_B"] - snap["profile"]["12M"]["principal_B"], 1)},
                    "refinancing_profile": snap["profile"],
                }
                cc = new["current_snapshot_crosscheck"]
                cc["marketable_T"] = round(snap["marketable_B"] / 1000, 3)
                cc["marketable_date"] = rd
                cc["maturing_12M_T"] = round(snap["profile"]["12M"]["principal_B"] / 1000, 3)
                cc["maturing_24M_T"] = round(snap["profile"]["24M"]["principal_B"] / 1000, 3)
                cc["wam_months"] = round(snap["wam_months"], 1)
                cc["mspd_date"] = rd
                snap_date = rd
                src_dates.append(rd)
                print(f"  MSPD {rd}: marketable ${snap['marketable_B']:,.1f}B, 12M ${snap['profile']['12M']['principal_B']:,.1f}B, WAM {snap['wam_months']} mo")
        except Exception as e:
            print(f"  WARNING: MSPD refresh failed ({redact(str(e))}) — keeping stored forward schedule")
            snap = None
        # Average interest rates, latest month
        rates, rates_date = {}, None
        try:
            arr = _fd("v2/accounting/od/avg_interest_rates", sort="-record_date", **{"page[size]": 40})
            rates_date = arr[0]["record_date"]
            rates = {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in arr if r["record_date"] == rates_date}
            src_dates.append(rates_date)
        except Exception as e:
            print(f"  WARNING: average interest rates refresh failed ({redact(str(e))}) — keeping stored")
        # FRED market yields, latest (fredgraph.csv, no key — same as _fred)
        yields = {}
        start = (NOW - timedelta(days=40)).date().isoformat()
        for sid in DASH_FRED_YIELDS:
            try:
                obs = _fred(sid, start)
                if obs:
                    d, v = obs[-1]
                    old = (stored.get("risk_indicators") or {}).get(sid) or {}
                    if not old.get("date") or d >= old["date"]:
                        new["risk_indicators"][sid] = {"value": v, "date": d}
                        yields[sid] = (v, d)
                        src_dates.append(d)
            except Exception as e:
                print(f"  WARNING: FRED {sid} refresh failed ({redact(str(e))}) — keeping stored")
        # Refinancing cost from the current snapshot profile + live rates + live yields
        try:
            prof = (new.get("forward_maturity_schedule") or {}).get("refinancing_profile") or (stored.get("forward_maturity_schedule") or {}).get("refinancing_profile")
            if prof and rates and yields:
                cost, legs = _dash_refi_cost({"profile": prof}, rates, rates_date, yields)
                if cost is not None:
                    new["refinancing_cost"] = cost
                    if legs.get("yield_date"):
                        new["methods"]["blended_refinancing_yield"] = (
                            "Estimate, not an official figure. Weights the " + legs["yield_date"] + " market yields by the maturing "
                            "principal by class: bills at the 3-month bill rate (DTB3 " +
                            (f"{legs['dtb3']:.2f}%" if legs.get("dtb3") is not None else "n/a") + "), notes at the mean of 2Y/5Y (" +
                            (f"{legs['notes']:.2f}%" if legs.get("notes") is not None else "n/a") + "), FRNs at 4.15% (fixed assumption, "
                            "Nov 2026), TIPS at 4.50% (nominal-equivalent, fixed assumption, Nov 2026), bonds at 5.00% (fixed "
                            "assumption, Nov 2026). See refinancing_cost for the components.")
                    new["methods"]["existing_cost_of_maturing_stock"] = (
                        "Estimate. Bills at the WA bill rate (" + f"{rates.get('Treasury Bills'):.2f}%, FiscalData avg_interest_rates " +
                        (datetime.fromisoformat(rates_date).strftime("%b %Y") if rates_date else "n/a") + "); coupon-bearing maturing debt at its WA coupon (MSPD-derived). Bills' true issue "
                        "yields are not in the MSPD (discount instruments), so this is an approximation, labelled as such.")
                    print(f"  refinancing cost: 12M blended {cost['maturing_12M']['blended_refinancing_yield_pct']}% vs existing "
                          f"{cost['maturing_12M']['estimated_existing_cost_pct']}% -> +${cost['maturing_12M']['incremental_annual_interest_B']}B/yr")
                else:
                    print("  WARNING: refinancing cost inputs incomplete — keeping stored")
            else:
                print("  WARNING: refinancing cost inputs incomplete — keeping stored")
        except Exception as e:
            print(f"  WARNING: refinancing cost refresh failed ({redact(str(e))}) — keeping stored")
        # TGA cash balance, latest (Daily Treasury Statement; close_today_bal is null — open_today_bal is the balance)
        try:
            tga = _fd("v1/accounting/dts/operating_cash_balance",
                      filter="account_type:eq:Treasury General Account (TGA) Closing Balance",
                      sort="-record_date", **{"page[size]": 1})[0]
            bal = _num(tga.get("open_today_bal"))
            if bal is not None:
                svc = new["servicing_capacity"]
                if not svc.get("tga_balance_date") or tga["record_date"] >= svc["tga_balance_date"]:
                    svc["tga_balance_B"] = round(bal / 1000, 3)  # DTS amounts are $ millions
                    svc["tga_balance_date"] = tga["record_date"]
                    src_dates.append(tga["record_date"])
                    print(f"  TGA: ${bal/1000:.3f}B at {tga['record_date']}")
        except Exception as e:
            print(f"  WARNING: TGA refresh failed ({redact(str(e))}) — keeping stored")
        # Forward borrowing need: MSPD-derived parts move with the live snapshot; CBO parts are carried
        try:
            hist = new.get("annual_history_fy2015_2026") or []
            latest_fy = max((r["fiscal_year"] for r in hist), default=None)
            if latest_fy:
                last_row = next(r for r in hist if r["fiscal_year"] == latest_fy)
                intra_B = round((last_row["total_debt_T"] - last_row["debt_held_public_T"]) * 1000, 0)
                fwd_sched = new.get("forward_maturity_schedule") or {}
                by_fy = fwd_sched.get("maturing_by_fiscal_year_B") or {}
                for key, fwd in (new.get("forward_borrowing_need") or {}).items():
                    fy = int(key[2:])
                    if str(fy) not in by_fy or "cbo_deficit_B" not in fwd or "debt_held_public_B" not in fwd:
                        continue
                    fwd["principal_maturing_B"] = round(by_fy[str(fy)], 1)
                    fwd["expected_gross_issuance_B"] = round(by_fy[str(fy)] + abs(fwd["cbo_deficit_B"]), 1)
                    fwd["total_debt_estimate_B"] = int(round(fwd["debt_held_public_B"] + intra_B + 200 * (fy - latest_fy), 0))
                new["methods"]["total_debt_forward_estimate"] = (
                    "CBO projects debt held by the public only. Total debt shown = CBO debt held by the public + "
                    f"intragovernmental holdings (${intra_B:,.0f}B at Sep 30, {latest_fy}) grown ~$0.2T/yr (recent trend). "
                    "Labelled estimate, not a CBO figure.")
        except Exception as e:
            print(f"  WARNING: forward borrowing need refresh failed ({redact(str(e))}) — keeping stored")
        # Cross-check note + data vintage
        try:
            cc = new["current_snapshot_crosscheck"]
            cc["wa_rate_pct"] = rates.get("Total Marketable", cc.get("wa_rate_pct"))
            _md = datetime.fromisoformat(cc["mspd_date"]).strftime("%b %d, %Y").replace(" 0", " ") if cc.get("mspd_date") else "n/a"
            _fs = new.get("forward_maturity_schedule") or {}
            _m12 = _fs.get("maturing_12M_B", (cc.get("maturing_12M_T") or 0) * 1000)
            _m24 = _fs.get("maturing_24M_B", (cc.get("maturing_24M_T") or 0) * 1000)
            cc["note"] = ("Reproduced exactly from the MSPD " + _md + " snapshot "
                          f"(12M ${_m12:,.1f}B, 24M ${_m24:,.1f}B, "
                          f"WAM {cc.get('wam_months')} mo, WA rate {cc.get('wa_rate_pct')}%).")
        except Exception as e:
            print(f"  WARNING: cross-check note refresh failed ({redact(str(e))}) — keeping stored")
        # Servicing notes (derived text — regenerated from the current figures every run)
        try:
            svc = new["servicing_capacity"]
            fy = svc["fiscal_year"]
            cbo = new.get("cbo_baseline") or {}
            cbo_fy = cbo.get(f"fy{fy}") or cbo.get("fy2026_projection") or {}
            if cbo_fy.get("outlays_B") and svc.get("outlays_T"):
                gap = round(svc["outlays_T"] * 1000 - cbo_fy["outlays_B"], 0)
                svc["mandatory_note"] = (
                    f"CBO Feb 2026 baseline projection for FY{fy}, not an MTS actual; the MTS does not publish a "
                    "mandatory/discretionary split. Actual FY" + str(fy) + " outlays "
                    f"(${svc['outlays_T']*1000:,.0f}B) came in ${abs(gap):,.0f}B {'below' if gap < 0 else 'above'} "
                    f"CBO's ${cbo_fy['outlays_B']:,.0f}B projection.")
            if svc.get("tga_balance_B") and svc.get("deficit_T") and svc.get("primary_deficit_T"):
                yrs = svc["tga_balance_B"] / (svc["deficit_T"] * 1000)
                svc["cash_after_interest_note"] = (
                    f"Primary deficit (-${svc['primary_deficit_T']*1000:,.0f}B) is the cash shortfall before interest; "
                    f"the total deficit (-${svc['deficit_T']*1000:,.0f}B) is after interest. The TGA balance "
                    f"(${svc['tga_balance_B']:,.0f}B) covers ~{yrs:.2f} years of the total deficit at the FY{fy} run-rate.")
        except Exception as e:
            print(f"  WARNING: servicing notes refresh failed ({redact(str(e))}) — keeping stored")
        # Gaps that carry live numbers (the structural caveats stay verbatim)
        try:
            gaps = new.get("gaps_and_unverified") or []
            fwd = new.get("forward_borrowing_need") or {}
            fwd_keys = sorted(fwd.keys())
            if len(fwd_keys) >= 2 and len(gaps) > 0:
                fy2 = int(fwd_keys[1][2:])
                _sd = datetime.fromisoformat(snap_date).strftime("%b %d, %Y").replace(" 0", " ") if snap_date else "n/a"
                gaps[0] = (f"Forward FY{fy2} maturities (${fwd[fwd_keys[1]].get('principal_maturing_B', 0):,.0f}B) are CONFIRMED "
                           f"maturities only — securities outstanding as of {_sd}. Bills issued during FY{fy2-1} that "
                           f"mature in FY{fy2} are not in the snapshot, so the FY{fy2} maturity and gross-issuance figures will rise "
                           "as new bills are issued. The 12M/24M windows have the same property.")
            hist = new.get("annual_history_fy2015_2026") or []
            if hist and len(gaps) > 9:
                last_row = hist[-1]
                cbo = new.get("cbo_baseline") or {}
                proj = cbo.get(f"fy{last_row['fiscal_year']}") or cbo.get("fy2026_projection") or {}
                if proj.get("debt_held_public_B") and proj.get("deficit_B") is not None:
                    held_actual = round(last_row["debt_held_public_T"] * 1000, 0)
                    miss = round(held_actual - proj["debt_held_public_B"], 0)
                    def_gap = round(last_row["deficit_T"] * 1000 + proj["deficit_B"], 0)
                    gaps[9] = (f"CBO's debt-held-by-the-public projection for FY{last_row['fiscal_year']} "
                               f"(${proj['debt_held_public_B']:,.0f}B) came in ${abs(miss):,.0f}B "
                               f"{'below' if miss > 0 else 'above'} the actual (${held_actual:,.0f}B) because the actual "
                               f"FY{last_row['fiscal_year']} deficit (${last_row['deficit_T']*1000:,.0f}B) "
                               f"{'exceeded' if def_gap > 0 else 'came in below'} CBO's projection (${-proj['deficit_B']:,.0f}B).")
            new["gaps_and_unverified"] = gaps
        except Exception as e:
            print(f"  WARNING: gaps refresh failed ({redact(str(e))}) — keeping stored")
        # Latest MTS month (for the MTS gap note) + GFDEBTN lag check
        try:
            mts_latest = _fd("v1/accounting/mts/mts_table_5", sort="-record_date", **{"page[size]": 1})[0]["record_date"]
            gaps = new.get("gaps_and_unverified") or []
            if len(gaps) > 7:
                nxt = datetime.fromisoformat(mts_latest)
                nm = (nxt.replace(day=1) + timedelta(days=32)).replace(day=1)
                hist = new.get("annual_history_fy2015_2026") or []
                last_fy = hist[-1]["fiscal_year"] if hist else None
                gaps[7] = (f"MTS for {nm.strftime('%B %Y')} is not yet published (as of {NOW.date().strftime('%b %d, %Y').replace(' 0', ' ')}), so the "
                           f"annual figures in this file run through FY{last_fy} (Oct {last_fy-1}–Sep {last_fy})." if last_fy else gaps[7])
            try:
                gf = _fred("GFDEBTN", f"{(new.get('annual_history_fy2015_2026') or [{}])[-1].get('fiscal_year', 2026)-1}-01-01")
                if gf and len(gaps) > 5:
                    last_gf_date = gf[-1][0]
                    fy_end_s = (new.get("annual_history_fy2015_2026") or [{}])[-1].get("fy_end", "")
                    if fy_end_s and last_gf_date >= fy_end_s:
                        gaps[5] = ("FRED GFDEBTN (quarterly total debt) now covers the latest fiscal year-end; "
                                   "FiscalData Debt to the Penny remains the authoritative source for it.")
            except Exception:
                pass
            new["gaps_and_unverified"] = gaps
        except Exception as e:
            print(f"  WARNING: MTS recency check failed ({redact(str(e))}) — keeping stored gaps")
        new["prepared"] = NOW.date().isoformat()
        if src_dates:
            new["data_as_of"] = max(src_dates)
        meta["ust_dashboard_checked"] = iso(NOW)

    # ---- monthly MTS / annual-history extension ----
    if do_mts:
        try:
            hist = new.get("annual_history_fy2015_2026") or []
            last_fy = max((r["fiscal_year"] for r in hist), default=None)
            today = NOW.date()
            latest_completed_fy = today.year if today >= datetime(today.year, 9, 30).date() else today.year - 1
            if last_fy is None or latest_completed_fy <= last_fy:
                print(f"  annual history already through FY{last_fy} — no extension due")
            else:
                new_fy = last_fy + 1
                prev_total = hist[-1]["total_debt_T"]
                try:  # unrounded prior year-end total avoids a $1M rounding bias in net/refinancing
                    _prev_dtp = _dtp_on(str(_fy_end_bday(last_fy)))
                    if _prev_dtp:
                        prev_total = float(_prev_dtp["tot_pub_debt_out_amt"]) / 1e12
                except Exception as e:
                    print(f"  WARNING: prior FY-end Debt to the Penny unavailable ({redact(str(e))}) — using stored rounded total")
                prior_end = _fy_end_bday(new_fy - 1)
                prior_rows = _fd_paged("v1/debt/mspd/mspd_table_3",
                                       filter=f"record_date:eq:{prior_end},security_type_desc:eq:Marketable",
                                       fields="record_date,security_type_desc,security_class1_desc,security_class2_desc,security_class3_desc,interest_rate_pct,issue_date,maturity_date,issued_amt,outstanding_amt")
                prior_snap = _mspd_snapshot(prior_rows, prior_end)
                row = _dash_annual_row(new_fy, prev_total, prior_snap)
                hist.append(row)
                new["annual_history_fy2015_2026"] = hist
                print(f"  annual history extended: FY{new_fy} debt ${row['total_debt_T']}T, net interest ${row['net_interest_T']}T "
                      f"({row['net_interest_pct_receipts']}% of receipts)")
                # Roll servicing capacity to the new fiscal year (CBO split carried if the baseline lacks the year)
                svc = new["servicing_capacity"]
                cbo = new.get("cbo_baseline") or {}
                cbo_fy = cbo.get(f"fy{new_fy}") or {}
                if not cbo_fy:
                    print(f"  WARNING: CBO baseline has no FY{new_fy} — servicing mandatory/discretionary carried from FY{svc['fiscal_year']}")
                svc.update({
                    "fiscal_year": new_fy, "receipts_T": row["receipts_T"], "outlays_T": row["outlays_T"],
                    "deficit_T": row["deficit_T"], "gross_interest_T": row["gross_interest_T"],
                    "net_interest_T": row["net_interest_T"], "primary_deficit_T": row["primary_deficit_T"],
                    "net_interest_pct_receipts": row["net_interest_pct_receipts"],
                    "gross_interest_pct_receipts": round(row["gross_interest_T"] / row["receipts_T"] * 100, 2),
                    "mandatory_B_cbo_baseline": cbo_fy.get("mandatory_B", svc.get("mandatory_B_cbo_baseline")),
                    "discretionary_B_cbo_baseline": cbo_fy.get("discretionary_B", svc.get("discretionary_B_cbo_baseline")),
                    "derived_mandatory_actual_B": round(row["outlays_T"] * 1000 - svc.get("discretionary_B_cbo_baseline", 0) - row["net_interest_T"] * 1000, 0),
                })
                new["methods"]["mandatory_discretionary_actual"] = (
                    "The MTS does not publish a mandatory/discretionary split. FY" + str(new_fy) + " mandatory/discretionary "
                    "shown are CBO Feb 2026 baseline projections; a derived actual mandatory is also given (actual outlays "
                    "minus CBO discretionary minus actual net interest) and labelled derived.")
            meta["ust_dashboard_mts_checked"] = iso(NOW)
        except _DashNotReady as e:
            print(f"  FY extension not ready yet: {e} — retrying next month")
            meta["ust_dashboard_mts_checked"] = iso(NOW)
        except Exception:
            raise

    # ---- validate the combined file before writing ----
    hist = new.get("annual_history_fy2015_2026") or []
    prev = None
    for r in hist:
        if abs(r["refinancing_issuance_T"] - (r["gross_marketable_issuance_T"] - r["net_new_borrowing_T"])) > 0.011:
            raise RuntimeError(f"annual history FY{r['fiscal_year']}: refinancing != gross - net")
        if prev is not None and abs(r["net_new_borrowing_T"] - (r["total_debt_T"] - prev)) > 0.011:
            raise RuntimeError(f"annual history FY{r['fiscal_year']}: net borrowing != change in total debt")
        prev = r["total_debt_T"]
    fwd_sched = new.get("forward_maturity_schedule") or {}
    if not (5000 < fwd_sched.get("maturing_12M_B", 0) < 20000):
        raise RuntimeError(f"forward 12M maturities implausible: {fwd_sched.get('maturing_12M_B')}")
    if not (20 <= (fwd_sched.get("wam_months") or 0) <= 150):
        raise RuntimeError(f"forward WAM implausible: {fwd_sched.get('wam_months')}")
    risk = new.get("risk_indicators") or {}
    for sid in DASH_FRED_YIELDS:
        v = (risk.get(sid) or {}).get("value")
        if v is None or not isinstance(v, (int, float)):
            raise RuntimeError(f"risk indicator {sid} has no value")
    rc = new.get("refinancing_cost") or {}
    for win in ("maturing_12M", "maturing_24M"):
        if not (0 < (rc.get(win) or {}).get("principal_B", 0)):
            raise RuntimeError(f"refinancing_cost {win} has no principal")
        if not (0 <= (rc.get(win) or {}).get("blended_refinancing_yield_pct", -1) <= 15):
            raise RuntimeError(f"refinancing_cost {win} blended yield implausible")

    old_text = json.dumps(stored, sort_keys=True)
    new_text = json.dumps(new, sort_keys=True)
    if old_text != new_text:
        if "--dry-run" in sys.argv:
            print("  dry run — us-debt-dashboard.json not written")
        else:
            tmp = DASH_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(new, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            tmp.replace(DASH_PATH)
            print("  us-debt-dashboard.json written")
    else:
        print("  dashboard unchanged")
    meta.setdefault("asof", {})["ust_dashboard"] = iso(NOW)
    return True


def cpi_detail(D, N):
    """US CPI internals by category (BLS CPI-U items; scripts/cpi_detail.py). m/m from the seasonally adjusted index, 12-month from the
    unadjusted one, as BLS publishes them. Fetched only when a CPI release has landed that the desk does not hold yet (5 keyless BLS calls),
    retried at most every 20 min; otherwise the stored month is kept."""
    from cpi_detail import CPI_ITEMS
    C = D.get("cpi_detail") or {}
    rel = [datetime.fromisoformat(t).replace(tzinfo=TOR) for t in ((D.get("release_cal") or {}).get("us_cpi", {}).get("dates") or [])]
    landed = [t for t in rel if t <= NOW]
    want = None
    if landed:
        r = max(landed); y, m = (r.year, r.month - 1) if r.month > 1 else (r.year - 1, 12); want = f"{y}-{m:02d}"
    if C.get("month") and C.get("v") == 2 and (want is None or C["month"] >= want):   # v2: changes matched by date
        return
    if C.get("tried") and C.get("v") == 2 and NOW - datetime.fromisoformat(C["tried"]) < timedelta(minutes=20):
        return
    C["tried"] = NOW.isoformat(timespec="seconds"); D["cpi_detail"] = C
    ids = [p + c for c, _, _ in CPI_ITEMS for p in ("CUSR0000", "CUUR0000")]
    got = {}
    step = 50 if BLS_KEY else 25
    for i in range(0, len(ids), step):
        got.update(_bls_batch(ids[i:i + step]))
    items, month = [], None
    for c, name, grp in CPI_ITEMS:
        sa, nsa = dict(got.get("CUSR0000" + c) or []), dict(got.get("CUUR0000" + c) or [])
        ks, kn = sorted(sa), sorted(nsa)
        if len(ks) < 2:
            continue
        sam = {k[:7]: v for k, v in sa.items()}
        def prevm(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
        # one rounding from the published 3-decimal indexes, as BLS does; by date — a month after a gap (Oct 2025 not collected) has no 1-month change
        mm = [(m, round((sam[m] / sam[prevm(m)] - 1) * 100, 1) if prevm(m) in sam else None) for m in sorted(sam)][1:][-13:]
        nsm = {k[:7]: v for k, v in nsa.items()}
        def ago(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-{mo:02d}"
        yy = [(m, round((nsm[m] / nsm[ago(m)] - 1) * 100, 1) if ago(m) in nsm else None) for m in sorted(nsm)][-13:]   # None: year-earlier index not published
        month = max(month or "", mm[-1][0])
        items.append({"c": c, "n": name, "g": grp, "mm": [v for _, v in mm], "yy": [v for _, v in yy], "m": [d for d, _ in mm], "ym": [d for d, _ in yy]})
    if not items:
        raise RuntimeError("BLS returned no CPI category series")
    D["cpi_detail"] = {"v": 2, "month": month, "asof": NOW.isoformat(timespec="seconds"), "items": items,
                       "src": "https://www.bls.gov/cpi/", "note": "CPI-U. m/m seasonally adjusted; 12-month not seasonally adjusted."}
    print(f"  cpi_detail: {len(items)} categories for {month}")


def cpi_detail_ca(D, N):
    """Canada CPI internals by category (StatCan 18-10-0004-01, NSA; scripts/cpi_detail.py CA_ITEMS). Fetched when a Canada CPI release has landed
    that the desk does not hold yet (one WDS call), retried at most every 20 min."""
    from cpi_detail import CA_ITEMS
    C = D.get("cpi_detail_ca") or {}
    rel = [datetime.fromisoformat(t).replace(tzinfo=TOR) for t in ((D.get("release_cal") or {}).get("ca_cpi", {}).get("dates") or [])]
    landed = [t for t in rel if t <= NOW]
    want = None
    if landed:
        r = max(landed); y, m = (r.year, r.month - 1) if r.month > 1 else (r.year - 1, 12); want = f"{y}-{m:02d}"
    if C.get("month") and C.get("v") == 2 and (want is None or C["month"] >= want):   # v2: changes matched by date
        return
    if C.get("tried") and C.get("v") == 2 and NOW - datetime.fromisoformat(C["tried"]) < timedelta(minutes=20):
        return
    C["tried"] = NOW.isoformat(timespec="seconds"); D["cpi_detail_ca"] = C
    body = [{"productId": 18100004, "coordinate": f"2.{m}.0.0.0.0.0.0.0.0", "latestN": 27} for m, _, _ in CA_ITEMS]
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods",
                      headers={**UA, "Content-Type": "application/json"}, data=json.dumps(body), timeout=40)
    r.raise_for_status()
    got = {}
    for o in r.json():
        if o.get("status") != "SUCCESS":
            continue
        ob = o["object"]; mem = int(ob["coordinate"].split(".")[1])
        got[mem] = sorted((p["refPer"][:7], float(p["value"])) for p in ob.get("vectorDataPoint", []) if _num(p.get("value")) is not None)
    items, month = [], None
    for mem, name, grp in CA_ITEMS:
        pts = got.get(mem) or []
        if len(pts) < 14:
            continue
        pm = dict(pts)
        def prevm2(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
        mm = [(m, round((pm[m] / pm[prevm2(m)] - 1) * 100, 1) if prevm2(m) in pm else None) for m in sorted(pm)][1:][-13:]
        yy = [(m, round((pm[m] / pm[f"{int(m[:4]) - 1}{m[4:]}"] - 1) * 100, 1) if f"{int(m[:4]) - 1}{m[4:]}" in pm else None) for m in sorted(pm)][-13:]
        month = max(month or "", mm[-1][0])
        items.append({"c": str(mem), "n": name, "g": grp, "mm": [v for _, v in mm], "yy": [v for _, v in yy], "m": [d for d, _ in mm], "ym": [d for d, _ in yy]})
    if not items:
        raise RuntimeError("StatCan returned no CPI category series")
    D["cpi_detail_ca"] = {"v": 2, "month": month, "asof": NOW.isoformat(timespec="seconds"), "items": items,
                          "src": "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401",
                          "note": "Statistics Canada CPI, not seasonally adjusted (both 1-month and 12-month)."}
    print(f"  cpi_detail_ca: {len(items)} categories for {month}")


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
    D["grain_long"] = {"other": other, "day": today, "after_close": datetime.now(TOR).hour >= 15, "asof": NOW.isoformat(timespec="seconds"),
                       "src": "Yahoo Finance continuous front month (ZC=F, ZW=F, ZS=F), daily bars, $/bu", "series": out,
                       "wasde": sorted(WASDE_DATES)}
    print("  grain_long:", {k: len(v) for k, v in out.items()})


def release_hist(D, N):
    """Past release dates per indicator, for 'Markets around this release' (chunk 6): the official 2026 schedules
    (scripts/release_hist_seed.json: BLS, BEA, Statistics Canada) plus every release_cal date that has passed since."""
    seed = json.loads((Path(__file__).parent / "release_hist_seed.json").read_text())
    H = {k: set(v) for k, v in (D.get("release_hist") or {}).items() if isinstance(v, list)}
    for k, v in seed.items():
        if not k.startswith("_"):
            H.setdefault(k, set()).update(v)
    now = datetime.now(TOR).strftime("%Y-%m-%dT%H:%M")
    for k, c in (D.get("release_cal") or {}).items():
        for x in (c.get("dates") or []) if isinstance(c, dict) else []:
            if x <= now:
                H.setdefault(k, set()).add(x)
    D["release_hist"] = {k: sorted(v)[-24:] for k, v in H.items()}


BLOCKS = [("seasonality_track", seasonality_track), ("expired_track", expired_track), ("policy_watch", policy_watch), ("fx_spot", fx_spot), ("fx_alpha", fx_alpha), ("fx_closes", fx_closes), ("yields", yields), ("cftc_fx", cftc_fx),
          ("cftc_grains", cftc_grains), ("grains_quote", grains_quote), ("yields_live", yields_live), ("energy", energy),
          ("crosses", crosses), ("news", news), ("calendar", calendar), ("fed_odds", fed_odds), ("releases", releases), ("macro", macro), ("cpi_detail", cpi_detail), ("grain_long", grain_long), ("release_hist", release_hist), ("cpi_detail_ca", cpi_detail_ca), ("settles", settles), ("exports", exports), ("wasde", wasde), ("canada", canada), ("ca_calendar", ca_calendar), ("sd_hist", sd_hist), ("inputs", inputs), ("ext", external), ("ca_retail", ca_retail), ("fx_model", fx_model), ("optflow", optflow), ("ust", ust), ("ust_dashboard", ust_dashboard)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated block names")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore the 'checked recently' throttle for the --only blocks")
    a = ap.parse_args()
    doc = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    D, N = doc["DATA"], doc["NEWS"]
    before = json.dumps(doc, sort_keys=True)
    only = set(a.only.split(",")) if a.only else None
    if a.force and only:
        for name in only:
            D["meta"].pop(f"{name}_checked", None)
    ok, failed, errors = [], [], {}
    for k_, old_, new_ in roll_fronts(D):
        print(f"[roll] {k_}: {old_} past its hard exit -> front is now {new_}")
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
            errors[name] = redact(f"{type(e).__name__}: {e}")[:1200]
            print(f"  FAILED: {redact(e)}")
            print(redact(traceback.format_exc(limit=1)))
    try:   # a decision read from the official statement is the current rate until the daily series catch up
        import policy_watch as PW
        if PW.apply_decisions(D):
            print("[policy decisions] current rates updated from the statements read today")
    except Exception as e:
        print("  policy decisions not applied:", e)
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
