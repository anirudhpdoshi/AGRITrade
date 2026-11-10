// OI integrity (chunk 2): sanitizer re-derives totals, rejects bad rows, N/A ratio, drops a previous pull from another contract.
const assert = require("assert"); const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8");
const pick = (name) => { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); } } };
eval(pick("oiTradeDate") + pick("oiSanitize"));
global.DATA = { meta: { asof: { options: "2026-11-10T08:42:00-05:00" } } };
let n = 0, ok = 0; const t = (name, f) => { n++; try { f(); ok++; console.log("PASS " + name); } catch (e) { console.log("FAIL " + name + " — " + e.message); } };
const mk = (rows, extra) => ({ grains: { corn: { near: Object.assign({ rows, calls: 999, puts: 999, pcr: 9, contract: "ZCZ26", chain: "Dec-26" }, extra || {}) } } });
t("totals and P/C re-derived from strike rows", () => { const D = mk([[4.0, 10, 5], [4.1, 30, 15]]); oiSanitize(D); const x = D.grains.corn.near; assert.deepStrictEqual([x.calls, x.puts, x.pcr], [40, 20, 0.5]); assert(x._chk.mismatch); });
t("duplicate strike dropped, first kept", () => { const D = mk([[4.0, 10, 5], [4.0, 99, 99]]); oiSanitize(D); const x = D.grains.corn.near; assert.strictEqual(x.calls, 10); assert.strictEqual(x._chk.dup, 1); });
t("negative / non-numeric rows rejected", () => { const D = mk([[4.0, 10, 5], [4.1, -3, 2], [4.2, "x", 1], [NaN, 1, 1]]); oiSanitize(D); const x = D.grains.corn.near; assert.strictEqual(x._chk.bad, 3); assert.strictEqual(x.calls, 10); });
t("zero calls: P/C is N/A (null), never Infinity", () => { const D = mk([[4.0, 0, 5]]); oiSanitize(D); assert.strictEqual(D.grains.corn.near.pcr, null); });
t("previous pull from another contract is not used for change", () => { const D = mk([[4.0, 10, 5]], { rows_prev: { date: "2026-11-04", contract: "ZCH27", rows: [[4.0, 1, 1]] } }); oiSanitize(D); const x = D.grains.corn.near; assert(!x.rows_prev); assert(/different contract/.test(x._prev_bad)); });
t("previous pull sharing few strikes is not used", () => { const D = mk([[4.0, 1, 1], [4.1, 1, 1], [4.2, 1, 1], [4.3, 1, 1]], { rows_prev: { date: "2026-11-04", rows: [[9.0, 1, 1], [9.1, 1, 1], [9.2, 1, 1], [4.0, 1, 1]] } }); oiSanitize(D); assert(!D.grains.corn.near.rows_prev); });
t("gap counted in sessions (Nov 4 pull = Nov 3 close vs Nov 9 close = 4)", () => { const D = mk([[4.0, 1, 1]], { rows_prev: { date: "2026-11-04", rows: [[4.0, 1, 1]] } }); oiSanitize(D); assert.strictEqual(D.grains.corn.near._prev_sessions, 4); });
console.log(ok + "/" + n + " passed"); process.exit(ok === n ? 0 : 1);
