"""Macro blocks: the macro monitor (BLS, BEA, FRED, StatCan, PMIs), CPI detail, trade and fiscal balances, Canada / Ontario, release history.

Split out of update_data.py (Nov 2026). Functions were moved unchanged; update_data.py re-exports every name, so
`import update_data as U; U.<name>` keeps working. The run clock lives in ud_common.NOW (read here as UDC.NOW) so the
live loop can advance it for every module at once.
"""

import argparse, csv, io, json, os, re, statistics, sys, time, traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

import requests

import ud_common as UDC
from ud_common import TOR, UA, _fred, _num, _valet_series, get, iso, recent_release, redact
from ud_grains import MONTHS


# ------------------------------------------------------------------ macro monitor
# (key, name, group, source, series id, transform, unit, decimals, good-direction, sanity range of the RAW series)
#   transform: level | yoy (% vs 12 months earlier) | diff (change vs prior, K) | pct (% change vs prior)
#   good: "up" / "down" = which way is economically stronger; "heat" = inflation (up = hotter)
MACRO = [
    ("us_cpi",      "CPI",                 "us", "fred", "CPIAUCSL",        "yoy",   "%",  1, "heat", (200, 500)),
    ("us_core_cpi", "Core CPI",            "us", "fred", "CPILFESL",        "yoy",   "%",  1, "heat", (200, 500)),
    ("us_core_pce", "Core PCE",            "us", "fred", "PCEPILFE",        "yoy",   "%",  1, "heat", (80, 200)),
    ("us_nfp",      "Nonfarm payrolls",    "us", "fred", "PAYEMS",          "diff",  "K",  0, "up",   (120000, 200000)),
    ("us_ur",       "Unemployment rate",   "us", "fred", "UNRATE",          "level", "%",  1, "down", (2, 15)),
    ("us_claims",   "Initial jobless claims", "us", "fred", "ICSA",         "level", "K",  0, "down", (100000, 1500000)),
    ("us_cclaims",  "Continuing claims",   "us", "fred", "CCSA",            "level", "K",  0, "down", (800000, 6000000)),
    ("us_ahe",      "Avg hourly earnings", "us", "fred", "CES0500000003",   "yoy",   "%",  1, "heat", (20, 60)),
    ("us_retail",   "Retail sales",        "us", "fred", "RSAFS",           "pct",   "%",  1, "up",   (400000, 1200000)),
    ("us_gdp",      "Real GDP (q/q ann.)", "us", "fred", "A191RL1Q225SBEA", "level", "%",  1, "up",   (-40, 40)),
    ("us_umich",    "UMich sentiment",     "us", "fred", "UMCSENT",         "level", "",   1, "up",   (20, 120)),
    # labour & demand
    ("us_jolts",    "JOLTS job openings",  "us", "fred", "JTSJOL",          "raw",   "K",  0, "up",   (3000, 15000)),
    ("us_adp",      "ADP private payrolls", "us", "fred", "ADPMNUSNERSA",   "diffk", "K",  0, "up",   (100000000, 160000000)),
    ("us_factory",  "Factory orders",      "us", "fred", "AMTMNO",          "pct",   "%",  1, "up",   (300000, 800000)),
    ("us_durable",  "Durable goods orders", "us", "fred", "DGORDER",        "pct",   "%",  1, "up",   (150000, 450000)),
    ("us_indpro",   "Industrial production", "us", "fred", "INDPRO",        "pct",   "%",  1, "up",   (70, 140)),
    # prices & income
    ("us_ppi",      "PPI final demand",    "us", "fred", "PPIFIS",          "yoy",   "%",  1, "heat", (100, 250)),
    ("us_pce",      "PCE prices",          "us", "fred", "PCEPI",           "yoy",   "%",  1, "heat", (80, 200)),
    ("us_pinc",     "Personal income",     "us", "fred", "PI",              "pct",   "%",  1, "up",   (15000, 40000)),
    ("us_pspend",   "Personal spending",   "us", "fred", "PCE",             "pct",   "%",  1, "up",   (12000, 35000)),
    ("us_import",   "Import prices",       "us", "fred", "IR",              "yoy",   "%",  1, "heat", (80, 220)),
    # housing (thousands of units, seasonally adjusted annual rate)
    ("us_starts",   "Housing starts (SAAR)",      "us", "fred", "HOUST",           "raw",   "K",  0, "up",   (500, 2500)),
    ("us_permits",  "Building permits (SAAR)",    "us", "fred", "PERMIT",          "raw",   "K",  0, "up",   (500, 2500)),
    ("us_nhs",      "New home sales (SAAR)",      "us", "fred", "HSN1F",           "raw",   "K",  0, "up",   (300, 1500)),
    ("us_ism",      "ISM Manufacturing PMI", "us", "ism", "manufacturing",  "level", "",   1, "up",   (25, 80)),
    ("us_ism_svc",  "ISM Services PMI",    "us", "ism", "services",         "level", "",   1, "up",   (25, 80)),
    ("ca_cpi",      "CPI",                 "ca", "valet", "V41690973",      "yoy",   "%",  1, "heat", (100, 250)),
    ("ca_trim",     "CPI-trim",            "ca", "valet", "CPI_TRIM",       "level", "%",  1, "heat", (-2, 12)),
    ("ca_median",   "CPI-median",          "ca", "valet", "CPI_MEDIAN",     "level", "%",  1, "heat", (-2, 12)),
    ("ca_emp",      "Employment change",   "ca", "statcan", 2062811,        "diff",  "K",  1, "up",   (15000, 25000)),
    ("ca_ur",       "Unemployment rate",   "ca", "statcan", 2062815,        "level", "%",  1, "down", (2, 20)),
    ("ca_gdp",      "Real GDP",            "ca", "statcan", 65201210,       "pct",   "%",  1, "up",   (1500000, 3500000)),
    ("ca_starts",   "Housing starts (SAAR)",      "ca", "statcan", 52300157,       "raw",   "K",  1, "up",   (100, 400)),
    ("ca_permits",  "Building permits, value", "ca", "statcan", 1675115467,  "yoy",   "%",  1, "up",   (3000000, 30000000)),
    ("ca_mfg",      "Manufacturing sales (unadj.)", "ca", "statcan", 800025,   "yoy",   "%",  1, "up",   (40000000, 120000000)),
    ("ca_whl",      "Wholesale sales",     "ca", "statcan", 52367637,       "pct",   "%",  1, "up",   (5000000, 200000000)),
    ("ca_ippi",     "Industrial product prices", "ca", "statcan", 1230996007, "yoy", "%",  1, "heat", (80, 200)),
    ("ca_vac",      "Job vacancies",       "ca", "statcan", 1481212145,     "lvlk",  "K",  0, "up",   (100000, 1500000)),
    ("ca_ivey",     "Ivey PMI (s.a.)",     "ca", "ivey", "sa",              "level", "",   1, "up",   (20, 85)),
    # cycle-composite inputs (owner's FRED map): leading hours and financial conditions, lagging credit and labour slack
    ("us_hours",    "Avg weekly hours, manufacturing", "us", "fred", "AWHMAN",  "raw",   "",   1, "up",   (30, 50)),
    ("us_nfci",     "Financial conditions (Chicago Fed NFCI)", "us", "fred", "NFCI", "raw", "", 2, "down", (-3, 10)),
    ("us_udur",     "Avg duration of unemployment (weeks)", "us", "fred", "UEMPMEAN", "raw", "", 1, "down", (3, 60)),
    ("us_isratio",  "Inventories to sales ratio", "us", "fred", "ISRATIO",  "raw",   "",   2, "down", (0.8, 2.5)),
    ("us_busloans", "Commercial & industrial loans", "us", "fred", "BUSLOANS", "yoy", "%",  1, "up",   (1000, 6000)),
    ("us_ccinc",    "Consumer credit to income", "us", "fred", "TOTALSL:1000/PI", "raw",  "%",  1, "up",   (5, 60)),
    # chart-only series for the Macro sub-tab (quarterly GDP bars, policy-rate panels)
    ("ca_gdpq",     "Real GDP (q/q ann., chained 2017 $)", "ca", "statcan", 62305752,       "qann",  "%",  1, "up",   (1500000, 3800000)),
    ("us_policy",   "Fed funds target (upper)", "us", "fred", "DFEDTARU",   "level", "%",  2, "heat", (0, 10)),
    ("ca_policy",   "BoC overnight target", "ca", "valet", "V39079",        "level", "%",  2, "heat", (0, 10)),
]
# Valet series that are StatCan vectors re-published by the BoC: if Valet fails, read the vector from StatCan WDS directly
VALET_TO_STATCAN = {"V41690973": 41690973}   # CPI all-items, 2002=100, NSA (StatCan 18-10-0004-01)
MACRO_LONG = {"us_cpi", "ca_cpi", "us_core_cpi", "us_ur", "ca_ur", "us_gdp", "ca_gdpq", "us_policy", "ca_policy"}


