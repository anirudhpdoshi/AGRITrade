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
p = E.plan(st, ["ADM", "DE"], ["Bunge", "Deere"], sat)
eps = [(c[0], c[1]) for c in p]
ok(("search", "Deere") in eps and ("search", "Bunge") not in eps, "only unresolved names are searched")
ok(("quote", "ADM") not in eps and ("profile", "ADM") not in eps, "a fresh, closed-market symbol costs nothing")
ok(("quote", "DE") in eps and ("profile", "DE") in eps and ("quote", "BG") in eps, "new and resolved symbols are fetched")
ok(eps.index(("search", "Deere")) < eps.index(("quote", "DE")) < eps.index(("profile", "DE")), "order: search, quotes, profiles")
ok(len(E.plan(st, ["ADM", "adm"], [], sat)) == 0, "duplicate tickers are not double-called")

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

print(f"us_earnings: {n} checks passed")
