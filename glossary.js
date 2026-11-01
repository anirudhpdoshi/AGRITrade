/* glossary.js — an "ⓘ" next to market terms anywhere on the desk; hover (or tap) for a plain-language meaning.
   Marks the first appearance of each term per card, in headings, labels and table headers only (never inside numbers,
   links or buttons), and re-scans after each redraw. Text only, no data. */
(function () {
  "use strict";
  var G = [
    ["open interest", "Open interest", "Number of futures or options contracts still open at the end of the day. Rising open interest means new positions are being opened; falling means positions are being closed."],
    ["put wall", "Put wall", "The strike below the price with the most put open interest. Option hedging there often makes it act as support."],
    ["call wall", "Call wall", "The strike above the price with the most call open interest. It often acts as resistance."],
    ["put/call", "Put/call ratio", "Put open interest divided by call open interest. Above 1 = more protection being held (cautious); below 1 = more calls (bullish lean)."],
    ["implied vol", "Implied volatility (IV)", "The yearly price swing the options market is pricing in, read from option premiums. Higher IV = the market expects bigger moves."],
    ["historical vol", "Historical volatility (HV)", "How much the price actually moved over recent days, annualised. IV above HV means options are pricing more movement than recently seen."],
    ["skew", "Skew", "How implied volatility differs between puts and calls at different strikes — shows whether traders pay more for downside or upside protection."],
    ["first notice day", "First notice day (FND)", "First day a holder of a long futures position can be told to take delivery. Speculative longs exit before it."],
    ["hard exit", "Hard exit (desk rule)", "The desk's own rule: positions in the expiring contract must be closed one business day before first notice day."],
    ["roll", "Roll", "Moving a position from the expiring contract to the next one. Roll % = share of open interest already in the next contract."],
    ["contango", "Contango", "Later contracts priced above the nearby one — the market is paying to store the crop (ample supply)."],
    ["backwardation", "Backwardation", "Nearby contract priced above later ones — the market wants the crop now (tight supply)."],
    ["calendar spread", "Calendar spread", "Price difference between two delivery months of the same commodity, in ¢/bu."],
    ["basis", "Basis", "Local cash price minus the futures price. A stronger (higher) basis means local buyers are paying up."],
    ["settle", "Settlement", "The exchange's official end-of-day price, used for margin and for the desk's daily change."],
    ["wasde", "WASDE", "USDA's monthly World Agricultural Supply and Demand Estimates — the main balance sheet for corn, soybeans and wheat."],
    ["managed money", "Managed money", "Hedge funds and commodity trading advisers in the CFTC Commitments of Traders report — the speculative side of the market."],
    ["commitments of traders", "Commitments of Traders (COT)", "Weekly CFTC report (Friday 3:30 pm ET, data as of Tuesday) showing who holds futures positions."],
    ["export sales", "Export sales", "USDA's weekly report of new US export contracts (Thursday 8:30 am ET) — a demand signal."],
    ["export inspections", "Export inspections", "Grain actually inspected for shipment that week (USDA, Monday) — sales turning into shipments."],
    ["crop progress", "Crop progress", "USDA's weekly survey (Monday 4 pm ET, Apr–Nov) of planting, condition and harvest pace by state."],
    ["harvest", "Harvest", "Gathering the crop. Pace vs the 5-year average matters: a fast harvest brings supply to market (seasonal price pressure); delays can support prices."],
    ["planting", "Planting", "Sowing the crop. Planting pace and acres set next season's supply; corn vs soybean acres compete for the same land."],
    ["ending stocks", "Ending stocks", "Grain left over at the end of the marketing year. Higher stocks = more cushion = usually lower prices."],
    ["stocks/use", "Stocks-to-use", "Ending stocks as a % of total use — the tightness gauge. Lower = tighter supply."],
    ["σ", "Sigma (σ)", "One standard deviation of daily price moves. ±2σ covers about 95% of normal outcomes."],
    ["ma20", "Moving average (MA20)", "Average settlement over the last 20 trading days; price above it = short-term uptrend."],
    ["z-score", "z-score", "How many standard deviations a value is from its recent average. Beyond ±2 is unusual."],
    ["corra", "CORRA", "Canadian Overnight Repo Rate Average — Canada's benchmark overnight rate, tracking the Bank of Canada policy rate. CORRA futures imply where markets expect it to go."],
    ["hawkish", "Hawkish", "Leaning toward higher interest rates to fight inflation. Usually supports the currency."],
    ["dovish", "Dovish", "Leaning toward lower interest rates to support growth. Usually weighs on the currency."],
    ["forward guidance", "Forward guidance", "What a central bank signals about its next moves."],
    ["dissent", "Dissent", "A policy committee member voted against the decision — a hint of where policy could go next."],
    ["cusma", "CUSMA / USMCA", "The Canada–United States–Mexico trade agreement that replaced NAFTA; governs most cross-border trade, including grain."],
    ["dxy", "Dollar index (DXY)", "The US dollar against a basket of six major currencies. A stronger dollar usually lifts USD/CAD and weighs on grain prices."],
    ["bp", "Basis point (bp)", "One hundredth of a percentage point (0.01%)."],
    ["c$/t", "C$ per tonne", "Futures price converted to Canadian dollars per metric tonne (bushels per tonne × USD/CAD), before local basis."],
    ["preliminary", "Preliminary open interest", "CME's early open-interest count, published before the open; the final follows about 10:30 am ET. On this desk they have matched within ~0.2%."],
    ["weekly", "Weekly options", "Short-dated options that expire on Fridays between the monthly expiries."],
    ["royal assent", "Royal assent", "The final step that makes a Canadian bill law, after it passes the House of Commons and the Senate."],
    ["second reading", "Second reading", "The debate and vote on a bill's principle; if it passes, the bill goes to committee for detailed study."],
    ["union calendar", "Union Calendar", "The U.S. House list of bills that raise or spend money, reported out of committee and eligible for a floor vote."],
    ["usd/cad", "USD/CAD", "Canadian dollars per US dollar. Up = weaker loonie, which raises the C$ value of US-priced grain."],
    ["spread", "Spread", "The difference between two prices or yields — e.g. US minus Canada 10-year yield, a key driver of USD/CAD."]
  ];
  var SEL = "h2, h3, h4, th, .h2note, .kk, .kpi-k, .ck-lab, .dl, .lbl, .rail-title > span:first-child, .qt-sub, .mk-l, .stat-l, .fl-vl, .oi-mt, .br-s, .pi-l, .evr-t";
  var RX = G.map(function (g) { return [new RegExp("(^|[^a-z])(" + g[0].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ")(?![a-z])", "i"), g]; });
  var tip = null;
  function show(btn) {
    var g = G[+btn.getAttribute("data-gl")]; if (!g) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "gl-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    tip.innerHTML = "<b>" + g[1] + "</b>" + g[2];
    var r = btn.getBoundingClientRect(); tip.style.display = "block";
    var w = Math.min(320, window.innerWidth - 24), x = Math.max(12, Math.min(r.left - w / 2 + 8, window.innerWidth - w - 12));
    tip.style.width = w + "px"; tip.style.left = x + "px"; tip.style.top = (r.bottom + window.scrollY + 6) + "px";
  }
  function hide() { if (tip) tip.style.display = "none"; }
  function scan(root) {
    [].forEach.call((root || document).querySelectorAll(".tile, .rail-card, .pm-card, .qt"), function (card) {
      if (card.closest(".gl-done") && card.closest(".gl-done") !== card) return;
      var used = {};
      [].forEach.call(card.querySelectorAll(SEL), function (el) {
        if (el.closest("button, a, .gl, svg, select, option, input")) return;
        if (el.querySelector(".gl")) { [].forEach.call(el.querySelectorAll(".gl"), function (b) { used[b.getAttribute("data-gl")] = 1; }); return; }
        var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, nodes = [];
        while ((n = w.nextNode())) if (n.nodeValue.trim().length > 1 && !n.parentNode.closest("button, a, .gl")) nodes.push(n);
        nodes.forEach(function (tn) {
          for (var i = 0; i < RX.length; i++) {
            if (used[i]) continue;
            var m = RX[i][0].exec(tn.nodeValue); if (!m) continue;
            used[i] = 1;
            var end = m.index + m[1].length + m[2].length, after = tn.splitText(end);
            var b = document.createElement("button"); b.type = "button"; b.className = "gl"; b.setAttribute("data-gl", i); b.setAttribute("aria-label", "What is " + RX[i][1][1] + "?"); b.textContent = "i";
            tn.parentNode.insertBefore(b, after);
            break;   /* one mark per text node keeps headings readable */
          }
        });
      });
    });
  }
  var timer = 0, busy = false;
  function later() { if (timer) return; timer = setTimeout(function () { timer = 0; busy = true; try { scan(document.querySelector("main")); } catch (e) {} busy = false; }, 400); }
  new MutationObserver(function () { if (!busy) later(); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("mouseover", function (e) { var b = e.target.closest && e.target.closest(".gl"); if (b) show(b); });
  document.addEventListener("mouseout", function (e) { if (e.target.closest && e.target.closest(".gl")) hide(); });
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest(".gl"); if (b) { e.preventDefault(); e.stopPropagation(); show(b); } else hide(); }, true);
  window.addEventListener("scroll", hide, { passive: true });
  var css = document.createElement("style");
  css.textContent = ".gl{appearance:none;display:inline-grid;place-items:center;width:14px;height:14px;margin:0 2px 0 3px;padding:0;border-radius:50%;border:1px solid #3d6a86;background:transparent;color:#7dd8e6;font:italic 700 9.5px Georgia,serif;line-height:1;cursor:help;vertical-align:1px;text-transform:none;letter-spacing:0}" +
    ".gl:hover,.gl:focus-visible{background:#13304a;outline:none}" +
    ".gl-tip{position:absolute;z-index:90;display:none;background:#0f1d2c;border:1px solid #2f6a80;border-radius:8px;padding:9px 11px;font:13px/1.45 'Libre Franklin',system-ui,sans-serif;color:#dbe4ee;box-shadow:0 8px 28px rgba(0,0,0,.5);text-transform:none;letter-spacing:0;font-weight:400}" +
    ".gl-tip b{display:block;color:#7dd8e6;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px}";
  document.head.appendChild(css);
  window.GLOSSARY = { terms: G, scan: scan };
})();
