#!/usr/bin/env python3
"""Price cues for the Intelligence desk (owner, Nov 27 2026): what moved the agri complex, flowed through the universe.

For every market in the universe (soybeans, meal, oil, corn, wheat, canola, crude, USD/CAD, dollar index):
  * moves      1-day / 1-week (5 sessions) / 1-month (21 sessions) from Yahoo daily bars (the current session's bar
               is included while it trades)
  * levels     20/50/100/200-day moving averages, 20-day high/low, where price sits against each
  * inflection the swing highs/lows (zig-zag pivots) where a substantial rise or drop began, with the move since
  * cues       headlines from top agri and market sources (Google News RSS restricted to those outlets), tagged
               to a driver (China demand, export sales, USDA/WASDE, South America weather, biofuel policy, crude,
               dollar, Black Sea, fund positioning, trade policy...) and to every market that driver moves.
               "Pre-market" = published since the previous CBOT settlement (2:20 pm ET).
Headline tone and driver tags are RULE-BASED keyword inference and are labelled as such; prices are as published.
Writes cues.json to the orphan branch `cues` (read by cues-ui.js). Run: python scripts/cues.py [--dry-run]
"""
import json, os, re, subprocess, sys, time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ud_common as UDC

ROOT = str(UDC.ROOT)
WT = os.path.join(ROOT, ".cues-wt")
BRANCH = "cues"
ETZ = ZoneInfo("America/Toronto")
UA = {"User-Agent": "Mozilla/5.0 (AGRITrade desk price cues; contact via repository)"}

