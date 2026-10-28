#!/usr/bin/env python3
"""Global Markets Monitor + Alert Engine for the AGRITrade desk.

Runs every 15 minutes, Sunday 17:00 ET -> Friday 17:00 ET (GitHub Action "World markets"), so it keeps monitoring and
alerting while the dashboard is closed. Publishes world.json to the `world` branch (one amended commit, force-pushed,
so the branch never grows); the page reads it through the GitHub API like live.json.

Provider: Yahoo Finance via yfinance (the desk's existing provider; delayed, no key). Official daily yields come from the
US Treasury and the Bank of Canada. Every instrument records provider + symbol, source timestamp, received time, data
age, session status, previous close, session open, high/low, 52-week range and a freshness flag. Coverage gaps (symbols
the provider did not return, assets with no free daily source) are published in `health`, never filled with guesses.

Alert engine (pure functions below, unit-tested in tests/test_world.py):
  move vs previous official close  = (last / prev_close - 1) x 100
  move vs current session open     = (last / session_open - 1) x 100
  yields use basis-point changes instead of percent.
  tiers: Watch 1% / Major 2% / Extreme 3% / Exceptional 5%   (yields: 5 / 10 / 15 / 25 bp)
  one alert per instrument x comparison x direction x tier crossing; re-alert only on a higher tier, a direction flip,
  or after the move falls back below the Watch tier and crosses again; 30-min cooldown per key (escalations bypass it);
  state resets each session; no alerts on stale quotes or closed markets.
Usage: python scripts/world.py [--dry-run]
"""
import argparse, json, math, os, subprocess, sys, time
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/Toronto")
TIERS = [(1.0, "Watch"), (2.0, "Major"), (3.0, "Extreme"), (5.0, "Exceptional")]
TIERS_BP = [(5.0, "Watch"), (10.0, "Major"), (15.0, "Extreme"), (25.0, "Exceptional")]
COOLDOWN_MIN = 30
NOTIFY_MIN_TIER = 2          # webhook pushes Major and above
STALE_MIN_OPEN = 45          # an open market whose last bar is older than this is 'stale'

# ------------------------------------------------------------------ exchanges / sessions (local exchange time)
EXCHANGES = {
    "NYSE":  {"name": "NYSE / Nasdaq",       "city": "New York",  "cc": "us", "tz": "America/New_York", "sessions": [["09:30", "16:00"]]},
    "TSX":   {"name": "Toronto Stock Exch.", "city": "Toronto",   "cc": "ca", "tz": "America/Toronto",  "sessions": [["09:30", "16:00"]]},
    "LSE":   {"name": "London Stock Exch.",  "city": "London",    "cc": "gb", "tz": "Europe/London",    "sessions": [["08:00", "16:30"]]},
    "XETRA": {"name": "Xetra (Frankfurt)",   "city": "Frankfurt", "cc": "de", "tz": "Europe/Berlin",    "sessions": [["09:00", "17:30"]]},
    "EPA":   {"name": "Euronext Paris",      "city": "Paris",     "cc": "fr", "tz": "Europe/Paris",     "sessions": [["09:00", "17:30"]]},
    "EUREX": {"name": "Euro Stoxx (Eurex)",  "city": "Frankfurt", "cc": "eu", "tz": "Europe/Berlin",    "sessions": [["09:00", "17:30"]]},
    "TSE":   {"name": "Tokyo Stock Exch.",   "city": "Tokyo",     "cc": "jp", "tz": "Asia/Tokyo",       "sessions": [["09:00", "11:30"], ["12:30", "15:30"]]},
    "HKEX":  {"name": "Hong Kong Exch.",     "city": "Hong Kong", "cc": "hk", "tz": "Asia/Hong_Kong",   "sessions": [["09:30", "12:00"], ["13:00", "16:00"]]},
    "SSE":   {"name": "Shanghai Stock Exch.","city": "Shanghai",  "cc": "cn", "tz": "Asia/Shanghai",    "sessions": [["09:30", "11:30"], ["13:00", "15:00"]]},
    "NSE":   {"name": "National Stock Exch.","city": "Mumbai",    "cc": "in", "tz": "Asia/Kolkata",     "sessions": [["09:15", "15:30"]]},
    "ASX":   {"name": "ASX",                 "city": "Sydney",    "cc": "au", "tz": "Australia/Sydney", "sessions": [["10:00", "16:00"]]},
    "FX":    {"name": "Global FX (24/5)",    "city": "OTC",       "cc": "xx", "tz": "America/New_York", "sessions": [["17:00", "17:00"]], "fx": True},
    "CME":   {"name": "CME Globex futures",  "city": "Chicago",   "cc": "us", "tz": "America/Chicago",  "sessions": [["17:00", "16:00"]], "globex": True},
    "CBOT":  {"name": "CBOT grains",         "city": "Chicago",   "cc": "us", "tz": "America/Chicago",  "sessions": [["19:00", "07:45"], ["08:30", "13:20"]], "grains": True},
    "ICE":   {"name": "ICE US softs",        "city": "New York",  "cc": "us", "tz": "America/New_York", "sessions": [["03:30", "13:00"]]},
    "USTL":  {"name": "US Treasury yields (CBOE index, delayed)", "city": "Chicago", "cc": "us", "tz": "America/Chicago", "sessions": [["07:00", "15:00"]]},
    "UST":   {"name": "US Treasury (daily)", "city": "Washington","cc": "us", "tz": "America/New_York", "sessions": [["08:00", "17:00"]], "daily": True},
    "BOC":   {"name": "Bank of Canada (daily)","city": "Ottawa",  "cc": "ca", "tz": "America/Toronto",  "sessions": [["08:00", "17:00"]], "daily": True},
}