# BLS straight from the source on release mornings. FRED re-posts BLS data with a lag (Nov 6 payrolls: released 8:30 ET,
# on FRED ~10:45 ET), so for these series the desk asks BLS itself while a release is fresh and keeps FRED for history.
BLS_SRC = {"us_nfp": "CES0000000001", "us_ur": "LNS14000000", "us_ahe": "CES0500000003",
           "us_cpi": "CUSR0000SA0", "us_core_cpi": "CUSR0000SA0L1E", "us_ppi": "WPSFD4"}   # identical series to the FRED ids used
BLS_KEY = os.environ.get("BLS_API_KEY", "").strip()


class _KeepNewer(Exception):
    """A source is behind what the desk already shows: keep the newer stored print (not a failure)."""


def _bls_batch(ids):
    """{series id: [(YYYY-MM-01, value)]} in one request; v2 with BLS_API_KEY (never printed), else keyless v1 (25/day per IP)."""
    body = {"seriesid": list(ids), "startyear": str(UDC.NOW.year - 2), "endyear": str(UDC.NOW.year)}
    if BLS_KEY:
        body["registrationkey"] = BLS_KEY
    url = "https://api.bls.gov/publicAPI/" + ("v2" if BLS_KEY else "v1") + "/timeseries/data/"
    try:
        r = requests.post(url, headers={**UA, "Content-Type": "application/json"}, data=json.dumps(body), timeout=25)
        r.raise_for_status()
        j = r.json()
    except Exception as e:   # scrub: the key is in the body, never the message
        raise RuntimeError(f"BLS request failed ({type(e).__name__})") from None
    if j.get("status") and j["status"] != "REQUEST_SUCCEEDED":   # e.g. keyless daily limit reached: say so instead of returning nothing
        raise RuntimeError(f"BLS {j.get('status')}: {' '.join(j.get('message') or [])[:160]}")
    out = {}
    for ser in (j.get("Results") or {}).get("series", []):
        pts = [(f"{d['year']}-{d['period'][1:]}-01", float(d["value"])) for d in ser.get("data", [])
               if str(d.get("period", "")).startswith("M") and d["period"] != "M13" and _num(d.get("value")) is not None]
        out[ser["seriesID"]] = sorted(pts)
    return out


# Direct BEA read for the BEA-published series. FRED re-posts these with a lag (today: GDP +45 min), while BEA's own
# API carries them the minute the release goes out. The key lives only in the BEA_API_KEY secret: it is sent as a
# request parameter, never printed, and every error raised from here is scrubbed of the URL.
BEA_KEY = os.environ.get("BEA_API_KEY", "").strip()
BEA_SRC = {   # macro key -> (NIPA table, frequency, line description)
    "us_gdp": ("T10101", "Q", "Gross domestic product"),
    "us_core_pce": ("T20804", "M", "PCE excluding food and energy"),
}


def _bea(table, freq, line, years=8):
    yrs = ",".join(str(UDC.NOW.year - i) for i in range(years))
    try:
        r = requests.get("https://apps.bea.gov/api/data", headers=UA, timeout=20,
                         params={"UserID": BEA_KEY, "method": "GetData", "datasetname": "NIPA", "TableName": table,
                                 "Frequency": freq, "Year": yrs, "ResultFormat": "JSON"})
        code = getattr(r, "status_code", 200)
        res = r.json()["BEAAPI"]
        res = res.get("Results", res)
        res = res[0] if isinstance(res, list) else res
        err = res.get("Error") or (r.json()["BEAAPI"].get("Error") if isinstance(r.json()["BEAAPI"], dict) else None)
        if err:
            err = err[0] if isinstance(err, list) else err
            raise RuntimeError("API: " + str(err.get("APIErrorDescription") or err.get("ErrorDetail") or err)[:160])
        rows = res["Data"]
    except Exception as e:
        why = str(e) if str(e).startswith("API: ") else type(e).__name__
        if "code" in locals() and code != 200:
            why = f"HTTP {code}"
        raise RuntimeError(redact(f"BEA {table} unavailable ({why})")) from None   # no URL / key in the message
    want = line.lower()
    lines = [x for x in rows if x.get("LineDescription", "").strip().lower() == want]
    if not lines:
        raise RuntimeError(f"BEA {table}: line '{line}' not found")
    ln = min(int(x["LineNumber"]) for x in lines)
    out = []
    for x in lines:
        if int(x["LineNumber"]) != ln:
            continue
        tp, v = x["TimePeriod"], _num(str(x.get("DataValue", "")).replace(",", ""))
        if v is None:
            continue
        if "Q" in tp:
            y, q = tp.split("Q"); d = f"{y}-{(int(q) - 1) * 3 + 1:02d}-01"
        elif "M" in tp:
            y, m = tp.split("M"); d = f"{y}-{int(m):02d}-01"
        else:
            continue
        out.append((d, v))
    return sorted(out)


def _statcan(vec, n):
    for attempt in range(3):
        try:
            return _statcan1(vec, n)
        except requests.exceptions.ConnectionError:
            if attempt == 2:
                raise
            time.sleep(3 + attempt * 4)


def _statcan1(vec, n):
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods",
                      headers={**UA, "Content-Type": "application/json"},
                      data=json.dumps([{"vectorId": vec, "latestN": n}]), timeout=25)
    r.raise_for_status()
    obj = r.json()[0]
    if obj.get("status") != "SUCCESS":
        raise RuntimeError(f"StatCan v{vec}: {obj.get('status')}")
    return sorted((p["refPer"][:10], float(p["value"])) for p in obj["object"]["vectorDataPoint"] if p.get("value") is not None)


def _label(d, freq):
    y, m, day = int(d[:4]), int(d[5:7]), int(d[8:10])
    if freq in ("W", "D"):
        return f"{MONTHS[m-1]} {day}"
    if freq == "Q":
        return f"Q{(m-1)//3+1} '{str(y)[2:]}"
    return f"{MONTHS[m-1]} '{str(y)[2:]}"


def _freq(points):
    if len(points) < 3:
        return "M"
    a, b = datetime.fromisoformat(points[-2][0]), datetime.fromisoformat(points[-1][0])
    gap = (b - a).days
    return "D" if gap <= 4 else "W" if gap <= 8 else "Q" if gap >= 80 else "M"


def _transform(points, how):
    out = []
    byd = dict(points)
    for i, (d, v) in enumerate(points):
        if how in ("level", "raw"):
            out.append((d, v))
        elif how == "lvlk":
            out.append((d, v / 1000))
        elif how == "diffk" and i > 0:
            out.append((d, (v - points[i-1][1]) / 1000))
        elif how in ("diff", "pct") and i > 0:
            pv = points[i-1][1]
            out.append((d, (v - pv) if how == "diff" else (v / pv - 1) * 100))
        elif how == "qann" and i > 0:
            out.append((d, ((v / points[i-1][1]) ** 4 - 1) * 100))
        elif how == "yoy":
            base = byd.get(f"{int(d[:4]) - 1}{d[4:]}")
            if base:
                out.append((d, (v / base - 1) * 100))
    return out


