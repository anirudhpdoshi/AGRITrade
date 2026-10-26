"""Global grains: World (USDA PSD) and Brazil (CONAB + Comex Stat + BCB) fundamentals for corn, soybeans and wheat.

Writes gg.json to the orphan branch `ggrain` (the page reads it only when "Brazil" or "World" is picked in a grain
tab's Fundamentals switch). Separate from update_data.py / world.py: if this job fails nothing else is affected.

Rules: one source per comparison (USDA PSD for every country, so % shares add up); CONAB shown next to USDA for Brazil,
never blended; every block carries source, release/publication date, crop year and status (estimate / forecast /
observed). Revisions are computed only against a snapshot we stored from an earlier release - never invented.
Keys: FAS_API_KEY (header only, never printed). Everything else is keyless public data.
"""
import datetime as dt
import io
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WT = "/tmp/ggrain-worktree"
PSD = "https://api.fas.usda.gov/api/psd"
CODES = {"corn": "0440000", "soybeans": "2222000", "wheat": "0410000"}
UA = {"User-Agent": "Mozilla/5.0 (grain desk; contact via repository)"}
CONAB_IDX = "https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/safra-de-graos/boletim-da-safra-de-graos"
COMEX = "https://api-comexstat.mdic.gov.br"
NCM = {"corn": "10059010", "soybeans": "12019000", "wheat": "10019900"}
CONAB_SHEETS = {"corn": {"total": "Milho Total", "1a": "Milho 1a", "2a": "Milho 2a", "3a": "Milho 3a"},
                "soybeans": {"total": "Soja"}, "wheat": {"total": "Trigo"}}
EU27 = ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA",
        "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE"]
# PSD country names that do not match ISO English names
NAME_FIX = {"burma": "MMR", "korea, south": "KOR", "korea, north": "PRK", "russia": "RUS", "iran": "IRN", "syria": "SYR",
            "venezuela": "VEN", "bolivia": "BOL", "tanzania": "TZA", "vietnam": "VNM", "laos": "LAO", "taiwan": "TWN",
            "moldova": "MDA", "congo (kinshasa)": "COD", "congo (brazzaville)": "COG", "cote d'ivoire": "CIV",
            "turkey": "TUR", "turkiye": "TUR", "czechia": "CZE", "macedonia": "MKD", "north macedonia": "MKD",
            "united kingdom": "GBR", "united states": "USA", "china": "CHN", "hong kong": "HKG", "eswatini": "SWZ",
            "swaziland": "SWZ", "gambia, the": "GMB", "bahamas, the": "BHS", "cabo verde": "CPV", "kyrgyzstan": "KGZ",
            "bosnia and herzegovina": "BIH", "serbia": "SRB", "montenegro": "MNE", "kosovo": "XKX", "libya": "LBY",
            "palestine": "PSE", "brunei": "BRN", "timor-leste": "TLS", "micronesia": "FSM", "cape verde": "CPV"}
KEY = os.environ.get("FAS_API_KEY", "").strip()
KEY_A3 = {"USA", "CAN", "BRA", "ARG", "UKR", "RUS", "EU", "CHN", "AUS", "IND", "KAZ", "PRY"}   # full yearly rows kept for these


def red(s):
    s = str(s)
    return s.replace(KEY, "***") if KEY else s


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


# ------------------------------------------------------------------ pure helpers (unit-tested)
def share(part, total):
    return None if part is None or not total else round(100.0 * part / total, 2)


def pct_change(cur, prev):
    return None if cur is None or prev in (None, 0) else round(100.0 * (cur - prev) / prev, 2)


def stocks_to_use(end, use):
    return None if end is None or not use else round(100.0 * end / use, 2)


def revision(cur, prev_snap):
    """Revision vs the value stored from an earlier release; None when no earlier snapshot exists (never invented)."""
    if cur is None or prev_snap is None:
        return None
    return {"prev": prev_snap, "d": round(cur - prev_snap, 1), "pct": pct_change(cur, prev_snap)}


