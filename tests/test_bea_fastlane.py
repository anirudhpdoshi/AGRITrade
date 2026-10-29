"""BEA direct read + fast-lane macro checks (no network): BEA rows parse, the key never reaches an error message,
the fast lane re-reads only the awaited series, and a new period is stamped as seen at the time it is read."""
import json, os, sys
os.environ["BEA_API_KEY"] = "TESTKEY123456"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import update_data as U
import live_loop as L
from datetime import datetime, timedelta

n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1

class R:
    def __init__(s, j): s.j = j
    def raise_for_status(s): pass
    def json(s): return s.j

def rows(table, per, vals, desc):
    return {"BEAAPI": {"Results": {"Data": [{"TableName": table, "LineNumber": "1", "LineDescription": desc, "TimePeriod": p, "DataValue": v}
                                             for p, v in zip(per, vals)] + [{"LineNumber": "2", "LineDescription": "Other", "TimePeriod": per[-1], "DataValue": "9"}]}}}

calls = []
def fake_get(url, params=None, **kw):
    calls.append(params)
    if params["TableName"] == "T10101":
        per = [f"{y}Q{q}" for y in range(2019, 2027) for q in range(1, 5)][:-1]   # ... 2026Q3
        return R(rows("T10101", per, ["2.1"] * (len(per) - 1) + ["2.9"], "Gross domestic product"))
    per = [f"{y}M{m:02d}" for y in range(2019, 2027) for m in range(1, 13)][:-3]   # ... 2026M09
    return R(rows("T20804", per, [f"{100 + i * 0.25:,.3f}" for i in range(len(per))], "PCE excluding food and energy"))
U.requests.get = fake_get

g = U._bea(*U.BEA_SRC["us_gdp"])
ok(g[-1] == ("2026-07-01", 2.9), f"GDP quarter parses to the FRED date convention: {g[-1]}")
p = U._bea(*U.BEA_SRC["us_core_pce"])
ok(p[-1][0] == "2026-09-01" and len(p) > 60, "monthly PCE index parses")

def boom(*a, **k): raise U.requests.exceptions.HTTPError("403 for url https://apps.bea.gov/api/data?UserID=TESTKEY123456")
U.requests.get = boom
try:
    U._bea(*U.BEA_SRC["us_gdp"]); ok(False, "should raise")
except RuntimeError as e:
    ok("TESTKEY" not in str(e) and "apps.bea" not in str(e), "error message carries neither key nor URL")
ok("TESTKEY" not in U.redact("x?UserID=TESTKEY123456&y=1"), "redact strips the BEA key")
U.requests.get = fake_get

# fast lane: due set and targeted re-read
D = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data.json")))["DATA"]
for m in D["macro"]:
    if m["key"] in ("us_gdp", "us_core_pce"):
        m["seen_at"] = "2026-10-01T08:31:00-04:00"; m["period"] = "old"
U.NOW = datetime(2026, 10, 29, 8, 31, 30, tzinfo=U.TOR)
due = L.macro_due(D)
ok({"us_gdp", "us_core_pce"} <= due, f"GDP and PCE are awaited after 8:30: {due}")
ok(not L.rel_done(D, "macro"), "release watch stays open while they are awaited")
fred = []
U._fred = lambda sid, start: fred.append(sid) or [(f"2026-{m:02d}-01", 230.0 + m) for m in range(1, 10)]
before = {m["key"]: m for m in D["macro"]}
calls.clear()
U.macro(D, {}, only={"us_gdp", "us_core_pce"})
after = {m["key"]: m for m in D["macro"]}
ok(len(calls) == 2 and not fred, f"only the two awaited series were fetched, both from BEA (fred={fred})")
ok(after["us_gdp"]["src"] == "BEA T10101" and after["us_gdp"]["value"] == 2.9, "GDP read from BEA")
ok(after["us_gdp"]["seen_at"].startswith("2026-10-29T08:31"), "new period stamped at read time")
ok(all(after[k] is before[k] for k in before if k not in ("us_gdp", "us_core_pce")), "every other series untouched")
ok([m["key"] for m in D["macro"]] == list(before), "series order kept")
ok(L.macro_due(D) == due - {"us_gdp", "us_core_pce"}, "watch closes for the landed series")
print(f"{n}/{n} passed")
