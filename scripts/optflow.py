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
    vanna = -_n(d1) * d2 / (iv / 100)                       # d(delta)/d(vol), per 1.00 of vol
    charm = -_n(d1) * (-d2 / (2 * T))                         # d(delta)/d(time) per year (r≈0, same for calls and puts)
    return {"v": val, "d": _N(d1) if call else _N(d1) - 1, "g": _n(d1) / (F * s), "vanna": vanna, "charm": charm}


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


def positioning(ch, F, now, hl, em):
    """Strike-by-strike positioning from two confirmed daily OI snapshots (rows vs rows_prev) plus IV change and price action.
    Classification is inference (labelled so): OI up + IV up -> more likely bought (long); OI up + IV down -> more likely
    written (short); OI down -> closing. Daily OI cannot prove opening vs closing for any single trade."""
    rows, prev = ch.get("rows") or [], (ch.get("rows_prev") or {}).get("rows") or []
    T, _d = _T(ch.get("expires") or "", now)
    iv = ch.get("iv")
    P = {round(r[0], 4): r for r in prev}
    tot = sum(r[1] + r[2] for r in rows) or 1
    dates = sorted(hl)[-20:]
    out, vanna, charm = [], 0.0, 0.0
    for r in rows:
        K = r[0]
        p = P.get(round(K, 4))
        civ = r[3] if len(r) > 3 and r[3] else iv
        piv = r[4] if len(r) > 4 and r[4] else iv
        c = b76(F, K, T, civ, True) if T else None
        q = b76(F, K, T, piv, False) if T else None
        if c: vanna += c["vanna"] * r[1] * MULT; charm += c["charm"] * r[1] * MULT
        if q: vanna -= q["vanna"] * r[2] * MULT; charm -= q["charm"] * r[2] * MULT
        if r[1] + r[2] < 0.01 * tot:
            continue
        dc = r[1] - p[1] if p else None
        dp = r[2] - p[2] if p else None
        divc = (r[3] - p[3]) if p and len(p) > 3 and len(r) > 3 and p[3] and r[3] else None
        divp = (r[4] - p[4]) if p and len(p) > 4 and len(r) > 4 and p[4] and r[4] else None
        def cls(side, d, div, base):
            if d is None:
                return None
            if abs(d) < max(150, 0.03 * max(base, 1)):
                return "steady"
            if d < 0:
                return "closing"
            return ("long " if div is not None and div > 0 else "short " if div is not None and div < 0 else "new ") + side
        lc, lp = cls("calls", dc, divc, p[1] if p else 0), cls("puts", dp, divp, p[2] if p else 0)
        touches = [x for x in dates if hl[x][0] is not None and hl[x][1] <= K <= hl[x][0]]
        above = sum(1 for x in dates if hl[x][2] > K); below = len(dates) - above
        held_sup = sum(1 for x in touches if hl[x][2] >= K); held_res = sum(1 for x in touches if hl[x][2] <= K)
        gex = ((c["g"] * r[1]) if c else 0) - ((q["g"] * r[2]) if q else 0)
        dist = (K - F) / F * 100
        # strike role (potential, never certain)
        role, why = "weak", []
        conc = (r[1] + r[2]) / tot * 100
        if K < F and r[2] >= r[1]:
            role = "support"; why.append("put-heavy below price")
        elif K > F and r[1] >= r[2]:
            role = "resistance"; why.append("call-heavy above price")
        if abs(dist) <= 1.0 and conc >= 6:
            role = "magnet"; why.append("large two-sided open interest near price")
        if gex < 0 and abs(dist) <= 4 and role != "magnet" and conc >= 4:
            role = role if role in ("support", "resistance") else "acceleration"; why.append("short-gamma strike — hedging can speed a move through it")
        if (dc or 0) + (dp or 0) < -0.1 * max(1, (p[1] + p[2]) if p else 1):
            role = "weakening"; why.append("open interest down more than 10% day over day")
        if role == "support" and dates and hl[dates[-1]][2] < K: role, why = "broken support", why + ["last close below the strike"]
        if role == "resistance" and dates and hl[dates[-1]][2] > K: role, why = "broken resistance", why + ["last close above the strike"]
        if (lp or "").startswith("short") and K < F: why.append("puts likely written — sellers defend this level")
        if (lc or "").startswith("short") and K > F: why.append("calls likely written — sellers cap this level")
        if (lp or "").startswith("long"): why.append("puts likely bought — protection or bearish bets")
        if (lc or "").startswith("long"): why.append("calls likely bought — upside bets")
        if touches: why.append(f"traded through {len(touches)}× in the last {len(dates)} sessions; closes held as support {held_sup}×, as resistance {held_res}×")
        score = conc + (5 if p and ((dc or 0) + (dp or 0)) > 0 else 0) + (5 if touches and (held_sup if role == 'support' else held_res) >= max(1, len(touches) / 2) else 0)
        conf = "Medium" if p and civ and score >= 10 else "Low"
        out.append({"k": K, "dist": round(dist, 2), "coi": r[1], "poi": r[2], "dc": dc, "dp": dp, "dc_pct": round(dc / p[1] * 100, 1) if p and p[1] and dc is not None else None,
                    "dp_pct": round(dp / p[2] * 100, 1) if p and p[2] and dp is not None else None, "conc": round(conc, 1), "civ": civ, "piv": piv, "divc": round(divc, 2) if divc is not None else None,
                    "divp": round(divp, 2) if divp is not None else None, "lc": lc, "lp": lp, "gex": round(gex * MULT * F * F * 0.01), "role": role, "why": why, "conf": conf,
                    "touch": len(touches), "in_em": abs(K - F) <= (em or 0), "vol": ((r[5] or 0) + (r[6] or 0)) if len(r) > 6 else None,
                    "prem_c": round((r[5] or 0) * c["v"] * MULT) if len(r) > 6 and c and r[5] else None, "prem_p": round((r[6] or 0) * q["v"] * MULT) if len(r) > 6 and q and r[6] else None})
    out.sort(key=lambda x: -(x["coi"] + x["poi"]))
    # directional score: bought calls / written puts lean bullish; bought puts / written calls lean bearish (weighted by contracts)
    w = {"long calls": 1, "short puts": 1, "long puts": -1, "short calls": -1}
    bull = bear = hedge = 0
    for x in out:
        for lab, d in ((x["lc"], x["dc"]), (x["lp"], x["dp"])):
            if lab in w and d:
                if w[lab] > 0: bull += d
                else: bear += d
                if lab == "long puts" and x["k"] < F: hedge += d
    adds = sorted([x for x in out if x["dc"] is not None], key=lambda x: -((x["dc"] or 0) + (x["dp"] or 0)))
    tot_d = bull + bear
    score = round((bull - bear) / tot_d * 100) if tot_d else 0
    biv = [x for x in out if x["divc"] is not None or x["divp"] is not None]
    ivchg = round(sum(((x["divc"] or 0) + (x["divp"] or 0)) / 2 for x in biv) / len(biv), 2) if biv else None
    if not prev:
        label = "unknown — needs two daily snapshots"
    elif tot_d < 0.002 * tot:
        label = "mixed / inconclusive"
    elif score >= 25:
        label = "bullish positioning"
    elif score <= -25:
        label = "bearish positioning" if hedge < 0.6 * bear else "protective hedging"
    else:
        label = "mixed / inconclusive"
    unwind = sum(min(0, x["dc"] or 0) + min(0, x["dp"] or 0) for x in out)
    if prev and -unwind > 2 * max(1, sum(max(0, x["dc"] or 0) + max(0, x["dp"] or 0) for x in out)):
        label = "position unwinding"
    vol_view = "volatility expansion" if ivchg is not None and ivchg >= 0.5 else "volatility compression" if ivchg is not None and ivchg <= -0.5 else "volatility steady"
    rolls = []
    for side, key in (("calls", "dc"), ("puts", "dp")):
        dn = [x for x in out if (x[key] or 0) < -500]; up = [x for x in out if (x[key] or 0) > 500]
        for a in dn:
            b = min(up, key=lambda y: abs(abs(y[key]) - abs(a[key])), default=None)
            if b and abs(abs(b[key]) - abs(a[key])) <= 0.35 * abs(a[key]) and b["k"] != a["k"]:
                rolls.append(f"{side}: {a['k']:.2f} → {b['k']:.2f} (≈{abs(a[key]):,} contracts)")
    near = [x for x in out if abs(x["dist"]) <= 8 or x["role"].startswith("broken")]
    big3 = [x for x in out[:3] if x not in near]
    show = sorted(near, key=lambda x: abs(x["dist"]))[:12] + big3
    share = tot_d / tot * 100
    pconf = "Low" if (not prev or share < 0.5) else "Medium" if share < 2 else "High"
    return {"conf": pconf, "share": round(share, 2), "strikes": show, "score": score if prev else None, "label": label, "vol_view": vol_view, "iv_chg": ivchg, "bull": bull, "bear": bear, "hedge": hedge,
            "adds": [{"k": x["k"], "d": (x["dc"] or 0) + (x["dp"] or 0), "dc": x["dc"], "dp": x["dp"]} for x in adds[:5]],
            "cuts": [{"k": x["k"], "d": (x["dc"] or 0) + (x["dp"] or 0), "dc": x["dc"], "dp": x["dp"]} for x in adds[::-1][:5] if (x["dc"] or 0) + (x["dp"] or 0) < 0],
            "rolls": rolls[:3], "vanna": round(vanna), "charm": round(charm), "prev_date": (ch.get("rows_prev") or {}).get("date"),
            "top_calls": [[x["k"], x["coi"]] for x in sorted(out, key=lambda x: -x["coi"])[:10]], "top_puts": [[x["k"], x["poi"]] for x in sorted(out, key=lambda x: -x["poi"])[:10]]}


