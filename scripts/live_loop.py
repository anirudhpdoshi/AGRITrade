#!/usr/bin/env python3
"""Fast lane: refresh the market-moving blocks every ~60 s and publish them as
live.json on the `live` branch (one amended commit, force-pushed, so the branch
never grows). The page reads it through the GitHub API, so there is no Pages
rebuild and no 10-minute Pages cache in the way.

Blocks: USD/CAD feed + 5-min intraday path, grain delayed quotes, WTI/Brent,
DXY and crosses. Everything else stays on the 15-minute update_data.py run.

Usage: python scripts/live_loop.py --minutes 33 --every 60
"""
import argparse, json, os, subprocess, sys, time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_data as U  # noqa: E402
import policy_watch as PW  # noqa: E402
PW.TOR = U.TOR

ROOT = U.ROOT
WT = "/tmp/live-worktree"
FAST = [("fx_spot", U.fx_spot), ("grains_quote", U.grains_quote), ("yields_live", U.yields_live), ("energy", U.energy), ("crosses", U.crosses)]

# Release watch: for 3 h after a scheduled release, the block that carries it is re-fetched
# here (every loop for CFTC/exports/WASDE, every loop for just the macro series still awaited)
# until the new numbers are in, and the changed sub-trees ride along in live.json ("rel"),
# so an open page sees them within a minute instead of waiting for the 15-min job + Pages build.
REL = {
    "cftc_grains": ("cftc", U.cftc_grains, lambda D: [f"grains.{k}.cftc" for k in D["grains"]] + [f"grains.{k}.cftc_stats" for k in D["grains"]]),
    "cftc_fx": ("cftc", U.cftc_fx, lambda D: ["fx.pos"]),
    "exports": ("exports", U.exports, lambda D: ["exports"]),
    "wasde": ("wasde", U.wasde, lambda D: ["wasde"]),
    "macro": ("macro", U.macro, lambda D: ["macro", "macro_extra"]),
}


def _get(D, path):
    for p in path.split("."):
        D = D[p]
    return D


def rel_done(D, name):
    """True once the release this block is waiting for is already in D."""
    et = U.NOW.astimezone(U.TOR)
    if name in ("cftc_grains", "cftc_fx"):
        exp = (et.date() - timedelta(days=(et.weekday() - 1) % 7)).isoformat()   # this week's Tuesday
        have = D["grains"]["corn"]["cftc"][-1]["date"] if name == "cftc_grains" else (D["fx"]["pos"].get("kpi") or {}).get("date", "")
        return have >= exp
    if name == "exports":
        exp = (et.date() - timedelta(days=7)).isoformat()
        wk = (D.get("exports") or {}).get("corn", {}).get("weeks") or [[None, ""]]
        return wk[-1][1] >= exp
    if name == "wasde":
        lab = max(d for d in U.WASDE_DATES if d <= et.date().isoformat())
        return (D.get("wasde") or {}).get("corn", {}).get("report") == datetime.fromisoformat(lab).strftime("%b %Y")
    if name == "macro":
        return not macro_due(D)
    return True


def macro_due(D):
    """Macro keys whose scheduled release fell in the last 3 h and whose new reading is not on the desk yet."""
    due = set()
    seen = {m["key"]: m.get("seen_at") for m in D.get("macro", [])}
    for k, v in (D.get("release_cal") or {}).items():
        ts = [datetime.fromisoformat(x).replace(tzinfo=U.TOR) for x in v.get("dates", [])]
        if v.get("rule") == "thu0830":
            ts += [t for t in U._release_times(D, "macro") if t.weekday() == 3 and t.hour == 8]
        for t in ts:
            if U.NOW - timedelta(hours=3) <= t <= U.NOW and k in seen and (not seen[k] or datetime.fromisoformat(seen[k]) < t):
                due.add(k)
    return due


def sh(*a, cwd=ROOT, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)


