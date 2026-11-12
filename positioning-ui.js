/* positioning-ui.js — Positioning / OI view (Nov 2026).
   The new report menu (CFTC Traders Positions · Export Sales · Derivatives Positions · Open Interest) over the
   Corn / Soybeans / Wheat slicer, mapped onto the ORIGINAL grain-page cards. Nothing is re-drawn here: each report
   opens the existing grain page on the right menu and shows only that report's sections, so every chart, toggle,
   parameter row (rows-ui.js), observation box (obs-ui.js), options-flow card (optflow-ui.js) and spread-traceability
   card renders exactly as in the old design.

     CFTC Traders Positions  -> Derivatives: Positioning KPIs, CFTC managed money
     Export Sales            -> Fundamentals: Export sales, Export destinations, Export comparison
     Derivatives Positions   -> Derivatives: cockpit, Options data, Volatility & skew, Options flow, Position flow
     Open Interest           -> Derivatives: Open interest by strike, Carry & roll

   The commodity slicer is the grain page's own (#grains-head), so switching commodity keeps the report.
   Leaving Positioning (any other top menu) restores the grain page exactly as it was. */
(function (root) {
  "use strict";
  var doc = root.document, P = doc.getElementById("panel-positioning"), GH = doc.getElementById("grains-head");
  if (!P) return;
  var GR = ["corn", "soybeans", "wheat"];
  var REPORTS = [
    ["cftc", "CFTC Traders Positions", "deriv", ["pos", "cftc"]],
    ["exports", "Export Sales", "fund", ["exp", "dest", "xcmp"]],
    ["deriv", "Derivatives Positions", "deriv", ["cockpit", "opt", "vol", "optflow", "flow"]],
    ["oi", "Open Interest", "deriv", ["oi", "carry"]]
  ];
  var KEY = "desk.positioning", st = { report: "cftc" };
  try { var s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; if (s.report) st.report = s.report; } catch (e) {}
  if (!REPORTS.some(function (r) { return r[0] === st.report; })) st.report = "cftc";
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ report: st.report })); } catch (e) {} }
  function rep() { return REPORTS.filter(function (r) { return r[0] === st.report; })[0]; }
  function activeGrain() { var a = doc.querySelector(".tab-panel.active"), k = a ? a.id.replace("panel-", "") : ""; return GR.indexOf(k) >= 0 ? k : null; }
  function savedGrain() { try { var v = localStorage.getItem("desk.grain"); return GR.indexOf(v) >= 0 ? v : "corn"; } catch (e) { return "corn"; } }

  var css = doc.createElement("style");
  css.textContent =
    "#pos-head{max-width:1888px;margin:0 auto;padding:0 16px;box-sizing:border-box}#pos-head[hidden]{display:none}" +
    ".pos-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}" +
    ".pos-tabs button{appearance:none;font:700 13.5px 'IBM Plex Sans',sans-serif;color:var(--muted);background:transparent;border:1px solid var(--line2);border-radius:8px;padding:8px 14px;cursor:pointer}" +
    ".pos-tabs button:hover{color:#fff;background:#14213a}" +
    ".pos-tabs button[aria-selected=true]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
    ".tab-panel.pos-mode .subnav,.tab-panel.pos-mode .sec-chips{display:none!important}" +
    ".tab-panel.pos-mode .pos-hide{display:none!important}";
  doc.head.appendChild(css);

  /* the report menu sits above the grain strip + commodity slicer, outside the panels so a re-render never drops it */
  var head = doc.createElement("div"); head.id = "pos-head"; head.hidden = true;
  if (GH && GH.parentNode) GH.parentNode.insertBefore(head, GH); else P.parentNode.insertBefore(head, P);
  function paintHead() {
    var h = '<div class="pos-tabs" role="tablist" aria-label="Positioning reports">' + REPORTS.map(function (r) {
      return '<button type="button" role="tab" data-pos-report="' + r[0] + '" aria-selected="' + (r[0] === st.report) + '">' + r[1] + "</button>"; }).join("") + "</div>";
    if (head.innerHTML !== h) head.innerHTML = h;
  }

  var M = root.POSMODE = { on: false }, busy = false, prevSec = {};

  /* show only this report's sections on the open grain page; deriv rows are opened so the cards are visible */
  function apply(k) {
    if (!M.on || !k) return;
    var R = rep(), Pk = doc.getElementById("panel-" + k); if (!Pk) return;
    if (root.SUB && SUB[k] !== R[2] && root.setSub) { busy = true; try { setSub(k, R[2]); } finally { busy = false; } }
    if (R[2] === "fund" && root.SEC) {
      var sk = k + ".fund"; if (!(sk in prevSec)) prevSec[sk] = SEC[sk];
      if (SEC[sk] !== "all") { SEC[sk] = "all"; if (root.buildSecNav) buildSecNav(k); }
    }
    GR.forEach(function (g) { var x = doc.getElementById("panel-" + g); if (x) x.classList.toggle("pos-mode", g === k); });
    var sub = Pk.querySelector('[data-subpanel="' + R[2] + '"]'); if (!sub) return;
    var allow = R[3];
    [].forEach.call(sub.children, function (t) {
      var id = t.getAttribute("data-prow") || t.getAttribute("data-sec");
      var keep = !id || id === "*" ? !t.hasAttribute("data-prow") : allow.indexOf(id) >= 0;
      t.classList.toggle("pos-hide", !keep);
      if (keep && t.hasAttribute("data-prow") && t.getAttribute("aria-expanded") !== "true") { busy = true; try { t.click(); } finally { busy = false; } }   /* rows-ui opens the row */
    });
  }
  function clear() {
    if (!M.on) return;
    M.on = false; head.hidden = true;
    GR.forEach(function (g) { var x = doc.getElementById("panel-" + g); if (!x) return; x.classList.remove("pos-mode");
      [].forEach.call(x.querySelectorAll(".pos-hide"), function (t) { t.classList.remove("pos-hide"); }); });
    if (root.SEC) { Object.keys(prevSec).forEach(function (sk) { if (prevSec[sk] === undefined) delete SEC[sk]; else SEC[sk] = prevSec[sk]; if (root.buildSecNav) buildSecNav(sk.split(".")[0]); }); }
    prevSec = {};
    if (root.GNAV) setTimeout(GNAV.paint, 0);
  }
  /* open Positioning: the selected commodity's grain page, on the report's menu */
  function go() {
    var k = activeGrain() || savedGrain();
    M.on = true; paintHead(); head.hidden = false;
    busy = true;
    try {
      if (activeGrain() !== k) { if (root.GRAINS && GRAINS.pick) GRAINS.pick(k); else { var b = doc.getElementById("tabbtn-" + k); if (b) b.click(); } }
      var was = root.SUB && SUB[k];
      if (root.setSub) setSub(k, rep()[2]);
      /* Fundamentals cards (export comparison) are only built while that menu is open: rebuild once on entry */
      if (rep()[2] === "fund" && was !== "fund" && root.renderGrain) { renderGrain(k); if (root.buildSecNav) buildSecNav(k); }
    } finally { busy = false; }
    apply(k);
    if (root.GNAV) setTimeout(GNAV.paint, 0);
  }

  /* the Positioning tab itself is only a door: as soon as it opens, route to the grain page */
  if (root.MutationObserver) new MutationObserver(function () { if (P.classList.contains("active")) go(); }).observe(P, { attributes: true, attributeFilter: ["class"] });
  P.innerHTML = '<div class="tile wide"><h2>Positioning / Open Interest</h2><p class="note">Opening the report…</p></div>';

  head.addEventListener("click", function (ev) {
    var r = ev.target.closest && ev.target.closest("[data-pos-report]"); if (!r) return;
    st.report = r.getAttribute("data-pos-report"); save(); paintHead();
    var k = activeGrain() || savedGrain();
    if (rep()[2] !== "fund") clearFund(k);
    go(); root.scrollTo({ top: 0 });
  });
  function clearFund(k) { var sk = k + ".fund"; if (root.SEC && sk in prevSec) { if (prevSec[sk] === undefined) delete SEC[sk]; else SEC[sk] = prevSec[sk]; delete prevSec[sk]; } }

  /* leaving: any other top menu or a grain-page menu pill ends Positioning; the commodity slicer keeps it */
  doc.addEventListener("click", function (ev) {
    if (!M.on || busy || !ev.target.closest) return;
    var g = ev.target.closest(".gnav-b[data-gnav]");   /* body also carries data-gnav */
    if (g) { if (g.getAttribute("data-gnav") !== "positioning") clear(); return; }
    if (ev.target.closest("[data-grain-pick]")) { busy = true; setTimeout(function () { busy = false; apply(activeGrain()); }, 0);   /* the slicer switches tabs internally */ setTimeout(function () { apply(activeGrain()); }, 200); return; }
    var t = ev.target.closest(".tab-btn, [data-gsub], [data-gx]");
    if (t && !t.closest("#pos-head") && t.id !== "tabbtn-positioning") clear();
  }, true);

  /* data refreshes rebuild the grain page; rows-ui and optflow-ui add cards late — keep the report's filter on */
  var rg = root.renderGrain;
  if (typeof rg === "function") root.renderGrain = function (k) { var r = rg.apply(this, arguments); if (M.on && k === activeGrain()) apply(k); return r; };
  var pend;
  if (root.MutationObserver) new MutationObserver(function () {
    if (!M.on) return; clearTimeout(pend); pend = setTimeout(function () { apply(activeGrain()); }, 30);
  }).observe(doc.querySelector("main") || doc.body, { childList: true, subtree: true });

  root.addEventListener("desk:data", function () { if (M.on) setTimeout(function () { apply(activeGrain()); }, 50); });
  if (P.classList.contains("active")) go();
  root.POSITIONING = { go: go, clear: clear, apply: apply, state: st };
})(window);
