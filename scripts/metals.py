#!/usr/bin/env python3
"""Canada mineral & metal exports and FX tracker (owner, Nov 21 2026) -> metals.json

Segments and commodities follow Natural Resources Canada's mineral-trade groupings (Mineral Trade information bulletin);
each commodity is a set of HS lines (stages 1–3: ores/concentrates, smelted/refined, semi-fabricated).

Sources (official unless stated):
  Trade   UN Comtrade public API — Canada's exports as reported by Statistics Canada (customs basis, domestic + re-exports),
          annual 5 years + latest months, world totals and destination countries. Values US$, converted to C$ at the
          Bank of Canada annual / monthly average. Re-pulled when the cache is over 6 days old (new months appear monthly).
  Prices  World Bank Pink Sheet monthly averages (official) — 2025 averages and the latest month for metals without a daily feed;
          COMEX/NYMEX futures via Yahoo (delayed market data) — daily for gold, silver, platinum, palladium, copper, aluminium.
  FX      Bank of Canada Valet FXUSDCAD.

Estimates (labelled in the UI): price ratio = current / 2025 average; implied annual value = 2025 value x (5-yr average volume /
2025 volume) x price ratio; erosion = implied - 2025 actual, split into price and volume effects; FX earnings impact = total erosion
in US$ and C$; CAD link = 1-year daily correlation / beta of USD/CAD on an export-weighted metals index (history, not a forecast).
Run: python scripts/metals.py [--dry-run] [--force-trade]
"""
import io, json, math, os, sys, time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC
import intel as INT

ROOT = UDC.ROOT
OUT = os.path.join(ROOT, "metals.json")
CACHE = os.path.join(ROOT, "scripts", "data", "metals_trade.json")
CT = "https://comtradeapi.un.org/public/v1/preview/C/{f}/HS"
OZ_KG = 1000 / 31.1034768                     # troy ounces per kg

# segment, id, name, HS lines, volume unit (oz|t), price: (yahoo symbol, factor to WB unit) / WB header / unit
S_PREC, S_BASE, S_FERR, S_BATT, S_CRIT, S_IND, S_ENER = ("precious", "base", "ferrous", "battery", "critical", "industrial", "energy")
SEGMENTS = [[S_PREC, "Precious metals"], [S_BASE, "Base metals"], [S_FERR, "Ferrous metals"], [S_BATT, "Battery metals"],
            [S_CRIT, "Critical minerals"], [S_IND, "Industrial minerals"], [S_ENER, "Energy minerals"]]