def setup_worktree():
    sh("git", "config", "user.name", "desk-live-bot")
    sh("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    has_remote = sh("git", "ls-remote", "--exit-code", "--heads", "origin", "live", check=False).returncode == 0
    sh("rm", "-rf", WT, check=False)
    sh("git", "worktree", "prune", check=False)
    if has_remote:
        sh("git", "fetch", "-q", "--depth", "1", "origin", "live:refs/remotes/origin/live")
        sh("git", "worktree", "add", "-f", "-B", "live", WT, "origin/live")
    else:
        sh("git", "worktree", "add", "--detach", WT)
        sh("git", "checkout", "-q", "--orphan", "live", cwd=WT)
        sh("git", "rm", "-rfq", ".", cwd=WT, check=False)
    for k, v in (("user.name", "desk-live-bot"), ("user.email", "41898282+github-actions[bot]@users.noreply.github.com")):
        sh("git", "config", k, v, cwd=WT)


def payload(D):
    a = D["meta"]["asof"]
    return {
        "fx": {"feed": D["fx"]["feed"], "intraday": D["fx"].get("intraday", []),
               "energy": D["fx"]["energy"], "wcs_diff": D["fx"]["wcs_diff"], "fxcross": D["fx"]["fxcross"], "yields_live": D["fx"].get("yields_live") or {}, "yields_live_ca": D["fx"].get("yields_live_ca") or {}},
        "grains": {k: {"intraday": g["fan"]["intraday"], "intraday_ts": g["fan"].get("intraday_ts"), "quotes": g.get("quotes") or {}} for k, g in D["grains"].items()},
        "asof": {k: a.get(k) for k in ("fx_spot", "grains_quote", "yields_live", "energy", "crosses")},
    }


def publish(body, first):
    path = os.path.join(WT, "live.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body, f, separators=(",", ":"))
    sh("git", "add", "live.json", cwd=WT)
    msg = "live: " + body["updated_at"]
    if first:
        sh("git", "commit", "-q", "-m", msg, cwd=WT, check=False)
    else:
        sh("git", "commit", "-q", "--amend", "-m", msg, cwd=WT)
    sh("git", "push", "-q", "-f", "origin", "live", cwd=WT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=33)
    ap.add_argument("--every", type=float, default=60)
    a = ap.parse_args()
    D = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))["DATA"]
    setup_worktree()
    first = not os.path.exists(os.path.join(WT, "live.json"))
    stop = time.time() + a.minutes * 60
    last_core = None
    rel_out, it, last_pub = {}, 0, 0.0
    try:   # carry the earliest sighting of a central-bank decision across fast-lane runs
        prev_live = json.loads(open(os.path.join(WT, "live.json")).read())
        pw = ((prev_live.get("rel") or {}).get("policy_watch") or {}).get("set", {}).get("policy_watch")
        if pw and PW.merge(D, pw):
            rel_out["policy_watch"] = {"asof": prev_live["rel"]["policy_watch"]["asof"], "set": {"policy_watch": D["policy_watch"]}}
    except Exception as e:
        print("policy carry-over skipped:", e)
    while time.time() < stop:
        t0 = time.time()
        U.NOW = datetime.now(timezone.utc)
        ok, errs = [], {}
        try:   # central-bank decision first, published at once: slow market or release fetches must never hold it back
            if PW.watch(D, U.NOW, U.TOR):
                D["meta"]["asof"]["policy_watch"] = U.iso(U.NOW)
                PW.apply_decisions(D)
                try:   # re-price the remaining meetings off the post-decision futures straight away
                    U.fed_odds(D, {})
                except Exception as e:
                    print("[fed odds after decision] failed:", e)
                PW.apply_decisions(D)
                rel_out["policy_watch"] = {"asof": U.iso(U.NOW), "set": {"policy_watch": D["policy_watch"], "fx.policy": D["fx"]["policy"],
                                           "macro": D.get("macro"), "macro_extra": D.get("macro_extra")}}
                early = payload(D)
                early["rel"] = rel_out
                try:
                    publish({**early, "updated_at": U.iso(U.NOW), "ok": [], "failed": {}}, first)
                    first = False
                    last_pub = time.time()
                    print(U.iso(U.NOW), "published policy watch", {b: (D["policy_watch"].get(b) or {}).get("status") for b in ("boc", "fed")})
                except subprocess.CalledProcessError as e:
                    print("publish failed:", e.stderr[-300:])
        except Exception as e:
            errs["policy_watch"] = str(e)[:160]
            print("[policy watch] failed:", e)
        for name, fn in FAST:
            t1 = time.time()
            try:
                fn(D, {})
                ok.append(name)
            except Exception as e:
                errs[name] = str(e)[:160]
                print(f"[{name}] failed: {e}")
            if time.time() - t1 > 20:
                errs[name + "_slow"] = f"{time.time() - t1:.0f} s"
        it += 1
        for name, (kind, fn, paths) in REL.items():
            if not U.recent_release(D, kind) or rel_done(D, name):
                continue
            try:
                D["meta"].pop({"macro": "macro_checked", "exports": "exports_checked", "wasde": "wasde_checked"}.get(name, "_"), None)
                if name == "macro":   # only the series still awaited (2-3 requests), every loop, BEA first for GDP/PCE
                    U.macro(D, {}, only=macro_due(D))
                else:
                    fn(D, {})
                if rel_done(D, name):
                    rel_out[name] = {"asof": D["meta"]["asof"].get(name) or U.iso(U.NOW), "set": {p: _get(D, p) for p in paths(D)}}
                    print(U.iso(U.NOW), "release landed:", name)
                else:
                    print(U.iso(U.NOW), "release not out yet:", name)
            except Exception as e:
                print(f"[rel {name}] failed: {e}")
        core = payload(D)
        if rel_out:
            core["rel"] = rel_out
        # publish on change, plus a heartbeat at least every 5 min even if every fast source failed, so the page can show
        # 'data stale' with the reason instead of the feed going silent
        if (ok and core != last_core) or time.time() - last_pub > 300:
            body = {**core, "updated_at": U.iso(U.NOW), "ok": ok, "failed": errs}
            try:
                publish(body, first)
                first = False
                last_core = core
                last_pub = time.time()
                print(U.iso(U.NOW), "published", ok, "failed", list(errs))
            except subprocess.CalledProcessError as e:
                print("publish failed:", e.stderr[-300:])
        else:
            print(U.iso(U.NOW), "no change")
        # while a central-bank decision is due and not yet read, check every 15 s instead of every minute
        hot = any(r.get("status") == "awaiting" and r.get("t_sched") and
                  U.NOW - datetime.fromisoformat(r["t_sched"]) < timedelta(hours=3)
                  for r in ((D.get("policy_watch") or {}).get(b) or {} for b in ("boc", "fed")))
        time.sleep(max(5, (15 if hot else a.every) - (time.time() - t0)))


if __name__ == "__main__":
    main()
