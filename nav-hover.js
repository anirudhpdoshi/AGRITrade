/* nav-hover.js — menu map for the side panel; the hover card is switched off (owner, Nov 23 2026).
   Was: hover a top-menu item to see what it holds (owner, Nov 21 2026).
   A small card opens under the menu button listing that section's pages and what each one shows; every line is a link.
   Opens after a short pause so a passing mouse does not flash cards; keyboard focus opens it too. */
(function (root) {
  var doc = root.document;
  var M = {
    overview: [["briefing", null, "Briefing", "US · Canada morning read, markets pulse, catalyst calendar, alerts"]],
    grains: [["corn", "overview", "Corn · Soybeans · Wheat", "Price tiles open each grain: overview, futures curve, EMAs, volatility cone"],
      ["corn", "deriv", "Derivatives", "Options & open interest by strike, futures roll day by day, CFTC funds, IV skew"],
      ["corn", "inputs", "Input costs", "Fertilizer, energy and freight behind the crop"],
      ["corn", "fund", "Fundamentals", "WASDE balance sheets, crop progress, exports"],
      ["corn", "prices", "Prices", "Futures curve, settles and spreads"],
      ["fx", "overview", "USD/CAD", "Spot, drivers, expected move & forecast, CFTC CAD positioning"],
      ["fx", "deriv", "USD/CAD derivatives", "CFTC CAD funds, forwards, sentiment & FX options"],
      ["fx", "ysm", "Yield spreads", "US vs Canada yields ON–30Y, SOFR/CORRA basis, curve and history"],
      ["fx", "rates", "Rates, policy & energy", "Fed and BoC pricing, CORRA strip, oil and energy"],
      ["fx", "fwd", "Forward rates", "Forward points and outright forwards"],
      ["fx", "metals", "Mineral exports", "Canada's metal & mineral exports by segment, prices, FX impact"]],
    positioning: [["positioning", null, "Positioning / OI", "Open interest, CFTC funds, options walls and volatility — corn, wheat, soybeans, USD/CAD"]],
    macro: [["macro", "dash", "Dashboard", "US · Canada macro table and surprises"], ["macro", "cpi", "CPI deep dive", "Inflation components, US + Canada"],
      ["macro", "cycle", "Cycle & Fed policy", "Growth, jobs map, policy path"], ["macro", "trade", "Trade & fiscal", ""], ["macro", "rel", "Releases & consensus", ""]],
    world: [["world", null, "Markets & sessions", "Every exchange: map with index and commodity prices, sessions, movers, 52-week alerts"],
      ["usmkt", null, "US Markets", "S&P 500, Nasdaq, Dow, Russell with EMAs; snapshot, indexes, sectors, market cap"],
      ["indices", null, "US Indices · weekly & Nifty", "Weekly levels, wicks, returns, correlation, volatility cones, next-month ranges"]],
    treasury: [["treasury", null, "US Treasury", "Debt, auctions, maturities and refinancing risk, release schedule"]],
    aidebt: [["aidebt", null, "AI Debt", "AI-company borrowing: issuers, instruments, funding mix, warning flags"]],
    events: [["events", null, "Events", "Today's and upcoming releases with countdowns and results"]],
    intel: [["intel", null, "Intelligence", "SWOT brief, official indicators, release calendar, sources & health"]],
    policy: [["policy", null, "Central banks & policy", "Fed, BoC and others: statements, minutes, votes — with read-aloud"]],
    usm: [["earnings", null, "Earnings", "Search any US company: results, statements, management commentary"]],
    breakouts: [["breakouts", null, "Breakouts", "Live day highs/lows, 52-week and moving-average breaks"]],
    health: [["health", null, "Health", "Data feeds, APIs and schedules — what is fresh and what is late"]]
  };
  root.GNAV_MAP = M;   /* shared with shell-nav.js (left section menu) */
  var card = doc.createElement("div"); card.id = "gnav-hc"; card.hidden = true; card.setAttribute("role", "menu"); doc.body.appendChild(card);
  var tOpen = 0, tClose = 0, cur = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function open(b) {
    var g = b.getAttribute("data-gnav"), L = M[g]; if (!L) return;
    cur = b; var r = b.getBoundingClientRect();
    card.innerHTML = '<div class="hc-t">' + esc(b.textContent) + "</div>" + L.map(function (x, i) {
      return '<button type="button" role="menuitem" class="hc-i" data-hc="' + i + '"><b>' + esc(x[2]) + "</b>" + (x[3] ? "<span>" + esc(x[3]) + "</span>" : "") + "</button>"; }).join("");
    card.setAttribute("data-g", g); card.hidden = false;
    var w = card.offsetWidth, x = Math.min(Math.max(8, r.left), root.innerWidth - w - 8);
    card.style.left = x + "px"; card.style.top = (r.bottom + 6 + root.scrollY) + "px";
  }
  function close() { card.hidden = true; cur = null; }
  /* no hover card (owner, Nov 23 2026): a menu's pages and sections are listed only in the side panel, after the menu is
     clicked (shell-nav.js). Hovering or tabbing onto a menu no longer opens a drop-down list. */
  doc.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); });
  doc.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest(".gnav-b")) { close(); return; }
    var i = ev.target.closest && ev.target.closest("#gnav-hc [data-hc]"); if (!i) return;
    var x = M[card.getAttribute("data-g")][+i.getAttribute("data-hc")]; close();
    /* one navigation path (shell-nav.js): waits for the page to render before choosing its section, and a newer click
       cancels an older one — the old fixed 60 / 120 ms timers could fire before a slow page existed or after a later click */
    if (root.DESK_NAV) { DESK_NAV.go(x[0], x[1], card.getAttribute("data-g")); return; }
    var gb = doc.querySelector('.gnav-b[data-gnav="' + card.getAttribute("data-g") + '"]'); if (gb) gb.click();
    setTimeout(function () { var tb = doc.getElementById("tabbtn-" + x[0]); if (tb) tb.click();
      if (x[1]) setTimeout(function () { try { root.setSub(x[0], x[1]); } catch (e) {} }, 120); }, 60);
  });
  var st = doc.createElement("style");
  st.textContent = "#gnav-hc{position:absolute;z-index:9000;min-width:280px;max-width:420px;background:#0b1016;border:1px solid #2a3442;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.55);padding:8px}" +
    "#gnav-hc[hidden]{display:none}#gnav-hc .hc-t{font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#ffb84d;padding:4px 8px 6px}" +
    "#gnav-hc .hc-i{all:unset;display:block;cursor:pointer;padding:7px 8px;border-radius:6px;width:calc(100% - 16px)}#gnav-hc .hc-i:hover,#gnav-hc .hc-i:focus{background:rgba(255,184,77,.10)}" +
    "#gnav-hc .hc-i b{display:block;font-size:13px;color:#e8edf3}#gnav-hc .hc-i span{display:block;font-size:12px;color:#8a97a8;line-height:1.4;margin-top:2px}" +
    "html[data-theme=light] #gnav-hc{background:#fff;border-color:#d0d7e2}html[data-theme=light] #gnav-hc .hc-i b{color:#101825}";
  doc.head.appendChild(st);
  /* the native tooltip would cover the card */
  setTimeout(function () { [].forEach.call(doc.querySelectorAll(".gnav-b[title]"), function (b) { b.removeAttribute("title"); }); }, 1500);
})(window);
