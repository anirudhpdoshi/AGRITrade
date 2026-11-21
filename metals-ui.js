/* metals-ui.js — USD/CAD → Mineral exports (owner, Nov 21 2026).
   Canada's mineral & metal exports by NRCan segment: five years of actuals, this year to date, winners and losers, where each
   commodity ships, spot prices against the 2025 average, the implied value at today's prices (estimate) and what that does to
   Canada's US-dollar earnings and USD/CAD. Data: metals.json (scripts/metals.py). Actuals (A) and estimates (E) are tagged. */
(function (root) {
  var doc = root.document, D = null, err = null, at = 0, SEL = null, SEG = "all", CUR = "cad";
  try { SEL = localStorage.getItem("desk.mx.sel"); SEG = localStorage.getItem("desk.mx.seg") || "all"; } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function m$(v, sign) { if (v == null) return "—"; var a = Math.abs(v), s = sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : (v < 0 ? "−" : "");
    return s + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 1 : 2) + "bn" : a >= 1 ? a.toFixed(0) + "m" : a.toFixed(1) + "m"); }
  function pc(v, d) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; }
  function cl(v) { return v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function nf(v, d) { return v == null ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function vol(v, u) { if (v == null) return "—"; if (u === "oz") return v >= 1e6 ? (v / 1e6).toFixed(2) + " Moz" : (v / 1e3).toFixed(0) + " koz"; if (u === "ct") return (v / 1e6).toFixed(2) + " Mct";
    return v >= 1e6 ? (v / 1e6).toFixed(2) + " Mt" : v >= 1e3 ? (v / 1e3).toFixed(1) + " kt" : v.toFixed(0) + " t"; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function ym(p) { return MON[+String(p).slice(4, 6) - 1] + " " + String(p).slice(2, 4); }
  function A() { return '<i class="mx-a" title="Actual — Statistics Canada customs data via UN Comtrade">A</i>'; }
  function E() { return '<i class="mx-e" title="Estimate — computed by the desk from actual volumes and current prices">E</i>'; }
  function load() {
    if (Date.now() - at < 10 * 60000 && (D || err)) return; at = Date.now();
    fetch("metals.json?t=" + Math.floor(Date.now() / 600000), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { D = j; err = null; paint(); }).catch(function (e) { err = e.message; paint(); });
  }
  function paint() { var v = doc.getElementById("mxView"); if (v) v.outerHTML = html(); }
  function spark(vals, w, h, col) {
    var V = vals.filter(function (x) { return x != null; }); if (V.length < 2) return "";
    var mn = Math.min.apply(null, V), mx = Math.max.apply(null, V), sp = mx - mn || 1, n = vals.length;
    var pts = vals.map(function (v, i) { return v == null ? null : (i / (n - 1) * w).toFixed(1) + "," + (h - 2 - (v - mn) / sp * (h - 4)).toFixed(1); }).filter(Boolean).join(" ");
    return '<svg class="mx-sp" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '"><polyline points="' + pts + '" fill="none" stroke="' + (col || "#38b6c9") + '" stroke-width="1.6"/></svg>';
  }
  function bars(L, lab, val, col, h) {
    h = h || 170; var w = 520, pl = 50, pb = 22, n = L.length, mx = (Math.max.apply(null, L.map(function (x) { return val(x) || 0; })) || 1) * 1.12, bw = (w - pl - 6) / n;
    var s = ""; [0, .5, 1].forEach(function (f) { var y = 6 + (h - pb - 6) * (1 - f); s += '<line x1="' + pl + '" x2="' + w + '" y1="' + y + '" y2="' + y + '" class="mx-gr"/><text x="' + (pl - 5) + '" y="' + (y + 3) + '" class="mx-tk" text-anchor="end">' + m$(mx * f) + "</text>"; });
    L.forEach(function (x, i) { var v = val(x); if (v == null) return; var bh = v / mx * (h - pb - 6), X = pl + i * bw + bw * .18, Y = h - pb - bh;
      s += '<rect x="' + X.toFixed(1) + '" y="' + Y.toFixed(1) + '" width="' + (bw * .64).toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (col(x, i) || "#38b6c9") + '"><title>' + esc(lab(x)) + ": C$" + m$(v) + "</title></rect>" +
        '<text x="' + (X + bw * .32).toFixed(1) + '" y="' + (Y - 4).toFixed(1) + '" class="mx-vl" text-anchor="middle">' + m$(v) + "</text>" +
        (n <= 12 || i % 3 === 0 || i === n - 1 ? '<text x="' + (X + bw * .32).toFixed(1) + '" y="' + (h - 6) + '" class="mx-tk" text-anchor="middle">' + esc(lab(x)) + "</text>" : ""); });
    return '<svg class="mx-ch" viewBox="0 0 ' + w + " " + h + '">' + s + "</svg>";
  }
  function line(L, getv, lab, col, h, fmt) {
    h = h || 170; var w = 520, pl = 56, pb = 22, V = L.map(getv).filter(function (x) { return x != null; }); if (V.length < 2) return "";
    var mn = Math.min.apply(null, V), mx = Math.max.apply(null, V), sp = mx - mn || 1, n = L.length, X = function (i) { return pl + i / (n - 1) * (w - pl - 8); }, Y = function (v) { return 6 + (h - pb - 6) * (1 - (v - mn) / sp); };
    var s = ""; [0, .5, 1].forEach(function (f) { var v = mn + sp * f; s += '<line x1="' + pl + '" x2="' + w + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="mx-gr"/><text x="' + (pl - 5) + '" y="' + (Y(v) + 3).toFixed(1) + '" class="mx-tk" text-anchor="end">' + fmt(v) + "</text>"; });
    var d = ""; L.forEach(function (x, i) { var v = getv(x); if (v == null) return; d += (d ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
    s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.8"/>';
    [0, Math.floor(n / 2), n - 1].forEach(function (i) { s += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 6) + '" class="mx-tk" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '">' + esc(lab(L[i])) + "</text>"; });
    var lv = getv(L[n - 1]); if (lv != null) s += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(lv).toFixed(1) + '" r="3" fill="' + col + '"/><text x="' + (X(n - 1) - 6).toFixed(1) + '" y="' + (Y(lv) - 7).toFixed(1) + '" class="mx-vl" text-anchor="end">' + fmt(lv) + "</text>";
    return '<svg class="mx-ch" viewBox="0 0 ' + w + " " + h + '">' + s + "</svg>";
  }
  function byId(id) { return D.commodities.filter(function (c) { return c.id === id; })[0]; }
  function base(c) { return c.history.filter(function (h) { return h.y === D.base_year; })[0] || {}; }
  function detail(c) {
    if (!c) return "";
    var P = c.price, ES = c.est, b = base(c);
    var px = P ? '<div class="mx-dk"><span>Price ' + (P.kind === "daily" ? "(daily, delayed)" : "(monthly avg)") + '</span><b>' + nf(P.current, P.current < 20 ? 2 : 0) + " <small>" + esc(P.unit) + "</small></b><small>" + esc(P.date) + " · vs " + D.base_year + " avg " + nf(P.avg_base, P.avg_base < 20 ? 2 : 0) + ' <b class="' + cl(P.vs_base_pct) + '">' + pc(P.vs_base_pct) + "</b>" +
      (P.chg && P.chg["1m"] != null ? " · 1M " + pc(P.chg["1m"]) + " · YTD " + pc(P.chg.ytd) : "") + "</small></div>" : '<div class="mx-dk"><span>Price</span><b>—</b><small>no official daily or monthly benchmark; trade values only</small></div>';
    var es = ES ? '<div class="mx-dk"><span>' + (ES.method === "avg3" ? "Expected annual value (3-yr average) " : "Implied annual value at today's price ") + E() + '</span><b>US$' + m$(ES.implied_usd_m) + '</b><small>vs ' + D.base_year + " actual US$" + m$(b.usd_m) + ' → <b class="' + cl(ES.erosion_usd_m) + '">' + m$(ES.erosion_usd_m, true) + "</b>" +
      (ES.method === "avg3" ? " · no price benchmark, so the expected value is the " + esc(ES.volume_basis) : " (price " + m$(ES.price_effect_usd_m, true) + " · volume " + m$(ES.volume_effect_usd_m, true) + ") · " + esc(ES.volume_basis)) +
      (c.proj ? " · " + D.projection.year + " projected C$" + m$(c.proj.cad_m) + " (" + c.proj.actual_months + " actual months)" : "") + "</small></div>" : "";
    var charts = '<div class="mx-cg"><div><h5>Annual exports, C$ ' + A() + "</h5>" + bars(c.history, function (h) { return h.y; }, function (h) { return h.cad_m; }, function (h) { return h.y === D.base_year ? "#ffb84d" : "#38b6c9"; }) + "</div>" +
      '<div><h5>Monthly exports, C$ ' + A() + "</h5>" + (c.monthly.length ? bars(c.monthly.slice(-18), function (m) { return ym(m.p); }, function (m) { return m.cad_m; }, function (m) { return m.p.slice(0, 4) === String(new Date().getFullYear()) ? "#3fb97f" : "#5b6b80"; }) : '<p class="mx-n">No monthly data yet.</p>') + "</div>" +
      (P ? '<div><h5>Price, ' + esc(P.unit) + " · " + (P.kind === "daily" ? "daily" : "monthly") + "</h5>" + (P.daily && P.daily.length > 20 ? line(P.daily, function (x) { return x.p; }, function (x) { return x.d.slice(5); }, "#ffb84d", 170, function (v) { return nf(v, v < 20 ? 2 : 0); }) : line(P.monthly, function (x) { return x.p; }, function (x) { return x.m; }, "#ffb84d", 170, function (v) { return nf(v, v < 20 ? 2 : 0); })) + "</div>" : "") +
      '<div><h5>Where it ships · ' + esc(c.dest_year || "") + " " + A() + "</h5>" + (c.dest.length ? '<div class="mx-dst">' + c.dest.map(function (d) { return '<div><span>' + esc(d.c) + '</span><i style="width:' + Math.max(2, d.share || 0).toFixed(0) + '%"></i><b>' + pc(d.share, 0).replace("+", "") + "</b><small>US$" + m$(d.usd_m) + "</small></div>"; }).join("") + "</div>" : '<p class="mx-n">No destination detail.</p>') + "</div></div>";
    var vol5 = '<p class="mx-n">Volumes (net weight, all HS lines): ' + c.history.map(function (h) { return h.y + " " + vol(h.volume, c.vol_unit); }).join(" · ") + " · 5-yr average " + vol(c.avg_volume_5y, c.vol_unit) + ". HS " + c.hs.join(", ") + ".</p>";
    return '<div class="mx-det"><div class="mx-dh"><h4>' + esc(c.name) + '</h4><button type="button" data-mxsel="">✕ Close</button></div><div class="mx-dks">' + px + es +
      '<div class="mx-dk"><span>' + esc(c.ytd.year) + " year to date " + A() + '</span><b>C$' + m$(c.ytd.cad_m) + '</b><small>' + c.ytd.months + " months · vs same months " + D.base_year + ' <b class="' + cl(c.ytd.pct) + '">' + pc(c.ytd.pct) + "</b></small></div></div>" + charts + vol5 + "</div>";
  }
  function html() {
    load();
    if (!D) return '<section id="mxView" class="tile wide"><h2>Canada mineral &amp; metal exports</h2><p>' + (err ? "Unavailable — " + esc(err) : "Loading…") + "</p></section>";
    var Y = D.years, BY = D.base_year, L = D.commodities, I = D.impact, FX = D.fx, PY = Y[Y.length - 2];
    var segName = {}; D.segments.forEach(function (s) { segName[s.id] = s.name; });
    var trk = D.totals.tracked_cad_m[BY], trkP = D.totals.tracked_cad_m[PY], cx = D.totals.canada_exports_cad_m[BY];
    var both = L.filter(function (c) { return c.ytd.cad_m != null && c.ytd.prior_cad_m != null; });
    var ytdC = L.reduce(function (a, c) { return a + (c.ytd.cad_m || 0); }, 0), ytdB = both.reduce(function (a, c) { return a + c.ytd.cad_m; }, 0), ytdP = both.length ? both.reduce(function (a, c) { return a + c.ytd.prior_cad_m; }, 0) : null;
    var thr = L.map(function (c) { return c.ytd.through; }).filter(Boolean).sort().pop();
    var k = function (t, v, s, c) { return '<div class="mx-k"><span>' + t + '</span><b class="' + (c || "") + '">' + v + "</b><small>" + s + "</small></div>"; };
    var kp = '<div class="mx-ks">' + k("Tracked exports " + BY + " " + A(), "C$" + m$(trk), pc((trk / trkP - 1) * 100) + " vs " + PY + (cx ? " · " + (trk / cx * 100).toFixed(1) + "% of all goods exports" : "")) +
      k(String(new Date().getFullYear()) + " to date " + A(), "C$" + m$(ytdC), (ytdP ? pc((ytdB / ytdP - 1) * 100) + " vs same months of " + BY : "") + (thr ? " · through " + ym(thr) : ""), ytdP ? cl(ytdB - ytdP) : "") +
      (function () { var all = I.all_erosion_usd_m != null ? I.all_erosion_usd_m : I.erosion_usd_m, allC = I.all_erosion_cad_m != null ? I.all_erosion_cad_m : I.erosion_cad_m;
        return k("Revenue impact vs " + BY + " " + E(), "US$" + m$(all, true), "C$" + m$(allC, true) + " · " + I.priced.length + " at today's prices US$" + m$(I.erosion_usd_m, true) + (I.avg3 ? " · " + I.avg3.length + " at 3-yr average US$" + m$(I.avg3_erosion_usd_m, true) : "") + (I.all_share_of_exports_pct != null ? " · " + pc(I.all_share_of_exports_pct, 2) + " of goods exports" : ""), cl(all)); })() +
      (D.projection ? k(D.projection.year + " full year, projected " + E(), "C$" + m$(D.projection.cad_m), pc(D.projection.pct) + " vs " + BY + " (C$" + m$(D.projection.chg_cad_m, true) + ") · actual months + 3-yr average run-rate for the rest", cl(D.projection.chg_cad_m)) : "") +
      k("USD/CAD · Bank of Canada", nf(FX.usdcad, 4), FX.date + " · " + BY + " avg " + nf(FX.avg[BY], 4) + (I.cad_link.corr != null ? " · 1-yr corr. with metals " + I.cad_link.corr.toFixed(2) : "")) + "</div>";
    var segs = '<div class="mx-segs"><button type="button" data-mxseg="all" aria-pressed="' + (SEG === "all") + '"><b>All segments</b><small>C$' + m$(trk) + " · " + BY + "</small></button>" + D.segments.map(function (s) {
      var h = s.history, a = h[h.length - 1].cad_m, p = h[h.length - 2].cad_m, ch = a != null && p ? (a / p - 1) * 100 : null;
      return '<button type="button" data-mxseg="' + s.id + '" aria-pressed="' + (SEG === s.id) + '"><b>' + esc(s.name) + "</b><small>C$" + m$(a) + ' <em class="' + cl(ch) + '">' + pc(ch) + "</em></small>" + spark(h.map(function (x) { return x.cad_m; }), 90, 22, ch >= 0 ? "#3fb97f" : "#ff6b6b") + "</button>"; }).join("") + "</div>";
    var pool = L.filter(function (c) { return SEG === "all" || c.seg === SEG; });
    var yo = pool.filter(function (c) { return c.yoy; }).sort(function (a, b) { return b.yoy.chg_cad_m - a.yoy.chg_cad_m; });
    var wl = function (arr, up) { return arr.map(function (c) { return '<div class="mx-wl" data-mxsel="' + c.id + '"><span>' + esc(c.name) + '<small>' + esc(segName[c.seg]) + '</small></span><b class="' + cl(c.yoy.chg_cad_m) + '">C$' + m$(c.yoy.chg_cad_m, true) + '</b><em class="' + cl(c.yoy.pct) + '">' + pc(c.yoy.pct) + "</em></div>"; }).join(""); };
    var winners = '<div class="mx-two"><div><h4 class="up">Top winners · ' + PY + " → " + BY + " " + A() + "</h4>" + wl(yo.filter(function (c) { return c.yoy.chg_cad_m > 0; }).slice(0, 5)) + '</div><div><h4 class="dn">Top losers · ' + PY + " → " + BY + " " + A() + "</h4>" + wl(yo.filter(function (c) { return c.yoy.chg_cad_m < 0; }).reverse().slice(0, 5)) + "</div></div>";
    var head = "<tr><th>Commodity</th>" + Y.map(function (y) { return "<th>" + y + "</th>"; }).join("") + "<th>" + PY.slice(2) + "→" + BY.slice(2) + "</th><th>YTD</th><th>5-yr avg volume</th><th>Price vs " + BY + " avg</th><th>Value change vs " + BY + " " + E() + "</th><th>" + (D.projection ? D.projection.year : "") + " projected " + E() + "</th><th>Top destinations</th></tr>";
    var rows = D.segments.filter(function (s) { return SEG === "all" || s.id === SEG; }).map(function (s) {
      var cs = s.commodities.map(byId);
      return '<tr class="mx-sg"><th colspan="' + (Y.length + 8) + '">' + esc(s.name) + " · C$" + m$(s.history[s.history.length - 1].cad_m) + " in " + BY + "</th></tr>" + cs.map(function (c) {
        var P = c.price;
        return '<tr data-mxsel="' + c.id + '" class="' + (SEL === c.id ? "on" : "") + '"><td><b>' + esc(c.name) + "</b></td>" + c.history.map(function (h) { return "<td>" + m$(h.cad_m) + "</td>"; }).join("") +
          '<td class="' + cl(c.yoy && c.yoy.pct) + '">' + (c.yoy ? pc(c.yoy.pct) : "—") + '</td><td class="' + cl(c.ytd.pct) + '">' + (c.ytd.pct != null ? pc(c.ytd.pct) : "—") + "</td><td>" + vol(c.avg_volume_5y, c.vol_unit) + "</td>" +
          "<td>" + (P ? nf(P.current, P.current < 20 ? 2 : 0) + ' <small class="' + cl(P.vs_base_pct) + '">' + pc(P.vs_base_pct) + "</small>" : "—") + '</td><td class="' + cl(c.est && c.est.erosion_usd_m) + '">' + (c.est ? "US$" + m$(c.est.erosion_usd_m, true) + (c.est.method === "avg3" ? ' <small class="mx-m" title="No price benchmark: expected value = 3-year average of actual exports">3-yr avg</small>' : "") : "—") + "</td>" +
          '<td class="' + cl(c.proj && c.proj.pct) + '">' + (c.proj ? "C$" + m$(c.proj.cad_m) + ' <small>' + pc(c.proj.pct) + "</small>" : "—") + "</td>" +
          "<td><small>" + c.dest.slice(0, 3).map(function (d) { return esc(d.c) + " " + (d.share != null ? d.share.toFixed(0) + "%" : ""); }).join(" · ") + "</small></td></tr>"; }).join("");
    }).join("");
    var tbl = '<div class="mx-tw"><table class="mx-t no-tx"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>" + (SEL && byId(SEL) ? '<div id="mxDet">' + detail(byId(SEL)) + "</div>" : "");
    /* FX impact */
    var pr = I.priced.concat(I.avg3 || []).map(byId).filter(function (c) { return c && c.est; }).sort(function (a, b) { return a.est.erosion_usd_m - b.est.erosion_usd_m; });
    var mxE = Math.max.apply(null, pr.map(function (c) { return Math.abs(c.est.erosion_usd_m); })) || 1;
    var fxb = '<div class="mx-fxb">' + pr.map(function (c) { var v = c.est.erosion_usd_m, w = Math.abs(v) / mxE * 50;
      return '<div class="mx-fr" data-mxsel="' + c.id + '"><span>' + esc(c.name) + '</span><span class="mx-fbar"><i class="' + (v >= 0 ? "u" : "d") + '" style="' + (v >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></i></span><b class="' + cl(v) + '">US$' + m$(v, true) + "</b><small>" + (c.est.method === "avg3" ? "3-yr average value vs " + BY : "price " + m$(c.est.price_effect_usd_m, true) + " · vol " + m$(c.est.volume_effect_usd_m, true)) + "</small></div>"; }).join("") + "</div>";
    var cl2 = I.cad_link, ix = cl2.index || [], fxs = {}; (FX.series || []).forEach(function (x) { fxs[x.d] = x.v; });
    var comb = ix.filter(function (x) { return fxs[x.d]; }).map(function (x) { return { d: x.d, m: x.v, f: fxs[x.d] }; });
    var f0 = comb.length ? comb[0].f : 1;
    var link = comb.length > 30 ? '<div class="mx-cg2"><div><h5>Metals index (export-weighted, rebased 100) vs USD/CAD (rebased, inverted: up = stronger CAD)</h5>' + dual(comb, f0) + "</div><div><p class='mx-read'>Over the last " + cl2.days + " trading days the daily correlation between the export-weighted metals index and USD/CAD is <b>" + (cl2.corr != null ? cl2.corr.toFixed(2) : "—") + "</b>" +
      (cl2.beta != null ? "; on average a 1% rise in the index came with a <b>" + Math.abs(cl2.beta).toFixed(3) + "%</b> " + (cl2.beta < 0 ? "fall" : "rise") + " in USD/CAD (" + (cl2.beta < 0 ? "a stronger" : "a weaker") + " loonie)" : "") +
      ". Index weights by " + BY + " export value: " + Object.keys(cl2.weights).map(function (k2) { var c = byId(k2); return esc(c ? c.name : k2) + " " + cl2.weights[k2].toFixed(0) + "%"; }).join(", ") + ".</p>" +
      "<p class='mx-read'>At today's prices the priced commodities would earn <b class='" + cl(I.erosion_usd_m) + "'>US$" + m$(I.erosion_usd_m, true) + "</b> a year " + (I.erosion_usd_m < 0 ? "less" : "more") + " than in " + BY + " (C$" + m$(I.erosion_cad_m, true) + " at " + nf(FX.usdcad, 4) + ")" +
      (I.share_of_exports_pct != null ? ", " + pc(I.share_of_exports_pct, 2) + " of Canada's " + BY + " goods exports" : "") + ". Fewer US dollars to convert means less natural demand for CAD — " + (I.erosion_usd_m < 0 ? "a headwind for the loonie" : "a tailwind for the loonie") + ". This is a historical relationship and a price-only estimate, not a forecast.</p></div></div>" : "";
    var srcs = '<p class="mx-n"><b>Sources.</b> ' + esc(D.sources.trade) + " (fetched " + esc((D.sources.trade_fetched || "").slice(0, 10)) + "; destinations " + esc(D.sources.dest_year || "") + ") · " + esc(D.sources.prices_monthly) + " · " + esc(D.sources.prices_daily) + " · " + esc(D.sources.fx) + " · segments: " + esc(D.sources.groupings) +
      ". C$ values use the Bank of Canada annual/monthly average USD/CAD. Cross-check: NRCan reports C$" + D.totals.nrcan_2025_reference.domestic_exports_cad_bn + "bn domestic mineral exports in 2025 (C$" + D.totals.nrcan_2025_reference.total_incl_reexports_cad_bn + "bn incl. re-exports) across all mineral HS lines; this tracker covers the " + L.length + " commodities above, stages 1–3. " +
      A() + " = actual customs data. " + E() + " = desk estimate. Commodities with a price benchmark: implied value = " + BY + " value × (5-yr avg volume ÷ " + BY + " volume) × (current price ÷ " + BY + " average price). Commodities without one: expected value = average of the last 3 years' actual exports. Full-year projection = actual months so far + the 3-year average monthly run-rate for the months not yet reported. Prices update daily, trade data monthly.</p>";
    return '<section id="mxView" class="tile wide mx"><h2>Canada mineral &amp; metal exports <span class="h2note">— NRCan segments · 5 years · destinations · prices · FX impact · updated ' + esc((D.updated_at || "").slice(0, 10)) + "</span></h2>" +
      kp + segs + winners + '<h3 class="mx-h3">Commodity table <small>C$ exports by year (actual) · click a row for charts, prices and destinations</small></h3>' + tbl +
      '<h3 class="mx-h3">FX earnings impact <small>value change vs ' + BY + " at today's prices, by commodity " + "</small></h3>" + fxb + link + srcs + "</section>";
  }
  function dual(C2, f0) {
    var w = 520, h = 190, pl = 40, pb = 22, n = C2.length, m = C2.map(function (x) { return x.m; }), f = C2.map(function (x) { return f0 / x.f * 100; });
    var all = m.concat(f), mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), sp = mx - mn || 1, X = function (i) { return pl + i / (n - 1) * (w - pl - 8); }, Y = function (v) { return 6 + (h - pb - 6) * (1 - (v - mn) / sp); };
    var p = function (A2, col) { var d = ""; A2.forEach(function (v, i) { d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }); return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.7"/>'; };
    var s = ""; [mn, (mn + mx) / 2, mx].forEach(function (v) { s += '<line x1="' + pl + '" x2="' + w + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="mx-gr"/><text x="' + (pl - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" class="mx-tk" text-anchor="end">' + v.toFixed(0) + "</text>"; });
    s += p(m, "#ffb84d") + p(f, "#38b6c9");
    [0, n - 1].forEach(function (i) { s += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 6) + '" class="mx-tk" text-anchor="' + (i ? "end" : "start") + '">' + C2[i].d + "</text>"; });
    s += '<text x="' + (pl + 4) + '" y="14" class="mx-lg" fill="#ffb84d">■ Metals index ' + m[n - 1].toFixed(1) + '</text><text x="' + (pl + 170) + '" y="14" class="mx-lg" fill="#38b6c9">■ CAD strength (USD/CAD inverted) ' + f[n - 1].toFixed(1) + "</text>";
    return '<svg class="mx-ch" viewBox="0 0 ' + w + " " + h + '">' + s + "</svg>";
  }
  doc.addEventListener("click", function (ev) {
    var t = ev.target; if (!t.closest || !t.closest("#mxView")) return;
    var s = t.closest("[data-mxseg]"); if (s) { SEG = s.getAttribute("data-mxseg"); try { localStorage.setItem("desk.mx.seg", SEG); } catch (e) {} paint(); return; }
    var r = t.closest("[data-mxsel]"); if (r) { var id = r.getAttribute("data-mxsel"); SEL = SEL === id || !id ? null : id; if (SEL) { var c = byId(SEL); if (c && SEG !== "all" && c.seg !== SEG) SEG = c.seg; } try { localStorage.setItem("desk.mx.sel", SEL || ""); } catch (e) {} paint();
      if (SEL) setTimeout(function () { var x = doc.getElementById("mxDet"); if (x) x.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 60); }
  });
  var st = doc.createElement("style");
  st.textContent = "#mxView{grid-column:1/-1}.mx h2{margin-bottom:10px}.mx-m{color:#ffb84d;font-size:10px}.mx-a,.mx-e{display:inline-block;font:700 9px 'IBM Plex Mono',monospace;font-style:normal;padding:0 4px;border-radius:3px;margin-left:4px;vertical-align:1px}.mx-a{color:#3fb97f;border:1px solid rgba(63,185,127,.6)}.mx-e{color:#ffb84d;border:1px solid rgba(255,184,77,.6)}" +
    ".mx-ks{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px}.mx-k{border:1px solid var(--line2);border-radius:8px;padding:10px 12px}.mx-k span{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.mx-k b{display:block;font:600 22px 'IBM Plex Mono',monospace;margin:3px 0}.mx-k small{color:var(--faint);font-size:11.5px}" +
    ".mx .up{color:var(--green)}.mx .dn{color:var(--red)}.mx-segs{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin-bottom:12px}.mx-segs button{all:unset;cursor:pointer;border:1px solid var(--line2);border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;gap:2px}" +
    ".mx-segs button[aria-pressed=true]{border-color:#ffb84d;background:rgba(255,184,77,.08)}.mx-segs b{font-size:12px}.mx-segs small{font:11px 'IBM Plex Mono',monospace;color:var(--muted)}.mx-segs em{font-style:normal}.mx-sp{display:block;margin-top:2px}" +
    ".mx-two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:6px}.mx-two h4{margin:4px 0 6px;font-size:12.5px;letter-spacing:.05em;text-transform:uppercase}.mx-wl{display:grid;grid-template-columns:1fr 110px 70px;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px}" +
    ".mx-wl small{display:block;color:var(--faint);font-size:10.5px}.mx-wl b,.mx-wl em{font:600 12.5px 'IBM Plex Mono',monospace;text-align:right;font-style:normal}.mx-wl:hover{background:rgba(255,255,255,.03)}" +
    ".mx-h3{margin:16px 0 6px;font-size:14px}.mx-h3 small{font-weight:400;color:var(--faint);font-size:12px;margin-left:6px}.mx-tw{overflow-x:auto;border:1px solid var(--line);border-radius:8px}" +
    "table.mx-t{width:100%;border-collapse:collapse;font:12px 'IBM Plex Mono',monospace;white-space:nowrap}table.mx-t th,table.mx-t td{padding:5px 8px;text-align:right;border-bottom:1px solid var(--line)}table.mx-t thead th{color:var(--muted);font-weight:600;font-size:11px;background:var(--panel);position:sticky;top:0}" +
    "table.mx-t td:first-child,table.mx-t th:first-child{text-align:left;position:sticky;left:0;background:var(--panel);z-index:1}table.mx-t td:last-child{text-align:left;white-space:normal;min-width:180px}table.mx-t tbody tr[data-mxsel]{cursor:pointer}table.mx-t tbody tr[data-mxsel]:hover td{background:rgba(255,255,255,.03)}" +
    "table.mx-t tr.on td{background:rgba(255,184,77,.08)!important}table.mx-t tr.mx-sg th{text-align:left;color:#ffb84d;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding-top:12px;background:transparent;position:static}table.mx-t tr.mx-dr td{white-space:normal;text-align:left;background:rgba(0,0,0,.25);position:static}" +
    ".mx-det{padding:12px;margin-top:10px;border:1px solid rgba(255,184,77,.45);border-radius:10px}.mx-dh{display:flex;justify-content:space-between;align-items:center}.mx-dh h4{margin:0;font-size:15px}.mx-dh button{all:unset;cursor:pointer;font-size:12px;color:var(--muted);border:1px solid var(--line2);border-radius:6px;padding:2px 8px}" +
    ".mx-dks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:8px 0}.mx-dk{border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-family:inherit}.mx-dk span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.mx-dk b{display:block;font:600 18px 'IBM Plex Mono',monospace;margin:2px 0}.mx-dk small{font-size:11.5px;color:var(--faint);white-space:normal}.mx-dk small b{display:inline;font:inherit;font-weight:700;margin:0}" +
    ".mx-cg{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mx-cg h5,.mx-cg2 h5{margin:6px 0 2px;font-size:12px;color:var(--muted);font-weight:600}.mx-ch{width:100%;height:auto;display:block}.mx-gr{stroke:var(--line);stroke-dasharray:2 4}.mx-tk{font:10px 'IBM Plex Mono',monospace;fill:var(--faint)}.mx-vl{font:600 10px 'IBM Plex Mono',monospace;fill:var(--ink)}.mx-lg{font:600 11px 'IBM Plex Mono',monospace}" +
    ".mx-dst div{display:grid;grid-template-columns:130px 1fr 44px 70px;gap:8px;align-items:center;font-size:12px;padding:3px 0}.mx-dst i{display:block;height:9px;background:#38b6c9;border-radius:2px}.mx-dst b{font:600 12px 'IBM Plex Mono',monospace;text-align:right}.mx-dst small{color:var(--faint);font-family:'IBM Plex Mono',monospace}" +
    ".mx-fxb{display:grid;gap:4px}.mx-fr{display:grid;grid-template-columns:150px 1fr 110px 200px;gap:10px;align-items:center;font-size:12.5px;cursor:pointer}.mx-fbar{position:relative;height:12px;background:var(--line);border-radius:3px}.mx-fbar:after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--muted)}" +
    ".mx-fbar i{position:absolute;top:0;bottom:0;border-radius:3px}.mx-fbar i.u{background:var(--green)}.mx-fbar i.d{background:var(--red)}.mx-fr b{font:600 12.5px 'IBM Plex Mono',monospace;text-align:right}.mx-fr small{color:var(--faint);font-family:'IBM Plex Mono',monospace}" +
    ".mx-cg2{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-top:10px;align-items:center}.mx-read{font-size:13.5px;line-height:1.55;margin:0 0 8px}.mx-n{font-size:12px;color:var(--faint);line-height:1.5;margin:10px 0 0;white-space:normal}" +
    "#mxView{container-type:inline-size}@container (max-width:900px){.mx-segs{grid-template-columns:repeat(4,1fr)}.mx-ks{grid-template-columns:1fr 1fr}.mx-cg,.mx-cg2,.mx-two{grid-template-columns:1fr}.mx-dks{grid-template-columns:1fr}.mx-fr{grid-template-columns:110px 1fr 90px}.mx-fr small{display:none}}";
  doc.head.appendChild(st);
  root.METALS_UI = { html: html };
  if (doc.getElementById("mxView")) paint();   /* the USD/CAD page rendered before this file loaded */
})(window);
