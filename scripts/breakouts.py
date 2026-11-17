"""Breakouts engine — a timestamped stream of price events for the desk's Breakouts menu.

Universe (owner, Nov 17 2026): the US Markets earnings watchlist, the North American indexes, the currency market
and the S&P 100 constituents. Prices: Yahoo Finance, delayed ~15 min (free). Runs every 15 min on weekdays.

Events, each stamped with the time of the bar that produced it (ET):
  · new day high / new day low (5-minute bars; the first 15 min of the session only set the range, no event)
  · 52-week high / low touched intraday
  · price crossed its 20/50/100/200-day moving average (intraday vs the prior close's side — provisional until the close)
  · closed above / below an MA, and MA crossovers (20/50, 50/200 golden/death, 100/200) — on the completed daily close
The previous breakouts.json carries the session state, so an event is reported once. Publishes breakouts.json to the
`breakouts` branch. Nothing is estimated: a symbol Yahoo does not return this run is left out and counted.
"""
import json, os, re, subprocess, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NY = ZoneInfo("America/New_York")
WT = "/tmp/breakouts-wt"
PREV = "https://raw.githubusercontent.com/anirudhpdoshi/AGRITrade/breakouts/breakouts.json"
MAS = (20, 50, 100, 200)
EMAS = (9, 21, 50, 200)          # exponential averages shown for every name
EMA_LIVE = (21, 50, 200)         # crossings reported intraday (the 9-day flips too often to be news)
EPAIRS = ((9, 21), (21, 50), (50, 200))
PAIRS = ((20, 50), (50, 200), (100, 200))

INDEXES = [("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"), ("^IXIC", "Nasdaq Composite"), ("^DJI", "Dow Jones"), ("^RUT", "Russell 2000"),
           ("^GSPTSE", "S&P/TSX Composite"), ("^MXX", "Mexico IPC"), ("^VIX", "VIX")]
FX = [("CAD=X", "USD/CAD"), ("DX-Y.NYB", "US Dollar Index"), ("EURUSD=X", "EUR/USD"), ("JPY=X", "USD/JPY"), ("GBPUSD=X", "GBP/USD"),
      ("MXN=X", "USD/MXN"), ("AUDUSD=X", "AUD/USD"), ("CHF=X", "USD/CHF"), ("CNY=X", "USD/CNY")]
SP100 = ("AAPL ABBV ABT ACN ADBE AIG AMD AMGN AMT AMZN AVGO AXP BA BAC BK BKNG BLK BMY BRK-B C CAT CHTR CL CMCSA COF COP COST CRM CSCO CVS CVX "
         "DE DHR DIS DUK EMR F FDX GD GE GILD GM GOOG GOOGL GS HD HON IBM INTC INTU ISRG JNJ JPM KO LIN LLY LMT LOW MA MCD MDLZ MDT MET META "
         "MMM MO MRK MS MSFT NEE NFLX NKE NOW NVDA ORCL PEP PFE PG PLTR PM PYPL QCOM RTX SBUX SCHW SO SPG T TGT TMO TMUS TSLA TXN UBER UNH UNP "
         "UPS USB V VZ WFC WMT XOM").split()


def sp100():
    """current constituents from Wikipedia's S&P 100 table; the list above if the page cannot be read or looks wrong"""
    try:
        req = urllib.request.Request("https://en.wikipedia.org/wiki/S%26P_100", headers={"User-Agent": "AGRITrade desk (breakouts)"})
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
        t = html[html.index('id="constituents"'):]
        t = t[:t.index("</table>")]
        syms = [s.replace(".", "-") for s in re.findall(r"<tr>\s*<td>(?:<a[^>]*>)?([A-Z.]{1,6})(?:</a>)?\s*</td>", t)]
        if 95 <= len(set(syms)) <= 105:
            return sorted(set(syms)), "Wikipedia S&P 100 constituents"
    except Exception as e:
        print(f"  S&P 100 list from Wikipedia unavailable ({type(e).__name__}); using the built-in list")
    return SP100, "built-in S&P 100 list (Nov 2026)"


def watchlist():
    try:
        return json.load(open(os.path.join(ROOT, "scripts", "data", "earnings_watchlist.json"))).get("symbols", [])
    except Exception:
        return []


