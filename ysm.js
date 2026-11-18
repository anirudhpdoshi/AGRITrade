/* ysm.js — US–Canada yield spread monitor (owner, Nov 18 2026)
   Overnight (SOFR vs CORRA) to 30Y. Official daily closes from DATA.fx.ysm; today's delayed/estimated legs for 1Y–30Y
   come from the existing live-yield feed (window.YSM_LIVE, set by desk-main). Curve chart, history chart and table share
   one selected tenor: click a row or a chart point and all three follow. */
(function () {
  var S = { t: null, rng: 63, hm: "all", basis: "yield" };
  var PAL = { ON: "#a78bfa", "1M": "#38b6c9", "3M": "#5aa9ff", "6M": "#7cc7ff", "1Y": "#3fb97f", "2Y": "#ffb84d", "5Y": "#f08a5d", "10Y": "#ff6b6b", "30Y": "#e879f9" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function md(d) { var p = String(d).split("-"); return MON[+p[1] - 1] + " " + +p[2]; }
  function e(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toFixed(d); }
  function sg(v, d) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d); }
  function cl(v) { return v == null || Math.abs(v) < 0.05 ? "ys-n" : v > 0 ? "ys-u" : "ys-d"; }
  function ord(n) { n = Math.round(n); var t = n % 100, u = n % 10; return n + (t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"); }

  function model() {
    var Y = window.DATA && DATA.fx && DATA.fx.ysm; if (!Y || !Y.hist || !Y.hist.length) return null;
    var LV = window.YSM_LIVE || {};
    var rows = Y.tenors.map(function (t) {
      var ser = Y.hist.filter(function (h) { return h.us[t] != null && h.ca[t] != null; }).map(function (h) { return { d: h.d, us: h.us[t], ca: h.ca[t], sp: (h.us[t] - h.ca[t]) * 100 }; });
      if (!ser.length) return null;
      var L = ser[ser.length - 1], back = function (n) { var x = ser[ser.length - 1 - n]; return x ? L.sp - x.sp : null; };
      var lv = LV[t], live = lv && lv.live && lv.us != null && lv.ca != null && lv.closeDate === L.d ? lv : null;   /* live legs only when they sit on the same official close */
      var us = live ? lv.us : L.us, ca = live ? lv.ca : L.ca, now = (us - ca) * 100;
      var vs = ser.map(function (x) { return x.sp; }), hi = Math.max.apply(null, vs), lo = Math.min.apply(null, vs);
      return { t: t, ser: ser, close: L, us: us, ca: ca, sp: now, live: !!live, lv: live, dLive: live ? now - L.sp : null,
        d1: back(1), d5: back(5), d21: back(21), hi: hi, lo: lo, pct: 100 * vs.filter(function (v) { return v <= now; }).length / vs.length,
        src: (Y.src || {})[t] || ["", ""] };
    }).filter(Boolean);
    return rows.length ? { Y: Y, rows: rows } : null;
  }

  /* ---- chart 1: both curves by tenor, the gap between them labelled in bps ---- */
  function curveSVG(M, sel) {
    var ON = M.rows.filter(function (x) { return x.t === "ON"; })[0], OB = S.basis === "on" && ON;
    var R = M.rows.map(function (x) { return OB ? Object.assign({}, x, { us: (x.us - ON.us) * 100, ca: (x.ca - ON.ca) * 100, sp: ((x.us - ON.us) - (x.ca - ON.ca)) * 100 }) : x; });
    var W = 640, H = 250, l = 46, r = 16, t = 26, b = 34, n = R.length, U = OB ? 1 : 0;
    var ys = []; R.forEach(function (x) { ys.push(x.us, x.ca); });
    var q = OB ? 25 : 0.25, y0 = Math.floor(Math.min.apply(null, ys) / q) * q - q, y1 = Math.ceil(Math.max.apply(null, ys) / q) * q + q;
    var X = function (i) { return l + (n === 1 ? (W - l - r) / 2 : i * (W - l - r) / (n - 1)); }, Yp = function (v) { return t + (y1 - v) / (y1 - y0) * (H - t - b); };
    var g = "", st = OB ? ((y1 - y0) > 200 ? 50 : 25) : (y1 - y0) > 2 ? 0.5 : 0.25;
    for (var v = Math.ceil(y0 / st) * st; v <= y1 + 1e-9; v += st) g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Yp(v) + '" y2="' + Yp(v) + '" class="ys-gr"/><text x="' + (l - 6) + '" y="' + (Yp(v) + 4) + '" class="ys-ax" text-anchor="end">' + (OB ? v.toFixed(0) : v.toFixed(2) + "%") + "</text>";
    if (OB) g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Yp(0) + '" y2="' + Yp(0) + '" class="ys-avg"/>';
    var gap = R.map(function (x, i) { return X(i) + "," + Yp(x.us); }).join(" ") + " " + R.slice().reverse().map(function (x, j) { return X(n - 1 - j) + "," + Yp(x.ca); }).join(" ");
    var pl = function (k) { return R.map(function (x, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Yp(x[k]).toFixed(1); }).join(""); };
    var pts = R.map(function (x, i) {
      var on = x.t === sel, xm = X(i), yu = Yp(x.us), yc = Yp(x.ca), top = Math.min(yu, yc), bot = Math.max(yu, yc);
      return '<g class="ys-pt' + (on ? " on" : "") + '" data-ysm-t="' + x.t + '" tabindex="0" role="button" aria-label="' + x.t + " spread " + f(x.sp, 1) + ' bps">' +
        '<rect x="' + (xm - 22) + '" y="' + t + '" width="44" height="' + (H - t - b) + '" class="ys-hit"/>' +
        '<line x1="' + xm + '" x2="' + xm + '" y1="' + top + '" y2="' + bot + '" class="ys-gap"/>' +
        '<circle cx="' + xm + '" cy="' + yu + '" r="' + (on ? 5 : 3.5) + '" class="ys-us"/><circle cx="' + xm + '" cy="' + yc + '" r="' + (on ? 5 : 3.5) + '" class="ys-ca"/>' +
        '<text x="' + xm + '" y="' + (top - 8) + '" text-anchor="middle" class="ys-lb">' + (OB ? sg(x.sp, 0) : f(x.sp, 0)) + "</text>" +
        '<text x="' + xm + '" y="' + (H - b + 18) + '" text-anchor="middle" class="ys-tk' + (on ? " on" : "") + '">' + x.t + "</text></g>";
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="ys-svg" role="img" aria-label="US and Canada yield curves with the spread at each tenor">' + g +
      '<polygon points="' + gap + '" class="ys-fill"/><path d="' + pl("us") + '" class="ys-lu"/><path d="' + pl("ca") + '" class="ys-lc"/>' + pts + "</svg>";
  }

  /* ---- chart 2: the selected tenor's spread through time, high / low / average marked ---- */
  function histSVG(x, rng) {
    var s = x.ser.slice(-rng), W = 640, H = 250, l = 46, r = 70, t = 22, b = 34, n = s.length;
    if (n < 2) return '<div class="ys-ph">Not enough sessions yet for a history line.</div>';
    var v = s.map(function (z) { return z.sp; }), hi = Math.max.apply(null, v), lo = Math.min.apply(null, v), av = v.reduce(function (a, c) { return a + c; }, 0) / n;
    var pad = Math.max(2, (hi - lo) * 0.15), y0 = lo - pad, y1 = hi + pad;
    var X = function (i) { return l + i * (W - l - r) / (n - 1); }, Yp = function (q) { return t + (y1 - q) / (y1 - y0) * (H - t - b); };
    var g = "", step = Math.max(1, Math.round((y1 - y0) / 5));
    for (var q = Math.ceil(y0 / step) * step; q <= y1; q += step) g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Yp(q) + '" y2="' + Yp(q) + '" class="ys-gr"/><text x="' + (l - 6) + '" y="' + (Yp(q) + 4) + '" class="ys-ax" text-anchor="end">' + q + "</text>";
    var lab = [0, Math.floor((n - 1) / 3), Math.floor(2 * (n - 1) / 3), n - 1].map(function (i) { return '<text x="' + X(i) + '" y="' + (H - b + 18) + '" text-anchor="middle" class="ys-ax">' + md(s[i].d) + "</text>"; }).join("");
    var path = s.map(function (z, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Yp(z.sp).toFixed(1); }).join("");
    var ih = v.indexOf(hi), il = v.indexOf(lo), last = s[n - 1];
    var mk = function (i, val, cls, up) { return '<circle cx="' + X(i) + '" cy="' + Yp(val) + '" r="4" class="' + cls + '"/><text x="' + X(i) + '" y="' + (Yp(val) + (up ? -9 : 17)) + '" text-anchor="middle" class="ys-lb ' + cls + '">' + (up ? "High " : "Low ") + f(val, 1) + " · " + md(s[i].d) + "</text>"; };
    var hov = s.map(function (z, i) { return '<rect x="' + (X(i) - (W - l - r) / (2 * (n - 1))) + '" y="' + t + '" width="' + (W - l - r) / (n - 1) + '" height="' + (H - t - b) + '" class="ys-hit"><title>' + md(z.d) + " · spread " + f(z.sp, 1) + " bps · US " + f(z.us, 3) + "% · Canada " + f(z.ca, 3) + "%</title></rect>"; }).join("");
    var liveDot = x.live ? '<circle cx="' + (W - r + 14) + '" cy="' + Yp(Math.max(y0, Math.min(y1, x.sp))) + '" r="4" class="ys-live"/><text x="' + (W - r + 22) + '" y="' + (Yp(Math.max(y0, Math.min(y1, x.sp))) + 4) + '" class="ys-lb ys-live">' + f(x.sp, 1) + '</text><text x="' + (W - r + 22) + '" y="' + (Yp(Math.max(y0, Math.min(y1, x.sp))) + 17) + '" class="ys-ax">live</text>' : "";
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="ys-svg" role="img" aria-label="' + x.t + ' US minus Canada spread history">' + g + lab +
      '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Yp(av) + '" y2="' + Yp(av) + '" class="ys-avg"/><text x="' + (W - r + 4) + '" y="' + (Yp(av) + 4) + '" class="ys-ax">avg ' + f(av, 0) + "</text>" +
      '<path d="' + path + '" class="ys-ls"/>' + mk(ih, hi, "ys-hi", true) + (il !== ih ? mk(il, lo, "ys-lo", false) : "") +
      '<circle cx="' + X(n - 1) + '" cy="' + Yp(last.sp) + '" r="4.5" class="ys-last"/><text x="' + (X(n - 1) - 8) + '" y="' + (Yp(last.sp) - 8) + '" class="ys-lb" text-anchor="end">' + f(last.sp, 1) + " close " + md(last.d) + "</text>" + liveDot + hov + "</svg>";
  }


  /* ---- chart 2b: every tenor's spread on one chart; the selected tenor is bold, the rest stay visible ---- */
  function histAllSVG(M, sel, rng) {
    var W = 640, H = 250, l = 46, r = 74, t = 18, b = 34;
    var dates = M.Y.hist.slice(-rng).map(function (h) { return h.d; }), n = dates.length; if (n < 2) return '<div class="ys-ph">Not enough sessions yet.</div>';
    var ix = {}; dates.forEach(function (d, i) { ix[d] = i; });
    var L = M.rows.map(function (x) { return { x: x, p: x.ser.filter(function (z) { return ix[z.d] != null; }) }; }).filter(function (o) { return o.p.length > 1; });
    var all = []; L.forEach(function (o) { o.p.forEach(function (z) { all.push(z.sp); }); });
    var y0 = Math.floor(Math.min.apply(null, all) / 10) * 10 - 5, y1 = Math.ceil(Math.max.apply(null, all) / 10) * 10 + 5;
    var X = function (i) { return l + i * (W - l - r) / (n - 1); }, Yp = function (q) { return t + (y1 - q) / (y1 - y0) * (H - t - b); };
    var g = "", step = (y1 - y0) > 120 ? 25 : (y1 - y0) > 50 ? 10 : 5;
    for (var q = Math.ceil(y0 / step) * step; q <= y1; q += step) g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Yp(q) + '" y2="' + Yp(q) + '" class="ys-gr"/><text x="' + (l - 6) + '" y="' + (Yp(q) + 4) + '" class="ys-ax" text-anchor="end">' + q + "</text>";
    g += [0, Math.floor((n - 1) / 3), Math.floor(2 * (n - 1) / 3), n - 1].map(function (i) { return '<text x="' + X(i) + '" y="' + (H - b + 18) + '" text-anchor="middle" class="ys-ax">' + md(dates[i]) + "</text>"; }).join("");
    var ends = L.map(function (o) { var z = o.p[o.p.length - 1]; return { t: o.x.t, y: Yp(z.sp), v: z.sp }; }).sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;   /* end labels never overlap */
    var lines = L.sort(function (a, b) { return (a.x.t === sel) - (b.x.t === sel); }).map(function (o) {
      var on = o.x.t === sel, c = PAL[o.x.t] || "#9aa7b8";
      return '<g class="ys-ml' + (on ? " on" : "") + '" data-ysm-t="' + o.x.t + '"><path d="' + o.p.map(function (z, k) { return (k ? "L" : "M") + X(ix[z.d]).toFixed(1) + "," + Yp(z.sp).toFixed(1); }).join("") + '" stroke="' + c + '" class="ys-mlp"><title>' + o.x.t + " spread · latest " + f(o.x.close.sp, 1) + " bps (" + md(o.x.close.d) + ")</title></path></g>";
    }).join("");
    var labs = ends.map(function (e) { return '<text x="' + (W - r + 6) + '" y="' + (e.y + 4) + '" class="ys-el' + (e.t === sel ? " on" : "") + '" fill="' + (PAL[e.t] || "#9aa7b8") + '" data-ysm-t="' + e.t + '">' + e.t + " " + f(e.v, 0) + "</text>"; }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="ys-svg" role="img" aria-label="US minus Canada spread history, every tenor">' + g + lines + labs + "</svg>";
  }

  function tag(x, side) {
    if (side === "ca" && x.t === "ON" || side === "us" && x.t === "ON") return '<span class="ys-tag cz">CLOSE</span>';
    var lv = x.lv, m = lv && (side === "us" ? lv.um : lv.cm);
    if (!lv || !m || m === "close" || m === "stored") return '<span class="ys-tag cz" title="Official close ' + e(x.close.d) + '">CLOSE</span>';
    var T = { index: ["DELAYED", "ok", "delayed intraday yield"], futures: ["EST · FUT", "warn", "estimated from 2-year note futures"], etf: ["EST · ETF", "warn", "estimated from a federal-bond ETF move × fitted sensitivity"], interp: ["INTERP", "warn", "interpolated from live neighbouring tenors"] }[m] || ["LIVE", "ok", ""];
    return '<span class="ys-tag ' + T[1] + '" title="' + e(T[2]) + '">' + T[0] + "</span>";
  }

  function html() {
    var M = model(); if (!M) return "";
    var R = M.rows, sel = S.t && R.some(function (x) { return x.t === S.t; }) ? S.t : (R.some(function (x) { return x.t === "2Y"; }) ? "2Y" : R[0].t), X = R.filter(function (x) { return x.t === sel; })[0];
    var wide = R.slice().sort(function (a, b) { return b.sp - a.sp; })[0], nar = R.slice().sort(function (a, b) { return a.sp - b.sp; })[0];
    var nLive = R.filter(function (x) { return x.live; }).length, lastD = M.Y.hist[M.Y.hist.length - 1].d;
    var k = function (t) { var x = R.filter(function (z) { return z.t === t; })[0]; if (!x) return ""; return '<button class="ys-k' + (t === sel ? " on" : "") + '" data-ysm-t="' + t + '"><span class="kl">' + (t === "ON" ? "Overnight · SOFR − CORRA" : t + " spread") + '</span><b>' + f(x.sp, 1) + ' <small>bps</small></b><span class="' + cl(x.d1) + '">' + sg(x.d1, 1) + " 1D · " + sg(x.d5, 1) + " 1W</span></button>"; };
    var ONr = R.filter(function (x) { return x.t === "ON"; })[0];
    var rows = R.map(function (x) {
      var w = x.hi - x.lo || 1, pos = Math.max(0, Math.min(100, (x.sp - x.lo) / w * 100));
      return '<tr class="ys-r' + (x.t === sel ? " on" : "") + '" data-ysm-t="' + x.t + '" tabindex="0">' +
        '<td data-l="Tenor"><b>' + x.t + "</b>" + (x === wide ? ' <small class="ys-w">widest</small>' : x === nar ? ' <small class="ys-w">narrowest</small>' : "") + "</td>" +
        '<td data-l="United States" title="' + e(x.src[0]) + '"><b class="ys-cu">' + f(x.us, 3) + "%</b> " + tag(x, "us") + "</td>" +
        '<td data-l="Canada" title="' + e(x.src[1]) + '"><b class="ys-cc">' + f(x.ca, 3) + "%</b> " + tag(x, "ca") + "</td>" +
        '<td data-l="Spread (bps)" class="ys-sp"><b>' + f(x.sp, 1) + "</b></td>" +
        '<td data-l="vs close" class="' + (x.live ? cl(x.dLive) : "ys-n") + '">' + (x.live ? sg(x.dLive, 1) : "—") + "</td>" +
        '<td data-l="Δ 1D" class="' + cl(x.d1) + '">' + sg(x.d1, 1) + "</td>" +
        '<td data-l="Δ 1W" class="' + cl(x.d5) + '">' + sg(x.d5, 1) + "</td>" +
        '<td data-l="Δ 1M" class="' + cl(x.d21) + '">' + sg(x.d21, 1) + "</td>" +
        '<td data-l="US − SOFR" class="ys-o">' + (ONr && x.t !== "ON" ? sg((x.us - ONr.us) * 100, 0) : "—") + "</td>" +
        '<td data-l="CA − CORRA" class="ys-o">' + (ONr && x.t !== "ON" ? sg((x.ca - ONr.ca) * 100, 0) : "—") + "</td>" +
        '<td data-l="90-day range" class="ys-rg"><span class="ys-rl">' + f(x.lo, 0) + '</span><span class="ys-bar"><i style="left:' + pos.toFixed(0) + '%"></i></span><span class="ys-rl">' + f(x.hi, 0) + "</span></td>" +
        '<td data-l="Percentile">' + ord(x.pct) + "</td>" +
        '<td data-l="Close date" class="ys-dt">' + md(x.close.d) + "</td></tr>";
    }).join("");
    var read = "Canada yields sit below the US at every tenor shown: the spread runs " + f(nar.sp, 0) + "–" + f(wide.sp, 0) + " bps, widest at " + wide.t + ", narrowest at " + nar.t + ". " +
      (X.d5 != null ? "The " + X.t + " spread is " + (Math.abs(X.d5) < 0.5 ? "flat" : X.d5 > 0 ? "<b class=\"ys-u\">" + f(X.d5, 1) + " bps wider</b>" : "<b class=\"ys-d\">" + f(-X.d5, 1) + " bps narrower</b>") + " on the week" + (Math.abs(X.d5) >= 0.5 ? (X.d5 > 0 ? " — more rate support for USD/CAD." : " — less rate support for USD/CAD.") : ".") : "");
    if (!R.some(function (x) { return x.sp < 0; })) {} else read = read.replace("Canada yields sit below the US at every tenor shown: ", "");
    return '<div class="tile wide ysm-tile no-nf" id="ysm-tile" data-src="spread_monitor"><h2>US–Canada yield spread monitor <span class="h2note">— overnight (SOFR vs CORRA) to 30Y · US minus Canada, basis points · official closes to ' + md(lastD) + (nLive ? " · " + nLive + " tenors live (delayed)" : "") + "</span></h2>" +
      '<div class="ys-ks">' + ["ON", "3M", "2Y", "5Y", "10Y"].map(k).join("") + "</div>" +
      '<div class="ys-ch"><div class="ys-c"><div class="ys-ct">' + (S.basis === "on" ? "Curves over overnight" : "Curves today") + ' <span class="ys-rng"><button data-ysm-b="yield" class="' + (S.basis === "yield" ? "on" : "") + '">Yields</button><button data-ysm-b="on" class="' + (S.basis === "on" ? "on" : "") + '" title="Each tenor minus its own overnight rate: US − SOFR, Canada − CORRA">vs SOFR / CORRA</button></span></div>' +
        '<div class="ys-lg2"><i class="ys-cu">● United States' + (S.basis === "on" ? " − SOFR" : "") + '</i><i class="ys-cc">● Canada' + (S.basis === "on" ? " − CORRA" : "") + '</i><i class="ys-cs">' + (S.basis === "on" ? "labels = US term premium minus Canada's, bps" : "labels = US − Canada spread, bps") + "</i></div>" + curveSVG(M, sel) + "</div>" +
      '<div class="ys-c"><div class="ys-ct">' + (S.hm === "all" ? "All tenors · spread history" : sel + " spread · history") + ' <span class="ys-rng"><button data-ysm-h="all" class="' + (S.hm === "all" ? "on" : "") + '">All tenors</button><button data-ysm-h="one" class="' + (S.hm === "one" ? "on" : "") + '">' + sel + " only</button>" + [[21, "1M"], [63, "3M"], [90, "90D"]].map(function (z) { return '<button data-ysm-r="' + z[0] + '" class="' + (S.rng === z[0] ? "on" : "") + '">' + z[1] + "</button>"; }).join("") + "</span></div>" +
        '<div class="ys-lg2"><i class="ys-cs">' + (S.hm === "all" ? "Selected tenor (" + sel + ") in bold · click a line, label or table row to switch" : "High, low and average marked · official closes") + "</i></div>" + (S.hm === "all" ? histAllSVG(M, sel, S.rng) : histSVG(X, S.rng)) + "</div></div>" +
      '<p class="ys-read">' + read + "</p>" +
      '<div class="ys-tw"><table class="ys-t"><thead><tr><th>Tenor</th><th>United States</th><th>Canada</th><th>Spread</th><th>vs close</th><th>Δ 1D</th><th>Δ 1W</th><th>Δ 1M</th><th title="Tenor yield minus SOFR, bps">US − SOFR</th><th title="Tenor yield minus CORRA, bps">CA − CORRA</th><th>90-day range</th><th>%ile</th><th>Close</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="stamp">Click any row, chip, curve point or history line to select a tenor — every chart and the table follow. “vs SOFR / CORRA” shows each curve over its own overnight rate (US − SOFR, Canada − CORRA): how much term premium each market prices above its policy-anchored overnight rate. Overnight: SOFR (New York Fed) vs CORRA (Bank of Canada). 1M–1Y: US Treasury CMT vs BoC T-bill mid yields. 2Y–30Y: US Treasury CMT vs Government of Canada benchmark bonds (30Y = GoC long benchmark). ' +
      "CLOSE = official print for the date shown; DELAYED / EST / INTERP = today's intraday leg from the live-yield feed. Δ columns and range use official closes only; a tenor with no print on a date is left out, never filled. 20Y is not shown: Canada has no 20-year benchmark.</div></div>";
  }

  function css() {
    if (document.getElementById("ysm-css")) return;
    var st = document.createElement("style"); st.id = "ysm-css";
    st.textContent = ":root{--ys-us:#5aa9ff;--ys-ca:#ff6b6b;--ys-sp:#ffb84d}html[data-theme=light]{--ys-us:#1565c0;--ys-ca:#c62828;--ys-sp:#a85d00}" +
      ".ys-ks{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:10px 0 12px}.ys-k{all:unset;cursor:pointer;display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.02)}.ys-k.on{border-color:var(--ys-sp);box-shadow:0 0 0 1px var(--ys-sp) inset}.ys-k .kl{font-size:11px;color:var(--faint);letter-spacing:.04em}.ys-k b{font-size:22px;font-variant-numeric:tabular-nums;color:var(--ink)}.ys-k b small{font-size:11px;color:var(--faint);font-weight:500}.ys-k span:last-child{font-size:12px;font-weight:600}" +
      ".ys-ch{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ys-c{border:1px solid var(--line);border-radius:10px;padding:8px 10px 4px}.ys-ct{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim,#9aa7b8);margin-bottom:2px;flex-wrap:wrap}.ys-lg i{font-style:normal;margin-left:10px;font-weight:600;text-transform:none;letter-spacing:0}.ys-svg{width:100%;height:auto;display:block}" +
      ".ys-gr{stroke:var(--line);stroke-width:1}.ys-ax{fill:var(--faint);font-size:11px}.ys-lu{fill:none;stroke:var(--ys-us);stroke-width:2.2}.ys-lc{fill:none;stroke:var(--ys-ca);stroke-width:2.2}.ys-fill{fill:var(--ys-sp);opacity:.09}.ys-gap{stroke:var(--ys-sp);stroke-width:1.5;stroke-dasharray:3 3}.ys-us{fill:var(--ys-us)}.ys-ca{fill:var(--ys-ca)}.ys-lb{fill:var(--ink);font-size:12px;font-weight:700}.ys-tk{fill:var(--dim,#9aa7b8);font-size:12px;font-weight:600}.ys-tk.on,.ys-pt.on .ys-lb{fill:var(--ys-sp)}.ys-hit{fill:transparent;cursor:pointer}.ys-pt:hover .ys-gap,.ys-pt.on .ys-gap{stroke-width:3;stroke-dasharray:none}" +
      ".ys-mlp{fill:none;stroke-width:1.4;opacity:.45;cursor:pointer}.ys-ml.on .ys-mlp{stroke-width:3;opacity:1}.ys-ml:hover .ys-mlp{opacity:.9}.ys-el{font-size:11px;font-weight:600;cursor:pointer;opacity:.7}.ys-el.on{font-weight:800;opacity:1;font-size:12px}.ys-lg2{font-size:11.5px;margin:-2px 0 2px}.ys-lg2 i{font-style:normal;margin-right:12px;font-weight:600}.ys-o{color:var(--dim,#9aa7b8)}" +
      ".ys-ls{fill:none;stroke:var(--ys-sp);stroke-width:2.2}.ys-avg{stroke:var(--faint);stroke-dasharray:4 4}.ys-hi{fill:#34d67f}.ys-lo{fill:#ff6262}text.ys-hi{fill:#34d67f}text.ys-lo{fill:#ff6262}.ys-last{fill:var(--ys-sp)}.ys-live{fill:#6cc0ff}text.ys-live{fill:#6cc0ff}" +
      ".ys-rng button{all:unset;cursor:pointer;padding:2px 8px;border:1px solid var(--line);border-radius:999px;margin-left:4px;font-size:11px;text-transform:none}.ys-rng button.on{border-color:var(--ys-sp);color:var(--ys-sp)}" +
      ".ys-read{margin:12px 2px;font-size:14px;line-height:1.5}.ys-tw{overflow-x:auto}.ys-t{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}.ys-t th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);text-align:right;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}.ys-t th:first-child,.ys-t td:first-child{text-align:left}.ys-t td{padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}" +
      ".ys-r{cursor:pointer}.ys-r:hover{background:rgba(255,184,77,.05)}.ys-r.on{background:rgba(255,184,77,.10);box-shadow:inset 3px 0 0 var(--ys-sp)}.ys-cu{color:var(--ys-us)}.ys-cc{color:var(--ys-ca)}.ys-cs{color:var(--ys-sp)}.ys-sp b{font-size:15px;color:var(--ys-sp)}.ys-u{color:#34d67f;font-weight:700}.ys-d{color:#ff6262;font-weight:700}.ys-n{color:var(--faint)}html[data-theme=light] .ys-u{color:#0d8a4a}html[data-theme=light] .ys-d{color:#c62828}" +
      ".ys-w{font-size:10px;color:var(--ys-sp);letter-spacing:.06em;text-transform:uppercase}.ys-tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:4px;border:1px solid var(--line);color:var(--faint);vertical-align:1px}.ys-tag.ok{color:#34d67f;border-color:rgba(52,214,127,.4)}.ys-tag.warn{color:var(--ys-sp);border-color:rgba(255,184,77,.4)}" +
      ".ys-rg{min-width:150px}.ys-rl{font-size:11px;color:var(--faint)}.ys-bar{position:relative;display:inline-block;width:70px;height:6px;margin:0 6px;border-radius:3px;background:linear-gradient(90deg,rgba(255,98,98,.35),rgba(52,214,127,.35));vertical-align:1px}.ys-bar i{position:absolute;top:-3px;width:3px;height:12px;margin-left:-1px;background:var(--ink);border-radius:2px}.ys-dt{color:var(--faint);font-size:12px}.ys-ph{padding:40px;text-align:center;color:var(--faint)}" +
      ".ysm-tile{container-type:inline-size}@container (max-width:980px){.ys-ch{grid-template-columns:1fr}}.ys-t thead{display:table-header-group!important}.ys-t tbody{display:table-row-group!important}.ys-t tr{display:table-row!important}.ys-t td,.ys-t th{display:table-cell!important}.ys-t td:before{content:none!important}@container (max-width:560px){.ys-t td:nth-child(n+8),.ys-t th:nth-child(n+8),.ys-t td:nth-child(5),.ys-t th:nth-child(5){display:none!important}.ys-t{font-size:12px}.ys-t td,.ys-t th{padding:7px 5px}.ys-tag{display:none}.ys-ks{grid-template-columns:repeat(2,minmax(0,1fr))}.ys-k b{font-size:18px}}";
    document.head.appendChild(st);
  }

  function redraw() { var el = document.getElementById("ysm-tile"); if (el) el.outerHTML = html(); }
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("#ysm-tile [data-ysm-t], #ysm-tile [data-ysm-r], #ysm-tile [data-ysm-h], #ysm-tile [data-ysm-b]"); if (!a) return;
    if (a.hasAttribute("data-ysm-t")) S.t = a.getAttribute("data-ysm-t"); else if (a.hasAttribute("data-ysm-h")) S.hm = a.getAttribute("data-ysm-h"); else if (a.hasAttribute("data-ysm-b")) S.basis = a.getAttribute("data-ysm-b"); else S.rng = +a.getAttribute("data-ysm-r");
    redraw();
  });
  document.addEventListener("keydown", function (ev) { if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest("#ysm-tile [data-ysm-t]")) { ev.preventDefault(); ev.target.click(); } });
  css();
  window.YSM = { html: html, model: model };
})();
