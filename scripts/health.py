"""System health monitor — publishes health.json to the `health` branch every 15 minutes.

Two panels, each with its own calculation (a green deploy never turns API health green, a 200 from a provider never
turns a stale snapshot green):

  1. Live data & API health   — independent probes of every upstream provider (status, latency, rate-limit headers),
                                 the data job's own block results, and per-feed freshness against a session-aware SLA.
  2. Scheduler & automation   — every workflow's runs in the last 24 h matched against the intended clock
                                 (scheduler.yml rules): ran / missed / late / failed / duplicate, duration, last and
                                 next run; plus the 8:23 AM options snapshot, release-triggered refreshes and the clock
                                 itself.

Reads only public artifacts and the GitHub Actions run list (GITHUB_TOKEN, actions: read). No provider keys are used
or needed: probes hit public endpoints only. Optional HEALTH_ALERT_WEBHOOK (e.g. an ntfy.sh topic URL) gets one
message when a check turns red and one when it recovers; the URL is never printed.
"""
import json, os, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

UTC, TOR, CT = timezone.utc, ZoneInfo("America/Toronto"), ZoneInfo("America/Chicago")
NOW = datetime.now(UTC)
REPO = os.environ.get("GITHUB_REPOSITORY", "anirudhpdoshi/AGRITrade")
UA = {"User-Agent": "agritrade-desk-health/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WT = os.path.join(ROOT, ".health-wt")
HIST_N = 7 * 96   # 7 days of 15-minute checks


def iso(d):
    return d.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def P(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=TOR)
    except ValueError:
        return None


def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def artifact(branch, path):
    """A published JSON straight from git (no CDN cache)."""
    try:
        if branch != "main":
            sh("git", "fetch", "-q", "--depth", "1", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}")
        return json.loads(sh("git", "show", f"origin/{branch}:{path}").stdout)
    except Exception:
        return None


# ------------------------------------------------------------------ market sessions (for "is stale" vs "market closed")
def fx_open(t):
    e = t.astimezone(TOR)
    wd, hm = e.weekday(), e.hour + e.minute / 60
    return not (wd == 5 or (wd == 4 and hm >= 17) or (wd == 6 and hm < 17))


def cbot_day(t):
    c = t.astimezone(CT)
    return c.weekday() < 5 and 8.5 <= c.hour + c.minute / 60 < 13.35


def _prev_wd(d):
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def last_settle_day():
    """Date of the newest CBOT settlement that should exist now (settles ~13:15–14:30 CT; holidays not modelled)."""
    c = NOW.astimezone(CT)
    d = c.date() if (c.weekday() < 5 and c.hour + c.minute / 60 >= 14.5) else _prev_wd(c.date() - timedelta(days=1))
    return _prev_wd(d)


def last_oi_day():
    """The 8:23 AM ET snapshot should carry today's date from 8:45 ET on weekdays, else the previous weekday's."""
    e = NOW.astimezone(TOR)
    return e.date() if (e.weekday() < 5 and (e.hour, e.minute) >= (8, 45)) else _prev_wd(e.date() - timedelta(days=1))


def weekday_et(t):
    return t.astimezone(TOR).weekday() < 5


# ------------------------------------------------------------------ panel 1: providers
PROBES = [   # (id, provider, delay class, used for, method, url, body)
    ("yahoo", "Yahoo Finance", "Delayed / reference", "FX, grain futures, energy, world markets", "GET", "https://query1.finance.yahoo.com/v8/finance/chart/CAD=X?range=1d&interval=1d", None),
    ("fred", "FRED (St. Louis Fed)", "Re-post of official data", "US macro history, rates, credit", "GET", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF&cosd=" + (NOW - timedelta(days=7)).date().isoformat(), None),
    ("valet", "Bank of Canada Valet", "Official", "Canadian rates, CPI-trim/median, USD/CAD fix", "GET", "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1", None),
    ("statcan", "Statistics Canada WDS", "Official", "Canadian jobs, GDP, CPI, trade, crops", "POST", "https://www150.statcan.gc.ca/t1/wds/rest/getSeriesInfoFromVector", [{"vectorId": 2062815}]),
    ("bea", "BEA API", "Official", "US GDP, PCE, income (release fast lane)", "GET", "https://apps.bea.gov/api/data?method=GETDATASETLIST&ResultFormat=JSON", None),
    ("nyfed", "New York Fed markets API", "Official", "Fed funds effective rate", "GET", "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json", None),
    ("treasury", "US Treasury FiscalData", "Official", "Deficit, debt wall", "GET", "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1?page[size]=1", None),
    ("cftc", "CFTC Socrata", "Official (weekly)", "Commitments of Traders", "GET", "https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$limit=1", None),
    ("ffcal", "Weekly economic calendar feed", "Calendar / consensus", "Release times and forecasts", "GET", "https://nfs.faireconomy.media/ff_calendar_thisweek.json", None),
    ("secworker", "Desk SEC data service (Cloudflare)", "Official filings", "Company research cards", "GET", "https://agritrade-sec.anirudh-p-doshi.workers.dev/health", None),
]
NOT_PROBED = [   # keyed or tightly rate-limited: judged from the data job's results instead of spending quota on a probe
    ("bls", "BLS public API", "Official", "Payrolls, CPI, PPI release fast lane", "Keyless limit is 25 calls a day: not probed, judged from the release fast lane."),
    ("usda", "USDA FAS / ESR", "Official (weekly)", "Export sales, WASDE", "Needs the FAS key: judged from the export-sales and WASDE blocks."),
    ("fmp", "Financial Modeling Prep", "Delayed", "US earnings calendar and profiles", "Needs the FMP key: judged from earnings.json (usage and endpoint status)."),
    ("ibkr", "Interactive Brokers (8:23 AM run)", "Daily snapshot", "Grain options chains / OI", "Runs as a scheduled Claude task outside GitHub: judged from the options snapshot time."),
]


def probe(p):
    pid, name, delay, used, method, url, body = p
    hdr = dict(UA)
    if pid == "secworker":
        hdr["Origin"] = "https://anirudhpdoshi.github.io"
    t0 = time.monotonic()
    try:
        r = requests.request(method, url, headers=hdr, json=body, timeout=20)
        ms = round((time.monotonic() - t0) * 1000)
        rl = {k: r.headers.get(k) for k in ("X-RateLimit-Remaining", "X-RateLimit-Limit", "Retry-After") if r.headers.get(k)}
        ok = r.status_code < 400
        return {"id": pid, "name": name, "delay": delay, "used_for": used, "status": r.status_code, "ms": ms, "ok": ok,
                "error": None if ok else f"HTTP {r.status_code}", "rate_limit": rl or None}
    except Exception as e:
        return {"id": pid, "name": name, "delay": delay, "used_for": used, "status": None, "ms": round((time.monotonic() - t0) * 1000),
                "ok": False, "error": type(e).__name__}


# feed freshness: (id, label, provider, delay class, when it must be fresh, max age minutes, timestamp getter)
def feeds(A):
    D = (A.get("data") or {}).get("DATA") or {}
    asof = (D.get("meta") or {}).get("asof") or {}
    L, W, B, PO, I, E = (A.get(k) or {} for k in ("live", "world", "briefing", "policy", "intel", "earnings"))
    meta = D.get("meta") or {}
    return [
        ("live", "Live price feed (live.json)", "Yahoo Finance", "Delayed / reference", fx_open, 5, L.get("updated_at")),
        ("fx_spot", "USD/CAD spot (desk copy)", "Yahoo Finance", "Delayed / reference", fx_open, 20, asof.get("fx_spot")),
        ("grains_quote", "Grain futures quotes", "Yahoo Finance (CBOT)", "Delayed ~10 min", cbot_day, 30, asof.get("grains_quote")),
        ("grains_settle", "Grain settlements", "Yahoo Finance (CBOT)", "End of day", lambda t: True, "settle", asof.get("grains_settle")),
        ("options", "Grain options / OI (runs 8:23, due 8:45 AM)", "Interactive Brokers", "Daily snapshot", lambda t: True, "oi", asof.get("options")),
        ("macro", "US & Canada macro", "FRED / BLS / BEA / StatCan / BoC", "Official release", weekday_et, 60 * 3, meta.get("macro_checked")),
        ("energy", "Energy (WTI, Brent, WCS)", "Yahoo Finance", "Delayed", fx_open, 60, asof.get("energy")),
        ("data", "Desk data (data.json)", "All blocks", "Mixed", weekday_et, 45, meta.get("updated_at")),
        ("world", "World markets", "Yahoo Finance", "Delayed", fx_open, 40, W.get("updated_at")),
        ("briefing", "Briefing", "News wires / RSS", "As published", lambda t: True, 60, B.get("updated_at")),
        ("policy", "Policy intelligence", "Central-bank sites", "As published", lambda t: t.astimezone(UTC).weekday() != 5, 40, PO.get("updated_at")),
        ("intel", "Global intelligence", "News / agencies", "As published", lambda t: weekday_et(t) and 11 <= t.astimezone(UTC).hour <= 23, 90, I.get("updated_at")),
        ("earnings", "US earnings", "Financial Modeling Prep", "Delayed", weekday_et, 60 * 4, E.get("updated_at")),
    ]


def panel_api(A, prev):
    pr = [probe(p) for p in PROBES]
    D = (A.get("data") or {}).get("DATA") or {}
    meta = D.get("meta") or {}
    lr, errs = meta.get("last_run") or {}, meta.get("last_errors") or {}
    blocks = {"ok": lr.get("ok"), "failed": lr.get("failed") or [], "at": lr.get("at"), "errors": {k: str(v)[:160] for k, v in errs.items()} if isinstance(errs, dict) else {}}
    F = []
    for fid, label, prov, delay, active, mx, ts in feeds(A):
        t = P(ts)
        age = round((NOW - t).total_seconds() / 60) if t else None
        on = bool(active(NOW))
        if mx in ("settle", "oi"):   # due by date, not by age: the last session's settlement / today's 8:23 snapshot
            due = last_settle_day() if mx == "settle" else last_oi_day()
            st = "missing" if t is None else "ok" if t.astimezone(TOR).date() >= due else "stale"
            F.append({"id": fid, "label": label, "provider": prov, "delay": delay, "asof": ts, "age_min": age, "due": due.isoformat(),
                      "market_open": True, "status": st, "fallback": st == "stale" and t is not None})
            continue
        st = "missing" if t is None else ("ok" if age <= mx else "stale") if on else "closed"
        if st == "closed" and t is not None and age > mx * 4 + 60 * 72:   # even closed, a weekend gap this long is wrong
            st = "stale"
        fallback = st == "stale" and t is not None   # the page keeps showing the last good value, labelled with its age
        F.append({"id": fid, "label": label, "provider": prov, "delay": delay, "asof": ts, "age_min": age, "max_min": mx,
                  "market_open": on, "status": st, "fallback": fallback})
    E = A.get("earnings") or {}
    quota = []
    rem = (E.get("usage") or {})
    if rem:
        quota.append({"provider": "Financial Modeling Prep", "used": rem.get("calls_today") or rem.get("used"), "limit": rem.get("limit") or rem.get("daily_limit"), "note": "earnings.json usage"})
    if meta.get("bls_fast_at"):
        quota.append({"provider": "BLS (keyless, 25/day)", "used": None, "limit": 25, "note": "last fast-lane call " + meta["bls_fast_at"]})
    for p in pr:
        if p.get("rate_limit"):
            quota.append({"provider": p["name"], "used": None, "limit": p["rate_limit"].get("X-RateLimit-Limit"), "remaining": p["rate_limit"].get("X-RateLimit-Remaining"), "note": "response headers"})
    up = [p for p in pr if p["ok"]]
    act = [f for f in F if f["status"] != "closed"]
    stale = [f for f in F if f["status"] in ("stale", "missing")]
    lat = sorted(p["ms"] for p in up)
    score = {"providers_up": len(up), "providers": len(pr), "success_rate": round(100 * len(up) / max(1, len(pr)), 1),
             "median_ms": lat[len(lat) // 2] if lat else None, "stale": len(stale), "feeds_active": len(act), "blocks_failed": len(blocks["failed"])}
    worst = "red" if (len(pr) - len(up) >= 3 or any(f["id"] in ("live", "fx_spot", "grains_quote", "options") and f["status"] in ("stale", "missing") for f in F)) \
        else "amber" if (len(up) < len(pr) or stale or blocks["failed"]) else "green"
    # provider uptime over the stored history (7 days of checks)
    hist = [h for h in (prev.get("history") or []) if h.get("api")]
    upt = {}
    for p in pr:
        seen = [h["api"].get("up", {}).get(p["id"]) for h in hist if p["id"] in h["api"].get("up", {})] + [p["ok"]]
        upt[p["id"]] = round(100 * sum(1 for x in seen if x) / len(seen), 1)
    for p in pr:
        p["uptime_7d"] = upt[p["id"]]
    return {"status": worst, "score": score, "providers": pr, "not_probed": [dict(zip(("id", "name", "delay", "used_for", "how"), x)) for x in NOT_PROBED],
            "feeds": F, "blocks": blocks, "quota": quota}


# ------------------------------------------------------------------ panel 2: scheduler
def _slots(wf, t0, t1):
    """Intended dispatch times (UTC) for a workflow between t0 and t1 — mirrors scheduler.yml."""
    out, t = [], t0.replace(second=0, microsecond=0)
    while t <= t1:
        m, h, dow = t.minute, t.hour, t.isoweekday()   # 1=Mon .. 7=Sun (date -u +%u)
        hit = {
            "refresh-data.yml": (m % 15 == 0 and dow <= 5 and 11 <= h <= 22) or (m == 30 and h == 0 and 2 <= dow <= 6),
            "world-markets.yml": m % 15 == 7 and (dow <= 5 or dow == 7),
            "global-grains.yml": m == 20 and dow <= 5 and h in (12, 17),
            "intel.yml": m == 50 and dow <= 5 and 10 <= h <= 22,
            "live-feed.yml": m % 30 == 20 and ((dow <= 5 and 12 <= h <= 22) or ((h < 12 or h > 22) and ((1 <= dow <= 5) or (dow == 7 and h >= 22) or (dow == 6 and h == 0)))),
            "briefing.yml": m % 30 == 7,
            "policy-intel.yml": m % 15 == 4 and (dow <= 5 or dow == 7),
            "us-earnings.yml": m == 17 and dow <= 5 and h in (14, 16, 18, 20),
        }.get(wf, False)
        if hit:
            out.append(t)
        t += timedelta(minutes=1)
    return out


JOBS = [   # (workflow file, label, cadence text, tolerance minutes)
    ("live-feed.yml", "60-second live refresh", "loops ~33 min, restarted every 30 min (FX week)", 8),
    ("refresh-data.yml", "15-minute desk data refresh", "every 15 min 11:00–22:45 UTC Mon–Fri + evening sweep", 8),
    ("world-markets.yml", "World markets", "every 15 min Sun–Fri", 8),
    ("policy-intel.yml", "Fed & central-bank policy", "every 15 min Sun–Fri", 8),
    ("briefing.yml", "Briefing", "every 30 min", 10),
    ("intel.yml", "Global intelligence", "hourly :50, 10:50–22:50 UTC Mon–Fri", 10),
    ("global-grains.yml", "Global grains", "12:20 and 17:20 UTC Mon–Fri", 15),
    ("us-earnings.yml", "US earnings", ":17 at 14/16/18/20 UTC Mon–Fri", 15),
]


def gh(path):
    tok = os.environ.get("GITHUB_TOKEN", "")
    r = requests.get("https://api.github.com/repos/" + REPO + path, headers={**UA, "Accept": "application/vnd.github+json", **({"Authorization": "Bearer " + tok} if tok else {})}, timeout=25)
    r.raise_for_status()
    return r.json()


def runs_of(wf, since):
    out, page = [], 1
    while page <= 4:
        j = gh(f"/actions/workflows/{wf}/runs?per_page=100&page={page}&created=>={since.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        rs = j.get("workflow_runs") or []
        out += rs
        if len(rs) < 100:
            break
        page += 1
    return out


def panel_sched(A):
    t0, t1 = NOW - timedelta(hours=24), NOW - timedelta(minutes=3)
    jobs, tot = [], {"expected": 0, "ran": 0, "ok": 0, "failed": 0, "missed": 0, "late": 0, "dup": 0}
    for wf, label, cad, tol in JOBS:
        try:
            R = runs_of(wf, t0 - timedelta(minutes=30))
        except Exception as e:
            jobs.append({"wf": wf, "label": label, "cadence": cad, "error": "run list unavailable (" + type(e).__name__ + ")"})
            continue
        R = sorted(R, key=lambda r: r["created_at"])
        S = _slots(wf, t0, t1)
        starts = [(P(r["created_at"]), r) for r in R]
        used, missed, late, dup = set(), [], 0, 0
        for s in S:
            m = [(t, r) for t, r in starts if timedelta(minutes=-2) <= t - s <= timedelta(minutes=tol)]
            if not m:
                missed.append(iso(s))
                continue
            if len(m) > 1:
                dup += len(m) - 1
            t, r = m[0]
            used.add(r["id"])
            if t - s > timedelta(minutes=5):
                late += 1
        done = [r for _, r in starts if r.get("status") == "completed" and P(r["created_at"]) >= t0]
        ok = [r for r in done if r.get("conclusion") == "success" or (wf == "live-feed.yml" and r.get("conclusion") == "cancelled")]   # live loops end by hand-over
        bad = [r for r in done if r.get("conclusion") in ("failure", "timed_out", "startup_failure")]
        durs = sorted(round((P(r["updated_at"]) - P(r.get("run_started_at") or r["created_at"])).total_seconds()) for r in ok)
        extra = {}
        if wf == "live-feed.yml":   # the 60-second cadence itself: age of live.json now
            lu = P((A.get("live") or {}).get("updated_at"))
            extra = {"live_age_s": round((NOW - lu).total_seconds()) if lu else None}
            if fx_open(NOW) and (not lu or NOW - lu > timedelta(minutes=5)):
                bad = bad + [{"created_at": iso(NOW), "html_url": None}]
        last = R[-1] if R else None
        nxt = _slots(wf, NOW, NOW + timedelta(days=2))
        st = "red" if (bad and bad[-1] is (done[-1] if done else None)) or (S and len(missed) > max(1, len(S) // 5)) else "amber" if (missed or bad or late > len(S) // 4) else "green"
        if not S and not R:
            st = "idle"
        jobs.append({"wf": wf, "label": label, "cadence": cad, "status": st, "expected": len(S), "ran": len([r for _, r in starts if P(r["created_at"]) >= t0]),
                     "succeeded": len(ok), "failed": len(bad), "missed": len(missed), "missed_at": missed[-5:], "late": late, "duplicates": dup,
                     "median_s": durs[len(durs) // 2] if durs else None,
                     "last": {"at": last["created_at"], "status": last.get("status"), "conclusion": last.get("conclusion"), "url": last.get("html_url")} if last else None,
                     "next": iso(nxt[0]) if nxt else None,
                     "last_failure": {"at": bad[-1]["created_at"], "url": bad[-1].get("html_url")} if bad else None, **extra})
        for k, v in (("expected", len(S)), ("ran", len(done)), ("ok", len(ok)), ("failed", len(bad)), ("missed", len(missed)), ("late", late), ("dup", dup)):
            tot[k] += v
    # the clock itself: exactly one scheduler loop in progress
    clock = {"label": "Scheduler clock (scheduler.yml)"}
    try:
        R = runs_of("scheduler.yml", NOW - timedelta(hours=8))
        live_ = [r for r in R if r.get("status") in ("in_progress", "queued")]
        clock.update(running=len(live_), started=live_[0]["created_at"] if live_ else None,
                     last_handover=max((r["created_at"] for r in R), default=None),
                     status="green" if len(live_) == 1 else "red" if not live_ else "amber")
    except Exception as e:
        clock.update(status="amber", error=type(e).__name__)
    # special checks
    D = (A.get("data") or {}).get("DATA") or {}
    meta, asof = D.get("meta") or {}, (D.get("meta") or {}).get("asof") or {}
    special = []
    et = NOW.astimezone(TOR)
    o = P(asof.get("options"))
    due823 = et.weekday() < 5 and (et.hour, et.minute) >= (8, 45)
    special.append({"id": "oi823", "label": "Options / OI snapshot (runs 8:23, due 8:45 AM ET)", "at": asof.get("options"),
                    "status": "green" if (o and o.astimezone(TOR).date() == et.date()) else ("red" if due823 else "idle"),
                    "note": "today's snapshot is on the desk" if (o and o.astimezone(TOR).date() == et.date()) else ("not on the desk yet for today" if due823 else "next run 8:23 AM ET on the next weekday")})
    mc = P(meta.get("model_checked"))
    special.append({"id": "model", "label": "Daily model recomputation", "at": meta.get("model_checked"),
                    "status": "green" if mc and NOW - mc < timedelta(hours=26) else "amber", "note": ""})
    # release-triggered refresh: scheduled release → value on the desk (last 7 days)
    rel = []
    seen = {m["key"]: m for m in D.get("macro", [])}
    for k, v in (D.get("release_cal") or {}).items():
        for s_ in v.get("dates") or []:
            t = P(s_)
            if not t or not (NOW - timedelta(days=7) <= t <= NOW) or k not in seen:
                continue
            sa = P(seen[k].get("seen_at"))
            lag = round((sa - t).total_seconds() / 60) if sa and sa >= t - timedelta(minutes=5) else None
            rel.append({"key": k, "name": seen[k].get("name"), "group": seen[k].get("group"), "scheduled": s_, "on_desk": seen[k].get("seen_at") if lag is not None else None, "lag_min": lag,
                        "status": "green" if lag is not None and lag <= 20 else "amber" if lag is not None and lag <= 90 else "red" if lag is not None or NOW - t > timedelta(hours=3) else "idle"})
    rel.sort(key=lambda r: r["scheduled"], reverse=True)
    special.append({"id": "release", "label": "Release-triggered refresh (last 7 days)", "status": "red" if any(r["status"] == "red" for r in rel) else "amber" if any(r["status"] == "amber" for r in rel) else "green" if rel else "idle",
                    "note": f"{sum(1 for r in rel if r['status'] == 'green')} of {len(rel)} releases on the desk within 20 min"})
    st = "red" if clock.get("status") == "red" or any(j.get("status") == "red" for j in jobs) or any(s["status"] == "red" for s in special) \
        else "amber" if any(j.get("status") == "amber" for j in jobs) or clock.get("status") == "amber" or any(s["status"] == "amber" for s in special) else "green"
    return {"status": st, "totals": tot, "jobs": jobs, "clock": clock, "special": special, "releases": rel[:20], "window_h": 24}


# ------------------------------------------------------------------ publish + alerts
def alerts(cur, prev):
    """One message when a panel or a critical item turns red, one when it recovers."""
    url = os.environ.get("HEALTH_ALERT_WEBHOOK", "").strip()
    def reds(h):
        out = set()
        for pn in ("api", "scheduler"):
            p = h.get(pn) or {}
            if p.get("status") == "red":
                out.add(pn)
        for f in (h.get("api") or {}).get("feeds", []):
            if f.get("status") in ("stale", "missing"):
                out.add("feed:" + f["id"])
        for j in (h.get("scheduler") or {}).get("jobs", []):
            if j.get("status") == "red":
                out.add("job:" + j["wf"])
        return out
    a, b = reds(cur), reds(prev or {})
    new, fixed = sorted(a - b), sorted(b - a)
    cur["alerts"] = {"webhook": "configured" if url else "not configured", "red_now": sorted(a), "raised": new, "cleared": fixed}
    if not url or not (new or fixed):
        return
    text = "AGRITrade system health\n" + ("\n".join("RED: " + x for x in new)) + ("\n" if new and fixed else "") + ("\n".join("Recovered: " + x for x in fixed))
    try:
        requests.post(url, data=text.encode("utf-8"), headers={"Title": "AGRITrade health", "Content-Type": "text/plain; charset=utf-8"}, timeout=15)
        cur["alerts"]["delivery"] = "sent"
    except Exception as e:
        cur["alerts"]["delivery"] = "failed: " + type(e).__name__


def main():
    dry = "--dry-run" in sys.argv
    sh("git", "fetch", "-q", "--depth", "1", "origin", "+refs/heads/main:refs/remotes/origin/main", check=False)
    A = {"data": artifact("main", "data.json"), "live": artifact("live", "live.json"), "world": artifact("world", "world.json"),
         "briefing": artifact("briefing", "briefing.json"), "policy": artifact("policyintel", "policy.json"),
         "intel": artifact("intel", "intel.json"), "earnings": artifact("earnings", "earnings.json")}
    prev = artifact("health", "health.json") or {}
    api = panel_api(A, prev)
    try:
        sch = panel_sched(A)
    except Exception as e:
        sch = {"status": "amber", "error": "scheduler check failed: " + type(e).__name__, "jobs": [], "special": [], "totals": {}}
    cur = {"updated_at": iso(NOW), "api": api, "scheduler": sch}
    alerts(cur, prev)
    tot = sch.get("totals") or {}
    point = {"t": iso(NOW), "api": {"status": api["status"], "rate": api["score"]["success_rate"], "ms": api["score"]["median_ms"], "stale": api["score"]["stale"],
                                    "up": {p["id"]: p["ok"] for p in api["providers"]}},
             "sch": {"status": sch["status"], "ok": tot.get("ok"), "expected": tot.get("expected"), "missed": tot.get("missed"), "failed": tot.get("failed")}}
    cur["history"] = ((prev.get("history") or []) + [point])[-HIST_N:]
    print(f"health: api {api['status']} ({api['score']['providers_up']}/{api['score']['providers']} up, {api['score']['stale']} stale) · scheduler {sch['status']} "
          f"({tot.get('ok')}/{tot.get('expected')} ok, {tot.get('missed')} missed, {tot.get('failed')} failed)")
    if dry:
        json.dump(cur, open(os.path.join(ROOT, "health.dry.json"), "w"), indent=1)
        return
    sh("git", "config", "user.name", "desk-health-bot")
    sh("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    exists = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "health", check=False).returncode == 0
    sh("rm", "-rf", WT, check=False)
    sh("git", "worktree", "prune", check=False)
    if exists:
        sh("git", "worktree", "add", "-f", "-B", "health", WT, "origin/health")
    else:
        sh("git", "worktree", "add", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", "health", cwd=WT)
        sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    with open(os.path.join(WT, "health.json"), "w", encoding="utf-8") as f:
        json.dump(cur, f, separators=(",", ":"))
    for k, v in (("user.name", "desk-health-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=WT)
    sh("git", "add", "health.json", cwd=WT)
    sh("git", "commit", "-q", *(["--amend"] if exists else []), "-m", "health: " + cur["updated_at"], cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "health", cwd=WT)


if __name__ == "__main__":
    main()
