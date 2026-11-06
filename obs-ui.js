/* Observations boxes (Commodities BRD s.11). Rule-based, written from the loaded data at render time, no AI service.
   OB-1 guard: a bullet shows only if every number in it is printed in its own panel.
   OB-3: withheld when the panel's data is older than its cadence allows. */
(function (root) {
  function tokens(s) { return (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(function (x) { return x.replace(/,/g, ""); }); }
  function traceable(b, text) { var T = " " + String(text).replace(/,/g, "") + " "; return tokens(b).every(function (x) { return new RegExp("(^|[^\\d.])" + x.replace(".", "\\.") + "(?![\\d])").test(T); }); }
  function fresh(key, asof, now) { var MAX = { options: 96, optflow: 96, grains_settle: 96, cftc_grains: 240, model: 96, exports: 264, wasde: 1100 }, h = MAX[key]; if (!h) return true; var t = Date.parse(asof); return isFinite(t) && now - t <= h * 3600000; }
  function n(v) { return Math.round(Math.abs(v)).toLocaleString("en-US"); }
  function d2(v) { return (+v).toFixed(2); }
  function month(iso) { var p = String(iso || "").split("-"); return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""; }

  /* over-crowded scale, BRD CG-10: net % of open interest */
  function crowd(p) { if (p == null || isNaN(p)) return null; if (p >= 20) return { extreme: true, label: "Extreme Crowded Long (Exhausted buying capacity)" }; if (p <= -20) return { extreme: true, label: "Extreme Crowded Short (High short-squeeze risk)" }; if (p >= -10 && p <= 10) return { extreme: false, label: "Neutral" }; return { extreme: false, label: p > 0 ? "Leaning long" : "Leaning short" }; }
  function pct1(p) { return Math.abs(p).toFixed(1) + "%"; }
  /* compares each input with its reading about a year earlier, by date */
  function yearAgo(D, list) { var S = D && D.inputs && D.inputs.series, o = []; if (!S) return o; list.forEach(function (x) { var p = S[x[0]] && S[x[0]].pts; if (!p || p.length < 2) return; var L = p[p.length - 1], cut = Date.parse(L[0]) - 365 * 864e5, B = null; p.forEach(function (q) { if (Date.parse(q[0]) <= cut) B = q; }); if (!B) return; var up = L[1] > B[1]; o.push(x[1] + " " + (up ? "higher" : "lower") + " than a year ago, " + (up ? "raising" : "easing") + " grower costs."); }); return o; }
  /* each rule returns plain-English bullets for one panel */
  var RULES = {
    fan: function (g) { var F = g.fan, o = []; if (!F) return o;
      if (F.r10) o.push("The market's own volatility implies a 10-session range of about " + d2(F.r10[0]) + " to " + d2(F.r10[1]) + ".");
      if (F.z != null && F.ma20) { var z = +F.z; o.push("Price is " + (z < 0 ? "below" : "above") + " its 20-day average of " + F.ma20 + ", " + (Math.abs(z) >= 2 ? "an unusually stretched move" : "still within a normal range") + "."); }
      return o; },
    cockpit: function (g) { var o = [], C = g.cftc || [], L = C[C.length - 1], N = g.near; 
      if (L) o.push("Funds are net " + (L.net < 0 ? "short" : "long") + ", which is " + (L.net < 0 ? "pressure on price" : "support for price") + " until they reverse.");
      if (N && N.pcr != null) o.push(N.pcr < 1 ? "Fewer puts than calls: options lean toward upside bets." : "More puts than calls: options lean toward protection."); return o; },
    pos: function (g) { var K = g.cftc_stats && g.cftc_stats.kpi, o = []; if (!K) return o;
      o.push("Funds are net " + (K.net < 0 ? "short " : "long ") + n(K.net) + " contracts as of " + month(K.date) + ".");
      if (K.streak) o.push("They have been net " + (K.streak < 0 ? "sellers" : "buyers") + " for " + Math.abs(K.streak) + " straight weeks.");
      if (K.z52 != null) o.push(Math.abs(K.z52) >= 2 ? "That position is extreme against the past year, so a reversal risk is building." : "That position is not extreme against the past year, so there is room to extend."); return o; },
    cftc: function (g, of, D, k) { var C = g.cftc || [], L = C[C.length - 1], P = C[C.length - 2], o = []; if (!L) return o;
      var nm = { corn: "corn", soybeans: "soybean", wheat: "wheat" }[k] || "", pct = L.oi ? L.net / L.oi * 100 : null, c = crowd(pct), d = P ? L.net - P.net : 0, longSide = L.net >= 0;
      if (P && d) o.push("Funds " + (d < 0 ? (longSide ? "cut the " + nm + " long" : "extended the " + nm + " short") : (longSide ? "extended the " + nm + " long" : "cut the " + nm + " short")) + " in the week to " + month(L.date) + ".");
      if (c && c.extreme) o.push(c.label + ": net " + (longSide ? "long " : "short ") + pct1(pct) + " of open interest, " + (longSide ? "so buying power may be exhausted." : "so a bullish surprise could force covering."));
      else if (c) o.push("Net " + (longSide ? "long " : "short ") + pct1(pct) + " of open interest: " + c.label.toLowerCase() + ", not at the extreme band.");
      o.push("Weekly data, never read as today's position."); return o; },
    opt: function (g) { var N = g.near, o = []; if (!N) return o; var u = N.underlying;
      if (N.call_wall) o.push("Largest call open interest sits at " + d2(N.call_wall[0]) + (u && N.call_wall[0] - u > u * 0.1 ? ", well above the market, so it is not a near-term cap." : ", close enough to act as a cap."));
      if (N.put_wall) o.push("Largest put open interest sits at " + d2(N.put_wall[0]) + (u && Math.abs(u - N.put_wall[0]) / u < 0.02 ? ", right at the market, so it is the level to watch." : ", the nearest support from options."));
      return o; },
    vol: function (g) { var V = g.vol, o = []; if (!V || !V.near) return o;
      var iv = +V.near.iv, hv = +V.near.hv; o.push(iv > hv ? "Options are pricing more movement than the market has recently delivered, so protection costs more." : "Options are pricing less movement than the market has recently delivered, so protection is relatively cheap.");
      if (V.pct && V.pct["52w"] != null) o.push(V.pct["52w"] >= 70 ? "Implied volatility is high against the past year." : V.pct["52w"] <= 30 ? "Implied volatility is low against the past year." : "Implied volatility is mid-range against the past year."); return o; },
    optflow: function (g, of) { var o = [], P = of && of.positioning, D = of && of.next_day; if (!of) return o;
      if (D && D.lo != null) o.push("Options price the next session between " + d2(D.lo) + " and " + d2(D.hi) + ".");
      if (P && P.label) o.push("Options positioning reads " + String(P.label).toLowerCase() + ", with " + String(P.conf || "").toLowerCase() + " confidence."); return o; },
    carry: function (g) { var R = g.roll || [], o = []; if (!R[0] || !R[1]) return o; var s = (R[0].settle - R[1].settle) * 100;
      o.push(s < 0 ? "Deferred trades above front, which is carry: the market is paying to store grain, so nearby supply looks ample." : s > 0 ? "Front trades above deferred, an inverse: nearby supply looks tight." : "Front and deferred are flat."); return o; },
    cost: function (g, of, D) { return yearAgo(D, [["ulsd", "Diesel is"], ["natgas", "Natural gas is"], ["ppi_fert", "Fertilizer prices are"]]); },
    paths: function (g, of, D) { return yearAgo(D, [["wti", "Crude oil is"]]); },
    sd: function (g, of, D, k) { var W = D && D.wasde && D.wasde[k], o = []; if (!W || !W.new) return o; var row = function (l) { return W.new.rows.filter(function (r) { return r[0] === l; })[0]; }, E = row("Ending Stocks"), P = row("Production");
      if (E && E[1] != null && E[2] != null) o.push(W.new.my + " ending stocks are " + n(E[2]) + " mil bu in the " + W.report + " report versus " + n(E[1]) + " in " + W.prior_report + ": " + (E[2] > E[1] ? "a looser balance." : E[2] < E[1] ? "a tighter balance." : "unchanged."));
      if (P && P[1] != null && P[2] != null && P[1] !== P[2]) o.push("Production was revised " + (P[2] > P[1] ? "up" : "down") + " from the prior report."); return o; },
    exp: function (g, of, D, k) { var W = D && D.exports && D.exports[k] && D.exports[k].weeks, o = []; if (!W || W.length < 2) return o; var L = W[W.length - 1][2], P = W[W.length - 2][2]; if (L == null || P == null) return o; o.push("Latest weekly net sales came in " + (L > P ? "above" : L < P ? "below" : "level with") + " the prior week."); return o; },
    dest: function (g, of, D, k) { var T = D && D.exports && D.exports[k] && D.exports[k].dest, o = [], B = T && T.top_week && T.top_week[0]; if (!B) return o; o.push(String(B.country).split(",")[0] + " was the largest buyer this week."); return o; },
    cmp: function (g, of, D, k) { var Y = D && D.sd_hist && D.sd_hist[k] && D.sd_hist[k].years, o = []; if (!Y) return o; var a = Y["2026"], b = Y["2025"]; if (!a || !b || a.Production == null || b.Production == null) return o; o.push("US production is " + (a.Production > b.Production ? "larger" : "smaller") + " than the prior crop year."); return o; },
    oi: function (g) { var N = g.near, o = []; if (!N || !N.rows) return o; var P = N.rows_prev && N.rows_prev.rows, M = {}, best = null;
      (P || []).forEach(function (r) { M[r[0]] = r; });
      if (P) N.rows.forEach(function (r) { var q = M[r[0]]; if (!q) return; [[1, "call"], [2, "put"]].forEach(function (x) { var d = (r[x[0]] || 0) - (q[x[0]] || 0); if (!best || Math.abs(d) > Math.abs(best.d)) best = { d: d, k: r[0], s: x[1] }; }); });
      if (best && best.d) o.push("Biggest change since the last pull: " + best.s + "s at " + d2(best.k) + (best.d > 0 ? ", where positions were added." : ", where positions were closed."));
      if (N.pcr != null) o.push(N.pcr < 1 ? "Calls outnumber puts in this expiry." : "Puts outnumber calls in this expiry."); return o; }
  };
  /* one box per panel: the Volatility and Carry rows hold two panels, and the box goes under the first */
  if (typeof module !== "undefined" && module.exports) { module.exports = { RULES: RULES, traceable: traceable, fresh: fresh, crowd: crowd }; return; }

  var SECOND = {
    vol: function (g) { var S = g.skew || [], c = S.filter(function (x) { return x[2] === "C"; }), p = S.filter(function (x) { return x[2] === "P"; }); if (!c.length || !p.length) return []; var av = function (a) { return a.reduce(function (s, x) { return s + x[1]; }, 0) / a.length; }; return [av(c) > av(p) ? "Calls are priced richer than puts: the market is paying up for upside." : "Puts are priced richer than calls: the market is paying up for protection."]; },
    carry: function (g, t) { var m = /Roll progress[^\d]*(?:Nov|Oct|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)? ?\d* ?(?:\(prelim\))?\s*([\d.]+)%/.exec(t.textContent.replace(/\s+/g, " ")); return m ? ["Roll progress is " + m[1] + "% of open interest: " + (+m[1] < 50 ? "most positions are still in the front." : "most positions have moved to the deferred.")] : []; }
  };
  var doc = root.document, GR = ["corn", "soybeans", "wheat"], SKIP = /obs-box/, LOG = {};
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function demote(tile, nodes) { if (!nodes.length) return; var d = tile.querySelector(":scope > .prow-ev"); if (!d) { d = doc.createElement("details"); d.className = "prow-ev"; d.innerHTML = "<summary>Detail evidence</summary>"; tile.appendChild(d); } nodes.forEach(function (x) { d.appendChild(x); }); }
  function spaced(el) { var w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), o = [], x; while ((x = w.nextNode())) o.push(x.nodeValue); return o.join(" ").replace(/\s+/g, " "); }
  function box(tile, bullets, key) {
    var old = tile.querySelector(":scope > .obs-box"); if (old) old.remove();
    var A = root.DATA && DATA.meta && DATA.meta.asof || {}, sec = tile.getAttribute("data-sec");
    if (!fresh(key, A[key], Date.now())) { LOG[sec] = "withheld"; return; }
    var txt = spaced(tile), ok = bullets.filter(function (b) { return traceable(b, txt); }).slice(0, 3);
    LOG[sec] = ok.length + "/" + bullets.length;
    if (!ok.length) return;
    var el = doc.createElement("div"); el.className = "obs-box"; el.innerHTML = "<b>OBSERVATIONS</b><ul>" + ok.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>";
    var ev = tile.querySelector(":scope > .prow-ev"); if (ev) tile.insertBefore(el, ev); else tile.appendChild(el);
  }
  function domBullets(sec, tile) {
    var o = [], t = spaced(tile);
    if (sec === "flow") { var v = tile.querySelector(".fl-vv"), li = tile.querySelector("li"); if (v) o.push("The signal reads " + v.textContent.trim().toLowerCase() + "."); if (li) o.push(li.textContent.trim().split(/\.\s/)[0].replace(/\.+$/, "") + "."); }
    if (sec === "snap") { var m = /\d{4}\/\d{2}\s*([\d,.]+) mil bu ending stocks\s*([+−-][\d,.]+)/.exec(t); if (m) o.push("New-crop ending stocks are " + m[1] + " mil bu, " + (/^[−-]/.test(m[2]) ? "tighter" : "looser") + " than the last report."); var e = /Next market-moving event\s*(.+?) (HIGH|MEDIUM|LOW)/.exec(t.replace(/\s+/g, " ")); if (e) o.push("Next market-moving report: " + e[1] + "."); }
    return o;
  }
  function cftcView(k, t, G) {
    var old = t.querySelector(":scope > .cf-view"); if (old) old.remove();
    var C = G.cftc || [], L = C[C.length - 1], P = C[C.length - 2]; if (!L) return;
    var day = new Date(L.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }), stale = Date.now() - Date.parse(L.date + "T15:30:00-04:00") > 240 * 36e5;
    var p = L.oi ? L.net / L.oi * 100 : null, c = crowd(p), side = L.net < 0 ? "Net short" : "Net long", d = P ? L.net - P.net : null, sg = function (v) { return (v < 0 ? "−" : "+") + n(v); };
    var Tr = C.slice(-5), lo = Math.min.apply(null, Tr.map(function (x) { return x.net; })), hi = Math.max.apply(null, Tr.map(function (x) { return x.net; })), W = 520, H = 86, xy = Tr.map(function (x, i) { return [36 + i * (W - 72) / Math.max(1, Tr.length - 1), 20 + (hi === lo ? 20 : (hi - x.net) / (hi - lo) * 34)]; });
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="cf-svg" role="img" aria-label="Net position, last ' + Tr.length + ' weekly reports"><polyline fill="none" stroke="#e8c33a" stroke-width="2" points="' + xy.map(function (q) { return q.join(","); }).join(" ") + '"/>' + xy.map(function (q, i) { return '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3" fill="#e8c33a"/><text x="' + q[0] + '" y="' + (q[1] - 6) + '" text-anchor="middle" font-size="10" fill="currentColor">' + sg(Tr[i].net) + "</text>"+'<text x="' + q[0] + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="currentColor">' + month(Tr[i].date) + "</text>"; }).join("") + "</svg>";
    var ord = ["corn", "soybeans", "wheat"], nm = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
    var el = doc.createElement("div"); el.className = "cf-view";
    el.innerHTML = '<div class="cf-head"><b>CFTC - Managed money</b><span>Report ' + day + " · weekly" + (stale ? ' · <b class="cf-stale">STALE</b>' : "") + "</span></div>" +
      '<div class="gr-slicer" role="group" aria-label="CFTC commodity"><span>Commodity</span>' + ord.map(function (x) { return '<button type="button" data-cf-pick="' + x + '" aria-pressed="' + (x === k) + '">' + nm[x] + "</button>"; }).join("") + "</div>" +
      '<table class="cf-tbl"><thead><tr><th>Measure</th><th>' + nm[k] + "</th><th>Week on week</th><th>Read</th></tr></thead><tbody>" +
      "<tr><td>Managed-money net</td><td>" + sg(L.net) + " contracts</td><td>" + (d == null ? "UNAVAILABLE" : "Funds " + (d < 0 ? "sold " : "bought ") + n(d) + " net") + "</td><td>" + side + "</td></tr>" +
      "<tr><td>Net as % of open interest</td><td>" + (p == null ? "UNAVAILABLE" : (p < 0 ? "−" : "+") + pct1(p)) + "</td><td>-</td><td>" + (c ? c.label : "UNAVAILABLE") + "</td></tr>" +
      "<tr><td>Positioning trend (last " + Tr.length + ' reports)</td><td colspan="3">' + svg + "</td></tr></tbody></table>";
    var h = t.querySelector(":scope > h2, :scope > .tile-head"); if (h) h.after(el); else t.prepend(el);
  }
  function paint(k) {
    var P = doc.getElementById("panel-" + k), sub = P && P.querySelector("[data-subpanel].on"), G = root.DATA && DATA.grains && DATA.grains[k]; if (!sub || !G) return;
    var seen = {}, KEYS = { fan: "grains_settle", pos: "cftc_grains", cftc: "cftc_grains", cockpit: "options", opt: "options", vol: "options", optflow: "optflow", carry: "grains_settle", oi: "options", flow: "options", snap: "model", cost: "inputs", paths: "inputs", sd: "wasde", exp: "exports", dest: "exports", cmp: "sd_hist" };
    [].forEach.call(sub.children, function (t) {
      if (!t.classList.contains("tile")) return; var sec = t.getAttribute("data-sec");
      if (sub.getAttribute("data-subpanel") === "overview" && sec === "insight") { demote(t, [].slice.call(t.querySelectorAll(":scope > p.read"))); var rd = t.querySelector(".prow-ev p.read"), ss2 = rd ? rd.textContent.split(/(?<=[a-z%\d)])\.\s+(?=[A-Z])/).slice(0, 2).map(function (x) { return x.trim().replace(/\.+$/, "") + "."; }) : []; box(t, ss2, "model"); return; }
      if (sec === "flow") { var hs = [].filter.call(t.querySelectorAll("h3,h4,b,div"), function (x) { return /^What the flow is saying/.test(x.textContent.trim()) && x.children.length < 2; })[0]; if (hs && hs.nextElementSibling) demote(t, [hs, hs.nextElementSibling]); }
      if (t.classList.contains("tr-tile")) { var R = G.roll || [], ex = t.querySelector(".tr-exp"); box(t, ex ? ["The default switched at First Notice Day: " + R[0].contract + " is the front contract across the desk. The expired pair stays here, never as the default."] : [R[0].contract + " stays the default until its First Notice Day, then the desk moves to " + (R[1] || {}).contract + "."], "grains_settle"); return; }
      if (sec === "cftc") cftcView(k, t, G);
      if (seen[sec]) { var two = SECOND[sec] ? SECOND[sec](G, t) : []; if (two.length) box(t, two, KEYS[sec] || "model"); return; }
      if (sec === "snap" && !/dash-head/.test(t.className)) { var R0 = (G.roll || [])[0]; if (R0 && R0.prev) box(t, [R0.contract + " last settled " + (R0.settle > R0.prev ? "higher" : R0.settle < R0.prev ? "lower" : "unchanged") + " on the day."], "grains_settle"); return; }
      var r = RULES[sec], bs = r ? r(G, DATA.optflow && DATA.optflow[k], DATA, k) : domBullets(sec, t);
      if (!bs.length) return; seen[sec] = 1; box(t, bs, KEYS[sec] || "model");
    });
  }
  var rg = root.renderGrain, ss = root.setSub;
  root.renderGrain = function (k) { var r = rg.apply(this, arguments); paint(k); return r; };
  root.setSub = function (p) { var r = ss.apply(this, arguments); if (GR.indexOf(p) >= 0) paint(p); return r; };
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-cf-pick]"); if (b && root.GRAINS && GRAINS.pick) { var y = b.getBoundingClientRect().top; GRAINS.pick(b.getAttribute("data-cf-pick")); var nb = doc.querySelector('.tab-panel.active [data-cf-pick]'); if (nb) root.scrollBy(0, nb.getBoundingClientRect().top - y); } });
  doc.addEventListener("click", function (ev) { var t = ev.target.closest && ev.target.closest(".tile button, .tile [data-oiv]"); if (!t) return; var P = t.closest(".tab-panel"), k = P && P.id.replace("panel-", ""); if (GR.indexOf(k) >= 0) setTimeout(function () { paint(k); }, 30); });
  GR.forEach(paint);
  root.OBSLOG = LOG;
  root.OBSUI = { paint: paint };
})(typeof window !== "undefined" ? window : this);
