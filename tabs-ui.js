/* Remaining tabs (Commodities BRD s.15): a computed tab label and one Observations box per tab, rule-based from each tab's own data. */
(function (root) {
  var doc = root.document, ET = "America/New_York";
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function day(iso) { return new Date(String(iso).length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: String(iso).length === 10 ? "UTC" : ET }); }
  function sym(id, t) { var b = doc.getElementById("tabbtn-" + id), s = b && b.querySelector(".sym"); if (s && t && s.textContent !== t) s.textContent = t; }
  function box(P, id, bullets) { if (!P) return; var old = doc.getElementById(id); if (!bullets.length) { if (old) old.remove(); return; }
    var h = '<div class="tile wide obs-tab" id="' + id + '"><div class="obs-box"><b>OBSERVATIONS</b><ul>' + bullets.slice(0, 3).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul></div></div>";
    if (old && old.outerHTML === h && old.parentNode === P) return; if (old) old.remove();
    var t = doc.createElement("div"); t.innerHTML = h; var first = P.querySelector(".sw-win"); P.insertBefore(t.firstChild, first ? first.nextSibling : P.firstChild); }
  var NAMES = { fed: "Fed", ecb: "ECB", boe: "BoE", boc: "BoC", boj: "BoJ" }, CATS = { ag: "agriculture", energy_fert: "energy and fertilizer", disruption: "disruption", macro_trade: "macro and trade", outlook: "outlook" };

  function intel() { var I = root.INTEL && INTEL._data && INTEL._data(); if (!I || !I.items) return [];
    var now = Date.now(), d24 = I.items.filter(function (i) { return now - Date.parse(i.ts) < 864e5; }), c = {}; d24.forEach(function (i) { c[i.cat] = (c[i.cat] || 0) + 1; });
    var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0], o = [];
    if (d24.length) o.push(d24.length + " items in the last 24 hours, led by " + (CATS[top] || top) + ".");
    var M = (I.indicators || []).filter(function (x) { return x.move && x.move.material; }).sort(function (a, b) { return Math.abs(b.move.z) - Math.abs(a.move.z); })[0];
    if (M) o.push(M.name + " moved " + (M.move.chg_pct > 0 ? "up " : "down ") + Math.abs(M.move.chg_pct).toFixed(2) + "% in " + day(M.move.month + "-15").replace(/ \d+$/, "") + ", the most unusual move among the indicators.");
    var nx = (I.calendar || []).filter(function (x) { return Date.parse(x.date + "T12:00:00Z") > now; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    if (nx) o.push("Next official release: " + nx.what + " on " + day(nx.date) + (/estimated/.test(nx.basis || "") ? " (estimated date)" : "") + ".");
    return o; }
  function brief() { var J = root.BRIEFING && BRIEFING._data && BRIEFING._data(); if (!J || !J.desks) return { n: 0, o: [] }; var all = [];
    Object.keys(J.desks).forEach(function (k) { var S = J.desks[k].sections || {}; Object.keys(S).forEach(function (s) { (S[s] || []).forEach(function (x) { all.push({ t: x.title, n: x.n || 1, d: J.desks[k].name, s: s }); }); }); });
    all.sort(function (a, b) { return b.n - a.n; }); var o = [];
    if (all[0]) o.push("Most widely reported: " + all[0].t + " (" + all[0].n + " outlets).");
    var L = J.legislation, bills = L && L.us && L.us.floor && L.us.floor.items; if (bills && bills.length) o.push(bills.length + " US House floor items this week.");
    return { n: all.length, o: o }; }
  function policy() { var J = root.POLICY && POLICY._data && POLICY._data(); if (!J || !J.stance) return { o: [], next: "" };
    var o = [], now = Date.now(), st = Object.keys(J.stance).map(function (b) { var s = J.stance[b].statement; return s ? [b, s.label] : null; }).filter(Boolean);
    var hk = st.filter(function (x) { return /HAWK/.test(x[1]); }).map(function (x) { return NAMES[x[0]]; }), dv = st.filter(function (x) { return /DOV/.test(x[1]); }).map(function (x) { return NAMES[x[0]]; });
    if (hk.length || dv.length) o.push("Latest statements read " + (hk.length ? "hawkish at " + hk.join(", ") : "") + (hk.length && dv.length ? "; " : "") + (dv.length ? "dovish at " + dv.join(", ") : "") + ".");
    var nx = (J.calendar || []).filter(function (c) { return c.kind === "decision" && Date.parse(c.date + "T23:59:00Z") > now; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    if (nx) o.push("Next decision: " + (NAMES[nx.bank] || nx.bank) + " on " + day(nx.date) + ".");
    return { o: o, next: nx ? (NAMES[nx.bank] || nx.bank) + " " + day(nx.date) : "" }; }
  function treas() { var U = root.DATA && DATA.ust; if (!U) return { o: [] }; var o = [], due = +U.due12_t, tot = +U.marketable_t;
    o.push("$" + due.toFixed(2) + "T of marketable debt matures within 12 months, " + Math.round(due / tot * 100) + "% of the $" + tot.toFixed(2) + "T outstanding.");
    var W = U.wall || {}, k = Object.keys(W).sort(function (a, b) { return W[b] - W[a]; })[0]; if (k) o.push("The heaviest month is " + new Date(k + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) + ".");
    return { o: o, lab: "$" + due.toFixed(2) + "T in 12m" }; }
  var busy = 0;
  function paint() { if (busy) return; busy = 1;
    try { var B = brief(), Pl = policy(), T = treas();
      if (B.n) sym("briefing", B.n + " stories"); if (Pl.next) sym("policy", "next " + Pl.next); if (T.lab) sym("treasury", T.lab);
      var a = doc.querySelector(".tab-panel.active"), id = a && a.id.replace("panel-", "");
      if (id === "intel") box(a, "obs-intel", intel()); if (id === "briefing") box(a, "obs-brief", B.o); if (id === "policy") box(a, "obs-policy", Pl.o); if (id === "treasury") box(a, "obs-treas", T.o);
    } finally { setTimeout(function () { busy = 0; }, 0); } }
  ["intel", "briefing", "policy", "treasury"].forEach(function (k) { var P = doc.getElementById("panel-" + k); if (P && root.MutationObserver) new MutationObserver(function () { if (P.classList.contains("active") && !doc.getElementById({ intel: "obs-intel", briefing: "obs-brief", policy: "obs-policy", treasury: "obs-treas" }[k])) paint(); }).observe(P, { childList: true, attributes: true, attributeFilter: ["class"] }); });
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest(".tab-btn")) setTimeout(paint, 50); });
  setInterval(paint, 60000); paint();
})(typeof window !== "undefined" ? window : this);