# ------------------------------------------------------------------ instrument universe (Yahoo symbols)
def I(id_, name, group, region, cc, sym, ex, ccy="", dec=2, kind="price", note="", alts=()):
    return {"id": id_, "name": name, "group": group, "region": region, "cc": cc, "sym": sym, "ex": ex, "ccy": ccy, "dec": dec, "kind": kind, "note": note, "alts": list(alts)}

UNIVERSE = [
    # equity indices
    I("spx", "S&P 500", "Indices", "Americas", "us", "^GSPC", "NYSE", "USD"),
    I("ndx", "Nasdaq-100", "Indices", "Americas", "us", "^NDX", "NYSE", "USD"),
    I("dji", "Dow Jones Industrial", "Indices", "Americas", "us", "^DJI", "NYSE", "USD"),
    I("rut", "Russell 2000", "Indices", "Americas", "us", "^RUT", "NYSE", "USD"),
    I("tsx", "S&P/TSX Composite", "Indices", "Americas", "ca", "^GSPTSE", "TSX", "CAD"),
    I("ftse", "FTSE 100", "Indices", "Europe", "gb", "^FTSE", "LSE", "GBP"),
    I("dax", "DAX", "Indices", "Europe", "de", "^GDAXI", "XETRA", "EUR"),
    I("cac", "CAC 40", "Indices", "Europe", "fr", "^FCHI", "EPA", "EUR"),
    I("sx5e", "Euro Stoxx 50", "Indices", "Europe", "eu", "^STOXX50E", "EUREX", "EUR"),
    I("n225", "Nikkei 225", "Indices", "Asia-Pacific", "jp", "^N225", "TSE", "JPY"),
    I("hsi", "Hang Seng", "Indices", "Asia-Pacific", "hk", "^HSI", "HKEX", "HKD"),
    I("shcomp", "Shanghai Composite", "Indices", "Asia-Pacific", "cn", "000001.SS", "SSE", "CNY"),
    I("csi300", "CSI 300", "Indices", "Asia-Pacific", "cn", "000300.SS", "SSE", "CNY", alts=("399300.SZ", "^CSI300")),
    I("nifty", "Nifty 50", "Indices", "Asia-Pacific", "in", "^NSEI", "NSE", "INR"),
    I("asx200", "S&P/ASX 200", "Indices", "Asia-Pacific", "au", "^AXJO", "ASX", "AUD"),
    # FX
    I("eurusd", "EUR/USD", "FX", "Global", "eu", "EURUSD=X", "FX", "", 5),
    I("usdjpy", "USD/JPY", "FX", "Global", "jp", "JPY=X", "FX", "", 3),
    I("gbpusd", "GBP/USD", "FX", "Global", "gb", "GBPUSD=X", "FX", "", 5),
    I("usdcad", "USD/CAD", "FX", "Global", "ca", "CAD=X", "FX", "", 5),
    I("audusd", "AUD/USD", "FX", "Global", "au", "AUDUSD=X", "FX", "", 5),
    I("nzdusd", "NZD/USD", "FX", "Global", "nz", "NZDUSD=X", "FX", "", 5),
    I("usdchf", "USD/CHF", "FX", "Global", "ch", "CHF=X", "FX", "", 5),
    I("usdcnh", "USD/CNH", "FX", "Global", "cn", "CNH=X", "FX", "", 4, alts=("USDCNH=X",)),
    I("usdinr", "USD/INR", "FX", "Global", "in", "INR=X", "FX", "", 3),
    I("dxy", "US Dollar Index (DXY)", "FX", "Global", "us", "DX-Y.NYB", "FX", "", 3),
    # metals (front-month futures - Yahoo has no free spot)
    I("gold", "Gold (COMEX fut.)", "Metals", "Global", "us", "GC=F", "CME", "USD/oz", 2, note="front-month futures, not spot"),
    I("silver", "Silver (COMEX fut.)", "Metals", "Global", "us", "SI=F", "CME", "USD/oz", 3, note="front-month futures, not spot"),
    I("platinum", "Platinum (NYMEX fut.)", "Metals", "Global", "us", "PL=F", "CME", "USD/oz", 2, note="front-month futures"),
    I("palladium", "Palladium (NYMEX fut.)", "Metals", "Global", "us", "PA=F", "CME", "USD/oz", 2, note="front-month futures"),
    # energy
    I("wti", "WTI crude", "Energy", "Global", "us", "CL=F", "CME", "USD/bbl", 2, note="front-month futures"),
    I("brent", "Brent crude", "Energy", "Global", "gb", "BZ=F", "CME", "USD/bbl", 2, note="front-month futures"),
    I("natgas", "Natural gas (Henry Hub)", "Energy", "Global", "us", "NG=F", "CME", "USD/MMBtu", 3, note="front-month futures"),
    I("rbob", "Gasoline (RBOB)", "Energy", "Global", "us", "RB=F", "CME", "USD/gal", 4, note="front-month futures"),
    I("heatoil", "Heating oil (ULSD)", "Energy", "Global", "us", "HO=F", "CME", "USD/gal", 4, note="front-month futures"),
    # industrial & ags
    I("copper", "Copper (COMEX fut.)", "Industrial & Ags", "Global", "us", "HG=F", "CME", "USD/lb", 4, note="front-month futures"),
    I("aluminium", "Aluminium (COMEX fut.)", "Industrial & Ags", "Global", "us", "ALI=F", "CME", "USD/t", 1, note="front-month futures"),
    I("corn", "Corn (CBOT fut.)", "Industrial & Ags", "Global", "us", "ZC=F", "CBOT", "USc/bu", 2, note="front-month futures"),
    I("soy", "Soybeans (CBOT fut.)", "Industrial & Ags", "Global", "us", "ZS=F", "CBOT", "USc/bu", 2, note="front-month futures"),
    I("wheat", "Wheat (CBOT fut.)", "Industrial & Ags", "Global", "us", "ZW=F", "CBOT", "USc/bu", 2, note="front-month futures"),
    I("sugar", "Sugar #11 (ICE fut.)", "Industrial & Ags", "Global", "us", "SB=F", "ICE", "USc/lb", 2, note="front-month futures"),
    # volatility
    I("vix", "VIX (S&P 500 vol)", "Rates & Vol", "Americas", "us", "^VIX", "NYSE", "pts", 2),
]
# official daily yields (not Yahoo): built in yields_official()
YIELDS = [("us2y", "US 2Y Treasury", "us", "UST", "2Y"), ("us5y", "US 5Y Treasury", "us", "UST", "5Y"), ("us10y", "US 10Y Treasury", "us", "UST", "10Y"),
          ("us30y", "US 30Y Treasury", "us", "UST", "30Y"),
          ("ca2y", "Canada 2Y", "ca", "BOC", "2Y"), ("ca10y", "Canada 10Y", "ca", "BOC", "10Y")]
