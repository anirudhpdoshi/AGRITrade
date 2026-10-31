"""Call-planning checks for scripts/us_earnings.py (no network). The point of these is the FMP budget: no call is
planned unless it can return something new."""
import os, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import us_earnings as E

NY = ZoneInfo("America/New_York")
n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1
def ny(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=NY).astimezone(timezone.utc)

# sessions
ok(E.market_open(ny(2026, 10, 30, 10)), "Friday 10:00 NY is open")
ok(not E.market_open(ny(2026, 10, 30, 16, 0)), "16:00 is closed")
ok(not E.market_open(ny(2026, 10, 31, 11)), "Saturday is closed")
ok(E.last_close(ny(2026, 10, 31, 11)) == ny(2026, 10, 30, 16), "Saturday's last close is Friday 16:00")
ok(E.last_close(ny(2026, 11, 2, 9)) == ny(2026, 10, 30, 16), "Monday pre-open's last close is Friday")
ok(E.last_close(ny(2026, 11, 2, 17)) == ny(2026, 11, 2, 16), "Monday evening's last close is Monday")

# quotes
sat = ny(2026, 10, 31, 11)
ok(E.quote_due(None, sat)[0], "no quote -> due")
ok(E.quote_due(ny(2026, 10, 30, 15), sat)[0], "Friday 15:00 quote lacks the close -> due once")
ok(not E.quote_due(ny(2026, 10, 30, 17), sat)[0], "closing quote stored -> weekend run makes no quote call")
ok(E.quote_due(ny(2026, 10, 30, 16, 2), sat)[0], "a quote 2 min after the bell may miss the close print")
ok(E.quote_due(ny(2026, 10, 30, 17), sat, force=True)[0], "force overrides")
mon = ny(2026, 11, 2, 11)
ok(not E.quote_due(mon - timedelta(minutes=5), mon)[0], "open market, 5-min-old quote -> not due")
ok(E.quote_due(mon - timedelta(minutes=12), mon)[0], "open market, 12-min-old quote -> due")

# profiles
ok(E.profile_due(None, sat)[0] and not E.profile_due(sat - timedelta(days=3), sat)[0] and E.profile_due(sat - timedelta(days=8), sat)[0], "profile cached 7 days")

# plan
st = {"companies": {"ADM": {"quote": {"fetched_at": E.iso(ny(2026, 10, 30, 17))}, "profile": {"fetched_at": E.iso(sat - timedelta(days=1))}}},
      "resolved": {"bunge": {"symbol": "BG"}}}
p = E.plan(st, ["ADM", "DE"], ["Bunge", "Deere"], sat, calendar=False)
eps = [(c[0], c[1]) for c in p]
ok(("search", "Deere") in eps and ("search", "Bunge") not in eps, "only unresolved names are searched")
ok(("quote", "ADM") not in eps and ("profile", "ADM") not in eps, "a fresh, closed-market symbol costs nothing")
ok(("quote", "DE") in eps and ("profile", "DE") in eps and ("quote", "BG") in eps, "new and resolved symbols are fetched")
ok(eps.index(("search", "Deere")) < eps.index(("quote", "DE")) < eps.index(("profile", "DE")), "order: search, quotes, profiles")
ok(len(E.plan(st, ["ADM", "adm"], [], sat, calendar=False)) == 0, "duplicate tickers are not double-called")

# ledger
u = E.ledger_today({"day": "2026-10-30", "total": 37, "calls": {"quote": 30, "profile": 7, "search": 0}}, sat)
ok(u["day"] == "2026-10-31" and u["total"] == 0 and u["history"][-1]["total"] == 37, "ledger rolls at the UTC day")
u2 = E.ledger_today({"day": "2026-10-31", "total": 5, "calls": {"quote": 5}}, sat)
ok(u2["total"] == 5, "same day keeps counting")
ok(E.allowance(dict(u2, budget=200, run_cap=40)) == 40 and E.allowance(dict(u2, total=190, budget=200, run_cap=40)) == 10, "allowance = min(budget left, run cap)")

# search match
res = [{"symbol": "ADM.DE", "name": "Archer-Daniels-Midland Company", "exchange": "XETRA", "currency": "EUR"},
       {"symbol": "ADM", "name": "Archer-Daniels-Midland Company", "exchange": "NYSE", "currency": "USD"}]
ok(E.pick_match(res, "archer-daniels-midland company")["symbol"] == "ADM", "US listing preferred")
ok(E.pick_match([], "x") is None, "no hit -> None")

