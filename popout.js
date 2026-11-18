/* popout.js — deep links + pop-out windows (owner, Nov 18 2026).
   Every view (menu → commodity → sub-tab → section) and every report tile gets a ↗ button that opens just that view, full
   screen, in its own browser window. Lay several windows across monitors; each keeps refreshing on its own.
   The new window is unlocked by the desk window that opened it (same site, same browser session) — no passcode re-entry,
   nothing stored. A pop-out link opened any other way starts locked, like every desk visit. */
(function (root) {
  var doc = root.document, Q = new URLSearchParams(location.search), POP = null, TILE = Q.get("tile") || "";
  try { POP = Q.get("pop") ? JSON.parse(decodeURIComponent(escape(atob(Q.get("pop").replace(/-/g, "+").replace(/_/g, "/"))))) : null; } catch (e) { POP = null; }
  function enc(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function tileKey(t) { var h = t && t.querySelector("h2,h3"); if (!h) return ""; var s = ""; for (var i = 0; i < h.childNodes.length; i++) { var n = h.childNodes[i]; if (n.nodeType === 3) s += n.nodeValue; else if (n.nodeType === 1 && !/note|chip|age|badge|po-b/.test(n.className || "")) s += n.textContent; if (s.length > 60) break; }
    return s.split(/\s[—–]\s|—/)[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 48); }
  function txt(el) { if (!el) return ""; var s = ""; for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) s += el.childNodes[i].nodeValue; return (s || el.textContent).replace(/\s+/g, " ").trim(); }
  function title() { var v = root.DESK_HISTORY && DESK_HISTORY.snap(); if (!v) return "Desk"; var tb = doc.querySelector('.tab-btn[data-tab="' + v.p + '"]'), g = tb && tb.getAttribute("data-gnav-of"), gb = g && doc.querySelector('[data-gnav="' + g + '"]');
    var sb = v.s && doc.querySelector('#panel-' + v.p + ' [data-sub="' + v.s + '"] .sb-name');
    return [txt(gb), txt(tb), sb ? sb.textContent : ""].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(" · "); }
  function open(tile) {
    var v = root.DESK_HISTORY && DESK_HISTORY.snap(); if (!v) return;
    var u = location.pathname + "?pop=" + enc(v) + (tile ? "&tile=" + encodeURIComponent(tile) : "");
    var w = root.open(u, "_blank", "popup=yes,width=" + Math.min(1600, screen.availWidth) + ",height=" + Math.min(1000, screen.availHeight));
    if (!w) location.href = u;   /* pop-ups blocked: open in this tab */
  }
  root.DESK_POPOUT = { open: open };

  /* ---------- ↗ buttons ---------- */
  function addButtons() {
    var g = doc.getElementById("gnav");
    if (g && !g.querySelector(".po-view")) { var b = doc.createElement("button"); b.type = "button"; b.className = "po-b po-view"; b.title = "Open this view full screen in a new window"; b.innerHTML = "↗ Pop out"; b.onclick = function () { open(""); }; g.appendChild(b); }
    [].forEach.call(doc.querySelectorAll(".tab-panel.active .tile > h2:not([data-po]), .tab-panel.active .tile > h3:first-child:not([data-po])"), function (h) {
      h.setAttribute("data-po", "1"); var t = h.parentNode; if (t.classList.contains("subnav-tile") || !tileKey(t)) return;
      var b = doc.createElement("button"); b.type = "button"; b.className = "po-b po-tile"; b.title = "Open this report alone, full screen, in a new window"; b.textContent = "↗";
      b.onclick = function (e) { e.stopPropagation(); open(tileKey(t)); }; h.appendChild(b);
    });
  }
  var due = 0;
  new MutationObserver(function () { if (!due) { due = 1; setTimeout(function () { due = 0; addButtons(); if (POP) solo(); }, 250); } }).observe(doc.documentElement, { childList: true, subtree: true });

  /* ---------- pop-out window: unlock from the opener, restore the view, strip the chrome ---------- */
  function handoff() {
    try {
      var o = root.opener; if (!o || o.location.origin !== location.origin || o.DESK_LOCKED !== false) return false;
      var ov = doc.getElementById("gateOverlay"), lk = doc.getElementById("gateLockBtn");
      root.DESK_LOCKED = false; doc.body.classList.remove("locked"); if (ov) ov.style.display = "none"; if (lk) lk.style.display = "block";
      try { sessionStorage.setItem("deskGateAt", "ok"); sessionStorage.setItem("deskGateActive", String(Date.now())); } catch (e) {}
      root.dispatchEvent(new Event("desk:unlock"));
      var k = o.LIVE_CONFIG && o.LIVE_CONFIG.finnhubKey; if (k && root.LIVE_CONFIG) { root.LIVE_CONFIG.finnhubKey = k; root.dispatchEvent(new Event("desk:keys")); }
      return true;
    } catch (e) { return false; }
  }
  function solo() {
    if (!TILE) return;
    var P = doc.querySelector(".tab-panel.active"); if (!P) return; var hit = null;
    [].forEach.call(P.querySelectorAll(".tile"), function (t) { var k = tileKey(t), on = !!k && (k === TILE || k.indexOf(TILE) === 0 || TILE.indexOf(k) === 0) && !hit; if (on) hit = t; t.classList.toggle("po-solo", on); });
    doc.body.classList.toggle("po-has", !!hit);
  }
  function restore(n) {
    if (!POP) return;
    if (root.DESK_LOCKED !== false) { if (n < 60) setTimeout(function () { restore(n + 1); }, 500); return; }
    var P = doc.getElementById("panel-" + POP.p);
    if (!P || !P.innerHTML.trim() || !root.DESK_HISTORY) { if (n < 60) setTimeout(function () { restore(n + 1); }, 400); return; }
    DESK_HISTORY.restore(POP);
    setTimeout(function () { DESK_HISTORY.restore(POP); solo(); var h = doc.getElementById("po-head"); if (h) h.querySelector("b").textContent = (TILE ? "Report · " : "") + title(); doc.title = title() + " — AGRITrade"; }, 700);
  }
  if (POP) {
    doc.documentElement.classList.add("po-win");
    var head = doc.createElement("div"); head.id = "po-head";
    head.innerHTML = '<b>Pop-out view</b><span class="po-sp"></span><button type="button" data-po-full>Show whole page</button><button type="button" data-po-desk>Open full desk ↗</button>';
    head.addEventListener("click", function (e) {
      if (e.target.closest("[data-po-full]")) { TILE = ""; doc.querySelectorAll(".po-solo").forEach(function (t) { t.classList.remove("po-solo"); }); doc.body.classList.remove("po-has"); e.target.remove(); }
      if (e.target.closest("[data-po-desk]")) root.open(location.pathname, "_blank");
    });
    var go = function () { doc.body.insertBefore(head, doc.body.firstChild); if (!TILE) head.querySelector("[data-po-full]").remove(); handoff(); restore(0); };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function () { setTimeout(go, 50); }); else setTimeout(go, 50);
  }

  var st = doc.createElement("style");
  st.textContent = ".po-b{all:unset;cursor:pointer;font-size:12px;font-weight:700;color:var(--faint,#8a97a8);padding:2px 8px;border:1px solid transparent;border-radius:6px;margin-left:8px;vertical-align:middle;line-height:1.4}" +
    ".po-b:hover{color:#ffb84d;border-color:rgba(255,184,77,.45)}.po-view{margin-left:auto;align-self:center;border-color:var(--line,#2a3442)}" +
    ".tile>h2 .po-tile,.tile>h3 .po-tile{opacity:0;transition:opacity .15s}.tile:hover>h2 .po-tile,.tile:hover>h3 .po-tile,.po-tile:focus{opacity:1}" +
    "@media(hover:none){.tile>h2 .po-tile{opacity:.7}}" +
    "html.po-win .topbar,html.po-win #gnav,html.po-win nav.tabs,html.po-win .snapshot-banner~.season-note,html.po-win .po-view,html.po-win .layout>.rail,html.po-win #grains-head,html.po-win .feed-rail,html.po-win #feedRail{display:none!important}" +
    "html.po-win .layout{grid-template-columns:1fr!important}html.po-win .layout>.grid{max-width:none!important}" +
    "body.po-has .tab-panel.active .tile:not(.po-solo){display:none!important}body.po-has .po-solo{grid-column:1/-1!important}" +
    "#po-head{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--bg,#0b1016);border-bottom:1px solid var(--line,#2a3442);font-size:13px}" +
    "#po-head b{font-size:14px;letter-spacing:.02em}#po-head .po-sp{flex:1}#po-head button{all:unset;cursor:pointer;padding:4px 10px;border:1px solid var(--line,#2a3442);border-radius:6px;font-size:12px}#po-head button:hover{border-color:#ffb84d;color:#ffb84d}";
  doc.head.appendChild(st);
})(window);
