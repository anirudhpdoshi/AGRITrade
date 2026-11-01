"""Legislation desk for the Briefing tab: what Parliament and Congress are doing and when they sit.

Canada (official, keyless)
  LEGISinfo (Library of Parliament)   every bill of the current session: stage reached, dates of each reading, royal assent
  House of Commons sitting calendar   sitting days per month (and the breaks between them)
United States (official)
  Congress.gov API (Library of Congress, free key in CONGRESS_API_KEY)  bills with their latest action; committee meetings
  House floor schedule                docs.house.gov 'bills this week' (XML) when the House sits; else the Majority Leader's
                                      daily schedule page, used only if it is from the last 7 days
Nothing here prints or stores the key; every error message is scrubbed of it.
"""
import datetime as dt
import os
import re
import xml.etree.ElementTree as ET

import requests

UA = {"User-Agent": "Mozilla/5.0 (desk briefing; +https://github.com/anirudhpdoshi/AGRITrade)"}
KEY = os.environ.get("CONGRESS_API_KEY", "").strip()
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
TOPICS = [("Budget & tax", r"budget|appropriation|tax|fiscal|spending|revenue|debt"), ("Trade & tariffs", r"tariff|trade|customs|import|export|cusma|usmca|duties|sanction"),
          ("Agriculture", r"agricultur|farm|grain|crop|food|livestock|dairy|fertili|rural|usda|seed"), ("Energy", r"energy|oil|gas|pipeline|electric|nuclear|mineral|ratepayer"),
          ("Financial", r"bank|financ|securities|payment|currency|crypto|digital asset|insurance|credit"), ("Transport", r"rail|transport|port|shipping|highway|aviation|water resources"),
          ("Border & security", r"border|immigra|security|defen[cs]e|criminal|fraud")]
SIGNIFICANT = r"became public law|signed by (?:the )?president|presented to (?:the )?president|passed|agreed to|cloture|reported|placed on (?:the )?(?:union|senate legislative) calendar|vote|veto|enrolled|conference"


def topics(t):
    tl = (t or "").lower()
    return [n for n, rx in TOPICS if re.search(rx, tl)]


def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=30, **kw)
    r.raise_for_status()
    return r


def scrub(e):
    s = f"{type(e).__name__}: {e}"
    return s.replace(KEY, "***") if KEY else s


# ---------------------------------------------------------------- Canada
def ca_calendar(html, today):
    """Sitting days from the Commons calendar -> sorted dates (the page lists them per month under 'For <Month> <Year>:')."""
    days = []
    for block in re.split(r"For\s+(?=[A-Z][a-z]+ \d{4}:)", html)[1:]:
        m = re.match(r"([A-Z][a-z]+) (\d{4}):", block)
        if not m or m.group(1).lower() not in MONTHS:
            continue
        mo, yr = MONTHS[m.group(1).lower()], int(m.group(2))
        nxt = re.search(r'aria-label="Sitting days:?"[^>]*>(.*?)</ul>', block[:6000], re.S)
        if nxt:
            for d in re.findall(r"<li>\s*[A-Za-z]+,\s+[A-Za-z]+\s+(\d{1,2})\s*</li>", nxt.group(1)):
                days.append(dt.date(yr, mo, int(d)))
    days = sorted(set(days))
    up = [d for d in days if d >= today]
    breaks = []
    for a, b in zip(up, up[1:]):
        if (b - a).days > 4:
            breaks.append({"from": (a + dt.timedelta(days=1)).isoformat(), "to": (b - dt.timedelta(days=1)).isoformat(), "returns": b.isoformat()})
    return {"next": [d.isoformat() for d in up[:10]], "breaks": breaks[:6], "last": up[-1].isoformat() if up else None,
            "sitting_today": today in days, "n_upcoming": len(up)}


