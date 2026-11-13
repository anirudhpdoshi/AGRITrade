"""CME Daily Bulletin (FINAL) -> exchange-final options open interest for the desk's near and far option months.

The 8:23 ET IBKR chain pull carries the exchange's PRELIMINARY open interest for the prior session. CME posts the FINAL
bulletin for that session around midday ET. This script fetches bulletin sections 56 (corn options) and 57 (soybean and
wheat options) through the desk's Cloudflare worker (CME refuses GitHub's runners), parses every strike's open interest
for the near and far option months, checks the parse against CME's own month TOTAL line, and only then replaces the
preliminary OI in data.json and relabels it final. Nothing is estimated: a month whose parse does not add up to the
CME total is left untouched.

    python scripts/cme_final.py [--file56 x.pdf --file57 y.pdf] [--dry]
"""
import io, json, re, sys, urllib.request
from datetime import datetime, timezone

WORKER = "https://agritrade-sec.anirudh-p-doshi.workers.dev/cme"
GRAIN = {"corn": "CORN", "soybeans": "SOYBEAN", "wheat": "WHEAT"}
SECTION = {"corn": "56", "soybeans": "57", "wheat": "57"}
MON = {"Jan": "JAN", "Feb": "FEB", "Mar": "MAR", "Apr": "APR", "May": "MAY", "Jun": "JUN", "Jul": "JUL", "Aug": "AUG",
       "Sep": "SEP", "Oct": "OCT", "Nov": "NOV", "Dec": "DEC"}
HEAD = re.compile(r"^([A-Z]{3}\d{2}) (CORN|SOYBEAN|WHEAT) (CALL|PUT)$")
NUM = re.compile(r"^-?[\d.,]+[ABN#*R]?$|^----$")


def fetch(sec):
    req = urllib.request.Request(f"{WORKER}?s={sec}", headers={"User-Agent": "AGRITrade desk"})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    if not b.startswith(b"%PDF"):
        raise RuntimeError(f"section {sec}: not a PDF ({b[:60]!r})")
    return b


def _int(t):
    t = t.rstrip("ABN#*R").replace(",", "")
    return None if t in ("", "----") else int(float(t))


def parse(pdf_bytes):
    """-> {"date": "YYYY-MM-DD", "bulletin": "219", "final": bool, "m": {("CORN","DEC26","CALL"): {"oi": {strike: oi}, "total": oi}}}"""
    import pdfplumber
    out, cur = {"date": None, "bulletin": None, "final": False, "m": {}}, None
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pg in pdf.pages:
            for line in (pg.extract_text() or "").split("\n"):
                line = line.strip()
                if out["date"] is None:
                    m = re.search(r"BULLETIN # (\d+)\S*.*?(\w{3}), (\w{3}) (\d{1,2}), (\d{4})", line)
                    if m:
                        out["bulletin"] = m.group(1)
                        out["date"] = datetime.strptime(f"{m.group(3)} {m.group(4)} {m.group(5)}", "%b %d %Y").strftime("%Y-%m-%d")
                if line == "FINAL" or line.endswith(" FINAL"):
                    out["final"] = True
                h = HEAD.match(line)
                if h:
                    cur = (h.group(2), h.group(1), h.group(3)); out["m"].setdefault(cur, {"oi": {}, "total": None}); continue
                if cur is None:
                    continue
                if line.startswith("TOTAL "):
                    t = line.split()
                    if len(t) >= 3:
                        out["m"][cur]["total"] = _int(t[2])
                    cur = None; continue
                t = line.split()
                if len(t) < 11 or not t[0].isdigit() or not all(NUM.match(x) for x in t[1:6]):
                    continue
                i = 6
                if t[i] == "UNCH" or t[i] == "NEW":
                    i += 1
                elif t[i] in ("+", "-"):
                    i += 2
                else:
                    i += 1       # sign glued to the number
                try:
                    oi = _int(t[i + 3])  # delta, exercises, volume, OPEN INTEREST
                except (IndexError, ValueError):
                    continue
                if oi is None:
                    oi = 0
                out["m"][cur]["oi"][int(t[0])] = oi
    return out


def leg_month(leg):
    """'Dec-26' -> 'DEC26'"""
    m = re.match(r"([A-Z][a-z]{2})-(\d{2})$", leg.get("chain") or "")
    return MON[m.group(1)] + m.group(2) if m else None


def oi_date(leg, year):
    m = re.search(r"OI as of (\w{3}) (\d{1,2})", leg.get("oi_label") or "")
    if leg.get("oi_date"):
        return leg["oi_date"]
    if not m:
        return None
    return datetime.strptime(f"{m.group(1)} {m.group(2)} {year}", "%b %d %Y").strftime("%Y-%m-%d")


def strike_of(raw, ref):
    s = raw / 100.0
    return s / 10.0 if ref and s > ref * 4 else s


