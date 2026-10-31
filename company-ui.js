/* Company intelligence workspace (US Earnings tab). Loaded after earnings-ui.js; uses co-engine.js.
   Data arrives live from the AGRITrade SEC Worker when a ticker is LOCKED — nothing is stored: the parsed company is
   kept in page memory for this visit only. Before a ticker is locked, nothing is fetched or shown.

   Worker address (public, not a secret): open the desk once with ?worker=https://<name>.<account>.workers.dev
   — it is remembered in this browser. */
(function () {
  "use strict";
  var E = window.COENGINE; if (!E) return;
  var WK = "desk.secWorker";
  try { var w = new URLSearchParams(location.search).get("worker"); if (w && /^https:\/\/[\w.-]+\.workers\.dev\/?$/.test(w)) localStorage.setItem(WK, w.replace(/\/$/, "")); if (w === "off") localStorage.setItem(WK, "off"); } catch (e) {}
  var DEFAULT_WORKER = "https://agritrade.anirudh-p-doshi.workers.dev";   /* deployed 31 Oct 2026; ?worker=… overrides, ?worker=off disables */
  function worker() { try { var w = localStorage.getItem(WK); return w === "off" ? "" : w || DEFAULT_WORKER; } catch (e) { return DEFAULT_WORKER; } }
  var MEM = {}, card = null, rerender = function () { if (window.EARNINGS) EARNINGS.render(); };
  var C1 = "#1f9db3", C2 = "#c4842a", C3 = "#9468d6", C4 = "#d0607a";   /* validated categorical order (dark surface) */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var f$ = E.fmt;
  function pc(v, d) { if (v == null || !isFinite(v)) return "—"; var t = Math.abs(v).toFixed(d == null ? 1 : d); return (+t === 0 ? "" : v > 0 ? "+" : "−") + t + "%"; }
  function pp(v) { return v == null ? "—" : pc(v).replace("%", " pp"); }
  function sgc(v, txt) { return '<span class="' + (v == null || Math.abs(v) < 0.05 ? "neu" : v > 0 ? "up" : "dn") + '">' + txt + "</span>"; }
  function money(v) { return v == null ? "—" : v < 0 ? "−$" + f$(-v) : "$" + f$(v); }
  /* direction that is GOOD for each metric: +1 higher is better, −1 lower is better, 0 neutral (colour by sign is misleading) */
  var GOOD = { gdebt: -1, ndebt: -1, dso: -1, dio: -1, ccc: -1, effcost: -1, cashcost: -1, nd_ebitda: -1, de: -1, da_r: -1, intburden: -1, sh_d: -1, cogs: -1,
    capex: 0, sga: 0, rnd: 0, dpo: 0, da: 0, intexp: -1, tax: 0 };
  function tone(k, v) { var base = String(k).replace(/_(yoy|qoq)$/, ""), g = GOOD[base]; return v == null ? null : g === 0 ? 0 : g === -1 ? -v : v; }

  /* ---------------- data ---------------- */
  function search(q) {
    if (!worker()) return Promise.resolve(null);
    return fetch(worker() + "/search?q=" + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) { return j.results || []; });
  }
  function load(t) {
    if (MEM[t] && (MEM[t].M || MEM[t].loading)) return;
    MEM[t] = { loading: true };
    if (!worker()) { MEM[t] = { err: "nowk" }; return; }
    var a = fetch(worker() + "/company?t=" + encodeURIComponent(t)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
    var b = fetch(worker() + "/prices?t=" + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([a, b]).then(function (x) {
      var co = x[0], M = E.build(co); MEM[t] = { co: co, M: M, P: x[1], V: E.verdicts(M, x[1]), at: new Date().toISOString() }; rerender();
    }).catch(function (e) { MEM[t] = { err: String(e.message || e) }; rerender(); });
  }

  /* ---------------- CSS ---------------- */
  var css = document.createElement("style");
  css.textContent =
    ".cx-h{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}.cx-h h2{margin:0}.cx-sub{font-size:12.5px;color:var(--muted)}" +
    ".cx-part{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:16px 0 6px}" +
    ".cx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}" +
    ".cx-card{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:3px;min-height:132px;transition:border-color .12s,transform .12s}" +
    ".cx-card:hover:not(:disabled){border-color:#3d5a80;transform:translateY(-1px)}.cx-card:disabled{cursor:default;opacity:.45;min-height:0;border-style:dashed}" +
    ".cx-card .t{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.cx-card .k{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600}" +
    ".cx-card .q{font-size:11.5px;color:var(--faint);line-height:1.35;margin-top:auto}.cx-card .n{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint)}" +
    ".cx-vd{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid;letter-spacing:.04em}" +
    ".cx-vd.STRONG{color:#3fb97f;border-color:rgba(63,185,127,.6);background:rgba(63,185,127,.1)}.cx-vd.SOLID{color:#7fcfa7;border-color:rgba(63,185,127,.35)}" +
    ".cx-vd.MIXED{color:var(--muted);border-color:var(--line2)}.cx-vd.WEAK,.cx-vd.STRETCHED{color:#e8a33d;border-color:rgba(232,163,61,.5)}" +
    ".cx-vd.NEGATIVE{color:#e0655f;border-color:rgba(224,101,95,.6);background:rgba(224,101,95,.1)}.cx-vd.UNAVAILABLE{color:var(--faint);border-color:var(--line2);border-style:dashed}" +
    ".cx-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.cx-tile{border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:var(--panel2)}" +
    ".cx-tile .l{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}.cx-tile .v{font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:600;margin:2px 0}" +
    ".cx-tile .s{font-size:11.5px;color:var(--muted);font-family:'IBM Plex Mono',monospace}" +
    ".cx-vg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cx-v{border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:var(--panel2)}" +
    ".cx-v h3{margin:0 0 3px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px}.cx-v .qq{font-size:11.5px;color:var(--faint);margin-bottom:6px}" +
    ".cx-ev{font-size:12.5px;line-height:1.45;padding:3px 0 3px 16px;position:relative}.cx-ev:before{position:absolute;left:0;font-family:'IBM Plex Mono',monospace;font-weight:700}" +
    ".cx-ev.p:before{content:'+';color:var(--green)}.cx-ev.n:before{content:'−';color:var(--red)}.cx-ev small{color:var(--faint);font-family:'IBM Plex Mono',monospace;font-size:10.5px}" +
    "table.cx-hm{border-collapse:separate;border-spacing:3px;width:100%}table.cx-hm td,table.cx-hm th{text-align:center;font-size:11px;padding:6px 4px;border:0}table.cx-hm td{border-radius:4px;font-family:'IBM Plex Mono',monospace;font-weight:600}" +
    "table.cx-hm td.r{text-align:left;font-family:'Libre Franklin',sans-serif;font-weight:400;color:var(--muted);white-space:nowrap}" +
    ".cx-hd{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}" +
    ".cx-hd .big{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600;line-height:1}.cx-hd .lab{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}" +
    ".cx-hd .m{font-family:'IBM Plex Mono',monospace;font-size:13px}" +
    ".cx-sec{margin-top:14px}.cx-sec>.pi-l{margin-bottom:4px}" +
    ".cx-ai{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cx-ai>div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.5;background:var(--panel2)}" +
    ".cx-ai b{display:block;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);margin-bottom:3px}.cx-ai .hyp{color:var(--muted);font-style:italic}" +
    ".cx-st{font-family:'IBM Plex Mono',monospace;font-size:9.5px;padding:1px 5px;border-radius:7px;border:1px solid var(--line2);color:var(--faint);white-space:nowrap}.cx-st.C{border-style:dashed}" +
    "table.cx-t{width:100%;border-collapse:collapse}table.cx-t td:first-child,table.cx-t th:first-child{text-align:left;font-family:'Libre Franklin',sans-serif}" +
    "details.cx-evd{border:1px solid var(--line);border-radius:8px;padding:8px 11px;margin-top:14px}details.cx-evd summary{cursor:pointer;font-size:12.5px;color:var(--muted)}" +
    ".cx-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin:2px 0 4px}.cx-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}" +
    ".cx-2{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}@media (min-width:1900px){.cx-2{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}}" +
    "@media (max-width:1100px){.cx-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.cx-ai{grid-template-columns:1fr 1fr}}@media (max-width:760px){.cx-tiles,.cx-vg,.cx-2,.cx-ai{grid-template-columns:1fr 1fr}.cx-vg,.cx-2{grid-template-columns:1fr}}";
  document.head.appendChild(css);

  /* ---------------- charts (SVG, one axis per chart) ---------------- */
  function axis(min, max) { if (min === max) { max += 1; min -= 1; } var span = max - min, st = Math.pow(10, Math.floor(Math.log10(span / 4))), m = [1, 2, 2.5, 5, 10].map(function (x) { return x * st; }).filter(function (x) { return span / x <= 5; })[0] || st * 10;
    var lo = Math.floor(min / m) * m, hi = Math.ceil(max / m) * m, t = []; for (var v = lo; v <= hi + m / 2; v += m) t.push(+v.toFixed(10)); return { lo: lo, hi: hi, ticks: t }; }
  function cols(S, o) {
    o = o || {}; var W = 640, H = o.h || 190, pl = 52, pr = 8, pt = 14, pb = 26, vals = S.map(function (s) { return s.v; }).filter(function (v) { return v != null; });
    if (!vals.length) return '<p class="note">No reported values for these quarters.</p>';
    var A = axis(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals))), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); };
    var bw = (W - pl - pr) / S.length, f = o.fmt || f$, out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke-width="1.4" stroke="var(--line2)"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f(t) + "</text>"; });
    var mxI = -1, mx = -Infinity; S.forEach(function (s, i) { if (s.v != null && s.v > mx) { mx = s.v; mxI = i; } });
    S.forEach(function (s, i) { var x = pl + i * bw + bw * 0.18, w = bw * 0.64;
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + esc(s.label) + "</text>";
      if (s.v == null) { out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y(0) - 4).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="var(--faint)">n/a</text>'; return; }
      var y0 = y(Math.max(0, s.v)), h = Math.max(1, Math.abs(y(s.v) - y(0))), col = s.v < 0 && o.neg ? o.neg : (o.color || C1), der = s.st === "CALCULATED";
      out += '<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + col + '"' + (der ? ' fill-opacity=".62" stroke="' + col + '" stroke-dasharray="3 2"' : "") + "><title>" + esc(s.label + ": " + f(s.v) + (der ? " (derived from year-to-date filings)" : " (as filed)")) + "</title></rect>";
      if (i === S.length - 1 || i === mxI) out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (s.v >= 0 ? y0 - 4 : y0 + h + 11).toFixed(1) + '" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + f(s.v) + "</text>"; });
    return out + "</svg>";
  }
  function lines(L, o) {
    o = o || {}; var W = 640, H = o.h || 190, pl = 46, pr = 64, pt = 12, pb = 24, all = [];
    L.forEach(function (s) { s.S.forEach(function (p) { if (p.v != null) all.push(p.v); }); }); if (o.ref != null) all.push(o.ref);
    if (!all.length) return '<p class="note">No reported values for these quarters.</p>';
    var A = axis(Math.min.apply(null, all.concat(o.zero ? [0] : [])), Math.max.apply(null, all)), n = L[0].S.length, f = o.fmt || function (v) { return pc(v, 0).replace("+", ""); };
    var x = function (i) { return pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pl - pr); }, y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f(t) + "</text>"; });
    L[0].S.forEach(function (p, i) { out += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + esc(p.label) + "</text>"; });
    L.forEach(function (s) { var pts = s.S.map(function (p, i) { return p.v == null ? null : [x(i), y(p.v), p]; }), seg = [], segs = [];
      pts.forEach(function (p) { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } }); if (seg.length) segs.push(seg);
      segs.forEach(function (g) { out += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" points="' + g.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>'; });
      pts.forEach(function (p) { if (p) out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + s.color + '" stroke="var(--panel)" stroke-width="2"><title>' + esc(s.name + " · " + p[2].label + ": " + f(p[2].v)) + "</title></circle>"; });
      var lp = pts.filter(Boolean).pop(); if (lp) out += '<text x="' + (lp[0] + 8).toFixed(1) + '" y="' + (lp[1] + 3.5).toFixed(1) + '" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + f(lp[2].v) + "</text>"; });
    if (o.ref != null) out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(o.ref).toFixed(1) + '" y2="' + y(o.ref).toFixed(1) + '" stroke="var(--muted)" stroke-dasharray="5 4"/>';
    return (L.length > 1 ? '<div class="cx-leg">' + L.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>" : "") + out + "</svg>";
  }
  function compo(cfo, capex, fcf) {
    var W = 640, H = 210, pl = 52, pr = 8, pt = 12, pb = 26, all = [0];
    cfo.forEach(function (p, i) { if (p.v != null) all.push(p.v); if (capex[i].v != null) all.push(-capex[i].v); if (fcf[i].v != null) all.push(fcf[i].v); });
    var A = axis(Math.min.apply(null, all), Math.max.apply(null, all)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / cfo.length;
    var out = '<div class="cx-leg"><span><i style="background:' + C1 + '"></i>Operating cash flow</span><span><i style="background:' + C2 + '"></i>Capex (shown below zero)</span><span><i style="background:' + C3 + ';border-radius:50%"></i>Free cash flow</span></div><svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Operating cash flow, capex and free cash flow by quarter">';
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    var fp = [];
    cfo.forEach(function (p, i) { var x = pl + i * bw + bw * 0.2, w = bw * 0.6;
      if (p.v != null) out += '<rect x="' + x.toFixed(1) + '" y="' + y(Math.max(0, p.v)).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(p.v) - y(0))).toFixed(1) + '" rx="3" fill="' + C1 + '"><title>' + esc(p.label + " operating cash flow " + f$(p.v)) + "</title></rect>";
      var c = capex[i].v; if (c != null) out += '<rect x="' + x.toFixed(1) + '" y="' + (y(0) + 2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(-c) - y(0))).toFixed(1) + '" rx="3" fill="' + C2 + '"><title>' + esc(p.label + " capex " + f$(c)) + "</title></rect>";
      if (fcf[i].v != null) fp.push([x + w / 2, y(fcf[i].v), fcf[i]]);
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + esc(p.label) + "</text>"; });
    if (fp.length > 1) out += '<polyline fill="none" stroke="' + C3 + '" stroke-width="2" points="' + fp.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>';
    fp.forEach(function (p, k) { out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5" fill="' + C3 + '" stroke="var(--panel)" stroke-width="2"><title>' + esc(p[2].label + " free cash flow " + f$(p[2].v)) + "</title></circle>" +
      (k === fp.length - 1 ? '<text x="' + (p[0] - 8).toFixed(1) + '" y="' + (p[1] - 9).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">FCF ' + money(p[2].v) + "</text>" : ""); });
    return out + "</svg>";
  }
  function waterfall(steps) {
    var W = 640, H = 210, pl = 52, pr = 8, pt = 14, pb = 34, run = 0, bars = [];
    steps.forEach(function (s) { if (s.total) { bars.push({ a: 0, b: s.v, s: s }); run = s.v; } else { bars.push({ a: run, b: run + s.v, s: s }); run += s.v; } });
    var all = [0]; bars.forEach(function (b) { all.push(b.a, b.b); });
    var A = axis(Math.min.apply(null, all), Math.max.apply(null, all)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / bars.length;
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Bridge from net income to operating cash flow">';
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    bars.forEach(function (b, i) { var x = pl + i * bw + bw * 0.16, w = bw * 0.68, top = y(Math.max(b.a, b.b)), h = Math.max(1, Math.abs(y(b.a) - y(b.b))), col = b.s.total ? C1 : b.s.v >= 0 ? "var(--green)" : "var(--red)";
      out += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + col + '"' + (b.s.total ? "" : ' fill-opacity=".85"') + "><title>" + esc(b.s.name + ": " + f$(b.s.v)) + "</title></rect>" +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (top - 4).toFixed(1) + '" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + (b.s.total ? "" : b.s.v >= 0 ? "+" : "") + f$(b.s.v) + "</text>" +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(b.s.name.split(" ")[0]) + '</text><text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(b.s.name.split(" ").slice(1).join(" ")) + "</text>"; });
    return out + "</svg>";
  }
  function dfmt(v) { return v.toFixed(0) + "d"; }
  function xfmt(v) { return v.toFixed(1) + "×"; }
  function stack(Q, parts, o) {   /* stacked columns for composition (one axis) */
    o = o || {}; var W = 640, H = o.h || 190, pl = 52, pr = 8, pt = 12, pb = 26, tot = Q.map(function (q) { return parts.reduce(function (a, p) { return a + (E.val(q, p[0]) || 0); }, 0); });
    var mx = Math.max.apply(null, tot.concat([0])); if (!mx) return '<p class="note">No composition disclosed.</p>';
    var A = axis(0, mx), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / Q.length;
    var out = '<div class="cx-leg">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + esc(p[1]) + "</span>"; }).join("") + '</div><svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "composition") + '">';
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="2 4"/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    Q.forEach(function (q, i) { var x = pl + i * bw + bw * 0.2, w = bw * 0.6, base = 0;
      parts.forEach(function (p) { var v = E.val(q, p[0]); if (!v || v < 0) return; var y1 = y(base + v), y0 = y(base);
        out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, y0 - y1 - 2).toFixed(1) + '" rx="2" fill="' + p[2] + '"><title>' + esc(q.fl.label + " " + p[1] + ": " + f$(v)) + "</title></rect>"; base += v; });
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="var(--faint)">' + esc(q.fl.label) + "</text>"; });
    return out + "</svg>";
  }
  function bars(items, o) {   /* labelled horizontal bars — maturity ladder, peer-style ranking */
    o = o || {}; var mx = Math.max.apply(null, items.map(function (i) { return Math.abs(i.v || 0); }).concat([1]));
    return '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;font-size:12.5px">' + items.map(function (i) {
      return "<span>" + esc(i.label) + '</span><span style="background:var(--line);border-radius:3px;height:14px;position:relative"><span style="position:absolute;left:0;top:0;bottom:0;width:' + (i.v == null ? 0 : Math.abs(i.v) / mx * 100).toFixed(1) + "%;background:" + (i.color || C1) + ';border-radius:3px"></span></span><span style="font-family:\'IBM Plex Mono\',monospace">' + (i.v == null ? '<span class="neu">not tagged</span>' : (o.fmt || money)(i.v)) + "</span>"; }).join("") + "</div>";
  }
  function spark(S, col) {
    var v = S.map(function (s) { return s.v; }), ok = v.filter(function (x) { return x != null; }); if (ok.length < 2) return "";
    var lo = Math.min.apply(null, ok), hi = Math.max.apply(null, ok), r = hi - lo || 1, W = 120, H = 28;
    var pts = v.map(function (x, i) { return x == null ? null : [(i / (v.length - 1)) * (W - 6) + 3, 3 + (1 - (x - lo) / r) * (H - 6)]; }).filter(Boolean);
    var l = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><polyline fill="none" stroke="' + (col || C1) + '" stroke-width="1.6" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/><circle cx="' + l[0].toFixed(1) + '" cy="' + l[1].toFixed(1) + '" r="2.6" fill="' + (col || C1) + '"/></svg>';
  }

  /* ---------------- helpers on the model ---------------- */
  function L(M) { return M.quarters[M.quarters.length - 1]; }
  function S(M, k) { return E.series(M, k, 8); }
  function V(M, k) { return E.val(L(M), k); }
  function stB(m) { if (!m) return '<span class="cx-st">UNAVAILABLE</span>'; return '<span class="cx-st ' + (m.st === "CALCULATED" ? "C" : "") + '" title="' + esc(m.how || "") + '">' + m.st + (m.approx ? " ≈" : "") + "</span>"; }
  function ttmI(M, k) { return E.ttm(M.quarters, M.quarters.length - 1, k); }
  var DEF = {
    rev: ["Revenue", "Total revenue recognised in the quarter (ASC 606 revenue from contracts with customers, else total revenues)."],
    cogs: ["Cost of revenue", "Direct cost of goods and services sold."], gp: ["Gross profit", "Revenue − cost of revenue."], gm: ["Gross margin", "Gross profit ÷ revenue."],
    sga: ["SG&A", "Selling, general and administrative expense."], rnd: ["R&D", "Research and development expense."], opinc: ["Operating income", "GAAP operating income (loss)."],
    opm: ["Operating margin", "Operating income ÷ revenue."], ebit: ["EBIT", "Operating income; where not tagged, pretax income + interest expense (proxy)."], ebitm: ["EBIT margin (proxy)", "EBIT proxy ÷ revenue."],
    intexp: ["Interest expense", "Interest expense as filed."], da: ["D&A", "Depreciation, depletion and amortisation (cash-flow statement)."],
    ebitda: ["EBITDA", "Operating income + D&A. A calculated, non-GAAP measure."], ebitdam: ["EBITDA margin", "EBITDA ÷ revenue."],
    pretax: ["Pretax income", "Income from continuing operations before tax."], tax: ["Income tax", "Income tax expense (benefit)."], etr: ["Effective tax rate", "Tax ÷ pretax income."],
    ni: ["Net income", "GAAP net income attributable to the company."], nm: ["Net margin", "Net income ÷ revenue."], eps_d: ["Diluted EPS (GAAP)", "GAAP diluted earnings per share."],
    sh_d: ["Diluted shares", "Weighted-average diluted shares outstanding."], sbc: ["Stock-based comp.", "Share-based compensation (cash-flow statement add-back)."],
    cfo: ["Operating cash flow", "Net cash provided by operating activities."], capex: ["Capex", "Purchases of property, plant and equipment."],
    fcf: ["Free cash flow", "Operating cash flow − capex (standard definition; interest is not deducted again)."], fcfm: ["FCF margin", "FCF ÷ revenue."],
    fcfconv: ["FCF conversion", "FCF ÷ net income; N/M when net income ≤ 0."], cfoni: ["Cash conversion", "Operating cash flow ÷ net income."],
    capexint: ["Capex intensity", "Capex ÷ revenue."], gdebt: ["Gross debt", "Short-term borrowings + commercial paper + current and non-current long-term debt (leases excluded)."],
    ndebt: ["Net debt", "Gross debt − cash − short-term investments."], cash: ["Cash", "Cash and cash equivalents."],
    ar: ["Accounts receivable", "Trade receivables, net, at period end."], inv: ["Inventory", "Inventory, net, at period end."], ap: ["Accounts payable", "Trade payables at period end."],
    dso: ["DSO", "Days sales outstanding: average receivables ÷ quarterly revenue × days in the quarter."], dio: ["DIO", "Days inventory outstanding: average inventory ÷ quarterly cost of revenue × days."],
    dpo: ["DPO", "Days payables outstanding: average payables ÷ quarterly cost of revenue × days (cost of revenue proxies supplier purchases)."], ccc: ["Cash conversion cycle", "DSO + DIO − DPO."],
    wc_cf: ["Working-capital cash effect", "−Δreceivables − Δinventory + Δpayables from the cash-flow statement; positive = cash released."],
    allow: ["Doubtful-accounts allowance", "Allowance for credit losses on receivables."], ctrasset: ["Contract assets", "Unbilled revenue recognised ahead of invoicing."],
    defrev: ["Deferred revenue", "Contract liabilities — cash received before revenue is earned."], accr: ["Accrued liabilities", "Accrued expenses at period end."],
    inv_raw: ["Raw materials", "Raw-material inventory."], inv_wip: ["Work in progress", "Work-in-process inventory."], inv_fg: ["Finished goods", "Finished-goods inventory."], invwd: ["Inventory write-downs", "Inventory write-downs charged in the period."],
    capexda: ["Capex ÷ D&A", "Capex relative to depreciation; above 1 = net investment in the asset base."],
    div: ["Dividends", "Cash dividends paid."], buyback: ["Buybacks", "Cash paid to repurchase shares."], acq: ["Acquisitions", "Cash paid for businesses, net of cash acquired."],
    dissue: ["Debt raised", "Proceeds from long-term debt issuance."], drepay: ["Debt repaid", "Repayments of long-term debt."], eqiss: ["Equity issued", "Proceeds from issuing common stock."],
    shret: ["Shareholder return", "Dividends + buybacks."], retained: ["Cash retained", "FCF − dividends − buybacks."],
    stb: ["Short-term borrowings", "Short-term borrowings."], cp: ["Commercial paper", "Commercial paper outstanding."], dcur: ["Current debt", "Debt due within a year."],
    ltd_nc: ["Long-term debt", "Long-term debt, non-current."], oplease: ["Operating leases", "Operating lease liabilities — kept separate from debt."], finlease: ["Finance leases", "Finance lease liabilities — kept separate."],
    effcost: ["Effective interest cost", "Annualised interest expense ÷ average gross debt (opening/closing average — an approximation)."],
    cashcost: ["Cash borrowing cost", "Annualised cash interest paid ÷ average gross debt (approximation)."], intpaid: ["Cash interest paid", "Interest paid in cash."],
    revolver: ["Undrawn credit facilities", "Remaining borrowing capacity under committed lines."],
    int_cov: ["Interest coverage", "TTM EBIT ÷ TTM interest expense."], nd_ebitda: ["Net debt ÷ EBITDA", "Net debt ÷ TTM EBITDA."], ebitda_ttm: ["EBITDA (TTM)", "TTM EBIT + TTM D&A."],
    intburden: ["Cash interest burden", "TTM cash interest ÷ TTM operating cash flow."], fcf_debt: ["FCF ÷ debt", "TTM FCF ÷ gross debt."], fcf_ttm: ["FCF (TTM)", "Sum of the last four quarters."],
    ca: ["Current assets", "Current assets."], cl: ["Current liabilities", "Current liabilities."], wcap: ["Working capital", "Current assets − current liabilities."],
    cr: ["Current ratio", "Current assets ÷ current liabilities."], qr: ["Quick ratio", "(Cash + short-term investments + receivables) ÷ current liabilities."], cashr: ["Cash ratio", "(Cash + short-term investments) ÷ current liabilities."],
    roe: ["ROE", "TTM net income ÷ average equity."], roa: ["ROA", "TTM net income ÷ average total assets."], roic: ["ROIC", "TTM EBIT after tax ÷ (gross debt + equity − cash), period-end — approximate."],
    de: ["Debt ÷ equity", "Gross debt ÷ shareholders’ equity."], da_r: ["Debt ÷ assets", "Gross debt ÷ total assets."], eq: ["Equity", "Shareholders’ equity."], assets: ["Total assets", "Total assets."],
    at: ["Asset turnover", "TTM revenue ÷ average total assets."], invturn: ["Inventory turnover", "TTM cost of revenue ÷ average inventory."], arturn: ["Receivables turnover", "TTM revenue ÷ average receivables."], apturn: ["Payables turnover", "TTM cost of revenue ÷ average payables."],
    rpo: ["Remaining performance obligations", "Contracted revenue not yet recognised (backlog)."], cfoni_ttm: ["Cash conversion (TTM)", "TTM CFO ÷ TTM net income."],
  };
  var DAYS = { dso: 1, dio: 1, dpo: 1, ccc: 1 }, XR = { cr: 1, qr: 1, cashr: 1, de: 1, nd_ebitda: 1, int_cov: 1, at: 1, invturn: 1, arturn: 1, apturn: 1, capexda: 1, cfoni_ttm: 1 };
  function nm(k) { var m = /^(.*)_(yoy|qoq)$/.exec(k); if (m) return nm(m[1]) + (m[2] === "yoy" ? " — YoY" : " — vs prior quarter"); return (DEF[k] || [k])[0]; }
  var PCT = { effcost: 1, cashcost: 1, roe: 1, roa: 1, roic: 1, da_r: 1, intburden: 1, fcf_debt: 1, ebitm: 1, gm: 1, opm: 1, nm: 1, ebitdam: 1, fcfm: 1, etr: 1, capexint: 1, fcfconv: 1 };
  function fv(k, v) { if (v == null) return "—"; var g = /^(.*)_(yoy|qoq)$/.exec(k);
    if (g) { if (DAYS[g[1]]) return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " d"; if (XR[g[1]]) return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "×"; return PCT[g[1]] ? pp(v) : pc(v); }
    if (k === "nd_ebitda" && v < 0) return "net cash"; if (DAYS[k]) return v.toFixed(1) + " d"; if (XR[k]) return v.toFixed(2) + "×"; if (PCT[k]) return v.toFixed(1) + "%"; if (k === "eps_d") return "$" + v.toFixed(2); if (k === "cfoni") return v.toFixed(2) + "×"; if (k === "sh_d") return f$(v); return money(v); }

  /* ---------------- interpretation (rule-based, data-referenced; 9-part contract) ---------------- */
  function interp(M, k, extra) {
    var Sx = S(M, k), T = E.trend(Sx), q = L(M), lab = nm(k), y = q.m[k + "_yoy"], p = q.m[k + "_qoq"], isPct = PCT[k];
    var out = { cur: "", hist: "", ind: "", pos: [], neg: [], why: [], impl: "", mon: [], gaps: [] };
    var cur = q.m[k];
    var unitless = isPct || DAYS[k] || XR[k];
    out.cur = cur ? lab + " was " + fv(k, cur.v) + " in " + q.fl.label + (y ? " — " + fv(k + "_yoy", y.v) + " versus " + y.how.replace(/^(vs |change vs )/, "") : "") + (p ? ", " + fv(k + "_qoq", p.v) + " on the previous quarter" : "") + "." + (!unitless && ttmI(M, k) != null ? " Trailing twelve months: " + fv(k, ttmI(M, k)) + "." : "")
      : lab + " is not available for " + q.fl.label + ".";
    if (T.dir === "insufficient") out.hist = "Fewer than three quarters reported — no trend is drawn.";
    else out.hist = "Across " + T.n + " quarters " + lab.toLowerCase() + " has been " + (T.dir === "mixed" ? "uneven" : T.dir) + ": higher than the prior quarter " + T.up + " times, lower " + T.dn + " times. Range " + fv(k, T.lo) + " to " + fv(k, T.hi) +
      (T.atHigh ? " — the latest quarter is the high of the period." : T.atLow ? " — the latest quarter is the low of the period." : ".") + (T.turn ? " Most recent turning point: " + T.turn + "." : "");
    var yS = E.series(M, k + "_yoy", 8).filter(function (s) { return s.v != null; });
    if (!isPct && !DAYS[k] && !XR[k] && yS.length >= 3) { var a = yS[yS.length - 1].v, b = yS[yS.length - 3].v;
      out.hist += " Year-on-year growth " + (a > b + 1 ? "accelerated" : a < b - 1 ? "slowed" : "held steady") + ": " + pc(a) + " now against " + pc(b) + " two quarters earlier."; }
    out.ind = "No industry benchmark is shown yet. Peer medians and percentiles arrive with the industry-comparison phase; none is invented in the meantime.";
    (extra || function () {})(out, M, q);
    var der = Sx.filter(function (s) { return s.st === "CALCULATED"; }).length, miss = Sx.filter(function (s) { return s.v == null; }).map(function (s) { return s.label; });
    if (der) out.gaps.push(der + " of " + Sx.length + " quarters are derived from year-to-date filings (marked with a dashed outline).");
    if (miss.length) out.gaps.push("Not reported for " + miss.join(", ") + ".");
    out.gaps.push("Industry comparison: not yet available.");
    var rel = E.latestRelease(M.co);
    out.mon.unshift("The next quarterly report" + (rel ? " (last earnings release filed " + rel.filed + ")" : "") + ": whether " + lab.toLowerCase() + " " + (T.dir === "rising" ? "keeps rising" : T.dir === "falling" ? "stops falling" : "establishes a direction") + ".");
    return out;
  }
  function aiHTML(o) {
    function li(a) { return a.length ? a.map(function (x) { return "• " + x; }).join("<br>") : "—"; }
    return '<div class="cx-ai">' +
      "<div><b>1 · Current position</b>" + o.cur + "</div><div><b>2 · Historical trend</b>" + o.hist + "</div><div><b>3 · Industry comparison</b>" + o.ind + "</div>" +
      "<div><b>4 · Positive evidence</b>" + li(o.pos) + "</div><div><b>5 · Negative evidence</b>" + li(o.neg) + "</div>" +
      '<div><b>6 · Possible explanations</b><span class="hyp">' + (o.why.length ? li(o.why) + "<br>Hypotheses — the filings do not establish causation." : "No explanation is offered without supporting disclosure.") + "</span></div>" +
      "<div><b>7 · Investor implication</b>" + (o.impl || "—") + "</div><div><b>8 · What to monitor next</b>" + li(o.mon) + "</div><div><b>9 · Data gaps &amp; confidence</b>" + li(o.gaps) + "</div></div>";
  }

  /* ---------------- shared card page pieces ---------------- */
  function head(M, k, unit) {
    var q = L(M), m = q.m[k], y = q.m[k + "_yoy"], p = q.m[k + "_qoq"];
    return '<div class="cx-hd"><div><div class="lab">' + esc(nm(k)) + " · " + esc(q.fl.label) + " (" + esc(q.end) + ")</div><div class=\"big\">" + fv(k, m && m.v) + "</div></div>" +
      '<div><div class="lab">YoY</div><div class="m">' + (y ? sgc(tone(k, y.v), fv(k + "_yoy", y.v)) : "—") + '</div></div><div><div class="lab">vs prior quarter</div><div class="m">' + (p ? sgc(tone(k, p.v), fv(k + "_qoq", p.v)) : "—") + "</div></div>" +
      (!PCT[k] && !DAYS[k] && !XR[k] && ttmI(M, k) != null ? '<div><div class="lab">TTM</div><div class="m">' + fv(k, ttmI(M, k)) + "</div></div>" : "") +
      '<div><div class="lab">Status</div><div class="m">' + stB(m) + '</div></div><div><div class="lab">Unit</div><div class="m">' + (unit || (PCT[k] ? "%" : DAYS[k] ? "days" : XR[k] ? "times" : "USD")) + "</div></div></div>";
  }
  function table(M, keys) {
    var Q = M.quarters.slice(-8);
    return '<div class="tbl-scroll"><table class="cx-t"><thead><tr><th>Eight quarters</th>' + Q.map(function (q) { return "<th>" + esc(q.fl.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      keys.map(function (k) { return "<tr><td>" + esc(nm(k)) + "</td>" + Q.map(function (q) { var m = q.m[k]; return "<td" + (m && m.st === "CALCULATED" ? ' style="font-style:italic" title="' + esc(m.how || "") + '"' : "") + ">" + (m ? fv(k, m.v) : '<span class="neu">—</span>') + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div><div class=\"stamp\" style=\"margin-top:6px\">Italic = derived from year-to-date filings (see evidence). “—” = not filed for that quarter; never estimated.</div>";
  }
  function annualT(M, keys) {
    var A = M.annual; if (!A.length) return '<p class="note">No full-year filings in the window.</p>';
    return '<div class="tbl-scroll"><table class="cx-t"><thead><tr><th>Fiscal year</th>' + A.map(function (a) { return "<th>FY" + a.fy + "</th>"; }).join("") + (A.length >= 3 ? "<th>CAGR</th>" : "") + "</tr></thead><tbody>" +
      keys.filter(function (k) { return A.some(function (a) { return a.m[k]; }); }).map(function (k) {
        var f0 = A[0].m[k], f1 = A[A.length - 1].m[k], cg = f0 && f1 && f0.v > 0 && f1.v > 0 ? (Math.pow(f1.v / f0.v, 1 / (A.length - 1)) - 1) * 100 : null;
        return "<tr><td>" + esc(nm(k)) + "</td>" + A.map(function (a) { return "<td>" + (a.m[k] ? fv(k, a.m[k].v) : "—") + "</td>"; }).join("") + (A.length >= 3 ? "<td>" + (cg == null ? "n/m" : pc(cg)) + "</td>" : "") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  function evidence(M, keys) {
    var q = L(M), co = M.co;
    function link(src) { if (!src || !src.a) return ""; return ' · <a href="https://www.sec.gov/Archives/edgar/data/' + (+co.cik) + "/" + src.a.replace(/-/g, "") + "/" + src.a + '-index.htm" target="_blank" rel="noopener noreferrer">' + esc(src.f) + " filed " + esc(src.d) + " ↗</a>"; }
    return '<details class="cx-evd"><summary>Data &amp; evidence — sources, formulas, status, confidence</summary><div class="tbl-scroll"><table class="cx-t" style="margin-top:8px"><thead><tr><th>Metric</th><th>Definition / formula</th><th>' + esc(q.fl.label) + "</th><th>Status</th><th>Source</th></tr></thead><tbody>" +
      keys.map(function (k) { var m = q.m[k]; return "<tr><td>" + esc(nm(k)) + '</td><td style="white-space:normal;text-align:left;font-family:inherit;font-size:12px">' + esc((DEF[k] || ["", ""])[1]) + (m && m.how ? "<br><i>" + esc(m.how) + "</i>" : "") + "</td><td>" + (m ? fv(k, m.v) : "—") + "</td><td>" + stB(m) +
        (m && m.src && m.src.restated ? ' <span class="cx-st" style="color:var(--amber)">RESTATED</span>' : "") + '</td><td style="white-space:normal;text-align:left;font-family:inherit;font-size:12px">' + (m && m.tag ? "<code>us-gaap:" + esc(m.tag) + "</code>" + link(m.src) + (m.src2 ? link(m.src2) : "") : m && m.inputs ? "calculated from " + esc(m.inputs.map(nm).join(", ")) : "not filed") + "</td></tr>"; }).join("") +
      '</tbody></table></div><div class="stamp">SEC EDGAR XBRL company facts for ' + esc(co.name) + " (CIK " + esc(co.cik) + "), fetched live " + esc(new Date(co.fetched_at || Date.now()).toLocaleString()) + ". Reported = filed figure; Calculated = derived by the stated formula; Unavailable = not filed, never estimated. GAAP throughout — adjusted (non-GAAP) figures are not in the structured filings.</div></details>";
  }

  /* ---------------- card catalogue ---------------- */
  var PARTS = [
    ["Company overview", [["snap", "Company snapshot", "Size, growth, profitability and financial structure at a glance.", "rev"], ["verdicts", "Four financial verdicts", "Earnings quality · outlook · resilience · market implication.", null], ["health", "Eight-quarter health history", "Consistently strong, weak, or changing?", null]]],
    ["Earnings & financial statements", [["revenue", "Revenue intelligence", "Is growth accelerating or slowing?", "rev"], ["gross", "Cost of revenue & gross profit", "Is the company keeping more of each dollar after direct costs?", "gm"], ["operating", "Operating profitability", "Is growth producing operating leverage?", "opm"], ["eps", "Net income & EPS", "Is earnings growth operating, tax, buyback or adjustment driven?", "eps_d"]]],
    ["Working capital", [["wc-ar", "Receivables & collection", "Are customers taking longer to pay?", "dso"], ["wc-inv", "Inventory efficiency", "Is inventory building faster than demand?", "dio"], ["wc-ap", "Payables & supplier financing", "Better terms, or delayed payments?", "dpo"], ["wc-ccc", "Cash conversion cycle", "How long is cash tied up in operations?", "ccc"]]],
    ["Cash flow & capital allocation", [["cfo", "Operating cash flow", "Does accounting profit turn into cash?", "cfo"], ["fcf", "Free cash flow", "Cash left after investing in the asset base?", "fcf"], ["capex", "Capital expenditure", "Investing for growth or maintaining?", "capex"], ["alloc", "Capital allocation", "Where is the cash going?", "shret"]]],
    ["Debt & financing", [["debt", "Debt structure", "How is the company financed?", "gdebt"], ["costdebt", "Blended cost of debt", "Is borrowing getting more expensive?", "effcost"], ["maturity", "Maturities & refinancing", "Is a large refinancing coming?", null], ["service", "Debt servicing capacity", "Can earnings and cash carry the debt?", "int_cov"]]],
    ["Ratios & warnings", [["liq", "Liquidity", "Can it meet short-term obligations?", "cr"], ["returns", "Profitability & returns", "Better returns on the capital deployed?", "roe"], ["lev", "Leverage & solvency", "Is leverage rising faster than earnings?", "nd_ebitda"], ["eff", "Efficiency", "Is the asset base working harder?", "at"], ["warn", "Early-warning signals", "Twelve rules, with persistence and evidence.", null]]],
    ["Industry comparison", [["peers", "Peer benchmarks", "Industry median, percentile and named competitors."]]],
    ["Earnings intelligence", [["street", "Street vs actual"], ["guide", "Guidance & revisions"], ["mgmt", "Management commentary"], ["aieco", "AI economics"]]],
  ];
  var BUILT = { snap: 1, verdicts: 1, health: 1, revenue: 1, gross: 1, operating: 1, eps: 1, cfo: 1, fcf: 1, "wc-ar": 1, "wc-inv": 1, "wc-ap": 1, "wc-ccc": 1, capex: 1, alloc: 1, debt: 1, costdebt: 1, maturity: 1, service: 1, liq: 1, returns: 1, lev: 1, eff: 1, warn: 1 };
  function cardTitle(id) { var t = ""; PARTS.forEach(function (p) { p[1].forEach(function (c) { if (c[0] === id) t = c[1]; }); }); return t; }

  function grid(M, VV) {
    var q = L(M), co = M.co;
    return '<div class="tile"><div class="cx-h"><h2>' + esc(co.ticker) + " · " + esc(co.name) + '</h2><span class="cx-sub">' + esc(M.sector) + " · " + esc(co.sicDescription || "") + " · latest quarter " + esc(q.fl.label) + " (" + esc(q.end) + ")</span></div>" +
      (M.model.note ? '<div class="ut-ask" style="margin:6px 0">' + esc(M.model.note) + "</div>" : "") +
      PARTS.map(function (p) {
        if (!p[1].some(function (c) { return BUILT[c[0]]; }))
          return '<div class="cx-part">' + p[0] + ' <span style="letter-spacing:0;text-transform:none;color:var(--faint)">— next phase: ' + p[1].map(function (c) { return esc(c[1]); }).join(" · ") + "</span></div>";
        return '<div class="cx-part">' + p[0] + '</div><div class="cx-grid">' + p[1].map(function (c) {
        var b = BUILT[c[0]], k = c[3] === "opm" && E.val(q, "opm") == null ? "ebitm" : c[3], kv = "", sp = "";
        if (b && k) { var m = q.m[k], y = q.m[k + "_yoy"]; kv = '<div class="k">' + fv(k, m && m.v) + "</div>" + (y ? '<div class="n">' + sgc(tone(k, y.v), fv(k + "_yoy", y.v)) + " YoY · " + esc(q.fl.label) + "</div>" : '<div class="n">' + esc(q.fl.label) + "</div>"); sp = spark(S(M, k)); }
        if (c[0] === "maturity") { var mt = E.maturities(M); kv = '<div class="k">' + (mt && mt.buckets[0] ? money(mt.buckets[0].v) : "—") + '</div><div class="n">due within 12 months' + (mt ? " · " + esc(mt.label) : " · not tagged") + "</div>"; }
        if (c[0] === "warn") { var WW = E.warnings(M), act = WW.filter(function (w) { return w.status === "ACTIVE"; });
          kv = '<div class="k">' + act.length + ' <small style="font-size:12px;color:var(--muted)">active of 12</small></div><div class="n">' + (act.length ? act.map(function (w) { return '<span class="cx-vd ' + (w.severity === "WATCH" ? "WEAK" : "NEGATIVE") + '" style="font-size:9px;padding:1px 5px">' + w.id + "</span>"; }).join(" ") : "none triggered") + "</div>"; }
        if (c[0] === "verdicts") kv = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' + VV.verdicts.map(function (v) { return '<span class="cx-vd ' + v.verdict + '" title="' + esc(v.name) + '">' + v.name.split(" ").map(function (w) { return w[0]; }).join("") + " " + v.verdict + "</span>"; }).join("") + "</div>";
        if (c[0] === "health") { var st = E.streak(VV.history, "eq"); kv = '<div class="n" style="margin-top:6px">' + VV.history.map(function (h) { return '<span class="cx-vd ' + h.eq + '" style="padding:1px 4px;font-size:9px">' + h.eq[0] + "</span>"; }).join(" ") + "</div>" + (st.n ? '<div class="n">' + st.n + " quarter" + (st.n > 1 ? "s" : "") + " " + (st.dir > 0 ? "improving" : "deteriorating") + "</div>" : ""); }
        return '<button class="cx-card" data-cocard="' + c[0] + '"' + (b ? "" : " disabled") + '><span class="t">' + esc(c[1]) + "</span>" + kv + (sp ? "<div>" + sp + "</div>" : "") + '<span class="q">' + esc(c[2] || "") + (b ? "" : " · next phase") + "</span></button>"; }).join("") + "</div>"; }).join("") +
      '<div class="stamp">Cards draw on SEC EDGAR filings fetched live for this visit only — nothing is stored. Greyed cards are specified and arrive in the next build phases.</div></div>';
  }
  function shell(M, id, body) {
    return '<div class="tile"><div class="cx-h"><button class="ue-btn" data-cocard="">‹ All cards</button><h2>' + esc(cardTitle(id)) + '</h2><span class="cx-sub">' + esc(M.co.ticker) + " · " + esc(M.co.name) + "</span></div>" + body + "</div>";
  }

  /* ---------------- overview cards ---------------- */
  function snapCard(M, VV) {
    var q = L(M), co = M.co, rel = E.latestRelease(co), lastF = (co.filings || []).filter(function (f) { return /^10-[QK]/.test(f.form); })[0];
    var nxt = window.EARNINGS && EARNINGS._data && EARNINGS._data() && EARNINGS._data().calendar ? (EARNINGS._data().calendar.rows || []).filter(function (r) { return r.symbol === co.ticker && r.date >= new Date().toISOString().slice(0, 10); })[0] : null;
    function tile(k, label, extra) { var m = q.m[k], y = q.m[k + "_yoy"], p = q.m[k + "_qoq"];
      return '<div class="cx-tile"><div class="l">' + label + '</div><div class="v">' + fv(k, m && m.v) + '</div><div class="s">' + (y ? sgc(tone(k, y.v), (PCT[k] ? pp(y.v) : pc(y.v)) + " YoY") : "YoY —") + (p && !PCT[k] ? " · " + sgc(tone(k, p.v), pc(p.v) + " QoQ") : "") + "</div>" + (extra || "") + spark(S(M, k), PCT[k] ? C2 : C1) + "</div>"; }
    var hd = [["Exchange", co.exchange || (co.exchanges || [])[0] || "—"], ["Sector (SIC)", M.sector + " · " + (co.sicDescription || "")], ["Fiscal year-end", co.fiscalYearEnd ? co.fiscalYearEnd.slice(0, 2) + "/" + co.fiscalYearEnd.slice(2) : "—"], ["Reporting currency", "USD"],
      ["Latest quarter", q.fl.label + " (" + q.end + ")"], ["Latest 10-Q/10-K filed", lastF ? lastF.form + " · " + lastF.filed : "—"], ["Last earnings release", rel ? rel.filed + " (8-K 2.02)" : "—"], ["Next expected earnings", nxt ? nxt.date + " (FMP calendar)" : "UNAVAILABLE — not in the free calendar"]];
    var ttmTxt = function (k) { var t = ttmI(M, k); return t == null ? "" : '<div class="s">TTM ' + fv(k, t) + "</div>"; };
    return shell(M, "snap",
      '<dl class="ue-dl" style="grid-template-columns:auto 1fr auto 1fr;gap:4px 16px">' + hd.map(function (h) { return "<dt>" + h[0] + '</dt><dd style="text-align:left">' + esc(h[1]) + "</dd>"; }).join("") + "</dl>" +
      '<div class="cx-tiles">' + tile("rev", "Revenue", ttmTxt("rev")) + ('<div class="cx-tile"><div class="l">Revenue growth</div><div class="v">' + sgc(V(M, "rev_yoy"), pc(V(M, "rev_yoy"))) + '</div><div class="s">YoY · sequential ' + sgc(V(M, "rev_qoq"), pc(V(M, "rev_qoq"))) + "</div>" + spark(E.series(M, "rev_yoy", 8), C1) + "</div>") +
        tile("gm", "Gross margin") + tile("opm", "Operating margin") + tile("ni", "Net income", ttmTxt("ni")) + tile("eps_d", "Diluted EPS · GAAP", '<div class="s">Adjusted: UNAVAILABLE</div>') +
        tile("cfo", "Operating cash flow", ttmTxt("cfo")) + tile("fcf", "Free cash flow", ttmTxt("fcf")) + tile("gdebt", "Gross debt") + tile("ndebt", "Net debt") + "</div>" +
      '<div class="stamp">No composite score — the figures speak for themselves. Sparklines run over the last eight quarters; dashed or italic values are derived from year-to-date filings.</div>');
  }
  function verdictCard(M, VV) {
    return shell(M, "verdicts", '<div class="cx-vg">' + VV.verdicts.map(function (v) {
      function evl(a, cl) { return a.length ? a.map(function (e) { return '<div class="cx-ev ' + cl + '">' + esc(e.text) + ' <small>[' + esc(e.metric) + " · " + esc(e.period) + "]</small></div>"; }).join("") : '<div class="cx-ev" style="color:var(--faint)">none</div>'; }
      return '<div class="cx-v"><h3>' + esc(v.name) + ' <span class="cx-vd ' + v.verdict + '">' + v.verdict + '</span></h3><div class="qq">' + esc(v.q) + "</div>" +
        (v.verdict === "UNAVAILABLE" ? "" : '<div class="pi-l">Strongest support</div>' + evl(v.pos, "p") + '<div class="pi-l" style="margin-top:6px">Counterpoints &amp; risks</div>' + evl(v.neg, "n")) +
        '<div class="stamp">Direction ' + esc(v.direction || "—") + " · confidence " + esc(v.confidence || "—") + (v.inputs ? " · " + esc(v.inputs) : "") + (v.note ? "<br>" + esc(v.note) : "") + "</div></div>"; }).join("") + "</div>" +
      '<div class="stamp">Each verdict is independent and rule-based: every observation carries its metric and period, and the market verdict never feeds the fundamental ones.</div>');
  }
  function healthCard(M, VV) {
    var H = VV.history, sEQ = E.streak(H, "eq"), sFR = E.streak(H, "fr");
    function cell(v) { var bg = { STRONG: "rgba(63,185,127,.55)", SOLID: "rgba(63,185,127,.28)", MIXED: "rgba(176,189,207,.12)", WEAK: "rgba(232,163,61,.35)", STRETCHED: "rgba(232,163,61,.35)", NEGATIVE: "rgba(224,101,95,.5)" }[v];
      return '<td style="background:' + (bg || "transparent") + (bg ? "" : ";border:1px dashed var(--line2);color:var(--faint)") + '" title="' + v + '">' + (v === "UNAVAILABLE" ? "n/a" : v) + "</td>"; }
    function firstNeg(k) { var f = H.filter(function (h) { return h[k] === "NEGATIVE" || h[k] === "WEAK" || h[k] === "STRETCHED"; })[0]; return f ? f.label : null; }
    function resolved(k) { for (var j = H.length - 1; j > 0; j--) { if (/WEAK|NEGATIVE|STRETCHED/.test(H[j - 1][k]) && !/WEAK|NEGATIVE|STRETCHED/.test(H[j][k])) return H[j].label; } return null; }
    function line(nmx, k, st) { var fn = firstNeg(k), rs = resolved(k);
      return "<li><b>" + nmx + ":</b> " + (st.n ? st.n + " consecutive quarter" + (st.n > 1 ? "s" : "") + " " + (st.dir > 0 ? "of improvement" : "of deterioration") : "no consecutive run") + (fn ? " · first weak reading " + fn : " · no weak reading in the window") + (rs ? " · a weak reading resolved in " + rs : "") + "</li>"; }
    return shell(M, "health", '<div class="tbl-scroll"><table class="cx-hm"><thead><tr><th></th>' + H.map(function (h) { return "<th>" + esc(h.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      '<tr><td class="r">Earnings quality</td>' + H.map(function (h) { return cell(h.eq); }).join("") + "</tr>" +
      '<tr><td class="r">Financial resilience</td>' + H.map(function (h) { return cell(h.fr); }).join("") + "</tr>" +
      '<tr><td class="r">Forward outlook</td>' + H.map(function () { return cell("UNAVAILABLE"); }).join("") + "</tr>" +
      '<tr><td class="r">Market implication</td>' + H.map(function (h, i) { return cell(i === H.length - 1 ? VV.verdicts[3].verdict : "UNAVAILABLE"); }).join("") + "</tr></tbody></table></div>" +
      '<ul style="font-size:13px;line-height:1.6;margin:10px 0 0;padding-left:18px">' + line("Earnings quality", "eq", sEQ) + line("Financial resilience", "fr", sFR) + "</ul>" +
      '<div class="stamp">Each column re-runs the verdict rules using only the data filed up to that quarter, so a reading is what the filings said at the time. Outlook needs guidance and consensus (not free); market implication is only measured around the latest release.</div>');
  }

  /* ---------------- statement & cash-flow cards ---------------- */
  function page(M, id, k, main, tableKeys, annualKeys, extra, evKeys) {
    return shell(M, id, head(M, k) + '<div class="cx-sec">' + main + "</div>" +
      '<div class="cx-sec"><div class="pi-l">Eight-quarter history</div>' + table(M, tableKeys) + "</div>" +
      (annualKeys ? '<div class="cx-sec"><div class="pi-l">Annual history (10-K)</div>' + annualT(M, annualKeys) + "</div>" : "") +
      '<div class="cx-sec"><div class="pi-l">Industry comparison</div><div class="ue-ph">No peer benchmark yet — industry median, percentile and named competitors arrive with the industry-comparison phase. Nothing is shown rather than an invented benchmark.</div></div>' +
      '<div class="cx-sec"><div class="pi-l">Interpretation — rule-based, from the figures above</div>' + aiHTML(interp(M, k, extra)) + "</div>" + evidence(M, evKeys || tableKeys));
  }
  function revenueCard(M) {
    return page(M, "revenue", "rev",
      '<div class="cx-2"><div><div class="pi-l">Quarterly revenue</div>' + cols(S(M, "rev"), { label: "Quarterly revenue" }) + '</div><div><div class="pi-l">Year-on-year growth</div>' +
        lines([{ name: "Revenue YoY", color: C1, S: E.series(M, "rev_yoy", 8) }], { zero: true, label: "Revenue YoY growth" }) + "</div></div>" +
      '<div class="stamp">Two panels, one axis each: bars show the scale of the business, the line shows whether growth is accelerating. Sequential growth is in the table, never mixed with YoY.</div>',
      ["rev", "rev_yoy", "rev_qoq"], ["rev"], function (o, M2, q) {
        var g = E.val(q, "rev_yoy");
        if (g != null) (g >= 0 ? o.pos : o.neg).push("Revenue " + (g >= 0 ? "grew " : "fell ") + Math.abs(g).toFixed(1) + "% YoY [rev_yoy · " + q.fl.label + "].");
        o.gaps.push("Segment, geographic, organic, acquisition and FX splits are not in the structured filings — growth cannot be attributed between them here.");
        o.why.push("Volume, pricing, acquisitions or currency could each explain the change — the structured data does not separate them.");
        o.impl = g == null ? "Insufficient data." : g > 10 ? "The business is expanding at a double-digit pace; the question is whether margins and cash flow keep up (see the profitability and FCF cards)." : g < 0 ? "Revenue is contracting; check whether costs are falling as fast (gross and operating cards)." : "Growth is modest; profitability and cash conversion matter more for the investment case.";
        o.mon.push("Revenue YoY versus the prior two quarters, to confirm acceleration or slowdown.");
      }, ["rev"]);
  }
  function grossCard(M) {
    return page(M, "gross", "gm",
      '<div class="cx-2"><div><div class="pi-l">Gross margin</div>' + lines([{ name: "Gross margin", color: C1, S: S(M, "gm") }], { label: "Gross margin" }) + "</div>" +
        '<div><div class="pi-l">Revenue vs cost of revenue</div>' + lines([{ name: "Revenue", color: C1, S: S(M, "rev") }, { name: "Cost of revenue", color: C2, S: S(M, "cogs") }], { fmt: f$, label: "Revenue and cost of revenue" }) + "</div></div>",
      ["rev", "cogs", "gp", "gm"], ["rev", "gp"], function (o, M2, q) {
        var cg = E.val(q, "cogs_yoy"), rg = E.val(q, "rev_yoy"), d = E.val(q, "gm_yoy");
        if (M2.model.kind === "financial") o.gaps.unshift("Gross margin is not meaningful for this business model.");
        if (d != null) (d >= 0 ? o.pos : o.neg).push("Gross margin " + (d >= 0 ? "expanded " : "compressed ") + Math.abs(d).toFixed(1) + " pp YoY [gm_yoy · " + q.fl.label + "].");
        if (cg != null && rg != null) { (cg > rg ? o.neg : o.pos).push("Cost of revenue " + pc(cg) + " YoY against revenue " + pc(rg) + " [cogs_yoy, rev_yoy]."); if (cg > rg + 2) o.why.push("Input-cost inflation, discounting or mix shift toward lower-margin products."); if (rg > cg + 2) o.why.push("Pricing power, cheaper inputs or a richer product mix."); }
        o.gaps.push("Pricing, volume, freight and input-cost effects are only in management discussion, not the structured data.");
        o.impl = d == null ? "—" : d >= 0 ? "The company is retaining more of each revenue dollar after direct costs." : "Direct costs are absorbing more of revenue — watch whether pricing catches up.";
        o.mon.push("Gross margin against the same quarter last year (seasonality-safe comparison).");
      }, ["rev", "cogs", "gp", "gm"]);
  }
  function operatingCard(M) {
    var opx = ["sga", "rnd"].filter(function (k) { return S(M, k).some(function (s) { return s.v != null; }); });
    var hasOp = S(M, "opm").some(function (x) { return x.v != null; });
    return page(M, "operating", hasOp ? "opm" : "ebitm",
      '<div class="pi-l">Margins — one axis, percent of revenue</div>' + lines([{ name: "Gross", color: C1, S: S(M, "gm") }, { name: hasOp ? "Operating" : "EBIT (proxy)", color: C2, S: S(M, hasOp ? "opm" : "ebitm") }, { name: "EBITDA", color: C3, S: S(M, "ebitdam") }, { name: "Net", color: C4, S: S(M, "nm") }].filter(function (l) { return l.S.some(function (s) { return s.v != null; }); }), { label: "Margin trends", h: 220 }) +
      (opx.length ? '<div class="pi-l" style="margin-top:10px">Operating expense lines</div>' + lines(opx.map(function (k, i) { return { name: nm(k), color: [C2, C3][i], S: S(M, k) }; }), { fmt: f$, label: "Operating expenses" }) : ""),
      hasOp ? ["opinc", "opm", "ebitda", "ebitdam", "sga", "rnd", "da"] : ["ebit", "ebitm", "pretax", "intexp", "ebitda", "ebitdam", "sga", "da"], ["opinc"], function (o, M2, q) {
        if (!hasOp) o.gaps.unshift("This filer does not tag operating income; the card uses an EBIT proxy (pretax income + interest expense), which also includes non-operating items.");
        var d = E.val(q, "opm_yoy"), rg = E.val(q, "rev_yoy"), sg = E.val(q, "sga_yoy");
        if (d != null) (d >= 0 ? o.pos : o.neg).push("Operating margin " + (d >= 0 ? "widened " : "narrowed ") + Math.abs(d).toFixed(1) + " pp YoY [opm_yoy · " + q.fl.label + "].");
        if (sg != null && rg != null) { (sg > rg ? o.neg : o.pos).push("SG&A " + pc(sg) + " YoY vs revenue " + pc(rg) + " [sga_yoy, rev_yoy]" + (sg > rg ? " — costs growing faster than sales." : " — operating leverage.")); }
        if (E.val(q, "restr")) o.neg.push("Restructuring charges of " + money(E.val(q, "restr")) + " this quarter.");
        o.gaps.push("EBITDA here is operating income + D&A (calculated, non-GAAP); company-defined adjusted EBITDA is not in the structured filings.");
        o.why.push("Scale effects, cost programmes, wage or marketing inflation, or one-off charges.");
        o.impl = d == null ? "—" : d >= 0 ? "Revenue growth is reaching the operating line." : "Operating costs are taking a larger share of revenue.";
        o.mon.push("Whether operating expenses grow slower than revenue next quarter.");
      }, hasOp ? ["opinc", "opm", "ebitda", "da", "sga", "rnd"] : ["ebit", "ebitm", "pretax", "intexp", "ebitda", "da"]);
  }
  function epsCard(M) {
    return page(M, "eps", "eps_d",
      '<div class="cx-2"><div><div class="pi-l">Net income</div>' + cols(S(M, "ni"), { neg: "var(--red)", label: "Net income" }) + '<div class="pi-l">Net margin</div>' + lines([{ name: "Net margin", color: C4, S: S(M, "nm") }], { h: 140, zero: true }) + "</div>" +
        '<div><div class="pi-l">Diluted EPS — GAAP</div>' + cols(S(M, "eps_d"), { fmt: function (v) { return "$" + v.toFixed(2); }, neg: "var(--red)", label: "Diluted EPS" }) +
        '<div class="ue-ph" style="margin-top:8px">Adjusted (non-GAAP) EPS: UNAVAILABLE — not in the structured filings. GAAP and adjusted are never combined.</div></div></div>',
      ["pretax", "tax", "etr", "ni", "nm", "eps_d", "sh_d", "sbc"], ["ni", "eps_d"], function (o, M2, q) {
        var ey = E.val(q, "eps_d_yoy"), ny = E.val(q, "ni_yoy"), sy = E.val(q, "sh_d_yoy"), et = E.val(q, "etr"), Q = M2.quarters, py = Q.length > 4 ? E.val(Q[Q.length - 5], "etr") : null;
        if (ey != null) (ey >= 0 ? o.pos : o.neg).push("Diluted EPS " + pc(ey) + " YoY [eps_d_yoy].");
        if (ey != null && ny != null && Math.abs(ey - ny) > 3) o.pos.push("EPS growth (" + pc(ey) + ") differs from net-income growth (" + pc(ny) + ") — the share count explains the gap [sh_d_yoy " + pc(sy) + "].");
        if (sy != null && sy > 1) o.neg.push("Diluted shares up " + sy.toFixed(1) + "% YoY — dilution [sh_d_yoy].");
        if (et != null && py != null && Math.abs(et - py) > 4) o.why.push("A tax-rate change (" + py.toFixed(0) + "% → " + et.toFixed(0) + "%) is moving net income independently of operations.");
        if (Q.slice(-8).some(function (x) { return x.m.eps_d && x.m.eps_d.approx; })) o.gaps.push("Some quarterly EPS is full year − nine months, which is approximate for per-share figures (≈).");
        o.gaps.push("Adjusted EPS, one-off items and adjustment dependence need the earnings release text — not yet parsed.");
        o.impl = ey == null ? "—" : ey > 0 && (ny == null || ny > 0) ? "Earnings per share are growing on reported (GAAP) numbers." : "Reported earnings per share are lower than a year ago.";
        o.mon.push("Effective tax rate and diluted share count next quarter.");
      }, ["ni", "eps_d", "sh_d", "tax", "pretax", "sbc"]);
  }
  function cfoCard(M) {
    var q = L(M), ni = E.val(q, "ni"), cfo = E.val(q, "cfo"), da = E.val(q, "da"), sbc = E.val(q, "sbc");
    var wc = (E.val(q, "d_ar") != null || E.val(q, "d_inv") != null || E.val(q, "d_ap") != null) ? -(E.val(q, "d_ar") || 0) - (E.val(q, "d_inv") || 0) + (E.val(q, "d_ap") || 0) : null;
    var bridge = ni != null && cfo != null ? waterfall([{ name: "Net income", v: ni, total: 1 }].concat(da != null ? [{ name: "D&A add-back", v: da }] : [], sbc != null ? [{ name: "Stock comp", v: sbc }] : [],
      wc != null ? [{ name: "Working capital", v: wc }] : [], [{ name: "Other items", v: cfo - ni - (da || 0) - (sbc || 0) - (wc || 0) }, { name: "Operating cash", v: cfo, total: 1 }])) : '<p class="note">Bridge needs net income and operating cash flow for ' + esc(q.fl.label) + ".</p>";
    return page(M, "cfo", "cfo",
      '<div class="cx-2"><div><div class="pi-l">Net income → operating cash flow · ' + esc(q.fl.label) + "</div>" + bridge + '<div class="stamp">Working capital = −Δreceivables − Δinventory + Δpayables as filed; “other” is the residual so the bridge always closes.</div></div>' +
        '<div><div class="pi-l">Operating cash flow, eight quarters</div>' + cols(S(M, "cfo"), { neg: "var(--red)", label: "Operating cash flow" }) + "</div></div>",
      ["ni", "cfo", "cfoni", "da", "sbc"], ["cfo"], function (o, M2, q2) {
        var t1 = E.ttm(M2.quarters, M2.quarters.length - 1, "cfo"), t2 = E.ttm(M2.quarters, M2.quarters.length - 1, "ni");
        if (t1 != null && t2 > 0) { var c = t1 / t2; (c >= 1 ? o.pos : o.neg).push("TTM operating cash flow is " + c.toFixed(2) + "× net income [cfo_ttm ÷ ni_ttm]."); }
        if (wc != null) (wc >= 0 ? o.pos : o.neg).push("Working capital " + (wc >= 0 ? "released " : "absorbed ") + money(Math.abs(wc)) + " in " + q2.fl.label + ".");
        o.why.push("Seasonal working-capital swings, timing of collections and supplier payments, or changes in non-cash charges.");
        o.impl = t1 != null && t2 > 0 ? (t1 / t2 >= 1 ? "Accounting profit is converting into cash." : "Cash generation trails reported profit — check receivables and inventory.") : "—";
        o.mon.push("Quarterly cash flow is seasonal — compare TTM, and the same quarter last year.");
      }, ["cfo", "ni", "da", "sbc"]);
  }
  function fcfCard(M) {
    return page(M, "fcf", "fcf",
      '<div class="pi-l">Operating cash flow, capex and free cash flow</div>' + compo(S(M, "cfo"), S(M, "capex"), S(M, "fcf")) +
      '<div class="cx-2" style="margin-top:6px"><div><div class="pi-l">FCF margin</div>' + lines([{ name: "FCF margin", color: C3, S: S(M, "fcfm") }], { zero: true, h: 150 }) + '</div><div><div class="pi-l">Annual free cash flow</div>' +
        cols(M.annual.map(function (a) { return { label: "FY" + String(a.fy).slice(2), v: a.m.fcf ? a.m.fcf.v : null, st: "CALCULATED" }; }), { neg: "var(--red)", color: C3, h: 150 }) + "</div></div>",
      ["cfo", "capex", "fcf", "fcfm", "fcfconv", "capexint"], ["cfo", "capex", "fcf"], function (o, M2, q) {
        var Q = M2.quarters, i = Q.length - 1, f4 = E.ttm(Q, i, "fcf"), fy = E.val(q, "fcf_yoy"), cy = E.val(q, "capex_yoy"), oy = E.val(q, "cfo_yoy");
        if (M2.model.kind === "financial" || M2.model.kind === "insurer") o.gaps.unshift("Standard FCF is not meaningful for this business model.");
        if (f4 != null) (f4 > 0 ? o.pos : o.neg).push("TTM free cash flow " + money(f4) + " [fcf_ttm].");
        if (fy != null && fy > 0 && cy != null && cy < -10 && (oy == null || oy <= 0)) o.neg.push("FCF rose " + pc(fy) + " YoY mainly because capex fell " + pc(cy) + " while operating cash flow did not grow — lower investment, not stronger operations.");
        else if (fy != null && oy != null && oy > 0 && fy > 0) o.pos.push("FCF growth (" + pc(fy) + ") is backed by higher operating cash flow (" + pc(oy) + ").");
        var ci = E.val(q, "capexint"); if (ci != null && cy != null && cy > 20) o.why.push("Capex up " + pc(cy) + " (intensity " + ci.toFixed(1) + "% of revenue) — a deliberate investment phase or rising maintenance needs; the filings do not split growth and maintenance capex.");
        o.gaps.push("Company-defined FCF and growth vs maintenance capex need the earnings release / MD&A — not in the structured data.");
        o.impl = f4 == null ? "—" : f4 > 0 ? "The business funds its investment from operations and has cash left for shareholders and creditors." : "The business is consuming cash after investment — financing needs follow.";
        o.mon.push("Capex guidance and whether operating cash flow grows with it.");
      }, ["cfo", "capex", "fcf", "fcfm", "fcfconv"]);
  }


  /* ---------------- working capital ---------------- */
  function dayChart(M, keys) { return lines(keys.map(function (k, i) { return { name: nm(k), color: [C1, C2, C3, C4][i], S: S(M, k) }; }), { fmt: dfmt, label: keys.map(nm).join(", ") }); }
  function growthPair(M, a, b) { return lines([{ name: nm(a) + " YoY", color: C2, S: E.series(M, a + "_yoy", 8) }, { name: nm(b) + " YoY", color: C1, S: E.series(M, b + "_yoy", 8) }], { zero: true, label: nm(a) + " vs " + nm(b) + " growth" }); }
  function arCard(M) {
    return page(M, "wc-ar", "dso", '<div class="pi-l">Days sales outstanding</div>' + dayChart(M, ["dso"]) + '<div class="pi-l" style="margin-top:8px">Receivables growth vs revenue growth</div>' + growthPair(M, "ar", "rev"),
      ["ar", "ar_yoy", "rev_yoy", "dso", "allow", "ctrasset"], null, function (o, M2, q) {
        var a = E.val(q, "ar_yoy"), r = E.val(q, "rev_yoy"), dd = E.val(q, "dso_yoy");
        if (a != null && r != null) (a - r > 10 ? o.neg : a - r < -5 ? o.pos : o.pos).push("Receivables " + pc(a) + " YoY against revenue " + pc(r) + " [ar_yoy, rev_yoy]" + (a - r > 10 ? " — a widening gap." : "."));
        if (dd != null) (dd > 5 ? o.neg : dd < -3 ? o.pos : o.pos).push("DSO " + fv("dso_yoy", dd) + " versus a year ago [dso_yoy].");
        o.why.push("Longer payment terms, a quarter-end sales spike, acquisitions, customer mix or slower collections.");
        o.impl = dd == null ? "—" : dd > 5 ? "Customers are taking longer to pay — cash conversion may weaken unless this reverses." : "Collection speed is stable or improving.";
        o.mon.push("DSO against the same quarter next year (seasonality-safe), and the doubtful-accounts allowance.");
      }, ["ar", "dso", "allow", "ctrasset"]);
  }
  function invCard(M) {
    var comp = [["inv_raw", "Raw materials", C1], ["inv_wip", "Work in progress", C2], ["inv_fg", "Finished goods", C3]], hasComp = M.quarters.slice(-8).some(function (q) { return comp.some(function (c) { return E.val(q, c[0]); }); });
    return page(M, "wc-inv", "dio", '<div class="pi-l">Days inventory outstanding</div>' + dayChart(M, ["dio"]) + '<div class="pi-l" style="margin-top:8px">Inventory growth vs revenue growth</div>' + growthPair(M, "inv", "rev") +
      (hasComp ? '<div class="pi-l" style="margin-top:8px">Inventory composition</div>' + stack(M.quarters.slice(-8), comp, { label: "Inventory composition" }) : '<p class="note">Inventory composition (raw / WIP / finished) is not tagged by this filer.</p>'),
      ["inv", "inv_yoy", "rev_yoy", "dio", "inv_raw", "inv_wip", "inv_fg", "invwd"], null, function (o, M2, q) {
        if (!E.val(q, "inv")) { o.gaps.unshift("No inventory on the balance sheet — this card does not apply to the business model."); return; }
        var a = E.val(q, "inv_yoy"), r = E.val(q, "rev_yoy"), dd = E.val(q, "dio_yoy");
        if (a != null && r != null) (a - r > 10 ? o.neg : o.pos).push("Inventory " + pc(a) + " YoY against revenue " + pc(r) + " [inv_yoy, rev_yoy].");
        if (dd != null) (dd > 7 ? o.neg : o.pos).push("DIO " + fv("dio_yoy", dd) + " versus a year ago [dio_yoy].");
        if (E.val(q, "invwd")) o.neg.push("Inventory write-downs of " + money(E.val(q, "invwd")) + " this quarter.");
        o.why.push("A planned seasonal build, a product launch, supply-chain buffering, higher input prices carried in inventory value — or slowing sales.");
        o.impl = dd == null ? "—" : dd > 7 ? "Inventory is turning more slowly — watch for discounting or write-downs." : "Inventory is moving at a steady or faster pace.";
        o.mon.push("Whether DIO normalises next quarter, and any inventory write-downs.");
      }, ["inv", "dio", "inv_raw", "inv_wip", "inv_fg"]);
  }
  function apCard(M) {
    return page(M, "wc-ap", "dpo", '<div class="pi-l">Days payables outstanding</div>' + dayChart(M, ["dpo"]) + '<div class="pi-l" style="margin-top:8px">Payables growth vs cost-of-revenue growth</div>' + growthPair(M, "ap", "cogs"),
      ["ap", "ap_yoy", "cogs_yoy", "dpo", "accr"], null, function (o, M2, q) {
        var dd = E.val(q, "dpo_yoy"), a = E.val(q, "ap_yoy"), c = E.val(q, "cogs_yoy"), cfo = E.val(q, "cfo_yoy");
        if (dd != null) o[dd > 10 && cfo != null && cfo < 0 ? "neg" : "pos"].push("DPO " + fv("dpo_yoy", dd) + " versus a year ago [dpo_yoy]" + (dd > 10 && cfo != null && cfo < 0 ? " while operating cash flow fell — payments may be stretched to protect cash." : "."));
        if (a != null && c != null) o.pos.push("Payables " + pc(a) + " YoY vs cost of revenue " + pc(c) + ".");
        o.gaps.unshift("DPO uses cost of revenue as a proxy for supplier purchases (≈). Supplier-finance programmes are disclosed in notes, not the structured data.");
        o.why.push("Negotiated longer terms, supply-chain finance programmes, purchase timing — or delayed payments under cash pressure. Higher DPO is not automatically positive.");
        o.impl = dd == null ? "—" : "DPO " + (dd > 0 ? "lengthened" : "shortened") + "; read it alongside operating cash flow and DSO before calling it good or bad.";
        o.mon.push("DPO alongside cash flow: rising DPO with falling cash is the warning combination.");
      }, ["ap", "dpo", "cogs", "accr"]);
  }
  function cccCard(M) {
    var q = L(M), parts = ["dso", "dio", "dpo"].map(function (k) { return [k, E.val(q, k + "_yoy")]; });
    return page(M, "wc-ccc", "ccc", '<div class="pi-l">DSO, DIO and DPO — days</div>' + dayChart(M, ["dso", "dio", "dpo"]) + '<div class="pi-l" style="margin-top:8px">Cash conversion cycle</div>' + cols(S(M, "ccc"), { fmt: dfmt, neg: "var(--green)", color: C3, label: "Cash conversion cycle" }) +
      '<div class="pi-l" style="margin-top:8px">Working-capital cash effect (from the cash-flow statement)</div>' + cols(S(M, "wc_cf"), { neg: "var(--red)", color: "var(--green)", label: "Working capital cash effect" }),
      ["dso", "dio", "dpo", "ccc", "ccc_yoy", "wc_cf"], null, function (o, M2, q2) {
        var c = E.val(q2, "ccc_yoy");
        if (c != null) { (c > 5 ? o.neg : c < -5 ? o.pos : o.pos).push("Cash conversion cycle " + fv("ccc_yoy", c) + " versus a year ago [ccc_yoy].");
          var drv = parts.filter(function (x) { return x[1] != null; }).map(function (x) { return [x[0], x[0] === "dpo" ? -x[1] : x[1]]; }).sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); })[0];
          if (drv) o.pos.push("Largest driver: " + nm(drv[0]) + " (" + fv(drv[0] + "_yoy", E.val(q2, drv[0] + "_yoy")) + ")."); }
        var w = E.val(q2, "wc_cf"); if (w != null) (w >= 0 ? o.pos : o.neg).push("Working capital " + (w >= 0 ? "released " : "absorbed ") + money(Math.abs(w)) + " of cash in " + q2.fl.label + ".");
        o.impl = c == null ? "—" : c > 5 ? "More cash is tied up in operations than a year ago." : "Cash is cycling through operations as fast or faster than a year ago.";
        o.mon.push("Compare against the same quarter last year — working capital is seasonal.");
      }, ["dso", "dio", "dpo", "ccc", "wc_cf"]);
  }
  /* ---------------- capex & allocation ---------------- */
  function capexCard(M) {
    return page(M, "capex", "capex", '<div class="pi-l">Capex vs depreciation</div>' + lines([{ name: "Capex", color: C2, S: S(M, "capex") }, { name: "D&A", color: C1, S: S(M, "da") }], { fmt: f$, label: "Capex and D&A" }) +
      '<div class="pi-l" style="margin-top:8px">Capex intensity — % of revenue</div>' + lines([{ name: "Capex ÷ revenue", color: C2, S: S(M, "capexint") }], { h: 150, label: "Capex intensity" }),
      ["capex", "capex_yoy", "da", "capexda", "capexint", "rev_yoy"], ["capex"], function (o, M2, q) {
        var cd = E.val(q, "capexda"), cy = E.val(q, "capex_yoy"), r = E.val(q, "rev_yoy");
        if (cd != null) (cd > 1.2 ? o.pos : o.pos).push("Capex is " + cd.toFixed(2) + "× D&A [capexda] — " + (cd > 1.2 ? "net investment in the asset base." : cd < 0.8 ? "below the rate assets wear out." : "roughly maintaining the asset base."));
        if (cy != null && r != null && cy > 30 && r < 3) o.neg.push("Capex up " + pc(cy) + " YoY while revenue grew " + pc(r) + " — returns not yet visible.");
        o.gaps.unshift("Growth vs maintenance capex, capital commitments and capex guidance are not in the structured data — no split is inferred.");
        o.impl = cd == null ? "—" : cd > 1.5 ? "An investment phase: judge it by revenue, margin and returns in the quarters ahead." : "Investment broadly in line with depreciation.";
        o.mon.push("Revenue growth and ROIC over the next 4–8 quarters, to see whether the investment earns back.");
      }, ["capex", "da", "capexda", "capexint"]);
  }
  function allocCard(M) {
    var Q = M.quarters, i = Q.length - 1, t = function (k) { return E.ttm(Q, i, k); }, f4 = t("fcf");
    var steps = f4 == null ? null : [{ name: "FCF (TTM)", v: f4, total: 1 }].concat(
      [["div", "Dividends"], ["buyback", "Buybacks"], ["acq", "Acquisitions"]].filter(function (x) { return t(x[0]); }).map(function (x) { return { name: x[1], v: -t(x[0]) }; }),
      (t("dissue") != null || t("drepay") != null) ? [{ name: "Net debt flows", v: (t("dissue") || 0) - (t("drepay") || 0) }] : []);
    var gapsT = [["div", "dividends"], ["buyback", "buybacks"], ["acq", "acquisitions"]].filter(function (x) { return t(x[0]) == null && Q.slice(-4).some(function (q) { return E.val(q, x[0]) != null; }); }).map(function (x) { return x[1]; });
    if (steps) steps.push({ name: "Cash left", v: steps.reduce(function (a, s) { return s.total ? s.v : a + s.v; }, 0), total: 1 });
    return page(M, "alloc", "shret", '<div class="pi-l">Where the last twelve months of free cash flow went</div>' + (steps ? waterfall(steps) : '<p class="note">Needs four quarters of free cash flow.</p>') + (gapsT.length ? '<p class="note" style="color:var(--amber)">Not in the bridge: ' + gapsT.join(", ") + " — a quarter of the last four is not filed, so no TTM total is formed.</p>" : "") +
      '<div class="pi-l" style="margin-top:8px">Shareholder returns by quarter</div>' + stack(Q.slice(-8), [["div", "Dividends", C1], ["buyback", "Buybacks", C2]], { label: "Dividends and buybacks" }),
      ["fcf", "div", "buyback", "shret", "retained", "acq", "dissue", "drepay", "sbc", "sh_d"], null, function (o, M2, q) {
        var d4 = t("div") || 0, b4 = t("buyback") || 0, sb = t("sbc"), sy = E.val(q, "sh_d_yoy");
        if (f4 != null && f4 > 0) { var cov = (d4 + b4) / f4 * 100; (cov > 100 ? o.neg : o.pos).push("Dividends + buybacks were " + cov.toFixed(0) + "% of TTM FCF" + (cov > 100 ? " — funded partly by debt or cash balances." : ".")); }
        if (sb != null && b4) o[b4 >= sb ? "pos" : "neg"].push("Buybacks (" + money(b4) + " TTM) " + (b4 >= sb ? "exceed" : "fall short of") + " stock-based compensation (" + money(sb) + ")" + (sy != null ? "; diluted shares " + pc(sy) + " YoY." : "."));
        if (!b4) o.pos.push("No buybacks in the window — not a negative on its own.");
        o.impl = f4 == null ? "—" : f4 > 0 && d4 + b4 <= f4 ? "Distributions are covered by free cash flow." : "Distributions exceed free cash flow — sustainable only with balance-sheet capacity.";
        o.mon.push("FCF coverage of the dividend, and net share count.");
      }, ["div", "buyback", "acq", "dissue", "drepay", "sbc"]);
  }
  /* ---------------- debt ---------------- */
  function debtCard(M) {
    return page(M, "debt", "gdebt", '<div class="pi-l">Gross and net debt</div>' + lines([{ name: "Gross debt", color: C2, S: S(M, "gdebt") }, { name: "Net debt", color: C3, S: S(M, "ndebt") }, { name: "Cash", color: C1, S: S(M, "cash") }], { fmt: f$, zero: true, label: "Debt and cash" }) +
      '<div class="pi-l" style="margin-top:8px">Debt composition</div>' + stack(M.quarters.slice(-8), [["dcur", "Due within a year", C2], ["stb", "Short-term borrowings", C4], ["cp", "Commercial paper", C3], ["ltd_nc", "Long-term", C1]], { label: "Debt composition" }),
      ["gdebt", "gdebt_yoy", "ndebt", "cash", "sti", "dcur", "stb", "cp", "ltd_nc", "oplease", "finlease"], null, function (o, M2, q) {
        var g = E.val(q, "gdebt_yoy"), f = E.val(q, "fcf_yoy"), nd = E.val(q, "ndebt");
        if (nd != null) (nd < 0 ? o.pos : o.pos).push(nd < 0 ? "Net cash of " + money(-nd) + "." : "Net debt " + money(nd) + ".");
        if (g != null) (g > 15 ? o.neg : o.pos).push("Gross debt " + pc(g) + " YoY [gdebt_yoy]" + (f != null ? " against FCF " + pc(f) + "." : "."));
        o.gaps.unshift("Leases are shown separately and excluded from debt. Fixed/floating mix, currency and secured/unsecured split are in the notes, not structured data.");
        if (M2.model.kind !== "operating") o.gaps.unshift(M2.model.note);
        o.impl = g == null ? "—" : g > 15 ? "Debt is rising quickly — check whether cash generation and coverage keep pace (servicing card)." : "Debt is broadly stable.";
        o.mon.push("Debt growth against TTM free cash flow.");
      }, ["gdebt", "ndebt", "cash", "sti", "dcur", "stb", "cp", "ltd_nc", "oplease"]);
  }
  function costCard(M) {
    return page(M, "costdebt", "effcost", '<div class="pi-l">Borrowing cost — annualised, % of average gross debt</div>' + lines([{ name: "Effective interest cost", color: C2, S: S(M, "effcost") }, { name: "Cash borrowing cost", color: C1, S: S(M, "cashcost") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { label: "Borrowing cost" }) +
      '<div class="ue-ph" style="margin-top:8px">Weighted-average coupon and new-issue yield: UNAVAILABLE — they sit in the debt footnote tables, not the structured data. No rate is inferred from the balance alone.</div>',
      ["intexp", "intpaid", "gdebt", "effcost", "cashcost"], null, function (o, M2, q) {
        var e = E.val(q, "effcost"), ey = E.val(q, "effcost_yoy");
        if (ey != null) (ey > 0.5 ? o.neg : o.pos).push("Effective interest cost " + fv("effcost_yoy", ey) + " versus a year ago [effcost_yoy].");
        if (e != null && (e > 15 || e < 0.3)) o.gaps.unshift("An implausible rate (" + e.toFixed(1) + "%) usually means interest includes items outside the debt measured here (e.g. a finance arm or deposits) — treat with caution.");
        o.gaps.unshift("Average debt is the opening/closing average (≈); capitalised and lease interest are not separated in the structured data.");
        o.why.push("Refinancing maturing low-coupon debt at higher rates, floating-rate exposure, or a change in debt mix.");
        o.impl = ey == null ? "—" : ey > 0.5 ? "The financing burden is getting more expensive." : "Borrowing cost is stable or falling.";
        o.mon.push("Interest expense against average debt next quarter, and any new bond issues.");
      }, ["intexp", "intpaid", "gdebt", "effcost", "cashcost"]);
  }
  function maturityCard(M) {
    var mt = E.maturities(M), q = L(M);
    if (!mt) return shell(M, "maturity", '<div class="ue-ph">This filer does not tag its principal-maturity schedule in the structured data (it is in the debt footnote). No ladder is drawn rather than an estimated one.</div>');
    var lab = ["Next 12 months", "Year 2", "Year 3", "Year 4", "Year 5", "After year 5"], liq = (mt.cash || 0) + (mt.sti || 0);
    var m1 = mt.buckets[0] && mt.buckets[0].v, m23 = (mt.buckets[1] ? mt.buckets[1].v : 0) + (mt.buckets[2] ? mt.buckets[2].v : 0), tot = mt.buckets.reduce(function (a, b) { return a + (b ? b.v : 0); }, 0);
    var o = { cur: "", hist: "", ind: "No peer benchmark yet.", pos: [], neg: [], why: [], impl: "", mon: [], gaps: [] };
    o.cur = "As of " + mt.label + " (" + mt.end + "): " + money(m1) + " of principal due within 12 months, " + money(m23) + " in years 2–3, " + money(tot) + " scheduled in total.";
    o.hist = "The schedule is disclosed once a year in the 10-K, so there is no quarterly history.";
    if (m1 != null) (m1 <= liq ? o.pos : o.neg).push("Cash and short-term investments (" + money(liq) + ") " + (m1 <= liq ? "cover" : "do not cover") + " the next 12 months’ maturities.");
    if (mt.revolver != null) o.pos.push("Undrawn committed facilities: " + money(mt.revolver) + ".");
    else o.gaps.push("Undrawn credit capacity is not tagged — liquidity coverage counts cash only.");
    if (tot && m1 / tot > 0.25) o.neg.push(((m1 / tot) * 100).toFixed(0) + "% of scheduled principal falls due within a year — a near-term concentration.");
    o.impl = m1 == null ? "—" : m1 <= liq + (mt.revolver || 0) ? "Near-term maturities are covered by available liquidity." : "Near-term maturities exceed cash and undrawn facilities — refinancing access matters.";
    o.mon.push("Refinancing announcements and the next 10-K schedule."); o.gaps.push("Fixed/floating mix and covenants are footnote-only.");
    return shell(M, "maturity", '<div class="cx-hd"><div><div class="lab">Due within 12 months · ' + esc(mt.label) + '</div><div class="big">' + money(m1) + '</div></div><div><div class="lab">Cash + short-term investments</div><div class="m">' + money(liq) + '</div></div><div><div class="lab">Undrawn facilities</div><div class="m">' + money(mt.revolver) + "</div></div></div>" +
      '<div class="pi-l">Principal maturity ladder</div>' + bars(mt.buckets.map(function (b, i) { return { label: lab[i], v: b ? b.v : null, color: i === 0 ? C2 : C1 }; }).concat([{ label: "Cash + ST investments", v: liq, color: "var(--green)" }])) +
      '<div class="cx-sec"><div class="pi-l">Interpretation — rule-based, from the figures above</div>' + aiHTML(o) + "</div>" + evidence(M, ["cash", "sti", "revolver", "gdebt"]));
  }
  function serviceCard(M) {
    return page(M, "service", "int_cov", '<div class="pi-l">Interest coverage — TTM EBIT ÷ interest</div>' + lines([{ name: "Interest coverage", color: C1, S: S(M, "int_cov") }], { fmt: xfmt, h: 160 }) +
      '<div class="pi-l" style="margin-top:8px">Net debt ÷ TTM EBITDA</div>' + lines([{ name: "Net leverage", color: C2, S: S(M, "nd_ebitda") }], { fmt: xfmt, h: 160, zero: true }) +
      '<div class="pi-l" style="margin-top:8px">Cash interest burden — % of TTM operating cash flow</div>' + lines([{ name: "Cash interest burden", color: C4, S: S(M, "intburden") }], { h: 150 }),
      ["int_cov", "nd_ebitda", "intburden", "fcf_debt", "ebitda_ttm", "fcf_ttm"], null, function (o, M2, q) {
        var c = E.val(q, "int_cov"), l = E.val(q, "nd_ebitda"), cy = E.val(q, "int_cov_yoy"), ly = E.val(q, "nd_ebitda_yoy");
        if (M2.model.kind === "financial" || M2.model.kind === "insurer") o.gaps.unshift("EBITDA-based leverage is not meaningful for this business model.");
        if (cy != null) (cy < 0 ? o.neg : o.pos).push("Interest coverage " + fv("int_cov_yoy", cy) + " versus a year ago.");
        if (ly != null) (ly > 0.3 ? o.neg : o.pos).push("Net leverage " + fv("nd_ebitda_yoy", ly) + " versus a year ago.");
        o.impl = c == null ? "—" : c > 8 ? "Earnings carry the interest bill comfortably." : c < 3 ? "Interest absorbs a large share of operating earnings." : "Coverage is adequate.";
        o.mon.push("Debt growth against TTM FCF growth; coverage after the next quarter.");
      }, ["int_cov", "nd_ebitda", "intburden", "fcf_debt", "ebitda_ttm"]);
  }
  /* ---------------- ratios ---------------- */
  function liqCard(M) {
    return page(M, "liq", "cr", '<div class="pi-l">Liquidity ratios</div>' + lines([{ name: "Current", color: C1, S: S(M, "cr") }, { name: "Quick", color: C2, S: S(M, "qr") }, { name: "Cash", color: C3, S: S(M, "cashr") }], { fmt: function (v) { return v.toFixed(1) + "×"; }, ref: 1, label: "Liquidity ratios" }) +
      '<div class="stamp">Dashed line = 1.0×.</div><div class="pi-l" style="margin-top:8px">Current assets vs current liabilities</div>' + lines([{ name: "Current assets", color: C1, S: S(M, "ca") }, { name: "Current liabilities", color: C2, S: S(M, "cl") }], { fmt: f$ }),
      ["cr", "qr", "cashr", "ca", "cl", "wcap", "dcur"], null, function (o, M2, q) {
        var c = E.val(q, "cr"); if (c != null) (c >= 1.2 ? o.pos : c < 1 ? o.neg : o.pos).push("Current ratio " + c.toFixed(2) + "×.");
        if (E.val(q, "revolver")) o.pos.push("Plus undrawn facilities of " + money(E.val(q, "revolver")) + ".");
        o.impl = c == null ? "—" : c >= 1 ? "Short-term assets cover short-term obligations." : "Short-term obligations exceed short-term assets — reliance on operating cash or new borrowing.";
        o.mon.push("Current ratio and debt due within a year.");
      }, ["cr", "qr", "cashr", "ca", "cl"]);
  }
  function returnsCard(M) {
    return page(M, "returns", "roe", '<div class="pi-l">Returns on capital — TTM</div>' + lines([{ name: "ROE", color: C1, S: S(M, "roe") }, { name: "ROA", color: C2, S: S(M, "roa") }, { name: "ROIC (≈)", color: C3, S: S(M, "roic") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { zero: true, label: "Returns" }) +
      '<div class="pi-l" style="margin-top:8px">Margins</div>' + lines([{ name: "Gross", color: C1, S: S(M, "gm") }, { name: "Operating", color: C2, S: S(M, "opm") }, { name: "Net", color: C4, S: S(M, "nm") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { label: "Margins" }),
      ["roe", "roa", "roic", "gm", "opm", "nm"], null, function (o, M2, q) {
        var r = E.val(q, "roic"), ry = E.val(q, "roic_yoy"), e = E.val(q, "roe");
        if (ry != null) (ry >= 0 ? o.pos : o.neg).push("ROIC " + fv("roic_yoy", ry) + " versus a year ago (approximate) [roic_yoy].");
        if (e != null && r != null && e > r * 2.5) o.why.push("ROE well above ROIC points to leverage or buybacks shrinking equity rather than operating returns.");
        o.gaps.unshift("ROIC uses period-end capital and the effective tax rate (≈). No cost-of-capital comparison yet.");
        o.impl = r == null ? "—" : r > 15 ? "High returns on the capital deployed." : r < 6 ? "Returns are thin relative to typical capital costs." : "Moderate returns on capital.";
        o.mon.push("Whether incremental capex lifts ROIC over the next year.");
      }, ["roe", "roa", "roic", "eq", "assets"]);
  }
  function levCard(M) {
    function one(k, t, f) { return '<div class="pi-l" style="margin-top:6px">' + t + "</div>" + lines([{ name: t, color: C2, S: S(M, k) }], { fmt: f, h: 130, zero: true }); }
    return page(M, "lev", "nd_ebitda", one("nd_ebitda", "Net debt ÷ EBITDA", xfmt) + one("de", "Debt ÷ equity", xfmt) + one("int_cov", "Interest coverage", xfmt) + one("da_r", "Debt ÷ assets"),
      ["nd_ebitda", "de", "da_r", "int_cov", "gdebt", "ndebt", "eq"], null, function (o, M2, q) {
        var l = E.val(q, "nd_ebitda"), ly = E.val(q, "nd_ebitda_yoy");
        if (ly != null) (ly > 0.3 ? o.neg : o.pos).push("Net leverage " + fv("nd_ebitda_yoy", ly) + " YoY.");
        if (E.val(q, "eq") != null && E.val(q, "eq") < 0) o.gaps.unshift("Negative equity (often from buybacks) makes debt ÷ equity not meaningful.");
        o.impl = l == null ? "—" : l > 3 ? "Leverage is elevated — earnings growth must keep pace with debt." : "Leverage is moderate.";
        o.mon.push("Net leverage after the next quarter’s EBITDA.");
      }, ["nd_ebitda", "de", "da_r", "int_cov"]);
  }
  function effCard(M) {
    return page(M, "eff", "at", '<div class="pi-l">Turnover ratios — TTM</div>' + lines([{ name: "Inventory", color: C1, S: S(M, "invturn") }, { name: "Receivables", color: C2, S: S(M, "arturn") }, { name: "Payables", color: C3, S: S(M, "apturn") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { fmt: xfmt, label: "Turnover" }) +
      '<div class="pi-l" style="margin-top:8px">Asset turnover</div>' + lines([{ name: "Asset turnover", color: C4, S: S(M, "at") }], { fmt: function (v) { return v.toFixed(2) + "×"; }, h: 140 }),
      ["at", "invturn", "arturn", "apturn", "dso", "dio", "dpo", "ccc"], null, function (o, M2, q) {
        var a = E.val(q, "at_yoy"); if (a != null) (a >= 0 ? o.pos : o.neg).push("Asset turnover " + fv("at_yoy", a) + " YoY.");
        var c = E.val(q, "ccc_yoy"); if (c != null) (c <= 0 ? o.pos : o.neg).push("Cash conversion cycle " + fv("ccc_yoy", c) + " YoY.");
        o.impl = a == null ? "—" : a >= 0 ? "The asset base is generating as much or more revenue." : "Revenue per dollar of assets is falling — new assets may not yet be productive.";
        o.mon.push("Asset turnover as recent investment comes on line.");
      }, ["at", "invturn", "arturn", "apturn"]);
  }
  /* ---------------- early-warning engine ---------------- */
  function warnCard(M) {
    var W = E.warnings(M), order = { ACTIVE: 0, RESOLVED: 1, STALE: 2, "NOT TRIGGERED": 3, UNAVAILABLE: 4 };
    W.sort(function (a, b) { return (order[a.status] - order[b.status]) || ((b.severity ? E.SCALE.length : 0) - 0) || a.id - b.id; });
    var cls = { INFORMATIONAL: "MIXED", WATCH: "WEAK", CRITICAL: "NEGATIVE", "CONFIRMED DETERIORATION": "NEGATIVE" };
    function strip(h) { return '<div style="display:flex;gap:3px;margin:6px 0">' + h.map(function (x) { var bg = x.st === "C" ? "rgba(224,101,95,.65)" : x.st === "W" ? "rgba(232,163,61,.55)" : x.st === "ok" ? "rgba(63,185,127,.3)" : "transparent";
      return '<span title="' + esc(x.label + ": " + (x.text || x.st)) + '" style="flex:1;height:14px;border-radius:3px;background:' + bg + (x.st === "n/a" ? ";border:1px dashed var(--line2)" : "") + '"></span>'; }).join("") + "</div>"; }
    var act = W.filter(function (w) { return w.status === "ACTIVE"; }).length;
    return shell(M, "warn", '<div class="cx-hd"><div><div class="lab">Active signals</div><div class="big">' + act + ' <small style="font-size:14px;color:var(--muted)">of 12 rules</small></div></div><div class="m" style="max-width:520px;font-family:inherit;font-size:12.5px;color:var(--muted)">Each rule is re-run on every one of the last eight quarters using year-on-year comparisons (seasonality-safe). A signal escalates only when it persists; one quarter can reach CRITICAL but never CONFIRMED DETERIORATION.</div></div>' +
      W.map(function (w) {
        var badge = w.status === "ACTIVE" ? '<span class="cx-vd ' + cls[w.severity] + '">' + esc(w.severity) + "</span>" : '<span class="cx-vd ' + (w.status === "RESOLVED" ? "SOLID" : w.status === "NOT TRIGGERED" ? "STRONG" : "UNAVAILABLE") + '">' + esc(w.status) + "</span>";
        return '<details class="cx-evd" style="margin-top:8px"' + (w.status === "ACTIVE" ? " open" : "") + '><summary style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span><b style="color:var(--ink)">' + w.id + ". " + esc(w.title) + "</b>" + (w.text ? ' <span style="color:var(--faint)">— ' + esc(w.text) + "</span>" : "") + "</span>" + badge + "</summary>" +
          (w.history ? strip(w.history) + '<div class="stamp" style="margin-top:0;border:0;padding:0">' + w.history.map(function (h) { return esc(h.label); }).join(" · ") + " · orange = watch, red = critical, green = clear, dashed = no data</div>" : "") +
          '<dl class="ue-dl" style="grid-template-columns:auto 1fr;margin:8px 0">' +
          (w.status === "ACTIVE" ? "<dt>First observed</dt><dd style=\"text-align:left\">" + esc(w.first) + (w.first_ever !== w.first ? " (earlier episode " + esc(w.first_ever) + ")" : "") + "</dd><dt>Latest observed</dt><dd style=\"text-align:left\">" + esc(w.latest) + "</dd><dt>Persistence</dt><dd style=\"text-align:left\">" + w.persistence + " consecutive quarter" + (w.persistence > 1 ? "s" : "") + (w.escalated ? " — escalated for persistence" : "") + "</dd>" : "") +
          (w.status === "RESOLVED" ? '<dt>Resolution</dt><dd style="text-align:left">Last fired ' + esc(w.resolved_after) + "; clear in " + esc(w.latest) + "</dd>" : "") +
          (w.threshold ? '<dt>Threshold</dt><dd style="text-align:left">' + esc(w.threshold) + "</dd><dt>Comparison</dt><dd style=\"text-align:left\">" + esc(w.comp || "") + "</dd>" : "") +
          (w.alt ? '<dt>Alternative explanations</dt><dd style="text-align:left;font-family:inherit">' + esc(w.alt) + "</dd>" : "") +
          (w.note || w.partial ? '<dt>Data</dt><dd style="text-align:left;font-family:inherit">' + esc(w.note || w.partial) + "</dd>" : "") +
          '<dt>Confidence</dt><dd style="text-align:left">' + esc(w.confidence || "—") + '</dd><dt>Last reviewed</dt><dd style="text-align:left">' + esc(new Date().toISOString().slice(0, 10)) + " (live)</dd></dl></details>"; }).join("") +
      '<div class="stamp">Signals are recomputed from the filings on every visit; nothing is stored, so the audit trail is the eight-quarter strip rebuilt from what was filed at each quarter.</div>');
  }

  /* ---------------- public ---------------- */
  var CARDS = { snap: snapCard, verdicts: verdictCard, health: healthCard, revenue: revenueCard, gross: grossCard, operating: operatingCard, eps: epsCard, cfo: cfoCard, fcf: fcfCard,
    "wc-ar": arCard, "wc-inv": invCard, "wc-ap": apCard, "wc-ccc": cccCard, capex: capexCard, alloc: allocCard, debt: debtCard, costdebt: costCard, maturity: maturityCard, service: serviceCard,
    liq: liqCard, returns: returnsCard, lev: levCard, eff: effCard, warn: warnCard };
  function html(t) {
    if (!worker()) return '<div class="tile"><h2>Company research</h2><div class="ue-ph">Live search needs the AGRITrade SEC Worker. Once it is deployed, open the desk once with <code>?worker=https://&lt;name&gt;.workers.dev</code> — the address is remembered in this browser.</div></div>';
    var D = MEM[t]; if (!D) { load(t); D = MEM[t]; }
    if (D.loading) return '<div class="tile"><h2>' + esc(t) + '</h2><p class="note">Fetching SEC filings for ' + esc(t) + "… (live, nothing stored)</p></div>";
    if (D.err) return '<div class="tile"><h2>' + esc(t) + '</h2><div class="unreach">⚠ Could not load ' + esc(t) + " <small>— " + esc(D.err) + '</small></div><button class="ue-btn" data-coretry="' + esc(t) + '" style="margin-top:8px">Try again</button></div>';
    if (!D.M.quarters.length) return '<div class="tile"><h2>' + esc(t) + '</h2><div class="ue-ph">' + esc(D.co.name) + " has no US-GAAP quarterly figures in SEC XBRL" + (D.co.ifrs ? " (it files under IFRS)" : "") + ".</div></div>";
    return card && CARDS[card] ? CARDS[card](D.M, D.V) : grid(D.M, D.V);
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-cocard]"); if (b && b.closest("#panel-earnings")) { card = b.getAttribute("data-cocard") || null; rerender(); var m = document.querySelector("#panel-earnings .ut-main"); if (m) m.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    b = t.closest("[data-coretry]"); if (b) { delete MEM[b.getAttribute("data-coretry")]; rerender(); }
  });
  window.COMPANY = { html: html, search: search, configured: function () { return !!worker(); }, reset: function () { card = null; }, _mem: MEM };
})();
