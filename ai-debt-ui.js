/* ai-debt-ui.js — AI Debt tab: AI-company debt raises, Jan 2021 – Nov 2026, plus the v2 debt
   enhancement (fiscal-year annual debt profile, cost of debt, 5-year maturity ladder,
   refinancing stress, debt sustainability, rule-based warning flags) from SEC EDGAR filings.
   Data: ai-debt.json (same directory), built verbatim from the verified research dataset
   (406 rows, 15 companies; SEC EDGAR filings, prospectuses, company IR, reputable press).
   Interaction: pick a company from the left list — the main area shows ONLY that
   company. Summary | Details toggle above the main area. A year ruler (All + 2021–2026)
   filters both views; tap a year or drag/scrub across it. Every figure is shown exactly
   as researched — coupon, market yield and all-in rate are separate fields and never
   substituted; null yields print as "—". Amounts are shown in USD billions ($B):
   USD rows are amount / 1000; non-USD rows are converted at the issue-month average
   FX rate (FRED H.10 daily, mean of the month's observations) and carry the rate in
   fx_rate_used. The original amount and issue currency are kept on every row and shown
   in the expanded Details. "Total raised" follows the research's documented per-company
   total (row.include_in_total): for most companies the parent's own funded debt; for
   CoreWeave, Crusoe, Lambda, Nebius and Nscale it includes the project-vehicle / SPV
   facilities the research counts as raised debt. Items excluded from a total (undrawn
   facilities, leases, subsidiary debt, undocumented items) are still shown in Details,
   marked "excluded from total".
   Enhancement data: ai-debt-enhancement.json v2 (same directory), SEC EDGAR companyfacts XBRL +
   10-K/10-Q/20-F/6-K/S-1 filings, accession on every figure, generated 2026-11-12.
   YEAR CONVENTION: the annual_profile is FISCAL years (the company's reporting period);
   the raises file and the v1 annual_chart are CALENDAR years (issue month). The same offering
   can fall in different buckets (e.g. Microsoft's $25B Oct 2026 offering is calendar-2026 but
   FY2027; NVIDIA's $5B Jun 2021 offering is calendar-2021 but FY2022). Gross raised is
   calendar-year and is labelled with its own basis — never presented as a fiscal-year figure.
   Total debt is CARRYING amounts throughout v2. The six sections inside the selected
   company's view, in order: the coverage verdict banner, key risk indicators,
   01 annual debt profile, 02 cost of debt, 03 maturity & refinancing ladder,
   04 refinancing cost impact, 05 debt sustainability; 06 instrument detail is the Details
   table. Forward years are disclosed maturities or labelled estimates — nothing is forecast
   without a stated assumption, and unavailable figures print as "—", never as zero.
   Coupon is the contractual interest payment; yield is the effective return demanded at
   issuance — never used interchangeably.
   EXISTING-DEBT RATE RULE (user decision, 2026-11-12 — take the disclosed number): the
   "existing debt rate" is ALWAYS the DISCLOSED debt-note weighted-average rate — the
   wa_interest_rate_existing_debt_pct of the latest fiscal-year row whose wa_rate_method is
   debt-note based (debt-note disclosed, face-weighted from the note, or amount-weighted
   from disclosed tranche rates). The blended effective rate (interest expense ÷ average
   total debt) is NEVER used in a differential, a warning flag or a stress-test base rate;
   it appears only as a clearly labelled computed secondary line. Where no disclosed rate
   exists, the differential and the rising-cost flag show "—". */
