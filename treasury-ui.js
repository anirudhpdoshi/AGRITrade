/* treasury-ui.js — US Treasury debt maturity wall & refinancing risk (tab "Treasury").
   Data: DATA.ust, built by scripts/update_data.py ust() from the Treasury's own Fiscal Data API —
   Debt to the Penny (daily), Monthly Statement of the Public Debt tables 1 & 3 (every marketable security and its
   maturity), Average Interest Rates. Every number below is computed from those; nothing is modelled. */
(function () {
  "use strict";
  var P = document.getElementById("panel-treasury"), BTN = document.getElementById("tabbtn-treasury");
  if (!P || !BTN) return;
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function T(v, d) { return v == null ? "N/A" : "$" + (+v).toFixed(d == null ? 2 : d) + "T"; }
  function B(v) { return v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US") + " B"; }
  function dLbl(s) { return s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—"; }
  function heat(v, mx) { if (!v) return "tq-h0"; var r = v / mx; return r > 0.8 ? "tq-h4" : r > 0.6 ? "tq-h3" : r > 0.4 ? "tq-h2" : "tq-h1"; }
  function kpi(t, v, sub, cls) { return '<div class="tq-k ' + (cls || "") + '"><div class="t">' + t + '</div><div class="v">' + v + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>"; }

  function render() {
    var U = window.DATA && DATA.ust;
    if (!U) { P.innerHTML = '<div class="tile wide"><h2>U.S. Treasury debt maturity wall</h2><p class="note">Loads with the next data refresh (official Treasury Fiscal Data).</p></div>'; return; }
    var mk = U.marketable_t, p12 = U.due12_t / mk * 100, p24 = U.due24_t / mk * 100;
    var head = '<div class="tq-hd"><div><h1>U.S. Treasury Debt Maturity Wall</h1><div class="sub">&amp; refinancing risk</div></div>' +
      '<div class="tq-dt">Debt to the Penny ' + esc(dLbl(U.penny_date)) + " · MSPD " + esc(dLbl(U.asof)) + "</div></div>";
    var kp = '<div class="tq-kpi">' +
      kpi("Total U.S. debt", T(U.total_debt_t), "public " + T(U.public_t) + " · intragov " + T(U.intragov_t)) +
      kpi("Marketable debt", T(mk), U.n_securities + " securities") +
      kpi("12M maturing", T(U.due12_t), p12.toFixed(1) + "% of marketable · from " + esc(dLbl(U.asof)), "hi") +
      kpi("24M maturing", T(U.due24_t), p24.toFixed(1) + "% of marketable · from " + esc(dLbl(U.asof)), "al") +
      kpi("Weighted avg maturity", Math.round(U.wam_months) + " mos", (U.wam_months / 12).toFixed(2) + " years") +
      kpi("WA interest rate", U.wa_rate != null ? U.wa_rate.toFixed(3) + "%" : "N/A", "marketable, " + esc(dLbl(U.rates_date))) + "</div>";
    /* 24-month maturity concentration: months as rows, calendar years as columns */
    var W = U.wall || {}, keys = Object.keys(W).sort().slice(0, 25), yrs = [], mx = 0;
    /* months already behind us (ET) matured after the statement date: shown greyed as rolled over, not as a coming wall */
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
    /* current maturity profile */
    var PT = U.profile.reduce(function (a, x) { return a + x.bn; }, 0), COL = ["#ef4444", "#f97316", "#f59e0b", "#3b82f6", "#6366f1", "#a855f7"];
    var prof = '<section class="tq-p"><h2>Current maturity profile</h2><div class="tq-bar">' + U.profile.map(function (x, i) { var pc = x.bn / PT * 100;
        return '<div style="width:' + pc.toFixed(2) + "%;background:" + COL[i] + '" title="' + esc(x.label) + ": " + B(x.bn) + " (" + pc.toFixed(1) + '%)">' + (pc > 9 ? Math.round(pc) + "%" : "") + "</div>"; }).join("") + "</div>" +
      '<div class="tq-lg">' + U.profile.map(function (x, i) { return '<div><i style="background:' + COL[i] + '"></i>' + esc(x.label) + "<b>" + (x.bn / PT * 100).toFixed(1) + "%</b></div>"; }).join("") + "</div></section>";
    /* refinancing arithmetic: 24M cohort x rate shock (annualised, simple) */
    var sc = '<section class="tq-p"><h2>Refinancing rate shock</h2><div class="sub">extra annual interest if the 24-month cohort (' + T(U.due24_t) + ") rolls at a higher rate</div>" +
      [25, 50, 100, 200].map(function (b) { return '<div class="tq-sc"><span>+' + b + ' bps</span><b>+$' + Math.round(U.due24_t * 1000 * b / 10000) + "B / yr</b></div>"; }).join("") +
      '<div class="tq-note">Simple arithmetic: maturing principal × rate change, before any change in issuance mix or deficits. Not a forecast.</div></section>';
    var comp = '<section class="tq-p"><h2>Maturity composition &amp; existing interest cost</h2><div class="tbl-scroll"><table class="tq-t tq-ct"><thead><tr><th>Instrument</th><th>Avg rate</th><th>Maturing next 24M</th><th>% of 24M</th><th>Outstanding</th></tr></thead><tbody>' +
      U.composition.map(function (r) { return "<tr><td>" + esc(r.type) + '</td><td class="r">' + (r.rate != null ? r.rate.toFixed(3) + "%" : "N/A") + '</td><td>' + B(r.due24) + "</td><td>" + (r.pct24 != null ? r.pct24.toFixed(1) + "%" : "—") + "</td><td>" + B(r.out) + "</td></tr>"; }).join("") +
      "</tbody></table></div></section>";
    var foot = '<div class="tq-ft">Official U.S. Treasury data via Fiscal Data: ' + esc(U.src.penny) + " (" + esc(dLbl(U.penny_date)) + ") · " + esc(U.src.mspd) + " (" + esc(dLbl(U.asof)) + ") · " + esc(U.src.rates) + " (" + esc(dLbl(U.rates_date)) +
      "). Marketable totals and maturities are summed from the security-level MSPD; MSPD is monthly, Debt to the Penny daily.</div>";
    P.innerHTML = '<div class="tq">' + head + kp + '<div class="tq-g">' + wall + '<div class="tq-side">' + prof + sc + "</div></div>" + comp + foot + "</div>";
  }
  BTN.addEventListener("click", function () { setTimeout(render, 0); });
  window.addEventListener("desk:unlock", function () { setTimeout(render, 300); });
  window.addEventListener("desk:data", render);
  if (window.DATA) render();

  var css = document.createElement("style");
  css.textContent =
    ".tq{padding:4px 0 20px}.tq-hd{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}" +
    ".tq-hd h1{margin:0;font-size:24px;letter-spacing:.02em;text-transform:uppercase}.tq-hd .sub,.tq-p .sub{color:var(--muted);font-size:12.5px;text-transform:uppercase;letter-spacing:.08em}" +
    ".tq-dt{font:12px 'IBM Plex Mono',monospace;color:#e8b93d;background:rgba(232,185,61,.1);border:1px solid rgba(232,185,61,.3);border-radius:6px;padding:4px 10px}" +
    ".tq-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}.tq-k{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}" +
    ".tq-k .t{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.tq-k .v{font:700 26px 'IBM Plex Mono',monospace;margin-top:2px}.tq-k .s{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:2px}" +
    ".tq-k.hi{border-color:rgba(56,182,201,.5)}.tq-k.hi .v{color:#38b6c9}.tq-k.al{border-color:rgba(224,69,58,.55);background:rgba(224,69,58,.06)}.tq-k.al .v{color:#ff8a84}" +
    ".tq-g{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:14px;margin-bottom:14px}.tq-side{display:grid;gap:14px;align-content:start}" +
    ".tq-p{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.tq-p h2{margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}.tq-ph{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.tq-ph span{font-size:11.5px;color:var(--faint)}" +
    ".tq-t{width:100%;border-collapse:collapse;font:13px 'IBM Plex Mono',monospace}.tq-t th{text-align:right;color:var(--muted);font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line2)}.tq-t th:first-child,.tq-t td:first-child{text-align:left}" +
    ".tq-t td{text-align:right;padding:3px 4px;border-bottom:1px solid var(--line)}.tq-t td.m{color:var(--muted);font-family:inherit}.tq-t tr.tot td{font-weight:700;border-top:2px solid var(--line2);padding:8px}" +
    ".tq-c{padding:6px 8px;border-radius:5px}.tq-h0{color:var(--faint)}.tq-past{color:var(--faint);text-decoration:line-through;opacity:.6}.tq-past i{display:block;font-size:9px;font-style:normal;text-decoration:none;letter-spacing:.04em;text-transform:uppercase}.tq-h1{background:rgba(148,163,184,.08)}.tq-h2{background:rgba(245,158,11,.18);color:#fcd34d}.tq-h3{background:rgba(249,115,22,.3);color:#fed7aa;font-weight:600}.tq-h4{background:rgba(220,38,38,.45);color:#fee2e2;font-weight:700}" +
    ".tq-bar{display:flex;height:24px;border-radius:5px;overflow:hidden;border:1px solid var(--line2)}.tq-bar div{display:flex;align-items:center;justify-content:center;font:700 10.5px 'IBM Plex Mono',monospace;color:#fff}" +
    ".tq-lg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}.tq-lg div{display:flex;align-items:center;gap:6px}.tq-lg i{width:8px;height:8px;border-radius:50%}.tq-lg b{margin-left:auto;color:var(--ink)}" +
    ".tq-sc{display:flex;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 10px;margin-top:6px;font:13px 'IBM Plex Mono',monospace}.tq-sc b{color:#ff8a84}" +
    ".tq-note{margin-top:8px;font-size:11.5px;color:var(--faint)}.tq-ct td.r{color:#38b6c9}.tq-ft{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);border-top:1px solid var(--line);padding-top:10px;margin-top:6px}" +
    "@media (max-width:980px){.tq-g{grid-template-columns:1fr}}";
  document.head.appendChild(css);
})();
