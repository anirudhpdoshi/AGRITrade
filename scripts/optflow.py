"""Options flow & expiration intelligence for the grain desk (daily tier) -> DATA.optflow[grain].

Built only from data the desk already holds: the morning options pull (open interest, midpoint IV and — once the
pull stores it — daily volume per strike), the futures settles and daily highs/lows. Everything derived here is an
ESTIMATE and is labelled so on the page:
  * expected move per expiration  = F × ATM IV × √(days to expiry / 365)   (1σ, options-implied, not a forecast)
  * next-day expected move        = F × near IV × √(1 / 252)
  * premium                       = contracts × Black-76 value at the strike's IV × 5,000 bu   (no fills are seen)
  * dealer gamma (GEX) / delta    = Black-76 gamma/delta × OI × 5,000 bu, under the convention "dealers long calls,
                                    short puts" — a modelling assumption, not observed positioning
  * gamma flip                    = futures price where the estimated net GEX changes sign
Trade-level flow (buyer/seller side, sweeps, blocks, sizes, largest trades, intraday accumulation) needs a paid
time-and-sales feed and is not computed.
History: one record per open-interest date (expected range, IV, positioning) and, once the next session settles, the
actual outcome (gap, high/low, close, breach). Analogue statistics compare today with past records.
"""
import datetime as dt
import math

MULT = 5000          # bushels per CBOT grain option
TRADING_DAYS = 252