def _track(m, prev, pts_all):
    """Keep 24 readings, note revisions to the prior period and when a new period first appeared (≈ release time)."""
    m["hist24"] = [[_label(d, m["freq"]), round(v, m["dec"] + 1)] for d, v in pts_all]
    if prev and prev.get("period") == m["period"]:
        m["seen_at"] = prev.get("seen_at")
        if prev.get("rev"):
            m["rev"] = prev["rev"]
    else:
        m["seen_at"] = iso(UDC.NOW) if prev else None
        if prev:
            ph = dict((h[0], h[1]) for h in prev.get("hist24") or prev.get("history") or [])
            lab = m["history"][-2][0] if len(m["history"]) > 1 else None
            if lab in ph and abs(ph[lab] - m["prior"]) >= 10 ** (-m["dec"]) / 2:
                m["rev"] = {"period": lab, "from": ph[lab], "to": m["prior"]}


def ca_retail(D, N):
    """Canada retail trade (StatCan 20-10-0056-01, seasonally adjusted): total and ex motor vehicle & parts dealers."""
    meta = D["meta"]
    last = meta.get("ca_retail_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=1):
        print("  checked <6h ago — skipping")
        return False
    acc, dims = {}, {"naics": set(), "adj": set()}
    cols = {}
    for row in _sc_table(20100056):
        if row.get("GEO") != "Canada":
            continue
        for c_, v_ in row.items():
            if c_ not in ("REF_DATE", "VALUE", "DGUID", "COORDINATE", "VECTOR", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS", "SCALAR_ID", "UOM_ID"):
                cols.setdefault(c_, set()).add(v_)
        nai = next((row[c] for c in row if c.startswith("North American Industry")), "")
        adj = row.get("Adjustments", "")
        dims["naics"].add(nai); dims["adj"].add(adj)
        if adj.lower() != "seasonally adjusted":
            continue
        sales = (row.get("Sales") or "").lower()
        n = nai.lower()
        key = None
        if sales.startswith("total retail"):
            key = "tot" if n.startswith("retail trade [44-45]") else "auto" if "[441]" in n else "gas" if "[457]" in n else None
        elif sales.startswith("retail e-commerce") and n.startswith("retail trade [44-45]"):
            key = "ecom"
        v = _num(row.get("VALUE"))
        if key and v is not None:
            acc.setdefault(key, {})[row["REF_DATE"][:10] if len(row["REF_DATE"]) > 7 else row["REF_DATE"] + "-01"] = v
    meta["ca_retail_dims"] = {c_: sorted(v_)[:40] for c_, v_ in cols.items()}
    if acc.get("tot") and acc.get("auto"):
        acc["ex"] = {d: v - acc["auto"][d] for d, v in acc["tot"].items() if d in acc["auto"]}
        if acc.get("gas"):
            acc["core"] = {d: acc["ex"][d] - acc["gas"][d] for d in acc["ex"] if d in acc["gas"]}
    if not acc.get("tot"):
        raise RuntimeError(f"no total retail line; NAICS seen: {sorted(dims['naics'])[:15]} adj: {sorted(dims['adj'])}"[:700])
    old = {m["key"]: m for m in D.get("macro_extra", [])}
    out = []
    for key, name, k in (("ca_retail", "Retail sales", "tot"), ("ca_retail_ex", "Retail sales ex-autos", "ex"), ("ca_retail_core", "Retail ex gas & autos", "core")):
        if k not in acc:
            continue
        raw = sorted(acc[k].items())
        pts = _transform(raw, "pct")
        pts_all = pts[-24:]
        h = pts[-12:]
        lvl = raw[-1][1] / 1e6     # thousands of dollars -> C$ billions
        yoy = None
        byd = dict(raw)
        d0 = raw[-1][0]
        base = byd.get(f"{int(d0[:4]) - 1}{d0[4:]}")
        if base:
            yoy = round((raw[-1][1] / base - 1) * 100, 2)
        m = {"key": key, "name": name, "group": "ca", "unit": "%", "dec": 1, "good": "up", "freq": "M", "measure": "m/m",
             "period": _label(h[-1][0], "M"), "obs_date": h[-1][0], "value": round(h[-1][1], 2), "prior": round(h[-2][1], 2),
             "chg": round(h[-1][1] - h[-2][1], 2), "history": [[_label(d, "M"), round(v, 2)] for d, v in h],
             "level_b": round(lvl, 2), "yoy": yoy, "src": "Statistics Canada 20-10-0056-01" + ("" if k == "tot" else " (derived: total minus " + ("auto dealers" if k == "ex" else "auto dealers and gasoline stations") + ")")}
        if k == "tot" and acc.get("ecom"):
            e_ = sorted(acc["ecom"].items())
            m["ecom_b"] = round(e_[-1][1] / 1e6, 2)
            m["ecom_share"] = round(e_[-1][1] / raw[-1][1] * 100, 1) if e_[-1][0] == raw[-1][0] else None
        _track(m, old.get(key), pts_all)
        out.append(m)
    D["macro_extra"] = out
    meta["ca_retail_checked"] = iso(UDC.NOW)
    meta["asof"]["ca_retail"] = iso(UDC.NOW)
    print("  ca_retail:", [(m["key"], m["period"], m["value"]) for m in out])
    return True


# ---- purchasing managers' indexes (free, public pages; no keys) ----
# ISM publishes each Report On Business through PR Newswire; the headline value is in the release title / URL
# ("manufacturing-pmi-at-54-5-september-2026-..."). Ivey PMI (Canada) is published by Ivey Business School as a table.
_MN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
_ISM_CACHE = {}


def _ism(kind):
    if "rows" not in _ISM_CACHE:
        rows = {}
        for u in ("https://www.prnewswire.com/news/institute-for-supply-management/",
                  "https://www.prnewswire.com/news/institute-for-supply-management/?page=2&pagesize=100"):
            try:
                t = get(u, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36"}).text
            except Exception:
                continue
            for k, v, mon, yr in re.findall(r"(manufacturing|services)-pmi-at-(\d{2}(?:-\d)?)-(" + "|".join(_MN) + r")-(\d{4})", t, re.I):
                rows[(k.lower(), f"{yr}-{_MN.index(mon.lower()) + 1:02d}-01")] = float(v.replace("-", "."))
        _ISM_CACHE["rows"] = rows
    out = sorted((d, v) for (k, d), v in _ISM_CACHE["rows"].items() if k == kind)
    if not out:
        raise RuntimeError("ISM release list not readable")
    return out


def _ivey(_sid=None):
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", get("https://iveypmi.uwo.ca/historic-data/").text))
    i = t.find("Seasonally Adjusted")   # the seasonally adjusted table comes first on the page
    seen = {}
    for mo, yr, v in re.findall(r"\b(\d{1,2})/(\d{4}) (\d{2}\.\d)(?: \d{2}\.\d){4}", t[i:] if i >= 0 else t):
        seen.setdefault(f"{yr}-{int(mo):02d}-01", float(v))
    if len(seen) < 3:
        raise RuntimeError("Ivey PMI table not readable")
    return sorted(seen.items())


def _bizday(y, m, n):
    """n-th business day of a month (weekends skipped; Jan 1 and US Labor Day skipped)."""
    d, k = datetime(y, m, 1).date(), 0
    while True:
        hol = (d.month == 1 and d.day == 1) or (d.month == 9 and d.weekday() == 0 and d.day <= 7)
        if d.weekday() < 5 and not hol:
            k += 1
            if k == n:
                return d
        d += timedelta(days=1)


FF_MAP = {("USD", "ISM Manufacturing PMI"): "us_ism", ("USD", "ISM Services PMI"): "us_ism_svc", ("CAD", "Ivey PMI"): "ca_ivey",
          ("USD", "JOLTS Job Openings"): "us_jolts", ("USD", "ADP Non-Farm Employment Change"): "us_adp", ("USD", "Factory Orders m/m"): "us_factory",
          ("USD", "Durable Goods Orders m/m"): "us_durable", ("USD", "Industrial Production m/m"): "us_indpro", ("USD", "PPI m/m"): "us_ppi",
          ("USD", "Personal Income m/m"): "us_pinc", ("USD", "Personal Spending m/m"): "us_pspend", ("USD", "Import Prices m/m"): "us_import",
          ("USD", "Housing Starts"): "us_starts", ("USD", "Building Permits"): "us_permits", ("USD", "New Home Sales"): "us_nhs",
          ("USD", "Core PCE Price Index m/m"): "us_pce",
          ("CAD", "Housing Starts"): "ca_starts", ("CAD", "Building Permits m/m"): "ca_permits", ("CAD", "Manufacturing Sales m/m"): "ca_mfg",
          ("CAD", "Wholesale Sales m/m"): "ca_whl", ("CAD", "IPPI m/m"): "ca_ippi"}
# the weekly feed's forecast is used only where it is in the desk's own unit (m/m % vs m/m %, level vs level); otherwise date only
FF_UNIT = {"us_jolts": 1000, "us_adp": 1, "us_factory": 1, "us_durable": 1, "us_indpro": 1, "us_pinc": 1, "us_pspend": 1,
           "us_starts": 1000, "us_permits": 1000, "us_nhs": 1000, "ca_starts": 1, "ca_whl": 1, "us_ism": 1, "us_ism_svc": 1, "ca_ivey": 1}


def _ffnum(x):
    """'7.20M' -> 7.2 (millions), '245K' -> 245, '0.3%' -> 0.3 — in the feed's own unit; FF_UNIT converts to the desk's."""
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*([KMB%]?)\s*$", str(x or ""))
    if not m:
        return None
    v = float(m.group(1))
    return v * {"K": 1, "M": 1, "B": 1, "%": 1, "": 1}[m.group(2)]


def pmi_calendar(D):
    """Release times for the PMIs: ISM = 1st / 3rd business day 10:00 ET; this week's exact times and the market
    forecast from the public weekly calendar feed (no key)."""
    cal = D.setdefault("release_cal", {})
    t0 = UDC.NOW.astimezone(TOR)
    for key, nth in (("us_ism", 1), ("us_ism_svc", 3)):
        ds = []
        for i in range(-1, 3):
            y, m = t0.year + (t0.month - 1 + i) // 12, (t0.month - 1 + i) % 12 + 1
            ds.append(_bizday(y, m, nth).isoformat() + "T10:00")
        cal[key] = {"dates": ds, "src": "https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/"}
    cons = D.setdefault("macro_cons", {})
    try:
        for e in get("https://nfs.faireconomy.media/ff_calendar_thisweek.json").json():
            key = FF_MAP.get((e.get("country"), e.get("title")))
            if not key:
                continue
            at = datetime.fromisoformat(e["date"]).astimezone(TOR).strftime("%Y-%m-%dT%H:%M")
            c = cal.setdefault(key, {"dates": [], "src": "https://iveypmi.uwo.ca/" if key == "ca_ivey" else "weekly economic calendar (official agency schedules)"})
            if at not in c["dates"]:
                c["dates"] = sorted(set(c["dates"] + [at]))[-6:]
            fc = _ffnum(e.get("forecast"))
            if fc is not None and key in FF_UNIT:
                pv = _ffnum(e.get("previous"))
                cons[key] = {"at": at, "forecast": round(fc * FF_UNIT[key], 2), "previous": None if pv is None else round(pv * FF_UNIT[key], 2)}
    except Exception as e:
        print(f"  pmi calendar: weekly feed unavailable ({type(e).__name__})")


def macro(D, N, only=None):
    """only = set of keys: re-read just those (the fast lane, minutes after a release); the rest are kept as they are."""
    meta = D["meta"]
    last = meta.get("macro_checked")
    if not only and last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=2) and not recent_release(D, "macro"):
        print("  checked <2h ago — skipping")
        return False
    old = {m["key"]: m for m in D.get("macro", [])}
    try:
        if not only:   # the fast lane only re-reads the awaited series
            pmi_calendar(D)
    except Exception as e:
        print(f"  pmi calendar: {type(e).__name__}")
    start = (UDC.NOW - timedelta(days=2650)).date().isoformat()   # ~7 years: 5-yr averages of y/y series
    bls_box = {}
    bls_ok = any(UDC.NOW - timedelta(hours=6) <= datetime.fromisoformat(t).replace(tzinfo=TOR) <= UDC.NOW
                 for k in BLS_SRC for t in ((D.get("release_cal") or {}).get(k, {}).get("dates") or []))   # a BLS release in the last 6 h

    def bls_new_for(key):
        """Lazy, at most one BLS call per run and one per 4 min across runs (keyless v1 = 25 calls/day)."""
        if "j" not in bls_box:
            bls_box["j"] = None
            lastb = meta.get("bls_fast_at")
            if bls_ok and not (lastb and UDC.NOW - datetime.fromisoformat(lastb) < timedelta(minutes=4)):
                meta["bls_fast_at"] = iso(UDC.NOW)
                try:
                    bls_box["j"] = _bls_batch(sorted(set(BLS_SRC.values())))
                except Exception as e:
                    print(f"  BLS fast lane unavailable: {e}")
        return (bls_box["j"] or {}).get(BLS_SRC[key], [])
    out, errs = [], {}
    for key, name, group, src, sid, how, unit, dec, good, (lo, hi) in MACRO:
        if only and key not in only:
            if key in old:
                out.append(old[key])
            continue
        label = {"fred": "FRED", "valet": "Bank of Canada Valet", "statcan": "Statistics Canada", "ism": "ISM Report On Business",
                 "ivey": "Ivey PMI"}[src] + ("" if src in ("ism", "ivey") else f" {sid}")
        try:
            raw = None
            if key in BEA_SRC and BEA_KEY:
                try:
                    raw = _bea(*BEA_SRC[key]) or None
                    label = f"BEA {BEA_SRC[key][0]}"
                    meta["bea_status"] = {"ok": True, "at": iso(UDC.NOW)}
                except Exception as e_bea:
                    print(f"  {key}: {e_bea}; using {label}")
                    meta["bea_status"] = {"ok": False, "at": iso(UDC.NOW), "why": str(e_bea)[:200]}
            if raw is None and src == "valet" and sid in VALET_TO_STATCAN:
                try:
                    raw = _valet_series(sid, 0, start)
                except Exception as e_valet:   # BoC Valet down (e.g. decision-day load): same series straight from StatCan WDS
                    print(f"  {key}: Valet failed ({e_valet}); falling back to StatCan v{VALET_TO_STATCAN[sid]}")
                    raw = _statcan(VALET_TO_STATCAN[sid], 90)
            elif raw is None:
                raw = (_fred(sid, start) if src == "fred" else _ism(sid) if src == "ism" else _ivey(sid) if src == "ivey" else _valet_series(sid, 0, start) if src == "valet" else _statcan(sid, 90))
            prevp = (old.get(key) or {}).get("obs_date") or ""
            if src == "fred" and key in BLS_SRC and bls_ok and raw[-1][0] <= prevp:   # FRED has nothing new yet: ask BLS itself
                got = bls_new_for(key)
                extra = [(d, v) for d, v in got if d > raw[-1][0]]
                if not extra:
                    print(f"  {key}: BLS has nothing newer than {raw[-1][0][:7]} yet ({len(got)} points read)")
                if extra:
                    raw = raw + extra
                    label = "BLS (release) + FRED history"
                    print(f"  {key}: {len(extra)} newer month(s) straight from BLS")
            if prevp and raw[-1][0][:10] < prevp[:10]:   # never step back: a lagging source (FRED before its re-post) cannot replace a newer print
                raise _KeepNewer(f"source still at {raw[-1][0][:10]}; the desk already holds {prevp[:10]}")
            if len(raw) < 3:
                raise RuntimeError("too few points")
            if not all(lo <= v <= hi for _, v in raw[-6:]):
                raise RuntimeError(f"values outside sanity range {lo}-{hi}: {raw[-1][1]} — wrong series id?")
            fq = _freq(raw)
            age = (UDC.NOW.date() - datetime.fromisoformat(raw[-1][0][:10]).date()).days
            if age > {"D": 10, "W": 30, "M": 130, "Q": 250}.get(fq, 130):
                raise RuntimeError(f"latest observation {raw[-1][0]} is {age} days old — discontinued series?")
            pts = _transform(raw, how)
            gap = None
            if how == "yoy" and pts and raw[-1][0][:7] > pts[-1][0][:7]:
                # the agency published a newer month, but its year-earlier index does not exist (e.g. BLS did not collect Oct 2025),
                # so no 12-month change exists for it: keep the latest y/y and say what the new month shows
                pm_ = raw[-2][0][:7]; y_, m_ = int(raw[-1][0][:4]), int(raw[-1][0][5:7]); want_ = f"{y_ - 1}-12" if m_ == 1 else f"{y_}-{m_ - 1:02d}"
                gap = {"period": raw[-1][0][:7], "mm": round((raw[-1][1] / raw[-2][1] - 1) * 100, 1) if pm_ == want_ else None,
                       "why": "no 12-month change is published for this month: the year-earlier index was not collected"}
            if how == "diff" or (unit == "K" and how == "level"):
                pts = [(d, v / 1000 if (how == "level" and src == "fred") else v) for d, v in pts]  # FRED claims are persons -> K
            longp = None
            if True:   # every indicator keeps ~5 years (Macro page 1Y / 2Y / 5Y views); the original MACRO_LONG set kept 6 years
                lp = pts
                if fq == "D":   # daily policy rates -> month-end readings
                    me = {}
                    for d, v in lp:
                        me[d[:7]] = (d, v)
                    lp = [me[m] for m in sorted(me)]
                keep = (24 if fq == "Q" else 72) if key in MACRO_LONG else {"Q": 20, "W": 262, "D": 60}.get(fq, 60)
                longp = [[d[:10], round(v, dec + 1)] for d, v in lp[-keep:]]
            pts_all = pts[-24:]
            pts = pts[-12:]
            if len(pts) < 2:
                raise RuntimeError("too few transformed points")
            val, prv = pts[-1][1], pts[-2][1]
            out.append({"key": key, "name": name, "group": group, "unit": unit, "dec": dec, "good": good,
                        "freq": fq, "measure": {"yoy": "y/y", "diff": "m/m", "pct": "m/m", "level": "", "qann": "", "raw": "", "lvlk": "", "diffk": "m/m"}[how],
                        "period": _label(pts[-1][0], fq), "obs_date": pts[-1][0],
                        "value": round(val, dec + 1), "prior": round(prv, dec + 1), "chg": round(val - prv, dec + 1),
                        "history": [[_label(d, fq), round(v, dec + 1)] for d, v in pts],
                        "src": label})
            if longp:
                out[-1]["long"] = longp
            _track(out[-1], old.get(key), pts_all)
            if not out[-1].get("seen_at"):   # first time on the desk: if its scheduled release just passed, that is when it printed
                for at in sorted((D.get("release_cal") or {}).get(key, {}).get("dates", []), reverse=True):
                    t_ = datetime.fromisoformat(at).replace(tzinfo=TOR)
                    if t_ <= UDC.NOW:
                        if UDC.NOW - t_ < timedelta(hours=36):
                            out[-1]["seen_at"] = iso(t_)
                        break
            if key in ("ca_gdpq", "us_policy", "ca_policy"):
                out[-1]["chart_only"] = True
            if gap:
                out[-1]["gap"] = gap
        except _KeepNewer as e:
            print(f"  {key}: {e} — kept")
            out.append(old[key])
        except Exception as e:
            errs[key] = f"{type(e).__name__}: {e}"[:200]
            if key in old:
                out.append(old[key])  # keep the last good reading
    if not out:
        raise RuntimeError(f"all macro series failed: {errs}")
    D["macro"] = out
    for m in out:
        c = (D.get("macro_cons") or {}).get(m["key"])
        if c:
            m["cons"] = c
        else:
            m.pop("cons", None)
    if only:
        meta["asof"]["macro"] = iso(UDC.NOW)
        print(f"  macro (fast, {sorted(only)}): {len(only) - len(errs)} fresh, failed {list(errs)}")
        return True
    # a failed chart series retries on the next 15-min run instead of waiting the full 2 h
    meta["macro_checked"] = iso(UDC.NOW - timedelta(minutes=105)) if any(k in MACRO_LONG for k in errs) else iso(UDC.NOW)
    meta["asof"]["macro"] = iso(UDC.NOW)
    if errs:
        meta["macro_errors"] = errs
    else:
        meta.pop("macro_errors", None)
    print(f"  macro: {len(out) - len(errs)} fresh, {len(errs)} failed {list(errs)}")
    return True


# ------------------------------------------------------------------ trade & fiscal balances (US vs Canada)
EXT_FRED = [("us_trade_bal", "BOPGSTB"), ("us_exports", "BOPTEXP"), ("us_imports", "BOPTIMP"), ("us_deficit", "MTSDS133FMS"),
            ("us_goods_bal", "BOPGTB"), ("us_serv_bal", "BOPSTB"), ("us_receipts", "MTSR133FMS"), ("us_outlays", "MTSO133FMS")]
MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _ca_trade():
    """Canada merchandise trade, balance-of-payments basis, seasonally adjusted, all countries (StatCan 12-10-0011-01), C$ millions."""
    acc, dims = {}, {"trade": set(), "basis": set(), "sa": set(), "partner": set()}
    for row in _sc_table(12100011):
        if row.get("GEO") != "Canada":
            continue
        tr, ba, sa = row.get("Trade", ""), row.get("Basis", ""), row.get("Seasonal adjustment", "")
        pa = row.get("Principal trading partners", "")
        dims["trade"].add(tr); dims["basis"].add(ba); dims["sa"].add(sa); dims["partner"].add(pa)
        if "balance of payments" not in ba.lower() or not sa.lower().startswith("seasonally adjusted") or pa.lower() not in ("all countries", "united states"):
            continue
        t = tr.lower()
        key = "bal" if "balance" in t else "imp" if t.startswith("import") else "exp" if ("total export" in t or t == "export") else None
        if key and pa.lower() == "united states":
            key = key + "_us"
        v = _num(row.get("VALUE"))
        if key and v is not None:
            acc.setdefault(key, {})[row["REF_DATE"][:7]] = v
    if not acc.get("exp") or not acc.get("imp"):
        raise RuntimeError(f"Canada trade: no export/import lines; dims {{k: sorted(v)[:12] for k, v in dims.items()}}"[:600])
    if not acc.get("bal"):
        acc["bal"] = {m: acc["exp"][m] - acc["imp"][m] for m in acc["exp"] if m in acc["imp"]}
    return {k: sorted(v.items())[-30:] for k, v in acc.items() if v}


def _ca_fiscal(old):
    """Federal budgetary balance by month from Finance Canada's Fiscal Monitor pages (C$ billions; + surplus, - deficit)."""
    mon = dict((old or {}).get("monthly") or [])
    ytd = (old or {}).get("ytd")
    found = 0
    for back in range(1, 27):
        y, m = UDC.NOW.year, UDC.NOW.month - back
        while m <= 0:
            m += 12; y -= 1
        key = f"{y}-{m:02d}"
        if key in mon and back > 4 and key in ((old or {}).get("components") or {}):
            continue
        try:
            r_ = requests.get(f"https://www.canada.ca/en/department-finance/services/publications/fiscal-monitor/{y}/{m:02d}.html", headers=UA, timeout=25)
            if r_.status_code != 200:
                continue
            txt = _strip_html(r_.text)
        except Exception:
            continue
        pats = [(r"budgetary (surplus|deficit) of \$([\d.,]+) (billion|million) in (\w+) (\d{4})", True),
                (r"compared to a (surplus|deficit) of \$([\d.,]+) (billion|million) in (\w+) (\d{4})", False)]
        for pat, overwrite in pats:
            for sign_word, amt, unit, mname, yy in re.findall(pat, txt):
                if mname not in MONTHS_FULL:
                    continue
                k2 = f"{yy}-{MONTHS_FULL.index(mname) + 1:02d}"
                if overwrite or k2 not in mon:
                    mon[k2] = round((1 if sign_word == "surplus" else -1) * float(amt.replace(",", "")) * (1 if unit == "billion" else 0.001), 3)
                    found += 1
        comp = _fm_components(r_.text)
        if comp:
            cm = (old or {}).get("components") or {}
            cm.update(comp)
            old = dict(old or {}); old["components"] = cm
        if back <= 3:
            notes = [x.strip() for x in re.findall(r"((?:Revenues|Program expenses|Public debt charges)[^.]{10,260}\.)", txt)][:3]
            if notes and not (old or {}).get("notes_ref", "") > key:
                old = dict(old or {}); old["notes"] = notes; old["notes_ref"] = key
        mt = re.search(r"posted a budgetary (surplus|deficit) of \$([\d.,]+) (billion|million) for the (April to \w+) period of the (\d{4}-\d{2}) fiscal year", txt)
        if mt and (not ytd or key >= ytd.get("ref", "")):
            v = float(mt.group(2).replace(",", "")) * (1 if mt.group(3) == "billion" else 0.001)
            pr = re.search(r"compared to a (surplus|deficit) of \$([\d.,]+) (billion|million) (?:reported )?for the same period", txt)
            pv = (float(pr.group(2).replace(",", "")) * (1 if pr.group(3) == "billion" else 0.001) * (1 if pr.group(1) == "surplus" else -1)) if pr else None
            ytd = {"ref": key, "period": mt.group(4) + " " + mt.group(5), "value": round((1 if mt.group(1) == "surplus" else -1) * v, 3), "prior": pv}
    if not mon:
        raise RuntimeError("no Fiscal Monitor pages parsed")
    return {"monthly": sorted(mon.items())[-30:], "ytd": ytd, "parsed": found,
            "components": dict(sorted(((old or {}).get("components") or {}).items())[-30:]),
            "notes": (old or {}).get("notes"), "notes_ref": (old or {}).get("notes_ref")}


def _fm_components(html):
    """Monthly revenues / program expenses / public debt charges / actuarial losses (C$ billions, expenses positive) from the
    Fiscal Monitor 'Summary statement of transactions'. Header is split in two rows: month name (e.g. 'June') above the years
    ('2025' | '2026' | '2025-26' | '2026-27'); data columns = [month prior yr, month current yr, YTD prior, YTD current]."""
    import html as _h
    out = {}
    for tb in re.findall(r"(?is)<table.*?</table>", html):
        rows = []
        for tr in re.findall(r"(?is)<tr.*?</tr>", tb):
            cells = [re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"(?is)<t[hd][^>]*>(.*?)</t[hd]>", tr)]
            if cells:
                rows.append(cells)
        if not any(c and c[0].lower().startswith("budgetary balance (deficit") for c in rows):
            continue
        head = " ".join(" ".join(c) for c in rows[:3]) + " " + _strip_html(tb[:500])
        mname = next((m_ for m_ in re.findall(r"(January|February|March|April|May|June|July|August|September|October|November|December)", head)), None)
        years = [int(y) for y in re.findall(r"\b(20\d\d)\b(?!-)", head)]
        if not mname or not years:
            continue
        cur_y = max(years)
        rec_c, rec_p = {}, {}
        for c in rows:
            lab = c[0].lower()
            nums = [_num(x.replace(",", "").replace("\u2212", "-").replace("\u2013", "-")) for x in c[1:]]
            k = ("rev" if lab.startswith("revenues") else "prog" if lab.startswith("program expenses") else
                 "debt" if lab.startswith("public debt charges") else "act" if lab.startswith("net actuarial") else
                 "bal" if lab.startswith("budgetary balance (deficit") else None)
            if not k or len(nums) < 2:
                continue
            for rec, v in ((rec_p, nums[0]), (rec_c, nums[1])):
                if v is not None and k not in rec:
                    rec[k] = round((abs(v) if k in ("prog", "debt", "act") else v) / 1000, 3)
        mi = MONTHS_FULL.index(mname) + 1
        if "rev" in rec_c and "bal" in rec_c:
            out[f"{cur_y}-{mi:02d}"] = rec_c
        if "rev" in rec_p and "bal" in rec_p:
            out[f"{cur_y - 1}-{mi:02d}"] = rec_p
        break
    return out


def external(D, N):
    meta = D["meta"]
    last = meta.get("ext_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6) and D.get("ext"):
        print("  checked <6h ago — skipping")
        return False
    old = D.get("ext") or {}
    X, errs = {}, {}
    start = (UDC.NOW - timedelta(days=31 * 30)).date().isoformat()
    for key, sid in EXT_FRED:
        try:
            pts = _fred(sid, start)
            X[key] = {"src": f"FRED {sid}", "pts": [[d[:7], round(v / 1000, 3)] for d, v in pts][-30:]}   # $ millions -> $ billions
        except Exception as e:
            errs[key] = f"{type(e).__name__}: {e}"[:200]
    try:
        ct = _ca_trade()
        for k, nm in (("bal", "ca_trade_bal"), ("exp", "ca_exports"), ("imp", "ca_imports"), ("exp_us", "ca_exports_us"), ("imp_us", "ca_imports_us"), ("bal_us", "ca_trade_bal_us")):
            if k not in ct:
                continue
            X[nm] = {"src": "Statistics Canada 12-10-0011-01 (BOP basis, SA)", "pts": [[d, round(v / 1000, 3)] for d, v in ct[k]]}
    except Exception as e:
        errs["ca_trade"] = f"{type(e).__name__}: {e}"[:600]
    try:
        cf = _ca_fiscal(old.get("ca_fiscal"))
        X["ca_fiscal"] = cf
    except Exception as e:
        errs["ca_fiscal"] = f"{type(e).__name__}: {e}"[:200]
    for k, v in old.items():
        if k not in X and k not in ("errors",):
            X[k] = v
    X["errors"] = errs
    D["ext"] = X
    meta["ext_checked"] = iso(UDC.NOW - timedelta(hours=5, minutes=45)) if errs else iso(UDC.NOW)
    meta["asof"]["ext"] = iso(UDC.NOW)
    print("  ext:", sorted(k for k in X if k != "errors"), "errors", errs)
    return True


# ------------------------------------------------------------------ Canada / Ontario (Statistics Canada)
SC_CROP = {"corn": r"^corn for grain", "soybeans": r"^soybeans?$|^soybeans? \[", "wheat": r"^wheat, all"}
SC_PRICE = {"corn": r"^corn", "soybeans": r"^soybean", "wheat": r"^(ontario )?(winter )?wheat(?!.*including payments)"}
SC_GEOS = ("Ontario", "Canada")


def _sc_table(pid):
    """Stream a full StatCan table (CSV inside a zip) row by row as dicts."""
    import zipfile
    j = get(f"https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/{pid}/en").json()
    url = j.get("object") if isinstance(j, dict) else None
    if not url:
        raise RuntimeError(f"StatCan {pid}: no download URL ({str(j)[:120]})")
    r_ = requests.get(url, headers=UA, timeout=180)
    r_.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r_.content))
    name = next(n for n in z.namelist() if n.endswith(".csv") and "MetaData" not in n)
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def _sc_release_times():
    """Latest release timestamp of each StatCan table we track (cheap metadata call) — a change means new data."""
    out = {}
    try:
        r_ = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata", headers={**UA, "Content-Type": "application/json"},
                           data=json.dumps([{"productId": p} for p in (32100359, 32100077, 32100007)]), timeout=25)
        r_.raise_for_status()
        for o in r_.json():
            ob = o.get("object") or {}
            if o.get("status") == "SUCCESS" and ob.get("productId"):
                out[str(ob["productId"])] = ob.get("releaseTime")
    except Exception as e:
        print("  StatCan metadata check failed:", e)
    return out


