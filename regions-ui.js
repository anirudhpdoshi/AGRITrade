/* regions-ui.js — Regional jobs map on the Macro tab (owner, Nov 18 2026).
   US states (BLS state payrolls + unemployment, by industry) and Canadian provinces (Labour Force Survey, when available).
   Fixed map, no zoom. Hover shows the figures; click a state/province to open its panel: jobs added, % change, unemployment,
   a 12-month trend and jobs by industry. Every number is the published figure; regions with no data stay grey. */
(function (root) {
  var doc = root.document, GEO = null, GEO_LOADING = false;
  var S = { c: "us", m: "mom", sel: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function ym(s) { var p = String(s).split("-"); return MON[+p[1] - 1] + " " + p[0]; }
  function e(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v), d) + (u || ""); }
  function cl(v, inv) { if (v == null || !isFinite(v) || v === 0) return "rg-n"; return (v > 0) !== !!inv ? "rg-u" : "rg-d"; }
  function jobs(k) { k = Math.abs(k); return k >= 1000 ? f(k / 1000, 2) + "M" : k >= 1 ? f(k, 1) + "K" : f(k * 1000, 0); }
  function sj(k) { return k == null || !isFinite(k) ? "—" : (k > 0 ? "+" : k < 0 ? "−" : "") + jobs(k); }

  function loadGeo() { if (GEO || GEO_LOADING) return; GEO_LOADING = true; fetch("geo-maps.json").then(function (r) { return r.json(); }).then(function (j) { GEO = j; redraw(); }).catch(function () { GEO_LOADING = false; }); }

  /* one row per region with the derived figures the map, panel and table share */
  function model() {
    var R = root.DATA && DATA.regions && DATA.regions[S.c]; if (!R) return null;
    var out = {}, list = [];
    Object.keys(R.states || {}).forEach(function (k) {
      var s = R.states[k], nf = s.nf, ur = s.ur || [], L = nf[nf.length - 1], P = nf[nf.length - 2], Y = nf[nf.length - 13];
      var u = ur[ur.length - 1], up = ur[ur.length - 2], uy = ur[ur.length - 13];
      var o = { k: k, n: s.n, s: s, lvl: L[1], mo: L[0], mom: P ? L[1] - P[1] : null, momp: P ? (L[1] / P[1] - 1) * 100 : null, yoy: Y ? L[1] - Y[1] : null, yoyp: Y ? (L[1] / Y[1] - 1) * 100 : null,
        ur: u ? u[1] : null, urd: u && up ? u[1] - up[1] : null, ury: u && uy ? u[1] - uy[1] : null };
      out[k] = o; list.push(o);
    });
    return { R: R, by: out, list: list };
  }
  function val(o) { return S.m === "mom" ? o.mom : S.m === "yoyp" ? o.yoyp : o.ur; }
  function color(o, M) {
    var v = val(o); if (v == null) return "var(--rg-na)";
    if (S.m === "ur") { var a = M.list.map(function (x) { return x.ur; }).filter(function (x) { return x != null; }), lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      return "hsl(" + (140 - t * 140).toFixed(0) + ",55%," + (42 - Math.abs(t - 0.5) * 8).toFixed(0) + "%)"; }
    var vs = M.list.map(val).filter(function (x) { return x != null; }), mx = Math.max.apply(null, vs.map(Math.abs)) || 1, t2 = Math.min(1, Math.sqrt(Math.abs(v) / mx));
    return v >= 0 ? "rgba(52,214,127," + (0.18 + 0.72 * t2).toFixed(2) + ")" : "rgba(255,98,98," + (0.18 + 0.72 * t2).toFixed(2) + ")";
  }
  function label(o) { var v = val(o); return S.m === "mom" ? sj(v) : S.m === "yoyp" ? sg(v, 1, "%") : f(v, 1) + "%"; }

  function mapSVG(M) {
    var G = GEO && GEO[S.c]; if (!G) { loadGeo(); return '<div class="rg-ph">Loading map…</div>'; }
    var key = function (a) { if (S.c === "us") { var st = (root.US_FIPS || {})[a.id]; return st; } return a.id.toUpperCase(); };
    var paths = G.areas.map(function (a) {
      var k = key(a), o = k && M.by[k], on = S.sel === k;
      return '<path d="' + a.d + '" class="rg-a' + (on ? " on" : "") + (o ? "" : " na") + '" data-rg="' + (k || "") + '" fill="' + (o ? color(o, M) : "var(--rg-na)") + '"><title>' + e(a.name) + (o ? " · " + label(o) + " · " + ym(o.mo) : " · no data") + "</title></path>";
    }).join("");
    return '<svg viewBox="' + G.viewBox + '" class="rg-svg" role="img" aria-label="' + (S.c === "us" ? "US states" : "Canadian provinces") + ' coloured by ' + S.m + '">' + paths + '<g class="rg-lbs"></g></svg>';
  }
  /* labels sit at each shape's visual centre; measured after render so they fit any map */
  function labels(M) {
    var svg = doc.querySelector("#rg-tile .rg-svg"), g = svg && svg.querySelector(".rg-lbs"); if (!g) return;
    var vb = svg.viewBox.baseVal, small = { us: { VT: 1, NH: 1, MA: 1, RI: 1, CT: 1, NJ: 1, DE: 1, MD: 1, DC: 1 }, ca: { PE: 1, NS: 1, NB: 1 } }[S.c], h = "";
    [].forEach.call(svg.querySelectorAll(".rg-a[data-rg]"), function (p) {
      var k = p.getAttribute("data-rg"), o = M.by[k]; if (!o) return; var b = p.getBBox(); if (b.width * b.height < (S.c === "us" ? 900 : 1200) && !small[k]) return;
      var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      if (S.c === "us" && { FL: 1, LA: 1, MI: 1, ID: 1, KY: 1 }[k]) { cx += { FL: 12, LA: -8, MI: 12, ID: -4, KY: 4 }[k]; cy += { FL: 0, LA: -4, MI: 18, ID: 14, KY: 2 }[k]; }
      if (small[k]) return;
      var big = Math.min(b.width, b.height) > (S.c === "us" ? 40 : 60);
      h += '<text x="' + cx.toFixed(1) + '" y="' + (cy - (big ? 3 : 0)).toFixed(1) + '" class="rg-l' + (S.sel === k ? " on" : "") + '">' + k + "</text>" + (big ? '<text x="' + cx.toFixed(1) + '" y="' + (cy + 11).toFixed(1) + '" class="rg-v">' + label(o) + "</text>" : "");
    });
    g.innerHTML = h;
  }

  function spark(arr, w, hgt, inv) {
    var a = arr.slice(-13); if (a.length < 2) return ""; var v = a.map(function (x) { return x[1]; }), lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = hi - lo || 1;
    var X = function (i) { return 6 + i * (w - 12) / (a.length - 1); }, Y = function (q) { return 8 + (hi - q) / r * (hgt - 26); };
    var d = a.map(function (x, i) { return (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(x[1]).toFixed(1); }).join(""), up = (v[v.length - 1] - v[0]) * (inv ? -1 : 1) >= 0;
    return '<svg viewBox="0 0 ' + w + " " + hgt + '" class="rg-sp"><path d="' + d + '" fill="none" stroke="' + (up ? "#34d67f" : "#ff6262") + '" stroke-width="2"/>' +
      a.map(function (x, i) { return '<circle cx="' + X(i) + '" cy="' + Y(x[1]) + '" r="' + (i === a.length - 1 ? 3.5 : 2) + '" fill="' + (up ? "#34d67f" : "#ff6262") + '"><title>' + ym(x[0]) + ": " + f(x[1], inv ? 1 : 1) + (inv ? "%" : "K") + "</title></circle>"; }).join("") +
      '<text x="6" y="' + (hgt - 3) + '" class="rg-ax">' + ym(a[0][0]) + '</text><text x="' + (w - 6) + '" y="' + (hgt - 3) + '" class="rg-ax" text-anchor="end">' + ym(a[a.length - 1][0]) + "</text></svg>";
  }

  function panel(M) {
    var o = S.sel && M.by[S.sel];
    if (!o) {
      var by = M.list.filter(function (x) { return val(x) != null; }).sort(function (a, b) { return val(b) - val(a); });
      var tot = M.list.reduce(function (a, x) { return a + (x.mom || 0); }, 0), totY = M.list.reduce(function (a, x) { return a + (x.yoy || 0); }, 0);
      var li = function (x) { return '<li data-rg="' + x.k + '"><b>' + e(x.n) + '</b><span class="' + (S.m === "ur" ? cl(-1 * (x.ur - 4.5)) : cl(val(x))) + '">' + label(x) + "</span></li>"; };
      var inv = S.m === "ur";
      return '<div class="rg-p"><div class="rg-pt">' + (S.c === "us" ? "United States · all states" : "Canada · all provinces") + '</div><div class="rg-ps">' + ym(M.list[0] ? M.list[0].mo : "") + " · click a " + (S.c === "us" ? "state" : "province") + " for its detail</div>" +
        '<div class="rg-kv"><div><span>Jobs added, month</span><b class="' + cl(tot) + '">' + sj(tot) + '</b></div><div><span>Jobs added, 12 months</span><b class="' + cl(totY) + '">' + sj(totY) + "</b></div></div>" +
        '<div class="rg-h">' + (inv ? "Lowest unemployment" : "Biggest gains") + '</div><ul class="rg-ls">' + (inv ? by.slice().reverse() : by).slice(0, 5).map(li).join("") + "</ul>" +
        '<div class="rg-h">' + (inv ? "Highest unemployment" : "Biggest losses") + '</div><ul class="rg-ls">' + (inv ? by : by.slice().reverse()).slice(0, 5).map(li).join("") + "</ul>" +
        '<div class="rg-note">Sum of state payroll changes; the national payroll survey is estimated separately, so totals differ slightly from the headline number.</div></div>';
    }
    var s = o.s, IN = M.R.ind_names || {};
    var ind = Object.keys(s.ind || {}).map(function (c) { var a = s.ind[c], L = a[a.length - 1], P = a[a.length - 2], Y = a[a.length - 13]; return { n: IN[c] || c, lvl: L[1], mom: P ? L[1] - P[1] : null, yoy: Y ? L[1] - Y[1] : null, yoyp: Y ? (L[1] / Y[1] - 1) * 100 : null }; })
      .sort(function (a, b) { return (b.mom || 0) - (a.mom || 0); });
    var mx = Math.max.apply(null, ind.map(function (x) { return Math.abs(x.mom || 0); }).concat([0.1]));
    var rows = ind.map(function (x) { var w = Math.abs(x.mom || 0) / mx * 50;
      return "<tr><td>" + e(x.n) + '</td><td class="rg-bar"><span class="' + (x.mom >= 0 ? "pos" : "neg") + '" style="width:' + w.toFixed(1) + '%;' + (x.mom >= 0 ? "left:50%" : "right:50%") + '"></span></td><td class="' + cl(x.mom) + '">' + sj(x.mom) + '</td><td class="' + cl(x.yoyp) + '">' + sg(x.yoyp, 1, "%") + "</td><td>" + jobs(x.lvl) + "</td></tr>"; }).join("");
    return '<div class="rg-p"><div class="rg-pt">' + e(o.n) + ' <button class="rg-x" data-rg="" title="Back to all">✕</button></div><div class="rg-ps">' + ym(o.mo) + " · payroll jobs and unemployment, seasonally adjusted</div>" +
      '<div class="rg-kv"><div><span>Jobs added, month</span><b class="' + cl(o.mom) + '">' + sj(o.mom) + '</b><i class="' + cl(o.momp) + '">' + sg(o.momp, 2, "%") + '</i></div><div><span>Jobs added, 12 months</span><b class="' + cl(o.yoy) + '">' + sj(o.yoy) + '</b><i class="' + cl(o.yoyp) + '">' + sg(o.yoyp, 1, "%") + "</i></div>" +
      '<div><span>Unemployment rate</span><b>' + f(o.ur, 1) + '%</b><i class="' + cl(o.urd, true) + '">' + sg(o.urd, 1, " pp") + ' m/m</i></div><div><span>Total payroll jobs</span><b>' + jobs(o.lvl) + "</b><i class=\"rg-n\">" + sg(o.ury, 1, " pp") + " unemp. y/y</i></div></div>" +
      '<div class="rg-h">Payroll jobs · 12-month trend</div>' + spark(s.nf, 320, 90) +
      '<div class="rg-h">Unemployment rate · 12-month trend</div>' + spark(s.ur || [], 320, 80, true) +
      (rows ? '<div class="rg-h">Jobs by industry · month</div><table class="rg-t"><thead><tr><th>Industry</th><th></th><th>Month</th><th>Y/Y</th><th>Jobs</th></tr></thead><tbody>' + rows + "</tbody></table>" : '<div class="rg-note">No industry detail published for this region.</div>') + "</div>";
  }

  function tableHTML(M) {
    var L = M.list.slice().sort(function (a, b) { return (val(b) == null) - (val(a) == null) || (S.m === "ur" ? val(a) - val(b) : val(b) - val(a)); });
    return '<details class="rg-all"><summary>All ' + (S.c === "us" ? "states" : "provinces") + " · table</summary><div class=\"rg-tw\"><table class=\"rg-t\"><thead><tr><th>" + (S.c === "us" ? "State" : "Province") + "</th><th>Jobs m/m</th><th>m/m %</th><th>Jobs y/y</th><th>y/y %</th><th>Unemp.</th><th>Δ m/m</th><th>Month</th></tr></thead><tbody>" +
      L.map(function (o) { return '<tr data-rg="' + o.k + '" class="' + (S.sel === o.k ? "on" : "") + '"><td><b>' + e(o.n) + '</b></td><td class="' + cl(o.mom) + '">' + sj(o.mom) + '</td><td class="' + cl(o.momp) + '">' + sg(o.momp, 2, "%") + '</td><td class="' + cl(o.yoy) + '">' + sj(o.yoy) + '</td><td class="' + cl(o.yoyp) + '">' + sg(o.yoyp, 1, "%") + "</td><td>" + f(o.ur, 1) + '%</td><td class="' + cl(o.urd, true) + '">' + sg(o.urd, 1) + "</td><td>" + ym(o.mo) + "</td></tr>"; }).join("") + "</tbody></table></div></details>";
  }

  function html() {
    var D = root.DATA && DATA.regions || {}, has = { us: !!D.us, ca: !!D.ca };
    if (!has.us && !has.ca) return "";
    if (!has[S.c]) S.c = has.us ? "us" : "ca";
    var M = model(); if (!M) return "";
    var btn = function (a, v, t, dis) { return '<button data-rg-' + a + '="' + v + '" class="' + (S[a] === v ? "on" : "") + '"' + (dis ? " disabled title=\"" + e(dis) + "\"" : "") + ">" + t + "</button>"; };
    return '<div class="tile wide no-nf" id="rg-tile" data-src="us_states"><h2>Regional jobs map <span class="h2note">— ' + e(M.R.src) + " · latest " + ym(M.list[0] ? M.list[0].mo : "") + "</span></h2>" +
      '<div class="rg-bar0"><span class="rg-sw">' + btn("c", "us", "United States") + btn("c", "ca", "Canada", has.ca ? "" : "Canada's Labour Force Survey by province is not available: Statistics Canada is blocking our data servers") + '</span><span class="rg-sw">' +
      btn("m", "mom", "Jobs added · month") + btn("m", "yoyp", "Jobs · % y/y") + btn("m", "ur", "Unemployment rate") + '</span><span class="rg-lg"><i style="background:rgba(255,98,98,.8)"></i>' + (S.m === "ur" ? "higher" : "losses") + '<i style="background:rgba(52,214,127,.8)"></i>' + (S.m === "ur" ? "lower" : "gains") + "</span></div>" +
      '<div class="rg-g"><div class="rg-m">' + mapSVG(M) + "</div>" + panel(M) + "</div>" + tableHTML(M) +
      '<div class="stamp">Fixed map, no zoom: hover for figures, click a ' + (S.c === "us" ? "state" : "province") + " to open its jobs, unemployment, 12-month trend and industry detail. Figures are the published seasonally adjusted estimates; grey = no published figure. Map: " + e(GEO && GEO[S.c] ? GEO[S.c].src : "") + ".</div></div>";
  }
  function redraw() { var el = doc.getElementById("rg-tile"); if (!el) return; var o = el.querySelector("details.rg-all"), open = o && o.open; el.outerHTML = html(); var n = doc.getElementById("rg-tile"); if (n && open) n.querySelector("details.rg-all").open = true; labels(model() || { by: {} }); }
  doc.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest("#rg-tile [data-rg], #rg-tile [data-rg-c], #rg-tile [data-rg-m]"); if (!t || t.disabled) return;
    if (t.hasAttribute("data-rg-c")) { S.c = t.getAttribute("data-rg-c"); S.sel = null; } else if (t.hasAttribute("data-rg-m")) S.m = t.getAttribute("data-rg-m");
    else { var k = t.getAttribute("data-rg"); S.sel = k && S.sel !== k ? k : null; }
    redraw();
  });
  /* "By state / By province" chips on the jobs cards jump here */
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-rgo]"); if (!b) return; ev.stopPropagation(); ev.preventDefault();
    var c = b.getAttribute("data-rgo"); if (DATA.regions && DATA.regions[c]) S.c = c; S.sel = null; S.m = /_ur$/.test(b.closest("[data-mkey]") ? b.closest("[data-mkey]").getAttribute("data-mkey") : "") ? "ur" : "mom";
    var t = doc.querySelector('[data-sub="reg"][data-subp="macro"]'); if (t) t.click(); setTimeout(function () { redraw(); var el = doc.getElementById("rg-tile"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80);
  }, true);
  /* labels after every render of the Macro tab */
  new MutationObserver(function () { var g = doc.querySelector("#rg-tile .rg-lbs"); if (g && !g.childNodes.length) labels(model() || { by: {} }); }).observe(doc.documentElement, { childList: true, subtree: true });

  var st = doc.createElement("style");
  st.textContent = ":root{--rg-na:#2a3442}html[data-theme=light]{--rg-na:#d9dee5}" +
    ".rg-bar0{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 12px}.rg-sw button{all:unset;cursor:pointer;padding:5px 12px;border:1px solid var(--line);font-size:12.5px;font-weight:600}.rg-sw button:first-child{border-radius:8px 0 0 8px}.rg-sw button:last-child{border-radius:0 8px 8px 0}.rg-sw button+button{border-left:0}.rg-sw button.on{background:rgba(255,184,77,.14);color:#ffb84d;border-color:rgba(255,184,77,.5)}.rg-sw button[disabled]{opacity:.4;cursor:not-allowed}" +
    ".rg-lg{margin-left:auto;font-size:12px;color:var(--faint)}.rg-lg i{display:inline-block;width:14px;height:10px;border-radius:2px;margin:0 5px 0 10px;vertical-align:-1px}" +
    ".rg-g{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,1fr);gap:16px;align-items:start}.rg-svg{width:100%;height:auto;display:block}.rg-a{stroke:var(--bg,#0b1016);stroke-width:.8;cursor:pointer;transition:filter .12s}.rg-a:hover{filter:brightness(1.35);stroke:#fff;stroke-width:1.2}.rg-a.on{stroke:#ffb84d;stroke-width:2.4}.rg-a.na{cursor:default}" +
    ".rg-l{font-size:11px;font-weight:800;fill:#fff;text-anchor:middle;pointer-events:none;paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:2.5px}.rg-l.on{fill:#ffb84d}.rg-v{font-size:9.5px;font-weight:700;fill:#fff;text-anchor:middle;pointer-events:none;paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:2.5px}" +
    ".rg-p{border:1px solid var(--line);border-radius:10px;padding:12px 14px}.rg-pt{font-size:17px;font-weight:800;display:flex;justify-content:space-between;align-items:center}.rg-x{all:unset;cursor:pointer;font-size:13px;color:var(--faint);padding:2px 6px}.rg-ps{font-size:12px;color:var(--faint);margin:2px 0 10px}" +
    ".rg-kv{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rg-kv>div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}.rg-kv span{font-size:11px;color:var(--faint)}.rg-kv b{font-size:19px;font-variant-numeric:tabular-nums}.rg-kv i{font-style:normal;font-size:12px;font-weight:700}" +
    ".rg-h{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:14px 0 6px;font-weight:700}.rg-ls{list-style:none;margin:0;padding:0}.rg-ls li{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px}.rg-ls li:hover{background:rgba(255,184,77,.06)}" +
    ".rg-sp{width:100%;height:auto;display:block}.rg-ax{font-size:10px;fill:var(--faint)}.rg-t{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}.rg-t th{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);text-align:right;padding:5px 6px;border-bottom:1px solid var(--line)}.rg-t td{padding:6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}.rg-t th:first-child,.rg-t td:first-child{text-align:left;white-space:normal}" +
    ".rg-t tr[data-rg]{cursor:pointer}.rg-t tr.on{background:rgba(255,184,77,.1)}.rg-bar{position:relative;width:70px}.rg-bar span{position:absolute;top:50%;height:8px;margin-top:-4px;border-radius:2px}.rg-bar .pos{background:#34d67f}.rg-bar .neg{background:#ff6262}" +
    ".rg-u{color:#34d67f;font-weight:700}.rg-d{color:#ff6262;font-weight:700}.rg-n{color:var(--faint)}html[data-theme=light] .rg-u{color:#0d8a4a}html[data-theme=light] .rg-d{color:#c62828}" +
    ".rg-note{font-size:11.5px;color:var(--faint);margin-top:10px}.rg-all{margin-top:14px}.rg-all summary{cursor:pointer;font-weight:700;font-size:13px}.rg-tw{overflow-x:auto;margin-top:8px}.rg-ph{padding:60px;text-align:center;color:var(--faint)}" +
    ".rg-t thead{display:table-header-group!important}.rg-t tbody{display:table-row-group!important}.rg-t tr{display:table-row!important}.rg-t td,.rg-t th{display:table-cell!important}.rg-t td:before{content:none!important}" +
    ".rg-go{all:unset;cursor:pointer;display:inline-block;margin-top:6px;font-size:11px;font-weight:700;padding:2px 8px;border:1px solid rgba(63,185,127,.5);border-radius:999px;color:#3fb97f}.rg-go:hover{background:rgba(63,185,127,.12)}" +
    "#rg-tile{container-type:inline-size}@container (max-width:820px){.rg-g{grid-template-columns:1fr}}";
  doc.head.appendChild(st);
  root.US_FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
  var LASTKEY = null;
  /* the Macro page shows the map under a jobs indicator's card (payrolls, employment, unemployment) */
  function forKey(key) {
    var m = /^(us|ca)_(nfp|emp|ur)$/.exec(key || ""); if (!m) return "";
    var c = m[1], R = root.DATA && DATA.regions || {};
    if (!R[c]) return c === "ca" ? '<div class="tile wide rg-off"><h2>Jobs by province</h2><p class="rg-note">The province map needs Statistics Canada\u2019s Labour Force Survey by province. Statistics Canada is currently blocking requests from our data servers, so the map is held back rather than shown with stale or estimated figures.</p></div>' : "";
    if (key !== LASTKEY) { LASTKEY = key; S.c = c; S.m = m[2] === "ur" ? "ur" : "mom"; S.sel = null; }
    return html();
  }
  root.REGIONS = { html: html, redraw: redraw, forKey: forKey };
})(window);
