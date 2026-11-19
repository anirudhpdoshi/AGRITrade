/* history-nav.js — the browser Back / Forward buttons move between desk views instead of leaving the site.
   Every change of view (top menu, commodity, sub-tab, World Markets section, section menu) adds one browser history
   entry; Back restores the previous view by pressing the same buttons the user pressed. A Full history pop-up is also
   an entry, so Back closes it first. Only the first Back after the very first view leaves the site, as usual. */
(function (root) {
  var doc = root.document, busy = false, last = "";
  function sel(P, q) { var b = P && P.querySelector(q); return b ? b : null; }
  /* the current view as a short key: panel | sub-tab | section-level choices */
  function snap() {
    var P = doc.querySelector(".tab-panel.active"); if (!P) return null;
    var v = { p: P.id.replace("panel-", "") }, b;
    if ((b = sel(P, '[data-sub][aria-selected="true"]'))) v.s = b.getAttribute("data-sub");
    if ((b = sel(P, '.wt-b[aria-selected="true"]'))) { var a = ["data-wgrp", "data-wflag", "data-wsub"].filter(function (x) { return b.hasAttribute(x); })[0]; if (a) v.w = a + "=" + b.getAttribute(a); }
    if ((b = sel(P, '[data-subpanel].on .st-nav .st-b[aria-selected="true"]') || (P.querySelector("[data-subpanel]") ? null : sel(P, '.st-nav .st-b[aria-selected="true"]')))) { var k = b.getAttribute("data-stk") ? "data-stk" : b.getAttribute("data-st") ? "data-st" : null; if (k) v.t = k + "=" + b.getAttribute(k); }
    if (doc.querySelector("#mdc-overlay.on")) v.m = (doc.getElementById("mdc-overlay").getAttribute("data-key") || "1");
    return v;
  }
  function key(v) { return v ? [v.p, v.s || "", v.w || "", v.t || "", v.m || ""].join("|") : ""; }
  function hashOf(v) { return "#v=" + encodeURIComponent([v.p, v.s].filter(Boolean).join(".")); }
  function record() {
    if (busy) return; var v = snap(); if (!v) return; var k = key(v); if (k === last) return;
    try { if (!last) history.replaceState({ desk: v }, "", hashOf(v)); else history.pushState({ desk: v }, "", hashOf(v)); } catch (e) {}
    last = k;
  }
  function press(q) { var b = doc.querySelector(q); if (b && b.getAttribute("aria-selected") !== "true") b.click(); }
  function restore(v) {
    busy = true;
    try {
      var o = doc.getElementById("mdc-overlay"); if (o && !v.m) o.remove();
      var tb = doc.querySelector('.tab-btn[data-tab="' + v.p + '"]'); if (tb && !doc.getElementById("panel-" + v.p).classList.contains("active")) tb.click();
      var P = doc.getElementById("panel-" + v.p);
      if (v.s) press('#panel-' + v.p + ' [data-sub="' + v.s + '"]');
      if (v.w) { var w = v.w.split("="); press('#panel-' + v.p + ' .wt-b[' + w[0] + '="' + w.slice(1).join("=") + '"]'); }
      if (v.t) { var t = v.t.split("="); var q = t.slice(1).join("="); var b = P && [].filter.call(P.querySelectorAll("[" + t[0] + "]"), function (x) { return x.getAttribute(t[0]) === q; })[0]; if (b && b.getAttribute("aria-selected") !== "true") b.click(); }
      if (v.m && !doc.getElementById("mdc-overlay") && root.openMacroDetail && v.m !== "1") openMacroDetail(v.m);
      try { root.dispatchEvent(new Event("resize")); } catch (e) {}
    } catch (e) {}
    setTimeout(function () { busy = false; var n = snap(); last = key(n); }, 120);
  }
  root.addEventListener("popstate", function (ev) { var v = ev.state && ev.state.desk; if (v) restore(v); });
  /* record after any click or key that may have changed the view (menus repaint asynchronously) */
  var t0 = 0;
  function soon() { clearTimeout(t0); t0 = setTimeout(record, 160); }
  doc.addEventListener("click", soon, true);
  doc.addEventListener("keyup", function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Escape") soon(); }, true);
  /* a pop-up closed with its own ✕ or Esc counts as going back, so Back does not reopen it */
  if (root.MutationObserver) new MutationObserver(function () { if (!busy && !doc.getElementById("mdc-overlay") && history.state && history.state.desk && history.state.desk.m) { busy = true; history.back(); setTimeout(function () { busy = false; last = key(snap()); }, 200); } }).observe(doc.body, { childList: true });
  /* first view (after the passcode screen, if any): one entry, nothing pushed */
  function first() { var v = snap(); if (v) { last = ""; record(); } else setTimeout(first, 400); }
  root.addEventListener("desk:unlock", function () { setTimeout(first, 600); });
  setTimeout(first, 1500);
  root.DESK_HISTORY = { snap: snap, record: record, restore: restore };
})(window);