AAFC_INDEX = "https://agriculture.canada.ca/en/sector/crops/reports-statistics"
_MDY = r"((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d)"


def _strip_html(h):
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style).*?</\1>", " ", h))))


def ca_calendar(D, N):
    """Canada/Ontario agri calendar from AAFC's latest 'Outlook for Principal Field Crops': its next release date,
    the Statistics Canada releases it announces, and the Chatham (Ontario) corn/soybean price forecasts."""
    meta = D["meta"]
    last = meta.get("ca_calendar_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago — skipping")
        return False
    idx = get(AAFC_INDEX).text
    links = sorted(set(re.findall(r'href="([^"]*canada-outlook-principal-field-crops-(20\d\d-\d\d-\d\d))"', idx)), key=lambda x: x[1])
    if not links:
        raise RuntimeError("no Outlook links on the AAFC index page")
    href, rdate = links[-1]
    url = href if href.startswith("http") else "https://agriculture.canada.ca" + href
    txt = _strip_html(get(url).text)
    ev = []
    m = re.search(r"next AAFC Outlook for Principal Field Crops is scheduled for release on " + _MDY, txt)
    if m:
        ev.append({"date": datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat(), "time": None, "src": "AAFC",
                   "label": "AAFC Outlook for Principal Field Crops", "tables": [], "quote": m.group(0)[:200]})
    for s_ in re.split(r"(?<=[.!?])\s+", txt):
        if not re.search(r"\bSTC\b|Statistics Canada", s_) or not re.search(_MDY, s_):
            continue
        for dm in re.findall(_MDY, s_):
            d = datetime.strptime(dm, "%B %d, %Y").date()
            if d < (UDC.NOW - timedelta(days=1)).date():
                continue
            low = s_.lower()
            lab = ("StatCan model-based crop estimates" if "model" in low else
                   "StatCan field crop production (survey)" if "production" in low else
                   "StatCan stocks of principal field crops" if "stock" in low else
                   "StatCan field crop areas" if "area" in low or "seeding" in low else "Statistics Canada field-crop release")
            tables = ["32100359"] if re.search(r"production|model|area", low) else ["32100007"] if "stock" in low else []
            ev.append({"date": d.isoformat(), "time": "08:30", "src": "Statistics Canada", "label": lab, "tables": tables, "quote": s_.strip()[:240]})
    prices = {}
    mc = re.search(r"Chatham average corn price is projected at \$(\d+)\s*/\s*t", txt)
    if mc:
        prices["corn"] = int(mc.group(1))
    ms = re.findall(r"soybean price forecast, track Chatham, (?:is|was)[a-z ]*? (?:to|at) \$(\d+)\s*/\s*t", txt)
    if ms:
        prices["soybeans"] = int(ms[-1])
    seen, uniq = set(), []
    for e in sorted(ev, key=lambda e: e["date"]):
        k = (e["date"], e["label"])
        if k not in seen:
            seen.add(k); uniq.append(e)
    old = D.get("ca_calendar") or {}
    keep = [e for e in old.get("events", []) if e.get("date", "") >= (UDC.NOW - timedelta(days=1)).date().isoformat() and (e["date"], e["label"]) not in seen]
    D["ca_calendar"] = {"events": sorted(uniq + keep, key=lambda e: e["date"]), "report": rdate, "report_url": url,
                        "chatham": prices or old.get("chatham", {}), "chatham_report": rdate if prices else old.get("chatham_report")}
    meta["ca_calendar_checked"] = iso(UDC.NOW)
    meta["asof"]["ca_calendar"] = iso(UDC.NOW)
    print(f"  ca_calendar: report {rdate}, {len(uniq)} new dates, chatham {prices}")
    return True