(function () {
  "use strict";
  var P = document.getElementById("panel-aidebt"), BTN = document.getElementById("tabbtn-aidebt");
  if (!P || !BTN) return;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SYM = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", CHF: "CHF ", AUD: "A$" };
  var YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"];
  var RULER_POS = ["", "2021", "2022", "2023", "2024", "2025", "2026"]; /* "" = All */
  var D = null, E = null, LOADFAIL = false, EFAIL = false, BUILT = false;
  var F = { co: "", yr: "", inst: "", cf: "", view: "summary" };
  var scrub = false;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(v) { return (+v).toLocaleString("en-US"); }
  function fmtB(v) { if (v == null) return "—"; return "$" + (+v < 0.1 ? (+v).toFixed(3) : (+v).toFixed(2)) + "B"; } /* $B, 2 decimals; 3 decimals below $0.10B so small raises (min $0.004B) never print as $0.00B */
  function sumB(rows) { var t = 0, n = 0; rows.forEach(function (r) { if (r.include_in_total !== false && r.amount_usd_b != null) { t += r.amount_usd_b; n++; } }); return { t: Math.round(t * 1000) / 1000, n: n }; } /* totals count ONLY included rows (parent funded debt) */
  function sumExcl(rows) { var t = 0, n = 0; rows.forEach(function (r) { if (r.include_in_total === false && r.amount_usd_b != null) { t += r.amount_usd_b; n++; } }); return { t: Math.round(t * 1000) / 1000, n: n }; } /* excluded rows, for the "excl. $XB" line */
  function origAmt(r) { var s = (SYM[r.currency] || r.currency + " ") + num(r.amount) + "m (" + r.currency + ")"; return r.fx_rate_used ? s + " → " + r.fx_rate_used : s; }
  function monLbl(m) { if (!m) return "—"; var p = m.split("-"); return MON[+p[1] - 1] + " " + p[0]; }
  function fam(t) {
    t = (t || "").toLowerCase();
    if (/convertible/.test(t)) return "Convertible notes";
    if (/revolv|delayed-draw|ddtl/.test(t)) return "Revolvers & DDTLs";
    if (/senior.*note|senior notes|senior secured note/.test(t)) return "Senior bonds";
    if (/term loan|credit facilit|financing facilit|bridge|promissory|lease|equipment|syndicated|\bloan\b|loan agreement/.test(t)) return "Term loans & facilities";
    return "Other";
  }
  function isSPV(r) {
    var s = (r.issuer_legal_entity + " | " + r.instrument_type + " | " + (r.notes || "")).toLowerCase();
    if (/spv/.test(s)) return true;
    if (/project (entity|borrower|bond|notes|financing|facilit)/.test(s)) return true;
    if (/beignet|sopaipilla|vantage data centers|river bend|beacon point|ctc property|apollo-managed|vci asset/.test(s)) return true;
    return false;
  }
  var MAIN = {}; /* most frequent issuer per company = the parent */
  function mainIssuer(co) {
    if (MAIN[co]) return MAIN[co];
    var c = {}, best = "", bn = 0;
    D.rows.forEach(function (r) { if (r.company === co) { c[r.issuer_legal_entity] = (c[r.issuer_legal_entity] || 0) + 1; if (c[r.issuer_legal_entity] > bn) { bn = c[r.issuer_legal_entity]; best = r.issuer_legal_entity; } } });
    MAIN[co] = best; return best;
  }
  function companies() {
    var cos = [];
    D.rows.forEach(function (r) { if (cos.indexOf(r.company) < 0) cos.push(r.company); });
    cos.sort(); return cos;
  }
  function coRows() { return D.rows.filter(function (r) { return r.company === F.co; }); }
  function yrRows() {
    var rs = coRows();
    if (F.yr) rs = rs.filter(function (r) { return r.issue_month.slice(0, 4) === F.yr; });
    return rs;
  }
  function filtered() {
    return yrRows().filter(function (r) {
      if (F.inst && r.instrument_type !== F.inst) return false;
      if (F.cf && r.confidence !== F.cf) return false;
      return true;
    }).sort(function (a, b) {
      if (a.issue_month !== b.issue_month) return a.issue_month < b.issue_month ? 1 : -1;
      if (a.company !== b.company) return a.company < b.company ? -1 : 1;
      return (b.amount || 0) - (a.amount || 0);
    });
  }
  function kpi(t, v, sub) { return '<div class="ad-k"><div class="t">' + t + '</div><div class="v">' + v + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>"; }
  function cfChip(c) { return '<span class="ad-cf ad-cf-' + c.toLowerCase() + '">' + c + "</span>"; }

/* ---------- Enhancement data: debt-service capacity, annual debt chart, refinancing scenarios.
   Source: ai-debt-enhancement.json (SEC EDGAR companyfacts XBRL + 10-K/10-Q/20-F/6-K/S-1, accession
   on every figure; generated 2026-11-12). Loads alongside ai-debt.json and never blocks the raises tab:
   if it fails, the new sections show a short note and the raises keep working. */
function enh() {
  if (!E || !E.companies) return null;
  for (var i = 0; i < E.companies.length; i++) if (E.companies[i].company === F.co) return E.companies[i];
  return null;
}
function fmtPct(v, d) { if (v == null) return "—"; return (+v).toFixed(d == null ? 2 : d) + "%"; }
function fmtPctS(v) { if (v == null) return "—"; return (Math.abs(v) < 0.1 ? (+v).toFixed(3) : (+v).toFixed(2)) + "%"; }
function fmtX(v) { if (v == null) return "—"; var a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1000 ? Math.round(a) : a.toFixed(1)) + "x"; }
function fmtSignedB(v) { if (v == null) return "—"; return (v < 0 ? "−$" : "$") + (Math.abs(v) < 0.1 ? Math.abs(v).toFixed(3) : Math.abs(v).toFixed(2)) + "B"; }
function fmtB3(v) { if (v == null) return "—"; return "$" + (+v).toFixed(3) + "B"; } /* always 3 decimals — refinancing increments need the precision */
function srcLine(a, per, filed) { return "Accession " + (a ? esc(a) : "—") + " · period ended " + (per ? esc(per) : "—") + (filed ? " · filed " + esc(filed) : ""); }
function accOf(src) { if (!src) return null; var m = String(src).match(/accession ([0-9-]+)/i); return m ? m[1] : null; }

function verdictHTML() {
  var c = enh();
  if (!c) return "";
  var ds = c.debt_service || {};
  if (ds.verdict === "UNAVAILABLE") {
    return '<section class="ad-verdict ad-v-un"><div class="ad-v-word">UNAVAILABLE</div><div class="ad-v-body">' +
      '<div class="ad-v-t">Debt-service capacity — cannot be assessed</div>' +
      '<div class="ad-v-b">' + esc(ds.verdict_basis || "No audited financials.") + '</div>' +
      '<div class="ad-v-n">Only the debt raises are known for this company; there is no filing to test interest or principal coverage against, so no verdict is given and nothing is estimated.</div>' +
      "</div></section>";
  }
  var t = ds.ttm || {};
  var ok = ds.verdict === "yes";
  var nums = "TTM FCF " + fmtSignedB(t.free_cash_flow_usd_b) + " · 12M debt service " + fmtB(ds.debt_service_12m_usd_b) +
    " (interest " + fmtB(t.interest_expense_usd_b) + " + principal " + fmtB(ds.principal_maturing_12m_usd_b) + ")" +
    " · FCF after debt service " + fmtSignedB(ds.fcf_after_debt_service_usd_b);
  return '<section class="ad-verdict ' + (ok ? "ad-v-yes" : "ad-v-no") + '"><div class="ad-v-word">' + (ok ? "YES" : "NO") + '</div><div class="ad-v-body">' +
    '<div class="ad-v-t">Can it meet interest + principal from operating cash flow after CAPEX, without new borrowing or equity?</div>' +
    '<div class="ad-v-n">' + nums + '</div>' +
    '<div class="ad-v-b">' + esc(ds.verdict_basis || "") + '</div>' +
    '<div class="ad-v-s">' + srcLine(t.accession, t.period_end, t.filed) + ' · TTM = latest fiscal year + latest interim period − prior-year interim period</div>' +
    "</div></section>";
}

/* ---------- v2 enhancement: fiscal-year annual debt profile, cost of debt, 5-year maturity
   ladder, refinancing stress, debt sustainability, rule-based warning flags.
   Source: ai-debt-enhancement.json v2 (SEC EDGAR companyfacts XBRL + 10-K/10-Q/20-F/6-K/S-1,
   accession on every figure; generated 2026-11-12). v1 fields are byte-identical inside v2.
   YEAR CONVENTION — READ BEFORE CHARTING: the annual_profile is FISCAL years (the company's
   reporting period); the raises file and the v1 annual_chart are CALENDAR years (issue month).
   The same offering can fall in different buckets (e.g. Microsoft's $25B Oct 2026 offering is
   calendar-2026 but FY2027; NVIDIA's $5B Jun 2021 offering is calendar-2021 but FY2022).
   The two series are never plotted on one axis without relabelling their basis.
   Total debt is CARRYING amounts throughout v2 (v1 used principal in places — see the dataset
   meta.corrections_to_v1). Gross raised comes from ai-debt.json (calendar-year raises) and is
   labelled with its own basis; it is NOT a fiscal-year figure and gross issuance is not the
   same as the increase in debt (net change = gross raised − principal repaid ± other changes).
   annual_profile / maturity_ladder / warning_flags shapes differ by research group and are kept
   verbatim in v2 (meta.structural_notes); they are normalised here in the UI code, and the
   flag booleans come from warning_flags_summary — EXCEPT the rising-cost flag, which is
   recomputed from the disclosed debt-note WA rate (rateBasis / disclosedDiff): the dataset's
   boolean was built on blended rates for some companies (e.g. Meta, Alphabet), so it cannot
   be trusted as the flag verdict. Every figure keeps its source accession,
   observation date, units and kind (actual / disclosed / estimate). Unavailable figures print
   as "—" with the reason, never as zero or a guess. Forecast new borrowing is null for every
   company — shown as "—" with the note. No tax expense was extracted in this pass, so the
   after-tax net-income impact of refinancing is not computed (formula shown, figure "—").
   Coupon is the contractual interest payment; yield is the effective return demanded at
   issuance — the two are never used interchangeably. */
function profRows(c) {
  if (!c) return { status: "NONE", rows: [] };
  var ap = c.annual_profile;
  if (!ap) return { status: "NONE", rows: [] };
  if (ap.status === "UNAVAILABLE") return {
    status: "UNAVAILABLE", reason: ap.reason || "No audited financials.",
    form_d: ap.form_d_accessions || null,
    compByYear: ap.borrowing_composition_by_year_usd_b || null,
    compNote: ap.borrowing_composition_note || null, rows: []
  };
  var raw = [];
  if (Array.isArray(ap)) raw = ap.slice();
  else { raw = (ap.rows || []).slice(); if (ap.ttm) raw.push(ap.ttm); }
  function compOf(r) {
    var bc = r.borrowing_composition;
    if (bc && typeof bc === "object") return { bonds: bc.bonds_usd_b, bank: bc.bank_borrowings_usd_b, cp: bc.commercial_paper_usd_b, other: bc.other_borrowings_usd_b };
    var bc2 = r.borrowing_composition_usd_b;
    if (bc2 && typeof bc2 === "object") return { bonds: bc2.bonds, bank: bc2.bank, cp: bc2.cp, other: bc2.other };
    if (r.bonds_usd_b != null || r.bank_borrowings_usd_b != null || r.commercial_paper_usd_b != null || r.other_borrowings_usd_b != null)
      return { bonds: r.bonds_usd_b, bank: r.bank_borrowings_usd_b, cp: r.commercial_paper_usd_b, other: r.other_borrowings_usd_b };
    return null;
  }
  var rows = raw.map(function (r) {
    if (!r || typeof r !== "object") return null;
    var isTtm = String(r.year) === "TTM" || String(r.year) === "ttm" || r.kind === "ttm";
    return {
      year: isTtm ? "TTM" : r.year, kind: isTtm ? "ttm" : (r.kind || "actual"),
      period_end: r.period_end || null, accession: r.accession || null, filed: r.filed || null,
      revenue: r.revenue_usd_b, ebitda: r.ebitda_usd_b, ebit: r.ebit_usd_b,
      interest_expense: r.interest_expense_usd_b, cash_interest_paid: r.cash_interest_paid_usd_b,
      ocf: r.operating_cash_flow_usd_b, capex: r.capex_usd_b, fcf: r.free_cash_flow_usd_b,
      cash: r.cash_and_equivalents_usd_b, equity: r.shareholders_equity_usd_b,
      dividends: r.dividends_paid_usd_b, buybacks: r.share_buybacks_usd_b,
      total_debt: r.total_debt_usd_b, st: r.short_term_debt_usd_b, lt: r.long_term_debt_usd_b,
      net_debt: r.net_debt_usd_b, dte: r.debt_to_equity, dtebitda: r.debt_to_ebitda, ndtebitda: r.net_debt_to_ebitda,
      yoy: r.yoy_debt_change_pct, yoy_note: r.yoy_note || null,
      gross_raised: r.gross_raised_usd_b, principal_repaid: r.principal_repaid_usd_b, net_borrowing: r.net_borrowing_usd_b,
      comp: compOf(r),
      wa_rate: r.wa_interest_rate_existing_debt_pct, wa_rate_method: r.wa_rate_method || null,
      wa_yield: r.wa_yield_new_issues_pct, fixed: r.fixed_rate_pct, floating: r.floating_rate_pct,
      avg_mat: r.avg_remaining_maturity_years, avg_mat_method: r.avg_remaining_maturity_method || null,
      secured: r.secured_pct, unsecured: r.unsecured_pct,
      ic_ebit: r.interest_coverage_ebit, dscr: r.dscr, notes: r.notes || null, ebitda_def: r.ebitda_definition || null
    };
  }).filter(function (r) { return !!r; });
  return { status: "OK", rows: rows };
}
function profTTM(c) {
  var p = profRows(c);
  if (p.status !== "OK") return null;
  for (var i = 0; i < p.rows.length; i++) if (p.rows[i].kind === "ttm") return p.rows[i];
  return null;
}
function profLatestFY(c) {
  var p = profRows(c);
  if (p.status !== "OK") return null;
  var best = null;
  p.rows.forEach(function (r) { if (r.kind === "actual" && r.total_debt != null && (!best || +r.year > +best.year)) best = r; });
  return best;
}
function maturingHist(c) {
  /* v1 annual_chart: CALENDAR-year principal maturing — partial lower bound (raises with a stated
     maturity year only). Kept for the flows chart / table, always labelled with its basis. */
  var map = {}, fwd = {};
  (c.annual_chart || []).forEach(function (y) {
    if (y.kind === "forward") {
      fwd[y.year] = { opening: y.opening_debt_usd_b, disclosed: y.disclosed_maturities_usd_b,
        est_refi: y.estimated_refinancing_usd_b, est_assumption: y.estimated_refinancing_assumption || null,
        forecast_new: y.forecast_new_borrowing_usd_b, forecast_note: y.forecast_new_borrowing_note || null,
        projected_closing: y.projected_closing_debt_usd_b, formula: y.projected_closing_debt_formula || null,
        maturity_source: y.maturity_source || null };
    } else {
      map[y.year] = { v: y.principal_maturing_usd_b, note: y.principal_maturing_note || null,
        gross: y.gross_raised_usd_b, wa_yield: y.wa_yield_new_issues_pct, debt: y.year_end_total_debt_usd_b };
    }
  });
  return { map: map, fwd: fwd };
}
function ladderData(c) {
  var ml = c && c.maturity_ladder;
  if (!ml || ml.status === "UNAVAILABLE") return { status: "UNAVAILABLE", reason: (ml && ml.reason) || "No maturity schedule disclosed." };
  function pick() { for (var i = 0; i < arguments.length; i++) if (arguments[i] != null) return arguments[i]; return null; }
  var pm = ml.principal_maturing_usd_b || {};
  var yrs = ["2027", "2028", "2029", "2030", "2031"].map(function (y) { return { y: y, v: pm[y] == null ? null : +pm[y] }; });
  var thereafter = pick(ml.thereafter_total_usd_b, pm.thereafter_total);
  var cum = ml.cumulative_maturities_pct_of_total_debt || null;
  var cumB = ml.cumulative_maturities_usd_b || null;
  var cashPlus = pick(ml.cash_plus_facilities_usd_b, ml.cash_plus_facilities_at_schedule_date_usd_b);
  var facilities = ml.committed_facilities_usd_b;
  var cash = pick(ml.cash_and_equivalents_usd_b, (cashPlus != null && facilities != null) ? Math.round((cashPlus - facilities) * 1000) / 1000 : null);
  if (cashPlus == null && cash != null && facilities != null) cashPlus = Math.round((cash + facilities) * 1000) / 1000;
  var li = ml.largest_single_instrument, liName = null, liAmt = null;
  if (li && typeof li === "object") { liName = li.name || null; liAmt = li.principal_usd_b; }
  else { liName = li || null; liAmt = ml.largest_single_instrument_usd_b; }
  return {
    status: "OK", schedule_date: ml.schedule_date || null,
    accession: ml.accession || ml.source_accession || accOf(ml.schedule_source) || null,
    years: yrs, thereafter: thereafter,
    basis: pick(ml.total_debt_at_schedule_date_usd_b, ml.total_debt_basis_usd_b, ml.total_debt_usd_b),
    m12: pick(ml.maturing_12m_usd_b, cumB && cumB["12m"], ml.maturities_12m_usd_b, pm.maturing_12m),
    m24: pick(ml.maturing_24m_usd_b, cumB && cumB["24m"], ml.maturities_24m_usd_b),
    m3y: pick(ml.maturing_3y_usd_b, cumB && cumB["3y"], ml.maturities_3y_usd_b),
    p12: pick(ml.pct_of_total_debt_12m, cum && cum["12m"], ml.maturities_12m_pct_of_total_debt),
    p24: pick(ml.pct_of_total_debt_24m, cum && cum["24m"], ml.maturities_24m_pct_of_total_debt),
    p3y: pick(ml.pct_of_total_debt_3y, cum && cum["3y"], ml.maturities_3y_pct_of_total_debt),
    largest_year: ml.largest_maturity_year, largest_amt: pick(ml.largest_maturity_amount_usd_b, ml.largest_maturity_year_usd_b),
    li_name: liName, li_amt: liAmt,
    facilities: facilities, cash: cash, cash_plus_fac: cashPlus,
    unfunded12: ml.unfunded_maturities_12m_usd_b, gap24: ml.refinancing_gap_24m_usd_b,
    notes: ml.notes || null, method: ml.method || ml.refinancing_gap_24m_method || null,
    schedule_total: ml.schedule_total_usd_b || null
  };
}
function flagsOf(c) {
  var s = (c && c.warning_flags_summary) || {};
  function one(k) { var f = s[k] || {}; return { flag: f.flag == null ? null : !!f.flag, detail: f.detail || "" }; }
  return { refinancing_risk: one("refinancing_risk"), rising_cost_of_debt: one("rising_cost_of_debt"), cash_flow_stress: one("cash_flow_stress"), leverage_deterioration: one("leverage_deterioration") };
}
/* ---------- Disclosed vs blended existing-debt rate (user decision: take the disclosed number).
   wa_interest_rate_existing_debt_pct mixes two bases in the dataset; wa_rate_method is the
   ground truth. DISCLOSED = built from the debt note's disclosed effective rates (debt-note
   disclosed, face-weighted from the note, or amount-weighted from disclosed tranche rates).
   BLENDED = computed as interest expense ÷ average total debt, or an estimate on that basis —
   never the existing-debt rate. OTHER = a rate that is neither (e.g. a principal-weighted
   coupon average, which is a coupon, not an effective rate) — also never the existing-debt rate.
   A rate whose method is unrecognised is never treated as disclosed (fail closed). */
function rateBasis(r) {
  if (!r || r.wa_rate == null) return "none";
  var m = (r.wa_rate_method || "").toLowerCase();
  if (m.indexOf("blended") === 0 || m.indexOf("estimate") === 0) return "blended";
  if (m.indexOf("debt-note") === 0 || m.indexOf("face-weighted") === 0 || m.indexOf("computed, amount-weighted disclosed") === 0) return "disclosed";
  return "other";
}
function rateIsDisclosed(r) { return rateBasis(r) === "disclosed"; }
function latestDiscRateRow(c) {
  /* Latest FISCAL-YEAR row carrying a disclosed debt-note WA rate. TTM rows are excluded:
     the debt-note WA is a fiscal-year-end disclosure; a TTM rate is a carry-forward or a
     recomputation, not a disclosed note rate. */
  var p = profRows(c);
  if (p.status !== "OK") return null;
  var best = null;
  p.rows.forEach(function (r) {
    if (r.kind === "actual" && rateIsDisclosed(r) && (!best || +r.year > +best.year)) best = r;
  });
  return best;
}
function latestBlendRateRow(c) {
  /* Latest row (TTM first) carrying a blended effective rate — for the labelled computed
     secondary line only, never for a differential, flag or base rate. */
  var p = profRows(c);
  if (p.status !== "OK") return null;
  var best = null, bestKey = -1;
  p.rows.forEach(function (r) {
    if (rateBasis(r) !== "blended") return;
    var k = r.kind === "ttm" ? 10000 : +r.year;
    if (k > bestKey) { bestKey = k; best = r; }
  });
  return best;
}
function latestYieldCal(c) {
  /* Latest WA yield on new issues, from the calendar-year raises (v1 annual_chart) — the
     latest issuance period. The profile's yield can be stale: e.g. Microsoft's $25B Oct 2026
     offering is calendar-2026 but FY2027, so no profile row carries it yet. */
  var mh = maturingHist(c), best = null;
  Object.keys(mh.map).forEach(function (y) {
    var v = mh.map[y].wa_yield;
    if (v != null && (best == null || +y > +best.year)) best = { year: y, v: +v };
  });
  return best;
}
function disclosedDiff(c) {
  /* The single differential, from the disclosed rate only: latest calendar-year new-issue
     yield minus the latest fiscal-year disclosed debt-note WA rate. Null when either side
     is missing — never computed from a blended rate. */
  var rate = latestDiscRateRow(c), yld = latestYieldCal(c);
  if (!rate || !yld) return { diff: null, rate: rate, yld: yld };
  return { diff: Math.round((yld.v - rate.wa_rate) * 100), rate: rate, yld: yld };
}
/* ---------- Warning-flag evidence as plain-English lines, never a raw JSON object.
   The summary detail strings carry a leading JSON object of supporting numbers, then
   " | " + the rule/basis text. Parse the object out and render each entry as a labelled
   line; a detail with no JSON prefix is rendered as plain text. An object may be passed
   directly (synthesised evidence). */
var EVID_LABELS = {
  maturities_12m_usd_b: "12M maturities", cash_usd_b: "Cash", committed_facilities_usd_b: "Committed facilities",
  cash_plus_facilities_usd_b: "Cash + committed facilities",
  wa_yield_new_issues_pct: "WA yield on new issues", wa_rate_existing_debt_pct: "WA rate on existing debt",
  differential_bps: "Differential", differential_bps_ttm_basis: "Differential (TTM basis)",
  fcf_ttm_usd_b: "FCF (TTM)", fcf_usd_b: "FCF", debt_service_12m_usd_b: "12M debt service",
  total_debt_service_usd_b: "Total debt service", interest_expense_ttm_usd_b: "Interest expense (TTM)",
  interest_expense_usd_b: "Interest expense", principal_due_12m_usd_b: "Principal due in 12M",
  principal_due_usd_b: "Principal due", total_debt_growth_3y_pct: "Total debt growth (3Y)",
  ocf_growth_3y_pct: "OCF growth (3Y)",
  debt_fy2023_usd_b: "Total debt FY2023", debt_fy2026_usd_b: "Total debt FY2026",
  debt_fy2025_usd_b: "Total debt FY2025", debt_2022_usd_b: "Total debt 2022", debt_2025_usd_b: "Total debt 2025",
  ocf_fy2023_usd_b: "OCF FY2023", ocf_fy2026_usd_b: "OCF FY2026", ocf_2022_usd_b: "OCF 2022", ocf_2025_usd_b: "OCF 2025"
};
function evidLabel(k) {
  if (EVID_LABELS[k]) return EVID_LABELS[k];
  var s = k.replace(/_usd_b$/, " ($B)").replace(/_pct$/, " (%)").replace(/_bps$/, " (bps)").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function evidVal(k, v) {
  if (typeof v !== "number") return String(v);
  if (/_bps$/.test(k)) return (v >= 0 ? "+" : "") + v + " bps";
  if (/_pct$/.test(k)) return v.toFixed(2) + "%";
  if (/_usd_b$/.test(k)) return fmtSignedB(v);
  return String(v);
}
function evidenceHTML(detail) {
  if (detail == null || detail === "") return "";
  var lines = [];
  function addObj(obj) {
    Object.keys(obj).forEach(function (k) {
      if (k === "note") return;
      lines.push("<div>" + esc(evidLabel(k)) + ": <b>" + esc(evidVal(k, obj[k])) + "</b></div>");
    });
    if (obj.note) lines.push("<div>" + esc(obj.note) + "</div>");
  }
  if (typeof detail === "object") {
    addObj(detail);
    return lines.length ? '<div class="ad-fl-d">' + lines.join("") + "</div>" : "";
  }
  var s = String(detail);
  if (s.charAt(0) === "{") {
    var depth = 0, inStr = false, esc2 = false, end = -1;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inStr) { if (esc2) esc2 = false; else if (ch === "\\") esc2 = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > 0) {
      var obj = null;
      try { obj = JSON.parse(s.slice(0, end + 1)); } catch (e) { obj = null; }
      if (obj && typeof obj === "object") {
        addObj(obj);
        var rest = s.slice(end + 1).replace(/^\s*\|\s*/, "");
        if (rest) lines.push("<div>" + esc(rest) + "</div>");
        return '<div class="ad-fl-d">' + lines.join("") + "</div>";
      }
    }
  }
  return '<div class="ad-fl-d">' + esc(s) + "</div>";
}
function numFromDetail(detail, key) {
  if (!detail) return null;
  var m = String(detail).match(new RegExp('"' + key + '"\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)'));
  return m ? +m[1] : null;
}
function cfFlags(c) {
  var f = c && c.cash_flow_flags;
  if (!f) return { status: "NONE", items: [] };
  if (f.status === "UNAVAILABLE") return { status: "UNAVAILABLE", reason: f.reason || "No cash-flow statement filed.", items: [] };
  var items = [];
  function add(label, value, note) { items.push({ label: label, value: value, note: note || null }); }
  add("Working capital — cash impact", f.working_capital_cash_impact_usd_b == null ? null : fmtSignedB(f.working_capital_cash_impact_usd_b), f.working_capital_note || null);
  add("Supplier / supply-chain financing", null, f.supplier_financing_text || f.supplier_financing_note || null);
  add("Material lease payments", null, f.material_lease_payments || null);
  add("Restructuring / litigation cash charges", null, f.restructuring_litigation_cash_charges || null);
  add("Acquisitions / divestitures", null, f.acquisitions_divestitures || null);
  add("Restricted cash", f.restricted_cash_usd_b == null ? null : fmtB(f.restricted_cash_usd_b), f.restricted_cash_note || null);
  add("Pension / unfunded obligations", null, f.pension_unfunded_obligations || null);
  if (f.other) add("Other", null, f.other);
  return { status: "OK", period: f.period_end || null, accession: f.accession || null, fiscal_year: f.fiscal_year || null, items: items };
}
function currencyMix(co) {
  /* Currency mix of debt RAISED (included raises only, ai-debt.json) — not the currency mix of
     outstanding debt, which is not disclosed in the filings. */
  var tot = 0, by = {};
  (D.rows || []).forEach(function (r) {
    if (r.company !== co || r.include_in_total === false || r.amount_usd_b == null) return;
    by[r.currency] = (by[r.currency] || 0) + r.amount_usd_b; tot += r.amount_usd_b;
  });
  var out = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (cur) {
    return { cur: cur, amt: Math.round(by[cur] * 1000) / 1000, pct: tot ? Math.round(by[cur] / tot * 1000) / 10 : null };
  });
  return { total: Math.round(tot * 1000) / 1000, mix: out };
}
function warnHTML() {
  var c = enh();
  if (!c) return "";
  var ds = c.debt_service || {};
  var t = ds.ttm || {};
  var ttm = profTTM(c);
  var lad = ladderData(c);
  var fl = flagsOf(c);
  var isAnth = F.co === "Anthropic";
  var totDebt = isAnth ? t.total_debt_principal_usd_b : t.total_debt_usd_b;
  if (totDebt == null && ttm) totDebt = ttm.total_debt;
  var ndEbitda = ttm ? ttm.ndtebitda : null;
  var m12 = lad.status === "OK" ? lad.m12 : ds.principal_maturing_12m_usd_b;
  /* Existing-debt rate = DISCLOSED debt-note WA only (latest fiscal year); latest yield =
     latest calendar-year WA yield on new issues (the latest issuance period). The blended
     effective rate is never the existing-debt rate. */
  var dd = disclosedDiff(c);
  var latestYield = dd.yld ? dd.yld.v : null, latestRate = dd.rate ? dd.rate.wa_rate : null;
  var latestYieldLbl = dd.yld ? "calendar " + dd.yld.year : null;
  var latestRateLbl = dd.rate ? "FY" + dd.rate.year : null;
  /* Rising-cost flag is recomputed from the disclosed rate only — the dataset's boolean was
     built on blended rates for some companies. No disclosed rate or no yield => N/A. */
  if (dd.rate == null || dd.yld == null) {
    fl.rising_cost_of_debt = { flag: null, detail: (dd.rate == null ? "No disclosed debt-note WA rate for this company — the rates in the dataset are blended effective rates (interest expense ÷ average total debt), which are never used for the differential." : "No new-issue yield in the latest period.") + (dd.yld ? " Latest WA yield on new issues: " + dd.yld.v.toFixed(2) + "% (calendar " + dd.yld.year + ")." : "") + (dd.rate ? " Latest disclosed existing-debt rate: " + dd.rate.wa_rate.toFixed(2) + "% (FY" + dd.rate.year + ")." : "") };
  } else {
    fl.rising_cost_of_debt = { flag: dd.diff > 100, detail: { wa_yield_new_issues_pct: dd.yld.v, wa_rate_existing_debt_pct: dd.rate.wa_rate, differential_bps: dd.diff, note: "Rule: WA yield on new issues exceeds WA rate on existing debt by >100 bps. Yield is the latest issuance period (calendar " + dd.yld.year + "); rate is the latest fiscal-year debt-note WA (FY" + dd.rate.year + ", " + (dd.rate.wa_rate_method || "debt-note disclosed") + ")." } };
  }
  var ocfDS = (t.operating_cash_flow_usd_b != null && ds.debt_service_12m_usd_b) ? t.operating_cash_flow_usd_b / ds.debt_service_12m_usd_b : null;
  var cashFac = lad.status === "OK" ? lad.cash_plus_fac : null;
  if (cashFac == null && t.cash_and_equivalents_usd_b != null) cashFac = t.cash_and_equivalents_usd_b;
  var tiles = '<div class="ad-kpi">' +
    kpi("Total consolidated debt", fmtB(totDebt), (isAnth ? "Principal outstanding (TTM)" : "Carrying, TTM") + " · period ended " + (t.period_end || "—")) +
    kpi("Net debt / EBITDA", ndEbitda == null ? "—" : fmtX(ndEbitda), "TTM · EBITDA = operating income + D&A") +
    kpi("Next 12-month maturities", fmtB(m12), lad.status === "OK" ? "Principal due in the next 12 months" : "From the debt-service panel") +
    kpi("WA yield on new debt", fmtPct(latestYield), (latestYieldLbl || "—") + " · amount-weighted") +
    kpi("OCF / debt service", ocfDS == null ? "—" : fmtX(ocfDS), "TTM OCF ÷ 12M debt service (interest + principal)") +
    kpi("Cash + available facilities", fmtB(cashFac), lad.status === "OK" ? "Liquidity buffer at the schedule date" : "Cash & equivalents (TTM)") +
    "</div>";
  function flagChip(label, rule, f, support) {
    var word = f.flag === null ? "N/A" : (f.flag ? "TRIGGERED" : "CLEAR");
    var cls = f.flag === null ? "ad-fl-na" : (f.flag ? "ad-fl-on" : "ad-fl-off");
    return '<div class="ad-flag ' + cls + '"><div class="ad-fl-h"><span class="ad-fl-t">' + label + '</span><span class="ad-fl-w">' + word + '</span></div>' +
      '<div class="ad-fl-r">' + rule + '</div>' +
      '<div class="ad-fl-s">' + support + '</div>' +
      evidenceHTML(f.detail) + "</div>";
  }
  var diffBps = dd.diff;
  var cfFcf = numFromDetail(fl.cash_flow_stress.detail, "fcf_ttm_usd_b");
  var cfDs = numFromDetail(fl.cash_flow_stress.detail, "debt_service_12m_usd_b");
  var levDebt = numFromDetail(fl.leverage_deterioration.detail, "total_debt_growth_3y_pct");
  var levOcf = numFromDetail(fl.leverage_deterioration.detail, "ocf_growth_3y_pct");
  var refM12 = numFromDetail(fl.refinancing_risk.detail, "maturities_12m_usd_b");
  var refCpf = numFromDetail(fl.refinancing_risk.detail, "cash_plus_facilities_usd_b");
  var flags = '<div class="ad-flags">' +
    flagChip("Refinancing risk", "Triggers when 12M maturities &gt; cash + committed facilities.", fl.refinancing_risk,
      (refM12 != null && refCpf != null) ? ("12M maturities " + fmtB(refM12) + " vs cash + facilities " + fmtB(refCpf)) : (m12 != null ? "12M maturities " + fmtB(m12) + " · cash + facilities " + fmtB(cashFac) : "—")) +
    flagChip("Rising cost of debt", "Triggers when the WA yield on new issues exceeds the WA rate on existing debt by &gt;100 bps.", fl.rising_cost_of_debt,
      diffBps == null ? "Differential not computable for the latest period — no disclosed debt-note WA rate" : ("Differential " + (diffBps >= 0 ? "+" : "") + diffBps + " bps" + (latestYield != null && latestRate != null ? " · new " + latestYield.toFixed(2) + "% (" + latestYieldLbl + ") vs existing " + latestRate.toFixed(2) + "% (" + latestRateLbl + ", debt-note disclosed)" : ""))) +
    flagChip("Cash-flow stress", "Triggers when FCF &lt; total debt service (interest + principal due) in the latest period.", fl.cash_flow_stress,
      (cfFcf != null && cfDs != null) ? ("FCF " + fmtSignedB(cfFcf) + " vs debt service " + fmtB(cfDs)) : ("TTM FCF " + fmtSignedB(t.free_cash_flow_usd_b) + " vs 12M debt service " + fmtB(ds.debt_service_12m_usd_b))) +
    flagChip("Leverage deterioration", "Triggers when total debt grew faster than OCF over the last 3 years.", fl.leverage_deterioration,
      (levDebt != null && levOcf != null) ? ("Debt " + (levDebt >= 0 ? "+" : "") + levDebt.toFixed(1) + "% vs OCF " + (levOcf >= 0 ? "+" : "") + levOcf.toFixed(1) + "% over 3 years") : "3-year comparison not computable for this company") +
    "</div>";
  return '<section class="ad-sec"><h2>Key risk indicators <span class="ad-sec-sub">rule-based warning flags — thresholds stated, supporting numbers shown, never an opinion without evidence</span></h2>' +
    tiles + flags + "</section>";
}

function yearTip(r, mat) {
  /* Section 7 tooltip: every field for the year, plus source + date. */
  var parts = [];
  var lbl = r.kind === "ttm" ? "TTM (ended " + (r.period_end || "—") + ")" : "FY" + r.year + " (ended " + (r.period_end || "—") + ")";
  parts.push(lbl);
  parts.push("Closing debt " + fmtB(r.total_debt) + (r.yoy != null ? " (" + (r.yoy >= 0 ? "+" : "") + r.yoy.toFixed(1) + "% YoY)" : ""));
  parts.push("ST " + fmtB(r.st) + " / LT " + fmtB(r.lt));
  parts.push("Gross raised (calendar-year) " + fmtB(r.gross_raised));
  parts.push("Principal repaid " + fmtB(r.principal_repaid));
  if (mat) parts.push("Maturing (calendar, partial lower bound) " + fmtB(mat.v));
  parts.push((r.wa_rate == null ? "WA rate existing —" : (rateIsDisclosed(r) ? "WA rate existing (disclosed) " + fmtPct(r.wa_rate) : "WA rate existing — blended (computed) " + fmtPct(r.wa_rate))) + " · WA yield new " + fmtPct(r.wa_yield));
  parts.push("Interest expense " + fmtB(r.interest_expense));
  parts.push("OCF " + fmtB(r.ocf) + " / CAPEX " + fmtB(r.capex) + " / FCF " + fmtSignedB(r.fcf));
  parts.push("Cash " + fmtB(r.cash) + " · Net debt/EBITDA " + (r.ndtebitda == null ? "—" : fmtX(r.ndtebitda)));
  if (r.accession) parts.push("Source: accession " + r.accession + " · period ended " + (r.period_end || "—"));
  return parts.join(" · ");
}
function profileHTML() {
  var c = enh();
  if (!c) return "";
  var head = '<section class="ad-sec"><h2>01 · Annual debt profile <span class="ad-sec-sub">fiscal years — closing debt, flows and cost · balances and flows are separate panels, never stacked together</span></h2>';
  var p = profRows(c);
  if (p.status === "UNAVAILABLE") {
    var compRows = "";
    if (p.compByYear) {
      var yrs = Object.keys(p.compByYear).sort();
      compRows = yrs.map(function (y) {
        var b = p.compByYear[y] || {};
        return "<tr><td>" + y + "</td><td>calendar-year raises only</td><td>" + fmtB(b.bonds) + "</td><td>" + fmtB(b.bank) + "</td><td>" + fmtB(b.cp) + "</td><td>" + fmtB(b.other) + "</td></tr>";
      }).join("");
    }
    return head + '<div class="ad-note">' + esc(p.reason) + '</div>' +
      (p.form_d ? '<div class="ad-note">Form D filings: ' + esc(p.form_d.join(" · ")) + '</div>' : "") +
      (compRows ? '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Year</th><th>Basis</th><th>Bonds</th><th>Bank borrowings</th><th>Commercial paper</th><th>Other</th></tr></thead><tbody>' + compRows + '</tbody></table></div>' +
        '<div class="ad-note">' + esc(p.compNote || "Borrowing composition from the raises file (included rows only) — the only verified figures for this company.") + '</div>' : "") +
      "</section>";
  }
  var rows = p.rows;
  if (F.yr) rows = rows.filter(function (r) { return r.kind === "actual" && r.period_end && String(r.period_end).slice(0, 4) === F.yr; });
  if (!rows.length) return head + '<div class="ad-note">No fiscal-year profile row ends in ' + esc(F.yr) + ' for this company — tap All on the ruler to see every fiscal year and the TTM.</div></section>';
  var mh = maturingHist(c);
  var fyEnd = c.fiscal_year_end || (rows.length && rows[0].period_end) || "—";
  var fyEndMD = (function () { if (!fyEnd || fyEnd === "—") return "—"; var pp = String(fyEnd).split("-"); return MON[+pp[1] - 1] + " " + (+pp[2]); })();
  var basisNote = "Fiscal years — the FY label is the fiscal year ending in that calendar year (this company\u2019s fiscal year ends " + esc(fyEndMD) + "; e.g. Oracle FY2026 ended May 31, 2026, Microsoft FY2026 ended Jun 30, 2026, NVIDIA FY2026 ended Jan 25, 2026). " +
    "Gross raised is on a CALENDAR-year basis (issue month in the raises file) and is labelled as such — the same offering can fall in different buckets, so do not read the gross-raised bar as a fiscal-year figure. " +
    "Gross issuance is not the same as the increase in debt: if a company raises $20B but repays $15B, its net debt increase is about $5B before other adjustments — the net change label above each bar is the change in the year-end balance. " +
    "Historical maturing principal is a partial lower bound (raises with a stated maturity year only), calendar-year basis.";
  /* --- SVG 1: balances — closing debt stacked ST+LT, net debt line, net change label --- */
  var W = 800, n = rows.length, x0 = 46, x1 = 794, base = 168, top = 12;
  var slot = (x1 - x0) / n, barW = Math.min(58, slot * 0.52);
  var maxV = 1;
  rows.forEach(function (r) { if (r.total_debt != null && r.total_debt > maxV) maxV = r.total_debt; });
  maxV *= 1.12;
  function Y(v) { return Math.round(base - (v / maxV) * (base - top)); }
  function CX(i) { return Math.round(x0 + slot * (i + 0.5)); }
  var svg1 = '<svg class="ad-svg" viewBox="0 0 800 212" role="img" aria-label="Closing total debt by fiscal year, stacked short-term and long-term, with net debt line">';
  svg1 += '<line x1="' + x0 + '" y1="' + base + '" x2="' + x1 + '" y2="' + base + '" stroke="var(--line2)" stroke-width="1"/>';
  svg1 += '<line x1="' + x0 + '" y1="' + Y(maxV / 2) + '" x2="' + x1 + '" y2="' + Y(maxV / 2) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>';
  svg1 += '<text x="4" y="' + (Y(maxV / 2) + 4) + '" font-size="10" fill="var(--faint)">$' + (maxV / 2).toFixed(0) + 'B</text>';
  svg1 += '<text x="4" y="' + (base - 4) + '" font-size="10" fill="var(--faint)">0</text>';
  var prevDebt = null, netPts = [];
  rows.forEach(function (r, i) {
    var cx = CX(i), x = Math.round(cx - barW / 2);
    var tip = yearTip(r, mh.map[r.year]);
    svg1 += '<rect x="' + Math.round(cx - slot / 2 + 2) + '" y="' + top + '" width="' + Math.round(slot - 4) + '" height="' + (base - top) + '" fill="transparent"><title>' + esc(tip) + '</title></rect>';
    if (r.total_debt != null) {
      var lt = r.lt != null ? r.lt : r.total_debt, st = r.st != null ? r.st : 0;
      var ltH = Math.max(2, Math.round(lt / maxV * (base - top)));
      var stH = st > 0 ? Math.max(2, Math.round(st / maxV * (base - top))) : 0;
      svg1 += '<rect x="' + x + '" y="' + (base - ltH) + '" width="' + Math.round(barW) + '" height="' + ltH + '" fill="#38b6c9"><title>' + esc("Long-term debt " + fmtB(r.lt) + " · " + tip) + '</title></rect>';
      if (stH > 0) svg1 += '<rect x="' + x + '" y="' + (base - ltH - stH) + '" width="' + Math.round(barW) + '" height="' + stH + '" fill="#7dd3fc"><title>' + esc("Short-term debt " + fmtB(r.st) + " · " + tip) + '</title></rect>';
      var d = prevDebt != null ? r.total_debt - prevDebt : null;
      var dTxt = d == null ? "—" : ((d >= 0 ? "+" : "−") + "$" + Math.abs(d).toFixed(2) + "B" + (r.yoy != null ? " (" + (r.yoy >= 0 ? "+" : "") + r.yoy.toFixed(1) + "%)" : ""));
      svg1 += '<text x="' + cx + '" y="' + Math.max(10, Y(r.total_debt) - 6) + '" text-anchor="middle" font-size="10" fill="var(--ink)">' + esc(dTxt) + '</text>';
      svg1 += '<text x="' + cx + '" y="' + (base + 14) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + '</text>';
      svg1 += '<text x="' + cx + '" y="' + (base + 27) + '" text-anchor="middle" font-size="9" fill="var(--faint)">' + esc(r.period_end || "") + '</text>';
      if (r.net_debt != null) netPts.push({ i: i, v: r.net_debt });
      prevDebt = r.total_debt;
    } else {
      svg1 += '<rect x="' + x + '" y="' + (base - 24) + '" width="' + Math.round(barW) + '" height="24" fill="transparent" stroke="var(--line2)" stroke-dasharray="3 3"><title>' + esc(tip) + '</title></rect>';
      svg1 += '<text x="' + cx + '" y="' + (base - 8) + '" text-anchor="middle" font-size="11" fill="var(--faint)">—</text>';
      svg1 += '<text x="' + cx + '" y="' + (base + 14) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + '</text>';
      svg1 += '<text x="' + cx + '" y="' + (base + 27) + '" text-anchor="middle" font-size="9" fill="var(--faint)">' + esc(r.period_end || "") + '</text>';
    }
  });
  if (netPts.length > 1) {
    var pts = netPts.map(function (pt) { return CX(pt.i) + "," + Y(pt.v); }).join(" ");
    svg1 += '<polyline points="' + pts + '" fill="none" stroke="#f59e0b" stroke-width="2" vector-effect="non-scaling-stroke"/>';
  }
  netPts.forEach(function (pt) {
    svg1 += '<circle cx="' + CX(pt.i) + '" cy="' + Y(pt.v) + '" r="4.5" fill="#f59e0b" stroke="#0a0f16" stroke-width="1.5" vector-effect="non-scaling-stroke"><title>Net debt ' + fmtB(pt.v) + ' (total debt less cash &amp; equivalents)</title></circle>';
    svg1 += '<text x="' + CX(pt.i) + '" y="' + Math.max(10, Y(pt.v) - 8) + '" text-anchor="middle" font-size="10" fill="#f59e0b">' + fmtB(pt.v) + '</text>';
  });
  svg1 += "</svg>";
  var leg1 = '<div class="ad-leg"><span><i class="sw" style="background:#38b6c9"></i>Closing debt — long-term</span><span><i class="sw" style="background:#7dd3fc"></i>Closing debt — short-term</span><span><i class="sw" style="background:#f59e0b;border-radius:50%!important"></i>Net debt (total debt − cash)</span><span>Label above each bar: net change in the year-end balance ($B and YoY %)</span></div>';
  /* --- SVG 2: flows — gross raised (+), principal repaid (−), maturing (+) --- */
  var fBase = 72, fTop = 8, fH = 150;
  var fMax = 1;
  rows.forEach(function (r) {
    [r.gross_raised, r.principal_repaid].forEach(function (v) { if (v != null && v > fMax) fMax = v; });
    var m = mh.map[r.year]; if (m && m.v != null && m.v > fMax) fMax = m.v;
  });
  fMax *= 1.15;
  function FY(v) { return Math.round(fBase - (v / fMax) * (fBase - fTop)); }
  function FYd(v) { return Math.round(fBase + (v / fMax) * (fBase - fTop)); }
  var svg2 = '<svg class="ad-svg" viewBox="0 0 800 152" role="img" aria-label="Annual debt flows by fiscal year: gross raised, principal repaid, maturing principal">';
  svg2 += '<line x1="' + x0 + '" y1="' + fBase + '" x2="' + x1 + '" y2="' + fBase + '" stroke="var(--line2)" stroke-width="1"/>';
  rows.forEach(function (r, i) {
    var cx = CX(i), bw = Math.min(20, slot * 0.2);
    var m = mh.map[r.year];
    function fbar(v, off, fill, dash, title) {
      if (v == null) return '<text x="' + Math.round(cx + off) + '" y="' + (fBase - 4) + '" text-anchor="middle" font-size="10" fill="var(--faint)">—</text>';
      var h = Math.max(2, Math.round(v / fMax * (fBase - fTop)));
      return '<rect x="' + Math.round(cx + off - bw / 2) + '" y="' + (fBase - h) + '" width="' + Math.round(bw) + '" height="' + h + '" fill="' + fill + '"' + (dash ? ' stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4 3"' : "") + '><title>' + esc(title) + '</title></rect>' +
        '<text x="' + Math.round(cx + off) + '" y="' + Math.max(10, fBase - h - 4) + '" text-anchor="middle" font-size="9" fill="var(--muted)">' + (+v).toFixed(1) + '</text>';
    }
    function fbarDown(v, off, fill, title) {
      if (v == null) return "";
      var h = Math.max(2, Math.round(v / fMax * (fBase - fTop)));
      return '<rect x="' + Math.round(cx + off - bw / 2) + '" y="' + fBase + '" width="' + Math.round(bw) + '" height="' + h + '" fill="' + fill + '"><title>' + esc(title) + '</title></rect>' +
        '<text x="' + Math.round(cx + off) + '" y="' + Math.min(148, fBase + h + 11) + '" text-anchor="middle" font-size="9" fill="var(--muted)">−' + (+v).toFixed(1) + '</text>';
    }
    svg2 += fbar(r.gross_raised, -slot * 0.26, "#3b82f6", false, "Gross debt raised (calendar-year) " + fmtB(r.gross_raised));
    svg2 += fbarDown(r.principal_repaid, 0, "#e0453a", "Principal repaid (fiscal year) " + fmtB(r.principal_repaid));
    svg2 += fbar(m ? m.v : null, slot * 0.26, "rgba(245,158,11,.35)", true, "Principal maturing (calendar-year, partial lower bound) " + fmtB(m ? m.v : null));
    svg2 += '<text x="' + cx + '" y="146" text-anchor="middle" font-size="11" fill="var(--muted)">' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + '</text>';
  });
  svg2 += "</svg>";
  var leg2 = '<div class="ad-leg"><span><i class="sw" style="background:#3b82f6"></i>Gross debt issued (calendar-year raises)</span><span><i class="sw" style="background:#e0453a"></i>Principal repaid (fiscal year, negative bar)</span><span><i class="sw" style="background:rgba(245,158,11,.35);border:1.5px dashed #f59e0b"></i>Debt maturing (calendar-year, partial lower bound)</span></div>';
  /* --- SVG 3: cost — WA rate existing vs WA yield new (%, synchronised axis) --- */
  var yMax = 1;
  rows.forEach(function (r) { [r.wa_rate, r.wa_yield].forEach(function (v) { if (v != null && v > yMax) yMax = v; }); });
  yMax = Math.ceil(yMax);
  var cBase = 78, cTop = 8;
  function CY(v) { return Math.round(cBase - (v / yMax) * (cBase - cTop)); }
  function linePts(key) {
    var pts = [];
    rows.forEach(function (r, i) { if (r[key] != null) pts.push({ i: i, v: +r[key] }); });
    return pts;
  }
  function linePtsVal(fn) {
    var pts = [];
    rows.forEach(function (r, i) { var v = fn(r); if (v != null) pts.push({ i: i, v: +v }); });
    return pts;
  }
  function drawLine(pts, color, dash) {
    if (!pts.length) return "";
    var out = "";
    for (var s = 0; s < pts.length - 1; s++) {
      if (pts[s + 1].i === pts[s].i + 1) out += '<line x1="' + CX(pts[s].i) + '" y1="' + CY(pts[s].v) + '" x2="' + CX(pts[s + 1].i) + '" y2="' + CY(pts[s + 1].v) + '" stroke="' + color + '" stroke-width="2" vector-effect="non-scaling-stroke"' + (dash ? ' stroke-dasharray="5 4"' : "") + '/>';
    }
    pts.forEach(function (pt) {
      out += '<circle cx="' + CX(pt.i) + '" cy="' + CY(pt.v) + '" r="4.5" fill="' + color + '" stroke="#0a0f16" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
      out += '<text x="' + CX(pt.i) + '" y="' + Math.max(10, CY(pt.v) - 7) + '" text-anchor="middle" font-size="10" fill="' + color + '">' + pt.v.toFixed(2) + '%</text>';
    });
    return out;
  }
  var svg3 = '<svg class="ad-svg" viewBox="0 0 800 104" role="img" aria-label="Weighted-average interest rate on existing debt and weighted-average yield on newly issued debt">';
  svg3 += '<line x1="' + x0 + '" y1="' + cBase + '" x2="' + x1 + '" y2="' + cBase + '" stroke="var(--line2)" stroke-width="1"/>';
  svg3 += '<text x="4" y="' + (CY(yMax / 2) + 4) + '" font-size="10" fill="var(--faint)">' + (yMax / 2).toFixed(0) + '%</text>';
  /* Existing-debt rate line = DISCLOSED debt-note rates only; blended effective rates get
     their own dashed computed line, never presented as the existing-debt rate. */
  svg3 += drawLine(linePtsVal(function (r) { return rateIsDisclosed(r) ? r.wa_rate : null; }), "#38b6c9") +
    drawLine(linePtsVal(function (r) { return rateBasis(r) === "blended" ? r.wa_rate : null; }), "#94a3b8", true) +
    drawLine(linePts("wa_yield"), "#f59e0b");
  rows.forEach(function (r, i) { svg3 += '<text x="' + CX(i) + '" y="98" text-anchor="middle" font-size="11" fill="var(--muted)">' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + '</text>'; });
  svg3 += "</svg>";
  var leg3 = '<div class="ad-leg"><span><i class="sw" style="background:#38b6c9"></i>WA interest rate — existing debt (disclosed, debt-note)</span><span><i class="sw" style="background:#94a3b8"></i>Blended effective rate (computed)</span><span><i class="sw" style="background:#f59e0b"></i>WA yield — new debt issued</span><span>Lines break where a year discloses no rate / yield — nothing is interpolated. The blended line is interest expense ÷ average total debt, computed — never the existing-debt rate.</span></div>';
  /* --- Interest expense strip (HTML bars, $B) --- */
  var ieMax = 1;
  rows.forEach(function (r) { if (r.interest_expense != null && r.interest_expense > ieMax) ieMax = r.interest_expense; });
  var ieBars = rows.map(function (r) {
    var h = r.interest_expense == null ? 2 : Math.max(6, Math.round(r.interest_expense / ieMax * 100));
    return '<div class="ad-bar" title="' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + ": interest expense " + fmtB(r.interest_expense) + '"><div class="n">' + (r.interest_expense == null ? "—" : fmtB(r.interest_expense)) + '</div><div class="b" style="height:' + h + '%;background:#64748b"></div><div class="l">' + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + "</div></div>";
  }).join("");
  var ieStrip = '<div class="ad-bars-h">Annual interest expense — $B (actual reported expense)</div><div class="ad-bars" style="height:96px">' + ieBars + "</div>";
  /* --- Tables --- */
  function cell(v, title) { return v == null ? '<span title="' + esc(title || "Not disclosed / not verified — see the unavailable list below") + '">—</span>' : fmtB(v); }
  function cellPct(v) { return v == null ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(1) + "%"; }
  var tA = rows.map(function (r, i) {
    var prev = null;
    for (var j = i - 1; j >= 0; j--) if (rows[j].kind === "actual" && rows[j].total_debt != null) { prev = rows[j]; break; }
    var d = (r.total_debt != null && prev) ? r.total_debt - prev.total_debt : null;
    var kindTag = r.kind === "ttm" ? '<span class="ad-k-tag ad-k-est">TTM</span>' : (r.kind === "actual" ? '<span class="ad-k-tag ad-k-act">actual</span>' : '<span class="ad-k-tag ad-k-disc">' + esc(r.kind) + "</span>");
    return "<tr><td>" + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + "</td><td>" + esc(r.period_end || "—") + "</td><td>" + kindTag + "</td>" +
      "<td>" + cell(r.total_debt, r.notes) + "</td><td>" + cell(r.st) + "</td><td>" + cell(r.lt) + "</td><td>" + cell(r.net_debt) + "</td>" +
      "<td>" + (d == null ? "—" : fmtSignedB(d)) + "</td><td>" + cellPct(r.yoy) + "</td>" +
      "<td>" + (r.dte == null ? "—" : (+r.dte).toFixed(2) + "x") + "</td><td>" + (r.dtebitda == null ? "—" : fmtX(r.dtebitda)) + "</td><td>" + (r.ndtebitda == null ? "—" : fmtX(r.ndtebitda)) + "</td></tr>";
  }).join("");
  var tB = rows.map(function (r) {
    var m = mh.map[r.year];
    var diff = (r.wa_yield != null && rateIsDisclosed(r)) ? Math.round((r.wa_yield - r.wa_rate) * 100) : null;
    return "<tr><td>" + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + "</td>" +
      "<td>" + cell(r.gross_raised) + ' <span class="ad-k-tag ad-k-disc">calendar</span></td>' +
      "<td>" + cell(r.principal_repaid) + "</td><td>" + cell(r.net_borrowing) + "</td>" +
      "<td>" + (m ? (m.v == null ? '<span title="' + esc(m.note || "Maturing principal not verified for this year") + '">—</span>' : fmtB(m.v)) : "—") + ' <span class="ad-k-tag ad-k-disc">calendar, partial</span></td>' +
      "<td>" + (rateIsDisclosed(r) ? fmtPct(r.wa_rate) : "—") + "</td><td>" + (rateBasis(r) === "blended" ? fmtPct(r.wa_rate) : "—") + "</td><td>" + fmtPct(r.wa_yield) + "</td>" +
      "<td>" + (diff == null ? "—" : (diff >= 0 ? "+" : "") + diff + " bps") + "</td><td>" + cell(r.interest_expense) + "</td></tr>";
  }).join("");
  var tC = rows.map(function (r) {
    var b = r.comp;
    return "<tr><td>" + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + "</td>" +
      "<td>" + (b ? cell(b.bonds) : "—") + "</td><td>" + (b ? cell(b.bank) : "—") + "</td><td>" + (b ? cell(b.cp) : "—") + "</td><td>" + (b ? cell(b.other) : "—") + "</td><td>" + cell(r.gross_raised) + "</td></tr>";
  }).join("");
  var unavRows = rows.filter(function (r) { return r.kind === "unavailable" || r.kind === "not_reported"; });
  var unavNote = unavRows.length ? '<div class="ad-note">Unavailable years: ' + unavRows.map(function (r) { return (r.kind === "ttm" ? "TTM" : "FY" + r.year) + " — " + esc(r.notes || "not reported yet"); }).join(" ") + "</div>" : "";
  var rowNotes = rows.filter(function (r) { return r.notes && r.kind === "actual"; }).slice(0, 3).map(function (r) {
    return '<div class="ad-note" title="' + esc(r.notes) + '">FY' + r.year + " note: " + esc(r.notes.length > 260 ? r.notes.slice(0, 260) + "…" : r.notes) + "</div>";
  }).join("");
  return head +
    '<div class="ad-note">' + esc(basisNote) + (F.yr ? " Filtered to the fiscal year ending in " + esc(F.yr) + " — tap All on the ruler to see every fiscal year and the TTM." : " Showing every fiscal year plus the TTM.") + "</div>" +
    '<h3 class="ad-h3">Closing debt &amp; net debt</h3>' + svg1 + leg1 +
    '<h3 class="ad-h3">Annual flows — gross issued, principal repaid, debt maturing</h3>' + svg2 + leg2 +
    '<h3 class="ad-h3">Cost of debt — WA rate on existing debt vs WA yield on new issues</h3>' + svg3 + leg3 + ieStrip +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>FY</th><th>Period end</th><th>Kind</th><th>Closing debt</th><th>Short-term</th><th>Long-term</th><th>Net debt</th><th>Δ debt</th><th>YoY %</th><th>Debt / equity</th><th>Debt / EBITDA</th><th>Net debt / EBITDA</th></tr></thead><tbody>' + tA + "</tbody></table></div>" +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>FY</th><th>Gross raised (calendar)</th><th>Principal repaid</th><th>Net borrowing</th><th>Maturing (calendar, partial)</th><th>WA rate — existing (disclosed)</th><th>Blended eff. rate (computed)</th><th>WA yield new</th><th>Differential</th><th>Interest expense</th></tr></thead><tbody>' + tB + "</tbody></table></div>" +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>FY</th><th>Bonds issued</th><th>Bank borrowings</th><th>Commercial paper</th><th>Other borrowings</th><th>Gross raised</th></tr></thead><tbody>' + tC + "</tbody></table></div>" +
    '<div class="ad-note">Debt balance: total consolidated debt = short-term debt + current portion of long-term debt + long-term debt, balance-sheet carrying amounts. Net debt = total debt − cash &amp; equivalents. Debt / EBITDA uses EBITDA = operating income + depreciation &amp; amortisation' + (rows[0] && rows[0].ebitda_def ? " (" + esc(rows[0].ebitda_def) + ")" : "") + '. Borrowing activity: bonds / bank / commercial paper / other are the fiscal-year borrowing composition where disclosed; gross raised is calendar-year (issue month). Net borrowing = gross raised − principal repaid — the two series mix calendar and fiscal bases, so net borrowing is shown as reported in the dataset and the net change in the year-end balance (Table A, Δ debt) is the cleaner measure of the balance movement.</div>' +
    unavNote + rowNotes + "</section>";
}

function costHTML() {
  var c = enh();
  if (!c) return "";
  var head = '<section class="ad-sec"><h2>02 · Cost of debt <span class="ad-sec-sub">WA yield &amp; interest expense — is borrowing getting more expensive?</span></h2>';
  var p = profRows(c);
  if (p.status !== "OK") return head + '<div class="ad-note">Cost of debt cannot be assessed — no audited financials (Form D only).</div></section>';
  var ttm = profTTM(c), fy = profLatestFY(c);
  var latest = ttm || fy;
  /* Existing-debt rate = DISCLOSED debt-note WA only (latest fiscal year). Latest yield =
     latest calendar-year WA yield on new issues (the latest issuance period — the profile's
     yield can be stale, e.g. Microsoft's Oct 2026 offering is FY2027). */
  var dd = disclosedDiff(c);
  var latestRateRow = dd.rate, latestBlendRow = latestBlendRateRow(c);
  var latestYieldRow = dd.yld ? { wa_yield: dd.yld.v, yldLbl: "calendar " + dd.yld.year } : null;
  function perLbl(r) { return r ? (r.kind === "ttm" ? "TTM" : "FY" + r.year) : "—"; }
  var diff = dd.diff;
  var warn = diff != null && diff > 100;
  var tiles = '<div class="ad-kpi">' +
    kpi("WA rate — existing debt", fmtPct(latestRateRow ? latestRateRow.wa_rate : null), latestRateRow ? perLbl(latestRateRow) + " · debt-note disclosed WA" : "No disclosed debt-note WA rate") +
    kpi("Blended effective rate (computed)", fmtPct(latestBlendRow ? latestBlendRow.wa_rate : null), latestBlendRow ? perLbl(latestBlendRow) + " · computed: interest expense ÷ average total debt — never the existing-debt rate" : "—") +
    kpi("WA yield — new issues", fmtPct(latestYieldRow ? latestYieldRow.wa_yield : null), latestYieldRow ? latestYieldRow.yldLbl + " · amount-weighted" : "—") +
    kpi("Rate differential", diff == null ? "—" : (diff >= 0 ? "+" : "") + diff + " bps", dd.rate == null ? "Not computable — no disclosed debt-note WA rate" : "New-issue yield minus disclosed existing-debt rate") +
    kpi("Interest expense", fmtB(latest ? latest.interest_expense : null), latest ? (latest.kind === "ttm" ? "TTM" : "FY" + latest.year) + " · actual reported expense" : "—") +
    kpi("Interest coverage (EBIT / interest)", latest && latest.ic_ebit != null ? fmtX(latest.ic_ebit) : "—", "EBIT ÷ interest expense") +
    kpi("Fixed / floating", (latest && latest.fixed != null) ? latest.fixed.toFixed(1) + "% / " + (latest.floating != null ? latest.floating.toFixed(1) + "%" : "—") : "—", "Share of outstanding debt") +
    kpi("Avg remaining maturity", latest && latest.avg_mat != null ? (+latest.avg_mat).toFixed(1) + " yrs" : "—", latest && latest.avg_mat_method ? esc(latest.avg_mat_method) : "Weighted-average remaining term") +
    kpi("Secured / unsecured", (latest && latest.secured != null) ? latest.secured.toFixed(1) + "% / " + (latest.unsecured != null ? latest.unsecured.toFixed(1) + "%" : "—") : "—", "Share of outstanding debt") +
    "</div>";
  var warnBox = warn
    ? '<div class="ad-cost-warn">⚠ WARNING — new-issue yield exceeds the existing-debt rate by ' + diff + ' bps (&gt;100 bps threshold). Refinancing maturing debt at today\u2019s yields will raise future interest expense. See section 04 for the dollar impact.</div>'
    : (diff != null ? '<div class="ad-note">No rising-cost warning: the new-issue yield is ' + (diff >= 0 ? "+" : "") + diff + ' bps vs the existing-debt rate (threshold &gt;100 bps).</div>' : "");
  var rows = p.rows.filter(function (r) { return r.kind === "actual" || r.kind === "ttm"; });
  if (F.yr) rows = rows.filter(function (r) { return r.kind === "actual" && r.period_end && String(r.period_end).slice(0, 4) === F.yr; });
  var trows = rows.map(function (r) {
    var d = (r.wa_yield != null && rateIsDisclosed(r)) ? Math.round((r.wa_yield - r.wa_rate) * 100) : null;
    return "<tr><td>" + (r.kind === "ttm" ? "TTM" : "FY" + r.year) + "</td><td>" + (rateIsDisclosed(r) ? fmtPct(r.wa_rate) : "—") + "</td><td>" + (rateBasis(r) === "blended" ? fmtPct(r.wa_rate) : "—") + "</td><td>" + fmtPct(r.wa_yield) + "</td>" +
      "<td>" + (d == null ? "—" : (d >= 0 ? "+" : "") + d + " bps") + "</td><td>" + fmtB(r.interest_expense) + "</td><td>" + (r.ic_ebit == null ? "—" : fmtX(r.ic_ebit)) + "</td>" +
      "<td>" + (r.fixed == null ? "—" : r.fixed.toFixed(1) + "%") + "</td><td>" + (r.floating == null ? "—" : r.floating.toFixed(1) + "%") + "</td>" +
      "<td>" + (r.avg_mat == null ? "—" : (+r.avg_mat).toFixed(1) + " yrs") + "</td><td>" + (r.secured == null ? "—" : r.secured.toFixed(1) + "%") + "</td><td>" + (r.unsecured == null ? "—" : r.unsecured.toFixed(1) + "%") + "</td></tr>";
  }).join("");
  var cm = currencyMix(F.co);
  var cmTxt = cm.mix.length ? cm.mix.map(function (m) { return m.cur + " " + fmtB(m.amt) + " (" + m.pct + "%)"; }).join(" · ") : "—";
  return head + tiles + warnBox +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>FY</th><th>WA rate — existing (disclosed)</th><th>Blended eff. rate (computed)</th><th>WA yield — new</th><th>Differential</th><th>Interest expense</th><th>Interest coverage</th><th>Fixed %</th><th>Floating %</th><th>Avg remaining maturity</th><th>Secured %</th><th>Unsecured %</th></tr></thead><tbody>' + trows + "</tbody></table></div>" +
    '<div class="ad-note">Three separate measures — WA interest rate on outstanding debt (the current overall debt cost), WA yield on new issuance (the cost of accessing fresh capital) and interest expense (the real financial burden in the income statement). ' +
    'Coupon is the contractual interest payment; yield is the effective return demanded by investors at issuance — the two are never used interchangeably. WA rate — existing debt is the DISCLOSED debt-note WA rate only (principal-weighted effective rates from the 10-K debt note) — the only rate used for differentials, warning flags and stress tests. Where a year discloses no debt-note rate the cell shows "—" and the blended effective rate (interest expense ÷ average total debt, computed) is shown in its own column, never as the existing-debt rate. Latest disclosed rate' + (latestRateRow ? ": " + fmtPct(latestRateRow.wa_rate) + " (" + perLbl(latestRateRow) + " · " + esc(latestRateRow.wa_rate_method || "debt-note disclosed") + ")" : ": none — no disclosed debt-note WA rate for this company") + '. ' +
    'Currency composition of debt RAISED (included raises only, ' + fmtB(cm.total) + '): ' + esc(cmTxt) + ' — this is the currency mix of issuance, not of outstanding debt, which is not disclosed in the filings.</div>' +
    "</section>";
}
function ladderHTML() {
  var c = enh();
  if (!c) return "";
  var head = '<section class="ad-sec"><h2>03 · Debt maturity &amp; refinancing ladder <span class="ad-sec-sub">next five years, 2027–2031 + thereafter · next 12 and 24 months emphasised</span></h2>';
  var lad = ladderData(c);
  if (lad.status === "UNAVAILABLE") return head + '<div class="ad-note">' + esc(lad.reason) + '</div></section>';
  var ds = c.debt_service || {};
  var t = ds.ttm || {};
  var isAnth = F.co === "Anthropic";
  var opening = isAnth ? t.total_debt_principal_usd_b : t.total_debt_usd_b;
  if (opening == null) opening = lad.basis;
  var tiles = '<div class="ad-kpi">' +
    kpi("Next 12 months", fmtB(lad.m12), lad.p12 == null ? "Principal due" : (+lad.p12).toFixed(2) + "% of total debt") +
    kpi("Next 24 months", fmtB(lad.m24), lad.p24 == null ? "Cumulative principal due" : (+lad.p24).toFixed(2) + "% of total debt") +
    kpi("Next 3 years", fmtB(lad.m3y), lad.p3y == null ? "Cumulative principal due" : (+lad.p3y).toFixed(2) + "% of total debt") +
    kpi("Largest maturity year", lad.largest_year == null ? "—" : esc(String(lad.largest_year)), fmtB(lad.largest_amt)) +
    kpi("Largest single instrument", lad.li_name == null ? "—" : esc(lad.li_name), fmtB(lad.li_amt)) +
    kpi("Unfunded 12M maturities", fmtB(lad.unfunded12), "12M maturities − cash − committed facilities (floored at 0)") +
    kpi("24M refinancing gap", fmtB(lad.gap24), "24M maturities − cash − committed facilities (floored at 0)") +
    kpi("Cash + facilities", fmtB(lad.cash_plus_fac), "Cash " + fmtB(lad.cash) + " + committed facilities " + fmtB(lad.facilities)) +
    "</div>";
  var hl12 = '<div class="ad-lad-hl"><b>Next 12 months — ' + fmtB(lad.m12) + (lad.p12 != null ? " (" + (+lad.p12).toFixed(2) + "% of total debt)" : "") + '</b> · cash + facilities ' + fmtB(lad.cash_plus_fac) + ' · unfunded maturities ' + fmtB(lad.unfunded12) + '</div>';
  var hl24 = '<div class="ad-lad-hl"><b>Next 24 months — ' + fmtB(lad.m24) + (lad.p24 != null ? " (" + (+lad.p24).toFixed(2) + "% of total debt)" : "") + '</b> · refinancing gap ' + fmtB(lad.gap24) + '</div>';
  var cum = 0, cumPct = 0;
  var body = lad.years.map(function (y, yi) {
    var pct = (y.v != null && lad.basis) ? y.v / lad.basis * 100 : null;
    if (y.v != null) { cum += y.v; if (pct != null) cumPct += pct; }
    /* Refinancing gap is a near-term (24-month) liquidity measure: only the first two ladder
       years sit inside that window. Later years show "—" — the gap does not apply to them. */
    var gap = (yi < 2 && lad.cash_plus_fac != null) ? Math.max(0, Math.round((cum - lad.cash_plus_fac) * 1000) / 1000) : null;
    var mat = y.v == null ? '<span title="The ' + y.y + ' maturity is not separately disclosed — it sits inside the thereafter bucket">—</span>' : fmtB(y.v);
    return "<tr><td>" + y.y + "</td><td>" + mat + "</td><td>" + (pct == null ? "—" : pct.toFixed(2) + "%") + "</td><td>" + cumPct.toFixed(2) + "%</td>" +
      "<td>—</td><td>" + (y.v == null ? "—" : fmtB(y.v)) + ' <span class="ad-k-tag ad-k-est">estimate</span></td><td>—</td><td>' + fmtB(opening) + ' <span class="ad-k-tag ad-k-est">estimate</span></td><td>' + fmtB(gap) + "</td></tr>";
  }).join("");
  var thPct = (lad.thereafter != null && lad.basis) ? lad.thereafter / lad.basis * 100 : null;
  var thCum = cum + (lad.thereafter || 0);
  var thCumPct = (thPct == null ? null : cumPct + thPct);
  body += "<tr><td>Thereafter</td><td>" + fmtB(lad.thereafter) + "</td><td>" + (thPct == null ? "—" : thPct.toFixed(2) + "%") + "</td><td>" + (thCumPct == null ? "—" : thCumPct.toFixed(2) + "%") + "</td>" +
    "<td>—</td><td>" + fmtB(lad.thereafter) + ' <span class="ad-k-tag ad-k-est">estimate</span></td><td>—</td><td>' + fmtB(opening) + ' <span class="ad-k-tag ad-k-est">estimate</span></td><td>—</td></tr>';
  var schedTotal = lad.schedule_total != null ? lad.schedule_total : (thCum || null);
  return head + tiles + hl12 + hl24 +
    '<div class="ad-note">Opening debt (TTM total debt' + (isAnth ? ", principal" : "") + '): ' + fmtB(opening) + ' · maturity schedule as of ' + esc(lad.schedule_date || "—") + ' · accession ' + esc(lad.accession || "—") + ' · schedule total ' + fmtB(schedTotal) + '.</div>' +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Year</th><th>Principal maturing</th><th>% of total debt</th><th>Cumulative %</th><th>Already refinanced</th><th>Expected refinancing</th><th>Expected new borrowing</th><th>Projected closing debt</th><th>Refinancing gap</th></tr></thead><tbody>' + body + "</tbody></table></div>" +
    '<div class="ad-note">Maturities are calendar-year principal from the latest 10-K/20-F/S-1 debt maturity schedule (disclosed); the 12M figure is the current portion of long-term debt at the latest interim filing, so it can differ from the 2027 calendar bucket. ' +
    'Already refinanced is not disclosed in the filings — shown as "—", never assumed. Expected refinancing = the maturing principal (assumption: all maturing principal is refinanced at prevailing market yields, none repaid from cash). Expected new borrowing is "—" for every company: no disclosed borrowing plan exists, so nothing is forecast. ' +
    'Projected closing debt = opening debt under the refinance assumption (opening + 0 new borrowing − 0 repaid + 0 refinanced net). Refinancing gap is a near-term measure, shown only for the first two ladder years: max(0, cumulative maturities through that year − cash − committed facilities)' + (lad.method ? "; dataset method: " + esc(lad.method) : "") + '. ' +
    (lad.notes ? esc(lad.notes) : "") + "</div>" +
    "</section>";
}

function stressHTML() {
  var c = enh();
  if (!c) return "";
  var head = '<section class="ad-sec"><h2>04 · Refinancing cost impact <span class="ad-sec-sub">stress testing — what extra interest will the company pay when the maturing cohort rolls?</span></h2>';
  var rs = c.refinancing_scenarios;
  var ds = c.debt_service || {};
  var t = ds.ttm || {};
  if (!rs || !rs.maturing_12m || !rs.maturing_24m) {
    return head + '<div class="ad-note">No refinancing scenarios — no audited financials or no maturing debt disclosed for this company.</div></section>';
  }
  var totDebt = F.co === "Anthropic" ? t.total_debt_principal_usd_b : t.total_debt_usd_b;
  var ttmInt = t.interest_expense_usd_b;
  /* Base rate = DISCLOSED debt-note WA rate on existing debt (latest fiscal year). The
     dataset's per-cohort rate is a blended effective rate and is never used as the base. */
  var disc = latestDiscRateRow(c);
  var blendCohort = rs.maturing_12m.current_wa_rate_on_maturing_debt_pct;
  function cohort(m, label) {
    var hdr = '<tr class="ad-coh"><td colspan="7">' + label + ' — maturing principal ' + fmtB(m.maturing_principal_usd_b) +
      ' · old WA rate on that debt ' + (disc ? fmtPct(disc.wa_rate, 3) + " (disclosed, debt-note · FY" + disc.year + ")" : "— (no disclosed debt-note WA rate)") + '</td></tr>';
    var oldRate = disc ? disc.wa_rate : null;
    function scenRow(bps, inc) {
      var newYield = oldRate == null ? null : oldRate + bps / 100;
      var projTot = (ttmInt != null && inc != null) ? ttmInt + inc : null;
      var fcfImp = inc == null ? null : -inc;
      return "<tr><td>" + (bps === 0 ? "Base" : "+" + bps + " bps") + "</td><td>" + fmtPct(newYield, 3) + "</td><td>" + (bps === 0 ? "0 bps" : "+" + bps + " bps") + "</td>" +
        "<td>" + fmtB3(inc) + "</td><td>" + fmtB(projTot) + "</td><td>" + fmtSignedB(fcfImp) + "</td><td>—</td></tr>";
    }
    var out = hdr + scenRow(0, 0);
    ["+50bps", "+100bps", "+200bps"].forEach(function (k) {
      var s = m.scenarios[k];
      var bps = parseInt(k.slice(1), 10);
      out += scenRow(bps, s.incremental_annual_interest_usd_b);
    });
    return out;
  }
  var waNote = "Change in WA borrowing cost = incremental annual interest ÷ TTM total debt" + (F.co === "Anthropic" ? " (principal)" : "") + ", in basis points: 12M cohort +50/+100/+200 bps → +" +
    ["+50bps", "+100bps", "+200bps"].map(function (k) {
      var s = rs.maturing_12m.scenarios[k];
      return totDebt && s.incremental_annual_interest_usd_b != null ? (s.incremental_annual_interest_usd_b / totDebt * 10000).toFixed(1) : "—";
    }).join(" / +") + " bps; 24M cohort → +" +
    ["+50bps", "+100bps", "+200bps"].map(function (k) {
      var s = rs.maturing_24m.scenarios[k];
      return totDebt && s.incremental_annual_interest_usd_b != null ? (s.incremental_annual_interest_usd_b / totDebt * 10000).toFixed(1) : "—";
    }).join(" / +") + " bps.";
  var method = rs.maturing_12m.method || "Simple: maturing principal × rate change. No change in issuance mix, no fees, no tax effect. Not a forecast.";
  var rateMethod = disc ? ("Disclosed debt-note WA rate, FY" + disc.year + ": " + (disc.wa_rate_method || "debt-note disclosed")) : "No disclosed debt-note WA rate — the base rate is not computable from a disclosed figure.";
  return head +
    '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Scenario</th><th>Assumed refinancing yield</th><th>Rate differential</th><th>Incremental annual interest</th><th>Projected total interest expense</th><th>Impact on FCF</th><th>Impact on net income (after tax)</th></tr></thead><tbody>' +
    cohort(rs.maturing_12m, "Next 12 months") + cohort(rs.maturing_24m, "Next 24 months") +
    '</tbody></table></div>' +
    '<div class="ad-note">Formula: Incremental Interest = Refinanced Principal × (New Yield − Old Rate). E.g. $10B refinanced from 4% to 6% adds $200M a year. Base case assumes the maturing cohort rolls at its current WA rate (no change); +100 / +200 bps are the moderate and severe stress cases; the +50 bps row is kept for continuity. ' +
    'Projected total interest expense = TTM interest expense (' + fmtB(ttmInt) + ') + incremental interest. Impact on FCF = −incremental cash interest. ' +
    'Impact on net income (after tax) is NOT computed — no effective tax rate was extracted from the filings in this pass, so the after-tax figure would be a guess; the formula is incremental interest × (1 − tax rate). ' +
    esc(method) + " " + esc(waNote) + " " +
    "The base rate is the DISCLOSED debt-note WA rate on existing debt" + (disc ? " (" + fmtPct(disc.wa_rate, 3) + ", FY" + disc.year + " · " + esc(disc.wa_rate_method || "debt-note disclosed") + ")" : " — none disclosed for this company, so the base and scenario yields show '—'") + ". The dataset discloses no rate specific to the maturing cohort, so the disclosed WA rate on outstanding debt is used as the base rate. The blended effective rate on the maturing cohort (" + fmtPct(blendCohort, 3) + ", TTM interest expense ÷ average total debt, computed) is shown for reference only and is never used as the base rate; where average debt is small it is arithmetically correct but not economically meaningful. " +
    "Assumed yields are scenario arithmetic, disclosed here — never presented as company guidance.</div>" +
    '<div class="ad-note" title="' + esc(rateMethod) + '">Rate method: ' + esc(rateMethod) + "</div></section>";
}
function sustainHTML() {
  var c = enh();
  if (!c) return "";
  var head = '<section class="ad-sec"><h2>05 · Debt sustainability <span class="ad-sec-sub">operating cash flow &amp; debt service — can the business service its debt?</span></h2>';
  var ds = c.debt_service || {};
  if (ds.verdict === "UNAVAILABLE" || !ds.ttm) {
    return head + '<div class="ad-note">Unavailable — no audited financials (Form D only). Debt-service capacity cannot be assessed; only the debt raises are known.</div></section>';
  }
  var t = ds.ttm, fy = ds.latest_fy || {};
  var isAnth = F.co === "Anthropic";
  var ttmRow = profTTM(c), fyRow = profLatestFY(c);
  function two(l, tv, fv, note) { return "<tr><td>" + l + "</td><td>" + tv + "</td><td>" + fv + "</td><td>" + (note || "") + "</td></tr>"; }
  function dsCash(row) {
    if (!row) return null;
    return (row.cash_interest_paid != null && row.principal_repaid != null) ? row.cash_interest_paid + row.principal_repaid : null;
  }
  var ttmDS = dsCash(ttmRow), fyDS = dsCash(fyRow);
  var ttmOcfDS = (ttmRow && ttmRow.ocf != null && ttmDS) ? ttmRow.ocf / ttmDS : null;
  var fyOcfDS = (fyRow && fyRow.ocf != null && fyDS) ? fyRow.ocf / fyDS : null;
  var debtVal = isAnth ? fmtB(t.total_debt_principal_usd_b) : fmtB(t.total_debt_usd_b);
  var debtNote = isAnth ? "Principal outstanding. Carrying value " + fmtB(t.total_debt_usd_b) + " is convertible notes at fair value." : "Balance-sheet carrying amounts (short-term + current portion + long-term).";
  var intVal = t.interest_expense_usd_b == null ? "—" : fmtB(t.interest_expense_usd_b);
  var intNote = isAnth ? "No interest-expense line; coupons are 8–10% PIK (accrete to principal, no cash interest)." : "TTM interest expense.";
  var caveats = [];
  if (t.ocf_note) caveats.push(esc(t.ocf_note));
  if (t.cash_note) caveats.push(esc(t.cash_note));
  if (t.total_debt_note) caveats.push(esc(t.total_debt_note));
  if (isAnth) caveats.push("No principal matures before Sep 2029; PIK coupons accrete to principal due 2029–2035.");
  var matSrc = ds.maturity_schedule_source || "";
  var matShort = matSrc.indexOf("Full buckets:") >= 0 ? matSrc.slice(0, matSrc.indexOf("Full buckets:")) : matSrc;
  var verdictRow = '<tr class="ad-vrow"><td>Verdict — can it meet interest + principal from FCF?</td><td colspan="2">' + (ds.verdict === "yes" ? "YES" : "NO") + '</td><td>' + esc(ds.verdict_basis || "") + '</td></tr>';
  var rows = "";
  rows += two("Revenue", fmtB(ttmRow ? ttmRow.revenue : null), fmtB(fyRow ? fyRow.revenue : null), "Scale and growth of the business");
  rows += two("EBITDA", fmtB(ttmRow ? ttmRow.ebitda : null), fmtB(fyRow ? fyRow.ebitda : null), "Operating income + depreciation & amortisation" + (ttmRow && ttmRow.ebitda_def ? " (" + esc(ttmRow.ebitda_def) + ")" : "") + "; where a company reports adjusted EBITDA the reported figure is given alongside in the dataset");
  rows += two("EBIT", fmtB(ttmRow ? ttmRow.ebit : null), fmtB(fyRow ? fyRow.ebit : null), "Operating earnings");
  rows += two("Operating cash flow (OCF)", fmtB(t.operating_cash_flow_usd_b), fmtB(fy.operating_cash_flow_usd_b), "Cash generated from operations" + (t.ocf_note ? " · " + esc(t.ocf_note) : ""));
  rows += two("Capital expenditure (CAPEX)", fmtB(t.capex_usd_b), fmtB(fy.capex_usd_b), "Purchases of property and equipment");
  rows += two("Free cash flow (OCF − CAPEX)", fmtSignedB(t.free_cash_flow_usd_b), fmtSignedB(fy.free_cash_flow_usd_b), "FCF = OCF − CAPEX");
  rows += two("Cash & equivalents", fmtB(t.cash_and_equivalents_usd_b), fmtB(fy.cash_and_equivalents_usd_b), t.cash_note ? esc(t.cash_note) : "");
  rows += two("Total debt", debtVal, fmtB(fy.total_debt_usd_b), debtNote);
  rows += two("Interest expense", intVal, fmtB(fy.interest_expense_usd_b), intNote);
  rows += two("Cash interest paid", fmtB(ttmRow ? ttmRow.cash_interest_paid : null), fmtB(fyRow ? fyRow.cash_interest_paid : null), "Actual interest cash outflow — where not disclosed, DSCR is null");
  rows += two("Principal repayments", fmtB(ttmRow ? ttmRow.principal_repaid : null), fmtB(fyRow ? fyRow.principal_repaid : null), "Debt principal paid (cash-flow statement, fiscal year)");
  rows += two("Total debt service (cash interest + principal repaid)", fmtB(ttmDS), fmtB(fyDS), "Cash basis; null where cash interest paid is not disclosed");
  rows += two("12M debt service (interest expense + principal due)", fmtB(ds.debt_service_12m_usd_b), "—", esc(ds.debt_service_12m_basis || ""));
  rows += two("FCF after 12M debt service", fmtSignedB(ds.fcf_after_debt_service_usd_b), "—", "FCF − 12M debt service");
  rows += two("Interest coverage — EBIT / interest", (ttmRow && ttmRow.ic_ebit != null) ? fmtX(ttmRow.ic_ebit) : "—", (fyRow && fyRow.ic_ebit != null) ? fmtX(fyRow.ic_ebit) : "—", "EBIT ÷ interest expense");
  rows += two("Interest coverage — OCF / interest", ds.interest_coverage_ocf == null ? "—" : fmtX(ds.interest_coverage_ocf), (fyRow && fyRow.ocf != null && fyRow.interest_expense) ? fmtX(fyRow.ocf / fyRow.interest_expense) : "—", "Operating cash flow ÷ interest expense");
  rows += two("Interest coverage — FCF / interest", ds.interest_coverage_fcf == null ? "—" : fmtX(ds.interest_coverage_fcf), (fyRow && fyRow.fcf != null && fyRow.interest_expense) ? fmtX(fyRow.fcf / fyRow.interest_expense) : "—", "Free cash flow ÷ interest expense");
  rows += two("DSCR — OCF ÷ (cash interest + principal repaid)", (ttmRow && ttmRow.dscr != null) ? fmtX(ttmRow.dscr) : "—", (fyRow && fyRow.dscr != null) ? fmtX(fyRow.dscr) : "—", "OCF already reflects cash interest and taxes, so interest is not subtracted twice");
  rows += two("OCF / debt service (cash basis)", ttmOcfDS == null ? "—" : fmtX(ttmOcfDS), fyOcfDS == null ? "—" : fmtX(fyOcfDS), "Cash available for debt service ÷ required debt service");
  rows += verdictRow;
  var cf = cfFlags(c);
  var cfHTML = "";
  if (cf.status === "UNAVAILABLE") {
    cfHTML = '<div class="ad-note">Indirect cash-flow factors: ' + esc(cf.reason) + '</div>';
  } else if (cf.status === "OK") {
    var cfRows = cf.items.map(function (it) {
      var v = it.value != null ? it.value : (it.note ? "—" : "not disclosed");
      return "<tr><td>" + esc(it.label) + "</td><td>" + (it.value != null ? esc(it.value) : "") + "</td><td>" + esc(it.note || (it.value != null ? "" : "Not disclosed in the excerpts read")) + "</td></tr>";
    }).join("");
    cfHTML = '<h3 class="ad-h3">Indirect cash-flow factors — where disclosed</h3>' +
      '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Factor</th><th>Amount</th><th>Detail</th></tr></thead><tbody>' + cfRows + '</tbody></table></div>' +
      '<div class="ad-note">Working capital, supplier financing, lease payments, restructuring / litigation, acquisitions / divestitures, dividends &amp; buybacks, restricted cash and pension commitments all compete with debt service for cash. Dividends paid (TTM ' + fmtB(ttmRow ? ttmRow.dividends : null) + ' · FY ' + fmtB(fyRow ? fyRow.dividends : null) + ') and share buybacks (TTM ' + fmtB(ttmRow ? ttmRow.buybacks : null) + ' · FY ' + fmtB(fyRow ? fyRow.buybacks : null) + ') are cash distributed to shareholders and unavailable for debt repayment. ' +
      (cf.accession ? "Source: accession " + esc(cf.accession) + " · period ended " + esc(cf.period || "—") + "." : "") + '</div>';
  }
  return head +
    '<div class="tbl-scroll"><table class="ad-t ad-cap-t"><thead><tr><th>Metric</th><th>TTM</th><th>Latest FY</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="ad-note">Definitions: FCF = OCF − CAPEX. Interest coverage = EBIT ÷ interest expense. DSCR = cash available for debt service ÷ (interest paid + principal due), where cash available for debt service is OCF — OCF already reflects cash interest and taxes, so interest is not subtracted twice. A company may report positive EBITDA while struggling to fund repayments; the FCF and DSCR rows are the binding test.</div>' +
    cfHTML +
    (caveats.length ? '<div class="ad-note">Caveats: ' + caveats.join(" ") + '</div>' : "") +
    '<div class="ad-note">Sources — TTM: ' + srcLine(t.accession, t.period_end, t.filed) + ' · FY: ' + srcLine(fy.accession, fy.period_end, fy.filed) + '</div>' +
    (matShort ? '<div class="ad-note" title="' + esc(matSrc) + '">Maturity schedule: ' + esc(matShort) + '</div>' : "") +
    "</section>";
}

function enhSections() {
  if (!E) {
    if (EFAIL) return '<div class="ad-note">Debt-service enhancement data (ai-debt-enhancement.json) is not available on this deployment yet — the raises below are unaffected.</div>';
    return "";
  }
  return verdictHTML() + warnHTML() + profileHTML() + costHTML() + ladderHTML() + stressHTML() + sustainHTML();
}

  function rowHTML(r, i) {
    var spv = isSPV(r), sub = !spv && r.issuer_legal_entity !== mainIssuer(r.company);
    var badge = spv ? ' <span class="ad-badge ad-spv" title="SPV / project-entity borrower — this debt is not the parent company\u2019s own borrowing">SPV</span>'
      : sub ? ' <span class="ad-badge ad-sub" title="Subsidiary borrower — not the parent company itself">SUB</span>' : "";
    var excl = r.include_in_total === false;
    var exTag = excl ? ' <span class="ad-badge ad-excl" title="Excluded from the company total' + (r.exclude_reason ? ": " + esc(r.exclude_reason) : "") + ' — see the expanded row">excluded from total</span>' : "";
    var amt = r.amount_usd_b == null ? '<span title="' + esc(r.notes || "Amount not disclosed in sources") + '">—</span>'
      : '<span title="' + esc(origAmt(r)) + '">' + fmtB(r.amount_usd_b) + "</span>";
    var yld = r.yield_or_coupon_pct == null ? "—"
      : (+r.yield_or_coupon_pct).toFixed(2) + "%";
    var yttl = r.yield_or_coupon_pct == null ? "Yield / coupon not publicly disclosed — floating-rate spreads are kept separate, never substituted"
      : esc(r.yield_type || "") + (r.yield_or_coupon_pct === 0 ? " — non-interest-bearing" : "");
    var ctry = r.country_of_issuer === "UNKNOWN" ? '<span title="Country not verified in sources">—</span>' : esc(r.country_of_issuer);
    return '<tr data-i="' + i + '"' + (excl ? ' class="ad-ex"' : "") + '"><td><span class="co">' + esc(r.company) + "</span></td>" +
      "<td>" + esc(r.issuer_legal_entity) + badge + exTag + "</td>" +
      "<td>" + esc(r.instrument_type) + "</td>" +
      '<td class="mono">' + monLbl(r.issue_month) + '</td><td class="r">' + amt + "</td>" +
      '<td class="mono">' + esc(r.currency) + '</td><td class="r" title="' + yttl + '">' + yld + "</td>" +
      "<td>" + ctry + "</td><td>" + cfChip(r.confidence) + "</td></tr>";
  }
  function detailHTML(r) {
    var src = (r.sources || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    var amtLine = r.amount_usd_b == null ? "<b>Amount:</b> — (not disclosed in sources)"
      : "<b>Amount:</b> " + esc(origAmt(r)) + " = " + fmtB(r.amount_usd_b);
    var inclLine = r.include_in_total === false
      ? '<div style="margin-top:6px"><b>In company total:</b> No — excluded' + (r.exclude_reason ? " (" + esc(r.exclude_reason) + ")" : "") + "</div>"
      : "";
    return '<tr class="ad-det"><td colspan="9"><div>' + amtLine + "</div>" + inclLine +
      '<div style="margin-top:6px"><b>Notes:</b> ' + esc(r.notes || "—") + "</div>" +
      '<div style="margin-top:6px"><b>Sources:</b><ul>' + (src || "<li>—</li>") + "</ul></div></td></tr>";
  }
  function stripHTML(rows) {
    var FAMS = ["Senior bonds", "Convertible notes", "Term loans & facilities", "Revolvers & DDTLs", "Other"];
    var byFam = {};
    rows.forEach(function (r) { var f = fam(r.instrument_type); (byFam[f] = byFam[f] || []).push(r); });
    var cells = FAMS.map(function (f) {
      var rs = byFam[f] || [], s = sumB(rs);
      return '<div class="ad-f"><div class="t">' + f + ' <span>(' + rs.length + (rs.length === 1 ? " raise)" : " raises)") + '</span></div><div class="v">' + (s.n ? fmtB(s.t) : "—") + "</div></div>";
    }).join("");
    var nullAmt = rows.filter(function (r) { return r.amount_usd_b == null; }).length;
    var note = "Totals of the rows shown after filtering, in USD billions — non-USD amounts converted at the issue-month average FX rate (FRED H.10 daily); original amount and currency kept per row. Totals follow the research\u2019s documented per-company total — for most companies the parent company\u2019s own funded debt; for CoreWeave, Crusoe, Lambda, Nebius and Nscale they include the project-vehicle / SPV facilities the research counts as raised debt. Excluded items are marked in Details." +
      (nullAmt ? " " + nullAmt + (nullAmt === 1 ? " row has" : " rows have") + " no disclosed amount and " + (nullAmt === 1 ? "is" : "are") + " excluded from totals." : "");
    return '<div class="ad-strip">' + cells + '</div><div class="ad-note">' + note + "</div>";
  }
  function topFamily(rows) {
    var by = {};
    rows.forEach(function (r) { var f = fam(r.instrument_type); by[f] = (by[f] || 0) + 1; });
    var best = null, bn = 0;
    Object.keys(by).forEach(function (f) { if (by[f] > bn) { bn = by[f]; best = f; } });
    return best ? { f: best, n: bn } : null;
  }
  /* Per-year bars for the company (All) — or per-month bars inside the selected year.
     The distribution is the company's own; the selected year/month context is highlighted. */
  function barsHTML() {
    var rs = coRows(), keys, labels, counts, cap;
    if (F.yr) {
      keys = MON; labels = MON;
      counts = MON.map(function (_, i) {
        var m = F.yr + "-" + ("0" + (i + 1)).slice(-2);
        return rs.filter(function (r) { return r.issue_month === m; }).length;
      });
      cap = "Raises per month — " + F.yr + " · " + esc(F.co) + " · " + rs.filter(function (r) { return r.issue_month.slice(0, 4) === F.yr; }).length + " raises";
    } else {
      keys = YEARS; labels = YEARS;
      counts = YEARS.map(function (y) { return rs.filter(function (r) { return r.issue_month.slice(0, 4) === y; }).length; });
      cap = "Raises per year — " + esc(F.co) + " · All years: " + rs.length + " raises";
    }
    var mx = Math.max.apply(null, counts.concat([1]));
    var bars = keys.map(function (k, i) {
      var pct = counts[i] ? Math.max(6, Math.round(counts[i] / mx * 100)) : 2;
      return '<div class="ad-bar" title="' + esc(labels[i]) + ": " + counts[i] + ' raises"><div class="n">' + counts[i] + '</div><div class="b" style="height:' + pct + '%"></div><div class="l">' + esc(labels[i]) + "</div></div>";
    }).join("");
    return '<div class="ad-bars-h">' + cap + '</div><div class="ad-bars">' + bars + "</div>";
  }
  function summaryHTML() {
    var rs = yrRows();
    var s = sumB(rs);
    var ex = sumExcl(rs);
    var tiles = [];
    tiles.push(kpi("Debt raises", num(rs.length), (F.yr ? F.yr : "All years") + " · " + F.co));
    tiles.push(kpi("Total raised", s.n ? fmtB(s.t) : "—", s.n ? s.n + " raises with disclosed amounts · USD billions" : "no disclosed amounts"));
    var ys = rs.filter(function (r) { return r.yield_or_coupon_pct != null; }).map(function (r) { return +r.yield_or_coupon_pct; });
    var lo = ys.length ? Math.min.apply(null, ys) : null, hi = ys.length ? Math.max.apply(null, ys) : null;
    var yrng = ys.length ? lo.toFixed(2) + "%" + (ys.length > 1 && hi !== lo ? " – " + hi.toFixed(2) + "%" : "") : "—";
    tiles.push(kpi("Yield / coupon range", yrng, ys.length ? ys.length + " of " + rs.length + " raises disclose a yield / coupon" : "no yield / coupon disclosed"));
    var tf = topFamily(rs);
    tiles.push(kpi("Top instrument family", tf ? esc(tf.f) : "—", tf ? tf.n + " of " + rs.length + " raises" : "—"));
    var exclLine = ex.t > 0 ? '<div class="ad-cur">excl. ' + fmtB(ex.t) + ' via financing vehicles &amp; facilities — see Details</div>' : "";
    /* Anthropic: the total is converts ISSUED; only $6.20B was still outstanding at Jun 30, 2026 (several converted to equity). Shown on the full-company Summary only. */
    if (F.co === "Anthropic" && !F.yr) exclLine += '<div class="ad-cur">Converts issued ' + fmtB(s.t) + ' — $6.20B outstanding at Jun 30, 2026; several converted to equity</div>';
    return enhSections() + '<div class="ad-kpi">' + tiles.join("") + "</div>" + exclLine + barsHTML() + stripHTML(rs);
  }
  function detailsHTML() {
    var rs = yrRows();
    var insts = [];
    rs.forEach(function (r) { if (insts.indexOf(r.instrument_type) < 0) insts.push(r.instrument_type); });
    insts.sort();
    function opts(list, cur) { return '<option value="">All</option>' + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>"; }).join(""); }
    var list = filtered();
    var flt = '<div class="ad-flt"><label>Instrument</label><select id="ad-f-inst">' + opts(insts, F.inst) + '</select>' +
      '<label>Confidence</label><select id="ad-f-cf"><option value="">All</option>' + ["CONFIRMED", "REPORTED", "INDICATIVE"].map(function (v) { return '<option' + (F.cf === v ? " selected" : "") + ">" + v + "</option>"; }).join("") + '</select>' +
      '<button type="button" id="ad-reset">Reset</button><span class="cnt" id="ad-count">Showing ' + num(list.length) + " of " + num(coRows().length) + " raises — " + esc(F.co) + (F.yr ? " · " + F.yr : " · All years") + "</span></div>";
    var body = list.length ? list.map(function (r) { return rowHTML(r, D.rows.indexOf(r)); }).join("")
      : '<tr><td colspan="9" style="text-align:left;color:var(--muted)">No raises match these filters.</td></tr>';
    return enhSections() + '<section class="ad-sec"><h2>06 · Instrument detail <span class="ad-sec-sub">debt composition &amp; source register — every raise, with issuer, instrument, amount, yield and source</span></h2>' + flt + '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Company</th><th>Issuer (legal entity)</th><th>Product / Instrument</th><th>Month raised</th><th>Total debt amount</th><th>Currency</th><th>Yield / coupon at issue</th><th>Country</th><th>Confidence</th></tr></thead><tbody id="ad-tbody">' + body + "</tbody></table></div></section>";
  }

  function render() {
    if (!D) {
      if (LOADFAIL) { P.innerHTML = '<div class="tile wide"><h2>AI Debt — AI-company debt raises</h2><p class="note">Could not load ai-debt.json (same directory as this page). The file ships with the desk; check it is present next to index.html.</p></div>'; return; }
      P.innerHTML = '<div class="tile wide"><h2>AI Debt — AI-company debt raises</h2><p class="note">Loading the verified raises dataset…</p></div>';
      fetch("ai-debt.json").then(function (resp) { if (!resp.ok) throw new Error("HTTP " + resp.status); return resp.json(); })
        .then(function (j) { D = j; BUILT = false; render(); })
        .catch(function () { LOADFAIL = true; render(); });
      /* Enhancement data (SEC EDGAR debt-service / chart figures) loads alongside; it never blocks the raises tab. */
      fetch("ai-debt-enhancement.json").then(function (resp) { if (!resp.ok) throw new Error("HTTP " + resp.status); return resp.json(); })
        .then(function (j) { E = j; if (BUILT) update(); })
        .catch(function () { EFAIL = true; if (BUILT) update(); });
      return;
    }
    var cos = companies();
    if (!F.co || cos.indexOf(F.co) < 0) F.co = cos[0];
    var counts = {};
    D.rows.forEach(function (r) { counts[r.company] = (counts[r.company] || 0) + 1; });
    var head = '<style>' +
      ".ad{padding:4px 0 20px}.ad-hd{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}" +
      ".ad-hd h1{margin:0;font-size:24px;letter-spacing:.02em;text-transform:uppercase}.ad-hd .sub{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.08em}" +
      ".ad-dt{font:12px 'IBM Plex Mono',monospace;color:#e8b93d;background:rgba(232,185,61,.1);border:1px solid rgba(232,185,61,.3);border-radius:6px;padding:4px 10px}" +
      ".ad-body{display:flex;gap:16px;align-items:flex-start}" +
      ".ad-co{flex:0 0 232px;position:sticky;top:0;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px}" +
      ".ad-co-h{font:600 11px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:2px 4px 8px}" +
      ".ad-co-h span{color:var(--faint)}" +
      ".ad-co-list{display:flex;flex-direction:column;gap:4px}" +
      ".ad-co-b{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;background:transparent;color:var(--ink);border:1px solid transparent;border-radius:8px;padding:8px 10px;font:12.5px 'IBM Plex Mono',monospace;cursor:pointer}" +
      ".ad-co-b:hover{background:rgba(56,182,201,.06)}" +
      ".ad-co-b.on{background:rgba(56,182,201,.12);border-color:rgba(56,182,201,.45)}" +
      ".ad-co-b .c{font:700 11px 'IBM Plex Mono',monospace;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:1px 8px;flex:0 0 auto}" +
      ".ad-co-b.on .c{color:#38b6c9;border-color:rgba(56,182,201,.45)}" +
      ".ad-main{flex:1;min-width:0}" +
      ".ad-seg{display:inline-flex;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:3px;gap:3px;margin-bottom:12px}" +
      ".ad-seg button{background:transparent;color:var(--muted);border:0;border-radius:6px;padding:7px 16px;font:600 12.5px 'IBM Plex Mono',monospace;cursor:pointer}" +
      ".ad-seg button.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.35)}" +
      ".ad-ruler-h{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-bottom:6px}" +
      ".ad-ruler{display:flex;border-top:2px solid var(--line2);touch-action:none;user-select:none;-webkit-user-select:none;margin-bottom:16px}" +
      ".ad-tk{flex:1;position:relative;background:transparent;color:var(--muted);border:0;border-radius:0 0 8px 8px;padding:14px 0 8px;font:600 12.5px 'IBM Plex Mono',monospace;cursor:pointer}" +
      ".ad-tk::before{content:'';position:absolute;top:-6px;left:50%;width:2px;height:10px;background:var(--line2)}" +
      ".ad-tk:hover{color:var(--ink)}" +
      ".ad-tk.on{background:rgba(56,182,201,.12);color:#38b6c9}" +
      ".ad-tk.on::before{background:#38b6c9}" +
      ".ad-bars-h{font:600 12px 'IBM Plex Mono',monospace;color:var(--muted);margin-bottom:2px}" +
      ".ad-bars{display:flex;gap:6px;height:130px;padding:6px 2px 0;border-bottom:1px solid var(--line2);margin-bottom:14px}" +
      ".ad-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}" +
      ".ad-bar .n{font:700 11.5px 'IBM Plex Mono',monospace;color:var(--muted)}" +
      ".ad-bar .b{width:72%;max-width:44px;background:var(--line2);border-radius:4px 4px 0 0;margin-top:4px}" +
      ".ad-bar .l{font:11px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:5px}" +
      ".ad-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}.ad-k{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}" +
      ".ad-k .t{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.ad-k .v{font:700 24px 'IBM Plex Mono',monospace;margin-top:2px}.ad-k .s{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:2px}" +
      ".ad-cur{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin:-6px 0 14px}" +
      ".ad-flt{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:14px}" +
      ".ad-flt label{font:600 11px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}" +
      ".ad-flt select{background:var(--panel);color:var(--ink);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;font:12.5px 'IBM Plex Mono',monospace;max-width:260px}" +
      ".ad-flt button{background:var(--panel);color:var(--ink);border:1px solid var(--line2);border-radius:6px;padding:6px 12px;font:12.5px 'IBM Plex Mono',monospace;cursor:pointer}" +
      ".ad-flt .cnt{margin-left:auto;font:12px 'IBM Plex Mono',monospace;color:var(--muted)}" +
      ".ad-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:6px}.ad-f{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}" +
      ".ad-f .t{font:600 11px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.ad-f .t span{color:var(--faint);text-transform:none;letter-spacing:0}" +
      ".ad-f .v{font:700 15px 'IBM Plex Mono',monospace;margin-top:4px;line-height:1.5}" +
      ".ad-note{font-size:11.5px;color:var(--faint);margin-bottom:14px}" +
      ".ad-t{width:100%;border-collapse:collapse;font:13px 'IBM Plex Mono',monospace}.ad-t th{text-align:right;color:var(--muted);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line2);white-space:nowrap}" +
      ".ad-t th:first-child,.ad-t td:first-child,.ad-t th:nth-child(2),.ad-t td:nth-child(2),.ad-t th:nth-child(3),.ad-t td:nth-child(3){text-align:left}" +
      ".ad-t td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}.ad-t td .co{font-weight:700;color:var(--ink)}" +
      ".ad-t tbody tr[data-i]{cursor:pointer}.ad-t tbody tr[data-i]:hover td{background:rgba(56,182,201,.05)}" +
      ".ad-t tr.ad-det td{background:var(--panel);cursor:default;font:12px 'IBM Plex Mono',monospace;color:var(--muted);line-height:1.6}.ad-t tr.ad-det ul{margin:4px 0 0;padding-left:16px}" +
      ".ad-cf{font:700 10.5px 'IBM Plex Mono',monospace;padding:2px 7px;border-radius:5px;white-space:nowrap}" +
      ".ad-cf-confirmed{color:#4ade80;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.35)}" +
      ".ad-cf-reported{color:#7dd3fc;background:rgba(125,211,252,.12);border:1px solid rgba(125,211,252,.35)}" +
      ".ad-cf-indicative{color:#fbbf24;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35)}" +
      ".ad-badge{font:700 10px 'IBM Plex Mono',monospace;padding:1px 6px;border-radius:4px;margin-left:5px;white-space:nowrap;cursor:help}" +
      ".ad-spv{color:#fda4af;background:rgba(224,69,58,.16);border:1px solid rgba(224,69,58,.5)}" +
      ".ad-sub{color:#c4b5fd;background:rgba(139,92,246,.14);border:1px solid rgba(139,92,246,.45)}" +
      ".ad-excl{color:var(--faint);background:transparent;border:1px dashed var(--line2)}" +
      ".ad-t tr.ad-ex td{opacity:.8}" +
      ".ad-ft{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);border-top:1px solid var(--line);padding-top:10px;margin-top:6px}" +
      ".ad-verdict{display:flex;gap:14px;align-items:flex-start;border-radius:10px;padding:14px 16px;margin-bottom:14px;border:1px solid var(--line2)}" +
      ".ad-v-yes{background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.45)}" +
      ".ad-v-no{background:rgba(224,69,58,.08);border-color:rgba(224,69,58,.5)}" +
      ".ad-v-un{background:rgba(251,191,36,.06);border-color:rgba(251,191,36,.35)}" +
      ".ad-v-word{font:800 22px 'IBM Plex Mono',monospace;flex:0 0 auto;padding-top:2px}" +
      ".ad-v-yes .ad-v-word{color:#4ade80}.ad-v-no .ad-v-word{color:#ff8a84}.ad-v-un .ad-v-word{color:#fbbf24}" +
      ".ad-v-body{min-width:0}" +
      ".ad-v-t{font:600 13px 'IBM Plex Mono',monospace}" +
      ".ad-v-n{font:12.5px 'IBM Plex Mono',monospace;color:var(--muted);margin-top:6px}" +
      ".ad-v-b{font-size:12.5px;color:var(--ink);margin-top:6px;line-height:1.55}" +
      ".ad-v-s{font:11px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:8px}" +
      ".ad-sec{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}" +
      ".ad-sec h2{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}" +
      ".ad-sec-sub{font-size:11.5px;color:var(--faint);text-transform:none;letter-spacing:0}" +
      ".ad-yl{width:100%;height:64px;display:block}" +
      ".ad-yl-h{font:600 11.5px 'IBM Plex Mono',monospace;color:#fbbf24;margin-bottom:2px}" +
      ".ad-ach-bars{display:flex;gap:6px;height:150px;padding:8px 2px 0;border-bottom:1px solid var(--line2)}" +
      ".ad-ach-y{flex:1;display:flex;flex-direction:column;min-width:0}" +
      ".ad-ach-g{flex:1;display:flex;gap:3px;align-items:flex-end;justify-content:center}" +
      ".ad-ach-b{flex:1;max-width:30px;border-radius:3px 3px 0 0;min-height:2px}" +
      ".ad-b-debt{background:#38b6c9}.ad-b-raised{background:#3b82f6}.ad-b-mat{background:#f59e0b}" +
      ".ad-b-disc{background:repeating-linear-gradient(45deg,rgba(245,158,11,.75) 0 4px,rgba(245,158,11,.2) 4px 8px)}" +
      ".ad-b-refi{background:transparent;border:1.5px dashed #f59e0b;box-sizing:border-box}" +
      ".ad-b-close{background:#38b6c9;opacity:.45}" +
      ".ad-b-none{background:transparent;color:var(--faint);display:flex;align-items:flex-end;justify-content:center;font:11px 'IBM Plex Mono',monospace}" +
      ".ad-ach-l{font:11px 'IBM Plex Mono',monospace;color:var(--faint);text-align:center;margin-top:6px}" +
      ".ad-ach-fwd .ad-ach-l{color:#f59e0b}" +
      ".ad-leg{display:flex;flex-wrap:wrap;gap:12px;font:11.5px 'IBM Plex Mono',monospace;color:var(--muted);margin:10px 0 12px}" +
      ".ad-leg .sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}" +
      ".ad-yl-sw{background:#fbbf24;border-radius:50%!important}" +
      ".ad-k-tag{font:700 10px 'IBM Plex Mono',monospace;padding:1px 6px;border-radius:4px;white-space:nowrap}" +
      ".ad-k-act{color:#4ade80;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.35)}" +
      ".ad-k-disc{color:#f59e0b;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}" +
      ".ad-k-est{color:#7dd3fc;background:rgba(125,211,252,.1);border:1px dashed rgba(125,211,252,.45)}" +
      ".ad-fwd td{color:var(--muted)}" +
      ".ad-coh td{font:700 11.5px 'IBM Plex Mono',monospace;color:var(--muted);background:var(--panel);text-transform:uppercase;letter-spacing:.05em}" +
      ".ad-cap-t td:first-child{font-weight:600;color:var(--ink)}" +
      ".ad-cap-t td:nth-child(2){font-weight:700}" +
      ".ad-vrow td{font-weight:700;background:rgba(56,182,201,.05)}" +
      ".ad-h3{margin:14px 0 6px;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}" +
      ".ad-svg{width:100%;display:block}" +
      ".ad-flags{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px}" +
      ".ad-flag{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel)}" +
      ".ad-flag.ad-fl-on{border-color:rgba(224,69,58,.5)}" +
      ".ad-fl-h{display:flex;justify-content:space-between;gap:8px;align-items:center}" +
      ".ad-fl-t{font:700 12.5px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.05em}" +
      ".ad-fl-w{font:800 11px 'IBM Plex Mono',monospace;padding:2px 8px;border-radius:5px;white-space:nowrap}" +
      ".ad-fl-on .ad-fl-w{color:#ff8a84;background:rgba(224,69,58,.14);border:1px solid rgba(224,69,58,.5)}" +
      ".ad-fl-off .ad-fl-w{color:#4ade80;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.35)}" +
      ".ad-fl-na .ad-fl-w{color:#fbbf24;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35)}" +
      ".ad-fl-r{font-size:11.5px;color:var(--muted);margin-top:6px}" +
      ".ad-fl-s{font:12px 'IBM Plex Mono',monospace;margin-top:4px}" +
      ".ad-fl-d{font:11px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:6px;line-height:1.5}" +
      ".ad-cost-warn{background:rgba(224,69,58,.1);border:1px solid rgba(224,69,58,.5);border-radius:8px;padding:10px 12px;font-size:12.5px;margin-bottom:12px}" +
      ".ad-lad-hl{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.4);border-radius:8px;padding:8px 12px;font-size:12.5px;margin-bottom:8px}" +
"@media (max-width:760px){.ad-hd h1{font-size:19px}.ad-flt select{max-width:100%}.ad-body{flex-direction:column}.ad-co{flex:none;width:100%;position:static}.ad-co-list{flex-direction:row;overflow-x:auto;padding-bottom:4px}.ad-co-b{white-space:nowrap;width:auto}}" +
      "</style>";
    var hd = '<div class="ad-hd"><div><h1>AI Debt</h1><div class="sub">AI-company debt raises, Jan 2021 – Nov 2026</div></div>' +
      '<div class="ad-dt">Verified 2026-11-11 · 406 raises · 15 companies</div></div>';
    var list = '<aside class="ad-co"><div class="ad-co-h">Companies <span>' + cos.length + '</span></div><div class="ad-co-list">' +
      cos.map(function (co) { return '<button type="button" class="ad-co-b" data-co="' + esc(co) + '"><span class="n">' + esc(co) + '</span><span class="c">' + counts[co] + "</span></button>"; }).join("") +
      "</div></aside>";
    var ruler = '<div class="ad-ruler-h">Filter by year — tap a year or drag across the ruler</div><div class="ad-ruler" id="ad-ruler">' +
      RULER_POS.map(function (y) { return '<button type="button" class="ad-tk" data-yr="' + y + '">' + (y || "All") + "</button>"; }).join("") + "</div>";
    var main = '<div class="ad-main">' +
      '<div class="ad-seg" role="tablist"><button type="button" data-view="summary">Summary</button><button type="button" data-view="details">Details</button></div>' +
      ruler + '<div id="ad-view"></div></div>';
    var foot = '<div class="ad-ft">Verified 2026-11-11 · coupon, market yield and all-in rate are separate fields · sources per row (click a row to expand). Amounts in USD billions — non-USD amounts converted at the issue-month average FX rate (FRED H.10 daily); original amount and currency retained per row. Total raised follows the research\u2019s documented per-company total — for most companies the parent company\u2019s own funded debt; for CoreWeave, Crusoe, Lambda, Nebius and Nscale it includes the project-vehicle / SPV facilities the research counts as raised debt. Items excluded from a total (undrawn facilities, leases, subsidiary debt, undocumented items) are still shown in Details, marked \u2018excluded from total\u2019. SPV = SPV / project-entity borrower, not the parent company\u2019s own debt · SUB = subsidiary borrower. Data: SEC EDGAR filings, prospectuses, company IR, reputable press; 362 CONFIRMED · 38 REPORTED · 6 INDICATIVE. Enhancement v2: fiscal-year annual debt profile, cost of debt, 5-year maturity ladder, refinancing stress scenarios, debt sustainability and rule-based warning flags from SEC EDGAR filings (ai-debt-enhancement.json v2, generated 2026-11-12) — every figure carries its filing accession and period; fiscal years are the company’s reporting period and gross raised is calendar-year (issue month); forward years are disclosed maturities or labelled estimates, never invented.</div>';
    P.innerHTML = head + '<div class="ad">' + hd + '<div class="ad-body">' + list + main + "</div>" + foot + "</div>";
    BUILT = true;
    update();
  }
  function update() {
    if (!D || !BUILT) return;
    var tks = P.querySelectorAll(".ad-tk"), i;
    for (i = 0; i < tks.length; i++) { if (tks[i].getAttribute("data-yr") === F.yr) tks[i].classList.add("on"); else tks[i].classList.remove("on"); }
    var segs = P.querySelectorAll("[data-view]");
    for (i = 0; i < segs.length; i++) { if (segs[i].getAttribute("data-view") === F.view) segs[i].classList.add("on"); else segs[i].classList.remove("on"); }
    var cbs = P.querySelectorAll("[data-co]");
    for (i = 0; i < cbs.length; i++) { if (cbs[i].getAttribute("data-co") === F.co) cbs[i].classList.add("on"); else cbs[i].classList.remove("on"); }
    var v = P.querySelector("#ad-view");
    if (v) v.innerHTML = F.view === "details" ? detailsHTML() : summaryHTML();
  }
  function setYear(y) {
    if (F.yr === y) return;
    F.yr = y;
    if (F.inst) {
      var ok = yrRows().some(function (r) { return r.instrument_type === F.inst; });
      if (!ok) F.inst = "";
    }
    update();
  }
  function setCompany(co) {
    if (F.co === co) return;
    F.co = co; F.inst = ""; F.cf = "";
    render();
  }
  function setView(v) {
    if (F.view === v) return;
    F.view = v;
    render();
  }
  function yearFromEvent(e) {
    var r = P.querySelector("#ad-ruler"), b, idx;
    if (r && r.getBoundingClientRect) {
      b = r.getBoundingClientRect();
      if (b && b.width > 0) {
        idx = Math.floor(((e.clientX - b.left) / b.width) * RULER_POS.length);
        idx = Math.max(0, Math.min(RULER_POS.length - 1, idx));
        return RULER_POS[idx];
      }
    }
    var tk = e.target && e.target.closest ? e.target.closest(".ad-tk") : null;
    return tk ? tk.getAttribute("data-yr") : null;
  }
  /* One delegated click handler for the whole panel (survives re-renders). */
  P.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var co = t.closest("[data-co]");
    if (co) { setCompany(co.getAttribute("data-co")); return; }
    var vw = t.closest("[data-view]");
    if (vw) { setView(vw.getAttribute("data-view")); return; }
    if (t.closest("#ad-reset")) { F.inst = ""; F.cf = ""; update(); return; }
    var tk = t.closest(".ad-tk");
    if (tk) { setYear(tk.getAttribute("data-yr")); return; }
    var tr = t.closest("tr[data-i]");
    if (tr) {
      var nx = tr.nextSibling;
      if (nx && nx.className && nx.className.indexOf("ad-det") >= 0) { nx.parentNode.removeChild(nx); return; }
      var tmp = document.createElement("tbody"); tmp.innerHTML = detailHTML(D.rows[+tr.getAttribute("data-i")]);
      tr.parentNode.insertBefore(tmp.firstChild, tr.nextSibling);
    }
  });
  P.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === "ad-f-inst") { F.inst = t.value; update(); }
    else if (t.id === "ad-f-cf") { F.cf = t.value; update(); }
  });
  /* Year ruler: tap to select, drag/scrub to move across years (mouse + touch). */
  P.addEventListener("pointerdown", function (e) {
    var r = e.target && e.target.closest ? e.target.closest(".ad-ruler") : null;
    if (!r) return;
    if (e.button != null && e.button !== 0) return;
    scrub = true;
    if (e.preventDefault) e.preventDefault();
    if (r.setPointerCapture && e.pointerId != null) { try { r.setPointerCapture(e.pointerId); } catch (err) {} }
    var y = yearFromEvent(e);
    if (y !== null) setYear(y);
  });
  P.addEventListener("pointermove", function (e) {
    if (!scrub) return;
    var y = yearFromEvent(e);
    if (y !== null) setYear(y);
  });
  P.addEventListener("pointerup", function () { scrub = false; });
  P.addEventListener("pointercancel", function () { scrub = false; });
  BTN.addEventListener("click", function () { setTimeout(render, 0); });
  window.addEventListener("desk:unlock", function () { setTimeout(render, 300); });
  window.addEventListener("desk:data", render);
})();
