"""Seasonality math checks for scripts/us_market.py (no network)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import us_market as M

n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1
def close(a, b, t=1e-9):
    return a is not None and b is not None and abs(a - b) < t

# synthetic month-end series: 2020-12 = 100, then known monthly moves
moves = {2021: [1, -2, 3, 0, 1, 1, -1, 2, -3, 4, 1, 2], 2022: [-5, -3, 2, -8, 0, -6, 7, -4, -9, 6, 5, -6],
         2023: [3, -2, 1, 1, 0, 4, 3, -2, -3, -2, 9, 5], 2024: [2, 4, 3, -4, 5, 2, 1, 2, 2, -1, 6, -3],
         2025: [3, -1, -5, -1, 6, 4, 2, 2, 3, 2, 0, 1], 2026: [1, 2, -1, 3, 2, 1, 1, 0, 2, 3]}
me, lvl = {"2020-12": 100.0}, 100.0
for y in sorted(moves):
    for m, r in enumerate(moves[y], 1):
        lvl *= 1 + r / 100
        me[f"{y}-{m:02d}"] = lvl
me["2026-11"] = lvl * 1.5          # the running month: must never be counted
years = [2021, 2022, 2023, 2024, 2025]
S = M.seasonality(me, years, "2026-11")

ok(close(S["grid"]["2021"][0], 1.0) and close(S["grid"]["2022"][3], -8.0), "monthly return = month-end / prior month-end − 1")
ok(close(S["grid"]["2023"][0], 3.0), "January uses the prior December close")
prod = 1.0
for r in moves[2022]:
    prod *= 1 + r / 100
ok(close(S["annual"]["2022"], (prod - 1) * 100), "annual return is compounded (Dec/Dec), not an average of months")
ok(not close(S["annual"]["2022"], sum(moves[2022])), "...and differs from the sum of monthly returns")
ok(close(S["avg"][0]["mean"], sum(moves[y][0] for y in years) / 5) and S["avg"][0]["n"] == 5, "5-year average = arithmetic mean per calendar month")
ok(S["avg"][0]["pos"] == 4 and S["avg"][1]["pos"] == 1, "positive-month frequency")
ok(S["ytd"]["months"][10] is None and S["ytd"]["through"] == "2026-10", "running month excluded from YTD")
ytd = 1.0
for r in moves[2026]:
    ytd *= 1 + r / 100
ok(close(S["ytd"]["total"], (ytd - 1) * 100), "YTD compounded through the last complete month")
ok(close(S["summary"]["best_cell"][0], 9, 1e-6) and S["summary"]["best_cell"][1:] == (2023, 10), "strongest single month (Nov 2023, +9%)")
ok(S["summary"]["worst_avg_month"] is not None and S["summary"]["cells"] == 60, "60 cells in a 5-year matrix")
gap = dict(me); gap.pop("2024-05")
G = M.seasonality(gap, years, "2026-11")
ok(G["grid"]["2024"][4] is None and G["grid"]["2024"][5] is None and G["avg"][4]["n"] == 4, "a missing month-end leaves gaps, never a filled value")
ok(M.month_end_closes([("2026-01-30", 5.0), ("2026-01-02", 1.0), ("2026-02-27", 7.0)]) == {"2026-01": 5.0, "2026-02": 7.0}, "last trading day of the month")

print(f"us_market: {n} checks passed")
