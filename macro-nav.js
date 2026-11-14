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
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
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
    P.forEach(function (x, i) { if (i % step === 0 || i === n - 1) g += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" fill="#777" font-size="10" font-family="' + F + '">' + esc(lab(x)) + "</text>"; });
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
    return '<div class="mn2-tw" data-mn2scroll><table class="mn2-tb"><thead><tr><th class="rh">Period</th>' + head + '</tr></thead><tbody><tr><th class="rh">Value</th>' + val + '</tr><tr><th class="rh">Change</th>' + chg + "</tr></tbody></table></div>";
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
  function cardHTML(x, g) {
    var m = x.m, C = root.consensusFor ? consensusFor(m) : null, cons = C && C.consensus != null ? +C.consensus : null, v = m.value != null ? +m.value : null;
    var sur = cons != null && v != null ? v - cons : null, cg = CLS[m.key] || (/policy/.test(m.key) ? "lag" : "coin"), G = GROUPS.filter(function (q) { return q[0] === cg; })[0];
    var gd = /down|heat/.test(m.good || "") ? "down" : /up/.test(m.good || "") ? "up" : null, hot = gd === "down" ? sur > 0 : gd === "up" ? sur < 0 : null;
    var stat = x.out ? '<span class="mn2-live"><i></i>Released today ' + (x.t.todayOut ? hm(x.t.todayOut) : "") + "</span>" : x.due ? '<span class="mn2-live due"><i></i>Due today ' + hm(x.due) + "</span>" : "";
    var kv = function (k, val, cls) { return '<div class="mn2-kv"><span>' + k + "</span><b" + (cls ? ' class="' + cls + '"' : "") + ">" + val + "</b></div>"; };
    return '<div class="mn2-card"><div class="mn2-ch"><span class="mn2-cn">' + (root.flag ? flag(COUNTRY[m.group].cc, 16) : "") + " " + esc(COUNTRY[m.group].short + " " + m.name) + "</span>" +
      '<span class="mn2-tag ' + cg + '">' + G[1] + "</span><span class=\"mn2-ty\">" + TYPE[typeOf(m.key)] + "</span>" + stat + "</div>" +
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
      '<div class="mn2-ft">Source: ' + esc(m.src || "—") + (m.seen_at ? " · on the desk " + when(Date.parse(m.seen_at)) : "") + ' · <button type="button" class="mn2-hist" data-mn2hist="' + esc(m.key) + '">Full history →</button></div></div>';
  }
  function todayStrip(c) {
    var ev = []; try { ev = (root.fxEvList ? fxEvList() : []).filter(function (e) { return dayET(e.t) === dayET(Date.now()) && (e.ccy === (c === "us" ? "USD" : "CAD")); }); } catch (e) {}
    if (!ev.length) return '<div class="mn2-today"><b>Today</b> <span class="neu">No ' + COUNTRY[c].short + " releases on today’s calendar.</span></div>";
    return '<div class="mn2-today"><b>Today</b>' + ev.sort(function (a, b) { return a.t - b.t; }).map(function (e) {
      var past = e.t <= Date.now(); return '<span class="mn2-ev' + (past ? " out" : "") + '"><i></i>' + hm(e.t) + " · " + esc(String(e.label).replace(/^(USD|CAD)\s+/, "")) + (e.impact === "High" ? " <em>high impact</em>" : "") + "</span>"; }).join("") + "</div>";
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
        '<div class="mn2-c">' + (sel ? cardHTML(sel, S.g) : '<p class="note">No indicators in this group.</p>') + "</div></div>";
    }
    box.innerHTML = '<div class="mn2-lay">' + left + '<div class="mn2-main"><div class="tile wide mn2-head"><h2>' + COUNTRY[S.c].name + ' macro <span class="h2note">— categories as Trading Economics groups them · each data point tagged leading, coincident or lagging · red dot = released or due today</span></h2>' + todayStrip(S.c) + tabs + "</div>" + main + "</div></div>";
    toEnd();
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
    "@media (max-width:1100px){.mn2-g{grid-template-columns:1fr}.mn2-list{flex-direction:row;flex-wrap:wrap}.mn2-lh{width:100%}.mn2-kvs{grid-template-columns:repeat(3,minmax(0,1fr))}.mn2-edu{grid-template-columns:1fr}}" +
    "@media (max-width:1020px){.mn2-lay{grid-template-columns:1fr}.mn2-left{position:static;flex-direction:row;flex-wrap:wrap}.mn2-left .gr-col-h{width:100%}.mn2-ct{flex:1 1 200px}}" +
    "@media (max-width:760px){.mn2-tabs{flex-wrap:nowrap;overflow-x:auto}.mn2-kvs{grid-template-columns:repeat(2,minmax(0,1fr))}}";
  doc.head.appendChild(css);
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
  root.MNAV = { render: render, cardFor: cardFor };
})(window);