def apply_revisions(blk, prev_values, prev_release):
    """Fill rev_prod / rev_exp from the snapshot stored at an earlier USDA release (same market year)."""
    blk["rev_vs"] = prev_release
    blk["rev_note"] = None if prev_release else ("revisions start with the next USDA release (first snapshot stored for " + blk["release"] + ")")
    for c in blk["countries"]:
        p = (prev_values or {}).get(c["code"]) or {}
        c["rev_prod"] = revision(c["cur"].get("prod"), p.get("prod"))
        c["rev_exp"] = revision(c["cur"].get("exp"), p.get("exp"))
    if prev_values:
        blk["world"]["rev_prod"] = revision(blk["world"]["prod"], sum((v.get("prod") or 0) for v in prev_values.values()))
    return blk


def season_label(my):
    """PSD market year 2026 -> '2026/27'."""
    return f"{my}/{str(my + 1)[-2:]}"


def num(v):
    try:
        if v is None or v == "":
            return None
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def parse_conab_sheet(rows):
    """CONAB 'por produto' sheet -> {'seasons': [a, b], 'BRASIL': {...}, 'states': {...}}.
    Layout: header row starts 'REGIÃO/UF'; next row holds the two seasons; then rows of
    [name, area a, area b, var, yield c, yield d, var, prod e, prod f, var] (area 1000 ha, yield kg/ha, prod 1000 t)."""
    out = {"seasons": None, "rows": {}}
    hdr = None
    for i, r in enumerate(rows):
        if r and str(r[0] or "").strip().upper().startswith("REGI"):
            hdr = i
            break
    if hdr is None:
        raise ValueError("CONAB sheet: header row not found")
    seas = [str(x or "").replace("Safra", "").strip() for x in rows[hdr + 1][1:3]]
    out["seasons"] = seas
    for r in rows[hdr + 3:]:
        name = str(r[0] or "").strip()
        if not name or len(r) < 10:
            continue
        vals = [num(x) for x in r[1:10]]
        if vals[0] is None and vals[6] is None:
            continue
        out["rows"][name.upper()] = {"area": [vals[0], vals[1]], "yield": [vals[3], vals[4]], "prod": [vals[6], vals[7]]}
    if "BRASIL" not in out["rows"]:
        raise ValueError("CONAB sheet: BRASIL row not found")
    return out


def parse_conab_supply(rows, product):
    """'Suprimento' sheet (corn / wheat blocks): rows [PRODUTO, SAFRA, survey, beg, prod, imp, supply, cons, exp, demand]."""
    out, inblk = [], False
    for r in rows:
        p = str(r[0] or "").strip().upper()
        if p:
            inblk = p.startswith(product.upper())
            if not inblk:
                if out:
                    break
                continue
        if not inblk:
            continue
        seas = str(r[1] or "").strip()
        survey = str(r[2] or "").strip()
        v = [num(x) for x in r[3:10]]
        if v[1] is None:
            continue
        if not seas and out:
            seas = out[-1]["season"]
        out.append({"season": seas.replace("*", "").strip(), "survey": survey, "beg": v[0], "prod": v[1], "imp": v[2],
                    "supply": v[3], "cons": v[4], "exp": v[5], "demand": v[6],
                    "end": round(v[3] - v[6], 1) if v[3] is not None and v[6] is not None else None})
    return out


def parse_conab_soy_supply(rows):
    """'Suprimento - Soja' sheet: label rows '1.x. ...' for soybean grain, seasons across columns."""
    seasons, out = None, {}
    for r in rows:
        if r and str(r[0] or "").strip() == "" and any(re.match(r"^\d{4}/\d{2}$", str(x or "").strip()) for x in r[1:]):
            seasons = [str(x or "").strip() for x in r[1:]]
            continue
        lab = str(r[0] or "").strip()
        if seasons and re.match(r"^1\.\d+\.", lab):
            key = re.sub(r"^1\.\d+\.\s*", "", lab).lower()
            out[key] = {s: num(v) for s, v in zip(seasons, r[1:]) if s}
        if lab.startswith("2."):
            break
    return out


# ------------------------------------------------------------------ fetchers
def http():
    import requests
    s = requests.Session()
    s.headers.update(UA)
    return s