STEEL = [str(c) for c in range(7206, 7230)]
C = [
    [S_PREC, "gold", "Gold", ["7108"], "oz", "GC=F", 1, "gold", "$/oz"],
    [S_PREC, "silver", "Silver", ["7106"], "oz", "SI=F", 1, "silver", "$/oz"],
    [S_PREC, "platinum", "Platinum", ["711011", "711019"], "oz", "PL=F", 1, "platinum", "$/oz"],
    [S_PREC, "palladium", "Palladium", ["711021", "711029"], "oz", "PA=F", 1, None, "$/oz"],
    [S_BASE, "copper", "Copper", ["2603", "7401", "7402", "7403", "7404"], "t", "HG=F", 2204.62262, "copper", "$/t"],
    [S_BASE, "aluminium", "Aluminum", ["7601", "7602"], "t", "ALI=F", 1, "aluminum", "$/t"],
    [S_BASE, "nickel", "Nickel", ["2604", "7501", "7502", "7503"], "t", None, 1, "nickel", "$/t"],
    [S_BASE, "zinc", "Zinc", ["2608", "7901", "7902"], "t", None, 1, "zinc", "$/t"],
    [S_BASE, "lead", "Lead", ["2607", "7801", "7802"], "t", None, 1, "lead", "$/t"],
    [S_FERR, "ironore", "Iron ore", ["2601"], "t", None, 1, "iron ore", "$/dmt"],
    [S_FERR, "iron", "Iron (pig iron, DRI)", ["7201", "7203"], "t", None, 1, None, ""],
    [S_FERR, "steel", "Steel (semi-finished, flat, long)", STEEL, "t", None, 1, None, ""],
    [S_BATT, "lithium", "Lithium (carbonate, oxide/hydroxide)", ["283691", "282520"], "t", None, 1, None, ""],
    [S_BATT, "cobalt", "Cobalt", ["2605", "8105", "2822"], "t", None, 1, None, ""],
    [S_BATT, "graphite", "Graphite", ["250410", "250490", "380110"], "t", None, 1, None, ""],
    [S_BATT, "manganese", "Manganese", ["2602", "8111"], "t", None, 1, None, ""],
    [S_CRIT, "niobium", "Niobium (ferro-niobium)", ["720293"], "t", None, 1, None, ""],
    [S_CRIT, "tantalum", "Tantalum (incl. Nb/Ta ores)", ["261590", "8103"], "t", None, 1, None, ""],
    [S_CRIT, "tungsten", "Tungsten", ["2611", "8101"], "t", None, 1, None, ""],
    [S_CRIT, "molybdenum", "Molybdenum", ["2613", "720270", "8102"], "t", None, 1, None, ""],
    [S_CRIT, "vanadium", "Vanadium", ["720292", "282530"], "t", None, 1, None, ""],
    [S_CRIT, "rareearths", "Rare earths", ["280530", "2846"], "t", None, 1, None, ""],
    [S_IND, "potash", "Potash", ["310420", "310430", "310490"], "t", None, 1, "potassium chloride", "$/t"],
    [S_IND, "phosphate", "Phosphate (rock & fertilizer)", ["2510", "3103"], "t", None, 1, "phosphate rock", "$/t"],
    [S_IND, "sulphur", "Sulphur", ["2503"], "t", None, 1, None, ""],
    [S_IND, "cement", "Cement", ["2523"], "t", None, 1, None, ""],
    [S_IND, "salt", "Salt", ["2501"], "t", None, 1, None, ""],
    [S_IND, "diamonds", "Diamonds", ["7102"], "ct", None, 1, None, ""],
    [S_ENER, "coal", "Coal & coke", ["2701", "2704"], "t", None, 1, "coal, australian", "$/t"],
    [S_ENER, "uranium", "Uranium (also a critical mineral)", ["261210", "284410"], "t", None, 1, None, ""],
]
CODES = sorted({h for c in C for h in c[3]})


def r(x, n=1):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def vol_of(unit, kg, qty, qunit):
    if unit == "oz":
        return kg * OZ_KG if kg else None
    if unit == "ct":
        return qty if qty and str(qunit or "").lower() in ("carat", "ct", "carats") else None
    return kg / 1000 if kg else None


# ------------------------------------------------------------------ UN Comtrade (preview API: one period per call, <=500 rows)
def ct_get(S, freq, period, codes, partner="0"):
    q = {"reporterCode": "124", "flowCode": "X", "period": period, "cmdCode": ",".join(codes), "includeDesc": "false"}
    if partner is not None:
        q["partnerCode"] = partner
    for k in range(5):
        try:
            res = S.get(CT.format(f=freq), params=q, timeout=90)
            if res.status_code == 429:
                time.sleep(15 * (k + 1)); continue
            res.raise_for_status()
            rows = res.json().get("data") or []
            time.sleep(2.5)
            return [x for x in rows if x.get("flowCode") == "X" and str(x.get("partner2Code", 0)) == "0"
                    and x.get("customsCode") in (None, "C00") and x.get("motCode") in (None, 0)]
        except Exception as e:
            print(f"  comtrade {freq} {period} retry {k + 1}: {str(e)[:140]}")
            time.sleep(6 * (k + 1))
    return []