def _n(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def _N(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def b76(F, K, T, iv, call):
    """Black-76 (r≈0): value, delta, gamma per 1 $/bu move."""
    if not (F > 0 and K > 0 and T > 0 and iv and iv > 0):
        return None
    s = iv / 100 * math.sqrt(T)
    d1 = (math.log(F / K) + s * s / 2) / s
    d2 = d1 - s
    val = F * _N(d1) - K * _N(d2) if call else K * _N(-d2) - F * _N(-d1)
    return {"v": val, "d": _N(d1) if call else _N(d1) - 1, "g": _n(d1) / (F * s)}


def _T(expires, now):
    try:
        e = dt.datetime.fromisoformat(expires + "T19:15:00+00:00")   # 1:15 pm CT
    except Exception:
        return None, None
    days = (e - now).total_seconds() / 86400
    return max(days, 0.01) / 365, days


def chain_stats(ch, F, now, iv_fallback=None):
    rows = ch.get("rows") or []
    T, days = _T(ch.get("expires") or ch.get("expiry") or "", now)
    iv = ch.get("iv") or iv_fallback
    out = {"contract": ch.get("contract"), "chain": ch.get("chain") or ch.get("label"), "expires": ch.get("expires") or ch.get("expiry"), "dte": round(days, 1) if days is not None else None,
           "atm_iv": iv, "calls_oi": sum(r[1] for r in rows), "puts_oi": sum(r[2] for r in rows)}
    out["pcr"] = round(out["puts_oi"] / out["calls_oi"], 2) if out["calls_oi"] else None
    if T and iv and F:
        em = F * iv / 100 * math.sqrt(T * 365 / 365)
        out.update(em=round(em, 4), em_pct=round(iv * math.sqrt(T), 2), lo=round(F - em, 4), hi=round(F + em, 4))
    vol_c = sum((r[5] or 0) for r in rows if len(r) > 6)
    vol_p = sum((r[6] or 0) for r in rows if len(r) > 6)
    has_vol = any(len(r) > 6 and (r[5] is not None or r[6] is not None) for r in rows)
    strikes, gex, dex, prem_c, prem_p = [], 0.0, 0.0, 0.0, 0.0
    for r in rows:
        K = r[0]
        civ = r[3] if len(r) > 3 and r[3] else iv
        piv = r[4] if len(r) > 4 and r[4] else iv
        c = b76(F, K, T, civ, True) if T else None
        p = b76(F, K, T, piv, False) if T else None
        g_c = (c["g"] * r[1] * MULT * F * F * 0.01) if c else 0     # $ change in dealer delta per 1% move
        g_p = (p["g"] * r[2] * MULT * F * F * 0.01) if p else 0
        gex += g_c - g_p
        dex += ((c["d"] * r[1]) if c else 0) + ((p["d"] * r[2]) if p else 0)
        vc = r[5] if len(r) > 6 else None
        vp = r[6] if len(r) > 6 else None
        pc = (vc or 0) * c["v"] * MULT if c and vc else 0
        pp = (vp or 0) * p["v"] * MULT if p and vp else 0
        prem_c += pc
        prem_p += pp
        strikes.append({"k": K, "coi": r[1], "poi": r[2], "cvol": vc, "pvol": vp, "gex": round(g_c - g_p), "prem": round(pc + pp),
                        "voi": round(((vc or 0) + (vp or 0)) / max(1, r[1] + r[2]), 3) if has_vol else None})
    out.update(gex=round(gex), dex=round(dex), has_vol=has_vol, vol_c=vol_c if has_vol else None, vol_p=vol_p if has_vol else None,
               prem_c=round(prem_c) if has_vol else None, prem_p=round(prem_p) if has_vol else None)
    # gamma flip: re-price the whole chain on a grid of futures prices and find where net GEX crosses zero
    if T and iv and rows:
        grid, prev, flip = [F * (1 + x / 200) for x in range(-30, 31)], None, None
        for X in grid:
            net = 0.0
            for r in rows:
                c = b76(X, r[0], T, (r[3] if len(r) > 3 and r[3] else iv), True)
                p = b76(X, r[0], T, (r[4] if len(r) > 4 and r[4] else iv), False)
                net += (c["g"] * r[1] if c else 0) - (p["g"] * r[2] if p else 0)
            if prev is not None and (prev[1] < 0) != (net < 0):
                cand = prev[0] + (X - prev[0]) * abs(prev[1]) / (abs(prev[1]) + abs(net))
                if flip is None or abs(cand - F) < abs(flip - F):
                    flip = cand
            prev = (X, net)
        out["flip"] = round(flip, 4) if flip else None
    near = sorted(strikes, key=lambda s: -(s["coi"] + s["poi"]))
    out["top_oi"] = near[:8]
    out["top_gex"] = sorted(strikes, key=lambda s: -abs(s["gex"]))[:5]
    if has_vol:
        out["top_vol"] = sorted(strikes, key=lambda s: -((s["cvol"] or 0) + (s["pvol"] or 0)))[:8]
        out["top_voi"] = sorted([s for s in strikes if (s["coi"] + s["poi"]) >= 200], key=lambda s: -(s["voi"] or 0))[:5]
    return out


def build_grain(g, hl, now, prev):
    """hl: {date: (high, low, close)} for the front futures; prev: last DATA.optflow[grain] (keeps the history)."""
    F = None
    try:
        F = float(g["fan"]["intraday"][0])
    except Exception:
        pass
    S = float(g["fan"].get("anchor") or 0)
    near = g.get("near") or {}
    iv_n = near.get("iv")
    res = {"asof": now.isoformat(), "price": F or S, "settle": S, "settle_date": g["fan"].get("settle_date"), "chains": []}
    for leg in ("near", "far"):
        ch = g.get(leg)
        if ch and ch.get("rows"):
            Fu = ch.get("underlying") or (F if leg == "near" else None) or S
            if leg == "near" and F:
                Fu = F
            st = chain_stats(ch, float(Fu), now)
            st["leg"] = leg
            res["chains"].append(st)
    for w in g.get("weeklies") or []:
        if w.get("rows"):
            st = chain_stats(dict(w, expires=w.get("expiry"), chain=w.get("label")), float(F or S), now, iv_fallback=iv_n)
            st["leg"] = "weekly"
            res["chains"].append(st)
    res["chains"].sort(key=lambda c: c.get("dte") if c.get("dte") is not None else 9e9)
    if iv_n and S:
        em1 = S * iv_n / 100 * math.sqrt(1 / TRADING_DAYS)
        res["next_day"] = {"from": res["settle_date"], "settle": S, "iv": iv_n, "em": round(em1, 4), "lo": round(S - em1, 4), "hi": round(S + em1, 4)}
    # ---- history: one record per settle date; outcome filled when the next session settles
    hist = list((prev or {}).get("hist") or [])
    byd = {h["d"]: h for h in hist}
    nc = next((c for c in res["chains"] if c.get("leg") == "near"), {})
    if res.get("next_day") and res["settle_date"]:
        d = res["settle_date"]
        rec = byd.get(d) or {"d": d}
        rec.update(s=S, iv=iv_n, em=res["next_day"]["em"], lo=res["next_day"]["lo"], hi=res["next_day"]["hi"], pcr=nc.get("pcr"), gex=nc.get("gex"), flip=nc.get("flip"),
                   contract=g["roll"][0]["contract"] if g.get("roll") else None)
        byd[d] = rec
    dates = sorted(hl)
    for d, rec in byd.items():
        if rec.get("out") or not rec.get("s"):
            continue
        nxt = [x for x in dates if x > d]
        if nxt:
            h, l, c = hl[nxt[0]]
            ret = (c / rec["s"] - 1) * 100
            rec["out"] = {"d": nxt[0], "close": c, "high": h, "low": l, "ret": round(ret, 2), "move": round(c - rec["s"], 4),
                          "breach_close": c > rec["hi"] or c < rec["lo"], "breach_intraday": (h > rec["hi"] or l < rec["lo"]) if h is not None and l is not None else None,
                          "realized_vs_implied": round(abs(c - rec["s"]) / rec["em"], 2) if rec.get("em") else None}
    hist = sorted(byd.values(), key=lambda r: r["d"])[-260:]
    res["hist"] = hist
    # ---- analogues: past records with similar IV (±15%), put/call side and gamma sign
    done = [h for h in hist if h.get("out")]
    if res.get("next_day"):
        cur = {"iv": iv_n, "pcr": nc.get("pcr"), "gex": nc.get("gex")}
        sim = [h for h in done if h.get("iv") and abs(h["iv"] / iv_n - 1) <= 0.15
               and (cur["pcr"] is None or h.get("pcr") is None or (h["pcr"] >= 1) == (cur["pcr"] >= 1))
               and (cur["gex"] is None or h.get("gex") is None or (h["gex"] >= 0) == (cur["gex"] >= 0))]

        def stats(L):
            if not L:
                return {"n": 0}
            r = sorted(x["out"]["ret"] for x in L)
            return {"n": len(L), "avg": round(sum(r) / len(r), 2), "median": round(r[len(r) // 2] if len(r) % 2 else (r[len(r) // 2 - 1] + r[len(r) // 2]) / 2, 2),
                    "p_up": round(sum(1 for x in r if x > 0) / len(r) * 100), "p_down": round(sum(1 for x in r if x < 0) / len(r) * 100),
                    "p_breach_close": round(sum(1 for x in L if x["out"]["breach_close"]) / len(L) * 100),
                    "p_breach_intraday": (round(sum(1 for x in L if x["out"]["breach_intraday"]) / sum(1 for x in L if x["out"]["breach_intraday"] is not None) * 100) if any(x["out"]["breach_intraday"] is not None for x in L) else None),
                    "rv_iv": round(sum(x["out"]["realized_vs_implied"] or 0 for x in L) / len(L), 2)}
        res["analogues"] = {"similar": stats(sim), "all": stats(done), "rule": "IV within ±15% of today's, same side of put/call 1.0 and same sign of estimated net GEX",
                            "confidence": "Low" if len(sim) < 10 else "Medium" if len(sim) < 30 else "High"}
    return res