def f(x):
    """price text: 50,870.12 · 246.30 · 1.4312 (never scientific notation)"""
    a = abs(x)
    return f"{x:,.2f}" if a >= 1000 else f"{x:.2f}" if a >= 10 else f"{x:.4f}"


def sma(c, n, end):
    return None if end + 1 < n else sum(c[end - n + 1:end + 1]) / n


def ema_series(c, n):
    """standard EMA (alpha 2/(n+1)) seeded with the simple average of the first n closes; None until then"""
    if len(c) < n:
        return [None] * len(c)
    k, out = 2 / (n + 1), [None] * (n - 1)
    e = sum(c[:n]) / n
    out.append(e)
    for x in c[n:]:
        e = x * k + e * (1 - k)
        out.append(e)
    return out


def ma_state(closes):
    """SMAs and EMAs on completed daily closes, now and one close earlier"""
    e = len(closes) - 1
    if e < 21:
        return None
    es = {n: ema_series(closes, n) for n in EMAS}
    return {"now": {n: sma(closes, n, e) for n in MAS}, "prev": {n: sma(closes, n, e - 1) for n in MAS},
            "enow": {n: es[n][e] for n in EMAS}, "eprev": {n: es[n][e - 1] for n in EMAS}, "close": closes[e], "prev_close": closes[e - 1]}


def close_events(ms):
    """what the latest completed close changed: closed through an MA, or one MA crossed another"""
    out = []
    if not ms:
        return out
    c1, c0 = ms["close"], ms["prev_close"]
    for n in MAS:
        m1, m0 = ms["now"][n], ms["prev"][n]
        if m1 is None or m0 is None:
            continue
        if c0 <= m0 and c1 > m1:
            out.append(("ma_close", f"Closed above its {n}-day MA ({f(m1)})", 1))
        elif c0 >= m0 and c1 < m1:
            out.append(("ma_close", f"Closed below its {n}-day MA ({f(m1)})", -1))
    for a, b in PAIRS:
        a1, b1, a0, b0 = ms["now"][a], ms["now"][b], ms["prev"][a], ms["prev"][b]
        if None in (a1, b1, a0, b0):
            continue
        tag = " — golden cross" if (a, b) == (50, 200) else ""
        if a0 <= b0 and a1 > b1:
            out.append(("ma_cross", f"{a}-day MA crossed above the {b}-day{tag}", 1))
        elif a0 >= b0 and a1 < b1:
            out.append(("ma_cross", f"{a}-day MA crossed below the {b}-day{' — death cross' if (a, b) == (50, 200) else ''}", -1))
    en, ep = ms.get("enow") or {}, ms.get("eprev") or {}
    for n in EMA_LIVE:
        m1, m0 = en.get(n), ep.get(n)
        if m1 is None or m0 is None:
            continue
        if c0 <= m0 and c1 > m1:
            out.append(("ema_close", f"Closed above its {n}-day EMA ({f(m1)})", 1))
        elif c0 >= m0 and c1 < m1:
            out.append(("ema_close", f"Closed below its {n}-day EMA ({f(m1)})", -1))
    for a, b in EPAIRS:
        a1, b1, a0, b0 = en.get(a), en.get(b), ep.get(a), ep.get(b)
        if None in (a1, b1, a0, b0):
            continue
        if a0 <= b0 and a1 > b1:
            out.append(("ema_cross", f"{a}-day EMA crossed above the {b}-day EMA", 1))
        elif a0 >= b0 and a1 < b1:
            out.append(("ema_cross", f"{a}-day EMA crossed below the {b}-day EMA", -1))
    return out


def _plus(ts, minutes):
    return (datetime.fromisoformat(ts) + timedelta(minutes=minutes)).isoformat()


