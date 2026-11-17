/* price-sync.js — one price per asset across every menu (owner, Nov 17 2026).
   The desk has several feeds for the same asset: the USD/CAD live stream (live.js), the desk's delayed grain quotes
   (data.json), World Markets (world.json, every 15 min) and Breakouts (breakouts.json, every 5 min). Each menu used to
   show its own copy, so USD/CAD or corn could differ by menu. This layer keeps, per asset, the FRESHEST print from any
   feed and writes it back into every menu's data, so all of them show the same number with the same time:
     · USD/CAD: live stream tick → World Markets, Breakouts, US Markets snapshot, cones, and every [data-live="usdcad"]
     · indexes, FX, futures: the newer of World Markets and Breakouts (same Yahoo symbols) → both
     · corn / soybeans / wheat: the desk's delayed front-month quote (or the newer World print) → World Markets & cones
   Change and % change are recomputed from each menu's own previous close, so the reference stays honest. */
(function (root) {
  var doc = root.document, last = {}, painted = { w: 0, b: 0 }, PEND = { w: false, b: false };
  var GR = { "ZC=F": "corn", "ZS=F": "soybeans", "ZW=F": "wheat" };   /* World quotes grains in ¢/bu, the desk in $/bu */
  function t(x) { var v = Date.parse(x || ""); return isNaN(v) ? 0 : v; }
  function W() { return root.WORLD && WORLD._data ? WORLD._data() : null; }
  function B() { return root.BREAKOUTS && BREAKOUTS.data ? BREAKOUTS.data() : null; }
  /* gather the freshest print per Yahoo symbol: {px, ts, src} */
  function best() {
    var P = {};
    function put(sym, px, ts, src) { if (!(px > 0) || !ts) return; var c = P[sym]; if (!c || ts > c.ts) P[sym] = { px: +px, ts: ts, src: src }; }
    var w = W(); ((w && w.instruments) || []).forEach(function (i) { if (!i._sync) put(i.sym, i.last, t(i.ts), "World Markets"); else put(i.sym, i._own.last, t(i._own.ts), "World Markets"); });
    var b = B(); ((b && b.items) || []).forEach(function (i) { var o = i._own || i; put(i.s, o.last, t(o.ts), "Breakouts"); });
    var D = root.DATA;
    if (D && D.grains) Object.keys(GR).forEach(function (sym) { var g = D.grains[GR[sym]], R0 = g && (g.roll || [])[0], q = R0 && g.quotes && g.quotes[R0.contract];
      if (q && q.px != null) put(sym, Math.round(q.px * 1e6) / 1e4, t(q.ts), "desk grain quote"); });
    if (D && D.fx && D.fx.feed && D.fx.feed.mid) put("CAD=X", D.fx.feed.mid, t(D.fx.feed.ts), "desk FX feed");
    var L = root.DESK_LIVE && DESK_LIVE.feedState ? DESK_LIVE.feedState() : null;
    if (L && L.last && L.lastTick) put("CAD=X", L.last, L.lastTick, "live stream");
    return P;
  }
  function apply() {
    var P = best(), ch = { w: false, b: false };
    var w = W(); ((w && w.instruments) || []).forEach(function (i) {
      var p = P[i.sym]; if (!p) return;
      if (!i._own) i._own = { last: i.last, ts: i.ts, chg: i.chg, pct: i.pct };
      if (p.ts <= t(i._own.ts) || p.src === "World Markets") { if (i._sync) { i.last = i._own.last; i.ts = i._own.ts; i.chg = i._own.chg; i.pct = i._own.pct; i._sync = null; ch.w = true; } return; }
      if (i._sync === p.ts && i.last === p.px) return;
      i.last = p.px; i.ts = new Date(p.ts).toISOString(); i._sync = p.ts; i._src = p.src;
      if (i.prev_close) { i.chg = p.px - i.prev_close; i.pct = (p.px / i.prev_close - 1) * 100; }
      if (i.high != null && p.px > i.high) i.high = p.px; if (i.low != null && p.px < i.low) i.low = p.px;
      ch.w = true;
    });
    var b = B(); ((b && b.items) || []).forEach(function (i) {
      var p = P[i.s]; if (!p) return;
      if (!i._own) { i._own = { last: i.last, ts: i.ts, pct: i.pct }; i._prev = i.pct != null ? i.last / (1 + i.pct / 100) : null; }
      if (p.src === "Breakouts" || p.ts <= t(i._own.ts)) { if (i._sync) { i.last = i._own.last; i.ts = i._own.ts; i.pct = i._own.pct; i._sync = null; ch.b = true; } return; }
      if (i._sync === p.ts && i.last === p.px) return;
      i.last = p.px; i.ts = new Date(p.ts).toISOString(); i._sync = p.ts; i._src = p.src;
      if (i._prev) i.pct = (p.px / i._prev - 1) * 100;
      ["20", "50", "100", "200"].forEach(function (n) { if (i.ma && i.ma[n] != null) i.above[n] = p.px > i.ma[n]; });
      ["9", "21", "50", "200"].forEach(function (n) { if (i.ema && i.ema[n] != null && i.above_ema) i.above_ema[n] = p.px > i.ema[n]; });
      ch.b = true;
    });
    last = P;
    /* repaint the menus that are open, at most every 10 s (the live stream ticks every few seconds) */
    PEND.w = PEND.w || ch.w; PEND.b = PEND.b || ch.b;
    var act = doc.querySelector(".tab-panel.active"), id = act ? act.id : "", typing = doc.activeElement && /INPUT|TEXTAREA|SELECT/.test(doc.activeElement.tagName);
    if (PEND.w && !typing && Date.now() - painted.w > 30000 && (id === "panel-world" || id === "panel-earnings")) { painted.w = Date.now(); PEND.w = false; try { WORLD.render(); } catch (e) {} }
    if (PEND.b && !typing && Date.now() - painted.b > 10000 && id === "panel-breakouts") { painted.b = Date.now(); PEND.b = false; try { BREAKOUTS.repaint(); } catch (e) {} }
    if (ch.w || ch.b) {
      try { root.dispatchEvent(new CustomEvent("desk:prices", { detail: { syms: Object.keys(P) } })); } catch (e) {}
    }
  }
  setInterval(function () { if (!root.DESK_LOCKED) try { apply(); } catch (e) {} }, 3000);
  root.PRICE_SYNC = { best: function (sym) { return last[sym] || null; }, apply: apply };
})(window);
