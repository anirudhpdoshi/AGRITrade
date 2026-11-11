/* Market narrative card (chunk 7, G-10): What moved / What confirms / What contradicts / Next catalyst / What would invalidate.
   Every line is a fact taken from the desk's own data, linked to the tile that holds it; the "read" under it is labelled as inference.
   Correlation is never presented as cause. */
(function (root) {
  var doc = root.document, NAME = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(x) { var v = typeof x === "string" ? parseFloat(x.replace(/,/g, "")) : x; return isFinite(v) ? v : null; }
  function c2(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "¢"; }
  function px(v) { return "$" + v.toFixed(v < 20 ? 4 : 2).replace(/0{1,2}$/, ""); }
  function n0(v) { return Math.round(v).toLocaleString("en-US"); }
  function sg(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + n0(Math.abs(v)); }
  function d8(s) { return new Date(String(s).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  function etT(t) { return new Date(t).toLocaleString("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; }

  /* the facts, each with a direction for the price: +1 supportive, -1 pressuring, 0 neutral */
  function signals(k) {
    var D = root.DATA, g = D && D.grains && D.grains[k]; if (!g) return null;
    var f = g.fan || {}, r0 = (g.roll || [])[0] || {}, out = [];
    var last = num(f.intraday && f.intraday[0]) || num(r0.settle), prev = num(r0.prev), hist = g.history || [];
    var five = hist.length > 5 ? hist[hist.length - 6].s : null;
    var mv = { last: last, prev: prev, d1: last != null && prev != null ? last - prev : null, d5: last != null && five != null ? last - five : null,
      when: f.intraday && f.intraday[1], contract: r0.contract || "", settleDate: r0.settle_date };
    /* USDA balance sheet: ending stocks change, current marketing year */
    var w = D.wasde && D.wasde[k];
    if (w && w.new && w.new.rows) { var es = w.new.rows.filter(function (r) { return r[0] === "Ending Stocks"; })[0];
      if (es && es[1] != null && es[2] != null) { var d = es[2] - es[1];
        out.push({ src: "wasde", dir: d < 0 ? 1 : d > 0 ? -1 : 0, fact: "USDA " + w.report + " " + w.new.my + " US ending stocks " + n0(es[2]) + " mil bu vs " + n0(es[1]) + " in " + w.prior_report + " (" + sg(d) + ")",
          read: d < 0 ? "Tighter balance sheet: supportive for price." : d > 0 ? "Looser balance sheet: pressure on price." : "Balance sheet unchanged." }); } }
    /* managed money (CFTC) week-over-week */
    var c = g.cftc || [], cl = c[c.length - 1], cp = c[c.length - 2];
    if (cl && cp) { var dn = cl.net - cp.net;
      out.push({ src: "cftc_grains", dir: Math.abs(dn) < 2000 ? 0 : dn > 0 ? 1 : -1, fact: "Funds (CFTC managed money) net " + sg(cl.net) + " contracts, " + sg(dn) + " in the week to " + d8(cl.date),
        read: Math.abs(dn) < 2000 ? "Funds barely changed their position." : dn > 0 ? "Funds were adding length (buying)." : "Funds were reducing length or adding shorts (selling)." }); }
    /* trend: price vs 20-session average */
    var ma = num(f.ma20);
    if (last != null && ma != null) { var gap = last - ma;
      out.push({ src: "grains_quote", dir: gap > 0 ? 1 : gap < 0 ? -1 : 0, fact: "Price " + px(last) + " is " + c2(gap).replace(/^[+−]/, "") + (gap >= 0 ? " above" : " below") + " the 20-session average (" + px(ma) + ")",
        read: gap > 0 ? "Short-term trend is up." : "Short-term trend is down." }); }
    /* options positioning: put/call open interest ratio */
    var pcr = num(f.pcr);
    if (pcr != null) out.push({ src: "options", dir: pcr < 0.7 ? 1 : pcr > 1.1 ? -1 : 0, fact: "Option put/call open-interest ratio " + pcr.toFixed(2) + " (" + (f.near_expiry || "front") + " options, daily CME snapshot)",
      read: pcr < 0.7 ? "More call than put interest: positioning leans to upside." : pcr > 1.1 ? "More put than call interest: positioning leans to protection." : "Balanced option positioning." });
    /* the dollar: a weaker dollar tends to help US grain exports */
    var dx = D.grain_long && D.grain_long.other && D.grain_long.other.dxy;
    if (dx && dx.length > 1) { var a = dx[dx.length - 2], b = dx[dx.length - 1], dp = (b[1] / a[1] - 1) * 100;
      out.push({ src: "macro", dir: Math.abs(dp) < 0.15 ? 0 : dp < 0 ? 1 : -1, fact: "Dollar index " + b[1].toFixed(2) + " on " + d8(b[0]) + " (" + (dp > 0 ? "+" : dp < 0 ? "−" : "") + Math.abs(dp).toFixed(2) + "% on the day)",
        read: Math.abs(dp) < 0.15 ? "Dollar little changed." : dp < 0 ? "Weaker dollar: usually supportive for US grain exports." : "Stronger dollar: usually a headwind for US grain exports." }); }
    return { mv: mv, sig: out, f: f };
  }

  function catalysts(k) {
    var now = Date.now(), L = [];
    try { (root.usdaEvents ? root.usdaEvents(k, now, 35) : []).forEach(function (e) { if (e.t > now) L.push({ t: e.t, label: e.label, kind: e.kind }); }); } catch (e) {}
    var C = root.DATA && DATA.release_cal, NM = { us_cpi: "US CPI", us_nfp: "US jobs report", us_gdp: "US GDP", ca_cpi: "Canada CPI", us_core_pce: "US PCE inflation", us_ppi: "US PPI", us_retail: "US retail sales", us_policy: "Fed rate decision", ca_policy: "Bank of Canada rate decision" };
    if (C) Object.keys(NM).forEach(function (key) { ((C[key] && C[key].dates) || []).forEach(function (s) { var p = s.split("T"), d = p[0].split("-"), h = (p[1] || "08:30").split(":");
      var t = root.zonedMs ? zonedMs(+d[0], +d[1], +d[2], +h[0], +h[1], "America/Toronto") : Date.parse(s); if (t > now) L.push({ t: t, label: NM[key], kind: "macro" }); }); });
    L.sort(function (a, b) { return a.t - b.t; });
    var seen = {}, top = [], big = null;
    L.forEach(function (e) { if (seen[e.label]) return; seen[e.label] = 1; if (top.length < 3) top.push(e); if (!big && e.kind === "wasde") big = e; });
    if (big && top.indexOf(big) < 0) top.push(big);
    return top;
  }

  function cardHTML(k) {
    var S = signals(k); if (!S || S.mv.last == null) return "";
    var m = S.mv, ref = m.d1 != null && Math.abs(m.d1 / m.last) >= 0.0025 ? m.d1 : m.d5, basis = ref === m.d1 ? "today" : "over 5 sessions", dir = ref > 0 ? 1 : ref < 0 ? -1 : 0;
    var conf = S.sig.filter(function (s) { return dir && s.dir === dir; }), contra = S.sig.filter(function (s) { return dir && s.dir === -dir; });
    var neu = S.sig.filter(function (s) { return !dir || !s.dir; });
    function li(s) { return '<li><span class="nr-fact">' + esc(s.fact) + '</span> <button class="nr-go" data-nrgo="' + k + "|" + s.src + '" title="Open the tile that holds this figure">evidence →</button><span class="nr-read">Read: ' + esc(s.read) + "</span></li>"; }
    function box(cls, h, arr, empty) { return '<div class="nr-b ' + cls + '"><div class="nr-h">' + h + "</div>" + (arr.length ? "<ul>" + arr.map(li).join("") + "</ul>" : '<p class="nr-none">' + empty + "</p>") + "</div>"; }
    var moved = '<div class="nr-b nr-moved"><div class="nr-h">What moved</div><p><b>' + esc(NAME[k] + " " + m.contract) + "</b> " + px(m.last) + (m.when ? " (" + esc(m.when) + ", delayed)" : "") +
      (m.d1 != null ? ' · <span class="' + (m.d1 > 0 ? "up" : m.d1 < 0 ? "dn" : "") + '">' + c2(m.d1) + " vs prior settle</span>" : "") +
      (m.d5 != null ? ' · <span class="' + (m.d5 > 0 ? "up" : m.d5 < 0 ? "dn" : "") + '">' + c2(m.d5) + " over 5 sessions</span>" : "") +
      ' <button class="nr-go" data-nrgo="' + k + '|grains_quote">evidence →</button></p><p class="nr-read">Direction judged ' + basis + ": " + (dir > 0 ? "higher" : dir < 0 ? "lower" : "flat") + ".</p></div>";
    /* what would invalidate: the nearest reference level on the other side of the move */
    var f = S.f, ma = num(f.ma20), pw = f.put_wall && num(f.put_wall[0]), cw = f.call_wall && num(f.call_wall[0]), lv = [];
    if (dir > 0) { if (ma != null && ma < m.last) lv.push(["the 20-session average", ma]); if (pw != null && pw < m.last) lv.push(["the largest put open-interest strike", pw]); lv.sort(function (a, b) { return b[1] - a[1]; }); }
    if (dir < 0) { if (ma != null && ma > m.last) lv.push(["the 20-session average", ma]); if (cw != null && cw > m.last) lv.push(["the largest call open-interest strike", cw]); lv.sort(function (a, b) { return a[1] - b[1]; }); }
    var inval = dir && lv.length ? "A settle " + (dir > 0 ? "back below " : "back above ") + px(lv[0][1]) + " (" + lv[0][0] + ")" + (lv[1] ? ", then " + px(lv[1][1]) + " (" + lv[1][0] + ")" : "") + " would undo the " + (dir > 0 ? "up" : "down") + "-move read." +
      (contra.length > conf.length ? " Note: more evidence currently contradicts the move than confirms it." : "")
      : dir ? "No reference level on the other side of the move in today's data." : "Price is flat; no move to invalidate.";
    var cat = catalysts(k);
    var catH = cat.length ? "<ul>" + cat.map(function (e) { return "<li><b>" + esc(e.label) + "</b> · " + esc(etT(e.t)) + "</li>"; }).join("") + "</ul>" : '<p class="nr-none">No scheduled event in the next 5 weeks.</p>';
    return '<div class="tile wide nr" data-nr-tile="' + k + '"><h2>' + NAME[k] + ' — what the evidence says <span class="h2note">facts from this desk’s data, each linked to its tile; “Read” lines are inference</span></h2>' +
      '<div class="nr-g">' + moved +
      box("nr-ok", dir ? "What confirms the move" : "Supportive / pressuring", dir ? conf : neu.filter(function (s) { return s.dir; }), "Nothing in today’s data lines up with the move.") +
      box("nr-no", "What contradicts it", contra, dir ? "Nothing in today’s data points the other way." : "—") +
      '<div class="nr-b nr-next"><div class="nr-h">Next catalyst</div>' + catH + "</div>" +
      '<div class="nr-b nr-inv"><div class="nr-h">What would invalidate this read</div><p>' + esc(inval) + "</p></div></div>" +
      (dir && neu.length ? '<p class="nr-neu">Neutral today: ' + neu.map(function (s) { return esc(s.fact); }).join(" · ") + "</p>" : "") +
      '<p class="stamp"><b>Correlation, not causation.</b> These are the facts that line up with or against the move; none of them proves why the price moved. Levels are reference points, not forecasts.</p></div>';
  }

  function mount(k) {
    var P = doc.querySelector("#panel-" + k + ' [data-subpanel="overview"]'); if (!P) return;
    var old = P.querySelector("[data-nr-tile]"), h = ""; try { h = cardHTML(k); } catch (e) { h = ""; }
    if (!h) { if (old) old.remove(); return; }
    var d = doc.createElement("div"); d.innerHTML = h; var t = d.firstChild;
    if (old) old.replaceWith(t); else { var fan = P.querySelector('[data-src="grains_quote"]'); if (fan) fan.before(t); else P.prepend(t); }
  }
  root.NARR = { mount: mount, cardHTML: cardHTML, signals: signals };
  if (typeof root.renderGrain === "function") { var _rg = root.renderGrain; root.renderGrain = function (k) { var r = _rg.apply(this, arguments); try { mount(k); } catch (e) {} return r; }; }
  setTimeout(function () { ["corn", "wheat", "soybeans"].forEach(function (k) { try { mount(k); } catch (e) {} }); }, 450);

  /* evidence links: open the tile that holds the figure (switching sub-tab or tab if needed) and flash it */
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-nrgo]"); if (!b) return;
    var p = b.getAttribute("data-nrgo").split("|"), k = p[0], src = p[1], panel = k;
    if (src === "macro") { panel = "macro"; var tb = doc.getElementById("tabbtn-macro"); if (tb) tb.click(); }
    var P = doc.getElementById("panel-" + panel); if (!P) return;
    var el = P.querySelector('[data-src="' + src + '"]:not([data-nr-tile])') || P.querySelector('[data-src2="' + src + '"]');
    if (!el) return;
    var sp = el.closest("[data-subpanel]"); if (sp && !sp.classList.contains("on") && root.setSub) setSub(panel, sp.getAttribute("data-subpanel"));
    setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("nr-flash"); setTimeout(function () { el.classList.remove("nr-flash"); }, 1800); }, 60);
  });

  var css = doc.createElement("style");
  css.textContent = ".nr-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px;margin-top:6px}" +
    ".nr-b{border:1px solid var(--line);border-radius:8px;padding:8px 10px;border-left-width:3px}.nr-moved{border-left-color:#38b6c9}.nr-ok{border-left-color:#3fb97f}.nr-no{border-left-color:#e0655f}.nr-next{border-left-color:#e8b93d}.nr-inv{border-left-color:#8f9db3}" +
    ".nr-h{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}" +
    ".nr-b ul{margin:0;padding-left:16px}.nr-b li{margin:0 0 6px;font-size:13px;line-height:1.4}.nr-b p{margin:0 0 4px;font-size:13px;line-height:1.4}" +
    ".nr-read{display:block;color:var(--muted);font-style:italic;font-size:12px}.nr-none{color:var(--muted)}.nr-neu{font-size:12px;color:var(--muted);margin:6px 0 0}" +
    ".nr-go{font:600 11px 'IBM Plex Sans',sans-serif;background:none;border:0;color:#38b6c9;cursor:pointer;padding:0 2px;text-decoration:underline}" +
    ".nr-flash{outline:2px solid #e8b93d;outline-offset:2px;transition:outline-color .6s}";
  doc.head.appendChild(css);
})(window);
