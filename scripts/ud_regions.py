"""Regional macro blocks (owner, Nov 18 2026): US state payrolls, unemployment and jobs by industry for the Macro map.

Source: BLS Current Employment Statistics (state, seasonally adjusted) and Local Area Unemployment Statistics, read
through FRED's public CSV endpoint (no key). Every value is the published figure for that month; a series FRED does not
carry for a state (e.g. mining is combined with construction in some states) is simply absent.
"""
import csv, io
from datetime import datetime, timedelta

import ud_common as UDC
from ud_common import get, iso, _num

US_STATES = [("01", "AL", "Alabama"), ("02", "AK", "Alaska"), ("04", "AZ", "Arizona"), ("05", "AR", "Arkansas"), ("06", "CA", "California"),
    ("08", "CO", "Colorado"), ("09", "CT", "Connecticut"), ("10", "DE", "Delaware"), ("11", "DC", "District of Columbia"), ("12", "FL", "Florida"),
    ("13", "GA", "Georgia"), ("15", "HI", "Hawaii"), ("16", "ID", "Idaho"), ("17", "IL", "Illinois"), ("18", "IN", "Indiana"), ("19", "IA", "Iowa"),
    ("20", "KS", "Kansas"), ("21", "KY", "Kentucky"), ("22", "LA", "Louisiana"), ("23", "ME", "Maine"), ("24", "MD", "Maryland"),
    ("25", "MA", "Massachusetts"), ("26", "MI", "Michigan"), ("27", "MN", "Minnesota"), ("28", "MS", "Mississippi"), ("29", "MO", "Missouri"),
    ("30", "MT", "Montana"), ("31", "NE", "Nebraska"), ("32", "NV", "Nevada"), ("33", "NH", "New Hampshire"), ("34", "NJ", "New Jersey"),
    ("35", "NM", "New Mexico"), ("36", "NY", "New York"), ("37", "NC", "North Carolina"), ("38", "ND", "North Dakota"), ("39", "OH", "Ohio"),
    ("40", "OK", "Oklahoma"), ("41", "OR", "Oregon"), ("42", "PA", "Pennsylvania"), ("44", "RI", "Rhode Island"), ("45", "SC", "South Carolina"),
    ("46", "SD", "South Dakota"), ("47", "TN", "Tennessee"), ("48", "TX", "Texas"), ("49", "UT", "Utah"), ("50", "VT", "Vermont"),
    ("51", "VA", "Virginia"), ("53", "WA", "Washington"), ("54", "WV", "West Virginia"), ("55", "WI", "Wisconsin"), ("56", "WY", "Wyoming")]
US_IND = {"NRMN": "Mining & logging", "CONS": "Construction", "MFG": "Manufacturing", "TRAD": "Trade, transport & utilities", "INFO": "Information",
          "FIRE": "Financial activities", "PBSV": "Professional & business services", "EDUH": "Education & health", "LEIH": "Leisure & hospitality",
          "SRVO": "Other services", "GOVT": "Government"}   # FRED's state supersector series ids: <state><code>, seasonally adjusted


def _fred_multi(ids, start):
    """One FRED CSV request for several series: {id: [(YYYY-MM, value)]}."""
    txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={','.join(ids)}&cosd={start}").text
    rows = list(csv.reader(io.StringIO(txt)))
    if not rows or len(rows[0]) < 2:
        raise RuntimeError(f"FRED: unexpected reply {txt[:80]!r}")
    head, out = rows[0], {}
    for j, sid in enumerate(head[1:], 1):
        out[sid] = [(r[0][:7], float(r[j])) for r in rows[1:] if len(r) > j and _num(r[j]) is not None]
    return out


def _fetch_split(ids, start, depth=0):
    """FRED rejects a whole multi-series request when one id does not exist (e.g. a state with no separate mining series):
    split the batch until the bad ids are isolated and dropped. Transient timeouts get one retry."""
    for _try in range(2):
        try:
            return _fred_multi(ids, start)
        except Exception:
            pass
    if len(ids) == 1 or depth > 5:
        return {}
    h = len(ids) // 2
    out = _fetch_split(ids[:h], start, depth + 1)
    out.update(_fetch_split(ids[h:], start, depth + 1))
    return out