def get(S, url, tries=3, **kw):
    kw.setdefault("timeout", 60)
    last = None
    for i in range(tries):
        try:
            r = S.get(url, **kw)
            if r.status_code == 429:
                time.sleep(10 * (i + 1))
                continue
            r.raise_for_status()
            return r
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(red(last))


def iso_map():
    names = json.load(open(os.path.join(ROOT, "scripts", "data", "iso_names.json")))
    def a3(name):
        n = (name or "").strip().lower()
        return NAME_FIX.get(n) or names.get(n)
    return a3


def psd_block(S, crop):
    H = {"X-Api-Key": KEY}
    ref = {}
    A = {str(a["attributeId"]): (a.get("attributeName") or "").strip().lower() for a in get(S, f"{PSD}/commodityAttributes", headers=H).json()}
    C = {c.get("countryCode"): (c.get("countryName") or "").strip() for c in get(S, f"{PSD}/countries", headers=H).json()}
    a3 = iso_map()
    code = CODES[crop]
    y0 = now_utc().year
    years = {}
    for y in range(y0 + 1, y0 - 6, -1):
        rows = get(S, f"{PSD}/commodity/{code}/country/all/year/{y}", headers=H).json()
        if rows:
            years[y] = rows
        if len(years) >= 6:
            break
    cur = max(years)
    def table(rows):
        t = {}
        for x in rows:
            n = A.get(str(x.get("attributeId")), "")
            cc = x.get("countryCode")
            v = float(x.get("value") or 0)
            d = t.setdefault(cc, {})
            key = {"production": "prod", "exports": "exp", "imports": "imp", "domestic consumption": "dom",
                   "ending stocks": "end", "area harvested": "area", "yield": "yield", "beginning stocks": "beg",
                   "crush": "crush", "feed dom. consumption": "feed"}.get(n)
            if key:
                d[key] = v
            d["_m"] = max(d.get("_m", 0), int(x.get("month") or 0))
        return t
    T = {y: table(r) for y, r in years.items()}
    cur_t, prev_t = T[cur], T.get(cur - 1, {})
    release_month = max(v.get("_m", 0) for v in cur_t.values())
    wp = sum(v.get("prod", 0) for v in cur_t.values())
    we = sum(v.get("exp", 0) for v in cur_t.values())
    wpp = sum(v.get("prod", 0) for v in prev_t.values())
    wep = sum(v.get("exp", 0) for v in prev_t.values())
    wend = sum(v.get("end", 0) for v in cur_t.values())
    wuse = sum(v.get("dom", 0) for v in cur_t.values())
    snap = {}
    countries = []
    for cc, v in cur_t.items():
        p = prev_t.get(cc, {})
        if not (v.get("prod") or v.get("exp") or v.get("imp")):
            continue
        name = C.get(cc, cc)
        iso = "EU" if name.lower() == "european union" else a3(name)
        snap[cc] = {"prod": v.get("prod"), "exp": v.get("exp")}
        countries.append({
            "code": cc, "name": name, "a3": iso, "members": EU27 if iso == "EU" else None,
            "cur": {k: v.get(k) for k in ("prod", "exp", "imp", "dom", "end", "area", "yield", "beg", "crush", "feed")},
            "prev": {k: p.get(k) for k in ("prod", "exp", "imp", "dom", "end", "area", "yield")},
            "share_prod": share(v.get("prod"), wp), "share_exp": share(v.get("exp"), we),
            "yoy_prod": pct_change(v.get("prod"), p.get("prod")), "yoy_exp": pct_change(v.get("exp"), p.get("exp")),
            "stu": stocks_to_use(v.get("end"), (v.get("dom") or 0) + (v.get("exp") or 0)),
            "exp_of_prod": share(v.get("exp"), v.get("prod")),
            "hist": {season_label(y): T[y].get(cc, {}).get("prod") for y in sorted(T) if T[y].get(cc, {}).get("prod") is not None},
            "rev_prod": None, "rev_exp": None,
            "updated_month": v.get("_m"),
            "years": ({str(y): dict({k: T[y].get(cc, {}).get(k) for k in ("prod", "exp", "imp", "dom", "end", "area", "yield", "beg", "crush")},
                                    share_prod=share(T[y].get(cc, {}).get("prod"), sum(x.get("prod", 0) for x in T[y].values())),
                                    share_exp=share(T[y].get(cc, {}).get("exp"), sum(x.get("exp", 0) for x in T[y].values())))
                       for y in sorted(T) if T[y].get(cc)} if iso in KEY_A3 else None),
        })
    countries.sort(key=lambda c: -(c["cur"].get("prod") or 0))
    return {"source": "USDA FAS PSD (Production, Supply and Distribution)", "my": season_label(cur), "my_prev": season_label(cur - 1),
            "release": f"{y0 if release_month <= now_utc().month else y0 - 1}-{release_month:02d}", "status": "estimate",
            "units": "1,000 t (area 1,000 ha, yield t/ha)",
            "world": {"prod": wp, "exp": we, "prod_prev": wpp, "exp_prev": wep, "yoy_prod": pct_change(wp, wpp),
                      "yoy_exp": pct_change(we, wep), "end": wend, "stu": stocks_to_use(wend, wuse)},
            "countries": countries}, snap, cur


