/* sectabs.js — one-section-at-a-time menu for long report pages (AI Debt, US Treasury, System Health).
   Each page keeps its own render; this only adds a slim tab row (same look as the Grains tabs) above the sections and
   shows the chosen section. Pages re-render freely: the menu rebuilds itself and remembers the last section per page. */
(function (root) {
  var doc = root.document, KEY = "desk.sectabs", SAVED = {};
  try { SAVED = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(SAVED)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* heading text without its notes: "02 · COST OF DEBT  WA yield …" -> "Cost of debt" */
  function label(el) {
    var h = el.querySelector("h2,h3"); if (!h) return null;
    var t = ""; for (var i = 0; i < h.childNodes.length && !t.trim(); i++) { var n = h.childNodes[i]; if (n.nodeType === 3 || (n.nodeType === 1 && n.tagName !== "BUTTON" && !/note|chip|age|tip|badge|flag/i.test(n.className || ""))) t = n.textContent; }
    t = t.split(/\s[—–]\s|\s—|—/)[0].replace(/^\s*\d+\s*[·.]\s*/, "").replace(/\s+/g, " ").trim();
    if (!t) return null;
    t = t.toLowerCase().replace(/(^|\s)(\S)/, function (m, a, b) { return a + b.toUpperCase(); });
    t = t.replace(/\b(us|u\.s\.|fy\d{4}|wa|oi|cot|cftc|ttm|gdp|ocf|fcf|api|tga)\b/gi, function (m) { return m.toUpperCase(); }).replace(/–fy/i, "–FY");
    return SHORT[t.toLowerCase()] || t;
  }
  var SHORT = { "annual debt & borrowing": "Debt & borrowing", "24-month maturity concentration": "Maturities · 24M", "refinancing cost & interest impact": "Refinancing cost",
    "maturity composition & existing interest cost": "Maturity mix", "debt servicing capacity": "Servicing capacity", "forward borrowing need": "Borrowing need",
    "debt maturity & refinancing ladder": "Maturity ladder", "refinancing cost impact": "Refinancing cost", "debt sustainability": "Sustainability", "annual debt profile": "Debt profile" };
  var CFG = {
    aidebt: { min: 3, sec: ".ad-sec", pin: [], lead: "Overview", firstAs: "Overview" },
    treasury: { min: 3, sec: ".tq-p,.tq-g", pin: [".tq-hd", ".tq-kpi", ".tq-ft"], merge: { "Assessment": "Risk indicators" } },
    health: { min: 3, sec: ".hl-sec", pin: [] }
  };
  function container(P, c) {
    var first = P.querySelector(c.sec); if (!first) return null;
    var C = first.parentElement; return C && C.querySelectorAll(":scope > " + c.sec.split(",").join(", :scope > ")).length >= c.min ? C : null;
  }
  function build(pid) {
    var P = doc.getElementById("panel-" + pid), c = CFG[pid]; if (!P || !c) return;
    var C = container(P, c); if (!C) { var old = P.querySelector(".st-nav"); if (old) old.remove(); return; }
    var groups = [], pending = [], kids = [].slice.call(C.children);
    kids.forEach(function (el) {
      if (el.classList.contains("st-nav")) return;
      if (c.pin.some(function (s) { return el.matches(s); })) return;
      if (el.matches(c.sec)) {
        var lab = label(el) || ("Section " + (groups.length + 1));
        if (!groups.length && c.firstAs) lab = c.firstAs;
        if (c.merge && c.merge[lab]) { var g0 = groups.filter(function (g) { return g.lab === c.merge[lab]; })[0]; if (g0) { g0.els = g0.els.concat(pending, [el]); pending = []; return; } }
        groups.push({ id: lab.toLowerCase().replace(/[^a-z0-9]+/g, "-"), lab: lab, els: pending.concat([el]) }); pending = [];
      } else pending.push(el);   /* unheaded blocks (e.g. the verdict) ride with the next section */
    });
    if (pending.length && groups.length) groups[groups.length - 1].els = groups[groups.length - 1].els.concat(pending);
    if (groups.length < c.min) return;
    var cur = SAVED[pid]; if (!groups.some(function (g) { return g.id === cur; })) cur = groups[0].id;
    var nav = C.querySelector(":scope > .st-nav");
    var html = groups.map(function (g) { return '<button type="button" class="st-b" data-st="' + pid + "|" + g.id + '" aria-selected="' + (g.id === cur) + '">' + esc(g.lab) + "</button>"; }).join("");
    if (!nav) { nav = doc.createElement("div"); nav.className = "st-nav"; nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Sections"); }
    var firstSec = groups[0].els[0];
    if (nav.parentElement !== C || nav.nextElementSibling !== firstSec) C.insertBefore(nav, firstSec);
    if (nav.innerHTML !== html) nav.innerHTML = html;
    groups.forEach(function (g) { g.els.forEach(function (el) { el.classList.toggle("st-off", g.id !== cur); }); });
  }
  /* grain + USD/CAD tabs: child-section menu inside the open tab, grouped by the desk's own section tags */
  var GP = ["corn", "wheat", "soybeans", "fx"];
  function buildSub(pid) {
    var P = doc.getElementById("panel-" + pid), S = P && P.querySelector("[data-subpanel].on"); if (!S) return;
    var key = (pid === "fx" ? "fx" : "grain") + "." + S.getAttribute("data-subpanel"), groups = [], by = {};   /* one choice for all three grains: switching commodity keeps the section */
    [].forEach.call(S.children, function (el) {
      var id = el.getAttribute("data-sec"); if (!id || id === "*" || el.classList.contains("st-nav")) return;
      var lab = el.getAttribute("data-sec-lab") || id; if (/^(corn|wheat|soybeans)$/i.test(lab)) lab = "Evidence"; if (lab === "season") lab = "Seasonality";
      if (!by[id]) { by[id] = { id: id, lab: lab, els: [] }; groups.push(by[id]); }
      by[id].els.push(el);
    });
    var nav = S.querySelector(":scope > .st-nav");
    if (groups.length < (S.getAttribute("data-subpanel") === "prices" ? 2 : 3)) { if (nav) nav.remove(); groups.forEach(function (g) { g.els.forEach(function (el) { el.classList.remove("st-off"); }); }); return; }
    var cur = SAVED[key]; if (cur !== "all" && !by[cur]) cur = groups[0].id;
    var html = groups.map(function (g) { return '<button type="button" class="st-b" data-stk="' + pid + "|" + key + "|" + g.id + '" aria-selected="' + (g.id === cur) + '">' + esc(g.lab) + "</button>"; }).join("") +
      '<button type="button" class="st-b st-all" data-stk="' + pid + "|" + key + '|all" aria-selected="' + (cur === "all") + '">All</button>';
    if (!nav) { nav = doc.createElement("div"); nav.className = "st-nav"; nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Sections"); }
    var first = groups[0].els[0];
    [].some.call(S.children, function (el) { if (el.getAttribute("data-sec") && el.getAttribute("data-sec") !== "*") { first = el; return true; } return false; });
    if (nav.nextElementSibling !== first) S.insertBefore(nav, first);
    if (nav.innerHTML !== html) nav.innerHTML = html;
    groups.forEach(function (g) { g.els.forEach(function (el) { el.classList.toggle("st-off", cur !== "all" && g.id !== cur); }); });
    if (pid !== "fx" && cur !== "all" && root.drawDestMaps && cur === "dest") setTimeout(drawDestMaps, 30);
  }
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-stk]"); if (!b) return;
    var q = b.getAttribute("data-stk").split("|"); SAVED[q[1]] = q[2]; save(); buildSub(q[0]);
    if (root.DESK_LIVE && DESK_LIVE.paintPills) try { DESK_LIVE.paintPills(); } catch (e) {}
    try { root.dispatchEvent(new Event("resize")); } catch (e) {}
  });
  var bsn = root.buildSecNav;
  if (typeof bsn === "function") root.buildSecNav = function (p) { var r = bsn.apply(this, arguments); if (GP.indexOf(p) >= 0) buildSub(p); return r; };
  GP.forEach(function (p) { var P = doc.getElementById("panel-" + p); if (P && P.innerHTML) buildSub(p); });
  /* cards that load after the page draws (e.g. Options flow) arrive untagged: tag and file them, never show them under the wrong section */
  var late = {};
  GP.forEach(function (p) {
    var P = doc.getElementById("panel-" + p); if (!P || !root.MutationObserver) return;
    new MutationObserver(function () {
      if (late[p]) return;
      var S = P.querySelector("[data-subpanel].on"); if (!S) return;
      var stray = [].some.call(S.children, function (el) { return el.classList.contains("tile") && !el.getAttribute("data-sec"); });
      if (!stray) return;
      late[p] = 1; setTimeout(function () { late[p] = 0; try { if (root.buildSecNav) root.buildSecNav(p); else buildSub(p); } catch (e) {} }, 80);
    }).observe(P, { childList: true, subtree: true });
  });
  var busy = {};
  function schedule(pid) { if (busy[pid]) return; busy[pid] = 1; setTimeout(function () { busy[pid] = 0; build(pid); }, 60); }
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-st]"); if (!b) return;
    var q = b.getAttribute("data-st").split("|"); SAVED[q[0]] = q[1]; save(); build(q[0]);
    var nav = b.parentElement; if (nav && nav.getBoundingClientRect().top < 60) root.scrollTo({ top: nav.getBoundingClientRect().top + root.scrollY - 120, behavior: "smooth" });
  });
  Object.keys(CFG).forEach(function (pid) {
    var P = doc.getElementById("panel-" + pid); if (!P || !root.MutationObserver) return;
    new MutationObserver(function (M) { if (M.every(function (m) { return m.target.classList && (m.target.classList.contains("st-nav") || m.target.classList.contains("st-b")); })) return; schedule(pid); })
      .observe(P, { childList: true, subtree: true });
    schedule(pid);
  });
  var css = doc.createElement("style");
  css.textContent = ".st-nav{display:flex;flex-wrap:wrap;gap:0 4px;border-bottom:1px solid var(--line,#1a1a1a);margin:4px 0 14px}" +
    ".st-b{all:unset;cursor:pointer;padding:8px 12px 9px;font:500 13.5px 'Libre Franklin',system-ui,sans-serif;color:#8f9db3;border-bottom:1px solid transparent;margin-bottom:-1px;white-space:nowrap}" +
    ".st-b:hover{color:#fff}.st-b[aria-selected=true]{color:#d9b46a;border-bottom-color:#d9b46a}.st-b:focus-visible{outline:2px solid #38b6c9}" +
    ".st-off{display:none!important}" +
    "body.fxo .st-nav{border-bottom-color:#1a1a1a}" +
    "@media (max-width:760px){.st-nav{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}}";
  doc.head.appendChild(css);
  root.SECTABS = { build: build, buildSub: buildSub };
})(window);
