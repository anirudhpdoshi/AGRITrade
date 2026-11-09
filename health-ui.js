/* health-ui.js — System health tab. Reads health.json (branch `health`, written every 15 min by scripts/health.py).
   Each panel shows its own calculation; nothing here is recomputed or blended across panels. */
(function () {
  "use strict";
  var API = "https://api.github.com/repos/anirudhpdoshi/AGRITrade/contents/health.json?ref=health",
      RAW = "https://raw.githubusercontent.com/anirudhpdoshi/AGRITrade/health/health.json";
  var H = null, ERR = "", SEL = "api", etag = null, timer = null;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function et(s, withDate) { if (!s) return "—"; var d = new Date(s); if (isNaN(d)) return esc(s); var o = { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }; if (withDate) { o.month = "short"; o.day = "numeric"; } return d.toLocaleString("en-US", o) + " ET"; }
  function ago(s) { if (!s) return "—"; var m = Math.round((Date.now() - Date.parse(s)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; }
  function age(m) { return m == null ? "—" : m < 60 ? m + " min" : m < 1440 ? (m / 60).toFixed(1) + " h" : (m / 1440).toFixed(1) + " d"; }
  function dot(st) { var c = { green: "ok", ok: "ok", red: "bad", stale: "bad", missing: "bad", amber: "warn", closed: "off", idle: "off" }[st] || "off"; return '<span class="hl-d ' + c + '"></span>'; }
  function word(st) { return { green: "Operational", amber: "Degraded", red: "Failing", idle: "Idle" }[st] || "—"; }

  function load() {
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    return fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) return null; if (!r.ok) throw new Error("api " + r.status); etag = r.headers.get("ETag"); return r.json();
    }).catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("raw " + r.status); return r.json(); }); })
      .then(function (j) { if (j) { H = j; ERR = ""; } render(); }).catch(function (e) { ERR = String(e.message || e); render(); });
  }
  function active() { var p = document.getElementById("panel-health"); return p && p.classList.contains("active"); }

  /* small history line: one value per check, last 7 days */
  function spark(pts, max, col) {
    pts = pts.filter(function (p) { return p != null; }); if (pts.length < 2) return "";
    var w = 260, h = 46, mx = max || Math.max.apply(null, pts) || 1, mn = Math.min(0, Math.min.apply(null, pts));
    var d = pts.map(function (v, i) { return (i ? "L" : "M") + (i / (pts.length - 1) * w).toFixed(1) + " " + (h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)).toFixed(1); }).join(" ");
    return '<svg class="hl-sp" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6"/></svg>';
  }
  function card(id, title, big, sub, st, built) {
    return '<button class="hl-card' + (SEL === id ? " on" : "") + (built ? "" : " dim") + '" data-hl="' + id + '"' + (built ? "" : " disabled") + '><div class="hl-ct">' + title + "</div>" +
      '<div class="hl-cv">' + big + '</div><div class="hl-cs">' + sub + '</div><div class="hl-cst">' + (built ? dot(st) + word(st) : "Next phase") + "</div></button>";
  }
  function apiDetail(A, hist) {
    var P = A.providers || [], F = A.feeds || [], B = A.blocks || {}, Q = A.quota || [];
    var h = '<div class="hl-sec"><h3>Providers <small>independent probe every 15 min · no keys used</small></h3><div class="tbl-scroll"><table class="hl-t"><thead><tr><th>Provider</th><th>Status</th><th>HTTP</th><th>Latency</th><th>Uptime 7d</th><th>Delay class</th><th>Used for</th></tr></thead><tbody>' +
      P.map(function (p) { return "<tr><td>" + dot(p.ok ? "ok" : "red") + esc(p.name) + "</td><td>" + (p.ok ? "Up" : '<b class="hl-bad">' + esc(p.error || "Down") + "</b>") + "</td><td>" + (p.status || "—") + "</td><td>" + (p.ms != null ? p.ms + " ms" : "—") + "</td><td>" + (p.uptime_7d != null ? p.uptime_7d + "%" : "—") + "</td><td>" + esc(p.delay) + "</td><td>" + esc(p.used_for) + "</td></tr>"; }).join("") +
      (A.not_probed || []).map(function (p) { return '<tr class="hl-np"><td>' + dot("idle") + esc(p.name) + '</td><td colspan="4">' + esc(p.how) + "</td><td>" + esc(p.delay) + "</td><td>" + esc(p.used_for) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    h += '<div class="hl-sec"><h3>Feed freshness <small>age against each feed’s own limit · “closed” = market shut, not stale</small></h3><div class="tbl-scroll"><table class="hl-t"><thead><tr><th>Feed</th><th>Status</th><th>As of</th><th>Age</th><th>Limit</th><th>Source</th><th>Delay class</th><th>On screen</th></tr></thead><tbody>' +
      F.map(function (f) { return "<tr><td>" + dot(f.status) + esc(f.label) + "</td><td>" + (f.status === "ok" ? "Fresh" : f.status === "closed" ? "Market closed" : '<b class="hl-bad">' + (f.status === "missing" ? "Missing" : "Stale") + "</b>") + "</td><td>" + et(f.asof, true) + "</td><td>" + age(f.age_min) + "</td><td>" + (f.due ? "dated " + esc(f.due) : age(f.max_min)) + "</td><td>" + esc(f.provider) + "</td><td>" + esc(f.delay) + "</td><td>" + (f.fallback ? "Last good value, labelled with its age" : f.status === "ok" ? "Current" : "—") + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    var fails = B.failed || [], errs = B.errors || {};
    h += '<div class="hl-sec"><h3>Data job blocks <small>last refresh ' + et(B.at, true) + "</small></h3>" + (fails.length ? '<ul class="hl-ul">' + fails.map(function (f) { return "<li>" + dot("red") + "<b>" + esc(f) + "</b> failed — the previous good data stays on the desk" + (errs[f] ? ": " + esc(errs[f]) : "") + "</li>"; }).join("") + "</ul>" : '<p class="hl-ok">' + dot("ok") + "All " + (B.ok || []).length + " blocks succeeded on the last run.</p>") + "</div>";
    if (Q.length) h += '<div class="hl-sec"><h3>Quotas &amp; rate limits</h3><ul class="hl-ul">' + Q.map(function (q) { return "<li><b>" + esc(q.provider) + ":</b> " + (q.remaining != null ? esc(q.remaining) + " left" + (q.limit ? " of " + esc(q.limit) : "") : q.used != null ? esc(q.used) + " used" + (q.limit ? " of " + esc(q.limit) : "") : "limit " + esc(q.limit)) + (q.note ? " · " + esc(q.note) : "") + "</li>"; }).join("") + "</ul></div>";
    h += '<div class="hl-sec"><h3>Last 7 days <small>provider success rate per check</small></h3>' + spark(hist.map(function (x) { return x.api && x.api.rate; }), 100, "#3fb97f") + "</div>";
    return h;
  }
  function schDetail(S, hist) {
    var J = S.jobs || [], C = S.clock || {}, X = S.special || [], R = S.releases || [];
    var h = '<div class="hl-sec"><h3>Scheduler clock</h3><p>' + dot(C.status) + (C.running === 1 ? "One clock loop running since " + et(C.started, true) : C.running ? C.running + " loops running at once — duplicates" : "<b class=\"hl-bad\">No clock loop running</b> — jobs fall back to GitHub’s unreliable timer") + " · last hand-over " + et(C.last_handover, true) + "</p></div>";
    h += '<div class="hl-sec"><h3>Special checks</h3><ul class="hl-ul">' + X.map(function (x) { return "<li>" + dot(x.status) + "<b>" + esc(x.label) + ":</b> " + esc(x.note || "") + (x.at ? " · last " + et(x.at, true) : "") + "</li>"; }).join("") + "</ul></div>";
    h += '<div class="hl-sec"><h3>Jobs <small>last ' + (S.window_h || 24) + " h against the intended clock</small></h3><div class=\"tbl-scroll\"><table class=\"hl-t\"><thead><tr><th>Job</th><th>Expected</th><th>Ran</th><th>Succeeded</th><th>Failed</th><th>Missed</th><th>Late &gt;5 min</th><th>Duplicates</th><th>Median time</th><th>Last run</th><th>Next</th></tr></thead><tbody>" +
      J.map(function (j) { if (j.error) return "<tr><td>" + dot("amber") + esc(j.label) + '</td><td colspan="10">' + esc(j.error) + "</td></tr>";
        return "<tr><td>" + dot(j.status) + esc(j.label) + '<div class="hl-sm">' + esc(j.cadence) + (j.live_age_s != null ? " · live.json " + j.live_age_s + " s old" : "") + "</div></td><td>" + j.expected + "</td><td>" + j.ran + "</td><td>" + j.succeeded + "</td><td>" + (j.failed ? '<b class="hl-bad">' + j.failed + "</b>" : 0) + "</td><td>" + (j.missed ? '<b class="hl-bad" title="' + esc((j.missed_at || []).join(", ")) + '">' + j.missed + "</b>" : 0) + "</td><td>" + j.late + "</td><td>" + j.duplicates + "</td><td>" + (j.median_s != null ? (j.median_s < 120 ? j.median_s + " s" : Math.round(j.median_s / 60) + " min") : "—") + "</td><td>" + (j.last ? (j.last.url ? '<a href="' + esc(j.last.url) + '" target="_blank" rel="noopener">' + et(j.last.at) + "</a>" : et(j.last.at)) + " " + esc(j.last.conclusion || j.last.status || "") : "—") + "</td><td>" + et(j.next, true) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    if (R.length) h += '<div class="hl-sec"><h3>Release-triggered refresh <small>scheduled release → value on the desk, last 7 days</small></h3><div class="tbl-scroll"><table class="hl-t"><thead><tr><th>Release</th><th>Scheduled</th><th>On the desk</th><th>Lag</th></tr></thead><tbody>' +
      R.map(function (r) { return "<tr><td>" + dot(r.status) + esc((r.group || "").toUpperCase() + " " + (r.name || r.key)) + "</td><td>" + esc(r.scheduled.replace("T", " ")) + " ET</td><td>" + (r.on_desk ? et(r.on_desk, true) : "not yet") + "</td><td>" + (r.lag_min != null ? r.lag_min + " min" : "—") + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    h += '<div class="hl-sec"><h3>Last 7 days <small>successful runs per check (rolling 24 h)</small></h3>' + spark(hist.map(function (x) { return x.sch && x.sch.ok; }), null, "#38b6c9") + "</div>";
    return h;
  }
  function render() {
    var P = document.getElementById("panel-health"); if (!P) return;
    if (!H) { P.innerHTML = '<div class="tile wide"><h2>System health</h2>' + (ERR ? '<p class="note">Health report not reachable (' + esc(ERR) + "). The monitor publishes every 15 minutes.</p>" : '<div class="usm-skg" aria-label="Loading"><i></i><i></i><i></i></div>') + "</div>"; return; }
    var A = H.api || {}, S = H.scheduler || {}, sc = A.score || {}, t = S.totals || {}, hist = H.history || [];
    var okJobs = (S.jobs || []).filter(function (j) { return j.status === "green" || j.status === "idle"; }).length;
    var h = '<div class="tile wide hl-tile"><h2>System health <span class="h2note">— each panel has its own check; a green deploy never makes data green</span></h2><div class="hl-meta">Report ' + et(H.updated_at, true) + " (" + ago(H.updated_at) + ") · alerts " + esc((H.alerts || {}).webhook || "not configured") + "</div>" +
      '<div class="hl-cards">' +
      card("api", "Live data &amp; API", (sc.success_rate != null ? sc.success_rate + "%" : "—"), "providers up · " + (sc.stale || 0) + " stale feed" + (sc.stale === 1 ? "" : "s") + (sc.median_ms ? " · " + sc.median_ms + " ms median" : ""), A.status, true) +
      card("sch", "Scheduler &amp; automation", okJobs + " / " + (S.jobs || []).length, "jobs healthy · " + (t.missed || 0) + " missed · " + (t.failed || 0) + " failed (24 h)", S.status, true) +
      card("dq", "Data quality", "—", "OI, price, macro and calendar validation", null, false) +
      card("app", "Application", "—", "site, deploys, files, page errors", null, false) + "</div>" +
      '<div class="hl-detail">' + (SEL === "sch" ? schDetail(S, hist) : apiDetail(A, hist)) + "</div>" +
      '<div class="stamp">Probes call public endpoints without keys; keyed or rate-limited sources (BLS, USDA, FMP, Interactive Brokers) are judged from the data they produced, not probed. Market-closed feeds are not counted as stale.</div></div>';
    P.innerHTML = h;
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-hl]"); if (b) { SEL = b.getAttribute("data-hl"); render(); return; }
    if (ev.target.closest && ev.target.closest("#tabbtn-health")) { render(); load(); clearInterval(timer); timer = setInterval(function () { if (active() && !document.hidden) load(); }, 60000); }
  });
  var css = document.createElement("style");
  css.textContent = ".hl-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:8px 0 14px}" +
    ".hl-card{text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;color:var(--text);cursor:pointer}.hl-card.on{border-color:#38b6c9;box-shadow:0 0 0 1px #38b6c9}.hl-card.dim{opacity:.5;cursor:default}" +
    ".hl-ct{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.hl-cv{font:700 26px 'IBM Plex Mono',monospace;margin:6px 0 2px}.hl-cs{font-size:12px;color:var(--faint)}.hl-cst{margin-top:8px;font-size:12.5px;font-weight:600}" +
    ".hl-d{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:0}.hl-d.ok{background:#3fb97f}.hl-d.warn{background:#e8a33d}.hl-d.bad{background:#e0655f}.hl-d.off{background:#5b6b80}" +
    ".hl-meta{font-size:12px;color:var(--faint)}.hl-sec{margin:14px 0}.hl-sec h3{font-size:13.5px;margin:0 0 6px}.hl-sec h3 small{font-weight:400;color:var(--faint);margin-left:6px;font-size:11.5px}" +
    ".hl-t{width:100%;border-collapse:collapse;font-size:12.5px}.hl-t th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.hl-t td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}" +
    ".hl-np td{color:var(--faint)}.hl-sm{font-size:11px;color:var(--faint)}.hl-bad{color:#e0655f}.hl-ok{font-size:13px}.hl-ul{margin:0;padding-left:4px;list-style:none;font-size:13px;line-height:1.8}.hl-sp{width:100%;max-width:520px;height:46px;display:block}" +
    "@media (max-width:700px){.hl-t{display:block;overflow-x:auto;white-space:nowrap}}";
  document.head.appendChild(css);
  window.HEALTH = { load: load, render: render };
})();
