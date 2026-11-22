/* zoom.js — zoom in / out on any chart or table in the app (owner, Nov 22 2026).
   Hover a chart (SVG / canvas) or a table → a small "⤢ Zoom" button appears at its top-right corner. It opens a full-screen
   viewer with − / + / Fit / 100% controls, Ctrl+wheel or pinch zoom, drag to pan, and keyboard + − 0 Esc.
   The viewer shows a copy of what is on screen, so the page itself never changes size or layout. */
(function () {
  "use strict";
  var doc = document, btn = null, tgt = null, hideT = 0;
  var SKIP = "#gnav,#zm-ov,.fr-drawer,.fr-dbtn,#rc-panel,#brk-banner,#status-strip,.topbar,nav.tabs,.zm-no";
  function cand(el) {
    if (!el || !el.closest || el.closest(SKIP)) return null;
    var t = el.closest("table, svg, canvas");
    while (t && t.tagName === "svg" && t.parentElement && t.parentElement.closest("svg")) t = t.parentElement.closest("svg");   /* outermost svg */
    if (!t || t.closest(SKIP)) return null;
    var r = t.getBoundingClientRect();
    if (t.tagName === "TABLE") return t.rows.length >= 3 && r.width >= 200 ? t : null;
    return r.width >= 240 && r.height >= 110 ? t : null;
  }
  function title(t) {
    /* the nearest heading above the chart/table: walk up the page and take the last heading that comes before it */
    var SEL = "h1,h2,h3,h4,[class$='-ch'],[class*='title'],[class*='-h'] > b,[class*='head'] > b,[class*='-hd'] b";
    for (var a = t.parentElement, i = 0; a && a !== document.body && i < 10; a = a.parentElement, i++) {
      var L = [].filter.call(a.querySelectorAll(SEL), function (h) { var s = (h.textContent || "").trim(); return s.length > 2 && s.length < 140 && !h.contains(t) && (h.compareDocumentPosition(t) & 4); });
      if (L.length) return (L[L.length - 1].innerText || L[L.length - 1].textContent).replace(/\s+/g, " ").replace(/Full history.*$/, "").trim();
    }
    return t.tagName === "TABLE" ? "Table" : "Chart";
  }
  function place() {
    if (!btn || !tgt) return;
    var r = tgt.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || !r.width) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.style.top = Math.max(4, r.top + 4) + "px";
    btn.style.left = Math.min(innerWidth - 84, r.right - 80) + "px";
  }
  function show(t) { clearTimeout(hideT); tgt = t; if (!btn) { btn = doc.createElement("button"); btn.type = "button"; btn.id = "zm-btn"; btn.innerHTML = "⤢ Zoom"; btn.title = "Open this chart or table in the zoom viewer"; doc.body.appendChild(btn); btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (tgt) open(tgt); }); btn.addEventListener("mouseenter", function () { clearTimeout(hideT); }); btn.addEventListener("mouseleave", hideSoon); } place(); }
  function hideSoon() { clearTimeout(hideT); hideT = setTimeout(function () { if (btn) btn.hidden = true; tgt = null; }, 450); }
  doc.addEventListener("mouseover", function (e) { if (doc.getElementById("zm-ov")) return; if (btn && e.target === btn) return; var t = cand(e.target); if (t) show(t); else if (tgt && !tgt.contains(e.target)) hideSoon(); }, true);
  addEventListener("scroll", function () { if (tgt) place(); }, true);
  addEventListener("resize", function () { if (tgt) place(); });

  /* ---------- viewer ---------- */
  var Z = 1, base = { w: 0, h: 0 }, stage = null, box = null, lab = null;
  function copy(t) {
    var r = t.getBoundingClientRect(), c;
    if (t.tagName === "CANVAS") { c = doc.createElement("img"); try { c.src = t.toDataURL("image/png"); } catch (e) { c = doc.createElement("div"); c.textContent = "This chart cannot be copied."; } c.style.width = r.width + "px"; c.style.height = r.height + "px"; }
    else {
      c = t.cloneNode(true); c.removeAttribute("id"); [].forEach.call(c.querySelectorAll("[id]"), function (x) { x.removeAttribute("id"); });
      if (t.tagName === "svg") { if (!c.getAttribute("viewBox")) c.setAttribute("viewBox", "0 0 " + r.width + " " + r.height); c.setAttribute("width", r.width); c.setAttribute("height", r.height); c.style.width = r.width + "px"; c.style.height = r.height + "px"; c.style.maxWidth = "none"; }
      else { c.style.width = r.width + "px"; c.style.maxWidth = "none"; c.style.display = "table"; }
    }
    base = { w: r.width, h: r.height };
    /* keep the colours the page gives it: wrap in the same ancestor classes (tile / panel) without their behaviour */
    var w = doc.createElement("div"), anc = t.parentElement, chain = [];
    for (var i = 0; anc && anc !== doc.body && i < 6; i++, anc = anc.parentElement) chain.unshift(anc.className && typeof anc.className === "string" ? anc.className.replace(/\b(active|on|open|hidden)\b/g, "") : "");
    var inner = w; chain.forEach(function (cl) { var d = doc.createElement("div"); d.className = cl + " zm-anc"; inner.appendChild(d); inner = d; });
    inner.appendChild(c); return w;
  }
  function setZ(z, cx, cy) {
    var old = Z; Z = Math.max(0.4, Math.min(4, Math.round(z * 100) / 100));
    if (!box) return;
    var sx = stage.scrollLeft, sy = stage.scrollTop, px = cx == null ? stage.clientWidth / 2 : cx, py = cy == null ? stage.clientHeight / 2 : cy;
    box.style.zoom = Z; lab.textContent = Math.round(Z * 100) + "%";
    stage.scrollLeft = (sx + px) * Z / old - px; stage.scrollTop = (sy + py) * Z / old - py;
  }
  function fit() { if (!stage || !base.w) return; var z = Math.min((stage.clientWidth - 40) / base.w, (stage.clientHeight - 40) / base.h); setZ(Math.max(0.4, Math.min(4, z))); }
  function open(t) {
    close(); if (btn) btn.hidden = true;
    var ov = doc.createElement("div"); ov.id = "zm-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Zoom viewer");
    ov.innerHTML = '<div class="zm-bar"><b class="zm-t"></b><span class="zm-gap"></span><button type="button" data-zm="-" aria-label="Zoom out">−</button><span class="zm-l">100%</span><button type="button" data-zm="+" aria-label="Zoom in">+</button>' +
      '<button type="button" data-zm="1">100%</button><button type="button" data-zm="fit">Fit</button><button type="button" data-zm="x" aria-label="Close">✕</button></div><div class="zm-stage"><div class="zm-box"></div></div><div class="zm-hint">Ctrl + scroll or pinch to zoom · drag to pan · + − 0 keys · Esc to close</div>';
    doc.body.appendChild(ov); doc.documentElement.classList.add("zm-lock");
    ov.querySelector(".zm-t").textContent = title(t);
    stage = ov.querySelector(".zm-stage"); box = ov.querySelector(".zm-box"); lab = ov.querySelector(".zm-l");
    box.appendChild(copy(t)); Z = 1; box.style.zoom = 1;
    var startFit = Math.min((stage.clientWidth - 40) / base.w, (stage.clientHeight - 40) / base.h);
    setZ(Math.max(1, Math.min(2, startFit)));   /* open enlarged up to the screen, never smaller than the page */
    stage.scrollLeft = 0; stage.scrollTop = 0;
    stage.addEventListener("wheel", function (e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); var r = stage.getBoundingClientRect(); setZ(Z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    var drag = null;
    stage.addEventListener("pointerdown", function (e) { if (e.button !== 0 || e.target.closest("a,button,input,select")) return; drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.classList.add("drag"); });
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
    function mv(e) { if (!drag) return; stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); }
    function up() { drag = null; if (stage) stage.classList.remove("drag"); }
    ov._off = function () { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    ov.addEventListener("click", function (e) { var b = e.target.closest("[data-zm]"); if (!b) { if (e.target === ov) close(); return; } var k = b.getAttribute("data-zm");
      if (k === "x") close(); else if (k === "+") setZ(Z * 1.25); else if (k === "-") setZ(Z / 1.25); else if (k === "1") setZ(1); else if (k === "fit") fit(); });
    ov.querySelector("[data-zm=x]").focus();
  }
  function close() { var o = doc.getElementById("zm-ov"); if (!o) return; if (o._off) o._off(); o.remove(); doc.documentElement.classList.remove("zm-lock"); stage = box = lab = null; }
  doc.addEventListener("keydown", function (e) {
    if (!doc.getElementById("zm-ov")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZ(Z * 1.25); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZ(Z / 1.25); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
  });

  var st = doc.createElement("style");
  st.textContent =
    "#zm-btn{position:fixed;z-index:99990;appearance:none;border:1px solid #d9b46a;background:rgba(10,16,24,.82);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#d9b46a;border-radius:999px;padding:3px 10px;font:600 11.5px 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}#zm-btn:hover{background:#d9b46a;color:#101825}#zm-btn[hidden]{display:none}" +
    "html.zm-lock{overflow:hidden}#zm-ov{position:fixed;inset:0;z-index:99995;display:flex;flex-direction:column;background:rgba(4,8,12,.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}" +
    ".zm-bar{display:flex;align-items:center;gap:6px;padding:10px 16px;background:rgba(14,20,28,.92);border-bottom:1px solid #d9b46a}.zm-t{color:#d9b46a;font:600 14px 'IBM Plex Sans',system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}.zm-gap{flex:1}" +
    ".zm-bar button{appearance:none;min-width:34px;border:1px solid #2a3442;background:transparent;color:#e8edf3;border-radius:999px;padding:4px 12px;font:600 13px 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer}.zm-bar button:hover{border-color:#d9b46a;color:#d9b46a}" +
    ".zm-l{min-width:52px;text-align:center;font:600 13px 'IBM Plex Mono',monospace;color:#e8edf3}" +
    ".zm-stage{flex:1 1 auto;overflow:auto;padding:20px;cursor:grab;text-align:center}.zm-stage.drag{cursor:grabbing;user-select:none}.zm-box{display:inline-block;text-align:left;vertical-align:top;background:var(--panel,#0b1016);border:1px solid #2a3442;border-radius:10px;padding:14px}" +
    ".zm-anc{display:block!important;position:static!important;width:auto!important;max-width:none!important;height:auto!important;max-height:none!important;overflow:visible!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;transform:none!important;opacity:1!important;visibility:visible!important}" +
    ".zm-hint{padding:6px 16px;font:11.5px 'IBM Plex Mono',monospace;color:#8a97a8;text-align:center}" +
    "@media (hover:none){#zm-btn{display:none}}";
  doc.head.appendChild(st);
  window.DESK_ZOOM = { open: open, close: close };
})();