def conab_files(S):
    """Latest CONAB survey folder + its xlsx, and the previous survey's xlsx (for revisions)."""
    idx = get(S, CONAB_IDX).text
    folders = sorted(set(re.findall(r'href="(' + re.escape(CONAB_IDX) + r'/(\d+)o-levantamento-safra-(\d{4})-(\d{2}))[/"]', idx)))
    def key(f):
        return (int(f[2]), int(f[1]))
    folders = sorted({(f[0], f[1], f[2]) for f in folders}, key=key, reverse=True)
    found = []
    for url, n, yr in folders[:4]:
        page = get(S, url).text
        x = re.findall(r'href="([^"]+por_produto[^"]+\.xlsx)', page) or re.findall(r'href="([^"]+\.xlsx)', page)
        if x:
            found.append({"url": x[0], "survey": int(n), "season": f"{yr}/{int(yr[2:]) + 1:02d}", "folder": url})
        if len(found) >= 2:
            break
    if not found:
        raise RuntimeError("CONAB: no survey spreadsheet found")
    return found


def conab_block(S):
    import openpyxl
    files = conab_files(S)
    def load(u):
        wb = openpyxl.load_workbook(io.BytesIO(get(S, u).content), read_only=True, data_only=True)
        return {n: [list(r) for r in wb[n].iter_rows(values_only=True)] for n in wb.sheetnames
                if n in ("Suprimento", "Suprimento - Soja") or n in sum([list(v.values()) for v in CONAB_SHEETS.values()], [])}
    cur = load(files[0]["url"])
    prev = load(files[1]["url"]) if len(files) > 1 else None
    out = {"source": "CONAB — Acompanhamento da safra brasileira de grãos", "survey": f"{files[0]['survey']}º levantamento",
           "season_of_survey": files[0]["season"], "url": files[0]["folder"], "status": "forecast", "units": "1,000 t · 1,000 ha · kg/ha",
           "prev_survey": (f"{files[1]['survey']}º levantamento {files[1]['season']}" if len(files) > 1 else None), "crops": {}}
    for crop, sheets in CONAB_SHEETS.items():
        c = {}
        for part, sn in sheets.items():
            if sn not in cur:
                continue
            p = parse_conab_sheet(cur[sn])
            b = p["rows"]["BRASIL"]
            states = sorted(((k, v["prod"][1]) for k, v in p["rows"].items() if len(k) == 2 and v["prod"][1]), key=lambda t: -t[1])[:6]
            row = {"seasons": p["seasons"], "area": b["area"], "yield": b["yield"], "prod": b["prod"],
                   "yoy_prod": pct_change(b["prod"][1], b["prod"][0]), "top_states": states}
            if prev and sn in prev:
                pp = parse_conab_sheet(prev[sn])
                if pp["seasons"] and pp["seasons"][1] == p["seasons"][1]:
                    row["rev"] = revision(b["prod"][1], pp["rows"]["BRASIL"]["prod"][1])
                else:
                    row["rev"] = None
                    row["rev_note"] = "first estimate of the " + p["seasons"][1] + " season"
            c[part] = row
        if crop in ("corn", "wheat") and "Suprimento" in cur:
            c["supply"] = parse_conab_supply(cur["Suprimento"], "MILHO" if crop == "corn" else "TRIGO")[-4:]
        if crop == "soybeans" and "Suprimento - Soja" in cur:
            c["supply_soy"] = parse_conab_soy_supply(cur["Suprimento - Soja"])
        out["crops"][crop] = c
    return out


