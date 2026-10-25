/* live.js — live layer for the Grain & USD/CAD desk.
 *
 * Everything here sits on top of the static renderers in index.html:
 *   1. Re-polls data.json (written by the GitHub Action) and re-renders when it changes.
 *   2. Streams USD/CAD: Finnhub WebSocket when LIVE_CONFIG.finnhubKey is set,
 *      otherwise a keyless reference-rate poll. Ticks flash, draw a sparkline,
 *      and re-drive the forward curve and level check.
 *   3. Freshness pills on every tile that declares data-src, coloured by how
 *      old its source is relative to that source's normal cadence.
 *   4. Status strip: ET clock, FX + CBOT session state, data age, countdown
 *      to the next high-impact event, level-cross toasts.
 * No dependencies. Fails soft: if a feed is down the page keeps its last data.
 */
(function () {
  "use strict";
  var CFG = window.LIVE_CONFIG || {};
  var ET = "America/Toronto";
  var CAL_TZ = "America/Denver"; // the stored calendar prints times in US Mountain (BoC 9:45 ET shows as 7:45am)
  var SYMBOL = "OANDA:USD_CAD";

  /* expected cadence (minutes) per source — drives pill colour */
  var CADENCE = {
    fx_spot: 15, grains_quote: 30, energy: 120, news: 240,
    crosses: 1440, fx_closes: 1440, yields: 1440, policy: 1440, sentiment: 1440,
    options: 1440, grains_settle: 1440, calendar: 10080, releases: 46080, macro: 240, cftc_fx: 10080, cftc_grains: 10080, canada: 2880, ca_calendar: 2880
  };

  /* ------------------------------------------------------------------ utils */
  function $(id) { return document.getElementById(id); }
  function fmtN(n, d) { return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function etParts(d) {
    var o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { wd: o.weekday, h: +o.hour, m: +o.minute, s: +o.second };
  }
  function etClock(d) { return d.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", second: "2-digit" }); }
  function dur(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "<1m";
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    if (h < 48) return h + "h" + (h < 10 && m % 60 ? " " + (m % 60) + "m" : "");
    return Math.floor(h / 24) + "d " + (h % 24) + "h";
  }
  /* wall-clock time in a named zone -> epoch ms */
  function zoned(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(guess)).forEach(function (x) { p[x.type] = +x.value; });
    var asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    return guess - (asUtc - guess);
  }
  /* hours of Sat/Sun (ET) between two instants — so Monday doesn't look stale */
  function weekendMs(a, b) {
    // whole weekend days between a and b (ET); one Intl call per day, capped at 60 days
    var ms = 0, day = 86400000;
    a = Math.max(a, b - 60 * day);
    for (var t = a; t < b; t += day) {
      var wd = etParts(new Date(t)).wd;
      if (wd === "Sat" || wd === "Sun") ms += Math.min(day, b - t);
    }
    return ms;
  }
  var store = {
    get: function (k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ------------------------------------------------------- market sessions */
  function fxSession(now) {
    var p = etParts(now), mins = p.h * 60 + p.m;
    var open = !(p.wd === "Sat" || (p.wd === "Fri" && mins >= 17 * 60) || (p.wd === "Sun" && mins < 17 * 60));
    return { open: open, label: open ? "FX open" : "FX closed · reopens Sun 5pm ET" };
  }
  /* CBOT grains: day 9:30–14:20 ET, overnight 20:00–08:45 ET (Sun–Fri), halt in between */
  function grainSession(now) {
    var p = etParts(now), mins = p.h * 60 + p.m, wd = p.wd;
    var dayOpen = ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wd) >= 0 && mins >= 570 && mins < 860;
    var night = ((["Sun", "Mon", "Tue", "Wed", "Thu"].indexOf(wd) >= 0 && mins >= 1200) ||
                 (["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wd) >= 0 && mins < 525));
    if (dayOpen) return { state: "on", label: "CBOT day session · closes 2:20pm ET" };
    if (night) return { state: "warm", label: "CBOT overnight session" };
    return { state: "off", label: "CBOT grains closed" };
  }

  /* ------------------------------------------------------ freshness pills */
  var liveTickAt = 0;
  function ageInfo(key, now) {
    var meta = (window.DATA && DATA.meta) || {}, iso = meta.asof && meta.asof[key];
    if (key === "fx_spot" && liveTickAt && now - liveTickAt < 90000) return { cls: "fresh", txt: "live" };
    if (!iso) return null;
    var t = new Date(iso).getTime();
    var age = now - t, biz = age - weekendMs(t, now), cad = (CADENCE[key] || 1440) * 60000;
    var cls = biz <= cad * 1.5 ? "fresh" : biz <= cad * 4 ? "aging" : "old";
    return { cls: cls, txt: dur(age) + " ago", title: "as of " + new Date(iso).toLocaleString("en-US", { timeZone: ET }) + " ET" };
  }
  function paintPills() {
    var now = Date.now();
    document.querySelectorAll("[data-src]").forEach(function (tile) {
      var h2 = tile.querySelector("h2"); if (!h2) return;
      var a = ageInfo(tile.getAttribute("data-src"), now);
      if (a && a.txt === "live" && tile.id === "fx-spot-tile") a = null;   // the LIVE chip already says it
      var pill = h2.querySelector(".age-pill");
      if (!a) { if (pill) pill.remove(); return; }
      if (!pill) { pill = document.createElement("span"); h2.appendChild(pill); }
      pill.className = "age-pill " + a.cls;
      pill.textContent = a.txt;
      if (a.title) pill.title = a.title;
    });
  }

  /* ------------------------------------------------------ next event */
  function nextEvent(now) {
    var ev = (DATA.fx && DATA.fx.events) || [], best = null;
    ev.forEach(function (e) {
      if (e.impact !== "High") return;
      var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date), tm = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(e.time || "");
      if (!dm || !tm) return;
      var h = +tm[1] % 12 + (tm[3].toLowerCase() === "pm" ? 12 : 0);
      var t = zoned(+dm[1], +dm[2], +dm[3], h, +tm[2], CAL_TZ);
      if (t > now - 60000 && (!best || t < best.t)) best = { t: t, e: e };
    });
    if (!best) return null;
    var same = ev.filter(function (e) { return e.impact === "High" && e.date === best.e.date; })
      .map(function (e) { return e.ccy === "CAD" ? "BoC" : e.ccy === "USD" && /Fed|FOMC/.test(e.event) ? "FOMC" : e.event; });
    var names = same.filter(function (x, i) { return same.indexOf(x) === i; }).join(" + ");
    return { t: best.t, names: names, first: best.e.event };
  }

  /* ------------------------------------------------------ status strip */
  var feedName = "";
  function paintCountdowns() {
    var now = Date.now();
    document.querySelectorAll(".countdown[data-t]").forEach(function (el) {
      var ms = +el.getAttribute("data-t") - now;
      el.textContent = el.getAttribute("data-fmt") === "hms" && typeof window.hmsText === "function" ? window.hmsText(ms)
        : typeof window.cdText === "function" ? window.cdText(ms) : dur(ms);
    });
  }
  function syncStripHeight() {
    var el = $("status-strip");
    if (el) document.documentElement.style.setProperty("--strip-h", el.offsetHeight + "px");
  }
  function paintStrip() {
    var el = $("status-strip"); if (!el || !window.DATA) return;
    var now = new Date(), fx = fxSession(now), gr = grainSession(now), meta = DATA.meta || {};
    var newest = [meta.updated_at, meta.live_at].filter(Boolean).sort().pop();
    var upd = newest ? now - new Date(newest) : Infinity;
    var streaming = liveTickAt && now - liveTickAt < 90000;
    var mode = streaming ? "live" : upd < 45 * 60000 ? "live" : upd < 26 * 3600000 ? "stale" : "";
    el.className = "snapshot-banner" + (mode ? " " + mode : "");
    var liveAge = meta.live_at ? now - new Date(meta.live_at) : Infinity;
    var head = streaming ? "<b>LIVE</b> · USD/CAD streaming (" + feedName + ")" + (liveAge < 180000 ? " · prices " + dur(liveAge) + " old" : "")
      : liveAge < 180000 ? "<b>LIVE FEED</b> · prices " + dur(liveAge) + " old"
      : mode === "live" ? "<b>AUTO-REFRESH</b> · data " + dur(upd) + " old"
      : "<b>SNAPSHOT</b> · data " + (isFinite(upd) ? dur(upd) + " old" : "frozen at build");
    var nx = nextEvent(now.getTime());
    el.innerHTML = '<div class="ss-row">' +
      '<span class="ss-item"><span class="dot ' + (streaming || mode === "live" ? "on" : mode === "stale" ? "warm" : "off") + '"></span>' + head + '</span>' +
      '<span class="ss-item">' + etClock(now) + ' ET</span>' +
      '<span class="ss-item"><span class="dot ' + (fx.open ? "on" : "off") + '"></span>' + fx.label + '</span>' +
      '<span class="ss-item"><span class="dot ' + gr.state + '"></span>' + gr.label + '</span>' +
      (nx ? '<span class="ss-item">Next high-impact: ' + nx.names + ' in <span class="countdown">' + dur(nx.t - now) + '</span></span>' : '') +
      '</div>';
  }

  /* ------------------------------------------------------ toasts */
  function toast(html) {
    var box = $("live-toasts");
    if (!box) { box = document.createElement("div"); box.id = "live-toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    var t = document.createElement("div"); t.className = "live-toast"; t.innerHTML = html;
    box.appendChild(t);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { t.classList.add("out"); }, 6000);
    setTimeout(function () { t.remove(); }, 6800);
  }

  /* ------------------------------------------------------ USD/CAD ticks */
  var dayKey = "usdcad-ticks-" + new Date().toLocaleDateString("en-CA", { timeZone: ET });
  var ticks = store.get(dayKey) || [];          // [[epochMs, price], ...]
  var last = ticks.length ? ticks[ticks.length - 1][1] : null;
  var lastFwdPaint = 0;

  function sparkSVG() {
    if (ticks.length < 2) return "";
    var W = 300, H = 34, xs = ticks.map(function (t) { return t[0]; }), ys = ticks.map(function (t) { return t[1]; });
    var x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1, lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    if (hi - lo < 0.0002) { var mid = (hi + lo) / 2; hi = mid + 0.0001; lo = mid - 0.0001; }
    var pts = ticks.map(function (t) {
      return ((t[0] - x0) / Math.max(1, x1 - x0) * W).toFixed(1) + "," + (H - 2 - (t[1] - lo) / (hi - lo) * (H - 4)).toFixed(1);
    }).join(" ");
    var up = ys[ys.length - 1] >= ys[0], c = up ? "var(--green)" : "var(--red)";
    var lx = W, ly = H - 2 - (ys[ys.length - 1] - lo) / (hi - lo) * (H - 4);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="USD/CAD ticks this session">' +
      '<polyline fill="none" stroke="' + c + '" stroke-width="1.6" vector-effect="non-scaling-stroke" points="' + pts + '"/>' +
      '<circle cx="' + lx + '" cy="' + ly.toFixed(1) + '" r="2.6" fill="' + c + '"/></svg>';
  }

  var crossedAt = {};                             // per-level cooldown so noise around a level doesn't spam
  function levelCrossCheck(prev, p) {
    var L = DATA.fx.levels;
    [["20D support", L.s20], ["prior-session pivot", L.pivot], ["pivot high", L.pivot_h], ["pivot low", L.pivot_l], ["20D resistance", L.r20]]
      .forEach(function (lv) {
        if ((prev - lv[1]) * (p - lv[1]) < 0 && !(Date.now() - (crossedAt[lv[0]] || 0) < 600000)) {
          crossedAt[lv[0]] = Date.now();
          toast('<b>USD/CAD ' + (p > prev ? "↑ crossed above" : "↓ crossed below") + '</b> ' + lv[0] + ' ' + fmtN(lv[1], 5) +
            '<br><span class="news-meta">' + fmtN(p, 5) + ' · ' + etClock(new Date()) + ' ET · ' + feedName + '</span>');
        }
      });
  }

  function paintSpot(p, flash) {
    var fx = DATA.fx, big = $("fx-spot-big");
    if (big) big.textContent = fmtN(p, 5);
    var chg = (p / fx.spot.ref - 1) * 100, c = $("fx-spot-chg");
    var ks = $("kpi-spot"), kc = $("kpi-spot-chg");
    if (ks) ks.textContent = fmtN(p, 5);
    if (kc) { kc.textContent = (chg > 0 ? "+" : chg < 0 ? "\u2212" : "") + fmtN(Math.abs(chg), 2) + "%"; kc.className = chg > 0 ? "up" : chg < 0 ? "dn" : "neu"; }
    if (c) { c.textContent = (chg > 0 ? "+" : chg < 0 ? "−" : "") + fmtN(Math.abs(chg), 3) + "%"; c.className = chg > 0 ? "up" : chg < 0 ? "dn" : "neu"; }
    document.querySelectorAll('[data-live="usdcad"]').forEach(function (el) { el.textContent = fmtN(p, 5); });
    document.querySelectorAll('[data-live-chg]').forEach(function (el) { var u = chg >= 0; el.textContent = (u ? "\u25b2 +" : "\u25bc \u2212") + fmtN(Math.abs(chg), 2) + "%"; el.className = "live-chg " + (u ? "up" : "dn"); });
    if (typeof window.fxIntradaySVG === "function") document.querySelectorAll('[data-live-chart]').forEach(function (el) { el.innerHTML = window.fxIntradaySVG(window.fxIntradayPoints(ticks)); });
    var fresh = Date.now() - liveTickAt < 90000, chip = $("fx-spot-chip");
    if (chip) { chip.textContent = fresh ? "LIVE" : "LAST TICK"; chip.className = fresh ? "chip live" : "chip frozen"; }
    var series = (typeof window.fxIntradayPoints === "function") ? window.fxIntradayPoints(ticks) : ticks;
    if (series.length) {
      var ys = series.map(function (t) { return t[1]; }), hl = $("fx-spot-hl");
      if (hl) hl.textContent = fmtN(Math.max.apply(null, ys), 5) + " / " + fmtN(Math.min.apply(null, ys), 5);
    }
    var sk = $("fx-spark");
    if (sk) sk.innerHTML = (typeof window.fxIntradaySVG === "function") ? window.fxIntradaySVG(window.fxIntradayPoints(ticks)) : sparkSVG();
    var st = $("fx-spot-stamp");
    if (st) st.textContent = "Streaming mid · " + feedName + " · last tick " + etClock(new Date(liveTickAt || Date.now())) +
      " ET · " + ticks.length + " ticks this session";
    if (window.FWD) window.FWD.update(p);       /* forward curve updates in place (batched inside fwd.js) */
    else if (Date.now() - lastFwdPaint > 2000 && typeof window.fxForwardsHTML === "function") { var fw = $("fx-fwd"); if (fw) fw.innerHTML = window.fxForwardsHTML(p); }
    if (Date.now() - lastFwdPaint > 2000) {
      lastFwdPaint = Date.now();
      var lc = $("fx-levelcheck"); if (lc && typeof window.fxLevelCheck === "function") lc.innerHTML = window.fxLevelCheck(p);
    }
    if (window.MOTION) window.MOTION.scan();   /* flash / roll the changed prices, glide the chart marker */
  }

  function onTick(p, source) {
    if (!(p > 0) || !window.DATA) return;
    var ref = DATA.fx.feed.mid;
    if (Math.abs(p / ref - 1) > 0.03) return;            // reject bad prints (>3% from the stored feed)
    feedName = source;
    var now = Date.now();
    if (last !== null && p !== last) levelCrossCheck(last, p);
    if (!ticks.length || ticks[ticks.length - 1][1] !== p || now - ticks[ticks.length - 1][0] > 60000) {
      ticks.push([now, p]);
      if (ticks.length > 600) ticks = ticks.filter(function (_, i) { return i % 2 === 0 || i > ticks.length - 100; });
      store.set(dayKey, ticks);
    }
    liveTickAt = now;
    paintSpot(p, true);
    last = p;
    paintPills();
  }

  /* Finnhub stream (free key) */
  var ws = null, wsBackoff = 2000;
  function connectStream() {
    if (!CFG.finnhubKey || ws) return;
    try { ws = new WebSocket("wss://ws.finnhub.io?token=" + encodeURIComponent(CFG.finnhubKey)); }
    catch (e) { ws = null; return; }
    ws.onopen = function () { wsBackoff = 2000; ws.send(JSON.stringify({ type: "subscribe", symbol: SYMBOL })); };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.type === "trade" && m.data && m.data.length) onTick(+m.data[m.data.length - 1].p, "Finnhub/OANDA stream");
      } catch (e) {}
    };
    ws.onclose = function () { ws = null; setTimeout(connectStream, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 60000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  /* keyless reference-rate poll — used when no key, or the stream goes quiet */
  var refFails = 0, refLastOk = 0;
  function pollRef() {
    if (document.hidden || window.DESK_LOCKED) return;
    if (ws && Date.now() - liveTickAt < 90000) return;   // stream healthy
    fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (j) { var v = j && j.data && j.data.rates && +j.data.rates.CAD;
        if (v > 0) { refFails = 0; refLastOk = Date.now(); onTick(v, "reference rate, ~30s poll"); } else refFails++; })
      .catch(function () { refFails++; if (window.FWD) window.FWD.update(); });
  }
  /* honest feed state for the forward curve: what actually delivered the last price, and when */
  function feedState() {
    return { source: feedName, stream: !!(ws && CFG.finnhubKey && /stream/i.test(feedName || "")), lastTick: liveTickAt, last: last,
             refFails: refFails, refLastOk: refLastOk, session: fxSession(new Date(Date.now())), online: navigator.onLine !== false };
  }

  /* ------------------------------------------------------ data.json re-poll */
  function openRailState() {
    return [].map.call(document.querySelectorAll("details.rail-card"), function (d) { return d.open; });
  }
  function pollData(force) {
    if ((document.hidden && !force) || window.DESK_LOCKED) return Promise.resolve();
    return fetch("data.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (j) {
        if (!j || !j.DATA || !j.DATA.meta) return;
        var cur = (DATA.meta && DATA.meta.updated_at) || "";
        if (new Date(j.DATA.meta.updated_at) <= new Date(cur)) return;
        var before = Object.assign({}, DATA.meta.asof);
        DATA = window.DATA = j.DATA;
        if (j.NEWS) NEWS = window.NEWS = j.NEWS;
        if (lastLive) mergeLive(lastLive);   // never step back behind the fast lane
        rerender(before);
      })
      .catch(function () { return "err"; });
  }

  /* ------------------------------------------------------ fast lane: live.json every 60 s */
  var lastLive = null, liveEtag = "";
  var LIVE_API = "https://api.github.com/repos/" + (CFG.liveRepo || "anirudhpdoshi/usd-cad-desk-live") + "/contents/live.json?ref=live";
  var LIVE_RAW = "https://raw.githubusercontent.com/" + (CFG.liveRepo || "anirudhpdoshi/usd-cad-desk-live") + "/live/live.json";
  function newer(a, b) { return a && (!b || new Date(a) > new Date(b)); }
  function mergeLive(L) {
    var A = DATA.meta.asof, changed = false;
    if (newer(L.asof.fx_spot, A.fx_spot)) { DATA.fx.feed = L.fx.feed; DATA.fx.intraday = L.fx.intraday; A.fx_spot = L.asof.fx_spot; changed = true; }
    if (newer(L.asof.grains_quote, A.grains_quote)) {
      Object.keys(L.grains).forEach(function (k) { if (DATA.grains[k]) { DATA.grains[k].fan.intraday = L.grains[k].intraday; DATA.grains[k].fan.intraday_ts = L.grains[k].intraday_ts; } });
      A.grains_quote = L.asof.grains_quote; changed = true;
    }
    if (newer(L.asof.energy, A.energy)) { DATA.fx.energy = L.fx.energy; DATA.fx.wcs_diff = L.fx.wcs_diff; A.energy = L.asof.energy; changed = true; }
    if (newer(L.asof.crosses, A.crosses)) { DATA.fx.fxcross = L.fx.fxcross; A.crosses = L.asof.crosses; changed = true; }
    if (L.rel) Object.keys(L.rel).forEach(function (b) {       /* released data fetched by the fast lane */
      var R = L.rel[b];
      if (!R || !R.set || !newer(R.asof, A[b])) return;
      Object.keys(R.set).forEach(function (p) { var ks = p.split("."), o = DATA; for (var i = 0; i < ks.length - 1; i++) { o = o[ks[i]] = o[ks[i]] || {}; } o[ks[ks.length - 1]] = R.set[p]; });
      A[b] = R.asof; changed = true;
    });
    DATA.meta.live_at = L.updated_at;
    return changed;
  }
  function rerender(before) {
    var rails = openRailState();
    window.renderAll();
    document.querySelectorAll("details.rail-card").forEach(function (d, i) { if (rails[i]) d.open = true; });
    document.querySelectorAll("[data-src]").forEach(function (t) {
      var k = t.getAttribute("data-src");
      if (before[k] !== DATA.meta.asof[k]) { t.classList.add("just-updated"); setTimeout(function () { t.classList.remove("just-updated"); }, 2600); }
    });
    if (last !== null && liveTickAt && liveTickAt > new Date(DATA.meta.asof.fx_spot).getTime()) { lastFwdPaint = 0; paintSpot(last, false); }
    paintPills(); paintStrip();
  }
  function applyLive(L) {
    if (!L || !L.updated_at || !L.asof) return;
    if (lastLive && new Date(L.updated_at) <= new Date(lastLive.updated_at)) return;
    lastLive = L;
    var before = Object.assign({}, DATA.meta.asof);
    if (mergeLive(L)) rerender(before); else paintStrip();
  }
  function pollLive(force) {
    if ((document.hidden && !force) || window.DESK_LOCKED) return Promise.resolve();
    var h = { Accept: "application/vnd.github.raw+json" };
    if (liveEtag) h["If-None-Match"] = liveEtag;
    return fetch(LIVE_API, { headers: h, cache: "no-store" })
      .then(function (r) {
        if (r.status === 304) return null;              // unchanged: does not count against GitHub's rate limit
        if (!r.ok) throw r.status;
        liveEtag = r.headers.get("ETag") || "";
        return r.json();
      })
      .then(function (j) { if (j) applyLive(j); })
      .catch(function () {                              // API rate-limited or down: raw CDN (can be ~5 min stale)
        return fetch(LIVE_RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) applyLive(j); }).catch(function () { return "err"; });
      });
  }

  /* ------------------------------------------------------ boot */
  var css = document.createElement("style");
  css.textContent =
    "#live-toasts{position:fixed;right:14px;bottom:14px;z-index:80;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 28px))}" +
    ".live-toast{background:#132235;border:1px solid #3d5a80;border-left:3px solid var(--amber);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--ink);box-shadow:0 6px 24px rgba(0,0,0,.45);transition:opacity .6s,transform .6s}" +
    ".live-toast.out{opacity:0;transform:translateY(8px)}" +
    ".tile.just-updated{animation:tupd 2.6s ease-out}" +
    "@keyframes tupd{0%{box-shadow:0 0 0 2px rgba(56,182,201,.9)}100%{box-shadow:0 0 0 2px rgba(56,182,201,0)}}" +
    "@media (prefers-reduced-motion:reduce){.tile.just-updated{animation:none}}";
  document.head.appendChild(css);

  function boot() {
    if (!window.DATA) return;
    if (ticks.length) { feedName = "earlier this session"; liveTickAt = ticks[ticks.length - 1][0]; paintSpot(last, false); }
    paintPills(); paintStrip(); syncStripHeight();
    pollData();
    connectStream();
    pollRef();
    setInterval(function () { paintStrip(); paintCountdowns(); syncStripHeight(); }, 1000);
    window.addEventListener("resize", syncStripHeight);
    setInterval(paintPills, 30000);
    setInterval(pollData, (CFG.dataPollSec || 300) * 1000);
    pollLive();
    setInterval(pollLive, (CFG.livePollSec || 60) * 1000);
    setInterval(pollRef, (CFG.refPollSec || 30) * 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { pollData(); pollRef(); pollLive(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  function onUnlock() {
    document.body.classList.add("refreshing");
    liveEtag = "";                                   // force a full read, not a 304
    var done = function () { document.body.classList.remove("refreshing"); paintPills(); paintStrip(); };
    var guard = setTimeout(done, 8000);
    Promise.all([pollData(), pollLive()]).then(function () { clearTimeout(guard); done(); }, function () { clearTimeout(guard); done(); });
    pollRef();
  }
  window.addEventListener("desk:unlock", onUnlock);
  if (window.DESK_LOCKED === false) onUnlock();      // live.js arrived after an unlock

  window.DESK_LIVE = { onTick: onTick, pollData: pollData, pollLive: pollLive, applyLive: applyLive, toast: toast, feedState: feedState }; // handy for testing in the console
})();
