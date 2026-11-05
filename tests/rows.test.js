const assert = require("node:assert"), test = require("node:test"), R = require("../rows-ui.js");
const g = { near: { chain: "Dec-26", contract: "ZWZ26", calls: 184428, puts: 104382, pcr: 0.57, call_wall: [8, 12689], put_wall: [5.5, 6171] }, cftc: [{ date: "2026-10-20", net: -52005 }, { date: "2026-10-27", net: -74606 }], roll: [{ contract: "ZWZ26", settle: 5.985 }, { contract: "ZWH27", settle: 6.095 }] };
test("nine rows in BRD order", () => { assert.deepStrictEqual(R.ROWS.map(r => r[0]), ["cockpit", "pos", "cftc", "opt", "vol", "optflow", "flow", "carry", "oi"]); });
test("headlines state the side in words and sign the change", () => { const H = R.headlines(g, null, () => "Mon, Nov 30, 2026");
  assert.strictEqual(H.cftc, "Net short 74,606 · WoW −22,601 · report Tue, Oct 27"); assert.strictEqual(H.carry, "ZWZ26 to ZWH27 · spread −11.00¢ · FND Mon, Nov 30, 2026"); assert.strictEqual(H.vol, "UNAVAILABLE"); });
test("empty data is UNAVAILABLE, never zero", () => { const H = R.headlines({}, null, null); ["cockpit", "pos", "cftc", "opt", "vol", "flow", "carry", "oi"].forEach(k => assert.strictEqual(H[k], "UNAVAILABLE")); });