def trade_block(S):
    old = {}
    try:
        old = json.load(open(CACHE))
    except Exception:
        pass
    if old.get("at") and time.time() - old["at"] < 6 * 86400 and "--force-trade" not in sys.argv and old.get("v") == 2:
        return old
    now = datetime.now(timezone.utc)
    T = {"v": 2, "at": time.time(), "fetched": now.isoformat(timespec="seconds"), "src": "UN Comtrade — reporter Canada (Statistics Canada customs-based trade)",
         "annual": {}, "monthly": {}, "dest": {}, "total": {}}
    half = len(CODES) // 2 + 1
    for y in range(now.year - 6, now.year):
        rows = ct_get(S, "A", str(y), CODES[:half]) + ct_get(S, "A", str(y), CODES[half:])
        for x in rows:
            T["annual"].setdefault(str(x["cmdCode"]), {})[str(y)] = [x.get("primaryValue"), x.get("netWgt"), x.get("qty"), x.get("qtyUnitAbbr")]
        tot = ct_get(S, "A", str(y), ["TOTAL"])
        if tot:
            T["total"][str(y)] = tot[0].get("primaryValue")
    ym = now.strftime("%Y%m")
    for y in (now.year - 1, now.year):
        for m in range(1, 13):
            p = f"{y}{m:02d}"
            if p > ym:
                break
            rows = ct_get(S, "M", p, CODES[:half]) + ct_get(S, "M", p, CODES[half:])
            for x in rows:
                T["monthly"].setdefault(str(x["cmdCode"]), {})[p] = [x.get("primaryValue"), x.get("netWgt"), x.get("qty"), x.get("qtyUnitAbbr")]
    yrs = sorted(T["total"]) or sorted({p for v in T["annual"].values() for p in v})
    if yrs:
        last = yrs[-1]
        for i in range(0, len(CODES), 6):
            for x in ct_get(S, "A", last, CODES[i:i + 6], partner=None):
                pc = str(x.get("partnerCode"))
                if pc == "0":
                    continue
                T["dest"].setdefault(str(x["cmdCode"]), {})[pc] = [x.get("primaryValue"), x.get("partnerISO") or x.get("partnerDesc")]
        T["dest_year"] = last
    if not T["annual"]:
        print("! Comtrade returned nothing; keeping the cached trade data")
        if old:
            return old
        raise SystemExit("no trade data")
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(T, open(CACHE, "w"), separators=(",", ":"))
    return T


# ------------------------------------------------------------------ prices + FX
def pinksheet(S):
    import openpyxl
    html = ""
    try:
        html = INT.get(S, INT.WB_PAGE, tries=2).text
    except Exception:
        pass
    want = {c[1]: c[7] for c in C if c[7]}
    for u in INT.find_links(html, r"CMO-Historical-Data-Monthly\.xlsx", INT.WB_PAGE)[:1] + INT.WB_XLSX_FALLBACK:
        try:
            wb = openpyxl.load_workbook(io.BytesIO(INT.get(S, u, tries=2, timeout=120).content), read_only=True, data_only=True)
            sh = next(wb[n] for n in wb.sheetnames if n.strip().lower() == "monthly prices")
            rows = [list(x) for x in sh.iter_rows(values_only=True)]
            hi = next(i for i, x in enumerate(rows[:20]) if any(str(c or "").strip().lower() == "gold" for c in x))
            hdr = [str(c or "").strip().lower() for c in rows[hi]]
            out = {}
            for k, h in want.items():
                j = next((j for j, x in enumerate(hdr) if x == h), None)
                if j is None:
                    j = next((j for j, x in enumerate(hdr) if x.startswith(h)), None)
                if j is None:
                    print(f"  pink sheet: no column for {h}")
                    continue
                ser = {}
                for x in rows[hi + 1:]:
                    mk = INT.month_key(x[0] if x else None)
                    v = INT.num(x[j]) if mk and j < len(x) else None
                    if mk and v is not None:
                        ser[mk] = v
                out[k] = dict(sorted(ser.items())[-84:])
            return {"url": u, "series": out}
        except Exception as e:
            print(f"  pink sheet {u[-50:]}: {str(e)[:120]}")
    return {"url": None, "series": {}}


def yahoo_daily():
    syms = [c[5] for c in C if c[5]]
    d = UDC.yf().download(syms, period="2y", interval="1d", group_by="ticker", auto_adjust=False, progress=False, threads=True)
    out = {}
    for c in C:
        if not c[5]:
            continue
        try:
            s = d[c[5]]["Close"].dropna()
            out[c[1]] = [(x.strftime("%Y-%m-%d"), float(v) * c[6]) for x, v in s.items()]
        except Exception:
            pass
    return out


def boc(S):
    st = (datetime.now(timezone.utc) - timedelta(days=365 * 7)).strftime("%Y-%m-%d")
    j = INT.get(S, f"https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date={st}", tries=3, timeout=90).json()
    return [(o["d"], float(o["FXUSDCAD"]["v"])) for o in j.get("observations", []) if o.get("FXUSDCAD", {}).get("v")]


def corr_beta(x, y):
    n = len(x)
    if n < 60:
        return None, None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y); sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    return (round(sxy / math.sqrt(sxx * syy), 2) if sxx and syy else None), (round(sxy / sxx, 3) if sxx else None)


