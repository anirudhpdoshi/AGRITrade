/* feed-rail.js — one Feed panel, the same on every tab.
   Source: the desk's milestone feed (events-ui.js — data arrivals, macro prints, central-bank documents and decisions,
   open-interest and wall moves, level crossings, world alerts, legislation and earnings due). Every item is tagged
   (Corn · Wheat · Soybeans · USD/CAD · Macro · Central banks · World · Legislation · Earnings) and the panel opens on the
   tab you are on (Corn tab → Corn). Breaking items are red, pinned to the top for 2 hours and pop a notification.
   Tabs with a right rail get the panel at the top of the rail; full-width tabs get it as a docked drawer on the right. */
(function () {
  "use strict";
  var TAGS = [["all", "All"], ["agri", "Agri"], ["corn", "Corn"], ["wheat", "Wheat"], ["soybeans", "Soybeans"], ["fx", "USD/CAD"], ["macro", "Macro"], ["cb", "Central banks"], ["world", "World"], ["energy", "Energy"], ["metals", "Metals"], ["leg", "Legislation"], ["earn", "Earnings"]];
  var TN = {}; TAGS.forEach(function (t) { TN[t[0]] = t[1]; });
  var TC = { corn: "#e8b93d", wheat: "#d9a066", soybeans: "#3fb97f", fx: "#38b6c9", macro: "#6ea8ff", cb: "#9b8cff", world: "#ff8a84", leg: "#c9a3ff", earn: "#f5c542", energy: "#f08a5d", metals: "#d4b25a" };
  var DEF = { corn: "corn", wheat: "wheat", soybeans: "soybeans", fx: "fx", world: "world", policy: "cb", earnings: "earn", briefing: "all", events: "all", intel: "agri" };
  var pick = {}, seen = {}, firstPass = true, lastSig = "", ONLY = true;
  try { ONLY = localStorage.getItem("desk.feedall") !== "1"; } catch (e) {}
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function hm(t) { return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }); }
  function day(t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); }
  function tab() { var a = document.querySelector(".tab-panel.active"); return a ? a.id.replace("panel-", "") : "corn"; }
  function feed() { try { return (window.EVENTS && EVENTS._feed && EVENTS._feed()) || []; } catch (e) { return []; } }

  function tagsOf(m) {
    var t = {}, g = (m.go || "").split("@")[0].split(":")[0], h = (m.h || "").replace(/<[^>]+>/g, " ");
    if (/^(corn|wheat|soybeans)$/.test(g)) t[g] = 1;
    if (/\bcorn\b/i.test(h)) t.corn = 1; if (/\bwheat\b/i.test(h)) t.wheat = 1; if (/soybean|\bsoy\b|\bbeans\b/i.test(h)) t.soybeans = 1;
    if (/CBOT|grains?\b|WASDE|export sales|Commitments of Traders — grains|Options open interest|fundamentals|settlements/i.test(h)) { t.corn = t.wheat = t.soybeans = 1; }
    if (g === "fx" || /USD\/CAD|Canadian dollar|\bCAD\b/.test(h)) t.fx = 1;
    if (m.k === "release" || /fx:macro/.test(m.go || "") || /^\s*(US|Canada) /.test(h)) t.macro = 1;
    if (m.k === "policy" || g === "policy" || /Federal Reserve|Bank of Canada|ECB|Bank of England|Bank of Japan|central bank/i.test(h)) t.cb = 1;
    if (m.k === "world" || g === "world") t.world = 1;
    if (g === "briefing" || /Commons|Congress|hearing|House floor|Senate/i.test(h)) t.leg = 1;
    if (g === "earnings" || /earnings/i.test(h)) t.earn = 1;
    if (/WTI crude|\bcrude\b|\bOPEC|\boil (price|output|supply)/i.test(h)) t.energy = 1;
    if (/\b(Gold|Silver)\b/.test(h)) t.metals = 1;
    if (m.k === "alert" && /S&P 500|Nasdaq|Dow Jones|S&P\/TSX|Euro Stoxx|FTSE|US Dollar Index/.test(h)) t.world = 1;
    if (!Object.keys(t).length) t.macro = 1;
    return t;
  }
  function breaking(m) {
    var h = (m.h || "").replace(/<[^>]+>/g, " ");
    /* desk rule: only confirmed intraday breaks, new market-moving announcements, macro prints and central-bank decisions */
    return m.k === "alert" || m.k === "release" || (m.k === "policy" && /statement|decision|HIKE|CUT|HOLD|minutes/i.test(h)) || /Federal Reserve: |Bank of Canada: /.test(h);
  }
  function matches(m, f) { var t = m._t || (m._t = tagsOf(m)); return f === "all" || (f === "agri" ? t.corn || t.wheat || t.soybeans : t[f]); }

  function cardHTML(ctx) {
    var f = pick[ctx] || DEF[ctx] || "all", L = feed(), now = Date.now();
    var cnt = {}; L.forEach(function (m) { TAGS.forEach(function (t) { if (t[0] !== "all" && matches(m, t[0])) cnt[t[0]] = (cnt[t[0]] || 0) + 1; }); });
    var list = L.filter(function (m) { return matches(m, f) && (!ONLY || breaking(m)); });
    var pin = list.filter(function (m) { return breaking(m) && now - m.t < 2 * 3600000; }), rest = list.filter(function (m) { return pin.indexOf(m) < 0; });
    function item(m) {
      var t = m._t || tagsOf(m), b = breaking(m), go = m.go ? ' data-evgo="' + esc(m.go) + '" role="link" tabindex="0"' : "";
      return '<li class="fr-i' + (b ? " br" : "") + (go ? " go" : "") + '"' + go + ">" + (b ? '<span class="fr-bk">BREAKING</span>' : "") + '<div class="fr-h">' + String(m.h).replace(/<div><i>(Why it matters|Source &amp; time)<\/i>[\s\S]*?<\/div>(?=<div><i>|<\/div>$)/g, "") + "</div>" +
        '<div class="fr-m"><span>' + hm(m.t) + " ET</span>" + Object.keys(t).map(function (k) { return '<span class="fr-t" style="--tc:' + TC[k] + '">' + TN[k] + "</span>"; }).join("") + (go ? '<span class="fr-o">Open →</span>' : "") + "</div></li>";
    }
    var dsep = "", body = rest.slice(0, 40).map(function (m) { var d = day(m.t), s = d !== dsep ? '<li class="fr-d">' + (d === day(now) ? "Today" : new Date(m.t).toLocaleDateString("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" })) + "</li>" : ""; dsep = d; return s + item(m); }).join("");
    return '<div class="fr-head"><span class="fr-title">Feed</span><span class="fr-mode"><button data-frmode="1" aria-pressed="' + ONLY + '" title="Confirmed breaks, new market-moving announcements, data prints and central-bank decisions only">⚡ Alerts</button><button data-frmode="0" aria-pressed="' + !ONLY + '" title="Everything the desk logs: data arrivals, OI moves, calendar items">All activity</button></span><span class="fr-live"><i></i>live</span></div>' +
      '<div class="fr-chips" role="tablist">' + TAGS.filter(function (t) { return t[0] === "all" || cnt[t[0]] || t[0] === f || t[0] === DEF[ctx]; }).map(function (t) {
        return '<button data-frf="' + t[0] + '" aria-pressed="' + (f === t[0]) + '"' + (t[0] !== "all" && t[0] !== "agri" ? ' style="--tc:' + TC[t[0]] + '"' : "") + ">" + t[1] + (t[0] === "all" ? "" : " <small>" + (cnt[t[0]] || 0) + "</small>") + "</button>"; }).join("") + "</div>" +
      '<ul class="fr-list">' + (pin.length ? pin.map(item).join("") : "") + (body || (!pin.length ? '<li class="fr-empty">' + (ONLY ? "No alerts for " + esc(TN[f]) + " today. Alerts fire only on a confirmed break (new intraday high/low, 20/50/100/200-day average, ±1σ/±2σ, options put/call wall), a new market-moving announcement, a data print or a central-bank decision." : "Nothing for " + esc(TN[f]) + " yet.") + "</li>" : "")) + "</ul>";
  }

  /* ---------- mounting ---------- */
  var drawer = null, dbtn = null;
  function host() {
    var P = document.querySelector(".tab-panel.active"); if (!P) return null;
    var r = P.querySelector("aside.rail, .rail"); return r || null;
  }
  function paint(force) {
    var ctx = tab(), r = host(), html = cardHTML(ctx);
    if (r) {
      if (drawer) drawer.classList.remove("open"), dbtn && (dbtn.hidden = true);
      var c = r.querySelector(":scope > .fr-card");
      if (!c) { c = document.createElement("div"); c.className = "rail-card fr-card"; r.insertBefore(c, r.firstChild); }
      if (force || c.getAttribute("data-ctx") !== ctx || c._h !== html) { c.innerHTML = html; c._h = html; c.setAttribute("data-ctx", ctx); }
    } else {
      if (!drawer) {
        drawer = document.createElement("aside"); drawer.className = "fr-drawer fr-card"; document.body.appendChild(drawer);
        dbtn = document.createElement("button"); dbtn.type = "button"; dbtn.className = "fr-dbtn"; dbtn.innerHTML = "Feed"; document.body.appendChild(dbtn);
        dbtn.addEventListener("click", function () { drawer.classList.toggle("open"); });
      }
      dbtn.hidden = false;
      if (force || drawer._h !== html || drawer.getAttribute("data-ctx") !== ctx) { drawer.innerHTML = '<button class="fr-close" type="button" aria-label="Close feed">×</button>' + html; drawer._h = html; drawer.setAttribute("data-ctx", ctx); }
      var nb = feed().filter(function (m) { return breaking(m) && Date.now() - m.t < 2 * 3600000; }).length;
      dbtn.innerHTML = "Feed" + (nb ? ' <b>' + nb + "</b>" : "");
    }
  }
  /* breaking items pop a red notification the moment they arrive (not for the items already stored when the page opens) */
  function watch() {
    var L = feed(), sig = L.length + "|" + (L[0] && L[0].id);
    L.forEach(function (m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      if (!firstPass && breaking(m) && window.DESK_LIVE && DESK_LIVE.toast) {
        window.__evNoLog = true;
        try { DESK_LIVE.toast('<span class="fr-tbk">BREAKING</span> ' + (m.k === "alert" ? (m.h.match(/^<b>[\s\S]*?<\/b>/) || [m.h])[0] + ' — ' + ((m.h.match(/<i>Trigger<\/i>([^<]*)/) || [, ''])[1]) : m.h)); } catch (e) {}
        window.__evNoLog = false;
      }
    });
    firstPass = false;
    if (sig !== lastSig) { lastSig = sig; paint(true); } else paint(false);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-frf]"); if (b) { e.preventDefault(); e.stopPropagation(); pick[tab()] = b.getAttribute("data-frf"); paint(true); return; }
    var md = e.target.closest && e.target.closest("[data-frmode]"); if (md) { e.preventDefault(); e.stopPropagation(); ONLY = md.getAttribute("data-frmode") === "1"; try { localStorage.setItem("desk.feedall", ONLY ? "0" : "1"); } catch (x) {} paint(true); return; }
    if (e.target.closest && e.target.closest(".fr-close")) { drawer.classList.remove("open"); return; }
    if (e.target.closest && e.target.closest(".tab-btn")) setTimeout(function () { paint(true); }, 60);
  }, true);
  setInterval(watch, 1000); setTimeout(watch, 800);

  /* alert engine (server, fast lane) -> feed, in the desk format */
  var GO = { corn: "corn:overview", wheat: "wheat:overview", soybeans: "soybeans:overview", fx: "fx:overview", energy: "fx:rates", metals: "world", world: "world", cb: "policy", macro: "briefing", earn: "earnings" };
  function etHM(iso) { var t = Date.parse(iso); return isNaN(t) ? "" : hm(t) + " ET"; }
  function alertHTML(a) {
    var imp = /^Bullish/.test(a.impact) ? "bull" : /^Bearish/.test(a.impact) ? "bear" : "mix";
    return "<b>[" + (a.kind === "news" ? "BREAKING" : "PRICE ALERT") + "] – " + esc(a.head.replace(/^(BREAKING|PRICE ALERT) – /, "")) + "</b>" +
      '<div class="fr-al"><div><i>Trigger</i>' + esc(a.trigger) + "</div>" +
      "<div><i>Market impact</i><span class=\"fr-imp " + imp + "\">" + esc(a.impact) + "</span>" + (a.status ? ' <span class="fr-st">' + esc(a.status) + "</span>" : "") + "</div>" +
      "</div>";
  }
  function ingest(list) {
    if (!window.EVENTS || !EVENTS.log || !list) return;
    list.forEach(function (a) { if (a && a.id && a.head) EVENTS.log("alert", alertHTML(a), GO[a.tag] || "", "al|" + a.id, Date.parse(a.t) || Date.now()); });
  }
  window.addEventListener("desk:alerts", function (e) { ingest(e.detail); });
  setTimeout(function () { ingest(window.DESK_ALERTS); }, 1500);

  var css = document.createElement("style");
  css.textContent =
    "#evRail > .rail-card.ev-feed{display:none}" +
    ".fr-card{padding:12px 14px}.fr-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.fr-title{font:600 12.5px 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}" +
    ".fr-live{font:11.5px 'IBM Plex Mono',monospace;color:#7dd8e6;display:flex;align-items:center;gap:5px}.fr-live i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(63,185,127,.18);animation:frp 2s infinite}@keyframes frp{50%{opacity:.4}}" +
    ".fr-chips{display:flex;flex-wrap:wrap;gap:5px;padding-bottom:8px;border-bottom:1px solid var(--line)}" +
    ".fr-chips button{appearance:none;font:600 11.5px 'IBM Plex Mono',monospace;padding:3px 8px;border-radius:12px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer}" +
    ".fr-chips button small{color:var(--faint);font-weight:400;margin-left:2px}.fr-chips button[aria-pressed=true]{background:#13304a;border-color:var(--tc,var(--cyan));color:#fff}" +
    ".fr-list{list-style:none;margin:0;padding:0;max-height:520px;overflow:auto}.fr-d{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:8px 0 2px}" +
    ".fr-i{padding:8px 6px;border-bottom:1px dashed var(--line);border-radius:6px}.fr-i.go{cursor:pointer}.fr-i.go:hover{background:rgba(56,182,201,.07)}" +
    ".fr-h{font-size:13px;line-height:1.45;color:#d4deea}.fr-h b{color:#fff}.fr-h small{color:var(--muted)}" +
    ".fr-m{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;margin-top:4px;font:11px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".fr-t{border:1px solid var(--tc);color:var(--tc);border-radius:4px;padding:0 5px;font-weight:600}.fr-o{color:#7dd8e6;margin-left:auto}" +
    ".fr-i.br{background:rgba(224,69,58,.10);border:1px solid rgba(224,69,58,.45);border-left:3px solid #e0453a;margin:6px 0}.fr-i.br .fr-h{color:#ffd9d4;font-weight:600}.fr-i.br .fr-h b{color:#fff}" +
    ".fr-bk,.fr-tbk{display:inline-block;font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:#fff;background:#e0453a;border-radius:3px;padding:1px 6px;margin-bottom:4px}" +
    ".fr-empty{font-size:13px;color:var(--muted);padding:10px 0}" +
    ".fr-mode{display:inline-flex;border:1px solid var(--line2);border-radius:12px;overflow:hidden}.fr-mode button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 11px 'IBM Plex Mono',monospace;padding:3px 8px;cursor:pointer}.fr-mode button[aria-pressed=true]{background:#e0453a;color:#fff}.fr-mode button[data-frmode='0'][aria-pressed=true]{background:#13304a}" +
    ".fr-al{margin-top:4px;display:grid;gap:3px;font-size:12.5px;font-weight:400;color:#d4deea}.fr-al i{display:inline-block;min-width:96px;font:normal 600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:#ff9d94;margin-right:6px}.fr-al a{color:#7dd8e6}" +
    ".fr-imp{font:700 11px 'IBM Plex Mono',monospace;padding:0 6px;border-radius:4px}.fr-imp.bull{background:rgba(63,185,127,.2);color:#3fb97f}.fr-imp.bear{background:rgba(224,101,95,.2);color:#ff8a84}.fr-imp.mix{background:rgba(232,163,61,.18);color:#e8a33d}.fr-st{font:11px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".fr-drawer{position:fixed;top:0;right:0;bottom:0;width:min(380px,92vw);z-index:70;background:var(--panel);border-left:1px solid var(--line2);box-shadow:-10px 0 30px rgba(0,0,0,.45);transform:translateX(105%);transition:transform .25s ease;overflow:auto}" +
    ".fr-drawer.open{transform:none}.fr-drawer .fr-list{max-height:none}.fr-close{position:absolute;top:8px;right:10px;appearance:none;border:0;background:transparent;color:var(--faint);font-size:20px;cursor:pointer}" +
    ".fr-dbtn{position:fixed;right:0;top:45%;z-index:69;appearance:none;writing-mode:vertical-rl;transform:rotate(180deg);padding:12px 7px;border:1px solid var(--line2);border-right:0;border-radius:0 8px 8px 0;background:#13304a;color:#bfe3ec;font:600 12px 'IBM Plex Mono',monospace;letter-spacing:.12em;cursor:pointer}" +
    ".fr-dbtn b{writing-mode:horizontal-tb;display:inline-block;background:#e0453a;color:#fff;border-radius:8px;padding:0 5px;margin-top:6px;font-size:11px}";
  document.head.appendChild(css);
  window.FEEDRAIL = { paint: paint, tagsOf: tagsOf, breaking: breaking };
})();
