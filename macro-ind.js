/* All macro indicators — Cards / Charts views with an indicator picker and release marking.
   Replaces fxMacroHTML() from index.html. State (view, selection) is a per-viewer convenience in localStorage. */
(function () {
  if (typeof window.fxMacroHTML !== "function") return;
  var LS = { v: "desk.mview", s: "desk.msel" }, VIEW = "cards", SEL = null;
  try { VIEW = localStorage.getItem(LS.v) || "cards"; SEL = JSON.parse(localStorage.getItem(LS.s) || "null"); } catch (e) {}
  function save() { try { localStorage.setItem(LS.v, VIEW); localStorage.setItem(LS.s, JSON.stringify(SEL)); } catch (e) {} }
  var HR = 3600000, NAMEFIX = { us: "United States", ca: "Canada" };

  function list() {
    var seen = {};
    return macroAll().filter(function (m) { if (seen[m.key]) return false; seen[m.key] = 1; return !m.chart_only && (MGEO === "both" || m.group === MGEO); });
  }
  function on(m) { return !SEL || SEL.indexOf(m.key) >= 0; }
  function seenMs(m) { var t = m.seen_at ? Date.parse(m.seen_at) : NaN; return isNaN(t) ? null : t; }

  /* release marking: NEW (< 36 h), this week (< 7 d), due (next 36 h) */
  function mark(m) {
    var now = Date.now(), s = seenMs(m), n = nextRelease(m.key);
    var dET = function (t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); };
    if (s && dET(s) === dET(now)) return { k: "new", t: "NEW · released " + etLabel(s, true) + " ET" };   /* NEW = today's prints only */
    if (n && n.t && n.t - now < 36 * HR && n.t > now) return { k: "due", t: "DUE · " + etLabel(n.t, true) + " ET" };
    if (s && now - s < 7 * 24 * HR) return { k: "wk", t: "Released " + etLabel(s, true) + " ET" };
    return null;
  }
  function consTxt(m) {
    var c = m.cons; if (!c || c.forecast == null) return "";
    var at = Date.parse(c.at + ":00-05:00"), s = seenMs(m);
    if (s && s >= at - HR) { var d = m.value - c.forecast;
      return '<span class="mi-cons ' + (Math.abs(d) < 0.05 ? "" : d > 0 ? "beat" : "miss") + '">vs forecast ' + fmt(c.forecast, m.dec) + " (" + sgn(d, m.dec) + ")</span>"; }
    return '<span class="mi-cons">forecast ' + fmt(c.forecast, m.dec) + "</span>";
  }
  function badge(mk) { return mk ? '<span class="mi-b ' + mk.k + '">' + (mk.k === "new" ? "NEW" : mk.k === "due" ? "DUE" : "THIS WEEK") + "</span>" : ""; }

  /* ---------- picker ---------- */
  function picker(all) {
    function grp(g) {
      var rows = all.filter(function (m) { return m.group === g; });
      if (!rows.length) return "";
      return '<div class="mi-gh">' + flag(g, 13) + " " + NAMEFIX[g] + "</div>" + rows.map(function (m) {
        var mk = mark(m);
        return '<label class="mi-row' + (mk ? " " + mk.k : "") + '"><input type="checkbox" data-msel="' + esc(m.key) + '"' + (on(m) ? " checked" : "") + ">" +
          '<span class="mi-n">' + esc(m.name) + (m.measure ? " <i>" + esc(m.measure) + "</i>" : "") + "</span>" + badge(mk) +
          '<span class="mi-v">' + mval(m, m.value) + "</span></label>";
      }).join("");
    }
    return '<aside class="mi-pick"><div class="mi-pt">Indicators</div>' +
      '<div class="mi-qb"><button data-mq="all">All</button><button data-mq="none">None</button><button data-mq="new">Released / due</button></div>' +
      grp("us") + grp("ca") + "</aside>";
  }

  /* ---------- cards ---------- */
  function cardsView(sel) {
    function grp(g) {
      var r = sel.filter(function (m) { return m.group === g; }); if (!r.length) return "";
      return '<h3 class="m-h">' + NAMEFIX[g] + ' <span class="chip inline">' + (g === "us" ? "USD" : "CAD") + "</span> " + flag(g, 15) + '</h3><div class="m-grid">' +
        r.map(function (m) { var mk = mark(m), c = consTxt(m);
          return '<div class="mi-cw' + (mk ? " " + mk.k : "") + '">' + (mk || c ? '<div class="mi-fl">' + (mk ? esc(mk.t) : "") + (c ? (mk ? " · " : "") + c : "") + "</div>" : "") + macroCard(m) + "</div>";
        }).join("") + "</div>";
    }
    return grp("us") + grp("ca") + (MGEO === "both" ? '<h3 class="m-h">US − Canada differentials <span class="h2note">— what moves USD/CAD</span></h3><div class="m-grid">' + macroDiffs() + "</div>" : "");
  }

  /* ---------- charts ---------- */
  function chart(m, mk) {
    var H = (m.hist24 && m.hist24.length > 2 ? m.hist24 : m.history) || [], n = H.length;
    if (n < 2) return '<p class="note">History fills in on the next refresh.</p>';
    var v = H.map(function (h) { return h[1]; }), d = m.dec, bars = m.unit === "K" && m.measure === "m/m", pmi = /ism|ivey/.test(m.key);
    var W = 560, Ht = 230, PL = 44, PR = 14, PT = 22, PB = 30, pw = W - PL - PR, ph = Ht - PT - PB;
    var ext = v.concat(bars ? [0] : []).concat(pmi ? [50] : []).concat(m.cons && m.cons.forecast != null ? [m.cons.forecast] : []);
    var mn = Math.min.apply(null, ext), mx = Math.max.apply(null, ext), rg = (mx - mn) || 1; mn -= rg * 0.12; mx += rg * 0.16;
    function Y(x) { return PT + ph * (1 - (x - mn) / (mx - mn)); }
    var slot = pw / n; function X(i) { return PL + slot * i + slot / 2; }
    var s = "", u = m.unit === "K" ? "K" : m.unit || "";
    for (var k = 0; k <= 4; k++) { var yv = mn + (mx - mn) * k / 4, yy = Y(yv).toFixed(1);
      s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yy + '" y2="' + yy + '" stroke="#22324a" stroke-width="1"/><text x="' + (PL - 6) + '" y="' + (+yy + 3.5) + '" class="mi-ax" text-anchor="end">' + fmt(yv, bars || m.unit === "K" ? 0 : d) + "</text>"; }
    if (pmi) s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(50).toFixed(1) + '" y2="' + Y(50).toFixed(1) + '" stroke="#3fb97f" stroke-dasharray="5 4"/><text x="' + (W - PR) + '" y="' + (Y(50) - 4).toFixed(1) + '" class="mi-ax" fill="#3fb97f" text-anchor="end">50 = expansion / contraction</text>';
    var avg = v.reduce(function (a, b) { return a + b; }, 0) / n;
    s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(avg).toFixed(1) + '" y2="' + Y(avg).toFixed(1) + '" stroke="#8494ab" stroke-dasharray="2 4"/>';
    if (bars) s += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#3d5a80"/>';
    var path = "", hi = v.indexOf(Math.max.apply(null, v)), lo = v.indexOf(Math.min.apply(null, v));
    H.forEach(function (h, i) {
      var last = i === n - 1, x = X(i).toFixed(1), y = Y(h[1]).toFixed(1), tip = "<title>" + esc(h[0]) + ": " + fmt(h[1], d) + u + "</title>";
      if (bars) { var bw = slot * 0.6, top = Math.min(Y(h[1]), Y(0));
        s += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(Y(h[1]) - Y(0))).toFixed(1) + '" fill="' + (h[1] >= 0 ? "#3fb97f" : "#e0655f") + '" opacity="' + (last ? 1 : 0.6) + '">' + tip + "</rect>"; }
      else path += (path ? "L" : "M") + x + " " + y;
    });
    if (!bars) s += '<path d="' + path + '" fill="none" stroke="#6ea8ff" stroke-width="2" stroke-linejoin="round"/>';
    if (n >= 3) { var b = olsSlope(v), a = avg - b * (n - 1) / 2;
      s += '<line x1="' + X(0).toFixed(1) + '" y1="' + Y(a).toFixed(1) + '" x2="' + X(n - 1).toFixed(1) + '" y2="' + Y(a + b * (n - 1)).toFixed(1) + '" stroke="#b18cff" stroke-width="1.5" stroke-dasharray="6 4"/>'; }
    var step = Math.ceil(n / 8);
    H.forEach(function (h, i) {
      var last = i === n - 1, x = X(i), y = Y(h[1]), tip = "<title>" + esc(h[0]) + ": " + fmt(h[1], d) + u + "</title>";
      if (!bars) s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (last ? 4.5 : 2.6) + '" fill="' + (last ? (mk && mk.k === "new" ? "#ff5c5c" : "#e8a33d") : "#9fb4cf") + '">' + tip + "</circle>";
      if (n <= 12 || last || i === hi || i === lo) {
        var ly = bars && h[1] < 0 ? y + 13 : y - 8;
        s += '<text x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" class="mi-pv' + (last ? " l" : "") + '" text-anchor="middle">' + (bars && h[1] > 0 ? "+" : "") + fmt(h[1], d) + "</text>";
      }
      if (i % step === 0 || last) s += '<text x="' + x.toFixed(1) + '" y="' + (Ht - PB + 16) + '" class="mi-ax" text-anchor="middle">' + esc(h[0]) + "</text>";
    });
    if (mk && mk.k === "new") { var lx = X(n - 1);
      s += '<circle cx="' + lx.toFixed(1) + '" cy="' + Y(v[n - 1]).toFixed(1) + '" r="8" fill="none" stroke="#ff5c5c" stroke-width="1.6"><animate attributeName="r" values="6;10;6" dur="2s" repeatCount="indefinite"/></circle>' +
        '<text x="' + Math.min(lx, W - PR - 14).toFixed(1) + '" y="' + (PT - 7) + '" class="mi-new" text-anchor="middle">NEW</text>'; }
    if (m.cons && m.cons.forecast != null) { var cy = Y(m.cons.forecast).toFixed(1), cx = X(n - 1);
      s += '<line x1="' + (cx - slot * 0.45).toFixed(1) + '" x2="' + (cx + slot * 0.45).toFixed(1) + '" y1="' + cy + '" y2="' + cy + '" stroke="#e8a33d" stroke-width="2.2"/>'; }
    return '<svg viewBox="0 0 ' + W + " " + Ht + '" class="mi-svg" role="img" aria-label="' + esc(m.name) + " — last " + n + ' readings">' + s + "</svg>";
  }
  function readout(m) {
    var H = (m.hist24 && m.hist24.length > 2 ? m.hist24 : m.history) || [], v = H.map(function (h) { return h[1]; }), n = v.length; if (n < 3) return "";
    var d = m.dec, b = olsSlope(v.slice(-6)), avg = v.reduce(function (a, c) { return a + c; }, 0) / n, u = m.unit === "%" ? " pp" : m.unit === "K" ? "K" : "";
    var dir = Math.abs(b) < Math.pow(10, -d) ? "flat" : b > 0 ? "rising" : "falling";
    var pmi = /ism|ivey/.test(m.key) ? " · " + (m.value >= 50 ? "<b>expanding</b> (above 50)" : "<b>contracting</b> (below 50)") : "";
    return '<p class="mi-rd">6-reading trend <b>' + dir + "</b> · latest " + fmt(m.value, d) + " vs " + n + "-reading avg " + fmt(avg, d) + " (" + sgn(m.value - avg, d, u) + ") · range " + fmt(Math.min.apply(null, v), d) + "–" + fmt(Math.max.apply(null, v), d) + pmi + "</p>";
  }
  function chartsView(sel) {
    return '<div class="mi-cg">' + sel.map(function (m) {
      var mk = mark(m), ch = m.chg, flat = Math.abs(ch) < Math.pow(10, -m.dec) / 2;
      return '<div class="mi-ch' + (mk ? " " + mk.k : "") + '"><div class="mi-chh">' + cflag(m.group) + '<b class="mi-cn" data-mkey="' + esc(m.key) + '" role="button" tabindex="0">' + esc(m.name) + (m.measure ? " <i>" + esc(m.measure) + "</i>" : "") + "</b>" + badge(mk) +
        '<span class="mi-cv">' + mval(m, m.value) + ' <small class="' + (flat ? "" : cls(m.good === "down" ? -ch : ch)) + '">' + (flat ? "unch." : sgn(ch, m.dec)) + "</small></span></div>" +
        '<div class="mi-sub">' + esc(m.period) + " · " + ({ D: "daily", W: "weekly", M: "monthly", Q: "quarterly" }[m.freq] || "") + (mk ? " · " + esc(mk.t) : "") + (consTxt(m) ? " · " + consTxt(m) : "") + "</div>" +
        chart(m, mk) + readout(m) + nextReleaseHTML(m.key, true) + "</div>";
    }).join("") + "</div>" +
      '<div class="legend"><span><span class="sw" style="background:#6ea8ff"></span>reading</span><span><span class="sw" style="background:#b18cff"></span>trend</span><span><span class="sw" style="background:#8494ab"></span>average</span><span><span class="sw" style="background:#e8a33d"></span>latest / forecast tick</span><span><span class="sw" style="background:#ff5c5c"></span>new release</span></div>';
  }

  window.fxMacroHTML = function () {
    var all = list();
    if (!all.length) return '<div class="tile wide" data-src="macro"><h2>All macro indicators</h2><p class="note">US and Canada indicators load on the next data refresh.</p></div>';
    var sel = all.filter(on), nNew = all.filter(function (m) { var k = mark(m); return k && k.k === "new"; }).length;
    var errs = DATA.meta.macro_errors ? Object.keys(DATA.meta.macro_errors).length : 0;
    var seg = function (v, l) { return '<button data-mview="' + v + '" aria-pressed="' + (VIEW === v) + '">' + l + "</button>"; };
    return '<div class="tile wide mi-tile" data-src="macro"><h2>All macro indicators <span class="h2note">— pick indicators on the left · Cards for the latest print, Charts for trends and every data point</span></h2>' +
      '<div class="mi-bar"><div class="seg">' + seg("cards", "▦ Cards") + seg("charts", "📈 Charts") + "</div>" +
      '<span class="mi-cnt">' + sel.length + " of " + all.length + " shown" + (nNew ? ' · <b class="mi-b new">' + nNew + " NEW</b>" : "") + "</span>" +
      (VIEW === "cards" ? '<div class="m-legend"><span class="up">▲ stronger</span><span class="dn">▼ weaker</span><span class="heat">▲ inflation hotter</span><span class="cool">▼ inflation cooler</span></div>' : "") + "</div>" +
      '<div class="mi-wrap">' + picker(all) + '<div class="mi-main">' + (sel.length ? (VIEW === "charts" ? chartsView(sel) : cardsView(sel)) : '<p class="note">No indicators selected — tick some on the left.</p>') + "</div></div>" +
      '<div class="stamp">Official series (BLS, BEA, DOL, Census, UMich, ISM, Bank of Canada, Statistics Canada, Ivey) · checked ' + asOf("macro", true) + " · refreshed every 2h and minutes after each scheduled release" + (errs ? " · " + errs + " series kept at their last good reading" : "") + "</div></div>";
  };

  function repaint() {
    var t = document.querySelector(".mi-tile"); if (!t) return;
    var y = window.scrollY, w = document.createElement("div"); w.innerHTML = window.fxMacroHTML(); var n = w.firstChild; if (t.getAttribute("data-sec")) n.setAttribute("data-sec", t.getAttribute("data-sec")); t.replaceWith(n); window.scrollTo(0, y);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t || !t.closest(".mi-tile")) return;
    var b = t.closest("[data-mview]"); if (b) { VIEW = b.getAttribute("data-mview"); save(); repaint(); return; }
    var q = t.closest("[data-mq]"); if (q) { var a = list(), w = q.getAttribute("data-mq");
      SEL = w === "all" ? null : w === "none" ? [] : a.filter(function (m) { return mark(m); }).map(function (m) { return m.key; });
      save(); repaint(); }
  });
  document.addEventListener("change", function (ev) {
    var c = ev.target; if (!c.matches || !c.matches("input[data-msel]")) return;
    var a = list().map(function (m) { return m.key; }), cur = SEL ? SEL.slice() : a.slice(), k = c.getAttribute("data-msel");
    cur = c.checked ? cur.concat(cur.indexOf(k) < 0 ? [k] : []) : cur.filter(function (x) { return x !== k; });
    SEL = a.every(function (x) { return cur.indexOf(x) >= 0; }) ? null : cur; save(); repaint();
  });

  var css = document.createElement("style");
  css.textContent =
    ".mi-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:4px 0 12px}.mi-bar .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}" +
    ".mi-bar .seg button{background:transparent;border:0;color:var(--muted);padding:6px 14px;font:600 12.5px 'IBM Plex Sans',sans-serif;cursor:pointer}.mi-bar .seg button[aria-pressed=true]{background:#1d4ed8;color:#fff}" +
    ".mi-cnt{font:12px 'IBM Plex Mono',monospace;color:var(--faint)}.mi-bar .m-legend{margin:0}" +
    ".mi-wrap{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;align-items:start}" +
    ".mi-pick{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}" +
    ".mi-pt{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}" +
    ".mi-qb{display:flex;gap:6px;margin-bottom:8px}.mi-qb button{flex:1;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:4px 0;font-size:11.5px;cursor:pointer}.mi-qb button:hover{border-color:#38b6c9;color:var(--text)}" +
    ".mi-gh{font:700 11.5px 'IBM Plex Sans',sans-serif;color:var(--text);margin:10px 0 4px;display:flex;align-items:center;gap:6px}" +
    ".mi-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}.mi-row:hover{background:rgba(110,168,255,.08)}" +
    ".mi-row input{margin:0;accent-color:#3b82f6}.mi-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mi-n i,.mi-cn i{color:var(--faint);font-style:normal;font-weight:400}.mi-v{font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".mi-row.new{background:rgba(255,92,92,.10)}" +
    ".mi-b{font:700 9.5px 'IBM Plex Mono',monospace;letter-spacing:.05em;padding:1px 5px;border-radius:4px;white-space:nowrap}.mi-b.new{background:#ff5c5c;color:#fff}.mi-b.due{background:rgba(232,163,61,.18);color:#e8a33d;border:1px solid rgba(232,163,61,.5)}.mi-b.wk{background:rgba(56,182,201,.14);color:#38b6c9}" +
    ".mi-cw{display:flex;flex-direction:column;min-width:0}.mi-cw .mcard{flex:1}.mi-fl{font:600 10.5px 'IBM Plex Mono',monospace;padding:3px 8px;border-radius:7px 7px 0 0;margin-bottom:-1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);border:1px solid var(--line);border-bottom:0;background:var(--panel2)}" +
    ".mi-cw.new .mi-fl{background:#ff5c5c;color:#fff;border-color:#ff5c5c}.mi-cw.new .mcard{border-color:#ff5c5c;box-shadow:0 0 0 1px rgba(255,92,92,.35)}.mi-cw.due .mi-fl{color:#e8a33d;border-color:rgba(232,163,61,.5)}.mi-cw.due .mcard{border-color:rgba(232,163,61,.5)}.mi-cw.wk .mi-fl{color:#38b6c9}" +
    ".mi-cw.new .mi-cons{color:#fff}.mi-cw .mcard{border-top-left-radius:0;border-top-right-radius:0}.mi-cw:not(.new):not(.due):not(.wk) .mi-fl+.mcard{}" +
    ".mi-cons.beat{color:#3fb97f}.mi-cons.miss{color:#e0655f}" +
    ".mi-cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:14px}" +
    ".mi-ch{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px 8px;min-width:0}.mi-ch.new{border-color:#ff5c5c;box-shadow:0 0 0 1px rgba(255,92,92,.3)}.mi-ch.due{border-color:rgba(232,163,61,.5)}" +
    ".mi-chh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mi-cn{cursor:pointer;font-size:14px}.mi-cn:hover{color:#38b6c9}.mi-cv{margin-left:auto;font:600 17px 'IBM Plex Mono',monospace}.mi-cv small{font-size:11.5px;margin-left:4px}" +
    ".mi-sub{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin:2px 0 4px}.mi-svg{display:block;width:100%;height:auto}" +
    ".mi-ax{font:10px 'IBM Plex Mono',monospace;fill:#8494ab}.mi-pv{font:600 10.5px 'IBM Plex Mono',monospace;fill:#b9c7da}.mi-pv.l{fill:#e8a33d;font-size:11.5px}.mi-new{font:700 10px 'IBM Plex Mono',monospace;fill:#ff5c5c}" +
    ".mi-rd{font-size:12.5px;color:var(--muted);margin:4px 0}" +
    "@media (max-width:900px){.mi-wrap{grid-template-columns:1fr}.mi-pick{position:static;max-height:none}.mi-cg{grid-template-columns:1fr}}";
  document.head.appendChild(css);
  try { if (window.DATA && typeof renderFX === "function" && document.getElementById("panel-fx")) renderFX(); } catch (e) {}
})();
