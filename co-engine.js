/* Company intelligence engine — turns SEC XBRL facts (from the Worker's /company route) into eight clean quarters,
   annual history, metrics with provenance, the four verdicts and rule-based interpretation.
   Pure functions, no DOM, no network: runs in the browser (window.COENGINE) and in node (tests, real-data validation).

   Quarterly derivation (XBRL reports cash flows year-to-date and Q4 only inside the annual figure):
     REPORTED    a ~3-month fact ending on the quarter end
     CALCULATED  YTD fact − the YTD fact with the same start ending one quarter earlier (e.g. 9M − 6M, FY − 9M)
     UNAVAILABLE neither exists — never filled, never estimated
   Balance-sheet items are period-end (instant) values. When a figure was filed more than once (restated or amended),
   the latest filing wins and the value is flagged `restated`. */
(function (root) {
  "use strict";

  /* metric -> XBRL tags in priority order (first tag with a value for that period wins; the tag used is recorded) */
  var DUR = {
    rev: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    cogs: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfServices", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"],
    gp: ["GrossProfit"],
    opex: ["OperatingExpenses"], sga: ["SellingGeneralAndAdministrativeExpense"], rnd: ["ResearchAndDevelopmentExpense"],
    opinc: ["OperatingIncomeLoss"], restr: ["RestructuringCharges"],
    pretax: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
    tax: ["IncomeTaxExpenseBenefit"], ni: ["NetIncomeLoss", "ProfitLoss"],
    eps_d: ["EarningsPerShareDiluted"], eps_b: ["EarningsPerShareBasic"],
    sh_d: ["WeightedAverageNumberOfDilutedSharesOutstanding"], sh_b: ["WeightedAverageNumberOfSharesOutstandingBasic"],
    da: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"],
    sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    intexp: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"], intpaid: ["InterestPaidNet", "InterestPaid"],
    cfo: ["NetCashProvidedByUsedInOperatingActivities"], capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    div: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"], buyback: ["PaymentsForRepurchaseOfCommonStock"],
    dissue: ["ProceedsFromIssuanceOfLongTermDebt"], drepay: ["RepaymentsOfLongTermDebt"],
    d_ar: ["IncreaseDecreaseInAccountsReceivable"], d_inv: ["IncreaseDecreaseInInventories"], d_ap: ["IncreaseDecreaseInAccountsPayable"],
    acq: ["PaymentsToAcquireBusinessesNetOfCashAcquired"], invgain: ["EquitySecuritiesFvNiGainLoss", "EquitySecuritiesFvNiUnrealizedGainLoss"], eqiss: ["ProceedsFromIssuanceOfCommonStock"], invwd: ["InventoryWriteDown"],
  };
  var INST = {
    cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    sti: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
    ar: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], inv: ["InventoryNet"], ap: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"],
    ca: ["AssetsCurrent"], cl: ["LiabilitiesCurrent"], assets: ["Assets"], liab: ["Liabilities"],
    eq: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    stb: ["ShortTermBorrowings"], cp: ["CommercialPaper"], dcur: ["DebtCurrent", "LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
    ltd_nc: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"], ltd: ["LongTermDebt", "DebtLongtermAndShorttermCombinedAmount"], oplease: ["OperatingLeaseLiability"], finlease: ["FinanceLeaseLiability"],
    accr: ["AccruedLiabilitiesCurrent"], defrev: ["ContractWithCustomerLiabilityCurrent"], ctrasset: ["ContractWithCustomerAssetNetCurrent"],
    allow: ["AllowanceForDoubtfulAccountsReceivableCurrent"], inv_raw: ["InventoryRawMaterials"], inv_wip: ["InventoryWorkInProcess"], inv_fg: ["InventoryFinishedGoods"],
    rpo: ["RevenueRemainingPerformanceObligation"], revolver: ["LineOfCreditFacilityRemainingBorrowingCapacity"],
    mat1: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"], mat2: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
    mat3: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"], mat4: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
    mat5: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"], mat6: ["LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
  };
  var PER_SHARE = { eps_d: 1, eps_b: 1 }, SHARES = { sh_d: 1, sh_b: 1 };

  function days(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function unitRows(facts, tag) {
    var u = facts && facts[tag]; if (!u) return null;
    return u.USD || u["USD/shares"] || u.shares || u[Object.keys(u)[0]];
  }
  /* latest-filed value per (start,end); `restated` when an earlier filing carried a different value */
  function dedupe(rows) {
    var m = {};
    (rows || []).forEach(function (r) { var k = (r.s || "") + "|" + r.e, o = m[k];
      if (!o) { m[k] = { s: r.s, e: r.e, v: r.v, d: r.d, f: r.f, a: r.a, vals: [r.v] }; return; }
      o.vals.push(r.v);
      if (r.d > o.d) { o.v = r.v; o.d = r.d; o.f = r.f; o.a = r.a; } });
    return Object.keys(m).map(function (k) { var o = m[k]; o.restated = o.vals.some(function (x) { return Math.abs(x - o.v) > Math.abs(o.v) * 1e-6 + 1e-9; }); delete o.vals; return o; });
  }

  /* quarter ends: every end date of a ~3-month or ~12-month fact on the key income tags */
  function quarterEnds(facts) {
    var set = {};
    ["rev", "ni", "opinc", "cfo"].forEach(function (k) { DUR[k].forEach(function (tag) {
      (unitRows(facts, tag) || []).forEach(function (r) { if (!r.s) return; var d = days(r.s, r.e);
        if ((d >= 80 && d <= 100) || (d >= 350 && d <= 380)) set[r.e] = 1; }); }); });
    var ends = Object.keys(set).sort();
    /* collapse ends within 10 days of each other (52/53-week calendars) to the later one */
    var out = [];
    ends.forEach(function (e) { if (out.length && days(out[out.length - 1], e) < 10) out[out.length - 1] = e; else out.push(e); });
    return out;
  }

  /* value of a duration metric for the quarter ending `e` (previous quarter end `pe`) from one tag's rows */
  function quarterFromTag(rows, e, pe, perShare) {
    var D = dedupe(rows), atE = D.filter(function (r) { return r.s && Math.abs(days(r.e, e)) <= 6; });
    var q = atE.filter(function (r) { var d = days(r.s, r.e); return d >= 80 && d <= 100; })[0];
    if (q) return { v: q.v, st: "REPORTED", src: q, how: "3-month figure as filed" };
    if (!pe) return null;
    if (perShare === "shares") {   /* weighted share counts are averages, not sums: never subtract; Q4 uses the full-year average */
      var fy = atE.filter(function (r) { var d = days(r.s, r.e); return d >= 350 && d <= 380; })[0];
      return fy ? { v: fy.v, st: "CALCULATED", src: fy, approx: true, how: "full-year weighted average used for Q4 (approximate)" } : null;
    }
    var ytd = atE.filter(function (r) { return days(r.s, r.e) > 100; }).sort(function (a, b) { return days(a.s, a.e) - days(b.s, b.e); });
    for (var i = 0; i < ytd.length; i++) {
      var Y = ytd[i], prev = D.filter(function (r) { return r.s === Y.s && Math.abs(days(r.e, pe)) <= 6; })[0];
      if (prev) return { v: Y.v - prev.v, st: "CALCULATED", src: Y, src2: prev, approx: !!perShare,
        how: (days(Y.s, Y.e) > 300 ? "full year" : Math.round(days(Y.s, Y.e) / 30.4) + "-month YTD") + " − " + Math.round(days(prev.s, prev.e) / 30.4) + "-month YTD" + (perShare ? " (per-share figures do not subtract exactly — approximate)" : "") };
      if (Y.s && days(Y.s, pe) >= 80 && days(Y.s, pe) <= 100) {
        var q1 = D.filter(function (r) { return r.s === Y.s && Math.abs(days(r.e, pe)) <= 6 && days(r.s, r.e) <= 100; })[0];
        if (q1) return { v: Y.v - q1.v, st: "CALCULATED", src: Y, src2: q1, how: "6-month YTD − Q1" };
      }
    }
    /* fallback: YTD − the filed 3-month quarters inside it (when no matching YTD comparative was filed) */
    for (var k = ytd.length - 1; k >= 0; k--) {
      var Z = ytd[k], parts = D.filter(function (r) { var d = days(r.s, r.e); return r.s >= Z.s && r.e <= pe && d >= 80 && d <= 100; });
      var span = parts.reduce(function (a, r) { return a + days(r.s, r.e); }, 0);
      if (parts.length && Math.abs(span - days(Z.s, pe)) <= 6 + parts.length * 2)
        return { v: Z.v - parts.reduce(function (a, r) { return a + r.v; }, 0), st: "CALCULATED", src: Z, approx: !!perShare,
          how: (days(Z.s, Z.e) > 300 ? "full year" : "YTD") + " − sum of " + parts.length + " filed quarter" + (parts.length > 1 ? "s" : "") + (perShare ? " (per-share — approximate)" : "") };
    }
    return null;
  }
  function instantAt(rows, e) {
    var D = dedupe(rows).filter(function (r) { return !r.s && Math.abs(days(r.e, e)) <= 6; }).sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    return D[0] ? { v: D[0].v, st: "REPORTED", src: D[0], how: "period-end balance as filed" } : null;
  }
  function pick(facts, tags, fn) {
    for (var i = 0; i < tags.length; i++) { var rows = unitRows(facts, tags[i]); if (!rows) continue; var r = fn(rows); if (r) { r.tag = tags[i]; return r; } }
    return null;
  }
  function annualFromTag(rows) {
    return dedupe(rows).filter(function (r) { return r.s && days(r.s, r.e) >= 350 && days(r.s, r.e) <= 380; });
  }

  function fiscalLabel(e, fye) {   /* fye "MMDD" from SEC submissions */
    var d = new Date(e + "T12:00:00Z"), fm = fye ? +fye.slice(0, 2) : 12;
    var m = d.getUTCMonth() + 1 + (d.getUTCDate() <= 7 ? -1 : 0); if (m < 1) m += 12;   /* 52/53-week ends a few days into a month */
    var y = d.getUTCFullYear() + (d.getUTCMonth() === 0 && d.getUTCDate() <= 7 ? -1 : 0);
    var ahead = (fm - m + 12) % 12, qn = 4 - Math.floor(ahead / 3), fy = y + (m > fm ? 1 : 0);
    return { q: qn, fy: fy, label: "Q" + qn + " FY" + String(fy).slice(2) };
  }

  /* ---------------------------------------------------------------- build */
  function build(co, opts) {
    opts = opts || {};
    var F = co.facts || {}, ends = quarterEnds(F), N = opts.quarters || 12;
    ends = ends.slice(-N);
    var Q = ends.map(function (e, i) {
      var pe = i > 0 ? ends[i - 1] : null, row = { end: e, fl: fiscalLabel(e, co.fiscalYearEnd), m: {} };
      Object.keys(DUR).forEach(function (k) { var r = pick(F, DUR[k], function (rows) { return quarterFromTag(rows, e, pe, SHARES[k] ? "shares" : PER_SHARE[k]); }); if (r) row.m[k] = r; });
      Object.keys(INST).forEach(function (k) { var r = pick(F, INST[k], function (rows) { return instantAt(rows, e); }); if (r) row.m[k] = r; });
      return row;
    });
    /* the earliest quarter can only be derived from the one before it — drop leading quarters with no revenue/NI */
    while (Q.length && !Q[0].m.ni && !Q[0].m.rev) Q.shift();
    Q.forEach(function (q, i) { derive(q, Q[i - 1], yoyOf(Q, i)); });
    Q.forEach(function (q, i) { deep(Q, i); });
    ["dso", "dio", "dpo", "ccc", "roe", "roic", "nd_ebitda", "int_cov", "effcost", "cashcost", "capexda", "cr", "qr"].forEach(function (k) { Q.forEach(function (q, i) { var y = yoyOf(Q, i), p = Q[i - 1];
      if (val(q, k) != null && val(y, k) != null) q.m[k + "_yoy"] = { v: val(q, k) - val(y, k), st: "CALCULATED", how: "change vs " + y.fl.label, unit: "abs" };
      if (val(q, k) != null && val(p, k) != null) q.m[k + "_qoq"] = { v: val(q, k) - val(p, k), st: "CALCULATED", how: "change vs " + p.fl.label, unit: "abs" }; }); });
    var A = annual(F, co.fiscalYearEnd);
    var mod = model(co);
    if (Q.length && Q.length < 4 && mod.kind === "operating") mod = { kind: "operating", note: "Only " + Q.length + " quarter" + (Q.length > 1 ? "s" : "") + " filed under this registrant (CIK " + co.cik + ") — often a new holding company or a recent listing. A predecessor’s filings are not merged in." };
    return { co: co, quarters: Q, annual: A, model: mod, sector: sectorOf(co.sic) };
  }
  function yoyOf(Q, i) { for (var j = i - 1; j >= 0; j--) { var d = days(Q[j].end, Q[i].end); if (d >= 350 && d <= 380) return Q[j]; if (d > 380) break; } return null; }
  function val(q, k) { return q && q.m[k] ? q.m[k].v : null; }
  function setC(q, k, v, how, inputs) { if (v == null || !isFinite(v)) return; q.m[k] = { v: v, st: "CALCULATED", how: how, inputs: inputs }; }
  function derive(q, p, y) {
    var rev = val(q, "rev");
    if (val(q, "gp") == null && rev != null && val(q, "cogs") != null) setC(q, "gp", rev - val(q, "cogs"), "revenue − cost of revenue", ["rev", "cogs"]);
    if (rev) {
      [["gm", "gp"], ["opm", "opinc"], ["nm", "ni"]].forEach(function (x) { if (val(q, x[1]) != null) setC(q, x[0], val(q, x[1]) / rev * 100, x[1] + " ÷ revenue", [x[1], "rev"]); });
    }
    if (val(q, "opinc") != null) q.m.ebit = { v: val(q, "opinc"), st: q.m.opinc.st, how: "operating income", inputs: ["opinc"] };
    else if (val(q, "pretax") != null && val(q, "intexp") != null) setC(q, "ebit", val(q, "pretax") + val(q, "intexp"), "EBIT proxy: pretax income + interest expense (operating income is not tagged by this filer)", ["pretax", "intexp"]);
    if (rev && q.m.ebit && val(q, "opinc") == null) setC(q, "ebitm", q.m.ebit.v / rev * 100, "EBIT proxy ÷ revenue", ["ebit", "rev"]);
    if (val(q, "opinc") == null && q.m.ebit && val(q, "da") != null) { setC(q, "ebitda", q.m.ebit.v + val(q, "da"), "EBIT proxy + D&A", ["ebit", "da"]); if (rev) setC(q, "ebitdam", q.m.ebitda.v / rev * 100, "EBITDA ÷ revenue", ["ebitda", "rev"]); }
    if (val(q, "opinc") != null && val(q, "da") != null) { setC(q, "ebitda", val(q, "opinc") + val(q, "da"), "operating income + D&A", ["opinc", "da"]); if (rev) setC(q, "ebitdam", q.m.ebitda.v / rev * 100, "EBITDA ÷ revenue", ["ebitda", "rev"]); }
    if (val(q, "pretax") && val(q, "tax") != null) setC(q, "etr", val(q, "tax") / val(q, "pretax") * 100, "tax ÷ pretax income", ["tax", "pretax"]);
    if (val(q, "invgain") != null && val(q, "ni") != null) {
      var tr = val(q, "etr") != null ? Math.min(Math.max(val(q, "etr"), 0), 35) / 100 : 0.21;
      setC(q, "core_ni", val(q, "ni") - val(q, "invgain") * (1 - tr), "net income − equity-investment gains/losses × (1 − tax rate " + (tr * 100).toFixed(0) + "%)", ["ni", "invgain", "etr"]);
      if (val(q, "sh_d")) { setC(q, "core_eps", q.m.core_ni.v / val(q, "sh_d"), "core net income ÷ diluted shares", ["core_ni", "sh_d"]); q.m.core_eps.approx = true; }
    }
    if (val(q, "cfo") != null && val(q, "capex") != null) { setC(q, "fcf", val(q, "cfo") - val(q, "capex"), "operating cash flow − capital expenditure", ["cfo", "capex"]);
      if (rev) setC(q, "fcfm", q.m.fcf.v / rev * 100, "FCF ÷ revenue", ["fcf", "rev"]); }
    var ni = val(q, "ni");
    if (q.m.fcf && ni != null) { if (ni > 0) setC(q, "fcfconv", q.m.fcf.v / ni * 100, "FCF ÷ net income", ["fcf", "ni"]); else q.m.fcfconv = { v: null, st: "NOT APPLICABLE", how: "N/M — net income is zero or negative" }; }
    if (val(q, "cfo") != null && ni != null) { if (ni > 0) setC(q, "cfoni", val(q, "cfo") / ni, "CFO ÷ net income", ["cfo", "ni"]); }
    if (rev && val(q, "capex") != null) setC(q, "capexint", val(q, "capex") / rev * 100, "capex ÷ revenue", ["capex", "rev"]);
    if (rev && val(q, "sbc") != null) setC(q, "sbcr", val(q, "sbc") / rev * 100, "SBC ÷ revenue", ["sbc", "rev"]);
    /* debt: current portion + short-term borrowings + commercial paper + long-term (non-current, else total long-term) */
    var parts = [], g = 0, any = false;
    [["dcur", "current debt"], ["stb", "short-term borrowings"], ["cp", "commercial paper"]].forEach(function (x) { if (val(q, x[0]) != null) { g += val(q, x[0]); any = true; parts.push(x[1]); } });
    if (val(q, "ltd_nc") != null) { g += val(q, "ltd_nc"); any = true; parts.push("long-term debt (non-current)"); }
    else if (val(q, "ltd") != null) { g += val(q, "ltd") - (val(q, "dcur") && q.m.dcur.tag === "LongTermDebtCurrent" ? val(q, "dcur") : 0); any = true; parts.push("long-term debt"); }
    if (any) setC(q, "gdebt", g, "sum of " + parts.join(" + ") + " (leases excluded)", ["dcur", "stb", "cp", "ltd_nc", "ltd"]);
    if (q.m.gdebt && val(q, "cash") != null) setC(q, "ndebt", q.m.gdebt.v - val(q, "cash") - (val(q, "sti") || 0), "gross debt − cash − short-term investments", ["gdebt", "cash", "sti"]);
    if (val(q, "ca") != null && val(q, "cl")) setC(q, "cr", val(q, "ca") / val(q, "cl"), "current assets ÷ current liabilities", ["ca", "cl"]);
    /* growth */
    ["rev", "gp", "opinc", "ni", "eps_d", "cfo", "fcf", "capex", "sh_d", "ar", "inv", "gdebt", "cogs", "sga", "rnd", "ap", "rpo", "div", "buyback", "da"].forEach(function (k) {
      var c = val(q, k), a = val(y, k), b = val(p, k);
      if (c != null && a != null && a !== 0) q.m[k + "_yoy"] = { v: (c / a - 1) * 100 * (a < 0 ? -1 : 1), st: "CALCULATED", how: "vs " + y.fl.label, inputs: [k] };
      if (c != null && b != null && b !== 0 && !SHARES[k]) q.m[k + "_qoq"] = { v: (c / b - 1) * 100 * (b < 0 ? -1 : 1), st: "CALCULATED", how: "vs " + p.fl.label, inputs: [k] };
    });
    ["gm", "opm", "nm", "ebitdam", "fcfm"].forEach(function (k) { if (val(q, k) != null && val(y, k) != null) q.m[k + "_yoy"] = { v: val(q, k) - val(y, k), st: "CALCULATED", how: "percentage-point change vs " + y.fl.label, unit: "pp" }; });
  }
  function annual(F, fye) {
    var out = {};
    ["rev", "gp", "opinc", "ni", "cfo", "capex", "eps_d"].forEach(function (k) {
      DUR[k].some(function (tag) { var rows = unitRows(F, tag); if (!rows) return false; var A = annualFromTag(rows); if (!A.length) return false;
        A.forEach(function (r) { var y = fiscalLabel(r.e, fye).fy; (out[y] = out[y] || { fy: y, end: r.e, m: {} }).m[k] = { v: r.v, st: "REPORTED", tag: tag, src: r }; }); return true; });
    });
    var L = Object.keys(out).sort().map(function (y) { return out[y]; });
    L.forEach(function (a) { if (a.m.cfo && a.m.capex) a.m.fcf = { v: a.m.cfo.v - a.m.capex.v, st: "CALCULATED", how: "CFO − capex" }; });
    return L.slice(-5);
  }

  /* ---------------------------------------------------------------- business model & sector */
  function model(co) {
    var s = +co.sic || 0;
    if (s >= 6000 && s <= 6299) return { kind: "financial", note: "Bank / broker model: gross margin, FCF and EBITDA-based leverage are not meaningful — the bank template (NII, NIM, CET1, charge-offs) is not built yet." };
    if (s >= 6300 && s <= 6411) return { kind: "insurer", note: "Insurance model: underwriting metrics (combined ratio, loss ratio) are not built yet; FCF and gross margin are not meaningful." };
    if (s >= 4900 && s <= 4991) return { kind: "utility", note: "Regulated utility: rate base, allowed ROE and regulatory recovery are the right lens and are not built yet; heavy capex usually makes FCF negative by design." };
    if (s === 6798) return { kind: "reit", note: "REIT: FFO / AFFO, occupancy and same-property NOI are the right lens and are not built yet; FCF is shown with that caveat." };
    if (co.ifrs) return { kind: "ifrs", note: "Files under IFRS (foreign private issuer) — US-GAAP tags are not available, so most cards will be empty." };
    return { kind: "operating", note: "" };
  }
  function sectorOf(sic) {
    var s = +sic || 0;
    if (s >= 100 && s <= 999) return "Agriculture";
    if (s >= 1000 && s <= 1499) return "Mining & Energy"; if (s >= 2911 && s <= 2999) return "Energy";
    if ((s >= 2000 && s <= 2199)) return "Consumer Staples (food & beverage)";
    if (s >= 2800 && s <= 2899) return s === 2834 || s === 2836 ? "Healthcare (pharma)" : "Materials (chemicals)";
    if (s >= 3500 && s <= 3599) return s >= 3570 && s <= 3579 ? "Information Technology" : "Industrials (machinery)";
    if (s >= 3600 && s <= 3699) return "Information Technology (electronics)";
    if (s >= 7370 && s <= 7379) return "Information Technology (software & services)";
    if (s >= 4900 && s <= 4999) return "Utilities";
    if (s >= 6000 && s <= 6411) return "Financials"; if (s === 6798) return "Real Estate (REIT)";
    if (s >= 5200 && s <= 5999) return "Consumer Discretionary (retail)"; if (s >= 5000 && s <= 5199) return "Wholesale / distribution";
    if (s >= 4800 && s <= 4899) return "Communication Services";
    if (s >= 8000 && s <= 8099) return "Healthcare (services)";
    return "SIC " + (sic || "—");
  }

  /* ---------------------------------------------------------------- TTM helpers */
  function ttm(Q, i, k) {
    if (i < 3) return null; var s = 0;
    for (var j = i - 3; j <= i; j++) { var v = val(Q[j], k); if (v == null) return null; s += v; }
    if (days(Q[i - 3].end, Q[i].end) > 300) return null;   /* gap in the quarter list */
    return s;
  }
  /* metrics that need the previous quarter's balance or trailing-twelve-month flows */
  function deep(Q, i) {
    var q = Q[i], p = Q[i - 1], dq = p ? days(p.end, q.end) : 91, rev = val(q, "rev"), cogs = val(q, "cogs");
    if (!(dq >= 80 && dq <= 100)) dq = 91;
    function av(k) { var a = val(q, k), b = val(p, k); return a == null ? null : b == null ? null : (a + b) / 2; }
    function avNote(k) { return val(p, k) == null ? "" : " (average of opening and closing balance)"; }
    var ar = av("ar"), inv = av("inv"), ap = av("ap");
    if (ar != null && rev) setC(q, "dso", ar / rev * dq, "average receivables ÷ quarterly revenue × " + dq + " days", ["ar", "rev"]);
    if (inv != null && cogs) setC(q, "dio", inv / cogs * dq, "average inventory ÷ quarterly cost of revenue × " + dq + " days", ["inv", "cogs"]);
    if (ap != null && cogs) { setC(q, "dpo", ap / cogs * dq, "average payables ÷ quarterly cost of revenue × " + dq + " days (cost of revenue is a proxy for supplier purchases)", ["ap", "cogs"]); q.m.dpo.approx = true; }
    if (q.m.dso && q.m.dio && q.m.dpo) setC(q, "ccc", q.m.dso.v + q.m.dio.v - q.m.dpo.v, "DSO + DIO − DPO", ["dso", "dio", "dpo"]);
    var wc = (val(q, "d_ar") != null || val(q, "d_inv") != null || val(q, "d_ap") != null) ? -(val(q, "d_ar") || 0) - (val(q, "d_inv") || 0) + (val(q, "d_ap") || 0) : null;
    if (wc != null) setC(q, "wc_cf", wc, "−Δreceivables − Δinventory + Δpayables, from the cash-flow statement", ["d_ar", "d_inv", "d_ap"]);
    if (val(q, "capex") != null && val(q, "da")) setC(q, "capexda", val(q, "capex") / val(q, "da"), "capex ÷ D&A", ["capex", "da"]);
    if (val(q, "fcf") != null && (val(q, "div") != null || val(q, "buyback") != null)) { var ret = (val(q, "div") || 0) + (val(q, "buyback") || 0); setC(q, "shret", ret, "dividends + buybacks", ["div", "buyback"]); setC(q, "retained", val(q, "fcf") - ret, "FCF − dividends − buybacks", ["fcf", "div", "buyback"]); }
    var gd = av("gdebt");
    if (gd && val(q, "intexp") != null) setC(q, "effcost", val(q, "intexp") * 365 / dq / gd * 100, "annualised interest expense ÷ average gross debt (opening/closing average — an approximation; leases excluded)", ["intexp", "gdebt"]);
    if (gd && val(q, "intpaid") != null) setC(q, "cashcost", val(q, "intpaid") * 365 / dq / gd * 100, "annualised cash interest paid ÷ average gross debt (approximation)", ["intpaid", "gdebt"]);
    var cl = val(q, "cl");
    if (cl) { if (val(q, "cash") != null) setC(q, "cashr", (val(q, "cash") + (val(q, "sti") || 0)) / cl, "(cash + short-term investments) ÷ current liabilities", ["cash", "sti", "cl"]);
      if (val(q, "cash") != null && val(q, "ar") != null) setC(q, "qr", (val(q, "cash") + (val(q, "sti") || 0) + val(q, "ar")) / cl, "(cash + short-term investments + receivables) ÷ current liabilities", ["cash", "sti", "ar", "cl"]); }
    if (val(q, "ca") != null && cl != null) setC(q, "wcap", val(q, "ca") - cl, "current assets − current liabilities", ["ca", "cl"]);
    if (val(q, "gdebt") != null && val(q, "eq")) setC(q, "de", val(q, "gdebt") / val(q, "eq"), "gross debt ÷ shareholders’ equity", ["gdebt", "eq"]);
    if (val(q, "gdebt") != null && val(q, "assets")) setC(q, "da_r", val(q, "gdebt") / val(q, "assets") * 100, "gross debt ÷ total assets", ["gdebt", "assets"]);
    /* trailing twelve months */
    if (i < 3 || days(Q[i - 3].end, q.end) > 300) return;
    function t(k) { return ttm(Q, i, k); }
    function a4(k) { var a = val(q, k), b = i >= 4 ? val(Q[i - 4], k) : null; return a == null ? null : b == null ? a : (a + b) / 2; }
    var ni4 = t("ni"), eb4 = t("ebit"), da4 = t("da"), int4 = t("intexp"), cfo4 = t("cfo"), fcf4 = t("fcf"), rev4 = t("rev"), cogs4 = t("cogs"), ip4 = t("intpaid");
    if (eb4 != null && da4 != null) setC(q, "ebitda_ttm", eb4 + da4, "TTM EBIT + TTM D&A", ["ebit", "da"]);
    if (q.m.ebitda_ttm && val(q, "ndebt") != null && q.m.ebitda_ttm.v > 0) setC(q, "nd_ebitda", val(q, "ndebt") / q.m.ebitda_ttm.v, "net debt ÷ TTM EBITDA", ["ndebt", "ebitda_ttm"]);
    if (eb4 != null && int4) setC(q, "int_cov", eb4 / int4, "TTM EBIT ÷ TTM interest expense", ["ebit", "intexp"]);
    if (ip4 != null && cfo4 > 0) setC(q, "intburden", ip4 / cfo4 * 100, "TTM cash interest paid ÷ TTM operating cash flow", ["intpaid", "cfo"]);
    if (fcf4 != null && val(q, "gdebt")) setC(q, "fcf_debt", fcf4 / val(q, "gdebt") * 100, "TTM FCF ÷ gross debt", ["fcf", "gdebt"]);
    if (fcf4 != null) setC(q, "fcf_ttm", fcf4, "sum of the last four quarters", ["fcf"]);
    var eqA = a4("eq"), asA = a4("assets");
    if (ni4 != null && eqA > 0) setC(q, "roe", ni4 / eqA * 100, "TTM net income ÷ average equity (now and a year ago)", ["ni", "eq"]);
    if (ni4 != null && asA) setC(q, "roa", ni4 / asA * 100, "TTM net income ÷ average total assets", ["ni", "assets"]);
    var tax4 = t("tax"), pre4 = t("pretax"), tr = pre4 > 0 && tax4 != null ? Math.min(Math.max(tax4 / pre4, 0), 0.5) : 0.21;
    var ic = val(q, "gdebt") != null && val(q, "eq") != null ? val(q, "gdebt") + val(q, "eq") - (val(q, "cash") || 0) : null;
    if (eb4 != null && ic > 0) { setC(q, "roic", eb4 * (1 - tr) / ic * 100, "TTM EBIT × (1 − effective tax rate " + (tr * 100).toFixed(0) + "%) ÷ (gross debt + equity − cash), period-end capital", ["ebit", "tax", "gdebt", "eq", "cash"]); q.m.roic.approx = true; }
    if (rev4 && asA) setC(q, "at", rev4 / asA, "TTM revenue ÷ average total assets", ["rev", "assets"]);
    if (cogs4 && a4("inv")) setC(q, "invturn", cogs4 / a4("inv"), "TTM cost of revenue ÷ average inventory", ["cogs", "inv"]);
    if (rev4 && a4("ar")) setC(q, "arturn", rev4 / a4("ar"), "TTM revenue ÷ average receivables", ["rev", "ar"]);
    if (cogs4 && a4("ap")) setC(q, "apturn", cogs4 / a4("ap"), "TTM cost of revenue ÷ average payables", ["cogs", "ap"]);
    if (cfo4 != null && ni4 > 0) setC(q, "cfoni_ttm", cfo4 / ni4, "TTM CFO ÷ TTM net income", ["cfo", "ni"]);
  }
  /* ---------------------------------------------------------------- early-warning engine (12 rules) */
  var SEV = ["INFORMATIONAL", "WATCH", "CRITICAL", "CONFIRMED DETERIORATION"];
  function v_(q, k) { return q && q.m[k] && q.m[k].v != null ? q.m[k].v : null; }
  /* each rule: test(q, M) -> null (cannot evaluate) | {hit, level 1 watch / 2 critical, value, comp, thr, text} */
  var RULES = [
    { id: 1, title: "Revenue quality deterioration", metric: "rev_yoy", alt: "A divestiture, a strong prior-year comparison, currency or a deliberate exit from low-margin business can all depress reported growth.",
      test: function (q) { var g = v_(q, "rev_yoy"); if (g == null) return null; return { hit: g < -3, level: g < -10 ? 2 : 1, value: g, comp: "same quarter last year", thr: "YoY < −3% (critical < −10%)", text: "Revenue " + g.toFixed(1) + "% YoY" }; } },
    { id: 2, title: "Cash flow versus earnings divergence", metric: "cfoni_ttm", alt: "Working-capital build ahead of growth, tax timing or a large non-cash gain can open the gap temporarily.",
      test: function (q) { var c = v_(q, "cfoni_ttm"); if (c == null) return null; return { hit: c < 0.8, level: c < 0.5 ? 2 : 1, value: c, comp: "TTM net income", thr: "TTM CFO < 0.8× net income (critical < 0.5×)", text: "TTM operating cash flow " + c.toFixed(2) + "× net income" }; } },
    { id: 3, title: "Receivables growth exceeding revenue", metric: "ar_yoy", alt: "Acquisitions, longer contractual terms, a quarter-end sales spike or customer mix can lift receivables without collection problems.",
      test: function (q, M) { var a = v_(q, "ar_yoy"), r = v_(q, "rev_yoy"); if (a == null || r == null) return null; var d = a - r; return { hit: d > 10 && material(q, "ar", M), level: d > 25 ? 2 : 1, value: d, comp: "revenue growth " + r.toFixed(1) + "%", thr: "receivables growth − revenue growth > 10 pp (critical > 25 pp), receivables ≥ 2% of TTM revenue", text: "Receivables " + a.toFixed(1) + "% YoY vs revenue " + r.toFixed(1) + "%" }; } },
    { id: 4, title: "Inventory accumulation", metric: "inv_yoy", alt: "A planned seasonal build, a product launch, supply-chain buffering or commodity-price inflation in inventory value.",
      test: function (q, M) { var a = v_(q, "inv_yoy"), r = v_(q, "rev_yoy"); if (a == null || r == null) return null; var d = a - r; return { hit: d > 10 && material(q, "inv", M), level: d > 25 ? 2 : 1, value: d, comp: "revenue growth " + r.toFixed(1) + "%", thr: "inventory growth − revenue growth > 10 pp (critical > 25 pp), inventory ≥ 2% of TTM revenue", text: "Inventory " + a.toFixed(1) + "% YoY vs revenue " + r.toFixed(1) + "%" }; } },
    { id: 5, title: "Margin compression", metric: "opm_yoy", alt: "Mix shift, one-off charges, deliberate investment spending or input-cost spikes that pricing has not yet caught up with.",
      test: function (q) { var d = v_(q, "opm_yoy"), k = "operating"; if (d == null) { d = v_(q, "gm_yoy"); k = "gross"; } if (d == null) return null; return { hit: d < -2, level: d < -5 ? 2 : 1, value: d, comp: "same quarter last year", thr: k + " margin down > 2 pp YoY (critical > 5 pp)", text: k[0].toUpperCase() + k.slice(1) + " margin " + d.toFixed(1) + " pp YoY" }; } },
    { id: 6, title: "Guidance deterioration", metric: "guidance", unavailable: "Needs management guidance history — no free structured source; the earnings-release parser is a later phase." },
    { id: 7, title: "Debt and refinancing stress", metric: "nd_ebitda", alt: "Debt-funded acquisitions with earnings not yet in the trailing window, seasonal borrowing, or a captive finance arm that carries customer loans.",
      test: function (q, M) { var cap = M.model.kind === "utility" || M.model.kind === "reit", L = v_(q, "nd_ebitda"), c = v_(q, "int_cov"), hi = cap ? [6.5, 8] : [4, 5.5];
        if (L == null && c == null) return null; var lvl = 0, t = [];
        if (L != null && L > hi[0]) { lvl = Math.max(lvl, L > hi[1] ? 2 : 1); t.push("net debt / EBITDA " + L.toFixed(1) + "×"); }
        if (c != null && c < 3) { lvl = Math.max(lvl, c < 1.5 ? 2 : 1); t.push("interest cover " + c.toFixed(1) + "×"); }
        var m1 = v_(q, "mat1"), liq = (v_(q, "cash") || 0) + (v_(q, "sti") || 0) + (v_(q, "revolver") || 0);
        if (m1 != null && m1 > liq && liq > 0) { lvl = 2; t.push("debt due in 12 months exceeds cash + undrawn facilities"); }
        return { hit: lvl > 0, level: lvl || 1, value: L != null ? L : c, comp: cap ? "capital-intensive thresholds" : "generic thresholds", thr: "net debt/EBITDA > " + hi[0] + "× (critical > " + hi[1] + "×), interest cover < 3× (critical < 1.5×), or near-term maturities above liquidity", text: t.join("; ") || "within thresholds" }; } },
    { id: 8, title: "CapEx without demonstrated returns", metric: "capex_yoy", alt: "Investment cycles take years to earn back; a new plant or data centre depresses returns before it produces revenue.",
      test: function (q) { var cy = v_(q, "capex_yoy"), cd = v_(q, "capexda"), r = v_(q, "rev_yoy"), m = v_(q, "opm_yoy"); if (cy == null || r == null) return null;
        var hit = cy > 30 && (cd == null || cd > 1.5) && r < 3 && (m == null || m <= 0); return { hit: hit, level: hit && cy > 60 ? 2 : 1, value: cy, comp: "revenue " + r.toFixed(1) + "% YoY", thr: "capex up > 30% YoY and > 1.5× D&A while revenue < +3% and margins not improving", text: "Capex " + cy.toFixed(0) + "% YoY, revenue " + r.toFixed(1) + "%" }; } },
    { id: 9, title: "Weakening orders or backlog", metric: "rpo_yoy", alt: "Backlog can fall because deliveries accelerated, not because orders weakened; contract timing is lumpy.",
      test: function (q) { var b = v_(q, "rpo_yoy"); if (b == null) return null; return { hit: b < -5, level: b < -15 ? 2 : 1, value: b, comp: "same quarter last year", thr: "remaining performance obligations down > 5% YoY (critical > 15%)", text: "Remaining performance obligations " + b.toFixed(1) + "% YoY" }; } },
    { id: 10, title: "Customer concentration or retention risk", metric: "concentration", unavailable: "Customer concentration and retention are disclosed in text, not in the structured filings." },
    { id: 11, title: "Share dilution", metric: "sh_d_yoy", alt: "Acquisitions paid in stock or a capital raise for growth can be value-creating despite dilution.",
      test: function (q) { var d = v_(q, "sh_d_yoy"); if (d == null) return null; return { hit: d > 2, level: d > 5 ? 2 : 1, value: d, comp: "diluted shares a year earlier", thr: "diluted share count up > 2% YoY (critical > 5%)", text: "Diluted shares " + d.toFixed(1) + "% YoY" }; } },
    { id: 12, title: "Unusual adjustments and recurring exclusions", metric: "restated", alt: "Restatements can be routine reclassifications rather than corrections.",
      test: function (q) { var n = Object.keys(q.m).filter(function (k) { return q.m[k] && q.m[k].src && q.m[k].src.restated; }); return { hit: n.length > 0, level: 1, value: n.length, comp: "originally filed values", thr: "any figure re-filed with a different value", text: n.length ? "Re-filed with changed values: " + n.slice(0, 5).join(", ") : "no re-filed values" }; },
      partial: "Non-GAAP adjustments themselves are in the earnings release text, not the structured filings — only restatements are checked." },
  ];
  var FIN_NA = { 2: 1, 3: 1, 4: 1, 5: 1, 8: 1 };   /* operating-company rules that do not apply to banks / insurers */
  function material(q, k, M) {   /* a working-capital balance under 2% of TTM revenue cannot carry a signal */
    var i = M.quarters.indexOf(q), r4 = i >= 0 ? ttm(M.quarters, i, "rev") : null, b = v_(q, k);
    return b == null || r4 == null || b >= 0.02 * r4;
  }
  function warnings(M) {
    var Q = M.quarters, W = Q.slice(-8), fin = M.model.kind === "financial" || M.model.kind === "insurer";
    return RULES.map(function (R) {
      var base = { id: R.id, title: R.title, metric: R.metric, alt: R.alt || "", partial: R.partial || "" };
      if (fin && FIN_NA[R.id]) return Object.assign(base, { status: "UNAVAILABLE", severity: null, note: "Not applicable to this business model — " + M.model.note, history: W.map(function (q) { return { label: q.fl.label, st: "n/a" }; }) });
      if (R.unavailable) return Object.assign(base, { status: "UNAVAILABLE", severity: null, note: R.unavailable, history: W.map(function (q) { return { label: q.fl.label, st: "n/a" }; }) });
      var H = W.map(function (q) { var r = R.test(q, M); return { label: q.fl.label, end: q.end, r: r }; });
      var ev = H.filter(function (h) { return h.r; });
      if (!ev.length) return Object.assign(base, { status: "UNAVAILABLE", severity: null, note: "The inputs for this rule are not filed for this company.", history: H.map(function (h) { return { label: h.label, st: "n/a" }; }) });
      var last = H[H.length - 1], run = 0, crit = 0;
      for (var j = H.length - 1; j >= 0 && H[j].r && H[j].r.hit; j--) { run++; if (H[j].r.level >= 2) crit++; }
      var everHit = H.filter(function (h) { return h.r && h.r.hit; });
      var hist = H.map(function (h) { return { label: h.label, st: !h.r ? "n/a" : h.r.hit ? (h.r.level >= 2 ? "C" : "W") : "ok", text: h.r ? h.r.text : "" }; });
      var conf = last.r && Object.keys(M.quarters[M.quarters.length - 1].m).some(function (k) { var m = M.quarters[M.quarters.length - 1].m[k]; return m && m.approx; }) ? "MEDIUM" : "HIGH";
      if (!last.r) return Object.assign(base, { status: "STALE", severity: null, note: "Latest quarter lacks the inputs; last evaluated " + ev[ev.length - 1].label + ".", history: hist, confidence: "LOW" });
      if (!last.r.hit) {
        var res = everHit.length ? everHit[everHit.length - 1] : null;
        return Object.assign(base, { status: res ? "RESOLVED" : "NOT TRIGGERED", severity: null, resolved_after: res ? res.label : null, value: last.r.value, text: last.r.text, threshold: last.r.thr, comp: last.r.comp, history: hist, latest: last.label, confidence: conf });
      }
      var sev = last.r.level >= 2 ? 2 : 1;
      if (run >= 3) sev = Math.max(sev, 2);
      if (run >= 3 && crit >= 2) sev = 3;   /* never from a single quarter */
      var firstRun = H[H.length - run];
      return Object.assign(base, { status: "ACTIVE", severity: SEV[sev], persistence: run, first: firstRun.label, first_ever: everHit[0].label, latest: last.label, value: last.r.value, text: last.r.text, threshold: last.r.thr, comp: last.r.comp, history: hist, confidence: conf,
        escalated: run >= 3 && last.r.level < 2 });
    });
  }

  /* ---------------------------------------------------------------- valuation (market price × filed fundamentals) */
  function lastPrice(P) { var t = P && P.ticker && P.ticker.ts; if (!t || !t.length) return null; var x = t[t.length - 1]; return { date: x[0], price: x[1] }; }
  function sharesOut(M) {
    var d = (M.co.dei && M.co.dei.EntityCommonStockSharesOutstanding) || [];
    if (d.length) { var x = d.slice().sort(function (a, b) { return a.e < b.e ? 1 : -1; })[0]; return { v: x.v, how: "shares outstanding on the latest filing cover (" + x.e + ")", st: "REPORTED" }; }
    var q = M.quarters[M.quarters.length - 1]; return val(q, "sh_d") ? { v: val(q, "sh_d"), how: "latest diluted weighted-average shares (proxy)", st: "CALCULATED" } : null;
  }
  function valuation(M, P) {
    var Q = M.quarters, i = Q.length - 1, q = Q[i], lp = lastPrice(P), sh = sharesOut(M); if (!lp || !q) return null;
    var t = function (k) { return ttm(Q, i, k); }, eps4 = t("eps_d"), ceps4 = t("core_eps"), mcap = sh ? lp.price * sh.v : null, ev = mcap != null && val(q, "ndebt") != null ? mcap + val(q, "ndebt") : null;
    var out = { price: lp.price, date: lp.date, shares: sh, mcap: mcap, ev: ev, eps_ttm: eps4, core_eps_ttm: ceps4,
      pe: eps4 > 0 ? lp.price / eps4 : null, pe_core: ceps4 > 0 ? lp.price / ceps4 : null,
      ev_ebit: ev != null && t("ebit") > 0 ? ev / t("ebit") : null, fcf_yield: mcap && t("fcf") != null ? t("fcf") / mcap * 100 : null,
      div_yield: mcap && t("div") != null ? t("div") / mcap * 100 : null, rpo: val(q, "rpo"), rpo_yoy: val(q, "rpo_yoy"),
      liquidity: val(q, "cash") != null ? val(q, "cash") + (val(q, "sti") || 0) : null };
    return out;
  }
  function clip(x, a, b) { return Math.max(a, Math.min(b, x)); }
  /* starting assumptions only — every one is shown and editable; nothing here is a forecast */
  function defaultScenarios(M, V) {
    var q = M.quarters[M.quarters.length - 1], useCore = V.core_eps_ttm > 0, eps0 = useCore ? V.core_eps_ttm : V.eps_ttm;
    var g = clip(val(q, "rev_yoy") != null ? val(q, "rev_yoy") : 5, -5, 25), pe = clip((useCore ? V.pe_core : V.pe) || 18, 8, 40);
    return { eps0: eps0, basis: useCore ? "core TTM EPS (excludes equity-investment gains/losses)" : "reported TTM diluted EPS",
      cases: [{ id: "bear", name: "Bear", g: Math.round(g - 10), pe: Math.round(pe * 0.8), p: 25 }, { id: "base", name: "Base", g: Math.round(g), pe: Math.round(pe), p: 50 }, { id: "bull", name: "Bull", g: Math.round(g + 10), pe: Math.round(pe * 1.15), p: 25 }],
      seed: "Base growth = latest revenue growth (" + (val(q, "rev_yoy") != null ? val(q, "rev_yoy").toFixed(1) + "%" : "n/a") + ", capped −5% to 25%); base P/E = today’s P/E (capped 8–40×); bear −10 pp and 0.8×; bull +10 pp and 1.15×; weights 25/50/25." };
  }
  function scenarios(eps0, price, cases) {
    var tp = cases.reduce(function (a, c) { return a + (+c.p || 0); }, 0) || 1, w = 0;
    var R = cases.map(function (c) { var eps = eps0 * (1 + (+c.g || 0) / 100), v = eps * (+c.pe || 0); w += v * (+c.p || 0) / tp;
      return { id: c.id, name: c.name, g: +c.g, pe: +c.pe, p: +c.p, eps: eps, value: v, upside: price ? (v / price - 1) * 100 : null }; });
    return { cases: R, weighted: { value: w, upside: price ? (w / price - 1) * 100 : null, probs_sum: tp } };
  }
  function sensitivity(epsNtm, peCenter, price) {
    var c = Math.round(peCenter), out = [];
    for (var m = c - 5; m <= c + 3; m++) if (m > 0) out.push({ pe: m, value: epsNtm * m, above: price ? epsNtm * m >= price : null, center: m === c });
    return { rows: out, perTurn: epsNtm, breakEvenPE: price && epsNtm > 0 ? price / epsNtm : null };
  }
  function dailyMoves(ts) { var o = []; for (var i = 1; i < (ts || []).length; i++) o.push({ date: ts[i][0], pct: (ts[i][1] / ts[i - 1][1] - 1) * 100 }); return o; }
  function bigMoves(ts, n) { var d = dailyMoves(ts).sort(function (a, b) { return a.pct - b.pct; }); return { worst: d.slice(0, n || 5), best: d.slice(-(n || 5)).reverse() }; }
  function reactions(P, filings) {
    var ts = P && P.ticker && P.ticker.ts, sp = P && P.spx && P.spx.ts; if (!ts) return [];
    return (filings || []).filter(function (f) { return f.form === "8-K" && /2\.02/.test(f.items); }).map(function (f) {
      var r = reaction(ts, f.filed), m = sp ? reaction(sp, f.filed) : null;
      return r == null ? null : { date: f.filed, pct: r, spx: m, rel: m == null ? null : r - m };
    }).filter(Boolean).reverse();
  }

  /* latest disclosed principal-maturity ladder (usually only in the 10-K) */
  function maturities(M) {
    var Q = M.quarters;
    for (var i = Q.length - 1; i >= 0; i--) { var q = Q[i], b = ["mat1", "mat2", "mat3", "mat4", "mat5", "mat6"].map(function (k) { return q.m[k] || null; });
      if (b.some(Boolean)) return { end: q.end, label: q.fl.label, buckets: b, cash: val(q, "cash"), sti: val(q, "sti"), revolver: val(q, "revolver"), gdebt: val(q, "gdebt") }; }
    return null;
  }
  function avgBal(Q, i, k) { var a = val(Q[i], k), b = i >= 4 ? val(Q[i - 4], k) : null; return a == null ? null : b == null ? a : (a + b) / 2; }

  /* ---------------------------------------------------------------- four verdicts (rule-based, evidence-linked) */
  var SCALE = ["NEGATIVE", "WEAK", "MIXED", "SOLID", "STRONG"];
  function grade(score, max) { var r = score / Math.max(1, max); return r >= 0.6 ? "STRONG" : r >= 0.25 ? "SOLID" : r > -0.25 ? "MIXED" : r > -0.6 ? "WEAK" : "NEGATIVE"; }
  function ev(sign, text, metric, period, value, w) { return { sign: sign, text: text, metric: metric, period: period, value: value, w: w || 1 }; }

  function earningsQuality(M, i) {
    if (M.model.kind === "financial" || M.model.kind === "insurer")
      return { name: "Earnings quality", q: "Is reported profit supported by genuine operating performance and cash generation?", verdict: "UNAVAILABLE", confidence: "NONE", pos: [], neg: [], evidence: [], note: M.model.note };
    var Q = M.quarters, q = Q[i], E = [], used = 0, need = 0, L = q.fl.label;
    function t(k) { return ttm(Q, i, k); }
    need++; var ni4 = t("ni"), cfo4 = t("cfo");
    if (ni4 != null && cfo4 != null) { used++; if (ni4 > 0) { var c = cfo4 / ni4;
        E.push(c >= 1.0 ? ev(1, "Cash backs reported profit: TTM operating cash flow is " + c.toFixed(2) + "× net income", "cfoni_ttm", "TTM to " + L, c)
          : c < 0.8 ? ev(-1, "Profit is running ahead of cash: TTM operating cash flow is only " + c.toFixed(2) + "× net income", "cfoni_ttm", "TTM to " + L, c, 1.5) : ev(0, "TTM cash conversion " + c.toFixed(2) + "× net income", "cfoni_ttm", "TTM to " + L, c)); }
      else E.push(ev(-1, "TTM net income is negative (" + fmt(ni4) + ")", "ni_ttm", "TTM to " + L, ni4, 1.5)); }
    need++; var fcf4 = t("fcf");
    if (fcf4 != null) { used++; E.push(fcf4 > 0 ? ev(1, "Positive TTM free cash flow of " + fmt(fcf4), "fcf_ttm", "TTM to " + L, fcf4) : ev(-1, "Negative TTM free cash flow (" + fmt(fcf4) + ")", "fcf_ttm", "TTM to " + L, fcf4)); }
    need++; var ry = val(q, "rev_yoy");
    if (ry != null) { used++; E.push(ry >= 3 ? ev(1, "Revenue up " + ry.toFixed(1) + "% YoY", "rev_yoy", L, ry) : ry <= -3 ? ev(-1, "Revenue down " + Math.abs(ry).toFixed(1) + "% YoY", "rev_yoy", L, ry) : ev(0, "Revenue roughly flat YoY (" + ry.toFixed(1) + "%)", "rev_yoy", L, ry)); }
    need++; var om = val(q, "opm_yoy");
    if (om != null) { used++; E.push(om >= 0.5 ? ev(1, "Operating margin widened " + om.toFixed(1) + " pp YoY", "opm_yoy", L, om) : om <= -2 ? ev(-1, "Operating margin compressed " + Math.abs(om).toFixed(1) + " pp YoY", "opm_yoy", L, om) : ev(0, "Operating margin broadly stable (" + om.toFixed(1) + " pp YoY)", "opm_yoy", L, om)); }
    need++; var asa = avgBal(Q, i, "assets");
    if (ni4 != null && cfo4 != null && asa) { used++; var acc = (ni4 - cfo4) / asa * 100;
      E.push(acc > 5 ? ev(-1, "High accruals: (net income − CFO) is " + acc.toFixed(1) + "% of average assets", "accruals", "TTM to " + L, acc) : acc < 0 ? ev(1, "Low accruals: cash flow exceeds net income (accrual ratio " + acc.toFixed(1) + "%)", "accruals", "TTM to " + L, acc, 0.5) : ev(0, "Accrual ratio " + acc.toFixed(1) + "% of average assets", "accruals", "TTM to " + L, acc)); }
    need++; var sy = val(q, "sh_d_yoy");
    if (sy != null) { used++; E.push(sy > 2 ? ev(-1, "Diluted share count up " + sy.toFixed(1) + "% YoY (dilution)", "sh_d_yoy", L, sy) : sy < -1 ? ev(1, "Diluted share count down " + Math.abs(sy).toFixed(1) + "% YoY", "sh_d_yoy", L, sy, 0.5) : ev(0, "Share count broadly stable (" + sy.toFixed(1) + "% YoY)", "sh_d_yoy", L, sy)); }
    var sb = val(q, "sbcr"); if (sb != null && sb > 10) E.push(ev(-1, "Stock-based compensation is " + sb.toFixed(1) + "% of revenue", "sbcr", L, sb));
    var ar = val(q, "ar_yoy"); if (ar != null && ry != null && ar - ry > 10) E.push(ev(-1, "Receivables grew " + ar.toFixed(0) + "% YoY vs revenue " + ry.toFixed(0) + "%", "ar_yoy", L, ar - ry));
    return finish("Earnings quality", "Is reported profit supported by genuine operating performance and cash generation?", E, used, need);
  }
  function resilience(M, i) {
    var Q = M.quarters, q = Q[i], E = [], used = 0, need = 0, L = q.fl.label, fin = M.model.kind === "financial" || M.model.kind === "insurer";
    var nd = val(q, "ndebt"), gd = val(q, "gdebt"), cash = val(q, "cash");
    need++; if (nd != null) { used++; if (nd < 0) E.push(ev(1, "Net cash position of " + fmt(-nd), "ndebt", L, nd)); }
    var oi4 = ttm(Q, i, "ebit"), da4 = ttm(Q, i, "da"), int4 = ttm(Q, i, "intexp"), cap = M.model.kind === "utility" || M.model.kind === "reit";
    var LV = cap ? [3, 5.5, 6.5] : [1, 3, 4.5];
    if (!fin) { need++; if (nd != null && oi4 != null && da4 != null) { used++; var eb = oi4 + da4, lev = eb > 0 ? nd / eb : null;
        if (lev == null) E.push(ev(-1, "TTM EBITDA is not positive — leverage cannot be covered by earnings", "ebitda_ttm", "TTM to " + L, eb, 1.5));
        else if (nd > 0) E.push(lev < LV[0] ? ev(1, "Low leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev) : lev > LV[2] ? ev(-1, "High leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev, 1.5) : lev > LV[1] ? ev(-1, "Elevated leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev) : ev(0, "Moderate leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev)); } }
    need++; if (oi4 != null && int4) { used++; var cov = oi4 / int4;
      E.push(cov > 8 ? ev(1, "Interest is well covered: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov) : cov < 1.5 ? ev(-1, "Interest barely covered: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov, 1.5) : cov < 3 ? ev(-1, "Thin interest cover: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov) : ev(0, "Adequate interest cover: " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov)); }
    if (!fin) { need++; var cr = val(q, "cr"); if (cr != null) { used++; E.push(cr >= 1.5 ? ev(1, "Current ratio " + cr.toFixed(2) + "×", "cr", L, cr, 0.5) : cr < 1 ? ev(-1, "Current ratio below 1 (" + cr.toFixed(2) + "×)", "cr", L, cr) : ev(0, "Current ratio " + cr.toFixed(2) + "×", "cr", L, cr)); } }
    if (!fin) { need++; var f4 = ttm(Q, i, "fcf"); if (f4 != null) { used++; E.push(f4 > 0 ? ev(1, "Self-funding: TTM free cash flow " + fmt(f4), "fcf_ttm", "TTM to " + L, f4, 0.5) : ev(-1, "Cash-consuming: TTM free cash flow " + fmt(f4), "fcf_ttm", "TTM to " + L, f4)); } }
    var dy = val(q, "gdebt_yoy"); if (dy != null && dy > 15) E.push(ev(-1, "Gross debt up " + dy.toFixed(0) + "% YoY", "gdebt_yoy", L, dy));
    var st = (val(q, "dcur") || 0) + (val(q, "stb") || 0) + (val(q, "cp") || 0);
    if (cash != null && st > 0) E.push(cash + (val(q, "sti") || 0) >= st ? ev(1, "Cash and short-term investments cover debt due within a year", "cash_vs_std", L, cash / st, 0.5) : ev(-1, "Debt due within a year exceeds cash and short-term investments", "cash_vs_std", L, cash / st));
    if (cap) E.forEach(function (e) { if (e.metric === "nd_ebitda" || e.metric === "cash_vs_std") e.text += " (capital-intensive thresholds)"; });
    var r = finish("Financial resilience", "Can the company finance its operations, investment and debt without increasing financial stress?", E, used, need);
    if (fin) r.note = M.model.note;
    if (cap) r.note = "Capital-intensive " + (M.model.kind === "reit" ? "REIT" : "regulated utility") + " model: leverage is judged on wider thresholds (net debt / EBITDA low < 3×, elevated > 5.5×, high > 6.5×) until the sector template and peer benchmarks arrive.";
    if (r.verdict === "WEAK" && E.some(function (e) { return e.metric === "nd_ebitda" && e.sign < 0; })) r.verdict = "STRETCHED";
    return r;
  }
  function outlook(M, i) {
    return { name: "Forward outlook", q: "Is the company’s future operating outlook improving or deteriorating?", verdict: "UNAVAILABLE", confidence: "NONE", pos: [], neg: [], evidence: [],
      note: "Built on management guidance and verified consensus — neither has a free structured source, so no verdict is given. Momentum in reported results is in the revenue and margin cards, but it is not a forecast." };
  }
  function market(M, i, prices, release) {
    var r = { name: "Market implication", q: "Has the market rewarded or penalized the results?", pos: [], neg: [], evidence: [] };
    if (!prices || !prices.ticker || !release) { r.verdict = "UNAVAILABLE"; r.confidence = "NONE"; r.note = !release ? "No earnings release (8-K Item 2.02) found in recent filings." : "Price history did not load."; return r; }
    var rx = reaction(prices.ticker.ts, release.filed), mx = prices.spx ? reaction(prices.spx.ts, release.filed) : null;
    if (rx == null) { r.verdict = "UNAVAILABLE"; r.confidence = "NONE"; r.note = "Release date falls outside the loaded price history."; return r; }
    var rel = mx == null ? rx : rx - mx;
    r.verdict = rel > 3 ? "STRONG" : rel > 1 ? "SOLID" : rel >= -1 ? "MIXED" : rel >= -3 ? "WEAK" : "NEGATIVE";
    r.confidence = "LOW";
    var e = ev(rel >= 0 ? 1 : -1, "Two-day move around the " + release.filed + " earnings release: " + rx.toFixed(1) + "%" + (mx != null ? " vs S&P 500 " + mx.toFixed(1) + "% (relative " + (rel >= 0 ? "+" : "") + rel.toFixed(1) + " pp)" : ""), "px_reaction", release.filed, rel);
    r.evidence = [e]; (rel >= 0 ? r.pos : r.neg).push(e);
    r.note = "Release timing (before/after the bell) is not disclosed in the filing index, so the window is the close before the release date to the close one session after. No verified consensus, so the move cannot be split into ‘beat’ and ‘guidance’ effects. Market reaction is not evidence of financial quality.";
    return r;
  }
  function reaction(ts, date) {
    if (!ts || !ts.length) return null; var i = ts.findIndex(function (x) { return x[0] >= date; });
    if (i < 1 || i + 1 >= ts.length) return null;
    return (ts[i + 1][1] / ts[i - 1][1] - 1) * 100;
  }
  function finish(name, q, E, used, need) {
    var s = 0, mx = 0; E.forEach(function (e) { s += e.sign * e.w; mx += e.w; });
    var conf = used >= need && need ? "HIGH" : used >= need * 0.6 ? "MEDIUM" : used ? "LOW" : "NONE";
    var pos = E.filter(function (e) { return e.sign > 0; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 3);
    var neg = E.filter(function (e) { return e.sign < 0; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 3);
    return { name: name, q: q, verdict: used ? grade(s, mx) : "UNAVAILABLE", score: s, confidence: conf, pos: pos, neg: neg, evidence: E, inputs: used + " of " + need + " core inputs" };
  }
  function verdicts(M, prices) {
    var Q = M.quarters, i = Q.length - 1, rel = latestRelease(M.co);
    var V = [earningsQuality(M, i), outlook(M, i), resilience(M, i), market(M, i, prices, rel)];
    /* history: verdicts as they would have read at each of the last 8 quarters (only data up to that quarter) */
    var H = [];
    for (var j = Math.max(3, Q.length - 8); j < Q.length; j++) H.push({ label: Q[j].fl.label, end: Q[j].end, eq: earningsQuality(M, j).verdict, fr: resilience(M, j).verdict });
    V.forEach(function (v) { v.direction = "—"; });
    if (H.length >= 2) { [["eq", 0], ["fr", 2]].forEach(function (x) { var a = SCALE.indexOf(H[H.length - 2][x[0]]), b = SCALE.indexOf(H[H.length - 1][x[0]]);
      if (a >= 0 && b >= 0) V[x[1]].direction = b > a ? "improving" : b < a ? "deteriorating" : "unchanged"; }); }
    return { verdicts: V, history: H, release: rel };
  }
  function latestRelease(co) { return (co.filings || []).filter(function (f) { return f.form === "8-K" && /2\.02/.test(f.items); })[0] || null; }
  function streak(H, k) {   /* consecutive quarters (ending latest) moving the same way */
    var n = 0, dir = 0;
    for (var j = H.length - 1; j > 0; j--) { var a = SCALE.indexOf(H[j - 1][k]), b = SCALE.indexOf(H[j][k]); if (a < 0 || b < 0 || a === b) break;
      var d = b > a ? 1 : -1; if (dir && d !== dir) break; dir = d; n++; }
    return { n: n, dir: dir };
  }

  /* ---------------------------------------------------------------- series & interpretation */
  function series(M, k, n) { return M.quarters.slice(-(n || 8)).map(function (q) { return { label: q.fl.label, end: q.end, v: val(q, k), st: q.m[k] ? q.m[k].st : "UNAVAILABLE", m: q.m[k] || null }; }); }
  function trend(S) {
    var v = S.filter(function (x) { return x.v != null; });
    if (v.length < 3) return { dir: "insufficient", text: "fewer than three reported quarters" };
    var up = 0, dn = 0; for (var i = 1; i < v.length; i++) { if (v[i].v > v[i - 1].v) up++; else if (v[i].v < v[i - 1].v) dn++; }
    var first = v[0].v, last = v[v.length - 1].v, hi = Math.max.apply(null, v.map(function (x) { return x.v; })), lo = Math.min.apply(null, v.map(function (x) { return x.v; }));
    var mean = v.reduce(function (a, x) { return a + x.v; }, 0) / v.length, sd = Math.sqrt(v.reduce(function (a, x) { return a + (x.v - mean) * (x.v - mean); }, 0) / v.length);
    var dir = up >= v.length * 0.7 - 1 && last > first ? "rising" : dn >= v.length * 0.7 - 1 && last < first ? "falling" : "mixed";
    var turn = null; for (var j = v.length - 2; j >= 1; j--) { var d1 = v[j].v - v[j - 1].v, d2 = v[j + 1].v - v[j].v; if (d1 * d2 < 0) { turn = v[j].label; break; } }
    return { dir: dir, up: up, dn: dn, n: v.length, first: v[0], last: v[v.length - 1], hi: hi, lo: lo, cv: mean ? Math.abs(sd / mean) : null, turn: turn,
      atHigh: last === hi, atLow: last === lo };
  }
  function fmt(v) { if (v == null || !isFinite(v)) return "—"; var a = Math.abs(v), s = v < 0 ? "−" : "";
    return s + (a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(2)); }

  root.COENGINE = { valuation: valuation, defaultScenarios: defaultScenarios, scenarios: scenarios, sensitivity: sensitivity, bigMoves: bigMoves, reactions: reactions, lastPrice: lastPrice, warnings: warnings, RULES: RULES, maturities: maturities, build: build, verdicts: verdicts, series: series, trend: trend, ttm: ttm, val: val, fmt: fmt, streak: streak, fiscalLabel: fiscalLabel,
    quarterFromTag: quarterFromTag, quarterEnds: quarterEnds, dedupe: dedupe, reaction: reaction, latestRelease: latestRelease, DUR: DUR, INST: INST, SCALE: SCALE };
  if (typeof module !== "undefined" && module.exports) module.exports = root.COENGINE;
})(typeof window !== "undefined" ? window : globalThis);