ISO = {"USA": "United States", "GBR": "United Kingdom", "CHN": "China", "JPN": "Japan", "NLD": "Netherlands", "KOR": "South Korea", "DEU": "Germany",
       "IND": "India", "CHE": "Switzerland", "HKG": "Hong Kong", "BEL": "Belgium", "NOR": "Norway", "MEX": "Mexico", "FRA": "France", "ITA": "Italy",
       "BRA": "Brazil", "AUS": "Australia", "TWN": "Taiwan", "S19": "Taiwan", "ESP": "Spain", "FIN": "Finland", "SWE": "Sweden", "ARE": "UAE",
       "SGP": "Singapore", "TUR": "Türkiye", "IDN": "Indonesia", "MYS": "Malaysia", "THA": "Thailand", "VNM": "Viet Nam", "PHL": "Philippines",
       "BGD": "Bangladesh", "PAK": "Pakistan", "SAU": "Saudi Arabia", "ISR": "Israel", "POL": "Poland", "CHL": "Chile", "PER": "Peru", "COL": "Colombia",
       "ZAF": "South Africa", "MAR": "Morocco", "EGY": "Egypt", "NZL": "New Zealand", "IRL": "Ireland", "AUT": "Austria", "DNK": "Denmark", "RUS": "Russia"}


