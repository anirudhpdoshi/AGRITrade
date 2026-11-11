/* usm-nav.js — US Markets as its own top-level group: Market Overview · Stock Search · Company Analysis · Earnings Calendar.
   Adds a prominent ticker / company search to the US Markets command bar (autocomplete with exchange, recent searches,
   saved companies). Works on top of the existing tracker (tracker-ui.js) and company workspace (earnings-ui.js +
   company-ui.js): every existing id, handler, API call and saved selection is kept. Market-wide data never changes when a
   company is selected. Searching uses the same live search as before; nothing is stored except this browser's
   recent / saved lists. */
(function (root) {
  "use strict";
  var doc = root.document, RK = "desk.usmRecent", SK = "desk.usmWatch", MK = "desk.usmMode";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function getL(k) { try { var a = JSON.parse(localStorage.getItem(k) || "null"); return Array.isArray(a) ? a : null; } catch (e) { return null; } }
  function setL(k, a) { try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {} }
  var MODES = [["overview", "Market Overview"], ["search", "Stock Search"], ["company", "Company Analysis"], ["calendar", "Earnings Calendar"]];
  var mode = "overview"; try { mode = localStorage.getItem(MK) || "overview"; } catch (e) {}
  if (!MODES.some(function (m) { return m[0] === mode; })) mode = "overview";
  var Q = { q: "", hits: [], seq: 0, busy: false, err: "", i: -1, open: false, t: 0 }, NAMES = {};

  function ready() { return root.USM && root.EARNINGS && doc.getElementById("usm"); }
  function U() { return doc.getElementById("usm"); }
  function view() { return root.EARNINGS && EARNINGS._view ? EARNINGS._view() : {}; }
  function locked() { var v = view(); return v.lock && v.sel ? v.sel : null; }
  function recent() { return getL(RK) || []; }
  function saved() { var a = getL(SK); if (a) return a; var J = root.EARNINGS && EARNINGS._data && EARNINGS._data(); return (J && J.watchlist || []).slice(); }
  function lockedE(s) { return !!(root.ELOCK && ELOCK.state().syms.indexOf(s) >= 0); }
  function remember(h) { var r = recent().filter(function (x) { return x.s !== h.s; }); r.unshift({ s: h.s, n: h.n || "", x: h.x || "" }); setL(RK, r.slice(0, 8)); }
  function toggleSave(s) { var a = saved(), i = a.indexOf(s); if (i >= 0) a.splice(i, 1); else a.push(s); setL(SK, a); try { if (root.USM) USM.go(USM_cat()); } catch (e) {} paint(); }
  function USM_cat() { try { return localStorage.getItem("desk.usmCat") || "c1"; } catch (e) { return "c1"; } }
  function nameOf(s) { if (NAMES[s]) return NAMES[s]; var r = recent().filter(function (x) { return x.s === s; })[0]; if (r && r.n) return r.n;
    var J = root.EARNINGS && EARNINGS._data && EARNINGS._data(), c = J && J.companies && J.companies[s], sp = J && J.sp500 && J.sp500.rows;
    return (c && c.profile && c.profile.companyName) || (sp && sp[s]) || ""; }

  /* ---------- search: debounced, and a reply for an older query is dropped (stale-response protection) ---------- */
  function search(q) {
    Q.q = q; Q.err = ""; Q.i = -1; clearTimeout(Q.t);
    if (!q) { Q.hits = []; Q.busy = false; paintDD(); return; }
    var my = ++Q.seq; Q.busy = true; paintDD();
    Q.t = setTimeout(function () {
      var p = root.COMPANY && COMPANY.configured() ? COMPANY.search(q) : Promise.resolve(localHits(q));
      p.then(function (r) { if (my !== Q.seq) return; Q.busy = false;
        Q.hits = (r || []).map(function (h) { return { s: h.ticker || h.s, n: h.name || h.n || "", x: h.exchange || h.x || "" }; }).filter(function (h) { return h.s; }).slice(0, 10);
        Q.hits.forEach(function (h) { if (h.n) NAMES[h.s] = h.n; }); paintDD(); })
       .catch(function (e) { if (my !== Q.seq) return; Q.busy = false; Q.hits = []; Q.err = "Search unavailable — " + (e && e.message || e); paintDD(); });
    }, 200);
  }
  function localHits(q) { var k = q.toLowerCase(), J = root.EARNINGS && EARNINGS._data && EARNINGS._data(), sp = (J && J.sp500 && J.sp500.rows) || {};
    return Object.keys(sp).filter(function (s) { return s.toLowerCase().indexOf(k) === 0 || String(sp[s]).toLowerCase().indexOf(k) >= 0; }).slice(0, 10).map(function (s) { return { ticker: s, name: sp[s], exchange: "" }; }); }

  function open(h) {
    if (!h || !h.s) return; remember(h); if (h.n) NAMES[h.s] = h.n;
    Q.q = ""; Q.hits = []; Q.open = false; var inp = doc.getElementById("usmX"); if (inp) { inp.value = ""; inp.blur(); }
    paintDD();
    if (locked() !== h.s) { if (EARNINGS.switchTo) EARNINGS.switchTo(h.s, h.n, h.x); else EARNINGS.lockTo(h.s); }
    setMode("company");
  }

  /* ---------- modes ---------- */
  function setMode(m, quiet) {
    mode = m; try { localStorage.setItem(MK, m); } catch (e) {}
    var u = U(); if (!u) return; u.setAttribute("data-mode", m);
    if (!quiet) {
      if (m === "overview") { if (USM_cat() === "c6") USM.go("c1"); }
      else if (m === "company") { USM.go("c6"); var sb = doc.querySelector('#usmSub [data-usmsub="intel"]'); if (sb && sb.getAttribute("aria-pressed") !== "true") sb.click(); if (locked()) EARNINGS.lockTo(locked()); }
      else if (m === "calendar") { if (root.EARNINGS && EARNINGS.poll) EARNINGS.poll(true); }
      else if (m === "search") { setTimeout(function () { var i = doc.getElementById("usmX"); if (i) i.focus(); }, 30); }
    }
    paint(); if (root.GNAV) GNAV.paint();
  }

  /* ---------- painting ---------- */
  function row(h, i, star) {
    var sv = saved().indexOf(h.s) >= 0;
    var on = i >= 0 && i === Q.i;
    return '<div class="ux-r' + (on ? " on" : "") + '" role="option" aria-selected="' + on + '"><button class="ux-pick" data-uxpick="' + esc(h.s) + '" data-uxn="' + esc(h.n) + '" data-uxx="' + esc(h.x) + '">' +
      '<b class="ux-t">' + esc(h.s) + '</b><span class="ux-n">' + esc(h.n || nameOf(h.s) || "") + "</span>" + (h.x ? '<span class="ux-x">' + esc(h.x) + "</span>" : "") + "</button>" +
      (star !== false ? '<button class="ux-star" data-uxsave="' + esc(h.s) + '" aria-pressed="' + sv + '" title="' + (sv ? "Remove from saved companies" : "Save company") + '">' + (sv ? "★" : "☆") + "</button>" : "") +
      (root.ELOCK ? '<button class="ux-lk" data-ellock="' + esc(h.s) + '" data-eln="' + esc(h.n || nameOf(h.s) || "") + '" aria-pressed="' + lockedE(h.s) + '" title="Lock for today\'s earnings (max ' + ELOCK.MAX + ')">' + (lockedE(h.s) ? "🔔" : "🔕") + "</button>" : "") + "</div>";
  }
  function listsHTML() {
    var R = recent(), S = saved();
    return '<div class="ux-lists"><div><div class="ux-h">Recent searches</div>' + (R.length ? R.map(function (h) { return row(h, -1); }).join("") : '<p class="ux-none">Nothing searched yet.</p>') + "</div>" +
      '<div><div class="ux-h">Saved companies <small>(also the watchlist)</small></div>' + (S.length ? S.map(function (s) { return row({ s: s, n: nameOf(s), x: "" }, -1); }).join("") : '<p class="ux-none">Star a company to save it.</p>') + "</div></div>";
  }
  function paintDD() {
    var dd = doc.getElementById("usmXd"); if (!dd) return;
    var h = "";
    if (Q.q) h = Q.busy && !Q.hits.length ? '<div class="ux-msg"><span class="ux-spin"></span>Searching “' + esc(Q.q) + "”…</div>"
      : Q.err ? '<div class="ux-msg ux-err">' + esc(Q.err) + ' <button class="ue-btn" data-uxretry>Retry</button></div>'
      : Q.hits.length ? Q.hits.map(function (x, i) { return row(x, i); }).join("") + (Q.busy ? '<div class="ux-msg"><span class="ux-spin"></span>Updating…</div>' : "")
      : '<div class="ux-msg">No US-listed company matches “' + esc(Q.q) + "”.</div>";
    else if (Q.open && mode !== "search") h = listsHTML();   /* the Stock Search page already lists them */
    dd.innerHTML = h; dd.hidden = !h || (!Q.open && !Q.q);
  }
  function paint() {
    var u = U(); if (!u) return;
    u.setAttribute("data-mode", mode);
    var bar = doc.getElementById("usmXb");
    if (!bar) {
      bar = doc.createElement("div"); bar.id = "usmXb"; bar.className = "ux-bar";
      bar.innerHTML = '<div class="ux-in"><span class="ux-ic" aria-hidden="true">⌕</span><input id="usmX" type="search" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="usmXd" aria-label="Search company or ticker" placeholder="Search company or ticker — e.g. ADM, Deere, Alphabet"><span class="ux-ex">NYSE · NASDAQ</span></div>' +
        '<div id="usmXd" class="ux-dd" role="listbox" hidden></div><div id="usmXc" class="ux-ctx"></div>';
      var a = u.querySelector(".usm-a"); a.appendChild(bar);
      wire(bar);
    }
    var L = locked(), ctx = doc.getElementById("usmXc");
    /* section tabs above the search: skeleton while the company loads, green once each section has data */
    var tb = doc.getElementById("usmXt");
    if (!tb) { tb = doc.createElement("div"); tb.id = "usmXt"; tb.className = "ux-tabs"; bar.insertBefore(tb, bar.firstChild); }
    var th = "";
    if (L && root.COMPANY && COMPANY.status) {
      var st = COMPANY.status(L), cur = view().view === "company";
      th = '<span class="ux-tl">' + esc(L) + (st.state === "loading" ? ' <i class="ux-spin"></i>' : st.state === "err" ? ' <span class="ux-err">load failed</span> <button class="ue-btn" data-coretry="' + esc(L) + '">Retry</button>' : "") + "</span>" +
        st.groups.map(function (g) { var c = g.ready === null ? "sk" : g.ready ? "ok" : "na";
          return '<button type="button" class="ux-tb ' + c + '" data-uxtab="' + esc(g.first) + '"' + (c === "sk" ? ' disabled aria-busy="true"' : c === "na" ? ' title="No figures for this section in the company\'s SEC filings"' : ' title="Open ' + esc(g.label) + '"') + ">" + esc(g.label) + "</button>"; }).join("");
    }
    if (tb.innerHTML !== th) tb.innerHTML = th; tb.hidden = !th;
    if (L) u.setAttribute("data-co", L); else u.removeAttribute("data-co");
    var h = L ? 'Company: <b>' + esc(L) + "</b> " + esc(nameOf(L)) + ' <button class="ue-btn" data-uxmode="company">Open analysis</button> <button class="ux-star" data-uxsave="' + esc(L) + '" aria-pressed="' + (saved().indexOf(L) >= 0) + '">' + (saved().indexOf(L) >= 0 ? "★ Saved" : "☆ Save") + "</button>" +
        (root.ELOCK ? ' <button class="ue-btn ux-elk" data-ellock="' + esc(L) + '" data-eln="' + esc(nameOf(L)) + '" aria-pressed="' + lockedE(L) + '">' + (lockedE(L) ? "🔔 Locked for earnings" : "🔕 Lock for earnings") + "</button>" : "")
      : '<span class="ux-none">' + (mode === "company" ? "Search a company above to open its analysis." : "No company selected — market data is shown for the whole market.") + "</span>";
    if (ctx.innerHTML !== h) ctx.innerHTML = h;
    var kc = doc.getElementById("usmK");
    if (mode === "calendar" && root.USMCAL) { if (!kc) { var w = doc.createElement("div"); w.innerHTML = USMCAL.html(); kc = w.firstChild; kc.classList.add("ux-page"); bar.after(kc); } }
    else if (kc) kc.remove();
    var sp = doc.getElementById("usmXs");
    if (mode === "search") { if (!sp) { sp = doc.createElement("section"); sp.id = "usmXs"; sp.className = "usm-card ux-page"; bar.after(sp); } sp.innerHTML = '<h3>Stock search</h3><p class="ux-none" style="margin:0 0 10px">Type a ticker or company name above. Picking a company opens Company Analysis; index, sector and earnings data stay market-wide.</p>' + listsHTML(); }
    else if (sp) sp.remove();
  }
  function wire(bar) {
    var inp = bar.querySelector("#usmX");
    inp.addEventListener("input", function () { Q.open = true; search(inp.value.trim()); inp.setAttribute("aria-expanded", "true"); });
    inp.addEventListener("focus", function () { Q.open = true; paintDD(); inp.setAttribute("aria-expanded", "true"); });
    inp.addEventListener("keydown", function (ev) {
      var n = Q.hits.length;
      if (ev.key === "ArrowDown" && n) { ev.preventDefault(); Q.i = (Q.i + 1) % n; paintDD(); }
      else if (ev.key === "ArrowUp" && n) { ev.preventDefault(); Q.i = (Q.i - 1 + n) % n; paintDD(); }
      else if (ev.key === "Enter") { ev.preventDefault(); var h = Q.hits[Q.i < 0 ? 0 : Q.i]; if (h) open(h); else if (/^[A-Za-z.\-]{1,6}$/.test(inp.value.trim()) && !Q.busy && !Q.q) open({ s: inp.value.trim().toUpperCase() }); }
      else if (ev.key === "Escape") { Q.open = false; Q.q = ""; inp.value = ""; paintDD(); inp.blur(); }
    });
    doc.addEventListener("click", function (ev) { if (!ev.target.closest("#usmXb") && !ev.target.closest("#usmXs")) { Q.open = false; paintDD(); inp.setAttribute("aria-expanded", "false"); } });
  }
  doc.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-uxpick]"); if (b) { open({ s: b.getAttribute("data-uxpick"), n: b.getAttribute("data-uxn"), x: b.getAttribute("data-uxx") }); return; }
    b = t.closest("[data-uxsave]"); if (b) { ev.stopPropagation(); toggleSave(b.getAttribute("data-uxsave")); paintDD(); return; }
    b = t.closest("[data-uxmode]"); if (b) { setMode(b.getAttribute("data-uxmode")); return; }
    b = t.closest("[data-uxtab]"); if (b && !b.disabled) { setMode("company"); if (root.COMPANY && COMPANY.show) COMPANY.show(b.getAttribute("data-uxtab")); setTimeout(function () { var m = doc.querySelector("#panel-earnings .ut-main"); if (m) m.scrollIntoView({ block: "start", behavior: "smooth" }); }, 80); return; }
    if (t.closest("[data-uxretry]")) { search(Q.q); return; }
    /* anything inside the tracker that opens a company also means Company Analysis */
    if (t.closest("[data-usmopen],[data-utswitch],[data-utlock]")) setTimeout(function () { if (locked()) { mode = "company"; try { localStorage.setItem(MK, mode); } catch (e) {} } paint(); if (root.GNAV) GNAV.paint(); }, 60);
    if (t.closest("[data-usmcat]")) setTimeout(function () { var c = USM_cat(); if (c !== "c6" && mode !== "overview") { mode = "overview"; try { localStorage.setItem(MK, mode); } catch (e) {} paint(); if (root.GNAV) GNAV.paint(); } }, 60);
  });

  /* chips for the top navigation's section row (nav-ui.js asks GNAV_CHIPS for the active page) */
  root.GNAV_CHIPS = root.GNAV_CHIPS || {};
  root.GNAV_CHIPS.earnings = { list: function () { return MODES.map(function (m) { return [m[0], m[1], m[0] === mode]; }); }, go: function (id) { setMode(id); } };

  var css = doc.createElement("style");
  css.textContent =
    ".usm-a{flex-wrap:wrap}.ux-bar{flex:1 1 100%;order:9;box-sizing:border-box;position:relative;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:10px 12px}" +
    ".ux-in{position:relative;flex:1 1 420px;display:flex;align-items:center;background:var(--bg);border:1px solid var(--line2);border-radius:9px;padding:0 10px}.ux-in:focus-within{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(56,182,201,.25)}" +
    ".ux-ic{color:var(--muted);font-size:20px;margin-right:6px}#usmX{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--ink,#fff);font:600 16px 'IBM Plex Sans',sans-serif;padding:11px 0}" +
    ".ux-ex{font:600 11px 'IBM Plex Mono',monospace;color:var(--muted);border:1px solid var(--line2);border-radius:999px;padding:3px 9px;white-space:nowrap}" +
    ".ux-ctx{font-size:13px;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ux-ctx b{color:#fff;font-family:'IBM Plex Mono',monospace}" +
    ".ux-dd{position:absolute;left:12px;right:12px;top:calc(100% - 4px);z-index:70;background:var(--panel);border:1px solid var(--line2);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.45);max-height:420px;overflow:auto;padding:6px}.ux-dd[hidden]{display:none}" +
    ".ux-r{display:flex;align-items:stretch;border-radius:7px}.ux-r.on,.ux-r:hover{background:rgba(56,182,201,.12)}.ux-pick{flex:1;min-width:0;display:flex;gap:10px;align-items:center;background:none;border:0;color:inherit;text-align:left;padding:7px 8px;cursor:pointer;font:inherit}" +
    ".ux-t{font-family:'IBM Plex Mono',monospace;min-width:62px;color:#fff}.ux-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink,#dfe7f2)}.ux-x{font:600 10.5px 'IBM Plex Mono',monospace;color:var(--muted);border:1px solid var(--line2);border-radius:5px;padding:1px 6px}" +
    ".ux-star{background:none;border:0;color:#e8b93d;cursor:pointer;font-size:15px;padding:0 10px}.ux-star[aria-pressed=false]{color:var(--muted)}" +
    ".ux-msg{padding:10px;color:var(--muted);font-size:13px}.ux-err{color:var(--red)}.ux-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line2);border-top-color:var(--cyan);border-radius:50%;margin-right:8px;vertical-align:-2px;animation:uxs .8s linear infinite}@keyframes uxs{to{transform:rotate(360deg)}}" +
    ".ux-lists{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ux-h{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:4px 8px 4px}.ux-h small{text-transform:none;letter-spacing:0;font-weight:500}.ux-none{color:var(--muted);font-size:12.5px;margin:4px 8px}" +
    ".ux-page{flex:1 1 100%;order:10;box-sizing:border-box}" +
    ".ux-tabs{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.ux-tabs[hidden]{display:none}.ux-tl{font:700 13px 'IBM Plex Mono',monospace;color:#fff;margin-right:4px;display:inline-flex;align-items:center;gap:6px}" +
    ".ux-tb{appearance:none;font:600 12.5px 'IBM Plex Sans',sans-serif;border-radius:999px;padding:5px 12px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer}" +
    ".ux-tb.ok{color:#d9f7e8;background:rgba(63,185,127,.18);border-color:rgba(63,185,127,.75)}.ux-tb.ok:hover{background:rgba(63,185,127,.3)}.ux-tb.na{opacity:.45;cursor:default}" +
    ".ux-tb.sk{color:var(--faint);cursor:progress;background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.14) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:coSk 1.3s ease infinite;position:relative}@keyframes coSk{0%{background-position:100% 50%}100%{background-position:0 50%}}" +
    "@media (prefers-reduced-motion:reduce){.ux-tb.sk{animation:none}}" +
    "#usmB [data-usmcat=c4],#usmB [data-usmcat=c6],#usmB [data-usmcat=c9],#usmWlB{display:none!important}#usm[data-mode=company]:not([data-co]) .usm-d{display:none!important}.ux-lk{background:none;border:0;cursor:pointer;font-size:14px;padding:0 8px;opacity:.55}.ux-lk[aria-pressed=true]{opacity:1}.ux-elk[aria-pressed=true]{border-color:#e8b93d;color:#e8b93d}" +
    "#usm[data-mode=company] #usmWlB{display:none!important}#usm[data-mode=search] #usmC,#usm[data-mode=search] #usmB,#usm[data-mode=search] .usm-d,#usm[data-mode=company] #usmC,#usm[data-mode=company] #usmB,#usm[data-mode=calendar] #usmC,#usm[data-mode=calendar] #usmB,#usm[data-mode=calendar] .usm-d{display:none!important}" +
    "@media (max-width:760px){.ux-lists{grid-template-columns:1fr}.ux-ex{display:none}.ux-in{flex-basis:100%}}";
  doc.head.appendChild(css);

  (function boot(n) {
    if (ready()) { paint(); if (mode !== "overview") setMode(mode); if (root.GNAV) GNAV.paint(); root.addEventListener("desk:earnboard", paint); return; }
    if (n > 0) setTimeout(function () { boot(n - 1); }, 400);
  })(60);
  root.addEventListener("desk:company", function () { paint(); });
  doc.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("[data-ellock],[data-elunlock]")) setTimeout(function () { paint(); paintDD(); }, 30); });
  root.USMNAV = { mode: function () { return mode; }, setMode: setMode, open: open, paint: paint, _q: Q };
})(window);
