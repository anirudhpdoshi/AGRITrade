#!/usr/bin/env python3
"""Canada metal exports & FX tracker (owner, Nov 21 2026) -> metals.json

Metals: gold, silver, copper, aluminium, nickel, zinc, iron ore, platinum.

Sources (official unless stated):
  Trade   UN Comtrade — Canada's exports to the world as reported by Statistics Canada (HS lines below): annual values (US$)
          and net weight, last 5 years; monthly for the latest months. Refreshed monthly (the job runs daily, Comtrade is cached).
  Prices  World Bank Pink Sheet (monthly averages, official) for 2025 averages and for nickel, zinc and iron ore;
          COMEX/NYMEX/COMEX futures via Yahoo (delayed, market data) for the daily price of gold, silver, copper, aluminium, platinum.
  FX      Bank of Canada Valet — USD/CAD daily indicative rate and 2025 average.

Method (every derived number is an ESTIMATE and is labelled so in the UI):
  price ratio          = current price / 2025 average price
  implied annual value = sum over HS lines of (5-year average volume x 2025 unit value x price ratio)
  erosion vs 2025      = implied annual value - 2025 actual export value  (split into price and volume effects)
  FX earnings impact   = sum of erosion across metals, in US$ and C$, and as a share of Canada's 2025 goods exports
  CAD link             = 1-year daily correlation and beta of USD/CAD on an export-weighted metals price index (historical, not a forecast)
Run: python scripts/metals.py [--dry-run]
"""
import io, json, math, os, re, sys, time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC
import intel as INT

ROOT = UDC.ROOT
OUT = os.path.join(ROOT, "metals.json")
CACHE = os.path.join(ROOT, "scripts", "data", "metals_trade.json")
OZ = 31.1034768  # grams per troy ounce

# metal: name, price unit, Pink Sheet header, Yahoo symbol + converter to the Pink Sheet unit, HS lines [code, label, volume unit, kg->unit]
METALS = [
    {"id": "gold", "name": "Gold", "unit": "$/oz", "wb": "gold", "yf": "GC=F", "yk": 1.0,
     "hs": [["7108", "Gold, unwrought / semi / powder", "koz", 1000 / OZ / 1000]]},
    {"id": "silver", "name": "Silver", "unit": "$/oz", "wb": "silver", "yf": "SI=F", "yk": 1.0,
     "hs": [["7106", "Silver, unwrought / semi / powder", "koz", 1000 / OZ / 1000]]},
    {"id": "copper", "name": "Copper", "unit": "$/t", "wb": "copper", "yf": "HG=F", "yk": 2204.62262,
     "hs": [["2603", "Copper ores & concentrates (gross weight)", "kt", 1e-6], ["7403", "Refined copper, unwrought", "kt", 1e-6]]},
    {"id": "aluminium", "name": "Aluminium", "unit": "$/t", "wb": "aluminum", "yf": "ALI=F", "yk": 1.0,
     "hs": [["7601", "Aluminium, unwrought", "kt", 1e-6]]},
    {"id": "nickel", "name": "Nickel", "unit": "$/t", "wb": "nickel", "yf": None,
     "hs": [["2604", "Nickel ores & concentrates (gross weight)", "kt", 1e-6], ["7501", "Nickel mattes & intermediates", "kt", 1e-6], ["7502", "Nickel, unwrought", "kt", 1e-6]]},
    {"id": "zinc", "name": "Zinc", "unit": "$/t", "wb": "zinc", "yf": None,
     "hs": [["2608", "Zinc ores & concentrates (gross weight)", "kt", 1e-6], ["7901", "Zinc, unwrought", "kt", 1e-6]]},
    {"id": "ironore", "name": "Iron ore", "unit": "$/dmt", "wb": "iron ore", "yf": None,
     "hs": [["2601", "Iron ores & concentrates", "Mt", 1e-9]]},
    {"id": "platinum", "name": "Platinum", "unit": "$/oz", "wb": "platinum", "yf": "PL=F", "yk": 1.0,
     "hs": [["711011", "Platinum, unwrought / powder", "koz", 1000 / OZ / 1000], ["711019", "Platinum, semi-manufactured", "koz", 1000 / OZ / 1000]]},
]
CT = "https://comtradeapi.un.org/public/v1/preview/C/{f}/HS"


