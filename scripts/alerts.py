"""Intraday breaking-news & market-alert engine (runs inside the fast lane, scripts/live_loop.py).

Rule set (desk system rule "INTRADAY BREAKING NEWS & MARKET ALERT ENGINE"):
  Price triggers on completed 5-minute bars, today only:
    - new intraday high / low (after 9:45 ET, beyond the prior extreme by a buffer, at most once an hour per side)
    - cross of the 20 / 50 / 100 / 200-day moving average
    - break of the +-1 sigma / +-2 sigma band (sigma = 20-day stdev of daily log returns, around the prior close)
    - break of the grain options put wall (down) / call wall (up); wall = strike with the largest
      OI x 5,000 bu x underlying price (notional)
  A break is CONFIRMED only when the last two completed bars close beyond the level and the latest by >= buffer
  (0.1 x daily sigma in price); the instrument must have started the day on the other side. A touch never fires.
  Each (instrument, level, direction) fires once per day.
  News triggers: today's items from the desk briefing (credible outlets only) that announce a market-moving event —
  central-bank decisions/interventions, military escalation/sanctions/supply disruption, Trump administration actions,
  election results, major fiscal/trade measures. Opinion, previews and forecasts are dropped. Confirmed = 2+ outlets.
Nothing here invents a level: every number is computed from the bars/OI shown in the alert.
"""
import math, re, statistics
from datetime import datetime, timedelta

INST = [  # key, label, yahoo symbol (None = grain front from D), tag, divisor
    ("corn", "Corn", None, "corn", 100.0), ("wheat", "Wheat", None, "wheat", 100.0), ("soybeans", "Soybeans", None, "soybeans", 100.0),
    ("usdcad", "USD/CAD", "CAD=X", "fx", 1.0), ("wti", "WTI crude", "CL=F", "energy", 1.0),
    ("gold", "Gold", "GC=F", "metals", 1.0), ("silver", "Silver", "SI=F", "metals", 1.0),
    ("spx", "S&P 500", "^GSPC", "world", 1.0), ("ndx", "Nasdaq Composite", "^IXIC", "world", 1.0), ("dji", "Dow Jones", "^DJI", "world", 1.0),
    ("tsx", "S&P/TSX", "^GSPTSE", "world", 1.0), ("stoxx", "Euro Stoxx 50", "^STOXX50E", "world", 1.0), ("ftse", "FTSE 100", "^FTSE", "world", 1.0),
    ("dxy", "US Dollar Index", "DX-Y.NYB", "fx", 1.0),
]
GRAIN_MULT = 5000  # bushels per CBOT grain option
DEC = {"usdcad": 4, "corn": 4, "wheat": 4, "soybeans": 4, "silver": 3, "gold": 1, "wti": 2, "dxy": 2}
WHY = {
    "ma": "The {n}-day average is a widely watched trend gauge; a confirmed cross often triggers trend-following and stop flows.",
    "sig1": "A move beyond 1 sigma of 20-day volatility is larger than roughly two days in three; positioning starts to adjust.",
    "sig2": "A move beyond 2 sigma is statistically unusual (about 1 day in 20) and tends to force hedging and stop-loss activity.",
    "hod": "A fresh session extreme; stop orders and momentum flows cluster beyond the prior high/low.",
    "wall": "The largest open-interest strike ({n} notional) gave way; dealer hedging around it can now accelerate the move.",
}


def _fmt(k, v):
    return f"{v:,.{DEC.get(k, 2)}f}"


def _bars(yf, sym, now_et, tor, intraday=True):
    t = yf.Ticker(sym)
    if intraday:
        h = t.history(period="2d", interval="5m")
        out = []
        for idx, r in h.iterrows():
            ts = idx.to_pydatetime().astimezone(tor)
            if ts.date() == now_et.date() and ts + timedelta(minutes=5) <= now_et:   # completed bars only
                out.append((ts, float(r["High"]), float(r["Low"]), float(r["Close"])))
        return out
    h = t.history(period="15mo", interval="1d")
    return [(idx.to_pydatetime().astimezone(tor).date(), float(r["Close"])) for idx, r in h.iterrows()
            if idx.to_pydatetime().astimezone(tor).date() < now_et.date()]


