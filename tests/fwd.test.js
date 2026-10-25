/* Unit tests for the USD/CAD forward pricing core (fwd.js). Run: node tests/fwd.test.js
   Deterministic fixtures only — no live data. */
"use strict";
const F = require("../fwd.js"), assert = require("assert");
let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log("  ok  " + name); } catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); } }
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || "") + " expected " + b + " got " + a);
const TRADE = F.utc(2026, 10, 23);                       // Fri Oct 23 2026 -> spot Mon Oct 26
const US = { "1M": 4.10, "3M": 4.22, "6M": 4.30, "1Y": 4.41, "2Y": 4.65, "5Y": 4.78 };
const CA = { "1M": 2.37, "3M": 2.40, "6M": 2.45, "1Y": 2.60, "2Y": 3.22, "5Y": 3.50 };
const snap = (o) => Object.assign({ spot: 1.40000, us: US, ca: CA, trade: TRADE }, o || {});
const leg = (r, k) => r.legs.find(l => l.t === k);

console.log("dates");
t("spot date is T+1 and skips the weekend (Fri -> Mon)", () => assert.strictEqual(F.spotDate(TRADE).toISOString().slice(0, 10), "2026-10-26"));
t("Thu trade -> Fri spot", () => assert.strictEqual(F.spotDate(F.utc(2026, 10, 22)).toISOString().slice(0, 10), "2026-10-23"));
t("end-of-month rule: Jan 31 + 1M = Feb 28 (not Mar 3)", () => assert.strictEqual(F.addMonths(F.utc(2027, 1, 31), 1).toISOString().slice(0, 10), "2027-02-28"));
t("leap year: Jan 31 2028 + 1M = Feb 29", () => assert.strictEqual(F.addMonths(F.utc(2028, 1, 31), 1).toISOString().slice(0, 10), "2028-02-29"));
t("modified following stays in the month (Sat Oct 31 2026 -> Fri Oct 30)", () => assert.strictEqual(F.valueDate(F.utc(2026, 9, 30), "M", 1).toISOString().slice(0, 10), "2026-10-30"));
t("value dates: 3M from Mon Oct 26 2026 = Tue Jan 26 2027, 92 days", () => { const l = leg(F.price(snap()), "3M"); assert.strictEqual(l.vd.toISOString().slice(0, 10), "2027-01-26"); assert.strictEqual(l.days, 92); });

console.log("currency orientation (USD/CAD = CAD per USD)");
t("USD rates above CAD rates -> forward DISCOUNT (F < S) at every tenor", () => F.price(snap()).legs.forEach(l => assert.ok(l.F < 1.4, l.t + " " + l.F)));
t("CAD rates above USD rates -> forward PREMIUM (F > S)", () => F.price(snap({ us: CA, ca: US })).legs.forEach(l => assert.ok(l.F > 1.4, l.t)));
t("equal rates -> F = S", () => F.price(snap({ ca: US })).legs.forEach(l => close(l.F, 1.4, 1e-12, l.t)));
t("forward points = (F - S) x 10,000 pips", () => { const l = leg(F.price(snap()), "6M"); close(l.pts, (l.F - 1.4) * 1e4, 1e-9); });

console.log("formulas");
t("sub-1Y simple: 3M = S(1+rCAD*T)/(1+rUSD*T), T = 92/365, rates interpolated at T", () => { const l = leg(F.price(snap()), "3M"), T = 92 / 365;
  close(l.rUSD, F.rateAt(US, T), 1e-15); close(l.F, 1.4 * (1 + l.rCAD / 100 * T) / (1 + l.rUSD / 100 * T), 1e-12); });
