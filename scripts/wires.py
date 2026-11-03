"""Business newswires and official press rooms -> the desk feed (runs inside the fast lane, every ~2 min).

Sources (free, no keys): FinancialJuice squawk headlines (RSS), Business Wire, PR Newswire, Canada Newswire (RSS), Press Release Feed (JSON API),
Federal Reserve, Bank of Canada, USDA, CFTC (RSS), Statistics Canada Daily (Atom), SEC EDGAR current 8-K filings (Atom,
needs the SEC_CONTACT secret). GlobeNewswire, EIN Presswire, ACCESS Newswire and Newsfile publish no feed that answers
an automated client (403/404/empty) and are not polled.

Only what matters to the desk is kept: top-100 / watchlist companies, agri and energy terms, central banks, USDA,
CFTC and StatCan. BREAKING (alert format) is reserved for: Fed / BoC policy releases, agri-relevant USDA releases, and
top-100 / watchlist company news on earnings, M&A, guidance, dividends, leadership, bankruptcy or recalls, published
in the last 2 hours. Everything else kept is a plain wire item.
"""
import hashlib, html, json, os, re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

UA = {"User-Agent": "AGRITrade-desk/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8"}
SEC_UA = {"User-Agent": ("AGRITrade desk " + os.environ.get("SEC_CONTACT", "").strip()).strip(), "Accept": "application/atom+xml"}
SOURCES = [   # key, label, url, kind
    ("bw", "Business Wire", "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFtRWA==", "co"),
    ("prn", "PR Newswire", "https://www.prnewswire.com/rss/news-releases-list.rss", "co"),
    ("cnw", "Canada Newswire", "https://www.newswire.ca/rss/news-releases-list.rss", "co"),
    ("prf", "Press Release Feed", "https://pressreleasefeed.org/api/releases", "co"),
    ("fed", "Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "fed"),
    ("boc", "Bank of Canada", "https://www.bankofcanada.ca/content_type/press-releases/feed/", "boc"),
    ("usda", "USDA", "https://www.usda.gov/rss/latest-releases.xml", "usda"),
    ("cftc", "CFTC", "https://www.cftc.gov/RSS/RSSGP/rssgp.xml", "cftc"),
    ("stc", "Statistics Canada", "https://www150.statcan.gc.ca/n1/rss/dai-quo/0-eng.atom", "stc"),
    ("fj", "FinancialJuice", "https://www.financialjuice.com/feed.ashx?xy=rss", "fj"),
    ("sec", "SEC EDGAR", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=100&output=atom", "sec"),
]
NAMES = {  # ticker -> name pattern used in release titles (top-100 + agri watchlist)
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA|Nvidia", "GOOGL": "Alphabet|Google", "AMZN": "Amazon", "META": "Meta Platforms", "AVGO": "Broadcom",
    "TSLA": "Tesla", "BRK.B": "Berkshire Hathaway", "LLY": "Eli Lilly|Lilly", "JPM": "JPMorgan", "WMT": "Walmart", "V": "Visa Inc", "ORCL": "Oracle", "MA": "Mastercard",
    "XOM": "Exxon", "UNH": "UnitedHealth", "COST": "Costco", "NFLX": "Netflix", "JNJ": "Johnson & Johnson", "HD": "Home Depot", "PG": "Procter & Gamble", "ABBV": "AbbVie",
    "BAC": "Bank of America", "CRM": "Salesforce", "CVX": "Chevron", "KO": "Coca-Cola", "AMD": "AMD|Advanced Micro Devices", "TMUS": "T-Mobile", "PLTR": "Palantir",
    "CSCO": "Cisco", "WFC": "Wells Fargo", "ABT": "Abbott", "MRK": "Merck", "IBM": "IBM", "PM": "Philip Morris", "GE": "GE Aerospace|General Electric", "ACN": "Accenture",
    "LIN": "Linde", "MCD": "McDonald", "DIS": "Disney", "PEP": "PepsiCo", "INTU": "Intuit", "NOW": "ServiceNow", "TMO": "Thermo Fisher", "GS": "Goldman Sachs", "UBER": "Uber",
    "ISRG": "Intuitive Surgical", "MS": "Morgan Stanley", "CAT": "Caterpillar", "AXP": "American Express", "VZ": "Verizon", "ADBE": "Adobe", "QCOM": "Qualcomm", "T": "AT&T",
    "BKNG": "Booking Holdings", "TXN": "Texas Instruments", "RTX": "RTX Corp|Raytheon", "PGR": "Progressive Corp", "SPGI": "S&P Global", "AMGN": "Amgen", "BSX": "Boston Scientific",
    "C": "Citigroup|Citi ", "SCHW": "Charles Schwab", "NEE": "NextEra", "BLK": "BlackRock", "LOW": "Lowe's", "HON": "Honeywell", "DHR": "Danaher", "AMAT": "Applied Materials",
    "PFE": "Pfizer", "UNP": "Union Pacific", "SYK": "Stryker", "ETN": "Eaton", "GILD": "Gilead", "TJX": "TJX", "COP": "ConocoPhillips", "DE": "Deere", "ADP": "ADP|Automatic Data Processing",
    "KKR": "KKR", "MU": "Micron", "PANW": "Palo Alto Networks", "BX": "Blackstone", "LRCX": "Lam Research", "ANET": "Arista", "CMCSA": "Comcast", "KLAC": "KLA Corp",
    "VRTX": "Vertex Pharma", "ADI": "Analog Devices", "MDT": "Medtronic", "CRWD": "CrowdStrike", "APH": "Amphenol", "NKE": "Nike", "SBUX": "Starbucks", "LMT": "Lockheed Martin",
    "MMC": "Marsh McLennan", "ICE": "Intercontinental Exchange", "CB": "Chubb", "SHOP": "Shopify", "MO": "Altria", "SO": "Southern Company", "PLD": "Prologis", "BA": "Boeing",
    "COF": "Capital One", "INTC": "Intel",
    "ADM": "ADM|Archer[- ]Daniels", "BG": "Bunge", "CTVA": "Corteva", "MOS": "Mosaic Company|The Mosaic", "NTR": "Nutrien", "CF": "CF Industries", "ANDE": "Andersons",
    "INGR": "Ingredion", "TSN": "Tyson Foods",
}
NAME_RX = {t: re.compile(r"\b(" + p + r")", re.I if t not in ("V", "C", "T", "IBM", "AMD", "ADP", "TJX", "KKR") else 0) for t, p in NAMES.items()}
MATERIAL = re.compile(r"\b(results|earnings|quarter|revenue|guidance|outlook|acquir|acquisition|merger|to buy|deal to|dividend|buyback|repurchase|CEO|chief executive|resign|appoint|bankrupt|chapter 11|recall|layoff|job cuts|spin-?off|tender offer|strategic review)", re.I)
AGRI = re.compile(r"\b(grain|corn|wheat|soy(bean)?s?|canola|oilseed|fertili[sz]er|potash|nitrogen|ethanol|biofuel|renewable diesel|crush|crop|harvest|farm(er|ing)?s?|livestock|cattle|hog|USDA|WASDE|Black Sea|crude|OPEC|pipeline|LNG)\b", re.I)
FED_KEY = re.compile(r"FOMC|monetary policy|federal funds|discount rate|policy statement|minutes of the|implementation note", re.I)
BOC_KEY = re.compile(r"policy rate|interest rate announcement|Monetary Policy Report|Governing Council|deliberations|market operations", re.I)
# FinancialJuice squawk headlines: keep what moves the desk's markets; BREAKING for central banks, trade/tariff, geopolitics, oil supply, grains
FJ_KEEP = re.compile(r"\b(USD|CAD|Canad|dollar|Fed\b|FOMC|Powell|BoC|Macklem|rate|yield|Treasur|inflation|CPI|PCE|jobs|payroll|GDP|PMI|ISM|tariff|trade|Trump|China|Iran|Israel|Russia|Ukraine|OPEC|oil|crude|gasoline|EIA|API|grain|wheat|corn|soy|USDA|WASDE|fertili|Black Sea|sanction|ceasefire|missile|strike|war)", re.I)
FJ_BREAK = re.compile(r"\b(Fed\b.*\b(cut|hike|holds|decision)|FOMC (statement|decision)|BoC\b.*\b(cut|hike|holds|decision)|rate (cut|hike)s?\b|tariffs? (on|of|to)|imposes|sanction|missile|airstrike|strikes? on|invasion|ceasefire|OPEC\+? (agrees|cuts|raises|keeps)|export ban|WASDE|Trump (signs|orders|announces|imposes))", re.I)
USDA_KEY = re.compile(r"WASDE|export|trade|tariff|China|crop|grain|corn|wheat|soy|farm|commodity|disaster|bird flu|avian|screwworm", re.I)


def _t(s):
    for f in (lambda x: parsedate_to_datetime(x), lambda x: datetime.fromisoformat(x.replace("Z", "+00:00"))):
        try:
            d = f(s.strip())
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    return None


def _clean(x):
    x = re.sub(r"<!\[CDATA\[|\]\]>", "", x or "")
    return html.unescape(re.sub(r"<[^>]+>", " ", x)).replace("\xa0", " ").strip()


def parse_feed(text):
    """RSS <item> or Atom <entry> -> [(title, url, published)]."""
    out = []
    for blk in re.findall(r"<(?:item|entry)\b.*?</(?:item|entry)>", text, re.S):
        title = _clean((re.search(r"<title[^>]*>(.*?)</title>", blk, re.S) or [None, ""])[1])
        link = re.search(r"<link[^>]*href=\"([^\"]+)\"", blk) or re.search(r"<link>(.*?)</link>", blk, re.S)
        url = _clean(link.group(1)) if link else ""
        d = re.search(r"<(?:pubDate|published|updated|dc:date)>(.*?)</", blk, re.S)
        out.append((" ".join(title.split()), url, _t(_clean(d.group(1))) if d else None))
    return out


def classify(kind, title):
    """(keep, breaking, tags, tickers)."""
    # the company must be the subject (named at the start), not a partner mentioned in passing ("…, an Oracle partner, acquires…")
    tick = [t for t, rx in NAME_RX.items() if (lambda m: m and m.start() <= 4)(rx.search(title))]
    if kind == "fed":
        return True, bool(FED_KEY.search(title)), ["cb"], []
    if kind == "boc":
        return True, bool(BOC_KEY.search(title)), ["cb"], []
    if kind == "usda":
        return True, bool(USDA_KEY.search(title)), ["agri"], []
    if kind == "fj":
        return bool(FJ_KEEP.search(title)), bool(FJ_BREAK.search(title)), ["agri" if AGRI.search(title) and re.search(r"grain|wheat|corn|soy|fertili|USDA|WASDE", title, re.I) else "macro"], []
    if kind in ("cftc", "stc"):
        return True, False, ["agri" if AGRI.search(title) else "macro"], []
    agri = bool(AGRI.search(title))
    if kind == "sec":
        return bool(tick), False, ["earn"], tick
    if tick:
        return True, bool(MATERIAL.search(title)), ["earn"] + (["agri"] if agri else []), tick
    return agri, False, ["agri"], []


def fetch(now, get=None, only=None):
    """All sources -> (items, health). get(url, headers) is injectable for tests."""
    get = get or (lambda u, h: requests.get(u, headers=h, timeout=15))
    items, health = [], {}
    for key, label, url, kind in SOURCES:
        if only and key not in only:
            continue
        if key == "sec" and len(SEC_UA["User-Agent"]) <= len("AGRITrade desk"):
            health[key] = "no SEC contact"
            continue
        try:
            r = get(url, SEC_UA if key == "sec" else UA)
            if r.status_code != 200:
                health[key] = f"HTTP {r.status_code}"
                continue
            if key == "prf":
                rows = [(x.get("title") or "", x.get("url") or x.get("page_url") or "", _t(x.get("published_at") or ""), (x.get("company") or "")) for x in r.json().get("releases", [])]
            else:
                rows = [(t, u, d, "") for t, u, d in parse_feed(r.text)]
            health[key] = f"ok {len(rows)}"
        except Exception as e:
            health[key] = type(e).__name__
            continue
        for title, link, d, comp in rows:
            if not title or not d or now - d > timedelta(hours=72) or d - now > timedelta(minutes=10):
                continue
            if key == "sec":
                m = re.match(r"8-K\s*-\s*(.*?)\s*\(\d+\)", title)
                title = f"{m.group(1).title() if m else title} files an 8-K"
            if key == "fj":
                title = re.sub(r"^FinancialJuice:\s*", "", title)
            keep, brk, tags, tick = classify(kind, title + (" " + comp if comp else ""))
            if not keep:
                continue
            items.append({"id": hashlib.sha1((link or title).encode()).hexdigest()[:16], "src": label, "srck": key, "title": title, "url": link,
                          "t": d.astimezone(timezone.utc).isoformat(), "tags": tags, "tick": tick,
                          "breaking": brk and now - d < timedelta(hours=2)})
    seen, out = set(), []
    for it in sorted(items, key=lambda x: x["t"], reverse=True):
        k = re.sub(r"\W+", "", it["title"].lower())[:90]
        if k in seen:
            continue   # same release on two wires
        seen.add(k)
        out.append(it)
    return out[:150], health


def alerts_from(items, fired, now):
    """BREAKING wire items -> desk alerts (once each)."""
    out = []
    for it in items:
        fid = "wire|" + it["id"]
        if not it["breaking"] or fid in fired:
            continue
        fired[fid] = now.isoformat()
        tag = "cb" if "cb" in it["tags"] else "agri" if it["tags"] == ["agri"] else "earn"
        out.append({"id": fid, "kind": "news", "tag": {"agri": "corn", "earn": "earn", "cb": "cb"}[tag], "t": now.isoformat(), "mt": it["t"],
                    "head": f"BREAKING – {it['title']}", "trigger": f"{it['src']}: {it['title']}" + (f" ({', '.join(it['tick'])})" if it["tick"] else ""),
                    "impact": "Mixed", "why": "", "src": it["src"], "url": it["url"]})
    return out
