/* Unit tests for the USD/CAD forecast engine (fxforecast.js). Run: node tests/fxforecast.test.js
   Deterministic fixtures only — no live data. */
"use strict";
const E = require("../fxforecast.js"), assert = require("assert");
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log("  ok  " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); } }
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || "") + " expected " + b + " got " + a);
/* seeded random walk */
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function walk(N, sd, drift) { const d = [], c = []; let p = 1.4, day = new Date("2025-01-01T12:00:00Z"); for (let i = 0; i < N; i++) { do { day.setUTCDate(day.getUTCDate() + 1); } while (!(day.getUTCDay() % 6)); p *= Math.exp((drift || 0) + sd * gauss()); d.push(day.toISOString().slice(0, 10)); c.push(p); } return { d, c }; }
const W = walk(420, 0.0025);
const I = { dates: W.d, close: W.c, wti: W.d.map((x, i) => [x, 80 + 5 * Math.sin(i / 9)]), dxy: W.d.map((x, i) => [x, 104 + Math.cos(i / 7)]), spread: [], cotz: [], iv: null, today: W.d[W.d.length - 1] };
const R = E.run(I);

console.log("maths");
t("ninv inverts ncdf", () => [0.01, 0.16, 0.5, 0.84, 0.99].forEach(p => close(E.ncdf(E.ninv(p)), p, 2e-4)));
t("Cornish-Fisher with zero skew/kurtosis is the normal quantile", () => close(E.cf(1.5, 0, 0), 1.5, 1e-12));
t("negative skew stretches the lower tail", () => assert.ok(Math.abs(E.cf(-2, -0.4, 0)) > Math.abs(E.cf(2, -0.4, 0))));
t("GARCH h-step variance with v1 = long-run equals h × long-run", () => close(E.garchH(2e-5, { a: 0.05, b: 0.9, vbar: 2e-5 }, 10), 2e-4, 1e-12));

console.log("forecast on a driftless random walk (daily σ 0.25%)");
t("1M σ ≈ 0.25% × √21", () => close(R.horizons["1M"].sd, 0.0025 * Math.sqrt(21), 0.003));
t("σ grows with horizon", () => assert.ok(R.horizons["1W"].sd < R.horizons["2W"].sd && R.horizons["2W"].sd < R.horizons["1M"].sd && R.horizons["1M"].sd < R.horizons["3M"].sd));
t("blend weights sum to 1", () => E.HK.forEach(k => close(Object.values(R.horizons[k].w).reduce((a, b) => a + b, 0), 1, 1e-9)));
t("1W 1σ back-test coverage near 68%", () => close(R.horizons["1W"].bt.cov1, 0.683, 0.12));
t("no direction rule passes on noise → neutral, zero drift", () => E.HK.forEach(k => { assert.strictEqual(R.horizons[k].mu, 0, k); })); 
t("quantiles are ordered and the median sits at spot ± a few pips", () => { const H = R.horizons["1M"], q = [0.05, 0.25, 0.5, 0.75, 0.95].map(p => E.q(H, 1.4, p)); for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1]); close(q[2], 1.4, 0.0015); });
t("P(above spot) ≈ 50% and touch = 2 × close-beyond", () => { const H = R.horizons["1M"]; close(E.pAbove(H, 1.4, 1.4), 0.5, 0.03); const L = E.q(H, 1.4, 0.9); close(E.pTouch(H, 1.4, L), 0.2, 0.01); });
t("bands at t < h are narrower than at h", () => { const H = R.horizons["1M"]; assert.ok(E.q(H, 1.4, 0.84, 5) < E.q(H, 1.4, 0.84)); });

console.log("direction scoring");
t("a perfect-foresight rule passes; its inverse fails", () => { const c = W.c, h = 5, s = c.map((x, i) => i + h < c.length ? Math.sign(c[i + h] - x) : 0); assert.ok(E.scoreDriver(s, c, h, 0).pass); assert.ok(!E.scoreDriver(s.map(x => -x), c, h, 0).pass); });
t("too few effective windows never passes", () => { const c = W.c.slice(0, 60), s = c.map((x, i) => i + 21 < c.length ? Math.sign(c[i + 21] - x) : 0); assert.ok(!E.scoreDriver(s, c, 21, 0).pass); });

console.log("implied-vol mapping (6C → USD/CAD)");
t("6C 25Δ RR flips sign; butterfly unchanged; strike inverts", () => { const m = E.map6C({ atm: 5.0, call25: 5.3, put25: 5.1, strike: 0.70 }); close(m.rr25, -0.2, 1e-9); close(m.bf25, 0.2, 1e-9); close(m.strike, 1 / 0.7, 1e-12); close(m.atm, 5.0, 0); });
t("daily expected move = IV / sqrt(252)", () => { const d = E.ivMove(5.0, 1.4377, 1); close(d.pct, 5 / Math.sqrt(252), 1e-9); close(d.pips, 1.4377 * 0.05 / Math.sqrt(252) * 1e4, 1e-6); });
t("21-session move = IV × sqrt(21/252)", () => close(E.ivMove(5.0, 1.4, 21).pct, 5 * Math.sqrt(21 / 252), 1e-9));

console.log("\n" + (n - fail) + "/" + n + " passed");
process.exit(fail ? 1 : 0);
