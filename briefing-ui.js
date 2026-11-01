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
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ago(iso) { var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !isFinite(m) ? "" : m < 1 ? "now" : m < 60 ? m + "m ago" : m < 2880 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago"; }
  function et(ms, day) { return new Date(ms).toLocaleString("en-US", Object.assign({ timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }, day ? { weekday: "short", month: "short", day: "numeric" } : {})); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  var DESKS = [["us", "🇺🇸", "United States"], ["ca", "🇨🇦", "Canada"], ["both", "↔", "Both economies"]];
  var SEC = [["policy", "Central bank & rates"], ["politics", "Politics & government"], ["economy", "Economy & data"], ["trade", "Trade & tariffs"], ["energy_ag", "Energy & agriculture"]];
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
      .then(function () { busy = false; if (BTN.getAttribute("aria-selected") === "true") render(); });
  }

  /* ---------- pieces ---------- */
  function tagHTML(t) { return (t || []).map(function (k) { var n = TAGN[k]; return n ? '<span class="br-tag" style="--tc:' + n[1] + '">' + n[0] + "</span>" : ""; }).join(""); }
  function story(c, i, big) {
    return '<li class="br-st' + (big ? " big" : "") + '">' + (big ? '<span class="br-n">' + (i + 1) + "</span>" : "") + '<div class="br-sb">' +
      '<a class="br-h" href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + esc(c.title) + "</a>" +
      '<div class="br-m">' + esc(c.outlet) + (c.n > 1 ? ' <span class="br-cnt" title="' + esc((c.outlets || []).join(" · ")) + '">+' + (c.n - 1) + " outlet" + (c.n > 2 ? "s" : "") + "</span>" : "") +
      " · " + ago(c.ts) + (c.section && big ? " · " + esc((SEC.filter(function (s) { return s[0] === c.section; })[0] || [0, ""])[1]) : "") + " " + tagHTML(c.tags) + (c.note ? ' · <i>' + esc(c.note) + "</i>" : "") + "</div>" +
      (big && c.why ? '<div class="br-why"><b>Desk read</b> ' + esc(c.why) + "</div>" : "") + "</div></li>";
  }
  function pulse() {
    var D = window.DATA; if (!D || !D.fx) return "";
    var fx = D.fx, Y = fx.yields_live || {}, y10 = Y["10Y"] || {}, y2 = Y["2Y"] || {}, w = (fx.energy || [])[0] || {}, x = fx.fxcross || {}, P = fx.policy || {};
    var spot = +fx.feed.mid, ch = (spot / fx.spot.ref - 1) * 100;
    var fedM = /(\d{3})-(\d{3})/.exec(P.fed_range || ""), boc = P.boc_decided && P.boc_decided.rate != null ? P.boc_decided.rate : P.corra_now;
    function k(n, v, c, sub) { return '<div class="br-k"><div class="br-kn">' + n + '</div><div class="br-kv">' + v + '</div><div class="br-kc ' + (c || "") + '">' + (sub || "") + "</div></div>"; }
    return '<div class="rail-card br-card"><div class="rail-title"><span>Markets pulse</span><span class="hint">desk data</span></div><div class="br-kg">' +
      k("USD/CAD", nf(spot, 4), cls(ch), sg(ch, 2, "%")) +
      (y10.y != null ? k("US 10Y", nf(+y10.y, 3) + "%", cls(y10.chg_bp), sg(y10.chg_bp, 1, " bp")) : "") +
      (y10.sp_ca != null ? k("US–CA 10Y", nf(+y10.sp_ca, 1) + " bp", "", "spread") : "") +
      (y2.y != null ? k("US 2Y", nf(+y2.y, 3) + "%", cls(y2.chg_bp), sg(y2.chg_bp, 1, " bp")) : "") +
      (w.last != null ? k("WTI", "$" + nf(+w.last, 2), cls(w.pct), sg(+w.pct, 2, "%")) : "") +
      (x.dxy != null ? k("DXY", nf(+x.dxy, 2), cls(+x.dxy_chg), sg(+x.dxy_chg, 2, "%")) : "") +
      (fedM ? k("Fed funds", (+fedM[1] / 100).toFixed(2) + "–" + (+fedM[2] / 100).toFixed(2) + "%", "", "target range") : "") +
      (boc != null ? k("BoC rate", nf(+boc, 2) + "%", "", "overnight target") : "") + "</div></div>";
  }
  function calendar(desk) {
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
    var seen = {}; rows = rows.filter(function (r) { var k = r.w + Math.round(r.t / 6e5); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 12);
    return '<div class="rail-card br-card"><div class="rail-title"><span>Catalyst calendar</span><span class="hint">next 7 days · central banks 45 days</span></div>' +
      (rows.length ? '<ul class="br-cal">' + rows.map(function (r) {
        return '<li class="' + (r.hi ? "hi" : "") + '"><span class="br-ct">' + et(r.t, true) + '</span><span class="br-cw"><span class="br-cc">' + r.cc + "</span> " + esc(r.w) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</span></li>"; }).join("") + "</ul>"
        : '<p class="note">Nothing high- or medium-impact scheduled in the next 7 days on the calendar loaded so far (the weekly calendar refreshes Sunday).</p>') +
      '<p class="br-go"><a href="#" data-evgo="events:">Full calendar in Events →</a></p></div>';
  }

  /* ---------- legislation ---------- */
  function dd(iso, wd) { var p = iso.slice(0, 10).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC", month: "short", day: "numeric" }, wd ? { weekday: "short" } : {})); }
  function tpc(t) { return (t || []).map(function (x) { return '<span class="br-tp">' + esc(x) + "</span>"; }).join(""); }
  function billRow(b, us) {
    return '<li class="br-bl"><a class="br-bc" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + esc(b.code) + '</a><div><a class="br-bt" href="' + esc(b.url) + '" target="_blank" rel="noopener noreferrer">' + esc(b.title) + "</a>" +
      '<div class="br-bs">' + (us ? esc(b.action) + " · " + dd(b.date) : esc(b.stage || b.status) + (b.last ? " · " + dd(b.last) : "") + (b.gov ? ' · <b>Government bill</b>' : "") + (b.assent ? ' · <b class="up">Royal assent</b>' : "")) +
      (b.law ? ' · <b class="up">Law</b>' : "") + " " + tpc(b.topics) + "</div></div></li>";
  }
  function legHTML(desk) {
    var L = J && J.legislation; if (!L) return "";
    var parts = [], filt = function (b) { return desk !== "both" || b.topics.some(function (t) { return /Trade|Agric|Energy|Border/.test(t); }); };
    if (desk !== "us" && L.ca) {
      var C = L.ca.calendar, cb = (L.ca.bills || []).filter(filt).slice(0, desk === "both" ? 5 : 10), cal = "";
      if (C) {
        var nx = C.next && C.next[0], wb = (C.breaks || []).filter(function (b) { return /-12-|-01-/.test(b.from); })[0], br = (C.breaks || [])[0];
        cal = '<div class="br-sit"><span>' + (C.sitting_today ? '<b class="up">House of Commons sits today</b>' : nx ? "Commons next sits <b>" + dd(nx, true) + "</b>" : "No sitting days published") + "</span>" +
          (br ? "<span>Next break " + dd(br.from) + "–" + dd(br.to) + " · back " + dd(br.returns, true) + "</span>" : "") +
          (wb && wb !== br ? "<span>Winter break from " + dd(wb.from) + " · returns <b>" + dd(wb.returns, true) + "</b></span>" : "") + "</div>";
      }
      parts.push('<div class="br-lg"><h4>🇨🇦 Parliament of Canada' + (L.ca.session ? " · session " + esc(L.ca.session) : "") + "</h4>" + cal +
        (cb.length ? '<ul class="br-list">' + cb.map(function (b) { return billRow(b, false); }).join("") + "</ul>" : '<p class="note">No bills ' + (desk === "both" ? "on trade, agriculture, energy or the border " : "") + "moved in the last 14 days.</p>") + "</div>");
    }
    if (desk !== "ca" && L.us) {
      var U = L.us, fl = U.floor, ub = (U.bills || []).filter(filt).slice(0, desk === "both" ? 5 : 10), hr = (U.hearings || []).filter(function (h) { return desk !== "both" || h.topics.length; }).slice(0, 6);
      var flH = fl && !fl.stale && fl.items.length ? '<div class="br-fl"><b>House floor ' + (fl.week ? "this week" : dd(fl.date, true)) + ":</b> " + fl.items.slice(0, 8).map(function (i) { return esc(i.code) + " " + esc(i.title); }).join(" · ") + "</div>"
        : '<div class="br-sit"><span>House floor: ' + (fl && fl.stale ? "no schedule since " + dd(fl.date) + " — the House is not sitting" : "no floor schedule published for this week") + "</span></div>";
      parts.push('<div class="br-lg"><h4>🇺🇸 U.S. Congress</h4>' + flH +
        (hr.length ? '<div class="br-hh">Upcoming committee hearings</div><ul class="br-list">' + hr.map(function (h) { return '<li class="br-bl"><span class="br-bc">' + dd(h.date, true) + '</span><div><a class="br-bt" href="' + esc(h.url) + '" target="_blank" rel="noopener noreferrer">' + esc(h.title) + '</a><div class="br-bs">' + esc(h.chamber) + (h.committee ? " · " + esc(h.committee) : "") + " " + tpc(h.topics) + "</div></div></li>"; }).join("") + "</ul>" : "") +
        '<div class="br-hh">Bills with action in the last 10 days</div>' + (ub.length ? '<ul class="br-list">' + ub.map(function (b) { return billRow(b, true); }).join("") + "</ul>" : '<p class="note">' + (U.errors && U.errors.congress ? "Congress.gov key not set." : "No significant bill actions in the last 10 days.") + "</p>") + "</div>");
    }
    return parts.length ? '<div class="tile wide"><h3 class="br-s">Legislation — what is moving and when they sit <span class="h2note">official parliamentary and congressional data</span></h3><div class="br-lgw">' + parts.join("") + "</div></div>" : "";
  }

  /* ---------- render ---------- */
  function render() {
    if (!J) { P.innerHTML = '<div class="tile wide"><h2>North America briefing</h2><p class="note">' + (err || "Loading the briefing…") + "</p></div>"; return; }
    var d = J.desks[V.desk] || J.desks.ca, sec = d.sections || {};
    var head = '<div class="tile wide br-head"><div class="br-ht"><div><div class="br-kick">North America briefing</div><h2 class="br-title">' +
      new Date().toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric", year: "numeric" }) + '</h2>' +
      '<div class="br-upd">Updated ' + et(Date.parse(J.updated_at)) + " ET · " + ago(J.updated_at) + " · last " + (J.window_h || 48) + " h of reporting, refreshed every 30 min" +
      (tier === 3 ? ' · <b class="dn">cached copy — network failed</b>' : "") + (err && tier !== 3 ? ' · <b class="dn">' + esc(err) + "</b>" : "") + "</div></div>" +
      '<div class="br-sw" role="tablist">' + DESKS.map(function (x) { return '<button role="tab" data-brdesk="' + x[0] + '" aria-selected="' + (V.desk === x[0]) + '"><span>' + x[1] + "</span> " + x[2] + "</button>"; }).join("") + "</div></div></div>";
    var top = '<div class="tile wide"><h3 class="br-s">Top developments — ' + esc(d.name) + ' <span class="h2note">ranked by how widely each story is carried and how recent it is</span></h3>' +
      (d.top && d.top.length ? '<ol class="br-list">' + d.top.map(function (c, i) { return story(c, i, true); }).join("") + "</ol>" : '<p class="note">No stories in the last ' + (J.window_h || 48) + " h.</p>") + "</div>";
    var grid = '<div class="br-grid">' + SEC.filter(function (s) { return sec[s[0]] && sec[s[0]].length; }).map(function (s) {
      return '<div class="tile br-sec"><h3 class="br-s">' + s[1] + '</h3><ul class="br-list">' + sec[s[0]].slice(0, 5).map(function (c) { return story(c, 0, false); }).join("") + "</ul></div>"; }).join("") + "</div>";
    var prov = d.provinces ? '<div class="tile wide"><h3 class="br-s">Provinces — one line each</h3><div class="br-prov">' + Object.keys(d.provinces).map(function (k) {
      var p = d.provinces[k], c = p.items && p.items[0];
      return '<div class="br-pr"><b>' + esc(p.name) + "</b>" + (c ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + esc(c.title) + '</a><small>' + esc(c.outlet) + " · " + ago(c.ts) + "</small>" : '<span class="note">No story in the last ' + (J.window_h || 48) + " h</span>") + "</div>"; }).join("") + "</div></div>" : "";
    var foot = '<p class="br-foot">Headlines link to the outlet’s own article. Same story from several outlets counts once (+n outlets). Tags show what each story touches on this desk. ' +
      '“Desk read” is a rule-based note from the headline wording — context for the desk, not reporting and not a forecast.</p>';
    P.innerHTML = head + '<div class="layout br-lay"><div class="main">' + top + legHTML(V.desk) + prov + grid + foot + '</div><aside class="rail">' + pulse() + calendar(V.desk) + "</aside></div>";
  }
  P.addEventListener("click", function (e) { var b = e.target.closest("[data-brdesk]"); if (b) { V.desk = b.getAttribute("data-brdesk"); store.set(VIEW, V); render(); } });
  BTN.addEventListener("click", function () { if (!J) J = store.get(CACHE); render(); load(); });
  window.addEventListener("desk:unlock", function () { load(); });
  setInterval(function () { if (BTN.getAttribute("aria-selected") === "true") load(); }, 5 * 60000);
  setInterval(function () { if (BTN.getAttribute("aria-selected") === "true" && J) render(); }, 60000);   /* 'x min ago' and the pulse stay live */

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
    ".br-foot{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);line-height:1.6;margin:12px 2px 0}" +
    ".br-lgw{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:18px}.br-lg h4{margin:0 0 8px;font-size:13.5px}.br-sit{display:flex;flex-wrap:wrap;gap:4px 16px;font:12px 'IBM Plex Mono',monospace;color:var(--muted);margin-bottom:8px}.br-sit b{color:var(--ink)}" +
    ".br-fl{font-size:13px;color:var(--muted);margin-bottom:8px;line-height:1.5}.br-fl b{color:var(--ink)}.br-hh{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:10px 0 2px}" +
    ".br-bl{display:grid;grid-template-columns:86px minmax(0,1fr);gap:10px;padding:7px 0;border-bottom:1px dashed var(--line);font-family:'Libre Franklin',system-ui,sans-serif}.br-bc{font:600 12px 'IBM Plex Mono',monospace;color:#7dd8e6}.br-bt{color:var(--ink);font-size:13.5px;font-weight:600}" +
    ".br-bs{font-size:12px;color:var(--faint);margin-top:2px}.br-bs b{font-weight:600;color:var(--muted)}.br-tp{display:inline-block;font:600 10.5px 'IBM Plex Mono',monospace;padding:0 6px;border-radius:4px;border:1px solid var(--line2);color:var(--muted);margin-left:3px}" +
    "@media (max-width:760px){.br-lgw{grid-template-columns:1fr}.br-grid{grid-template-columns:1fr}.br-title{font-size:18px}}";
  document.head.appendChild(css);
  window.BRIEFING = { render: render, load: load, _data: function () { return J; } };
  if (BTN.getAttribute("aria-selected") === "true") { J = store.get(CACHE); render(); load(); }
})();
