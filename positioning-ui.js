/* positioning-ui.js — Report-first Positioning view (Nov 2026; repaired Nov 12).
   SHELL ONLY: four report tabs (CFTC Traders Positions, Export Sales,
   Derivatives Positions, Open Interest) over one commodity slicer
   (Corn / Soybeans / Wheat). No left panel, no section menu — this panel has
   no .layout, so buildSecNav() never touches it.
   Own state only (localStorage desk.positioning); never calls GRAINS.pick and
   never uses data-cf-pick (obs-ui.js would steal that click and switch the
   grain page).
   MOVE-ONLY REPAIR (Nov 12): the report BODIES are not rebuilt here. The
   first build re-implemented them with new markup and lost the original
   format/layout/design (Derivatives rows, OI value view + toggle, CFTC
   bar chart + short-trades observations, Export consensus + trend chart).
   This file now MIRRORS the original grain-page renderings: the desk's own
   renderers (renderGrain + buildSecNav + rows-ui.js build + obs-ui.js
   paint/cftcView/oiView) enhance the grain page, and this file CLONES those
   exact nodes into the report container. No new markup, no restyled tiles,
   no reworded labels, no dropped fields. The three-commodity summary strip
   above the CFTC detail is the only Positioning-shell addition (per the
   approved Positioning spec); everything below it is the original tile.
   Clicks inside a clone that mutate shared desk state run through the
   original handlers on the grain page, then this panel re-clones:
   - data-cf-pick (would yank the user to the grain tab) and data-secjump
     (would scroll the window) are intercepted and routed inside Positioning.
   - data-flown replaces the clicked tile in place, so it is redirected to
     the matching source button instead of the clone.
   - data-prow / data-oid / data-oiv / data-side / data-dash run against the
     clone target and update the grain page; this panel re-clones after. */