def comex_post(S, body, tries=8):
    """Comex Stat allows only a few requests per minute per IP (shared GitHub runners hit it often): back off and retry."""
    for i in range(tries):
        r = S.post(COMEX + "/general?language=en", json=body, timeout=120)
        if r.status_code == 429:
            time.sleep(20 + 10 * i)
            continue
        r.raise_for_status()
        d = r.json().get("data")
        return d.get("list") if isinstance(d, dict) else d
    raise RuntimeError("Comex Stat rate limit (429) after %d tries" % tries)


def comex_block(S):
    """Brazil exports by month and destination (observed customs data), this calendar year and last, 2 requests."""
    upd = get(S, COMEX + "/general/dates/updated").json()["data"]
    y, m = int(upd["year"]), int(upd["monthNumber"])
    out = {"source": "Comex Stat (MDIC) — Brazilian export statistics", "status": "observed", "data_updated": upd.get("updated"),
           "period": f"{y}-01..{y}-{m:02d}", "period_prev": f"{y - 1}-01..{y - 1}-{m:02d}", "crops": {}}
    inv = {v: k for k, v in NCM.items()}
    res = {k: {} for k in NCM}
    mon = {k: {} for k in NCM}
    for yy in (y, y - 1):
        time.sleep(12)
        lst = comex_post(S, {"flow": "export", "monthDetail": True, "period": {"from": f"{yy}-01", "to": f"{yy}-12" if yy < y else f"{yy}-{m:02d}"},
                             "filters": [{"filter": "ncm", "values": list(NCM.values())}], "details": ["ncm", "country"],
                             "metrics": ["metricFOB", "metricKG"]})
        for x in lst or []:
            code = str(x.get("coNcm") or x.get("ncm") or "")[:8]
            crop = inv.get(code) or next((c for c, n in NCM.items() if n in json.dumps(x)), None)
            if not crop:
                continue
            mn = int(str(x.get("monthNumber") or x.get("month") or "0")[-2:] or 0)
            kt, usd = float(x.get("metricKG") or 0) / 1e6, float(x.get("metricFOB") or 0)
            key = f"{yy}-{mn:02d}"
            mon[crop][key] = round(mon[crop].get(key, 0) + kt, 3)
            if mn and mn <= m:                                  # same months both years for the YTD comparison
                a = res[crop].setdefault(yy, {}).setdefault(x["country"], [0.0, 0.0])
                a[0] += kt; a[1] += usd
    for crop, r in res.items():
        cur, prv = r.get(y, {}), r.get(y - 1, {})
        tot = sum(v[0] for v in cur.values())
        totp = sum(v[0] for v in prv.values())
        usd = sum(v[1] for v in cur.values())
        top = sorted(cur.items(), key=lambda t: -t[1][0])[:8]
        out["crops"][crop] = {"ncm": NCM[crop], "kt": round(tot, 1), "kt_prev": round(totp, 1), "yoy": pct_change(tot, totp),
                              "usd": round(usd), "usd_per_t": round(usd / (tot * 1000), 1) if tot else None,
                              "monthly_kt": dict(sorted(mon[crop].items())),
                              "top": [{"country": k, "kt": round(v[0], 1), "share": share(v[0], tot), "kt_prev": round(prv.get(k, (0, 0))[0], 1)} for k, v in top]}
    return out


ESR = "https://api.fas.usda.gov/api/esr"
ESR_MATCH = {"corn": ["corn"], "soybeans": ["soybeans"], "wheat": ["all wheat", "wheat - all", "wheat"]}