# key: (yahoo symbol, name, unit, decimals, divisor, zig-zag threshold %, google-news query)
U = {
    "soybeans": ("ZS=F", "Soybeans", "$/bu", 4, 100, 4.0, "soybeans OR soybean futures"),
    "soymeal": ("ZM=F", "Soybean meal", "$/st", 1, 1, 5.0, '"soybean meal" OR soymeal'),
    "soyoil": ("ZL=F", "Soybean oil", "¢/lb", 2, 1, 6.0, '"soybean oil" OR soyoil OR biofuel'),
    "corn": ("ZC=F", "Corn", "$/bu", 4, 100, 4.0, "corn futures OR corn prices OR corn exports"),
    "wheat": ("ZW=F", "Wheat", "$/bu", 4, 100, 5.0, "wheat futures OR wheat prices OR wheat exports"),
    "canola": ("RS=F", "Canola (ICE)", "C$/t", 1, 1, 4.0, "canola"),
    "wti": ("CL=F", "WTI crude", "$/bbl", 2, 1, 7.0, "crude oil prices OR OPEC"),
    "usdcad": ("CAD=X", "USD/CAD", "", 4, 1, 1.5, "Canadian dollar OR loonie"),
    "dxy": ("DX-Y.NYB", "US dollar index", "", 2, 1, 1.5, '"dollar index" OR "U.S. dollar"'),
}
SITES = [  # top public sources for the grain and oilseed complex
    ["reuters.com", "bloomberg.com", "wsj.com", "ft.com", "cnbc.com", "marketwatch.com", "barchart.com", "nasdaq.com"],
    ["brownfieldagnews.com", "farmprogress.com", "agweb.com", "dtnpf.com", "agriculture.com", "producer.com", "grainews.ca",
     "farms.com", "farmdocdaily.illinois.edu", "usda.gov", "agri-pulse.com", "successful-farming.com", "world-grain.com", "feedstuffs.com"],
]
DRIVERS = [  # id, label, regex, markets it moves
    ("china", "China demand", r"\bchin(a|ese)\b|beijing|sinograin|cofco", ["soybeans", "soymeal", "soyoil", "corn", "wheat", "canola"]),
    ("exports", "US export sales / flash sales", r"exports?\b|export sales|export inspections|flash sale|private exporters|shipments|export demand", ["soybeans", "soymeal", "corn", "wheat"]),
    ("usda", "USDA reports (WASDE, crop progress)", r"\bwasde\b|usda (report|estimate|forecast)|crop progress|supply and demand|ending stocks|acreage report|grain stocks", ["soybeans", "soymeal", "soyoil", "corn", "wheat"]),
    ("samerica", "South America weather & crop", r"brazil|argentin|south americ|mato grosso|safrinha|la ni[nñ]a|el ni[nñ]o|paraguay", ["soybeans", "soymeal", "soyoil", "corn"]),
    ("weather", "North America weather", r"drought|rainfall|\brain\b|frost|heat wave|dry weather|winter wheat condition|snow", ["corn", "soybeans", "wheat", "canola"]),
    ("biofuel", "Biofuel policy (RVO, 45Z, blending)", r"biofuel|biodiesel|renewable diesel|\brvo\b|renewable fuel|45z|\bepa\b|ethanol|blend", ["soyoil", "soybeans", "corn", "canola"]),
    ("energy", "Crude & energy", r"\bcrude\b|opec|brent|\bwti\b|energy prices|oil prices", ["wti", "soyoil", "canola", "corn", "usdcad"]),
    ("dollar", "US dollar & FX", r"\bdollar\b|currenc|\breal\b|\bpeso\b|loonie|\bfx\b", ["dxy", "usdcad", "soybeans", "corn", "wheat", "canola"]),
    ("blacksea", "Black Sea (Russia / Ukraine)", r"russia|ukrain|black sea|odes+a|kremlin|grain corridor", ["wheat", "corn", "soyoil", "wti"]),
    ("funds", "Fund positioning & technicals", r"\bfunds?\b|short[- ]covering|speculat|\bcftc\b|commitments of traders|managed money|technical|chart|moving average", ["soybeans", "soymeal", "soyoil", "corn", "wheat", "canola"]),
    ("trade", "Trade policy & tariffs", r"tariff|trade (deal|war|talks|agreement|truce)|section 301|retaliat|sanction", ["soybeans", "corn", "wheat", "canola", "usdcad", "dxy"]),
    ("crush", "Crush & meal/oil demand", r"\bcrush|\bnopa\b|processing|soy(bean)? meal demand|oil share", ["soymeal", "soyoil", "soybeans"]),
    ("harvest", "Harvest / planting progress", r"harvest|planting|seeding|\byield", ["corn", "soybeans", "wheat", "canola"]),
    ("logistics", "Logistics (barge, rail, ports)", r"barge|mississippi|\brail\b|\bport\b|freight|strike|shipping lane", ["soybeans", "corn", "wheat", "canola"]),
    ("macro", "Macro risk (Fed, equities)", r"federal reserve|\bfed\b|interest rate|inflation|stocks? (rall|fell|slid)|wall street|recession", ["dxy", "usdcad", "wti"]),
]
BULL = r"rall(y|ies|ied)|surg|soar|jump|climb|gain|higher|\brises?\b|\brose\b|rebound|strong|tight|\bbuy|purchas|bullish|spike|advance|firm"
BEAR = r"\bfall|\bfell\b|drop|slump|plung|slid|slide|lower|declin|weak|cancel|\bloss|pressure|glut|ample|bearish|retreat|tumbl|sink|sank|ease[sd]?\b"


def now():
    return datetime.now(timezone.utc)


def last_settle(t, M=None):
    """Previous CBOT settlement (2:20 pm ET). Uses the soybean bar dates when present, so holidays are skipped."""
    e = t.astimezone(ETZ)
    sb = (M or {}).get("soybeans")
    if sb:
        d = sb["prev_date"] if sb["date"] == e.strftime("%Y-%m-%d") else sb["date"]
        return datetime.fromisoformat(d + "T14:20:00").replace(tzinfo=ETZ).astimezone(timezone.utc)
    s = e.replace(hour=14, minute=20, second=0, microsecond=0)
    if e < s:
        s -= timedelta(days=1)
    while s.weekday() >= 5:
        s -= timedelta(days=1)
    return s.astimezone(timezone.utc)


# ------------------------------------------------------------------ prices
def bars(sym, div):
    h = UDC.yf().Ticker(sym).history(period="14mo", interval="1d", auto_adjust=False)["Close"].dropna()
    return [[d.strftime("%Y-%m-%d"), float(v) / div] for d, v in h.items() if float(v) == float(v) and float(v) > 0]


def pct(a, b):
    return round((a / b - 1) * 100, 2) if b else None