def r(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


# ------------------------------------------------------------------ trade (UN Comtrade, Canada = 124, world = 0, exports)
def comtrade(S, freq, periods, codes):
    out = []
    for i in range(0, len(periods), 12):
        q = {"reporterCode": "124", "partnerCode": "0", "flowCode": "X", "period": ",".join(periods[i:i + 12]), "cmdCode": ",".join(codes),
             "includeDesc": "false"}
        for k in range(4):
            try:
                j = INT.get(S, CT.format(f=freq), params=q, tries=2, timeout=90).json()
                out += j.get("data") or []
                break
            except Exception as e:
                print(f"  comtrade {freq} {q['period'][:20]}… retry {k + 1}: {str(e)[:120]}")
                time.sleep(8 * (k + 1))
        time.sleep(3)
    return out


def trade_block(S):
    C = {}
    try:
        C = json.load(open(CACHE))
    except Exception:
        pass
    if C.get("at") and time.time() - C["at"] < 6 * 86400 and "--force-trade" not in sys.argv:
        return C
    codes = sorted({h[0] for m in METALS for h in m["hs"]}) + ["TOTAL"]
    yr = datetime.now(timezone.utc).year
    years = [str(y) for y in range(yr - 6, yr)]
    A = comtrade(S, "A", years, codes)
    mons = [f"{y}{m:02d}" for y in (yr - 1, yr) for m in range(1, 13) if f"{y}{m:02d}" <= datetime.now(timezone.utc).strftime("%Y%m")]
    M = comtrade(S, "M", mons, codes)

    def pack(rows):
        d = {}
        for x in rows:
            if str(x.get("partnerCode")) != "0" or x.get("flowCode") != "X":
                continue
            c, p = str(x.get("cmdCode")), str(x.get("period"))
            if x.get("customsCode") not in (None, "C00") or x.get("motCode") not in (None, 0) or str(x.get("partner2Code", 0)) != "0":
                continue
            v, w = x.get("primaryValue"), x.get("netWgt")
            d.setdefault(c, {})[p] = [v, w if w not in (None, 0) else None]
        return d

    newC = {"at": time.time(), "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"), "src": "UN Comtrade (reporter: Canada / Statistics Canada)",
            "annual": pack(A), "monthly": pack(M)}
    if not newC["annual"]:
        print("! Comtrade returned nothing; keeping the cached trade data")
        if C:
            return C
        raise SystemExit("no trade data")
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(newC, open(CACHE, "w"), separators=(",", ":"))
    return newC


# ------------------------------------------------------------------ prices
def pinksheet(S):
    import openpyxl
    html = ""
    try:
        html = INT.get(S, INT.WB_PAGE, tries=2).text
    except Exception:
        pass
    links = INT.find_links(html, r"CMO-Historical-Data-Monthly\.xlsx", INT.WB_PAGE)
    for u in links[:1] + INT.WB_XLSX_FALLBACK:
        try:
            wb = openpyxl.load_workbook(io.BytesIO(INT.get(S, u, tries=2, timeout=120).content), read_only=True, data_only=True)
            sh = next(wb[n] for n in wb.sheetnames if n.strip().lower() == "monthly prices")
            rows = [list(x) for x in sh.iter_rows(values_only=True)]
            hi = next(i for i, x in enumerate(rows[:20]) if any(str(c or "").strip().lower() == "gold" for c in x))
            hdr = [str(c or "").strip().lower() for c in rows[hi]]
            out = {}
            for m in METALS:
                j = next((j for j, h in enumerate(hdr) if h == m["wb"]), None)
                if j is None:
                    j = next((j for j, h in enumerate(hdr) if h.startswith(m["wb"])), None)
                if j is None:
                    continue
                ser = {}
                for x in rows[hi + 1:]:
                    mk = INT.month_key(x[0] if x else None)
                    v = INT.num(x[j]) if mk and j < len(x) else None
                    if mk and v is not None:
                        ser[mk] = v
                out[m["id"]] = dict(sorted(ser.items())[-84:])
            return {"url": u, "series": out}
        except Exception as e:
            print(f"  pink sheet {u[-60:]}: {str(e)[:120]}")
    raise RuntimeError("Pink Sheet unavailable")


def yahoo_daily():
    syms = [m["yf"] for m in METALS if m.get("yf")]
    d = UDC.yf().download(syms, period="13mo", interval="1d", group_by="ticker", auto_adjust=False, progress=False, threads=True)
    out = {}
    for m in METALS:
        s = m.get("yf")
        if not s:
            continue
        try:
            c = d[s]["Close"].dropna()
            out[m["id"]] = [(x.strftime("%Y-%m-%d"), float(v) * m["yk"]) for x, v in c.items()]
        except Exception:
            pass
    return out


def boc_usdcad(S):
    j = INT.get(S, "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=" + (datetime.now(timezone.utc) - timedelta(days=800)).strftime("%Y-%m-%d"), tries=3).json()
    return [(o["d"], float(o["FXUSDCAD"]["v"])) for o in j.get("observations", []) if o.get("FXUSDCAD", {}).get("v")]


def corr_beta(x, y):
    n = len(x)
    if n < 60:
        return None, None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y); sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    return (round(sxy / math.sqrt(sxx * syy), 2) if sxx and syy else None), (round(sxy / sxx, 3) if sxx else None)


