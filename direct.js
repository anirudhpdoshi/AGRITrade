/* direct.js — release-time data straight from the official sources, in the browser.
   Every source below sends Access-Control-Allow-Origin, needs no key, and is mapped to the exact
   series and maths the server uses (scripts/update_data.py), so the browser value equals the
   value the next server refresh will confirm.

   Statistics Canada WDS  ca_emp ca_ur ca_gdp ca_gdpq ca_cpi · retail (20-10-0056) · trade (12-10-0011)
   Bank of Canada Valet   ca_trim ca_median ca_policy
   BLS public API v1      us_cpi us_core_cpi us_nfp us_ur us_ahe   (no key: 25 requests/day per IP -> budgeted)
   NY Fed markets API     us_policy (target upper bound; NY Fed publishes it the next morning)
   US Treasury FiscalData us_deficit us_receipts us_outlays (Monthly Treasury Statement)
   CFTC Socrata           Disaggregated (corn, wheat, soybeans) + TFF (CAD) -> series, stats, KPIs, avg entry

   Not browser-reachable (no CORS or a private key) -> server fast lane only: FRED-only series
   (jobless claims, GDP, core PCE, US retail, US trade, UMich), USDA export sales & WASDE (FAS key). */
(function () {
  "use strict";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONF = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function label(d, fq) { var y = d.slice(2, 4), m = +d.slice(5, 7), dd = +d.slice(8, 10);
    return fq === "Q" ? "Q" + (Math.floor((m - 1) / 3) + 1) + " '" + y : (fq === "W" || fq === "D") ? MON[m - 1] + " " + dd : MON[m - 1] + " '" + y; }
  function transform(P, how) {
    var by = {}, out = []; P.forEach(function (p) { by[p[0]] = p[1]; });
    P.forEach(function (p, i) { var d = p[0], v = p[1];
      if (how === "level") out.push([d, v]);
      else if ((how === "diff" || how === "pct") && i > 0) { var pv = P[i - 1][1]; out.push([d, how === "diff" ? v - pv : (v / pv - 1) * 100]); }
      else if (how === "qann" && i > 0) out.push([d, (Math.pow(v / P[i - 1][1], 4) - 1) * 100]);
      else if (how === "yoy") { var b = by[(+d.slice(0, 4) - 1) + d.slice(4)]; if (b) out.push([d, (v / b - 1) * 100]); } });
    return out;
  }
  function rnd(v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; }
  function nowIso() { return new Date(Date.now()).toISOString(); }
  function clock() { return new Date(Date.now()).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }) + " ET"; }
  function todayET() { var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now())).forEach(function (q) { p[q.type] = q.value; }); return p.year + "-" + p.month + "-" + p.day; }
  function getJSON(url, opt) { return fetch(url, Object.assign({ cache: "no-store" }, opt || {})).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); }

  /* apply a transformed series to a macro item exactly like the server's macro()/_track() */
  function applyMacro(m, T, srcNote, dec2) {
    if (!m || !T.length) return false;
    var L = T[T.length - 1];
    if (!(L[0] > m.obs_date)) return false;
    var n = dec2 != null ? dec2 : m.dec + 1, lab = label(L[0], m.freq);
    m.prior = m.value; m.value = rnd(L[1], n); m.chg = rnd(m.value - m.prior, n); m.period = lab; m.obs_date = L[0];
    if (m.history) { m.history.push([lab, m.value]); if (m.history.length > 12) m.history.shift(); }
    if (m.hist24) { m.hist24.push([lab, m.value]); if (m.hist24.length > 24) m.hist24.shift(); }
    if (m.long && m.freq !== "D") m.long.push([L[0], rnd(L[1], m.dec + 1)]);
    m.seen_at = nowIso(); m.direct = srcNote + " · fetched in your browser " + clock();
    return true;
  }
  var mf = function (k) { return window.mfind && window.mfind(k); };

  /* ---------------- Statistics Canada WDS ---------------- */
  var SC = { ca_emp: [2062811, "diff"], ca_ur: [2062815, "level"], ca_gdp: [65201210, "pct"], ca_gdpq: [62305752, "qann"], ca_cpi: [41690973, "yoy"] };
  var SC_RETAIL = { tot: 1446859483, auto: 1446859486, gas: 1446859526, ecom: 1446859484 };
  var SC_TRADE = { ca_exports: 87008955, ca_imports: 87008839, ca_trade_bal: 87008984, ca_exports_us: 87008956, ca_imports_us: 87008840, ca_trade_bal_us: 87008985 };
  function scVectors(list) {   /* list: [[vector, latestN]] -> {vector: [[YYYY-MM-DD, value]]} */
    return getJSON("https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list.map(function (v) { return { vectorId: v[0], latestN: v[1] }; }))
    }).then(function (arr) { var out = {};
      (arr || []).forEach(function (o) { if (!o || o.status !== "SUCCESS") return;
        out[o.object.vectorId] = (o.object.vectorDataPoint || []).filter(function (p) { return p.value != null; })
          .map(function (p) { return [p.refPer.slice(0, 10), +p.value]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); });
      return out; });
  }
  function statcanMacro(keys) {
    keys = keys.filter(function (k) { return SC[k] && mf(k); }); if (!keys.length) return Promise.resolve([]);
    return scVectors(keys.map(function (k) { return [SC[k][0], SC[k][1] === "yoy" ? 14 : 4]; })).then(function (V) {
      return keys.filter(function (k) { var P = V[SC[k][0]]; return P && applyMacro(mf(k), transform(P, SC[k][1]), "Statistics Canada WDS v" + SC[k][0]); });
    });
  }
  function statcanRetail() {
    var ids = Object.keys(SC_RETAIL).map(function (k) { return [SC_RETAIL[k], 14]; });
    return scVectors(ids).then(function (V) {
      var acc = {}; Object.keys(SC_RETAIL).forEach(function (k) { var o = {}; (V[SC_RETAIL[k]] || []).forEach(function (p) { o[p[0]] = p[1]; }); acc[k] = o; });
      if (!Object.keys(acc.tot).length) return [];
      acc.ex = {}; Object.keys(acc.tot).forEach(function (d) { if (d in acc.auto) acc.ex[d] = acc.tot[d] - acc.auto[d]; });
      acc.core = {}; Object.keys(acc.ex).forEach(function (d) { if (d in acc.gas) acc.core[d] = acc.ex[d] - acc.gas[d]; });
      var got = [];
      [["ca_retail", "tot"], ["ca_retail_ex", "ex"], ["ca_retail_core", "core"]].forEach(function (x) {
        var m = mf(x[0]), raw = Object.keys(acc[x[1]]).sort().map(function (d) { return [d, acc[x[1]][d]]; });
        if (!m || raw.length < 3) return;
        if (!applyMacro(m, transform(raw, "pct"), "Statistics Canada WDS 20-10-0056 v" + (x[1] === "tot" ? SC_RETAIL.tot : x[1] === "ex" ? SC_RETAIL.tot + "−v" + SC_RETAIL.auto : SC_RETAIL.tot + "−v" + SC_RETAIL.auto + "−v" + SC_RETAIL.gas), 2)) return;
        var last = raw[raw.length - 1], base = acc[x[1]][(+last[0].slice(0, 4) - 1) + last[0].slice(4)];
        m.level_b = rnd(last[1] / 1e6, 2); m.yoy = base ? rnd((last[1] / base - 1) * 100, 2) : null;
        if (x[1] === "tot" && acc.ecom[last[0]] != null) { m.ecom_b = rnd(acc.ecom[last[0]] / 1e6, 2); m.ecom_share = rnd(acc.ecom[last[0]] / last[1] * 100, 1); }
        got.push(x[0]); });
      return got;
    });
  }
  function statcanTrade() {
    var X = window.DATA.ext; if (!X) return Promise.resolve([]);
    return scVectors(Object.keys(SC_TRADE).map(function (k) { return [SC_TRADE[k], 3]; })).then(function (V) {
      var newer = false;
      Object.keys(SC_TRADE).forEach(function (k) { var P = V[SC_TRADE[k]], S = X[k]; if (!P || !S) return;
        P.forEach(function (p) { var mo = p[0].slice(0, 7), v = rnd(p[1] / 1000, 3), i = S.pts.findIndex(function (q) { return q[0] === mo; });
          if (i >= 0) S.pts[i][1] = v; else { S.pts.push([mo, v]); S.pts.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); newer = true; } });
        if (S.pts.length > 30) S.pts = S.pts.slice(-30);
        S.direct = "Statistics Canada WDS v" + SC_TRADE[k] + " · fetched in your browser " + clock(); });
      if (newer) { window.DATA.meta.asof.ext = nowIso(); X.ca_trade_seen = nowIso(); return ["ca_trade"]; }
      return [];
    });
  }

  /* ---------------- Bank of Canada Valet ---------------- */
  var VALET = { ca_trim: "CPI_TRIM", ca_median: "CPI_MEDIAN", ca_policy: "V39079" };
  function valet(keys) {
    keys = keys.filter(function (k) { return VALET[k] && mf(k); }); if (!keys.length) return Promise.resolve([]);
    var ids = keys.map(function (k) { return VALET[k]; });
    return getJSON("https://www.bankofcanada.ca/valet/observations/" + ids.join(",") + "/json?recent=14").then(function (j) {
      return keys.filter(function (k) { var id = VALET[k];
        var P = (j.observations || []).filter(function (o) { return o[id] && o[id].v != null && o[id].v !== ""; }).map(function (o) { return [o.d, +o[id].v]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
        return applyMacro(mf(k), transform(P, "level"), "Bank of Canada Valet " + id); });
    });
  }

  /* ---------------- BLS public API v1 (no key) ---------------- */
  var BLS = { us_cpi: ["CUSR0000SA0", "yoy"], us_core_cpi: ["CUSR0000SA0L1E", "yoy"], us_nfp: ["CES0000000001", "diff"], us_ur: ["LNS14000000", "level"], us_ahe: ["CES0500000003", "yoy"] };
  var blsLast = 0;
  function blsBudget(n) {   /* v1 without a key allows 25 requests a day per IP: keep 1 spare */
    var o; try { o = JSON.parse(localStorage.getItem("desk.bls") || "{}"); } catch (e) { o = {}; }
    if (o.d !== todayET()) o = { d: todayET(), n: 0 };
    if (o.n + n > 24) return false;
    o.n += n; try { localStorage.setItem("desk.bls", JSON.stringify(o)); } catch (e) {}
    return true;
  }
  function bls(keys) {
    keys = keys.filter(function (k) { return BLS[k] && mf(k); }); if (!keys.length) return Promise.resolve([]);
    if (Date.now() - blsLast < 60000 || !blsBudget(keys.length)) return Promise.resolve([]);   /* at most one round a minute */
    blsLast = Date.now();
    return Promise.all(keys.map(function (k) {
      return getJSON("https://api.bls.gov/publicAPI/v1/timeseries/data/" + BLS[k][0]).then(function (j) {
        var s = j && j.Results && j.Results.series && j.Results.series[0]; if (!s) return null;
        var P = s.data.filter(function (x) { return /^M(0[1-9]|1[0-2])$/.test(x.period) && x.value !== "-"; })
          .map(function (x) { return [x.year + "-" + x.period.slice(1) + "-01", +x.value]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
        return applyMacro(mf(k), transform(P, BLS[k][1]), "BLS API " + BLS[k][0]) ? k : null;
      }).catch(function () { return null; });
    })).then(function (r) { return r.filter(Boolean); });
  }

  /* ---------------- NY Fed (Fed funds target) ---------------- */
  function nyfed(keys) {
    if (keys.indexOf("us_policy") < 0 || !mf("us_policy")) return Promise.resolve([]);
    return getJSON("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/5.json").then(function (j) {
      var P = (j.refRates || []).map(function (r) { return [r.effectiveDate, +r.targetRateTo]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
      return applyMacro(mf("us_policy"), P, "NY Fed EFFR target range (upper)") ? ["us_policy"] : [];
    });
  }

  /* ---------------- US Treasury Monthly Treasury Statement ---------------- */
  function treasury() {
    var X = window.DATA.ext; if (!X || !X.us_deficit) return Promise.resolve([]);
    return getJSON("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1?filter=record_type_cd:eq:MTH&sort=-record_date&page[size]=24&fields=record_date,classification_desc,current_month_gross_rcpt_amt,current_month_gross_outly_amt,current_month_dfct_sur_amt")
      .then(function (j) {
        var rows = (j.data || []), rd = rows.length ? rows[0].record_date : null; if (!rd) return [];
        var mo = rd.slice(0, 7), r = rows.filter(function (x) { return x.record_date === rd && x.classification_desc === MONF[+rd.slice(5, 7) - 1]; })[0];
        if (!r) return [];
        var last = X.us_deficit.pts[X.us_deficit.pts.length - 1];
        if (last && last[0] >= mo) return [];
        [["us_deficit", -(+r.current_month_dfct_sur_amt)], ["us_receipts", +r.current_month_gross_rcpt_amt], ["us_outlays", +r.current_month_gross_outly_amt]].forEach(function (x) {
          var S = X[x[0]]; if (!S || !isFinite(x[1])) return; S.pts.push([mo, rnd(x[1] / 1e9, 3)]); if (S.pts.length > 30) S.pts.shift();
          S.direct = "US Treasury FiscalData MTS Table 1 · fetched in your browser " + clock(); });
        window.DATA.meta.asof.ext = nowIso(); X.us_deficit_seen = nowIso();
        return ["us_deficit"];
      });
  }

  /* ---------------- CFTC (port of cftc_grains / cftc_fx / _pos_kpis / _tag_prices / _fund_basis) ---------------- */
  var CFTC_G = { corn: "002602", wheat: "001602", soybeans: "005602" };
  function socrata(ds, code, n) {
    return getJSON("https://publicreporting.cftc.gov/resource/" + ds + ".json?cftc_contract_market_code=" + code + "&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=" + n)
      .then(function (rows) { if (!rows || !rows.length) throw new Error("no CFTC rows " + code); return rows.reverse(); });
  }
  var num = function (x) { var v = parseFloat(x); return isFinite(v) ? v : null; };
  function pctile(vals, x) { vals = vals.filter(function (v) { return v != null; }); return vals.length ? rnd(100 * vals.filter(function (v) { return v <= x; }).length / vals.length, 1) : null; }
  function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function pstdev(a) { var m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / a.length); }
  function field(row, re) { var k = Object.keys(row).filter(function (k) { return re.test(k); })[0]; return [k && num(row[k]) != null ? Math.trunc(num(row[k])) : null, k || null]; }
  function posKpis(rows, sl, ss, clp, csp, means) {
    var net = [], oi = [], comm = [], dates = [], used = {};
    rows.forEach(function (x) { var lo = num(x[sl]), sh = num(x[ss]); if (lo == null || sh == null) return;
      net.push(lo - sh); oi.push(num(x.open_interest_all) || 0); dates.push(x.report_date_as_yyyy_mm_dd.slice(0, 10));
      var cl = field(x, clp), cs = field(x, csp); used = { comm_long: cl[1], comm_short: cs[1] };
      comm.push(cl[0] != null && cs[0] != null ? cl[0] - cs[0] : null); });
    if (net.length < 10) return null;
    var n = net[net.length - 1], N = net.length, w52 = net.slice(-52), z52 = (n - mean(w52)) / (pstdev(w52) || 1);
    var w156 = net.slice(-156), mx = Math.max.apply(null, w156), mn = Math.min.apply(null, w156), cot = 100 * (n - mn) / ((mx - mn) || 1);
    var d1 = net[N - 1] - net[N - 2], vel = oi[N - 1] ? 100 * d1 / oi[N - 1] : null, sg = d1 > 0 ? 1 : d1 < 0 ? -1 : 0, streak = 0;
    for (var i = N - 1; i > 0; i--) { var d = net[i] - net[i - 1]; if (sg && ((d > 0 && sg > 0) || (d < 0 && sg < 0))) streak++; else break; }
    var doi = oi[N - 2] ? (oi[N - 1] / oi[N - 2] - 1) * 100 : null;
    var out = { date: dates[N - 1], net: n, oi: oi[N - 1], z52: rnd(z52, 2), cot3: rnd(cot, 1), d1: d1, vel_pct_oi: vel != null ? rnd(vel, 2) : null,
      streak: streak * sg, doi_pct: doi != null ? rnd(doi, 2) : null, z_hist: [], cot_hist: [], fields: used,
      net_hist: dates.slice(Math.max(0, N - 52)).map(function (d, j) { return [d, net[Math.max(0, N - 52) + j]]; }),
      oi_hist: dates.slice(Math.max(0, N - 26)).map(function (d, j) { return [d, oi[Math.max(0, N - 26) + j]]; }) };
    for (var k = Math.max(52, N - 26); k < N; k++) { var w = net.slice(k - 51, k + 1); out.z_hist.push([dates[k], rnd((net[k] - mean(w)) / (pstdev(w) || 1), 2)]);
      var w3 = net.slice(Math.max(0, k - 155), k + 1), a = Math.min.apply(null, w3), b = Math.max.apply(null, w3); out.cot_hist.push([dates[k], rnd(100 * (net[k] - a) / ((b - a) || 1), 1)]); }
    if (comm.every(function (c) { return c != null; }) && comm.length >= 10) {
      var spread = net.map(function (v, j) { return v - comm[j]; }), sw = spread.slice(-156), s1 = spread[N - 1], s52 = spread.slice(-52);
      out.comm_net = comm[N - 1]; out.comm_d1 = comm[N - 1] - comm[N - 2]; out.spread = s1;
      out.spread_idx = rnd(100 * (s1 - Math.min.apply(null, sw)) / ((Math.max.apply(null, sw) - Math.min.apply(null, sw)) || 1), 1);
      out.spread_z = rnd((s1 - mean(s52)) / (pstdev(s52) || 1), 2);
      out.comm_hist = dates.slice(Math.max(0, N - 52)).map(function (d, j) { return [d, comm[Math.max(0, N - 52) + j]]; }); }
    if (means) { var m1 = means[dates[N - 1]], m0 = means[dates[N - 2]]; if (m1 && m0) out.px_chg_pct = rnd((m1[0] / m0[0] - 1) * 100, 2); }
    return out;
  }
  function weekMeans(dates, closes) { var days = Object.keys(closes).sort(), out = {};
    dates.forEach(function (d, i) { var lo = i ? dates[i - 1] : new Date(Date.parse(d) - 7 * 864e5).toISOString().slice(0, 10);
      var w = days.filter(function (x) { return x > lo && x <= d; }).map(function (x) { return closes[x]; });
      if (w.length) out[d] = [rnd(mean(w), 5), w.length]; });
    return out; }
  function tagPrices(series, closes, old) {   /* keep the server's tags for known weeks; price new weeks from the desk's settles */
    var oldBy = {}; (old || []).forEach(function (x) { oldBy[x.date] = x; });
    var days = Object.keys(closes).sort(), wm = weekMeans(series.map(function (x) { return x.date; }), closes), prev = null, pm = null;
    series.forEach(function (x) { var o = oldBy[x.date];
      if (o && o.px != null) { ["px", "px_date", "px_chg", "px_mean", "px_n", "px_mean_chg"].forEach(function (f) { if (o[f] !== undefined) x[f] = o[f]; }); prev = o.px; pm = o.px_mean != null ? o.px_mean : pm; return; }
      var d = days.filter(function (dd) { return dd <= x.date; }).pop();
      if (d && (Date.parse(x.date) - Date.parse(d)) / 864e5 <= 5) { x.px = closes[d]; x.px_date = d; x.px_chg = prev != null ? rnd(x.px - prev, 5) : null; prev = x.px; }
      var m = wm[x.date]; if (m && (!o || o.px_mean == null)) { x.px_mean = m[0]; x.px_n = m[1]; x.px_mean_chg = pm != null ? rnd(m[0] - pm, 5) : null; pm = m[0]; } });
  }
  function basisStep(B0, rows, means, invert) {   /* incremental _fund_basis from the server's last state */
    if (!B0) return B0; var B = invert ? 1 / B0.avg_entry : B0.avg_entry, N = B0.net, used = B0.weeks, last = rows[rows.length - 1];
    if (!last || last.net === N && B0.date === last.date) return B0;
    var m = means[last.date]; if (!m) return B0;
    var P = invert ? 1 / m[0] : m[0], n = last.net;
    if (N == null || N === 0 || (N > 0) !== (n > 0)) B = P; else if (Math.abs(n) > Math.abs(N)) B = (Math.abs(N) * B + (Math.abs(n) - Math.abs(N)) * P) / Math.abs(n);
    return { avg_entry: rnd(invert ? 1 / B : B, 5), net: n, weeks: used + 1, since: B0.since, date: last.date };
  }
  function grainCloses(k) { var o = {}; ((window.DATA.grains[k] || {}).history || []).forEach(function (h) { o[h.d.slice(0, 10)] = h.s; }); return o; }
  function cftc() {
    var D = window.DATA, lastG = (D.grains.corn.cftc || []).slice(-1)[0];
    var jobs = Object.keys(CFTC_G).map(function (k) {
      return socrata("72hh-3qpy", CFTC_G[k], 160).then(function (rows) {
        var full = rows.map(function (r) { var lo = Math.trunc(num(r.m_money_positions_long_all)), sh = Math.trunc(num(r.m_money_positions_short_all));
          return { date: r.report_date_as_yyyy_mm_dd.slice(0, 10), long: lo, short: sh, net: lo - sh, oi: Math.trunc(num(r.open_interest_all) || 0) }; });
        var G = D.grains[k], oldSer = G.cftc || [];
        if (!oldSer.length || full[full.length - 1].date <= oldSer[oldSer.length - 1].date) return null;
        var ser = full.slice(-10).map(function (x) { return Object.assign({}, x); }), nets = full.map(function (x) { return x.net; }), cl = grainCloses(k);
        tagPrices(ser, cl, oldSer);
        var wm = weekMeans(full.map(function (x) { return x.date; }), cl), L = full[full.length - 1], old = G.cftc_stats || {};
        var st = { p1y: pctile(nets.slice(-52), L.net), p3y: pctile(nets, L.net), weeks_hist: nets.length, pct_oi: L.oi ? rnd(100 * L.net / L.oi, 1) : null,
          max3y: Math.max.apply(null, nets), min3y: Math.min.apply(null, nets), basis: basisStep(old.basis, full, wm, false),
          kpi: posKpis(rows, "m_money_positions_long_all", "m_money_positions_short_all", /^prod_merc_positions_long/, /^prod_merc_positions_short/, wm) };
        G.cftc = ser; G.cftc_stats = st; return L.date;
      });
    });
    var fx = socrata("gpe5-46if", "090741", 160).then(function (rows) {
      var P = D.fx.pos, r = rows[rows.length - 1], d = r.report_date_as_yyyy_mm_dd.slice(0, 10);
      if (P.series && P.series.length && d <= P.series[P.series.length - 1].date) return null;
      var f = function (x, a) { return Math.trunc(num(x[a])); };
      var nets = rows.map(function (x) { return f(x, "lev_money_positions_long") - f(x, "lev_money_positions_short"); });
      var lo = f(r, "lev_money_positions_long"), sh = f(r, "lev_money_positions_short"), oi = f(r, "open_interest_all"), net = lo - sh, pct = rnd(100 * net / oi, 1);
      var series = rows.slice(-10).map(function (x) { return { date: x.report_date_as_yyyy_mm_dd.slice(0, 10), long: f(x, "lev_money_positions_long"), short: f(x, "lev_money_positions_short"), net: f(x, "lev_money_positions_long") - f(x, "lev_money_positions_short") }; });
      var cl = {}; (D.fx.closes || []).forEach(function (c) { cl[c[0]] = c[1]; });
      tagPrices(series, cl, P.series);
      var all = rows.map(function (x, i) { return { date: x.report_date_as_yyyy_mm_dd.slice(0, 10), net: nets[i] }; });
      Object.assign(P, { net: net, long: lo, short: sh, oi: oi, pct_oi: pct, wow: net - nets[nets.length - 2],
        label: pct <= -20 ? "Extreme Crowded Short (High short-squeeze risk)" : pct <= -10 ? "Crowded Short" : pct >= 20 ? "Extreme Crowded Long" : pct >= 10 ? "Crowded Long" : "Balanced",
        p1y: pctile(nets.slice(-52), net), p3y: pctile(nets.slice(-156), net), series: series,
        kpi: posKpis(rows, "lev_money_positions_long", "lev_money_positions_short", /^dealer_positions_long/, /^dealer_positions_short/),
        basis: basisStep(P.basis, all, weekMeans(all.map(function (x) { return x.date; }), cl), true) });
      D.meta.asof.cftc_fx = d + "T15:30:00-04:00"; return d;
    });
    return Promise.all(jobs.concat([fx])).then(function (r) {
      var g = r.slice(0, 3).filter(Boolean);
      if (g.length) D.meta.asof.cftc_grains = g[0] + "T15:30:00-04:00";
      if (g.length || r[3]) { D.meta.cftc_direct = "CFTC Socrata (Disaggregated 72hh-3qpy, TFF gpe5-46if) · fetched in your browser " + clock() + " · price tags from the desk's settles"; return ["cftc"]; }
      return [];
    });
  }

  /* ---------------- dispatcher: called by the release watch with the awaiting keys ---------------- */
  var NAMES = { cftc: "CFTC Commitments of Traders", ca_trade: "Canada merchandise trade", us_deficit: "US federal budget (MTS)" };
  function check(keys) {
    var D = window.DATA; if (!D) return Promise.resolve(null);
    var macroKeys = keys.filter(function (k) { return mf(k); }), jobs = [];
    if (macroKeys.some(function (k) { return SC[k]; })) jobs.push(statcanMacro(macroKeys));
    if (macroKeys.some(function (k) { return /^ca_retail/.test(k); })) jobs.push(statcanRetail());
    if (macroKeys.some(function (k) { return VALET[k]; })) jobs.push(valet(macroKeys));
    if (macroKeys.some(function (k) { return BLS[k]; })) jobs.push(bls(macroKeys));
    if (macroKeys.indexOf("us_policy") > -1) jobs.push(nyfed(macroKeys));
    if (keys.indexOf("ca_trade") > -1) jobs.push(statcanTrade());
    if (keys.indexOf("us_deficit") > -1) jobs.push(treasury());
    if (keys.indexOf("cftc") > -1) jobs.push(cftc());
    if (!jobs.length) return Promise.resolve(null);
    return Promise.all(jobs.map(function (p) { return p.catch(function (e) { console.warn("[direct]", e); return "err"; }); })).then(function (res) {
      var got = [], errs = 0; res.forEach(function (r) { if (r === "err") errs++; else got = got.concat(r || []); });
      if (got.length) {
        window.DIRECT_LAST = Date.now(); window.renderAll();
        if (window.DESK_LIVE && window.DESK_LIVE.toast) window.DESK_LIVE.toast("<b>✓ Direct from source</b> — " + got.map(function (k) { var m = mf(k);
          return m ? (m.group === "us" ? "US " : "Canada ") + m.name + " " + window.mval(m, m.value) + " (" + m.period + ")" : (NAMES[k] || k); }).join(" · "));
      }
      return errs === res.length ? "err" : got;
    });
  }
  window.DIRECT = { check: check, sources: { statcan: SC, retail: SC_RETAIL, trade: SC_TRADE, valet: VALET, bls: BLS }, _posKpis: posKpis, _transform: transform };
})();
