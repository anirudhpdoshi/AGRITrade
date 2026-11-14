/* earn-lock.js — Earnings lock (US Markets). A user locks up to 3 stocks a day; the desk then checks SEC EDGAR (through the
   AGRITrade SEC Worker) every 2 minutes for that company's earnings 8-K (Item 2.02). When it is filed today:
     · the press release (exhibit 99.1) is read in this browser and an earnings card is built and highlighted,
     · the lock is released (the slot frees up); the card stays until midnight ET or until it is closed,
     · locking a stock that already reported today rebuilds its card straight away.
   Only sourced sections are shown: actual vs expected (estimates only where a published consensus exists), the company's
   own guidance and highlight sentences quoted verbatim, and past next-session price reactions. Nothing is estimated or invented.
   Nothing is stored on a server; the locks and today's cards live in this browser only. */
(function (root) {
  "use strict";
  var doc = root.document, KEY = "desk.earnLocks", MAX = 3, POLL_MS = 120000, TZ = "America/New_York";
  var DEFAULT_WORKER = "https://agritrade-sec.anirudh-p-doshi.workers.dev";
  function worker() { try { var w = localStorage.getItem("desk.secWorker"); return w === "off" ? "" : w || DEFAULT_WORKER; } catch (e) { return DEFAULT_WORKER; } }
  function esc(s) { return DeskCore.esc(s); }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
  function dayOf(iso) { return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) : null; }
  function et(iso, o) { return iso ? new Date(iso).toLocaleString("en-US", Object.assign({ timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, o || {})) + " ET" : "—"; }

  /* ---------------- state (per browser, per ET day) ---------------- */
  var S = load();
  function load() { var s = null; try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {} if (!s || s.day !== today()) s = { day: today(), syms: [], cards: {}, closed: [], names: {}, err: {}, checked: {} }; return s; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function roll() { if (S.day !== today()) { S = load(); save(); paint(); } }
  function msg(t) { S.msg = t; S.msgAt = Date.now(); }

  /* ---------------- network (worker) ---------------- */
  function getJ(path) { var w = worker(); if (!w) return Promise.reject(new Error("company data service not configured"));
    return fetch(w + path, { cache: "no-store" }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; }); }); }

  /* ---------------- press-release reader (port of scripts/pr_parse.py, same rules) ---------------- */
  var LINES = [["rev", /^(total )?(net sales|net revenues?|revenues?|total revenues?|total net sales|total net revenues?|sales)$/],
    ["cogs", /^(total )?cost of (sales|revenues?|goods sold)$/], ["gp", /^(total )?gross (margin|profit)$/],
    ["opinc", /^(total )?(operating income( \(loss\))?|income( \(loss\))? from operations|operating profit)$/],
    ["ni", /^net (income|earnings)( \(loss\))?( attributable to [\w\s.,&'’()-]+)?$/]];
  var GAAP_EPS = /(diluted (net )?(earnings|income|eps)|(earnings|income|eps).{0,40}\bper diluted|\bdiluted eps\b|^(gaap|reported)\W.{0,12}(diluted )?eps|^total diluted (earnings|income)|per (common )?share.{0,20}diluted)/i;
  var ADJ_EPS = /(adjusted|non-gaap|excluding special items|ex(\.|cluding)? items|core).{0,40}(eps|per (diluted |common )?share)|(eps|per share).{0,20}(excluding special items|adjusted)/i;
  var BAD_EPS = /basic|weighted|shares outstanding|impact|^less\b|dividend|par value|treasury|authorized|discontinued/i;
  /* forward-looking words only: a sentence about the year just reported is not guidance */
  var GUIDE = /\b(outlook|guidance|guides?|expects?|expected to|anticipates?|forecasts?|projects?|reaffirm\w*|raises?|raised|lowers?|lowered|narrow\w*|initiat\w* (?:its )?(?:fiscal|full)|for the (?:coming|next) (?:quarter|year))\b/i;
  var HIGH = /\b(record|increased?|decreased?|grew|growth|up \d|down \d|declined?|rose|fell|margin|demand|volumes?|segment)\b/i;
  var BOILER = /forward-looking statements|safe harbor|non-gaap financial measures? (?:are|is)|webcast|conference call|replay|investor relations|about [A-Z]|www\.|press release/i;
  function num(c) { c = c.replace(/\$/g, "").replace(/,/g, "").replace(/[—–]/g, "").trim(); var neg = /^\(/.test(c) || /\)$/.test(c); c = c.replace(/^[()\s]+|[()\s]+$/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(c || "x")) return null; var v = parseFloat(c); return neg ? -v : v; }
  function rowOf(r) { var lab = ""; for (var i = 0; i < r.length; i++) { if (r[i] && num(r[i]) === null && !/^[$%()\s]*$/.test(r[i])) { lab = r[i]; break; } }
    var ns = r.map(num).filter(function (x) { return x !== null; }); return [lab.replace(/^[\s:]+|[\s:]+$/g, "").toLowerCase(), ns]; }
  function readTables(html) {
    html = String(html).replace(/<(\/p|\/div|br|\/li|\/h\d|\/td|\/th|\/tr)\b[^>]*>/gi, "$& ");   /* keep paragraphs apart so sentences split cleanly */
    var d = new DOMParser().parseFromString(html, "text/html"), T = [], pre = [], buf = "";
    /* text that precedes each table (statement headers such as "(in millions, except per-share amounts)" usually sit just above it) */
    (function walk(n) { for (var c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3) buf = (buf + " " + c.nodeValue).slice(-600); else if (c.nodeType === 1) { if (c.tagName === "TABLE") { pre.push(buf.replace(/\s+/g, " ").toLowerCase()); buf = ""; } else walk(c); } } })(d.body || d);
    [].forEach.call(d.querySelectorAll("table"), function (t) { var rows = [];
      [].forEach.call(t.querySelectorAll("tr"), function (tr) { var cells = [].map.call(tr.querySelectorAll("td,th"), function (c) { return (c.textContent || "").replace(/\s+/g, " ").trim(); });
        if (cells.some(Boolean)) rows.push(cells); }); T.push(rows); });
    [].forEach.call(d.querySelectorAll("table"), function (t) { t.remove(); });
    var prose = (d.body ? d.body.innerText || d.body.textContent : "").replace(/\s+/g, " ");
    return { tables: T, pre: pre, text: (d.body ? d.body.textContent : "").replace(/\s+/g, " ").toLowerCase(), prose: prose };
  }
  /* the FIRST unit phrase wins: "(in millions, except shares, which are in thousands)" is millions */
  function unitOf(t) { var m = /in (thousands|millions|billions|dollars)/.exec(t || ""); return m ? { thousands: 1e3, millions: 1e6, billions: 1e9, dollars: 1 }[m[1]] : 0; }
  function yearsCol(T) { var yrs = []; for (var i = 0; i < Math.min(6, T.length); i++) { T[i].forEach(function (c) { (c.match(/\b(20\d\d)\b/g) || []).forEach(function (y) { yrs.push(+y); }); }); if (yrs.length >= 2) break; }
    return yrs.length >= 2 && yrs[1] > yrs[0] ? 1 : 0; }
  function quotes(text) {
    var S2 = text.slice(0, 60000).split(/(?<=[.!?])\s+(?=[A-Z“"])/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 40 && x.length <= 320 && !BOILER.test(x); });
    var g = S2.filter(function (x) { return GUIDE.test(x) && /\d/.test(x); }).slice(0, 3);
    var h = S2.slice(0, 80).filter(function (x) { return HIGH.test(x) && /\d/.test(x) && g.indexOf(x) < 0; }).slice(0, 3);
    return { guidance: g, highlights: h };
  }
  function parsePR(html) {
    var P = readTables(html), out = {}, py = {};
    for (var t = 0; t < P.tables.length; t++) {
      var T = P.tables[t], rows = T.map(rowOf), labels = rows.map(function (r) { return r[0]; }).join(" | ");
      if (!/net income|net earnings/.test(labels) || !/revenue|net sales|sales/.test(labels)) continue;
      var tt = T.map(function (r) { return r.filter(Boolean).join(" "); }).join(" ").toLowerCase();
      var head = T.slice(0, 3).map(function (r) { return r.join(" "); }).join(" ").toLowerCase();
      var mult = unitOf(head) || unitOf(P.pre[t] || "") || unitOf(tt) || unitOf(P.text.slice(0, 20000)) || 1e6;
      var col = yearsCol(T), pyc = col === 1 ? 0 : 1, inEps = false, totalRev = null;
      rows.forEach(function (r, ri) { var lab = r[0], raw = r[1], ns = raw.length > col ? raw.slice(col) : raw, prior = raw.length > Math.max(col, pyc) ? raw[pyc] : null;
        /* summary tables write the unit in the cell ("$ | 17.3 | billion") */
        var cellU = T[ri].join(" ").toLowerCase(), um = /\bbillion\b/.test(cellU) ? 1e9 : /\bmillion\b/.test(cellU) ? 1e6 : mult;
        if (!ns.length) { inEps = inEps || /(earnings|income|net income).*per (common )?share/.test(lab); return; }
        LINES.forEach(function (L) { if (out[L[0]] === undefined && L[1].test(lab)) { out[L[0]] = ns[0] * um; if (prior !== null) py[L[0]] = prior * um;
          if (L[0] === "rev" && /^total/.test(lab)) { totalRev = ns[0] * um; if (prior !== null) py.rev_total = prior * um; } } });
        if (totalRev) { out.rev = totalRev; if (py.rev_total !== undefined) py.rev = py.rev_total; }
        if (/per (common )?share/.test(lab)) inEps = true;
        if (out.eps_d === undefined && (inEps || /per share/.test(lab)) && /^(diluted|diluted earnings per share|.*per share.*diluted|diluted net income per share)$/.test(lab) && Math.abs(ns[0]) < 1000) {
          out.eps_d = ns[0]; if (prior !== null && Math.abs(prior) < 1000) py.eps_d = prior; } });
      if (out.rev && out.ni !== undefined) break;
    }
    P.tables.forEach(function (T) { var col = yearsCol(T);
      T.forEach(function (r) { var x = rowOf(r), lab = x[0], raw = x[1]; if (BAD_EPS.test(lab)) return;
        /* rows such as "adjusted net earnings and adjusted diluted EPS | 858 | 1.77 | 448 | 0.92" mix dollars and per-share values: keep the per-share ones */
        if (/earnings|income/.test(lab) && /eps|per share/.test(lab) && raw.some(function (v) { return Math.abs(v) >= 100; })) raw = raw.filter(function (v) { return Math.abs(v) < 100; });
        if (raw.length <= col || Math.abs(raw[col]) >= 1000) return;
        var prior = raw.length > 1 ? raw[1 - col] : null;
        if (out.eps_adj === undefined && ADJ_EPS.test(lab)) { out.eps_adj = raw[col]; if (prior !== null && Math.abs(prior) < 1000) py.eps_adj = prior; }
        else if (out.eps_d === undefined && GAAP_EPS.test(lab) && !ADJ_EPS.test(lab)) { out.eps_d = raw[col]; if (prior !== null && Math.abs(prior) < 1000) py.eps_d = prior; } }); });
    delete py.rev_total;
    if (py.rev && py.gp === undefined && py.cogs !== undefined) py.gp = py.rev - py.cogs;
    ["rev", "ni", "eps_d", "eps_adj", "opinc", "gp"].forEach(function (k) { if (out[k] != null && py[k]) out[k + "_yoy"] = py[k] > 0 ? Math.round((out[k] / py[k] - 1) * 1000) / 10 : null; });
    out.py = {}; ["rev", "ni", "eps_d", "eps_adj", "opinc", "gp"].forEach(function (k) { if (py[k] != null) out.py[k] = py[k]; });
    out.quotes = quotes(P.prose);
    if (out.rev && (out.rev > 4e11 || out.rev < 1e6)) return { quotes: out.quotes, unread: true };
    if (out.rev && out.gp === undefined && out.cogs !== undefined) out.gp = out.rev - out.cogs;
    if (out.rev) { if (out.gp != null) out.gm = Math.round(out.gp / out.rev * 1e4) / 100; if (out.opinc != null) out.opm = Math.round(out.opinc / out.rev * 1e4) / 100; if (out.ni != null) out.nm = Math.round(out.ni / out.rev * 1e4) / 100; }
    if (out.py.rev) { if (out.py.gp != null) out.py.gm = Math.round(out.py.gp / out.py.rev * 1e4) / 100; if (out.py.opinc != null) out.py.opm = Math.round(out.py.opinc / out.py.rev * 1e4) / 100; }
    return out;
  }

  /* ---------------- facts for a card ---------------- */
  function estimateFor(sym, day) {   /* published consensus from the desk's earnings calendar (one market-wide call) — never invented */
    var J = root.EARNINGS && EARNINGS._data && EARNINGS._data(), C = J && J.calendar;
    var r = C && (C.rows || []).filter(function (x) { return x.symbol === sym && x.date === day; })[0];
    return r ? { eps: r.epsEstimated != null ? +r.epsEstimated : null, rev: r.revenueEstimated != null ? +r.revenueEstimated : null, time: r.time || null, at: C.fetched_at } : null;
  }
  function reactions(rel, px) {   /* next-session close-to-close move after each past release */
    var T = px && px.ticker && px.ticker.ts; if (!T || !T.length) return [];
    var idx = {}; T.forEach(function (x, i) { idx[x[0]] = i; });
    return rel.slice(0, 9).map(function (r) {
      var a = r.accepted || (r.filed + "T21:00:00Z"), d = dayOf(a), h = +new Date(a).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }), m = +new Date(a).toLocaleString("en-US", { timeZone: TZ, minute: "numeric" });
      var pre = h < 9 || (h === 9 && m < 30);
      var i = idx[d]; if (i == null) { for (var k = 0; k < T.length; k++) if (T[k][0] > d) { i = k; pre = true; break; } }
      if (i == null) return null;
      var j = pre ? i : i + 1; if (j >= T.length || j < 1) return null;
      return { filed: r.filed, accn: r.accn, from: T[j - 1][0], to: T[j][0], mv: (T[j][1] / T[j - 1][1] - 1) * 100 };
    }).filter(Boolean);
  }
  function build(sym, rel, all) {
    return Promise.all([getJ("/exhibit?t=" + encodeURIComponent(sym) + "&acc=" + encodeURIComponent(rel.accn)), getJ("/prices?r=5y&t=" + encodeURIComponent(sym)).catch(function () { return null; })])
      .then(function (x) {
        var pr = parsePR(x[0].html || ""), day = dayOf(rel.accepted) || rel.filed;
        var R = reactions(all.releases.filter(function (r) { return r.accn !== rel.accn; }), x[1]).slice(0, 8);
        S.cards[sym] = { s: sym, n: all.name, ex: all.exchange, accn: rel.accn, filed: rel.filed, accepted: rel.accepted, filing: rel.url, exhibit: x[0].url, period: rel.period,
          pr: pr, est: estimateFor(sym, day), reac: R, pxsrc: x[1] && x[1].provider, built: new Date().toISOString(), fresh: true };
        S.syms = S.syms.filter(function (s) { return s !== sym; });   /* results are out: the lock is released */
        S.closed = S.closed.filter(function (s) { return s !== sym; });
        save(); announce(sym); paint();
      });
  }
  function check(sym) {
    return getJ("/filings?t=" + encodeURIComponent(sym)).then(function (j) {
      S.names[sym] = j.name || S.names[sym]; S.checked[sym] = new Date().toISOString(); delete S.err[sym];
      var rel = (j.releases || []).filter(function (r) { return dayOf(r.accepted) === S.day || r.filed === S.day; })[0];
      save();
      if (rel && (!S.cards[sym] || S.cards[sym].accn !== rel.accn)) return build(sym, rel, j);
      paint();
    }).catch(function (e) { S.err[sym] = String(e && e.message || e); save(); paint(); });
  }
  function pollAll() { roll(); if (doc.hidden || root.DESK_LOCKED) return; S.syms.forEach(function (s, i) { setTimeout(function () { check(s); }, i * 1500); }); }

  /* ---------------- actions ---------------- */
  function lock(sym, name) {
    roll(); sym = String(sym || "").toUpperCase(); if (!sym) return;
    if (name) S.names[sym] = name;
    if (S.cards[sym]) { S.closed = S.closed.filter(function (s) { return s !== sym; }); S.cards[sym].fresh = true; save(); paint(); return; }   /* reported today: show the card again */
    if (S.syms.indexOf(sym) >= 0) return;
    if (S.syms.length >= MAX) { msg("You can lock at most " + MAX + " stocks at a time for earnings today. Release one first."); paint(); return; }
    S.syms.push(sym); save(); paint(); check(sym);
  }
  function unlock(sym) { S.syms = S.syms.filter(function (s) { return s !== sym; }); save(); paint(); }
  function closeCard(sym) { if (S.closed.indexOf(sym) < 0) S.closed.push(sym); save(); paint(); }
  function announce(sym) {
    var c = S.cards[sym]; if (!c) return;
    if (root.GNAV) GNAV.paint();
    if (root.EVENTS && EVENTS.log) EVENTS.log("alert", "<b>[EARNINGS] " + esc(sym) + " results released</b> — SEC 8-K filed " + esc(et(c.accepted)) + ". Open US Markets for the card.", "earnings", "elock|" + sym + "|" + c.accn, Date.parse(c.accepted) || Date.now());
  }

  /* ---------------- card ---------------- */
  function money(v) { if (v == null) return "—"; var a = Math.abs(v), s = v < 0 ? "−$" : "$"; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? s + (a / 1e6).toFixed(1) + "M" : s + a.toLocaleString("en-US"); }
  function eps(v) { return v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2); }
  function pc(v, d) { if (v == null || !isFinite(v)) return "—"; return '<span class="' + (v > 0.05 ? "up" : v < -0.05 ? "dn" : "") + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%</span>"; }
  function pp(v) { if (v == null || !isFinite(v)) return "—"; return '<span class="' + (v > 0.05 ? "up" : v < -0.05 ? "dn" : "") + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " pp</span>"; }
  function surp(a, e) { return a != null && e != null && e !== 0 ? (a / Math.abs(e) - (e < 0 ? -1 : 1)) * 100 * (e < 0 ? 1 : 1) : null; }
  function verdict(c) {
    var p = c.pr, E = c.est || {}, parts = [];
    var es = p.eps_adj != null && E.eps != null ? (p.eps_adj - E.eps) / Math.abs(E.eps) * 100 : null, rs = p.rev != null && E.rev != null ? (p.rev / E.rev - 1) * 100 : null;
    function w(x) { return Math.abs(x) < 1 ? "IN LINE" : x > 0 ? "BEAT" : "MISS"; }
    if (es != null) parts.push("EPS " + w(es)); if (rs != null) parts.push("REVENUE " + w(rs));
    var tone = !parts.length ? "na" : parts.every(function (x) { return /BEAT/.test(x); }) ? "g" : parts.every(function (x) { return /MISS/.test(x); }) ? "r" : "a";
    return { txt: parts.length ? parts.join(" · ") : "RESULTS OUT — NO PUBLISHED CONSENSUS TO COMPARE", tone: tone, es: es, rs: rs };
  }
  function reacSVG(R) {
    if (!R.length) return '<p class="ec-na">No price history available for past releases.</p>';
    var L = R.slice().reverse(), W = 640, H = 120, mx = Math.max.apply(null, L.map(function (r) { return Math.abs(r.mv); })) || 1, bw = W / L.length, z = H / 2;
    return '<svg viewBox="0 0 ' + W + " " + (H + 22) + '" width="100%" style="max-width:760px;display:block" font-family="IBM Plex Sans, sans-serif" role="img" aria-label="Next-session price move after each past release"><line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="var(--line2)"/>' +
      L.map(function (r, i) { var h = Math.abs(r.mv) / mx * (H / 2 - 8), x = i * bw + bw * 0.25, y = r.mv >= 0 ? z - h : z;
        return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.5).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" fill="' + (r.mv >= 0 ? "#3fb97f" : "#e0655f") + '"><title>Filed ' + r.filed + ": " + r.from + " → " + r.to + " " + (r.mv > 0 ? "+" : "") + r.mv.toFixed(1) + "%</title></rect>" +
          '<text x="' + (x + bw * 0.25).toFixed(1) + '" y="' + (r.mv >= 0 ? y - 4 : y + h + 12).toFixed(1) + '" fill="var(--muted)" font-size="11" text-anchor="middle">' + (r.mv > 0 ? "+" : "") + r.mv.toFixed(1) + "%</text>" +
          '<text x="' + (x + bw * 0.25).toFixed(1) + '" y="' + (H + 16) + '" fill="var(--muted)" font-size="11" text-anchor="middle">' + new Date(r.filed + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '") + "</text>"; }).join("") + "</svg>";
  }
  function cardHTML(c) {
    var p = c.pr || {}, E = c.est || {}, V = verdict(c), py = p.py || {};
    var rows = [["EPS (adjusted)", eps(p.eps_adj), E.eps != null && p.eps_adj != null ? eps(E.eps) : "—", V.es != null ? pc(V.es) : "—", py.eps_adj != null ? eps(py.eps_adj) : "—", p.eps_adj_yoy != null ? pc(p.eps_adj_yoy) : "—", p.eps_adj != null],
      ["EPS (GAAP diluted)", eps(p.eps_d), '<span class="ec-na" title="Consensus is on the adjusted basis">n/a</span>', "—", py.eps_d != null ? eps(py.eps_d) : "—", p.eps_d_yoy != null ? pc(p.eps_d_yoy) : "—", p.eps_d != null],
      ["Revenue", money(p.rev), E.rev != null ? money(E.rev) : "—", V.rs != null ? pc(V.rs) : "—", money(py.rev), p.rev_yoy != null ? pc(p.rev_yoy) : "—", p.rev != null],
      ["Gross margin", p.gm != null ? p.gm.toFixed(1) + "%" : "—", "—", "—", py.gm != null ? py.gm.toFixed(1) + "%" : "—", p.gm != null && py.gm != null ? pp(p.gm - py.gm) : "—", p.gm != null],
      ["Operating margin", p.opm != null ? p.opm.toFixed(1) + "%" : "—", "—", "—", py.opm != null ? py.opm.toFixed(1) + "%" : "—", p.opm != null && py.opm != null ? pp(p.opm - py.opm) : "—", p.opm != null],
      ["Net income", money(p.ni), "—", "—", money(py.ni), p.ni_yoy != null ? pc(p.ni_yoy) : "—", p.ni != null]].filter(function (r) { return r[6]; });
    var R = c.reac || [], dn = R.filter(function (r) { return r.mv < 0; }).length, med = R.length ? R.map(function (r) { return r.mv; }).sort(function (a, b) { return a - b; })[Math.floor(R.length / 2)] : null;
    var Q = p.quotes || {};
    return '<article class="ec" data-ec="' + esc(c.s) + '"><header class="ec-h"><span class="ec-tk">' + esc(c.s) + '</span><div class="ec-nm"><b>' + esc(c.n || "") + "</b><small>Earnings released · " + esc(et(c.accepted)) + " (SEC 8-K Item 2.02)" + (c.period ? " · report date " + esc(c.period) : "") + "</small></div>" +
      '<span class="ec-out">● EARNINGS OUT</span><button class="ec-x" data-ecclose="' + esc(c.s) + '" title="Close the card for today" aria-label="Close">✕</button></header>' +
      '<div class="ec-v ' + V.tone + '">' + esc(V.txt) + "</div>" +
      '<div class="ec-g"><section class="ec-s"><h4>Actual vs expected</h4>' + (rows.length ? '<div class="tbl-scroll"><table class="ec-t"><thead><tr><th></th><th>Actual</th><th>Consensus</th><th>vs cons.</th><th>Year ago</th><th>YoY</th></tr></thead><tbody>' +
        rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td><b>" + r[1] + "</b></td><td>" + r[2] + "</td><td>" + r[3] + "</td><td>" + r[4] + "</td><td>" + r[5] + "</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="ec-na">The income-statement table in this release could not be read reliably, so no figures are shown. Open the release below.</p>') +
        '<p class="ec-src">Actuals: company press release (exhibit 99.1), unaudited. Consensus: ' + (E.at ? "earnings calendar, fetched " + esc(et(E.at)) : "none published for this company on the desk") + ". Consensus EPS is on the adjusted basis, so GAAP EPS is not compared.</p></section>" +
      '<section class="ec-s"><h4>Guidance &amp; outlook <small>quoted from the release</small></h4>' + (Q.guidance && Q.guidance.length ? "<ul>" + Q.guidance.map(function (x) { return "<li>“" + esc(x) + "”</li>"; }).join("") + "</ul>" : '<p class="ec-na">No outlook sentence with a number in this release.</p>') +
        '<h4 style="margin-top:10px">Management highlights <small>quoted</small></h4>' + (Q.highlights && Q.highlights.length ? "<ul>" + Q.highlights.map(function (x) { return "<li>“" + esc(x) + "”</li>"; }).join("") + "</ul>" : '<p class="ec-na">None found.</p>') + "</section></div>" +
      '<section class="ec-s"><h4>Historical reaction · last ' + R.length + " releases <small>next-session close vs prior close</small></h4>" + reacSVG(R) +
        (R.length ? '<p class="ec-src">' + dn + " of " + R.length + " fell the next session · median " + (med > 0 ? "+" : "") + med.toFixed(1) + "%. Prices: " + esc(c.pxsrc || "daily closes") + ". Past reactions describe history; they are not a forecast.</p>" : "") + "</section>" +
      '<footer class="ec-f">Sources: <a href="' + esc(c.filing) + '" target="_blank" rel="noopener">SEC 8-K ' + esc(c.accn) + '</a> · <a href="' + esc(c.exhibit) + '" target="_blank" rel="noopener">press release (exhibit 99.1)</a> · built ' + esc(et(c.built)) + " · analyst revisions, options-implied moves and scenario probabilities are not shown (no verifiable source).</footer></article>";
  }
  function lockBar() {
    var L = S.syms, n = L.length;
    return '<div class="el-bar"><b>Earnings lock</b> <span class="el-n">' + n + "/" + MAX + " today</span>" +
      (n ? L.map(function (s) { return '<span class="el-chip" title="' + esc(S.err[s] ? "Last check failed: " + S.err[s] : S.checked[s] ? "Checked " + et(S.checked[s]) : "Checking…") + '"><i class="el-dot' + (S.err[s] ? " bad" : "") + '"></i>' + esc(s) + ' <button data-elunlock="' + esc(s) + '" aria-label="Release ' + esc(s) + '">✕</button></span>'; }).join("") +
        '<small class="el-note">checking SEC filings every 2 min · the lock releases itself when results are out</small>' : '<small class="el-note">Lock up to ' + MAX + " stocks to be alerted the moment their results are filed today.</small>") +
      (S.msg && Date.now() - S.msgAt < 8000 ? '<span class="el-msg">' + esc(S.msg) + "</span>" : "") + "</div>";
  }
  function html() {
    roll();
    var C = Object.keys(S.cards).filter(function (s) { return S.closed.indexOf(s) < 0; }).map(function (s) { return S.cards[s]; }).sort(function (a, b) { return Date.parse(b.accepted || 0) - Date.parse(a.accepted || 0); });
    return lockBar() + C.map(cardHTML).join("");
  }
  function paint() {
    var u = doc.getElementById("usm"), host = doc.getElementById("ecHost");
    if (!u) return;
    if (!host) { host = doc.createElement("div"); host.id = "ecHost"; var b = doc.getElementById("usmXb"); if (!b) return; b.after(host); }
    host.innerHTML = html();
    if (root.GNAV) GNAV.paint();
    if (root.USMNAV && USMNAV.paint) USMNAV.paint();
  }
  doc.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-ellock]"); if (b) { lock(b.getAttribute("data-ellock"), b.getAttribute("data-eln")); return; }
    b = t.closest("[data-elunlock]"); if (b) { unlock(b.getAttribute("data-elunlock")); return; }
    b = t.closest("[data-ecclose]"); if (b) { closeCard(b.getAttribute("data-ecclose")); return; }
  });
  setInterval(pollAll, POLL_MS);
  root.addEventListener("desk:unlock", function () { setTimeout(pollAll, 1500); });
  (function boot(n) { if (doc.getElementById("usmXb")) { paint(); setTimeout(pollAll, 1200); return; } if (n > 0) setTimeout(function () { boot(n - 1); }, 500); })(60);

  var css = doc.createElement("style");
  css.textContent =
    "#ecHost{flex:1 1 100%;order:9;display:flex;flex-direction:column;gap:10px;min-width:0}" +
    ".el-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--muted)}.el-bar b{color:#fff}.el-n{font-family:'IBM Plex Mono',monospace}" +
    ".el-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(232,185,61,.55);border-radius:999px;padding:2px 4px 2px 9px;color:#fff;font:700 12px 'IBM Plex Mono',monospace}.el-chip button{background:none;border:0;color:var(--muted);cursor:pointer}" +
    ".el-dot{width:7px;height:7px;border-radius:50%;background:#e8b93d;animation:elp 1.4s ease-in-out infinite}.el-dot.bad{background:var(--red);animation:none}@keyframes elp{50%{opacity:.3}}.el-note{color:var(--faint)}.el-msg{color:#e8b93d;font-weight:600}" +
    ".ec{border:1px solid rgba(232,185,61,.7);border-radius:12px;background:var(--panel);padding:14px 16px;box-shadow:0 0 0 3px rgba(232,185,61,.12);animation:ecIn .5s ease}@keyframes ecIn{from{box-shadow:0 0 0 10px rgba(232,185,61,.35)}}" +
    ".ec-h{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ec-tk{background:#1f5fd1;color:#fff;font:800 18px 'IBM Plex Mono',monospace;border-radius:7px;padding:3px 9px}.ec-nm{flex:1;min-width:200px}.ec-nm b{display:block;font-size:18px;color:#fff}.ec-nm small{color:var(--muted);font-size:12.5px}" +
    ".ec-out{color:#e8b93d;font:800 12px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;border:1.5px solid #e8b93d;border-radius:999px;padding:5px 12px}.ec-x{background:none;border:0;color:var(--muted);font-size:16px;cursor:pointer}" +
    ".ec-v{margin:12px 0;text-align:center;font:800 22px 'IBM Plex Sans',sans-serif;letter-spacing:.03em;border-radius:9px;padding:10px;border:1.5px solid}.ec-v.g{color:#3fb97f;border-color:rgba(63,185,127,.6);background:rgba(63,185,127,.08)}.ec-v.r{color:#e0655f;border-color:rgba(224,101,95,.6);background:rgba(224,101,95,.08)}.ec-v.a,.ec-v.na{color:#e8b93d;border-color:rgba(232,185,61,.6);background:rgba(232,185,61,.08)}.ec-v.na{font-size:15px}" +
    ".ec-g{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.ec-s{border:1px solid var(--line);border-radius:9px;padding:10px 12px;min-width:0}.ec-s h4{margin:0 0 6px;font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.ec-s h4 small{text-transform:none;letter-spacing:0;font-weight:500}" +
    ".ec-s ul{margin:0;padding-left:16px}.ec-s li{font-size:13px;line-height:1.45;margin-bottom:5px}.ec-t{width:100%;border-collapse:collapse;font-size:13px}.ec-t th{font:600 10.5px 'IBM Plex Sans',sans-serif;text-transform:uppercase;color:var(--muted);text-align:right;padding:4px 6px}.ec-t td{text-align:right;padding:5px 6px;border-top:1px solid var(--line);white-space:nowrap}.ec-t td:first-child,.ec-t th:first-child{text-align:left}" +
    ".ec-src{font-size:11.5px;color:var(--muted);margin:6px 0 0}.ec-na{color:var(--faint);font-size:12.5px}.ec-f{font-size:11.5px;color:var(--muted);margin-top:8px}.ec-f a{color:#38b6c9}" +
    "@media (max-width:760px){.ec-t{display:table!important;font-size:12px}.ec-t thead{display:table-header-group!important}.ec-t tbody{display:table-row-group!important}.ec-t tr{display:table-row!important}.ec-t td,.ec-t th{display:table-cell!important;padding:4px 5px}.ec-t td::before{content:none!important}.ec-g{grid-template-columns:1fr}.ec-v{font-size:17px}}";
  doc.head.appendChild(css);
  function hasFresh() { return Object.keys(S.cards).some(function (s) { return S.closed.indexOf(s) < 0 && S.cards[s].fresh; }); }
  /* the highlight clears once the card has been on screen for a few seconds */
  setInterval(function () { var h = doc.getElementById("ecHost"); if (!h || !h.offsetParent || doc.hidden || !hasFresh()) return;
    Object.keys(S.cards).forEach(function (s) { if (S.closed.indexOf(s) < 0) S.cards[s].fresh = false; }); save(); if (root.GNAV) GNAV.paint(); }, 6000);
  root.ELOCK = { hasFresh: hasFresh, lock: lock, unlock: unlock, state: function () { return S; }, parsePR: parsePR, check: check, paint: paint, MAX: MAX };
})(window);
