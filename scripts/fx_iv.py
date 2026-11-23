"""Write a USD/CAD implied-vol reading into data.json (DATA.fx.fxopt) and append it to DATA.fx.fxopt_hist.

Spot FX options are OTC, so the desk maps listed CME CAD/USD futures options (6C) or CME's CVOL index (CAVL) to USD/CAD:
  · volatility of an inverse pair is identical → ATM / CVOL is used as is
  · a 6C call at K is a USD/CAD put at 1/K → USD/CAD 25d risk reversal = 6C 25d put vol − 6C 25d call vol; butterfly unchanged
Usage (values in % annualised):
  python scripts/fx_iv.py --atm 5.10 --source "CME CVOL (CAVL)"
  python scripts/fx_iv.py --atm 5.05 --call25-6c 5.30 --put25-6c 5.12 --source "Barchart 6C Jan-27" --asof 2026-11-23T14:05:00-05:00
  python scripts/fx_iv.py --atm 5.05 --term 1W=5.4,1M=5.05,3M=5.2
The front end (fxforecast.js) turns the ATM vol into the daily expected move (IV / sqrt(252)) and horizon moves."""
import argparse, json, pathlib
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]


def map_6c(atm, call25=None, put25=None):
    """6C (USD per CAD) quotes -> USD/CAD terms."""
    o = {"atm": round(atm, 3)}
    if call25 is not None and put25 is not None:
        o["civ"], o["piv"] = round(put25, 3), round(call25, 3)          # USD/CAD 25d call = 6C 25d put
        o["rr25"] = round(put25 - call25, 3)
        o["bf25"] = round((call25 + put25) / 2 - atm, 3)
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atm", type=float, required=True)
    ap.add_argument("--call25-6c", type=float)
    ap.add_argument("--put25-6c", type=float)
    ap.add_argument("--term", help="tenor=vol pairs, e.g. 1W=5.4,1M=5.05,3M=5.2")
    ap.add_argument("--source", required=True)
    ap.add_argument("--asof", help="ISO time; default now (Toronto)")
    a = ap.parse_args()
    if not 0.5 < a.atm < 40:
        raise SystemExit("ATM vol outside 0.5-40%: refusing")
    asof = a.asof or datetime.now(ZoneInfo("America/Toronto")).replace(microsecond=0).isoformat()
    path = ROOT / "data.json"
    doc = json.loads(path.read_text())
    fx = doc["DATA"]["fx"]
    old = fx.get("fxopt") or {}
    new = map_6c(a.atm, a.call25_6c, a.put25_6c)
    new.update({"source": a.source, "asof": asof, "rr": new.get("rr25")})   # no wings given -> no RR (nothing carried over from an older pull)
    if a.term:
        new["term"] = [{"tenor": k.strip(), "atm": float(v)} for k, v in (x.split("=") for x in a.term.split(","))]
    new["rr_label"] = None if new.get("rr") is None else ("USD calls bid" if new["rr"] > 0.5 else "USD puts bid" if new["rr"] < -0.5 else "Neutral")
    new["pins_reason"] = old.get("pins_reason")
    fx["fxopt"] = {k: v for k, v in new.items() if v is not None}
    hist = fx.setdefault("fxopt_hist", [])
    day = asof[:10]
    hist[:] = [h for h in hist if h.get("d") != day] + [{"d": day, "atm": new["atm"], "rr25": new.get("rr25"), "bf25": new.get("bf25"), "src": a.source}]
    hist.sort(key=lambda h: h["d"])
    doc["DATA"]["meta"]["asof"]["fxopt"] = asof
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(fx["fxopt"]))


if __name__ == "__main__":
    main()
