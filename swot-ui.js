/* Intel Brief and US Brief SWOT windows (Commodities BRD s.12-13). Rule-based, from the desk's own data only.
   Each event is tagged at announcement; price since then marks it played out, or moves it to another bucket when
   price disproves the tag (SW-1 to SW-5). A horizon with no verified price is hidden, never estimated. */
(function (root) {
  var MAT = 1;   /* % move against the tag that reclassifies it (Q8: owner may change) */
  function p2(n) { return n < 10 ? "0" + n : "" + n; }
  function addDays(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addMonth(iso) { var p = iso.split("-").map(Number), y = p[0], m = p[1] + 1; if (m > 12) { m = 1; y++; } var last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return y + "-" + p2(m) + "-" + p2(Math.min(p[2], last)); }
  /* closes: [[YYYY-MM-DD, price]] ascending; ct: close time "HH:MM" ET; ann: "YYYY-MM-DDTHH:MM" ET */
  function track(closes, ct, ann) {
    var S = closes.map(function (c) { return { t: c[0] + "T" + ct, d: c[0], v: c[1] }; }), before = null, ad = ann.slice(0, 10);
    S.forEach(function (c) { if (c.t < ann) before = c; });
    if (!before) return null;
    var first = function (ok) { for (var i = 0; i < S.length; i++) if (ok(S[i])) return S[i]; return null; };
    var H = { day: first(function (c) { return c.t > ann; }), week: first(function (c) { return c.d >= addDays(ad, 7) && c.t > ann; }), month: first(function (c) { return c.d >= addMonth(ad) && c.t > ann; }) };
    var o = { p0: before, last: S[S.length - 1] };
    ["day", "week", "month"].forEach(function (h) { var x = H[h]; o[h] = x ? { d: x.d, v: x.v, pct: (x.v / before.v - 1) * 100, chg: x.v - before.v } : null; });
    return o;
  }
  /* SW-2 / SW-3 / SW-4 on the active horizon */
  var MOVE = { Strength: "Threat", Weakness: "Opportunity", Threat: "Opportunity", Opportunity: "Threat" };
  function judge(item, h) {
    var T = item.tr, up = item.dir;   /* dir: +1 tag expects price up, -1 down, 0 no direction */
    var o = { bucket: item.bucket, status: "", moved: null };
    if (!T || !up) return o;
    var done = ["day", "week", "month"].filter(function (x) { return T[x]; }), sg = done.map(function (x) { return T[x].pct > 0 ? 1 : T[x].pct < 0 ? -1 : 0; });
    if (sg.length > 1 && sg.some(function (s) { return s !== sg[0]; })) { o.status = "Mixed horizons"; return o; }
    var c = T[h]; if (!c) return o;
    if (c.pct * up > 0) o.status = "Played out - " + h;
    /* the box stays the item's own fundamental read (strong export sales stay a Strength); a price that went the other way is a badge, not a move (UI-FIX-11) */
    else if (-c.pct * up >= MAT) { o.moved = { from: item.bucket, to: MOVE[item.bucket], pct: c.pct, d: c.d }; o.status = "Price disagreed - " + h; }
    else o.status = "Not played out - " + h;
    return o;
  }
  /* ---------- Intel Brief items, per commodity ---------- */
  var NM = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
  function n0(v) { return Math.round(v).toLocaleString("en-US"); }
  function day(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  function intelItems(D, k, now) {
    var G = D.grains && D.grains[k]; if (!G) return [];
    var closes = (G.history || []).map(function (h) { return [String(h.d).slice(0, 10), h.s]; }), out = [], add = function (it) { it.tr = it.ann ? track(closes, "14:20", it.ann) : null; it.contract = (G.roll && G.roll[0] || {}).contract; out.push(it); };
    var W = (D.exports && D.exports[k] && D.exports[k].weeks) || [];
    W.forEach(function (w, i) { if (i < W.length - 4 || w[2] == null) return; var tag, why, lo = w[3], hi = w[4];
      if (lo != null && hi != null) { tag = w[2] < lo ? -1 : w[2] > hi ? 1 : 0; why = n0(w[2]) + " t against a trade range of " + n0(lo) + " to " + n0(hi); }
      else { var P = W.slice(Math.max(0, i - 4), i).map(function (x) { return x[2]; }).filter(function (x) { return x != null; }); if (P.length < 2) return; var av = P.reduce(function (a, b) { return a + b; }, 0) / P.length; tag = w[2] < av * 0.9 ? -1 : w[2] > av * 1.1 ? 1 : 0; why = n0(w[2]) + " t against a prior " + P.length + "-week average of " + n0(av); }
      add({ id: "exp-" + w[0], label: "Export sales, week to " + day(w[0]) + (tag < 0 ? ": low" : tag > 0 ? ": strong" : ": in line"), why: why, ann: w[1] + "T08:30", annDay: w[1], dir: tag, tag: tag < 0 ? "Negative" : tag > 0 ? "Positive" : "Mixed", bucket: tag < 0 ? "Weakness" : tag > 0 ? "Strength" : "Opportunity" }); });
    var C = G.cftc || [];
    C.forEach(function (r, i) { if (i < C.length - 4 || i < 1) return; var d = r.net - C[i - 1].net; if (!d) return; var rel = addDays(r.date, 3);
      if (rel > now.slice(0, 10)) return;
      add({ id: "cftc-" + r.date, label: "CFTC: funds " + (d < 0 ? (r.net > 0 ? "cut longs" : "added shorts") : (r.net < 0 ? "covered shorts" : "added longs")) + ", report " + day(r.date), why: "Managed-money net " + (d < 0 ? "fell " : "rose ") + n0(Math.abs(d)) + " to " + n0(r.net) + " · scheduled Friday release", ann: rel + "T15:30", annDay: rel, dir: d < 0 ? -1 : 1, tag: d < 0 ? "Negative" : "Positive", bucket: d < 0 ? "Weakness" : "Strength" }); });
    var Wa = D.wasde && D.wasde[k], E = Wa && Wa["new"] && Wa["new"].rows.filter(function (r) { return r[0] === "Ending Stocks"; })[0];
    if (E && E[1] != null && E[2] != null && E[1] !== E[2]) add({ id: "wasde-" + Wa.report, label: "WASDE " + Wa.report + ": " + Wa["new"].my + " ending stocks " + (E[2] < E[1] ? "cut" : "raised"), why: n0(E[1]) + " to " + n0(E[2]) + " mil bu · release time not held, so price is not tracked", ann: null, dir: E[2] < E[1] ? 1 : -1, tag: E[2] < E[1] ? "Positive" : "Negative", bucket: E[2] < E[1] ? "Strength" : "Weakness" });
    var cal = typeof USDA_WASDE !== "undefined" ? USDA_WASDE : [], nx = cal.filter(function (x) { return x + "T12:00" > now; })[0];
    if (nx) out.push({ id: "up-wasde", label: "WASDE " + day(nx) + ", 12:00 PM ET", why: "Tagged on release, never before", upcoming: true, bucket: "Opportunity", tag: "" });
    return out;
  }
  /* ---------- US Brief rows: one tag per target ---------- */
  var GROW = ["us_gdp", "ca_gdpq", "ca_gdp", "us_nfp", "ca_emp", "us_ism", "ca_ivey", "us_retail"], LAB = ["us_ur", "ca_ur"], INF = ["us_cpi", "ca_cpi"];
  function usRows(D, now) {
    var M = {}, out = []; (D.macro || []).forEach(function (r) { M[r.key] = r; });
    var REL = {}; ((D.fx && D.fx.releases) || []).forEach(function (r) { if (r.released) REL[r.key] = r; });
    var fxc = (D.fx && D.fx.closes) || [];
    function fmt(r, v, dp) { return (v > 0 && r.unit === "%" && r.measure ? "+" : "") + (+v).toFixed(dp) + (r.unit === "%" ? "%" : r.unit === "K" ? "K" : ""); }
    GROW.concat(LAB, INF).forEach(function (key) { var r = M[key]; if (!r || r.value == null || r.prior == null || r.value === r.prior) return;
      var dp = Number((+r.value).toFixed(r.dec)) === Number((+r.prior).toFixed(r.dec)) ? r.dec + 2 : r.dec, us = r.group === "us", d = r.value > r.prior ? 1 : -1, kind = INF.indexOf(key) >= 0 ? "inf" : LAB.indexOf(key) >= 0 ? "lab" : "grow", good = kind === "lab" ? -d : d;
      var cty = us ? "US" : "Canada", gdp = kind === "inf" ? "-" : good > 0 ? "Positive" : "Negative", fx = kind === "inf" ? (us ? d : -d) : (us ? good : -good);
      var bucket = kind === "inf" ? (d > 0 ? "Threat" : "Opportunity") : good > 0 ? "Strength" : "Weakness";
      var rel = REL[key] || (key === "us_ur" && REL.us_nfp), ann = rel && String(rel.period).slice(0, 3) === String(r.period).slice(0, 3) ? rel.released.slice(0, 16) : null;
      out.push({ id: key, cty: r.group, label: (us ? "US " : "Canada ") + r.name + " " + r.period + " " + fmt(r, r.value, dp) + " (prior " + fmt(r, r.prior, dp) + ")", why: ann ? "" : "Release time not held, so USD/CAD is not tracked",
        us: us ? gdp : "-", ca: us ? "-" : gdp, fx: fx > 0 ? "Up pressure" : "Down pressure", dir: fx, ann: ann, cm: fx > 0 ? "C$ grain prices up" : "C$ grain prices down", bucket: bucket, bucketCty: cty, tr: ann ? track(fxc, "17:00", ann) : null }); });
    var E = ((D.fx && D.fx.energy) || []).filter(function (e) { return /^WTI/.test(e.name); })[0];
    if (E && E.pct) out.push({ id: "wti", cty: "ca", label: "WTI " + (E.pct > 0 ? "+" : "−") + Math.abs(E.pct).toFixed(2) + "% to $" + (+E.last).toFixed(2), why: "A price move, not an event, so it is not tracked", us: "-", ca: E.pct < 0 ? "Negative" : "Positive", fx: E.pct < 0 ? "Up pressure" : "Down pressure", cm: "Corn: Mixed (ethanol demand vs input costs)", dir: 0, bucket: E.pct < 0 ? "Threat" : "Opportunity", bucketCty: "Canada / CAD" });
    ((D.fx && D.fx.rates) || []).forEach(function (r) { if (r.us == null || r.ca == null || r.sp == null) return; var imp = Math.round((r.us - r.ca) * 1000) / 10; if (Math.abs(r.sp - imp) <= 1) return;
      out.push({ id: "dq-" + r.t, cty: "us", flag: true, label: "Data check: US–CA " + r.t + " spread " + (+r.sp).toFixed(1) + " bp does not reconcile to " + imp.toFixed(1) + " bp from its own yield rows", why: "Flagged, not judged (BR-UB-2): fix the source before reading a verdict", us: "Data flag", ca: "Data flag", fx: "Data flag", cm: "-", dir: 0, bucket: "Threat", bucketCty: "data quality" }); });
    var U = D.ust; if (U && U.due12_t) out.push({ id: "wall", cty: "us", risk: true, label: "Risk: Treasury wall, $" + (+U.due12_t).toFixed(2) + "T maturing in 12 months", why: "A risk, not an event (BR-UB-3)", us: "Negative", ca: "-", fx: "Mixed", dir: 0, bucket: "Threat", bucketCty: "US" });
    var up = [], RC = D.release_cal || {}; [["us_cpi", "US CPI"], ["us_nfp", "US jobs report"], ["us_gdp", "US GDP"]].forEach(function (x) { var c = RC[x[0]], nx = c && (c.dates || []).filter(function (t) { return t > now; })[0]; if (nx) up.push({ id: "up-" + x[0], cty: "us", label: x[1] + " " + day(nx.slice(0, 10)), at: nx, upcoming: true }); });
    var F = D.fx && D.fx.policy && D.fx.policy.fed && D.fx.policy.fed[0]; if (F && F.meeting > now.slice(0, 10)) up.push({ id: "up-fed", cty: "us", label: "Fed decision " + day(F.meeting), at: F.meeting + "T14:00", upcoming: true });
    up.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return { rows: out, upcoming: up };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { track: track, judge: judge, intelItems: intelItems, usRows: usRows, addMonth: addMonth }; return; }

  /* ---------- UI ---------- */
  var doc = root.document, ORDER = ["corn", "soybeans", "wheat"], V = { k: null, h: "week", f: "both" };
  try { var sv = JSON.parse(localStorage.getItem("desk.swot") || "{}"); if (sv.h) V.h = sv.h; if (sv.f) V.f = sv.f; } catch (e) {}
  function save() { try { localStorage.setItem("desk.swot", JSON.stringify({ h: V.h, f: V.f })); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nowET() { var d = new Date(), f = function (o) { return d.toLocaleString("en-CA", Object.assign({ timeZone: "America/Toronto" }, o)); }; return f({ year: "numeric", month: "2-digit", day: "2-digit" }) + "T" + f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  function grain() { if (V.k) return V.k; try { var g = localStorage.getItem("desk.grain"); if (ORDER.indexOf(g) >= 0) return g; } catch (e) {} return "corn"; }
  function seg(attr, list, on) { return '<div class="gr-slicer" role="group">' + list.map(function (x) { return '<button type="button" ' + attr + '="' + x[0] + '" aria-pressed="' + (x[0] === on) + '">' + x[1] + "</button>"; }).join("") + "</div>"; }
  function money(v, fx) { return fx ? (+v).toFixed(4) : (v * 100).toFixed(2) + "¢"; }
  function chg(c, fx) { var s = c.chg > 0 ? "+" : c.chg < 0 ? "−" : ""; return (fx ? s + (Math.abs(c.chg) * 1e4).toFixed(0) + " pips" : s + (Math.abs(c.chg) * 100).toFixed(2) + "¢") + " · " + s + Math.abs(c.pct).toFixed(2) + "%"; }
  function expand(it, fx) {
    var T = it.tr, L = []; if (it.why) L.push(esc(it.why));
    if (T) { L.push("Price at announcement: " + money(T.p0.v, fx) + " (" + day(T.p0.d) + " close)");
      ["day", "week", "month"].forEach(function (h) { var c = T[h]; if (c) L.push("<b>" + h[0].toUpperCase() + h.slice(1) + "</b>: " + money(c.v, fx) + " on " + day(c.d) + " · " + chg(c, fx)); }); }
    if (it.j && it.j.moved) L.push("Price went the other way by " + day(it.j.moved.d) + ": " + (it.j.moved.pct > 0 ? "+" : "−") + Math.abs(it.j.moved.pct).toFixed(2) + "% against the " + it.tag + " read, so the market is treating it as a " + it.j.moved.to.toLowerCase());
    return L.length ? "<ul>" + L.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : "";
  }
  function itemHTML(it, fx) {
    var st = it.j && it.j.status ? ' · <span class="sw-st' + (/^Played/.test(it.j.status) ? " up" : /^Price disagreed/.test(it.j.status) ? " dn" : "") + '">' + esc(it.j.status) + "</span>" : "";
    var tag = it.tag ? ' · <span class="sw-tag ' + (it.tag === "Positive" ? "up" : it.tag === "Negative" ? "dn" : "") + '">' + it.tag + "</span>" : "", body = expand(it, fx);
    return body ? '<details class="sw-it"><summary>' + esc(it.label) + tag + st + "</summary>" + body + "</details>" : '<div class="sw-it">' + esc(it.label) + tag + st + "</div>";
  }
  function grid(items, fx, sub) {
    return '<div class="sw-grid">' + ["Strength", "Weakness", "Opportunity", "Threat"].map(function (b) { var L = items.filter(function (i) { return (i.j ? i.j.bucket : i.bucket) === b; });
      return '<div class="sw-b sw-' + b.toLowerCase() + '"><h3>' + b + "</h3>" + (L.length ? L.map(function (i) { return itemHTML(i, fx); }).join("") : '<div class="sw-none">' + sub[b] + "</div>") + "</div>"; }).join("") + "</div>";
  }
  function intelHTML() {
    var D = root.DATA; if (!D || !D.grains) return ""; var k = grain(), now = nowET(), I = intelItems(D, k, now);
    I.forEach(function (i) { if (!i.upcoming) i.j = judge(i, V.h); });
    var UP = I.filter(function (i) { return i.upcoming; }); I = I.filter(function (i) { return !i.upcoming; });   /* a scheduled report is not yet good or bad news: listed under the grid, not as an Opportunity */
    var played = I.filter(function (i) { return i.j && /^Played/.test(i.j.status); }).length, w = I.filter(function (i) { return (i.j ? i.j.bucket : i.bucket) === "Weakness"; }).length, s = I.filter(function (i) { return (i.j ? i.j.bucket : i.bucket) === "Strength"; }).length;
    var c = (D.grains[k].roll || [])[0];
    return '<div class="tile wide sw-win" id="sw-intel"><h2>Intel Brief - SWOT <span class="h2note">fed from the current dataset · price is ' + (c ? c.contract : "the front contract") + " settlement</span></h2>" +
      '<div class="sw-ctl"><span>Commodity</span>' + seg("data-sw-k", ORDER.map(function (x) { return [x, NM[x]]; }), k) + "<span>Horizon</span>" + seg("data-sw-h", [["day", "Day"], ["week", "Week"], ["month", "Month"]], V.h) + "</div>" +
      grid(I, false, { Strength: "No supportive item", Weakness: "No pressuring item", Opportunity: "No supportive outside factor", Threat: "No pressuring outside factor" }) +
      (UP.length ? '<div class="sw-up"><b>Coming up</b> — tagged when released: ' + UP.map(function (u) { return esc(u.label); }).join(" · ") + "</div>" : "") +
      '<div class="obs-box"><b>OBSERVATIONS</b><ul><li>' + NM[k] + ": " + w + " item" + (w === 1 ? "" : "s") + " in Weakness against " + s + " in Strength on the " + V.h + " view.</li><li>" + played + " item" + (played === 1 ? " has" : "s have") + " played out on the " + V.h + " horizon; click an item for its Day, Week and Month prices.</li></ul></div></div>";
  }
  function usHTML() {
    var D = root.DATA; if (!D || !D.macro) return ""; var now = nowET(), R = usRows(D, now), rows = R.rows.filter(function (r) { return V.f === "both" || r.cty === V.f; });
    rows.forEach(function (r) { r.j = judge(r, V.h); });
    var cell = function (t) { return '<td class="' + (t === "Positive" || t === "Down pressure" || t === "C$ grain prices up" ? "up" : t === "Negative" || t === "Up pressure" || t === "C$ grain prices down" ? "dn" : t === "Data flag" ? "sw-flag" : "") + '">' + esc(t) + "</td>"; };
    var tb = rows.map(function (r) { var b = r.j.bucket + " (" + r.bucketCty + ")", st = r.j.status ? '<br><small class="sw-st">' + esc(r.j.status) + "</small>" : "", ex = expand(r, true);
      return "<tr><td>" + (ex ? '<details class="sw-it"><summary>' + esc(r.label) + "</summary>" + ex + "</details>" : esc(r.label) + (r.why ? '<br><small class="sw-none">' + esc(r.why) + "</small>" : "")) + "</td>" + cell(r.us) + cell(r.ca) + cell(r.fx) + cell(r.cm || "-") + "<td>" + esc(b) + st + "</td></tr>"; }).join("");
    var up = R.upcoming.filter(function (r) { return V.f === "both" || r.cty === V.f; }), push = rows.filter(function (r) { return r.fx === "Up pressure"; }).length, dn = rows.filter(function (r) { return r.fx === "Down pressure"; }).length;
    return '<div class="tile wide sw-win" id="sw-us"><h2>US Brief - SWOT <span class="h2note">USD/CAD up = CAD weaker · fed from the current dataset</span></h2>' +
      '<div class="sw-ctl"><span>Filter</span>' + seg("data-sw-f", [["both", "US + Canada"], ["us", "US only"], ["ca", "Canada only"]], V.f) + "<span>Horizon</span>" + seg("data-sw-h", [["day", "Day"], ["week", "Week"], ["month", "Month"]], V.h) + "</div>" +
      '<div class="tbl-scroll"><table class="cf-tbl sw-tbl"><thead><tr><th>Driver (latest print)</th><th>US GDP</th><th>Canada GDP</th><th>USD/CAD</th><th>Commodity</th><th>Bucket</th></tr></thead><tbody>' + tb + "</tbody></table></div>" +
      (up.length ? '<div class="sw-up"><b>Upcoming, tagged only when the actual prints:</b> ' + up.map(function (u) { return esc(u.label); }).join(" · ") + "</div>" : "") +
      '<div class="obs-box"><b>OBSERVATIONS</b><ul><li>' + push + " of " + rows.length + " rows push USD/CAD up (CAD weaker) and " + dn + " push it down.</li>" + (up[0] ? "<li>Next test: " + esc(up[0].label) + "; rows re-tag when the actual prints, never before.</li>" : "") + "</ul></div></div>";
  }
  function mount(P, id, html) {
    if (!P || !P.classList.contains("active")) return; var old = doc.getElementById(id), h = html(); if (!h) return;
    var tmp = doc.createElement("div"); tmp.innerHTML = h; var el = tmp.firstChild, opn = old ? [].map.call(old.querySelectorAll("details[open] > summary"), function (s) { return s.textContent; }) : [];
    [].forEach.call(el.querySelectorAll("details > summary"), function (s) { if (opn.indexOf(s.textContent) >= 0) s.parentNode.open = true; });
    if (old && old.parentNode === P) P.replaceChild(el, old); else { if (old) old.remove(); P.insertBefore(el, P.firstChild); }
  }
  var PI = doc.getElementById("panel-intel"), PB = doc.getElementById("panel-briefing"), busy = 0;
  function paint() { if (busy) return; busy = 1; try { mount(PI, "sw-intel", intelHTML); mount(PB, "sw-us", usHTML); } finally { setTimeout(function () { busy = 0; }, 0); } }
  [PI, PB].forEach(function (P) { if (P && root.MutationObserver) new MutationObserver(function () { var id = P === PI ? "sw-intel" : "sw-us"; if (P.classList.contains("active") && (!doc.getElementById(id) || P.firstChild.id !== id)) paint(); }).observe(P, { childList: true, attributes: true, attributeFilter: ["class"] }); });
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-sw-k],[data-sw-h],[data-sw-f]"); if (!b) return;
    if (b.hasAttribute("data-sw-k")) V.k = b.getAttribute("data-sw-k"); if (b.hasAttribute("data-sw-h")) V.h = b.getAttribute("data-sw-h"); if (b.hasAttribute("data-sw-f")) V.f = b.getAttribute("data-sw-f"); save(); paint(); });
  var ra = root.renderAll; if (typeof ra === "function") root.renderAll = function () { var r = ra.apply(this, arguments); paint(); return r; };
  paint();
})(typeof window !== "undefined" ? window : this);
