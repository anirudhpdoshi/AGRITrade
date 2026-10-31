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
  };
  var INST = {
    cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
    sti: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
    ar: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], inv: ["InventoryNet"], ap: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"],
    ca: ["AssetsCurrent"], cl: ["LiabilitiesCurrent"], assets: ["Assets"], liab: ["Liabilities"],
    eq: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    stb: ["ShortTermBorrowings"], cp: ["CommercialPaper"], dcur: ["DebtCurrent", "LongTermDebtCurrent"],
    ltd_nc: ["LongTermDebtNoncurrent"], ltd: ["LongTermDebt"], oplease: ["OperatingLeaseLiability"],
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
    var A = annual(F, co.fiscalYearEnd);
    return { co: co, quarters: Q, annual: A, model: model(co), sector: sectorOf(co.sic) };
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
    if (val(q, "opinc") != null && val(q, "da") != null) { setC(q, "ebitda", val(q, "opinc") + val(q, "da"), "operating income + D&A", ["opinc", "da"]); if (rev) setC(q, "ebitdam", q.m.ebitda.v / rev * 100, "EBITDA ÷ revenue", ["ebitda", "rev"]); }
    if (val(q, "pretax") && val(q, "tax") != null) setC(q, "etr", val(q, "tax") / val(q, "pretax") * 100, "tax ÷ pretax income", ["tax", "pretax"]);
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
    ["rev", "gp", "opinc", "ni", "eps_d", "cfo", "fcf", "capex", "sh_d", "ar", "inv", "gdebt", "cogs", "sga", "rnd"].forEach(function (k) {
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
  function avgBal(Q, i, k) { var a = val(Q[i], k), b = i >= 4 ? val(Q[i - 4], k) : null; return a == null ? null : b == null ? a : (a + b) / 2; }

  /* ---------------------------------------------------------------- four verdicts (rule-based, evidence-linked) */
  var SCALE = ["NEGATIVE", "WEAK", "MIXED", "SOLID", "STRONG"];
  function grade(score, max) { var r = score / Math.max(1, max); return r >= 0.6 ? "STRONG" : r >= 0.25 ? "SOLID" : r > -0.25 ? "MIXED" : r > -0.6 ? "WEAK" : "NEGATIVE"; }
  function ev(sign, text, metric, period, value, w) { return { sign: sign, text: text, metric: metric, period: period, value: value, w: w || 1 }; }

  function earningsQuality(M, i) {
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
    var oi4 = ttm(Q, i, "opinc"), da4 = ttm(Q, i, "da"), int4 = ttm(Q, i, "intexp");
    if (!fin) { need++; if (nd != null && oi4 != null && da4 != null) { used++; var eb = oi4 + da4, lev = eb > 0 ? nd / eb : null;
        if (lev == null) E.push(ev(-1, "TTM EBITDA is not positive — leverage cannot be covered by earnings", "ebitda_ttm", "TTM to " + L, eb, 1.5));
        else if (nd > 0) E.push(lev < 1 ? ev(1, "Low leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev) : lev > 4.5 ? ev(-1, "High leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev, 1.5) : lev > 3 ? ev(-1, "Elevated leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev) : ev(0, "Moderate leverage: net debt / EBITDA " + lev.toFixed(1) + "×", "nd_ebitda", "TTM to " + L, lev)); } }
    need++; if (oi4 != null && int4) { used++; var cov = oi4 / int4;
      E.push(cov > 8 ? ev(1, "Interest is well covered: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov) : cov < 1.5 ? ev(-1, "Interest barely covered: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov, 1.5) : cov < 3 ? ev(-1, "Thin interest cover: EBIT / interest " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov) : ev(0, "Adequate interest cover: " + cov.toFixed(1) + "×", "int_cov", "TTM to " + L, cov)); }
    if (!fin) { need++; var cr = val(q, "cr"); if (cr != null) { used++; E.push(cr >= 1.5 ? ev(1, "Current ratio " + cr.toFixed(2) + "×", "cr", L, cr, 0.5) : cr < 1 ? ev(-1, "Current ratio below 1 (" + cr.toFixed(2) + "×)", "cr", L, cr) : ev(0, "Current ratio " + cr.toFixed(2) + "×", "cr", L, cr)); } }
    if (!fin) { need++; var f4 = ttm(Q, i, "fcf"); if (f4 != null) { used++; E.push(f4 > 0 ? ev(1, "Self-funding: TTM free cash flow " + fmt(f4), "fcf_ttm", "TTM to " + L, f4, 0.5) : ev(-1, "Cash-consuming: TTM free cash flow " + fmt(f4), "fcf_ttm", "TTM to " + L, f4)); } }
    var dy = val(q, "gdebt_yoy"); if (dy != null && dy > 15) E.push(ev(-1, "Gross debt up " + dy.toFixed(0) + "% YoY", "gdebt_yoy", L, dy));
    var st = (val(q, "dcur") || 0) + (val(q, "stb") || 0) + (val(q, "cp") || 0);
    if (cash != null && st > 0) E.push(cash + (val(q, "sti") || 0) >= st ? ev(1, "Cash and short-term investments cover debt due within a year", "cash_vs_std", L, cash / st, 0.5) : ev(-1, "Debt due within a year exceeds cash and short-term investments", "cash_vs_std", L, cash / st));
    var r = finish("Financial resilience", "Can the company finance its operations, investment and debt without increasing financial stress?", E, used, need);
    if (fin) r.note = M.model.note;
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

  root.COENGINE = { build: build, verdicts: verdicts, series: series, trend: trend, ttm: ttm, val: val, fmt: fmt, streak: streak, fiscalLabel: fiscalLabel,
    quarterFromTag: quarterFromTag, quarterEnds: quarterEnds, dedupe: dedupe, reaction: reaction, latestRelease: latestRelease, DUR: DUR, INST: INST, SCALE: SCALE };
  if (typeof module !== "undefined" && module.exports) module.exports = root.COENGINE;
})(typeof window !== "undefined" ? window : globalThis);
