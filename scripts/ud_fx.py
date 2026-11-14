"""USD/CAD blocks: spot, closes, yields curves, CFTC positioning, economic calendar, the 1-day model and Fed odds.

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
from ud_common import TOR, UA, _fred, _num, _valet_series, get, iso, pctile, redact, valet, yahoo_last, yf


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
        cut = UDC.NOW - timedelta(hours=20)
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
    for yr in (UDC.NOW.year - 1, UDC.NOW.year):
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
    meta, et = D["meta"], UDC.NOW.astimezone(TOR)
    if et.weekday() >= 5 or not (8 * 60 <= et.hour * 60 + et.minute <= 19 * 60 + 30):
        print("  outside 08:00-19:30 ET weekdays - skipped")
        return False
    last = meta.get("alpha_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(minutes=59):
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
    meta["alpha_calls"], meta["alpha_checked"] = cnt, iso(UDC.NOW)
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
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=1):
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
    meta["calendar_checked"] = iso(UDC.NOW)
    meta["asof"]["calendar"] = iso(UDC.NOW)
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
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=3):
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
    if fo.get("rr") is not None and fo_t and UDC.NOW - datetime.fromisoformat(fo_t) < timedelta(days=7):
        add("25D risk reversal", sg(fo["rr"]), 0.4, f"RR {fo['rr']:+.2f} pp")
    if drivers:
        sc = sum(d["sign"] * d["weight"] for d in drivers) / sum(d["weight"] for d in drivers)
        lab = ("Bullish" if sc >= 0.5 else "Conditional Bullish" if sc >= 0.15 else "Bearish" if sc <= -0.5 else "Conditional Bearish" if sc <= -0.15 else "Neutral") + " USD/CAD"
        fx["bias"] = {"label": lab, "score": round(sc, 3), "drivers": drivers, "asof": iso(UDC.NOW),
                      "method": "sign-weighted driver score: sum(sign x weight) / sum(weight); |score| >= 0.15 conditional, >= 0.5 directional"}
    # ---- OLS forecast
    start = (UDC.NOW - timedelta(days=260)).date().isoformat()
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
                "beta": [round(x, 4) for x in beta], "sigma_pct": round(sig, 3), "train_pairs": len(Y), "origin_date": b, "asof": iso(UDC.NOW),
                "features": ["2Y US-CA spread change (bps)", "DXY log return (%)", "WTI log return (%)"]}
    fx["scen"] = {"status": "ok", "horizon": "1D", "model": "OLS baseline",
                  "asof": {"origin_date": b, "base_spot_close": round(base, 4), "base_source": "Bank of Canada FXUSDCAD close at origin", "train_pairs": len(Y)},
                  "method": "normal forecast distribution N(P50, residual sigma); neutral band = no change +/-0.25 sigma; probabilities and conditional expected moves from that distribution",
                  "bullish_usdcad": {"probability_pct": round(pu * 100, 1), "expected_move_pct": round(mu, 3), "range": [lvl(hi), lvl(p50 + 1.2816 * sig)]},
                  "neutral": {"probability_pct": round(pn * 100, 1), "expected_move_pct": round(mn, 3), "range": [lvl(lo), lvl(hi)]},
                  "bearish_usdcad": {"probability_pct": round(pb * 100, 1), "expected_move_pct": round(mb, 3), "range": [lvl(p50 - 1.2816 * sig), lvl(lo)]},
                  "spot_base": round(base, 4), "spot_module_mid": fx["feed"].get("mid")}
    meta["model_checked"] = iso(UDC.NOW)
    meta["asof"]["model"] = iso(UDC.NOW)
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
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=1):
        print("  checked <1h ago - skipping")
        return False
    effr_j = get("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json").json()["refRates"][0]
    effr, lo0, hi0 = float(effr_j["percentRate"]), float(effr_j["targetRateFrom"]), float(effr_j["targetRateTo"])
    meets = [datetime.fromisoformat(s_).date() for s_ in (D.get("release_cal", {}).get("us_policy", {}).get("dates") or [])]
    today = UDC.NOW.astimezone(TOR).date()
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
        snap = {"t": iso(UDC.NOW), "meeting": out[0]["meeting"], "hold": out[0]["no_change_pct"], "hike": out[0]["hike_pct"], "ease": out[0]["ease_pct"]}
        if not H or any(H[-1].get(k) != snap[k] for k in ("meeting", "hold", "hike", "ease")):
            H.append(snap)
            del H[:-400]
    fx["policy"]["fed_range"] = f"{int(lo0 * 100)}-{int(hi0 * 100)} (NY Fed target range) · EFFR {effr:.2f}%"
    meta["fedodds_checked"] = iso(UDC.NOW)
    meta["asof"]["policy"] = iso(UDC.NOW)
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
