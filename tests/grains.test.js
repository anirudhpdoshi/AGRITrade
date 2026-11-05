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
