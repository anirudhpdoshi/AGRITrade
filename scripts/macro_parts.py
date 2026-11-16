"""Internals of a macro print: the official component series behind a headline, so the desk's Full history card can say
what pushed the number up or down (month-on-month and year-on-year, latest vs the period before).

Source: FRED re-posts of the official BLS / BEA / Census / Federal Reserve component series (fredgraph.csv, no key).
CPI internals live in cpi_detail / cpi_detail_ca (BLS and Statistics Canada) and are not repeated here.

Stored as DATA.macro_parts[<macro key>] = {asof, parent, kind, unit, src, items: [{n, id, m: [dates], v: [levels], mm: [...], yy: [...]}]}
kind: "pct" = % change of an index or $ level; "diff" = change in a level (jobs in thousands, units); "pp" = the series is already
a contribution or a rate, so changes are in percentage points.
Fetched only when the headline has a newer period than the stored internals (or none are stored), retried at most every 6 hours.
A component FRED cannot serve is left out; nothing is estimated.
"""
from datetime import datetime, timedelta, timezone

import ud_common as UDC
from ud_common import _fred

PARTS = {
    "us_nfp": ("diff", "K jobs", "BLS Current Employment Statistics by industry", [
        ("Construction", "USCONS"), ("Manufacturing", "MANEMP"), ("Mining & logging", "USMINE"), ("Trade, transport & utilities", "USTPU"),
        ("Information", "USINFO"), ("Financial activities", "USFIRE"), ("Professional & business services", "USPBS"),
        ("Education & health", "USEHS"), ("Leisure & hospitality", "USLAH"), ("Other services", "USSERV"), ("Government", "USGOVT")]),
    "us_ur": ("pp", "%", "BLS alternative measures of labour underutilization (U-1 to U-6)", [
        ("U-1 long-term unemployed", "U1RATE"), ("U-2 job losers", "U2RATE"), ("U-4 + discouraged", "U4RATE"),
        ("U-5 + marginally attached", "U5RATE"), ("U-6 + part-time for economic reasons", "U6RATE")]),
    "us_retail": ("pct", "$", "Census retail sales by kind of business", [
        ("Motor vehicles & parts", "RSMVPD"), ("Gasoline stations", "RSGASS"), ("Food services & drinking", "RSFSDP"), ("Nonstore (online)", "RSNSR"),
        ("General merchandise", "RSGMS"), ("Grocery stores", "RSGCS"), ("Health & personal care", "RSHPCS"), ("Building materials & garden", "RSBMGESD"),
        ("Clothing & accessories", "RSCCAS"), ("Furniture & home furnishings", "RSFHFS"), ("Electronics & appliances", "RSEAS"),
        ("Sporting goods, hobby, music & books", "RSSGHBMS"), ("Miscellaneous stores", "RSMSR")]),
    "us_gdp": ("pp", "pp of GDP growth", "BEA contributions to percent change in real GDP", [
        ("Consumer spending", "DPCERY2Q224SBEA"), ("Business & housing investment", "A006RY2Q224SBEA"),
        ("Net exports", "A019RY2Q224SBEA"), ("Government", "A822RY2Q224SBEA")]),
    "us_core_pce": ("pct", "index", "BEA PCE price indexes by type", [
        ("Goods", "DGDSRG3M086SBEA"), ("Services", "DSERRG3M086SBEA"), ("Food", "DFXARG3M086SBEA"), ("Energy", "DNRGRG3M086SBEA"),
        ("Core (ex food & energy)", "PCEPILFE")]),
    "us_pce": ("pct", "index", "BEA PCE price indexes by type", [
        ("Goods", "DGDSRG3M086SBEA"), ("Services", "DSERRG3M086SBEA"), ("Food", "DFXARG3M086SBEA"), ("Energy", "DNRGRG3M086SBEA"),
        ("Core (ex food & energy)", "PCEPILFE")]),
    "us_pspend": ("pct", "$", "BEA personal consumption expenditures by type", [
        ("Durable goods", "PCEDG"), ("Nondurable goods", "PCEND"), ("Services", "PCES")]),
    "us_pinc": ("pct", "$", "BEA personal income by source", [
        ("Wages & salaries", "A576RC1"), ("Proprietors' income", "A041RC1"), ("Rental income", "A048RC1"),
        ("Interest & dividends", "PIROA"), ("Government transfers", "PCTR")]),
    "us_ppi": ("pct", "index", "BLS producer prices for final demand", [
        ("Final demand goods", "PPIFDG"), ("Final demand services", "PPIFDS"), ("Final demand construction", "PPIFDC")]),
    "us_indpro": ("pct", "index", "Federal Reserve industrial production by industry and market group", [
        ("Manufacturing", "IPMAN"), ("Mining", "IPMINE"), ("Utilities", "IPUTIL"), ("Consumer goods", "IPCONGD"),
        ("Business equipment", "IPBUSEQ"), ("Materials", "IPMAT")]),
    "us_durable": ("pct", "$", "Census durable-goods orders", [
        ("Ex transportation", "ADXTNO"), ("Core capital goods (nondefence ex aircraft)", "NEWORDER"), ("Transportation equipment", "A36SNO")]),
    "us_factory": ("pct", "$", "Census factory orders", [("Durable goods", "DGORDER"), ("Nondurable goods", "AMNMNO")]),
    "us_starts": ("pct", "units", "Census housing starts by type and region", [
        ("Single-family", "HOUST1F"), ("5+ units", "HOUST5F"), ("Northeast", "HOUSTNE"), ("Midwest", "HOUSTMW"), ("South", "HOUSTS"), ("West", "HOUSTW")]),
    "us_permits": ("pct", "units", "Census building permits by type and region", [
        ("Single-family", "PERMIT1"), ("5+ units", "PERMIT5"), ("Northeast", "PERMITNE"), ("Midwest", "PERMITMW"), ("South", "PERMITS"), ("West", "PERMITW")]),
    "us_jolts": ("diff", "K", "BLS JOLTS labour-market flows", [
        ("Job openings", "JTSJOL"), ("Hires", "JTSHIL"), ("Quits", "JTSQUL"), ("Layoffs & discharges", "JTSLDL"), ("Total separations", "JTSTSL")]),
    "us_import": ("pct", "index", "BLS import price indexes", [("All imports", "IR"), ("Ex fuels", "IREXFUELS"), ("Fuels", "IR10000")]),
}


