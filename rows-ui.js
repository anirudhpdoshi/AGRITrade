/* Derivatives parameter rows (Commodities BRD s.6, G2).
   Nine rows under one header. Each shows its headline collapsed and opens its existing panels in place.
   The panels stay as they are; method text moves into a "Detail evidence" expansion (BR-G2-2). */
(function (root) {
  var ROWS = [["cockpit", "Derivatives cockpit"], ["pos", "Positioning KPIs"], ["cftc", "CFTC managed money"], ["opt", "Options data"], ["vol", "Volatility & skew"],
    ["optflow", "Options flow & expirations"], ["flow", "Position flow signal"], ["carry", "Carry & roll"], ["oi", "Open interest by strike"]];
  var UNA = "UNAVAILABLE";
  function n(v) { return v == null || isNaN(v) ? null : Math.round(+v).toLocaleString("en-US"); }
  function sign(v, f) { return (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v)); }
  function strike(w) { return w && w[0] != null ? (+w[0]).toFixed(2) : null; }
  function side(net) { return net == null ? UNA : (net < 0 ? "Net short " : "Net long ") + n(Math.abs(net)); }
  function usd(v) { return v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v); }
  function shortDay(iso) { var p = String(iso || "").split("-"); return p.length === 3 ? new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : ""; }
  function month(m) { return m && m.calls != null ? m.chain + " C " + n(m.calls) + " · P " + n(m.puts) + " · P/C " + m.pcr + " · call wall " + (strike(m.call_wall) || UNA) : null; }

  /* collapsed headline for each row, from the desk's own data; anything missing says UNAVAILABLE */
  function headlines(g, of, fnd) {
    var o = {}, near = g.near || {}, far = g.far || {}, C = g.cftc || [], L = C[C.length - 1], P = C[C.length - 2], K = g.cftc_stats && g.cftc_stats.kpi, V = g.vol || {}, R = g.roll || [];
    o.cockpit = [month(near), month(far)].filter(Boolean).join("  |  ") || UNA;
    o.pos = L ? side(L.net) + (K && K.z52 != null ? " · 52-wk z " + sign(K.z52, function (x) { return x.toFixed(2); }) : "") + (K && K.streak ? " · " + Math.abs(K.streak) + " straight weeks of net " + (K.streak < 0 ? "selling" : "buying") : "") : UNA;
    o.cftc = L ? side(L.net) + (P ? " · WoW " + sign(L.net - P.net, n) : "") + " · report " + shortDay(L.date) : UNA;
    var W = (g.weeklies || [])[0], em = of && of.next_day && of.next_day.em;
    o.opt = [W ? W.label : null, em != null ? "next-session move ±" + (em * 100).toFixed(1) + "¢" : null, strike(near.call_wall) ? "top strikes C " + strike(near.call_wall) + " · P " + strike(near.put_wall) : null].filter(Boolean).join(" · ") || UNA;
    o.vol = V.near ? "IV " + (+V.near.iv).toFixed(1) + "% · HV " + (+V.near.hv).toFixed(1) + "%" + (V.pct && V.pct["52w"] != null ? " · IV percentile (52 wk) " + Math.round(V.pct["52w"]) : "") : UNA;
    var ch = of && (of.chains || []).filter(function (c) { return c.contract === near.contract; })[0], pos = of && of.positioning;
    var pc = ch && ch.prem_c, pp = ch && ch.prem_p, tot = pc != null && pp != null ? pc + pp : null;
    o.optflow = (tot ? "Est. premium " + usd(tot) + " · calls " + Math.round(pc / tot * 100) + "% / puts " + Math.round(pp / tot * 100) + "%" : "Est. premium " + UNA) + (pos && pos.conf ? " · conviction " + pos.conf : "");
    o.flow = UNA;   /* read from the panel itself, so the headline can never disagree with its signal */
    if (R[0] && R[1] && R[0].settle != null && R[1].settle != null) o.carry = R[0].contract + " to " + R[1].contract + " · spread " + sign((R[0].settle - R[1].settle) * 100, function (x) { return x.toFixed(2) + "¢"; }) + (fnd ? " · FND " + fnd(R[0].contract) : ""); else o.carry = UNA;
    o.oi = near.call_wall ? "Call wall " + strike(near.call_wall) + " (" + n(near.call_wall[1]) + " contracts) · put wall " + strike(near.put_wall) + " (" + n(near.put_wall[1]) + " contracts)" : UNA;
    return o;
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { headlines: headlines, ROWS: ROWS }; return; }

  var doc = root.document, GR = ["corn", "soybeans", "wheat"], NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" }, KEY = "desk.rows", open = {};
  try { open = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(open)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* owner rule: a label with no data is hidden, not shown as UNAVAILABLE */
  function clean(s) { return String(s).split("  |  ").map(function (p) { return p.split(" · ").filter(function (x) { return x.indexOf(UNA) < 0; }).join(" · "); }).filter(Boolean).join("  |  "); }
  function subOf(k) { var P = doc.getElementById("panel-" + k); return P && P.querySelector('[data-subpanel="deriv"]'); }

  function evidence(tile) {
    var bits = [].slice.call(tile.querySelectorAll(".stamp, p.note")).filter(function (x) { return !x.closest(".prow-ev"); }); if (!bits.length) return;
    var d = tile.querySelector(":scope > .prow-ev");
    if (!d) { d = doc.createElement("details"); d.className = "prow-ev"; d.innerHTML = "<summary>Detail evidence</summary>"; tile.appendChild(d); }
    bits.forEach(function (b) { b.innerHTML = b.innerHTML.replace(/\b(IBKR|IB) /g, ""); d.appendChild(b); });
  }
  function fmtSp(v) { return v == null || isNaN(v) ? "UNAVAILABLE" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "¢"; }
  function rowsOf(N) { return '<table class="cf-tbl"><thead><tr><th>Session</th><th>Front OI</th><th>Deferred OI</th><th>Roll %</th><th>Spread</th></tr></thead><tbody>' + N.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + Math.round(r[1]).toLocaleString("en-US") + "</td><td>" + Math.round(r[2]).toLocaleString("en-US") + "</td><td>" + (+r[3]).toFixed(1) + "%</td><td>" + fmtSp(r[4]) + "</td></tr>"; }).join("") + "</tbody></table>"; }
  /* BR-CR-5: Spread traceability, grouped in Carry & roll: current pair, next pair, expired-pair history */
  function trace(k, sub) {
    var old = sub.querySelector(":scope > .tr-tile"); if (old) old.remove();
    var G = DATA.grains[k], R = G.roll || [], fl = root.GRAINS && GRAINS.fndLabel; if (!R[0] || !R[1]) return;
    var live = typeof rollData === "function" ? rollData(k) : null, N = live && live.dailyN ? live.dailyN.slice(-6) : [], sp = function (a, b) { return a && b && a.settle != null && b.settle != null ? (a.settle - b.settle) * 100 : null; };
    var h = '<h2>Spread traceability <span class="h2note">— current pair, next pair, expired pairs</span></h2>' +
      '<div class="tr-sec"><h3>Default pair: ' + R[0].contract + " to " + R[1].contract + "</h3>" + (sp(R[0], R[1]) != null ? "Spread " + fmtSp(sp(R[0], R[1])) : "") + (fl && fl(R[0].contract) ? " · " + R[0].contract + " FND " + fl(R[0].contract) : "") + (N.length ? rowsOf(N) : "") + "</div>" +
      (R[2] && sp(R[1], R[2]) != null ? '<div class="tr-sec"><h3>Next pair: ' + R[1].contract + " to " + R[2].contract + "</h3>Spread " + fmtSp(sp(R[1], R[2])) + (fl && fl(R[1].contract) ? " · " + R[1].contract + " FND " + fl(R[1].contract) : "") + "</div>" : "");
    var X = typeof ROLLS !== "undefined" && ROLLS[k];
    if (X && X.front !== R[0].contract && X.def === R[0].contract) { var last = X.dailyN[X.dailyN.length - 1]; h += '<div class="tr-sec"><h3>' + X.front + " to " + X.def + ' <span class="tr-exp">EXPIRED</span> · FND ' + X.stats.fnd + "</h3>History held through " + last[0] + ". Never the default." + rowsOf(X.dailyN.slice(-6)) + "</div>"; }
    var XP = (DATA.rolls_expired && DATA.rolls_expired[k]) || [];
    XP.forEach(function (e) { var F = (e.follow || []).slice(-6); if (!F.length && !(e.rows || []).length) return;
      var isStatic = X && X.front === e.front; if (!isStatic) h += '<div class="tr-sec"><h3>' + e.front + " to " + e.def + ' <span class="tr-exp">EXPIRED</span> · FND ' + e.fnd + "</h3></div>";
      if (F.length) h += '<div class="tr-sec"><h3>' + e.front + " to " + e.def + (e.done ? " · followed to the end" : " · still being followed") + '</h3><table class="cf-tbl"><thead><tr><th>Session</th><th>' + e.front + "</th><th>" + e.def + "</th><th>Spread</th></tr></thead><tbody>" + F.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + (+r[1]).toFixed(4) + "</td><td>" + (+r[2]).toFixed(4) + "</td><td>" + fmtSp((r[1] - r[2]) * 100) + "</td></tr>"; }).join("") + "</tbody></table></div>"; });
    var t = doc.createElement("div"); t.className = "tile wide tr-tile"; t.setAttribute("data-src", "grains_settle"); t.setAttribute("data-sec", "carry"); t.innerHTML = h; sub.appendChild(t);
  }
  function sectionAsOf() {
    var A = root.DATA && DATA.meta && DATA.meta.asof || {}, best = 0;
    ["options", "grains_settle", "cftc_grains", "optflow"].forEach(function (k) { var t = Date.parse(A[k]); if (t > best) best = t; });
    if (!best) return "Section as-of UNAVAILABLE";
    var d = new Date(best), o = { timeZone: "America/New_York" };
    return "Section as-of: " + d.toLocaleString("en-US", Object.assign({ month: "short", day: "numeric" }, o)) + ", " + d.toLocaleString("en-US", Object.assign({ hour: "numeric", minute: "2-digit" }, o)) + " ET";
  }
  function build(k) {
    var sub = subOf(k); if (!sub || !sub.classList.contains("on")) return;   /* the section tags exist only on the open section */
    if (root.SEC) SEC[k + ".deriv"] = "all";       /* the rows replace the one-at-a-time filter */
    [].forEach.call(sub.querySelectorAll(":scope > .prow-h, :scope > .prow-top"), function (x) { x.remove(); });
    var G = root.DATA && DATA.grains && DATA.grains[k]; if (!G) return;
    var H = headlines(G, DATA.optflow && DATA.optflow[k], root.GRAINS && GRAINS.fndLabel);
    var F = sub.querySelector(".fl-tile"), fv = F && F.querySelector(".fl-vv"), fl = F && F.querySelector("li");
    if (fv) H.flow = fv.textContent.trim() + (fl ? " · " + fl.textContent.trim().split(/\.\s/)[0] : "");
    var top = doc.createElement("div"); top.className = "prow-top"; top.setAttribute("data-sec", "*");
    top.innerHTML = "<b>" + NAME[k] + " · Derivatives</b><span>" + sectionAsOf() + "</span>";
    trace(k, sub);
    var kids = [].slice.call(sub.children), frag = doc.createDocumentFragment(), used = [];
    frag.appendChild(top);
    ROWS.forEach(function (r, i) {
      var on = !!open[r[0]], b = doc.createElement("button"), tiles = kids.filter(function (t) { return t.getAttribute("data-sec") === r[0]; });
      b.type = "button"; b.className = "prow-h"; b.setAttribute("data-sec", "*"); b.setAttribute("data-prow", r[0]); b.setAttribute("aria-expanded", on);
      b.innerHTML = '<span class="prow-c" aria-hidden="true">' + (on ? "▾" : "▸") + '</span><span class="prow-n">' + (i + 1) + " · " + esc(r[1]) + '</span><span class="prow-v">' + esc(clean(H[r[0]])) + "</span>";
      frag.appendChild(b);
      tiles.forEach(function (t) { t.classList.toggle("prow-off", !on); evidence(t); frag.appendChild(t); used.push(t); });
    });
    kids.forEach(function (t) { if (used.indexOf(t) < 0) frag.appendChild(t); });
    sub.appendChild(frag);
    sub.classList.add("prow-on");
  }
  function setRow(id, on) {
    open[id] = on; save();
    GR.forEach(function (k) { var sub = subOf(k); if (!sub) return;
      var b = sub.querySelector(':scope > [data-prow="' + id + '"]'); if (b) { b.setAttribute("aria-expanded", on); b.querySelector(".prow-c").textContent = on ? "▾" : "▸"; }
      [].forEach.call(sub.children, function (t) { if (t.getAttribute("data-sec") === id) t.classList.toggle("prow-off", !on); }); });
    if (on && root.DESK_LIVE && DESK_LIVE.paintPills) DESK_LIVE.paintPills();
  }
  var rg = root.renderGrain;
  root.renderGrain = function (k) { var r = rg.apply(this, arguments); build(k); return r; };
  var ss = root.setSub;
  root.setSub = function (p, id) { var r = ss.apply(this, arguments); if (id === "deriv" && GR.indexOf(p) >= 0) build(p); return r; };
  doc.addEventListener("click", function (ev) {
    var t = ev.target; if (!t.closest) return;
    var h = t.closest("[data-prow]"); if (h) { setRow(h.getAttribute("data-prow"), h.getAttribute("aria-expanded") !== "true"); return; }
    if (t.closest("[data-oiv], .toggle button")) { var P = t.closest(".tab-panel"), k = P && P.id.replace("panel-", ""); if (GR.indexOf(k) >= 0) setTimeout(function () { var sub = subOf(k); if (sub) [].forEach.call(sub.children, function (x) { if (x.classList.contains("tile")) evidence(x); }); if (root.DESK_LIVE && DESK_LIVE.paintPills) DESK_LIVE.paintPills(); }, 0); }
  });
  /* the left menu opens the row and goes to it */
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-sec-v]"); if (!b) return;
    var p = b.getAttribute("data-secp"), v = b.getAttribute("data-sec-v"), sub = subOf(p); if (!sub || !sub.classList.contains("on") || v === "guide") return;
    var isRow = ROWS.some(function (r) { return r[0] === v; }); if (!isRow && v !== "all") return;
    ev.stopPropagation();
    if (v === "all") { ROWS.forEach(function (r) { setRow(r[0], false); }); return; }
    setRow(v, true);
    var h = sub.querySelector(':scope > [data-prow="' + v + '"]'); if (h) root.scrollTo({ top: h.getBoundingClientRect().top + root.scrollY - 90, behavior: "smooth" });
  }, true);
  /* some panels load after the page draws (Options flow): put a late arrival into its row */
  var busy = false;
  function settle(k) { if (busy) return; var sub = subOf(k); if (!sub || !sub.classList.contains("on")) return;
    var lastH = null, stray = false; [].forEach.call(sub.children, function (t) { if (t.classList.contains("prow-h")) lastH = t; else if (t.classList.contains("tile") && !t.classList.contains("tr-tile")) { var id = t.getAttribute("data-sec"); if (!id || !lastH || lastH.getAttribute("data-prow") !== id) stray = true; } });
    if (!stray) return; busy = true; if (root.buildSecNav) buildSecNav(k); build(k); if (root.OBSUI) OBSUI.paint(k); setTimeout(function () { busy = false; }, 0); }
  function watch(k) { var sub = subOf(k); if (!sub || sub.__rowsWatch || !root.MutationObserver) return; sub.__rowsWatch = 1; new MutationObserver(function () { settle(k); }).observe(sub, { childList: true }); settle(k); }
  var rg2 = root.renderGrain, ss2 = root.setSub;
  root.renderGrain = function (k) { var r = rg2.apply(this, arguments); watch(k); return r; };
  root.setSub = function (p) { var r = ss2.apply(this, arguments); if (GR.indexOf(p) >= 0) watch(p); return r; };
  GR.forEach(watch);
  GR.forEach(build);
  root.ROWSUI = { build: build };
})(typeof window !== "undefined" ? window : this);
