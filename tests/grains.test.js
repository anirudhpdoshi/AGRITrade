const test = require("node:test"), assert = require("node:assert");
const G = require("../grains-ui.js");
test("FND is the last weekday before the contract month", () => {
  assert.strictEqual(G.fndLabel("ZCZ26"), "Mon, Nov 30, 2026");
  assert.strictEqual(G.fndLabel("ZSX26"), "Fri, Oct 30, 2026");   /* Oct 31 is a Saturday */
  assert.strictEqual(G.fndLabel("ZSF27"), "Thu, Dec 31, 2026");
  assert.strictEqual(G.fndLabel("bad"), null);
});
test("tile prints c/bu with signed cents and percent together", () => {
  const T = G.tile({ contract: "ZSF27", expiry: "Jan-27", settle: 12.0375, prev: 12.14, settle_date: "2026-11-04" });
  assert.strictEqual(T.settle, "1,203.75"); assert.strictEqual(T.chg, "−10.25¢"); assert.strictEqual(T.pct, "−0.84%"); assert.strictEqual(T.dir, "down");
});
test("missing data is unavailable, never zero", () => { assert.strictEqual(G.tile({ contract: "ZCZ26" }), null); assert.strictEqual(G.tile(null), null); });
test("strip follows a delayed quote newer than the settlement, priced against that settlement", () => {
  const G = require("../grains-ui.js"), row = { contract: "ZCZ26", settle: 4.415, prev: 4.4, settle_date: "2026-11-06" };
  const g = { quotes: { ZCZ26: { px: 4.46, ts: "2026-11-09T10:05:00-05:00", label: "10:05am ET" } } };
  const T = G.tile(row, g); assert.strictEqual(T.px, 4.46); assert.strictEqual(T.chg, "+4.50¢"); assert.strictEqual(T.q, "10:05am ET");
  const S = G.tile(row, { quotes: { ZCZ26: { px: 4.415, ts: "2026-11-06T14:15:00-05:00" } } }); assert.strictEqual(S.px, 4.415); assert.strictEqual(S.chg, "+1.50¢");
});
