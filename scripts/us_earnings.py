#!/usr/bin/env python3
"""US Earnings (prototype) -> earnings.json on the orphan branch `earnings`, read by earnings-ui.js.

Provider: Financial Modeling Prep, stable API. The key lives only in the GitHub secret `FMP`; the browser never sees it and
never calls FMP — the page reads the published JSON.

FMP calls are metered, so every call has to earn its place:
  search-name  once per company *name* in the watchlist, ever (the ticker is cached in earnings.json)
  profile      once per symbol, then again only when the cached copy is older than PROFILE_MAX_DAYS (reference data)
  quote        once per symbol per run, and only when there can be a new price:
                 market open   -> previous quote older than QUOTE_MIN_MIN minutes
                 market closed -> previous quote taken before the last regular-session close (so it lacks the close)
               a run on a weekend or overnight after the closing quote is stored makes no quote calls at all
Hard stops: a daily budget (FMP_DAILY_BUDGET, default 200 of the free tier's 250) tracked in a ledger inside earnings.json,
a per-run cap (FMP_RUN_CAP, default 40), and the run ends at the first 401/403/429 so a bad key or a hit limit never
burns more calls. A failed symbol keeps its last good data, flagged.

The workflow is manual-only (workflow_dispatch) while this section is a prototype — nothing calls FMP unless you press Run.
Usage: python scripts/us_earnings.py [--force] [--force-profile] [--add "Archer Daniels, Bunge"] [--dry-run]
       --dry-run plans the calls and prints them without calling FMP or publishing.
"""
import argparse, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WATCHLIST = os.path.join(ROOT, "scripts", "data", "earnings_watchlist.json")
BRANCH, FILE, WT = "earnings", "earnings.json", "/tmp/earnings-wt"
BASE = "https://financialmodelingprep.com/stable/"
NY = ZoneInfo("America/New_York")
PROFILE_MAX_DAYS = 7
QUOTE_MIN_MIN = 10
CLOSE_GRACE_MIN = 5            # a quote taken within 5 min after 16:00 ET may still miss the closing print
DAILY_BUDGET = int(os.environ.get("FMP_DAILY_BUDGET", "200"))
RUN_CAP = int(os.environ.get("FMP_RUN_CAP", "40"))
FATAL = {401, 403, 429}        # bad key, plan blocked, limit reached -> stop the run
RESTRICT_DAYS = 30             # a 402 on quote means "not in your plan": price comes from profile, quote re-tried after 30 days

PROFILE_KEEP = ["symbol", "price", "change", "changePercentage", "volume", "companyName", "exchange", "exchangeFullName", "currency", "sector", "industry", "ceo", "country",
                "marketCap", "beta", "lastDividend", "range", "averageVolume", "fullTimeEmployees", "ipoDate", "website",
                "description", "image", "isEtf", "isAdr", "isActivelyTrading", "cik"]
QUOTE_KEEP = ["symbol", "name", "price", "change", "changePercentage", "volume", "open", "previousClose", "dayLow", "dayHigh",
              "yearLow", "yearHigh", "marketCap", "priceAvg50", "priceAvg200", "exchange", "timestamp"]


# ---------------------------------------------------------------- pure functions (unit-tested, no network)
def iso(t):
    return t.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def market_open(now):
    """NYSE regular session, Mon–Fri 09:30–16:00 New York (exchange holidays are not modelled: a holiday run just
    re-reads an unchanged quote once)."""
    n = now.astimezone(NY)
    return n.weekday() < 5 and (9, 30) <= (n.hour, n.minute) < (16, 0)


def last_close(now):
    """Most recent regular-session close (16:00 New York, weekdays) at or before `now`."""
    n = now.astimezone(NY)
    d = n.replace(hour=16, minute=0, second=0, microsecond=0)
    if n < d:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def quote_due(prev_fetched, now, force=False):
    """(due, reason) for one symbol's quote."""
    if force:
        return True, "forced"
    if not prev_fetched:
        return True, "no quote yet"
    if market_open(now):
        age = (now - prev_fetched).total_seconds() / 60
        return (age >= QUOTE_MIN_MIN, "market open, last quote %d min old" % age)
    if prev_fetched < last_close(now) + timedelta(minutes=CLOSE_GRACE_MIN):
        return True, "market closed, stored quote predates the close"
    return False, "market closed, closing quote already stored"


