/* optflow-ui.js — "Options flow & expirations" tile on each grain's Derivatives view (DATA.optflow, scripts/optflow.py).
   Daily tier: expected moves per expiration, strike/expiration rankings, estimated dealer gamma and the gamma flip,
   next-day expected range with its outcome, a record book and historical analogues. Every derived number is labelled an
   estimate; trade-level flow (buyer/seller side, sweeps, blocks, sizes) needs a paid time-and-sales feed and is listed as such. */
(function () {
  "use strict";
  var NAME = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function px(v) { return v == null ? "—" : "$" + (+v).toFixed(4); }
  function ct(v) { return v == null ? "—" : ((v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "¢"); }
  function n0(v) { return v == null ? "—" : Math.round(v).toLocaleString("en-US"); }
  function mm(v) { return v == null ? "—" : (v < 0 ? "−" : "") + "$" + (Math.abs(v) / 1e6).toFixed(1) + "M"; }
  function pc(v, d) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 2 : d) + "%"; }
  function sd(d) { if (!d) return "—"; var p = d.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function k(l, v, s, cls) { return '<div class="of-k"><div class="of-kl">' + l + '</div><div class="of-kv ' + (cls || "") + '">' + v + '</div><div class="of-ks">' + (s || "") + "</div></div>"; }

  /* ---------- 10-second view: top KPIs, strike positioning map, key insights, bottom row, summary ---------- */
  function spark(vals, w, h, col) {
    if (!vals || vals.length < 2) return "";
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), r = hi - lo || 1;
    return '<svg class="od-sp" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none"><polyline fill="none" stroke="' + col + '" stroke-width="2" vector-effect="non-scaling-stroke" points="' +
      vals.map(function (v, i) { return (i / (vals.length - 1) * w).toFixed(1) + "," + (h - 2 - (v - lo) / r * (h - 4)).toFixed(1); }).join(" ") + '"/></svg>';
  }
  function gauge(score) {
    var a = Math.PI * (1 - ((score || 0) + 100) / 200), x = 60 + 44 * Math.cos(a), y = 58 - 44 * Math.sin(a);
    return '<svg viewBox="0 0 120 66" class="od-g"><defs><linearGradient id="odg" x1="0" x2="1"><stop offset="0" stop-color="#e0453a"/><stop offset=".5" stop-color="#e8b93d"/><stop offset="1" stop-color="#3fb97f"/></linearGradient></defs>' +
      '<path d="M10 58 A50 50 0 0 1 110 58" fill="none" stroke="url(#odg)" stroke-width="9" stroke-linecap="round"/><line x1="60" y1="58" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="58" r="5" fill="#fff"/></svg>';
  }
  /* Strike positioning map. Fixed lanes so no label can collide:
       top    spot label · gamma-flip label · premium dots (one row, sized by premium)
       plot   call / put OI bars, support (green) and resistance (orange) boxes, shaded next-day 1σ range, spot and flip lines
       bottom strike · call OI change · put OI change · role tag
     Spot and flip are placed by interpolating between the neighbouring strikes (strikes are unevenly spaced). */
  function smap(PS, F, nd, nc) {
    var S = PS.strikes.filter(function (x) { return Math.abs(x.dist) <= 9; }).sort(function (a, b) { return a.k - b.k; }); if (!S.length) return "";
    var W = 720, L = 46, R = 12, T = 58, PH = 200, H = T + PH + 70, n = S.length, bw = (W - L - R) / n, base = T + PH;
    var mx = Math.max.apply(null, S.map(function (x) { return Math.max(x.coi, x.poi); }).concat([1]));
    var hasP = S.some(function (x) { return x.prem_c || x.prem_p; }), mp = Math.max.apply(null, S.map(function (x) { return (x.prem_c || 0) + (x.prem_p || 0); }).concat([1]));
    function X(i) { return L + i * bw; } function C(i) { return X(i) + bw / 2; } function Y(v) { return T + PH * (1 - v / mx); }
    function xk(k) {
      if (k <= S[0].k) return C(0) - Math.min(bw / 2, (S[0].k - k) / ((S[1] || S[0]).k - S[0].k || 1) * bw);
      for (var i = 0; i < n - 1; i++) if (k <= S[i + 1].k) return C(i) + (k - S[i].k) / (S[i + 1].k - S[i].k) * bw;
      return C(n - 1) + Math.min(bw / 2, (k - S[n - 1].k) / (S[n - 1].k - S[n - 2].k || 1) * bw);
    }
    function kc(v) { var a = Math.abs(v); return (v > 0 ? "+" : "−") + (a >= 1000 ? (a / 1000).toFixed(1) + "k" : a); }
    var sup = S.filter(function (x) { return x.role === "support"; }).sort(function (a, b) { return b.poi - a.poi; })[0], res = S.filter(function (x) { return x.role === "resistance"; }).sort(function (a, b) { return b.coi - a.coi; })[0];
    var g = "";
    [0, .5, 1].forEach(function (f) { var y = Y(mx * f); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="od-gl"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" class="od-ax" text-anchor="end">' + (mx * f >= 1000 ? Math.round(mx * f / 1000) + "K" : Math.round(mx * f)) + "</text>"; });
    if (nd) { var x1 = Math.max(L, xk(nd.lo)), x2 = Math.min(W - R, xk(nd.hi)); if (x2 > x1) g += '<rect x="' + x1 + '" y="' + T + '" width="' + (x2 - x1) + '" height="' + PH + '" class="od-em"><title>next-day 1σ range ' + px(nd.lo) + " – " + px(nd.hi) + "</title></rect>"; }
    S.forEach(function (x, i) {
      var cx = X(i) + bw * 0.15, w = bw * 0.33, hi = x === sup || x === res;
      if (hi) g += '<rect x="' + (X(i) + 3) + '" y="' + T + '" width="' + (bw - 6) + '" height="' + PH + '" rx="6" class="' + (x === sup ? "od-hs" : "od-hr") + '"/>';
      g += '<rect x="' + cx + '" y="' + Y(x.coi) + '" width="' + w + '" height="' + (base - Y(x.coi)) + '" rx="2" class="od-c"><title>' + px(x.k) + " calls " + n0(x.coi) + (x.dc != null ? " (" + (x.dc >= 0 ? "+" : "") + n0(x.dc) + " d/d)" : "") + "</title></rect>";
      g += '<rect x="' + (cx + w + 2) + '" y="' + Y(x.poi) + '" width="' + w + '" height="' + (base - Y(x.poi)) + '" rx="2" class="od-p"><title>' + px(x.k) + " puts " + n0(x.poi) + (x.dp != null ? " (" + (x.dp >= 0 ? "+" : "") + n0(x.dp) + " d/d)" : "") + "</title></rect>";
      if (x.role === "acceleration" || x.role === "magnet") g += '<rect x="' + (X(i) + 2) + '" y="' + (base + 2) + '" width="' + (bw - 4) + '" height="3" fill="#9b5cf6"><title>gamma zone</title></rect>';
      g += '<text x="' + C(i) + '" y="' + (base + 18) + '" class="od-ax' + (hi ? " b" : "") + '" text-anchor="middle">' + x.k.toFixed(x.k >= 10 ? 1 : 2) + "</text>";
      if (x.dc != null && Math.abs(x.dc) >= 100) g += '<text x="' + C(i) + '" y="' + (base + 33) + '" class="od-cc ' + (x.dc > 0 ? "up" : "dn") + '" text-anchor="middle">C ' + kc(x.dc) + "</text>";
      if (x.dp != null && Math.abs(x.dp) >= 100) g += '<text x="' + C(i) + '" y="' + (base + 47) + '" class="od-cp ' + (x.dp > 0 ? "up" : "dn") + '" text-anchor="middle">P ' + kc(x.dp) + "</text>";
      if (hi) g += '<text x="' + C(i) + '" y="' + (base + 63) + '" class="' + (x === sup ? "od-lbs" : "od-lbr") + '" text-anchor="middle">' + (x === sup ? "SUPPORT" : "RESIST.") + "</text>";
      else if (/^broken/.test(x.role)) g += '<text x="' + C(i) + '" y="' + (base + 63) + '" class="od-brk" text-anchor="middle">broken</text>';
      if (hasP && (x.prem_c || x.prem_p)) { var pr = (x.prem_c || 0) + (x.prem_p || 0); g += '<circle cx="' + C(i) + '" cy="' + (T - 9) + '" r="' + (1.5 + 4.5 * Math.sqrt(pr / mp)) + '" class="od-pm"><title>' + px(x.k) + " est. premium " + mm(pr) + "</title></circle>"; }
    });
    var xs = xk(F), sa = xs < L + 60 ? "start" : xs > W - R - 60 ? "end" : "middle";
    g += '<line x1="' + xs + '" x2="' + xs + '" y1="' + (T - 2) + '" y2="' + base + '" class="od-spot"/><text x="' + xs + '" y="14" class="od-spt" text-anchor="' + sa + '">Spot ' + F.toFixed(4) + "</text>";
    if (nc && nc.flip && nc.flip >= S[0].k && nc.flip <= S[n - 1].k) { var xf = xk(nc.flip), fa = xf < L + 70 ? "start" : xf > W - R - 70 ? "end" : "middle";
      g += '<line x1="' + xf + '" x2="' + xf + '" y1="' + (T - 2) + '" y2="' + base + '" class="od-flip"/><text x="' + xf + '" y="30" class="od-flt" text-anchor="' + fa + '">γ flip ' + nc.flip.toFixed(2) + "</text>"; }
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="od-map" role="img" aria-label="Strike positioning map: open interest by strike with support, resistance, spot and gamma flip">' + g + "</svg>";
  }
  function dash(key) {
    var O = window.DATA && DATA.optflow && DATA.optflow[key]; if (!O || !O.positioning) return "";
    var PS = O.positioning, nc = (O.chains || []).filter(function (c) { return c.leg === "near"; })[0] || {}, nd = O.next_day, A = O.analogues || {}, sim = A.similar || {}, F = O.price;
    var g = DATA.grains[key], H = (g.history || []).map(function (h) { return h.s; }).slice(-20), ch1 = H.length ? (F / H[H.length - 1] - 1) * 100 : null;
    var S = PS.strikes.filter(function (x) { return Math.abs(x.dist) <= 9; }), sup = S.filter(function (x) { return x.role === "support"; }).sort(function (a, b) { return b.poi - a.poi; })[0], res = S.filter(function (x) { return x.role === "resistance"; }).sort(function (a, b) { return b.coi - a.coi; })[0];
    var pc = nc.prem_c, pp = nc.prem_p, hasV = nc.has_vol, sc = PS.score || 0, cl = sc > 15 ? "up" : sc < -15 ? "dn" : "neu";
    var lab = PS.score == null ? "Building" : sc >= 25 ? "Bullish" : sc <= -25 ? "Bearish" : "Mixed";
    var top = '<div class="od-top">' +
      '<div class="od-c1"><div class="od-l">Front futures · ' + esc(g.roll && g.roll[0] ? g.roll[0].contract : "") + '</div><div class="od-v">' + px(F) + '</div><div class="' + (ch1 >= 0 ? "up" : "dn") + '">' + (ch1 != null ? (ch1 >= 0 ? "▲ +" : "▼ ") + ch1.toFixed(2) + "% vs settle" : "") + "</div>" + spark(H.concat([F]), 120, 34, "#38b6c9") + "</div>" +
      '<div class="od-c1"><div class="od-l">Est. premium traded</div><div class="od-v">' + (hasV ? mm((pc || 0) + (pp || 0)) : "—") + '</div><div class="od-s">' + (hasV ? "near month · prior session · estimate" : "from the next 8:23 am pull (volume per strike)") + "</div></div>" +
      '<div class="od-c1"><div class="od-l">' + (hasV ? "Est. call premium" : "Bullish-leaning OI") + '</div><div class="od-v up">' + (hasV ? mm(pc) : "+" + n0(PS.bull)) + '</div><div class="od-s">' + (hasV ? "calls" : "calls bought / puts written (inferred)") + "</div></div>" +
      '<div class="od-c1"><div class="od-l">' + (hasV ? "Est. put premium" : "Bearish-leaning OI") + '</div><div class="od-v dn">' + (hasV ? mm(pp) : "+" + n0(PS.bear)) + '</div><div class="od-s">' + (hasV ? "puts" : "puts bought / calls written (inferred)") + "</div></div>" +
      '<div class="od-c1 od-conv ' + cl + '"><div class="od-l">Trader conviction</div>' + gauge(sc) + '<div class="od-v ' + cl + '">' + lab + (PS.score != null ? " " + (sc > 0 ? "+" : "") + sc : "") + '</div><div class="od-s">Confidence: ' + esc(PS.conf || "Low") + " · estimated</div></div></div>";
    var ins = '<div class="od-ins"><div class="od-it">Key insights</div>' +
      (sup ? '<div class="od-i g"><b>Put support ' + px(sup.k) + "</b><span>OI " + n0(sup.poi) + " puts" + (sup.dp ? " (" + (sup.dp > 0 ? "+" : "") + n0(sup.dp) + ")" : "") + (sup.prem_p ? " · prem " + mm(sup.prem_p) : "") + " · touch odds 1d " + (sup.p_touch_1d != null ? sup.p_touch_1d + "%" : "—") + "</span></div>" : "") +
      (res ? '<div class="od-i o"><b>Call resistance ' + px(res.k) + "</b><span>OI " + n0(res.coi) + " calls" + (res.dc ? " (" + (res.dc > 0 ? "+" : "") + n0(res.dc) + ")" : "") + (res.prem_c ? " · prem " + mm(res.prem_c) : "") + " · touch odds 1d " + (res.p_touch_1d != null ? res.p_touch_1d + "%" : "—") + "</span></div>" : "") +
      '<div class="od-i p"><b>' + (PS.adds[0] && PS.adds[0].d > 0 ? "New money at " + px(PS.adds[0].k) : "No large additions") + "</b><span>" + (PS.adds[0] && PS.adds[0].d > 0 ? "+" + n0(PS.adds[0].d) + " contracts since " + sd(PS.prev_date) : "") + (PS.rolls.length ? " · possible roll " + esc(PS.rolls[0]) : "") + "</span></div>" +
      '<div class="od-i b"><b>Dealer gamma ' + (nc.gex >= 0 ? "long → damps moves" : "short → can extend moves") + "</b><span>est. " + mm(nc.gex) + " per 1%" + (nc.flip ? " · flip " + px(nc.flip) : "") + "</span></div>" +
      (nd ? '<div class="od-i v"><b>Expected move ±' + (nd.em * 100).toFixed(1) + "¢ (IV " + nd.iv.toFixed(1) + "%)</b><span>" + px(nd.lo) + " → " + px(nd.hi) + " next session</span></div>" : "") + "</div>";
    var hst = (O.hist || []).filter(function (h) { return h.score != null; });
    var trend = '<div class="od-b"><div class="od-bt">Positioning trend <small>daily</small></div>' + (hst.length > 1 ? spark(hst.map(function (h) { return h.score; }), 220, 60, "#9b8cff") + '<div class="od-s">score per session · ' + hst.length + " sessions" : '<div class="od-s">Builds one point per session (put/call ' + (nc.pcr != null ? nc.pcr.toFixed(2) : "—") + " today)") + "</div></div>";
    var clos = PS.cuts.reduce(function (a, c) { return a - c.d; }, 0), dirn = Math.max(0, PS.bull + PS.bear - PS.hedge), hed = PS.hedge || 0, tot = dirn + hed + clos, pie = "";
    if (tot > 0) { var a0 = 0, parts = [[dirn, "#9b5cf6", "Directional"], [hed, "#38b6c9", "Hedging"], [clos, "#5b6b82", "Closing"]];
      pie = '<svg viewBox="0 0 80 80" class="od-pie">' + parts.map(function (p) { if (!p[0]) return ""; var f = p[0] / tot, a1 = a0 + f * 2 * Math.PI, la = f > 0.5 ? 1 : 0, x0 = 40 + 36 * Math.sin(a0), y0 = 40 - 36 * Math.cos(a0), x1 = 40 + 36 * Math.sin(a1), y1 = 40 - 36 * Math.cos(a1); a0 = a1;
        return f >= 0.999 ? '<circle cx="40" cy="40" r="36" fill="' + p[1] + '"/>' : '<path d="M40 40 L' + x0.toFixed(1) + " " + y0.toFixed(1) + " A36 36 0 " + la + " 1 " + x1.toFixed(1) + " " + y1.toFixed(1) + 'Z" fill="' + p[1] + '"/>'; }).join("") + "</svg>" +
        '<div class="od-lg">' + parts.map(function (p) { return '<span><i style="background:' + p[1] + '"></i>' + p[2] + " " + Math.round(p[0] / tot * 100) + "%</span>"; }).join("") + "</div>"; }
    var intent = '<div class="od-b"><div class="od-bt">Trader intent <small>estimated</small></div><div class="od-pw">' + (pie || '<div class="od-s">Needs two daily snapshots.</div>') + '</div><div class="od-s">From OI and IV change by strike — inferred, not confirmed. Institutional vs retail cannot be estimated from daily data.</div></div>';
    var emb = '<div class="od-b"><div class="od-bt">Expected move &amp; next day</div>' + (nd ? '<div class="od-r"><span>Expected move (ATM IV)</span><b>±' + (nd.em / nd.settle * 100).toFixed(2) + "%</b></div>" + '<div class="od-r"><span>Expected range</span><b>' + px(nd.lo) + " – " + px(nd.hi) + "</b></div>" : "") +
      (sim.n ? '<div class="od-r"><span>Similar sessions next day</span><b class="' + (sim.avg >= 0 ? "up" : "dn") + '">' + (sim.avg >= 0 ? "+" : "") + sim.avg + "% avg · " + sim.p_up + "% up</b></div>" : "") + "</div>";
    var ana = '<div class="od-b"><div class="od-bt">Historical analogue</div><div class="od-r"><span>Similar sessions</span><b>' + (sim.n || 0) + '</b></div><div class="od-r"><span>Next-day move</span><b class="' + ((sim.avg || 0) >= 0 ? "up" : "dn") + '">' + (sim.n ? (sim.avg >= 0 ? "+" : "") + sim.avg + "% avg" : "—") + '</b></div><div class="od-r"><span>Range breach (close)</span><b>' + (sim.n ? sim.p_breach_close + "%" : "—") + '</b></div><div class="od-s">Confidence ' + esc(A.confidence || "Low") + " — past sessions, not a forecast</div></div>";
    var sumr = '<div class="od-sum"><span class="od-sh">⚠ Market structure</span><span>Options activity: <b class="' + cl + '">' + esc(PS.label) + "</b></span><span>Key levels: " + (sup ? "support <b>" + px(sup.k) + "</b>" : "") + (res ? " · resistance <b>" + px(res.k) + "</b>" : "") + "</span>" +
      "<span>Risk: <b>" + (nc.gex < 0 ? "moves can extend" + (res ? " if " + px(res.k) + " breaks" : "") : "moves likely damped") + "</b></span><span class=\"od-mon\">✓ Monitor: " + (res ? px(res.k) : "") + (sup ? " / " + px(sup.k) : "") + " &amp; IV trend</span></div>";
    return '<div class="od">' + top + '<div class="od-mid"><div class="od-mapw"><div class="od-mh"><b>Strike positioning map</b><span><i class="lc"></i>Call OI <i class="lp"></i>Put OI <i class="ls"></i>Support <i class="lr"></i>Resistance <i class="lg"></i>Gamma zone <i class="le"></i>Next-day 1σ · C / P = OI change d/d' + (nc.has_vol ? " · ● est. premium (top row)" : "") + "</span></div>" + smap(PS, F, nd, nc) + "</div>" + ins + "</div>" +
      '<div class="od-bot">' + trend + intent + emb + ana + "</div>" + sumr + "</div>";
  }

  function tile(key) {
    var O = window.DATA && DATA.optflow && DATA.optflow[key]; if (!O) return "";
    var nd = O.next_day, ch = O.chains || [], nc = ch.filter(function (c) { return c.leg === "near"; })[0] || ch[0] || {}, A = O.analogues || {}, H = (O.hist || []).slice().reverse();
    var lastOut = H.filter(function (h) { return h.out; })[0], F = O.price;
    var kp = '<div class="of-kg">' +
      k("Next-day expected range", nd ? px(nd.lo) + " – " + px(nd.hi) : "—", nd ? "±" + (nd.em * 100).toFixed(1) + "¢ (1σ, near IV " + nd.iv.toFixed(1) + "%) from the " + sd(nd.from) + " settle" : "") +
      k("Est. dealer gamma (near)", mm(nc.gex) + " /1%", nc.gex == null ? "" : nc.gex >= 0 ? "long gamma → hedging damps moves" : "short gamma → hedging can extend moves", nc.gex >= 0 ? "up" : "dn") +
      k("Gamma flip (est.)", nc.flip ? px(nc.flip) : "none in ±15%", nc.flip ? ct(nc.flip - F) + " from " + px(F) : "") +
      k("Put/call open interest", nc.pcr != null ? nc.pcr.toFixed(2) : "—", n0(nc.puts_oi) + " puts · " + n0(nc.calls_oi) + " calls") +
      k("Est. premium traded", nc.has_vol ? mm((nc.prem_c || 0) + (nc.prem_p || 0)) : "—", nc.has_vol ? "calls " + mm(nc.prem_c) + " · puts " + mm(nc.prem_p) + " · vol × model value × 5,000 bu" : "volume per strike arrives with the next morning pull") + "</div>";
    var ex = '<table class="of-t"><thead><tr><th>Expiry</th><th>DTE</th><th>ATM IV</th><th>±1σ move</th><th>Expected range</th><th>Call OI</th><th>Put OI</th><th>P/C</th><th>Est. GEX /1%</th><th>Flip</th></tr></thead><tbody>' +
      ch.map(function (c) { return "<tr><td><b>" + esc(c.chain || c.contract) + '</b><small>' + sd(c.expires) + " · " + esc(c.contract || "") + (c.leg === "weekly" ? " · weekly" : "") + "</small></td><td>" + (c.dte != null ? c.dte.toFixed(0) : "—") + "</td><td>" + (c.atm_iv != null ? c.atm_iv.toFixed(1) + "%" : "—") +
        "</td><td>" + (c.em != null ? "±" + (c.em * 100).toFixed(1) + "¢ <small>±" + c.em_pct.toFixed(1) + "%</small>" : "—") + "</td><td>" + (c.lo != null ? px(c.lo) + " – " + px(c.hi) : "—") + "</td><td>" + n0(c.calls_oi) + "</td><td>" + n0(c.puts_oi) + "</td><td>" + (c.pcr != null ? c.pcr.toFixed(2) : "—") +
        '</td><td class="' + (c.gex >= 0 ? "up" : "dn") + '">' + mm(c.gex) + "</td><td>" + (c.flip ? px(c.flip) : "—") + "</td></tr>"; }).join("") + "</tbody></table>";
    var top = nc.top_oi || [], mx = Math.max.apply(null, top.map(function (s) { return Math.max(s.coi, s.poi); }).concat([1]));
    var heat = '<div class="of-hm">' + top.slice().sort(function (a, b) { return b.k - a.k; }).map(function (s) {
      return '<div class="of-hr' + (Math.abs(s.k - F) < 0.051 ? " atm" : "") + '"><span class="of-hk">' + px(s.k) + (s.k > F ? " ↑" : " ↓") + '</span><span class="of-hb"><i class="c" style="width:' + (s.coi / mx * 100).toFixed(0) + '%"></i></span><span class="of-hn">' + n0(s.coi) + 'C</span>' +
        '<span class="of-hb"><i class="p" style="width:' + (s.poi / mx * 100).toFixed(0) + '%"></i></span><span class="of-hn">' + n0(s.poi) + 'P</span><span class="of-hg ' + (s.gex >= 0 ? "up" : "dn") + '">' + mm(s.gex) + "</span>" + (s.voi != null ? '<span class="of-hv">vol/OI ' + s.voi.toFixed(2) + "</span>" : "") + "</div>"; }).join("") + "</div>";
    var val = lastOut ? '<div class="of-val ' + (lastOut.out.breach_close ? "br" : "ok") + '"><b>' + sd(lastOut.d) + " expected " + px(lastOut.lo) + " – " + px(lastOut.hi) + "</b> → " + sd(lastOut.out.d) + " closed " + px(lastOut.out.close) + " (" + pc(lastOut.out.ret) + "), high " + px(lastOut.out.high) + " / low " + px(lastOut.out.low) +
      ' · <span class="of-chip">' + (lastOut.out.breach_close ? "Close outside the range" : "Close inside the range") + '</span> <span class="of-chip">' + (lastOut.out.breach_intraday == null ? "Intraday high/low not available" : lastOut.out.breach_intraday ? "Range touched intraday" : "Range held intraday") + "</span> · realized ÷ implied " + (lastOut.out.realized_vs_implied != null ? lastOut.out.realized_vs_implied.toFixed(2) + "×" : "—") + "</div>" : '<p class="note">The first next-day comparison appears once a recorded session is followed by a settle.</p>';
    var book = '<table class="of-t"><thead><tr><th>Session</th><th>Settle</th><th>IV</th><th>Expected range</th><th>Next close</th><th>Return</th><th>High / low</th><th>Close</th><th>Intraday</th></tr></thead><tbody>' +
      H.slice(0, 10).map(function (h) { var o = h.out; return "<tr><td>" + sd(h.d) + (h.seeded ? ' <small title="Seeded from stored IV history">s</small>' : "") + "</td><td>" + px(h.s) + "</td><td>" + (h.iv != null ? h.iv.toFixed(1) + "%" : "—") + "</td><td>" + px(h.lo) + " – " + px(h.hi) + "</td><td>" + (o ? px(o.close) : '<small>awaiting</small>') +
        '</td><td class="' + (o ? (o.ret >= 0 ? "up" : "dn") : "") + '">' + (o ? pc(o.ret) : "—") + "</td><td>" + (o ? px(o.high) + " / " + px(o.low) : "—") + "</td><td>" + (o ? (o.breach_close ? '<b class="dn">breach</b>' : "inside") : "—") + "</td><td>" + (o && o.breach_intraday != null ? (o.breach_intraday ? '<b class="dn">touched</b>' : "held") : "—") + "</td></tr>"; }).join("") + "</tbody></table>";
    var s = A.similar || {}, a = A.all || {};
    var an = '<div class="of-an"><div><div class="of-kl">Similar sessions <span class="of-conf ' + esc((A.confidence || "Low").toLowerCase()) + '">' + esc(A.confidence || "Low") + " confidence</span></div>" +
      (s.n ? '<div class="of-ar">n = <b>' + s.n + "</b> · next-day avg " + pc(s.avg) + " · median " + pc(s.median) + " · up " + s.p_up + "% / down " + s.p_down + "% · close outside range " + s.p_breach_close + "%" + (s.p_breach_intraday != null ? " · touched intraday " + s.p_breach_intraday + "%" : "") + " · realized ÷ implied " + s.rv_iv.toFixed(2) + "×</div>" : '<div class="of-ar">No similar session in the record book yet.</div>') +
      '<div class="of-ks">' + esc(A.rule || "") + "</div></div><div><div class=\"of-kl\">All recorded sessions</div>" + (a.n ? '<div class="of-ar">n = <b>' + a.n + "</b> · avg " + pc(a.avg) + " · up " + a.p_up + "% · close outside 1σ " + a.p_breach_close + "% (≈32% if moves were normal) · realized ÷ implied " + a.rv_iv.toFixed(2) + "×</div>" : '<div class="of-ar">Builds one session per day.</div>') + "</div></div>";
    var PS = O.positioning, CO = O.conclusion || [], LG = O.ledger || {};
    var RC = { support: ["Potential support", "up"], resistance: ["Potential resistance", "dn"], magnet: ["Price magnet / pin", "mag"], acceleration: ["Acceleration zone", "acc"], weakening: ["Weakening", "neu"], weak: ["Minor", "neu"], "broken support": ["Broken support", "brk"], "broken resistance": ["Broken resistance", "brk"] };
    function dd(d, p) { return d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toLocaleString("en-US") + (p != null ? " <small>" + (p > 0 ? "+" : "") + p + "%</small>" : ""); }
    var posH = PS ? '<h3 class="of-h3">Positioning engine — what participants are doing <span class="h2note">· confirmed OI ' + sd(PS.prev_date) + " → latest pull · activity inferred from OI and IV change</span></h3>" +
      '<div class="of-bias"><div class="of-gauge"><i style="left:' + (50 + (PS.score || 0) / 2) + '%"></i></div><div><b class="' + ((PS.score || 0) > 0 ? "up" : (PS.score || 0) < 0 ? "dn" : "") + '">' + esc(PS.label) + "</b>" + (PS.score != null ? " · score " + (PS.score > 0 ? "+" : "") + PS.score + " of ±100" : "") + ' <span class="of-conf ' + esc((PS.conf || "low").toLowerCase()) + '">' + esc(PS.conf || "Low") + " confidence</span>" + " · " + esc(PS.vol_view) + (PS.iv_chg != null ? " (strike IV " + (PS.iv_chg > 0 ? "+" : "") + PS.iv_chg + " pts)" : "") +
      '<div class="of-ks">' + n0(PS.bull) + " contracts lean bullish (calls bought, puts written) · " + n0(PS.bear) + " lean bearish (puts bought, calls written) — " + (PS.share != null ? PS.share + "% of the chain changed" : "") + (PS.hedge ? " · " + n0(PS.hedge) + " look like downside protection" : "") + (PS.rolls.length ? " · possible rolls: " + esc(PS.rolls.join("; ")) : "") + "</div></div></div>" +
      '<div class="of-kg">' + k("Largest additions", PS.adds.filter(function (a) { return a.d > 0; }).slice(0, 3).map(function (a) { return px(a.k).replace("$", "") + " +" + n0(a.d); }).join(" · ") || "—", "net contracts added since " + sd(PS.prev_date)) +
      k("Largest reductions", PS.cuts.slice(0, 3).map(function (a) { return px(a.k).replace("$", "") + " −" + n0(-a.d); }).join(" · ") || "—", "contracts closed / expired") +
      k("Est. vanna", mm(PS.vanna) + " Δ", "dealer delta change if IV rises 1 vol-point ×100 (est.)") + k("Est. charm", mm(PS.charm) + " Δ/yr", "dealer delta drift from time decay alone (est.)") + "</div>" +
      '<div class="of-scroll"><table class="of-t of-pos"><thead><tr><th>Strike</th><th>From price</th><th>Calls OI (Δ)</th><th>Puts OI (Δ)</th><th>Share</th><th>IV Δ C / P</th><th>Activity (inferred)</th><th>Est. GEX</th><th>Touch odds 1d / expiry</th><th>Hit (20d)</th><th>Role</th><th>Conf.</th></tr></thead><tbody>' +
      PS.strikes.slice().sort(function (a, b) { return b.k - a.k; }).map(function (x) { var r = RC[x.role] || [x.role, "neu"];
        return '<tr title="' + esc(x.why.join(" · ")) + '"><td><b>' + px(x.k) + "</b></td><td>" + (x.dist > 0 ? "+" : "") + x.dist.toFixed(1) + "%" + (x.in_em ? ' <small>inside 1-day range</small>' : "") + "</td><td>" + n0(x.coi) + "<small>" + dd(x.dc, x.dc_pct) + "</small></td><td>" + n0(x.poi) + "<small>" + dd(x.dp, x.dp_pct) + "</small></td><td>" + x.conc.toFixed(1) + "%</td><td>" + (x.divc != null ? (x.divc > 0 ? "+" : "") + x.divc : "—") + " / " + (x.divp != null ? (x.divp > 0 ? "+" : "") + x.divp : "—") +
          "</td><td>" + esc([x.lc && x.lc !== "steady" ? x.lc : "", x.lp && x.lp !== "steady" ? x.lp : ""].filter(Boolean).join(", ") || "steady") + '</td><td class="' + (x.gex >= 0 ? "up" : "dn") + '">' + mm(x.gex) + "</td><td>" + (x.p_touch_1d != null ? x.p_touch_1d + "% / " + x.p_touch + "%" : "—") + "</td><td>" + (x.touch ? "hit " + x.touch + "×" : "—") +
          '</td><td><span class="of-role ' + r[1] + '">' + r[0] + "</span></td><td>" + esc(x.conf) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<div class="of-top"><div><div class="of-kl">Top call open interest</div>' + PS.top_calls.map(function (t) { return px(t[0]).replace("$", "") + " " + n0(t[1]); }).join(" · ") + '</div><div><div class="of-kl">Top put open interest</div>' + PS.top_puts.map(function (t) { return px(t[0]).replace("$", "") + " " + n0(t[1]); }).join(" · ") + "</div></div>" : "";
    var conH = CO.length ? '<h3 class="of-h3">Daily intelligence conclusion</h3><ol class="of-con">' + CO.map(function (c) { return "<li><b>" + esc(c.q) + "</b> " + esc(c.a) + "</li>"; }).join("") + "</ol>" : "";
    var lgH = '<div class="of-kg">' + ["20", "60", "90"].map(function (n) { var L = LG[n]; return k("Ledger · last " + n + " sessions", L ? "n " + L.n + " · outside range " + L.breach_close + "%" : "—", L ? "realized ÷ implied " + L.rv_iv + "×" + (L.dir_n ? " · positioning called direction " + L.dir_hit + "% (n " + L.dir_n + ")" : " · direction calls start with the positioning score") : "builds daily"); }).join("") + "</div>";
    var na = '<details class="of-na"><summary>Not available on the daily tier (needs a paid options time-and-sales feed)</summary>Buyer- vs seller-initiated premium and net premium flow · sweeps, blocks, fragmented and repeated executions · execution count, average/median trade size, largest transactions · institutional- vs retail-sized participant estimates · opening/closing, spread, collar and roll detection · 5/15/30/60-minute accumulation alerts. These need every trade with its size, price and side; the desk sees one daily snapshot of open interest, IV and volume per strike.</details>';
    return '<div class="tile wide of-tile" id="of-' + key + '" data-src="options"><div class="tile-head"><h2>Options flow &amp; expirations — ' + NAME[key] + ' <span class="h2note">· where options money sits, what the market is pricing for the next session, and how often that range has held · <b>daily tier · estimates</b> · ' + esc(new Date(O.asof).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET</span></h2></div>" +
            (window.kbBox && window.KB && KB.grain && KB.grain.optflow ? kbBox(KB.grain.optflow) : "") + dash(key) + '<details class="of-more"><summary>Full detail — daily conclusion, positioning by strike, expirations, record book, analogues</summary>' + kp + conH + posH + '<h3 class="of-h3">Expirations</h3>' + ex + '<h3 class="of-h3">Strike concentration — near month (open interest, est. gamma)</h3>' + heat +
      '<h3 class="of-h3">Next-day check</h3>' + val + '<h3 class="of-h3">Record book</h3>' + book + '<h3 class="of-h3">Historical analogues & forecast ledger</h3>' + an + lgH + na + "</details>" +
      '<p class="stamp">Expected move = futures × ATM implied volatility × √(time to expiry) — options-implied 1σ, not a forecast. Dealer gamma assumes dealers are long calls and short puts (a convention, not observed positioning); premium = volume × Black-76 value × 5,000 bu (no fills are seen). Analogues and probabilities describe past sessions only — they are not certainties.</p></div>';
  }
  /* mount after the open-interest card on the Derivatives view; alerts go to the Feed */
  function mount() {
    ["corn", "wheat", "soybeans"].forEach(function (key) {
      var P = document.getElementById("panel-" + key); if (!P || !P.classList.contains("active")) return;
      var oi = P.querySelector('[id^="oi-"]'); if (!oi) return;
      var anchor = oi.closest(".tile") || oi, ex = P.querySelector("#of-" + key), html = tile(key); if (!html) return;
      if (!ex) { anchor.insertAdjacentHTML("afterend", html); }
      else if (ex._sig !== DATA.meta.asof.optflow) { ex.outerHTML = html; }
      var n = P.querySelector("#of-" + key); if (n) n._sig = DATA.meta.asof.optflow;
    });
  }
  function alerts() {
    if (!window.EVENTS || !EVENTS.log || window.DESK_LOCKED) return;
    ["corn", "wheat", "soybeans"].forEach(function (key) {
      var O = DATA.optflow && DATA.optflow[key]; if (!O || !O.hist) return;
      var H = O.hist, last = H.filter(function (h) { return h.out; }).slice(-1)[0];
      if (last && last.out.breach_close) EVENTS.log("level", "<b>" + NAME[key] + "</b> closed outside the options-implied range (" + sd(last.d) + " ±" + (last.em * 100).toFixed(1) + "¢) — " + pc(last.out.ret), key + ":deriv@#of-" + key, "ofb|" + key + "|" + last.d);
      var PSx = O.positioning;
      if (PSx && PSx.score != null) EVENTS.log("oi", "<b>" + NAME[key] + " options positioning: " + esc(PSx.label) + "</b> (score " + (PSx.score > 0 ? "+" : "") + PSx.score + ") · " + esc(PSx.vol_view) + (PSx.adds[0] && PSx.adds[0].d > 0 ? " · most added at " + PSx.adds[0].k.toFixed(2) + " (+" + n0(PSx.adds[0].d) + ")" : ""), key + ":deriv@#of-" + key, "ofp|" + key + "|" + (PSx.prev_date || "") + "|" + PSx.label);
      (PSx ? PSx.strikes : []).forEach(function (x) { if (/^broken/.test(x.role)) EVENTS.log("level", "<b>" + NAME[key] + " " + x.role + " at " + x.k.toFixed(2) + "</b> — " + n0(x.coi + x.poi) + " contracts of open interest; last close crossed the strike", key + ":deriv@#of-" + key, "ofx|" + key + "|" + x.k + "|" + (O.settle_date || "")); });
      var a = H[H.length - 1], b = H[H.length - 2];
      if (a && b && a.iv && b.iv && a.iv / b.iv - 1 >= 0.1) EVENTS.log("oi", "<b>" + NAME[key] + " expected move expands</b> — near IV " + b.iv.toFixed(1) + "% → " + a.iv.toFixed(1) + "% (next-day ±" + (a.em * 100).toFixed(1) + "¢)", key + ":deriv@#of-" + key, "ofi|" + key + "|" + a.d);
    });
  }
  var t = 0;
  new MutationObserver(function () { if (!t) t = setTimeout(function () { t = 0; try { mount(); } catch (e) {} }, 300); }).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  setInterval(alerts, 30000); setTimeout(alerts, 4000);
  var css = document.createElement("style");
  css.textContent = ".od{margin-top:8px}.od-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.od-c1{position:relative;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow:hidden}" +
    ".od-l{font-size:12.5px;color:var(--muted)}.od-v{font:700 22px 'IBM Plex Mono',monospace;margin:4px 0 2px}.od-s{font-size:11.5px;color:var(--faint)}.od-sp{display:block;width:100%;height:26px;margin-top:4px;opacity:.9}" +
    ".od-conv{border-width:2px;text-align:center}.od-conv.up{border-color:var(--green)}.od-conv.dn{border-color:var(--red)}.od-conv .od-l{text-align:left}.od-conv .od-g{width:110px;display:block;margin:2px auto 0}.od-conv .od-v{margin:0}" +
    ".od-mid{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(250px,1fr);gap:10px;margin-top:10px}.od-mapw,.od-ins,.od-b{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}" +
    ".od-mh{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;font-size:13.5px}.od-mh span{font-size:11.5px;color:var(--muted);display:flex;gap:6px;align-items:center;flex-wrap:wrap}.od-mh i{display:inline-block;width:10px;height:10px;border-radius:2px}.od-mh .lc{background:#3b82f6}.od-mh .lp{background:#8b5cf6}.od-mh .ls{border:2px solid #3fb97f}.od-mh .lr{border:2px solid #f59e0b}.od-mh .lg{background:#9b5cf6;height:4px}" +
    ".od-map{width:100%;height:auto;margin-top:6px}.od-gl{stroke:#1e2a3a}.od-ax{font:11px 'IBM Plex Mono',monospace;fill:#99a8bd}.od-ax.b{fill:#fff;font-weight:700}.od-c{fill:#3b82f6}.od-p{fill:#8b5cf6}.od-hs{fill:rgba(63,185,127,.08);stroke:#3fb97f;stroke-width:2}.od-hr{fill:rgba(245,158,11,.08);stroke:#f59e0b;stroke-width:2}" +
    ".od-lbs{font:700 11px 'Libre Franklin',sans-serif;fill:#3fb97f}.od-lbr{font:700 11px 'Libre Franklin',sans-serif;fill:#f59e0b}.od-up{font:10px 'IBM Plex Mono',monospace;fill:#3fb97f}.od-dn{font:10px 'IBM Plex Mono',monospace;fill:#e0655f}.od-pm{fill:#f5c542;opacity:.85}" +
    ".od-cc,.od-cp{font:600 10px 'IBM Plex Mono',monospace}.od-cc.up,.od-cp.up{fill:#3fb97f}.od-cc.dn,.od-cp.dn{fill:#ff8a84}.od-mh i.le{background:rgba(56,182,201,.35)}" +
    ".od-spot{stroke:#fff;stroke-dasharray:4 4;stroke-width:1.5}.od-spt{font:700 12px 'IBM Plex Mono',monospace;fill:#fff}.od-em{fill:rgba(56,182,201,.07)}.od-emt{font:10px 'IBM Plex Mono',monospace;fill:#7dd8e6}.od-flip{stroke:#9b5cf6;stroke-dasharray:2 3}.od-flt{font:10px 'IBM Plex Mono',monospace;fill:#c9a3ff}.od-brk{font:700 10px 'IBM Plex Mono',monospace;fill:#e0453a}" +
    ".od-it{font-weight:700;font-size:14px;margin-bottom:6px}.od-i{border-left:3px solid;border-radius:4px;padding:6px 8px;margin-bottom:6px;background:rgba(255,255,255,.02);font-size:13px}.od-i b{display:block}.od-i span{color:var(--muted);font-size:12px}.od-i.g{border-color:#3fb97f}.od-i.o{border-color:#f59e0b}.od-i.p{border-color:#9b5cf6}.od-i.b{border-color:#38b6c9}.od-i.v{border-color:#6ea8ff}" +
    ".od-bot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px}.od-bt{font-weight:700;font-size:13.5px;margin-bottom:6px}.od-bt small{font-weight:400;color:var(--faint);margin-left:4px}.od-b .od-sp{position:static;width:100%;height:60px}" +
    ".od-r{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;padding:3px 0}.od-r span{color:var(--muted)}.od-r b{font-family:'IBM Plex Mono',monospace}.od-pw{display:flex;gap:10px;align-items:center}.od-pie{width:78px;height:78px;flex:none}.od-lg{display:flex;flex-direction:column;gap:3px;font-size:12px}.od-lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}" +
    ".od-sum{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center;margin-top:10px;padding:10px 14px;border:1px solid var(--line2);border-radius:10px;background:var(--panel2);font-size:13px}.od-sh{font-weight:700;color:var(--amber)}.od-mon{margin-left:auto;border:1px solid var(--green);color:#9fe0bd;border-radius:14px;padding:3px 12px}" +
    ".of-more{margin-top:12px}.of-more>summary{cursor:pointer;font:600 12.5px 'IBM Plex Mono',monospace;color:#7dd8e6;padding:6px 0}" +
    "@media (max-width:1100px){.od-top{grid-template-columns:repeat(2,1fr)}.od-mid{grid-template-columns:1fr}.od-bot{grid-template-columns:1fr 1fr}}@media (max-width:640px){.od-bot{grid-template-columns:1fr}}" +
    ".of-kg{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:10px 0}.of-k{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 10px}" +
    ".of-kl{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}.of-kv{font:600 17px 'IBM Plex Mono',monospace;margin:3px 0}.of-ks{font-size:12px;color:var(--muted)}" +
    ".of-h3{font-size:13px;margin:14px 0 6px;letter-spacing:.02em}.of-t{width:100%;border-collapse:collapse;font-size:12.5px}.of-t th{font:600 11px 'IBM Plex Mono',monospace;color:var(--faint);text-align:right;padding:5px 6px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.05em}" +
    ".of-t th:first-child,.of-t td:first-child{text-align:left}.of-t td{text-align:right;padding:6px;border-bottom:1px dashed var(--line);font-family:'IBM Plex Mono',monospace}.of-t td small{display:block;color:var(--faint);font-size:11px}" +
    ".of-hm{display:flex;flex-direction:column;gap:3px}.of-hr{display:grid;grid-template-columns:96px 1fr 70px 1fr 70px 70px 90px;gap:6px;align-items:center;font:12px 'IBM Plex Mono',monospace;padding:2px 4px;border-radius:4px}.of-hr.atm{background:rgba(232,163,61,.10)}" +
    ".of-hb{height:9px;background:var(--panel2);border-radius:5px;overflow:hidden}.of-hb i{display:block;height:100%}.of-hb i.c{background:var(--call)}.of-hb i.p{background:var(--put)}.of-hn{color:var(--muted);text-align:right}.of-hg{text-align:right}.of-hv{color:var(--faint);font-size:11px}" +
    ".of-val{padding:9px 12px;border-radius:8px;font-size:13px;line-height:1.55;border:1px solid var(--line)}.of-val.br{border-left:3px solid var(--red)}.of-val.ok{border-left:3px solid var(--green)}.of-chip{display:inline-block;font:600 11px 'IBM Plex Mono',monospace;border:1px solid var(--line2);border-radius:10px;padding:0 7px}" +
    ".of-an{display:grid;grid-template-columns:1fr 1fr;gap:12px}.of-ar{font-size:13px;margin:4px 0;line-height:1.5}.of-conf{margin-left:6px;padding:0 6px;border-radius:8px;font-size:10.5px}.of-conf.low{background:#3a2a10;color:#f6d38f}.of-conf.medium{background:#12283a;color:#bfe3ec}.of-conf.high{background:#10301f;color:#9fe0bd}" +
    ".of-bias{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:center;margin:6px 0 10px;font-size:13.5px}.of-gauge{position:relative;height:10px;border-radius:5px;background:linear-gradient(90deg,var(--red),#3a4556 50%,var(--green))}.of-gauge i{position:absolute;top:-4px;width:4px;height:18px;margin-left:-2px;background:#fff;border-radius:2px}" +
    ".of-scroll{overflow-x:auto}.of-pos{min-width:1080px}.of-pos td small{display:block}.of-role{display:inline-block;font:600 10.5px 'IBM Plex Mono',monospace;padding:1px 6px;border-radius:4px;border:1px solid var(--line2)}.of-role.up{color:var(--green);border-color:var(--green)}.of-role.dn{color:var(--red);border-color:var(--red)}.of-role.mag{color:#c9a3ff;border-color:#c9a3ff}.of-role.acc{color:#f0a35e;border-color:#f0a35e}.of-role.brk{background:var(--red);color:#fff;border-color:var(--red)}" +
    ".of-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;font:12px 'IBM Plex Mono',monospace;color:var(--muted)}.of-con{margin:4px 0 0 18px;padding:0;font-size:13px;line-height:1.55}.of-con b{color:var(--ink)}" +
    ".of-na{margin-top:12px;font-size:12.5px;color:var(--muted)}.of-na summary{cursor:pointer;font:600 12px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    "@media (max-width:900px){.of-an{grid-template-columns:1fr}.of-hr{grid-template-columns:80px 1fr 60px 1fr 60px}.of-hg,.of-hv{display:none}.of-tile .of-t{display:block;overflow-x:auto}}";
  document.head.appendChild(css);
  window.OPTFLOW = { tile: tile, mount: mount };
})();
