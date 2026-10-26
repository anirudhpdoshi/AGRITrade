"""Unit tests for the world-markets alert engine (scripts/world.py). Deterministic fixtures only — labelled test data.
Run: python tests/test_world.py"""
import os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import world as W

n = fail = 0
def t(name, fn):
    global n, fail; n += 1
    try: fn(); print("  ok  " + name)
    except AssertionError as e: fail += 1; print("  FAIL " + name + "  " + str(e))
def close(a, b, eps=1e-9): assert abs(a - b) <= eps, f"{a} != {b}"
NOW = datetime(2026, 10, 26, 15, 0, tzinfo=timezone.utc)        # Mon 11:00 ET (test data)
def rec(last, prev=100.0, opn=100.0, kind="price", fresh=True, day="2026-10-26", id_="tst"):
    return {"id": id_, "name": "TEST", "kind": kind, "last": last, "prev_close": prev, "open": opn, "session_date": day, "fresh": fresh, "ts": NOW.isoformat()}

print("percent maths")
t("pct(102, 100) = +2", lambda: close(W.pct(102, 100), 2.0))
t("pct(98, 100) = -2", lambda: close(W.pct(98, 100), -2.0))
t("pct undefined on zero / missing reference", lambda: (W.pct(1, 0) is None and W.pct(None, 1) is None) or (_ for _ in ()).throw(AssertionError()))
t("tiers: 0.99 none, 1 Watch, 2 Major, 3 Extreme, 5 Exceptional", lambda: [W.tier_of(x)[1] for x in (0.99, 1, 2, 3, 5.2)] == [None, "Watch", "Major", "Extreme", "Exceptional"] or (_ for _ in ()).throw(AssertionError([W.tier_of(x) for x in (0.99, 1, 2, 3, 5.2)])))
t("tiers symmetric for downside", lambda: W.tier_of(-2.0) == (2, "Major") or (_ for _ in ()).throw(AssertionError(W.tier_of(-2.0))))
t("yield tiers in bp: 9 bp Watch, 10 bp Major", lambda: (W.tier_of(9, True)[1], W.tier_of(10, True)[1]) == ("Watch", "Major") or (_ for _ in ()).throw(AssertionError()))

print("alert engine")
def up2():
    st = {}; ev = W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    assert len(ev) == 1 and ev[0]["dir"] == "up" and ev[0]["severity"] == "Major" and ev[0]["basis"] == "prev_close", ev
t("+2% vs previous close -> one upward Major alert", up2)
def dn2():
    ev = W.evaluate_alerts(rec(97.9, opn=None), {}, NOW)
    assert len(ev) == 1 and ev[0]["dir"] == "down" and ev[0]["move"] == -2.1, ev
t("-2.1% -> downward Major alert", dn2)
def nodup():
    st = {}; W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    for k in range(5):
        assert W.evaluate_alerts(rec(102.2, opn=None), st, NOW + timedelta(minutes=15 * (k + 1))) == []
t("same breach on later polls -> no repeat alerts", nodup)
def esc():
    st = {}; W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    ev = W.evaluate_alerts(rec(103.1, opn=None), st, NOW + timedelta(minutes=5))
    assert len(ev) == 1 and ev[0]["kind"] == "escalation" and ev[0]["severity"] == "Extreme", ev
t("crossing a higher tier re-alerts immediately (bypasses cooldown)", esc)
def rearm():
    st = {}; W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    W.evaluate_alerts(rec(100.5, opn=None), st, NOW + timedelta(minutes=15))        # back below Watch
    ev = W.evaluate_alerts(rec(102.0, opn=None), st, NOW + timedelta(minutes=60))
    assert len(ev) == 1 and ev[0]["kind"] == "crossing", ev
t("falls back below threshold then crosses again -> new alert", rearm)
def cool():
    st = {}; W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    W.evaluate_alerts(rec(100.5, opn=None), st, NOW + timedelta(minutes=5))
    assert W.evaluate_alerts(rec(102.0, opn=None), st, NOW + timedelta(minutes=10)) == []   # inside 30-min cooldown
t("re-crossing inside the cooldown is suppressed", cool)
def bases():
    ev = W.evaluate_alerts(rec(102.0, prev=100, opn=99.0), {}, NOW)
    assert sorted(e["basis"] for e in ev) == ["prev_close", "session_open"], ev