def esr_block(S):
    """US exports (shipments) by month and destination from USDA FAS Export Sales Reporting: weekly exports summed by
    the calendar month of the week-ending date; destinations = marketing-year-to-date shipments at the latest week."""
    H = {"X-Api-Key": KEY}
    comms = get(S, f"{ESR}/commodities", headers=H).json()
    ctry = {}
    for c in get(S, f"{ESR}/countries", headers=H).json():
        nm = (c.get("countryDescription") or c.get("countryName") or "").strip()
        ctry[str(c.get("countryCode"))] = nm.title() if nm.isupper() else nm
    rel = {str(x.get("commodityCode")): int(x["marketYear"]) for x in get(S, f"{ESR}/datareleasedates", headers=H).json() if x.get("marketYear")}
    out = {"source": "USDA FAS Export Sales Reporting (weekly shipments)", "status": "observed", "crops": {}}
    for crop, names in ESR_MATCH.items():
        cand = [c for n in names for c in comms if n == (c.get("commodityName") or "").strip().lower()]
        if not cand:
            continue
        code = str(cand[0]["commodityCode"])
        my = rel.get(code)
        if not my:
            continue
        mon, dest, latest, my_ytd = {}, {}, None, {}
        for yy in (my, my - 1):
            rows = get(S, f"{ESR}/exports/commodityCode/{code}/allCountries/marketYear/{yy}", headers=H).json()
            wk = sorted({r["weekEndingDate"][:10] for r in rows})
            if yy == my and wk:
                latest = wk[-1]
            for r in rows:
                d = r["weekEndingDate"][:10]
                mon[d[:7]] = mon.get(d[:7], 0) + (r.get("weeklyExports") or 0) / 1000.0         # t -> kt
            if wk:
                # MY-to-date shipments at the same point of the marketing year (same number of weeks)
                n = len(sorted({r["weekEndingDate"][:10] for r in rows if yy == my})) if yy == my else my_ytd.get("n", len(wk))
                cut = wk[min(n, len(wk)) - 1]
                tot = sum((r.get("accumulatedExports") or 0) for r in rows if r["weekEndingDate"][:10] == cut) / 1000.0
                my_ytd[yy] = round(tot, 1)
                if yy == my:
                    my_ytd["n"] = n
                    for r in rows:
                        if r["weekEndingDate"][:10] == cut:
                            nm = ctry.get(str(r.get("countryCode")), str(r.get("countryCode")))
                            dest[nm] = dest.get(nm, 0) + (r.get("accumulatedExports") or 0) / 1000.0
        totd = sum(dest.values())
        top = sorted(dest.items(), key=lambda t: -t[1])[:8]
        out["crops"][crop] = {"my": season_label(my - 1), "week": latest, "partial_month": latest[:7] if latest else None, "kt": my_ytd.get(my), "kt_prev": my_ytd.get(my - 1),
                              "yoy": pct_change(my_ytd.get(my), my_ytd.get(my - 1)), "monthly_kt": {k: round(v, 1) for k, v in sorted(mon.items())},
                              "top": [{"country": k, "kt": round(v, 1), "share": share(v, totd)} for k, v in top]}
    return out


CGC_CSV = "https://www.canada.ca/content/dam/cgc-ccg/documents/statistiques-statistics/exports-grain-licensed-facilities/exports-grain-licensed-facilities.csv"


