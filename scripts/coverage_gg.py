"""Source-coverage check for the Brazil / World fundamentals views (read-only probe, runs in GitHub Actions only).

Pulls each candidate source for real and writes coverage/coverage.json + coverage/coverage.md:
  - USDA FAS PSD (api.fas.usda.gov, X-Api-Key = FAS_API_KEY): all countries + world, corn / soybeans / wheat,
    the last three marketing years, which attributes come back, latest release month, release dates.
  - CONAB (gov.br): grain-crop bulletin folders and the data files (xls/xlsx) they link to.
  - Banco Central do Brasil SGS (USD/BRL, series 1) and BCRA (official ARS).
No secret is printed or written: the key only travels in a request header and every error string is redacted.
"""
import json, os, re, sys, time, datetime as dt
import requests

KEY = os.environ.get("FAS_API_KEY", "").strip()
OUT = os.path.join(os.path.dirname(__file__), "..", "coverage")
os.makedirs(OUT, exist_ok=True)
PSD = "https://api.fas.usda.gov/api/psd"
CODES = {"corn": "0440000", "soybeans": "2222000", "wheat": "0410000"}
UA = {"User-Agent": "Mozilla/5.0 (desk coverage check)"}
R = {"run_at": dt.datetime.utcnow().isoformat() + "Z", "psd": {}, "conab": {}, "fx": {}, "errors": []}


def red(s):
    s = str(s)
    return s.replace(KEY, "***") if KEY else s


def get(url, **kw):
    kw.setdefault("timeout", 40)
    h = dict(UA); h.update(kw.pop("headers", {}))
    for i in range(3):
        try:
            r = requests.get(url, headers=h, **kw)
            if r.status_code == 429:
                time.sleep(5 * (i + 1)); continue
            return r
        except Exception as e:
            last = e; time.sleep(2)
    raise RuntimeError(red(last))


def psd():
    if not KEY:
        R["errors"].append("FAS_API_KEY not set"); return
    H = {"X-Api-Key": KEY}
    ref = {}
    for name, path in [("attr", "commodityAttributes"), ("unit", "unitsOfMeasure"), ("country", "countries")]:
        r = get(f"{PSD}/{path}", headers=H)
        R["psd"][path + "_status"] = r.status_code
        ref[name] = r.json() if r.ok else []
    A = {str(a["attributeId"]): (a.get("attributeName") or "").strip() for a in ref["attr"]}
    U = {str(u["unitId"]): (u.get("unitDescription") or "").strip() for u in ref["unit"]}
    C = {c.get("countryCode"): (c.get("countryName") or "").strip() for c in ref["country"]}
    R["psd"]["n_countries_ref"] = len(C)
    for crop, code in CODES.items():
        cr = R["psd"].setdefault(crop, {})
        r = get(f"{PSD}/commodity/{code}/dataReleaseDates", headers=H)
        cr["release_dates_status"] = r.status_code
        if r.ok:
            js = r.json(); cr["release_dates_sample"] = js[-6:] if isinstance(js, list) else str(js)[:400]
        for yr in (2024, 2025, 2026):
            y = cr.setdefault(str(yr), {})
            r = get(f"{PSD}/commodity/{code}/country/all/year/{yr}", headers=H)
            y["all_status"] = r.status_code
            rows = r.json() if r.ok else []
            y["rows"] = len(rows)
            if not rows:
                continue
            months = sorted({int(x.get("month") or 0) for x in rows})
            y["months"] = months
            y["calendar_years"] = sorted({x.get("calendarYear") for x in rows})
            y["countries"] = len({x.get("countryCode") for x in rows})
            y["attributes"] = sorted({A.get(str(x.get("attributeId")), str(x.get("attributeId"))) + " [" + U.get(str(x.get("unitId")), "?") + "]" for x in rows})
            prod = {}
            exp = {}
            for x in rows:
                an = A.get(str(x.get("attributeId")), "").lower()
                if an == "production":
                    prod[x.get("countryCode")] = float(x.get("value") or 0)
                elif an in ("exports", "my exports"):
                    exp[x.get("countryCode")] = float(x.get("value") or 0)
            tp = sum(prod.values()) or 1; te = sum(exp.values()) or 1
            y["top_production"] = [[C.get(k, k), v, round(100 * v / tp, 1)] for k, v in sorted(prod.items(), key=lambda t: -t[1])[:12]]
            y["top_exports"] = [[C.get(k, k), v, round(100 * v / te, 1)] for k, v in sorted(exp.items(), key=lambda t: -t[1])[:10]]
            y["sum_production_1000mt"] = round(tp); y["sum_exports_1000mt"] = round(te)
            y["sample_row"] = rows[0]
            r = get(f"{PSD}/commodity/{code}/world/year/{yr}", headers=H)
            y["world_status"] = r.status_code
            if r.ok:
                w = r.json()
                y["world_production"] = [float(x.get("value") or 0) for x in w if A.get(str(x.get("attributeId")), "").lower() == "production"][:1]
        # history depth: 5 years back for Brazil (BR) and the US
        for cc in ("BR", "US"):
            r = get(f"{PSD}/commodity/{code}/country/{cc}/year/2021", headers=H)
            cr[f"{cc}_2021_status"] = r.status_code
            cr[f"{cc}_2021_rows"] = len(r.json()) if r.ok else 0


