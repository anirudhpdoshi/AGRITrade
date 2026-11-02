"""Alert engine rules: confirmed breaks only, once per day, walls by notional, news filtering."""
import os, sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import alerts as AL  # noqa: E402

TOR = ZoneInfo("America/Toronto")
N = P = 0


def ok(c, m):
    global N, P
    N += 1; P += bool(c)
    print(("PASS " if c else "FAIL ") + m)


NOW = datetime(2026, 11, 2, 11, 0, tzinfo=TOR)
DAILY = [100 + (i % 3) * 0.2 for i in range(259)] + [99.6]   # flat ~100, prior close 99.6 below the averages
STATE = {"intraday": []}


class T:
    def __init__(self, sym): self.sym = sym
    def history(self, period, interval):
        if interval == "1d":
            idx = pd.DatetimeIndex([NOW - timedelta(days=261 - i) for i in range(260)])
            return pd.DataFrame({"Close": DAILY}, index=idx)
        rows = STATE["intraday"]
        idx = pd.DatetimeIndex([r[0] for r in rows])
        return pd.DataFrame({"High": [r[1] for r in rows], "Low": [r[2] for r in rows], "Close": [r[3] for r in rows]}, index=idx)


class YF:
    Ticker = T


AL.INST = [("usdcad", "USD/CAD", "CAD=X", "fx", 1.0)]


def bars(closes, start=NOW - timedelta(minutes=5 * 30)):
    return [(start + timedelta(minutes=5 * i), c + 0.01, c - 0.01, c) for i, c in enumerate(closes)]


base, L = AL._levels([(None, v) for v in DAILY])
ma20 = L["ma20"][0]; buf = base["buf"]
# 1) touch only: closes reach the MA but never by the buffer -> nothing
STATE["intraday"] = bars([99.0] * 20 + [ma20 + buf * 0.3, ma20 + buf * 0.4])
st = {}
new = AL.run({}, st, NOW, TOR, YF)
ok(not [a for a in new if "|ma20|u|" in a["id"]], "a touch of the 20-day average does not fire")
# 2) confirmed: two closes beyond, latest by >= buffer -> fires once
STATE["intraday"] = bars([99.0] * 20 + [ma20 + buf * 0.5, ma20 + buf * 1.5])
new = AL.run({}, st, NOW, TOR, YF)
hit = [a for a in new if "|ma20|u|" in a["id"]]
ok(len(hit) == 1 and hit[0]["impact"].startswith("Bullish USD/CAD"), f"confirmed 20-day cross fires, bullish USD/CAD: {[a['head'] for a in new]}")
ok(all(k in hit[0] for k in ("trigger", "impact", "why", "src", "mt")) if hit else False, "alert carries trigger, impact, why, source and market time")
new2 = AL.run({}, st, NOW + timedelta(minutes=3), TOR, YF)
ok(not [a for a in new2 if "|ma20|u|" in a["id"]], "the same breakout never alerts twice")
# 3) sigma band down
lo2 = L["sm2"][0]
STATE["intraday"] = bars([100.0] * 20 + [lo2 - buf * 0.2, lo2 - buf * 2])
st = {}
new = AL.run({}, st, NOW, TOR, YF)
ok(any("|sm2|d|" in a["id"] and a["impact"].startswith("Bearish") for a in new), "break below −2σ fires bearish")
ok(not any("|sp" in a["id"] for a in new), "no upside band alert on a down move")
# 4) walls: notional = OI x 5000 x underlying
D = {"grains": {"corn": {"roll": [{"contract": "ZCZ26"}], "near": {"rows": [[4.3, 10, 22932], [5.0, 50618, 5], [4.6, 900, 800]], "underlying": "4.49", "chain": "Dec-26", "oi_label": "as of Oct 30"}}}}
W = AL._walls(D, "corn")
ok(W["put"][0] == 4.3 and abs(W["put"][2] - 22932 * 5000 * 4.49) < 1, f"put wall 4.30 with notional {W['put'][2]:,.0f}")
AL.INST = [("corn", "Corn", None, "corn", 1.0)]
DAILY[:] = [4.5 + (i % 3) * 0.005 for i in range(260)]
STATE["intraday"] = bars([4.45] * 20 + [4.296, 4.28])
st = {}
new = AL.run(D, st, NOW, TOR, YF)
ok(any("putwall" in a["id"] and "≈ $" in a["trigger"] for a in new), f"decisive break below the put wall fires with notional: {[a['trigger'][:80] for a in new if 'wall' in a['id']]}")
# 5) news
B = {"desks": {"us": {"top": [
    {"title": "Fed cuts rates by 25 basis points", "outlet": "Reuters", "first": "2026-11-02T15:00:00+00:00", "outlets": ["Reuters", "AP News"]},
    {"title": "What to watch as the Fed could cut rates", "outlet": "Reuters", "first": "2026-11-02T13:00:00+00:00"},
    {"title": "Trump signs executive order on grain exports", "outlet": "SomeBlog", "first": "2026-11-02T14:00:00+00:00"},
    {"title": "Trump imposes new tariffs on steel", "outlet": "AP News", "first": "2026-11-01T14:00:00+00:00"},
    {"title": "Missile strike hits Black Sea port, shipping halted", "outlet": "Bloomberg", "first": "2026-11-02T14:30:00+00:00"},
]}}}
st = {}
news = AL.scan_news(B, st, NOW, TOR)
heads = [a["head"] for a in news]
ok(any("Fed cuts" in h for h in heads) and any("Missile" in h for h in heads), f"credible, new, market-moving items fire: {heads}")
ok(not any("What to watch" in h or "SomeBlog" in h or "steel" in h for h in heads), "previews, non-credible outlets and yesterday's stories are dropped")
ok(any(a["status"].startswith("Confirmed") for a in news if "Fed" in a["head"]), "two outlets = confirmed")
ok(not AL.scan_news(B, st, NOW, TOR), "news dedupe")
print(f"{P}/{N} passed")
sys.exit(0 if P == N else 1)
