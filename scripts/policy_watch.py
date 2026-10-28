"""Central-bank decision watch (Bank of Canada, Federal Reserve).

From two minutes before a scheduled decision until three hours after, the fast lane calls watch(D) every loop.
It reads the official statement straight from the central bank's own site, parses the new policy rate,
classifies the tone (hawkish / dovish / neutral) and stamps when the desk first had it, so the page can show
the publication lag (desk time − scheduled time) for every decision.

Tone = decision (hike +2 / cut −2) + surprise vs the consensus forecast (±1 per 25 bp) + statement language
(hawkish minus dovish phrases, capped ±2). Score ≥ +2 hawkish, +1 leaning hawkish, −1 leaning dovish, ≤ −2 dovish.
A lexicon read, not a forecast: the label shows the phrases it found so the reader can judge.
"""
import html as _html
import re
import time
from datetime import datetime, timedelta, timezone

import requests

TOR = None  # set from update_data at import time by the caller
UA = {"User-Agent": "Mozilla/5.0 (desk policy watch; contact: repo owner)"}

HAWK = [
    r"inflation (?:remains|is still|has been) (?:elevated|too high|above)", r"upside risks? to inflation", r"further (?:tightening|increases?)",
    r"additional (?:policy )?firming", r"prepared to (?:raise|increase|act)", r"price pressures (?:remain|are) (?:broad|persistent|elevated)",
    r"persistent(?:ly)? (?:high|elevated)? ?inflation", r"tight labou?r market", r"strong (?:demand|labou?r market|economy)", r"vigilant",
    r"ensure inflation returns", r"core inflation (?:remains|is) (?:elevated|sticky|above)", r"inflation expectations .{0,40}(?:rising|elevated)",
    r"not (?:yet )?(?:prepared|ready) to (?:cut|lower|ease)", r"remain(?:s)? restrictive", r"raised|increased (?:its|the) target",
]
DOVE = [
    r"downside risks?", r"(?:economy|growth|activity) (?:is |has )?(?:weak|slow|soft)", r"excess supply", r"slack", r"further (?:reductions?|cuts?|easing)",
    r"lower(?:ed)? (?:its|the) (?:target|policy rate)", r"reduc(?:e|ed) (?:its|the) (?:target|policy rate)", r"support (?:the )?(?:economy|growth|employment)",
    r"inflation (?:has )?(?:eased|moderated|declined|is close to|returned)", r"(?:labou?r market|employment) (?:has )?(?:softened|weakened|cooled)",
    r"unemployment (?:has )?(?:risen|rose|increased|moved up)", r"tariffs?.{0,60}(?:weigh|weaker|slow)", r"uncertainty .{0,40}(?:weigh|dampen)",
    r"accommodat", r"room to (?:ease|cut|lower)", r"appropriate to (?:ease|lower|cut)",
]
FRAC = {"¼": .25, "½": .5, "¾": .75, "1/4": .25, "1/2": .5, "3/4": .75, "1/8": .125, "3/8": .375, "5/8": .625, "7/8": .875}


def _num(s):
    s = s.strip().replace(",", ".")
    m = re.match(r"(\d+)(?:\s*-\s*|\s+)?(\d/\d)?$", s)
    if m and m.group(2):
        return int(m.group(1)) + FRAC[m.group(2)]
    m = re.match(r"(\d+(?:\.\d+)?)\s*([¼½¾])?$", s)
    if m:
        return float(m.group(1)) + (FRAC[m.group(2)] if m.group(2) else 0)
    return None


def _text(h):
    h = re.sub(r"(?is)<(script|style|nav|header|footer)[^>]*>.*?</\1>", " ", h)
    t = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", h))
    return re.sub(r"\s+", " ", t).strip()


BROWSER = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-CA,en;q=0.9"}
DEADLINE = [float("inf")]   # per-check time budget so a slow bank site never stalls the 60-s fast lane
PROBE = []   # what each URL returned on this check - stored with the 'awaiting' record so a silent miss is never silent


def _short(u):
    return re.sub(r"^https?://(www\.)?", "", u)[:90]


def _get(url):
    """GET with the desk UA, then a browser UA if the site refuses bots (403/429/503 on busy announcement days).
    Every outcome is recorded in PROBE."""
    last = None
    if time.monotonic() > DEADLINE[0]:
        PROBE.append({"u": _short(url), "s": "skipped (check budget used)"})
        return None
    for hdr in (UA, BROWSER):
        try:
            r = requests.get(url, headers=hdr, timeout=(4, 8))
        except Exception as e:
            last = type(e).__name__
            break                      # a timeout will not be fixed by another user-agent; keep the fast lane fast
        last = r.status_code
        if r.status_code == 200:
            PROBE.append({"u": _short(url), "s": 200})
            return r.text
        if r.status_code == 404:
            break                      # not published yet - no point retrying with another UA
    PROBE.append({"u": _short(url), "s": last})
    return None


