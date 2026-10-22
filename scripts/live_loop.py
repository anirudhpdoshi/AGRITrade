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
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_data as U  # noqa: E402

ROOT = U.ROOT
WT = "/tmp/live-worktree"
FAST = [("fx_spot", U.fx_spot), ("grains_quote", U.grains_quote), ("energy", U.energy), ("crosses", U.crosses)]


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
               "energy": D["fx"]["energy"], "wcs_diff": D["fx"]["wcs_diff"], "fxcross": D["fx"]["fxcross"]},
        "grains": {k: {"intraday": g["fan"]["intraday"], "intraday_ts": g["fan"].get("intraday_ts")} for k, g in D["grains"].items()},
        "asof": {k: a.get(k) for k in ("fx_spot", "grains_quote", "energy", "crosses")},
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
    while time.time() < stop:
        t0 = time.time()
        U.NOW = datetime.now(timezone.utc)
        ok = []
        for name, fn in FAST:
            try:
                fn(D, {})
                ok.append(name)
            except Exception as e:
                print(f"[{name}] failed: {e}")
        core = payload(D)
        if ok and core != last_core:
            body = {**core, "updated_at": U.iso(U.NOW), "ok": ok}
            try:
                publish(body, first)
                first = False
                last_core = core
                print(U.iso(U.NOW), "published", ok)
            except subprocess.CalledProcessError as e:
                print("publish failed:", e.stderr[-300:])
        else:
            print(U.iso(U.NOW), "no change")
        time.sleep(max(5, a.every - (time.time() - t0)))


if __name__ == "__main__":
    main()
