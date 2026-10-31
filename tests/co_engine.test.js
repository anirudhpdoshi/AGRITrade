/* co-engine.js checks on SEC-shaped fixtures (no network). Run: node tests/co_engine.test.js */
const fs = require("fs"), path = require("path");
const E = require("../co-engine.js");
let n = 0;
function ok(c, m) { if (!c) { console.error("FAIL: " + m); process.exit(1); } n++; }
const near = (a, b, t = 1e-6) => a != null && b != null && Math.abs(a - b) <= t * Math.max(1, Math.abs(b));

/* Build a worker-shaped facts object the way a real filer reports:
   10-Q: income statement 3-month AND year-to-date; cash flow year-to-date only; balances at period end.
   10-K: full-year income and cash flow; balances at year end. Q4 never appears on its own. */
function filer(opt) {
  const F = {}, add = (tag, row, unit = "USD") => (((F[tag] = F[tag] || {})[unit] = F[tag][unit] || []).push(row));
  const qs = opt.quarters;   // [{s, e, fy, q, rev, cogs, opinc, ni, cfo, capex, da, intexp, eps, sh, cash, ar, inv, ap, ca, cl, assets, debt}]
  qs.forEach((Q, i) => {
    const form = Q.q === 4 ? "10-K" : "10-Q", filed = Q.filed || Q.e.slice(0, 8) + "28";
    const yr = qs.filter((x) => x.fy === Q.fy && x.q <= Q.q), ys = yr[0].s;
    const sum = (k) => yr.reduce((a, x) => a + x[k], 0);
    const flow = ["rev", "cogs", "opinc", "ni", "da", "intexp"];
    const map = { rev: "RevenueFromContractWithCustomerExcludingAssessedTax", cogs: "CostOfGoodsAndServicesSold", opinc: "OperatingIncomeLoss", ni: "NetIncomeLoss", da: "DepreciationDepletionAndAmortization", intexp: "InterestExpense" };
    flow.forEach((k) => {
      if (Q.q !== 4) add(map[k], { s: Q.s, e: Q.e, v: Q[k], f: form, d: filed });            // 3-month
      if (Q.q > 1) add(map[k], { s: ys, e: Q.e, v: sum(k), f: form, d: filed });               // YTD / full year
    });
    if (Q.q !== 4) add("EarningsPerShareDiluted", { s: Q.s, e: Q.e, v: Q.eps, f: form, d: filed }, "USD/shares");
    if (Q.q === 4) add("EarningsPerShareDiluted", { s: ys, e: Q.e, v: yr.reduce((a, x) => a + x.eps, 0), f: form, d: filed }, "USD/shares");
    if (Q.q !== 4) add("WeightedAverageNumberOfDilutedSharesOutstanding", { s: Q.s, e: Q.e, v: Q.sh, f: form, d: filed }, "shares");
    else add("WeightedAverageNumberOfDilutedSharesOutstanding", { s: ys, e: Q.e, v: yr.reduce((a, x) => a + x.sh, 0) / yr.length, f: form, d: filed }, "shares");
    ["cfo", "capex"].forEach((k) => add(k === "cfo" ? "NetCashProvidedByUsedInOperatingActivities" : "PaymentsToAcquirePropertyPlantAndEquipment", { s: ys, e: Q.e, v: sum(k), f: form, d: filed }));
    const inst = { cash: "CashAndCashEquivalentsAtCarryingValue", ar: "AccountsReceivableNetCurrent", inv: "InventoryNet", ap: "AccountsPayableCurrent", ca: "AssetsCurrent", cl: "LiabilitiesCurrent", assets: "Assets", debt: "LongTermDebtNoncurrent", dcur: "LongTermDebtCurrent" };
    Object.keys(inst).forEach((k) => Q[k] != null && add(inst[k], { e: Q.e, v: Q[k], f: form, d: filed }));
  });
  return { ticker: opt.ticker || "TEST", name: "Test Co", fiscalYearEnd: opt.fye || "1231", sic: opt.sic || "2070", facts: F, filings: opt.filings || [] };
}
function cal(year, i) { const q = [["01-01", "03-31"], ["04-01", "06-30"], ["07-01", "09-30"], ["10-01", "12-31"]][i]; return { s: `${year}-${q[0]}`, e: `${year}-${q[1]}`, fy: year, q: i + 1 }; }
function strong(year0, nq) {
  const out = [];
  for (let k = 0; k < nq; k++) { const y = year0 + Math.floor(k / 4), i = k % 4, g = Math.pow(1.03, k);
    out.push(Object.assign(cal(y, i), { rev: 1000 * g, cogs: 600 * g, opinc: 200 * g * Math.pow(1.005, k), ni: 150 * g, cfo: 190 * g, capex: 40 * g, da: 30 * g, intexp: 8,
      eps: 1.5 * g, sh: 100 - k * 0.3, cash: 500 + 20 * k, ar: 300 * g, inv: 200 * g, ap: 180 * g, ca: 1100, cl: 600, assets: 4000 + 30 * k, debt: 600, dcur: 50 })); }
  return out;
}

