"""Desk roll rule (no network): a front leaves the desk the day after its hard exit (FND - 1 business day)."""
import json, os, sys
from datetime import date
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import update_data as U
n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1
ok(U.contract_dates("ZSX26") == (date(2026, 10, 30), date(2026, 10, 29)), "ZSX26 FND Oct 30, hard exit Oct 29")
ok(U.contract_dates("ZCZ26") == (date(2026, 11, 30), date(2026, 11, 27)), "Dec corn: Thanksgiving skipped")
ok(U.season_contract("corn", 2026, 10) == "ZCZ26" and U.season_contract("corn", 2026, 11) == "ZCH27" and U.season_contract("soybeans", 2026, 9) == "ZSX26" and U.season_contract("soybeans", 2026, 10) == "ZSF27", "seasonality uses the contract front for the whole month")
ok(U.season_month([("2026-09-29", 5.0), ("2026-09-30", 5.0), ("2026-10-30", 5.5)], 2026, 10) == 10.0 and U.season_month([("2026-10-30", 5.5)], 2026, 10) is None, "month change needs both month-ends")
ok(U.last_trade("ZSX26") == date(2026, 11, 13), "Nov soybeans last trade: Nov 14 is a Saturday, so Fri Nov 13")
_e = {"fnd": "Fri Oct 30, 2026", "last_trade": "2026-11-13", "follow": [], "done": False}
U.merge_follow(_e, [("2026-10-29", 1.0), ("2026-10-30", 12.0), ("2026-11-02", 12.1)], [("2026-10-30", 12.1), ("2026-11-02", 12.2)], date(2026, 11, 5))
ok(_e["follow"] == [["2026-10-30", 12.0, 12.1], ["2026-11-02", 12.1, 12.2]] and not _e["done"], "spread follows from FND on common dates")
U.merge_follow(_e, [], [], date(2026, 11, 14)); ok(_e["done"] and len(_e["follow"]) == 2, "done after last trade; history kept")
_D = {"rolls_add": {"corn": [["11-04", 1, 2, 3.0, 4.0, "P"]]}}; U.archive_pair(_D, "corn", "ZCZ26", "ZCH27"); U.archive_pair(_D, "corn", "ZCZ26", "ZCH27")
ok(len(_D["rolls_expired"]["corn"]) == 1 and _D["rolls_expired"]["corn"][0]["rows"][0][0] == "11-04", "roll data archived once before it is reset")
ok(U.next_contract("ZSX26", "soybeans") == "ZSF27" and U.next_contract("ZCZ26", "corn") == "ZCH27", "next listed month")
D = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data.json")))["DATA"]
D["grains"]["soybeans"]["roll"] = [{"contract": c, "settle": None, "prev": None, "oi_pct": 0.0} for c in ("ZSX26", "ZSF27", "ZSH27")]
ok(U.roll_fronts(D, date(2026, 10, 29)) == [], "still on the desk on the hard-exit day")
ok(U.roll_fronts(D, date(2026, 10, 30)) == [("soybeans", "ZSX26", "ZSF27")], "gone the day after")
ok([r["contract"] for r in D["grains"]["soybeans"]["roll"]] == ["ZSF27", "ZSH27", "ZSK27"], "curve refilled")
ok("ZSX26" not in (D["grains"]["soybeans"].get("quotes") or {}), "expired quote dropped")
# BLS fast lane: parse the API reply into dated monthly points (annual averages M13 dropped), key never in an error
class _R:
    def raise_for_status(self): pass
    def json(self): return {"Results": {"series": [{"seriesID": "CES0000000001", "data": [
        {"year": "2026", "period": "M10", "value": "160123"}, {"year": "2026", "period": "M09", "value": "159958"},
        {"year": "2025", "period": "M13", "value": "158000"}]}]}}
_post = U.requests.post
U.requests.post = lambda *a, **k: _R()
B = U._bls_batch(["CES0000000001"])
U.requests.post = _post
ok(B["CES0000000001"] == [("2026-09-01", 159958.0), ("2026-10-01", 160123.0)], "BLS points sorted, M13 dropped")
ok(set(U.BLS_SRC) == {"us_nfp", "us_ur", "us_ahe", "us_cpi", "us_core_cpi", "us_ppi"}, "BLS fast-lane series")
print(f"{n}/{n} passed")
