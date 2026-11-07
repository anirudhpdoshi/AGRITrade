const assert = require("node:assert"), test = require("node:test"), F = require("../fed-ui.js");
const h = (a) => a.map((v, i) => ["p" + i, v]);
const mk = (key, good, vals, extra) => Object.assign({ key, name: key, good, dec: 1, group: "us", hist24: h(vals), value: vals[vals.length - 1], prior: vals[vals.length - 2] }, extra || {});
test("hot, accelerating inflation with a firm economy reads Hike; cooling and weak reads Cut", () => {
  const hot = { macro: [mk("us_core_pce", "heat", [2.5, 2.6, 2.8, 3.1]), mk("us_cpi", "heat", [3, 3.1, 3.3, 3.6]), mk("us_gdp", "up", [1, 1, 2]), mk("us_ur", "down", [4.3, 4.3, 4.1])] };
  assert.strictEqual(F.model(hot).call, "Hike");
  const cold = { macro: [mk("us_core_pce", "heat", [2.4, 2.2, 2.0, 1.7]), mk("us_cpi", "heat", [2.5, 2.3, 2.1, 1.9]), mk("us_gdp", "up", [2, 2, 1]), mk("us_ur", "down", [4.1, 4.1, 4.4])] };
  assert.strictEqual(F.model(cold).call, "Cut");
});
test("revision pairs the last snapshot before a release with the first after it", () => {
  const D = { macro: [mk("us_cpi", "heat", [3, 3, 3.1], { seen_at: "2026-11-10T08:30:00-05:00" })], fed_odds_hist: [
    { t: "2026-11-10T13:00:00Z", meeting: "2026-12-09", hold: 30, hike: 70, ease: 0 }, { t: "2026-11-10T13:45:00Z", meeting: "2026-12-09", hold: 20, hike: 80, ease: 0 }] };
  const R = F.revisions(D); assert.strictEqual(R.length, 1); assert.strictEqual(R[0].d, 10);
});
test("no surprise is claimed before the forecast's release time", () => {
  const D = { macro: [mk("us_ism", "up", [54, 55], { cons: { at: "2026-12-01T10:00", forecast: 54.5 }, seen_at: "2026-11-02T10:00:00-05:00" })] };
  assert.strictEqual(F.surprises(D).length, 0);
});
