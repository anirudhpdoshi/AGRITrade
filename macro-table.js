/* macro-table.js — one interactive Macro Table (G-01 / Macro workspace): indicator, period, actual, consensus, prior,
   revised prior, surprise, release time, source and freshness, with Table / Chart / Both views, US/CA and category
   filters and column sorting. Every row opens the existing full-history pop-up. Same data as the rest of the Macro tab. */
(function (root) {
  var doc = root.document;
  var ST = { v: "table", cat: "all", sort: "rel", dir: -1 };
  try { var s0 = JSON.parse(localStorage.getItem("desk.mtab") || "{}"); if (s0 && s0.v) ST = Object.assign(ST, s0); } catch (e) {}
  function save() { try { localStorage.setItem("desk.mtab", JSON.stringify(ST)); } catch (e) {} }
  function esc(s) { return DeskCore.esc(s); }
  var CATS = [["all", "All"], ["infl", "Inflation"], ["lab", "Labour"], ["act", "Activity"], ["rates", "Rates"], ["trade", "Trade & fiscal"]];
  function cat(k) { return /cpi|pce|ppi|trim|median/.test(k) ? "infl" : /_ur$|nfp|emp|ahe|hours|jolts|claims|cclaims|adp|udur/.test(k) ? "lab" : /policy|rate|yield/.test(k) ? "rates" : /trade|deficit|fiscal/.test(k) ? "trade" : "act"; }
  function n(v) { var x = typeof v === "string" ? parseFloat(v) : v; return isFinite(x) ? x : null; }
  function fmtv(m, v) { if (v == null) return "—"; return root.mval ? mval(m, v) : v.toFixed(+m.dec || 1); }
  function dec(m) { return m.dec != null && m.dec !== "" ? +m.dec : 1; }
  function surF(m, x) { var u = m.unit === "K" ? "K" : (m.unit || ""), a = Math.abs(x); return (x > 0 ? "+" : x < 0 ? "\u2212" : "") + (root.fmt ? fmt(a, dec(m)) : a.toFixed(dec(m))) + (u === "%" ? " pp" : u); }
  function etS(t) { return new Date(t).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; }
  function ago(ms) { var h = ms / 36e5; return h < 1 ? Math.round(ms / 6e4) + "m" : h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d"; }
  function relTime(m) {   /* the scheduled release that produced the print on the desk (falls back to when it landed) */
    var seen = m.seen_at ? Date.parse(m.seen_at) : null, L = [], C = root.DATA.release_cal && DATA.release_cal[m.key], H = root.DATA.release_hist && DATA.release_hist[m.key];
    (H || []).concat((C && C.dates) || []).forEach(function (x) { var p = x.split("T"), d = p[0].split("-"), h = (p[1] || "08:30").split(":"); L.push(root.zonedMs ? zonedMs(+d[0], +d[1], +d[2], +h[0], +h[1], "America/Toronto") : Date.parse(x)); });
    var now = Date.now(), past = L.filter(function (t) { return t <= now; }).sort(function (a, b) { return b - a; }), fut = L.filter(function (t) { return t > now; }).sort(function (a, b) { return a - b; });
    var rel = past.filter(function (t) { return !seen || t <= seen + 5 * 6e4; })[0] || (seen || null);
    return { rel: rel, seen: seen, next: fut[0] || null, waiting: !!(past[0] && seen && seen < past[0] - 5 * 6e4) };
  }
  function rows() {
    var M = (root.macroAll ? macroAll() : (DATA.macro || [])).filter(function (m) { return !m.chart_only && (root.MGEO === "both" || !root.MGEO || m.group === root.MGEO); });
    var REL = {}; ((DATA.fx && DATA.fx.releases) || []).forEach(function (r) { REL[r.key] = r; });
    return M.map(function (m) {
      var v = n(m.value), pr = n(m.prior), C = root.consensusFor ? consensusFor(m) : null, cons = C && C.consensus != null ? +C.consensus : null;
      if (cons == null && DATA.macro_cons && DATA.macro_cons[m.key]) { var mc = DATA.macro_cons[m.key], t = Date.parse(mc.at); if (t && m.seen_at && Math.abs(Date.parse(m.seen_at) - t) < 36e5 * 6) cons = n(mc.forecast); }
      /* revised prior: shown only when the prior period's value on the release record differs from today's vintage */
      var R = REL[m.key], first = null;
      if (R && R.history && R.history.length > 1 && pr != null) { var q = R.history[R.history.length - 2][1], tol = Math.pow(10, -(+m.dec || 1)) / 2; if (q != null && Math.abs(q - pr) >= tol) first = q; }
      var t = relTime(m), sur = cons != null && v != null && !t.waiting ? v - cons : null;
      return { m: m, key: m.key, name: (m.group === "us" ? "US " : "CA ") + m.name, cat: cat(m.key), period: m.period, v: v, cons: cons, prior: first != null ? first : pr, rev: first != null ? pr : null, sur: sur, t: t,
        src: m.src || (R && R.source) || "", good: m.good, h: (m.hist24 || m.history || []).slice(-24) };
    }).filter(function (r) { return ST.cat === "all" || r.cat === ST.cat; });
  }
  function sortRows(L) {
    var k = ST.sort, d = ST.dir, val = function (r) { return k === "rel" ? (r.t.rel || 0) : k === "name" ? r.name : k === "sur" ? (r.sur == null ? -1e9 : Math.abs(r.sur)) : k === "next" ? (r.t.next || 9e15) : r[k]; };
    return L.sort(function (a, b) { var x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * d; });
  }
  function spark(h, w, ht) {
    var v = h.map(function (x) { return x[1]; }).filter(function (x) { return x != null; }); if (v.length < 2) return "";
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), rg = hi - lo || 1, W = w || 110, H = ht || 26;
    var pts = v.map(function (y, i) { return (2 + i / (v.length - 1) * (W - 4)).toFixed(1) + "," + (2 + (hi - y) / rg * (H - 4)).toFixed(1); }).join(" ");
    var last = pts.split(" ").pop().split(",");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><polyline fill="none" stroke="#38b6c9" stroke-width="1.5" points="' + pts + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.4" fill="#e8b93d"/></svg>';
  }
  function surCls(r) { if (r.sur == null || Math.abs(r.sur) < 1e-9) return ""; var hot = r.sur > 0; return r.good === "down" ? (hot ? "dn" : "up") : r.good === "heat" ? (hot ? "heat" : "cool") : (hot ? "up" : "dn"); }
  function tableHTML(L, withChart) {
    var th = function (k, t, title) { return '<th data-mtsort="' + k + '"' + (title ? ' title="' + esc(title) + '"' : "") + ' aria-sort="' + (ST.sort === k ? (ST.dir > 0 ? "ascending" : "descending") : "none") + '">' + t + (ST.sort === k ? (ST.dir > 0 ? " ▲" : " ▼") : "") + "</th>"; };
    return '<div class="tbl-scroll"><table class="mt-t"><thead><tr>' + th("name", "Indicator") + "<th>Period</th>" + th("v", "Actual") + th("cons", "Consensus") + th("prior", "Prior", "As first published on the release record") +
      '<th title="Shown only when the source has revised the prior print">Revised prior</th>' + th("sur", "Surprise", "Actual minus consensus") + (withChart ? "<th>Last 24</th>" : "") + th("rel", "Released") + th("next", "Next") + "<th>Source · freshness</th></tr></thead><tbody>" +
      L.map(function (r) {
        var m = r.m, age = r.t.seen ? Date.now() - r.t.seen : null;
        return '<tr data-mkey="' + esc(r.key) + '" tabindex="0" title="Open full history"><td><b>' + esc(r.name) + '</b><small>' + esc(m.measure || "") + "</small></td><td>" + esc(r.period || "—") + (m.gap && m.gap.period ? '<small class="mt-wait">' + esc(new Date(m.gap.period + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '")) + " out" + (m.gap.mm != null ? ": " + (m.gap.mm > 0 ? "+" : "") + m.gap.mm + "% m/m" : "") + ", no y/y</small>" : "") + "</td>" +
          "<td><b>" + fmtv(m, r.v) + "</b>" + (r.t.waiting ? '<small class="mt-wait">new print awaited</small>' : "") + "</td><td>" + (r.cons != null ? fmtv(m, r.cons) : '<span class="mt-na">—</span>') + "</td><td>" + fmtv(m, r.prior) + "</td>" +
          "<td>" + (r.rev != null ? fmtv(m, r.rev) + ' <small class="mt-rev">revised</small>' : '<span class="mt-na">—</span>') + '</td><td class="' + surCls(r) + '">' + (r.sur != null ? surF(m, r.sur) : '<span class="mt-na">—</span>') + "</td>" +
          (withChart ? "<td>" + spark(r.h) + "</td>" : "") +
          "<td>" + (r.t.rel ? etS(r.t.rel) : "—") + "</td><td>" + (r.t.next ? etS(r.t.next) : "—") + "</td>" +
          '<td><small>' + esc(r.src) + "</small><small>" + (age != null ? "on desk " + ago(age) + " ago" : "") + "</small></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function chartHTML(L) {
    return '<div class="mt-g">' + L.map(function (r) {
      return '<button type="button" class="mt-c" data-mkey="' + esc(r.key) + '"><span class="mt-cn">' + esc(r.name) + " <small>" + esc(r.m.measure || "") + "</small></span>" + spark(r.h, 220, 56) +
        '<span class="mt-cv"><b>' + fmtv(r.m, r.v) + "</b> " + esc(r.period || "") + (r.cons != null ? " · cons " + fmtv(r.m, r.cons) : "") + (r.sur != null ? ' · <span class="' + surCls(r) + '">surprise ' + surF(r.m, r.sur) + "</span>" : "") + "</span></button>";
    }).join("") + "</div>";
  }
  function tileHTML() {
    if (!root.DATA || !DATA.macro) return "";
    var L = sortRows(rows()), seg = function (attr, list, cur) { return '<span class="mt-seg">' + list.map(function (x) { return '<button type="button" data-' + attr + '="' + x[0] + '" aria-pressed="' + (x[0] === cur) + '">' + x[1] + "</button>"; }).join("") + "</span>"; };
    return '<div class="tile wide mt-tile" data-src="macro" data-mt-tile><h2>Macro table <span class="h2note">— actual, consensus, prior, revision and surprise for every US and Canada indicator · click a row for its full history</span></h2>' +
      '<div class="mt-ctl">' + seg("mtcat", CATS, ST.cat) + seg("mtv", [["table", "Table"], ["chart", "Chart"], ["both", "Both"]], ST.v) + '<span class="mt-n">' + L.length + " indicators · country filter follows the US / Canada switch</span></div>" +
      (ST.v === "chart" ? chartHTML(L) : tableHTML(L, ST.v === "both")) +
      '<div class="stamp">Consensus where a published forecast exists (release record or economic calendar); surprise is only shown once the actual has printed. Released = the official release that produced the print; freshness = when it landed on the desk. Sources per row.</div></div>';
  }
  function mount() {
    var P = doc.querySelector('#panel-macro [data-subpanel="dash"]'); if (!P) return;
    var old = P.querySelector("[data-mt-tile]"), h = ""; try { h = tileHTML(); } catch (e) { h = ""; }
    if (!h) { if (old) old.remove(); return; }
    var d = doc.createElement("div"); d.innerHTML = h; var t = d.firstChild;
    if (old) { old.replaceWith(t); return; }
    var all = [].filter.call(P.querySelectorAll('.tile[data-src="macro"]'), function (x) { return /All macro indicators/.test((x.querySelector("h2") || {}).textContent || ""); })[0];
    if (all) all.before(t); else P.appendChild(t);
  }
  root.MTAB = { mount: mount, rows: rows };
  if (typeof root.renderMacro === "function") { var _rm = root.renderMacro; root.renderMacro = function () { var r = _rm.apply(this, arguments); try { mount(); } catch (e) {} return r; }; }
  setTimeout(mount, 500);
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-mtcat],[data-mtv],[data-mtsort]"); if (!b || !b.closest("[data-mt-tile]")) return;
    if (b.hasAttribute("data-mtcat")) ST.cat = b.getAttribute("data-mtcat"); else if (b.hasAttribute("data-mtv")) ST.v = b.getAttribute("data-mtv");
    else { var k = b.getAttribute("data-mtsort"); ST.dir = ST.sort === k ? -ST.dir : (k === "name" || k === "next" ? 1 : -1); ST.sort = k; }
    save(); mount();
  });
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("[data-mgeo]")) setTimeout(mount, 60); });
  doc.addEventListener("keydown", function (ev) { var r = ev.key === "Enter" && ev.target.closest && ev.target.closest(".mt-t tr[data-mkey]"); if (r && root.openMacroDetail) openMacroDetail(r.getAttribute("data-mkey")); });
  var css = doc.createElement("style");
  css.textContent = ".mt-tile .tbl-scroll{max-height:560px;overflow:auto}.mt-t thead th{position:sticky;top:0;background:var(--panel);z-index:1}.mt-ctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0 8px}.mt-seg{display:inline-flex;border:1px solid var(--line2);border-radius:7px;overflow:hidden}" +
    ".mt-seg button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 12px 'IBM Plex Sans',sans-serif;padding:4px 10px;cursor:pointer}.mt-seg button+button{border-left:1px solid var(--line2)}" +
    ".mt-seg button[aria-pressed=true]{background:rgba(56,182,201,.16);color:#fff}.mt-n{font-size:12px;color:var(--muted)}" +
    ".mt-t{width:100%;border-collapse:collapse;font-size:13px}.mt-t th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:default}" +
    ".mt-t th[data-mtsort]{cursor:pointer}.mt-t th[data-mtsort]:hover{color:#fff}.mt-t td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}.mt-t td small{display:block;color:var(--muted);font-size:11px}" +
    ".mt-t th,.mt-t td{text-align:right!important}.mt-t th:first-child,.mt-t td:first-child,.mt-t th:last-child,.mt-t td:last-child{text-align:left!important}.mt-t tbody tr{cursor:pointer}.mt-t tbody tr:hover,.mt-t tbody tr:focus{background:rgba(56,182,201,.08);outline:none}.mt-na{color:var(--faint)}.mt-rev{display:inline!important;color:#e8b93d!important}.mt-wait{color:#e8b93d!important}" +
    ".mt-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}.mt-c{appearance:none;text-align:left;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:4px}" +
    ".mt-c:hover{border-color:rgba(56,182,201,.6)}.mt-c svg{width:100%;height:56px}.mt-cn{font-weight:700;font-size:13px}.mt-cn small{color:var(--muted);font-weight:500}.mt-cv{font-size:12.5px;color:var(--muted)}.mt-cv b{color:#fff}";
  doc.head.appendChild(css);
})(window);
