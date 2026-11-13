/* nav-ui.js — G-01 task-based navigation. Seven groups on one row; the existing tab buttons become the contextual
   sub-row of the active group, so every page, badge, count and handler is kept exactly as before (nothing removed).
   Grains/Positioning keep the selected commodity and sub-tab; one click switches Corn/Wheat/Soybeans. */
(function (root) {
  var doc = root.document, tabs = doc.querySelector("nav.tabs");
  if (!tabs || doc.getElementById("gnav")) return;
  var GRAINS = ["corn", "wheat", "soybeans"];
  var G = [   /* id, label, child tab ids (first = default), hint */
    ["overview", "Overview", ["briefing"], "US · CA briefing, markets pulse, catalyst calendar"],
    ["grains", "Grains", ["grains", "fx"], "Corn · Soybeans · Wheat · USD/CAD — price tiles open each report"],
    ["positioning", "Positioning / OI", ["positioning"], "Open interest, CFTC funds, options, volatility"],
    ["macro", "Macro", ["macro", "world"], "Macro table, CPI, world markets"],
    ["treasury", "US Treasury", ["treasury"], "US government debt — borrowing, maturity & refinancing risk"],
    ["aidebt", "AI Debt", ["aidebt"], "AI-company debt raises, Jan 2021 – Nov 2026"],
    ["events", "Events", ["events"], "Today's and upcoming releases"],
    ["intel", "Intelligence", ["intel", "policy"], "Global intel, central banks and policy"],
    ["usm", "US Markets", ["earnings"], "Market overview, stock search, company analysis, earnings calendar"],
    ["health", "Health", ["health"], "Data, API and scheduler health"]
  ];
  var LAST = {}; try { LAST = JSON.parse(localStorage.getItem("desk.gnav") || "{}") || {}; } catch (e) {}
  function save() { try { localStorage.setItem("desk.gnav", JSON.stringify(LAST)); } catch (e) {} }
  function btn(id) { return doc.getElementById("tabbtn-" + id); }
  function activePanel() { var a = doc.querySelector(".tab-panel.active"); return a ? a.id.replace("panel-", "") : ""; }
  function sub(p) { try { return (root.SUB || {})[p]; } catch (e) { return null; } }
  function groupOf(p) {
    if (GRAINS.indexOf(p) >= 0) return root.POSMODE && POSMODE.on ? "positioning" : "grains";   /* positioning-ui.js shows its reports on the grain page */
    for (var i = 0; i < G.length; i++) if (G[i][2].indexOf(p) >= 0) return G[i][0];
    return null;
  }
  function setGrainSub(k, s) { if (root.setSub && GRAINS.indexOf(k) >= 0) { try { setSub(k, s); } catch (e) {} } }

  /* the group bar */
  var bar = doc.createElement("div"); bar.id = "gnav"; bar.className = "gnav"; bar.setAttribute("role", "navigation"); bar.setAttribute("aria-label", "Desk sections");
  bar.innerHTML = G.map(function (g) { return '<button type="button" class="gnav-b" data-gnav="' + g[0] + '" title="' + g[3] + '">' + g[1] + "</button>"; }).join("");
  tabs.parentNode.insertBefore(bar, tabs);
  tabs.classList.add("gnav-sub");
  /* the active page's own sections (Overview / Derivatives / Inputs / Fundamentals …) as one row of chips: one click each */
  var chips = doc.createElement("div"); chips.id = "gsub"; chips.className = "gsub"; chips.setAttribute("aria-label", "Sections of this page");
  tabs.parentNode.insertBefore(chips, tabs.nextSibling);
  function paintChips(p) {
    var X = root.GNAV_CHIPS && GNAV_CHIPS[p];
    if (X) { var XL = X.list(), xh = XL.map(function (x) { return '<button type="button" class="gsub-b" data-gx="' + p + "|" + x[0] + '" aria-pressed="' + !!x[2] + '">' + x[1] + "</button>"; }).join("");
      if (chips.innerHTML !== xh) chips.innerHTML = xh; chips.hidden = false; return; }
    var P = doc.getElementById("panel-" + p), seen = {}, L = [];
    if (P) [].forEach.call(P.querySelectorAll(".tn-h[data-sub]"), function (h) { var id = h.getAttribute("data-sub"); if (seen[id]) return; seen[id] = 1; L.push([id, h.getAttribute("data-name") || id, h.classList.contains("md-dot")]); });
    if (L.length < 2) { chips.innerHTML = ""; chips.hidden = true; return; }
    var cur = sub(p), h = L.map(function (x) { return '<button type="button" class="gsub-b' + (x[2] ? " md-dot" : "") + '" data-gsub="' + p + "|" + x[0] + '" aria-pressed="' + (x[0] === cur) + '">' + x[1].replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</button>"; }).join("");
    if (chips.innerHTML !== h) chips.innerHTML = h; chips.hidden = false;
  }
  chips.addEventListener("click", function (ev) {
    var x = ev.target.closest("[data-gx]"); if (x) { var xq = x.getAttribute("data-gx").split("|"); if (root.GNAV_CHIPS && GNAV_CHIPS[xq[0]]) GNAV_CHIPS[xq[0]].go(xq[1]); setTimeout(paint, 40); return; }
    var b = ev.target.closest("[data-gsub]"); if (!b) return; var q = b.getAttribute("data-gsub").split("|"), P = doc.getElementById("panel-" + q[0]);
    var t = P && (P.querySelector('.subbtn[data-sub="' + q[1] + '"]') || P.querySelector('.tn-h[data-sub="' + q[1] + '"]'));
    if (t) t.click(); else if (root.setSub) setSub(q[0], q[1]);
    setTimeout(paint, 40);
  });
  /* each existing tab button is tagged with its group; only the active group's buttons show in the sub-row */
  (function () { var m = btn("macro"), f = btn("world"); if (m && f) tabs.insertBefore(m, f); })();   /* Macro first in its group */
  G.forEach(function (g) { g[2].forEach(function (id) { var b = btn(id); if (b) b.setAttribute("data-gnav-of", g[0]); }); });

  function paint() {
    var p = activePanel(), g = groupOf(p) || (p === "" ? null : null);
    if (!g) { var sel = doc.querySelector(".tab-btn[aria-selected=true][data-gnav-of]"); g = sel ? sel.getAttribute("data-gnav-of") : "grains"; }
    [].forEach.call(bar.querySelectorAll("[data-gnav]"), function (b) {
      var id = b.getAttribute("data-gnav"), on = id === g, kids = (G.filter(function (x) { return x[0] === id; })[0] || [0, 0, []])[2];
      b.setAttribute("aria-current", on ? "page" : "false");
      var any = function (c) { return kids.some(function (k) { var e = btn(k); return e && e.classList.contains(c); }); };
      b.classList.toggle("md-dot", (any("md-dot") || (id === "usm" && !!(root.ELOCK && ELOCK.hasFresh())))); b.classList.toggle("tab-today", any("tab-today"));
      var ttl = kids.map(function (k) { var e = btn(k); return e && e.title; }).filter(Boolean).join(" · "); b.title = ttl ? (G.filter(function (x) { return x[0] === id; })[0][3] + " — " + ttl) : G.filter(function (x) { return x[0] === id; })[0][3];
    });
    var kidsOn = 0;
    [].forEach.call(tabs.querySelectorAll(".tab-btn"), function (b) { var of = b.getAttribute("data-gnav-of"), show = of === g && (g === "macro" || g === "intel"); b.classList.toggle("gnav-off", !show); if (show) kidsOn++; });
    tabs.classList.toggle("gnav-empty", kidsOn < 2);
    doc.body.setAttribute("data-gnav", g);
    paintChips(p);
    if (g && p) { LAST[g] = GRAINS.indexOf(p) >= 0 ? "grains" : p; save(); }
  }

  bar.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-gnav]"); if (!b) return;
    var g = b.getAttribute("data-gnav"), p = activePanel();
    if (g === "grains") {
      var gb = btn("grains"); if (GRAINS.indexOf(p) < 0 && gb) gb.click();
      var k = activePanel(); if (GRAINS.indexOf(k) < 0) k = "corn";
      if (sub(k) === "deriv") setGrainSub(k, LAST.grainSub && LAST.grainSub !== "deriv" ? LAST.grainSub : "overview");
    } else {
      var def = G.filter(function (x) { return x[0] === g; })[0][2], t = LAST[g] && def.indexOf(LAST[g]) >= 0 ? LAST[g] : def[0], tb = btn(t);
      if (tb) tb.click();
    }
    setTimeout(paint, 30);
  });

  /* one-click commodity switch keeps the sub-tab (overview / derivatives / inputs / fundamentals) */
  doc.addEventListener("click", function (ev) {
    var pick = ev.target.closest && ev.target.closest("[data-grain-pick]"); if (!pick) return;
    var from = activePanel(), s = GRAINS.indexOf(from) >= 0 ? sub(from) : null, to = pick.getAttribute("data-grain-pick");
    if (s) setTimeout(function () { if (sub(to) !== s) setGrainSub(to, s); paint(); }, 0);
  }, true);
  doc.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest(".tab-btn, [data-sub], [data-subp]"); if (!t) return;
    setTimeout(function () { var p = activePanel(); if (GRAINS.indexOf(p) >= 0 && sub(p) && sub(p) !== "deriv") { LAST.grainSub = sub(p); save(); } paint(); }, 40);
  });
  /* badges on the hidden buttons (red dot, "updated today") are mirrored on their group */
  try { new MutationObserver(function () { clearTimeout(paint._t); paint._t = setTimeout(paint, 80); }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected", "title"] }); } catch (e) {}
  ["load", "desk:unlock"].forEach(function (e) { root.addEventListener(e, function () { setTimeout(paint, 200); }); });
  paint();

  var css = doc.createElement("style");
  css.textContent =
    ".gnav{display:flex;gap:4px;align-items:stretch;max-width:1888px;margin:8px auto 0;width:calc(100% - 32px);box-sizing:border-box;position:sticky;top:var(--strip-h,40px);z-index:41;padding:3px;border:1px solid var(--line2);border-radius:10px;background:var(--bg);overflow-x:auto;scrollbar-width:none}.gnav::-webkit-scrollbar{display:none}" +
    ".gnav-b{position:relative;flex:0 0 auto;appearance:none;border:0;background:transparent;color:var(--muted);font:700 13.5px 'IBM Plex Sans',sans-serif;padding:8px 14px;border-radius:7px;cursor:pointer;white-space:nowrap}" +
    ".gnav-b:hover{color:#fff;background:#14213a}.gnav-b[aria-current=page]{background:#1a2a42;color:#fff;box-shadow:inset 0 -2px 0 var(--cyan)}" +
    ".gnav-b:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}" +
    ".gnav-b.tab-today{box-shadow:inset 0 -2px 0 #e8b93d}.gnav-b[aria-current=page].tab-today{box-shadow:inset 0 -2px 0 var(--cyan)}" +
    ".gnav-b.md-dot:after{content:'';position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--red)}" +
    "nav.tabs.gnav-sub .tab-btn.gnav-off{display:none!important}nav.tabs.gnav-sub.gnav-empty{display:none}" +
    "nav.tabs.gnav-sub{margin-bottom:0;top:calc(var(--strip-h,40px) + 44px)}nav.tabs.gnav-sub .tab-btn{padding-top:5px;padding-bottom:5px;font-size:13px}" +
    ".gsub{display:flex;flex-wrap:wrap;gap:6px;max-width:1920px;margin:6px auto 12px;padding:0 16px;box-sizing:border-box}.gsub[hidden]{display:none}" +
    ".gsub-b{position:relative;appearance:none;border:1px solid var(--line2);background:transparent;color:var(--muted);font:600 12.5px 'IBM Plex Sans',sans-serif;padding:4px 13px;border-radius:999px;cursor:pointer}" +
    ".gsub-b:hover{color:#fff}.gsub-b[aria-pressed=true]{background:rgba(56,182,201,.16);color:#fff;border-color:rgba(56,182,201,.6)}.gsub-b.md-dot{padding-right:17px}.gsub-b.md-dot:after{content:'';position:absolute;top:50%;margin-top:-3px;right:6px;width:5px;height:5px;border-radius:50%;background:var(--red)}" +
    "nav.tabs.gnav-sub:not(.gnav-empty){padding-bottom:4px}" +
    "@media (max-width:760px){.gsub{flex-wrap:nowrap;overflow-x:auto}.gsub-b{flex:0 0 auto}.gnav-b{padding:7px 10px;font-size:12.5px}}";
  doc.head.appendChild(css);
  root.GNAV = { paint: paint, groupOf: groupOf };
})(window);
