/* gamma-ui.js — gamma bell curve & dealer GEX profile chart, shared by the grain Options Chain and the US Markets index
   gamma section (owner, Nov 23 2026).
   X = strikes (ascending), dashed line at spot. Bars (left axis) = net dealer GEX per strike in $ per 1% move
   (call GEX − put GEX: dealers assumed long call gamma, short put gamma). Curves = the gamma of a single option struck at
   each strike, at the current ATM IV (solid) and at a "normal" IV (dashed) — the width of the bell shows how far hedging
   flows spread. Dotted line (right axis) = the IV skew from the chain. Shaded band = ±1σ expected move to the horizon.
   Pins: put wall, call wall, gamma flip. Nothing is drawn for a value the chain does not carry. */
(function () {
  "use strict";
  var doc = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function npdf(x) { return 0.3989423 * Math.exp(-x * x / 2); }
  /* gamma of one option struck at K, per 1 unit of the underlying (Black-Scholes/76, rates ignored — shape only) */
  function g1(S, K, T, ivPct) { var s = ivPct / 100; if (!(s > 0) || !(T > 0)) return 0; var d1 = (Math.log(S / K) + s * s * T / 2) / (s * Math.sqrt(T)); return npdf(d1) / (S * s * Math.sqrt(T)); }
  function money(v) { var a = Math.abs(v), sg = v < 0 ? "−" : "+"; return sg + "$" + (a >= 1000 ? (a / 1000).toFixed(2) + "B" : a >= 10 ? a.toFixed(0) + "M" : a >= 1 ? a.toFixed(1) + "M" : (a * 1000).toFixed(0) + "K"); }

  /* o: { id, spot, rows:[{K, net($M), civ, piv, coi, poi}], iv, normalIv, normalLab, T (years), horizon, em, callWall, putWall, flip,
         kfmt(fn), sfmt(fn), unit } */
  function chart(o) {
    o.dfmt = o.dfmt || o.sfmt;
    var R = (o.rows || []).filter(function (r) { return r.K > 0; }).sort(function (a, b) { return a.K - b.K; });
    if (R.length < 3) return '<p class="note">Not enough strikes in the chain to draw the gamma profile.</p>';
    var W = 980, H = 380, PL = 70, PR = 62, PT = 34, PB = 46;
    var k0 = R[0].K, k1 = R[R.length - 1].K, S = o.spot;
    if (S < k0) k0 = S; if (S > k1) k1 = S;
    var X = function (k) { return PL + (W - PL - PR) * (k - k0) / ((k1 - k0) || 1); };
    var gm = R.map(function (r) { return r.net; }).filter(function (v) { return v != null && isFinite(v); });
    var ab = gm.map(Math.abs).sort(function (a, b) { return a - b; }), top = ab[ab.length - 1] || 1e-9, p90 = ab[Math.floor(ab.length * 0.9)] || top;
    var gmax = Math.max(1e-9, top > 4 * p90 && p90 > 0 ? p90 * 2 : top);   /* one outsized strike would flatten every other bar: clip it and label it */
    var Yg = function (v) { return PT + (H - PT - PB) / 2 - v / gmax * ((H - PT - PB) / 2 - 6); }, y0 = Yg(0);
    var out = "", step = (k1 - k0) / Math.max(1, R.length - 1), bw = Math.max(2, Math.min(18, (W - PL - PR) / R.length * 0.7));
    /* probability bands to the horizon (owner, Nov 23 2026): 68% (z 1.00), 95% (z 1.96), 99.5% (z 2.81) — log-normal on today's ATM IV */
    var ZB = [[2.807, "99.5%", "z99"], [1.96, "95%", "z95"], [1.0, "68%", "z68"]], sT = o.iv && o.T ? o.iv / 100 * Math.sqrt(o.T) : null, BANDS = [];
    if (sT) ZB.forEach(function (z, zi) { var lo = S * Math.exp(-z[0] * sT), hi = S * Math.exp(z[0] * sT); BANDS.push({ z: z, lo: lo, hi: hi });
      var a = Math.max(k0, lo), b = Math.min(k1, hi);
      out += '<rect x="' + X(a) + '" y="' + PT + '" width="' + Math.max(0, X(b) - X(a)) + '" height="' + (H - PT - PB) + '" class="gx-zb ' + z[2] + '"/>';
      [lo, hi].forEach(function (v, si) { if (v < k0 || v > k1) return; out += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + PT + '" y2="' + (H - PB) + '" class="gx-zl ' + z[2] + '"/>' +
        '<text x="' + (X(v) + (si ? -4 : 4)) + '" y="' + (H - PB - 6 - zi * 13) + '" class="gx-zt ' + z[2] + '" text-anchor="' + (si ? "end" : "start") + '">' + z[1] + " " + esc(o.sfmt(v)) + "</text>"; }); });
    /* grid + zero line + left axis ticks */
    [-1, -0.5, 0, 0.5, 1].forEach(function (f) { var v = f * gmax, y = Yg(v);
      out += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y + '" y2="' + y + '" class="' + (f === 0 ? "gx-zero" : "gx-grid") + '"/><text x="' + (PL - 6) + '" y="' + (y + 4) + '" class="gx-yl" text-anchor="end">' + (f === 0 ? "0" : money(v)) + "</text>"; });
    /* net GEX bars */
    R.forEach(function (r) { if (r.net == null || !isFinite(r.net) || r.net === 0) return; var cl = Math.abs(r.net) > gmax, y = Yg(cl ? (r.net > 0 ? gmax : -gmax) : r.net);
      if (cl) out += '<text x="' + X(r.K) + '" y="' + (r.net > 0 ? y - 4 : y + 12) + '" class="gx-clip">' + money(r.net) + " ✂</text>";
      out += '<rect x="' + (X(r.K) - bw / 2) + '" y="' + Math.min(y, y0) + '" width="' + bw + '" height="' + Math.max(1, Math.abs(y - y0)) + '" class="gx-bar ' + (r.net > 0 ? "pos" : "neg") + '"><title>' + esc(o.kfmt(r.K)) + " · net GEX " + money(r.net) + " per 1% move · call OI " + (r.coi || 0).toLocaleString("en-US") + " · put OI " + (r.poi || 0).toLocaleString("en-US") + "</title></rect>"; });
    /* bell curves: single-option gamma across strikes, current vs normal IV, scaled to the upper half */
    var curve = function (iv) { if (!iv || !o.T) return null; var P = [], n = 120; for (var i = 0; i <= n; i++) { var k = k0 + (k1 - k0) * i / n; P.push([k, g1(S, k, o.T, iv)]); } return P; };
    var C1 = curve(o.iv), C0 = o.normalIv && Math.abs(o.normalIv - o.iv) > 0.05 ? curve(o.normalIv) : null;
    var cmax = Math.max.apply(null, [].concat(C1 || [], C0 || []).map(function (p) { return p[1]; }).concat([1e-12]));
    var Yc = function (v) { return PT + 4 + (y0 - PT - 8) * (1 - v / cmax); };
    var path = function (P) { return P.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Yc(p[1]).toFixed(1); }).join(""); };
    if (C0) out += '<path d="' + path(C0) + '" class="gx-c0"/>';
    if (C1) out += '<path d="' + path(C1) + "L" + X(k1) + "," + Yc(0) + "L" + X(k0) + "," + Yc(0) + 'Z" class="gx-c1f"/><path d="' + path(C1) + '" class="gx-c1"/>';
    /* IV skew on the right axis */
    var iv = R.map(function (r) { var v = r.K < S ? (r.piv || r.civ) : (r.civ || r.piv); return v ? [r.K, v] : null; }).filter(Boolean);
    if (iv.length >= 3) { var i0 = Math.min.apply(null, iv.map(function (p) { return p[1]; })), i1 = Math.max.apply(null, iv.map(function (p) { return p[1]; })), pad = Math.max(1, (i1 - i0) * 0.15);
      var Yi = function (v) { return PT + (H - PT - PB) * (1 - (v - (i0 - pad)) / ((i1 - i0 + 2 * pad) || 1)); };
      out += '<path d="' + iv.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Yi(p[1]).toFixed(1); }).join("") + '" class="gx-iv"/>';
      [i0, (i0 + i1) / 2, i1].forEach(function (v) { out += '<text x="' + (W - PR + 6) + '" y="' + (Yi(v) + 4) + '" class="gx-yl gx-ivl" text-anchor="start">' + v.toFixed(1) + "%</text>"; }); }
    /* x ticks: about 10 labels */
    var every = Math.max(1, Math.ceil(R.length / 11));
    R.forEach(function (r, i) { if (i % every) return; out += '<text x="' + X(r.K) + '" y="' + (H - PB + 16) + '" class="gx-xl">' + esc(o.kfmt(r.K)) + "</text>"; });
    /* pins */
    var used = [];   /* labels that would collide move up a row */
    var pin = function (k, lab, cls, row) { if (k == null || k < k0 || k > k1) return; var x = X(k);
      while (used.some(function (u) { return u[1] === row && Math.abs(u[0] - x) < lab.length * 6.5; })) row++; used.push([x, row]);
      out += '<line x1="' + x + '" x2="' + x + '" y1="' + PT + '" y2="' + (H - PB) + '" class="gx-pin ' + cls + '"/><text x="' + x + '" y="' + (PT - 6 - row * 12) + '" class="gx-pl ' + cls + '">' + esc(lab) + "</text>"; };
    pin(o.putWall, "Put wall " + o.kfmt(o.putWall), "pw", 0);
    pin(o.callWall, "Call wall " + o.kfmt(o.callWall), "cw", 0);
    if (o.flip != null && o.flip !== o.putWall && o.flip !== o.callWall) pin(o.flip, "Gamma flip " + o.kfmt(o.flip), "fl", 1);
    out += '<line x1="' + X(S) + '" x2="' + X(S) + '" y1="' + PT + '" y2="' + (H - PB) + '" class="gx-spot"/><text x="' + X(S) + '" y="' + (H - PB + 32) + '" class="gx-sl">Spot ' + esc(o.sfmt(S)) + "</text>";
    /* distance from spot to each wall (owner, Nov 23 2026): an arrow from the spot line to the wall, labelled in points and % */
    var dist = function (w, cls, yy) { if (w == null || !isFinite(w)) return; var wx = Math.max(PL, Math.min(W - PR, X(w))), sx = X(S); if (Math.abs(wx - sx) < 4) return;
      var d = w - S, lab = (d > 0 ? "+" : "−") + o.dfmt(Math.abs(d)) + " (" + (d > 0 ? "+" : "−") + Math.abs(d / S * 100).toFixed(2) + "%)" + (w < k0 || w > k1 ? " · off chart" : "");
      var dir = wx > sx ? 1 : -1, mid = (wx + sx) / 2;
      out += '<line x1="' + sx + '" x2="' + (wx - dir * 6) + '" y1="' + yy + '" y2="' + yy + '" class="gx-dl ' + cls + '"/>' +
        '<path d="M' + wx + "," + yy + "L" + (wx - dir * 7) + "," + (yy - 4) + "L" + (wx - dir * 7) + "," + (yy + 4) + 'Z" class="gx-da ' + cls + '"/>' +
        '<rect x="' + (mid - lab.length * 3.4 - 5) + '" y="' + (yy - 9) + '" width="' + (lab.length * 6.8 + 10) + '" height="15" rx="3" class="gx-db"/>' +
        '<text x="' + mid + '" y="' + (yy + 3) + '" class="gx-dt ' + cls + '">' + esc(lab) + "</text>"; };
    dist(o.putWall, "pw", PT + 18); dist(o.callWall, "cw", PT + 38);
    out += '<text x="16" y="' + (PT + (H - PT - PB) / 2) + '" class="gx-ax" transform="rotate(-90 16 ' + (PT + (H - PT - PB) / 2) + ')">Net GEX · $ per 1% move</text>';
    if (iv.length >= 3) out += '<text x="' + (W - 10) + '" y="' + (PT + (H - PT - PB) / 2) + '" class="gx-ax" transform="rotate(90 ' + (W - 10) + " " + (PT + (H - PT - PB) / 2) + ')">IV %</text>';
    var away = function (w) { if (w == null) return "most OI"; var d = w - o.spot; return (d >= 0 ? "+" : "−") + esc(o.dfmt(Math.abs(d))) + " (" + (d >= 0 ? "+" : "−") + Math.abs(d / o.spot * 100).toFixed(2) + "%) from spot"; };
    var tot = gm.reduce(function (a, b) { return a + b; }, 0);
    var leg = '<div class="gx-leg"><span><i class="gx-sw pos"></i>Positive GEX (dealers dampen moves)</span><span><i class="gx-sw neg"></i>Negative GEX (dealers amplify moves)</span>' +
      (C1 ? '<span><i class="gx-ln c1"></i>Gamma bell · current IV ' + o.iv.toFixed(1) + "%</span>" : "") + (C0 ? '<span><i class="gx-ln c0"></i>Normal regime · ' + o.normalIv.toFixed(1) + "% (" + esc(o.normalLab || "") + ")</span>" : "") +
      (iv.length >= 3 ? '<span><i class="gx-ln iv"></i>IV skew (right axis)</span>' : "") + (BANDS.length ? '<span><i class="gx-sw z68"></i>68% range (z 1.00)</span><span><i class="gx-sw z95"></i>95% (z 1.96)</span><span><i class="gx-sw z99"></i>99.5% (z 2.81)</span>' : "") + "</div>";
    var read = '<div class="gx-read"><div><em class=gx-k>Net GEX</em><b class="' + (tot >= 0 ? "up" : "dn") + '">' + money(tot) + '</b><small>per 1% move · ' + (tot >= 0 ? "positive: hedging dampens moves" : "negative: hedging amplifies moves") + "</small></div>" +
      "<div><em class=gx-k>Gamma flip</em><b>" + (o.flip != null ? esc(o.kfmt(o.flip)) : "—") + "</b><small>" + (o.flip != null ? (S > o.flip ? "spot above: positive-gamma side" : "spot below: negative-gamma side") : "no sign change in range") + "</small></div>" +
      "<div><em class=gx-k>Spot</em><b>" + esc(o.sfmt(o.spot)) + "</b><small>" + esc(o.spotLab || "") + "</small></div>" +
      "<div><em class=gx-k>Call wall</em><b>" + (o.callWall != null ? esc(o.kfmt(o.callWall)) : "—") + "</b><small>" + away(o.callWall) + "</small></div><div><em class=gx-k>Put wall</em><b>" + (o.putWall != null ? esc(o.kfmt(o.putWall)) : "—") + "</b><small>" + away(o.putWall) + "</small></div>" +
      "<div><em class=gx-k>ATM IV</em><b>" + (o.iv ? o.iv.toFixed(1) + "%" : "—") + "</b><small>" + (o.normalIv ? "normal " + o.normalIv.toFixed(1) + "% · " + (o.iv > o.normalIv * 1.15 ? "elevated: bell wider" : o.iv < o.normalIv * 0.87 ? "subdued: bell narrower" : "near normal") : "") + "</small></div>" +
      "<div class=gx-zr><em class=gx-k>Ranges " + esc(o.horizon || "") + "</em>" + (BANDS.length ? BANDS.slice().reverse().map(function (B) { return '<span class="gx-zrow ' + B.z[2] + '"><i></i>' + B.z[1] + " " + esc(o.sfmt(B.lo)) + " – " + esc(o.sfmt(B.hi)) + "</span>"; }).join("") : "<b>—</b>") + "</div></div>";
    /* crosshair readout data (owner, Nov 23 2026): everything the label box shows, per strike, precomputed and formatted */
    var XD = { k0: k0, k1: k1, PL: PL, PR: PR, W: W, H: H, PT: PT, PB: PB, S: S, T: o.T || 0, iv: o.iv || 0, niv: C0 ? o.normalIv : 0,
      cw: o.callWall, pw: o.putWall, fl: o.flip, b: BANDS.map(function (B) { return [B.z[1], B.lo, B.hi]; }),
      r: R.map(function (r) { var d = r.K - S; return [r.K, o.kfmt(r.K), r.net == null || !isFinite(r.net) ? null : money(r.net), r.coi || 0, r.poi || 0, r.civ || null, r.piv || null,
        (d >= 0 ? "+" : "−") + o.dfmt(Math.abs(d)) + " (" + (d >= 0 ? "+" : "−") + Math.abs(d / S * 100).toFixed(2) + "%)", r.net || 0]; }) };
    out += '<line class="gx-xh" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB) + '" visibility="hidden"/>';
    return read + '<div class="gx-wrap"><svg viewBox="0 0 ' + W + " " + H + '" class="gx-svg" role="img" aria-label="Gamma bell curve and dealer GEX profile" data-gx="' + esc(JSON.stringify(XD)) + '">' + out + '</svg><div class="gx-tip" hidden></div></div>' + leg;
  }

  /* crosshair: move the mouse (or drag a finger) across the chart — a line snaps to the nearest strike and a label box shows
     that strike's numbers (owner, Nov 23 2026) */
  function xhMove(e) {
    var svg = e.target.closest && e.target.closest(".gx-svg");
    [].forEach.call(doc.querySelectorAll(".gx-wrap"), function (w) { if (!svg || w !== svg.parentNode) xhHide(w); });
    if (!svg) return;
    var D = svg._gx; if (!D) { try { D = svg._gx = JSON.parse(svg.getAttribute("data-gx")); } catch (er) { return; } }
    var bb = svg.getBoundingClientRect(), vx = (e.clientX - bb.left) * D.W / bb.width;
    if (vx < D.PL - 8 || vx > D.W - D.PR + 8) { xhHide(svg.parentNode); return; }
    var Xf = function (k) { return D.PL + (D.W - D.PL - D.PR) * (k - D.k0) / ((D.k1 - D.k0) || 1); };
    var r = D.r.reduce(function (a, b) { return Math.abs(Xf(b[0]) - vx) < Math.abs(Xf(a[0]) - vx) ? b : a; }), x = Xf(r[0]);
    var L = svg.querySelector(".gx-xh"); L.setAttribute("x1", x); L.setAttribute("x2", x); L.setAttribute("visibility", "visible");
    var peak = D.iv ? g1(D.S, D.S, D.T, D.iv) : 0, gb = D.iv ? g1(D.S, r[0], D.T, D.iv) / (peak || 1) * 100 : null, gn = D.niv ? g1(D.S, r[0], D.T, D.niv) / (g1(D.S, D.S, D.T, D.niv) || 1) * 100 : null;
    var zone = D.b.slice().reverse().filter(function (B) { return r[0] >= B[1] && r[0] <= B[2]; })[0];
    var tag = r[0] === D.cw ? ' <i class="gx-tt cw">CALL WALL</i>' : r[0] === D.pw ? ' <i class="gx-tt pw">PUT WALL</i>' : "";
    if (r[0] === D.fl) tag += ' <i class="gx-tt fl">GAMMA FLIP</i>';
    var row = function (k, v, c) { return "<tr><td>" + k + '</td><td class="' + (c || "") + '">' + v + "</td></tr>"; };
    var tip = svg.parentNode.querySelector(".gx-tip");
    tip.innerHTML = "<b>Strike " + esc(r[1]) + "</b>" + tag + "<table>" +
      row("vs spot", esc(r[7])) +
      row("Net GEX", r[2] == null ? "—" : esc(r[2]) + " / 1%", r[8] > 0 ? "up" : r[8] < 0 ? "dn" : "") +
      row("Call OI", r[3].toLocaleString("en-US")) + row("Put OI", r[4].toLocaleString("en-US")) +
      row("Call IV", r[5] ? r[5].toFixed(2) + "%" : "—") + row("Put IV", r[6] ? r[6].toFixed(2) + "%" : "—") +
      (gb != null ? row("Bell · current IV", gb.toFixed(0) + "% of peak") : "") + (gn != null ? row("Bell · normal IV", gn.toFixed(0) + "% of peak") : "") +
      row("Range", zone ? "inside " + zone[0] : D.b.length ? "outside 99.5%" : "—") + "</table>";
    tip.hidden = false;
    var px = x / D.W * bb.width, wb = svg.parentNode.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(wb.width - tw, px + (px + 14 + tw > wb.width ? -tw - 14 : 14))) + "px";
    tip.style.top = Math.max(0, Math.min(bb.height - tip.offsetHeight, e.clientY - bb.top - 20)) + "px";
  }
  function xhHide(w) { if (!w) return; var t = w.querySelector(".gx-tip"), L = w.querySelector(".gx-xh"); if (t) t.hidden = true; if (L) L.setAttribute("visibility", "hidden"); }
  doc.addEventListener("pointermove", xhMove, { passive: true });
  doc.addEventListener("pointerdown", xhMove, { passive: true });
  doc.addEventListener("pointerleave", function () { [].forEach.call(doc.querySelectorAll(".gx-wrap"), xhHide); }, true);

  var st = doc.createElement("style");
  st.textContent =
    ".gx-read{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin:4px 0 10px}.gx-read>div{border:1px solid var(--line2);border-radius:8px;padding:5px 9px;min-width:0}" +
    ".gx-read .gx-k{display:block;font-style:normal;font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.gx-read b{font:600 15px 'IBM Plex Mono',monospace;color:var(--ink)}.gx-read b.up{color:#3fb97f}.gx-read b.dn{color:#ff6b62}.gx-read small{display:block;font-size:11px;color:var(--faint)}" +
    ".gx-wrap{position:relative}.gx-svg{touch-action:pan-y;cursor:crosshair}.gx-xh{stroke:var(--ink,#e8edf3);stroke-width:1;opacity:.75;pointer-events:none}" +
    ".gx-tip{position:absolute;z-index:5;pointer-events:none;min-width:190px;background:var(--panel,#0b1016);border:1px solid var(--line2,#2a3442);border-radius:8px;padding:7px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);font:12px 'IBM Plex Mono',monospace;color:var(--ink,#e8edf3)}" +
    ".gx-tip table{border-collapse:collapse;margin-top:4px;width:100%}.gx-tip td{padding:1px 0;white-space:nowrap}.gx-tip td:first-child{color:var(--muted,#8a97a8);padding-right:12px}.gx-tip td:last-child{text-align:right}.gx-tip .up{color:#3fb97f}.gx-tip .dn{color:#ff6b62}" +
    ".gx-tt{font-style:normal;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;border:1px solid}.gx-tt.cw{color:#5fd39a}.gx-tt.pw{color:#ff8a84}.gx-tt.fl{color:#c9a3ff}" +
    ".gx-svg{width:100%;height:auto;display:block}.gx-svg text{font-family:'IBM Plex Mono',monospace}" +
    ".gx-grid{stroke:var(--line);stroke-width:1}.gx-zero{stroke:var(--line2);stroke-width:1.2}.gx-yl{font-size:10.5px;fill:var(--muted)}.gx-ivl{fill:#e3c14d}.gx-xl{font-size:10.5px;fill:var(--muted);text-anchor:middle}.gx-ax{font-size:10.5px;fill:var(--faint);text-anchor:middle}" +
    ".gx-clip{font-size:10.5px;fill:#e3c14d;text-anchor:middle;font-weight:700}.gx-bar.pos{fill:rgba(63,185,127,.85)}.gx-bar.neg{fill:rgba(224,101,95,.85)}" +
    ".gx-c1{fill:none;stroke:#38c6d9;stroke-width:2.4}.gx-c1f{fill:rgba(56,198,217,.10)}.gx-c0{fill:none;stroke:#9aa5b4;stroke-width:1.6;stroke-dasharray:6 4}.gx-iv{fill:none;stroke:#e3c14d;stroke-width:1.8;stroke-dasharray:2 4}" +
    ".gx-zb{stroke:none}.gx-zb.z99{fill:rgba(224,101,95,.07)}.gx-zb.z95{fill:rgba(227,193,77,.08)}.gx-zb.z68{fill:rgba(63,185,127,.10)}" +
    ".gx-zl{stroke-width:1.2;stroke-dasharray:4 3}.gx-zl.z99{stroke:#e0655f}.gx-zl.z95{stroke:#e3c14d}.gx-zl.z68{stroke:#3fb97f}.gx-zt{font-size:10.5px;font-weight:700}.gx-zt.z99{fill:#ff8a84}.gx-zt.z95{fill:#e3c14d}.gx-zt.z68{fill:#5fd39a}" +
    ".gx-sw.z68{background:rgba(63,185,127,.55)}.gx-sw.z95{background:rgba(227,193,77,.55)}.gx-sw.z99{background:rgba(224,101,95,.55)}" +
    ".gx-read .gx-zr{grid-column:span 2}.gx-zr .gx-zrow{display:flex;align-items:center;gap:5px;font:600 11.5px 'IBM Plex Mono',monospace;white-space:nowrap}.gx-zrow i{width:9px;height:9px;border-radius:2px;display:inline-block}.gx-zrow.z68{color:#5fd39a}.gx-zrow.z68 i{background:#3fb97f}.gx-zrow.z95{color:#e3c14d}.gx-zrow.z95 i{background:#e3c14d}.gx-zrow.z99{color:#ff8a84}.gx-zrow.z99 i{background:#e0655f}" +
    ".gx-spot{stroke:var(--ink);stroke-width:1.4;stroke-dasharray:5 4}.gx-sl{font-size:11px;fill:var(--ink);text-anchor:middle;font-weight:600}" +
    ".gx-dl{stroke-width:1.6}.gx-dl.pw{stroke:#ff8a84}.gx-dl.cw{stroke:#5fd39a}.gx-da.pw{fill:#ff8a84}.gx-da.cw{fill:#5fd39a}.gx-db{fill:var(--panel,#0b1016);opacity:.92}.gx-dt{font-size:10.5px;text-anchor:middle;font-weight:700}.gx-dt.pw{fill:#ff8a84}.gx-dt.cw{fill:#5fd39a}" +
    ".gx-pin{stroke-width:1.2;stroke-dasharray:2 3}.gx-pin.pw{stroke:#ff6b62}.gx-pin.cw{stroke:#3fb97f}.gx-pin.fl{stroke:#b18cff}.gx-pl{font-size:10.5px;text-anchor:middle;font-weight:600}.gx-pl.pw{fill:#ff8a84}.gx-pl.cw{fill:#5fd39a}.gx-pl.fl{fill:#c9a3ff}" +
    ".gx-leg{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center;font-size:11.5px;color:var(--muted);margin:4px 0 2px}.gx-leg span{display:inline-flex;align-items:center;gap:5px}" +
    ".gx-sw{width:12px;height:9px;display:inline-block}.gx-sw.pos{background:#3fb97f}.gx-sw.neg{background:#e0655f}.gx-sw.em{background:rgba(217,180,106,.35)}" +
    ".gx-ln{width:20px;height:0;display:inline-block;border-top:2.4px solid}.gx-ln.c1{border-color:#38c6d9}.gx-ln.c0{border-top:2px dashed #9aa5b4}.gx-ln.iv{border-top:2px dotted #e3c14d}";
  doc.head.appendChild(st);
  window.GAMMA_UI = { chart: chart, g1: g1 };
})();
