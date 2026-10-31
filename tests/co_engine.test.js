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
    const inst = { eq: "StockholdersEquity", cash: "CashAndCashEquivalentsAtCarryingValue", ar: "AccountsReceivableNetCurrent", inv: "InventoryNet", ap: "AccountsPayableCurrent", ca: "AssetsCurrent", cl: "LiabilitiesCurrent", assets: "Assets", debt: "LongTermDebtNoncurrent", dcur: "LongTermDebtCurrent" };
    Object.keys(inst).forEach((k) => Q[k] != null && add(inst[k], { e: Q.e, v: Q[k], f: form, d: filed }));
  });
  return { ticker: opt.ticker || "TEST", name: "Test Co", fiscalYearEnd: opt.fye || "1231", sic: opt.sic || "2070", facts: F, filings: opt.filings || [] };
}
function cal(year, i) { const q = [["01-01", "03-31"], ["04-01", "06-30"], ["07-01", "09-30"], ["10-01", "12-31"]][i]; return { s: `${year}-${q[0]}`, e: `${year}-${q[1]}`, fy: year, q: i + 1 }; }
function strong(year0, nq) {
  const out = [];
  for (let k = 0; k < nq; k++) { const y = year0 + Math.floor(k / 4), i = k % 4, g = Math.pow(1.03, k);
    out.push(Object.assign(cal(y, i), { rev: 1000 * g, cogs: 600 * g, opinc: 200 * g * Math.pow(1.005, k), ni: 150 * g, cfo: 190 * g, capex: 40 * g, da: 30 * g, intexp: 8,
      eps: 1.5 * g, sh: 100 - k * 0.3, cash: 500 + 20 * k, eq: 2000 + 50 * k, ar: 300 * g, inv: 200 * g, ap: 180 * g, ca: 1100, cl: 600, assets: 4000 + 30 * k, debt: 600, dcur: 50 })); }
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

/* ---------- worker passes every us-gaap tag through (no whitelist to fall out of step) ---------- */
const W = fs.readFileSync(path.join(__dirname, "..", "worker", "agritrade-sec-worker.js"), "utf8");
ok(/for \(const tag of Object\.keys\(ug\)\)/.test(W) && !/const TAGS = \[/.test(W), "worker forwards all us-gaap tags");

/* ---------- working capital, debt cost, ratios ---------- */
{
  const L = M.quarters[M.quarters.length - 1], P = M.quarters[M.quarters.length - 2], x = strong(2024, 11), c = x[10], b = x[9];
  ok(near(L.m.dso.v, (c.ar + b.ar) / 2 / c.rev * 92, 1e-9), "DSO = average receivables ÷ quarterly revenue × days in quarter");
  ok(near(L.m.dio.v, (c.inv + b.inv) / 2 / c.cogs * 92, 1e-9) && L.m.dpo.approx, "DIO on cost of revenue; DPO flagged as a COGS proxy");
  ok(near(L.m.ccc.v, L.m.dso.v + L.m.dio.v - L.m.dpo.v), "CCC = DSO + DIO − DPO");
  ok(near(L.m.effcost.v, 8 * 365 / 92 / 650 * 100, 1e-9), "effective interest cost = annualised interest ÷ average gross debt");
  const eb = [7, 8, 9, 10].reduce((a, i) => a + x[i].opinc, 0), da = [7, 8, 9, 10].reduce((a, i) => a + x[i].da, 0);
  ok(near(L.m.nd_ebitda.v, L.m.ndebt.v / (eb + da)), "net debt ÷ TTM EBITDA");
  ok(near(L.m.int_cov.v, eb / 32), "interest cover = TTM EBIT ÷ TTM interest");
  ok(near(L.m.roe.v, [7, 8, 9, 10].reduce((a, i) => a + x[i].ni, 0) / ((c.eq + x[6].eq) / 2) * 100), "ROE = TTM net income ÷ average equity");
  ok(L.m.roic && L.m.roic.approx, "ROIC is flagged approximate (period-end capital)");
  ok(L.m.dso_yoy && L.m.ccc_qoq, "day-count metrics carry YoY and sequential changes");
}
{
  const co5 = filer({ quarters: strong(2024, 11) });
  const add = (tag, v) => (co5.facts[tag] = { USD: [{ e: "2025-12-31", v, f: "10-K", d: "2026-02-20" }] });
  add("LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", 50); add("LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", 100);
  add("LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive", 300);
  const mt = E.maturities(E.build(co5));
  ok(mt && mt.end === "2025-12-31" && mt.buckets[0].v === 50 && mt.buckets[5].v === 300 && !mt.buckets[2], "maturity ladder from the latest 10-K, missing buckets stay empty");
}
/* ---------- early-warning lifecycle ---------- */
{
  const Wk = E.warnings(E.build(filer({ quarters: weak })));
  const r = (id) => Wk.find((w) => w.id === id);
  ok(r(1).status === "ACTIVE" && r(1).persistence >= 3, "persistent revenue decline is ACTIVE with its persistence counted");
  ok(r(11).status === "ACTIVE" && r(11).severity !== "INFORMATIONAL", "dilution flagged");
  ok(r(6).status === "UNAVAILABLE" && r(10).status === "UNAVAILABLE", "guidance and concentration rules are honestly unavailable");
  ok(Wk.every((w) => w.status !== "ACTIVE" || w.first), "every active signal records when it was first observed");
  const Ws = E.warnings(M);
  ok(Ws.filter((w) => w.status === "ACTIVE").length === 0, "a steadily growing, cash-backed company triggers no signal");
  /* one bad quarter is never CONFIRMED */
  const blip = strong(2024, 11); blip[10] = Object.assign({}, blip[10], { rev: blip[10].rev * 0.7, cogs: blip[10].cogs * 0.7 });
  const Wb = E.warnings(E.build(filer({ quarters: blip }))).find((w) => w.id === 1);
  ok(Wb.status === "ACTIVE" && Wb.persistence === 1 && Wb.severity !== "CONFIRMED DETERIORATION", "a single −27% quarter is CRITICAL at most, never confirmed");
  /* recovery resolves */
  const rec = strong(2024, 11); rec[8] = Object.assign({}, rec[8], { rev: rec[8].rev * 0.8 });
  const Wr = E.warnings(E.build(filer({ quarters: rec }))).find((w) => w.id === 1);
  ok(Wr.status === "RESOLVED" && Wr.resolved_after, "a signal that clears is RESOLVED, with the quarter it last fired");
}

{
  const Wb = E.warnings(E.build(Object.assign(filer({ quarters: weak }), { sic: "6021" })));
  ok([2, 3, 4, 5, 8].every((id) => Wb.find((w) => w.id === id).status === "UNAVAILABLE"), "bank: cash, working-capital, margin and capex rules are not applied");
  const tiny = strong(2024, 11).map((x, k) => Object.assign({}, x, { inv: 0.1 * Math.pow(1.6, k) }));
  ok(E.warnings(E.build(filer({ quarters: tiny }))).find((w) => w.id === 4).status !== "ACTIVE", "immaterial inventory (< 2% of revenue) cannot trigger accumulation");
}
/* ---------- core EPS & valuation ---------- */
{
  const cg = filer({ quarters: strong(2024, 11) });
  cg.facts.EquitySecuritiesFvNiGainLoss = { USD: strong(2024, 11).filter((x) => x.q !== 4).map((x) => ({ s: x.s, e: x.e, v: 40, f: "10-Q", d: x.e.slice(0, 8) + "28" })) };
  cg.facts.IncomeTaxExpenseBenefit = { USD: strong(2024, 11).filter((x) => x.q !== 4).map((x) => ({ s: x.s, e: x.e, v: 30, f: "10-Q", d: x.e.slice(0, 8) + "28" })) };
  cg.facts.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest = { USD: strong(2024, 11).filter((x) => x.q !== 4).map((x) => ({ s: x.s, e: x.e, v: 150, f: "10-Q", d: x.e.slice(0, 8) + "28" })) };
  const Mg = E.build(cg), Lg = Mg.quarters[Mg.quarters.length - 1], c = strong(2024, 11)[10];
  ok(near(Lg.m.core_ni.v, c.ni - 40 * (1 - 0.2)), "core net income strips investment gains after tax (ETR 20%)");
  ok(near(Lg.m.core_eps.v, Lg.m.core_ni.v / c.sh) && Lg.m.core_eps.approx, "core EPS = core net income ÷ diluted shares, flagged approximate");
  const ts = []; for (let d = 0; d < 400; d++) { const dt = new Date(Date.UTC(2025, 9, 1) + d * 864e5); if ([0, 6].includes(dt.getUTCDay())) continue; ts.push([dt.toISOString().slice(0, 10), 100]); }
  ts[ts.length - 1][1] = 90;
  const P = { ticker: { ts }, spx: { ts: ts.map((x) => [x[0], 100]) } };
  cg.dei = { EntityCommonStockSharesOutstanding: [{ e: "2026-10-20", v: 100, d: "2026-10-28" }] };
  const V = E.valuation(E.build(cg), P);
  ok(V.price === 90 && V.mcap === 9000 && V.shares.st === "REPORTED", "price × cover-page shares = market cap");
  ok(near(V.pe, 90 / [7, 8, 9, 10].reduce((a, i) => a + Mg.quarters[Mg.quarters.length - 4 + (i - 7)].m.eps_d.v, 0)), "P/E on TTM diluted EPS");
  const S = E.scenarios(10, 100, [{ id: "bear", g: -10, pe: 15, p: 25 }, { id: "base", g: 10, pe: 20, p: 50 }, { id: "bull", g: 20, pe: 25, p: 25 }]);
  ok(near(S.cases[1].value, 220) && near(S.cases[1].upside, 120) && near(S.weighted.value, 0.25 * 135 + 0.5 * 220 + 0.25 * 300), "scenario value = EPS × (1+g) × P/E; probability-weighted");
  ok(near(E.scenarios(10, 100, [{ g: 0, pe: 10, p: 1 }, { g: 0, pe: 20, p: 3 }]).weighted.value, 175), "weights are normalised to their sum");
  const Sn = E.sensitivity(11, 20, 230);
  ok(Sn.rows.length === 9 && Sn.rows.find((r) => r.center).pe === 20 && near(Sn.perTurn, 11) && near(Sn.breakEvenPE, 230 / 11), "multiple sensitivity: each turn worth NTM EPS; break-even P/E");
  const bm = E.bigMoves(ts, 3); ok(near(bm.worst[0].pct, -10) && bm.worst[0].date === ts[ts.length - 1][0], "largest single-day drop found");
  const rx = E.reactions(P, [{ form: "8-K", items: "2.02", filed: ts[ts.length - 2][0] }]);
  ok(rx.length === 1 && near(rx[0].pct, -10) && near(rx[0].rel, -10), "earnings-day reaction measured against the S&P 500");
}

console.log(`co_engine: ${n} checks passed`);
