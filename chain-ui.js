/* chain-ui.js — grain options chain ladder (owner, Nov 22 2026). Grains → Derivatives → "Options chain".
   One table per chain: strike in the centre, calls on the left, puts on the right (mirrored), the futures price as a marker row
   between strikes, in-the-money sides shaded, call / put walls flagged. Filters: chain (near / far), strike range (All, ±20%,
   ±10%, ±5%), hide strikes with no open interest, Greeks on / off.
   Data: the desk's daily CME chain pull (DATA.grains[k].near / .far): per strike call OI, put OI, call IV, put IV, call volume,
   put volume, and the previous pull's OI for the day-on-day change. Option values and Greeks are a Black-76 model on each
   strike's own IV (r = 4%) — not exchange prices; a strike with no IV shows "—" rather than a guessed value. */
(function () {
  "use strict";
  var root = window, doc = document, GR = ["corn", "soybeans", "wheat"];
  var S = { leg: "near", rng: "10", oi: true, gk: false, gx: true };   /* compact by default: the centre column is narrow; Greeks and Full screen add room */
  try { var sv = JSON.parse(localStorage.getItem("desk.chain") || "null"); if (sv) for (var k in sv) S[k] = sv[k]; } catch (e) {}
  function save() { try { localStorage.setItem("desk.chain", JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ncdf(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
  function npdf(x) { return 0.3989423 * Math.exp(-x * x / 2); }
  /* Black-76 on futures: price and Greeks per 1 bushel in $; shown in cents */
  function b76(F, K, T, ivPct, call) {
    if (!ivPct || !(T > 0) || !(F > 0)) return null;
    var r = 0.04, df = Math.exp(-r * T), s = ivPct / 100, sq = Math.sqrt(T), d1 = (Math.log(F / K) + s * s * T / 2) / (s * sq), d2 = d1 - s * sq;
    var px = call ? df * (F * ncdf(d1) - K * ncdf(d2)) : df * (K * ncdf(-d2) - F * ncdf(-d1));
    var delta = call ? df * ncdf(d1) : -df * ncdf(-d1), gamma = df * npdf(d1) / (F * s * sq), vega = df * F * npdf(d1) * sq / 100;
    var theta = (-df * F * npdf(d1) * s / (2 * sq) + r * px) / 365;   /* Black-76 theta per calendar day */
    return { px: px, d: delta, g: gamma, v: vega, t: theta };
  }
  function f(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function kf(v) { return (+v).toFixed(2); }
  function oiF(v) { if (v == null) return "—"; return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "K" : String(v); }
  function usd(v) { var a = Math.abs(v); return "$" + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0)); }
  function sg(v, d) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d); }

  function model(k) {
    var G = root.DATA && DATA.grains && DATA.grains[k]; if (!G) return null;
    var legs = ["near", "far"].filter(function (l) { return G[l] && G[l].rows && G[l].rows.length; }); if (!legs.length) return null;
    var leg = legs.indexOf(S.leg) >= 0 ? S.leg : legs[0], N = G[leg];
    var q = G.quotes && N.contract && G.quotes[N.contract], F = q && q.px ? +q.px : +N.underlying, Fsrc = q && q.px ? "delayed quote " + (q.label || "") : "underlying at chain pull";
    var T = N.expires ? Math.max(0, (Date.parse(N.expires + "T13:15:00-06:00") - Math.floor(Date.now() / 36e5) * 36e5) / (365 * 864e5))   /* time to expiry stepped hourly: values do not re-draw the table every few seconds */ : 0, dte = Math.max(0, Math.ceil(T * 365));
    var prev = {}; ((N.rows_prev && N.rows_prev.rows) || []).forEach(function (r) { prev[r[0]] = r; });
    var rows = N.rows.map(function (r) { var K = +r[0], p = prev[K];
      return { K: K, coi: r[1] || 0, poi: r[2] || 0, civ: r[3], piv: r[4], cvol: r[5], pvol: r[6], dco: p ? (r[1] || 0) - (p[1] || 0) : null, dpo: p ? (r[2] || 0) - (p[2] || 0) : null,
        C: b76(F, K, T, r[3], true), P: b76(F, K, T, r[4], false) }; });
    return { G: G, N: N, leg: leg, legs: legs, F: F, Fsrc: Fsrc, T: T, dte: dte, rows: rows };
  }
  /* gamma bell curve & dealer GEX profile for the strikes shown (owner, Nov 23 2026) */
  function gammaBlock(k, M, L) {
    if (!root.GAMMA_UI || !L.length) return "";
    var N = M.N, F = M.F, iv = +N.iv || null, fb = 0;
    var rows = L.map(function (r) {
      var gc = r.C ? r.C.g : (iv ? b76(F, r.K, M.T, iv, true) || {} : {}).g, gp = r.P ? r.P.g : (iv ? b76(F, r.K, M.T, iv, false) || {} : {}).g;
      if ((!r.C && r.coi) || (!r.P && r.poi)) fb++;
      var cg = gc ? gc * r.coi * 5000 * F * F * 0.01 / 1e6 : 0, pg = gp ? gp * r.poi * 5000 * F * F * 0.01 / 1e6 : 0;
      return { K: r.K, net: cg - pg, civ: r.civ, piv: r.piv, coi: r.coi, poi: r.poi };
    });
    var cum = 0, flip = null; rows.forEach(function (r, i) { var p = cum; cum += r.net; if (i && ((p < 0 && cum >= 0) || (p > 0 && cum <= 0))) flip = r.K; });
    var VH = (M.G.vol_hist || []).map(function (x) { return +x[1]; }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    var nIv = VH.length >= 10 ? VH[Math.floor(VH.length / 2)] : null;
    var em = iv && M.T ? F * iv / 100 * Math.sqrt(M.T) : null;
    return '<div class="oc-gx"><h3 class="oc-gxh">Gamma bell curve &amp; dealer GEX profile <small>' + esc(N.chain || "") + " · " + M.dte + " days to expiry · strikes in the current filter</small></h3>" +
      GAMMA_UI.chart({ spot: F, rows: rows, iv: iv, normalIv: nIv, normalLab: "median of the last " + VH.length + " sessions held", T: M.T, horizon: "to expiry", em: em,
        callWall: N.call_wall && N.call_wall[0], putWall: N.put_wall && N.put_wall[0], flip: flip, kfmt: function (x) { return (+x).toFixed(2); }, sfmt: function (x) { return (+x).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); } }) +
      '<p class="note">GEX per strike = Black-76 gamma (strike IV' + (fb ? "; " + fb + " strike" + (fb > 1 ? "s" : "") + " without an IV use the chain's ATM IV" : "") + ") × OI × 5,000 bu × futures² × 1%, in $ millions; calls count positive and puts negative (dealers assumed long calls, short puts — the usual convention, not a measured position). " +
      "The bell is the gamma of one option struck at each strike, at today's ATM IV and at the normal IV: wider = hedging flows spread over a wider price band. Gamma flip = where cumulative net GEX from the lowest strike changes sign.</p></div>";
  }
  function html(k) {
    var M = model(k); if (!M) return "";
    var N = M.N, F = M.F, lim = S.rng === "all" ? Infinity : +S.rng / 100;
    var L = M.rows.filter(function (r) { return Math.abs(r.K / F - 1) <= lim && (!S.oi || r.coi + r.poi > 0); });
    var maxOI = Math.max.apply(null, L.map(function (r) { return Math.max(r.coi, r.poi); }).concat([1]));
    /* the strike holding the most on each side, among the strikes shown (owner, Nov 22 2026):
       gold = most open interest (contracts) · violet = most volume · cyan = most premium value held (OI × value × 5,000 bu) */
    L.forEach(function (r) { r.cpv = r.C ? r.coi * r.C.px * 5000 : null; r.ppv = r.P ? r.poi * r.P.px * 5000 : null; });
    var top = function (key) { var b = null; L.forEach(function (r) { if (r[key] != null && r[key] > 0 && (!b || r[key] > b[key])) b = r; }); return b ? b.K : null; };
    var HI = { c: { oi: top("coi"), vol: top("cvol"), pv: top("cpv") }, p: { oi: top("poi"), vol: top("pvol"), pv: top("ppv") } };
    var cw = N.call_wall && N.call_wall[0], pw = N.put_wall && N.put_wall[0];
    var atm = L.length ? L.reduce(function (a, b) { return Math.abs(b.K - F) < Math.abs(a.K - F) ? b : a; }).K : null;
    var em = N.iv && M.T ? F * N.iv / 100 * Math.sqrt(M.T) : null;
    var GK = S.gk;
    var cCols = (GK ? ["Vega ¢", "θ ¢/day", "Γ /10¢", "Δ"] : []).concat(["Vol", "OI Δ", "OI", "Prem $", "IV %", "Value ¢"]), pCols = cCols.slice().reverse();
    var head = '<tr class="oc-sides"><th></th><th colspan="' + cCols.length + '">CALLS</th><th class="oc-k">STRIKE</th><th colspan="' + pCols.length + '">PUTS</th></tr>' +
      '<tr><th title="Strike vs futures">M %</th>' + cCols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + '<th class="oc-k">$/bu</th>' + pCols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr>";
    var bar = function (v, side) { var w = Math.round(v / maxOI * 100); return 'style="background:linear-gradient(to ' + (side === "c" ? "left" : "right") + ',rgba(' + (side === "c" ? "63,185,127" : "224,101,95") + ',.22) ' + w + '%,transparent ' + w + '%)"'; };
    var cell = function (r, side, col) {
      var X = side === "c" ? r.C : r.P, iv = side === "c" ? r.civ : r.piv, oi = side === "c" ? r.coi : r.poi, d = side === "c" ? r.dco : r.dpo, vol = side === "c" ? r.cvol : r.pvol;
      switch (col) {
        case "Value ¢": return '<td class="oc-v">' + (X ? f(X.px * 100, 2) : "—") + "</td>";
        case "IV %": return "<td>" + (iv ? f(iv, 2) : "—") + "</td>";
        case "OI": return '<td class="' + (HI[side].oi === r.K ? "oc-hi-oi" : "") + '" ' + bar(oi, side) + ">" + oiF(oi) + "</td>";
        case "Prem $": var pv = side === "c" ? r.cpv : r.ppv; return '<td class="' + (HI[side].pv === r.K ? "oc-hi-pv" : "") + '" title="Premium value held = OI × model value × 5,000 bu">' + (pv == null ? "—" : usd(pv)) + "</td>";
        case "OI Δ": return '<td class="' + (d > 0 ? "up" : d < 0 ? "dn" : "") + '">' + (d == null ? "—" : d === 0 ? "0" : sg(d, 0)) + "</td>";
        case "Vol": return '<td class="' + (HI[side].vol === r.K ? "oc-hi-vol" : "") + '">' + (vol == null ? "—" : vol ? oiF(vol) : "0") + "</td>";
        case "Δ": return "<td>" + (X ? f(X.d, 2) : "—") + "</td>";
        case "Γ /10¢": return "<td>" + (X ? f(X.g * 0.1, 3) : "—") + "</td>";
        case "θ ¢/day": return "<td>" + (X ? f(X.t * 100, 3) : "—") + "</td>";
        case "Vega ¢": return "<td>" + (X ? f(X.v * 100, 2) : "—") + "</td>";
      }
      return "<td></td>";
    };
    var body = "", spotDone = false;
    L.forEach(function (r) {
      if (!spotDone && r.K > F) { spotDone = true; body += spotRow(); }
      var itmC = r.K < F, itmP = r.K > F, tags = (r.K === cw ? '<i class="oc-w c" title="Call wall: most call open interest">CW</i>' : "") + (r.K === pw ? '<i class="oc-w p" title="Put wall: most put open interest">PW</i>' : "");
      body += '<tr class="' + (r.K === atm ? "oc-atm" : "") + '"><td class="oc-m">' + sg((r.K / F - 1) * 100, 1) + "</td>" +
        cCols.map(function (c) { return cell(r, "c", c).replace("<td", '<td' + (itmC ? ' data-itm="1"' : "")); }).join("") +
        '<td class="oc-k">' + kf(r.K) + tags + "</td>" +
        pCols.map(function (c) { return cell(r, "p", c).replace("<td", '<td' + (itmP ? ' data-itm="1"' : "")); }).join("") + "</tr>";
    });
    if (!spotDone) body += spotRow();
    function spotRow() { return '<tr class="oc-spot"><td colspan="' + (cCols.length * 2 + 2) + '"><span>▶ ' + esc(N.contract || "") + " futures " + f(F, 4) + " · " + esc(M.Fsrc) + "</span></td></tr>"; }
    var seg = function (attr, list, on) { return '<div class="gr-slicer" role="group">' + list.map(function (x) { return '<button type="button" ' + attr + '="' + x[0] + '" aria-pressed="' + (String(x[0]) === String(on)) + '">' + x[1] + "</button>"; }).join("") + "</div>"; };
    var legName = function (l) { var n = M.G[l]; return (n.chain || l) + (n.contract ? " · " + n.contract : ""); };
    var tot = L.reduce(function (a, r) { a.c += r.coi; a.p += r.poi; return a; }, { c: 0, p: 0 });
    return '<button type="button" class="oc-full-b" data-oc-full>' + (FULL ? "✕ Close full screen" : "⤢ Full screen") + "</button>" +
      '<h2>Options chain <span class="h2note">— ' + esc(N.chain || "") + " options on " + esc(N.contract || "") + " · " + esc(N.oi_label || "") + "</span></h2>" +
      '<div class="oc-kpis"><div><span>Futures</span><b>' + f(F, 4) + '</b></div><div><span>Expiry</span><b>' + esc(N.expires || "—") + "</b><small>" + M.dte + " days</small></div>" +
      "<div><span>ATM IV</span><b>" + f(N.iv, 2) + "%</b></div><div><span>Expected move to expiry · 1σ</span><b>±" + (em ? f(em, 4) : "—") + "</b><small>" + (em ? f(F - em, 4) + " – " + f(F + em, 4) : "") + "</small></div>" +
      "<div><span>Put / call OI</span><b>" + f(N.pcr, 2) + "</b></div><div><span>Call wall</span><b>" + (cw != null ? f(cw, 2) : "—") + "</b><small>" + (N.call_wall ? oiF(N.call_wall[1]) + " OI" : "") + "</small></div>" +
      "<div><span>Put wall</span><b>" + (pw != null ? f(pw, 2) : "—") + "</b><small>" + (N.put_wall ? oiF(N.put_wall[1]) + " OI" : "") + "</small></div></div>" +
      '<div class="oc-ctl">' + (M.legs.length > 1 ? "<span>Chain</span>" + seg("data-oc-leg", M.legs.map(function (l) { return [l, legName(l)]; }), M.leg) : "<span>Chain</span><b class=\"oc-one\">" + esc(legName(M.leg)) + "</b>") +
      "<span>Strikes</span>" + seg("data-oc-rng", [["all", "All"], ["20", "±20%"], ["10", "±10%"], ["5", "±5%"]], S.rng) +
      "<span>Show</span>" + seg("data-oc-oi", [["1", "With open interest"], ["0", "Every strike"]], S.oi ? "1" : "0") + seg("data-oc-gk", [["1", "Greeks"], ["0", "No Greeks"]], S.gk ? "1" : "0") + seg("data-oc-gx", [["1", "Gamma curve"], ["0", "Ladder only"]], S.gx ? "1" : "0") + "</div>" +
      (S.gx ? gammaBlock(k, M, L) : "") +
      '<div class="oc-leg"><span class="oc-hi-oi">Most open interest</span><span class="oc-hi-vol">Most volume</span><span class="oc-hi-pv">Most premium value held</span><small>per side, among the strikes shown · ' +
        ["c", "p"].map(function (sd) { var H = HI[sd]; return (sd === "c" ? "Calls" : "Puts") + ": OI " + (H.oi != null ? kf(H.oi) : "—") + " · vol " + (H.vol != null ? kf(H.vol) : "—") + " · value " + (H.pv != null ? kf(H.pv) : "—"); }).join(" | ") + "</small></div>" +
      '<div class="tbl-scroll oc-wrap"><table class="oc-t no-tx zm-yes"><thead>' + head + "</thead><tbody>" + (L.length ? body : '<tr><td colspan="' + (cCols.length * 2 + 2) + '" class="na">No strikes in this range.</td></tr>') + "</tbody></table></div>" +
      '<p class="note">' + L.length + " strikes shown · calls OI " + oiF(tot.c) + " · puts OI " + oiF(tot.p) + (M.G[M.leg].note ? " · " + esc(M.G[M.leg].note) : "") + ". OI, OI Δ (vs the previous chain pull), volume and IV are the CME chain pull. " +
      "Value and Greeks are a Black-76 model on each strike's own IV and the futures price above (r = 4%), in cents per bushel — not exchange quotes; a strike without an IV shows “—”. " +
      "Γ = change in Δ for a 10¢ move; θ = value lost per calendar day; Vega = value change per 1 IV point. Shaded side = in the money; bars = open interest.</p>";
  }

  var FULL = false;
  function mount(k) {
    var P = doc.getElementById("panel-" + k), sub = P && P.querySelector('[data-subpanel="deriv"]'); if (!sub) return;
    var t = sub.querySelector(":scope > .oc-tile"), h = html(k);
    if (!h) { if (t) t.remove(); return; }
    var key = h.length + "|" + h.slice(-400);
    if (t && t._k === key) { if (sub.firstElementChild !== t && !t._placed) { sub.insertBefore(t, sub.firstElementChild); t._placed = 1; } return; }
    var fresh = !t;
    if (!t) { t = doc.createElement("div"); t.className = "tile wide oc-tile" + (FULL ? " oc-full" : ""); t.setAttribute("data-src", "options"); }
    var y = root.scrollY; t.innerHTML = h; t._k = key;
    if (fresh) { sub.insertBefore(t, sub.firstElementChild); if (typeof root.buildSecNav === "function") try { buildSecNav(k); } catch (e) {} }
    else root.scrollTo(0, y);
  }
  function tick() {
    GR.forEach(function (k) { var P = doc.getElementById("panel-" + k); if (P && P.classList.contains("active")) mount(k); });
    /* copies placed by other pages (Positioning → Options Chain) */
    doc.querySelectorAll(".oc-tile[data-oc-k]").forEach(function (t) { var h = html(t.getAttribute("data-oc-k")); if (h && t._h !== h) { t.innerHTML = h; t._h = h; } t.classList.toggle("oc-full", FULL); });
  }
  doc.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-oc-leg],[data-oc-rng],[data-oc-oi],[data-oc-gk],[data-oc-gx],[data-oc-full]"); if (!b) return;
    if (b.hasAttribute("data-oc-full")) { FULL = !FULL; doc.querySelectorAll(".oc-tile").forEach(function (t) { t.classList.toggle("oc-full", FULL); t._k = ""; }); doc.documentElement.classList.toggle("oc-lock", FULL); if (FULL) S.gk = true; }
    if (b.hasAttribute("data-oc-leg")) S.leg = b.getAttribute("data-oc-leg");
    if (b.hasAttribute("data-oc-rng")) S.rng = b.getAttribute("data-oc-rng");
    if (b.hasAttribute("data-oc-oi")) S.oi = b.getAttribute("data-oc-oi") === "1";
    if (b.hasAttribute("data-oc-gx")) S.gx = b.getAttribute("data-oc-gx") === "1";
    if (b.hasAttribute("data-oc-gk")) S.gk = b.getAttribute("data-oc-gk") === "1";
    save(); tick();
  });
  doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && FULL) { var b = doc.querySelector(".oc-tile.oc-full [data-oc-full]"); if (b) b.click(); } });
  setInterval(tick, 2000); setTimeout(tick, 1200);

  var st = doc.createElement("style");
  st.textContent =
    ".oc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin:6px 0 10px}.oc-kpis>div{border:1px solid var(--line2);border-radius:8px;padding:5px 9px;min-width:0}" +
    ".oc-tile{position:relative}.oc-full-b{position:absolute;top:12px;right:14px;z-index:3;appearance:none;border:1px solid #d9b46a;background:transparent;color:#d9b46a;border-radius:999px;padding:3px 10px;font:600 11.5px 'IBM Plex Sans',sans-serif;cursor:pointer}.oc-full-b:hover{background:#d9b46a;color:#101825}" +
    ".oc-tile h2{padding-right:120px}.oc-tile.oc-full{position:fixed!important;inset:16px;z-index:9600;overflow:auto;margin:0!important;max-width:none!important;box-shadow:0 20px 60px rgba(0,0,0,.6);background:var(--panel,#0b1016)}.oc-tile.oc-full .oc-wrap{max-height:calc(100vh - 330px)}html.oc-lock{overflow:hidden}" +
    ".oc-kpis span{display:block;font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.oc-kpis b{font:600 14px 'IBM Plex Mono',monospace;color:var(--ink)}.oc-kpis small{display:block;font:11px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".oc-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-bottom:10px}.oc-ctl>span{font:600 11px 'IBM Plex Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.oc-one{font:600 12.5px 'IBM Plex Mono',monospace}" +
    ".oc-wrap{max-height:640px;overflow:auto;border:1px solid var(--line2);border-radius:8px}" +
    "table.oc-t{border-collapse:separate;border-spacing:0;width:100%;font:12px 'IBM Plex Mono',monospace;display:table!important}table.oc-t thead{display:table-header-group!important}table.oc-t tbody{display:table-row-group!important}" +
    "table.oc-t th{position:sticky;top:0;z-index:2;background:var(--panel,#0b1016);font-size:10.5px;font-weight:600;color:var(--muted);padding:5px 7px;text-align:right;border-bottom:1px solid var(--line2);white-space:nowrap}" +
    "table.oc-t tr.oc-sides th{top:0;text-align:center;letter-spacing:.14em;color:var(--ink)}table.oc-t tr:nth-child(2) th{top:24px}" +
    "table.oc-t td{padding:4px 7px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}table.oc-t td[data-itm]{background-color:rgba(56,182,201,.06)}" +
    "table.oc-t .oc-k{text-align:center;font-weight:700;color:var(--ink);background:rgba(217,180,106,.08);border-left:1px solid var(--line2);border-right:1px solid var(--line2);min-width:74px}" +
    "table.oc-t td.oc-m{color:var(--faint);text-align:left}table.oc-t td.oc-v{color:var(--ink);font-weight:600}table.oc-t td.up{color:var(--green)}table.oc-t td.dn{color:var(--red)}table.oc-t td.na{text-align:center;color:var(--muted)}" +
    "table.oc-t tr.oc-atm td.oc-k{background:#d9b46a;color:#101825}table.oc-t tr:hover td{background-color:rgba(255,255,255,.04)}" +
    "table.oc-t tr.oc-spot td{padding:3px 8px;text-align:center;background:rgba(217,180,106,.14);border-top:1px solid #d9b46a;border-bottom:1px solid #d9b46a;color:#d9b46a;font-weight:600}" +
    ".oc-w{font-style:normal;font:700 9px 'IBM Plex Mono',monospace;margin-left:4px;padding:0 3px;border-radius:3px;vertical-align:1px}.oc-w.c{background:rgba(63,185,127,.25);color:#3fb97f}.oc-w.p{background:rgba(224,101,95,.25);color:#ff8a84}" +
    "table.oc-t tr.oc-atm td.oc-k .oc-w{background:#101825}" +
    "table.oc-t td.oc-hi-oi{box-shadow:inset 0 0 0 2px #e8b93d;color:#e8b93d!important;font-weight:700}table.oc-t td.oc-hi-vol{box-shadow:inset 0 0 0 2px #b18cff;color:#c9a3ff!important;font-weight:700}table.oc-t td.oc-hi-pv{box-shadow:inset 0 0 0 2px #38b6c9;color:#7dd8e6!important;font-weight:700}" +
    ".oc-gx{border:1px solid var(--line2);border-radius:8px;padding:8px 10px 6px;margin:0 0 12px}.oc-gxh{margin:0 0 6px;font:600 13px 'IBM Plex Sans',sans-serif;color:var(--ink)}.oc-gxh small{font-weight:400;color:var(--muted);margin-left:6px}" +
    ".oc-leg{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:-2px 0 8px;font-size:12px}.oc-leg span{padding:1px 8px;border-radius:4px;font-weight:600}.oc-leg span.oc-hi-oi{border:2px solid #e8b93d;color:#e8b93d}.oc-leg span.oc-hi-vol{border:2px solid #b18cff;color:#c9a3ff}.oc-leg span.oc-hi-pv{border:2px solid #38b6c9;color:#7dd8e6}.oc-leg small{color:var(--muted);font:11px 'IBM Plex Mono',monospace}";
  doc.head.appendChild(st);
  root.CHAIN_UI = { html: html, model: model, tick: tick };
})();
