/* grain-prices.js — Grains "Prices" tab: forward months (futures curve) and delayed option months.
   Every number comes from data.json (settles, delayed quotes, option chains); nothing is filled in. Prices print as $/bu, 4 decimals. */
(function (root) {
  var MC = "FGHJKMNQUVXZ", MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var NAME = { corn: "Corn", soybeans: "Soybeans", wheat: "Wheat" };
  function esc(s) { return DeskCore.esc(s); }
  function p4(v) { return v == null || !isFinite(v) ? "" : (+v).toFixed(4); }
  function mon(c) { var m = /([FGHJKMNQUVXZ])(\d{2})$/.exec(c || ""); return m ? MN[MC.indexOf(m[1])] + "-" + m[2] : c; }
  function day(iso) { if (!iso) return ""; var p = String(iso).slice(0, 10).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  function sg(v, d, u) { var s = v > 0 ? "+" : v < 0 ? "−" : ""; return s + Math.abs(v).toFixed(d) + u; }
  function dir(v) { return v > 0 ? "up" : v < 0 ? "dn" : "fl"; }
  /* change cell, tinted by size of the move (the matrix heat) */
  function chgCell(px, ref) {
    if (px == null || ref == null || !ref) return '<td class="gp-c">—</td>';
    var c = (px - ref) * 100, p = (px / ref - 1) * 100, a = Math.min(1, Math.abs(p) / 2);
    var bg = c ? "background:color-mix(in srgb," + (c > 0 ? "var(--green)" : "var(--red)") + " " + Math.round(6 + a * 22) + "%,transparent)" : "";
    return '<td class="gp-c ' + dir(c) + '" style="' + bg + '"><b>' + sg(c, 3, "¢") + "</b><small>" + sg(p, 3, "%") + "</small></td>";
  }
  function quoteFor(g, c, sdate, settle) {
    var q = g.quotes && g.quotes[c]; if (!q || q.px == null || !q.ts) return null;
    var qd = new Date(q.ts).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    return (qd > (sdate || "") || (qd === sdate && Math.abs(q.px - settle) > 1e-9)) ? q : null;
  }
  function legs(g) {
    var src = g.curve && g.curve.length ? g.curve : (g.roll || []);
    return src.filter(function (r) { return r && r.contract && r.settle != null; });
  }
  var VIEW = "table"; try { VIEW = localStorage.getItem("desk.gpview") === "tiles" ? "tiles" : "table"; } catch (e) {}
  function sw() { return '<span class="gp-sw"><button type="button" data-gpview="table" aria-pressed="' + (VIEW === "table") + '">Table</button><button type="button" data-gpview="tiles" aria-pressed="' + (VIEW === "tiles") + '">Tiles</button></span>'; }
  function chip(q) { return q ? '<span class="gp-st dl" title="Yahoo CBOT quote, about 10 minutes behind">DELAYED</span>' : '<span class="gp-st se" title="Official settlement">SETTLE</span>'; }
  function chgTxt(px, ref) { if (px == null || ref == null || !ref) return '<span class="neu">—</span>'; var c = (px - ref) * 100, p = (px / ref - 1) * 100; return '<span class="' + dir(c) + '">' + sg(c, 2, "¢") + " · " + sg(p, 2, "%") + "</span>"; }
  function curveHTML(k) {
    var g = root.DATA && DATA.grains && DATA.grains[k]; if (!g) return "";
    var L = legs(g); if (!L.length) return "";
    var front = null, tiles = [], rows = L.map(function (r, i) {
      var q = quoteFor(g, r.contract, r.settle_date, r.settle), px = q ? q.px : r.settle, ref = q ? r.settle : r.prev;
      if (i === 0) front = px;
      var sp = i && front != null ? (px - front) * 100 : null;
      tiles.push('<div class="gp-tl' + (i === 0 ? " front" : "") + '"><div class="gp-ch"><b>' + mon(r.contract) + "</b>" + chip(q) + "<span>" + esc(r.contract) + (i === 0 ? " · front" : "") + '</span></div><div class="gp-cv">' + p4(px) + '</div><div class="gp-cc">' + chgTxt(px, ref) + '</div><div class="gp-cf"><span>' + (q ? "delayed " + esc(q.label || "") : "settle " + day(r.settle_date)) + "</span><span>" + (sp == null ? "" : "vs front " + sg(sp, 2, "¢")) + "</span></div></div>");
      return "<tr" + (i === 0 ? ' class="gp-front"' : "") + '><td class="gp-m"><b>' + mon(r.contract) + "</b><small>" + (i === 0 ? "Front month" : "Forward month") + "</small></td>" +
        '<td class="gp-k">' + esc(r.contract) + "</td>" +
        '<td class="gp-px"><b>' + p4(px) + "</b><small>" + chip(q) + " " + (q ? esc(q.label || "") : day(r.settle_date)) + "</small></td>" +
        chgCell(px, ref) +
        '<td class="gp-n">' + p4(r.settle) + "<small>" + day(r.settle_date) + "</small></td>" +
        '<td class="gp-n">' + (r.prev != null ? p4(r.prev) : "—") + "</td>" +
        '<td class="gp-n ' + (sp == null ? "" : dir(sp)) + '">' + (sp == null ? "—" : sg(sp, 2, "¢")) + "</td></tr>";
    }).join("");
    var qn = L.filter(function (r) { return quoteFor(g, r.contract, r.settle_date, r.settle); }).length;
    return '<div class="tile wide gp-tile" data-src="grains_settle" data-src2="grains_quote"><h2>Futures <span class="h2note">— ' + NAME[k] + " · all active months on file (" + L.length + ") · $/bu</span></h2>" + sw() +
      (VIEW === "tiles" ? '<div class="gp-cg">' + tiles.join("") + "</div>" :
      '<div class="tbl-scroll"><table class="gp-tbl"><thead><tr><th>Month</th><th>Contract</th><th>Price</th><th>Change</th><th>Settle</th><th>Prior settle</th><th>Spread vs front</th></tr></thead><tbody>' + rows + "</tbody></table></div>") +
      '<div class="stamp">Price = Yahoo delayed CBOT quote (about 10 min) where one is on file (' + qn + " of " + L.length + " months), otherwise the latest settlement · change vs the prior settlement · spread = month minus front, in cents</div></div>";
  }
  function optionsHTML(k) {
    var O = root.DATA && DATA.optflow && DATA.optflow[k], g = DATA.grains && DATA.grains[k]; if (!O || !O.chains || !O.chains.length || !g) return "";
    /* the desk's IBKR chains first, then CME final-bulletin months to make five option months (weeklies extra) */
    var CH = O.chains.slice(), have = {}, CM = (g.cme_months && g.cme_months.rows) || [];
    CH.forEach(function (c) { if (!/weekly/i.test(c.chain || "")) have[c.chain] = 1; });
    CM.forEach(function (c) { if (!have[c.chain] && Object.keys(have).length < 5) { have[c.chain] = 1; CH.push(Object.assign({ cme: true }, c)); } });
    var tiles = [], rows = CH.map(function (c) {
      var r = (g.curve || g.roll || []).filter(function (x) { return x.contract === c.contract; })[0] || {};
      var q = quoteFor(g, c.contract, r.settle_date, r.settle), px = q ? q.px : r.settle, ref = q ? r.settle : r.prev;
      var td = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }), dte = c.expires ? Math.max(0, Math.round((Date.parse(c.expires + "T12:00:00Z") - Date.parse(td + "T12:00:00Z")) / 864e5)) : null;
      var wk = /weekly/i.test(c.chain || "");
      tiles.push('<div class="gp-tl"><div class="gp-ch"><b>' + esc(wk ? c.chain.replace(/^Weekly\s*/i, "Wkly ") : c.chain) + "</b>" + chip(q) + "<span>" + esc(c.contract) + (c.cme ? " · CME final" : wk ? " · weekly" : "") + '</span></div><div class="gp-cv">' + (px != null ? p4(px) : "—") + ' <small>underlying</small></div><div class="gp-cc">' + chgTxt(px, ref) + "</div>" +
        '<div class="gp-ck"><span>Expires</span><b>' + day(c.expires) + (dte == null ? "" : dte === 0 ? " · today" : " · " + dte + "d") + "</b><span>ATM IV</span><b>" + (c.atm_iv != null ? (+c.atm_iv).toFixed(2) + "%" : "—") + "</b><span>Range</span><b>" + (c.lo != null && c.hi != null ? p4(c.lo) + "–" + p4(c.hi) : "—") + "</b><span>Put/call OI</span><b>" + (c.pcr != null ? (+c.pcr).toFixed(2) : "—") + "</b></div></div>");
      return "<tr><td class=\"gp-m\"><b>" + esc(wk ? c.chain.replace(/^Weekly\s*/i, "Wkly ") : c.chain) + "</b><small>" + (wk ? "Weekly options" : c.cme ? "CME final · IV computed" : "Delayed option month") + "</small></td>" +
        '<td class="gp-k">' + esc(c.contract) + "</td>" +
        '<td class="gp-px"><b>' + (px != null ? p4(px) : "—") + "</b><small>" + chip(q) + " underlying</small></td>" +
        chgCell(px, ref) +
        '<td class="gp-n">' + day(c.expires) + "<small>" + (dte == null ? "" : dte === 0 ? "expires today" : dte + "d") + "</small></td>" +
        '<td class="gp-n">' + (c.atm_iv != null ? (+c.atm_iv).toFixed(2) + "%" : "—") + "</td>" +
        '<td class="gp-n">' + (c.lo != null && c.hi != null ? p4(c.lo) + " – " + p4(c.hi) : "—") + "</td>" +
        '<td class="gp-n">' + (c.pcr != null ? (+c.pcr).toFixed(2) : "—") + "</td></tr>";
    }).join("");
    return '<div class="tile wide gp-tile" data-src="options"><h2>Options <span class="h2note">— ' + NAME[k] + " options by expiry · underlying in $/bu</span></h2>" + sw() +
      (VIEW === "tiles" ? '<div class="gp-cg">' + tiles.join("") + "</div>" :
      '<div class="tbl-scroll"><table class="gp-tbl"><thead><tr><th>Option month</th><th>Underlying</th><th>Price</th><th>Change</th><th>Expires</th><th>ATM IV</th><th>Expected range</th><th>Put/call OI</th></tr></thead><tbody>' + rows + "</tbody></table></div>") +
      '<div class="stamp">' + (CM.length ? "Months marked “CME final” come from CME Daily Bulletin #" + esc(g.cme_months.bulletin || "") + " (" + day(g.cme_months.date) + " close): open interest is CME’s final count and ATM IV is computed (Black-76) from CME’s at-the-money settlements · " : "") + 'Option chains as of ' + esc(new Date(O.asof).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET · expected range = market-implied move to expiry, not a forecast · put/call = open-interest ratio</div></div>";
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-gpview]"); if (!b) return;
    VIEW = b.getAttribute("data-gpview"); try { localStorage.setItem("desk.gpview", VIEW); } catch (e) {}
    var a = document.querySelector(".tab-panel.active"), k = a && a.id.replace("panel-", ""); if (["corn", "soybeans", "wheat"].indexOf(k) < 0) return;
    try { renderGrain(k); } catch (e) {}
  });
  var css = document.createElement("style");
  css.textContent = ".gp-sw{display:inline-flex;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;margin:0 0 10px}.gp-sw button{all:unset;cursor:pointer;padding:3px 12px;font:500 12px 'Libre Franklin',system-ui,sans-serif;color:#8a8a8a}.gp-sw button[aria-pressed=true]{color:#d9b46a;background:rgba(217,180,106,.1)}.gp-sw button+button{border-left:1px solid #2a2a2a}" +
    ".gp-st{display:inline-block;font:700 9px 'JetBrains Mono','IBM Plex Mono',monospace;letter-spacing:.06em;border:1px solid;border-radius:3px;padding:0 4px;margin-right:4px;vertical-align:1px}.gp-st.dl{color:#e8b93d;border-color:#e8b93d66}.gp-st.se{color:#8f9db3;border-color:#8f9db366}.gp-st.lv{color:#3fb97f;border-color:#3fb97f66}.gp-st.cz{color:#e0655f;border-color:#e0655f66}" +
    ".gp-cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}.gp-tl{border:1px solid #1f1f1f;border-radius:6px;padding:10px 12px;background:#000;display:flex;flex-direction:column;gap:4px;min-width:0}.gp-tl.front{border-color:#d9b46a88}" +
    ".gp-ch{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.gp-ch b{color:#fff;font-size:14px}.gp-ch span{font:11px 'JetBrains Mono','IBM Plex Mono',monospace;color:#8a8a8a}" +
    ".gp-cv{font:500 22px 'JetBrains Mono','IBM Plex Mono',monospace;color:#fff}.gp-cv small{font:11px 'Libre Franklin',system-ui,sans-serif;color:#777}.gp-cc{font:12px 'JetBrains Mono','IBM Plex Mono',monospace}.gp-cc .up{color:var(--green)}.gp-cc .dn{color:var(--red)}" +
    ".gp-cf{display:flex;justify-content:space-between;gap:6px;font-size:10.5px;color:#777}.gp-ck{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;margin-top:4px}.gp-ck span{color:#777}.gp-ck b{font:500 11.5px 'JetBrains Mono','IBM Plex Mono',monospace;color:#c9d4e2;text-align:right}";
  document.head.appendChild(css);
  root.GPRICES = { html: function (k) { var h = curveHTML(k) + optionsHTML(k); return h || '<div class="tile wide"><p class="note">No forward-month prices on file yet.</p></div>'; } };
  /* if a grain page was drawn before this file loaded, redraw it so the Prices tab fills */
  if (root.renderGrain && root.DATA && DATA.grains) ["corn", "soybeans", "wheat"].forEach(function (k) { var P = document.getElementById("panel-" + k); if (P && P.innerHTML && P.querySelector('[data-subpanel="prices"] .note')) try { renderGrain(k); if (root.buildSecNav) buildSecNav(k); } catch (e) {} });
})(window);
