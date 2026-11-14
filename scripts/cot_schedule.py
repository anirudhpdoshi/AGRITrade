"""CFTC Commitments of Traders release schedule -> data.json DATA.cot_schedule.

Reads https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm (one table per year: a row per
month, cells are release days, '*' = delayed by a federal holiday) and stores every release date. The desk derives from
it which Fridays are skipped, the delayed release day and the Tuesday the positions are as of. Nothing is guessed: if the
page cannot be read or parses to an implausible list, data.json is left as it is and the desk keeps its built-in dates.
"""
import json, re, sys, urllib.request
from datetime import date, datetime, timezone

URL = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm"
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                          "september", "october", "november", "december"])}


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (AGRITrade desk; schedule check)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def text(h):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h).replace("&nbsp;", " ")).strip()


def parse(html):
    """-> {year: [(iso, delayed_bool), ...]}"""
    years = [(m.start(), int(m.group(1))) for m in re.finditer(r"(20\d\d)\s*(?:COT\s*)?Release\s*Schedule", text_keep_pos(html), re.I)]
    out = {}
    for tr in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, re.I | re.S):
        cells = [text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr.group(1), re.I | re.S)]
        if not cells or cells[0].lower() not in MONTHS:
            continue
        yr = [y for p, y in years if p <= tr.start()]
        if not yr:
            continue
        y, mo = yr[-1], MONTHS[cells[0].lower()]
        for c in cells[1:]:
            for d, star in re.findall(r"(\d{1,2})\s*(\*?)", c):
                try:
                    out.setdefault(y, []).append((date(y, mo, int(d)).isoformat(), bool(star)))
                except ValueError:
                    pass
    return out


def text_keep_pos(html):
    """tags blanked to spaces of equal length, so match positions line up with the raw HTML"""
    return re.sub(r"<[^>]+>", lambda m: " " * len(m.group(0)), html)


def plausible(rows):
    """a real year has ~50 releases, all Mon-Fri, a delayed one never on a Friday"""
    if not 40 <= len(rows) <= 55:
        return False
    for iso, star in rows:
        wd = date.fromisoformat(iso).weekday()
        if wd > 4 or (star and wd == 4):
            return False
    return True


def main(argv):
    try:
        html = open(argv[argv.index("--file") + 1], encoding="utf-8").read() if "--file" in argv else fetch()
    except Exception as e:
        print(f"  COT schedule not read: {e}"); return 0
    P = parse(html)
    good = {y: sorted(set(r)) for y, r in P.items() if plausible(r)}
    for y in P:
        print(f"  {y}: {len(P[y])} release dates" + ("" if y in good else " — rejected (implausible)"))
    if not good:
        print("  COT schedule: nothing usable; data.json unchanged"); return 0
    J = json.load(open("data.json")); D = J["DATA"] if "DATA" in J else J
    old = D.get("cot_schedule") or {}
    years = dict(old.get("years") or {})
    for y, r in good.items():
        years[str(y)] = [iso for iso, _ in r]
    if years == old.get("years"):
        print("  COT schedule unchanged"); return 0
    D["cot_schedule"] = {"source": URL, "checked": datetime.now(timezone.utc).isoformat(timespec="seconds"), "years": years}
    if "--dry" not in argv:
        open("data.json", "w", encoding="utf-8").write(json.dumps(J, ensure_ascii=False, indent=1) + "\n")
    print("  data.json updated with the CFTC COT release schedule")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
