/* macro-nav.js — Macro page, rebuilt around a country choice (Nov 13).
   Left: country tiles (US · Canada) like the grain tiles. Centre: Leading / Coincident / Lagging tabs, the data points in each
   (CPI, PPI, payrolls …) as a menu with a red dot when the number is out or due TODAY, and one card for the chosen data
   point that explains what it is and why it sits in that group. Every number comes from the desk's own macro data.
   The older dashboards (CPI deep dive, cycle & Fed policy, trade & fiscal, releases & consensus) stay under "Deep dives". */
(function (root) {
  var doc = root.document, P = doc.getElementById("panel-macro"); if (!P) return;
  /* categories as Trading Economics groups them (tradingeconomics.com/indicators) */
  var TE = [["main", "Main", "The four numbers every macro read starts with: growth, the policy rate, inflation and unemployment."],
    ["gdp", "GDP", "Output of the economy after inflation."], ["labour", "Labour", "Jobs, unemployment, wages and openings."],
    ["prices", "Prices", "Inflation at the consumer, producer and import level."], ["money", "Money", "Policy rates, credit and financial conditions."],
    ["business", "Business", "Factory, trade and purchasing-manager surveys."], ["consumer", "Consumer", "Household income, spending, credit and sentiment."],
    ["housing", "Housing", "Starts, permits and home sales — the most rate-sensitive part of the economy."], ["deep", "Deep dives", ""]];
  var TE_IDS = TE.map(function (x) { return x[0]; });
  function teOf(k) {
    return /policy/.test(k) ? "money" : /gdp/.test(k) ? "gdp" : /cpi|pce|ppi|trim|median|import|ippi/.test(k) ? "prices" : /_ur$|nfp|emp|ahe|hours|jolts|claims|cclaims|adp|udur|vac/.test(k) ? "labour" :
      /starts|permits|nhs/.test(k) ? "housing" : /nfci|busloans/.test(k) ? "money" : /umich|pinc|pspend|ccinc/.test(k) ? "consumer" : "business";
  }
  var MAIN = { us: ["us_gdp", "us_policy", "us_cpi", "us_ur"], ca: ["ca_gdp", "ca_policy", "ca_cpi", "ca_ur"] };
  var KEY = "desk.mnav", S = { c: "us", g: "main", k: {}, r: "2", v: "both" };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || "{}"); if (sv.c) S.c = sv.c; if (sv.g && TE_IDS.indexOf(sv.g) >= 0) S.g = sv.g; if (sv.k) S.k = sv.k; if (sv.r) S.r = sv.r; if (sv.v) S.v = sv.v; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return DeskCore.esc(s); }
  var TZ = "America/Toronto";
  var DF = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  function dayET(t) { return DF.format(new Date(t)); }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) + " ET"; }
  function when(t) { return new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET"; }
  var COUNTRY = { us: { name: "United States", short: "US", cc: "us" }, ca: { name: "Canada", short: "Canada", cc: "ca" } };
  var GROUPS = [["lead", "Leading", "Turn before the economy does — early warning of the next phase of the cycle."],
    ["coin", "Coincident", "Move with the economy — they tell you where activity is right now."],
    ["lag", "Lagging", "Confirm a turn after it has happened — inflation and unemployment react last, and they are what central banks target."],
    ["deep", "Deep dives", ""]];
  /* classification follows the Conference Board's leading / coincident / lagging framework, extended to the series the desk carries */
  var CLS = {
    us_claims: "lead", us_permits: "lead", us_starts: "lead", us_ism: "lead", us_ism_svc: "lead", us_umich: "lead", us_hours: "lead", us_nfci: "lead", us_durable: "lead", us_factory: "lead", us_nhs: "lead", us_jolts: "lead",
    us_nfp: "coin", us_adp: "coin", us_indpro: "coin", us_pinc: "coin", us_pspend: "coin", us_retail: "coin", us_gdp: "coin",
    us_ur: "lag", us_udur: "lag", us_cclaims: "lag", us_cpi: "lag", us_core_cpi: "lag", us_pce: "lag", us_core_pce: "lag", us_ppi: "lag", us_import: "lag", us_ahe: "lag", us_isratio: "lag", us_busloans: "lag", us_ccinc: "lag",
    ca_permits: "lead", ca_starts: "lead", ca_ivey: "lead", ca_vac: "lead",
    ca_emp: "coin", ca_gdp: "coin", ca_mfg: "coin", ca_whl: "coin",
    ca_ur: "lag", ca_cpi: "lag", ca_trim: "lag", ca_median: "lag", ca_ippi: "lag"
  };
  var TYPE = { infl: "Inflation", lab: "Labour", act: "Activity", house: "Housing", sent: "Sentiment & surveys", fin: "Credit & financial" };
  function typeOf(k) { return /cpi|pce|ppi|trim|median|import|ippi/.test(k) ? "infl" : /_ur$|nfp|emp|ahe|hours|jolts|claims|cclaims|adp|udur|vac/.test(k) ? "lab" : /starts|permits|nhs/.test(k) ? "house" : /umich|ism|ivey/.test(k) ? "sent" : /nfci|busloans|ccinc/.test(k) ? "fin" : "act"; }
  var WHAT = {
    us_cpi: "Consumer Price Index — the change in prices households pay for a fixed basket of goods and services. The headline inflation rate.",
    us_core_cpi: "CPI without food and energy, the two most volatile parts — a cleaner read of underlying inflation.",
    us_pce: "PCE price index — the Fed's preferred inflation gauge; broader than CPI and weights shift as spending shifts.",
    us_core_pce: "PCE prices without food and energy — the number the Fed's 2% target is judged against.",
    us_ppi: "Producer Price Index — prices businesses receive. Cost pressure here can pass through to consumer prices later.",
    us_import: "Prices of goods brought into the US — moves with the dollar and global commodity prices.",
    us_nfp: "Nonfarm payrolls — jobs added or lost last month. The single most market-moving US release.",
    us_ur: "Unemployment rate — share of the labour force without a job and looking. Rises after a downturn has started.",
    us_claims: "Initial jobless claims — new filings for unemployment benefits each week. The earliest hard read on layoffs.",
    us_cclaims: "Continuing claims — people still receiving benefits. Rising means the unemployed are finding work more slowly.",
    us_ahe: "Average hourly earnings — wage growth. Sustained fast wage gains feed services inflation.",
    us_jolts: "Job openings (JOLTS) — how many jobs employers are trying to fill. Falling openings usually precede slower hiring.",
    us_adp: "ADP private payrolls — a private-sector estimate of hiring, released two days before the official jobs report.",
    us_hours: "Average weekly hours in manufacturing — firms cut hours before they cut jobs, so this turns early.",
    us_udur: "Average weeks unemployed — stretches out late in a downturn, after layoffs have peaked.",
    us_retail: "Retail sales — month-on-month change in what consumers spend in stores and online.",
    us_gdp: "Real GDP — total output of the economy after inflation, annualised quarter-on-quarter.",
    us_indpro: "Industrial production — output of factories, mines and utilities.",
    us_pinc: "Personal income — what households earn from wages, investments and transfers.",
    us_pspend: "Personal spending — consumer outlays, about two-thirds of the US economy.",
    us_factory: "Factory orders — new orders for manufactured goods; orders lead production.",
    us_durable: "Durable goods orders — orders for long-lasting goods (machinery, aircraft). Capital-spending signal.",
    us_starts: "Housing starts — new homes begun. Housing turns early in the cycle because it is rate-sensitive.",
    us_permits: "Building permits — approvals for future construction; one of the most reliable leading series.",
    us_nhs: "New home sales — signed contracts on newly built homes; reacts quickly to mortgage rates.",
    us_ism: "ISM manufacturing PMI — purchasing managers' survey; above 50 means factory activity is expanding.",
    us_ism_svc: "ISM services PMI — the same survey for services, the larger part of the economy.",
    us_umich: "University of Michigan consumer sentiment — how households feel about finances and the economy.",
    us_nfci: "Chicago Fed financial conditions — below zero means credit is easier than average; tightening often leads slowdowns.",
    us_isratio: "Inventories-to-sales ratio — a rising ratio means goods are piling up; it peaks after demand has slowed.",
    us_busloans: "Commercial & industrial loans — bank lending to business; keeps growing for a while after the economy turns.",
    us_ccinc: "Consumer credit relative to income — household leverage; adjusts slowly, after the cycle.",
    ca_cpi: "Canada Consumer Price Index — the headline inflation rate the Bank of Canada targets at 2%.",
    ca_trim: "CPI-trim — strips out the most extreme price moves each month; one of the BoC's preferred core measures.",
    ca_median: "CPI-median — the middle price change in the basket; the BoC's other preferred core measure.",
    ca_ippi: "Industrial product prices — prices manufacturers get at the factory gate; early cost pressure.",
    ca_emp: "Employment change — jobs added or lost last month (Labour Force Survey).",
    ca_ur: "Unemployment rate — Canada's share of the labour force without work.",
    ca_vac: "Job vacancies — unfilled positions; fewer openings usually come before slower hiring.",
    ca_gdp: "Real GDP — monthly output of the Canadian economy after inflation.",
    ca_mfg: "Manufacturing sales — factory shipments; a direct read on goods activity.",
    ca_whl: "Wholesale sales — sales by distributors to retailers and businesses.",
    ca_starts: "Housing starts — new homes begun (CMHC); rate-sensitive and early in the cycle.",
    ca_permits: "Building permits — value of approved construction; points to activity months ahead.",
    ca_ivey: "Ivey PMI — purchasing managers' survey; above 50 means activity is expanding."
  };
  function mAll() { return root.macroAll ? macroAll() : ((root.DATA && DATA.macro) || []); }
  function relTime(m) {
    var seen = m.seen_at ? Date.parse(m.seen_at) : null, L = [], C = DATA.release_cal && DATA.release_cal[m.key], H = DATA.release_hist && DATA.release_hist[m.key];
    (H || []).concat((C && C.dates) || []).forEach(function (x) { var p = x.split("T"), d = p[0].split("-"), h = (p[1] || "08:30").split(":"); L.push(root.zonedMs ? zonedMs(+d[0], +d[1], +d[2], +h[0], +h[1], TZ) : Date.parse(x)); });
    var now = Date.now(), past = L.filter(function (t) { return t <= now; }).sort(function (a, b) { return b - a; }), fut = L.filter(function (t) { return t > now; }).sort(function (a, b) { return a - b; });
    var rel = past.filter(function (t) { return !seen || t <= seen + 5 * 6e4; })[0] || seen || null;
    return { rel: rel, next: fut[0] || null, todayDue: fut.filter(function (t) { return dayET(t) === dayET(now); })[0] || null, todayOut: past.filter(function (t) { return dayET(t) === dayET(now); })[0] || null };
  }
  function items(c, g) {
    return mAll().filter(function (m) { if (m.group !== c || (m.chart_only && !/policy|gdpq/.test(m.key))) return false; return g === "main" ? MAIN[c].indexOf(m.key) >= 0 : teOf(m.key) === g; }).map(function (m) {
      var t = relTime(m), seenToday = m.freq !== "D" && m.seen_at && dayET(Date.parse(m.seen_at)) === dayET(Date.now());
      return { m: m, t: t, today: !!(t.todayOut || t.todayDue || seenToday), out: !!(t.todayOut || seenToday), due: t.todayDue };
    }).sort(function (a, b) { return g === "main" ? MAIN[c].indexOf(a.m.key) - MAIN[c].indexOf(b.m.key) : (b.today - a.today) || (cyc(a.m.key) - cyc(b.m.key)); });
  }
  function cyc(k) { return { lead: 0, coin: 1, lag: 2 }[CLS[k]] != null ? { lead: 0, coin: 1, lag: 2 }[CLS[k]] : 3; }
  function todayCount(c) { var n = 0; TE_IDS.forEach(function (g) { if (g !== "main" && g !== "deep") n += items(c, g).filter(function (x) { return x.today; }).length; }); return n; }
  function fv(m, v) { if (v == null || v === "") return "—"; v = +v; return root.mval ? mval(m, v) : v.toFixed(m.dec || 1); }
  /* history for the chosen range: the ~5-year series (ISO dates) when the desk holds it, else the 24 latest readings */
  function series(m, yrs) {
    var L = m.long || [], H = m.hist24 || m.history || [];
    if (L.length > 2 && /^\d{4}-\d{2}/.test(L[0][0])) {
      var cut = new Date(); cut.setFullYear(cut.getFullYear() - yrs); var c = cut.toISOString().slice(0, 10);
      var out = L.filter(function (x) { return x[0] >= c; }).map(function (x) { return [x[0], x[1], true]; });
      var span = (Date.parse(L[L.length - 1][0]) - Date.parse(L[0][0])) / 31557600000;
      return { pts: out, full: span >= yrs - 0.6 || yrs <= 2 };
    }
    var per = m.freq === "W" ? 52 : m.freq === "Q" ? 4 : m.freq === "D" ? 12 : 12, n = per * yrs;
    return { pts: H.slice(-n).map(function (x) { return [x[0], x[1], false]; }), full: H.length >= n };
  }
  var FQ = "M";
  function lab(x) { if (!x[2]) return x[0]; var d = new Date(x[0] + "T12:00:00Z"), yy = "'" + String(d.getUTCFullYear()).slice(2);
    if (FQ === "Q") return "Q" + (Math.floor(d.getUTCMonth() / 3) + 1) + " " + yy;
    var mo = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); return FQ === "W" || FQ === "D" ? mo + " " + d.getUTCDate() + " " + yy : mo + " " + yy; }
  function chart(P, m) {
    var v = P.map(function (x) { return x[1]; }); if (v.length < 2) return '<p class="note">Not enough history on file.</p>';
    var n = v.length, W = 820, H = 250, L0 = 50, R0 = 64, T0 = 22, B0 = 28, lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), pad = (hi - lo) * 0.12 || 1, lo2 = lo - pad, hi2 = hi + pad;
    var X = function (i) { return L0 + i / (n - 1) * (W - L0 - R0); }, Y = function (y) { return T0 + (hi2 - y) / (hi2 - lo2) * (H - T0 - B0); };
    var g = "", d = m.dec != null ? +m.dec : 1, F = "JetBrains Mono,monospace";
    for (var k = 0; k <= 4; k++) { var yv = hi2 - (hi2 - lo2) * k / 4, yy = Y(yv); g += '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="#161616"/><text x="' + (L0 - 6) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end" fill="#666" font-size="10" font-family="' + F + '">' + yv.toFixed(d) + "</text>"; }
    if (lo2 < 0 && hi2 > 0) g += '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#444"/>';
    var step = Math.max(1, Math.ceil(n / 8));
    P.forEach(function (x, i) { if ((i % step === 0 && n - 1 - i >= step * 0.6) || i === n - 1) g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" fill="#777" font-size="10" font-family="' + F + '">' + esc(lab(x)) + "</text>"; });
    /* mean (dashed) and least-squares trend (dotted) over the range shown */
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / n, sx = 0, sy = 0, sxy = 0, sxx = 0;
    v.forEach(function (y, i) { sx += i; sy += y; sxy += i * y; sxx += i * i; });
    var sl = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), ic = (sy - sl * sx) / n;
    g += '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + Y(mean).toFixed(1) + '" y2="' + Y(mean).toFixed(1) + '" stroke="#38b6c9" stroke-width="1.2" stroke-dasharray="6 4"/>' +
      '<text x="' + (W - R0 + 4) + '" y="' + (Y(mean) + 3.5).toFixed(1) + '" fill="#38b6c9" font-size="10" font-family="' + F + '">avg ' + mean.toFixed(d) + "</text>";
    g += '<line x1="' + X(0).toFixed(1) + '" x2="' + X(n - 1).toFixed(1) + '" y1="' + Y(ic).toFixed(1) + '" y2="' + Y(ic + sl * (n - 1)).toFixed(1) + '" stroke="#a78bfa" stroke-width="1.4" stroke-dasharray="2 3"/>';
    var pts = v.map(function (y, i) { return X(i).toFixed(1) + "," + Y(y).toFixed(1); }).join(" ");
    /* value on every point when they fit; otherwise every few points plus the high, the low and the latest */
    var imax = v.indexOf(hi), imin = v.indexOf(lo), every = n <= 26 ? 1 : Math.ceil(n / 14);
    var dots = P.map(function (x, i) {
      var show = i % every === 0 || i === n - 1 || i === imax || i === imin, up = i === 0 || x[1] >= v[i - 1];
      var ty = Y(x[1]) + (up ? -8 : 15); if (ty < T0 - 6) ty = Y(x[1]) + 15; if (ty > H - B0 + 4) ty = Y(x[1]) - 8;
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x[1]).toFixed(1) + '" r="' + (i === n - 1 ? 4 : n > 80 ? 1.3 : 2.6) + '" fill="#d9b46a"><title>' + esc(lab(x)) + ": " + x[1].toFixed(d) + "</title></circle>" +
        (show ? '<text x="' + X(i).toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="middle" fill="' + (i === n - 1 ? "#fff" : "#c9b07a") + '" font-size="' + (i === n - 1 ? 11 : 9.5) + '" font-family="' + F + '" paint-order="stroke" stroke="#000" stroke-width="3">' + x[1].toFixed(d) + "</text>" : "");
    }).join("");
    var trend = sl * (n - 1), per = { M: "month", W: "week", Q: "quarter", D: "month" }[FQ] || "period";
    return '<div class="mn2-lg"><span><i style="background:#d9b46a"></i>' + esc(m.name) + '</span><span><i class="ds" style="border-color:#38b6c9"></i>Average ' + mean.toFixed(d) + '</span><span><i class="dt" style="border-color:#a78bfa"></i>Trend ' + (trend >= 0 ? "+" : "−") + Math.abs(trend).toFixed(d) + " over the range (" + (sl >= 0 ? "+" : "−") + Math.abs(sl).toFixed(d + 1) + " per " + per + ")</span></div>" +
      '<svg class="mn2-ch2" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(m.name) + ' history with average and trend"><polyline fill="none" stroke="#d9b46a" stroke-width="1.8" points="' + pts + '"/>' + g + dots + "</svg>";
  }
  /* periods as columns, values (and change) as rows; newest on the right, scrolled into view */
  function table(P, m) {
    var d = m.dec != null ? +m.dec : 1;
    var head = P.map(function (x) { return "<th>" + esc(lab(x)) + "</th>"; }).join("");
    var val = P.map(function (x, i) { return '<td class="' + (i === P.length - 1 ? "lt" : "") + '"><b>' + x[1].toFixed(d) + "</b></td>"; }).join("");
    var chg = P.map(function (x, i) { var pv = P[i - 1], ch = pv ? x[1] - pv[1] : null; if (ch != null && Math.abs(ch) < Math.pow(10, -d) / 2) ch = 0; return '<td class="' + (ch == null ? "" : ch > 0 ? "up" : ch < 0 ? "dn" : "") + '">' + (ch == null ? "—" : (ch > 0 ? "+" : ch < 0 ? "−" : "") + Math.abs(ch).toFixed(d)) + "</td>"; }).join("");
    return '<div class="mn2-tw" data-mn2scroll><table class="mn2-tb no-tx"><thead><tr><th class="rh">Period</th>' + head + '</tr></thead><tbody><tr><th class="rh">Value</th>' + val + '</tr><tr><th class="rh">Change</th>' + chg + "</tr></tbody></table></div>";
  }
  /* "what the latest release says": every line is computed from the numbers on file — no outside opinion */
  function readOut(m, cons, gd, cg) {
    var d = m.dec != null ? +m.dec : 1, u = m.unit === "K" ? "K" : (m.unit || ""), f = function (x) { return (+x).toFixed(d) + u; }, du = u === "%" ? " pp" : u;
    var v = +m.value, pr = m.prior != null ? +m.prior : null, five = series(m, 5).pts.map(function (x) { return x[1]; }), out = [];
    if (pr != null && isFinite(v)) {
      var ch = v - pr, word = Math.abs(ch) < Math.pow(10, -d) / 2 ? "was unchanged at " + f(v) : (ch > 0 ? "rose" : "fell") + " to " + f(v) + " from " + f(pr);
      out.push(esc(m.name) + " " + word + (m.freq === "W" ? " in the week to " : " in ") + esc(m.period || "the latest period") + ".");
    }
    if (cons != null) { var sp = v - cons; out.push(Math.abs(sp) < Math.pow(10, -d) / 2 ? "In line with the " + f(cons) + " consensus." : (sp > 0 ? "Above" : "Below") + " the " + f(cons) + " consensus by " + Math.abs(sp).toFixed(d) + du +
      (gd ? " — a " + ((gd === "down") === (sp > 0) ? (gd === "down" ? "hotter-than-expected" : "weaker-than-expected") : (gd === "down" ? "softer-than-expected" : "stronger-than-expected")) + " print." : ".")); }
    if (five.length >= 8) {
      var lo = Math.min.apply(null, five), hi = Math.max.apply(null, five), avg = five.reduce(function (a, b) { return a + b; }, 0) / five.length;
      var rank = five.filter(function (x) { return x <= v; }).length / five.length, yrs = Math.max(1, Math.round(five.length / ({ Q: 4, W: 52 }[m.freq] || 12)));
      out.push((v >= hi ? "The highest reading in " + yrs + " years" : v <= lo ? "The lowest reading in " + yrs + " years" : "Higher than " + Math.round(rank * 100) + "% of readings over the last " + yrs + " years") +
        " (range " + f(lo) + " to " + f(hi) + "), and " + (Math.abs(v - avg) < Math.pow(10, -d) / 2 ? "right at" : v > avg ? Math.abs(v - avg).toFixed(d) + du + " above" : Math.abs(v - avg).toFixed(d) + du + " below") + " its " + f(avg) + " average.");
      var run = 0, dirn = 0; for (var i = five.length - 1; i > 0; i--) { var c = Math.sign(five[i] - five[i - 1]); if (!c) break; if (!dirn) dirn = c; if (c !== dirn) break; run++; }
      if (run >= 3) out.push(run + " " + (dirn > 0 ? "rises" : "declines") + " in a row.");
    }
    /* what that means, by kind of indicator */
    var k = m.key, mean = "";
    if (/cpi|pce|trim|median/.test(k) && /y\/y/.test(m.measure || "")) mean = v > 2.05 ? "Still above the 2% inflation target" + (pr != null && v < pr ? ", though easing" : pr != null && v > pr ? " and moving away from it" : "") + " — pressure on the " + (m.group === "us" ? "Fed" : "Bank of Canada") + " to keep rates restrictive." : "At or below the 2% target — room for the " + (m.group === "us" ? "Fed" : "Bank of Canada") + " to ease if growth slows.";
    else if (/ppi|ippi|import/.test(k)) mean = (pr != null && v > pr ? "Pipeline cost pressure is building" : "Pipeline cost pressure is easing") + " — producer and import prices tend to reach consumer prices with a lag.";
    else if (/_ur$/.test(k)) mean = pr != null ? (v > pr ? "A rising jobless rate is how a slowdown shows up in the labour market." : v < pr ? "A falling jobless rate points to a still-tight labour market." : "A steady jobless rate: no turn yet.") : "";
    else if (/nfp|emp|adp/.test(k)) mean = v < 0 ? "Job losses — a sign of a weakening economy." : "Hiring continues; watch the trend against labour-force growth.";
    else if (/claims/.test(k)) mean = pr != null ? (v > pr ? "More people filing — an early warning sign for layoffs." : "Fewer filings — layoffs remain contained.") : "";
    else if (/ism|ivey/.test(k)) mean = (v >= 50 ? "Above 50: activity is expanding" : "Below 50: activity is contracting") + (pr != null ? (v > pr ? ", and the pace picked up." : v < pr ? ", and the pace slowed." : ".") : ".");
    else if (/gdp/.test(k)) mean = v < 0 ? "The economy shrank in the period." : v >= 2 ? "Growth at or above its long-run pace." : "Growth below its long-run pace.";
    else if (/policy/.test(k)) mean = "The policy rate sets the cost of money; every other number on this page is read against it.";
    else if (/starts|permits|nhs/.test(k)) mean = pr != null ? (v > pr ? "Housing picked up — usually a sign that rates are not biting harder." : "Housing softened — the most rate-sensitive part of the economy is slowing.") : "";
    else if (cg === "lead") mean = pr != null ? (v > pr ? "A leading indicator turning up hints at firmer activity ahead." : "A leading indicator turning down hints at softer activity ahead.") : "";
    if (mean) out.push(mean);
    return out.length ? '<div class="mn2-ro"><b>What the latest release says</b><ul>' + out.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>" : "";
  }
  function spark(h) {
    var v = (h || []).map(function (x) { return x[1]; }).filter(function (x) { return x != null; }); if (v.length < 2) return "";
    var W = 520, H = 120, lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), rg = (hi - lo) || 1;
    var pts = v.map(function (y, i) { return (8 + i / (v.length - 1) * (W - 16)).toFixed(1) + "," + (10 + (hi - y) / rg * (H - 20)).toFixed(1); });
    var last = pts[pts.length - 1].split(",");
    return '<svg class="mn2-sp" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Last ' + v.length + ' readings"><polyline fill="none" stroke="#d9b46a" stroke-width="2" vector-effect="non-scaling-stroke" points="' + pts.join(" ") + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" fill="#d9b46a"/></svg>' +
      '<div class="mn2-spx"><span>' + esc(h[0][0]) + '</span><span>low ' + lo.toFixed(2) + " · high " + hi.toFixed(2) + '</span><span>' + esc(h[h.length - 1][0]) + "</span></div>";
  }
  /* open(key): show one data point (country, group and card) — used by "See it" on the Events tab. The card is
     flashed for a moment, and keeps the flash if the page redraws meanwhile. */
  var FL = { k: null, t: 0 };
  function open(key) {
    var m = mAll().filter(function (x) { return x.key === key; })[0]; if (!m || !MAIN[m.group]) return false;
    var c = m.group, g = MAIN[c].indexOf(key) >= 0 ? "main" : teOf(key);
    if (!items(c, g).some(function (x) { return x.m.key === key; })) return false;
    S.c = c; S.g = g; S.k[c + g] = key; FL = { k: key, t: Date.now() + 2600 }; save(); render(); return true;
  }
  function cardHTML(x, g) {
    var m = x.m, C = root.consensusFor ? consensusFor(m) : null, cons = C && C.consensus != null ? +C.consensus : null, v = m.value != null ? +m.value : null;
    var sur = cons != null && v != null ? v - cons : null, cg = CLS[m.key] || (/policy/.test(m.key) ? "lag" : "coin"), G = GROUPS.filter(function (q) { return q[0] === cg; })[0];
    var gd = /down|heat/.test(m.good || "") ? "down" : /up/.test(m.good || "") ? "up" : null, hot = gd === "down" ? sur > 0 : gd === "up" ? sur < 0 : null;
    var stat = x.out ? '<span class="mn2-live"><i></i>Released today ' + (x.t.todayOut ? hm(x.t.todayOut) : "") + "</span>" : x.due ? '<span class="mn2-live due"><i></i>Due today ' + hm(x.due) + "</span>" : "";
    var kv = function (k, val, cls) { return '<div class="mn2-kv"><span>' + k + "</span><b" + (cls ? ' class="' + cls + '"' : "") + ">" + val + "</b></div>"; };
    return '<div class="mn2-card' + (FL.k === m.key && Date.now() < FL.t ? " flash-find" : "") + '" data-mkey="' + esc(m.key) + '"><div class="mn2-ch"><span class="mn2-cn">' + (root.flag ? flag(COUNTRY[m.group].cc, 16) : "") + " " + esc(COUNTRY[m.group].short + " " + m.name) + "</span>" +
      '<span class="mn2-tag ' + cg + '">' + G[1] + "</span><span class=\"mn2-ty\">" + TYPE[typeOf(m.key)] + "</span>" + stat + '<button type="button" class="mn2-hist mn2-histtop" data-mn2hist="' + esc(m.key) + '">Full history →</button>' + "</div>" +
      '<div class="mn2-big">' + fv(m, v) + ' <small>' + esc(m.measure || "") + " · " + esc(m.period || "") + "</small></div>" +
      readOut(m, cons, gd, cg) +
      '<div class="mn2-kvs">' + kv("Consensus", cons != null ? fv(m, cons) : "—") + kv("Prior", fv(m, m.prior)) + kv("Surprise", sur != null ? (sur > 0 ? "+" : "−") + Math.abs(sur).toFixed(m.dec || 1) : "—", hot == null || sur == null || !sur ? "" : hot ? "dn" : "up") +
        kv("Released", x.t.rel ? when(x.t.rel) : "—") + kv("Next", x.t.next ? when(x.t.next) : "not yet scheduled") + "</div>" +
      (function () { FQ = m.freq || "M"; var yrs = +S.r, SR = series(m, yrs);
        var ctl = '<div class="mn2-ctl"><span class="mn2-sw">' + ["1", "2", "5"].map(function (r) { return '<button type="button" data-mn2r="' + r + '" aria-pressed="' + (S.r === r) + '">' + r + "Y</button>"; }).join("") + "</span>" +
          '<span class="mn2-sw">' + [["chart", "Chart"], ["table", "Table"], ["both", "Both"]].map(function (x) { return '<button type="button" data-mn2v="' + x[0] + '" aria-pressed="' + (S.v === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</span>" +
          '<span class="mn2-n">' + SR.pts.length + " readings" + (SR.full ? "" : " · full " + yrs + "-year history arrives with the next data refresh") + "</span></div>";
        return ctl + '<div class="mn2-vw ' + S.v + '">' + (S.v !== "table" ? chart(SR.pts, m) : "") + (S.v !== "chart" ? table(SR.pts, m) : "") + "</div>"; })() +
      '<div class="mn2-edu"><div><b>What it is</b><p>' + esc(WHAT[m.key] || m.name) + "</p></div><div><b>Why it is " + G[1].toLowerCase() + "</b><p>" + esc(G[2]) + "</p></div>" +
        '<div><b>How to read it</b><p>' + (gd === "down" ? "Lower is better for the economy's balance — a print above consensus is a hot (hawkish) surprise." : gd === "up" ? "Higher is better — a print above consensus is a positive surprise for growth." : "Read it against its own trend and the consensus.") + "</p></div></div>" +
      '<div class="mn2-ft">Source: ' + esc(m.src || "—") + (m.seen_at ? " · on the desk " + when(Date.parse(m.seen_at)) : "") + '</div></div>';
  }
  /* today's agenda as one clean timeline: released items dimmed with ✓, the next one highlighted with a countdown */
  function inT(ms) { var m = Math.round(ms / 60000); return m < 60 ? "in " + m + "m" : "in " + Math.floor(m / 60) + "h " + ("0" + m % 60).slice(-2) + "m"; }
  function todayStrip(c) {
    var ev = []; try { ev = (root.fxEvList ? fxEvList() : []).filter(function (e) { return dayET(e.t) === dayET(Date.now()) && (e.ccy === (c === "us" ? "USD" : "CAD")); }); } catch (e) {}
    if (!ev.length) return '<div class="mn3-ag"><span class="mn3-agk">Today</span><span class="mn3-none">No ' + COUNTRY[c].short + " releases on today’s calendar.</span></div>";
    var now = Date.now(); ev.sort(function (a, b) { return a.t - b.t; });
    var nxt = ev.filter(function (e) { return e.t > now; })[0], done = ev.filter(function (e) { return e.t <= now; }).length;
    return '<div class="mn3-ag"><span class="mn3-agk">Today<small>' + done + " of " + ev.length + ' out</small></span><div class="mn3-tl">' + ev.map(function (e) {
      var past = e.t <= now, isN = e === nxt, nm = String(e.label).replace(/^(USD|CAD)\s+/, "");
      return '<div class="mn3-ev' + (past ? " out" : "") + (isN ? " nx" : "") + '" title="' + esc(nm + " · " + hm(e.t) + (e.impact === "High" ? " · high impact" : "")) + '">' +
        '<span class="mn3-tm">' + esc(hm(e.t).replace(" ET", "")) + (past ? ' <b class="ok">✓</b>' : isN ? ' <b class="cd">' + inT(e.t - now) + "</b>" : "") + "</span>" +
        '<span class="mn3-nm">' + (e.impact === "High" ? '<i class="hi" title="High impact"></i>' : "") + esc(nm) + "</span></div>"; }).join("") + "</div></div>";
  }
  function render() {
    if (!root.DATA || !DATA.macro) return;
    var L = P.querySelector(":scope > .layout"); if (!L) return;
    var box = P.querySelector(":scope > .mn2"); if (!box) { box = doc.createElement("div"); box.className = "mn2"; P.insertBefore(box, L); }
    var deep = S.g === "deep"; L.classList.toggle("mn2-hide", !deep); box.classList.toggle("deep", deep);
    var left = '<aside class="mn2-left"><div class="gr-col-h">Countries</div>' + ["us", "ca"].map(function (c) {
      var n = todayCount(c), on = S.c === c; return '<button type="button" class="mn2-ct' + (on ? " on" : "") + '" data-mn2c="' + c + '">' + (on ? '<em class="gr-selb">SELECTED</em>' : "") +
        '<span class="mn2-ctn">' + (root.flag ? flag(COUNTRY[c].cc, 22) : "") + " " + COUNTRY[c].name + "</span>" +
        '<span class="mn2-ctc">' + mAll().filter(function (m) { return m.group === c && !m.chart_only && CLS[m.key]; }).length + " indicators</span>" +
        (n ? '<span class="mn2-ctt"><i></i>' + n + " out or due today</span>" : '<span class="mn2-ctt none">nothing scheduled today</span>') + "</button>"; }).join("") + "</aside>";
    var tabs = '<div class="mn2-tabs" role="tablist">' + TE.filter(function (g) { return g[0] === "deep" || items(S.c, g[0]).length; }).map(function (g) { var t = g[0] !== "deep" && items(S.c, g[0]).some(function (x) { return x.today; });
      return '<button type="button" class="st-b" data-mn2g="' + g[0] + '" aria-selected="' + (S.g === g[0]) + '">' + g[1] + (t ? '<i class="mn2-dot"></i>' : "") + "</button>"; }).join("") + "</div>";
    var main = "";
    if (!deep) {
      var IT = items(S.c, S.g), sel = IT.filter(function (x) { return x.m.key === S.k[S.c + S.g]; })[0] || IT[0];
      var byT = {}; IT.forEach(function (x) { var t = S.g === "main" ? "main" : (CLS[x.m.key] || (/policy/.test(x.m.key) ? "pol" : "coin")); (byT[t] = byT[t] || []).push(x); });
      var TL = { main: "Headline", lead: "Leading", coin: "Coincident", lag: "Lagging", pol: "Policy" };
      main = '<div class="mn2-g"><nav class="mn2-list" aria-label="Data points">' + Object.keys(byT).map(function (t) {
        return '<div class="mn2-lh">' + TL[t] + "</div>" + byT[t].map(function (x) { return '<button type="button" class="mn2-it' + (x === sel ? " on" : "") + '" data-mn2k="' + x.m.key + '"><span>' + esc(x.m.name) + "</span>" +
          (x.today ? '<i class="mn2-dot' + (x.out ? "" : " due") + '" title="' + (x.out ? "Released today" : "Due today " + (x.due ? hm(x.due) : "")) + '"></i>' : "") + "</button>"; }).join(""); }).join("") +
        '<div class="mn2-key"><i class="mn2-dot"></i> out today <i class="mn2-dot due"></i> due today</div></nav>' +
        '<div class="mn2-c">' + (sel ? cardHTML(sel, S.g) : '<p class="note">No indicators in this group.</p>') + (sel && root.REGIONS ? REGIONS.forKey(sel.m.key) : "") + "</div></div>";
    }
    box.innerHTML = '<div class="mn2-lay">' + left + '<div class="mn2-main"><div class="tile wide mn2-head mn3-head"><div class="mn3-ttl"><h2>' + COUNTRY[S.c].name + '<span>Macro</span></h2><span class="mn3-sub" title="Categories as Trading Economics groups them · each data point tagged leading, coincident or lagging · red dot = released or due today">Trading Economics categories · leading / coincident / lagging tags · <i class="mn3-dot"></i> out or due today</span></div>' + todayStrip(S.c) + tabs + "</div>" + main + "</div></div>";
    toEnd();
    var tl = box.querySelector(".mn3-tl"), nx = tl && (tl.querySelector(".mn3-ev.nx") || tl.lastElementChild); if (tl && nx) tl.scrollLeft = Math.max(0, nx.offsetLeft - tl.offsetLeft - 140);
  }
  function toEnd() { [].forEach.call(P.querySelectorAll("[data-mn2scroll]"), function (w) { w.scrollLeft = w.scrollWidth; }); }
  P.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-mn2c]"); if (b) { S.c = b.getAttribute("data-mn2c"); save(); render(); return; }
    b = t.closest("[data-mn2g]"); if (b) { S.g = b.getAttribute("data-mn2g"); save(); render(); return; }
    b = t.closest("[data-mn2k]"); if (b) { S.k[S.c + S.g] = b.getAttribute("data-mn2k"); save(); render(); return; }
    b = t.closest("[data-mn2r]"); if (b) { S.r = b.getAttribute("data-mn2r"); save(); render(); return; }
    b = t.closest("[data-mn2v]"); if (b) { S.v = b.getAttribute("data-mn2v"); save(); render(); return; }
    b = t.closest("[data-mn2hist]"); if (b && root.openMacroDetail) { openMacroDetail(b.getAttribute("data-mn2hist")); }
  });
  var rm = root.renderMacro; if (typeof rm === "function") root.renderMacro = function () { var r = rm.apply(this, arguments); try { render(); } catch (e) {} return r; };
  if (root.MutationObserver) new MutationObserver(function () { if (!P.querySelector(":scope > .mn2") && P.querySelector(":scope > .layout")) render(); }).observe(P, { childList: true });
  setInterval(function () { if (P.classList.contains("active")) render(); }, 60000);
  render();
  var css = doc.createElement("style");
  css.textContent = ".mn2-hide{display:none!important}.mn2-lay{display:grid;grid-template-columns:262px minmax(0,1fr);gap:14px;align-items:start;margin-bottom:14px}" +
    ".mn2-left{display:flex;flex-direction:column;gap:10px;position:sticky;top:calc(var(--strip-h,40px) + 64px)}.mn2-left .gr-col-h{font-size:15px;font-weight:600;color:#e8eef4;margin:6px 0 0}" +
    ".mn2-ct{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;gap:4px;border:1px solid #1f2a3a;border-radius:10px;padding:14px;background:#0c121c}" +
    ".mn2-ct.on{border-color:#d9b46a;box-shadow:0 0 0 1px #d9b46a55,0 0 18px #d9b46a1f}.mn2-ct .gr-selb{font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#0b0f16;background:#d9b46a;border-radius:4px;padding:1px 6px;position:absolute;top:-8px;left:50%;transform:translateX(-50%)}" +
    ".mn2-ctn{font-size:16px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px}.mn2-ctc{font-size:12px;color:#8f9db3}.mn2-ctt{font-size:12px;color:#ff8a84;display:flex;align-items:center;gap:6px}.mn2-ctt.none{color:#666}.mn2-ctt i{width:8px;height:8px;border-radius:50%;background:#e0453a;box-shadow:0 0 8px #e0453a}" +
    ".mn2-today{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12.5px;margin:6px 0 4px}.mn2-today>b{color:#d9b46a;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase}" +
    ".mn2-ev{display:inline-flex;align-items:center;gap:6px;color:#e8eef4}.mn2-ev i{width:7px;height:7px;border-radius:50%;background:#e0453a;animation:mn2p 1.6s infinite}.mn2-ev.out{color:#8f9db3}.mn2-ev.out i{animation:none}.mn2-ev em{font-style:normal;font-size:10.5px;color:#ff8a84;border:1px solid #e0453a66;border-radius:4px;padding:0 4px}" +
    ".mn2-tabs{display:flex;flex-wrap:wrap;gap:0 4px;border-bottom:1px solid #1a1a1a;margin-top:8px}.mn2-tabs .st-b{display:inline-flex;align-items:center;gap:6px}" +
    ".mn2-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e0453a;box-shadow:0 0 6px #e0453a;flex:0 0 auto}.mn2-dot.due{background:transparent;border:2px solid #e0453a;box-sizing:border-box;animation:mn2p 1.6s infinite}" +
    "@keyframes mn2p{0%,100%{opacity:1}50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.mn2-dot.due,.mn2-ev i{animation:none}}" +
    ".mn2-g{display:grid;grid-template-columns:230px minmax(0,1fr);gap:14px;align-items:start}.mn2-list{display:flex;flex-direction:column;gap:2px;border:1px solid #1a1a1a;border-radius:8px;padding:8px}" +
    ".mn2-lh{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a;margin:8px 6px 4px}.mn2-lh:first-child{margin-top:2px}" +
    ".mn2-it{all:unset;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;font-size:13px;color:#c9d4e2;border-left:2px solid transparent}" +
    ".mn2-it:hover{background:#111;color:#fff}.mn2-it.on{color:#d9b46a;border-left-color:#d9b46a;background:rgba(217,180,106,.06)}.mn2-key{font-size:10.5px;color:#777;margin:10px 6px 2px;display:flex;align-items:center;gap:6px}" +
    ".mn2-card{border:1px solid #1f1f1f;border-radius:8px;padding:14px 16px;background:#000}.mn2-ch{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}.mn2-cn{font-size:16px;font-weight:600;color:#fff;display:flex;align-items:center;gap:8px}" +
    ".mn2-tag{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid;border-radius:4px;padding:1px 6px}.mn2-tag.lead{color:#3fb97f}.mn2-tag.coin{color:#38b6c9}.mn2-tag.lag{color:#d9b46a}.mn2-ty{font-size:12px;color:#8f9db3}" +
    ".mn2-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#ff8a84}.mn2-live i{width:8px;height:8px;border-radius:50%;background:#e0453a;box-shadow:0 0 6px #e0453a}.mn2-live.due i{background:transparent;border:2px solid #e0453a;box-sizing:border-box;animation:mn2p 1.6s infinite}" +
    ".mn2-big{font:500 34px 'JetBrains Mono','IBM Plex Mono',monospace;color:#fff;margin:10px 0 6px}.mn2-big small{font:12.5px 'Libre Franklin',system-ui,sans-serif;color:#8f9db3}" +
    ".mn2-kvs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;margin:6px 0 12px}.mn2-kv{padding:8px 10px;border-left:1px solid #1a1a1a;min-width:0}.mn2-kv:first-child{border-left:0}" +
    ".mn2-kv span{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#8a8a8a}.mn2-kv b{font:500 14px 'JetBrains Mono','IBM Plex Mono',monospace;color:#e8eef4}.mn2-kv b.up{color:var(--green)}.mn2-kv b.dn{color:var(--red)}" +
    ".mn2-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:4px 0 10px}.mn2-sw{display:inline-flex;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden}.mn2-sw button{all:unset;cursor:pointer;padding:3px 11px;font:500 12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#8a8a8a}.mn2-sw button[aria-pressed=true]{color:#d9b46a;background:rgba(217,180,106,.1)}.mn2-sw button+button{border-left:1px solid #2a2a2a}.mn2-n{font-size:11px;color:#777}" +
    ".mn2-vw.both{display:flex;flex-direction:column;gap:12px}.mn2-ch2{width:100%;height:auto;display:block}.mn2-tw{overflow-x:auto;border:1px solid #1a1a1a;border-radius:6px}" +
    ".mn2-tb{width:100%;border-collapse:collapse;font:12.5px 'JetBrains Mono','IBM Plex Mono',monospace;display:table!important}.mn2-tb thead{display:table-header-group!important}.mn2-tb tbody{display:table-row-group!important}.mn2-tb th{background:#000;font-size:10.5px;color:#8a8a8a;font-weight:500;text-align:right;padding:6px 10px;border-bottom:1px solid #2a2a2a;white-space:nowrap}.mn2-tb th.rh{position:sticky;left:0;z-index:1;text-align:left;letter-spacing:.06em;text-transform:uppercase;border-right:1px solid #2a2a2a}.mn2-tb td{padding:5px 10px;border-bottom:1px solid #111;color:#c9d4e2;text-align:right;white-space:nowrap}.mn2-tb td.lt{background:rgba(217,180,106,.08)}.mn2-tb td.lt b{color:#d9b46a}.mn2-tb .r{text-align:right}.mn2-tb b{color:#fff;font-weight:500}.mn2-tb .up{color:#3fb97f}.mn2-tb .dn{color:#e0655f}" +
    ".mn2-ro{border-left:2px solid #d9b46a;background:rgba(217,180,106,.05);padding:8px 12px;margin:2px 0 12px;border-radius:0 6px 6px 0}.mn2-ro b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a}.mn2-ro ul{margin:6px 0 0;padding-left:18px}.mn2-ro li{font-size:13px;line-height:1.55;color:#e8eef4}" +
    "#mdc-overlay .mdc-wrap{max-width:1040px!important;background:#000!important;border:1px solid #2a2a2a!important;border-top:3px solid #d9b46a!important;box-shadow:0 20px 60px rgba(0,0,0,.8)!important}.mn2-modal .mn2-card{border:0;padding:6px 4px}.mn2-modal .mn2-hist{display:none}" +
    ".mn2-more{margin:6px 4px 10px;border-top:1px solid #1a1a1a;padding-top:8px}.mn2-more>summary{cursor:pointer;color:#8a8a8a;font-size:12px;letter-spacing:.06em;text-transform:uppercase}.mn2-more[open]>summary{color:#d9b46a}" +
    ".mn2-lg{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11.5px;color:#aab6c8;margin:0 0 4px}.mn2-lg span{display:inline-flex;align-items:center;gap:6px}.mn2-lg i{display:inline-block;width:14px;height:3px;border-radius:2px}.mn2-lg i.ds{height:0;border-top:2px dashed}.mn2-lg i.dt{height:0;border-top:2px dotted}" +
    ".mn2-sp{width:100%;height:120px;display:block}.mn2-spx{display:flex;justify-content:space-between;font:11px 'JetBrains Mono','IBM Plex Mono',monospace;color:#777;margin:2px 0 12px}" +
    ".mn2-edu{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.mn2-edu b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a}.mn2-edu p{margin:4px 0 0;font-size:13px;line-height:1.5;color:#c9d4e2}" +
    ".mn2-ft{margin-top:12px;font-size:11.5px;color:#777}.mn2-hist{all:unset;cursor:pointer;color:#d9b46a}.mn2-hist:hover{text-decoration:underline}" +
    ".mn2-histtop{margin-left:auto;border:1px solid rgba(217,180,106,.55);border-radius:6px;padding:3px 10px;font:600 12px 'Libre Franklin',system-ui,sans-serif}.mn2-histtop:hover{background:rgba(217,180,106,.1);text-decoration:none}" +
    "@media (max-width:1100px){.mn2-g{grid-template-columns:1fr}.mn2-list{flex-direction:row;flex-wrap:wrap}.mn2-lh{width:100%}.mn2-kvs{grid-template-columns:repeat(3,minmax(0,1fr))}.mn2-edu{grid-template-columns:1fr}}" +
    "@media (max-width:1020px){.mn2-lay{grid-template-columns:1fr}.mn2-left{position:static;flex-direction:row;flex-wrap:wrap}.mn2-left .gr-col-h{width:100%}.mn2-ct{flex:1 1 200px}}" +
    "@media (max-width:760px){.mn2-tabs{flex-wrap:nowrap;overflow-x:auto}.mn2-kvs{grid-template-columns:repeat(2,minmax(0,1fr))}}";
  css.textContent += ".mn2-drv{margin:12px 0;border:1px solid #1a1a1a;border-left:3px solid #38b6c9;background:#050505;padding:10px 14px}.mn2-drh{font:600 12px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#38b6c9;margin-bottom:8px}.mn2-drh small{text-transform:none;letter-spacing:0;color:#777;font-weight:400}" +
    ".mn2-dv{margin:8px 0 12px}.mn2-dv>b{display:block;font-size:13px;color:#e8eef4;margin-bottom:6px}.mn2-dl{margin:4px 0 8px 18px;padding:0;font-size:12.5px;line-height:1.55;color:#c9d4e2}" +
    ".mn2-dt{border-collapse:collapse;font:12px 'JetBrains Mono','IBM Plex Mono',monospace;width:100%}.mn2-dt th,.mn2-dt td{padding:4px 6px;border-bottom:1px solid #141414;text-align:right;white-space:nowrap}.mn2-dt th:first-child{text-align:left;font-family:'Libre Franklin',system-ui,sans-serif;font-weight:500;color:#c9d4e2}" +
    ".mn2-dt thead th{color:#777;font-weight:500;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}.mn2-dt td{color:#e8eef4}.mn2-dt .up{color:#3fb97f}.mn2-dt .dn{color:#e0655f}.mn2-dt tr.agg th{color:#d9b46a;font-weight:600}.mn2-dt tr.agg td{background:#0b0b0b}" +
    ".mn2-dtw{overflow-x:auto;border:1px solid #141414}.mn2-dt2 thead th{background:#050505}.mn2-dt2 thead button{all:unset;cursor:pointer;color:#8a8a8a;white-space:nowrap}.mn2-dt2 thead button:hover{color:#fff}.mn2-dt2 thead button.on{color:#d9b46a}.mn2-dt2 thead button:focus-visible{outline:2px solid #38b6c9}" +
    ".mn2-dt2 tr.tp.g{background:rgba(63,185,127,.10)}.mn2-dt2 tr.tp.d{background:rgba(224,101,95,.10)}.mn2-dt2 tr.tp.g th:first-child{box-shadow:inset 3px 0 0 #3fb97f}.mn2-dt2 tr.tp.d th:first-child{box-shadow:inset 3px 0 0 #e0655f}" +
    ".mn2-rk{font:700 9.5px 'JetBrains Mono','IBM Plex Mono',monospace;font-style:normal;letter-spacing:.03em;margin-left:8px;padding:1px 5px;border-radius:3px;color:#000}.mn2-rk.g{background:#3fb97f}.mn2-rk.d{background:#e0655f}" +
    ".mn2-wt{font:700 9.5px 'JetBrains Mono','IBM Plex Mono',monospace;font-style:normal;margin-left:8px;padding:0 5px;border:1px solid #d9b46a;border-radius:3px;color:#d9b46a}.mn2-dt2 td.wbig{color:#d9b46a;font-weight:700}.mn2-dt2 td.wsm{color:#666}" +
    ".mn2-dt2 td.bc{white-space:nowrap}.mn2-tk{display:inline-block;position:relative;width:44px;height:11px;vertical-align:middle;margin-right:8px;border-left:0}.mn2-tk:before{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;border-left:1px solid #2a2a2a}.mn2-bar{position:absolute;top:0;bottom:0;border-radius:2px}.mn2-bar.p{background:#3fb97f}.mn2-bar.n{background:#e0655f}.mn2-dn{font-size:11px;color:#777;margin:6px 0 0;line-height:1.45}";
  css.textContent += ".mn3-head{padding-top:14px}.mn3-ttl{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;margin-bottom:12px}.mn3-ttl h2{margin:0;font:600 20px 'Libre Franklin',system-ui,sans-serif!important;color:#fff!important;letter-spacing:0!important;text-transform:none!important}" +
    ".mn3-ttl h2 span{margin-left:8px;font:500 12px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a}.mn3-sub{font-size:12px;color:#777}.mn3-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#e0655f;vertical-align:middle;margin-right:2px}" +
    ".mn3-ag{display:flex;align-items:stretch;gap:12px;border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;padding:10px 0;margin-bottom:6px}" +
    ".mn3-agk{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;font:600 11px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#d9b46a;padding-right:12px;border-right:1px solid #1a1a1a}.mn3-agk small{letter-spacing:0;text-transform:none;color:#777;font-weight:400;margin-top:2px}" +
    ".mn3-tl{display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin;min-width:0;padding-bottom:2px}" +
    ".mn3-ev{flex:0 0 auto;display:flex;flex-direction:column;gap:2px;min-width:118px;max-width:190px;padding:6px 10px;border:1px solid #1a1a1a;border-radius:6px;background:#050505}" +
    ".mn3-ev.out{opacity:.55}.mn3-ev.nx{border-color:#d9b46a;background:rgba(217,180,106,.06)}" +
    ".mn3-tm{font:500 11px 'JetBrains Mono','IBM Plex Mono',monospace;color:#8a8a8a;white-space:nowrap}.mn3-tm .ok{color:#3fb97f;font-weight:600}.mn3-tm .cd{color:#d9b46a;font-weight:600;margin-left:4px}" +
    ".mn3-nm{font-size:12.5px;color:#e8eef4;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mn3-nm .hi{display:inline-block;width:6px;height:6px;border-radius:50%;background:#e0655f;margin-right:6px;vertical-align:middle}" +
    ".mn3-none{font-size:12.5px;color:#777;align-self:center}" +
    "@media (max-width:760px){.mn3-ag{flex-direction:column;gap:6px}.mn3-agk{flex-direction:row;justify-content:flex-start;align-items:baseline;gap:8px;border-right:0;padding:0}}";
  doc.head.appendChild(css);
  /* ---- Full history: what drove the print (Nov 16). Momentum from the series itself for every indicator; internals from the
     official component series where the desk holds them (CPI: BLS / Statistics Canada categories; others: DATA.macro_parts). ---- */
  /* official weights: BLS CPI-U relative importance, Dec 2025 (bls.gov/cpi/tables/relative-importance/2025.htm);
     Statistics Canada 2025 basket (Prices Analytical Series 62F0014M2026005): majors at link-month prices, sub-items at reference-period prices */
  var WUS = { "All items": 100, "Core (ex food & energy)": 79.919, "Food": 13.698, "Energy": 6.383, "Core goods": 19.176, "Core services": 60.744, "Food at home": 8.325, "Food away from home": 5.373,
    "Cereals & bakery products": 1.035, "Cereals & cereal products": 0.315, "Bakery products": 0.721, "Meats, poultry, fish & eggs": 1.995, "Beef & veal": 0.638, "Chicken": 0.291, "Eggs": 0.133,
    "Dairy products": 0.758, "Fruits & vegetables": 1.269, "Fresh fruits": 0.532, "Fresh vegetables": 0.476, "Lettuce": 0.044, "Tomatoes": 0.063, "Nonalcoholic beverages": 0.995, "Coffee": 0.221,
    "Sugar & sweets": 0.328, "Fats & oils": 0.231, "Alcoholic beverages": 0.84, "Gasoline": 2.895, "Fuel oil": 0.083, "Electricity": 2.489, "Utility (piped) gas": 0.773, "New vehicles": 3.838,
    "Used cars & trucks": 2.759, "Apparel": 2.368, "Medical care commodities": 1.489, "Household furnishings & operations": 4.298, "Televisions": 0.107, "Tobacco & smoking products": 0.445,
    "Shelter": 35.625, "Rent of primary residence": 7.84, "Owners' equivalent rent": 26.204, "Lodging away from home": 1.289, "Medical care services": 6.935, "Hospital services": 2.167,
    "Physicians' services": 1.684, "Motor vehicle insurance": 2.754, "Motor vehicle maintenance & repair": 1.039, "Airline fares": 0.881, "Transportation services": 6.315,
    "Water, sewer & trash": 1.144, "Education & communication": 5.846, "Recreation": 5.137 };
  var WCA = { "All items": 100, "Food": 16.93, "Shelter": 28.3, "Household operations & furnishings": 12.8, "Clothing & footwear": 4.5, "Transportation": 18.54, "Health & personal care": 5.4,
    "Recreation, education & reading": 9.81, "Alcohol, tobacco & cannabis": 3.73, "Food purchased from stores": 10.82, "Food from restaurants": 6.02, "Rent": 7.45, "Mortgage interest cost": 5.23,
    "Purchase of passenger vehicles": 6.67, "Vehicle insurance premiums": 2.45, "Gasoline": 3.3 };
  /* components that add up to the headline level: weight = share of the total in the latest period */
  var SHARE = { us_nfp: 1, us_retail: 1, us_pspend: 1, us_starts: ["Northeast", "Midwest", "South", "West"], us_permits: ["Northeast", "Midwest", "South", "West"] };
  var PARENT = { "Owners' equivalent rent": "Shelter", "Rent of primary residence": "Shelter", "Lodging away from home": "Shelter", "Cereals & cereal products": "Cereals & bakery products",
    "Bakery products": "Cereals & bakery products", "Beef & veal": "Meats, poultry, fish & eggs", "Chicken": "Meats, poultry, fish & eggs", "Eggs": "Meats, poultry, fish & eggs",
    "Fresh fruits": "Fruits & vegetables", "Fresh vegetables": "Fruits & vegetables", "Lettuce": "Fresh vegetables", "Tomatoes": "Fresh vegetables", "Coffee": "Nonalcoholic beverages",
    "Hospital services": "Medical care services", "Physicians' services": "Medical care services", "Motor vehicle insurance": "Transportation services",
    "Motor vehicle maintenance & repair": "Transportation services", "Airline fares": "Transportation services", "Cereals & cereal products ": "",
    "Food purchased from stores": "Food", "Food from restaurants": "Food", "Rent": "Shelter", "Mortgage interest cost": "Shelter", "Owned accommodation": "Shelter",
    "Purchase of passenger vehicles": "Transportation", "Vehicle insurance premiums": "Transportation", "Gasoline": "Transportation", "Air transportation": "Transportation",
    "Bakery & cereal products": "Food purchased from stores", "Meat": "Food purchased from stores", "Dairy products": "Food purchased from stores" };
  var CPIMAP = { us_cpi: "cpi_detail", us_core_cpi: "cpi_detail", ca_cpi: "cpi_detail_ca", ca_trim: "cpi_detail_ca", ca_median: "cpi_detail_ca" };
  function sgn(x, d, u) { if (x == null || !isFinite(x)) return "—"; var r = Math.abs(x) < Math.pow(10, -d) / 2 ? 0 : x; return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(d) + (u || ""); }
  function cl(x) { return x == null ? "" : x > 0 ? "up" : x < 0 ? "dn" : ""; }
  function momentum(m) {
    var d = m.dec != null ? +m.dec : 1, pct = m.unit === "%", L = (m.long && m.long.length > 13 && /^\d{4}-/.test(m.long[0][0])) ? m.long : null, H = L || m.hist24 || m.history || [];
    if (H.length < 3) return "";
    /* the long file can trail the latest print by a release: put the headline on the end so "latest" is the latest */
    if (m.value != null) { var lastD = H[H.length - 1][0];
      if (L ? (m.obs_date && m.obs_date.slice(0, 10) > lastD) : (m.period && lastD !== m.period)) H = H.concat([[L ? m.obs_date.slice(0, 10) : m.period, +m.value]]); }
    var v = H.map(function (x) { return +x[1]; }), n = v.length - 1, per = m.freq === "Q" ? 4 : m.freq === "W" ? 52 : 12, lag = m.freq === "Q" ? "quarter" : m.freq === "W" ? "week" : "month";
    var unit = pct ? " pp" : m.unit === "K" ? "K" : "", rows = [];
    var dif = function (a, b) { return pct || m.unit === "K" ? a - b : (b ? (a / b - 1) * 100 : null); }, du = pct ? " pp" : m.unit === "K" ? "K" : "%";
    rows.push(["Latest vs prior " + lag, fv(m, v[n]) + " vs " + fv(m, v[n - 1]), sgn(dif(v[n], v[n - 1]), d, du)]);
    if (n >= 1 + 1) rows.push(["Prior " + lag + " vs the one before", fv(m, v[n - 1]) + " vs " + fv(m, v[n - 2]), sgn(dif(v[n - 1], v[n - 2]), d, du)]);
    var ya = -1;
    if (L && (m.freq === "W" || m.freq === "D")) { var t0 = Date.parse(H[n][0]) - 365 * 864e5, best = 9e15; for (var j = n - 1; j >= 0; j--) { var dd2 = Math.abs(Date.parse(H[j][0]) - t0); if (dd2 < best && dd2 <= 4 * 864e5) { best = dd2; ya = j; } } }
    else if (L) { var want = (+H[n][0].slice(0, 4) - 1) + H[n][0].slice(4, 7); for (var j = n - 1; j >= 0; j--) if (H[j][0].slice(0, 7) === want) { ya = j; break; } }   /* by date: a skipped month must not shift the comparison */
    else if (n >= per) ya = n - per;
    if (ya >= 0) rows.push(["Latest vs a year earlier (" + esc(lab([H[ya][0], 0, !!L])) + ")", fv(m, v[n]) + " vs " + fv(m, v[ya]), sgn(dif(v[n], v[ya]), d, du)]);
    if (n >= 5) { var a3 = (v[n] + v[n - 1] + v[n - 2]) / 3, b3 = (v[n - 3] + v[n - 4] + v[n - 5]) / 3; rows.push(["Last 3 " + lag + "s average vs the 3 before", fv(m, a3) + " vs " + fv(m, b3), sgn(dif(a3, b3), d, du)]); }
    var run = 0, dir = Math.sign(v[n] - v[n - 1]); for (var i = n; i > 0 && dir && Math.sign(v[i] - v[i - 1]) === dir; i--) run++;
    var runTxt = dir ? (dir > 0 ? "Rising " : "Falling ") + run + " " + lag + (run > 1 ? "s" : "") + " in a row" : "Unchanged on the " + lag;
    return '<div class="mn2-dv"><b>Momentum — ' + (m.measure ? esc(m.measure) + " · " : "") + 'computed from this series</b><table class="mn2-dt"><tbody>' +
      rows.map(function (r) { return "<tr><th>" + r[0] + "</th><td>" + r[1] + '</td><td class="' + (r[2].charAt(0) === "+" ? "up" : r[2].charAt(0) === "−" ? "dn" : "") + '">' + r[2] + "</td></tr>"; }).join("") +
      "</tbody></table><p class=\"mn2-dn\">" + runTxt + "." + (pct ? " Changes in percentage points." : m.unit === "K" ? "" : " Changes in %.") + "</p></div>";
  }
  function internals(m) {
    var D = root.DATA || {}, src, items, kind, unit, per, title;
    if (CPIMAP[m.key] && D[CPIMAP[m.key]] && D[CPIMAP[m.key]].items) {
      var C = D[CPIMAP[m.key]]; kind = "cpi"; unit = "%"; src = (CPIMAP[m.key] === "cpi_detail" ? "BLS CPI-U by category — " : "Statistics Canada CPI by category — ") + (C.note || "");
      items = C.items.map(function (i) { return { n: i.n, g: i.g, mm: i.mm, yy: i.yy, m: i.m }; }); title = "Inside the number — CPI categories, " + md2(C.month);
      if (m.key === "us_core_cpi" || m.key === "ca_trim" || m.key === "ca_median") items = items.filter(function (i) { return !/^food$|^energy$|gasoline|fuel|electric|natural gas|utility/i.test(i.n) && i.g !== "energy"; });
    } else if ((D.macro_parts || {})[m.key] && D.macro_parts[m.key].items) {
      var Pp = D.macro_parts[m.key]; kind = Pp.kind; unit = Pp.unit; src = Pp.src; items = Pp.items; title = "Inside the number — components, " + md2(items[0].m[items[0].m.length - 1]);
    } else return '<div class="mn2-dv"><b>Inside the number</b><p class="mn2-dn">' + (m.group === "ca" ? "Statistics Canada component tables for this release are not on the desk yet." : "No official component breakdown is published for this indicator in a free feed the desk reads.") +
      " The momentum table above is computed from the headline series.</p></div>";
    var last = function (a, k) { return a && a.length > k ? a[a.length - 1 - k] : null; };
    var du = kind === "diff" ? (unit === "K jobs" || unit === "K" ? "K" : "") : kind === "pp" ? " pp" : "%", dd = kind === "diff" ? 0 : kind === "pp" ? 2 : 1;
    var R = items.map(function (i) {
      var mm0 = last(i.mm, 0), mm1 = last(i.mm, 1), yy0 = last(i.yy, 0), yy1 = last(i.yy, 1), lv = i.v ? last(i.v, 0) : null;
      return { n: i.n, g: i.g, mm0: mm0, mm1: mm1, yy0: yy0, yy1: yy1, dyy: yy0 != null && yy1 != null ? yy0 - yy1 : null, dmm: mm0 != null && mm1 != null ? mm0 - mm1 : null, lv: lv };
    });
    var WT = kind === "cpi" ? (CPIMAP[m.key] === "cpi_detail" ? WUS : WCA) : null, wsrc = "";
    var CW = CPIMAP[m.key] === "cpi_detail_ca" && D.cpi_detail_ca && D.cpi_detail_ca.w;   /* the full StatCan basket, when the refresh has loaded it */
    if (CW) { WT = CW; WT["All items"] = 100; }
    if (WT) { R.forEach(function (r) { if (WT[r.n] != null) r.w = WT[r.n]; }); wsrc = CPIMAP[m.key] === "cpi_detail" ? "BLS relative importance, Dec 2025" : CW ? D.cpi_detail_ca.w_src : "StatCan 2025 basket (majors at link-month prices, sub-items at reference prices)"; }
    else if (SHARE[m.key]) { var part = SHARE[m.key] === 1 ? R : R.filter(function (r) { return SHARE[m.key].indexOf(r.n) >= 0; }), tot = part.reduce(function (a, r) { return a + (r.lv || 0); }, 0);
      if (tot > 0) { part.forEach(function (r) { if (r.lv != null) r.w = r.lv / tot * 100; }); wsrc = "share of the total in the latest period"; } }
    /* contribution to the headline move: weight × change (pp) for price/% components; the change itself for job counts and GDP contributions */
    R.forEach(function (r) { r.ct = kind === "pp" ? r.lv : kind === "diff" ? r.mm0 : r.w != null && r.mm0 != null ? r.w / 100 * r.mm0 : null; });
    var hasW = R.some(function (r) { return r.w != null; }), hasC = kind !== "pp" && kind !== "diff" && R.some(function (r) { return r.ct != null; });
    var agg = R.filter(function (r) { return r.g === "agg"; }), rest = R.filter(function (r) { return r.g !== "agg"; });
    /* top 5 gainers and draggers: ranked by contribution where weights exist, else by the size of the latest move; headline rows excluded */
    var rk = R.filter(function (r) { return !/^all items|^core \(ex/i.test(r.n) && (kind === "cpi" ? r.g !== "agg" || WT && r.w != null : true); }), rkey = R.some(function (r) { return r.ct != null && r.g !== "agg"; }) ? "ct" : "mm0";
    if (kind === "cpi") rk = rk.filter(function (r) { return r.g !== "agg"; });
    /* a sub-item is not ranked next to its own parent (OER inside Shelter, gasoline inside Transportation…) */
    var inRk = {}; rk.forEach(function (r) { inRk[r.n] = 1; }); if (CPIMAP[m.key] !== "cpi_detail_ca") rk = rk.filter(function (r) { return !(PARENT[r.n] && inRk[PARENT[r.n]]); });   /* Canada: every category ranks on its own basket weight */
    var tiny = rkey === "ct" && kind !== "pp" && kind !== "diff" ? 0.005 : 0;
    var gl = rk.filter(function (r) { return r[rkey] != null && r[rkey] > tiny; }).sort(function (a, b) { return b[rkey] - a[rkey]; }).slice(0, 5),
      dl = rk.filter(function (r) { return r[rkey] != null && r[rkey] < -tiny; }).sort(function (a, b) { return a[rkey] - b[rkey]; }).slice(0, 5);
    gl.forEach(function (r, i) { r.top = "g" + (i + 1); }); dl.forEach(function (r, i) { r.top = "d" + (i + 1); });
    var rkLab = rkey === "ct" ? (kind === "cpi" || hasC ? "contribution (weight × MoM)" : kind === "pp" ? "contribution" : "change") : "latest move";
    /* the story: who moved most this period, and whose year-on-year rate accelerated / slowed most */
    var key = kind === "pp" ? "lv" : "mm0", isHead = function (r) { return /^all items|^core \(ex/i.test(r.n); };
    /* CPI: tell the story with the major groups (food, energy, goods, services, shelter, transport…), single items after */
    var major = kind === "cpi" ? R.filter(function (r) { return (r.g === "agg" || r.g === "main") && !isHead(r); }) : rest;
    var ok = major.filter(function (r) { return r[key] != null; });
    var up = ok.slice().sort(function (a, b) { return b[key] - a[key]; }).slice(0, 3).filter(function (r) { return r[key] > 0; }),
      dn = ok.slice().sort(function (a, b) { return a[key] - b[key]; }).slice(0, 3).filter(function (r) { return r[key] < 0; });
    var acc = major.filter(function (r) { return r.dyy != null; }).sort(function (a, b) { return b.dyy - a.dyy; });
    var lines = [];
    if (gl.length) lines.push("Top gainers by " + rkLab + ": " + gl.map(function (r) { return esc(r.n) + " " + (rkey === "ct" && kind !== "pp" && kind !== "diff" ? sgn(r.ct, 2, " pp") : sgn(r[rkey], dd, du)); }).join(", ") + ".");
    if (dl.length) lines.push("Top draggers by " + rkLab + ": " + dl.map(function (r) { return esc(r.n) + " " + (rkey === "ct" && kind !== "pp" && kind !== "diff" ? sgn(r.ct, 2, " pp") : sgn(r[rkey], dd, du)); }).join(", ") + ".");
    if (kind === "pp") {
      if (false && up.length) lines.push("Added the most: " + up.map(function (r) { return esc(r.n) + " " + sgn(r.lv, dd, du); }).join(", ") + ".");
      if (false && dn.length) lines.push("Subtracted: " + dn.map(function (r) { return esc(r.n) + " " + sgn(r.lv, dd, du); }).join(", ") + ".");
    } else {
      var lab2 = kind === "diff" ? "change" : "month-on-month";
      if (false && up.length) lines.push("Biggest rises (" + lab2 + "): " + up.map(function (r) { return esc(r.n) + " " + sgn(r.mm0, dd, du); }).join(", ") + ".");
      if (false && dn.length) lines.push("Biggest falls (" + lab2 + "): " + dn.map(function (r) { return esc(r.n) + " " + sgn(r.mm0, dd, du); }).join(", ") + ".");
      if (acc.length > 1 && kind !== "diff") {
        var a1 = acc.slice(0, 2).filter(function (r) { return r.dyy > 0.05; }), s1 = acc.slice(-2).reverse().filter(function (r) { return r.dyy < -0.05; });
        if (a1.length) lines.push("Year-on-year rate picked up most in " + a1.map(function (r) { return esc(r.n) + " (" + r.yy1.toFixed(1) + "% → " + r.yy0.toFixed(1) + "%)"; }).join(", ") + ".");
        if (s1.length) lines.push("Slowed most in " + s1.map(function (r) { return esc(r.n) + " (" + r.yy1.toFixed(1) + "% → " + r.yy0.toFixed(1) + "%)"; }).join(", ") + ".");
      }
    }
    if (kind === "cpi") { var items2 = rest.filter(function (r) { return r.g !== "main" && r.mm0 != null; }).sort(function (a, b) { return Math.abs(b.mm0) - Math.abs(a.mm0); }).slice(0, 4);
      if (items2.length) lines.push("Largest single-item moves (small weights, volatile): " + items2.map(function (r) { return esc(r.n) + " " + sgn(r.mm0, 1, "%"); }).join(", ") + "."); }
    lines = lines.map(function (x) { return x.replace("Biggest rises (month-on-month)", kind === "cpi" ? "Major groups up most on the month" : "Biggest rises (month-on-month)").replace("Biggest falls (month-on-month)", kind === "cpi" ? "Major groups down most on the month" : "Biggest falls (month-on-month)"); });
    /* columns: [id, label, value(r), unit, decimals, bar?]; click a header to sort (high → low, then low → high) */
    R.forEach(function (r) { r.prev = r.lv != null && r.mm0 != null ? r.lv - r.mm0 : null; r.yago = r.lv != null && r.yy0 != null ? r.lv - r.yy0 : null; });
    var yu = kind === "diff" ? du : "%", cw = kind === "diff" ? "Change" : "MoM";
    var COLS = kind === "pp" ? [["lv", "Latest", du, dd, 1], ["prev", "Prior", du, dd, 0], ["mm0", "Change", du, dd, 1], ["yago", "A year ago", du, dd, 0]] :
      [["mm0", cw + " latest", du, dd, 1], ["mm1", cw + " prior", du, dd, 0], ["yy0", "YoY latest", yu, dd, 1], ["yy1", "YoY prior", yu, dd, 0], ["dyy", "YoY shift", kind === "diff" ? du : " pp", kind === "diff" ? dd : 1, 1]];
    if (hasC) COLS.splice(1, 0, ["ct", "Contrib.", " pp", 2, 1]);
    var so = SORT[m.key] || { c: hasC ? "ct" : COLS[0][0], d: -1, abs: true };
    var mx = {}; COLS.forEach(function (c) { mx[c[0]] = Math.max.apply(null, R.map(function (r) { return Math.abs(r[c[0]] || 0); }).concat([1e-9])); });
    var head = '<th><button type="button" data-mn2sort="' + esc(m.key) + '|n" class="' + (so.c === "n" ? "on" : "") + '">Component' + (so.c === "n" ? (so.d < 0 ? " ▼" : " ▲") : "") + "</button></th>" +
      COLS.map(function (c) { var on = so.c === c[0]; return '<th><button type="button" data-mn2sort="' + esc(m.key) + "|" + c[0] + '" class="' + (on ? "on" : "") + '" title="Sort: highest to lowest, click again for lowest to highest">' + c[1] + (on ? (so.abs ? " ▼ size" : so.d < 0 ? " ▼" : " ▲") : " ⇅") + "</button></th>"; }).join("");
    var row = function (r) {
      var badge = r.top ? '<em class="mn2-rk ' + r.top.charAt(0) + '">' + (r.top.charAt(0) === "g" ? "▲ Gainer #" : "▼ Dragger #") + r.top.slice(1) + "</em>" : "",
        wb = r.w != null && r.w > 5 && r.w < 100 ? '<em class="mn2-wt" title="Weight in the index">W ' + r.w.toFixed(1) + "%</em>" : "";
      return '<tr class="' + (r.g === "agg" ? "agg " : "") + (r.top ? "tp " + r.top.charAt(0) : "") + '"><th>' + esc(r.n) + wb + badge + "</th>" + COLS.map(function (c) {
        if (c[0] === "w") return '<td class="' + (r.w > 5 && r.w < 100 ? "wbig" : "wsm") + '">' + (r.w == null ? "—" : r.w.toFixed(r.w < 1 ? 2 : 1) + "%") + "</td>";
        var v = r[c[0]], w = v == null ? 0 : Math.abs(v) / mx[c[0]] * 50;
        var bar = c[4] ? '<span class="mn2-tk">' + (v != null ? '<i class="mn2-bar ' + (v >= 0 ? "p" : "n") + '" style="' + (v >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></i>' : "") + "</span>" : "";
        return '<td class="' + (c[4] ? cl(v) + " bc" : "") + '">' + bar + "<span>" + sgn(v, c[3], c[2]) + "</span></td>"; }).join("") + "</tr>";
    };
    var cmp = function (a, b) {
      if (so.c === "n") return so.d * (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) * -1;
      var x = a[so.c], y = b[so.c]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      if (so.abs) return Math.abs(y) - Math.abs(x);
      return so.d < 0 ? y - x : x - y;
    };
    var body = agg.slice().sort(cmp).map(row).join("") + rest.slice().sort(cmp).map(row).join("");
    var sortTxt = so.c === "n" ? "by name" : "by " + COLS.filter(function (c) { return c[0] === so.c; })[0][1] + (so.abs ? ", largest move either way first" : so.d < 0 ? ", highest to lowest" : ", lowest to highest");
    return '<div class="mn2-dv"><b>' + esc(title) + "</b>" + (lines.length ? '<ul class="mn2-dl">' + lines.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="mn2-dtw"><table class="mn2-dt mn2-dt2"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>" +
      '<p class="mn2-dn">' + (kind === "pp" ? "Contributions in percentage points of annualized real GDP growth; they add up to the headline." : kind === "diff" ? "Changes in levels (" + esc(unit) + "); YoY = change over 12 months." : "MoM = change on the prior period; YoY = change on the same period a year earlier; YoY shift = how much the yearly rate moved since last period.") +
      (gl.length || dl.length ? " Highlighted: top 5 gainers (green) and draggers (red) by " + rkLab + "." : "") + (hasW ? " W = weight in the headline (" + esc(wsrc) + "); weights above 5% are tagged." : "") +
      (hasC ? " Contribution ≈ weight × MoM, in percentage points of the headline." : "") +
      " Sorted " + sortTxt + " (" + (agg.length ? "headline groups stay on top; " : "") + "click a column to sort, click again to reverse). Bars are scaled to the largest move in that column. Source: " + esc(src) + ".</p></div>";
  }
  var SORT = {};
  doc.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-mn2sort]"); if (!b) return;
    var q = b.getAttribute("data-mn2sort").split("|"), th = b.closest("tr"), c0 = th && th.querySelector('[data-mn2sort$="|ct"]') ? "ct" : q[0] === "us_gdp" ? "lv" : "mm0", cur = SORT[q[0]] || { c: c0, d: -1, abs: true };
    /* first click: highest → lowest; again: lowest → highest; again: largest move either way */
    if (cur.c !== q[1]) SORT[q[0]] = { c: q[1], d: q[1] === "n" ? 1 : -1, abs: false };
    else if (q[1] === "n") SORT[q[0]] = { c: "n", d: -cur.d, abs: false };
    else SORT[q[0]] = cur.abs ? { c: q[1], d: -1, abs: false } : cur.d < 0 ? { c: q[1], d: 1, abs: false } : { c: q[1], d: -1, abs: true };
    var o = doc.getElementById("mdc-overlay"); if (o) { var y = o.scrollTop, bodyEl = o.querySelector(".mdc-body"), y2 = bodyEl ? bodyEl.scrollTop : 0; paintModal(o.getAttribute("data-key")); o.scrollTop = y; if (bodyEl) { var nb = o.querySelector(".mdc-body"); if (nb) nb.scrollTop = y2; } }
  });
  function md2(s) { if (!s) return ""; var d = new Date(String(s).slice(0, 7) + "-15T12:00:00Z"); return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }); }
  function drivers(key) {
    var m = mAll().filter(function (x) { return x.key === key; })[0]; if (!m) return "";
    return '<div class="mn2-drv"><div class="mn2-drh">What drove it <small>— month-on-month and year-on-year, latest vs the period before</small></div>' + momentum(m) + internals(m) + "</div>";
  }
  /* "Full history" anywhere on the desk opens the new indicator card; the older detail stays below under More detail */
  function cardFor(key) {
    var m = mAll().filter(function (x) { return x.key === key; })[0]; if (!m) return null;
    var t = relTime(m), seenToday = m.freq !== "D" && m.seen_at && dayET(Date.parse(m.seen_at)) === dayET(Date.now());
    return cardHTML({ m: m, t: t, today: !!(t.todayOut || t.todayDue || seenToday), out: !!(t.todayOut || seenToday), due: t.todayDue }, null);
  }
  var oldOpen = root.openMacroDetail;
  function paintModal(key) {
    var o = doc.getElementById("mdc-overlay"); if (!o) return; var c = cardFor(key); if (!c) return;
    var B = o.querySelector(".mdc-body"), old = B.querySelector(".mn2-old");
    var keep = old ? old.innerHTML : "";
    if (!keep) { var tmp = doc.createElement("div"); tmp.innerHTML = B.innerHTML; keep = tmp.innerHTML; }
    var dv = ""; try { dv = drivers(key); } catch (e) {}
    c = c.replace('<div class="mn2-kvs">', dv + '<div class="mn2-kvs">');
    B.innerHTML = '<div class="mn2-modal">' + c + '</div><details class="mn2-more"><summary>More detail</summary><div class="mn2-old">' + keep + "</div></details>";
    toEndIn(B);
  }
  function toEndIn(el) { [].forEach.call(el.querySelectorAll("[data-mn2scroll]"), function (w) { w.scrollLeft = w.scrollWidth; }); }
  if (typeof oldOpen === "function") root.openMacroDetail = function (key) { var r = oldOpen.apply(this, arguments); try { paintModal(key); } catch (e) {} return r; };
  doc.addEventListener("click", function (ev) {
    var o = ev.target.closest && ev.target.closest("#mdc-overlay"); if (!o) return;
    var b = ev.target.closest("[data-mn2r],[data-mn2v]"); if (!b) return;
    if (b.hasAttribute("data-mn2r")) S.r = b.getAttribute("data-mn2r"); else S.v = b.getAttribute("data-mn2v"); save();
    paintModal(o.getAttribute("data-key")); render();
  });
  root.MNAV = { render: render, cardFor: cardFor, open: open, what: function (k) { return WHAT[k] || ""; } };
})(window);
