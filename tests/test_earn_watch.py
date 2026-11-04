"""Earnings release watch: 10 s for 2 min from the slot, then 30 s until the numbers land; EDGAR 8-K and FMP numbers."""
import os, sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import earn_watch as EW  # noqa: E402
def _no_net(*a, **k):
    raise RuntimeError("no network in tests")
EW.requests.get = _no_net   # every network path must be stubbed; nothing reaches the SEC or FMP from a test

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
ok(w.interval(at(5, 59)) is None, "before 6:00 am nothing is due")
ok(w.interval(at(6, 1)) == 10, "BMO slot 6:00 -> 10 s polling in the first 2 minutes")
ok(w.interval(at(9, 0)) == 30, "BMO not found yet at 9:00 -> still watched every 30 s")
ok(w.interval(at(16, 0, 30)) == 10, "AMC slot 4:00 pm -> 10 s at 4:00:30")
ok(w.interval(at(16, 3)) == 30, "after 2 minutes -> 30 s")
w.rows["XOM"]["epsActual"] = None; w.st["done"]["XOM"] = {"seen_at": "x"}
ok(w.interval(at(23, 1)) is None, "AMC watch ends at 11 pm; BMO / unknown at 8 pm")

w.key = "k"
w.edgar = lambda s, now: None   # hermetic: no network in tests (CI can reach the SEC, this sandbox cannot)
w._cik = lambda s: 320193 if s == "AAPL" else None
w.current_8k = lambda now: {320193: {"acc": "0000320193-26-000101", "at": "2026-11-02T16:30:41-05:00", "url": "https://www.sec.gov/x"}} if now >= at(16, 0, 40) else {}
_unused = lambda s, now: {"acc": "0000320193-26-000101", "at": "2026-11-02T16:30:41-05:00", "url": "https://www.sec.gov/x"} if s == "AAPL" and now >= at(16, 0, 40) else None
w.read_pr = lambda s, f: {"rev": 114.477e9, "eps_d": 2.10, "gm": 47.89, "exhibit": "https://www.sec.gov/ex991.htm"}
state = {"n": 0}


def fake_fmp(ep, params, key):
    state["n"] += 1
    return []


EW.UE.fmp = fake_fmp
al, live, prs = w.poll(at(16, 0, 10))
ok(state["n"] == 1 and not al, "no 8-K yet -> one FMP fallback read, nothing to report")
w.poll(at(16, 0, 20))
ok(state["n"] == 1, "FMP fallback at most every 2 minutes (10 s polls hit EDGAR only)")
al, live, prs = w.poll(at(16, 0, 40))
ok(len(al) == 1 and "GAAP EPS 2.1" in al[0]["head"] and "4:30:41 PM ET" in al[0]["trigger"] and "not comparable" in al[0]["trigger"],
   f"8-K found in EDGAR's live filings list and read in the same poll -> numbers alert from the press release: {[a['head'] + ' | ' + a['trigger'] for a in al]}")
ok(live["AAPL"]["epsActual"] == 2.10 and live["AAPL"]["src"].startswith("SEC EDGAR") and prs["AAPL"]["gm"] == 47.89, "live row sourced from EDGAR; press-release lines stored")
ok(state["n"] == 1, "no FMP call once the 8-K is readable")
ok(w.interval(at(16, 1, 10)) is None, "AAPL done -> polling stops")
ok(w.poll(at(16, 1, 20)) == ([], {}, {}), "no repeat alerts")
w2 = EW.Watch(TOR, {"day": "2026-11-02", "calls": EW.EW_BUDGET, "done": {}, "filed": {}}); w2.key = "k"; w2.rows = dict(w.rows); w2.edgar = lambda s, now: None
w2._cik = lambda s: None; w2.current_8k = lambda now: {}
n0 = state["n"]; w2.poll(at(16, 5))
ok(state["n"] == n0, "daily FMP budget respected")
B = EW.board(w, at(16, 5), prs, live)
st = {x["s"]: x["status"] for x in B["items"]}
ok(st.get("AAPL") == "new" and B["items"][0]["s"] == "AAPL", f"board: AAPL NEW first: {st}")
w3 = EW.Watch(TOR, {"day": "2026-11-02", "done": {}, "filed": {}}); w3.rows = {"ADM": {"symbol": "ADM", "date": "2026-11-02", "time": "bmo", "eps_f": 1.63}, "AMD": {"symbol": "AMD", "date": "2026-11-02", "time": "amc"}}
S = {x["s"]: x["status"] for x in EW.board(w3, at(9, 0), {}, {})["items"]}
ok(S == {"ADM": "refreshing", "AMD": "upcoming"}, f"slot passed without a release -> REFRESHING, not NEW: {S}")
print(f"{P}/{N} passed")
sys.exit(0 if P == N else 1)
