/* US Market tracker shell (Glass Cockpit blueprint), Phase 1. Preview-only until sign-off:
     open  …/AGRITrade/?preview=tracker   close  …/AGRITrade/?preview=off   (remembered in this browser)
   Without the flag this file does nothing and the US Earnings tab is untouched.
   The existing page is not rewritten: #panel-earnings is moved into the C6 workspace and keeps its own logic and id.
   Zones here: A command bar, B category rail, C index tiles, D workspace, G tape. E inspector + F dock arrive in later phases.
   Data: world.json only, already polled by world-ui.js. No new network calls. */
(function () {
  "use strict";
  var LIVE = false, PKEY = "desk.trackerPreview", on = false;
  try {
    var q = new URLSearchParams(location.search).get("preview");
    if (q === "tracker") localStorage.setItem(PKEY, "1");
    if (q === "off") localStorage.removeItem(PKEY);
    on = localStorage.getItem(PKEY) === "1";
  } catch (e) {}
  var P = document.getElementById("panel-earnings"), BTN = document.getElementById("tabbtn-earnings");
  if (!(LIVE || on) || !P || !BTN) return;

  var CATS = [["c1", "C1", "Snapshot"], ["c2", "C2", "Indexes", "plan", 3], ["c3", "C3", "Sectors", "plan", 3], ["c4", "C4", "Breadth", "na"],
    ["c5", "C5", "Breakout Stream", "plan", 4], ["c6", "C6", "Earnings"], ["c7", "C7", "Flows", "na"], ["c8", "C8", "Deals & Events", "plan", 3],
    ["c9", "C9", "Northbook", "na"], ["wl", "", "Watchlist", "plan", 2], ["pos", "", "Positions", "na"]];
  var INDEX = ["^GSPC", "^NDX", "^IXIC", "^DJI", "^RUT"], SHORT = { "^GSPC": "S&P 500", "^NDX": "Nasdaq 100", "^IXIC": "Nasdaq Comp", "^DJI": "Dow Jones", "^RUT": "Russell 2000", "^VIX": "VIX" };
  var cat = "c1"; try { cat = localStorage.getItem("desk.usmCat") || "c1"; } catch (e) {}
  if (!CATS.some(function (c) { return c[0] === cat; })) cat = "c1";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function W() { return window.WORLD && WORLD._data ? WORLD._data() : null; }
  function bySym(s) { var w = W(); return w && (w.instruments || []).filter(function (i) { return i.sym === s; })[0] || null; }
  function num(v, d) { return v == null || isNaN(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function dirCls(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : "flat"; }
  function sg(v, d, u) { return v == null || isNaN(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), d) + (u || ""); }
  function dec(i) { return i.dec != null ? i.dec : 2; }
  function move(i) { /* yields move in bp, everything else in points and % */
    return i.kind === "yield" ? sg(i.chg == null ? null : i.chg * 100, 1, " bp") : sg(i.chg, dec(i)) + " (" + sg(i.pct, 2, "%") + ")";
  }
  function range(i) { /* UI-5: every quote carries its day high/low */
    if (i.high == null || i.low == null || i.high <= i.low || i.last == null) return '<div class="usm-rg na">Day range unavailable</div>';
    var p = Math.max(0, Math.min(100, (i.last - i.low) / (i.high - i.low) * 100));
    return '<div class="usm-rg"><span class="tr"><i style="left:' + p.toFixed(1) + '%"></i></span><span class="lh"><span>L ' + num(i.low, dec(i)) + "</span><span>H " + num(i.high, dec(i)) + "</span></span></div>";
  }
  function ageMin(i) { var t = Date.parse(i.ts || ""); return isNaN(t) ? i.delay_min : Math.max(0, (Date.now() - t) / 60000); }
  function badge(i) {
    if (!i || i.last == null) return '<span class="usm-b na">Unavailable</span>';
    if (i.status === "open") return '<span class="usm-b dl">Delayed ' + Math.round(ageMin(i) || 0) + " min</span>";
    return '<span class="usm-b cl">' + esc(i.status_label || "Closed") + "</span>";
  }
  function tile(s) {
    var i = bySym(s);
    if (!i || i.last == null) return '<div class="usm-t"><div class="n">' + esc(SHORT[s]) + '</div><span class="usm-b na">Unavailable</span></div>';
    return '<div class="usm-t"><div class="n">' + esc(SHORT[s]) + badge(i) + '</div><div class="v">' + num(i.last, dec(i)) + '</div><div class="c ' + dirCls(i.chg) + '">' + move(i) + "</div>" + range(i) + "</div>";
  }
  function table(title, rows, note) {
    rows = rows.filter(Boolean); if (!rows.length) return "";
    return '<section class="usm-card"><h3>' + esc(title) + (note ? " <small>" + esc(note) + "</small>" : "") + '</h3><div class="usm-tw"><table class="usm-tb"><thead><tr><th>Name</th><th>Last</th><th>Change</th><th>Day range</th><th>State</th></tr></thead><tbody>' +
      rows.map(function (i) { return "<tr><td>" + esc(i.name) + "</td><td>" + num(i.last, dec(i)) + (i.kind === "yield" ? "%" : "") + '</td><td class="' + dirCls(i.chg) + '">' + move(i) + "</td><td>" + range(i) + "</td><td>" + badge(i) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";
  }
  function glance() { /* the 4-question test: direction, magnitude, breadth, driver */
    var s = bySym("^GSPC"), idx = INDEX.map(bySym).filter(function (i) { return i && i.pct != null; });
    if (!s || s.pct == null || !idx.length) return '<section class="usm-card usm-gl"><span class="usm-b na">Unavailable</span><p>Waiting for a verified index read.</p></section>';
    var up = idx.filter(function (i) { return i.pct > 0; }).length, top = idx.slice().sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); })[0],
        v = bySym("^VIX"), y = (W().instruments || []).filter(function (i) { return i.id === "us10y"; })[0], bits = ["Largest index move: " + (SHORT[top.sym] || top.name) + " " + sg(top.pct, 2, "%")];
    if (v && v.pct != null) bits.push("VIX " + sg(v.pct, 1, "%"));
    if (y && y.chg != null) bits.push("10Y yield " + sg(y.chg * 100, 1, " bp"));
    return '<section class="usm-card usm-gl"><div class="h"><h3>S&amp;P 500 read</h3>' + badge(s) + '</div><div class="big ' + dirCls(s.pct) + '">' + sg(s.pct, 2, "%") + "</div>" +
      '<div class="usm-rd"><div><b>Magnitude</b>' + num(s.last, dec(s)) + " · " + sg(s.chg, dec(s)) + " pts</div><div><b>Breadth</b>" + up + " of " + idx.length + " US indexes up</div><div><b>Driver</b>" + esc(bits.join(" · ")) + "</div></div></section>";
  }
  function snapshot() {
    var w = W(); if (!w) return '<section class="usm-card"><p class="note">Loading the market read…</p></section>';
    var A = w.instruments || [], g = function (name, f) { return A.filter(function (i) { return i.group === name && (!f || f(i)); }); };
    var fut = function (i) { return /=F$/.test(i.sym || ""); };
    return glance() + '<div class="usm-2">' +
      table("Volatility & US yields", g("Rates & Vol", function (i) { return i.sym === "^VIX" || /^US Treasury/.test(i.sym || ""); }), "Cash") +
      table("Currencies", g("FX", function (i) { return ["DX-Y.NYB", "CAD=X", "EURUSD=X", "JPY=X"].indexOf(i.sym) >= 0; }), "Spot") +
      table("Energy & metals", g("Energy", fut).concat(g("Metals", fut)), "Futures") +
      table("Industrial & ags", g("Industrial & Ags", fut), "Futures") + "</div>";
  }
  function holding(c) {
    if (c[3] === "na") return '<section class="usm-card usm-hold"><span class="usm-b na">Unavailable</span><h3>' + esc(c[2]) + "</h3><p>No verified data source is connected for this view yet, so no figures are shown.</p></section>";
    return '<section class="usm-card usm-hold"><span class="usm-b cl">Planned · Phase ' + c[4] + "</span><h3>" + esc(c[2]) + "</h3><p>This view is built in Phase " + c[4] + ". Nothing is shown until its data is verified.</p></section>";
  }
  function current() { return CATS.filter(function (c) { return c[0] === cat; })[0]; }

  /* -------- shell -------- */
  var css = document.createElement("style");
  css.textContent = '#usm{display:none;gap:10px;grid-template-columns:172px minmax(0,1fr);grid-template-areas:"a a" "c c" "b d" "g g"}#usm:has(#panel-earnings.active){display:grid}' +
    '.usm-a{grid-area:a;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:8px 12px}.usm-a b{font-size:14px;color:var(--ink);letter-spacing:.02em}' +
    '.usm-s{flex:1 1 240px;max-width:460px;background:var(--panel2);color:var(--ink);border:1px solid var(--line2);border-radius:6px;padding:7px 10px;font:inherit;font-size:13px}.usm-s:focus-visible{outline:2px solid var(--cyan);outline-offset:1px}' +
    '.usm-st{margin-left:auto;display:flex;gap:10px;align-items:center;font:500 12px "IBM Plex Mono",monospace;color:var(--muted);flex-wrap:wrap}' +
    '.usm-c{grid-area:c;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.usm-t{background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:9px 11px;min-width:0}' +
    '.usm-t .n{display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:12px;color:var(--muted)}.usm-t .v{font:600 20px "IBM Plex Mono",monospace;color:var(--ink);margin-top:3px}.usm-t .c{font:500 12.5px "IBM Plex Mono",monospace;margin-bottom:5px}' +
    '#usm .up{color:var(--green)}#usm .dn{color:var(--red)}#usm .flat{color:var(--muted)}' +
    '.usm-b{display:inline-block;white-space:nowrap;border:1px solid;border-radius:999px;padding:0 7px;font:600 10.5px/17px "IBM Plex Mono",monospace}.usm-b.dl{color:var(--amber)}.usm-b.cl{color:var(--muted);border-color:var(--line2)}.usm-b.na{color:var(--faint);border-style:dashed}' +
    '.usm-rg .tr{display:block;position:relative;height:3px;background:var(--line2);border-radius:2px;margin:4px 0 3px}.usm-rg .tr i{position:absolute;top:-2px;width:3px;height:7px;margin-left:-1px;background:var(--ink)}.usm-rg .lh{display:flex;justify-content:space-between;gap:8px;font:400 10.5px "IBM Plex Mono",monospace;color:var(--faint);white-space:nowrap}.usm-rg.na{font-size:11px;color:var(--faint)}' +
    '.usm-b-rail{grid-area:b;display:flex;flex-direction:column;gap:2px;align-self:start;position:sticky;top:8px;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:6px}' +
    '.usm-b-rail button{appearance:none;border:0;background:none;color:var(--muted);text-align:left;font:inherit;font-size:13px;padding:7px 8px;border-radius:5px;cursor:pointer;display:flex;gap:7px}.usm-b-rail button i{font:600 11px/18px "IBM Plex Mono",monospace;font-style:normal;color:var(--faint);min-width:18px}.usm-b-rail button:hover{background:var(--panel2);color:var(--ink)}.usm-b-rail button[aria-current]{background:#1a2a42;color:#fff;box-shadow:inset 2px 0 0 var(--green)}.usm-b-rail button[aria-current] i{color:#9db8d8}.usm-b-rail button:focus-visible{outline:2px solid var(--cyan)}.usm-b-rail hr{border:0;border-top:1px solid var(--line2);margin:5px 2px}' +
    '.usm-d{grid-area:d;min-width:0}.usm-crumb{font-size:12px;color:var(--faint);margin:2px 0 8px}.usm-crumb b{color:var(--muted);font-weight:600}#usm[data-cat]:not([data-cat="c6"]) #panel-earnings{display:none!important}' +
    '#usm[data-cat="c6"] #usmView{display:none}#panel-earnings .ut-hdr,#panel-earnings [data-utgo="plan"]{display:none!important}' +
    '.usm-card{background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:12px 14px;margin-bottom:10px;min-width:0}.usm-card h3{margin:0 0 8px;font-size:14px;color:var(--ink)}.usm-card h3 small{font-weight:500;color:var(--faint);margin-left:4px}.usm-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.usm-2 .usm-card{margin:0}' +
    '.usm-tw{overflow-x:auto}.usm-tb{width:100%;border-collapse:collapse;font-size:12.5px}.usm-tb th{text-align:left;color:var(--faint);font-weight:500;padding:3px 8px 5px 0;white-space:nowrap}.usm-tb td{padding:5px 8px 5px 0;border-top:1px solid var(--line);color:var(--ink);white-space:nowrap}.usm-tb td:nth-child(2),.usm-tb td:nth-child(3){font-family:"IBM Plex Mono",monospace}.usm-tb td:nth-child(4){min-width:130px}' +
    '.usm-gl .h{display:flex;justify-content:space-between;align-items:center}.usm-gl h3{margin:0}.usm-gl .big{font:600 34px "IBM Plex Mono",monospace;margin:2px 0 8px}.usm-gl .usm-rd{display:grid;grid-template-columns:1fr 1fr 2.4fr;gap:14px;font-size:13px;color:var(--ink)}.usm-gl .usm-rd b{display:block;font-size:11.5px;font-weight:500;color:var(--faint)}' +
    '.usm-hold{padding:34px 22px;text-align:center}.usm-hold h3{margin:10px 0 6px;font-size:17px}.usm-hold p{margin:0;color:var(--muted);font-size:13.5px}' +
    '.usm-g{grid-area:g;position:sticky;bottom:0;z-index:5;overflow:hidden;background:var(--panel2);border:1px solid var(--line2);border-radius:6px;font:500 12px/28px "IBM Plex Mono",monospace;white-space:nowrap}.usm-g>div{display:inline-block;padding-left:100%;animation:usmTape 80s linear infinite}.usm-g:hover>div{animation-play-state:paused}.usm-g span{margin-right:22px;color:var(--ink)}.usm-g em{font-style:normal;color:var(--faint);margin-right:14px}@keyframes usmTape{to{transform:translateX(-100%)}}' +
    '@media (prefers-reduced-motion:reduce){.usm-g{overflow-x:auto}.usm-g>div{animation:none;padding-left:8px}}' +
    '@media (max-width:1100px){.usm-c{grid-template-columns:repeat(3,minmax(0,1fr))}.usm-2{grid-template-columns:1fr}}' +
    '@media (max-width:760px){#usm{grid-template-columns:minmax(0,1fr);grid-template-areas:"a" "c" "b" "d" "g"}.usm-c{grid-template-columns:repeat(2,minmax(0,1fr))}.usm-b-rail{flex-direction:row;overflow-x:auto;position:static}.usm-b-rail button{white-space:nowrap;flex:0 0 auto}.usm-b-rail hr{display:none}.usm-gl .usm-rd{grid-template-columns:1fr}.usm-g{position:static}.usm-st{margin-left:0}}';
  document.head.appendChild(css);

  var root = document.createElement("div"); root.id = "usm";
  root.innerHTML = '<div class="usm-a"><b>US Market</b><input class="usm-s" id="usmQ" type="search" autocomplete="off" spellcheck="false" aria-label="Search a ticker or category" placeholder="Ticker or category · Ctrl+K"><div class="usm-st" id="usmSt"></div></div>' +
    '<div class="usm-c" id="usmC"></div><nav class="usm-b-rail" id="usmB" aria-label="US Market categories"></nav>' +
    '<div class="usm-d"><div class="usm-crumb" id="usmCrumb"></div><div id="usmView"></div></div><div class="usm-g" id="usmG" aria-hidden="true"></div>';
  P.parentNode.insertBefore(root, P);
  root.querySelector(".usm-d").appendChild(P);   /* C6 hosts the existing page */
  var lab = BTN.firstChild; if (lab && lab.nodeType === 3) lab.nodeValue = "US Market";

  function paintRail() {
    root.dataset.cat = cat;
    document.getElementById("usmB").innerHTML = CATS.map(function (c) {
      return (c[0] === "wl" ? "<hr>" : "") + '<button data-usmcat="' + c[0] + '"' + (c[0] === cat ? ' aria-current="page"' : "") + "><i>" + c[1] + "</i>" + esc(c[2]) + "</button>";
    }).join("");
    var c = current(); document.getElementById("usmCrumb").innerHTML = "US Market › <b>" + esc((c[1] ? c[1] + " " : "") + c[2]) + "</b>";
  }
  function paintLive() {
    var s = bySym("^GSPC");
    document.getElementById("usmSt").innerHTML = badge(s) + "<span>" + new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) + " ET</span>" +
      (s ? "<span>NYSE " + esc(s.status_label || "") + "</span>" : "") + '<span id="usmVer">' + (W() && W().updated_at ? "Verified " + new Date(W().updated_at).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "") + "</span>";
    document.getElementById("usmC").innerHTML = INDEX.map(tile).join("");
    var cash = INDEX.concat(["^VIX"]).map(bySym).filter(Boolean), fut = (W() && W().instruments || []).filter(function (i) { return /=F$/.test(i.sym || "") && i.last != null; }),
        one = function (i, n) { return "<span>" + esc(n) + " " + num(i.last, dec(i)) + ' <b class="' + dirCls(i.chg) + '">' + sg(i.pct, 2, "%") + "</b></span>"; };
    document.getElementById("usmG").innerHTML = "<div><em>CASH</em>" + cash.map(function (i) { return one(i, SHORT[i.sym] || i.name); }).join("") + "<em>FUTURES</em>" + fut.map(function (i) { return one(i, i.name.replace(/ \(.*\)/, "")); }).join("") + "</div>";
    if (cat === "c1") document.getElementById("usmView").innerHTML = snapshot();
  }
  function go(c) {
    cat = c; try { localStorage.setItem("desk.usmCat", c); } catch (e) {}
    paintRail(); var C = current();
    document.getElementById("usmView").innerHTML = c === "c1" ? snapshot() : c === "c6" ? "" : holding(C);
    if (c === "c6" && window.EARNINGS) EARNINGS.render();
  }
  root.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-usmcat]"); if (b) go(b.getAttribute("data-usmcat")); });
  /* A: command bar. A category name jumps there; anything else is treated as a ticker and handed to the C6 search */
  var Q = document.getElementById("usmQ");
  Q.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { Q.value = ""; Q.blur(); return; }
    if (ev.key !== "Enter") return;
    var t = Q.value.trim(); if (!t) return;
    var hit = CATS.filter(function (c) { var l = t.toLowerCase(); return c[1].toLowerCase() === l || c[2].toLowerCase().indexOf(l) === 0; })[0];
    Q.value = "";
    if (hit && !(t === t.toUpperCase() && !/^c\d$/i.test(t))) { go(hit[0]); return; }
    go("c6");
    var i = P.querySelector("[data-utq]"); if (!i) return;
    i.value = t; i.dispatchEvent(new Event("input", { bubbles: true })); var n = P.querySelector("[data-utq]"); if (n) n.focus();
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K") && P.classList.contains("active")) { ev.preventDefault(); Q.focus(); }
  });

  /* UI-32 to UI-36: no provider names on screen in the tracker. The C6 modules keep theirs in code; display text is rewritten here */
  var RW = [[/\s*\(Alpha Vantage\)/g, ""], [/Alpha Vantage/g, "second check"], [/Financial Modeling Prep(?: \(stable API\))?/g, "data feed"],
    [/\(FMP calendar\)/g, "(calendar)"], [/FMP (earnings calendar|real-time quote|profile)/g, "$1"], [/\bFMP plan\b/g, "data plan"], [/\bFMP\b/g, "the data feed"],
    [/SEC EDGAR XBRL company facts/g, "Regulatory filing data"], [/SEC EDGAR/g, "regulatory filings"], [/on EDGAR/g, "on file"], [/EDGAR’s data feed/g, "the filing data"], [/\bEDGAR\b/g, "regulatory filings"],
    [/SEC XBRL/g, "structured filings"], [/SEC 8-K filing/g, "8-K filing"], [/SEC filings/g, "filings"], [/Live SEC search/g, "Live search"], [/AGRITrade SEC Worker|SEC Worker/g, "live search service"], [/SEC-listed/g, "US-listed"], [/\bSEC\b/g, "regulatory"],
    [/from free Yahoo month-end closes/g, "from month-end closes"], [/Yahoo daily close/g, "Daily close"], [/Daily closes from Yahoo/g, "Daily closes"], [/Yahoo( Finance)?/g, "market data"], [/Actions? → US earnings \(prototype\)/g, "the data run"]];
  function clean(s) { for (var k = 0; k < RW.length; k++) s = s.replace(RW[k][0], RW[k][1]); return s; }
  function scrub() {
    var tw = document.createTreeWalker(P, NodeFilter.SHOW_TEXT), n;
    while ((n = tw.nextNode())) { var v = n.nodeValue, c = clean(v); if (c !== v) n.nodeValue = c; }
    P.querySelectorAll("[title],[placeholder]").forEach(function (e) { ["title", "placeholder"].forEach(function (a) { var v = e.getAttribute(a); if (v) { var c = clean(v); if (c !== v) e.setAttribute(a, c); } }); });
  }
  var mo = new MutationObserver(function () { mo.disconnect(); scrub(); watch(); });
  function watch() { mo.observe(P, { subtree: true, childList: true, characterData: true }); }
  scrub(); watch();

  paintRail(); go(cat); paintLive();
  setInterval(function () { if (P.classList.contains("active") && !document.hidden) paintLive(); }, 30000);
  (function wait(n) { if (W()) { paintLive(); return; } if (n > 0) setTimeout(function () { wait(n - 1); }, 1500); })(40);
  window.USM = { go: go };
})();
