/* steady.js — no shivering on live updates (owner, Nov 23 2026). Loaded last.
   A live tick redraws the grain / FX panels (renderAll). Several finishing touches used to land 0.3–1 s later (glossary
   info buttons, data-age pills, the options-chain card), each changing the page height, so the page jumped two or three
   times per update and the browser's scroll anchoring moved the view. Here every finishing touch runs in the same frame
   as the redraw (the browser's own scroll anchoring then keeps the view still). */
(function () {
  "use strict";
  function wrap() {
  var ra = window.renderAll; if (typeof ra !== "function" || ra._steady) return;
  window.renderAll = function () {
    var r = ra.apply(this, arguments);
    queueMicrotask(function () {   /* after the mutation observers have seen the redraw, before the browser paints */
      try { if (window.CHAIN_UI && CHAIN_UI.tick) CHAIN_UI.tick(); } catch (e) {}
      try { if (window.GLOSSARY_FLUSH) GLOSSARY_FLUSH(); } catch (e) {}
      try { if (window.DESK_PILLS) DESK_PILLS(); } catch (e) {}
    });
    return r;
  };
  window.renderAll._steady = 1;
  }
  /* wrap last: some scripts load deferred and wrap renderAll after this file runs */
  if (document.readyState === "complete") wrap(); else window.addEventListener("load", wrap);
})();
/* Light theme = one page-level inversion of the dark palette (desk.css). Older per-component light overrides (white cards,
   dark text) get inverted a second time and show up black — strip them, keep only the inversion and its photo/flag exceptions. */
(function () {
  var KEEP = /img|\.flag|video|picture|\.no-invert|\.zoom-ov|\.theme-sw/;
  function isLight(sel) { return /data-theme=["']?light/.test(sel); }
  function clean(sheet) {
    var R; try { R = sheet.cssRules; } catch (e) { return; } if (!R) return;
    for (var i = R.length - 1; i >= 0; i--) { var r = R[i];
      if (r.cssRules && !r.selectorText) { clean(r); continue; }
      var s = r.selectorText; if (!s || !isLight(s)) continue;
      if (/^html\[data-theme=["']?light["']?\]$/.test(s.trim()) && /filter/.test(r.cssText)) continue;   /* the inversion itself */
      if (KEEP.test(s) || s.split(",").some(function (x) { return !isLight(x); })) continue;
      try { sheet.deleteRule(i); } catch (e) {} }
  }
  function all() { [].forEach.call(document.styleSheets, clean); }
  all(); document.addEventListener("DOMContentLoaded", all); window.addEventListener("load", all);
  new MutationObserver(function (m) { if (m.some(function (x) { return [].some.call(x.addedNodes, function (n) { return n.tagName === "STYLE" || n.tagName === "LINK"; }); })) setTimeout(all, 0); })
    .observe(document.head, { childList: true });
})();