def canada_exports_block(S):
    """Canada monthly grain exports by destination - Canadian Grain Commission open data (exports from licensed
    facilities, Aug 2014 to date, monthly). Column names are detected, and the header is kept for audit."""
    import csv
    raw = get(S, CGC_CSV, timeout=120).content.decode("utf-8-sig", errors="replace")
    rd = csv.DictReader(io.StringIO(raw))
    cols = rd.fieldnames or []
    rows = list(rd)
    def col(rx, avoid=()):
        return next((c for c in cols if re.search(rx, c, re.I) and c not in avoid), None)
    gcol = col(r"grain|commodit")
    dcol = col(r"destination") or col(r"country|region")
    vcol = col(r"tonne|volume|value|quantity|ktonne")
    ycol = col(r"crop ?year") or col(r"^year$")
    mcol = col(r"month|period|date", (ycol,))
    out = {"source": "Canadian Grain Commission — exports of Canadian grain from licensed facilities (open data, monthly)", "status": "observed",
           "columns": cols, "sample": rows[:3], "crops": {}}
    if not (gcol and dcol and vcol and mcol):
        raise RuntimeError("CGC CSV layout not recognised: " + ", ".join(cols))
    labels = sorted({(r.get(gcol) or "").strip() for r in rows})
    out["grain_labels"] = labels[:60]
    unit = (vcol or "").lower()
    mult = 1000.0 if "000" in unit or "kilotonne" in unit or "ktonne" in unit else 1.0
    want = {"corn": re.compile(r"^corn$", re.I), "soybeans": re.compile(r"^soybeans?$", re.I),
            "wheat": re.compile(r"^(wheat|cw wheat|wheat \(excl|wheat, excl|wheat excluding)", re.I)}
    MON = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
    # 'Year' may be a calendar year or a crop year (Aug-Jul): if the newest year holds any month other than August
    # it is a calendar year (a crop-year label would only have reached August so far)
    yrs = [int(r.get(ycol)[:4]) for r in rows if (r.get(ycol) or "")[:4].isdigit()] if ycol else []
    ymax = max(yrs) if yrs else None
    newest_months = {MON.get((r.get(mcol) or "")[:3].lower()) for r in rows if ycol and (r.get(ycol) or "")[:4] == str(ymax)}
    crop_year = bool(re.search(r"crop", ycol or "", re.I)) or (newest_months <= {8, None})
    out_year_basis = "crop year (Aug-Jul)" if crop_year else "calendar year"
    def ym(r):
        v = (r.get(mcol) or "").strip()
        m = re.match(r"^(\d{4})-(\d{2})", v)
        if m:
            return f"{m.group(1)}-{m.group(2)}"
        mo = MON.get(v[:3].lower())
        cy = (r.get(ycol) or "").strip() if ycol else ""
        mm = re.match(r"^(\d{4})", cy)
        if mo and mm:
            y = int(mm.group(1)) + (1 if (crop_year and mo < 8) else 0)
            return f"{y}-{mo:02d}"
        return None
    for crop, rx in want.items():
        mon, dest = {}, {}
        for r in rows:
            g = (r.get(gcol) or "").strip()
            if not rx.search(g) or (crop == "wheat" and "durum" in g.lower()):
                continue
            k = ym(r)
            v = num(r.get(vcol))
            if not k or v is None:
                continue
            d = (r.get(dcol) or "").strip()
            if re.match(r"^(total|all)", d, re.I):
                continue
            mon[k] = mon.get(k, 0) + v * mult
            dest.setdefault(k, {})[d] = dest.get(k, {}).get(d, 0) + v * mult
        months = sorted(dest)[-12:]
        agg = {}
        for k in months:
            for d, v in dest[k].items():
                agg[d] = agg.get(d, 0) + v
        tot = sum(agg.values())
        out["year_basis"] = out_year_basis
        out["crops"][crop] = {"unit": "tonnes", "monthly_t": dict(sorted(mon.items())[-30:]),
                              "dest_window": f"{months[0]}..{months[-1]}" if months else None,
                              "top": [{"country": k, "t": round(v), "share": share(v, tot)} for k, v in sorted(agg.items(), key=lambda t: -t[1])[:8]]}
    return out