GAPS = [{"id": "bund10y", "name": "German 10Y Bund", "why": "no free daily source with a stable API (FRED carries monthly averages only)"},
        {"id": "gilt10y", "name": "UK 10Y gilt", "why": "no free daily source with a stable API (Bank of England data needs a scraper)"},
        {"id": "spot_metals", "name": "Gold / silver spot", "why": "no free spot feed - COMEX front-month futures shown instead, labelled as futures"}]


# ================================================================== pure functions (unit-tested)
def pct(a, b):
    """(a / b - 1) x 100, None when undefined."""
    return None if a is None or b in (None, 0) else (a / b - 1) * 100


def tier_of(move, is_yield=False):
    """(level, name) of the highest tier |move| reaches; (0, None) below Watch."""
    if move is None:
        return 0, None
    lv, nm = 0, None
    for i, (t, n) in enumerate(TIERS_BP if is_yield else TIERS, start=1):
        if abs(move) >= t - 1e-12:
            lv, nm = i, n
    return lv, nm


def week52(highs, lows, last, today_high=None, today_low=None):
    """52-week high/low and proximity flags. highs/lows: prior sessions (excluding today); today's range checked separately."""
    hs = [h for h in highs if h is not None] + ([today_high] if today_high is not None else [])
    ls = [l for l in lows if l is not None] + ([today_low] if today_low is not None else [])
    if not hs or not ls or last is None:
        return None
    H, L = max(hs), min(ls)
    prevH = max([h for h in highs if h is not None], default=None)
    prevL = min([l for l in lows if l is not None], default=None)
    new_hi = today_high is not None and prevH is not None and today_high >= prevH
    new_lo = today_low is not None and prevL is not None and today_low <= prevL
    from_hi = (H - last) / H * 100 if H else None
    from_lo = (last - L) / L * 100 if L else None
    pos = (last - L) / (H - L) * 100 if H > L else 50.0
    return {"high": H, "low": L, "new_high": bool(new_hi), "new_low": bool(new_lo),
            "pct_from_high": from_hi, "pct_from_low": from_lo,
            "near_high": (from_hi is not None and from_hi <= 5.0), "near_low": (from_lo is not None and from_lo <= 5.0), "pos": pos}


