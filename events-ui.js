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
    desk:   { l: "DESK DATA",c: "#9aa8bb" }
  };
  var GROUPS = [["all", "All"], ["agri", "Agri"], ["macro", "Macro"], ["market", "Markets"], ["desk", "Desk data"]];
  function groupOf(e) { return e.kind === "macro" || e.kind === "energy" ? "macro" : e.kind === "market" ? "market" : e.kind === "desk" ? "desk" : "agri"; }
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
  function deskName(go) { var a = (go || "").split(":"); return ({ corn: "Corn", wheat: "Wheat", soybeans: "Soybeans", fx: "USD/CAD" })[a[0]] + " · " + ({ overview: "Overview", deriv: "Derivatives", fund: "Fundamentals", inputs: "Input costs", macro: "Macro" })[a[1]]; }
  function row(e, now) {
    var d = e.t - now, st = d > 15 * MIN ? "up" : d > 0 ? "soon" : d > -10 * MIN ? "due" : "out";
    var right = st === "out" ? '<span class="evs out">Out · ' + hm(e.t) + "</span>"
      : st === "due" ? '<span class="evs due">Due now</span>'
      : '<span class="countdown" data-t="' + e.t + '" data-fmt="hms">' + hms(d) + "</span>";
    var meta = [e.impact ? '<span class="evi i-' + esc(e.impact).toLowerCase() + '">' + esc(e.impact) + "</span>" : "",
      e.fc ? "fc <b>" + esc(e.fc) + "</b>" : "", e.prev ? "prev <b>" + esc(e.prev) + "</b>" : ""].filter(Boolean).join(" · ");
    return '<div class="evr ' + st + (e.high ? " hi" : "") + '"><div class="evt">' + hm(e.t) + '<small>ET</small></div>' +
      '<div class="evm"><div class="evl">' + flagOf(e) + esc(e.label) + " " + chip(e) + "</div>" + (meta ? '<div class="evx">' + meta + "</div>" : "") + "</div>" +
      '<div class="evr-r">' + right + (e.go ? '<button class="evgo" data-evgo="' + e.go + '" title="Open ' + esc(deskName(e.go)) + '">' + esc(deskName(e.go)) + " →</button>" : "") + "</div></div>";
  }
  var lastDay = "";
  function mainHTML(now) {
    var all = todayEvents(now), list = all.filter(pass), up = list.filter(function (e) { return e.t > now - 10 * MIN; }), done = list.filter(function (e) { return e.t <= now - 10 * MIN; });
    var nxt = up.filter(function (e) { return e.t > now; })[0];
    var cnt = {}; all.forEach(function (e) { var g = groupOf(e); cnt[g] = (cnt[g] || 0) + 1; });
    var head = '<div class="tile wide ev-head"><div class="evh-l"><h2>Today’s events <span class="h2note">— everything scheduled to land on the desk today, in one place</span></h2>' +
      '<div class="evh-d">' + esc(dayLabel(now)) + ' · Toronto time</div>' +
      '<div class="evf">' + GROUPS.map(function (g) { var n = g[0] === "all" ? all.length : cnt[g[0]] || 0;
        return '<button data-evgrp="' + g[0] + '" aria-pressed="' + (V.grp === g[0]) + '">' + g[1] + " <small>" + n + "</small></button>"; }).join("") +
      '<button class="evhi" data-evhigh aria-pressed="' + !!V.high + '">High impact only</button></div></div>' +
      '<div class="evh-r">' + (nxt ? '<div class="evn-l">Next up · ' + hm(nxt.t) + ' ET</div><div class="evn-t">' + flagOf(nxt) + esc(nxt.label) + '</div><div class="hero-cd countdown" data-t="' + nxt.t + '" data-fmt="hms">' + hms(nxt.t - now) + "</div>"
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
    return head + body + '<div class="tile wide"><div class="stamp">Sources combined here: USDA weekly reports and WASDE, CFTC, CBOT contract dates and sessions, Canada (AAFC / StatCan), the US + Canada macro calendar, official release calendars, EIA energy reports and the desk’s own data runs. The list resets at midnight Toronto time. Holiday closures follow the source calendars; CBOT session times assume a normal trading day.</div></div>';
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
  var MK = { data: ["◆", "#38b6c9"], release: ["✓", "#3fb97f"], due: ["⏱", "#e8b93d"], world: ["🌐", "#ff8a84"], oi: ["⚡", "#c9a3ff"], level: ["↕", "#6ea8ff"], day: ["☀", "#9aa8bb"] };
  var FV = "all";
  function feedHTML() {
    var now = Date.now(), list = feed.filter(function (m) { return FV === "all" || m.k === FV || (FV === "release" && m.k === "data"); });
    var head = '<div class="rail-card ev-feed"><div class="mon-head"><div class="rail-title"><span>Milestones</span><span class="hint">live · ' + feed.length + "</span></div>" +
      '<div class="mon-tabs evft">' + [["all", "All"], ["release", "Data"], ["oi", "Options"], ["world", "World"], ["level", "Levels"]].map(function (t) {
        return '<button data-evfeed="' + t[0] + '" aria-selected="' + (FV === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div></div>";
    var day = "", body = list.length ? list.map(function (m) {
      var d = dayIso(m.t), sep = d !== day ? '<div class="evfd">' + (d === dayIso(now) ? "Today" : esc(shortDay(m.t))) + "</div>" : ""; day = d;
      var k = MK[m.k] || MK.data;
      return sep + '<div class="evfi" style="--mc:' + k[1] + '"><span class="evfk">' + k[0] + '</span><div><div class="evfh">' + m.h + '</div><div class="evfs">' + hm(m.t) + " ET" +
        (m.go ? ' · <a href="#" data-evgo="' + esc(m.go) + '">' + esc(deskName(m.go)) + " →</a>" : "") + "</div></div></div>"; }).join("")
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
  var base = null;
  function snap() {
    var s = { asof: Object.assign({}, DATA.meta.asof || {}), macro: {}, walls: {}, oi: {}, px: {}, gg: null, wa: {} };
    (window.macroAll ? macroAll() : []).forEach(function (m) { s.macro[m.key] = m.period + "|" + m.value; });
    ["corn", "wheat", "soybeans"].forEach(function (k) { var g = DATA.grains && DATA.grains[k]; if (!g || !g.near) return;
      s.walls[k] = [g.near.call_wall && g.near.call_wall[0], g.near.put_wall && g.near.put_wall[0]];
      s.oi[k] = g.near.oi_label || ""; s.px[k] = g.fan && +g.fan.intraday[0]; });
    try { var G = window.GG && GG._data && GG._data(); s.gg = G && (G.updated_at || G.generated_at) || null; } catch (e) {}
    try { var W = window.WORLD && WORLD._data(); (W && W.instruments || []).forEach(function (i) { if (i.w52) s.wa[i.id || i.name] = (i.w52.new_high ? "H" : "") + (i.w52.new_low ? "L" : ""); }); } catch (e) {}
    return s;
  }
  var GN = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function sk(v) { return "$" + (+v).toFixed(2); }
  function diff() {
    if (!ready() || window.DESK_LOCKED) return;
    var s = snap(); if (!base) { base = s; return; }
    Object.keys(ASOF).forEach(function (k) {
      if (s.asof[k] && s.asof[k] !== base.asof[k] && base.asof[k]) log("data", "<b>Updated</b> — " + esc(ASOF[k][0]), ASOF[k][1], "asof|" + k + "|" + s.asof[k]);
    });
    (window.macroAll ? macroAll() : []).forEach(function (m) {
      if (base.macro[m.key] && s.macro[m.key] !== base.macro[m.key]) {
        var u = m.unit === "K" ? "K" : m.unit || "";
        log("release", "<b>" + (m.group === "ca" ? "Canada" : "US") + " " + esc(m.name) + "</b> " + esc(m.period) + ": <b>" + esc(m.value) + esc(u) + "</b>" + (m.prior != null ? " (prior " + esc(m.prior) + esc(u) + ")" : ""), "fx:macro", "mac|" + m.key + "|" + s.macro[m.key]);
      }
    });
    Object.keys(s.walls).forEach(function (k) {
      var a = base.walls[k], b = s.walls[k], go = k + ":deriv"; if (!a) return;
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
    if (s.gg && base.gg && s.gg !== base.gg) log("data", "<b>Updated</b> — Brazil &amp; World fundamentals (CONAB · USDA · Comex)", "corn:fund", "gg|" + s.gg);
    Object.keys(s.wa).forEach(function (k) {
      if (base.wa[k] == null || s.wa[k] === base.wa[k] || !s.wa[k]) return;
      var W = WORLD._data(), i = (W.instruments || []).filter(function (x) { return (x.id || x.name) === k; })[0];
      log("world", "<b>" + esc(i ? i.name : k) + "</b> sets a new 52-week " + (s.wa[k].indexOf("H") >= 0 ? "high" : "low"), "", "w52|" + k + "|" + s.wa[k] + "|" + dayIso(Date.now()));
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
      try {
        var txt = String(html), k = /World alert/.test(txt) ? "world" : /USD\/CAD/.test(txt) && /crossed/.test(txt) ? "level" : "release";
        log(k, txt.replace(/<(?!\/?b>|br>)[^>]*>/g, ""), k === "world" ? "" : k === "level" ? "fx:overview" : "", "toast|" + txt + "|" + Math.round(Date.now() / 60000));
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    L.toast._ev = 1;
  }

  /* ---------- wiring ---------- */
  function go(spec) {
    var a = (spec || "").split(":"), b = document.getElementById("tabbtn-" + a[0]); if (!b) return;
    b.click();
    if (a[1] && window.setSub) setTimeout(function () { window.setSub(a[0], a[1]); window.scrollTo({ top: 0, behavior: "smooth" }); }, 30);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var g = t.closest("[data-evgo]"); if (g) { ev.preventDefault(); go(g.getAttribute("data-evgo")); return; }
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
    if (tick % 3 === 0) diff();
    if (tick % 6 === 0) { paintBadge(); if (active()) repaintMain(); }
  }, 5000);
  window.addEventListener("desk:unlock", function () { base = null; setTimeout(function () { diff(); render(); paintBadge(); }, 800); });
  window.EVENTS = { today: function () { return todayEvents(Date.now()); }, render: render, log: log, _feed: function () { return feed; } };
  if (ready()) { lastDay = dayIso(Date.now()); render(); paintBadge(); diff(); hookToast(); }
})();