/* ---------- quarter derivation ---------- */
const co = filer({ quarters: strong(2024, 11) });   // 2024 Q1 .. 2026 Q3
const M = E.build(co);
const Q = M.quarters, last = Q[Q.length - 1];
ok(last.end === "2026-09-30" && last.fl.label === "Q3 FY26", "latest quarter and fiscal label");
const q4 = Q.find((q) => q.end === "2025-12-31");
const exp4 = strong(2024, 11)[7];
ok(near(q4.m.rev.v, exp4.rev) && q4.m.rev.st === "CALCULATED", "Q4 revenue = full year − 9-month YTD, marked CALCULATED");
ok(/full year − 9-month/.test(q4.m.rev.how), "derivation is explained");
const q2 = Q.find((q) => q.end === "2026-06-30"), exp2 = strong(2024, 11)[9];
ok(near(q2.m.cfo.v, exp2.cfo) && q2.m.cfo.st === "CALCULATED", "Q2 operating cash flow = 6M − 3M YTD");
ok(near(q2.m.rev.v, exp2.rev) && q2.m.rev.st === "REPORTED", "a filed 3-month figure is REPORTED");
ok(near(last.m.fcf.v, strong(2024, 11)[10].cfo - strong(2024, 11)[10].capex), "FCF = CFO − capex for the derived quarter");
ok(q4.m.sh_d && q4.m.sh_d.approx && /full-year weighted average/.test(q4.m.sh_d.how), "Q4 share count uses the full-year average, flagged approximate");
ok(q4.m.eps_d && q4.m.eps_d.approx, "Q4 EPS by subtraction is flagged approximate");
ok(near(last.m.rev_yoy.v, (Math.pow(1.03, 4) - 1) * 100, 1e-4), "YoY growth vs the same quarter a year earlier");
ok(near(last.m.gm.v, 40) && last.m.gp.st === "CALCULATED", "gross profit derived from revenue − cost of revenue, margin 40%");
ok(near(last.m.gdebt.v, 650) && near(last.m.ndebt.v, 650 - (500 + 200)), "gross debt = current + non-current; net debt = gross − cash");
ok(M.quarters.every((q) => q.m.rev), "no gaps for a complete filer");

/* ---------- restatement ---------- */
const co2 = filer({ quarters: strong(2024, 11) });
co2.facts.NetIncomeLoss.USD.push({ s: "2026-07-01", e: "2026-09-30", v: 999, f: "10-Q/A", d: "2026-12-15" });
const L2 = E.build(co2).quarters.slice(-1)[0];
ok(L2.m.ni.v === 999 && L2.m.ni.src.restated, "latest filing wins and the value is flagged restated");

/* ---------- missing data is never invented ---------- */
const co3 = filer({ quarters: strong(2024, 11) });
delete co3.facts.PaymentsToAcquirePropertyPlantAndEquipment;
const L3 = E.build(co3).quarters.slice(-1)[0];
ok(!L3.m.capex && !L3.m.fcf, "no capex filed -> no FCF (UNAVAILABLE, not zero)");

