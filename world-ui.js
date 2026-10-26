/* world-ui.js — "World" tab: global sessions, cross-asset monitor, 52-week watch and the server alert feed.
   Data: world.json on the `world` branch, written every 15 min (Sun–Fri) by scripts/world.py — nothing is computed
   from invented values here; every row shows its provider, source time and age. Session states are derived from the
   exchange hours published in world.json (local exchange time, DST-aware via Intl). */
(function () {
  "use strict";
  var REPO = (window.LIVE_CONFIG && window.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/world.json?ref=world";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/world/world.json";
  var W = null, etag = "", lastOk = 0, lastTry = 0, err = null, NOTIFY = false;
  var V = { sub: "overview", grp: "all", flagged: false, q: "", sev: "all" };
  try { Object.assign(V, JSON.parse(localStorage.getItem("desk.world") || "{}")); NOTIFY = localStorage.getItem("desk.worldNotify") === "1"; } catch (e) {}
  var seen = {};
  function save() { try { localStorage.setItem("desk.world", JSON.stringify(V)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }
  function cl(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  function ago(ms) { var m = Math.round(ms / 60000); return m < 1 ? "<1m" : m < 60 ? m + "m" : m < 2880 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; }
  function tClock(iso, tz) { try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz || "America/Toronto", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
  function tDate(iso) { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }

  /* ---------- flags (inline SVG; US/CA reuse the desk's own) ---------- */
  function star(cx, cy, r, rot) { var p = []; for (var i = 0; i < 10; i++) { var a = (rot || -90) * Math.PI / 180 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; p.push((cx + rr * Math.cos(a)).toFixed(2) + "," + (cy + rr * Math.sin(a)).toFixed(2)); } return '<polygon points="' + p.join(" ") + '"/>'; }
  var UJ = '<rect width="60" height="30" fill="#012169"/><path d="M0,0 60,30M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30M60,0 0,30" stroke="#C8102E" stroke-width="2.4"/><path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/>';
  var FL = {
    gb: ["United Kingdom", "0 0 60 30", UJ],
    de: ["Germany", "0 0 5 3", '<rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#DD0000"/><rect y="2" width="5" height="1" fill="#FFCE00"/>'],
    fr: ["France", "0 0 3 2", '<rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/>'],
    eu: ["Euro area", "0 0 30 20", '<rect width="30" height="20" fill="#003399"/><g fill="#FFCC00">' + Array.apply(null, Array(12)).map(function (_, i) { var a = i * Math.PI / 6; return star(15 + 6 * Math.sin(a), 10 - 6 * Math.cos(a), 1.1); }).join("") + "</g>"],
    jp: ["Japan", "0 0 3 2", '<rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".6" fill="#BC002D"/>'],
    cn: ["China", "0 0 30 20", '<rect width="30" height="20" fill="#DE2910"/><g fill="#FFDE00">' + star(5, 5, 3) + star(10, 2, 1, -60) + star(12, 4, 1, -40) + star(12, 7, 1, -20) + star(10, 9, 1, 0) + "</g>"],
    hk: ["Hong Kong", "0 0 30 20", '<rect width="30" height="20" fill="#DE2910"/><g fill="#fff">' + [0, 72, 144, 216, 288].map(function (a) { return '<ellipse cx="15" cy="7.3" rx="1.8" ry="3" transform="rotate(' + a + ' 15 10)"/>'; }).join("") + "</g>"],
    in: ["India", "0 0 30 20", '<rect width="30" height="6.67" fill="#FF9933"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#138808"/><circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width=".6"/><circle cx="15" cy="10" r=".5" fill="#000080"/>'],
    au: ["Australia", "0 0 60 30", '<rect width="60" height="30" fill="#012169"/><g transform="scale(.5)">' + UJ + '</g><g fill="#fff">' + star(15, 23, 3) + star(45, 24, 1.6) + star(39, 13, 1.6) + star(45, 6, 1.6) + star(51, 11, 1.6) + "</g>"],
    nz: ["New Zealand", "0 0 60 30", '<rect width="60" height="30" fill="#012169"/><g transform="scale(.5)">' + UJ + '</g><g fill="#C8102E" stroke="#fff" stroke-width=".6">' + star(45, 25, 2.2) + star(39, 13, 2) + star(45, 6, 1.8) + star(51, 12, 1.8) + "</g>"],
    ch: ["Switzerland", "0 0 20 20", '<rect width="20" height="20" fill="#DA291C"/><path d="M8.3,4h3.4v4.3H16v3.4h-4.3V16H8.3v-4.3H4V8.3h4.3z" fill="#fff"/>'],
    xx: ["Global (OTC)", "0 0 20 20", '<circle cx="10" cy="10" r="9" fill="#1a3a5c" stroke="#7fd3e0" stroke-width="1"/><path d="M1,10h18M10,1v18M4,4.5c4,2 8,2 12,0M4,15.5c4,-2 8,-2 12,0M10,1c-5,5 -5,13 0,18M10,1c5,5 5,13 0,18" fill="none" stroke="#7fd3e0" stroke-width=".7"/>']
  };
  function fl(cc, h) {
    h = h || 14;
    if ((cc === "us" || cc === "ca") && typeof window.flag === "function") return window.flag(cc, h);
    var f = FL[cc] || FL.xx, vb = f[1].split(" "), w = Math.round(h * (+vb[2]) / (+vb[3]));
    if (cc === "xx" || cc === "ch") w = h;
    return '<svg class="flag" width="' + w + '" height="' + h + '" style="width:' + w + 'px;height:' + h + 'px;max-width:none" viewBox="' + f[1] + '" role="img" aria-label="' + f[0] + '"><title>' + f[0] + "</title>" + f[2] + "</svg>";
  }

  /* ---------- sessions (port of scripts/world.py session_status, DST-aware via Intl) ---------- */
  var FMT = {};
  function lp(tz, t) {
    var f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }));
    var o = {}; f.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return { wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday), m: (+o.hour % 24) * 60 + (+o.minute) };
  }
  function hm(s) { var a = s.split(":"); return +a[0] * 60 + (+a[1]); }
  function status(ex, t) {
    var p = lp(ex.tz, t), wd = p.wd, m = p.m;
    if (ex.fx || ex.globex) {
      var cm = ex.fx ? 1020 : 960, open = !(wd === 5 || (wd === 4 && m >= cm) || (wd === 6 && m < 1020));
      if (ex.globex && open && m >= cm && m < 1020) return "break";
      return open ? "open" : "closed";
    }
    if (ex.grains) {
      var night = ([6, 0, 1, 2, 3].indexOf(wd) >= 0 && m >= 1140) || ([0, 1, 2, 3, 4].indexOf(wd) >= 0 && m < 465);
      var day = wd < 5 && m >= 510 && m < 800;
      return day ? "open" : night ? "extended" : "closed";
    }
    if (wd >= 5) return "closed";
    for (var i = 0; i < ex.sessions.length; i++) if (m >= hm(ex.sessions[i][0]) && m < hm(ex.sessions[i][1])) return "open";
    var f0 = hm(ex.sessions[0][0]), l0 = hm(ex.sessions[ex.sessions.length - 1][1]);
    return m >= f0 && m < l0 ? "break" : m < f0 ? "pre" : "closed";
  }
  function nextChange(ex, t) {   /* 5-min steps, up to 4 days */
    var s0 = status(ex, t), on = s0 === "open" || s0 === "extended";
    for (var k = 1; k <= 1152; k++) { var tt = t + k * 300000, s = status(ex, tt), o = s === "open" || s === "extended"; if (o !== on) return { t: tt, to: s, opening: o }; }
    return null;
  }
  var SLAB = { open: "Open", extended: "Extended", break: "Break", pre: "Pre-open", closed: "Closed" };

  /* ---------- data ---------- */
  function poll(force) {
    if (window.DESK_LOCKED) return;
    if (!force && Date.now() - lastTry < 60000) return;
    lastTry = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) { lastOk = Date.now(); err = null; return null; }
      if (!r.ok) throw r.status;
      etag = r.headers.get("ETag") || ""; return r.json();
    }).then(function (j) { if (j) accept(j); else paintHead(); })
      .catch(function () {
        fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
          .then(accept).catch(function () { err = "could not reach world.json (network or GitHub)"; paintHead(); });
      });
  }
  function accept(j) {
    if (!j || !j.instruments) return;
    var first = !W; W = j; lastOk = Date.now(); err = null;
    var fresh = (j.alerts || []).filter(function (a) { var k = a.id + a.basis + a.at; if (seen[k]) return false; seen[k] = 1; return !first; });
    if (fresh.length) {
      if (window.DESK_LIVE && window.DESK_LIVE.toast) window.DESK_LIVE.toast("<b>World alert</b> — " + fresh.slice(0, 3).map(function (a) { return esc(a.name) + " " + sg(a.move, 2, a.unit === "bp" ? " bp" : "%") + " (" + a.severity + ")"; }).join(" · "));
      if (NOTIFY && "Notification" in window && Notification.permission === "granted") fresh.filter(function (a) { return a.tier >= 2; }).slice(0, 3).forEach(function (a) {
        try { new Notification("Global market alert — " + a.severity, { body: a.name + " " + sg(a.move, 2, a.unit === "bp" ? " bp" : "%") + " vs " + (a.basis === "prev_close" ? "previous close" : "session open") }); } catch (e) {}
      });
    }
    render();
  }

  /* ---------- views ---------- */
  function inst() { return (W && W.instruments) || []; }
  function badges(i) {
    var w = i.w52, b = []; if (!w) return "";
    if (w.new_high) b.push('<span class="wb nh">NEW 52W HIGH</span>');
    else if (w.near_high) b.push('<span class="wb nrh">' + nf(w.pct_from_high, 1) + "% from 52W high</span>");
    if (w.new_low) b.push('<span class="wb nl">NEW 52W LOW</span>');
    else if (w.near_low) b.push('<span class="wb nrl">' + nf(w.pct_from_low, 1) + "% above 52W low</span>");
    return b.join("");
  }
  function range52(i) {
    var w = i.w52; if (!w) return '<span class="neu">—</span>';
    var pos = Math.max(0, Math.min(100, w.pos));
    return '<div class="w52" title="52-week range ' + nf(w.low, i.dec) + " – " + nf(w.high, i.dec) + '"><span class="w52l">' + nf(w.low, i.dec) + '</span><div class="w52t"><i style="left:' + pos.toFixed(1) + '%"></i></div><span class="w52h">' + nf(w.high, i.dec) + "</span></div>";
  }
  function chgCell(i) {
    if (i.kind === "yield" || i.kind === "spread") { var bp = i.chg_bp != null ? i.chg_bp : i.chg * (i.kind === "yield" ? 100 : 1); return '<span class="' + cl(bp) + '">' + sg(bp, 1, " bp") + "</span>"; }
    return '<span class="' + cl(i.pct) + '"><b>' + sg(i.pct, 2, "%") + "</b></span>";
  }
  function age(i) {
    /* age is measured from the source's own bar timestamp to NOW (not frozen at the server run), so it keeps
       counting between server runs; delay_min (age at the server run) is only a fallback if ts is missing */
    var q = i.quality || "", tsMs = i.ts ? Date.parse(i.ts) : NaN,
        ms = !isNaN(tsMs) ? Math.max(0, Date.now() - tsMs) : i.delay_min != null ? i.delay_min * 60000 : null;
    var c = /stale|no trading/.test(q) ? "aw" : /closed|end-of-day/.test(q) ? "cz" : "ok";
    return '<span class="wq ' + c + '" title="' + esc(i.provider + " · source time " + tDate(i.ts) + " ET") + '">' + esc(q.replace(" · contract roll", "")) + (ms != null && !/end-of-day/.test(q) ? " · " + ago(ms) : "") + (i.roll ? ' <b title="' + esc(i.roll.note) + '">ROLL</b>' : "") + "</span>";
  }
  function spark(a) {
    if (!a || a.length < 3) return "";
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = (mx - mn) || 1, up = a[a.length - 1] >= a[0];
    return '<svg class="wsp" viewBox="0 0 60 18" preserveAspectRatio="none"><polyline fill="none" stroke="' + (up ? "#3fb97f" : "#e0655f") + '" stroke-width="1.4" vector-effect="non-scaling-stroke" points="' +
      a.map(function (v, k) { return (k / (a.length - 1) * 60).toFixed(1) + "," + (17 - (v - mn) / r * 16).toFixed(1); }).join(" ") + '"/></svg>';
  }
  function last(i) { return (i.kind === "yield" ? nf(i.last, 3) + "%" : i.kind === "spread" ? nf(i.last, 1) + " bp" : nf(i.last, i.dec)); }
  function rowHTML(i) {
    var ex = W.exchanges[i.ex] || {}, st = status(ex, Date.now());
    return '<tr data-wid="' + i.id + '"><td class="wn">' + fl(i.cc, 13) + ' <span><b>' + esc(i.name) + '</b><small>' + esc(i.alt_of ? i.sym + " (alt)" : i.sym) + (i.note ? " · " + esc(i.note) : "") + "</small></span></td>" +
      '<td><span class="wst ' + st + '" title="' + esc(ex.name || "") + '">' + SLAB[st] + "</span></td>" +
      '<td class="r"><b data-tick="w-' + i.id + '">' + last(i) + "</b></td>" +
      '<td class="r">' + (i.kind === "price" ? '<span class="' + cl(i.chg) + '">' + sg(i.chg, i.dec) + "</span>" : "") + "</td>" +
      '<td class="r">' + chgCell(i) + "</td>" +
      '<td class="r">' + (i.high != null ? nf(i.high, i.dec) : "—") + "</td><td class=\"r\">" + (i.low != null ? nf(i.low, i.dec) : "—") + "</td>" +
      "<td>" + range52(i) + '<div class="wbs">' + badges(i) + "</div></td><td>" + spark(i.spark) + "</td><td>" + age(i) + "</td></tr>";
  }
  var GROUPS = ["Indices", "FX", "Metals", "Energy", "Industrial & Ags", "Rates & Vol"];
  function marketsHTML() {
    var q = (V.q || "").toLowerCase(), list = inst().filter(function (i) {
      return (V.grp === "all" || i.group === V.grp) && (!V.flagged || (i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low))) &&
        (!q || (i.name + " " + i.sym + " " + i.region).toLowerCase().indexOf(q) >= 0);
    });
    var filt = '<div class="wfil"><input type="search" placeholder="Search markets…" value="' + esc(V.q) + '" data-wq>' +
      ["all"].concat(GROUPS).map(function (g) { return '<button class="nchip" data-wgrp="' + g + '" aria-pressed="' + (V.grp === g) + '">' + (g === "all" ? "All" : g) + "</button>"; }).join("") +
      '<button class="nchip" data-wflag aria-pressed="' + V.flagged + '">52-week signals only</button></div>';
    var body = GROUPS.filter(function (g) { return V.grp === "all" || V.grp === g; }).map(function (g) {
      var rows = list.filter(function (i) { return i.group === g; });
      if (g === "Indices") rows.sort(function (a, b) { return ["Asia-Pacific", "Europe", "Americas"].indexOf(a.region) - ["Asia-Pacific", "Europe", "Americas"].indexOf(b.region); });
      if (!rows.length) return "";
      return '<tr class="wgh"><td colspan="10">' + g + "</td></tr>" + rows.map(rowHTML).join("");
    }).join("");
    return '<div class="tile wide"><h2>All markets <span class="h2note">— last price, change, today’s range, 52-week position · hover a status for the exchange, an age for the source time</span></h2>' + filt +
      '<div class="wtw"><table class="wt"><thead><tr><th>Market</th><th>Status</th><th class="r">LTP</th><th class="r">Chg</th><th class="r">% Chg</th><th class="r">High</th><th class="r">Low</th><th>52-week range</th><th>30d</th><th>Data</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="10" class="neu">No markets match the filter.</td></tr>') + "</tbody></table></div>" +
      '<div class="stamp">LTP = last traded/quoted price · % change vs the previous official close (yields and spreads in basis points) · high/low = current session · 52-week range from daily highs/lows · badges: NEW 52W HIGH/LOW when today’s range breaks the prior 52-week extreme, “% from” when within 5% · ROLL = continuous futures symbol switched contracts; change measured against that contract’s own previous close</div></div>';
  }
  function sessionsHTML() {
    var now = Date.now(), ex = W.exchanges, keys = ["ASX", "TSE", "HKEX", "SSE", "NSE", "XETRA", "EPA", "EUREX", "LSE", "NYSE", "TSX", "CBOT", "CME", "ICE", "FX"].filter(function (k) { return ex[k]; });
    var tp = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now)).forEach(function (p) { tp[p.type] = p.value; });
    var d0 = zonedMs(+tp.year, +tp.month, +tp.day, 0, 0, "America/Toronto"), D = 86400000, nowX = (now - d0) / D * 100;
    var rows = keys.map(function (k) {
      var e = ex[k], seg = "", cur = null, start = 0;
      for (var s = 0; s <= 144; s++) {
        var t = d0 + s * 600000, st = s < 144 ? status(e, t) : null, o = st === "open" || st === "extended" || st === "break" ? st : null;
        if (o !== cur) { if (cur) seg += '<i class="b ' + cur + '" style="left:' + (start / 144 * 100).toFixed(2) + "%;width:" + ((s - start) / 144 * 100).toFixed(2) + '%"></i>'; cur = o; start = s; }
      }
      var st = status(e, now), nx = nextChange(e, now), loc = new Date(now).toLocaleTimeString("en-US", { timeZone: e.tz, hour: "numeric", minute: "2-digit", weekday: "short" });
      return '<div class="srow"><div class="sname">' + fl(e.cc, 14) + ' <span><b>' + esc(e.name) + "</b><small>" + esc(e.city) + " · " + esc(loc) + '</small></span></div><div class="sbar">' + seg + '<u style="left:' + nowX.toFixed(2) + '%"></u></div>' +
        '<div class="sst"><span class="wst ' + st + '">' + SLAB[st] + "</span>" + (nx ? '<small>' + (nx.opening ? "opens" : "closes") + ' in <span class="countdown" data-t="' + nx.t + '">' + ago(nx.t - now) + "</span></small>" : "") + "</div></div>";
    }).join("");
    var hours = ""; for (var h = 0; h <= 24; h += 3) hours += '<span style="left:' + (h / 24 * 100) + '%">' + (h % 12 || 12) + (h < 12 || h === 24 ? "a" : "p") + "</span>";
    return '<div class="tile wide"><h2>Global sessions <span class="h2note">— today on Toronto time · bars = regular hours (lighter = overnight/extended, amber = lunch or daily break) · white line = now</span></h2>' +
      '<div class="sgrid"><div></div><div class="shrs">' + hours + "</div><div></div>" + rows + "</div>" +
      '<div class="stamp">Hours from each exchange’s published regular session in local time (daylight-saving handled per time zone) · exchange holidays are not in a calendar: a scheduled-open market with no fresh bars is shown as “no trading today (holiday?)” in the data column · FX trades 24/5 (Sun 5 pm – Fri 5 pm New York) · CME Globex has a daily 4–5 pm CT break</div></div>';
  }
  function zonedMs(y, mo, d, h, mi, tz) { if (typeof window.zonedMs === "function") return window.zonedMs(y, mo, d, h, mi, tz); var g = Date.UTC(y, mo - 1, d, h, mi), p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(g)).forEach(function (x) { p[x.type] = +x.value; }); return g - (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - g); }
  function moverRow(i) { return '<div class="mv">' + fl(i.cc, 12) + ' <span class="mvn">' + esc(i.name) + "</span>" + chgCell(i) + '<span class="mvl">' + last(i) + "</span></div>"; }

  /* 52-week watch: two sides (highs | lows), each grouped by asset class, nearest first */
  function w52WatchHTML(L) {
    function side(hi) {
      var xs = L.filter(function (i) { var w = i.w52; return w && (hi ? (w.new_high || w.near_high) : (w.new_low || w.near_low)); });
      var dist = function (i) { return hi ? (i.w52.new_high ? -1 : i.w52.pct_from_high) : (i.w52.new_low ? -1 : i.w52.pct_from_low); };
      var body = GROUPS.map(function (g) {
        var r = xs.filter(function (i) { return i.group === g; }).sort(function (a, b) { return dist(a) - dist(b); });
        if (!r.length) return "";
        return '<div class="w5g"><div class="w5gh">' + ({ Indices: "Equity indices", FX: "Currencies" }[g] || g) + "<small>" + r.length + "</small></div>" + r.map(function (i) {
          var w = i.w52, isNew = hi ? w.new_high : w.new_low, d = hi ? w.pct_from_high : w.pct_from_low;
          var tag = isNew ? '<span class="wb ' + (hi ? "nh" : "nl") + '">NEW 52W ' + (hi ? "HIGH" : "LOW") + "</span>" : '<span class="w5d">' + nf(d, 1) + "%" + (hi ? " below" : " above") + "</span>";
          var fill = Math.max(4, Math.min(100, 100 - (isNew ? 0 : d) * 20));
          return '<div class="w5r">' + fl(i.cc, 12) + '<span class="w5n" title="' + esc(i.sym) + '">' + esc(i.name) + '</span><span class="w5l">' + last(i) + "</span>" + chgCell(i) +
            '<span class="w5bar"><i style="width:' + fill.toFixed(0) + '%"></i></span>' + tag + "</div>";
        }).join("") + "</div>";
      }).join("");
      return '<div class="w5s ' + (hi ? "hi" : "lo") + '"><div class="w5h"><b>' + (hi ? "▲ Near 52-week HIGH" : "▼ Near 52-week LOW") + "</b><small>" + xs.length + " markets · " +
        xs.filter(function (i) { return hi ? i.w52.new_high : i.w52.new_low; }).length + " new " + (hi ? "highs" : "lows") + "</small></div>" +
        (body || '<p class="note">None within 5% right now.</p>') + "</div>";
    }
    return '<div class="tile wide"><h2>52-week watch <span class="h2note">— markets at or within 5% of their 52-week high or low, by asset class · bar = how close (full = at the extreme)</span></h2><div class="w5">' + side(true) + side(false) + "</div></div>";
  }
  function overviewHTML() {
    var L = inst(), px = L.filter(function (i) { return i.kind === "price" && i.pct != null && !/^vix/.test(i.id); });
    var up = px.slice().sort(function (a, b) { return b.pct - a.pct; }), dn = px.slice().sort(function (a, b) { return a.pct - b.pct; });
    var idx = L.filter(function (i) { return i.group === "Indices" && i.pct != null; }), adv = idx.filter(function (i) { return i.pct > 0; }).length;
    var g = function (id) { return L.filter(function (i) { return i.id === id; })[0]; }, k = function (id, lab) { var i = g(id); return i ? '<div class="kpi"><div class="kpi-k">' + lab + '</div><div class="kpi-v">' + last(i) + '</div><div class="kpi-s">' + chgCell(i) + " · " + age(i) + "</div></div>" : ""; };
    var regs = ["Asia-Pacific", "Europe", "Americas"].map(function (r) {
      var xs = idx.filter(function (i) { return i.region === r; }), av = xs.length ? xs.reduce(function (s, i) { return s + i.pct; }, 0) / xs.length : null;
      return '<div class="reg"><div class="regh">' + r + ' <span class="' + cl(av) + '">' + sg(av, 2, "%") + "</span></div>" + xs.map(moverRow).join("") + "</div>";
    }).join("");
    var w52 = L.filter(function (i) { return i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low); })
      .sort(function (a, b) { return (b.w52.new_high || b.w52.new_low) - (a.w52.new_high || a.w52.new_low); });
    var al = (W.alerts || []).slice(0, 6);
    return '<div class="tile wide kpi-strip">' + '<div class="kpi"><div class="kpi-k">Index breadth</div><div class="kpi-v">' + adv + "<small> / " + idx.length + ' up</small></div><div class="kpi-s">' + (idx.length - adv) + " down · vs previous close</div></div>" +
      k("spx", "S&P 500") + k("dxy", "US dollar (DXY)") + k("vix", "VIX") + k("gold", "Gold") + k("wti", "WTI crude") + "</div>" +
      '<div class="tile"><h2>Biggest gainers <span class="h2note">— % vs previous close</span></h2>' + up.slice(0, 6).map(moverRow).join("") + "</div>" +
      '<div class="tile"><h2>Biggest decliners <span class="h2note">— % vs previous close</span></h2>' + dn.slice(0, 6).map(moverRow).join("") + "</div>" +
      '<div class="tile wide"><h2>Regional equity performance <span class="h2note">— average index move by region, latest session</span></h2><div class="regs">' + regs + "</div></div>" +
      w52WatchHTML(L) +
      '<div class="tile wide"><h2>Latest alerts <span class="h2note">— from the server engine (runs every 15 min, also while this page is closed)</span></h2>' + (al.length ? alertRows(al) : '<p class="note">No alerts yet this session.</p>') + "</div>";
  }
  function alertRows(list) {
    return '<div class="wtw"><table class="wt wa"><thead><tr><th>Time (ET)</th><th>Market</th><th>Move</th><th>Severity</th><th>Compared with</th><th>Reference → current</th><th>Data</th><th>Delivery</th></tr></thead><tbody>' +
      list.map(function (a) { return "<tr><td>" + tDate(a.at) + "</td><td><b>" + esc(a.name) + "</b><small> " + esc(a.group || "") + '</small></td><td class="' + (a.dir === "up" ? "up" : "dn") + '"><b>' + sg(a.move, 2, a.unit === "bp" ? " bp" : "%") + "</b></td>" +
        '<td><span class="sev s' + a.tier + '">' + esc(a.severity) + (a.kind === "escalation" ? " ↑" : "") + "</span></td><td>" + (a.basis === "prev_close" ? "Previous close" : "Session open") + "</td><td>" + nf(a.ref, 4) + " → " + nf(a.last, 4) + "</td>" +
        "<td><small>" + esc(a.status || "") + (a.delay_min != null ? " · " + nf(a.delay_min, 0) + " min old" : "") + "</small></td><td><small>" + esc(a.delivery || "") + "</small></td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function alertsHTML() {
    var list = (W.alerts || []).filter(function (a) { return V.sev === "all" || (V.sev === "major" ? a.tier >= 2 : V.sev === "up" ? a.dir === "up" : V.sev === "down" ? a.dir === "down" : true); });
    var t = W.thresholds || {};
    return '<div class="tile wide"><h2>Alert feed <span class="h2note">— ' + (W.alerts || []).length + " stored · tiers " + (t.pct || []).map(function (x, k) { return (t.names || [])[k] + " ±" + x + "%"; }).join(", ") + " (yields " + (t.bp || []).join("/") + " bp)</span></h2>" +
      '<div class="wfil">' + [["all", "All"], ["major", "Major and above"], ["up", "Upward"], ["down", "Downward"]].map(function (x) { return '<button class="nchip" data-wsev="' + x[0] + '" aria-pressed="' + (V.sev === x[0]) + '">' + x[1] + "</button>"; }).join("") +
      '<button class="nchip" data-wnotify aria-pressed="' + NOTIFY + '">' + (NOTIFY ? "Browser notifications on" : "Turn on browser notifications") + "</button></div>" +
      (list.length ? alertRows(list) : '<p class="note">No alerts match.</p>') +
      '<div class="stamp">One alert per market × comparison × direction × tier crossing · re-alerts only on a higher tier, a direction flip, or after falling back below the Watch tier (' + (t.cooldown_min || 30) + "-min cooldown) · no alerts on stale quotes, closed markets or futures roll sessions · browser notifications work while this page is open; for alerts while it is closed, add a WORLD_ALERT_WEBHOOK secret (Slack/Teams/other webhook) — currently " + esc((W.health || {}).webhook || "not configured") + "</div></div>";
  }
  function healthHTML() {
    var H = W.health || {}, age_ = Date.now() - Date.parse(W.updated_at);
    return '<div class="tile wide"><h2>Data health</h2><div class="stat-row">' +
      '<div class="stat"><div class="k">Last server run</div><div class="v">' + ago(age_) + ' ago</div><div class="s">' + tDate(W.updated_at) + " ET · " + nf(W.run_seconds, 0) + " s</div></div>" +
      '<div class="stat"><div class="k">Coverage</div><div class="v">' + H.ok + " / " + H.expected + '</div><div class="s">instruments returned</div></div>' +
      '<div class="stat"><div class="k">Page poll</div><div class="v">' + (lastOk ? ago(Date.now() - lastOk) + " ago" : "—") + '</div><div class="s">checks every 2 min while open</div></div>' +
      '<div class="stat"><div class="k">Alert delivery</div><div class="v">' + esc(H.webhook || "—") + '</div><div class="s">webhook (server)</div></div></div>' +
      '<p class="note">' + esc(W.provider || "") + "</p>" +
      (H.failed && H.failed.length ? "<h3 class=\"mp-h\">Not returned by the provider this run</h3>" + H.failed.map(function (f) { return '<div class="kv"><span class="kk">' + esc(f.id) + " (" + esc(f.sym) + ')</span><span class="vv">' + esc(f.error) + "</span></div>"; }).join("") : "") +
      (H.gaps && H.gaps.length ? "<h3 class=\"mp-h\">Known coverage gaps</h3>" + H.gaps.map(function (g) { return '<div class="kv"><span class="kk">' + esc(g.name) + '</span><span class="vv">' + esc(g.why) + "</span></div>"; }).join("") : "") +
      '<div class="stamp">Source-data age and polling time are shown separately: “delayed · 14m” means the last bar (by the source’s own timestamp; 5-min bars are stamped at the bar’s start) is 14 minutes old right now, not that the page polled 14 minutes ago · the server runs every 15 min Sun–Fri (UTC) · a market open longer than ' + ((W.thresholds || {}).stale_after_min_when_open || 45) + " min without a new bar is marked stale and never alerts</div></div>";
  }
  function paintHead() {
    var h = document.getElementById("wHead"); if (!h) return;
    var now = Date.now(), cities = [["Toronto", "America/Toronto", "ca"], ["New York", "America/New_York", "us"], ["London", "Europe/London", "gb"], ["Frankfurt", "Europe/Berlin", "de"], ["Mumbai", "Asia/Kolkata", "in"], ["Hong Kong", "Asia/Hong_Kong", "hk"], ["Tokyo", "Asia/Tokyo", "jp"], ["Sydney", "Australia/Sydney", "au"]];
    var a = W ? now - Date.parse(W.updated_at) : null, stale = a != null && a > 40 * 60000;
    h.innerHTML = '<div class="wclk">' + cities.map(function (c) { return '<span>' + fl(c[2], 11) + " <b>" + new Date(now).toLocaleTimeString("en-US", { timeZone: c[1], hour: "numeric", minute: "2-digit" }) + "</b><small>" + c[0] + "</small></span>"; }).join("") + "</div>" +
      '<div class="wsrc">' + (err ? '<span class="pk-al hot">' + esc(err) + "</span> " : "") + (W ? '<span class="pk-al ' + (stale ? "warn" : "ok") + '">server data ' + ago(a) + " old" + (stale ? " — server runs paused (weekend) or failing" : "") + "</span> " : '<span class="pk-al warn">loading world.json…</span>') + "</div>";
  }
  var WTHEME = { overview: "#38b6c9", sessions: "#6ea8ff", markets: "#e8b93d", alerts: "#ff8a84", health: "#3fb97f" };
  function navHTML() {
    var L = inst(), now = Date.now(), ex = (W && W.exchanges) || {}, al = (W && W.alerts) || [];
    var openN = Object.keys(ex).filter(function (k) { var s = status(ex[k], now); return s === "open" || s === "extended"; }).length;
    var sig = L.filter(function (i) { return i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low); }).length;
    var H = (W && W.health) || {};
    var heads = [
      ["overview", "Overview", "movers · regions · 52-week"],
      ["sessions", "Sessions", W ? openN + " of " + Object.keys(ex).length + " venues open now" : ""],
      ["markets", "Markets", W ? L.length + " instruments · " + sig + " 52-week signals" : ""],
      ["alerts", "Alerts", W ? al.length + " stored · " + al.filter(function (a) { return a.tier >= 2; }).length + " major+" : ""],
      ["health", "Data health", W ? (H.ok || 0) + " / " + (H.expected || 0) + " returned" : ""]];
    function kid(attr, val, on, lab, n) { return '<button class="sn-b" ' + attr + '="' + val + '" aria-pressed="' + on + '"><span>' + esc(lab) + "</span>" + (n != null ? "<small>" + n + "</small>" : "") + "</button>"; }
    function kids(id) {
      if (!W) return "";
      if (id === "markets") return kid("data-wgrp", "all", V.grp === "all" && !V.flagged, "All markets", L.length) +
        GROUPS.map(function (g) { return kid("data-wgrp", g, V.grp === g && !V.flagged, g, L.filter(function (i) { return i.group === g; }).length); }).join("") +
        kid("data-wflag", "1", V.flagged, "52-week signals only", sig);
      if (id === "alerts") return [["all", "All alerts", al.length], ["major", "Major and above", al.filter(function (a) { return a.tier >= 2; }).length], ["up", "Upward", al.filter(function (a) { return a.dir === "up"; }).length], ["down", "Downward", al.filter(function (a) { return a.dir === "down"; }).length]]
        .map(function (x) { return kid("data-wsev", x[0], V.sev === x[0], x[1], x[2]); }).join("");
      return "";
    }
    return '<div class="sn-h">World markets</div>' + heads.map(function (h) {
      var on = V.sub === h[0], k = on ? kids(h[0]) : "", hasK = h[0] === "markets" || h[0] === "alerts";
      return '<div class="tn' + (on ? " open" : "") + '" style="--tc:' + WTHEME[h[0]] + '"><button class="tn-h" data-wsub="' + h[0] + '" aria-selected="' + on + '"><i class="tn-dot"></i><span class="tn-t"><b>' + h[1] + "</b><small>" + esc(h[2]) + '</small></span><span class="tn-chev" aria-hidden="true">' + (hasK ? "›" : "") + "</span></button>" + (k ? '<div class="tn-kids">' + k + "</div>" : "") + "</div>";
    }).join("");
  }
  function ctxHTML() {
    var lab = { overview: "Overview", sessions: "Sessions", markets: "Markets", alerts: "Alerts", health: "Data health" }[V.sub] || "Overview";
    var sec = V.sub === "markets" ? (V.flagged ? "52-week signals only" : V.grp === "all" ? "All markets" : V.grp) : V.sub === "alerts" ? ({ all: "All alerts", major: "Major and above", up: "Upward", down: "Downward" }[V.sev] || "") : "";
    return '<span class="sc-pill"><i></i>' + lab + "</span>" + (sec ? '<span class="sc-sec">› ' + esc(sec) + "</span>" : "");
  }
  function render() {
    var P = document.getElementById("panel-world"); if (!P) return;
    if (!P.querySelector("#wHead")) P.innerHTML = '<div class="world wlay"><nav class="secnav wnav" id="wNav" aria-label="World sections"></nav><div class="wmain"><div class="tile wide subnav-tile"><div class="subctx" id="wCtx"></div><div id="wHead"></div></div><div class="grid" id="wBody"></div></div></div>';
    P.style.setProperty("--sa", WTHEME[V.sub] || "#38b6c9");
    P.querySelector(".wlay").setAttribute("data-subt", V.sub);
    paintHead();
    document.getElementById("wNav").innerHTML = navHTML();
    document.getElementById("wCtx").innerHTML = ctxHTML();
    var B = document.getElementById("wBody");
    if (!W) { B.innerHTML = '<div class="tile wide"><p class="note">Loading global market data…</p></div>'; return; }
    B.innerHTML = V.sub === "sessions" ? sessionsHTML() : V.sub === "markets" ? marketsHTML() : V.sub === "alerts" ? alertsHTML() : V.sub === "health" ? healthHTML() : overviewHTML();
    if (window.MOTION) window.MOTION.scan();
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t || !t.closest("#panel-world")) return;
    var b = t.closest("[data-wsub]"); if (b) { V.sub = b.getAttribute("data-wsub"); save(); render(); return; }
    b = t.closest("[data-wgrp]"); if (b) { V.grp = b.getAttribute("data-wgrp"); if (b.closest("#wNav")) V.flagged = false; save(); render(); return; }
    b = t.closest("[data-wflag]"); if (b) { V.flagged = b.closest("#wNav") ? true : !V.flagged; if (V.flagged && b.closest("#wNav")) V.grp = "all"; save(); render(); return; }
    b = t.closest("[data-wsev]"); if (b) { V.sev = b.getAttribute("data-wsev"); save(); render(); return; }
    b = t.closest("[data-wnotify]"); if (b) {
      if (NOTIFY) { NOTIFY = false; try { localStorage.setItem("desk.worldNotify", "0"); } catch (e) {} render(); return; }
      if ("Notification" in window) Notification.requestPermission().then(function (p) { NOTIFY = p === "granted"; try { localStorage.setItem("desk.worldNotify", NOTIFY ? "1" : "0"); } catch (e) {} render(); });
    }
  });
  document.addEventListener("input", function (ev) {
    var q = ev.target.closest && ev.target.closest("[data-wq]"); if (!q) return;
    V.q = q.value; save(); var pos = q.selectionStart; render(); var n = document.querySelector("#panel-world [data-wq]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
  });
  function active() { var P = document.getElementById("panel-world"); return P && P.classList.contains("active"); }
  setInterval(function () { if (!window.DESK_LOCKED && (active() || Date.now() - lastTry > 600000)) poll(); }, 30000);
  setInterval(function () { if (active()) { paintHead(); if (V.sub === "sessions" && W) render(); } }, 60000);
  window.addEventListener("desk:unlock", function () { poll(true); });
  document.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("#tabbtn-world"); if (b) { render(); poll(); } });
  window.WORLD = { poll: poll, render: render, status: status, flag: fl, _data: function () { return W; } };
  render(); if (window.DESK_LOCKED === false) poll(true);
})();