def _levels(daily):
    c = [x[1] for x in daily]
    if len(c) < 25:
        return None, {}
    rets = [math.log(c[i] / c[i - 1]) for i in range(len(c) - 20, len(c)) if c[i - 1] > 0]
    sd = statistics.stdev(rets)
    pc = c[-1]
    L = {}
    for n in (20, 50, 100, 200):
        if len(c) >= n:
            L[f"ma{n}"] = (sum(c[-n:]) / n, f"{n}-day moving average", "ma", n)
    for k in (1, 2):
        L[f"sp{k}"] = (pc * math.exp(k * sd), f"+{k}σ band", f"sig{k}", k)
        L[f"sm{k}"] = (pc * math.exp(-k * sd), f"−{k}σ band", f"sig{k}", k)
    return {"sd": sd, "pc": pc, "buf": 0.1 * sd * pc}, L


def _walls(D, key):
    n = ((D.get("grains") or {}).get(key) or {}).get("near") or {}
    rows, und = n.get("rows") or [], n.get("underlying")
    try:
        und = float(und)
    except (TypeError, ValueError):
        return {}
    if not rows:
        return {}
    c = max(rows, key=lambda r: r[1])
    p = max(rows, key=lambda r: r[2])
    note = f"{n.get('chain', '')} options, OI {n.get('oi_label', '')}".strip()
    return {"call": (c[0], c[1], c[1] * GRAIN_MULT * und, note), "put": (p[0], p[2], p[2] * GRAIN_MULT * und, note)}


def _money(x):
    return f"${x / 1e9:.2f}B" if x >= 1e9 else f"${x / 1e6:.0f}M"


