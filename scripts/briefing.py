"""North America news briefing -> briefing.json on the `briefing` branch (read by the Briefing tab).

Two country desks (United States, Canada) and a cross-border desk (stories that move both economies: trade, tariffs,
CUSMA, energy, border, the two central banks side by side). Each desk has sections (policy, politics, economy, trade,
energy & agriculture; Canada also one line per province). Headlines come from Google News RSS searches, are de-duplicated
and clustered (the same story from several outlets counts once, with its outlet count), ranked by how widely the story
is carried, how recent it is and whether a tier-one outlet has it, and tagged with what it touches on the desk
(rates, CAD, grains, energy, trade). The 'why it matters' line is a rule-based desk read from the headline wording,
labelled as such in the UI — never presented as reporting.

Usage: python scripts/briefing.py [--dry-run]
"""
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANCH, WT = "briefing", "/tmp/briefing-worktree"
NOW = dt.datetime.now(dt.timezone.utc)
UA = {"User-Agent": "Mozilla/5.0 (desk briefing; +https://github.com/anirudhpdoshi/AGRITrade)"}
HOURS = 48                      # look-back window
PER_SECTION = 6

US, CA = ("en-US", "US", "US:en"), ("en-CA", "CA", "CA:en")
DESKS = {
    "us": {"name": "United States", "loc": US, "sections": {
        "policy": ('"Federal Reserve" OR Powell OR FOMC OR "Treasury yields" OR "Treasury Secretary"', r"fed\b|federal reserve|(?<!lake )powell|fomc|treasury|yield|rate (?:cut|hike)|interest rate|bond"),
        "politics": ('"White House" OR Congress OR Senate OR "executive order" OR "Supreme Court" OR "government shutdown"', r"white house|congress|senate|house\b|executive order|supreme court|shutdown|trump|administration|bill|vote|governor"),
        "economy": ('"US economy" OR "jobs report" OR "US inflation" OR "consumer spending" OR "jobless claims" OR "US GDP"', r"econom|jobs?|payroll|inflation|cpi|pce|gdp|spending|claims|retail sales|manufactur|recession|consumer"),
        "trade": ('"US tariffs" OR USTR OR "trade deal" OR "Commerce Department" OR "trade war"', r"tariff|trade|import|export|ustr|commerce department|duties|sanction"),
        "energy_ag": ('USDA OR "US farmers" OR "farm bill" OR "crude oil" OR "natural gas prices" OR OPEC', r"usda|farm|crop|corn|soy|wheat|grain|crude|oil|gas|opec|energy|fertili[sz]er|ethanol"),
    }},
    "ca": {"name": "Canada", "loc": CA, "sections": {
        "policy": ('"Bank of Canada" OR Macklem OR "Canadian dollar" OR "Canada bond yields" OR "Finance Minister" Canada', r"(?<!national )(?<!royal )bank of canada|macklem|loonie|canadian dollar|bond|yield|rate (?:cut|hike)|interest rate|finance minister"),
        "politics": ('Ottawa OR Carney OR "House of Commons" OR Poilievre OR "federal budget" Canada OR "Prime Minister" Canada', r"ottawa|carney|poilievre|commons|parliament|budget|prime minister|liberal|conservative|ndp|bloc|election|minister"),
        "economy": ('"Statistics Canada" OR "Canada jobs" OR "Canada inflation" OR "Canada GDP" OR "Canadian economy" OR "Canada housing"', r"econom|jobs?|employment|inflation|cpi|gdp|housing|retail|statistics canada|recession|consumer|manufactur"),
        "trade": ('"Canada tariffs" OR "Canadian exports" OR CUSMA OR "softwood lumber" OR "Canada trade"', r"tariff|trade|export|import|cusma|usmca|softwood|duties|steel|aluminum"),
        "energy_ag": ('canola OR "Canadian farmers" OR "Canadian wheat" OR "oil sands" OR pipeline Canada OR "Alberta energy"', r"canola|farm|crop|wheat|grain|oil|pipeline|energy|lng|alberta|potash|fertili[sz]er|barley|pulse"),
    }, "provinces": {
        "ON": "Ontario", "QC": "Quebec", "AB": "Alberta", "BC": "British Columbia", "SK": "Saskatchewan", "MB": "Manitoba", "ATL": "Atlantic Canada",
    }},
    "both": {"name": "Both economies", "loc": CA, "sections": {
        "trade": ('(Canada OR Canadian) (tariffs OR CUSMA OR USMCA OR "trade talks" OR "trade deal") (Trump OR Washington OR "United States" OR U.S.)', r"tariff|trade|cusma|usmca|duties|talks|deal|steel|aluminum|lumber|autos?"),
        "energy_ag": ('(Canada OR Canadian) (United States OR U.S.) (oil OR pipeline OR electricity OR farmers OR canola OR dairy OR grain)', r"oil|pipeline|electric|energy|farm|canola|dairy|grain|wheat|crop|potash"),
        "policy": ('("Bank of Canada" AND "Federal Reserve") OR ("Canadian dollar" AND Fed) OR "U.S.-Canada" rates', r"bank of canada|federal reserve|fed\b|loonie|canadian dollar|rates?|yields?"),
        "politics": ('(Carney OR Ottawa) (Trump OR "White House" OR Washington)', r"carney|ottawa|trump|white house|washington|border|summit|talks"),
    }},
}
CANADA = r"\bcanad|carney|ottawa|poilievre|\balberta|\bontario|quebec"
PROV_Q = '"{n}" (premier OR government OR legislature OR budget OR economy)'
SECTION_NAME = {"policy": "Central bank & rates", "politics": "Politics & government", "economy": "Economy & data", "trade": "Trade & tariffs", "energy_ag": "Energy & agriculture"}
TIER1 = {"reuters.com", "bloomberg.com", "apnews.com", "wsj.com", "ft.com", "cbc.ca", "theglobeandmail.com", "nytimes.com", "washingtonpost.com",
         "cnbc.com", "financialpost.com", "nationalpost.com", "ctvnews.ca", "globalnews.ca", "politico.com", "axios.com", "bnnbloomberg.ca", "thestar.com", "marketwatch.com"}
