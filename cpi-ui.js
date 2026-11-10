/* US CPI internals — category breakdown of the latest CPI (BLS CPI-U items, DATA.cpi_detail from scripts/cpi_detail.py).
   Diverging bars around zero: warm = prices rose, cool = fell (same heat/cool tokens as the macro dashboard).
   Two reads: 1-month (seasonally adjusted) or 12-month (not adjusted), each as BLS publishes; two layouts: biggest movers or by group.
   BLS figures only, no desk interpretation added. Lives on Macro → Dashboard. Hidden when the data is absent (BRD amendment 1). */
(function (root) {
  var V = { m: "mm", v: "movers" };
  try { var s = JSON.parse(localStorage.getItem("desk.cpi") || "{}"); if (s.m) V.m = s.m; if (s.v) V.v = s.v; } catch (e) {}
  var GRP = [["agg", "Headline & core"], ["food", "Food"], ["energy", "Energy"], ["goods", "Core goods"], ["services", "Core services"]];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mon(ym) { var a = (ym || "").split("-"); return a.length > 1 ? MON[+a[1] - 1] + " " + a[0] : ym; }
  function last(a) { return a && a.length ? a[a.length - 1] : null; }
  function prev(a) { return a && a.length > 1 ? a[a.length - 2] : null; }
  function sg(v, d) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.round(Math.abs(v) * 10) / 10).toFixed(d) + "%"; }

  function row(it, max, d) {
    var a = it[V.m], v = last(a), p = prev(a);
    if (v == null) return "";
    var over = max && Math.abs(v) > max, w = max ? Math.min(50, Math.abs(v) / max * 50) : 0, cls = v > 0 ? "heat" : v < 0 ? "cool" : "";
    var tip = it.n + ": " + sg(v, d) + (V.m === "mm" ? " in the month" : " over 12 months") + (p != null ? " (prior " + sg(p, d) + ")" : "");
    return '<div class="cpi-r' + (it.g === "agg" ? " agg" : "") + '" data-cpic="' + esc(it.c) + '" role="button" tabindex="0" title="' + esc(tip + " · click for its history") + '">' +
      '<span class="cpi-n">' + esc(it.n) + "</span>" +
      '<span class="cpi-bw"><span class="cpi-z"></span><span class="cpi-b ' + cls + '" style="' + (v >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(2) + '%"></span>' + (over ? '<span class="cpi-ov" style="' + (v >= 0 ? "right:0" : "left:0") + '" title="Beyond the scale">' + (v >= 0 ? "››" : "‹‹") + "</span>" : "") + "</span>" +
      '<span class="cpi-v">' + sg(v, d) + "</span>" +
      '<span class="cpi-p">' + (p != null ? sg(p, d) : "") + "</span></div>";
  }

  function scale(L) { var a = L.map(function (i) { return Math.abs(last(i[V.m])); }).sort(function (x, y) { return x - y; }); if (!a.length) return 0.1;
    var p = a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]; return Math.max(0.1, a[a.length - 1] <= p * 1.6 ? a[a.length - 1] : p * 1.25); }
  function body(C) {
    var d = V.m === "mm" ? 1 : 1, I = C.items.filter(function (i) { return last(i[V.m]) != null; });
    var L, html = "";
    if (V.v === "movers") {
      L = I.filter(function (i) { return i.g !== "agg"; }).sort(function (a, b) { return Math.abs(last(b[V.m])) - Math.abs(last(a[V.m])); }).slice(0, 20);
      var all = I.filter(function (i) { return i.c === "SA0"; });
      L = all.concat(L);
      var mx = scale(L);
      html = L.map(function (i) { return row(i, mx, d); }).join("");
    } else {
      var mx2 = scale(I);
      GRP.forEach(function (g) {
        var G = I.filter(function (i) { return i.g === g[0]; });
        if (g[0] !== "agg") G.sort(function (a, b) { return last(b[V.m]) - last(a[V.m]); });
        if (G.length) html += '<div class="cpi-gh">' + g[1] + "</div>" + G.map(function (i) { return row(i, mx2, d); }).join("");
      });
    }
    return '<div class="cpi-hd"><span>Category</span><span class="cpi-axis"><span>fell</span><span>0</span><span>rose</span></span><span>' + mon(C.month) + '</span><span>Prior</span></div>' + html;
  }

  function cpiInternalsHTML() {
    var C = root.DATA && DATA.cpi_detail;
    if (!C || !C.items || !C.items.length) return "";
    var f = function (c) { for (var i = 0; i < C.items.length; i++) if (C.items[i].c === c) return C.items[i]; return null; };
    var A = f("SA0"), K = f("SA0L1E");
    var lead = (A ? "All items <b>" + sg(last(A.mm), 1) + "</b> m/m, <b>" + sg(last(A.yy), 1) + "</b> y/y" : "") + (K ? " · core <b>" + sg(last(K.mm), 1) + "</b> m/m, <b>" + sg(last(K.yy), 1) + "</b> y/y" : "");
    var btn = function (k, val, t) { return '<button class="cpi-tg' + (V[k] === val ? " on" : "") + '" data-cpi="' + k + ":" + val + '" aria-pressed="' + (V[k] === val) + '">' + t + "</button>"; };
    return '<div class="tile wide" id="cpi-internals" data-cpi-tile><h2>US CPI internals — ' + mon(C.month) + ' by category</h2>' +
      '<p class="cpi-lead">' + lead + "</p>" +
      '<div class="cpi-ctl"><span class="cpi-seg" role="group" aria-label="Change measured">' + btn("m", "mm", "1-month") + btn("m", "yy", "12-month") + "</span>" +
      '<span class="cpi-seg" role="group" aria-label="Layout">' + btn("v", "movers", "Biggest movers") + btn("v", "groups", "By group") + "</span></div>" +
      '<div class="cpi-body">' + body(C) + "</div>" +
      '<p class="note">Source: <a href="' + esc(C.src || "https://www.bls.gov/cpi/") + '" target="_blank" rel="noopener">BLS CPI-U</a>. 1-month changes are seasonally adjusted; 12-month changes are not, as BLS reports them. ' +
      "Bars marked \u203a\u203a run past the scale; the figure is exact. " + (V.v === "movers" ? "Biggest movers: the 20 categories with the largest change either way, after All items. " : "") + "Fetched " +
      new Date(C.asof).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET.</p></div>";
  }
  root.cpiInternalsHTML = cpiInternalsHTML;

  /* click a category: the desk's detail pop-up with its history as chart or table, in the measure the card is showing */
  function item(c) { var C = root.DATA && DATA.cpi_detail; if (!C) return null; for (var i = 0; i < C.items.length; i++) if (C.items[i].c === c) return C.items[i]; return null; }
  function cpiAsMacro(c) {
    var it = item(c); if (!it) return null;
    var a = it[V.m], months = it.m || [], n = a.length, lab = months.slice(-n);
    var H = a.map(function (v, i) { return [lab[i] || "", v]; });
    return { key: "cpi:" + c, name: it.n, group: "us", unit: "%", dec: 1, measure: V.m === "mm" ? "m/m" : "y/y", good: "down", value: a[n - 1], prior: a[n - 2],
      history: H, hist24: H, src: "BLS CPI-U (" + (V.m === "mm" ? "seasonally adjusted" : "not seasonally adjusted") + ")" };
  }
  root.cpiAsMacro = cpiAsMacro;
  function openCpi(c) {
    var m = cpiAsMacro(c); if (!m || !root.mdHistHTML) return;
    var o = document.getElementById("mdc-overlay");
    if (!o) { o = document.createElement("div"); o.id = "mdc-overlay"; o.innerHTML = '<div class="mdc-wrap" role="dialog" aria-modal="true"><button class="mdc-x" aria-label="Close">×</button><div class="mdc-body"></div></div>'; document.body.appendChild(o); }
    o.querySelector(".mdc-body").innerHTML = '<div class="mdc"><div class="mdc-top"><div class="mdc-ttl">US CPI · ' + esc(m.name.toUpperCase()) + "</div><div class=\"mdc-sub\">" + (V.m === "mm" ? "1-month change, seasonally adjusted" : "12-month change, not seasonally adjusted") + "</div></div>" +
      '<div class="mdc-main"><div class="mdc-k">' + esc(m.name) + " — " + esc(mon(lastM(c))) + '</div><div class="mdc-v">' + sg(m.value, 1) + " <small>" + m.measure + '</small></div><div class="mdc-l">Prior: ' + sg(m.prior, 1) + "</div></div>" +
      '<div class="mdh-wrap">' + mdHistHTML(m) + "</div></div>";
    o.classList.add("on"); o.setAttribute("data-key", m.key); o.querySelector(".mdc-wrap").scrollTop = 0;
  }
  function lastM(c) { var it = item(c), M = it && it.m; return M && M.length ? M[M.length - 1] : ""; }

  document.addEventListener("click", function (ev) {
    var r = ev.target.closest && ev.target.closest("[data-cpic]"); if (r) { openCpi(r.getAttribute("data-cpic")); return; }
    var b = ev.target.closest && ev.target.closest("[data-cpi]"); if (!b) return;
    var kv = b.getAttribute("data-cpi").split(":"); V[kv[0]] = kv[1];
    try { localStorage.setItem("desk.cpi", JSON.stringify(V)); } catch (e) {}
    var T = document.getElementById("cpi-internals"); if (!T) return;
    var d = document.createElement("div"); d.innerHTML = cpiInternalsHTML(); if (d.firstChild) T.replaceWith(d.firstChild);
  });

  var css = document.createElement("style");
  css.textContent =
    "#cpi-internals .cpi-lead{margin:2px 0 10px;color:var(--muted);font-size:13px}#cpi-internals .cpi-lead b{color:var(--ink);font-family:'IBM Plex Mono',monospace}" +
    ".cpi-tg{font:600 12px 'IBM Plex Sans',sans-serif;padding:5px 10px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer}.cpi-seg .cpi-tg:first-child{border-radius:6px 0 0 6px}.cpi-seg .cpi-tg:last-child{border-radius:0 6px 6px 0;margin-left:-1px}.cpi-tg.on{background:rgba(232,185,61,.14);color:var(--ink);border-color:rgba(232,185,61,.6)}" +
    ".cpi-ctl{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}.cpi-seg{display:inline-flex}" +
    ".cpi-hd,.cpi-r{display:grid;grid-template-columns:minmax(150px,240px) minmax(120px,1fr) 64px 56px;gap:10px;align-items:center}" +
    ".cpi-hd{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);padding:0 4px 6px;border-bottom:1px solid var(--line)}" +
    ".cpi-hd span:nth-child(n+3){text-align:right}.cpi-axis{display:flex;justify-content:space-between}" +
    ".cpi-r{padding:3px 4px;min-height:24px;border-radius:4px;cursor:pointer}.cpi-r:hover{background:rgba(110,168,255,.07)}.cpi-r.agg .cpi-n{font-weight:700;color:var(--ink)}" +
    ".cpi-n{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".cpi-bw{position:relative;height:12px}.cpi-z{position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:var(--line2)}" +
    ".cpi-b{position:absolute;top:0;height:12px;min-width:2px}.cpi-b.heat{background:#e8a33d;border-radius:0 4px 4px 0}.cpi-b.cool{background:#6ea8ff;border-radius:4px 0 0 4px}" +
    ".cpi-v{font-family:'IBM Plex Mono',monospace;font-size:12.5px;text-align:right;color:var(--ink)}.cpi-p{font-family:'IBM Plex Mono',monospace;font-size:11.5px;text-align:right;color:var(--faint)}" +
    ".cpi-gh{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 4px 2px}" +
    ".cpi-ov{position:absolute;top:-2px;font:700 11px 'IBM Plex Mono',monospace;color:var(--ink)}" +
    "@media (max-width:640px){.cpi-hd,.cpi-r{grid-template-columns:minmax(110px,1.2fr) 1fr 58px}.cpi-p,.cpi-hd span:last-child{display:none}}";
  document.head.appendChild(css);
})(window);