def _hm(s):
    h, m = s.split(":"); return int(h) * 60 + int(m)


def session_status(ex, now_utc):
    """Status of an exchange at now_utc: dict(state, label, next_change_utc). Handles DST via zoneinfo and lunch breaks.
    Exchange holidays are not in a calendar: the caller downgrades 'open' to 'no trading today' when no fresh bar arrives."""
    tz = ZoneInfo(ex["tz"]); loc = now_utc.astimezone(tz); wd = loc.weekday(); mins = loc.hour * 60 + loc.minute
    if ex.get("fx") or ex.get("globex"):
        # 24h Sun 17:00 -> Fri 17:00 New York (FX) / Sun 17:00 -> Fri 16:00 Chicago with a daily 16:00-17:00 break (Globex)
        close_m = 17 * 60 if ex.get("fx") else 16 * 60
        is_open = not (wd == 5 or (wd == 4 and mins >= close_m) or (wd == 6 and mins < 17 * 60))
        if ex.get("globex") and is_open and close_m <= mins < 17 * 60:
            return {"state": "break", "label": "Daily maintenance break"}
        return {"state": "open" if is_open else "closed", "label": ("Open 24h" if is_open else "Weekend close")}
    if ex.get("grains"):
        night = (wd in (6, 0, 1, 2, 3) and mins >= 19 * 60) or (wd in (0, 1, 2, 3, 4) and mins < 7 * 60 + 45)
        day = wd < 5 and 8 * 60 + 30 <= mins < 13 * 60 + 20
        return {"state": "open" if day else ("extended" if night else "closed"), "label": "Day session" if day else ("Overnight session" if night else "Closed")}
    if wd >= 5:
        return {"state": "closed", "label": "Weekend"}
    for a, b in ex["sessions"]:
        if _hm(a) <= mins < _hm(b):
            return {"state": "open", "label": "Open"}
    first, last_ = _hm(ex["sessions"][0][0]), _hm(ex["sessions"][-1][1])
    if first <= mins < last_:
        return {"state": "break", "label": "Lunch break"}
    return {"state": "pre" if mins < first else "closed", "label": "Pre-open" if mins < first else "Closed"}


def evaluate_alerts(rec, state, now_utc, cooldown_min=COOLDOWN_MIN):
    """Alert events for one instrument record against persistent state (mutated in place).
    rec: {id, name, kind, last, prev_close, open, session_date, fresh, ts}. Returns a list of event dicts."""
    out = []
    is_y = rec.get("kind") == "yield"
    bases = [("prev_close", rec.get("prev_close")), ("session_open", rec.get("open"))]
    for basis, ref in bases:
        if ref is None or rec.get("last") is None:
            continue
        mv = (rec["last"] - ref) * 100 if is_y else pct(rec["last"], ref)   # yields: bp
        lv, nm = tier_of(mv, is_y)
        d = 1 if mv > 0 else -1 if mv < 0 else 0
        key = f"{rec['id']}|{basis}"
        st = state.get(key)
        if not st or st.get("day") != rec.get("session_date"):
            st = {"day": rec.get("session_date"), "tier": 0, "dir": 0, "last_alert": None}
            state[key] = st
        if not rec.get("fresh"):
            continue                                       # never alert on stale or closed-market quotes
        if lv == 0:
            if st["tier"] > 0:
                st["tier"], st["dir"] = 0, 0               # re-armed: a later crossing alerts again
            continue
        escalate = st["tier"] > 0 and d == st["dir"] and lv > st["tier"]
        fresh_cross = st["tier"] == 0 or d != st["dir"]
        if not (escalate or fresh_cross):
            continue
        if not escalate and st.get("last_alert"):
            if now_utc - datetime.fromisoformat(st["last_alert"]) < timedelta(minutes=cooldown_min):
                continue
        st.update(tier=lv, dir=d, last_alert=now_utc.isoformat())
        out.append({"id": rec["id"], "name": rec.get("name"), "basis": basis, "dir": "up" if d > 0 else "down", "tier": lv, "severity": nm,
                    "move": round(mv, 2), "unit": "bp" if is_y else "%", "ref": ref, "last": rec["last"], "ts": rec.get("ts"),
                    "kind": "escalation" if escalate else "crossing", "at": now_utc.isoformat()})
    return out


# ================================================================== data collection
def yf():
    import yfinance
    return yfinance


ROLL_TOL_PCT = 1.0   # continuous-futures roll guard: series prior close vs Yahoo's previous close for the quoted contract