NOISE = r"(?:\((?:tse|nyse|nasdaq|tsx):|price target|marketbeat|stock (?:falls|rises|jumps|drops|rated|now rated)|shares (?:fall|rise|jump|drop)|\b(?:nfl|nba|nhl|mlb|playoff|touchdown|celebrity|recipe|horoscope|movie|box office|album|concert|lottery|weather forecast|obituary|coupon|deal of the day|best .* to buy)\b)"

# what a story touches on the desk (tags) and the rule-based read ('why it matters'), checked in order, first match wins
TAGS = [("rates", r"rate (?:cut|hike)|interest rate|yield|bond|fed\b|federal reserve|(?<!national )(?<!royal )bank of canada|inflation|cpi|pce"),
        ("cad", r"loonie|canadian dollar|\bcad\b|(?<!national )(?<!royal )bank of canada|canada(?:'s)? (?:economy|gdp|jobs|inflation)|cusma|usmca|oil"),
        ("grains", r"farm|crop|corn|soy|wheat|canola|grain|usda|barley|fertili[sz]er|potash|ethanol|harvest"),
        ("energy", r"oil|crude|gas|pipeline|opec|lng|energy|electric"),
        ("trade", r"tariff|\btrade\b|duties|\bexports?\b|\bimports?\b|cusma|usmca|sanction")]