def zigzag(d, th):
    """Pivots where a move of at least th% began. d: [[date, px]] ascending. The last pivot's move runs to the latest close."""
    if len(d) < 3:
        return []
    piv, trend, hi, lo = [], 0, 0, 0
    for i in range(1, len(d)):
        px = d[i][1]
        if px > d[hi][1]:
            hi = i
        if px < d[lo][1]:
            lo = i
        if trend >= 0 and pct(px, d[hi][1]) <= -th and (trend == 1 or hi < i):
            piv.append((hi, "high")); trend, lo = -1, i
        elif trend <= 0 and pct(px, d[lo][1]) >= th and (trend == -1 or lo < i):
            piv.append((lo, "low")); trend, hi = 1, i
    out = []
    for k, (i, kind) in enumerate(piv):
        j = piv[k + 1][0] if k + 1 < len(piv) else len(d) - 1
        out.append({"d": d[i][0], "px": d[i][1], "kind": kind, "to": d[j][0], "to_px": d[j][1], "move": pct(d[j][1], d[i][1]), "open": k + 1 == len(piv)})
    return out


def market(key):
    sym, name, unit, dec, div, th, _ = U[key]
    d = bars(sym, div)
    if len(d) < 30:
        raise ValueError("too few bars")
    px = [v for _, v in d]
    last = px[-1]

    def back(n):
        return pct(last, px[-1 - n]) if len(px) > n else None

    ma = {str(n): round(sum(px[-n:]) / n, dec) for n in (20, 50, 100, 200) if len(px) >= n}
    hi20, lo20 = max(px[-20:]), min(px[-20:])
    piv = zigzag(d[-130:], th)[-4:]
    for p in piv:
        p["px"], p["to_px"] = round(p["px"], dec), round(p["to_px"], dec)
    day_abs = round(last - px[-2], dec)
    big = [{"d": d[i][0], "chg": pct(px[i], px[i - 1])} for i in range(max(1, len(px) - 22), len(px)) if abs(pct(px[i], px[i - 1]) or 0) >= th / 2]
    return {"name": name, "sym": sym, "unit": unit, "dec": dec, "last": round(last, dec), "date": d[-1][0], "prev": round(px[-2], dec), "prev_date": d[-2][0],
            "chg": day_abs, "d1": back(1), "w1": back(5), "m1": back(21), "ma": ma,
            "above": {k: last > v for k, v in ma.items()}, "hi20": round(hi20, dec), "lo20": round(lo20, dec),
            "hi52": round(max(px[-252:]), dec), "lo52": round(min(px[-252:]), dec), "pivots": piv, "big_days": big[-6:], "th": th}


# ------------------------------------------------------------------ headlines
def rss(S, q, days):
    url = f"https://news.google.com/rss/search?q={quote_plus(q + f' when:{days}d')}&hl=en-US&gl=US&ceid=US:en"
    for i in range(3):
        r = S.get(url, headers=UA, timeout=30)
        if r.status_code == 429:
            time.sleep(8 * (i + 1)); continue
        r.raise_for_status(); break
    else:
        r.raise_for_status()
    out = []
    for it in ET.fromstring(r.content).iter("item"):
        title, link = (it.findtext("title") or "").strip(), it.findtext("link") or ""
        src = it.find("source")
        pub = (src.text or "").strip() if src is not None else ""
        dom = urlparse(src.get("url")).netloc.replace("www.", "") if src is not None and src.get("url") else ""
        if pub and title.endswith(" - " + pub):
            title = title[: -len(" - " + pub)]
        try:
            ts = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            continue
        out.append({"ts": ts.isoformat(timespec="seconds"), "title": title, "url": link, "outlet": pub or dom, "domain": dom})
    return out


def tag(h):
    t = h["title"].lower()
    drv = [x[0] for x in DRIVERS if re.search(x[2], t)]
    b, s = len(re.findall(BULL, t)), len(re.findall(BEAR, t))
    tone = "up" if b > s else "down" if s > b else ""
    mk = set()
    for k, v in U.items():
        if re.search(r"\b(" + {"soybeans": r"soy(bean)?s?\b(?! (meal|oil))", "soymeal": r"(soy(bean)? ?meal|soymeal)", "soyoil": r"(soy(bean)? ?oil|soyoil)",
                                "corn": "corn|maize", "wheat": "wheat", "canola": "canola|rapeseed", "wti": "crude|opec|brent|wti",
                                "usdcad": "loonie|canadian dollar|usd/cad", "dxy": "dollar index|u\\.s\\. dollar|greenback"}[k] + r")", t):
            mk.add(k)
    h.update({"drivers": drv, "tone": tone, "markets": sorted(mk)})
    return h