def _quote_prev_close(sym):
    """Yahoo's own previous close for the contract currently quoted under a continuous futures symbol."""
    try:
        fi = yf().Ticker(sym).fast_info
        v = fi.get("previousClose") if hasattr(fi, "get") else getattr(fi, "previous_close", None)
        v = float(v) if v is not None else None
        return v if v and v > 0 else None
    except Exception:
        return None


def fetch_yahoo(universe, now_utc):
    """Batch daily (1y) + intraday (5m, 5d) bars; returns {id: record} and a list of failed symbols.
    Symbols that return nothing are retried with their verified alternates (u['alts'])."""
    recs, failed = _fetch_batch(universe, now_utc)
    retry = [dict(u, sym=alt, alt_of=u["sym"]) for u in universe if u["id"] in {f["id"] for f in failed} for alt in u.get("alts", [])[:1]]
    if retry:
        r2, f2 = _fetch_batch(retry, now_utc)
        recs.update(r2)
        ok = set(r2)
        failed = [f for f in failed if f["id"] not in ok] + [f for f in f2 if f["id"] not in ok and f["id"] not in {x["id"] for x in failed}]
    return recs, failed


def _fetch_batch(universe, now_utc):
    syms = [u["sym"] for u in universe]
    daily = yf().download(syms, period="1y", interval="1d", group_by="ticker", auto_adjust=False, progress=False, threads=True)
    intra = yf().download(syms, period="5d", interval="5m", group_by="ticker", auto_adjust=False, progress=False, threads=True, prepost=False)
    recs, failed = {}, []
    for u in universe:
        try:
            d = daily[u["sym"]].dropna(subset=["Close"]) if u["sym"] in daily.columns.get_level_values(0) else None
            it = intra[u["sym"]].dropna(subset=["Close"]) if u["sym"] in intra.columns.get_level_values(0) else None
            if d is None or len(d) < 30:
                raise RuntimeError("no daily history")
            tz = ZoneInfo(EXCHANGES[u["ex"]]["tz"])
            if it is not None and len(it):
                last_ts = it.index[-1].to_pydatetime().astimezone(timezone.utc)
                last = float(it["Close"].iloc[-1])
                sess = last_ts.astimezone(tz).date() if not (EXCHANGES[u["ex"]].get("fx") or EXCHANGES[u["ex"]].get("globex") or EXCHANGES[u["ex"]].get("grains")) \
                    else d.index[-1].date()
            else:
                last_ts = d.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
                last = float(d["Close"].iloc[-1]); sess = d.index[-1].date()
            # today's bar = daily row dated the session date (Yahoo's daily row carries the session's open/high/low)
            drow = d[d.index.date == sess]
            prior = d[d.index.date < sess]
            if not len(prior):
                raise RuntimeError("no prior session")
            prev_close = float(prior["Close"].iloc[-1])
            if len(drow):
                o, h, l = float(drow["Open"].iloc[-1]), float(drow["High"].iloc[-1]), float(drow["Low"].iloc[-1])
            elif it is not None and len(it):
                seg = it[[x.astimezone(tz).date() == sess for x in it.index.to_pydatetime()]]
                o, h, l = float(seg["Open"].iloc[0]), float(seg["High"].max()), float(seg["Low"].min())
            else:
                o = h = l = None
            h = max(h, last) if h is not None else None
            l = min(l, last) if l is not None else None
            roll = None
            if u["sym"].endswith("=F"):
                qp = _quote_prev_close(u["sym"])
                if qp and abs(qp / prev_close - 1) * 100 > ROLL_TOL_PCT:
                    roll = {"series_prev_close": prev_close, "contract_prev_close": qp,
                            "note": "continuous symbol rolled to the next contract - change measured against that contract's own previous close; alerts suppressed this session"}
                    prev_close = qp
                    o = h = l = None                       # session range from the new contract's intraday bars only
                    if it is not None and len(it):
                        cut = now_utc - timedelta(hours=20)
                        seg = it[[x.astimezone(timezone.utc) >= cut for x in it.index.to_pydatetime()]]
                        if len(seg):
                            o, h, l = float(seg["Open"].iloc[0]), float(seg["High"].max()), float(seg["Low"].min())
            w = week52(list(prior["High"].astype(float))[-251:], list(prior["Low"].astype(float))[-251:], last, h, l)
            recs[u["id"]] = {**u, "provider": "Yahoo Finance (delayed)", "roll": roll, "last": last, "prev_close": prev_close, "open": o, "high": h, "low": l,
                             "chg": last - prev_close, "pct": pct(last, prev_close), "pct_open": pct(last, o) if o else None,
                             "ts": last_ts.isoformat(), "session_date": sess.isoformat(), "w52": w,
                             "spark": [round(float(x), 6) for x in list(d["Close"].astype(float))[-30:]]}
        except Exception as e:
            failed.append({"id": u["id"], "sym": u["sym"], "error": f"{type(e).__name__}: {str(e)[:120]}"})
    return recs, failed