WHY = [
    (r"tariff|duties|trade war|retaliat", "Trade friction: watch USD/CAD (tariff news has tended to weaken CAD), Canadian export volumes and cross-border grain/canola basis."),
    (r"cusma|usmca|trade (?:talks|deal|agreement)", "Trade framework: the terms of North American trade set the cost of moving grain, autos and energy across the border — watch CAD and export basis."),
    (r"rate cut|cuts? rates|lower(?:s|ed)? (?:the )?(?:policy )?rate|easing", "Easing: lower rates usually weigh on that currency and lift risk assets; compare with the other central bank's path for USD/CAD."),
    (r"rate hike|raises? rates|raise(?:s|d)? (?:the )?(?:policy )?rate|tighten", "Tightening: higher rates usually support that currency; the US–Canada rate gap is the main driver of USD/CAD."),
    (r"oil|crude|opec|pipeline|oil sands", "Energy: oil is Canada's largest export — higher crude tends to support CAD; diesel and freight costs feed farm margins."),
    (r"canola|wheat|corn|soy|grain|crop|harvest|usda|farm", "Agriculture: directly relevant to the grain desk — check the grain tabs for price, basis and export pace."),
    (r"fertili[sz]er|potash|urea", "Inputs: fertilizer costs shape next season's acreage (corn vs soybeans) and farm margins."),
    (r"inflation|\bcpi\b|\bpce\b|consumer prices", "Inflation print: shapes the next central-bank move — check the Macro tab for the number vs forecast and the market's rate odds."),
    (r"jobs|payroll|employment|unemployment|jobless", "Labour data: a key input for the next rate decision; a surprise moves 2-year yields and USD/CAD first."),
    (r"gdp|recession|contraction|growth", "Growth signal: feeds the rate outlook and demand for energy and grain; compare US vs Canada growth for USD/CAD."),
    (r"shutdown|debt ceiling|budget|deficit|fiscal", "Fiscal: affects bond supply and yields, and (in a shutdown) the timing of official data such as USDA and BLS reports."),
    (r"election|poll|confidence vote|leadership", "Political risk: can shift fiscal and trade policy expectations — watch currency and bond reaction."),
    (r"executive order|sanction", "Policy action: check whether it reaches trade, energy or agriculture — those are the channels to the desk."),
]
WHY_DEFAULT = {"policy": "Rates context for USD/CAD and borrowing costs.", "politics": "Policy backdrop; relevant if it reaches trade, fiscal or energy policy.",
               "economy": "Economic backdrop for the next central-bank decision.", "trade": "Trade backdrop for cross-border flows and CAD.",
               "energy_ag": "Energy and farm backdrop for the grain desk."}


def norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (t or "").lower())).strip()


STOP = {"the", "a", "an", "of", "to", "in", "on", "for", "and", "as", "at", "by", "with", "from", "is", "are", "its", "after", "amid", "over", "says", "say", "will", "new", "how", "what", "why"}


def toks(t):
    return {w for w in norm(t).split() if len(w) > 2 and w not in STOP}


def similar(a, b, thr=0.5):
    A, B = toks(a), toks(b)
    return bool(A and B) and len(A & B) / min(len(A), len(B)) >= thr


def rss(q, loc):
    hl, gl, ceid = loc
    url = f"https://news.google.com/rss/search?q={quote_plus(q + ' when:2d')}&hl={hl}&gl={gl}&ceid={ceid}"
    r = requests.get(url, headers=UA, timeout=25)
    r.raise_for_status()
    out = []
    for it in ET.fromstring(r.content).iter("item"):
        title, link = (it.findtext("title") or "").strip(), it.findtext("link") or ""
        src = it.find("source")
        pub = src.text if src is not None and src.text else ""
        dom = (urlparse(src.get("url")).netloc if src is not None and src.get("url") else "news.google.com").replace("www.", "")
        if pub and title.endswith(" - " + pub):
            title = title[: -len(" - " + pub)].strip()
        try:
            when = parsedate_to_datetime(it.findtext("pubDate")).astimezone(dt.timezone.utc)
        except Exception:
            continue
        out.append({"ts": when.isoformat(), "title": title, "url": link, "outlet": pub or dom, "domain": dom})
    return out


def tags_of(t):
    tl = t.lower()
    return [k for k, rx in TAGS if re.search(rx, tl)]


def why_of(t, section):
    tl = t.lower()
    for rx, txt in WHY:
        if re.search(rx, tl):
            return txt
    return WHY_DEFAULT.get(section, "")


