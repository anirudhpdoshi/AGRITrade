/* breakouts-ui.js — the Breakouts menu: a live, timestamped stream of price events for the watchlist, the North American
   indexes, the currency market and the S&P 100 (owner, Nov 17 2026).
   Data: breakouts.json on the `breakouts` branch, written every 5 min on weekdays by scripts/breakouts.py from Yahoo
   prices delayed ~15 min. Polled every 30 s with an ETag (an unchanged file costs nothing against GitHub's limit).
   Nothing is computed here except filters, counts and the share of names above each moving average. */
(function (root) {
  var doc = root.document, P = doc.getElementById("panel-breakouts"); if (!P) return;
  var REPO = "anirudhpdoshi/AGRITrade", API = "https://api.github.com/repos/" + REPO + "/contents/breakouts.json?ref=breakouts",
    RAW = "https://raw.githubusercontent.com/" + REPO + "/breakouts/breakouts.json";
  var B = null, etag = "", lastTry = 0, lastOk = 0, err = null, seen = {}, fresh = {};
  var V = { cls: "all", kind: "all", q: "", paused: false, snapN: 0, view: "stream", sort: "score", dir: -1, avg: "both" };
  try { var sv = JSON.parse(localStorage.getItem("desk.brk") || "{}"); if (sv.cls) V.cls = sv.cls; if (sv.kind) V.kind = sv.kind; if (sv.view) V.view = sv.view; if (sv.avg) V.avg = sv.avg; } catch (e) {}
  function save() { try { localStorage.setItem("desk.brk", JSON.stringify({ cls: V.cls, kind: V.kind, view: V.view, avg: V.avg })); } catch (e) {} }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }),
    ETS = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", second: "2-digit" });
  var CLS = [["all", "All"], ["sp100", "S&P 100"], ["watch", "Watchlist"], ["index", "Indexes"], ["fx", "Currencies"]];
  var KIND = [["all", "All events"], ["hl", "Day highs / lows"], ["w52", "52-week"], ["ma", "SMA crossings"], ["ema", "EMA crossings"], ["close", "Closing breaks & crossovers"]];
  var KMAP = { day_high: "hl", day_low: "hl", w52_high: "w52", w52_low: "w52", ma_px: "ma", ma_close: "close", ma_cross: "close", ema_px: "ema", ema_close: "close", ema_cross: "close" };
  var TAG = { day_high: "DAY HIGH", day_low: "DAY LOW", w52_high: "52W HIGH", w52_low: "52W LOW", ma_px: "SMA CROSS", ma_close: "CLOSE vs SMA", ma_cross: "SMA × SMA", ema_px: "EMA CROSS", ema_close: "CLOSE vs EMA", ema_cross: "EMA × EMA" };
  var CNAME = { sp100: "S&P 100", watch: "Watchlist", index: "Index", fx: "FX" };
  /* company names (owner, Nov 19 2026): stocks show the company, with the ticker and — where a company lists more than one
     class — the share class beneath (Alphabet Class A GOOGL / Class C GOOG, Berkshire Class B). Unknown tickers show as-is. */
  var CO = { AAPL: "Apple", ABBV: "AbbVie", ABT: "Abbott Laboratories", ACN: "Accenture", ADBE: "Adobe", AIG: "AIG", AMD: "AMD", AMGN: "Amgen", AMT: "American Tower", AMZN: "Amazon",
    AVGO: "Broadcom", AXP: "American Express", BA: "Boeing", BAC: "Bank of America", BK: "BNY Mellon", BKNG: "Booking Holdings", BLK: "BlackRock", BMY: "Bristol-Myers Squibb", "BRK-B": "Berkshire Hathaway",
    C: "Citigroup", CAT: "Caterpillar", CHTR: "Charter Communications", CL: "Colgate-Palmolive", CMCSA: "Comcast", COF: "Capital One", COP: "ConocoPhillips", COST: "Costco", CRM: "Salesforce", CSCO: "Cisco",
    CVS: "CVS Health", CVX: "Chevron", DE: "Deere & Co", DHR: "Danaher", DIS: "Disney", DUK: "Duke Energy", EMR: "Emerson Electric", F: "Ford", FDX: "FedEx", GD: "General Dynamics", GE: "GE Aerospace",
    GILD: "Gilead Sciences", GM: "General Motors", GOOG: "Alphabet", GOOGL: "Alphabet", GS: "Goldman Sachs", HD: "Home Depot", HON: "Honeywell", IBM: "IBM", INTC: "Intel", INTU: "Intuit",
    ISRG: "Intuitive Surgical", JNJ: "Johnson & Johnson", JPM: "JPMorgan Chase", KO: "Coca-Cola", LIN: "Linde", LLY: "Eli Lilly", LMT: "Lockheed Martin", LOW: "Lowe's", MA: "Mastercard", MCD: "McDonald's",
    MDLZ: "Mondelez", MDT: "Medtronic", MET: "MetLife", META: "Meta Platforms", MMM: "3M", MO: "Altria", MRK: "Merck", MS: "Morgan Stanley", MSFT: "Microsoft", NEE: "NextEra Energy", NFLX: "Netflix",
    NKE: "Nike", NOW: "ServiceNow", NVDA: "Nvidia", ORCL: "Oracle", PEP: "PepsiCo", PFE: "Pfizer", PG: "Procter & Gamble", PLTR: "Palantir", PM: "Philip Morris", PYPL: "PayPal", QCOM: "Qualcomm",
    RTX: "RTX", SBUX: "Starbucks", SCHW: "Charles Schwab", SO: "Southern Co", SPG: "Simon Property", T: "AT&T", TGT: "Target", TMO: "Thermo Fisher", TMUS: "T-Mobile US", TSLA: "Tesla", TXN: "Texas Instruments",
    UBER: "Uber", UNH: "UnitedHealth", UNP: "Union Pacific", UPS: "UPS", USB: "U.S. Bancorp", V: "Visa", VZ: "Verizon", WFC: "Wells Fargo", WMT: "Walmart", XOM: "ExxonMobil",
    ADM: "Archer-Daniels-Midland", BG: "Bunge", CTVA: "Corteva", MOS: "Mosaic", NTR: "Nutrien", CF: "CF Industries", ANDE: "Andersons", INGR: "Ingredion", TSN: "Tyson Foods" };
  var SCLS = { GOOGL: "Class A", GOOG: "Class C", "BRK-B": "Class B", "BRK-A": "Class A" };
  function stk(x) { return x.c === "sp100" || x.c === "watch"; }
  function nm(x) { return stk(x) ? (CO[x.s] || x.s) : x.n; }
  function sub(x) { return stk(x) ? x.s + (SCLS[x.s] ? " · " + SCLS[x.s] : "") + " · " + (CNAME[x.c] || "") : (CNAME[x.c] || ""); }
  function dec(x) { var a = Math.abs(x); return a >= 1000 ? 2 : a >= 10 ? 2 : 4; }
  function num(x) { return x == null ? "—" : (+x).toLocaleString("en-US", { minimumFractionDigits: dec(x), maximumFractionDigits: dec(x) }); }
  function sg(x) { return x == null ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(2) + "%"; }
  function poll(force) {
    if (!force && Date.now() - lastTry < 30000) return; lastTry = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) {
      if (r.status === 304) return null; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; return r.json();
    }).catch(function () { return fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); })
      .then(function (j) { err = null; lastOk = Date.now(); if (j) take(j); else if (on()) paintHead(); })
      .catch(function (e) { err = String(e); if (on()) paintHead(); });
  }
  function take(j) {
    var first = !B; B = j;
    (B.events || []).forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; if (!first) fresh[e.id] = Date.now(); } });
    badge(); if (on()) paint();
  }
  function on() { return P.classList.contains("active"); }
  function badge() {
    var b = doc.getElementById("tabbtn-breakouts"), n = B ? (B.events || []).length : 0;
    if (b) b.setAttribute("data-brk-n", n);
    [].forEach.call(doc.querySelectorAll('[data-gnav="breakouts"]'), function (g) { var s = g.querySelector(".brk-n"); if (!s) { s = doc.createElement("span"); s.className = "brk-n"; g.appendChild(s); } s.textContent = n ? n : ""; });
  }
  function nextRun() { /* the engine runs at :02, :07, … every 5 min, 8:00–17:55 ET on weekdays */
    var t = new Date(), m = t.getUTCMinutes(), k = ((m - 2) % 5 + 5) % 5, d = new Date(t.getTime() + (5 - k) * 60000); d.setUTCSeconds(0); return d; }
  /* which averages are shown: SMA, EMA or both (owner, Nov 17) */
  function SMs() { return V.avg === "ema" ? [] : ["20", "50", "100", "200"]; }
  function EMs() { return V.avg === "sma" ? [] : ["9", "21", "50", "200"]; }
  function avgOk(k) { return !(V.avg === "sma" && /^ema_/.test(k)) && !(V.avg === "ema" && /^ma_/.test(k)); }
  function events() {
    var q = V.q.toLowerCase();
    return (B && B.events || []).filter(function (e) {
      return (V.cls === "all" || e.c === V.cls) && avgOk(e.k) && (V.kind === "all" || KMAP[e.k] === V.kind) && (!q || (e.s + " " + nm(e) + " " + (SCLS[e.s] || "") + " " + e.txt).toLowerCase().indexOf(q) >= 0);
    });
  }
  function head() {
    var up = B ? Date.parse(B.updated_at) : 0, age = up ? Math.round((Date.now() - up) / 60000) : null, nx = nextRun(), s = Math.max(0, Math.round((nx - Date.now()) / 1000));
    var wk = new Date().getUTCDay() % 6 === 0;
    return '<div class="brk-hd"><span class="brk-t">Breakouts</span><span class="brk-chip dl">DELAYED ~15 MIN</span>' +
      (B ? '<span class="brk-k">last run <b>' + ETS.format(new Date(up)) + " ET</b>" + (age != null ? " · " + age + " min ago" : "") + "</span>" : '<span class="brk-k">loading…</span>') +
      (wk ? '<span class="brk-k">weekend — engine resumes Monday 8:00 ET</span>' : '<span class="brk-k">next check <b data-brkcd>' + Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2) + "</b></span>") +
      (err ? '<span class="brk-chip er">fetch failed — retrying</span>' : "") +
      '<span class="brk-sp"></span><span class="brk-k">' + (B ? B.items.length + " names · " + (B.events || []).length + " events today" : "") + "</span></div>";
  }
  function paintHead() { var h = P.querySelector(".brk-hd"); if (h) h.outerHTML = head(); }
  function seg(attr, list, cur) { return list.map(function (x) { return '<button type="button" class="st-b" data-' + attr + '="' + x[0] + '" aria-selected="' + (cur === x[0]) + '">' + x[1] + "</button>"; }).join(""); }
  /* event text: numbers in plain price format (older runs wrote 5.087e+04), levels set in mono, the provisional note muted */
  function txt(t) {
    var h = esc(String(t).replace(/-?\d+(?:\.\d+)?e[+-]?\d+/gi, function (n) { return num(+n); }));
    h = h.replace(/\(([−\d.,]+)\)/g, '<b class="brk-lv">$1</b>').replace(/\(prior ([\d.,]+)\)/g, '<small>prior $1</small>');
    return h.replace(/ — provisional until the close/, ' <small class="brk-pv">provisional · confirms at the close</small>');
  }
  /* one line per name per minute: several crossings in the same bar read as one event with all its parts */
  function merge(L) {
    var out = [], by = {};
    L.forEach(function (e) { var k = e.s + "|" + String(e.t).slice(0, 16) + "|" + (e.dir > 0 ? 1 : -1); var g = by[k];
      if (!g) { g = by[k] = { id: e.id, t: e.t, s: e.s, n: e.n, c: e.c, k: e.k, dir: e.dir, px: e.px, pct: e.pct, parts: [] }; out.push(g); }
      g.parts.push(e); if (fresh[e.id]) g.id = e.id; });
    out.forEach(function (g) { var ks = {}; g.parts.forEach(function (p) { ks[p.k] = 1; }); g.multi = Object.keys(ks).length > 1;
      g.txt = g.parts.length === 1 ? g.parts[0].txt : g.parts.map(function (p) { return p.txt.replace(/ — provisional until the close/, ""); }).join(" · ") + (g.parts.some(function (p) { return /provisional/.test(p.txt); }) ? " — provisional until the close" : ""); });
    return out;
  }
  function row(e) {
    var f = fresh[e.id] && Date.now() - fresh[e.id] < 60000;
    return '<li class="brk-e ' + (e.dir > 0 ? "u" : e.dir < 0 ? "d" : "") + (f ? " new" : "") + '"><time>' + ET.format(new Date(e.t)) + " ET</time>" +
      '<span class="brk-tag ' + (e.dir > 0 ? "u" : "d") + '">' + (e.multi ? (e.dir > 0 ? "BREAKOUT ×" : "BREAKDOWN ×") + e.parts.length : (TAG[e.k] || e.k) + (e.parts && e.parts.length > 1 ? " ×" + e.parts.length : "")) + "</span>" +
      '<span class="brk-nm"><b>' + esc(nm(e)) + "</b><small>" + esc(sub(e)) + "</small></span>" +
      '<span class="brk-tx">' + txt(e.txt) + "</span>" +
      '<span class="brk-px">' + num(e.px) + ' <i class="' + (e.pct > 0 ? "up" : e.pct < 0 ? "dn" : "") + '">' + sg(e.pct) + "</i></span></li>";
  }
  function breadth() {
    if (!B) return "";
    var S = B.items.filter(function (i) { return i.c === "sp100" || i.c === "watch"; });
    var pct = function (n) { var h = S.filter(function (i) { return i.above && i.above[n] != null; }); return h.length ? Math.round(h.filter(function (i) { return i.above[n]; }).length / h.length * 100) : null; };
    var E = B.events || [], cnt = function (k) { return E.filter(function (e) { return e.k === k; }).length; };
    var bar = function (n) { var p = pct(n); return '<div class="brk-br"><span>Above ' + n + "-day SMA</span><i><em style=\"width:" + (p || 0) + '%"></em></i><b>' + (p == null ? "—" : p + "%") + "</b></div>"; };
    var epct = function (n) { var h = S.filter(function (i) { return i.above_ema && i.above_ema[n] != null; }); return h.length ? Math.round(h.filter(function (i) { return i.above_ema[n]; }).length / h.length * 100) : null; };
    var ebar = function (n) { var p = epct(n); return '<div class="brk-br e"><span>Above ' + n + '-day EMA</span><i><em style="width:' + (p || 0) + '%"></em></i><b>' + (p == null ? "—" : p + "%") + "</b></div>"; };
    var NM = {}; E.forEach(function (e) { NM[e.s] = stk(e) ? nm(e) + (SCLS[e.s] ? " " + SCLS[e.s].replace("Class ", "Cl ") : "") : e.n; });
    var lead = function (k) { var m = {}; E.filter(function (e) { return e.k === k; }).forEach(function (e) { m[e.s] = (m[e.s] || 0) + 1; }); return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, 6); };
    var chips = function (a) { return a.length ? a.map(function (s) { return '<button type="button" class="brk-chipb" data-brkq="' + esc(s) + '" title="' + esc(s) + '">' + esc(NM[s] || s) + "</button>"; }).join("") : '<span class="brk-k">none yet</span>'; };
    return '<aside class="brk-side"><div class="brk-box"><h3>Today so far</h3>' +
      '<div class="brk-kv"><span>New day highs</span><b class="up">' + cnt("day_high") + '</b></div><div class="brk-kv"><span>New day lows</span><b class="dn">' + cnt("day_low") + "</b></div>" +
      '<div class="brk-kv"><span>52-week highs / lows</span><b>' + cnt("w52_high") + " / " + cnt("w52_low") + '</b></div><div class="brk-kv"><span>SMA · EMA crossings</span><b>' + cnt("ma_px") + " · " + cnt("ema_px") + "</b></div>" +
      '<div class="brk-kv"><span>Closing breaks · MA crosses</span><b>' + (cnt("ma_close") + cnt("ma_cross") + cnt("ema_close") + cnt("ema_cross")) + "</b></div></div>" +
      '<div class="brk-box"><h3>Stocks above their averages <small>S&amp;P 100 + watchlist, now</small></h3>' + (V.avg !== "ema" ? bar(20) + bar(50) + bar(100) + bar(200) : "") + (V.avg !== "sma" ? ebar(21) + ebar(50) + ebar(200) : "") + "</div>" +
      '<div class="brk-box"><h3>Most new highs</h3>' + chips(lead("day_high")) + '<h3 style="margin-top:10px">Most new lows</h3>' + chips(lead("day_low")) + "</div></aside>";
  }
  /* Price vs averages: every name, above (▲) or below (▼) each simple and exponential average, with the level and distance */
  function score(i) { var SM = SMs(), EM = EMs(); var a = SM.map(function (n) { return i.above && i.above[n]; }).concat(EM.map(function (n) { return i.above_ema && i.above_ema[n]; })).filter(function (x) { return x != null; }); return a.length ? a.filter(Boolean).length / a.length : null; }
  function verdict(i) {
    var sc = score(i); if (sc == null) return ["—", ""];
    var e = V.avg === "sma" ? { "9": (i.ma || {})["20"], "21": (i.ma || {})["50"], "50": (i.ma || {})["100"] } : i.ema || {}, sU = e["9"] != null && e["21"] != null && e["50"] != null && e["9"] > e["21"] && e["21"] > e["50"], sD = e["9"] != null && e["21"] != null && e["50"] != null && e["9"] < e["21"] && e["21"] < e["50"];
    if (sc === 1 && sU) return ["Strong uptrend", "bull2"]; if (sc === 0 && sD) return ["Strong downtrend", "bear2"];
    if (sc >= 0.75) return ["Bullish", "bull"]; if (sc <= 0.25) return ["Bearish", "bear"];
    return [(i.above_ema && i.above_ema["200"] ? "Mixed · above 200 EMA" : i.above_ema && i.above_ema["200"] === false ? "Mixed · below 200 EMA" : "Mixed"), "mix"];
  }
  function cell(lv, last) {
    if (lv == null) return '<td class="na">—</td>';
    var d = (last / lv - 1) * 100, up = last > lv;
    return '<td class="' + (up ? "up" : "dn") + '" title="Average ' + num(lv) + " · price " + (up ? "above" : "below") + " by " + Math.abs(d).toFixed(2) + '%"><b>' + (up ? "▲" : "▼") + " " + num(lv) + "</b><i>" + (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "%</i></td>";
  }
  function statusView() {
    var q = V.q.toLowerCase(), L = (B.items || []).filter(function (i) { return (V.cls === "all" || i.c === V.cls) && (!q || (i.s + " " + nm(i) + " " + (SCLS[i.s] || "")).toLowerCase().indexOf(q) >= 0); });
    var key = { name: function (i) { return nm(i) + " " + i.s; }, pct: function (i) { return i.pct == null ? -1e9 : i.pct; }, score: function (i) { var x = score(i); return x == null ? -1 : x; } };
    L.sort(function (a, b) { var A = key[V.sort](a), B2 = key[V.sort](b); return (A > B2 ? 1 : A < B2 ? -1 : 0) * V.dir; });
    var th = function (k, t) { return '<th><button type="button" data-brks="' + k + '">' + t + (V.sort === k ? (V.dir < 0 ? " ▼" : " ▲") : "") + "</button></th>"; };
    var SM = SMs(), EM = EMs(), N = SM.length + EM.length;
    return '<div class="brk-stw"><table class="brk-st"><thead><tr class="grp"><th colspan="3"></th>' + (SM.length ? '<th colspan="4">Simple moving averages (SMA)</th>' : "") + (EM.length ? '<th colspan="4">Exponential moving averages (EMA)</th>' : "") + "<th></th></tr><tr>" +
      th("name", "Name") + "<th>Last</th>" + th("pct", "Chg") + SM.map(function (n) { return "<th>" + n + "-day</th>"; }).join("") + EM.map(function (n) { return "<th>" + n + "-day</th>"; }).join("") + th("score", "Trend") + "</tr></thead><tbody>" +
      L.map(function (i) { var v = verdict(i), sc = score(i);
        return '<tr><th><b>' + esc(nm(i)) + "</b><small>" + esc(sub(i)) + "</small></th><td>" + num(i.last) + '</td><td class="' + (i.pct > 0 ? "up" : i.pct < 0 ? "dn" : "") + '">' + sg(i.pct) + "</td>" +
          SM.map(function (n) { return cell(i.ma && i.ma[n], i.last); }).join("") + EM.map(function (n) { return cell(i.ema && i.ema[n], i.last); }).join("") +
          '<td class="vd ' + v[1] + '"><b>' + v[0] + "</b>" + (sc != null ? "<i>above " + Math.round(sc * N) + " of " + N + "</i>" : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<p class="brk-note">▲ = price above that average, ▼ = below; the level and the distance from the latest price are shown. Averages use completed daily closes; the price is the latest delayed quote. Trend (on the averages shown): strong uptrend = above every one with the short averages stacked (9 &gt; 21 &gt; 50 EMA, or 20 &gt; 50 &gt; 100 SMA); bullish = above at least 3 in 4; bearish = above 1 in 4 or fewer. EMA weights recent closes more (factor 2/(n+1)), so it turns sooner than the SMA of the same length.</p>';
  }
  function paint() {
    if (!B) { P.innerHTML = head() + '<p class="brk-none">Loading the breakout stream…</p>'; return; }
    var L = V.paused ? (V.snap || []) : events(), missed = V.paused ? Math.max(0, events().length - V.snapN) : 0;
    P.innerHTML = head() +
      '<div class="st-nav brk-nav" role="tablist" aria-label="Universe">' + seg("brkc", CLS, V.cls) + "</div>" +
      '<div class="brk-vw">' + seg("brkv", [["stream", "Live stream"], ["status", "Price vs averages"]], V.view) +
        '<span class="brk-avg" role="group" aria-label="Averages shown"><span>Averages</span>' + seg("brka", [["sma", "SMA"], ["ema", "EMA"], ["both", "Both"]], V.avg) + "</span></div>" +
      (V.view === "status" ? '<div class="brk-bar"><input type="search" placeholder="Filter: company or ticker…" value="' + esc(V.q) + '" data-brkqi></div>' + statusView() :
      '<div class="brk-bar"><span class="brk-seg">' + seg("brkk", KIND.filter(function (k) { return !(V.avg === "sma" && k[0] === "ema") && !(V.avg === "ema" && k[0] === "ma"); }), V.kind) + '</span><input type="search" placeholder="Filter: company, ticker or event…" value="' + esc(V.q) + '" data-brkqi>' +
      '<button type="button" class="brk-pause" data-brkp>' + (V.paused ? "Paused · resume (" + missed + " new)" : "Pause") + "</button></div>" +
      '<div class="brk-lay"><section class="brk-main"><ol class="brk-feed">' + (L.length ? merge(L).slice(0, 300).map(row).join("") : '<li class="brk-none">No events match yet today. The stream fills as the session trades.</li>') + "</ol>" +
      '<p class="brk-note">Every line is stamped with the 5-minute bar that produced it (ET). Day high/low: the first 15 minutes only set the range, then at most one event per name per 30 minutes (the price shown is the latest). MA crossings during the day are provisional; “Closed above/below” and MA × MA crosses use the completed daily close. ' +
      "Prices: " + esc(B.provider) + " · universe: watchlist, North American indexes, currencies and " + esc(B.universe_src) + (B.counts && B.counts.missing && B.counts.missing.length ? " · not returned this run: " + esc(B.counts.missing.join(", ")) : "") + ".</p></section>" + breadth() + "</div>");
  }
  doc.addEventListener("click", function (ev) {
    var t = ev.target.closest && ev.target.closest("[data-brkc],[data-brkk],[data-brkp],[data-brkq],[data-brkv],[data-brks],[data-brka]"); if (!t || !P.contains(t)) return;
    if (t.hasAttribute("data-brka")) { V.avg = t.getAttribute("data-brka"); if ((V.avg === "sma" && V.kind === "ema") || (V.avg === "ema" && V.kind === "ma")) V.kind = "all"; save(); }
    else if (t.hasAttribute("data-brkv")) { V.view = t.getAttribute("data-brkv"); save(); }
    else if (t.hasAttribute("data-brks")) { var k = t.getAttribute("data-brks"); if (V.sort === k) V.dir = -V.dir; else { V.sort = k; V.dir = k === "name" ? 1 : -1; } }
    else if (t.hasAttribute("data-brkc")) { V.cls = t.getAttribute("data-brkc"); save(); }
    else if (t.hasAttribute("data-brkk")) { V.kind = t.getAttribute("data-brkk"); save(); }
    else if (t.hasAttribute("data-brkq")) { V.q = t.getAttribute("data-brkq"); }
    else if (t.hasAttribute("data-brkp")) { V.paused = !V.paused; if (V.paused) { V.snap = events(); V.snapN = V.snap.length; } }
    if (V.paused && !t.hasAttribute("data-brkp")) { V.snap = events(); V.snapN = V.snap.length; }
    paint();
  });
  doc.addEventListener("input", function (ev) { if (ev.target.hasAttribute && ev.target.hasAttribute("data-brkqi")) { V.q = ev.target.value; var pos = ev.target.selectionStart; paint(); var i = P.querySelector("[data-brkqi]"); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } } });
  setInterval(function () { if (root.DESK_LOCKED) return; poll(); var c = P.querySelector("[data-brkcd]"); if (c && on()) { var s = Math.max(0, Math.round((nextRun() - Date.now()) / 1000)); c.textContent = Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); } }, 1000);
  setInterval(function () { if (on() && B && Object.keys(fresh).length) { var n = Date.now(), any = false; Object.keys(fresh).forEach(function (k) { if (n - fresh[k] > 60000) { delete fresh[k]; any = true; } }); if (any && !V.paused) paint(); } }, 15000);
  if (root.MutationObserver) new MutationObserver(function () { if (on() && !P.querySelector(".brk-hd")) paint(); }).observe(P, { attributes: true, attributeFilter: ["class"] });
  poll(true);
  var css = doc.createElement("style");
  css.textContent = "#panel-breakouts{background:#000;padding-right:44px;font-family:'Libre Franklin',system-ui,sans-serif}" +
    ".brk-hd{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:12px 4px 10px;border-bottom:1px solid #1a1a1a}.brk-t{font:600 20px 'Libre Franklin',system-ui,sans-serif;color:#fff}.brk-sp{flex:1}" +
    ".brk-chip{font:700 10px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;border:1px solid;border-radius:3px;padding:1px 6px}.brk-chip.dl{color:#e8b93d}.brk-chip.er{color:#e0655f}" +
    ".brk-k{font:12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#8a8a8a}.brk-k b{color:#e8eef4;font-weight:500}" +
    ".brk-nav{margin:6px 0 4px}.brk-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:6px 0 12px}.brk-seg{display:flex;flex-wrap:wrap;gap:0 2px}" +
    ".brk-bar input{flex:1 1 220px;min-width:0;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#e8eef4;padding:6px 10px;font:13px 'Libre Franklin',system-ui,sans-serif}" +
    ".brk-pause{all:unset;cursor:pointer;border:1px solid #2a2a2a;border-radius:6px;padding:5px 12px;font:12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#c9d4e2}.brk-pause:hover{border-color:#555}" +
    ".brk-lay{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px}.brk-main{min-width:0}" +
    ".brk-feed{list-style:none;margin:0;padding:0;border:1px solid #1a1a1a;border-radius:8px}.brk-e{display:grid;grid-template-columns:84px 92px 150px minmax(0,1fr) 150px;gap:10px;align-items:center;padding:7px 12px;border-bottom:1px solid #111;font-size:13px}" +
    ".brk-e:last-child{border-bottom:0}.brk-e time{font:12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#8a8a8a}.brk-e.u{box-shadow:inset 3px 0 0 #3fb97f}.brk-e.d{box-shadow:inset 3px 0 0 #e0655f}" +
    ".brk-e.new{animation:brkNew 2.5s ease-out}@keyframes brkNew{0%{background:rgba(217,180,106,.25)}100%{background:transparent}}" +
    ".brk-tag{font:700 9.5px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.04em;border-radius:3px;padding:2px 6px;text-align:center;color:#000}.brk-tag.u{background:#3fb97f}.brk-tag.d{background:#e0655f}" +
    ".brk-nm{display:flex;flex-direction:column;min-width:0}.brk-nm b{color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brk-nm small{color:#666;font-size:10.5px}" +
    ".brk-tx{color:#c9d4e2;min-width:0}.brk-lv{font:500 12.5px 'JetBrains Mono','IBM Plex Mono',monospace;color:#fff;margin:0 2px}.brk-tx small{color:#777;font-size:11px;margin-left:6px}.brk-pv{border:1px solid #2a2a2a;border-radius:3px;padding:0 5px;font:10px 'JetBrains Mono','IBM Plex Mono',monospace!important;letter-spacing:.03em}.brk-px{font:12.5px 'JetBrains Mono','IBM Plex Mono',monospace;color:#e8eef4;text-align:right;white-space:nowrap}.brk-px i{font-style:normal;margin-left:6px}.brk-px .up,.up{color:#3fb97f}.brk-px .dn,.dn{color:#e0655f}" +
    ".brk-none{color:#8a8a8a;padding:14px;font-size:13px;list-style:none}.brk-note{font-size:11px;color:#666;line-height:1.5;margin:8px 2px}" +
    ".brk-side{display:flex;flex-direction:column;gap:12px}.brk-box{border:1px solid #1a1a1a;border-radius:8px;padding:10px 12px}.brk-box h3{margin:0 0 8px;font:600 12px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:#d9b46a}.brk-box h3 small{text-transform:none;letter-spacing:0;color:#666;font-weight:400}" +
    ".brk-kv{display:flex;justify-content:space-between;font-size:12.5px;color:#8a8a8a;padding:2px 0}.brk-kv b{white-space:nowrap;color:#e8eef4;font:500 13px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".brk-br{display:grid;grid-template-columns:96px minmax(0,1fr) 40px;gap:8px;align-items:center;font-size:12px;color:#8a8a8a;margin:4px 0}.brk-br i{height:8px;background:#151515;border-radius:4px;overflow:hidden}.brk-br em{display:block;height:100%;background:#38b6c9}.brk-br b{text-align:right;color:#e8eef4;font:500 12px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".brk-chipb{all:unset;cursor:pointer;display:inline-block;margin:0 6px 6px 0;border:1px solid #2a2a2a;border-radius:4px;padding:2px 8px;font:12px 'JetBrains Mono','IBM Plex Mono',monospace;color:#e8eef4}.brk-chipb:hover{border-color:#d9b46a}" +
    ".brk-n{margin-left:6px;font:700 10px 'JetBrains Mono','IBM Plex Mono',monospace;color:#000;background:#d9b46a;border-radius:8px;padding:0 5px}.brk-n:empty{display:none}" +
    ".brk-vw{display:flex;gap:6px;margin:4px 0 8px}.brk-vw .st-b{border:1px solid #1f1f1f;border-radius:999px;padding:5px 14px;margin:0}.brk-vw .st-b[aria-selected=true]{border-color:#d9b46a;color:#d9b46a}" +
    ".brk-vw{align-items:center;flex-wrap:wrap}.brk-avg{margin-left:auto;display:inline-flex;align-items:center;border:1px solid #1f1f1f;border-radius:999px;padding:2px}.brk-avg>span{font:600 10px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#777;padding:0 8px 0 10px}" +
    ".brk-avg .st-b{border:0!important;border-radius:999px;padding:4px 12px;margin:0}.brk-avg .st-b[aria-selected=true]{background:#1a1a1a;color:#d9b46a}" +
    ".brk-br{grid-template-columns:120px minmax(0,1fr) 40px}.brk-br.e em{background:#9b7be0}" +
    ".brk-stw{overflow-x:auto;border:1px solid #1a1a1a;border-radius:8px}.brk-st{border-collapse:collapse;width:100%;font:12px 'JetBrains Mono','IBM Plex Mono',monospace}" +
    ".brk-st th,.brk-st td{padding:6px 8px;border-bottom:1px solid #111;text-align:right;white-space:nowrap}.brk-st thead th{background:#050505;color:#777;font-weight:500;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}" +
    ".brk-st thead tr:last-child th:first-child{text-align:left}.brk-st thead tr.grp th{color:#d9b46a;text-align:center;border-bottom:1px solid #1a1a1a}.brk-st thead button{all:unset;cursor:pointer}.brk-st thead button:hover{color:#fff}" +
    ".brk-st tbody th{text-align:left;font-family:'Libre Franklin',system-ui,sans-serif}.brk-st tbody th b{color:#fff;font-weight:600;margin-right:6px}.brk-st tbody th small{color:#666;font-size:10.5px}" +
    ".brk-st td b{font-weight:500}.brk-st td i{display:block;font-style:normal;font-size:10.5px;opacity:.75}.brk-st td.up{color:#3fb97f}.brk-st td.dn{color:#e0655f}.brk-st td.na{color:#444}" +
    ".brk-st td.vd{text-align:left}.brk-st td.vd i{color:#777}.vd.bull,.vd.bull2{color:#3fb97f}.vd.bear,.vd.bear2{color:#e0655f}.vd.mix{color:#e8b93d}.vd.bull2 b,.vd.bear2 b{font-weight:700}" +
    "@media (max-width:760px){#panel-breakouts{padding-right:0}}" +
    "@media (max-width:980px){.brk-lay{grid-template-columns:1fr}}" +
    "@media (max-width:640px){.brk-e{grid-template-columns:72px minmax(0,1fr) auto;grid-template-areas:'t n p' 't g g' 't x x'}.brk-e time{grid-area:t}.brk-tag{grid-area:g;justify-self:start}.brk-nm{grid-area:n}.brk-tx{grid-area:x}.brk-px{grid-area:p}.brk-bar .brk-seg{overflow-x:auto;flex-wrap:nowrap}}";
  doc.head.appendChild(css);
  root.BREAKOUTS = { poll: poll, data: function () { return B; }, repaint: function () { if (!V.paused) paint(); } };
})(window);
/* "Open Breakouts →" buttons elsewhere on the desk */
document.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-gnav-go]"); if (!b) return; var g = document.querySelector('[data-gnav="' + b.getAttribute("data-gnav-go") + '"]'); if (g) g.click(); });
