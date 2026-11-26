/* pricechart.js — click any Market pulse tile -> its price chart (owner, Nov 24 2026).
   Chart: 5-year daily closes (history.json on the `history` branch, scripts/history.py) + today's live value from the tile,
   20/50/100/200-day moving averages drawn from those closes, ranges 1M · 3M · 1Y · 3Y · 5Y, crosshair readout.
   Right: the numbers (last, day move, range high/low, 52-week high/low, distance from each MA).
   Left: the desk pages linked to that market, sliding in like the section menu. Esc / Back / any menu click returns. */
(function () {
  "use strict";
  var root = window, doc = document;
  var REPO = (root.LIVE_CONFIG && root.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/history.json?ref=history", RAW = "https://raw.githubusercontent.com/" + REPO + "/history/history.json";
  var H = null, busy = false, err = "", V = { k: null, r: "1Y" };
  try { V.r = localStorage.getItem("desk.pc.range") || "1Y"; } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(a, b) { return a == null || b == null || !b ? null : (a / b - 1) * 100; }
  function sp(v, d, u) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }

  /* tile key -> chart: history series, how to show it, sibling keys (switcher), linked desk pages */
  var GRP = { grains: ["corn", "soybeans", "wheat"], crude: ["wti", "brent", "natgas", "brentwti"], ust: ["ust3M", "ust1Y", "ust2Y", "ust5Y", "ust10Y", "ust20Y", "ust30Y", "s2s10s"],
    metals: ["gold", "silver", "platinum", "palladium"], canada: ["ca2y", "ca10y", "usca2y", "usca10y"], risk: ["vix", "cugold"], policy: ["fed", "boc"], fx: ["usdcad", "dxy"] };
  /* link = [label, page, sub, menu, selector clicked once the page is up] — every link lands on the same market it was opened from */
  var PICK = function (k) { return '#grains-head [data-grain-pick="' + k + '"]'; }, WG = function (g) { return '[data-wgrp="' + g + '"]'; };
  var GRAIN_PAGES = function (k) { var N = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" }[k]; return [[N + " · overview", k, "overview", "grains"], [N + " · derivatives", k, "deriv", "grains"], [N + " · input costs", k, "inputs", "grains"], [N + " · fundamentals", k, "fund", "grains"], [N + " · forward prices", k, "prices", "grains"], [N + " · positioning / OI", "positioning", null, "positioning", PICK(k)], ["World markets · grains & softs", "world", null, "world", WG("grains")]]; };
  var FX_PAGES = [["USD/CAD · overview", "fx", "overview", "grains"], ["USD/CAD · derivatives", "fx", "deriv", "grains"], ["USD/CAD · yield spreads", "fx", "ysm", "grains"], ["USD/CAD · rates, policy & energy", "fx", "rates", "grains"], ["USD/CAD · forward rates", "fx", "fwd", "grains"], ["USD/CAD · positioning / OI", "positioning", null, "positioning", PICK("fx")], ["World markets · USD/CAD & the dollar", "world", null, "world", WG("usd")]];
  var C = {
    corn: { s: "corn", n: "Corn", u: "$/bu", d: 4, g: "grains", p: GRAIN_PAGES("corn") }, soybeans: { s: "soybeans", n: "Soybeans", u: "$/bu", d: 4, g: "grains", p: GRAIN_PAGES("soybeans") },
    wheat: { s: "wheat", n: "Wheat", u: "$/bu", d: 4, g: "grains", p: GRAIN_PAGES("wheat") },
    usdcad: { s: "usdcad", n: "USD/CAD", u: "CAD per USD", d: 4, g: "fx", p: FX_PAGES }, dxy: { s: "dxy", n: "US Dollar Index (DXY)", u: "index", d: 2, g: "fx", p: [["World markets · USD/CAD & the dollar", "world", null, "world", WG("usd")], ["World markets · DXY components", "world", null, "world", WG("majors")], ["USD/CAD · overview", "fx", "overview", "grains"]] },
    wti: { s: "wti", n: "WTI crude", u: "$/bbl", d: 2, g: "crude", p: [["USD/CAD · rates, policy & energy", "fx", "rates", "grains"], ["Corn · input costs", "corn", "inputs", "grains"], ["World markets · energy & fertilizer", "world", null, "world", WG("energy")]] },
    brent: { s: "brent", n: "Brent crude", u: "$/bbl", d: 2, g: "crude", p: [["USD/CAD · rates, policy & energy", "fx", "rates", "grains"], ["World markets · energy & fertilizer", "world", null, "world", WG("energy")]] },
    natgas: { s: "natgas", n: "Natural gas (Henry Hub)", u: "$/MMBtu", d: 3, g: "crude", p: [["Corn · input costs (fertilizer)", "corn", "inputs", "grains"], ["World markets · energy & fertilizer", "world", null, "world", WG("energy")]] },
    brentwti: { s: "brentwti", n: "Brent − WTI spread", u: "$/bbl", d: 2, g: "crude", p: [["USD/CAD · rates, policy & energy", "fx", "rates", "grains"], ["World markets · energy & fertilizer", "world", null, "world", WG("energy")]] },
    wcs: { s: null, n: "Western Canadian Select", u: "$/bbl", d: 2, g: "crude", p: [["USD/CAD · rates, policy & energy", "fx", "rates", "grains"]] },
    fed: { s: "fed_hi", n: "Fed funds target (upper bound)", u: "%", d: 2, g: "policy", p: [["Policy · Fed & BoC stance monitor", "policy", null, "policy"], ["World markets · Fed path & Treasuries", "world", null, "world", WG("ust")], ["US Treasury", "treasury", null, "treasury"]] },
    boc: { s: "boc", n: "Bank of Canada policy rate", u: "%", d: 2, g: "policy", p: [["Policy · Fed & BoC stance monitor", "policy", null, "policy"], ["World markets · US–Canada rate gap", "world", null, "world", WG("spread")], ["USD/CAD · yield spreads", "fx", "ysm", "grains"]] },
    vix: { s: "vix", n: "VIX", u: "index", d: 2, g: "risk", p: [["World markets · fear gauge (VIX)", "world", null, "world", WG("vol")], ["World markets · US markets", "usmkt", null, "world"]] },
    cugold: { s: "cugold", n: "Copper / gold ratio (×1000)", u: "ratio", d: 3, g: "risk", p: [["World markets · China & industrial metals", "world", null, "world", WG("indmet")], ["World markets · precious metals", "world", null, "world", WG("precious")]] },
    gold: { s: "gold", n: "Gold", u: "$/oz", d: 1, g: "metals", p: [["World markets · precious metals", "world", null, "world", WG("precious")], ["USD/CAD · mineral exports", "fx", "metals", "grains"]] },
    silver: { s: "silver", n: "Silver", u: "$/oz", d: 3, g: "metals", p: [["World markets · precious metals", "world", null, "world", WG("precious")], ["USD/CAD · mineral exports", "fx", "metals", "grains"]] },
    platinum: { s: "platinum", n: "Platinum", u: "$/oz", d: 1, g: "metals", p: [["World markets · precious metals", "world", null, "world", WG("precious")], ["USD/CAD · mineral exports", "fx", "metals", "grains"]] },
    palladium: { s: "palladium", n: "Palladium", u: "$/oz", d: 1, g: "metals", p: [["World markets · precious metals", "world", null, "world", WG("precious")], ["USD/CAD · mineral exports", "fx", "metals", "grains"]] },
    ca2y: { s: "ca2y", n: "Canada 2Y yield", u: "%", d: 3, g: "canada", p: [["USD/CAD · yield spreads", "fx", "ysm", "grains"], ["World markets · US–Canada rate gap", "world", null, "world", WG("spread")], ["Policy · Fed & BoC stance monitor", "policy", null, "policy"]] },
    ca10y: { s: "ca10y", n: "Canada 10Y yield", u: "%", d: 3, g: "canada", p: [["USD/CAD · yield spreads", "fx", "ysm", "grains"], ["World markets · US–Canada rate gap", "world", null, "world", WG("spread")], ["Policy · Fed & BoC stance monitor", "policy", null, "policy"]] },
    usca2y: { s: "usca2y", n: "US − Canada 2Y gap", u: "bp", d: 1, g: "canada", p: [["USD/CAD · yield spreads", "fx", "ysm", "grains"], ["World markets · US–Canada rate gap", "world", null, "world", WG("spread")], ["Policy · Fed & BoC stance monitor", "policy", null, "policy"]] },
    usca10y: { s: "usca10y", n: "US − Canada 10Y gap", u: "bp", d: 1, g: "canada", p: [["USD/CAD · yield spreads", "fx", "ysm", "grains"], ["World markets · US–Canada rate gap", "world", null, "world", WG("spread")], ["Policy · Fed & BoC stance monitor", "policy", null, "policy"]] },
    s2s10s: { s: "s2s10s", n: "US 2s10s curve", u: "bp", d: 1, g: "ust", p: [["US Treasury", "treasury", null, "treasury"], ["World markets · Fed path & Treasuries", "world", null, "world", WG("ust")], ["USD/CAD · yield spreads", "fx", "ysm", "grains"]] }
  };
  ["3M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"].forEach(function (t) { C["ust" + t] = { s: "ust" + t, n: "US " + t + " Treasury yield", u: "%", d: 3, g: "ust", p: [["US Treasury", "treasury", null, "treasury"], ["World markets · Fed path & Treasuries", "world", null, "world", WG("ust")], ["USD/CAD · yield spreads", "fx", "ysm", "grains"]] }; });
  var SHORT = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat", usdcad: "USD/CAD", dxy: "DXY", wti: "WTI", brent: "Brent", natgas: "Nat gas", brentwti: "Brent−WTI", fed: "Fed funds", boc: "BoC",
    vix: "VIX", cugold: "Cu/Gold", gold: "Gold", silver: "Silver", platinum: "Platinum", palladium: "Palladium", ca2y: "CA 2Y", ca10y: "CA 10Y", usca2y: "US−CA 2Y", usca10y: "US−CA 10Y", s2s10s: "2s10s",
    ust3M: "3M", ust1Y: "1Y", ust2Y: "2Y", ust5Y: "5Y", ust10Y: "10Y", ust20Y: "20Y", ust30Y: "30Y" };
  ["spx", "ixic", "dji", "rut"].forEach(function (k) { C[k] = { s: k, n: { spx: "S&P 500", ixic: "Nasdaq Composite", dji: "Dow Jones Industrial Average", rut: "Russell 2000" }[k], u: "index", d: 2, g: "eq",
    p: [["World markets · US & Canada stocks", "world", null, "world", WG("namer")], ["World markets · US markets (sectors)", "usmkt", null, "world"], ["Breakouts · indexes", "breakouts", null, "breakouts"]] }; });
  GRP.eq = ["spx", "ixic", "dji", "rut", "vix"]; C.vix.g = "eq";
  SHORT.spx = "S&P 500"; SHORT.ixic = "Nasdaq"; SHORT.dji = "Dow"; SHORT.rut = "Russell";
  /* grain relationships (Nov 26 2026): from the same daily closes; no live point (oil and meal are not in the live feed) */
  var GPX = function (k) { return GRAIN_PAGES(k).slice(0, 6); };
  C.wheatcorn = { s: "wheatcorn", n: "Wheat − corn spread", u: "$/bu", d: 4, g: "grains", p: GPX("wheat").slice(0, 1).concat(GPX("corn").slice(0, 1)) };
  C.soycorn = { s: "soycorn", n: "Soybean / corn ratio", u: "ratio", d: 3, g: "grains", p: GPX("soybeans").slice(0, 1).concat(GPX("corn").slice(0, 1)) };
  C.crush = { s: "crush", n: "Soybean board crush", u: "$/bu", d: 2, g: "grains", p: [["Soybeans · overview", "soybeans", "overview", "grains"], ["Soybeans · fundamentals", "soybeans", "fund", "grains"], ["Soybeans · positioning / OI", "positioning", null, "positioning", PICK("soybeans")]] };
  C.soyoil = { s: "soyoil", n: "Soybean oil", u: "¢/lb", d: 2, g: "grains", p: C.crush.p };
  C.soymeal = { s: "soymeal", n: "Soybean meal", u: "$/short ton", d: 1, g: "grains", p: C.crush.p };
  GRP.grains = ["corn", "soybeans", "wheat", "wheatcorn", "soycorn", "crush", "soyoil", "soymeal"];
  SHORT.wheatcorn = "Wheat−Corn"; SHORT.soycorn = "Soy/Corn"; SHORT.crush = "Crush"; SHORT.soyoil = "Soy oil"; SHORT.soymeal = "Soy meal";
  /* bushels per tonne (CGC / USDA): for the cash price in C$/t */
  var BUT = { corn: 39.3679, soybeans: 36.7437, wheat: 36.7437 };
  function store(key, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(key) || "null"); localStorage.setItem(key, JSON.stringify(v)); } catch (e) { return null; } }
  var ALERTS = store("desk.pc.alerts") || {}, BASIS = store("desk.pc.basis") || {}, OV = store("desk.pc.ov") || { seas: false };
  var RANGES = [["1M", 31], ["3M", 92], ["1Y", 366], ["3Y", 1096], ["5Y", 1827]];
  var MAS = [[20, "#e3c14d"], [50, "#38b6c9"], [100, "#b98bf0"], [200, "#ff8a5c"]];

  function load(cb) {
    if (H) return cb && cb(); if (busy) return; busy = true;
    fetch(API, { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); })
      .then(function (j) { H = j; err = ""; busy = false; cb && cb(); }).catch(function () { err = "Price history is not available right now — retrying shortly."; busy = false; cb && cb(); setTimeout(function () { load(paint); }, 30000); });
  }
  function live(k) { var t = doc.querySelector('#pulse-bar [data-pc="' + k + '"]'); if (!t) return null;
    if (t.classList.contains("pb-old")) return { v: null, chg: "", txt: "", up: false, dn: false, tip: "" };   /* market closed today: no point is added for today */
    var v = parseFloat(t.getAttribute("data-pv")), i = t.querySelector("i"), b = t.querySelector("b");
    return { v: isFinite(v) ? v : null, chg: i ? i.textContent : "", txt: b ? b.textContent : "", up: t.classList.contains("up"), dn: t.classList.contains("dn"), tip: t.getAttribute("title") || "" }; }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }
  function series(k) {
    var c = C[k], S = c && c.s && H && H.series && H.series[c.s]; if (!S || !S.d || !S.d.length) return null;
    var d = S.d.slice(), L = live(k), t = today();
    if (L && L.v != null && d.length) { if (d[d.length - 1][0] < t) d.push([t, L.v, 1]); else if (d[d.length - 1][0] === t) d[d.length - 1] = [t, L.v, 1]; }
    return { d: d, src: S.src, name: S.name };
  }
  function ma(d, i, n) { if (i + 1 < n) return null; var s = 0; for (var j = i - n + 1; j <= i; j++) s += d[j][1]; return s / n; }

  function chart(k, S) {
    var c = C[k], days = (RANGES.filter(function (r) { return r[0] === V.r; })[0] || RANGES[2])[1], t0 = Date.now() - days * 864e5;
    var d = S.d, i0 = 0; while (i0 < d.length - 1 && Date.parse(d[i0][0] + "T12:00:00Z") < t0) i0++;
    var P = [], M = {}; MAS.forEach(function (m) { M[m[0]] = []; });
    for (var i = i0; i < d.length; i++) { P.push([Date.parse(d[i][0] + "T12:00:00Z"), d[i][1]]); MAS.forEach(function (m) { var v = ma(d, i, m[0]); M[m[0]].push(v == null ? null : [P[P.length - 1][0], v]); }); }
    if (P.length < 2) return '<p class="note">Not enough history for this range.</p>';
    var all = P.map(function (p) { return p[1]; }); MAS.forEach(function (m) { M[m[0]].forEach(function (p) { if (p) all.push(p[1]); }); });
    var SE = OV.seas && days <= 366 ? seasonal(d, P) : null, bs = BUT[k] && BASIS[k] != null ? BASIS[k] / 100 : null, CA = bs != null ? P.map(function (p) { return [p[0], p[1] + bs]; }) : null, AL = ALERTS[k] || [];
    if (SE) SE.forEach(function (p) { all.push(p[1]); }); if (CA) CA.forEach(function (p) { all.push(p[1]); }); AL.forEach(function (a) { all.push(a.lv); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.02 || 1; lo -= pad; hi += pad;
    var W = 900, Hh = 380, L = 58, R = 64, T = 14, B = 30, x = function (t) { return L + (t - P[0][0]) / (P[P.length - 1][0] - P[0][0]) * (W - L - R); }, y = function (v) { return T + (hi - v) / (hi - lo) * (Hh - T - B); };
    var path = function (A) { var s = "", on = false; A.forEach(function (p) { if (!p) { on = false; return; } s += (on ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); on = true; }); return s; };
    var g = "", n = 5; for (var q = 0; q <= n; q++) { var v = lo + (hi - lo) * q / n; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="pc-gl"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" class="pc-yl">' + nf(v, c.d > 2 ? 2 : c.d) + "</text>"; }
    var xt = "", ticks = 6; for (var z = 0; z <= ticks; z++) { var tt = P[0][0] + (P[P.length - 1][0] - P[0][0]) * z / ticks; xt += '<text x="' + x(tt) + '" y="' + (Hh - 9) + '" class="pc-xl">' + new Date(tt).toLocaleDateString("en-US", days > 200 ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }) + "</text>"; }
    var up = P[P.length - 1][1] >= P[0][1], last = P[P.length - 1];
    var area = path(P) + "L" + x(last[0]).toFixed(1) + "," + (Hh - B) + "L" + x(P[0][0]).toFixed(1) + "," + (Hh - B) + "Z";
    var mal = MAS.map(function (m) { return '<path d="' + path(M[m[0]]) + '" class="pc-ma" style="stroke:' + m[1] + '"/>'; }).join("") +
      (SE ? '<path d="' + path(SE) + '" class="pc-seas"/>' : "") + (CA ? '<path d="' + path(CA) + '" class="pc-cash"/>' : "") +
      AL.map(function (a) { return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(a.lv) + '" y2="' + y(a.lv) + '" class="pc-al' + (a.hit ? " hit" : "") + '"/><text x="' + (L + 4) + '" y="' + (y(a.lv) - 4) + '" class="pc-alt">🔔 ' + (a.dir > 0 ? "above " : "below ") + nf(a.lv, c.d) + "</text>"; }).join("");
    return '<svg viewBox="0 0 ' + W + " " + Hh + '" class="pc-svg xh-off" data-pc-chart="' + k + '" preserveAspectRatio="none">' + g + xt +
      '<path d="' + area + '" class="pc-area ' + (up ? "up" : "dn") + '"/>' + mal + '<path d="' + path(P) + '" class="pc-px ' + (up ? "up" : "dn") + '"/>' +
      '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="4" class="pc-dot ' + (up ? "up" : "dn") + '"/><rect x="' + (W - R + 4) + '" y="' + (y(last[1]) - 10) + '" width="' + (R - 6) + '" height="20" rx="4" class="pc-tag ' + (up ? "up" : "dn") + '"/>' +
      '<text x="' + (W - R + 4 + (R - 6) / 2) + '" y="' + (y(last[1]) + 4) + '" class="pc-tagt">' + nf(last[1], c.d > 2 ? 2 : c.d) + "</text>" +
      '<line class="pc-xh" x1="0" x2="0" y1="' + T + '" y2="' + (Hh - B) + '" style="display:none"/></svg>' +
      '<div class="pc-tip" style="display:none"></div>' +
      '<script type="application/json" class="pc-data">' + JSON.stringify({ P: P, M: MAS.map(function (m) { return M[m[0]].map(function (p) { return p ? p[1] : null; }); }), L: L, R: R, W: W, d: c.d }).replace(/</g, "\\u003c") + "</script>";
  }
  /* seasonal: the same calendar window in each of the past 5 years, as % paths from the window's start, averaged and laid
     on the current range's starting price — "what this time of year usually does", not a forecast */
  function seasonal(d, P) {
    var span = P[P.length - 1][0] - P[0][0], paths = [], byT = d.map(function (r) { return [Date.parse(r[0] + "T12:00:00Z"), r[1]]; });
    for (var yb = 1; yb <= 5; yb++) {
      var s0 = P[0][0] - yb * 365.25 * 864e5, s1 = s0 + span, seg = byT.filter(function (p) { return p[0] >= s0 && p[0] <= s1; });
      if (seg.length > 10) paths.push(seg.map(function (p) { return [(p[0] - s0) / span, p[1] / seg[0][1] - 1]; }));
    }
    if (paths.length < 3) return null;
    var out = [], N = 60; for (var i = 0; i <= N; i++) { var f = i / N, v = 0;
      paths.forEach(function (pp) { var j = 0; while (j < pp.length - 1 && pp[j + 1][0] < f) j++; v += pp[j][1]; });
      out.push([P[0][0] + f * span, P[0][1] * (1 + v / paths.length)]); }
    return out;
  }
  /* correlation of daily changes (returns; bp changes for rates) over the last n sessions, on common dates */
  function corr(a, b, n, ra, rb) {
    var B = {}; b.forEach(function (r) { B[r[0]] = r[1]; });
    var x = [], y = []; for (var i = 1; i < a.length; i++) { var d0 = a[i - 1][0], d1 = a[i][0]; if (B[d0] == null || B[d1] == null) continue;
      x.push(ra ? a[i][1] - a[i - 1][1] : a[i][1] / a[i - 1][1] - 1); y.push(rb ? B[d1] - B[d0] : B[d1] / B[d0] - 1); }
    x = x.slice(-n); y = y.slice(-n); if (x.length < n * 0.7) return null;
    var mx = x.reduce(function (s0, v) { return s0 + v; }, 0) / x.length, my = y.reduce(function (s0, v) { return s0 + v; }, 0) / y.length, sxy = 0, sxx = 0, syy = 0;
    for (var j = 0; j < x.length; j++) { sxy += (x[j] - mx) * (y[j] - my); sxx += (x[j] - mx) * (x[j] - mx); syy += (y[j] - my) * (y[j] - my); }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  function corrHTML(k) {
    var c = C[k], A = H.series[c.s]; if (!A) return "";
    var isR = function (key) { var q = C[key]; return q && /%|bp/.test(q.u); };
    var drv = ["usdcad", "dxy", "wti", "spx", "ust10Y", "gold"].filter(function (z) { return z !== k && C[z] && H.series[C[z].s]; });
    var rows = drv.map(function (z) { var r30 = corr(A.d, H.series[C[z].s].d, 30, isR(k), isR(z)), r90 = corr(A.d, H.series[C[z].s].d, 90, isR(k), isR(z));
      if (r30 == null && r90 == null) return "";
      var cl = function (r) { return r == null ? "" : r > 0.3 ? "up" : r < -0.3 ? "dn" : ""; }, f = function (r) { return r == null ? "—" : (r >= 0 ? "+" : "−") + Math.abs(r).toFixed(2); };
      return '<div class="pc-cr"><span>' + SHORT[z] + '</span><b class="' + cl(r30) + '">' + f(r30) + '</b><b class="' + cl(r90) + '">' + f(r90) + "</b></div>"; }).join("");
    return rows ? '<div class="pc-sub">Correlation <small>daily moves · 30D / 90D</small></div><div class="pc-cr pc-crh"><span></span><i>30D</i><i>90D</i></div>' + rows +
      '<div class="pc-src">+1 moves together, −1 moves opposite, near 0 unrelated. For context, not a trading signal.</div>' : "";
  }
  /* cash price from a basis the desk types in (¢/bu over/under the futures shown) — stays in this browser */
  function cashHTML(k, last) {
    if (!BUT[k]) return "";
    var b = BASIS[k], fx = live("usdcad"), r = fx && fx.v, cash = b != null ? last + b / 100 : null;
    return '<div class="pc-sub">Cash price <small>futures + your basis</small></div>' +
      '<div class="pc-bs"><label>Basis ¢/bu <input type="number" step="0.25" inputmode="decimal" data-pcbasis="' + k + '" value="' + (b != null ? b : "") + '" placeholder="e.g. -35"></label></div>' +
      (cash != null ? '<div class="pc-kv"><span>Cash (US$/bu)</span><b>' + nf(cash, 4) + "</b></div>" + (r ? '<div class="pc-kv"><span>Cash (C$/bu)</span><b>' + nf(cash * r, 4) + '</b></div><div class="pc-kv"><span>Cash (C$/t)</span><b>' + nf(cash * r * BUT[k], 2) + "</b></div>" : "") +
        '<div class="pc-src">Chart dashed line = futures + basis ' + (b >= 0 ? "+" : "") + nf(b, 2) + "¢ (constant). USD/CAD " + (r ? nf(r, 4) : "—") + " from the band.</div>" : '<div class="pc-src">Type your local basis to see the cash bid in US$/bu, C$/bu and C$/t, and draw it on the chart.</div>');
  }
  function alertHTML(k) {
    var L = ALERTS[k] || [], c = C[k];
    return '<div class="pc-sub">Price alerts <small>this browser</small></div>' +
      '<div class="pc-bs"><select data-pcadir="' + k + '"><option value="1">Above</option><option value="-1">Below</option></select><input type="number" step="any" data-pcalv="' + k + '" placeholder="level"><button type="button" data-pcadd="' + k + '">Add</button></div>' +
      L.map(function (a, i) { return '<div class="pc-kv pc-alr' + (a.hit ? " hit" : "") + '"><span>🔔 ' + (a.dir > 0 ? "Above" : "Below") + " " + nf(a.lv, c.d) + (a.hit ? " · hit " + esc(a.hit) : "") + '</span><button type="button" data-pcdel="' + k + "|" + i + '" aria-label="Remove alert">×</button></div>'; }).join("");
  }
  function stats(k, S) {
    var c = C[k], d = S.d, n = d.length, last = d[n - 1][1], prev = n > 1 ? d[n - 2][1] : null, Lv = live(k);
    var days = (RANGES.filter(function (r) { return r[0] === V.r; })[0] || RANGES[2])[1], t0 = Date.now() - days * 864e5, inR = d.filter(function (p) { return Date.parse(p[0] + "T12:00:00Z") >= t0; });
    var y1 = d.filter(function (p) { return Date.parse(p[0] + "T12:00:00Z") >= Date.now() - 365 * 864e5; }).map(function (p) { return p[1]; });
    var rv = inR.map(function (p) { return p[1]; }), first = inR.length ? inR[0][1] : null, isRate = /%|bp/.test(c.u);
    var mv = function (a, b) { return isRate ? sp((a - b) * (c.u === "%" ? 100 : 1), 1, " bp") : sp(pct(a, b), 2, "%"); };
    var row = function (l, v, cl) { return '<div class="pc-kv"><span>' + l + '</span><b class="' + (cl || "") + '">' + v + "</b></div>"; };
    var maRows = MAS.map(function (m) { var v = ma(d, n - 1, m[0]); if (v == null) return ""; var ab = last >= v;
      return '<div class="pc-ma-r ' + (ab ? "ab" : "bl") + '"><i style="background:' + m[1] + '"></i><span>' + m[0] + "-day MA</span><b>" + nf(v, c.d) + "</b><em>" + (ab ? "Above" : "Below") + " · " + mv(last, v) + "</em></div>"; }).join("");
    return '<div class="pc-big ' + (Lv && Lv.dn ? "dn" : Lv && Lv.up ? "up" : "") + '"><span>' + esc(c.n) + ' <small>' + esc(c.u) + "</small></span><b>" + nf(last, c.d) + (c.u === "%" ? "%" : c.u === "bp" ? " bp" : "") + "</b><i>" + esc(Lv ? Lv.chg : (prev != null ? mv(last, prev) : "")) + "</i></div>" +
      row(V.r + " change", first != null ? mv(last, first) : "—", first != null ? (last >= first ? "up" : "dn") : "") +
      row(V.r + " high", nf(Math.max.apply(null, rv), c.d)) + row(V.r + " low", nf(Math.min.apply(null, rv), c.d)) +
      row("52-week high", y1.length ? nf(Math.max.apply(null, y1), c.d) : "—") + row("52-week low", y1.length ? nf(Math.min.apply(null, y1), c.d) : "—") +
      '<div class="pc-sub">Moving averages <small>daily closes</small></div>' + maRows + cashHTML(k, last) + alertHTML(k) + corrHTML(k) +
      '<div class="pc-src">' + esc(S.src) + " · daily closes to " + esc(H.series[c.s].d[H.series[c.s].d.length - 1][0]) + (d[n - 1][2] ? " · last point = live tile value" : "") + "</div>";
  }
  function maChips(k, S) {
    var d = S.d, n = d.length, last = d[n - 1][1], c = C[k];
    return MAS.map(function (m) { var v = ma(d, n - 1, m[0]); if (v == null) return ""; var ab = last >= v;
      return '<span class="pc-chip ' + (ab ? "ab" : "bl") + '"><i style="background:' + m[1] + '"></i>' + (ab ? "▲ Above" : "▼ Below") + " " + m[0] + "D MA <b>" + nf(v, c.d) + "</b></span>"; }).join("");
  }
  function view() {
    var k = V.k, c = C[k]; if (!c) return "";
    var sw = (GRP[c.g] || [k]).map(function (x) { return '<button type="button" data-pck="' + x + '" aria-pressed="' + (x === k) + '">' + SHORT[x] + "</button>"; }).join("");
    var nav = '<nav class="pc-nav"><div class="pc-nh">' + esc(c.n) + '</div><button type="button" class="pc-back" data-pcx>← Back</button>' +
      c.p.map(function (p, i) { return '<button type="button" class="pc-link" style="animation-delay:' + (i * 55) + 'ms" data-pcgo="' + esc(p.slice(1).map(function (v) { return v || ""; }).join("|")) + '">' + esc(p[0]) + "</button>"; }).join("") + "</nav>";
    var S = series(k), body;
    if (!c.s) body = '<div class="pc-main"><p class="note">The desk has no free daily history for ' + esc(c.n) + " — the live quote is in the band above.</p></div>";
    else if (!H) body = '<div class="pc-main"><p class="note">' + (err || "Loading five years of daily prices…") + "</p></div>";
    else if (!S) body = '<div class="pc-main"><p class="note">No history for ' + esc(c.n) + " in the last server run" + (H.errors && H.errors[c.s] ? " (" + esc(H.errors[c.s]) + ")" : "") + ".</p></div>";
    else body = '<div class="pc-main"><div class="pc-top"><div class="pc-sw">' + sw + '</div><div class="pc-rg">' + RANGES.map(function (r) { return '<button type="button" data-pcr="' + r[0] + '" aria-pressed="' + (V.r === r[0]) + '">' + r[0] + "</button>"; }).join("") +
        '<button type="button" class="pc-ovb" data-pcov="seas" aria-pressed="' + !!OV.seas + '" title="Average path of the same weeks over the last 5 years (ranges up to 1Y)">5Y seasonal</button></div></div>' +
      '<div class="pc-chips">' + maChips(k, S) + '</div><div class="pc-cw">' + chart(k, S) + '</div><div class="pc-leg"><span><i class="pc-lp"></i>Price</span>' + MAS.map(function (m) { return '<span><i style="background:' + m[1] + '"></i>' + m[0] + "-day MA</span>"; }).join("") +
        (OV.seas ? '<span><i class="pc-ls"></i>5Y seasonal average</span>' : "") + (BUT[k] && BASIS[k] != null ? '<span><i class="pc-lc"></i>Cash (futures + basis)</span>' : "") + ((ALERTS[k] || []).length ? '<span><i class="pc-la"></i>Alert level</span>' : "") + "</div></div>" +
      '<aside class="pc-side">' + stats(k, S) + "</aside>";
    return nav + body;
  }
  function paint() {
    var E = doc.getElementById("pc-view"); if (!E || !V.k) return;
    var ae = doc.activeElement; if (ae && ae.closest && ae.closest("#pc-view .pc-bs")) return;   /* never redraw under someone typing a basis or an alert level */
    var h = view(); if (E._h !== h) { E.innerHTML = h; E._h = h; }
  }
  function open(k) {
    if (!C[k]) return; V.k = k;
    var E = doc.getElementById("pc-view"), m = doc.querySelector("main");
    if (!E) { E = doc.createElement("section"); E.id = "pc-view"; E.className = "no-tx"; m.parentNode.insertBefore(E, m); }
    E._h = ""; doc.body.classList.add("pc-open"); paint(); scrollTo(0, 0);
    load(paint);
  }
  function repaint() { var E = doc.getElementById("pc-view"), ae = doc.activeElement; if (ae && ae.blur && E && E.contains(ae)) ae.blur(); if (E) E._h = ""; paint(); marks(); }
  doc.addEventListener("change", function (e) { var t = e.target; if (!t.getAttribute) return; var k = t.getAttribute("data-pcbasis"); if (!k) return;
    var v = parseFloat(t.value); if (isFinite(v)) BASIS[k] = v; else delete BASIS[k]; store("desk.pc.basis", BASIS); repaint(); });
  /* alerts: checked against the live tile values; each fires once (toast + bell on the tile), stays listed as "hit" until removed */
  function marks() { [].forEach.call(doc.querySelectorAll("#pulse-bar [data-pc]"), function (t) { var L = ALERTS[t.getAttribute("data-pc")] || []; t.classList.toggle("pb-al", L.some(function (a) { return !a.hit; })); t.classList.toggle("pb-alhit", L.some(function (a) { return a.hit; })); }); }
  function toast(msg) { var T0 = doc.getElementById("pc-toasts"); if (!T0) { T0 = doc.createElement("div"); T0.id = "pc-toasts"; doc.body.appendChild(T0); }
    var n = doc.createElement("div"); n.className = "pc-toast"; n.textContent = msg; n.title = "Click to dismiss"; n.onclick = function () { n.remove(); }; T0.appendChild(n); setTimeout(function () { n.remove(); }, 60000); }
  function checkAlerts() {
    var ch = false; Object.keys(ALERTS).forEach(function (k) { var Lv = live(k); if (!Lv || Lv.v == null) return;
      ALERTS[k].forEach(function (a) { if (a.hit) return; if ((a.dir > 0 && Lv.v >= a.lv) || (a.dir < 0 && Lv.v <= a.lv)) {
        a.hit = new Date().toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; ch = true;
        toast("🔔 " + (C[k] ? C[k].n : k) + " " + (a.dir > 0 ? "above " : "below ") + nf(a.lv, C[k] ? C[k].d : 2) + " — now " + nf(Lv.v, C[k] ? C[k].d : 2) + " · " + a.hit); } }); });
    if (ch) { store("desk.pc.alerts", ALERTS); if (V.k) repaint(); } marks();
  }
  setInterval(checkAlerts, 15000); setTimeout(checkAlerts, 6000);
  function close() { V.k = null; doc.body.classList.remove("pc-open");  }
  doc.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#pulse-bar [data-pc]");
    if (t) { e.preventDefault(); e.stopPropagation(); var tk = t.getAttribute("data-pc");
      /* on a grain / USD/CAD / Positioning page a grain or USD/CAD tile switches the commodity in place — same report, same section */
      if (!V.k && root.PULSE_PICK && PULSE_PICK(tk)) return;
      open(tk); return; }
    if (!V.k) return;
    var b;
    if ((b = e.target.closest("[data-pck]"))) { open(b.getAttribute("data-pck")); return; }
    if ((b = e.target.closest("[data-pcr]"))) { V.r = b.getAttribute("data-pcr"); try { localStorage.setItem("desk.pc.range", V.r); } catch (x) {} doc.getElementById("pc-view")._h = ""; paint(); return; }
    if (e.target.closest("[data-pcx]")) { close(); return; }
    if ((b = e.target.closest("[data-pcov]"))) { OV.seas = !OV.seas; store("desk.pc.ov", OV); repaint(); return; }
    if ((b = e.target.closest("[data-pcadd]"))) { var ak = b.getAttribute("data-pcadd"), lvI = doc.querySelector('[data-pcalv="' + ak + '"]'), lv = parseFloat(lvI && lvI.value), dir = +(doc.querySelector('[data-pcadir="' + ak + '"]') || {}).value || 1;
      if (isFinite(lv)) { (ALERTS[ak] = ALERTS[ak] || []).push({ lv: lv, dir: dir }); store("desk.pc.alerts", ALERTS); repaint(); } return; }
    if ((b = e.target.closest("[data-pcdel]"))) { var dp = b.getAttribute("data-pcdel").split("|"); (ALERTS[dp[0]] || []).splice(+dp[1], 1); store("desk.pc.alerts", ALERTS); repaint(); return; }
    if ((b = e.target.closest("[data-pcgo]"))) { var p = b.getAttribute("data-pcgo").split("|"), k = V.k; close();
      if (/^(corn|soybeans|wheat)$/.test(k)) { try { localStorage.setItem("desk.grain", k); } catch (x) {} }
      if (/^(corn|soybeans|wheat)$/.test(p[0])) { var gb0 = doc.querySelector('[data-gnav="grains"]'); if (gb0) gb0.click(); var tb0 = doc.getElementById("tabbtn-" + p[0]); if (tb0) tb0.click(); }   /* DESK_NAV keeps the grain on screen — pin the one asked for */
      if (root.DESK_NAV && DESK_NAV.go) DESK_NAV.go(p[0], p[1] || null, p[2] || null); else { var g = doc.querySelector('[data-gnav="' + p[2] + '"]'); if (g) g.click(); }
      if (p[3]) { var n = 0; (function then() { var el = /grains-head/.test(p[3]) ? doc.querySelector(p[3]) : [].filter.call(doc.querySelectorAll(p[3]), function (x) { return !x.closest("#pc-view"); }).sort(function (a, b) { return (b.offsetParent ? 1 : 0) - (a.offsetParent ? 1 : 0); })[0];   /* land on the same market: pick it on the page */
        if (el) { if (el.getAttribute("aria-pressed") !== "true" && el.getAttribute("aria-selected") !== "true") el.click(); } else if (++n < 30) setTimeout(then, 150); })(); }
      scrollTo(0, 0); return; }
    if (e.target.closest("#gnav [data-gnav], .tabs [role=tab], #sn, .subbtn, [data-sub], .st-b, .sn-b, .tab-btn")) close();   /* any menu / side-menu / sub-menu click leaves the chart */
  }, true);
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && V.k) close(); if ((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("#pulse-bar [data-pc]")) { e.preventDefault(); open(e.target.closest("[data-pc]").getAttribute("data-pc")); } });
  /* crosshair readout */
  doc.addEventListener("mousemove", function (e) {
    var svg = e.target.closest && e.target.closest(".pc-svg"); var w = doc.querySelector(".pc-cw"); if (!w) return; var tip = w.querySelector(".pc-tip"), xh = w.querySelector(".pc-xh");
    if (!svg) { if (tip) tip.style.display = "none"; if (xh) xh.style.display = "none"; return; }
    var D = svg._d || (svg._d = JSON.parse(w.querySelector(".pc-data").textContent)), r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * D.W;
    var f = (vx - D.L) / (D.W - D.L - D.R); if (f < 0 || f > 1) { tip.style.display = "none"; xh.style.display = "none"; return; }
    var t = D.P[0][0] + f * (D.P[D.P.length - 1][0] - D.P[0][0]), i = 0, best = Infinity; D.P.forEach(function (p, j) { var dd = Math.abs(p[0] - t); if (dd < best) { best = dd; i = j; } });
    var X = D.L + (D.P[i][0] - D.P[0][0]) / (D.P[D.P.length - 1][0] - D.P[0][0]) * (D.W - D.L - D.R); xh.setAttribute("x1", X); xh.setAttribute("x2", X); xh.style.display = "";
    tip.innerHTML = "<b>" + new Date(D.P[i][0]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) + "</b><span>Close " + nf(D.P[i][1], D.d) + "</span>" +
      MAS.map(function (m, j) { var v = D.M[j][i]; return v == null ? "" : '<span><i style="background:' + m[1] + '"></i>' + m[0] + "D " + nf(v, D.d) + "</span>"; }).join("");
    tip.style.display = ""; var px = X / D.W * r.width; tip.style.left = Math.min(r.width - 170, Math.max(0, px + 12)) + "px";
  });
  setInterval(function () { if (V.k && H) paint(); }, 15000);   /* the last point follows the live tile */

  var st = doc.createElement("style");
  st.textContent =
    "body.pc-open main,body.pc-open .gsub,body.pc-open nav.tabs{display:none!important}" +
    "#pc-view{display:none}body.pc-open #pc-view{display:grid;grid-template-columns:200px minmax(0,1fr) 270px;gap:14px;max-width:1888px;margin:12px auto 24px;width:calc(100% - 32px);align-items:start}" +
    ".pc-nav{display:flex;flex-direction:column;gap:5px;position:sticky;top:calc(var(--strip-h,140px) + 56px)}.pc-nh{font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#d9b46a;border-left:3px solid #d9b46a;padding:2px 0 2px 8px;margin-bottom:4px}" +
    ".pc-back,.pc-link{appearance:none;text-align:left;border:1px solid var(--line2);background:rgba(255,255,255,.03);color:var(--ink);border-radius:8px;padding:8px 11px;font:600 13px 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer}" +
    ".pc-back{color:var(--muted);font-weight:500}.pc-link{animation:pcIn .38s cubic-bezier(.2,.8,.2,1) both}.pc-link:hover,.pc-back:hover{border-color:#d9b46a;color:#d9b46a}@keyframes pcIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}" +
    ".pc-main{border:1px solid var(--line2);border-radius:12px;background:rgba(255,255,255,.02);padding:12px 14px;min-width:0}.pc-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:8px}" +
    ".pc-sw,.pc-rg{display:inline-flex;flex-wrap:wrap;gap:3px}.pc-sw button,.pc-rg button{appearance:none;border:1px solid var(--line2);background:transparent;color:var(--muted);border-radius:7px;padding:5px 10px;font:600 12px 'IBM Plex Mono',monospace;cursor:pointer}" +
    ".pc-sw button[aria-pressed=true]{border-color:#d9b46a;color:#d9b46a;background:rgba(217,180,106,.10)}.pc-rg button[aria-pressed=true]{background:#d9b46a;border-color:#d9b46a;color:#111}" +
    ".pc-chips{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 8px}.pc-chip{display:inline-flex;align-items:center;gap:5px;font:600 11.5px 'IBM Plex Mono',monospace;padding:3px 8px;border-radius:999px;border:1px solid}.pc-chip i{width:9px;height:3px;border-radius:2px}" +
    ".pc-chip.ab{color:#3fb97f;border-color:rgba(63,185,127,.45);background:rgba(63,185,127,.10)}.pc-chip.bl{color:#ff6b62;border-color:rgba(255,107,98,.45);background:rgba(255,107,98,.10)}.pc-chip b{color:var(--ink)}" +
    ".pc-cw{position:relative}.pc-svg{width:100%;height:380px;display:block;overflow:visible}.pc-gl{stroke:var(--line);stroke-width:1}.pc-yl{fill:var(--faint);font:10.5px 'IBM Plex Mono',monospace;text-anchor:end}.pc-xl{fill:var(--faint);font:10.5px 'IBM Plex Mono',monospace;text-anchor:middle}" +
    ".pc-px{fill:none;stroke-width:2;vector-effect:non-scaling-stroke}.pc-px.up{stroke:#3fb97f}.pc-px.dn{stroke:#ff6b62}.pc-area.up{fill:rgba(63,185,127,.08)}.pc-area.dn{fill:rgba(255,107,98,.08)}.pc-ma{fill:none;stroke-width:1.3;vector-effect:non-scaling-stroke;opacity:.9}" +
    ".pc-dot.up{fill:#3fb97f}.pc-dot.dn{fill:#ff6b62}.pc-tag.up{fill:#3fb97f}.pc-tag.dn{fill:#ff6b62}.pc-tagt{fill:#08110c;font:700 11px 'IBM Plex Mono',monospace;text-anchor:middle}.pc-xh{stroke:var(--muted);stroke-dasharray:3 3;vector-effect:non-scaling-stroke}" +
    ".pc-tip{position:absolute;top:10px;min-width:150px;background:rgba(8,12,18,.95);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font:11.5px 'IBM Plex Mono',monospace;display:flex;flex-direction:column;gap:2px;pointer-events:none;color:var(--ink)}.pc-tip i{display:inline-block;width:9px;height:3px;margin-right:5px;vertical-align:middle}" +
    ".pc-leg{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;font:11.5px 'IBM Plex Sans',sans-serif;color:var(--muted)}.pc-leg i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}.pc-lp{background:var(--ink)}" +
    ".pc-side{border:1px solid var(--line2);border-radius:12px;background:rgba(255,255,255,.02);padding:12px 14px;display:flex;flex-direction:column;gap:6px;position:sticky;top:calc(var(--strip-h,140px) + 56px)}" +
    ".pc-big{border-radius:9px;padding:9px 10px;border:1px solid var(--line2);display:flex;flex-direction:column;gap:2px;margin-bottom:4px}.pc-big.up{background:rgba(63,185,127,.10);border-color:rgba(63,185,127,.4)}.pc-big.dn{background:rgba(255,107,98,.10);border-color:rgba(255,107,98,.4)}" +
    ".pc-big span{font:600 11px 'IBM Plex Mono',monospace;color:var(--muted);text-transform:uppercase}.pc-big small{text-transform:none;color:var(--faint)}.pc-big b{font:700 24px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.pc-big i{font:600 12px 'IBM Plex Mono',monospace;font-style:normal}.pc-big.up i{color:#3fb97f}.pc-big.dn i{color:#ff6b62}" +
    ".pc-kv{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:3px 0;border-bottom:1px dashed var(--line)}.pc-kv span{color:var(--muted)}.pc-kv b{font:600 12.5px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.pc-kv b.up{color:#3fb97f}.pc-kv b.dn{color:#ff6b62}" +
    ".pc-sub{margin-top:6px;font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#d9b46a}.pc-sub small{text-transform:none;letter-spacing:0;color:var(--faint);font-weight:400}" +
    ".pc-ma-r{display:grid;grid-template-columns:12px 1fr auto;gap:2px 6px;align-items:center;font-size:12px;padding:3px 0}.pc-ma-r i{width:10px;height:3px;border-radius:2px}.pc-ma-r b{font:600 12px 'IBM Plex Mono',monospace}.pc-ma-r em{grid-column:2/4;font:600 11px 'IBM Plex Mono',monospace;font-style:normal}" +
    ".pc-ma-r.ab em{color:#3fb97f}.pc-ma-r.bl em{color:#ff6b62}.pc-src{margin-top:6px;font-size:11px;color:var(--faint);line-height:1.4}" +
    ".pc-seas{fill:none;stroke:#d9b46a;stroke-width:1.4;stroke-dasharray:5 4;vector-effect:non-scaling-stroke;opacity:.85}.pc-cash{fill:none;stroke:#7dd8e6;stroke-width:1.4;stroke-dasharray:2 3;vector-effect:non-scaling-stroke}" +
    ".pc-al{stroke:#e3a33a;stroke-width:1;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}.pc-al.hit{stroke:#8f9db3}.pc-alt{fill:#e3a33a;font:600 10.5px 'IBM Plex Mono',monospace}" +
    ".pc-ls{background:#d9b46a!important}.pc-lc{background:#7dd8e6!important}.pc-la{background:#e3a33a!important}.pc-ovb{margin-left:8px}.pc-rg .pc-ovb[aria-pressed=true]{background:rgba(217,180,106,.15);color:#d9b46a;border-color:#d9b46a}" +
    ".pc-bs{display:flex;gap:4px;align-items:center;margin:3px 0}.pc-bs label{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted);width:100%}.pc-bs input,.pc-bs select{flex:1;min-width:0;background:rgba(255,255,255,.04);border:1px solid var(--line2);color:var(--ink);border-radius:6px;padding:4px 6px;font:12px 'IBM Plex Mono',monospace}" +
    ".pc-bs button,.pc-alr button{appearance:none;border:1px solid var(--line2);background:transparent;color:var(--ink);border-radius:6px;padding:4px 9px;cursor:pointer;font:600 12px 'IBM Plex Sans',sans-serif}.pc-alr.hit span{color:var(--faint)}" +
    ".pc-cr{display:grid;grid-template-columns:1fr 52px 52px;gap:4px;font-size:12px;padding:2px 0}.pc-cr b{font:600 12px 'IBM Plex Mono',monospace;text-align:right}.pc-cr b.up{color:#3fb97f}.pc-cr b.dn{color:#ff6b62}.pc-crh i{font:600 10px 'IBM Plex Mono',monospace;color:var(--faint);text-align:right;font-style:normal}" +
    "#pc-toasts{position:fixed;right:16px;bottom:16px;z-index:90;display:flex;flex-direction:column;gap:6px}.pc-toast{background:#1a2330;border:1px solid #e3a33a;color:var(--ink);border-radius:9px;padding:9px 12px;font:600 13px 'IBM Plex Sans',sans-serif;max-width:340px;cursor:pointer;animation:pcIn .3s ease-out}" +
    "#pulse-bar .pb-t.pb-al::before{content:'🔔';position:absolute;top:-7px;left:2px;font-size:9px;line-height:1}#pulse-bar .pb-t.pb-alhit::before{content:'🔔';position:absolute;top:-7px;left:2px;font-size:9px;opacity:.45}" +
    "@media (max-width:1100px){body.pc-open #pc-view{grid-template-columns:1fr}.pc-nav{position:static;flex-direction:row;flex-wrap:wrap}.pc-side{position:static}}" +
    "@media (prefers-reduced-motion:reduce){.pc-link{animation:none}}";
  doc.head.appendChild(st);
  root.PRICE_CHART = { open: open, close: close };
})();
