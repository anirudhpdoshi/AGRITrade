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
    oi: function (g) { var N = g.near, o = []; if (!N || !N.rows || !N.underlying) return o; var c = 0, p = 0, top = null; N.rows.forEach(function (r) { var a = r[1] || 0, b = r[2] || 0; c += a; p += b; if (!top || a + b > top.t) top = { t: a + b, k: r[0] }; });
      var tot = c + p; if (!tot) return o; o.push("Exposure is most concentrated at the " + d2(top.k) + " strike.");
      o.push("Calls hold " + Math.round(c / tot * 100) + "% of " + N.chain + " notional exposure and puts " + Math.round(p / tot * 100) + "%, on notional only since no verified premium is held.");
      var P = N.rows_prev && N.rows_prev.rows; if (P) { var M = {}, was = 0, now = 0; P.forEach(function (r) { M[r[0]] = r; }); N.rows.forEach(function (r) { var q = M[r[0]]; if (q) { was += (q[1] || 0) + (q[2] || 0); now += (r[1] || 0) + (r[2] || 0); } }); if (was && now !== was) o.push("Exposure is " + (now > was ? "building" : "unwinding") + " versus the prior session."); }
      return o; }
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
      "<tr><td>Managed-money net</td><td>" + sg(L.net) + " contracts</td><td>" + (d == null ? "" : "Funds " + (d < 0 ? "sold " : "bought ") + n(d) + " net") + "</td><td>" + side + "</td></tr>" +
      (p == null ? "" : "<tr><td>Net as % of open interest</td><td>" + (p < 0 ? "−" : "+") + pct1(p) + "</td><td></td><td>" + c.label + "</td></tr>") +
      "<tr><td>Positioning trend (last " + Tr.length + ' reports)</td><td colspan="3">' + svg + "</td></tr></tbody></table>";
    var h = t.querySelector(":scope > h2, :scope > .tile-head"); if (h) h.after(el); else t.prepend(el);
  }
  var OIDOL = false;
  function futVal(t, G) { var old = t.querySelector(":scope > .oi-usd"); if (old) old.remove(); var R = G.roll || [], U = root.ROWSUI, A = R[0], B = R[1]; if (!U || !A || !B) return;
    var D = typeof rollData === "function" ? rollData(t.closest(".tab-panel").id.replace("panel-", "")) : null, N = D && D.dailyN && D.dailyN[D.dailyN.length - 1]; if (!N || !A.settle || !B.settle) return;
    var el = doc.createElement("div"); el.className = "oi-usd"; el.innerHTML = "<b>FUTURES OI VALUE ($)</b> " + A.contract + " " + U.usdB(U.notional(N[1], A.settle)) + " · " + B.contract + " " + U.usdB(U.notional(N[2], B.settle)) + " · contracts × 5,000 bu × settle"; var h = t.querySelector(":scope > .tile-head"); if (h) h.after(el); else t.prepend(el); }
  function oiView(t, G) { var old = t.querySelector(":scope > .oid"); if (old) old.remove(); var N = G.near, U = root.ROWSUI; if (!N || !N.rows || !N.underlying || !U) return; var px = N.underlying, c = 0, p = 0; N.rows.forEach(function (r) { c += r[1] || 0; p += r[2] || 0; });
    var f = function (v) { return U.usdB(U.notional(v, px)); }, cnt = function (v) { return Math.round(v || 0).toLocaleString("en-US"); }, tops = N.rows.slice().sort(function (a, b) { return ((b[1] || 0) + (b[2] || 0)) - ((a[1] || 0) + (a[2] || 0)); }).slice(0, 12).sort(function (a, b) { return a[0] - b[0]; });
    var el = doc.createElement("div"); el.className = "oid"; el.innerHTML = '<div class="cf-head"><b>Underlying notional exposure ($) · ' + esc(N.chain) + "</b><span>Contracts × 5,000 bu × futures " + esc(N.contract || "") + " $" + (+px).toFixed(4) + (N.oi_label ? " · " + esc(String(N.oi_label).split(" · ")[0]) : "") + "</span></div>" +
      '<div class="oid-sum">Calls ' + f(c) + " (" + Math.round(c / (c + p) * 100) + "%) · Puts " + f(p) + " (" + Math.round(p / (c + p) * 100) + "%) · Month total " + f(c + p) + "</div>" +
      '<div class="toggle oid-tog" role="group"><button type="button" data-oid="0" aria-pressed="' + !OIDOL + '">Contracts</button><button type="button" data-oid="1" aria-pressed="' + OIDOL + '">Dollars</button></div>' +
      (OIDOL ? '<table class="cf-tbl"><thead><tr><th>Strike</th><th>Call OI</th><th>Call notional</th><th>Put OI</th><th>Put notional</th></tr></thead><tbody>' + tops.map(function (r) { return "<tr><td>" + d2(r[0]) + "</td><td>" + cnt(r[1]) + "</td><td>" + f(r[1] || 0) + "</td><td>" + cnt(r[2]) + "</td><td>" + f(r[2] || 0) + "</td></tr>"; }).join("") + "<tr><td><b>Month total</b></td><td>" + cnt(c) + "</td><td>" + f(c) + "</td><td>" + cnt(p) + "</td><td>" + f(p) + "</td></tr></tbody></table>" : "");
    var h = t.querySelector(":scope > h2, :scope > .tile-head"); if (h) h.after(el); else t.prepend(el); }
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-oid]"); if (!b) return; OIDOL = b.getAttribute("data-oid") === "1"; GR.forEach(paint); });
  /* Seasonality grid (BRD G2): month-end % change of the contract that was front for the whole month; months not held stay blank */
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function seasonTile(k, sub) {
    var old = sub.querySelector(":scope > .ssn-tile"); if (old) old.remove();
    var S = root.DATA && DATA.seasonality && DATA.seasonality[k]; if (!S || !Object.keys(S).length) return;
    var yrs = {}; Object.keys(S).forEach(function (key) { yrs[key.slice(0, 4)] = 1; }); yrs = Object.keys(yrs).sort();
    var cell = function (v, c) { if (v == null) return "<td></td>"; var a = Math.min(1, Math.abs(v) / 8); return '<td title="' + esc(c || "") + '" style="background:' + (v >= 0 ? "rgba(95,214,138," : "rgba(242,125,125,") + (0.12 + a * 0.5).toFixed(2) + ')">' + (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "</td>"; };
    var avg = MON.map(function (x, i) { var L = yrs.map(function (y) { var r = S[y + "-" + (i < 9 ? "0" : "") + (i + 1)]; return r ? r[0] : null; }).filter(function (v) { return v != null; }); return L.length ? { v: L.reduce(function (a, b) { return a + b; }, 0) / L.length, n: L.length } : null; });
    var h = '<h2>Seasonality <span class="h2note">— month-end % change of the contract front for the whole month · hover a cell for the contract</span></h2><div class="tbl-scroll"><table class="cf-tbl ssn"><thead><tr><th>Year</th>' + MON.map(function (m) { return "<th>" + m + "</th>"; }).join("") + "</tr></thead><tbody>" +
      yrs.map(function (y) { return "<tr><td>" + y + "</td>" + MON.map(function (x, i) { var r = S[y + "-" + (i < 9 ? "0" : "") + (i + 1)]; return cell(r ? r[0] : null, r && r[1]); }).join("") + "</tr>"; }).join("") +
      '<tr class="ssn-avg"><td>Average</td>' + MON.map(function (x, i) { return avg[i] ? cell(+avg[i].v.toFixed(1), avg[i].n + " year" + (avg[i].n > 1 ? "s" : "")) : "<td></td>"; }).join("") + "</tr></tbody></table></div>";
    var t = doc.createElement("div"); t.className = "tile wide ssn-tile"; t.setAttribute("data-src", "grains_settle"); t.setAttribute("data-sec", "season"); t.innerHTML = h; var ask = [].filter.call(sub.children, function (x) { return /ASK CLAUDE/i.test((x.querySelector("h2") || {}).textContent || ""); })[0]; sub.insertBefore(t, ask || null);
    var nm = new Date().getMonth(), nx = (nm + 1) % 12, A = avg[nm], B = avg[nx], o = [];
    if (A) o.push(MON[nm] + " has averaged " + (A.v >= 0 ? "+" : "−") + Math.abs(A.v).toFixed(1) + " across the " + A.n + " year" + (A.n > 1 ? "s" : "") + " held.");
    if (B) o.push("Next, " + MON[nx] + " has averaged " + (B.v >= 0 ? "+" : "−") + Math.abs(B.v).toFixed(1) + ".");
    o.push("About two years are held, so treat this as a tendency, not a pattern.");
    box(t, o, "grains_settle");
  }
  function paint(k) {
    var P = doc.getElementById("panel-" + k), sub = P && P.querySelector("[data-subpanel].on"), G = root.DATA && DATA.grains && DATA.grains[k]; if (!sub || !G) return;
    if (sub.getAttribute("data-subpanel") === "overview") seasonTile(k, sub);
    var seen = {}, KEYS = { fan: "grains_settle", pos: "cftc_grains", cftc: "cftc_grains", cockpit: "options", opt: "options", vol: "options", optflow: "optflow", carry: "grains_settle", oi: "options", flow: "options", snap: "model", cost: "inputs", paths: "inputs", sd: "wasde", exp: "exports", dest: "exports", cmp: "sd_hist" };
    [].forEach.call(sub.children, function (t) {
      if (!t.classList.contains("tile")) return; var sec = t.getAttribute("data-sec");
      if (sub.getAttribute("data-subpanel") === "overview" && sec === "insight") { demote(t, [].slice.call(t.querySelectorAll(":scope > p.read"))); var rd = t.querySelector(".prow-ev p.read"), ss2 = rd ? rd.textContent.split(/(?<=[a-z%\d)])\.\s+(?=[A-Z])/).slice(0, 2).map(function (x) { return x.trim().replace(/\.+$/, "") + "."; }) : []; box(t, ss2, "model"); return; }
      if (sec === "flow") { var hs = [].filter.call(t.querySelectorAll("h3,h4,b,div"), function (x) { return /^What the flow is saying/.test(x.textContent.trim()) && x.children.length < 2; })[0]; if (hs && hs.nextElementSibling) demote(t, [hs, hs.nextElementSibling]); }
      if (t.classList.contains("tr-tile")) { var R = G.roll || [], ex = t.querySelector(".tr-exp"); box(t, ex ? ["The default switched at First Notice Day: " + R[0].contract + " is the front contract across the desk. The expired pair stays here, never as the default."] : [R[0].contract + " stays the default until its First Notice Day, then the desk moves to " + (R[1] || {}).contract + "."], "grains_settle"); return; }
      if (sec === "cftc") cftcView(k, t, G);
      if (sec === "oi") oiView(t, G);
      if (t.classList.contains("roll-tile")) futVal(t, G);
      if (seen[sec]) { var two = SECOND[sec] ? SECOND[sec](G, t) : []; if (two.length) box(t, two, KEYS[sec] || "model"); return; }
      if (sec === "snap" && !/dash-head/.test(t.className)) { var R0 = (G.roll || [])[0]; if (R0 && R0.prev) box(t, [R0.contract + " last settled " + (R0.settle > R0.prev ? "higher" : R0.settle < R0.prev ? "lower" : "unchanged") + " on the day."], "grains_settle"); return; }
      var r = RULES[sec], bs = r ? r(G, DATA.optflow && DATA.optflow[k], DATA, k) : domBullets(sec, t);
      if (!bs.length) return; seen[sec] = 1; box(t, bs, KEYS[sec] || "model");
    });
  }
  /* USD/CAD Desk (BRD s.15): one Observations box per panel, from the tab's own data */
  var FXMAX = { fx_spot: 72, fx_closes: 96, model: 96, cftc_fx: 240, macro: 1100, releases: 1100, yields_live: 72, energy: 72, policy: 96, sentiment: 72, ext: 1100 };
  function grab(t, re) { var m = re.exec(spaced(t)); return m || null; }
  var FXR = {
    spot: function (D, t) { var o = [], m = grab(t, /vs prior close ([\d.]+) ([+−-][\d.]+)%/i), r = grab(t, /20D range \(closes\) ([\d.]+) – ([\d.]+)/);
      if (m) o.push("Spot " + (/^[−-]/.test(m[2]) ? "below" : "above") + " the prior close of " + m[1] + ", " + m[2].replace(/^[+−-]/, "") + "% " + (/^[−-]/.test(m[2]) ? "lower" : "higher") + ".");
      if (r) o.push("Inside its 20-day close range of " + r[1] + " to " + r[2] + "."); return o; },
    daily: function (D, t) { var h = grab(t, /HIGH ([\d.]+) · (\w{3} \d+)/), l = grab(t, /LOW ([\d.]+) · (\w{3} \d+)/), z = grab(t, /LAST ([\d.]+)/); var o = [];
      if (h && l) o.push("The window's high was " + h[1] + " on " + h[2] + " and its low " + l[1] + " on " + l[2] + "."); if (z && h && l) o.push("The last close of " + z[1] + " sits " + (+z[1] - l[1] > h[1] - z[1] ? "nearer the high" : "nearer the low") + "."); return o; },
    model: function (D, t) { var p = grab(t, /1D P50 ([−-]?[\d.]+)% ([\d.]+)/), b = grab(t, /Base close ([\d.]+)/); var o = [];
      if (p && b) o.push("Model P50 " + p[2] + " against its base close of " + b[1] + ": a " + p[1].replace(/^[−-]/, "") + "% lean " + (/^[−-]/.test(p[1]) ? "lower" : "higher") + " for the next day.");
      o.push("Educational read only; it is not a trade signal."); return o; },
    pos: function (D) { var P = D.fx && D.fx.pos, o = []; if (!P) return o; o.push("Leveraged funds are net " + (P.net < 0 ? "short" : "long") + " CAD."); if (P.label) o.push(P.label + "."); return o; },
    cftc: function (D) { var P = D.fx && D.fx.pos, o = []; if (!P || P.wow == null) return o; o.push("Funds " + (P.wow > 0 ? (P.net < 0 ? "covered CAD shorts" : "added CAD longs") : (P.net < 0 ? "added CAD shorts" : "cut CAD longs")) + " on the week."); o.push("Weekly data, never read as today's position."); return o; },
    ys: function (D) { var R = ((D.fx && D.fx.rates) || []).filter(function (r) { return r.t === "2Y"; })[0], o = []; if (!R || R.dod == null) return o; o.push("The 2Y US-Canada spread " + (R.dod < 0 ? "narrowed" : R.dod > 0 ? "widened" : "held") + " on the day: " + (R.dod < 0 ? "less" : "more") + " rate support for USD/CAD."); return o; },
    en: function (D) { var E = ((D.fx && D.fx.energy) || []).filter(function (e) { return /^WTI/.test(e.name); })[0], o = []; if (!E || !E.pct) return o; o.push("WTI " + (E.pct < 0 ? "fell" : "rose") + " on the session: " + (E.pct < 0 ? "softer oil weighs on CAD." : "firmer oil supports CAD.")); return o; },
    pol: function (D) { var F = D.fx && D.fx.policy && D.fx.policy.fed && D.fx.policy.fed[0], o = []; if (!F) return o; var hk = F.hike_pct, es = F.ease_pct; o.push("Futures lean to a Fed " + (hk > es ? "hike" : es > hk ? "cut" : "hold") + " at the next meeting."); return o; },
    rel: function (D) { var R = ((D.fx && D.fx.releases) || []).slice().sort(function (a, b) { return a.released < b.released ? 1 : -1; })[0], o = [], h = R && R.history; if (!R || !h || h.length < 2) return o; var a = h[h.length - 1][1], p = h[h.length - 2][1]; o.push(R.name + " came in " + (a > p ? "above" : a < p ? "below" : "level with") + " the prior reading."); return o; }
  };
  FXR["more-0"] = function (D) { var R = ((D.fx && D.fx.rates) || []).filter(function (r) { return r.t === "10Y"; })[0], o = []; if (!R || R.dod == null) return o; o.push("The 10Y US-Canada spread " + (R.dod < 0 ? "narrowed" : R.dod > 0 ? "widened" : "held") + " on the day."); return o; };
  function paintFx() { var P = doc.getElementById("panel-fx"), sub = P && P.querySelector("[data-subpanel].on"), D = root.DATA; if (!sub || !D) return; var A = D.meta && D.meta.asof || {};
    [].forEach.call(sub.children, function (t) { var sec = t.getAttribute("data-sec"), r = FXR[sec]; if (!r || !t.classList.contains("tile")) return; var key = t.getAttribute("data-src"), old = t.querySelector(":scope > .obs-box"); if (old) old.remove();
      var h = FXMAX[key], tt = Date.parse(A[key]); if (h && !(isFinite(tt) && Date.now() - tt <= h * 36e5)) return;
      var txt = spaced(t), ok = r(D, t).filter(function (b) { return traceable(b, txt); }).slice(0, 3); if (!ok.length) return;
      var el = doc.createElement("div"); el.className = "obs-box"; el.innerHTML = "<b>OBSERVATIONS</b><ul>" + ok.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>"; t.appendChild(el); }); }
  var rg = root.renderGrain, ss = root.setSub;
  root.renderGrain = function (k) { var r = rg.apply(this, arguments); paint(k); return r; };
  root.setSub = function (p) { var r = ss.apply(this, arguments); if (GR.indexOf(p) >= 0) paint(p); if (p === "fx") paintFx(); return r; };
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("#tabbtn-fx")) setTimeout(paintFx, 0); });
  var raFx = root.renderAll; if (typeof raFx === "function") root.renderAll = function () { var r = raFx.apply(this, arguments); paintFx(); return r; };
  setInterval(function () { if (doc.getElementById("panel-fx") && doc.getElementById("panel-fx").classList.contains("active") && !doc.querySelector("#panel-fx [data-subpanel].on .obs-box")) paintFx(); }, 5000);
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-cf-pick]"); if (b && root.GRAINS && GRAINS.pick) { var y = b.getBoundingClientRect().top; GRAINS.pick(b.getAttribute("data-cf-pick")); var nb = doc.querySelector('.tab-panel.active [data-cf-pick]'); if (nb) root.scrollBy(0, nb.getBoundingClientRect().top - y); } });
  doc.addEventListener("click", function (ev) { var t = ev.target.closest && ev.target.closest(".tile button, .tile [data-oiv]"); if (!t) return; var P = doc.querySelector(".tab-panel.active"), k = P && P.id.replace("panel-", ""); if (GR.indexOf(k) >= 0) setTimeout(function () { paint(k); }, 30); }, true);   /* capture: the panel redraws its own buttons on click */
  GR.forEach(paint);
  root.OBSLOG = LOG;
  root.OBSUI = { paint: paint };
})(typeof window !== "undefined" ? window : this);
