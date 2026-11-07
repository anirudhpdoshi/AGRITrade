const assert = require("node:assert"), test = require("node:test"), S = require("../swot-ui.js");
const C = [["2026-10-28", 10.00], ["2026-10-29", 9.95], ["2026-10-30", 9.90], ["2026-11-02", 9.92], ["2026-11-05", 9.85], ["2026-11-09", 9.80], ["2026-12-02", 9.70]];
test("price at announcement is the last close before it; horizons are 1 day, 1 week, 1 month", () => {
  const T = S.track(C, "14:20", "2026-10-29T08:30");
  assert.strictEqual(T.p0.d, "2026-10-28"); assert.strictEqual(T.day.d, "2026-10-29"); assert.strictEqual(T.week.d, "2026-11-05"); assert.strictEqual(T.month.d, "2026-12-02");
  assert.ok(Math.abs(T.week.pct - (-1.5)) < 1e-9);
});
test("an after-close release prices off that day's close", () => { const T = S.track(C, "14:20", "2026-10-30T15:30"); assert.strictEqual(T.p0.d, "2026-10-30"); assert.strictEqual(T.day.d, "2026-11-02"); });
test("no verified price, no horizon", () => { const T = S.track(C, "14:20", "2026-11-30T08:30"); assert.strictEqual(T.week, null); assert.strictEqual(T.month, null); assert.strictEqual(S.track(C, "14:20", "2026-10-01T08:30"), null); });
test("the BRD example: Negative tag, price -1% on the week is played out", () => {
  const it = { dir: -1, bucket: "Weakness", tr: { p0: {}, day: { pct: -0.4, d: "x" }, week: { pct: -1, d: "y" }, month: null } };
  assert.strictEqual(S.judge(it, "week").status, "Played out - week"); assert.strictEqual(S.judge(it, "week").bucket, "Weakness");
});
test("price against a Positive tag moves it to Threat with its trace", () => {
  const j = S.judge({ dir: 1, bucket: "Strength", tr: { day: { pct: -0.5, d: "a" }, week: { pct: -1.6, d: "2026-11-05" } } }, "week");
  assert.strictEqual(j.bucket, "Threat"); assert.deepStrictEqual([j.moved.from, j.moved.to, j.moved.d], ["Strength", "Threat", "2026-11-05"]);
});
test("disagreeing horizons are Mixed and stay put", () => { const j = S.judge({ dir: -1, bucket: "Weakness", tr: { day: { pct: 0.3 }, week: { pct: -1.2 } } }, "week"); assert.strictEqual(j.status, "Mixed horizons"); assert.strictEqual(j.bucket, "Weakness"); });
test("month horizon clamps to month end", () => { assert.strictEqual(S.addMonth("2026-01-31"), "2026-02-28"); assert.strictEqual(S.addMonth("2026-12-15"), "2027-01-15"); });
test("export sales below the trade range are Negative, Weakness", () => {
  const D = { grains: { soybeans: { history: [], cftc: [] } }, exports: { soybeans: { weeks: [["2026-10-29", "2026-11-05", 400000, 500000, 900000]] } } };
  const I = S.intelItems(D, "soybeans", "2026-11-07T02:00"); assert.strictEqual(I[0].tag, "Negative"); assert.strictEqual(I[0].bucket, "Weakness");
});
test("US rows carry a tag per target and never pre-tag an upcoming release", () => {
  const D = { macro: [{ key: "ca_gdpq", group: "ca", name: "Real GDP", period: "Q2 '26", value: -1.6, prior: 0.3, unit: "%", dec: 1, measure: "" }], fx: { releases: [], closes: [] }, release_cal: { us_cpi: { dates: ["2026-11-10T08:30"] } } };
  const R = S.usRows(D, "2026-11-07T02:00"); const r = R.rows[0];
  assert.deepStrictEqual([r.us, r.ca, r.fx, r.bucket, r.bucketCty], ["-", "Negative", "Up pressure", "Weakness", "Canada"]);
  assert.strictEqual(R.upcoming[0].label, "US CPI Nov 10"); assert.ok(!("tag" in R.upcoming[0]));
});
