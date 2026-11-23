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
    /* ±1σ expected move band */
    if (o.em) { var a = Math.max(k0, S - o.em), b = Math.min(k1, S + o.em);
      out += '<rect x="' + X(a) + '" y="' + PT + '" width="' + Math.max(0, X(b) - X(a)) + '" height="' + (H - PT - PB) + '" class="gx-em"/>' +
        '<text x="' + (X(a) + 4) + '" y="' + (H - PB - 6) + '" class="gx-eml" text-anchor="start">±1σ ' + esc(o.horizon || "") + " " + esc(o.sfmt(S - o.em)) + " – " + esc(o.sfmt(S + o.em)) + "</text>"; }
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
    var pin = function (k, lab, cls, row) { if (k == null || k < k0 || k > k1) return; var x = X(k);
      out += '<line x1="' + x + '" x2="' + x + '" y1="' + PT + '" y2="' + (H - PB) + '" class="gx-pin ' + cls + '"/><text x="' + x + '" y="' + (PT - 6 - row * 12) + '" class="gx-pl ' + cls + '">' + esc(lab) + "</text>"; };
    pin(o.putWall, "Put wall " + o.kfmt(o.putWall), "pw", 0);
    pin(o.callWall, "Call wall " + o.kfmt(o.callWall), "cw", 0);
    if (o.flip != null && o.flip !== o.putWall && o.flip !== o.callWall) pin(o.flip, "Gamma flip " + o.kfmt(o.flip), "fl", 1);
    out += '<line x1="' + X(S) + '" x2="' + X(S) + '" y1="' + PT + '" y2="' + (H - PB) + '" class="gx-spot"/><text x="' + X(S) + '" y="' + (H - PB + 32) + '" class="gx-sl">Spot ' + esc(o.sfmt(S)) + "</text>";
    out += '<text x="16" y="' + (PT + (H - PT - PB) / 2) + '" class="gx-ax" transform="rotate(-90 16 ' + (PT + (H - PT - PB) / 2) + ')">Net GEX · $ per 1% move</text>';
    if (iv.length >= 3) out += '<text x="' + (W - 10) + '" y="' + (PT + (H - PT - PB) / 2) + '" class="gx-ax" transform="rotate(90 ' + (W - 10) + " " + (PT + (H - PT - PB) / 2) + ')">IV %</text>';
    var tot = gm.reduce(function (a, b) { return a + b; }, 0);
    var leg = '<div class="gx-leg"><span><i class="gx-sw pos"></i>Positive GEX (dealers dampen moves)</span><span><i class="gx-sw neg"></i>Negative GEX (dealers amplify moves)</span>' +
      (C1 ? '<span><i class="gx-ln c1"></i>Gamma bell · current IV ' + o.iv.toFixed(1) + "%</span>" : "") + (C0 ? '<span><i class="gx-ln c0"></i>Normal regime · ' + o.normalIv.toFixed(1) + "% (" + esc(o.normalLab || "") + ")</span>" : "") +
      (iv.length >= 3 ? '<span><i class="gx-ln iv"></i>IV skew (right axis)</span>' : "") + (o.em ? '<span><i class="gx-sw em"></i>±1σ expected move</span>' : "") + "</div>";
    var read = '<div class="gx-read"><div><em class=gx-k>Net GEX</em><b class="' + (tot >= 0 ? "up" : "dn") + '">' + money(tot) + '</b><small>per 1% move · ' + (tot >= 0 ? "positive: hedging dampens moves" : "negative: hedging amplifies moves") + "</small></div>" +
      "<div><em class=gx-k>Gamma flip</em><b>" + (o.flip != null ? esc(o.kfmt(o.flip)) : "—") + "</b><small>" + (o.flip != null ? (S > o.flip ? "spot above: positive-gamma side" : "spot below: negative-gamma side") : "no sign change in range") + "</small></div>" +
      "<div><em class=gx-k>Call wall</em><b>" + (o.callWall != null ? esc(o.kfmt(o.callWall)) : "—") + "</b><small>most call OI</small></div><div><em class=gx-k>Put wall</em><b>" + (o.putWall != null ? esc(o.kfmt(o.putWall)) : "—") + "</b><small>most put OI</small></div>" +
      "<div><em class=gx-k>ATM IV</em><b>" + (o.iv ? o.iv.toFixed(1) + "%" : "—") + "</b><small>" + (o.normalIv ? "normal " + o.normalIv.toFixed(1) + "% · " + (o.iv > o.normalIv * 1.15 ? "elevated: bell wider" : o.iv < o.normalIv * 0.87 ? "subdued: bell narrower" : "near normal") : "") + "</small></div>" +
      "<div><em class=gx-k>Expected move · 1σ</em><b>" + (o.em ? "±" + esc(o.sfmt(o.em)) : "—") + "</b><small>" + esc(o.horizon || "") + "</small></div></div>";
    return read + '<svg viewBox="0 0 ' + W + " " + H + '" class="gx-svg" role="img" aria-label="Gamma bell curve and dealer GEX profile">' + out + "</svg>" + leg;
  }

  var st = doc.createElement("style");
  st.textContent =
    ".gx-read{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin:4px 0 10px}.gx-read>div{border:1px solid var(--line2);border-radius:8px;padding:5px 9px;min-width:0}" +
    ".gx-read .gx-k{display:block;font-style:normal;font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.gx-read b{font:600 15px 'IBM Plex Mono',monospace;color:var(--ink)}.gx-read b.up{color:#3fb97f}.gx-read b.dn{color:#ff6b62}.gx-read small{display:block;font-size:11px;color:var(--faint)}" +
    ".gx-svg{width:100%;height:auto;display:block}.gx-svg text{font-family:'IBM Plex Mono',monospace}" +
    ".gx-grid{stroke:var(--line);stroke-width:1}.gx-zero{stroke:var(--line2);stroke-width:1.2}.gx-yl{font-size:10.5px;fill:var(--muted)}.gx-ivl{fill:#e3c14d}.gx-xl{font-size:10.5px;fill:var(--muted);text-anchor:middle}.gx-ax{font-size:10.5px;fill:var(--faint);text-anchor:middle}" +
    ".gx-clip{font-size:10.5px;fill:#e3c14d;text-anchor:middle;font-weight:700}.gx-bar.pos{fill:rgba(63,185,127,.85)}.gx-bar.neg{fill:rgba(224,101,95,.85)}" +
    ".gx-c1{fill:none;stroke:#38c6d9;stroke-width:2.4}.gx-c1f{fill:rgba(56,198,217,.10)}.gx-c0{fill:none;stroke:#9aa5b4;stroke-width:1.6;stroke-dasharray:6 4}.gx-iv{fill:none;stroke:#e3c14d;stroke-width:1.8;stroke-dasharray:2 4}" +
    ".gx-em{fill:rgba(217,180,106,.08)}.gx-eml{font-size:10.5px;fill:#d9b46a}" +
    ".gx-spot{stroke:var(--ink);stroke-width:1.4;stroke-dasharray:5 4}.gx-sl{font-size:11px;fill:var(--ink);text-anchor:middle;font-weight:600}" +
    ".gx-pin{stroke-width:1.2;stroke-dasharray:2 3}.gx-pin.pw{stroke:#ff6b62}.gx-pin.cw{stroke:#3fb97f}.gx-pin.fl{stroke:#b18cff}.gx-pl{font-size:10.5px;text-anchor:middle;font-weight:600}.gx-pl.pw{fill:#ff8a84}.gx-pl.cw{fill:#5fd39a}.gx-pl.fl{fill:#c9a3ff}" +
    ".gx-leg{display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center;font-size:11.5px;color:var(--muted);margin:4px 0 2px}.gx-leg span{display:inline-flex;align-items:center;gap:5px}" +
    ".gx-sw{width:12px;height:9px;display:inline-block}.gx-sw.pos{background:#3fb97f}.gx-sw.neg{background:#e0655f}.gx-sw.em{background:rgba(217,180,106,.35)}" +
    ".gx-ln{width:20px;height:0;display:inline-block;border-top:2.4px solid}.gx-ln.c1{border-color:#38c6d9}.gx-ln.c0{border-top:2px dashed #9aa5b4}.gx-ln.iv{border-top:2px dotted #e3c14d}";
  doc.head.appendChild(st);
  window.GAMMA_UI = { chart: chart, g1: g1 };
})();
