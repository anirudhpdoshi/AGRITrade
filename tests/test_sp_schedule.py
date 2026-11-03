"""S&P 500 reporting schedule: members filter, session mapping, 30-min cache, BMO/AMC merged onto calendar rows, new-day refresh."""
import json, os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import us_earnings as E  # noqa: E402
N = P = 0
def ok(c, m):
    global N, P
    N += 1; P += bool(c); print(("PASS " if c else "FAIL ") + m)
now = datetime(2026, 11, 3, 14, 30, tzinfo=timezone.utc)
csv = "Symbol,Security,GICS Sector\n" + "\n".join(f"S{i},Co {i},X" for i in range(480)) + "\nAMD,Advanced Micro Devices,IT\nSHOP,Shopify,IT\n"
calls = []
def get(u, h):
    calls.append(u)
    if u == E.SP500_URL: return csv
    d = u.split("=")[-1]
    rows = [{"symbol": "AMD", "name": "Advanced Micro Devices, Inc.", "time": "time-after-hours", "epsForecast": "$1.68", "noOfEsts": "13", "marketCap": "$824,073,390,000"},
            {"symbol": "SHOP", "name": "Shopify", "time": "time-pre-market", "epsForecast": "$0.35", "marketCap": "$200,000,000,000"},
            {"symbol": "TINY", "name": "Not In Index", "time": "time-pre-market"}] if d == "2026-11-03" else []
    return json.dumps({"data": {"rows": rows}})
sp = E.sp500(None, now, get)
ok(len(sp["rows"]) == 482, "S&P 500 list read")
S = E.sp_schedule(None, sp["rows"], now, get)
T = S["days"]["2026-11-03"]
ok([x["s"] for x in T] == ["AMD", "SHOP"], "only index members, largest first")
ok(T[0]["time"] == "amc" and T[1]["time"] == "bmo" and T[0]["eps_f"] == 1.68 and T[0]["ests"] == 13, "session + EPS forecast + estimate count")
ok(len(S["days"]) == 5, "today + next 4 weekdays")
n = len(calls); E.sp_schedule(S, sp["rows"], now + timedelta(minutes=10), get)
ok(len(calls) == n, "cached for 30 minutes")
cal = {"rows": [{"symbol": "AMD", "date": "2026-11-03"}, {"symbol": "XYZ", "date": "2026-11-03"}]}
E.merge_times(cal, S)
ok(cal["rows"][0].get("time") == "amc" and cal["rows"][0].get("sp") and not cal["rows"][1].get("time"), "BMO/AMC merged onto FMP calendar rows")
ok(E.calendar_due({"fetched_at": E.iso(now - timedelta(hours=10)), "rows": []}, now)[1] == "new day", "first run of a new day refreshes the calendar")
print(f"{P}/{N} passed"); sys.exit(0 if P == N else 1)