def headlines(S, errs):
    seen, out = {}, []
    for key, spec in U.items():
        for grp in SITES:
            q = "(" + spec[6] + ") (" + " OR ".join("site:" + s for s in grp) + ")"
            for days in (2, 30):
                try:
                    for h in rss(S, q, days):
                        k = re.sub(r"\W+", "", h["title"].lower())[:90]
                        if k and k not in seen:
                            seen[k] = 1; out.append(tag(h))
                except Exception as e:
                    errs["news:" + key] = str(e)[:120]
                time.sleep(1.2)
    out = [h for h in out if h["drivers"] or h["markets"]]
    out.sort(key=lambda h: h["ts"], reverse=True)
    return out


# ------------------------------------------------------------------ flow: drivers -> markets per horizon
def flow(M, H, t):
    settle = last_settle(t, M)
    win = {"pre": settle, "day": t - timedelta(hours=30), "week": t - timedelta(days=7), "month": t - timedelta(days=31)}
    lab = {x[0]: x[1] for x in DRIVERS}
    DM = {x[0]: x[3] for x in DRIVERS}
    IX = {id(h): i for i, h in enumerate(H)}
    res = {}
    AG = {"soybeans", "soymeal", "soyoil", "corn", "wheat", "canola"}
    for k in M:
        res[k] = {}
        for w, since in win.items():
            items = [h for h in H if datetime.fromisoformat(h["ts"]) >= since and
                     (k in h["markets"] or (not set(h["markets"]) & AG and any(k in DM[dv] for dv in h["drivers"])))]
            cnt = {}
            for h in items:
                for dv in h["drivers"]:
                    if k in DM[dv]:
                        c = cnt.setdefault(dv, {"id": dv, "label": lab[dv], "n": 0, "up": 0, "down": 0})
                        c["n"] += 1
                        if h["tone"]:
                            c[h["tone"]] += 1
            res[k][w] = {"n": len(items), "drivers": sorted(cnt.values(), key=lambda c: -c["n"])[:5], "heads": [IX[id(h)] for h in items[:8]]}
    return res, settle


def main():
    t = now()
    errs, M = {}, {}
    for k in U:
        try:
            M[k] = market(k)
        except Exception as e:
            errs[k] = str(e)[:120]
    S = UDC.requests.Session()
    H = headlines(S, errs)
    F, settle = flow(M, H, t)
    for k, e in errs.items():
        print(f"! {k}: {e}")
    if not M:
        raise SystemExit("no market data")
    print(f"{len(M)} markets, {len(H)} tagged headlines")
    body = {"updated_at": t.isoformat(timespec="seconds"), "pre_since": settle.isoformat(timespec="seconds"), "markets": M, "flow": F,
            "heads": H, "drivers": [{"id": x[0], "label": x[1], "markets": x[3]} for x in DRIVERS], "errors": errs,
            "sources": {"prices": "Yahoo Finance daily bars (front-month continuous futures, FX)", "news": "Google News RSS limited to: " + ", ".join(s for g in SITES for s in g),
                        "method": "Driver tags and tone are rule-based keyword inference on headlines; inflections are zig-zag pivots on daily closes."}}
    if "--dry-run" in sys.argv:
        json.dump(body, open("/tmp/cues.json", "w"), indent=1); return
    publish(body)
    print("published cues.json to the cues branch")


def sh(*a, cwd=None, check=True):
    return subprocess.run(list(a), cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-cues-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=ROOT)
    sh("rm", "-rf", WT, check=False); sh("git", "worktree", "prune", cwd=ROOT, check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH, cwd=ROOT, check=False).returncode == 0
    if exists:
        sh("git", "fetch", "-q", "--depth", "1", "origin", f"{BRANCH}:refs/remotes/origin/{BRANCH}", cwd=ROOT, check=False)
        sh("git", "worktree", "add", "-f", "-B", BRANCH, WT, f"origin/{BRANCH}", cwd=ROOT)
    else:
        sh("git", "worktree", "add", "--detach", WT, cwd=ROOT)
        sh("git", "checkout", "-q", "--orphan", BRANCH, cwd=WT); sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "cues.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"), ensure_ascii=False)
    sh("git", "add", "cues.json", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "cues: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", BRANCH, cwd=WT)


if __name__ == "__main__":
    main()
