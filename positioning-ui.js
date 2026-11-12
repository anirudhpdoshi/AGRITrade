/* positioning-ui.js — Report-first Positioning view (Nov 2026).
   Flips the desk's commodity-first navigation for positioning data: four report
   tabs (CFTC Traders Positions, Export Sales, Derivatives Positions, Open
   Interest) over one commodity slicer (Corn / Soybeans / Wheat). No left panel,
   no section menu — this panel has no .layout, so buildSecNav() never touches it.
   Own state only (localStorage desk.positioning); never calls GRAINS.pick and
   never uses data-cf-pick (obs-ui.js would steal that click and switch the
   grain page). Commercial net comes from DATA.grains[k].cftc_stats.kpi
   (comm_net / comm_d1 / comm_hist — CFTC producer/merchant positions);
   if it is null for a commodity that row prints "—" with the reason,
   never a guess. Figures recomputed
   from DATA with the same formulas as obs-ui.js cftcView / rows-ui.js
   headlines(): WoW = latest net − prior net; net % OI = net/oi*100 with the
   over-crowded bands; streak and z52 from cftc_stats.kpi; walls from
   near.call_wall/put_wall and window.OIVALUE. */
(function (root) {
  "use strict";
  var doc = root.document, P = doc.getElementById("panel-positioning");
  if (!P) return;
  var css = doc.createElement("style");
  css.textContent =
    ".pos-wrap{max-width:1888px;margin:0 auto;padding:0 0 24px}" +
    ".pos-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}" +
    ".pos-tabs button{appearance:none;font:700 13.5px 'IBM Plex Sans',sans-serif;color:var(--muted);background:transparent;border:1px solid var(--line2);border-radius:8px;padding:8px 14px;cursor:pointer}" +
    ".pos-tabs button:hover{color:#fff;background:#14213a}" +
    ".pos-tabs button[aria-selected=true]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
    ".pos-body{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}" +
    ".pos-body .tile{margin:0}" +
    ".pos-read{font-size:13px;color:var(--muted);margin:10px 0 0}" +
    ".pos-list{margin:10px 0 0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.6}" +
    ".pos-list b{color:var(--ink)}" +
    ".pos-sel td{background:rgba(56,182,201,.08)}";
  doc.head.appendChild(css);
  var GR = ["corn", "soybeans", "wheat"], NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
  var REPORTS = [["cftc", "CFTC Traders Positions"], ["exports", "Export Sales"], ["deriv", "Derivatives Positions"], ["oi", "Open Interest"]];
  var KEY = "desk.positioning", UNA = "—";
  var COMMERCIAL_NOTE = "no producer/merchant net in the dataset for this commodity";
  var st = { report: "cftc", commodity: "corn" };
  try { var s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; if (s.report) st.report = s.report; if (s.commodity) st.commodity = s.commodity; } catch (e) {}
  if (GR.indexOf(st.commodity) < 0) { try { st.commodity = JSON.parse(localStorage.getItem("desk.grain") || '"corn"') || "corn"; } catch (e) { st.commodity = "corn"; } }
  if (GR.indexOf(st.commodity) < 0) st.commodity = "corn";
  if (!REPORTS.some(function (r) { return r[0] === st.report; })) st.report = "cftc";
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(v) { return v == null || isNaN(v) ? null : Math.round(Math.abs(v)).toLocaleString("en-US"); }
  function sg(v) { return v == null || isNaN(v) ? UNA : (v < 0 ? "−" : v > 0 ? "+" : "") + n(Math.abs(v)); }
  function sgc(v) { return v == null || isNaN(v) ? UNA : (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v).toFixed(2) + "¢"; }
  function d2(v) { return v == null || isNaN(v) ? UNA : (+v).toFixed(2); }
  function usd(v) { if (v == null || isNaN(v)) return UNA; return v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v); }
  function notional(oi, px) { return oi == null || !px ? null : oi * 5000 * px; }
  function day(iso) { if (!iso) return UNA; var p = String(iso).split("-"); if (p.length !== 3) return esc(iso); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
  function month(iso) { var p = String(iso || "").split("-"); return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""; }
  function asof(key) { var A = root.DATA && DATA.meta && DATA.meta.asof || {}; return A[key] || null; }
  function stamp(key, label) { var a = asof(key); return '<div class="stamp">' + esc(label) + (a ? " · as-of " + esc(a) : " · as-of " + UNA) + "</div>"; }
  function crowd(p) { if (p == null || isNaN(p)) return null; if (p >= 20) return { extreme: true, label: "Extreme Crowded Long (Exhausted buying capacity)" }; if (p <= -20) return { extreme: true, label: "Extreme Crowded Short (High short-squeeze risk)" }; if (p >= -10 && p <= 10) return { extreme: false, label: "Neutral" }; return { extreme: false, label: p > 0 ? "Leaning long" : "Leaning short" }; }
  function pct1(p) { return Math.abs(p).toFixed(1) + "%"; }
  function fnd(c) { try { return root.GRAINS && GRAINS.fndLabel ? GRAINS.fndLabel(c) : null; } catch (e) { return null; } }
  function tile(inner, wide) { return '<div class="tile' + (wide ? " wide" : "") + '">' + inner + "</div>"; }
  function head(title, note) { return "<h2>" + esc(title) + (note ? ' <span class="h2note">— ' + esc(note) + "</span>" : "") + "</h2>"; }

  /* ---- CFTC: 5-report SVG trend, same geometry as obs-ui.js cftcView ---- */
  function trendSvg(Tr) {
    var lo = Math.min.apply(null, Tr.map(function (x) { return x.net; })), hi = Math.max.apply(null, Tr.map(function (x) { return x.net; }));
    var W = 520, H = 86, xy = Tr.map(function (x, i) { return [36 + i * (W - 72) / Math.max(1, Tr.length - 1), 20 + (hi === lo ? 20 : (hi - x.net) / (hi - lo) * 34)]; });
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="cf-svg" role="img" aria-label="Net position, last ' + Tr.length + ' weekly reports"><polyline fill="none" stroke="#e8c33a" stroke-width="2" points="' + xy.map(function (q) { return q.join(","); }).join(" ") + '"/>' + xy.map(function (q, i) { return '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3" fill="#e8c33a"/><text x="' + q[0] + '" y="' + (q[1] - 6) + '" text-anchor="middle" font-size="10" fill="currentColor">' + sg(Tr[i].net) + "</text>" + '<text x="' + q[0] + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">' + month(Tr[i].date) + "</text>"; }).join("") + "</svg>";
  }
  /* ---- CFTC: 52-week commercial history — same line language, cyan, endpoint labels only ---- */
  function trendSvgHist(Hist, color) {
    var lo = Math.min.apply(null, Hist.map(function (x) { return x[1]; })), hi = Math.max.apply(null, Hist.map(function (x) { return x[1]; }));
    var W = 520, H = 86, xy = Hist.map(function (x, i) { return [36 + i * (W - 72) / Math.max(1, Hist.length - 1), 20 + (hi === lo ? 20 : (hi - x[1]) / (hi - lo) * 34)]; });
    var first = xy[0], last = xy[xy.length - 1], nH = Hist.length;
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="cf-svg cf-svg-comm" role="img" aria-label="Commercial net position, last ' + nH + ' weekly reports"><polyline fill="none" stroke="' + color + '" stroke-width="2" points="' + xy.map(function (q) { return q.join(","); }).join(" ") + '"/>' +
      '<circle cx="' + first[0] + '" cy="' + first[1] + '" r="3" fill="' + color + '"/><text x="' + first[0] + '" y="' + (first[1] - 6) + '" text-anchor="start" font-size="10" fill="currentColor">' + sg(Hist[0][1]) + "</text>" +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="' + color + '"/><text x="' + last[0] + '" y="' + (last[1] - 6) + '" text-anchor="end" font-size="10" fill="currentColor">' + sg(Hist[nH - 1][1]) + "</text>" +
      '<text x="' + first[0] + '" y="' + (H - 4) + '" text-anchor="start" font-size="11" fill="currentColor">' + month(Hist[0][0]) + '</text><text x="' + last[0] + '" y="' + (H - 4) + '" text-anchor="end" font-size="11" fill="currentColor">' + month(Hist[nH - 1][0]) + "</text></svg>";
  }
  function cftcSummary(k, G) {
    var C = G.cftc || [], L = C[C.length - 1], Pr = C[C.length - 2];
    if (!L) return { latest: null, prev: null, wow: null, pct: null, cr: null, stale: false };
    var wow = Pr ? L.net - Pr.net : null, pct = L.oi ? L.net / L.oi * 100 : null;
    return { latest: L, prev: Pr, wow: wow, pct: pct, cr: crowd(pct), stale: Date.now() - Date.parse(L.date + "T15:30:00-04:00") > 240 * 36e5 };
  }
  function reportCftc(k, G) {
    var S = cftcSummary(k, G), L = S.latest;
    var strip = '<table class="cf-tbl"><thead><tr><th>Commodity</th><th>Managed-money net</th><th>Week on week</th><th>Report date</th></tr></thead><tbody>' +
      GR.map(function (x) { var g2 = root.DATA.grains[x], s2 = cftcSummary(x, g2); if (!s2.latest) return "<tr><td>" + NAME[x] + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td></tr>";
        return "<tr" + (x === k ? ' class="pos-sel"' : "") + "><td><b>" + NAME[x] + "</b></td><td>" + sg(s2.latest.net) + " contracts</td><td>" + (s2.wow == null ? UNA : "Funds " + (s2.wow < 0 ? "sold " : "bought ") + n(s2.wow) + " net") + "</td><td>" + day(s2.latest.date) + "</td></tr>"; }).join("") + "</tbody></table>";
    if (!L) return tile(head("CFTC Traders Positions", "managed money, weekly") + "<p>" + UNA + " — no CFTC rows in the dataset.</p>" + stamp("cftc_grains", "Source: CFTC Commitments of Traders"));
    var K = G.cftc_stats && G.cftc_stats.kpi || {}, Tr = (G.cftc || []).slice(-5);
    var side = L.net < 0 ? "Net short" : "Net long";
    var read = S.wow == null ? side + "." : "Funds " + (S.wow < 0 ? "sold " : "bought ") + n(S.wow) + " net in the week to " + month(L.date) + " — " + side.toLowerCase() + " " + n(Math.abs(L.net)) + " contracts.";
    var commNet = K.comm_net, commD1 = K.comm_d1, commHist = K.comm_hist || [];
    var commPct = commNet != null && L.oi ? commNet / L.oi * 100 : null;
    var commSide = commNet == null ? "" : commNet < 0 ? "Net short" : commNet > 0 ? "Net long" : "Flat";
    var commWow = commD1 == null ? UNA : commD1 === 0 ? "No change on the week" : "Commercials " + (commD1 < 0 ? "sold " : "bought ") + n(commD1) + " net";
    var h = tile(head("CFTC Traders Positions", "what did traders buy / sell this week") +
      '<div class="cf-head"><b>CFTC — Managed money · ' + NAME[k] + '</b><span>Report ' + day(L.date) + " · weekly" + (S.stale ? ' · <b class="cf-stale">STALE</b> — report is more than 10 days old' : "") + "</span></div>" + strip, true) +
      tile(head(NAME[k] + " — managed money detail") +
      '<table class="cf-tbl"><thead><tr><th>Measure</th><th>' + NAME[k] + "</th><th>Week on week</th><th>Read</th></tr></thead><tbody>" +
      "<tr><td>Managed-money net</td><td>" + sg(L.net) + " contracts</td><td>" + (S.wow == null ? UNA : "Funds " + (S.wow < 0 ? "sold " : "bought ") + n(S.wow) + " net") + "</td><td>" + side + "</td></tr>" +
      "<tr><td>Managed-money long</td><td>" + n(L.long) + " contracts</td><td></td><td></td></tr>" +
      "<tr><td>Managed-money short</td><td>" + n(L.short) + " contracts</td><td></td><td></td></tr>" +
      "<tr><td>Commercial net (producer/merchant)</td><td>" + (commNet == null ? UNA : sg(commNet) + " contracts") + "</td><td>" + commWow + "</td><td>" + (commNet == null ? esc(COMMERCIAL_NOTE) : commSide) + "</td></tr>" +
      (commPct == null ? "" : "<tr><td>Commercial net as % of open interest</td><td>" + (commPct < 0 ? "−" : "+") + pct1(commPct) + "</td><td></td><td>" + commSide + " " + pct1(commPct) + " of open interest</td></tr>") +
      (S.pct == null ? "" : "<tr><td>Net as % of open interest</td><td>" + (S.pct < 0 ? "−" : "+") + pct1(S.pct) + "</td><td></td><td>" + esc(S.cr.label) + "</td></tr>") +
      "<tr><td>Open interest</td><td>" + n(L.oi) + " contracts</td><td></td><td></td></tr>" +
      (K.z52 != null ? "<tr><td>52-week context (z-score)</td><td>" + (K.z52 < 0 ? "−" : "+") + Math.abs(K.z52).toFixed(2) + "</td><td></td><td>" + (Math.abs(K.z52) >= 2 ? "Extreme against the past year" : "Not extreme against the past year") + "</td></tr>" : "") +
      (K.streak ? "<tr><td>Streak</td><td>" + Math.abs(K.streak) + " weeks</td><td></td><td>Net " + (K.streak < 0 ? "selling" : "buying") + " for " + Math.abs(K.streak) + " straight weeks</td></tr>" : "") +
      (K.cot3 != null ? "<tr><td>COT index (3-yr range, 0–100)</td><td>" + (+K.cot3).toFixed(1) + "</td><td></td><td>" + (K.cot3 >= 90 ? "Near the top of its 3-year range" : K.cot3 <= 10 ? "Near the bottom of its 3-year range" : "Mid-range") + "</td></tr>" : "") +
      "<tr><td>Positioning trend (last " + Tr.length + ' reports)</td><td colspan="3">' + trendSvg(Tr) + "</td></tr>" +
      (commHist.length > 1 ? "<tr><td>Commercial positioning trend (" + commHist.length + ' weekly reports)</td><td colspan="3">' + trendSvgHist(commHist, "#38b6c9") + "</td></tr>" : "") + "</tbody></table>" +
      "<p class=\"pos-read\">" + esc(read) + "</p>" + stamp("cftc_grains", "Source: CFTC Commitments of Traders — managed money + producer/merchant positions · report " + day(L.date)), true);
    return h;
  }

  /* ---- Export Sales ---- */
  function reportExports(k) {
    var E = root.DATA.exports && DATA.exports[k];
    if (!E || !E.weeks || !E.weeks.length) return tile(head("Export Sales", NAME[k]) + "<p>" + UNA + " — no export-sales weeks in the dataset.</p>" + stamp("exports", "Source: USDA FAS Export Sales Reporting"));
    var W = E.weeks, Lw = W[W.length - 1], Pw = W[W.length - 2];
    var latest = Lw[2], prev = Pw ? Pw[2] : null, wow = latest != null && prev != null ? latest - prev : null;
    var season = W.reduce(function (a, w) { return a + (w[2] || 0); }, 0);
    var D = E.dest || {}, T = D.total || {}, top = D.top_week || [];
    var tot = T.net != null ? T.net : latest;
    var mix = top.map(function (r) { var sh = tot ? r.net / tot * 100 : null; return "<tr><td><b>" + esc(r.country) + "</b></td><td>" + n(r.net) + "</td><td>" + (sh == null ? UNA : sh.toFixed(1) + "%") + "</td><td>" + (r.prev == null ? UNA : sg(r.net - r.prev)) + "</td><td>" + n(r.shipped) + "</td><td>" + n(r.outstanding) + "</td><td>" + n(r.ship_wk) + "</td></tr>"; }).join("");
    return tile(head("Export Sales", NAME[k] + " · " + esc(E.source || "USDA FAS Export Sales Reporting")) +
      '<div class="cf-head"><b>Weekly net sales</b><span>Week ' + esc(Lw[0]) + " to " + esc(Lw[1]) + "</span></div>" +
      '<table class="cf-tbl"><thead><tr><th>Measure</th><th>This week</th><th>Week on week</th><th>Read</th></tr></thead><tbody>' +
      "<tr><td>Net sales</td><td><b>" + n(latest) + " MT</b></td><td>" + (wow == null ? UNA : sg(wow) + " MT") + "</td><td>" + (wow == null ? "" : wow > 0 ? "Above the prior week" : wow < 0 ? "Below the prior week" : "Level with the prior week") + "</td></tr>" +
      "<tr><td>Season to date (sum of " + W.length + " reported weeks)</td><td>" + n(season) + " MT</td><td></td><td>Cumulative net sales across the reported weeks in this dataset</td></tr>" +
      (T.commit != null ? "<tr><td>Marketing-year commitments (cumulative)</td><td>" + n(T.commit) + " MT</td><td></td><td>Shipped " + n(T.shipped) + " MT · outstanding " + n(T.outstanding) + " MT · shipped this week " + n(T.ship_wk) + " MT</td></tr>" : "") +
      "</tbody></table>" + stamp("exports", "Source: " + (E.source || "USDA FAS Export Sales Reporting")), true) +
      tile(head("Top destinations this week", "share of the week's net sales") +
      (top.length ? '<table class="cf-tbl"><thead><tr><th>Country</th><th>Net (MT)</th><th>Share of week</th><th>WoW vs prev week</th><th>Shipped (MT)</th><th>Outstanding (MT)</th><th>Shipped this week (MT)</th></tr></thead><tbody>' + mix + "</tbody></table>"
        : "<p>" + UNA + " — no destination breakdown in the dataset.</p>") +
      stamp("exports", "Source: " + (E.source || "USDA FAS Export Sales Reporting") + " · destination week " + esc(D.week || Lw[0])), true);
  }

  /* ---- Derivatives Positions ---- */
  function monthLine(m, label) {
    if (!m || m.calls == null) return "<tr><td>" + esc(label) + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td></tr>";
    return "<tr><td>" + esc(label) + " · " + esc(m.chain || "") + " " + esc(m.contract || "") + "</td><td>" + n(m.calls) + "</td><td>" + n(m.puts) + "</td><td>" + (m.pcr == null ? UNA : (+m.pcr).toFixed(2)) + "</td><td>" + (m.call_wall ? d2(m.call_wall[0]) + " (" + n(m.call_wall[1]) + ")" : UNA) + "</td><td>" + (m.put_wall ? d2(m.put_wall[0]) + " (" + n(m.put_wall[1]) + ")" : UNA) + "</td><td>" + usd(notional((m.calls || 0) + (m.puts || 0), m.underlying)) + "</td></tr>";
  }
  function reportDeriv(k, G) {
    var K = G.cftc_stats && G.cftc_stats.kpi || {}, S = cftcSummary(k, G), V = G.vol || {};
    var kpi = tile(head("Positioning KPIs", NAME[k]) +
      '<table class="cf-tbl"><thead><tr><th>Measure</th><th>Value</th><th>Read</th></tr></thead><tbody>' +
      "<tr><td>Managed-money net</td><td>" + sg(K.net != null ? K.net : (S.latest && S.latest.net)) + " contracts</td><td>" + (S.wow == null ? "" : "Funds " + (S.wow < 0 ? "sold " : "bought ") + n(S.wow) + " net on the week") + "</td></tr>" +
      (K.z52 != null ? "<tr><td>52-week z-score</td><td>" + (K.z52 < 0 ? "−" : "+") + Math.abs(K.z52).toFixed(2) + "</td><td>" + (Math.abs(K.z52) >= 2 ? "Extreme against the past year" : "Not extreme against the past year") + "</td></tr>" : "") +
      (K.streak ? "<tr><td>Streak</td><td>" + Math.abs(K.streak) + " weeks</td><td>Net " + (K.streak < 0 ? "selling" : "buying") + " for " + Math.abs(K.streak) + " straight weeks</td></tr>" : "") +
      (K.cot3 != null ? "<tr><td>COT index (3-yr range)</td><td>" + (+K.cot3).toFixed(1) + " / 100</td><td>" + (K.cot3 >= 90 ? "Near the top of its 3-year range" : K.cot3 <= 10 ? "Near the bottom of its 3-year range" : "Mid-range") + "</td></tr>" : "") +
      (S.pct != null ? "<tr><td>Net as % of open interest</td><td>" + (S.pct < 0 ? "−" : "+") + pct1(S.pct) + "</td><td>" + esc(S.cr.label) + "</td></tr>" : "") +
      "</tbody></table>" + stamp("cftc_grains", "Source: CFTC Commitments of Traders, managed money only · report " + (K.date || (S.latest && S.latest.date) || UNA)), true);
    var cockpit = tile(head("Derivatives cockpit", "near / far month") +
      '<table class="cf-tbl"><thead><tr><th>Month</th><th>Call OI</th><th>Put OI</th><th>P/C</th><th>Call wall (strike · OI)</th><th>Put wall (strike · OI)</th><th>Notional</th></tr></thead><tbody>' +
      monthLine(G.near, "Near") + monthLine(G.far, "Far") + "</tbody></table>" + stamp("options", "Source: options chain snapshot · near " + esc((G.near && G.near.contract) || UNA)), true);
    var vol = "";
    if (V.near) {
      var row = function (m, label) { return "<tr><td>" + esc(label) + " · " + esc(m.contract || "") + "</td><td>" + (m.iv == null ? UNA : (+m.iv).toFixed(2) + "%") + "</td><td>" + (m.hv == null ? UNA : (+m.hv).toFixed(2) + "%") + "</td><td>" + (m.iv != null && m.hv != null ? (m.iv > m.hv ? "IV above HV — options pricing more movement than recently delivered" : m.iv < m.hv ? "IV below HV — options pricing less movement than recently delivered" : "IV in line with HV") : "") + "</td></tr>"; };
      vol = tile(head("Volatility", "implied vs historical") +
        '<table class="cf-tbl"><thead><tr><th>Contract</th><th>IV</th><th>HV</th><th>Read</th></tr></thead><tbody>' + row(V.near, "Near") + (V.far ? row(V.far, "Far") : "") + "</tbody></table>" +
        (V.pct ? "<p class=\"pos-read\">IV percentiles — 13-week " + (V.pct["13w"] == null ? UNA : Math.round(V.pct["13w"])) + " · 26-week " + (V.pct["26w"] == null ? UNA : Math.round(V.pct["26w"])) + " · 52-week " + (V.pct["52w"] == null ? UNA : Math.round(V.pct["52w"])) + ".</p>" : "") +
        stamp("options", "Source: " + esc(V.src || "options snapshot") + " · " + esc(V.date || UNA)), true);
    }
    var flow = "";
    var of = root.DATA.optflow && DATA.optflow[k];
    if (of) {
      var pos = of.positioning || {}, nd = of.next_day || {};
      var chains = (of.chains || []).map(function (c) { return "<tr><td>" + esc(c.contract || "") + " · " + esc(c.chain || "") + "</td><td>" + n(c.calls_oi) + "</td><td>" + n(c.puts_oi) + "</td><td>" + (c.pcr == null ? UNA : (+c.pcr).toFixed(2)) + "</td><td>" + (c.gex == null ? UNA : sg(c.gex)) + "</td><td>" + (c.flip == null ? UNA : d2(c.flip)) + "</td></tr>"; }).join("");
      var concl = (of.conclusion || []).slice(0, 4).map(function (c) { return "<li><b>" + esc(c.q) + "</b> " + esc(c.a) + "</li>"; }).join("");
      flow = tile(head("Options flow positioning", "flow snapshot") +
        '<table class="cf-tbl"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>' +
        (pos.label ? "<tr><td>Positioning read</td><td>" + esc(pos.label) + (pos.conf ? " · " + esc(pos.conf) + " confidence" : "") + "</td></tr>" : "") +
        (nd.lo != null && nd.hi != null ? "<tr><td>Next-session expected range</td><td>" + d2(nd.lo) + " to " + d2(nd.hi) + (nd.em != null ? " (±" + (+nd.em).toFixed(3) + ")" : "") + "</td></tr>" : "") +
        (pos.share != null ? "<tr><td>Flow share of near-chain OI</td><td>" + (+pos.share).toFixed(2) + "%</td></tr>" : "") +
        "</tbody></table>" +
        (chains ? '<table class="cf-tbl"><thead><tr><th>Chain</th><th>Call OI</th><th>Put OI</th><th>P/C</th><th>GEX</th><th>Flip</th></tr></thead><tbody>' + chains + "</tbody></table>" : "") +
        (concl ? "<ul class=\"pos-list\">" + concl + "</ul>" : "") +
        stamp("optflow", "Source: options flow snapshot · as-of " + esc(of.asof || UNA)), true);
    }
    return kpi + cockpit + vol + flow;
  }

  /* ---- Open Interest ---- */
  function reportOi(k, G) {
    var N = G.near, R = G.roll || [];
    if (!N || !N.rows) return tile(head("Open Interest", NAME[k]) + "<p>" + UNA + " — no options chain in the dataset.</p>" + stamp("options", "Source: options chain snapshot"));
    var V = root.OIVALUE ? root.OIVALUE(G) : null;
    var walls = "";
    if (N.call_wall || N.put_wall) {
      walls = '<table class="cf-tbl"><thead><tr><th>Wall</th><th>By contracts</th><th>By value</th></tr></thead><tbody>' +
        "<tr><td>Call wall</td><td>" + (N.call_wall ? d2(N.call_wall[0]) + " · " + n(N.call_wall[1]) + " contracts" : UNA) + "</td><td>" + (V && V.walls.cD ? d2(V.walls.cD.k) + " · delta value " + usd(V.walls.cD.cdel) : UNA) + "</td></tr>" +
        "<tr><td>Put wall</td><td>" + (N.put_wall ? d2(N.put_wall[0]) + " · " + n(N.put_wall[1]) + " contracts" : UNA) + "</td><td>" + (V && V.walls.pD ? d2(V.walls.pD.k) + " · delta value " + usd(V.walls.pD.pdel) : UNA) + "</td></tr>" +
        "</tbody></table>";
    }
    var byTot = N.rows.slice().sort(function (a, b) { return ((b[1] || 0) + (b[2] || 0)) - ((a[1] || 0) + (a[2] || 0)); }).slice(0, 12).sort(function (a, b) { return a[0] - b[0]; });
    var vmap = {}; if (V) V.rows.forEach(function (r) { vmap[r.k] = r; });
    var body = byTot.map(function (r) { var v = vmap[r[0]]; return "<tr><td><b>" + d2(r[0]) + "</b></td><td>" + n(r[1]) + "</td><td>" + n(r[2]) + "</td><td>" + n((r[1] || 0) + (r[2] || 0)) + "</td><td>" + (v ? usd(v.cprem) : UNA) + "</td><td>" + (v ? usd(v.cdel) : UNA) + "</td><td>" + (v ? usd(v.pprem) : UNA) + "</td><td>" + (v ? usd(v.pdel) : UNA) + "</td></tr>"; }).join("");
    var rollH = "";
    if (R[0] && R[1] && R[0].settle != null && R[1].settle != null) {
      var sp = (R[0].settle - R[1].settle) * 100, f0 = fnd(R[0].contract), f1 = fnd(R[1].contract);
      rollH = tile(head("Roll & carry", "front to deferred") +
        '<table class="cf-tbl"><thead><tr><th>Contract</th><th>Settle</th><th>Roll % (OI share)</th><th>FND</th></tr></thead><tbody>' +
        "<tr><td><b>" + esc(R[0].contract) + "</b> · front · " + esc(R[0].expiry || "") + "</td><td>" + d2(R[0].settle) + "</td><td>" + (R[0].oi_pct == null ? UNA : (+R[0].oi_pct).toFixed(1) + "%") + "</td><td>" + esc(f0 || UNA) + "</td></tr>" +
        "<tr><td><b>" + esc(R[1].contract) + "</b> · deferred · " + esc(R[1].expiry || "") + "</td><td>" + d2(R[1].settle) + "</td><td>" + (R[1].oi_pct == null ? UNA : (+R[1].oi_pct).toFixed(1) + "%") + "</td><td>" + esc(f1 || UNA) + "</td></tr>" +
        "</tbody></table>" +
        "<p class=\"pos-read\">Spread " + R[0].contract + " to " + R[1].contract + ": " + sgc(sp) + " — " + (sp < 0 ? "deferred above front (carry)" : sp > 0 ? "front above deferred (inverse)" : "flat") + ". Futures OI value: " + esc(R[0].contract) + " " + usd(notional(R[0].oi_oct19, R[0].settle)) + " · " + esc(R[1].contract) + " " + usd(notional(R[1].oi_oct19, R[1].settle)) + " (OI snapshot Oct 19).</p>" +
        stamp("grains_settle", "Source: settlements · settle date " + esc(R[0].settle_date || UNA)), true);
    }
    return tile(head("Open interest by strike", (N.chain || "") + " " + (N.contract || "") + " · " + (N.oi_label || "")) +
      walls +
      '<table class="cf-tbl"><thead><tr><th>Strike</th><th>Call OI</th><th>Put OI</th><th>Total OI</th><th>Call premium $</th><th>Call delta $</th><th>Put premium $</th><th>Put delta $</th></tr></thead><tbody>' + body + "</tbody></table>" +
      "<p class=\"pos-read\">Top 12 strikes by combined call + put open interest. Premium and delta values are Black-76 estimates from each strike's own IV at the futures price — estimates, not traded prices.</p>" +
      stamp("options", "Source: options chain snapshot · underlying " + (N.underlying == null ? UNA : d2(N.underlying))), true) + rollH;
  }

  function render() {
    if (!root.DATA || !DATA.grains) { P.innerHTML = '<div class="tile wide"><h2>Positioning / Open Interest</h2><p>Positioning data has not loaded yet.</p></div>'; return; }
    var k = st.commodity, G = DATA.grains[k];
    if (!G) { P.innerHTML = '<div class="tile wide"><h2>Positioning / Open Interest</h2><p>' + UNA + " — no data for " + esc(NAME[k] || k) + " in the dataset.</p></div>"; return; }
    var tabs = '<div class="pos-tabs" role="tablist" aria-label="Positioning reports">' + REPORTS.map(function (r) { return '<button type="button" role="tab" data-pos-report="' + r[0] + '" aria-selected="' + (r[0] === st.report) + '">' + esc(r[1]) + "</button>"; }).join("") + "</div>";
    var slicer = '<div class="gr-slicer" role="group" aria-label="Commodity"><span>Commodity</span>' + GR.map(function (x) { return '<button type="button" data-pos-pick="' + x + '" aria-pressed="' + (x === k) + '">' + NAME[x] + "</button>"; }).join("") + "</div>";
    var body = "";
    if (st.report === "cftc") body = reportCftc(k, G);
    else if (st.report === "exports") body = reportExports(k);
    else if (st.report === "deriv") body = reportDeriv(k, G);
    else body = reportOi(k, G);
    P.innerHTML = '<div class="pos-wrap">' + tabs + slicer + '<div class="pos-body">' + body + "</div></div>";
  }

  P.addEventListener("click", function (ev) {
    var r = ev.target.closest && ev.target.closest("[data-pos-report]");
    if (r) { st.report = r.getAttribute("data-pos-report"); save(); render(); return; }
    var c = ev.target.closest && ev.target.closest("[data-pos-pick]");
    if (c) { st.commodity = c.getAttribute("data-pos-pick"); save(); render(); }
  });
  root.addEventListener("desk:data", render);
  root.addEventListener("desk:unlock", function () { setTimeout(render, 300); });
  if (root.MutationObserver) new MutationObserver(function () { if (P.classList.contains("active")) render(); }).observe(P, { attributes: true, attributeFilter: ["class"] });
  if (root.DATA) render();
  root.POSITIONING = { render: render };
})(window);
