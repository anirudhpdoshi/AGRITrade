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
US_IND = {"10000000": "Mining & logging", "15000000": "Mining, logging & construction", "20000000": "Construction", "30000000": "Manufacturing",
          "40000000": "Trade, transport & utilities", "50000000": "Information", "55000000": "Financial activities",
          "60000000": "Professional & business services", "65000000": "Education & health", "70000000": "Leisure & hospitality",
          "80000000": "Other services", "90000000": "Government"}


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
        ids = [ab + "NA", ab + "UR"] + [f"SMS{fips}00000{c}01" for c in US_IND]
        S = _fetch_split(ids, start)
        if not S.get(ab + "NA"):
            miss.append(ab); continue
        nf, ur = S.get(ab + "NA") or [], S.get(ab + "UR") or []
        if len(nf) < 13:
            miss.append(ab); continue
        ind = {c: S[f"SMS{fips}00000{c}01"][-14:] for c in US_IND if len(S.get(f"SMS{fips}00000{c}01") or []) >= 13}
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
