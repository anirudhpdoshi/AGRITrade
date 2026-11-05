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
  function tile(row) {
    if (!row || row.settle == null || !row.contract) return null;
    var o = { contract: row.contract, expiry: row.expiry || "", date: row.settle_date || "", settle: (row.settle * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), dir: "flat", chg: null, pct: null };
    if (row.prev) {
      var c = (row.settle - row.prev) * 100, p = (row.settle / row.prev - 1) * 100, s = c > 0 ? "+" : c < 0 ? "−" : "";
      o.dir = c > 0 ? "up" : c < 0 ? "down" : "flat"; o.chg = s + Math.abs(c).toFixed(2) + "¢"; o.pct = s + Math.abs(p).toFixed(2) + "%";
    }
    return o;
  }
  function age(ms) {
    if (!(ms >= 0)) return "";
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m / 60) % 24;
    return d ? d + "d " + h + "h" : h ? h + "h " + (m % 60) + "m" : (m % 60) + "m";
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { fndOf: fndOf, fndLabel: fndLabel, tile: tile, age: age }; return; }

  var doc = root.document, parent = doc.getElementById("tabbtn-grains"), head = doc.getElementById("grains-head");
  if (!parent || !head) return;
  var ET = "America/New_York";
  function btn(k) { return doc.getElementById("tabbtn-" + k); }
  function active() { var a = doc.querySelector(".tab-panel.active"), k = a ? a.id.replace("panel-", "") : ""; return ORDER.indexOf(k) >= 0 ? k : null; }
  function saved() { try { var v = localStorage.getItem(KEY); return ORDER.indexOf(v) >= 0 ? v : "corn"; } catch (e) { return "corn"; } }
  function remember(k) { try { localStorage.setItem(KEY, k); } catch (e) {} }
  function fmtET(ms, o) { return new Date(ms).toLocaleString("en-US", Object.assign({ timeZone: ET }, o)); }
  function shortDate(iso) { var p = (iso || "").split("-"); return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; }

  function asOfLine(now) {
    var a = root.DATA && DATA.meta && DATA.meta.asof && DATA.meta.asof.grains_settle, t = a ? Date.parse(a) : NaN;
    if (!isFinite(t)) return { text: "As of UNAVAILABLE", day: "" };
    return { text: fmtET(t, { month: "short", day: "numeric" }) + ", " + fmtET(t, { hour: "numeric", minute: "2-digit" }) + " ET · settlement · " + age(now - t) + " old",
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
  function tileHTML(k, day, on) {
    var g = root.DATA && DATA.grains && DATA.grains[k], R = g && g.roll && g.roll[0], T = tile(R), sel = ' aria-pressed="' + on + '" data-grain-pick="' + k + '"';
    if (!T) return '<button type="button" class="gr-tile"' + sel + '><span class="gr-n">' + NAME[k] + '</span><span class="gr-una">UNAVAILABLE</span></button>';
    var stale = day && T.date && T.date < day;
    return '<button type="button" class="gr-tile"' + sel + '>' +
      '<span class="gr-n">' + NAME[k] + ' <b>' + T.contract + '</b></span>' +
      '<span class="gr-v">' + T.settle + '<small> c/bu</small></span>' +
      '<span class="gr-c ' + T.dir + '">' + (T.chg ? T.chg + " · " + T.pct : "Change UNAVAILABLE") + '</span>' +
      '<span class="gr-f">Front ' + T.expiry + ' · FND ' + (fndLabel(T.contract) || "UNAVAILABLE") + '</span>' +
      (stale ? '<span class="gr-stale">LATEST VERIFIED ' + shortDate(T.date) + '</span>' : "") + '</button>';
  }
  function paint() {
    var on = active();
    head.hidden = !on;
    parent.setAttribute("aria-selected", on ? "true" : "false");
    if (!on) return;
    var now = Date.now(), A = asOfLine(now), ev = nextEvent(now);
    var h = '<div class="gr-top"><span class="gr-asof">' + A.text + '</span>' + (ev ? '<span class="gr-next">' + ev + '</span>' : "") + '</div>' +
      '<div class="gr-strip">' + ORDER.map(function (k) { return tileHTML(k, A.day, k === on); }).join("") + '</div>' +
      '<div class="gr-slicer" role="group" aria-label="Commodity"><span>Commodity</span>' + ORDER.map(function (k) { return '<button type="button" data-grain-pick="' + k + '" aria-pressed="' + (k === on) + '">' + NAME[k] + '</button>'; }).join("") + '</div>';
    if (head.innerHTML !== h) head.innerHTML = h;
  }
  function section(k) { var s = doc.querySelector("#panel-" + k + ' [data-sub][aria-selected="true"]'); return s ? s.getAttribute("data-sub") : null; }
  function pick(k) {
    var from = active(), sub = from && from !== k ? section(from) : null, y = root.scrollY, b = btn(k); if (!b) return;
    b.click();
    if (sub && root.setSub) root.setSub(k, sub);      /* the section holds when the commodity changes */
    root.scrollTo(0, y);                              /* CG-2: same scroll position */
    if (root.DESK_LIVE && DESK_LIVE.paintPills) DESK_LIVE.paintPills();
  }
  parent.addEventListener("click", function () { pick(active() || saved()); });
  head.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-grain-pick]"); if (b) pick(b.getAttribute("data-grain-pick")); });
  doc.addEventListener("click", function (ev) {
    if (!ev.target.closest || !ev.target.closest(".tab-btn")) return;
    var k = active(); if (k) remember(k); paint();
  });
  /* the "updated today" mark on any grain carries up to the parent */
  function mirror() { var src = ORDER.map(btn).filter(function (b) { return b && b.classList.contains("tab-today"); })[0];
    parent.classList.toggle("tab-today", !!src); if (src && src.title) parent.title = src.title; else parent.removeAttribute("title"); }
  if (root.MutationObserver) { var mo = new MutationObserver(mirror); ORDER.forEach(function (k) { var b = btn(k); if (b) mo.observe(b, { attributes: true, attributeFilter: ["class", "title"] }); }); }
  mirror();
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
