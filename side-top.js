/* side-top.js — the frozen top of the right-hand panel (owner, Nov 23 2026), above the feed:
     1. Market pulse — Corn · Soybeans · Wheat as their own tiles (click one: that commodity across the reports), then USD/CAD,
        US 10Y and 2Y, US–CA 10Y spread, WTI, DXY, Fed funds, BoC rate — the desk's own data, as the Overview pulse had it
     2. Key events — the next high- and medium-impact releases and central-bank dates, rolling one line at a time
     3. Breakouts — the three newest live breakout / breakdown events
   The feed scrolls underneath; this block stays put. */
(function () {
  "use strict";
  var root = window, doc = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function nf(v, d) { return v == null || !isFinite(v) ? "—" : (+v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sg(v, d, u) { return v == null || !isFinite(v) ? "" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d) + (u || ""); }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "dn" : "neu"; }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }); }
  function day(t) { var a = new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), b = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), c = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    return a === b ? "Today" : a === c ? "Tomorrow" : new Date(t).toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "short" }); }

  /* ---------- 1. market pulse ---------- */
  var GR = [["corn", "Corn"], ["soybeans", "Soybeans"], ["wheat", "Wheat"]];
  function vis(k) { var L = doc.querySelectorAll('[data-grain-pick="' + k + '"]'); for (var i = 0; i < L.length; i++) if (L[i].offsetParent) return L[i]; return null; }
  function isOn(k) { var b = vis(k); return b ? b.getAttribute("aria-pressed") === "true" : active() === k; }
  function active() { var a = doc.querySelector(".tab-panel.active"); return a ? a.id.replace("panel-", "") : ""; }
  function grain(k) {
    try { var g = DATA.grains[k], f = g.fan, L = +f.intraday[0], A = +f.anchor, c = (g.roll && g.roll[0] && g.roll[0].contract) || ""; if (!isFinite(L)) return null;
      return { k: k, px: L, ch: A ? (L - A) * 100 : null, pct: A ? (L / A - 1) * 100 : null, c: c }; } catch (e) { return null; }
  }
  function pulse() {
    var D = root.DATA; if (!D) return "";
    var tiles = GR.map(function (x) { var g = grain(x[0]); if (!g) return "";
      return '<button type="button" class="st-g' + (isOn(x[0]) ? " on" : "") + '" data-st-grain="' + x[0] + '" title="Open ' + x[1] + ' — keeps the report you are on"><span class="st-gn">' + x[1] + ' <small>' + esc(g.c) + '</small></span>' +
        '<b class="st-gv">' + nf(g.px, 4) + '</b><span class="st-gc ' + cls(g.ch) + '">' + (g.ch == null ? "" : sg(g.ch, 2, "¢") + "<br>" + sg(g.pct, 2, "%")) + "</span></button>"; }).join("");
    var fx = D.fx || {}, Y = fx.yields_live || {}, y10 = Y["10Y"] || {}, y2 = Y["2Y"] || {}, w = (fx.energy || [])[0] || {}, x = fx.fxcross || {}, P = fx.policy || {};
    var el = doc.getElementById("fx-spot-big"), lv = el ? parseFloat(el.textContent.replace(/[^\d.]/g, "")) : NaN, bsx = root.PRICE_SYNC && PRICE_SYNC.best && PRICE_SYNC.best("CAD=X");
    var spot = isFinite(lv) && lv > 0.5 ? lv : (bsx && bsx.px) || (fx.feed && +fx.feed.mid), ref = fx.spot && +fx.spot.ref, ch = spot && ref ? (spot / ref - 1) * 100 : null;
    var fedM = /(\d{3})-(\d{3})/.exec(P.fed_range || ""), boc = P.boc_decided && P.boc_decided.rate != null ? P.boc_decided.rate : P.corra_now;
    function k(n, v, c, s, pick) { return '<div class="st-k' + (pick ? " st-kp" : "") + '"' + (pick ? ' data-st-grain="' + pick + '" role="button" tabindex="0"' : "") + '><span>' + n + "</span><b>" + v + '</b><i class="' + (c || "") + '">' + (s || "") + "</i></div>"; }
    var ks = (spot ? k("USD/CAD", nf(spot, 4), cls(ch), sg(ch, 2, "%"), "fx") : "") +
      (y10.y != null ? k("US 10Y", nf(+y10.y, 3) + "%", cls(y10.chg_bp), sg(y10.chg_bp, 1, " bp")) : "") +
      (y2.y != null ? k("US 2Y", nf(+y2.y, 3) + "%", cls(y2.chg_bp), sg(y2.chg_bp, 1, " bp")) : "") +
      (y10.sp_ca != null ? k("US–CA 10Y", nf(+y10.sp_ca, 1) + " bp", "", "spread") : "") +
      (w.last != null ? k("WTI", "$" + nf(+w.last, 2), cls(+w.pct), sg(+w.pct, 2, "%")) : "") +
      (x.dxy != null ? k("DXY", nf(+x.dxy, 2), cls(+x.dxy_chg), sg(+x.dxy_chg, 2, "%")) : "") +
      (fedM ? k("Fed funds", (+fedM[1] / 100).toFixed(2) + "–" + (+fedM[2] / 100).toFixed(2), "", "target %") : "") +
      (boc != null ? k("BoC", nf(+boc, 2) + "%", "", "overnight") : "");
    return '<section class="st-sec"><div class="st-h"><b>Market pulse</b><span>desk data</span></div><div class="st-gs">' + tiles + '</div><div class="st-ks">' + ks + "</div></section>";
  }

  /* ---------- 2. key events, rolling ---------- */
  var EVI = 0;
  function evList() {
    var now = Date.now(), L = [], seen = {};
    try { for (var d = 0; d < 7; d++) (EVENTS.on(now + d * 864e5) || []).forEach(function (e) {
      var lb = String(e.label || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!(e.t > now) || !lb || /refresh|on the desk|session opens|session closes|settlement|grains (open|close)|hard exit|desk rule/i.test(lb) || seen[lb + e.t]) return; seen[lb + e.t] = 1; L.push({ t: e.t, lb: lb, hi: !!e.high }); }); } catch (e) {}
    L.sort(function (a, b) { return a.t - b.t; });
    var hi = L.filter(function (e) { return e.hi; }); return (hi.length >= 3 ? hi : L).slice(0, 8);
  }
  function events() {
    var L = evList(); if (!L.length) return '<section class="st-sec st-ev"><div class="st-h"><b>Key events</b></div><div class="st-evw"><p class="st-none">Nothing scheduled in the next 7 days on the loaded calendar.</p></div></section>';
    return '<section class="st-sec st-ev"><div class="st-h"><b>Key events</b><span>' + L.length + ' upcoming · <a href="#" data-evgo="events:">all</a></span></div><div class="st-evw" aria-live="polite"><ul class="st-evl">' +
      L.map(function (e) { return '<li class="' + (e.hi ? "hi" : "") + '"><time>' + day(e.t) + " " + hm(e.t) + '</time><span title="' + esc(e.lb) + '">' + esc(e.lb) + "</span></li>"; }).join("") + "</ul></div></section>";
  }
  function roll() {   /* one line at a time, sliding up every 4 s */
    var ul = doc.querySelector(".st-evl"); if (!ul || ul.children.length < 2 || doc.hidden) return;
    var n = ul.children.length; EVI = (EVI + 1) % n;
    ul.style.transform = "translateY(" + (-EVI * 22) + "px)";
  }

  /* ---------- 3. breakouts, three lines ---------- */
  function breakouts() {
    var B = root.BREAKOUTS && BREAKOUTS.data && BREAKOUTS.data(), E = (B && B.events || []).slice().sort(function (a, b) { return Date.parse(b.t) - Date.parse(a.t); }).slice(0, 3);
    return '<section class="st-sec st-br"><div class="st-h"><b>Breakouts</b><span>live · <a href="#" data-st-go="breakouts">open</a></span></div>' +
      (E.length ? '<ul class="st-brl">' + E.map(function (e) { return '<li class="' + (e.dir > 0 ? "u" : "d") + '" data-st-id="' + esc(e.id) + '"><time>' + hm(Date.parse(e.t)) + "</time><b>" + esc(e.s) + "</b><span>" + esc(String(e.txt || "").replace(/^\S+\s+—\s+/, "")) + "</span></li>"; }).join("") + "</ul>"
        : '<p class="st-none">No breakouts yet today — the scanner runs every 5 min, 8 AM–6 PM ET on weekdays.</p>') + "</section>";
  }

  /* ---------- mount inside the feed drawer, above the feed ---------- */
  var lastBr = "";
  function paint() {
    var host = doc.querySelector(".fr-drawer .fr-top"); if (!host) return;
    var p = pulse(), e = events(), b = breakouts();
    var P = host.querySelector(".st-w1"), Ev = host.querySelector(".st-w2"), Br = host.querySelector(".st-w3");
    if (!P) { host.innerHTML = '<div class="st-w1"></div><div class="st-w2"></div><div class="st-w3"></div>'; P = host.querySelector(".st-w1"); Ev = host.querySelector(".st-w2"); Br = host.querySelector(".st-w3"); }
    if (P._h !== p) { P.innerHTML = p; P._h = p; }
    if (Ev._h !== e) { Ev.innerHTML = e; Ev._h = e; EVI = 0; }
    if (Br._h !== b) { var first = !Br._h; Br.innerHTML = b; Br._h = b; var top = Br.querySelector(".st-brl li"); if (top && !first && top.getAttribute("data-st-id") !== lastBr) top.classList.add("st-new"); lastBr = top ? top.getAttribute("data-st-id") : ""; }
  }
  doc.addEventListener("click", function (ev) {
    var g = ev.target.closest && ev.target.closest("[data-st-grain]");
    if (g) { var k = g.getAttribute("data-st-grain");
      /* on a grain or USD/CAD page (Grains or Positioning) keep the report and switch the commodity; elsewhere open Grains on it */
      var pick = vis(k);
      if (pick) pick.click();
      else { var gb = doc.querySelector('[data-gnav="grains"]'); if (gb) gb.click(); setTimeout(function () { var p2 = doc.querySelector('[data-grain-pick="' + k + '"]'); if (p2) p2.click(); }, 60); }
      setTimeout(paint, 120); return; }
    var go = ev.target.closest && ev.target.closest("[data-st-go]");
    if (go) { ev.preventDefault(); var b = doc.querySelector('[data-gnav="' + go.getAttribute("data-st-go") + '"]'); if (b) b.click(); }
  });
  setInterval(paint, 2000); setInterval(roll, 4000); setTimeout(paint, 800);

  var st = doc.createElement("style");
  st.textContent =
    ".fr-top{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding-right:22px}.fr-top:empty{display:none}" +
    ".st-sec{border:1px solid rgba(255,255,255,.10);border-radius:9px;background:rgba(255,255,255,.03);padding:7px 8px}" +
    ".st-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:5px}.st-h b{font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#d9b46a}.st-h span{font-size:10.5px;color:var(--muted)}.st-h a{color:var(--cyan)}" +
    ".st-gs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:6px}" +
    ".st-g{appearance:none;text-align:left;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.18);border-radius:7px;padding:5px 7px;cursor:pointer;color:var(--ink);display:flex;flex-direction:column;gap:1px;min-width:0}" +
    ".st-g:hover{border-color:#d9b46a}.st-g.on{border-color:#d9b46a;box-shadow:inset 0 -2px 0 #d9b46a}.st-gn{font:600 11px 'IBM Plex Sans',sans-serif;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.st-gn small{font:10px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".st-gv{font:700 15px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.st-gc{font:600 10.5px/1.3 'IBM Plex Mono',monospace;white-space:nowrap}.st-gc.up,.st-k i.up{color:#3fb97f}.st-gc.dn,.st-k i.dn{color:#ff6b62}" +
    ".st-ks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 6px}.st-k{min-width:0}.st-k span{display:block;font:600 9.5px 'IBM Plex Mono',monospace;color:var(--faint);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}" +
    ".st-k b{display:block;font:600 12px 'IBM Plex Mono',monospace;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}.st-k i{display:block;font:normal 10px 'IBM Plex Mono',monospace;color:var(--faint);white-space:nowrap}.st-kp{cursor:pointer}.st-kp:hover b{color:#d9b46a}" +
    ".st-evw{height:22px;overflow:hidden;position:relative}.st-evl{list-style:none;margin:0;padding:0;transition:transform .55s cubic-bezier(.3,.7,.2,1)}.st-evl li{height:22px;display:flex;gap:7px;align-items:center;font-size:12px;white-space:nowrap}" +
    ".st-evl time{font:600 10.5px 'IBM Plex Mono',monospace;color:var(--cyan);flex:0 0 auto}.st-evl li.hi time{color:#e3c14d}.st-evl span{overflow:hidden;text-overflow:ellipsis;color:var(--ink)}" +
    ".st-brl{list-style:none;margin:0;padding:0}.st-brl li{display:flex;gap:6px;align-items:center;font-size:11.5px;line-height:19px;white-space:nowrap;border-left:2px solid transparent;padding-left:5px}" +
    ".st-brl li.u{border-left-color:#3fb97f}.st-brl li.d{border-left-color:#ff6b62}.st-brl time{font:10.5px 'IBM Plex Mono',monospace;color:var(--faint)}.st-brl b{font:700 11px 'IBM Plex Mono',monospace}.st-brl span{overflow:hidden;text-overflow:ellipsis;color:var(--muted)}" +
    ".st-brl li.st-new{animation:stIn .6s ease-out}@keyframes stIn{from{opacity:0;background:rgba(217,180,106,.25)}to{opacity:1;background:transparent}}" +
    ".st-none{margin:0;font-size:11.5px;color:var(--muted)}" +
    "@media (prefers-reduced-motion:reduce){.st-evl{transition:none}.st-brl li.st-new{animation:none}}";
  doc.head.appendChild(st);
  root.SIDE_TOP = { paint: paint };
})();
