/* US Market tracker shell (Glass Cockpit blueprint), Phase 1. Preview-only until sign-off:
     open  …/AGRITrade/?preview=tracker   close  …/AGRITrade/?preview=off   (remembered in this browser)
   Without the flag this file does nothing and the US Earnings tab is untouched.
   The existing page is not rewritten: #panel-earnings is moved into the C6 workspace and keeps its own logic and id.
   Zones here: A command bar, B category rail, C index tiles, D workspace, E inspector, G tape. F dock arrives in a later phase.
   Data: world.json, earnings.json and the live earnings board, all already loaded by the desk. No new network calls. */
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
    return '<div class="usm-t" data-usmi="' + esc(i.id) + '" role="button" tabindex="0"><div class="n">' + esc(SHORT[s]) + badge(i) + '</div><div class="v">' + num(i.last, dec(i)) + '</div><div class="c ' + dirCls(i.chg) + '">' + move(i) + "</div>" + range(i) + "</div>";
  }
  function table(title, rows, note) {
    rows = rows.filter(Boolean); if (!rows.length) return "";
    return '<section class="usm-card"><h3>' + esc(title) + (note ? " <small>" + esc(note) + "</small>" : "") + '</h3><div class="usm-tw"><table class="usm-tb"><thead><tr><th>Name</th><th>Last</th><th>Change</th><th>Day range</th><th>State</th></tr></thead><tbody>' +
      rows.map(function (i) { return '<tr data-usmi="' + esc(i.id) + '" tabindex="0"><td>' + esc(i.name) + "</td><td>" + num(i.last, dec(i)) + (i.kind === "yield" ? "%" : "") + '</td><td class="' + dirCls(i.chg) + '">' + move(i) + "</td><td>" + range(i) + "</td><td>" + badge(i) + "</td></tr>"; }).join("") + "</tbody></table></div></section>";
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
  /* -------- C6: calendar & estimate matrix -------- */
  var C6 = { sub: "cal", per: "q", state: "all", wl: false, day: null, wk: 0, sort: "date", dir: 1 }, sel = null;
  try { C6.wl = localStorage.getItem("desk.usmWl") === "1"; } catch (e) {}
  function E() { return window.EARNINGS && EARNINGS._data ? EARNINGS._data() : null; }
  function nyDay(d) { return new Date(d || Date.now()).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  function records() {
    var J = E(), M = {}; if (!J) return [];
    function rec(s, d) { var k = s + "|" + d; return M[k] || (M[k] = { s: s, date: d }); }
    var names = (J.sp500 && J.sp500.rows) || {};
    ((J.calendar && J.calendar.rows) || []).forEach(function (r) { var x = rec(r.symbol, r.date);
      x.epsE = r.epsEstimated; x.revE = r.revenueEstimated; x.epsA = r.epsActual; x.revA = r.revenueActual; x.epsP = r.eps_surprise_pct; x.revP = r.rev_surprise_pct; x.upd = r.lastUpdated; x.seen = r.seen_at; if (r.time) x.time = r.time; });
    var D = (J.sp_schedule && J.sp_schedule.days) || {};
    Object.keys(D).forEach(function (d) { D[d].forEach(function (y) { var x = rec(y.s, d);
      x.n = y.n; x.time = y.time || x.time; x.fq = y.fq; x.ests = y.ests; x.mcap = y.mcap; x.ly = y.ly_eps; if (x.epsE == null) x.epsE = y.eps_f; }); });
    var B = window.DESK_EARN_BOARD; ((B && B.items) || []).forEach(function (i) { if (!i.slot) return; var x = rec(i.s, i.slot.slice(0, 10)), p = i.pr || {}, a = i.adj || {}, e = i.est || {}, f = i.filing || {};
      x.n = x.n || i.n; x.time = i.time || x.time; x.fq = x.fq || i.fq; x.mcap = x.mcap || i.mcap; x.board = i.status;
      if (x.epsE == null) x.epsE = e.eps; if (x.revE == null) x.revE = e.rev || a.rev_est;
      if (x.revA == null) { x.revA = p.rev != null ? p.rev : a.rev; x.revP = i.rev_pct != null ? i.rev_pct : a.rev_pct; }
      if (x.epsA == null) { var adj = p.eps_adj != null ? p.eps_adj : a.eps != null ? a.eps : i.av ? i.av.eps : null;
        if (adj != null) { x.epsA = +adj; x.epsP = i.eps_pct != null ? i.eps_pct : a.eps_pct; }
        else if (p.eps_d != null) { x.epsA = p.eps_d; x.gaap = true; } }
      x.filed = f.at; x.url = f.url; x.yoy = p.rev_yoy; x.hl = p.quotes && (p.quotes.highlights || [])[0]; x.guide = p.quotes && (p.quotes.guidance || [])[0]; });
    return Object.keys(M).map(function (k) { var x = M[k]; if (!x.n) x.n = names[x.s] || ""; x.done = x.epsA != null || x.revA != null; x.w = (J.watchlist || []).indexOf(x.s) >= 0; return x; });
  }
  function median(a) { a = a.slice().sort(function (p, q) { return p - q; }); var n = a.length; return !n ? null : n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
  function money(v) { return v == null ? "—" : Math.abs(v) >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : Math.abs(v) >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : "$" + (v / 1e6).toFixed(0) + "M"; }
  function sess(t) { return t === "bmo" ? "Before open" : t === "amc" ? "After close" : "Time not confirmed"; }
  function outcome(x, today) {
    if (!x.done) return x.date < today ? '<span class="usm-b dl">Awaiting</span>' : '<span class="usm-b cl">Scheduled</span>';
    if (x.epsP == null) return '<span class="usm-b cl">' + (x.gaap ? "GAAP only" : "No consensus") + "</span>";
    return Math.abs(x.epsP) < 1 ? '<span class="usm-b cl">In line</span>' : x.epsP > 0 ? '<span class="usm-b up">Beat</span>' : '<span class="usm-b dn">Miss</span>';
  }
  function seasonRead(R) {
    var P2 = R.filter(function (x) { return x.epsP != null; });
    if (!P2.length) return '<section class="usm-card usm-gl"><span class="usm-b na">Unavailable</span><p>No reported results with a comparable consensus yet.</p></section>';
    var v = P2.map(function (x) { return x.epsP; }), med = median(v), rv = median(R.filter(function (x) { return x.revP != null; }).map(function (x) { return x.revP; })),
        bt = v.filter(function (a) { return a >= 1; }).length, ms = v.filter(function (a) { return a <= -1; }).length, S = P2.slice().sort(function (a, b) { return b.epsP - a.epsP; }), hi = S[0], lo = S[S.length - 1];
    return '<section class="usm-card usm-gl"><div class="h"><h3>Season read: median EPS surprise</h3><span class="usm-b cl">' + P2.length + ' results in view</span></div><div class="big ' + dirCls(med) + '">' + sg(med, 1, "%") + "</div>" +
      '<div class="usm-rd"><div><b>Magnitude</b>Revenue median ' + sg(rv, 1, "%") + "</div><div><b>Breadth</b>" + bt + " beat · " + (v.length - bt - ms) + " in line · " + ms + ' miss</div><div><b>Driver</b>Largest beat ' + esc(hi.s) + " " + sg(hi.epsP, 1, "%") + " · largest miss " + esc(lo.s) + " " + sg(lo.epsP, 1, "%") + "</div></div></section>";
  }
  function addD(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function calendar(R, today) {
    var dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, st = addD(today, -dow + (C6.wk - 1) * 7), C = {}, h = "";
    R.forEach(function (x) { var c = C[x.date] || (C[x.date] = { n: 0, d: 0 }); c.n++; if (x.done) c.d++; });
    for (var w = 0; w < 4; w++) { h += '<div class="wk">' + new Date(addD(st, w * 7) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + "</div>";
      for (var i = 0; i < 5; i++) { var d = addD(st, w * 7 + i), c = C[d];
        h += '<button class="dy' + (d === today ? " tdy" : "") + (d === C6.day ? " on" : "") + '"' + (c ? ' data-usmday="' + d + '"' : " disabled") + ' aria-label="' + d + (c ? ", " + c.n + " companies, " + c.d + " reported" : ", none") + '"><span>' + (+d.slice(8)) + "</span>" + (c ? "<b>" + c.n + "</b><small>" + (c.d ? c.d + " in" : "") + "</small>" : "") + "</button>"; } }
    return '<section class="usm-card"><div class="usm-rowh"><h3>Reporting calendar</h3><span><button class="usm-mini" data-usmwk="-1" aria-label="Earlier weeks">‹</button><button class="usm-mini" data-usmwk="1" aria-label="Later weeks">›</button></span></div>' +
      '<div class="usm-cal"><div class="wk"></div>' + ["Mon", "Tue", "Wed", "Thu", "Fri"].map(function (d) { return '<div class="hd">' + d + "</div>"; }).join("") + h + "</div></section>";
  }
  function matrix(R, today) {
    var key = { sym: function (x) { return x.s; }, date: function (x) { return x.date; }, eps: function (x) { return x.epsP == null ? -1e9 : x.epsP; }, rev: function (x) { return x.revP == null ? -1e9 : x.revP; }, mcap: function (x) { return x.mcap || 0; } }[C6.sort];
    var L = R.filter(function (x) { return (!C6.day || x.date === C6.day) && (C6.state === "all" || (C6.state === "done") === x.done); })
      .sort(function (a, b) { var A = key(a), B = key(b); return (A > B ? 1 : A < B ? -1 : (b.mcap || 0) - (a.mcap || 0)) * C6.dir; });
    function th(k, t) { return '<th><button data-usmsort="' + k + '">' + t + (C6.sort === k ? (C6.dir > 0 ? " ▲" : " ▼") : "") + "</button></th>"; }
    function seg(k, v, t) { return '<button data-usm' + k + '="' + v + '"' + (C6[k] === v ? ' aria-pressed="true"' : "") + ">" + t + "</button>"; }
    var sym = sel && sel.t === "s" ? sel.k : null;
    return '<section class="usm-card"><div class="usm-rowh"><h3>Estimate matrix <small>' + L.length + (C6.day ? " on " + esc(C6.day) + ' <button class="usm-mini" data-usmday="">clear</button>' : "") + '</small></h3><span class="usm-seg">' + seg("state", "all", "All") + seg("state", "done", "Reported") + seg("state", "up", "Upcoming") + "</span></div>" +
      (L.length ? '<div class="usm-tw"><table class="usm-tb usm-mx"><thead><tr>' + th("sym", "Symbol") + th("date", "Date") + "<th>Session</th><th>Quarter</th><th>EPS est</th><th>EPS act</th>" + th("eps", "EPS surp") + "<th>Rev est</th><th>Rev act</th>" + th("rev", "Rev surp") + th("mcap", "Mkt cap") + "<th>Result</th></tr></thead><tbody>" +
        L.map(function (x) { return '<tr data-usms="' + esc(x.s) + "|" + esc(x.date) + '" tabindex="0"' + (sym === x.s ? ' class="on"' : "") + '><td title="' + esc(x.n) + '"><b>' + esc(x.s) + "</b></td><td>" + esc(x.date.slice(5)) + "</td><td>" + (x.time === "bmo" ? "BMO" : x.time === "amc" ? "AMC" : "—") + "</td><td>" + esc(x.fq || "—") + "</td><td>" + (x.epsE == null ? "—" : num(x.epsE, 2)) + "</td><td>" + (x.epsA == null ? "—" : num(x.epsA, 2) + (x.gaap ? "<small> GAAP</small>" : "")) + '</td><td class="' + dirCls(x.epsP) + '">' + sg(x.epsP, 1, "%") + "</td><td>" + money(x.revE) + "</td><td>" + money(x.revA) + '</td><td class="' + dirCls(x.revP) + '">' + sg(x.revP, 1, "%") + "</td><td>" + money(x.mcap) + "</td><td>" + outcome(x, today) + "</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="usm-none">No companies match this filter.</p>') + "</section>";
  }
  function c6View() {
    if (C6.sub === "intel") return "";
    if (C6.per === "fy") return '<section class="usm-card usm-hold"><span class="usm-b na">Unavailable</span><h3>Fiscal-year estimates</h3><p>Annual consensus isn’t in the verified data yet, so no figures are shown. Each company’s reported annual results are in Intelligence.</p></section>';
    if (!E()) return '<section class="usm-card"><p class="note">Loading the reporting calendar…</p></section>';
    var today = nyDay(), R = records().filter(function (x) { return !C6.wl || x.w; });
    if (C6.day === null && !C6.touched && R.some(function (x) { return x.date === today; })) C6.day = today;
    return seasonRead(R) + calendar(R, today) + matrix(R, today);
  }
  function subBar() {
    function b(a, v, t) { return "<button data-usm" + a + '="' + v + '"' + (C6[a] === v ? ' aria-pressed="true"' : "") + ">" + t + "</button>"; }
    return '<span class="usm-seg">' + b("sub", "cal", "Calendar &amp; estimates") + b("sub", "intel", "Intelligence") + "</span>" +
      (C6.sub === "cal" ? '<span class="usm-seg">' + b("per", "q", "Quarter") + b("per", "fy", "Fiscal year") + "</span>" +
      '<label class="usm-tg"><input type="checkbox" id="usmWl"' + (C6.wl ? " checked" : "") + "> Watchlist only</label>" : "");
  }
  /* -------- E: inspector. A symbol click never leaves the current screen -------- */
  function kv(k, v) { return "<div><dt>" + esc(k) + "</dt><dd>" + v + "</dd></div>"; }
  function sparkline(v) { v = (v || []).map(function (x) { return x && x.length ? x[x.length - 1] : x; }).filter(function (x) { return typeof x === "number"; }); if (v.length < 2) return "";
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = hi - lo || 1, up = v[v.length - 1] >= v[0];
    return '<svg class="usm-sp" viewBox="0 0 260 56" preserveAspectRatio="none" role="img" aria-label="Recent closes"><polyline fill="none" stroke="var(--' + (up ? "green" : "red") + ')" stroke-width="1.5" vector-effect="non-scaling-stroke" points="' + v.map(function (x, i) { return (i / (v.length - 1) * 260).toFixed(1) + "," + (52 - (x - lo) / r * 48).toFixed(1); }).join(" ") + '"/></svg>'; }
  function inspector() {
    if (!sel) return "";
    var head = function (t, s) { return '<div class="usm-eh"><div><b>' + esc(t) + "</b><small>" + esc(s) + '</small></div><button class="usm-mini" data-usmclose aria-label="Close inspector">×</button></div>'; }, today = nyDay();
    if (sel.t === "i") { var i = (W() && W().instruments || []).filter(function (a) { return a.id === sel.k; })[0]; if (!i) return head(sel.k, "") + '<span class="usm-b na">Unavailable</span>';
      return head(i.name, i.ex || "") + '<div class="big ' + dirCls(i.chg) + '">' + num(i.last, dec(i)) + (i.kind === "yield" ? "%" : "") + '</div><div class="' + dirCls(i.chg) + '">' + move(i) + "</div>" + range(i) + sparkline(i.spark) +
        "<h4>Detail</h4><dl>" + kv("Previous close", num(i.prev_close, dec(i))) + kv("Open", num(i.open, dec(i))) + (i.w52 ? kv("52-week range", num(i.w52.low, dec(i)) + " – " + num(i.w52.high, dec(i))) : "") + kv("State", badge(i)) + "</dl>" +
        "<h4>Evidence</h4><dl>" + kv("Quote as of", i.ts ? new Date(i.ts).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Unavailable") + "</dl>"; }
    var R = records(), p = sel.k.split("|"), x = R.filter(function (r) { return r.s === p[0] && r.date === p[1]; })[0] || R.filter(function (r) { return r.s === p[0]; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    if (!x) return head(p[0], "") + '<span class="usm-b na">Unavailable</span><p class="usm-none">This company isn’t on the reporting calendar in view.</p>' + '<button class="usm-open" data-usmopen="' + esc(p[0]) + '">Open full research</button>';
    return head(x.s, x.n || "") + '<div class="usm-er">' + outcome(x, today) + "<span>" + esc(x.date) + " · " + sess(x.time) + "</span></div>" +
      "<h4>Estimates vs actual</h4><dl>" +
      kv("EPS", (x.epsA == null ? "—" : num(x.epsA, 2) + (x.gaap ? " GAAP" : "")) + " vs " + (x.epsE == null ? "—" : num(x.epsE, 2))) + kv("EPS surprise", '<span class="' + dirCls(x.epsP) + '">' + (x.gaap ? "Not comparable" : sg(x.epsP, 1, "%")) + "</span>") +
      kv("Revenue", money(x.revA) + " vs " + money(x.revE)) + kv("Revenue surprise", '<span class="' + dirCls(x.revP) + '">' + sg(x.revP, 1, "%") + "</span>") +
      (x.yoy != null ? kv("Revenue YoY", '<span class="' + dirCls(x.yoy) + '">' + sg(x.yoy, 1, "%") + "</span>") : "") + (x.ly != null ? kv("EPS a year ago", num(x.ly, 2)) : "") + (x.ests != null ? kv("Estimates", num(x.ests, 0)) : "") + (x.mcap ? kv("Market cap", money(x.mcap)) : "") + (x.fq ? kv("Fiscal quarter", esc(x.fq)) : "") + "</dl>" +
      (x.hl ? '<h4>Release highlight</h4><p class="usm-q">' + esc(x.hl) + "</p>" : "") + (x.guide ? '<h4>Guidance</h4><p class="usm-q">' + esc(x.guide) + "</p>" : "") +
      "<h4>Evidence</h4><dl>" + kv("Release filed", x.filed ? new Date(x.filed).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (/^https:\/\//.test(x.url || "") ? ' · <a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">Filing ↗</a>' : "") : x.done ? "Date unavailable" : "Not yet") + (x.upd ? kv("Estimate verified", esc(x.upd)) : "") + kv("Transcript", '<span class="usm-b na">Unavailable</span>') + "</dl>" +
      '<button class="usm-open" data-usmopen="' + esc(x.s) + '">Open full research</button>';
  }
  function paintE() { var e = document.getElementById("usmE"); e.innerHTML = inspector(); root.classList.toggle("insp", !!sel); }
  function openSel(t, k) { sel = { t: t, k: k }; paintE(); crumbs(); }
  function crumbs() {
    var c = current(), a = '<button data-usmcat="c1">US Market</button> › <button data-usmcat="' + c[0] + '"' + (c[0] === "c6" || sel ? "" : ' aria-current="page"') + ">" + esc((c[1] ? c[1] + " " : "") + c[2]) + "</button>";
    if (c[0] === "c6") a += " › " + (C6.sub === "intel" ? "<b>Intelligence</b>" : "<b>" + (C6.per === "fy" ? "Fiscal year" : "Calendar &amp; estimates") + "</b>");
    if (sel) a += " › <b>" + esc(sel.t === "i" ? ((W() && W().instruments || []).filter(function (i) { return i.id === sel.k; })[0] || { name: sel.k }).name : sel.k.split("|")[0]) + "</b>";
    document.getElementById("usmCrumb").innerHTML = a;
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
    '.usm-d{grid-area:d;min-width:0}.usm-crumb{font-size:12px;color:var(--faint);margin:2px 0 8px}.usm-crumb b{color:var(--muted);font-weight:600}.usm-crumb button{appearance:none;border:0;background:none;padding:0;font:inherit;color:var(--faint);cursor:pointer}.usm-crumb button:hover{color:var(--ink);text-decoration:underline}#usm:not([data-v="intel"]) #panel-earnings{display:none!important}' +
    '#usm[data-v="intel"] #usmView{display:none}#usmSub{display:none;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}#usm[data-cat="c6"] #usmSub{display:flex}#panel-earnings .ut-hdr,#panel-earnings [data-utgo="plan"]{display:none!important}' +
    '.usm-card{background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:12px 14px;margin-bottom:10px;min-width:0}.usm-card h3{margin:0 0 8px;font-size:14px;color:var(--ink)}.usm-card h3 small{font-weight:500;color:var(--faint);margin-left:4px}.usm-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.usm-2 .usm-card{margin:0}' +
    '.usm-tw{overflow-x:auto}.usm-tb{width:100%;border-collapse:collapse;font-size:12.5px}.usm-tb th{text-align:left;color:var(--faint);font-weight:500;padding:3px 8px 5px 0;white-space:nowrap}.usm-tb td{padding:5px 8px 5px 0;border-top:1px solid var(--line);color:var(--ink);white-space:nowrap}.usm-tb td:nth-child(2),.usm-tb td:nth-child(3){font-family:"IBM Plex Mono",monospace}.usm-tb td:nth-child(4){min-width:130px}' +
    '.usm-gl .h{display:flex;justify-content:space-between;align-items:center}.usm-gl h3{margin:0}.usm-gl .big{font:600 34px "IBM Plex Mono",monospace;margin:2px 0 8px}.usm-gl .usm-rd{display:grid;grid-template-columns:1fr 1fr 2.4fr;gap:14px;font-size:13px;color:var(--ink)}.usm-gl .usm-rd b{display:block;font-size:11.5px;font-weight:500;color:var(--faint)}' +
    '.usm-hold{padding:34px 22px;text-align:center}.usm-hold h3{margin:10px 0 6px;font-size:17px}.usm-hold p{margin:0;color:var(--muted);font-size:13.5px}' +
    '.usm-g{grid-area:g;position:sticky;bottom:0;z-index:5;overflow:hidden;background:var(--panel2);border:1px solid var(--line2);border-radius:6px;font:500 12px/28px "IBM Plex Mono",monospace;white-space:nowrap}.usm-g>div{display:inline-block;padding-left:100%;animation:usmTape 80s linear infinite}.usm-g:hover>div{animation-play-state:paused}.usm-g span{margin-right:22px;color:var(--ink)}.usm-g em{font-style:normal;color:var(--faint);margin-right:14px}@keyframes usmTape{to{transform:translateX(-100%)}}' +
    '#usm.insp{grid-template-columns:172px minmax(0,1fr) 300px;grid-template-areas:"a a a" "c c c" "b d e" "g g g"}#usmE{display:none;grid-area:e;align-self:start;position:sticky;top:8px;max-height:calc(100vh - 60px);overflow:auto;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:12px 14px;font-size:13px;color:var(--ink)}#usm.insp #usmE{display:block}' +
    '.usm-eh{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:8px}.usm-eh b{font:600 17px "IBM Plex Mono",monospace;display:block}.usm-eh small{color:var(--muted)}#usmE .big{font:600 24px "IBM Plex Mono",monospace}#usmE h4{margin:13px 0 5px;font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}#usmE dl{margin:0}#usmE dl>div{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-top:1px solid var(--line)}#usmE dt{color:var(--muted)}#usmE dd{margin:0;text-align:right;font-family:"IBM Plex Mono",monospace;font-size:12px}#usmE a{color:var(--cyan)}.usm-sp{display:block;width:100%;height:56px;margin-top:8px}.usm-er{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:12px}.usm-q{margin:0;font-size:12.5px;line-height:1.45;color:var(--muted)}.usm-open{width:100%;margin-top:12px;padding:7px;background:#1a2a42;color:#fff;border:1px solid #3d5a80;border-radius:6px;font:inherit;font-size:13px;cursor:pointer}' +
    '.usm-b.up{color:var(--green)}.usm-b.dn{color:var(--red)}.usm-seg{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden}.usm-seg button{appearance:none;border:0;background:var(--panel);color:var(--muted);font:inherit;font-size:12.5px;padding:5px 10px;cursor:pointer}.usm-seg button[aria-pressed]{background:#1a2a42;color:#fff}.usm-tg{font-size:12.5px;color:var(--muted);display:inline-flex;gap:5px;align-items:center}.usm-rowh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.usm-rowh h3{margin:0}.usm-mini{appearance:none;background:var(--panel2);border:1px solid var(--line2);color:var(--muted);border-radius:4px;padding:1px 8px;font:inherit;font-size:12px;cursor:pointer;margin-left:3px}.usm-none{color:var(--muted);font-size:13px;margin:8px 0}' +
    '.usm-cal{display:grid;grid-template-columns:52px repeat(5,minmax(0,1fr));gap:3px;font-size:12px}.usm-cal .hd,.usm-cal .wk{color:var(--faint);font-size:11px;padding:3px}.usm-cal .wk{align-self:center}.usm-cal .dy{appearance:none;display:flex;gap:6px;align-items:baseline;min-height:30px;padding:4px 7px;background:var(--panel2);border:1px solid var(--line);border-radius:4px;color:var(--faint);font:inherit;text-align:left;cursor:pointer}.usm-cal .dy:disabled{cursor:default;opacity:.55}.usm-cal .dy b{color:var(--ink);font:600 13px "IBM Plex Mono",monospace}.usm-cal .dy small{margin-left:auto;color:var(--green);font-size:10.5px}.usm-cal .dy.tdy{border-color:var(--amber)}.usm-cal .dy.on{background:#1a2a42;border-color:#3d5a80}' +
    '.usm-tb th button{appearance:none;border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-transform:inherit;letter-spacing:inherit}.usm-mx td{font-family:"IBM Plex Mono",monospace}.usm-mx td:nth-child(4){min-width:0}.usm-mx small{color:var(--faint)}[data-usmi],[data-usms]{cursor:pointer}.usm-tb tr[data-usmi]:hover td,.usm-tb tr[data-usms]:hover td,.usm-tb tr.on td{background:var(--panel2)}.usm-t[data-usmi]:hover{border-color:#3d5a80}[data-usmi]:focus-visible,[data-usms]:focus-visible{outline:2px solid var(--cyan);outline-offset:-2px}' +
    '@media (prefers-reduced-motion:reduce){.usm-g{overflow-x:auto}.usm-g>div{animation:none;padding-left:8px}}' +
    '@media (max-width:1100px){.usm-c{grid-template-columns:repeat(3,minmax(0,1fr))}.usm-2{grid-template-columns:1fr}}' +
    '@media (max-width:1100px){#usm.insp{grid-template-columns:172px minmax(0,1fr);grid-template-areas:"a a" "c c" "b d" "g g"}#usm.insp #usmE{position:fixed;right:0;top:0;bottom:0;width:min(340px,100vw);max-height:none;z-index:60;border-radius:0}}' +
    '@media (max-width:760px){#usm.insp,#usm{grid-template-columns:minmax(0,1fr);grid-template-areas:"a" "c" "b" "d" "g"}.usm-c{grid-template-columns:repeat(2,minmax(0,1fr))}.usm-b-rail{flex-direction:row;overflow-x:auto;position:static}.usm-b-rail button{white-space:nowrap;flex:0 0 auto}.usm-b-rail hr{display:none}.usm-gl .usm-rd{grid-template-columns:1fr}.usm-g{position:static}.usm-st{margin-left:0}}';
  document.head.appendChild(css);

  var root = document.createElement("div"); root.id = "usm";
  root.innerHTML = '<div class="usm-a"><b>US Market</b><input class="usm-s" id="usmQ" type="search" autocomplete="off" spellcheck="false" aria-label="Search a ticker or category" placeholder="Ticker or category · Ctrl+K"><div class="usm-st" id="usmSt"></div></div>' +
    '<div class="usm-c" id="usmC"></div><nav class="usm-b-rail" id="usmB" aria-label="US Market categories"></nav>' +
    '<div class="usm-d"><div class="usm-crumb" id="usmCrumb"></div><div id="usmSub"></div><div id="usmView"></div></div><aside id="usmE" aria-label="Inspector"></aside><div class="usm-g" id="usmG" aria-hidden="true"></div>';
  P.parentNode.insertBefore(root, P);
  root.querySelector(".usm-d").appendChild(P);   /* C6 hosts the existing page */
  var lab = BTN.firstChild; if (lab && lab.nodeType === 3) lab.nodeValue = "US Market";

  function paintRail() {
    root.dataset.cat = cat;
    document.getElementById("usmB").innerHTML = CATS.map(function (c) {
      return (c[0] === "wl" ? "<hr>" : "") + '<button data-usmcat="' + c[0] + '"' + (c[0] === cat ? ' aria-current="page"' : "") + "><i>" + c[1] + "</i>" + esc(c[2]) + "</button>";
    }).join("");
    root.dataset.v = cat === "c6" && C6.sub === "intel" ? "intel" : "view"; crumbs();
  }
  function paintLive() {
    var s = bySym("^GSPC");
    document.getElementById("usmSt").innerHTML = badge(s) + "<span>" + new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }) + " ET</span>" +
      (s ? "<span>NYSE " + esc(s.status_label || "") + "</span>" : "") + '<span id="usmVer">' + (W() && W().updated_at ? "Verified " + new Date(W().updated_at).toLocaleString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "") + "</span>";
    document.getElementById("usmC").innerHTML = INDEX.map(tile).join("");
    var cash = INDEX.concat(["^VIX"]).map(bySym).filter(Boolean), fut = (W() && W().instruments || []).filter(function (i) { return /=F$/.test(i.sym || "") && i.last != null; }),
        one = function (i, n) { return "<span>" + esc(n) + " " + num(i.last, dec(i)) + ' <b class="' + dirCls(i.chg) + '">' + sg(i.pct, 2, "%") + "</b></span>"; };
    document.getElementById("usmG").innerHTML = "<div><em>CASH</em>" + cash.map(function (i) { return one(i, SHORT[i.sym] || i.name); }).join("") + "<em>FUTURES</em>" + fut.map(function (i) { return one(i, i.name.replace(/ \(.*\)/, "")); }).join("") + "</div>";
    if (cat === "c1") document.getElementById("usmView").innerHTML = snapshot(); else if (cat === "c6") paintC6();
    if (sel) paintE();
  }
  function paintC6() { document.getElementById("usmSub").innerHTML = subBar(); root.dataset.v = C6.sub === "intel" ? "intel" : "view"; document.getElementById("usmView").innerHTML = c6View(); crumbs(); }
  function go(c) {
    cat = c; try { localStorage.setItem("desk.usmCat", c); } catch (e) {}
    paintRail(); var C = current();
    document.getElementById("usmView").innerHTML = c === "c1" ? snapshot() : c === "c6" ? c6View() : holding(C);
    if (c === "c6") { document.getElementById("usmSub").innerHTML = subBar(); if (C6.sub === "intel" && window.EARNINGS) EARNINGS.render(); }
  }
  root.addEventListener("click", function (ev) { var t = ev.target.closest ? ev.target : null; var b; if (!t) return;
    if (t.closest("#panel-earnings")) return;
    b = t.closest("[data-usmcat]"); if (b) { go(b.getAttribute("data-usmcat")); return; }
    if (t.closest("[data-usmclose]")) { sel = null; paintE(); crumbs(); return; }
    b = t.closest("[data-usmopen]"); if (b) { C6.sub = "intel"; go("c6"); if (window.EARNINGS && EARNINGS.choose) EARNINGS.choose(b.getAttribute("data-usmopen")); return; }
    b = t.closest("[data-usmsub]"); if (b) { C6.sub = b.getAttribute("data-usmsub"); paintC6(); if (C6.sub === "intel" && window.EARNINGS) EARNINGS.render(); return; }
    b = t.closest("[data-usmper]"); if (b) { C6.per = b.getAttribute("data-usmper"); paintC6(); return; }
    b = t.closest("[data-usmstate]"); if (b) { C6.state = b.getAttribute("data-usmstate"); paintC6(); return; }
    b = t.closest("[data-usmwk]"); if (b) { C6.wk += +b.getAttribute("data-usmwk"); paintC6(); return; }
    if (t.closest("[data-usmday]")) { var d = t.closest("[data-usmday]").getAttribute("data-usmday"); C6.touched = true; C6.day = d && d !== C6.day ? d : null; paintC6(); return; }
    b = t.closest("[data-usmsort]"); if (b) { var k = b.getAttribute("data-usmsort"); C6.dir = C6.sort === k ? -C6.dir : k === "sym" || k === "date" ? 1 : -1; C6.sort = k; paintC6(); return; }
    b = t.closest("[data-usms]"); if (b) { openSel("s", b.getAttribute("data-usms")); if (cat === "c6") paintC6(); return; }
    b = t.closest("[data-usmi]"); if (b) openSel("i", b.getAttribute("data-usmi"));
  });
  root.addEventListener("change", function (ev) { if (ev.target.id === "usmWl") { C6.wl = ev.target.checked; try { localStorage.setItem("desk.usmWl", C6.wl ? "1" : "0"); } catch (e) {} paintC6(); } });
  root.addEventListener("keydown", function (ev) { if (ev.key !== "Enter" && ev.key !== " ") return; var b = ev.target.closest && ev.target.closest("[data-usms],[data-usmi]"); if (b) { ev.preventDefault(); b.click(); } });
  /* a symbol clicked inside the Intelligence page also fills the inspector; that page keeps its own behaviour */
  P.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-uesym],[data-utev]"); if (b) openSel("s", (b.getAttribute("data-uesym") || b.getAttribute("data-utev")) + "|"); });
  /* A: command bar. A category name jumps there; anything else is treated as a ticker and handed to the C6 search */
  var Q = document.getElementById("usmQ");
  Q.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { Q.value = ""; Q.blur(); return; }
    if (ev.key !== "Enter") return;
    var t = Q.value.trim(); if (!t) return;
    var hit = CATS.filter(function (c) { var l = t.toLowerCase(); return c[1].toLowerCase() === l || c[2].toLowerCase().indexOf(l) === 0; })[0];
    Q.value = "";
    if (hit && !(t === t.toUpperCase() && !/^c\d$/i.test(t))) { go(hit[0]); return; }
    C6.sub = "intel"; go("c6");
    var i = P.querySelector("[data-utq]"); if (!i) return;
    i.value = t; i.dispatchEvent(new Event("input", { bubbles: true })); var n = P.querySelector("[data-utq]"); if (n) n.focus();
  });
  document.addEventListener("keydown", function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K") && P.classList.contains("active")) { ev.preventDefault(); Q.focus(); }
    if (ev.key === "Escape" && sel && P.classList.contains("active") && document.activeElement !== Q) { sel = null; paintE(); crumbs(); }
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
  (function waitE(n) { if (E()) { if (cat === "c6") paintC6(); return; } if (n > 0) setTimeout(function () { waitE(n - 1); }, 1500); })(40);
  window.addEventListener("desk:earnboard", function () { if (cat === "c6" && C6.sub === "cal" && P.classList.contains("active")) paintC6(); if (sel && sel.t === "s") paintE(); });
  window.USM = { go: go };
})();