def apply(D, P, grain):
    """Replace OI in grains[grain].near/far with the CME final where the month parsed cleanly. Returns a list of notes."""
    G, notes = D["grains"][grain], []
    bdate, yr = P["date"], (P["date"] or "2000")[:4]
    lab = datetime.strptime(bdate, "%Y-%m-%d").strftime("%b %-d") if bdate else ""
    for side in ("near", "far"):
        leg = G.get(side) or {}
        mon = leg_month(leg)
        if not mon or not leg.get("rows"):
            continue
        cur = oi_date(leg, yr)
        if leg.get("oi_final") and cur == bdate:
            notes.append(f"{grain} {side} {mon}: already final for {bdate}"); continue
        if cur and cur > bdate:
            notes.append(f"{grain} {side} {mon}: desk OI ({cur}) is newer than bulletin ({bdate}) — kept"); continue
        C, Pt = P["m"].get((GRAIN[grain], mon, "CALL")), P["m"].get((GRAIN[grain], mon, "PUT"))
        if not C or not Pt:
            notes.append(f"{grain} {side} {mon}: month not in bulletin"); continue
        bad = [k for k, x in (("calls", C), ("puts", Pt)) if x["total"] is None or sum(x["oi"].values()) != x["total"]]
        if bad:
            notes.append(f"{grain} {side} {mon}: parse does not match CME total for {', '.join(bad)} — kept preliminary"); continue
        ref = leg.get("underlying") or (G.get("fan") or {}).get("anchor")
        cmap = {round(strike_of(k, ref), 4): v for k, v in C["oi"].items()}
        pmap = {round(strike_of(k, ref), 4): v for k, v in Pt["oi"].items()}
        rows, seen = [], set()
        for r in leg["rows"]:
            k = round(r[0], 4); seen.add(k)
            r = list(r); r[1] = cmap.get(k, 0); r[2] = pmap.get(k, 0); rows.append(r)
        for k in sorted(set(cmap) | set(pmap)):
            if k not in seen:
                rows.append([k, cmap.get(k, 0), pmap.get(k, 0)])
        rows.sort(key=lambda r: r[0])
        calls, puts = sum(r[1] for r in rows), sum(r[2] for r in rows)
        cw = max(rows, key=lambda r: r[1]); pw = max(rows, key=lambda r: r[2])
        old = (leg.get("calls"), leg.get("puts"))
        leg.update({"rows": rows, "calls": calls, "puts": puts, "call_wall": [cw[0], cw[1]], "put_wall": [pw[0], pw[2]],
                    "pcr": round(puts / calls, 2) if calls else None, "oi_final": True, "oi_date": bdate,
                    "oi_label": f"CME Daily Bulletin #{P['bulletin']} final · OI as of {lab} close"})
        if side == "near" and G.get("fan"):
            G["fan"]["pcr"] = f"{leg['pcr']:.2f}" if leg["pcr"] is not None else G["fan"].get("pcr")
            G["fan"]["call_wall"] = [cw[0], f"{cw[1]:,}"]; G["fan"]["put_wall"] = [pw[0], f"{pw[2]:,}"]
        for ch in ((D.get("optflow") or {}).get(grain) or {}).get("chains", []):
            if ch.get("contract") == leg.get("contract") and ch.get("chain") == leg.get("chain"):
                ch["calls_oi"], ch["puts_oi"] = calls, puts
                ch["pcr"] = round(puts / calls, 2) if calls else ch.get("pcr")
        notes.append(f"{grain} {side} {mon}: final OI applied — calls {old[0]}→{calls}, puts {old[1]}→{puts}")
    return notes


def main(argv):
    args = dict(zip(argv[::2], argv[1::2])) if len(argv) % 2 == 0 else {}
    dry = "--dry" in argv
    path = "data.json"
    J = json.load(open(path))
    D = J["DATA"] if "DATA" in J else J
    pdfs, notes = {}, []
    for sec in ("56", "57"):
        try:
            b = open(args[f"--file{sec}"], "rb").read() if f"--file{sec}" in args else fetch(sec)
            pdfs[sec] = parse(b)
        except Exception as e:
            notes.append(f"section {sec}: {e}")
    changed = False
    for g in ("corn", "soybeans", "wheat"):
        P = pdfs.get(SECTION[g])
        if not P or not P["date"]:
            continue
        if not P["final"]:
            notes.append(f"{g}: bulletin {P['bulletin']} is not marked FINAL — skipped"); continue
        n = apply(D, P, g); notes += n
        changed |= any("final OI applied" in x for x in n)
    for x in notes:
        print(" ", x)
    if changed and not dry:
        D.setdefault("meta", {}).setdefault("asof", {})["options_final"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        open(path, "w", encoding="utf-8").write(json.dumps(J, ensure_ascii=False, indent=1) + "\n")
        print("data.json updated with CME final open interest")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
