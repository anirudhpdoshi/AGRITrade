/* optflow-ui.js — "Options flow & expirations" tile on each grain's Derivatives view (DATA.optflow, scripts/optflow.py).
   Daily tier: expected moves per expiration, strike/expiration rankings, estimated dealer gamma and the gamma flip,
   next-day expected range with its outcome, a record book and historical analogues. Every derived number is labelled an
   estimate; trade-level flow (buyer/seller side, sweeps, blocks, sizes) needs a paid time-and-sales feed and is listed as such. */
(function () {
  "use strict";
  var NAME = { corn: "Corn", wheat: "Wheat", soybeans: "Soybeans" };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function px(v) { return v == null ? "—" : "$" + (+v).toFixed(4); }
  function ct(v) { return v == null ? "—" : ((v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "¢"); }
  function n0(v) { return v == null ? "—" : Math.round(v).toLocaleString("en-US"); }
  function mm(v) { return v == null ? "—" : (v < 0 ? "−" : "") + "$" + (Math.abs(v) / 1e6).toFixed(1) + "M"; }
  function pc(v, d) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 2 : d) + "%"; }
  function sd(d) { if (!d) return "—"; var p = d.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function k(l, v, s, cls) { return '<div class="of-k"><div class="of-kl">' + l + '</div><div class="of-kv ' + (cls || "") + '">' + v + '</div><div class="of-ks">' + (s || "") + "</div></div>"; }

  function tile(key) {
    var O = window.DATA && DATA.optflow && DATA.optflow[key]; if (!O) return "";
    var nd = O.next_day, ch = O.chains || [], nc = ch.filter(function (c) { return c.leg === "near"; })[0] || ch[0] || {}, A = O.analogues || {}, H = (O.hist || []).slice().reverse();
    var lastOut = H.filter(function (h) { return h.out; })[0], F = O.price;
    var kp = '<div class="of-kg">' +
      k("Next-day expected range", nd ? px(nd.lo) + " – " + px(nd.hi) : "—", nd ? "±" + (nd.em * 100).toFixed(1) + "¢ (1σ, near IV " + nd.iv.toFixed(1) + "%) from the " + sd(nd.from) + " settle" : "") +
      k("Est. dealer gamma (near)", mm(nc.gex) + " /1%", nc.gex == null ? "" : nc.gex >= 0 ? "long gamma → hedging damps moves" : "short gamma → hedging can extend moves", nc.gex >= 0 ? "up" : "dn") +
      k("Gamma flip (est.)", nc.flip ? px(nc.flip) : "none in ±15%", nc.flip ? ct(nc.flip - F) + " from " + px(F) : "") +
      k("Put/call open interest", nc.pcr != null ? nc.pcr.toFixed(2) : "—", n0(nc.puts_oi) + " puts · " + n0(nc.calls_oi) + " calls") +
      k("Est. premium traded", nc.has_vol ? mm((nc.prem_c || 0) + (nc.prem_p || 0)) : "—", nc.has_vol ? "calls " + mm(nc.prem_c) + " · puts " + mm(nc.prem_p) + " · vol × model value × 5,000 bu" : "volume per strike arrives with the next morning pull") + "</div>";
    var ex = '<table class="of-t"><thead><tr><th>Expiry</th><th>DTE</th><th>ATM IV</th><th>±1σ move</th><th>Expected range</th><th>Call OI</th><th>Put OI</th><th>P/C</th><th>Est. GEX /1%</th><th>Flip</th></tr></thead><tbody>' +
      ch.map(function (c) { return "<tr><td><b>" + esc(c.chain || c.contract) + '</b><small>' + sd(c.expires) + " · " + esc(c.contract || "") + (c.leg === "weekly" ? " · weekly" : "") + "</small></td><td>" + (c.dte != null ? c.dte.toFixed(0) : "—") + "</td><td>" + (c.atm_iv != null ? c.atm_iv.toFixed(1) + "%" : "—") +
        "</td><td>" + (c.em != null ? "±" + (c.em * 100).toFixed(1) + "¢ <small>±" + c.em_pct.toFixed(1) + "%</small>" : "—") + "</td><td>" + (c.lo != null ? px(c.lo) + " – " + px(c.hi) : "—") + "</td><td>" + n0(c.calls_oi) + "</td><td>" + n0(c.puts_oi) + "</td><td>" + (c.pcr != null ? c.pcr.toFixed(2) : "—") +
        '</td><td class="' + (c.gex >= 0 ? "up" : "dn") + '">' + mm(c.gex) + "</td><td>" + (c.flip ? px(c.flip) : "—") + "</td></tr>"; }).join("") + "</tbody></table>";
    var top = nc.top_oi || [], mx = Math.max.apply(null, top.map(function (s) { return Math.max(s.coi, s.poi); }).concat([1]));
    var heat = '<div class="of-hm">' + top.slice().sort(function (a, b) { return b.k - a.k; }).map(function (s) {
      return '<div class="of-hr' + (Math.abs(s.k - F) < 0.051 ? " atm" : "") + '"><span class="of-hk">' + px(s.k) + (s.k > F ? " ↑" : " ↓") + '</span><span class="of-hb"><i class="c" style="width:' + (s.coi / mx * 100).toFixed(0) + '%"></i></span><span class="of-hn">' + n0(s.coi) + 'C</span>' +
        '<span class="of-hb"><i class="p" style="width:' + (s.poi / mx * 100).toFixed(0) + '%"></i></span><span class="of-hn">' + n0(s.poi) + 'P</span><span class="of-hg ' + (s.gex >= 0 ? "up" : "dn") + '">' + mm(s.gex) + "</span>" + (s.voi != null ? '<span class="of-hv">vol/OI ' + s.voi.toFixed(2) + "</span>" : "") + "</div>"; }).join("") + "</div>";
    var val = lastOut ? '<div class="of-val ' + (lastOut.out.breach_close ? "br" : "ok") + '"><b>' + sd(lastOut.d) + " expected " + px(lastOut.lo) + " – " + px(lastOut.hi) + "</b> → " + sd(lastOut.out.d) + " closed " + px(lastOut.out.close) + " (" + pc(lastOut.out.ret) + "), high " + px(lastOut.out.high) + " / low " + px(lastOut.out.low) +
      ' · <span class="of-chip">' + (lastOut.out.breach_close ? "Close outside the range" : "Close inside the range") + '</span> <span class="of-chip">' + (lastOut.out.breach_intraday == null ? "Intraday high/low not available" : lastOut.out.breach_intraday ? "Range touched intraday" : "Range held intraday") + "</span> · realized ÷ implied " + (lastOut.out.realized_vs_implied != null ? lastOut.out.realized_vs_implied.toFixed(2) + "×" : "—") + "</div>" : '<p class="note">The first next-day comparison appears once a recorded session is followed by a settle.</p>';
    var book = '<table class="of-t"><thead><tr><th>Session</th><th>Settle</th><th>IV</th><th>Expected range</th><th>Next close</th><th>Return</th><th>High / low</th><th>Close</th><th>Intraday</th></tr></thead><tbody>' +
      H.slice(0, 10).map(function (h) { var o = h.out; return "<tr><td>" + sd(h.d) + (h.seeded ? ' <small title="Seeded from stored IV history">s</small>' : "") + "</td><td>" + px(h.s) + "</td><td>" + (h.iv != null ? h.iv.toFixed(1) + "%" : "—") + "</td><td>" + px(h.lo) + " – " + px(h.hi) + "</td><td>" + (o ? px(o.close) : '<small>awaiting</small>') +
        '</td><td class="' + (o ? (o.ret >= 0 ? "up" : "dn") : "") + '">' + (o ? pc(o.ret) : "—") + "</td><td>" + (o ? px(o.high) + " / " + px(o.low) : "—") + "</td><td>" + (o ? (o.breach_close ? '<b class="dn">breach</b>' : "inside") : "—") + "</td><td>" + (o && o.breach_intraday != null ? (o.breach_intraday ? '<b class="dn">touched</b>' : "held") : "—") + "</td></tr>"; }).join("") + "</tbody></table>";
    var s = A.similar || {}, a = A.all || {};
    var an = '<div class="of-an"><div><div class="of-kl">Similar sessions <span class="of-conf ' + esc((A.confidence || "Low").toLowerCase()) + '">' + esc(A.confidence || "Low") + " confidence</span></div>" +
      (s.n ? '<div class="of-ar">n = <b>' + s.n + "</b> · next-day avg " + pc(s.avg) + " · median " + pc(s.median) + " · up " + s.p_up + "% / down " + s.p_down + "% · close outside range " + s.p_breach_close + "%" + (s.p_breach_intraday != null ? " · touched intraday " + s.p_breach_intraday + "%" : "") + " · realized ÷ implied " + s.rv_iv.toFixed(2) + "×</div>" : '<div class="of-ar">No similar session in the record book yet.</div>') +
      '<div class="of-ks">' + esc(A.rule || "") + "</div></div><div><div class=\"of-kl\">All recorded sessions</div>" + (a.n ? '<div class="of-ar">n = <b>' + a.n + "</b> · avg " + pc(a.avg) + " · up " + a.p_up + "% · close outside 1σ " + a.p_breach_close + "% (≈32% if moves were normal) · realized ÷ implied " + a.rv_iv.toFixed(2) + "×</div>" : '<div class="of-ar">Builds one session per day.</div>') + "</div></div>";
    var PS = O.positioning, CO = O.conclusion || [], LG = O.ledger || {};
    var RC = { support: ["Potential support", "up"], resistance: ["Potential resistance", "dn"], magnet: ["Price magnet / pin", "mag"], acceleration: ["Acceleration zone", "acc"], weakening: ["Weakening", "neu"], weak: ["Minor", "neu"], "broken support": ["Broken support", "brk"], "broken resistance": ["Broken resistance", "brk"] };
    function dd(d, p) { return d == null ? "—" : (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toLocaleString("en-US") + (p != null ? " <small>" + (p > 0 ? "+" : "") + p + "%</small>" : ""); }
    var posH = PS ? '<h3 class="of-h3">Positioning engine — what participants are doing <span class="h2note">· confirmed OI ' + sd(PS.prev_date) + " → latest pull · activity inferred from OI and IV change</span></h3>" +
      '<div class="of-bias"><div class="of-gauge"><i style="left:' + (50 + (PS.score || 0) / 2) + '%"></i></div><div><b class="' + ((PS.score || 0) > 0 ? "up" : (PS.score || 0) < 0 ? "dn" : "") + '">' + esc(PS.label) + "</b>" + (PS.score != null ? " · score " + (PS.score > 0 ? "+" : "") + PS.score + " of ±100" : "") + ' <span class="of-conf ' + esc((PS.conf || "low").toLowerCase()) + '">' + esc(PS.conf || "Low") + " confidence</span>" + " · " + esc(PS.vol_view) + (PS.iv_chg != null ? " (strike IV " + (PS.iv_chg > 0 ? "+" : "") + PS.iv_chg + " pts)" : "") +
      '<div class="of-ks">' + n0(PS.bull) + " contracts lean bullish (calls bought, puts written) · " + n0(PS.bear) + " lean bearish (puts bought, calls written) — " + (PS.share != null ? PS.share + "% of the chain changed" : "") + (PS.hedge ? " · " + n0(PS.hedge) + " look like downside protection" : "") + (PS.rolls.length ? " · possible rolls: " + esc(PS.rolls.join("; ")) : "") + "</div></div></div>" +
      '<div class="of-kg">' + k("Largest additions", PS.adds.filter(function (a) { return a.d > 0; }).slice(0, 3).map(function (a) { return px(a.k).replace("$", "") + " +" + n0(a.d); }).join(" · ") || "—", "net contracts added since " + sd(PS.prev_date)) +
      k("Largest reductions", PS.cuts.slice(0, 3).map(function (a) { return px(a.k).replace("$", "") + " −" + n0(-a.d); }).join(" · ") || "—", "contracts closed / expired") +
      k("Est. vanna", mm(PS.vanna) + " Δ", "dealer delta change if IV rises 1 vol-point ×100 (est.)") + k("Est. charm", mm(PS.charm) + " Δ/yr", "dealer delta drift from time decay alone (est.)") + "</div>" +
      '<div class="of-scroll"><table class="of-t of-pos"><thead><tr><th>Strike</th><th>From price</th><th>Calls OI (Δ)</th><th>Puts OI (Δ)</th><th>Share</th><th>IV Δ C / P</th><th>Activity (inferred)</th><th>Est. GEX</th><th>Touch odds 1d / expiry</th><th>Hit (20d)</th><th>Role</th><th>Conf.</th></tr></thead><tbody>' +
      PS.strikes.slice().sort(function (a, b) { return b.k - a.k; }).map(function (x) { var r = RC[x.role] || [x.role, "neu"];
        return '<tr title="' + esc(x.why.join(" · ")) + '"><td><b>' + px(x.k) + "</b></td><td>" + (x.dist > 0 ? "+" : "") + x.dist.toFixed(1) + "%" + (x.in_em ? ' <small>inside 1-day range</small>' : "") + "</td><td>" + n0(x.coi) + "<small>" + dd(x.dc, x.dc_pct) + "</small></td><td>" + n0(x.poi) + "<small>" + dd(x.dp, x.dp_pct) + "</small></td><td>" + x.conc.toFixed(1) + "%</td><td>" + (x.divc != null ? (x.divc > 0 ? "+" : "") + x.divc : "—") + " / " + (x.divp != null ? (x.divp > 0 ? "+" : "") + x.divp : "—") +
          "</td><td>" + esc([x.lc && x.lc !== "steady" ? x.lc : "", x.lp && x.lp !== "steady" ? x.lp : ""].filter(Boolean).join(", ") || "steady") + '</td><td class="' + (x.gex >= 0 ? "up" : "dn") + '">' + mm(x.gex) + "</td><td>" + (x.p_touch_1d != null ? x.p_touch_1d + "% / " + x.p_touch + "%" : "—") + "</td><td>" + (x.touch ? "hit " + x.touch + "×" : "—") +
          '</td><td><span class="of-role ' + r[1] + '">' + r[0] + "</span></td><td>" + esc(x.conf) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<div class="of-top"><div><div class="of-kl">Top call open interest</div>' + PS.top_calls.map(function (t) { return px(t[0]).replace("$", "") + " " + n0(t[1]); }).join(" · ") + '</div><div><div class="of-kl">Top put open interest</div>' + PS.top_puts.map(function (t) { return px(t[0]).replace("$", "") + " " + n0(t[1]); }).join(" · ") + "</div></div>" : "";
    var conH = CO.length ? '<h3 class="of-h3">Daily intelligence conclusion</h3><ol class="of-con">' + CO.map(function (c) { return "<li><b>" + esc(c.q) + "</b> " + esc(c.a) + "</li>"; }).join("") + "</ol>" : "";
    var lgH = '<div class="of-kg">' + ["20", "60", "90"].map(function (n) { var L = LG[n]; return k("Ledger · last " + n + " sessions", L ? "n " + L.n + " · outside range " + L.breach_close + "%" : "—", L ? "realized ÷ implied " + L.rv_iv + "×" + (L.dir_n ? " · positioning called direction " + L.dir_hit + "% (n " + L.dir_n + ")" : " · direction calls start with the positioning score") : "builds daily"); }).join("") + "</div>";
    var na = '<details class="of-na"><summary>Not available on the daily tier (needs a paid options time-and-sales feed)</summary>Buyer- vs seller-initiated premium and net premium flow · sweeps, blocks, fragmented and repeated executions · execution count, average/median trade size, largest transactions · institutional- vs retail-sized participant estimates · opening/closing, spread, collar and roll detection · 5/15/30/60-minute accumulation alerts. These need every trade with its size, price and side; the desk sees one daily snapshot of open interest, IV and volume per strike.</details>';
    return '<div class="tile wide of-tile" id="of-' + key + '" data-src="options"><div class="tile-head"><h2>Options flow &amp; expirations — ' + NAME[key] + ' <span class="h2note">· where options money sits, what the market is pricing for the next session, and how often that range has held · <b>daily tier · estimates</b> · ' + esc(new Date(O.asof).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET</span></h2></div>" +
            (window.kbBox && window.KB && KB.grain && KB.grain.optflow ? kbBox(KB.grain.optflow) : "") +       kp + conH + posH + '<h3 class="of-h3">Expirations</h3>'   + ex + '<h3 class="of-h3">Strike concentration — near month (open interest, est. gamma)</h3>' + heat +
      '<h3 class="of-h3">Next-day check</h3>' + val + '<h3 class="of-h3">Record book</h3>' + book + '<h3 class="of-h3">Historical analogues & forecast ledger</h3>' + an + lgH + na +
      '<p class="stamp">Expected move = futures × ATM implied volatility × √(time to expiry) — options-implied 1σ, not a forecast. Dealer gamma assumes dealers are long calls and short puts (a convention, not observed positioning); premium = volume × Black-76 value × 5,000 bu (no fills are seen). Analogues and probabilities describe past sessions only — they are not certainties.</p></div>';
  }
  /* mount after the open-interest card on the Derivatives view; alerts go to the Feed */
  function mount() {
    ["corn", "wheat", "soybeans"].forEach(function (key) {
      var P = document.getElementById("panel-" + key); if (!P || !P.classList.contains("active")) return;
      var oi = P.querySelector('[id^="oi-"]'); if (!oi) return;
      var anchor = oi.closest(".tile") || oi, ex = P.querySelector("#of-" + key), html = tile(key); if (!html) return;
      if (!ex) { anchor.insertAdjacentHTML("afterend", html); }
      else if (ex._sig !== DATA.meta.asof.optflow) { ex.outerHTML = html; }
      var n = P.querySelector("#of-" + key); if (n) n._sig = DATA.meta.asof.optflow;
    });
  }
  function alerts() {
    if (!window.EVENTS || !EVENTS.log || window.DESK_LOCKED) return;
    ["corn", "wheat", "soybeans"].forEach(function (key) {
      var O = DATA.optflow && DATA.optflow[key]; if (!O || !O.hist) return;
      var H = O.hist, last = H.filter(function (h) { return h.out; }).slice(-1)[0];
      if (last && last.out.breach_close) EVENTS.log("level", "<b>" + NAME[key] + "</b> closed outside the options-implied range (" + sd(last.d) + " ±" + (last.em * 100).toFixed(1) + "¢) — " + pc(last.out.ret), key + ":deriv@#of-" + key, "ofb|" + key + "|" + last.d);
      var PSx = O.positioning;
      if (PSx && PSx.score != null) EVENTS.log("oi", "<b>" + NAME[key] + " options positioning: " + esc(PSx.label) + "</b> (score " + (PSx.score > 0 ? "+" : "") + PSx.score + ") · " + esc(PSx.vol_view) + (PSx.adds[0] && PSx.adds[0].d > 0 ? " · most added at " + PSx.adds[0].k.toFixed(2) + " (+" + n0(PSx.adds[0].d) + ")" : ""), key + ":deriv@#of-" + key, "ofp|" + key + "|" + (PSx.prev_date || "") + "|" + PSx.label);
      (PSx ? PSx.strikes : []).forEach(function (x) { if (/^broken/.test(x.role)) EVENTS.log("level", "<b>" + NAME[key] + " " + x.role + " at " + x.k.toFixed(2) + "</b> — " + n0(x.coi + x.poi) + " contracts of open interest; last close crossed the strike", key + ":deriv@#of-" + key, "ofx|" + key + "|" + x.k + "|" + (O.settle_date || "")); });
      var a = H[H.length - 1], b = H[H.length - 2];
      if (a && b && a.iv && b.iv && a.iv / b.iv - 1 >= 0.1) EVENTS.log("oi", "<b>" + NAME[key] + " expected move expands</b> — near IV " + b.iv.toFixed(1) + "% → " + a.iv.toFixed(1) + "% (next-day ±" + (a.em * 100).toFixed(1) + "¢)", key + ":deriv@#of-" + key, "ofi|" + key + "|" + a.d);
    });
  }
  var t = 0;
  new MutationObserver(function () { if (!t) t = setTimeout(function () { t = 0; try { mount(); } catch (e) {} }, 300); }).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
  setInterval(alerts, 30000); setTimeout(alerts, 4000);
  var css = document.createElement("style");
  css.textContent = ".of-kg{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:10px 0}.of-k{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 10px}" +
    ".of-kl{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}.of-kv{font:600 17px 'IBM Plex Mono',monospace;margin:3px 0}.of-ks{font-size:12px;color:var(--muted)}" +
    ".of-h3{font-size:13px;margin:14px 0 6px;letter-spacing:.02em}.of-t{width:100%;border-collapse:collapse;font-size:12.5px}.of-t th{font:600 11px 'IBM Plex Mono',monospace;color:var(--faint);text-align:right;padding:5px 6px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.05em}" +
    ".of-t th:first-child,.of-t td:first-child{text-align:left}.of-t td{text-align:right;padding:6px;border-bottom:1px dashed var(--line);font-family:'IBM Plex Mono',monospace}.of-t td small{display:block;color:var(--faint);font-size:11px}" +
    ".of-hm{display:flex;flex-direction:column;gap:3px}.of-hr{display:grid;grid-template-columns:96px 1fr 70px 1fr 70px 70px 90px;gap:6px;align-items:center;font:12px 'IBM Plex Mono',monospace;padding:2px 4px;border-radius:4px}.of-hr.atm{background:rgba(232,163,61,.10)}" +
    ".of-hb{height:9px;background:var(--panel2);border-radius:5px;overflow:hidden}.of-hb i{display:block;height:100%}.of-hb i.c{background:var(--call)}.of-hb i.p{background:var(--put)}.of-hn{color:var(--muted);text-align:right}.of-hg{text-align:right}.of-hv{color:var(--faint);font-size:11px}" +
    ".of-val{padding:9px 12px;border-radius:8px;font-size:13px;line-height:1.55;border:1px solid var(--line)}.of-val.br{border-left:3px solid var(--red)}.of-val.ok{border-left:3px solid var(--green)}.of-chip{display:inline-block;font:600 11px 'IBM Plex Mono',monospace;border:1px solid var(--line2);border-radius:10px;padding:0 7px}" +
    ".of-an{display:grid;grid-template-columns:1fr 1fr;gap:12px}.of-ar{font-size:13px;margin:4px 0;line-height:1.5}.of-conf{margin-left:6px;padding:0 6px;border-radius:8px;font-size:10.5px}.of-conf.low{background:#3a2a10;color:#f6d38f}.of-conf.medium{background:#12283a;color:#bfe3ec}.of-conf.high{background:#10301f;color:#9fe0bd}" +
    ".of-bias{display:grid;grid-template-columns:220px 1fr;gap:14px;align-items:center;margin:6px 0 10px;font-size:13.5px}.of-gauge{position:relative;height:10px;border-radius:5px;background:linear-gradient(90deg,var(--red),#3a4556 50%,var(--green))}.of-gauge i{position:absolute;top:-4px;width:4px;height:18px;margin-left:-2px;background:#fff;border-radius:2px}" +
    ".of-scroll{overflow-x:auto}.of-pos{min-width:1080px}.of-pos td small{display:block}.of-role{display:inline-block;font:600 10.5px 'IBM Plex Mono',monospace;padding:1px 6px;border-radius:4px;border:1px solid var(--line2)}.of-role.up{color:var(--green);border-color:var(--green)}.of-role.dn{color:var(--red);border-color:var(--red)}.of-role.mag{color:#c9a3ff;border-color:#c9a3ff}.of-role.acc{color:#f0a35e;border-color:#f0a35e}.of-role.brk{background:var(--red);color:#fff;border-color:var(--red)}" +
    ".of-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;font:12px 'IBM Plex Mono',monospace;color:var(--muted)}.of-con{margin:4px 0 0 18px;padding:0;font-size:13px;line-height:1.55}.of-con b{color:var(--ink)}" +
    ".of-na{margin-top:12px;font-size:12.5px;color:var(--muted)}.of-na summary{cursor:pointer;font:600 12px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    "@media (max-width:900px){.of-an{grid-template-columns:1fr}.of-hr{grid-template-columns:80px 1fr 60px 1fr 60px}.of-hg,.of-hv{display:none}.of-tile .of-t{display:block;overflow-x:auto}}";
  document.head.appendChild(css);
  window.OPTFLOW = { tile: tile, mount: mount };
})();
