/* motion.js — trading-terminal motion, driven only by real data changes (never decorative loops).
   1 Directional flash on live price tiles          [data-tick]            200 ms flash, fades out
   2 Rolling digits on headline prices              [data-tick][data-roll] 220 ms per changed digit
   3 Smooth live-chart extension                    [data-live-chart] #fx-spark: last-point marker glides 300 ms
   4 News slide-in (+ NEW tag, one-time alert for USDA/WASDE/exports/weather) — rendered by newsBodyHTML
   5 Gradual state change on spreads/basis/signals  colour-state elements inside signal tiles, 260 ms
   6 One-time border pulse when a NEW critical alert appears (positioning alerts, release errors)
   Rapid ticks are batched (one scan per animation frame, max ~4/s); first paint only records state;
   prefers-reduced-motion turns everything off. */
(function () {
  "use strict";
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var css = document.createElement("style");
  css.textContent =
    "[data-tick]{border-radius:4px;transition:background-color .25s ease-out,color .25s ease-out}" +
    ".tk-up{animation:tkup .45s ease-out}.tk-dn{animation:tkdn .45s ease-out}" +
    "@keyframes tkup{0%{background:rgba(63,185,127,.55);color:#eafff3}35%{background:rgba(63,185,127,.35)}100%{background:transparent}}" +
    "@keyframes tkdn{0%{background:rgba(224,101,95,.55);color:#fff0ef}35%{background:rgba(224,101,95,.35)}100%{background:transparent}}" +
    ".rd{display:inline-block;height:1.15em;line-height:1.15em;overflow:hidden;vertical-align:bottom}" +
    ".rd>i{display:flex;flex-direction:column;font-style:normal;transition:transform .22s cubic-bezier(.2,.8,.2,1)}" +
    ".rd.up>i{transform:translateY(0)}.rd.up.go>i{transform:translateY(-50%)}" +
    ".rd.dn>i{transform:translateY(-50%)}.rd.dn.go>i{transform:translateY(0)}" +
    ".mv-dot{transition:transform .3s cubic-bezier(.2,.8,.2,1)}" +
    ".mv-ring{transform-box:fill-box;transform-origin:center;animation:mvring .9s ease-out 1}" +
    "@keyframes mvring{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(2.6)}}" +
    ".st-chg{animation:stchg .6s ease-out}" +
    "@keyframes stchg{0%{filter:brightness(1.9);text-shadow:0 0 8px currentColor}100%{filter:none;text-shadow:none}}" +
    ".pk,.ck-chip,.pk-al,.mcard,.kv .vv,.up,.dn,.neu{transition:color .26s ease,background-color .26s ease,border-color .26s ease}" +
    ".pulse-once{animation:pulse1 .7s ease-out 2}" +
    "@keyframes pulse1{0%{box-shadow:0 0 0 0 rgba(232,163,61,.85)}100%{box-shadow:0 0 0 10px rgba(232,163,61,0)}}" +
    ".pulse-crit{animation:pulsec .7s ease-out 2}" +
    "@keyframes pulsec{0%{box-shadow:0 0 0 0 rgba(224,101,95,.9)}100%{box-shadow:0 0 0 12px rgba(224,101,95,0)}}" +
    ".news-list li.n-new{animation:nslide .24s ease-out both}" +
    "@keyframes nslide{0%{opacity:0;transform:translateY(-6px)}100%{opacity:1;transform:none}}" +
    ".n-newtag{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.08em;color:#0b1220;background:#38b6c9;border-radius:3px;padding:0 4px;margin-right:5px;vertical-align:1px}" +
    ".news-list li.n-hot{border-left:3px solid #e8a33d;padding-left:8px;animation:nslide .24s ease-out both,nhot .8s ease-out .25s 2}" +
    "@keyframes nhot{0%{background:rgba(232,163,61,.22)}100%{background:transparent}}" +
    "@media (prefers-reduced-motion:reduce){[data-tick],.rd>i,.mv-dot{transition:none}.tk-up,.tk-dn,.mv-ring,.st-chg,.pulse-once,.pulse-crit,.news-list li.n-new,.news-list li.n-hot{animation:none}}";
  document.head.appendChild(css);

  var LAST = {}, TXT = {}, ST = {}, ALERTS = {}, seeded = false, queued = false, lastScan = 0;
  function val(el) { var t = (el.getAttribute("data-v") || el.textContent || "").replace(/[^0-9.\-−]/g, "").replace("−", "-"); var v = parseFloat(t); return isFinite(v) ? v : null; }

  /* 2 rolling digits: stack old/new digit and slide in the direction of the move */
  function roll(el, oldT, newT, up) {
    if (RM || !oldT || oldT.length !== newT.length) return;
    var h = "", changed = false;
    for (var i = 0; i < newT.length; i++) {
      var a = oldT[i], b = newT[i];
      if (a !== b && /\d/.test(a) && /\d/.test(b)) { changed = true; h += '<span class="rd ' + (up ? "up" : "dn") + '"><i>' + (up ? "<b>" + a + "</b><b>" + b + "</b>" : "<b>" + b + "</b><b>" + a + "</b>") + "</i></span>"; }
      else h += b.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }
    if (!changed) return;
    el.innerHTML = h.replace(/<b>/g, '<span style="font-weight:inherit">').replace(/<\/b>/g, "</span>");
    void el.offsetWidth;
    el.querySelectorAll(".rd").forEach(function (r) { r.classList.add("go"); });
    setTimeout(function () { if (el.querySelector(".rd")) el.textContent = newT; }, 260);
  }
  function flash(el, up) {
    if (RM) return;
    el.classList.remove("tk-up", "tk-dn"); void el.offsetWidth; el.classList.add(up ? "tk-up" : "tk-dn");
    setTimeout(function () { el.classList.remove("tk-up", "tk-dn"); }, 500);
  }

  /* 7 rate-board quote tiles [data-qt]: the box flashes green / red for ~1 s on a real change, only the digits that changed
       flip in (split-flap), and the last-tick arrow persists across re-renders until the next change. */
  var QV = {}, QS = {}, QD = {};
  function qtFmt(v, dec, pre) { var t = (pre || "") + v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }), i = t.length - (dec >= 2 ? 2 : 1); return [t.slice(0, i), t.slice(i)]; }
  function qtPaint(box, v, animate) {
    var k = box.getAttribute("data-qt"), dec = +box.getAttribute("data-dec"), pre = box.getAttribute("data-pre") || "", p = QV[k], prevS = QS[k];
    var parts = qtFmt(v, dec, pre), full = parts[0] + parts[1], vEl = box.querySelector(".qt-v");
    if (animate && p != null && v !== p && !RM && box.offsetParent !== null) {
      var up = v > p, html = "", n = 0;
      [parts[0], parts[1]].forEach(function (seg, si) {
        var h = "";
        for (var i = 0; i < seg.length; i++, n++) { var ch = seg[i], was = prevS ? prevS[n] : null; h += (was !== ch && /\d/.test(ch)) ? '<span class="qf">' + ch + "</span>" : ch.replace(/&/g, "&amp;"); }
        html += '<span class="' + (si ? "qt-pp" : "qt-bf") + '">' + h + "</span>";
      });
      if (vEl) vEl.innerHTML = html;
      QD[k] = up ? "up" : "dn";
      box.classList.remove("fl-up", "fl-dn"); void box.offsetWidth; box.classList.add(up ? "fl-up" : "fl-dn");
      setTimeout(function () { box.classList.remove("fl-up", "fl-dn"); }, 160);   /* drop the class: the .9 s transition fades it out */
    } else if (vEl && p != null && v !== p) {
      vEl.innerHTML = '<span class="qt-bf">' + parts[0] + '</span><span class="qt-pp">' + parts[1] + "</span>";
      QD[k] = v > p ? "up" : "dn";
    }
    box.classList.toggle("dir-up", QD[k] === "up"); box.classList.toggle("dir-dn", QD[k] === "dn");
    box.setAttribute("data-v", v);
    QV[k] = v; QS[k] = full;
  }
  function qtScan() { document.querySelectorAll("[data-qt]").forEach(function (b) { var v = parseFloat(b.getAttribute("data-v")); if (isFinite(v)) qtPaint(b, v, seeded); }); }
  window.QT = { set: function (key, v) { document.querySelectorAll('[data-qt-live="' + key + '"]').forEach(function (b) { qtPaint(b, v, true); }); } };

  /* 5 signal tiles: key colour-state elements by tile title + position */
  var SIGNAL = /spread|curve|basis|volatility|cockpit|positioning|open interest|cftc|yield|policy|carry|roll/i;
  function stateOf(el) { return el.classList.contains("up") ? "up" : el.classList.contains("dn") ? "dn" : el.classList.contains("hot") ? "hot" : el.classList.contains("ok") ? "ok" : el.classList.contains("fl") ? "fl" : "neu"; }

  function scan() {
    queued = false; lastScan = Date.now();
    /* 1 + 2 price ticks */
    document.querySelectorAll("[data-tick]").forEach(function (el) {
      var k = el.getAttribute("data-tick"), v = val(el), t = (el.textContent || "").trim();
      if (v == null) return;
      var p = LAST[k];
      if (seeded && p != null && v !== p && el.offsetParent !== null) {
        var up = v > p;
        flash(el, up);
        if (el.hasAttribute("data-roll")) roll(el, TXT[k], t, up);
      }
      LAST[k] = v; TXT[k] = t;
    });
    qtScan();
    /* 5 gradual state change in signal tiles */
    document.querySelectorAll(".tile").forEach(function (tile) {
      var h = tile.querySelector("h2"); if (!h || !SIGNAL.test(h.textContent)) return;
      var base = h.textContent.slice(0, 40), i = 0;
      tile.querySelectorAll(".up,.dn,.pk-v,.ck-chip").forEach(function (el) {
        var k = base + "#" + (i++), s = stateOf(el) + "|" + (el.textContent || "").trim().slice(0, 24), sOnly = s.split("|")[0], p = ST[k];
        if (seeded && p && p !== s && el.offsetParent !== null && !RM) {
          if (p.split("|")[0] !== sOnly || el.classList.contains("pk-v")) { el.classList.remove("st-chg"); void el.offsetWidth; el.classList.add("st-chg"); setTimeout(function () { el.classList.remove("st-chg"); }, 700); }
        }
        ST[k] = s;
      });
    });
    /* 6 one-time pulse for a new critical alert */
    document.querySelectorAll(".poskpi,.await-err").forEach(function (tile) {
      var h = tile.querySelector("h2,.aw-t"), key = (tile.getAttribute("data-src") || "") + (h ? h.textContent.slice(0, 60) : "");
      var set = [].map.call(tile.querySelectorAll(".pk-al.crit,.pk-al.hot,.aw-errbox"), function (a) { return a.textContent.trim().slice(0, 80); }).sort().join("||");
      var prev = ALERTS[key];
      if (seeded && prev !== undefined && set && set !== prev) {
        var fresh = set.split("||").some(function (a) { return (prev || "").split("||").indexOf(a) < 0; });
        if (fresh && !RM) { var crit = !!tile.querySelector(".pk-al.crit,.aw-errbox"); tile.classList.remove("pulse-once", "pulse-crit"); void tile.offsetWidth; tile.classList.add(crit ? "pulse-crit" : "pulse-once"); setTimeout(function () { tile.classList.remove("pulse-once", "pulse-crit"); }, 1500); }
      }
      ALERTS[key] = set;
    });
    seeded = true;
  }
  function schedule() {                     /* batch bursts of ticks: one scan per frame, at most ~4 per second */
    if (queued) return; queued = true;
    var wait = Math.max(0, 250 - (Date.now() - lastScan));
    setTimeout(function () { requestAnimationFrame(scan); }, wait);
  }

  /* 3 live chart: glide the last-point marker from where it was, ring once on a new point */
  var DOT = {};
  function hookChart(box, id) {
    new MutationObserver(function () {
      var svg = box.querySelector("svg"); if (!svg) return;
      var dot = svg.querySelector("circle.mv-last") || [].slice.call(svg.querySelectorAll("circle")).pop(); if (!dot) return;
      var x = +dot.getAttribute("cx"), y = +dot.getAttribute("cy"), p = DOT[id];
      DOT[id] = { x: x, y: y };
      if (!p || RM || (p.x === x && p.y === y)) return;
      dot.classList.add("mv-dot");
      dot.style.transition = "none"; dot.style.transform = "translate(" + (p.x - x) + "px," + (p.y - y) + "px)";
      void dot.getBoundingClientRect();
      requestAnimationFrame(function () { dot.style.transition = ""; dot.style.transform = "translate(0,0)"; });
      if (Math.abs(p.x - x) > 0.5) {
        var ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ring.setAttribute("cx", x); ring.setAttribute("cy", y); ring.setAttribute("r", 5); ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", dot.getAttribute("fill") || "#38b6c9"); ring.setAttribute("stroke-width", "1.5"); ring.setAttribute("class", "mv-ring");
        dot.parentNode.insertBefore(ring, dot);
        setTimeout(function () { ring.remove(); }, 950);
      }
    }).observe(box, { childList: true });
  }
  var hooked = new WeakSet();
  function hookCharts() {
    document.querySelectorAll("[data-live-chart],#fx-spark").forEach(function (b, i) { if (hooked.has(b)) return; hooked.add(b); hookChart(b, b.id || "lc" + i); });
  }

  /* re-scan after every render and every streamed tick */
  function wrap(name) {
    var f = window[name]; if (typeof f !== "function" || f.__mv) return;
    var w = function () { var r = f.apply(this, arguments); hookCharts(); schedule(); return r; }; w.__mv = true; window[name] = w;
  }
  ["renderAll", "renderGrain", "renderFX", "setSub"].forEach(wrap);
  window.MOTION = { scan: schedule, now: scan };
  hookCharts(); scan();
})();
