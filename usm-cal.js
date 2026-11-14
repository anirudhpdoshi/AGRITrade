/* usm-cal.js — US Markets → Earnings Calendar: Upcoming · Today · Released · Refreshing.
   One row per company and report date, merged from the data the desk already loads (no new network calls):
     earnings.json calendar (estimates and actuals) · earnings.json S&P 500 schedule (timing, Nasdaq consensus)
     live.json earn_board / earn_live (today's slots, SEC 8-K press-release actuals, refreshed every minute).
   A missing estimate stays "—" (never invented); a surprise is shown only when the source published one. */
(function (root) {
  "use strict";
  var doc = root.document, TZ = "America/New_York", ST = { tab: "today" };
  try { ST.tab = localStorage.getItem("desk.usmCalTab") || "today"; } catch (e) {}
  var TABS = [["upcoming", "Upcoming"], ["today", "Today"], ["released", "Released"], ["refreshing", "Refreshing"]];
  var seenReleased = null;
  function esc(s) { return DeskCore.esc(s); }
  function n(v) { return v == null || v === "" || !isFinite(+v) ? null : +v; }
  function num(v, d) { return v == null ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function big(v) { if (v == null) return "—"; var a = Math.abs(v), s = v < 0 ? "−$" : "$"; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? s + (a / 1e6).toFixed(1) + "M" : s + num(a, 0); }
  function pct(v) { return v == null ? "—" : '<span class="' + (v > 0 ? "up" : v < 0 ? "dn" : "") + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%</span>"; }
  function addD(iso, k) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function usd(v) { return v == null ? "—" : (v < 0 ? "−$" : "$") + num(Math.abs(v), 2); }
  function today() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
  function et(s) { return s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—"; }
  function dayL(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
  function J() { return root.EARNINGS && EARNINGS._data ? EARNINGS._data() : null; }
  function slotPassed(r, t) {   /* has the company's reporting slot already passed (results are due)? */
    if (r.d < t) return true; if (r.d > t) return false;
    var h = +new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false });
    return r.time === "bmo" ? h >= 9 : r.time === "amc" ? h >= 17 : h >= 18;
  }

  function rows() {
    var D = J(); if (!D) return [];
    var M = {}, t = today();
    function rec(s, d) { var k = s + "|" + d; return M[k] || (M[k] = { s: s, d: d, src: [] }); }
    var C = D.calendar || {};
    (C.rows || []).forEach(function (r) { var x = rec(r.symbol, r.date);
      x.epsE = n(r.epsEstimated); x.epsA = n(r.epsActual); x.revE = n(r.revenueEstimated); x.revA = n(r.revenueActual);
      x.epsS = n(r.eps_surprise_pct); x.revS = n(r.rev_surprise_pct); x.time = x.time || r.time; x.w = r.w; x.top = r.top; if (r.seen_at) x.at = r.seen_at;
      x.src.push(["Earnings calendar", C.fetched_at]); });
    var S = D.sp_schedule || {}, SD = S.days || {};
    Object.keys(SD).forEach(function (d) { SD[d].forEach(function (y) { var x = rec(y.s, d);
      x.n = x.n || y.n; x.time = y.time || x.time; x.mcap = y.mcap; x.fq = y.fq;
      if (x.epsE == null && n(y.eps_f) != null) { x.epsE = n(y.eps_f); x.epsEsrc = "Nasdaq consensus" + (y.ests ? ", " + y.ests + " estimates" : ""); }
      x.src.push(["S&P 500 schedule", S.fetched_at]); }); });
    var B = root.DESK_EARN_BOARD;
    ((B && B.items) || []).forEach(function (i) { var x = rec(i.s, B.day || t);
      x.n = x.n || i.n; x.time = i.time || x.time; x.slot = i.slot; x.mcap = x.mcap || i.mcap; x.fq = x.fq || i.fq;
      if (x.epsE == null && i.est && n(i.est.eps) != null) { x.epsE = n(i.est.eps); x.epsEsrc = i.est.eps_src || "consensus"; }
      if (x.revE == null && i.est && n(i.est.rev) != null) x.revE = n(i.est.rev);
      if (i.filing && i.filing.at) x.filed = i.filing.at;
      if (i.pr) { x.epsD = n(i.pr.eps_d); x.epsAdj = n(i.pr.eps_adj); }
      x.src.push(["Live earnings board", B.asof]); });
    var L = root.DESK_EARN_LIVE || {};
    Object.keys(L).forEach(function (s) { var r = L[s]; if (!r || !r.date) return; var x = rec(s, r.date);
      if (x.epsA == null && n(r.epsActual) != null) { x.epsA = n(r.epsActual); x.epsAsrc = r.src || "SEC 8-K press release"; }
      if (x.revA == null && n(r.revenueActual) != null) x.revA = n(r.revenueActual);
      if (x.epsE == null && n(r.epsEstimated) != null) x.epsE = n(r.epsEstimated);
      if (x.epsS == null) x.epsS = n(r.eps_surprise_pct); if (x.revS == null) x.revS = n(r.rev_surprise_pct);
      if (r.seen_at) x.at = r.seen_at; x.src.push([r.src || "SEC 8-K press release", r.seen_at]); });
    /* on demand: only the stocks this user follows (saved, locked for earnings, or with a card today) */
    var mine = {}; (function () { var a = null; try { a = JSON.parse(localStorage.getItem("desk.usmWatch") || "null"); } catch (e) {} (a || []).forEach(function (s) { mine[s] = 1; });
      var E = root.ELOCK && ELOCK.state(); if (E) { E.syms.forEach(function (s) { mine[s] = 1; }); Object.keys(E.cards || {}).forEach(function (s) { mine[s] = 1; }); }
      var v = root.EARNINGS && EARNINGS._view && EARNINGS._view(); if (v && v.sel) mine[v.sel] = 1; })();
    Object.keys(M).forEach(function (k) { if (!mine[k.split("|")[0]]) delete M[k]; });
    var names = (D.sp500 && D.sp500.rows) || {}, CO = D.companies || {};
    return Object.keys(M).map(function (k) { var x = M[k];
      x.n = x.n || names[x.s] || (CO[x.s] && CO[x.s].profile && CO[x.s].profile.companyName) || "";
      x.done = x.epsA != null || x.revA != null;
      x.state = x.done ? "released" : x.d > t ? "upcoming" : slotPassed(x, t) ? "refreshing" : "today-pending";
      var last = x.src.filter(function (z) { return z[1]; }).sort(function (a, b) { return Date.parse(b[1]) - Date.parse(a[1]); })[0];
      x.srcL = last ? last[0] : (x.src[0] && x.src[0][0]) || ""; x.srcT = x.at || (last && last[1]) || null;
      return x; });
  }
  function inTab(x, tab, t) {
    return tab === "today" ? x.d === t : tab === "upcoming" ? x.state === "upcoming" : tab === "released" ? x.state === "released" : x.state === "refreshing";
  }
  function timing(x) { return x.time === "bmo" ? "Before open" : x.time === "amc" ? "After close" : '<span class="uk-na">Not confirmed</span>'; }
  function status(x) {
    return x.state === "released" ? '<span class="uk-b rel">Released' + (x.at ? " " + esc(et(x.at).replace(/^\w+ \d+, /, "")) : "") + "</span>"
      : x.state === "refreshing" ? (x.d >= addD(today(), -1) ? '<span class="uk-b ref"><i class="uk-dot"></i>Refreshing — results due</span>' : '<span class="uk-b ref" title="The slot passed but no source on the desk has published results yet">Still not in the data feed</span>')
      : x.state === "upcoming" ? '<span class="uk-b up">Scheduled</span>' : '<span class="uk-b td">Due ' + (x.time === "bmo" ? "before open" : x.time === "amc" ? "after close" : "today") + "</span>";
  }
  function html() {
    var R = rows(), t = today(), D = J();
    if (!D) return '<section class="usm-card" id="usmK"><h3>Earnings calendar</h3><div class="co-skg"><div class="co-skc wide"><i class="sk"></i><i class="sk"></i><i class="sk"></i></div></div></section>';
    var cnt = {}; TABS.forEach(function (tb) { cnt[tb[0]] = R.filter(function (x) { return inTab(x, tb[0], t); }).length; });
    var L = R.filter(function (x) { return inTab(x, ST.tab, t); });
    L.sort(ST.tab === "released" ? function (a, b) { return (b.d > a.d ? 1 : b.d < a.d ? -1 : 0) || (Date.parse(b.at || 0) - Date.parse(a.at || 0)); }
      : function (a, b) { return (a.d > b.d ? 1 : a.d < b.d ? -1 : 0) || ((b.mcap || 0) - (a.mcap || 0)); });
    var sel = root.EARNINGS && EARNINGS._view && EARNINGS._view().sel;
    var body = L.length ? '<div class="tbl-scroll"><table class="uk-t"><thead><tr><th>Company</th><th>Report date</th><th>Timing</th><th>EPS est.</th><th>EPS actual</th><th>EPS surprise</th><th>Revenue est.</th><th>Revenue actual</th><th>Rev. surprise</th><th>Status</th><th>Source · as of</th></tr></thead><tbody>' +
      L.map(function (x) {
        return '<tr data-ukopen="' + esc(x.s) + '" data-ukn="' + esc(x.n) + '" tabindex="0" title="Open ' + esc(x.s) + ' in Company Analysis"' + (sel === x.s ? ' class="on"' : "") + '><td><b>' + esc(x.s) + "</b><small>" + esc(x.n) + (x.fq ? " · FQ " + esc(x.fq) : "") + "</small></td>" +
          "<td>" + esc(dayL(x.d)) + "</td><td>" + timing(x) + "</td>" +
          "<td>" + (x.epsE != null ? usd(x.epsE) + (x.epsEsrc ? "<small>" + esc(x.epsEsrc) + "</small>" : "") : '<span class="uk-na">no consensus</span>') + "</td>" +
          "<td>" + (x.epsA != null ? "<b>" + usd(x.epsA) + "</b>" + (x.epsAdj != null && x.epsD != null && Math.abs(x.epsA - x.epsD) < 0.005 && Math.abs(x.epsAdj - x.epsD) >= 0.005 ? "<small>GAAP diluted · adjusted " + usd(x.epsAdj) + " in the release</small>" : x.epsAsrc ? "<small>" + esc(x.epsAsrc) + "</small>" : "") : "—") + "</td><td>" + pct(x.epsS) + "</td>" +
          "<td>" + big(x.revE) + "</td><td>" + (x.revA != null ? "<b>" + big(x.revA) + "</b>" : "—") + "</td><td>" + pct(x.revS) + "</td>" +
          "<td>" + status(x) + "</td><td><small>" + esc(x.srcL) + "</small><small>" + esc(et(x.srcT)) + "</small></td></tr>"; }).join("") + "</tbody></table></div>"
      : '<p class="uk-none">' + (ST.tab === "today" ? "None of your saved or locked companies reports today." : ST.tab === "refreshing" ? "Nothing is waiting for results right now." : ST.tab === "released" ? "No results for your companies in the calendar window yet." : "No upcoming report for your saved or locked companies in the calendar window. Save (☆) or lock (🔕) a company from the search.") + "</p>";
    var C = D.calendar || {};
    return '<section class="usm-card" id="usmK"><div class="uk-h"><h3>Earnings calendar</h3><span class="uk-seg">' + TABS.map(function (tb) { return '<button data-uktab="' + tb[0] + '" aria-pressed="' + (ST.tab === tb[0]) + '">' + tb[1] + " <b>" + cnt[tb[0]] + "</b></button>"; }).join("") + "</span></div>" + body +
      '<div class="stamp">Window ' + esc(C.from || "—") + " → " + esc(C.to || "—") + ". Estimates and actuals as published by each source (EPS basis can differ between a press release and the consensus, so a surprise is shown only where the source gives one). " +
      "Refreshing = the reporting slot has passed and the desk is checking for results (live board every minute, calendar every few minutes). Click a row to open the company.</div></section>";
  }
  /* when a company's results land: Released tab updates, and the open Company Analysis for it is refreshed */
  function watch() {
    var R = rows(), now = {}; R.forEach(function (x) { if (x.done) now[x.s + "|" + x.d] = 1; });
    if (seenReleased) { var sel = root.EARNINGS && EARNINGS._view && EARNINGS._view().lock && EARNINGS._view().sel;
      Object.keys(now).forEach(function (k) { if (!seenReleased[k] && sel && k.split("|")[0] === sel && root.COMPANY && COMPANY.retry) COMPANY.retry(sel); }); }
    seenReleased = now;
  }
  function paint() { var el = doc.getElementById("usmK"); if (!el) return; var d = doc.createElement("div"); d.innerHTML = html(); d.firstChild.classList.add("ux-page"); el.replaceWith(d.firstChild); }
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-uktab]"); if (b) { ST.tab = b.getAttribute("data-uktab"); try { localStorage.setItem("desk.usmCalTab", ST.tab); } catch (e) {} paint(); return; }
    b = ev.target.closest && ev.target.closest("[data-ukopen]"); if (b && root.USMNAV) USMNAV.open({ s: b.getAttribute("data-ukopen"), n: b.getAttribute("data-ukn") });
  });
  doc.addEventListener("keydown", function (ev) { var r = ev.key === "Enter" && ev.target.closest && ev.target.closest("[data-ukopen]"); if (r && root.USMNAV) USMNAV.open({ s: r.getAttribute("data-ukopen"), n: r.getAttribute("data-ukn") }); });
  ["desk:earnboard", "desk:earnlive", "desk:earnpr"].forEach(function (e) { root.addEventListener(e, function () { watch(); paint(); }); });
  setInterval(function () { watch(); if (!doc.hidden) paint(); }, 30000);
  setTimeout(watch, 6000);

  var css = doc.createElement("style");
  css.textContent = "#usmK .stamp{font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.45}.uk-h{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.uk-h h3{margin:0}.uk-seg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}" +
    ".uk-seg button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 12.5px 'IBM Plex Sans',sans-serif;padding:6px 12px;cursor:pointer}.uk-seg button+button{border-left:1px solid var(--line2)}.uk-seg button b{font-family:'IBM Plex Mono',monospace;margin-left:4px;color:var(--faint)}" +
    ".uk-seg button[aria-pressed=true]{background:rgba(56,182,201,.16);color:#fff}.uk-seg button[aria-pressed=true] b{color:#9db8d8}" +
    ".uk-t{width:100%;border-collapse:collapse;font-size:13px}.uk-t th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".uk-t td{padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}.uk-t td small{display:block;color:var(--muted);font-size:11px}.uk-t tbody tr{cursor:pointer}.uk-t tbody tr:hover,.uk-t tbody tr:focus,.uk-t tbody tr.on{background:rgba(56,182,201,.08);outline:none}" +
    ".uk-na{color:var(--faint)}.uk-none{color:var(--muted);font-size:13px}.uk-b{display:inline-flex;align-items:center;gap:5px;font:700 11px 'IBM Plex Sans',sans-serif;border-radius:999px;padding:2px 9px;border:1px solid var(--line2)}" +
    ".uk-b.rel{color:#3fb97f;border-color:rgba(63,185,127,.5)}.uk-b.ref{color:#e8b93d;border-color:rgba(232,185,61,.5)}.uk-b.up{color:var(--muted)}.uk-b.td{color:#38b6c9;border-color:rgba(56,182,201,.5)}" +
    ".uk-dot{width:7px;height:7px;border-radius:50%;background:#e8b93d;animation:ukp 1.2s ease-in-out infinite}@keyframes ukp{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.uk-dot{animation:none}}";
  doc.head.appendChild(css);
  root.USMCAL = { html: html, rows: rows, paint: paint };
})(window);
