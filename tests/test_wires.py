"""Wires: feed parsing, relevance filter, breaking rules, dedupe across wires."""
import os, sys
from datetime import datetime, timedelta, timezone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import wires as W  # noqa: E402

N = P = 0
def ok(c, m):
    global N, P
    N += 1; P += bool(c); print(("PASS " if c else "FAIL ") + m)

now = datetime(2026, 11, 3, 1, 0, tzinfo=timezone.utc)
rss = lambda items: "<rss><channel>" + "".join(f"<item><title><![CDATA[{t}]]></title><link>{u}</link><pubDate>{d}</pubDate></item>" for t, u, d in items) + "</channel></rss>"
d0 = "Tue, 3 Nov 2026 00:30:00 +0000"
FEEDS = {
    "bw": rss([("Apple Reports Fourth Quarter Results", "https://bw/1", d0), ("Local Bakery Opens Second Store", "https://bw/2", d0), ("Nutrien Announces New Potash Mine", "https://bw/3", d0)]),
    "prn": rss([("Apple Reports Fourth Quarter Results", "https://prn/1", d0), ("Deere to Acquire Robotics Startup", "https://prn/2", "Mon, 2 Nov 2026 12:00:00 +0000")]),
    "fed": rss([("Federal Reserve issues FOMC statement", "https://fed/1", d0), ("Board announces approval of application", "https://fed/2", d0)]),
    "usda": rss([("USDA Announces Wheat Export Deal with China", "https://usda/1", d0)]),
}
class R:
    def __init__(s, t, c=200): s.text, s.status_code = t, c
    def json(s): return {"releases": []}
def get(u, h):
    k = next((k for k, l, url, kind in W.SOURCES if url == u), None)
    return R(FEEDS.get(k, ""), 200 if k in FEEDS or k == "prf" else 403)
items, health = W.fetch(now, get)
T = [i["title"] for i in items]
ok("Local Bakery Opens Second Store" not in T, "irrelevant press releases are dropped")
ok(T.count("Apple Reports Fourth Quarter Results") == 1, "same release on two wires appears once")
ap = next(i for i in items if i["title"].startswith("Apple"))
ok(ap["breaking"] and ap["tick"] == ["AAPL"], "top-100 results release -> BREAKING with ticker")
ok(not next(i for i in items if i["title"].startswith("Deere"))["breaking"], "material but older than 2 h -> plain wire item")
ok(next(i for i in items if "Nutrien" in i["title"])["tick"] == ["NTR"], "watchlist agri name matched")
ok(next(i for i in items if "FOMC" in i["title"])["breaking"] and not next(i for i in items if "approval of application" in i["title"])["breaking"], "Fed: policy releases break, routine approvals do not")
ok(next(i for i in items if "USDA" in i["title"])["breaking"], "agri-relevant USDA release -> BREAKING")
ok(health.get("gnw") is None and str(health.get("cftc", "")).startswith("HTTP 403"), "a failing source is reported in health, others continue")
fired = {}
a = W.alerts_from(items, fired, now)
ok(len(a) == 3 and all(x["head"].startswith("BREAKING – ") for x in a), f"breaking items -> desk alerts: {[x['head'] for x in a]}")
ok(not W.alerts_from(items, fired, now), "each wire alert fires once")
print(f"{P}/{N} passed"); sys.exit(0 if P == N else 1)
