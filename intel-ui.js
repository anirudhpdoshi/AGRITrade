/* intel-ui.js — "Intel" tab: Global Commodity Intelligence.
   Official World Bank / IMF / FAO data and institutional + supply-disruption headlines, each with a
   "Why this matters to my desk" read for corn, soybeans and wheat.
   Data: intel.json on the `intel` branch (scripts/intel.py, hourly on weekdays).

   Fallback ladder (the same rule as the rest of the desk — degrade, never go blank, always say which tier you are on):
     1  GitHub contents API (ETag, cheap 304s)              -> "SERVER COPY"
     2  raw.githubusercontent.com                            -> "SERVER COPY (mirror)"
     3  last good copy kept in this browser (localStorage)   -> "CACHED IN BROWSER — network failed"
     4  nothing at all                                       -> plain 'cannot be reached' notice, retrying
   Inside the server copy each source degrades on its own: a failed source keeps its last good copy (flagged), and a
   World Bank series that fails is served from the IMF as backup (shown per row). Facts and inference are kept apart:
   official figures are marked VERIFIED; headline reads are rule-based inference from the title only. */
(function () {
  "use strict";
  var P = document.getElementById("panel-intel"), BTN = document.getElementById("tabbtn-intel");
  if (!P || !BTN) return;
  var REPO = (window.LIVE_CONFIG && window.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/intel.json?ref=intel";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/intel/intel.json";
  var CACHE = "desk.intel.cache", VIEW = "desk.intel.view", SEEN = "desk.intel.seen";
  var D = null, tier = 0, etag = "", busy = false, lastTry = 0, lastOk = 0, err = "";
  var V = { sub: "feed", cat: "all", crop: "all", bias: "all", kind: "all", hot: false, q: "", open: "" };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  Object.assign(V, store.get(VIEW) || {}); V.open = "";
  function save() { store.set(VIEW, { sub: V.sub, cat: V.cat, crop: V.crop, bias: V.bias, kind: V.kind, hot: V.hot }); }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d == null ? 1 : d) + (u || ""); }
  function ago(iso) { if (!iso) return "—"; var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "now" : m < 60 ? m + "m" : m < 2880 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; }
  function et(iso) { try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
  function mon(k) { if (!k) return ""; var p = k.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+p[1] - 1] + " " + p[0]; }
  var CATS = [["all", "All"], ["ag", "Agriculture"], ["energy_fert", "Energy & fertilizer"], ["macro_trade", "Macro & trade"], ["disruption", "Supply disruption"], ["outlook", "Long-term outlook"]];
  var CATN = {}; CATS.forEach(function (c) { CATN[c[0]] = c[1]; });
  var CATC = { ag: "#3fb97f", energy_fert: "#f0a35e", macro_trade: "#6ea8ff", disruption: "#e0655f", outlook: "#c9a3ff" };
  var CROPN = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
  var CROPS = ["corn", "soybeans", "wheat"];
  function biasChip(b, small) { var k = b === "bullish" ? "bu" : b === "bearish" ? "be" : b === "mixed" ? "mx" : "nw"; var t = b === "bullish" ? "▲ supportive" : b === "bearish" ? "▼ pressure" : b === "mixed" ? "◆ mixed" : b === "neutral" ? "· no change" : "○ watch"; return '<span class="it-b ' + k + (small ? " sm" : "") + '">' + t + "</span>"; }
  function confChip(c) { return '<span class="it-cf ' + (c || "Low").toLowerCase() + '" title="Confidence in the directional read">' + esc(c || "Low") + "</span>"; }
  function spark(a, w, h) {
    if (!a || a.length < 2) return "";
    w = w || 96; h = h || 24; var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), r = mx - mn || 1;
    var pts = a.map(function (v, i) { return (i * (w - 2) / (a.length - 1) + 1).toFixed(1) + "," + (h - 2 - (v - mn) / r * (h - 4)).toFixed(1); }).join(" ");
    var up = a[a.length - 1] >= a[a.length - 2];
    return '<svg class="it-sp" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true"><polyline fill="none" stroke="' + (up ? "var(--green)" : "var(--red)") + '" stroke-width="1.4" points="' + pts + '"/></svg>';
  }

  /* ---------- styles (scoped to the tab; reuse the desk's colour tokens so light/dark both work) ---------- */
  if (!document.getElementById("it-css")) {
    var css = document.createElement("style"); css.id = "it-css";
    css.textContent = [
      ".it{display:grid;grid-template-columns:220px minmax(0,1fr);gap:14px;align-items:start}",
      ".it-nav{position:sticky;top:calc(var(--strip-h,40px) + 64px);display:flex;flex-direction:column;gap:3px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 8px}",
      ".it-nav button{appearance:none;text-align:left;border:1px solid transparent;background:none;color:var(--muted);font:inherit;font-size:13.5px;padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}",
      ".it-nav button[aria-current=true]{background:color-mix(in srgb,var(--cyan) 14%,transparent);border-color:color-mix(in srgb,var(--cyan) 45%,transparent);color:var(--ink)}",
      ".it-nav .n{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--faint)}.it-nav .n.hot{color:var(--red);font-weight:700}",
      ".it-nav h3{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:10px 10px 4px;font-weight:600}",
      ".it-main{min-width:0;display:flex;flex-direction:column;gap:14px}",
      ".it-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:12.5px;color:var(--muted)}",
      ".it-tier{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 9px;border-radius:20px;border:1px solid}",
      ".it-tier.t1{color:#5fd598;border-color:#1f5c3d;background:#123626}.it-tier.t2{color:#9db8d8;border-color:#33465f;background:#1c2f4a}.it-tier.t3{color:#f2c169;border-color:#6e5518;background:#3a2a10}.it-tier.t4{color:#ff9d97;border-color:#6e2b26;background:#3d1a18}",
      ".it-warn{font-size:12.5px;color:#f2c169;background:color-mix(in srgb,#e8a33d 10%,transparent);border:1px solid color-mix(in srgb,#e8a33d 40%,transparent);border-radius:8px;padding:7px 10px}",
      ".it-flt{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
      ".it-flt button{appearance:none;font:inherit;font-size:12px;padding:4px 10px;border-radius:16px;border:1px solid var(--line2);background:var(--panel2);color:var(--muted);cursor:pointer}",
      ".it-flt button[aria-pressed=true]{color:var(--ink);border-color:var(--cyan);background:color-mix(in srgb,var(--cyan) 16%,transparent)}",
      ".it-flt .sep{width:1px;height:18px;background:var(--line2);margin:0 4px}",
      ".it-flt input{flex:1 1 180px;min-width:140px;font:inherit;font-size:13px;padding:5px 10px;border-radius:8px;border:1px solid var(--line2);background:var(--panel2);color:var(--ink)}",
      ".it-t{width:100%;border-collapse:collapse;font-size:13px}",
      ".it-t th{text-align:left}.it-t td{font-family:inherit;text-align:left;white-space:normal;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}",
      ".it-t col.c-tm{width:104px}.it-t col.c-kc{width:150px}.it-t col.c-im{width:178px}.it-t col.c-cf{width:62px}.it-t col.c-sr{width:120px}",
      ".it-det td{display:table-cell}.it-det td::before{display:none!important}",
      ".it-t tr.r{cursor:pointer}.it-t tr.r:hover td{background:color-mix(in srgb,var(--cyan) 5%,transparent)}",
      ".it-t tr.r.mat td:first-child{box-shadow:inset 3px 0 0 var(--amber)}.it-t tr.r.alr td:first-child{box-shadow:inset 3px 0 0 var(--red)}",
      ".it-t .tm{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--faint);white-space:nowrap}",
      ".it-t .ev{color:var(--ink);line-height:1.4}.it-t .ev small{display:block;color:var(--faint);font-size:11.5px;margin-top:2px}",
      ".it-cat{display:inline-block;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--c);margin-right:6px}",
      ".it-b{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;padding:1px 7px;border-radius:12px;white-space:nowrap;border:1px solid}",
      ".it-b.bu{color:#5fd598;border-color:#1f5c3d}.it-b.be{color:#ff9d97;border-color:#6e2b26}.it-b.mx{color:#f2c169;border-color:#6e5518}.it-b.nw{color:var(--muted);border-color:var(--line2)}",
      ".it-b.sm{font-size:11.5px;padding:0 6px}",
      ".it-cr{display:flex;flex-direction:column;gap:3px}.it-cr span.l{font-size:11.5px;color:var(--muted);display:inline-block;min-width:62px}",
      ".it-cf{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700}.it-cf.high{color:#5fd598}.it-cf.medium{color:#f2c169}.it-cf.low{color:var(--muted)}",
      ".it-vf{font-size:11px;font-weight:700;letter-spacing:.06em;padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:1px}",
      ".it-vf.y{background:#123626;color:#5fd598}.it-vf.n{background:#2a2f3a;color:#aab4c4}.it-vf.s{background:#3a2a10;color:#f2c169}",
      ".it-kc{font-family:'IBM Plex Mono',monospace;font-size:12px;white-space:nowrap}",
      ".it-det td{background:var(--panel2);padding:14px 16px!important}",
      ".it-why{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px 18px;font-size:13px;line-height:1.5}",
      ".it-why h4{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 5px;font-weight:700}",
      ".it-why ul{margin:0;padding-left:16px}.it-why li{margin:2px 0}",
      ".it-why .fact{border-left:3px solid var(--green);padding-left:10px}.it-why .inf{border-left:3px solid var(--amber);padding-left:10px}.it-why .chk{border-left:3px solid var(--cyan);padding-left:10px}",
      ".it-row{display:flex;justify-content:space-between;gap:10px;align-items:baseline}",
      ".it-src{font-size:12px;color:var(--faint)}",
      ".it-sp{vertical-align:middle}",
      ".it-ok{color:var(--green)}.it-bad{color:var(--red)}.it-amb{color:var(--amber)}",
      ".it-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}",
      ".it-kpi{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 11px}.it-kpi .k{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:600}.it-kpi .v{font-family:'IBM Plex Mono',monospace;font-size:19px;color:var(--ink);margin-top:3px}",
      "@media (max-width:900px){.it{grid-template-columns:1fr}.it-nav{position:static;flex-direction:row;overflow-x:auto}.it-nav h3{display:none}.it-nav button{flex:0 0 auto}",
      ".it-t .hm{display:none!important}.it-det td{display:block!important}.it-t col{width:auto!important}}"
    ].join("\n");
    document.head.appendChild(css);
  }

  /* ---------- data: the fallback ladder ---------- */
  function poll(force) {
    if (busy || window.DESK_LOCKED) return;
    if (!force && Date.now() - lastTry < 60000) return;
    busy = true; lastTry = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304 && D) return { d: D, t: 1 };
      if (!r.ok) throw r.status;
      etag = r.headers.get("ETag") || ""; return r.json().then(function (j) { return { d: j, t: 1 }; });
    }).catch(function () {
      return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json().then(function (j) { return { d: j, t: 2 }; }); });
    }).then(function (x) {
      D = x.d; tier = x.t; lastOk = Date.now(); err = "";
      store.set(CACHE, { at: Date.now(), d: D });
    }).catch(function () {
      err = "intel.json did not load (network or GitHub)";
      if (!D) { var c = store.get(CACHE); if (c && c.d) { D = c.d; tier = 3; lastOk = c.at; } else tier = 4; }
      else if (tier < 3) tier = 3;
    }).then(function () { busy = false; badge(); if (active()) render(); });
  }

  /* ---------- filtering ---------- */
  function items() { return (D && D.items) || []; }
  function match(i) {
    if (V.cat !== "all" && i.cat !== V.cat) return false;
    if (V.crop !== "all" && (i.crops || []).indexOf(V.crop) < 0) return false;
    if (V.kind !== "all" && i.kind !== V.kind) return false;
    if (V.bias !== "all") { var b = V.crop !== "all" && i.impact && i.impact[V.crop] ? i.impact[V.crop].bias : i.bias; if (b !== V.bias) return false; }
    if (V.hot && !(i.material || i.alert || (i.revisions && i.revisions.length))) return false;
    if (V.q) {
      var hay = [i.title, i.source, (i.regions || []).join(" "), (i.crops || []).join(" "), (i.other || []).join(" "), CATN[i.cat], i.inst, (i.evidence || []).join(" ")].join(" ").toLowerCase();
      if (V.q.toLowerCase().split(/\s+/).some(function (w) { return w && hay.indexOf(w) < 0; })) return false;
    }
    return true;
  }
  function newAlerts() {
    var seen = store.get(SEEN) || {}; return items().filter(function (i) { return (i.alert || i.material) && !seen[i.id]; }).length;
  }
  function markSeen() { var s = store.get(SEEN) || {}; items().forEach(function (i) { if (i.alert || i.material) s[i.id] = 1; }); var k = Object.keys(s); if (k.length > 800) k.slice(0, k.length - 800).forEach(function (x) { delete s[x]; }); store.set(SEEN, s); }
  function badge() {
    var n = newAlerts(), sym = BTN.querySelector(".sym"); if (!sym) return;
    sym.innerHTML = n ? '<b style="color:var(--red)">' + n + " new</b>" : "Global";
    BTN.title = n ? n + " new material moves / supply alerts since you last looked" : "Global Commodity Intelligence";
  }

  /* ---------- pieces ---------- */
  function tierHTML() {
    var t = tier || 4, lab = ["", "SERVER COPY", "SERVER COPY · MIRROR", "CACHED IN BROWSER", "UNREACHABLE"][t];
    var tip = ["", "Loaded from GitHub (contents API).", "GitHub API failed; loaded from the raw mirror.", "Network failed; showing the last good copy saved in this browser.", "No copy available yet."][t];
    return '<span class="it-tier t' + t + '" title="' + tip + '">' + lab + "</span>";
  }
  function headHTML() {
    if (!D) return '<div class="it-head">' + tierHTML() + "<span>" + (err ? esc(err) + " — retrying every minute" : "Loading intelligence feed…") + "</span></div>";
    var h = D.health || {}, failed = h.failed || [], srcs = D.sources || {};
    var stale = Object.keys(srcs).filter(function (k) { return srcs[k] && srcs[k].stale; });
    var backup = Object.keys(D.served_by || {}).filter(function (k) { return /backup/.test(D.served_by[k]); });
    var flags = (D.crosscheck || []).filter(function (c) { return c.flag; });
    var out = '<div class="it-head">' + tierHTML() + "<span>Server run <b>" + esc(et(D.updated_at)) + " ET</b> (" + ago(D.updated_at) + " ago)</span><span>Browser checked " + (lastOk ? ago(new Date(lastOk).toISOString()) + " ago" : "—") + '</span><span class="' + (failed.length ? "it-amb" : "it-ok") + '">' + (h.ok || []).length + " parts ok · " + failed.length + " failed</span></div>";
    var w = [];
    if (tier === 3) { var ag = ago(new Date(lastOk).toISOString()); w.push("The network check failed, so this is the last copy saved in this browser (saved " + (ag === "now" ? "moments" : ag) + " ago). Retrying every minute."); }
    if (Date.now() - Date.parse(D.updated_at) > 6 * 3600000) w.push("The server has not refreshed this feed for " + ago(D.updated_at) + " (normally hourly on weekdays).");
    if (stale.length) w.push("Showing the last good copy for: " + stale.map(function (k) { return (srcs[k].source || k).split(" (")[0]; }).join(", ") + " — the latest fetch failed (see Sources & health).");
    if (backup.length) w.push("Served from the IMF as backup because the World Bank series was unavailable: " + backup.map(function (k) { return nameOf(k); }).join(", ") + ".");
    if (flags.length) w.push("World Bank and IMF disagree by more than 3% on: " + flags.map(function (c) { return nameOf(c.ind) + " (" + sg(c.diff_pct, 1, "%") + ", " + mon(c.month) + ")"; }).join(", ") + ".");
    return out + (w.length ? '<div class="it-warn">⚠ ' + w.map(esc).join("<br>⚠ ") + "</div>" : "");
  }
  function nameOf(k) { var x = ((D && D.indicators) || []).filter(function (i) { return i.id === k; })[0]; return x ? x.name : k; }
  function navHTML() {
    var it = items(), alerts = it.filter(function (i) { return i.alert; }).length, mat = it.filter(function (i) { return i.material; }).length;
    var subs = [["feed", "Feed", it.length], ["ind", "Official indicators", ((D && D.indicators) || []).length], ["cal", "Release calendar", ((D && D.calendar) || []).length], ["health", "Sources & health", ""], ["guide", "How to read this", ""]];
    var s = "<h3>Intelligence</h3>" + subs.map(function (x) { return '<button type="button" data-isub="' + x[0] + '" aria-current="' + (V.sub === x[0]) + '"><span>' + x[1] + '</span><span class="n">' + x[2] + "</span></button>"; }).join("");
    s += "<h3>Jump to</h3>" + CATS.slice(1).map(function (c) { var n = it.filter(function (i) { return i.cat === c[0]; }).length; return '<button type="button" data-icat="' + c[0] + '" aria-current="' + (V.sub === "feed" && V.cat === c[0]) + '"><span><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + CATC[c[0]] + ';margin-right:7px"></i>' + c[1] + '</span><span class="n">' + n + "</span></button>"; }).join("");
    s += '<button type="button" data-ihot="1" aria-current="' + (V.sub === "feed" && V.hot) + '"><span>Material & alerts</span><span class="n' + (alerts ? " hot" : "") + '">' + (alerts + mat) + "</span></button>";
    return s;
  }
  function fbtn(k, v, lab) { return '<button type="button" data-if="' + k + '" data-v="' + v + '" aria-pressed="' + (String(V[k]) === String(v)) + '">' + lab + "</button>"; }
  function filtersHTML() {
    return '<div class="it-flt">' + CATS.map(function (c) { return fbtn("cat", c[0], c[1]); }).join("") + '</div><div class="it-flt" style="margin-top:8px">' +
      fbtn("crop", "all", "All crops") + CROPS.map(function (c) { return fbtn("crop", c, CROPN[c]); }).join("") + '<span class="sep"></span>' +
      fbtn("bias", "all", "Any read") + fbtn("bias", "bullish", "▲ Supportive") + fbtn("bias", "bearish", "▼ Pressure") + fbtn("bias", "mixed", "◆ Mixed") + '<span class="sep"></span>' +
      fbtn("kind", "all", "All") + fbtn("kind", "data", "Official data") + fbtn("kind", "headline", "Headlines") + '<span class="sep"></span>' +
      '<button type="button" data-ihot="1" aria-pressed="' + V.hot + '">Material & alerts only</button></div>' +
      '<div class="it-flt" style="margin-top:8px"><input type="search" data-iq placeholder="Search history — e.g. Black Sea, urea, export ban, Brazil" value="' + esc(V.q) + '" aria-label="Search the intelligence history"></div>';
  }
  function keyChange(i) {
    if (i.kind === "data" && i.key) {
      var k = i.key, cls = (k.chg_pct || 0) > 0 ? "it-ok" : (k.chg_pct || 0) < 0 ? "it-bad" : "";
      return '<span class="it-kc">' + nf(k.actual, 2) + ' <span class="' + cls + '">' + sg(k.chg_pct, 1, "%") + "</span></span><br><small class=\"it-src\">" + esc(k.unit) + " · " + mon(k.month) + (k.z != null ? " · z " + sg(k.z, 1) : "") + "</small>";
    }
    var ev = (i.evidence || [])[0] || ""; return '<small class="it-src">' + esc(/phrase/.test(ev) ? ev.replace(/^\w+ phrase: /, "") : "headline — no figure") + "</small>";
  }
  function impactCell(i) {
    var imp = i.impact || {}, ks = CROPS.filter(function (c) { return imp[c]; });
    if (!ks.length) return '<span class="it-src">context only — no direct crop read</span>';
    return '<div class="it-cr">' + ks.map(function (c) { return '<div><span class="l">' + CROPN[c] + "</span>" + biasChip(imp[c].bias, true) + "</div>"; }).join("") + "</div>";
  }
  function vflag(i) { return i.verified ? '<span class="it-vf y" title="Official published figure">VERIFIED</span>' : i.official_src ? '<span class="it-vf s" title="Official source, but the read is from the headline only">OFFICIAL SRC</span>' : '<span class="it-vf n" title="Third-party headline; not verified">UNVERIFIED</span>'; }
  function rowHTML(i) {
    var cls = "r" + (i.alert ? " alr" : i.material ? " mat" : "");
    var srcTxt = i.kind === "data" ? esc(i.source) : esc(i.source) + (i.also && i.also.length ? ' <small>+' + i.also.length + "</small>" : "");
    var r = '<tr class="' + cls + '" data-iid="' + esc(i.id) + '" tabindex="0" aria-expanded="' + (V.open === i.id) + '">' +
      '<td class="tm" data-l="Time">' + esc(et(i.ts || i.seen)) + "</td>" +
      '<td class="ev" data-l="Event"><span class="it-cat" style="--c:' + (CATC[i.cat] || "#9aa8bb") + '">' + esc(CATN[i.cat] || i.cat) + "</span>" + (i.alert ? '<span class="it-vf s" style="background:#3d1a18;color:#ff9d97">ALERT</span> ' : "") + esc(i.title) + vflag(i) + (i.stale ? '<span class="it-vf s">LAST GOOD COPY</span>' : "") +
      "<small>" + esc((i.regions || []).join(" · ")) + (i.other && i.other.length ? " · " + esc(i.other.join(", ")) : "") + "</small></td>" +
      '<td data-l="Key change">' + keyChange(i) + "</td>" +
      '<td data-l="Price implication">' + impactCell(i) + "</td>" +
      '<td data-l="Confidence">' + confChip(i.conf) + "</td>" +
      '<td class="hm it-src" data-l="Source">' + srcTxt + "</td></tr>";
    if (V.open === i.id) r += '<tr class="it-det"><td colspan="6">' + detailHTML(i) + "</td></tr>";
    return r;
  }
  function detailHTML(i) {
    var imp = i.impact || {}, ks = CROPS.filter(function (c) { return imp[c]; });
    var fact = i.kind === "data"
      ? "<ul>" + (i.evidence || []).map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + (i.key && i.key.yoy_pct != null ? "<li>Year on year: " + sg(i.key.yoy_pct, 1, "%") + "</li>" : "") + "</ul>"
      : "<ul><li>" + esc(i.source) + " reported: “" + esc(i.title) + "”</li><li>Published " + esc(et(i.ts)) + " ET · first seen by the desk " + esc(et(i.seen)) + " ET</li>" + (i.also && i.also.length ? "<li>Also carried by: " + esc(i.also.join(", ")) + "</li>" : "") + "</ul>";
    var inf = (i.why ? "<p style=\"margin:0 0 6px\">" + esc(i.why) + "</p>" : "<p style=\"margin:0 0 6px\">Read from the headline text only (" + esc((i.channels || []).join(", ")) + " channel). " + (i.evidence || []).map(esc).join("; ") + ".</p>") +
      (ks.length ? "<ul>" + ks.map(function (c) { return "<li><b>" + CROPN[c] + "</b> " + biasChip(imp[c].bias, true) + " · " + esc(imp[c].strength) + " · horizon " + esc(imp[c].horizon) + "</li>"; }).join("") + "</ul>" : "<p class=\"it-src\" style=\"margin:0\">No direct corn / soybean / wheat read — treat as context.</p>");
    var exp = (i.exposure || i.channels || []);
    return '<div class="it-why">' +
      '<div class="fact"><h4>Verified fact ' + (i.verified ? "· official figure" : "· what was reported") + "</h4>" + fact + "</div>" +
      '<div class="inf"><h4>Why this matters to my market · inference</h4>' + inf + "</div>" +
      '<div class="chk"><h4>Risk lens</h4><p style="margin:0 0 6px">Touches: <b>' + esc(exp.join(" · ") || "—") + "</b>. Confidence " + confChip(i.conf) + (i.horizon ? " · horizon " + esc(i.horizon) : "") + ".</p>" +
      (i.revisions && i.revisions.length ? "<p style=\"margin:0 0 6px\" class=\"it-amb\">Revised: " + i.revisions.map(function (r) { return mon(r.month) + " " + nf(r.prev, 2) + " → " + nf(r.new, 2); }).join("; ") + "</p>" : "") +
      "<h4 style=\"margin-top:8px\">Confirm before treating this as a trade</h4><ul>" + (i.confirm || []).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div></div>" +
      '<div class="it-row" style="margin-top:10px"><span class="it-src">' + (i.spark ? spark(i.spark, 160, 34) + " last 24 months · " : "") + "Category: " + esc(CATN[i.cat]) + "</span>" +
      (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">Open original source ↗</a>' : i.kind === "data" ? '<a href="' + esc(srcUrl(i)) + '" target="_blank" rel="noopener">Open source data ↗</a>' : "") + "</div>";
  }
  function srcUrl(i) { var s = D.sources || {}; return /FAO/.test(i.source) ? (s.fao || {}).url || "" : /IMF/.test(i.source) ? (s.imf || {}).url || "" : (s.worldbank || {}).url || ""; }

  /* ---------- views ---------- */
  function feedHTML() {
    var it = items().filter(match);
    it.sort(function (a, b) { return (b.ts || b.seen || "").localeCompare(a.ts || a.seen || ""); });
    var all = items(), dataN = all.filter(function (i) { return i.kind === "data"; }).length;
    var kp = '<div class="it-kpis">' +
      kpi("Supply alerts", all.filter(function (i) { return i.alert; }).length) + kpi("Material moves", all.filter(function (i) { return i.material; }).length) +
      kpi("Official series", dataN) + kpi("Headlines (45 d)", all.length - dataN) + "</div>";
    var tbl = it.length ? '<table class="it-t"><colgroup><col class="c-tm"><col><col class="c-kc"><col class="c-im"><col class="c-cf"><col class="c-sr hm"></colgroup><thead><tr><th>Time ET</th><th>Event</th><th>Key change</th><th>Price implication</th><th>Conf.</th><th class="hm">Source</th></tr></thead><tbody>' + it.slice(0, 150).map(rowHTML).join("") + "</tbody></table>"
      : '<p class="note">Nothing matches these filters.</p>';
    return '<div class="tile wide">' + kp + "</div>" +
      '<div class="tile wide"><h2>Global Commodity Intelligence <span class="h2note">· ' + it.length + " of " + all.length + " items · click a row for “Why this matters”</span></h2>" + filtersHTML() + '<div style="margin-top:12px;overflow-x:auto">' + tbl + "</div>" +
      '<div class="stamp">Official figures (World Bank, IMF, FAO) are marked VERIFIED. Directional reads are rule-based inference — a fixed transmission map for data, a phrase lexicon for headlines — and are never a trading signal on their own. Amber edge = material surprise (|z| ≥ 1.5 vs the series’ own 24-month history); red edge = supply-disruption alert.</div></div>';
  }
  function kpi(k, v) { return '<div class="it-kpi"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }
  function indHTML() {
    var L = (D.indicators || []).slice(), groups = [["ag", "Grains, oilseeds & food"], ["energy_fert", "Energy & fertilizer"], ["macro_trade", "Macro context"]];
    var ck = {}; (D.crosscheck || []).forEach(function (c) { ck[c.ind] = c; });
    var html = groups.map(function (g) {
      var rows = L.filter(function (i) { return i.cat === g[0]; }); if (!rows.length) return "";
      return '<div class="tile wide"><h2>' + g[1] + '</h2><div style="overflow-x:auto"><table class="it-t"><thead><tr><th>Series</th><th>Month</th><th style="text-align:right">Latest</th><th style="text-align:right">MoM</th><th style="text-align:right">YoY</th><th style="text-align:right">z</th><th>24 months</th><th>Served by</th></tr></thead><tbody>' +
        rows.map(function (i) {
          var m = i.move || {}, c = ck[i.id];
          return '<tr><td class="ev" data-l="Series">' + esc(i.name) + "<small>" + esc(i.unit) + "</small></td><td class=\"tm\" data-l=\"Month\">" + mon(m.month) + '</td><td class="it-kc" data-l="Latest" style="text-align:right">' + nf(m.value, 2) +
            '</td><td class="it-kc ' + ((m.chg_pct || 0) > 0 ? "it-ok" : (m.chg_pct || 0) < 0 ? "it-bad" : "") + '" data-l="MoM" style="text-align:right">' + sg(m.chg_pct, 1, "%") + '</td><td class="it-kc" data-l="YoY" style="text-align:right">' + sg(m.yoy_pct, 1, "%") +
            '</td><td class="it-kc' + (m.material ? " it-amb" : "") + '" data-l="z" style="text-align:right">' + (m.z == null ? "—" : sg(m.z, 2)) + (m.material ? " ●" : "") + '</td><td data-l="24 months">' + spark(i.spark) +
            '</td><td class="it-src" data-l="Served by">' + esc(i.src) + (c ? '<br><small class="' + (c.flag ? "it-amb" : "") + '">IMF check ' + sg(c.diff_pct, 1, "%") + "</small>" : "") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }).join("");
    return html + '<div class="tile wide"><p class="note" style="margin:0">Monthly averages. They confirm what futures already did over the month; they do not lead CBOT. The value is in the cost side (fertilizer, energy), cross-origin price levels and surprises against each series’ own history. ● = material move (|z| ≥ 1.5). Where the World Bank series is missing, the IMF series is used and labelled “IMF (backup)”; where both exist, the IMF figure is a cross-check.</p></div>';
  }
  function calHTML() {
    var today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) + "T00:00:00");
    var rows = (D.calendar || []).map(function (c) {
      var d = new Date(c.date + "T00:00:00"), n = Math.round((d - today) / 86400000);
      return '<tr><td class="tm" data-l="Date">' + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) + '</td><td class="it-kc" data-l="In">' + (n === 0 ? "today" : n > 0 ? "in " + n + " d" : Math.abs(n) + " d ago") + '</td><td class="ev" data-l="Release">' + esc(c.what) + "<small>" + esc(c.src) + "</small></td><td class=\"it-src\" data-l=\"Date basis\">" + esc(c.basis) + "</td></tr>";
    }).join("");
    var cmo = ((D.sources || {}).worldbank || {}).cmo || [];
    return '<div class="tile wide"><h2>Release calendar <span class="h2note">· institutional publications that feed this tab</span></h2><table class="it-t"><thead><tr><th>Date</th><th>In</th><th>Release</th><th>Date basis</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      (cmo.length ? '<div class="stamp">Commodity Markets Outlook editions found on the World Bank page: ' + cmo.map(function (p) { return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.edition) + "</a>"; }).join(" · ") + "</div>" : "") +
      '<div class="stamp">“published” = date taken from the publisher’s own page. “estimated” = the publisher’s usual timing; check the source before relying on it. USDA WASDE, export sales and CFTC dates live on the Events tab.</div></div>';
  }
  function healthHTML() {
    var S = D.sources || {}, h = D.health || {};
    var rows = Object.keys(S).map(function (k) {
      var s = S[k], f = (h.failed || []).filter(function (x) { return x.part === k || x.part.indexOf(k + "/") === 0; });
      var st = s.stale ? '<span class="it-amb">LAST GOOD COPY</span>' : f.length ? '<span class="it-amb">partial</span>' : '<span class="it-ok">OK</span>';
      return '<tr><td class="ev" data-l="Source">' + esc(s.source || k) + (s.url ? '<small><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url.replace(/^https?:\/\//, "").slice(0, 70)) + "</a></small>" : "") + '</td><td data-l="Status">' + st + '</td><td class="tm" data-l="Fetched">' + esc(et(s.fetched_at)) + " (" + ago(s.fetched_at) + ')</td><td class="tm" data-l="Data through">' + esc(s.through ? mon(s.through) : "—") + '</td><td class="it-src" data-l="Notes">' + esc((s.missing && s.missing.length ? "no data for " + s.missing.join(", ") + ". " : "") + f.map(function (x) { return x.error; }).join(" · ")) + "</td></tr>";
    }).join("");
    var fails = (h.failed || []).filter(function (x) { return !S[x.part]; });
    return '<div class="tile wide"><h2>Sources & health <span class="h2note">· server run ' + esc(et(D.updated_at)) + " ET · " + esc(D.run_seconds) + ' s</span></h2><div style="overflow-x:auto"><table class="it-t"><thead><tr><th>Source</th><th>Status</th><th>Fetched</th><th>Data through</th><th>Notes</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (fails.length ? '<p class="it-amb" style="font-size:12.5px">Failed parts: ' + fails.map(function (x) { return esc(x.part) + " — " + esc(x.error); }).join("<br>") + "</p>" : "") +
      '<div class="stamp">This browser: ' + ["", "server copy via GitHub API", "server copy via raw mirror (API failed)", "last good copy cached in this browser (network failed)", "nothing loaded yet"][tier || 4] + " · checked " + (lastOk ? ago(new Date(lastOk).toISOString()) + " ago" : "—") + " · re-checks every 60 s while this tab is open.</div></div>";
  }
  function guideHTML() {
    var li = function (a) { return "<ul>" + a.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>"; };
    return '<div class="tile wide"><h2>How to read this tab</h2><div class="it-why">' +
      '<div class="fact"><h4>What comes in</h4>' + li(["<b>World Bank Pink Sheet</b> — monthly world prices: maize, wheat, soybeans, soy &amp; palm oil, urea, DAP, crude, European gas.", "<b>IMF PCPS</b> — the same kind of series; backup when a World Bank series fails, cross-check when both exist.", "<b>FAO Food Price Index</b> — headline, cereals and vegetable-oils indices, plus FAO’s next release date.", "<b>Headlines</b> — World Bank, IMF, FAO, OECD–FAO, AMIS and supply-disruption / logistics / fertilizer / trade news (Google News RSS)."]) + "</div>" +
      '<div class="inf"><h4>How the read is made</h4>' + li(["Data: a fixed transmission map per series (e.g. urea ↑ → new-crop corn supportive, new-crop soybeans pressured through acreage).", "Headlines: a phrase lexicon (export ban, drought, forecast cut ↑; record crop, ban lifted, glut ↓). The matched phrases are shown as evidence.", "Confidence: <b>High</b> only for a material move in a direct series; headlines are Low unless from an official domain with a clear phrase (Medium).", "Material = |z| ≥ 1.5 against the series’ own last 24 monthly moves. Revisions only versus a value the server stored earlier."]) + "</div>" +
      '<div class="chk"><h4>What it is not</h4>' + li(["Not a live price feed: these are monthly official figures and news. Live and delayed futures stay on the grain tabs.", "Not a trading signal. Every item lists what to confirm: futures curve, WASDE, export sales, weather, physical basis.", "Nothing is invented: a missing value stays “—”, a failed source shows its last good copy with the original time."]) + "</div></div></div>";
  }

  function active() { return P.classList.contains("active"); }
  function render() {
    if (!P.querySelector(".it")) P.innerHTML = '<div class="it"><nav class="it-nav" id="itNav" aria-label="Intel sections"></nav><div class="it-main"><div class="tile wide" id="itHead"></div><div id="itBody" class="it-main"></div></div></div>';
    document.getElementById("itNav").innerHTML = navHTML();
    document.getElementById("itHead").innerHTML = headHTML();
    var B = document.getElementById("itBody");
    if (!D) { B.innerHTML = tier === 4 && err ? '<div class="tile wide"><div class="unreach">⚠ Sorry, we can’t be reached now <small>— the intelligence feed did not load and no copy is saved in this browser yet; retrying every minute</small></div></div>' : '<div class="tile wide"><p class="note">Loading intelligence feed…</p></div>'; return; }
    B.innerHTML = V.sub === "ind" ? indHTML() : V.sub === "cal" ? calHTML() : V.sub === "health" ? healthHTML() : V.sub === "guide" ? guideHTML() : feedHTML();
    if (window.MOTION) window.MOTION.scan();
  }

  /* ---------- events ---------- */
  P.addEventListener("click", function (ev) {
    var t = ev.target; if (!t.closest) return;
    if (t.closest("a")) return;
    var b = t.closest("[data-isub]"); if (b) { V.sub = b.getAttribute("data-isub"); save(); render(); return; }
    b = t.closest("[data-icat]"); if (b) { V.sub = "feed"; V.cat = b.getAttribute("data-icat"); V.hot = false; save(); render(); return; }
    b = t.closest("[data-ihot]"); if (b) { V.sub = "feed"; V.hot = b.closest(".it-nav") ? true : !V.hot; if (b.closest(".it-nav")) V.cat = "all"; save(); render(); return; }
    b = t.closest("[data-if]"); if (b) { V[b.getAttribute("data-if")] = b.getAttribute("data-v"); save(); render(); return; }
    b = t.closest("tr.r[data-iid]"); if (b) { var id = b.getAttribute("data-iid"); V.open = V.open === id ? "" : id; render(); return; }
  });
  P.addEventListener("keydown", function (ev) { var r = ev.target.closest && ev.target.closest("tr.r[data-iid]"); if (r && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); r.click(); } });
  P.addEventListener("input", function (ev) {
    var q = ev.target.closest && ev.target.closest("[data-iq]"); if (!q) return;
    V.q = q.value; var pos = q.selectionStart; render(); var n = P.querySelector("[data-iq]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
  });
  BTN.addEventListener("click", function () { render(); poll(); setTimeout(function () { markSeen(); badge(); }, 4000); });
  setInterval(function () { if (window.DESK_LOCKED) return; if (active()) poll(); else if (Date.now() - lastTry > 600000) poll(); }, 30000);
  window.addEventListener("desk:unlock", function () { poll(true); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && active()) poll(); });

  window.INTEL = { poll: poll, render: render, _data: function () { return D; }, _tier: function () { return tier; } };
  var c0 = store.get(CACHE); if (c0 && c0.d) { D = c0.d; tier = 3; lastOk = c0.at; badge(); }   // instant paint from the browser copy, replaced by the server copy
  render(); if (window.DESK_LOCKED === false) poll(true);
})();
