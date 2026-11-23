/* recap.js — (owner, Nov 22 2026)
   1) BREAKING BANNER: any feed item the rail marks breaking (macro print, central-bank decision/minutes, desk alert, market-moving
      announcement) shows as a red bar under the status strip on every tab for 1 hour after it happened. Dismissible; several rotate.
   2) AUDIO RECAP: "🔊 Recap" at the right of the top menu. Every time a section's data refreshes, a one-line change note is kept
      (prices that moved, new feed items, new intel). Play speaks: market prices now, what broke today, agri intelligence, what
      changed since the last recap, and what is coming next. Only numbers the desk actually holds are spoken; missing ones are skipped. */
(function () {
  "use strict";
  var doc = document, BAN_MS = 3600e3, LOGK = "desk.recap.log", HIDEK = "desk.brk.hidden", RATEK = "desk.recap.rate";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }); }
  function dayKey(t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }
  function plain(h) { var d = doc.createElement("div"); d.innerHTML = h || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); }

  /* ---------- feed access ---------- */
  function feed() { try { return (window.EVENTS && EVENTS._feed && EVENTS._feed()) || []; } catch (e) { return []; } }
  function isBreaking(m) { try { return !!(window.FEEDRAIL && FEEDRAIL.breaking && FEEDRAIL.breaking(m)); } catch (e) { return false; } }
  function info(m) {
    try { if (window.FEEDRAIL && FEEDRAIL.itemOf) return FEEDRAIL.itemOf(m); } catch (e) {}
    var d = doc.createElement("div"); d.innerHTML = m.h || ""; var a = d.querySelector("a[href^='http']");
    return { src: "", txt: plain(m.h), url: a ? a.getAttribute("href") : "" };
  }
  function intel(hours) {
    var D = window.INTEL && INTEL._data && INTEL._data(); if (!D || !D.items) return [];
    var lim = Date.now() - hours * 3600e3;
    return D.items.map(function (i) { return { t: Date.parse(i.ts || i.seen || 0), txt: i.title, src: i.source || "", url: i.url, why: i.why || "", hot: !!(i.alert || i.material), id: "in|" + i.id }; })
      .filter(function (r) { return r.t && r.t >= lim && r.t <= Date.now() + 60000 && r.txt; }).sort(function (a, b) { return b.t - a.t; });
  }

  /* ---------- 1. breaking banner ---------- */
  var hidden = ls(HIDEK, {}), rot = 0, banKey = "";
  function banItems() {
    var now = Date.now(), out = [], seen = {};
    feed().forEach(function (m) {
      if (!m || !m.t || now - m.t > BAN_MS || m.t > now + 60000 || hidden[m.id] || !isBreaking(m)) return;
      var x = info(m), k = (x.txt || "").slice(0, 60).toLowerCase(); if (!x.txt || seen[k]) return; seen[k] = 1;
      out.push({ id: m.id, t: m.t, txt: x.txt, src: x.src || "Desk", url: x.url });
    });
    intel(1).forEach(function (r) { if (!r.hot || hidden[r.id]) return; var k = r.txt.slice(0, 60).toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(r); });
    return out.sort(function (a, b) { return b.t - a.t; });
  }
  function banner() {
    var host = doc.getElementById("brk-banner");
    if (!host) { var ss = doc.getElementById("status-strip"); if (!ss) return; host = doc.createElement("div"); host.id = "brk-banner"; host.setAttribute("aria-live", "assertive"); ss.parentNode.insertBefore(host, ss.nextSibling); }
    var L = banItems();
    if (!L.length) { if (host.innerHTML) host.innerHTML = ""; banKey = ""; return; }
    var i = rot % L.length, b = L[i], key = b.id + "|" + L.length + "|" + Math.floor((Date.now() - b.t) / 60000);
    if (key === banKey) return; banKey = key;
    var mins = Math.max(0, Math.round((Date.now() - b.t) / 60000));
    var safe = b.url && window.safeUrl ? safeUrl(b.url) : (/^https:\/\//.test(b.url || "") ? b.url : "");
    host.innerHTML = '<div class="brk" role="alert"><b class="brk-tag">BREAKING</b><span class="brk-src">' + esc(b.src) + " · " + hm(b.t) + " ET · " + (mins ? mins + " min ago" : "just now") + "</span>" +
      '<span class="brk-t no-nf" title="' + esc(b.txt) + '">' + esc(b.txt) + "</span>" + (safe ? '<a class="brk-a" href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">Source ↗</a>' : "") +
      (L.length > 1 ? '<button type="button" class="brk-n" data-brk-next>' + (i + 1) + " / " + L.length + " ›</button>" : "") +
      '<button type="button" class="brk-x" data-brk-hide="' + esc(b.id) + '" aria-label="Dismiss">✕</button></div>';
  }
  doc.addEventListener("click", function (e) {
    var h = e.target.closest && e.target.closest("[data-brk-hide]"); if (h) { hidden[h.getAttribute("data-brk-hide")] = Date.now(); prune(); lsSet(HIDEK, hidden); banKey = ""; banner(); return; }
    if (e.target.closest && e.target.closest("[data-brk-next]")) { rot++; banKey = ""; banner(); }
  });
  function prune() { var lim = Date.now() - 2 * BAN_MS; Object.keys(hidden).forEach(function (k) { if (hidden[k] < lim) delete hidden[k]; }); }
  setInterval(function () { banner(); }, 15000);
  setInterval(function () { rot++; banKey = ""; banner(); }, 12000);

  /* ---------- 2. change log: one note per section refresh ---------- */
  var LOG = ls(LOGK, []), SNAP = { w: null, f: null, i: null, g: null };
  var KEY = [["^GSPC", "S&P 500"], ["^NDX", "Nasdaq-100"], ["^DJI", "the Dow"], ["^GSPTSE", "the TSX"], ["CAD=X", "US dollar–Canadian dollar"], ["DX-Y.NYB", "the dollar index"],
    ["ZC=F", "corn futures"], ["ZS=F", "soybean futures"], ["ZW=F", "wheat futures"], ["CL=F", "WTI crude"], ["GC=F", "gold"], ["US Treasury 10Y", "the US ten-year yield"], ["^VIX", "the VIX"]];
  function worldMap() { var W = window.WORLD && WORLD._data && WORLD._data(), M = {}; ((W && W.instruments) || []).forEach(function (x) { if (x && x.sym && x.last != null) M[x.sym] = x; }); return M; }
  function note(sec, txt) { if (!txt) return; LOG.push({ t: Date.now(), s: sec, n: txt }); var lim = Date.now() - 48 * 3600e3; LOG = LOG.filter(function (x) { return x.t >= lim; }).slice(-120); lsSet(LOGK, LOG); paintLog(); }
  function track() {
    var M = worldMap();
    if (Object.keys(M).length) {
      if (SNAP.w) { var mv = KEY.map(function (k) { var a = M[k[0]], b = SNAP.w[k[0]]; if (!a || !b || !b.last) return null; var p = (a.last / b.last - 1) * 100; return Math.abs(p) >= 0.25 ? k[1] + " " + (p > 0 ? "up" : "down") + " " + Math.abs(p).toFixed(2) + "%" : null; }).filter(Boolean);
        if (mv.length) note("World Markets", "Since the last refresh: " + mv.slice(0, 5).join(", ") + "."); }
      SNAP.w = M;
    }
    var F = feed(), ids = {}; F.forEach(function (m) { if (m && m.id) ids[m.id] = m; });
    if (SNAP.f) { var nw = Object.keys(ids).filter(function (k) { return !SNAP.f[k] && ids[k].t > Date.now() - 6 * 3600e3; }); nw.slice(0, 4).forEach(function (k) { var x = info(ids[k]); if (x.txt) note(x.src || "Desk feed", x.txt); }); }
    SNAP.f = ids;
    var I = intel(24), ii = {}; I.forEach(function (r) { ii[r.id] = r; });
    if (SNAP.i) { I.filter(function (r) { return !SNAP.i[r.id]; }).slice(0, 3).forEach(function (r) { note("Intelligence", r.txt); }); }
    if (I.length) SNAP.i = ii;
    var D = window.DATA, st = D && D.meta && D.meta.updated_at; if (st && SNAP.g && st !== SNAP.g) note("Grains & FX", "Desk data refreshed (" + hm(Date.parse(st) || Date.now()) + " ET)."); if (st) SNAP.g = st;
  }
  setInterval(track, 30000); setTimeout(track, 6000);

  /* ---------- 3. the spoken recap ---------- */
  function fmt(v, d) { return v == null || !isFinite(v) ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function say(x, name) {
    if (!x) return "";
    var p = x.pct, d = x.dec != null ? Math.min(x.dec, 4) : 2, lv = fmt(x.last, d);
    if (x.kind === "yield" || /Treasury|BoC|UST/.test(x.sym)) return name + " at " + fmt(x.last, 2) + " percent" + (x.chg != null ? ", " + (x.chg >= 0 ? "up " : "down ") + (function (b) { return b + (b === "1" ? " basis point" : " basis points"); })(Math.abs(x.chg * 100).toFixed(0)) : "");
    return name + " " + (p == null ? "at " + lv : (Math.abs(p) < 0.05 ? "flat at " : (p > 0 ? "up " : "down ") + Math.abs(p).toFixed(2) + " percent at ") + lv) + (/^Z[CSW]=F$/.test(x.sym) ? " cents a bushel" : /^(CL|GC)=F$/.test(x.sym) ? " dollars" : "");
  }

  /* ---------- technicals: price vs 9- and 20-day EMA, and the levels the desk already holds ---------- */
  function emaSeries(c, n) { if (!c || c.length < n + 5) return null; var k = 2 / (n + 1), e = c.slice(0, n).reduce(function (a, b) { return a + b; }, 0) / n; for (var i = n; i < c.length; i++) e += k * (c[i] - e); return e; }
  function roll(e, n, px) { return e == null ? null : e + 2 / (n + 1) * (px - e); }
  function rel(px, e, n, d) { if (e == null || !isFinite(e)) return null; var p = (px / e - 1) * 100; return (Math.abs(p) < 0.05 ? "right at" : px > e ? "above" : "below") + " its " + n + "-day EMA of " + fmt(e, d); }
  function tone(a) { var up = a.filter(function (x) { return /above/.test(x); }).length, dn = a.filter(function (x) { return /below/.test(x); }).length;
    return a.length < 2 ? "" : up === a.length ? " — short-term trend up" : dn === a.length ? " — short-term trend down" : " — mixed, between the two averages"; }
  function technicals(M) {
    var out = [], MON = { F: "January", G: "February", H: "March", J: "April", K: "May", M: "June", N: "July", Q: "August", U: "September", V: "October", X: "November", Z: "December" };
    ["corn", "soybeans", "wheat"].forEach(function (c) {
      try {
        var g = DATA.grains[c], f = g.fan, L = +f.intraday[0], k = (g.roll && g.roll[0] && g.roll[0].contract) || "", T = (g.tail50 || []).map(Number).filter(isFinite);
        if (!isFinite(L)) return;
        var e9 = roll(emaSeries(T, 9), 9, L), e20 = f.ema20 != null ? roll(+f.ema20, 20, L) : roll(emaSeries(T, 20), 20, L);
        var a = [rel(L, e9, 9, 4), rel(L, e20, 20, 4)].filter(Boolean); if (!a.length) return;
        var lv = [];
        if (f.put_wall && f.put_wall[0] != null) lv.push("support at the " + fmt(+f.put_wall[0], 2) + " put wall");
        if (f.call_wall && f.call_wall[0] != null) lv.push("resistance at the " + fmt(+f.call_wall[0], 2) + " call wall");
        if (f.r5 && f.r5.length === 2) lv.push("5-day expected range " + fmt(+f.r5[0], 2) + " to " + fmt(+f.r5[1], 2));
        out.push(((MON[k.charAt(2)] || "") + " " + c).trim() + " at " + String(+L.toFixed(4)) + " is " + a.join(" and ") + tone(a) + "." + (lv.length ? " Levels: " + lv.join("; ") + "." : ""));
      } catch (e) {}
    });
    [["^GSPC", "S&P 500"], ["^NDX", "Nasdaq-100"], ["^DJI", "the Dow"], ["^GSPTSE", "the TSX"], ["CAD=X", "US dollar–Canadian dollar"]].forEach(function (q) {
      var i = M[q[0]]; if (!i || i.last == null || !i.ma || !i.ma.ema) return;
      var E = i.ma.ema, live = i.ma.asof !== i.session_date, d = q[0] === "CAD=X" ? 4 : 0;
      var em = function (n) { var e = E[String(n)]; return e == null ? null : live ? roll(e, n, i.last) : e; };
      var a = [rel(i.last, em(9), 9, d), rel(i.last, em(20), 20, d)].filter(Boolean); if (!a.length) return;
      var lv = [];
      if (i.low != null && i.high != null) lv.push("last session " + fmt(i.low, d) + " to " + fmt(i.high, d));
      if (i.w52 && i.w52.high != null) lv.push("52-week high " + fmt(i.w52.high, d) + ", " + fmt(i.w52.pct_from_high, 1) + " percent above");
      if (i.w52 && i.w52.low != null) lv.push("52-week low " + fmt(i.w52.low, d));
      out.push(q[1].charAt(0).toUpperCase() + q[1].slice(1) + " at " + fmt(i.last, d) + " is " + a.join(" and ") + tone(a) + "." + (lv.length ? " Levels: " + lv.join("; ") + "." : ""));
    });
    return out.length ? ["Trend check against the 9- and 20-day averages."].concat(out) : [];
  }
  /* ---------- events to watch: the next 7 days, high-impact first, desk housekeeping left out ---------- */
  function when(t, now) { var dd = Math.round((Date.parse(dayKey(t)) - Date.parse(dayKey(now))) / 864e5);
    return (dd === 0 ? "today" : dd === 1 ? "tomorrow" : new Date(t).toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "long" })) + " at " + hm(t); }
  function watch(now) {
    var L = [], seen = {};
    try { for (var d = 0; d < 7; d++) (EVENTS.on(now + d * 864e5) || []).forEach(function (e) { var lb = plain(e.label); if (!(e.t > now) || !lb || /refresh|on the desk|session opens|session closes|sits \(/i.test(lb) || seen[lb]) return; seen[lb] = 1; L.push(e); }); } catch (e) {}
    var hi = L.filter(function (e) { return e.high; }).sort(function (a, b) { return a.t - b.t; }), lo = L.filter(function (e) { return !e.high; }).sort(function (a, b) { return a.t - b.t; });
    return hi.slice(0, 8).concat(lo.slice(0, Math.max(0, 10 - Math.min(hi.length, 8)))).sort(function (a, b) { return a.t - b.t; });
  }
  function script() {
    var S = [], now = Date.now(), M = worldMap();
    S.push("AGRI Trade desk recap, " + new Date(now).toLocaleString("en-US", { timeZone: "America/Toronto", weekday: "long", hour: "numeric", minute: "2-digit" }) + " Toronto time.");
    var grp = [["Grains", ["ZC=F", "ZS=F", "ZW=F"]], ["Currency", ["CAD=X", "DX-Y.NYB"]], ["Stocks", ["^GSPC", "^NDX", "^DJI", "^GSPTSE"]], ["Energy and metals", ["CL=F", "GC=F"]], ["Rates", ["US Treasury 10Y"]]];
    var names = {}, anyPx = false; KEY.forEach(function (k) { names[k[0]] = k[1]; });
        /* grains: the desk's own front-month quote (same as the Grains tiles); World Markets' continuous future only as fallback */
    var MON = { F: "January", G: "February", H: "March", J: "April", K: "May", M: "June", N: "July", Q: "August", U: "September", V: "October", X: "November", Z: "December" };
    var gq = [["corn", "ZC=F"], ["soybeans", "ZS=F"], ["wheat", "ZW=F"]].map(function (c) {
      try { var g = DATA.grains[c[0]], f = g.fan, L = +f.intraday[0], A = +f.anchor, k = (g.roll && g.roll[0] && g.roll[0].contract) || ""; if (!isFinite(L)) return say(M[c[1]], names[c[1]]);   /* same numbers as the Grains tile */
        var pc = A ? (L / A - 1) * 100 : null, mo = MON[k.charAt(2)] || "";
        return (mo ? mo + " " : "") + c[0] + " " + (pc == null ? "at " : Math.abs(pc) < 0.005 ? "unchanged at " : (pc > 0 ? "up " : "down ") + Math.abs(pc).toFixed(2) + " percent at ") + String(+L.toFixed(4)) + " dollars a bushel";
      } catch (e) { return say(M[c[1]], names[c[1]]); } }).filter(Boolean);
    if (gq.length) { anyPx = true; S.push("Grains: " + gq.join("; ") + "."); }
    grp.shift();
    grp.forEach(function (g) { var p = g[1].map(function (s) { return say(M[s], names[s]); }).filter(Boolean); if (p.length) { anyPx = true; S.push(g[0] + ": " + p.join("; ") + "."); } });
    var ts = Object.keys(M).map(function (k) { return Date.parse(M[k].ts || 0) || 0; }).sort().pop();
    if (anyPx && ts) S.push("Prices as of " + hm(ts) + " Eastern" + (now - ts > 6 * 3600e3 ? ", the last close" : "") + ".");
    S = S.concat(technicals(M));
    var F = feed().filter(function (m) { return m && m.t && dayKey(m.t) === dayKey(now) && m.t <= now + 60000; }).sort(function (a, b) { return b.t - a.t; });
    var brk = F.filter(isBreaking).map(function (m) { return info(m).txt; }).filter(Boolean);
    var rest = F.filter(function (m) { return !isBreaking(m) && /release|policy|alert|level|world/.test(m.k || ""); }).map(function (m) { return info(m).txt; }).filter(Boolean);
    if (brk.length) S.push("Breaking today: " + brk.slice(0, 5).join(". ") + ".");
    if (rest.length) S.push("Also on the desk today: " + rest.slice(0, 5).join(". ") + ".");
    if (!brk.length && !rest.length) S.push("No breaking releases or alerts on the desk so far today.");
    var I = intel(24).slice(0, 5);
    if (I.length) S.push("Agri and market news in the last 24 hours: " + I.map(function (r) { return r.txt + (r.src ? ", from " + r.src : "") + (r.why ? ". Why it matters: " + r.why : ""); }).join(". ") + ".");
    var last = ls("desk.recap.heard", 0), ch = LOG.filter(function (x) { return x.t > last; });
    if (ch.length) { var by = {}; ch.forEach(function (x) { (by[x.s] = by[x.s] || []).push(x.n); }); S.push("What changed in the app since your last recap: " + Object.keys(by).map(function (k) { return k + ": " + by[k].slice(-3).join(" "); }).join(". ") + "."); }
    var ew = watch(now);
    if (ew.length) S.push("Events to watch: " + ew.map(function (e) { return plain(e.label) + ", " + when(e.t, now) + (e.high ? ", high impact" : ""); }).join("; ") + ".");
    S.push("End of recap.");
    return S.map(function (s) { return s.replace(/\$/g, " dollars ").replace(/&/g, " and ").replace(/\s+/g, " ").replace(/\.\./g, ".").trim(); });
  }

  /* ---------- player ---------- */
  var SY = window.speechSynthesis, Q = [], qi = 0, playing = false, rate = ls(RATEK, 1);
  function voice() { var v = (SY && SY.getVoices()) || []; return v.filter(function (x) { return /^en(-|_)(US|CA|GB)/i.test(x.lang) && /Natural|Google|Samantha|Daniel|Aria|Jenny/i.test(x.name); })[0] || v.filter(function (x) { return /^en/i.test(x.lang); })[0] || null; }
  function chunks(L) { var out = []; L.forEach(function (s) { while (s.length > 220) { var c = s.lastIndexOf(". ", 220); if (c < 60) c = s.lastIndexOf(", ", 220); if (c < 60) c = 220; out.push(s.slice(0, c + 1)); s = s.slice(c + 1).trim(); } if (s) out.push(s); }); return out; }
  function next() {
    if (!playing) return;
    if (qi >= Q.length) { stop(true); return; }
    var u = new SpeechSynthesisUtterance(Q[qi]); u.rate = rate; var v = voice(); if (v) u.voice = v;
    u.onend = function () { qi++; hl(); next(); }; u.onerror = function () { qi++; next(); };
    SY.speak(u); hl();
  }
  function play() {
    if (!SY) { panel(true); var p = doc.getElementById("rc-msg"); if (p) p.textContent = "This browser has no speech engine — the recap is shown as text below."; return; }
    SY.cancel(); var L = script(); Q = chunks(L); qi = 0; playing = true; panel(true); paintText(); next();
    lsSet("desk.recap.heard", Date.now()); btn();
  }
  function stop(done) { playing = false; if (SY) SY.cancel(); btn(); hl(); if (done) { var m = doc.getElementById("rc-msg"); if (m) m.textContent = "Recap finished."; } }
  function btn() { var b = doc.getElementById("rc-btn"); if (b) { b.innerHTML = playing ? "■ Stop recap" : "🔊 Recap"; b.setAttribute("aria-pressed", playing ? "true" : "false"); } var pp = doc.getElementById("rc-pp"); if (pp) pp.textContent = playing && SY && SY.paused ? "Resume" : "Pause"; }
  function hl() { var t = doc.querySelectorAll("#rc-text p"); t.forEach(function (p, i) { p.classList.toggle("on", playing && i === qi); }); var on = doc.querySelector("#rc-text p.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" }); }
  function paintText() { var t = doc.getElementById("rc-text"); if (t) t.innerHTML = Q.map(function (s) { return "<p>" + esc(s) + "</p>"; }).join(""); }
  function paintLog() {
    var el = doc.getElementById("rc-log"); if (!el) return;
    var L = LOG.slice(-12).reverse();
    el.innerHTML = L.length ? L.map(function (x) { return '<li><span>' + hm(x.t) + "</span><b>" + esc(x.s) + "</b> " + esc(x.n) + "</li>"; }).join("") : '<li class="na">No section updates logged yet — notes appear here as each section refreshes.</li>';
  }
  function panel(show) {
    var p = doc.getElementById("rc-panel");
    if (!p) {
      p = doc.createElement("div"); p.id = "rc-panel"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Audio recap");
      p.innerHTML = '<div class="rc-h"><b>Audio recap</b><span id="rc-msg"></span><button type="button" class="rc-x" data-rc-close aria-label="Close">✕</button></div>' +
        '<div class="rc-c"><button type="button" class="rc-b" data-rc-play>▶ Play from start</button><button type="button" class="rc-b" id="rc-pp" data-rc-pause>Pause</button><button type="button" class="rc-b" data-rc-stop>■ Stop</button>' +
        '<span class="rc-gap"></span>' + [0.85, 1, 1.2].map(function (r) { return '<button type="button" class="rc-b rc-r" data-rc-rate="' + r + '" aria-pressed="' + (rate === r) + '">' + r + "×</button>"; }).join("") + "</div>" +
        '<div id="rc-text" class="rc-text"></div><div class="rc-lh">Section updates</div><ul id="rc-log" class="rc-log"></ul>';
      doc.body.appendChild(p);
    }
    p.hidden = !show; if (show) { paintLog(); var m = doc.getElementById("rc-msg"); if (m) m.textContent = playing ? "Playing…" : ""; }
  }
  doc.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#rc-btn,[data-rc-play],[data-rc-pause],[data-rc-stop],[data-rc-close],[data-rc-rate]"); if (!t) return;
    if (t.id === "rc-btn") { if (playing) stop(); else play(); return; }
    if (t.hasAttribute("data-rc-play")) return play();
    if (t.hasAttribute("data-rc-stop")) return stop();
    if (t.hasAttribute("data-rc-close")) { stop(); panel(false); return; }
    if (t.hasAttribute("data-rc-pause")) { if (!SY || !playing) return; if (SY.paused) SY.resume(); else SY.pause(); btn(); return; }
    if (t.hasAttribute("data-rc-rate")) { rate = +t.getAttribute("data-rc-rate"); lsSet(RATEK, rate); doc.querySelectorAll("[data-rc-rate]").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-rc-rate") === rate)); }); if (playing) { SY.cancel(); next(); } }
  });

  function mount() {
    var g = doc.getElementById("gnav"); if (!g) return false;
    if (!doc.getElementById("rc-btn")) { var b = doc.createElement("button"); b.type = "button"; b.id = "rc-btn"; b.className = "rc-btn"; b.title = "Listen to a spoken recap: live prices, today's releases and alerts, agri news, what changed in the app, and what's next"; b.innerHTML = "🔊 Recap"; var po = g.querySelector(".po-view"); g.insertBefore(b, po || null); }
    return true;
  }
  function css() {
    var s = doc.createElement("style"); s.id = "recap-css";
    s.textContent = "#brk-banner:empty{display:none}#brk-banner{max-width:1920px;margin:6px auto 0}" +
      ".brk{display:flex;flex-wrap:nowrap;align-items:center;gap:12px;height:38px;box-sizing:border-box;overflow:hidden;padding:0 12px;border-radius:8px;background:#B91C1C;color:#fff;font-size:13.5px;line-height:1.45;box-shadow:0 0 0 1px #ef4444 inset}" +
      "@keyframes brkIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}" +
      ".brk-tag{font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;background:#fff;color:#B91C1C;padding:2px 8px;border-radius:4px;animation:brkP 1.6s ease-in-out infinite}@keyframes brkP{50%{opacity:.55}}" +
      ".brk,.brk *{font-size:13.5px!important}.brk .brk-tag,.brk .brk-src{font-size:11.5px!important}.brk-t,.brk-t *{color:#fff!important}.brk-src{font:12px 'IBM Plex Mono',monospace;opacity:.9;white-space:nowrap}.brk-t{flex:1 1 auto;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".brk-a{color:#fff;font-weight:600;white-space:nowrap;text-decoration:underline}.brk-n,.brk-x{appearance:none;background:transparent;border:1px solid rgba(255,255,255,.55);color:#fff;border-radius:6px;font:600 12px inherit;padding:2px 8px;cursor:pointer}.brk-x{border:0;font-size:15px}" +
      "#gnav .rc-btn{margin-left:auto;align-self:center;appearance:none;background:transparent;border:1px solid #d9b46a;color:#d9b46a;border-radius:999px;padding:4px 12px;font:600 12.5px 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer;white-space:nowrap}" +
      "#gnav .rc-btn:hover,#gnav .rc-btn[aria-pressed=true]{background:rgba(217,180,106,.14)}#gnav .rc-btn~.po-view{margin-left:6px}" +
      "#rc-panel{position:fixed;right:16px;top:120px;z-index:9000;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 150px);display:flex;flex-direction:column;background:var(--panel,#0b1016);color:var(--ink,#e8edf3);border:1px solid #d9b46a;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:13px}" +
      "#rc-panel[hidden]{display:none}.rc-h{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line,#2a3442)}.rc-h b{color:#d9b46a}#rc-msg{flex:1;color:var(--muted,#8a97a8);font-size:12px}" +
      ".rc-x{appearance:none;background:transparent;border:0;color:inherit;font-size:16px;cursor:pointer}.rc-c{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px}.rc-gap{flex:1}" +
      ".rc-b{appearance:none;background:transparent;border:1px solid var(--line,#2a3442);color:inherit;border-radius:999px;padding:3px 10px;font:600 12px inherit;cursor:pointer}.rc-b:hover,.rc-r[aria-pressed=true]{border-color:#d9b46a;color:#d9b46a}" +
      ".rc-text{overflow:auto;padding:4px 12px 8px;flex:1 1 auto;min-height:60px}.rc-text p{margin:0 0 6px;padding:4px 6px;border-radius:6px;color:var(--muted,#8a97a8)}.rc-text p.on{background:rgba(217,180,106,.12);color:var(--ink,#e8edf3)}" +
      ".rc-lh{padding:6px 12px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted,#8a97a8);border-top:1px solid var(--line,#2a3442)}" +
      ".rc-log{list-style:none;margin:0;padding:0 12px 10px;max-height:160px;overflow:auto}.rc-log li{padding:3px 0;border-bottom:1px dashed var(--line,#2a3442)}.rc-log li span{font:11px 'IBM Plex Mono',monospace;color:var(--muted,#8a97a8);margin-right:6px}.rc-log li b{margin-right:4px}" +
      "html.po-win #rc-btn,html.po-win #brk-banner{display:none!important}";
    doc.head.appendChild(s);
  }
  css();
  var tries = 0; (function wait() { if (mount() || ++tries > 40) { banner(); return; } setTimeout(wait, 250); })();
  if (SY && SY.onvoiceschanged !== undefined) SY.onvoiceschanged = function () {};
  window.RECAP = { script: script, play: play, stop: stop, banner: banner, _log: function () { return LOG; }, _note: note };
})();