def profile_due(prev_fetched, now, force=False):
    if force:
        return True, "forced"
    if not prev_fetched:
        return True, "no profile yet"
    age = (now - prev_fetched).days
    return (age >= PROFILE_MAX_DAYS, "profile %d day(s) old" % age)


def ledger_today(usage, now):
    """Return the usage ledger rolled to today's UTC date (yesterday's total moves into history)."""
    day = now.astimezone(timezone.utc).date().isoformat()
    u = dict(usage or {})
    hist = list(u.get("history") or [])
    if u.get("day") and u["day"] != day:
        hist = [h for h in hist if h.get("day") != u["day"]] + [{"day": u["day"], "total": u.get("total", 0), "calls": u.get("calls", {})}]
        u = {}
    return {"day": day, "calls": dict(u.get("calls") or {"search": 0, "quote": 0, "profile": 0}), "total": int(u.get("total", 0)),
            "budget": DAILY_BUDGET, "run_cap": RUN_CAP, "history": hist[-14:]}


def plan(state, symbols, names, now, force=False, force_profile=False):
    """Ordered list of calls this run would make before the budget is applied: (endpoint, arg, reason).
    Names first (a resolved name feeds the symbol list), then quotes (what changes), then profiles (reference data)."""
    resolved = state.get("resolved") or {}
    comps = state.get("companies") or {}
    calls = []
    for nm in names:
        if nm.lower() not in resolved:
            calls.append(("search", nm, "name not resolved yet"))
    syms = list(dict.fromkeys([s.upper() for s in symbols] + [r["symbol"] for k, r in resolved.items() if k in {n.lower() for n in names} and r.get("symbol")]))
    later = []
    for s in syms:
        c = comps.get(s) or {}
        q, p = c.get("quote") or {}, c.get("profile") or {}
        if quote_restricted(c, now):
            # quote not in the plan: profile carries price/change/volume, so ONE profile call serves both,
            # on the quote timing rule (and at least every PROFILE_MAX_DAYS)
            due, why = quote_due(parse(p.get("fetched_at")) if p.get("price") is not None else None, now, force or force_profile)
            if not due:
                due, why = profile_due(parse(p.get("fetched_at")), now)
            if due:
                calls.append(("profile", s, "price via profile (quote not in plan): " + why))
            continue
        due, why = quote_due(parse(q.get("fetched_at")), now, force)
        if due:
            calls.append(("quote", s, why))
        due, why = profile_due(parse(p.get("fetched_at")), now, force_profile)
        if due:
            later.append(("profile", s, why))
    return calls + later


def quote_restricted(c, now):
    """True while a symbol's quote call is known to be outside the FMP plan (HTTP 402 within RESTRICT_DAYS)."""
    r = c.get("quote_restricted") or ((c.get("quote_error") or {}) if "402" in (c.get("quote_error") or {}).get("msg", "") else None)
    return bool(r and r.get("at") and now - parse(r["at"]) < timedelta(days=RESTRICT_DAYS))


def allowance(usage):
    return max(0, min(usage["budget"] - usage["total"], usage["run_cap"]))


def pick_match(results, name):
    """Best search-name hit for a company name: a US listing (NYSE/NASDAQ/AMEX) in USD, exact name first."""
    us = [r for r in (results or []) if (r.get("exchange") or "").upper() in ("NYSE", "NASDAQ", "AMEX") and (r.get("currency") or "USD") == "USD"]
    pool = us or (results or [])
    exact = [r for r in pool if (r.get("name") or "").lower() == name.lower()]
    return (exact or pool or [None])[0]


def trim(d, keep):
    return {k: d.get(k) for k in keep if d.get(k) is not None}


# ---------------------------------------------------------------- network
class Fatal(Exception):
    pass