# 402 on quote: profile stands in, one call per symbol, never a dead quote retry
rq = {"companies": {"ADM": {"quote_error": {"at": E.iso(sat), "msg": "HTTP 402 Payment Required"}, "profile": {"fetched_at": E.iso(sat)}}}}
ok(E.quote_restricted(rq["companies"]["ADM"], sat), "an old 402 quote_error counts as restricted")
pr = [(c[0], c[1]) for c in E.plan(rq, ["ADM"], [], sat, calendar=False)]
ok(pr == [("profile", "ADM")], "restricted symbol with a price-less profile -> one profile call, no quote")
rq["companies"]["ADM"]["profile"] = {"fetched_at": E.iso(ny(2026, 10, 30, 17)), "price": 61.2}
ok(E.plan(rq, ["ADM"], [], sat, calendar=False) == [], "restricted symbol with a closing price stored -> weekend run costs 0")
ok(not E.quote_restricted({"quote_restricted": {"at": E.iso(sat - timedelta(days=31))}}, sat), "restriction expires after 30 days")

# endpoint register: what the plan allows and what we fall back to
eps = {}
E.note_endpoint(eps, "quote", "ok", "AAPL", sat)
E.note_endpoint(eps, "quote", E.outcome(RuntimeError("HTTP 402 Payment Required")), "ADM", sat)
ok(eps["quote"]["status"] == "partial" and eps["quote"]["blocked_syms"] == ["ADM"], "AAPL ok + ADM 402 -> partial (symbol-limited)")
ok("profile" in eps["quote"]["fallback"], "quote's fallback is named")
E.note_endpoint(eps, "earnings", E.outcome(RuntimeError("HTTP 402")), "ADM", sat)
ok(eps["earnings"]["status"] == "not_in_plan", "402 only -> not in plan")
E.note_endpoint(eps, "profile", "ok", "ADM", sat); E.note_endpoint(eps, "profile", "error", "BG", sat, "HTTP 500")
ok(eps["profile"]["status"] == "ok" and eps["profile"]["last_error"]["msg"] == "HTTP 500", "a transient error does not mark an endpoint unavailable")
ok([p[0] for p in E.probes(sat)] == ["search-name", "quote", "earnings-calendar", "earnings"], "plan check = 4 calls")

# earnings calendar: one call for all tickers, daily, plus hourly re-checks only while actuals are pending
ok(E.calendar_due(None, sat)[0], "no calendar -> due")
cal = {"fetched_at": E.iso(sat - timedelta(hours=2)), "rows": [{"symbol": "CF", "date": "2026-11-04"}]}
ok(not E.calendar_due(cal, sat)[0], "2 h old, nothing reported yet -> not due")
ok(E.calendar_due(dict(cal, fetched_at=E.iso(sat - timedelta(hours=25))), sat)[0], "a day old -> due")
wed = ny(2026, 11, 4, 17, 30)
cal2 = {"fetched_at": E.iso(wed - timedelta(minutes=90)), "rows": [{"symbol": "CF", "date": "2026-11-04", "epsActual": None}]}
ok(E.calendar_due(cal2, wed)[0] and "CF" in E.calendar_due(cal2, wed)[1], "report day without actuals -> hourly re-check")
ok(not E.calendar_due(dict(cal2, fetched_at=E.iso(wed - timedelta(minutes=20))), wed)[0], "...but not more than hourly")
ok(E.plan({"endpoints": {"earnings-calendar": {"status": "not_in_plan"}}}, [], [], sat) == [], "calendar out of plan -> never called")
ok([c[0] for c in E.plan({}, [], [], sat)] == ["earnings-calendar"], "calendar is one call regardless of watchlist size")
ok(E.surprise(1.1, 1.0) == 10.0 and E.surprise(-0.9, -1.0) == 10.0 and E.surprise(1, 0) is None, "surprise % vs |estimate|")
sc = E.shape_calendar([{"symbol": "CF", "date": "2026-11-04", "epsActual": 1.2, "epsEstimated": 1.0}, {"symbol": "AAPL", "date": "2026-11-01"}], {"CF"}, "a", "b", sat)
ok(sc["rows_total"] == 2 and sc["symbols_total"] == 2 and [r["symbol"] for r in sc["rows"]] == ["CF"] and sc["rows"][0]["eps_surprise_pct"] == 20.0, "calendar keeps watchlist rows + coverage counts")

print(f"us_earnings: {n} checks passed")
