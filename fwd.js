/* fwd.js — USD/CAD forward curve: pricing core (pure, unit-tested in tests/fwd.test.js) + live component.

   QUOTE: USD/CAD = CAD per 1 USD.  F(T) = S × DF_USD(T) ÷ DF_CAD(T)
     T < 1y : money-market, simple interest  DF = 1 / (1 + r·T)      → F = S·(1 + r_CAD·T)/(1 + r_USD·T)
     T ≥ 1y : bond yields, semi-annual       DF = (1 + r/2)^(−2T)
     T = actual days from the spot date to the value date ÷ 365 (both inputs are government yields quoted on a
         365-day basis: US Treasury CMT bond-equivalent yields, Government of Canada T-bill mid / benchmark yields).
   Spot date = T+1 business day (USD/CAD convention). Value date = spot date + tenor: weeks add days; months/years use the
   end-of-month rule and modified-following (Sat/Sun only — bank holidays are not in the calendar).
   Rate at T = linear interpolation in years between that currency's curve nodes, flat beyond the first/last node.
   These are theoretical covered-interest-parity forwards — NOT traded forward points and not executable quotes. */
(function (root) {
  "use strict";
  var TENORS = [["1W", "W", 1], ["2W", "W", 2], ["1M", "M", 1], ["2M", "M", 2], ["3M", "M", 3], ["6M", "M", 6], ["9M", "M", 9], ["1Y", "Y", 1], ["2Y", "Y", 2], ["5Y", "Y", 5]];
  var NODE_YEARS = { "0D": 0, "1M": 1 / 12, "2M": 2 / 12, "3M": 0.25, "4M": 4 / 12, "6M": 0.5, "1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, "7Y": 7, "10Y": 10 };
  var DAY = 86400000;

  function utc(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
  function isWeekend(d) { var w = d.getUTCDay(); return w === 0 || w === 6; }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
  function following(d) { while (isWeekend(d)) d = addDays(d, 1); return d; }
  function modFollowing(d) { var f = following(d); if (f.getUTCMonth() !== d.getUTCMonth()) { f = d; while (isWeekend(f)) f = addDays(f, -1); } return f; }
  function addMonths(d, n) {                       /* end-of-month rule: Jan 31 + 1M -> Feb 28/29, never Mar 3 */
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(day, last)));
  }
  function spotDate(trade) { var d = addDays(trade, 1); return following(d); }   /* USD/CAD spot = T+1 */
  function valueDate(spot, unit, n) {
    if (unit === "W") return following(addDays(spot, 7 * n));
    return modFollowing(addMonths(spot, unit === "M" ? n : 12 * n));
  }
  function rateAt(nodes, T) {                      /* nodes: {label: pct}; linear in years, flat extrapolation */
    var pts = Object.keys(nodes || {}).filter(function (k) { return NODE_YEARS[k] != null && isFinite(nodes[k]) && nodes[k] !== null; })
      .map(function (k) { return [NODE_YEARS[k], +nodes[k]]; }).sort(function (a, b) { return a[0] - b[0]; });
    if (!pts.length) return null;
    if (T <= pts[0][0]) return pts[0][1];
    if (T >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (var i = 1; i < pts.length; i++) if (T <= pts[i][0]) { var a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (T - a[0]) / (b[0] - a[0]); }
    return null;
  }
  function df(r, T) { return T < 1 ? 1 / (1 + r / 100 * T) : Math.pow(1 + r / 200, -2 * T); }
  /* price every tenor from ONE coherent snapshot: {spot, us:{nodes}, ca:{nodes}, trade: Date(UTC midnight of the ET trade date)} */
  function price(snap) {
    var S = +snap.spot, out = { ok: true, spot: S, legs: [], reason: null };
    if (!(S > 0) || !isFinite(S)) { out.ok = false; out.reason = "invalid or missing spot"; }
    var hasUS = snap.us && Object.keys(snap.us).length, hasCA = snap.ca && Object.keys(snap.ca).length;
    if (!hasUS || !hasCA) { out.ok = false; out.reason = out.reason || ("missing " + (!hasUS ? "USD" : "CAD") + " rate inputs"); }
    var sd = spotDate(snap.trade);
    out.spotDate = sd;
    TENORS.forEach(function (t) {
      var vd = valueDate(sd, t[1], t[2]), days = Math.round((vd - sd) / DAY), T = days / 365;
      var leg = { t: t[0], vd: vd, days: days, T: T, basis: T < 1 ? "money-market (simple)" : "bond (semi-annual)" };
      var rU = hasUS ? rateAt(snap.us, T) : null, rC = hasCA ? rateAt(snap.ca, T) : null;
      leg.rUSD = rU; leg.rCAD = rC;
      if (!out.ok || rU == null || rC == null) { leg.F = null; leg.unavailable = true; out.legs.push(leg); return; }
      leg.dfUSD = df(rU, T); leg.dfCAD = df(rC, T);
      leg.F = S * leg.dfUSD / leg.dfCAD;
      leg.pts = (leg.F - S) * 10000;                 /* forward points in pips (1 pip = 0.0001 CAD) */
      leg.ann = (leg.F / S - 1) / T * 100;
      out.legs.push(leg);
    });
    return out;
  }
  var core = { TENORS: TENORS, NODE_YEARS: NODE_YEARS, price: price, rateAt: rateAt, df: df, spotDate: spotDate, valueDate: valueDate, addMonths: addMonths, utc: utc };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; return; }

  /* ===================================== live component (browser only) ===================================== */
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SHOW = { "1M": 1, "3M": 1, "6M": 1, "1Y": 1, "2Y": 1, "5Y": 1 };
  var W = 760, H = 290, PL = 60, PR = 22, PT = 26, PB = 50, pw = W - PL - PR, ph = H - PT - PB;
  var S = { built: null, geom: null, res: null, inKey: null, inputs: null, spot: null, pending: null, timer: null, lastRun: 0, raf: 0, tid: null, cause: "", causeAt: 0 };
  var NS = "http://www.w3.org/2000/svg";
  function f5(v) { return v == null ? "—" : v.toFixed(5); }
  function sg(v, d, u) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + (u || ""); }
  function lab(d, short) { return short ? MON[d.getUTCMonth()] + " ’" + String(d.getUTCFullYear()).slice(2) : MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  function clock(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", second: "2-digit" }); }
  function tradeDateET() { var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now())).forEach(function (q) { p[q.type] = q.value; }); return utc(+p.year, +p.month, +p.day); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* rate inputs: server snapshot (fwd_inputs) when present; otherwise the legacy stored rates, flagged as indicative */
  function inputs() {
    var fx = window.DATA && window.DATA.fx; if (!fx) return null;
    var I = fx.fwd_inputs;
    if (I && I.us && I.ca && I.us.nodes && I.ca.nodes) return { us: I.us.nodes, ca: I.ca.nodes, usDate: I.us.date, caDate: I.ca.date, usSrc: I.us.src, caSrc: I.ca.src, note: null };
    var R = {}; (fx.rates || []).forEach(function (r) { R[r.t] = r; });
    var us = {}; ["1M", "2M", "3M", "4M", "6M", "1Y", "2Y", "5Y"].forEach(function (k) { if (fx.treasury && fx.treasury[k] != null) us[k] = fx.treasury[k]; });
    var ca = {}; if (fx.policy && fx.policy.corra_now != null) ca["0D"] = fx.policy.corra_now; if (R["2Y"]) ca["2Y"] = R["2Y"].ca; if (R["5Y"]) ca["5Y"] = R["5Y"].ca;
    var d = (window.DATA.meta.asof.yields || "").slice(0, 10);
    return { us: us, ca: ca, usDate: d, caDate: d, usSrc: "US Treasury daily par yield curve (CMT)", caSrc: "BoC overnight target + benchmark bonds",
      note: "Canadian T-bill yields are not loaded yet — the CAD short end is interpolated between the BoC overnight target and the 2Y benchmark (indicative)." };
  }
  function inKey(I) { return JSON.stringify([I.us, I.ca, I.usDate, I.caDate]); }

  /* feed / session state — from live.js, never inferred from the UI updating */
  function feedState() {
    var L = window.DESK_LIVE && window.DESK_LIVE.feedState ? window.DESK_LIVE.feedState() : null, now = Date.now(), D = window.DATA;
    var feedT = D && D.meta.asof.fx_spot ? Date.parse(D.meta.asof.fx_spot) : 0, src = D && D.fx.feed.source || "server feed";
    var tickFresh = L && L.lastTick && now - L.lastTick < 90000;
    var useTick = L && L.lastTick && L.last > 0 && L.lastTick >= feedT;   /* newest valid price wins, live or not */
    var spot = useTick ? L.last : (D && D.fx.feed.mid), spotT = useTick ? L.lastTick : feedT;
    var st;
    if (L && !L.session.open) st = { k: "closed", chip: "FX MARKET CLOSED", txt: "weekend close · reopens Sun 5 pm ET · curve priced off the last available spot (" + clock(spotT) + " ET)" };
    else if (tickFresh && L.stream) st = { k: "live", chip: "LIVE STREAM", txt: esc(L.source) + " · last tick " + clock(L.lastTick) + " ET" };
    else if (tickFresh) st = { k: "ref", chip: "REFERENCE RATE", txt: "keyless reference-rate poll (~30 s) · indicative mid, not an executable quote · " + clock(L.lastTick) + " ET" };
    else if (L && L.refFails >= 3) st = { k: "down", chip: "FEED UNAVAILABLE", txt: "spot poll failed " + L.refFails + "× in a row · showing last price " + clock(spotT) + " ET" };
    else if (feedT && now - feedT < 20 * 60000) st = { k: "delayed", chip: "DELAYED", txt: esc(src) + " · " + clock(feedT) + " ET" };
    else st = { k: "stale", chip: "STALE", txt: "last spot " + (spotT ? clock(spotT) + " ET (" + Math.round((now - spotT) / 60000) + " min old)" : "unknown") };
    st.spot = spot; st.spotT = spotT;
    return st;
  }

  /* ---------- build once ---------- */
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function build(box) {
    box.innerHTML =
      '<div class="fwd-status"><span class="fwd-chip"></span><span class="fwd-stxt"></span></div>' +
      '<div class="fwd-inputs"></div><div class="fwd-chart"></div>' +
      '<div class="fwd-cause" aria-live="polite"></div>' +
      '<table class="fwd-t"><thead><tr><th>Value date</th><th>Tenor</th><th>Outright</th><th>Fwd pts <small>(pips)</small></th><th>Δ pts</th><th>Annualised</th></tr></thead><tbody></tbody></table>' +
      '<p class="read fwd-read" style="font-size:13px"></p>';
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "USD/CAD CIP forward curve by value date" });
    box.querySelector(".fwd-chart").appendChild(svg);
    var g = { svg: svg, grid: [], spotLine: el("line", { x1: PL, x2: W - PR, stroke: "#38b6c9", "stroke-dasharray": "4 4" }, svg) };
    for (var i = 0; i <= 4; i++) g.grid.push([el("line", { x1: PL, x2: W - PR, stroke: "#1e2a3a" }, svg), el("text", { x: PL - 6, fill: "#5b6b82", "font-size": "10.5", "font-family": "IBM Plex Mono", "text-anchor": "end" }, svg)]);
    svg.insertBefore(g.spotLine, null);
    g.spotTxt = el("text", { x: W - PR, fill: "#38b6c9", "font-size": "10.5", "font-family": "IBM Plex Mono", "text-anchor": "end" }, svg);
    g.area = el("path", { fill: "rgba(224,101,95,.12)" }, svg);
    g.line = el("path", { fill: "none", stroke: "#e8a33d", "stroke-width": "2.2" }, svg);
    g.legs = TENORS.map(function (t, i) {
      var o = { show: !!SHOW[t[0]] };
      if (o.show) {
        var a = { "font-family": "IBM Plex Mono", "paint-order": "stroke", stroke: "#0f1825", "stroke-width": "3" };
        o.out = el("text", Object.assign({ fill: "#e8eef4", "font-size": "10.5", "font-weight": "700" }, a), svg);
        o.pts = el("text", Object.assign({ fill: "#ff9d97", "font-size": "9.5", "font-weight": "600" }, a), svg);
        o.date = el("text", { fill: "#8494ab", "font-size": "10", "font-family": "IBM Plex Mono", y: H - PB + 15 }, svg);
        o.ten = el("text", { fill: "#5b6b82", "font-size": "9", "font-family": "IBM Plex Mono", y: H - PB + 27 }, svg);
        o.ten.textContent = t[0];
      }
      o.hit = el("g", { "class": "btip", "data-i": i }, svg);
      o.halo = el("circle", { r: 11, fill: "transparent" }, o.hit);
      o.dot = el("circle", { r: o.show ? 3.8 : 2.6, fill: "#e8a33d", stroke: "#0f1825", "stroke-width": 1 }, o.hit);
      return o;
    });
    var foot = el("text", { x: PL, y: H - 4, fill: "#5b6b82", "font-size": "9.5", "font-family": "IBM Plex Mono" }, svg);
    foot.textContent = "VALUE DATE (√days) · WHITE = OUTRIGHT · RED = FWD POINTS (pips) · HOVER ANY DOT";
    var tb = box.querySelector("tbody");
    g.rows = TENORS.map(function (t) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><span class="fd"></span> <small class="ft-in">' + t[0] + '</small></td><td class="ft">' + t[0] + '</td>' +
        '<td><b class="fo" data-tick="fwdF-' + t[0] + '" data-roll></b></td><td class="neg"><span class="fp" data-tick="fwdP-' + t[0] + '" data-roll></span></td><td class="fdl"></td><td class="fa"></td>';
      tb.appendChild(tr);
      return { d: tr.querySelector(".fd"), o: tr.querySelector(".fo"), p: tr.querySelector(".fp"), dl: tr.querySelector(".fdl"), a: tr.querySelector(".fa") };
    });
    if (window.BTIPS) { S.tid = "fwd" + Math.random().toString(36).slice(2, 7); g.legs.forEach(function (o) { o.hit.setAttribute("data-tid", S.tid); }); }
    g.box = box; return g;
  }

  /* ---------- geometry ---------- */
  function geometry(res) {
    var legs = res.legs, maxD = Math.max.apply(null, legs.map(function (l) { return l.days; }));
    var ys = legs.filter(function (l) { return l.F != null; }).map(function (l) { return l.F; }).concat(res.ok ? [res.spot] : []);
    if (!ys.length) return null;
    var mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys), rg = (mx - mn) || 0.001;
    return { mn: mn - rg * 0.08, mx: mx + rg * 0.14, maxD: maxD, spot: res.spot,
      xs: legs.map(function (l) { return PL + pw * Math.sqrt(l.days) / Math.sqrt(maxD); }), fs: legs.map(function (l) { return l.F; }) };
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function mix(A, B, k) { if (!A) return B; return { mn: lerp(A.mn, B.mn, k), mx: lerp(A.mx, B.mx, k), maxD: B.maxD, spot: lerp(A.spot, B.spot, k),
    xs: B.xs.map(function (x, i) { return lerp(A.xs[i] != null ? A.xs[i] : x, x, k); }),
    fs: B.fs.map(function (f, i) { return f == null ? null : (A.fs[i] == null ? f : lerp(A.fs[i], f, k)); }) }; }
  function draw(G, res) {
    var g = S.built; if (!g) return;
    var Y = function (v) { return PT + ph * (1 - (v - G.mn) / (G.mx - G.mn)); };
    g.grid.forEach(function (p, i) { var v = G.mn + (G.mx - G.mn) * i / 4, y = Y(v); p[0].setAttribute("y1", y); p[0].setAttribute("y2", y); p[1].setAttribute("y", y + 4); p[1].textContent = v.toFixed(4); });
    var sy = Y(G.spot); g.spotLine.setAttribute("y1", sy); g.spotLine.setAttribute("y2", sy); g.spotTxt.setAttribute("y", sy - 5); g.spotTxt.textContent = "SPOT " + G.spot.toFixed(5);
    var d = "M" + PL + " " + sy.toFixed(1), last = null;
    G.fs.forEach(function (f, i) { if (f == null) return; d += "L" + G.xs[i].toFixed(1) + " " + Y(f).toFixed(1); last = i; });
    g.line.setAttribute("d", d);
    g.area.setAttribute("d", last == null ? "" : d + "L" + G.xs[last].toFixed(1) + " " + sy.toFixed(1) + "Z");
    g.legs.forEach(function (o, i) {
      var f = G.fs[i], x = G.xs[i], vis = f != null;
      o.hit.style.display = vis ? "" : "none";
      if (!vis) { if (o.show) [o.out, o.pts].forEach(function (t) { t.textContent = ""; }); return; }
      var y = Y(f), anc = res.legs[i].t === "5Y" ? "end" : "middle";
      o.dot.setAttribute("cx", x); o.dot.setAttribute("cy", y); o.halo.setAttribute("cx", x); o.halo.setAttribute("cy", y);
      if (o.show) {
        o.out.setAttribute("x", x); o.out.setAttribute("y", y - 9); o.out.setAttribute("text-anchor", anc);
        o.pts.setAttribute("x", x); o.pts.setAttribute("y", y + 17); o.pts.setAttribute("text-anchor", anc);
        o.date.setAttribute("x", x); o.date.setAttribute("text-anchor", anc); o.ten.setAttribute("x", x); o.ten.setAttribute("text-anchor", anc);
      }
    });
  }
  function labels(res) {
    var g = S.built;
    g.legs.forEach(function (o, i) { var l = res.legs[i]; if (!o.show) return;
      o.out.textContent = l.F == null ? "" : l.F.toFixed(4); o.pts.textContent = l.F == null ? "n/a" : sg(l.pts, 0); o.date.textContent = lab(l.vd, true); });
  }
  function animate(from, to, res) {
    cancelAnimationFrame(S.raf);
    if (RM || !from) { draw(to, res); S.geom = to; return; }
    var t0 = performance.now(), dur = 300;
    var built = S.built;
    (function step(now) { if (S.built !== built) return; var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3), G = mix(from, to, e);
      draw(G, res); S.geom = G; if (k < 1) S.raf = requestAnimationFrame(step); else S.geom = to; })(t0);
  }

  /* ---------- table, inputs, status, cause ---------- */
  function table(res, prev) {
    var pBy = {}; (prev && prev.legs || []).forEach(function (l) { pBy[l.t] = l; });
    S.built.rows.forEach(function (r, i) {
      var l = res.legs[i], p = pBy[l.t];
      r.d.textContent = lab(l.vd);
      r.o.textContent = l.F == null ? "—" : f5(l.F);
      r.p.textContent = l.F == null ? "—" : sg(l.pts, 1);
      r.a.textContent = l.F == null ? "n/a" : sg(l.ann, 2, "%");
      var dd = (l.F != null && p && p.F != null) ? l.pts - p.pts : null;
      r.dl.textContent = dd == null || Math.abs(dd) < 0.05 ? "" : sg(dd, 1);
      r.dl.className = "fdl " + (dd == null ? "" : dd > 0 ? "up" : dd < 0 ? "dn" : "");
    });
    if (window.BTIPS && S.tid) window.BTIPS[S.tid] = res.legs.map(function (l) {
      if (l.F == null) return '<div class="bt-h">' + l.t + ' forward</div><div>Unavailable — ' + (res.reason || "rate input missing for this tenor") + '.</div>';
      return '<div class="bt-h">' + lab(l.vd) + ' <span style="color:#8494ab;font-weight:400">· ' + l.t + ' · ' + l.days + ' days</span></div>' +
        '<div class="bt-row"><span>Outright (CIP)</span><b>' + f5(l.F) + '</b></div><div class="bt-row"><span>Spot</span><b>' + f5(res.spot) + '</b></div>' +
        '<div class="bt-row"><span>Forward points</span><b>' + sg(l.pts, 1) + ' pips</b></div><div class="bt-row"><span>USD rate · CAD rate</span><b>' + l.rUSD.toFixed(3) + '% · ' + l.rCAD.toFixed(3) + '%</b></div>' +
        '<div class="bt-row"><span>Basis</span><b>' + l.basis + '</b></div>' +
        '<div class="bt-math">' + (l.T < 1 ? f5(res.spot) + ' × (1 + ' + l.rCAD.toFixed(3) + '% × ' + l.days + '/365) ÷ (1 + ' + l.rUSD.toFixed(3) + '% × ' + l.days + '/365)'
          : f5(res.spot) + ' × (1 + ' + l.rUSD.toFixed(3) + '%/2)^(−2×' + l.T.toFixed(3) + ') ÷ (1 + ' + l.rCAD.toFixed(3) + '%/2)^(−2×' + l.T.toFixed(3) + ')') + ' = ' + f5(l.F) + '</div>';
    });
  }
  function bizDaysOld(iso) { if (!iso) return 99; var d = Date.parse(iso + "T12:00:00Z"), n = 0; for (var t = d + DAY; t <= Date.now(); t += DAY) { var w = new Date(t).getUTCDay(); if (w && w !== 6) n++; } return n; }
  function inputsHTML(I) {
    var K = ["1M", "3M", "6M", "1Y", "2Y", "5Y"], cell = function (o, k) { return o[k] != null ? (+o[k]).toFixed(2) + "%" : "—"; };
    var row = function (flagTxt, o, date, src) { var old = bizDaysOld(date) > 2;
      return '<tr><th>' + flagTxt + '</th>' + K.map(function (k) { return "<td>" + cell(o, k) + "</td>"; }).join("") + '<td class="fi-src' + (old ? " old" : "") + '">' + esc(src) + " · close " + esc(date || "?") + (old ? " · stale" : "") + "</td></tr>"; };
    return '<table class="fwd-in"><thead><tr><th>Rate inputs</th>' + K.map(function (k) { return "<th>" + k + "</th>"; }).join("") + "<th>Source</th></tr></thead><tbody>" +
      row("USD", I.us, I.usDate, I.usSrc) + row("CAD", I.ca, I.caDate, I.caSrc) +
      '<tr><th>USD−CAD</th>' + K.map(function (k) { var u = I.us[k], c = I.ca[k]; return "<td>" + (u != null && c != null ? sg((u - c) * 100, 0) + " bp" : "—") + "</td>"; }).join("") + '<td class="fi-src">rate differential drives the forward discount</td></tr></tbody></table>' +
      '<div class="fwd-srcline">USD: ' + esc(I.usSrc) + " \u00b7 close " + esc(I.usDate || "?") + (bizDaysOld(I.usDate) > 2 ? " (stale)" : "") + " \u00b7 CAD: " + esc(I.caSrc) + " \u00b7 close " + esc(I.caDate || "?") + (bizDaysOld(I.caDate) > 2 ? " (stale)" : "") + "</div>" +
      (I.note ? '<div class="fwd-note">' + esc(I.note) + "</div>" : "");
  }
  function causeText(prevSpot, spot, prevI, I) {
    var parts = [];
    if (prevSpot != null && spot !== prevSpot) parts.push("spot " + (spot > prevSpot ? "▲ " : "▼ ") + sg((spot - prevSpot) * 10000, 1) + " pips (" + f5(prevSpot) + " → " + f5(spot) + ") — every tenor shifts with spot; the rate differential is unchanged");
    if (prevI && inKey(prevI) !== inKey(I)) {
      var ch = [];
      ["us", "ca"].forEach(function (c) { var a = prevI[c], b = I[c]; Object.keys(Object.assign({}, a, b)).forEach(function (k) { if (a[k] !== b[k]) ch.push((c === "us" ? "USD " : "CAD ") + k + " " + (a[k] == null ? "—" : (+a[k]).toFixed(2)) + " → " + (b[k] == null ? "—" : (+b[k]).toFixed(2)) + "%"); }); });
      if (ch.length) parts.push("rate inputs changed: " + ch.slice(0, 4).join(" · ") + (ch.length > 4 ? " …" : "") + " — all tenors repriced");
    }
    return parts.join(" · ");
  }
  function readText(res) {
    var y1 = res.legs.filter(function (l) { return l.t === "1Y"; })[0], y5 = res.legs[res.legs.length - 1];
    if (!res.ok || !y1 || y1.F == null) return "Forward curve unavailable: " + esc(res.reason || "missing inputs") + ".";
    var disc = y1.pts < 0;
    return "USD/CAD trades at a <b>forward " + (disc ? "discount" : "premium") + "</b> at 1Y: the outright sits " + Math.abs(y1.pts).toFixed(0) + " pips " + (disc ? "below" : "above") + " spot (" + sg(y1.ann, 2, "%") +
      " annualised) because USD rates run " + (disc ? "above" : "below") + " CAD rates (" + y1.rUSD.toFixed(2) + "% vs " + y1.rCAD.toFixed(2) + "% at 1Y)." + (y5 && y5.F != null ? " At 5Y the annualised carry is " + sg(y5.ann, 2, "%") + "." : "");
  }
  function paintStatus() {
    if (!S.built || !document.body.contains(S.built.box)) return;
    var st = feedState(), b = S.built.box, chip = b.querySelector(".fwd-chip");
    chip.className = "fwd-chip " + st.k; chip.textContent = st.chip;
    b.querySelector(".fwd-stxt").innerHTML = st.txt + (S.res && !S.res.ok ? ' · <b class="dn">forwards unavailable: ' + esc(S.res.reason) + "</b>" : "");
    b.classList.toggle("fwd-dim", st.k === "stale" || st.k === "down");
    var c = b.querySelector(".fwd-cause");
    if (S.cause && Date.now() - S.causeAt < 120000) { c.textContent = "Last update " + clock(S.causeAt) + " ET — " + S.cause; c.style.visibility = "visible"; } else c.style.visibility = "hidden";
  }

  /* ---------- update cycle (batched) ---------- */
  function run() {
    S.timer = null; S.lastRun = performance.now();
    var box = document.getElementById("fx-fwd"); if (!box || !window.DATA) return;
    if (!S.built || S.built.box !== box || !box.querySelector(".fwd-chart")) { S.built = build(box); S.geom = null; }
    var I = inputs(); if (!I) return;
    var st = feedState(), spot = S.pending != null ? S.pending : st.spot;
    var res = price({ spot: spot, us: I.us, ca: I.ca, trade: tradeDateET() });
    var k = inKey(I), cause = S.res ? causeText(S.spot, spot, S.inputs, I) : "";
    if (cause) { S.cause = cause; S.causeAt = Date.now(); }
    if (!S.inputs || k !== S.inKey) S.built.box.querySelector(".fwd-inputs").innerHTML = inputsHTML(I);
    var G = geometry(res);
    if (G) { labels(res); animate(S.geom, G, res); }
    table(res, S.res);
    S.built.box.querySelector(".fwd-read").innerHTML = readText(res);
    S.res = res; S.spot = spot; S.inputs = I; S.inKey = k; S.pending = null;
    paintStatus();
    if (window.MOTION) window.MOTION.scan();         /* roll / flash the changed outrights and forward points */
  }
  function update(spot) {                              /* called on every valid tick; batched to <= 2 repaints a second */
    if (spot != null && (spot > 0) && isFinite(spot)) S.pending = +spot;
    if (S.timer) return;
    S.timer = setTimeout(run, Math.max(0, Math.min(500, 500 - (performance.now() - S.lastRun))));
  }
  function mount() { cancelAnimationFrame(S.raf); S.built = null; S.geom = null; update(); }
  setInterval(paintStatus, 5000);
  window.FWD = Object.assign({ update: update, mount: mount, state: feedState, _S: S }, core);
  if (document.getElementById("fx-fwd")) mount();
})(this);
