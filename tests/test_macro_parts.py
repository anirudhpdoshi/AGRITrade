"""macro_parts.changes: % / level / pp changes matched by date, quarterly steps, gaps give None."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import macro_parts as M

ok = 0
def check(c, msg):
    global ok
    if not c: print("FAIL", msg); sys.exit(1)
    ok += 1
pts = [(f"2025-{m:02d}-01", 100.0 + m) for m in range(1, 13)] + [(f"2026-{m:02d}-01", 112.0 + m) for m in range(1, 11)]
k, v, mm, yy = M.changes(pts, "pct", 12)
check(k[-1] == "2026-10" and len(k) == 13, "last 13 months")
check(mm[-1] == round((122 / 121 - 1) * 100, 2) and yy[-1] == round((122 / 110 - 1) * 100, 2), "pct m/m and y/y")
k, v, mm, yy = M.changes([(d, x) for d, x in pts if d != "2026-09-01"], "diff", 12)
check(mm[-1] is None and yy[-1] == 12.0, "a skipped month gives no m/m, y/y still by date")
q = [("2025-01-01", 1.0), ("2025-04-01", 2.0), ("2025-07-01", 3.0), ("2025-10-01", 4.0), ("2026-01-01", 6.0)]
k, v, mm, yy = M.changes(q, "pp", 4)
check(mm == [None, 1.0, 1.0, 1.0, 2.0] and yy[-1] == 5.0, "quarterly steps of 3 months, y/y 4 quarters back")
check(all(len(c) == 4 and c[0] in ("pct", "diff", "pp") for c in M.PARTS.values()), "PARTS entries well formed")
print(f"{ok}/{ok} passed")
