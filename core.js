/* core.js — helpers shared by every desk script. Loaded first (synchronously, in <head>).
   esc(): the single HTML-escape used for everything written into the page. It escapes & < > " and turns
   null / undefined into "" — safe for both element text and double-quoted attribute values. */
var DeskCore = (function () {
  var MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return MAP[c]; }); }
  return { esc: esc };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DeskCore;
