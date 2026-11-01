"""Briefing: clustering, ranking, tags and the rule-based desk read (no network)."""
import datetime as dt, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import briefing as B

n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1

t = lambda h: (B.NOW - dt.timedelta(hours=h)).isoformat()
items = [
    {"ts": t(1), "title": "Trump threatens new tariffs on Canadian steel and aluminum", "url": "u1", "outlet": "Reuters", "domain": "reuters.com"},
    {"ts": t(2), "title": "Trump threatens tariffs on Canadian steel, aluminum imports", "url": "u2", "outlet": "CTV News", "domain": "ctvnews.ca"},
    {"ts": t(3), "title": "New tariffs threatened on Canadian steel and aluminum by Trump", "url": "u3", "outlet": "Local Paper", "domain": "local.ca"},
    {"ts": t(1), "title": "Bank of Canada holds rate, signals patience", "url": "u4", "outlet": "Small Blog", "domain": "blog.ca"},
    {"ts": t(5), "title": "Maple Leafs win in overtime, NHL standings", "url": "u5", "outlet": "Sports", "domain": "sports.ca"},
    {"ts": t(60), "title": "Old tariff story from last week", "url": "u6", "outlet": "Reuters", "domain": "reuters.com"},
]
C = B.cluster(items, None)
ok(len(C) == 2, f"three outlets on one story cluster, sports and stale items dropped: {[c['title'] for c in C]}")
ok(C[0]["n"] == 3 and C[0]["outlet"] == "Reuters", "lead is the tier-one headline, outlet count kept")
ok(C[0]["score"] > C[1]["score"], "widely carried story ranks first")
ok("trade" in C[0]["tags"], "tariff story tagged trade")
ok("CAD" in B.why_of("Trump threatens new tariffs on Canadian steel", "trade"), "tariff read points at CAD")
ok("rate gap" in B.why_of("Bank of Canada raises rates by 25 bps", "policy") or "Tightening" in B.why_of("Bank of Canada raises rates by 25 bps", "policy"), "rate hike read")
ok("grain" in B.why_of("Canola prices jump as harvest wraps", "energy_ag").lower(), "farm story points at the grain desk")
ok(B.why_of("Something unrelated happens", "politics") == B.WHY_DEFAULT["politics"], "fallback read per section")
ok(B.cluster(items, r"bank of canada")[0]["title"].startswith("Bank of Canada"), "section keyword filter keeps on-topic items only")
print(f"{n}/{n} passed")
