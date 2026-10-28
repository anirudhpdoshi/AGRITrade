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
  /* 1W, 2W, then every month out to 24M (12M = 1Y, 24M = 2Y) — 26 forward legs; the table adds spot on top = 27 rows */
  var TENORS = [["1W", "W", 1], ["2W", "W", 2]];
  for (var mo = 1; mo <= 24; mo++) TENORS.push([mo === 12 ? "1Y" : mo === 24 ? "2Y" : mo + "M", "M", mo]);
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
  var SHOW = { "1M": 1, "3M": 1, "6M": 1, "1Y": 1, "18M": 1, "2Y": 1 };
  var W = 760, H = 290, PL = 60, PR = 22, PT = 26, PB = 50, pw = W - PL - PR, ph = H - PT - PB;
  var S = { built: null, geom: null, res: null, inKey: null, inputs: null, spot: null, pending: null, timer: null, lastRun: 0, raf: 0, tid: null, cause: "", causeAt: 0, sel: "6M", sort: "date", hist1: null };
  try { S.sel = localStorage.getItem("desk.fwdSel") || "6M"; S.sort = localStorage.getItem("desk.fwdSort") || "date"; S.all = localStorage.getItem("desk.fwdAll") === "1"; } catch (e) {}
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
  /* Spot source chain (transparent: every state names its source and age):
       1 Finnhub stream (browser, unsealed after passcode)  - live while a tick arrived < 90 s ago
       2 otherwise the FRESHEST of: Coinbase reference poll (~30 s, browser) · Alpha Vantage (server, every 30 min)
         · Yahoo CAD=X (server: ~60 s fast lane on weekdays, else 15 min) - each with its own staleness limit
       market closed always wins; three failed browser polls with nothing fresh = FEED UNAVAILABLE */
  var LIMIT = { ref: 90e3, alpha: 45 * 60e3, yahoo: 20 * 60e3 };
  function ago(ms) { var m = Math.round(ms / 60000); return m < 1 ? "<1 min old" : m < 120 ? m + " min old" : Math.round(m / 60) + " h old"; }
  function feedState() {
    var L = window.DESK_LIVE && window.DESK_LIVE.feedState ? window.DESK_LIVE.feedState() : null, now = Date.now(), D = window.DATA;
    var c = [];
    if (L && L.lastTick && L.last > 0) c.push({ k: L.stream ? "stream" : "ref", p: L.last, t: L.lastTick });
    if (D && D.fx.alpha && D.fx.alpha.mid > 0) c.push({ k: "alpha", p: D.fx.alpha.mid, t: Date.parse(D.fx.alpha.ts) });
    if (D && D.fx.feed && D.fx.feed.mid > 0) c.push({ k: "yahoo", p: D.fx.feed.mid, t: Date.parse(D.meta.asof.fx_spot || D.fx.feed.ts) });
    c = c.filter(function (x) { return isFinite(x.t); });
    var live = c.filter(function (x) { return x.k === "stream" && now - x.t < 90000; })[0];
    var best = live || c.sort(function (a, b) { return b.t - a.t; })[0] || { k: "none", p: null, t: 0 };
    var age = now - best.t, NAME = { stream: "live stream", ref: "reference rate", alpha: "delayed rate (30-min check)", yahoo: "delayed rate", none: "no source" };
    var tail = " · " + (best.t ? clock(best.t) + " ET · " + ago(age) : "no price yet");
    var st;
    if (L && !L.session.open) st = { k: "closed", chip: "FX MARKET CLOSED", txt: "weekend close · reopens Sun 5 pm ET · priced off the last spot: " + NAME[best.k] + tail };
    else if (live) st = { k: "live", chip: "LIVE STREAM", txt: "live stream · last tick " + clock(best.t) + " ET" };
    else if (best.k === "ref" && age < LIMIT.ref) st = { k: "ref", chip: "REFERENCE RATE", txt: "reference rate (~30 s) · indicative mid, not an executable quote" + tail };
    else if (best.k === "alpha" && age < LIMIT.alpha) st = { k: "delayed", chip: "DELAYED", txt: "delayed rate · checked every 30 min" + tail };
    else if (best.k === "yahoo" && age < LIMIT.yahoo) st = { k: "delayed", chip: "DELAYED", txt: "delayed mid" + tail };
    else if (L && L.refFails >= 3) st = { k: "down", chip: "FEED UNAVAILABLE", txt: "Sorry, we can\u2019t be reached now \u2014 live and reference feeds not responding · last price from " + NAME[best.k] + tail };
    else st = { k: "stale", chip: "STALE", txt: "no fresh price · last from " + NAME[best.k] + tail };
    st.spot = best.p; st.spotT = best.t; st.source = best.k;
    return st;
  }

  /* ---------- build once ---------- */
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function build(box) {
    box.innerHTML =
      '<div class="fwd-status"><span class="fwd-chip"></span><span class="fwd-stxt"></span></div>' +
      '<div class="fl-head"></div>' +
      '<div class="fl-lab">Select maturity <small>· 1M – 24M · tap a tile</small></div><div class="fl-tiles qt-grid"></div>' +
      '<div class="fl-sel"></div>' +
      '<div class="fl-lab" style="margin-top:14px">Curve comparison <small>· forward points by tenor — today vs the last official closes</small></div><div class="fl-cmp"></div>' +
      '<div class="fl-lab" style="margin-top:14px">Broker ladder <small>· every value date · sort</small> <span class="fl-sort"><button type="button" data-flsort="date" aria-pressed="true">by date</button><button type="button" data-flsort="pts" aria-pressed="false">by points</button><button type="button" data-flsort="out" aria-pressed="false">by outright</button></span></div>' +
      '<div class="fwd-cause" aria-live="polite"></div>' +
      '<div style="overflow-x:auto"><table class="fwd-t"><thead><tr><th>Value date</th><th>Tenor</th><th>Outright</th><th>Fwd pts <small>(pips)</small></th><th>Δ pts <small>tick</small></th><th>Δ 1D</th><th>Annualised</th></tr></thead><tbody></tbody></table></div>' +
      '<details class="fl-more"><summary>Rate inputs and the CIP chart</summary><div class="fwd-inputs"></div><div class="fwd-chart"></div></details>' +
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
    var tb = box.querySelector("tbody"), sr = document.createElement("tr");
    sr.className = "fwd-spot";
    sr.innerHTML = '<td><span class="fd"></span> <small class="ft-in">SPOT</small></td><td class="ft">SPOT</td><td><b class="fo"></b></td><td><span class="fp">0.0</span></td><td class="fdl"></td><td class="f1d"></td><td class="fa">T+1</td>';
    tb.appendChild(sr);
    g.spotRow = { tr: sr, d: sr.querySelector(".fd"), o: sr.querySelector(".fo") };
    g.rows = TENORS.map(function (t) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<td><span class="fd"></span> <small class="ft-in">' + t[0] + '</small></td><td class="ft">' + t[0] + '</td>' +
        '<td><b class="fo" data-tick="fwdF-' + t[0] + '" data-roll></b></td><td class="neg"><span class="fp" data-tick="fwdP-' + t[0] + '" data-roll></span></td><td class="fdl"></td><td class="f1d"></td><td class="fa"></td>';
      tr.setAttribute("data-flsel", t[0]); tr.style.cursor = "pointer";
      tb.appendChild(tr);
      return { t: t[0], tr: tr, d: tr.querySelector(".fd"), o: tr.querySelector(".fo"), p: tr.querySelector(".fp"), dl: tr.querySelector(".fdl"), d1: tr.querySelector(".f1d"), a: tr.querySelector(".fa") };
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
      var y = Y(f), anc = i === res.legs.length - 1 ? "end" : "middle";
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
    var prev = S.res && S.res.ok ? S.res : null;
    g.legs.forEach(function (o, i) { var l = res.legs[i], p = prev && prev.legs[i], d = (l.F != null && p && p.F != null) ? l.F - p.F : 0;
      /* chart levels tick in sync with the table: green = outright rose, blue = fell */
      if (d && Math.abs(d) >= 5e-7 && !RM) { var c = d > 0 ? "#5fd598" : "#7fb0ff";
        o.dot.setAttribute("fill", c); if (o.show) o.out.setAttribute("fill", c);
        clearTimeout(o._ft); o._ft = setTimeout(function () { o.dot.setAttribute("fill", "#e8a33d"); if (o.show) o.out.setAttribute("fill", "#e8eef4"); }, 1100); }
      if (!o.show) return;
      o.out.textContent = l.F == null ? "" : l.F.toFixed(4); o.pts.textContent = l.F == null ? "n/a" : sg(l.pts, 0); o.date.textContent = lab(l.vd, true); });
    if (prev && res.ok && res.spot !== prev.spot && !RM) { var sc = res.spot > prev.spot ? "#5fd598" : "#7fb0ff"; g.spotTxt.setAttribute("fill", sc); g.spotLine.setAttribute("stroke", sc);
      clearTimeout(g._st); g._st = setTimeout(function () { g.spotTxt.setAttribute("fill", "#38b6c9"); g.spotLine.setAttribute("stroke", "#38b6c9"); }, 1100); }
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
  /* refresh tick: green flash = outright rose, blue flash = outright fell (re-triggers on every repricing) */
  function flash(tr, d) {
    if (!tr || RM || !d || Math.abs(d) < 5e-7) return;
    tr.classList.remove("fl-up", "fl-dn"); void tr.offsetWidth; tr.classList.add(d > 0 ? "fl-up" : "fl-dn");
    clearTimeout(tr._ft); tr._ft = setTimeout(function () { tr.classList.remove("fl-up", "fl-dn"); }, 1100);
  }
  function table(res, prev) {
    var pBy = {}; (prev && prev.legs || []).forEach(function (l) { pBy[l.t] = l; });
    var sp = S.built.spotRow;
    if (sp) { sp.d.textContent = res.spotDate ? lab(res.spotDate) : "—"; sp.o.textContent = res.ok ? f5(res.spot) : "—"; if (prev && prev.ok && res.ok) flash(sp.tr, res.spot - prev.spot); }
    S.built.rows.forEach(function (r, i) {
      var l = res.legs[i], p = pBy[l.t];
      if (l.F != null && p && p.F != null) flash(r.tr, l.F - p.F);
      r.d.textContent = lab(l.vd);
      r.o.textContent = l.F == null ? "—" : f5(l.F);
      r.p.textContent = l.F == null ? "—" : sg(l.pts, 1);
      r.a.textContent = l.F == null ? "n/a" : sg(l.ann, 2, "%");
      var dd = (l.F != null && p && p.F != null) ? l.pts - p.pts : null;
      r.dl.textContent = dd == null || Math.abs(dd) < 0.05 ? "" : sg(dd, 1);
      r.dl.className = "fdl " + (dd == null ? "" : dd > 0 ? "up" : dd < 0 ? "dn" : "");
      var y = S.hist1 && S.hist1.by[l.t], d1 = (l.F != null && y && y.F != null) ? l.pts - y.pts : null;
      r.d1.textContent = d1 == null ? "—" : sg(d1, 1); r.d1.className = "f1d " + (d1 == null ? "neu" : d1 > 0 ? "up" : d1 < 0 ? "dn" : "neu");
      r.tr.classList.toggle("fl-on", l.t === S.sel);
    });
    var tb = S.built.box.querySelector(".fwd-t tbody"), rows = S.built.rows.slice(), idx = {};
    res.legs.forEach(function (l, i) { idx[l.t] = l; });
    if (S.sort !== "date") rows.sort(function (a, b) { var A = idx[a.t], B = idx[b.t]; if (!A || A.F == null) return 1; if (!B || B.F == null) return -1; return S.sort === "pts" ? A.pts - B.pts : A.F - B.F; });
    rows.forEach(function (r) { tb.appendChild(r.tr); });
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
  /* ---------- rate ladder: head, maturity tiles, selected maturity, curve comparison ---------- */
  var TILE = TENORS.filter(function (t) { return t[1] === "M"; }).map(function (t) { return t[0]; });   /* 1M … 24M */
  function tl(t) { return t === "1Y" ? "12M" : t === "2Y" ? "24M" : t; }
  function px5(v) { return v.toFixed(5); }
  function hist(back) {                                /* price an earlier official close with its own inputs + its own trade date */
    var H = window.DATA && window.DATA.fx.fwd_hist; if (!H || !H.length) return null;
    var today = tradeDateET().toISOString().slice(0, 10), past = H.filter(function (h) { return h.date < today; });
    var h = past[past.length - back]; if (!h) return null;
    var p = h.date.split("-"), r = price({ spot: h.spot, us: h.us, ca: h.ca, trade: utc(+p[0], +p[1], +p[2]) }), by = {};
    r.legs.forEach(function (l) { by[l.t] = l; });
    return { date: h.date, spot: h.spot, res: r, by: by };
  }
  function headHTML(res, st) {
    var y2 = res.legs[res.legs.length - 1];
    return '<div class="fl-h"><div><b>USD / CAD</b><small>24-month forward monitor · covered-interest-parity outrights · theoretical, not dealer quotes</small></div></div>' +
      '<div class="fl-kv"><div><span>Spot reference</span><b class="qt-box" data-qt="flspot" data-v="' + res.spot + '" data-dec="5"><span class="qt-ar" aria-hidden="true"></span><span class="qt-v"><span class="qt-bf">' + px5(res.spot).slice(0, -2) + '</span><span class="qt-pp">' + px5(res.spot).slice(-2) + "</span></span></b><small>" + (st.spotT ? clock(st.spotT) + " ET · " : "") + esc(st.chip.toLowerCase()) + "</small></div>" +
      '<div><span>24M forward</span><b class="qt-box" data-qt="fl24" data-v="' + (y2.F || 0) + '" data-dec="5"><span class="qt-ar" aria-hidden="true"></span><span class="qt-v">' + (y2.F == null ? "—" : '<span class="qt-bf">' + px5(y2.F).slice(0, -2) + '</span><span class="qt-pp">' + px5(y2.F).slice(-2) + "</span>") + '</span></b><small>' + (y2.F == null ? "" : sg(y2.pts, 1) + " pips · " + lab(y2.vd)) + "</small></div></div>";
  }
  function tilesHTML(res) {
    var by = {}; res.legs.forEach(function (l) { by[l.t] = l; });
    var KEY = { "1M": 1, "2M": 1, "3M": 1, "6M": 1, "9M": 1, "1Y": 1, "18M": 1, "2Y": 1 };
    return TILE.filter(function (t) { return S.all || KEY[t] || t === S.sel; }).map(function (t) {
      var l = by[t], y = S.hist1 && S.hist1.by[t], d1 = l && l.F != null && y && y.F != null ? l.pts - y.pts : null, on = t === S.sel;
      if (!l || l.F == null) return '<button type="button" class="qt fl-t" data-flsel="' + t + '"><div class="qt-h"><b>' + tl(t) + '</b></div><div class="qt-c neu">unavailable</div></button>';
      return '<button type="button" class="qt fl-t' + (on ? " on" : "") + '" data-flsel="' + t + '" aria-pressed="' + on + '"><div class="qt-h"><b>' + tl(t) + "</b>" + (on ? '<span class="fl-ck">✓</span>' : '<span class="qt-sub">' + lab(l.vd, true) + "</span>") + "</div>" +
        '<div class="qt-box" data-qt="fl-' + t + '" data-v="' + l.F + '" data-dec="5"><span class="qt-ar" aria-hidden="true"></span><span class="qt-v"><span class="qt-bf">' + px5(l.F).slice(0, -2) + '</span><span class="qt-pp">' + px5(l.F).slice(-2) + "</span></span></div>" +
        '<div class="qt-c"><span class="' + (l.pts < 0 ? "dn" : "up") + '">Points ' + sg(l.pts, 1) + "</span>" + (d1 != null ? ' <span class="sl-k">· 1D</span> <span class="' + (d1 > 0 ? "up" : d1 < 0 ? "dn" : "neu") + '">' + sg(d1, 1) + "</span>" : "") + "</div>" +
        '<div class="qt-f">' + lab(l.vd) + "</div></button>";
    }).join("") + '<button type="button" class="fl-all" data-flall aria-pressed="' + !!S.all + '">' + (S.all ? "Show key maturities" : "All 24 months") + "</button>";
  }
  function selHTML(res) {
    var l = res.legs.filter(function (x) { return x.t === S.sel; })[0]; if (!l || l.F == null) return "";
    var y = S.hist1 && S.hist1.by[l.t], d1 = y && y.F != null ? l.pts - y.pts : null;
    var math = l.T < 1 ? px5(res.spot) + " × (1 + " + l.rCAD.toFixed(3) + "% × " + l.days + "/365) ÷ (1 + " + l.rUSD.toFixed(3) + "% × " + l.days + "/365)"
      : px5(res.spot) + " × (1 + " + l.rUSD.toFixed(3) + "%/2)^(−2×" + l.T.toFixed(3) + ") ÷ (1 + " + l.rCAD.toFixed(3) + "%/2)^(−2×" + l.T.toFixed(3) + ")";
    return '<div class="fl-selbox"><div class="fl-st">Selected maturity</div><div class="fl-sn">' + tl(l.t) + " forward</div>" +
      '<div class="fl-grid"><span>Value date</span><b>' + lab(l.vd) + ' <small>(' + l.days + ' days)</small></b><span>Forward outright</span><b class="fl-big">' + px5(l.F) + "</b>" +
      "<span>Forward points</span><b class=\"" + (l.pts < 0 ? "dn" : "up") + "\">" + sg(l.pts, 1) + " pips</b><span>Change vs " + (S.hist1 ? lab(new Date(S.hist1.date + "T00:00:00Z")) : "prior close") + "</span><b class=\"" + (d1 == null ? "neu" : d1 > 0 ? "up" : "dn") + "\">" + (d1 == null ? "—" : sg(d1, 1) + " pips") + "</b>" +
      "<span>Annualised carry</span><b>" + sg(l.ann, 2, "%") + "</b><span>USD · CAD rate</span><b>" + l.rUSD.toFixed(3) + "% · " + l.rCAD.toFixed(3) + "%</b></div>" +
      '<div class="bt-math">' + math + " = " + px5(l.F) + "</div></div>";
  }
  function cmpSVG(res) {
    var sets = [{ n: "Today (live spot)", c: "#e8a33d", r: res }];
    var h1 = S.hist1, h5 = hist(5);
    if (h1) sets.push({ n: lab(new Date(h1.date + "T00:00:00Z")) + " close", c: "#38b6c9", r: h1.res, dash: "" });
    if (h5) sets.push({ n: lab(new Date(h5.date + "T00:00:00Z")) + " close", c: "#9aa8bb", r: h5.res, dash: "4 4" });
    var Wc = 760, Hc = 230, L = 58, R = 150, T = 16, B = 34, pw2 = Wc - L - R, ph2 = Hc - T - B;
    var all = []; sets.forEach(function (st) { st.pts = TILE.map(function (t) { var l = st.r.legs.filter(function (x) { return x.t === t; })[0]; return l && l.F != null ? l.pts : null; }); all = all.concat(st.pts.filter(function (v) { return v != null; })); });
    if (!all.length) return '<p class="note">No forward curve to compare yet.</p>';
    var mn = Math.min.apply(null, all.concat([0])), mx = Math.max.apply(null, all.concat([0])), pad = (mx - mn) * 0.08 || 5; mn -= pad; mx += pad;
    var X = function (i) { return L + pw2 * i / (TILE.length - 1); }, Y = function (v) { return T + ph2 * (1 - (v - mn) / (mx - mn)); }, g = "";
    for (var k = 0; k <= 4; k++) { var v = mn + (mx - mn) * k / 4; g += '<line x1="' + L + '" x2="' + (L + pw2) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#1e2a3a"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">' + v.toFixed(0) + "</text>"; }
    [0, 2, 5, 8, 11, 14, 17, 20, 23].forEach(function (i) { g += '<text x="' + X(i).toFixed(1) + '" y="' + (Hc - 12) + '" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">' + tl(TILE[i]) + "</text>"; });
    var labs = [];
    sets.forEach(function (st) { var d = ""; st.pts.forEach(function (v, i) { if (v != null) d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
      g += '<path d="' + d + '" fill="none" stroke="' + st.c + '" stroke-width="' + (st === sets[0] ? 2.4 : 1.7) + '"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : "") + "/>";
      var lv = st.pts[st.pts.length - 1]; if (lv != null) labs.push({ y: Y(lv), t: st.n + " " + sg(lv, 0), c: st.c }); });
    labs.sort(function (a, b) { return a.y - b.y; }); for (var i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 13) labs[i].y = labs[i - 1].y + 13;
    labs.forEach(function (l) { g += '<text x="' + (L + pw2 + 6) + '" y="' + (l.y + 3.5).toFixed(1) + '" fill="' + l.c + '" font-size="10.5" font-weight="700" font-family="IBM Plex Mono">' + esc(l.t) + "</text>"; });
    TILE.forEach(function (t, i) {                   /* hover: every curve's points at that tenor */
      var x0 = i ? (X(i - 1) + X(i)) / 2 : L, x1 = i < TILE.length - 1 ? (X(i) + X(i + 1)) / 2 : L + pw2;
      g += '<rect class="oi-hit" x="' + x0.toFixed(1) + '" y="' + T + '" width="' + (x1 - x0).toFixed(1) + '" height="' + ph2 + '" fill="transparent" data-tip="' + tl(t) + " forward points|" + sets.map(function (st) { return esc(st.n) + ": " + (st.pts[i] == null ? "—" : sg(st.pts[i], 1) + " pips"); }).join("|") + '"/>'; });
    g += '<text x="12" y="' + (T + ph2 / 2) + '" transform="rotate(-90 12 ' + (T + ph2 / 2) + ')" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">forward points (pips)</text>';
    var shift = h1 ? res.legs.filter(function (l) { return l.t === "1Y"; })[0].pts - h1.by["1Y"].pts : null;
    return '<svg class="chart-svg" viewBox="0 0 ' + Wc + " " + Hc + '" role="img" aria-label="Forward points by tenor, today vs earlier closes">' + g + "</svg>" +
      '<p class="fl-cr">' + (shift == null ? "History builds from the next official close." : "At 12M the forward discount is " + (Math.abs(shift) < 0.5 ? "<b>unchanged</b>" : (shift < 0 ? "<b>deeper</b> by " : "<b>shallower</b> by ") + Math.abs(shift).toFixed(1) + " pips") + " versus the " + lab(new Date(h1.date + "T00:00:00Z")) + " close. Forward points move with the USD−CAD rate gap and, in proportion, with spot." + (h5 ? "" : " The 5-day comparison appears once the server has a week of closes stored.")) + "</p>";
  }
  function ladder(res) {
    var b = S.built.box, st = feedState();
    S.hist1 = hist(1);
    var hd = b.querySelector(".fl-head"), y2 = res.legs[res.legs.length - 1];
    if (!hd.querySelector("[data-qt=flspot]")) hd.innerHTML = headHTML(res, st);
    else { hd.querySelector("[data-qt=flspot]").setAttribute("data-v", res.spot); if (y2.F != null) hd.querySelector("[data-qt=fl24]").setAttribute("data-v", y2.F);
      var sm = hd.querySelectorAll(".fl-kv small"); sm[0].textContent = (st.spotT ? clock(st.spotT) + " ET · " : "") + st.chip.toLowerCase(); if (y2.F != null) sm[1].textContent = sg(y2.pts, 1) + " pips · " + lab(y2.vd);
    }
    var tw = b.querySelector(".fl-tiles");
    var tk = S.sel + "|" + !!S.all + "|" + (S.hist1 && S.hist1.date);
    if (tw.getAttribute("data-k") !== tk || !tw.children.length) { tw.innerHTML = tilesHTML(res); tw.setAttribute("data-k", tk); }
    else res.legs.forEach(function (l) {             /* tick: update values in place so motion.js flips the digits and flashes the box */
      var box = tw.querySelector('[data-qt="fl-' + l.t + '"]'); if (!box || l.F == null) return; box.setAttribute("data-v", l.F);
      var c = box.parentNode.querySelector(".qt-c"), y = S.hist1 && S.hist1.by[l.t], d1 = y && y.F != null ? l.pts - y.pts : null;
      if (c) c.innerHTML = '<span class="' + (l.pts < 0 ? "dn" : "up") + '">Points ' + sg(l.pts, 1) + "</span>" + (d1 != null ? ' <span class="sl-k">· 1D</span> <span class="' + (d1 > 0 ? "up" : d1 < 0 ? "dn" : "neu") + '">' + sg(d1, 1) + "</span>" : "");
    });
    b.querySelector(".fl-sel").innerHTML = selHTML(res);
    b.querySelector(".fl-cmp").innerHTML = cmpSVG(res);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest("#fx-fwd [data-flsel]");
    if (t) { S.sel = t.getAttribute("data-flsel"); try { localStorage.setItem("desk.fwdSel", S.sel); } catch (e) {} if (S.res) { ladder(S.res); table(S.res, null); } return; }
    var a = ev.target.closest && ev.target.closest("#fx-fwd [data-flall]");
    if (a) { S.all = !S.all; try { localStorage.setItem("desk.fwdAll", S.all ? "1" : "0"); } catch (e) {} if (S.res) ladder(S.res); return; }
    var o = ev.target.closest && ev.target.closest("#fx-fwd [data-flsort]");
    if (o) { S.sort = o.getAttribute("data-flsort"); try { localStorage.setItem("desk.fwdSort", S.sort); } catch (e) {}
      S.built.box.querySelectorAll("[data-flsort]").forEach(function (x) { x.setAttribute("aria-pressed", x === o); }); if (S.res) table(S.res, null); }
  });
  function bizDaysOld(iso) { if (!iso) return 99; var d = Date.parse(iso + "T12:00:00Z"), n = 0; for (var t = d + DAY; t <= Date.now(); t += DAY) { var w = new Date(t).getUTCDay(); if (w && w !== 6) n++; } return n; }
  function inputsHTML(I) {
    var K = ["1M", "3M", "6M", "1Y", "2Y"], cell = function (o, k) { return o[k] != null ? (+o[k]).toFixed(2) + "%" : "—"; };
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
    var y1 = res.legs.filter(function (l) { return l.t === "1Y"; })[0], y5 = res.legs[res.legs.length - 1];   /* longest leg = 2Y */
    if (!res.ok || !y1 || y1.F == null) return "\u26a0 Sorry, we can\u2019t be reached now \u2014 forward rates need " + esc(res.reason || "missing inputs") + ".";
    var disc = y1.pts < 0;
    return "USD/CAD trades at a <b>forward " + (disc ? "discount" : "premium") + "</b> at 1Y: the outright sits " + Math.abs(y1.pts).toFixed(0) + " pips " + (disc ? "below" : "above") + " spot (" + sg(y1.ann, 2, "%") +
      " annualised) because USD rates run " + (disc ? "above" : "below") + " CAD rates (" + y1.rUSD.toFixed(2) + "% vs " + y1.rCAD.toFixed(2) + "% at 1Y)." + (y5 && y5.F != null ? " At " + y5.t + " (" + lab(y5.vd) + ") the outright is " + f5(y5.F) + ", " + sg(y5.ann, 2, "%") + " annualised." : "");
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
    S.hist1 = hist(1);
    table(res, S.res);
    ladder(res);
    S.built.box.querySelectorAll("[data-flsort]").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-flsort") === S.sort); });
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