def conab():
    base = "https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/safra-de-graos/boletim-da-safra-de-graos"
    try:
        r = get(base); R["conab"]["index_status"] = r.status_code
        links = sorted(set(re.findall(r'href="(https://www\.gov\.br/conab/[^"]*?levantamento[^"]*?)"', r.text)))
        R["conab"]["levantamento_links"] = links[:30]
        latest = [l for l in links if "2026-27" in l] or [l for l in links if "2025-26" in l]
        files = {}
        for l in latest[:3]:
            p = get(l); files[l] = {"status": p.status_code,
                                    "files": sorted(set(re.findall(r'href="([^"]+\.(?:xlsx?|pdf|csv)(?:/@@download/file)?)"', p.text)))[:25]}
        R["conab"]["latest_folders"] = files
    except Exception as e:
        R["conab"]["error"] = red(e)
    try:
        s = "https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/series-historicas"
        r = get(s); R["conab"]["series_status"] = r.status_code
        R["conab"]["series_links"] = sorted(set(re.findall(r'href="([^"]+\.(?:xlsx?|csv)[^"]*)"', r.text)))[:25] or sorted(set(re.findall(r'href="(https://www\.gov\.br/conab/[^"]*series-historicas/[^"]+)"', r.text)))[:25]
    except Exception as e:
        R["conab"]["series_error"] = red(e)
    try:
        r = get("https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/progresso-de-safra")
        R["conab"]["progress_status"] = r.status_code
        R["conab"]["progress_links"] = sorted(set(re.findall(r'href="([^"]+(?:progresso|Progresso)[^"]+)"', r.text)))[:20]
    except Exception as e:
        R["conab"]["progress_error"] = red(e)


def fx():
    for name, url in [("BCB_USD_BRL_sgs1", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/5?formato=json"),
                      ("BCRA_ARS_official", "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD"),
                      ("BCRA_ARS_A3500_series", "https://api.bcra.gob.ar/estadisticas/v3.0/monetarias/5")]:
        try:
            r = get(url); R["fx"][name] = {"status": r.status_code, "sample": r.text[:500]}
        except Exception as e:
            R["fx"][name] = {"error": red(e)}


for f in (psd, conab, fx):
    try:
        f()
    except Exception as e:
        R["errors"].append(f.__name__ + ": " + red(e))

txt = json.dumps(R, indent=1, default=str)
if KEY and KEY in txt:
    sys.exit("ABORT: key found in output")
open(os.path.join(OUT, "coverage.json"), "w").write(txt)
print(txt[:3000])
