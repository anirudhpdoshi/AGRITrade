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
  var J = null, err = null, etag = "", lastTry = 0, busy = false, M = null, mEtag = "";
  var V = (function () { try { return JSON.parse(localStorage.getItem("desk.earningsView") || "{}"); } catch (e) { return {}; } })();
  V.sort = V.sort || "mcap"; V.dir = V.dir || -1; V.view = V.view || "market"; V.idx = V.idx || "dji";
  V.fw = V.fw || "all"; V.ft = V.ft || "any"; var ask = null, idxOpen = null, seaCell = null, q = "";
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
    ".ut-hdr{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:10px}" +
    ".ut-ix{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:8px 11px;min-width:0}" +
    ".ut-ix:hover,.ut-ix.on{border-color:#3d5a80}.ut-ix .n{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".ut-ix .v{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;margin:1px 0}.ut-ix .c{font-family:'IBM Plex Mono',monospace;font-size:12px}" +
    ".ut-ix .m{font-size:10.5px;color:var(--faint);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ut-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:1px}" +
    ".ut-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:8px 10px;margin-bottom:10px;position:relative}" +
    ".ut-q{flex:1;min-width:200px;max-width:420px;background:var(--bg);border:1px solid var(--line2);border-radius:7px;color:var(--ink);font:inherit;font-size:14px;padding:7px 10px}" +
    ".ut-q:focus{outline:2px solid var(--cyan);outline-offset:1px}.ut-q:disabled{opacity:.55}" +
    ".ut-dd{position:absolute;top:calc(100% - 4px);left:10px;width:min(560px,calc(100% - 20px));z-index:30;background:var(--panel);border:1px solid var(--line2);border-radius:9px;box-shadow:0 12px 30px rgba(0,0,0,.45);max-height:330px;overflow:auto}" +
    ".ut-dd button{display:grid;grid-template-columns:64px 1fr auto;gap:10px;width:100%;text-align:left;appearance:none;border:0;border-bottom:1px solid var(--line);background:none;color:var(--ink);font:inherit;font-size:13px;padding:8px 11px;cursor:pointer}" +
    ".ut-dd button:hover,.ut-dd button:focus{background:rgba(56,182,201,.09)}.ut-dd small{color:var(--faint)}" +
    ".ut-ctx{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}.ut-ctx b{font-family:'IBM Plex Mono',monospace;font-size:15px;color:var(--ink)}" +
    ".ut-lock{appearance:none;border:1px solid var(--line2);background:var(--panel2);color:var(--ink);border-radius:7px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}" +
    ".ut-lock[aria-pressed=true]{border-color:var(--amber);color:var(--amber);background:rgba(232,163,61,.08)}" +
    ".ut-shell{display:grid;grid-template-columns:196px minmax(0,1fr) 340px;gap:12px;align-items:start}" +
    ".ut-nav{position:sticky;top:calc(var(--strip-h,40px) + 8px);border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:8px}" +
    ".ut-nav .g{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--faint);padding:8px 8px 4px}" +
    ".ut-nav button{display:flex;justify-content:space-between;align-items:center;width:100%;appearance:none;border:0;background:none;color:var(--muted);font:inherit;font-size:13px;text-align:left;padding:6px 8px;border-radius:6px;cursor:pointer}" +
    ".ut-nav button:hover:not(:disabled){background:rgba(255,255,255,.04);color:var(--ink)}.ut-nav button[aria-current=true]{background:#1a2a42;color:#fff;box-shadow:inset 2px 0 0 var(--cyan)}" +
    ".ut-nav button:disabled{opacity:.42;cursor:default}.ut-nav small{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint)}" +
    ".ut-feed{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:10px 12px;position:sticky;top:calc(var(--strip-h,40px) + 8px);max-height:calc(100vh - var(--strip-h,40px) - 24px);overflow:auto}" +
    ".ut-feed h3{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin:12px 0 5px;display:flex;justify-content:space-between}.ut-feed h3 small{letter-spacing:0;text-transform:none;color:var(--faint);font-weight:400}" +
    ".ut-chips{display:flex;gap:5px;flex-wrap:wrap}.ut-chips button{appearance:none;border:1px solid var(--line2);background:none;color:var(--muted);border-radius:12px;padding:2px 9px;font:inherit;font-size:11.5px;cursor:pointer}" +
    ".ut-chips button[aria-pressed=true]{border-color:var(--cyan);color:var(--ink);background:rgba(56,182,201,.1)}" +
    ".ut-ev{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;appearance:none;text-align:left;font:inherit;color:inherit;border:0;border-bottom:1px solid var(--line);background:none;padding:7px 2px;cursor:pointer}" +
    ".ut-ev:hover{background:rgba(255,255,255,.025)}.ut-ev .t{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:13px}.ut-ev .d{font-size:11.5px;color:var(--faint)}" +
    ".ut-ev .r{font-family:'IBM Plex Mono',monospace;font-size:11.5px;text-align:right;color:var(--muted)}.ut-star{color:var(--amber);font-size:10px;margin-left:3px}" +
    ".ut-b{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:9px;border:1px solid}" +
    ".ut-b.beat{color:var(--green);border-color:rgba(63,185,127,.5)}.ut-b.miss{color:var(--red);border-color:rgba(224,101,95,.5)}.ut-b.inl,.ut-b.na{color:var(--faint);border-color:var(--line2)}.ut-b.wait{color:var(--amber);border-color:rgba(232,163,61,.5)}" +
    ".ut-ask{border:1px solid var(--amber);border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12.5px;background:rgba(232,163,61,.06)}" +
    ".ut-detail{border:1px solid #3d5a80;background:var(--panel);border-radius:10px;padding:12px 14px;margin:-2px 0 10px;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px}" +
    "table.hm{border-collapse:separate;border-spacing:2px;width:100%}table.hm th{font-size:10.5px;padding:4px 6px;text-align:center}table.hm th:first-child{text-align:left}" +
    "table.hm td{font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:center;padding:7px 4px;border:0;border-radius:4px;cursor:pointer;color:var(--ink);min-width:58px}" +
    "table.hm td.mo{text-align:left;font-family:'Libre Franklin',sans-serif;color:var(--muted);background:none;cursor:default;min-width:44px}" +
    "table.hm td.na{background:repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 4px,transparent 4px 8px);color:var(--faint);cursor:default}" +
    "table.hm td.sel{outline:2px solid var(--ink);outline-offset:-2px}table.hm tr.tot td{font-weight:700;border-top:1px solid var(--line2)}" +
    "table.hm .gap{width:10px;min-width:10px;background:none;cursor:default}table.hm td.ytd{opacity:.8}" +
    ".hm-leg{display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--faint);margin-top:8px}.hm-leg i{display:block;width:22px;height:10px;border-radius:2px}" +
    ".ut-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}" +
    "@media (max-width:1280px){.ut-shell{grid-template-columns:180px minmax(0,1fr)}.ut-feed{grid-column:1/-1;position:static;max-height:none}}" +
    "@media (max-width:860px){.ut-shell{grid-template-columns:1fr}.ut-nav{position:static;display:flex;gap:4px;overflow-x:auto;padding:6px}.ut-nav .g{display:none}.ut-nav button{white-space:nowrap;width:auto}" +
    ".ut-hdr{grid-template-columns:repeat(2,minmax(0,1fr))}.ut-detail,.ut-sum{grid-template-columns:1fr}}" +
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
  function get(file, tag, cb) {
    var h = { Accept: "application/vnd.github.raw+json" }; if (tag) h["If-None-Match"] = tag;
    return fetch("https://api.github.com/repos/" + REPO + "/contents/" + file + "?ref=earnings", { headers: h, cache: "no-store" })
      .then(function (r) { if (r.status === 304) return null; if (r.status === 404) throw 404; if (!r.ok) throw r.status; cb(r.headers.get("ETag") || ""); return r.json(); })
      .catch(function (e) { if (e === 404) throw 404;
        return fetch("https://raw.githubusercontent.com/" + REPO + "/earnings/" + file + "?t=" + Date.now(), { cache: "no-store" })
          .then(function (r) { if (r.status === 404) throw 404; if (!r.ok) throw r.status; return r.json(); }); });
  }
  function poll(force) {
    if (window.DESK_LOCKED || busy) return; if (!force && Date.now() - lastTry < 60000) return; lastTry = Date.now(); busy = true;
    if (window.WORLD && WORLD.poll) try { WORLD.poll(); } catch (e) {}
    var a = get("earnings.json", etag, function (t) { etag = t; }).then(function (j) { if (j) J = j; err = null; })
      .catch(function (e) { err = e === 404 ? "empty" : "down"; });
    var b = get("market.json", mEtag, function (t) { mEtag = t; }).then(function (j) { if (j) M = j; }).catch(function () {});
    Promise.all([a, b]).then(function () { busy = false; render(); });
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
    var t = todayNY(), W = C.rows.filter(function (r) { return r.w; }), up = W.filter(function (r) { return r.date >= t && r.epsActual == null; }),
        past = W.filter(function (r) { return r.date <= t && (r.epsActual != null || r.revenueActual != null); }).reverse(),
        pend = W.filter(function (r) { return r.date <= t && r.epsActual == null && r.revenueActual == null; });
    var head = '<div class="tile" style="margin-top:14px"><h2>Earnings dates &amp; results <span class="h2note">— FMP earnings calendar ' + esc(C.from) + " to " + esc(C.to) + " · fetched " + esc(ago(C.fetched_at)) + "</span></h2>";
    if (!W.length)
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
  /* ================= TERMINAL SHELL: header · ticker bar · nav | workspace | earnings feed ================= */
  var HDR = [["dji", "Dow Jones", "DJI"], ["ixic", "Nasdaq Composite", "IXIC"], ["rut", "Russell 2000", "RUT"], ["vix", "CBOE VIX", "VIX"], ["dxy", "US Dollar Index", "ICE DXY"]];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function wInst(id) { var W = window.WORLD && WORLD._data ? WORLD._data() : null; if (!W || !W.instruments) return null;
    var L = W.instruments; return Array.isArray(L) ? L.filter(function (x) { return x.id === id; })[0] || null : L[id] || null; }
  function stDot(st) { var c = st === "open" ? "var(--green)" : st === "pre" || st === "post" ? "var(--amber)" : "var(--faint)"; return '<span class="ut-dot" style="background:' + c + '"></span>'; }
  function header() {
    return '<div class="ut-hdr">' + HDR.map(function (h) { var x = wInst(h[0]), d = x ? (x.dec != null ? x.dec : 2) : 2;
      if (!x || x.last == null) return '<div class="ut-ix" aria-disabled="true"><div class="n">' + h[1] + ' · ' + h[2] + '</div><div class="v neu">—</div><div class="m">' +
        (h[0] === "ixic" && x == null ? "added to the World feed — appears after its next run" : "unavailable from the free feed") + "</div></div>";
      return '<button class="ut-ix' + (idxOpen === h[0] ? " on" : "") + '" data-utix="' + h[0] + '" title="Previous close ' + num(x.prev_close, d) + " · " + esc(x.provider || "") + '"><div class="n">' + h[1] + " · " + h[2] + "</div>" +
        '<div class="v">' + num(x.last, d) + '</div><div class="c">' + sg(x.chg, d) + " │ " + sg(x.pct, 2, "%") + "</div>" +
        '<div class="m">' + stDot(x.status) + esc(x.status_label || x.status || "") + " · prev " + num(x.prev_close, d) + " · " + esc(x.ts ? when(x.ts) : "—") + (x.delay_min != null && x.status === "open" ? " · " + Math.round(x.delay_min) + "m delayed" : " · delayed") + "</div></button>"; }).join("") + "</div>";
  }
  function spark(vals, w, h) {
    if (!vals || vals.length < 2) return '<p class="note">No recent closes.</p>';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), r = hi - lo || 1, pad = 4;
    var pts = vals.map(function (v, i) { return [pad + i / (vals.length - 1) * (w - 2 * pad), pad + (1 - (v - lo) / r) * (h - 2 * pad)]; });
    var up = vals[vals.length - 1] >= vals[0], col = up ? "var(--green)" : "var(--red)", last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" role="img" aria-label="Last ' + vals.length + ' closes, ' + num(vals[0], 2) + " to " + num(vals[vals.length - 1], 2) + '">' +
      '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + pts[0][1].toFixed(1) + '" y2="' + pts[0][1].toFixed(1) + '" stroke="var(--line2)" stroke-dasharray="3 3"/>' +
      '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="' + col + '" stroke="var(--panel)" stroke-width="2"/></svg>' +
      '<div class="hm-leg" style="justify-content:space-between"><span>low ' + num(lo, 2) + "</span><span>" + vals.length + " sessions</span><span>high " + num(hi, 2) + "</span></div>";
  }
  function indexDetail() {
    if (!idxOpen) return ""; var x = wInst(idxOpen), h = HDR.filter(function (k) { return k[0] === idxOpen; })[0]; if (!x) return "";
    var w = x.w52 || {}, S = M && M.seasonality && M.seasonality[idxOpen], d = x.dec != null ? x.dec : 2;
    return '<div class="ut-detail tile"><div><div class="pi-l">' + esc(h[1]) + " — last " + ((x.spark || []).length) + " sessions" +
      (idxOpen === "dxy" ? ' <span class="h2note">· ICE US Dollar Index (DX-Y.NYB), shown because Bloomberg BBDXY has no free source</span>' : "") + "</div>" + spark(x.spark, 520, 120) + "</div>" +
      '<div><dl class="ue-dl" style="margin:0"><dt>Last</dt><dd>' + num(x.last, d) + "</dd><dt>Change</dt><dd>" + sg(x.chg, d) + " │ " + sg(x.pct, 2, "%") + "</dd><dt>Previous close</dt><dd>" + num(x.prev_close, d) +
        "</dd><dt>Day range</dt><dd>" + num(x.low, d) + " – " + num(x.high, d) + "</dd><dt>52-week range</dt><dd>" + num(w.low, d) + " – " + num(w.high, d) + "</dd><dt>Off 52-wk high</dt><dd>" + (w.pct_from_high != null ? "−" + num(w.pct_from_high, 1) + "%" : "—") + "</dd>" +
        (S && S.ytd && S.ytd.total != null ? "<dt>" + S.ytd.year + " YTD (to " + esc(S.ytd.through) + ")</dt><dd>" + sg(S.ytd.total, 1, "%") + "</dd>" : "") + "</dl>" +
        '<div class="stamp">' + esc(x.provider || "") + " · " + esc(x.sym || "") + " · as of " + esc(x.ts ? when(x.ts) : "—") + ". Delayed data, never labelled live. " +
        (S ? '<button class="ue-btn" data-utgo="season" data-utidx="' + idxOpen + '">Open seasonality ›</button>' : "") + " <button class=\"ue-btn\" data-utix=\"" + idxOpen + "\">Close ✕</button></div></div></div>";
  }
  function universe() { return rows().map(function (r) { return { s: r.s, name: r.name, sector: r.sector, ind: r.ind, ex: r.p.exchange || r.q.exchange || "" }; }); }
  function tickerBar() {
    var sel = V.sel ? rows().filter(function (r) { return r.s === V.sel; })[0] : null, hits = [];
    if (q && !V.lock) { var k = q.toLowerCase();
      hits = universe().filter(function (u) { return u.s.toLowerCase().indexOf(k) === 0 || (u.name || "").toLowerCase().indexOf(k) >= 0; }).slice(0, 8); }
    return '<div class="ut-bar"><input class="ut-q" data-utq type="search" autocomplete="off" spellcheck="false" placeholder="' + (V.lock ? "Ticker locked — unlock to switch company" : "Search ticker or company name (e.g. ADM, Deere, fert…)") + '" value="' + esc(q) + '"' + (V.lock ? " disabled" : "") + ' aria-label="Search ticker or company">' +
      '<div class="ut-ctx">' + (sel ? "Researching <b>" + esc(sel.s) + "</b> " + esc(sel.name) : "No company selected — market view") + "</div>" +
      (sel ? '<button class="ut-lock" data-utlock aria-pressed="' + !!V.lock + '" title="Lock keeps this company as the research context; market data and the earnings feed keep updating">' + (V.lock ? "🔒 Locked" : "🔓 Unlocked") + "</button>" : "") +
      '<small class="ue-age" style="margin-left:auto">Search universe: ' + universe().length + " watchlist names · full universe in phase 2</small>" +
      (hits.length ? '<div class="ut-dd" role="listbox">' + hits.map(function (u) { return '<button role="option" data-utpick="' + esc(u.s) + '"><b style="font-family:\'IBM Plex Mono\',monospace">' + esc(u.s) + "</b><span>" + esc(u.name || "") + "<br><small>" + esc(u.sector || "—") + " · " + esc(u.ind || "—") + "</small></span><small>" + esc(u.ex) + "</small></button>"; }).join("") + "</div>"
        : q && !V.lock ? '<div class="ut-dd"><div class="note" style="padding:10px">No watchlist name matches “' + esc(q) + '”.</div></div>' : "") + "</div>";
  }
  var COMPANY_SECTIONS = [["co-overview", "Company overview", 1], ["stmts", "Earnings & statements"], ["wc", "Working capital"], ["fcf", "FCF & allocation"],
    ["debt", "Debt & financing"], ["ratios", "Ratios & health"], ["seg", "Segments & industry"], ["research", "Earnings research"]];
  function nav() {
    function b(id, label, on, note) { return '<button data-utgo="' + id + '" aria-current="' + (V.view === id) + '"' + (on ? "" : " disabled") + ">" + label + (note ? "<small>" + note + "</small>" : "") + "</button>"; }
    return '<nav class="ut-nav" aria-label="US earnings sections"><div class="g">Market</div>' + b("market", "Market overview", 1) + b("season", "Seasonality", 1) + b("plan", "Data &amp; plan coverage", 1) +
      '<div class="g">Company' + (V.sel ? " · " + esc(V.sel) : "") + "</div>" +
      COMPANY_SECTIONS.map(function (c) { return b(c[0], c[1], c[2] && V.sel, c[2] ? (V.sel ? "" : "pick") : "ph 2"); }).join("") + "</nav>";
  }
  /* ---------- right: earnings intelligence feed (independent of the company lock) ---------- */
  function addDays(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function verdict(r) {
    if (r.epsActual == null && r.revenueActual == null) return r.date >= todayNY() ? '<span class="ut-b na">scheduled</span>' : '<span class="ut-b wait">awaiting results</span>';
    var v = r.eps_surprise_pct; if (v == null) return '<span class="ut-b na">no consensus</span>';
    return Math.abs(v) < 1 ? '<span class="ut-b inl">in line</span>' : v > 0 ? '<span class="ut-b beat">beat ' + num(v, 1) + "%</span>" : '<span class="ut-b miss">miss ' + num(-v, 1) + "%</span>";
  }
  function tlbl(t) { return ({ bmo: "BMO", amc: "AMC", dmh: "during hours" })[t] || "time n/a"; }
  function feed() {
    var C = J && J.calendar; if (!C || !C.fetched_at) return '<aside class="ut-feed tile"><h3>Earnings feed</h3><p class="note">The calendar has not been fetched yet — the next run of the Action makes one call for the whole market.</p></aside>';
    var t = todayNY(), tm = addDays(t, 1), dow = new Date(t + "T12:00:00Z").getUTCDay(), eow = addDays(t, 7 - (dow || 7)), eonw = addDays(eow, 7);
    var L = C.rows.filter(function (r) { return (V.fw === "all" || r.w) && (V.ft === "any" || r.time === V.ft); });
    var rel = L.filter(function (r) { return r.epsActual != null || r.revenueActual != null; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 25);
    var up = L.filter(function (r) { return r.epsActual == null && r.revenueActual == null && r.date >= t; });
    var late = L.filter(function (r) { return r.epsActual == null && r.revenueActual == null && r.date < t && r.date >= addDays(t, -3); });
    function ev(r) { return '<button class="ut-ev" data-utev="' + esc(r.symbol) + '"><span><span class="t">' + esc(r.symbol) + "</span>" + (r.w ? '<span class="ut-star" title="On your watchlist">★</span>' : "") +
      ' <span class="d">' + esc(dayLbl(r.date)) + " · " + tlbl(r.time) + "</span></span><span>" + verdict(r) + "</span>" +
      '<span class="d">' + (r.epsActual != null ? "EPS " + num(r.epsActual, 2) + " vs " + (r.epsEstimated != null ? num(r.epsEstimated, 2) : "n/a") : "EPS est " + (r.epsEstimated != null ? num(r.epsEstimated, 2) : "unavailable")) + "</span>" +
      '<span class="r">' + (r.revenueActual != null ? "Rev " + big(r.revenueActual) + " vs " + (r.revenueEstimated != null ? big(r.revenueEstimated) : "n/a") : "Rev est " + (r.revenueEstimated != null ? big(r.revenueEstimated) : "n/a")) + "</span></button>" +
      (ask === r.symbol ? askBox(r.symbol) : ""); }
    function grp(title, list) { return list.length ? "<h3>" + title + "<small>" + list.length + "</small></h3>" + list.map(ev).join("") : ""; }
    var today = up.filter(function (r) { return r.date === t; }), tom = up.filter(function (r) { return r.date === tm; }),
        wk = up.filter(function (r) { return r.date > tm && r.date <= eow; }), nwk = up.filter(function (r) { return r.date > eow && r.date <= eonw; });
    function chip(k, v, l) { return '<button data-utf="' + k + ":" + v + '" aria-pressed="' + (V[k] === v) + '">' + l + "</button>"; }
    return '<aside class="ut-feed tile" aria-label="Earnings intelligence feed"><div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">Earnings feed</h2><span class="ue-age">fetched ' + esc(ago(C.fetched_at)) + "</span></div>" +
      '<div class="ut-chips" style="margin-top:8px">' + chip("fw", "all", "All companies") + chip("fw", "w", "★ Watchlist") + "</div>" +
      '<div class="ut-chips" style="margin-top:5px">' + chip("ft", "any", "Any time") + chip("ft", "bmo", "BMO") + chip("ft", "amc", "AMC") + "</div>" +
      "<h3>Released<small>" + rel.length + "</small></h3>" + (rel.length ? rel.map(ev).join("") : '<p class="note">No published results in this window.</p>') +
      grp("Reported — awaiting numbers", late) + grp("Today", today) + grp("Tomorrow", tom) + grp("Later this week", wk) + grp("Next week", nwk) +
      (!today.length && !tom.length && !wk.length && !nwk.length ? '<h3>Upcoming</h3><p class="note">Nothing scheduled in the next two weeks for this filter.</p>' : "") +
      '<div class="stamp">Window ' + esc(C.from) + " → " + esc(C.to) + " · " + (C.rows_total || 0) + " events across " + (C.symbols_total || 0) + " companies. Beat/miss is EPS vs consensus (in line = within ±1%); “no consensus” when FMP has no estimate — never inferred. " +
        "Release time is shown only when FMP provides it. Price reaction needs the quote endpoint, which this plan refuses. Sector, market-cap and index filters need data for every company in the feed — planned with the phase-2 universe.</div></aside>";
  }
  function askBox(sym) {
    return '<div class="ut-ask">' + esc(V.sel) + " is locked as your research company. <button class=\"ue-btn\" data-utswitch=\"" + esc(sym) + '">Switch to ' + esc(sym) + '</button> <button class="ue-btn" data-utask="">Keep ' + esc(V.sel) + "</button></div>";
  }
  function choose(sym) {   /* the one place the research company changes — a locked ticker is never overridden silently */
    var inU = universe().some(function (u) { return u.s === sym; });
    if (!inU) { ask = null; flash(sym + " is not in the research universe yet — it arrives with the phase-2 company build."); return; }
    if (V.lock && V.sel && V.sel !== sym) { ask = sym; render(); return; }
    V.sel = sym; ask = null; q = ""; if (V.view === "market" || V.view === "season" || V.view === "plan") V.view = "co-overview"; save(); render();
  }
  var flashMsg = "", flashT = 0;
  function flash(m) { flashMsg = m; clearTimeout(flashT); flashT = setTimeout(function () { flashMsg = ""; render(); }, 4500); render(); }
  /* ---------- centre: seasonality heatmap ---------- */
  function cellBg(v) {
    if (v == null) return "";
    var a = Math.abs(v); if (a < 0.25) return "background:rgba(176,189,207,.10)";
    var k = Math.min(a / 8, 1), al = (0.14 + 0.7 * Math.pow(k, 0.85)).toFixed(2);
    return "background:" + (v > 0 ? "rgba(63,185,127," : "rgba(224,101,95,") + al + ")";
  }
  function pc(v, d) { if (v == null) return "—"; var t = Math.abs(v).toFixed(d == null ? 1 : d); return (+t === 0 ? "" : v > 0 ? "+" : "−") + t + "%"; }
  function annualBars(S) {
    var ys = S.years, vals = ys.map(function (y) { return S.annual[y]; }), m = Math.max(5, Math.max.apply(null, vals.map(function (v) { return Math.abs(v || 0); }))) * 1.15;
    var W = 360, H = 150, z = H / 2, bw = W / (ys.length + 1) - 14;
    var bars = ys.map(function (y, i) { var v = S.annual[y]; if (v == null) return ""; var x = 30 + i * (W - 30) / ys.length, h = Math.abs(v) / m * (H / 2 - 16), up = v >= 0;
      return '<rect x="' + x.toFixed(1) + '" y="' + (up ? z - h : z).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" rx="3" fill="' + (up ? "var(--green)" : "var(--red)") + '"><title>' + y + ": " + pc(v) + "</title></rect>" +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (up ? z - h - 5 : z + h + 13).toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + pc(v, 0) + "</text>" +
        '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 1) + '" text-anchor="middle" font-size="10.5" fill="var(--faint)">' + y + "</text>"; }).join("");
    var av = S.avg_annual, ay = av == null ? null : z - av / m * (H / 2 - 16);
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Annual returns by year">' + '<line x1="24" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="var(--line2)"/>' + bars +
      (ay != null ? '<line x1="24" x2="' + W + '" y1="' + ay.toFixed(1) + '" y2="' + ay.toFixed(1) + '" stroke="var(--cyan)" stroke-dasharray="4 3"/><text x="' + (W - 2) + '" y="' + (ay - 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--cyan)">avg ' + pc(av) + "</text>" : "") + "</svg>";
  }
  function seasonView() {
    var Sx = M && M.seasonality; if (!Sx) return '<div class="tile"><h2>Market seasonality</h2><div class="ue-ph">Not built yet — the next run of the Action computes it from free Yahoo month-end closes (no FMP calls).</div></div>';
    if (!Sx[V.idx]) V.idx = Object.keys(Sx)[0]; var S = Sx[V.idx], ys = S.years, sm = S.summary || {};
    var tabs = [["dji", "Dow Jones"], ["ixic", "Nasdaq"], ["rut", "Russell 2000"]].filter(function (t) { return Sx[t[0]]; });
    var head = "<tr><th>Month</th>" + ys.map(function (y) { return "<th>" + y + "</th>"; }).join("") + '<th>5-yr avg</th><th class="gap"></th><th title="Year to date — excluded from every average">' + S.ytd.year + " YTD</th></tr>";
    var body = MON.map(function (mn, m) { var a = S.avg[m];
      return '<tr><td class="mo">' + mn + "</td>" + ys.map(function (y) { var v = S.grid[y][m];
          return v == null ? '<td class="na" title="No data">—</td>' : '<td data-utcell="' + y + ":" + m + '" class="' + (seaCell === y + ":" + m ? "sel" : "") + '" style="' + cellBg(v) + '" title="' + mn + " " + y + ": " + pc(v, 2) + '">' + pc(v) + "</td>"; }).join("") +
        '<td data-utcell="avg:' + m + '" style="' + cellBg(a.mean) + ';font-weight:700" title="' + a.pos + " of " + a.n + ' years positive">' + pc(a.mean) + '</td><td class="gap"></td>' +
        (S.ytd.months[m] == null ? '<td class="na">·</td>' : '<td class="ytd" style="' + cellBg(S.ytd.months[m]) + '">' + pc(S.ytd.months[m]) + "</td>") + "</tr>"; }).join("");
    var tot = '<tr class="tot"><td class="mo">Year</td>' + ys.map(function (y) { return '<td style="' + cellBg(S.annual[y] / 3) + '">' + pc(S.annual[y]) + "</td>"; }).join("") +
      '<td style="' + cellBg(S.avg_annual / 3) + '">' + pc(S.avg_annual) + '</td><td class="gap"></td><td class="ytd">' + pc(S.ytd.total) + "</td></tr>";
    var detail = "";
    if (seaCell) { var pr = seaCell.split(":"), m = +pr[1], a = S.avg[m];
      var obs = ys.map(function (y) { return y + " " + pc(S.grid[y][m]); }).join(" · ");
      detail = '<div class="ue-ph"><b>' + MON[m] + (pr[0] === "avg" ? " — five-year view" : " " + pr[0] + ": " + pc(S.grid[pr[0]][m], 2)) + "</b><br>" +
        "All five observations: " + obs + "<br>Average " + pc(a.mean, 2) + " · range " + pc(a.min) + " to " + pc(a.max) + " · positive in " + a.pos + " of " + a.n + " years." +
        (pr[0] !== "avg" && a.mean != null ? "<br>Versus its five-year average: " + pc(S.grid[pr[0]][m] - a.mean, 2).replace("%", " pp") + "." : "") + "</div>"; }
    function stat(l, v, s2) { return '<div class="ue-k"><div class="l">' + l + '</div><div class="v" style="font-size:16px">' + v + '</div><div class="s">' + s2 + "</div></div>"; }
    var bc = sm.best_cell, wc = sm.worst_cell;
    return '<div class="tile"><h2>Market seasonality <span class="h2note">— five-year monthly returns, ' + esc(S.name) + " (" + esc(S.symbol) + ")</span></h2>" +
      '<div class="ut-chips" style="margin:6px 0 10px">' + tabs.map(function (t) { return '<button data-utidx="' + t[0] + '" aria-pressed="' + (V.idx === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<div class="ut-sum">' + stat("Strongest month", bc ? pc(bc[0]) : "—", bc ? MON[bc[2]] + " " + bc[1] : "") + stat("Weakest month", wc ? pc(wc[0]) : "—", wc ? MON[wc[2]] + " " + wc[1] : "") +
        stat("Positive months", sm.positive_share != null ? Math.round(sm.positive_share * 100) + "%" : "—", sm.cells + " monthly observations") +
        stat("Best average month", sm.best_avg_month != null ? MON[sm.best_avg_month] + " " + pc(S.avg[sm.best_avg_month].mean) : "—", sm.best_avg_month != null ? S.avg[sm.best_avg_month].pos + " of 5 years positive" : "") +
        stat("Worst average month", sm.worst_avg_month != null ? MON[sm.worst_avg_month] + " " + pc(S.avg[sm.worst_avg_month].mean) : "—", sm.worst_avg_month != null ? S.avg[sm.worst_avg_month].pos + " of 5 years positive" : "") +
        stat("Avg annual return", pc(S.avg_annual), ys[0] + "–" + ys[ys.length - 1] + ", compounded per year") + "</div>" +
      '<div class="tbl-scroll"><table class="hm"><thead>' + head + "</thead><tbody>" + body + tot + "</tbody></table>" +
        '<div class="hm-leg">−8%+ <i style="' + cellBg(-8) + '"></i><i style="' + cellBg(-4) + '"></i><i style="' + cellBg(-1) + '"></i><i style="' + cellBg(0) + '"></i><i style="' + cellBg(1) + '"></i><i style="' + cellBg(4) + '"></i><i style="' + cellBg(8) + '"></i> +8%+ · grey = within ±0.25% · hatched = no data · click any cell for its five-year context</div></div>' +
      '<div class="ut-detail" style="margin:14px 0 0;border-color:var(--line)"><div><div class="pi-l">Annual return by year</div>' + annualBars(S) + '<p class="note" style="font-size:12px;margin:4px 0 0">December close to prior December close. Dashed line = five-year average; the five bars behind it stay visible so one unusual year can’t hide.</p></div>' +
        "<div>" + (detail || '<div class="ue-ph">Click a month cell to see that month across all five years — its average, range and how often it was positive.</div>') + "</div></div>" +
      '<div class="stamp">' + esc((M && M.basis) || "") + " Source: " + esc((M && M.provider) || "") + ", updated " + esc(when(M && M.updated_at)) + ". Five years is a small sample (five observations per month): this describes the past and is not a forecast or a trading signal.</div></div>";
  }
  function companyView() {
    if (!V.sel) return '<div class="tile"><div class="ue-ph">Search for a ticker above to open company intelligence.</div></div>';
    var C = J.calendar, hist = C && C.rows ? C.rows.filter(function (r) { return r.symbol === V.sel; }) : [];
    return profileCard() +
      '<div class="tile" style="margin-top:14px"><h2>' + esc(V.sel) + " earnings in the calendar window</h2>" +
      (hist.length ? '<div class="tbl-scroll"><table class="ue-t"><thead><tr><th>Date</th><th>Time</th><th>EPS act.</th><th>EPS est.</th><th>Result</th><th>Revenue act.</th><th>Revenue est.</th></tr></thead><tbody>' +
        hist.map(function (r) { return "<tr><td>" + esc(dayLbl(r.date)) + "</td><td>" + tlbl(r.time) + "</td><td>" + num(r.epsActual, 2) + "</td><td>" + num(r.epsEstimated, 2) + "</td><td>" + verdict(r) + "</td><td>" + big(r.revenueActual) + "</td><td>" + big(r.revenueEstimated) + "</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<p class="note">' + esc(V.sel) + " has no event in the calendar window" + (C ? " (" + esc(C.from) + " → " + esc(C.to) + ")" : "") + ".</p>") + "</div>" +
      '<div class="tile" style="margin-top:14px"><h2>Company research workspaces <span class="h2note">— phase 2</span></h2><div class="ue-ph">Statements, eight-quarter history, working capital, free cash flow, debt and financing cost, ratios, segments and rule-based interpretation will be built from SEC EDGAR filings for a pre-built company universe. Each opens with current position, eight-quarter history, industry comparison, interpretation and source evidence.</div></div>';
  }
  function render() {
    var act = document.activeElement, hadQ = act && act.hasAttribute && act.hasAttribute("data-utq"), pos = hadQ ? act.selectionStart : 0;
    if (!J) {
      P.innerHTML = '<div class="tile wide">' + protoBar() + (err === "empty"
        ? '<div class="ue-ph"><b>No data yet.</b> Nothing has called FMP so far. Open <a href="' + RUN + '" target="_blank" rel="noopener noreferrer">Actions → US earnings (prototype)</a> and press <b>Run workflow</b>.</div>'
        : err ? '<div class="unreach">⚠ Sorry, we can’t be reached now <small>— earnings.json did not load; use Reload data to try again</small></div>'
        : '<p class="note">Loading…</p>') + "</div>";
      return;
    }
    if (V.sel && !rows().some(function (r) { return r.s === V.sel; })) { V.sel = null; V.lock = false; }
    if (!V.sel && /^(co-|stmts|wc|fcf|debt|ratios|seg|research)/.test(V.view)) V.view = "market";
    var centre = V.view === "season" ? seasonView() : V.view === "plan" ? '<div class="tile"><h2>Data &amp; plan coverage</h2>' + topStrip() + "</div>" + planTile() + footer()
      : V.view === "co-overview" ? companyView() : '<div class="ue-grid" style="grid-template-columns:1fr;margin-top:0"><div>' + table() + earningsSlot() + "</div></div>";
    P.innerHTML = protoBar() + header() + indexDetail() + tickerBar() + (flashMsg ? '<div class="ut-ask" style="margin:-4px 0 10px">' + esc(flashMsg) + "</div>" : "") +
      '<div class="ut-shell">' + nav() + '<main class="ut-main" style="min-width:0">' + centre + "</main>" + feed() + "</div>";
    if (hadQ) { var i = P.querySelector("[data-utq]"); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  P.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-uesort]"); if (b) { var k = b.getAttribute("data-uesort"); V.dir = V.sort === k ? -V.dir : (k === "sym" || k === "sector" ? 1 : -1); V.sort = k; save(); render(); return; }
    b = t.closest("[data-ue]"); if (b && b.getAttribute("data-ue") === "reload") { etag = ""; mEtag = ""; poll(true); return; }
    b = t.closest("[data-utix]"); if (b) { var ix = b.getAttribute("data-utix"); idxOpen = idxOpen === ix ? null : ix; render(); return; }
    b = t.closest("[data-utgo]"); if (b) { V.view = b.getAttribute("data-utgo"); if (b.hasAttribute("data-utidx")) { V.idx = b.getAttribute("data-utidx"); idxOpen = null; } seaCell = null; save(); render(); return; }
    b = t.closest("[data-utidx]"); if (b) { V.idx = b.getAttribute("data-utidx"); seaCell = null; save(); render(); return; }
    b = t.closest("[data-utcell]"); if (b) { var c = b.getAttribute("data-utcell"); seaCell = seaCell === c ? null : c; render(); return; }
    b = t.closest("[data-utf]"); if (b) { var f = b.getAttribute("data-utf").split(":"); V[f[0]] = f[1]; save(); render(); return; }
    b = t.closest("[data-utlock]"); if (b) { V.lock = !V.lock; ask = null; save(); render(); return; }
    b = t.closest("[data-utswitch]"); if (b) { V.lock = true; V.sel = b.getAttribute("data-utswitch"); ask = null; save(); render(); return; }
    b = t.closest("[data-utask]"); if (b) { ask = null; render(); return; }
    b = t.closest("[data-utpick]"); if (b) { choose(b.getAttribute("data-utpick")); return; }
    b = t.closest("[data-utev]"); if (b) { choose(b.getAttribute("data-utev")); return; }
    b = t.closest("[data-uesym]"); if (b) { choose(b.getAttribute("data-uesym")); }
  });
  P.addEventListener("input", function (ev) { if (ev.target.hasAttribute && ev.target.hasAttribute("data-utq")) { q = ev.target.value; render(); } });
  P.addEventListener("keydown", function (ev) {
    if (!(ev.target.hasAttribute && ev.target.hasAttribute("data-utq"))) return;
    if (ev.key === "Escape") { q = ""; render(); }
    if (ev.key === "Enter") { var f = P.querySelector("[data-utpick]"); if (f) choose(f.getAttribute("data-utpick")); }
    if (ev.key === "ArrowDown") { var g = P.querySelector("[data-utpick]"); if (g) { ev.preventDefault(); g.focus(); } }
  });
  /* header values come from the World feed (already polled by world-ui.js) — repaint it each minute while the tab is open, no extra fetch */
  setInterval(function () { if (P.classList.contains("active") && !window.DESK_LOCKED) { var h = P.querySelector(".ut-hdr"); if (h) { var d = document.createElement("div"); d.innerHTML = header(); h.replaceWith(d.firstChild); } } }, 60000);
  /* the JSON only changes when someone runs the Action, so fetch on open (at most once a minute) — no background polling */
  BTN.addEventListener("click", function () { render(); poll(); });
  window.addEventListener("desk:unlock", function () { if (P.classList.contains("active")) poll(true); });
  window.EARNINGS = { render: render, poll: poll, _data: function () { return J; } };
  render();
})();