def us_states(D, N):
    meta = D["meta"]
    last = meta.get("us_states_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=12):
        print("  checked <12h ago — skipping")
        return False
    start = f"{UDC.NOW.year - 2}-{UDC.NOW.month:02d}-01"
    out, miss = {}, []
    for fips, ab, name in US_STATES:
        ids = [ab + "NA", ab + "UR"] + [ab + c for c in US_IND]
        S = _fetch_split(ids, start)
        if not S.get(ab + "NA"):
            miss.append(ab); continue
        nf, ur = S.get(ab + "NA") or [], S.get(ab + "UR") or []
        if len(nf) < 13:
            miss.append(ab); continue
        ind = {c: S[ab + c][-14:] for c in US_IND if len(S.get(ab + c) or []) >= 13}
        out[ab] = {"n": name, "fips": fips, "nf": nf[-25:], "ur": ur[-25:], "ind": ind}
    if len(out) < 45:
        raise RuntimeError(f"only {len(out)} states read; missing {miss[:12]}")
    asof = max(v["nf"][-1][0] for v in out.values())
    D.setdefault("regions", {})["us"] = {"asof": asof, "units": "thousands of jobs, seasonally adjusted; unemployment rate %",
        "src": "BLS Current Employment Statistics (state) and Local Area Unemployment Statistics, via FRED", "ind_names": US_IND, "states": out}
    meta["us_states_checked"] = iso(UDC.NOW)
    meta["asof"]["us_states"] = iso(UDC.NOW)   # when the desk last confirmed the latest published month
    print(f"  states: {len(out)} read, latest month {asof}; missing {miss}")
    return True


# ------------------------------------------------------------------ Canada: Labour Force Survey by province (Statistics Canada)
# Runs on the desk owner's own machine (self-hosted runner, label "statcan"): StatCan blocks cloud servers since Nov 17, 2026.
SC = "https://www150.statcan.gc.ca/t1/wds/rest/"
CA_PROV = [("NL", "Newfoundland and Labrador"), ("PE", "Prince Edward Island"), ("NS", "Nova Scotia"), ("NB", "New Brunswick"), ("QC", "Quebec"),
           ("ON", "Ontario"), ("MB", "Manitoba"), ("SK", "Saskatchewan"), ("AB", "Alberta"), ("BC", "British Columbia")]
CA_IND = {"AGR": ("Agriculture", r"^agriculture"), "NRS": ("Forestry, fishing, mining, oil & gas", r"^forestry, fishing, mining"),
          "UTL": ("Utilities", r"^utilities"), "CON": ("Construction", r"^construction"), "MFG": ("Manufacturing", r"^manufacturing"),
          "TRD": ("Wholesale & retail trade", r"^wholesale and retail"), "TRN": ("Transportation & warehousing", r"^transportation and warehousing"),
          "FIN": ("Finance, insurance & real estate", r"^finance, insurance, real estate"), "PRO": ("Professional, scientific & technical", r"^professional, scientific"),
          "BUS": ("Business, building & support services", r"^business, building"), "EDU": ("Educational services", r"^educational services"),
          "HLT": ("Health care & social assistance", r"^health care and social"), "INF": ("Information, culture & recreation", r"^information, culture"),
          "ACC": ("Accommodation & food services", r"^accommodation and food"), "OTH": ("Other services", r"^other services"),
          "PUB": ("Public administration", r"^public administration")}


def _sc_post(method, body):
    import json as _j, requests as _r
    r = _r.post(SC + method, headers={**UDC.UA, "Content-Type": "application/json"}, data=_j.dumps(body), timeout=60)
    if r.status_code == 403 and "curit" in r.text[:400]:
        raise RuntimeError("StatCan security check (blocked from this network) — run on the statcan runner")
    r.raise_for_status()
    return r.json()


def _sc_dims(pid):
    """{dimension name (lower): {member name (lower): memberId}} plus dimension order."""
    import re as _re
    o = _sc_post("getCubeMetadata", [{"productId": pid}])[0]["object"]
    dims = sorted(o["dimension"], key=lambda d: d["dimensionPositionId"])
    return [(d["dimensionNameEn"].lower(), {_re.sub(r"\s+", " ", m["memberNameEn"].lower()): m["memberId"] for m in d["member"]}) for d in dims]


def _pick(members, pat):
    import re as _re
    for name, mid in members.items():
        if _re.search(pat, name):
            return mid
    return None


def _sc_coord_series(pid, coords, n=26):
    out = {}
    for i in range(0, len(coords), 100):
        body = [{"productId": pid, "coordinate": c, "latestN": n} for c in coords[i:i + 100]]
        for o in _sc_post("getDataFromCubePidCoordAndLatestNPeriods", body):
            if o.get("status") != "SUCCESS":
                continue
            ob = o["object"]
            out[ob["coordinate"]] = sorted((p["refPer"][:7], float(p["value"])) for p in ob.get("vectorDataPoint", []) if _num(p.get("value")) is not None)
    return out


def _coord(ids):
    return ".".join(str(x) for x in (ids + [0] * 10)[:10])


def ca_provinces(D, N):
    meta = D["meta"]
    last = meta.get("ca_provinces_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago — skipping")
        return False
    # 14-10-0287-01: Labour force characteristics, monthly, seasonally adjusted — employment and unemployment rate by province
    dims = _sc_dims(14100287)
    names = [d for d, _ in dims]
    print("  14100287 dims:", names)
    sel = []
    for dname, mem in dims:
        if "geograph" in dname:
            sel.append(("geo", mem))
        elif "characteristic" in dname:
            sel.append(("chr", mem))
        elif "gender" in dname or dname == "sex":
            sel.append(("fix", _pick(mem, r"^(total|both sexes)")))
        elif "age" in dname:
            sel.append(("fix", _pick(mem, r"^15 years and over")))
        elif "statistic" in dname:
            sel.append(("fix", _pick(mem, r"^estimate")))
        elif "data type" in dname:
            sel.append(("fix", _pick(mem, r"^seasonally adjusted")))
        else:
            sel.append(("fix", 1))
    geo = dict(sel)["geo"]; chr_ = dict(sel)["chr"]
    emp_id, ur_id = _pick(chr_, r"^employment$"), _pick(chr_, r"^unemployment rate")
    coords, key = [], {}
    for ab, name in CA_PROV:
        gid = _pick(geo, "^" + name.lower())
        if not gid:
            continue
        for what, cid in (("nf", emp_id), ("ur", ur_id)):
            ids = [gid if k == "geo" else cid if k == "chr" else v for k, v in sel]
            c = _coord(ids); coords.append(c); key[c] = (ab, what)
    S = _sc_coord_series(14100287, coords)
    out = {}
    for c, (ab, what) in key.items():
        if len(S.get(c) or []) >= 13:
            out.setdefault(ab, {"n": dict(CA_PROV)[ab], "ind": {}})[what] = S[c][-25:]
    out = {k: v for k, v in out.items() if v.get("nf")}
    # 14-10-0355-01: employment by industry, monthly, seasonally adjusted, by province
    try:
        dims2 = _sc_dims(14100355); sel2 = []
        for dname, mem in dims2:
            if "geograph" in dname:
                sel2.append(("geo", mem))
            elif "industry" in dname or "naics" in dname:
                sel2.append(("ind", mem))
            elif "statistic" in dname:
                sel2.append(("fix", _pick(mem, r"^estimate")))
            elif "data type" in dname:
                sel2.append(("fix", _pick(mem, r"^seasonally adjusted")))
            else:
                sel2.append(("fix", 1))
        g2, i2 = dict(sel2)["geo"], dict(sel2)["ind"]
        coords2, key2 = [], {}
        for ab, name in CA_PROV:
            gid = _pick(g2, "^" + name.lower())
            if not gid or ab not in out:
                continue
            for code, (_, pat) in CA_IND.items():
                iid = _pick(i2, pat)
                if not iid:
                    continue
                c = _coord([gid if k == "geo" else iid if k == "ind" else v for k, v in sel2]); coords2.append(c); key2[c] = (ab, code)
        S2 = _sc_coord_series(14100355, coords2, 14)
        for c, (ab, code) in key2.items():
            if len(S2.get(c) or []) >= 13:
                out[ab]["ind"][code] = S2[c][-14:]
    except Exception as e:
        print("  industry detail skipped:", e)
    if len(out) < 8:
        raise RuntimeError(f"only {len(out)} provinces read")
    asof = max(v["nf"][-1][0] for v in out.values())
    D.setdefault("regions", {})["ca"] = {"asof": asof, "units": "thousands of jobs, seasonally adjusted; unemployment rate %",
        "src": "Statistics Canada Labour Force Survey (tables 14-10-0287-01, 14-10-0355-01)", "ind_names": {k: v[0] for k, v in CA_IND.items()}, "states": out}
    meta["ca_provinces_checked"] = iso(UDC.NOW)
    meta["asof"]["ca_provinces"] = iso(UDC.NOW)
    print(f"  provinces: {sorted(out)} latest {asof}; industries per province: {[len(v['ind']) for v in out.values()]}")
    return True
