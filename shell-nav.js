/* shell-nav.js — side section menu + quotes ribbon (owner, Nov 23 2026).
   Click a top-menu item and the desk re-flows: the Execution Tiles quote column glides up into a one-line ribbon above the
   page, and the menu's pages and sections drop in as a left panel, key by key (piano-style stagger). Works for every top
   menu. "Classic layout" at the foot of the panel puts the old layout back; the choice is remembered.
   Also the one navigation path for menu clicks (DESK_NAV.go): a newer click cancels an older one, and a section is chosen
   only once its page is on screen — the old fixed timers could land on the wrong page or a blank section.
   Desktop only (≥ 1021 px); phones keep the existing top rows. */
(function (root) {
  var doc = root.document, gbar = doc.getElementById("gnav"), main = doc.querySelector("main");
  if (!gbar || !main) return;
  var GR = ["corn", "wheat", "soybeans"], KEY = "desk.sn", MQ = root.matchMedia("(min-width:1021px)");
  var L3 = ".pos-tabs,.it-tabs,.pi-nav,.w-tabs,.mon-tabs,.mn2-tabs,.st-nav,.ix-nav";
  var ON = false; try { ON = localStorage.getItem(KEY) === "1"; } catch (e) {}
  var RM = root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function txt(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }
  function activePanel() { var a = doc.querySelector(".tab-panel.active"); return a ? a.id.replace("panel-", "") : ""; }
  function subOf(p) { try { return (root.SUB || {})[p]; } catch (e) { return null; } }
  function group() { return doc.body.getAttribute("data-gnav") || "grains"; }

  /* ---------- one navigation path ---------- */
  var TOK = 0;
  function go(page, sub, g) {
    var tok = ++TOK, cur = activePanel();
    if (page === "corn" && GR.indexOf(cur) >= 0) page = cur;          /* grain entries follow the commodity on screen */
    if (g) { var gb = gbar.querySelector('[data-gnav="' + g + '"]'); if (gb && group() !== g) gb.click(); }
    var tb = doc.getElementById("tabbtn-" + page), P = doc.getElementById("panel-" + page);
    if (tb && !(P && P.classList.contains("active"))) tb.click();
    if (!sub) { after(); return; }
    var t0 = Date.now();
    (function step() {
      if (tok !== TOK) return;                                          /* a newer click won */
      P = doc.getElementById("panel-" + page);
      var ready = P && P.classList.contains("active") && P.querySelector('[data-subpanel="' + sub + '"], .subbtn[data-sub="' + sub + '"]');
      if (ready || Date.now() - t0 > 3000) {
        var b = P && P.querySelector('.subbtn[data-sub="' + sub + '"]');
        if (b) { if (subOf(page) !== sub || b.getAttribute("aria-selected") !== "true") b.click(); }
        else if (root.setSub) { try { setSub(page, sub); } catch (e) {} }
        after(); return;
      }
      setTimeout(step, 40);
    })();
  }
  function after() { setTimeout(function () { if (root.GNAV) try { GNAV.paint(); } catch (e) {} paint(false); }, 60); }
  root.DESK_NAV = { go: go };

  /* ---------- the panel ---------- */
  var nav = doc.createElement("nav"); nav.id = "sn"; nav.setAttribute("aria-label", "Section menu");
  main.insertBefore(nav, main.firstChild);
  var LBL = { corn: "Corn · Soybeans · Wheat", fx: "USD/CAD", macro: "US · Canada macro" };
  function pagesOf(g) {
    var M = (root.GNAV_MAP || {})[g] || [], seen = {}, out = [];
    M.forEach(function (e) { if (seen[e[0]]) return; seen[e[0]] = 1; var lab = LBL[e[0]] || (M.filter(function (x) { return x[0] === e[0] && !x[1]; })[0] || e)[2]; out.push([e[0], lab, e[3]]); });
    return out;
  }
  function l3Row(P) {   /* the visible report-tab row of the page's open section */
    if (!P) return null;
    var rows = [].filter.call(P.querySelectorAll(L3), function (r) { var sp = r.closest("[data-subpanel]");
      return r.children.length > 1 && (!sp || sp.classList.contains("on")) && (r.offsetParent || r.classList.contains("sn-hide")) && !r.closest(".fxf-tile,.vcone-tile,.rail,aside,#sn"); });
    return rows[0] || null;
  }
  var lastG = null, lastSig = "";
  function key(i, cls, attrs, label, note, cur) {
    return '<button type="button" class="sn-k ' + cls + '" style="--i:' + i + '" ' + attrs + (cur ? ' aria-current="page"' : "") + '><span class="sn-l">' + label + "</span>" + (note ? '<span class="sn-n">' + note + "</span>" : "") + "</button>";
  }
  function paint(play) {
    if (!on()) return;
    var g = group(), p = activePanel(), P = doc.getElementById("panel-" + p), s = subOf(p), i = 0, h = "";
    var gl = txt(gbar.querySelector('[data-gnav="' + g + '"]'));
    var pages = pagesOf(g); if (!pages.length && p) pages = [[p, txt(doc.getElementById("tabbtn-" + p)) || p, ""]];
    pages.forEach(function (pg) {
      var isCur = pg[0] === p || (pg[0] === "corn" && GR.indexOf(p) >= 0);
      h += key(i++, "sn-p", 'data-snp="' + pg[0] + '"', esc(pg[1]), "", isCur);
      if (!isCur || !P) return;
      var subs = [].slice.call(P.querySelectorAll(".subnav .subbtn"));
      var row = l3Row(P), rowBtns = row ? [].slice.call(row.children).filter(function (b) { return b.tagName === "BUTTON" && !b.disabled; }) : [];
      if (row) { row.classList.add("sn-hide"); row.setAttribute("data-sn-row", "1"); }
      if (subs.length) {
        h += '<div class="sn-g">';
        subs.forEach(function (b) {
          var id = b.getAttribute("data-sub"), sc = id === s, ev = txt(b.querySelector(".sb-ev"));
          h += key(i++, "sn-s", 'data-sns="' + p + "|" + id + '"', esc(txt(b.querySelector(".sb-name")) || id), ev && !/^No scheduled/.test(ev) ? esc(ev) : "", sc);
          if (sc && rowBtns.length) h += '<div class="sn-g sn-g3">' + rowBtns.map(function (rb, j) { return key(i++, "sn-t", 'data-snt="' + j + '"', esc(txt(rb)), "", rb.getAttribute("aria-selected") === "true" || rb.getAttribute("aria-pressed") === "true" || rb.classList.contains("on") || rb.classList.contains("active")); }).join("") + "</div>";
        });
        h += "</div>";
      } else if (rowBtns.length) {
        h += '<div class="sn-g">' + rowBtns.map(function (rb, j) { return key(i++, "sn-t", 'data-snt="' + j + '"', esc(txt(rb)), "", rb.getAttribute("aria-selected") === "true" || rb.getAttribute("aria-pressed") === "true" || rb.classList.contains("on") || rb.classList.contains("active")); }).join("") + "</div>";
      }
    });
    var html = '<div class="sn-h"><span>' + esc(gl || g) + '</span><i></i></div><div class="sn-keys">' + h + "</div>" +
      '<button type="button" class="sn-classic" data-snoff title="Put the quotes back on the left and the sections back on top">⇤ Classic layout</button>';
    var sig = html.replace(/ style="--i:\d+"/g, "");
    if (sig !== lastSig || play) { nav.innerHTML = html; lastSig = sig; }
    if (play || g !== lastG) { nav.classList.remove("sn-play"); void nav.offsetWidth; if (!RM) nav.classList.add("sn-play"); }
    lastG = g;
  }
  nav.addEventListener("click", function (ev) {
    var k = ev.target.closest(".sn-k, [data-snoff]"); if (!k) return;
    if (k.hasAttribute("data-snoff")) { setOn(false, true); return; }
    k.classList.add("sn-press"); setTimeout(function () { k.classList.remove("sn-press"); }, 180);
    if (k.hasAttribute("data-snp")) { go(k.getAttribute("data-snp"), null, null); return; }
    if (k.hasAttribute("data-sns")) { var q = k.getAttribute("data-sns").split("|"); go(q[0], q[1]); return; }
    if (k.hasAttribute("data-snt")) {
      /* find the row fresh (pages rebuild their tab rows) and match the tab by its label */
      var P = doc.getElementById("panel-" + activePanel()), row = l3Row(P), lab = txt(k.querySelector(".sn-l")), bs = row ? [].filter.call(row.children, function (b) { return b.tagName === "BUTTON" && !b.disabled; }) : [];
      var b = bs.filter(function (x) { return txt(x) === lab; })[0] || bs[+k.getAttribute("data-snt")]; if (b) b.click(); after();
    }
  });

  /* ---------- layout switch ---------- */
  function on() { return ON && MQ.matches; }
  function apply() { doc.body.classList.toggle("sn", on()); if (!on()) [].forEach.call(doc.querySelectorAll("[data-sn-row]"), function (r) { r.classList.remove("sn-hide"); r.removeAttribute("data-sn-row"); }); }
  function setOn(v, animate) {
    if (v === ON && doc.body.classList.contains("sn") === on()) { paint(true); return; }
    ON = v; try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {}
    var run = function () { apply(); lastSig = ""; paint(true); };
    if (animate && !RM && doc.startViewTransition) { doc.documentElement.classList.add("sn-vt"); var t = doc.startViewTransition(run); t.finished.then(function () { doc.documentElement.classList.remove("sn-vt"); }, function () { doc.documentElement.classList.remove("sn-vt"); }); }
    else { run(); if (animate && !RM) { doc.body.classList.add("sn-enter"); setTimeout(function () { doc.body.classList.remove("sn-enter"); }, 700); } }
  }
  /* a top-menu click (or a hover-card pick) switches to the side layout; repeated clicks replay the keys */
  doc.addEventListener("click", function (ev) {
    if (!MQ.matches) return;
    var b = ev.target.closest && ev.target.closest(".gnav-b[data-gnav], #gnav-hc [data-hc]"); if (!b) return;
    if (!ON) setOn(true, true); else setTimeout(function () { paint(true); }, 80);
  });
  MQ.addEventListener ? MQ.addEventListener("change", function () { apply(); paint(true); }) : MQ.addListener(function () { apply(); paint(true); });
  /* pages re-render on their own clocks: keep the panel in step, cheaply */
  var mt = 0;
  try { new MutationObserver(function (recs) { if (!on() || recs.every(function (r) { return nav.contains(r.target); })) return; clearTimeout(mt); mt = setTimeout(function () { paint(false); }, 120); }).observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-selected", "aria-pressed"] }); } catch (e) {}
  root.addEventListener("load", function () { apply(); paint(true); });
  /* when the feed or a narrow window leaves the page column under 980 px, the page's own right rail drops below the content
     instead of squeezing it (that squeeze is what cut prices and labels) */
  function fit() { var P = doc.querySelector(".tab-panel.active"), w = P ? P.getBoundingClientRect().width : 0; doc.body.classList.toggle("sn-narrow", on() && w > 0 && w < 980); }
  try { new ResizeObserver(function () { fit(); }).observe(main); } catch (e) {}
  doc.addEventListener("click", function () { setTimeout(fit, 120); });
  apply(); paint(true);

  var css = doc.createElement("style");
  css.textContent =
    "#sn{display:none}" +
    "@media (min-width:1021px){" +
    " body.sn main{display:grid!important;grid-template-columns:214px minmax(0,1fr)!important;column-gap:16px;row-gap:0;align-items:start}" +
    " body.sn main>*{grid-column:2!important;min-width:0}" +
    " body.sn #sn{display:flex;flex-direction:column;gap:8px;grid-column:1!important;grid-row:1/span 80;position:sticky;top:calc(var(--strip-h,40px) + 76px);align-self:start;max-height:calc(100vh - var(--strip-h,40px) - 96px);overflow:auto;scrollbar-width:thin;padding:4px 2px 12px;view-transition-name:sn-panel}" +
    " body.sn #gsub,body.sn.sn .tab-panel.active .subnav,body.sn.sn.fxo .tab-panel.active .subnav,body.sn.sn .tab-panel .sn-hide,body.sn.sn.fxo .tab-panel.active .sn-hide{display:none!important}" +
    /* quotes: left column → one-line ribbon on top */
    " body.sn #grains-head{grid-column:2!important;grid-row:auto!important;position:static!important;margin:0 0 12px;view-transition-name:sn-quotes}" +
    " body.sn #grains-head .gr-col-h,body.sn #grains-head .gr-tile>:not(.gr-n):not(.gr-v):not(.gr-c):not(.gr-selb),body.sn #grains-head .gr-live{display:none!important}" +
    " body.sn #grains-head .gr-top{flex-direction:row!important;font-size:11.5px;margin-bottom:6px}" +
    " body.sn #grains-head .gr-strip{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))!important;gap:8px;padding-top:8px}" +
    " body.sn #grains-head .gr-v{flex-wrap:wrap;row-gap:0}body.sn #grains-head .gr-v small{font-size:10.5px}" +
    " body.sn #grains-head .gr-tile{padding:8px 11px!important;gap:2px!important;min-width:0}" +
    " body.sn #grains-head .gr-px{font-size:21px!important}body.sn #grains-head .gr-n{font-size:11.5px}body.sn #grains-head .gr-c{font-size:11.5px}" +
    " body.sn.sn-narrow .tab-panel .layout{grid-template-columns:minmax(0,1fr)!important}body.sn.sn-narrow .tab-panel .layout>.rail{position:static;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start}" +
    " body.sn.sn-enter #grains-head{animation:snRibbon .55s cubic-bezier(.2,.8,.2,1) both}" +
    "}" +
    "@keyframes snRibbon{0%{opacity:0;transform:translateY(-14px)}100%{opacity:1;transform:none}}" +
    /* the keys */
    "#sn .sn-h{display:flex;align-items:center;gap:8px;font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#d9b46a;padding:2px 6px 4px}#sn .sn-h i{flex:1;height:1px;background:linear-gradient(90deg,#d9b46a66,transparent)}" +
    "#sn .sn-keys{display:flex;flex-direction:column;gap:3px}#sn .sn-g{display:flex;flex-direction:column;gap:3px;margin:2px 0 4px 10px;padding-left:8px;border-left:1px solid var(--line2,#2a3442)}#sn .sn-g3{margin-left:8px}" +
    "#sn .sn-k{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:flex;flex-direction:column;gap:1px;padding:8px 10px 8px 12px;border-radius:3px 7px 7px 3px;background:linear-gradient(180deg,#101824,#0b111a);border:1px solid #1d2734;border-left:3px solid #263244;" +
    "box-shadow:0 2px 0 #05080c,inset 0 1px 0 rgba(255,255,255,.04);transform-origin:left center;transition:transform .14s ease,background .14s,border-color .14s,box-shadow .14s}" +
    "#sn .sn-k:hover{transform:translateX(3px);border-left-color:#d9b46a88;background:linear-gradient(180deg,#142032,#0d1520)}" +
    "#sn .sn-k:focus-visible{outline:2px solid #d9b46a;outline-offset:1px}" +
    "#sn .sn-k[aria-current=page]{border-left-color:#d9b46a;background:linear-gradient(180deg,#1b2638,#121b28);box-shadow:0 1px 0 #05080c,inset 2px 0 10px rgba(217,180,106,.12)}" +
    "#sn .sn-k.sn-press{transform:translateX(2px) scaleY(.93);box-shadow:0 0 0 #05080c,inset 0 2px 6px rgba(0,0,0,.5)}" +
    "#sn .sn-l{font:600 13px 'IBM Plex Sans',sans-serif;color:#e8edf3;line-height:1.25}#sn .sn-p .sn-l{font-size:13.5px}#sn .sn-s{padding:6px 10px}#sn .sn-s .sn-l{font-size:12.5px;color:#cdd6e2}" +
    "#sn .sn-t{padding:5px 9px;border-left-width:2px}#sn .sn-t .sn-l{font-size:12px;font-weight:500;color:#aab6c8}#sn .sn-k[aria-current=page] .sn-l{color:#d9b46a}" +
    "#sn .sn-n{font-size:10.5px;color:#7d8aa0;line-height:1.3}" +
    "#sn.sn-play .sn-k{animation:snKey .5s cubic-bezier(.2,.9,.25,1) both;animation-delay:calc(var(--i) * 38ms)}#sn.sn-play .sn-h{animation:snHead .35s ease-out both}" +
    "@keyframes snKey{0%{opacity:0;transform:translateX(-22px) scaleY(.5)}55%{opacity:1;transform:translateX(3px) scaleY(1.06)}78%{transform:translateX(-1px) scaleY(.97)}100%{opacity:1;transform:none}}" +
    "@keyframes snHead{0%{opacity:0;letter-spacing:.3em}100%{opacity:1}}" +
    "#sn .sn-classic{all:unset;cursor:pointer;margin-top:10px;padding:6px 10px;font:600 11.5px 'IBM Plex Sans',sans-serif;color:#7d8aa0;border:1px dashed #2a3442;border-radius:999px;align-self:flex-start}#sn .sn-classic:hover{color:#d9b46a;border-color:#d9b46a}" +
    "html[data-theme=light] #sn .sn-k{background:#fff;border-color:#d8dee6;border-left-color:#c3ccd8;box-shadow:0 2px 0 #e3e8ef}html[data-theme=light] #sn .sn-l{color:#18222e}html[data-theme=light] #sn .sn-k[aria-current=page]{background:#fff8ea;border-left-color:#b8862b}html[data-theme=light] #sn .sn-k[aria-current=page] .sn-l{color:#8a5f12}" +
    /* view transition: the quotes glide from the left column to the top, the panel slides in */
    "::view-transition-group(sn-quotes){animation-duration:.6s;animation-timing-function:cubic-bezier(.2,.8,.2,1)}::view-transition-group(sn-panel){animation-duration:.45s}" +
    "::view-transition-new(sn-panel){animation:snPanelIn .45s cubic-bezier(.2,.8,.2,1) both}@keyframes snPanelIn{0%{opacity:0;transform:translateX(-24px)}100%{opacity:1;transform:none}}" +
    "::view-transition-old(root),::view-transition-new(root){animation-duration:.3s}" +
    "@media (prefers-reduced-motion:reduce){#sn .sn-k{transition:none}#sn.sn-play .sn-k,#sn.sn-play .sn-h{animation:none}}";
  doc.head.appendChild(css);
})(window);
