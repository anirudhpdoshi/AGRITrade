"""Earnings release watch: 10 s for 2 min from the slot, then 30 s until the numbers land; EDGAR 8-K and FMP numbers."""
import os, sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import earn_watch as EW  # noqa: E402

TOR = ZoneInfo("America/Toronto")
N = P = 0


def ok(c, m):
    global N, P
    N += 1; P += bool(c)
    print(("PASS " if c else "FAIL ") + m)


day = datetime(2026, 11, 2, tzinfo=TOR)
w = EW.Watch(TOR, {"day": "2026-11-02", "calls": 0, "done": {}, "filed": {}})
w.rows = {"AAPL": {"symbol": "AAPL", "date": "2026-11-02", "time": "amc", "top": True, "epsEstimated": 1.99},
          "XOM": {"symbol": "XOM", "date": "2026-11-02", "time": "bmo", "top": True}}
at = lambda h, m, s=0: datetime(2026, 11, 2, h, m, s, tzinfo=TOR)
ok(w.interval(at(15, 59)) is None, "before the 4 pm slot: no fast polling (XOM's BMO window closed at 8:30)")
ok(w.interval(at(7, 1)) == 10, "BMO slot 7:00 -> 10 s polling in the first 2 minutes")
ok(w.interval(at(16, 0, 30)) == 10, "AMC slot 4:00 pm -> 10 s at 4:00:30")
ok(w.interval(at(16, 3)) == 30, "after 2 minutes -> 30 s")
ok(w.interval(at(17, 31)) is None, "window closes 90 min after the slot")

calls = []
w.key = "k"
w.edgar = lambda s, now: {"acc": "0000320193-26-000101", "at": "2026-11-02T16:30:41-05:00", "url": "https://www.sec.gov/x"} if s == "AAPL" else None
state = {"n": 0}


def fake_fmp(ep, params, key):
    state["n"] += 1
    return [{"symbol": "AAPL", "date": "2026-11-02", "epsActual": 2.05 if state["n"] >= 2 else None, "epsEstimated": 1.99,
             "revenueActual": 115e9 if state["n"] >= 2 else None, "revenueEstimated": 113.4e9}]


EW.UE.fmp = fake_fmp
al, live = w.poll(at(16, 0, 40))
ok(len(al) == 1 and "files its earnings release" in al[0]["head"] and "4:30:41 PM ET" in al[0]["trigger"], f"EDGAR 8-K alert first: {[a['head'] for a in al]}")
ok(not live, "numbers not in yet -> nothing merged")
al, live = w.poll(at(16, 1, 0))
ok(len(al) == 1 and "EPS 2.05 vs est 1.99" in al[0]["head"] and al[0]["impact"].startswith("Bullish"), f"numbers alert with beat: {[a['head'] + ' / ' + a['impact'] for a in al]}")
ok(live.get("AAPL", {}).get("epsActual") == 2.05 and live["AAPL"].get("seen_at"), "live row carries actuals and seen time")
ok(w.interval(at(16, 1, 10)) is None, "AAPL done -> polling stops")
ok(w.poll(at(16, 1, 20)) == ([], {}), "no repeat alerts")
w2 = EW.Watch(TOR, {"day": "2026-11-02", "calls": EW.EW_BUDGET, "done": {}, "filed": {"AAPL": {}}}); w2.key = "k"; w2.rows = dict(w.rows)
n0 = state["n"]; w2.poll(at(16, 5))
ok(state["n"] == n0, "daily FMP budget respected")
print(f"{P}/{N} passed")
sys.exit(0 if P == N else 1)
