/* fxforecast.js — USD/CAD Expected Move & Forecast Intelligence (owner, Nov 23 2026). Replaces the USD/CAD volatility cone on
   FX › Overview with a two-tab card: Forecast Dashboard · Knowledge Centre. Grains and US indices keep volcone.js.

   Engine (pure, unit-tested in tests/fxforecast.test.js — every number is computed from data already on the desk):
   · Statistical σ — three models of the h-session variance, each re-estimated at every origin with data up to that origin only:
       EWMA (RiskMetrics λ 0.94) · GARCH(1,1) (grid-search Gaussian MLE, variance-targeted; parameters fitted on the sessions before
       the first test origin, then refitted on everything for today's forecast) · historical simulation (variance of overlapping
       h-session log returns over the trailing 250 sessions)
   · Blend weights ∝ 1 / mean squared error of each model's h-session variance forecast against the realised squared return,
       measured walk-forward on the trailing 250 completed origins (no look-ahead)
   · Market-implied σ — the stored 25-delta call/put IVs. Shown and compared with realised vol, but given 0 weight: the desk has
       no IV history, so its forecast skill cannot be validated, and the stored pull is dated (staleness shown)
   · Macro-regime / direction — six rules fixed in advance from theory (2Y US−CA spread, WTI, DXY, trend, momentum, contrarian
       CFTC). Each is scored out-of-sample (no fitting) on its hit rate for the sign of the h-session return; only rules that pass
       a one-sided 95% binomial test on the overlap-adjusted sample vote. No passing rule → neutral bias and zero drift
   · Shape — skew and excess kurtosis of EWMA-standardised daily returns, kept only when beyond 2 standard errors, scaled to the
       horizon (skew / √h, kurtosis / h) and applied by Cornish–Fisher → asymmetric bands only where the data supports them
   · Back-test — 1σ / 2σ coverage, error, directional hit rate, by horizon, by rolling 30/60/90-origin window and by vol regime,
       with sample sizes and overlap-adjusted effective samples */