def cluster(items, keep_rx):
    """Same story from several outlets -> one entry: lead = newest tier-one headline (else newest), with outlet count."""
    items = [i for i in items if (NOW - dt.datetime.fromisoformat(i["ts"])).total_seconds() <= HOURS * 3600
             and not re.search(NOISE, i["title"].lower()) and (not keep_rx or re.search(keep_rx, i["title"].lower()))]
    items.sort(key=lambda i: i["ts"], reverse=True)
    groups = []
    for it in items:
        for g in groups:
            if similar(it["title"], g[0]["title"]):
                g.append(it)
                break
        else:
            groups.append([it])
    out = []
    for g in groups:
        lead = next((i for i in g if i["domain"] in TIER1), g[0])
        outlets = sorted({i["outlet"] for i in g})
        age_h = (NOW - dt.datetime.fromisoformat(g[0]["ts"])).total_seconds() / 3600
        score = round(math.log2(1 + len(outlets)) * 2 + (1.5 if any(i["domain"] in TIER1 for i in g) else 0) + max(0, 2 - age_h / 12), 2)
        out.append({"title": lead["title"], "url": lead["url"], "outlet": lead["outlet"], "ts": g[0]["ts"], "first": g[-1]["ts"],
                    "n": len(outlets), "outlets": outlets[:6], "score": score, "tags": tags_of(lead["title"])})
    out.sort(key=lambda c: -c["score"])
    return out


def build():
    body = {"updated_at": NOW.isoformat(), "window_h": HOURS, "desks": {}, "health": {}}
    for dk, cfg in DESKS.items():
        desk = {"name": cfg["name"], "sections": {}, "top": []}
        pool = []
        for sk, (q, keep) in cfg["sections"].items():
            try:
                items = rss(q, cfg["loc"])
                body["health"][f"{dk}.{sk}"] = len(items)
            except Exception as e:
                body["health"][f"{dk}.{sk}"] = type(e).__name__
                items = []
            cl = cluster(items, keep)
            if dk == "us":
                cl = [c for c in cl if not re.search(CANADA, c["title"].lower())]
            cl = cl[:PER_SECTION]
            for c in cl:
                c["section"] = sk
                c["why"] = why_of(c["title"], sk)
            desk["sections"][sk] = cl
            pool += cl
        if cfg.get("provinces"):
            desk["provinces"] = {}
            for pk, pn in cfg["provinces"].items():
                q = PROV_Q.format(n=pn) if pk != "ATL" else '("Nova Scotia" OR "New Brunswick" OR Newfoundland OR "Prince Edward Island") (premier OR government OR economy)'
                try:
                    cl = cluster(rss(q, cfg["loc"]), None)
                except Exception as e:
                    body["health"][f"prov.{pk}"] = type(e).__name__
                    cl = []
                desk["provinces"][pk] = {"name": pn, "items": cl[:2]}
        seen, top = [], []
        for c in sorted(pool, key=lambda c: -c["score"]):
            if any(similar(c["title"], s, 0.35) for s in seen):
                continue
            seen.append(c["title"])
            top.append(c)
            if len(top) == 6:
                break
        desk["top"] = top
        body["desks"][dk] = desk
    # a story on both country desks also belongs on the cross-border desk
    both = body["desks"]["both"]
    for c in body["desks"]["us"]["top"]:
        if any(similar(c["title"], x["title"]) for x in body["desks"]["ca"]["top"]) and not any(similar(c["title"], x["title"]) for x in both["top"]):
            both["top"].append(dict(c, note="carried on both country desks"))
    return body


def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def publish(body):
    for k, v in (("user.name", "desk-briefing-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v)
    sh("rm", "-rf", WT, check=False)
    sh("git", "worktree", "prune", check=False)
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False).returncode == 0
    if exists:
        sh("git", "fetch", "-q", "origin", BRANCH)
        sh("git", "worktree", "add", "-f", "-B", BRANCH, WT, f"origin/{BRANCH}")
    else:
        sh("git", "worktree", "add", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", BRANCH, cwd=WT)
        sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "briefing.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"), ensure_ascii=False)
    sh("git", "add", "-A", cwd=WT)
    sh("git", "commit", "-q", *([] if not exists else ["--amend"]), "-m", "briefing: " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", BRANCH, cwd=WT)


if __name__ == "__main__":
    b = build()
    n = sum(len(s) for d in b["desks"].values() for s in d["sections"].values())
    print(f"briefing: {n} stories", json.dumps(b["health"]))
    if n < 10:
        sys.exit("too few stories — not publishing (keeps the last good briefing)")
    if "--dry-run" in sys.argv:
        print(json.dumps(b, indent=1)[:3000])
    else:
        publish(b)
