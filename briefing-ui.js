/* briefing-ui.js — "Briefing" tab: North America news briefing.
   Three desks: United States, Canada (with one line per province) and Both economies (cross-border: trade, tariffs,
   CUSMA, energy, the two central banks). Each desk: top developments (clustered, ranked by how widely carried and
   how recent), sections (central bank & rates, politics & government, economy & data, trade & tariffs, energy &
   agriculture), a markets pulse from the desk's own live data and a catalyst calendar for that economy.
   Data: briefing.json on the `briefing` branch (scripts/briefing.py, every 30 min). Headlines link to the outlet; the
   'desk read' line is rule-based from the headline wording and is labelled that way. */
(function () {
  "use strict";
  var P = document.getElementById("panel-briefing"), BTN = document.getElementById("tabbtn-briefing");
  if (!P || !BTN) return;
  var REPO = (window.LIVE_CONFIG && window.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/briefing.json?ref=briefing";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/briefing/briefing.json";
  var CACHE = "desk.briefing.cache", VIEW = "desk.briefing.view";
  var J = null, etag = "", tier = 0, err = "", busy = false;
  var store = { get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
                set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  var V = Object.assign({ desk: "ca" }, store.get(VIEW) || {});
  function esc(s) { return DeskCore.esc(s); }
  function ago(iso) { var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !isFinite(m) ? "" : m < 1 ? "now" : m < 60 ? m + "m ago" : m < 2880 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; }
  function et(ms, day) { return new Date(ms).toLocaleString("en-US", Object.assign({ timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }, day ? { weekday: "short", month: "short", day: "numeric" } : {})); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  var DESKS = [["us", "🇺🇸", "United States"], ["ca", "🇨🇦", "Canada"], ["both", "↔", "Both economies"]];
  var SEC = [["policy", "Central bank & rates"], ["politics", "Politics & government"], ["economy", "Economy & data"], ["trade", "Trade & tariffs"], ["energy_ag", "Energy & agriculture"]];
  /* Overview = a broadsheet (owner, Nov 23 2026): 3-bullet desk synthesis, a 3-item Next-up strip, 2-headline snapshots.
     Full wire + central bank & rates + politics -> Policy › North America wire; Parliament / Congress -> their own Policy
     submenus; the full catalyst calendar -> Events; Trade & tariffs -> Macro › Trade & fiscal; Energy & agriculture -> Grains › Fundamentals. */
  var POLSEC = { policy: 1, politics: 1 }, SEEN = {}, NEW = {}, polU = "";
  var PP = document.getElementById("panel-policy"), PBTN = document.getElementById("tabbtn-policy");
  function desk() { return J && (J.desks[V.desk] || J.desks.ca); }
  function byTime(L) { return (L || []).slice().sort(function (a, b) { return Date.parse(b.ts) - Date.parse(a.ts); }); }
  function secList(k, n, title, note) {
    var d = desk(), L = d && d.sections && byTime(d.sections[k]); if (!L || !L.length) return "";
    return '<div class="tile br-sec"><h3 class="br-s">' + title + (note ? ' <span class="h2note">' + note + "</span>" : "") + '</h3><ul class="br-list">' + L.slice(0, n).map(function (c) { return story(c, 0, false); }).join("") + "</ul></div>";
  }
  function policyHTML(sub) {
    if (!J) return "";
    var d = desk(), sw = '<div class="br-sw br-sw-s" role="tablist">' + DESKS.map(function (x) { return '<button role="tab" data-brdesk="' + x[0] + '" aria-selected="' + (V.desk === x[0]) + '"><span>' + x[1] + "</span> " + x[2] + "</button>"; }).join("") + "</div>";
    if (sub === "parliament" || sub === "congress") {
      var L = J.legislation, ok = sub === "parliament" ? L && L.ca : L && L.us;
      return '<div class="tile wide">' + (ok ? legPart(sub === "parliament" ? "ca" : "us", "all", 20) : '<p class="note">No ' + (sub === "parliament" ? "parliamentary" : "congressional") + " data in the latest briefing.</p>") +
        '<div class="stamp">Official ' + (sub === "parliament" ? "House of Commons / LEGISinfo" : "Congress.gov / House floor") + " data · briefing updated " + et(Date.parse(J.updated_at)) + " ET</div></div>";
    }
    var TL = byTime(d.top);
    var top = '<div class="tile wide"><h3 class="br-s">Top developments — full wire · ' + esc(d.name) + ' <span class="h2note">latest first · ET · new stories roll in at the top</span></h3>' + sw +
      (TL.length ? '<ol class="br-list">' + TL.map(function (c, i) { return story(c, i, true); }).join("") + "</ol>" : '<p class="note">No stories in the last ' + (J.window_h || 48) + " h.</p>") + "</div>";
    return top + '<div class="br-grid">' + secList("policy", 8, "Central bank &amp; rates") + secList("politics", 8, "Politics &amp; government") + "</div>";
  }
  /* full catalyst calendar (Events), Trade & tariffs (Macro), Energy & agriculture (Grains) — kept in place across redraws */
  var SPOTS = [
    { id: "br-cal-ev", host: function () { return document.querySelector("#panel-events.active #evRail") || document.querySelector("#panel-events.active .ev-lay"); }, first: true,
      html: function () { return calendar("both", 20, true); } },
    { id: "br-trade-mx", host: function () { return document.querySelector("#panel-macro.active .mn2-main") || document.querySelector('#panel-macro.active [data-subpanel="trade"]'); },
      html: function () { return secList("trade", 10, "Trade &amp; tariffs — wire", "North America briefing · latest first · ET"); } },
    { id: "br-ea-gr", host: function () { return document.querySelector('.tab-panel.active:is(#panel-corn,#panel-wheat,#panel-soybeans) [data-subpanel="fund"]'); },
      html: function () { return secList("energy_ag", 10, "Energy &amp; agriculture — wire", "North America briefing · latest first · ET"); } }
  ];
  function spots() {
    if (!J) return;
    SPOTS.forEach(function (S) {
      var H = S.host(), el = document.getElementById(S.id); if (!H) return;
      var h = S.html(); if (!h) { if (el) el.remove(); return; }
      if (!el || el.parentNode !== H) { if (el) el.remove(); el = document.createElement("div"); el.id = S.id; el.className = "br-spot"; if (S.first) H.insertBefore(el, H.firstChild); else H.appendChild(el); }
      if (el._h !== h) { el.innerHTML = h; el._h = h; }
      if (el.getAttribute("data-sec") !== "*") el.setAttribute("data-sec", "*");   /* always shown — not one of the page's section tabs */
      if (el.classList.contains("st-off") || el.classList.contains("sec-off")) el.classList.remove("st-off", "sec-off");
    });
  }
  var spotQ = 0;
  new MutationObserver(function () { if (spotQ) return; spotQ = 1; setTimeout(function () { spotQ = 0; spots(); }, 400); })
    .observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  var TAGN = { rates: ["Rates", "#6ea8ff"], cad: ["CAD", "#e8a33d"], grains: ["Grains", "#3fb97f"], energy: ["Energy", "#f0a35e"], trade: ["Trade", "#c9a3ff"] };

  /* ---------- data ---------- */
  function load(force) {
    if (busy || window.DESK_LOCKED) return;
    busy = true;
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag && !force) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) return null; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; tier = 1; return r.json(); })
      .catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; tier = 2; return r.json(); }); })
      .then(function (j) { if (j && j.desks) { J = j; err = ""; store.set(CACHE, j); } })
      .catch(function () { if (!J) { J = store.get(CACHE); tier = J ? 3 : 0; } err = "The briefing could not be refreshed — " + (J ? "showing the last copy kept in this browser" : "retrying"); })
      .then(function () { busy = false; render(); });
  }

  /* ---------- pieces ---------- */
  function tagHTML(t) { return (t || []).map(function (k) { var n = TAGN[k]; return n ? '<span class="br-tag" style="--tc:' + n[1] + '">' + n[0] + "</span>" : ""; }).join(""); }
  function story(c, i, big) {
    return '<li class="br-st' + (big ? " big" : "") + (big && NEW[c.url] ? " br-new" : "") + '">' + (big ? '<span class="br-n">' + (i + 1) + "</span>" : "") + '<div class="br-sb">' +
      '<a class="br-h" href="' + (window.safeUrl ? safeUrl(c.url) : "#") + '" target="_blank" rel="noopener noreferrer">' + esc(c.title) + "</a>" +
      '<div class="br-m">Wire' + (c.n > 1 ? ' <span class="br-cnt">+' + (c.n - 1) + " more report" + (c.n > 2 ? "s" : "") + "</span>" : "") +
      " · " + (big ? '<time class="br-ts">' + et(Date.parse(c.ts), true) + " ET</time> · " : "") + ago(c.ts) + (c.section && big ? " · " + esc((SEC.filter(function (s) { return s[0] === c.section; })[0] || [0, ""])[1]) : "") + " " + tagHTML(c.tags) + (c.note ? ' · <i>' + esc(c.note) + "</i>" : "") + "</div>" +
      (big && c.why ? '<div class="br-why"><b>Desk read</b> ' + esc(c.why) + "</div>" : "") + "</div></li>";
  }
  function calRows(desk) {
    var D = window.DATA, now = Date.now(), end = now + 7 * 864e5, rows = [], ccy = desk === "us" ? ["USD"] : desk === "ca" ? ["CAD"] : ["USD", "CAD"];
    ((D && D.fx && D.fx.events) || []).forEach(function (e) {
      var t = typeof window.evEpoch === "function" ? window.evEpoch(e) : NaN;
      if (!(t >= now && t <= end) || ccy.indexOf(e.ccy) < 0 || !/high|medium/i.test(e.impact || "")) return;
      rows.push({ t: t, cc: e.ccy, w: e.event, sub: (e.fc ? "fc " + e.fc : "") + (e.prev ? (e.fc ? " · " : "") + "prev " + e.prev : ""), hi: /high/i.test(e.impact) });
    });
    var PJ = window.POLICY && window.POLICY._data && window.POLICY._data();
    ((PJ && PJ.calendar) || []).forEach(function (c) {
      var b = c.bank; if (!((desk !== "ca" && b === "fed") || (desk !== "us" && b === "boc"))) return;
      var dm = c.date.split("-"), tm = (c.time || "12:00").split(":");
      var t = typeof window.zonedMs === "function" ? window.zonedMs(+dm[0], +dm[1], +dm[2], +tm[0], +tm[1], c.tz || "America/Toronto") : Date.parse(c.date + "T" + (c.time || "12:00") + ":00-05:00");
      if (t >= now && t <= now + 45 * 864e5) rows.push({ t: t, cc: b === "fed" ? "USD" : "CAD", w: (b === "fed" ? "Federal Reserve — " : "Bank of Canada — ") + c.what, sub: "central bank", hi: c.kind === "decision" });
    });
    var LG = J && J.legislation;
    if (LG && desk !== "us" && LG.ca && LG.ca.calendar) (LG.ca.calendar.breaks || []).slice(0, 2).forEach(function (b) {
      var p = b.returns.split("-"), t = Date.UTC(+p[0], +p[1] - 1, +p[2], 15); if (t >= now && t <= now + 45 * 864e5) rows.push({ t: t, cc: "CAD", w: "House of Commons returns", sub: "after the break from " + b.from.slice(5), hi: false }); });
    if (LG && desk !== "ca" && LG.us) (LG.us.hearings || []).forEach(function (h) { var t = Date.parse(h.date); if (t >= now && t <= end && (h.topics || []).length) rows.push({ t: t, cc: "USD", w: h.title.slice(0, 90), sub: h.chamber + " hearing", hi: false }); });
    rows.sort(function (a, b) { return a.t - b.t; });
    var seen = {}; return rows.filter(function (r) { var k = r.w + Math.round(r.t / 6e5); if (seen[k]) return false; seen[k] = 1; return true; });
  }
  function calendar(desk, n, full) {
    var rows = calRows(desk).slice(0, n || 12);
    return '<div class="rail-card br-card"><div class="rail-title"><span>Catalyst calendar' + (full ? " — US &amp; Canada" : "") + '</span><span class="hint">next 7 days · central banks, Parliament 45 days · ET</span></div>' +
      (rows.length ? '<ul class="br-cal">' + rows.map(function (r) {
        return '<li class="' + (r.hi ? "hi" : "") + '"><span class="br-ct">' + et(r.t, true) + '</span><span class="br-cw"><span class="br-cc">' + r.cc + "</span> " + esc(r.w) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</span></li>"; }).join("") + "</ul>"
        : '<p class="note">Nothing high- or medium-impact scheduled in the next 7 days on the calendar loaded so far (the weekly calendar refreshes Sunday).</p>') +
      (full ? "" : '<p class="br-go"><a href="#" data-evgo="events:">Full calendar in Events →</a></p>') + "</div>";
  }

  /* ---------- legislation ---------- */
  function dd(iso, wd) { var p = iso.slice(0, 10).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC", month: "short", day: "numeric" }, wd ? { weekday: "short" } : {})); }
  function tpc(t) { return (t || []).map(function (x) { return '<span class="br-tp">' + esc(x) + "</span>"; }).join(""); }
  function billRow(b, us) {
    return '<li class="br-bl"><span class="br-bc">' + esc(b.code) + '</span><div><span class="br-bt">' + esc(b.title) + "</span>" +
      '<div class="br-bs">' + (us ? esc(b.action) + " · " + dd(b.date) : esc(b.stage || b.status) + (b.last ? " · " + dd(b.last) : "") + (b.gov ? ' · <b>Government bill</b>' : "") + (b.assent ? ' · <b class="up">Royal assent</b>' : "")) +
      (b.law ? ' · <b class="up">Law</b>' : "") + " " + tpc(b.topics) + "</div></div></li>";
  }
  function legPart(which, desk, nmax) {
    var L = J && J.legislation; if (!L) return "";
    var parts = [], filt = function (b) { return desk !== "both" || b.topics.some(function (t) { return /Trade|Agric|Energy|Border/.test(t); }); };
    if (which === "ca" && L.ca) {
      var C = L.ca.calendar, cb = (L.ca.bills || []).filter(filt).slice(0, nmax || 10), cal = "";
      if (C) {
        var nx = C.next && C.next[0], wb = (C.breaks || []).filter(function (b) { return /-12-|-01-/.test(b.from); })[0], br = (C.breaks || [])[0];
        cal = '<div class="br-sit"><span>' + (C.sitting_today ? '<b class="up">House of Commons sits today</b>' : nx ? "Commons next sits <b>" + dd(nx, true) + "</b>" : "No sitting days published") + "</span>" +
          (br ? "<span>Next break " + dd(br.from) + "–" + dd(br.to) + " · back " + dd(br.returns, true) + "</span>" : "") +
          (wb && wb !== br ? "<span>Winter break from " + dd(wb.from) + " · returns <b>" + dd(wb.returns, true) + "</b></span>" : !wb && C.last && /-12-/.test(C.last) ? "<span>Rises for the holidays after <b>" + dd(C.last, true) + "</b> (2027 sitting dates not yet published)</span>" : "") + "</div>";
      }
      parts.push('<div class="br-lg"><h4>🇨🇦 Parliament of Canada' + (L.ca.session ? " · session " + esc(L.ca.session) : "") + "</h4>" + cal +
        (cb.length ? '<ul class="br-list">' + cb.map(function (b) { return billRow(b, false); }).join("") + "</ul>" : '<p class="note">No bills ' + (desk === "both" ? "on trade, agriculture, energy or the border " : "") + "moved in the last 14 days.</p>") + "</div>");
    }
    if (which === "us" && L.us) {
      var U = L.us, fl = U.floor, ub = (U.bills || []).filter(filt).slice(0, nmax || 10), hr = (U.hearings || []).filter(function (h) { return desk !== "both" || h.topics.length; }).slice(0, 6);
      var flH = fl && !fl.stale && fl.items.length ? '<div class="br-fl"><b>House floor ' + (fl.week ? "this week" : dd(fl.date, true)) + ":</b> " + fl.items.slice(0, 8).map(function (i) { return esc(i.code) + " " + esc(i.title); }).join(" · ") + "</div>"
        : '<div class="br-sit"><span>House floor: ' + (fl && fl.stale ? "no schedule since " + dd(fl.date) + " — the House is not sitting" : "no floor schedule published for this week") + "</span></div>";
      parts.push('<div class="br-lg"><h4>🇺🇸 U.S. Congress</h4>' + flH +
        (hr.length ? '<div class="br-hh">Upcoming committee hearings</div><ul class="br-list">' + hr.map(function (h) { return '<li class="br-bl"><span class="br-bc">' + dd(h.date, true) + '</span><div><span class="br-bt">' + esc(h.title) + '</span><div class="br-bs">' + esc(h.chamber) + (h.committee ? " · " + esc(h.committee) : "") + " " + tpc(h.topics) + "</div></div></li>"; }).join("") + "</ul>" : "") +
        '<div class="br-hh">Bills with action in the last 10 days</div>' + (ub.length ? '<ul class="br-list">' + ub.map(function (b) { return billRow(b, true); }).join("") + "</ul>" : '<p class="note">' + (U.errors && U.errors.congress ? "Congress.gov key not set." : "No significant bill actions in the last 10 days.") + "</p>") + "</div>");
    }
    return parts.join("");
  }

  /* ---------- render ---------- */
  function render() {
    if (!J) { var r0 = P.querySelector(":scope > #br-root"); if (!r0) { r0 = document.createElement("div"); r0.id = "br-root"; P.appendChild(r0); } r0.innerHTML = '<div class="tile wide"><h2>North America briefing</h2><p class="note">' + (err || "Loading the briefing…") + "</p></div>"; r0._h = ""; return; }
    var d = J.desks[V.desk] || J.desks.ca, sec = d.sections || {};
    var head = '<div class="tile wide br-head"><div class="br-ht"><div><div class="br-kick">North America briefing</div><h2 class="br-title">' +
      new Date().toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric", year: "numeric" }) + '</h2>' +
      '<div class="br-upd">Updated ' + et(Date.parse(J.updated_at)) + " ET · " + ago(J.updated_at) + " · last " + (J.window_h || 48) + " h of reporting, refreshed every 30 min" +
      (tier === 3 ? ' · <b class="dn">cached copy — network failed</b>' : "") + (err && tier !== 3 ? ' · <b class="dn">' + esc(err) + "</b>" : "") + "</div></div>" +
      '<div class="br-sw" role="tablist">' + DESKS.map(function (x) { return '<button role="tab" data-brdesk="' + x[0] + '" aria-selected="' + (V.desk === x[0]) + '"><span>' + x[1] + "</span> " + x[2] + "</button>"; }).join("") + "</div></div></div>";
    var TL = byTime(d.top), key = V.desk;
    NEW = {}; if (SEEN[key]) TL.forEach(function (c) { if (!SEEN[key][c.url]) NEW[c.url] = 1; });
    SEEN[key] = {}; TL.forEach(function (c) { SEEN[key][c.url] = 1; });
    /* desk synthesis: the three most significant stories (the briefing's own ranking — breadth of coverage and recency), each with its desk read */
    var S3 = (d.top || []).slice(0, 3);
    var syn = '<div class="tile wide br-syn"><h3 class="br-s">Top developments — desk synthesis · ' + esc(d.name) + ' <span class="h2note">the 3 most significant stories · full wire in <a href="#" data-brgo="policy:wire">Policy › North America wire →</a></span></h3>' +
      (S3.length ? '<ul class="br-syl">' + S3.map(function (c) { return '<li' + (NEW[c.url] ? ' class="br-new"' : "") + '><a class="br-h" href="' + (window.safeUrl ? safeUrl(c.url) : "#") + '" target="_blank" rel="noopener noreferrer">' + esc(c.title) + "</a>" +
        '<span class="br-m"><time class="br-ts">' + et(Date.parse(c.ts), true) + " ET</time>" + (c.n > 1 ? ' · <span class="br-cnt">' + c.n + " reports</span>" : "") + " " + tagHTML(c.tags) + "</span>" + (c.why ? '<span class="br-why"><b>Desk read</b> ' + esc(c.why) + "</span>" : "") + "</li>"; }).join("") + "</ul>"
        : '<p class="note">No stories in the last ' + (J.window_h || 48) + " h.</p>") + "</div>";
    var nx = calRows(V.desk).slice(0, 3);
    var next = '<div class="tile wide br-next"><span class="br-nxh">Next up</span>' + (nx.length ? nx.map(function (r) { return '<span class="br-nxi' + (r.hi ? " hi" : "") + '"><time>' + et(r.t, true) + ' ET</time><span class="br-cc">' + r.cc + "</span> " + esc(r.w) + "</span>"; }).join("")
      : '<span class="note">Nothing high- or medium-impact in the next 7 days on the loaded calendar.</span>') + '<a href="#" data-evgo="events:" class="br-nxa">Full calendar in Events →</a></div>';
    function snap(k, title, go, where) { var L = byTime(sec[k]).slice(0, 2); if (!L.length) return "";
      return '<div class="tile br-sec br-snap"><h3 class="br-s">' + title + ' <span class="h2note"><a href="#" data-brgo="' + go + '">full column in ' + where + ' →</a></span></h3><ul class="br-list">' + L.map(function (c) { return story(c, 0, false); }).join("") + "</ul></div>"; }
    var grid = '<div class="br-grid">' + snap("trade", "Trade &amp; tariffs", "macro:", "Macro") + snap("energy_ag", "Energy &amp; agriculture", "grains:fund", "Grains › Fundamentals") + snap("economy", "Economy &amp; data", "policy:wire", "Policy") + "</div>";
    var prov = d.provinces ? '<div class="tile wide"><h3 class="br-s">Provinces — one line each</h3><div class="br-prov">' + Object.keys(d.provinces).map(function (k) {
      var p = d.provinces[k], c = p.items && p.items[0];
      return '<div class="br-pr"><b>' + esc(p.name) + "</b>" + (c ? '<a href="' + (window.safeUrl ? safeUrl(c.url) : "#") + '" target="_blank" rel="noopener noreferrer">' + esc(c.title) + '</a><small>' + et(Date.parse(c.ts), true) + " ET</small>" : '<span class="note">No story in the last ' + (J.window_h || 48) + " h</span>") + "</div>"; }).join("") + "</div></div>" : "";
    var foot = '<p class="br-foot">Headlines link to the outlet’s own article. The same story from several reports counts once. “Desk read” is a rule-based note from the headline wording — context for the desk, not reporting and not a forecast. All times Eastern.</p>';
    spots();
    if (PP && PP.classList.contains("active") && window.POLICY && POLICY.render && polU !== J.updated_at + V.desk) { polU = J.updated_at + V.desk; var y = window.scrollY; POLICY.render(); window.scrollTo(0, y); }
    var html = head + syn + next + grid + prov + foot, root = P.querySelector(":scope > #br-root");
    if (!root) { root = document.createElement("div"); root.id = "br-root"; P.appendChild(root); [].forEach.call(P.children, function (c) { if (c !== root && c.id !== "sw-us") c.remove(); }); }
    if (root._h !== html) { root.innerHTML = html; root._h = html; }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-brdesk]");
    if (b && (P.contains(b) || (PP && PP.contains(b)))) { V.desk = b.getAttribute("data-brdesk"); store.set(VIEW, V); polU = ""; render(); return; }
    var g = e.target.closest && e.target.closest("[data-brgo]"); if (!g) return; e.preventDefault();
    var p = g.getAttribute("data-brgo").split(":"), page = p[0], sub = p[1];
    if (page === "policy") { try { var pv = JSON.parse(localStorage.getItem("desk.policyView") || "{}"); pv.sub = sub; localStorage.setItem("desk.policyView", JSON.stringify(pv)); } catch (x) {}
      var nb = document.querySelector('[data-gnav="policy"]'); if (nb) nb.click(); setTimeout(function () { var s2 = PP && PP.querySelector('[data-pisub="' + sub + '"]'); if (s2) s2.click(); window.scrollTo(0, 0); }, 120); return; }
    if (page === "grains") { var cur = document.querySelector(".tab-panel.active"), gk = "corn"; try { gk = localStorage.getItem("desk.grain") || "corn"; } catch (x) {}
      if (window.DESK_NAV && DESK_NAV.go) DESK_NAV.go(/^(corn|wheat|soybeans)$/.test(gk) ? gk : "corn", sub, "grains");
      var n = 0; (function toTile() { var t = document.getElementById("br-ea-gr"); if (t && t.offsetHeight) t.scrollIntoView({ block: "start", behavior: "smooth" }); else if (++n < 20) setTimeout(toTile, 150); })(); return; }
    if (window.DESK_NAV && DESK_NAV.go) DESK_NAV.go(page, sub, page);
  });
  BTN.addEventListener("click", function () { if (!J) J = store.get(CACHE); render(); load(); });
  window.addEventListener("desk:unlock", function () { load(); });
  if (PBTN) PBTN.addEventListener("click", function () { if (!J) J = store.get(CACHE); polU = ""; load(); });
  setInterval(function () { load(); }, 5 * 60000);   /* Overview, Policy, Events, Macro and Grains all carry pieces of the briefing now */
  setInterval(function () { if (J && BTN.getAttribute("aria-selected") === "true") render(); }, 60000);   /* 'x min ago' stays live */

  var css = document.createElement("style");
  css.textContent =
    ".br-head{padding:16px 18px}.br-ht{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px}.br-kick{font:600 11.5px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}" +
    ".br-title{margin:4px 0 2px;font-size:22px}.br-upd{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".br-sw{display:flex;gap:6px;flex-wrap:wrap}.br-sw button{appearance:none;font:600 13px inherit;font-family:inherit;padding:7px 14px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--muted);cursor:pointer}" +
    ".br-sw button[aria-selected=true]{background:#13304a;border-color:var(--cyan);color:#fff}" +
    ".br-s{margin:0 0 10px;font-size:14px;letter-spacing:.02em}.br-list{list-style:none;margin:0;padding:0}" +
    ".br-st{font-family:'Libre Franklin',system-ui,sans-serif;display:flex;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line)}.br-st:last-child{border-bottom:0}.br-n{flex:0 0 26px;height:26px;border-radius:50%;background:#13304a;color:#7dd8e6;font:600 13px 'IBM Plex Mono',monospace;display:grid;place-items:center}" +
    ".br-sb{min-width:0}.br-h{color:var(--ink);font-weight:600;line-height:1.4}.br-st.big .br-h{font-size:15.5px}.br-h:hover{color:#7dd8e6}" +
    ".br-m{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:3px}.br-cnt{color:#7dd8e6}" +
    ".br-tag{display:inline-block;font:600 10.5px 'IBM Plex Mono',monospace;padding:0 6px;border-radius:4px;border:1px solid var(--tc);color:var(--tc);margin-left:3px}" +
    ".br-why{margin-top:5px;font-size:13px;color:var(--muted);line-height:1.45}.br-why b{font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-right:5px}" +
    ".br-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px}.br-sec .br-h{font-size:13.5px}" +
    ".br-prov{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px 18px}.br-pr{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-bottom:1px dashed var(--line)}.br-pr b{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--cyan)}.br-pr a{color:var(--ink);font-size:13.5px}.br-pr small{font:11px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".br-kg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.br-k{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 9px}.br-kn{font:11px 'IBM Plex Mono',monospace;color:var(--faint)}.br-kv{font:600 16px 'IBM Plex Mono',monospace}.br-kc{font:11.5px 'IBM Plex Mono',monospace}" +
    ".br-cal{list-style:none;margin:8px 0 0;padding:0}.br-cal li{display:grid;grid-template-columns:96px 1fr;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px}.br-cal li.hi .br-cw{color:#fff;font-weight:600}" +
    ".br-ct{font:11.5px 'IBM Plex Mono',monospace;color:var(--amber)}.br-cw small{display:block;font:11px 'IBM Plex Mono',monospace;color:var(--faint);font-weight:400}.br-cc{font:600 10.5px 'IBM Plex Mono',monospace;color:var(--cyan)}.br-go{margin:8px 0 0;font-size:12.5px}" +
    ".br-ts{color:#7dd8e6}.br-st.br-new{animation:brIn .7s cubic-bezier(.2,.8,.2,1)}@keyframes brIn{from{opacity:0;transform:translateY(-14px);background:rgba(125,216,230,.14)}to{opacity:1;transform:none;background:transparent}}" +
    ".br-syl{list-style:none;margin:0;padding:0;counter-reset:syn}.br-syl li{counter-increment:syn;position:relative;padding:10px 0 10px 34px;border-bottom:1px dashed var(--line);display:flex;flex-direction:column;gap:3px;font-family:'Libre Franklin',system-ui,sans-serif}.br-syl li:last-child{border-bottom:0}" +
    ".br-syl li::before{content:counter(syn);position:absolute;left:0;top:11px;width:24px;height:24px;border-radius:50%;background:#13304a;color:#7dd8e6;font:600 12.5px 'IBM Plex Mono',monospace;display:grid;place-items:center}.br-syl .br-h{font-size:15.5px}.br-syl li.br-new{animation:brIn .7s cubic-bezier(.2,.8,.2,1)}" +
    ".br-next{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding:10px 16px}.br-nxh{font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#d9b46a}.br-nxi{font-size:13px;color:var(--ink);display:inline-flex;gap:6px;align-items:baseline}" +
    ".br-nxi time{font:600 11.5px 'IBM Plex Mono',monospace;color:var(--cyan)}.br-nxi.hi time{color:#e3c14d}.br-nxa{margin-left:auto;font-size:12.5px}.br-sw-s{margin:0 0 8px}.br-spot{margin:0 0 14px}.br-spot .rail-card{margin:0}" +
    "@media (prefers-reduced-motion:reduce){.br-st.br-new{animation:none}}" +
    ".br-foot{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);line-height:1.6;margin:12px 2px 0}" +
    ".br-lgw{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:18px}.br-lg h4{margin:0 0 8px;font-size:13.5px}.br-sit{display:flex;flex-wrap:wrap;gap:4px 16px;font:12px 'IBM Plex Mono',monospace;color:var(--muted);margin-bottom:8px}.br-sit b{color:var(--ink)}" +
    ".br-fl{font-size:13px;color:var(--muted);margin-bottom:8px;line-height:1.5}.br-fl b{color:var(--ink)}.br-hh{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:10px 0 2px}" +
    ".br-bl{display:grid;grid-template-columns:86px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px dashed var(--line);font-family:'Libre Franklin',system-ui,sans-serif}.br-bc{font:600 12px 'IBM Plex Mono',monospace;color:#7dd8e6}.br-bt{color:var(--ink);font-size:13.5px;font-weight:600}" +
    ".br-bs{font-size:12px;color:var(--faint);margin-top:2px}.br-bs b{font-weight:600;color:var(--muted)}.br-tp{display:inline-block;font:600 10.5px 'IBM Plex Mono',monospace;padding:0 6px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);margin-left:3px}" +
    "@media (max-width:760px){.br-lgw{grid-template-columns:1fr}.br-grid{grid-template-columns:1fr}.br-title{font-size:18px}}";
  document.head.appendChild(css);
  window.BRIEFING = { render: render, load: load, policyHTML: policyHTML, _data: function () { return J; } };
  J = store.get(CACHE); if (J) render(); if (!window.DESK_LOCKED) load();
})();
