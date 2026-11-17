"""breakouts engine: day high/low events with opening range and 30-min cooldown, MA crossings, close events, no repeats."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import breakouts as B

ok = 0
def check(c, msg):
    global ok
    if not c: print("FAIL", msg); sys.exit(1)
    ok += 1
def T(m): return f"2026-11-17T{14 + m // 60:02d}:{m % 60:02d}:00+00:00"
bars = [(T(30), 101, 99, 100), (T(35), 102, 99, 101.5), (T(45), 103, 100, 102.5), (T(50), 104, 101, 103.5), (T(80), 105, 102, 104.5), (T(85), 104, 95, 96)]
st = {}
ev = B.intraday_events(bars, prior_close=99.0, mas={20: 100.0, 50: 110.0, 100: None, 200: 90.0}, w52={"hi": 104.5, "lo": 80}, st=st, open_ts=T(45))
kinds = [(e[1], e[0]) for e in ev]
check(("day_high", T(45)) in kinds and ("day_high", T(50)) not in kinds and ("day_high", T(80)) in kinds, "opening range silent, 30-min cooldown, next window fires")
check(("w52_high", T(80)) in kinds and sum(1 for k in kinds if k[0] == "w52_high") == 1, "52-week high once")
check(any(e[1] == "ma_px" and "above its 20-day" in e[2] for e in ev) and any(e[1] == "ma_px" and "below its 20-day" in e[2] and e[0] == T(85) for e in ev), "20-day crossed up then down")
check(not any("50-day" in e[2] for e in ev), "never reached the 50-day: no event")
check(any(e[1] == "day_low" and e[0] == T(85) for e in ev), "new low after the opening range")
check(B.intraday_events(bars, 99.0, {20: 100.0}, None, st, T(45)) == [], "a second pass over the same bars adds nothing")
c = [100.0] * 199 + [90.0, 120.0]
ms = B.ma_state(c)
ce = B.close_events(ms)
check(any("Closed above its 20-day" in t for _, t, _ in ce) and any("Closed above its 200-day" in t for _, t, _ in ce), "close through MAs")
c2 = [100.0 - i * 0.01 for i in range(250)] + [160.0]
check(any("50-day MA crossed above the 200-day — golden cross" in t for _, t, _ in B.close_events(B.ma_state(c2))), "golden cross")
check(B.ma_state([1.0] * 10) is None, "short history")
print(f"{ok}/{ok} passed")