def _boc_valet(day):
    """Fallback: the Bank's own policy-rate series (Valet V39079, target for the overnight rate). Used only when an observation
    dated on or after the decision day exists - the statement text is then not read, so tone uses the decision alone."""
    h = _get("https://www.bankofcanada.ca/valet/observations/V39079/json?recent=5")
    if not h:
        return None
    import json as _j
    obs = [(o["d"], o.get("V39079", {}).get("v")) for o in _j.loads(h).get("observations", [])]
    obs = [(d, float(v)) for d, v in obs if v not in (None, "") and d >= day.isoformat()]
    if not obs:
        PROBE[-1]["note"] = "no observation for the decision day yet"
        return None
    d, v = sorted(obs)[-1]
    return {"url": "https://www.bankofcanada.ca/rates/interest-rates/key-variable/", "rate": v, "verb": "", "text": "", "src": "valet " + d}


def _boc(day):
    """Bank of Canada: fixed announcement URL first, then the press-release feed."""
    y, m, d = day.year, day.month, day.day
    urls = [f"https://www.bankofcanada.ca/{y}/{m:02d}/fad-press-release-{y}-{m:02d}-{d:02d}/"]
    try:   # the press-release listing links the statement under whatever slug the Bank used that day
        lst = _get("https://www.bankofcanada.ca/press/press-releases/") or ""
        for u in re.findall(r'href="(https://www\.bankofcanada\.ca/%d/%02d/[^"]*%d-%02d-%02d/)"' % (y, m, y, m, d), lst):
            if u not in urls and not re.search(r"fad-announcement|press-conference|mpr-\d", u):
                urls.append(u)
    except Exception:
        pass
    try:
        feed = _get("https://www.bankofcanada.ca/content_type/press-releases/feed/") or ""
        for it in re.findall(r"(?s)<item>(.*?)</item>", feed)[:10]:
            lk = re.search(r"<link>(.*?)</link>", it); title = re.search(r"<title>(.*?)</title>", it)
            if lk and title and re.search(r"policy (?:interest )?rate|overnight rate", title.group(1), re.I) and f"{y}/{m:02d}" in lk.group(1):
                urls.append(lk.group(1).strip())
    except Exception:
        pass
    for u in urls:
        try:
            h = _get(u)
        except Exception:
            continue
        if not h:
            continue
        t = _text(h)
        mm = re.search(r"(lower|reduc|cut|rais|increas|held|hold|maintain|kept|left)\w*\s+(?:its|the)\s+target for the overnight rate\s+(?:(?:by|at|to)\s+)?(?:\d+\s+basis points\s+to\s+)?([\d.,]+\s*[¼½¾]?)\s*(?:%|per\s*cent|percent)", t, re.I)
        if not mm:
            continue
        rate = _num(mm.group(2))
        body = t[mm.start(): mm.start() + 6000]
        return {"url": u, "rate": rate, "verb": mm.group(1).lower(), "text": body}
    try:
        return _boc_valet(day)
    except Exception:
        return None


