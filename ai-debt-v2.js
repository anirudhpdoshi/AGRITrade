/* ai-debt-v2.js — AI Debt Intelligence (owner's redesign, Nov 19 2026).
   Five categories, five core charts, one expandable table under each chart:
     1 Debt outstanding (balance-sheet stock)   2 Debt raised & repaid (cash-flow activity)
     3 Funding sources                          4 Maturity & cost                5 Debt reconciliation
   Plus: refinancing vs fresh debt, AI-infrastructure tagging of raises, and a reconciliation check.
   Data: ai-debt-enhancement.json (SEC filings per company: annual profile, maturity ladder, debt service, flags) and
   ai-debt.json (every raise, with sources). Nothing is estimated here except where a line says "estimate".
   Rule kept: gross raised already contains bonds / loans / CP — the instrument split is shown as "of which", never added. */
(function (root) {
  "use strict";
  var doc = root.document, P = doc.getElementById("panel-aidebt"); if (!P) return;
  var E = null, R = null, ERR = "", SEL = null;
  try { SEL = localStorage.getItem("desk.ad2.co"); } catch (e) {}
  var C = { st: "#5aa9ff", lt: "#2c5f9e", raised: "#3fb97f", repaid: "#ff6b6b", net: "#ffb84d", bonds: "#38b6c9", bank: "#a78bfa", cp: "#f0c169", other: "#8a97a8",
    pc: "#e879f9", abs: "#f08a5d", mat: "#5aa9ff", liq: "#3fb97f", ie: "#5aa9ff", cov: "#ffb84d", ok: "#3fb97f", bad: "#ff6b6b" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function n(v) { return v == null || v === "" || isNaN(+v) ? null : +v; }
  function B(v, d) { v = n(v); if (v == null) return "—"; var a = Math.abs(v); return (v < 0 ? "−" : "") + "$" + (a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(d == null ? 2 : d)) + "B"; }
  function pct(v, d) { v = n(v); return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; }
  function x(v) { v = n(v); return v == null ? "—" : v.toFixed(2) + "x"; }
  function rate(v) { v = n(v); return v == null ? "—" : v.toFixed(2) + "%"; }
  function yl(y) { return y === "TTM" ? "TTM" : "FY" + y; }

  /* ---------------- data shaping ---------------- */
  function cos() { return E ? E.companies : []; }
  function co(name) { return cos().filter(function (c) { return c.company === name; })[0] || cos()[0]; }
  function profile(c) {
    var ap = c.annual_profile; if (ap && !Array.isArray(ap)) ap = ap.rows || null;
    return (ap || []).filter(function (r) { return r && (r.total_debt_usd_b != null || r.gross_raised_usd_b != null || r.principal_repaid_usd_b != null); });
  }
  function unavailable(c) { var ap = c.annual_profile; return ap && !Array.isArray(ap) && ap.status === "UNAVAILABLE" ? ap.reason : null; }
  function raises(c) { return (R ? R.rows : []).filter(function (r) { return r.company === c.company; }); }
  var AI_RX = /gpu|data ?cent|datacent|power|project|equipment|lease|ddtl|delayed draw|compute|infrastructure|campus|asset-backed|abs\b|sale-leaseback|vendor|chip/i;
  function instClass(t) { t = String(t || ""); return /commercial paper/i.test(t) ? "cp" : /asset-backed|abs\b|securiti/i.test(t) ? "abs" : /private|direct lend|ddtl|delayed draw|project|construction|spv|gpu|equipment|lease/i.test(t) ? "pc" : /term loan|revolv|credit facilit|bank|loan/i.test(t) ? "bank" : /note|bond|debenture|convertible/i.test(t) ? "bonds" : "other"; }
  var ICN = { bonds: "Bonds & notes", bank: "Bank loans & facilities", cp: "Commercial paper", pc: "Private credit & GPU / project financing", abs: "Asset-backed", other: "Other" };
  function dueYear(t) { var m = /due (20\d\d)/i.exec(t || ""); return m ? m[1] : ""; }

  /* ---------------- SVG chart kit (value labels on every bar) ---------------- */
  function frame(W, H) { return { W: W, H: H, l: 56, r: 56, t: 22, b: 36 }; }
  function ticks(lo, hi, k) { var s = (hi - lo) / k || 1, p = Math.pow(10, Math.floor(Math.log10(s))), m = s / p; s = (m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1) * p; var o = []; for (var v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) o.push(+v.toFixed(6)); return o; }
  function svgOpen(f, label) { return '<svg viewBox="0 0 ' + f.W + " " + f.H + '" class="a2-svg" role="img" aria-label="' + esc(label) + '">'; }
  function yAxis(f, lo, hi, fmt, right) {
    var Y = function (v) { return f.t + (hi - v) / (hi - lo) * (f.H - f.t - f.b); }, s = "";
    ticks(lo, hi, 4).forEach(function (v) { if (!right) s += '<line x1="' + f.l + '" x2="' + (f.W - f.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="a2-g"/>'; s += '<text x="' + (right ? f.W - f.r + 6 : f.l - 6) + '" y="' + (Y(v) + 4) + '" class="a2-ax" text-anchor="' + (right ? "start" : "end") + '">' + fmt(v) + "</text>"; });
    return { s: s, Y: Y };
  }
  /* stacked columns; series: [{k,label,color}], rows: [{lab, v:{k:val}, total?}] */
  function stacked(rows, series, opt) {
    opt = opt || {}; var f = frame(720, opt.h || 280), n2 = rows.length; if (!n2) return '<div class="a2-ph">No data for this chart.</div>';
    var hi = 0, lo = 0; rows.forEach(function (r) { var p = 0, q = 0; series.forEach(function (s) { var v = n(r.v[s.k]) || 0; if (v >= 0) p += v; else q += v; }); hi = Math.max(hi, p, n(r.total) || 0); lo = Math.min(lo, q); });
    if (opt.pct) { hi = 100; lo = 0; } hi = hi * 1.12 || 1; lo = lo ? lo * 1.12 : 0;
    var A = yAxis(f, lo, hi, opt.pct ? function (v) { return v + "%"; } : function (v) { return "$" + v + "B"; }), Y = A.Y, s = A.s, bw = (f.W - f.l - f.r) / n2;
    if (lo < 0) s += '<line x1="' + f.l + '" x2="' + (f.W - f.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" class="a2-z"/>';
    rows.forEach(function (r, i) {
      var x0 = f.l + i * bw + bw * 0.18, w = bw * 0.64, up = 0, dn = 0, tot = 0;
      series.forEach(function (sr) { tot += Math.max(0, n(r.v[sr.k]) || 0); });
      series.forEach(function (sr) {
        var v = n(r.v[sr.k]); if (!v) return; if (opt.pct) v = tot ? v / tot * 100 : 0;
        var a = v >= 0 ? up : dn, b = a + v; if (v >= 0) up = b; else dn = b;
        var y1 = Y(Math.max(a, b)), h = Math.abs(Y(a) - Y(b));
        s += '<rect x="' + x0.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 0.5).toFixed(1) + '" fill="' + sr.color + '" rx="2"><title>' + esc(r.lab + " · " + sr.label + ": " + (opt.pct ? v.toFixed(1) + "% (" + B(r.v[sr.k]) + ")" : B(r.v[sr.k]))) + "</title></rect>";
        if (h > 15 && w > 34) s += '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (y1 + h / 2 + 4).toFixed(1) + '" class="a2-in" text-anchor="middle">' + (opt.pct ? v.toFixed(0) + "%" : B(Math.abs(v), 1).replace("$", "")) + "</text>";
      });
      var lab = opt.pct ? "" : r.total != null ? B(r.total) : up ? B(up) : "";
      if (lab) s += '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (Y(Math.max(up, n(r.total) || 0)) - 6).toFixed(1) + '" class="a2-top" text-anchor="middle">' + lab + "</text>";
      if (opt.dot && n(r.dot) != null) s += '<circle cx="' + (x0 + w / 2).toFixed(1) + '" cy="' + Y(r.dot).toFixed(1) + '" r="5" fill="' + C.net + '" stroke="#000" stroke-width="1.5"><title>' + esc(r.lab + " · " + opt.dot + ": " + B(r.dot)) + "</title></circle>" +
        '<text x="' + (x0 + w + 4).toFixed(1) + '" y="' + (Y(r.dot) + 4).toFixed(1) + '" class="a2-dl">' + B(r.dot, 1) + "</text>";
      s += '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (f.H - 12) + '" class="a2-xl" text-anchor="middle">' + esc(r.lab) + "</text>";
    });
    if (opt.ref != null) s += '<line x1="' + f.l + '" x2="' + (f.W - f.r) + '" y1="' + Y(opt.ref) + '" y2="' + Y(opt.ref) + '" class="a2-ref"/><text x="' + (f.W - f.r - 4) + '" y="' + (Y(opt.ref) - 6) + '" class="a2-refl" text-anchor="end">' + esc(opt.refLab) + "</text>";
    return svgOpen(f, opt.label || "") + s + "</svg>";
  }
  /* bars (left axis, $B) + line (right axis, x) + dashed reference on the line axis — interest expense vs coverage */
  function combo(rows, opt) {
    var f = frame(720, 260), n2 = rows.length; if (!n2) return '<div class="a2-ph">No data for this chart.</div>';
    var bh = Math.max.apply(null, rows.map(function (r) { return n(r.bar) || 0; }).concat([0.1])) * 1.25, lv = rows.map(function (r) { return n(r.line); }).filter(function (v) { return v != null; });
    var lhi = Math.max.apply(null, lv.concat([opt.ref || 0])) * 1.2 || 1, llo = Math.min(0, Math.min.apply(null, lv.concat([0])) * 1.2);
    var A = yAxis(f, 0, bh, function (v) { return "$" + v + "B"; }), Y = A.Y, Y2 = function (v) { return f.t + (lhi - v) / (lhi - llo) * (f.H - f.t - f.b); }, s = A.s, bw = (f.W - f.l - f.r) / n2;
    ticks(llo, lhi, 4).forEach(function (v) { s += '<text x="' + (f.W - f.r + 6) + '" y="' + (Y2(v) + 4) + '" class="a2-ax">' + v + "x</text>"; });
    var pts = [];
    rows.forEach(function (r, i) {
      var x0 = f.l + i * bw + bw * 0.22, w = bw * 0.56, v = n(r.bar);
      if (v != null) s += '<rect x="' + x0.toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (Y(0) - Y(v)).toFixed(1) + '" fill="' + C.ie + '" opacity=".55" rx="2"><title>' + esc(r.lab + " · interest expense " + B(v)) + '</title></rect><text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (Y(0) - 6).toFixed(1) + '" class="a2-in" text-anchor="middle">' + B(v) + "</text>";
      if (n(r.line) != null) pts.push([x0 + w / 2, Y2(r.line), r.line, r.lab]);
      s += '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (f.H - 12) + '" class="a2-xl" text-anchor="middle">' + esc(r.lab) + "</text>";
    });
    if (opt.ref != null) s += '<line x1="' + f.l + '" x2="' + (f.W - f.r) + '" y1="' + Y2(opt.ref) + '" y2="' + Y2(opt.ref) + '" class="a2-ref"/><text x="' + (f.l + 6) + '" y="' + (Y2(opt.ref) - 6) + '" class="a2-refl">' + esc(opt.refLab) + "</text>";
    if (pts.length > 1) s += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '" fill="none" stroke="' + C.cov + '" stroke-width="2.5"/>';
    pts.forEach(function (p) { s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="' + C.cov + '"><title>' + esc(p[3] + " · coverage " + p[2].toFixed(2) + "x") + '</title></circle><text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 9).toFixed(1) + '" class="a2-dl" text-anchor="middle">' + p[2].toFixed(1) + "x</text>"; });
    return svgOpen(f, "Interest expense and interest coverage") + s + "</svg>";
  }
  /* waterfall: steps [{lab, v, kind:'total'|'up'|'down'|'adj'}] */
  function waterfall(steps) {
    var f = frame(720, 280), n2 = steps.length, run = 0, bars = [];
    steps.forEach(function (st) { if (st.kind === "total") { bars.push([0, st.v, st]); run = st.v; } else { var a = run; run += st.v; bars.push([a, run, st]); } });
    var hi = Math.max.apply(null, bars.map(function (b) { return Math.max(b[0], b[1]); })) * 1.15 || 1, lo = Math.min(0, Math.min.apply(null, bars.map(function (b) { return Math.min(b[0], b[1]); })));
    var A = yAxis(f, lo, hi, function (v) { return "$" + v + "B"; }), Y = A.Y, s = A.s, bw = (f.W - f.l - f.r) / n2;
    bars.forEach(function (b, i) {
      var st = b[2], x0 = f.l + i * bw + bw * 0.2, w = bw * 0.6, col = st.kind === "total" ? C.lt : st.kind === "adj" ? (Math.abs(st.v) > st.tol ? C.bad : C.other) : st.v >= 0 ? C.raised : C.repaid;
      var y1 = Y(Math.max(b[0], b[1])), h = Math.max(1, Math.abs(Y(b[0]) - Y(b[1])));
      s += '<rect x="' + x0.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + col + '" rx="2"><title>' + esc(st.lab + ": " + B(st.v)) + "</title></rect>" +
        '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (y1 - 6).toFixed(1) + '" class="a2-top" text-anchor="middle">' + (st.kind === "total" ? B(st.v) : (st.v >= 0 ? "+" : "") + B(st.v)) + "</text>" +
        '<text x="' + (x0 + w / 2).toFixed(1) + '" y="' + (f.H - 12) + '" class="a2-xl" text-anchor="middle">' + esc(st.lab) + "</text>";
      if (i < n2 - 1) s += '<line x1="' + (x0 + w).toFixed(1) + '" x2="' + (x0 + bw).toFixed(1) + '" y1="' + Y(b[1]).toFixed(1) + '" y2="' + Y(b[1]).toFixed(1) + '" class="a2-con"/>';
    });
    return svgOpen(f, "Debt reconciliation waterfall") + s + "</svg>";
  }
  function legend(items) { return '<div class="a2-lg">' + items.map(function (i) { return '<span><i style="background:' + i[1] + (i[2] ? ";height:0;border-top:2px dashed " + i[1] : "") + '"></i>' + esc(i[0]) + "</span>"; }).join("") + "</div>"; }
  /* periods across, fields down (desk rule); rows: [label, fn(period)->html, cls?] */
  function table(periods, rows, note) {
    return '<div class="a2-tw"><table class="a2-t"><thead><tr><th></th>' + periods.map(function (p) { return "<th>" + esc(yl(p.year)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return '<tr class="' + (r[2] || "") + '"><th scope="row">' + r[0] + "</th>" + periods.map(function (p) { return "<td>" + r[1](p) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" + (note ? '<p class="a2-note">' + note + "</p>" : "");
  }
  function det(title, body, open) { return '<details class="a2-x"' + (open ? " open" : "") + "><summary>" + title + "</summary>" + body + "</details>"; }
  function sec(no, title, sub, chart, more, side) {
    return '<section class="a2-sec"><div class="a2-sh"><span class="a2-no">' + no + "</span><div><h3>" + title + '</h3><p class="a2-ss">' + sub + "</p></div></div>" +
      (side ? '<div class="a2-two"><div>' + chart + "</div><div>" + side + "</div></div>" : chart) + more + "</section>";
  }
  function cls(v, inv) { v = n(v); return v == null || v === 0 ? "" : (v > 0) !== !!inv ? "a2-up" : "a2-dn"; }

  /* ---------------- page ---------------- */
  function render() {
    css();
    if (!E || !R) { P.innerHTML = '<div class="tile wide"><h2>AI Debt Intelligence</h2><p class="note">' + (ERR ? "⚠ Data did not load (" + esc(ERR) + ")." : "Loading…") + "</p></div>"; return; }
    var c = co(SEL), pr = profile(c), un = unavailable(c), FY = pr.filter(function (p) { return p.year !== "TTM"; }), TT = pr.filter(function (p) { return p.year === "TTM"; })[0];
    var L = TT && n(TT.total_debt_usd_b) != null ? TT : FY.filter(function (p) { return n(p.total_debt_usd_b) != null; }).slice(-1)[0] || pr.slice(-1)[0] || {};
    var lastFY = FY.filter(function (p) { return n(p.total_debt_usd_b) != null; }).slice(-1)[0] || {}, prevFY = FY.filter(function (p) { return n(p.total_debt_usd_b) != null && p.year < lastFY.year; }).slice(-1)[0];
    var growth = L === TT && n(lastFY.total_debt_usd_b) ? (L.total_debt_usd_b / lastFY.total_debt_usd_b - 1) * 100 : prevFY && n(prevFY.total_debt_usd_b) ? (lastFY.total_debt_usd_b / prevFY.total_debt_usd_b - 1) * 100 : null;
    var gLab = L === TT ? "TTM vs " + yl(lastFY.year) + " year-end" : prevFY ? yl(lastFY.year) + " vs " + yl(prevFY.year) : "";
    var RW = raises(c), flows = pr.filter(function (p) { return n(p.gross_raised_usd_b) != null || n(p.principal_repaid_usd_b) != null; });
    var newY = n(L.wa_yield_new_issues_pct) != null ? L.wa_yield_new_issues_pct : (pr.slice().reverse().filter(function (p) { return n(p.wa_yield_new_issues_pct) != null; })[0] || {}).wa_yield_new_issues_pct;
    var WF = c.warning_flags_summary || {};

    /* chips */
    var chips = '<div class="a2-cos">' + cos().map(function (k) { return '<button data-a2co="' + esc(k.company) + '" aria-pressed="' + (k.company === c.company) + '">' + esc(k.company.replace(/ \(.*\)/, "")) + (k.ticker ? " <small>" + esc(k.ticker) + "</small>" : "") + "</button>"; }).join("") + "</div>";
    /* headline cards */
    var LW = function (f) { return L && n(L[f]) != null ? L : pr.slice().reverse().filter(function (p) { return n(p[f]) != null; })[0] || {}; };   /* each card: latest period that reports it */
    var GR = LW("gross_raised_usd_b"), NB = LW("net_borrowing_usd_b"), IE = LW("interest_expense_usd_b"), DE = LW("debt_to_ebitda");
    var card = function (k, v, s2, c2) { return '<div class="a2-k"><span class="kk">' + k + '</span><b class="' + (c2 || "") + '">' + v + '</b><span class="ks">' + s2 + "</span></div>"; };
    var heads = un ? "" : '<div class="a2-ks">' +
      card("Total debt", B(L.total_debt_usd_b), esc(yl(L.year)) + (L.period_end ? " · " + esc(L.period_end) : "")) +
      card("Net debt", B(L.net_debt_usd_b), "debt − cash " + B(L.cash_and_equivalents_usd_b), n(L.net_debt_usd_b) < 0 ? "a2-up" : "") +
      card("Gross raised", B(GR.gross_raised_usd_b), (GR.year != null ? esc(yl(GR.year)) + " · " : "") + "all instruments") +
      card("Net borrowing", B(NB.net_borrowing_usd_b), (NB.year != null ? esc(yl(NB.year)) + " · " : "") + "raised − principal repaid", cls(NB.net_borrowing_usd_b, true)) +
      card("Debt growth", pct(growth), esc(gLab), cls(growth, true)) +
      card("Interest expense", B(IE.interest_expense_usd_b), (IE.year != null ? esc(yl(IE.year)) : "") + (n(IE.interest_coverage_ebit) != null ? " · EBIT covers " + x(IE.interest_coverage_ebit) : "")) +
      card("Debt / EBITDA", x(DE.debt_to_ebitda), (DE.year != null ? esc(yl(DE.year)) + " · " : "") + "net " + x(DE.net_debt_to_ebitda), n(DE.debt_to_ebitda) > 3 ? "a2-dn" : "") +
      card("New debt yield", rate(newY), "existing debt " + rate(L.wa_interest_rate_existing_debt_pct), n(newY) - n(L.wa_interest_rate_existing_debt_pct) > 1 ? "a2-dn" : "") + "</div>" +
      '<div class="a2-fl">' + [["refinancing_risk", "Refinancing risk"], ["rising_cost_of_debt", "Rising cost of debt"], ["cash_flow_stress", "Cash-flow stress"], ["leverage_deterioration", "Leverage deterioration"]].map(function (k) {
        var f2 = WF[k[0]]; if (!f2) return ""; return '<span class="a2-f ' + (f2.flag ? "on" : "off") + '" title="' + esc(f2.detail || "") + '">' + (f2.flag ? "⚠ " : "✓ ") + k[1] + "</span>"; }).join("") + "</div>";

    var out = '<div class="a2-head"><div><h2>AI Debt Intelligence</h2><p class="a2-ss">Balance-sheet debt (stock) is kept apart from money raised and repaid (flow). USD billions · SEC filings · raises ' + esc(R.window) + " · data " + esc(E.meta && E.meta.generated || R.updated) + "</p></div></div>" + chips +
      '<div class="a2-co"><h3>' + esc(c.company) + (c.ticker ? ' <small>' + esc(c.ticker) + " · FY ends " + esc(String(c.fiscal_year_end || "").slice(5)) + "</small>" : "") + "</h3>" + heads + "</div>";
    if (un) out += '<div class="a2-ph big">' + esc(un) + "</div>";

    var P2 = pr.filter(function (p) { return n(p.total_debt_usd_b) != null; });
    if (!un) {
      /* 1 Debt outstanding */
      var r1 = P2.map(function (p) { return { lab: yl(p.year), total: p.total_debt_usd_b, v: { st: n(p.short_term_debt_usd_b), lt: n(p.long_term_debt_usd_b) != null ? p.long_term_debt_usd_b : (n(p.short_term_debt_usd_b) == null ? p.total_debt_usd_b : null) } }; });
      out += sec("01", "Debt outstanding", "What the company owes at each period-end — short-term (due within a year) and long-term, total on top.",
        stacked(r1, [{ k: "lt", label: "Long-term", color: C.lt }, { k: "st", label: "Short-term", color: C.st }], { label: "Debt outstanding" }) + legend([["Long-term", C.lt], ["Short-term (current)", C.st]]),
        det("Breakdown — current vs non-current, leverage", table(P2, [["Total debt", function (p) { return B(p.total_debt_usd_b); }, "b"], ["Short-term (current)", function (p) { return B(p.short_term_debt_usd_b); }], ["Long-term", function (p) { return B(p.long_term_debt_usd_b); }],
          ["Cash & equivalents", function (p) { return B(p.cash_and_equivalents_usd_b); }], ["Net debt", function (p) { return '<span class="' + (n(p.net_debt_usd_b) < 0 ? "a2-up" : "") + '">' + B(p.net_debt_usd_b) + "</span>"; }],
          ["Debt growth y/y", function (p) { return '<span class="' + cls(p.yoy_debt_change_pct, true) + '">' + pct(p.yoy_debt_change_pct) + "</span>"; }], ["Debt / equity", function (p) { return x(p.debt_to_equity); }], ["Debt / EBITDA", function (p) { return x(p.debt_to_ebitda); }], ["Net debt / EBITDA", function (p) { return x(p.net_debt_to_ebitda); }]])));

      /* 2 Raised & repaid + refinancing vs fresh */
      var r2 = flows.map(function (p) { var g = n(p.gross_raised_usd_b) || 0, rp = n(p.principal_repaid_usd_b) || 0; return { lab: yl(p.year), v: { raised: g, repaid: -rp }, dot: n(p.net_borrowing_usd_b) != null ? p.net_borrowing_usd_b : g - rp, total: null }; });
      out += sec("02", "Debt raised &amp; repaid", "Cash-flow activity: money raised above the line, principal repaid below it, net borrowing as the dot.",
        stacked(r2, [{ k: "raised", label: "Gross raised", color: C.raised }, { k: "repaid", label: "Principal repaid", color: C.repaid }], { dot: "Net borrowing", label: "Debt raised and repaid" }) + legend([["Gross raised", C.raised], ["Principal repaid", C.repaid], ["Net borrowing", C.net]]),
        det("Breakdown — instruments (of which), refinancing vs fresh debt", table(flows, [["Gross raised", function (p) { return B(p.gross_raised_usd_b); }, "b"],
          ["&nbsp;&nbsp;of which bonds &amp; notes", function (p) { return B(p.bonds_usd_b); }, "sub"], ["&nbsp;&nbsp;of which bank borrowings", function (p) { return B(p.bank_borrowings_usd_b); }, "sub"], ["&nbsp;&nbsp;of which commercial paper", function (p) { return B(p.commercial_paper_usd_b); }, "sub"], ["&nbsp;&nbsp;of which other", function (p) { return B(p.other_borrowings_usd_b); }, "sub"],
          ["Principal repaid", function (p) { return B(p.principal_repaid_usd_b); }], ["Net borrowing", function (p) { return '<span class="' + cls(p.net_borrowing_usd_b, true) + '">' + B(p.net_borrowing_usd_b) + "</span>"; }, "b"],
          ["Refinancing (est.)", function (p) { var g = n(p.gross_raised_usd_b), rp = n(p.principal_repaid_usd_b); return g == null || rp == null ? "—" : B(Math.min(g, rp)); }], ["Fresh debt for expansion (est.)", function (p) { var g = n(p.gross_raised_usd_b), rp = n(p.principal_repaid_usd_b); return g == null || rp == null ? "—" : B(Math.max(0, g - rp)); }]],
          "“Of which” lines are already inside gross raised — never add them to it. Refinancing (est.) = the part of new money matched by principal repaid in the same period; the rest is fresh borrowing for expansion. An estimate: filings rarely say which raise replaced which bond.")));

      /* 3 Funding sources — 100% stacked from the raise register, by issue year */
      var yrs = {}; RW.forEach(function (r) { if (r.include_in_total === false) return; var y = String(r.issue_month || "").slice(0, 4), a = n(r.amount_usd_b); if (!y || a == null) return; var k = instClass(r.instrument_type); (yrs[y] = yrs[y] || {})[k] = (yrs[y][k] || 0) + a; });
      var r3 = Object.keys(yrs).sort().map(function (y) { return { lab: y, v: yrs[y] }; }), keys3 = ["bonds", "bank", "pc", "abs", "cp", "other"].filter(function (k) { return r3.some(function (r) { return r.v[k]; }); });
      var reg = RW.slice().sort(function (a, b) { return a.issue_month < b.issue_month ? 1 : -1; });
      var aiAmt = reg.filter(function (r) { return r.include_in_total !== false && AI_RX.test((r.instrument_type || "") + " " + (r.notes || "")); }).reduce(function (s, r) { return s + (n(r.amount_usd_b) || 0); }, 0);
      out += sec("03", "Funding sources", "Where the money came from — share of each year's raises by instrument." + (aiAmt ? " AI-infrastructure-tagged financing (GPU, data centre, power, project, equipment leases): <b>" + B(aiAmt) + "</b> since 2021." : ""),
        (r3.length ? stacked(r3, keys3.map(function (k) { return { k: k, label: ICN[k], color: C[k] }; }), { pct: 1, label: "Funding mix" }) + legend(keys3.map(function (k) { return [ICN[k], C[k]]; })) : '<div class="a2-ph">No raises recorded for this company in the window.</div>'),
        det("Breakdown — every raise: instrument, issuer, amount, rate, maturity (" + reg.length + ")", '<div class="a2-tw"><table class="a2-t a2-reg no-tx"><thead><tr><th>Issued</th><th>Instrument</th><th>Type</th><th>Issuer</th><th>Amount</th><th>Rate</th><th>Matures</th><th>AI infra</th></tr></thead><tbody>' +
          reg.map(function (r) { var ai = AI_RX.test((r.instrument_type || "") + " " + (r.notes || "")); return "<tr" + (r.include_in_total === false ? ' class="ex" title="Not counted in totals (e.g. exchange offer, non-cash)"' : "") + "><td>" + esc(r.issue_month) + "</td><td>" + esc(r.instrument_type) + "</td><td>" + esc(ICN[instClass(r.instrument_type)]) + "</td><td>" + esc(r.issuer_legal_entity || "") + "</td><td>" + B(r.amount_usd_b) + (r.currency && r.currency !== "USD" ? " <small>" + esc(r.currency) + "</small>" : "") + "</td><td>" + (n(r.yield_or_coupon_pct) != null ? rate(r.yield_or_coupon_pct) + " <small>" + esc(r.yield_type || "") + "</small>" : "—") + "</td><td>" + esc(dueYear(r.instrument_type)) + "</td><td>" + (ai ? '<span class="a2-tag">AI infra</span>' : "") + "</td></tr>"; }).join("") +
          "</tbody></table></div><p class=\"a2-note\">Lender names are not disclosed in the register; the issuing entity is shown. Rows struck through are not counted in totals. AI-infra tag = instrument or note mentions GPUs, data centres, power, project, equipment or lease financing.</p>"));

      /* 4 Maturity & cost */
      var ML = c.maturity_ladder || {}, PM = ML.principal_maturing_usd_b || null;
      var m4 = []; if (PM) { if (n(PM.maturing_12m) != null) m4.push({ lab: "Next 12m", v: { mat: PM.maturing_12m } }); ["2027", "2028", "2029", "2030", "2031"].forEach(function (y) { if (n(PM[y]) != null) m4.push({ lab: y, v: { mat: PM[y] } }); });
        var th = n(ML.thereafter_total_usd_b) != null ? ML.thereafter_total_usd_b : n(PM.thereafter_total); if (th != null) m4.push({ lab: "Later", v: { mat: th } }); }
      var liq = n(ML.cash_plus_facilities_at_schedule_date_usd_b);
      var cov = pr.filter(function (p) { return n(p.interest_expense_usd_b) != null; }).map(function (p) { return { lab: yl(p.year), bar: p.interest_expense_usd_b, line: p.interest_coverage_ebit }; });
      out += sec("04", "Maturity &amp; cost", "When the debt falls due" + (ML.schedule_date ? " (schedule at " + esc(ML.schedule_date) + ")" : "") + ", and what it costs: interest expense with EBIT interest coverage (3x = comfort line).",
        (m4.length ? stacked(m4, [{ k: "mat", label: "Principal maturing", color: C.mat }], { label: "Maturity wall", ref: liq, refLab: liq != null ? "cash + committed facilities " + B(liq) : "" }) + legend([["Principal maturing", C.mat]].concat(liq != null ? [["Cash + committed facilities", C.liq, 1]] : [])) : '<div class="a2-ph">No maturity schedule published.</div>'),
        det("Breakdown — year-wise repayment, rates", (m4.length ? '<div class="a2-tw"><table class="a2-t no-tx"><thead><tr><th></th>' + m4.map(function (m) { return "<th>" + m.lab + "</th>"; }).join("") + '</tr></thead><tbody><tr><th scope="row">Principal maturing</th>' + m4.map(function (m) { return "<td>" + B(m.v.mat) + "</td>"; }).join("") + "</tr>" +
          (n(ML.total_debt_at_schedule_date_usd_b) ? '<tr><th scope="row">% of total debt</th>' + m4.map(function (m) { return "<td>" + (m.v.mat / ML.total_debt_at_schedule_date_usd_b * 100).toFixed(1) + "%</td>"; }).join("") + "</tr>" : "") + "</tbody></table></div>" : "") +
          table(pr.filter(function (p) { return n(p.interest_expense_usd_b) != null || n(p.wa_interest_rate_existing_debt_pct) != null; }), [["Interest expense", function (p) { return B(p.interest_expense_usd_b); }], ["Rate on existing debt", function (p) { return rate(p.wa_interest_rate_existing_debt_pct); }], ["Yield on new issues", function (p) { return rate(p.wa_yield_new_issues_pct); }],
            ["Fixed / floating", function (p) { return n(p.fixed_rate_pct) != null ? p.fixed_rate_pct.toFixed(0) + " / " + (n(p.floating_rate_pct) || 0).toFixed(0) + "%" : "—"; }], ["EBIT interest coverage", function (p) { return x(p.interest_coverage_ebit); }]], esc(ML.notes || "")) +
          (c.refinancing_scenarios && c.refinancing_scenarios.maturing_12m ? (function (s4) { var S = s4.scenarios || {}; return '<p class="a2-note"><b>If the next 12 months’ ' + B(s4.maturing_principal_usd_b) + " is refinanced higher:</b> " + Object.keys(S).map(function (k) { return k + " → " + B(S[k].incremental_annual_interest_usd_b, 3) + " a year (" + (n(S[k].incremental_interest_pct_of_fcf) != null ? S[k].incremental_interest_pct_of_fcf.toFixed(2) + "% of FCF" : "—") + ")"; }).join(" · ") + "</p>"; })(c.refinancing_scenarios.maturing_12m) : "")),
        cov.length ? '<div class="a2-ct">Interest expense &amp; coverage</div>' + combo(cov, { ref: 3, refLab: "3x comfort line" }) + legend([["Interest expense", C.ie], ["EBIT interest coverage", C.cov], ["3x comfort line", C.bad, 1]]) : "");

      /* 5 Reconciliation */
      var rec = []; for (var i = 1; i < P2.length; i++) { var a = P2[i - 1], b = P2[i]; if (b.year === "TTM" || a.year === "TTM") continue;   /* year-end to year-end only */ var g = n(b.gross_raised_usd_b), rp = n(b.principal_repaid_usd_b); if (g == null && rp == null) continue;
        var adj = b.total_debt_usd_b - a.total_debt_usd_b - (g || 0) + (rp || 0); rec.push({ a: a, b: b, g: g || 0, rp: rp || 0, adj: adj, tol: Math.max(0.5, 0.05 * b.total_debt_usd_b) }); }
      var RS = rec.filter(function (r) { return r.b.year !== "TTM"; }).slice(-1)[0] || rec.slice(-1)[0];
      var flagged = rec.filter(function (r) { return Math.abs(r.adj) > r.tol; });
      out += sec("05", "Debt reconciliation", RS ? "How " + yl(RS.a.year) + " year-end debt became " + yl(RS.b.year) + ": opening → raised → repaid → non-cash adjustments → closing. A red adjustment bar is larger than 5% of closing debt — check FX, leases, acquisitions or the data." : "Not enough consecutive year-ends to reconcile.",
        RS ? waterfall([{ lab: "Opening " + yl(RS.a.year), v: RS.a.total_debt_usd_b, kind: "total" }, { lab: "Raised", v: RS.g, kind: "up" }, { lab: "Repaid", v: -RS.rp, kind: "down" }, { lab: "Adjustments", v: RS.adj, kind: "adj", tol: RS.tol }, { lab: "Closing " + yl(RS.b.year), v: RS.b.total_debt_usd_b, kind: "total" }]) +
          (flagged.length ? '<p class="a2-warn">⚠ Unexplained difference: ' + flagged.map(function (r) { return yl(r.b.year) + " " + B(r.adj) + " (" + (r.adj / r.b.total_debt_usd_b * 100).toFixed(0) + "% of closing debt)"; }).join(" · ") + " — raised and repaid do not explain the change in debt.</p>" : '<p class="a2-okk">✓ Raised and repaid explain the change in debt within 5% every year.</p>') : "",
        rec.length ? det("Breakdown — cash borrowing vs non-cash adjustments", '<div class="a2-tw"><table class="a2-t no-tx"><thead><tr><th></th>' + rec.map(function (r) { return "<th>" + yl(r.b.year) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          [["Opening debt", function (r) { return B(r.a.total_debt_usd_b); }], ["+ Raised (cash)", function (r) { return B(r.g); }], ["− Repaid (cash)", function (r) { return B(-r.rp); }], ["± Non-cash adjustments", function (r) { return '<span class="' + (Math.abs(r.adj) > r.tol ? "a2-dn" : "") + '">' + B(r.adj) + "</span>"; }], ["Closing debt", function (r) { return "<b>" + B(r.b.total_debt_usd_b) + "</b>"; }]]
            .map(function (q) { return '<tr><th scope="row">' + q[0] + "</th>" + rec.map(function (r) { return "<td>" + q[1](r) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div><p class=\"a2-note\">Adjustments = closing − opening − raised + repaid: debt assumed in acquisitions, finance leases, FX on foreign-currency notes, discount amortisation, conversions and exchanges.</p>") : "");
    }
    var gaps = (c.gaps_v2 || []).concat((E.gaps || []).filter(function (g) { return g.company === c.company; }));
    out += '<div class="a2-foot">' + det("Data gaps &amp; sources (" + gaps.length + ")", "<ul>" + gaps.slice(0, 30).map(function (g) { return typeof g === "string" ? "<li>" + esc(g) + "</li>" : "<li><b>" + esc(g.field || "") + "</b> " + esc(g.years || "") + (g.reason ? " — " + esc(g.reason) : "") + "</li>"; }).join("") + "</ul><p class=\"a2-note\">" + esc(E.meta && E.meta.sources || "") + "</p>") + "</div>";
    P.innerHTML = '<div class="a2">' + out + "</div>";
  }

  function css() {
    if (doc.getElementById("a2-css")) return;
    var s = doc.createElement("style"); s.id = "a2-css";
    s.textContent = ".a2{display:flex;flex-direction:column;gap:14px}.a2 h2{margin:0;font-size:20px}.a2-ss{margin:3px 0 0;color:var(--muted,#9aa7b8);font-size:13px;line-height:1.45}" +
      ".a2-cos{display:flex;flex-wrap:wrap;gap:6px}.a2-cos button{all:unset;cursor:pointer;padding:6px 12px;border:1px solid var(--line2,#2a3442);border-radius:999px;font-size:12.5px;font-weight:600;color:var(--muted,#9aa7b8)}.a2-cos button small{opacity:.7;font-weight:500}.a2-cos button[aria-pressed=true]{background:#ffb84d;color:#101825;border-color:#ffb84d}" +
      ".a2-co h3{margin:4px 0 10px;font-size:18px}.a2-co h3 small{font-size:12px;color:var(--faint,#7d8a9c);font-weight:500}" +
      ".a2-ks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.a2-k{background:var(--panel,#0e141c);border:1px solid var(--line,#1f2833);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}" +
      ".a2-k .kk{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint,#7d8a9c);font-weight:700}.a2-k b{font:700 24px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.a2-k .ks{font-size:12px;color:var(--muted,#9aa7b8)}" +
      ".a2-fl{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.a2-f{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid}.a2-f.on{color:#ff6b6b;border-color:rgba(255,107,107,.5);background:rgba(255,107,107,.08)}.a2-f.off{color:#3fb97f;border-color:rgba(63,185,127,.4)}" +
      ".a2-sec{background:var(--panel,#0e141c);border:1px solid var(--line,#1f2833);border-radius:14px;padding:16px 18px}.a2-sh{display:flex;gap:12px;align-items:flex-start;margin-bottom:8px}.a2-no{font:800 13px 'IBM Plex Mono',monospace;color:#ffb84d;border:1px solid rgba(255,184,77,.45);border-radius:8px;padding:4px 8px}.a2-sh h3{margin:0;font-size:16px;letter-spacing:.02em}" +
      ".a2-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.a2-ct{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#9aa7b8);margin-bottom:4px}" +
      ".a2-svg{width:100%;max-width:980px;max-height:380px;height:auto;display:block;margin:0 auto}.a2-two .a2-svg{max-height:300px}.a2-g{stroke:var(--line,#1f2833)}.a2-z{stroke:var(--muted,#9aa7b8)}.a2-ax{fill:var(--faint,#7d8a9c);font:11px 'IBM Plex Mono',monospace}.a2-xl{fill:var(--muted,#9aa7b8);font:600 12px 'IBM Plex Sans',sans-serif}" +
      ".a2-top{fill:var(--ink,#e8eef7);font:700 12px 'IBM Plex Mono',monospace}.a2-in{fill:#fff;font:600 10.5px 'IBM Plex Mono',monospace;paint-order:stroke;stroke:rgba(0,0,0,.45);stroke-width:2px}.a2-dl{fill:#ffb84d;font:700 11.5px 'IBM Plex Mono',monospace;paint-order:stroke;stroke:#000;stroke-width:3px}" +
      ".a2-ref{stroke:#ff6b6b;stroke-width:2;stroke-dasharray:7 5}.a2-refl{fill:#ff8a8a;font:600 11px 'IBM Plex Sans',sans-serif;paint-order:stroke;stroke:#000;stroke-width:3px}.a2-con{stroke:var(--faint,#7d8a9c);stroke-dasharray:3 3}" +
      ".a2-lg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--muted,#9aa7b8);margin:6px 0 2px}.a2-lg i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}" +
      ".a2-x{margin-top:10px;border-top:1px solid var(--line,#1f2833);padding-top:8px}.a2-x summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--ink,#e8eef7)}.a2-x summary::marker{color:#ffb84d}" +
      ".a2-tw{overflow-x:auto;margin-top:8px}.a2-t{border-collapse:collapse;width:100%;font:12.5px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.a2-t th,.a2-t td{padding:7px 10px;border-bottom:1px solid var(--line,#1f2833);white-space:nowrap;text-align:right}" +
      ".a2-t thead th{font-size:11px;color:var(--faint,#7d8a9c);letter-spacing:.06em}.a2-t tbody th{text-align:left;font-family:'IBM Plex Sans',sans-serif;font-weight:600;color:var(--muted,#9aa7b8);position:sticky;left:0;background:var(--panel,#0e141c)}.a2-t tr.b td{font-weight:700}.a2-t tr.sub th,.a2-t tr.sub td{color:var(--faint,#7d8a9c);font-size:11.5px}" +
      ".a2-reg td,.a2-reg th{text-align:left!important}.a2-reg td:nth-child(5),.a2-reg td:nth-child(6){text-align:right!important}.a2-reg tr.ex td{text-decoration:line-through;opacity:.55}.a2-tag{font-size:10px;font-weight:800;color:#e879f9;border:1px solid rgba(232,121,249,.5);border-radius:4px;padding:1px 5px}" +
      ".a2-t thead{display:table-header-group!important}.a2-t tbody{display:table-row-group!important}.a2-t tr{display:table-row!important}.a2-t td,.a2-t th{display:table-cell!important}.a2-t td:before{content:none!important}" +
      ".a2-note{font-size:12px;color:var(--faint,#7d8a9c);margin:8px 0 0;line-height:1.5}.a2-warn{color:#ff8a8a;font-size:13px;font-weight:600;margin:8px 0 0}.a2-okk{color:#3fb97f;font-size:13px;font-weight:600;margin:8px 0 0}" +
      ".a2-up{color:#3fb97f}.a2-dn{color:#ff6b6b}.a2-ph{padding:30px;text-align:center;color:var(--faint,#7d8a9c);border:1px dashed var(--line,#1f2833);border-radius:10px}.a2-ph.big{font-size:14px}.a2-foot ul{font-size:12px;color:var(--muted,#9aa7b8);line-height:1.5}" +
      "@media (max-width:1000px){.a2-ks{grid-template-columns:repeat(2,minmax(0,1fr))}.a2-two{grid-template-columns:1fr}}@media (max-width:480px){.a2-k b{font-size:19px}}";
    doc.head.appendChild(s);
  }
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-a2co]"); if (!b) return; SEL = b.getAttribute("data-a2co"); try { localStorage.setItem("desk.ad2.co", SEL); } catch (e) {} render(); });
  Promise.all([fetch("ai-debt-enhancement.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }),
    fetch("ai-debt.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })])
    .then(function (x2) { E = x2[0]; R = x2[1]; render(); }).catch(function (e) { ERR = String(e.message || e); render(); });
  render();
  root.AIDEBT2 = { render: render };
})(window);