t("node rates hit exactly when T equals a node (1Y leg = 365 days)", () => { const l = leg(F.price(snap()), "1Y"); assert.strictEqual(l.days, 365); close(l.rUSD, 4.41, 1e-12); close(l.rCAD, 2.60, 1e-12); });
t("hand check: 3M outright = 1.39364 (to 5 dp)", () => assert.strictEqual(leg(F.price(snap()), "3M").F.toFixed(5), "1.39364"));
t("2Y semi-annual DF: F = S(1+rUSD/2)^-2T / (1+rCAD/2)^-2T", () => { const l = leg(F.price(snap()), "2Y"), T = l.days / 365;
  close(l.F, 1.4 * Math.pow(1 + l.rUSD / 200, -2 * T) / Math.pow(1 + l.rCAD / 200, -2 * T), 1e-12); assert.strictEqual(l.basis, "bond (semi-annual)"); });
t("F is linear in spot (all tenors)", () => { const a = F.price(snap()), b = F.price(snap({ spot: 2.8 })); a.legs.forEach((l, i) => close(b.legs[i].F, 2 * l.F, 1e-12, l.t)); });
t("discount deepens with tenor when the gap is stable", () => { const r = F.price(snap({ us: { "1M": 4, "5Y": 4 }, ca: { "1M": 2, "5Y": 2 } })); for (let i = 1; i < r.legs.length; i++) assert.ok(r.legs[i].F < r.legs[i - 1].F, r.legs[i].t); });

console.log("rate-differential response");
t("raising a USD rate lowers every forward (more discount)", () => { const a = F.price(snap()), b = F.price(snap({ us: Object.fromEntries(Object.entries(US).map(([k, v]) => [k, v + 0.25])) })); a.legs.forEach((l, i) => assert.ok(b.legs[i].F < l.F, l.t)); });
t("raising a CAD rate raises every forward", () => { const a = F.price(snap()), b = F.price(snap({ ca: Object.fromEntries(Object.entries(CA).map(([k, v]) => [k, v + 0.25])) })); a.legs.forEach((l, i) => assert.ok(b.legs[i].F > l.F, l.t)); });
t("changing only the CAD 2Y node moves the 2Y leg up only (1Y and 5Y sit on their own nodes; 1W-6M untouched)", () => { const a = F.price(snap()), b = F.price(snap({ ca: Object.assign({}, CA, { "2Y": 3.5 }) }));
  ["1W", "2W", "1M", "2M", "3M", "6M"].forEach(k => close(leg(b, k).F, leg(a, k).F, 1e-15, k)); assert.ok(leg(b, "2Y").F > leg(a, "2Y").F, "2Y"); ["1Y", "5Y"].forEach(k => close(leg(b, k).F, leg(a, k).F, 1e-15, k + " sits on its own node")); });
t("interpolation: 9M rate sits between 6M and 1Y nodes", () => { const r = F.rateAt(US, 0.75); assert.ok(r > 4.30 && r < 4.41); });
t("flat extrapolation below the first node", () => close(F.rateAt(US, 0.01), 4.10, 1e-12));

console.log("missing / invalid inputs");
for (const bad of [0, -1.4, NaN, null, undefined, "abc", Infinity]) t("invalid spot " + String(bad) + " -> unavailable, no prices", () => { const r = F.price(snap({ spot: bad })); assert.strictEqual(r.ok, false); r.legs.forEach(l => assert.strictEqual(l.F, null)); });
t("missing CAD curve -> unavailable with reason", () => { const r = F.price(snap({ ca: {} })); assert.strictEqual(r.ok, false); assert.ok(/CAD/.test(r.reason)); r.legs.forEach(l => assert.strictEqual(l.F, null)); });
t("missing USD curve -> unavailable", () => assert.strictEqual(F.price(snap({ us: null })).ok, false));
t("null / non-numeric nodes are ignored, remaining nodes still price", () => { const r = F.price(snap({ us: { "3M": null, "1Y": "x", "2Y": 4.6 } })); assert.ok(r.ok); r.legs.forEach(l => close(l.rUSD, 4.6, 1e-12)); });
t("unknown node labels are ignored", () => close(F.rateAt({ "7W": 9, "1Y": 4 }, 0.5), 4, 1e-12));

console.log("\n" + (n - fail) + "/" + n + " passed");
process.exit(fail ? 1 : 0);