def yields_official(now_utc):
    """US Treasury par curve + Bank of Canada benchmark yields, ~1 year of daily closes."""
    import csv, io, re, requests
    UA = {"User-Agent": "agritrade-desk/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)"}
    out, failed = {}, []
    try:
        rows = []
        for yr in (now_utc.year - 1, now_utc.year):
            u = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
                 f"{yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value={yr}&page&_format=csv")
            rows += list(csv.DictReader(io.StringIO(requests.get(u, headers=UA, timeout=30).text)))
        us = {}
        for r in rows:
            d = datetime.strptime(r["Date"], "%m/%d/%Y").date().isoformat()
            us[d] = {t: (float(r[c]) if r.get(c) else None) for t, c in (("2Y", "2 Yr"), ("5Y", "5 Yr"), ("10Y", "10 Yr"), ("30Y", "30 Yr"))}
    except Exception as e:
        us = {}; failed.append({"id": "us2y/us10y", "sym": "US Treasury CSV", "error": type(e).__name__})
    try:
        j = requests.get("https://www.bankofcanada.ca/valet/observations/group/bond_yields_benchmark/json?start_date="
                         + (now_utc - timedelta(days=380)).date().isoformat(), headers=UA, timeout=30).json()
        codes = {t: next((c for c in j["seriesDetail"] if f".{t[:-1]}YR." in c.upper()), None) for t in ("2Y", "10Y")}
        ca = {o["d"]: {t: (float(o[c]["v"]) if c and o.get(c, {}).get("v") not in (None, "") else None) for t, c in codes.items()} for o in j["observations"]}
    except Exception as e:
        ca = {}; failed.append({"id": "ca2y/ca10y", "sym": "BoC Valet", "error": type(e).__name__})
    for id_, name, cc, ex, t in YIELDS:
        src = us if ex == "UST" else ca
        ser = [(d, v[t]) for d, v in sorted(src.items()) if v.get(t) is not None]
        if len(ser) < 30:
            continue
        last_d, last = ser[-1]; prev = ser[-2][1]
        vals = [v for _, v in ser[-252:-1]]
        w = week52(vals, vals, last, last, last)
        out[id_] = {"id": id_, "name": name, "group": "Rates & Vol", "region": "Americas", "cc": cc, "sym": f"{'US Treasury' if ex == 'UST' else 'BoC'} {t}",
                    "ex": ex, "ccy": "%", "dec": 3, "kind": "yield", "provider": "US Treasury (official daily close)" if ex == "UST" else "Bank of Canada (official daily)",
                    "last": last, "prev_close": prev, "open": None, "high": None, "low": None, "chg": last - prev, "pct": None, "chg_bp": (last - prev) * 100,
                    "ts": datetime.fromisoformat(last_d).replace(hour=21, tzinfo=timezone.utc).isoformat(), "session_date": last_d, "w52": w,
                    "spark": [v for _, v in ser[-30:]], "note": "official daily close (end of day)"}
    # spreads
    for t in ("2Y", "10Y"):
        a, b = out.get(f"us{t.lower()}"), out.get(f"ca{t.lower()}")
        if a and b:
            common = sorted(set(us) & set(ca))
            ser = [(d, (us[d][t] - ca[d][t]) * 100) for d in common if us[d].get(t) is not None and ca[d].get(t) is not None]
            if len(ser) > 30:
                last, prev = ser[-1][1], ser[-2][1]
                vals = [v for _, v in ser[-252:-1]]
                out[f"usca{t.lower()}"] = {"id": f"usca{t.lower()}", "name": f"US-Canada {t} spread", "group": "Rates & Vol", "region": "Americas", "cc": "us",
                                           "sym": f"UST {t} - BoC {t}", "ex": "UST", "ccy": "bp", "dec": 1, "kind": "spread", "provider": "computed from official closes",
                                           "last": last, "prev_close": prev, "open": None, "high": None, "low": None, "chg": last - prev, "pct": None, "chg_bp": last - prev,
                                           "ts": datetime.fromisoformat(ser[-1][0]).replace(hour=21, tzinfo=timezone.utc).isoformat(), "session_date": ser[-1][0],
                                           "w52": week52(vals, vals, last, last, last), "spark": [v for _, v in ser[-30:]], "note": "difference of official closes"}
    return out, failed


LIVE_YIELDS = {"us5y": "^FVX", "us10y": "^TNX", "us30y": "^TYX"}   # Yahoo / CBOE Treasury yield indexes, % (no 2Y index)


