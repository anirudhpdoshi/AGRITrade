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
  /* indicators added to the desk later start ticked even when the viewer has a saved selection */
  (function () { try { var seen = JSON.parse(localStorage.getItem("desk.mseen") || "null"), all = macroAll().map(function (m) { return m.key; });
    if (SEL && seen) all.forEach(function (k) { if (seen.indexOf(k) < 0 && SEL.indexOf(k) < 0) SEL.push(k); });
    localStorage.setItem("desk.mseen", JSON.stringify(all)); save(); } catch (e) {} })();
  function on(m) { return !SEL || SEL.indexOf(m.key) >= 0; }
  function seenMs(m) { var t = m.seen_at ? Date.parse(m.seen_at) : NaN; return isNaN(t) ? null : t; }

  /* release marking: NEW (< 36 h), this week (< 7 d), due (next 36 h) */
  function mark(m) {
    var now = Date.now(), s = seenMs(m), n = nextRelease(m.key);
    var dET = function (t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); };
    if (s && dET(s) === dET(now)) return { k: "new", t: "RELEASED TODAY · " + etLabel(s, true) + " ET" };   /* NEW = today's prints only */
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
  function badge(mk) { return mk ? '<span class="mi-b ' + mk.k + '">' + (mk.k === "new" ? "TODAY" : mk.k === "due" ? "DUE" : "THIS WEEK") + "</span>" : ""; }

  /* ---------- categories (owner story: category navigation, no checkboxes) ---------- */
  var CATS = [
    ["growth", "Growth", ["us_gdp", "ca_gdp"]],
    ["inflation", "Inflation", ["us_cpi", "us_core_cpi", "us_pce", "us_core_pce", "us_ppi", "us_import", "ca_cpi", "ca_trim", "ca_median", "ca_ippi"]],
    ["employment", "Employment", ["us_nfp", "us_ur", "us_claims", "us_cclaims", "us_ahe", "us_jolts", "us_adp", "ca_emp", "ca_ur", "ca_vac"]],
    ["consumer", "Consumer", ["us_retail", "us_pspend", "us_pinc", "us_umich"]],
    ["manufacturing", "Manufacturing", ["us_ism", "us_ism_svc", "us_indpro", "us_factory", "us_durable", "ca_ivey", "ca_mfg", "ca_whl"]],
    ["housing", "Housing", ["us_starts", "us_permits", "us_nhs", "ca_starts", "ca_permits"]],
    ["credit", "Credit", []], ["commodities", "Commodities", []], ["geopolitics", "Geopolitics", []],
    ["fincond", "Financial Conditions", ["us_policy", "ca_policy"]]];   /* categories with no series on the desk stay hidden (hide-not-UNAVAILABLE) */
  var CV = {}, OPEN = {}, PER = "2Y";
  try { CV = JSON.parse(localStorage.getItem("desk.mcv") || "{}"); OPEN = JSON.parse(localStorage.getItem("desk.mopen") || "{}"); PER = localStorage.getItem("desk.mper") || "2Y"; if (!/^(table|chart|both)$/.test(VIEW)) VIEW = "both"; } catch (e) {}
  function save2() { try { localStorage.setItem("desk.mcv", JSON.stringify(CV)); localStorage.setItem("desk.mopen", JSON.stringify(OPEN)); localStorage.setItem("desk.mper", PER); } catch (e) {} }
  function pool() { var seen = {}; return macroAll().filter(function (m) { if (seen[m.key]) return false; seen[m.key] = 1; return MGEO === "both" || m.group === MGEO; }); }
  function cats() { var P = pool(), by = {}; P.forEach(function (m) { by[m.key] = m; });
    return CATS.map(function (c) { return { id: c[0], name: c[1], items: c[2].map(function (k) { return by[k]; }).filter(Boolean) }; }).filter(function (c) { return c.items.length; }); }
  /* signal: +1 stronger / hotter, −1 weaker / cooler, 0 unchanged */
  function sig(m) { var c = m.value - m.prior; if (m.prior == null || Math.abs(c) < Math.pow(10, -m.dec) / 2) return 0; return (m.good === "down" ? -1 : 1) * (c > 0 ? 1 : -1); }
  function strength(c) { var v = c.items.map(sig), n = v.length, sc = v.reduce(function (a, b) { return a + b; }, 0) / (n || 1), up = v.filter(function (x) { return x > 0; }).length, dn = v.filter(function (x) { return x < 0; }).length;
    var heat = c.id === "inflation" || c.id === "fincond", lab = sc >= 0.34 ? (heat ? (c.id === "fincond" ? "Tightening" : "Heating") : "Strengthening") : sc <= -0.34 ? (heat ? (c.id === "fincond" ? "Easing" : "Cooling") : "Weakening") : "Mixed";
    return { lab: lab, k: sc >= 0.34 ? (heat ? "heat" : "up") : sc <= -0.34 ? (heat ? "cool" : "dn") : "neu", tip: up + " of " + n + " " + (heat ? "rising" : "improving") + ", " + dn + " " + (heat ? "falling" : "weakening") + " on the latest print" }; }
  function isOn(m) { return !SEL || SEL.indexOf(m.key) >= 0; }
  function rail(C) {
    return '<aside class="mi-rail"><div class="mi-pt">Categories</div>' + C.map(function (c) { var st = strength(c), on = c.items.filter(isOn).length, op = !!OPEN[c.id];
      return '<div class="mc-cat' + (op ? " open" : "") + '"><button class="mc-h" data-mcat="' + c.id + '" aria-expanded="' + op + '"><span class="mc-n">' + esc(c.name) + '</span><span class="mc-s ' + st.k + '" title="' + esc(st.tip) + '">' + st.lab + '</span><span class="mc-c">' + on + "/" + c.items.length + '</span><span class="mc-ch">' + (op ? "▾" : "▸") + "</span></button>" +
        (op ? '<div class="mc-body"><div class="mc-qa"><button data-mcall="' + c.id + '">Select all</button><button data-mcnone="' + c.id + '">Clear</button></div>' + c.items.map(function (m) { var mk = mark(m), s = sig(m);
          return '<button class="mc-i' + (isOn(m) ? " on" : "") + (mk ? " " + mk.k : "") + '" data-mtog="' + esc(m.key) + '" aria-pressed="' + isOn(m) + '">' + flag(m.group, 13) + '<span class="mc-in">' + esc(m.name) + (m.measure ? " <i>" + esc(m.measure) + "</i>" : "") + "</span>" + badge(mk) + '<span class="mc-iv ' + (s > 0 ? (c.id === "inflation" ? "heat" : "up") : s < 0 ? (c.id === "inflation" ? "cool" : "dn") : "") + '">' + mval(m, m.value) + "</span></button>"; }).join("") + "</div>" : "") + "</div>"; }).join("") + "</aside>";
  }
  /* history for the selected period: points per year by frequency; 5Y uses the long series where the desk holds it */
  var PPY = { M: 12, Q: 4, W: 52, D: 12 };
  function lab(iso) { var p = String(iso).split("-"); return p.length === 3 ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+p[1] - 1] + " '" + p[0].slice(2) : iso; }
  function hist(m) { var yrs = { "1Y": 1, "2Y": 2, "5Y": 5 }[PER] || 2, n = (PPY[m.freq] || 12) * yrs, H = (m.hist24 && m.hist24.length > 2 ? m.hist24 : m.history) || [];
    if ((n > H.length || m.freq === "D") && m.long && m.long.length > H.length) { var L = m.long.map(function (r) { return [lab(r[0]), r[1]]; }); if (m.freq === "D") { var mo = {}; L.forEach(function (r) { mo[r[0]] = r; }); L = Object.keys(mo).map(function (k) { return mo[k]; }); } H = L; }
    return H.slice(-n); }
  function surprise(m) { var c = m.cons; if (!c || c.forecast == null) return null; var at = Date.parse(c.at + ":00-05:00"), s = seenMs(m); if (!(s && s >= at - HR)) return { fc: c.forecast, d: null }; return { fc: c.forecast, d: m.value - c.forecast }; }
  function tableView(L, cid) {
    var hasC = L.some(function (m) { return m.cons && m.cons.forecast != null; }), heat = cid === "inflation";
    return '<div class="tbl-scroll"><table class="mi-tbl"><thead><tr><th>Indicator</th><th>Period</th><th>Actual (latest)</th><th>Previous</th><th>Change</th>' + (hasC ? "<th>Consensus</th><th>Surprise</th>" : "") + "<th>History (oldest → latest)</th></tr></thead><tbody>" +
      L.map(function (m) { var mk = mark(m), ch = m.value - m.prior, s = sig(m), S = surprise(m), H = hist(m).slice(-6), cl = s > 0 ? (heat ? "heat" : "up") : s < 0 ? (heat ? "cool" : "dn") : "neu";
        var sp = S && S.d != null ? (Math.abs(S.d) < Math.pow(10, -m.dec) / 2 ? '<td class="neu">in line</td>' : '<td class="' + ((m.good === "down" ? -S.d : S.d) > 0 ? (heat ? "heat" : "up") : (heat ? "cool" : "dn")) + '">' + (S.d > 0 ? "beat " : "miss ") + sgn(S.d, m.dec) + "</td>") : "<td>—</td>";
        return '<tr class="mi-tr' + (mk && mk.k === "new" ? " rel-today" : "") + '" data-mkey="' + esc(m.key) + '"><td>' + (mk && mk.k === "new" ? '<span class="rt-pill">RELEASED TODAY</span> ' : "") + flag(m.group, 13) + " " + esc(m.name) + (m.measure ? " <i>" + esc(m.measure) + "</i>" : "") + "</td><td>" + esc(m.period) + '</td><td class="mi-num">' + mval(m, m.value) + '</td><td class="mi-num">' + (m.prior == null ? "—" : mval(m, m.prior)) + '</td><td class="mi-num ' + cl + '">' + (m.prior == null ? "—" : s === 0 ? "unch." : sgn(ch, m.dec)) + "</td>" +
          (hasC ? '<td class="mi-num">' + (S ? fmt(S.fc, m.dec) : "—") + "</td>" + sp.replace("<td", '<td class="mi-num"').replace('class="mi-num" class="', 'class="mi-num ') : "") + '<td class="mi-hist">' + H.map(function (h) { return '<span title="' + esc(h[0]) + '">' + fmt(h[1], m.dec) + "</span>"; }).join("") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function viewSeg(v, attr) { var b = function (x, l) { return '<button ' + attr + ' data-v="' + x + '" aria-pressed="' + (v === x) + '">' + l + "</button>"; }; return '<div class="seg mi-vs">' + b("table", "Table") + b("chart", "Chart") + b("both", "Both") + "</div>"; }
  function workspace(C) {
    var any = 0, h = C.map(function (c) { var L = c.items.filter(isOn); if (!L.length) return ""; any = 1; var v = CV[c.id] || VIEW, st = strength(c);
      return '<section class="mc-ws"><div class="mc-wh"><h3>' + esc(c.name) + ' <span class="mc-s ' + st.k + '" title="' + esc(st.tip) + '">' + st.lab + '</span> <small>' + L.length + " selected</small></h3>" + viewSeg(v, 'data-mcv="' + c.id + '"') + "</div>" +
        (v !== "chart" ? tableView(L, c.id) : "") + (v !== "table" ? chartsView(L) : "") + "</section>"; }).join("");
    return any ? h : '<p class="note">Nothing selected — open a category on the left and pick its indicators.</p>';
  }

  /* ---------- charts ---------- */
  function chart(m, mk) {
    var H = hist(m), n = H.length;
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
      if (!bars) s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (last ? 4.5 : 2.6) + '" fill="' + (last ? (mk && mk.k === "new" ? "#E8C33A" : "#e8a33d") : "#9fb4cf") + '">' + tip + "</circle>";
      if (n <= 12 || last || i === hi || i === lo) {
        var ly = bars && h[1] < 0 ? y + 13 : y - 8;
        s += '<text x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" class="mi-pv' + (last ? " l" : "") + '" text-anchor="middle">' + (bars && h[1] > 0 ? "+" : "") + fmt(h[1], d) + "</text>";
      }
      if (i % step === 0 || last) s += '<text x="' + x.toFixed(1) + '" y="' + (Ht - PB + 16) + '" class="mi-ax" text-anchor="middle">' + esc(h[0]) + "</text>";
    });
    if (mk && mk.k === "new") { var lx = X(n - 1);
      s += '<circle cx="' + lx.toFixed(1) + '" cy="' + Y(v[n - 1]).toFixed(1) + '" r="8" fill="none" stroke="#ff5c5c" stroke-width="1.6"><animate attributeName="r" values="6;10;6" dur="2s" repeatCount="indefinite"/></circle>' +
        '<text x="' + Math.min(lx, W - PR - 14).toFixed(1) + '" y="' + (PT - 7) + '" class="mi-new" text-anchor="middle">TODAY</text>'; }
    if (m.cons && m.cons.forecast != null) { var cy = Y(m.cons.forecast).toFixed(1), cx = X(n - 1);
      s += '<line x1="' + (cx - slot * 0.45).toFixed(1) + '" x2="' + (cx + slot * 0.45).toFixed(1) + '" y1="' + cy + '" y2="' + cy + '" stroke="#e8a33d" stroke-width="2.2"/>'; }
    return '<svg viewBox="0 0 ' + W + " " + Ht + '" class="mi-svg" role="img" aria-label="' + esc(m.name) + " — last " + n + ' readings">' + s + "</svg>";
  }
  function readout(m) {
    var H = hist(m), v = H.map(function (h) { return h[1]; }), n = v.length; if (n < 3) return "";
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
    var C = cats();
    if (!C.length) return '<div class="tile wide" data-src="macro"><h2>All macro indicators</h2><p class="note">US and Canada indicators load on the next data refresh.</p></div>';
    if (!Object.keys(OPEN).length) OPEN[C[0].id] = 1;
    var all = [].concat.apply([], C.map(function (c) { return c.items; })), sel = all.filter(isOn), nNew = all.filter(function (m) { var k = mark(m); return k && k.k === "new"; }).length;
    var errs = DATA.meta.macro_errors ? Object.keys(DATA.meta.macro_errors).length : 0, P = function (x) { return '<button data-mper="' + x + '" aria-pressed="' + (PER === x) + '">' + x + "</button>"; };
    return '<div class="tile wide mi-tile" data-src="macro"><h2>All macro indicators <span class="h2note">— by category · pick indicators on the left · Table, Chart or Both</span></h2>' +
      '<div class="mi-bar"><span class="mi-dl">Display selected data</span>' + viewSeg(VIEW, "data-mview") + '<span class="mi-dl">Chart period</span><div class="seg mi-vs">' + P("1Y") + P("2Y") + P("5Y") + "</div>" +
      '<span class="mi-cnt">Selected view: ' + VIEW[0].toUpperCase() + VIEW.slice(1) + " · " + sel.length + " of " + all.length + " indicators" + (nNew ? ' · <b class="mi-b new">' + nNew + " TODAY</b>" : "") + "</span>" +
      '<div class="m-legend"><span class="up">▲ stronger</span><span class="dn">▼ weaker</span><span class="heat">▲ inflation hotter</span><span class="cool">▼ inflation cooler</span></div></div>' +
      '<div class="mi-wrap">' + rail(C) + '<div class="mi-main">' + workspace(C) + "</div></div>" +
      '<div class="stamp">Verified ' + asOf("macro", true) + " · refreshed every 2h and minutes after each scheduled release" + (errs ? " · " + errs + " series kept at their last good reading" : "") + "</div></div>";
  };

  function repaint() {
    var t = document.querySelector(".mi-tile"); if (!t) return;
    var y = window.scrollY, w = document.createElement("div"); w.innerHTML = window.fxMacroHTML(); var n = w.firstChild; if (t.getAttribute("data-sec")) n.setAttribute("data-sec", t.getAttribute("data-sec")); t.replaceWith(n); window.scrollTo(0, y);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t || !t.closest(".mi-tile")) return;
    var g = function (a) { var e = t.closest("[" + a + "]"); return e && e.getAttribute(a); }, keys = function (cid) { var c = cats().filter(function (x) { return x.id === cid; })[0]; return c ? c.items.map(function (m) { return m.key; }) : []; };
    var all = function () { return pool().map(function (m) { return m.key; }); }, cur = function () { return SEL ? SEL.slice() : all(); }, set = function (L) { SEL = all().every(function (k) { return L.indexOf(k) >= 0; }) ? null : L; save(); };
    var v;
    if ((v = t.closest("[data-mview]"))) { VIEW = v.getAttribute("data-v"); CV = {}; save(); save2(); }   /* global selector applies to every category */
    else if ((v = t.closest("[data-mcv]"))) { CV[v.getAttribute("data-mcv")] = v.getAttribute("data-v"); save2(); }
    else if ((v = g("data-mper"))) { PER = v; save2(); }
    else if ((v = g("data-mcat"))) { if (OPEN[v]) delete OPEN[v]; else OPEN[v] = 1; save2(); }
    else if ((v = g("data-mtog"))) { var L = cur(); set(L.indexOf(v) >= 0 ? L.filter(function (k) { return k !== v; }) : L.concat([v])); }
    else if ((v = g("data-mcall"))) { var A = cur(); keys(v).forEach(function (k) { if (A.indexOf(k) < 0) A.push(k); }); set(A); }
    else if ((v = g("data-mcnone"))) { var K = keys(v); set(cur().filter(function (k) { return K.indexOf(k) < 0; })); }
    else return;
    repaint();
  });

  var css = document.createElement("style");
  css.textContent =
    ".mi-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:4px 0 12px}.mi-bar .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}" +
    ".mi-bar .seg button{background:transparent;border:0;color:var(--muted);padding:6px 14px;font:600 12.5px 'IBM Plex Sans',sans-serif;cursor:pointer}.mi-bar .seg button[aria-pressed=true]{background:#1d4ed8;color:#fff}" +
    ".mi-cnt{font:12px 'IBM Plex Mono',monospace;color:var(--faint)}.mi-bar .m-legend{margin:0}" +
    ".mi-wrap{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start}" +
    ".mi-pick{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}" +
    ".mi-pt{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}" +
    ".mi-qb{display:flex;gap:6px;margin-bottom:8px}.mi-qb button{flex:1;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:4px 0;font-size:11.5px;cursor:pointer}.mi-qb button:hover{border-color:#38b6c9;color:var(--text)}" +
    ".mi-gh{font:700 11.5px 'IBM Plex Sans',sans-serif;color:var(--text);margin:10px 0 4px;display:flex;align-items:center;gap:6px}" +
    ".mi-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto auto;gap:6px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}.mi-row:hover{background:rgba(110,168,255,.08)}" +
    ".mi-row input{margin:0;accent-color:#3b82f6}.mi-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mi-n i,.mi-cn i{color:var(--faint);font-style:normal;font-weight:400}.mi-v{font:11.5px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".mi-row.new{background:#1E40AF;color:#fff}" +
    ".mi-b{font:700 9.5px 'IBM Plex Mono',monospace;letter-spacing:.05em;padding:1px 5px;border-radius:4px;white-space:nowrap}.mi-b.new{background:#10283F;color:#E8C33A}.mi-b.due{background:rgba(232,163,61,.18);color:#e8a33d;border:1px solid rgba(232,163,61,.5)}.mi-b.wk{background:rgba(56,182,201,.14);color:#38b6c9}" +
    ".mi-cw{display:flex;flex-direction:column;min-width:0}.mi-cw .mcard{flex:1}.mi-fl{font:600 10.5px 'IBM Plex Mono',monospace;padding:3px 8px;border-radius:7px 7px 0 0;margin-bottom:-1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);border:1px solid var(--line);border-bottom:0;background:var(--panel2)}" +
    ".mi-cw.new .mi-fl{background:#10283F;color:#E8C33A;border-color:#1E40AF}.mi-cw.new .mcard{border-color:#1E40AF;box-shadow:0 0 0 1px rgba(30,64,175,.6)}.mi-cw.due .mi-fl{color:#e8a33d;border-color:rgba(232,163,61,.5)}.mi-cw.due .mcard{border-color:rgba(232,163,61,.5)}.mi-cw.wk .mi-fl{color:#38b6c9}" +
    ".mi-cw.new .mi-cons{color:#fff}.mi-cw .mcard{border-top-left-radius:0;border-top-right-radius:0}.mi-cw:not(.new):not(.due):not(.wk) .mi-fl+.mcard{}" +
    ".mi-cons.beat{color:#3fb97f}.mi-cons.miss{color:#e0655f}" +
    ".mi-cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:14px}" +
    ".mi-ch{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px 8px;min-width:0}.mi-ch.new{border-color:#1E40AF;box-shadow:0 0 0 1px rgba(30,64,175,.6)}.mi-ch.due{border-color:rgba(232,163,61,.5)}" +
    ".mi-chh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mi-cn{cursor:pointer;font-size:14px}.mi-cn:hover{color:#38b6c9}.mi-cv{margin-left:auto;font:600 17px 'IBM Plex Mono',monospace}.mi-cv small{font-size:11.5px;margin-left:4px}" +
    ".mi-sub{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin:2px 0 4px}.mi-svg{display:block;width:100%;height:auto}" +
    ".mi-ax{font:10px 'IBM Plex Mono',monospace;fill:#8494ab}.mi-pv{font:600 10.5px 'IBM Plex Mono',monospace;fill:#b9c7da}.mi-pv.l{fill:#e8a33d;font-size:11.5px}.mi-new{font:700 10px 'IBM Plex Mono',monospace;fill:#E8C33A}" +
    ".mi-rd{font-size:12.5px;color:var(--muted);margin:4px 0}" +
    ".mi-dl{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.mi-vs{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.mi-vs button{background:transparent;border:0;color:var(--muted);padding:5px 14px;font:600 12.5px 'IBM Plex Sans',sans-serif;cursor:pointer}.mi-vs button[aria-pressed=true]{background:#1d4ed8;color:#fff}" +
    ".mi-rail{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}" +
    ".mc-cat{border-bottom:1px solid var(--line)}.mc-cat:last-child{border-bottom:0}.mc-h{display:grid;grid-template-columns:minmax(0,1fr) auto auto 12px;min-width:0;gap:8px;align-items:center;width:100%;background:none;border:0;color:var(--text);padding:9px 6px;cursor:pointer;text-align:left;font:600 13px 'IBM Plex Sans',sans-serif}.mc-h:hover{background:rgba(110,168,255,.06)}" +
    ".mc-s{font:700 10px 'IBM Plex Mono',monospace;letter-spacing:.04em;padding:1px 6px;border-radius:4px;border:1px solid currentColor;white-space:nowrap}.mc-s.up{color:#3fb97f}.mc-s.dn{color:#e0655f}.mc-s.heat{color:#e8a33d}.mc-s.cool{color:#6ea8ff}.mc-s.neu{color:#8494ab}" +
    ".mc-n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mc-c{font:11px 'IBM Plex Mono',monospace;color:var(--faint)}.mc-ch{color:var(--faint);font-size:11px}.mc-body{padding:2px 2px 8px}" +
    ".mc-qa{display:flex;gap:6px;margin:0 4px 6px}.mc-qa button{background:none;border:0;color:#38b6c9;font-size:11.5px;cursor:pointer;padding:0}" +
    ".mc-i{display:grid;grid-template-columns:18px minmax(0,1fr) auto auto;gap:6px;align-items:center;width:100%;background:none;border:1px solid transparent;border-left:3px solid transparent;border-radius:6px;color:var(--muted);padding:5px 6px;margin:1px 0;cursor:pointer;text-align:left;font-size:12.5px}" +
    ".mc-i:hover{background:rgba(110,168,255,.06)}.mc-i.on{color:var(--text);border-left-color:#38b6c9;background:rgba(56,182,201,.07)}.mc-in{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mc-in i{color:var(--faint);font-style:normal}.mc-iv{font:11.5px 'IBM Plex Mono',monospace}" +
    ".mc-i.new{background:#1E40AF;color:#fff}.mc-iv.up,.mi-tbl .up{color:#3fb97f}.mc-iv.dn,.mi-tbl .dn{color:#e0655f}.mc-iv.heat,.mi-tbl .heat{color:#e8a33d}.mc-iv.cool,.mi-tbl .cool{color:#6ea8ff}.mi-tbl .neu{color:#8494ab}" +
    ".mc-ws{margin-bottom:18px}.mc-wh{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:10px}.mc-wh h3{margin:0;font-size:15px;display:flex;align-items:center;gap:8px}.mc-wh small{color:var(--faint);font:11px 'IBM Plex Mono',monospace}" +
    ".mi-tbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:12px}.mi-tbl th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.mi-tbl td{padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.mi-tbl td i{color:var(--faint);font-style:normal}" +
    ".mi-num{font-family:'IBM Plex Mono',monospace;text-align:right}.mi-tbl th:nth-child(n+3){text-align:right}.mi-tbl th:last-child{text-align:left}.mi-hist span{font:11px 'IBM Plex Mono',monospace;color:var(--muted);margin-right:8px}.mi-hist span:last-child{color:var(--text);font-weight:600}" +
    ".mi-tr.rel-today td{background:#1E40AF;color:#fff}" +
    "@media (max-width:900px){.mi-wrap{grid-template-columns:1fr}.mi-pick,.mi-rail{position:static;max-height:none}.mi-cg{grid-template-columns:1fr}}";
  document.head.appendChild(css);
  try { if (window.DATA && typeof renderFX === "function" && document.getElementById("panel-fx")) renderFX(); } catch (e) {}
})();