# ------------------------------------------------------------------ build
def main():
    S = INT.http()
    T = trade_block(S)
    P = pinksheet(S)
    Y = {}
    try:
        Y = yahoo_daily()
    except Exception as e:
        print(f"! Yahoo prices unavailable: {e}")
    FX = boc_usdcad(S)
    yr = datetime.now(timezone.utc).year
    base = str(yr - 1)                       # comparison year: 2025
    years_all = sorted({p for c in T["annual"].values() for p in c})
    years = [y for y in years_all if y <= base][-5:]
    fx_by_year = {}
    for d, v in FX:
        fx_by_year.setdefault(d[:4], []).append(v)
    fx_avg = {k: sum(v) / len(v) for k, v in fx_by_year.items()}
    usdcad = FX[-1][1] if FX else None

    tot = T["annual"].get("TOTAL", {})
    total_base = (tot.get(base) or [None])[0]
    metals, idx_w = [], {}
    for m in METALS:
        ws = P["series"].get(m["id"], {})
        base_months = [v for k, v in ws.items() if k.startswith(base)]
        avg_base = sum(base_months) / len(base_months) if len(base_months) == 12 else None
        live = (Y.get(m["id"]) or [])
        if live:
            cur, cur_d, cur_src, cur_kind = live[-1][1], live[-1][0], "COMEX/NYMEX futures, front month (Yahoo, delayed)", "daily"
        elif ws:
            k = max(ws)
            cur, cur_d, cur_src, cur_kind = ws[k], k, "World Bank Pink Sheet, monthly average", "monthly"
        else:
            cur = cur_d = cur_src = cur_kind = None
        ratio = cur / avg_base if cur and avg_base else None
        lines, hist = [], {y: {"value": 0.0, "have": False} for y in years}
        imp = act = pe = ve = 0.0
        ok = ratio is not None
        for code, lab, unit, k in m["hs"]:
            A = T["annual"].get(code, {})
            row = {"hs": code, "label": lab, "unit": unit, "years": {}}
            vols = []
            for y in years:
                v, w = (A.get(y) or [None, None])
                vol = w * k if w else None
                row["years"][y] = {"value_musd": r(v / 1e6, 1) if v is not None else None, "volume": r(vol, 1) if vol is not None else None}
                if v is not None:
                    hist[y]["value"] += v; hist[y]["have"] = True
                if vol:
                    vols.append(vol)
            vb, wb_ = (A.get(base) or [None, None])
            avgvol = sum(vols) / len(vols) if vols else None
            uv = vb / (wb_ * k) if vb and wb_ else None
            row.update({"avg_volume_5y": r(avgvol, 1), "unit_value_base": r(uv, 2), "base_value_musd": r(vb / 1e6, 1) if vb else None})
            if ok and vb and uv and avgvol:
                iv = avgvol * uv * ratio
                row["implied_musd"] = r(iv / 1e6, 1)
                imp += iv; act += vb; pe += vb * (ratio - 1); ve += (avgvol - wb_ * k) * uv * ratio
            elif ok and vb:                       # no weight on file for this line: price effect only
                imp += vb * ratio; act += vb; pe += vb * (ratio - 1)
            lines.append(row)
        # monthly year-to-date (latest months)
        mon = {}
        for code, _, _, _ in m["hs"]:
            for p, (v, w) in (T["monthly"].get(code) or {}).items():
                if v is not None:
                    mon[p] = mon.get(p, 0) + v
        ytd_y = str(yr)
        ytd = sorted((p, v) for p, v in mon.items() if p.startswith(ytd_y))
        prev = {p: v for p, v in mon.items() if p.startswith(str(yr - 1))}
        ytd_v = sum(v for _, v in ytd)
        ytd_prev = sum(prev.get(str(yr - 1) + p[4:], 0) for p, _ in ytd) if ytd and all(str(yr - 1) + p[4:] in prev for p, _ in ytd) else None
        # price history: Pink Sheet monthly (5y) + daily (13 months)
        ph_m = [{"m": k, "p": r(v, 2)} for k, v in sorted(ws.items())[-60:]]
        ph_d = [{"d": d, "p": r(v, 2)} for d, v in live[-260:]]
        chg = {}
        for lab, n in (("1d", 1), ("1w", 5), ("1m", 21), ("ytd", None)):
            if len(live) > 22:
                if lab == "ytd":
                    b = next((v for d, v in reversed(live) if d < f"{yr}-01-01"), None)
                else:
                    b = live[-1 - n][1]
                chg[lab] = r((cur / b - 1) * 100, 2) if b else None
        e = {"id": m["id"], "name": m["name"], "unit": m["unit"],
             "price": {"current": r(cur, 2), "date": cur_d, "kind": cur_kind, "source": cur_src, "avg_base": r(avg_base, 2), "base": base,
                       "vs_base_pct": r((ratio - 1) * 100, 2) if ratio else None, "chg": chg, "wb_latest": (max(ws), r(ws[max(ws)], 2)) if ws else None},
             "history": [{"y": y, "value_musd": r(hist[y]["value"] / 1e6, 1) if hist[y]["have"] else None} for y in years],
             "lines": lines,
             "base_value_musd": r(act / 1e6, 1) if act else None,
             "implied_musd": r(imp / 1e6, 1) if ok and imp else None,
             "erosion_musd": r((imp - act) / 1e6, 1) if ok and imp else None,
             "price_effect_musd": r(pe / 1e6, 1) if ok and imp else None,
             "volume_effect_musd": r(ve / 1e6, 1) if ok and imp else None,
             "ytd": {"year": ytd_y, "months": len(ytd), "through": ytd[-1][0] if ytd else None, "value_musd": r(ytd_v / 1e6, 1) if ytd else None,
                     "prior_same_months_musd": r(ytd_prev / 1e6, 1) if ytd_prev else None,
                     "yoy_pct": r((ytd_v / ytd_prev - 1) * 100, 1) if ytd_prev else None,
                     "monthly": [{"p": p, "value_musd": r(v / 1e6, 1)} for p, v in sorted(mon.items())[-24:]]},
             "price_daily": ph_d, "price_monthly": ph_m}
        metals.append(e)
        if live and act:
            idx_w[m["id"]] = act

    # export-weighted metals index (daily, metals with a daily price) vs USD/CAD (BoC) — 1 year of daily log changes
    fxd = dict(FX)
    W = sum(idx_w.values()) or 1
    dates = sorted(set.intersection(*[set(d for d, _ in Y[k]) for k in idx_w])) if idx_w else []
    dates = [d for d in dates if d in fxd][-253:]
    px = {k: dict(Y[k]) for k in idx_w}
    idx = [sum(idx_w[k] / W * px[k][d] / px[k][dates[0]] for k in idx_w) * 100 for d in dates] if dates else []
    rx = [math.log(idx[i] / idx[i - 1]) for i in range(1, len(idx))]
    ry = [math.log(fxd[dates[i]] / fxd[dates[i - 1]]) for i in range(1, len(dates))]
    rho, beta = corr_beta(rx, ry)
    tot_imp = sum(e["implied_musd"] or 0 for e in metals if e["implied_musd"] is not None)
    tot_act = sum(e["base_value_musd"] or 0 for e in metals if e["implied_musd"] is not None)
    tot_ero = round(tot_imp - tot_act, 1)
    body = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "base_year": base, "years": years,
        "sources": {"trade": T.get("src"), "trade_fetched": T.get("fetched"), "prices_monthly": "World Bank Pink Sheet (CMO historical data, monthly)",
                    "prices_monthly_url": P["url"], "prices_daily": "COMEX/NYMEX futures via Yahoo (delayed)", "fx": "Bank of Canada Valet FXUSDCAD"},
        "fx": {"usdcad": r(usdcad, 4), "date": FX[-1][0] if FX else None, "avg": {y: r(v, 4) for y, v in fx_avg.items() if y in years},
               "series": [{"d": d, "v": r(v, 4)} for d, v in FX[-260:]]},
        "canada_total_exports_musd": {y: r((tot.get(y) or [None])[0] / 1e6, 0) if (tot.get(y) or [None])[0] else None for y in years},
        "metals": metals,
        "summary": {"base_value_musd": round(tot_act, 1), "implied_musd": round(tot_imp, 1), "erosion_musd": tot_ero,
                    "erosion_mcad": r(tot_ero * usdcad, 1) if usdcad else None,
                    "share_of_exports_pct": r(tot_ero / (total_base / 1e6) * 100, 2) if total_base else None,
                    "metals_share_of_exports_pct": r(tot_act / (total_base / 1e6) * 100, 2) if total_base else None,
                    "cad_link": {"corr": rho, "beta": beta, "days": len(rx), "index": "export-weighted (2025 values) daily index of " + ", ".join(m["name"] for m in METALS if m["id"] in idx_w),
                                 "index_series": [{"d": d, "v": r(v, 2)} for d, v in zip(dates, idx)]}},
    }
    if "--dry-run" in sys.argv:
        print(json.dumps(body["summary"] | {"fx": body["fx"]["usdcad"]}, default=str)[:600])
        for e in metals:
            print(e["id"], e["price"]["current"], e["price"]["avg_base"], e["price"]["vs_base_pct"], [h["value_musd"] for h in e["history"]], e["implied_musd"], e["erosion_musd"])
        return
    json.dump(body, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote metals.json — erosion vs {base}: {tot_ero} US$m")


if __name__ == "__main__":
    main()