def apply_live_yield(rec, bars, now_utc, max_gap=0.75):
    """Overlay a delayed intraday yield on an official-close record (pure; unit-tested). bars = [(ts_utc, close), ...].
    The official close becomes prev_close, so chg_bp is the move since the last official close. Kept official if there are
    no bars, if the official close is newer than the last bar, or if the live value disagrees by > max_gap (bad print)."""
    if not rec or not bars:
        return rec
    ts, y = bars[-1]
    off_day = rec.get("session_date") or ""
    if ts.astimezone(ZoneInfo("America/New_York")).date().isoformat() < off_day:
        return rec
    if abs(y - rec["last"]) > max_gap:
        return dict(rec, live_note=f"live {y:.3f} rejected vs official {rec['last']:.3f}")
    day = [v for t, v in bars if t.astimezone(ZoneInfo("America/New_York")).date() == ts.astimezone(ZoneInfo("America/New_York")).date()]
    close = rec["last"]
    out = dict(rec, last=y, prev_close=close, chg=y - close, chg_bp=round((y - close) * 100, 2), ts=ts.isoformat(),
               session_date=ts.astimezone(ZoneInfo("America/New_York")).date().isoformat(), ex="USTL",
               high=max(day) if day else None, low=min(day) if day else None, open=day[0] if day else None,
               provider="Yahoo / CBOE yield index (delayed)", official_close=close, official_date=off_day,
               note=f"live yield · change vs official close {close:.3f}% ({off_day})")
    out["spark"] = (rec.get("spark") or [])[-29:] + [y]
    return out


def yields_live(recs, now_utc):
    """Fetch the intraday yield indexes and overlay them; the US-Canada 10Y spread is then recomputed on the live US leg."""
    failed = []
    try:
        intra = yf().download(list(LIVE_YIELDS.values()), period="2d", interval="5m", group_by="ticker", auto_adjust=False, progress=False, threads=True)
    except Exception as e:
        return [{"id": "us-live-yields", "sym": ",".join(LIVE_YIELDS.values()), "error": type(e).__name__}]
    for id_, sym in LIVE_YIELDS.items():
        try:
            it = intra[sym].dropna(subset=["Close"])
            bars = [(t.to_pydatetime().astimezone(timezone.utc), float(v)) for t, v in zip(it.index, it["Close"])]
            if not bars:
                raise RuntimeError("no bars")
            recs[id_] = apply_live_yield(recs.get(id_), bars, now_utc)
        except Exception as e:
            failed.append({"id": id_ + " (live)", "sym": sym, "error": type(e).__name__})
    a, b = recs.get("us10y"), recs.get("ca10y")
    sp = recs.get("usca10y")
    if a and b and sp and a.get("ex") == "USTL":
        v = (a["last"] - b["last"]) * 100
        recs["usca10y"] = dict(sp, last=v, prev_close=sp["last"], chg=v - sp["last"], chg_bp=v - sp["last"], ts=a["ts"], ex="USTL",
                               session_date=a["session_date"], provider="live US 10Y − BoC 10Y official close",
                               note=f"US leg live (delayed), Canada leg = BoC close {b['last']:.3f}% · change vs official-close spread")
    return failed


# ================================================================== publish / notify
WT = "/tmp/world-worktree"


def sh(*a, cwd=None, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def load_previous(root):
    """Previous world.json from the `world` branch (alert state + log persist across runs)."""
    r = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "world", cwd=root, check=False)
    if r.returncode != 0:
        return {}
    sh("git", "fetch", "-q", "--depth", "1", "origin", "world:refs/remotes/origin/world", cwd=root)
    r = sh("git", "show", "origin/world:world.json", cwd=root, check=False)
    try:
        return json.loads(r.stdout) if r.returncode == 0 else {}
    except Exception:
        return {}


def publish(root, body):
    for k, v in (("user.name", "desk-world-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=root)
    sh("rm", "-rf", WT, check=False); sh("git", "worktree", "prune", cwd=root, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "world", cwd=root, check=False).returncode == 0
    if exists:
        sh("git", "worktree", "add", "-f", "-B", "world", WT, "origin/world", cwd=root)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=root)
        sh("git", "checkout", "-q", "--orphan", "world", cwd=WT); sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "world.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "world.json", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "world: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "world", cwd=WT)


def notify(events):
    """Optional webhook (secret WORLD_ALERT_WEBHOOK): JSON body with a ready-to-read text block. Never logs the URL."""
    url = os.environ.get("WORLD_ALERT_WEBHOOK", "").strip()
    todo = [e for e in events if e.get("tier", 0) >= NOTIFY_MIN_TIER]
    if not url or not todo:
        for e in events:
            e["delivery"] = "dashboard only" if not url else "below notify tier"
        return
    import requests
    lines = []
    for e in todo:
        lines.append(f"GLOBAL MARKET ALERT - {e['severity'].upper()}\nInstrument: {e['name']}\nMove: {e['move']:+.2f}{e['unit']}\n"
                     f"Comparison: {'Previous official close' if e['basis'] == 'prev_close' else 'Current session open'}\n"
                     f"Reference: {e['ref']}  Current: {e['last']}\nSource timestamp: {e['ts']}\nData delay: {e.get('delay_min')} min\nMarket status: {e.get('status')}")
    try:
        r = requests.post(url, json={"text": "\n\n".join(lines), "alerts": todo}, timeout=15)
        st = "delivered" if r.status_code < 300 else f"webhook HTTP {r.status_code}"
    except Exception as ex:
        st = "webhook failed: " + type(ex).__name__
    for e in events:
        e["delivery"] = st if e in todo else "below notify tier"