def _num0(x):
    v = _num(x)
    return v


def canada(D, N):
    meta = D["meta"]
    last = meta.get("canada_checked")
    rel_old = meta.get("canada_release", {})
    rel_new = _sc_release_times()
    changed = [k for k, v in rel_new.items() if v and v != rel_old.get(k)]
    if rel_new:
        meta["canada_watch"] = iso(UDC.NOW)
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=20) and not changed:
        print("  no new StatCan release since", last, "— skipping")
        return False
    if changed:
        print("  new StatCan release detected:", changed)
        meta["canada_new_release"] = {"tables": changed, "at": iso(UDC.NOW)}
    C = D.setdefault("canada", {})
    seen = {"crops": set(), "disp": set(), "prices": set(), "stocks": set(), "stock_kinds": set()}
    errs = []
    # ---- annual area / yield / production / price (32-10-0359-01) ----
    try:
        acc = {}
        for row in _sc_table(32100359):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            crop, disp = row.get("Type of crop", ""), row.get("Harvest disposition", "")
            seen["crops"].add(crop); seen["disp"].add(disp)
            for k, pat in SC_CROP.items():
                if re.search(pat, crop.strip().lower()):
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        acc.setdefault(k, {}).setdefault(geo, {}).setdefault(disp, {})[row["REF_DATE"][:4]] = v
        MEAS = {"seeded_ac": r"^seeded area \(acres", "harv_ac": r"^harvested area \(acres", "seeded_ha": r"^seeded area \(hectares",
                "harv_ha": r"^harvested area \(hectares", "yield_bu": r"^average yield \(bushels", "yield_kg": r"^average yield \(kilograms",
                "prod_bu": r"^production \(bushels", "prod_t": r"^production \(metric", "price_t": r"^average farm price \(dollars per tonne\)", "value": r"^total farm value"}
        for k, geos in acc.items():
            for geo, disps in geos.items():
                years = sorted({y for d in disps.values() for y in d})[-16:]
                out = {"years": years}
                for key, pat in MEAS.items():
                    src = next((d for name, d in disps.items() if re.search(pat, name.strip().lower())), None)
                    out[key] = [src.get(y) if src else None for y in years]
                C.setdefault(k, {}).setdefault("annual", {})[geo] = out
        if not acc:
            raise RuntimeError("no matching crops")
    except Exception as e:
        errs.append(f"32100359: {e} | crops seen: {sorted(seen['crops'])[:40]} | disp: {sorted(seen['disp'])[:30]}")
    # ---- monthly farm prices (32-10-0077-01) ----
    try:
        pr = {}
        for row in _sc_table(32100077):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            prod = (row.get("Farm products") or "").strip()
            seen["prices"].add(prod)
            for k, pat in SC_PRICE.items():
                pl = prod.lower()
                if k == "wheat" and "durum" in pl and "except durum" not in pl:
                    continue   # durum is a western crop; Ontario wheat is "Wheat (except durum wheat)"
                if re.search(pat, pl) and "dollars per metric tonne" in (row.get("UOM") or "").lower():
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        pr.setdefault(k, {}).setdefault(geo, {}).setdefault(prod, {})[row["REF_DATE"][:7]] = v
        for k, geos in pr.items():
            for geo, prods in geos.items():
                best = max(prods.items(), key=lambda kv: max(kv[1]))     # the product line with the latest data
                ser = sorted(best[1].items())[-36:]
                C.setdefault(k, {}).setdefault("prices", {})[geo] = {"product": best[0], "series": ser}
        if not pr:
            raise RuntimeError("no matching price series")
    except Exception as e:
        errs.append(f"32100077: {e} | products seen: {sorted(seen['prices'])[:40]}")
    # ---- stocks (32-10-0007-01) ----
    try:
        st = {}
        for row in _sc_table(32100007):
            geo = row.get("GEO", "")
            if geo not in SC_GEOS:
                continue
            crop = (row.get("Type of crop") or "").strip()
            kind = next((row[c] for c in row if c not in ("REF_DATE", "GEO", "DGUID", "UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID", "VECTOR",
                                                          "COORDINATE", "VALUE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS", "Type of crop")), "")
            seen["stocks"].add(crop); seen["stock_kinds"].add(kind)
            for k, pat in SC_CROP.items():
                if re.search(pat, crop.lower()):
                    v = _num(row.get("VALUE"))
                    if v is not None:
                        st.setdefault(k, {}).setdefault(geo, {}).setdefault(row["REF_DATE"][:7], {})[kind] = v
        for k, geos in st.items():
            for geo, dates in geos.items():
                C.setdefault(k, {}).setdefault("stocks", {})[geo] = [[d, v] for d, v in sorted(dates.items())[-9:]]
        if not st:
            raise RuntimeError("no matching stocks")
    except Exception as e:
        errs.append(f"32100007: {e} | crops: {sorted(seen['stocks'])[:30]} | kinds: {sorted(seen['stock_kinds'])[:20]}")
    meta["canada_dims"] = {"disp": sorted(seen["disp"])[:30], "prices_on": sorted(
        p for p in seen["prices"] if re.search(r"wheat|corn|soy", p.lower()))[:30]}
    if errs:
        meta["canada_errors"] = errs
    else:
        meta.pop("canada_errors", None)
    if not C:
        raise RuntimeError("; ".join(errs)[:1100])
    meta["canada_checked"] = iso(UDC.NOW)
    meta["asof"]["canada"] = iso(UDC.NOW)
    if rel_new:
        meta["canada_release"] = {**rel_old, **{k: v for k, v in rel_new.items() if v}}
    print("  canada:", {k: list(v) for k, v in C.items()}, "errors:", len(errs))
    return True