def ca_bills(rows, now):
    out = []
    for b in rows:
        dates = [b.get(k) for k in ("PassedHouseFirstReadingDateTime", "PassedHouseSecondReadingDateTime", "PassedHouseThirdReadingDateTime",
                                    "PassedSenateFirstReadingDateTime", "PassedSenateSecondReadingDateTime", "PassedSenateThirdReadingDateTime",
                                    "ReceivedRoyalAssentDateTime", "LatestBillEventDateTime", "LatestCompletedBillStageDateTime")]
        dates = [d for d in dates if d and not d.startswith("0001")]
        last = max(dates) if dates else None
        title = b.get("ShortTitle") or b.get("LongTitle") or ""
        gov = bool(b.get("IsGovernmentBill"))
        moved = bool(last and (now - dt.datetime.fromisoformat(last[:19])).days <= 14)
        tp = topics(title + " " + (b.get("LongTitle") or ""))
        if not (gov or moved):
            continue
        code = b.get("NumberCode") or ""
        out.append({"code": code, "title": title, "gov": gov, "type": b.get("BillDocumentTypeName") or "", "stage": b.get("LatestCompletedMajorStageNameWithChamberSuffix") or b.get("LatestCompletedMajorStageName") or "",
                    "ongoing": b.get("OngoingStageName") or "", "status": b.get("StatusName") or "", "last": last[:10] if last else None, "moved": moved,
                    "assent": bool(b.get("ReceivedRoyalAssentDateTime")), "sponsor": (b.get("SponsorPersonName") or "").strip(), "topics": tp,
                    "url": f"https://www.parl.ca/legisinfo/en/bill/{b.get('ParliamentNumber')}-{b.get('SessionNumber')}/{code.lower()}"})
    out.sort(key=lambda x: (not x["moved"], x["assent"], -(int(re.sub(r"\D", "", x["last"] or "0") or 0))))
    return out


def canada(now):
    res, err = {}, {}
    try:
        rows = get("https://www.parl.ca/legisinfo/en/bills/json").json()
        res["bills"] = ca_bills(rows, now)[:25]
        res["session"] = f"{rows[0].get('ParliamentNumber')}-{rows[0].get('SessionNumber')}" if rows else ""
        res["n_bills"] = len(rows)
    except Exception as e:
        err["legisinfo"] = scrub(e)
    try:
        res["calendar"] = ca_calendar(get("https://www.ourcommons.ca/en/sitting-calendar").text, now.date())
    except Exception as e:
        err["calendar"] = scrub(e)
    res["errors"] = err
    return res


# ---------------------------------------------------------------- United States
BILL_PATH = {"HR": "house-bill", "S": "senate-bill", "HRES": "house-resolution", "SRES": "senate-resolution", "HJRES": "house-joint-resolution",
             "SJRES": "senate-joint-resolution", "HCONRES": "house-concurrent-resolution", "SCONRES": "senate-concurrent-resolution"}


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def us_bills(items, today, days=10):
    out = []
    for b in items:
        la = b.get("latestAction") or {}
        d, txt = la.get("actionDate") or "", la.get("text") or ""
        if not d or (today - dt.date.fromisoformat(d)).days > days or not re.search(SIGNIFICANT, txt.lower()):
            continue
        if b.get("type") in ("HRES", "SRES") and not topics(b.get("title")):
            continue   # simple resolutions (commemorations, rules) only when they touch a desk topic
        t, n, c = b.get("type", ""), b.get("number", ""), b.get("congress", 119)
        out.append({"code": f"{ {'HR': 'H.R.', 'S': 'S.', 'HJRES': 'H.J.Res.', 'SJRES': 'S.J.Res.', 'HRES': 'H.Res.', 'SRES': 'S.Res.'}.get(t, t) } {n}".strip(),
                    "title": b.get("title", ""), "action": txt, "date": d, "chamber": b.get("originChamber", ""), "topics": topics(b.get("title")),
                    "law": bool(re.search(r"became public law|signed by (?:the )?president", txt.lower())),
                    "url": f"https://www.congress.gov/bill/{ordinal(int(c))}-congress/{BILL_PATH.get(t, 'house-bill')}/{n}"})
    out.sort(key=lambda x: x["date"], reverse=True)
    return out


def house_floor_xml(xml_text):
    root = ET.fromstring(xml_text)
    items = []
    for fi in root.iter("floor-item"):
        num = (fi.findtext("legis-num") or "").strip()
        txt = " ".join((fi.findtext("floor-text") or "").split())
        if num or txt:
            items.append({"code": num, "title": txt, "topics": topics(txt)})
    return items


