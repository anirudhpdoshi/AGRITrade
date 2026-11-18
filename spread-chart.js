/* spread-chart.js — calendar-spread charts under each grain (owner, Nov 17 2026).
   Two rolls per commodity: the front roll (front − next, e.g. ZCZ26−ZCH27) and the next roll, shown either from the front
   (ZCZ26−ZCK27) or from the next contract (ZCH27−ZCK27). Daily points are settle-to-settle (data.json → grains.<k>.spreads,
   Yahoo daily settles per contract); the live end is the desk's delayed quote of both legs (same feed as the grain tiles).
   Spread = near − far in ¢/bu (Barchart convention: negative = carry). 9-day EMA (α = 2/10, seeded with the first 9-day
   SMA), period high and low with their dates, and a short reading. Nothing is drawn without both legs. */
(function (root) {
  var doc = root.document, PAIR2 = {}, RNG = {}, TZ = "America/New_York";
  try { PAIR2 = JSON.parse(localStorage.getItem("desk.spc.pair2") || "{}"); RNG = JSON.parse(localStorage.getItem("desk.spc.rng") || "{}"); } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f2(v) { return v == null || isNaN(v) ? "—" : (v < 0 ? "−" : v > 0 ? "+" : "") + Math.abs(v).toFixed(2); }
  function c2(v) { return f2(v) + "¢"; }
  function dl(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function ema(vals, n) {
    var a = 2 / (n + 1), out = [], e = null;
    for (var i = 0; i < vals.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      if (e == null) { var s = 0; for (var j = i - n + 1; j <= i; j++) s += vals[j]; e = s / n; } else e = a * vals[i] + (1 - a) * e;
      out.push(e);
    }
    return out;
  }
  function shortC(c) { return c; }
  function pairs(g) {
    var P = (g.spreads && g.spreads.pairs) || [];
    function find(a, b) { return P.filter(function (p) { return p.near === a && p.far === b; })[0] || null; }
    var R = (g.roll || []).map(function (r) { return r.contract; });
    return { front: find(R[0], R[1]), fromFront: find(R[0], R[2]), fromNext: find(R[1], R[2]), R: R };
  }
  /* live spread: both legs quoted today, within 20 minutes of each other, after the last settle in the series */
  function live(g, p) {
    var Q = g.quotes || {}, a = Q[p.near], b = Q[p.far];
    if (!a || !b || a.px == null || b.px == null || !a.ts || !b.ts || a.stale || b.stale) return null;
    var ta = Date.parse(a.ts), tb = Date.parse(b.ts); if (isNaN(ta) || isNaN(tb) || Math.abs(ta - tb) > 20 * 6e4) return null;
    var day = new Date(Math.max(ta, tb)).toLocaleDateString("en-CA", { timeZone: TZ }), last = p.pts.length ? p.pts[p.pts.length - 1][0] : "";
    if (day <= last) return null;
    return { v: Math.round((a.px - b.px) * 1e4) / 100, ts: Math.max(ta, tb), day: day, label: a.label || "" };
  }
  var RANGES = [["1m", "1M", 22], ["3m", "3M", 64], ["6m", "6M", 130]];
  function chart(g, p, key, slot) {
    var rk = RNG[key + slot] || "3m", nDays = RANGES.filter(function (r) { return r[0] === rk; })[0][2];
    var all = p.pts.map(function (x) { return x[1]; }), E = ema(all, 9), L = live(g, p);
    var i0 = Math.max(0, p.pts.length - nDays), pts = p.pts.slice(i0), ev = E.slice(i0);
    var vals = pts.map(function (x) { return x[1]; });
    var eL = L && E[E.length - 1] != null ? 0.2 * L.v + 0.8 * E[E.length - 1] : null;
    var hiV = -1e9, loV = 1e9, hiI = 0, loI = 0;
    vals.forEach(function (v, i) { if (v > hiV) { hiV = v; hiI = i; } if (v < loV) { loV = v; loI = i; } });
    if (L) { if (L.v > hiV) { hiV = L.v; hiI = vals.length; } if (L.v < loV) { loV = L.v; loI = vals.length; } }   /* today's live print counts toward the range */
    function dAt(i) { return i >= pts.length ? "today" : dl(pts[i][0]); }
    var cur = L ? L.v : vals[vals.length - 1], prev = L ? vals[vals.length - 1] : vals[vals.length - 2], eNow = L && eL != null ? eL : ev[ev.length - 1];
    /* geometry */
    var W = root.innerWidth < 700 ? 380 : 640, H = W < 640 ? 230 : 250, PL = 8, PR = W < 640 ? 54 : 64, PT = 16, PB = 26, pw = W - PL - PR, ph = H - PT - PB, n = pts.length + (L ? 1 : 0);
    var ys = vals.concat(ev.filter(function (v) { return v != null; })).concat(L ? [L.v] : []);
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = Math.max((hi - lo) * 0.1, 0.5); lo -= pad; hi += pad;
    function X(i) { return PL + pw * i / Math.max(1, n - 1); } function Y(v) { return PT + ph * (1 - (v - lo) / (hi - lo)); }
    var s = "", step = (function () { var r = (hi - lo) / 5, m = Math.pow(10, Math.floor(Math.log10(r))), q = r / m; return (q < 1.5 ? 1 : q < 3 ? 2 : q < 7 ? 5 : 10) * m; })();
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) s += '<line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="#1a2433"/><text x="' + (PL + pw + 6) + '" y="' + (Y(t) + 3.5).toFixed(1) + '" class="spc-ax">' + f2(t) + "</text>";
    if (lo < 0 && hi > 0) s += '<line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#3a4a60" stroke-dasharray="2 3"/>';
    var lastM = ""; pts.forEach(function (x, i) { var m = x[0].slice(0, 7); if (m !== lastM) { if (lastM) s += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + PT + '" y2="' + (PT + ph) + '" stroke="#141c28"/><text x="' + (X(i) + 3).toFixed(1) + '" y="' + (H - 8) + '" class="spc-ax">' + new Date(x[0] + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short" }) + "</text>"; lastM = m; } });
    /* period high / low */
    s += '<line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(hiV).toFixed(1) + '" y2="' + Y(hiV).toFixed(1) + '" class="spc-hi"/><line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(loV).toFixed(1) + '" y2="' + Y(loV).toFixed(1) + '" class="spc-lo"/>';
    s += '<text x="' + (PL + 4) + '" y="' + (Y(hiV) - 4).toFixed(1) + '" class="spc-hl g">HIGH ' + f2(hiV) + " · " + dAt(hiI) + '</text><text x="' + (PL + 4) + '" y="' + (Y(loV) + 12).toFixed(1) + '" class="spc-hl r">LOW ' + f2(loV) + " · " + dAt(loI) + "</text>";
    /* EMA, spread, live */
    var ep = ev.map(function (v, i) { return v == null ? null : X(i).toFixed(1) + "," + Y(v).toFixed(1); }).filter(Boolean);
    if (eL != null) ep.push(X(n - 1).toFixed(1) + "," + Y(eL).toFixed(1));
    if (ep.length > 1) s += '<polyline points="' + ep.join(" ") + '" class="spc-ema"/>';
    s += '<polyline points="' + vals.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ") + '" class="spc-ln"/>';
    s += '<circle cx="' + X(hiI).toFixed(1) + '" cy="' + Y(hiV).toFixed(1) + '" r="3.5" class="spc-dh"/><circle cx="' + X(loI).toFixed(1) + '" cy="' + Y(loV).toFixed(1) + '" r="3.5" class="spc-dl"/>';
    var lx = X(pts.length - 1), ly = Y(vals[vals.length - 1]);
    if (L) { s += '<line x1="' + lx.toFixed(1) + '" y1="' + ly.toFixed(1) + '" x2="' + X(n - 1).toFixed(1) + '" y2="' + Y(L.v).toFixed(1) + '" class="spc-lv"/><circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(L.v).toFixed(1) + '" r="4.5" class="spc-ld"/>'; }
    else s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3.5" class="spc-ls"/>';
    var tagY = Y(cur), tagC = L ? "lv" : "st";
    s += '<rect x="' + (PL + pw + 2) + '" y="' + (tagY - 9).toFixed(1) + '" width="' + (PR - 4) + '" height="18" rx="3" class="spc-tag ' + tagC + '"/><text x="' + (PL + pw + 6) + '" y="' + (tagY + 4).toFixed(1) + '" class="spc-tt">' + f2(cur) + "</text>";
    s += '<rect class="spc-hit" x="' + PL + '" y="' + PT + '" width="' + pw + '" height="' + ph + '" fill="transparent"/><g class="spc-x" style="display:none"><line y1="' + PT + '" y2="' + (PT + ph) + '"/><circle r="3.5"/></g>';
    var data = pts.map(function (x, i) { return [x[0], x[1], ev[i] == null ? null : Math.round(ev[i] * 100) / 100]; }); if (L) data.push(["live", L.v, eL == null ? null : Math.round(eL * 100) / 100]);
    var svg = '<svg class="spc-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(shortC(p.near) + "−" + shortC(p.far)) + ' spread" data-spc=\'' + JSON.stringify({ d: data, W: W, PL: PL, pw: pw, PT: PT, ph: ph, lo: lo, hi: hi, n: n }).replace(/'/g, "&#39;") + "'>" + s + "</svg>";
    /* reading */
    var chg = cur - prev, pos = hiV > loV ? (cur - loV) / (hiV - loV) * 100 : 50, above = eNow != null ? cur - eNow : null;
    var read = above == null ? "" : above > 0.05 ? "Above its 9-day EMA by " + Math.abs(above).toFixed(2) + "¢ — the spread is gaining: nearby " + shortC(p.near) + " firming against " + shortC(p.far) + " (carry narrowing)."
      : above < -0.05 ? "Below its 9-day EMA by " + Math.abs(above).toFixed(2) + "¢ — the spread is weakening: " + shortC(p.far) + " gaining on " + shortC(p.near) + " (carry widening)." : "At its 9-day EMA — no direction.";
    read += " Sits " + pos.toFixed(0) + "% of the way from the " + RANGES.filter(function (r) { return r[0] === rk; })[0][1] + " low to the high" + (pos >= 85 ? " — testing the top of its range." : pos <= 15 ? " — testing the bottom of its range." : ".");
    var kp = function (l, v, c) { return '<div class="spc-k"><span>' + l + "</span><b" + (c ? ' class="' + c + '"' : "") + ">" + v + "</b></div>"; };
    var rng = '<span class="spc-rg">' + RANGES.map(function (r) { return '<button data-spcr="' + key + slot + ":" + r[0] + '" aria-pressed="' + (r[0] === rk) + '">' + r[1] + "</button>"; }).join("") + "</span>";
    return '<div class="spc-k-row">' +
      kp(L ? "Live · " + esc(L.label) : "Settle · " + dl(pts[pts.length - 1][0]), c2(cur), "") + kp(L ? "vs settle" : "vs prior settle", c2(chg), chg > 0.005 ? "up" : chg < -0.005 ? "dn" : "") +
      kp("9-day EMA", c2(eNow), "ema") + kp("High", c2(hiV) + " <small>" + dAt(hiI) + "</small>", "up") + kp("Low", c2(loV) + " <small>" + dAt(loI) + "</small>", "dn") + rng + "</div>" +
      '<div class="spc-cw">' + svg + '<div class="spc-tip" hidden></div></div><p class="spc-rd">' + esc(read) + "</p>";
  }
  function qAge(g, p) {   /* when the delayed quotes behind the live end were stamped */
    var Q = g.quotes || {}, a = Q[p.near], b = Q[p.far], t = Math.max(a && Date.parse(a.ts) || 0, b && Date.parse(b.ts) || 0);
    if (!t) return "Delayed quotes · not streaming now (market closed or feed paused)";
    return "Delayed quotes · last print " + new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) + " ET";
  }
  function tile(key) {
    var D = root.DATA, g = D && D.grains && D.grains[key]; if (!g || !g.spreads) return "";
    var P = pairs(g); if (!P.front) return "";
    var mode = PAIR2[key] === "front" ? "front" : "next", p2 = mode === "front" ? P.fromFront || P.fromNext : P.fromNext || P.fromFront;
    function head(p, sub, extra) { return '<div class="spc-h"><b>' + esc(shortC(p.near)) + "−" + esc(shortC(p.far)) + "</b><span>" + sub + "</span>" + (extra || "") + "</div>"; }
    var tg = P.fromFront && P.fromNext ? '<span class="spc-pt">' + ["next", "front"].map(function (m) { var q = m === "front" ? P.fromFront : P.fromNext; return '<button data-spcp="' + key + ":" + m + '" aria-pressed="' + (mode === m) + '">' + esc(shortC(q.near)) + "−" + esc(shortC(q.far)) + "</button>"; }).join("") + "</span>" : "";
    return '<div class="tile wide spc-tile" data-src="grains_settle" data-spck="' + key + '"><h2>Calendar spread charts <span class="h2note">— front roll and next roll · daily settles, live end from the delayed quotes · ¢/bu, near − far</span></h2>' +
      '<div class="spc-cdb"><span class="spc-dot"></span><span class="spc-qa">' + qAge(g, P.front) + '</span><span class="spc-cd" data-spccd>next update —</span></div>' +
      '<div class="spc-grid"><div class="spc-c">' + head(P.front, "Front roll") + chart(g, P.front, key, "a") + "</div>" +
      (p2 ? '<div class="spc-c">' + head(p2, "Next roll", tg) + chart(g, p2, key, "b") + "</div>" : "") + "</div>" +
      '<div class="legend"><span><span class="sw" style="background:#38b6c9"></span>Spread (settle)</span><span><span class="sw" style="background:#e8a33d"></span>9-day EMA</span><span><span class="sw" style="background:#3fb97f"></span>Period high</span><span><span class="sw" style="background:#e0655f"></span>Period low</span><span><span class="sw" style="background:#fff"></span>Live (delayed quote)</span></div>' +
      '<div class="stamp">' + esc(g.spreads.src || "") + " · settles through " + esc(dl(g.spreads.asof)) + " · negative = carry (deferred above nearby); a rising spread means the nearby is gaining · hover a chart for each day</div></div>";
  }
  function repaint(key) { [].forEach.call(doc.querySelectorAll('.spc-tile[data-spck="' + key + '"]'), function (el) { var w = doc.createElement("div"); w.innerHTML = tile(key); if (w.firstChild) el.replaceWith(w.firstChild); }); }   /* every copy of the tile (it can sit in more than one sub-tab) */
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-spcp],[data-spcr]"); if (!b) return;
    if (b.hasAttribute("data-spcp")) { var a = b.getAttribute("data-spcp").split(":"); PAIR2[a[0]] = a[1]; try { localStorage.setItem("desk.spc.pair2", JSON.stringify(PAIR2)); } catch (e) {} repaint(a[0]); }
    else { var r = b.getAttribute("data-spcr").split(":"); RNG[r[0]] = r[1]; try { localStorage.setItem("desk.spc.rng", JSON.stringify(RNG)); } catch (e) {} repaint(r[0].slice(0, -1)); }
  });
  /* hover: date, spread, EMA */
  doc.addEventListener("mousemove", function (ev) {
    var svg = ev.target.closest && ev.target.closest(".spc-svg"); if (!svg) return;
    var o; try { o = JSON.parse(svg.getAttribute("data-spc")); } catch (e) { return; }
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * o.W, i = Math.round((x - o.PL) / o.pw * (o.n - 1)); i = Math.max(0, Math.min(o.d.length - 1, i));
    var d = o.d[i], X = o.PL + o.pw * i / Math.max(1, o.n - 1), Y = o.PT + o.ph * (1 - (d[1] - o.lo) / (o.hi - o.lo)), g = svg.querySelector(".spc-x"), tip = svg.parentNode.querySelector(".spc-tip");
    g.style.display = ""; g.querySelector("line").setAttribute("x1", X); g.querySelector("line").setAttribute("x2", X); g.querySelector("circle").setAttribute("cx", X); g.querySelector("circle").setAttribute("cy", Y);
    tip.hidden = false; tip.innerHTML = "<b>" + (d[0] === "live" ? "Live" : dl(d[0])) + "</b> " + c2(d[1]) + (d[2] != null ? ' <span class="ema">EMA ' + c2(d[2]) + "</span>" : "");
    tip.style.left = Math.min(r.width - 150, Math.max(0, X / o.W * r.width - 60)) + "px";
  });
  doc.addEventListener("mouseout", function (ev) { var svg = ev.target.closest && ev.target.closest(".spc-svg"); if (!svg || svg.contains(ev.relatedTarget)) return; svg.querySelector(".spc-x").style.display = "none"; svg.parentNode.querySelector(".spc-tip").hidden = true; });
  /* live end: repaint visible tiles every 30 s (the quotes refresh in DATA through the live feed) */
  setInterval(function () { if (root.DESK_LOCKED) return; [].forEach.call(doc.querySelectorAll(".spc-tile"), function (el) { if (el.offsetParent && !el.matches(":hover")) repaint(el.getAttribute("data-spck")); }); }, 30000);
  /* countdown to the next delayed-quote read (live.json, every 60 s) */
  setInterval(function () {
    var n = root.DESK_LIVE_NEXT, els = doc.querySelectorAll("[data-spccd]"); if (!els.length) return;
    var s = n ? Math.max(0, Math.round((n - Date.now()) / 1000)) : null, t = s == null ? "next update —" : s === 0 ? "updating…" : "next update in " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    [].forEach.call(els, function (e) { if (e.textContent !== t) e.textContent = t; });
  }, 1000);
  var css = doc.createElement("style");
  css.textContent = ".spc-cdb{display:flex;align-items:center;gap:10px;margin:2px 0 8px;font-size:12px;color:var(--faint)}.spc-dot{width:7px;height:7px;border-radius:50%;background:#e8a33d;box-shadow:0 0 0 3px rgba(232,163,61,.15)}.spc-cd{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;color:#e8a33d;border:1px solid rgba(232,163,61,.4);border-radius:999px;padding:2px 10px}.spc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px;margin-top:8px}.spc-c{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#05070b;min-width:0}" +
    ".spc-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}.spc-h b{font:600 15px 'IBM Plex Mono',monospace;color:#fff}.spc-h>span{font:600 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}" +
    ".spc-pt,.spc-rg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;padding:2px;gap:2px;margin-left:auto}.spc-pt button,.spc-rg button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 11.5px 'IBM Plex Mono',monospace;padding:3px 9px;border-radius:6px;cursor:pointer}" +
    ".spc-pt button[aria-pressed=true],.spc-rg button[aria-pressed=true]{background:var(--amber);color:#101825}" +
    ".spc-k-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:flex-end;margin-bottom:6px}.spc-k span{display:block;font:600 9.5px 'IBM Plex Sans',sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}.spc-k b{font:600 15px 'IBM Plex Mono',monospace;color:#fff}.spc-k b small{font-size:10px;color:var(--faint);font-weight:400}" +
    ".spc-k b.up{color:#3fb97f}.spc-k b.dn{color:#e0655f}.spc-k b.ema{color:#e8a33d}" +
    ".spc-cw{position:relative}.spc-svg{width:100%;height:auto;display:block}.spc-ax{fill:#8f9db3;font:10px 'IBM Plex Mono',monospace}" +
    ".spc-ln{fill:none;stroke:#38b6c9;stroke-width:1.8;stroke-linejoin:round;vector-effect:non-scaling-stroke}.spc-ema{fill:none;stroke:#e8a33d;stroke-width:1.6;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}" +
    ".spc-hi{stroke:#3fb97f;stroke-dasharray:2 4;opacity:.75;vector-effect:non-scaling-stroke}.spc-lo{stroke:#e0655f;stroke-dasharray:2 4;opacity:.75;vector-effect:non-scaling-stroke}.spc-hl{font:600 9.5px 'IBM Plex Mono',monospace}.spc-hl.g{fill:#3fb97f}.spc-hl.r{fill:#e0655f}" +
    ".spc-dh{fill:#3fb97f}.spc-dl{fill:#e0655f}.spc-ls{fill:#38b6c9}.spc-ld{fill:#fff;stroke:#38b6c9;stroke-width:2;animation:spcP 1.6s ease-in-out infinite}.spc-lv{stroke:#fff;stroke-dasharray:3 3;opacity:.7;vector-effect:non-scaling-stroke}" +
    "@keyframes spcP{50%{opacity:.45}}@media (prefers-reduced-motion:reduce){.spc-ld{animation:none}}" +
    ".spc-tag.st{fill:#38b6c9}.spc-tag.lv{fill:#fff}.spc-tt{fill:#06121a;font:700 10.5px 'IBM Plex Mono',monospace}" +
    ".spc-x line{stroke:#5b6b82;stroke-dasharray:2 2}.spc-x circle{fill:#fff}.spc-tip{position:absolute;top:2px;background:#0b111b;border:1px solid var(--line2);border-radius:6px;padding:4px 8px;font:11.5px 'IBM Plex Mono',monospace;color:#fff;pointer-events:none;white-space:nowrap}.spc-tip .ema{color:#e8a33d;margin-left:6px}" +
    ".spc-rd{margin:6px 0 0;font-size:12.5px;color:#cfd8e6;line-height:1.45}" +
    "@media (max-width:640px){.spc-grid{grid-template-columns:1fr}.spc-rg{margin-left:0}}";
  doc.head.appendChild(css);
  root.SPREADC = { tile: tile, ema: ema, _live: live };
})(window);