def fx_block(S):
    out = {}
    to = now_utc().date()
    js = get(S, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json&dataInicial=" + (to - dt.timedelta(days=45)).strftime("%d/%m/%Y") + "&dataFinal=" + to.strftime("%d/%m/%Y")).json()
    ser = [[dt.datetime.strptime(x["data"], "%d/%m/%Y").strftime("%Y-%m-%d"), float(x["valor"])] for x in js]
    out["brl"] = {"name": "USD/BRL", "source": "Banco Central do Brasil (PTAX sell, SGS 1)", "series": ser}
    try:
        u = f"https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde={to - dt.timedelta(days=45)}&fechahasta={to}"
        js = get(S, u).json()["results"]
        ser = sorted([[x["fecha"], float(x["detalle"][0]["tipoCotizacion"])] for x in js if x.get("detalle")])
        out["ars"] = {"name": "USD/ARS", "source": "BCRA official (Com. A 3500 wholesale)", "series": ser}
    except Exception as e:
        out["ars_error"] = red(e)[:160]
    for k in ("brl", "ars"):
        s = (out.get(k) or {}).get("series") or []
        if len(s) >= 2:
            last = s[-1][1]
            def back(n):
                return s[-1 - n][1] if len(s) > n else None
            out[k].update({"last": last, "date": s[-1][0], "d1": pct_change(last, back(1)), "w1": pct_change(last, back(5)),
                           "m1": pct_change(last, back(21))})
    return out


# ------------------------------------------------------------------ publish
def sh(*a, cwd=None, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def load_previous():
    try:
        r = sh("git", "show", "origin/ggrain:gg.json", cwd=ROOT, check=False)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except Exception:
        return None


def load_snap(crop, my):
    r = sh("git", "show", f"origin/ggrain:snap/{crop}_{my.replace('/', '-')}.json", cwd=ROOT, check=False)
    return json.loads(r.stdout) if r.returncode == 0 else {}


def publish(body, snaps):
    for k, v in (("user.name", "desk-ggrain-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=ROOT)
    sh("rm", "-rf", WT, check=False)
    sh("git", "worktree", "prune", cwd=ROOT, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "ggrain", cwd=ROOT, check=False).returncode == 0
    if exists:
        sh("git", "worktree", "add", "-f", "-B", "ggrain", WT, "origin/ggrain", cwd=ROOT)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=ROOT)
        sh("git", "checkout", "-q", "--orphan", "ggrain", cwd=WT)
        sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    os.makedirs(os.path.join(WT, "snap"), exist_ok=True)
    for name, data in snaps.items():
        with open(os.path.join(WT, "snap", name), "w") as f:
            json.dump(data, f, separators=(",", ":"))
    with open(os.path.join(WT, "gg.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "-A", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "ggrain: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "ggrain", cwd=WT)


def main():
    t0 = time.time()
    S = http()
    sh("git", "fetch", "-q", "origin", "ggrain", cwd=ROOT, check=False)
    prev = load_previous() or {}
    body = {"updated_at": now_utc().isoformat(), "crops": {}, "health": {"ok": [], "failed": []}}
    snaps = {}
    for crop in CODES:
        body["crops"][crop] = {}
        if not KEY:
            body["health"]["failed"].append({"part": f"psd/{crop}", "error": "FAS_API_KEY not set"})
            continue
        try:
            blk, snap, cur = psd_block(S, crop)
            fname = f"{crop}_{blk['my'].replace('/', '-')}.json"
            hist = load_snap(crop, blk["my"]) or {}
            rel = hist.setdefault("releases", {})
            earlier = sorted(k for k in rel if k < blk["release"])
            apply_revisions(blk, rel[earlier[-1]] if earlier else None, earlier[-1] if earlier else None)
            rel[blk["release"]] = snap
            hist["releases"] = {k: rel[k] for k in sorted(rel)[-6:]}
            snaps[fname] = hist
            body["crops"][crop]["psd"] = blk
            body["health"]["ok"].append(f"psd/{crop}")
        except Exception as e:
            body["health"]["failed"].append({"part": f"psd/{crop}", "error": red(e)[:200]})
            if prev.get("crops", {}).get(crop, {}).get("psd"):
                body["crops"][crop]["psd"] = dict(prev["crops"][crop]["psd"], stale=True)
    for part, fn in (("conab", conab_block), ("fx", fx_block), ("us_exports", esr_block), ("ca_exports", canada_exports_block), ("comex", comex_block)):
        try:
            body[part] = fn(S)
            body["health"]["ok"].append(part)
        except Exception as e:
            body["health"]["failed"].append({"part": part, "error": red(e)[:200]})
            if prev.get(part):
                body[part] = dict(prev[part], stale=True)
    body["run_seconds"] = round(time.time() - t0, 1)
    txt = json.dumps(body)
    if KEY and KEY in txt:
        sys.exit("ABORT: key in output")
    if os.environ.get("GG_DRY"):
        print(json.dumps(body, indent=1)[:4000])
        return
    publish(body, snaps)
    print(f"::notice title=global grains::ok {len(body['health']['ok'])} · failed {len(body['health']['failed'])} · {body['run_seconds']} s")
    for f in body["health"]["failed"]:
        print(f"::warning title=global grains::{f['part']}: {f['error']}")


if __name__ == "__main__":
    main()
