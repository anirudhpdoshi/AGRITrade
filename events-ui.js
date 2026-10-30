/* Events desk — today's scheduled releases from every desk (Toronto calendar day) with live
   countdowns, plus a right-rail milestone feed that records what changed across the app.
   Self-contained: reads the page's existing schedule helpers and data; never changes them. */
(function () {
  "use strict";
  var TZ = "America/Toronto", MIN = 60000, H = 3600000;
  var P = document.getElementById("panel-events"), BTN = document.getElementById("tabbtn-events");
  if (!P || !BTN) return;

  /* ---------- small helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function dayIso(t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: TZ }); }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
  function dayLabel(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  function shortDay(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }); }
  function hms(ms) { return window.hmsText ? window.hmsText(ms) : Math.max(0, Math.round(ms / 60000)) + "m"; }
  function wdOf(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }); }
  function zms(iso, h, m) { var p = iso.split("-"); return window.zonedMs(+p[0], +p[1], +p[2], h, m, TZ); }
  function ready() { return window.DATA && DATA.meta && DATA.fx && window.zonedMs && window.agriEvents; }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- categories ---------- */
  var CAT = {
    usda:   { l: "USDA",     c: "#3fb97f" },
    wasde:  { l: "WASDE",    c: "#e8b93d" },
    cftc:   { l: "CFTC",     c: "#c9a3ff" },
    contract:{ l: "CONTRACT", c: "#ff9d6e" },
    ca:     { l: "CANADA",   c: "#ff8a84" },
    macro:  { l: "MACRO",    c: "#6ea8ff" },
    energy: { l: "ENERGY",   c: "#f0a35e" },
    market: { l: "MARKET",   c: "#38b6c9" },
    desk:   { l: "DESK DATA",c: "#9aa8bb" },
    cb:     { l: "CENTRAL BANK", c: "#6ea8ff" }
  };
  var GROUPS = [["all", "All"], ["agri", "Agri"], ["macro", "Macro"], ["market", "Markets"], ["desk", "Desk data"]];
  function groupOf(e) { return e.kind === "macro" || e.kind === "cb" || e.kind === "energy" ? "macro" : e.kind === "market" ? "market" : e.kind === "desk" ? "desk" : "agri"; }
  var V = store.get("desk.eventsView") || { grp: "all", high: false };
  function saveV() { store.set("desk.eventsView", V); }

  /* ---------- today's events from every source on the page ---------- */
  function todayEvents(now) {
    var today = dayIso(now), out = [], seen = {};
    function add(e) {
      if (!isFinite(e.t) || dayIso(e.t) !== today) return;
      var id = e.kind + "|" + e.label + "|" + e.t; if (seen[id]) return; seen[id] = 1; e.id = id; out.push(e);
    }
    /* agriculture: USDA weekly reports, WASDE, CFTC, CBOT contract dates, Canada (AAFC / StatCan) */
    try {
      window.agriEvents(now - 30 * H, 3).forEach(function (e) {
        var k = e.kind === "contract" ? "contract" : e.kind === "wasde" ? "wasde" : e.kind === "cftc" ? "cftc" : e.kind === "ca" ? "ca" : "usda";
        var g = /^Wheat/.test(e.label) ? "wheat" : /^Soybeans/.test(e.label) ? "soybeans" : "corn";
        add({ t: e.t, label: e.label, kind: k, cc: k === "ca" ? "ca" : "us", high: k === "wasde" || k === "contract",
          go: k === "contract" || k === "cftc" ? g + ":deriv" : k === "wasde" || k === "ca" ? "corn:fund" : "corn:overview" });
      });
    } catch (x) {}
    /* macro calendar (US + Canada, every impact level) */
    var macroAt = {};
    (DATA.fx.events || []).forEach(function (e) {
      var t = window.evEpoch ? window.evEpoch(e) : NaN; if (!isFinite(t)) return;
      var energy = /crude|oil|natural gas|petroleum|gasoline|distillate|API Weekly|EIA/i.test(e.event);
      macroAt[e.ccy + "|" + t] = 1;
      add({ t: t, label: e.ccy + " " + e.event, kind: energy ? "energy" : "macro", cc: e.ccy === "CAD" ? "ca" : "us", impact: e.impact, high: e.impact === "High",
        fc: e.fc, prev: e.prev, go: energy ? "corn:inputs" : "fx:macro" });
    });
    /* official release calendars the desk tracks directly (only where the macro calendar has no entry at that minute) */
    var RC = DATA.release_cal || {}, names = {};
    (window.macroAll ? macroAll() : []).forEach(function (m) { names[m.key] = m; });
    Object.keys(RC).forEach(function (k) {
      var m = names[k], ccy = k.indexOf("ca_") === 0 ? "CAD" : "USD";
      (RC[k].dates || []).forEach(function (d) {
        var a = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(d); if (!a) return;
        var t = zms(a[1], +a[2], +a[3]); if (macroAt[ccy + "|" + t]) return;
        add({ t: t, label: ccy + " " + (m ? m.name : k.replace(/^(us|ca)_/, "").toUpperCase()), kind: "macro", cc: ccy === "CAD" ? "ca" : "us", impact: "High", high: true, go: "fx:macro" });
      });
    });
    try {
      var PJ = window.POLICY && POLICY._data();
      ((PJ && PJ.calendar) || []).forEach(function (c) {
        if ((c.bank === "fed" || c.bank === "boc") && c.kind === "decision") return;
        var p = c.date.split("-"), tz = c.tz === "Europe/Frankfurt" ? "Europe/Berlin" : c.tz, hm2 = (c.time || "12:00").split(":"), t;
        try { t = window.zonedMs(+p[0], +p[1], +p[2], +hm2[0], +hm2[1], tz); } catch (x) { return; }
        var B = (PJ.banks || {})[c.bank] || {};
        add({ t: t, label: (B.name || c.bank.toUpperCase()) + ": " + c.what + (c.time ? "" : " (time TBA)"), kind: "cb", cc: B.cc, high: c.kind === "decision", go: "policy" });
      });
    } catch (x) {}
    var wd = wdOf(now), weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wd) >= 0;
    /* EIA weekly reports used on the Input costs view (skipped when the macro calendar already lists them) */
    var hasE = out.some(function (e) { return e.kind === "energy"; });
    if (!hasE && wd === "Wed") add({ t: zms(today, 10, 30), label: "EIA weekly petroleum status (diesel, propane)", kind: "energy", cc: "us", go: "corn:inputs" });
    if (!hasE && wd === "Thu") add({ t: zms(today, 10, 30), label: "EIA natural gas storage", kind: "energy", cc: "us", go: "corn:inputs" });
    if (weekday) {
      /* CBOT grain sessions (Central time + 1 h) and the USD/CAD reference fixes */
      add({ t: zms(today, 9, 30), label: "CBOT grains day session opens", kind: "market", cc: "us", go: "corn:overview" });
      add({ t: zms(today, 14, 20), label: "CBOT grains close · settlement", kind: "market", cc: "us", high: true, go: "corn:overview" });
      add({ t: zms(today, 16, 30), label: "Bank of Canada daily USD/CAD rate", kind: "market", cc: "ca", go: "fx:overview" });
      /* desk's own options/open-interest runs */
      add({ t: zms(today, 8, 45), label: "Options OI, IV & rollover refresh (preliminary open interest)", kind: "desk", go: "corn:deriv" });
      add({ t: zms(today, 10, 30), label: "CME final open interest published", kind: "desk", go: "corn:deriv" });
      add({ t: zms(today, 11, 10), label: "Final open-interest confirmation on the desk", kind: "desk", go: "corn:deriv" });
      add({ t: Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10), 12, 23), label: "Brazil & World fundamentals refresh (CONAB · USDA · Comex)", kind: "desk", go: "corn:fund" });
      add({ t: Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10), 17, 23), label: "Brazil & World fundamentals refresh (CONAB · USDA · Comex)", kind: "desk", go: "corn:fund" });
    }
    if (["Sun", "Mon", "Tue", "Wed", "Thu"].indexOf(wd) >= 0) add({ t: zms(today, 20, 0), label: "CBOT grains overnight session opens", kind: "market", cc: "us", go: "corn:overview" });
    return out.sort(function (a, b) { return a.t - b.t || (b.high ? 1 : 0) - (a.high ? 1 : 0); });
  }
  function nextAfterToday(now) {   /* first event on a later day, for the empty state */
    var end = now, best = null;
    for (var i = 1; i <= 6 && !best; i++) {
      end = now + i * 86400000;
      var list = todayEvents(end).filter(function (e) { return pass(e); });
      if (list.length) best = list.filter(function (e) { return e.kind !== "market" && e.kind !== "desk"; })[0] || list[0];
    }
    return best;
  }
  function pass(e) { return (V.grp === "all" || groupOf(e) === V.grp) && (!V.high || e.high); }

  /* ---------- rendering ---------- */
  function flagOf(e) { return e.cc && window.flag ? window.flag(e.cc, 13) + " " : ""; }
  function chip(e) { var c = CAT[e.kind] || CAT.desk; return '<span class="evc" style="--ec:' + c.c + '">' + c.l + "</span>"; }
  function deskName(go) { var a = (go || "").split("@")[0].split(":"); if (a[0] === "world") return "World markets"; if (a[0] === "policy") return "Policy · " + (a[1] ? "evidence" : "calendar"); return ({ corn: "Corn", wheat: "Wheat", soybeans: "Soybeans", fx: "USD/CAD" })[a[0]] + " · " + ({ overview: "Overview", deriv: "Derivatives", fund: "Fundamentals", inputs: "Input costs", macro: "Macro" })[a[1]]; }
  function row(e, now) {
    var d = e.t - now, st = d > 15 * MIN ? "up" : d > 0 ? "soon" : d > -10 * MIN ? "due" : "out";
    var LD = st === "out" || st === "due" ? landed(e) : null;
    var right = LD && LD.at ? '<span class="evs land">✓ On the desk ' + hm(LD.at) + " <small>(" + lagTxt2(LD.at - e.t) + ")</small></span>" + (LD.txt ? '<span class="evs val">' + esc(LD.txt) + "</span>" : "")
      : st === "out" ? '<span class="evs out">' + (LD && LD.pending ? "Released " + hm(e.t) + " · awaiting desk" : LD && LD.none ? "Out · " + hm(e.t) : "Out · " + hm(e.t) + " · calendar only") + "</span>"
      : st === "due" ? '<span class="evs due">Due now' + (LD && LD.pending ? " — desk checking the source" : "") + "</span>"
      : '<span class="countdown" data-t="' + e.t + '" data-fmt="hms">' + hms(d) + "</span>";
    var meta = [e.impact ? '<span class="evi i-' + esc(e.impact).toLowerCase() + '">' + esc(e.impact) + "</span>" : "",
      e.fc ? "fc <b>" + esc(e.fc) + "</b>" : "", e.prev ? "prev <b>" + esc(e.prev) + "</b>" : ""].filter(Boolean).join(" · ");
    return '<div class="evr ' + st + (e.high ? " hi" : "") + '"><div class="evt">' + hm(e.t) + '<small>ET</small></div>' +
      '<div class="evm"><div class="evl">' + flagOf(e) + esc(e.label) + " " + chip(e) + "</div>" + (meta ? '<div class="evx">' + meta + "</div>" : "") + "</div>" +
      '<div class="evr-r">' + right + (LD && LD.at && LD.go ? '<button class="evgo see" data-evgo="' + esc(LD.go) + '" data-evsel="' + esc(LD.sel || "") + '" title="Go to where this number is shown">See it: ' + esc(LD.where) + " →</button>"
        : e.go ? '<button class="evgo" data-evgo="' + e.go + '" title="Open ' + esc(deskName(e.go)) + '">' + esc(deskName(e.go)) + " →</button>" : "") + "</div></div>";
  }


  /* ---------- release → desk link: did the number land, when, and exactly where to look ---------- */
  var MAPU = [[/^(Advance|Prelim|Final) GDP q\/q|^GDP q\/q/, "us_gdp"], [/Core PCE/, "us_core_pce"], [/^Unemployment Claims/, "us_claims"], [/^Core CPI/, "us_core_cpi"], [/^CPI (y\/y|m\/m)/, "us_cpi"],
    [/Non-?Farm|Nonfarm/i, "us_nfp"], [/^Unemployment Rate/, "us_ur"], [/Average Hourly Earnings/, "us_ahe"], [/^Retail Sales m\/m/, "us_retail"], [/UoM|Michigan/, "us_umich"], [/Federal Funds Rate|FOMC Statement/, "us_policy"]];
  var MAPC = [[/Trimmed|CPI-?trim/i, "ca_trim"], [/Median CPI|CPI-?median/i, "ca_median"], [/^CPI m\/m|^CPI y\/y/, "ca_cpi"], [/Employment Change/, "ca_emp"], [/^Unemployment Rate/, "ca_ur"], [/^GDP m\/m/, "ca_gdp"],
    [/^Core Retail Sales/, "ca_retail_ex"], [/^Retail Sales m\/m/, "ca_retail"], [/Overnight Rate|BOC Rate Statement/, "ca_policy"]];
  function relKey(e) {
    if (e.kind === "macro") { var name = e.label.replace(/^(USD|CAD) /, ""), M = /^CAD /.test(e.label) ? MAPC : MAPU;
      for (var i = 0; i < M.length; i++) if (M[i][0].test(name)) return { macro: M[i][1] }; return null; }
    if (e.kind === "usda" && /Export sales/.test(e.label)) return { asof: "exports" };
    if (e.kind === "wasde") return { asof: "wasde" };
    if (e.kind === "cftc") return { asof: "cftc_grains" };
    if (e.kind === "market" && /close · settlement/.test(e.label)) return { asof: "grains_settle" };
    if (e.kind === "desk" && /Options OI/.test(e.label)) return { asof: "options" };
    if (e.kind === "desk" && /Final open-interest/.test(e.label)) return { asof: "options" };
    if (e.kind === "cb") return { cb: 1 };
    return null;
  }
  var WHERE = { exports: ["corn:fund", '[data-src="exports"]', "Fundamentals · export sales"], wasde: ["corn:fund", '[data-src="wasde"]', "Fundamentals · WASDE"],
    cftc_grains: ["corn:deriv", '[data-src="cftc_grains"]', "Derivatives · CFTC managed money"], grains_settle: ["corn:overview", '[data-src="grains_settle"]', "Overview · settles & fan"],
    options: ["corn:deriv", '[id^="oi-"]', "Derivatives · open interest by strike"] };
  function landed(e) {
    var k = relKey(e); if (!k) return null;
    var A = (DATA.meta && DATA.meta.asof) || {};
    if (k.macro) { var m = window.mfind && mfind(k.macro); if (!m) return { none: 1 };
      if (k.macro === "us_policy" || k.macro === "ca_policy") { var r = pw()[k.macro === "us_policy" ? "fed" : "boc"];
        if (r && r.status === "out" && r.date === dayIso(e.t)) return { at: Date.parse(r.t_seen), txt: r.decision + " " + rateTxt(r.rate) + " · " + r.tone, go: "events:", sel: ".pw-tile", where: "Events · central-bank card", tab: "fx" }; }
      var seen = m.seen_at ? Date.parse(m.seen_at) : 0;
      if (seen && seen >= e.t - 5 * MIN) return { at: seen, txt: m.name + " " + m.period + ": " + (window.mval ? mval(m, m.value) : m.value) + (e.fc ? " (fc " + e.fc + ")" : ""), go: "fx:macro", sel: '[data-mkey="' + k.macro + '"]', where: "USD/CAD · Macro · " + m.name, tab: "fx" };
      return { pending: 1, where: "USD/CAD · Macro · " + m.name }; }
    if (k.asof) { var w = WHERE[k.asof], at = A[k.asof] ? Date.parse(A[k.asof]) : 0, ok = at >= e.t - 5 * MIN;
      if (k.asof === "cftc_grains") { var c = DATA.grains.corn.cftc, lastD = c[c.length - 1].date; ok = lastD >= new Date(e.t - 4 * 86400000).toISOString().slice(0, 10); at = ok ? e.t : 0; }
      if (k.asof === "exports") { var E = (DATA.exports && DATA.exports.corn && DATA.exports.corn.weeks) || [], wk = E.length ? E[E.length - 1][1] : ""; ok = wk >= new Date(e.t - 8 * 86400000).toISOString().slice(0, 10); }
      return ok ? { at: at, txt: "", go: w[0], sel: w[1], where: w[2], tab: w[0].split(":")[0] } : { pending: 1, where: w[2] }; }
    if (k.cb) { var PJ = window.POLICY && POLICY._data(), bk = null;
      ((PJ && PJ.banks) ? Object.keys(PJ.banks) : []).forEach(function (b) { if (e.label.indexOf(PJ.banks[b].name) === 0) bk = b; });
      var d = bk && (PJ.docs || []).filter(function (x) { return x.bank === bk && x.published_at && Date.parse(x.published_at) >= e.t - 6 * H; })[0];
      return d ? { at: Date.parse(d.published_at), txt: (d.label || "").toLowerCase() + " (" + (d.score > 0 ? "+" : "") + d.score + ")", go: "policy:" + d.id, sel: ".pi-doc", where: "Policy · evidence", tab: "policy" } : { pending: 1, where: "Policy tab" }; }
    return null;
  }
  function lagTxt2(ms) { var m = Math.round(ms / MIN); return m <= 0 ? "on time" : m < 60 ? "+" + m + " min" : "+" + Math.floor(m / 60) + " h " + (m % 60) + " min"; }
  /* tabs and cards that received a scheduled release today get a colour and a "NEW today" ribbon until midnight */
  function decorate() {
    if (!ready()) return;
    var now = Date.now(), tabs = {}, jumps = {}, today = todayEvents(now).filter(function (e) { return e.t <= now; });
    today.forEach(function (e) { var L = landed(e); if (!L || !L.at || !L.tab) return; var nm = e.label.replace(/^(USD|CAD) /, "");
      (tabs[L.tab] = tabs[L.tab] || []).push(nm + " " + hm(L.at));
      if (L.tab !== "events" && L.go) (jumps[L.tab] = jumps[L.tab] || []).push({ n: nm, at: L.at, go: L.go, sel: L.sel || "", where: L.where || "" });
      if (L.sel && L.tab !== "events") [].forEach.call(document.querySelectorAll("#panel-" + L.tab + " " + L.sel), function (el) {
        var c = el.closest(".tile, .mcard, .dash-card, .mk-click") || el; c.classList.add("upd-today"); c.setAttribute("data-upd", "NEW today · " + hm(L.at)); }); });
    if (tabs.fx || tabs.corn) ["corn", "wheat", "soybeans"].forEach(function (g) { if (tabs.corn && g !== "corn") tabs[g] = tabs.corn; });
    if (jumps.corn) ["wheat", "soybeans"].forEach(function (g) { jumps[g] = jumps.corn.map(function (j) { return { n: j.n, at: j.at, go: j.go.replace(/^corn/, g), sel: j.sel, where: j.where.replace(/^Corn/, g[0].toUpperCase() + g.slice(1)) }; }); });
    /* a strip at the top of each tab: what landed here today, each a button that jumps to the exact card */
    [].forEach.call(document.querySelectorAll(".tab-btn"), function (b) { var k = b.getAttribute("data-tab"), P = document.getElementById("panel-" + k); if (!P || k === "events") return;
      var bar = P.querySelector(":scope > .today-bar"), J = jumps[k];
      if (!J || !J.length) { if (bar) bar.remove(); return; }
      if (!bar) { bar = document.createElement("div"); bar.className = "today-bar"; P.insertBefore(bar, P.firstChild); }
      var h = '<span class="tb-k">Updated today</span>' + J.map(function (j) { return '<button class="tb-go" data-evgo="' + esc(j.go) + '" data-evsel="' + esc(j.sel) + '" title="Go to ' + esc(j.where) + '">' + esc(j.n) + ' <small>' + hm(j.at) + '</small> →</button>'; }).join("");
      if (bar.innerHTML !== h) bar.innerHTML = h; });
    [].forEach.call(document.querySelectorAll(".tab-btn"), function (b) { var k = b.getAttribute("data-tab"), L = tabs[k];
      b.classList.toggle("tab-today", !!L); if (L) b.title = "Updated today: " + L.join(" · "); else b.removeAttribute("title"); });
  }

  /* ---------- central-bank decisions: outcome, tone and how fast the desk had it ---------- */
  var BANK = { boc: { n: "Bank of Canada", cc: "ca", key: "ca_policy", ev: /^CAD (Overnight Rate|BOC Rate Statement|BOC Monetary Policy Report)/ },
               fed: { n: "Federal Reserve", cc: "us", key: "us_policy", ev: /^USD (Federal Funds Rate|FOMC Statement)/ } };
  function pw() { return (window.DATA && DATA.policy_watch) || {}; }
  function rateTxt(r) { return r == null ? "—" : (+r).toFixed(2) + "%"; }
  function screenSeen(b, rec) { var k = "desk.pwseen." + b + "." + rec.date, v = store.get(k); if (!v && rec.status === "out") { v = Date.now(); store.set(k, v); } return v; }
  function lagTxt(min) { if (min == null || isNaN(min)) return "—"; return min < 1 ? Math.round(min * 60) + " s" : min < 60 ? min.toFixed(1) + " min" : Math.floor(min / 60) + " h " + Math.round(min % 60) + " min"; }
  function toneCls(t) { return /HAWK/.test(t || "") ? "hawk" : /DOV/.test(t || "") ? "dove" : "neu"; }
  function curRate(b) { var m = window.mfind && mfind(BANK[b].key); return m ? m.value : null; }
  function fcRate(b) { var ev = b === "boc" ? "Overnight Rate" : "Federal Funds Rate", c = b === "boc" ? "CAD" : "USD", f = null;
    ((DATA.fx && DATA.fx.events) || []).forEach(function (e) { if (e.ccy === c && e.event === ev && e.fc && e.date === dayIso(Date.now())) f = parseFloat(e.fc); }); return f; }
  function todaysDecisions(now) {
    var cal = (DATA && DATA.release_cal) || {}, out = [], today = dayIso(now);
    Object.keys(BANK).forEach(function (b) { ((cal[BANK[b].key] || {}).dates || []).forEach(function (d) { if (d.slice(0, 10) === today) out.push({ b: b, t: zms(d.slice(0, 10), +d.slice(11, 13), +d.slice(14, 16)) }); }); });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  function policyHTML(now) {
    var list = todaysDecisions(now); if (!list.length) return "";
    var W = pw();
    return '<div class="tile wide pw-tile"><h2>Central-bank decisions today <span class="h2note">— read straight from the official statement · rate, surprise vs forecast, tone and how fast the desk had it</span></h2><div class="pw-grid">' +
      list.map(function (x) {
        var B = BANK[x.b], r = W[x.b], has = r && r.date === dayIso(x.t), out = has && r.status === "out";
        var head = '<div class="pw-h">' + (window.flag ? flag(B.cc, 15) : "") + " <b>" + B.n + "</b> · " + hm(x.t) + " ET</div>";
        if (!out) {
          var waiting = now >= x.t;
          return '<div class="pw-c">' + head + '<div class="pw-st">' + (waiting ? 'Awaiting the statement — checked ' + ((has && r.checks) || 0) + ' time' + ((has && r.checks) === 1 ? "" : "s") + ' · ' + lagTxt((now - x.t) / MIN) + ' since the scheduled time' :
            'Decision in <span class="countdown" data-t="' + x.t + '" data-fmt="hms">' + hms(x.t - now) + "</span>") + "</div>" +
            '<div class="pw-s">Current ' + rateTxt(has && r.prev != null ? r.prev : curRate(x.b)) + (fcRate(x.b) != null ? " · forecast " + rateTxt(fcRate(x.b)) : "") + " · the desk reads the statement from the bank’s site every minute from 2 min before</div></div>";
        }
        var seen = screenSeen(x.b, r), scr = seen ? (seen - x.t) / MIN : null;
        return '<div class="pw-c ' + toneCls(r.tone) + '">' + head +
          '<div class="pw-dec"><span class="pw-d">' + r.decision + (r.change_bp ? " " + (r.change_bp > 0 ? "+" : "") + r.change_bp + " bp" : "") + '</span><span class="pw-r">' + rateTxt(r.prev) + " → <b>" + rateTxt(r.rate) + "</b>" + (r.lo != null ? ' <small>(range ' + (+r.lo).toFixed(2) + "–" + (+r.rate).toFixed(2) + "%)</small>" : "") + "</span>" +
          '<span class="pw-tone ' + toneCls(r.tone) + '">' + r.tone + '</span></div>' +
          '<div class="pw-s">' + (r.surprise_bp == null ? "no forecast on file" : r.surprise_bp === 0 ? "as forecast (" + rateTxt(r.fc) + ")" : (r.surprise_bp > 0 ? "hawkish surprise +" : "dovish surprise ") + r.surprise_bp + " bp vs forecast " + rateTxt(r.fc)) +
            " · tone score " + (r.score > 0 ? "+" : "") + r.score + " (decision " + r.parts.decision + ", surprise " + r.parts.surprise + ", language " + r.parts.language + ")</div>" +
          ((r.hawk || []).length ? '<div class="pw-ph"><b class="hawk">Hawkish lines</b> ' + r.hawk.map(function (p) { return "“" + esc(p) + "”"; }).join(" · ") + "</div>" : "") +
          ((r.dove || []).length ? '<div class="pw-ph"><b class="dove">Dovish lines</b> ' + r.dove.map(function (p) { return "“" + esc(p) + "”"; }).join(" · ") + "</div>" : "") +
          '<div class="pw-lag"><span>⏱ On the desk <b>' + new Date(Date.parse(r.t_seen)).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET</b> — <b>" + lagTxt(r.lag_min) + "</b> after the scheduled time</span>" +
            (scr != null ? "<span>on this screen " + lagTxt(scr) + " after</span>" : "") + (r.url && /^https:\/\/www\.(bankofcanada\.ca|federalreserve\.gov)\//.test(r.url) ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">Official statement ↗</a>' : "") + "</div></div>";
      }).join("") + "</div>" + lagTableHTML(now) + '<div class="stamp">Tone = decision (hike +2 / cut −2) + surprise vs the consensus forecast (±1 per 25 bp) + statement language (hawkish minus dovish phrases, capped ±2): ≥ +2 hawkish, ≤ −2 dovish. A phrase-based read of the statement — the lines it matched are shown so you can judge. Press-conference remarks come later and are not scored.</div></div>';
  }
  /* publication lag for every timed release today: scheduled time vs when the desk first had the new number */
  function lagTableHTML(now) {
    var today = dayIso(now), rows = [], cal = DATA.release_cal || {}, W = pw();
    (W.log || []).filter(function (x) { return x.date === today; }).forEach(function (x) { rows.push([Date.parse(x.t_sched), BANK[x.bank].n + " decision", Date.parse(x.t_seen), x.lag_min, x.decision + " · " + x.tone]); });
    var M = {}; (window.macroAll ? macroAll() : []).forEach(function (m) { M[m.key] = m; });
    Object.keys(cal).forEach(function (k) { if (k === "ca_policy" || k === "us_policy") return; ((cal[k] || {}).dates || []).forEach(function (d) {
      if (d.slice(0, 10) !== today) return; var t = zms(d.slice(0, 10), +d.slice(11, 13), +d.slice(14, 16)); if (t > now) return;
      var m = M[k], sa = m && m.seen_at ? Date.parse(m.seen_at) : null;
      rows.push([t, (m ? (m.group === "ca" ? "Canada " : "US ") + m.name : k), sa && sa >= t - 5 * MIN ? sa : null, sa && sa >= t - 5 * MIN ? (sa - t) / MIN : null, m ? m.period + " " + (window.mval ? mval(m, m.value) : m.value) : ""]); }); });
    if (!rows.length) return "";
    rows.sort(function (a, b) { return a[0] - b[0]; });
    return '<div class="pw-lagt"><h3>Publication lag — today</h3><table class="oi-mtab"><thead><tr><th>Release</th><th>Scheduled</th><th>On the desk</th><th>Lag</th><th>Result</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td>" + esc(r[1]) + "</td><td>" + hm(r[0]) + "</td><td>" + (r[2] ? new Date(r[2]).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }) : '<span class="neu">waiting</span>') + '</td><td class="' + (r[3] == null ? "neu" : r[3] <= 5 ? "up" : r[3] <= 20 ? "neu" : "dn") + '">' + lagTxt(r[3]) + "</td><td>" + esc(r[4]) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  /* the next trading day's releases, so tomorrow-morning data (e.g. 8:30 GDP) is visible the evening before */
  function tomorrowHTML(now) {
    var t = now, nd = null;
    for (var i = 1; i <= 4 && !nd; i++) { var L = todayEvents(now + i * 86400000).filter(pass).filter(function (e) { return e.kind !== "desk" && e.kind !== "market"; }); if (L.length) { nd = L; t = now + i * 86400000; } }
    if (!nd) return "";
    var key = nd.filter(function (e) { return e.high || e.impact === "High" || e.impact === "Medium" || /^(usda|wasde|cftc|contract|ca)$/.test(e.kind); });
    var rest = nd.length - key.length;
    return '<div class="tile wide ev-tom"><h2>Coming up ' + (dayIso(t) === dayIso(now + 86400000) ? "tomorrow" : "next") + ' · ' + esc(shortDay(t)) + ' <span class="h2note">— ' + nd.length + ' scheduled' + (rest ? " · showing the " + key.length + " high/medium-impact and agri releases" : "") + '</span></h2>' +
      '<div class="evlist">' + (key.length ? key : nd).map(function (e) { return row(e, now); }).join("") + "</div></div>";
  }
  var lastDay = "";
  function mainHTML(now) {
    var all = todayEvents(now), list = all.filter(pass), up = list.filter(function (e) { return e.t > now - 10 * MIN; }), done = list.filter(function (e) { return e.t <= now - 10 * MIN; });
    var nxt = up.filter(function (e) { return e.t > now; })[0], nxtLater = !nxt && nextAfterToday(now);
    if (nxtLater) nxt = nxtLater;
    var cnt = {}; all.forEach(function (e) { var g = groupOf(e); cnt[g] = (cnt[g] || 0) + 1; });
    var head = '<div class="tile wide ev-head"><div class="evh-l"><h2>Today’s events <span class="h2note">— everything scheduled to land on the desk today, in one place</span></h2>' +
      '<div class="evh-d">' + esc(dayLabel(now)) + ' · Toronto time</div>' +
      '<div class="evf">' + GROUPS.map(function (g) { var n = g[0] === "all" ? all.length : cnt[g[0]] || 0;
        return '<button data-evgrp="' + g[0] + '" aria-pressed="' + (V.grp === g[0]) + '">' + g[1] + " <small>" + n + "</small></button>"; }).join("") +
      '<button class="evhi" data-evhigh aria-pressed="' + !!V.high + '">High impact only</button></div></div>' +
      '<div class="evh-r">' + (nxt ? '<div class="evn-l">Next up · ' + (nxtLater ? esc(shortDay(nxt.t)) + " " : "") + hm(nxt.t) + ' ET</div><div class="evn-t">' + flagOf(nxt) + esc(nxt.label) + '</div><div class="hero-cd countdown" data-t="' + nxt.t + '" data-fmt="hms">' + hms(nxt.t - now) + "</div>"
        : '<div class="evn-l">Next up</div><div class="evn-t">Nothing left today</div>') +
      '<div class="evn-s"><b>' + up.length + "</b> to come · <b>" + done.length + "</b> out</div></div></div>";
    var body;
    if (!list.length) {
      var nx = nextAfterToday(now);
      body = '<div class="tile wide ev-empty"><div class="eve-i">◷</div><h3>No events today</h3><p>' + (all.length ? "Nothing matches this filter today." : "Nothing is scheduled for " + esc(shortDay(now)) + ".") + "</p>" +
        (nx ? '<p class="eve-n">Next: <b>' + flagOf(nx) + esc(nx.label) + "</b> · " + esc(shortDay(nx.t)) + " " + hm(nx.t) + ' ET · in <span class="countdown" data-t="' + nx.t + '" data-fmt="hms">' + hms(nx.t - now) + "</span></p>" : "") + "</div>";
    } else {
      body = '<div class="tile wide"><h2>Still to come <span class="h2note">— ' + up.length + " today · counting down live</span></h2>" +
        (up.length ? '<div class="evlist">' + up.map(function (e) { return row(e, now); }).join("") + "</div>"
          : '<div class="ev-empty in"><h3>No more events today</h3><p>Everything scheduled for today is out.' + (function () { var nx = nextAfterToday(now); return nx ? ' Next: <b>' + flagOf(nx) + esc(nx.label) + "</b> · " + esc(shortDay(nx.t)) + " " + hm(nx.t) + ' ET · in <span class="countdown" data-t="' + nx.t + '" data-fmt="hms">' + hms(nx.t - now) + "</span>" : ""; })() + "</p></div>") + "</div>" +
        (done.length ? '<div class="tile wide ev-done"><h2>Already out today <span class="h2note">— ' + done.length + "</span></h2><div class=\"evlist\">" + done.slice().reverse().map(function (e) { return row(e, now); }).join("") + "</div></div>" : "");
    }
    return head + policyHTML(now) + body + tomorrowHTML(now) + '<div class="tile wide"><div class="stamp">Sources combined here: USDA weekly reports and WASDE, CFTC, CBOT contract dates and sessions, Canada (AAFC / StatCan), the US + Canada macro calendar, official release calendars, EIA energy reports and the desk’s own data runs. The list resets at midnight Toronto time. Holiday closures follow the source calendars; CBOT session times assume a normal trading day.</div></div>';
  }

  /* ---------- milestone feed (right rail) ---------- */
  var FEED_KEY = "desk.milestones", feed = store.get(FEED_KEY) || [], unseen = 0;
  feed = feed.filter(function (m) { return m && Date.now() - m.t < 36 * H; });
  function log(kind, html, go, id, t) {
    id = id || kind + "|" + html;
    for (var i = 0; i < feed.length; i++) if (feed[i].id === id) return;
    feed.unshift({ t: t || Date.now(), k: kind, h: html, go: go || "", id: id });
    feed.sort(function (a, b) { return b.t - a.t; }); feed = feed.slice(0, 80); store.set(FEED_KEY, feed);
    if (!active()) unseen++;
    paintBadge(); if (active()) paintFeed();
  }
  var MK = { policy: ["🏦", "#6ea8ff"], data: ["◆", "#38b6c9"], release: ["✓", "#3fb97f"], due: ["⏱", "#e8b93d"], world: ["🌐", "#ff8a84"], oi: ["⚡", "#c9a3ff"], level: ["↕", "#6ea8ff"], day: ["☀", "#9aa8bb"] };
  var FV = "all";
  function feedHTML() {
    var now = Date.now(), list = feed.filter(function (m) { return FV === "all" || m.k === FV || (FV === "release" && m.k === "data"); });
    var head = '<div class="rail-card ev-feed"><div class="mon-head"><div class="rail-title"><span>Milestones</span><span class="hint">live · ' + feed.length + "</span></div>" +
      '<div class="mon-tabs evft">' + [["all", "All"], ["policy", "Central banks"], ["release", "Data"], ["oi", "Options"], ["world", "World"], ["level", "Levels"]].map(function (t) {
        return '<button data-evfeed="' + t[0] + '" aria-selected="' + (FV === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div></div>";
    var day = "", body = list.length ? list.map(function (m) {
      var d = dayIso(m.t), sep = d !== day ? '<div class="evfd">' + (d === dayIso(now) ? "Today" : esc(shortDay(m.t))) + "</div>" : ""; day = d;
      var k = MK[m.k] || MK.data;
      return sep + '<div class="evfi' + (m.go ? " evfi-go" : "") + '" style="--mc:' + k[1] + '"' + (m.go ? ' data-evgo="' + esc(m.go) + '" role="link" tabindex="0" title="Open ' + esc(deskName(m.go)) + ' and highlight the updated card"' : "") + '><span class="evfk">' + k[0] + '</span><div><div class="evfh">' + m.h + '</div><div class="evfs">' + hm(m.t) + " ET" +
        (m.go ? ' · <span class="evfo">Open ' + esc(deskName(m.go)) + " →</span>" : "") + "</div></div></div>"; }).join("")
      : '<div class="checkline">No milestones yet — data arrivals, open-interest shifts, wall moves, level crossings and world alerts appear here as they happen.</div>';
    return head + '<div class="rail-body mon-body evfb">' + body + '<div class="stamp">Recorded while the desk is open (kept 36 h on this browser) · newest first' + (feed.length ? ' · <a href="#" data-evclear>clear</a>' : "") + "</div></div></div>";
  }
  function paintFeed() { var r = document.getElementById("evRail"); if (r) r.innerHTML = feedHTML(); }
  function paintBadge() {
    if (!ready()) return;
    var now = Date.now(), left = todayEvents(now).filter(function (e) { return e.t > now; }).length;
    var s = BTN.querySelector(".sym"); if (s) s.textContent = left ? "Today · " + left : "Today · none";
    var b = BTN.querySelector(".evbadge");
    if (unseen > 0) { if (!b) { b = document.createElement("span"); b.className = "evbadge"; BTN.appendChild(b); } b.textContent = unseen > 9 ? "9+" : unseen; }
    else if (b) b.remove();
  }
  function active() { return P.classList.contains("active"); }
  function render() {
    if (!ready()) { P.innerHTML = '<div class="tile wide"><p class="note">Loading events…</p></div>'; return; }
    hookToast(); var now = Date.now(); lastDay = dayIso(now);
    P.innerHTML = '<div class="layout ev-lay"><div class="grid" id="evMain">' + mainHTML(now) + '</div><aside class="rail" id="evRail">' + feedHTML() + "</aside></div>";
    if (window.MOTION) window.MOTION.scan();
  }
  function repaintMain() { var m = document.getElementById("evMain"); if (m) m.innerHTML = mainHTML(Date.now()); else render(); }

  /* ---------- milestone detectors (read-only diffs of the page's data) ---------- */
  var ASOF = { cftc_grains: ["CFTC Commitments of Traders — grains", "corn:deriv"], cftc_fx: ["CFTC Commitments of Traders — CAD", "fx:deriv"], options: ["Options open interest, IV & walls", "corn:deriv"],
    grains_settle: ["CBOT grain settlements", "corn:overview"], exports: ["USDA weekly export sales", "corn:fund"], wasde: ["WASDE balance sheets", "corn:fund"], canada: ["Statistics Canada field-crop tables", "corn:fund"],
    sd_hist: ["Supply & demand history", "corn:fund"], inputs: ["Input costs (fertilizer, chemicals, energy)", "corn:inputs"], yields: ["Government bond yields", "fx:rates"], policy: ["Central-bank policy & rate odds", "fx:rates"],
    sentiment: ["Positioning sentiment", "fx:deriv"], fxopt: ["USD/CAD options (risk reversals)", "fx:deriv"], releases: ["Macro release consensus", "fx:macro"], fx_closes: ["USD/CAD daily closes", "fx:overview"] };
  delete ASOF.policy;   /* re-checked every run; real policy moves arrive as macro releases */
  /* content fingerprints: a milestone fires only when the data itself changes, not when the server merely re-checks a source */
  function fp(o) { var t = JSON.stringify(o) || "", h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return t.length + ":" + h; }
  function G(k) { return (DATA.grains && DATA.grains[k]) || {}; }
  var FP = {
    cftc_grains: function () { return ["corn", "wheat", "soybeans"].map(function (k) { var c = G(k).cftc || []; return c.length && c[c.length - 1].date; }); },
    cftc_fx: function () { var c = DATA.fx.cftc || DATA.fx.cot || []; return c.length ? c[c.length - 1] : null; },
    options: function () { return ["corn", "wheat", "soybeans"].map(function (k) { var g = G(k); return [g.near && g.near.rows, g.far && g.far.rows]; }); },
    grains_settle: function () { return ["corn", "wheat", "soybeans"].map(function (k) { return G(k).fan && [G(k).fan.anchor, G(k).fan.settle_date]; }); },
    exports: function () { return DATA.exports; }, wasde: function () { return DATA.wasde; }, canada: function () { return DATA.canada; },
    sd_hist: function () { return DATA.sd_hist; }, inputs: function () { var I = DATA.inputs && DATA.inputs.series; return I && Object.keys(I).map(function (k) { var x = I[k]; return x && (x.last || x.latest || x.value || (x.hist && x.hist[x.hist.length - 1]) || x); }); },
    yields: function () { return DATA.fx.treasury; }, sentiment: function () { return DATA.fx.sentiment; }, fxopt: function () { return DATA.fx.fxopt || DATA.fx.options; },
    releases: function () { return DATA.fx.releases; }, fx_closes: function () { return DATA.fx.closes || DATA.fx.history; }
  };
  /* sources whose as-of time is the moment new data landed (safe to replay today's refreshes on first load) */
  var SEED = { options: 1, grains_settle: 1, cftc_grains: 1, cftc_fx: 1, fx_closes: 1 };
  var base = null;
  function snap() {
    var s = { asof: Object.assign({}, DATA.meta.asof || {}), fp: {}, roll: {}, flow: {}, pw: {}, macro: {}, walls: {}, oi: {}, px: {}, gg: null, wa: {} };
    try { var PJ2 = window.POLICY && POLICY._data(); if (PJ2) { s.pol = {}; (PJ2.docs || []).forEach(function (d) { if (d.policy_relevant !== false) s.pol[d.id] = d; }); } } catch (x) {}
    ["boc", "fed"].forEach(function (b) { var r = pw()[b]; if (r) s.pw[b] = r.date + "|" + r.status + "|" + (r.t_seen || ""); });
    Object.keys(ASOF).forEach(function (k) { try { s.fp[k] = FP[k] ? fp(FP[k]()) : s.asof[k]; } catch (e) { s.fp[k] = s.asof[k]; } });
    (window.macroAll ? macroAll() : []).forEach(function (m) { s.macro[m.key] = m.period + "|" + m.value; });
    ["corn", "wheat", "soybeans"].forEach(function (k) { var g = DATA.grains && DATA.grains[k]; if (!g || !g.near) return;
      s.walls[k] = [g.near.call_wall && g.near.call_wall[0], g.near.put_wall && g.near.put_wall[0]];
      s.oi[k] = g.near.oi_label || ""; s.px[k] = g.fan && +g.fan.intraday[0];
      try { var RL = window.rollLevel && rollLevel(k); if (RL) s.roll[k] = RL; } catch (e) {}
      try { var FS = window.flowStats && flowStats(k, 10); if (FS) s.flow[k] = { b: flowBias(FS.score)[0], sc: FS.score, d: FS.last.lab }; } catch (e) {} });
    try { var G = window.GG && GG._data && GG._data(); s.gg = G && (G.updated_at || G.generated_at) || null; } catch (e) {}
    try { var W = window.WORLD && WORLD._data(); (W && W.instruments || []).forEach(function (i) { if (i.w52) s.wa[i.id || i.name] = (i.w52.new_high ? "H" : "") + (i.w52.new_low ? "L" : ""); }); } catch (e) {}
    return s;
  }
  var GN = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function detail(k) {   /* one-line summary of what the refresh brought */
    try {
      if (k === "options") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { var n = DATA.grains[g].near;
        return GN[g] + " P/C " + n.pcr + " · walls " + sk(n.put_wall[0]) + "–" + sk(n.call_wall[0]); }).join(" · ") + " — " +
        esc((DATA.grains.corn.near.oi_label || "").replace(/^.*OI as of /, "OI as of ")) + "</small>";
      if (k === "grains_settle") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { return GN[g] + " " + (+DATA.grains[g].fan.anchor).toFixed(4); }).join(" · ") + "</small>";
      if (k === "cftc_grains") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { var c = DATA.grains[g].cftc, l = c[c.length - 1]; return GN[g] + " MM " + (l.net >= 0 ? "+" : "") + Math.round(l.net / 1000) + "k"; }).join(" · ") + "</small>";
    } catch (e) {}
    return "";
  }
  function sk(v) { return "$" + (+v).toFixed(2); }
  function diff() {
    if (!ready() || window.DESK_LOCKED) return;
    var s = snap(), first = !base, today = dayIso(Date.now());
    Object.keys(ASOF).forEach(function (k) {
      var v = s.asof[k]; if (!v) return;
      /* on first load, today's earlier refreshes are added at the time they landed; afterwards, each new refresh as it arrives */
      if (first ? SEED[k] && dayIso(Date.parse(v)) === today : (s.fp[k] !== base.fp[k] && base.fp[k] != null))
        log("data", "<b>Updated</b> — " + esc(ASOF[k][0]) + detail(k), ASOF[k][1] + "@" + (WHERE[k] ? WHERE[k][1] : '[data-src="' + k + '"]'), "asof|" + k + "|" + v, first ? Date.parse(v) : 0);
    });
    if (first) { delete s.pol; base = s; return; }   /* policy items are seeded on the next pass */
    (window.macroAll ? macroAll() : []).forEach(function (m) {
      if (base.macro[m.key] && s.macro[m.key] !== base.macro[m.key]) {
        var u = m.unit === "K" ? "K" : m.unit || "";
        log("release", "<b>" + (m.group === "ca" ? "Canada" : "US") + " " + esc(m.name) + "</b> " + esc(m.period) + ": <b>" + esc(m.value) + esc(u) + "</b>" + (m.prior != null ? " (prior " + esc(m.prior) + esc(u) + ")" : ""), "fx:macro@[data-mkey=\"" + m.key + "\"]", "mac|" + m.key + "|" + s.macro[m.key]);
      }
    });
    Object.keys(s.walls).forEach(function (k) {
      var a = base.walls[k], b = s.walls[k], go = k + ':deriv@[id^="oi-"]'; if (!a) return;
      if (a[0] != null && b[0] != null && a[0] !== b[0]) log("oi", "<b>" + GN[k] + " call wall</b> moves " + sk(a[0]) + " → <b>" + sk(b[0]) + "</b> (new resistance)", go, "cw|" + k + "|" + b[0] + "|" + Math.round(Date.now() / 600000));
      if (a[1] != null && b[1] != null && a[1] !== b[1]) log("oi", "<b>" + GN[k] + " put wall</b> moves " + sk(a[1]) + " → <b>" + sk(b[1]) + "</b> (new support)", go, "pw|" + k + "|" + b[1] + "|" + Math.round(Date.now() / 600000));
      if (base.oi[k] && s.oi[k] !== base.oi[k]) {
        var S = DATA.grains[k].oishift, first = S && S.items && S.items[0];
        log("oi", "<b>" + GN[k] + " open interest refreshed</b> — " + esc((s.oi[k] || "").replace(/^.*OI as of /, "OI as of ")) + (first ? "<br><small>" + first.t + "</small>" : ""), go, "oil|" + k + "|" + s.oi[k]);
      }
      /* price trading through a wall */
      var p0 = base.px[k], p1 = s.px[k], cw = b[0], pw = b[1];
      if (isFinite(p0) && isFinite(p1)) {
        if (cw != null && p0 < cw && p1 >= cw) log("level", "<b>" + GN[k] + "</b> trades up through the call wall " + sk(cw) + " (" + p1.toFixed(4) + ")", go);
        if (pw != null && p0 > pw && p1 <= pw) log("level", "<b>" + GN[k] + "</b> trades down through the put wall " + sk(pw) + " (" + p1.toFixed(4) + ")", go);
      }
    });
    Object.keys(s.roll).forEach(function (k) {   /* futures roll crossing the 40% liquidity threshold opens the next option month */
      var a = base.roll[k], b = s.roll[k]; if (!a || !b) return;
      if (a.pct < 40 && b.pct >= 40) log("oi", "<b>" + GN[k] + " roll passes 40%</b> — " + esc(b.def) + " now holds " + b.pct.toFixed(1) + "% of open interest · next option month window is open", k + ":deriv@.roll-tile", "roll40|" + k + "|" + b.def);
      if (a.pct >= 40 && b.pct < 40) log("oi", "<b>" + GN[k] + " roll back below 40%</b> (" + b.pct.toFixed(1) + "%) — next option month window locked", k + ":deriv@.roll-tile", "roll40d|" + k + "|" + b.pct);
    });
    /* central-bank statements, minutes and speeches read by the Policy engine (all five banks) */
    if (s.pol) {
      var PJ3 = POLICY._data(), TY = { statement: "statement", minutes: "minutes", press_conference: "press conference", speech: "speech", testimony: "testimony", interview: "interview" };
      Object.keys(s.pol).forEach(function (id) {
        var d = s.pol[id], seenBefore = base.pol && base.pol[id], fresh = d.published_at && Date.now() - Date.parse(d.published_at) < 36 * H;
        if (seenBefore || !fresh) return;   /* first load: today's and yesterday's items; afterwards: anything new */
        var B = (PJ3.banks || {})[d.bank] || {}, top = (d.evidence || [])[0];
        var msg = (window.flag && B.cc && (B.cc === "us" || B.cc === "ca") ? flag(B.cc, 11) + " " : "") + "<b>" + esc(B.name || d.bank) + " — " + esc(TY[d.type] || d.type) + (d.speaker && d.speaker !== "Committee" ? " · " + esc(d.speaker) : "") + ": " +
          esc((d.label || "").toLowerCase()) + " (" + (d.score > 0 ? "+" : "") + d.score + ")</b>" + (d.guidance && d.guidance.direction !== "none" ? "<br><small>" + esc(d.guidance.next_action) + "</small>" : "") +
          (d.dissent && d.dissent.length ? "<br><small>disagreement on record</small>" : "") + (top ? "<br><small>“" + esc(top.q.slice(0, 140)) + (top.q.length > 140 ? "…" : "") + "”</small>" : "");
        log("policy", msg, "policy:" + d.id, "pol|" + d.id + "|" + (d.version || 1), Date.parse(d.published_at));
        if (base.pol && (d.type === "statement" || d.type === "press_conference") && window.DESK_LIVE && DESK_LIVE.toast) { window.__evNoLog = 1; try { DESK_LIVE.toast(msg); } finally { window.__evNoLog = 0; } }
      });
    }
    ["boc", "fed"].forEach(function (b) {   /* central-bank decision landed: feed + on-screen notification */
      var r = pw()[b]; if (!r || r.status !== "out" || s.pw[b] === base.pw[b] || r.date !== dayIso(Date.now())) return;
      var msg = "<b>" + BANK[b].n + ": " + r.decision + (r.change_bp ? " " + (r.change_bp > 0 ? "+" : "") + r.change_bp + " bp" : "") + " to " + rateTxt(r.rate) + " — " + r.tone + "</b> (score " + (r.score > 0 ? "+" : "") + r.score + ")" +
        (r.surprise_bp ? " · " + (r.surprise_bp > 0 ? "+" : "") + r.surprise_bp + " bp vs forecast" : "") + "<br><small>on the desk " + lagTxt(r.lag_min) + " after the scheduled time</small>";
      log("release", msg, "fx:macro", "pw|" + b + "|" + r.date, Date.parse(r.t_seen));
      if (window.DESK_LIVE && DESK_LIVE.toast) { window.__evNoLog = 1; try { DESK_LIVE.toast(msg); } finally { window.__evNoLog = 0; } }
      try { if (localStorage.getItem("desk.worldNotify") === "1" && "Notification" in window && Notification.permission === "granted") new Notification(BANK[b].n + " — " + r.decision + " " + rateTxt(r.rate) + " · " + r.tone, { body: "On the desk " + lagTxt(r.lag_min) + " after the scheduled time" }); } catch (e) {}
      screenSeen(b, r); if (active()) repaintMain();
    });
    Object.keys(s.flow).forEach(function (k) {   /* 10-session position-flow signal changing category */
      var a = base.flow[k], b = s.flow[k]; if (!a || !b || a.b === b.b) return;
      log("oi", "<b>" + GN[k] + " position flow: " + esc(b.b.toLowerCase()) + "</b> (was " + esc(a.b.toLowerCase()) + ") — 10-session score " + (b.sc > 0 ? "+" : "") + b.sc + " through " + esc(b.d), k + ":deriv@.fl-tile", "flow|" + k + "|" + b.b + "|" + b.d);
    });
    if (s.gg && base.gg && s.gg !== base.gg) log("data", "<b>Updated</b> — Brazil &amp; World fundamentals (CONAB · USDA · Comex)", "corn:fund@[data-src=\"ext\"]", "gg|" + s.gg);
    Object.keys(s.wa).forEach(function (k) {
      if (base.wa[k] == null || s.wa[k] === base.wa[k] || !s.wa[k]) return;
      var W = WORLD._data(), i = (W.instruments || []).filter(function (x) { return (x.id || x.name) === k; })[0];
      log("world", "<b>" + esc(i ? i.name : k) + "</b> sets a new 52-week " + (s.wa[k].indexOf("H") >= 0 ? "high" : "low"), "world", "w52|" + k + "|" + s.wa[k] + "|" + dayIso(Date.now()));
    });
    base = s;
  }
  /* scheduled events reaching their time while the page is open */
  var dueSeen = {};
  function dueTick(now) {
    if (!ready()) return;
    todayEvents(now).forEach(function (e) {
      if (e.kind === "desk" || dueSeen[e.id]) return;
      if (e.t <= now && now - e.t < 2 * MIN) { dueSeen[e.id] = 1;
        log("due", "<b>Due now</b> — " + esc(e.label) + (e.fc ? " · fc " + esc(e.fc) : "") + (e.prev ? " · prev " + esc(e.prev) : ""), e.go, "due|" + e.id, e.t); }
      else if (e.t <= now) dueSeen[e.id] = 1;
    });
  }
  /* desk notifications (release arrivals, USD/CAD level crossings, world alerts) are also recorded */
  function hookToast() {
    var L = window.DESK_LIVE; if (!L || !L.toast || L.toast._ev) return;
    var orig = L.toast;
    L.toast = function (html) {
      try { if (window.__evNoLog) return orig.apply(this, arguments);
        var txt = String(html), k = /World alert/.test(txt) ? "world" : /USD\/CAD/.test(txt) && /crossed/.test(txt) ? "level" : "release";
        log(k, txt.replace(/<(?!\/?b>|br>)[^>]*>/g, ""), k === "world" ? "" : k === "level" ? "fx:overview" : "", "toast|" + txt + "|" + Math.round(Date.now() / 60000));
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    L.toast._ev = 1;
  }

  /* ---------- wiring ---------- */
  function go(spec, sel) {
    var at = (spec || "").indexOf("@"); if (at >= 0) { sel = sel || spec.slice(at + 1); spec = spec.slice(0, at); }   /* "tab:section@card" */
    var a = (spec || "").split(":"), b = document.getElementById("tabbtn-" + a[0]); if (!b) return;
    b.click();
    if (sel) setTimeout(function () { decorate();
      var el = [].filter.call(document.querySelectorAll("#panel-" + a[0] + " " + sel), function (x) { return x.offsetParent !== null; })[0];   /* the visible copy */
      if (el) { var c = el.closest(".mk-click, .mcard, .tile, .dash-card") || el;
        var y = c.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3; window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
        c.classList.remove("flash-find"); void c.offsetWidth; c.classList.add("flash-find"); } }, 320);
    if (a[0] === "policy") { if (a[1] && window.POLICY && POLICY.open) POLICY.open(a[1]); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (a[1] && window.setSub) setTimeout(function () { window.setSub(a[0], a[1]); if (!sel) window.scrollTo({ top: 0, behavior: "smooth" }); }, 30);
  }
  document.addEventListener("keydown", function (ev) { if (ev.key !== "Enter") return; var g = ev.target && ev.target.closest && ev.target.closest(".evfi-go"); if (g) { ev.preventDefault(); go(g.getAttribute("data-evgo")); } });
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var g = t.closest("[data-evgo]"); if (g) { ev.preventDefault(); go(g.getAttribute("data-evgo"), g.getAttribute("data-evsel")); return; }
    if (!t.closest("#panel-events")) { if (t.closest("#tabbtn-events")) { unseen = 0; render(); paintBadge(); } return; }
    var b = t.closest("[data-evgrp]"); if (b) { V.grp = b.getAttribute("data-evgrp"); saveV(); repaintMain(); return; }
    if (t.closest("[data-evhigh]")) { V.high = !V.high; saveV(); repaintMain(); return; }
    b = t.closest("[data-evfeed]"); if (b) { FV = b.getAttribute("data-evfeed"); paintFeed(); return; }
    if (t.closest("[data-evclear]")) { ev.preventDefault(); feed = []; store.set(FEED_KEY, feed); paintFeed(); }
  });
  var tick = 0;
  setInterval(function () {
    if (!ready()) return;
    hookToast();
    var now = Date.now(); tick++;
    if (dayIso(now) !== lastDay && lastDay) { log("day", "<b>New day</b> — " + esc(dayLabel(now)), "", "day|" + dayIso(now)); if (active()) render(); }
    dueTick(now);
    if (tick % 3 === 0) { diff(); decorate(); }
    if (tick % 6 === 0) { paintBadge(); if (active()) repaintMain(); }
  }, 5000);
  /* every redraw of a desk rebuilds its cards — put the NEW-today marks back straight after */
  (function () { var ra = window.renderAll; if (ra && !ra._ev) { window.renderAll = function () { var r = ra.apply(this, arguments); try { decorate(); } catch (e) {} return r; }; window.renderAll._ev = 1; } })();
  document.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest(".tab-btn, [data-sub], [data-sec-v]")) setTimeout(function () { try { decorate(); } catch (e) {} }, 60); });
  window.addEventListener("desk:unlock", function () { base = null; setTimeout(function () { diff(); render(); paintBadge(); }, 800); });
  window.EVENTS = { today: function () { return todayEvents(Date.now()); }, landed: landed, decorate: decorate, render: render, log: log, _feed: function () { return feed; }, _diff: diff, _snap: snap, _base: function () { return base; } };
  if (ready()) { lastDay = dayIso(Date.now()); render(); paintBadge(); diff(); hookToast(); }
})();
