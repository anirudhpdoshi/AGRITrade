/* side-top.js — Market pulse band under the menu (Nov 24 2026) + the frozen top of the right-hand panel (owner, Nov 23 2026), above the feed:
     1. Market pulse — Corn · Soybeans · Wheat as their own tiles (click one: that commodity across the reports), then USD/CAD,
        US 10Y and 2Y, US–CA 10Y spread, WTI, DXY, Fed funds, BoC rate — the desk's own data, as the Overview pulse had it
     2. Key events — the next high- and medium-impact releases and central-bank dates, rolling one line at a time
     3. Breakouts — the three newest live breakout / breakdown events
   The feed scrolls underneath; this block stays put. */
(function () {
  "use strict";
  var root = window, doc = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }) + " ET"; }
  function day(t) { var a = new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), b = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), c = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    return a === b ? "Today" : a === c ? "Tomorrow" : new Date(t).toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "short" }); }

  /* ---------- 1. market pulse ---------- */
  var GR = [["corn", "Corn"], ["soybeans", "Soybeans"], ["wheat", "Wheat"]];
  function vis(k) { var L = doc.querySelectorAll('[data-grain-pick="' + k + '"]'); for (var i = 0; i < L.length; i++) if (L[i].offsetParent) return L[i]; return null; }
  function isOn(k) { var b = vis(k); return b ? b.getAttribute("aria-pressed") === "true" : active() === k; }
  function active() { var a = doc.querySelector(".tab-panel.active"); return a ? a.id.replace("panel-", "") : ""; }
  function grain(k) {
    try { var g = DATA.grains[k], f = g.fan, L = +f.intraday[0], A = +f.anchor, c = (g.roll && g.roll[0] && g.roll[0].contract) || ""; if (!isFinite(L)) return null;
      return { k: k, px: L, ch: A ? (L - A) * 100 : null, pct: A ? (L / A - 1) * 100 : null, c: c }; } catch (e) { return null; }
  }
  function pulse() {
    var D = root.DATA; if (!D) return "";
    var tiles = GR.map(function (x) { var g = grain(x[0]); if (!g) return "";
      return '<button type="button" class="st-g ' + cls(g.ch) + (isOn(x[0]) ? " on" : "") + '" data-st-grain="' + x[0] + '" title="Open ' + x[1] + ' — keeps the report you are on"><span class="st-gn">' + x[1] + ' <small>' + esc(g.c) + '</small></span>' +
        '<b class="st-gv">' + nf(g.px, 4) + '</b><span class="st-gc ' + cls(g.ch) + '">' + (g.ch == null ? "" : sg(g.ch, 2, "¢") + "<br>" + sg(g.pct, 2, "%")) + "</span></button>"; }).join("");
    var fx = D.fx || {}, Y = fx.yields_live || {}, y10 = Y["10Y"] || {}, y2 = Y["2Y"] || {}, w = (fx.energy || [])[0] || {}, x = fx.fxcross || {}, P = fx.policy || {};
    var el = doc.getElementById("fx-spot-big"), lv = el ? parseFloat(el.textContent.replace(/[^\d.]/g, "")) : NaN, bsx = root.PRICE_SYNC && PRICE_SYNC.best && PRICE_SYNC.best("CAD=X");
    var spot = isFinite(lv) && lv > 0.5 ? lv : (bsx && bsx.px) || (fx.feed && +fx.feed.mid), ref = fx.spot && +fx.spot.ref, ch = spot && ref ? (spot / ref - 1) * 100 : null;
    var fedM = /(\d{3})-(\d{3})/.exec(P.fed_range || ""), boc = P.boc_decided && P.boc_decided.rate != null ? P.boc_decided.rate : P.corra_now;
    function k(n, v, c, s, pick) { return '<div class="st-k ' + (c || "flat") + (pick ? " st-kp" : "") + '"' + (pick ? ' data-st-grain="' + pick + '" role="button" tabindex="0"' : "") + '><span>' + n + "</span><b>" + v + '</b><i class="' + (c || "") + '">' + (s || "") + "</i></div>"; }
    var ks = (spot ? k("USD/CAD", nf(spot, 4), cls(ch), sg(ch, 2, "%"), "fx") : "") +
      (y10.y != null ? k("US 10Y", nf(+y10.y, 3) + "%", cls(y10.chg_bp), sg(y10.chg_bp, 1, " bp")) : "") +
      (y2.y != null ? k("US 2Y", nf(+y2.y, 3) + "%", cls(y2.chg_bp), sg(y2.chg_bp, 1, " bp")) : "") +
      (y10.sp_ca != null ? k("US–CA 10Y", nf(+y10.sp_ca, 1) + " bp", "", "spread") : "") +
      (w.last != null ? k("WTI", "$" + nf(+w.last, 2), cls(+w.pct), sg(+w.pct, 2, "%")) : "") +
      (x.dxy != null ? k("DXY", nf(+x.dxy, 2), cls(+x.dxy_chg), sg(+x.dxy_chg, 2, "%")) : "") +
      (fedM ? k("Fed funds", (+fedM[1] / 100).toFixed(2) + "–" + (+fedM[2] / 100).toFixed(2), "", "target %") : "") +
      (boc != null ? k("BoC", nf(+boc, 2) + "%", "", "overnight") : "");
    return '<section class="st-sec"><div class="st-h"><b>Market pulse</b><span>desk data</span></div><div class="st-gs">' + tiles + '</div><div class="st-ks">' + ks + "</div></section>";
  }

  /* ---------- 1b. market pulse as a full-width band under the menu (owner, Nov 24 2026):
     Grains · FX · US Treasuries (every tenor + curve) · Crude · Precious metals · Policy, each tile tinted by today's move ---------- */
  function wi(id) { try { var W = root.WORLD && WORLD._data(); return W && W.instruments.filter(function (x) { return x.id === id; })[0] || null; } catch (e) { return null; } }
  function T(n, v, c, s, extra, tip) { return '<div class="pb-t ' + (c || "flat") + (extra || "") + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + "><span>" + n + "</span><b>" + v + "</b><i>" + (s || "&nbsp;") + "</i></div>"; }
  function grp(name, tiles) { return tiles ? '<div class="pb-g"><em>' + name + '</em><div class="pb-r">' + tiles + "</div></div>" : ""; }
  function wt(id, n, d, pre) { var x = wi(id); if (!x || x.last == null) return ""; return T(n, (pre || "") + nf(x.last, d), cls(x.pct), sg(x.pct, 2, "%"), "", x.name + " · " + (x.provider || "delayed") + " · " + (x.ts ? hm(Date.parse(x.ts)) : "")); }
  function bar() {
    var D = root.DATA; if (!D) return "";
    var fx = D.fx || {}, Y = fx.yields_live || {}, x = fx.fxcross || {}, P = fx.policy || {};
    var gr = GR.map(function (q) { var g = grain(q[0]); if (!g) return "";
      return '<button type="button" class="pb-t pb-btn ' + cls(g.ch) + (isOn(q[0]) ? " on" : "") + '" data-st-grain="' + q[0] + '" title="Open ' + q[1] + " " + esc(g.c) + ' — keeps the report you are on' + (g.ch == null ? "" : " · " + sg(g.ch, 2, "¢") + " today") + '"><span>' + q[1] + "</span><b>" + nf(g.px, 4) + "</b><i>" + (g.ch == null ? "&nbsp;" : sg(g.pct, 2, "%")) + "</i></button>"; }).join("");
    var el = doc.getElementById("fx-spot-big"), lv = el ? parseFloat(el.textContent.replace(/[^\d.]/g, "")) : NaN, bsx = root.PRICE_SYNC && PRICE_SYNC.best && PRICE_SYNC.best("CAD=X");
    var spot = isFinite(lv) && lv > 0.5 ? lv : (bsx && bsx.px) || (fx.feed && +fx.feed.mid), ref = fx.spot && +fx.spot.ref, ch = spot && ref ? (spot / ref - 1) * 100 : null;
    var fxt = (spot ? '<div class="pb-t pb-btn ' + cls(ch) + '" data-st-grain="fx" role="button" tabindex="0"><span>USD/CAD</span><b>' + nf(spot, 4) + "</b><i>" + sg(ch, 2, "%") + "</i></div>" : "") +
      (x.dxy != null ? T("DXY", nf(+x.dxy, 2), cls(+x.dxy_chg), sg(+x.dxy_chg, 2, "%")) : "");
    var TEN = ["3M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"], ust = TEN.map(function (t) { var y = Y[t]; return y && y.y != null ? T(t, nf(+y.y, 3) + "%", cls(y.chg_bp), sg(y.chg_bp, 1, " bp"), "", "US " + t + " · " + (y.src || "") + (y.label ? " · " + y.label : "")) : ""; }).join("");
    var c2 = Y["2Y"], c10 = Y["10Y"], c3 = Y["3M"];
    if (c2 && c10 && c2.y != null && c10.y != null) { var sp = (c10.y - c2.y) * 100, spc = c10.chg_bp != null && c2.chg_bp != null ? c10.chg_bp - c2.chg_bp : null;
      ust += T("2s10s", (sp >= 0 ? "+" : "−") + nf(Math.abs(sp), 1) + " bp", cls(spc), spc == null ? (sp < 0 ? "inverted" : "") : sg(spc, 1, " bp"), " pb-dv", "10Y minus 2Y — below zero = inverted curve"); }
    if (c3 && c10 && c3.y != null && c10.y != null) { var sq = (c10.y - c3.y) * 100; ust += T("3M10Y", (sq >= 0 ? "+" : "−") + nf(Math.abs(sq), 1) + " bp", "flat", sq < 0 ? "inverted" : "positive", " pb-dv", "10Y minus 3-month bill — the recession-signal spread"); }
    var E = fx.energy || [], ew = function (nm) { return E.filter(function (e) { return e.name === nm; })[0]; };
    var wti = wi("wti"), brent = wi("brent"), wcs = ew("Western Canadian Select");
    var cru = (wti ? wt("wti", "WTI", 2, "$") : ew("WTI Crude") ? T("WTI", "$" + nf(+ew("WTI Crude").last, 2), cls(+ew("WTI Crude").pct), sg(+ew("WTI Crude").pct, 2, "%")) : "") +
      (brent ? wt("brent", "Brent", 2, "$") : ew("Brent Crude") ? T("Brent", "$" + nf(+ew("Brent Crude").last, 2), cls(+ew("Brent Crude").pct), sg(+ew("Brent Crude").pct, 2, "%")) : "") +
      (wcs ? T("WCS", "$" + nf(+wcs.last, 2), cls(+wcs.pct), sg(+wcs.pct, 2, "%"), "", "Western Canadian Select · " + (wcs.delay || "")) : "") + wt("natgas", "Nat gas", 3, "$");
    if (wti && brent && wti.last && brent.last) cru += T("Brent–WTI", "$" + nf(brent.last - wti.last, 2), "flat", "spread", " pb-dv", "Brent minus WTI");
    var gold = wi("gold"), silver = wi("silver");
    var pm = wt("gold", "Gold", 1, "$") + wt("silver", "Silver", 3, "$") + wt("platinum", "Platinum", 1, "$") + wt("palladium", "Palladium", 1, "$");
    if (gold && silver && gold.last && silver.last) pm += T("Gold/Silver", nf(gold.last / silver.last, 1) + "×", "flat", "ratio", " pb-dv", "ounces of silver per ounce of gold");
    var fedM = /(\d{3})-(\d{3})/.exec(P.fed_range || ""), boc = P.boc_decided && P.boc_decided.rate != null ? P.boc_decided.rate : P.corra_now;
    var pol = (fedM ? T("Fed funds", (+fedM[1] / 100).toFixed(2) + "–" + (+fedM[2] / 100).toFixed(2) + "%", "flat", "target") : "") + (boc != null ? T("BoC", nf(+boc, 2) + "%", "flat", "overnight") : "");
    /* Canada curve and the US–Canada gaps that drive USD/CAD */
    var wy = function (id, n, tip) { var q = wi(id); if (!q || q.last == null) return ""; var bp = q.kind === "spread" ? q.chg : q.chg != null ? q.chg * 100 : null;
      return T(n, q.kind === "spread" ? nf(q.last, 1) + " bp" : nf(q.last, 3) + "%", cls(bp), sg(bp, 1, " bp"), q.kind === "spread" ? " pb-dv" : "", tip || q.name); };
    var can = wy("ca2y", "CA 2Y") + wy("ca10y", "CA 10Y") + wy("usca2y", "US–CA 2Y", "US 2Y minus Canada 2Y — wider = more USD/CAD support") + wy("usca10y", "US–CA 10Y", "US 10Y minus Canada 10Y");
    /* risk gauges: VIX (rising = risk-off, so red) and copper/gold (growth vs fear) */
    var vix = wi("vix"), cu = wi("copper"), rk = "";
    if (vix && vix.last != null) rk += T("VIX", nf(vix.last, 2), vix.pct > 0 ? "dn" : vix.pct < 0 ? "up" : "flat", sg(vix.pct, 2, "%"), "", "S&P 500 implied volatility — rising VIX = risk-off (shown red)");
    if (cu && gold && cu.last && gold.last) { var r = cu.last / gold.last * 1000, r0 = cu.prev_close && gold.prev_close ? cu.prev_close / gold.prev_close * 1000 : null;
      rk += T("Cu/Gold", nf(r, 3), cls(r0 ? r - r0 : null), r0 ? sg((r / r0 - 1) * 100, 2, "%") : "×1000", " pb-dv", "Copper ($/lb) ÷ gold ($/oz) × 1000 — rising = growth optimism, falling = defensive"); }
    return grp("Grains", gr) + grp("FX", fxt) + grp("Crude", cru) + grp("US Treasuries", ust) + grp("Canada", can) + grp("Metals", pm) + grp("Risk", rk) + grp("Policy", pol);
  }
  function mountBar() {
    var g = doc.getElementById("gnav"); if (!g) return;
    var B = doc.getElementById("pulse-bar");
    if (!B) { B = doc.createElement("div"); B.id = "pulse-bar"; B.setAttribute("aria-label", "Market pulse"); g.parentNode.insertBefore(B, g.nextSibling); }
    var top = (parseFloat(getComputedStyle(g).top) || 0) + g.offsetHeight; if (B._top !== top) { B.style.top = top + "px"; B._top = top; }
    if (!B.querySelector(".pb-in")) B.innerHTML = '<button type="button" class="pb-ar l" data-pb="-1" aria-label="Scroll left">‹</button><div class="pb-in"></div><button type="button" class="pb-ar r" data-pb="1" aria-label="Scroll right">›</button>';
    var I = B.querySelector(".pb-in"), h = bar(); if (I._h !== h) { var sl = I.scrollLeft; I.innerHTML = h; I._h = h; I.scrollLeft = sl; }
    edges(B, I);
  }
  /* slow ticker: drifts right ~24 px/s so every tile comes past; pauses on hover / touch / after any manual scroll, rewinds at the end */
  var PB = { hold: 0, last: 0, wait: 0 };
  setInterval(function () {
    var I = doc.querySelector("#pulse-bar .pb-in"); if (!I || doc.hidden || I.scrollWidth <= I.clientWidth + 4 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var now = Date.now(); if (I.matches(":hover") || now < PB.hold || now < PB.wait) return;
    if (I.scrollLeft + I.clientWidth >= I.scrollWidth - 2) { PB.wait = now + 3000; setTimeout(function () { I.scrollTo({ left: 0, behavior: "smooth" }); PB.wait = Date.now() + 2500; }, 3000); return; }
    I.style.scrollBehavior = "auto"; I.scrollLeft += 1; I.style.scrollBehavior = "";
  }, 42);
  ["wheel", "touchstart", "mousedown", "keydown"].forEach(function (t) { doc.addEventListener(t, function (e) { if (e.target.closest && e.target.closest("#pulse-bar")) PB.hold = Date.now() + 15000; }, { passive: true }); });
  function edges(B, I) { B.classList.toggle("at-l", I.scrollLeft < 4); B.classList.toggle("at-r", I.scrollLeft + I.clientWidth >= I.scrollWidth - 4); }
  doc.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("[data-pb]"); if (!a) return; var I = doc.querySelector("#pulse-bar .pb-in"); if (I) I.scrollBy({ left: +a.getAttribute("data-pb") * I.clientWidth * 0.8, behavior: "smooth" }); });
  doc.addEventListener("scroll", function (e) { if (e.target && e.target.classList && e.target.classList.contains("pb-in")) edges(e.target.parentNode, e.target); }, true);
  doc.addEventListener("wheel", function (e) { var B = e.target.closest && e.target.closest("#pulse-bar .pb-in"); if (!B || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; B.scrollLeft += e.deltaY; e.preventDefault(); }, { passive: false });

  /* ---------- 2. key events, rolling, with a countdown to the next one ---------- */
  var EVI = 0, NEXT = null;
  function cd(t) { var s = Math.max(0, Math.round((t - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (d ? d + "d " : "") + (d || h ? h + "h " : "") + ("0" + m).slice(-2) + "m " + ("0" + x).slice(-2) + "s"; }
  function tick() { var b = doc.querySelector("[data-st-cd]"); if (!b) return; var t = +b.getAttribute("data-st-cd"); if (t <= Date.now()) { paint(); return; } var v = cd(t); if (b.textContent !== v) b.textContent = v; }
  function evList() {
    var now = Date.now(), L = [], seen = {};
    try { for (var d = 0; d < 7; d++) (EVENTS.on(now + d * 864e5) || []).forEach(function (e) {
      var lb = String(e.label || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!(e.t > now) || !lb || /refresh|on the desk|session opens|session closes|settlement|grains (open|close)|hard exit|desk rule/i.test(lb) || seen[lb + e.t]) return; seen[lb + e.t] = 1; L.push({ t: e.t, lb: lb, hi: !!e.high, imp: e.high || e.impact === "High" ? "h" : e.impact === "Medium" ? "m" : "l" }); }); } catch (e) {}
    L.sort(function (a, b) { return a.t - b.t; });
    var hi = L.filter(function (e) { return e.hi; }); return (hi.length >= 3 ? hi : L).slice(0, 8);
  }
  function events() {
    var L = evList(); if (!L.length) return '<section class="st-sec st-ev"><div class="st-h"><b>Key events</b></div><div class="st-evw"><p class="st-none">Nothing scheduled in the next 7 days on the loaded calendar.</p></div></section>';
    NEXT = L[0];
    var IMP = { h: ["HIGH", "Red = high importance"], m: ["MED", "Amber = medium importance"], l: ["LOW", "Grey = low importance"] };
    return '<section class="st-sec st-ev"><div class="st-h"><b>Key events</b><span>' + L.length + ' upcoming · <a href="#" data-evgo="events:">all</a></span></div>' +
      '<div class="st-cd ' + L[0].imp + '"><span class="st-cdl">Next</span><b class="st-cdt" data-st-cd="' + L[0].t + '">' + cd(L[0].t) + '</b><span class="st-cdn" title="' + esc(L[0].lb) + '">' + esc(L[0].lb) + "</span></div>" +
      '<div class="st-evw" aria-live="polite"><ul class="st-evl">' +
      L.map(function (e) { return '<li class="i' + e.imp + '"><i class="st-imp" title="' + IMP[e.imp][1] + '">' + IMP[e.imp][0] + "</i><time>" + day(e.t) + " " + hm(e.t) + '</time><span title="' + esc(e.lb) + '">' + esc(e.lb) + "</span></li>"; }).join("") + "</ul></div></section>";
  }
  function roll() {   /* one line at a time, sliding up every 4 s */
    var ul = doc.querySelector(".st-evl"); if (!ul || ul.children.length < 2 || doc.hidden) return;
    var n = ul.children.length; EVI = (EVI + 1) % n;
    ul.style.transform = "translateY(" + (-EVI * 22) + "px)";
  }

  /* ---------- 3. breakouts, three lines ---------- */
  function breakouts() {
    var B = root.BREAKOUTS && BREAKOUTS.data && BREAKOUTS.data(), E = (B && B.events || []).slice().sort(function (a, b) { return Date.parse(b.t) - Date.parse(a.t); }).slice(0, 3);
    return '<section class="st-sec st-br"><div class="st-h"><b>Breakouts</b><span>live · <a href="#" data-st-go="breakouts">open</a></span></div>' +
      (E.length ? '<ul class="st-brl">' + E.map(function (e) { return '<li class="' + (e.dir > 0 ? "u" : "d") + '" data-st-id="' + esc(e.id) + '"><time>' + hm(Date.parse(e.t)) + "</time><b>" + esc(e.s) + "</b><span>" + esc(String(e.txt || "").replace(/^\S+\s+—\s+/, "")) + "</span></li>"; }).join("") + "</ul>"
        : '<p class="st-none">No breakouts yet today — the scanner runs every 5 min, 8 AM–6 PM ET on weekdays.</p>') + "</section>";
  }

  /* ---------- mount inside the feed drawer, above the feed ---------- */
  var lastBr = "";
  function paint() {
    var host = doc.querySelector(".fr-drawer .fr-top"); if (!host) { mountBar(); return; }
    mountBar();
    var p = "", e = events(), b = breakouts();
    var P = host.querySelector(".st-w1"), Ev = host.querySelector(".st-w2"), Br = host.querySelector(".st-w3");
    if (!P) { host.innerHTML = '<div class="st-w1"></div><div class="st-w2"></div><div class="st-w3"></div>'; P = host.querySelector(".st-w1"); Ev = host.querySelector(".st-w2"); Br = host.querySelector(".st-w3"); }
    if (P._h !== p) { P.innerHTML = p; P._h = p; P.style.display = p ? "" : "none"; }
    var ek = e.replace(/(data-st-cd="\d+">)[^<]*/, "$1");   /* the countdown ticks on its own — not a reason to redraw */
    if (Ev._h !== ek) { Ev.innerHTML = e; Ev._h = ek; EVI = 0; }
    if (Br._h !== b) { var first = !Br._h; Br.innerHTML = b; Br._h = b; var top = Br.querySelector(".st-brl li"); if (top && !first && top.getAttribute("data-st-id") !== lastBr) top.classList.add("st-new"); lastBr = top ? top.getAttribute("data-st-id") : ""; }
  }
  doc.addEventListener("click", function (ev) {
    var g = ev.target.closest && ev.target.closest("[data-st-grain]");
    if (g) { var k = g.getAttribute("data-st-grain");
      /* on a grain or USD/CAD page (Grains or Positioning) keep the report and switch the commodity; elsewhere open Grains on it */
      var pick = vis(k);
      if (pick) pick.click();
      else { var gb = doc.querySelector('[data-gnav="grains"]'); if (gb) gb.click(); setTimeout(function () { var p2 = doc.querySelector('[data-grain-pick="' + k + '"]'); if (p2) p2.click(); }, 60); }
      setTimeout(paint, 120); return; }
    var go = ev.target.closest && ev.target.closest("[data-st-go]");
    if (go) { ev.preventDefault(); var b = doc.querySelector('[data-gnav="' + go.getAttribute("data-st-go") + '"]'); if (b) b.click(); }
  });
  setInterval(paint, 2000); setInterval(roll, 4000); setInterval(tick, 1000); setTimeout(paint, 800);

  var st = doc.createElement("style");
  st.textContent =
    ".fr-top{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding-right:22px}.fr-top:empty{display:none}" +
    ".st-sec{border:1px solid rgba(255,255,255,.10);border-radius:9px;background:rgba(255,255,255,.03);padding:7px 8px}" +
    ".st-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:5px}.st-h b{font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#d9b46a}.st-h span{font-size:10.5px;color:var(--muted)}.st-h a{color:var(--cyan)}" +
    ".st-gs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:6px}" +
    ".st-g{appearance:none;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.18);border-radius:7px;padding:5px 7px;cursor:pointer;color:var(--ink);display:flex;flex-direction:column;gap:1px;min-width:0}" +
    ".st-g:hover{border-color:#d9b46a}.st-g.on{border-color:#d9b46a;box-shadow:inset 0 -2px 0 #d9b46a}.st-gn{font:600 11px 'IBM Plex Sans',sans-serif;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.st-gn small{display:block;font:10px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".st-gv{font:700 15px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.st-gc{font:600 10.5px/1.3 'IBM Plex Mono',monospace;white-space:nowrap}.st-gc.up,.st-k i.up{color:#3fb97f}.st-gc.dn,.st-k i.dn{color:#ff6b62}" +
    ".st-ks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 6px}.st-k{min-width:0}.st-k span{display:block;font:600 9.5px 'IBM Plex Mono',monospace;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}" +
    ".st-k b{display:block;font:600 12px 'IBM Plex Mono',monospace;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}.st-k i{display:block;font:normal 10px 'IBM Plex Mono',monospace;color:var(--faint);white-space:nowrap}.st-kp{cursor:pointer}.st-kp:hover b{color:#d9b46a}" +
    ".st-evw{height:22px;overflow:hidden;position:relative}.st-evl{list-style:none;margin:0;padding:0;transition:transform .55s cubic-bezier(.3,.7,.2,1)}.st-evl li{height:22px;display:flex;gap:7px;align-items:center;font-size:12px;white-space:nowrap}" +
    ".st-evl time{font:600 10.5px 'IBM Plex Mono',monospace;color:var(--cyan);flex:0 0 auto}.st-evl li.hi time{color:#e3c14d}.st-evl span{overflow:hidden;text-overflow:ellipsis;color:var(--ink)}" +
    ".st-brl{list-style:none;margin:0;padding:0}.st-brl li{display:grid;grid-template-columns:auto auto 1fr;gap:2px 6px;align-items:baseline;font-size:11.5px;line-height:1.35;border-left:2px solid transparent;padding:3px 0 3px 6px}" +
    ".st-brl li.u{border-left-color:#3fb97f}.st-brl li.d{border-left-color:#ff6b62}.st-brl time{font:10.5px 'IBM Plex Mono',monospace;color:var(--faint)}.st-brl b{font:700 11px 'IBM Plex Mono',monospace}.st-brl span{color:var(--ink);white-space:normal;overflow-wrap:anywhere}.st-brl time{white-space:nowrap}.st-brl b{white-space:nowrap}" +
    ".st-brl li.st-new{animation:stIn .6s ease-out}@keyframes stIn{from{opacity:0;background:rgba(217,180,106,.25)}to{opacity:1;background:transparent}}" +
    ".st-g.up{background:rgba(63,185,127,.13);border-color:rgba(63,185,127,.45)}.st-g.dn{background:rgba(255,107,98,.13);border-color:rgba(255,107,98,.45)}" +
    ".st-k{border-radius:6px;padding:3px 5px;border:1px solid transparent}.st-k.up{background:rgba(63,185,127,.12);border-color:rgba(63,185,127,.35)}.st-k.dn{background:rgba(255,107,98,.12);border-color:rgba(255,107,98,.35)}.st-k.flat{background:rgba(255,255,255,.03)}" +
    ".st-cd{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:baseline;padding:4px 6px;margin-bottom:4px;border-radius:6px;background:rgba(255,255,255,.04);border-left:3px solid #8f9db3}.st-cd.h{border-left-color:#ff5a52;background:rgba(255,90,82,.10)}.st-cd.m{border-left-color:#e3a33a}" +
    ".st-cdl{font:700 9.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}.st-cdt{font:700 13px 'IBM Plex Mono',monospace;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}.st-cdn{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".st-imp{font:700 8.5px 'IBM Plex Mono',monospace;font-style:normal;padding:1px 4px;border-radius:3px;flex:0 0 auto;letter-spacing:.04em}.st-evl li.ih .st-imp{background:#ff5a52;color:#fff}.st-evl li.im .st-imp{background:#e3a33a;color:#1a1a1a}.st-evl li.il .st-imp{background:rgba(143,157,179,.3);color:var(--muted)}" +
    ".st-evl li.ih time{color:#ff7a72}" +
    "#pulse-bar{position:sticky;z-index:40;display:flex;align-items:stretch;margin:0 0 8px;background:rgba(8,12,18,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--line2);border-top:1px solid var(--line);box-shadow:0 6px 14px -10px rgba(0,0,0,.6)}" +
    "#pulse-bar:empty{display:none}.pb-in{flex:1 1 auto;min-width:0;display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:4px 4px;scroll-behavior:smooth}.pb-in::-webkit-scrollbar{display:none}" +
    ".pb-ar{flex:0 0 22px;appearance:none;border:0;background:rgba(255,255,255,.04);color:#d9b46a;font:700 18px/1 'IBM Plex Mono',monospace;cursor:pointer}.pb-ar:hover{background:rgba(217,180,106,.15)}#pulse-bar.at-l .pb-ar.l,#pulse-bar.at-r .pb-ar.r{opacity:.25;pointer-events:none}" +
    ".pb-g{display:flex;align-items:stretch;gap:3px;flex:0 0 auto}.pb-g>em{align-self:center;max-width:56px;font:700 8.5px/1.15 'IBM Plex Mono',monospace;font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:#d9b46a;text-align:right;padding-right:4px;border-right:1px solid rgba(217,180,106,.35)}" +
    ".pb-r{display:flex;gap:3px}.pb-t{appearance:none;min-width:0;text-align:left;border:1px solid rgba(255,255,255,.10);border-radius:5px;padding:2px 6px 1px;background:rgba(255,255,255,.03);color:var(--ink);display:grid;grid-template-columns:auto auto;column-gap:6px;line-height:1.2;font:inherit}" +
    ".pb-t span{grid-column:1;font:600 9px 'IBM Plex Mono',monospace;color:var(--faint);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}.pb-t span small{font-size:8.5px;color:var(--faint)}" +
    ".pb-t i{grid-column:2;grid-row:1;text-align:right;font:normal 9.5px 'IBM Plex Mono',monospace;color:var(--muted);white-space:nowrap}.pb-t b{grid-column:1/3;font:700 12.5px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".pb-t.up{background:rgba(63,185,127,.13);border-color:rgba(63,185,127,.42)}.pb-t.up i{color:#3fb97f}.pb-t.dn{background:rgba(255,107,98,.13);border-color:rgba(255,107,98,.42)}.pb-t.dn i{color:#ff6b62}" +
    ".pb-t.pb-dv{border-style:dashed}.pb-btn{cursor:pointer}.pb-btn:hover{border-color:#d9b46a}.pb-btn.on{box-shadow:inset 0 -2px 0 #d9b46a;border-color:#d9b46a}" +
    "body.locked #pulse-bar{display:none}" +
    ".st-none{margin:0;font-size:11.5px;color:var(--muted)}" +
    "@media (prefers-reduced-motion:reduce){.st-evl{transition:none}.st-brl li.st-new{animation:none}}";
  doc.head.appendChild(st);
  root.SIDE_TOP = { paint: paint };
})();
