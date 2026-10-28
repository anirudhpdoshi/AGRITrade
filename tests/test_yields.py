"""Unit tests: live-yield proxy sensitivity fit (update_data.fit_sensitivity) and decision carry-over (policy_watch.apply_decisions).
Inputs are small synthetic series built for the arithmetic, not market data."""
import os, sys, random
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
os.environ.setdefault("FAS_API_KEY", "")
import update_data as U
import policy_watch as PW
n = fail = 0
def t(name, fn):
    global n, fail
    n += 1
    try: fn(); print("  ok ", name)
    except Exception as e: fail += 1; print("  FAIL", name, "->", repr(e))

print("proxy sensitivity fit")
random.seed(1)
days = [f"2026-{m:02d}-{d:02d}" for m in range(3, 11) for d in range(1, 29)]
px, y, p0, y0 = {}, {}, 100.0, 4.0
for d in days:
    r = random.gauss(0, 0.2)                 # % return
    p0 *= 1 + r / 100; y0 += (-4.0 * r + random.gauss(0, 0.3)) / 100   # true sensitivity -4 bp per 1%
    px[d], y[d] = p0, y0
def fit_ok():
    f = U.fit_sensitivity(px, y)
    assert abs(f["b"] + 4.0) < 0.4 and f["r2"] > 0.8 and f["n"] == 150, f
t("recovers the true slope (-4 bp per 1%) with high R^2", fit_ok)
t("too few common days -> None", lambda: U.fit_sensitivity({k: px[k] for k in days[:20]}, y) is None or (_ for _ in ()).throw(AssertionError()))
noise = {d: 4.0 + random.gauss(0, 0.05) for d in days}
t("unrelated series -> low R^2", lambda: U.fit_sensitivity(px, noise)["r2"] < 0.2 or (_ for _ in ()).throw(AssertionError()))

print("decision carry-over")
def mk():
    return {"policy_watch": {"boc": {"status": "out", "date": "2026-10-28", "rate": 2.5, "prev": 2.25, "decision": "HIKE", "change_bp": 25},
                             "fed": {"status": "out", "date": "2026-10-28", "rate": 4.0, "lo": 3.75, "decision": "HOLD", "change_bp": 0}},
            "fx": {"policy": {"corra_now": 2.25, "corra_date": "2026-10-27", "fed_range": "375-400 (NY Fed target range) · EFFR 3.88%",
                              "fed": [{"meeting": "2026-10-28"}, {"meeting": "2026-12-09"}]}},
            "macro_extra": [{"key": "ca_policy", "value": 2.25, "obs_date": "2026-10-27", "long": [["2026-10-27", 2.25]], "history": [["Oct 27", 2.25]]}]}
def carry():
    D = mk(); assert PW.apply_decisions(D)
    P = D["fx"]["policy"]
    assert P["corra_now"] == 2.5 and P["corra_date"] == "2026-10-28", P
    assert [m["meeting"] for m in P["fed"]] == ["2026-12-09"], P["fed"]
    m = D["macro_extra"][0]; assert m["value"] == 2.5 and m["prior"] == 2.25 and m["long"][-1] == ["2026-10-28", 2.5], m
    assert not PW.apply_decisions(D)   # idempotent
t("BoC hike becomes the current rate; decided Fed meeting leaves the odds list; idempotent", carry)
def newer_official():
    D = mk(); D["fx"]["policy"].update(corra_now=2.5, corra_date="2026-10-29"); PW.apply_decisions(D)
    assert D["fx"]["policy"]["corra_date"] == "2026-10-29"
t("a newer official value is never overwritten", newer_official)
def awaiting():
    D = mk(); D["policy_watch"]["boc"]["status"] = "awaiting"; D["policy_watch"]["fed"]["status"] = "awaiting"
    assert not PW.apply_decisions(D) and D["fx"]["policy"]["corra_now"] == 2.25
t("nothing changes while a decision is still awaited", awaiting)
print(f"\n{n - fail}/{n} passed"); sys.exit(1 if fail else 0)