def main():
    S = INT.http()
    T = trade_block(S)
    P = pinksheet(S)
    try:
        Y = yahoo_daily()
    except Exception as e:
        print(f"! Yahoo prices unavailable: {e}"); Y = {}
    FX = boc(S)
    now = datetime.now(timezone.utc)
    base = str(now.year - 1)
    yrs_all = sorted(T["total"]) or sorted({p for v in T["annual"].values() for p in v})
    years = [y for y in yrs_all if y <= base][-5:]
    fxa, fxm = {}, {}
    for d, v in FX:
        fxa.setdefault(d[:4], []).append(v); fxm.setdefault(d[:4] + d[5:7], []).append(v)
    fxa = {k: sum(v) / len(v) for k, v in fxa.items()}
    fxm = {k: sum(v) / len(v) for k, v in fxm.items()}
    usdcad = FX[-1][1] if FX else None
    cad = lambda usd, rate: usd * rate if usd is not None and rate else None

    out, idx_w = [], {}
    for seg, cid, name, codes, unit, ysym, yk, wbh, punit in C:
        hist = []
        for y in years:
            v = w = 0.0; have = False; vol_ok = True
            for h in codes:
                a = (T["annual"].get(h) or {}).get(y)
                if a and a[0] is not None:
                    v += a[0]; have = True
                    vv = vol_of(unit, a[1], a[2], a[3])
                    if vv is None:
                        vol_ok = False
                    else:
                        w += vv
            hist.append({"y": y, "usd_m": r(v / 1e6) if have else None, "cad_m": r(cad(v, fxa.get(y)) / 1e6) if have and fxa.get(y) else None,
                         "volume": r(w, 0) if have and vol_ok and w else None})
        mon = {}
        for h in codes:
            for p, a in (T["monthly"].get(h) or {}).items():
                if a and a[0] is not None:
                    mon[p] = mon.get(p, 0) + a[0]
        monthly = [{"p": p, "usd_m": r(v / 1e6), "cad_m": r(cad(v, fxm.get(p)) / 1e6) if fxm.get(p) else None} for p, v in sorted(mon.items())]
        cy = str(now.year)
        ytd = [m for m in monthly if m["p"].startswith(cy)]
        prev = {m["p"][4:]: m for m in monthly if m["p"].startswith(base)}
        ytd_cad = sum(m["cad_m"] or 0 for m in ytd) if ytd else None
        same = [prev.get(m["p"][4:]) for m in ytd]
        ytd_prev = sum(m["cad_m"] or 0 for m in same) if ytd and all(same) else None
        # destinations (latest full year)
        dd = {}
        for h in codes:
            for pc, (v, iso) in (T["dest"].get(h) or {}).items():
                if v:
                    k = iso or pc
                    dd[k] = dd.get(k, 0) + v
        dtot = sum(dd.values()) or 0
        dest = [{"c": ISO.get(k, k), "iso": k, "usd_m": r(v / 1e6), "share": r(v / dtot * 100) if dtot else None}
                for k, v in sorted(dd.items(), key=lambda z: -z[1])[:8]]
        # prices
        ws = P["series"].get(cid, {})
        live = Y.get(cid) or []
        bm = [v for k, v in ws.items() if k.startswith(base)]
        if len(bm) == 12:
            avg_base, avg_src = sum(bm) / 12, "World Bank Pink Sheet, 2025 monthly average"
        else:
            bd = [v for d, v in live if d.startswith(base)]
            avg_base, avg_src = (sum(bd) / len(bd), "futures daily closes, 2025 average") if len(bd) > 200 else (None, None)
        if live:
            cur, cur_d, cur_src, kind = live[-1][1], live[-1][0], "COMEX/NYMEX front-month futures (Yahoo, delayed)", "daily"
        elif ws:
            k = max(ws); cur, cur_d, cur_src, kind = ws[k], k, "World Bank Pink Sheet, latest monthly average", "monthly"
        else:
            cur = cur_d = cur_src = kind = None
        ratio = cur / avg_base if cur and avg_base else None
        chg = {}
        if len(live) > 25:
            for lab, n in (("1d", 1), ("1w", 5), ("1m", 21)):
                chg[lab] = r((live[-1][1] / live[-1 - n][1] - 1) * 100, 2)
            b = next((v for d, v in reversed(live) if d < f"{now.year}-01-01"), None)
            chg["ytd"] = r((live[-1][1] / b - 1) * 100, 2) if b else None
        hb = next((h for h in hist if h["y"] == base), None)
        vb, cb = (hb["usd_m"], hb["cad_m"]) if hb else (None, None)
        vols = [h["volume"] for h in hist if h["volume"]]
        avgvol = sum(vols) / len(vols) if vols else None
        est = None
        if ratio and vb:
            vr = (avgvol / hb["volume"]) if avgvol and hb and hb["volume"] else 1.0
            imp = vb * vr * ratio
            est = {"implied_usd_m": r(imp), "erosion_usd_m": r(imp - vb), "price_effect_usd_m": r(vb * (ratio - 1)), "volume_effect_usd_m": r(vb * (vr - 1) * ratio),
                   "erosion_cad_m": r((imp - vb) * usdcad) if usdcad else None, "volume_basis": "5-yr average" if vr != 1.0 else "2025 volume (no weight on file)"}
        yoy = None
        if len(hist) >= 2 and hist[-1]["cad_m"] and hist[-2]["cad_m"]:
            yoy = {"from": hist[-2]["y"], "to": hist[-1]["y"], "chg_cad_m": r(hist[-1]["cad_m"] - hist[-2]["cad_m"]), "pct": r((hist[-1]["cad_m"] / hist[-2]["cad_m"] - 1) * 100)}
        e = {"seg": seg, "id": cid, "name": name, "hs": codes, "vol_unit": unit, "history": hist, "avg_volume_5y": r(avgvol, 0),
             "monthly": monthly[-24:], "ytd": {"year": cy, "months": len(ytd), "through": ytd[-1]["p"] if ytd else None, "cad_m": r(ytd_cad) if ytd else None,
                                              "prior_cad_m": r(ytd_prev) if ytd_prev else None, "pct": r((ytd_cad / ytd_prev - 1) * 100) if ytd_prev else None},
             "yoy": yoy, "dest": dest, "dest_year": T.get("dest_year"),
             "price": None if cur is None else {"current": r(cur, 2), "date": cur_d, "kind": kind, "source": cur_src, "unit": punit, "avg_base": r(avg_base, 2),
                                                "avg_src": avg_src, "vs_base_pct": r((ratio - 1) * 100, 2) if ratio else None, "chg": chg,
                                                "daily": [{"d": d, "p": r(v, 2)} for d, v in live[-260:]], "monthly": [{"m": k, "p": r(v, 2)} for k, v in sorted(ws.items())[-60:]]},
             "est": est}
        out.append(e)
        if live and vb:
            idx_w[cid] = vb

    # segments
    segs = []
    for sid, sname in SEGMENTS:
        L = [e for e in out if e["seg"] == sid]
        h = []
        for i, y in enumerate(years):
            vals = [e["history"][i]["cad_m"] for e in L if e["history"][i]["cad_m"] is not None]
            h.append({"y": y, "cad_m": r(sum(vals)) if vals else None})
        dd = {}
        for e in L:
            for d in e["dest"]:
                dd[d["c"]] = dd.get(d["c"], 0) + (d["usd_m"] or 0)
        tot = sum(dd.values()) or 0
        segs.append({"id": sid, "name": sname, "commodities": [e["id"] for e in L], "history": h,
                     "ytd_cad_m": r(sum(e["ytd"]["cad_m"] or 0 for e in L)) if any(e["ytd"]["cad_m"] for e in L) else None,
                     "ytd_prior_cad_m": r(sum(e["ytd"]["prior_cad_m"] or 0 for e in L)) if all(e["ytd"]["prior_cad_m"] for e in L if e["ytd"]["cad_m"]) and any(e["ytd"]["cad_m"] for e in L) else None,
                     "dest": [{"c": k, "usd_m": r(v), "share": r(v / tot * 100) if tot else None} for k, v in sorted(dd.items(), key=lambda z: -z[1])[:6]]})

    # CAD link: export-weighted daily metals index vs BoC USD/CAD
    fxd = dict(FX); W = sum(idx_w.values()) or 1
    dates = sorted(set.intersection(*[set(d for d, _ in Y[k]) for k in idx_w])) if idx_w else []
    dates = [d for d in dates if d in fxd][-253:]
    px = {k: dict(Y[k]) for k in idx_w}
    idx = [sum(idx_w[k] / W * px[k][d] / px[k][dates[0]] for k in idx_w) * 100 for d in dates] if dates else []
    rx = [math.log(idx[i] / idx[i - 1]) for i in range(1, len(idx))]
    ry = [math.log(fxd[dates[i]] / fxd[dates[i - 1]]) for i in range(1, len(dates))]
    rho, beta = corr_beta(rx, ry)
    priced = [e for e in out if e["est"]]
    ero = sum(e["est"]["erosion_usd_m"] for e in priced)
    act = sum(next(h["usd_m"] for h in e["history"] if h["y"] == base) for e in priced)
    tot_base = T["total"].get(base)
    allm = [e for e in out]
    mineral_cad = {y: r(sum(e["history"][i]["cad_m"] or 0 for e in allm)) for i, y in enumerate(years)}
    body = {
        "updated_at": now.isoformat(timespec="seconds"), "base_year": base, "years": years,
        "segments": segs, "commodities": out,
        "totals": {"tracked_cad_m": mineral_cad, "canada_exports_cad_m": {y: r(T["total"][y] * fxa[y] / 1e6) for y in years if T["total"].get(y) and fxa.get(y)},
                   "nrcan_2025_reference": {"domestic_exports_cad_bn": 162.0, "total_incl_reexports_cad_bn": 167.6, "critical_cad_bn": 49.4,
                                            "src": "NRCan Mineral Trade information bulletin, May 2026 (Statistics Canada customs data)"}},
        "fx": {"usdcad": r(usdcad, 4), "date": FX[-1][0] if FX else None, "avg": {y: r(fxa[y], 4) for y in years if y in fxa},
               "series": [{"d": d, "v": r(v, 4)} for d, v in FX[-260:]]},
        "impact": {"priced": [e["id"] for e in priced], "base_usd_m": r(act), "erosion_usd_m": r(ero), "erosion_cad_m": r(ero * usdcad) if usdcad else None,
                   "share_of_exports_pct": r(ero / (tot_base / 1e6) * 100, 2) if tot_base else None,
                   "cad_link": {"corr": rho, "beta": beta, "days": len(rx), "weights": {k: r(v / W * 100) for k, v in idx_w.items()},
                                "index": [{"d": d, "v": r(v, 2)} for d, v in zip(dates, idx)]}},
        "sources": {"trade": T.get("src"), "trade_fetched": T.get("fetched"), "dest_year": T.get("dest_year"),
                    "prices_monthly": "World Bank Pink Sheet (CMO historical data)", "prices_monthly_url": P.get("url"),
                    "prices_daily": "COMEX/NYMEX futures via Yahoo (delayed)", "fx": "Bank of Canada Valet FXUSDCAD",
                    "groupings": "Natural Resources Canada — Mineral Trade information bulletin"},
    }
    if "--dry-run" in sys.argv:
        print(json.dumps(body["impact"] | {"cad_link": None})[:500])
        for e in out:
            print(e["id"], [h["cad_m"] for h in e["history"]], e["ytd"]["cad_m"], (e["price"] or {}).get("current"), (e["est"] or {}).get("erosion_usd_m"), [d["c"] for d in e["dest"][:3]])
        return
    json.dump(body, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote metals.json — {len(out)} commodities; priced erosion vs {base}: {r(ero)} US$m")
    for e in out:
        print(f"  {e['id']:<11} {[h['cad_m'] for h in e['history']]} ytd {e['ytd']['cad_m']} px {(e['price'] or {}).get('current')} ero {(e['est'] or {}).get('erosion_usd_m')}")


if __name__ == "__main__":
    main()
