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
