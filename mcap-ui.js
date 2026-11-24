/* mcap-ui.js — World Markets → US Markets → Market cap (owner, Nov 20 2026).
   Total value of the US listed market (S&P 500 constituents) week by week — the $ gained or lost each week — and, for the
   week or the month, the ten companies that added and lost the most market value. Data: mcap.json (scripts/mcap.py). */
(function (root) {
  var doc = root.document, D = null, err = null, at = 0, P = "week";
  try { P = localStorage.getItem("desk.mcap.p") || "week"; } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function bn(v, sign) { if (v == null) return "—"; var a = Math.abs(v), s = sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : (v < 0 ? "−" : "");
    return s + "$" + (a >= 1000 ? (a / 1000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " tn" : a.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " bn"); }
  function pc(v) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%"; }
  function cl(v) { return v > 0 ? "up" : v < 0 ? "dn" : ""; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function md(d) { var p = String(d).split("-"); return MON[+p[1] - 1] + " " + (+p[2]); }
  function load() {
    if (Date.now() - at < 5 * 60000 && (D || err)) return; at = Date.now();
    fetch("mcap.json?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { D = j; err = null; repaint(); }).catch(function (e) { err = e.message; repaint(); });
  }
  function repaint() { var v = doc.getElementById("mcapView"); if (v) v.outerHTML = html(); }
  function bars(W) {
    var w = 860, h = 210, pl = 58, pb = 26, pt = 14, n = W.length, mx = Math.max.apply(null, W.map(function (x) { return Math.abs(x.chg); })) || 1, bw = (w - pl - 8) / n, y0 = pt + (h - pt - pb) / 2, sc = (h - pt - pb) / 2 / mx;
    var s = '<line x1="' + pl + '" x2="' + (w - 4) + '" y1="' + y0 + '" y2="' + y0 + '" class="mc-ax"/>';
    [mx, mx / 2, -mx / 2, -mx].forEach(function (v) { var y = y0 - v * sc; s += '<line x1="' + pl + '" x2="' + (w - 4) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="mc-gr"/><text x="' + (pl - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" class="mc-tk">' + bn(v, true).replace(" bn", "bn").replace(" tn", "tn") + "</text>"; });
    W.forEach(function (x, k) { var X = pl + k * bw + bw * 0.15, bh = Math.max(1, Math.abs(x.chg) * sc), Y = x.chg >= 0 ? y0 - bh : y0;
      s += '<rect class="' + (x.chg >= 0 ? "u" : "d") + '" x="' + X.toFixed(1) + '" y="' + Y.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + bh.toFixed(1) + '"><title>Week of ' + md(x.wk) + " (to " + md(x.end) + "): " + bn(x.chg, true) + " (" + pc(x.pct) + ") · total " + bn(x.cap) + "</title></rect>";
      if (k === n - 1 || (k % 3 === 0 && k < n - 2)) s += '<text x="' + (X + bw * 0.35).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle" class="mc-tk">' + md(x.wk) + "</text>";
      if (k >= n - 2) s += '<text x="' + (X + bw * 0.35).toFixed(1) + '" y="' + (x.chg >= 0 ? Y - 4 : Y + bh + 11).toFixed(1) + '" text-anchor="middle" class="mc-vl ' + (x.chg >= 0 ? "u" : "d") + '">' + bn(x.chg, true).replace(" bn", "bn").replace(" tn", "tn") + "</text>"; });
    return '<svg class="mc-svg" viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Weekly change in total market cap">' + s + "</svg>";
  }
  function list(L, up) {
    return '<table class="usm-tb mc-t no-tx"><thead><tr><th>#</th><th>Company</th><th>Sector</th><th>Market cap</th><th>' + (up ? "Gained" : "Lost") + "</th><th>%</th></tr></thead><tbody>" +
      L.map(function (x, k) { return "<tr><td>" + (k + 1) + "</td><td><b>" + esc(x.co) + "</b><small>" + esc(x.syms.join(" · ")) + "</small></td><td>" + esc(x.sec) + "</td><td>" + bn(x.cap) + '</td><td class="' + cl(x.chg) + '"><b>' + bn(x.chg, true) + '</b></td><td class="' + cl(x.pct) + '">' + pc(x.pct) + "</td></tr>"; }).join("") + "</tbody></table>";
  }
  function secBars(S) {
    var mx = Math.max.apply(null, S.map(function (x) { return Math.abs(x.chg); })) || 1;
    return '<div class="mc-sec">' + S.map(function (x) { var w = Math.abs(x.chg) / mx * 50;
      return '<div class="mc-sr"><span class="mc-sn">' + esc(x.sec) + '</span><span class="mc-sb"><i class="' + (x.chg >= 0 ? "u" : "d") + '" style="' + (x.chg >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></i></span><span class="mc-sv ' + cl(x.chg) + '">' + bn(x.chg, true) + " · " + pc(x.pct) + "</span></div>"; }).join("") + "</div>";
  }
  function html() {
    load();
    if (!D) return '<section id="mcapView" class="usm-card"><h3>US market cap</h3><span class="usm-b na">' + (err ? "Unavailable — " + esc(err) : "Loading…") + "</span></section>";
    var Q = D.periods && D.periods[P]; if (!Q) P = "week", Q = D.periods && D.periods.week;
    var lw = D.weekly[D.weekly.length - 1], M = D.periods.month, Wk = D.periods.week;
    var kp = function (k, v, s, c) { return '<div class="mc-k"><span>' + k + '</span><b class="' + (c || "") + '">' + v + "</b><small>" + s + "</small></div>"; };
    var tg = '<div class="mc-tg" role="tablist">' + [["week", "Week"], ["month", "Month"]].map(function (p) { return '<button type="button" data-mcp="' + p[0] + '" aria-pressed="' + (P === p[0]) + '">' + p[1] + "</button>"; }).join("") + "</div>";
    var up = D.weekly.filter(function (w) { return w.chg > 0; }).length;
    var read = Q ? "Over the " + (P === "week" ? "week" : "month") + " (" + md(Q.from) + " → " + md(Q.to) + ") US listed companies " + (Q.chg >= 0 ? "added <b class=up>" : "lost <b class=dn>") + bn(Math.abs(Q.chg)) + "</b> (" + pc(Q.pct) + "). " +
      Q.up + " of " + Q.companies + " companies rose. The ten biggest losers account for " + bn(Q.losers.reduce(function (a, x) { return a + x.chg; }, 0), true) + "; the ten biggest gainers " + bn(Q.gainers.reduce(function (a, x) { return a + x.chg; }, 0), true) + "." : "";
    return '<section id="mcapView" class="usm-card mc">' +
      '<div class="usm-rowh"><h3>US market cap · listed companies <small>' + esc(D.universe.name) + " · " + D.universe.used + " companies · " + (D.intraday ? '<b class="mc-est">estimate · market open</b> ' + md(D.asof) + ", delayed prices as of " + new Date(D.updated_at).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }) + " ET · refreshed hourly, final after the 4 PM close" : "as of " + md(D.asof) + " close") + "</small></h3>" + tg + "</div>" +
      '<div class="mc-ks">' + kp("Total market cap", bn(D.total), "S&P 500 constituents") + kp("This week", bn(Wk && Wk.chg, true), pc(Wk && Wk.pct) + " · last 5 sessions", cl(Wk && Wk.chg)) +
      kp("This month", bn(M && M.chg, true), pc(M && M.pct) + " · last 21 sessions", cl(M && M.chg)) + kp("Up weeks", up + " of " + D.weekly.length, "weeks with a gain") + "</div>" +
      '<h4 class="mc-h">Weekly gain and loss <small>$ change in total market cap, Mon–Fri weeks; current week to date</small></h4>' + bars(D.weekly) +
      (Q ? '<p class="mc-read">' + read + "</p>" +
        '<div class="mc-two"><div><h4 class="mc-h up">Top 10 gainers · ' + (P === "week" ? "week" : "month") + " <small>by $ market cap added</small></h4>" + list(Q.gainers, true) + "</div>" +
        '<div><h4 class="mc-h dn">Top 10 losers · ' + (P === "week" ? "week" : "month") + " <small>by $ market cap lost</small></h4>" + list(Q.losers, false) + "</div></div>" +
        '<h4 class="mc-h">Sectors · ' + (P === "week" ? "week" : "month") + " <small>$ change in market cap by GICS sector</small></h4>" + secBars(Q.sectors) : "") +
      '<p class="usm-none mc-n">' + esc(D.method) + " Share classes of one company (e.g. Alphabet A and C) are combined. Shares as of " + esc(D.universe.shares_asof || "") + ".</p></section>";
  }
  doc.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-mcp]"); if (!b) return; P = b.getAttribute("data-mcp"); try { localStorage.setItem("desk.mcap.p", P); } catch (e) {} var v = doc.getElementById("mcapView"); if (v) v.outerHTML = html(); });
  var st = doc.createElement("style");
  st.textContent = ".mc-est{color:#e3c14d;font-weight:700;text-transform:none}.mc .usm-rowh{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.mc-tg{display:inline-flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}" +
    ".mc-tg button{all:unset;cursor:pointer;padding:6px 16px;font-weight:700;font-size:13px;color:var(--muted)}.mc-tg button[aria-pressed=true]{background:#ffb84d;color:#101825}" +
    ".mc-ks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.mc-k{border:1px solid var(--line2);border-radius:8px;padding:10px 12px}.mc-k span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}" +
    ".mc-k b{display:block;font:600 22px 'IBM Plex Mono',monospace;margin:3px 0}.mc-k small{color:var(--faint);font-size:11.5px}.mc .up,.mc b.up{color:var(--green)}.mc .dn,.mc b.dn{color:var(--red)}" +
    ".mc-h{margin:16px 0 6px;font-size:13px;letter-spacing:.04em}.mc-h small{font-weight:400;color:var(--faint);margin-left:6px}.mc-svg{width:100%;height:auto;display:block}.mc-svg rect.u{fill:var(--green)}.mc-svg rect.d{fill:var(--red)}" +
    ".mc-ax{stroke:var(--muted);stroke-width:1}.mc-gr{stroke:var(--line);stroke-dasharray:2 4}.mc-tk{font:10px 'IBM Plex Mono',monospace;fill:var(--faint)}.mc-vl{font:600 10px 'IBM Plex Mono',monospace}.mc-vl.u{fill:var(--green)}.mc-vl.d{fill:var(--red)}" +
    ".mc-read{margin:10px 0 4px;font-size:14px;line-height:1.5}.mc-two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.mc-t td:nth-child(2),.mc-t th:nth-child(2),.mc-t td:nth-child(3),.mc-t th:nth-child(3){text-align:left!important}.mc-t td small{display:block;color:var(--faint);font-size:10.5px}.mc-t td:first-child{color:var(--faint);width:22px}" +
    ".mc-sec{display:grid;gap:4px}.mc-sr{display:grid;grid-template-columns:200px 1fr 190px;align-items:center;gap:10px;font-size:12.5px}.mc-sb{position:relative;height:12px;background:var(--line);border-radius:3px}.mc-sb:after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--muted)}" +
    ".mc-sb i{position:absolute;top:0;bottom:0;border-radius:3px}.mc-sb i.u{background:var(--green)}.mc-sb i.d{background:var(--red)}.mc-sv{font-family:'IBM Plex Mono',monospace;text-align:right}.mc-n{margin-top:12px;font-size:12px;white-space:normal!important;overflow:visible!important}" +
    "@media (max-width:900px){.mc-ks{grid-template-columns:1fr 1fr}.mc-two{grid-template-columns:1fr}.mc-sr{grid-template-columns:120px 1fr 120px}}";
  doc.head.appendChild(st);
  root.MCAP_UI = { html: html };
})(window);
