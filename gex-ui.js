/* gex-ui.js — World Markets → US Markets: index gamma bell curve & dealer GEX profile (owner, Nov 23 2026).
   Data: gex.json on the `gex` branch, written every 30 min through the US session by scripts/gex.py from Yahoo option chains
   (S&P 500 ^SPX, Nasdaq-100 ^NDX, Dow via the DIA ETF = Dow ÷ 100). Nothing here is computed from guesses: the page draws
   what the file holds and hides an index the server could not build. */
(function () {
  "use strict";
  var root = window, doc = document;
  var REPO = (root.LIVE_CONFIG && root.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/gex.json?ref=gex", RAW = "https://raw.githubusercontent.com/" + REPO + "/gex/gex.json";
  var G = null, etag = "", last = 0, err = "";
  var S = { k: "SPX", w: "w30" };
  try { var sv = JSON.parse(localStorage.getItem("desk.gex") || "null"); if (sv) { S.k = sv.k || S.k; S.w = sv.w || S.w; } } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ago(t) { var m = Math.round((Date.now() - Date.parse(t)) / 60000); return m < 60 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " days"; }
  function load() {
    last = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) return null; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; return r.json();
    }).then(function (j) { if (j) { G = j; err = ""; paint(); } }).catch(function () {
      fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
        .then(function (j) { G = j; err = ""; paint(); }).catch(function () { err = "gamma data unavailable right now"; paint(); });
    });
  }
  function html() {
    if (!G) return '<div class="tile gex-tile"><h2>Index gamma · dealer GEX profile</h2><p class="note">' + (err ? esc(err) : "Loading…") + "</p></div>";
    var I = G.indices || {}, keys = ["SPX", "NDX", "DJX"].filter(function (k) { return I[k] && I[k][S.w] && I[k][S.w].rows && I[k][S.w].rows.length; });
    if (!keys.length) return '<div class="tile gex-tile"><h2>Index gamma · dealer GEX profile</h2><p class="note">The server could not build the index chains on its last run.</p></div>';
    if (keys.indexOf(S.k) < 0) S.k = keys[0];
    var X = I[S.k], W = X[S.w], dj = S.k === "DJX";
    var kf = function (x) { return dj ? (+x).toFixed(0) : (+x).toLocaleString("en-US", { maximumFractionDigits: 0 }); };
    var sf = function (x) { return (+x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var rows = W.rows.map(function (r) { return { K: r[0], coi: r[1], poi: r[2], civ: r[5], piv: r[6], net: (r[9] || 0) - (r[10] || 0) }; });
    var fb0 = X.iv_fallback && X.iv_fallback.of ? X.iv_fallback.n / X.iv_fallback.of : 0;
    if (fb0 > 0.5) rows.forEach(function (r) { r.civ = r.piv = null; });   /* most quotes carry no usable IV (off-hours): no skew line rather than a misleading one */
    /* many fine strikes (SPX lists every 5 points): group into about 60 bands so bars and the IV line stay readable */
    var bw = 0; if (rows.length > 70) { var span = rows[rows.length - 1].K - rows[0].K, raw = span / 60; bw = [1, 2, 5, 10, 25, 50, 100, 250, 500].filter(function (x) { return x >= raw; })[0] || 500;
      var B = {}; rows.forEach(function (r) { var k = Math.round(r.K / bw) * bw, z = B[k] = B[k] || { K: k, coi: 0, poi: 0, net: 0, cw: 0, cs: 0, pw: 0, ps: 0 }; z.coi += r.coi; z.poi += r.poi; z.net += r.net;
        if (r.civ) { z.cs += r.civ * (r.coi + 1); z.cw += r.coi + 1; } if (r.piv) { z.ps += r.piv * (r.poi + 1); z.pw += r.poi + 1; } });
      rows = Object.keys(B).map(function (k) { var z = B[k]; return { K: z.K, coi: z.coi, poi: z.poi, net: z.net, civ: z.cw ? z.cs / z.cw : null, piv: z.pw ? z.ps / z.pw : null }; }); }
    var dte = S.w === "w30" ? X.window_dte : X.near_dte;
    var NAME = { SPX: "S&P 500", NDX: "Nasdaq-100", DJX: "Dow Jones" };
    var seg = function (attr, list, on) { return '<div class="gr-slicer" role="group">' + list.map(function (x) { return '<button type="button" ' + attr + '="' + x[0] + '" aria-pressed="' + (x[0] === on) + '">' + x[1] + "</button>"; }).join("") + "</div>"; };
    /* a strike whose OI is far above its neighbours dominates the profile — flag it so it can be checked against a broker */
    var odd = []; W.rows.forEach(function (r, i) { [[1, "calls"], [2, "puts"]].forEach(function (c) { var nb = W.rows.slice(Math.max(0, i - 5), i + 6).filter(function (z) { return z !== r; }).map(function (z) { return z[c[0]]; }).sort(function (a, b) { return a - b; }); var md = nb[Math.floor(nb.length / 2)] || 0; if (r[c[0]] > 20000 && r[c[0]] > 8 * Math.max(md, 1)) odd.push((dj ? "DIA " : "") + kf(r[0]) + " " + c[1] + " (" + r[c[0]].toLocaleString("en-US") + " OI)"); }); });
    /* walls out of the money only, against this spot: most call OI at/above, most put OI at/below (owner, Nov 23 2026) */
    var OW = (function () { var c = null, p = null; (W.rows || []).forEach(function (r) { if (r[0] >= X.spot && r[1] > 0 && (!c || r[1] > c[1])) c = r; if (r[0] <= X.spot && r[2] > 0 && (!p || r[2] > p[2])) p = r; });
      return { cw: c ? c[0] : W.call_wall && W.call_wall[0], pw: p ? p[0] : W.put_wall && W.put_wall[0] }; })();
    /* the Dow chart in Dow index points (owner, Nov 23 2026): DIA strikes × today's Dow ÷ DIA ratio (from the server; else from the
       World Markets quotes); DIA's own option strikes stay in the tooltip notes */
    var sc = 1;
    if (dj) { sc = X.scale || 0; if (!sc) { try { var Wd = root.WORLD && WORLD._data && WORLD._data(), dji = Wd && (Wd.instruments || []).filter(function (i) { return i.sym === "^DJI"; })[0], dia = Wd && (Wd.instruments || []).filter(function (i) { return i.sym === "DIA"; })[0];
      if (dji && dia && dia.last) sc = dji.last / dia.last; else if (dji && X.spot) sc = dji.last / X.spot; } catch (e) {} } if (!sc || sc < 95 || sc > 105) sc = 100; }
    var kfD = function (x) { return (+x).toLocaleString("en-US", { maximumFractionDigits: 0 }); };
    var fbN = X.iv_fallback && X.iv_fallback.of ? Math.round(X.iv_fallback.n / X.iv_fallback.of * 100) : null;
    return '<div class="tile gex-tile"><h2>Index gamma bell curve &amp; dealer GEX profile <span class="h2note">— ' + esc(dj ? "Dow Jones Industrial Average · from DIA options" : X.name) + " · spot " + sf(X.spot * sc) + " · " + (S.w === "w30" ? "all expiries in the next " + G.window_days + " days (" + X.expiries.length + ")" : "nearest expiry " + esc(X.near)) +
      " · updated <span class=gex-age>" + ago(G.updated_at) + "</span> ago</span></h2>" +
      '<div class="oc-ctl"><span>Index</span>' + seg("data-gex-k", keys.map(function (k) { return [k, NAME[k]]; }), S.k) + "<span>Window</span>" + seg("data-gex-w", [["w30", "Next 30 days"], ["nearest", "Nearest expiry"]], S.w) + "</div>" +
      GAMMA_UI.chart({ spot: X.spot * sc, spotLab: dj ? "Dow Jones Industrial Average" : X.name + " index", dfmt: function (x) { return (+x).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " pts"; },
        rows: rows.map(function (r) { return { K: r.K * sc, coi: r.coi, poi: r.poi, civ: r.civ, piv: r.piv, net: r.net }; }), iv: W.atm_iv, normalIv: X.normal_iv, normalLab: X.normal_src, T: Math.max(dte, 1) / 365, horizon: S.w === "w30" ? "to " + dte + " days" : "to expiry", em: W.em && W.em * sc,
        callWall: OW.cw && OW.cw * sc, putWall: OW.pw && OW.pw * sc, flip: W.flip && W.flip * sc, kfmt: dj ? kfD : kf, sfmt: sf }) +
      '<p class="note">' + esc(G.source) + ". Strikes within ±" + G.band_pct + "% of spot. GEX per strike = gamma × open interest × 100 × spot² × 1%, in $ millions; calls positive, puts negative (dealers assumed long calls / short puts — the usual convention, not a measured position)." +
      (fbN != null ? " " + fbN + "% of contracts had no usable quoted IV (common outside US hours), so their gamma uses " + (fbN > 50 ? "(and the IV skew line is hidden) " : "") + esc(X.vol_index_sym) + " " + (X.vol_index != null ? X.vol_index.toFixed(2) : "") + "." : "") +
      (bw ? " Bars group strikes into " + (dj ? kfD(bw * sc) : kf(bw)) + "-point bands." : "") + (odd.length ? ' <b class="gex-odd">Unusually large open interest: ' + esc(odd.sort(function (a, b) { return +b.replace(/.*\(([\d,]+) OI\).*/, "$1").replace(/,/g, "") - +a.replace(/.*\(([\d,]+) OI\).*/, "$1").replace(/,/g, ""); }).slice(0, 4).join(", ")) + " — it dominates the bars; worth checking against your broker.</b>" : "") +
      (dj ? " Dow levels: DIA ETF option strikes × " + sc.toFixed(2) + " (today's Dow ÷ DIA), so walls and ranges read in Dow points; a DIA strike of 495 ≈ Dow " + kfD(495 * sc) + "." : "") + " Normal regime = " + esc(X.normal_src) + ". Open interest is as of the prior close.</p></div>";
  }
  function paint() {
    var P = doc.getElementById("panel-usmkt"); if (!P || !P.classList.contains("active")) return;
    var t = P.querySelector(":scope > .gex-tile"), h = html(), key = h.replace(/<span class=gex-age>[^<]*<\/span>/, "");
    if (t && t._h === key) { var a = t.querySelector(".gex-age"), m = h.match(/<span class=gex-age>([^<]*)<\/span>/); if (a && m && a.textContent !== m[1]) a.textContent = m[1]; return; }   /* only the age changed: no redraw */
    var y = root.scrollY, box = doc.createElement("div"); box.innerHTML = h; var n = box.firstElementChild; n._h = key;
    if (t) t.replaceWith(n); else P.insertBefore(n, P.firstChild);
    root.scrollTo(0, y);
  }
  doc.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gex-k],[data-gex-w]"); if (!b) return;
    if (b.hasAttribute("data-gex-k")) S.k = b.getAttribute("data-gex-k"); else S.w = b.getAttribute("data-gex-w");
    try { localStorage.setItem("desk.gex", JSON.stringify(S)); } catch (e2) {} paint();
  });
  setInterval(function () { var P = doc.getElementById("panel-usmkt"); if (!P || !P.classList.contains("active")) return; if (Date.now() - last > 300000) load(); else paint(); }, 1500);
  var st = doc.createElement("style"); st.textContent = ".gex-odd{color:#e3c14d;font-weight:600}#panel-usmkt>.gex-tile{margin-bottom:12px}"; doc.head.appendChild(st);
  setTimeout(function () { if (!G) load(); }, 9000);   /* light file: load once in the background so the audio recap can read it */
  root.GEX_UI = { load: load, _data: function () { return G; } };
})();
