/* Price cues on the Intelligence desk (owner, Nov 27 2026): what moved soybeans and the agri complex, flowed through the
   universe for pre-market / day / week / month, with moving-average levels and the inflection points (zig-zag swing
   highs/lows) where a substantial rise or drop began. Data: cues.json on the `cues` branch (scripts/cues.py, every
   30 min). Driver tags and headline tone are keyword inference and say so; a market with no data is hidden. */
(function (root) {
  var doc = root.document; if (!doc) return;
  var REPO = (root.LIVE_CONFIG && root.LIVE_CONFIG.liveRepo) || "anirudhpdoshi/AGRITrade";
  var API = "https://api.github.com/repos/" + REPO + "/contents/cues.json?ref=cues", RAW = "https://raw.githubusercontent.com/" + REPO + "/cues/cues.json";
  var D = null, V = { h: "pre", o: "" };
  try { var s = JSON.parse(localStorage.getItem("desk.cue") || "{}"); if (s.h) V.h = s.h; if (s.o) V.o = s.o; } catch (e) {}
  function save() { try { localStorage.setItem("desk.cue", JSON.stringify(V)); } catch (e) {} }
  function esc(s) { return DeskCore.esc(s); }
  function et(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; }
  function dt(d) { var x = new Date(d + "T12:00:00Z"); return x.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function fx(v, n) { return v == null ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: n, maximumFractionDigits: n }); }
  function pc(v) { return v == null ? '<span class="note">–</span>' : '<span class="' + (v > 0 ? "up" : v < 0 ? "dn" : "") + '">' + (v > 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  var ORDER = ["soybeans", "soymeal", "soyoil", "corn", "wheat", "canola", "wti", "usdcad", "dxy"];
  var HZ = [["pre", "Pre-market"], ["day", "Day"], ["week", "Week"], ["month", "Month"]];
  function mvH(m) { return V.h === "week" ? m.w1 : V.h === "month" ? m.m1 : m.d1; }

  function maDots(m) {
    return ["20", "50", "100", "200"].filter(function (k) { return m.ma[k] != null; }).map(function (k) {
      var a = m.above[k]; return '<span class="cu-ma ' + (a ? "up" : "dn") + '" title="' + k + "-day MA " + fx(m.ma[k], m.dec) + '">' + (a ? "▲" : "▼") + k + "</span>";
    }).join(" ");
  }
  function lastPiv(m) {
    var p = m.pivots && m.pivots[m.pivots.length - 1]; if (!p) return '<span class="note">no swing ≥' + m.th + "%</span>";
    return '<span class="' + (p.kind === "low" ? "up" : "dn") + '">' + (p.kind === "low" ? "Low " : "High ") + fx(p.px, m.dec) + "</span> " + dt(p.d) + " → " + pc(p.move);
  }
  function drv(F) {
    if (!F || !F.drivers.length) return '<span class="note">no tagged cues</span>';
    return F.drivers.slice(0, 3).map(function (c) { var t = c.up > c.down ? ' <span class="up">↑</span>' : c.down > c.up ? ' <span class="dn">↓</span>' : ""; return esc(c.label) + " <small>" + c.n + "</small>" + t; }).join(" · ");
  }
  function detail(k, m) {
    var F = D.flow[k] && D.flow[k][V.h], H = (F ? F.heads : []).map(function (i) { return D.heads[i]; }).filter(Boolean);
    var piv = (m.pivots || []).map(function (p) {
      return "<li><b class=\"" + (p.kind === "low" ? "up" : "dn") + "\">" + (p.kind === "low" ? "Swing low" : "Swing high") + " " + fx(p.px, m.dec) + "</b> on " + dt(p.d) + " — " + (p.kind === "low" ? "rise" : "drop") + " of " + pc(p.move) + (p.open ? " so far (latest " + fx(m.last, m.dec) + ")" : " to " + fx(p.to_px, m.dec) + " on " + dt(p.to)) + "</li>";
    }).join("");
    var big = (m.big_days || []).map(function (b) { return dt(b.d) + " " + pc(b.chg); }).join(" · ");
    var lv = ["20", "50", "100", "200"].filter(function (n) { return m.ma[n] != null; }).map(function (n) { return n + "D " + fx(m.ma[n], m.dec); }).join(" · ");
    return '<tr class="cu-det"><td colspan="7"><div class="cu-g"><div><b>Levels</b><p>' + lv + "</p><p>20-day range " + fx(m.lo20, m.dec) + " – " + fx(m.hi20, m.dec) + " · 52-week " + fx(m.lo52, m.dec) + " – " + fx(m.hi52, m.dec) + "</p>" +
      (piv ? "<b>Inflection points (moves ≥" + m.th + "%)</b><ul>" + piv + "</ul>" : "") + (big ? "<b>Big days, last month (≥" + (m.th / 2) + "%)</b><p>" + big + "</p>" : "") + "</div>" +
      (H.length ? '<div><b>Cues · ' + esc(HZ.filter(function (h) { return h[0] === V.h; })[0][1]) + "</b><ul class=\"cu-h\">" + H.map(function (h) {
        return '<li><span class="note">' + et(h.ts) + " · " + esc(h.outlet) + "</span>" + (h.tone ? ' <span class="' + (h.tone === "up" ? "up" : "dn") + '">' + (h.tone === "up" ? "↑" : "↓") + "</span>" : "") +
          ' <a href="' + (root.safeUrl ? safeUrl(h.url) : "#") + '" target="_blank" rel="noopener">' + esc(h.title) + "</a></li>";
      }).join("") + "</ul></div>" : "") + "</div></td></tr>";
  }
  function obs(keys) {
    var L = [], mv = keys.map(function (k) { return [k, mvH(D.markets[k])]; }).filter(function (x) { return x[1] != null; }).sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); });
    var lbl = V.h === "week" ? "this week" : V.h === "month" ? "this month" : "on the day";
    if (mv[0]) L.push("Biggest move " + lbl + ": " + esc(D.markets[mv[0][0]].name) + " " + (mv[0][1] > 0 ? "+" : "") + mv[0][1].toFixed(2) + "%" + (mv[1] ? ", then " + esc(D.markets[mv[1][0]].name) + " " + (mv[1][1] > 0 ? "+" : "") + mv[1][1].toFixed(2) + "%" : "") + ".");
    var tot = {}; keys.forEach(function (k) { var F = D.flow[k] && D.flow[k][V.h]; (F ? F.drivers : []).forEach(function (c) { var t = tot[c.id] || (tot[c.id] = { l: c.label, n: 0, k: [] }); t.n += c.n; t.k.push(D.markets[k].name); }); });
    var top = Object.keys(tot).map(function (i) { return tot[i]; }).sort(function (a, b) { return b.n - a.n; })[0];
    if (top) L.push("Most-cited driver: " + esc(top.l) + " (" + top.n + " tagged headline" + (top.n > 1 ? "s" : "") + "), touching " + esc(top.k.slice(0, 5).join(", ")) + ".");
    var fresh = keys.filter(function (k) { var p = D.markets[k].pivots, q = p && p[p.length - 1]; return q && (Date.now() - new Date(q.d + "T12:00:00Z")) < 12 * 864e5; });
    if (fresh.length) L.push("New swing in the last ~8 sessions: " + fresh.map(function (k) { var q = D.markets[k].pivots.slice(-1)[0]; return esc(D.markets[k].name) + " (" + q.kind + " " + dt(q.d) + ")"; }).join(", ") + ".");
    var b200 = keys.filter(function (k) { return D.markets[k].above["200"] === false; }).map(function (k) { return D.markets[k].name; });
    if (b200.length) L.push("Below the 200-day MA: " + esc(b200.join(", ")) + ".");
    return L.length ? '<div class="obs-box"><b>OBSERVATIONS</b><ul><li>' + L.join("</li><li>") + "</li></ul></div>" : "";
  }
  function html() {
    if (!D || !D.markets) return "";
    var keys = ORDER.filter(function (k) { return D.markets[k]; }); if (!keys.length) return "";
    var rows = keys.map(function (k) {
      var m = D.markets[k], F = D.flow[k] && D.flow[k][V.h];
      return '<tr data-cue="' + k + '" class="cu-r' + (V.o === k ? " on" : "") + '"><td class="c1"><b>' + esc(m.name) + "</b> <small>" + esc(m.unit) + " · " + dt(m.date) + "</small></td><td>" + fx(m.last, m.dec) + "</td><td>" + pc(m.d1) + "</td><td>" + pc(m.w1) + "</td><td>" + pc(m.m1) + "</td><td>" + maDots(m) + "</td><td>" + lastPiv(m) + '<div class="cu-d">' + drv(F) + "</div></td></tr>" + (V.o === k ? detail(k, m) : "");
    }).join("");
    var seg = '<div class="gr-slicer" role="group">' + HZ.map(function (x) { return '<button type="button" data-cue-h="' + x[0] + '" aria-pressed="' + (x[0] === V.h) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    return '<div class="tile wide sw-win" id="cue-intel"><h2>Price cues — what is moving the complex <span class="h2note">updated ' + et(D.updated_at) + (V.h === "pre" ? " · pre-market = since the " + et(D.pre_since) + " settlement" : "") + " · driver tags are headline inference, not signals</span></h2>" +
      '<div class="sw-ctl"><span>Cues</span>' + seg + '<span class="note">click a market for levels, inflection points and the headlines</span></div>' +
      '<div class="tbl-scroll"><table class="cf-tbl cu-tbl"><thead><tr><th class="c1">Market · last bar</th><th>Last</th><th>1D</th><th>1W</th><th>1M</th><th>vs 20/50/100/200D</th><th>Last inflection → move · top drivers</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      obs(keys) + '<div class="note cu-src">' + esc(D.sources.prices) + ". " + esc(D.sources.method) + "</div></div>";
  }
  function mount() {
    var P = doc.getElementById("panel-intel"); if (!P || !P.classList.contains("active")) return;
    var h = html(), old = doc.getElementById("cue-intel"); if (!h) { if (old) old.remove(); return; }
    var sw = doc.getElementById("sw-intel"), ref = sw && sw.parentNode === P ? sw.nextSibling : P.firstChild;
    if (old && old._h === h && old.parentNode === P && (!sw || old.previousSibling === sw)) return;
    var t = doc.createElement("div"); t.innerHTML = h; var el = t.firstChild; el._h = h;
    if (old) old.remove(); P.insertBefore(el, ref && ref !== old ? ref : null);
  }
  function load() {
    fetch(API, { headers: { Accept: "application/vnd.github.raw" }, cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); })
      .then(function (j) { D = j; mount(); }).catch(function () {});
  }
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-cue-h],tr[data-cue]"); if (!b || ev.target.closest("a")) return;
    if (b.hasAttribute("data-cue-h")) V.h = b.getAttribute("data-cue-h"); else { var k = b.getAttribute("data-cue"); V.o = V.o === k ? "" : k; }
    save(); mount();
  });
  var P = doc.getElementById("panel-intel");
  if (P && root.MutationObserver) new MutationObserver(function () { if (P.classList.contains("active") && D) { var o = doc.getElementById("cue-intel"), sw = doc.getElementById("sw-intel"); if (!o || (sw && o.previousSibling !== sw)) mount(); } }).observe(P, { childList: true, attributes: true, attributeFilter: ["class"] });
  load(); setInterval(load, 5 * 60 * 1000);
})(typeof window !== "undefined" ? window : this);
