/* ma-signal.js — moving-average read for price tiles (closing basis only).
   For a series of completed daily closes: price vs the 20/50/100/200-day simple MAs, the trend verdict those imply, and
   what changed at the latest close (price closed through an MA, or one MA crossed another — 50/200 = golden/death cross).
   A change at the latest close is posted to the Feed once as a BIG ANNOUNCEMENT and badged on the tile (CROSSED / BROKE).
   Inputs: grains = desk settles (DATA.grain_long + today's settle), USD/CAD = desk closes, World markets = the server's
   `ma` block (scripts/world.py). Nothing is computed from intraday prints. */
(function (root) {
  var N = [20, 50, 100, 200];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function avg(c, n, end) { if (end + 1 < n) return null; var s = 0; for (var i = end - n + 1; i <= end; i++) s += c[i]; return s / n; }
  /* closes oldest -> newest (completed sessions) -> the same shape the server sends for World markets */
  function calc(dates, closes) {
    var e = closes.length - 1; if (e < 21) return null;
    var ma = {}, pm = {}; N.forEach(function (n) { ma[n] = avg(closes, n, e); pm[n] = avg(closes, n, e - 1); });
    return { asof: dates[e], close: closes[e], prev_close: closes[e - 1], prev_asof: dates[e - 1], ma: ma, prev_ma: pm };
  }
  /* verdict + what changed at the latest close */
  function read(b) {
    if (!b || b.close == null) return null;
    var P = b.live != null ? b.live : b.close, M = b.lma || b.ma;   /* desk tiles: latest delayed price vs the EMA with today's bar at that price */
    var have = N.filter(function (n) { return M[n] != null; }), above = have.filter(function (n) { return P > M[n]; });
    var stackUp = have.length >= 3 && have.every(function (n, i) { return !i || M[have[i - 1]] > M[n]; }),
      stackDn = have.length >= 3 && have.every(function (n, i) { return !i || M[have[i - 1]] < M[n]; });
    var a200 = M[200] != null ? P > M[200] : null, v, cls, U = b.type === "ema" ? "EMA" : "MA";
    if (above.length === have.length && stackUp) { v = "Strong bullish — above every " + U + ", " + U + "s stacked up"; cls = "bull2"; }
    else if (!above.length && stackDn) { v = "Strong bearish — below every " + U + ", " + U + "s stacked down"; cls = "bear2"; }
    else if (have.length < 2) { v = (above.length ? "Above" : "Below") + " the " + have[0] + "-day " + U + " (longer ones need more history)"; cls = above.length ? "bull" : "bear"; }
    else if (above.length / have.length >= 0.75 && a200 !== false) { v = "Bullish — above " + above.length + " of " + have.length + " " + U + "s"; cls = "bull"; }
    else if (above.length / have.length <= 0.25 && a200 !== true) { v = "Bearish — below " + (have.length - above.length) + " of " + have.length + " " + U + "s"; cls = "bear"; }
    else { v = "Mixed — " + (a200 == null ? "" : a200 ? "above the 200-day (long trend up), " : "below the 200-day (long trend down), ") + "short-term " + (P > M[20] ? "above" : "below") + " the 20-day"; cls = "mix"; }
    var ev = [];
    if (b.prev_close != null) N.forEach(function (n) {
      var m1 = b.ma[n], m0 = b.prev_ma && b.prev_ma[n]; if (m1 == null || m0 == null) return;
      if (b.prev_close <= m0 && b.close > m1) ev.push({ k: "px", n: n, up: true, txt: "closed above its " + n + "-day MA" });
      if (b.prev_close >= m0 && b.close < m1) ev.push({ k: "px", n: n, up: false, txt: "closed below its " + n + "-day MA" });
    });
    if (b.live != null && b.lma) N.forEach(function (n) {
      var m = b.ma[n], l = b.lma[n]; if (m == null || l == null) return;
      if (b.close >= m && b.live < l) ev.push({ k: "live", n: n, up: false, txt: "trading below its " + n + "-day " + U + " (live)" });
      if (b.close <= m && b.live > l) ev.push({ k: "live", n: n, up: true, txt: "trading above its " + n + "-day " + U + " (live)" });
    });
    [[20, 50], [50, 100], [50, 200], [100, 200]].forEach(function (p) {
      var a1 = b.ma[p[0]], b1 = b.ma[p[1]], a0 = b.prev_ma && b.prev_ma[p[0]], b0 = b.prev_ma && b.prev_ma[p[1]]; if ([a1, b1, a0, b0].some(function (x) { return x == null; })) return;
      if (a0 <= b0 && a1 > b1) ev.push({ k: "ma", a: p[0], b: p[1], up: true, txt: p[0] + "-day MA crossed above the " + p[1] + "-day" + (p[0] === 50 && p[1] === 200 ? " (golden cross)" : "") });
      if (a0 >= b0 && a1 < b1) ev.push({ k: "ma", a: p[0], b: p[1], up: false, txt: p[0] + "-day MA crossed below the " + p[1] + "-day" + (p[0] === 50 && p[1] === 200 ? " (death cross)" : "") });
    });
    return { v: v, cls: cls, above: above, have: have, ev: ev };
  }
  function fmt(x, d) { return x == null ? "—" : (+x).toFixed(d); }
  /* the tile block: four MA chips, the verdict, and CROSSED / BROKE badges for a change at the latest close */
  function line(b, d, label, key) {
    var r = read(b); if (!r) return "";
    var P = b.live != null ? b.live : b.close, M = b.lma || b.ma, U = b.type === "ema" ? "EMA" : "MA";
    var chips = N.map(function (n) {
      if (M[n] == null) return '<span class="ma-c na" title="not enough history">' + n + "D —</span>";
      var up = P > M[n], dist = (P / M[n] - 1) * 100;
      return '<span class="ma-c ' + (up ? "up" : "dn") + '" title="' + n + "-day " + U + " " + fmt(M[n], d) + " · " + (b.live != null ? "latest price" : "close") + " " + (up ? "above" : "below") + " by " + Math.abs(dist).toFixed(2) + '%">' + "<u>" + n + "D " + U + "</u><b>" + fmt(M[n], d) + "</b><i>" + (up ? "▲ " : "▼ ") + (dist >= 0 ? "+" : "−") + Math.abs(dist).toFixed(1) + "%</i></span>";
    }).join("");
    var badges = r.ev.map(function (e) {
      return '<span class="ma-b ' + (e.up ? "up" : "dn") + '">' + (e.k === "live" ? (e.up ? "TRADING ABOVE " : "TRADING BELOW ") + e.n + "D" : e.k === "px" ? (e.up ? "CROSSED ABOVE " : "BROKE BELOW ") + e.n + "D" : (e.a === 50 && e.b === 200 ? (e.up ? "GOLDEN CROSS" : "DEATH CROSS") : e.a + "D " + (e.up ? "OVER " : "UNDER ") + e.b + "D")) + "</span>";
    }).join("");
    var tip = b.live != null ? "Latest delayed price " + fmt(b.live, d) + " vs " + U + "s with today’s bar at that price · last settle " + fmt(b.close, d) + " on " + b.asof : "Closing basis · " + (label || "") + " close " + fmt(b.close, d) + " on " + b.asof;
    return '<span class="ma-row"' + (key ? ' data-masig="' + key + '"' : "") + ' title="' + esc(tip) + '"><span class="ma-chips">' + chips + '</span><span class="ma-v ' + r.cls + '">' + esc(r.v) + "</span>" + (badges ? '<span class="ma-bs">' + badges + "</span>" : "") + "</span>";
  }
  /* EMA of a close series, seeded with the simple average of the first n */
  function emaAt(c, n, end) { if (end + 1 < n + 10) return null; var k = 2 / (n + 1), e = 0, i; for (i = 0; i < n; i++) e += c[i]; e /= n; for (i = n; i <= end; i++) e = c[i] * k + e * (1 - k); return e; }
  function liveOf(k) {   /* the same latest price the tile shows */
    var D = root.DATA; if (k === "fx") { var m = D && D.fx && D.fx.feed && +D.fx.feed.mid; var el = document.querySelector('[data-tick="fx-spot"],[data-fxspot]'); var t = el ? parseFloat(String(el.textContent).replace(/[^0-9.]/g, "")) : NaN; return isFinite(t) && t > 0.5 && t < 3 ? t : m > 0 ? m : null; }
    var g = D && D.grains && D.grains[k], q = g && +g.fan.intraday[0], el2 = document.querySelector('.g-kpi[data-grain="' + k + '"]'), t2 = el2 ? parseFloat(String(el2.textContent).replace(/[^0-9.]/g, "")) : NaN;
    return isFinite(t2) && t2 > 0 ? t2 : q > 0 ? q : null;
  }
  function withLive(b, k) {   /* EMA through the last close + today's bar at the live price: E + 2/(n+1)·(price − E) */
    if (!b) return b; var px = liveOf(k); if (!(px > 0)) return b;
    var lma = {}; N.forEach(function (n) { lma[n] = b.ma[n] == null ? null : b.ma[n] + (2 / (n + 1)) * (px - b.ma[n]); });
    b.live = px; b.lma = lma; return b;
  }
  /* desk series: grains (settles) and USD/CAD (closes) */
  /* closing basis only: grains end at the last verified settle (the series also carries today's unfinished bar);
     USD/CAD drops today's row until the 5 p.m. ET FX close */
  var TZD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }),
    TZH = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
  function deskBlock(k) {
    var D = root.DATA; if (!D || !D.grain_long) return null;
    if (k === "fx") {
      var u = ((D.grain_long.other || {}).usdcad || []).slice(), today = TZD.format(new Date());
      while (u.length && (u[u.length - 1][0] > today || (u[u.length - 1][0] === today && +TZH.format(new Date()) < 17))) u.pop();
      return emaBlock(u.map(function (r) { return r[0]; }), u.map(function (r) { return +r[1]; }));
    }
    var s = (D.grain_long.series || {})[k] || [], R0 = D.grains && D.grains[k] && (D.grains[k].roll || [])[0], cut = R0 && R0.settle_date;
    if (cut) s = s.filter(function (r) { return r[0] <= cut; });
    var dates = s.map(function (r) { return r[0]; }), c = s.map(function (r) { return +r[4]; });
    if (R0 && R0.settle != null && cut) { if (dates[dates.length - 1] === cut) c[c.length - 1] = +R0.settle; else if (!dates.length || cut > dates[dates.length - 1]) { dates.push(cut); c.push(+R0.settle); } }
    var b = emaBlock(dates, c), F = D.grains && D.grains[k] && D.grains[k].fan;
    /* 20/50/100: the desk's own EMAs on the FRONT contract's settles (same numbers as the Insight card); 200 needs the long series */
    if (b && F && F.ema20 != null && F.settle_date === b.asof) {
      var kk = function (n) { return 2 / (n + 1); };
      [[20, F.ema20], [50, F.ema50], [100, F.ema100]].forEach(function (x) { if (x[1] == null) return; b.ma[x[0]] = +x[1]; b.prev_ma[x[0]] = (+x[1] - kk(x[0]) * b.close) / (1 - kk(x[0])); });
    }
    /* withdraw any announcement made from an unfinished session before this fix */
    if (b && root.EVENTS && EVENTS.unlog) EVENTS.unlog(function (m) { var q = String(m.id || "").split("|"); return q[0] === "ma" && q[1] === k && q[2] > b.asof; });
    return b;
  }
  function emaBlock(dates, closes) {
    var e = closes.length - 1; if (e < 21) return null;
    var ma = {}, pm = {}; N.forEach(function (n) { ma[n] = emaAt(closes, n, e); pm[n] = emaAt(closes, n, e - 1); });
    return { type: "ema", asof: dates[e], close: closes[e], prev_close: closes[e - 1], prev_asof: dates[e - 1], ma: ma, prev_ma: pm };
  }
  var NAMES = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat", fx: "USD/CAD" };
  function fxPurge(b) { if (b && root.EVENTS && EVENTS.unlog) EVENTS.unlog(function (m) { var q = String(m.id || "").split("|"); return q[0] === "ma" && q[1] === "fx" && q[2] > b.asof; }); }
  function tileLine(k) { var b = deskBlock(k); if (k === "fx") fxPurge(b); announce(k, NAMES[k], b, k === "fx" ? 4 : 4, k === "fx" ? "fx:overview" : k + ":overview"); return line(withLive(b, k), 4, k === "fx" ? "USD/CAD" : "settle", k); }
  /* keep the desk tiles' EMA read in step with every price refresh */
  setInterval(function () { [].forEach.call(document.querySelectorAll("[data-masig]"), function (el) { if (!el.isConnected) return; var k = el.getAttribute("data-masig"), b = withLive(deskBlock(k), k), h = b ? line(b, 4, "", k) : ""; if (h && el.outerHTML !== h) el.outerHTML = h; }); }, 3000);
  /* World markets: the server's `ma` block for each instrument */
  function worldLine(i) { if (!i || !i.ma) return ""; var d = i.kind === "price" ? +i.dec : 3; announce("w-" + i.id, i.name, i.ma, d, "world"); return line(i.ma, d, i.name); }
  /* Feed: once per market, per close, per event */
  var DONE = {}; try { DONE = JSON.parse(localStorage.getItem("desk.masig") || "{}") || {}; } catch (e) {}
  function announce(key, name, b, d, go) {
    var r = read(b); if (!r || !r.ev.length || !root.EVENTS || !EVENTS.log) return;
    r.ev.forEach(function (e) {
      var id = "ma|" + key + "|" + b.asof + "|" + (e.k === "px" ? e.n : e.a + "-" + e.b) + "|" + (e.up ? "u" : "d"); if (DONE[id]) return;
      var lvl = e.k === "px" ? " (" + fmt(b.ma[e.n], d) + ")" : "";
      var t = Date.parse(b.asof + "T21:00:00Z");
      EVENTS.log("alert", "📣 <b>BIG ANNOUNCEMENT · " + esc(name) + "</b> " + esc(e.txt) + lvl + " — close " + fmt(b.close, d) + " on " + esc(b.asof) + " · trend now: " + esc(r.v), go, id, isFinite(t) ? Math.min(t, Date.now()) : Date.now());
      DONE[id] = Date.now();
    });
    var cut = Date.now() - 45 * 864e5; Object.keys(DONE).forEach(function (x) { if (DONE[x] < cut) delete DONE[x]; });
    try { localStorage.setItem("desk.masig", JSON.stringify(DONE)); } catch (e) {}
  }
  var css = document.createElement("style");
  css.textContent = ".ma-row{display:flex;flex-direction:column;gap:3px;margin-top:5px;padding-top:5px;border-top:1px solid #1a1a1a;text-align:left}" +
    ".ma-chips{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.ma-c{font:600 10px 'JetBrains Mono','IBM Plex Mono',monospace;border:1px solid;border-radius:3px;padding:3px 6px;line-height:14px;white-space:nowrap;display:flex;flex-direction:column;min-width:0}.ma-c u{text-decoration:none;opacity:.85;letter-spacing:.03em}.ma-c i{font-style:normal;font-size:10px}.ma-c u{text-decoration:none;display:flex;justify-content:space-between;gap:4px}.ma-c b{font:600 12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#e8eef4}.ma-c i{font-style:normal;opacity:.8}.ma-c.up{color:#3fb97f;border-color:#3fb97f66}.ma-c.dn{color:#e0655f;border-color:#e0655f66}.ma-c.na{color:#555;border-color:#333}" +
    ".ma-v{font-size:11px;line-height:1.35}.ma-v.bull2,.ma-v.bull{color:#3fb97f}.ma-v.bear2,.ma-v.bear{color:#e0655f}.ma-v.mix{color:#e8b93d}.ma-v.bull2,.ma-v.bear2{font-weight:600}" +
    ".ma-bs{display:flex;flex-wrap:wrap;gap:4px}.ma-b{font:700 9.5px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.04em;border-radius:3px;padding:1px 5px;color:#000;animation:maPulse 1.6s ease-in-out 3}.ma-b.up{background:#3fb97f}.ma-b.dn{background:#e0655f}" +
    "@keyframes maPulse{50%{opacity:.45}}@media (prefers-reduced-motion:reduce){.ma-b{animation:none}}";
  document.head.appendChild(css);
  root.MASIG = { calc: calc, read: read, line: line, tileLine: tileLine, worldLine: worldLine, deskBlock: deskBlock };
})(window);
