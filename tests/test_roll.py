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
ok(U.next_contract("ZSX26", "soybeans") == "ZSF27" and U.next_contract("ZCZ26", "corn") == "ZCH27", "next listed month")
D = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data.json")))["DATA"]
D["grains"]["soybeans"]["roll"] = [{"contract": c, "settle": None, "prev": None, "oi_pct": 0.0} for c in ("ZSX26", "ZSF27", "ZSH27")]
ok(U.roll_fronts(D, date(2026, 10, 29)) == [], "still on the desk on the hard-exit day")
ok(U.roll_fronts(D, date(2026, 10, 30)) == [("soybeans", "ZSX26", "ZSF27")], "gone the day after")
ok([r["contract"] for r in D["grains"]["soybeans"]["roll"]] == ["ZSF27", "ZSH27", "ZSK27"], "curve refilled")
ok("ZSX26" not in (D["grains"]["soybeans"].get("quotes") or {}), "expired quote dropped")
print(f"{n}/{n} passed")
