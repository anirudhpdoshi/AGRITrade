"""Health monitor logic (no network): scheduler slot rules and session clocks."""
import os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import health as H
n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1
U = timezone.utc
mon = datetime(2026, 11, 9, 0, 0, tzinfo=U)            # Monday
S = H._slots("refresh-data.yml", mon, mon + timedelta(days=1) - timedelta(minutes=1))
ok(len(S) == 48 and S[0].hour == 11 and S[-1].strftime("%H:%M") == "22:45", "refresh-data: 48 quarter-hours 11:00-22:45 UTC on a weekday")
sat = datetime(2026, 11, 7, 0, 0, tzinfo=U)
ok(len(H._slots("refresh-data.yml", sat, sat + timedelta(days=1) - timedelta(minutes=1))) == 1, "Saturday: only the 00:30 evening sweep")
ok(len(H._slots("briefing.yml", sat, sat + timedelta(days=1) - timedelta(minutes=1))) == 48, "briefing every 30 min, every day")
ok(len(H._slots("policy-intel.yml", sat, sat + timedelta(days=1) - timedelta(minutes=1))) == 0, "policy intel off on Saturday")
ok(not H.fx_open(datetime(2026, 11, 7, 15, 0, tzinfo=U)) and H.fx_open(datetime(2026, 11, 9, 15, 0, tzinfo=U)), "FX closed Saturday, open Monday")
ok(H.cbot_day(datetime(2026, 11, 9, 16, 0, tzinfo=U)) and not H.cbot_day(datetime(2026, 11, 9, 20, 0, tzinfo=U)), "CBOT day session 8:30-13:20 CT")
print(f"{n}/{n} passed")