# ================================================================== main
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); a = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    t0 = time.time(); now = datetime.now(timezone.utc)
    prev = {} if a.dry_run else load_previous(root)
    recs, failed = fetch_yahoo(UNIVERSE, now)
    yrec, yfail = yields_official(now)
    recs.update(yrec); failed += yfail
    failed += yields_live(recs, now)
    state = prev.get("state", {}) or {}
    alerts = prev.get("alerts", []) or []
    closes = prev.get("closes", {}) or {}
    new_events = []
    for id_, r in recs.items():
        ex = EXCHANGES[r["ex"]]
        ss = session_status(ex, now)
        age = (now - datetime.fromisoformat(r["ts"])).total_seconds() / 60
        r["delay_min"] = round(age, 1)
        r["status"] = ss["state"]; r["status_label"] = ss["label"]
        if ex.get("daily"):
            r["quality"] = "end-of-day"; r["fresh"] = False
        elif ss["state"] in ("open", "extended"):
            if age > STALE_MIN_OPEN:
                today_loc = now.astimezone(ZoneInfo(ex["tz"])).date().isoformat()
                if r["session_date"] < today_loc and not (ex.get("fx") or ex.get("globex") or ex.get("grains")):
                    r["quality"], r["status_label"] = "no trading today", "Scheduled open but no bars today (holiday?)"
                else:
                    r["quality"] = "stale"
                r["fresh"] = False
            else:
                r["quality"] = "delayed"; r["fresh"] = True
        else:
            r["quality"] = "closed"; r["fresh"] = False
        if r.get("roll"):
            r["fresh"] = False; r["quality"] = r.get("quality", "") + " · contract roll"
        evs = evaluate_alerts(r, state, now)
        for e in evs:
            e.update(delay_min=r["delay_min"], status=r["status_label"], provider=r["provider"], group=r["group"])
        new_events += evs
        # closing summary: once per cash market per session, after the regular close
        if not (ex.get("fx") or ex.get("globex") or ex.get("grains") or ex.get("daily")) and ss["state"] == "closed" and r["session_date"]:
            day = closes.setdefault(r["session_date"], {})
            if id_ not in day and r.get("pct") is not None:
                day[id_] = {"name": r["name"], "close": r["last"], "prev": r["prev_close"], "pct": round(r["pct"], 2), "at": now.isoformat()}
    notify(new_events)
    alerts = (new_events + alerts)[:300]
    closes = {d: v for d, v in sorted(closes.items())[-10:]}
    body = {
        "updated_at": now.isoformat(), "run_seconds": round(time.time() - t0, 1),
        "provider": "Yahoo Finance via yfinance (delayed ~10-20 min for most indices; FX and futures closer to real time) + US Treasury / Bank of Canada official daily closes",
        "thresholds": {"pct": [t for t, _ in TIERS], "bp": [t for t, _ in TIERS_BP], "names": [n for _, n in TIERS], "cooldown_min": COOLDOWN_MIN, "notify_min_tier": NOTIFY_MIN_TIER,
                       "bases": ["prev_close", "session_open"], "stale_after_min_when_open": STALE_MIN_OPEN},
        "exchanges": EXCHANGES,
        "instruments": [{k: v for k, v in r.items() if k not in ("fresh",)} for r in recs.values()],
        "alerts": alerts, "new_alerts": len(new_events), "closes": closes, "state": state,
        "health": {"ok": len(recs), "expected": len(UNIVERSE) + len(YIELDS) + 2, "failed": failed, "gaps": GAPS,
                   "webhook": "configured" if os.environ.get("WORLD_ALERT_WEBHOOK", "").strip() else "not configured"},
    }
    print(f"world: {len(recs)} instruments, {len(failed)} failed, {len(new_events)} new alerts, {body['run_seconds']}s")
    print(f"::notice title=world::{len(recs)}/{body['health']['expected']} instruments ok, {len(new_events)} new alerts, {body['run_seconds']}s"
          + ("; failed: " + ", ".join(f"{f['id']} ({f['sym']}: {f['error'][:40]})" for f in failed) if failed else ""))
    for f in failed:
        print("  failed:", f["id"], f["sym"], f["error"][:80])
    if a.dry_run:
        json.dump(body, open(os.path.join(root, "world.dry.json"), "w"), indent=1, default=str)
        return
    publish(root, body)


if __name__ == "__main__":
    main()