def scan_prices(D, state, now, tor, yf):
    now_et = now.astimezone(tor)
    out = []
    fired = state.setdefault("fired", {})
    cache = state.setdefault("_daily", {})
    for key, label, sym, tag, div in INST:
        try:
            if sym is None:
                roll = (D["grains"][key].get("roll") or [{}])
                front = roll[0].get("contract")
                if not front:
                    continue
                sym, label = f"{front}.CBT", f"{label} {front}"
            if sym not in cache or cache[sym][0] != now_et.date().isoformat():
                cache[sym] = (now_et.date().isoformat(), _bars(yf, sym, now_et, tor, intraday=False))
            daily = [(d, v / div) for d, v in cache[sym][1]]
            base, L = _levels(daily)
            if not base:
                continue
            bars = [(t, h / div, l / div, c / div) for t, h, l, c in _bars(yf, sym, now_et, tor)]
            if len(bars) < 3:
                continue
            t_last, c1, c0 = bars[-1][0], bars[-1][3], bars[-2][3]
            open_ref = bars[0][3]
            buf = base["buf"]
            mt = t_last + timedelta(minutes=5)

            def fire(fid, head, trig, up, why):
                if fid in fired:
                    return
                fired[fid] = now.isoformat()
                out.append({"id": fid, "kind": "price", "tag": tag, "t": now.isoformat(), "mt": mt.isoformat(),
                            "head": head, "trigger": trig, "impact": ("Bullish" if up else "Bearish") + (" USD/CAD (CAD weaker)" if key == "usdcad" and up else " USD/CAD (CAD stronger)" if key == "usdcad" else ""),
                            "why": why, "src": f"Yahoo Finance {sym} 5-min bars (futures delayed ~10 min)"})

            # MA and sigma bands: confirmed cross from the side the day started on
            for lk, (lv, lname, wk, n) in L.items():
                for up in (True, False):
                    started = (base["pc"] < lv and open_ref < lv + buf) if up else (base["pc"] > lv and open_ref > lv - buf)
                    conf = (c0 > lv and c1 >= lv + buf) if up else (c0 < lv and c1 <= lv - buf)
                    if wk.startswith("sig") and ((lk.startswith("sp") and not up) or (lk.startswith("sm") and up)):
                        continue   # +σ bands break upward, −σ bands downward
                    if started and conf:
                        fire(f"{key}|{lk}|{'u' if up else 'd'}|{now_et.date()}", f"PRICE ALERT – {label}",
                             f"{'Broke above' if up else 'Broke below'} its {lname} at {_fmt(key, lv)}; last 5-min close {_fmt(key, c1)} ({mt.strftime('%-I:%M %p')} ET), prior close {_fmt(key, base['pc'])}.",
                             up, WHY[wk].format(n=n))
            # options walls (grains)
            if tag in ("corn", "wheat", "soybeans"):
                W = _walls(D, key)
                for side, up in (("call", True), ("put", False)):
                    if side not in W:
                        continue
                    k_, oi, notional, note = W[side]
                    started = (open_ref < k_) if up else (open_ref > k_)
                    conf = (c0 > k_ and c1 >= k_ + buf) if up else (c0 < k_ and c1 <= k_ - buf)
                    if started and conf:
                        fire(f"{key}|{side}wall|{k_}|{now_et.date()}", f"PRICE ALERT – {label} {'call' if up else 'put'} wall",
                             f"{'Broke above the call wall' if up else 'Broke below the put wall'} at ${k_:.2f} ({oi:,} contracts ≈ {_money(notional)} notional; {note}); last 5-min close {_fmt(key, c1)}.",
                             up, WHY["wall"].format(n=_money(notional)))
            # new intraday high / low (after 9:45 ET, 60-min cooldown per side, must extend the last alerted extreme)
            if now_et.hour * 60 + now_et.minute >= 9 * 60 + 45 and len(bars) >= 4:
                hi_prior = max(b[1] for b in bars[:-1])
                lo_prior = min(b[2] for b in bars[:-1])
                for up, ext, prior in ((True, bars[-1][1], hi_prior), (False, bars[-1][2], lo_prior)):
                    beyond = ext >= prior + buf if up else ext <= prior - buf
                    if not beyond or not ((c1 > prior) if up else (c1 < prior)):
                        continue   # the close must hold beyond the old extreme too
                    sk = f"{key}|{'hod' if up else 'lod'}"
                    last = state.setdefault("ext", {}).get(sk)
                    if last and (now - datetime.fromisoformat(last["t"]) < timedelta(minutes=60) or (ext < last["v"] + buf if up else ext > last["v"] - buf)):
                        continue
                    state["ext"][sk] = {"t": now.isoformat(), "v": ext}
                    fire(f"{sk}|{now_et.date()}|{ext}", f"PRICE ALERT – {label}",
                         f"New intraday {'high' if up else 'low'} {_fmt(key, ext)} (prior session {'high' if up else 'low'} {_fmt(key, prior)}); 5-min close {_fmt(key, c1)}.",
                         up, WHY["hod"])
        except Exception as e:   # one instrument failing never stops the others
            print(f"  [alerts] {key}: {type(e).__name__}: {str(e)[:120]}")
    return out


# ------------------------------------------------------------------------- news
CREDIBLE = re.compile(r"Reuters|AP News|Associated Press|Bloomberg|Wall Street Journal|WSJ|Financial Times|CNBC|Bank of Canada|Federal Reserve|"
                      r"White House|Government of Canada|CBC|Globe and Mail|BBC|Politico|Axios|NPR|CBS News|NBC News|ABC News|Canadian Press|Al Jazeera|Nikkei|MarketWatch|Barron", re.I)
