"""Options flow (daily tier): Black-76, expected move, GEX sign/flip, next-day outcome and analogues (no network)."""
import datetime as dt, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import optflow as O
n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1
c, p = O.b76(4.5, 4.5, 0.1, 20, True), O.b76(4.5, 4.5, 0.1, 20, False)
ok(abs(c["v"] - p["v"]) < 1e-9 and abs(c["d"] - p["d"] - 1) < 1e-9 and c["g"] > 0, "put-call parity at the money, delta gap 1, gamma positive")
now = dt.datetime(2026, 11, 2, 14, tzinfo=dt.timezone.utc)
ch = {"rows": [[4.3, 100, 5000, 18, 18], [4.5, 2000, 2000, 17, 17], [4.7, 5000, 100, 18, 18]], "iv": 17, "expires": "2026-11-20", "contract": "ZCZ26"}
st = O.chain_stats(ch, 4.5, now)
ok(abs(st["em"] - 4.5 * 0.17 * ((st["dte"] + 0.0) / 365) ** 0.5) < 0.01, f"expected move = F·IV·√T: {st['em']}")
ok(st["pcr"] == round(7100 / 7100, 2) and st["has_vol"] is False and st["prem_c"] is None, "no volume -> no premium estimate")
ch["rows"] = [r + [10, 20] for r in ch["rows"]]
st2 = O.chain_stats(ch, 4.5, now)
ok(st2["has_vol"] and st2["prem_c"] > 0 and st2["vol_c"] == 30, "volume per strike -> premium estimate")
g = {"fan": {"intraday": [4.5], "anchor": 4.5, "settle_date": "2026-10-30"}, "near": dict(ch), "far": None, "roll": [{"contract": "ZCZ26"}]}
prev = {"hist": [{"d": "2026-10-29", "s": 4.5, "iv": 17, "em": 0.05, "lo": 4.45, "hi": 4.55}]}
hl = {"2026-10-29": (4.52, 4.48, 4.5), "2026-10-30": (4.58, 4.47, 4.5)}
r = O.build_grain(g, hl, now, prev)
o = [h for h in r["hist"] if h["d"] == "2026-10-29"][0]["out"]
ok(o["d"] == "2026-10-30" and not o["breach_close"] and o["breach_intraday"], f"next-day outcome: close inside, high touched: {o}")
ok(r["next_day"]["em"] > 0 and r["analogues"]["all"]["n"] == 1, "next-day range and record book")
hl2 = {"2026-10-30": (None, None, 4.6)}
r2 = O.build_grain(g, hl2, now, {"hist": [{"d": "2026-10-29", "s": 4.5, "iv": 17, "em": 0.05, "lo": 4.45, "hi": 4.55}]})
o2 = [h for h in r2["hist"] if h["d"] == "2026-10-29"][0]["out"]
ok(o2["breach_close"] and o2["breach_intraday"] is None and r2["analogues"]["all"]["p_breach_intraday"] is None, "missing high/low stays unknown, never counted")
print(f"{n}/{n} passed")
