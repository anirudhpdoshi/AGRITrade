#!/usr/bin/env python3
"""US indices since the election + Nifty 50 correlation -> indices-data.json (repo root).

Recomputes the dataset the Indices tab renders, from free Yahoo Finance daily
closes (the desk's existing provider, keyless). Methodology matches the verified
research build (Nov 18, 2026):

  baseline        Nov 4, 2024 close (session before the Nov 5, 2024 election)
  Nov 2024        post-election partial period Nov 5-29 only, not a full month
  monthly return  month-end close / prior month-end close - 1 (Nov 2024 vs the Nov 4 close)
  points moved    month-end close - prior close
  high-low %      month high / month low - 1 ; high-low pts = high - low
  ann. volatility std dev of daily returns within the month (ddof=1) x sqrt(252);
                  the first day's return is measured against the prior close
  rolling vol     std dev of daily returns over the trailing 63 trading days x sqrt(252),
                  sampled at each month-end; null until 63 returns exist
  drawdown        running peak after the baseline; max and current
  Sharpe/Sortino  annualised return = (last/first)^(252/n) - 1 over daily returns after
                  the baseline; risk-free = mean 13-week T-bill yield (^IRX) over the period;
                  downside vol = std dev of negative daily returns x sqrt(252)
  total return    ^SP500TR only, and only if its TR/price ratio rises smoothly (a whipsawing
                  ratio means the feed is corrupted, as Yahoo ^NDXT is — then null, disclosed)
  Nifty 50        ^NSEI on Asia/Kolkata calendar dates (Yahoo timestamps are ~03:45 UTC, so an
                  ET conversion shifts every date back a day); USD-adjusted = Nifty / USDINR;
                  correlations are Pearson r over the 24 complete months Nov 2024-Oct 2026
                  (the running month is dropped; YoY windows overlap, so YoY r describes the
                  trend divergence, not a clean statistical estimate)

On any failure of a core feed the script exits non-zero WITHOUT touching
indices-data.json, so the tab keeps showing the last good data.
Usage: python scripts/indices.py [--dry-run]
"""
import json, math, os, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = UDC.ROOT
OUT = ROOT / "indices-data.json"
TOR = UDC.TOR
NY = ZoneInfo("America/New_York")
IST = ZoneInfo("Asia/Kolkata")

BASE = datetime(2024, 11, 4, tzinfo=NY)          # baseline close
SPLIT = datetime(2025, 1, 17, tzinfo=NY)         # last session before the inauguration
START = "2023-11-01"                             # need a full year of history before the baseline for YoY
US = {"SPX": ("^GSPC", "S&P 500"), "NDX": ("^NDX", "Nasdaq-100"), "DJIA": ("^DJI", "Dow Jones")}
NY_TZ = "America/New_York"


