/* fed-ui.js — Fed policy intelligence (owner story: macro dashboard redesign §4 and §7).
   Rule-based and educational: every number is computed from the desk's own macro series and the futures-implied odds
   already on the desk. Market-implied probabilities are always shown apart from the desk model. No new feed. */
(function (root) {
  "use strict";
  var STR = [["us_gdp", 2], ["us_nfp", 2], ["us_ur", 2], ["us_claims", 1], ["us_retail", 1], ["us_pspend", 1], ["us_ism", 1], ["us_ism_svc", 1], ["us_indpro", 1], ["us_jolts", 1], ["us_umich", 1], ["us_starts", 1]];
  var INF = [["us_core_pce", 2], ["us_core_cpi", 2], ["us_cpi", 1], ["us_pce", 1], ["us_ahe", 1]];
  var PIPE = ["us_ppi", "us_import"];
  function hv(m) { var H = (m && (m.hist24 && m.hist24.length > 2 ? m.hist24 : m.history)) || []; return H.map(function (h) { return h[1]; }); }
  function sg(x, eps) { return Math.abs(x) < (eps || 1e-9) ? 0 : x > 0 ? 1 : -1; }
  /* strength: did the latest print improve on the one before (polarity-aware); off = 1 looks one print earlier */
  function sStr(m, off) { var v = hv(m), n = v.length - (off || 0); if (n < 2) return null; return (m.good === "down" ? -1 : 1) * sg(v[n - 1] - v[n - 2], Math.pow(10, -m.dec) / 2); }
  /* inflation momentum: latest vs three prints earlier */
  function sInf(m, off) { var v = hv(m), n = v.length - (off || 0); if (n < 4) return null; return sg(v[n - 1] - v[n - 4], Math.pow(10, -m.dec) / 2); }
  function wavg(list, by, f, off) { var t = 0, w = 0, parts = []; list.forEach(function (x) { var m = by[x[0]], s = m ? f(m, off) : null; if (s == null) return; t += s * x[1]; w += x[1]; parts.push({ m: m, s: s, w: x[1] }); }); return { v: w ? t / w : null, parts: parts, w: w }; }

  function model(D, off) {
    var by = {}; ((D && D.macro) || []).forEach(function (m) { by[m.key] = m; });
    var S = wavg(STR, by, sStr, off), I = wavg(INF, by, sInf, off), core = by.us_core_pce, cv = core ? hv(core) : [], lvl = cv.length - (off || 0) > 0 ? cv[cv.length - 1 - (off || 0)] : null;
    if (S.v == null || I.v == null) return null;
    var gap = lvl == null ? 0 : lvl - 2, L = gap > 0.5 ? 1 : gap < -0.25 ? -1 : 0;
    var p = 0.45 * I.v + 0.35 * L + 0.2 * S.v, call = p > 0.25 ? "Hike" : p < -0.25 ? "Cut" : "Hold";
    return { S: S, I: I, lvl: lvl, L: L, p: p, call: call, by: by };
  }
  /* what changed: each indicator's contribution now vs one print earlier */
  function changes(D) {
    var a = model(D, 0), b = model(D, 1), out = []; if (!a || !b) return { a: a, list: out };
    function walk(list, f, wt, tot) { list.forEach(function (x) { var m = a.by[x[0]]; if (!m) return; var s0 = f(m, 0), s1 = f(m, 1); if (s0 == null || s1 == null || s0 === s1) return; out.push({ m: m, d: wt * x[1] * (s0 - s1) / tot, s0: s0, s1: s1 }); }); }
    walk(STR, sStr, 0.2, a.S.w); walk(INF, sInf, 0.45, a.I.w);
    out.sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); });
    return { a: a, b: b, list: out };
  }
  function surprises(D) {
    return ((D && D.macro) || []).filter(function (m) { return m.group === "us" && m.cons && m.cons.forecast != null && m.seen_at && Date.parse(m.seen_at) >= Date.parse(m.cons.at + ":00-05:00") - 36e5; })
      .map(function (m) { var d = m.value - m.cons.forecast, eps = Math.pow(10, -m.dec) / 2; return { m: m, d: d, k: Math.abs(d) < eps ? 0 : (m.good === "down" ? -1 : 1) * sg(d) }; });
  }
  /* Fed expectations revision: next-meeting hike odds just before and just after each US release */
  function revisions(D) {
    var H = (D && D.fed_odds_hist) || [], out = []; if (H.length < 2) return out;
    ["us_cpi", "us_core_pce", "us_nfp", "us_gdp", "us_retail", "us_ppi"].forEach(function (k) { var m = ((D.macro || []).filter(function (x) { return x.key === k; }))[0]; if (!m || !m.seen_at) return;
      var t = Date.parse(m.seen_at), pre = null, post = null; H.forEach(function (h) { var ht = Date.parse(h.t); if (ht <= t) pre = h; else if (!post && ht - t < 2 * 864e5) post = h; });
      if (pre && post && pre.meeting === post.meeting) out.push({ m: m, pre: pre, post: post, d: post.hike - pre.hike, de: post.ease - pre.ease }); });
    return out;
  }
  /* historical comparison: months the Fed hiked, cut or held (month-end rate vs prior month) since the desk's series start */
  function history(D) {
    var by = {}; ((D && D.macro) || []).forEach(function (m) { by[m.key] = m; });
    var P = by.us_policy && by.us_policy.long, C = by.us_cpi && by.us_cpi.long, U = by.us_ur && by.us_ur.long; if (!P || !C || !U || P.length < 13) return null;
    var cm = {}, um = {}; C.forEach(function (r) { cm[r[0].slice(0, 7)] = r[1]; }); U.forEach(function (r) { um[r[0].slice(0, 7)] = r[1]; });
    var G = { Hike: [], Cut: [], Hold: [] }, mo = {}; P.forEach(function (r) { mo[r[0].slice(0, 7)] = r[1]; });
    var ks = Object.keys(mo).sort(); for (var i = 1; i < ks.length; i++) { var d = mo[ks[i]] - mo[ks[i - 1]], c = d > 0.001 ? "Hike" : d < -0.001 ? "Cut" : "Hold", pm = ks[i - 1];   /* conditions known going into the month */
      if (cm[pm] != null && um[pm] != null) G[c].push({ cpi: cm[pm], ur: um[pm] }); }
    var cur = { cpi: by.us_cpi.value, ur: by.us_ur.value }, rows = [];
    Object.keys(G).forEach(function (k) { var L = G[k]; if (!L.length) return; var a = function (f) { return L.reduce(function (s, x) { return s + x[f]; }, 0) / L.length; };
      var r = { k: k, n: L.length, cpi: a("cpi"), ur: a("ur") }; r.dist = Math.sqrt(Math.pow((cur.cpi - r.cpi) / 1.5, 2) + Math.pow((cur.ur - r.ur) / 0.7, 2)); rows.push(r); });
    rows.sort(function (a, b) { return a.dist - b.dist; });
    return { rows: rows, cur: cur, from: ks[0] };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { model: model, changes: changes, surprises: surprises, revisions: revisions, history: history }; return; }

  /* ---------------- UI ---------------- */
  var doc = root.document;
  function f1(v, d) { return (+v).toFixed(d == null ? 1 : d); }
  function sc(v) { var x = Math.round(v * 100); return (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x); }
  function pill(call) { return '<span class="fd-call ' + call.toLowerCase() + '">' + call + "</span>"; }
  function day(t) { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Toronto" }); }
  root.fedIntelHTML = function () {
    var D = root.DATA; if (!D || !D.macro) return "";
    var C = changes(D), M = C.a; if (!M) return "";
    var F = (D.fx && D.fx.policy && D.fx.policy.fed) || [], nx = F[0], obs = [];
    var mk = nx ? '<div class="fd-card"><div class="fd-k">Market-implied · next Fed ' + esc(day(nx.meeting + "T12:00:00-05:00")) + '</div><div class="fd-odds"><span class="hike">Hike ' + f1(nx.hike_pct) + '%</span><span class="hold">Hold ' + f1(nx.no_change_pct) + '%</span><span class="cut">Cut ' + f1(nx.ease_pct) + '%</span></div><div class="fd-n">fed funds futures · not the desk model</div></div>' : "";
    var h = '<div class="tile wide fd-tile" data-src="macro"><h2>Fed policy intelligence <span class="h2note">— desk model (rule-based, educational) shown apart from market-implied odds</span></h2>' +
      '<div class="fd-top"><div class="fd-card"><div class="fd-k">Economic strength</div><div class="fd-v ' + (M.S.v > 0.15 ? "up" : M.S.v < -0.15 ? "dn" : "") + '">' + sc(M.S.v) + '</div><div class="fd-n">' + M.S.parts.filter(function (p) { return p.s > 0; }).length + " of " + M.S.parts.length + " US activity prints improved</div></div>" +
      '<div class="fd-card"><div class="fd-k">Inflation momentum</div><div class="fd-v ' + (M.I.v > 0.15 ? "heat" : M.I.v < -0.15 ? "cool" : "") + '">' + sc(M.I.v) + '</div><div class="fd-n">' + M.I.parts.filter(function (p) { return p.s > 0; }).length + " of " + M.I.parts.length + " price gauges up vs 3 prints ago" + (M.lvl != null ? " · core PCE " + f1(M.lvl) + "% vs 2% target" : "") + "</div></div>" +
      '<div class="fd-card"><div class="fd-k">Desk model · policy implication</div><div class="fd-v">' + pill(M.call) + '</div><div class="fd-n">pressure ' + sc(M.p) + " (−100 cut … +100 hike) · 45% momentum, 35% level vs target, 20% strength</div></div>" + mk + "</div>";
    obs.push("Desk model reads " + M.call + " (pressure " + sc(M.p) + ")" + (nx ? "; futures price " + f1(nx.hike_pct) + "% hike / " + f1(nx.no_change_pct) + "% hold / " + f1(nx.ease_pct) + "% cut for " + day(nx.meeting + "T12:00:00-05:00") + "." : "."));
    if (nx) { var mc = nx.hike_pct >= 50 ? "Hike" : nx.ease_pct >= 50 ? "Cut" : "Hold"; obs.push(mc === M.call ? "Model and market agree on " + M.call + "." : "Model (" + M.call + ") and market (" + mc + ") disagree — the gap is the trade idea to test, not a signal."); }
    /* what changed my view */
    var W = C.list.slice(0, 6);
    h += '<div class="fd-sec"><h3>What changed the view <small>latest print vs the one before · pressure ' + sc(C.b.p) + " → " + sc(M.p) + "</small></h3>" + (W.length ? '<table class="fd-tbl"><thead><tr><th>Data point</th><th>Latest</th><th>Read now</th><th>Read before</th><th>Pushes toward</th><th>Contribution</th></tr></thead><tbody>' + W.map(function (x) {
      var isInf = INF.some(function (i) { return i[0] === x.m.key; }), r = function (s) { return isInf ? (s > 0 ? "heating" : s < 0 ? "cooling" : "flat") : (s > 0 ? "improving" : s < 0 ? "weakening" : "flat"); };
      return "<tr><td>" + esc(x.m.name) + (x.m.measure ? " <i>" + esc(x.m.measure) + "</i>" : "") + "</td><td>" + mval(x.m, x.m.value) + " <small>" + esc(x.m.period) + "</small></td><td>" + r(x.s0) + "</td><td>" + r(x.s1) + '</td><td class="' + (x.d > 0 ? "hk" : "ct") + '">' + (x.d > 0 ? "Hike" : "Cut") + "</td><td>" + sc(x.d) + "</td></tr>"; }).join("") + "</tbody></table>" : '<p class="note">No input changed direction on its latest print.</p>') + "</div>";
    if (W.length) obs.push("Biggest mover: " + W[0].m.name + " pushed the view toward " + (W[0].d > 0 ? "Hike" : "Cut") + " (" + sc(W[0].d) + ").");
    /* inflation risk monitor: pipeline prices and energy before they reach CPI */
    var by = M.by, pr = PIPE.map(function (k) { var m = by[k]; if (!m) return ""; var v = hv(m), n = v.length; if (n < 4) return ""; var d3 = v[n - 1] - v[n - 4];
      return "<tr><td>" + esc(m.name) + " <i>" + esc(m.measure || "") + "</i></td><td>" + mval(m, m.value) + '</td><td class="' + (d3 > 0 ? "heat" : d3 < 0 ? "cool" : "") + '">' + (d3 > 0 ? "+" : d3 < 0 ? "−" : "") + f1(Math.abs(d3)) + " pp</td><td>" + (d3 > 0 ? "building" : d3 < 0 ? "easing" : "flat") + "</td></tr>"; }).join("");
    var E = ((D.fx && D.fx.energy) || []).filter(function (e) { return /^WTI/.test(e.name); })[0], cpi = by.us_cpi;
    if (E && E.last != null) pr += "<tr><td>WTI crude <i>day</i></td><td>$" + f1(E.last, 2) + '</td><td class="' + (E.pct > 0 ? "heat" : E.pct < 0 ? "cool" : "") + '">' + (E.pct > 0 ? "+" : E.pct < 0 ? "−" : "") + f1(Math.abs(E.pct), 2) + "%</td><td>energy input</td></tr>";
    if (pr) h += '<div class="fd-sec"><h3>Inflation risk monitor <small>pipeline prices usually reach CPI with a lag · change vs 3 prints ago</small></h3><table class="fd-tbl"><thead><tr><th>Gauge</th><th>Latest</th><th>3-print change</th><th>Read</th></tr></thead><tbody>' + pr + (cpi ? "<tr class=\"fd-ref\"><td>CPI <i>y/y</i> (for reference)</td><td>" + mval(cpi, cpi.value) + "</td><td></td><td>official</td></tr>" : "") + "</tbody></table></div>";
    /* economic surprise tracker */
    var SP = surprises(D);
    if (SP.length) { var beat = SP.filter(function (x) { return x.k > 0; }).length, miss = SP.filter(function (x) { return x.k < 0; }).length;
      h += '<div class="fd-sec"><h3>Economic surprise tracker <small>' + beat + " stronger than forecast · " + miss + " weaker · US prints with a stored forecast</small></h3><table class=\"fd-tbl\"><thead><tr><th>Release</th><th>Actual</th><th>Forecast</th><th>Surprise</th></tr></thead><tbody>" +
        SP.map(function (x) { return "<tr><td>" + esc(x.m.name) + " <small>" + esc(x.m.period) + "</small></td><td>" + mval(x.m, x.m.value) + "</td><td>" + mval(x.m, x.m.cons.forecast) + '</td><td class="' + (x.k > 0 ? "up" : x.k < 0 ? "dn" : "") + '">' + (x.k === 0 ? "in line" : (x.k > 0 ? "stronger " : "weaker ") + (x.d > 0 ? "+" : "−") + f1(Math.abs(x.d), x.m.dec)) + "</td></tr>"; }).join("") + "</tbody></table></div>";
      obs.push(beat + " of " + SP.length + " forecast-tracked US prints came in stronger than expected."); }
    /* Fed expectations revision (fills as the desk records the odds around each release) */
    var RV = revisions(D);
    if (RV.length) h += '<div class="fd-sec"><h3>Fed expectations revision <small>next-meeting hike odds just before vs just after each release</small></h3><table class="fd-tbl"><thead><tr><th>Release</th><th>Hike odds before</th><th>After</th><th>Change</th></tr></thead><tbody>' +
      RV.map(function (x) { return "<tr><td>" + esc(x.m.name) + " <small>" + esc(x.m.period) + "</small></td><td>" + f1(x.pre.hike) + "%</td><td>" + f1(x.post.hike) + '%</td><td class="' + (x.d > 0 ? "hk" : x.d < 0 ? "ct" : "") + '">' + (x.d > 0 ? "+" : x.d < 0 ? "−" : "") + f1(Math.abs(x.d)) + " pp</td></tr>"; }).join("") + "</tbody></table></div>";
    /* historical FOMC comparison */
    var HC = history(D);
    if (HC && HC.rows.length) { h += '<div class="fd-sec"><h3>Historical FOMC comparison <small>average conditions going into months the Fed hiked, cut or held · since ' + esc(HC.from.slice(0, 4)) + "</small></h3><table class=\"fd-tbl\"><thead><tr><th>Decision</th><th>Months</th><th>CPI y/y</th><th>Unemployment</th></tr></thead><tbody>" +
        HC.rows.map(function (r, i) { return "<tr" + (i === 0 ? ' class="fd-near"' : "") + "><td>" + pill(r.k) + (i === 0 ? " <small>closest to today</small>" : "") + "</td><td>" + r.n + "</td><td>" + f1(r.cpi) + "%</td><td>" + f1(r.ur) + "%</td></tr>"; }).join("") +
        '<tr class="fd-ref"><td>Today</td><td></td><td>' + f1(HC.cur.cpi) + "%</td><td>" + f1(HC.cur.ur) + "%</td></tr></tbody></table></div>";
      obs.push("Today's CPI " + f1(HC.cur.cpi) + "% and unemployment " + f1(HC.cur.ur) + "% sit closest to past " + HC.rows[0].k + " months (" + f1(HC.rows[0].cpi) + "% / " + f1(HC.rows[0].ur) + "%)."); }
    obs.push("Educational read only; not a forecast or a trade signal.");
    h += '<div class="obs-box"><b>OBSERVATIONS</b><ul>' + obs.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") + "</ul></div>" +
      '<div class="stamp">Verified ' + asOf("macro", true) + " · market odds " + asOf("policy", true) + "</div></div>";
    return h;
  };
  var css = doc.createElement("style");
  css.textContent = ".fd-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:6px 0 14px}.fd-card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}" +
    ".fd-k{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.fd-v{font:700 26px 'IBM Plex Mono',monospace;margin:4px 0}.fd-v.up{color:#3fb97f}.fd-v.dn{color:#e0655f}.fd-v.heat{color:#e8a33d}.fd-v.cool{color:#6ea8ff}.fd-n{font-size:11.5px;color:var(--faint)}" +
    ".fd-call{display:inline-block;font:700 18px 'IBM Plex Sans',sans-serif;padding:2px 12px;border-radius:6px;border:1px solid}.fd-call.hike{color:#e8a33d;border-color:#e8a33d}.fd-call.cut{color:#6ea8ff;border-color:#6ea8ff}.fd-call.hold{color:#b9c7da;border-color:#8494ab}.fd-tbl .fd-call{font-size:11px;padding:0 6px}" +
    ".fd-odds{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px;font:700 14px 'IBM Plex Mono',monospace}.fd-odds .hike{color:#e8a33d}.fd-odds .cut{color:#6ea8ff}.fd-odds .hold{color:#b9c7da}" +
    ".fd-sec{margin:12px 0}.fd-sec h3{font-size:13.5px;margin:0 0 6px}.fd-sec h3 small{font-weight:400;color:var(--faint);font-size:11.5px;margin-left:6px}" +
    ".fd-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.fd-tbl th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:5px 8px;border-bottom:1px solid var(--line)}.fd-tbl td{padding:6px 8px;border-bottom:1px solid var(--line)}.fd-tbl td i,.fd-tbl td small{color:var(--faint);font-style:normal}" +
    ".fd-tbl .up{color:#3fb97f}.fd-tbl .dn{color:#e0655f}.fd-tbl .heat,.fd-tbl .hk{color:#e8a33d}.fd-tbl .cool,.fd-tbl .ct{color:#6ea8ff}.fd-ref td{color:var(--muted);font-style:italic}.fd-near td{background:rgba(56,182,201,.06)}" +
    "@media (max-width:700px){.fd-tbl{display:block;overflow-x:auto;white-space:nowrap}}";
  doc.head.appendChild(css);
})(typeof window !== "undefined" ? window : globalThis);
