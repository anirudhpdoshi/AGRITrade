/* gg-ui.js — "Brazil · CONAB" and "World · USDA" views inside each grain tab's Fundamentals switch.
   Data: gg.json on the `ggrain` branch (scripts/global_grains.py, twice a day on weekdays) + world-paths.json (static map).
   Loaded once on page start but fetches nothing until a user picks Brazil or World. Every figure shows its source,
   release / publication date, crop year and status (USDA estimate · CONAB forecast · Comex Stat observed). */
(function () {
  "use strict";
  var REPO = (window.LIVE_CONFIG && window.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/gg.json?ref=ggrain";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/ggrain/gg.json";
  var G = null, MAP = null, etag = "", busy = false, err = null, lastTry = 0;
  var CROP = { corn: "corn", wheat: "wheat", soybeans: "soybeans" };
  var CN = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  var A2 = { USA: "us", CAN: "ca", BRA: "br", ARG: "ar", RUS: "ru", UKR: "ua", CHN: "cn", IND: "in", AUS: "au", PRY: "py", ZAF: "za", KAZ: "kz",
    MEX: "mx", URY: "uy", PAK: "pk", TUR: "tr", JPN: "jp", GBR: "gb", CHE: "ch", NZL: "nz", HKG: "hk", DEU: "de", FRA: "fr", EU: "eu" };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function mt(v, d) { return v == null ? "—" : (v / 1000).toLocaleString("en-US", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }); }
  function n1(v, d) { return v == null ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }); }
  function pc(v, d) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; }
  function cl(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  function flagOf(a3, h) {
    var cc = A2[a3]; h = h || 12;
    if (!cc) return '<span class="ggf">' + esc(a3 && a3.length === 3 ? a3 : "") + "</span>";
    if ((cc === "us" || cc === "ca") && typeof window.flag === "function") return window.flag(cc, h);
    return window.WORLD && window.WORLD.flag ? window.WORLD.flag(cc, h) : "";
  }
  function tag(s) { var m = { estimate: ["est", "USDA ESTIMATE"], forecast: ["fc", "CONAB FORECAST"], observed: ["obs", "OBSERVED"] }[s] || ["est", s]; return '<span class="ggtag ' + m[0] + '">' + m[1] + "</span>"; }
  function ago(iso) { var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; }
  function stale(b) { return b && b.stale ? ' <span class="ggtag st">LAST GOOD COPY — latest refresh failed</span>' : ""; }
  function unreach(what) { return '<div class="tile wide"><div class="unreach">⚠ Sorry, we can’t be reached now <small>— ' + esc(what) + "; retrying automatically</small></div></div>"; }

  /* ---------- data ---------- */
  function ensure(force) {
    if (busy || window.DESK_LOCKED) return;
    if (!force && Date.now() - lastTry < 60000) return;
    busy = true; lastTry = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    var pm = MAP ? Promise.resolve(MAP) : fetch("world-paths.json", { cache: "force-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var pd = fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) return G; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; return r.json();
    }).catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); });
    Promise.all([pd, pm]).then(function (a) { G = a[0]; MAP = a[1]; err = null; })
      .catch(function () { err = "global grain data did not load (network or GitHub)"; })
      .then(function () { busy = false; repaint(); });
  }
  function repaint() {
    var p = document.querySelector(".tab-panel.active"), k = p && p.id.replace("panel-", "");
    if (CROP[k] && typeof window.renderGrain === "function" && window.SUB && window.SUB[k] === "fund") window.renderGrain(k);
  }

  /* ---------- World view ---------- */
  var MEAS = [["prod", "Production"], ["share_prod", "% world production"], ["exp", "Exports"], ["share_exp", "% world exports"], ["yoy", "YoY change"], ["rev", "Revision vs last report"]];
  function val(c, m) {
    return m === "prod" ? c.cur.prod : m === "exp" ? c.cur.exp : m === "share_prod" ? c.share_prod : m === "share_exp" ? c.share_exp : m === "yoy" ? c.yoy_prod : m === "rev" ? (c.rev_prod ? c.rev_prod.pct : null) : null;
  }
  function fmtV(v, m) { return v == null ? "—" : m === "prod" || m === "exp" ? mt(v) + " MMT" : m === "yoy" || m === "rev" ? pc(v) : n1(v) + "%"; }
  function colour(v, m, mx) {
    if (v == null) return null;
    if (m === "yoy" || m === "rev") { var k = Math.min(1, Math.abs(v) / 15); return v >= 0 ? "rgba(63,185,127," + (0.18 + 0.72 * k).toFixed(2) + ")" : "rgba(224,101,95," + (0.18 + 0.72 * k).toFixed(2) + ")"; }
    if (!(v > 0)) return null;
    var t = Math.sqrt(v / mx); return "rgba(232,185,61," + (0.12 + 0.83 * t).toFixed(2) + ")";
  }
  function mapSVG(key, P, m, sel) {
    if (!MAP) return '<div class="note">Map outline did not load — the tables below carry every figure.</div>';
    var byA3 = {}, mx = 0;
    P.countries.forEach(function (c) { var v = val(c, m); (c.members || [c.a3]).forEach(function (a) { if (a) byA3[a] = { c: c, v: v }; }); if (v != null && v > mx) mx = v; });
    var paths = Object.keys(MAP.c).map(function (a3) {
      var e = byA3[a3], fill = e ? colour(e.v, m, mx) : null, c = e && e.c;
      var tip = (MAP.c[a3].n || a3) + (c ? (c.members ? " (in " + c.name + ")" : "") + " — " + MEAS.filter(function (x) { return x[0] === m; })[0][1] + ": " + fmtV(e.v, m) : " — no USDA " + CN[key].toLowerCase() + " data");
      return '<path d="' + MAP.c[a3].d + '" fill="' + (fill || "#1a2638") + '" stroke="' + (c && sel === c.code ? "#fff" : "#0b1220") + '" stroke-width="' + (c && sel === c.code ? 1.4 : 0.4) + '"' +
        (c ? ' class="ggc" data-dash="' + key + '" data-k="ggc" data-v="' + esc(c.code) + '"' : "") + "><title>" + esc(tip) + "</title></path>";
    }).join("");
    var leg = m === "yoy" || m === "rev" ? '<span><i style="background:rgba(224,101,95,.85)"></i>lower supply</span><span><i style="background:rgba(63,185,127,.85)"></i>higher supply</span><span><i style="background:#1a2638"></i>no data</span>'
      : '<span><i style="background:rgba(232,185,61,.2)"></i>small</span><span><i style="background:rgba(232,185,61,.95)"></i>largest</span><span><i style="background:#1a2638"></i>no data / zero</span>';
    return '<svg class="ggmap" viewBox="0 0 ' + MAP.w + " " + MAP.h + '" role="img" aria-label="World map"><path d="' + MAP.sphere + '" fill="#0c1524" stroke="#1f2d44"/>' + paths + '</svg><div class="gglegend">' + leg + "<em>click a country for its detail · hover for the value</em></div>";
  }
  function detailHTML(key, P, code) {
    var c = P.countries.filter(function (x) { return x.code === code; })[0] || P.countries[0]; if (!c) return "";
    var u = c.cur, p = c.prev || {}, H = c.hist || {}, hk = Object.keys(H), hmx = Math.max.apply(null, hk.map(function (k) { return H[k] || 0; }).concat([1]));
    var row = function (lab, a, b, unit) { return "<tr><td>" + lab + "</td><td>" + a + "</td><td>" + b + "</td><td>" + (unit || "") + "</td></tr>"; };
    return '<div class="tile wide"><h2>' + flagOf(c.a3, 13) + " " + esc(c.name) + " — " + CN[key].toLowerCase() + ' detail <span class="h2note">— USDA PSD · ' + esc(P.my) + " vs " + esc(P.my_prev) + "</span></h2>" +
      '<div class="ggstamp">USDA FAS PSD · release ' + esc(P.release) + " · " + tag("estimate") + (c.updated_month ? " · country last revised in month " + c.updated_month : "") + "</div>" +
      '<div class="ggk">' +
      k("Production " + esc(P.my), mt(u.prod) + " MMT", '<span class="' + cl(c.yoy_prod) + '">' + pc(c.yoy_prod) + "</span> vs " + mt(p.prod) + " MMT") +
      k("Share of world production", n1(c.share_prod) + "%", "world " + mt(P.world.prod) + " MMT") +
      k("Exports", mt(u.exp) + " MMT", n1(c.share_exp) + "% of world exports · " + (c.exp_of_prod != null ? n1(c.exp_of_prod, 0) + "% of own crop" : "")) +
      k("Ending stocks", mt(u.end) + " MMT", "stocks-to-use " + (c.stu != null ? n1(c.stu) + "%" : "—")) + "</div>" +
      '<div class="ggcols"><table class="ggt"><tr><th>Metric</th><th>' + esc(P.my) + "</th><th>" + esc(P.my_prev) + "</th><th></th></tr>" +
      row("Area harvested", n1(u.area != null ? u.area / 1000 : null, 2), n1(p.area != null ? p.area / 1000 : null, 2), "M ha") +
      row("Yield", n1(u.yield, 2), n1(p.yield, 2), "t/ha") + row("Production", mt(u.prod), mt(p.prod), "MMT") + row("Imports", mt(u.imp), mt(p.imp), "MMT") +
      row("Domestic use", mt(u.dom), mt(p.dom), "MMT") + (u.crush != null ? row("of which crush", mt(u.crush), "—", "MMT") : "") + row("Exports", mt(u.exp), mt(p.exp), "MMT") + row("Ending stocks", mt(u.end), mt(p.end), "MMT") +
      row("Revision vs previous USDA report", c.rev_prod ? '<span class="' + cl(c.rev_prod.d) + '">' + (c.rev_prod.d > 0 ? "+" : "") + mt(c.rev_prod.d, 2) + "</span>" : "\u2014", "", "MMT") + "</table>" + (c.rev_prod ? "" : '<p class="note">' + esc(P.rev_note || "") + "</p>") +
      '<div class="gghist"><b>Production history (USDA, MMT)</b>' + hk.map(function (y) { return '<div class="ghr"><span>' + esc(y) + '</span><i style="width:' + (100 * (H[y] || 0) / hmx).toFixed(1) + '%"></i><em>' + mt(H[y]) + "</em></div>"; }).join("") + "</div></div>" +
      '<div class="stamp">USDA figures are estimates for the marketing year shown, not final results · marketing years differ by country (USDA aligns them for comparison) · EU shown as one market, as USDA reports it</div></div>';
  }
  function k(l, v, s) { return '<div class="ggkk"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>"; }
  function rank(key, P, field, title, note, shareField) {
    var L = P.countries.filter(function (c) { return (c.cur[field] || 0) > 0; }).sort(function (a, b) { return b.cur[field] - a.cur[field]; }).slice(0, 10);
    var mx = L.length ? L[0][shareField] : 1;
    return '<div class="tile"><h2>' + title + ' <span class="h2note">— ' + note + '</span></h2><div class="ggstamp">USDA PSD · ' + esc(P.my) + " · release " + esc(P.release) + " · world " + mt(P.world[field === "prod" ? "prod" : "exp"]) + " MMT (" + pc(P.world[field === "prod" ? "yoy_prod" : "yoy_exp"]) + " YoY)</div>" +
      '<div class="tbl-scroll"><table class="ggt"><tr><th>Country</th><th>MMT</th><th>% world</th><th>YoY</th>' + (field === "exp" ? "<th>% of own crop</th>" : "<th>Revision</th>") + "</tr>" +
      L.map(function (c) { var sh = c[shareField];
        return '<tr data-dash="' + key + '" data-k="ggc" data-v="' + esc(c.code) + '" class="ggrow"><td>' + flagOf(c.a3, 11) + " " + esc(c.name) + "</td><td>" + mt(c.cur[field]) + '</td><td><span class="ggbar" style="width:' + (60 * sh / mx).toFixed(0) + 'px"></span>' + n1(sh) + "%</td>" +
          '<td class="' + cl(field === "prod" ? c.yoy_prod : c.yoy_exp) + '">' + pc(field === "prod" ? c.yoy_prod : c.yoy_exp) + "</td>" +
          (field === "exp" ? "<td>" + (c.exp_of_prod != null ? n1(c.exp_of_prod, 0) + "%" : "—") + "</td>" : '<td class="' + (c.rev_prod ? cl(c.rev_prod.d) : "neu") + '">' + (c.rev_prod ? (c.rev_prod.d > 0 ? "+" : "") + mt(c.rev_prod.d, 2) : "—") + "</td>") + "</tr>"; }).join("") + "</table></div>" +
      (field === "exp" ? '<p class="note">Big producers are not always big exporters — compare each country’s share of world output with its share of world exports.</p>' : "") + "</div>";
  }
  function worldHTML(key) {
    var B = G.crops && G.crops[CROP[key]], P = B && B.psd;
    if (!P) return unreach("USDA world " + CN[key].toLowerCase() + " data is missing from this run");
    var st = window.dstate(key), m = st.ggm || "prod", sel = st.ggc || (P.countries[0] && P.countries[0].code);
    var tg = MEAS.map(function (x) { return '<button data-dash="' + key + '" data-k="ggm" data-v="' + x[0] + '" aria-pressed="' + (m === x[0]) + '">' + x[1] + "</button>"; }).join("");
    return '<div class="tile wide"><div class="tile-head"><h2>World ' + CN[key].toLowerCase() + ' — production map <span class="h2note">— ' + esc(P.my) + ' marketing year</span></h2><span class="toggle ggtg" role="group">' + tg + "</span></div>" +
      '<div class="ggstamp">' + esc(P.source) + " · release " + esc(P.release) + " · " + tag("estimate") + " · " + "MMT = million metric tonnes" + " · refreshed " + ago(G.updated_at) + " ago" + stale(P) +
      (m === "rev" && !P.rev_vs ? ' · <b class="warn">' + esc(P.rev_note) + "</b>" : m === "rev" ? " · revision vs release " + esc(P.rev_vs) : "") + "</div>" +
      mapSVG(key, P, m, sel) + "</div>" +
      detailHTML(key, P, sel) +
      rank(key, P, "prod", "Top producers", "share of world production", "share_prod") +
      rank(key, P, "exp", "Top exporters", "share of world exports", "share_exp");
  }

  /* ---------- Brazil view ---------- */
  function brazilHTML(key) {
    var crop = CROP[key], C = G.conab && G.conab.crops && G.conab.crops[crop], P = G.crops && G.crops[crop] && G.crops[crop].psd;
    var X = G.comex && G.comex.crops && G.comex.crops[crop], FX = G.fx && G.fx.brl;
    var br = P && P.countries.filter(function (c) { return c.a3 === "BRA"; })[0];
    var out = "";
    if (!C) out += unreach("the CONAB Brazil survey did not load on the last run");
    else {
      var T = C.total, s = T.seasons || ["", ""];
      out += '<div class="tile wide"><h2>' + flagOf("BRA", 13) + " Brazil " + CN[key].toLowerCase() + ' — CONAB crop survey <span class="h2note">— ' + esc(G.conab.survey) + " · season " + esc(s[1]) + " vs " + esc(s[0]) + "</span></h2>" +
        '<div class="ggstamp">' + esc(G.conab.source) + " · " + tag("forecast") + ' · <a href="' + esc(G.conab.url) + '" target="_blank" rel="noopener">survey page ↗</a> · area 1,000 ha · yield kg/ha · production 1,000 t' + stale(G.conab) + "</div>" +
        '<div class="ggk">' +
        k("Production " + esc(s[1]), mt(T.prod[1]) + " MMT", '<span class="' + cl(T.yoy_prod) + '">' + pc(T.yoy_prod) + "</span> vs " + mt(T.prod[0]) + " MMT in " + esc(s[0])) +
        k("Area · yield", n1(T.area[1] / 1000, 2) + " M ha", n1(T.yield[1] / 1000, 2) + " t/ha (" + pc(T.yield[0] ? 100 * (T.yield[1] - T.yield[0]) / T.yield[0] : null) + " yield)") +
        k("Revision vs previous survey", T.rev ? '<span class="' + cl(T.rev.d) + '">' + (T.rev.d > 0 ? "+" : "") + mt(T.rev.d, 2) + " MMT</span>" : "—", T.rev ? pc(T.rev.pct, 2) + " vs " + esc(G.conab.prev_survey || "previous") : esc(T.rev_note || "no earlier survey for this season")) +
        k("Top states", (T.top_states || []).slice(0, 2).map(function (x) { return esc(x[0]); }).join(" · "), (T.top_states || []).slice(0, 4).map(function (x) { return esc(x[0]) + " " + mt(x[1]) + " MMT"; }).join(" · ")) +
        "</div>";
      if (crop === "corn" && C["2a"]) {
        var parts = ["1a", "2a", "3a"].filter(function (p) { return C[p]; });
        out += '<table class="ggt"><tr><th>Corn crop</th><th>Area M ha</th><th>Yield t/ha</th><th>Prod. ' + esc(s[0]) + "</th><th>Prod. " + esc(s[1]) + "</th><th>YoY</th><th>Share of Brazil</th></tr>" +
          parts.map(function (p) { var r = C[p];
            return "<tr><td>" + ({ "1a": "1st crop (summer)", "2a": "2nd crop — safrinha", "3a": "3rd crop" }[p]) + "</td><td>" + n1(r.area[1] / 1000, 2) + "</td><td>" + n1(r.yield[1] / 1000, 2) + "</td><td>" + mt(r.prod[0]) + "</td><td><b>" + mt(r.prod[1]) + '</b></td><td class="' + cl(r.yoy_prod) + '">' + pc(r.yoy_prod) + "</td><td>" + n1(100 * r.prod[1] / T.prod[1]) + "%</td></tr>"; }).join("") + "</table>";
      }
      if (crop === "wheat") out += '<p class="note">Brazil is a <b>net wheat importer</b> — its wheat matters for world trade through imports (mostly from Argentina), not exports. CONAB wheat uses calendar-year seasons (' + esc(s[1]) + ").</p>";
      out += '<div class="stamp">CONAB figures are forecasts for the season shown and are revised in every monthly survey · Brazil’s 2nd-crop (safrinha) corn is planted after soybeans and harvested Jun–Sep</div></div>';
      var SUP = C.supply, SOY = C.supply_soy;
      if (SUP && SUP.length) {
        out += '<div class="tile wide"><h2>Brazil supply &amp; demand <span class="h2note">— CONAB balance sheet, 1,000 t</span></h2><div class="ggstamp">' + esc(G.conab.survey) + " · " + tag("forecast") + " for the latest season</div>" +
          '<table class="ggt"><tr><th>Season</th><th>Beg. stocks</th><th>Production</th><th>Imports</th><th>Use</th><th>Exports</th><th>End stocks</th></tr>' +
          SUP.map(function (r) { return "<tr><td>" + esc(r.season) + (r.survey ? " <small>(" + esc(r.survey) + ")</small>" : "") + "</td><td>" + n1(r.beg, 0) + "</td><td><b>" + n1(r.prod, 0) + "</b></td><td>" + n1(r.imp, 0) + "</td><td>" + n1(r.cons, 0) + "</td><td>" + n1(r.exp, 0) + "</td><td>" + n1(r.end, 0) + "</td></tr>"; }).join("") + "</table></div>";
      } else if (SOY) {
        var ks = Object.keys(SOY), seas = ks.length ? Object.keys(SOY[ks[0]]).slice(-4) : [];
        out += '<div class="tile wide"><h2>Brazil soybean supply &amp; demand <span class="h2note">— CONAB, 1,000 t</span></h2><div class="ggstamp">' + esc(G.conab.survey) + " · " + tag("forecast") + "</div>" +
          '<table class="ggt"><tr><th>Item</th>' + seas.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr>" +
          ks.slice(0, 9).map(function (r) { return "<tr><td>" + esc(r.charAt(0).toUpperCase() + r.slice(1)) + "</td>" + seas.map(function (x) { return "<td>" + n1(SOY[r][x], 0) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table></div>";
      }
    }
    /* CONAB vs USDA */
    if (br && C) {
      var T2 = C.total, d = T2.prod[1] - br.cur.prod;
      out += '<div class="tile wide"><h2>CONAB vs USDA for Brazil <span class="h2note">— two agencies, shown side by side, never blended</span></h2>' +
        '<div class="ggstamp">USDA PSD ' + esc(P.my) + " (release " + esc(P.release) + ") · CONAB " + esc(T2.seasons[1]) + " (" + esc(G.conab.survey) + ")</div>" +
        '<table class="ggt"><tr><th></th><th>CONAB</th><th>USDA</th><th>Gap</th></tr><tr><td>Production (MMT)</td><td>' + mt(T2.prod[1]) + "</td><td>" + mt(br.cur.prod) + '</td><td class="' + cl(d) + '">' + (d > 0 ? "+" : "") + mt(d) + "</td></tr>" +
        "<tr><td>Brazil share of world production</td><td>—</td><td>" + n1(br.share_prod) + "%</td><td></td></tr><tr><td>Brazil share of world exports</td><td>—</td><td>" + n1(br.share_exp) + "%</td><td></td></tr></table>" +
        '<p class="note">Agencies differ in survey method, timing and crop-year definition (USDA aligns Brazil to its own marketing year), so gaps are normal; a widening gap is worth watching.</p></div>';
    }
    /* Exports (Comex Stat) */
    if (X) {
      out += '<div class="tile"><h2>Brazil ' + CN[key].toLowerCase() + ' exports — actual <span class="h2note">— customs data, year to date</span></h2>' +
        '<div class="ggstamp">' + esc(G.comex.source) + " · " + tag("observed") + " · " + esc(G.comex.period) + " vs " + esc(G.comex.period_prev) + " · NCM " + esc(X.ncm) + " · data through " + esc(G.comex.data_updated || "") + stale(G.comex) + "</div>" +
        '<div class="ggk">' + k("Exported year to date", n1(X.kt / 1000, 2) + " MMT", '<span class="' + cl(X.yoy) + '">' + pc(X.yoy) + "</span> vs " + n1(X.kt_prev / 1000, 2) + " MMT same months last year") +
        k("Average export value", X.usd_per_t != null ? "US$" + n1(X.usd_per_t, 0) + "/t" : "—", "FOB, all destinations") + "</div>" +
        '<table class="ggt"><tr><th>Destination</th><th>kt</th><th>Share</th><th>Same period last year</th></tr>' +
        X.top.map(function (r) { return "<tr><td>" + esc(r.country) + "</td><td>" + n1(r.kt, 0) + '</td><td><span class="ggbar bx" style="width:' + (0.6 * r.share).toFixed(0) + 'px"></span>' + n1(r.share) + "%</td><td>" + n1(r.kt_prev, 0) + "</td></tr>"; }).join("") + "</table></div>";
    } else out += '<div class="tile"><div class="unreach">⚠ Sorry, we can’t be reached now <small>— Comex Stat export data is missing from the last run</small></div></div>';
    if (FX && FX.last != null) {
      out += '<div class="tile"><h2>USD/BRL <span class="h2note">— Brazilian real vs US dollar</span></h2><div class="ggstamp">' + esc(FX.source) + " · " + esc(FX.date) + "</div>" +
        '<div class="ggk">' + k("USD/BRL", n1(FX.last, 4), "reais per US dollar") + k("1 day", '<span class="' + cl(FX.d1) + '">' + pc(FX.d1, 2) + "</span>", "") + k("1 week", '<span class="' + cl(FX.w1) + '">' + pc(FX.w1, 2) + "</span>", "") + k("1 month", '<span class="' + cl(FX.m1) + '">' + pc(FX.m1, 2) + "</span>", "") + "</div>" +
        '<p class="note">USD/BRL up = weaker real. All else equal, a weaker real raises the reais a Brazilian exporter earns per dollar of FOB price (local revenue = US$ price × BRL per US$), which can let Brazilian offers compete harder. Domestic prices, freight, basis and margins also matter — this is a mechanism, not a forecast.</p></div>';
    }
    return out;
  }


  /* ---------- Export comparison: US · Canada · Brazil (MMT) ---------- */
  function mmt(kt, d) { return kt == null ? "—" : (kt / 1000).toLocaleString("en-US", { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  var MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function mlab(ym) { return MN[+ym.slice(5, 7) - 1] + " " + ym.slice(2, 4); }
  function exportsHTML(key) {
    if (!G) { ensure(); return err ? unreach(err) : '<div class="tile wide"><h2>Export comparison — US · Canada · Brazil</h2><p class="note">Loading export data…</p></div>'; }
    var crop = CROP[key], P = G.crops && G.crops[crop] && G.crops[crop].psd;
    var US = G.us_exports && G.us_exports.crops && G.us_exports.crops[crop], CA = G.ca_exports && G.ca_exports.crops && G.ca_exports.crops[crop], BR = G.comex && G.comex.crops && G.comex.crops[crop];
    var ORG = [["USA", "us", "United States"], ["CAN", "ca", "Canada"], ["BRA", "br", "Brazil"]];
    if (crop === "wheat") ORG = ORG.concat([["RUS", "", "Russia"], ["EU", "", "European Union"], ["AUS", "", "Australia"], ["ARG", "", "Argentina"]]);
    if (crop !== "wheat") ORG = ORG.concat([["ARG", "", "Argentina"], ["UKR", "", "Ukraine"]]);
    var out = '<div class="tile wide ggx"><h2>Export comparison — ' + CN[key].toLowerCase() + ' <span class="h2note">— US · Canada · Brazil (and key rivals) · all figures in MMT = million metric tonnes</span></h2>';
    /* A. crop-year exports, USDA PSD (one source, aligned years) */
    if (P) {
      var yrs = [];
      P.countries.forEach(function (c) { if (c.years) Object.keys(c.years).forEach(function (y) { if (yrs.indexOf(y) < 0) yrs.push(y); }); });
      yrs.sort(); yrs = yrs.slice(-4);
      var row = function (o) { var c = P.countries.filter(function (x) { return x.a3 === o[0]; })[0]; if (!c || !c.years) return "";
        return "<tr><td>" + flagOf(o[0], 11) + " " + esc(o[2]) + "</td>" + yrs.map(function (y, i) { var r = c.years[y] || {}, pr = i ? (c.years[yrs[i - 1]] || {}) : null, ch = pr && pr.exp ? 100 * (r.exp - pr.exp) / pr.exp : null;
          return "<td><b>" + (r.exp != null ? mt(r.exp, 2) : "—") + "</b>" + (ch != null && r.exp != null ? '<small class="' + cl(ch) + '"> ' + pc(ch) + "</small>" : "") + "</td>"; }).join("") +
          "<td>" + n1((c.years[yrs[yrs.length - 1]] || {}).share_exp) + "%</td><td>" + n1(c.exp_of_prod, 0) + "%</td></tr>"; };
      out += '<h3 class="ggh3">Crop-year exports <small>USDA PSD estimates · marketing year (local years aligned by USDA) · release ' + esc(P.release) + "</small></h3>" +
        '<div class="tbl-scroll"><table class="ggt"><tr><th>Origin</th>' + yrs.map(function (y) { return "<th>" + esc(y) + "/" + String(+y + 1).slice(2) + "</th>"; }).join("") + "<th>% world exports " + esc(P.my) + "</th><th>% of own crop exported</th></tr>" +
        ORG.map(row).join("") + '<tr class="ggtot"><td>World</td>' + yrs.map(function () { return "<td></td>"; }).join("").replace(/<td><\/td>$/, "<td><b>" + mt(P.world.exp, 2) + "</b></td>") + "<td>100%</td><td></td></tr></table></div>";
    }
    /* B. month over month, actual shipments */
    var M = {}, src = [];
    function addM(o, ser, div) { if (!ser) return; Object.keys(ser).forEach(function (ym) { (M[ym] = M[ym] || {})[o] = ser[ym] / div; }); }
    if (US) { addM("us", US.monthly_kt, 1); src.push("US: USDA FAS weekly export shipments summed by week-ending month (" + esc(US.my) + " and prior year)"); }
    if (CA) { addM("ca", CA.monthly_t, 1000); src.push("Canada: Statistics Canada / CGC exports by destination (monthly)"); }
    if (BR) { addM("br", BR.monthly_kt, 1); src.push("Brazil: Comex Stat customs exports (monthly, through " + esc(G.comex.data_updated || "") + ")"); }
    var months = Object.keys(M).sort().filter(function (ym) { var m = M[ym]; return (m.us || 0) + (m.ca || 0) + (m.br || 0) > 0; }).slice(-12);
    if (months.length) {
      var mx = 0; months.forEach(function (ym) { ["us", "ca", "br"].forEach(function (o) { if ((M[ym][o] || 0) > mx) mx = M[ym][o]; }); });
      var Wd = 760, Hh = 170, pl = 40, bw = (Wd - pl - 10) / months.length, cols = { us: "#e8b93d", ca: "#e0655f", br: "#3fb97f" }, svg = "";
      for (var gi = 0; gi <= 3; gi++) { var gy = 10 + (Hh - 34) * gi / 3, gv = mx * (1 - gi / 3); svg += '<line x1="' + pl + '" x2="' + Wd + '" y1="' + gy + '" y2="' + gy + '" stroke="#1e2a3a"/><text x="' + (pl - 4) + '" y="' + (gy + 3) + '" font-size="9" fill="#5b6b82" text-anchor="end" font-family="IBM Plex Mono">' + (gv / 1000).toFixed(1) + "</text>"; }
      months.forEach(function (ym, i) { ["us", "ca", "br"].forEach(function (o, j) { var v = M[ym][o]; if (v == null) return; var h = (Hh - 34) * v / (mx || 1), x = pl + i * bw + 4 + j * (bw - 8) / 3;
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (10 + Hh - 34 - h).toFixed(1) + '" width="' + ((bw - 8) / 3 - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + cols[o] + '"><title>' + mlab(ym) + " · " + { us: "US", ca: "Canada", br: "Brazil" }[o] + ": " + mmt(v) + " MMT</title></rect>"; });
        svg += '<text x="' + (pl + i * bw + bw / 2).toFixed(1) + '" y="' + (Hh - 10) + '" font-size="9.5" fill="#8494ab" text-anchor="middle" font-family="IBM Plex Mono">' + mlab(ym) + "</text>"; });
      var momc = function (o, i) { var a = M[months[i]][o], b = i ? M[months[i - 1]][o] : null; return a == null ? "<td>—</td>" : "<td><b>" + mmt(a) + "</b>" + (b ? '<small class="' + cl(a - b) + '"> ' + pc(100 * (a - b) / b, 0) + "</small>" : "") + "</td>"; };
      out += '<h3 class="ggh3">Month over month — actual exports <small>observed shipments · MMT · small % = change vs previous month</small></h3>' +
        '<svg class="ggbars" viewBox="0 0 ' + Wd + " " + Hh + '">' + svg + '</svg><div class="gglegend"><span><i style="background:#e8b93d"></i>United States</span><span><i style="background:#e0655f"></i>Canada</span><span><i style="background:#3fb97f"></i>Brazil</span><em>MMT per calendar month · hover a bar</em></div>' +
        '<div class="tbl-scroll"><table class="ggt"><tr><th>Month</th><th>' + flagOf("USA", 11) + " US</th><th>" + flagOf("CAN", 11) + " Canada</th><th>" + flagOf("BRA", 11) + " Brazil</th></tr>" +
        months.map(function (ym, i) { return "<tr><td>" + mlab(ym) + (US && US.partial_month === ym ? ' <small class="neu">US to ' + esc(US.week.slice(5)) + "</small>" : "") + "</td>" + momc("us", i) + momc("ca", i) + momc("br", i) + "</tr>"; }).reverse().join("") + "</table></div>";
    }
    /* C. destinations side by side */
    var dcol = function (lab, a3, period, list, toMT) {
      if (!list || !list.length) return '<div class="ggd"><b>' + flagOf(a3, 11) + " " + lab + '</b><div class="unreach">⚠ Sorry, we can’t be reached now <small>— destination data unavailable</small></div></div>';
      return '<div class="ggd"><b>' + flagOf(a3, 11) + " " + lab + "</b><small>" + esc(period) + '</small><table class="ggt">' + list.slice(0, 7).map(function (r) {
        return "<tr><td>" + esc(r.country) + "</td><td>" + mmt(toMT(r)) + '</td><td><span class="ggbar bx" style="width:' + (0.5 * (r.share || 0)).toFixed(0) + 'px"></span>' + n1(r.share) + "%</td></tr>"; }).join("") + "</table></div>";
    };
    out += '<h3 class="ggh3">Top destinations <small>MMT · share of each origin’s exports</small></h3><div class="ggds">' +
      dcol("United States", "USA", US ? "marketing year " + US.my + " to date (week ending " + US.week + ")" : "", US && US.top, function (r) { return r.kt; }) +
      dcol("Canada", "CAN", CA && CA.dest_window ? "last 12 months " + CA.dest_window : "", CA && CA.top, function (r) { return r.t / 1000; }) +
      dcol("Brazil", "BRA", BR ? "calendar year to date " + G.comex.period : "", BR && BR.top, function (r) { return r.kt; }) + "</div>";
    var miss = [!US && "US monthly shipments", !CA && "Canada monthly exports", !BR && "Brazil monthly exports"].filter(Boolean);
    out += '<div class="stamp">' + src.join(" · ") + (miss.length ? " · Sorry, we can’t be reached now for: " + miss.join(", ") : "") +
      " · crop-year totals are USDA estimates; monthly figures are observed shipments · periods differ by origin (US and Canada marketing years, Brazil calendar year) and are labelled on each column</div></div>";
    return out;
  }
  function html(key, geo) {
    if (!G) { ensure(); return err ? unreach(err) : '<div class="tile wide"><p class="note">Loading global grain data…</p></div>'; }
    ensure();
    return geo === "world" ? worldHTML(key) : brazilHTML(key);
  }
  window.addEventListener("desk:unlock", function () { lastTry = 0; });
  /* opening Fundamentals: load (or reuse) the global data, then repaint so the export comparison fills in */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-sub="fund"]'); if (!b) return;
    setTimeout(function () { if (G) repaint(); else ensure(true); }, 0);
  });
  window.GG = { html: html, exportsHTML: exportsHTML, ensure: ensure, _data: function () { return G; }, _error: function () { return err; } };
  repaint();
})();
