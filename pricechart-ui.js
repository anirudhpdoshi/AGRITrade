/* Interactive grain price chart (chunk 5: CH-01..06). Daily bars from DATA.grain_long (Yahoo continuous front month, ~18 months).
   Range 1M / 3M / 6M / 1Y / All · drag across the chart to zoom, double-click or Reset to undo · crosshair with date, OHLC, change, averages ·
   MA20/50/100/200 toggles (computed over the full series, so a 200-day average is real even on a 1M view) · WASDE and feed-alert markers ·
   Chart / Table / Both — the table lists exactly the sessions the chart shows. Sits under the sigma-fan chart on each grain Overview. */
(function (root) {
  var doc = document, NS = "http://www.w3.org/2000/svg";
  var RANGES = [["1M", 21], ["3M", 63], ["6M", 126], ["1Y", 252], ["All", 0]];
  var MAS = [[20, "#e8b93d"], [50, "#a78bfa"], [100, "#38b6c9"], [200, "#f08a5d"]];
  var ST = {};
  try { ST = JSON.parse(localStorage.getItem("desk.pxc") || "{}"); } catch (e) {}
  function st(k) { return ST[k] || (ST[k] = { r: "3M", ma: { 20: 1, 50: 1 }, v: "chart" }); }
  function save() { try { var o = {}; Object.keys(ST).forEach(function (k) { o[k] = { r: ST[k].r, ma: ST[k].ma, v: ST[k].v }; }); localStorage.setItem("desk.pxc", JSON.stringify(o)); } catch (e) {} }
  function esc(s) { return DeskCore.esc(s); }
  function f4(v) { return v == null ? "—" : "$" + v.toFixed(4).replace(/0{1,2}$/, ""); }
  function dlab(d, long) { var x = new Date(d + "T12:00:00Z"); return x.toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }); }
  function series(k) { var G = root.DATA && DATA.grain_long; return G && G.series && G.series[k] || null; }
  function maOf(S, n) { var o = new Array(S.length), sum = 0; for (var i = 0; i < S.length; i++) { sum += S[i][4]; if (i >= n) sum -= S[i - n][4]; o[i] = i >= n - 1 ? sum / n : null; } return o; }
  function win(k, S) { var s = st(k); if (s.z) return [Math.max(0, s.z[0]), Math.min(S.length - 1, s.z[1])];
    var n = RANGES.filter(function (r) { return r[0] === s.r; })[0][1]; return [n ? Math.max(0, S.length - n) : 0, S.length - 1]; }
  function wasdeDates() { var G = root.DATA && DATA.grain_long, C = root.DATA && DATA.release_cal && DATA.release_cal.wasde;
    return ((G && G.wasde) || (C && C.dates) || []).map(function (x) { return String(x).slice(0, 10); }); }

  function svg(k, S, w) {
    var s = st(k), W = 900, H = 330, PL = 56, PR = 14, PT = 14, PB = 64, VH = 34, pw = W - PL - PR, ph = H - PT - PB - VH - 6;
    var a = w[0], b = w[1], n = b - a + 1, M = {};
    MAS.forEach(function (m) { if (s.ma[m[0]]) M[m[0]] = maOf(S, m[0]); });
    var lo = Infinity, hi = -Infinity, vmax = 0;
    for (var i = a; i <= b; i++) { lo = Math.min(lo, S[i][3]); hi = Math.max(hi, S[i][2]); vmax = Math.max(vmax, S[i][5] || 0);
      Object.keys(M).forEach(function (q) { var v = M[q][i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); }
    var pad = (hi - lo) * 0.06 || 0.05; lo -= pad; hi += pad;
    var X = function (i) { return PL + (n < 2 ? pw / 2 : (i - a) / (n - 1) * pw); }, Y = function (v) { return PT + (hi - v) / (hi - lo) * ph; };
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="pxc-svg" role="img" aria-label="' + esc(k) + ' daily price, ' + esc(dlab(S[a][0])) + " to " + esc(dlab(S[b][0])) + '">';
    for (var g = 0; g <= 4; g++) { var gv = lo + (hi - lo) * g / 4; o += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(gv).toFixed(1) + '" y2="' + Y(gv).toFixed(1) + '" stroke="var(--line)"/><text x="' + (PL - 6) + '" y="' + (Y(gv) + 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--faint)" font-family="IBM Plex Mono">' + gv.toFixed(2) + "</text>"; }
    var step = Math.max(1, Math.ceil(n / 7));
    for (i = a; i <= b; i++) if ((i - a) % step === 0 || i === b) o += '<text x="' + X(i).toFixed(1) + '" y="' + (H - PB + VH + 22) + '" text-anchor="' + (i === a ? "start" : i === b ? "end" : "middle") + '" font-size="10.5" fill="var(--faint)" font-family="IBM Plex Mono">' + esc(dlab(S[i][0])) + "</text>";
    /* event markers: WASDE reports, and the feed alert that brought you here */
    var WD = wasdeDates(); for (i = a; i <= b; i++) if (WD.indexOf(S[i][0]) >= 0) o += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + ph) + '" stroke="var(--line2)" stroke-dasharray="2 3"/><text x="' + (X(i) > W - PR - 50 ? X(i) - 3 : X(i) + 3).toFixed(1) + '" y="' + (PT + 10) + '"' + (X(i) > W - PR - 50 ? ' text-anchor="end"' : "") + ' font-size="9.5" fill="var(--faint)" font-family="IBM Plex Mono">WASDE</text>';
    var FE = root.FAN_EVENT; if (FE && FE.key === k) { var ed = new Date(FE.t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); for (i = a; i <= b; i++) if (S[i][0] === ed) o += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + ph) + '" stroke="#e8b93d" stroke-width="1.5" stroke-dasharray="4 3"/><text x="' + (X(i) - 4).toFixed(1) + '" y="' + (PT + 22) + '" text-anchor="end" font-size="10.5" font-weight="700" fill="#e8b93d" font-family="IBM Plex Mono">⚑ alert</text>'; }
    /* volume */
    var vy0 = H - PB + VH; for (i = a; i <= b; i++) if (S[i][5]) { var vh = S[i][5] / (vmax || 1) * VH, bw = Math.max(1, pw / n * 0.7); o += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + (vy0 - vh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + vh.toFixed(1) + '" fill="rgba(110,168,255,.28)"/>'; }
    o += '<text x="' + (PL - 6) + '" y="' + (vy0 - VH + 9) + '" text-anchor="end" font-size="9.5" fill="var(--faint)" font-family="IBM Plex Mono">vol</text>';
    /* averages, then the close on top */
    Object.keys(M).forEach(function (q) { var c = MAS.filter(function (m) { return m[0] == q; })[0][1], pts = [];
      for (var i = a; i <= b; i++) if (M[q][i] != null) pts.push(X(i).toFixed(1) + "," + Y(M[q][i]).toFixed(1));
      if (pts.length > 1) o += '<polyline fill="none" stroke="' + c + '" stroke-width="1.4" stroke-opacity=".9" points="' + pts.join(" ") + '"/>'; });
    var cp = []; for (i = a; i <= b; i++) cp.push(X(i).toFixed(1) + "," + Y(S[i][4]).toFixed(1));
    o += '<polyline fill="none" stroke="#e6edf5" stroke-width="2" stroke-linejoin="round" points="' + cp.join(" ") + '"/>';
    o += '<line class="pxc-x" x1="0" x2="0" y1="' + PT + '" y2="' + (vy0) + '" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><circle class="pxc-d" r="4" fill="#e6edf5" visibility="hidden"/>';
    o += '<rect class="pxc-sel" y="' + PT + '" height="' + (vy0 - PT) + '" fill="rgba(56,182,201,.15)" visibility="hidden"/>';
    o += '<rect class="pxc-hit" x="' + PL + '" y="' + PT + '" width="' + pw + '" height="' + (vy0 - PT) + '" fill="transparent" data-k="' + k + '" data-a="' + a + '" data-b="' + b + '" data-pl="' + PL + '" data-pw="' + pw + '" data-lo="' + lo + '" data-hi="' + hi + '" data-pt="' + PT + '" data-ph="' + ph + '"/>';
    return o + "</svg>";
  }
  function table(k, S, w) {
    var M20 = maOf(S, 20), M50 = maOf(S, 50), r = [];
    for (var i = w[1]; i >= w[0]; i--) { var c = S[i][4], p = i > 0 ? S[i - 1][4] : null, d = p != null ? c - p : null;
      r.push("<tr><td>" + esc(dlab(S[i][0], true)) + "</td><td>" + f4(S[i][1]) + "</td><td>" + f4(S[i][2]) + "</td><td>" + f4(S[i][3]) + "</td><td><b>" + f4(c) + '</b></td><td class="' + (d > 0 ? "up" : d < 0 ? "dn" : "") + '">' + (d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + (Math.abs(d) * 100).toFixed(2) + "¢") + "</td><td>" + f4(M20[i]) + "</td><td>" + f4(M50[i]) + "</td><td>" + (S[i][5] != null ? S[i][5].toLocaleString("en-US") : "—") + "</td></tr>"); }
    return '<div class="pxc-tw"><table class="pxc-t"><thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Change</th><th>MA20</th><th>MA50</th><th>Volume</th></tr></thead><tbody>' + r.join("") + "</tbody></table></div>";
  }
  function tileHTML(k) {
    var S = series(k), G = root.DATA && DATA.grain_long; if (!S || S.length < 5) return "";
    var s = st(k), w = win(k, S), nm = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" }[k], sym = { corn: "ZC=F", wheat: "ZW=F", soybeans: "ZS=F" }[k];
    var b = function (attr, val, on, t, ttl) { return '<button class="pxc-b" data-pxc="' + k + "|" + attr + "|" + val + '" aria-pressed="' + !!on + '"' + (ttl ? ' title="' + esc(ttl) + '"' : "") + ">" + t + "</button>"; };
    var first = S[w[0]], last = S[w[1]], ch = last[4] - first[4];
    return '<div class="tile wide pxc" data-pxc-tile="' + k + '"><h2>' + nm + " price chart <span class=\"h2note\">— daily, front month (continuous) · drag to zoom, double-click to reset · hover for values</span></h2>" +
      '<div class="pxc-ctl"><span class="pxc-seg">' + RANGES.map(function (r) { return b("r", r[0], !s.z && s.r === r[0], r[0]); }).join("") + "</span>" +
      '<span class="pxc-seg">' + MAS.map(function (m) { return b("ma", m[0], s.ma[m[0]], '<i style="background:' + m[1] + '"></i>MA' + m[0], m[0] + "-session moving average"); }).join("") + "</span>" +
      '<span class="pxc-seg">' + b("v", "chart", s.v === "chart", "Chart") + b("v", "table", s.v === "table", "Table") + b("v", "both", s.v === "both", "Both") + "</span>" +
      (s.z ? b("reset", "1", false, "Reset zoom") : "") + "</div>" +
      '<div class="pxc-sum">' + esc(dlab(first[0], true)) + " → " + esc(dlab(last[0], true)) + " · " + (w[1] - w[0] + 1) + " sessions · close " + f4(first[4]) + " → <b>" + f4(last[4]) + '</b> <span class="' + (ch > 0 ? "up" : ch < 0 ? "dn" : "") + '">(' + (ch > 0 ? "+" : ch < 0 ? "−" : "") + (Math.abs(ch) * 100).toFixed(1) + "¢, " + (ch / first[4] * 100).toFixed(1) + "%)</span></div>" +
      (s.v !== "table" ? '<div class="pxc-wrap">' + svg(k, S, w) + '<div class="pxc-tip" hidden></div></div>' : "") + (s.v !== "chart" ? table(k, S, w) : "") +
      '<div class="stamp">Source: ' + esc(G.src || "Yahoo Finance") + " (" + sym + "). A continuous series rolls to the next contract at expiry, so it is a reference line, not one tradable contract; the σ-fan above uses the desk's front contract. Fetched " +
      esc(new Date(G.asof).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET.</div></div>";
  }
  function mount(k) {
    var P = doc.querySelector("#panel-" + k + ' [data-subpanel="overview"]'); if (!P) return;
    var old = P.querySelector("[data-pxc-tile]"), h = tileHTML(k); if (!h) { if (old) old.remove(); return; }
    var d = doc.createElement("div"); d.innerHTML = h; var t = d.firstChild;
    if (old) old.replaceWith(t); else { var fan = P.querySelector('[data-src="grains_quote"]'); if (fan) fan.after(t); else P.appendChild(t); }
  }
  root.PXC = { mount: mount, tileHTML: tileHTML };
  /* after every grain render */
  if (typeof root.renderGrain === "function") { var _rg = root.renderGrain; root.renderGrain = function (k) { var r = _rg.apply(this, arguments); try { mount(k); } catch (e) {} return r; }; }
  setTimeout(function () { ["corn", "wheat", "soybeans"].forEach(function (k) { try { mount(k); } catch (e) {} }); }, 400);

  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-pxc]"); if (!b) return;
    var p = b.getAttribute("data-pxc").split("|"), k = p[0], s = st(k);
    if (p[1] === "r") { s.r = p[2]; s.z = null; } else if (p[1] === "ma") s.ma[p[2]] = !s.ma[p[2]]; else if (p[1] === "v") s.v = p[2]; else if (p[1] === "reset") s.z = null;
    /* timeframe, averages and view follow the trader across Corn / Wheat / Soybeans (zoom stays per chart) */
    if (p[1] === "r" || p[1] === "ma" || p[1] === "v") ["corn", "wheat", "soybeans"].forEach(function (o) { if (o === k) return; var t = st(o); t.r = s.r; t.ma = JSON.parse(JSON.stringify(s.ma)); t.v = s.v; if (p[1] === "r") t.z = null; try { mount(o); } catch (e) {} });
    save(); mount(k);
  });
  /* crosshair + tooltip; drag to zoom */
  var drag = null;
  function idxAt(r, e) { var bb = r.getBoundingClientRect(), svgEl = r.ownerSVGElement, vb = svgEl.viewBox.baseVal, sx = vb.width / svgEl.getBoundingClientRect().width;
    var x = (e.clientX - svgEl.getBoundingClientRect().left) * sx, a = +r.dataset.a, b = +r.dataset.b, pl = +r.dataset.pl, pw = +r.dataset.pw;
    return { i: Math.max(a, Math.min(b, Math.round(a + (x - pl) / pw * (b - a)))), x: x }; }
  doc.addEventListener("pointermove", function (e) {
    var r = e.target.closest && e.target.closest(".pxc-hit"); var wrap = r && r.closest(".pxc-wrap");
    doc.querySelectorAll(".pxc-wrap").forEach(function (w) { if (w !== wrap) { var t = w.querySelector(".pxc-tip"); if (t) t.hidden = true; ["pxc-x", "pxc-d"].forEach(function (c) { var el = w.querySelector("." + c); if (el) el.setAttribute("visibility", "hidden"); }); } });
    if (!r) return;
    var k = r.dataset.k, S = series(k), q = idxAt(r, e), i = q.i, a = +r.dataset.a, b = +r.dataset.b, pl = +r.dataset.pl, pw = +r.dataset.pw, lo = +r.dataset.lo, hi = +r.dataset.hi, pt = +r.dataset.pt, ph = +r.dataset.ph;
    var x = pl + (b === a ? pw / 2 : (i - a) / (b - a) * pw), y = pt + (hi - S[i][4]) / (hi - lo) * ph, svgEl = r.ownerSVGElement;
    var L = svgEl.querySelector(".pxc-x"), D = svgEl.querySelector(".pxc-d"); L.setAttribute("x1", x); L.setAttribute("x2", x); L.setAttribute("visibility", "visible"); D.setAttribute("cx", x); D.setAttribute("cy", y); D.setAttribute("visibility", "visible");
    if (drag && drag.r === r) { var sel = svgEl.querySelector(".pxc-sel"), x0 = Math.min(drag.x, q.x), x1 = Math.max(drag.x, q.x); sel.setAttribute("x", x0); sel.setAttribute("width", Math.max(0, x1 - x0)); sel.setAttribute("visibility", "visible"); }
    var s = st(k), rows = '<b>' + esc(dlab(S[i][0], true)) + "</b><br>O " + f4(S[i][1]) + " · H " + f4(S[i][2]) + "<br>L " + f4(S[i][3]) + " · <b>C " + f4(S[i][4]) + "</b>";
    if (i > 0) { var d = S[i][4] - S[i - 1][4]; rows += '<br><span class="' + (d > 0 ? "up" : d < 0 ? "dn" : "") + '">' + (d > 0 ? "+" : d < 0 ? "−" : "") + (Math.abs(d) * 100).toFixed(2) + "¢ (" + (d / S[i - 1][4] * 100).toFixed(2) + "%)</span>"; }
    MAS.forEach(function (m) { if (s.ma[m[0]]) { var v = maOf(S, m[0])[i]; rows += "<br>MA" + m[0] + " " + f4(v); } });
    if (S[i][5]) rows += "<br>Vol " + S[i][5].toLocaleString("en-US");
    var tip = wrap.querySelector(".pxc-tip"), wb = wrap.getBoundingClientRect(), sb = svgEl.getBoundingClientRect(), px = (x / svgEl.viewBox.baseVal.width) * sb.width;
    tip.innerHTML = rows; tip.hidden = false; tip.style.left = Math.min(wb.width - 190, Math.max(0, px + 12)) + "px"; tip.style.top = "8px";
  });
  doc.addEventListener("pointerdown", function (e) { var r = e.target.closest && e.target.closest(".pxc-hit"); if (!r) return; var q = idxAt(r, e); drag = { r: r, i: q.i, x: q.x }; });
  doc.addEventListener("pointerup", function (e) {
    if (!drag) return; var r = drag.r, k = r.dataset.k, q = idxAt(r, e), a = Math.min(drag.i, q.i), b = Math.max(drag.i, q.i); drag = null;
    if (b - a >= 3) { st(k).z = [a, b]; save(); mount(k); } else { var sel = r.ownerSVGElement.querySelector(".pxc-sel"); if (sel) sel.setAttribute("visibility", "hidden"); }
  });
  doc.addEventListener("dblclick", function (e) { var r = e.target.closest && e.target.closest(".pxc-hit"); if (!r) return; st(r.dataset.k).z = null; save(); mount(r.dataset.k); });

  var css = doc.createElement("style");
  css.textContent = ".pxc-ctl{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}.pxc-seg{display:inline-flex}.pxc-b{font:600 12px 'IBM Plex Sans',sans-serif;padding:4px 10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer}" +
    ".pxc-seg .pxc-b:first-child{border-radius:6px 0 0 6px}.pxc-seg .pxc-b:last-child{border-radius:0 6px 6px 0}.pxc-seg .pxc-b+.pxc-b{margin-left:-1px}.pxc-ctl>.pxc-b{border-radius:6px}.pxc-b[aria-pressed=true]{background:rgba(56,182,201,.16);color:var(--ink);border-color:rgba(56,182,201,.6)}" +
    ".pxc-b i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}.pxc-sum{font-size:13px;color:var(--muted);margin-bottom:6px}.pxc-sum b{color:var(--ink)}" +
    ".pxc-wrap{position:relative;touch-action:pan-y}.pxc-hit{cursor:crosshair}.pxc-tip{position:absolute;min-width:170px;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font:12px/1.5 'IBM Plex Mono',monospace;color:var(--text);pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35)}" +
    ".pxc-tw{max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:8px}.pxc-t{width:100%;border-collapse:collapse;font:12.5px 'IBM Plex Mono',monospace}.pxc-t th{position:sticky;top:0;background:var(--panel);text-align:right;padding:6px 10px;font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}" +
    ".pxc-t th:first-child,.pxc-t td:first-child{text-align:left}.pxc-t td{padding:5px 10px;text-align:right;border-top:1px solid var(--line)}";
  doc.head.appendChild(css);
})(window);