def _fed(day):
    """Federal Reserve: FOMC statement press release (monetaryYYYYMMDDa.htm), feed as fallback."""
    ds = day.strftime("%Y%m%d")
    urls = [f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{ds}a.htm"]
    try:
        feed = _get("https://www.federalreserve.gov/feeds/press_monetary.xml") or ""
        for it in re.findall(r"(?s)<item>(.*?)</item>", feed)[:10]:
            lk = re.search(r"<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>", it); title = re.search(r"<title>(.*?)</title>", it)
            if lk and title and "FOMC statement" in title.group(1) and ds in lk.group(1):
                urls.insert(0, lk.group(1).strip())
    except Exception:
        pass
    for u in urls:
        try:
            h = _get(u)
        except Exception:
            continue
        if not h:
            continue
        t = _text(h)
        mm = re.search(r"(lower|reduc|cut|rais|increas|maintain|held|hold|keep)\w*\s+the target range for the federal funds rate\s+(?:by\s+[\w\s/-]+?\s+percentage point\s+)?(?:at|to)\s+([\d\s/-]+?)\s+to\s+([\d\s/-]+?)\s+percent", t, re.I)
        if not mm:
            continue
        lo, hi = _num(mm.group(2)), _num(mm.group(3))
        body = t[max(0, mm.start() - 2500): mm.start() + 3500]
        return {"url": u, "rate": hi, "lo": lo, "verb": mm.group(1).lower(), "text": body}
    return None


def tone(text, change_bp, surprise_bp):
    tl = text.lower()
    hk = sorted({re.search(p, tl).group(0) for p in HAWK if re.search(p, tl)})
    dv = sorted({re.search(p, tl).group(0) for p in DOVE if re.search(p, tl)})
    lang = max(-2, min(2, (len(hk) - len(dv)) / 2))
    dec = 2 if change_bp > 0 else -2 if change_bp < 0 else 0
    sur = 0 if surprise_bp is None else max(-2, min(2, surprise_bp / 25))
    score = round(dec + sur + lang, 1)
    lab = "HAWKISH" if score >= 2 else "LEANING HAWKISH" if score >= 1 else "DOVISH" if score <= -2 else "LEANING DOVISH" if score <= -1 else "NEUTRAL"
    return {"tone": lab, "score": score, "hawk": hk[:6], "dove": dv[:6], "parts": {"decision": dec, "surprise": round(sur, 2), "language": lang}}


def _fc(D, ccy, name):
    for e in (D.get("fx") or {}).get("events", []):
        if e.get("ccy") == ccy and e.get("event") == name and e.get("fc"):
            try:
                return float(str(e["fc"]).strip("%"))
            except ValueError:
                return None
    return None


def watch(D, now=None, tor=None):
    """Returns True when something new was recorded."""
    now = now or datetime.now(timezone.utc)
    tor = tor or TOR
    W = D.setdefault("policy_watch", {"log": []})
    cal = D.get("release_cal") or {}
    changed = False
    for bank, key, ccy, ev, fn in (("boc", "ca_policy", "CAD", "Overnight Rate", _boc), ("fed", "us_policy", "USD", "Federal Funds Rate", _fed)):
        for s_ in (cal.get(key) or {}).get("dates", []):
            t0 = datetime.fromisoformat(s_).replace(tzinfo=tor)
            if not (t0 - timedelta(minutes=2) <= now <= t0 + timedelta(hours=3)):
                continue
            rec = W.get(bank) or {}
            if rec.get("date") == t0.date().isoformat() and rec.get("rate") is not None:
                continue
            prev = None
            for m in D.get("macro", []) + D.get("macro_extra", []):
                if m.get("key") == key:
                    prev = m.get("value") if not rec.get("prev") else rec["prev"]
            if bank == "boc" and (D.get("fx") or {}).get("policy", {}).get("corra_now") is not None and prev is None:
                prev = D["fx"]["policy"]["corra_now"]
            base = {"bank": bank, "date": t0.date().isoformat(), "t_sched": t0.isoformat(), "prev": prev, "fc": _fc(D, ccy, ev),
                    "checks": (rec.get("checks") or 0) + 1, "t_first_check": rec.get("t_first_check") or now.isoformat(), "t_last_check": now.isoformat()}
            del PROBE[:]
            DEADLINE[0] = time.monotonic() + 25
            try:
                got = fn(t0.astimezone(tor).date())
            except Exception as e:
                got = None
                base["err"] = str(e)[:200]
            base["probe"] = PROBE[-6:]
            if not got or got.get("rate") is None:
                W[bank] = {**rec, **base, "status": "awaiting"}
                changed = True
                continue
            rate = round(got["rate"], 4)
            chg = round((rate - prev) * 100) if prev is not None else 0
            if prev is None and re.match(r"lower|reduc|cut", got["verb"]):
                chg = -25
            if prev is None and re.match(r"rais|increas", got["verb"]):
                chg = 25
            if got.get("src", "").startswith("valet") and prev is not None and rate == prev and now < t0 + timedelta(minutes=20):
                W[bank] = {**rec, **base, "status": "awaiting"}   # an unchanged Valet value this early can be yesterday's carried forward
                changed = True
                continue
            fc = base["fc"]
            sur = round((rate - fc) * 100) if fc is not None else None
            T = tone(got["text"], chg, sur)
            lag = (now - t0).total_seconds() / 60
            W[bank] = {**base, "status": "out", "rate": rate, "lo": got.get("lo"), "change_bp": chg, "decision": "HIKE" if chg > 0 else "CUT" if chg < 0 else "HOLD",
                       "surprise_bp": sur, **T, "url": got["url"], "t_seen": now.isoformat(), "lag_min": round(lag, 1),
                       "read_from": "rate series (statement text not read)" if got.get("src", "").startswith("valet") else "official statement"}
            W["log"] = ([x for x in W.get("log", []) if not (x.get("bank") == bank and x.get("date") == base["date"])] +
                        [{"bank": bank, "date": base["date"], "t_sched": base["t_sched"], "t_seen": now.isoformat(), "lag_min": round(lag, 1),
                          "decision": W[bank]["decision"], "rate": rate, "tone": T["tone"]}])[-24:]
            changed = True
            print(f"  policy {bank}: {W[bank]['decision']} {rate} ({chg:+d} bp) {T['tone']} — seen {lag:.1f} min after schedule")
    return changed


def merge(D, other):
    """Keep the EARLIEST sighting of each decision (another lane may already have recorded it)."""
    if not other:
        return False
    W = D.setdefault("policy_watch", {"log": []})
    ch = False
    for bank in ("boc", "fed"):
        o, r = other.get(bank), W.get(bank)
        if not o:
            continue
        if not r or (o.get("status") == "out" and (r.get("status") != "out" or (o.get("date") == r.get("date") and o.get("t_seen", "9") < r.get("t_seen", "9"))) ) or o.get("date", "") > r.get("date", ""):
            W[bank] = o; ch = True
    seen = {(x["bank"], x["date"]): x for x in W.get("log", [])}
    for x in other.get("log", []):
        k = (x["bank"], x["date"])
        if k not in seen or x.get("t_seen", "9") < seen[k].get("t_seen", "9"):
            seen[k] = x; ch = True
    W["log"] = sorted(seen.values(), key=lambda x: x["t_sched"])[-24:]
    return ch