def fmp(endpoint, params, key):
    """One FMP call. Returns parsed JSON; raises Fatal on 401/403/429; never lets the key reach a log line."""
    q = urllib.parse.urlencode(dict(params, apikey=key))
    req = urllib.request.Request(BASE + endpoint + "?" + q, headers={"User-Agent": "AGRITrade-desk/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = ""
        try:
            msg = json.loads(e.read().decode("utf-8")).get("Error Message", "")
        except Exception:
            pass
        msg = (msg or e.reason or "").replace(key, "***")[:160]
        if e.code in FATAL:
            raise Fatal("%s %s: HTTP %d %s" % (endpoint, params, e.code, msg))
        raise RuntimeError("HTTP %d %s" % (e.code, msg))
    except urllib.error.URLError as e:
        raise RuntimeError("network: %s" % str(e.reason).replace(key, "***")[:160])
    if isinstance(body, dict) and body.get("Error Message"):
        m = body["Error Message"].replace(key, "***")[:160]
        if "limit" in m.lower():
            raise Fatal("%s: %s" % (endpoint, m))
        raise RuntimeError(m)
    return body


# ---------------------------------------------------------------- git publish (same pattern as policy_intel.py)
def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def load_prev():
    sh("git", "fetch", "-q", "origin", BRANCH, check=False)
    r = sh("git", "show", f"origin/{BRANCH}:{FILE}", check=False)
    try:
        return json.loads(r.stdout) if r.returncode == 0 else {}
    except Exception:
        return {}


def publish(body):
    for k, v in (("user.name", "desk-earnings-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v)
    sh("git", "worktree", "prune", check=False)
    if sh("git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH, check=False).returncode == 0:
        sh("git", "worktree", "add", "-f", "-B", BRANCH, WT, f"origin/{BRANCH}")
    else:
        sh("git", "worktree", "add", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", BRANCH, cwd=WT)
        sh("git", "rm", "-rqf", ".", cwd=WT, check=False)
    with open(os.path.join(WT, FILE), "w") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    sh("git", "add", FILE, cwd=WT)
    if sh("git", "diff", "--cached", "--quiet", cwd=WT, check=False).returncode == 0:
        print("no change"); return
    sh("git", "commit", "-qm", "us earnings " + body["updated_at"], cwd=WT)
    sh("git", "push", "-q", "origin", f"HEAD:{BRANCH}", cwd=WT)
    print("published")


# ---------------------------------------------------------------- run
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-quote every symbol even if nothing can have changed")
    ap.add_argument("--force-profile", action="store_true", help="refresh every profile even if under 7 days old")
    ap.add_argument("--add", default="", help="comma-separated company names to resolve with search-name this run")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(timezone.utc)

    wl = json.load(open(WATCHLIST))
    symbols = [s.strip().upper() for s in wl.get("symbols", []) if s.strip()]
    names = [n.strip() for n in wl.get("names", []) + a.add.split(",") if n.strip()]

    state = {} if a.dry_run and os.environ.get("EARN_NO_PREV") else load_prev()
    comps = state.get("companies") or {}
    resolved = state.get("resolved") or {}
    usage = ledger_today(state.get("usage"), now)

    calls = plan(state, symbols, names, now, a.force, a.force_profile)
    room = allowance(usage)
    print(f"planned {len(calls)} call(s); allowance this run {room} (today {usage['total']}/{usage['budget']}, run cap {usage['run_cap']})")
    for c in calls:
        print("  ", c[0].ljust(8), c[1].ljust(14), c[2])
    if a.dry_run:
        return

    key = os.environ.get("FMP", "").strip()
    if not key:
        sys.exit("FMP secret is not set — add a repository secret named FMP")

    made, skipped, errors, stopped = [], [], [], None
    queue = list(calls)
    while queue:
        ep, arg, why = queue.pop(0)
        if allowance(usage) <= 0:
            skipped.append({"endpoint": ep, "arg": arg, "reason": "budget"}); continue
        if stopped:
            skipped.append({"endpoint": ep, "arg": arg, "reason": "run stopped"}); continue
        try:
            if ep == "search":
                res = fmp("search-name", {"query": arg}, key)
                hit = pick_match(res, arg)
                resolved[arg.lower()] = ({"query": arg, "symbol": hit["symbol"], "name": hit.get("name"), "exchange": hit.get("exchange"), "fetched_at": iso(now)}
                                         if hit else {"query": arg, "symbol": None, "fetched_at": iso(now)})
                if hit and hit["symbol"] not in symbols and not any(q[1] == hit["symbol"] for q in queue):
                    symbols.append(hit["symbol"])
                    c = comps.get(hit["symbol"]) or {}
                    if quote_due(parse((c.get("quote") or {}).get("fetched_at")), now, a.force)[0]:
                        queue.append(("quote", hit["symbol"], "new from search"))
                    if profile_due(parse((c.get("profile") or {}).get("fetched_at")), now, a.force_profile)[0]:
                        queue.append(("profile", hit["symbol"], "new from search"))
            else:
                res = fmp(ep, {"symbol": arg}, key)
                row = res[0] if isinstance(res, list) and res else None
                c = comps.setdefault(arg, {})
                if row:
                    c[ep] = dict(trim(row, QUOTE_KEEP if ep == "quote" else PROFILE_KEEP), fetched_at=iso(now))
                    c.pop(ep + "_error", None)
                    if ep == "quote":
                        c.pop("quote_restricted", None)
                else:
                    c[ep + "_error"] = {"at": iso(now), "msg": "empty response (symbol not covered?)"}
            made.append({"endpoint": ep, "arg": arg, "reason": why})
        except Fatal as e:
            stopped = str(e); errors.append(stopped)
            usage["calls"][ep] = usage["calls"].get(ep, 0) + 1; usage["total"] += 1   # the refused call still counts
            continue
        except Exception as e:
            errors.append(f"{ep} {arg}: {e}")
            if ep != "search":
                comps.setdefault(arg, {})[ep + "_error"] = {"at": iso(now), "msg": str(e)[:160]}
            if ep == "quote" and "402" in str(e):
                c = comps.setdefault(arg, {})
                c["quote_restricted"] = {"at": iso(now), "msg": "quote endpoint not in the FMP plan for this symbol (HTTP 402)"}
                c.pop("quote_error", None)
                if not any(x[0] == "profile" and x[1] == arg for x in queue) and (c.get("profile") or {}).get("fetched_at") != iso(now):
                    queue.append(("profile", arg, "price via profile after quote 402"))
            made.append({"endpoint": ep, "arg": arg, "reason": why, "failed": True})
        usage["calls"][ep] = usage["calls"].get(ep, 0) + 1
        usage["total"] += 1
        time.sleep(0.25)

    body = {
        "updated_at": iso(now),
        "provider": "Financial Modeling Prep (stable API)",
        "status": "prototype",
        "watchlist": symbols,
        "companies": {s: comps[s] for s in symbols if s in comps},
        "resolved": resolved,
        "session": {"open": market_open(now), "last_close": iso(last_close(now))},
        "usage": usage,
        "last_run": {"at": iso(now), "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"), "planned": len(calls),
                     "made": made, "skipped": skipped, "errors": errors, "stopped": stopped},
        "policy": {"quote": f"one per symbol per run; only when the market is open and the last quote is ≥{QUOTE_MIN_MIN} min old, "
                            "or when the stored quote predates the last close",
                   "profile": f"cached {PROFILE_MAX_DAYS} days; stands in for quote (same timing rule) where quote is not in the plan", "search": "once per company name, cached",
                   "budget": f"{DAILY_BUDGET}/day, {RUN_CAP}/run, stop on 401/403/429"},
    }
    print(f"made {len(made)} call(s), skipped {len(skipped)}, errors {len(errors)}; today {usage['total']}/{usage['budget']}")
    for e in errors:
        print("  !", e)
    if os.environ.get("EARN_OUT"):
        json.dump(body, open(os.environ["EARN_OUT"], "w"), indent=1); return
    publish(body)
    if stopped:
        sys.exit(f"stopped early: {stopped}")


if __name__ == "__main__":
    main()