CATS = [
    ("cb", r"\b(Fed|Federal Reserve|FOMC|Bank of Canada|BoC|ECB|Bank of England|BoE|Bank of Japan|BoJ|PBOC|SNB|RBA)\b.*\b(raises|hikes|cuts|lowers|holds|keeps|leaves|intervene|intervention|emergency)\b|\b(rate (hike|cut)|intervenes? in)\b",
     "Central-bank policy moves reprice rates, the currency and risk assets immediately."),
    ("geo", r"\b(missile|airstrike|strikes? on|attack(s|ed)? on|invasion|invades|troops (enter|cross)|escalat|blockade|embargo|sanction(s|ed)?|export ban|ban(s|ned)? exports|pipeline (shut|halt)|port (closed|shut)|shipping halted|ceasefire (collapses|agreed|deal))",
     "Escalation or supply disruption can move crude, grains, safe havens and risk sentiment."),
    ("trump", r"\bTrump\b.*\b(signs|executive order|orders|imposes|announces|declares|fires|tariffs?|suspends|halts|bans)\b",
     "A US administration action can change trade, policy and risk pricing across markets."),
    ("elec", r"\b(wins|won|defeats|concedes|declared winner|projected (to win|winner)|election results|takes control of|flips)\b",
     "A confirmed election outcome changes the expected policy path and can move currencies, rates and sectors."),
    ("fiscal", r"\b(tariffs? (take effect|imposed|raised|lifted)|retaliat|trade deal (signed|reached|agreed)|government shutdown|debt ceiling|budget (passed|tabled)|stimulus (package|plan) (passed|approved))",
     "Fiscal and trade measures shift growth, inflation and currency expectations."),
]
NOISE = re.compile(r"\b(opinion|analysis|explainer|preview|what to (watch|know|expect)|outlook|forecast|could|might|may|would|should|seen\b|expected to|ahead of|analysts? say|poll shows|"
                   r"technical|how to|why |explained|podcast|live updates?|week ahead|recap)\b", re.I)
UNVERIFIED = re.compile(r"\b(reportedly|sources say|according to sources|unconfirmed|report:)\b", re.I)


def scan_news(B, state, now, tor):
    if not B:
        return []
    out, fired = [], state.setdefault("fired", {})
    today = now.astimezone(tor).date()
    seen = set()
    for desk in ("us", "ca", "both"):
        dk = (B.get("desks") or {}).get(desk) or {}
        items = list(dk.get("top") or [])
        for sec in (dk.get("sections") or {}).values():
            items += sec or []
        for it in items:
            title, outlet = it.get("title") or "", it.get("outlet") or ""
            if not title or title in seen:
                continue
            seen.add(title)
            try:
                first = datetime.fromisoformat((it.get("first") or it.get("ts")).replace("Z", "+00:00"))
            except Exception:
                continue
            if first.astimezone(tor).date() != today or NOISE.search(title):
                continue
            outlets = it.get("outlets") or [outlet]
            if not any(CREDIBLE.search(o or "") for o in outlets):
                continue
            cat = next((c for c in CATS if re.search(c[1], title, re.I)), None)
            if not cat:
                continue
            fid = "news|" + re.sub(r"\W+", "", title.lower())[:80]
            if fid in fired:
                continue
            fired[fid] = now.isoformat()
            conf = "Unverified report" if UNVERIFIED.search(title) else (f"Confirmed — {len(set(outlets))} outlets" if len(set(outlets)) >= 2 else f"Single credible outlet ({outlet})")
            tag = {"cb": "cb", "geo": "world", "trump": "macro", "elec": "macro", "fiscal": "macro"}[cat[0]]
            out.append({"id": fid, "kind": "news", "tag": tag, "t": now.isoformat(), "mt": first.isoformat(),
                        "head": f"BREAKING – {title}", "trigger": f"Announced/reported: {title}.",
                        "impact": "Mixed", "why": cat[2], "status": conf,
                        "src": f"{', '.join(sorted(set(o for o in outlets if o))[:3])} · first reported {first.astimezone(tor).strftime('%-I:%M %p')} ET",
                        "url": it.get("url", "")})
    return out


def run(D, state, now, tor, yf, briefing=None, prices=True):
    """Returns today's alert list (kept in state['items']); new ones are appended."""
    day = now.astimezone(tor).date().isoformat()
    if state.get("day") != day:
        state.clear()
        state["day"] = day
    if now.astimezone(tor).weekday() >= 5:
        return []
    new = (scan_prices(D, state, now, tor, yf) if prices else []) + scan_news(briefing, state, now, tor)
    state.setdefault("items", [])
    state["items"] = (state["items"] + new)[-60:]
    return new


def public(state):
    """The part of the state that is published / carried across fast-lane runs (no caches)."""
    return {k: state[k] for k in ("day", "fired", "ext", "items") if k in state}