def intraday_events(bars, prior_close, mas, w52, st, open_ts, emas=None):
    """bars [(ts_utc_iso, high, low, close)] of today's session, oldest first; st = this symbol's saved state (mutated).
    Returns [(ts, kind, text, dir)]."""
    out = []
    hi, lo = st.get("hi"), st.get("lo")
    side = st.setdefault("side", {})
    for ts, h, l, c in bars:
        if st.get("last_ts") and ts <= st["last_ts"]:
            continue
        settle = open_ts is None or ts >= open_ts   # the opening 15 min only set the range
        # a trend day prints a new high every few bars: one event per symbol per 30 minutes (the tile always shows the current high)
        if hi is None or h > hi:
            if hi is not None and settle and (not st.get("eh") or ts >= st["eh"]):
                out.append((ts, "day_high", f"New day high {f(h)}", 1)); st["eh"] = _plus(ts, 30)
            hi = h
        if lo is None or l < lo:
            if lo is not None and settle and (not st.get("el") or ts >= st["el"]):
                out.append((ts, "day_low", f"New day low {f(l)}", -1)); st["el"] = _plus(ts, 30)
            lo = l
        if w52 and w52.get("hi") is not None and h > w52["hi"] and not st.get("w52h"):
            st["w52h"] = 1; out.append((ts, "w52_high", f"52-week high {f(h)} (prior {f(w52['hi'])})", 1))
        if w52 and w52.get("lo") is not None and l < w52["lo"] and not st.get("w52l"):
            st["w52l"] = 1; out.append((ts, "w52_low", f"52-week low {f(l)} (prior {f(w52['lo'])})", -1))
        for n in MAS:
            m = mas.get(n) if mas else None
            if m is None or prior_close is None:
                continue
            s0 = side.get(str(n), 1 if prior_close > m else -1)
            s1 = 1 if c > m else -1 if c < m else s0
            if s1 != s0:
                out.append((ts, "ma_px", f"Crossed {'above' if s1 > 0 else 'below'} its {n}-day MA ({f(m)}) — provisional until the close", s1))
            side[str(n)] = s1
        for n in EMA_LIVE:
            m = emas.get(n) if emas else None
            if m is None or prior_close is None:
                continue
            s0 = side.get("e" + str(n), 1 if prior_close > m else -1)
            s1 = 1 if c > m else -1 if c < m else s0
            if s1 != s0:
                out.append((ts, "ema_px", f"Crossed {'above' if s1 > 0 else 'below'} its {n}-day EMA ({f(m)}) — provisional until the close", s1))
            side["e" + str(n)] = s1
        st["last_ts"] = ts
    st["hi"], st["lo"] = hi, lo
    return out


def fetch(syms):
    import yfinance as yf
    daily = yf.download(syms, period="15mo", interval="1d", auto_adjust=False, progress=False, threads=True, group_by="ticker")
    intra = yf.download(syms, period="1d", interval="5m", auto_adjust=False, progress=False, threads=True, group_by="ticker", prepost=False)
    return daily, intra


def sh(*a, cwd=None, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-breakouts-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=ROOT)
    sh("rm", "-rf", WT, check=False); sh("git", "worktree", "prune", cwd=ROOT, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "breakouts", cwd=ROOT, check=False).returncode == 0
    if exists:
        sh("git", "fetch", "-q", "--depth", "1", "origin", "breakouts:refs/remotes/origin/breakouts", cwd=ROOT, check=False)
        sh("git", "worktree", "add", "-f", "-B", "breakouts", WT, "origin/breakouts", cwd=ROOT)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=ROOT)
        sh("git", "checkout", "-q", "--orphan", "breakouts", cwd=WT); sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "breakouts.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "breakouts.json", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "breakouts: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "breakouts", cwd=WT)


