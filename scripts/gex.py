#!/usr/bin/env python3
"""Index option gamma / dealer GEX profile (owner, Nov 23 2026) -> gex.json on the `gex` branch.

Source: Yahoo Finance option chains (delayed) — S&P 500 index options (^SPX), Nasdaq-100 index options (^NDX) and, for the
Dow, the DIA ETF (tracks the Dow ÷ 100; Yahoo carries no Dow index chain). Each contract carries open interest, volume and IV;
gamma is computed with Black-Scholes from that IV (Cboe's own feed refuses automated requests, so it is not used).

Per strike, over the expirations inside the next 30 days (the hedging window) and, separately, the nearest expiry:
  call OI, put OI, call gamma, put gamma, call IV, put IV, call volume, put volume
  GEX per 1% move ($) = gamma x OI x 100 (multiplier) x spot^2 x 0.01        (Cboe gamma is per 1 index point)
  net GEX = call GEX - put GEX   (the usual dealer convention: customers buy puts and sell calls, so dealers are
                                  long call gamma and short put gamma — an assumption, stated on the page)
Also: gamma flip (the spot where total net GEX re-priced across a grid of spot levels changes sign — approximated by the
strike where cumulative net GEX from the bottom crosses zero), call wall / put wall (most OI), ATM IV, 1-sigma moves.
'Normal regime' IV = the 1-year median of the index's own volatility index (VIX / VXN / VXD) from Yahoo.
Run: python scripts/gex.py [--dry-run]
"""
import json, math, os, sys, statistics, subprocess
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = UDC.ROOT
WT = os.path.join(ROOT, ".gex-wt")
IDX = {  # key: (yahoo symbol, name, vol index for the 'normal regime')
    "SPX": ("^SPX", "S&P 500", "^VIX"),
    "NDX": ("^NDX", "Nasdaq-100", "^VXN"),
    "DJX": ("DIA", "Dow Jones (DIA ETF = Dow ÷ 100)", "^VXD"),
}
WIN_DAYS = 30
BAND = 0.12          # strikes kept: spot ±12%


