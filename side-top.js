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
  /* the old Execution Tiles strip is hidden (owner, Nov 24 2026) — its buttons still carry the commodity-switch logic, so the band drives them */
  function onGrainPage() { return doc.body.classList.contains("gr3"); }
  function vis(k) { return onGrainPage() ? doc.querySelector('#grains-head [data-grain-pick="' + k + '"]') : null; }
  function isOn(k) { var b = vis(k); return b ? b.getAttribute("aria-pressed") === "true" || b.classList.contains("on") || b.classList.contains("sel") : active() === k; }
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
  /* change line: ▲/▼ absolute (and %) — colour carries direction, the arrow carries it too for colour-blind reading */
  function chg(c, abs, pct) { if (abs == null && pct == null) return ""; var ar = c === "up" ? "▲" : c === "dn" ? "▼" : "";
    return ar + (abs != null ? abs + (pct != null ? " (" + pct + ")" : "") : pct); }
  /* every tile opens its price chart (pricechart.js): data-pc = chart key, data-pv = the live value for the chart's last point */
  function T(n, v, c, s, extra, tip, key, raw) { return '<div class="pb-t ' + (c || "flat") + (extra || "") + (key ? " pb-btn" : "") + '"' + (key ? ' data-pc="' + key + '" role="button" tabindex="0"' + (raw != null && isFinite(raw) ? ' data-pv="' + raw + '"' : "") : "") + (tip ? ' title="' + esc(tip) + '"' : "") + "><span>" + n + "</span><b>" + v + "</b><i>" + (s || "&nbsp;") + "</i></div>"; }
  function grp(name, tiles) { return tiles ? '<div class="pb-g"><em>' + name + '</em><div class="pb-r">' + tiles + "</div></div>" : ""; }
  function wt(id, n, d, pre) { var x = wi(id); if (!x || x.last == null) return ""; var c = cls(x.pct);
    return T(n, (pre || "") + nf(x.last, d), c, chg(c, null, sg(x.pct, 2, "%")), "", x.name + " · " + (x.provider || "delayed") + (x.ts ? " · " + hm(Date.parse(x.ts)) : "") + " · click for the price chart", id, x.last); }
  function bar() {
    var D = root.DATA; if (!D) return "";
    var fx = D.fx || {}, Y = fx.yields_live || {}, x = fx.fxcross || {}, P = fx.policy || {};
    var gr = GR.map(function (q) { var g = grain(q[0]); if (!g) return ""; var c = cls(g.ch);
      return '<button type="button" class="pb-t pb-btn ' + c + (isOn(q[0]) ? " on" : "") + '" data-pc="' + q[0] + '" data-pv="' + g.px + '" title="' + q[1] + " " + esc(g.c) + ' — click for the price chart' + (g.ch == null ? "" : " · " + sg(g.ch, 2, "¢") + " today") + '"><span>' + q[1] + " " + esc(g.c) + "</span><b>" + nf(g.px, 4) + "</b><i>" +
        (g.ch == null ? "&nbsp;" : chg(c, sg(g.ch, 2, "¢"), null)) + "</i></button>"; }).join("");
    var el = doc.getElementById("fx-spot-big"), lv = el ? parseFloat(el.textContent.replace(/[^\d.]/g, "")) : NaN, bsx = root.PRICE_SYNC && PRICE_SYNC.best && PRICE_SYNC.best("CAD=X");
    var spot = isFinite(lv) && lv > 0.5 ? lv : (bsx && bsx.px) || (fx.feed && +fx.feed.mid), ref = fx.spot && +fx.spot.ref, ch = spot && ref ? (spot / ref - 1) * 100 : null, cc = cls(ch);
    gr += (spot ? '<div class="pb-t pb-btn ' + cc + '" data-pc="usdcad" data-pv="' + spot + '" role="button" tabindex="0" title="USD/CAD — click for the price chart"><span>USD/CAD</span><b>' + nf(spot, 4) + "</b><i>" + chg(cc, null, sg(ch, 2, "%")) + "</i></div>" : "") +
      (x.dxy != null ? T("DXY", nf(+x.dxy, 2), cls(+x.dxy_chg), chg(cls(+x.dxy_chg), null, sg(+x.dxy_chg, 2, "%")), "", "US Dollar Index", "dxy", +x.dxy) : "");
    var E = fx.energy || [], ew = function (nm) { return E.filter(function (e) { return e.name === nm; })[0]; };
    var eT = function (n, e, tip, key) { if (!e || e.last == null) return ""; var c = cls(+e.pct); return T(n, "$" + nf(+e.last, 2), c, chg(c, null, sg(+e.pct, 2, "%")), "", tip || e.name, key, +e.last); };
    var wti = wi("wti"), brent = wi("brent");
    var cru = (wti ? wt("wti", "WTI", 2, "$") : eT("WTI", ew("WTI Crude"), "", "wti")) + (brent ? wt("brent", "Brent", 2, "$") : eT("Brent", ew("Brent Crude"), "", "brent")) +
      eT("WCS", ew("Western Canadian Select"), "Western Canadian Select · " + ((ew("Western Canadian Select") || {}).delay || ""), "wcs") + wt("natgas", "Nat gas", 3, "$");
    if (wti && brent && wti.last && brent.last) cru += T("Brent–WTI", "$" + nf(brent.last - wti.last, 2), "flat", "spread", " pb-dv", "Brent minus WTI", "brentwti", brent.last - wti.last);
    var fedM = /(\d{3})-(\d{3})/.exec(P.fed_range || ""), boc = P.boc_decided && P.boc_decided.rate != null ? P.boc_decided.rate : P.corra_now;
    var pol = (fedM ? T("Fed funds", (+fedM[1] / 100).toFixed(2) + "–" + (+fedM[2] / 100).toFixed(2) + "%", "flat", "target", "", "Fed funds target range", "fed", +fedM[2] / 100) : "") + (boc != null ? T("BoC", nf(+boc, 2) + "%", "flat", "overnight", "", "Bank of Canada policy rate", "boc", +boc) : "");
    var ust = ["3M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"].map(function (t) { var y = Y[t]; if (!y || y.y == null) return ""; var c = cls(y.chg_bp);
      return T(t, nf(+y.y, 3) + "%", c, chg(c, sg(y.chg_bp, 1, " bp"), null), "", "US " + t + " · " + (y.src || "") + (y.label ? " · " + y.label : ""), "ust" + t, +y.y); }).join("");
    var c2 = Y["2Y"], c10 = Y["10Y"], c3 = Y["3M"];
    if (c2 && c10 && c2.y != null && c10.y != null) { var sp = (c10.y - c2.y) * 100; ust += T("2s10s", (sp >= 0 ? "+" : "−") + nf(Math.abs(sp), 1) + " bp", "flat", sp < 0 ? "inverted" : "positive", " pb-dv", "10Y minus 2Y — below zero = inverted curve" + (c3 && c3.y != null ? " · 3M10Y " + ((c10.y - c3.y) * 100).toFixed(1) + " bp" : ""), "s2s10s", sp); }
    var gold = wi("gold"), silver = wi("silver");
    var pm = wt("gold", "Gold", 1, "$") + wt("silver", "Silver", 3, "$") + wt("platinum", "Platinum", 1, "$") + wt("palladium", "Palladium", 1, "$");
    if (gold && silver && gold.last && silver.last) pm = pm.replace('title="' + esc(gold.name), 'title="Gold/silver ratio ' + nf(gold.last / silver.last, 1) + "× · " + esc(gold.name));   /* ratio lives in the gold tile's tooltip to keep the band at two rows */
    var wy = function (id, n, tip) { var q = wi(id); if (!q || q.last == null) return ""; var bp = q.kind === "spread" ? q.chg : q.chg != null ? q.chg * 100 : null, c = cls(bp);
      return T(n, q.kind === "spread" ? nf(q.last, 1) + " bp" : nf(q.last, 3) + "%", c, chg(c, sg(bp, 1, " bp"), null), q.kind === "spread" ? " pb-dv" : "", tip || q.name); };
    var pair = function (a, b, n, sp, tip) { var A = wi(a), Bq = wi(b); if (!A || !Bq || A.last == null || Bq.last == null) return "";
      var ca = sp ? A.chg : A.chg * 100, cb = sp ? Bq.chg : Bq.chg * 100, c = cls((ca || 0) + (cb || 0));
      return T(n, sp ? nf(A.last, 0) + " / " + nf(Bq.last, 0) + " bp" : nf(A.last, 2) + " / " + nf(Bq.last, 2) + "%", c, sg(ca, 1, "") + " / " + sg(cb, 1, " bp"), sp ? " pb-dv" : "", tip, a, A.last); };
    var can = pair("ca2y", "ca10y", "CA 2Y / 10Y", false, "Government of Canada 2Y and 10Y yields · change in bp") + pair("usca2y", "usca10y", "US–CA 2Y / 10Y", true, "US minus Canada yield gap, 2Y and 10Y — wider = more USD/CAD support");
    var vix = wi("vix"), cu = wi("copper"), rk = "";
    if (vix && vix.last != null) { var vc = vix.pct > 0 ? "dn" : vix.pct < 0 ? "up" : "flat"; rk += T("VIX", nf(vix.last, 2), vc, (vix.pct > 0 ? "▲" : vix.pct < 0 ? "▼" : "") + sg(vix.pct, 2, "%"), "", "S&P 500 implied volatility — rising VIX = risk-off (shown red)", "vix", vix.last); }
    if (cu && gold && cu.last && gold.last) { var r = cu.last / gold.last * 1000, r0 = cu.prev_close && gold.prev_close ? cu.prev_close / gold.prev_close * 1000 : null, rc = cls(r0 ? r - r0 : null);
      rk += T("Cu/Gold", nf(r, 3), rc, r0 ? chg(rc, null, sg((r / r0 - 1) * 100, 2, "%")) : "×1000", " pb-dv", "Copper ($/lb) ÷ gold ($/oz) × 1000 — rising = growth optimism, falling = defensive", "cugold", r); }
    return grp("Grains &amp; FX", gr) + grp("Crude &amp; gas", cru) + grp("Policy", pol) + grp("Risk", rk) + grp("US Treasuries", ust) + grp("Precious metals", pm) + grp("Canada", can);
  }
  function mountBar() {
    var g = doc.getElementById("gnav"); if (!g) return;
    var B = doc.getElementById("pulse-bar");
    /* the band sits above the menu and is frozen at the very top; the menu freezes right under it (live.js sizes --strip-h from the band) */
    if (!B) { B = doc.createElement("div"); B.id = "pulse-bar"; B.className = "no-nf no-tx"; B.setAttribute("aria-label", "Market pulse"); }
    if (B.nextSibling !== g) g.parentNode.insertBefore(B, g);
    var h = bar(); if (B._h !== h) { B.innerHTML = h; B._h = h; }
  }


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
  /* one-line read: "Crossed below its 200-day MA (615.15) — provisional…" -> "▼ Below 200D MA 615.15 *" (full text in the tooltip) */
  function brShort(t, dir) {
    var ar = dir > 0 ? "▲ " : dir < 0 ? "▼ " : "", pv = /provisional/i.test(t) ? " *" : "", m;
    t = t.replace(/\s*—\s*provisional.*$/i, "");
    if ((m = /^(Crossed|Closed) (above|below) its (\d+)-day (EMA|MA)\s*\(([^)]+)\)/i.exec(t))) return ar + (m[1] === "Closed" ? "Closed " + m[2] : m[2][0].toUpperCase() + m[2].slice(1)) + " " + m[3] + "D " + m[4].toUpperCase() + " " + m[5] + pv;
    if ((m = /^New (day|52-week|intraday) (high|low)\s*([\d.,]+)?/i.exec(t))) return ar + (m[1] === "52-week" ? "52W " : "Day ") + m[2] + (m[3] ? " " + m[3] : "") + pv;
    return ar + t + pv;
  }
  function breakouts() {
    var B = root.BREAKOUTS && BREAKOUTS.data && BREAKOUTS.data(), E = (B && B.events || []).slice().sort(function (a, b) { return Date.parse(b.t) - Date.parse(a.t); }).slice(0, 3);
    return '<section class="st-sec st-br"><div class="st-h"><b>Breakouts</b><span title="* = provisional until the close · hover a line for the full text">* until close · live · <a href="#" data-st-go="breakouts">open</a></span></div>' +
      (E.length ? '<ul class="st-brl">' + E.map(function (e) { var nmv = (BREAKOUTS.name && BREAKOUTS.name(e)) || e.n || e.s;   /* the name, not the ticker (owner, Nov 24 2026) */
        var full = String(e.txt || "").replace(/^\S+\s+—\s+/, "");
        return '<li class="' + (e.dir > 0 ? "u" : "d") + '" data-st-id="' + esc(e.id) + '" title="' + esc(nmv + " (" + e.s + ") — " + full) + '"><time>' + hm(Date.parse(e.t)) + "</time><b>" + esc(nmv) + "</b><span>" + esc(brShort(full, e.dir)) + "</span></li>"; }).join("") + "</ul>"
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
    ".st-brl{list-style:none;margin:0;padding:0}.st-brl li{display:grid;grid-template-columns:auto minmax(0,max-content) minmax(0,1fr);gap:6px;align-items:baseline;font-size:11.5px;line-height:1.4;border-left:2px solid transparent;padding:3px 0 3px 6px;white-space:nowrap}" +
    ".st-brl li b{max-width:120px;overflow:hidden;text-overflow:ellipsis}.st-brl li span{overflow:hidden!important;text-overflow:ellipsis;white-space:nowrap!important}" +
    ".st-brl li.u{border-left-color:#3fb97f}.st-brl li.d{border-left-color:#4f8cff}.st-brl li.u b,.st-brl li.u span{color:#3fb97f}.st-brl li.d b,.st-brl li.d span{color:#6ea2ff}.st-brl time{font:10.5px 'IBM Plex Mono',monospace;color:var(--faint)}.st-brl b{font:700 11px 'IBM Plex Mono',monospace}.st-brl span{color:var(--ink);white-space:normal;overflow-wrap:anywhere}.st-brl time{white-space:nowrap}.st-brl b{white-space:nowrap}" +
    ".st-brl li.st-new{animation:stIn .6s ease-out}@keyframes stIn{from{opacity:0;background:rgba(217,180,106,.25)}to{opacity:1;background:transparent}}" +
    ".st-g.up{background:rgba(63,185,127,.13);border-color:rgba(63,185,127,.45)}.st-g.dn{background:rgba(255,107,98,.13);border-color:rgba(255,107,98,.45)}" +
    ".st-k{border-radius:6px;padding:3px 5px;border:1px solid transparent}.st-k.up{background:rgba(63,185,127,.12);border-color:rgba(63,185,127,.35)}.st-k.dn{background:rgba(255,107,98,.12);border-color:rgba(255,107,98,.35)}.st-k.flat{background:rgba(255,255,255,.03)}" +
    ".st-cd{display:grid;grid-template-columns:auto auto 1fr;gap:6px;align-items:baseline;padding:4px 6px;margin-bottom:4px;border-radius:6px;background:rgba(255,255,255,.04);border-left:3px solid #8f9db3}.st-cd.h{border-left-color:#ff5a52;background:rgba(255,90,82,.10)}.st-cd.m{border-left-color:#e3a33a}" +
    ".st-cdl{font:700 9.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}.st-cdt{font:700 13px 'IBM Plex Mono',monospace;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}.st-cdn{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".st-imp{font:700 8.5px 'IBM Plex Mono',monospace;font-style:normal;padding:1px 4px;border-radius:3px;flex:0 0 auto;letter-spacing:.04em}.st-evl li.ih .st-imp{background:#ff5a52;color:#fff}.st-evl li.im .st-imp{background:#e3a33a;color:#1a1a1a}.st-evl li.il .st-imp{background:rgba(143,157,179,.3);color:var(--muted)}" +
    ".st-evl li.ih time{color:#ff7a72}" +
    "#pulse-bar{position:sticky;top:0;z-index:42;display:flex;flex-wrap:wrap;gap:6px 0;align-items:flex-start;padding:6px 16px 7px;margin:0;background:var(--bg,#05080c);border-bottom:1px solid var(--line2);box-shadow:0 8px 16px -12px rgba(0,0,0,.7)}" +
    "#pulse-bar:empty{display:none}.pb-g{display:flex;flex-direction:column;gap:3px;flex:0 0 auto;padding:0 6px;border-left:1px solid var(--line)}.pb-g:first-child{border-left:0;padding-left:0}" +
    ".pb-g>em{font:700 10px 'IBM Plex Mono',monospace;font-style:normal;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a;border-left:3px solid #d9b46a;padding-left:6px;line-height:1.1}" +
    ".pb-r{display:flex;gap:3px}.pb-t{appearance:none;min-width:0;text-align:left;border:1px solid rgba(255,255,255,.10);border-radius:6px;padding:2px 5px 3px;background:rgba(255,255,255,.035);color:var(--ink);display:flex;flex-direction:column;gap:1px;line-height:1.2;font:inherit}" +
    ".pb-t span{font:600 8.5px 'IBM Plex Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}.pb-t b{font:700 12.5px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink)}" +
    ".pb-t i{font:600 9.5px 'IBM Plex Mono',monospace;font-style:normal;color:var(--faint);white-space:nowrap}" +
    ".pb-t.up{background:rgba(63,185,127,.12);border-color:rgba(63,185,127,.40)}.pb-t.up i,.pb-t.up span{color:#3fb97f}.pb-t.dn{background:rgba(255,107,98,.12);border-color:rgba(255,107,98,.40)}.pb-t.dn i{color:#ff6b62}" +
    ".pb-t.flat{background:rgba(143,157,179,.07);border-color:rgba(143,157,179,.22)}.pb-t.pb-dv{border-style:dashed}.pb-btn{cursor:pointer}.pb-btn:hover{border-color:#d9b46a}.pb-btn.on{box-shadow:inset 0 -2px 0 #d9b46a;border-color:#d9b46a}" +
    "body.locked #pulse-bar{display:none}#status-strip{display:none!important}.topbar h1,.topbar .sub{display:none!important}#grains-head{display:none!important}body.gr3 main{display:block!important}" +
    ".st-none{margin:0;font-size:11.5px;color:var(--muted)}" +
    "@media (prefers-reduced-motion:reduce){.st-evl{transition:none}.st-brl li.st-new{animation:none}}";
  doc.head.appendChild(st);
  root.SIDE_TOP = { paint: paint };
})();