def house_floor_ml(html, today):
    """Majority Leader daily schedule page -> (date, items) when it is from the last 7 days, else None."""
    t = re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)).replace("&nbsp;", " ")
    t = re.sub(r"\s+", " ", t)
    m = re.search(r"Daily Schedule\s+([A-Z]+),\s+([A-Z]+)\s+(\d{1,2})", t)
    if not m or m.group(2).lower() not in MONTHS:
        return None
    d = dt.date(today.year, MONTHS[m.group(2).lower()], int(m.group(3)))
    if d > today + dt.timedelta(days=60):
        d = d.replace(year=today.year - 1)
    if (today - d).days > 7:
        return {"date": d.isoformat(), "items": [], "stale": True}
    seg = t[m.end(): m.end() + 6000]
    items = [{"code": a.strip(), "title": b.strip(), "topics": topics(b)} for a, b in re.findall(r"((?:H\.R\.|S\.|H\.Res\.|H\.J\.Res\.)\s?\d+)\s+[–-]\s+([^(]{4,160})", seg)]
    return {"date": d.isoformat(), "items": items[:20], "stale": False}


def congress(path, **params):
    return get("https://api.congress.gov/v3/" + path, params={"api_key": KEY, "format": "json", **params}).json()


def united_states(now):
    res, err = {}, {}
    today = now.date()
    mon = today - dt.timedelta(days=today.weekday()) if today.weekday() < 5 else today + dt.timedelta(days=7 - today.weekday())
    try:
        r = get(f"https://docs.house.gov/floor/Download.aspx?file=/billsthisweek/{mon:%Y%m%d}/{mon:%Y%m%d}.xml")
        if r.text.lstrip().startswith("<?xml") or "<floorschedule" in r.text[:500]:
            res["floor"] = {"date": mon.isoformat(), "week": True, "items": house_floor_xml(r.text), "src": "House floor schedule (docs.house.gov)"}
    except Exception as e:
        err["floor_xml"] = scrub(e)
    if "floor" not in res:
        try:
            f = house_floor_ml(get("https://www.majorityleader.gov/schedule/").text, today)
            if f:
                res["floor"] = dict(f, week=False, src="House Majority Leader daily schedule")
        except Exception as e:
            err["floor_ml"] = scrub(e)
    if KEY:
        try:
            items = congress("bill", sort="updateDate desc", limit=250).get("bills", [])
            res["bills"] = us_bills(items, today)[:25]
        except Exception as e:
            err["bills"] = scrub(e)
        try:
            hearings = []
            lst = congress(f"committee-meeting/119", limit=40).get("committeeMeetings", [])
            for m in lst:
                try:
                    d = get(m["url"], params={"api_key": KEY}).json().get("committeeMeeting", {})
                except Exception:
                    continue
                when = d.get("date") or ""
                if not when or when[:10] < today.isoformat() or (d.get("meetingStatus") or "").lower() in ("canceled", "cancelled", "postponed"):
                    continue
                hearings.append({"date": when, "title": " ".join((d.get("title") or "").split())[:220], "chamber": d.get("chamber", ""),
                                 "committee": ", ".join(c.get("name", "") for c in (d.get("committees") or [])[:2]), "type": d.get("type", ""),
                                 "topics": topics(d.get("title")), "url": f"https://www.congress.gov/event/119th-congress/{(d.get('chamber') or 'house').lower()}-event/{m.get('eventId')}"})
            hearings.sort(key=lambda h: h["date"])
            res["hearings"] = hearings[:15]
        except Exception as e:
            err["hearings"] = scrub(e)
    else:
        err["congress"] = "CONGRESS_API_KEY not set"
    res["errors"] = err
    return res


def build(now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    naive = now.replace(tzinfo=None)
    return {"asof": now.isoformat(), "ca": canada(naive), "us": united_states(now)}


if __name__ == "__main__":
    import json
    b = build()
    print(json.dumps({k: (v if k == "asof" else {kk: (len(vv) if isinstance(vv, list) else vv) for kk, vv in v.items()}) for k, v in b.items()}, indent=1)[:3000])
