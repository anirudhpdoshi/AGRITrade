/* ai-debt-ui.js — AI Debt tab: AI-company debt raises, Jan 2021 – Nov 2026.
   Data: ai-debt.json (same directory), built verbatim from the verified research dataset
   (406 rows, 15 companies; SEC EDGAR filings, prospectuses, company IR, reputable press).
   Interaction: pick a company from the left list — the main area shows ONLY that
   company. Summary | Details toggle above the main area. A year ruler (All + 2021–2026)
   filters both views; tap a year or drag/scrub across it. Every figure is shown exactly
   as researched — coupon, market yield and all-in rate are separate fields and never
   substituted; null yields print as "—". Amounts are as issued, in millions, in the issue
   currency; currencies are never summed or converted into one total. */
(function () {
  "use strict";
  var P = document.getElementById("panel-aidebt"), BTN = document.getElementById("tabbtn-aidebt");
  if (!P || !BTN) return;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SYM = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "C$", CHF: "CHF ", AUD: "A$" };
  var YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"];
  var RULER_POS = ["", "2021", "2022", "2023", "2024", "2025", "2026"]; /* "" = All */
  var D = null, LOADFAIL = false, BUILT = false;
  var F = { co: "", yr: "", inst: "", cf: "", view: "summary" };
  var scrub = false;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(v) { return (+v).toLocaleString("en-US"); }
  function fmtM(v) { return num(Math.round(v)); } /* display totals rounded to whole millions; sub-million precision is noise from converted tranches */
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
  function curTotals(rows) {
    var t = {};
    rows.forEach(function (r) { if (r.amount != null) { t[r.currency] = (t[r.currency] || 0) + r.amount; } });
    return t;
  }
  function curCounts(rows) {
    var c = {};
    rows.forEach(function (r) { if (r.amount != null) { c[r.currency] = (c[r.currency] || 0) + 1; } });
    return c;
  }
  function kpi(t, v, sub) { return '<div class="ad-k"><div class="t">' + t + '</div><div class="v">' + v + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + "</div>"; }
  function cfChip(c) { return '<span class="ad-cf ad-cf-' + c.toLowerCase() + '">' + c + "</span>"; }

  function rowHTML(r, i) {
    var spv = isSPV(r), sub = !spv && r.issuer_legal_entity !== mainIssuer(r.company);
    var badge = spv ? ' <span class="ad-badge ad-spv" title="SPV / project-entity borrower — this debt is not the parent company\u2019s own borrowing">SPV</span>'
      : sub ? ' <span class="ad-badge ad-sub" title="Subsidiary borrower — not the parent company itself">SUB</span>' : "";
    var amt = r.amount == null ? '<span title="' + esc(r.notes || "Amount not disclosed in sources") + '">—</span>' : num(r.amount);
    var yld = r.yield_or_coupon_pct == null ? "—"
      : (+r.yield_or_coupon_pct).toFixed(2) + "%";
    var yttl = r.yield_or_coupon_pct == null ? "Yield / coupon not publicly disclosed — floating-rate spreads are kept separate, never substituted"
      : esc(r.yield_type || "") + (r.yield_or_coupon_pct === 0 ? " — non-interest-bearing" : "");
    var ctry = r.country_of_issuer === "UNKNOWN" ? '<span title="Country not verified in sources">—</span>' : esc(r.country_of_issuer);
    return '<tr data-i="' + i + '"><td><span class="co">' + esc(r.company) + "</span></td>" +
      "<td>" + esc(r.issuer_legal_entity) + badge + "</td>" +
      "<td>" + esc(r.instrument_type) + "</td>" +
      '<td class="mono">' + monLbl(r.issue_month) + '</td><td class="r">' + amt + "</td>" +
      '<td class="mono">' + esc(r.currency) + '</td><td class="r" title="' + yttl + '">' + yld + "</td>" +
      "<td>" + ctry + "</td><td>" + cfChip(r.confidence) + "</td></tr>";
  }
  function detailHTML(r) {
    var src = (r.sources || []).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    return '<tr class="ad-det"><td colspan="9"><div><b>Notes:</b> ' + esc(r.notes || "—") + "</div>" +
      '<div style="margin-top:6px"><b>Sources:</b><ul>' + (src || "<li>—</li>") + "</ul></div></td></tr>";
  }
  function stripHTML(rows) {
    var FAMS = ["Senior bonds", "Convertible notes", "Term loans & facilities", "Revolvers & DDTLs", "Other"];
    var byFam = {};
    rows.forEach(function (r) { var f = fam(r.instrument_type); (byFam[f] = byFam[f] || []).push(r); });
    var cells = FAMS.map(function (f) {
      var rs = byFam[f] || [], t = curTotals(rs), parts = Object.keys(t).sort().map(function (c) { return (SYM[c] || c + " ") + fmtM(t[c]) + "m"; }).join(" · ");
      return '<div class="ad-f"><div class="t">' + f + ' <span>(' + rs.length + (rs.length === 1 ? " raise)" : " raises)") + '</span></div><div class="v">' + (parts || "—") + "</div></div>";
    }).join("");
    var nullAmt = rows.filter(function (r) { return r.amount == null; }).length;
    var note = "Totals of the rows shown after filtering — sums within each currency only, never converted." +
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
    var tot = curTotals(rs), cnt = curCounts(rs);
    var tiles = [];
    tiles.push(kpi("Debt raises", num(rs.length), (F.yr ? F.yr : "All years") + " · " + F.co));
    var anyAmt = false;
    ["USD", "EUR", "GBP", "JPY", "CAD", "CHF", "AUD"].forEach(function (c) {
      if (tot[c]) { anyAmt = true; tiles.push(kpi(c + " raised", (SYM[c] || c + " ") + fmtM(tot[c]) + "m", (cnt[c] || 0) + " raises · sums in " + c + " only")); }
    });
    if (!anyAmt) tiles.push(kpi("Amounts", "—", "no disclosed amounts"));
    var ys = rs.filter(function (r) { return r.yield_or_coupon_pct != null; }).map(function (r) { return +r.yield_or_coupon_pct; });
    var lo = ys.length ? Math.min.apply(null, ys) : null, hi = ys.length ? Math.max.apply(null, ys) : null;
    var yrng = ys.length ? lo.toFixed(2) + "%" + (ys.length > 1 && hi !== lo ? " – " + hi.toFixed(2) + "%" : "") : "—";
    tiles.push(kpi("Yield / coupon range", yrng, ys.length ? ys.length + " of " + rs.length + " raises disclose a yield / coupon" : "no yield / coupon disclosed"));
    var tf = topFamily(rs);
    tiles.push(kpi("Top instrument family", tf ? esc(tf.f) : "—", tf ? tf.n + " of " + rs.length + " raises" : "—"));
    return '<div class="ad-kpi">' + tiles.join("") + "</div>" + barsHTML() + stripHTML(rs);
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
    return flt + '<div class="tbl-scroll"><table class="ad-t"><thead><tr><th>Company</th><th>Issuer (legal entity)</th><th>Product / Instrument</th><th>Month raised</th><th>Total debt amount</th><th>Currency</th><th>Yield / coupon at issue</th><th>Country</th><th>Confidence</th></tr></thead><tbody id="ad-tbody">' + body + "</tbody></table></div>";
  }

  function render() {
    if (!D) {
      if (LOADFAIL) { P.innerHTML = '<div class="tile wide"><h2>AI Debt — AI-company debt raises</h2><p class="note">Could not load ai-debt.json (same directory as this page). The file ships with the desk; check it is present next to index.html.</p></div>'; return; }
      P.innerHTML = '<div class="tile wide"><h2>AI Debt — AI-company debt raises</h2><p class="note">Loading the verified raises dataset…</p></div>';
      fetch("ai-debt.json").then(function (resp) { if (!resp.ok) throw new Error("HTTP " + resp.status); return resp.json(); })
        .then(function (j) { D = j; BUILT = false; render(); })
        .catch(function () { LOADFAIL = true; render(); });
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
      ".ad-ft{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);border-top:1px solid var(--line);padding-top:10px;margin-top:6px}" +
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
    var foot = '<div class="ad-ft">Verified 2026-11-11 · coupon, market yield and all-in rate are separate fields · sources per row (click a row to expand). Amounts are as issued, in millions, in the issue currency. SPV = SPV / project-entity borrower, not the parent company\u2019s own debt · SUB = subsidiary borrower. Data: SEC EDGAR filings, prospectuses, company IR, reputable press; 362 CONFIRMED · 38 REPORTED · 6 INDICATIVE.</div>';
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
