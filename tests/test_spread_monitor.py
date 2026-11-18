"""spread_monitor: published prints only, SOFR/CORRA overnight leg, no carry-forward."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import ud_fx as F

class R:
    def __init__(s, j): s.j = j
    def json(s): return s.j

def run():
    F.us_curve = lambda: {"2026-11-1%d" % i: {"1M": 4.0, "3M": 4.1, "2Y": 4.5 + i / 100, "10Y": 5.0} for i in range(0, 7)}
    def valet(path):
        if "bond_yields_benchmark" in path:
            return {"seriesDetail": {"BD.CDN.2YR.DQ.YLD": {}, "BD.CDN.10YR.DQ.YLD": {}, "BD.CDN.LONG.DQ.YLD": {}},
                    "observations": [{"d": "2026-11-1%d" % i, "BD.CDN.2YR.DQ.YLD": {"v": "3.00"}, "BD.CDN.10YR.DQ.YLD": {"v": "3.8"}} for i in range(0, 7)]}
        if "AVG.INTWO" in path:
            return {"observations": [{"d": "2026-11-16", "AVG.INTWO": {"v": "2.25"}}]}
        return {"observations": [{"d": "2026-11-1%d" % i, "TB.CDN.30D.MID": {"v": "2.2"}, "TB.CDN.90D.MID": {"v": ""}} for i in range(0, 7)]}
    F.valet = valet
    F.get = lambda url: R({"refRates": [{"effectiveDate": "2026-11-16", "percentRate": 3.9}]})
    D = {"fx": {}, "meta": {"asof": {}}}
    assert F.spread_monitor(D, None)
    Y = D["fx"]["ysm"]
    h = {x["d"]: x for x in Y["hist"]}
    assert h["2026-11-16"]["us"]["ON"] == 3.9 and h["2026-11-16"]["ca"]["ON"] == 2.25
    assert "ON" not in h["2026-11-15"]["ca"], "no carry-forward"
    assert "3M" not in h["2026-11-16"]["ca"], "blank BoC print stays blank"
    assert "30Y" not in Y["tenors"] and "3M" not in Y["tenors"] and "2Y" in Y["tenors"]
    assert Y["last"]["ON"] == "2026-11-16" and Y["last"]["2Y"] == "2026-11-16"
    print("spread_monitor ok")

run()
