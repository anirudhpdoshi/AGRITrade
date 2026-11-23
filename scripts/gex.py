#!/usr/bin/env python3
"""Index option gamma / dealer GEX profile (owner, Nov 23 2026) -> gex.json on the `gex` branch.

Source: Cboe delayed option quotes (public JSON, ~15 min delayed) for S&P 500 (SPX + SPXW), Nasdaq-100 (NDX + NDXP) and
Dow (DJX = Dow Jones Industrial Average / 100). Each quote carries open interest, IV and Cboe's own gamma.

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
import json, math, os, re, sys, statistics, subprocess
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = UDC.ROOT
WT = os.path.join(ROOT, ".gex-wt")
IDX = {  # key: (cboe symbol, name, roots kept, spot scale to the index level, vol index)
    "SPX": ("_SPX", "S&P 500", ("SPX", "SPXW"), 1.0, "^VIX"),
    "NDX": ("_NDX", "Nasdaq-100", ("NDX", "NDXP"), 1.0, "^VXN"),
    "DJX": ("_DJX", "Dow Jones (DJX = Dow ÷ 100)", ("DJX",), 1.0, "^VXD"),
}
SYM = re.compile(r"^([A-Z]+?)(\d{6})([CP])(\d{8})$")
WIN_DAYS = 30
BAND = 0.12          # strikes kept: spot ±12%


def fetch(sym):
    import requests
    r = requests.get(f"https://cdn.cboe.com/api/global/delayed_quotes/options/{sym}.json", timeout=40,
                     headers={"User-Agent": "Mozilla/5.0 (AGRITrade desk; gamma profile)", "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def vol_median(tk):
    try:
        h = UDC.yf().Ticker(tk).history(period="1y", interval="1d", auto_adjust=False)["Close"].dropna()
        return round(float(statistics.median(h.values)), 2) if len(h) > 100 else None
    except Exception as e:
        print(f"  ! {tk}: {type(e).__name__}")
        return None


def build(key):
    sym, name, roots, scale, vix = IDX[key]
    J = fetch(sym)
    D = J.get("data") or {}
    S = float(D.get("current_price") or D.get("close") or 0) * scale
    if not S:
        raise ValueError("no spot")
    today = datetime.now(timezone.utc).date()
    rows = {}     # (window, K) -> dict
    exps = {}
    for o in D.get("options") or []:
        m = SYM.match(o.get("option", ""))
        if not m or m.group(1) not in roots:
            continue
        ex = datetime.strptime(m.group(2), "%y%m%d").date()
        dte = (ex - today).days
        if dte < 0 or dte > WIN_DAYS:
            continue
        K = int(m.group(4)) / 1000.0
        if abs(K / S - 1) > BAND:
            continue
        exps.setdefault(ex.isoformat(), 0)
        exps[ex.isoformat()] += 1
        side = m.group(3)
        oi = float(o.get("open_interest") or 0)
        g = o.get("gamma")
        g = float(g) if g not in (None, "") else None
        iv = o.get("iv")
        iv = float(iv) * 100 if iv not in (None, "") and float(iv) > 0 else None
        vol = float(o.get("volume") or 0)
        for win in ("w30", ex.isoformat()):
            r = rows.setdefault((win, K), {"K": K, "coi": 0, "poi": 0, "cg": 0.0, "pg": 0.0, "cgex": 0.0, "pgex": 0.0, "civ": [], "piv": [], "cvol": 0, "pvol": 0})
            gex = (g or 0) * oi * 100 * S * S * 0.01
            if side == "C":
                r["coi"] += oi; r["cvol"] += vol; r["cgex"] += gex
                if g is not None and oi: r["cg"] += g * oi
                if iv: r["civ"].append((iv, oi + 1))
            else:
                r["poi"] += oi; r["pvol"] += vol; r["pgex"] += gex
                if g is not None and oi: r["pg"] += g * oi
                if iv: r["piv"].append((iv, oi + 1))
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
        aiv = round(sum(ivs) / len(ivs), 2) if ivs else None
        cw = max(T, key=lambda r: r[1]); pw = max(T, key=lambda r: r[2])
        return {"net_gex_m": round(sum(v for _, v in net), 1), "flip": flip, "call_wall": [cw[0], cw[1]], "put_wall": [pw[0], pw[2]],
                "atm_iv": aiv, "em": round(S * aiv / 100 * math.sqrt(max(dte, 1) / 365), 2) if aiv else None,
                "em_week": round(S * aiv / 100 * math.sqrt(7 / 365), 2) if aiv else None}

    near_dte = max((date.fromisoformat(near) - today).days, 0)
    far_dte = max((date.fromisoformat(max(exps)) - today).days, 0)
    T30, TN = table("w30"), table(near)
    return {"key": key, "name": name, "spot": round(S, 2), "ts": J.get("timestamp"), "roots": list(roots),
            "expiries": sorted(exps), "near": near, "near_dte": near_dte, "window_dte": far_dte,
            "normal_iv": vol_median(vix), "normal_src": vix + " 1-year median",
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
    body = {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "Cboe delayed quotes (about 15 min delayed)",
            "window_days": WIN_DAYS, "band_pct": BAND * 100, "indices": out, "errors": errs}
    if "--dry-run" in sys.argv:
        return
    publish(body)
    print("published gex.json to the gex branch")


if __name__ == "__main__":
    main()
