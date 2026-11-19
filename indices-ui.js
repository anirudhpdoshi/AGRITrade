/* indices-ui.js — US Indices tab: S&P 500, Nasdaq-100 and Dow Jones since the Nov 5, 2024 election,
   plus the Nifty 50 correlation. Reads indices-data.json (repo root, refreshed daily by
   .github/workflows/indices-refresh.yml from free Yahoo Finance daily closes). Price return unless
   labelled total return. Nothing here is recomputed from live prices; every number comes from the file. */
(function (root) {
  "use strict";
  var doc = root.document, P = doc.getElementById("panel-indices");
  if (!P) return;
  function esc(s) { return (root.DeskCore && root.DeskCore.esc) ? root.DeskCore.esc(s) : String(s == null ? "" : s).replace(/[&<>\"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var D = null, ERR = "", lastFetch = 0, timer = null;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var COL = { SPX: "#38b6c9", NDX: "#3fb97f", DJIA: "#e8a33d", TR: "#9db8d8", VIX: "#e8eef7", NIFTY: "#c792ea" };
  var NAME = { SPX: "S&P 500", NDX: "Nasdaq-100", DJIA: "Dow Jones" };

  function sgn(v, d) { if (v == null || isNaN(v)) return "—"; var s = v > 0 ? "+" : v < 0 ? "−" : ""; return s + Math.abs(v).toFixed(d == null ? 2 : d) + "%"; }
  function sgnPts(v, d) { if (v == null || isNaN(v)) return "—"; var s = v > 0 ? "+" : v < 0 ? "−" : ""; return s + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d }) + " pts"; }
  function num(v, d) { if (v == null || isNaN(v)) return "—"; return (+v).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function r2(v) { if (v == null || isNaN(v)) return "—"; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2); }
  function moLbl(m) { var p = String(m || "").replace("*", "").split("-"); if (p.length < 2) return String(m); return MON[+p[1] - 1] + " " + p[0].slice(2) + (String(m).indexOf("*") >= 0 ? "*" : ""); }
  function cellBg(v) { if (v == null) return ""; var a = Math.abs(v); if (a < 0.25) return "background:rgba(176,189,207,.10)"; var k = Math.min(a / 8, 1), al = (0.14 + 0.7 * Math.pow(k, 0.85)).toFixed(2); return "background:" + (v > 0 ? "rgba(63,185,127," : "rgba(224,101,95,") + al + ")"; }
  function dirCls(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }

  /* scoped styles for this tab only; the desk's own .tile / .kpi / .tbl-scroll classes carry the rest */
  function css() {
    if (doc.getElementById("ix-css")) return;
    var s = doc.createElement("style"); s.id = "ix-css";
    s.textContent =
      "#panel-indices .tile{margin-bottom:14px}" +
      ".ix-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}" +
      ".ix-kpis .kpi{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;min-width:0}" +
      ".ix-kpis .kpi-k{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}" +
      ".ix-kpis .kpi-v{font-family:\"IBM Plex Mono\",monospace;font-size:22px;font-weight:600;margin-top:2px;white-space:nowrap}" +
      ".ix-kpis .kpi-v small{font-size:12px;color:var(--muted);font-weight:500}" +
      ".ix-kpis .kpi-s{font-family:\"IBM Plex Mono\",monospace;font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.5}" +
      ".ix-take{font-size:13px;color:var(--muted);margin:8px 0 0;line-height:1.5}.ix-take b{color:var(--ink)}" +
      ".ix-leg{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin:8px 0 2px}" +
      ".ix-leg i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}" +
      ".ix-leg .sw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-right:5px}" +
      ".ix-ax{font-family:\"IBM Plex Mono\",monospace;font-size:10px;fill:var(--faint)}" +
      ".ix-axT{font-family:\"IBM Plex Mono\",monospace;font-size:11px;fill:var(--muted)}" +
      ".ix-grid{stroke:var(--line);stroke-width:1}" +
      ".ix-zero{stroke:var(--muted);stroke-width:1}" +
      "table.ix-t{border-collapse:collapse;width:100%;font-family:\"IBM Plex Mono\",monospace;font-size:12px}" +
      "table.ix-t th{font-size:11px;color:var(--faint);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line2);white-space:nowrap}" +
      "table.ix-t th:first-child,table.ix-t td:first-child{text-align:left}" +
      "table.ix-t td{padding:6px 8px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}" +
      "table.ix-t tr.tot td{font-weight:700;border-top:1px solid var(--line2)}" +
      "table.ix-sea{border-collapse:collapse;width:100%;font-family:\"IBM Plex Mono\",monospace;font-size:11.5px}" +
      "table.ix-sea th{font-size:11px;color:var(--faint);padding:6px 4px;border-bottom:1px solid var(--line2);text-align:center;white-space:nowrap}" +
      "table.ix-sea th:first-child,table.ix-sea td.yr{text-align:left;color:var(--muted);font-weight:700}" +
      "table.ix-sea td{padding:5px 4px;text-align:center;border-bottom:1px solid var(--line);vertical-align:top;line-height:1.45}" +
      "table.ix-sea td .r{font-weight:700;display:block}" +
      "table.ix-sea td .s{font-size:10.5px;color:var(--muted);display:block}" +
      "table.ix-sea td.na{color:var(--faint)}" +
      ".ix-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}" +
      ".ix-chips button{appearance:none;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted);background:var(--panel);border:1px solid var(--line2);border-radius:999px;padding:4px 13px;cursor:pointer}" +
      ".ix-chips button[aria-pressed=\"true\"]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
      ".ix-sec{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px}" +
      "#panel-indices details summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);margin:6px 0}" +
      ".ixw-gap{flex:0 0 14px}.ixw-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle}" +
      "table.ixw-t td,table.ixw-cm td{vertical-align:top;line-height:1.35}table.ixw-t td b,table.ixw-cm td b{font-weight:600}table.ixw-t td small,table.ixw-cm td small{display:block;font-size:10.5px;color:var(--muted)}" +
      "table.ixw-t td small.up,table.ixw-t .up{color:var(--up,#4fd18b)}table.ixw-t td small.dn,table.ixw-t .dn{color:var(--down,#ff7b72)}table.ixw-t td.na,table.ixw-cm td.na{color:var(--faint)}" +
      "table.ixw-t th small.ixw-run{display:block;font-size:9.5px;color:var(--amber)}table.ixw-t td:first-child,table.ixw-cm td:first-child{position:sticky;left:0;background:var(--panel);z-index:1}" +
      "table.ixw-cm td span{color:var(--muted);font-size:11px}.ixw-xs{grid-template-columns:repeat(5,minmax(0,1fr))!important}.ixw-x .kpi-v{font-size:18px}.ixw-x .kpi-s{white-space:normal!important;overflow:visible!important;text-overflow:clip!important}" +
      ".ixw-rb{position:relative;height:10px;margin:8px 0 3px;border-radius:5px;background:var(--line)}.ixw-rb .b1{position:absolute;top:0;bottom:0;border:1px solid;border-radius:5px}" +
      ".ixw-rb .c{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:var(--ink)}.ixw-rl{display:flex;justify-content:space-between;font:10px \"IBM Plex Mono\",monospace;color:var(--faint)}.ixw-rl b{color:var(--ink)}" +
      ".ixw-im{color:#c9a0f0}@media (max-width:1100px){.ixw-xs{grid-template-columns:repeat(2,minmax(0,1fr))!important}}" +
      "@media (max-width:760px){.ix-kpis{grid-template-columns:1fr}}";
    doc.head.appendChild(s);
  }

  /* ---------- SVG charts: labelled value axes with units on every chart ---------- */
  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n))), m = span / n / step;
    if (m >= 5) step *= 5; else if (m >= 2) step *= 2;
    var t0 = Math.ceil(lo / step) * step, out = [];
    for (var v = t0; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return { ticks: out, step: step };
  }
  function chartFrame(W, H, yLabel, yLabel2) {
    return { W: W, H: H, pL: 58, pR: yLabel2 ? 58 : 14, pT: 14, pB: 30,
             pw: W - 58 - (yLabel2 ? 58 : 14), ph: H - 14 - 30, yLabel: yLabel, yLabel2: yLabel2 };
  }
  function yAxisSVG(f, lo, hi, fmt) {
    var t = niceTicks(lo, hi, 4), s = "";
    t.ticks.forEach(function (v) {
      var y = f.pT + f.ph * (1 - (v - lo) / (hi - lo));
      s += '<line class="ix-grid" x1="' + f.pL + '" y1="' + y.toFixed(1) + '" x2="' + (f.pL + f.pw) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="ix-ax" x="' + (f.pL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + esc(fmt(v)) + "</text>";
    });
    s += '<text class="ix-axT" x="' + (f.pL - 46) + '" y="' + (f.pT - 2) + '" text-anchor="start">' + esc(f.yLabel) + "</text>";
    return s;
  }
  function yAxisRightSVG(f, lo, hi, fmt) {
    var t = niceTicks(lo, hi, 4), s = "";
    t.ticks.forEach(function (v) {
      var y = f.pT + f.ph * (1 - (v - lo) / (hi - lo));
      s += '<text class="ix-ax" x="' + (f.pL + f.pw + 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="start">' + esc(fmt(v)) + "</text>";
    });
    s += '<text class="ix-axT" x="' + (f.pL + f.pw + 46) + '" y="' + (f.pT - 2) + '" text-anchor="end">' + esc(f.yLabel2) + "</text>";
    return s;
  }
  function xLabelsSVG(f, labels, step) {
    var s = "", n = labels.length;
    labels.forEach(function (l, i) {
      if (i % step) return;
      var x = f.pL + (n === 1 ? f.pw / 2 : i / (n - 1) * f.pw);
      s += '<text class="ix-ax" x="' + x.toFixed(1) + '" y="' + (f.H - 8) + '" text-anchor="middle">' + esc(l) + "</text>";
    });
    return s;
  }
  /* lines: [{label, color, dash, vals:[number|null]}] over shared x labels */
  function lineSVG(lines, labels, yLabel, fmt, H) {
    var f = chartFrame(900, H || 300, yLabel), all = [];
    lines.forEach(function (L) { L.vals.forEach(function (v) { if (v != null) all.push(v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    var n = labels.length, X = function (i) { return f.pL + (n === 1 ? f.pw / 2 : i / (n - 1) * f.pw); },
        Y = function (v) { return f.pT + f.ph * (1 - (v - lo) / (hi - lo)); }, s = "";
    s += yAxisSVG(f, lo, hi, fmt) + xLabelsSVG(f, labels, Math.ceil(n / 12));
    lines.forEach(function (L) {
      var d = "";
      L.vals.forEach(function (v, i) { if (v == null) return; d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " "; });
      s += '<path d="' + d + '" fill="none" stroke="' + L.color + '" stroke-width="2"' + (L.dash ? ' stroke-dasharray="6 4"' : "") + "/>";
      var last = null; for (var i = L.vals.length - 1; i >= 0; i--) if (L.vals[i] != null) { last = i; break; }
      if (last != null) s += '<circle cx="' + X(last).toFixed(1) + '" cy="' + Y(L.vals[last]).toFixed(1) + '" r="3" fill="' + L.color + '"/>';
    });
    return '<svg viewBox="0 0 900 ' + f.H + '" width="100%" role="img" aria-label="' + esc(yLabel) + ' chart">' + s + "</svg>";
  }
  /* groups: [{label, bars:[{color, value}]}]; optional overlay line on a right axis */
  function barSVG(groups, yLabel, fmt, H, overlay) {
    var f = chartFrame(900, H || 300, yLabel, overlay ? overlay.yLabel : null), all = [];
    groups.forEach(function (g) { g.bars.forEach(function (b) { if (b.value != null) all.push(b.value); }); });
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max(0, Math.max.apply(null, all)), pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    var oLo = 0, oHi = 1;
    if (overlay) { overlay.vals.forEach(function (v) { if (v != null) all.push(v); }); oLo = Math.min.apply(null, overlay.vals.filter(function (v) { return v != null; })); oHi = Math.max.apply(null, overlay.vals.filter(function (v) { return v != null; })); var op = (oHi - oLo) * 0.1 || 1; oLo -= op; oHi += op; }
    var n = groups.length, gw = f.pw / n, Y = function (v) { return f.pT + f.ph * (1 - (v - lo) / (hi - lo)); },
        Y2 = function (v) { return f.pT + f.ph * (1 - (v - oLo) / (oHi - oLo)); }, s = "";
    s += yAxisSVG(f, lo, hi, fmt);
    if (overlay) s += yAxisRightSVG(f, oLo, oHi, overlay.fmt);
    s += '<line class="ix-zero" x1="' + f.pL + '" y1="' + Y(0).toFixed(1) + '" x2="' + (f.pL + f.pw) + '" y2="' + Y(0).toFixed(1) + '"/>';
    groups.forEach(function (g, i) {
      var bw = gw / (g.bars.length + 0.6), x0 = f.pL + i * gw + (gw - bw * g.bars.length) / 2;
      g.bars.forEach(function (b, j) {
        if (b.value == null) return;
        var y = Y(Math.max(b.value, 0)), h = Math.abs(Y(b.value) - Y(0));
        s += '<rect x="' + (x0 + j * bw).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 1.5).toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" fill="' + b.color + '"><title>' + esc(g.label + " — " + b.label + ": " + fmt(b.value)) + "</title></rect>";
      });
    });
    if (overlay) {
      var d = "";
      overlay.vals.forEach(function (v, i) { if (v == null) return; var x = f.pL + (i + 0.5) * gw; d += (d ? "L" : "M") + x.toFixed(1) + " " + Y2(v).toFixed(1) + " "; });
      s += '<path d="' + d + '" fill="none" stroke="' + overlay.color + '" stroke-width="2"/>';
    }
    s += xLabelsSVG(f, groups.map(function (g) { return g.label; }), Math.ceil(n / 12));
    return '<svg viewBox="0 0 900 ' + f.H + '" width="100%" role="img" aria-label="' + esc(yLabel) + ' chart">' + s + "</svg>";
  }
  function legend(items) {
    return '<div class="ix-leg">' + items.map(function (it) {
      return it.dash ? '<span><i style="background:' + it.color + ';height:2px;margin-bottom:1px"></i>' + esc(it.label) + "</span>"
        : it.bar ? '<span><span class="sw" style="background:' + it.color + '"></span>' + esc(it.label) + "</span>"
        : '<span><i style="background:' + it.color + '"></i>' + esc(it.label) + "</span>";
    }).join("") + "</div>";
  }

  /* ---------- sections ---------- */
  function kpiStrip() {
    var order = ["SPX", "NDX", "DJIA"], cards = order.map(function (k) {
      var x = D.indices[k], tr = x.total_return;
      return '<div class="kpi"><div class="kpi-k">' + esc(x.name) + '</div>' +
        '<div class="kpi-v ' + dirCls(x.cum_pct) + '">' + sgn(x.cum_pct) + ' <small>cumulative</small></div>' +
        '<div class="kpi-s">Close ' + num(x.end_close, 2) + ' · from ' + num(x.base_close, 2) + ' (Nov 4, 2024)<br>' +
        "2025 " + sgn(x.y2025_pct) + " · 2026 YTD " + sgn(x.y2026_ytd_pct) +
        (tr ? "<br>Total return " + sgn(tr.cum_pct) + " (divs incl.)" : "<br>Total return n/a — price only") + "</div></div>";
    }).join("");
    return '<div class="tile"><h2>Since the election <span class="h2note">— Nov 4, 2024 → ' + esc(D.meta.end_date) + ' · price return</span></h2>' +
      '<div class="ix-kpis">' + cards + "</div>" +
      '<p class="ix-take">' + (function () { var o = ["SPX", "NDX", "DJIA"].map(function (k) { return D.indices[k]; }).sort(function (a, b) { return b.cum_pct - a.cum_pct; }), tr = D.indices.SPX.total_return;
        return esc(o[0].name) + " leads on return (" + sgn(o[0].cum_pct) + "); " + esc(o[2].name) + " lags (" + sgn(o[2].cum_pct) + ")." + (tr ? " S&amp;P 500 total return is " + sgn(tr.cum_pct) + " with dividends." : ""); })() + "</p></div>";
  }
  function splitTile() {
    var rows = ["SPX", "NDX", "DJIA"].map(function (k) { var x = D.indices[k];
      return "<tr><td>" + esc(x.name) + "</td><td class=\"" + dirCls(x.elec_to_inaug_pct) + "\">" + sgn(x.elec_to_inaug_pct) + "</td><td class=\"" + dirCls(x.inaug_to_now_pct) + "\">" + sgn(x.inaug_to_now_pct) + "</td><td class=\"" + dirCls(x.cum_pct) + "\">" + sgn(x.cum_pct) + "</td></tr>"; }).join("");
    return '<div class="tile"><h2>Election rally vs the term so far</h2><div class="tbl-scroll"><table class="ix-t"><thead><tr><th>Index</th><th>Nov 4, 2024 → Jan 17, 2025</th><th>Jan 17, 2025 → now</th><th>Total</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="ix-take">' + (["SPX", "NDX", "DJIA"].every(function (k) { var x = D.indices[k]; return x.inaug_to_now_pct > x.elec_to_inaug_pct; }) ? "Most of the gain came after the inauguration, not in the post-election rally." : "The post-election rally did more of the work than the term so far for at least one index.") + "</p></div>";
  }
  function cumChart() {
    var labels = D.indices.SPX.cumulative.map(function (c) { return moLbl(c.month); });
    var lines = ["SPX", "NDX", "DJIA"].map(function (k) { return { label: NAME[k], color: COL[k], vals: D.indices[k].cumulative.map(function (c) { return c.idx; }) }; });
    var tr = D.indices.SPX.total_return;
    if (tr && tr.cumulative) lines.push({ label: "S&P 500 total return", color: COL.TR, dash: true, vals: tr.cumulative.map(function (c) { return c.idx; }) });
    var ends = lines.map(function (L) { return { label: L.label + " — " + num(L.vals[L.vals.length - 1], 1), color: L.color, dash: L.dash }; });
    return '<div class="tile"><h2>Cumulative performance <span class="h2note">— $100 invested Nov 4, 2024</span></h2>' +
      lineSVG(lines, labels, "Indexed value ($)", function (v) { return num(v, 0); }, 300) + legend(ends) +
      '<p class="ix-take">' + ["SPX", "NDX", "DJIA"].map(function (k) { var x = D.indices[k], dd = x.max_drawdown; return esc(NAME[k]) + " " + (dd.current_dd_pct < -0.05 ? sgn(dd.current_dd_pct) + " from its " + esc(dd.current_peak_date) + " peak" : "at its high"); }).join(" · ") + ".</p></div>";
  }
  function retChart() {
    var months = D.indices.SPX.monthly.filter(function (m) { return m.n_days > 0; });
    var groups = months.map(function (m) {
      return { label: moLbl(m.month), bars: ["SPX", "NDX", "DJIA"].map(function (k) {
        var hit = D.indices[k].monthly.filter(function (x) { return x.month === m.month; })[0];
        return { label: NAME[k], color: COL[k], value: hit ? hit.ret_pct : null }; }) };
    });
    return '<div class="tile"><h2>Monthly returns <span class="h2note">— month-end close vs prior month-end close, %</span></h2>' +
      barSVG(groups, "Monthly return (%)", function (v) { return num(v, 0) + "%"; }, 300) +
      legend(["SPX", "NDX", "DJIA"].map(function (k) { return { label: NAME[k], color: COL[k], bar: true }; })) +
      '<p class="ix-take">' + (function () { var b = null, w = null; ["SPX", "NDX", "DJIA"].forEach(function (k) { var x = D.indices[k]; if (!b || x.best_month.ret_pct > b[1].ret_pct) b = [k, x.best_month]; if (!w || x.worst_month.ret_pct < w[1].ret_pct) w = [k, x.worst_month]; });
        return "Best month: " + esc(NAME[b[0]]) + " " + esc(moLbl(b[1].month)) + " " + sgn(b[1].ret_pct) + ". Worst: " + esc(NAME[w[0]]) + " " + esc(moLbl(w[1].month)) + " " + sgn(w[1].ret_pct) + ". Nov 2024* is the post-election partial month; the latest month is month-to-date."; })() + "</p></div>";
  }
  function volChart() {
    var months = D.indices.SPX.monthly.filter(function (m) { return m.n_days > 0; });
    var groups = months.map(function (m) {
      return { label: moLbl(m.month), bars: ["SPX", "NDX", "DJIA"].map(function (k) {
        var hit = D.indices[k].monthly.filter(function (x) { return x.month === m.month; })[0];
        return { label: NAME[k], color: COL[k], value: hit ? hit.ann_vol_pct : null }; }) };
    });
    var vixVals = months.map(function (m) { var hit = D.vix.monthly.filter(function (x) { return x.month === m.month; })[0]; return hit ? hit.vix_wa : null; });
    return '<div class="tile"><h2>Monthly realised volatility <span class="h2note">— std dev of daily returns × √252, % p.a.</span></h2>' +
      barSVG(groups, "Annualised volatility (% p.a.)", function (v) { return num(v, 0) + "%"; }, 300,
        { vals: vixVals, color: COL.VIX, yLabel: "W.A. VIX level", fmt: function (v) { return num(v, 0); } }) +
      legend(["SPX", "NDX", "DJIA"].map(function (k) { return { label: NAME[k] + " vol", color: COL[k], bar: true }; }).concat([{ label: "W.A. VIX (right axis)", color: COL.VIX }])) +
      '<p class="ix-take">Highest-volatility month: ' + ["SPX", "NDX", "DJIA"].map(function (k) { var h = D.indices[k].highest_vol_month; return esc(NAME[k]) + " " + esc(moLbl(h.month)) + " " + num(h.ann_vol_pct, 2) + "%"; }).join(" · ") + ".</p></div>";
  }
  function rollChart() {
    var labels = D.rolling_vol.SPX.map(function (r) { return moLbl(r.month); });
    var lines = ["SPX", "NDX", "DJIA"].map(function (k) { return { label: NAME[k], color: COL[k], vals: D.rolling_vol[k].map(function (r) { return r.roll3m_ann_vol_pct; }) }; });
    return '<div class="tile"><h2>3-month rolling volatility <span class="h2note">— trailing 63 trading days, % p.a., at each month-end</span></h2>' +
      lineSVG(lines, labels, "Annualised volatility (% p.a.)", function (v) { return num(v, 0) + "%"; }, 260) +
      legend(["SPX", "NDX", "DJIA"].map(function (k) { return { label: NAME[k], color: COL[k] }; })) +
      '<p class="ix-take">Latest 3-month volatility: ' + ["SPX", "NDX", "DJIA"].map(function (k) { var a = D.rolling_vol[k], l = a[a.length - 1], p = a[a.length - 2]; return esc(NAME[k]) + " " + num(l.roll3m_ann_vol_pct, 1) + "%" + (p && p.roll3m_ann_vol_pct != null ? (l.roll3m_ann_vol_pct > p.roll3m_ann_vol_pct ? " (rising)" : " (easing)") : ""); }).join(" · ") + ".</p></div>";
  }

  function seasonTable(k) {
    var x = D.indices[k], S = D.seasonality[k], months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    var head = "<tr><th>Year</th>" + months.map(function (mm) { return "<th>" + MON[+mm - 1] + "</th>"; }).join("") + "<th>Year</th></tr>";
    var body = ["2024", "2025", "2026"].map(function (y) {
      var cells = months.map(function (mm) {
        var c = S[y] && S[y][mm];
        if (!c) return '<td class="na">—</td>';
        var title = moLbl(y + "-" + mm) + ": return " + sgn(c.ret_pct) + ", " + sgnPts(c.pts) + ", high–low " + num(c.hl_pct, 2) + "%, W.A. VIX " + num(c.vix_wa, 2);
        return '<td style="' + cellBg(c.ret_pct) + '" title="' + esc(title) + '"' + (c.partial ? ' class="partial"' : "") + ">" +
          '<span class="r ' + dirCls(c.ret_pct) + '">' + sgn(c.ret_pct) + (c.partial ? "*" : "") + "</span>" +
          '<span class="s">' + sgnPts(c.pts) + "</span>" +
          '<span class="s">H–L ' + num(c.hl_pct, 2) + "%</span>" +
          '<span class="s">VIX ' + num(c.vix_wa, 2) + "</span></td>";
      }).join("");
      var yt = x.year_totals[y];
      return '<tr><td class="yr">' + y + "</td>" + cells + '<td style="' + cellBg(yt ? yt.ret_pct / 3 : null) + '"><span class="r ' + dirCls(yt ? yt.ret_pct : 0) + '">' + (yt ? sgn(yt.ret_pct) : "—") + "</span>" +
        '<span class="s">' + (yt ? sgnPts(yt.pts) : "") + "</span></td></tr>";
    }).join("");
    return '<div class="ix-sec">' + esc(x.name) + ' — seasonality</div><div class="tbl-scroll"><table class="ix-sea"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }
  function seasonSection() {
    return '<div class="tile"><h2>Seasonality <span class="h2note">— years as rows, months as columns; each cell: return %, points moved, high–low %, W.A. VIX</span></h2>' +
      seasonTable("SPX") + seasonTable("NDX") + seasonTable("DJIA") +
      '<p class="ix-take">' + (function () { var S = D.seasonality.SPX, hi = null, lo = null; Object.keys(S).forEach(function (y) { Object.keys(S[y]).forEach(function (m) { var c = S[y][m]; if (!c || c.partial) return; if (!hi || c.ret_pct > hi[2]) hi = [y, m, c.ret_pct]; if (!lo || c.ret_pct < lo[2]) lo = [y, m, c.ret_pct]; }); });
        return hi && lo ? "S&amp;P 500 best full month " + esc(moLbl(hi[0] + "-" + hi[1])) + " " + sgn(hi[2]) + ", worst " + esc(moLbl(lo[0] + "-" + lo[1])) + " " + sgn(lo[2]) + ". * = partial month (Nov 2024 post-election only; the latest month is month-to-date)." : ""; })() + "</p></div>";
  }
  function riskTable() {
    var rows = ["SPX", "NDX", "DJIA"].map(function (k) { var x = D.indices[k], dd = x.max_drawdown, ra = x.risk_adjusted;
      return "<tr><td>" + esc(x.name) + "</td><td class=\"dn\">" + sgn(dd.max_dd_pct) + "</td><td>" + esc(dd.max_dd_date) + "</td><td>" + num(dd.max_dd_peak, 2) + "</td><td class=\"dn\">" + sgn(dd.current_dd_pct) + "</td><td>" + num(ra.sharpe, 2) + "</td><td>" + num(ra.sortino, 2) + "</td><td>" + num(x.return_to_drawdown, 2) + "</td><td>" + num(x.avg_ann_vol_pct, 2) + "%</td></tr>"; }).join("");
    return '<div class="tile"><h2>Drawdown &amp; risk-adjusted ranking <span class="h2note">— risk-free 3.93% (mean 13-week T-bill)</span></h2>' +
      '<div class="tbl-scroll"><table class="ix-t"><thead><tr><th>Index</th><th>Max drawdown</th><th>Bottomed</th><th>Peak before</th><th>Current DD</th><th>Sharpe</th><th>Sortino</th><th>Ret / DD</th><th>Avg ann vol</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="ix-take">' + (function () { var o = ["SPX", "NDX", "DJIA"].map(function (k) { return [k, D.indices[k].risk_adjusted.sharpe]; }).sort(function (a, b) { return b[1] - a[1]; });
        return "Risk-adjusted ranking (Sharpe): " + o.map(function (x) { return esc(NAME[x[0]]) + " " + num(x[1], 2); }).join(" › ") + ". Max drawdowns bottomed " + ["SPX", "NDX", "DJIA"].map(function (k) { return esc(NAME[k]) + " " + esc(D.indices[k].max_drawdown.max_dd_date); }).join(", ") + "."; })() + "</p></div>";
  }
  function niftySection() {
    var N = D.nifty, C = N.correlations;
    var kpis = '<div class="ix-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
      '<div class="kpi"><div class="kpi-k">Nifty 50 · INR</div><div class="kpi-v ' + dirCls(N.cum_pct_inr) + '">' + sgn(N.cum_pct_inr) + '</div><div class="kpi-s">Close ' + num(N.end_close, 2) + ' · from ' + num(N.base_close, 2) + '<br>2025 ' + sgn(N.y2025_pct_inr) + ' · 2026 YTD ' + sgn(N.y2026_ytd_pct_inr) + "</div></div>" +
      '<div class="kpi"><div class="kpi-k">Nifty 50 · USD</div><div class="kpi-v ' + dirCls(N.cum_pct_usd) + '">' + sgn(N.cum_pct_usd) + '</div><div class="kpi-s">USD/INR ' + num(N.usdinr.base, 2) + " → " + num(N.usdinr.end, 2) + " (rupee " + sgn(-N.usdinr.chg_pct) + ")<br>2025 " + sgn(N.y2025_pct_usd) + " · 2026 YTD " + sgn(N.y2026_ytd_pct_usd) + "</div></div>" +
      '<div class="kpi"><div class="kpi-k">Max drawdown · INR</div><div class="kpi-v dn">' + sgn(N.max_drawdown.inr_pct) + '</div><div class="kpi-s">Peak ' + num(N.max_drawdown.inr_peak, 2) + " (" + esc(N.max_drawdown.inr_peak_date) + ")<br>Trough " + num(N.max_drawdown.inr_trough, 2) + " (" + esc(N.max_drawdown.inr_trough_date) + ")</div></div>" +
      '<div class="kpi"><div class="kpi-k">Avg ann vol · INR</div><div class="kpi-v">' + num(N.avg_ann_vol_pct_inr, 2) + '%</div><div class="kpi-s">' + (["SPX", "NDX", "DJIA"].every(function (k) { return N.avg_ann_vol_pct_inr < D.indices[k].avg_ann_vol_pct; }) ? "Lowest of the four indices" : "vs US: " + ["SPX", "NDX", "DJIA"].map(function (k) { return num(D.indices[k].avg_ann_vol_pct, 1) + "%"; }).join(" / ")) + "<br>Best month " + esc(moLbl(N.best_month.month)) + (N.best_month.partial ? " MTD " : " ") + sgn(N.best_month.ret_pct_inr) + " · worst " + esc(moLbl(N.worst_month.month)) + " " + sgn(N.worst_month.ret_pct_inr) + "</div></div></div>";
    var corrRows = ["SPX", "NDX", "DJIA"].map(function (k) {
      return "<tr><td>" + esc(NAME[k]) + "</td><td>" + num(C.mom[k].inr, 2) + "</td><td>" + num(C.mom[k].usd, 2) + "</td><td>" + num(C.yoy[k].inr, 2) + "</td><td>" + num(C.yoy[k].usd, 2) + "</td></tr>"; }).join("");
    var divRows = N.divergence.map(function (d) {
      return "<tr><td>" + esc(moLbl(d.month)) + "</td><td class=\"" + dirCls(d.nifty) + "\">" + sgn(d.nifty) + "</td><td class=\"" + dirCls(d.spx) + "\">" + sgn(d.spx) + "</td><td class=\"" + dirCls(d.ndx) + "\">" + sgn(d.ndx) + "</td><td class=\"" + dirCls(d.djia) + "\">" + sgn(d.djia) + "</td><td class=\"" + dirCls(d.gap_pp) + "\">" + r2(d.gap_pp) + " pp</td></tr>"; }).join("");
    var yoyRows = N.monthly_yoy.map(function (r) {
      return "<tr><td>" + esc(moLbl(r.month)) + "</td><td>" + sgn(r.spx) + "</td><td>" + sgn(r.ndx) + "</td><td>" + sgn(r.djia) + "</td><td>" + sgn(r.nifty_inr) + "</td><td>" + sgn(r.nifty_usd) + "</td></tr>"; }).join("");
    return '<div class="tile"><h2>Nifty 50 vs the US indices <span class="h2note">— ' + esc(C.months) + ' · Nifty on IST dates</span></h2>' + kpis +
      '<div class="ix-sec">Correlation (Pearson r)</div><div class="tbl-scroll"><table class="ix-t"><thead><tr><th>Nifty vs</th><th>MoM · INR</th><th>MoM · USD</th><th>YoY · INR</th><th>YoY · USD</th></tr></thead><tbody>' + corrRows + "</tbody></table></div>" +
      '<p class="ix-take">' + (function () { var o = ["SPX", "NDX", "DJIA"].map(function (k) { return [k, C.mom[k].inr]; }).sort(function (a, b) { return b[1] - a[1]; }), y = ["SPX", "NDX", "DJIA"].map(function (k) { return C.yoy[k].inr; });
        var mx = o[0][1], word = mx >= 0.7 ? "Strong" : mx >= 0.4 ? "Moderate" : mx >= 0.2 ? "Weak-to-moderate" : "Weak";
        return word + " month-to-month link (strongest with " + esc(NAME[o[0][0]]) + " r " + num(o[0][1], 2) + ", weakest with " + esc(NAME[o[2][0]]) + " r " + num(o[2][1], 2) + "); year-over-year " + (y.every(function (v) { return v < 0; }) ? "negative" : y.every(function (v) { return v > 0; }) ? "positive" : "mixed") + "."; })() + "</p>" +
      '<div class="ix-sec">Biggest divergences — Nifty vs S&amp;P 500</div><div class="tbl-scroll"><table class="ix-t"><thead><tr><th>Month</th><th>Nifty</th><th>S&amp;P 500</th><th>Nasdaq-100</th><th>Dow</th><th>Gap</th></tr></thead><tbody>' + divRows + "</tbody></table></div>" +
      '<p class="ix-take">Nifty moved opposite to at least one US index in ' + N.opposite_months + ' of ' + C.n_months + ' months. Live divergence: Nifty ' + sgn(N.running_mtd.nifty_pct) + ' in ' + esc(moLbl(N.running_mtd.month)) + ' MTD vs S&amp;P ' + sgn(N.running_mtd.spx_pct) + ', Nasdaq-100 ' + sgn(N.running_mtd.ndx_pct) + ', Dow ' + sgn(N.running_mtd.djia_pct) + '.</p>' +
      '<details><summary>Year-over-year returns by month (%) — the trend divergence</summary><div class="tbl-scroll"><table class="ix-t"><thead><tr><th>Month</th><th>S&amp;P 500</th><th>Nasdaq-100</th><th>Dow</th><th>Nifty · INR</th><th>Nifty · USD</th></tr></thead><tbody>' + yoyRows + "</tbody></table></div>" +
      '<p class="note">' + esc(C.yoy_note) + "</p></details></div>";
  }
  /* ---------- weekly monitor (owner, Nov 19 2026): each week's level, wick, return and points for the US indices and Nifty,
     rolling correlation, the expected range for next month and the correlated move — all computed in scripts/indices.py ---------- */
  var WK_KEYS = ["SPX", "NDX", "DJIA", "NIFTY", "NIFTY_USD"], WK_COL = { SPX: COL.SPX, NDX: COL.NDX, DJIA: COL.DJIA, NIFTY: COL.NIFTY, NIFTY_USD: "#f07178" };
  var WV = "ret", WN = 12; try { WV = localStorage.getItem("desk.ix.wv") || "ret"; WN = +localStorage.getItem("desk.ix.wn") || 12; } catch (e) {}
  function wkLbl(d) { var p = String(d).split("-"); return MON[+p[1] - 1] + " " + (+p[2]); }
  function wName(k) { var s = D.weekly.series[k]; return s ? s.name : k; }
  function rngBar(lo2, lo1, c, hi1, hi2, col) {
    var span = hi2 - lo2 || 1, P = function (v) { return ((v - lo2) / span * 100).toFixed(1) + "%"; };
    return '<div class="ixw-rb"><span class="b2"></span><span class="b1" style="left:' + P(lo1) + ";right:calc(100% - " + P(hi1) + ');background:' + col + '33;border-color:' + col + '"></span><span class="c" style="left:' + P(c) + '"></span></div>' +
      '<div class="ixw-rl"><span>' + num(lo2, 0) + '</span><span>' + num(lo1, 0) + '</span><b>' + num(c, 0) + '</b><span>' + num(hi1, 0) + '</span><span>' + num(hi2, 0) + "</span></div>";
  }
  function weeklySection() {
    var W = D.weekly; if (!W || !W.series || !W.series.SPX) return "";
    var keys = WK_KEYS.filter(function (k) { return W.series[k] && W.series[k].weeks.length; });
    var weeks = W.series.SPX.weeks.slice(-WN).map(function (w) { return w.wk; });
    var lastWk = weeks[weeks.length - 1], today = new Date().toISOString().slice(0, 10);
    var V = { lvl: "Level", ret: "Returns %", pts: "Change · points", wick: "Wicks · high–low" };
    var chips = '<div class="ix-chips">' + Object.keys(V).map(function (v) { return '<button type="button" data-ixwv="' + v + '" aria-pressed="' + (WV === v) + '">' + V[v] + "</button>"; }).join("") +
      '<span class="ixw-gap"></span>' + [12, 26].map(function (n) { return '<button type="button" data-ixwn="' + n + '" aria-pressed="' + (WN === n) + '">' + n + " weeks</button>"; }).join("") + "</div>";
    var head = "<tr><th>Index</th>" + weeks.map(function (wk) { var s = W.series.SPX.weeks.filter(function (w) { return w.wk === wk; })[0];
      return "<th>wk " + esc(wkLbl(wk)) + (s && s.end >= today.slice(0, 10) || wk === lastWk && s && s.sessions < 5 ? '<small class="ixw-run">to date</small>' : "") + "</th>"; }).join("") + "</tr>";
    var body = keys.map(function (k) {
      var M = {}; W.series[k].weeks.forEach(function (w) { M[w.wk] = w; });
      return '<tr><td><i class="ixw-dot" style="background:' + WK_COL[k] + '"></i>' + esc(wName(k)) + "</td>" + weeks.map(function (wk) {
        var w = M[wk], d = k === "NIFTY_USD" ? 2 : 0; if (!w) return '<td class="na">—</td>';
        if (WV === "lvl") return '<td><b>' + num(w.close, d) + '</b><small class="' + dirCls(w.ret_pct) + '">' + sgn(w.ret_pct) + "</small></td>";
        if (WV === "ret") return '<td class="' + dirCls(w.ret_pct) + '" style="' + cellBg(w.ret_pct) + '"><b>' + sgn(w.ret_pct) + "</b></td>";
        if (WV === "pts") return '<td class="' + dirCls(w.pts) + '"><b>' + sgnPts(w.pts, d) + "</b><small>" + num(w.close, d) + "</small></td>";
        return '<td><b>' + num(w.range_pts, d) + '</b><small>' + num(w.range_pct, 2) + '% · <span class="up">▲' + num(w.upper_wick, d) + '</span> <span class="dn">▼' + num(w.lower_wick, d) + "</span></small></td>";
      }).join("") + "</tr>";
    }).join("");
    var note = { lvl: "Weekly close, with that week's % change beneath.", ret: "Close-to-close % change on the prior week.", pts: "Close-to-close change in index points, with the close beneath.",
      wick: "High–low range in points, with range % and the wicks: ▲ upper = high − max(open, close), ▼ lower = min(open, close) − low." }[WV];
    /* chart: every series indexed to 100 at the first week shown, so levels in different units sit on one scale */
    var lines = keys.map(function (k) { var M = {}; W.series[k].weeks.forEach(function (w) { M[w.wk] = w.close; }); var b = null;
      return { label: wName(k), color: WK_COL[k], dash: k === "NIFTY_USD", vals: weeks.map(function (wk) { var v = M[wk]; if (v == null) return null; if (b == null) b = v; return v / b * 100; }) }; });
    var levelChart = lineSVG(lines, weeks.map(wkLbl), "Weekly close, indexed (first week = 100)", function (v) { return num(v, 0); }, 260) +
      legend(lines.map(function (L) { var v = L.vals.filter(function (x) { return x != null; }); return { label: L.label + " " + sgn(v.length ? v[v.length - 1] - 100 : null), color: L.color, dash: L.dash }; }));
    /* rolling correlation */
    var RC = W.rolling_corr || {}, rcl = [], rlab = null;
    [["NIFTY", "SPX"], ["NIFTY", "NDX"], ["NIFTY", "DJIA"], ["NIFTY_USD", "SPX"]].forEach(function (p) { var s = RC[p[0]] && RC[p[0]][p[1]]; if (!s || !s.length) return; rlab = rlab || s.map(function (x) { return wkLbl(x.wk); });
      rcl.push({ label: wName(p[0]) + " vs " + NAME[p[1]], color: COL[p[1]], dash: p[0] === "NIFTY_USD", vals: s.map(function (x) { return x.r; }) }); });
    var corrChart = rcl.length ? lineSVG(rcl, rlab, "Rolling " + W.corr_window + "-week correlation (r)", function (v) { return num(Math.abs(v) < 0.05 ? 0 : v, 1); }, 240) +
      legend(rcl.map(function (L) { return { label: L.label + " · now " + r2(L.vals[L.vals.length - 1]), color: L.color, dash: L.dash }; })) : "";
    /* expected next-month range */
    var cards = keys.map(function (k) { var e = W.expected[k]; if (!e) return ""; var d = k === "NIFTY_USD" ? 2 : 0, im = e.implied;
      return '<div class="kpi ixw-x"><div class="kpi-k"><i class="ixw-dot" style="background:' + WK_COL[k] + '"></i>' + esc(wName(k)) + '</div>' +
        '<div class="kpi-v">±' + num(e.sigma_month_pct, 2) + '% <small>±' + num(e.pts_1s, d) + " pts · 1σ</small></div>" + rngBar(e.r2[0], e.r1[0], e.basis_close, e.r1[1], e.r2[1], WK_COL[k]) +
        '<div class="kpi-s">1σ (~68%) ' + num(e.r1[0], d) + " – " + num(e.r1[1], d) + "<br>2σ (~95%) " + num(e.r2[0], d) + " – " + num(e.r2[1], d) +
        (im ? '<br><span class="ixw-im">Implied (' + esc(im.index.replace("^", "")) + " " + num(im.level, 2) + ") ±" + num(im.sigma_month_pct, 2) + "% → " + num(im.r1[0], d) + " – " + num(im.r1[1], d) + "</span>" : "") +
        "<br>from " + num(e.basis_close, d) + " (" + esc(e.basis_date) + ") · weekly σ " + num(e.sigma_week_pct, 2) + "%</div></div>"; }).join("");
    /* correlated move */
    var drv = ["SPX", "NDX", "DJIA"], tg = keys;
    var cm = '<table class="ix-t ixw-cm no-tx"><thead><tr><th>Index</th>' + drv.map(function (d) { var e = W.expected[d]; return "<th>If " + esc(NAME[d]) + " moves ±" + (e ? num(e.sigma_month_pct, 2) : "—") + "%</th>"; }).join("") + "</tr></thead><tbody>" +
      tg.map(function (k) { var C = (W.correlated || {})[k] || {}, dd = k === "NIFTY_USD" ? 2 : 0;
        return '<tr><td><i class="ixw-dot" style="background:' + WK_COL[k] + '"></i>' + esc(wName(k)) + "</td>" + drv.map(function (d) { if (d === k) return '<td class="na">—</td>'; var c = C[d]; if (!c) return '<td class="na">—</td>';
          return '<td><b>±' + num(Math.abs(c.move_pct), 2) + "%</b> <span>±" + num(Math.abs(c.move_pts), dd) + ' pts</span><small>β ' + num(c.beta, 2) + " · r " + r2(c.r) + " · " + num(c.band[0], dd) + "–" + num(c.band[1], dd) + (c.beta < 0 ? " · moves opposite" : "") + "</small></td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
    /* takeaway from the numbers */
    var take = (function () {
      var n = W.correlated && W.correlated.NIFTY, best = null;
      if (n) Object.keys(n).forEach(function (d) { if (!best || Math.abs(n[d].r) > Math.abs(n[best].r)) best = d; });
      var ex = keys.map(function (k) { return [k, W.expected[k] && W.expected[k].sigma_month_pct]; }).filter(function (x) { return x[1] != null; }).sort(function (a, b) { return b[1] - a[1]; });
      var s = ex.length ? "Widest expected month: <b>" + esc(wName(ex[0][0])) + " ±" + num(ex[0][1], 2) + "%</b>; narrowest " + esc(wName(ex[ex.length - 1][0])) + " ±" + num(ex[ex.length - 1][1], 2) + "%. " : "";
      if (best) { var c = n[best], a = Math.abs(c.r); s += "Nifty tracks <b>" + esc(NAME[best]) + "</b> most closely over " + W.weeks_used + " weeks (r " + r2(c.r) + ", " + (a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "little") + " link): a typical ±" + num(c.driver_move_pct, 2) + "% month there carries ±" + num(Math.abs(c.move_pct), 2) + "% (±" + num(Math.abs(c.move_pts), 0) + " pts) into Nifty" + (c.beta < 0 ? " <b>in the opposite direction</b>" : "") + "; r² " + num(c.r2, 2) + " means the rest of Nifty's move is its own."; }
      return s;
    })();
    return '<div class="tile"><h2>Weekly monitor — US indices vs Nifty 50 <span class="h2note">— ' + esc(W.window) + " · " + W.weeks_used + " complete weeks for σ, β and r</span></h2>" + chips +
      '<div class="tbl-scroll"><table class="ix-t ixw-t no-tx"><thead>' + head + "</thead><tbody>" + body + '</tbody></table></div><p class="note">' + esc(note) + " Weeks run Monday–Friday; Nifty on IST dates, Nifty · USD = Nifty ÷ USD/INR.</p>" +
      levelChart + '<p class="ix-take">' + take + "</p>" +
      '<div class="ix-sec">Expected range — next month</div><div class="ix-kpis ixw-xs">' + cards + "</div>" +
      '<p class="note">Realised: weekly σ of the last ' + W.weeks_used + " complete weeks × √" + num(W.month_weeks, 1) + " (one month ≈ 21 sessions), applied to the latest close. Implied: the index's own volatility gauge × √(21/252), shown where Yahoo carries one. A statistical band, not a forecast.</p>" +
      '<div class="ix-sec">Correlated move expected next month</div><div class="tbl-scroll">' + cm + "</div>" +
      '<p class="note">Correlated move = β × the driver\'s 1σ monthly move; β and r from ' + W.weeks_used + " weekly returns. The band beneath is the target's latest close ± that move.</p>" +
      (corrChart ? '<div class="ix-sec">Rolling correlation — Nifty vs the US</div>' + corrChart : "") + "</div>";
  }
  function footer() {
    return '<div class="tile"><div class="stamp">Source: ' + esc(D.provider) + ". " + esc(D.basis) +
      " S&amp;P 500 total return from ^SP500TR (valid: TR/price ratio rises smoothly); Nasdaq-100 total return not shown — Yahoo ^NDXT is unreliable; Dow total return unavailable (^DJITR has 1 day of history). " +
      "Nifty 50 on IST calendar dates (Yahoo ^NSEI timestamps are ~03:45 UTC). Volatility = std dev of daily returns × √252. Risk-free = mean 13-week T-bill yield over the period (" + num(D.meta.risk_free_pct, 2) + "%). " +
      "Updated " + esc(D.updated_at) + ". Describes the past; not a forecast or trading advice.</div></div>";
  }
  function render() {
    css();
    if (!D) {
      P.innerHTML = '<div class="tile wide"><h2>US Indices — since the election</h2>' + (ERR ? '<p class="note">⚠ indices-data.json did not load (' + esc(ERR) + ') — the next daily refresh rewrites it.</p>' : '<p class="note">Loading…</p>') + "</div>";
      return;
    }
    P.innerHTML = '<div class="tile" style="margin-bottom:14px"><h2>US Indices — since the election <span class="h2note">— ' + esc(D.meta.baseline) + " · to " + esc(D.meta.end_date) + "</span></h2></div>" +
      weeklySection() + kpiStrip() + splitTile() + cumChart() + retChart() + volChart() + rollChart() + seasonSection() + riskTable() + niftySection() + footer();
  }
  function load() {
    return fetch("indices-data.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { D = j; ERR = ""; lastFetch = Date.now(); render(); })
      .catch(function (e) { ERR = String(e.message || e); render(); });
  }
  function active() { return P.classList.contains("active"); }
  function maybeLoad() { if (Date.now() - lastFetch > 60000) load(); else if (D) render(); }
  root.INDICES = { _data: function () { return D; } };
  /* World Markets section row: Markets · US Indices (nav-ui.js paints GNAV_CHIPS for the active page) */
  root.GNAV_CHIPS = root.GNAV_CHIPS || {};
  var WCH = { list: function () { var on = P.classList.contains("active"); return [["world", "Markets &amp; sessions", !on], ["indices", "US Indices · since the election", on]]; },
    go: function (id) { var b = doc.getElementById("tabbtn-" + id); if (b) b.click(); if (id === "indices") setTimeout(maybeLoad, 30); } };
  root.GNAV_CHIPS.world = WCH; root.GNAV_CHIPS.indices = WCH;
  P.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-ixwv],[data-ixwn]"); if (!b) return;
    if (b.dataset.ixwv) WV = b.dataset.ixwv; if (b.dataset.ixwn) WN = +b.dataset.ixwn;
    try { localStorage.setItem("desk.ix.wv", WV); localStorage.setItem("desk.ix.wn", String(WN)); } catch (e) {} var y = root.scrollY; render(); root.scrollTo(0, y); });
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("#tabbtn-indices"); if (b) setTimeout(maybeLoad, 30); });
  root.addEventListener("desk:unlock", function () { if (active()) maybeLoad(); });
  timer = setInterval(function () { if (active()) maybeLoad(); }, 60000);
  load();
})(window);
