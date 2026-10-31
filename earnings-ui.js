/* US Earnings tab — PROTOTYPE, locked.
   Reads earnings.json from the `earnings` branch (built by scripts/us_earnings.py from Financial Modeling Prep).
   The FMP key never reaches the browser and this page never calls FMP: every FMP call happens in the manual-only
   "US earnings (prototype)" Action, which spends calls only on what can have changed.

   Lock: while EARNINGS_LIVE is false the tab button stays hidden and this module fetches nothing.
     open the preview   …/AGRITrade/?preview=earnings   (remembered in this browser)
     close the preview  …/AGRITrade/?preview=off
   Going live after sign-off = set EARNINGS_LIVE to true (and decide whether the Action gets a schedule). */
(function () {
  "use strict";
  var EARNINGS_LIVE = false;
  var P = document.getElementById("panel-earnings"), BTN = document.getElementById("tabbtn-earnings");
  if (!P || !BTN) return;

  var PKEY = "desk.earningsPreview";
  try {
    var q = new URLSearchParams(location.search).get("preview");
    if (q === "earnings") localStorage.setItem(PKEY, "1");
    if (q === "off") localStorage.removeItem(PKEY);
  } catch (e) {}
  var preview = false; try { preview = localStorage.getItem(PKEY) === "1"; } catch (e) {}
  if (!EARNINGS_LIVE && !preview) { BTN.hidden = true; return; }   /* locked: nothing rendered, nothing fetched */
  BTN.hidden = false;

  var REPO = "anirudhpdoshi/AGRITrade", API = "https://api.github.com/repos/" + REPO + "/contents/earnings.json?ref=earnings",
      RAW = "https://raw.githubusercontent.com/" + REPO + "/earnings/earnings.json",
      RUN = "https://github.com/" + REPO + "/actions/workflows/us-earnings.yml", TZ = "America/Toronto";
  var J = null, err = null, etag = "", lastTry = 0, busy = false;
  var V = (function () { try { return JSON.parse(localStorage.getItem("desk.earningsView") || "{}"); } catch (e) { return {}; } })();
  V.sort = V.sort || "mcap"; V.dir = V.dir || -1;
  function save() { try { localStorage.setItem("desk.earningsView", JSON.stringify(V)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- styles (scoped to .ue-) ---------- */
  var css = document.createElement("style");
  css.textContent =
    ".ue-proto{display:flex;gap:10px;align-items:center;padding:9px 12px;border:1px dashed var(--amber);border-radius:8px;background:rgba(232,163,61,.07);color:var(--ink);font-size:13px;margin-bottom:12px}" +
    ".ue-proto b{color:var(--amber);font-family:'IBM Plex Mono',monospace;font-size:11.5px;letter-spacing:.12em}" +
    ".ue-top{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:10px 0 2px}" +
    ".ue-k{border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:var(--panel2)}" +
    ".ue-k .l{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}" +
    ".ue-k .v{font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:600;margin-top:2px}.ue-k .s{font-size:12px;color:var(--muted)}" +
    ".ue-meter{height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden}.ue-meter i{display:block;height:100%;background:var(--cyan)}" +
    ".ue-meter.warn i{background:var(--amber)}.ue-meter.hot i{background:var(--red)}" +
    ".ue-grid{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(300px,1fr);gap:14px;align-items:start;margin-top:14px}" +
    "table.ue-t{width:100%;border-collapse:collapse}table.ue-t td:first-child,table.ue-t th:first-child{text-align:left}" +
    "table.ue-t th button{appearance:none;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;padding:0}" +
    "table.ue-t th button.on{color:var(--ink)}table.ue-t tbody tr{cursor:pointer}table.ue-t tbody tr:hover td{background:rgba(255,255,255,.025)}" +
    "table.ue-t tr.on td{background:rgba(56,182,201,.08)}table.ue-t tr.on td:first-child{box-shadow:inset 3px 0 0 var(--cyan)}" +
    ".ue-sym{font-weight:700;color:var(--ink)}.ue-nm{display:block;font-family:'Libre Franklin',sans-serif;font-size:11.5px;color:var(--faint);max-width:200px;overflow:hidden;text-overflow:ellipsis}" +
    ".ue-rng{position:relative;display:inline-block;width:86px;height:4px;border-radius:2px;background:var(--line2);vertical-align:middle}" +
    ".ue-rng i{position:absolute;top:-3px;width:2px;height:10px;background:var(--ink);border-radius:1px}" +
    ".ue-sec{text-align:left;font-family:inherit;font-size:12.5px;max-width:130px;overflow:hidden;text-overflow:ellipsis}" +
    ".ue-age{font-size:11px;color:var(--faint)}.ue-age.old{color:var(--amber)}" +
    ".ue-pf{display:flex;gap:12px;align-items:center}.ue-pf img{width:42px;height:42px;border-radius:8px;background:#fff;object-fit:contain;padding:3px}" +
    ".ue-pf h3{margin:0;font-size:17px}.ue-pf small{color:var(--muted)}" +
    ".ue-dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:12px 0;font-size:13px}.ue-dl dt{color:var(--faint)}.ue-dl dd{margin:0;font-family:'IBM Plex Mono',monospace;text-align:right}" +
    ".ue-desc{font-size:13px;color:var(--muted);line-height:1.55}" +
    ".ue-ph{border:1px dashed var(--line2);border-radius:9px;padding:14px;color:var(--muted);font-size:13px}" +
    ".ue-btn{appearance:none;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);border-radius:7px;padding:5px 11px;font:inherit;font-size:12px;cursor:pointer;text-decoration:none;display:inline-block}" +
    ".ue-btn:hover{border-color:var(--cyan)}.ue-act{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}" +
    ".ue-ep{width:100%;border-collapse:collapse;margin-top:6px}.ue-ep td,.ue-ep th{text-align:left;font-family:inherit;white-space:normal;vertical-align:top;font-size:12.5px}" +
    ".ue-ep td:first-child{white-space:nowrap}.ue-ep code{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--faint)}" +
    ".ue-st{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;border:1px solid;white-space:nowrap}" +
    ".ue-st.ok{color:var(--green);border-color:rgba(63,185,127,.5)}.ue-st.partial{color:var(--amber);border-color:rgba(232,163,61,.5)}" +
    ".ue-st.no{color:var(--red);border-color:rgba(224,101,95,.5)}.ue-st.unk{color:var(--faint);border-color:var(--line2)}" +
    ".ue-log{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--faint);line-height:1.6}" +
    "@media (max-width:1020px){.ue-grid{grid-template-columns:1fr}.ue-top{grid-template-columns:repeat(2,minmax(0,1fr))}}";
  document.head.appendChild(css);

  /* ---------- formatting ---------- */
  function num(v, d) { return v == null || isNaN(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function big(v) { if (v == null || isNaN(v)) return "—"; var a = Math.abs(v);
    return a >= 1e12 ? (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(v); }
  function sg(v, d, suf) { if (v == null || isNaN(v)) return '<span class="neu">—</span>';
    return '<span class="' + (v > 0 ? "up" : v < 0 ? "dn" : "neu") + '">' + (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), d) + (suf || "") + "</span>"; }
  function when(isoS) { return isoS ? new Date(isoS).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }
  function ago(isoS) { if (!isoS) return "—"; var m = (Date.now() - Date.parse(isoS)) / 60000;
    return m < 1 ? "just now" : m < 60 ? Math.round(m) + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; }
  function rangeBar(lo, hi, v) { if (lo == null || hi == null || v == null || hi <= lo) return "—";
    var p = Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    return '<span class="ue-rng" title="' + num(lo, 2) + " – " + num(hi, 2) + '"><i style="left:calc(' + p.toFixed(1) + '% - 1px)"></i></span>'; }

  /* ---------- data ---------- */
  function poll(force) {
    if (window.DESK_LOCKED || busy) return; if (!force && Date.now() - lastTry < 60000) return; lastTry = Date.now(); busy = true;
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) { if (r.status === 304) return null; if (r.status === 404) throw 404; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; return r.json(); })
      .then(function (j) { busy = false; if (j) { J = j; err = null; } render(); })
      .catch(function (e) {
        if (e === 404) { busy = false; err = "empty"; render(); return; }
        fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (r.status === 404) throw 404; if (!r.ok) throw r.status; return r.json(); })
          .then(function (j) { busy = false; J = j; err = null; render(); })
          .catch(function (e2) { busy = false; err = e2 === 404 ? "empty" : "down"; render(); });
      });
  }
  function rows() {
    var C = (J && J.companies) || {};
    return ((J && J.watchlist) || []).map(function (s) { var c = C[s] || {}, q = c.quote || {}, p = c.profile || {};
      var viaP = q.price == null && p.price != null, rg = String(p.range || "").split("-").map(parseFloat);
      return { s: s, c: c, q: q, p: p, viaP: viaP, at: viaP ? p.fetched_at : q.fetched_at, name: p.companyName || q.name || "",
        px: viaP ? p.price : q.price, ch: viaP ? p.change : q.change, pct: viaP ? p.changePercentage : q.changePercentage,
        vol: viaP ? p.volume : q.volume, avgv: p.averageVolume, mcap: q.marketCap || p.marketCap,
        ylo: q.yearLow != null ? q.yearLow : rg[0], yhi: q.yearHigh != null ? q.yearHigh : rg[1], sector: p.sector || "", ind: p.industry || "" }; });
  }
  function sorted() {
    var L = rows(), k = V.sort, d = V.dir;
    var f = { sym: function (r) { return r.s; }, px: function (r) { return r.px; }, pct: function (r) { return r.pct; },
      mcap: function (r) { return r.mcap; }, vol: function (r) { return r.avgv ? r.vol / r.avgv : null; }, sector: function (r) { return r.sector; } }[k] || function (r) { return r.mcap; };
    return L.sort(function (a, b) { var x = f(a), y = f(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * d; });
  }

  /* ---------- views ---------- */
  function protoBar() {
    return '<div class="ue-proto"><b>PROTOTYPE · LOCKED</b><span>Preview only — hidden from the desk until signed off. This page never calls FMP; data comes from the manual “US earnings (prototype)” Action.</span>' +
      '<span class="ue-act"><button class="ue-btn" data-ue="reload">Reload data</button><a class="ue-btn" href="' + RUN + '" target="_blank" rel="noopener noreferrer">Run the Action ↗</a></span></div>';
  }
  function topStrip() {
    var u = J.usage || {}, used = u.total || 0, bud = u.budget || 200, pc = Math.min(100, used / bud * 100), lr = J.last_run || {},
        made = (lr.made || []).length, sk = (lr.skipped || []).length, by = (lr.made || []).reduce(function (a, m) { a[m.endpoint] = (a[m.endpoint] || 0) + 1; return a; }, {});
    var C = J.companies || {}, n = (J.watchlist || []).length, withQ = (J.watchlist || []).filter(function (s) { return C[s] && ((C[s].quote || {}).price != null || (C[s].profile || {}).price != null); }).length,
        nR = (J.watchlist || []).filter(function (s) { return C[s] && C[s].quote_restricted; }).length;
    return '<div class="ue-top">' +
      '<div class="ue-k"><div class="l">FMP calls today (UTC)</div><div class="v">' + used + ' <small class="s">/ ' + bud + "</small></div>" +
        '<div class="ue-meter ' + (pc >= 90 ? "hot" : pc >= 70 ? "warn" : "") + '"><i style="width:' + pc.toFixed(0) + '%"></i></div>' +
        '<div class="s">quote ' + ((u.calls || {}).quote || 0) + " · profile " + ((u.calls || {}).profile || 0) + " · search " + ((u.calls || {}).search || 0) + "</div></div>" +
      '<div class="ue-k"><div class="l">Last run</div><div class="v" style="font-size:15px">' + esc(when(lr.at)) + '</div><div class="s">' + made + " call" + (made === 1 ? "" : "s") +
        (made ? " (" + Object.keys(by).map(function (k) { return by[k] + " " + k; }).join(", ") + ")" : " — nothing was due") + (sk ? " · " + sk + " skipped" : "") + "</div></div>" +
      '<div class="ue-k"><div class="l">US session</div><div class="v" style="font-size:15px">' + (J.session && J.session.open ? '<span class="up">● Open</span>' : '<span class="neu">● Closed</span>') +
        '</div><div class="s">last close ' + esc(when(J.session && J.session.last_close)) + " (as of the run)</div></div>" +
      '<div class="ue-k"><div class="l">Coverage</div><div class="v">' + withQ + ' <small class="s">/ ' + n + ' priced</small></div><div class="s">' + (nR ? nR + " via profile (quote not in FMP plan)" : "profiles cached 7 days · names resolved once") + "</div></div></div>" +
      (lr.stopped ? '<div class="unreach" style="margin-top:10px">⚠ Last run stopped early <small>— ' + esc(lr.stopped) + "</small></div>" : "") +
      ((lr.errors || []).length && !lr.stopped ? '<div class="ue-log" style="margin-top:8px">' + lr.errors.map(function (e) { return "⚠ " + esc(e); }).join("<br>") + "</div>" : "");
  }
  var EP_ORDER = ["quote", "profile", "search-name", "earnings-calendar", "earnings"];
  var EP_LABEL = { quote: "Real-time quote", profile: "Company profile", "search-name": "Search by company name",
    "earnings-calendar": "Earnings calendar", earnings: "Earnings by symbol" };
  function stBadge(e) {
    if (!e) return '<span class="ue-st unk">not checked</span>';
    return { ok: '<span class="ue-st ok">✓ in plan</span>', partial: '<span class="ue-st partial">◐ some symbols</span>',
      not_in_plan: '<span class="ue-st no">✕ not in plan</span>' }[e.status] || '<span class="ue-st unk">error</span>';
  }
  function planTile() {
    var E = J.endpoints || {};
    return '<div class="tile" style="margin-top:14px"><h2>FMP plan coverage <span class="h2note">— what your key can call, and what the desk uses instead when it can’t</span></h2>' +
      '<div class="tbl-scroll"><table class="ue-ep"><thead><tr><th>Endpoint</th><th>Status</th><th>When it isn’t available</th><th>Checked</th></tr></thead><tbody>' +
      EP_ORDER.map(function (k) { var e = E[k], use = e && (e.status === "not_in_plan" || e.status === "partial");
        var who = e && e.status === "partial" ? '<br><code>works: ' + esc((e.ok_syms || []).join(", ")) + " · refused: " + esc((e.blocked_syms || []).join(", ")) + "</code>" : "";
        return "<tr><td><b>" + esc((e && e.label) || EP_LABEL[k]) + "</b><br><code>/stable/" + esc(k) + "</code></td><td>" + stBadge(e) + who +
          (e && e.last_error ? '<br><code style="color:var(--amber)">last error: ' + esc(e.last_error.msg) + "</code>" : "") + "</td>" +
          "<td>" + (use ? '<b style="color:var(--amber)">In use → </b>' : "") + esc((e && e.fallback) || (k === "earnings-calendar" || k === "earnings" ? "Not wired in yet." : "")) + "</td>" +
          '<td><span class="ue-age">' + esc(e ? ago(e.checked_at) : "—") + "</span></td></tr>"; }).join("") +
      '</tbody></table></div><div class="stamp">Statuses update for free from every normal run. “Earnings by symbol” is only re-checked on a run with “Check which FMP endpoints my plan allows” ticked (~4 calls).</div></div>';
  }
  function table() {
    var L = sorted();
    if (!V.sel || !L.some(function (r) { return r.s === V.sel; })) V.sel = L.length ? L[0].s : null;
    function th(id, l, left) { return "<th" + (left ? ' style="text-align:left"' : "") + '><button class="' + (V.sort === id ? "on" : "") + '" data-uesort="' + id + '">' + l + (V.sort === id ? (V.dir < 0 ? " ▾" : " ▴") : "") + "</button></th>"; }
    return '<div class="tile"><h2>Watchlist <span class="h2note">— FMP real-time quote, as of each row’s last run · click a row for the company profile</span></h2><div class="tbl-scroll"><table class="ue-t"><thead><tr>' +
      th("sym", "Company", 1) + th("px", "Last") + "<th>Chg</th>" + th("pct", "Chg %") + "<th>Day range</th><th>52-wk</th>" + th("vol", "Vol / avg") + th("mcap", "Mkt cap") + th("sector", "Sector", 1) + "</tr></thead><tbody>" +
      L.map(function (r) { var q = r.q, old = r.at && Date.now() - Date.parse(r.at) > 864e5;
        var qerr = r.c.quote_error && r.px == null;
        return '<tr data-uesym="' + esc(r.s) + '" class="' + (r.s === V.sel ? "on" : "") + '"><td><span class="ue-sym">' + esc(r.s) + '</span><span class="ue-nm">' +
            (qerr ? '<span style="color:var(--amber)">⚠ quote failed: ' + esc(r.c.quote_error.msg) + "</span>" : esc(r.name || "—")) + "</span>" +
            (function () { var nr = nextReport(r.s); if (!nr) return ""; var d = daysTo(nr.date);
              return '<span class="ue-nm" style="color:' + (d <= 7 ? "var(--amber)" : "var(--cyan)") + '">reports ' + (d === 0 ? "today" : esc(dayLbl(nr.date)) + " · " + d + " d") + "</span>"; })() + "</td>" +
          "<td>" + num(r.px, 2) + (r.at ? '<span class="ue-age' + (old ? " old" : "") + '" style="display:block"' + (r.viaP ? ' title="Quote endpoint is not in the FMP plan for this symbol — price, change and volume come from the profile call"' : "") + ">" + esc(ago(r.at)) + (r.viaP ? " · profile" : "") + "</span>" : "") + "</td><td>" + sg(r.ch, 2) + "</td><td>" + sg(r.pct, 2, "%") + "</td>" +
          "<td>" + (q.dayLow != null ? num(q.dayLow, 2) + " – " + num(q.dayHigh, 2) : "—") + "</td><td>" + rangeBar(r.ylo, r.yhi, r.px) + "</td>" +
          "<td>" + (r.vol != null ? big(r.vol) + (r.avgv ? ' <small class="ue-age">' + (r.vol / r.avgv).toFixed(1) + "×</small>" : "") : "—") + "</td>" +
          "<td>" + big(r.mcap) + '</td><td class="ue-sec" title="' + esc(r.ind) + '">' + esc(r.sector || "—") + "</td></tr>"; }).join("") +
      "</tbody></table></div>" + (L.length ? "" : '<p class="note">The watchlist is empty — edit scripts/data/earnings_watchlist.json.</p>') + "</div>";
  }
  function profileCard() {
    var C = (J.companies || {})[V.sel] || {}, p = C.profile, q = C.quote || {};
    if (!V.sel) return "";
    if (!p) return '<div class="tile"><h2>Company profile</h2><p class="note">' + (C.profile_error ? "⚠ " + esc(C.profile_error.msg) : "No profile stored for " + esc(V.sel) + " yet — the next run fetches it.") + "</p></div>";
    var site = /^https?:\/\//.test(p.website || "") ? p.website : null, img = /^https:\/\//.test(p.image || "") ? p.image : null;
    var desc = p.description || "", short = desc.length > 520 ? desc.slice(0, 520).replace(/\s+\S*$/, "") + "…" : desc;
    return '<div class="tile"><h2>Company profile <span class="h2note">— FMP profile, cached 7 days · fetched ' + esc(ago(p.fetched_at)) + "</span></h2>" +
      '<div class="ue-pf">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" onerror="this.remove()">' : "") +
        "<div><h3>" + esc(p.companyName || V.sel) + "</h3><small>" + esc(V.sel) + " · " + esc(p.exchangeFullName || p.exchange || "") + (p.currency ? " · " + esc(p.currency) : "") + "</small></div></div>" +
      '<dl class="ue-dl"><dt>Sector</dt><dd>' + esc(p.sector || "—") + "</dd><dt>Industry</dt><dd>" + esc(p.industry || "—") + "</dd><dt>CEO</dt><dd>" + esc(p.ceo || "—") +
        "</dd><dt>Country</dt><dd>" + esc(p.country || "—") + "</dd><dt>Employees</dt><dd>" + (p.fullTimeEmployees ? num(+p.fullTimeEmployees, 0) : "—") +
        "</dd><dt>Market cap</dt><dd>" + big(q.marketCap || p.marketCap) + "</dd><dt>Beta</dt><dd>" + num(p.beta, 2) + "</dd><dt>Last dividend</dt><dd>" + (p.lastDividend != null ? num(p.lastDividend, 2) : "—") +
        "</dd><dt>50D / 200D avg</dt><dd>" + num(q.priceAvg50, 2) + " / " + num(q.priceAvg200, 2) + "</dd><dt>Listed since</dt><dd>" + esc(p.ipoDate || "—") + "</dd></dl>" +
      (short ? '<p class="ue-desc">' + esc(short) + "</p>" : "") + (site ? '<a class="ue-btn" href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">Company site ↗</a>' : "") + "</div>";
  }
  function todayNY() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); }
  function dayLbl(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
  function daysTo(d) { return Math.round((Date.parse(d + "T12:00:00Z") - Date.parse(todayNY() + "T12:00:00Z")) / 864e5); }
  function nextReport(sym) {
    var C = J.calendar, t = todayNY(); if (!C || !C.rows) return null;
    return C.rows.filter(function (r) { return r.symbol === sym && r.date >= t; })[0] || null;
  }
  function earningsSlot() {
    var C = J.calendar, ec = (J.endpoints || {})["earnings-calendar"];
    if (ec && ec.status === "not_in_plan")
      return '<div class="tile" style="margin-top:14px"><h2>Earnings dates &amp; results</h2><div class="ue-ph">The earnings calendar is not in this FMP plan, so there is nothing to show — see FMP plan coverage below.</div></div>';
    if (!C || !C.fetched_at)
      return '<div class="tile" style="margin-top:14px"><h2>Earnings dates &amp; results</h2><div class="ue-ph">Not fetched yet — the next run of the Action makes one earnings-calendar call for every ticker.</div></div>';
    var t = todayNY(), up = C.rows.filter(function (r) { return r.date >= t && r.epsActual == null; }),
        past = C.rows.filter(function (r) { return r.date <= t && (r.epsActual != null || r.revenueActual != null); }).reverse(),
        pend = C.rows.filter(function (r) { return r.date <= t && r.epsActual == null && r.revenueActual == null; });
    var head = '<div class="tile" style="margin-top:14px"><h2>Earnings dates &amp; results <span class="h2note">— FMP earnings calendar ' + esc(C.from) + " to " + esc(C.to) + " · fetched " + esc(ago(C.fetched_at)) + "</span></h2>";
    if (!C.rows.length)
      return head + '<div class="ue-ph">The calendar returned ' + (C.rows_total || 0) + " row" + (C.rows_total === 1 ? "" : "s") + " across " + (C.symbols_total || 0) +
        " companies for this window, none of them on your watchlist. In earnings season that is thin: this FMP plan may cover only part of the calendar.</div></div>";
    function surp(v) { return v == null ? '<span class="neu">—</span>' : sg(v, 1, "%"); }
    return head +
      '<div class="pi-l" style="margin:6px 0 2px">Next reports</div>' +
      (up.length ? '<div class="tbl-scroll"><table class="ue-t"><thead><tr><th>Company</th><th>Date</th><th>In</th><th>When</th><th>EPS est.</th><th>Revenue est.</th></tr></thead><tbody>' +
        up.map(function (r) { var n = daysTo(r.date); return '<tr data-uesym="' + esc(r.symbol) + '"><td><span class="ue-sym">' + esc(r.symbol) + "</span></td><td>" + esc(dayLbl(r.date)) + "</td><td>" +
          (n === 0 ? '<b style="color:var(--amber)">today</b>' : n + " d") + "</td><td>" + esc(({ bmo: "before open", amc: "after close" })[r.time] || "—") + "</td><td>" + num(r.epsEstimated, 2) + "</td><td>" + big(r.revenueEstimated) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="note">No watchlist name reports in the next ' + 60 + " days.</p>") +
      (pend.length ? '<p class="note" style="color:var(--amber)">Reported, actuals not in yet: ' + pend.map(function (r) { return esc(r.symbol) + " (" + esc(dayLbl(r.date)) + ")"; }).join(", ") + " — the next run re-checks (at most hourly).</p>" : "") +
      '<div class="pi-l" style="margin:12px 0 2px">Recent results — actual vs estimate</div>' +
      (past.length ? '<div class="tbl-scroll"><table class="ue-t"><thead><tr><th>Company</th><th>Date</th><th>EPS act.</th><th>EPS est.</th><th>Surprise</th><th>Revenue act.</th><th>Revenue est.</th><th>Surprise</th></tr></thead><tbody>' +
        past.map(function (r) { return '<tr data-uesym="' + esc(r.symbol) + '"><td><span class="ue-sym">' + esc(r.symbol) + "</span></td><td>" + esc(dayLbl(r.date)) + "</td><td>" + num(r.epsActual, 2) + "</td><td>" + num(r.epsEstimated, 2) +
          "</td><td>" + surp(r.eps_surprise_pct) + "</td><td>" + big(r.revenueActual) + "</td><td>" + big(r.revenueEstimated) + "</td><td>" + surp(r.rev_surprise_pct) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="note">No watchlist results in the last 3 weeks.</p>') +
      '<div class="stamp">Surprise = (actual − estimate) ÷ |estimate|. Coverage this fetch: ' + (C.rows_total || 0) + " rows across " + (C.symbols_total || 0) + " companies. One call covers every ticker; it repeats at most daily, or hourly while a report is out without actuals.</div></div>";
  }
  function footer() {
    var pol = J.policy || {}, res = J.resolved || {}, rk = Object.keys(res);
    return '<div class="tile wide" style="margin-top:14px"><div class="stamp">Call policy — quote: ' + esc(pol.quote || "") + " · profile: " + esc(pol.profile || "") + " · search: " + esc(pol.search || "") +
      " · budget: " + esc(pol.budget || "") + "." + (rk.length ? "<br>Names resolved: " + rk.map(function (k) { var r = res[k]; return esc(r.query || k) + " → " + (r.symbol ? "<b>" + esc(r.symbol) + "</b>" : "no US match"); }).join(" · ") : "") +
      "<br>Add a company: Actions → US earnings (prototype) → Run workflow, type the name (one search call), then add the ticker to scripts/data/earnings_watchlist.json to keep it." +
      " Updated " + esc(when(J.updated_at)) + " · " + esc(J.provider || "") + ".</div></div>";
  }
  function render() {
    if (!J) {
      P.innerHTML = '<div class="tile wide">' + protoBar() + (err === "empty"
        ? '<div class="ue-ph"><b>No data yet.</b> Nothing has called FMP so far. Open <a href="' + RUN + '" target="_blank" rel="noopener noreferrer">Actions → US earnings (prototype)</a> and press <b>Run workflow</b>: the first run uses about 20 calls (one quote and one profile per watchlist symbol); after that a run uses only what can have changed.</div>'
        : err ? '<div class="unreach">⚠ Sorry, we can’t be reached now <small>— earnings.json did not load; use Reload data to try again</small></div>'
        : '<p class="note">Loading…</p>') + "</div>";
      return;
    }
    P.innerHTML = '<div class="tile wide">' + protoBar() + '<h2>US earnings <span class="h2note">— grain &amp; ag-input names on US exchanges · Financial Modeling Prep</span></h2>' + topStrip() + "</div>" +
      '<div class="ue-grid"><div>' + table() + earningsSlot() + "</div><div>" + profileCard() + "</div></div>" + planTile() + footer();
  }

  P.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-uesort]"); if (b) { var k = b.getAttribute("data-uesort"); V.dir = V.sort === k ? -V.dir : (k === "sym" || k === "sector" ? 1 : -1); V.sort = k; save(); render(); return; }
    b = t.closest("[data-ue]"); if (b && b.getAttribute("data-ue") === "reload") { etag = ""; poll(true); return; }
    b = t.closest("[data-uesym]"); if (b) { V.sel = b.getAttribute("data-uesym"); save(); render(); }
  });
  /* the JSON only changes when someone runs the Action, so fetch on open (at most once a minute) — no background polling */
  BTN.addEventListener("click", function () { render(); poll(); });
  window.addEventListener("desk:unlock", function () { if (P.classList.contains("active")) poll(true); });
  window.EARNINGS = { render: render, poll: poll, _data: function () { return J; } };
  render();
})();