def p_touch(F, K, iv, T):
    """Probability (lognormal, driftless) that price trades at K before T ≈ 2 × P(finish beyond K)."""
    if not (F and K and iv and T):
        return None
    z = abs(math.log(K / F)) / (iv / 100 * math.sqrt(T))
    return round(min(1.0, 2 * (1 - _N(z))) * 100)


def conclusion(name, F, nc, pos, nd, A):
    st = pos["strikes"]
    if not st:
        return []
    big = max(st, key=lambda x: x["coi"] + x["poi"])
    sup = [x for x in st if x["role"] == "support"]; res_ = [x for x in st if x["role"] == "resistance"]
    s1 = max(sup, key=lambda x: x["poi"]) if sup else None; r1 = max(res_, key=lambda x: x["coi"]) if res_ else None
    gx = nc.get("gex")
    add = pos["adds"][0] if pos["adds"] and pos["adds"][0]["d"] > 0 else None
    q = [
        ("Where is the largest outstanding risk?", f"{big['k']:.2f} strike — {big['coi']:,} calls / {big['poi']:,} puts ({big['conc']:.0f}% of the near chain), {big['dist']:+.1f}% from price."),
        ("Where is new capital entering?", (f"{add['k']:.2f} (+{add['d']:,} contracts since {pos['prev_date']})" if add else "No meaningful net additions on the latest confirmed update.") + (" · possible rolls: " + "; ".join(pos["rolls"]) if pos["rolls"] else "")),
        ("Building, closing or rolling?", f"{pos['label'].capitalize()} · {pos['bull']:,} new contracts lean bullish (calls bought / puts written) vs {pos['bear']:,} lean bearish (puts bought / calls written) — inferred from the OI and IV change." if pos["score"] is not None else "Needs two daily open-interest snapshots."),
        ("Potential support and resistance?", f"Support {s1['k']:.2f} ({s1['poi']:,} puts) · resistance {r1['k']:.2f} ({r1['coi']:,} calls)" if s1 and r1 else "No clear put-heavy level below / call-heavy level above price."),
        ("Will dealer hedging amplify or dampen moves?", ("Amplify — estimated dealers short gamma" if gx is not None and gx < 0 else "Dampen — estimated dealers long gamma") + (f"; behaviour may change near the gamma flip {nc['flip']:.2f}" if nc.get("flip") else "") + " (convention: dealers long calls, short puts)."),
        ("Dominant directional positioning?", f"{pos['label']} (score {pos['score']:+d} of ±100) · {pos['vol_view']}" if pos["score"] is not None else pos["label"]),
        ("What invalidates the current read?", (f"A settle below {s1['k']:.2f}" if s1 else "") + (" or above " + f"{r1['k']:.2f}" if r1 else "") + (" — outside the levels the options market is defending." if s1 or r1 else "No defended levels identified.")),
        ("What to watch next session?", (f"Expected range {nd['lo']:.4f}–{nd['hi']:.4f}" if nd else "") + (f" · touch odds {s1['k']:.2f}: {s1.get('p_touch','—')}%" if s1 else "") + (f", {r1['k']:.2f}: {r1.get('p_touch','—')}%" if r1 else "") + " · whether new OI confirms or reverses today's changes."),
    ]
    return [{"q": a, "a": b} for a, b in q]


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
    # ---- positioning engine on the near chain (confirmed daily OI vs the previous snapshot)
    nch = g.get("near") or {}
    if nch.get("rows"):
        ncs = next((c for c in res["chains"] if c.get("leg") == "near"), {})
        Fn = float(F or S)
        pos = positioning(nch, Fn, now, hl, (res.get("next_day") or {}).get("em"))
        Tn, _ = _T(nch.get("expires") or "", now)
        for x in pos["strikes"]:
            x["p_touch"] = p_touch(Fn, x["k"], nch.get("iv"), Tn)
            x["p_touch_1d"] = p_touch(Fn, x["k"], nch.get("iv"), 1 / TRADING_DAYS)
        res["positioning"] = pos
        res["conclusion"] = conclusion(g.get("name", ""), Fn, ncs, pos, res.get("next_day"), None)
    # ---- history: one record per settle date; outcome filled when the next session settles
    hist = list((prev or {}).get("hist") or [])
    byd = {h["d"]: h for h in hist}
    nc = next((c for c in res["chains"] if c.get("leg") == "near"), {})
    if res.get("next_day") and res["settle_date"]:
        d = res["settle_date"]
        rec = byd.get(d) or {"d": d}
        rec.update(score=(res.get("positioning") or {}).get("score"), label=(res.get("positioning") or {}).get("label"), s=S, iv=iv_n, em=res["next_day"]["em"], lo=res["next_day"]["lo"], hi=res["next_day"]["hi"], pcr=nc.get("pcr"), gex=nc.get("gex"), flip=nc.get("flip"),
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
    perf = {}
    for n in (20, 60, 90):
        L = [h for h in done][-n:]
        if L:
            dirn = [h for h in L if h.get("score") not in (None, 0)]
            perf[str(n)] = {"n": len(L), "breach_close": round(sum(1 for h in L if h["out"]["breach_close"]) / len(L) * 100), "rv_iv": round(sum(h["out"]["realized_vs_implied"] or 0 for h in L) / len(L), 2),
                            "dir_n": len(dirn), "dir_hit": round(sum(1 for h in dirn if (h["score"] > 0) == (h["out"]["ret"] > 0)) / len(dirn) * 100) if dirn else None}
    res["ledger"] = perf
    return res
