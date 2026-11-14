/* volcone.js — Volatility cone for Corn, Soybeans, Wheat and USD/CAD (first card of each Overview tab).
   Everything is computed from data already on the desk (data.json + the live feed):
   · Dual cone: amber wireframe anchored to the verified settle/close, cyan fan anchored to the latest tick (morphs on every tick)
   · Event-stepped variance: on WASDE / COT days the daily σ is scaled by the ratio of report-day to normal-day moves measured
     in this market's own price history (shown on the gate); option expiry is marked but not scaled (no history to measure)
   · Right-axis call/put OI by strike (grains), ΔOI vs the prior pull, net GEX from Black-76 gamma (dealers assumed long calls,
     short puts — the usual public convention) and the regime it implies; USD/CAD has no options OI, so its axis shows key levels
   · CFTC price line: the price on each COT report date, and where the price sits against the latest one
   · Breach beacons + a timestamped telemetry log when price is within 5¢ (grains) / 20 pips (USD/CAD) of an MA, an OI wall,
     a ±1σ band or the COT price; bottom proximity ruler gives the nearest support / resistance in ¢ (pips) and σ */
(function (root) {
  var doc = root.document;
  var KEYS = ["corn", "soybeans", "wheat", "fx"], NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat", fx: "USD/CAD" }, MULT = 5000;
  var L = { dual: true, walls: true, ma: true, events: true, cot: true, rv: false };
  try { var sv = JSON.parse(localStorage.getItem("desk.vcone") || "{}"); for (var q in sv) if (q in L) L[q] = !!sv[q]; } catch (e) {}
  function save() { try { localStorage.setItem("desk.vcone", JSON.stringify(L)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var TZ = "America/Toronto", DF = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), DET = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
    HM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  function md(iso) { return DF.format(new Date(String(iso).slice(0, 10) + "T12:00:00Z")); }
  function iso(t) { return DET.format(new Date(t)); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addBiz(s, n) { var d = new Date(s + "T12:00:00Z"); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); }
  function bizBetween(a, b) { var n = 0, d = new Date(a + "T12:00:00Z"), e = new Date(b + "T12:00:00Z"); while (d < e) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n++; } return n; }
  function ma(c, n, i) { if (i + 1 < n) return null; var s = 0; for (var j = i - n + 1; j <= i; j++) s += c[j]; return s / n; }
  function ncdf(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), y = 0.3989423 * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - y : y; }
  var npdf = function (x) { return Math.exp(-x * x / 2) / 2.5066283; };

  /* report-day / normal-day move ratio from this market's own closes */
  function eventRatio(dates, close, evDays) {
    var all = [], ev = [], idx = {};
    dates.forEach(function (d, i) { idx[d] = i; });
    for (var i = 1; i < close.length; i++) all.push(Math.pow(Math.log(close[i] / close[i - 1]), 2));
    evDays.forEach(function (d) { var i = idx[d]; if (i > 0) ev.push(Math.pow(Math.log(close[i] / close[i - 1]), 2)); });
    if (ev.length < 4 || !all.length) return null;
    var r = Math.sqrt((ev.reduce(function (a, b) { return a + b; }, 0) / ev.length) / (all.reduce(function (a, b) { return a + b; }, 0) / all.length));
    return { r: r, n: ev.length };
  }
  function nextBizOn(dates, d) { var set = {}; dates.forEach(function (x) { set[x] = 1; }); for (var i = 0; i < 6; i++) { if (set[d]) return d; d = addDays(d, 1); } return null; }

  function model(k) {
    var D = root.DATA; if (!D || !D.grain_long) return null;
    var fx = k === "fx", raw = fx ? (D.grain_long.other || {}).usdcad : (D.grain_long.series || {})[k];
    if (!raw || raw.length < 60) return null;
    var dates = raw.map(function (r) { return r[0]; }), close = raw.map(function (r) { return fx ? +r[1] : +r[4]; });
    var m = { k: k, fx: fx, dec: fx ? 5 : 4, dates: dates, close: close, unitMove: fx ? 1e4 : 100, uLab: fx ? " pips" : "¢" };
    var lastD = dates[dates.length - 1];
    if (fx) {
      var F = D.fx || {}, fd = F.feed || {};
      m.px = +fd.mid || close[close.length - 1]; m.settle = (F.spot && +F.spot.ref) || close[close.length - 2]; m.settleLab = "prior close";
      m.contract = "SPOT"; m.unit = "CAD per USD"; m.state = root.isAuto && !isAuto("fx_spot") ? "DELAYED" : "LIVE";
      var lr = []; for (var i = close.length - 20; i < close.length; i++) lr.push(Math.log(close[i] / close[i - 1]));
      var mu = lr.reduce(function (a, b) { return a + b; }, 0) / lr.length;
      m.sd = Math.sqrt(lr.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / (lr.length - 1)); m.volLab = "20-day realised vol"; m.thr = 0.0020; m.thrLab = "20 pips";
      var Lv = F.levels || {}; m.levels = [["S20", Lv.s20], ["R20", Lv.r20], ["S50", Lv.s50], ["R50", Lv.r50]].filter(function (x) { return x[1]; }).map(function (x) { return [x[0], +x[1]]; });
      m.cot = ((F.pos || {}).series || []).filter(function (c) { return c.px; }).map(function (c) { return { d: c.date, px: +c.px, net: c.net }; });
      m.ratios = { COT: eventRatio(dates, close, ((F.pos || {}).series || []).map(function (c) { return nextBizOn(dates, addDays(c.date, 6)); }).filter(Boolean)) };
    } else {
      var G = (D.grains || {})[k] || {}, fan = G.fan || {}, near = G.near || {}, R0 = (G.roll || [])[0] || {};
      var qt = G.quotes && G.quotes[R0.contract];
      m.settle = R0.settle != null ? +R0.settle : close[close.length - 1]; m.settleLab = "settle " + md(R0.settle_date || lastD);
      m.px = qt && qt.px != null && qt.ts && iso(Date.parse(qt.ts)) >= (R0.settle_date || "") ? +qt.px : m.settle;
      m.contract = R0.contract || fan.front || ""; m.unit = "$/bu";
      m.state = qt ? (root.MKT && MKT.grain && !MKT.grain() ? "CLOSED" : "DELAYED") : "SETTLE";
      var iv = +(near.iv || fan.iv_chain_iv); m.sdIv = iv > 0 ? iv / 100 / Math.sqrt(252) : null; m.iv = iv;
      /* realised: the desk's own 30-session settle σ (fan.sig, $/bu) as a share of the settle — the same σ the old σ-fan card used */
      m.sdRv = fan.sig && m.settle ? +fan.sig / m.settle : null;
      var useRv = L.rv && m.sdRv || !m.sdIv; m.sd = useRv ? m.sdRv : m.sdIv; m.rvOn = !!useRv;
      m.volLab = useRv ? "30-session realised σ ($" + (+fan.sig).toFixed(4) + "/day)" : "chain ATM IV " + (iv ? iv.toFixed(2) + "%" : "");
      try { if (root.fanLevels && root.GMETA) m.read = fanLevels(G, GMETA[k]).read; } catch (e) {}
      m.thr = 0.05; m.thrLab = "5¢";
      m.oi = (near.rows || []).map(function (r) { return [+r[0], +r[1] || 0, +r[2] || 0]; });
      var prev = {}; ((near.rows_prev || {}).rows || []).forEach(function (r) { prev[+r[0]] = [+r[1] || 0, +r[2] || 0]; }); m.prevOk = !!(near.rows_prev && near.rows_prev.rows);
      m.doi = m.oi.map(function (r) { var p = prev[r[0]] || [0, 0]; return [r[0], r[1] - p[0], r[2] - p[1]]; });
      m.oiLab = (near.chain || "") + " options OI" + (near.oi_final ? " · CME final" : " · preliminary") + (near.oi_date ? " " + md(near.oi_date) : "") + (m.prevOk ? " · Δ vs " + md(near.rows_prev.date) : "");
      m.cw = near.call_wall && +near.call_wall[0]; m.pw = near.put_wall && +near.put_wall[0];
      /* net GEX: Black-76 gamma per strike × OI × 5,000 bu × F² × 1% (dealers long calls, short puts) */
      var T = near.expires ? Math.max(1, (Date.parse(near.expires + "T19:20:00Z") - Date.now()) / 864e5) / 365 : null, sg = iv / 100, Fp = m.px;
      if (T && sg) { var g = 0; m.oi.forEach(function (r) { var d1 = (Math.log(Fp / r[0]) + sg * sg * T / 2) / (sg * Math.sqrt(T)), gm = npdf(d1) / (Fp * sg * Math.sqrt(T)); g += (r[1] - r[2]) * gm * MULT * Fp * Fp * 0.01; }); m.gex = g; }
      m.cot = (G.cftc || []).filter(function (c) { return c.px; }).map(function (c) { return { d: c.date, px: +c.px, net: c.net }; });
      /* event ratios from history: WASDE (same-day move), COT (first session after the Friday release) */
      var wd = ((D.grain_long.wasde) || []).map(function (d) { return nextBizOn(dates, d); }).filter(Boolean);
      var cd = (G.cftc || []).map(function (c) { return nextBizOn(dates, addDays(c.date, 6)); }).filter(Boolean);
      m.ratios = { WASDE: eventRatio(dates, close, wd), COT: eventRatio(dates, close, cd) };
    }
    var n = close.length - 1; m.ma20 = ma(close, 20, n); m.ma50 = ma(close, 50, n); m.ma100 = ma(close, 100, n);
    m.lastD = lastD; m.events = events(m);
    return m;
  }
  function events(m) {
    var out = [], now = Date.now(), end = Date.parse(addBiz(iso(now), 11) + "T23:59:00Z");
    try {
      if (m.fx && root.usdaEvents) usdaEvents("corn", now, 16).filter(function (e) { return e.kind === "cftc" && e.t > now && e.t < end; }).forEach(function (e) { out.push({ t: e.t, lab: "COT", kind: "cftc" }); });
      if (m.fx) (root.fxEvList ? fxEvList() : []).filter(function (e) { return e.t > now && e.t < end && e.impact === "High"; }).slice(0, 4)
        .forEach(function (e) { out.push({ t: e.t, lab: String(e.label).replace(/^(USD|CAD)\s+/, "").replace(/\s+(m\/m|y\/y|q\/q)$/, "").slice(0, 16), kind: "macro" }); });
      else if (root.usdaEvents) { var seen = {};
        usdaEvents(m.k, now, 16).filter(function (e) { return e.t > now && e.t < end && (/wasde|cftc/.test(e.kind) || (e.kind === "contract" && /expire/i.test(e.label))); }).forEach(function (e) {
          var lab = e.kind === "wasde" ? "WASDE" : e.kind === "cftc" ? "COT" : "OPEX"; var key = lab + iso(e.t); if (seen[key]) return; seen[key] = 1;
          out.push({ t: e.t, lab: lab, kind: e.kind }); }); }
    } catch (e) {}
    out.sort(function (a, b) { return a.t - b.t; }); return out.slice(0, 5);
  }
  /* cumulative variance path over 10 sessions with event steps; COT lands on the session after its 3:30 PM release */
  function path(m, F) {
    var mult = []; for (var t = 1; t <= F; t++) mult.push(1);
    m.events.forEach(function (e) {
      var r = m.ratios[e.lab]; if (!r || r.r <= 1) return;
      var day = bizBetween(m.lastD, iso(e.t)) + (e.lab === "COT" ? 1 : 0); if (day >= 1 && day <= F) mult[day - 1] = Math.max(mult[day - 1], r.r);
    });
    var V = [0]; for (var i = 0; i < F; i++) V.push(V[i] + Math.pow(m.sd * mult[i], 2));
    return V;
  }

  /* ---------- chart ---------- */
  var VW = 860, VH = 500, X0 = 10, PR = 170, PT = 30, PB = 26, HIST = 96;
  function draw(m) {
    var N = Math.min(90, m.close.length), C = m.close.slice(-N), Dt = m.dates.slice(-N), F = 10, all = N + F, base = m.close.length - N, d = m.dec;
    var V = m.sd ? path(m, F) : null, cone = function (anchor) { return V.map(function (v) { return [1, 2, 3].map(function (z) { return [anchor * Math.exp(-z * Math.sqrt(v)), anchor * Math.exp(z * Math.sqrt(v))]; }); }); };
    var live = V ? cone(m.px) : null, setl = V && L.dual ? cone(m.settle) : null;
    var vals = C.concat([m.px, m.settle]); if (live) vals.push(live[F][2][0], live[F][2][1]);
    if (L.ma) [m.ma20, m.ma50, m.ma100].forEach(function (x) { if (x) vals.push(x); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
    var X1 = VW - PR, XS = X0 + 0.6 * (X1 - X0), xs = function (i) { return i <= N - 1 ? X0 + i / (N - 1) * (XS - X0) : XS + (i - N + 1) / F * (X1 - XS); }, ys = function (v) { return PT + (hi - v) / (hi - lo) * (VH - PT - PB); };
    var s = "", xa = xs(N - 1), ya = ys(m.px), HX = X1 + 10;
    for (var g = 0; g <= 6; g++) { var gv = hi - (hi - lo) * g / 6, gy = ys(gv); s += '<line x1="' + X0 + '" x2="' + (VW - 60) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="vc-g"/><text x="' + (VW - 4) + '" y="' + (gy + 4).toFixed(1) + '" class="vc-ax" text-anchor="end">' + gv.toFixed(m.fx ? 4 : 4) + "</text>"; }
    for (var vx = 0; vx < N - 8; vx += Math.ceil(N / 4)) s += '<line x1="' + xs(vx).toFixed(1) + '" x2="' + xs(vx).toFixed(1) + '" y1="' + PT + '" y2="' + (VH - PB) + '" class="vc-g"/><text x="' + xs(vx).toFixed(1) + '" y="' + (VH - 9) + '" class="vc-ax" text-anchor="middle">' + md(Dt[vx]) + "</text>";
    s += '<text x="' + xs(all - 1).toFixed(1) + '" y="' + (VH - 9) + '" class="vc-ax" text-anchor="end">' + md(addBiz(Dt[N - 1], F)) + "</text>";
    /* right dock: OI by strike with ΔOI, or key levels */
    var walls = [];
    if (L.walls && m.oi && m.oi.length) {
      var inR = m.oi.filter(function (r) { return r[0] >= lo && r[0] <= hi; }), mx = Math.max.apply(null, inR.map(function (r) { return Math.max(r[1], r[2]); }).concat([1]));
      var bh = Math.max(2, Math.min(8, inR.length > 1 ? Math.abs(ys(inR[0][0]) - ys(inR[1][0])) * 0.42 : 8));
      inR.forEach(function (r) { var y = ys(r[0]), dd = (m.doi.filter(function (x) { return x[0] === r[0]; })[0]) || [r[0], 0, 0];
        if (r[1]) s += '<rect class="vc-call" x="' + HX + '" y="' + (y - bh).toFixed(1) + '" width="' + (r[1] / mx * HIST).toFixed(1) + '" height="' + bh.toFixed(1) + '"><title>' + r[0].toFixed(2) + " calls " + r[1].toLocaleString() + (m.prevOk ? " (Δ " + (dd[1] >= 0 ? "+" : "") + dd[1].toLocaleString() + ")" : "") + "</title></rect>";
        if (r[2]) s += '<rect class="vc-put" x="' + HX + '" y="' + y.toFixed(1) + '" width="' + (r[2] / mx * HIST).toFixed(1) + '" height="' + bh.toFixed(1) + '"><title>' + r[0].toFixed(2) + " puts " + r[2].toLocaleString() + (m.prevOk ? " (Δ " + (dd[2] >= 0 ? "+" : "") + dd[2].toLocaleString() + ")" : "") + "</title></rect>"; });
      if (m.cw) walls.push(["CALL WALL", m.cw, "c"]); if (m.pw) walls.push(["PUT WALL", m.pw, "p"]);
      s += '<text x="' + (VW - 4) + '" y="' + (PT - 12) + '" class="vc-ax2" text-anchor="end">' + esc(m.oiLab) + "</text>";
    } else if (L.walls && m.levels) {
      m.levels.forEach(function (lv) { var y = ys(lv[1]); if (y < PT || y > VH - PB) return;
        s += '<line x1="' + HX + '" x2="' + (HX + 64) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="vc-lvl"/><text x="' + (HX + 68) + '" y="' + (y + 3.5).toFixed(1) + '" class="vc-ax2">' + lv[0] + "</text>"; walls.push([lv[0], lv[1], "l"]); });
      s += '<text x="' + (VW - 4) + '" y="' + (PT - 12) + '" class="vc-ax2" text-anchor="end">Key levels · no FX options OI on file</text>';
    }
    walls.forEach(function (w) { if (w[2] === "l") return; var y = ys(w[1]); if (y < PT || y > VH - PB) return; s += '<line x1="' + xa.toFixed(1) + '" x2="' + X1 + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="vc-wall ' + w[2] + '"/>'; });
    /* event gates */
    var gates = [];
    if (L.events) m.events.forEach(function (e) { var bd = bizBetween(Dt[N - 1], iso(e.t)); if (bd < 0 || bd > F) return;
      var x = xs(N - 1 + bd + (e.lab === "COT" ? 0.85 : 0.5)).toFixed(1), r = m.ratios[e.lab];
      s += '<line x1="' + x + '" x2="' + x + '" y1="' + PT + '" y2="' + (VH - PB) + '" class="vc-ev"/><text x="' + x + '" y="' + (PT + 4) + '" class="vc-evl" transform="rotate(90 ' + x + " " + (PT + 4) + ')">' + esc(e.lab) + (r && r.r > 1 ? " ×" + r.r.toFixed(2) + "σ" : "") + "</text>"; gates.push(e); });
    /* cones: settle wireframe (amber, dashed) and live fan (cyan) */
    function poly(c, z) { var up = c.map(function (q, t) { return xs(N - 1 + t).toFixed(1) + "," + ys(q[z][1]).toFixed(1); }), dn = c.map(function (q, t) { return xs(N - 1 + t).toFixed(1) + "," + ys(q[z][0]).toFixed(1); }).reverse(); return "M" + up.join("L") + "L" + dn.join("L") + "Z"; }
    if (setl) [2, 1, 0].forEach(function (z) { s += '<path class="vc-wire" d="' + poly(setl, z) + '"/>'; });
    if (live) {
      [2, 1, 0].forEach(function (z) { s += '<path class="vc-cone z' + (z + 1) + '" d="' + poly(live, z) + '"/>';
        s += '<text x="' + (X1 - 2) + '" y="' + (ys(live[F][z][1]) - 3).toFixed(1) + '" class="vc-sig" text-anchor="end">+' + (z + 1) + "σ " + live[F][z][1].toFixed(d) + "</text>";
        s += '<text x="' + (X1 - 2) + '" y="' + (ys(live[F][z][0]) + 11).toFixed(1) + '" class="vc-sig" text-anchor="end">−' + (z + 1) + "σ " + live[F][z][0].toFixed(d) + "</text>"; });
    }
    /* MAs, CFTC price line, price */
    if (L.ma) [[20, "m20"], [50, "m50"], [100, "m100"]].forEach(function (q2) { var p = []; for (var i = 0; i < N; i++) { var v = ma(m.close, q2[0], base + i); if (v != null) p.push(xs(i).toFixed(1) + "," + ys(v).toFixed(1)); }
      if (p.length > 1) s += '<polyline class="vc-ma ' + q2[1] + '" points="' + p.join(" ") + '"/>'; });
    var cotLast = m.cot && m.cot.length ? m.cot[m.cot.length - 1] : null;
    if (L.cot && m.cot && m.cot.length) {
      var idx = {}; Dt.forEach(function (x, i) { idx[x] = i; });
      var pts = m.cot.filter(function (c) { return idx[c.d] != null; }), st = "";
      pts.forEach(function (c, i) { var x = xs(idx[c.d]), y = ys(c.px), nx = i < pts.length - 1 ? xs(idx[pts[i + 1].d]) : xa; st += (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1) + "L" + nx.toFixed(1) + "," + y.toFixed(1); });
      if (st) s += '<path class="vc-cot" d="' + st + '"/>' + pts.map(function (c) { return '<circle class="vc-cotd" cx="' + xs(idx[c.d]).toFixed(1) + '" cy="' + ys(c.px).toFixed(1) + '" r="2.6"><title>COT ' + md(c.d) + ": " + c.px.toFixed(d) + " · managed money net " + (c.net > 0 ? "+" : "") + (c.net || 0).toLocaleString() + "</title></circle>"; }).join("");
      if (cotLast) s += '<text x="' + (xa - 6).toFixed(1) + '" y="' + (ys(cotLast.px) + (cotLast.px > m.px ? -6 : 14)).toFixed(1) + '" class="vc-cotl" text-anchor="end">COT ' + md(cotLast.d) + " " + cotLast.px.toFixed(d) + "</text>";
    }
    s += '<polyline class="vc-pxl" points="' + C.map(function (v, i) { return xs(i).toFixed(1) + "," + ys(v).toFixed(1); }).join(" ") + " " + xa.toFixed(1) + "," + ya.toFixed(1) + '"/>';
    /* breaches: MA, OI walls, ±1σ (daily, from settle), COT price */
    var lv = []; [["MA20", m.ma20], ["MA50", m.ma50], ["MA100", m.ma100]].forEach(function (q3) { if (q3[1] && L.ma) lv.push(q3); });
    walls.forEach(function (w) { lv.push([w[0], w[1]]); });
    if (cotLast && L.cot) lv.push(["COT PX", cotLast.px]);
    var hits = [], badges = "", prevC = m.close[m.close.length - 2];
    lv.forEach(function (q4) { var dist = m.px - q4[1]; if (Math.abs(dist) > m.thr) return;
      var crossed = prevC != null && (prevC - q4[1]) * dist < 0, y = ys(q4[1]), tag = q4[0] + " " + (crossed ? "BREACH" : "TEST") + ": " + q4[1].toFixed(d); hits.push(tag);
      s += '<g class="vc-beacon"><line x1="' + (xa - 16) + '" x2="' + (xa + 16) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><line x1="' + xa.toFixed(1) + '" x2="' + xa.toFixed(1) + '" y1="' + (y - 16).toFixed(1) + '" y2="' + (y + 16).toFixed(1) + '"/><circle cx="' + xa.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5"/></g><line x1="' + xa.toFixed(1) + '" x2="' + X1 + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="vc-bline"/>';
      badges += '<g transform="translate(' + (X1 - 6) + " " + (y - 9).toFixed(1) + ')"><text class="vc-badge" text-anchor="end" y="0">' + tag + "</text></g>"; });
    /* anchor */
    var tag = m.px.toFixed(d);
    s += '<line x1="' + xa.toFixed(1) + '" x2="' + (VW - 60) + '" y1="' + ya.toFixed(1) + '" y2="' + ya.toFixed(1) + '" class="vc-pxline"/>';
    s += '<g class="vc-anchor" transform="translate(' + xa.toFixed(1) + " " + ya.toFixed(1) + ')"><circle class="vc-r1" r="9"/><circle class="vc-r2" r="9"/><circle class="vc-r3" r="17"/><circle class="vc-dot" r="5.5"/></g>';
    s += '<text x="' + xa.toFixed(1) + '" y="' + (ya + 30).toFixed(1) + '" class="vc-atag" text-anchor="middle">' + tag + "</text>";
    s += '<g transform="translate(' + (VW - 58) + " " + (ya - 11).toFixed(1) + ')"><rect class="vc-axtag" width="56" height="22" rx="3"/><text class="vc-axtagt" x="28" y="15.5" text-anchor="middle">' + m.px.toFixed(4) + "</text></g>";
    m._hits = hits; m._live = live; m._F = F; m._cot = cotLast;
    return '<svg class="vc-svg" viewBox="0 0 ' + VW + " " + VH + '" role="img" aria-label="' + esc(NAME[m.k]) + ' dual volatility cone">' + s + badges + "</svg>";
  }
  /* ---------- telemetry log (per market, this browser session) ---------- */
  function logGet(k) { try { return JSON.parse(sessionStorage.getItem("desk.vclog." + k) || "[]"); } catch (e) { return []; } }
  function logPut(k, L2) { try { sessionStorage.setItem("desk.vclog." + k, JSON.stringify(L2.slice(-12))); } catch (e) {} }
  function logHits(m) {
    var L2 = logGet(m.k), now = Date.now(), changed = false;
    (m._hits || []).forEach(function (h) { var key = h.split(":")[0]; if (L2.some(function (x) { return x.k === key && now - x.t < 30 * 6e4; })) return; L2.push({ t: now, k: key, txt: h }); changed = true; });
    if (!m.fx && m.prevOk && !L2.some(function (x) { return x.k === "doi"; })) {
      var top = m.doi.slice().sort(function (a, b) { return Math.max(Math.abs(b[1]), Math.abs(b[2])) - Math.max(Math.abs(a[1]), Math.abs(a[2])); })[0];
      if (top) { var c = Math.abs(top[1]) >= Math.abs(top[2]), v = c ? top[1] : top[2]; L2.unshift({ t: now, k: "doi", txt: (v >= 0 ? "+" : "−") + (Math.abs(v) / 1000).toFixed(1) + "K " + (c ? "CALL" : "PUT") + " OI @ " + top[0].toFixed(2) }); changed = true; }
    }
    if (changed) logPut(m.k, L2); return L2;
  }
  /* ---------- proximity ruler ---------- */
  function ruler(m) {
    var lv = [], live = m._live, F = m._F;
    [["MA20", m.ma20], ["MA50", m.ma50], ["MA100", m.ma100]].forEach(function (q) { if (q[1]) lv.push(q); });
    if (m.cw) lv.push(["Call wall", m.cw]); if (m.pw) lv.push(["Put wall", m.pw]); (m.levels || []).forEach(function (x) { lv.push(x); });
    if (live) { lv.push(["10d +1σ", live[F][0][1]]); lv.push(["10d −1σ", live[F][0][0]]); lv.push(["10d +2σ", live[F][1][1]]); lv.push(["10d −2σ", live[F][1][0]]); }
    if (m._cot) lv.push(["COT price", m._cot.px]);
    var dn = lv.filter(function (q) { return q[1] < m.px; }).sort(function (a, b) { return b[1] - a[1]; }), up = lv.filter(function (q) { return q[1] > m.px; }).sort(function (a, b) { return a[1] - b[1]; });
    var sdP = m.sd ? m.px * m.sd : null;
    function cell(q, dir) { if (!q) return '<span class="vc-ru"><i>' + (dir < 0 ? "▼ Nearest support" : "▲ Nearest resistance") + "</i> —</span>"; var dist = Math.abs(m.px - q[1]);
      return '<span class="vc-ru ' + (dir < 0 ? "s" : "r") + '"><i>' + (dir < 0 ? "▼ Nearest support" : "▲ Nearest resistance") + "</i> " + esc(q[0]) + " " + q[1].toFixed(m.dec) + " · " + (dist * m.unitMove).toFixed(1) + m.uLab + (sdP ? " · " + (dist / sdP).toFixed(2) + "σ" : "") + "</span>"; }
    return cell(dn[0], -1) + cell(up[0], 1) + cell(dn[1], -1) + cell(up[1], 1);
  }
  /* ---------- telemetry rail + header ---------- */
  function rail(m, L2) {
    var d = m.dec, live = m._live, F = m._F, VF = live ? Math.sqrt(path(m, F)[F]) : 0, ci = live ? [m.px * Math.exp(-1.96 * VF), m.px * Math.exp(1.96 * VF)] : null, ci99 = live ? [m.px * Math.exp(-2.576 * VF), m.px * Math.exp(2.576 * VF)] : null;
    var kv = function (a, b) { return '<div class="vc-kv"><span>' + a + "</span><b>" + b + "</b></div>"; };
    var tg = function (k2, lab) { return '<button type="button" class="vc-tg" data-vctg="' + k2 + '" aria-pressed="' + L[k2] + '"><span>' + lab + "</span><i></i></button>"; };
    var reg = m.gex == null ? (m.fx ? '<div class="vc-reg na">GAMMA REGIME: n/a — no FX options OI</div>' : "") : '<div class="vc-reg ' + (m.gex < 0 ? "short" : "long") + '">GAMMA REGIME: ' + (m.gex < 0 ? "SHORT / VOLATILE" : "LONG / PINNED") + "</div>";
    var cot = m._cot, cotTxt = cot ? (m.px >= cot.px ? "above" : "below") + " by " + (Math.abs(m.px - cot.px) * m.unitMove).toFixed(1) + m.uLab : "—";
    return '<div class="vc-rail">' + reg +
      '<div class="vc-kvs">' + kv("MA20", m.ma20 ? m.ma20.toFixed(d) : "—") + kv("MA50", m.ma50 ? m.ma50.toFixed(d) : "—") + kv("MA100", m.ma100 ? m.ma100.toFixed(d) : "—") +
        kv("10D 95% low", ci ? ci[0].toFixed(d) : "—") + kv("10D 95% high", ci ? ci[1].toFixed(d) : "—") + kv("10D 99% range", ci99 ? ci99[0].toFixed(d) + "–" + ci99[1].toFixed(d) : "—") +
        (m.sdIv && m.sdRv ? kv("Implied vol", (m.sdIv * Math.sqrt(252) * 100).toFixed(1) + "%") + kv("Realised vol 30d", (m.sdRv * Math.sqrt(252) * 100).toFixed(1) + "%") +
          kv("IV − RV", '<span class="' + (m.sdIv > m.sdRv ? "up" : "dn") + '">' + ((m.sdIv - m.sdRv) * Math.sqrt(252) * 100 >= 0 ? "+" : "−") + Math.abs((m.sdIv - m.sdRv) * Math.sqrt(252) * 100).toFixed(1) + " pts</span>") : "") + (m.gex != null ? kv("NET GEX", (m.gex < 0 ? "−$" : "$") + Math.abs(m.gex / 1e6).toFixed(0) + "M") : "") +
        kv("vs " + m.settleLab, ((m.px - m.settle) >= 0 ? "+" : "−") + Math.abs((m.px - m.settle) * m.unitMove).toFixed(1) + m.uLab) +
        kv("COT " + (cot ? md(cot.d) : "price"), cot ? cot.px.toFixed(d) : "—") + kv("Price vs COT", '<span class="' + (cot ? (m.px >= cot.px ? "up" : "dn") : "") + '">' + cotTxt + "</span>") +
        (cot && cot.net != null ? kv("Funds net", (cot.net > 0 ? "+" : "") + cot.net.toLocaleString()) : "") + "</div>" +
      '<div class="vc-tgs">' + tg("dual", "Dual cone") + tg("walls", m.fx ? "Key levels" : "GEX / OI walls") + tg("ma", "MA 20/50/100") + tg("events", "Event gates") + tg("cot", "CFTC price line") + (m.sdIv && m.sdRv ? tg("rv", "σ: realised, not implied") : "") + "</div>" +
      '<div class="vc-log"><b>Breach telemetry</b>' + (L2.length ? L2.slice(-6).reverse().map(function (x) { return "<div><span>" + HM.format(new Date(x.t)) + "</span>" + esc(x.txt) + "</div>"; }).join("") : '<div class="neu">No tests or breaches this session.</div>') + "</div></div>";
  }
  function head(m) {
    var d = m.dec, ch = m.px - m.settle, pc = (m.px / m.settle - 1) * 100, fxm = root.DATA.fx && root.DATA.fx.feed && +root.DATA.fx.feed.mid;
    return '<div class="vc-head"><span class="vc-nm">AGRITRADE // ' + esc(NAME[m.k].toUpperCase()) + " " + esc(m.contract) + ' <i class="vc-st ' + m.state.toLowerCase() + '">' + m.state + "</i></span>" +
      '<span class="vc-hp"><b class="vc-roll" data-vcpx>' + m.px.toFixed(d) + "</b> <small>" + esc(m.unit) + '</small> <span class="' + (ch > 0 ? "up" : ch < 0 ? "dn" : "") + '">' + (ch >= 0 ? "+" : "−") + Math.abs(ch).toFixed(d) + " (" + (pc >= 0 ? "+" : "−") + Math.abs(pc).toFixed(2) + "%)</span></span>" +
      (m.fx ? "" : '<span class="vc-hk">USD/CAD <b>' + (fxm ? fxm.toFixed(4) : "—") + "</b></span>") + '<span class="vc-hk">' + (m.fx ? "RVOL 20D" : m.rvOn ? "RVOL 30D" : "CHAIN IV") + " <b>" + (m.sd ? (m.sd * Math.sqrt(252) * 100).toFixed(2) + "%" : "—") + "</b></span>" +
      '<span class="vc-hk vc-cycle">CYCLE <b data-vccyc>01:00</b><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="vc-cbg"/><circle cx="12" cy="12" r="10" class="vc-cfg" pathLength="100"/></svg></span></div>';
  }
  function tileHTML(k) {
    var m = model(k); if (!m) return "";
    var svg = draw(m), L2 = logHits(m);
    var evs = Object.keys(m.ratios || {}).filter(function (x) { return m.ratios[x]; }).map(function (x) { return x + " days move " + m.ratios[x].r.toFixed(2) + "× a normal day (" + m.ratios[x].n + " reports in the history)"; }).join("; ");
    return '<div class="tile wide vcone-tile" data-vck="' + k + '" data-src="' + (m.fx ? "fx_spot" : "grains_quote") + '"><h2>Volatility cone <span class="h2note">— ' + NAME[k] + ": dual cone (settle vs live), event-stepped ±1–3σ, " + (m.fx ? "key levels" : "OI walls, gamma regime") + ", CFTC price line</span></h2>" +
      head(m) + (m.read ? '<p class="vc-read"><b>Level check</b> ' + esc(m.read) + "</p>" : "") + '<div class="vc-wrap">' + rail(m, L2) + '<div class="vc-main">' + svg + "</div></div>" + '<div class="vc-ruler">' + ruler(m) + "</div>" +
      '<div class="stamp">Cones = price × e<sup>±kσ√V</sup>, σ from the ' + esc(m.volLab) + "; amber wireframe from the " + esc(m.settleLab) + ", cyan fan from the latest tick — market-implied ranges, not forecasts" +
      (evs ? " · event steps measured from this market’s closes: " + esc(evs) : m.fx ? " · no event-day history for USD/CAD, so its gates are marked but not stepped" : "") +
      (m.gex != null ? " · net GEX = Σ (call OI − put OI) × Black-76 gamma × 5,000 bu × F² × 1% (dealers assumed long calls, short puts)" : "") +
      " · beacons within " + m.thrLab + " of an MA, an OI wall / key level or the COT price · CFTC price = futures price on each COT report date</div></div>";
  }
  function mount(k) {
    var P = doc.getElementById("panel-" + k), S = P && P.querySelector('[data-subpanel="overview"]'); if (!S) return;
    var old = S.querySelector(":scope > .vcone-tile"), h = tileHTML(k); if (!h) { if (old) old.remove(); return; }
    var w = doc.createElement("div"); w.innerHTML = h; var t = w.firstChild;
    if (old) old.replaceWith(t); else { var first = [].filter.call(S.children, function (c) { return c.classList.contains("tile") && !/kpi-strip|dash-head/.test(c.className); })[0]; S.insertBefore(t, first || null); }
    var m = model(k); LAST[k] = m ? m.px : null;
  }
  var LAST = {};
  ["renderGrain", "renderFX"].forEach(function (fn) {
    var o = root[fn]; if (typeof o !== "function") return;
    root[fn] = function (k) { var r = o.apply(this, arguments); try { if (fn === "renderFX") mount("fx"); else if (KEYS.indexOf(k) >= 0) mount(k); } catch (e) {} return r; };
  });
  /* tick loop: 60 s cycle ring; on a new price the cones morph (CSS transition on d), the sonar ripples and the digits roll */
  var cyc0 = Date.now();
  setInterval(function () {
    var left = 60 - Math.floor(((Date.now() - cyc0) % 60000) / 1000), pct = ((Date.now() - cyc0) % 60000) / 600;
    [].forEach.call(doc.querySelectorAll("[data-vccyc]"), function (e) { e.textContent = "00:" + ("0" + (left % 60)).slice(-2) + "s"; });
    [].forEach.call(doc.querySelectorAll(".vc-cfg"), function (c) { c.style.strokeDashoffset = (100 - pct).toFixed(1); });
  }, 1000);
  setInterval(function () {
    var A = doc.querySelector(".tab-panel.active .vcone-tile"); if (!A) return;
    var k = A.getAttribute("data-vck"), m = model(k); if (!m) return;
    if (LAST[k] != null && Math.abs(m.px - LAST[k]) > 1e-9) {
      var svgEl = A.querySelector(".vc-svg"), html = draw(m), L2 = logHits(m);
      var tmp = doc.createElement("div"); tmp.innerHTML = html; var nsvg = tmp.firstChild;
      /* morph: copy new path geometry onto the existing cone paths so CSS interpolates them over 600 ms */
      var oc = svgEl ? svgEl.querySelectorAll(".vc-cone,.vc-wire") : [], nc = nsvg.querySelectorAll(".vc-cone,.vc-wire");
      if (svgEl && oc.length === nc.length) { [].forEach.call(nc, function (p, i) { var dNew = p.getAttribute("d"); p.setAttribute("d", oc[i].getAttribute("d")); requestAnimationFrame(function () { p.style.d = 'path("' + dNew + '")'; }); }); }
      if (svgEl) svgEl.replaceWith(nsvg);
      A.querySelector(".vc-rail").outerHTML = rail(m, L2); A.querySelector(".vc-ruler").innerHTML = ruler(m);
      var hd = A.querySelector(".vc-head"); if (hd) { hd.outerHTML = head(m); var r = A.querySelector(".vc-roll"); if (r) r.classList.add("tick"); }
      var an = A.querySelector(".vc-anchor"); if (an) an.classList.add("tick");
      cyc0 = Date.now();
    }
    LAST[k] = m.px;
  }, 2000);
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-vctg]"); if (!b) return;
    var k2 = b.getAttribute("data-vctg"); L[k2] = !L[k2]; save();
    KEYS.forEach(function (k) { var P = doc.getElementById("panel-" + k); if (P && P.querySelector(".vcone-tile")) mount(k); });
  });
  KEYS.forEach(function (k) { var P = doc.getElementById("panel-" + k); if (P && P.innerHTML) try { mount(k); } catch (e) {} });
  var css = doc.createElement("style");
  css.textContent =
    ".vc-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 22px;border:1px solid #1a1a1a;border-bottom:0;border-radius:8px 8px 0 0;padding:10px 14px;background:#000;font-family:'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".vc-nm{font-size:14px;color:#e8eef4;letter-spacing:.04em;display:flex;align-items:center;gap:8px}.vc-st{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.06em;border:1px solid;border-radius:3px;padding:0 4px}.vc-st.live{color:#3fb97f}.vc-st.delayed{color:#e8b93d}.vc-st.settle{color:#8f9db3}.vc-st.closed{color:#e0655f}" +
    ".vc-hp b{font-size:22px;font-weight:500;color:#fff;display:inline-block;font-variant-numeric:tabular-nums}.vc-hp small{color:#8a8a8a}.vc-hp .up{color:#3fb97f}.vc-hp .dn{color:#e0655f}.vc-roll.tick{animation:vcRoll .45s ease-out}@keyframes vcRoll{0%{transform:translateY(-60%);opacity:0}100%{transform:none;opacity:1}}" +
    ".vc-hk{font-size:12px;color:#8a8a8a}.vc-hk b{color:#e8eef4;font-weight:500}.vc-cycle{margin-left:auto;display:inline-flex;align-items:center;gap:8px}.vc-cycle svg{width:22px;height:22px;transform:rotate(-90deg)}.vc-cbg{fill:none;stroke:#222;stroke-width:2.5}.vc-cfg{fill:none;stroke:#38e0f0;stroke-width:2.5;stroke-dasharray:100;transition:stroke-dashoffset .95s linear;filter:drop-shadow(0 0 3px #38e0f0)}" +
    ".vc-read{margin:0;border:1px solid #1a1a1a;border-bottom:0;background:#000;padding:8px 14px;font-size:12.5px;line-height:1.5;color:#c9d4e2}.vc-read b{font:600 10px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#d9b46a;margin-right:6px}" +
    ".vc-wrap{display:grid;grid-template-columns:minmax(200px,20%) minmax(0,1fr);border:1px solid #1a1a1a;background:#000}" +
    ".vc-rail{padding:12px;border-right:1px solid #1a1a1a;display:flex;flex-direction:column;gap:10px;font-family:'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".vc-reg{font-size:10.5px;font-weight:700;letter-spacing:.05em;border:1px solid;border-radius:5px;padding:4px 8px;text-align:center}.vc-reg.short{color:#ffb020;border-color:#ffb02088;background:rgba(255,176,32,.08)}.vc-reg.long{color:#38b6c9;border-color:#38b6c988;background:rgba(56,182,201,.08)}.vc-reg.na{color:#777;border-color:#333}" +
    ".vc-kvs{display:flex;flex-direction:column;gap:3px}.vc-kv{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:#8a8a8a}.vc-kv b{color:#e8eef4;font-weight:500;text-align:right;font-variant-numeric:tabular-nums}.vc-kv .up{color:#3fb97f}.vc-kv .dn{color:#e0655f}" +
    ".vc-tgs{display:flex;flex-direction:column;gap:7px;border-top:1px solid #1a1a1a;padding-top:10px}.vc-tg{all:unset;background:none!important;border:0!important;box-shadow:none!important;padding:0!important;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;font:11.5px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.04em;text-transform:uppercase;color:#777}" +
    ".vc-tg i{width:30px;height:16px;border-radius:9px;background:#222;position:relative;flex:0 0 auto}.vc-tg i:after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#666;transition:left .2s}" +
    ".vc-tg[aria-pressed=true]{color:#e8eef4}.vc-tg[aria-pressed=true] i{background:#2b2b2b}.vc-tg[aria-pressed=true] i:after{left:16px;background:#d0d0d0}.vc-tg:focus-visible{outline:2px solid #38b6c9}" +
    ".vc-log{border-top:1px solid #1a1a1a;padding-top:10px;font-size:11px;color:#c9d4e2;display:flex;flex-direction:column;gap:3px;margin-top:auto}.vc-log b{font-size:10.5px;letter-spacing:.06em;color:#8a8a8a;font-weight:500;text-transform:uppercase}.vc-log span{color:#777;margin-right:8px}" +
    ".vc-main{min-width:0}.vc-svg{width:100%;height:auto;display:block}.vc-g{stroke:#1a1a1a}.vc-ax{fill:#777;font:11px 'JetBrains Mono','IBM Plex Mono',monospace}.vc-ax2{fill:#8a8a8a;font:9.5px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".vc-pxl{fill:none;stroke:#f2f2f2;stroke-width:1.4}.vc-ma{fill:none;stroke-width:1.4}.vc-ma.m20{stroke:#c9b07a}.vc-ma.m50{stroke:#7b6fd0}.vc-ma.m100{stroke:#474c86}" +
    ".vc-cone{transition:d .6s ease}.vc-cone.z1{fill:rgba(56,224,190,.30);stroke:rgba(80,240,210,.7);stroke-width:1}.vc-cone.z2{fill:rgba(56,224,190,.16);stroke:rgba(80,240,210,.45);stroke-width:1}.vc-cone.z3{fill:rgba(56,224,190,.07);stroke:rgba(80,240,210,.3);stroke-width:1}" +
    ".vc-wire{fill:rgba(217,140,40,.04);stroke:#d99a3a;stroke-width:1;stroke-dasharray:4 3;transition:d .6s ease}.vc-sig{fill:#6fe0c6;font:10px 'JetBrains Mono','IBM Plex Mono',monospace;paint-order:stroke;stroke:#000;stroke-width:3}" +
    ".vc-call{fill:#2fae6a}.vc-put{fill:#c0392b}.vc-wall{stroke-width:1;stroke-dasharray:2 4}.vc-wall.c{stroke:#2fae6a}.vc-wall.p{stroke:#c0392b}.vc-lvl{stroke:#8a8a8a;stroke-dasharray:3 3}" +
    ".vc-ev{stroke:#555;stroke-dasharray:4 4}.vc-evl{fill:#8a8a8a;font:10px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.08em}" +
    ".vc-cot{fill:none;stroke:#ffb020;stroke-width:1.2;stroke-dasharray:6 3;opacity:.85}.vc-cotd{fill:#ffb020}.vc-cotl{fill:#ffcb6b;font:10px 'JetBrains Mono','IBM Plex Mono',monospace;paint-order:stroke;stroke:#000;stroke-width:3}" +
    ".vc-beacon line{stroke:#ffb020;stroke-width:1.5}.vc-beacon circle{fill:none;stroke:#ffb020;stroke-width:1.5;filter:drop-shadow(0 0 5px #ffb020)}.vc-bline{stroke:#ffb020;stroke-dasharray:2 3}" +
    ".vc-badge{fill:#ffcb6b;font:600 11px 'JetBrains Mono','IBM Plex Mono',monospace;paint-order:stroke;stroke:#000;stroke-width:4}" +
    ".vc-pxline{stroke:#38e0f0;stroke-dasharray:1 3;opacity:.6}.vc-dot{fill:#38e0f0;filter:drop-shadow(0 0 7px #38e0f0)}.vc-r3{fill:none;stroke:#38e0f0;stroke-width:1;opacity:.5}" +
    ".vc-r1,.vc-r2{fill:none;stroke:#38e0f0;stroke-width:1.5;opacity:0;transform-box:fill-box;transform-origin:center;animation:vcSonar 2.4s ease-out infinite}.vc-r2{animation-delay:1.2s}.vc-anchor.tick .vc-r1{animation:vcSonar .8s ease-out 3}" +
    "@keyframes vcSonar{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(3.4)}}" +
    ".vc-atag{fill:#9ff0ff;font:500 12px 'JetBrains Mono','IBM Plex Mono',monospace;paint-order:stroke;stroke:#000;stroke-width:3}.vc-axtag{fill:#000;stroke:#d9b46a}.vc-axtagt{fill:#ffe2a0;font:500 11.5px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".vc-ruler{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid #1a1a1a;border-top:0;border-radius:0 0 8px 8px;background:#000;font:11px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".vc-ru{padding:7px 10px;border-left:1px solid #1a1a1a;color:#c9d4e2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vc-ru:nth-child(odd){border-left:0}.vc-ru:nth-child(n+3){border-top:1px solid #1a1a1a}.vc-ru i{font-style:normal;color:#777;margin-right:4px}.vc-ru.s i{color:#e0655f}.vc-ru.r i{color:#3fb97f}" +
    "@media (prefers-reduced-motion:reduce){.vc-r1,.vc-r2{animation:none;opacity:.4}.vc-cone,.vc-wire{transition:none}.vc-roll.tick{animation:none}}" +
    "@media (max-width:900px){.vc-wrap{grid-template-columns:1fr}.vc-rail{border-right:0;border-bottom:1px solid #1a1a1a}.vc-tgs{flex-direction:row;flex-wrap:wrap;gap:8px 16px}.vc-ruler{grid-template-columns:1fr}.vc-ru{border-left:0;border-top:1px solid #1a1a1a}.vc-ru:first-child{border-top:0}.vc-cycle{margin-left:0}}";
  doc.head.appendChild(css);
  root.VCONE = { mount: mount, model: model };
})(window);