t("session-open and previous-close are tracked separately", bases)
t("stale / closed-market quote never alerts", lambda: W.evaluate_alerts(rec(110, fresh=False), {}, NOW) == [] or (_ for _ in ()).throw(AssertionError()))
def newday():
    st = {}; W.evaluate_alerts(rec(102.0, opn=None), st, NOW)
    ev = W.evaluate_alerts(rec(102.0, opn=None, day="2026-10-27"), st, NOW + timedelta(days=1))
    assert len(ev) == 1, ev
t("state resets on a new session", newday)
def ybp():
    ev = W.evaluate_alerts(rec(4.12, prev=4.00, opn=None, kind="yield"), {}, NOW)
    assert len(ev) == 1 and ev[0]["unit"] == "bp" and abs(ev[0]["move"] - 12.0) < 1e-9 and ev[0]["severity"] == "Major", ev
t("yields alert on basis points (+12 bp = Major)", ybp)
t("missing reference price -> no alert, no crash", lambda: W.evaluate_alerts(rec(102, prev=None, opn=None), {}, NOW) == [] or (_ for _ in ()).throw(AssertionError()))

print("52-week")
def w_new():
    w = W.week52([90, 95, 100], [80, 85, 88], 101, 101.5, 99)
    assert w["new_high"] and not w["new_low"] and w["high"] == 101.5 and w["near_high"], w
t("today's high above prior 52w high -> NEW 52W HIGH", w_new)
def w_near():
    w = W.week52([100], [50], 96, 96.5, 95)
    assert not w["new_high"] and w["near_high"] and abs(w["pct_from_high"] - 4.0) < 1e-9, w
t("within 5% of the 52w high flagged near (96 vs 100 = 4% away)", w_near)
def w_far():
    w = W.week52([100], [50], 80, 81, 79); assert not w["near_high"] and not w["near_low"], w
t("mid-range -> no proximity flag", w_far)
def w_low():
    w = W.week52([100], [50], 51.5, 53, 49.5); assert w["new_low"] and w["near_low"], w
t("today's low under prior 52w low -> NEW 52W LOW", w_low)

print("sessions (DST, breaks, weekends)")
NY = W.EXCHANGES["NYSE"]
t("NYSE open 10:00 ET in March after DST change (14:00 UTC)", lambda: W.session_status(NY, datetime(2026, 3, 9, 14, 0, tzinfo=timezone.utc))["state"] == "open" or (_ for _ in ()).throw(AssertionError()))
t("NYSE closed 14:00 UTC before DST change (09:00 ET)", lambda: W.session_status(NY, datetime(2026, 3, 6, 14, 0, tzinfo=timezone.utc))["state"] == "pre" or (_ for _ in ()).throw(AssertionError()))
t("Tokyo lunch break 12:00 JST", lambda: W.session_status(W.EXCHANGES["TSE"], datetime(2026, 10, 26, 3, 0, tzinfo=timezone.utc))["state"] == "break" or (_ for _ in ()).throw(AssertionError()))
t("FX open Sunday 18:00 ET", lambda: W.session_status(W.EXCHANGES["FX"], datetime(2026, 10, 25, 22, 0, tzinfo=timezone.utc))["state"] == "open" or (_ for _ in ()).throw(AssertionError()))
t("FX closed Saturday", lambda: W.session_status(W.EXCHANGES["FX"], datetime(2026, 10, 24, 15, 0, tzinfo=timezone.utc))["state"] == "closed" or (_ for _ in ()).throw(AssertionError()))
t("Globex daily break 16:30 CT", lambda: W.session_status(W.EXCHANGES["CME"], datetime(2026, 10, 26, 21, 30, tzinfo=timezone.utc))["state"] == "break" or (_ for _ in ()).throw(AssertionError()))
t("ASX open 11:00 Sydney (AEDT)", lambda: W.session_status(W.EXCHANGES["ASX"], datetime(2026, 10, 26, 0, 0, tzinfo=timezone.utc))["state"] == "open" or (_ for _ in ()).throw(AssertionError()))
print(f"\n{n - fail}/{n} passed"); sys.exit(1 if fail else 0)
