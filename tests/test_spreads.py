"""Calendar-spread history: pairs follow the roll, spread = near − far in cents on common settle dates."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import ud_grains as G

R = [{"contract": "ZCZ26"}, {"contract": "ZCH27"}, {"contract": "ZCK27"}]
assert G._spread_pairs(R) == [("ZCZ26", "ZCH27"), ("ZCZ26", "ZCK27"), ("ZCH27", "ZCK27")]
assert G._spread_pairs(R[:2]) == [("ZCZ26", "ZCH27")]
assert G._spread_pairs(R[:1]) == []
a = [("2026-11-12", 4.40), ("2026-11-13", 4.455), ("2026-11-16", 4.4875)]
b = [("2026-11-13", 4.5675), ("2026-11-16", 4.59)]
assert G.spread_series(a, b) == [["2026-11-13", -11.25], ["2026-11-16", -10.25]], G.spread_series(a, b)
print("test_spreads: 4/4 passed")