def stdev(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def pearson(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    num = sum((x - mx) * (y - my) for x, y in pairs)
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return round(num / den, 2) if den else None


def rnd(v, d=2):
    return None if v is None else round(v, d)


def fetch_daily(sym, tz):
    """[(date, open, high, low, close)] with calendar dates in the market's own tz."""
    h = UDC.yf().Ticker(sym).history(start=START, interval="1d", auto_adjust=False)
    if h.empty:
        raise RuntimeError(f"no bars for {sym}")
    rows = []
    for ts, row in h.iterrows():
        d = ts.tz_convert(tz).date() if ts.tzinfo is not None else ts.date()
        c = row.get("Close")
        if c is None or (isinstance(c, float) and math.isnan(c)):
            continue
        rows.append((str(d), float(row.get("Open", c)), float(row.get("High", c)),
                     float(row.get("Low", c)), float(c)))
    rows.sort()
    if not rows:
        raise RuntimeError(f"no closes for {sym}")
    return rows


def close_on(rows, date):
    """Close on the given date; if not a trading day, the last trading day on/before it."""
    sub = [r for r in rows if r[0] <= date]
    if not sub:
        raise RuntimeError(f"no close on or before {date}")
    return sub[-1][4], sub[-1][0]


def buckets(end_date):
    """(label, start, end) per month: Nov 2024 partial, then full months to the running month."""
    out = [("2024-11*", "2024-11-05", "2024-11-29")]
    y, m = 2024, 12
    ey, em = int(end_date[:4]), int(end_date[5:7])
    while (y, m) <= (ey, em):
        import calendar as _cal
        last = _cal.monthrange(y, m)[1]
        out.append((f"{y}-{m:02d}", f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}"))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def monthly_stats(rows, vix_rows):
    end_date = rows[-1][0]
    out = []
    for label, start, end in buckets(end_date):
        sub = [r for r in rows if start <= r[0] <= end]
        if not sub:
            out.append({"month": label, "n_days": 0})
            continue
        prior = [r for r in rows if r[0] < start]
        prior_close = prior[-1][4]
        me_close = sub[-1][4]
        dr = [sub[0][4] / prior_close - 1] + [sub[i][4] / sub[i - 1][4] - 1 for i in range(1, len(sub))]
        sd = stdev(dr)
        vsub = [r for r in vix_rows if start <= r[0] <= end]
        vix_wa = sum(r[4] for r in vsub) / len(vsub) if vsub else None
        vix_me = vsub[-1][4] if vsub else None
        hi, lo = max(r[2] for r in sub), min(r[3] for r in sub)
        out.append({"month": label, "n_days": len(sub), "end_date": sub[-1][0], "close": rnd(me_close),
                    "ret_pct": rnd((me_close / prior_close - 1) * 100), "pts": rnd(me_close - prior_close),
                    "high": rnd(hi), "low": rnd(lo), "hl_pct": rnd((hi / lo - 1) * 100),
                    "hl_pts": rnd(hi - lo),
                    "ann_vol_pct": rnd(sd * math.sqrt(252) * 100) if sd is not None else None,
                    "mo_vol_pct": rnd(sd * math.sqrt(21) * 100) if sd is not None else None,
                    "vix_wa": rnd(vix_wa), "vix_me": rnd(vix_me)})
    return out


def drawdowns(rows, end_date):
    sub = [r for r in rows if BASE.strftime("%Y-%m-%d") < r[0] <= end_date]
    peak, dd, worst = None, [], None
    for r in sub:
        peak = r[4] if peak is None else max(peak, r[4])
        d = r[4] / peak - 1
        dd.append((r[0], r[4], peak, d))
        if worst is None or d < worst[3]:
            worst = (r[0], r[4], peak, d)
    peak_before = max(r[4] for r in sub if r[0] <= worst[0])
    peak_date = max(r[0] for r in sub if r[4] == peak_before and r[0] <= worst[0])
    cur = dd[-1]
    return {"max_dd_pct": rnd(worst[3] * 100), "max_dd_date": worst[0],
            "max_dd_peak": rnd(peak_before), "max_dd_peak_date": peak_date,
            "max_dd_trough": rnd(worst[1]),
            "current_dd_pct": rnd(cur[3] * 100), "current_peak": rnd(cur[2]),
            "current_peak_date": max(r[0] for r in sub if r[4] == cur[2])}


def sharpe_sortino(rows, end_date, rf_pct):
    sub = [r for r in rows if BASE.strftime("%Y-%m-%d") < r[0] <= end_date]
    dr = [sub[i][4] / sub[i - 1][4] - 1 for i in range(1, len(sub))]
    n = len(dr)
    ann_ret = (sub[-1][4] / sub[0][4]) ** (252 / n) - 1
    ann_vol = stdev(dr) * math.sqrt(252)
    down = [x for x in dr if x < 0]
    dd_vol = stdev(down) * math.sqrt(252) if len(down) > 1 else None
    rf = rf_pct / 100
    return {"ann_ret_pct": rnd(ann_ret * 100), "ann_vol_pct": rnd(ann_vol * 100),
            "sharpe": rnd((ann_ret - rf) / ann_vol),
            "sortino": rnd((ann_ret - rf) / dd_vol) if dd_vol else None,
            "downside_vol_pct": rnd(dd_vol * 100) if dd_vol else None, "n_days": n}


def rolling_vol(rows, end_date):
    """Trailing-63-trading-day annualised vol at each month-end; null until 63 returns exist."""
    sub = [r for r in rows if BASE.strftime("%Y-%m-%d") < r[0] <= end_date]
    dr = [(sub[i][0], sub[i][4] / sub[i - 1][4] - 1) for i in range(1, len(sub))]
    out = []
    for label, _s, _e in buckets(end_date):
        upto = [x for d, x in dr if d <= _e]
        out.append({"month": label, "roll3m_ann_vol_pct":
                    rnd(stdev(upto[-63:]) * math.sqrt(252) * 100) if len(upto) >= 63 else None})
    return out


def period_return(rows, d0, d1):
    c0, _ = close_on(rows, d0)
    c1, _ = close_on(rows, d1)
    return c1 / c0 - 1, c0, c1


def seasonality(monthly):
    months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]
    table = {}
    for y in sorted({m["month"][:4] for m in monthly if m.get("n_days", 0) > 0}):
        row = {}
        for mm in months:
            hit = [m for m in monthly if m["month"].replace("*", "") == f"{y}-{mm}"]
            if hit and hit[0].get("n_days", 0) > 0:
                r = hit[0]
                import calendar as _cal
                # a month is partial only if it is the Nov 2024 post-election stub, or the
                # running month whose last trading day is not the last weekday of the month
                # (a complete month ends on a Friday/weekday before the weekend, not on the
                # calendar month-end — e.g. May 2025 ends Fri May 30, not Sat May 31)
                _last_day = _cal.monthrange(int(y), int(mm))[1]
                _last_wd = _last_day
                while _cal.weekday(int(y), int(mm), _last_wd) >= 5:
                    _last_wd -= 1
                _partial = r["month"].endswith("*") or r["end_date"] < f"{y}-{mm}-{_last_wd:02d}"
                row[mm] = {"ret_pct": r["ret_pct"], "pts": r["pts"], "hl_pct": r["hl_pct"],
                           "hl_pts": r["hl_pts"], "vix_wa": r["vix_wa"], "close": r["close"],
                           "partial": _partial}
            else:
                row[mm] = None
        table[y] = row
    return table


def tr_block(rows, tr_rows, base_date, end_date):
    """Total return if the TR feed is valid: its TR/price ratio must rise smoothly
    (dividends accrue monotonically). A whipsawing ratio means a corrupted feed -> None."""
    if not tr_rows:
        return None
    ratio = []
    for d, _o, _h, _l, c in tr_rows:
        p = [r for r in rows if r[0] == d]
        if p:
            ratio.append(c / p[0][4])
    if len(ratio) < 10:
        return None
    drops = sum(1 for i in range(1, len(ratio)) if ratio[i] < ratio[i - 1] * 0.999)
    if drops > len(ratio) * 0.05:
        return None
    t_base, _ = close_on(tr_rows, base_date)
    t_end, _ = close_on(tr_rows, end_date)
    t2025, _, _ = period_return(tr_rows, "2024-12-31", "2025-12-31")
    t2026, _, _ = period_return(tr_rows, "2025-12-31", end_date)
    me = {}
    for d, _o, _h, _l, c in tr_rows:
        if base_date <= d <= end_date:
            me[d[:7]] = c
    cum = [{"month": "2024-11-04", "idx": 100.0}]
    for label, _s, _e in buckets(end_date):
        k = label.replace("*", "")[:7]
        if k in me:
            cum.append({"month": label, "idx": rnd(me[k] / t_base * 100)})
    return {"cum_pct": rnd((t_end / t_base - 1) * 100), "y2025_pct": rnd(t2025 * 100),
            "y2026_ytd_pct": rnd(t2026 * 100), "base": rnd(t_base), "end": rnd(t_end),
            "cumulative": cum}


def monthly_series(rows, tz_dates=True):
    """Month-end closes: [{month, close, ret, n, end}] with Nov 2024 as the partial bucket."""
    out = []
    for label, start, end in buckets(rows[-1][0]):
        sub = [r for r in rows if start <= r[0] <= end]
        if not sub:
            out.append({"month": label})
            continue
        prior = [r for r in rows if r[0] < start]
        out.append({"month": label, "close": sub[-1][4], "ret": sub[-1][4] / prior[-1][4] - 1,
                    "n": len(sub), "end": sub[-1][0]})
    return out


def yoy_series(rows):
    out = []
    for label, start, end in buckets(rows[-1][0]):
        if label in ("2024-11*",) or label == buckets(rows[-1][0])[-1][0]:
            continue
        sub = [r for r in rows if start <= r[0] <= end]
        if not sub:
            continue
        me, me_date = sub[-1][4], sub[-1][0]
        y, m, d = int(me_date[:4]) - 1, int(me_date[5:7]), int(me_date[8:10])
        target = f"{y}-{m:02d}-{d:02d}"
        prior = [r for r in rows if r[0] <= target]
        if not prior:
            continue
        out.append({"month": label, "yoy": me / prior[-1][4] - 1})
    return out

# ---------- weekly monitor (owner, Nov 19 2026): levels, wicks, returns, points; rolling correlation;
# next-month expected range from realised (and, where a vol index exists, implied) volatility; correlated moves ----------
WK_N = 26            # weeks shown and used for sigma / beta
WK_CORR = 12         # rolling-correlation window (weeks)
MONTH_WEEKS = 21 / 5  # one month ~ 21 sessions = 4.2 trading weeks


def weekly_bars(rows):
    """Mon-Fri weeks: [{wk (ISO Monday), end (last session), o, h, l, c, n}] from daily (date, o, h, l, c)."""
    out, cur = [], None
    for d, o, h, l, c in rows:
        dt = datetime.strptime(d, "%Y-%m-%d")
        wk = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
        if not cur or cur["wk"] != wk:
            cur = {"wk": wk, "end": d, "o": o, "h": h, "l": l, "c": c, "n": 0}
            out.append(cur)
        cur["end"], cur["c"], cur["n"] = d, c, cur["n"] + 1
        cur["h"], cur["l"] = max(cur["h"], h), min(cur["l"], l)
    return out


def usd_rows(rows, fx):
    """Index in USD: each bar divided by that day's USD/INR close (last available on/before the date)."""
    out, j, last = [], 0, None
    fx = sorted(fx)
    for d, o, h, l, c in rows:
        while j < len(fx) and fx[j][0] <= d:
            last = fx[j][4]
            j += 1
        if last:
            out.append((d, o / last, h / last, l / last, c / last))
    return out


def weekly_series(bars):
    """Adds ret %, points, range and wick sizes against the prior week's close."""
    out = []
    for i, b in enumerate(bars):
        if i == 0:
            continue
        pc = bars[i - 1]["c"]
        out.append({"wk": b["wk"], "end": b["end"], "open": rnd(b["o"]), "high": rnd(b["h"]), "low": rnd(b["l"]), "close": rnd(b["c"]),
                    "ret_pct": rnd((b["c"] / pc - 1) * 100), "pts": rnd(b["c"] - pc), "range_pts": rnd(b["h"] - b["l"]),
                    "range_pct": rnd((b["h"] / b["l"] - 1) * 100), "upper_wick": rnd(b["h"] - max(b["o"], b["c"])),
                    "lower_wick": rnd(min(b["o"], b["c"]) - b["l"]), "sessions": b["n"]})
    return out


def beta(y, x):
    pairs = [(a, b) for a, b in zip(y, x) if a is not None and b is not None]
    if len(pairs) < 8:
        return None
    my, mx = sum(p[0] for p in pairs) / len(pairs), sum(p[1] for p in pairs) / len(pairs)
    vx = sum((p[1] - mx) ** 2 for p in pairs)
    return round(sum((p[0] - my) * (p[1] - mx) for p in pairs) / vx, 2) if vx else None


def weekly_block(series, vol_idx, today_wk):
    """series: {key: (name, weekly rows incl. the running week)}; vol_idx: {key: (sym, daily rows) or None}."""
    keys = list(series)
    done = {k: [w for w in series[k][1] if w["wk"] < today_wk] for k in keys}        # complete weeks only for statistics
    common = sorted(set.intersection(*[set(w["wk"] for w in done[k]) for k in keys]))[-WK_N:]
    R = {k: {w["wk"]: w["ret_pct"] for w in done[k]} for k in keys}
    ret = {k: [R[k].get(w) for w in common] for k in keys}
    blk = {"weeks_used": len(common), "window": f"{common[0]} to {common[-1]}" if common else "", "corr_window": WK_CORR,
           "month_weeks": MONTH_WEEKS, "series": {}, "expected": {}, "rolling_corr": {}, "correlated": {}}
    for k in keys:
        name, rows = series[k]
        blk["series"][k] = {"name": name, "weeks": rows[-WK_N:]}
        last = rows[-1]["close"]
        sw = stdev(ret[k])
        exp = None
        if sw and last:
            sm = sw * math.sqrt(MONTH_WEEKS)
            exp = {"basis_close": last, "basis_date": rows[-1]["end"], "sigma_week_pct": rnd(sw), "sigma_month_pct": rnd(sm),
                   "r1": [rnd(last * math.exp(-sm / 100)), rnd(last * math.exp(sm / 100))],
                   "r2": [rnd(last * math.exp(-2 * sm / 100)), rnd(last * math.exp(2 * sm / 100))],
                   "pts_1s": rnd(last * sm / 100)}
            v = vol_idx.get(k)
            if v and v[1]:
                iv = v[1][-1][4]
                ism = iv * math.sqrt(21 / 252)
                exp["implied"] = {"index": v[0], "level": rnd(iv), "date": v[1][-1][0], "sigma_month_pct": rnd(ism),
                                  "r1": [rnd(last * math.exp(-ism / 100)), rnd(last * math.exp(ism / 100))], "pts_1s": rnd(last * ism / 100)}
        blk["expected"][k] = exp
    drivers = [k for k in ("SPX", "NDX", "DJIA") if k in keys]
    for k in keys:
        blk["rolling_corr"][k] = {}
        blk["correlated"][k] = {}
        for d in drivers:
            if d == k:
                continue
            rc = []
            for i in range(WK_CORR - 1, len(common)):
                rc.append({"wk": common[i], "r": pearson(ret[k][i - WK_CORR + 1:i + 1], ret[d][i - WK_CORR + 1:i + 1])})
            blk["rolling_corr"][k][d] = rc
            b, r = beta(ret[k], ret[d]), pearson(ret[k], ret[d])
            de = blk["expected"].get(d)
            ke = blk["expected"].get(k)
            if b is None or not de or not ke:
                continue
            mv = b * de["sigma_month_pct"]
            blk["correlated"][k][d] = {"r": r, "r2": rnd(r * r) if r is not None else None, "beta": b, "driver_move_pct": de["sigma_month_pct"],
                                       "move_pct": rnd(mv), "move_pts": rnd(ke["basis_close"] * mv / 100),
                                       "band": [rnd(ke["basis_close"] * math.exp(-abs(mv) / 100)), rnd(ke["basis_close"] * math.exp(abs(mv) / 100))]}
    return blk


def opt_daily(sym, tz):
    try:
        return fetch_daily(sym, tz)
    except Exception as e:
        print(f"  (optional {sym} unavailable: {e})")
        return None


def main():
    now = datetime.now(timezone.utc)
    try:
        data = {k: fetch_daily(sym, NY_TZ) for k, (sym, _n) in US.items()}
        vix = fetch_daily("^VIX", NY_TZ)
        irx = fetch_daily("^IRX", NY_TZ)
        spx_tr = fetch_daily("^SP500TR", NY_TZ)
        ndx_tr = fetch_daily("^NDXT", NY_TZ)
        nifty = fetch_daily("^NSEI", IST)
        inr = fetch_daily("USDINR=X", IST)
    except Exception as e:
        print(f"! fetch failed: {e}")
        return 1
    end_date = data["SPX"][-1][0]
    base_s, end_s = BASE.strftime("%Y-%m-%d"), end_date
    rf = sum(r[4] for r in irx if base_s < r[0] <= end_s) / max(1, len([r for r in irx if base_s < r[0] <= end_s]))
    rf_pct = round(rf, 2)

    indices, vix_m = {}, []
    for sym, (yahoo_sym, name) in US.items():
        rows = data[sym]
        base_close, _ = close_on(rows, base_s)
        end_close, _ = close_on(rows, end_s)
        cum = end_close / base_close - 1
        r2025, _, _ = period_return(rows, "2024-12-31", "2025-12-31")
        r2026, _, _ = period_return(rows, "2025-12-31", end_s)
        r_rally, _, _ = period_return(rows, base_s, SPLIT.strftime("%Y-%m-%d"))
        r_term, _, _ = period_return(rows, SPLIT.strftime("%Y-%m-%d"), end_s)
        ms = monthly_stats(rows, vix)
        mdf = [m for m in ms if m.get("n_days", 0) > 0]
        dd = drawdowns(rows, end_s)
        rs = sharpe_sortino(rows, end_s, rf_pct)
        tr_rows = spx_tr if sym == "SPX" else (ndx_tr if sym == "NDX" else None)
        tr = tr_block(rows, tr_rows, base_s, end_s) if tr_rows else None
        best = max(mdf, key=lambda m: m["ret_pct"])
        worst = min(mdf, key=lambda m: m["ret_pct"])
        hi_vol = max(mdf, key=lambda m: m["ann_vol_pct"])
        lo_vol = min(mdf, key=lambda m: m["ann_vol_pct"])
        yt = {}
        for y, d0, d1 in [(2025, "2024-12-31", "2025-12-31"), (2026, "2025-12-31", end_s)]:
            r, c0, c1 = period_return(rows, d0, d1)
            yt[str(y)] = {"ret_pct": rnd(r * 100), "pts": rnd(c1 - c0)}
        r24, c0, c1 = period_return(rows, base_s, "2024-12-31")
        yt["2024"] = {"ret_pct": rnd(r24 * 100), "pts": rnd(c1 - c0)}
        cum_series = [{"month": "2024-11-04", "idx": 100.0}] + [
            {"month": m["month"], "idx": rnd(m["close"] / base_close * 100)} for m in mdf]
        indices[sym] = {"name": name, "base_close": rnd(base_close), "end_close": rnd(end_close),
                        "end_date": end_s, "cum_pct": rnd(cum * 100), "total_return": tr,
                        "y2025_pct": rnd(r2025 * 100), "y2026_ytd_pct": rnd(r2026 * 100),
                        "elec_to_inaug_pct": rnd(r_rally * 100), "inaug_to_now_pct": rnd(r_term * 100),
                        "avg_monthly_ret_pct": rnd(sum(m["ret_pct"] for m in mdf) / len(mdf)),
                        "avg_ann_vol_pct": rnd(sum(m["ann_vol_pct"] for m in mdf) / len(mdf)),
                        "avg_mo_vol_pct": rnd(sum(m["mo_vol_pct"] for m in mdf) / len(mdf)),
                        "best_month": {"month": best["month"], "ret_pct": best["ret_pct"]},
                        "worst_month": {"month": worst["month"], "ret_pct": worst["ret_pct"]},
                        "highest_vol_month": {"month": hi_vol["month"], "ann_vol_pct": hi_vol["ann_vol_pct"]},
                        "lowest_vol_month": {"month": lo_vol["month"], "ann_vol_pct": lo_vol["ann_vol_pct"]},
                        "n_positive_months": sum(1 for m in mdf if m["ret_pct"] > 0),
                        "n_negative_months": sum(1 for m in mdf if m["ret_pct"] < 0),
                        "n_months": len(mdf),
                        "pct_positive": rnd(sum(1 for m in mdf if m["ret_pct"] > 0) / len(mdf) * 100, 1),
                        "max_drawdown": dd, "risk_adjusted": rs,
                        "return_to_drawdown": rnd(cum * 100 / abs(dd["max_dd_pct"])),
                        "monthly": ms, "cumulative": cum_series, "year_totals": yt,
                        "apr2025_ann_vol_pct": next((m["ann_vol_pct"] for m in mdf if m["month"] == "2025-04"), None),
                        "top3_months_sum_pp": rnd(sum(sorted((m["ret_pct"] for m in mdf), reverse=True)[:3])),
                        "top3_months": [{"month": m["month"], "ret_pct": m["ret_pct"]}
                                        for m in sorted(mdf, key=lambda m: -m["ret_pct"])[:3]],
                        "nov2024_partial": next((m for m in mdf if m["month"] == "2024-11*"), None)}

    for label, start, end in buckets(end_date):
        vsub = [r for r in vix if start <= r[0] <= end]
        if vsub:
            vix_m.append({"month": label, "vix_wa": rnd(sum(r[4] for r in vsub) / len(vsub)),
                          "vix_me": rnd(vsub[-1][4]), "vix_high": rnd(max(r[4] for r in vsub)),
                          "vix_low": rnd(min(r[4] for r in vsub))})

    disp_m = {}
    for sym in US:
        disp_m[sym] = {m["month"]: m["ret_pct"] for m in indices[sym]["monthly"] if m.get("n_days", 0) > 0}
    stds, ranges = [], []
    max_std, max_std_month = -1, None
    for m in disp_m["SPX"]:
        vals = [disp_m[s][m] for s in US if m in disp_m[s]]
        if len(vals) == 3:
            sd = stdev(vals)
            stds.append(sd)
            ranges.append(max(vals) - min(vals))
            if sd is not None and sd > max_std:
                max_std, max_std_month = sd, m
    dispersion = {"avg_std_pct": rnd(sum(stds) / len(stds)), "max_std_month": max_std_month,
                  "max_std_pct": rnd(max_std), "avg_range_pct": rnd(sum(ranges) / len(ranges))}
    rolling = {sym: rolling_vol(data[sym], end_s) for sym in US}

    # ---- Nifty 50 (IST dates; USD-adjusted via USDINR forward-filled on Nifty days) ----
    inr_by_date = {d: c for d, _o, _h, _l, c in inr}
    nifty_usd_rows = []
    last_fx = None
    for d, o, h, l, c in nifty:
        fx = inr_by_date.get(d, last_fx)
        if fx is None:
            continue
        last_fx = fx
        nifty_usd_rows.append((d, o / fx, h / fx, l / fx, c / fx))
    series = {"SPX": data["SPX"], "NDX": data["NDX"], "DJIA": data["DJIA"],
              "NIFTY": nifty, "NIFTY_USD": nifty_usd_rows}
    mo = {k: {m["month"]: m["ret"] * 100 for m in monthly_series(v) if "ret" in m} for k, v in series.items()}
    yy = {k: {m["month"]: m["yoy"] * 100 for m in yoy_series(v)} for k, v in series.items()}
    running_month = buckets(end_date)[-1][0]
    complete = sorted(set(mo["NIFTY"]) - {running_month})
    mom_r = {k: pearson([mo["NIFTY"][m] for m in complete], [mo[k][m] for m in complete]) for k in ("SPX", "NDX", "DJIA")}
    mom_r_usd = {k: pearson([mo["NIFTY_USD"][m] for m in complete], [mo[k][m] for m in complete]) for k in ("SPX", "NDX", "DJIA")}
    yoy_months = sorted(set(yy["NIFTY"]) & set(yy["SPX"]) & set(yy["NDX"]) & set(yy["DJIA"]))
    yoy_r = {k: pearson([yy["NIFTY"][m] for m in yoy_months], [yy[k][m] for m in yoy_months]) for k in ("SPX", "NDX", "DJIA")}
    yoy_r_usd = {k: pearson([yy["NIFTY_USD"][m] for m in yoy_months], [yy[k][m] for m in yoy_months]) for k in ("SPX", "NDX", "DJIA")}
    lag_nifty = {k: pearson([mo["NIFTY"][m] for m in complete[1:]], [mo[k][complete[i]] for i, m in enumerate(complete[1:])]) for k in ("SPX", "NDX", "DJIA")}
    lag_us = {k: pearson([mo[k][m] for m in complete[1:]], [mo["NIFTY"][complete[i]] for i, m in enumerate(complete[1:])]) for k in ("SPX", "NDX", "DJIA")}

    def nifty_kpis(rows):
        base_c, _ = close_on(rows, base_s)
        end_c, _ = close_on(rows, end_s)
        r2025, _, _ = period_return(rows, "2024-12-31", "2025-12-31")
        r2026, _, _ = period_return(rows, "2025-12-31", end_s)
        dd = drawdowns(rows, end_s)
        ms = monthly_series(rows)
        ms = [m for m in ms if "ret" in m]
        vols = []
        for label, start, end in buckets(end_date):
            sub = [r for r in rows if start <= r[0] <= end]
            if len(sub) < 2:
                continue
            prior = [r for r in rows if r[0] < start][-1][4]
            dr = [sub[0][4] / prior - 1] + [sub[i][4] / sub[i - 1][4] - 1 for i in range(1, len(sub))]
            sd = stdev(dr)
            if sd is not None:
                vols.append(sd * math.sqrt(252) * 100)
        best = max(ms, key=lambda m: m["ret"])
        worst = min(ms, key=lambda m: m["ret"])
        return {"cum": rnd((end_c / base_c - 1) * 100), "y2025": rnd(r2025 * 100), "y2026": rnd(r2026 * 100),
                "max_dd": dd, "avg_mo_ret": rnd(sum(m["ret"] for m in ms) / len(ms) * 100),
                "avg_ann_vol": rnd(sum(vols) / len(vols)) if vols else None,
                "best": best, "worst": worst, "n_pos": sum(1 for m in ms if m["ret"] > 0), "n": len(ms)}

    k_inr, k_usd = nifty_kpis(nifty), nifty_kpis(nifty_usd_rows)
    fx_base, _ = close_on(inr, base_s)
    fx_end, _ = close_on(inr, end_s)
    gaps = sorted(((abs(mo["NIFTY"][m] - mo["SPX"][m]), m) for m in complete), reverse=True)[:6]
    divergence = [{"month": m, "nifty": rnd(mo["NIFTY"][m]), "spx": rnd(mo["SPX"][m]),
                   "ndx": rnd(mo["NDX"][m]), "djia": rnd(mo["DJIA"][m]),
                   "gap_pp": rnd(mo["NIFTY"][m] - mo["SPX"][m])} for _a, m in gaps]
    opposite = sum(1 for m in complete
                   if (mo["NIFTY"][m] > 0) != (mo["SPX"][m] > 0) or (mo["NIFTY"][m] > 0) != (mo["NDX"][m] > 0)
                   or (mo["NIFTY"][m] > 0) != (mo["DJIA"][m] > 0))
    cum_inr, cum_usd = [{"month": "2024-11-04", "idx": 100.0}], [{"month": "2024-11-04", "idx": 100.0}]
    v1 = v2 = 100.0
    for m in sorted(mo["NIFTY"]):
        v1 *= 1 + mo["NIFTY"][m] / 100
        v2 *= 1 + mo["NIFTY_USD"][m] / 100
        cum_inr.append({"month": m, "idx": rnd(v1)})
        cum_usd.append({"month": m, "idx": rnd(v2)})
    _ry, _rm = int(running_month[:4]), int(running_month[5:7])
    _py, _pm = (_ry, _rm - 1) if _rm > 1 else (_ry - 1, 12)
    import calendar as _cal
    _prev_end = f"{_py}-{_pm:02d}-{_cal.monthrange(_py, _pm)[1]:02d}"
    nifty_block = {
        "name": "Nifty 50", "base_close": rnd(close_on(nifty, base_s)[0]),
        "end_close": rnd(close_on(nifty, end_s)[0]), "end_date": end_s,
        "cum_pct_inr": k_inr["cum"], "cum_pct_usd": k_usd["cum"],
        "y2025_pct_inr": k_inr["y2025"], "y2025_pct_usd": k_usd["y2025"],
        "y2026_ytd_pct_inr": k_inr["y2026"], "y2026_ytd_pct_usd": k_usd["y2026"],
        "max_drawdown": {"inr_pct": k_inr["max_dd"]["max_dd_pct"], "inr_peak": k_inr["max_dd"]["max_dd_peak"],
                         "inr_peak_date": k_inr["max_dd"]["max_dd_peak_date"],
                         "inr_trough": k_inr["max_dd"]["max_dd_trough"],
                         "inr_trough_date": k_inr["max_dd"]["max_dd_date"],
                         "usd_pct": k_usd["max_dd"]["max_dd_pct"]},
        "current_drawdown": {"inr_pct": k_inr["max_dd"]["current_dd_pct"],
                             "inr_peak": k_inr["max_dd"]["current_peak"],
                             "inr_peak_date": k_inr["max_dd"]["current_peak_date"],
                             "usd_pct": k_usd["max_dd"]["current_dd_pct"]},
        "avg_monthly_ret_pct_inr": k_inr["avg_mo_ret"], "avg_monthly_ret_pct_usd": k_usd["avg_mo_ret"],
        "avg_ann_vol_pct_inr": k_inr["avg_ann_vol"], "avg_ann_vol_pct_usd": k_usd["avg_ann_vol"],
        "best_month": {"month": k_inr["best"]["month"], "ret_pct_inr": rnd(k_inr["best"]["ret"] * 100),
                       "ret_pct_usd": rnd(k_usd["best"]["ret"] * 100),
                       "partial": k_inr["best"]["month"] == running_month},
        "worst_month": {"month": k_inr["worst"]["month"], "ret_pct_inr": rnd(k_inr["worst"]["ret"] * 100),
                        "ret_pct_usd": rnd(k_usd["worst"]["ret"] * 100)},
        "n_positive_months": k_inr["n_pos"], "n_months": k_inr["n"],
        "usdinr": {"base": rnd(fx_base), "end": rnd(fx_end), "chg_pct": rnd((fx_end / fx_base - 1) * 100)},
        "correlations": {
            "n_months": len(complete), "months": "Nov 2024–Oct 2026 (complete months only)",
            "mom": {k: {"inr": mom_r[k], "usd": mom_r_usd[k]} for k in ("SPX", "NDX", "DJIA")},
            "yoy": {k: {"inr": yoy_r[k], "usd": yoy_r_usd[k]} for k in ("SPX", "NDX", "DJIA")},
            "lag1": {"nifty_vs_us_lag": lag_nifty, "us_vs_nifty_lag": lag_us,
                     "note": "No lag effect in either direction."},
            "yoy_note": "YoY windows overlap (12-month rolling), so read the YoY correlation as a description of the trend divergence, not a clean statistical estimate; the MoM correlation is the cleaner read."},
        "monthly_mom": [{"month": m, "nifty_inr": rnd(mo["NIFTY"][m]), "nifty_usd": rnd(mo["NIFTY_USD"][m]),
                         "spx": rnd(mo["SPX"][m]), "ndx": rnd(mo["NDX"][m]), "djia": rnd(mo["DJIA"][m])}
                        for m in sorted(mo["NIFTY"])],
        "monthly_yoy": [{"month": m, "nifty_inr": rnd(yy["NIFTY"][m]), "nifty_usd": rnd(yy["NIFTY_USD"][m]),
                         "spx": rnd(yy["SPX"][m]), "ndx": rnd(yy["NDX"][m]), "djia": rnd(yy["DJIA"][m])}
                        for m in sorted(yy["NIFTY"])],
        "cumulative_inr": cum_inr, "cumulative_usd": cum_usd,
        "divergence": divergence, "opposite_months": opposite,
        "running_mtd": {"month": running_month, "nifty_pct": rnd(mo["NIFTY"].get(running_month)),
                        "spx_pct": rnd(mo["SPX"].get(running_month)),
                        "ndx_pct": rnd(mo["NDX"].get(running_month)),
                        "djia_pct": rnd(mo["DJIA"].get(running_month)),
                        "nifty_prev_month_end_close": rnd(close_on(nifty, _prev_end)[0]),
                        "nifty_off_low_pct": rnd((close_on(nifty, end_s)[0] / k_inr["max_dd"]["max_dd_trough"] - 1) * 100)},
    }

    body = {
        "updated_at": now.astimezone(TOR).isoformat(timespec="seconds"),
        "provider": "Yahoo Finance daily closes (delayed, free)",
        "basis": "Price return unless labelled total return (dividends excluded). Baseline Nov 4, 2024 close (session before the election). Nov 2024 is the post-election partial period Nov 5–29 only; the latest month is month-to-date.",
        "meta": {"event": "Donald Trump elected for second presidential term", "election_date": "2024-11-05",
                 "baseline": "Nov 4, 2024 close (preceding trading session)",
                 "end_date": end_date + " (latest completed trading session)",
                 "inauguration": "Jan 20, 2025 (market closed, MLK Day; split uses Jan 17, 2025 close)",
                 "sources": ["Yahoo Finance daily closes ^GSPC, ^NDX, ^DJI, ^VIX, ^IRX, ^SP500TR, ^NDXT"],
                 "retrieved": now.strftime("%b %d, %Y"), "risk_free_pct": rf_pct,
                 "vol_definition": "Annualised realised volatility = std dev of daily returns within the month x sqrt(252) x 100",
                 "nov2024_note": "Nov 2024 is the post-election partial period Nov 5-29 only, not a full calendar month",
                 "dow_tr_note": "Dow Jones total-return index (^DJITR) has only 1 day of history on Yahoo Finance; Dow total return is NOT available - price return only, dividends excluded and disclosed.",
                 "ndx_tr_note": "Nasdaq-100 total return NOT shown: Yahoo ^NDXT is unreliable. Its ratio to the price index whipsaws instead of rising smoothly with dividends, and implies impossible monthly dividend gaps. A true TR/price ratio rises monotonically by the dividend yield (~0.7%/yr for NDX). NDX is shown price-only.",
                 "spx_tr_note": "S&P 500 total return from ^SP500TR is valid: TR/price ratio rises smoothly and monotonically, implying ~1.3%/yr dividends."},
        "indices": indices,
        "vix": {"monthly": vix_m},
        "seasonality": {sym: seasonality(indices[sym]["monthly"]) for sym in US},
        "dispersion": dispersion,
        "rolling_vol": rolling,
        "nifty": nifty_block,
    }
    try:
        wk_series = {k: (US[k][1], weekly_series(weekly_bars(data[k]))) for k in US}
        wk_series["NIFTY"] = ("Nifty 50 · INR", weekly_series(weekly_bars(nifty)))
        wk_series["NIFTY_USD"] = ("Nifty 50 · USD", weekly_series(weekly_bars(usd_rows(nifty, inr))))
        vix_map = {"SPX": ("^VIX", vix), "NDX": ("^VXN", opt_daily("^VXN", NY_TZ)), "DJIA": ("^VXD", opt_daily("^VXD", NY_TZ)),
                   "NIFTY": ("^INDIAVIX", opt_daily("^INDIAVIX", IST))}
        today = datetime.now(NY)
        body["weekly"] = weekly_block(wk_series, vix_map, (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d"))
    except Exception as e:
        print(f"! weekly block skipped: {e}")
    if "--dry-run" in sys.argv:
        w = body.get("weekly") or {}
        for k, e in (w.get("expected") or {}).items():
            if e:
                print(f"  wk {k}: close {e['basis_close']} sigma_m {e['sigma_month_pct']}% 1s {e['r1']} implied {(e.get('implied') or {}).get('sigma_month_pct')}")
        for k, c in (w.get("correlated") or {}).items():
            print(f"  corr {k}: " + ", ".join(f"{d} r{v['r']} b{v['beta']} {v['move_pct']}%" for d, v in c.items()))
        for sym in US:
            x = indices[sym]
            print(f"{x['name']}: cum {x['cum_pct']}% | 2025 {x['y2025_pct']}% | 2026 YTD {x['y2026_ytd_pct']}% | "
                  f"Sharpe {x['risk_adjusted']['sharpe']} | max DD {x['max_drawdown']['max_dd_pct']}%")
        print(f"Nifty: cum INR {k_inr['cum']}% / USD {k_usd['cum']}% | MoM r vs SPX {mom_r['SPX']} NDX {mom_r['NDX']} DJIA {mom_r['DJIA']}")
        print(f"end {end_date} | risk-free {rf_pct}%")
        return 0
    tmp = str(OUT) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(body, f, indent=1)
    os.replace(tmp, OUT)
    print(f"wrote {OUT} (end {end_date})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
