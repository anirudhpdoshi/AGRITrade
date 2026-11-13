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
  /* report-first layout (Nov 2026): top tabs + one slicer row, no left nav.
     Same button language as positioning-ui.js .pos-tabs (lines 23-26). The
     #panel-world scope beats the site's .wlay / body.nav-min .wlay rules. */
  (function () {
    var css = document.createElement("style");
    css.textContent =
      "#panel-world .wlay{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}" +
      "#panel-world .wmain{min-width:0;display:flex;flex-direction:column;gap:14px}" +
      ".w-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}" +
      ".w-tabs button{appearance:none;font:700 13.5px 'IBM Plex Sans',sans-serif;color:var(--muted);background:transparent;border:1px solid var(--line2);border-radius:8px;padding:8px 14px;cursor:pointer}" +
      ".w-tabs button:hover{color:#fff;background:#14213a}" +
      ".w-tabs button[aria-selected=true]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
      ".w-tabs button small{font-weight:400;font-size:11.5px;opacity:.75;margin-left:6px}" +
      ".w-slicer{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 4px}" +
      ".w-slicer button{appearance:none;font:600 12.5px 'IBM Plex Sans',sans-serif;color:var(--muted);background:transparent;border:1px solid var(--line2);border-radius:8px;padding:6px 10px;cursor:pointer}" +
      ".w-slicer button:hover{color:#fff;background:#14213a}" +
      ".w-slicer button[aria-pressed=true]{color:#101825;background:var(--amber);border-color:var(--amber)}" +
      ".w-slicer button small{font-family:'IBM Plex Mono',monospace;font-size:11px;opacity:.75;margin-left:5px}";
    document.head.appendChild(css);
  })();
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
    br: ["Brazil", "0 0 30 21", '<rect width="30" height="21" fill="#009C3B"/><path d="M15,2.5 27.5,10.5 15,18.5 2.5,10.5Z" fill="#FFDF00"/><circle cx="15" cy="10.5" r="4.6" fill="#002776"/><path d="M10.6,9.6c3-.6 6.2-.2 8.8,1.4" stroke="#fff" stroke-width=".7" fill="none"/>'],
    ar: ["Argentina", "0 0 30 20", '<rect width="30" height="20" fill="#74ACDF"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><circle cx="15" cy="10" r="1.9" fill="#F6B40E"/>'],
    ru: ["Russia", "0 0 9 6", '<rect width="9" height="2" fill="#fff"/><rect y="2" width="9" height="2" fill="#0039A6"/><rect y="4" width="9" height="2" fill="#D52B1E"/>'],
    ua: ["Ukraine", "0 0 3 2", '<rect width="3" height="1" fill="#0057B7"/><rect y="1" width="3" height="1" fill="#FFD700"/>'],
    py: ["Paraguay", "0 0 30 20", '<rect width="30" height="6.67" fill="#D52B1E"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#0038A8"/>'],
    za: ["South Africa", "0 0 30 20", '<rect width="30" height="20" fill="#fff"/><rect width="30" height="10" fill="#E03C31"/><rect y="10" width="30" height="10" fill="#001489"/><path d="M0,0 13,10 0,20Z" fill="#000"/><path d="M0,0 13,10 0,20" stroke="#FFB81C" stroke-width="2" fill="none"/><path d="M0,0 13,10 30,10M0,20 13,10" stroke="#007749" stroke-width="3" fill="none"/>'],
    kz: ["Kazakhstan", "0 0 30 15", '<rect width="30" height="15" fill="#00AFCA"/><circle cx="15" cy="7.5" r="3" fill="#FEC50C"/>'],
    mx: ["Mexico", "0 0 3 2", '<rect width="1" height="2" fill="#006847"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#CE1126"/><circle cx="1.5" cy="1" r=".22" fill="#8C5A2B"/>'],
    uy: ["Uruguay", "0 0 27 18", '<rect width="27" height="18" fill="#fff"/><g fill="#0038A8"><rect y="2" width="27" height="2"/><rect y="6" width="27" height="2"/><rect y="10" width="27" height="2"/><rect y="14" width="27" height="2"/></g><rect width="10" height="10" fill="#fff"/><circle cx="5" cy="5" r="2.6" fill="#FCD116"/>'],
    pk: ["Pakistan", "0 0 30 20", '<rect width="30" height="20" fill="#01411C"/><rect width="7.5" height="20" fill="#fff"/><circle cx="18.5" cy="10" r="5" fill="#fff"/><circle cx="20" cy="9" r="4.3" fill="#01411C"/>'],
    tr: ["Türkiye", "0 0 30 20", '<rect width="30" height="20" fill="#E30A17"/><circle cx="11" cy="10" r="5" fill="#fff"/><circle cx="12.3" cy="10" r="4" fill="#E30A17"/>'],
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
          .then(accept).catch(function () { if (!W) lastTry = Date.now() - 45000;   /* nothing loaded yet: try again in ~15 s, not a minute */
            try { window.dispatchEvent(new CustomEvent("desk:world")); } catch (e) {} err = "Sorry, we can\u2019t be reached now \u2014 world market data did not load (network or GitHub); retrying every minute"; if (W) paintHead(); else render(); });
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
    try { window.dispatchEvent(new CustomEvent("desk:world")); } catch (e) {}   /* US Market and others repaint from the same snapshot at once */
  }

  /* ---------- views ---------- */
  function inst() { return ((W && W.instruments) || []).map(function (i) { return i.id === "usdcad" ? deskSync(i) : i; }); }   // USD/CAD reads the same in every World view
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
    /* exact source time on every row (Toronto time; date added when it is not today), then the age */
    var when = "";
    if (!isNaN(tsMs)) {
      var sameDay = new Date(tsMs).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) === new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
      var d = new Date(tsMs).toLocaleDateString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric" });
      when = /end-of-day/.test(q) ? "close " + d : (sameDay ? "" : d + " ") + tClock(i.ts) + " ET";
    }
    var lab = /end-of-day/.test(q) ? "official" : q.replace(" · contract roll", "");
    return '<span class="wq ' + c + '" title="' + esc("source bar time " + tDate(i.ts) + " ET") + '">' +
      (lab === "closed" ? "" : esc(lab)) + (when ? (lab === "closed" ? "" : " · ") + '<span class="wqtm">' + esc(when) + "</span>" : "") + (ms != null && !/end-of-day/.test(q) ? " · " + ago(ms) : "") + (i.roll ? ' · <span title="' + esc(i.roll.note) + '">contract rolled</span>' : "") + "</span>";
  }
  function spark(a) {
    if (!a || a.length < 3) return "";
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = (mx - mn) || 1, up = a[a.length - 1] >= a[0];
    return '<svg class="wsp" viewBox="0 0 60 18" preserveAspectRatio="none"><polyline fill="none" stroke="' + (up ? "#3fb97f" : "#e0655f") + '" stroke-width="1.4" vector-effect="non-scaling-stroke" points="' +
      a.map(function (v, k) { return (k / (a.length - 1) * 60).toFixed(1) + "," + (17 - (v - mn) / r * 16).toFixed(1); }).join(" ") + '"/></svg>';
  }
  function last(i) { return (i.kind === "yield" ? nf(i.last, 3) + "%" : i.kind === "spread" ? nf(i.last, 1) + " bp" : nf(i.last, i.dec)); }

  /* "as of" stamp for any set of instruments: newest and oldest source bar, in Toronto time, with age */
  function asOf(list, cls) {
    var ts = (list || []).map(function (i) { return Date.parse(i.ts); }).filter(isFinite);
    if (!ts.length) return "";
    var mx = Math.max.apply(null, ts), mn = Math.min.apply(null, ts), now = Date.now();
    var t = function (ms) { return new Date(ms).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
    var txt = "as of " + t(mx) + " ET · " + ago(now - mx) + " ago" + (mx - mn > 3600000 ? " · oldest " + t(mn) + " (" + ago(now - mn) + ")" : "");
    return '<span class="wasof' + (cls ? " " + cls : "") + '" title="Source bar times from the provider, shown in Toronto time. Closed markets show their last session close.">' + txt + "</span>";
  }
  function rowHTML(i) {
    var ex = W.exchanges[i.ex] || {}, st = status(ex, Date.now());
    return '<tr data-wid="' + i.id + '"><td class="wn">' + fl(i.cc, 13) + ' <span><b>' + esc(i.name) + '</b><small>' + esc(i.alt_of ? i.sym + " (alt)" : i.sym) + (i.note ? " · " + esc(i.note) : "") + "</small></span></td>" +
      '<td><span class="wst ' + st + '" title="' + esc(ex.name || "") + '">' + SLAB[st] + '</span><div class="wqt">' + age(i) + "</div></td>" +
      '<td class="r"><b data-tick="w-' + i.id + '">' + last(i) + "</b></td>" +
      '<td class="r">' + (i.kind === "price" ? '<span class="' + cl(i.chg) + '">' + sg(i.chg, i.dec) + "</span>" : "") + "</td>" +
      '<td class="r">' + chgCell(i) + "</td>" +
      '<td class="r">' + (i.high != null ? nf(i.high, i.dec) : "—") + "</td><td class=\"r\">" + (i.low != null ? nf(i.low, i.dec) : "—") + "</td>" +
      "<td>" + range52(i) + '<div class="wbs">' + badges(i) + "</div></td><td>" + spark(i.spark) + "</td></tr>";
  }
  var GROUPS = ["Indices", "FX", "Metals", "Energy", "Industrial & Ags", "Rates & Vol"];
  /* Markets as four quadrants of tiles (Nov 13): equities · currencies · commodities · rates & volatility */
  var QUADS = [["Equity indices", ["Indices"]], ["Currencies", ["FX"]], ["Commodities", ["Metals", "Energy", "Industrial & Ags"]], ["Rates & volatility", ["Rates & Vol"]]];
  function tileHTML(i) {
    var ex = W.exchanges[i.ex] || {}, st = status(ex, Date.now());
    return '<div class="wmt" data-wid="' + i.id + '"><div class="wmt-h">' + fl(i.cc, 12) + ' <b title="' + esc(i.sym) + '">' + esc(i.name) + '</b><span class="wst ' + st + '">' + SLAB[st] + "</span></div>" +
      '<div class="wmt-v"><b data-tick="w-' + i.id + '">' + last(i) + "</b>" + spark(i.spark) + "</div>" +
      '<div class="wmt-c">' + (i.kind === "price" ? '<span class="' + cl(i.chg) + '">' + sg(i.chg, i.dec) + "</span> · " : "") + chgCell(i) + "</div>" +
      '<div class="wmt-r">' + range52(i) + '<div class="wbs">' + badges(i) + "</div></div>" +
      '<div class="wmt-f">' + age(i) + "</div></div>";
  }
  function marketsHTML() {
    var q = (V.q || "").toLowerCase(), list = inst().filter(function (i) {
      return (V.grp === "all" || i.group === V.grp) && (!V.flagged || (i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low))) &&
        (!q || (i.name + " " + i.sym + " " + i.region).toLowerCase().indexOf(q) >= 0);
    });
    var filt = '<div class="wfil"><input type="search" placeholder="Search markets…" value="' + esc(V.q) + '" data-wq></div>';   /* group / 52-week chips live only in the slicer row above the body */
    var VIEWSW = '<span class="wv-sw"><button type="button" data-wview="tiles" aria-pressed="' + (V.view !== "table") + '">Tiles</button><button type="button" data-wview="table" aria-pressed="' + (V.view === "table") + '">Feed</button></span>';
    if (V.view === "table") {
      var tb = GROUPS.filter(function (g) { return V.grp === "all" || V.grp === g; }).map(function (g) {
        var rows = list.filter(function (i) { return i.group === g; }); if (!rows.length) return "";
        return '<tr class="wgh"><td colspan="9">' + ({ Indices: "Equity indices", FX: "Currencies" }[g] || g) + " " + asOf(rows) + "</td></tr>" + rows.map(rowHTML).join(""); }).join("");
      return '<div class="tile wide"><h2>All markets <span class="h2note">— market feed view</span></h2>' + asOf(list, "blk") + '<div class="wv-bar">' + filt + VIEWSW + "</div>" +
        '<div class="wtw"><table class="wt"><thead><tr><th>Market</th><th>Status · source time</th><th class="r">LTP</th><th class="r">Chg</th><th class="r">% Chg</th><th class="r">High</th><th class="r">Low</th><th>52-week range</th><th>30d</th></tr></thead><tbody>' +
        (tb || '<tr><td colspan="9" class="neu">No markets match the filter.</td></tr>') + "</tbody></table></div></div>";
    }
    var body = QUADS.map(function (Q) {
      var gs = Q[1].filter(function (g) { return V.grp === "all" || V.grp === g; }); if (!gs.length) return "";
      var rows = list.filter(function (i) { return gs.indexOf(i.group) >= 0; });
      if (gs.indexOf("Indices") >= 0) rows.sort(function (a, b) { return ["Asia-Pacific", "Europe", "Americas"].indexOf(a.region) - ["Asia-Pacific", "Europe", "Americas"].indexOf(b.region); });
      if (!rows.length) return "";
      return '<section class="wq4"><h3>' + Q[0] + " <small>" + rows.length + "</small> " + asOf(rows) + '</h3><div class="wmt-g">' + rows.map(tileHTML).join("") + "</div></section>";
    }).join("");
    return '<div class="tile wide"><h2>All markets <span class="h2note">— last price, change, 52-week position · exact source time (Toronto) and age on every tile</span></h2>' + asOf(list, "blk") + '<div class="wv-bar">' + filt + VIEWSW + "</div>" +
      '<div class="wq4-g">' + (body || '<p class="neu">No markets match the filter.</p>') + "</div>" +
      '<div class="stamp">LTP = last traded/quoted price · % change vs the previous official close (yields and spreads in basis points) · 52-week range from daily highs/lows · badges: NEW 52W HIGH/LOW when today’s range breaks the prior 52-week extreme, “% from” when within 5% · sparkline = last 30 days</div></div>';
  }
  (function () { var c = document.createElement("style"); c.textContent =
    ".wv-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.wv-sw{display:inline-flex;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden}.wv-sw button{all:unset;cursor:pointer;padding:4px 12px;font:500 12px 'Libre Franklin',system-ui,sans-serif;color:#8a8a8a}.wv-sw button[aria-pressed=true]{color:#d9b46a!important;background:rgba(217,180,106,.1)!important}.wv-sw button+button{border-left:1px solid #2a2a2a}" +
    ".wq4-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:10px}.wq4{border:1px solid #1f1f1f;border-radius:8px;padding:10px 12px;min-width:0}" +
    ".wq4 h3{margin:0 0 10px;font:600 12.5px 'Libre Franklin',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.wq4 h3 small{color:#8a8a8a;font-weight:500}.wq4 h3 .wasof{text-transform:none;letter-spacing:0;font-weight:400}" +
    ".wmt-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.wmt-r *{font-size:9.5px!important}" +
    ".wmt{border:1px solid #1f1f1f;border-radius:6px;padding:8px 10px;background:#000;min-width:0;display:flex;flex-direction:column;gap:3px}.wmt:hover{border-color:#3a3a3a}" +
    ".wmt-h{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}.wmt-h b{font-weight:600;color:#e8eef4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.wmt-h .wst{flex:0 0 auto;font-size:9.5px}" +
    ".wmt-v{display:flex;align-items:center;justify-content:space-between;gap:6px}.wmt-v b{font:500 18px 'JetBrains Mono','IBM Plex Mono',monospace;color:#fff}.wmt-v .wsp{width:56px;height:16px;flex:0 0 auto}" +
    ".wmt-c{font:12px 'JetBrains Mono','IBM Plex Mono',monospace}.wmt-r{font-size:10.5px;min-width:0;overflow:hidden}.wmt-r .wbs:empty{display:none}.wmt-f{font-size:10.5px;color:#777}" +
    "@media (max-width:1100px){.wq4-g{grid-template-columns:1fr}}@media (max-width:760px){.wmt-g{grid-template-columns:repeat(2,minmax(0,1fr))}}";
    document.head.appendChild(c); })();
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
    return '<div class="tile wide"><h2>Global sessions <span class="h2note">— today on Toronto time · bars = regular hours (lighter = overnight/extended, amber = lunch or daily break) · white line = now</span></h2>' + '<span class="wasof blk">live clock · ' + new Date().toLocaleString("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET · statuses recomputed every minute</span>" +
      '<div class="sgrid"><div></div><div class="shrs">' + hours + "</div><div></div>" + rows + "</div>" +
      '<div class="stamp">Hours from each exchange’s published regular session in local time (daylight-saving handled per time zone) · exchange holidays are not in a calendar: a scheduled-open market with no fresh bars is shown as “no trading today (holiday?)” in the data column · FX trades 24/5 (Sun 5 pm – Fri 5 pm New York) · CME Globex has a daily 4–5 pm CT break</div></div>';
  }
  function zonedMs(y, mo, d, h, mi, tz) { if (typeof window.zonedMs === "function") return window.zonedMs(y, mo, d, h, mi, tz); var g = Date.UTC(y, mo - 1, d, h, mi), p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(g)).forEach(function (x) { p[x.type] = +x.value; }); return g - (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - g); }
  function moverRow(i) { return '<div class="mv">' + fl(i.cc, 12) + ' <span class="mvn">' + esc(i.name) + "</span>" + chgCell(i) + '<span class="mvl">' + last(i) + "</span></div>"; }

  /* 52-week watch: two sides (highs | lows), each grouped by asset class, nearest first */
  function w52WatchHTML(L) {
    function side(hi) {
      var xs = L.filter(function (i) { var w = i.w52; return w && (hi ? (w.new_high || (w.near_high && w.pos >= 50)) : (w.new_low || (w.near_low && w.pos < 50))) && !(hi && w.new_low) && !(!hi && w.new_high); });   /* one market sits on one list only */
      var dist = function (i) { return hi ? (i.w52.new_high ? -1 : i.w52.pct_from_high) : (i.w52.new_low ? -1 : i.w52.pct_from_low); };
      var body = GROUPS.map(function (g) {
        var r = xs.filter(function (i) { return i.group === g; }).sort(function (a, b) { return dist(a) - dist(b); });
        if (!r.length) return "";
        return '<div class="w5g"><div class="w5gh">' + ({ Indices: "Equity indices", FX: "Currencies" }[g] || g) + "<small>" + asOf(r) + " · " + r.length + "</small></div>" + r.map(function (i) {
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
    return '<div class="tile wide"><h2>52-week watch <span class="h2note">— markets at or within 5% of their 52-week high or low, by asset class · bar = how close (full = at the extreme)</span></h2>' + asOf(L, "blk") + '<div class="w5">' + side(true) + side(false) + "</div></div>";
  }
  /* BR-WM-1: one count of open venues, computed once and used everywhere */
  function openCount(now) { var ex = (W && W.exchanges) || {}; return Object.keys(ex).filter(function (k) { var s = status(ex[k], now); return s === "open" || s === "extended"; }).length; }
  /* World at a glance (BRD s.14): built only from data the tab already carries; the full section stays underneath */
  var DESK = ["usdcad", "dxy", "corn", "wheat", "soy", "wti", "brent", "gold", "usca2y", "usca10y", "spx", "vix"], CLK = ["HKEX", "LSE", "NYSE", "TSX", "CBOT", "FX"];
  function sessionDay(iso) { return new Date(Date.parse(iso) + 6 * 36e5).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }   /* evening trade after 6 pm ET belongs to the next session */
  function moves() {   /* BR-WM-2: one row per market per session, Major and above, arrow from the sign of the move */
    var best = {}; (W.alerts || []).forEach(function (a) { if (a.tier < 2) return; var k = a.id + "|" + sessionDay(a.at), b = best[k];
      if (!b || a.tier > b.tier || (a.tier === b.tier && Math.abs(a.move) > Math.abs(b.move))) best[k] = a; });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.tier - a.tier || Math.abs(b.move) - Math.abs(a.move); });
  }
  /* Desk-first tiles mirror the desk's own numbers, so a price never reads differently on two tabs:
     grains = front-contract settlement, or the newer delayed quote the fan chart uses; WTI / Brent = the desk's energy read */
  var GMAP = { corn: "corn", wheat: "wheat", soy: "soybeans" }, EMAP = { wti: /^WTI/, brent: /^Brent/ };
  function deskSync(i) {
    var D = window.DATA; if (!D) return i; var o = Object.assign({}, i);
    if (GMAP[i.id] && D.grains && D.grains[GMAP[i.id]]) { var g = D.grains[GMAP[i.id]], R = g.roll && g.roll[0]; if (!R || R.settle == null) return i;
      var q = g.quotes && g.quotes[R.contract], qd = q && q.ts ? new Date(q.ts).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) : "", useQ = q && q.px != null && (qd > (R.settle_date || "") || (qd === R.settle_date && Math.abs(q.px - R.settle) > 1e-9));
      var px = useQ ? q.px : R.settle, pv = useQ ? R.settle : R.prev; o.last = px * 100; o.dec = 2; o.ts = useQ ? q.ts : (D.meta.asof.grains_settle || i.ts);
      if (pv) { o.chg = (px - pv) * 100; o.pct = (px / pv - 1) * 100; } o.name = i.name + " · " + R.contract; return o; }
    if (i.id === "usdcad") { var L = window.DESK_LIVE && window.DESK_LIVE.feedState && window.DESK_LIVE.feedState(), lt = L && L.lastTick, fm = D.fx && D.fx.feed;
      var px2 = L && L.last && lt && lt > Date.parse(i.ts || 0) ? L.last : fm && fm.mid && Date.parse(fm.ts) > Date.parse(i.ts || 0) ? fm.mid : null;
      var ref = D.fx && D.fx.spot && D.fx.spot.ref ? +D.fx.spot.ref : i.prev_close;   // one prior close everywhere: the desk's reference close
      if (px2 == null && ref !== i.prev_close) px2 = i.last;
      if (px2 && ref) { o.last = px2; o.prev_close = ref; o.chg = px2 - ref; o.pct = (px2 / ref - 1) * 100; o.ts = lt && L.last === px2 ? new Date(lt).toISOString() : fm && px2 === fm.mid ? fm.ts : i.ts; } return o; }
    if (EMAP[i.id]) { var E = ((D.fx && D.fx.energy) || []).filter(function (e) { return EMAP[i.id].test(e.name); })[0]; if (!E || E.last == null) return i;
      o.last = E.last; o.chg = E.chg; o.pct = E.pct; o.ts = D.meta.asof.energy || i.ts; return o; }
    return i;
  }
  function deskTile(i) {
    var e = W.exchanges[i.ex], st = e ? status(e, Date.now()) : null, closed = st === "closed" || st === "pre";
    return '<button type="button" class="wh-t' + (V.hl && V.hl === i.ex ? " hl" : "") + '" data-whl="' + esc(i.ex || "") + '"><span class="wh-n">' + esc(i.name.replace(/ \((CBOT|COMEX|NYMEX|ICE) fut\.\)/, "")) + '</span><span class="wh-v">' + (window.QTFMT && i.last != null && i.kind !== "yield" && i.kind !== "spread" ? '<span class="qt-box' + (i.pct > 0 ? " tk-up-s" : i.pct < 0 ? " tk-dn-s" : "") + '"><span class="qt-v">' + window.QTFMT(i.last, i.dec) + "</span></span>" : last(i)) + "</span>" + chgCell(i) +
      '<small>' + (closed && i.ts ? "Last close " + new Date(i.ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Toronto" }) : age(i)) + "</small></button>";
  }
  function heroHTML() {
    var L = inst(), now = Date.now(), by = {}; L.forEach(function (i) { by[i.id] = i; });
    var ex = W.exchanges, clocks = CLK.filter(function (k) { return ex[k]; }).map(function (k) { var e = ex[k], st = status(e, now), nx = nextChange(e, now);
      return '<button type="button" class="wh-c' + (V.hl === k ? " hl" : "") + '" data-whl="' + k + '"><b>' + esc(e.city === "Chicago" && k === "CBOT" ? "CBOT" : k === "FX" ? "FX" : e.city) + '</b> <span class="wst ' + st + '">' + SLAB[st] + "</span>" + (nx ? ' <small>' + (nx.opening ? "opens" : "closes") + ' in <span class="countdown" data-t="' + nx.t + '">' + ago(nx.t - now) + "</span></small>" : "") + "</button>"; }).join("");
    var idx = L.filter(function (i) { return i.group === "Indices" && i.pct != null; }), up = idx.filter(function (i) { return i.pct > 0; }).length;
    var reg = ["Americas", "Europe", "Asia-Pacific"].map(function (r) { var xs = idx.filter(function (i) { return i.region === r; }); return xs.length ? [r, xs.reduce(function (a, i) { return a + i.pct; }, 0) / xs.length] : null; }).filter(Boolean);
    var px = L.filter(function (i) { return i.kind === "price" && i.pct != null && !/^vix/.test(i.id); }).sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); }).slice(0, 3);
    var M = moves(), maj = (W.alerts || []).filter(function (a) { return a.tier >= 2; }).length;
    var rest = GROUPS.map(function (g) { var xs = L.filter(function (i) { return i.group === g && DESK.indexOf(i.id) < 0; }); return xs.length ? '<div class="wh-g"><b>' + g + "</b>" + xs.map(function (i) { return '<span class="wh-r' + (V.hl && V.hl === i.ex ? " hl" : "") + '">' + esc(i.name) + " " + chgCell(i) + "</span>"; }).join("") + "</div>" : ""; }).join("");
    var H = W.health || {}, miss = (H.failed || []).length, run = tDate(W.updated_at);
    var obs = [(up > idx.length / 2 ? "Risk-on" : up < idx.length / 2 ? "Risk-off" : "Split") + " session: " + up + " of " + idx.length + " indices up. " + reg.map(function (r) { return r[0] + " " + sg(r[1], 2, "%"); }).join(", ") + ".",
      "Biggest moves: " + px.map(function (i) { return i.name.replace(/ \(.*\)/, "") + " " + sg(i.pct, 2, "%"); }).join(", ") + "."];
    return '<div class="tile wide wh"><h2>World at a glance <span class="h2note">' + openCount(now) + " of " + Object.keys(ex).length + " venues open · tap a venue to light up its markets</span></h2>" +
      '<div class="wh-clk">' + clocks + "</div>" +
      '<div class="wh-main"><div><h3>Desk first</h3><div class="wh-desk">' + DESK.map(function (id) { return by[id] ? deskTile(deskSync(by[id])) : ""; }).join("") + "</div>" +
      '<h3>Regions</h3><div class="wh-reg">' + reg.map(function (r) { return '<span>' + r[0] + ' <b class="' + cl(r[1]) + '">' + sg(r[1], 2, "%") + "</b></span>"; }).join("") + "</div>" +
      '<details class="wh-rest"><summary>Everything else (' + L.filter(function (i) { return DESK.indexOf(i.id) < 0; }).length + " markets)</summary>" + rest + "</details>" +
      '<div class="obs-box"><b>OBSERVATIONS</b><ul>' + obs.map(function (o) { return "<li>" + esc(o) + "</li>"; }).join("") + "</ul></div></div>" +
      '<div class="wh-mv"><h3>What moved <small>Major and above · ' + M.length + " moves from " + maj + " alert rows</small></h3>" + (M.length ? M.slice(0, 14).map(function (a) { var u = a.move > 0;   /* arrow, colour and sign all come from the printed move */
        return '<div class="wh-m"><span class="' + (u ? "up" : "dn") + '">' + (u ? "▲" : "▼") + " " + sg(a.move, 2, a.unit === "bp" ? " bp" : "%") + "</span> <b>" + esc(a.name) + '</b> <span class="sev s' + a.tier + '">' + esc(a.severity) + "</span><small>" + tDate(a.at) + " ET</small></div>"; }).join("") : '<p class="note">No Major moves this session.</p>') + "</div></div>" +
      '<details class="wh-hb"><summary>Data health: ' + (H.ok || 0) + " of " + (H.expected || 0) + " returned · last run " + run + " ET" + (miss ? " · " + miss + " missing" : "") + "</summary><p>" +
      (miss ? (H.failed || []).map(function (f) { return esc(String(f.id).toUpperCase()); }).join(", ") + " did not return on the last run; every other market updated normally." : "Every market returned on the last run.") + "</p>" +
      (miss ? '<details><summary>Technical detail</summary><pre>' + (H.failed || []).map(function (f) { return esc(f.id + " · " + f.error); }).join("\n") + "</pre></details>" : "") + "</details>" +
      '<details class="wh-hb"><summary>How to read</summary><p>Moves are against the previous close unless an alert says session open. Severity tiers: Watch 1%, Major 2%, Extreme 3%, Exceptional 5% (yields 5/10/15/25 bp). A closed market shows its last close with its date, never a day range.</p></details></div>';
  }
  function overviewHTML() {
    var L = inst(), px = L.filter(function (i) { return i.kind === "price" && i.pct != null && !/^vix/.test(i.id); });
    var up = px.slice().sort(function (a, b) { return b.pct - a.pct; }), dn = px.slice().sort(function (a, b) { return a.pct - b.pct; });
    var idx = L.filter(function (i) { return i.group === "Indices" && i.pct != null; }), adv = idx.filter(function (i) { return i.pct > 0; }).length;
    var g = function (id) { return L.filter(function (i) { return i.id === id; })[0]; }, k = function (id, lab) { var i = g(id); return i ? '<div class="kpi"><div class="kpi-k">' + lab + '</div><div class="kpi-v">' + last(i) + '</div><div class="kpi-s">' + chgCell(i) + '</div><div class="kpi-t">' + age(i) + "</div></div>" : ""; };
    var regs = ["Asia-Pacific", "Europe", "Americas"].map(function (r) {
      var xs = idx.filter(function (i) { return i.region === r; }), av = xs.length ? xs.reduce(function (s, i) { return s + i.pct; }, 0) / xs.length : null;
      return '<div class="reg"><div class="regh">' + r + ' <span class="' + cl(av) + '">' + sg(av, 2, "%") + "</span></div>" + '<div class="regts">' + asOf(xs) + "</div>" + xs.map(moverRow).join("") + "</div>";
    }).join("");
    var w52 = L.filter(function (i) { return i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low); })
      .sort(function (a, b) { return (b.w52.new_high || b.w52.new_low) - (a.w52.new_high || a.w52.new_low); });
    /* the headline strip (breadth, S&P, DXY, VIX, gold, WTI) and the raw alert rows were removed: World at a glance above carries them (owner OK, Nov 7) */
    return '' +
      '<div class="tile"><h2>Biggest gainers <span class="h2note">— % vs previous close</span></h2>' + asOf(up.slice(0, 6), "blk") + up.slice(0, 6).map(moverRow).join("") + "</div>" +
      '<div class="tile"><h2>Biggest decliners <span class="h2note">— % vs previous close</span></h2>' + asOf(dn.slice(0, 6), "blk") + dn.slice(0, 6).map(moverRow).join("") + "</div>" +
      '<div class="tile wide"><h2>Regional equity performance <span class="h2note">— average index move by region, latest session</span></h2><div class="regs">' + regs + "</div></div>" +
      w52WatchHTML(L);
  }
  function alertRows(list) {
    return '<div class="wtw"><table class="wt wa"><thead><tr><th>Time (ET)</th><th>Market</th><th>Move</th><th>Severity</th><th>Compared with</th><th>Reference → current</th><th>Data</th><th>Delivery</th></tr></thead><tbody>' +
      list.map(function (a) { return "<tr><td>" + tDate(a.at) + "</td><td><b>" + esc(a.name) + "</b><small> " + esc(a.group || "") + '</small></td><td class="' + (a.move > 0 ? "up" : a.move < 0 ? "dn" : "") + '"><b>' + sg(a.move, 2, a.unit === "bp" ? " bp" : "%") + "</b></td>" +
        '<td><span class="sev s' + a.tier + '">' + esc(a.severity) + (a.kind === "escalation" ? " · escalated" : "") + "</span></td><td>" + (a.basis === "prev_close" ? "Previous close" : "Session open") + "</td><td>" + nf(a.ref, 4) + " → " + nf(a.last, 4) + "</td>" +
        "<td><small>" + esc(a.status || "") + (a.delay_min != null ? " · " + nf(a.delay_min, 0) + " min old" : "") + "</small></td><td><small>" + esc(a.delivery || "") + "</small></td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function alertsHTML() {
    var list = (W.alerts || []).filter(function (a) { return V.sev === "all" || (V.sev === "major" ? a.tier >= 2 : V.sev === "up" ? a.move > 0 : V.sev === "down" ? a.move < 0 : true); });
    var t = W.thresholds || {};
    return '<div class="tile wide"><h2>Alert feed <span class="h2note">— ' + (W.alerts || []).length + " stored · tiers " + (t.pct || []).map(function (x, k) { return (t.names || [])[k] + " ±" + x + "%"; }).join(", ") + " (yields " + (t.bp || []).join("/") + " bp)</span></h2>" + '<span class="wasof blk">server engine last ran ' + tDate(W.updated_at) + " ET (" + ago(Date.now() - Date.parse(W.updated_at)) + " ago)" + ((W.alerts || [])[0] ? " · newest alert " + tDate(W.alerts[0].at) + " ET" : "") + "</span>" +
      '<div class="wfil">' +   /* severity chips live only in the slicer row above the body */
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
  var WTHEME = { overview: "#38b6c9", sessions: "#6ea8ff", markets: "#e8b93d", alerts: "#ff8a84", health: "#3fb97f", guide: "#9aa8bb" };
  /* report-first (Nov 2026): the 6 sections are top tabs; the filter children that used to expand under
     the left nav now live in one slicer row (#wSlicer) beneath the tabs. Same buttons, same attributes. */
  function headsData() {
    var L = inst(), now = Date.now(), ex = (W && W.exchanges) || {}, al = (W && W.alerts) || [];
    var openN = openCount(now);
    var sig = L.filter(function (i) { return i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low); }).length;
    var H = (W && W.health) || {};
    return [
      ["overview", "Overview", "movers · regions · 52-week"],
      ["sessions", "Sessions", W ? openN + " of " + Object.keys(ex).length + " venues open now" : ""],
      ["markets", "Markets", W ? L.length + " instruments · " + sig + " 52-week signals" : ""],
      ["alerts", "Alerts", W ? al.length + " stored · " + al.filter(function (a) { return a.tier >= 2; }).length + " major+" : ""],
      ["health", "Data health", W ? (H.ok || 0) + " / " + (H.expected || 0) + " returned" : ""],
      ["guide", "Guide", "what each view is for"]];
  }
  function kid(attr, val, on, lab, n) { return '<button class="sn-b" ' + attr + '="' + val + '" aria-pressed="' + on + '"><span>' + esc(lab) + "</span>" + (n != null ? "<small>" + n + "</small>" : "") + "</button>"; }
  function kids(id) {
    var L = inst(), al = (W && W.alerts) || [];
    if (!W) return "";
    if (id === "markets") {
      var sig = L.filter(function (i) { return i.w52 && (i.w52.new_high || i.w52.new_low || i.w52.near_high || i.w52.near_low); }).length;
      return kid("data-wgrp", "all", V.grp === "all" && !V.flagged, "All markets", L.length) +
        GROUPS.map(function (g) { return kid("data-wgrp", g, V.grp === g && !V.flagged, g, L.filter(function (i) { return i.group === g; }).length); }).join("") +
        kid("data-wflag", "1", V.flagged, "52-week signals only", sig);
    }
    if (id === "alerts") return [["all", "All alerts", al.length], ["major", "Major and above", al.filter(function (a) { return a.tier >= 2; }).length], ["up", "Upward", al.filter(function (a) { return a.move > 0; }).length], ["down", "Downward", al.filter(function (a) { return a.move < 0; }).length]]
      .map(function (x) { return kid("data-wsev", x[0], V.sev === x[0], x[1], x[2]); }).join("");
    return "";
  }
  function tabsHTML() {
    return headsData().map(function (h) {
      var on = V.sub === h[0];
      return '<button type="button" role="tab" data-wsub="' + h[0] + '" aria-selected="' + on + '"><b>' + h[1] + "</b>" + (h[2] ? "<small>" + esc(h[2]) + "</small>" : "") + "</button>";
    }).join("");
  }
  function slicerHTML() {
    if (V.sub === "markets") return kids("markets");
    if (V.sub === "alerts") return kids("alerts");
    return "";
  }
  function ctxHTML() {
    var lab = { overview: "Overview", sessions: "Sessions", markets: "Markets", alerts: "Alerts", health: "Data health", guide: "Guide" }[V.sub] || "Overview";
    var sec = V.sub === "markets" ? (V.flagged ? "52-week signals only" : V.grp === "all" ? "All markets" : V.grp) : V.sub === "alerts" ? ({ all: "All alerts", major: "Major and above", up: "Upward", down: "Downward" }[V.sev] || "") : "";
    return '<span class="sc-pill"><i></i>' + lab + "</span>" + (sec ? '<span class="sc-sec">› ' + esc(sec) + "</span>" : "") + refreshHTML() + (typeof window.kbSwitchHTML === "function" ? window.kbSwitchHTML() : "");
  }

  /* server refresh clock: the scheduler dispatches world-markets at :07 :22 :37 :52 UTC, Sun–Fri (UTC); a run publishes ~2–3 min later */
  var LAND_MS = 150000;
  function nextRun(now) {
    var t = new Date(now); t.setUTCSeconds(0, 0);
    for (var k = 0; k < 4 * 24 * 60; k++) {
      var c = new Date(t.getTime() + k * 60000), d = c.getUTCDay();
      if (c.getUTCMinutes() % 15 === 7 && d !== 6 && c.getTime() + LAND_MS > now) return c.getTime();
    }
    return null;
  }
  function refreshHTML() {
    var now = Date.now(), nr = nextRun(now); if (!nr) return "";
    var land = nr + LAND_MS, age = W ? now - Date.parse(W.updated_at) : null, weekend = new Date(now).getUTCDay() === 6;
    var late = W && !weekend && age > 22 * 60000;
    var hm = function (ms) { return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }); };
    return '<span class="wrefresh' + (late ? " late" : "") + '" title="Server engine runs every 15 min (:07, :22, :37, :52 UTC) Sunday–Friday; new data lands about 2–3 minutes after each run starts. This page checks for it every minute while open.">' +
      (late ? "server refresh overdue · last data " + ago(age) + " old · " : "") + "next server refresh ~" + hm(land) + " ET in " +
      '<span class="countdown" data-t="' + land + '" data-fmt="hms">' + (window.hmsText ? window.hmsText(land - now) : ago(land - now)) + "</span></span>";
  }
  function guideHTML() {
    var M = (window.KB && window.KB.menus && window.KB.menus.world) || {};
    return '<div class="tile wide kb-guide"><h2>Guide — World markets <span class="h2note">— what each view answers and where to click</span></h2>' +
      '<p class="kbg-d">This tab watches equity indices, currencies, metals, energy, ags, government yields and the VIX around the clock. A server engine refreshes the data every 15 minutes (Sunday–Friday) and records alerts even while this page is closed; every number shows its source time.</p>' +
      '<div class="kbg-list">' + ["overview", "sessions", "markets", "alerts", "health"].map(function (k) { var m = M[k] || {};
        return '<div class="kbg-i" style="--sa:' + WTHEME[k] + '"><div><b>' + esc(m.t || k) + "</b><p>" + esc(m.d || "") + "</p>" + (m.q ? "<small>Answers: " + m.q.map(esc).join(" · ") + "</small>" : "") + '</div><button class="kbg-go" data-wsub="' + k + '">Open →</button></div>'; }).join("") +
      '</div><div class="stamp">Tip: turn on the Knowledge bank switch (top bar) to see an explanation inside every card</div></div>';
  }
  function kbDecorateW(B) {
    var K = window.KB && window.KB.world; if (!K) return;
    [].forEach.call(B.querySelectorAll(".tile"), function (t) {
      if (t.querySelector(":scope>.kbox")) return;
      var h = t.querySelector(":scope>h2"), key = h ? h.childNodes[0].textContent.trim() : (t.classList.contains("kpi-strip") ? "Index breadth" : "");
      var e = K[key]; if (!e || !window.kbBox) return;
      var w = document.createElement("div"); w.innerHTML = window.kbBox(e); var box = w.firstChild;
      if (h) h.after(box); else t.insertBefore(box, t.firstChild);
    });
  }
  function render() {
    var P = document.getElementById("panel-world"); if (!P) return;
    if (!P.querySelector("#wHead")) P.innerHTML = '<div class="world wlay"><div class="wmain"><div class="tile wide subnav-tile"><div class="subctx" id="wCtx"></div><div id="wHead"></div></div><div class="w-tabs" id="wTabs" role="tablist" aria-label="World sections"></div><div class="w-slicer" id="wSlicer" role="group" aria-label="Section filter"></div><div class="grid" id="wBody"></div></div></div>';
    P.style.setProperty("--sa", WTHEME[V.sub] || "#38b6c9");
    P.querySelector(".wlay").setAttribute("data-subt", V.sub);
    paintHead();
    document.getElementById("wTabs").innerHTML = tabsHTML();
    var _sl = document.getElementById("wSlicer"), _sh = slicerHTML();
    _sl.innerHTML = _sh; _sl.style.display = _sh ? "" : "none";
    document.getElementById("wCtx").innerHTML = ctxHTML();
    var B = document.getElementById("wBody");
    if (!W) { B.innerHTML = err ? '<div class="tile wide"><div class="unreach">\u26a0 Sorry, we can\u2019t be reached now <small>\u2014 global market data did not load; retrying every minute</small></div></div>' : '<div class="tile wide"><p class="note">Loading global market data…</p></div>'; return; }
    B.innerHTML = V.sub === "guide" ? guideHTML() : V.sub === "sessions" ? sessionsHTML() : V.sub === "markets" ? marketsHTML() : V.sub === "alerts" ? alertsHTML() : V.sub === "health" ? healthHTML() : heroHTML() + overviewHTML();
    kbDecorateW(B);
    if (window.MOTION) window.MOTION.scan();
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t || !t.closest("#panel-world")) return;
    var hb = t.closest("[data-whl]"); if (hb) { var x = hb.getAttribute("data-whl"); V.hl = V.hl === x ? null : x; render(); return; }
    var b = t.closest("[data-wsub]"); if (b) { V.sub = b.getAttribute("data-wsub"); save(); render(); return; }
    b = t.closest("[data-wview]"); if (b) { V.view = b.getAttribute("data-wview"); save(); render(); return; }
    b = t.closest("[data-wgrp]"); if (b) { V.grp = b.getAttribute("data-wgrp"); V.flagged = false; save(); render(); return; }   /* slicer: a group pick clears the 52-week filter, as the old nav did */
    b = t.closest("[data-wflag]"); if (b) { V.flagged = true; V.grp = "all"; save(); render(); return; }
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
  function needed() { var U = document.getElementById("panel-earnings"); return active() || (U && U.classList.contains("active")); }   /* US Market reads this feed too */
  setInterval(function () { if (!window.DESK_LOCKED && (needed() || Date.now() - lastTry > 600000)) poll(); }, 5000);   /* poll() itself throttles to 1 min (15 s after a failure) */
  setInterval(function () { if (active()) { paintHead(); var cx = document.getElementById("wCtx"); if (cx) cx.innerHTML = ctxHTML(); if (W && Date.now() > nextRun(Date.parse(W.updated_at) + 60000) + LAND_MS) poll(true); if (W && (V.sub === "sessions" || ((V.sub === "overview" || V.sub === "markets") && !(document.activeElement && document.activeElement.matches && document.activeElement.matches("[data-wq]"))))) render(); } }, 60000);   /* keep source-time ages current */
  window.addEventListener("desk:unlock", function () { poll(true); });
  document.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("#tabbtn-world"); if (b) { render(); poll(); } });
  var raW = window.renderAll; if (typeof raW === "function") window.renderAll = function () { var r = raW.apply(this, arguments); try { if (active() && W) render(); } catch (e) {} return r; };   /* desk data changed: Desk-first tiles follow */
  window.WORLD = { poll: poll, render: render, status: status, flag: fl, _data: function () { return W; }, _err: function () { return err; }, _lastOk: function () { return lastOk; } };
  render(); if (window.DESK_LOCKED === false) poll(true);
})();