(function (root) {
  "use strict";
  var E = {};
  var H = { "1W": 5, "2W": 10, "1M": 21, "3M": 63 }, HK = ["1W", "2W", "1M", "3M"];
  E.H = H; E.HK = HK;
  var Z1 = 0.8413447, Z2 = 0.9772499, Z3 = 0.9986501;

  /* ---------- maths ---------- */
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
  function variance(a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? s / (a.length - 1) : NaN; }
  function ncdf(x) { var t = 1 / (1 + 0.2316419 * Math.abs(x)), y = 0.3989423 * Math.exp(-x * x / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - y : y; }
  function ninv(p) { /* Acklam */
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  /* Cornish–Fisher quantile of a standardised variable with skew s and excess kurtosis k (kept inside the monotone region) */
  function cf(z, s, k) { s = Math.max(-0.8, Math.min(0.8, s || 0)); k = Math.max(0, Math.min(4, k || 0)); return z + (z * z - 1) * s / 6 + (z * z * z - 3 * z) * k / 24 - (2 * z * z * z - 5 * z) * s * s / 36; }
  E.ncdf = ncdf; E.ninv = ninv; E.cf = cf;
  function logret(c) { var r = []; for (var i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); return r; }
  E.logret = logret;
  function emaArr(c, n) { var o = new Array(c.length).fill(null); if (c.length < n) return o; var k = 2 / (n + 1), e = 0, j; for (j = 0; j < n; j++) e += c[j]; e /= n; o[n - 1] = e; for (j = n; j < c.length; j++) { e = c[j] * k + e * (1 - k); o[j] = e; } return o; }
  E.emaArr = emaArr;

  /* ---------- volatility models ---------- */
  /* v[t] = EWMA variance forecast for return r[t], using r[0..t-1] */
  function ewma(r, lam) { lam = lam || 0.94; var v = new Array(r.length), init = 0, m = Math.min(20, r.length); for (var i = 0; i < m; i++) init += r[i] * r[i]; v[0] = init / m; for (var t = 1; t < r.length; t++) v[t] = lam * v[t - 1] + (1 - lam) * r[t - 1] * r[t - 1]; return v; }
  E.ewma = ewma;
  function garchFilter(r, a, b, vbar) { var w = (1 - a - b) * vbar, v = new Array(r.length + 1); v[0] = vbar; for (var t = 0; t < r.length; t++) v[t + 1] = w + a * r[t] * r[t] + b * v[t]; return v; }
  function garchFit(r) {
    var vbar = variance(r), best = null;
    for (var a = 0.02; a <= 0.2001; a += 0.01) for (var b = 0.70; b <= 0.9801; b += 0.01) {
      if (a + b >= 0.995) continue;
      var v = garchFilter(r, a, b, vbar), ll = 0;
      for (var t = 0; t < r.length; t++) ll += -0.5 * (Math.log(v[t]) + r[t] * r[t] / v[t]);
      if (!best || ll > best.ll) best = { a: +a.toFixed(2), b: +b.toFixed(2), vbar: vbar, ll: ll };
    }
    return best;
  }
  E.garchFit = garchFit;
  /* cumulative h-step variance from a one-step forecast v1 */
  function garchH(v1, P, h) { var s = 0, p = P.a + P.b; for (var k = 1; k <= h; k++) s += P.vbar + Math.pow(p, k - 1) * (v1 - P.vbar); return s; }
  E.garchH = garchH;
  function hsVar(r, end, h, win) { var x = [], st = Math.max(0, end - (win || 250)); for (var i = st; i + h <= end; i++) { var s = 0; for (var j = i; j < i + h; j++) s += r[j]; x.push(s); } return x.length >= 20 ? variance(x) : null; }
  E.hsVar = hsVar;

  /* ---------- shape ---------- */
  function shape(r, v) {
    var z = []; for (var t = 30; t < r.length; t++) if (v[t] > 0) z.push(r[t] / Math.sqrt(v[t]));
    var m = mean(z), sd = Math.sqrt(variance(z)), n = z.length, s3 = 0, s4 = 0;
    z.forEach(function (x) { var u = (x - m) / sd; s3 += u * u * u; s4 += u * u * u * u; });
    var skew = s3 / n, kurt = s4 / n - 3, seS = Math.sqrt(6 / n), seK = Math.sqrt(24 / n);
    return { n: n, skew: skew, kurt: kurt, seS: seS, seK: seK, useS: Math.abs(skew) > 2 * seS, useK: kurt > 2 * seK };
  }
  E.shape = shape;

  /* ---------- direction drivers (rules fixed a priori; scored out-of-sample) ---------- */
  function seriesAt(S, dates) { /* last value on or before each date */
    var o = new Array(dates.length).fill(null), j = 0; if (!S || !S.length) return o;
    for (var i = 0; i < dates.length; i++) { while (j + 1 < S.length && S[j + 1][0] <= dates[i]) j++; if (S[j][0] <= dates[i]) o[i] = +S[j][1]; }
    return o;
  }
  function chg(x, i, n, log) { if (i - n < 0 || x[i] == null || x[i - n] == null) return null; return log ? Math.log(x[i] / x[i - n]) : x[i] - x[i - n]; }
  E.DRIVERS = [
    { id: "spread", pillar: "B", name: "US–CA 2Y spread, 10-session change", unit: "bp", theory: "A wider US-over-Canada 2-year spread pays more to hold USD → USD/CAD up" },
    { id: "wti", pillar: "B", name: "WTI crude, 10-session change", unit: "%", theory: "Higher oil lifts Canada's terms of trade → CAD up → USD/CAD down" },
    { id: "dxy", pillar: "B", name: "DXY, 10-session change", unit: "%", theory: "A broadly stronger USD → USD/CAD up" },
    { id: "trend", pillar: "D", name: "Price vs EMA50", unit: "σ", theory: "Trend persistence: above EMA50 → USD/CAD up" },
    { id: "mom", pillar: "D", name: "20-session momentum", unit: "%", theory: "Momentum: a rising 20-session return → USD/CAD up" },
    { id: "cot", pillar: "C", name: "CFTC leveraged funds (CAD) z-score, contrarian", unit: "z", theory: "Crowded CAD shorts (z < −1) unwind → USD/CAD down; crowded CAD longs (z > +1) → USD/CAD up" }
  ];
  function driverSeries(I) {
    var d = I.dates, c = I.close, n = c.length, wti = seriesAt(I.wti, d), dxy = seriesAt(I.dxy, d), sp = seriesAt(I.spread, d), cz = seriesAt(I.cotz, d), e50 = emaArr(c, 50), r = logret(c), v = ewma(r);
    var out = {}; E.DRIVERS.forEach(function (D) { out[D.id] = { val: new Array(n).fill(null), sig: new Array(n).fill(0) }; });
    for (var i = 0; i < n; i++) {
      var x;
      x = chg(sp, i, 10, false); if (x != null) { out.spread.val[i] = x; out.spread.sig[i] = Math.abs(x) >= 2 ? Math.sign(x) : 0; }
      x = chg(wti, i, 10, true); if (x != null) { out.wti.val[i] = x * 100; out.wti.sig[i] = Math.abs(x) >= 0.01 ? -Math.sign(x) : 0; }
      x = chg(dxy, i, 10, true); if (x != null) { out.dxy.val[i] = x * 100; out.dxy.sig[i] = Math.abs(x) >= 0.002 ? Math.sign(x) : 0; }
      if (e50[i] != null && i > 0 && v[i - 1]) { x = (c[i] - e50[i]) / (c[i] * Math.sqrt(v[i - 1] * 20)); out.trend.val[i] = x; out.trend.sig[i] = Math.abs(x) >= 0.25 ? Math.sign(x) : 0; }
      x = chg(c, i, 20, true); if (x != null) { out.mom.val[i] = x * 100; out.mom.sig[i] = Math.abs(x) >= 0.003 ? Math.sign(x) : 0; }
      if (cz[i] != null) { out.cot.val[i] = cz[i]; out.cot.sig[i] = cz[i] <= -1 ? -1 : cz[i] >= 1 ? 1 : 0; }
    }
    return out;
  }
  E.driverSeries = driverSeries;
  function scoreDriver(sig, c, h, from) {
    var hit = 0, n = 0;
    for (var i = from; i + h < c.length; i++) { if (!sig[i]) continue; var R = Math.log(c[i + h] / c[i]); if (R === 0) continue; n++; if (Math.sign(R) === sig[i]) hit++; }
    var neff = n / h, rate = n ? hit / n : null, z = n ? (rate - 0.5) / Math.sqrt(0.25 / Math.max(neff, 1)) : null;
    return { n: n, neff: neff, hit: rate, z: z, pass: !!(n && neff >= 15 && z > 1.645) };
  }
  E.scoreDriver = scoreDriver;

  /* ---------- the forecast ---------- */
  /* I = {dates, close, wti, dxy, spread, cotz, iv:{call,put,asof,rr}, today} ; returns per-horizon results */
  E.run = function (I) {
    var c = I.close, d = I.dates, r = logret(c), n = c.length, v = ewma(r), T0 = Math.min(150, Math.floor(n * 0.4));
    var gp0 = garchFit(r.slice(0, T0)), gpAll = garchFit(r), g0 = garchFilter(r, gp0.a, gp0.b, gp0.vbar), gAll = garchFilter(r, gpAll.a, gpAll.b, gpAll.vbar);
    var SH = shape(r, v), drv = driverSeries(I);
    /* realised-vol regime: 20-session RV percentile within the trailing 250 */
    var rv20 = new Array(n).fill(null); for (var i = 20; i < n; i++) { var s = 0; for (var j = i - 20; j < i; j++) s += r[j] * r[j]; rv20[i] = Math.sqrt(s / 20 * 252); }
    function pctl(i) { var x = rv20[i], a = []; for (var j = Math.max(20, i - 250); j <= i; j++) if (rv20[j] != null) a.push(rv20[j]); if (x == null || a.length < 60) return null; return a.filter(function (y) { return y <= x; }).length / a.length; }
    var res = { shape: SH, garch: gpAll, n: n, last: d[n - 1], horizons: {} };
    var rvP = pctl(n - 1); res.rv20 = rv20[n - 1]; res.rv60 = Math.sqrt(mean(r.slice(-60).map(function (x) { return x * x; })) * 252); res.rvPct = rvP;
    res.regime = rvP == null ? "normal" : rvP < 0.2 ? "low" : rvP < 0.8 ? "normal" : rvP < 0.95 ? "elevated" : "extreme";
    res.ewmaAnn = Math.sqrt((0.94 * v[r.length - 1] + 0.06 * r[r.length - 1] * r[r.length - 1]) * 252);
    res.garchLR = Math.sqrt(gpAll.vbar * 252);
    if (I.iv && I.iv.call && I.iv.put) { res.iv = (I.iv.call + I.iv.put) / 2; res.ivAsof = I.iv.asof; res.ivAge = I.iv.asof && I.today ? Math.round((Date.parse(I.today) - Date.parse(I.iv.asof)) / 864e5) : null; res.rr = I.iv.rr; }
    res.drv = drv;
    HK.forEach(function (key) {
      var h = H[key], Hres = {}, models = ["ewma", "garch", "hs"];
      /* per-origin variance forecasts for h sessions ahead of close index t (returns r[t..t+h-1]) */
      function fc(t, which, live) {
        if (which === "ewma") { var v1 = t < r.length ? v[t] : 0.94 * v[t - 1] + 0.06 * r[t - 1] * r[t - 1]; return h * v1; }
        if (which === "garch") { var G = live ? gAll : g0, P = live ? gpAll : gp0; return garchH(G[t], P, h); }
        return hsVar(r, t, h, 250);
      }
      var rows = [];
      for (var t = T0; t + h <= r.length; t++) {
        var R = 0; for (var j = t; j < t + h; j++) R += r[j];
        rows.push({ t: t, R: R, f: { ewma: fc(t, "ewma"), garch: fc(t, "garch"), hs: fc(t, "hs") } });
      }
      function weightsAt(k) { /* from origins whose outcome was known at origin k (t + h <= k), trailing 250 */
        var err = { ewma: [], garch: [], hs: [] };
        rows.forEach(function (q) { if (q.t + h <= k && q.t > k - 250 - h) models.forEach(function (m) { if (q.f[m] != null) err[m].push(Math.pow(q.R * q.R - q.f[m], 2)); }); });
        var w = {}, tot = 0; models.forEach(function (m) { w[m] = err[m].length >= 20 ? 1 / mean(err[m]) : 0; tot += w[m]; });
        if (!tot) { models.forEach(function (m) { w[m] = 1 / 3; }); return { w: w, n: 0 }; }
        models.forEach(function (m) { w[m] /= tot; }); return { w: w, n: err.ewma.length };
      }
      function blend(f, W) { var s = 0, tw = 0; models.forEach(function (m) { if (f[m] != null) { s += W[m] * f[m]; tw += W[m]; } }); return tw ? s / tw : null; }
      var sk = SH.useS ? SH.skew / Math.sqrt(h) : 0, ku = SH.useK ? SH.kurt / h : 0;
      /* back-test */
      var bt = [];
      rows.forEach(function (q) {
        var W = weightsAt(q.t), V = blend(q.f, W.w); if (!V || W.n < 20) return;
        var sd = Math.sqrt(V), lo1 = sd * cf(-1, sk, ku), hi1 = sd * cf(1, sk, ku), lo2 = sd * cf(-2, sk, ku), hi2 = sd * cf(2, sk, ku), med = sd * cf(0, sk, ku);
        bt.push({ t: q.t, d: d[q.t], R: q.R, sd: sd, in1: q.R >= lo1 && q.R <= hi1, in2: q.R >= lo2 && q.R <= hi2, err: Math.abs(q.R - med), reg: pctl(q.t), px: c[q.t] });
      });
      /* drivers scored on all completed origins (rules are fixed, so every origin is out-of-sample) */
      var DS = {}, votes = 0, wtot = 0, nowSig = {};
      E.DRIVERS.forEach(function (D) {
        var S = drv[D.id], sc = scoreDriver(S.sig, c, h, 20); DS[D.id] = sc; nowSig[D.id] = S.sig[n - 1];
        if (sc.pass) { var w = sc.hit - 0.5; votes += w * S.sig[n - 1]; wtot += w; }
      });
      var score = wtot ? votes / wtot : 0, bias = !wtot ? "neutral" : score > 0.33 ? "bull" : score < -0.33 ? "bear" : "neutral";
      /* composite back-test hit rate (only meaningful if some driver passes) */
      var compHit = null;
      if (wtot) { var ch = 0, cn = 0; for (var t2 = 20; t2 + h < n; t2++) { var cv = 0; E.DRIVERS.forEach(function (D) { if (DS[D.id].pass) cv += (DS[D.id].hit - 0.5) * drv[D.id].sig[t2]; }); cv /= wtot; if (Math.abs(cv) < 0.33) continue; var RR = Math.log(c[t2 + h] / c[t2]); if (!RR) continue; cn++; if (Math.sign(RR) === Math.sign(cv)) ch++; } compHit = { hit: cn ? ch / cn : null, n: cn, neff: cn / h }; }
      /* drift: only when the composite is directional and historically right; half the historical mean move, sign-matched */
      var mu = 0;
      if (bias !== "neutral" && compHit && compHit.hit > 0.55) { var mv = []; for (var t3 = 20; t3 + h < n; t3++) { var cv3 = 0; E.DRIVERS.forEach(function (D) { if (DS[D.id].pass) cv3 += (DS[D.id].hit - 0.5) * drv[D.id].sig[t3]; }); cv3 /= wtot; if (Math.sign(cv3) === Math.sign(score) && Math.abs(cv3) >= 0.33) mv.push(Math.log(c[t3 + h] / c[t3])); } if (mv.length >= 20) mu = 0.5 * mean(mv); }
      /* today's forecast */
      var Wn = weightsAt(r.length + h), fnow = { ewma: fc(r.length, "ewma", true), garch: garchH(gAll[r.length], gpAll, h), hs: hsVar(r, r.length, h, 250) };
      var Vn = blend(fnow, Wn.w), sdn = Math.sqrt(Vn);
      function stats(list) { if (!list.length) return { n: 0 }; return { n: list.length, neff: list.length / h, cov1: mean(list.map(function (b) { return b.in1 ? 1 : 0; })), cov2: mean(list.map(function (b) { return b.in2 ? 1 : 0; })), mae: mean(list.map(function (b) { return b.err; })), zeroMae: mean(list.map(function (b) { return Math.abs(b.R); })) }; }
      var all = stats(bt), win = {}; [30, 60, 90].forEach(function (w) { win[w] = stats(bt.slice(-w)); });
      var reg = { low: stats(bt.filter(function (b) { return b.reg != null && b.reg < 0.33; })), normal: stats(bt.filter(function (b) { return b.reg != null && b.reg >= 0.33 && b.reg < 0.67; })), high: stats(bt.filter(function (b) { return b.reg != null && b.reg >= 0.67; })) };
      var prev = bt.length ? bt[bt.length - 1] : null; /* the last origin whose outcome is known: forecast made h sessions before the last close */
      var conf = "low"; if (all.n && all.neff >= 20) { var e1 = Math.abs(all.cov1 - 0.6827), e2 = Math.abs(all.cov2 - 0.9545); conf = e1 <= 0.05 && e2 <= 0.03 ? "high" : e1 <= 0.10 && e2 <= 0.06 ? "medium" : "low"; }
      Hres = { h: h, sd: sdn, sk: sk, ku: ku, mu: mu, w: Wn.w, wn: Wn.n, f: fnow, bt: all, win: win, reg: reg, prev: prev ? { d: prev.d, px: prev.px, sd: prev.sd, R: prev.R, in1: prev.in1, in2: prev.in2, endD: d[prev.t + h], endPx: c[prev.t + h] } : null,
        drivers: DS, nowSig: nowSig, score: score, bias: bias, compHit: compHit, conf: conf };
      res.horizons[key] = Hres;
    });
    return res;
  };
  /* price quantile at probability p, t sessions ahead (t <= h), anchored at spot */
  E.q = function (Hr, spot, p, t) { t = t == null ? Hr.h : t; var f = t / Hr.h, sd = Hr.sd * Math.sqrt(f), sk = Hr.sk * Math.sqrt(Hr.h / t), ku = Hr.ku * Hr.h / t; return spot * Math.exp(Hr.mu * f + sd * cf(ninv(p), sk, ku)); };
  /* P(price at horizon >= L) by bisection on the quantile function; touch ≈ 2 × end-beyond (reflection, zero drift), capped at 1 */
  E.pAbove = function (Hr, spot, L) { var lo = 1e-6, hi = 1 - 1e-6; for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (E.q(Hr, spot, m) < L) lo = m; else hi = m; } return 1 - (lo + hi) / 2; };
  E.pTouch = function (Hr, spot, L) { var pe = L >= spot ? E.pAbove(Hr, spot, L) : 1 - E.pAbove(Hr, spot, L); return Math.min(1, 2 * pe); };

  /* ---------- implied-vol mapping (CME 6C / CVOL → USD/CAD) ----------
     6C futures quote USD per CAD = 1 / USDCAD. Log returns of an inverse pair are the negative of each other, so volatility is
     identical; a 6C call at strike K is a USD/CAD put at 1/K, so the USD/CAD 25Δ risk reversal is the 6C one with the sign
     flipped and the butterfly is unchanged. CVOL (CAVL) is CME's 30-day implied-vol index on CAD/USD options → use it as ATM. */
  E.map6C = function (q) {
    q = q || {}; var o = { src: q.src || "" };
    if (q.atm != null) o.atm = +q.atm;
    if (q.call25 != null && q.put25 != null) { o.rr25 = +(q.put25 - q.call25).toFixed(3); o.call25 = +q.put25; o.put25 = +q.call25; if (q.atm != null) o.bf25 = +(((+q.call25 + +q.put25) / 2) - q.atm).toFixed(3); }
    if (q.rr25 != null && o.rr25 == null) o.rr25 = -q.rr25;
    if (q.strike != null) o.strike = 1 / q.strike;
    return o;
  };
  /* expected move from an annualised vol (%) over h sessions: ±IV × √(h/252) */
  E.ivMove = function (ivPct, spot, h) { var s = ivPct / 100 * Math.sqrt((h || 1) / 252); return { pct: s * 100, pips: spot * s * 1e4, lo: spot * Math.exp(-s), hi: spot * Math.exp(s) }; };

  root.FXF_ENGINE = E;
  if (typeof module !== "undefined" && module.exports) { module.exports = E; return; }

  /* ======================================================================================== UI */
  var doc = root.document; if (!doc) return;
  var ST = { tab: "dash", hz: "1M", ema: true, s3: false, lv: true, ev: true };
  try { var sv = JSON.parse(localStorage.getItem("desk.fxf") || "{}"); for (var k0 in sv) if (k0 in ST) ST[k0] = sv[k0]; if (!H[ST.hz]) ST.hz = "1M"; } catch (e) {}
  function save() { try { localStorage.setItem("desk.fxf", JSON.stringify(ST)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var TZ = "America/Toronto", DF = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), DFY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }),
    TS = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function md(iso) { return iso ? DF.format(new Date(String(iso).slice(0, 10) + "T12:00:00Z")) : "—"; }
  function mdy(iso) { return iso ? DFY.format(new Date(String(iso).slice(0, 10) + "T12:00:00Z")) : "—"; }
  function addBiz(s, n) { var d = new Date(s + "T12:00:00Z"); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); }
  function bizBetween(a, b) { var n = 0, d = new Date(a + "T12:00:00Z"), e = new Date(b + "T12:00:00Z"); while (d < e) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n++; } return n; }
  function pips(x) { return Math.round(x * 1e4); }
  function f5(x) { return x == null || isNaN(x) ? "—" : (+x).toFixed(5); }
  function f4(x) { return x == null || isNaN(x) ? "—" : (+x).toFixed(4); }
  function pc(x, dp) { return x == null || isNaN(x) ? "—" : (x * 100).toFixed(dp == null ? 0 : dp) + "%"; }
  function sg(x, dp, u) { return x == null || isNaN(x) ? "—" : (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(dp) + (u || ""); }
  function cls(x) { return x > 0 ? "up" : x < 0 ? "dn" : ""; }

  /* ---------- inputs from the desk ---------- */
  function inputs() {
    var D = root.DATA; if (!D || !D.fx || !D.grain_long || !D.grain_long.other) return null;
    var O = D.grain_long.other, U = O.usdcad || []; if (U.length < 200) return null;
    var F = D.fx, ysm = (F.ysm && F.ysm.hist) || [], kp = (F.pos && F.pos.kpi) || {}, fo = F.fxopt || {};
    return { dates: U.map(function (x) { return x[0]; }), close: U.map(function (x) { return +x[1]; }), wti: O.wti || [], dxy: O.dxy || [],
      spread: ysm.filter(function (x) { return x.us && x.ca && x.us["2Y"] != null && x.ca["2Y"] != null; }).map(function (x) { return [x.d, (x.us["2Y"] - x.ca["2Y"]) * 100]; }),
      cotz: (kp.z_hist || []).map(function (x) { return [addBiz(String(x[0]).slice(0, 10), 3), +x[1]]; }),   /* Tuesday positions, public Friday → usable from the Friday */
      iv: fo.civ || fo.atm || fo.cvol ? { call: +(fo.civ || fo.atm || fo.cvol), put: +(fo.piv || fo.atm || fo.cvol), rr: fo.rr25 != null ? fo.rr25 : fo.rr, asof: fo.asof } : null, today: new Date().toISOString().slice(0, 10) };
  }
  /* market-implied vol in use: a value you entered (per browser, ≤ 3 days old) if newer than the desk's stored pull */
  var IVK = "desk.fxf.iv";
  function ivMan() { try { var o = JSON.parse(localStorage.getItem(IVK) || "null"); return o && o.v > 0 && Date.now() - o.t < 3 * 864e5 ? o : null; } catch (e) { return null; } }
  function ivNow() {
    var fo = (root.DATA.fx || {}).fxopt || {}, m = ivMan(), atm = fo.atm || fo.cvol || (fo.civ && fo.piv ? (+fo.civ + +fo.piv) / 2 : null), at = fo.asof ? Date.parse(String(fo.asof).length <= 10 ? fo.asof + "T21:00:00Z" : fo.asof) : 0;
    var d = atm ? { atm: +atm, t: at, src: fo.source || (fo.atm ? "ATM implied vol" : fo.cvol ? "CME CVOL (CAVL)" : "25Δ call/put average"), rr: fo.rr25 != null ? +fo.rr25 : fo.rr != null ? +fo.rr : null, bf: fo.bf25 != null ? +fo.bf25 : null, term: fo.term || null, man: false } : null;
    var use = m && (!d || m.t > d.t) ? { atm: +m.v, t: m.t, src: m.src + " · entered by you", rr: null, bf: null, term: null, man: true } : d;
    if (use) { use.age = (Date.now() - use.t) / 864e5; use.fresh = use.age <= 3; }
    return use;
  }
  var CACHE = { key: "", res: null };
  function engine() {
    var I = inputs(); if (!I) return null;
    var key = I.dates[I.dates.length - 1] + "|" + I.close.length + "|" + I.close[I.close.length - 1] + "|" + (I.spread.length) + "|" + I.wti.length;
    if (CACHE.key !== key) { CACHE = { key: key, res: E.run(I), I: I }; }
    return CACHE;
  }
  function spotNow() {
    var D = root.DATA, F = D.fx || {}, fd = F.feed || {}, bs = root.PRICE_SYNC && PRICE_SYNC.best("CAD=X");
    if (bs && bs.px) return { px: +bs.px, ts: bs.ts, src: bs.src };
    if (fd.mid) return { px: +fd.mid, ts: Date.parse(fd.ts), src: "desk FX feed (delayed)" };
    var U = D.grain_long.other.usdcad; return { px: +U[U.length - 1][1], ts: Date.parse(U[U.length - 1][0] + "T21:00:00Z"), src: "last daily close" };
  }
  function evList(h, lastD) {
    var D = root.DATA, end = addBiz(lastD, h), now = Date.now();
    return ((D.fx && D.fx.events) || []).filter(function (e) { return e.impact === "High" && e.date >= new Date(now).toISOString().slice(0, 10) && e.date <= end; })
      .map(function (e) { return { date: e.date, time: e.time, ccy: e.ccy, ev: e.event, fc: e.fc, prev: e.prev }; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function levels(m) {
    var F = root.DATA.fx, Lv = F.levels || {}, cot = ((F.pos || {}).series || []).filter(function (c) { return c.px; }).slice(-1)[0], o = [];
    if (Lv.r20) o.push(["R20 · 20-session high close", +Lv.r20, "R20"]); if (Lv.s20) o.push(["S20 · 20-session low close", +Lv.s20, "S20"]);
    if (Lv.r50 && Math.abs(Lv.r50 - Lv.r20) > 1e-6) o.push(["R50 · 50-session high close", +Lv.r50, "R50"]); if (Lv.s50) o.push(["S50 · 50-session low close", +Lv.s50, "S50"]);
    if (cot) o.push(["COT price " + md(cot.date), +cot.px, "COT"]);
    return o;
  }

  /* ---------- info popovers ---------- */
  var INFO = {
    move: ["Expected move", "The ±1σ range the blended volatility model gives for the selected horizon, in pips and %. About two times in three the close at the horizon should land inside it — if the model is calibrated (see Forecast accuracy).",
      "It sizes risk: stops, targets and position size should scale with it. It says nothing about direction.", "Large vs its own history = a volatile regime; small = quiet. Compare with the Volatility regime card.",
      "1σ is not a wall: about one close in three lands outside it. Bands assume today's volatility persists over the horizon.", "Spot 1.4000, 1M σ 1.20% → 1.4000 × 1.20% ≈ 168 pips."],
    bias: ["Directional bias", "The vote of the direction rules that passed an out-of-sample test at this horizon. Rules that failed don't vote. No passing rule → Neutral.",
      "Separates 'how far' (the cone) from 'which way' (this card). Most FX signals fail out of sample — the card shows that rather than inventing an edge.", "Bullish = USD/CAD expected higher (USD up / CAD down); bearish = lower.",
      "A passing rule's historical hit rate is often only 55–60%. Overlapping windows mean the effective sample is far smaller than the raw count.", "If only 'DXY 10-session change' passes (hit 58%) and DXY rose, the bias is bullish USD/CAD."],
    regime: ["Volatility regime", "Where today's 20-session realised volatility sits against its own last 250 sessions: below the 20th percentile = low, 20–80 = normal, 80–95 = elevated, above 95 = extreme.",
      "Volatility clusters: calm tends to follow calm and stress follows stress, so the regime shapes how wide the cone should be.", "Low regimes often end abruptly (vol expansion); extreme regimes usually decay.",
      "Percentile of a short, 1.5-year history; regime boundaries are conventions, not laws.", "RV20 4.0% with 70% of the last 250 readings below it → 70th percentile → normal."],
    conf: ["Forecast confidence", "Calibration, not conviction: how closely the model's past 1σ and 2σ bands at this horizon captured the actual outcome (targets 68.3% and 95.4%), on the overlap-adjusted sample.",
      "A band that captured 68% of outcomes historically can be read at face value; one that captured 50% is too narrow.", "High: within 5 pp (1σ) and 3 pp (2σ). Medium: within 10 / 6 pp. Low: worse, or fewer than 20 independent windows.",
      "Calibration in the past does not guarantee calibration in a new regime.", "1σ captured 66% vs 68% target, 2σ 94% vs 95% → High."],
    cat: ["Key catalyst", "The next high-impact US or Canadian release inside the horizon, from the desk's economic calendar.",
      "Releases are where realised volatility jumps — the main reason a calm cone fails.", "A CPI, jobs or central-bank day inside a 1W window matters far more than the same day inside a 3M window.",
      "The cone is not stepped up for event days: the desk has no event-day history for USD/CAD to measure the step.", "BoC decision in 2 sessions → expect a larger-than-average daily move that day."],
    cone: ["Forecast cone", "Percentile bands of the price distribution for every session out to the horizon: dark = 1σ (16th–84th), mid = 2σ (2.3rd–97.7th), faint = 3σ (0.13th–99.87th, optional). Dashed line = median.",
      "Shows how uncertainty grows with time: width scales roughly with √time.", "Price near the edge of the 2σ band = an unusual move for the current regime.",
      "Asymmetry only appears when daily returns show statistically significant skew; otherwise bands are symmetric in log terms.", "1M 1σ of 1.2% from 1.4377 → 1.4206 – 1.4550."],
    A: ["Volatility & options", "Implied vol (from option prices), realised vol (from closes), the gap between them, the model's volatility term structure and 25-delta risk reversal.",
      "Implied vol is the market's price of future movement; realised is what happened. IV above RV = the market pays for protection.", "IV ≫ RV: event risk or fear priced. IV < RV: options cheap vs recent movement.",
      "The desk stores only one options pull (25-delta call/put IV, no history) — so implied vol is shown but cannot be validated and gets 0 weight.", "IV 4.6%, RV20 3.1% → premium +1.5 pts."],
    B: ["Macro fundamentals", "US–Canada 2-year yield spread, Fed vs BoC pricing, WTI, DXY and the next data releases.",
      "Rate differentials and oil are the classic medium-term USD/CAD drivers; DXY captures broad USD moves.", "Spread widening, DXY up, oil down → USD/CAD up — in theory. The accuracy column shows whether it worked out of sample.",
      "Relationships drift: the oil–CAD link weakened over the last decade. Spread history on file is short (~90 sessions).", "2Y spread +10 bp over 10 sessions → rule votes USD/CAD up."],
    C: ["Market positioning", "CFTC Traders in Financial Futures, CAD futures: leveraged-fund net position, its percentile and weekly change.",
      "Extreme positioning raises reversal (squeeze) risk; the rule is contrarian only at |z| ≥ 1.", "Funds very short CAD (low z) → squeeze risk → USD/CAD down.",
      "Weekly data, Tuesday positions published Friday — slow. Asset-manager positioning is not stored on the desk.", "z = −1.6 → crowded CAD short → contrarian vote: USD/CAD down."],
    D: ["Technical structure", "EMA 20/50/100, nearest support / resistance, realised-vol regime, momentum and trend strength (efficiency ratio).",
      "Defines where a move would stall or accelerate and whether the market is trending or ranging.", "Price above a rising EMA50 with efficiency ratio > 0.3 = trending up.",
      "Technical readings don't create probabilities on their own — only the trend and momentum rules are tested out of sample.", "Efficiency 0.45 = the last 20 sessions' net move was 45% of the total path travelled."],
    scen: ["Scenarios", "Probabilities of three outcomes at the horizon from the forecast distribution: above +0.5σ (bullish USD/CAD), within ±0.5σ (neutral), below −0.5σ (bearish). Targets are the 75th / 90th and 25th / 10th percentiles.",
      "Turns the cone into decisions: what happens, how likely, and the price that would tell you which scenario is playing out.", "With zero drift and symmetric shape, bull and bear are ~31% each and neutral ~38%.",
      "Probabilities inherit every model assumption — they are estimates, not odds.", "1M σ 168 pips: bullish above +84 pips."],
    acc: ["Forecast accuracy", "Walk-forward back-test: at each past session the model forecast the h-session range with only the data available then, and we check what happened.",
      "Tells you how far to trust the bands. Coverage near 68% / 95% = honest bands.", "Coverage well below target = bands too narrow (danger). Above = too wide (conservative).",
      "Windows overlap (each 1M window shares 20 of 21 days with the next), so the effective number of independent tests is n ÷ h — shown as 'eff'.", "n = 210, h = 21 → about 10 independent months."],
    daily: ["Daily expected move", "The one-session 1σ move: the model's daily σ (blended σ at the selected horizon ÷ √sessions) and, when an implied vol is available, the option market's: IV ÷ √252.",
      "Sizes intraday stops and tells you whether today's move is ordinary: about two sessions in three stay inside it.", "A move of 2× the daily figure is a roughly 1-in-20 day; 3× is rare outside event days.",
      "Assumes today is a normal session; CPI, jobs and central-bank days typically run 1.5–2× larger.", "IV 5.0% → 5.0 ÷ 15.87 = ±0.315% ≈ ±45 pips at 1.4377."],
    touch: ["Probability of touching a level", "Chance that price trades at the level at any time before the horizon, using the reflection principle: P(touch) ≈ 2 × P(close beyond it at the horizon).",
      "Stops and targets are hit by touches, not closes.", "A level at 1σ has roughly a 32% chance of closing beyond it but ~60%+ of being touched.",
      "Exact for a driftless random walk; approximate with skew or drift.", "P(close above R20) = 18% → P(touch) ≈ 36%."]
  };
  function ib(k) { return '<button type="button" class="fxf-i" data-fxfi="' + k + '" aria-label="About ' + esc((INFO[k] || [k])[0]) + '">i</button>'; }
  function infoHTML(k, now) {
    var I = INFO[k]; if (!I) return "";
    return "<b>" + esc(I[0]) + "</b><p><i>What it measures</i>" + esc(I[1]) + "</p><p><i>Why it matters</i>" + esc(I[2]) + "</p><p><i>Reading it</i>" + esc(I[3]) + "</p>" + (now ? "<p><i>Now</i>" + now + "</p>" : "") + "<p><i>Limitations</i>" + esc(I[4]) + "</p><p><i>Example</i>" + esc(I[5]) + "</p>";
  }
  var NOW = {};

  /* ---------- chart ---------- */
  var VW = 900, VH = 430, X0 = 8, PR = 118, PT = 22, PB = 26;
  /* drawn at the card's real width (1 unit = 1 px) so labels keep their size on narrow columns and phones */
  function sizeTo(w) { VW = Math.max(340, Math.min(1400, Math.round(w || 900))); VH = Math.round(Math.max(300, Math.min(480, VW * 0.5))); PR = VW < 520 ? 96 : 118; }
  function chart(C, Hr, sp, lv, evs) {
    var I = C.I, d = I.dates, c = I.close, h = Hr.h, N = h >= 63 ? 160 : 100, n = c.length, Cs = c.slice(-N), Ds = d.slice(-N), base = n - N;
    var probs = [[0.5 - 0.5 * (2 * Z3 - 1), Z3, "s3"], [1 - Z2, Z2, "s2"], [1 - Z1, Z1, "s1"]];
    var path = []; for (var t = 0; t <= h; t++) path.push(t === 0 ? null : { s1: [E.q(Hr, sp.px, 1 - Z1, t), E.q(Hr, sp.px, Z1, t)], s2: [E.q(Hr, sp.px, 1 - Z2, t), E.q(Hr, sp.px, Z2, t)], s3: [E.q(Hr, sp.px, 1 - Z3, t), E.q(Hr, sp.px, Z3, t)], m: E.q(Hr, sp.px, 0.5, t) });
    var top = ST.s3 ? "s3" : "s2", vals = Cs.concat([sp.px, path[h][top][0], path[h][top][1]]);
    var e20 = emaArr(c, 20), e50 = emaArr(c, 50), e100 = emaArr(c, 100);
    if (ST.ema) [e20, e50, e100].forEach(function (A) { for (var i = base; i < n; i++) if (A[i] != null) vals.push(A[i]); });
    if (ST.lv) lv.forEach(function (x) { vals.push(x[1]); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var X1 = VW - PR, XS = X0 + (VW < 520 ? 0.5 : 0.64) * (X1 - X0), xs = function (i) { return i <= N - 1 ? X0 + i / (N - 1) * (XS - X0) : XS + (i - N + 1) / h * (X1 - XS); }, ys = function (v) { return PT + (hi - v) / (hi - lo) * (VH - PT - PB); };
    var s = "", xa = xs(N - 1), ya = ys(sp.px);
    for (var g = 0; g <= 6; g++) { var gv = hi - (hi - lo) * g / 6, gy = ys(gv); s += '<line x1="' + X0 + '" x2="' + X1 + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="fxf-g"/>' + (g > 0 && g < 6 ? '<text x="' + (X0 + 2) + '" y="' + (gy - 3).toFixed(1) + '" class="fxf-ax fxf-yl">' + gv.toFixed(4) + "</text>" : ""); }
    for (var vx = 0; vx < N - 10; vx += Math.ceil(N / (VW < 420 ? 2 : VW < 520 ? 3 : 4))) s += '<text x="' + xs(vx).toFixed(1) + '" y="' + (VH - 8) + '" class="fxf-ax" text-anchor="' + (vx ? "middle" : "start") + '">' + md(Ds[vx]) + "</text>";
    var endD = addBiz(d[n - 1], h);
    s += '<line x1="' + xa.toFixed(1) + '" x2="' + xa.toFixed(1) + '" y1="' + PT + '" y2="' + (VH - PB) + '" class="fxf-now"/><text x="' + (xa + 4).toFixed(1) + '" y="' + (VH - PB - 5) + '" class="fxf-ax2">forecast →</text>';
    s += '<text x="' + xs(N - 1 + h).toFixed(1) + '" y="' + (VH - 8) + '" class="fxf-ax" text-anchor="end">' + md(endD) + " (" + ST.hz + ")</text>";
    /* event markers: numbered, legend below the chart */
    /* one numbered marker per day (several releases on a day share it); numbers match the list under the chart */
    if (ST.ev) { var byD = {}; evs.forEach(function (e, i) { (byD[e.date] = byD[e.date] || []).push([i + 1, e]); });
      Object.keys(byD).forEach(function (dd) { var bd = bizBetween(d[n - 1], dd); if (bd < 1 || bd > h) return; var x = xs(N - 1 + bd - 0.5).toFixed(1), L = byD[dd], lab = L.length > 1 ? L[0][0] + "–" + L[L.length - 1][0] : String(L[0][0]), rw = 8 + lab.length * 6;
        s += '<line x1="' + x + '" x2="' + x + '" y1="' + (PT + 14) + '" y2="' + (VH - PB) + '" class="fxf-ev"/><g class="fxf-evm"><rect x="' + (x - rw / 2).toFixed(1) + '" y="' + PT + '" width="' + rw + '" height="14" rx="7"/><text x="' + x + '" y="' + (PT + 10.5) + '" text-anchor="middle">' + lab + "</text><title>" + esc(L.map(function (q) { return md(q[1].date) + " " + (q[1].time || "") + " · " + q[1].ccy + " " + q[1].ev; }).join("\n")) + "</title></g>"; }); }
    function band(k) { var up = [], dn = []; for (var t = 0; t <= h; t++) { var x = xs(N - 1 + t).toFixed(1); up.push(x + "," + ys(t ? path[t][k][1] : sp.px).toFixed(1)); dn.push(x + "," + ys(t ? path[t][k][0] : sp.px).toFixed(1)); } return "M" + up.join("L") + "L" + dn.reverse().join("L") + "Z"; }
    if (ST.s3) s += '<path class="fxf-b3" d="' + band("s3") + '"/>';
    s += '<path class="fxf-b2" d="' + band("s2") + '"/><path class="fxf-b1" d="' + band("s1") + '"/>';
    var mp = []; for (var t2 = 0; t2 <= h; t2++) mp.push(xs(N - 1 + t2).toFixed(1) + "," + ys(t2 ? path[t2].m : sp.px).toFixed(1)); s += '<polyline class="fxf-med" points="' + mp.join(" ") + '"/>';
    /* levels */
    if (ST.lv) lv.forEach(function (x) { var y = ys(x[1]); if (y < PT || y > VH - PB) return; s += '<line x1="' + X0 + '" x2="' + X1 + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="fxf-lvl ' + (x[2] === "COT" ? "cot" : x[1] > sp.px ? "r" : "s") + '"/>'; });
    if (ST.ema) [[e20, "e20"], [e50, "e50"], [e100, "e100"]].forEach(function (q) { var p = []; for (var i = 0; i < N; i++) if (q[0][base + i] != null) p.push(xs(i).toFixed(1) + "," + ys(q[0][base + i]).toFixed(1)); if (p.length > 1) s += '<polyline class="fxf-ma ' + q[1] + '" points="' + p.join(" ") + '"/>'; });
    s += '<polyline class="fxf-px" points="' + Cs.map(function (v, i) { return xs(i).toFixed(1) + "," + ys(v).toFixed(1); }).join(" ") + " " + xa.toFixed(1) + "," + ya.toFixed(1) + '"/>';
    s += '<line x1="' + xa.toFixed(1) + '" x2="' + X1 + '" y1="' + ya.toFixed(1) + '" y2="' + ya.toFixed(1) + '" class="fxf-spl"/><circle cx="' + xa.toFixed(1) + '" cy="' + ya.toFixed(1) + '" r="4.5" class="fxf-dot"/>';
    /* right-edge labels, stacked 14px apart so none overlap (UI protocol: nothing cut, no overlaps) */
    var TG = [["Spot", sp.px, "spot"], ["Median", path[h].m, "med"], ["+1σ", path[h].s1[1], "b1"], ["−1σ", path[h].s1[0], "b1"], ["+2σ", path[h].s2[1], "b2"], ["−2σ", path[h].s2[0], "b2"]];
    if (ST.s3) TG.push(["+3σ", path[h].s3[1], "b3"], ["−3σ", path[h].s3[0], "b3"]);
    if (ST.lv) lv.forEach(function (x) { TG.push([x[2], x[1], x[2] === "COT" ? "cot" : "lv"]); });
    if (ST.ema) [[e20, "EMA20", "e20"], [e50, "EMA50", "e50"], [e100, "EMA100", "e100"]].forEach(function (q) { if (q[0][n - 1] != null) TG.push([q[1], q[0][n - 1], q[2]]); });
    TG = TG.map(function (q) { return { t: q[0] + " " + q[1].toFixed(4), c: q[2], y0: ys(q[1]) }; }).filter(function (g) { return g.y0 >= PT - 4 && g.y0 <= VH - PB + 4; }).sort(function (a, b) { return a.y0 - b.y0; });
    TG.forEach(function (g2, i) { g2.y = Math.max(g2.y0, i ? TG[i - 1].y + 14 : PT + 6); });
    for (var ti = TG.length - 1; ti >= 0; ti--) { var lim = ti < TG.length - 1 ? TG[ti + 1].y - 14 : VH - PB - 4; if (TG[ti].y > lim) TG[ti].y = lim; }
    TG.forEach(function (g3) { s += '<g class="fxf-tg ' + g3.c + '"><line x1="' + X1 + '" x2="' + (X1 + 6) + '" y1="' + g3.y0.toFixed(1) + '" y2="' + g3.y.toFixed(1) + '"/><text x="' + (X1 + 8) + '" y="' + (g3.y + 3.5).toFixed(1) + '">' + esc(g3.t) + "</text></g>"; });
    return '<svg class="fxf-svg" viewBox="0 0 ' + VW + " " + VH + '" role="img" aria-label="USD/CAD forecast cone, ' + ST.hz + '">' + s + "</svg>";
  }

  /* ---------- dashboard ---------- */
  var BIAS = { bull: ["Bullish USD/CAD", "up"], bear: ["Bearish USD/CAD", "dn"], neutral: ["Neutral", ""] };
  function card(k, label, val, sub, extra) { return '<div class="fxf-card' + (extra ? " " + extra : "") + '"><div class="fxf-cl">' + esc(label) + ib(k) + '</div><div class="fxf-cv">' + val + '</div><div class="fxf-cs">' + sub + "</div></div>"; }
  function dash(C, sp) {
    var R = C.res, Hr = R.horizons[ST.hz], h = Hr.h, sd = Hr.sd, lv = levels(), evs = evList(h, R.last), F = root.DATA.fx;
    var q16 = E.q(Hr, sp.px, 1 - Z1), q84 = E.q(Hr, sp.px, Z1), up = q84 - sp.px, dn = sp.px - q16, B = BIAS[Hr.bias];
    var passed = E.DRIVERS.filter(function (D) { return Hr.drivers[D.id].pass; });
    var cat = evs[0], fed = ((F.policy || {}).fed || [])[0];
    NOW.move = "±" + pips((up + dn) / 2) + " pips (" + (sd * 100).toFixed(2) + "%) over " + ST.hz + " — up " + pips(up) + " / down " + pips(dn) + ".";
    NOW.bias = passed.length ? passed.length + " rule(s) passed at " + ST.hz + ": " + passed.map(function (D) { return D.name; }).join("; ") + "." : "No rule passed the out-of-sample test at " + ST.hz + ", so no direction is claimed.";
    NOW.regime = "RV20 " + pc(R.rv20, 2) + ", " + (R.rvPct == null ? "—" : Math.round(R.rvPct * 100) + "th") + " percentile of the last 250 sessions → " + R.regime + ".";
    NOW.conf = Hr.bt.n ? "1σ covered " + pc(Hr.bt.cov1) + " (target 68%), 2σ " + pc(Hr.bt.cov2) + " (target 95%), n " + Hr.bt.n + ", effective " + Math.round(Hr.bt.neff) + "." + (Hr.bt.cov1 < 0.6 ? " The bands have been too narrow at this horizon — in the back-test the 1σ range held the outcome only " + pc(Hr.bt.cov1) + " of the time, so read it as a ~" + Math.round(Hr.bt.cov1 * 20) * 5 + "% range, not 68%." : Hr.bt.cov1 > 0.76 ? " The bands have been wider than needed at this horizon (conservative)." : "") : "No back-test sample yet.";
    var IV = ivNow(), d1 = Hr.sd / Math.sqrt(h), dm = { pct: d1 * 100, pips: sp.px * d1 * 1e4 }, im1 = IV ? E.ivMove(IV.atm, sp.px, 1) : null, imH = IV ? E.ivMove(IV.atm, sp.px, h) : null;
    NOW.daily = "Model: ±" + dm.pct.toFixed(3) + "% (±" + Math.round(dm.pips) + " pips) for one session, from the blended σ at " + ST.hz + "." + (IV ? " Implied: " + IV.atm.toFixed(2) + "% ÷ √252 = ±" + im1.pct.toFixed(3) + "% (±" + Math.round(im1.pips) + " pips)" + (IV.fresh ? "." : " — but that vol is " + Math.round(IV.age) + " days old.") : " No implied vol on file — enter one from CVOL, Barchart or IBKR in pillar A.");
    var head = '<div class="fxf-cards">' +
      card("daily", "Daily expected move", "±" + dm.pct.toFixed(2) + "<small>%</small>", "≈ ±" + Math.round(dm.pips) + " pips · today " + f4(sp.px * Math.exp(-d1)) + " – " + f4(sp.px * Math.exp(d1)) + (IV ? '<br><span class="' + (IV.fresh ? "" : "fxf-dim") + '">implied ±' + im1.pct.toFixed(2) + "% (" + IV.atm.toFixed(2) + "% vol" + (IV.fresh ? "" : ", " + Math.round(IV.age) + "d old") + ")</span>" : "<br>implied: not on file")) +
      card("move", "Expected move · " + ST.hz, "±" + pips((up + dn) / 2) + " <small>pips</small>", "±" + (sd * 100).toFixed(2) + "% · 1σ range " + f4(q16) + " – " + f4(q84) + (Math.abs(up - dn) * 1e4 >= 3 ? " · skewed: +" + pips(up) + " / −" + pips(dn) : " · symmetric") + (IV && IV.fresh ? "<br>market-implied ±" + Math.round(imH.pips) + " pips (" + imH.pct.toFixed(2) + "%)" : "")) +
      card("bias", "Directional bias · " + ST.hz, '<span class="' + B[1] + '">' + B[0] + "</span>", passed.length ? "P(higher at " + ST.hz + ") " + pc(E.pAbove(Hr, sp.px, sp.px)) + " · " + passed.length + " of 6 rules validated" + (Hr.compHit && Hr.compHit.hit != null ? " · composite hit " + pc(Hr.compHit.hit) + " (eff n " + Math.round(Hr.compHit.neff) + ")" : "") : "No rule passed out of sample at " + ST.hz + " · magnitude ≠ direction") +
      card("regime", "Volatility regime", '<span class="fxf-rg ' + R.regime + '">' + R.regime.toUpperCase() + "</span>", "RV20 " + pc(R.rv20, 2) + " · " + (R.rvPct == null ? "—" : Math.round(R.rvPct * 100) + "th pct") + " of 250 sessions") +
      card("conf", "Forecast confidence", '<span class="fxf-cf ' + Hr.conf + '">' + Hr.conf.toUpperCase() + "</span>", "calibration at " + ST.hz + ": 1σ " + pc(Hr.bt.cov1) + " / 2σ " + pc(Hr.bt.cov2) + " · eff n " + Math.round(Hr.bt.neff || 0)) +
      card("cat", "Key catalyst", cat ? '<span class="fxf-cvs">' + esc(cat.ccy + " " + cat.ev) + "</span>" : "None scheduled", cat ? esc(md(cat.date) + " " + (cat.time || "") + " ET") + " · " + evs.length + " high-impact in window" + (function () { var L = ((root.DATA.fx || {}).events || []).map(function (e) { return e.date; }).sort().pop(); return L && L < addBiz(C.res.last, h) ? " (calendar on file runs to " + md(L) + ")" : ""; })() + (fed ? " · Fed " + md(fed.meeting) : "") : "no high-impact release in the " + ST.hz + " window") + "</div>";
    var ctl = '<div class="fxf-bar"><div class="seg fxf-seg" role="group" aria-label="Forecast horizon">' + HK.map(function (k) { return '<button type="button" data-fxfh="' + k + '" aria-pressed="' + (ST.hz === k) + '">' + k + "</button>"; }).join("") + "</div>" +
      '<div class="seg fxf-seg" role="group" aria-label="Chart layers">' + [["ema", "EMA 20/50/100"], ["lv", "Key levels"], ["ev", "Events"], ["s3", "3σ extreme"]].map(function (x) { return '<button type="button" data-fxfl="' + x[0] + '" aria-pressed="' + !!ST[x[0]] + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<span class="fxf-spot">Spot <b data-fxfpx>' + sp.px.toFixed(5) + "</b> · " + esc(sp.ts ? TS.format(new Date(sp.ts)) + " ET" : "—") + " · " + esc(sp.src) + "</span></div>";
    var evL = evs.length && ST.ev ? '<ol class="fxf-evl">' + evs.map(function (e) { return "<li><b>" + esc(md(e.date)) + "</b> " + esc(e.time || "") + " · " + esc(e.ccy) + " " + esc(e.ev) + (e.fc ? " · fcst " + esc(e.fc) : "") + (e.prev ? " · prev " + esc(e.prev) : "") + "</li>"; }).join("") + "</ol>" : "";
    var chartBox = '<div class="fxf-chart"><div class="fxf-ct">Forecast cone ' + ib("cone") + '<span>bands = 1σ / 2σ' + (ST.s3 ? " / 3σ" : "") + " percentiles of the blended distribution · dashed = median · " + (Hr.sk ? "asymmetric (significant skew)" : "symmetric (skew not significant)") + "</span></div>" + chart(C, Hr, sp, lv, evs) + evL + "</div>";
    return head + ctl + chartBox + pillars(C, Hr, sp) + scen(C, Hr, sp, lv) + acc(C, Hr) + method(C, Hr);
  }
  /* percentile table + scenarios + level touches + invalidation */
  function scen(C, Hr, sp, lv) {
    var P = [0.05, 0.10, 0.25, 0.5, 0.75, 0.90, 0.95], h = Hr.h;
    var pt = '<table class="fxf-t"><thead><tr><th>Percentile</th>' + P.map(function (p) { return "<th>" + Math.round(p * 100) + "th</th>"; }).join("") + "</tr></thead><tbody><tr><td>Price</td>" + P.map(function (p) { return "<td>" + f4(E.q(Hr, sp.px, p)) + "</td>"; }).join("") + "</tr><tr><td>vs spot</td>" + P.map(function (p) { var x = E.q(Hr, sp.px, p) - sp.px; return '<td class="' + cls(x) + '">' + sg(x * 1e4, 0) + "</td>"; }).join("") + "</tr></tbody></table>";
    /* the ±0.5σ cut-offs come from the symmetric σ so they do not move with skew; probabilities come from the full distribution */
    var b = sp.px * Math.exp(0.5 * Hr.sd), a = sp.px * Math.exp(-0.5 * Hr.sd), pBull = E.pAbove(Hr, sp.px, b), pBear = 1 - E.pAbove(Hr, sp.px, a);
    var sc = '<div class="fxf-sc">' +
      '<div class="up"><b>Bullish USD/CAD · ' + pc(pBull) + '</b><span>close above ' + f4(b) + "</span><span>targets " + f4(E.q(Hr, sp.px, 0.75)) + " (75th) · " + f4(E.q(Hr, sp.px, 0.9)) + " (90th)</span><span>would need: wider US–CA spread, firmer DXY, weaker oil</span></div>" +
      '<div><b>Neutral · ' + pc(1 - pBull - pBear) + "</b><span>" + f4(a) + " – " + f4(b) + "</span><span>median " + f4(E.q(Hr, sp.px, 0.5)) + "</span><span>range trade inside ±0.5σ</span></div>" +
      '<div class="dn"><b>Bearish USD/CAD · ' + pc(pBear) + "</b><span>close below " + f4(a) + "</span><span>targets " + f4(E.q(Hr, sp.px, 0.25)) + " (25th) · " + f4(E.q(Hr, sp.px, 0.1)) + " (10th)</span><span>would need: narrower spread, softer DXY, firmer oil</span></div></div>";
    var lt = lv.filter(function (x) { return x[1] > E.q(Hr, sp.px, 1 - Z3) && x[1] < E.q(Hr, sp.px, Z3); }).map(function (x) { var pE = x[1] >= sp.px ? E.pAbove(Hr, sp.px, x[1]) : 1 - E.pAbove(Hr, sp.px, x[1]);
      return "<tr><td>" + esc(x[0]) + "</td><td>" + f4(x[1]) + '</td><td class="' + cls(x[1] - sp.px) + '">' + sg((x[1] - sp.px) * 1e4, 0) + "</td><td>" + pc(pE) + "</td><td><b>" + pc(E.pTouch(Hr, sp.px, x[1])) + "</b></td></tr>"; }).join("");
    var q5 = E.q(Hr, sp.px, Z2, Math.min(5, h)), q5d = E.q(Hr, sp.px, 1 - Z2, Math.min(5, h)), F = root.DATA.fx, ysm = ((F.ysm || {}).hist || []), spd = ysm.map(function (x) { return (x.us["2Y"] - x.ca["2Y"]) * 100; }), dsp = [];
    for (var i = 10; i < spd.length; i++) dsp.push(spd[i] - spd[i - 10]); var sdS = dsp.length > 10 ? Math.sqrt(variance(dsp)) : null;
    var inv = "<ul class=\"fxf-inv\"><li><b>Volatility forecast wrong</b> if USD/CAD closes above <b>" + f4(q5) + "</b> or below <b>" + f4(q5d) + "</b> within " + Math.min(5, h) + " sessions (outside the 2σ path) — re-rate the regime upward.</li>" +
      "<li><b>Calm forecast wrong</b> if 5-session realised vol runs above " + (Hr.sd / Math.sqrt(h) * Math.sqrt(252) * 1.5 * 100).toFixed(1) + "% annualised (1.5× the model's daily σ).</li>" +
      (sdS ? "<li><b>Macro shock</b> if the US–CA 2Y spread moves more than " + (2 * sdS).toFixed(0) + " bp in 10 sessions (2× its usual 10-session swing of " + sdS.toFixed(0) + " bp).</li>" : "") +
      (Hr.bias !== "neutral" ? "<li><b>Bias wrong</b> if price closes on the other side of EMA50 or the validated driver flips sign.</li>" : "<li><b>Neutral stance wrong</b> if a direction rule passes validation at this horizon on the next refresh, or price closes outside the 1σ band in the first half of the horizon.</li>") + "</ul>";
    return '<details class="fxf-sec" open><summary>Scenario analysis ' + ib("scen") + "<span>" + ST.hz + " · percentiles, scenarios, level probabilities, invalidation</span></summary>" + pt + sc +
      (lt ? '<div class="fxf-st">Probability of reaching key levels by ' + md(addBiz(C.res.last, h)) + " " + ib("touch") + '</div><table class="fxf-t"><thead><tr><th>Level</th><th>Price</th><th>Pips</th><th>Close beyond</th><th>Touch</th></tr></thead><tbody>' + lt + "</tbody></table>" : "") +
      '<div class="fxf-st">What would prove this forecast wrong</div>' + inv + "</details>";
  }
  function sigTxt(s) { return s > 0 ? '<span class="up">USD/CAD ↑</span>' : s < 0 ? '<span class="dn">USD/CAD ↓</span>' : '<span class="neu">neutral</span>'; }
  function drow(Hr, R, id, reading) {
    var D = E.DRIVERS.filter(function (x) { return x.id === id; })[0], sc = Hr.drivers[id];
    return "<tr><td>" + esc(D.name) + "</td><td>" + reading + "</td><td>" + sigTxt(Hr.nowSig[id]) + "</td><td>" + (sc.n ? pc(sc.hit) + " <small>n " + sc.n + " · eff " + Math.round(sc.neff) + "</small>" : "<small>no history</small>") + '</td><td class="' + (sc.pass ? "up" : "neu") + '">' + (sc.pass ? "votes" : sc.neff < 15 ? "too little data" : "not significant") + "</td></tr>";
  }
  function pillars(C, Hr, sp) {
    var R = C.res, F = root.DATA.fx, dv = R.drv, n = C.I.close.length - 1, kp = (F.pos || {}).kpi || {}, pos = F.pos || {}, pol = F.policy || {}, c = C.I.close;
    var e20 = emaArr(c, 20)[n], e50 = emaArr(c, 50)[n], e100 = emaArr(c, 100)[n], er = (function () { var net = Math.abs(c[n] - c[n - 20]), p = 0; for (var i = n - 19; i <= n; i++) p += Math.abs(c[i] - c[i - 1]); return p ? net / p : null; })();
    var th = '<table class="fxf-t fxf-dt"><thead><tr><th>Rule</th><th>Now</th><th>Signal</th><th>OOS hit · ' + ST.hz + "</th><th>Status</th></tr></thead><tbody>";
    var IV = ivNow(), ivStale = IV && !IV.fresh, gl = R.garch, ivAsof = IV ? new Date(IV.t).toISOString().slice(0, 10) : null;
    var tsr = [5, 21, 63].map(function (h) { var H2 = R.horizons[h === 5 ? "1W" : h === 21 ? "1M" : "3M"]; return (H2.sd / Math.sqrt(h) * Math.sqrt(252) * 100).toFixed(2) + "%"; });
    var A = '<div class="fxf-kvs">' + kv("Implied vol" + (IV ? " <small>" + esc(IV.src) + "</small>" : ""), IV ? IV.atm.toFixed(2) + "%" + (ivStale ? ' <span class="fxf-stale">stale · ' + esc(mdy(ivAsof)) + "</span>" : ' <small>' + esc(md(ivAsof)) + "</small>") : "not on file") +
      kv("Daily expected move (implied)", IV ? "±" + E.ivMove(IV.atm, sp.px, 1).pct.toFixed(3) + "% · ±" + Math.round(E.ivMove(IV.atm, sp.px, 1).pips) + " pips" : "—") +
      kv("Realised vol 20D / 60D", pc(R.rv20, 2) + " / " + pc(R.rv60, 2)) +
      kv("IV − RV20 premium", IV ? '<span class="' + cls(IV.atm - R.rv20 * 100) + '">' + sg(IV.atm - R.rv20 * 100, 2, " pts") + "</span>" + (ivStale ? " <small>(IV dated)</small>" : "") : "—") +
      kv("Model term structure 1W / 1M / 3M", tsr.join(" / ") + " <small>" + (parseFloat(tsr[2]) > parseFloat(tsr[0]) ? "upward" : "downward") + "</small>") +
      kv("GARCH long-run vol", pc(R.garchLR, 2) + " <small>α " + gl.a + " β " + gl.b + "</small>") +
      kv("25Δ risk reversal <small>USD/CAD terms</small>", IV && IV.rr != null ? sg(IV.rr, 2, "%") + (ivStale ? ' <span class="fxf-stale">stale</span>' : "") : "not on file") +
      kv("25Δ butterfly", IV && IV.bf != null ? sg(IV.bf, 2, "%") : "not on file") +
      (IV && IV.term ? kv("Implied term structure", esc(IV.term.map(function (x) { return x.tenor + " " + (+x.atm).toFixed(2) + "%"; }).join(" · "))) : "") +
      kv("Blend weights · " + ST.hz, "EWMA " + pc(Hr.w.ewma) + " · GARCH " + pc(Hr.w.garch) + " · Hist sim " + pc(Hr.w.hs) + " · Implied 0%") + "</div>" +
      '<form class="fxf-ivf" data-fxfiv><span>Fresh implied vol</span><input name="v" type="number" step="0.01" min="0.5" max="40" placeholder="e.g. 5.10" aria-label="Implied vol, % annualised"><select name="src" aria-label="Source">' +
        ["CME CVOL (CAVL)", "Barchart 6C ATM", "Investing.com 1M ATM", "IBKR 6C ATM", "IVolatility", "Other"].map(function (x) { return "<option>" + x + "</option>"; }).join("") + '</select><button type="submit">Use</button>' +
        (ivMan() ? '<button type="button" data-fxfivx>Clear mine</button>' : "") + "<small>kept in this browser for 3 days; the desk's stored pull wins when newer · sources below the pillars</small></form>";
    var sp2 = C.I.spread.length ? C.I.spread[C.I.spread.length - 1] : null;
    var B = '<div class="fxf-kvs">' + kv("US–CA 2Y spread", sp2 ? sp2[1].toFixed(0) + " bp <small>" + md(sp2[0]) + "</small>" : "—") +
      kv("Fed next meeting", pol.fed && pol.fed[0] ? md(pol.fed[0].meeting) + " · " + esc((pol.fed[0].ranges || []).map(function (r) { return r.label + " " + r.prob_pct + "%"; }).join(", ")) : "—") +
      kv("BoC path (CORRA futures)", pol.corra ? "now " + esc(pol.corra_now) + "% → " + esc(pol.corra.slice(0, 3).map(function (x) { return x.month.slice(2).replace("-", "/") + " " + x.implied_rate_pct.toFixed(2); }).join(" · ")) : "—") +
      kv("WTI / DXY", f2last(C.I.wti) + " / " + f2last(C.I.dxy)) + kv("Next US / CA releases", esc(evList(63, R.last).slice(0, 3).map(function (e) { return md(e.date) + " " + e.ccy + " " + e.ev; }).join(" · ") || "none listed")) + "</div>" +
      th + drow(Hr, R, "spread", fmtv(dv.spread.val[n], 1, " bp")) + drow(Hr, R, "wti", fmtv(dv.wti.val[n], 2, "%")) + drow(Hr, R, "dxy", fmtv(dv.dxy.val[n], 2, "%")) + "</tbody></table>";
    var Cc = '<div class="fxf-kvs">' + kv("Leveraged funds net (CAD)", (pos.net != null ? sg(pos.net, 0).replace(/(\d)(?=(\d{3})+$)/g, "$1,") : "—") + " <small>" + esc(md(kp.date)) + "</small>") + kv("% of open interest", pos.pct_oi != null ? sg(pos.pct_oi, 1, "%") : "—") +
      kv("Percentile 1Y / 3Y", (pos.p1y != null ? pos.p1y + "th" : "—") + " / " + (pos.p3y != null ? pos.p3y + "th" : "—")) + kv("z-score (52W)", kp.z52 != null ? sg(kp.z52, 2) : "—") + kv("Weekly change", pos.wow != null ? sg(pos.wow, 0) + " contracts" : "—") +
      kv("Asset managers", '<span class="neu">not stored on the desk</span>') + "</div>" + th + drow(Hr, R, "cot", fmtv(dv.cot.val[n], 2, "")) + "</tbody></table>";
    var Dd = '<div class="fxf-kvs">' + kv("EMA20 / 50 / 100", f4(e20) + " / " + f4(e50) + " / " + f4(e100)) + kv("Stack", e20 > e50 && e50 > e100 ? '<span class="up">bullish (20 > 50 > 100)</span>' : e20 < e50 && e50 < e100 ? '<span class="dn">bearish (20 < 50 < 100)</span>' : '<span class="neu">mixed</span>') +
      kv("Support / resistance", levels().map(function (x) { return x[2] + " " + f4(x[1]); }).join(" · ")) + kv("Vol regime", R.regime + " (" + (R.rvPct == null ? "—" : Math.round(R.rvPct * 100) + "th pct") + ")") +
      kv("Trend strength (efficiency 20D)", er == null ? "—" : er.toFixed(2) + " <small>" + (er > 0.3 ? "trending" : "ranging") + "</small>") + "</div>" + th + drow(Hr, R, "trend", fmtv(dv.trend.val[n], 2, "σ")) + drow(Hr, R, "mom", fmtv(dv.mom.val[n], 2, "%")) + "</tbody></table>";
    function pil(k, t, sub, body, open) { return '<details class="fxf-pil"' + (open ? " open" : "") + "><summary><b>" + k + "</b> " + t + " " + ib(k) + "<span>" + sub + "</span></summary>" + body + "</details>"; }
    return '<div class="fxf-st2">Forecast drivers · four pillars</div><div class="fxf-pils">' +
      pil("A", "Volatility & options", "sizes the cone" + (ivStale ? " · implied data dated " + md(R.ivAsof) : ""), A, true) + pil("B", "Macro fundamentals", "spread · oil · USD · central banks", B, true) +
      pil("C", "Market positioning", "CFTC TFF leveraged funds", Cc, false) + pil("D", "Technical structure", "trend · levels · regime", Dd, false) + "</div>" +
      '<details class="fxf-sec"><summary>Implied-vol sources &amp; mapping<span>where to get USD/CAD implied vol, latency and cost, and how CME 6C quotes convert to USD/CAD</span></summary>' + srcTable() + "</details>";
  }
  function srcTable() {
    var S = [["CME CVOL (CAVL)", "30-day implied-vol index on CAD/USD options", "End of day free; intraday paid", "cmegroup.com · DataMine", "Free view", "Use directly as ATM vol — vol of CAD/USD = vol of USD/CAD"],
      ["Barchart", "6C option chain: strike-by-strike IV and Greeks", "10–15 min delayed", "Web tables (CSV on paid tiers)", "Free", "6C strike K = USD/CAD 1/K · 6C call = USD/CAD put · flip the RR sign"],
      ["Investing.com", "USD/CAD options chain, IV, deltas", "Delayed / streaming widget", "Web", "Free", "Already in USD/CAD terms"],
      ["Interactive Brokers", "Live 6C futures-option IV in TWS; reqHistoricalData with OPTION_IMPLIED_VOLATILITY", "Live with CME data subscription", "TWS & API", "Low monthly exchange fee", "Same as Barchart (6C). The desk's read-only connector could not resolve the CAD futures underlying, so it is not automated yet"],
      ["CME Greeks & IV API", "Greeks and IV snapshots", "Every 5 min", "REST / streaming", "Commercial", "6C → invert as above"],
      ["IVolatility", "Futures-option chains, vol surfaces, API", "15-min delayed or live", "Web & API", "Paid", "6C → invert as above"]];
    return '<table class="fxf-t fxf-src"><thead><tr><th>Provider</th><th>What you get</th><th>Latency</th><th>Access</th><th>Cost</th><th>Mapping to USD/CAD</th></tr></thead><tbody>' + S.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>" +
      '<p class="fxf-note">Daily expected move = IV ÷ √252 (e.g. 5.0% → ±0.315%, ≈ ±45 pips at 1.4377). h-session move = IV × √(h/252). FX options trade over the counter; listed 6C options on CME are the public proxy. USD/CAD 25Δ RR = 6C 25Δ put vol − 6C 25Δ call vol.</p>';
  }
  function kv(a, b) { return '<div class="fxf-kv"><span>' + a + "</span><b>" + b + "</b></div>"; }
  function f2last(S) { return S && S.length ? (+S[S.length - 1][1]).toFixed(2) + " <small>" + md(S[S.length - 1][0]) + "</small>" : "—"; }
  function fmtv(x, dp, u) { return x == null ? "—" : sg(x, dp, u); }
  function acc(C, Hr) {
    var R = C.res, rowS = function (lab, S) { return "<tr><td>" + lab + "</td><td>" + (S.n ? pc(S.cov1) : "—") + "</td><td>" + (S.n ? pc(S.cov2) : "—") + "</td><td>" + (S.n ? pips(S.mae * 1.4) + " / " + pips(S.zeroMae * 1.4) : "—") + "</td><td>" + (S.n || 0) + " <small>eff " + Math.round(S.neff || 0) + "</small></td></tr>"; };
    var P = Hr.prev, prev = P ? '<div class="fxf-prev"><b>Last scored forecast · ' + ST.hz + "</b> made " + esc(mdy(P.d)) + " at " + f4(P.px) + ": 1σ " + f4(P.px * Math.exp(P.sd * cf(-1, Hr.sk, Hr.ku))) + " – " + f4(P.px * Math.exp(P.sd * cf(1, Hr.sk, Hr.ku))) +
      " · actual " + esc(md(P.endD)) + " <b>" + f4(P.endPx) + '</b> <span class="' + (P.in1 ? "up" : P.in2 ? "neu" : "dn") + '">' + (P.in1 ? "inside 1σ" : P.in2 ? "inside 2σ" : "outside 2σ") + "</span> · error " + Math.abs(pips(P.endPx - P.px)) + " pips</div>" : "";
    var hz = '<table class="fxf-t"><thead><tr><th>Horizon</th><th>1σ cov <small>68%</small></th><th>2σ cov <small>95%</small></th><th>MAE model / no-change (pips)</th><th>n</th><th>Direction hit</th></tr></thead><tbody>' + HK.map(function (k) { var X = R.horizons[k], S = X.bt;
      return "<tr" + (k === ST.hz ? ' class="on"' : "") + "><td>" + k + "</td><td>" + pc(S.cov1) + "</td><td>" + pc(S.cov2) + "</td><td>" + pips(S.mae * 1.4) + " / " + pips(S.zeroMae * 1.4) + "</td><td>" + S.n + " <small>eff " + Math.round(S.neff) + "</small></td><td>" + (X.compHit && X.compHit.hit != null ? pc(X.compHit.hit) + " <small>eff " + Math.round(X.compHit.neff) + "</small>" : '<span class="neu">no validated rule</span>') + "</td></tr>"; }).join("") + "</tbody></table>";
    var rw = '<table class="fxf-t"><thead><tr><th>' + ST.hz + ' window</th><th>1σ cov</th><th>2σ cov</th><th>MAE model / no-change</th><th>n</th></tr></thead><tbody>' + rowS("Last 30 origins", Hr.win[30]) + rowS("Last 60 origins", Hr.win[60]) + rowS("Last 90 origins", Hr.win[90]) + rowS("All", Hr.bt) +
      rowS("Low-vol regime", Hr.reg.low) + rowS("Normal regime", Hr.reg.normal) + rowS("High-vol regime", Hr.reg.high) + "</tbody></table>";
    return '<details class="fxf-sec"><summary>Forecast accuracy ' + ib("acc") + "<span>walk-forward back-test · coverage, error, direction · sample sizes shown</span></summary>" + prev + hz + rw +
      '<p class="fxf-note">MAE is the median forecast\'s absolute error in pips at ~1.40 (≈ bps × 1.4); the no-change benchmark is |actual move|. With zero drift the two match — the model\'s job is the width of the range, scored by coverage. Regimes: realised-vol percentile at the origin (&lt; 33rd low, &gt; 67th high).</p></details>';
  }
  function method(C, Hr) {
    var R = C.res, SH = R.shape, I = C.I;
    return '<details class="fxf-sec"><summary>Model, sources &amp; unavailable data<span>assumptions in full</span></summary><ul class="fxf-inv">' +
      "<li><b>Price history:</b> Bank of Canada daily USD/CAD, " + I.dates.length + " sessions " + esc(mdy(I.dates[0])) + " – " + esc(mdy(R.last)) + "; live anchor from the desk's freshest USD/CAD print.</li>" +
      "<li><b>Statistical σ:</b> EWMA λ 0.94; GARCH(1,1) α " + R.garch.a + ", β " + R.garch.b + " (fitted on the first 150 sessions for the back-test, refitted on all for today); historical simulation over the trailing 250 sessions. Weights ∝ 1 / MSE of each model's variance forecast on the trailing 250 completed origins (" + Hr.wn + " used at " + ST.hz + ").</li>" +
      "<li><b>Shape:</b> skew " + SH.skew.toFixed(2) + " (±" + (2 * SH.seS).toFixed(2) + " for significance) → " + (SH.useS ? "applied" : "not significant, not applied") + "; excess kurtosis " + SH.kurt.toFixed(2) + " (±" + (2 * SH.seK).toFixed(2) + ") → " + (SH.useK ? "applied (fatter tails)" : "not applied") + ". Cornish–Fisher, scaled to the horizon.</li>" +
      "<li><b>Direction:</b> six rules fixed from theory, scored out of sample on every origin; a rule votes only if its hit rate beats 50% at one-sided 95% on n ÷ h effective windows. Drift = 0 unless the vote is directional and its composite hit rate > 55%; then half the historical sign-matched mean move.</li>" +
      (function () { var IV = ivNow(); return "<li><b>Market-implied:</b> " + (IV ? esc(IV.src) + " " + IV.atm.toFixed(2) + "% as of " + esc(mdy(new Date(IV.t).toISOString().slice(0, 10))) + (IV.fresh ? "" : " (dated)") : "none on file") + " — drives the implied daily and horizon moves shown beside the model's, weighted 0% in the blend until a daily IV history exists to validate it (the desk now appends each pull to fx.fxopt_hist). Sources and the 6C → USD/CAD mapping are in pillar A.</li>"; })() +
      "<li><b>Not on file:</b> FX options open interest, CFTC asset-manager positioning, an event-day history for USD/CAD (event days are marked, not stepped). Spread history covers " + I.spread.length + " sessions; CFTC z-scores " + I.cotz.length + " weeks.</li>" +
      "<li><b>Sources:</b> Bank of Canada (closes) · Yahoo Finance (WTI, DXY, live mid) · US Treasury and Bank of Canada (2Y yields) · CFTC TFF (positioning) · CME CORRA and FedWatch-style pricing (policy) · desk economic calendar. Educational only, not advice.</li></ul></details>";
  }

  /* ---------- Knowledge Centre ---------- */
  function kc(C, sp) {
    var R = C.res, H1 = R.horizons["1M"], H5 = R.horizons["1W"], s1 = H1.sd, ann = s1 / Math.sqrt(21) * Math.sqrt(252);
    var ex = "Today: daily σ ≈ " + (ann / Math.sqrt(252) * 100).toFixed(3) + "% (" + (ann * 100).toFixed(2) + "% annualised). 1M = 21 sessions → σ × √21 = " + (s1 * 100).toFixed(2) + "%. Spot " + sp.px.toFixed(4) + " × " + (s1 * 100).toFixed(2) + "% ≈ " + pips(sp.px * s1) + " pips. 1W: × √5 → " + pips(sp.px * H5.sd) + " pips — not a quarter of the 1M move, because ranges grow with √time.";
    function L(n, t, items, open) { return '<details class="fxf-les"' + (open ? " open" : "") + '><summary><span class="fxf-ln">' + n + "</span>" + t + "</summary>" + items.map(function (q) { return '<div class="fxf-q"><b>' + q[0] + "</b><p>" + q[1] + "</p></div>"; }).join("") + "</details>"; }
    return '<div class="fxf-kc"><p class="fxf-kci">How to read the Forecast Dashboard and think about USD/CAD like a strategist. Examples use today\'s numbers. Start with Lesson 1, then follow Lesson 6 as a routine.</p>' +
      L(1, "Understanding the volatility cone", [
        ["What is a volatility cone?", "A fan of price ranges drawn forward from today. Each band holds a stated share of possible outcomes if volatility stays as estimated. It is a map of uncertainty, not a prediction of the path."],
        ["What do 1σ, 2σ and 3σ mean?", "σ (sigma) is one standard deviation of the return over the horizon. For a normal distribution about 68.3% of outcomes fall within ±1σ, 95.4% within ±2σ and 99.7% within ±3σ. Real FX returns have fatter tails, so 3σ moves happen more often than 0.3% of the time."],
        ["How are expected moves calculated?", "Expected move = spot × σ<sub>h</sub>, where σ<sub>h</sub> = daily σ × √(sessions). " + esc(ex)],
        ["Why does the cone widen over time?", "Each day adds an independent shock, so variances add: the variance after h days is h × the daily variance and the standard deviation grows with √h. A 4× longer horizon gives only a 2× wider range."],
        ["Why doesn't a cone predict direction?", "It is built from the size of past moves, not their sign. A centred median says the model has no validated view on direction — a separate question answered by the Directional bias card."]], true) +
      L(2, "Understanding expected moves", [
        ["Implied vs realised volatility", "Implied vol is backed out of option prices — what the market charges for future movement. Realised vol is the standard deviation of actual returns. Implied is forward-looking and usually a little higher (a risk premium); realised is backward-looking and exact."],
        ["How to calculate expected pips", "Pips = spot × annual vol × √(days ÷ 252) × 10,000. With spot 1.4377, vol 4.0% and 21 days: 1.4377 × 0.04 × √(21/252) × 10,000 ≈ 166 pips."],
        ["Volatility expansion and contraction", "Volatility clusters and mean-reverts. Low realised vol with a rising EWMA signals expansion; GARCH's long-run level (" + pc(R.garchLR, 2) + " today) is where the model expects vol to drift."],
        ["Comparing horizons", "Convert each to annualised vol (σ<sub>h</sub> ÷ √h × √252). If 1W annualised exceeds 3M annualised the term structure is inverted — near-term stress priced or measured."]]) +
      L(3, "Understanding options data", [
        ["What is implied volatility?", "The volatility that, plugged into an option pricing model, reproduces the option's market price. Higher option prices → higher implied vol."],
        ["What are 25-delta risk reversals?", "25Δ call vol minus 25Δ put vol. Positive = USD calls (USD/CAD upside) cost more — the market pays for USD strength. The stored reading is " + (R.rr != null ? sg(R.rr, 2, "%") + " from " + esc(mdy(R.ivAsof)) : "not on file") + "."],
        ["What is volatility skew?", "The way implied vol changes across strikes. In USD/CAD, demand for protection against a CAD sell-off usually makes USD-call vol richer than USD-put vol."],
        ["What is a butterfly?", "Average of the 25Δ call and put vols minus ATM vol — the price of the tails (convexity). High butterflies = markets pay up for large moves either way."],
        ["What does the term structure reveal?", "Implied vol by expiry. Upward sloping = calm now, uncertainty later (normal). Inverted = stress or a known event close in."],
        ["Where do I get USD/CAD implied vol, and how do 6C options map?", "Spot FX options trade over the counter, so the public sources are CME CAD/USD futures options (6C), CME's CVOL index (CAVL), Barchart and Investing.com (free, delayed), and IBKR, CME's API or IVolatility (live / paid). 6C quotes USD per CAD — the inverse of USD/CAD. Volatility is the same for both; a 6C call at K is a USD/CAD put at 1/K, so flip the sign of the risk reversal. Daily expected move = IV ÷ √252."],
        ["What can't open interest tell you?", "Open interest counts contracts outstanding; it has no price of volatility in it. It can show where positioning clusters (pins), but you cannot infer implied vol, skew or expected moves from OI alone. The desk stores no FX options OI."]]) +
      L(4, "Understanding macro drivers", [
        ["Interest-rate differentials", "When US 2-year yields rise relative to Canada's, holding USD earns more and USD/CAD tends to rise. The 2Y is used because it tracks expected central-bank policy over the next two years."],
        ["WTI oil and the Canadian dollar", "Canada is a major crude exporter, so higher oil improves its trade balance and supports CAD (USD/CAD down). The link is real but unstable and has weakened since 2015."],
        ["DXY and the US dollar", "DXY measures USD against six major currencies. A broad USD rally usually lifts USD/CAD too, even if nothing changed in Canada."],
        ["Fed and BoC decisions", "Markets price the path of policy in advance (Fed funds futures, CORRA futures). The currency moves on surprises versus that pricing, not on the decision itself."],
        ["Economic surprises", "Data that misses consensus forces a repricing of rate expectations — that is why CPI, jobs and GDP days have larger moves than ordinary days."]]) +
      L(5, "Understanding COT positioning", [
        ["Leveraged funds vs asset managers", "In the CFTC Traders in Financial Futures report, leveraged funds are hedge funds and CTAs (fast, speculative); asset managers are pension and mutual funds (slow, structural). The desk stores leveraged funds only."],
        ["Net long and net short", "Net = long contracts − short contracts in CAD futures. Net short CAD is the same bet as long USD/CAD."],
        ["Historical percentile", "Where today's net sits within its own 1- or 3-year history. The 5th percentile = shorter than 95% of past weeks."],
        ["Crowded trades and reversal risk", "When almost everyone is positioned one way, there is little fresh money left to push further and a surprise forces covering — a squeeze. That's why the desk's rule is contrarian only at extremes (|z| ≥ 1)."],
        ["Weekly changes", "The change tells you whether the crowd is adding or cutting. Positions are as of Tuesday and published Friday, so they lag price by 3 days."]]) +
      L(6, "How to build a forecast", [
        ["1 · Identify the volatility regime", "Check the regime card: low, normal, elevated or extreme. It tells you how much weight recent moves deserve."],
        ["2 · Establish the market-implied move", "If current option data exists, convert implied vol to pips. Today the desk's options pull is dated, so use it only as a cross-check."],
        ["3 · Assess statistical forecasts", "Compare EWMA (reacts fast), GARCH (mean-reverts to a long-run level) and historical simulation (uses actual past moves). The blend weights tell you which has been most accurate lately."],
        ["4 · Evaluate macro direction and catalysts", "Spread, oil, DXY and central-bank pricing — then list the releases inside the horizon."],
        ["5 · Check positioning and technicals", "Is the crowd extreme? Is price trending (efficiency > 0.3) or ranging? Where are support and resistance?"],
        ["6 · Build scenarios", "Bullish, base and bearish with probabilities and targets from the percentiles."],
        ["7 · Identify invalidation levels", "Write down in advance the price, volatility or macro move that would prove you wrong."],
        ["8 · Compare with outcomes", "Track whether 1σ captured about two-thirds of outcomes. If not, widen or narrow the bands — that is what the Forecast accuracy section does."]]) +
      L(7, "Common forecasting mistakes", [
        ["Higher volatility means bullish", "Volatility is size, not sign. A wider cone is wider on both sides."],
        ["Treating 1σ as a boundary", "One in three closes lands outside ±1σ; one in twenty outside ±2σ. Stops placed exactly at 1σ get hit often."],
        ["Confusing open interest with implied vol", "OI is a count of contracts; implied vol is a price. Big OI at a strike says nothing about how volatile the market expects to be."],
        ["Overweighting one indicator", "No single driver is reliable. The dashboard only lets rules that passed an out-of-sample test vote, and weights them by their edge."],
        ["Ignoring event risk", "A cone fitted on calm days underestimates CPI, jobs and central-bank days — check the catalyst card."],
        ["Correlation is not causation", "Oil and CAD moved together for years, then didn't. A relationship needs a reason and a test."],
        ["A forecast is not certainty", "Every probability here is an estimate with error. Size positions so being wrong is survivable."]]) +
      '<div class="fxf-kcg"><b>Glossary</b> σ = standard deviation · pip = 0.0001 · EWMA = exponentially weighted moving average of squared returns · GARCH = model where vol reverts to a long-run level · Coverage = share of outcomes inside a band · Effective n = independent windows (n ÷ horizon).</div></div>';
  }

  /* ---------- mount ---------- */
  function html() {
    var C = engine(); if (!C) return "";
    var sp = spotNow();
    return '<div class="tile wide vcone-tile fxf-tile" data-vck="fxf" data-src="fx_spot"><h2>USD/CAD — Expected move &amp; forecast <span class="h2note">— how far it could move, which way the evidence leans, what drives it, what would prove it wrong, how accurate it has been</span></h2>' +
      '<div class="fxf-tabs" role="tablist"><button type="button" role="tab" data-fxft="dash" aria-selected="' + (ST.tab === "dash") + '">Forecast Dashboard</button><button type="button" role="tab" data-fxft="kc" aria-selected="' + (ST.tab === "kc") + '">Knowledge Centre</button></div>' +
      '<div class="fxf-body">' + (ST.tab === "kc" ? kc(C, sp) : dash(C, sp)) + "</div>" +
      '<div class="stamp">Closes through ' + esc(mdy(C.res.last)) + " (Bank of Canada) · spot " + esc(sp.src) + " " + esc(sp.ts ? TS.format(new Date(sp.ts)) + " ET" : "") + " · options " + (function () { var IV = ivNow(); return IV ? esc(mdy(new Date(IV.t).toISOString().slice(0, 10))) + (IV.man ? " (yours)" : "") : "none"; })() + " · CFTC " + esc(md(((root.DATA.fx.pos || {}).kpi || {}).date)) + " · estimates from a statistical model, not advice</div><div class=\"fxf-pop\" hidden></div></div>";
  }
  var LASTPX = null, OPEN = {}, POP = null;
  function showPop(pop) { if (!pop || !POP) return; pop.innerHTML = infoHTML(POP.k, NOW[POP.k]) + '<button type="button" class="fxf-x" aria-label="Close">×</button>'; pop.style.left = POP.left + "px"; pop.style.top = POP.top + "px"; pop.hidden = false; }
  function mount() {
    var P = doc.getElementById("panel-fx"), S = P && P.querySelector('[data-subpanel="overview"]'); if (!S) return;
    var old = S.querySelector(":scope > .vcone-tile"), h; sizeTo(mount._again ? mount._w : ((old && old.clientWidth) || S.clientWidth || 934) - 34); try { h = html(); } catch (e) { if (root.console) console.error("fxforecast", e); return; }
    if (!h) return;
    if (old) [].forEach.call(old.querySelectorAll("details"), function (d, i) { OPEN[i] = d.open; });
    var w = doc.createElement("div"); w.innerHTML = h; var t = w.firstChild;
    if (old && old.classList.contains("fxf-tile")) [].forEach.call(t.querySelectorAll("details"), function (d, i) { if (i in OPEN) d.open = OPEN[i]; });
    /* keep the desk's section-tab tags (sectabs.js) so the card stays in its section and keeps its shown/hidden state */
    if (old) { ["data-sec", "data-sec-lab"].forEach(function (a) { if (old.hasAttribute(a)) t.setAttribute(a, old.getAttribute(a)); }); if (old.classList.contains("st-off")) t.classList.add("st-off"); }
    /* no old card: leave it untagged so sectabs.js files it under its section and lists it in the section row */
    if (old) old.replaceWith(t); else { var first = [].filter.call(S.children, function (c) { return c.classList.contains("tile") && !/kpi-strip|dash-head/.test(c.className); })[0]; S.insertBefore(t, first || null); }
    LASTPX = spotNow().px; if (POP && ST.tab === "dash") showPop(t.querySelector(".fxf-pop"));
    /* first draw may happen while the card is hidden (width unknown): redraw once at the real width */
    var cw = t.clientWidth - 34; if (!mount._again && cw > 200 && Math.abs(cw - VW) > 40) { mount._again = true; mount._w = cw; try { mount(); } finally { mount._again = false; } }
  }
  function rerender() { var T = doc.querySelector("#panel-fx .fxf-tile"); if (T) mount(); }
  doc.addEventListener("click", function (ev) {
    var tg = ev.target.closest && ev.target.closest(".fxf-tile [data-fxft],.fxf-tile [data-fxfh],.fxf-tile [data-fxfl],.fxf-tile [data-fxfi]");
    var pop = doc.querySelector(".fxf-tile .fxf-pop");
    if (!tg) { if (pop && !pop.hidden && !(ev.target.closest && ev.target.closest(".fxf-pop"))) { pop.hidden = true; POP = null; } return; }
    if (tg.hasAttribute("data-fxfi")) {
      var k = tg.getAttribute("data-fxfi"), T = tg.closest(".fxf-tile"), r = tg.getBoundingClientRect(), tr = T.getBoundingClientRect();
      var x = Math.min(Math.max(8, r.left - tr.left - 20), tr.width - Math.min(380, tr.width - 16) - 8);
      POP = { k: k, left: x, top: r.bottom - tr.top + 6 }; showPop(pop);
      ev.preventDefault(); ev.stopPropagation(); return;
    }
    POP = null;
    if (tg.hasAttribute("data-fxft")) ST.tab = tg.getAttribute("data-fxft");
    else if (tg.hasAttribute("data-fxfh")) ST.hz = tg.getAttribute("data-fxfh");
    else { var l = tg.getAttribute("data-fxfl"); ST[l] = !ST[l]; }
    save(); rerender();
  });
  doc.addEventListener("click", function (ev) { if (ev.target.classList && ev.target.classList.contains("fxf-x")) { ev.target.parentNode.hidden = true; POP = null; } });
  /* implied vol entered on the card (per browser) */
  doc.addEventListener("submit", function (ev) {
    var f = ev.target.closest && ev.target.closest("[data-fxfiv]"); if (!f) return; ev.preventDefault();
    var v = parseFloat(f.v.value); if (!(v > 0.5 && v < 40)) { f.v.focus(); return; }
    try { localStorage.setItem(IVK, JSON.stringify({ v: v, src: f.src.value, t: Date.now() })); } catch (e) {}
    rerender();
  });
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("[data-fxfivx]")) { try { localStorage.removeItem(IVK); } catch (e) {} rerender(); } });
  doc.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { var p = doc.querySelector(".fxf-tile .fxf-pop"); if (p) p.hidden = true; POP = null; } });
  setInterval(function () {
    var P = doc.getElementById("panel-fx"); if (!P || !P.classList.contains("active") || !P.querySelector(".fxf-tile") || ST.tab !== "dash") return;
    var pop = P.querySelector(".fxf-pop"); if (pop && !pop.hidden) return;
    var px = spotNow().px; if (LASTPX != null && Math.abs(px - LASTPX) > 1e-9) mount();
  }, 5000);
  /* redraw on resize only when the card's width really changed (a scrollbar appearing must not wipe an open explanation) */
  var RZ = null; root.addEventListener && root.addEventListener("resize", function () { clearTimeout(RZ); RZ = setTimeout(function () { var T = doc.querySelector("#panel-fx .fxf-tile"); if (T && T.clientWidth > 200 && Math.abs(T.clientWidth - 34 - VW) > 40) rerender(); }, 250); });
  root.FXF = { mount: mount, engine: engine };
  /* the volcone module may already have drawn the old USD/CAD cone */
  try { mount(); } catch (e) {}

  var css = doc.createElement("style");
  css.textContent =
    ".fxf-tile{position:relative;container-type:inline-size;--fb:#05080c;--fl:#1c2430;--fm:#8a97a8;--fi:#e8eef4;--fc:#38e0c0}html[data-theme=light] .fxf-tile{--fb:#fff;--fl:#d8dee6;--fm:#5b6676;--fi:#111a24}" +
    ".fxf-tabs{display:flex;flex-wrap:wrap;gap:0 2px;border-bottom:1px solid var(--line2,#2a3442);margin:6px 0 14px}.fxf-tabs>button{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 13px 9px;margin:0 0 -1px;font:600 13.5px 'IBM Plex Sans',system-ui,sans-serif;color:var(--muted,#8a97a8);cursor:pointer}" +
    ".fxf-tabs>button:hover{color:var(--ink,#e8edf3)}.fxf-tabs>button[aria-selected=true]{color:#d9b46a;border-bottom-color:#d9b46a}.fxf-tabs>button:focus-visible{outline:2px solid #d9b46a}" +
    ".fxf-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:10px}.fxf-card{border:1px solid var(--fl);border-radius:8px;padding:10px 12px;background:var(--fb);min-width:0}" +
    ".fxf-cl{display:flex;align-items:center;gap:6px;font:600 10.5px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--fm)}.fxf-cv{font:500 20px 'JetBrains Mono','IBM Plex Mono',monospace;color:var(--fi);margin:6px 0 4px;line-height:1.15}.fxf-cv small{font-size:12px;color:var(--fm)}" +
    ".fxf-cs{font-size:11.5px;line-height:1.4;color:var(--fm)}.fxf-tile .up{color:#3fb97f}.fxf-tile .dn{color:#e0655f}.fxf-tile .neu{color:var(--fm)}" +
    ".fxf-rg,.fxf-cf{font-size:15px;font-weight:700;letter-spacing:.06em;border:1px solid;border-radius:5px;padding:2px 8px}.fxf-rg.low{color:#38b6c9}.fxf-rg.normal{color:#3fb97f}.fxf-rg.elevated{color:#ffb020}.fxf-rg.extreme{color:#e0655f}.fxf-cf.high{color:#3fb97f}.fxf-cf.medium{color:#ffb020}.fxf-cf.low{color:#e0655f}" +
    ".fxf-i{all:unset;cursor:pointer;width:15px;height:15px;border-radius:50%;border:1px solid var(--fm);color:var(--fm);font:700 10px/15px 'IBM Plex Sans',sans-serif;text-align:center;flex:0 0 auto;text-transform:none;letter-spacing:0}.fxf-i:hover,.fxf-i:focus-visible{color:#d9b46a;border-color:#d9b46a}" +
    ".fxf-pop{position:absolute;z-index:30;width:min(380px,calc(100% - 16px));background:#0b1017;border:1px solid #d9b46a;border-radius:8px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.6);font-size:12.5px;line-height:1.5;color:#dbe3ec}html[data-theme=light] .fxf-pop{background:#fff;color:#1b2530}" +
    ".fxf-pop b{display:block;color:#d9b46a;font-size:13px;margin-bottom:4px;padding-right:18px}.fxf-pop p{margin:5px 0}.fxf-pop i{font-style:normal;display:block;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#8a97a8}.fxf-x{all:unset;cursor:pointer;position:absolute;top:6px;right:10px;font-size:18px;color:#8a97a8}" +
    ".fxf-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:4px 0 8px}.fxf-seg{display:flex;flex-wrap:wrap;gap:6px}.fxf-seg>button{appearance:none;background:transparent;border:1px solid var(--line2,#2a3442);border-radius:999px;padding:4px 11px;font:600 12px 'IBM Plex Sans',sans-serif;color:var(--muted,#8a97a8);cursor:pointer}" +
    ".fxf-seg>button[aria-pressed=true]{border-color:#d9b46a;color:#d9b46a}.fxf-seg>button:focus-visible{outline:2px solid #d9b46a}.fxf-spot{margin-left:auto;font:11.5px 'JetBrains Mono','IBM Plex Mono',monospace;color:var(--fm)}.fxf-spot b{color:var(--fi);font-weight:500}" +
    ".fxf-chart{border:1px solid var(--fl);border-radius:8px;background:var(--fb);padding:8px 8px 6px}.fxf-ct{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font:600 11px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--fi);margin:2px 4px 4px}.fxf-ct span{text-transform:none;letter-spacing:0;font-weight:400;color:var(--fm)}" +
    ".fxf-svg{width:100%;height:auto;display:block}.fxf-g{stroke:var(--fl)}.fxf-ax{fill:var(--fm);font:10.5px 'JetBrains Mono','IBM Plex Mono',monospace}.fxf-ax2{fill:var(--fm);font:9.5px 'JetBrains Mono','IBM Plex Mono',monospace}.fxf-now{stroke:var(--fm);stroke-dasharray:2 3;opacity:.6}" +
    ".fxf-b1{fill:rgba(56,224,192,.30);stroke:rgba(80,240,210,.65);stroke-width:1}.fxf-b2{fill:rgba(56,224,192,.13);stroke:rgba(80,240,210,.35);stroke-width:1}.fxf-b3{fill:rgba(255,176,32,.06);stroke:rgba(255,176,32,.45);stroke-width:1;stroke-dasharray:4 3}.fxf-med{fill:none;stroke:#38e0c0;stroke-width:1.3;stroke-dasharray:5 3}" +
    ".fxf-px{fill:none;stroke:var(--fi);stroke-width:1.4}.fxf-ma{fill:none;stroke-width:1.2;opacity:.85}.fxf-ma.e20{stroke:#c9b07a}.fxf-ma.e50{stroke:#8f84e0}.fxf-ma.e100{stroke:#5b62a8}.fxf-lvl{stroke-dasharray:3 4;stroke-width:1;opacity:.7}.fxf-lvl.r{stroke:#3fb97f}.fxf-lvl.s{stroke:#e0655f}.fxf-lvl.cot{stroke:#ffb020}" +
    ".fxf-spl{stroke:#38e0f0;stroke-dasharray:1 3;opacity:.6}.fxf-dot{fill:#38e0f0;filter:drop-shadow(0 0 5px #38e0f0)}.fxf-axtag{fill:var(--fb);stroke:#d9b46a}.fxf-axtagt{fill:#ffe2a0;font:500 11px 'JetBrains Mono',monospace}html[data-theme=light] .fxf-axtagt{fill:#7a5a12}" +
    ".fxf-ev{stroke:#8a97a8;stroke-dasharray:3 4;opacity:.6}.fxf-evm rect{fill:#1b2532;stroke:#d9b46a}.fxf-yl{opacity:.75}.fxf-tg.spot text{fill:#9ff0ff;font-weight:700}html[data-theme=light] .fxf-tg.spot text{fill:#0b6f80}.fxf-evm text{fill:#ffe2a0;font:700 9.5px 'JetBrains Mono',monospace}html[data-theme=light] .fxf-evm rect{fill:#fff}html[data-theme=light] .fxf-evm text{fill:#7a5a12}" +
    ".fxf-tg text{font:600 10px 'JetBrains Mono','IBM Plex Mono',monospace;paint-order:stroke;stroke:var(--fb);stroke-width:3px}.fxf-tg line{stroke-width:1;stroke:var(--fm);opacity:.6}.fxf-tg.med text,.fxf-tg.b1 text{fill:#5fe8cc}.fxf-tg.b2 text{fill:#3fbfa4}.fxf-tg.b3 text{fill:#ffb84d}.fxf-tg.lv text{fill:var(--fm)}.fxf-tg.cot text{fill:#ffb84d}.fxf-tg.e20 text{fill:#d8c08c}.fxf-tg.e50 text{fill:#a69df0}.fxf-tg.e100 text{fill:#8a90d0}" +
    "html[data-theme=light] .fxf-tg.med text,html[data-theme=light] .fxf-tg.b1 text,html[data-theme=light] .fxf-tg.b2 text{fill:#0d7c68}html[data-theme=light] .fxf-tg.cot text,html[data-theme=light] .fxf-tg.b3 text{fill:#9a5a00}html[data-theme=light] .fxf-tg.e20 text{fill:#7a5a12}html[data-theme=light] .fxf-tg.e50 text,html[data-theme=light] .fxf-tg.e100 text{fill:#3b3399}" +
    ".fxf-evl{margin:6px 4px 2px;padding-left:20px;font-size:11.5px;color:var(--fm);columns:2;column-gap:24px}.fxf-evl b{color:var(--fi);font-weight:600}" +
    ".fxf-st2{font:600 11px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--fm);margin:14px 0 6px}.fxf-pils{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}" +
    ".fxf-pil,.fxf-sec,.fxf-les{border:1px solid var(--fl);border-radius:8px;background:var(--fb);padding:0 12px;min-width:0}.fxf-sec{margin-top:10px}.fxf-pil>summary,.fxf-sec>summary,.fxf-les>summary{cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:10px 0;font:600 13px 'IBM Plex Sans',sans-serif;color:var(--fi)}" +
    ".fxf-pil>summary b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;background:#d9b46a;color:#101825;font-size:11.5px}.fxf-pil>summary span,.fxf-sec>summary span{font-weight:400;font-size:11.5px;color:var(--fm);flex-basis:100%}" +
    ".fxf-kvs{display:flex;flex-direction:column;gap:3px;margin-bottom:8px}.fxf-kv{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--fm)}.fxf-kv b{color:var(--fi);font-weight:500;text-align:right;font-variant-numeric:tabular-nums}.fxf-kv small,.fxf-t small{color:var(--fm);font-weight:400}" +
    ".fxf-stale{font:700 9.5px 'JetBrains Mono',monospace;color:#ffb020;border:1px solid #ffb02088;border-radius:3px;padding:0 4px;margin-left:4px;letter-spacing:.04em;text-transform:uppercase}" +
    ".fxf-t{width:100%;border-collapse:collapse;font:11.5px 'JetBrains Mono','IBM Plex Mono',monospace;margin:6px 0 10px;font-variant-numeric:tabular-nums}.fxf-t th{text-align:right;color:var(--fm);font-weight:600;padding:5px 6px;border-bottom:1px solid var(--fl)}.fxf-t td{text-align:right;padding:5px 6px;border-bottom:1px solid var(--fl);color:var(--fi)}" +
    ".fxf-t th:first-child,.fxf-t td:first-child{text-align:left}.fxf-t tr.on td{background:rgba(217,180,106,.08)}.fxf-dt td{white-space:nowrap}.fxf-dt th{white-space:normal}.fxf-dt td:first-child{white-space:normal;width:34%;font-family:'IBM Plex Sans',sans-serif}.fxf-sec,.fxf-pil{overflow-x:auto}" +
    ".fxf-sc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:4px 0 10px}.fxf-sc>div{border:1px solid var(--fl);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--fm)}.fxf-sc>div b{color:var(--fi);font-size:13px}.fxf-sc>.up{border-color:#3fb97f66}.fxf-sc>.dn{border-color:#e0655f66}.fxf-sc>.up b{color:#3fb97f}.fxf-sc>.dn b{color:#e0655f}" +
    ".fxf-st{font:600 11px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--fm);display:flex;align-items:center;gap:6px;margin:8px 0 2px}" +
    ".fxf-inv{margin:6px 0 12px;padding-left:18px;font-size:12.5px;line-height:1.55;color:var(--fi)}.fxf-inv li{margin:3px 0}.fxf-note{font-size:11.5px;color:var(--fm);margin:0 0 12px;line-height:1.5}.fxf-prev{font-size:12.5px;color:var(--fi);margin:6px 0 4px;line-height:1.5}" +
    ".fxf-kc{display:flex;flex-direction:column;gap:8px}.fxf-kci{margin:0 0 4px;color:var(--fm);font-size:13px}.fxf-les>summary{font-size:14px}.fxf-ln{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;border:1px solid #d9b46a;color:#d9b46a;font:700 11px 'JetBrains Mono',monospace}" +
    ".fxf-q{border-top:1px solid var(--fl);padding:8px 0}.fxf-q b{color:var(--fi);font-size:13px}.fxf-q p{margin:4px 0 0;font-size:13px;line-height:1.6;color:var(--fm)}.fxf-kcg{font-size:12px;line-height:1.6;color:var(--fm);border:1px dashed var(--fl);border-radius:8px;padding:10px 12px}.fxf-kcg b{color:var(--fi);margin-right:6px}" +
    ".fxf-cvs{font-size:14px;line-height:1.3;display:block}" +
    ".fxf-dim{color:#ffb020}.fxf-ivf{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 4px;font-size:12px;color:var(--fm)}.fxf-ivf input,.fxf-ivf select{background:var(--fb);color:var(--fi);border:1px solid var(--line2,#2a3442);border-radius:6px;padding:4px 6px;font:12px 'JetBrains Mono',monospace}.fxf-ivf input{width:72px}.fxf-ivf button{appearance:none;background:transparent;border:1px solid #d9b46a;color:#d9b46a;border-radius:999px;padding:3px 10px;font:600 12px 'IBM Plex Sans',sans-serif;cursor:pointer}" +
    ".fxf-src td{white-space:normal;font-family:'IBM Plex Sans',sans-serif;text-align:left!important;vertical-align:top}.fxf-src th{text-align:left!important}.fxf-src td:first-child{font-weight:600;white-space:nowrap}" +
    "@container (max-width:1150px){.fxf-cards{grid-template-columns:repeat(3,minmax(0,1fr))}}@container (max-width:720px){.fxf-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.fxf-pils,.fxf-sc{grid-template-columns:1fr}.fxf-evl{columns:1}.fxf-spot{margin-left:0}}" +
    "@container (max-width:380px){.fxf-cards{grid-template-columns:1fr}}";
  doc.head.appendChild(css);
})(typeof window !== "undefined" ? window : globalThis);
