/* Grains and Oilseeds parent tab (Commodities BRD s.4).
   One parent tab + comparison strip + commodity slicer over the three existing grain pages.
   The original corn/soybeans/wheat tab buttons stay in the page, hidden, as the internal switch:
   every existing renderer and "go to corn:deriv" link keeps working through them. */
(function (root) {
  var ORDER = ["corn", "soybeans", "wheat"], NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" }, KEY = "desk.grain";
  var MON = { F: 0, G: 1, H: 2, J: 3, K: 4, M: 5, N: 6, Q: 7, U: 8, V: 9, X: 10, Z: 11 };

  /* First Notice Day: last weekday of the month before the contract month (ZSF27 -> Thu Dec 31, 2026) */
  function fndOf(contract) {
    var m = /([FGHJKMNQUVXZ])(\d{2})$/.exec(contract || ""); if (!m) return null;
    var d = new Date(Date.UTC(2000 + +m[2], MON[m[1]], 0));
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  function fndLabel(contract) {
    var d = fndOf(contract); if (!d) return null;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  /* settle and prev arrive in $/bu; the desk prints c/bu, signed cents AND % together */
  /* the strip follows the same delayed quote as the fan chart: once a quote newer than the settlement exists, show it
     (change measured against that settlement); otherwise the settlement and its change on the day */
  function live(row, g) { var q = g && g.quotes && g.quotes[row.contract]; if (!q || q.px == null || !q.ts) return null;
    var qd = new Date(q.ts).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); return (qd > (row.settle_date || "") || (qd === row.settle_date && Math.abs(q.px - row.settle) > 1e-9)) ? q : null; }
  function tile(row, g) {
    if (!row || row.settle == null || !row.contract) return null;
    var q = live(row, g); if (q) row = Object.assign({}, row, { prev: row.settle, settle: q.px, settle_date: new Date(q.ts).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), qlabel: q.label || "" });
    var o = { contract: row.contract, expiry: row.expiry || "", date: row.settle_date || "", settle: (row.settle * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), dir: "flat", chg: null, pct: null };
    if (row.prev) {
      var c = (row.settle - row.prev) * 100, p = (row.settle / row.prev - 1) * 100, s = c > 0 ? "+" : c < 0 ? "−" : "";
      o.dir = c > 0 ? "up" : c < 0 ? "down" : "flat"; o.chg = s + Math.abs(c).toFixed(2) + "¢"; o.pct = s + Math.abs(p).toFixed(2) + "%";
    }
    o.px = row.settle; o.q = row.qlabel || "";
    return o;
  }
  function age(ms) {
    if (!(ms >= 0)) return "";
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m / 60) % 24;
    return d ? d + "d " + h + "h" : h ? h + "h " + (m % 60) + "m" : (m % 60) + "m";
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { fndOf: fndOf, fndLabel: fndLabel, tile: tile, age: age }; return; }

  root.GRAINS = { fndLabel: fndLabel };
  var doc = root.document, parent = doc.getElementById("tabbtn-grains"), head = doc.getElementById("grains-head");
  if (!parent || !head) return;
  var ET = "America/New_York";
  function btn(k) { return doc.getElementById("tabbtn-" + k); }
  function active() { var a = doc.querySelector(".tab-panel.active"), k = a ? a.id.replace("panel-", "") : ""; return ORDER.indexOf(k) >= 0 || k === "fx" || k === "positioning" ? k : null; }
  function isG(k) { return ORDER.indexOf(k) >= 0; }
  function saved() { try { var v = localStorage.getItem(KEY); return ORDER.indexOf(v) >= 0 ? v : "corn"; } catch (e) { return "corn"; } }
  function remember(k) { try { localStorage.setItem(KEY, k); } catch (e) {} }
  function fmtET(ms, o) { return new Date(ms).toLocaleString("en-US", Object.assign({ timeZone: ET }, o)); }
  function shortDate(iso) { var p = (iso || "").split("-"); return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; }

  function asOfLine(now) {
    var A = root.DATA && DATA.meta && DATA.meta.asof || {}, a = A.grains_settle, t = a ? Date.parse(a) : NaN, q = A.grains_quote ? Date.parse(A.grains_quote) : NaN, kind = "settlement";
    if (isFinite(q) && (!isFinite(t) || q > t)) { t = q; kind = "delayed quote"; }   /* same clock as the strip prices */
    if (!isFinite(t)) return { text: "", day: "" };
    return { text: fmtET(t, { month: "short", day: "numeric" }) + ", " + fmtET(t, { hour: "numeric", minute: "2-digit" }) + " ET · " + kind + " · " + age(now - t) + " old",
             day: new Date(t).toLocaleDateString("en-CA", { timeZone: ET }) };
  }
  /* next scheduled fundamental event (CG-6) from the desk's own WASDE calendar */
  function nextEvent(now) {
    var L = typeof USDA_WASDE !== "undefined" ? USDA_WASDE : [], z = root.zonedMs, best = null;
    if (typeof z !== "function") return "";
    L.forEach(function (iso) { var p = String(iso).split("-"), t = z(+p[0], +p[1], +p[2], 12, 0, "America/New_York"); if (t > now && (best === null || t < best)) best = t; });
    if (best === null) return "";
    return "Next: WASDE + Crop Production · " + fmtET(best, { weekday: "short", month: "short", day: "numeric" }) + ", 12:00 PM ET · in " + age(best - now);
  }
  var PULSE = '<svg class="gr-pulse" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h3l2-5 3 10 2-5h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function tileHTML(k, day, on) {
    var g = root.DATA && DATA.grains && DATA.grains[k], R0 = g && g.roll && g.roll[0], T = tile(R0, g), sel = ' aria-pressed="' + on + '" data-grain-pick="' + k + '"';
    if (!T) return '<button type="button" class="gr-tile"' + sel + '><span class="gr-n">' + NAME[k] + '</span></button>';
    var stale = day && T.date && T.date < day, fx = root.DATA && DATA.fx && DATA.fx.feed && +DATA.fx.feed.mid, bt = root.BU_PER_MT && BU_PER_MT[k];
    var phys = (fx && bt ? '<span class="gr-kv"><span>C$/t equiv.</span><b title="Front futures × ' + bt + ' bu/t × USD/CAD — no basis">' + (T.px * bt * fx).toFixed(2) + '</b></span>' : "") +
      (fx ? '<span class="gr-kv"><span>USD/CAD</span><b>' + fx.toFixed(4) + '</b></span>' : "");
    return '<button type="button" class="gr-tile"' + sel + '>' +
      '<span class="gr-n">' + NAME[k].toUpperCase() + ' <b>' + T.contract + '</b>' + (on ? '<em class="gr-selb">SELECTED</em>' : "") + '<span class="gr-live" title="Price updates as new delayed quotes arrive">' + PULSE + '</span></span>' +
      '<span class="gr-v"><span class="qt-box gr-px" data-qt="gr-' + k + '" data-v="' + T.px + '" data-dec="4"><span class="qt-v">' + T.px.toFixed(4) + '</span></span><small>$/bu</small></span>' +
      '<span class="gr-c ' + T.dir + '">' + (T.chg ? T.chg + " · " + T.pct : "") + '</span>' +
      (phys ? '<span class="gr-phys"><span class="gr-ph">Physical calculations</span>' + phys + '</span>' : "") +
      '<span class="gr-f">' + (T.q ? "Delayed " + T.q + " · " : "") + 'Front ' + T.expiry + (fndLabel(T.contract) ? ' · FND ' + fndLabel(T.contract) : "") + '</span>' +
      (stale ? '<span class="gr-stale">LATEST VERIFIED ' + shortDate(T.date) + '</span>' : "") + '</button>';
  }
  /* USD/CAD tile: the entry point to the USD/CAD desk report (removed from the Macro menu) */
  function fxTileHTML(on) {
    var F = root.DATA && DATA.fx, fd = F && F.feed, mid = fd && +fd.mid, ref = F && F.spot && +F.spot.ref, sel = ' aria-pressed="' + on + '" data-grain-pick="fx"';
    if (!(mid > 0)) return '<button type="button" class="gr-tile"' + sel + '><span class="gr-n">USD/CAD</span></button>';
    var d = ref ? mid - ref : null, dir = d > 0 ? "up" : d < 0 ? "down" : "flat", s = d > 0 ? "+" : d < 0 ? "−" : "";
    var t = fd.ts || (DATA.meta && DATA.meta.asof && DATA.meta.asof.fx_spot), tl = t ? fmtET(Date.parse(t), { hour: "numeric", minute: "2-digit" }) + " ET" : "";
    return '<button type="button" class="gr-tile gr-fx"' + sel + '>' +
      '<span class="gr-n">USD/CAD <b>SPOT</b>' + (on ? '<em class="gr-selb">SELECTED</em>' : "") + '<span class="gr-live" title="Live spot — updates on every tick">' + PULSE + '</span></span>' +
      '<span class="gr-v"><span class="qt-box gr-px" data-qt="gr-fx" data-v="' + mid + '" data-dec="5" data-qt-live="usdcad"><span class="qt-v">' + (root.QTFMT ? QTFMT(mid, 5) : mid.toFixed(5)) + '</span></span><small>CAD per USD</small></span>' +
      '<span class="gr-c ' + dir + '">' + (d != null ? s + Math.abs(d * 1e4).toFixed(1) + " pips · " + s + Math.abs(d / ref * 100).toFixed(2) + "%" : "") + '</span>' +
      (ref ? '<span class="gr-phys"><span class="gr-ph">Reference</span><span class="gr-kv"><span>Prior close</span><b>' + ref.toFixed(4) + '</b></span><span class="gr-kv"><span>1 CAD in USD</span><b>' + (1 / mid).toFixed(4) + '</b></span></span>' : "") +
      '<span class="gr-f">' + (tl ? "Spot " + tl + " · " : "") + 'opens the USD/CAD desk report</span></button>';
  }
  /* right column: "next" card for the open report tab, with the other tabs' next events beneath */
  function nextCard(k) {
    var P = doc.getElementById("panel-" + k), rail = P && P.querySelector("aside.rail"); if (!rail) return;
    var B = P.querySelectorAll(".subnav [data-sub]"), on = null, rows = "";
    B.forEach(function (b) { if (b.getAttribute("aria-selected") === "true") on = b; });
    if (!on) return;
    function part(b) { var n = b.querySelector(".sb-name"), e = b.querySelector(".sb-ev"), c = b.querySelector(".countdown"), d = b.querySelector(".sb-date");
      return { n: n ? n.textContent : "", e: e ? e.textContent : "", c: c ? c.outerHTML : "", d: d ? d.textContent.replace(/^\s*·\s*/, "") : "" }; }
    var a = part(on);
    B.forEach(function (b) { if (b === on) return; var x = part(b); if (!x.c) return;
      rows += '<div class="gx-r" data-sub="' + b.getAttribute("data-sub") + '" data-subp="' + k + '"><span>' + x.n + '</span><span>' + x.e + '</span><b>' + x.c + '</b></div>'; });
    var h = '<div class="gx-h">Insights &amp; Activity</div><div class="gx-next"><div class="gx-t">' + a.n + '</div>' +
      (a.c ? '<div class="gx-e">Next: ' + a.e + '</div><div class="gx-c">' + a.c + ' · ' + a.d + '</div>' : '<div class="gx-e">No scheduled event</div>') + '</div>' +
      (rows ? '<div class="gx-list">' + rows + '</div>' : "");
    var box = rail.querySelector(".gx-box");
    if (!box) { box = doc.createElement("div"); box.className = "gx-box"; rail.insertBefore(box, rail.firstChild); }
    if (box.getAttribute("data-k") !== a.n + rows.length || !box.innerHTML) { box.innerHTML = h; box.setAttribute("data-k", a.n + rows.length); }
  }
  function paint() {
    var on = active();
    head.hidden = !on;
    doc.body.classList.toggle("gr3", !!on);
    parent.setAttribute("aria-selected", on ? "true" : "false");
    if (!on) return;
    var POS = on === "positioning"; doc.body.classList.toggle("gr-mini", POS);
    if (POS) on = root.POSITIONING && POSITIONING.current ? POSITIONING.current() : "corn";
    var now = Date.now(), A = asOfLine(now), ev = nextEvent(now);
    var h = '<div class="gr-top"><span class="gr-asof">' + A.text + '</span>' + (ev ? '<span class="gr-next">' + ev + '</span>' : "") + '</div>' +
      '<div class="gr-col-h">Execution Tiles</div>' +
      '<div class="gr-strip">' + ORDER.map(function (k) { return tileHTML(k, A.day, k === on); }).join("") + (POS ? "" : fxTileHTML(on === "fx")) + '</div>';
    if (head.getAttribute("data-h") !== h) { head.innerHTML = h; head.setAttribute("data-h", h); }
    if (!POS) nextCard(on);
  }
  root.GRAINS.pick = function (k) { pick(k); };
  function section(k) { var s = doc.querySelector("#panel-" + k + ' [data-sub][aria-selected="true"]'); return s ? s.getAttribute("data-sub") : null; }
  /* View lock (default on): Corn / Soybeans / Wheat keep the same route — menu, section filter, geography, crop year, map/table —
     and the same tile at the same height on screen, so you can flip commodities on e.g. WASDE without losing your place */
  var LOCK = true;   /* the open tab and sub-section always hold when the commodity changes */
  var ROUTE_KEYS = ["crop", "view", "basis", "fgeo"];
  function anchor(k) {   /* first tile still on screen: its index in the open menu and its distance from the top */
    var T = doc.querySelectorAll("#panel-" + k + " [data-subpanel].on .tile"), top = (doc.querySelector(".tabs") || {}).offsetHeight || 0;
    for (var i = 0; i < T.length; i++) { var r = T[i].getBoundingClientRect(); if (r.height && r.bottom > top + 40) return { i: i, off: r.top }; }
    return null;
  }
  function pick(k) {
    var from = active(), same = from === k, both = isG(from) && isG(k), sub = from && !same && both ? section(from) : null, y = root.scrollY, b = btn(k); if (!b) return;
    var A = LOCK && from && !same && both ? anchor(from) : null;
    if (LOCK && from && !same && both) {
      try {
        if (root.SEC && root.SUB) { var sv = SEC[from + "." + SUB[from]]; if (sv != null) { SEC[k + "." + sub] = sv; localStorage.setItem("desk.sec", JSON.stringify(SEC)); } }
        if (root.DASH_STATE && root.dstate) { var f = dstate(from), t = dstate(k); ROUTE_KEYS.forEach(function (q) { if (f[q] != null) t[q] = f[q]; }); }
      } catch (e) {}
    }
    b.click();
    if (k === "fx" && !same && root.setSub) { try { setSub("fx", "fwd"); } catch (e) {} setTimeout(function () { nextCard("fx"); }, 0); }   /* the spot tile lands on the 24-month forward rates */
    if (sub && root.setSub) root.setSub(k, sub);      /* the menu holds when the commodity changes */
    if (LOCK && from && !same && both && root.renderGrain) { try { renderGrain(k); if (root.buildSecNav) buildSecNav(k); if (root.drawDestMaps) drawDestMaps(); } catch (e) {} }
    function place() { var T = A ? doc.querySelectorAll("#panel-" + k + " [data-subpanel].on .tile")[A.i] : null;
      if (T) root.scrollTo(0, Math.max(0, T.getBoundingClientRect().top + root.scrollY - A.off));   /* same tile, same height on screen */
      else root.scrollTo(0, y); }                     /* CG-2: same scroll position */
    place(); setTimeout(place, 0); setTimeout(place, 150);   /* again after the tab switch and section nav settle */
    if (root.DESK_LIVE && DESK_LIVE.paintPills) DESK_LIVE.paintPills();
  }
  parent.addEventListener("click", function () { var a = active(); pick(a && isG(a) ? a : saved()); });
  head.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-grain-pick]"); if (!b) return;
    if (active() === "positioning" && root.POSITIONING && POSITIONING.pick) { POSITIONING.pick(b.getAttribute("data-grain-pick")); paint(); return; }
    pick(b.getAttribute("data-grain-pick")); });
  doc.addEventListener("click", function (ev) {
    if (!ev.target.closest || !ev.target.closest(".tab-btn")) return;
    var k = active(); if (k && isG(k)) remember(k); paint();
  });
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("[data-sub]")) setTimeout(function () { var k = active(); if (k) nextCard(k); }, 0); });
  /* the "updated today" mark on any grain carries up to the parent */
  function mirror() { var src = ORDER.map(btn).filter(function (b) { return b && b.classList.contains("tab-today"); })[0];
    parent.classList.toggle("tab-today", !!src); if (src && src.title) parent.title = src.title; else parent.removeAttribute("title"); }
  if (root.MutationObserver) { var mo = new MutationObserver(mirror); ORDER.forEach(function (k) { var b = btn(k); if (b) mo.observe(b, { attributes: true, attributeFilter: ["class", "title"] }); }); }
  mirror();
  /* a grain page redraw wipes its rail: put the insights card back */
  if (root.MutationObserver) { var PP = doc.getElementById("panel-positioning"); if (PP) new MutationObserver(function () { paint(); }).observe(PP, { attributes: true, attributeFilter: ["class"] }); }
  if (root.MutationObserver) ORDER.concat(["fx"]).forEach(function (k) { var P = doc.getElementById("panel-" + k); if (P) new MutationObserver(function () { if (active() === k && !P.querySelector(".gx-box")) nextCard(k); }).observe(P, { childList: true }); });
  /* a data refresh repaints the strip; the age and countdown tick on their own */
  var ra = root.renderAll;
  if (typeof ra === "function") root.renderAll = function () { var r = ra.apply(this, arguments); paint(); return r; };
  setInterval(paint, 30000);
  /* saved links (#corn, #soybeans, #wheat, #grains) land on the parent with that commodity selected */
  function fromHash() { var h = (location.hash || "").replace("#", "").toLowerCase(); if (h === "grains") { pick(active() || saved()); return true; } if (ORDER.indexOf(h) >= 0) { pick(h); return true; } return false; }
  root.addEventListener("hashchange", fromHash);
  if (!fromHash()) { var s = saved(); if (active() && active() !== s) pick(s); }
  paint();
})(typeof window !== "undefined" ? window : this);
