/* Events desk — today's scheduled releases from every desk (Toronto calendar day) with live
   countdowns, plus a right-rail milestone feed that records what changed across the app.
   Self-contained: reads the page's existing schedule helpers and data; never changes them. */
(function () {
  "use strict";
  var TZ = "America/Toronto", MIN = 60000, H = 3600000;
  var P = document.getElementById("panel-events"), BTN = document.getElementById("tabbtn-events");
  if (!P || !BTN) return;

  /* ---------- small helpers ---------- */
  function esc(s) { return DeskCore.esc(s); }
  var DIF = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  function dayIso(t) { return DIF.format(new Date(t)); }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
  function dayLabel(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }); }
  function shortDay(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }); }
  function hms(ms) { return window.hmsText ? window.hmsText(ms) : Math.max(0, Math.round(ms / 60000)) + "m"; }
  function wdOf(t) { return new Date(t).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }); }
  function zms(iso, h, m) { var p = iso.split("-"); return window.zonedMs(+p[0], +p[1], +p[2], h, m, TZ); }
  function ready() { return window.DATA && DATA.meta && DATA.fx && window.zonedMs && window.agriEvents; }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- categories ---------- */
  var CAT = {
    usda:   { l: "USDA",     c: "#3fb97f" },
    wasde:  { l: "WASDE",    c: "#e8b93d" },
    cftc:   { l: "CFTC",     c: "#c9a3ff" },
    contract:{ l: "CONTRACT", c: "#ff9d6e" },
    ca:     { l: "CANADA",   c: "#ff8a84" },
    macro:  { l: "MACRO",    c: "#6ea8ff" },
    energy: { l: "ENERGY",   c: "#f0a35e" },
    market: { l: "MARKET",   c: "#38b6c9" },
    desk:   { l: "DESK DATA",c: "#9aa8bb" },
    cb:     { l: "CENTRAL BANK", c: "#6ea8ff" },
    leg:    { l: "LEGISLATION", c: "#c9a3ff" },
    earn:   { l: "EARNINGS", c: "#f5c542" }
  };
  var GROUPS = [["all", "All"], ["agri", "Agri"], ["macro", "Macro"], ["cb", "Central banks"], ["leg", "Legislation"], ["earn", "Earnings"], ["market", "Markets"], ["desk", "Desk data"]];
  function groupOf(e) { return e.kind === "cb" ? "cb" : e.kind === "leg" ? "leg" : e.kind === "earn" ? "earn" : e.kind === "macro" || e.kind === "energy" ? "macro" : e.kind === "market" ? "market" : e.kind === "desk" ? "desk" : "agri"; }
  var V = store.get("desk.eventsView") || { grp: "all", high: false };
  V.day = V.day || "today"; V.imp = V.imp || { H: true, M: true, L: true }; V.ccs = V.ccs || { us: true, ca: true }; V.cat = V.cat || "all"; V.q = ""; V.open = V.open || "";
  V.track = V.track || {};   /* categories switched off by the user (default: everything tracked) */
  function tracked(e) { return V.track[groupOf(e)] !== false; }
  function saveV() { store.set("desk.eventsView", V); }

  /* ---------- today's events from every source on the page ---------- */
  /* speed: a day's event list is built once and reused until the desk data changes or a minute passes (it was rebuilt for
     every day of every range on each click: ~40 rebuilds per redraw) */
  var MEMO = {}, MEMO_STAMP = "", MEMO_REF = [];
  function todayEvents(now) {
    var d = window.DATA || {}, fx = d.fx || {}, ev = fx.events || [], k = dayIso(now);
    var ref = [d, fx, ev, d.release_cal, window.POLICY && POLICY._data && POLICY._data(), window.BRIEFING && BRIEFING._data && BRIEFING._data(), window.EARNINGS && EARNINGS._data && EARNINGS._data()];   /* any source object replaced → rebuild */
    var st = ((d.meta && d.meta.updated_at) || "") + "|" + ev.length + "|" + Math.floor(Date.now() / 60000);
    if (st !== MEMO_STAMP || ref.some(function (r, i) { return r !== MEMO_REF[i]; })) { MEMO = {}; MEMO_STAMP = st; MEMO_REF = ref; }
    if (!MEMO[k]) MEMO[k] = todayEvents0(now);
    return MEMO[k].map(function (e) { return e; });
  }
  function todayEvents0(now) {
    var today = dayIso(now), out = [], seen = {};
    function add(e) {
      if (!isFinite(e.t) || dayIso(e.t) !== today) return;
      var id = e.kind + "|" + e.label + "|" + e.t; if (seen[id]) return; seen[id] = 1; e.id = id; out.push(e);
    }
    /* agriculture: USDA weekly reports, WASDE, CFTC, CBOT contract dates, Canada (AAFC / StatCan) */
    try {
      window.agriEvents(now - 30 * H, 3).forEach(function (e) {
        var k = e.kind === "contract" ? "contract" : e.kind === "wasde" ? "wasde" : e.kind === "cftc" ? "cftc" : e.kind === "ca" ? "ca" : "usda";
        var g = /^Wheat/.test(e.label) ? "wheat" : /^Soybeans/.test(e.label) ? "soybeans" : "corn";
        add({ t: e.t, label: e.label, kind: k, cc: k === "ca" ? "ca" : "us", high: k === "wasde" || k === "contract",
          go: k === "contract" || k === "cftc" ? g + ":deriv" : k === "wasde" || k === "ca" ? "corn:fund" : "corn:overview" });
      });
    } catch (x) {}
    /* macro calendar (US + Canada, every impact level) */
    var macroAt = {};
    (DATA.fx.events || []).forEach(function (e) {
      var t = window.evEpoch ? window.evEpoch(e) : NaN; if (!isFinite(t)) return;
      var energy = /crude|oil|natural gas|petroleum|gasoline|distillate|API Weekly|EIA/i.test(e.event);
      macroAt[e.ccy + "|" + t] = 1;
      /* FOMC minutes / BoC Summary of deliberations: one row, from the central-bank calendar below (it carries the summary) */
      if (/FOMC (?:meeting )?minutes|summary of (?:governing council )?deliberations/i.test(e.event)) return;
      add({ t: t, label: e.ccy + " " + e.event, kind: energy ? "energy" : "macro", cc: e.ccy === "CAD" ? "ca" : "us", impact: e.impact, high: e.impact === "High",
        fc: e.fc, prev: e.prev, go: energy ? "corn:inputs" : "macro:dash" });
    });
    /* official release calendars the desk tracks directly (only where the macro calendar has no entry at that minute) */
    var RC = DATA.release_cal || {}, names = {};
    (window.macroAll ? macroAll() : []).forEach(function (m) { names[m.key] = m; });
    Object.keys(RC).forEach(function (k) {
      var m = names[k], ccy = k.indexOf("ca_") === 0 ? "CAD" : "USD";
      (RC[k].dates || []).forEach(function (d) {
        var a = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(d); if (!a) return;
        var t = zms(a[1], +a[2], +a[3]); if (macroAt[ccy + "|" + t]) return;
        add({ t: t, label: ccy + " " + (m ? m.name : k.replace(/^(us|ca)_/, "").toUpperCase()), kind: "macro", mkey: k, cc: ccy === "CAD" ? "ca" : "us", impact: "High", high: true, go: "macro:dash" });
      });
    });
    try {
      var PJ = window.POLICY && POLICY._data();
      ((PJ && PJ.calendar) || []).forEach(function (c) {
        if ((c.bank === "fed" || c.bank === "boc") && c.kind === "decision") return;
        var p = c.date.split("-"), tz = c.tz === "Europe/Frankfurt" ? "Europe/Berlin" : c.tz, hm2 = (c.time || "12:00").split(":"), t;
        try { t = window.zonedMs(+p[0], +p[1], +p[2], +hm2[0], +hm2[1], tz); } catch (x) { return; }
        var B = (PJ.banks || {})[c.bank] || {};
        add({ t: t, label: (B.name || c.bank.toUpperCase()) + ": " + c.what + (c.time ? "" : " (time TBA)"), kind: "cb", cc: B.cc, high: c.kind === "decision", go: "policy",
          bank: c.bank, mins: c.kind === "minutes" });
      });
    } catch (x) {}
    /* legislation: Commons sitting days, U.S. committee hearings and House floor week (Briefing tab data) */
    try {
      var LG = window.BRIEFING && BRIEFING._data() && BRIEFING._data().legislation;
      if (LG && LG.ca && LG.ca.calendar && (LG.ca.calendar.next || []).indexOf(today) >= 0)
        add({ t: zms(today, wdOf(now) === "Mon" ? 11 : 10, 0), label: "House of Commons sits (Parliament of Canada)", kind: "leg", cc: "ca", go: "briefing" });
      if (LG && LG.ca && LG.ca.calendar) (LG.ca.calendar.breaks || []).forEach(function (b) { if (b.returns === today) add({ t: zms(today, 11, 0), label: "House of Commons returns from its break", kind: "leg", cc: "ca", high: true, go: "briefing" }); });
      if (LG && LG.us) (LG.us.hearings || []).forEach(function (h) { var t = Date.parse(h.date); add({ t: t, label: "U.S. " + h.chamber + " hearing: " + h.title.slice(0, 110), kind: "leg", cc: "us", high: !!(h.topics && h.topics.length), go: "briefing" }); });
      if (LG && LG.us && LG.us.floor && LG.us.floor.week && !LG.us.floor.stale && (LG.us.floor.items || []).length && ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wdOf(now)) >= 0)
        add({ t: zms(today, 12, 0), label: "U.S. House floor this week: " + LG.us.floor.items.slice(0, 3).map(function (i) { return i.code; }).join(", ") + (LG.us.floor.items.length > 3 ? " +" + (LG.us.floor.items.length - 3) : ""), kind: "leg", cc: "us", go: "briefing" });
    } catch (x) {}
    /* earnings: watchlist companies reporting today (US Earnings tab data) */
    try {
      var EJ = window.EARNINGS && EARNINGS._data();
      ((EJ && EJ.upcoming && EJ.upcoming.rows) || []).forEach(function (r) {
        if ((r.date || "").slice(0, 10) !== today) return;
        var tm = String(r.time || "").toLowerCase(), t = zms(today, /amc|after/.test(tm) ? 16 : 7, /amc|after/.test(tm) ? 15 : 0);
        add({ t: t, label: (r.symbol || "") + " earnings" + (/bmo|before/.test(tm) ? " (before the open)" : /amc|after/.test(tm) ? " (after the close)" : "") + (r.epsEstimated != null ? " · EPS est " + r.epsEstimated : ""), kind: "earn", cc: "us", go: "earnings" });
      });
    } catch (x) {}
    var wd = wdOf(now), weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wd) >= 0;
    /* EIA weekly reports used on the Input costs view (skipped when the macro calendar already lists them) */
    var hasE = out.some(function (e) { return e.kind === "energy"; });
    if (!hasE && wd === "Wed") add({ t: zms(today, 10, 30), label: "EIA weekly petroleum status (diesel, propane)", kind: "energy", cc: "us", go: "corn:inputs" });
    if (!hasE && wd === "Thu") add({ t: zms(today, 10, 30), label: "EIA natural gas storage", kind: "energy", cc: "us", go: "corn:inputs" });
    if (weekday) {
      /* CBOT grain sessions (Central time + 1 h) and the USD/CAD reference fixes */
      add({ t: zms(today, 9, 30), label: "CBOT grains day session opens", kind: "market", cc: "us", go: "corn:overview" });
      add({ t: zms(today, 14, 20), label: "CBOT grains close · settlement", kind: "market", cc: "us", high: true, go: "corn:overview" });
      add({ t: zms(today, 16, 30), label: "Bank of Canada daily USD/CAD rate", kind: "market", cc: "ca", go: "fx:overview" });
      /* desk's own options/open-interest runs */
      add({ t: zms(today, 8, 45), label: "Options OI, IV, rollover & CORRA refresh on the desk (preliminary open interest)", kind: "desk", go: "corn:deriv" });
      add({ t: Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10), 12, 23), label: "Brazil & World fundamentals refresh (CONAB · USDA · Comex)", kind: "desk", go: "corn:fund" });
      add({ t: Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10), 17, 23), label: "Brazil & World fundamentals refresh (CONAB · USDA · Comex)", kind: "desk", go: "corn:fund" });
    }
    if (["Sun", "Mon", "Tue", "Wed", "Thu"].indexOf(wd) >= 0) add({ t: zms(today, 20, 0), label: "CBOT grains overnight session opens", kind: "market", cc: "us", go: "corn:overview" });
    return out.sort(function (a, b) { return a.t - b.t || (b.high ? 1 : 0) - (a.high ? 1 : 0); });
  }
  function nextAfterToday(now) {   /* first event on a later day, for the empty state */
    var end = now, best = null;
    for (var i = 1; i <= 6 && !best; i++) {
      end = now + i * 86400000;
      var list = todayEvents(end).filter(function (e) { return pass(e); });
      if (list.length) best = list.filter(function (e) { return e.kind !== "market" && e.kind !== "desk"; })[0] || list[0];
    }
    return best;
  }
  function srcOf(e) { if (e.kind === "desk" || e.kind === "market") return "desk"; var L = e.t <= Date.now() ? landed(e) : null; return L && L.at && L.txt ? "actual" : "cal"; }
  /* calendar view (owner redesign): importance H/M/L, US + Canada only, one category filter, free-text search */
  function imp(e) { if (e.impact) return e.impact[0]; if (e.kind === "wasde" || e.kind === "contract") return "H"; if (/^(usda|cftc|ca|earn|energy)$/.test(e.kind)) return "M";
    if (e.kind === "cb") return e.high ? "H" : "M"; if (e.kind === "leg" || e.kind === "market") return e.high ? "M" : "L"; return "L"; }
  function ccIn(e) { var c = ccOf(e); return !c || c === "us" || c === "ca"; }
  function pass(e) { var c = ccOf(e); return ccIn(e) && (!c || V.ccs[c] !== false) && (V.cat === "all" || groupOf(e) === V.cat) && V.imp[imp(e)] !== false &&
    (!V.q || (e.label + " " + (CAT[e.kind] || {}).l).toLowerCase().indexOf(V.q.toLowerCase()) >= 0); }

  /* ---------- rendering ---------- */
  /* the flag must match the event's own country: a Bank of England row never carries a Canada flag */
  var CTRY = [[/Bank of England|\bBoE\b|\bUK\b|British/i, "gb"], [/\bECB\b|Euro ?(area|zone)/i, "eu"], [/Bank of Japan|\bBoJ\b|Japan/i, "jp"], [/\bRBA\b|Australia/i, "au"], [/\bRBNZ\b|New Zealand/i, "nz"], [/\bSNB\b|Swiss/i, "ch"], [/\bPBoC\b|China/i, "cn"],
    [/Bank of Canada|\bBoC\b|Canada|^CAD /i, "ca"], [/\bFed\b|FOMC|Federal Reserve|U\.S\.|^USD /i, "us"]];
  function ccOf(e) { for (var i = 0; i < CTRY.length; i++) if (CTRY[i][0].test(e.label || "")) return CTRY[i][1]; return e.cc; }
  function flagOf(e) { var cc = ccOf(e); return cc && window.flag ? window.flag(cc, 13) + " " : ""; }
  function chip(e) { var c = CAT[e.kind] || CAT.desk; return '<span class="evc" style="--ec:' + c.c + '">' + c.l + "</span>"; }
  function deskName(go) { var a = (go || "").split("@")[0].split(":"); if (a[0] === "world") return "World markets"; if (a[0] === "briefing") return "Briefing · legislation"; if (a[0] === "earnings") return "US Earnings"; if (a[0] === "events") return "Events"; if (a[0] === "policy") return "Policy · " + (a[1] ? "evidence" : "calendar"); return ({ corn: "Corn", wheat: "Wheat", soybeans: "Soybeans", fx: "USD/CAD", macro: "Macro" })[a[0]] + " · " + ({ overview: "Overview", deriv: "Derivatives", fund: "Fundamentals", inputs: "Input costs", macro: "Macro", dash: "Dashboard", cycle: "Cycle & Fed policy", trade: "Trade & fiscal", rel: "Releases" })[a[1]]; }
  /* one calendar row: time · country · importance · event · actual · forecast · previous · status; click to expand */
  var IMPN = { H: "High", M: "Medium", L: "Low" };
  function actualOf(e, LD) { var k = relKey(e); if (!LD || !LD.at || !k || !k.macro) return LD && LD.at && LD.txt && !k.macro ? "" : ""; var m = window.mfind && mfind(k.macro); return m ? (window.mval ? mval(m, m.value) : m.value) : ""; }
  function row(e, now) {
    var d = e.t - now, st = d > 15 * MIN ? "up" : d > 0 ? "soon" : d > -10 * MIN ? "due" : "out";
    var LD = st === "out" || st === "due" ? landed(e) : null;
    var stat = LD && LD.at ? '<span class="evs land">✓ On the desk ' + hm(LD.at) + " <small>(" + lagTxt2(LD.at - e.t) + ")</small></span>"
      : st === "out" ? '<span class="evs out">' + (LD && LD.pending ? "Released " + hm(e.t) + " · awaiting desk" : LD && LD.none ? "Out · " + hm(e.t) : "Out · " + hm(e.t) + " · calendar only") + "</span>"
      : st === "due" ? '<span class="evs due">Due now' + (LD && LD.pending ? " — desk checking the source" : "") + "</span>"
      : '<span class="countdown" data-t="' + e.t + '" data-fmt="hms">' + hms(d) + "</span>";
    var see = LD && LD.at && LD.go ? '<button class="evgo see" data-evgo="' + esc(LD.go) + '" data-evsel="' + esc(LD.sel || "") + '" title="Go to where this number is shown">See it: ' + esc(LD.where) + " →</button>" : "";
    var etd = function (t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }, rt = LD && LD.at && etd(LD.at) === etd(now);   /* BRD 16C: ET day of release only */
    var k = relKey(e), m = k && k.macro && window.mfind ? mfind(k.macro) : null, act = actualOf(e, LD), I = imp(e), cc = ccOf(e);
    var prev = e.prev || (m && LD && LD.at && m.prior != null && window.mval ? mval(m, m.prior) : "");
    var open = V.open === e.id, ctry = cc === "ca" ? "Canada" : cc === "us" ? "United States" : "—";
    var h = '<tr class="evr st-' + st + (e.high ? " hi" : "") + (rt ? " rel-today" : "") + (open ? " open" : "") + (m ? " evmac" : "") + '" data-evopen="' + esc(e.id) + '"' + (m ? ' data-evmacro="' + esc(m.key) + '" title="Open ' + esc(m.name) + ' on the Macro tab — chart, table and full history"' : "") + ' tabindex="0" aria-expanded="' + open + '">' +
      '<td class="evtm">' + hm(e.t) + "</td><td class=\"evcc\">" + (cc && window.flag ? window.flag(cc, 13) + " " : "") + ctry + '</td><td><span class="evimp i' + I + '">' + IMPN[I] + "</span></td>" +
      '<td class="evev">' + (rt ? '<span class="rt-pill">RELEASED TODAY</span> ' : "") + esc(e.label.replace(/^(USD|CAD) /, "")) + " " + chip(e) + "</td>" +
      '<td class="evn">' + esc(act) + '</td><td class="evn">' + esc(e.fc || "") + '</td><td class="evn">' + esc(prev) + '</td><td class="evst">' + stat + see + "</td></tr>";
    if (open) h += '<tr class="evx-row"><td colspan="8">' + expand(e, LD, m) + "</td></tr>";
    return h;
  }
  /* expanded row: history chart where the desk holds the series, what it measures and why it matters here, recent prints, where to look */
  var SUM = {
    us_cpi: "US consumer prices, all items. Hotter prints push Treasury yields and the US dollar up, which lifts USD/CAD and makes US grain exports dearer abroad.",
    us_core_cpi: "CPI excluding food and energy — the Fed's read on underlying inflation. A key driver of rate expectations, the US dollar and USD/CAD.",
    us_core_pce: "The Fed's preferred inflation gauge (personal consumption prices, ex food and energy). Directly shapes the Fed path and the US–Canada rate gap.",
    us_nfp: "Monthly change in US payrolls. Strong hiring supports the US dollar and yields; a big miss tends to weaken USD/CAD.",
    us_ur: "US unemployment rate. A rising rate signals slack and raises the odds of Fed cuts.",
    us_ahe: "Average hourly earnings — wage inflation. Feeds services inflation and the Fed's view.",
    us_gdp: "US real GDP, annualised. Sets the growth backdrop for demand, the dollar and risk appetite.",
    us_retail: "US retail sales — consumer demand. Surprises move the dollar and yields.",
    us_claims: "Weekly initial jobless claims — the timeliest labour indicator; a leading signal for layoffs.",
    us_umich: "University of Michigan consumer sentiment, with inflation expectations the Fed watches.",
    us_policy: "Federal Reserve policy rate decision. The single biggest driver of the US–Canada rate gap and USD/CAD.",
    ca_cpi: "Canadian consumer prices. Drives Bank of Canada expectations and the Canadian dollar side of USD/CAD.",
    ca_trim: "Bank of Canada CPI-trim — a core inflation measure the Bank uses to set policy.",
    ca_median: "Bank of Canada CPI-median — the other core measure the Bank relies on.",
    ca_emp: "Monthly change in Canadian employment (Labour Force Survey). Moves the Canadian dollar and BoC odds.",
    ca_ur: "Canadian unemployment rate.",
    ca_gdp: "Canadian monthly real GDP — growth momentum for the BoC and the loonie.",
    ca_retail: "Canadian retail sales — household demand.",
    ca_retail_ex: "Canadian retail sales excluding autos.",
    ca_policy: "Bank of Canada overnight-rate decision. Sets the Canadian side of the rate gap that drives USD/CAD." };
  var SUMK = { wasde: "USDA's monthly World Agricultural Supply and Demand Estimates — US and world balance sheets for corn, soybeans and wheat. The month's biggest scheduled grain-price event.",
    usda: "USDA weekly report (export sales or inspections) — the pace of US export demand for grain.", cftc: "CFTC Commitments of Traders — managed-money positioning as of Tuesday, released Friday 3:30 PM ET.",
    contract: "CBOT contract milestone (first notice / last trade). Positions roll before it; spreads and open interest move around it.", ca: "Canadian agriculture release (AAFC / Statistics Canada) — Canadian crop supply.",
    energy: "Energy report — diesel, propane and natural gas feed farm input costs.", cb: "Central-bank event — decisions and speeches move rate expectations and currencies.",
    earn: "Company earnings for a watchlist name.", leg: "Legislative calendar item with possible trade, farm or fiscal impact.", market: "Market session time.", desk: "The desk's own scheduled data refresh." };
  function spark(m) { var H = ((m.hist24 && m.hist24.length > 2) ? m.hist24 : m.history || []).slice(-24); if (H.length < 3) return "";
    var v = H.map(function (x) { return x[1]; }), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), w = 420, h = 120, sp = mx - mn || 1;
    var pts = v.map(function (x, i) { return [8 + i / (v.length - 1) * (w - 60), 10 + (1 - (x - mn) / sp) * (h - 30)]; });
    var path = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" "), last = pts[pts.length - 1];
    return '<svg class="evx-ch" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + esc(m.name) + ' history"><path d="' + path + " L" + last[0].toFixed(1) + " " + (h - 20) + " L8 " + (h - 20) + ' Z" fill="rgba(110,168,255,.15)"/><path d="' + path + '" fill="none" stroke="#9fc1ff" stroke-width="2"/>' +
      '<text x="' + (w - 48) + '" y="14" class="evx-ax">' + (window.mval ? mval(m, mx) : mx) + '</text><text x="' + (w - 48) + '" y="' + (h - 22) + '" class="evx-ax">' + (window.mval ? mval(m, mn) : mn) + "</text>" +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5" fill="#fff"/><text x="8" y="' + (h - 4) + '" class="evx-ax">' + esc(H[0][0]) + '</text><text x="' + (w - 110) + '" y="' + (h - 4) + '" class="evx-ax">' + esc(H[H.length - 1][0]) + "</text></svg>"; }
  function expand(e, LD, m) {
    /* minutes (FOMC minutes, BoC Summary of deliberations): once published, the official summary right here */
    if (e.mins && window.POLICY && POLICY.minutesFor) {
      var dm = POLICY.minutesFor(e.bank, e.t);
      return '<div class="evx"><div class="evx-t" style="flex:1">' + (dm ? "<b>Published — summary</b>" + POLICY.summaryHTML(dm)
          : "<b>Summary</b><p>" + (e.t > Date.now() ? "Scheduled. The summary appears here once the bank publishes the document — each line quoted from the official text." : "Due now: the desk reads the bank\u2019s site every 15 minutes; the summary appears here once the document is read.") + "</p>") +
        '<button class="evgo" data-evgo="policy:minutes">Open Policy · Minutes &amp; summaries →</button></div></div>';
    }
    var k = relKey(e), sum = (k && k.macro && SUM[k.macro]) || (k && k.macro && window.MNAV && MNAV.what && MNAV.what(k.macro)) || (e.kind !== "macro" && SUMK[e.kind]) || "Scheduled economic release from the US / Canada calendar. The desk does not track this series, so no history or actual is held — forecast and previous come from the calendar.";
    var hist = m ? ((m.hist24 && m.hist24.length > 2) ? m.hist24 : m.history || []).slice(-6).reverse() : [];
    var go = LD && LD.at && LD.go ? '<button class="evgo see" data-evgo="' + esc(LD.go) + '" data-evsel="' + esc(LD.sel || "") + '">See it: ' + esc(LD.where) + " →</button>" : e.go ? '<button class="evgo" data-evgo="' + e.go + '">Open ' + esc(deskName(e.go)) + " →</button>" : "";
    var src = e.kind === "macro" || e.kind === "energy" ? (e.fc || e.prev ? "Forecast and previous: Forex Factory weekly calendar feed (consensus as published), refreshed hourly. Blank = none published — never estimated." : "No forecast published for this release.")
      : "No forecast applies — this is a scheduled " + ((CAT[e.kind] || {}).l || "desk").toLowerCase() + " item.";
    sum += "";
    var srcHTML = '<p class="evx-s">' + esc(src) + (k && k.macro ? " Actual: official source via the desk (" + esc(k.macro) + ")." : "") + "</p>";
    if (/^(us|ca)_(core_)?cpi$|^ca_(trim|median)$/.test((k && k.macro) || "")) go += ' <button class="evgo" data-cpigo="' + (k.macro.slice(0, 2)) + '">CPI deep dive — every category →</button>';
    return (go ? '<div class="evx-bar">' + go + "</div>" : "") + '<div class="evx">' + (m ? '<div class="evx-c">' + spark(m) + "</div>" : "") + '<div class="evx-t"><b>Summary</b><p>' + esc(sum) + "</p>" +
      (hist.length ? '<table class="evx-h"><thead><tr><th>Period</th><th>Value</th></tr></thead><tbody>' + hist.map(function (x) { return "<tr><td>" + esc(x[0]) + "</td><td>" + (window.mval ? mval(m, x[1]) : x[1]) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
      srcHTML + (LD && LD.at ? '<p class="evx-l">On the desk ' + hm(LD.at) + " ET (" + lagTxt2(LD.at - e.t) + " after the scheduled time)" + (LD.txt ? " · " + esc(LD.txt) : "") + "</p>" : "") + "</div></div>";
  }

  /* ---------- release → desk link: did the number land, when, and exactly where to look ---------- */
  var MAPU = [[/^(Advance|Prelim|Final) GDP q\/q|^GDP q\/q/, "us_gdp"], [/Core PCE/, "us_core_pce"], [/^Unemployment Claims/, "us_claims"], [/^Core CPI/, "us_core_cpi"], [/^CPI (y\/y|m\/m)/, "us_cpi"],
    [/Non-?Farm|Nonfarm/i, "us_nfp"], [/^Unemployment Rate/, "us_ur"], [/Average Hourly Earnings/, "us_ahe"], [/^Retail Sales m\/m/, "us_retail"], [/UoM|Michigan/, "us_umich"], [/Federal Funds Rate|FOMC Statement/, "us_policy"], [/^Core PPI|^PPI m\/m/, "us_ppi"], [/^Import Prices/, "us_import"],
    [/^JOLTS/, "us_jolts"], [/^ADP Non-?Farm/i, "us_adp"], [/^Factory Orders/, "us_factory"], [/Durable Goods/, "us_durable"], [/^Industrial Production/, "us_indpro"],
    [/^Personal Income/, "us_pinc"], [/^Personal Spending/, "us_pspend"], [/^PCE Price Index/, "us_pce"], [/^Building Permits/, "us_permits"], [/^Housing Starts/, "us_starts"],
    [/^New Home Sales/, "us_nhs"], [/^ISM Manufacturing PMI/, "us_ism"], [/^ISM Services PMI/, "us_ism_svc"], [/^Continuing Claims/, "us_cclaims"]];
  var MAPC = [[/Trimmed|CPI-?trim/i, "ca_trim"], [/Median CPI|CPI-?median/i, "ca_median"], [/^CPI m\/m|^CPI y\/y/, "ca_cpi"], [/Employment Change/, "ca_emp"], [/^Unemployment Rate/, "ca_ur"], [/^GDP m\/m/, "ca_gdp"],
    [/^Core Retail Sales/, "ca_retail_ex"], [/^Retail Sales m\/m/, "ca_retail"], [/Overnight Rate|BOC Rate Statement/, "ca_policy"],
    [/^Manufacturing Sales/, "ca_mfg"], [/^Wholesale Sales/, "ca_whl"], [/^Building Permits/, "ca_permits"], [/^Housing Starts/, "ca_starts"], [/^IPPI|Industrial Product Price/, "ca_ippi"],
    [/^Ivey PMI/, "ca_ivey"], [/Job Vacancies/, "ca_vac"], [/^GDP q\/q/, "ca_gdpq"]];
  function relKey(e) {
    if (e.kind === "macro") { if (e.mkey) return { macro: e.mkey };
      var name = e.label.replace(/^(USD|CAD) /, ""), ca = /^CAD /.test(e.label), M = ca ? MAPC : MAPU, have = {};
      (window.macroAll ? macroAll() : []).forEach(function (x) { have[x.key] = x; });
      for (var i = 0; i < M.length; i++) if (M[i][0].test(name) && (have[M[i][1]] || !window.macroAll)) return { macro: M[i][1] };
      var hit = Object.keys(have).filter(function (k2) { return k2.indexOf(ca ? "ca_" : "us_") === 0 && have[k2].name.toLowerCase() === name.toLowerCase(); })[0];   /* same name as a tracked series */
      return hit ? { macro: hit } : null; }
    if (e.kind === "usda" && /Export sales/.test(e.label)) return { asof: "exports" };
    if (e.kind === "wasde") return { asof: "wasde" };
    if (e.kind === "cftc") return { asof: "cftc_grains" };
    if (e.kind === "market" && /close · settlement/.test(e.label)) return { asof: "grains_settle" };
    if (e.kind === "desk" && /Options OI/.test(e.label)) return { asof: "options" };
    if (e.kind === "desk" && /Options OI, IV, rollover/.test(e.label)) return { asof: "options" };
    if (e.kind === "cb") return { cb: 1 };
    return null;
  }
  var WHERE = { exports: ["corn:fund", '[data-src="exports"]', "Fundamentals · export sales"], wasde: ["corn:fund", '[data-src="wasde"]', "Fundamentals · WASDE"],
    cftc_grains: ["corn:deriv", '[data-src="cftc_grains"]', "Derivatives · CFTC managed money"], grains_settle: ["corn:overview", '[data-src="grains_settle"]', "Overview · settles & fan"],
    options: ["corn:deriv", '[id^="oi-"]', "Derivatives · open interest by strike"] };
  function landed(e) {
    var k = relKey(e); if (!k) return null;
    var A = (DATA.meta && DATA.meta.asof) || {};
    function sameMeasure(ev, mm) { var a = /m\/m/.test(ev.label) ? "m/m" : /y\/y/.test(ev.label) ? "y/y" : "", b = mm.measure || ""; return !a || !b || a === b || (b === "m/m change" && a === "m/m"); }   /* a y/y print is never set against an m/m forecast */
    if (k.macro) { var m = window.mfind && mfind(k.macro); if (!m) return { none: 1 };
      if (k.macro === "us_policy" || k.macro === "ca_policy") { var r = pw()[k.macro === "us_policy" ? "fed" : "boc"];
        if (r && r.status === "out" && r.date === dayIso(e.t)) return { at: Date.parse(r.t_seen), txt: r.decision + " " + rateTxt(r.rate) + " · " + r.tone, go: "events:", sel: ".pw-tile", where: "Events · central-bank card", tab: "fx" }; }
      var seen = m.seen_at ? Date.parse(m.seen_at) : 0;
      if (seen && seen >= e.t - 5 * MIN) return { at: seen, txt: m.name + " " + m.period + ": " + (window.mval ? mval(m, m.value) : m.value) + (e.fc && sameMeasure(e, m) ? " (fc " + e.fc + ")" : ""), go: "macro:dash", sel: '[data-mkey="' + k.macro + '"]', where: "Macro · " + m.name, tab: "macro" };
      return { pending: 1, where: "Macro · " + m.name }; }
    if (k.asof) { var w = WHERE[k.asof], at = A[k.asof] ? Date.parse(A[k.asof]) : 0, ok = at >= e.t - 5 * MIN;
      if (k.asof === "cftc_grains") { var c = DATA.grains.corn.cftc, lastD = c[c.length - 1].date; var ri = new Date(e.t - 5 * 3600000).toISOString().slice(0, 10), want = (window.COT_REL && COT_REL[ri]) || new Date(e.t - 4 * 86400000).toISOString().slice(0, 10); ok = lastD >= want; at = ok ? e.t : 0; }
      if (k.asof === "exports") { var E = (DATA.exports && DATA.exports.corn && DATA.exports.corn.weeks) || [], wk = E.length ? E[E.length - 1][1] : ""; ok = wk >= new Date(e.t - 8 * 86400000).toISOString().slice(0, 10); }
      return ok ? { at: at, txt: "", go: w[0], sel: w[1], where: w[2], tab: w[0].split(":")[0] } : { pending: 1, where: w[2] }; }
    if (k.cb) { var PJ = window.POLICY && POLICY._data(), bk = null;
      ((PJ && PJ.banks) ? Object.keys(PJ.banks) : []).forEach(function (b) { if (e.label.indexOf(PJ.banks[b].name) === 0) bk = b; });
      var d = bk && (PJ.docs || []).filter(function (x) { return x.bank === bk && x.published_at && Date.parse(x.published_at) >= e.t - 6 * H; })[0];
      return d ? { at: Date.parse(d.published_at), txt: (d.label || "").toLowerCase() + " (" + (d.score > 0 ? "+" : "") + d.score + ")", go: "policy:" + d.id, sel: ".pi-doc", where: "Policy · evidence", tab: "policy" } : { pending: 1, where: "Policy tab" }; }
    return null;
  }
  function lagTxt2(ms) { var m = Math.round(ms / MIN); return m <= 0 ? "on time" : m < 60 ? "+" + m + " min" : "+" + Math.floor(m / 60) + " h " + (m % 60) + " min"; }
  /* tabs and cards that received a scheduled release today get a colour and a "RELEASED TODAY" label (BRD 16C) until midnight */
  function decorate() {
    if (!ready()) return;
    var now = Date.now(), tabs = {}, jumps = {}, today = todayEvents(now).filter(function (e) { return e.t <= now; });
    today.forEach(function (e) { var L = landed(e); if (!L || !L.at || !L.tab) return; var nm = e.label.replace(/^(USD|CAD) /, "");
      (tabs[L.tab] = tabs[L.tab] || []).push(nm + " " + hm(L.at));
      if (L.tab !== "events" && L.go) (jumps[L.tab] = jumps[L.tab] || []).push({ n: nm, at: L.at, go: L.go, sel: L.sel || "", where: L.where || "" });
      if (L.sel && L.tab !== "events") [].forEach.call(document.querySelectorAll("#panel-" + L.tab + " " + L.sel), function (el) {
        var c = el.closest(".mi-tr, .tile, .mcard, .dash-card, .mk-click") || el; c.classList.add("upd-today"); c.setAttribute("data-upd", "RELEASED TODAY · " + hm(L.at)); }); });
    if (tabs.fx || tabs.corn) ["corn", "wheat", "soybeans"].forEach(function (g) { if (tabs.corn && g !== "corn") tabs[g] = tabs.corn; });
    if (jumps.corn) ["wheat", "soybeans"].forEach(function (g) { jumps[g] = jumps.corn.map(function (j) { return { n: j.n, at: j.at, go: j.go.replace(/^corn/, g), sel: j.sel, where: j.where.replace(/^Corn/, g[0].toUpperCase() + g.slice(1)) }; }); });
    /* a strip at the top of each tab: what landed here today, each a button that jumps to the exact card */
    [].forEach.call(document.querySelectorAll(".tab-btn"), function (b) { var k = b.getAttribute("data-tab"), P = document.getElementById("panel-" + k); if (!P || k === "events") return;
      var bar = P.querySelector(":scope > .today-bar"), J = jumps[k];
      if (!J || !J.length) { if (bar) bar.remove(); return; }
      if (!bar) { bar = document.createElement("div"); bar.className = "today-bar"; P.insertBefore(bar, P.firstChild); }
      var h = '<span class="tb-k">Updated today</span>' + J.map(function (j) { return '<button class="tb-go" data-evgo="' + esc(j.go) + '" data-evsel="' + esc(j.sel) + '" title="Go to ' + esc(j.where) + '">' + esc(j.n) + ' <small>' + hm(j.at) + '</small> →</button>'; }).join("");
      if (bar.innerHTML !== h) bar.innerHTML = h; });
    /* BRD 16D red dots (owner amendment: clear at 00:00 ET, matching 16C): every menu item whose data landed today */
    var dots = {}; Object.keys(jumps).forEach(function (k) { jumps[k].forEach(function (j) { var sec = (j.go.split("@")[0].split(":")[1]) || ""; dots[k + ":"] = 1; if (sec) dots[k + ":" + sec] = 1; }); });
    Object.keys(tabs).forEach(function (k) { dots[k + ":"] = 1; if (/^(corn|wheat|soybeans)$/.test(k)) dots["grains:"] = 1; });
    [].forEach.call(document.querySelectorAll(".tab-btn[data-tab], .subbtn[data-subp][data-sub], .tn-h[data-subp][data-sub], #tabbtn-grains"), function (b) { var k = b.id === "tabbtn-grains" ? "grains" : b.getAttribute("data-tab") || b.getAttribute("data-subp"), sec = b.getAttribute("data-sub") || "";
      b.classList.toggle("md-dot", !!dots[k + ":" + sec]); });
    [].forEach.call(document.querySelectorAll(".tab-btn"), function (b) { var k = b.getAttribute("data-tab"), L = tabs[k]; if (!k) return;
      b.classList.toggle("tab-today", !!L); if (L) b.title = "Updated today: " + L.join(" · "); else b.removeAttribute("title"); });
  }

  /* ---------- central-bank decisions: outcome, tone and how fast the desk had it ---------- */
  var BANK = { boc: { n: "Bank of Canada", cc: "ca", key: "ca_policy", ev: /^CAD (Overnight Rate|BOC Rate Statement|BOC Monetary Policy Report)/ },
               fed: { n: "Federal Reserve", cc: "us", key: "us_policy", ev: /^USD (Federal Funds Rate|FOMC Statement)/ } };
  function pw() { return (window.DATA && DATA.policy_watch) || {}; }
  function rateTxt(r) { return r == null ? "—" : (+r).toFixed(2) + "%"; }
  function screenSeen(b, rec) { var k = "desk.pwseen." + b + "." + rec.date, v = store.get(k); if (!v && rec.status === "out") { v = Date.now(); store.set(k, v); } return v; }
  function lagTxt(min) { if (min == null || isNaN(min)) return "—"; return min < 1 ? Math.round(min * 60) + " s" : min < 60 ? min.toFixed(1) + " min" : Math.floor(min / 60) + " h " + Math.round(min % 60) + " min"; }
  function toneCls(t) { return /HAWK/.test(t || "") ? "hawk" : /DOV/.test(t || "") ? "dove" : "neu"; }
  function curRate(b) { var m = window.mfind && mfind(BANK[b].key); return m ? m.value : null; }
  function fcRate(b) { var ev = b === "boc" ? "Overnight Rate" : "Federal Funds Rate", c = b === "boc" ? "CAD" : "USD", f = null;
    ((DATA.fx && DATA.fx.events) || []).forEach(function (e) { if (e.ccy === c && e.event === ev && e.fc && e.date === dayIso(Date.now())) f = parseFloat(e.fc); }); return f; }
  function todaysDecisions(now) {
    var cal = (DATA && DATA.release_cal) || {}, out = [], today = dayIso(now);
    Object.keys(BANK).forEach(function (b) { ((cal[BANK[b].key] || {}).dates || []).forEach(function (d) { if (d.slice(0, 10) === today) out.push({ b: b, t: zms(d.slice(0, 10), +d.slice(11, 13), +d.slice(14, 16)) }); }); });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  function policyHTML(now) {
    var list = todaysDecisions(now); if (!list.length) return "";
    var W = pw();
    return '<div class="tile wide pw-tile"><h2>Central-bank decisions today <span class="h2note">— read straight from the official statement · rate, surprise vs forecast, tone and how fast the desk had it</span></h2><div class="pw-grid">' +
      list.map(function (x) {
        var B = BANK[x.b], r = W[x.b], has = r && r.date === dayIso(x.t), out = has && r.status === "out";
        var head = '<div class="pw-h">' + (window.flag ? flag(B.cc, 15) : "") + " <b>" + B.n + "</b> · " + hm(x.t) + " ET</div>";
        if (!out) {
          var waiting = now >= x.t;
          return '<div class="pw-c">' + head + '<div class="pw-st">' + (waiting ? 'Awaiting the statement — checked ' + ((has && r.checks) || 0) + ' time' + ((has && r.checks) === 1 ? "" : "s") + ' · ' + lagTxt((now - x.t) / MIN) + ' since the scheduled time' :
            'Decision in <span class="countdown" data-t="' + x.t + '" data-fmt="hms">' + hms(x.t - now) + "</span>") + "</div>" +
            '<div class="pw-s">Current ' + rateTxt(has && r.prev != null ? r.prev : curRate(x.b)) + (fcRate(x.b) != null ? " · forecast " + rateTxt(fcRate(x.b)) : "") + " · the desk reads the statement from the bank’s site every minute from 2 min before</div></div>";
        }
        var seen = screenSeen(x.b, r), scr = seen ? (seen - x.t) / MIN : null;
        return '<div class="pw-c ' + toneCls(r.tone) + '">' + head +
          '<div class="pw-dec"><span class="pw-d">' + r.decision + (r.change_bp ? " " + (r.change_bp > 0 ? "+" : "") + r.change_bp + " bp" : "") + '</span><span class="pw-r">' + rateTxt(r.prev) + " → <b>" + rateTxt(r.rate) + "</b>" + (r.lo != null ? ' <small>(range ' + (+r.lo).toFixed(2) + "–" + (+r.rate).toFixed(2) + "%)</small>" : "") + "</span>" +
          '<span class="pw-tone ' + toneCls(r.tone) + '">' + r.tone + '</span></div>' +
          '<div class="pw-s">' + (r.surprise_bp == null ? "no forecast on file" : r.surprise_bp === 0 ? "as forecast (" + rateTxt(r.fc) + ")" : (r.surprise_bp > 0 ? "hawkish surprise +" : "dovish surprise ") + r.surprise_bp + " bp vs forecast " + rateTxt(r.fc)) +
            " · tone score " + (r.score > 0 ? "+" : "") + r.score + " (decision " + r.parts.decision + ", surprise " + r.parts.surprise + ", language " + r.parts.language + ")</div>" +
          ((r.hawk || []).length ? '<div class="pw-ph"><b class="hawk">Hawkish lines</b> ' + r.hawk.map(function (p) { return "“" + esc(p) + "”"; }).join(" · ") + "</div>" : "") +
          ((r.dove || []).length ? '<div class="pw-ph"><b class="dove">Dovish lines</b> ' + r.dove.map(function (p) { return "“" + esc(p) + "”"; }).join(" · ") + "</div>" : "") +
          '<div class="pw-lag"><span>⏱ On the desk <b>' + new Date(Date.parse(r.t_seen)).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET</b> — <b>" + lagTxt(r.lag_min) + "</b> after the scheduled time</span>" +
            (scr != null ? "<span>on this screen " + lagTxt(scr) + " after</span>" : "") + "" + "</div></div>";
      }).join("") + "</div>" + lagTableHTML(now) + '<div class="stamp">Tone = decision (hike +2 / cut −2) + surprise vs the consensus forecast (±1 per 25 bp) + statement language (hawkish minus dovish phrases, capped ±2): ≥ +2 hawkish, ≤ −2 dovish. A phrase-based read of the statement — the lines it matched are shown so you can judge. Press-conference remarks come later and are not scored.</div></div>';
  }
  /* publication lag for every timed release today: scheduled time vs when the desk first had the new number */
  function lagTableHTML(now) {
    var today = dayIso(now), rows = [], cal = DATA.release_cal || {}, W = pw();
    (W.log || []).filter(function (x) { return x.date === today; }).forEach(function (x) { rows.push([Date.parse(x.t_sched), BANK[x.bank].n + " decision", Date.parse(x.t_seen), x.lag_min, x.decision + " · " + x.tone]); });
    var M = {}; (window.macroAll ? macroAll() : []).forEach(function (m) { M[m.key] = m; });
    Object.keys(cal).forEach(function (k) { if (k === "ca_policy" || k === "us_policy") return; ((cal[k] || {}).dates || []).forEach(function (d) {
      if (d.slice(0, 10) !== today) return; var t = zms(d.slice(0, 10), +d.slice(11, 13), +d.slice(14, 16)); if (t > now) return;
      var m = M[k], sa = m && m.seen_at ? Date.parse(m.seen_at) : null;
      rows.push([t, (m ? (m.group === "ca" ? "Canada " : "US ") + m.name : k), sa && sa >= t - 5 * MIN ? sa : null, sa && sa >= t - 5 * MIN ? (sa - t) / MIN : null, m ? m.period + " " + (window.mval ? mval(m, m.value) : m.value) : ""]); }); });
    if (!rows.length) return "";
    rows.sort(function (a, b) { return a[0] - b[0]; });
    return '<div class="pw-lagt"><h3>Publication lag — today</h3><table class="oi-mtab"><thead><tr><th>Release</th><th>Scheduled</th><th>On the desk</th><th>Lag</th><th>Result</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td>" + esc(r[1]) + "</td><td>" + hm(r[0]) + "</td><td>" + (r[2] ? new Date(r[2]).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }) : '<span class="neu">waiting</span>') + '</td><td class="' + (r[3] == null ? "neu" : r[3] <= 5 ? "up" : r[3] <= 20 ? "neu" : "dn") + '">' + lagTxt(r[3]) + "</td><td>" + esc(r[4]) + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }
  /* the next trading day's releases, so tomorrow-morning data (e.g. 8:30 GDP) is visible the evening before */
  function tomorrowHTML(now) {
    var t = now, nd = null;
    for (var i = 1; i <= 4 && !nd; i++) { var L = todayEvents(now + i * 86400000).filter(pass).filter(function (e) { return e.kind !== "desk" && e.kind !== "market"; }); if (L.length) { nd = L; t = now + i * 86400000; } }
    if (!nd) return "";
    var key = V.tomAll ? nd : nd.filter(function (e) { return e.high || e.impact === "High" || e.impact === "Medium" || /^(usda|wasde|cftc|contract|ca)$/.test(e.kind); });
    var rest = nd.length - key.length;
    return '<div class="tile wide ev-tom"><h2>Coming up ' + (dayIso(t) === dayIso(now + 86400000) ? "tomorrow" : "next") + ' · ' + esc(shortDay(t)) + ' <span class="h2note">— ' + nd.length + ' scheduled' + (rest ? " · showing the " + key.length + " high/medium-impact and agri releases" : "") + '</span></h2>' +
      '<div class="evlist">' + (key.length ? key : nd).map(function (e) { return row(e, now); }).join("") + "</div>" + (rest > 0 || V.tomAll ? '<button class="evhi" data-evtomall aria-pressed="' + !!V.tomAll + '">' + (V.tomAll ? "Show key releases only" : "Show all " + nd.length) + "</button>" : "") + "</div>";
  }
  var lastDay = "";
  var RANGES = [["yday", "Yesterday", -1, 1], ["today", "Today", 0, 1], ["tom", "Tomorrow", 1, 1], ["d7", "Next 7 days", 0, 7], ["d14", "Next 14 days", 0, 14], ["custom", "Custom date", null, 1]];
  function rangeDays(id, now) { var r = RANGES.filter(function (x) { return x[0] === id; })[0] || RANGES[1], out = [];
    if (id === "custom") { var c = V.custom || dayIso(now), p = c.split("-"); return [window.zonedMs(+p[0], +p[1], +p[2], 12, 0, TZ)]; }
    for (var i = 0; i < r[3]; i++) out.push(now + (r[2] + i) * 86400000); return out; }
  function rangeEvents(id, now) { var seen = {}, out = []; rangeDays(id, now).forEach(function (d) { todayEvents(d).forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } }); }); return out; }
  function counts(L) { var c = { H: 0, M: 0, L: 0 }; L.forEach(function (e) { c[imp(e)]++; }); return c; }
  function topHTML(now) {
    var cf = function (e) { var c = ccOf(e); return ccIn(e) && (!c || V.ccs[c] !== false) && (V.cat === "all" || groupOf(e) === V.cat); };
    var tabs = RANGES.map(function (r) { var c = r[0] === "custom" && !V.custom ? null : counts(rangeEvents(r[0], now).filter(cf));
      return '<button class="evday" data-evday="' + r[0] + '" aria-pressed="' + (V.day === r[0]) + '"><span>' + r[1] + "</span>" + (c ? '<span class="evcnt"><i class="iH">' + c.H + '</i><i class="iM">' + c.M + '</i><i class="iL">' + c.L + "</i></span>" : '<span class="evcnt">📅</span>') + "</button>"; }).join("");
    var tg = function (attr, v, on, lab) { return '<button data-' + attr + '="' + v + '" aria-pressed="' + on + '">' + lab + "</button>"; };
    return '<div class="tile wide ev-cal-top"><div class="evdays">' + tabs + "</div>" +
      (V.day === "custom" ? '<div class="evcust"><label>Date <input type="date" data-evcustom value="' + esc(V.custom || dayIso(now)) + '"></label><small>The macro calendar covers this week and next; USDA, CFTC, contract dates and official release calendars go further.</small></div>' : "") +
      '<div class="evfilters"><div class="evfg"><span>Importance</span>' + ["H", "M", "L"].map(function (k) { return '<label class="evchk"><input type="checkbox" data-evimpc="' + k + '"' + (V.imp[k] !== false ? " checked" : "") + '><i class="evimp-b i' + k + '">' + k + "</i> " + IMPN[k] + "</label>"; }).join("") + "</div>" +
      '<div class="evfg"><span>Country</span>' + tg("evcc", "us", V.ccs.us !== false, (window.flag ? flag("us", 13) : "") + " US") + tg("evcc", "ca", V.ccs.ca !== false, (window.flag ? flag("ca", 13) : "") + " Canada") + "</div>" +
      '<div class="evfg"><span>Category</span><select data-evcat>' + GROUPS.map(function (g) { return '<option value="' + g[0] + '"' + (V.cat === g[0] ? " selected" : "") + ">" + g[1] + "</option>"; }).join("") + "</select></div>" +
      '<input class="evq" type="search" placeholder="Search for events" data-evq value="' + esc(V.q) + '" aria-label="Search for events"></div></div>';
  }
  function mainHTML(now) {
    var all = rangeEvents(V.day, now), list = all.filter(pass), today = dayIso(now);
    var up = todayEvents(now).filter(pass).filter(function (e) { return e.t > now; }), nxt = up[0] || nextAfterToday(now);
    var byDay = {}; list.forEach(function (e) { (byDay[dayIso(e.t)] = byDay[dayIso(e.t)] || []).push(e); });
    var days = Object.keys(byDay).sort();
    var nextBar = nxt ? '<div class="ev-next">Next · ' + (dayIso(nxt.t) !== today ? esc(shortDay(nxt.t)) + " " : "") + hm(nxt.t) + " ET · " + flagOf(nxt) + "<b>" + esc(nxt.label.replace(/^(USD|CAD) /, "")) + '</b> · in <span class="countdown" data-t="' + nxt.t + '" data-fmt="hms">' + hms(nxt.t - now) + "</span></div>" : "";
    var head = "<thead><tr><th>Time</th><th>Country</th><th>Importance</th><th>Event</th><th>Actual</th><th title='Consensus forecast as published on the Forex Factory weekly calendar feed; blank when none is published'>Forecast</th><th>Previous</th><th>Status</th></tr></thead>";
    var body = days.length ? days.map(function (d) { var L = byDay[d], t0 = L[0].t;
        return '<div class="tile wide ev-day"><h2>' + esc(new Date(t0).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" })) + (d === today ? " (Today)" : d === dayIso(now + 86400000) ? " (Tomorrow)" : d === dayIso(now - 86400000) ? " (Yesterday)" : " (" + esc(wdOf(t0)) + ")") +
          ' <span class="h2note">— ' + L.length + " event" + (L.length > 1 ? "s" : "") + ' · Toronto time</span></h2><div class="tbl-scroll"><table class="ev-tbl">' + head + "<tbody>" + L.map(function (e) { return row(e, now); }).join("") + "</tbody></table></div></div>"; }).join("")
      : '<div class="tile wide ev-empty"><div class="eve-i">◷</div><h3>No events</h3><p>' + (all.length ? "Nothing matches these filters." : "Nothing is scheduled in this range.") + "</p></div>";
    return '<div id="evTop">' + topHTML(now) + "</div>" + '<div id="evBody">' + nextBar + (V.day === "today" ? policyHTML(now) : "") + body +
      '<div class="tile wide"><div class="stamp">US and Canada only. Sources: the US + Canada macro calendar (this week and next; forecast and previous), official release calendars, USDA, WASDE, CFTC, CBOT contract dates and sessions, AAFC / StatCan, EIA, central banks, legislation, watchlist earnings and the desk’s own refreshes. Forecast and previous come from the Forex Factory weekly calendar feed (published consensus, refreshed hourly; blank when none is published — nothing is estimated). Actual is shown for the releases the desk tracks, from the official source once the number is on the desk. Click a row for its history, what it measures and where to see it.</div></div></div>';
  }
  function bodyHTML(now) { var w = document.createElement("div"); w.innerHTML = mainHTML(now); var b = w.querySelector("#evBody"); return b ? b.innerHTML : ""; }

  /* ---------- milestone feed (right rail) ---------- */
  var FEED_KEY = "desk.milestones", feed = store.get(FEED_KEY) || [], unseen = 0;
  feed = feed.filter(function (m) { return m && Date.now() - m.t < 36 * H; });
  function log(kind, html, go, id, t) {
    id = id || kind + "|" + html;
    for (var i = 0; i < feed.length; i++) if (feed[i].id === id) return;
    feed.unshift({ t: t || Date.now(), k: kind, h: html, go: go || "", id: id });
    feed.sort(function (a, b) { return b.t - a.t; }); var nw = 0; feed = feed.filter(function (m) { return m.k !== "wire" || ++nw <= 80; }).slice(0, 220); store.set(FEED_KEY, feed);
    if (!active()) unseen++;
    paintBadge(); if (active()) paintFeed();
  }
  var MK = { alert: ["📣", "#ff5d5d"], policy: ["🏦", "#6ea8ff"], data: ["◆", "#38b6c9"], release: ["✓", "#3fb97f"], due: ["⏱", "#e8b93d"], world: ["🌐", "#ff8a84"], oi: ["⚡", "#c9a3ff"], level: ["↕", "#6ea8ff"], day: ["☀", "#9aa8bb"] };
  var FV = "all";
  function feedHTML() {
    var now = Date.now(), list = feed.filter(function (m) { return FV === "all" || m.k === FV || (FV === "release" && m.k === "data"); });
    var head = '<div class="rail-card ev-feed"><div class="mon-head"><div class="rail-title"><span>Milestones</span><span class="hint">live · ' + feed.length + "</span></div>" +
      '<div class="mon-tabs evft">' + [["all", "All"], ["policy", "Central banks"], ["release", "Data"], ["oi", "Options"], ["world", "World"], ["level", "Levels"]].map(function (t) {
        return '<button data-evfeed="' + t[0] + '" aria-selected="' + (FV === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div></div>";
    var day = "", body = list.length ? list.map(function (m) {
      var d = dayIso(m.t), sep = d !== day ? '<div class="evfd">' + (d === dayIso(now) ? "Today" : esc(shortDay(m.t))) + "</div>" : ""; day = d;
      var k = MK[m.k] || MK.data;
      return sep + '<div class="evfi' + (m.go ? " evfi-go" : "") + '" style="--mc:' + k[1] + '"' + (m.go ? ' data-evgo="' + esc(m.go) + '" role="link" tabindex="0" title="Open ' + esc(deskName(m.go)) + ' and highlight the updated card"' : "") + '><span class="evfk">' + k[0] + '</span><div><div class="evfh">' + m.h + '</div><div class="evfs">' + hm(m.t) + " ET" +
        (m.go ? ' · <span class="evfo">Open ' + esc(deskName(m.go)) + " →</span>" : "") + "</div></div></div>"; }).join("")
      : '<div class="checkline">No milestones yet — data arrivals, open-interest shifts, wall moves, level crossings and world alerts appear here as they happen.</div>';
    return head + '<div class="rail-body mon-body evfb">' + body + '<div class="stamp">Recorded while the desk is open (kept 36 h on this browser) · newest first' + (feed.length ? ' · <a href="#" data-evclear>clear</a>' : "") + "</div></div></div>";
  }
  function paintFeed() { var r = document.getElementById("evRail"); if (r) r.innerHTML = feedHTML(); }
  function paintBadge() { try { paintBadge0(); } catch (x) { if (window.console) console.error("events badge", x); } }
  function paintBadge0() {
    if (!ready()) return;
    var now = Date.now(), left = todayEvents(now).filter(function (e) { return e.t > now; }).length;
    var tot = todayEvents(now).length, s = BTN.querySelector(".sym"); if (s) s.textContent = tot ? "Today · " + left + " to come" : "Today · no events";   /* BRD s.15: a computed count, never a static word */
    var b = BTN.querySelector(".evbadge");
    if (unseen > 0) { if (!b) { b = document.createElement("span"); b.className = "evbadge"; BTN.appendChild(b); } b.textContent = unseen > 9 ? "9+" : unseen; }
    else if (b) b.remove();
  }
  function active() { return P.classList.contains("active"); }
  function render() {
    if (!ready()) { P.innerHTML = '<div class="tile wide"><p class="note">Loading events…</p></div>'; return; }
    hookToast(); var now = Date.now(); lastDay = dayIso(now);
    var mh, fh;
    try { mh = mainHTML(now); } catch (x) {   /* a saved view from an older layout must never blank the tab: reset it and retry once */
      try { V.day = "today"; V.imp = { H: true, M: true, L: true }; V.ccs = { us: true, ca: true }; V.cat = "all"; V.q = ""; V.open = ""; saveV(); mh = mainHTML(now); }
      catch (y) { mh = '<div class="tile wide"><h2>Events</h2><p class="note">The calendar could not be drawn (' + esc(y && y.message || y) + '). Reload the page; if it persists, tell the desk owner this message.</p></div>'; if (window.console) console.error("events render", y); } }
    try { fh = feedHTML(); } catch (x) { fh = ""; }
    P.innerHTML = '<div class="layout ev-lay"><div class="grid" id="evMain">' + mh + '</div><aside class="rail" id="evRail">' + fh + "</aside></div>";
    if (window.MOTION) window.MOTION.scan();
  }
  function repaintMain(full) { try { repaintMain0(full); } catch (x) { render(); } }
  function repaintMain0(full) { var m = document.getElementById("evMain"); if (!m) return render(); var b = document.getElementById("evBody");
    if (!full && b) { b.innerHTML = bodyHTML(Date.now()); var t = document.getElementById("evTop"); if (t && !t.contains(document.activeElement)) t.innerHTML = topHTML(Date.now()); } else m.innerHTML = mainHTML(Date.now()); }

  /* ---------- milestone detectors (read-only diffs of the page's data) ---------- */
  var ASOF = { cftc_grains: ["CFTC Commitments of Traders — grains", "corn:deriv"], cftc_fx: ["CFTC Commitments of Traders — CAD", "fx:deriv"], options: ["Options open interest, IV & walls", "corn:deriv"],
    grains_settle: ["CBOT grain settlements", "corn:overview"], exports: ["USDA weekly export sales", "corn:fund"], wasde: ["WASDE balance sheets", "corn:fund"], canada: ["Statistics Canada field-crop tables", "corn:fund"],
    sd_hist: ["Supply & demand history", "corn:fund"], inputs: ["Input costs (fertilizer, chemicals, energy)", "corn:inputs"], yields: ["Government bond yields", "fx:rates"], policy: ["Central-bank policy & rate odds", "fx:rates"],
    sentiment: ["Positioning sentiment", "fx:deriv"], fxopt: ["USD/CAD options (risk reversals)", "fx:deriv"], releases: ["Macro release consensus", "macro:rel"], fx_closes: ["USD/CAD daily closes", "fx:overview"] };
  delete ASOF.policy;   /* re-checked every run; real policy moves arrive as macro releases */
  /* content fingerprints: a milestone fires only when the data itself changes, not when the server merely re-checks a source */
  function fp(o) { var t = JSON.stringify(o) || "", h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return t.length + ":" + h; }
  function G(k) { return (DATA.grains && DATA.grains[k]) || {}; }
  var FP = {
    cftc_grains: function () { return ["corn", "wheat", "soybeans"].map(function (k) { var c = G(k).cftc || []; return c.length && c[c.length - 1].date; }); },
    cftc_fx: function () { var c = DATA.fx.cftc || DATA.fx.cot || []; return c.length ? c[c.length - 1] : null; },
    options: function () { return ["corn", "wheat", "soybeans"].map(function (k) { var g = G(k); return [g.near && g.near.rows, g.far && g.far.rows]; }); },
    grains_settle: function () { return ["corn", "wheat", "soybeans"].map(function (k) { return G(k).fan && [G(k).fan.anchor, G(k).fan.settle_date]; }); },
    exports: function () { return DATA.exports; }, wasde: function () { return DATA.wasde; }, canada: function () { return DATA.canada; },
    sd_hist: function () { return DATA.sd_hist; }, inputs: function () { var I = DATA.inputs && DATA.inputs.series; return I && Object.keys(I).map(function (k) { var x = I[k]; return x && (x.last || x.latest || x.value || (x.hist && x.hist[x.hist.length - 1]) || x); }); },
    yields: function () { return DATA.fx.treasury; }, sentiment: function () { return DATA.fx.sentiment; }, fxopt: function () { return DATA.fx.fxopt || DATA.fx.options; },
    releases: function () { return DATA.fx.releases; }, fx_closes: function () { return DATA.fx.closes || DATA.fx.history; }
  };
  /* sources whose as-of time is the moment new data landed (safe to replay today's refreshes on first load) */
  var SEED = { options: 1, grains_settle: 1, cftc_grains: 1, cftc_fx: 1, fx_closes: 1 };
  var base = null;
  function snap() {
    var s = { asof: Object.assign({}, DATA.meta.asof || {}), fp: {}, roll: {}, flow: {}, pw: {}, macro: {}, walls: {}, oi: {}, px: {}, gg: null, wa: {} };
    try { var PJ2 = window.POLICY && POLICY._data(); if (PJ2) { s.pol = {}; (PJ2.docs || []).forEach(function (d) { if (d.policy_relevant !== false) s.pol[d.id] = d; }); } } catch (x) {}
    ["boc", "fed"].forEach(function (b) { var r = pw()[b]; if (r) s.pw[b] = r.date + "|" + r.status + "|" + (r.t_seen || ""); });
    Object.keys(ASOF).forEach(function (k) { try { s.fp[k] = FP[k] ? fp(FP[k]()) : s.asof[k]; } catch (e) { s.fp[k] = s.asof[k]; } });
    (window.macroAll ? macroAll() : []).forEach(function (m) { s.macro[m.key] = m.period + "|" + m.value; });
    ["corn", "wheat", "soybeans"].forEach(function (k) { var g = DATA.grains && DATA.grains[k]; if (!g || !g.near) return;
      s.walls[k] = [g.near.call_wall && g.near.call_wall[0], g.near.put_wall && g.near.put_wall[0]];
      s.oi[k] = g.near.oi_label || ""; s.px[k] = g.fan && +g.fan.intraday[0];
      try { var RL = window.rollLevel && rollLevel(k); if (RL) s.roll[k] = RL; } catch (e) {}
      try { var FS = window.flowStats && flowStats(k, 10); if (FS) s.flow[k] = { b: flowBias(FS.score)[0], sc: FS.score, d: FS.last.lab }; } catch (e) {} });
    try { var G = window.GG && GG._data && GG._data(); s.gg = G && (G.updated_at || G.generated_at) || null; } catch (e) {}
    try { var W = window.WORLD && WORLD._data(); (W && W.instruments || []).forEach(function (i) { if (i.w52) s.wa[i.id || i.name] = (i.w52.new_high ? "H" : "") + (i.w52.new_low ? "L" : ""); }); } catch (e) {}
    return s;
  }
  var GN = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function detail(k) {   /* one-line summary of what the refresh brought */
    try {
      if (k === "options") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { var n = DATA.grains[g].near;
        return GN[g] + " P/C " + n.pcr + " · walls " + sk(n.put_wall[0]) + "–" + sk(n.call_wall[0]); }).join(" · ") + " — " +
        esc((DATA.grains.corn.near.oi_label || "").replace(/^.*OI as of /, "OI as of ")) + "</small>";
      if (k === "grains_settle") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { return GN[g] + " " + (+DATA.grains[g].fan.anchor).toFixed(4); }).join(" · ") + "</small>";
      if (k === "cftc_grains") return "<br><small>" + ["corn", "wheat", "soybeans"].map(function (g) { var c = DATA.grains[g].cftc, l = c[c.length - 1]; return GN[g] + " MM " + (l.net >= 0 ? "+" : "") + Math.round(l.net / 1000) + "k"; }).join(" · ") + "</small>";
    } catch (e) {}
    return "";
  }
  function sk(v) { return "$" + (+v).toFixed(2); }
  /* policy rates are published every day, even unchanged: they enter the feed only when the rate actually changes, and only
     in the days right after a scheduled decision (decision day to +3 days, covering the next-day posting) */
  function printable(m) {
    if (m.freq !== "D") return true;
    if (m.prior == null || +m.value === +m.prior) return false;
    var ds = ((DATA.release_cal || {})[m.key] || {}).dates || [], od = Date.parse((m.obs_date || "") + "T12:00:00Z");
    if (!isFinite(od)) return false;
    return ds.some(function (d) { var t = Date.parse(d.slice(0, 10) + "T12:00:00Z"); return od >= t && od - t <= 3 * 86400000; });
  }
  /* macro print in the desk alert format; impact follows the print vs forecast (else vs prior) and the series' good direction */
  function relHTML(m) {
    var u = m.unit === "K" ? "K" : m.unit || "", c = m.cons && m.cons.forecast != null ? m.cons.forecast : null, ref = c != null ? c : m.prior;
    var d = ref == null ? 0 : m.value - ref, strong = m.good === "down" ? d < 0 : d > 0, us = m.group !== "ca";
    var imp = Math.abs(d) < Math.pow(10, -(m.dec || 1)) / 2 ? "Mixed" : (strong === us ? "Bullish" : "Bearish") + " USD/CAD (" + (strong ? "stronger" : "weaker") + " " + (us ? "US" : "Canada") + " " + (m.good === "heat" ? "inflation" : "print") + " vs " + (c != null ? "forecast" : "prior") + ")";
    var cls = /^Bullish/.test(imp) ? "bull" : /^Bearish/.test(imp) ? "bear" : "mix";
    return "<b>[BREAKING] – " + (us ? "US" : "Canada") + " " + esc(m.name) + " " + esc(m.period) + ": " + esc(m.value) + esc(u) + "</b>" +
      '<div class="fr-al"><div><i>Trigger</i>Printed ' + esc(m.value) + esc(u) + (c != null ? " vs forecast " + esc(c) + esc(u) : "") + (m.prior != null ? " (prior " + esc(m.prior) + esc(u) + ")" : "") + "</div>" +
      '<div><i>Market impact</i><span class="fr-imp ' + cls + '">' + esc(imp) + "</span></div>" +
      "</div>";
  }
  function diff() {
    if (!ready() || window.DESK_LOCKED) return;
    var s = snap(), first = !base, today = dayIso(Date.now());
    Object.keys(ASOF).forEach(function (k) {
      var v = s.asof[k]; if (!v) return;
      /* on first load, today's earlier refreshes are added at the time they landed; afterwards, each new refresh as it arrives */
      if (first ? SEED[k] && dayIso(Date.parse(v)) === today : (s.fp[k] !== base.fp[k] && base.fp[k] != null))
        log("data", "<b>Updated</b> — " + esc(ASOF[k][0]) + detail(k), ASOF[k][1] + "@" + (WHERE[k] ? WHERE[k][1] : '[data-src="' + k + '"]'), "asof|" + k + "|" + v, first ? Date.parse(v) : 0);
    });
    if (first) (window.macroAll ? macroAll() : []).forEach(function (m) {   /* prints that landed today before the page opened */
      var t = m.seen_at ? Date.parse(m.seen_at) : NaN; if (isNaN(t) || Date.now() - t > 18 * 3600000 || !printable(m)) return;
      var u = m.unit === "K" ? "K" : m.unit || "";
      log("release", relHTML(m), "macro:dash@[data-mkey=\"" + m.key + "\"]", "mac|" + m.key + "|" + s.macro[m.key], t);
    });
    if (first) { delete s.pol; base = s; return; }   /* policy items are seeded on the next pass */
    (window.macroAll ? macroAll() : []).forEach(function (m) {
      if (base.macro[m.key] && s.macro[m.key] !== base.macro[m.key] && printable(m)) {
        var u = m.unit === "K" ? "K" : m.unit || "";
        log("release", relHTML(m), "macro:dash@[data-mkey=\"" + m.key + "\"]", "mac|" + m.key + "|" + s.macro[m.key]);
      }
    });
    Object.keys(s.walls).forEach(function (k) {
      var a = base.walls[k], b = s.walls[k], go = k + ':deriv@[id^="oi-"]'; if (!a) return;
      if (a[0] != null && b[0] != null && a[0] !== b[0]) log("oi", "<b>" + GN[k] + " call wall</b> moves " + sk(a[0]) + " → <b>" + sk(b[0]) + "</b> (new resistance)", go, "cw|" + k + "|" + b[0] + "|" + Math.round(Date.now() / 600000));
      if (a[1] != null && b[1] != null && a[1] !== b[1]) log("oi", "<b>" + GN[k] + " put wall</b> moves " + sk(a[1]) + " → <b>" + sk(b[1]) + "</b> (new support)", go, "pw|" + k + "|" + b[1] + "|" + Math.round(Date.now() / 600000));
      if (base.oi[k] && s.oi[k] !== base.oi[k]) {
        var S = DATA.grains[k].oishift, first = S && S.items && S.items[0];
        log("oi", "<b>" + GN[k] + " open interest refreshed</b> — " + esc((s.oi[k] || "").replace(/^.*OI as of /, "OI as of ")) + (first ? "<br><small>" + first.t + "</small>" : ""), go, "oil|" + k + "|" + s.oi[k]);
      }
      /* price trading through a wall */
      var p0 = base.px[k], p1 = s.px[k], cw = b[0], pw = b[1];
      if (isFinite(p0) && isFinite(p1)) {
        if (cw != null && p0 < cw && p1 >= cw) log("level", "<b>" + GN[k] + "</b> trades up through the call wall " + sk(cw) + " (" + p1.toFixed(4) + ")", go);
        if (pw != null && p0 > pw && p1 <= pw) log("level", "<b>" + GN[k] + "</b> trades down through the put wall " + sk(pw) + " (" + p1.toFixed(4) + ")", go);
      }
    });
    Object.keys(s.roll).forEach(function (k) {   /* futures roll crossing the 40% liquidity threshold opens the next option month */
      var a = base.roll[k], b = s.roll[k]; if (!a || !b) return;
      if (a.pct < 40 && b.pct >= 40) log("oi", "<b>" + GN[k] + " roll passes 40%</b> — " + esc(b.def) + " now holds " + b.pct.toFixed(1) + "% of open interest · next option month window is open", k + ":deriv@.roll-tile", "roll40|" + k + "|" + b.def);
      if (a.pct >= 40 && b.pct < 40) log("oi", "<b>" + GN[k] + " roll back below 40%</b> (" + b.pct.toFixed(1) + "%) — next option month window locked", k + ":deriv@.roll-tile", "roll40d|" + k + "|" + b.pct);
    });
    /* central-bank statements, minutes and speeches read by the Policy engine (all five banks) */
    if (s.pol) {
      var PJ3 = POLICY._data(), TY = { statement: "statement", minutes: "minutes", press_conference: "press conference", speech: "speech", testimony: "testimony", interview: "interview" };
      Object.keys(s.pol).forEach(function (id) {
        var d = s.pol[id], seenBefore = base.pol && base.pol[id], fresh = d.published_at && Date.now() - Date.parse(d.published_at) < 36 * H;
        if (seenBefore || !fresh) return;   /* first load: today's and yesterday's items; afterwards: anything new */
        var B = (PJ3.banks || {})[d.bank] || {}, top = (d.evidence || [])[0];
        var msg = (window.flag && B.cc && (B.cc === "us" || B.cc === "ca") ? flag(B.cc, 11) + " " : "") + "<b>" + esc(B.name || d.bank) + " — " + esc(TY[d.type] || d.type) + (d.speaker && d.speaker !== "Committee" ? " · " + esc(d.speaker) : "") + ": " +
          esc((d.label || "").toLowerCase()) + " (" + (d.score > 0 ? "+" : "") + d.score + ")</b>" + (d.guidance && d.guidance.direction !== "none" ? "<br><small>" + esc(d.guidance.next_action) + "</small>" : "") +
          (d.dissent && d.dissent.length ? "<br><small>disagreement on record</small>" : "") + (top ? "<br><small>“" + esc(top.q.slice(0, 140)) + (top.q.length > 140 ? "…" : "") + "”</small>" : "");
        log("policy", msg, "policy:" + d.id, "pol|" + d.id + "|" + (d.version || 1), Date.parse(d.published_at));
        if (base.pol && (d.type === "statement" || d.type === "press_conference") && window.DESK_LIVE && DESK_LIVE.toast) { window.__evNoLog = 1; try { DESK_LIVE.toast(msg); } finally { window.__evNoLog = 0; } }
      });
    }
    ["boc", "fed"].forEach(function (b) {   /* central-bank decision landed: feed + on-screen notification */
      var r = pw()[b]; if (!r || r.status !== "out" || s.pw[b] === base.pw[b] || r.date !== dayIso(Date.now())) return;
      var msg = "<b>" + BANK[b].n + ": " + r.decision + (r.change_bp ? " " + (r.change_bp > 0 ? "+" : "") + r.change_bp + " bp" : "") + " to " + rateTxt(r.rate) + " — " + r.tone + "</b> (score " + (r.score > 0 ? "+" : "") + r.score + ")" +
        (r.surprise_bp ? " · " + (r.surprise_bp > 0 ? "+" : "") + r.surprise_bp + " bp vs forecast" : "") + "<br><small>on the desk " + lagTxt(r.lag_min) + " after the scheduled time</small>";
      log("release", msg, "macro:cycle", "pw|" + b + "|" + r.date, Date.parse(r.t_seen));
      if (window.DESK_LIVE && DESK_LIVE.toast) { window.__evNoLog = 1; try { DESK_LIVE.toast(msg); } finally { window.__evNoLog = 0; } }
      try { if (localStorage.getItem("desk.worldNotify") === "1" && "Notification" in window && Notification.permission === "granted") new Notification(BANK[b].n + " — " + r.decision + " " + rateTxt(r.rate) + " · " + r.tone, { body: "On the desk " + lagTxt(r.lag_min) + " after the scheduled time" }); } catch (e) {}
      screenSeen(b, r); if (active()) repaintMain();
    });
    Object.keys(s.flow).forEach(function (k) {   /* 10-session position-flow signal changing category */
      var a = base.flow[k], b = s.flow[k]; if (!a || !b || a.b === b.b) return;
      log("oi", "<b>" + GN[k] + " position flow: " + esc(b.b.toLowerCase()) + "</b> (was " + esc(a.b.toLowerCase()) + ") — 10-session score " + (b.sc > 0 ? "+" : "") + b.sc + " through " + esc(b.d), k + ":deriv@.fl-tile", "flow|" + k + "|" + b.b + "|" + b.d);
    });
    if (s.gg && base.gg && s.gg !== base.gg) log("data", "<b>Updated</b> — Brazil &amp; World fundamentals (CONAB · USDA · Comex)", "corn:fund@[data-src=\"ext\"]", "gg|" + s.gg);
    Object.keys(s.wa).forEach(function (k) {
      if (base.wa[k] == null || s.wa[k] === base.wa[k] || !s.wa[k]) return;
      var W = WORLD._data(), i = (W.instruments || []).filter(function (x) { return (x.id || x.name) === k; })[0];
      log("world", "<b>" + esc(i ? i.name : k) + "</b> sets a new 52-week " + (s.wa[k].indexOf("H") >= 0 ? "high" : "low"), "world", "w52|" + k + "|" + s.wa[k] + "|" + dayIso(Date.now()));
    });
    base = s;
  }
  /* scheduled events reaching their time while the page is open */
  var dueSeen = {};
  function dueTick(now) {
    if (!ready()) return;
    todayEvents(now).forEach(function (e) {
      if (e.kind === "desk" || dueSeen[e.id]) return;
      if (e.t <= now && now - e.t < 2 * MIN) { dueSeen[e.id] = 1;
        log("due", "<b>Due now</b> — " + esc(e.label) + (e.fc ? " · fc " + esc(e.fc) : "") + (e.prev ? " · prev " + esc(e.prev) : ""), e.go, "due|" + e.id, e.t); }
      else if (e.t <= now) dueSeen[e.id] = 1;
    });
  }
  /* desk notifications (release arrivals, USD/CAD level crossings, world alerts) are also recorded */
  function hookToast() {
    var L = window.DESK_LIVE; if (!L || !L.toast || L.toast._ev) return;
    var orig = L.toast;
    L.toast = function (html) {
      try { if (window.__evNoLog) return orig.apply(this, arguments);
        var txt = String(html), k = /World alert/.test(txt) ? "world" : /USD\/CAD/.test(txt) && /crossed/.test(txt) ? "level" : "release";
        log(k, txt.replace(/<(?!\/?b>|br>)[^>]*>/g, ""), k === "world" ? "" : k === "level" ? "fx:overview" : "", "toast|" + txt + "|" + Math.round(Date.now() / 60000));
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    L.toast._ev = 1;
  }

  /* ---------- wiring ---------- */
  function go(spec, sel) {
    var at = (spec || "").indexOf("@"); if (at >= 0) { sel = sel || spec.slice(at + 1); spec = spec.slice(0, at); }   /* "tab:section@card" */
    var a = (spec || "").split(":"), b = document.getElementById("tabbtn-" + a[0]); if (!b) return;
    b.click();
    var mk = a[0] === "macro" && sel ? /data-mkey="([^"]+)"/.exec(sel) : null;   /* Macro page: open that data point's card */
    if (mk && window.MNAV && MNAV.open) { try { MNAV.open(mk[1]); } catch (e) {} }
    if (sel) setTimeout(function () { decorate();
      var el = [].filter.call(document.querySelectorAll("#panel-" + a[0] + " " + sel), function (x) { return x.offsetParent !== null; })[0];   /* the visible copy */
      if (el) { var c = el.closest(".mn2-card, .mk-click, .mcard, .tile, .dash-card") || el;
        var y = c.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3; window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
        c.classList.remove("flash-find"); void c.offsetWidth; c.classList.add("flash-find"); } }, 320);
    if (a[0] === "policy") { if (a[1] && window.POLICY && POLICY.open) POLICY.open(a[1]); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (a[1] && window.setSub) setTimeout(function () { window.setSub(a[0], a[1]); if (!sel) window.scrollTo({ top: 0, behavior: "smooth" }); }, 30);
  }
  document.addEventListener("input", function (ev) { var q = ev.target && ev.target.getAttribute && ev.target.hasAttribute("data-evq") ? ev.target : null; if (!q) return; V.q = q.value; var b = document.getElementById("evBody"); if (b) b.innerHTML = bodyHTML(Date.now()); });
  document.addEventListener("change", function (ev) { var el = ev.target; if (!el || !el.getAttribute) return;
    if (el.hasAttribute("data-evimpc")) { V.imp[el.getAttribute("data-evimpc")] = el.checked; saveV(); repaintMain(true); return; }
    if (el.hasAttribute("data-evcat")) { V.cat = el.value; saveV(); repaintMain(true); } else if (el.hasAttribute("data-evcustom")) { V.custom = el.value; saveV(); repaintMain(true); } });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target && ev.target.closest && ev.target.closest("tr[data-evmacro]") && !ev.target.closest("button")) { go("macro:dash", '[data-mkey="' + ev.target.closest("tr[data-evmacro]").getAttribute("data-evmacro") + '"]'); return; }
    if (ev.key === "Enter" && ev.target && ev.target.closest && ev.target.closest("tr[data-evopen]") && !ev.target.closest("button")) { var r = ev.target.closest("tr[data-evopen]"), id = r.getAttribute("data-evopen"); V.open = V.open === id ? "" : id; saveV(); repaintMain(); return; }
    if (ev.key !== "Enter") return; var g = ev.target && ev.target.closest && ev.target.closest(".evfi-go"); if (g) { ev.preventDefault(); go(g.getAttribute("data-evgo")); } });
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var g = t.closest("[data-evgo]"); if (g) { ev.preventDefault(); go(g.getAttribute("data-evgo"), g.getAttribute("data-evsel")); return; }
    if (!t.closest("#panel-events")) { if (t.closest("#tabbtn-events")) { unseen = 0; render(); paintBadge(); } return; }
    var b = t.closest("[data-evday]"); if (b) { V.day = b.getAttribute("data-evday"); V.open = ""; saveV(); repaintMain(true); return; }
    b = t.closest("[data-evimp]"); if (b) { var ki = b.getAttribute("data-evimp"); V.imp[ki] = V.imp[ki] === false; saveV(); repaintMain(true); return; }
    b = t.closest("[data-evcc]"); if (b) { var kc = b.getAttribute("data-evcc"); V.ccs[kc] = V.ccs[kc] === false; saveV(); repaintMain(true); return; }
    b = t.closest("[data-evmacro]"); if (b && !t.closest("button,a,input,select")) { go("macro:dash", '[data-mkey="' + b.getAttribute("data-evmacro") + '"]'); return; }   /* tracked data point: straight to its Macro card */
    b = t.closest("[data-evopen]"); if (b && !t.closest("button,a,input,select")) { var id = b.getAttribute("data-evopen"); V.open = V.open === id ? "" : id; saveV(); repaintMain(); return; }
    var b = t.closest("[data-evgrp]"); if (b) { V.grp = b.getAttribute("data-evgrp"); saveV(); repaintMain(); return; }
    if (t.closest("[data-evhigh]")) { V.high = !V.high; saveV(); repaintMain(); return; }
    var tr = t.closest("[data-evtrack]"); if (tr) { var k = tr.getAttribute("data-evtrack"); V.track[k] = V.track[k] === false; saveV(); repaintMain(); return; }
    b = t.closest("[data-evsrc]"); if (b) { V.src = b.getAttribute("data-evsrc"); saveV(); repaintMain(); return; }
    b = t.closest("[data-evtomall]"); if (b) { V.tomAll = !V.tomAll; saveV(); repaintMain(); return; }
    b = t.closest("[data-evfeed]"); if (b) { FV = b.getAttribute("data-evfeed"); paintFeed(); return; }
    if (t.closest("[data-evclear]")) { ev.preventDefault(); feed = []; store.set(FEED_KEY, feed); paintFeed(); }
  });
  var tick = 0;
  setInterval(function () {
    if (!ready()) return;
    hookToast();
    var now = Date.now(); tick++;
    if (dayIso(now) !== lastDay && lastDay) { log("day", "<b>New day</b> — " + esc(dayLabel(now)), "", "day|" + dayIso(now)); if (active()) render(); }
    dueTick(now);
    if (tick % 3 === 0) { diff(); decorate(); }
    if (tick % 6 === 0) { paintBadge(); if (active()) repaintMain(); }
  }, 5000);
  /* every redraw of a desk rebuilds its cards — put the NEW-today marks back straight after */
  (function () { var ra = window.renderAll; if (ra && !ra._ev) { window.renderAll = function () { var r = ra.apply(this, arguments); try { decorate(); } catch (e) {} return r; }; window.renderAll._ev = 1; } })();
  document.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest(".tab-btn, [data-sub], [data-sec-v]")) setTimeout(function () { try { decorate(); } catch (e) {} }, 60); });
  window.addEventListener("desk:unlock", function () { base = null; setTimeout(function () { diff(); render(); paintBadge(); }, 800); });
  window.EVENTS = { today: function () { return todayEvents(Date.now()); }, on: todayEvents, landed: landed, decorate: decorate, render: render, log: log, _feed: function () { return feed; }, _diff: diff, _snap: snap, _base: function () { return base; } };
  if (ready()) { lastDay = dayIso(Date.now()); render(); paintBadge(); diff(); hookToast(); }
  var evcss = document.createElement("style");
  evcss.textContent = ".evdays{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border-bottom:1px solid var(--line);margin:-4px -4px 10px}.evday{background:none;border:0;border-bottom:2px solid transparent;color:var(--text);padding:8px 4px 10px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;font:600 13.5px 'IBM Plex Sans',sans-serif}.evday[aria-pressed=true]{background:rgba(110,168,255,.08);border-bottom-color:#6ea8ff}" +
    ".evcnt{display:flex;gap:3px}.evcnt i,.evimp-b{font:700 10px 'IBM Plex Mono',monospace;font-style:normal;padding:1px 5px;border-radius:3px;color:#fff}.iH{background:#d6453d}.iM{background:#c99a1e;color:#1b1400!important}.iL{background:#2c4a7a}" +
    ".evfilters{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.evfg{display:flex;flex-wrap:wrap;max-width:100%;align-items:center;gap:4px;border:1px solid var(--line);border-radius:8px;padding:4px 8px}.evfg>span{font:700 10px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-right:4px}" +
    ".evfg button{background:none;border:1px solid transparent;border-radius:5px;color:var(--muted);padding:2px 6px;cursor:pointer;font-size:12.5px}.evfg button[aria-pressed=true]{color:var(--text);border-color:var(--line2);background:rgba(110,168,255,.08)}.evfg button[aria-pressed=false]{opacity:.45}.evfg select{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:2px 6px}" +
    ".evchk{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--text);margin-right:8px;cursor:pointer}.evchk input{accent-color:#6ea8ff;width:15px;height:15px;cursor:pointer}.evx-s{font-size:11.5px!important;color:var(--faint)!important}" +
    ".evq{flex:1;min-width:180px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:8px 12px;font-size:13.5px}.evcust{margin:0 0 10px;font-size:13px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.evcust input{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:5px;padding:3px 6px}.evcust small{color:var(--faint)}" +
    ".ev-next{font-size:13px;color:var(--muted);margin:0 0 10px}.ev-next b{color:var(--text)}" +
    ".ev-tbl{width:100%;border-collapse:collapse;font-size:13px}.ev-tbl th{font:700 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}" +
    ".ev-tbl td{padding:8px;border-bottom:1px solid var(--line);vertical-align:middle}.ev-tbl tr.evr{cursor:pointer}.ev-tbl tr.evr:hover td{background:rgba(110,168,255,.05)}.ev-tbl tr.evr.open td{background:rgba(110,168,255,.08)}.ev-tbl tr.evr.st-out td{opacity:.75}.ev-tbl td,.ev-tbl th{text-align:left!important;white-space:normal}.ev-tbl .evev{min-width:260px}.evx-t p{white-space:normal}#evTop,#evBody{grid-column:1/-1;min-width:0}#evBody{display:flex;flex-direction:column;gap:14px}.ev-tbl tr.evr{display:table-row!important;grid-template-columns:none!important;padding:0!important;border:0!important;background:none!important}.ev-tbl tr.evr.rel-today td{background:#1E40AF;color:#fff}.ev-tbl tr.evr.st-soon td{background:rgba(232,185,61,.10)}.ev-tbl tr.evr.st-due td{background:rgba(63,185,127,.12)}.ev-tbl tr.evr.st-soon td:first-child{box-shadow:inset 3px 0 0 #e8b93d}.ev-tbl tr.evr.st-due td:first-child{box-shadow:inset 3px 0 0 #3fb97f}html[data-theme=light] .ev-tbl tr.evr.rel-today td{background:#DBEAFE;color:#10283F}" +
    ".ev-tbl .evtm{font-family:'IBM Plex Mono',monospace;white-space:nowrap}.ev-tbl .evcc{white-space:nowrap}.ev-tbl .evev{font-weight:600;font-family:'IBM Plex Sans',sans-serif}.ev-tbl .evn{font-family:'IBM Plex Mono',monospace;white-space:nowrap}.ev-tbl .evst{font-size:12px}.ev-tbl .evst .evgo{display:block;margin-top:4px}" +
    ".evimp{display:inline-block;min-width:66px;text-align:center;font:700 11px 'IBM Plex Sans',sans-serif;padding:3px 8px;border-radius:4px;color:#fff}.evimp.iH{background:#d6453d}.evimp.iM{background:#c99a1e;color:#1b1400}.evimp.iL{background:#24406b}" +
    ".evx-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding:8px 4px 10px;border-bottom:1px solid #1a1a1a;margin-bottom:8px}.evx-bar .evgo{font-size:12.5px}" +
    '.ev-tbl tr.evmac .evev:after{content:" → Macro";font:500 10.5px "IBM Plex Mono",monospace;color:#d9b46a;opacity:.75}' + ".evx-bar .evx-full{color:#d9b46a;border:1px solid rgba(217,180,106,.5);border-radius:6px;padding:4px 10px;font-weight:600}.evx-bar .evx-full:hover{background:rgba(217,180,106,.1);text-decoration:none}" +
    ".evx{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:18px;padding:6px 4px 10px}.evx-ch{width:100%;height:auto}.evx-ax{font:10px 'IBM Plex Mono',monospace;fill:var(--muted)}.evx-t p{margin:4px 0 10px;font-size:13px;line-height:1.55;color:var(--muted)}.evx-h{border-collapse:collapse;font-size:12px;margin-bottom:8px}.evx-h td,.evx-h th{padding:3px 10px 3px 0;text-align:left}.evx-l{font-size:12.5px}" +
    "@media (max-width:760px){.evdays{grid-template-columns:repeat(3,1fr)}.evx{grid-template-columns:1fr}.ev-tbl{min-width:820px}}";
  document.head.appendChild(evcss);
})();
