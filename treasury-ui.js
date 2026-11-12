/* treasury-ui.js — US Government Debt dashboard (tab "Treasury"). REBUILT Nov 2026.
   Live snapshot: DATA.ust, built by scripts/update_data.py ust() from the Treasury's own Fiscal Data API —
   Debt to the Penny (daily), Monthly Statement of the Public Debt tables 1 & 3 (every marketable security and its
   maturity), Average Interest Rates. Re-checked every 6h by the refresh workflow; a new monthly statement is
   picked up within ~6h of Treasury publishing it.
   Dashboard data: us-debt-dashboard.json (same directory) — annual history FY2015–2026, forward FY2027–2028
   (CBO Feb 2026 baseline), refinancing cost, servicing capacity, risk indicators; official sources only
   (FiscalData, FRED, CBO). Estimates are labelled as such; nothing is invented. */
(function () {
  "use strict";
  var P = document.getElementById("panel-treasury"), BTN = document.getElementById("tabbtn-treasury");
  if (!P || !BTN) return;
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function T(v, d) { return v == null ? "N/A" : "$" + (+v).toFixed(d == null ? 2 : d) + "T"; }
  function B(v) { return v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US") + " B"; }
  function B1(v) { return v == null ? "—" : "$" + (+v).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " B"; }
  function pc(v, d) { return v == null ? "—" : (+v).toFixed(d == null ? 1 : d) + "%"; }
  function dLbl(s) { return s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—"; }
  function heat(v, mx) { if (!v) return "tq-h0"; var r = v / mx; return r > 0.8 ? "tq-h4" : r > 0.6 ? "tq-h3" : r > 0.4 ? "tq-h2" : "tq-h1"; }
  function kpi(t, v, sub, cls) { return '<div class="tq-k ' + (cls || "") + '"><div class="t">' + t + '</div><div class="v">' + v + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>"; }
  function sec(id, title, sub, inner) {
    return '<section class="tq-p" id="' + id + '"><div class="tq-ph"><h2>' + title + '</h2>' + (sub ? "<span>" + sub + "</span>" : "") + "</div>" + inner + "</section>";
  }

  /* dashboard data (annual history, forward, servicing, risk) — same directory; live snapshot stays on DATA.ust */
  var DASH = null, DASH_TRIED = false, DASH_FAILED = false;
  function loadDash() {
    if (DASH_TRIED) return;
    DASH_TRIED = true;
    if (typeof fetch !== "function") { DASH_FAILED = true; return; }
    fetch("us-debt-dashboard.json").then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (j) { DASH = j; render(); })
      .catch(function () { DASH_FAILED = true; render(); });
  }

  /* ---- annual debt & borrowing chart (FY2015–2026 actuals + FY2027–2028 forward) ---- */
  function annualChart(D) {
    var H = D.annual_history_fy2015_2026 || [];
    var F = D.forward_borrowing_need || {};
    if (!H.length) return "";
    /* forward years as chart rows: maturing = disclosed (MSPD-confirmed), gross + total debt = model estimates */
    var yrs = H.map(function (r) {
      return { fy: r.fiscal_year, debt: r.total_debt_T, gross: r.gross_marketable_issuance_T, net: r.net_new_borrowing_T, refi: r.refinancing_issuance_T, mat: r.maturities_actual_T, yld: r.wa_marketable_rate_pct, fwd: false };
    });
    [["fy2027", 2027], ["fy2028", 2028]].forEach(function (kv) {
      var f = F[kv[0]]; if (!f) return;
      yrs.push({ fy: kv[1], debt: f.total_debt_estimate_B / 1000, gross: f.expected_gross_issuance_B / 1000, net: -f.cbo_deficit_B / 1000, refi: f.expected_gross_issuance_B / 1000 + f.cbo_deficit_B / 1000, mat: f.principal_maturing_B / 1000, yld: null, fwd: true });
    });
    var maxV = 0; yrs.forEach(function (y) { maxV = Math.max(maxV, y.debt || 0, y.gross || 0, y.mat || 0); });
    if (!maxV) return "";
    /* SVG geometry: 14 groups x 64px + margins */
    var L = 46, R = 46, TOP = 28, PH = 210, GW = 64, W = L + yrs.length * GW + R, HGT = TOP + PH + 34;
    var yv = function (v) { return TOP + PH - (v / maxV) * PH; };
    var yy = function (r) { return TOP + PH - (r / 5) * PH; };
    var cx = function (i) { return L + i * GW + GW / 2; };
    var COL = { debt: "#38b6c9", gross: "#f59e0b", mat: "#ef4444" };
    var s = '<svg class="tq-svg" viewBox="0 0 ' + W + " " + HGT + '" role="img" aria-label="Annual US Treasury debt, gross issuance and maturities, FY2015–FY2028">';
    s += '<defs><pattern id="tq-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#3f1d1d"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" stroke-width="1.6"/></pattern></defs>';
    /* gridlines + left ($T) and right (%) axes */
    [0, 10, 20, 30, 40].forEach(function (g) {
      var y = yv(g);
      s += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" class="tq-gl"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" class="tq-ax" text-anchor="end">$' + g + "T</text>";
    });
    [0, 1, 2, 3, 4, 5].forEach(function (g) {
      s += '<text x="' + (W - R + 6) + '" y="' + (yy(g) + 4).toFixed(1) + '" class="tq-ax" text-anchor="start">' + g + "%</text>";
    });
    /* bars: debt, gross, maturing — solid actuals; forward maturing hatched (disclosed), forward gross/debt faded + dashed (estimate) */
    /* data labels: one per bar; per-series stagger, then nudge any label that would overlap a neighbour up until clear */
    var LAB = { debt: 4, gross: 14, mat: 26 }, lbls = [];
    yrs.forEach(function (y, i) {
      var gx = L + i * GW;
      [["debt", y.debt, 0], ["gross", y.gross, 18], ["mat", y.mat, 36]].forEach(function (b) {
        var v = b[1]; if (v == null || v <= 0) return;
        var x = gx + b[2], h = (v / maxV) * PH, yy0 = TOP + PH - h;
        var cls = "", fill = COL[b[0]], extra = "";
        if (y.fwd) {
          if (b[0] === "mat") { fill = "url(#tq-hatch)"; extra = ' stroke="#ef4444" stroke-width="1"'; }
          else { extra = ' opacity="0.45" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="3,2"'; }
        }
        s += '<rect x="' + x + '" y="' + yy0.toFixed(1) + '" width="15" height="' + h.toFixed(1) + '" fill="' + fill + '"' + extra + '><title>FY' + y.fy + " " + (b[0] === "debt" ? "total debt" : b[0] === "gross" ? "gross raised" : "maturing") + ": $" + v.toFixed(2) + "T" + (y.fwd ? (b[0] === "mat" ? " — disclosed (MSPD-confirmed)" : " — estimate") : "") + "</title></rect>";
        lbls.push({ x: x + 7.5, y: yy0 - LAB[b[0]], t: "$" + v.toFixed(2) + "T" });
      });
      s += '<text x="' + cx(i) + '" y="' + (TOP + PH + 16) + '" class="tq-ax" text-anchor="middle">FY' + String(y.fy).slice(2) + (y.fwd ? "*" : "") + "</text>";
    });
    lbls.forEach(function (lb, i) {
      var guard = 0, hit = true;
      while (hit && guard < 8 && lb.y > 12) {
        hit = false;
        for (var j = 0; j < i; j++) {
          if (Math.abs(lbls[j].x - lb.x) < 38 && Math.abs(lbls[j].y - lb.y) < 9) { lb.y -= 10; hit = true; guard++; break; }
        }
      }
      s += '<text x="' + lb.x.toFixed(1) + '" y="' + lb.y.toFixed(1) + '" class="tq-blbl" text-anchor="middle">' + lb.t + "</text>";
    });
    /* WA yield trend line: solid actuals; dashed CBO 10Y assumption (4.3%) for the forward years */
    var pts = []; yrs.forEach(function (y, i) { if (y.yld != null) pts.push([cx(i), yy(y.yld)]); });
    if (pts.length > 1) {
      s += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '" class="tq-yl"/>';
      pts.forEach(function (p) { s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" class="tq-yd"/>'; });
      var lp = pts[pts.length - 1];
      s += '<polyline points="' + lp[0].toFixed(1) + "," + lp[1].toFixed(1) + " " + cx(yrs.length - 2).toFixed(1) + "," + yy(4.3).toFixed(1) + " " + cx(yrs.length - 1).toFixed(1) + "," + yy(4.3).toFixed(1) + '" class="tq-yl2"/>';
      s += '<text x="' + L + '" y="13" class="tq-ylbl">⚠️ WA yield on marketable debt (right axis, %)</text>';
      s += '<text x="' + (cx(yrs.length - 1) + 4) + '" y="' + (yy(4.3) - 8).toFixed(1) + '" class="tq-ylbl2" text-anchor="end">CBO 10Y assumption 4.3% (dashed — not WA yield)</text>';
    }
    s += "</svg>";
    /* legend */
    s += '<div class="tq-lg2"><span><i style="background:#38b6c9"></i>Total debt at year-end ($T)</span><span><i style="background:#f59e0b"></i>Gross debt raised ($T)</span><span><i style="background:#ef4444"></i>Principal maturing ($T)</span><span><i class="tq-sw-hatch"></i>Disclosed maturities (forward, MSPD-confirmed)</span><span><i class="tq-sw-est"></i>Model estimate (forward)</span><span><i class="tq-sw-yl"></i>⚠️ WA yield on marketable debt</span></div>';
    /* exact-figure table under the chart — TRANSPOSED: years are the columns, metrics are the rows (same figures, no re-derivation) */
    var MET = [["Total debt", function (y) { return T(y.debt); }], ["Gross raised", function (y) { return T(y.gross); }], ["Net new borrowing", function (y) { return T(y.net); }], ["Refinancing", function (y) { return T(y.refi); }], ["Maturing", function (y) { return T(y.mat); }], ["⚠️ WA yield", function (y) { return y.yld != null ? y.yld.toFixed(2) + "%" : "—"; }]];
    var head = '<tr><th>Metric</th>' + yrs.map(function (y) { return '<th' + (y.fwd ? ' class="tq-fwd"' : "") + '>FY' + y.fy + (y.fwd ? " <i>projection</i>" : "") + "</th>"; }).join("") + "</tr>";
    var rows = MET.map(function (m) {
      return '<tr><th scope="row">' + m[0] + "</th>" + yrs.map(function (y) { return '<td' + (y.fwd ? ' class="tq-fwd"' : "") + ">" + m[1](y) + "</td>"; }).join("") + "</tr>";
    }).join("");
    s += '<div class="tbl-scroll"><table class="tq-t tq-ann"><thead>' + head + '</thead><tbody>' + rows + "</tbody></table></div>";
    s += '<div class="tq-note">Gross issuance = net new borrowing + refinancing issuance (gross − net). Refinancing is NOT new borrowing — it rolls maturing principal. Maturing = gross − net (identity), which captures within-year bill turnover; the MSPD scheduled maturities at the prior year-end are smaller (see gaps). * FY2027–2028 are projections: maturities are disclosed (MSPD-confirmed), gross issuance and closing debt are model estimates on the CBO Feb 2026 baseline. WA yield = FiscalData average interest rate on marketable debt at Sep 30. Sources: FiscalData Debt to the Penny, MSPD, Average Interest Rates, Auctions API.</div>';
    return s;
  }

  /* ---- debt-spiral gauge: interest-cost growth vs receipts growth (computed from the annual history) ---- */
  function spiralGauge(D) {
    var H = D.annual_history_fy2015_2026 || [];
    function row(fy) { for (var i = 0; i < H.length; i++) if (H[i].fiscal_year === fy) return H[i]; return null; }
    var a = row(2015), b = row(2023), c = row(2026);
    if (!a || !b || !c) return "";
    function g(x, y) { return (y / x - 1) * 100; }
    var i3 = g(b.net_interest_T, c.net_interest_T), r3 = g(b.receipts_T, c.receipts_T);
    var i11 = g(a.net_interest_T, c.net_interest_T), r11 = g(a.receipts_T, c.receipts_T);
    var ratio3 = i3 / r3, ratio11 = i11 / r11;
    var verdict = ratio3 > 2 ? ["ELEVATED", "tq-sp-el"] : ratio3 > 1 ? ["WATCH", "tq-sp-wa"] : ["STABLE", "tq-sp-ok"];
    return '<div class="tq-sp ' + verdict[1] + '"><div><b>Debt-spiral gauge: ' + verdict[0] + '</b><span>net interest is growing ' + ratio3.toFixed(1) + '× faster than receipts over the last 3 years (' + ratio11.toFixed(1) + '× over 11 years)</span></div>' +
      '<div class="tq-spn">Net interest FY2023→FY2026: + ' + i3.toFixed(1) + '% ($' + b.net_interest_T.toFixed(2) + 'T → $' + c.net_interest_T.toFixed(2) + 'T) · Receipts: +' + r3.toFixed(1) + '% ($' + b.receipts_T.toFixed(2) + 'T → $' + c.receipts_T.toFixed(2) + 'T)<br>' +
      'Method: period growth = (end ÷ start − 1); gauge = interest growth ÷ receipts growth. Ratio &gt; 2 = elevated (interest compounding faster than the revenue base); 1–2 = watch; &lt; 1 = stable. Computed from the annual history (MTS / FiscalData), not a forecast.</div></div>';
  }

  function render() {
    var U = window.DATA && DATA.ust;
    if (!U) { P.innerHTML = '<div class="tile wide"><h2>U.S. Treasury debt maturity wall</h2><p class="note">Loads with the next data refresh (official Treasury Fiscal Data).</p></div>'; return; }
    var mk = U.marketable_t, p12 = U.due12_t / mk * 100, p24 = U.due24_t / mk * 100;
    var D = DASH || null;
    var head = '<div class="tq-hd"><div><h1>U.S. Treasury Debt</h1><div class="sub">Historical borrowing · maturity &amp; refinancing risk</div></div>' +
      '<div class="tq-dt">Debt to the Penny ' + esc(dLbl(U.penny_date)) + " · MSPD " + esc(dLbl(U.asof)) + "</div></div>";

    /* (a) KPI row — live tiles kept; dashboard tiles added when the JSON is loaded */
    var kp = '<div class="tq-kpi">' +
      kpi("Total U.S. debt", T(U.total_debt_t), "public " + T(U.public_t) + " · intragov " + T(U.intragov_t)) +
      kpi("Marketable debt", T(mk), U.n_securities + " securities") +
      kpi("12M maturing", T(U.due12_t), p12.toFixed(1) + "% of marketable · from " + esc(dLbl(U.asof)), "hi") +
      kpi("24M maturing", T(U.due24_t), p24.toFixed(1) + "% of marketable · from " + esc(dLbl(U.asof)), "al") +
      kpi("Weighted avg maturity", Math.round(U.wam_months) + " mos", (U.wam_months / 12).toFixed(2) + " years") +
      kpi("WA interest rate", U.wa_rate != null ? U.wa_rate.toFixed(3) + "%" : "N/A", "marketable, " + esc(dLbl(U.rates_date)));
    if (D && D.servicing_capacity && D.risk_indicators) {
      kp += kpi("Net interest / receipts", pc(D.servicing_capacity.net_interest_pct_receipts, 2), "FY2026 · net interest " + T(D.servicing_capacity.net_interest_T), "al") +
        kpi("TGA cash balance", B(D.servicing_capacity.tga_balance_B), "Daily Treasury Statement · " + esc(dLbl(D.servicing_capacity.tga_balance_date))) +
        kpi("Debt held by public / GDP", pc(D.risk_indicators.debt_held_public_pct_gdp_fy2026_actual, 1), "FY2026 actual · CBO 2036: " + pc(D.risk_indicators.cbo_debt_held_public_pct_gdp_2036, 1) + " (projection)");
    }
    kp += "</div>";

    /* (b) annual debt & borrowing chart */
    var ann = "";
    if (D && D.annual_history_fy2015_2026) {
      ann = sec("tq-annual", "Annual debt &amp; borrowing — FY2015–2028",
        "actuals FY2015–2026 · projections FY2027–2028 (CBO Feb 2026 baseline) · $ trillions",
        annualChart(D));
    } else if (DASH_FAILED) {
      ann = sec("tq-annual", "Annual debt &amp; borrowing — FY2015–2028", "",
        '<p class="note">Dashboard data (us-debt-dashboard.json) is not available on this deployment yet — the annual history, servicing capacity and risk sections will appear once it is published. The live snapshot above is current.</p>');
    }

    /* (c) forward maturity & refinancing — the existing 24-month wall, kept verbatim, plus a forward summary */
    var W = U.wall || {}, keys = Object.keys(W).sort().slice(0, 24), yrs = [], mx = 0;
    var nowM = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7), past = keys.filter(function (k) { return k < nowM; });
    keys.forEach(function (k) { var y = k.slice(0, 4); if (yrs.indexOf(y) < 0) yrs.push(y); mx = Math.max(mx, W[k]); });
    var rows = MON.map(function (m, i) {
      var mm = ("0" + (i + 1)).slice(-2);
      return "<tr><td class=\"m\">" + m + "</td>" + yrs.map(function (y) { var v = keys.indexOf(y + "-" + mm) >= 0 ? W[y + "-" + mm] : null;
        var gone = v && y + "-" + mm < nowM;
        return '<td><div class="tq-c ' + (gone ? "tq-past" : heat(v, mx)) + '"' + (gone ? ' title="Matured after the statement date — already repaid / rolled into new debt"' : "") + ">" + (v ? B(v) : "—") + (gone ? '<i>matured</i>' : "") + "</div></td>"; }).join("") + "</tr>";
    }).join("");
    var totals = "<tr class=\"tot\"><td>Total in window</td>" + yrs.map(function (y) { var s = 0; keys.forEach(function (k) { if (k.slice(0, 4) === y) s += W[k]; }); return "<td>" + B(s) + "</td>"; }).join("") + "</tr>";
    var wall = '<section class="tq-p tq-wall"><div class="tq-ph"><h2>24-month maturity concentration</h2><span>principal maturing in the 24 months after the MSPD statement date, $ billions · bills at maturity value' + (past.length ? " · greyed months have already matured and rolled; refreshes when Treasury publishes the next monthly statement (early each month)" : "") + '</span></div>' +
      '<div class="tbl-scroll"><table class="tq-t"><thead><tr><th>Month</th>' + yrs.map(function (y) { return "<th>" + y + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + totals + "</tbody></table></div></section>";
    var fwdSum = "";
    if (D && D.forward_borrowing_need) {
      var f27 = D.forward_borrowing_need.fy2027, f28 = D.forward_borrowing_need.fy2028;
      fwdSum = sec("tq-fwdsum", "Forward borrowing need — FY2027 &amp; FY2028",
        "projection — CBO Feb 2026 baseline · maturities are MSPD-confirmed, gross issuance &amp; closing debt are estimates",
        '<div class="tbl-scroll"><table class="tq-t tq-ann"><thead><tr><th></th><th>Principal maturing (disclosed)</th><th>CBO deficit (new borrowing)</th><th>Expected gross issuance</th><th>Projected closing debt</th></tr></thead><tbody>' +
        "<tr><td>FY2027</td><td>" + B(f27.principal_maturing_B) + "</td><td>" + B(-f27.cbo_deficit_B) + "</td><td>" + B(f27.expected_gross_issuance_B) + " <i>estimate</i></td><td>" + T(f27.total_debt_estimate_B / 1000) + " <i>estimate</i></td></tr>" +
        "<tr><td>FY2028</td><td>" + B(f28.principal_maturing_B) + "</td><td>" + B(-f28.cbo_deficit_B) + "</td><td>" + B(f28.expected_gross_issuance_B) + " <i>estimate</i></td><td>" + T(f28.total_debt_estimate_B / 1000) + " <i>estimate</i></td></tr>" +
        '</tbody></table></div><div class="tq-note">FY2028 maturities are confirmed maturities only — securities outstanding as of Oct 31, 2026. Bills issued during FY2027 that mature in FY2028 are not in the snapshot, so FY2028 maturities and gross issuance will rise as new bills are issued. Tariff caveat: CBO has not published a revised baseline after the Mar 2026 ruling; the Feb FY2027–2028 deficits are likely understated by ~$150–200B/yr (estimate, not a CBO figure).</div>');
    }

    /* current maturity profile (kept) */
    var PT = U.profile.reduce(function (a, x) { return a + x.bn; }, 0), COL = ["#ef4444", "#f97316", "#f59e0b", "#3b82f6", "#6366f1", "#a855f7"];
    var prof = '<section class="tq-p"><h2>Current maturity profile</h2><div class="tq-bar">' + U.profile.map(function (x, i) { var pc2 = x.bn / PT * 100;
        return '<div style="width:' + pc2.toFixed(2) + "%;background:" + COL[i] + '" title="' + esc(x.label) + ": " + B(x.bn) + " (" + pc2.toFixed(1) + '%)">' + (pc2 > 9 ? Math.round(pc2) + "%" : "") + "</div>"; }).join("") + "</div>" +
      '<div class="tq-lg">' + U.profile.map(function (x, i) { return '<div><i style="background:' + COL[i] + '"></i>' + esc(x.label) + "<b>" + (x.bn / PT * 100).toFixed(1) + "%</b></div>"; }).join("") + "</div></section>";

    /* (d) refinancing cost & interest impact */
    var rc = "";
    if (D && D.refinancing_cost) {
      var R = D.refinancing_cost, s12 = R.sensitivity_12M_B_per_year, s24 = R.sensitivity_24M_B_per_year;
      var ni26 = null, gdp26 = null;
      (D.annual_history_fy2015_2026 || []).forEach(function (r) { if (r.fiscal_year === 2026) { ni26 = r.net_interest_T; gdp26 = r.fy_nominal_gdp_T; } });
      var imp12 = ni26 ? (s12["+100bps"] / (ni26 * 1000) * 100) : null, imp24 = ni26 ? (s24["+100bps"] / (ni26 * 1000) * 100) : null;
      var gdp12 = gdp26 ? (s12["+100bps"] / (gdp26 * 1000) * 100) : null, gdp24 = gdp26 ? (s24["+100bps"] / (gdp26 * 1000) * 100) : null;
      rc = sec("tq-refi", "Refinancing cost &amp; interest impact",
        "blended refinancing yield is an estimate (method below) · existing cost of the maturing stock is an approximation",
        '<div class="tbl-scroll"><table class="tq-t tq-ann"><thead><tr><th>Cohort</th><th>Principal</th><th>Existing cost (est.)</th><th>Blended refinancing yield (est.)</th><th>Incremental interest / yr</th></tr></thead><tbody>' +
        "<tr><td>Maturing next 12M</td><td>" + B(R.maturing_12M.principal_B) + "</td><td>" + pc(R.maturing_12M.estimated_existing_cost_pct, 2) + "</td><td>" + pc(R.maturing_12M.blended_refinancing_yield_pct, 2) + "</td><td><b>+$" + R.maturing_12M.incremental_annual_interest_B.toFixed(1) + "B / yr</b></td></tr>" +
        "<tr><td>Maturing next 24M</td><td>" + B(R.maturing_24M.principal_B) + "</td><td>" + pc(R.maturing_24M.estimated_existing_cost_pct, 2) + "</td><td>" + pc(R.maturing_24M.blended_refinancing_yield_pct, 2) + "</td><td><b>+$" + R.maturing_24M.incremental_annual_interest_B.toFixed(1) + "B / yr</b></td></tr>" +
        '</tbody></table></div>' +
        '<div class="tq-note">Cumulative incremental interest over 2 years (as the 24M cohort rolls): <b>+$' + R.cumulative_2yr_incremental_B.toFixed(1) + 'B</b> (research estimate, method in the data file). Existing cost: bills at the WA bill rate (3.87%, FiscalData Sep 2026), coupon-bearing debt at its WA coupon; bills\u2019 true issue yields are not in the MSPD, so this is an approximation. Blended refinancing yield weights Nov 9, 2026 market yields by maturing principal by class (bills 3M 4.06%, notes mean of 2Y/5Y 4.62%, FRNs 4.15%, TIPS 4.50% nominal-equivalent, bonds 5.00%).</div>' +
        '<h3 class="tq-h3">Sensitivity — extra annual interest if the cohort rolls at a higher yield</h3>' +
        '<div class="tbl-scroll"><table class="tq-t tq-sens"><thead><tr><th>Rate shock</th><th>12M stock ($B / yr)</th><th>24M stock ($B / yr)</th></tr></thead><tbody>' +
        ["+50bps", "+100bps", "+200bps"].map(function (k) { return "<tr><td>" + k + "</td><td>+$" + s12[k].toFixed(1) + "B</td><td>+$" + s24[k].toFixed(1) + "B</td></tr>"; }).join("") +
        '</tbody></table></div>' +
        '<div class="tq-note">Impact on FY2026 federal net interest ($' + (ni26 ? ni26.toFixed(2) + "T" : "—") + '): a +100 bps shock on the 12M stock adds $' + s12["+100bps"].toFixed(1) + 'B/yr (' + (imp12 != null ? "+" + imp12.toFixed(1) + "% of net interest" : "—") + ", +" + (gdp12 != null ? gdp12.toFixed(2) : "—") + 'pp of GDP); on the 24M stock it adds $' + s24["+100bps"].toFixed(1) + 'B/yr (' + (imp24 != null ? "+" + imp24.toFixed(1) + "% of net interest" : "—") + ", +" + (gdp24 != null ? gdp24.toFixed(2) : "—") + 'pp of GDP). Simple arithmetic on the maturing principal; before any change in issuance mix or deficits. Not a forecast.</div>');
    }
    /* existing rate-shock panel (kept, live) */
    var sc = '<section class="tq-p"><h2>Refinancing rate shock</h2><div class="sub">extra annual interest if the 24-month cohort (' + T(U.due24_t) + ") rolls at a higher rate</div>" +
      [25, 50, 100, 200].map(function (b) { return '<div class="tq-sc"><span>+' + b + ' bps</span><b>+$' + Math.round(U.due24_t * 1000 * b / 10000) + "B / yr</b></div>"; }).join("") +
      '<div class="tq-note">Simple arithmetic: maturing principal × rate change, before any change in issuance mix or deficits. Not a forecast.</div></section>';

    /* maturity composition & existing interest cost (kept) */
    var comp = '<section class="tq-p"><h2>Maturity composition &amp; existing interest cost</h2><div class="tbl-scroll"><table class="tq-t tq-ct"><thead><tr><th>Instrument</th><th>Avg rate</th><th>Maturing next 24M</th><th>% of 24M</th><th>Outstanding</th></tr></thead><tbody>' +
      U.composition.map(function (r) { return "<tr><td>" + esc(r.type) + '</td><td class="r">' + (r.rate != null ? r.rate.toFixed(3) + "%" : "N/A") + '</td><td>' + B(r.due24) + "</td><td>" + (r.pct24 != null ? r.pct24.toFixed(1) + "%" : "—") + "</td><td>" + B(r.out) + "</td></tr>"; }).join("") +
      "</tbody></table></div></section>";

    /* (e) debt servicing capacity */
    var svc = "";
    if (D && D.servicing_capacity && D.annual_history_fy2015_2026) {
      var S = D.servicing_capacity, H = D.annual_history_fy2015_2026;
      var trend = H.map(function (r) { return '<div class="tq-tr"><span>FY' + String(r.fiscal_year).slice(2) + "</span><b>" + r.net_interest_pct_receipts.toFixed(1) + "%</b></div>"; }).join("");
      svc = sec("tq-svc", "Debt servicing capacity — FY2026",
        "Monthly Treasury Statement, FY2026 (Oct 2025–Sep 2026) · $ trillions unless noted",
        '<div class="tbl-scroll"><table class="tq-t tq-ann"><thead><tr><th></th><th>$T</th><th>Share / note</th></tr></thead><tbody>' +
        "<tr><td>Federal receipts</td><td>" + T(S.receipts_T) + "</td><td>16.8% of GDP</td></tr>" +
        "<tr><td>Mandatory spending</td><td>" + T(S.mandatory_B_cbo_baseline / 1000) + "</td><td>CBO Feb 2026 baseline <i>projection</i> — MTS does not publish the split</td></tr>" +
        "<tr><td>Discretionary spending</td><td>" + T(S.discretionary_B_cbo_baseline / 1000) + "</td><td>CBO Feb 2026 baseline <i>projection</i></td></tr>" +
        "<tr><td>Net interest expense</td><td>" + T(S.net_interest_T) + "</td><td><b>" + pc(S.net_interest_pct_receipts, 2) + " of receipts</b> · gross interest " + T(S.gross_interest_T) + " (" + pc(S.gross_interest_pct_receipts, 2) + " of receipts)</td></tr>" +
        "<tr><td>Total outlays</td><td>" + T(S.outlays_T) + "</td><td>23.0% of GDP</td></tr>" +
        "<tr><td>Primary deficit (before interest)</td><td>−" + T(S.primary_deficit_T) + "</td><td>cash shortfall before interest</td></tr>" +
        "<tr><td>Total deficit (after interest)</td><td>−" + T(S.deficit_T) + "</td><td>cash deficit after interest payments</td></tr>" +
        "</tbody></table></div>" +
        '<div class="tq-note">Derived actual mandatory: ' + T(S.derived_mandatory_actual_B / 1000) + ' — derived (actual outlays minus CBO discretionary projection minus actual net interest), labelled derived, not published. Actual FY2026 outlays ($7,396B) came in $53B below CBO\u2019s $7,449B projection. Cash-flow coverage of interest: receipts ÷ net interest = <b>' + (S.receipts_T / S.net_interest_T).toFixed(1) + '×</b> — but the primary deficit means interest is funded by borrowing, not by surplus cash.</div>' +
        '<h3 class="tq-h3">Net interest as % of federal receipts — trend</h3><div class="tq-trend">' + trend + '</div>' +
        '<div class="tq-note">Treasury cash balance (TGA): <b>' + B(S.tga_balance_B) + '</b> at ' + esc(dLbl(S.tga_balance_date)) + ' (Daily Treasury Statement, operating cash balance). ' + esc(S.cash_after_interest_note) + '</div>');
    }

    /* (f) risk indicators */
    var risk = "";
    if (D && D.risk_indicators) {
      var K = D.risk_indicators;
      risk = sec("tq-risk", "Risk indicators",
        "FRED, Nov 2026 · CBO Feb 2026 baseline for the trajectory",
        '<div class="tq-kpi tq-kpi-sm">' +
        kpi("2Y Treasury", pc(K.DGS2.value, 2), "FRED DGS2 · " + esc(dLbl(K.DGS2.date))) +
        kpi("5Y Treasury", pc(K.DGS5.value, 2), "FRED DGS5 · " + esc(dLbl(K.DGS5.date))) +
        kpi("10Y Treasury", pc(K.DGS10.value, 2), "FRED DGS10 · " + esc(dLbl(K.DGS10.date))) +
        kpi("30Y Treasury", pc(K.DGS30.value, 2), "FRED DGS30 · " + esc(dLbl(K.DGS30.date))) +
        kpi("5Y breakeven inflation", pc(K.T5YIE.value, 2), "FRED T5YIE · " + esc(dLbl(K.T5YIE.date))) +
        kpi("Broad dollar index", (+K.DTWEXBGS.value).toFixed(2), "FRED DTWEXBGS · " + esc(dLbl(K.DTWEXBGS.date))) +
        kpi("HY option-adj. spread", pc(K.BAMLH0A0HYM2.value, 2), "FRED BAMLH0A0HYM2 · " + esc(dLbl(K.BAMLH0A0HYM2.date))) +
        kpi("BAA – 10Y spread", pc(K.BAA10Y.value, 2), "FRED BAA10Y · " + esc(dLbl(K.BAA10Y.date))) +
        "</div>" +
        '<div class="tq-note">CBO debt-to-GDP trajectory (debt held by the public): <b>' + pc(K.debt_held_public_pct_gdp_fy2026_actual, 1) + '</b> FY2026 actual → 102.1% FY2027 → 104.1% FY2028 → <b>' + pc(K.cbo_debt_held_public_pct_gdp_2036, 1) + '</b> 2036 (CBO Feb 2026 baseline, Table 1-1). Total debt / GDP FY2026: ' + pc(K.total_debt_pct_gdp_fy2026_actual, 1) + '.</div>' +
        spiralGauge(D));
    }

    /* (g) verdict */
    var verd = "";
    if (D) {
      var cov = D.servicing_capacity ? (D.servicing_capacity.receipts_T / D.servicing_capacity.net_interest_T) : null;
      verd = sec("tq-verdict", "Assessment",
        "data-driven verdict — reasoning cites the figures above; not a rating",
        '<div class="tq-vg">' +
        '<div class="tq-v tq-v-hi"><div class="t">Debt sustainability</div><div class="v">HIGH</div><div class="s">Debt held by the public 100.6% of GDP and rising to 120.2% by 2036 (CBO); primary deficit −$0.85T with no primary surplus in the baseline; net interest 21.1% of receipts and rising.</div></div>' +
        '<div class="tq-v tq-v-hi"><div class="t">Refinancing pressure</div><div class="v">HIGH</div><div class="s">' + p12.toFixed(1) + '% of marketable debt matures in 12M ($' + U.due12_t.toFixed(2) + 'T), ' + p24.toFixed(1) + '% in 24M; rolling at ~4.2% vs ~3.4% existing cost adds ~$85B/yr.</div></div>' +
        '<div class="tq-v"><div class="t">Cash-flow coverage of interest</div><div class="v">' + (cov != null ? cov.toFixed(1) + "×" : "—") + '</div><div class="s">Receipts cover net interest ' + (cov != null ? cov.toFixed(1) : "—") + '× — adequate on receipts, but the primary deficit means interest is paid with borrowed money, not surplus cash.</div></div>' +
        '<div class="tq-v"><div class="t">Debt requiring refinancing</div><div class="v">' + p12.toFixed(1) + '% / ' + p24.toFixed(1) + '%</div><div class="s">Next 12 months / next 24 months, share of marketable debt (live MSPD snapshot, ' + esc(dLbl(U.asof)) + ').</div></div>' +
        "</div>" +
        '<div class="tq-note"><b>Key assumptions.</b> Forward years use the CBO Feb 2026 baseline (laws as of Jan 14, 2026, incl. IEEPA tariffs); CBO has not published a revised baseline after the Mar 2026 tariff ruling, so FY2027–2028 deficits are likely understated by ~$150–200B/yr (estimate, not a CBO figure). Total debt forward = CBO debt held by the public + intragovernmental holdings grown ~$0.2T/yr (estimate). Blended refinancing yield and the existing cost of the maturing stock are estimates with stated methods. Gross issuance is the sum of auction awards by issue-date fiscal year (FiscalData auctions API); no single Treasury table publishes the annual gross total.</div>' +
        '<div class="tq-note"><b>Data freshness.</b> Debt to the Penny ' + esc(dLbl(U.penny_date)) + ' (daily) · MSPD ' + esc(dLbl(U.asof)) + ' (monthly) · Average interest rates ' + esc(dLbl(U.rates_date)) + ' · MTS FY2026 ends Sep 30, 2026 · Market yields Nov 9–10, 2026 · CBO baseline Feb 2026. The dashboard data file is refreshed with the desk data pipeline; a new monthly statement is picked up within ~6h of Treasury publishing it.</div>' +
        '<div class="tq-note"><b>Sources.</b> <a href="https://fiscaldata.treasury.gov/" target="_blank" rel="noopener">US Treasury Fiscal Data</a> (Debt to the Penny, MSPD, Average Interest Rates, Auctions, MTS Table 5, Daily Treasury Statement) · <a href="https://fred.stlouisfed.org/" target="_blank" rel="noopener">FRED</a> (DGS2/DGS5/DGS10/DGS30, DTB3, T5YIE, DTWEXBGS, BAMLH0A0HYM2, BAA10Y, GDP) · <a href="https://www.cbo.gov/publication/61882" target="_blank" rel="noopener">CBO, The Budget and Economic Outlook: 2026 to 2036 (Feb 2026)</a> · <a href="https://www.cbo.gov/publication/62210" target="_blank" rel="noopener">CBO tariff update (Mar 2026)</a>.</div>');
    }

    var foot = '<div class="tq-ft">Official U.S. Treasury data via Fiscal Data: ' + esc(U.src.penny) + " (" + esc(dLbl(U.penny_date)) + ") · " + esc(U.src.mspd) + " (" + esc(dLbl(U.asof)) + ") · " + esc(U.src.rates) + " (" + esc(dLbl(U.rates_date)) +
      "). Marketable totals and maturities are summed from the security-level MSPD; MSPD is monthly, Debt to the Penny daily." +
      (D ? " Dashboard data: us-debt-dashboard.json (prepared " + esc(D.prepared || "") + ", data as of " + esc(D.data_as_of || "") + ") — annual history, forward, servicing and risk from FiscalData, FRED and CBO as cited per section." : "") + "</div>";

    P.innerHTML = '<div class="tq">' + head + kp + ann +
      '<div class="tq-g">' + wall + '<div class="tq-side">' + prof + sc + "</div></div>" +
      fwdSum + rc + comp + svc + risk + verd + foot + "</div>";
  }

  BTN.addEventListener("click", function () { setTimeout(render, 0); });
  window.addEventListener("desk:unlock", function () { setTimeout(render, 300); });
  window.addEventListener("desk:data", render);
  if (window.DATA) render();
  loadDash();

  var css = document.createElement("style");
  css.textContent =
    ".tq{padding:4px 0 20px}.tq-hd{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}" +
    ".tq-hd h1{margin:0;font-size:24px;letter-spacing:.02em;text-transform:uppercase}.tq-hd .sub,.tq-p .sub{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.08em}" +
    ".tq-dt{font:12px 'IBM Plex Mono',monospace;color:#e8b93d;background:rgba(232,185,61,.1);border:1px solid rgba(232,185,61,.3);border-radius:6px;padding:4px 10px}" +
    ".tq-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}.tq-k{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}" +
    ".tq-k .t{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.tq-k .v{font:700 26px 'IBM Plex Mono',monospace;margin-top:2px}.tq-k .s{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:2px}" +
    ".tq-k.hi{border-color:rgba(56,182,201,.5)}.tq-k.hi .v{color:#38b6c9}.tq-k.al{border-color:rgba(224,69,58,.55);background:rgba(224,69,58,.06)}.tq-k.al .v{color:#ff8a84}" +
    ".tq-kpi-sm{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.tq-kpi-sm .tq-k .v{font-size:20px}" +
    ".tq-g{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:14px;margin-bottom:14px}.tq-side{display:grid;gap:14px;align-content:start}" +
    ".tq-p{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}.tq-p h2{margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}.tq-ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.tq-ph span{font-size:11.5px;color:var(--faint)}" +
    ".tq-h3{margin:12px 0 6px;font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink)}" +
    ".tq-t{width:100%;border-collapse:collapse;font:13px 'IBM Plex Mono',monospace}.tq-t th{text-align:right;color:var(--muted);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line2)}.tq-t th:first-child,.tq-t td:first-child{text-align:left}" +
    ".tq-t td{text-align:right;padding:3px 4px;border-bottom:1px solid var(--line)}.tq-t td.m{color:var(--muted);font-family:inherit}.tq-t tr.tot td{font-weight:700;border-top:2px solid var(--line2);padding:8px}" +
    ".tq-t tr.tq-fwd td{color:var(--faint);font-style:italic}.tq-t tr.tq-fwd td:first-child{color:var(--muted);font-style:normal}.tq-t td.tq-fwd{color:var(--faint);font-style:italic}.tq-t th.tq-fwd{color:var(--faint);font-style:italic}.tq-t th i{display:block;font-size:10px;color:#e8b93d;font-style:normal;text-transform:uppercase;letter-spacing:.04em}.tq-t td i{font-size:10px;color:#e8b93d;font-style:normal;text-transform:uppercase;letter-spacing:.04em}" +
    ".tq-c{padding:6px 8px;border-radius:5px}.tq-h0{color:var(--faint)}.tq-past{color:var(--faint);text-decoration:line-through;opacity:.6}.tq-past i{display:block;font-size:9px;font-style:normal;text-decoration:none;letter-spacing:.04em;text-transform:uppercase}.tq-h1{background:rgba(148,163,184,.08)}.tq-h2{background:rgba(245,158,11,.18);color:#fcd34d}.tq-h3{background:rgba(249,115,22,.3);color:#fed7aa;font-weight:600}.tq-h4{background:rgba(220,38,38,.45);color:#fee2e2;font-weight:700}" +
    ".tq-bar{display:flex;height:24px;border-radius:5px;overflow:hidden;border:1px solid var(--line2)}.tq-bar div{display:flex;align-items:center;justify-content:center;font:700 10.5px 'IBM Plex Mono',monospace;color:#fff}" +
    ".tq-lg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}.tq-lg div{display:flex;align-items:center;gap:6px}.tq-lg i{width:8px;height:8px;border-radius:50%}.tq-lg b{margin-left:auto;color:var(--ink)}" +
    ".tq-lg2{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 4px;font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}.tq-lg2 span{display:flex;align-items:center;gap:6px}.tq-lg2 i{width:10px;height:10px;border-radius:2px;display:inline-block}.tq-sw-hatch{background:repeating-linear-gradient(45deg,#ef4444 0 2px,#3f1d1d 2px 5px)}.tq-sw-est{background:rgba(245,158,11,.4);border:1px dashed #fff}.tq-sw-yl{background:#e8b93d;border-radius:50%!important;width:8px!important;height:8px!important}" +
    ".tq-svg{width:100%;height:auto;display:block;background:var(--panel);border:1px solid var(--line);border-radius:8px}.tq-gl{stroke:rgba(148,163,184,.18);stroke-width:1}.tq-ax{fill:var(--faint);font:10.5px 'IBM Plex Mono',monospace}.tq-blbl{fill:#e8eef4;font:600 9px 'IBM Plex Mono',monospace}.tq-yl{fill:none;stroke:#e8b93d;stroke-width:2}.tq-yd{fill:#e8b93d}.tq-yl2{fill:none;stroke:#e8b93d;stroke-width:2;stroke-dasharray:5,3;opacity:.7}.tq-ylbl{fill:#e8b93d;font:600 11px 'IBM Plex Mono',monospace}.tq-ylbl2{fill:var(--faint);font:10px 'IBM Plex Mono',monospace}" +
    ".tq-sc{display:flex;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 10px;margin-top:6px;font:13px 'IBM Plex Mono',monospace}.tq-sc b{color:#ff8a84}" +
    ".tq-note{margin-top:8px;font-size:11.5px;color:var(--faint);line-height:1.5}.tq-note b{color:var(--ink)}.tq-note a{color:#38b6c9}.tq-ct td.r{color:#38b6c9}.tq-ft{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);border-top:1px solid var(--line);padding-top:10px;margin-top:6px}" +
    ".tq-trend{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.tq-tr{display:flex;flex-direction:column;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:5px 8px;min-width:52px}.tq-tr span{font:10px 'IBM Plex Mono',monospace;color:var(--faint)}.tq-tr b{font:700 13px 'IBM Plex Mono',monospace;color:#ff8a84}" +
    ".tq-sp{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:10px}.tq-sp>div:first-child{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}.tq-sp b{font:700 14px 'IBM Plex Mono',monospace}.tq-sp span{font:12px 'IBM Plex Mono',monospace;color:var(--muted)}.tq-spn{margin-top:6px;font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);line-height:1.5}.tq-sp-el{border-color:rgba(224,69,58,.55);background:rgba(224,69,58,.06)}.tq-sp-el b{color:#ff8a84}.tq-sp-wa{border-color:rgba(232,185,61,.5)}.tq-sp-wa b{color:#e8b93d}.tq-sp-ok b{color:#38b6c9}" +
    ".tq-vg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.tq-v{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tq-v .t{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.tq-v .v{font:700 24px 'IBM Plex Mono',monospace;margin:4px 0}.tq-v .s{font:12px 'IBM Plex Mono',monospace;color:var(--faint);line-height:1.5}.tq-v-hi{border-color:rgba(224,69,58,.55);background:rgba(224,69,58,.06)}.tq-v-hi .v{color:#ff8a84}" +
    "@media (max-width:980px){.tq-g{grid-template-columns:1fr}}";
  document.head.appendChild(css);
})();