/* ---------- fiscal labels ---------- */
ok(E.fiscalLabel("2026-09-27", "0927").label === "Q4 FY26", "Sep fiscal year-end: Sep quarter is Q4");
ok(E.fiscalLabel("2026-12-27", "0927").label === "Q1 FY27", "Sep FYE: Dec quarter is Q1 of the next fiscal year");
ok(E.fiscalLabel("2026-01-03", "1231").label === "Q4 FY25", "52/53-week year ending early January belongs to the prior fiscal year");
ok(E.fiscalLabel("2026-04-30", "0131").label === "Q1 FY27", "Jan FYE retailer: Apr quarter is Q1 FY27");

/* ---------- verdicts ---------- */
const V = E.verdicts(M, null).verdicts;
ok(V[0].verdict === "STRONG" || V[0].verdict === "SOLID", "growing, cash-backed company: earnings quality STRONG/SOLID (" + V[0].verdict + ")");
ok(V[0].pos.length && V[0].pos.every((e) => e.metric && e.period), "every observation names its metric and period");
ok(V[1].verdict === "UNAVAILABLE", "forward outlook is not guessed without guidance or consensus");
ok(V[3].verdict === "UNAVAILABLE", "market implication needs a release and prices");
const weak = strong(2024, 11).map((x, k) => Object.assign({}, x, { rev: 1000 * Math.pow(0.97, k), ni: 150 - 25 * k, opinc: 200 - 28 * k, cfo: 60 - 12 * k, capex: 90, sh: 100 + k * 2, debt: 600 + 120 * k, cash: 300 - 20 * k, intexp: 20 + 3 * k }));
const VW = E.verdicts(E.build(filer({ quarters: weak })), null).verdicts;
ok(["WEAK", "NEGATIVE"].includes(VW[0].verdict), "shrinking, cash-burning company: earnings quality WEAK/NEGATIVE (" + VW[0].verdict + ")");
ok(["WEAK", "NEGATIVE", "STRETCHED"].includes(VW[2].verdict), "rising debt, falling cover: resilience WEAK/STRETCHED (" + VW[2].verdict + ")");
const H = E.verdicts(E.build(filer({ quarters: weak })), null).history;
ok(H.length >= 5 && H.every((h) => h.label && h.eq), "eight-quarter verdict history computed from data available at each quarter");
const bank = E.build(Object.assign(filer({ quarters: strong(2024, 11) }), { sic: "6021" }));
ok(bank.model.kind === "financial" && /not meaningful/.test(bank.model.note), "banks are flagged — FCF/gross margin not forced onto them");

/* ---------- market reaction ---------- */
const ts = [["2026-10-27", 100], ["2026-10-28", 101], ["2026-10-29", 104], ["2026-10-30", 106]];
ok(near(E.reaction(ts, "2026-10-29"), 106 / 101 * 100 - 100), "two-day reaction: close before the release date to one session after");
const MV = E.verdicts(M, { ticker: { ts }, spx: { ts: ts.map((x) => [x[0], 100]) } });
ok(MV.verdicts[3].verdict === "UNAVAILABLE", "no 8-K 2.02 in filings -> no market verdict");
const coR = filer({ quarters: strong(2024, 11), filings: [{ form: "8-K", items: "2.02,9.01", filed: "2026-10-29" }] });
const MR = E.verdicts(E.build(coR), { ticker: { ts }, spx: { ts: ts.map((x) => [x[0], 100]) } }).verdicts[3];
ok(MR.verdict === "STRONG" && MR.confidence === "LOW", "relative +5% reaction -> STRONG, LOW confidence without consensus");

/* ---------- worker trims to every tag the engine reads ---------- */
const W = fs.readFileSync(path.join(__dirname, "..", "worker", "agritrade-sec-worker.js"), "utf8");
const missing = [].concat(...Object.values(E.DUR), ...Object.values(E.INST)).filter((t) => !W.includes('"' + t + '"'));
ok(missing.length === 0, "worker TAGS include every engine tag (missing: " + missing.join(",") + ")");

console.log(`co_engine: ${n} checks passed`);