def main():
    now = datetime.now(timezone.utc)
    today = now.astimezone(NY).date().isoformat()
    sp, sp_src = sp100()
    wl = watchlist()
    U = [(s, n, "index") for s, n in INDEXES] + [(s, n, "fx") for s, n in FX] + [(s, s, "watch") for s in wl] + [(s, s, "sp100") for s in sp if s not in wl]
    syms = [u[0] for u in U]
    try:
        prev = json.loads(urllib.request.urlopen(PREV, timeout=20).read())
    except Exception:
        prev = {}
    state = prev.get("state", {}) if prev.get("session") == today else {}
    events = [e for e in prev.get("events", []) if e.get("d") == today]
    seen = {e["id"] for e in events}
    daily, intra = fetch(syms)
    items, missing = [], []
    for s, name, cls in U:
        try:
            dd = daily[s].dropna(subset=["Close"]) if s in daily.columns.get_level_values(0) else None
        except Exception:
            dd = None
        if dd is None or len(dd) < 30:
            missing.append(s); continue
        dates = [i.strftime("%Y-%m-%d") for i in dd.index]
        closes = [float(x) for x in dd["Close"]]
        try:
            bi = intra[s].dropna(subset=["Close"]) if s in intra.columns.get_level_values(0) else None
        except Exception:
            bi = None
        bars = []
        if bi is not None and len(bi):
            for ix, r in bi.iterrows():
                t = ix.tz_convert("UTC") if ix.tzinfo else ix.tz_localize("UTC")
                if t.astimezone(NY).date().isoformat() == today:
                    bars.append((t.isoformat(), float(r["High"]), float(r["Low"]), float(r["Close"])))
        # completed closes: exclude today's daily row while today's session is still printing bars
        live_today = bool(bars) and dates[-1] == today and (now - datetime.fromisoformat(bars[-1][0])) < timedelta(minutes=40)
        done_c = closes[:-1] if live_today else closes
        done_d = dates[:-1] if live_today else dates
        ms = ma_state(done_c)
        prior_close = done_c[-1] if done_c else None
        mas_now = ms["now"] if ms else {}
        yr = done_c[-252:]
        w52 = {"hi": max(yr), "lo": min(yr)} if len(yr) >= 200 else None
        st = state.setdefault(s, {})
        open_ts = None
        if bars and cls in ("index", "watch", "sp100"):
            o = datetime.fromisoformat(bars[0][0]); open_ts = (o + timedelta(minutes=15)).isoformat()
        ema_now = ms["enow"] if ms else {}
        evs = intraday_events(bars, prior_close, mas_now, w52, st, open_ts, ema_now)
        if ms and not live_today and st.get("close_done") != done_d[-1] and done_d[-1] == today:
            st["close_done"] = done_d[-1]
            ct = datetime.combine(datetime.fromisoformat(today), datetime.min.time(), NY).replace(hour=16).astimezone(timezone.utc).isoformat()
            evs += [(ct, k, txt, dr) for k, txt, dr in close_events(ms)]
        last = bars[-1][3] if bars else closes[-1]
        pct = (last / prior_close - 1) * 100 if prior_close else None
        for ts, kind, txt, dr in evs:
            eid = f"{s}|{kind}|{txt.split('(')[0].strip()}|{ts[:16]}"
            if kind in ("day_high", "day_low"):
                eid = f"{s}|{kind}|{ts[:16]}"
            if eid in seen:
                continue
            seen.add(eid)
            events.append({"id": eid, "d": today, "t": ts, "s": s, "n": name, "c": cls, "k": kind, "txt": txt, "dir": dr,
                           "px": round(last, 6), "pct": None if pct is None else round(pct, 2)})
        items.append({"s": s, "n": name, "c": cls, "last": round(last, 6), "pct": None if pct is None else round(pct, 2),
                      "hi": st.get("hi"), "lo": st.get("lo"), "ts": bars[-1][0] if bars else None,
                      "ma": {str(n): (None if mas_now.get(n) is None else round(mas_now[n], 6)) for n in MAS},
                      "above": {str(n): (None if mas_now.get(n) is None else last > mas_now[n]) for n in MAS},
                      "ema": {str(n): (None if ema_now.get(n) is None else round(ema_now[n], 6)) for n in EMAS},
                      "above_ema": {str(n): (None if ema_now.get(n) is None else last > ema_now[n]) for n in EMAS}})
    events.sort(key=lambda e: e["t"], reverse=True)
    body = {"updated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "session": today,
            "provider": "Yahoo Finance, delayed ~15 min (free)", "universe_src": sp_src,
            "counts": {"index": len(INDEXES), "fx": len(FX), "watch": len(wl), "sp100": len([u for u in U if u[2] == "sp100"]), "missing": missing},
            "items": items, "events": events[:600], "state": state}
    print(f"  {len(items)} symbols, {len(events)} events today, {len(missing)} missing")
    if "--dry-run" in sys.argv:
        print(json.dumps(events[:10], indent=1)); return
    if len(items) < len(U) * 0.6:
        sys.exit("too few symbols returned; not publishing")
    publish(body)


if __name__ == "__main__":
    main()