(function (root) {
  "use strict";
  var doc = root.document, P = doc.getElementById("panel-positioning");
  if (!P) return;
  var css = doc.createElement("style");
  css.textContent =
    ".pos-wrap{max-width:1888px;margin:0 auto;padding:0 0 24px}" +
    ".pos-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}" +
    ".pos-tabs button{appearance:none;font:700 13.5px 'IBM Plex Sans',sans-serif;color:var(--muted);background:transparent;border:1px solid var(--line2);border-radius:8px;padding:8px 14px;cursor:pointer}" +
    ".pos-tabs button:hover{color:#fff;background:#14213a}" +
    ".pos-tabs button[aria-selected=true]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
    ".pos-body{display:grid;grid-template-columns:1fr;gap:14px;margin-top:14px}" +
    ".pos-body .tile{margin:0}" +
    ".pos-sel td{background:rgba(56,182,201,.08)}";
  doc.head.appendChild(css);
  var GR = ["corn", "soybeans", "wheat"], NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
  var REPORTS = [["cftc", "CFTC Traders Positions"], ["exports", "Export Sales"], ["deriv", "Derivatives Positions"], ["oi", "Open Interest"]];
  var KEY = "desk.positioning", UNA = "—";
  var st = { report: "cftc", commodity: "corn" };
  try { var s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; if (s.report) st.report = s.report; if (s.commodity) st.commodity = s.commodity; } catch (e) {}
  if (GR.indexOf(st.commodity) < 0) { try { st.commodity = JSON.parse(localStorage.getItem("desk.grain") || '"corn"') || "corn"; } catch (e) { st.commodity = "corn"; } }
  if (GR.indexOf(st.commodity) < 0 && st.commodity !== "fx") st.commodity = "corn";
  if (!REPORTS.some(function (r) { return r[0] === st.report; })) st.report = "cftc";
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(v) { return v == null || isNaN(v) ? null : Math.round(Math.abs(v)).toLocaleString("en-US"); }
  function sg(v) { return v == null || isNaN(v) ? UNA : (v < 0 ? "−" : v > 0 ? "+" : "") + n(Math.abs(v)); }
  function day(iso) { if (!iso) return UNA; var p = String(iso).split("-"); if (p.length !== 3) return esc(iso); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
  function tile(inner, wide) { return '<div class="tile' + (wide ? " wide" : "") + '">' + inner + "</div>"; }
  function head(title, note) { return "<h2>" + esc(title) + (note ? ' <span class="h2note">— ' + esc(note) + "</span>" : "") + "</h2>"; }

  /* ---- source enhancement dance: open the grain page's sub-panel, run the
     desk's own enhancers on it (buildSecNav assigns data-sec, rows-ui.js
     build() groups the Derivatives rows, obs-ui.js paint() adds cftcView /
     oiView / futVal / observations boxes), then put the grain page back
     exactly where the user left it. The panel is hidden while this runs. ---- */
  function ensureEnhanced(k, sub) {
    var panel = doc.getElementById("panel-" + k);
    if (!panel || !panel.innerHTML) {
      try { if (typeof root.renderGrain === "function") root.renderGrain(k); } catch (e) {}
    }
    var saved = (root.SUB && root.SUB[k]) || "overview";
    try {
      if (saved !== sub && typeof root.setSub === "function") root.setSub(k, sub);
      if (typeof root.buildSecNav === "function") root.buildSecNav(k);
      if (root.ROWSUI && ROWSUI.build) ROWSUI.build(k);
      if (root.OBSUI && OBSUI.paint) OBSUI.paint(k);
    } catch (e) {}
    return saved;
  }
  function restoreSub(k, saved) {
    try { if (root.SUB && root.SUB[k] !== saved && typeof root.setSub === "function") root.setSub(k, saved); } catch (e) {}
  }
  /* Export tiles only exist in the fund sub-panel under the US geography;
     if the grain page is on Canada/Brazil/World, rebuild it as US for the
     clone, then put its geography back. Returns the restore record or null. */
  function ensureFundUs(k) {
    var ds = null;
    try { ds = (typeof root.dstate === "function") ? root.dstate(k) : null; } catch (e) { ds = null; }
    if (!ds) return null;
    var savedGeo = ds.fgeo || "us";
    if (savedGeo === "us") return null;
    try { ds.fgeo = "us"; if (typeof root.renderGrain === "function") root.renderGrain(k); } catch (e) {}
    return { ds: ds, geo: savedGeo, k: k };
  }
  function restoreGeo(r) {
    if (!r) return;
    try { r.ds.fgeo = r.geo; if (typeof root.renderGrain === "function") root.renderGrain(r.k); } catch (e) {}
  }
  function cloneFrom(k, sub, match) {
    var src = doc.querySelector('#panel-' + k + ' [data-subpanel="' + sub + '"]');
    if (!src) return [];
    var out = [];
    [].forEach.call(src.children, function (ch) {
      if (match && ch.classList && ch.classList.contains("st-nav")) return;
      if (!match || match(ch)) { var c = ch.cloneNode(true); if (match) c.classList.remove("st-off"); out.push(c); }
    });
    return out;
  }
  function appendAll(el, nodes) { nodes.forEach(function (x) { el.appendChild(x); }); }
  function fallback(body, title, why) {
    var d = doc.createElement("div");
    d.innerHTML = tile(head(title) + "<p>" + UNA + " — " + esc(why) + "</p>", true);
    body.appendChild(d.firstChild);
  }

  /* ---- CFTC summary strip (Positioning shell; the detail below it is the
     cloned original tile, not rebuilt here). ---- */
  function cftcSummary(k, G) {
    var C = G.cftc || [], L = C[C.length - 1], Pr = C[C.length - 2];
    if (!L) return { latest: null, prev: null, wow: null };
    return { latest: L, prev: Pr, wow: Pr ? L.net - Pr.net : null };
  }
  function mountCftc(body, k, G) {
    var saved = ensureEnhanced(k, "deriv");
    var tiles = cloneFrom(k, "deriv", function (ch) { return ch.getAttribute("data-sec") === "cftc"; });
    restoreSub(k, saved);
    var strip = '<table class="cf-tbl"><thead><tr><th>Commodity</th><th>Managed-money net</th><th>Week on week</th><th>Report date</th></tr></thead><tbody>' +
      GR.map(function (x) { var g2 = root.DATA.grains[x], s2 = cftcSummary(x, g2); if (!s2.latest) return "<tr><td>" + NAME[x] + "</td><td>" + UNA + "</td><td>" + UNA + "</td><td>" + UNA + "</td></tr>";
        return "<tr" + (x === k ? ' class="pos-sel"' : "") + "><td><b>" + NAME[x] + "</b></td><td>" + sg(s2.latest.net) + " contracts</td><td>" + (s2.wow == null ? UNA : "Funds " + (s2.wow < 0 ? "sold " : "bought ") + n(s2.wow) + " net") + "</td><td>" + day(s2.latest.date) + "</td></tr>"; }).join("") + "</tbody></table>";
    var d = doc.createElement("div");
    d.innerHTML = tile(head("CFTC Traders Positions", "what did traders buy / sell this week") + strip, true);
    body.appendChild(d.firstChild);
    if (!tiles.length) { fallback(body, "CFTC managed money", "no CFTC tile in the dataset for " + NAME[k] + "."); return; }
    appendAll(body, tiles);
  }

  /* ---- Export Sales: cloned original exp + dest tiles from the fund
     sub-panel (10-week trend + consensus verdict + destinations). ---- */
  function mountExports(body, k) {
    var geoR = ensureFundUs(k);
    var saved = ensureEnhanced(k, "fund");
    var tiles = cloneFrom(k, "fund", function (ch) { var s = ch.getAttribute("data-sec"); return s === "exp" || s === "dest"; });
    restoreSub(k, saved);
    restoreGeo(geoR);
    if (!tiles.length) { fallback(body, "Export Sales", "no export-sales tiles in the dataset for " + NAME[k] + "."); return; }
    appendAll(body, tiles);
  }

  /* ---- Derivatives Positions: the whole enhanced Derivatives sub-panel,
     verbatim — prow-top header, spread traceability, the 9 collapsible
     rows with their headlines, and every tile inside them. ---- */
  function mountDeriv(body, k) {
    var saved = ensureEnhanced(k, "deriv");
    var nodes = cloneFrom(k, "deriv", null);
    restoreSub(k, saved);
    if (!nodes.length) { fallback(body, "Derivatives Positions", "no Derivatives section in the dataset for " + NAME[k] + "."); return; }
    appendAll(body, nodes);
  }

  /* ---- Open Interest: the cloned original "oi" tile (value/contracts
     toggle, walls by value and by contracts, 12-strike tables) plus the
     cloned original roll tile (Futures roll — OI migration, roll %,
     calendar spread, trader behaviour, FUTURES OI VALUE). ---- */
  function mountOi(body, k) {
    var saved = ensureEnhanced(k, "deriv");
    var nodes = cloneFrom(k, "deriv", function (ch) {
      return ch.getAttribute("data-sec") === "oi" || (ch.classList && ch.classList.contains("roll-tile"));
    });
    restoreSub(k, saved);
    if (!nodes.length) { fallback(body, "Open Interest", "no open-interest tiles in the dataset for " + NAME[k] + "."); return; }
    appendAll(body, nodes);
  }

  /* ---- jump from a roll-tile "Options data" link: open the Derivatives
     report with that row expanded. ---- */
  function jumpToRow(spec) {
    var p = String(spec || "").split(":");
    var row = p[1] || "opt";
    st.report = "deriv"; save();
    render();
    var src = doc.querySelector('#panel-' + st.commodity + ' [data-subpanel="deriv"] [data-prow="' + row + '"]');
    if (src && src.getAttribute("aria-expanded") !== "true") { try { src.click(); } catch (e) {} }
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Freshness: the desk's renderAll repaints only the tab on screen and */
  /* marks the rest DIRTY until they are opened (index.html ~4924). The */
  /* Positioning tab is not a grain tab, so opening it does NOT repaint  */
  /* the grain panels — without this the clones would show the grain     */
  /* pages' last-painted (stale) HTML after a data refresh. When the     */
  /* panel is visible and the data stamp moved, force the full repaint   */
  /* (window.renderAllFull, the pre-dirty version) before cloning.      */
  /* ------------------------------------------------------------------ */
  var lastDataStamp = null;
  function dataStamp() { try { var m = root.DATA && root.DATA.meta; return m && (m.updated_at || JSON.stringify(m.asof || "")); } catch (e) { return null; } }
  function ensureFreshSources() {
    var s = dataStamp();
    if (!s || s === lastDataStamp) return;
    lastDataStamp = s;
    try {
      if (typeof root.renderAllFull === "function") root.renderAllFull();
      else if (typeof root.renderGrain === "function") ["corn", "wheat", "soybeans"].forEach(function (k) { try { root.renderGrain(k); } catch (e) {} });
    } catch (e) {}
  }
  lastDataStamp = dataStamp();

  /* USD/CAD: the desk's CAD positioning (leveraged-funds KPIs, CFTC CAD funds, sentiment & FX options) from the USD/CAD page */
  function mountFx(body) {
    var F = doc.getElementById("panel-fx");
    if (F && !F.innerHTML && typeof root.renderFX === "function") { try { root.renderFX(); } catch (e) {} }
    var saved = (root.SUB && root.SUB.fx) || "overview";
    try { if (saved !== "deriv" && typeof root.setSub === "function") root.setSub("fx", "deriv"); } catch (e) {}
    var nodes = cloneFrom("fx", "deriv", null);
    try { if (saved !== "deriv" && typeof root.setSub === "function") root.setSub("fx", saved); } catch (e) {}
    if (!nodes.length) { fallback(body, "USD/CAD positioning", "no CAD positioning in the dataset."); return; }
    appendAll(body, nodes);
  }
  function render() {
    if (!root.DATA || !DATA.grains) { P.innerHTML = '<div class="tile wide"><h2>Positioning / Open Interest</h2><p>Positioning data has not loaded yet.</p></div>'; return; }
    if (P.classList.contains("active")) ensureFreshSources();
    var k = st.commodity;
    if (k === "fx") {
      P.innerHTML = '<div class="pos-wrap"><div class="pos-tabs" role="tablist" aria-label="Positioning reports"><button type="button" role="tab" aria-selected="true">CAD Positioning &amp; Sentiment</button></div><div class="pos-body pos-fx" data-subpanel-clone="fx"></div></div>';
      mountFx(P.querySelector(".pos-body")); return;
    }
    var G = DATA.grains[k];
    if (!G) { P.innerHTML = '<div class="tile wide"><h2>Positioning / Open Interest</h2><p>' + UNA + " — no data for " + esc(NAME[k] || k) + " in the dataset.</p></div>"; return; }
    var tabs = '<div class="pos-tabs" role="tablist" aria-label="Positioning reports">' + REPORTS.map(function (r) { return '<button type="button" role="tab" data-pos-report="' + r[0] + '" aria-selected="' + (r[0] === st.report) + '">' + esc(r[1]) + "</button>"; }).join("") + "</div>";
    var slicer = '<div class="gr-slicer" role="group" aria-label="Commodity"><span>Commodity</span>' + GR.map(function (x) { return '<button type="button" data-pos-pick="' + x + '" aria-pressed="' + (x === k) + '">' + NAME[x] + "</button>"; }).join("") + "</div>";
    P.innerHTML = '<div class="pos-wrap">' + tabs + '<div class="pos-body"></div></div>';   /* commodity comes from the left price tiles */
    var body = P.querySelector(".pos-body");
    if (!body) return;
    if (st.report === "cftc") mountCftc(body, k, G);
    else if (st.report === "exports") mountExports(body, k);
    else if (st.report === "deriv") mountDeriv(body, k);
    else mountOi(body, k);
  }

  P.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    /* CFTC tile's own slicer must drive Positioning, never the grain page
       (obs-ui.js would call GRAINS.pick and switch the user away). */
    var cf = t.closest("[data-cf-pick]");
    if (cf) { ev.stopPropagation(); st.commodity = cf.getAttribute("data-cf-pick"); save(); render(); return; }
    /* Roll-tile "Options data" link: open that row in the Derivatives
       report instead of scrolling the grain page. */
    var sj = t.closest("[data-secjump]");
    if (sj) { ev.preventDefault(); ev.stopPropagation(); jumpToRow(sj.getAttribute("data-secjump")); return; }
    /* data-flown replaces the clicked tile in place: run it against the
       matching source button so the source (not the clone) is updated. */
    var fl = t.closest("[data-flown]");
    if (fl) {
      ev.stopPropagation();
      var srcBtn = doc.querySelector('#panel-' + st.commodity + ' [data-subpanel="deriv"] [data-flown="' + fl.getAttribute("data-flown") + '"]');
      if (srcBtn) { try { srcBtn.click(); } catch (e) {} }
      setTimeout(render, 90);
      return;
    }
    if (t.closest("[data-stk]")) { setTimeout(render, 60); return; }
    var r = t.closest("[data-pos-report]");
    if (r) { st.report = r.getAttribute("data-pos-report"); save(); render(); return; }
    var c = t.closest("[data-pos-pick]");
    if (c) { st.commodity = c.getAttribute("data-pos-pick"); save(); render(); return; }
    /* Row toggles, OI toggles, NEAR/FAR, dash and flow controls run through
       the original handlers on the grain page; re-clone once they land. */
    if (t.closest("[data-prow],[data-oid],[data-oiv],[data-side],[data-dash]")) setTimeout(render, 90);
  });
  root.addEventListener("desk:data", render);
  /* No script in the desk dispatches "desk:data" today (live.js re-renders
     through renderAll instead), so wrap renderAll the way obs-ui.js and
     grains-ui.js do: every data refresh re-clones the reports. Without this
     the panel would keep the clones from page load while the grain pages
     moved on. */
  var ra = root.renderAll;
  if (typeof ra === "function") root.renderAll = function () { var r = ra.apply(this, arguments); try { render(); } catch (e) {} return r; };
  root.addEventListener("desk:unlock", function () { setTimeout(render, 300); });
  if (root.MutationObserver) new MutationObserver(function () { if (P.classList.contains("active")) render(); }).observe(P, { attributes: true, attributeFilter: ["class"] });
  if (root.DATA) render();
  root.POSITIONING = { render: render, current: function () { return st.commodity; }, pick: function (k) { if (GR.indexOf(k) < 0 && k !== "fx") return; st.commodity = k; save(); render(); } };
})(window);