def _ago(d, k):
    y, m = int(d[:4]), int(d[5:7]) - k
    while m <= 0:
        y, m = y - 1, m + 12
    return f"{y}-{m:02d}"


def changes(points, kind, per_year):
    """points [(iso, value)] oldest->newest -> (dates, values, mm, yy) for the last 13 periods; matched by date, a gap gives None"""
    by = {d[:7]: v for d, v in points}
    step = 12 // per_year

    def ch(a, b):
        if a is None or b is None:
            return None
        if kind == "pct":
            return round((a / b - 1) * 100, 2) if b else None
        return round(a - b, 3)
    keys = sorted(by)[-13:]
    mm = [ch(by[k], by.get(_ago(k + "-01", step))) for k in keys]
    yy = [ch(by[k], by.get(_ago(k + "-01", 12))) for k in keys]
    return keys, [by[k] for k in keys], mm, yy


def macro_parts(D, N):
    P = D.setdefault("macro_parts", {})
    heads = {m["key"]: m for m in (D.get("macro") or [])}
    now = UDC.NOW
    start = (now - timedelta(days=800)).date().isoformat()
    done = 0
    for key, (kind, unit, src, comps) in PARTS.items():
        h = heads.get(key)
        if not h:
            continue
        cur = P.get(key) or {}
        if cur.get("parent") == h.get("obs_date") and cur.get("items"):
            continue
        if cur.get("tried") and now - datetime.fromisoformat(cur["tried"]) < timedelta(hours=6):
            continue
        items = []
        for name, sid in comps:
            try:
                pts = _fred(sid, start)
            except Exception as e:
                print(f"  macro_parts {key}: {sid} skipped ({type(e).__name__})")
                continue
            if len(pts) < 3:
                continue
            per_year = 4 if (datetime.fromisoformat(pts[-1][0]) - datetime.fromisoformat(pts[-2][0])).days > 80 else 12
            m, v, mm, yy = changes(pts, kind, per_year)
            items.append({"n": name, "id": sid, "m": m, "v": v, "mm": mm, "yy": yy})
        if not items:
            P[key] = {**cur, "tried": now.isoformat(timespec="seconds")}
            continue
        P[key] = {"asof": now.isoformat(timespec="seconds"), "parent": h.get("obs_date"), "kind": kind, "unit": unit,
                  "src": src + " (via FRED, St. Louis Fed)", "items": items}
        done += 1
        print(f"  macro_parts {key}: {len(items)}/{len(comps)} components to {items[0]['m'][-1]}")
    if not done:
        print("  macro_parts: up to date")