def npdf(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def bs_gamma(S, K, T, iv):
    """Black-Scholes gamma per 1 point of the underlying (r = 4%, no dividends — the shape and scale the hedging uses)"""
    if not (iv and iv > 0 and T > 0 and S > 0 and K > 0):
        return None
    r, sq = 0.04, math.sqrt(T)
    d1 = (math.log(S / K) + (r + iv * iv / 2) * T) / (iv * sq)
    return npdf(d1) / (S * iv * sq)


def vol_index(tk):
    """(1-year median, latest close) of the index's own volatility index"""
    try:
        h = UDC.yf().Ticker(tk).history(period="1y", interval="1d", auto_adjust=False)["Close"].dropna()
        if len(h) > 100:
            return round(float(statistics.median(h.values)), 2), round(float(h.iloc[-1]), 2)
    except Exception as e:
        print(f"  ! {tk}: {type(e).__name__}")
    return None, None


def build(key):
    ysym, name, vix = IDX[key]
    T_ = UDC.yf().Ticker(ysym)
    S = None
    try:
        S = float(T_.fast_info["last_price"])
    except Exception:
        pass
    if not S:
        h = T_.history(period="5d")["Close"].dropna()
        S = float(h.iloc[-1]) if len(h) else None
    if not S:
        raise ValueError("no spot")
    v_med, v_now = vol_index(vix)
    V = (v_now or v_med or 20.0) / 100
    fb = [0, 0]     # contracts whose quoted IV was missing / implausible -> the volatility index level is used for gamma
    now = datetime.now(timezone.utc)
    today = now.date()
    rows, exps = {}, {}
    for e in (T_.options or []):
        ex = date.fromisoformat(e)
        dte = (ex - today).days
        if dte < 0 or dte > WIN_DAYS:
            continue
        try:
            ch = T_.option_chain(e)
        except Exception as x:
            print(f"  ! {ysym} {e}: {type(x).__name__}")
            continue
        T = max((datetime(ex.year, ex.month, ex.day, 21, 0, tzinfo=timezone.utc) - now).total_seconds() / (365 * 86400), 0.5 / 365)
        for side, df in (("C", ch.calls), ("P", ch.puts)):
            for o in df.to_dict("records"):
                K = float(o.get("strike") or 0)
                if not K or abs(K / S - 1) > BAND:
                    continue
                oi = o.get("openInterest"); oi = float(oi) if oi == oi and oi is not None else 0.0
                iv = o.get("impliedVolatility"); iv = float(iv) if iv == iv and iv is not None else None
                fb[1] += 1
                if not (iv and 0.4 * V <= iv <= 3.0 * V):   # Yahoo IV is unreliable off-hours and deep in the money
                    iv = None; fb[0] += 1
                vol = o.get("volume"); vol = float(vol) if vol == vol and vol is not None else 0.0
                g = bs_gamma(S, K, T, iv or V)
                exps[e] = exps.get(e, 0) + 1
                for win in ("w30", e):
                    r = rows.setdefault((win, K), {"K": K, "coi": 0, "poi": 0, "cg": 0.0, "pg": 0.0, "cgex": 0.0, "pgex": 0.0, "civ": [], "piv": [], "cvol": 0, "pvol": 0})
                    gex = (g or 0) * oi * 100 * S * S * 0.01
                    if side == "C":
                        r["coi"] += oi; r["cvol"] += vol; r["cgex"] += gex
                        if g is not None and oi: r["cg"] += g * oi
                        if iv and iv < 3: r["civ"].append((iv * 100, oi + 1))
                    else:
                        r["poi"] += oi; r["pvol"] += vol; r["pgex"] += gex
                        if g is not None and oi: r["pg"] += g * oi
                        if iv and iv < 3: r["piv"].append((iv * 100, oi + 1))
    if not exps:
        raise ValueError("no expirations inside the window")
    near = min(exps)

    def wiv(L):
        w = sum(b for _, b in L)
        return round(sum(a * b for a, b in L) / w, 2) if w else None

    def table(win):
        L = sorted((v for (w, _), v in rows.items() if w == win), key=lambda r: r["K"])
        out = []
        for r in L:
            out.append([r["K"], int(r["coi"]), int(r["poi"]), round(r["cg"] / r["coi"], 6) if r["coi"] and r["cg"] else None,
                        round(r["pg"] / r["poi"], 6) if r["poi"] and r["pg"] else None, wiv(r["civ"]), wiv(r["piv"]),
                        int(r["cvol"]), int(r["pvol"]), round(r["cgex"] / 1e6, 2), round(r["pgex"] / 1e6, 2)])
        return out

    def summary(T, dte):
        if not T:
            return {}
        net = [(r[0], r[9] - r[10]) for r in T]
        cum, flip = 0.0, None
        for i, (k, v) in enumerate(net):
            prev = cum; cum += v
            if i and (prev < 0 <= cum or prev > 0 >= cum):
                flip = k
        atm = min(T, key=lambda r: abs(r[0] - S))
        ivs = [x for x in (atm[5], atm[6]) if x]
        aiv = round(sum(ivs) / len(ivs), 2) if ivs else round(V * 100, 2)
        # walls out of the money only: call wall = most call OI at/above spot, put wall = most put OI at/below it (owner, Nov 23 2026)
        up = [r for r in T if r[0] >= S] or T; dn = [r for r in T if r[0] <= S] or T
        cw = max(up, key=lambda r: r[1]); pw = max(dn, key=lambda r: r[2])
        return {"net_gex_m": round(sum(v for _, v in net), 1), "flip": flip, "call_wall": [cw[0], cw[1]], "put_wall": [pw[0], pw[2]],
                "atm_iv": aiv, "em": round(S * aiv / 100 * math.sqrt(max(dte, 1) / 365), 2) if aiv else None,
                "em_week": round(S * aiv / 100 * math.sqrt(7 / 365), 2) if aiv else None}

    near_dte = max((date.fromisoformat(near) - today).days, 0)
    far_dte = max((date.fromisoformat(max(exps)) - today).days, 0)
    T30, TN = table("w30"), table(near)
    scale = None
    if key == "DJX":   # DIA tracks the Dow ÷ ~100: the exact ratio today, so the page can show Dow index levels
        try:
            # both legs from the same 5-minute bar time (daily bars can lag a session for one and not the other)
            dj = UDC.yf().Ticker("^DJI").history(period="2d", interval="5m")["Close"].dropna()
            dh = T_.history(period="2d", interval="5m")["Close"].dropna()
            common = dj.index.intersection(dh.index)
            if len(common):
                t = common[-1]
                scale = round(float(dj.loc[t]) / float(dh.loc[t]), 4)
            if scale and not 95 <= scale <= 105:
                print(f"  ! Dow scale {scale} out of range — not used"); scale = None
        except Exception as e:
            print(f"  ! Dow scale: {type(e).__name__}")
    return {"key": key, "name": name, "spot": round(S, 2), "scale": scale, "ts": now.isoformat(timespec="seconds"), "symbol": ysym,
            "expiries": sorted(exps), "near": near, "near_dte": near_dte, "window_dte": far_dte,
            "normal_iv": v_med, "normal_src": vix + " 1-year median", "vol_index": v_now, "vol_index_sym": vix,
            "iv_fallback": {"n": fb[0], "of": fb[1]},
            "w30": {"rows": T30, **summary(T30, far_dte)}, "nearest": {"rows": TN, **summary(TN, near_dte)}}


def sh(*a, cwd=None, check=True):
    return subprocess.run(list(a), cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-gex-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=ROOT)
    sh("rm", "-rf", WT, check=False); sh("git", "worktree", "prune", cwd=ROOT, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "gex", cwd=ROOT, check=False).returncode == 0
    if exists:
        sh("git", "fetch", "-q", "--depth", "1", "origin", "gex:refs/remotes/origin/gex", cwd=ROOT, check=False)
        sh("git", "worktree", "add", "-f", "-B", "gex", WT, "origin/gex", cwd=ROOT)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=ROOT)
        sh("git", "checkout", "-q", "--orphan", "gex", cwd=WT); sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "gex.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "gex.json", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "gex: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "gex", cwd=WT)


def main():
    out, errs = {}, {}
    for k in IDX:
        try:
            out[k] = build(k)
            w = out[k]["w30"]
            print(f"{k}: spot {out[k]['spot']} · {len(w['rows'])} strikes · {len(out[k]['expiries'])} expiries · net {w.get('net_gex_m')}M · flip {w.get('flip')}")
        except Exception as e:
            errs[k] = f"{type(e).__name__}: {e}"[:200]
            print(f"! {k}: {errs[k]}")
    if not out:
        raise SystemExit("no index built")
    body = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "Yahoo Finance option chains (delayed); gamma = Black-Scholes on each contract's IV",
            "window_days": WIN_DAYS, "band_pct": BAND * 100, "indices": out, "errors": errs}
    if "--dry-run" in sys.argv:
        return
    publish(body)
    print("published gex.json to the gex branch")


if __name__ == "__main__":
    main()