def policy_watch(D, N):
    """Central-bank decisions (BoC, Fed): adopt the fast lane's earliest sighting from live.json, then check the
    official statement directly if a decision is in its 3-hour window."""
    import policy_watch as PW
    PW.TOR = TOR
    try:
        r_ = requests.get("https://raw.githubusercontent.com/anirudhpdoshi/AGRITrade/live/live.json", headers=UA, timeout=20)
        if r_.ok:
            pw = ((r_.json().get("rel") or {}).get("policy_watch") or {}).get("set", {}).get("policy_watch")
            PW.merge(D, pw)
    except Exception as e:
        print("  live.json carry-over skipped:", e)
    if PW.watch(D, UDC.NOW, TOR):
        D["meta"]["asof"]["policy_watch"] = iso(UDC.NOW)


def cpi_detail(D, N):
    """US CPI internals by category (BLS CPI-U items; scripts/cpi_detail.py). m/m from the seasonally adjusted index, 12-month from the
    unadjusted one, as BLS publishes them. Fetched only when a CPI release has landed that the desk does not hold yet (5 keyless BLS calls),
    retried at most every 20 min; otherwise the stored month is kept."""
    from cpi_detail import CPI_ITEMS
    C = D.get("cpi_detail") or {}
    rel = [datetime.fromisoformat(t).replace(tzinfo=TOR) for t in ((D.get("release_cal") or {}).get("us_cpi", {}).get("dates") or [])]
    landed = [t for t in rel if t <= UDC.NOW]
    want = None
    if landed:
        r = max(landed); y, m = (r.year, r.month - 1) if r.month > 1 else (r.year - 1, 12); want = f"{y}-{m:02d}"
    if C.get("month") and C.get("v") == 2 and (want is None or C["month"] >= want):   # v2: changes matched by date
        return
    if C.get("tried") and C.get("v") == 2 and UDC.NOW - datetime.fromisoformat(C["tried"]) < timedelta(minutes=20):
        return
    C["tried"] = UDC.NOW.isoformat(timespec="seconds"); D["cpi_detail"] = C
    ids = [p + c for c, _, _ in CPI_ITEMS for p in ("CUSR0000", "CUUR0000")]
    got = {}
    step = 50 if BLS_KEY else 25
    for i in range(0, len(ids), step):
        got.update(_bls_batch(ids[i:i + step]))
    items, month = [], None
    for c, name, grp in CPI_ITEMS:
        sa, nsa = dict(got.get("CUSR0000" + c) or []), dict(got.get("CUUR0000" + c) or [])
        ks, kn = sorted(sa), sorted(nsa)
        if len(ks) < 2:
            continue
        sam = {k[:7]: v for k, v in sa.items()}
        def prevm(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
        # one rounding from the published 3-decimal indexes, as BLS does; by date — a month after a gap (Oct 2025 not collected) has no 1-month change
        mm = [(m, round((sam[m] / sam[prevm(m)] - 1) * 100, 1) if prevm(m) in sam else None) for m in sorted(sam)][1:][-13:]
        nsm = {k[:7]: v for k, v in nsa.items()}
        def ago(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-{mo:02d}"
        yy = [(m, round((nsm[m] / nsm[ago(m)] - 1) * 100, 1) if ago(m) in nsm else None) for m in sorted(nsm)][-13:]   # None: year-earlier index not published
        month = max(month or "", mm[-1][0])
        items.append({"c": c, "n": name, "g": grp, "mm": [v for _, v in mm], "yy": [v for _, v in yy], "m": [d for d, _ in mm], "ym": [d for d, _ in yy]})
    if not items:
        raise RuntimeError("BLS returned no CPI category series")
    D["cpi_detail"] = {"v": 2, "month": month, "asof": UDC.NOW.isoformat(timespec="seconds"), "items": items,
                       "src": "https://www.bls.gov/cpi/", "note": "CPI-U. m/m seasonally adjusted; 12-month not seasonally adjusted."}
    print(f"  cpi_detail: {len(items)} categories for {month}")


def cpi_detail_ca(D, N):
    """Canada CPI internals by category (StatCan 18-10-0004-01, NSA; scripts/cpi_detail.py CA_ITEMS). Fetched when a Canada CPI release has landed
    that the desk does not hold yet (one WDS call), retried at most every 20 min."""
    from cpi_detail import CA_ITEMS
    C = D.get("cpi_detail_ca") or {}
    rel = [datetime.fromisoformat(t).replace(tzinfo=TOR) for t in ((D.get("release_cal") or {}).get("ca_cpi", {}).get("dates") or [])]
    landed = [t for t in rel if t <= UDC.NOW]
    want = None
    if landed:
        r = max(landed); y, m = (r.year, r.month - 1) if r.month > 1 else (r.year - 1, 12); want = f"{y}-{m:02d}"
    if C.get("month") and C.get("v") == 2 and (want is None or C["month"] >= want):   # v2: changes matched by date
        return
    if C.get("tried") and C.get("v") == 2 and UDC.NOW - datetime.fromisoformat(C["tried"]) < timedelta(minutes=20):
        return
    C["tried"] = UDC.NOW.isoformat(timespec="seconds"); D["cpi_detail_ca"] = C
    body = [{"productId": 18100004, "coordinate": f"2.{m}.0.0.0.0.0.0.0.0", "latestN": 27} for m, _, _ in CA_ITEMS]
    r = requests.post("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods",
                      headers={**UA, "Content-Type": "application/json"}, data=json.dumps(body), timeout=40)
    r.raise_for_status()
    got = {}
    for o in r.json():
        if o.get("status") != "SUCCESS":
            continue
        ob = o["object"]; mem = int(ob["coordinate"].split(".")[1])
        got[mem] = sorted((p["refPer"][:7], float(p["value"])) for p in ob.get("vectorDataPoint", []) if _num(p.get("value")) is not None)
    items, month = [], None
    for mem, name, grp in CA_ITEMS:
        pts = got.get(mem) or []
        if len(pts) < 14:
            continue
        pm = dict(pts)
        def prevm2(m):
            y, mo = int(m[:4]), int(m[5:7]); return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"
        mm = [(m, round((pm[m] / pm[prevm2(m)] - 1) * 100, 1) if prevm2(m) in pm else None) for m in sorted(pm)][1:][-13:]
        yy = [(m, round((pm[m] / pm[f"{int(m[:4]) - 1}{m[4:]}"] - 1) * 100, 1) if f"{int(m[:4]) - 1}{m[4:]}" in pm else None) for m in sorted(pm)][-13:]
        month = max(month or "", mm[-1][0])
        items.append({"c": str(mem), "n": name, "g": grp, "mm": [v for _, v in mm], "yy": [v for _, v in yy], "m": [d for d, _ in mm], "ym": [d for d, _ in yy]})
    if not items:
        raise RuntimeError("StatCan returned no CPI category series")
    D["cpi_detail_ca"] = {"v": 2, "month": month, "asof": UDC.NOW.isoformat(timespec="seconds"), "items": items,
                          "src": "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401",
                          "note": "Statistics Canada CPI, not seasonally adjusted (both 1-month and 12-month)."}
    print(f"  cpi_detail_ca: {len(items)} categories for {month}")


def release_hist(D, N):
    """Past release dates per indicator, for 'Markets around this release' (chunk 6): the official 2026 schedules
    (scripts/release_hist_seed.json: BLS, BEA, Statistics Canada) plus every release_cal date that has passed since."""
    seed = json.loads((Path(__file__).parent / "release_hist_seed.json").read_text())
    H = {k: set(v) for k, v in (D.get("release_hist") or {}).items() if isinstance(v, list)}
    for k, v in seed.items():
        if not k.startswith("_"):
            H.setdefault(k, set()).update(v)
    now = datetime.now(TOR).strftime("%Y-%m-%dT%H:%M")
    for k, c in (D.get("release_cal") or {}).items():
        for x in (c.get("dates") or []) if isinstance(c, dict) else []:
            if x <= now:
                H.setdefault(k, set()).add(x)
    D["release_hist"] = {k: sorted(v)[-24:] for k, v in H.items()}
