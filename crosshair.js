/* crosshair.js — crosshair readout on every chart in the app (owner, Nov 23 2026).
   Move the mouse (or drag a finger sideways) across a chart: a vertical line follows it and a label box lists what the chart
   shows at that point — the x-axis label, each line's value read off the chart's own y-axis, and any bar / point under the line.
   Charts that already draw their own crosshair (price chart, spread chart, Treasury, AI debt, the gamma bell curve) are left alone.
   Nothing is invented: a line's value is shown only when the chart carries numeric y-axis labels to read it from. */
(function () {
  "use strict";
  var doc = document;
  var OWN = ".gx-svg,.pxc-svg,.spc-svg,.tq-svg,.ad-svg,.xh-off";
  var SKIP = "#gnav,.topbar,nav.tabs,#status-strip,#sn,.fr-drawer,button,a";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(t) {   /* "−1.2%", "$4.25", "1,250", "3.5M" → number; anything else → null */
    var m = String(t || "").replace(/[−–]/g, "-").replace(/,/g, "").match(/^\s*[+]?(-?)\$?\s*(-?\d*\.?\d+)\s*([kKmMbB%¢]?)\s*$/);
    if (!m) return null; var v = parseFloat(m[2]) * (m[1] ? -1 : 1), u = m[3].toLowerCase();
    return u === "k" ? v * 1e3 : u === "m" ? v * 1e6 : u === "b" ? v * 1e9 : v;
  }
  function chartOf(el) {
    if (!el || !el.closest || el.closest(SKIP)) return null;
    var s = el.closest("svg"); while (s && s.parentElement && s.parentElement.closest("svg")) s = s.parentElement.closest("svg");
    if (!s || s.closest(OWN) || s.matches(OWN)) return null;
    var r = s.getBoundingClientRect(); if (r.width < 220 || r.height < 90) return null;   /* icons, sparklines, chips */
    return s;
  }
  /* the chart's geometry, read once per drawing: text labels and their positions in the svg's own coordinates */
  function scan(svg) {
    if (svg._xh && svg._xh.n === svg.childNodes.length) return svg._xh;
    var vb = svg.viewBox && svg.viewBox.baseVal, bb = svg.getBoundingClientRect();
    var W = vb && vb.width ? vb.width : bb.width, H = vb && vb.height ? vb.height : bb.height;
    var T = [].map.call(svg.querySelectorAll("text"), function (t) { var b; try { b = t.getBBox(); } catch (e) { return null; }
      return { t: t.textContent.trim(), x: b.x + b.width / 2, y: b.y + b.height / 2, l: b.x, r: b.x + b.width }; }).filter(function (q) { return q && q.t; });
    /* y axes: numeric labels stacked in a column near the left or right edge */
    var axis = function (side) {
      var col = T.filter(function (q) { return num(q.t) != null && (side ? q.l > W * 0.8 : q.r < W * 0.2); });
      if (col.length < 2) return null;
      col.sort(function (a, b) { return a.y - b.y; });
      var a = col[0], b = col[col.length - 1], va = num(a.t), vb2 = num(b.t);
      if (Math.abs(b.y - a.y) < 20 || va === vb2) return null;
      return { y0: a.y, v0: va, k: (vb2 - va) / (b.y - a.y), pct: /%/.test(a.t + b.t), dp: Math.min(4, Math.max(0, ((a.t.split(".")[1] || "").replace(/\D/g, "")).length + 1)) };
    };
    var bottom = T.filter(function (q) { return q.y > H * 0.78; });
    var lines = [].filter.call(svg.querySelectorAll("polyline, path, line"), function (p) {
      if (p.closest("defs,clipPath,mask,marker") || p.classList.contains("xh-l")) return false;
      var cs = getComputedStyle(p); if (cs.display === "none" || cs.visibility === "hidden" || cs.stroke === "none" || +cs.strokeWidth === 0) return false;
      if (p.tagName === "line") return false;
      if (cs.fill !== "none" && cs.fill !== "rgba(0, 0, 0, 0)" && p.tagName === "path") return false;   /* filled shapes: areas, arrows */
      var len; try { len = p.getTotalLength(); } catch (e) { return false; } if (len < 60) return false;
      var b = p.getBBox(); return b.width > W * 0.25;   /* a series runs across the chart, gridlines are filtered by the stroke-only + length test */
    }).slice(0, 8).map(function (p) { return { el: p, c: getComputedStyle(p).stroke, lab: (p.getAttribute("data-name") || p.getAttribute("aria-label") || (p.querySelector("title") || {}).textContent || "").trim() }; });
    var tips = [].map.call(svg.querySelectorAll("title"), function (t) { var p = t.parentNode; if (!p || p === svg || !p.getBBox || lines.some(function (s) { return s.el === p; })) return null; var b; try { b = p.getBBox(); } catch (e) { return null; } return { l: b.x, r: b.x + b.width, t: t.textContent.trim() }; }).filter(Boolean);
    return (svg._xh = { n: svg.childNodes.length, W: W, H: H, yl: axis(0), yr: axis(1), bottom: bottom, lines: lines, tips: tips });
  }
  /* y of a path at svg x: bisect along its length (paths run left → right) */
  function yAt(p, x) {
    var L = p.getTotalLength(), lo = 0, hi = L, a = p.getPointAtLength(0), b = p.getPointAtLength(L);
    if (x < Math.min(a.x, b.x) - 1 || x > Math.max(a.x, b.x) + 1) return null;
    var rev = a.x > b.x;
    for (var i = 0; i < 22; i++) { var m = (lo + hi) / 2, q = p.getPointAtLength(m); if ((q.x < x) !== rev) lo = m; else hi = m; }
    var r = p.getPointAtLength((lo + hi) / 2); return Math.abs(r.x - x) < 6 ? r.y : null;
  }
  var tip = null;
  function tipEl() { if (!tip) { tip = doc.createElement("div"); tip.className = "xh-tip"; tip.hidden = true; doc.body.appendChild(tip); } return tip; }
  var cur = null;
  function hide() { if (cur) { var l = cur.querySelector(".xh-l"); if (l) l.setAttribute("visibility", "hidden"); } cur = null; if (tip) tip.hidden = true; }
  var raf = 0, last = null;
  function move(e) { last = e; if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(last); }); }
  function draw(e) {
    var svg = chartOf(e.target); if (svg !== cur) hide(); if (!svg) return;
    var G = scan(svg), bb = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
    var sx = (vb && vb.width ? vb.width : bb.width) / bb.width, sy = (vb && vb.height ? vb.height : bb.height) / bb.height;
    var x = (e.clientX - bb.left) * sx + (vb ? vb.x : 0);
    var rows = [];
    G.lines.forEach(function (s) {
      var y = yAt(s.el, x); if (y == null) return;
      var A = G.yl || G.yr; if (!A) return;
      var v = A.v0 + (y - A.y0) * A.k;
      rows.push('<tr><td><i style="background:' + esc(s.c) + '"></i>' + esc(s.lab || "Line") + "</td><td>" + v.toLocaleString("en-US", { minimumFractionDigits: A.dp, maximumFractionDigits: A.dp }) + (A.pct ? "%" : "") + "</td></tr>");
    });
    var hit = G.tips.filter(function (q) { return x >= q.l - 2 && x <= q.r + 2; });
    if (!hit.length && G.tips.length) { var n = G.tips.reduce(function (a, b) { return Math.abs((b.l + b.r) / 2 - x) < Math.abs((a.l + a.r) / 2 - x) ? b : a; }); if (Math.abs((n.l + n.r) / 2 - x) < 14) hit = [n]; }
    var seen = {}; hit.slice(0, 6).forEach(function (q) { if (seen[q.t]) return; seen[q.t] = 1; rows.push('<tr><td colspan="2" class="xh-t">' + esc(q.t) + "</td></tr>"); });
    var xl = G.bottom.length ? G.bottom.reduce(function (a, b) { return Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a; }) : null;
    var head = xl && Math.abs(xl.x - x) < G.W / 8 ? (Math.abs(xl.x - x) < 6 ? "" : "≈ ") + xl.t : "";
    if (!rows.length && !head) { hide(); return; }
    var l = svg.querySelector(".xh-l");
    if (!l) { l = doc.createElementNS("http://www.w3.org/2000/svg", "line"); l.setAttribute("class", "xh-l"); svg.appendChild(l); svg._xh.n = svg.childNodes.length; }
    var top = vb ? vb.y : 0, h = vb && vb.height ? vb.height : bb.height;
    l.setAttribute("x1", x); l.setAttribute("x2", x); l.setAttribute("y1", top); l.setAttribute("y2", top + h); l.setAttribute("visibility", "visible");
    cur = svg;
    var t = tipEl(); t.innerHTML = (head ? "<b>" + esc(head) + "</b>" : "") + (rows.length ? "<table>" + rows.join("") + "</table>" : ""); t.hidden = false;
    var tw = t.offsetWidth, th = t.offsetHeight, px = e.clientX + 16, py = e.clientY - th - 12;
    if (px + tw > innerWidth - 8) px = e.clientX - tw - 16; if (py < 8) py = e.clientY + 18;
    t.style.left = Math.max(8, px) + "px"; t.style.top = py + "px";
  }
  doc.addEventListener("pointermove", move, { passive: true });
  doc.addEventListener("pointerdown", move, { passive: true });
  doc.addEventListener("scroll", hide, { passive: true, capture: true });
  doc.addEventListener("pointerleave", hide, true);
  var st = doc.createElement("style");
  st.textContent = ".xh-l{stroke:var(--ink,#e8edf3);stroke-width:1;opacity:.6;stroke-dasharray:3 3;pointer-events:none;vector-effect:non-scaling-stroke}" +
    "svg:not(.gx-svg):not(.pxc-svg):not(.spc-svg):not(.tq-svg):not(.ad-svg){touch-action:pan-y}" +
    ".xh-tip{position:fixed;z-index:9000;pointer-events:none;max-width:340px;background:var(--panel,#0b1016);border:1px solid var(--line2,#2a3442);border-radius:8px;padding:6px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);font:12px 'IBM Plex Mono',monospace;color:var(--ink,#e8edf3)}" +
    ".xh-tip table{border-collapse:collapse;margin-top:3px}.xh-tip td{padding:1px 0;vertical-align:top}.xh-tip td:first-child{color:var(--muted,#8a97a8);padding-right:12px;white-space:nowrap}.xh-tip td:last-child{text-align:right;white-space:nowrap}" +
    ".xh-tip td.xh-t{color:var(--ink,#e8edf3);text-align:left;white-space:normal}.xh-tip i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;vertical-align:-1px}";
  doc.head.appendChild(st);
})();
