"""COT release schedule parser: holiday-delayed days, year headings, implausible pages rejected."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import cot_schedule as C

html = open(os.path.join(os.path.dirname(__file__), "fixtures", "cot_schedule.html"), encoding="utf-8").read()
P = C.parse(html)
ok = 0
def check(c, msg):
    global ok
    if not c: print("FAIL", msg); sys.exit(1)
    ok += 1
check(list(P) == [2026], "one year parsed")
R = dict(P[2026])
check(R.get("2026-11-16") is True and R.get("2026-11-30") is True and R.get("2026-12-28") is True, "delayed Mondays starred")
check("2026-11-13" not in R and "2026-11-27" not in R, "skipped Fridays absent")
check(R.get("2026-11-20") is False, "normal Friday kept")
check(C.plausible(P[2026]), "real year passes the plausibility check")
check(not C.plausible(P[2026][:10]), "a truncated page is rejected")
check(not C.plausible(P[2026] + [("2026-11-14", False)]), "a weekend date is rejected")
check(C.parse("<p>2026 Release Schedule</p><table><tr><td>Home</td><td>12</td></tr></table>") == {}, "non-month rows ignored")
print(f"{ok}/{ok} passed")
