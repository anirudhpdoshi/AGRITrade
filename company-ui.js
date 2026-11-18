/* Company intelligence workspace (US Earnings tab). Loaded after earnings-ui.js; uses co-engine.js.
   Data arrives live from the AGRITrade SEC Worker when a ticker is LOCKED — nothing is stored: the parsed company is
   kept in page memory for this visit only. Before a ticker is locked, nothing is fetched or shown.

   Worker address (public, not a secret): open the desk once with ?worker=https://<name>.<account>.workers.dev
   — it is remembered in this browser. */
(function () {
  "use strict";
  var E = window.COENGINE; if (!E) return;
  var WK = "desk.secWorker";
  try { var w = new URLSearchParams(location.search).get("worker"); if (w && /^https:\/\/[\w.-]+\.workers\.dev\/?$/.test(w)) localStorage.setItem(WK, w.replace(/\/$/, "")); if (w === "off") localStorage.setItem(WK, "off"); } catch (e) {}
  var DEFAULT_WORKER = "https://agritrade-sec.anirudh-p-doshi.workers.dev";   /* dedicated name so dashboard edits to the "agritrade" project cannot break it; deployed 31 Oct 2026; ?worker=… overrides, ?worker=off disables */
  function worker() { try { var w = localStorage.getItem(WK); return w === "off" ? "" : w || DEFAULT_WORKER; } catch (e) { return DEFAULT_WORKER; } }
  var MEM = {}, card = null, rerender = function () { if (window.EARNINGS) EARNINGS.render(); };
  var C1 = "#1f9db3", C2 = "#c4842a", C3 = "#9468d6", C4 = "#d0607a";   /* validated categorical order (dark surface) */
  function esc(s) { return DeskCore.esc(s); }
  var f$ = E.fmt;
  function pc(v, d) { if (v == null || !isFinite(v)) return "—"; var t = Math.abs(v).toFixed(d == null ? 1 : d); return (+t === 0 ? "" : v > 0 ? "+" : "−") + t + "%"; }
  function pp(v) { return v == null ? "—" : pc(v).replace("%", " pp"); }
  function sgc(v, txt) { return '<span class="' + (v == null || Math.abs(v) < 0.05 ? "neu" : v > 0 ? "up" : "dn") + '">' + txt + "</span>"; }
  function money(v) { return v == null ? "—" : v < 0 ? "−$" + f$(-v) : "$" + f$(v); }
  /* direction that is GOOD for each metric: +1 higher is better, −1 lower is better, 0 neutral (colour by sign is misleading) */
  var GOOD = { eff: -1, npl_pct: -1, nco_pct: -1, prov_pct: -1, prov: -1, nco: -1, npl: -1, nonie: -1, ldr: 0, acl_pct: 0, fee_mix: 0, gdebt: -1, ndebt: -1, dso: -1, dio: -1, ccc: -1, effcost: -1, cashcost: -1, nd_ebitda: -1, de: -1, da_r: -1, intburden: -1, sh_d: -1, cogs: -1,
    capex: 0, sga: 0, rnd: 0, dpo: 0, da: 0, intexp: -1, tax: 0 };
  function tone(k, v) { var base = String(k).replace(/_(yoy|qoq)$/, ""), g = GOOD[base]; return v == null ? null : g === 0 ? 0 : g === -1 ? -v : v; }

  /* ---------------- data ---------------- */
  function search(q) {
    if (!worker()) return Promise.resolve(null);
    return fetch(worker() + "/search?q=" + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) { return j.results || []; });
  }
  /* the company record must be the one asked for (guards against a mixed-up or cached reply) */
  function co_ok(co, t) { if (!co) return false; var k = String(t).toUpperCase(); return String(co.ticker || "").toUpperCase() === k || (co.tickers || []).map(function (x) { return String(x).toUpperCase(); }).indexOf(k) >= 0; }
  /* switching company cancels every request still in flight for the previous one */
  function cancelAll(keep) { Object.keys(MEM).forEach(function (k) { var m = MEM[k]; if (k !== keep && m && m.loading) { try { m.ac && m.ac.abort(); } catch (e) {} delete MEM[k]; } }); }
  function ping(t) { delete READY[t]; try { window.dispatchEvent(new CustomEvent("desk:company", { detail: t })); } catch (e) {} }
  function load(t) {
    if (MEM[t] && (MEM[t].M || MEM[t].loading)) return;
    var ac = typeof AbortController === "function" ? new AbortController() : null, sig = ac ? { signal: ac.signal } : {};
    MEM[t] = { loading: true, ac: ac, t0: Date.now() };
    if (!worker()) { MEM[t] = { err: "nowk" }; return; }
    var a = fetch(worker() + "/company?t=" + encodeURIComponent(t), sig).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
    var b = fetch(worker() + "/prices?r=5y&t=" + encodeURIComponent(t), sig).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([a, b]).then(function (x) {
      if (MEM[t] && MEM[t].ac !== ac) return;   /* superseded or cancelled: never paint a stale reply */
      if (!co_ok(x[0], t)) { MEM[t] = { err: "the reply was for a different company (" + esc(x[0] && x[0].ticker) + ")" }; rerender(); return; }
      var co = x[0], M = E.build(co); MEM[t] = { co: co, M: M, P: x[1], V: E.verdicts(M, x[1]), at: new Date().toISOString() }; rerender(); ping(t); prQuarter(t);
    }).catch(function (e) { if (e && e.name === "AbortError") return; if (MEM[t] && MEM[t].ac !== ac) return; MEM[t] = { err: String(e.message || e) }; rerender(); ping(t); });
  }

  /* ---------------- CSS ---------------- */
  var css = document.createElement("style");
  css.textContent = ".co-skel{border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel)}.co-skh{margin-bottom:10px;font-size:15px}.co-skt{color:var(--muted);font-size:12.5px;margin-left:6px}" +
    ".co-skg{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.co-skc{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}.co-skc.wide{grid-column:1/-1}" +
    ".co-skl{font:700 11px 'IBM Plex Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}" +
    ".co-skc .sk{display:block;height:14px;border-radius:5px;background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.13) 37%,rgba(255,255,255,.05) 63%);background-size:400% 100%;animation:coSk 1.3s ease infinite}" +
    ".co-skc .sk:nth-child(2){width:70%}.co-skc .sk:nth-child(3){width:85%}.co-skc .sk.ch{height:140px}@keyframes coSk{0%{background-position:100% 50%}100%{background-position:0 50%}}" +
    "@media (prefers-reduced-motion:reduce){.co-skc .sk{animation:none}}" +
    ".cx-prs{border:1px solid rgba(224,69,58,.55);border-left:4px solid #e0453a;background:rgba(224,69,58,.08);border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:13px}.cx-prs small{color:var(--muted)}.cx-prs a{color:#7dd8e6}.cx-new.old,.cx-prs.old{border-color:var(--line2);border-left-color:#38b6c9;background:var(--panel2)}.cx-new.old .cx-new-b,.cx-prs.old .cx-new-b{background:#38b6c9;color:#06222a}.cx-new{border:1px solid rgba(224,69,58,.6);border-left:4px solid #e0453a;background:rgba(224,69,58,.09);border-radius:10px;padding:12px 14px;margin-bottom:12px}.cx-new-h{font-weight:700;font-size:14px}.cx-new-b{display:inline-block;font:700 10.5px \"IBM Plex Mono\",monospace;letter-spacing:.1em;background:#e0453a;color:#fff;border-radius:3px;padding:1px 6px;margin-right:6px}.cx-new-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:8px}.cx-new .lab{font:600 10.5px \"IBM Plex Mono\",monospace;text-transform:uppercase;color:var(--muted)}.cx-new .m{font:600 20px \"IBM Plex Mono\",monospace}.cx-new .n{font-size:12.5px;color:var(--muted)}.cx-new .pos{color:#3fb97f}.cx-new .neg{color:#ff8a84}.cx-h{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}.cx-h h2{margin:0}.cx-sub{font-size:12.5px;color:var(--muted)}" +
    ".cx-part{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:16px 0 6px}" +
    ".cx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}" +
    ".cx-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 12px}.cx-id{display:flex;gap:12px;align-items:center;min-width:0}" +
    ".cx-id .tk{font:700 22px 'IBM Plex Mono',monospace;color:var(--amber);letter-spacing:.03em}.cx-id b{display:block;font-size:16px;color:#fff}.cx-id small{color:var(--muted);font-size:12px}" +
    ".cx-vw{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line2);border-radius:9px;padding:2px;background:#05070b}.cx-vw span{font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:0 8px}" +
    ".cx-vw button{appearance:none;border:0;background:transparent;color:var(--muted);font:600 12px 'IBM Plex Sans',sans-serif;padding:5px 12px;border-radius:7px;cursor:pointer}.cx-vw button[aria-pressed=true]{background:var(--amber);color:#101825}" +
    ".rs{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:12px 14px;margin:0 0 14px}.rs-ld{color:var(--muted);font-size:13px;display:flex;gap:8px;align-items:center}" +
    ".rs.fresh{border-color:#38b6c9;background:linear-gradient(180deg,rgba(56,182,201,.13),rgba(56,182,201,.03));box-shadow:0 0 0 1px rgba(56,182,201,.35),0 0 22px rgba(56,182,201,.18)}" +
    ".rs-h{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px}.rs-h b{font-size:15px;color:#fff}.rs-w{font:12px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".rs-b{font:700 10.5px 'IBM Plex Mono',monospace;letter-spacing:.08em;padding:3px 7px;border-radius:4px;background:#2a3446;color:#cfd8e6}.rs.fresh .rs-b{background:#38b6c9;color:#06222a}" +
    ".rs-sc{margin-left:auto;display:flex;gap:6px}.rs-sc i{font:600 11px 'IBM Plex Mono',monospace;font-style:normal;padding:2px 8px;border-radius:999px}.rs-sc .g{color:#3fb97f;background:rgba(63,185,127,.12)}.rs-sc .r{color:#f0675c;background:rgba(224,69,58,.12)}" +
    ".rs-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:8px}" +
    ".rs-t{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px;border:1px solid var(--line2);border-radius:10px;padding:10px 12px;background:#0a0e15}" +
    ".rs-t:hover{transform:translateY(-1px)}.rs-t .l{font:600 10.5px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.rs-t .v{font:600 21px 'IBM Plex Mono',monospace;color:#fff}" +
    ".rs-t .tg{align-self:flex-start;font:700 10.5px 'IBM Plex Mono',monospace;padding:2px 6px;border-radius:4px;background:#2a3446;color:#cfd8e6}.rs-t .s{font-size:11.5px;color:var(--muted);line-height:1.35}" +
    ".rs-t.good{background:rgba(63,185,127,.12);border-color:rgba(63,185,127,.6)}.rs-t.good .tg{background:#3fb97f;color:#06210f}" +
    ".rs-t.bad{background:rgba(224,69,58,.13);border-color:rgba(224,69,58,.65)}.rs-t.bad .tg{background:#e0453a;color:#fff}" +
    ".rs-m{margin-top:10px;border-top:1px solid var(--line);padding-top:10px}.rs-mh{font:600 12px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#fff}.rs-mh small{text-transform:none;letter-spacing:0;color:var(--faint);font-weight:400;margin-left:6px}" +
    ".rs-m h4{margin:8px 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.rs-m ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}.rs-m li{font-size:13px;line-height:1.45;color:#dfe6f0}" +
    ".rs-mn{margin:6px 0 0;font-size:12.5px;color:var(--muted);display:flex;gap:8px;align-items:center}.rs-n{margin-top:10px;font-size:11.5px;color:var(--faint);line-height:1.45}.rs-n a{color:#7dd8e6}" +
    ".cx-card.good{border-left:3px solid #3fb97f;background:linear-gradient(90deg,rgba(63,185,127,.08),transparent 60%),var(--panel)}.cx-card.bad{border-left:3px solid #e0453a;background:linear-gradient(90deg,rgba(224,69,58,.09),transparent 60%),var(--panel)}" +
    ".cx-mt{width:100%;border-collapse:collapse;font:11.5px 'IBM Plex Mono',monospace}.cx-mt td{padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05)}.cx-mt td:nth-child(2),.cx-mt td:nth-child(3){text-align:right}.cx-mt td:first-child{color:var(--faint)}" +
    ".fin-cap{font:700 10px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:var(--faint);align-self:center;padding:0 8px 0 4px}" +
    ".es-bar{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 10px}.es-svg{width:100%;height:auto;display:block;margin:4px 0}.es-ax{fill:#8f9db3;font:10px 'IBM Plex Mono',monospace}.es-xl{fill:#c9d3e0;font:600 10.5px 'IBM Plex Mono',monospace}.es-xl.nx{fill:#e8a33d}" +
    ".es-bg{fill:#3fb97f}.es-bb{fill:#e0453a}.es-bn{fill:#5b6b82}.es-rg{stroke:#8fa3bf;stroke-width:1.5}.es-cs{fill:#e8a33d}" +
    ".es-t th small{display:block;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.06em;color:var(--faint);text-transform:uppercase}.es-t td,.es-t th{text-align:right;white-space:nowrap}.es-t td:first-child,.es-t th:first-child{text-align:left}" +
    ".es-t .es-nx{background:rgba(232,163,61,.08)}.es-t th.es-nx small{color:var(--amber)}.es-t .es-new{background:rgba(56,182,201,.12)}.es-t th.es-new small{color:#7dd8e6}.es-t .es-fy{color:var(--muted)}.es-t tr.es-act td{border-top:1px solid var(--line2)}" +
    ".es-h3{margin:16px 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#fff}.es-h3 small{text-transform:none;letter-spacing:0;color:var(--faint);font-weight:400;margin-left:6px}" +
    ".ow-wrap{display:grid;grid-template-columns:minmax(260px,1.2fr) 1fr;gap:16px;align-items:center}.ow-bub{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;min-height:200px}" +
    ".ow-b{border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}.ow-b b{font:700 14px 'IBM Plex Mono',monospace}.ow-b span{font-size:11px;opacity:.9}" +
    ".ow-k{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ow-k div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#05070b}.ow-k span{display:block;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}.ow-k b{font:600 14px 'IBM Plex Mono',monospace;color:#fff}" +
    "@media (max-width:760px){.ow-wrap{grid-template-columns:1fr}}" +
    ".rs-t.on{outline:2px solid #fff;outline-offset:1px}.rsd{margin-top:10px;border:1px solid var(--line2);border-radius:10px;background:#05070b;padding:12px 14px}" +
    ".rd-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.rd-h b{font-size:15px;color:#fff}.rd-h span{font:11px 'IBM Plex Mono',monospace;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.rd-h .ue-btn:first-of-type{margin-left:auto}" +
    ".rd-g{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.rd-b{border:1px solid var(--line);border-radius:8px;padding:9px 11px;background:#0a0e15;display:flex;flex-direction:column;gap:2px}" +
    ".rd-b span{font:600 10px 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}.rd-b b{font:600 19px 'IBM Plex Mono',monospace;color:#fff}.rd-b small{font:11px 'IBM Plex Mono',monospace;color:var(--muted)}.rd-b i{font:600 12px 'IBM Plex Mono',monospace;font-style:normal}" +
    ".rd-2{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;margin-top:10px;align-items:start}.rd-svg{width:100%;height:auto;display:block}.rd-p{fill:#3a4a60}.rd-c{fill:#38b6c9}.rd-v{fill:#dfe6f0;font:600 11px 'IBM Plex Mono',monospace}.rd-x{fill:#8f9db3;font:10.5px 'IBM Plex Mono',monospace}.rd-x.c{fill:#7dd8e6;font-weight:700}" +
    ".rd-m{stroke:#e8a33d;stroke-dasharray:5 4;stroke-width:1.5}.rd-ml{fill:#e8a33d;font:600 10.5px 'IBM Plex Mono',monospace}.rd-t td,.rd-t th{text-align:right}.rd-t td:first-child,.rd-t th:first-child{text-align:left}.rd-t tr.rd-now td{background:rgba(56,182,201,.1);font-weight:600}" +
    ".cx-grid>.gd{grid-column:1/-1;margin-top:0}.cx-card.on{outline:2px solid #38b6c9;outline-offset:1px}.rsd .stamp{font-size:11.5px;color:var(--faint);line-height:1.45;margin-top:6px}.rd-r{margin:8px 0 0;font-size:13px;color:#dfe6f0;line-height:1.45}@media (max-width:760px){.rd-g{grid-template-columns:1fr 1fr}.rd-2{grid-template-columns:1fr}}" +
    ".mi-b{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}.mi-b li{padding:6px 10px 6px 12px;border-radius:6px;font-size:13px;line-height:1.4;border-left:3px solid #5b6b82;background:#0a0e15}" +
    ".mi-b li.g{border-left-color:#3fb97f;background:rgba(63,185,127,.08)}.mi-b li.r{border-left-color:#e0453a;background:rgba(224,69,58,.09)}.mi-b li.a{border-left-color:#e8a33d;background:rgba(232,163,61,.08)}" +
    ".mi-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:6px}.mi-c{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#05070b}.mi-c h4{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase}" +
    ".mi-c.g h4{color:#3fb97f}.mi-c.r h4{color:#ff7b72}.mi-c.a h4{color:#e8a33d}.mi-c h4 small{color:var(--faint);font-weight:400}.mi-c ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px}" +
    ".mi-c li{font-size:12.5px;line-height:1.45;color:#dfe6f0;padding-left:8px;border-left:2px solid}.mi-c li.g{border-color:#3fb97f}.mi-c li.r{border-color:#e0453a}.mi-c li.a{border-color:#e8a33d}" +
    ".mi-c li em{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;font-style:normal}.mi-c li em i{font:600 9.5px 'IBM Plex Mono',monospace;font-style:normal;padding:1px 6px;border-radius:999px;background:#1a2433;color:#aebbd0}" +
    "@media (max-width:900px){.mi-g{grid-template-columns:1fr}}" +
    "#coDlg{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(2,4,8,.55);backdrop-filter:blur(2px)}#coDlg[hidden]{display:none}" +
    ".cd-box{min-width:300px;max-width:92vw;background:#0b111b;border:1px solid var(--line2);border-radius:12px;padding:16px 18px;box-shadow:0 18px 40px rgba(0,0,0,.6)}" +
    ".cd-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}.cd-h b{font-size:15px;color:#fff}.cd-h span{font:12px 'IBM Plex Mono',monospace;color:var(--muted)}" +
    ".cd-l{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}.cd-l li{display:flex;gap:9px;align-items:center;font-size:13px;color:var(--muted)}.cd-l li span{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;border:1px solid var(--line2)}" +
    ".cd-l li.ok{color:#dfe6f0}.cd-l li.ok span{background:#3fb97f;border-color:#3fb97f;color:#06210f}.cd-l li.na span{border-color:#5b6b82;color:#8f9db3}.cd-l li.wt span{border-color:#e8a33d;border-top-color:transparent;animation:cdS 0.9s linear infinite}" +
    ".cd-l li small{color:var(--faint)}.cd-n{margin:10px 0 0;font-size:12px;color:var(--faint)}@keyframes cdS{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.cd-l li.wt span{animation:none}}" +
    ".mc-d{font-size:13px;color:#cfd8e6;line-height:1.5;margin:0 0 10px}.mc-d small{display:block;color:var(--faint);margin-top:4px}.cx-prof{font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#7dd8e6;border:1px solid rgba(125,216,230,.4);border-radius:4px;padding:2px 7px;margin-left:8px}" +
    ".cx-asof{font:600 9.5px 'IBM Plex Mono',monospace;color:#e8a33d;border:1px solid rgba(232,163,61,.4);border-radius:3px;padding:0 4px;margin-left:4px}" +
    ".cx-part.dim{opacity:.45}.cx-part.dim span{letter-spacing:0;text-transform:none;color:var(--faint)}" +
    "@media (max-width:640px){.rs-g{grid-template-columns:1fr 1fr}.rs-t .v{font-size:18px}.rs-sc{margin-left:0}.cx-vw{width:100%}.cx-vw button{flex:1}}" +
    ".cx-card{appearance:none;text-align:left;font:inherit;color:inherit;cursor:pointer;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:3px;min-height:132px;transition:border-color .12s,transform .12s}" +
    ".cx-card:hover:not(:disabled){border-color:#3d5a80;transform:translateY(-1px)}.cx-card:disabled{cursor:default;opacity:.45;min-height:0;border-style:dashed}" +
    ".cx-card .t{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.cx-card .k{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600}" +
    ".cx-card .q{font-size:11.5px;color:var(--faint);line-height:1.35;margin-top:auto}.cx-card .n{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint)}" +
    ".cx-vd{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;border:1px solid;letter-spacing:.04em}" +
    ".cx-vd.STRONG{color:#3fb97f;border-color:rgba(63,185,127,.6);background:rgba(63,185,127,.1)}.cx-vd.SOLID{color:#7fcfa7;border-color:rgba(63,185,127,.35)}" +
    ".cx-vd.MIXED{color:var(--muted);border-color:var(--line2)}.cx-vd.WEAK,.cx-vd.STRETCHED{color:#e8a33d;border-color:rgba(232,163,61,.5)}" +
    ".cx-vd.NEGATIVE{color:#e0655f;border-color:rgba(224,101,95,.6);background:rgba(224,101,95,.1)}.cx-vd.UNAVAILABLE{color:var(--faint);border-color:var(--line2);border-style:dashed}" +
    ".cx-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.cx-tile{border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:var(--panel2)}" +
    ".cx-tile .l{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}.cx-tile .v{font-family:'IBM Plex Mono',monospace;font-size:17px;font-weight:600;margin:2px 0}" +
    ".cx-tile .s{font-size:11.5px;color:var(--muted);font-family:'IBM Plex Mono',monospace}" +
    ".cx-vg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cx-v{border:1px solid var(--line);border-radius:10px;padding:11px 13px;background:var(--panel2)}" +
    ".cx-v h3{margin:0 0 3px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px}.cx-v .qq{font-size:11.5px;color:var(--faint);margin-bottom:6px}" +
    ".cx-ev{font-size:12.5px;line-height:1.45;padding:3px 0 3px 16px;position:relative}.cx-ev:before{position:absolute;left:0;font-family:'IBM Plex Mono',monospace;font-weight:700}" +
    ".cx-ev.p:before{content:'+';color:var(--green)}.cx-ev.n:before{content:'−';color:var(--red)}.cx-ev small{color:var(--faint);font-family:'IBM Plex Mono',monospace;font-size:10.5px}" +
    "table.cx-hm{border-collapse:separate;border-spacing:3px;width:100%}table.cx-hm td,table.cx-hm th{text-align:center;font-size:11px;padding:6px 4px;border:0}table.cx-hm td{border-radius:4px;font-family:'IBM Plex Mono',monospace;font-weight:600}" +
    "table.cx-hm td.r{text-align:left;font-family:'Libre Franklin',sans-serif;font-weight:400;color:var(--muted);white-space:nowrap}" +
    ".cx-hd{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}" +
    ".cx-hd .big{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600;line-height:1}.cx-hd .lab{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}" +
    ".cx-hd .m{font-family:'IBM Plex Mono',monospace;font-size:13px}" +
    ".cx-sec{margin-top:14px}.cx-sec>.pi-l{margin-bottom:4px}" +
    ".cx-ai{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cx-ai>div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.5;background:var(--panel2)}" +
    ".cx-ai b{display:block;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);margin-bottom:3px}.cx-ai .hyp{color:var(--muted);font-style:italic}" +
    ".cx-st{font-family:'IBM Plex Mono',monospace;font-size:9.5px;padding:1px 5px;border-radius:7px;border:1px solid var(--line2);color:var(--faint);white-space:nowrap}.cx-st.C{border-style:dashed}" +
    "table.mx-t td,table.mx-t th{white-space:nowrap;font-size:12px}table.mx-t .mx-h td{font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);background:rgba(110,168,255,.05);text-align:left}table.mx-t .mx-fy{background:rgba(56,182,201,.06);font-weight:600}table.mx-t td.pos{color:#3fb97f}table.mx-t td.neg{color:#e0655f}" +
    "table.cx-t{width:100%;border-collapse:collapse}table.cx-t td:first-child,table.cx-t th:first-child{text-align:left;font-family:'Libre Franklin',sans-serif}" +
    "details.cx-evd{border:1px solid var(--line);border-radius:8px;padding:8px 11px;margin-top:14px}details.cx-evd summary{cursor:pointer;font-size:12.5px;color:var(--muted)}" +
    ".cx-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin:2px 0 4px}.cx-leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}" +
    ".cx-2{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}@media (min-width:1900px){.cx-2{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}}" +
    "@media (max-width:1100px){.cx-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}.cx-ai{grid-template-columns:1fr 1fr}}@media (max-width:760px){.cx-tiles,.cx-vg,.cx-2,.cx-ai{grid-template-columns:1fr 1fr}.cx-vg,.cx-2{grid-template-columns:1fr}}";
  document.head.appendChild(css);

  /* ---------------- charts (SVG, one axis per chart) ---------------- */
  function axis(min, max) { if (min === max) { max += 1; min -= 1; } var span = max - min, st = Math.pow(10, Math.floor(Math.log10(span / 4))), m = [1, 2, 2.5, 5, 10].map(function (x) { return x * st; }).filter(function (x) { return span / x <= 5; })[0] || st * 10;
    var lo = Math.floor(min / m) * m, hi = Math.ceil(max / m) * m, t = []; for (var v = lo; v <= hi + m / 2; v += m) t.push(+v.toFixed(10)); return { lo: lo, hi: hi, ticks: t }; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function mon(d) { if (!d) return ""; var p = String(d).split("-"); return MON[+p[1] - 1] + " " + p[0]; }
  function dayl(d) { var p = String(d).split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0]; }
  /* two-line x label: fiscal quarter on top, calendar month of the period end below */
  function xl(x, yb, top, end, col) {
    return '<text x="' + x.toFixed(1) + '" y="' + yb + '" text-anchor="middle" font-size="10" fill="' + (col || "var(--muted)") + '">' + esc(top) +
      (end ? '<tspan x="' + x.toFixed(1) + '" dy="12" fill="var(--faint)" font-size="9.5">' + esc(mon(end)) + "</tspan>" : "") + "</text>";
  }
  /* soft red zone below zero whenever the axis includes negative values */
  function negZone(A, y, x0, x1) {
    if (!(A.lo < 0)) return "";
    var a = y(0), b = y(A.lo);
    return '<rect x="' + x0 + '" y="' + a.toFixed(1) + '" width="' + (x1 - x0) + '" height="' + Math.max(0, b - a).toFixed(1) + '" fill="var(--red)" fill-opacity=".17"/>';
  }
  function cols(S, o) {
    o = o || {}; var W = 640, H = (o.h || 190) + 12, pl = 52, pr = 8, pt = 14, pb = 38, vals = S.map(function (s) { return s.v; }).filter(function (v) { return v != null; });
    if (!vals.length) return '<p class="note">No reported values for these quarters.</p>';
    var A = axis(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals))), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); };
    var bw = (W - pl - pr) / S.length, f = o.fmt || f$, out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke-width="1.4" stroke="var(--line2)"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f(t) + "</text>"; });
    var mxI = -1, mx = -Infinity; S.forEach(function (s, i) { if (s.v != null && s.v > mx) { mx = s.v; mxI = i; } });
    S.forEach(function (s, i) { var x = pl + i * bw + bw * 0.18, w = bw * 0.64;
      out += xl(x + w / 2, H - 20, s.label, s.end);
      if (s.v == null) { out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y(0) - 4).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="var(--faint)">n/a</text>'; return; }
      var y0 = y(Math.max(0, s.v)), h = Math.max(1, Math.abs(y(s.v) - y(0))), col = s.v < 0 && o.neg ? o.neg : (o.color || C1), der = s.st === "CALCULATED";
      out += '<rect x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + col + '"' + (der ? ' fill-opacity=".62" stroke="' + col + '" stroke-dasharray="3 2"' : "") + "><title>" + esc(s.label + ": " + f(s.v) + (der ? " (derived from year-to-date filings)" : " (as filed)")) + "</title></rect>";
      if (i === S.length - 1 || i === mxI) out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (s.v >= 0 ? y0 - 4 : y0 + h + 11).toFixed(1) + '" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + f(s.v) + "</text>"; });
    return out + "</svg>";
  }
  function lines(L, o) {
    o = o || {}; var W = 640, H = (o.h || 190) + 12, pl = 46, pr = 64, pt = 12, pb = 36, all = [];
    L.forEach(function (s) { s.S.forEach(function (p) { if (p.v != null) all.push(p.v); }); }); if (o.ref != null) all.push(o.ref);
    if (!all.length) return '<p class="note">No reported values for these quarters.</p>';
    var A = axis(Math.min.apply(null, all.concat(o.zero ? [0] : [])), Math.max.apply(null, all)), n = L[0].S.length, f = o.fmt || function (v) { return pc(v, 0).replace("+", ""); };
    var x = function (i) { return pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pl - pr); }, y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); };
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f(t) + "</text>"; });
    L[0].S.forEach(function (p, i) { out += xl(x(i), H - 19, p.label, p.end); });
    L.forEach(function (s) { var pts = s.S.map(function (p, i) { return p.v == null ? null : [x(i), y(p.v), p]; }), seg = [], segs = [];
      pts.forEach(function (p) { if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; } }); if (seg.length) segs.push(seg);
      segs.forEach(function (g) { out += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" points="' + g.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>'; });
      pts.forEach(function (p) { if (p) out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + s.color + '" stroke="var(--panel)" stroke-width="2"><title>' + esc(s.name + " · " + p[2].label + ": " + f(p[2].v)) + "</title></circle>"; });
      var lp = pts.filter(Boolean).pop(); if (lp) out += '<text x="' + (lp[0] + 8).toFixed(1) + '" y="' + (lp[1] + 3.5).toFixed(1) + '" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + f(lp[2].v) + "</text>"; });
    if (o.ref != null) out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(o.ref).toFixed(1) + '" y2="' + y(o.ref).toFixed(1) + '" stroke="var(--muted)" stroke-dasharray="5 4"/>';
    return (L.length > 1 ? '<div class="cx-leg">' + L.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>" : "") + out + "</svg>";
  }
  function compo(cfo, capex, fcf) {
    var W = 640, H = 222, pl = 52, pr = 8, pt = 12, pb = 38, all = [0];
    cfo.forEach(function (p, i) { if (p.v != null) all.push(p.v); if (capex[i].v != null) all.push(-capex[i].v); if (fcf[i].v != null) all.push(fcf[i].v); });
    var A = axis(Math.min.apply(null, all), Math.max.apply(null, all)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / cfo.length;
    var out = '<div class="cx-leg"><span><i style="background:' + C1 + '"></i>Operating cash flow</span><span><i style="background:' + C2 + '"></i>Capex (shown below zero)</span><span><i style="background:' + C3 + ';border-radius:50%"></i>Free cash flow</span></div><svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Operating cash flow, capex and free cash flow by quarter">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    var fp = [];
    cfo.forEach(function (p, i) { var x = pl + i * bw + bw * 0.2, w = bw * 0.6;
      if (p.v != null) out += '<rect x="' + x.toFixed(1) + '" y="' + y(Math.max(0, p.v)).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(p.v) - y(0))).toFixed(1) + '" rx="3" fill="' + C1 + '"><title>' + esc(p.label + " operating cash flow " + f$(p.v)) + "</title></rect>";
      var c = capex[i].v; if (c != null) out += '<rect x="' + x.toFixed(1) + '" y="' + (y(0) + 2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y(-c) - y(0))).toFixed(1) + '" rx="3" fill="' + C2 + '"><title>' + esc(p.label + " capex " + f$(c)) + "</title></rect>";
      if (fcf[i].v != null) fp.push([x + w / 2, y(fcf[i].v), fcf[i]]);
      out += xl(x + w / 2, H - 20, p.label, p.end); });
    if (fp.length > 1) out += '<polyline fill="none" stroke="' + C3 + '" stroke-width="2" points="' + fp.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>';
    fp.forEach(function (p, k) { out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5" fill="' + C3 + '" stroke="var(--panel)" stroke-width="2"><title>' + esc(p[2].label + " free cash flow " + f$(p[2].v)) + "</title></circle>" +
      (k === fp.length - 1 ? '<text x="' + (p[0] - 8).toFixed(1) + '" y="' + (p[1] - 9).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">FCF ' + money(p[2].v) + "</text>" : ""); });
    return out + "</svg>";
  }
  function waterfall(steps) {
    var W = 640, H = 210, pl = 52, pr = 8, pt = 14, pb = 34, run = 0, bars = [];
    steps.forEach(function (s) { if (s.total) { bars.push({ a: 0, b: s.v, s: s }); run = s.v; } else { bars.push({ a: run, b: run + s.v, s: s }); run += s.v; } });
    var all = [0]; bars.forEach(function (b) { all.push(b.a, b.b); });
    var A = axis(Math.min.apply(null, all), Math.max.apply(null, all)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / bars.length;
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Bridge from net income to operating cash flow">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    bars.forEach(function (b, i) { var x = pl + i * bw + bw * 0.16, w = bw * 0.68, top = y(Math.max(b.a, b.b)), h = Math.max(1, Math.abs(y(b.a) - y(b.b))), col = b.s.total ? C1 : b.s.v >= 0 ? "var(--green)" : "var(--red)";
      out += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + col + '"' + (b.s.total ? "" : ' fill-opacity=".85"') + "><title>" + esc(b.s.name + ": " + f$(b.s.v)) + "</title></rect>" +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (top - 4).toFixed(1) + '" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + (b.s.total ? "" : b.s.v >= 0 ? "+" : "") + f$(b.s.v) + "</text>" +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(b.s.name.split(" ")[0]) + '</text><text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' + esc(b.s.name.split(" ").slice(1).join(" ")) + "</text>"; });
    return out + "</svg>";
  }
  function dfmt(v) { return v.toFixed(0) + "d"; }
  function xfmt(v) { return v.toFixed(1) + "×"; }
  function stack(Q, parts, o) {   /* stacked columns for composition (one axis) */
    o = o || {}; var W = 640, H = (o.h || 190) + 12, pl = 52, pr = 8, pt = 12, pb = 38, tot = Q.map(function (q) { return parts.reduce(function (a, p) { return a + (E.val(q, p[0]) || 0); }, 0); });
    var mx = Math.max.apply(null, tot.concat([0])); if (!mx) return '<p class="note">No composition disclosed.</p>';
    var A = axis(0, mx), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / Q.length;
    var out = '<div class="cx-leg">' + parts.map(function (p) { return '<span><i style="background:' + p[2] + '"></i>' + esc(p[1]) + "</span>"; }).join("") + '</div><svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "composition") + '">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="2 4"/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + f$(t) + "</text>"; });
    Q.forEach(function (q, i) { var x = pl + i * bw + bw * 0.2, w = bw * 0.6, base = 0;
      parts.forEach(function (p) { var v = E.val(q, p[0]); if (!v || v < 0) return; var y1 = y(base + v), y0 = y(base);
        out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(0, y0 - y1 - 2).toFixed(1) + '" rx="2" fill="' + p[2] + '"><title>' + esc(q.fl.label + " " + p[1] + ": " + f$(v)) + "</title></rect>"; base += v; });
      out += xl(x + w / 2, H - 20, q.fl.label, q.end); });
    return out + "</svg>";
  }
  function bars(items, o) {   /* labelled horizontal bars — maturity ladder, peer-style ranking */
    o = o || {}; var mx = Math.max.apply(null, items.map(function (i) { return Math.abs(i.v || 0); }).concat([1]));
    return '<div style="display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;font-size:12.5px">' + items.map(function (i) {
      return "<span>" + esc(i.label) + '</span><span style="background:var(--line);border-radius:3px;height:14px;position:relative"><span style="position:absolute;left:0;top:0;bottom:0;width:' + (i.v == null ? 0 : Math.abs(i.v) / mx * 100).toFixed(1) + "%;background:" + (i.color || C1) + ';border-radius:3px"></span></span><span style="font-family:\'IBM Plex Mono\',monospace">' + (i.v == null ? '<span class="neu">not tagged</span>' : (o.fmt || money)(i.v)) + "</span>"; }).join("") + "</div>";
  }
  /* vertical bars with optional dashed reference line (e.g. today's price) — one axis */
  function vbars(items, o) {
    o = o || {}; var W = 640, H = o.h || 230, pl = 48, pr = 8, pt = 26, pb = 30, f = o.fmt || money;
    var vals = items.map(function (i) { return i.v; }).filter(function (v) { return v != null; }).concat([0]); if (o.ref != null) vals.push(o.ref);
    var A = axis(Math.min.apply(null, vals), Math.max.apply(null, vals)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, bw = (W - pl - pr) / items.length;
    var out = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + (o.axfmt || f)(t) + "</text>"; });
    items.forEach(function (it, i) { var x = pl + i * bw + bw * 0.18, w = bw * 0.64;
      out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="' + (items.length > 8 ? 9.5 : 11) + '" fill="var(--muted)">' + esc(it.label) + "</text>";
      if (it.v == null) return; var top = y(Math.max(0, it.v)), h = Math.max(1, Math.abs(y(it.v) - y(0)));
      out += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + (it.color || C1) + '"' + (it.dim ? ' fill-opacity=".45"' : "") + "><title>" + esc(it.label + ": " + (it.text || f(it.v))) + "</title></rect>" +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (it.v >= 0 ? top - 6 : top + h + 13).toFixed(1) + '" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono,monospace" font-weight="600">' + esc(it.text || f(it.v)) + "</text>"; });
    if (o.ref != null) out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(o.ref).toFixed(1) + '" y2="' + y(o.ref).toFixed(1) + '" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="6 5"><title>' + esc(o.refLabel || f(o.ref)) + "</title></line>";
    return out + "</svg>";
  }
  /* grouped bars: categories × series, one axis */
  function gbars(cats, series, o) {
    o = o || {}; var two = cats.some(function (c) { return String(c).indexOf("|") > 0; }), W = 640, H = (o.h || 220) + (two ? 12 : 0), pl = 52, pr = 8, pt = 18, pb = two ? 40 : 28, all = [0];
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v != null) all.push(v); }); });
    var A = axis(Math.min.apply(null, all), Math.max.apply(null, all)), y = function (v) { return pt + (1 - (v - A.lo) / (A.hi - A.lo)) * (H - pt - pb); }, gw = (W - pl - pr) / cats.length, bw = gw * 0.72 / series.length;
    var out = '<div class="cx-leg">' + series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>"; }).join("") + '</div><svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + esc(o.label || "") + '">';
    out += negZone(A, y, pl, W - pr);
    A.ticks.forEach(function (t) { out += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="var(--line)" ' + (t === 0 ? 'stroke="var(--line2)" stroke-width="1.4"' : 'stroke-dasharray="2 4"') + '/><text x="' + (pl - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--faint)" font-family="IBM Plex Mono,monospace">' + (o.fmt || f$)(t) + "</text>"; });
    cats.forEach(function (c, i) { var gx = pl + i * gw + gw * 0.14;
      series.forEach(function (s, j) { var v = s.vals[i]; if (v == null) return; var x = gx + j * bw, top = y(Math.max(0, v)), h = Math.max(1, Math.abs(y(v) - y(0)));
        out += '<rect x="' + (x + 1).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="' + s.color + '"><title>' + esc(c + " · " + s.name + ": " + (o.fmt || f$)(v)) + "</title></rect>" +
          (cats.length <= 6 ? '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (v >= 0 ? top - 4 : top + h + 11).toFixed(1) + '" text-anchor="middle" font-size="10" fill="var(--ink)" font-family="IBM Plex Mono,monospace">' + (o.lbl || o.fmt || f$)(v) + "</text>" : ""); });
      var cc = String(c).split("|"); out += xl(gx + gw * 0.36, cc[1] ? H - 20 : H - 8, cc[0], cc[1]); });
    return out + "</svg>";
  }
  function spark(S, col) {
    var v = S.map(function (s) { return s.v; }), ok = v.filter(function (x) { return x != null; }); if (ok.length < 2) return "";
    var lo = Math.min.apply(null, ok), hi = Math.max.apply(null, ok), r = hi - lo || 1, W = 120, H = 28;
    var pts = v.map(function (x, i) { return x == null ? null : [(i / (v.length - 1)) * (W - 6) + 3, 3 + (1 - (x - lo) / r) * (H - 6)]; }).filter(Boolean);
    var l = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><polyline fill="none" stroke="' + (col || C1) + '" stroke-width="1.6" points="' + pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/><circle cx="' + l[0].toFixed(1) + '" cy="' + l[1].toFixed(1) + '" r="2.6" fill="' + (col || C1) + '"/></svg>';
  }

  /* ---------------- helpers on the model ---------------- */
  function L(M) { return M.quarters[M.quarters.length - 1]; }
  function S(M, k) { return E.series(M, k, 8); }
  function V(M, k) { return E.val(L(M), k); }
  function stB(m) { if (!m) return '<span class="cx-st">UNAVAILABLE</span>'; return '<span class="cx-st ' + (m.st === "CALCULATED" ? "C" : "") + '" title="' + esc(m.how || "") + '">' + m.st + (m.approx ? " ≈" : "") + "</span>"; }
  function ttmI(M, k) { return E.ttm(M.quarters, M.quarters.length - 1, k); }
  var DEF = {
    nii: ["Net interest income", "Interest earned on loans and securities less interest paid on deposits and borrowings."], nonii: ["Non-interest income", "Fees, commissions, trading and other income that is not interest."],
    nonie: ["Non-interest expense", "Operating costs: compensation, occupancy, technology, other."], prov: ["Provision for credit losses", "Charge to earnings for expected loan losses (CECL)."], nco: ["Net charge-offs", "Loans written off less recoveries."],
    loans_g: ["Gross loans", "Loans and leases before the allowance for credit losses."], deposits: ["Deposits", "Customer deposits — the main funding source."], acl: ["Allowance for credit losses", "Reserve held against expected loan losses."], npl: ["Non-accrual loans", "Loans no longer accruing interest (the US non-performing measure)."],
    nim_a: ["Net interest margin (on assets)", "Net interest income, annualised, as a share of average total assets. Banks report NIM on earning assets, which SEC data does not carry, so this reads lower than the reported figure."],
    eff: ["Efficiency ratio", "Non-interest expense ÷ total net revenue. Lower = more efficient."], fee_mix: ["Fee income share", "Non-interest income ÷ total net revenue."], ldr: ["Loan-to-deposit ratio", "Gross loans ÷ deposits."],
    acl_pct: ["Allowance ÷ loans", "Allowance for credit losses ÷ gross loans."], npl_pct: ["Non-performing (non-accrual) loans", "Non-accrual loans ÷ gross loans — the US counterpart of the GNPA ratio."], acl_npl: ["Allowance ÷ non-performing loans", "How many times the reserve covers non-accrual loans."],
    nco_pct: ["Net charge-off rate", "Net charge-offs, annualised, ÷ gross loans."], prov_pct: ["Provision rate", "Provision for credit losses, annualised, ÷ gross loans."], eq_a: ["Equity ÷ assets", "Shareholders’ equity ÷ total assets (book leverage; not the regulatory CET1 ratio)."],
    roa: ["Return on assets", "Net income, annualised, ÷ average total assets."], wcap: ["Working capital", "Current assets − current liabilities."], inv: ["Inventory", "Inventories at quarter end."], capexint: ["Capex ÷ revenue", "Capital expenditure as a share of revenue."], capexda: ["Capex ÷ depreciation", "Above 1× = growing the asset base."],
    rev: ["Revenue", "Total revenue recognised in the quarter (ASC 606 revenue from contracts with customers, else total revenues)."],
    cogs: ["Cost of revenue", "Direct cost of goods and services sold."], gp: ["Gross profit", "Revenue − cost of revenue."], gm: ["Gross margin", "Gross profit ÷ revenue."],
    sga: ["SG&A", "Selling, general and administrative expense."], rnd: ["R&D", "Research and development expense."], opinc: ["Operating income", "GAAP operating income (loss)."],
    opm: ["Operating margin", "Operating income ÷ revenue."], ebit: ["EBIT", "Operating income; where not tagged, pretax income + interest expense (proxy)."], ebitm: ["EBIT margin (proxy)", "EBIT proxy ÷ revenue."],
    intexp: ["Interest expense", "Interest expense as filed."], da: ["D&A", "Depreciation, depletion and amortisation (cash-flow statement)."],
    ebitda: ["EBITDA", "Operating income + D&A. A calculated, non-GAAP measure."], ebitdam: ["EBITDA margin", "EBITDA ÷ revenue."],
    pretax: ["Pretax income", "Income from continuing operations before tax."], tax: ["Income tax", "Income tax expense (benefit)."], etr: ["Effective tax rate", "Tax ÷ pretax income."],
    ni: ["Net income", "GAAP net income attributable to the company."], nm: ["Net margin", "Net income ÷ revenue."], eps_d: ["Diluted EPS (GAAP)", "GAAP diluted earnings per share."],
    sh_d: ["Diluted shares", "Weighted-average diluted shares outstanding."], sbc: ["Stock-based comp.", "Share-based compensation (cash-flow statement add-back)."],
    cfo: ["Operating cash flow", "Net cash provided by operating activities."], capex: ["Capex", "Purchases of property, plant and equipment."],
    fcf: ["Free cash flow", "Operating cash flow − capex (standard definition; interest is not deducted again)."], fcfm: ["FCF margin", "FCF ÷ revenue."],
    fcfconv: ["FCF conversion", "FCF ÷ net income; N/M when net income ≤ 0."], cfoni: ["Cash conversion", "Operating cash flow ÷ net income."],
    capexint: ["Capex intensity", "Capex ÷ revenue."], gdebt: ["Gross debt", "Short-term borrowings + commercial paper + current and non-current long-term debt (leases excluded)."],
    ndebt: ["Net debt", "Gross debt − cash − short-term investments."], cash: ["Cash", "Cash and cash equivalents."],
    ar: ["Accounts receivable", "Trade receivables, net, at period end."], inv: ["Inventory", "Inventory, net, at period end."], ap: ["Accounts payable", "Trade payables at period end."],
    dso: ["DSO", "Days sales outstanding: average receivables ÷ quarterly revenue × days in the quarter."], dio: ["DIO", "Days inventory outstanding: average inventory ÷ quarterly cost of revenue × days."],
    dpo: ["DPO", "Days payables outstanding: average payables ÷ quarterly cost of revenue × days (cost of revenue proxies supplier purchases)."], ccc: ["Cash conversion cycle", "DSO + DIO − DPO."],
    wc_cf: ["Working-capital cash effect", "−Δreceivables − Δinventory + Δpayables from the cash-flow statement; positive = cash released."],
    allow: ["Doubtful-accounts allowance", "Allowance for credit losses on receivables."], ctrasset: ["Contract assets", "Unbilled revenue recognised ahead of invoicing."],
    defrev: ["Deferred revenue", "Contract liabilities — cash received before revenue is earned."], accr: ["Accrued liabilities", "Accrued expenses at period end."],
    inv_raw: ["Raw materials", "Raw-material inventory."], inv_wip: ["Work in progress", "Work-in-process inventory."], inv_fg: ["Finished goods", "Finished-goods inventory."], invwd: ["Inventory write-downs", "Inventory write-downs charged in the period."],
    capexda: ["Capex ÷ D&A", "Capex relative to depreciation; above 1 = net investment in the asset base."],
    div: ["Dividends", "Cash dividends paid."], buyback: ["Buybacks", "Cash paid to repurchase shares."], acq: ["Acquisitions", "Cash paid for businesses, net of cash acquired."],
    dissue: ["Debt raised", "Proceeds from long-term debt issuance."], drepay: ["Debt repaid", "Repayments of long-term debt."], eqiss: ["Equity issued", "Proceeds from issuing common stock."],
    shret: ["Shareholder return", "Dividends + buybacks."], retained: ["Cash retained", "FCF − dividends − buybacks."],
    stb: ["Short-term borrowings", "Short-term borrowings."], cp: ["Commercial paper", "Commercial paper outstanding."], dcur: ["Current debt", "Debt due within a year."],
    ltd_nc: ["Long-term debt", "Long-term debt, non-current."], oplease: ["Operating leases", "Operating lease liabilities — kept separate from debt."], finlease: ["Finance leases", "Finance lease liabilities — kept separate."],
    effcost: ["Effective interest cost", "Annualised interest expense ÷ average gross debt (opening/closing average — an approximation)."],
    cashcost: ["Cash borrowing cost", "Annualised cash interest paid ÷ average gross debt (approximation)."], intpaid: ["Cash interest paid", "Interest paid in cash."],
    revolver: ["Undrawn credit facilities", "Remaining borrowing capacity under committed lines."],
    int_cov: ["Interest coverage", "TTM EBIT ÷ TTM interest expense."], nd_ebitda: ["Net debt ÷ EBITDA", "Net debt ÷ TTM EBITDA."], ebitda_ttm: ["EBITDA (TTM)", "TTM EBIT + TTM D&A."],
    intburden: ["Cash interest burden", "TTM cash interest ÷ TTM operating cash flow."], fcf_debt: ["FCF ÷ debt", "TTM FCF ÷ gross debt."], fcf_ttm: ["FCF (TTM)", "Sum of the last four quarters."],
    ca: ["Current assets", "Current assets."], cl: ["Current liabilities", "Current liabilities."], wcap: ["Working capital", "Current assets − current liabilities."],
    cr: ["Current ratio", "Current assets ÷ current liabilities."], qr: ["Quick ratio", "(Cash + short-term investments + receivables) ÷ current liabilities."], cashr: ["Cash ratio", "(Cash + short-term investments) ÷ current liabilities."],
    roe: ["ROE", "TTM net income ÷ average equity."], roa: ["ROA", "TTM net income ÷ average total assets."], roic: ["ROIC", "TTM EBIT after tax ÷ (gross debt + equity − cash), period-end — approximate."],
    de: ["Debt ÷ equity", "Gross debt ÷ shareholders’ equity."], da_r: ["Debt ÷ assets", "Gross debt ÷ total assets."], eq: ["Equity", "Shareholders’ equity."], assets: ["Total assets", "Total assets."],
    at: ["Asset turnover", "TTM revenue ÷ average total assets."], invturn: ["Inventory turnover", "TTM cost of revenue ÷ average inventory."], arturn: ["Receivables turnover", "TTM revenue ÷ average receivables."], apturn: ["Payables turnover", "TTM cost of revenue ÷ average payables."],
    core_ni: ["Core net income", "Net income excluding gains/losses on equity investments, after tax at the quarter’s effective rate."], core_eps: ["Core EPS", "Core net income ÷ diluted shares (approximate)."],
    invgain: ["Equity-investment gains/losses", "Gains (losses) on equity securities recognised in net income — often unrealised mark-to-market."],
    rpo: ["Remaining performance obligations", "Contracted revenue not yet recognised (backlog)."], cfoni_ttm: ["Cash conversion (TTM)", "TTM CFO ÷ TTM net income."],
  };
  var DAYS = { dso: 1, dio: 1, dpo: 1, ccc: 1 }, XR = { acl_npl: 1, cr: 1, qr: 1, cashr: 1, de: 1, nd_ebitda: 1, int_cov: 1, at: 1, invturn: 1, arturn: 1, apturn: 1, capexda: 1, cfoni_ttm: 1 };
  function nm(k) { var m = /^(.*)_(yoy|qoq)$/.exec(k); if (m) return nm(m[1]) + (m[2] === "yoy" ? " — YoY" : " — vs prior quarter"); return (DEF[k] || [k])[0]; }
  var PCT2 = { nim_a: 1, nco_pct: 1, prov_pct: 1, acl_pct: 1, npl_pct: 1, roa: 1 };
  var PCT = { nim_a: 1, eff: 1, fee_mix: 1, ldr: 1, acl_pct: 1, npl_pct: 1, nco_pct: 1, prov_pct: 1, eq_a: 1, effcost: 1, cashcost: 1, roe: 1, roa: 1, roic: 1, da_r: 1, intburden: 1, fcf_debt: 1, ebitm: 1, gm: 1, opm: 1, nm: 1, ebitdam: 1, fcfm: 1, etr: 1, capexint: 1, fcfconv: 1 };
  function fv(k, v) { if (v == null) return "—"; var g = /^(.*)_(yoy|qoq)$/.exec(k);
    if (g) { if (DAYS[g[1]]) return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " d"; if (XR[g[1]]) return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "×"; return PCT[g[1]] ? pp(v) : pc(v); }
    if (k === "nd_ebitda" && v < 0) return "net cash"; if (DAYS[k]) return v.toFixed(1) + " d"; if (XR[k]) return v.toFixed(2) + "×"; if (PCT[k]) return v.toFixed(PCT2[k] ? 2 : 1) + "%"; if (k === "eps_d") return "$" + v.toFixed(2); if (k === "cfoni") return v.toFixed(2) + "×"; if (k === "sh_d") return f$(v); return money(v); }

  /* ---------------- interpretation (rule-based, data-referenced; 9-part contract) ---------------- */
  function interp(M, k, extra) {
    var Sx = S(M, k), T = E.trend(Sx), q = L(M), lab = nm(k), y = q.m[k + "_yoy"], p = q.m[k + "_qoq"], isPct = PCT[k];
    var out = { cur: "", hist: "", ind: "", pos: [], neg: [], why: [], impl: "", mon: [], gaps: [] };
    var cur = q.m[k];
    var unitless = isPct || DAYS[k] || XR[k];
    out.cur = cur ? lab + " was " + fv(k, cur.v) + " in " + q.fl.label + (y ? " — " + fv(k + "_yoy", y.v) + " versus " + y.how.replace(/^(vs |change vs )/, "") : "") + (p ? ", " + fv(k + "_qoq", p.v) + " on the previous quarter" : "") + "." + (!unitless && ttmI(M, k) != null ? " Trailing twelve months: " + fv(k, ttmI(M, k)) + "." : "")
      : lab + " is not available for " + q.fl.label + ".";
    if (T.dir === "insufficient") out.hist = "Fewer than three quarters reported — no trend is drawn.";
    else out.hist = "Across " + T.n + " quarters " + lab.toLowerCase() + " has been " + (T.dir === "mixed" ? "uneven" : T.dir) + ": higher than the prior quarter " + T.up + " times, lower " + T.dn + " times. Range " + fv(k, T.lo) + " to " + fv(k, T.hi) +
      (T.atHigh ? " — the latest quarter is the high of the period." : T.atLow ? " — the latest quarter is the low of the period." : ".") + (T.turn ? " Most recent turning point: " + T.turn + "." : "");
    var yS = E.series(M, k + "_yoy", 8).filter(function (s) { return s.v != null; });
    if (!isPct && !DAYS[k] && !XR[k] && yS.length >= 3) { var a = yS[yS.length - 1].v, b = yS[yS.length - 3].v;
      out.hist += " Year-on-year growth " + (a > b + 1 ? "accelerated" : a < b - 1 ? "slowed" : "held steady") + ": " + pc(a) + " now against " + pc(b) + " two quarters earlier."; }
    out.ind = "No industry benchmark is shown yet. Peer medians and percentiles arrive with the industry-comparison phase; none is invented in the meantime.";
    (extra || function () {})(out, M, q);
    var der = Sx.filter(function (s) { return s.st === "CALCULATED"; }).length, miss = Sx.filter(function (s) { return s.v == null; }).map(function (s) { return s.label; });
    if (der) out.gaps.push(der + " of " + Sx.length + " quarters are derived from year-to-date filings (marked with a dashed outline).");
    if (miss.length) out.gaps.push("Not reported for " + miss.join(", ") + ".");
    out.gaps.push("Industry comparison: not yet available.");
    var rel = E.latestRelease(M.co);
    out.mon.unshift("The next quarterly report" + (rel ? " (last earnings release filed " + rel.filed + ")" : "") + ": whether " + lab.toLowerCase() + " " + (T.dir === "rising" ? "keeps rising" : T.dir === "falling" ? "stops falling" : "establishes a direction") + ".");
    return out;
  }
  function aiHTML(o) {
    function li(a) { return a.length ? a.map(function (x) { return "• " + x; }).join("<br>") : "—"; }
    return '<div class="cx-ai">' +
      "<div><b>1 · Current position</b>" + o.cur + "</div><div><b>2 · Historical trend</b>" + o.hist + "</div><div><b>3 · Industry comparison</b>" + o.ind + "</div>" +
      "<div><b>4 · Positive evidence</b>" + li(o.pos) + "</div><div><b>5 · Negative evidence</b>" + li(o.neg) + "</div>" +
      '<div><b>6 · Possible explanations</b><span class="hyp">' + (o.why.length ? li(o.why) + "<br>Hypotheses — the filings do not establish causation." : "No explanation is offered without supporting disclosure.") + "</span></div>" +
      "<div><b>7 · Investor implication</b>" + (o.impl || "—") + "</div><div><b>8 · What to monitor next</b>" + li(o.mon) + "</div><div><b>9 · Data gaps &amp; confidence</b>" + li(o.gaps) + "</div></div>";
  }

  /* ---------------- shared card page pieces ---------------- */
  function head(M, k, unit) {
    var q = L(M), m = q.m[k], y = q.m[k + "_yoy"], p = q.m[k + "_qoq"];
    return prStrip(M, k) + '<div class="cx-hd"><div><div class="lab">' + esc(nm(k)) + " · " + esc(q.fl.label) + " (" + esc(q.end) + ")</div><div class=\"big\">" + fv(k, m && m.v) + "</div></div>" +
      '<div><div class="lab">YoY</div><div class="m">' + (y ? sgc(tone(k, y.v), fv(k + "_yoy", y.v)) : "—") + '</div></div><div><div class="lab">vs prior quarter</div><div class="m">' + (p ? sgc(tone(k, p.v), fv(k + "_qoq", p.v)) : "—") + "</div></div>" +
      (!PCT[k] && !DAYS[k] && !XR[k] && ttmI(M, k) != null ? '<div><div class="lab">TTM</div><div class="m">' + fv(k, ttmI(M, k)) + "</div></div>" : "") +
      '<div><div class="lab">Status</div><div class="m">' + stB(m) + '</div></div><div><div class="lab">Unit</div><div class="m">' + (unit || (PCT[k] ? "%" : DAYS[k] ? "days" : XR[k] ? "times" : "USD")) + "</div></div></div>";
  }
  function table(M, keys) {
    var Q = M.quarters.slice(-8);
    return '<div class="tbl-scroll"><table class="cx-t"><thead><tr><th>Eight quarters</th>' + Q.map(function (q) { return "<th>" + esc(q.fl.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      keys.map(function (k) { return "<tr><td>" + esc(nm(k)) + "</td>" + Q.map(function (q) { var m = q.m[k]; return "<td" + (m && m.st === "CALCULATED" ? ' class="calc" title="' + esc(m.how || "") + '"' : "") + ">" + (m ? fv(k, m.v) : '<span class="neu">—</span>') + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</tbody></table></div><div class=\"stamp\" style=\"margin-top:6px\">Italic = derived from year-to-date filings (see evidence). “—” = not filed for that quarter; never estimated.</div>";
  }
  function annualT(M, keys) {
    var A = M.annual; if (!A.length) return '<p class="note">No full-year filings in the window.</p>';
    return '<div class="tbl-scroll"><table class="cx-t"><thead><tr><th>Fiscal year</th>' + A.map(function (a) { return "<th>FY" + a.fy + "</th>"; }).join("") + (A.length >= 3 ? "<th>CAGR</th>" : "") + "</tr></thead><tbody>" +
      keys.filter(function (k) { return A.some(function (a) { return a.m[k]; }); }).map(function (k) {
        var f0 = A[0].m[k], f1 = A[A.length - 1].m[k], cg = f0 && f1 && f0.v > 0 && f1.v > 0 ? (Math.pow(f1.v / f0.v, 1 / (A.length - 1)) - 1) * 100 : null;
        return "<tr><td>" + esc(nm(k)) + "</td>" + A.map(function (a) { return "<td>" + (a.m[k] ? fv(k, a.m[k].v) : "—") + "</td>"; }).join("") + (A.length >= 3 ? "<td>" + (cg == null ? "n/m" : pc(cg)) + "</td>" : "") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  function evidence(M, keys) {
    var q = L(M), co = M.co;
    function link(src) { if (!src || !src.a) return ""; return ' · <a href="https://www.sec.gov/Archives/edgar/data/' + (+co.cik) + "/" + src.a.replace(/-/g, "") + "/" + src.a + '-index.htm" target="_blank" rel="noopener noreferrer">' + esc(src.f) + " filed " + esc(src.d) + " ↗</a>"; }
    return '<details class="cx-evd"><summary>Data &amp; evidence — sources, formulas, status, confidence</summary><div class="tbl-scroll"><table class="cx-t" style="margin-top:8px"><thead><tr><th>Metric</th><th>Definition / formula</th><th>' + esc(q.fl.label) + "</th><th>Status</th><th>Source</th></tr></thead><tbody>" +
      keys.map(function (k) { var m = q.m[k]; return "<tr><td>" + esc(nm(k)) + '</td><td style="white-space:normal;text-align:left;font-family:inherit;font-size:12px">' + esc((DEF[k] || ["", ""])[1]) + (m && m.how ? "<br><i>" + esc(m.how) + "</i>" : "") + "</td><td>" + (m ? fv(k, m.v) : "—") + "</td><td>" + stB(m) +
        (m && m.src && m.src.restated ? ' <span class="cx-st" style="color:var(--amber)">RESTATED</span>' : "") + '</td><td style="white-space:normal;text-align:left;font-family:inherit;font-size:12px">' + (m && m.tag ? "<code>us-gaap:" + esc(m.tag) + "</code>" + link(m.src) + (m.src2 ? link(m.src2) : "") : m && m.inputs ? "calculated from " + esc(m.inputs.map(nm).join(", ")) : "not filed") + "</td></tr>"; }).join("") +
      '</tbody></table></div><div class="stamp">SEC EDGAR XBRL company facts for ' + esc(co.name) + " (CIK " + esc(co.cik) + "), fetched live " + esc(new Date(co.fetched_at || Date.now()).toLocaleString()) + ". Reported = filed figure; Calculated = derived by the stated formula; Unavailable = not filed, never estimated. GAAP throughout — adjusted (non-GAAP) figures are not in the structured filings.</div></details>";
  }

  /* ---------------- card catalogue ---------------- */
  var PARTS = [   /* owner, Nov 17 2026: every financial item labelled under Income statement · Balance sheet · Cash flow */
    ["Company overview", [["snap", "Company snapshot", "Size, growth, profitability and financial structure at a glance.", "rev"], ["verdicts", "Four financial verdicts", "Earnings quality · outlook · resilience · market implication.", null], ["health", "Eight-quarter health history", "Consistently strong, weak, or changing?", null]]],
    ["Income statement", [["fin-is", "Income statement", "Every line, every quarter, with YoY and QoQ.", "rev"], ["revenue", "Revenue intelligence", "Is growth accelerating or slowing?", "rev"], ["gross", "Cost of revenue & gross profit", "Is the company keeping more of each dollar after direct costs?", "gm"], ["operating", "Operating profitability", "Is growth producing operating leverage?", "opm"], ["eps", "Net income & EPS", "Is earnings growth operating, tax, buyback or adjustment driven?", "eps_d"], ["matrix", "Fiscal year vs fiscal year", "Full-year totals side by side.", "rev"]]],
    ["Balance sheet", [["fin-bs", "Balance sheet", "Assets, liabilities and equity at each quarter end.", "assets"], ["wc-ar", "Receivables & collection", "Are customers taking longer to pay?", "dso"], ["wc-inv", "Inventory efficiency", "Is inventory building faster than demand?", "dio"], ["wc-ap", "Payables & supplier financing", "Better terms, or delayed payments?", "dpo"], ["wc-ccc", "Cash conversion cycle", "How long is cash tied up in operations?", "ccc"],
      ["debt", "Debt structure", "How is the company financed?", "gdebt"], ["costdebt", "Blended cost of debt", "Is borrowing getting more expensive?", "effcost"], ["maturity", "Maturities & refinancing", "Is a large refinancing coming?", null], ["service", "Debt servicing capacity", "Can earnings and cash carry the debt?", "int_cov"], ["liq", "Liquidity", "Can it meet short-term obligations?", "cr"], ["lev", "Leverage & solvency", "Is leverage rising faster than earnings?", "nd_ebitda"]]],
    ["Cash flow", [["fin-cf", "Cash flow statement", "Operating, investing and financing cash, every quarter.", "cfo"], ["cfo", "Operating cash flow", "Does accounting profit turn into cash?", "cfo"], ["fcf", "Free cash flow", "Cash left after investing in the asset base?", "fcf"], ["capex", "Capital expenditure", "Investing for growth or maintaining?", "capex"], ["alloc", "Capital allocation", "Where is the cash going?", "shret"]]],
    ["Estimates", [["est", "Street estimates vs actuals", "Consensus mean, high and low against what was reported, and what is expected next.", null]]],
    ["Ownership", [["own", "Ownership", "Institutions, insiders and the largest holders.", null]]],
    ["Valuation & market", [["val-snap", "Investment snapshot", "Valuation, positives, concerns and what to watch.", null], ["val-scn", "Scenario values", "Bear / base / bull on assumptions you can edit.", null],
      ["val-pe", "Multiple sensitivity", "What each turn of P/E is worth per share.", null], ["val-rx", "Earnings-day reactions", "How the stock moved on each report, and its worst days.", null]]],
    ["Ratios & warnings", [["returns", "Profitability & returns", "Better returns on the capital deployed?", "roe"], ["eff", "Efficiency", "Is the asset base working harder?", "at"], ["warn", "Early-warning signals", "Twelve rules, with persistence and evidence.", null]]],
    ["Industry comparison", [["peers", "Peer benchmarks", "Industry median, percentile and named competitors."]]],
    ["Earnings intelligence", [["guide", "Guidance & revisions"], ["mgmt", "Management commentary"], ["aieco", "AI economics"]]],
  ];
  var BUILT = { "b-nii": 1, "b-nim": 1, "b-fee": 1, "b-eff": 1, "b-prov": 1, "b-loans": 1, "b-dep": 1, "b-ldr": 1, "b-npl": 1, "b-nco": 1, "b-provr": 1, "b-acl": 1, "b-cov": 1, "b-cap": 1, "b-roa": 1,
    "m-ebitda": 1, "m-capint": 1, "m-capda": 1, "a-inv": 1, "a-wcap": 1, matrix: 1, "fin-is": 1, "fin-bs": 1, "fin-cf": 1, est: 1, own: 1, "val-snap": 1, "val-scn": 1, "val-pe": 1, "val-rx": 1, snap: 1, verdicts: 1, health: 1, revenue: 1, gross: 1, operating: 1, eps: 1, cfo: 1, fcf: 1, "wc-ar": 1, "wc-inv": 1, "wc-ap": 1, "wc-ccc": 1, capex: 1, alloc: 1, debt: 1, costdebt: 1, maturity: 1, service: 1, liq: 1, returns: 1, lev: 1, eff: 1, warn: 1 };
  /* ---- industry tile sets (owner, Nov 17 2026): the tiles follow how each industry is analysed. Banks are read through
     net interest income, margin, loan and deposit growth, asset quality and capital; miners through cost, capital
     intensity and leverage; agribusiness through thin margins, commodity inventory and working-capital financing. ---- */
  function profileOf(M) {
    var s = +(M.co && M.co.sic) || 0, q = M.quarters[M.quarters.length - 1] || { m: {} };
    if (q.m.nii && q.m.loans_g) return "bank";
    if ((s >= 1000 && s <= 1499) || (s >= 2911 && s <= 2999)) return "mining";
    if ((s >= 100 && s <= 999) || (s >= 2000 && s <= 2099) || (s >= 2870 && s <= 2879) || (s >= 5150 && s <= 5159) || s === 5191) return "agri";
    return "general";
  }
  var PROFILE_NAME = { bank: "Bank", mining: "Mining & energy", agri: "Agribusiness & food", general: "General" };
  var SHARED = { est: ["Estimates", [["est", "Street estimates vs actuals", "Consensus mean, high and low against what was reported, and what is expected next.", null]]],
    own: ["Ownership", [["own", "Ownership", "Institutions, insiders and the largest holders.", null]]],
    val: ["Valuation & market", [["val-snap", "Investment snapshot", "Valuation, positives, concerns and what to watch.", null], ["val-scn", "Scenario values", "Bear / base / bull on assumptions you can edit.", null],
      ["val-pe", "Multiple sensitivity", "What each turn of P/E is worth per share.", null], ["val-rx", "Earnings-day reactions", "How the stock moved on each report, and its worst days.", null]]] };
  var PARTS_BANK = [
    ["Company overview", [["snap", "Company snapshot", "Size, growth, profitability and financial structure at a glance.", "rev"], ["b-roa", "Return on assets", "Annualised net income on average assets.", "roa"]]],
    ["Income statement", [["fin-is", "Income statement", "Every line, every quarter, with YoY and QoQ.", "rev"], ["b-nii", "Net interest income", "Is the core lending spread growing?", "nii"], ["b-nim", "Net interest margin", "Is the margin on the balance sheet widening or narrowing?", "nim_a"],
      ["b-fee", "Fee & other non-interest income", "How much of revenue comes from fees, trading and markets?", "nonii"], ["b-eff", "Efficiency ratio", "Cost per dollar of revenue — lower is better.", "eff"], ["b-prov", "Provision for credit losses", "How much is being set aside for expected loan losses?", "prov"], ["eps", "Net income & EPS", "What reaches shareholders?", "eps_d"]]],
    ["Loans & deposits", [["fin-bs", "Balance sheet", "Loans, deposits, allowance and capital at each quarter end.", "assets"], ["b-loans", "Loan growth", "Is the loan book growing?", "loans_g"], ["b-dep", "Deposit growth", "Is the funding base growing?", "deposits"], ["b-ldr", "Loan-to-deposit ratio", "How much of the deposit base is lent out?", "ldr"]]],
    ["Asset quality", [["b-npl", "Non-performing (non-accrual) loans", "Share of loans no longer accruing interest — the US measure behind GNPA.", "npl_pct"], ["b-nco", "Net charge-off rate", "Loans written off after recoveries, annualised.", "nco_pct"],
      ["b-provr", "Provision rate", "Provision for credit losses as a share of loans, annualised.", "prov_pct"], ["b-acl", "Allowance / loans", "Reserve held against the loan book.", "acl_pct"], ["b-cov", "Allowance / non-performing loans", "How many times the reserve covers bad loans.", "acl_npl"]]],
    ["Capital & returns", [["b-cap", "Equity / assets", "Book capital against the balance sheet (not the regulatory CET1 ratio).", "eq_a"], ["returns", "Return on equity", "Annualised net income on equity.", "roe"]]],
    SHARED.est, SHARED.own, SHARED.val,
    ["Regulatory & disclosed only", [["cet1", "CET1 / Tier 1 capital ratio"], ["nim-rep", "Reported NIM (earning assets)"], ["depcost", "Deposit costs & mix"]]]];
  var PARTS_MINING = [
    ["Company overview", [["snap", "Company snapshot", "Size, growth, profitability and financial structure at a glance.", "rev"], ["verdicts", "Four financial verdicts", "Earnings quality · outlook · resilience · market implication.", null], ["health", "Eight-quarter health history", "Consistently strong, weak, or changing?", null]]],
    ["Income statement", [["fin-is", "Income statement", "Every line, every quarter, with YoY and QoQ.", "rev"], ["revenue", "Revenue intelligence", "Price- and volume-driven growth?", "rev"], ["gross", "Cost of sales & gross margin", "Are site costs rising faster than revenue?", "gm"], ["m-ebitda", "EBITDA margin", "Cash earnings before the heavy depreciation of mines and wells.", "ebitdam"], ["operating", "Operating profitability", "Operating leverage to prices?", "opm"], ["eps", "Net income & EPS", "What reaches shareholders?", "eps_d"]]],
    ["Capital intensity & cash flow", [["fin-cf", "Cash flow statement", "Operating, investing and financing cash, every quarter.", "cfo"], ["capex", "Capital expenditure", "Sustaining or growing the asset base?", "capex"], ["m-capint", "Capex / revenue", "Share of revenue re-invested.", "capexint"], ["m-capda", "Capex / depreciation", "Above 1× = expanding, below = harvesting.", "capexda"], ["fcf", "Free cash flow", "Cash left after investing?", "fcf"], ["alloc", "Capital allocation", "Dividends, buybacks, debt repayment?", "shret"]]],
    ["Balance sheet & leverage", [["fin-bs", "Balance sheet", "Assets, liabilities and equity at each quarter end.", "assets"], ["debt", "Debt structure", "How is the company financed?", "gdebt"], ["lev", "Net debt / EBITDA", "Leverage through the commodity cycle.", "nd_ebitda"], ["service", "Debt servicing capacity", "Interest cover at today's prices?", "int_cov"], ["maturity", "Maturities & refinancing", "Is a large refinancing coming?", null], ["liq", "Liquidity", "Can it meet short-term obligations?", "cr"]]],
    ["Returns & warnings", [["returns", "Profitability & returns", "Return on capital deployed in the ground?", "roe"], ["warn", "Early-warning signals", "Twelve rules, with persistence and evidence.", null]]],
    SHARED.est, SHARED.own, SHARED.val,
    ["Disclosed by the company only", [["prod", "Production volumes"], ["ucost", "Unit cash costs (C1 / AISC / lifting cost)"], ["resv", "Reserves & resources"]]]];
  var PARTS_AGRI = [
    ["Company overview", [["snap", "Company snapshot", "Size, growth, profitability and financial structure at a glance.", "rev"], ["verdicts", "Four financial verdicts", "Earnings quality · outlook · resilience · market implication.", null], ["health", "Eight-quarter health history", "Consistently strong, weak, or changing?", null]]],
    ["Income statement", [["fin-is", "Income statement", "Every line, every quarter, with YoY and QoQ.", "rev"], ["revenue", "Revenue intelligence", "Price pass-through or volume?", "rev"], ["gross", "Gross margin (thin-margin trade)", "Are processing and merchandising margins holding?", "gm"], ["operating", "Operating profitability", "Is scale producing leverage?", "opm"], ["eps", "Net income & EPS", "What reaches shareholders?", "eps_d"]]],
    ["Commodity inventory & working capital", [["wc-inv", "Inventory days", "Commodity stocks carried — the core risk and financing need.", "dio"], ["a-inv", "Inventory value", "Dollar value of commodity inventories.", "inv"], ["wc-ar", "Receivables & collection", "Are customers taking longer to pay?", "dso"], ["wc-ap", "Payables & supplier financing", "Farmer and supplier terms.", "dpo"], ["wc-ccc", "Cash conversion cycle", "How long is cash tied up in grain?", "ccc"], ["a-wcap", "Working capital", "Current assets less current liabilities.", "wcap"]]],
    ["Balance sheet & financing", [["fin-bs", "Balance sheet", "Assets, liabilities and equity at each quarter end.", "assets"], ["debt", "Debt structure", "Short-term borrowing funds the inventory.", "gdebt"], ["costdebt", "Blended cost of debt", "Is carrying inventory getting more expensive?", "effcost"], ["service", "Debt servicing capacity", "Can earnings carry the debt?", "int_cov"], ["liq", "Liquidity", "Can it meet short-term obligations?", "cr"], ["lev", "Leverage & solvency", "Is leverage rising faster than earnings?", "nd_ebitda"]]],
    ["Cash flow", [["fin-cf", "Cash flow statement", "Operating, investing and financing cash, every quarter.", "cfo"], ["cfo", "Operating cash flow", "Working-capital swings drive this line.", "cfo"], ["fcf", "Free cash flow", "Cash left after investing?", "fcf"], ["capex", "Capital expenditure", "Plants, elevators, logistics?", "capex"], ["alloc", "Capital allocation", "Where is the cash going?", "shret"]]],
    ["Returns & warnings", [["returns", "Profitability & returns", "Return on a heavy working-capital base?", "roe"], ["warn", "Early-warning signals", "Twelve rules, with persistence and evidence.", null]]],
    SHARED.est, SHARED.own, SHARED.val,
    ["Disclosed by the company only", [["seg", "Segment results (crush, origination, nutrition)"], ["rmi", "Readily marketable inventories"], ["vol", "Volumes handled"]]]];
  function partsOf(M) { var p = M ? profileOf(M) : "general"; return p === "bank" ? PARTS_BANK : p === "mining" ? PARTS_MINING : p === "agri" ? PARTS_AGRI : PARTS; }
  /* one card for every ratio tile that has no dedicated card: what it is, how it is calculated, then the detail panel */
  function metricCard(id, k) {
    return function (M) {
      var lab = cardTitle(id) || nm(k), def = DEF[k] || [], q = L(M), m = q.m[k];
      return shell(M, id, '<p class="mc-d">' + esc(def[1] || "") + (m && m.how ? ' <small>Calculated: ' + esc(m.how) + ".</small>" : "") + "</p>" + gDetail(M, id, k, lab, true));
    };
  }
  function cardTitle(id) { var t = ""; PARTS.concat(PARTS_BANK, PARTS_MINING, PARTS_AGRI).forEach(function (p) { p[1].forEach(function (c) { if (c[0] === id) t = c[1]; }); }); return t; }

  /* press-release figures (8-K exhibit 99.1, read by the fast lane minutes after filing) for a quarter not yet in XBRL */
  /* a release is "ahead of the filings" only when the latest filed quarter is the one BEFORE it: a release comes ~3–8 weeks
     after its quarter ends, so once the reported quarter is filed (release − quarter end < ~75 days) the cards are current */
  function afterFiled(relDate, qEnd) { return (Date.parse(relDate + "T12:00:00Z") - Date.parse(qEnd + "T12:00:00Z")) / 864e5 > 75; }
  /* ---- press-release statements (owner, Nov 17 2026): between the earnings release and the 10-Q/10-K, the release's own
     condensed income statement, balance sheet and cash-flow statement stand in for the new quarter, so every tile (inventory,
     receivables, debt, cash flow…) moves to that quarter instead of staying a quarter behind. Unaudited; marked with *. ---- */
  var MONIX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
  function prStatements(html) {
    var doc = new DOMParser().parseFromString(html, "text/html"), out = { is: {}, bs: {}, cf: {}, py: {} }, ends = [];
    function txt(n) { return (n.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim(); }
    function num(c) { var x = c.replace(/[$,\s]/g, ""); if (/^[—–-]+$/.test(x)) return 0; var neg = /^\(.*\)$/.test(x) || /^\(/.test(x); x = x.replace(/[()]/g, ""); return /^-?\d+(\.\d+)?$/.test(x) ? (neg ? -1 : 1) * +x : null; }
    var lastKind = null;
    [].forEach.call(doc.querySelectorAll("table"), function (T) {
      var rows = [].map.call(T.querySelectorAll("tr"), function (tr) { return [].map.call(tr.querySelectorAll("td,th"), txt).filter(function (c) { return c && c !== "$" && c !== ")" && c !== "%"; }); }).filter(function (r) { return r.length; });
      var all = rows.map(function (r) { return r.join(" "); }).join(" | ").toLowerCase(), prev = "", el = T;
      for (var i = 0; i < 6 && el; i++) { el = el.previousElementSibling; if (el) prev = txt(el).toLowerCase() + " " + prev; }
      var unit = /in thousands/.test(all + prev) ? 1e3 : /in billions/.test(all + prev) ? 1e9 : /in millions/.test(all + prev) ? 1e6 : null;
      var kind = /total assets/.test(all) && /total liabilities/.test(all) ? "bs" : /operating activities/.test(all) && /investing activities/.test(all) ? "cf" : /net income|net earnings/.test(all) && /revenue|net sales/.test(all) && /per share/.test(all) && /cost of/.test(all) ? "is" : null;
      var cont = false;
      if (!kind && lastKind === "cf" && /financing activities|dividends paid|repurchase/.test(all)) { kind = "cf"; cont = true; }   /* the statement continues in the next table */
      if (!kind) { if (rows.some(function (r) { return r.some(function (c) { return num(c) != null; }); })) lastKind = null; return; }
      if (!cont && out[kind]._done) return;
      var fr = 0; while (fr < rows.length && !rows[fr].some(function (c) { return num(c) != null && !/^20\d\d$/.test(c.replace(/[,\s]/g, "")); })) fr++;   /* header = the rows before the first figure */
      var hd = rows.slice(0, Math.max(4, fr)).map(function (r) { return r.join(" "); }).join(" ").toLowerCase() + " " + prev.slice(-300);
      if (!cont && kind !== "bs" && !/three months|quarter ended|thirteen weeks|fourteen weeks/.test(hd)) return;   /* only a three-month column */
      lastKind = kind;
      var dm = hd.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/), yr = hd.match(/\b(20\d\d)\b/);
      if (dm && yr && !cont) { var dd = dm[0].split(/\s+/), dt = new Date(Date.UTC(+yr[1], MONIX[dd[0]], +dd[1])); ends.push(dt.toISOString().slice(0, 10)); }
      var u = unit || 1e6, L = out[kind], sec = "";
      /* income statement: the second column is the same quarter a year earlier when the header's second date is a year back */
      var hds = (hd.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/g) || []), hys = hd.match(/\b20\d\d\b/g) || [];
      var pyCol = kind === "is" && hys.length >= 2 && +hys[1] === +hys[0] - 1 && hds.length >= 2;
      rows.forEach(function (r) {
        var lab = (r.filter(function (c) { return num(c) == null; })[0] || "").toLowerCase().replace(/:$/, "").trim(), nums = r.map(num).filter(function (v) { return v != null; });
        if (!nums.length) { if (lab) sec = lab; return; }
        var v = nums[0], v1 = nums.length > 1 ? nums[1] : null;
        function put(k, x) { if (L[k] == null) { L[k] = x; if (kind === "is" && pyCol && v1 != null && out.py[k] == null) out.py[k] = k === "eps_d" ? v1 : v1 * u; } }
        if (kind === "bs") {
          if (/^cash and cash equivalents$/.test(lab)) put("cash", v * u);
          else if (/^(marketable (debt )?securities|short-term investments)/.test(lab)) put("sti", v * u);
          else if (/^accounts receivable/.test(lab)) put("ar", v * u);
          else if (/^inventor(y|ies)(, net)?$/.test(lab)) put("inv", v * u);
          else if (/^total current assets$/.test(lab)) put("ca", v * u);
          else if (/^total assets$/.test(lab)) put("assets", v * u);
          else if (/^accounts payable$/.test(lab)) put("ap", v * u);
          else if (/^accrued (and other current )?liabilities|^accrued expenses/.test(lab)) put("accr", v * u);
          else if (/^(short-term debt|current portion of long-term debt|short-term borrowings)/.test(lab)) put("dcur", v * u);
          else if (/^total current liabilities$/.test(lab)) put("cl", v * u);
          else if (/^long-term debt/.test(lab)) put("ltd_nc", v * u);
          else if (/^total liabilities$/.test(lab)) put("liab", v * u);
          else if (/^total (shareholders|stockholders)['’]? equity$|^(shareholders|stockholders)['’]? equity$/.test(lab)) put("eq", v * u);
        } else if (kind === "cf") {
          if (/^net cash provided by (\(used in\) )?operating activities|^net cash (from|provided by) operating/.test(lab)) put("cfo", v * u);
          else if (/^(purchases (related to|of) property|capital expenditures|purchases of property)/.test(lab)) put("capex", Math.abs(v) * u);
          else if (/^depreciation and amortization/.test(lab)) put("da", v * u);
          else if (/stock-based compensation|share-based compensation/.test(lab)) put("sbc", v * u);
          else if (/^dividends paid/.test(lab)) put("div", Math.abs(v) * u);
          else if (/repurchases? of common stock/.test(lab)) put("buyback", Math.abs(v) * u);
        } else {
          if (/^(total )?(revenue|revenues|net revenue|net revenues|net sales|total net sales|total net revenue)$/.test(lab)) put("rev", v * u);
          else if (/^cost of (revenue|sales|goods sold)/.test(lab)) put("cogs", v * u);
          else if (/^gross (profit|margin)$/.test(lab)) put("gp", v * u);
          else if (/^research and development/.test(lab)) put("rnd", v * u);
          else if (/^(sales|selling), general and administrative/.test(lab)) put("sga", v * u);
          else if (/^(operating income|income from operations)( \(loss\))?$/.test(lab)) put("opinc", v * u);
          else if (/^income before income tax/.test(lab)) put("pretax", v * u);
          else if (/^income tax (expense|provision)/.test(lab)) put("tax", v * u);
          else if (/^net (income|earnings)( \(loss\))?$/.test(lab)) put("ni", v * u);
          else if (/^diluted$/.test(lab) && /per share/.test(sec) && Math.abs(v) < 1000) put("eps_d", v);
          else if (/^diluted$/.test(lab) && /shares/.test(sec) && Math.abs(v) >= 1) put("sh_d", v * u);
        }
      });
      L._done = Object.keys(L).length > 2;
    });
    ["is", "bs", "cf"].forEach(function (k) { delete out[k]._done; });
    var I = out.is, Y = out.py; if (I.rev) { if (I.gp == null && I.cogs != null) I.gp = I.rev - I.cogs; if (I.gp != null) I.gm = I.gp / I.rev * 100; if (I.opinc != null) I.opm = I.opinc / I.rev * 100; }
    if (Y.rev) { if (Y.gp == null && Y.cogs != null) Y.gp = Y.rev - Y.cogs; if (Y.gp != null) Y.gm = Y.gp / Y.rev * 100; if (Y.opinc != null) Y.opm = Y.opinc / Y.rev * 100; }
    ends.sort(); out.end = ends.length ? ends[ends.length - 1] : null;
    return out;
  }
  var PRS = {};   /* ticker → statements read from the release, with its accession and filing date */
  var TAG = { rev: "Revenues", cogs: "CostOfRevenue", gp: "GrossProfit", rnd: "ResearchAndDevelopmentExpense", sga: "SellingGeneralAndAdministrativeExpense", opinc: "OperatingIncomeLoss",
    pretax: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", tax: "IncomeTaxExpenseBenefit", ni: "NetIncomeLoss", eps_d: "EarningsPerShareDiluted", sh_d: "WeightedAverageNumberOfDilutedSharesOutstanding",
    cash: "CashAndCashEquivalentsAtCarryingValue", sti: "ShortTermInvestments", ar: "AccountsReceivableNetCurrent", inv: "InventoryNet", ca: "AssetsCurrent", assets: "Assets", ap: "AccountsPayableCurrent", accr: "AccruedLiabilitiesCurrent",
    dcur: "DebtCurrent", cl: "LiabilitiesCurrent", ltd_nc: "LongTermDebtNoncurrent", liab: "Liabilities", eq: "StockholdersEquity",
    cfo: "NetCashProvidedByUsedInOperatingActivities", capex: "PaymentsToAcquirePropertyPlantAndEquipment", da: "DepreciationDepletionAndAmortization", sbc: "ShareBasedCompensation", div: "PaymentsOfDividends", buyback: "PaymentsForRepurchaseOfCommonStock" };
  /* the company's filed facts plus the release's quarter (only when that quarter is newer than every filed one) */
  function withRelease(co, st) {
    if (!st || !st.end || !st.is || st.is.rev == null) return null;
    var M0 = E.build(co), q0 = M0.quarters[M0.quarters.length - 1]; if (!q0 || !(Date.parse(st.end) > Date.parse(q0.end) + 60 * 864e5)) return null;
    var start = new Date(Date.parse(q0.end) + 864e5).toISOString().slice(0, 10), F = {}, f0 = co.facts || {};
    Object.keys(f0).forEach(function (t) { F[t] = f0[t]; });
    function add(k, v, inst) { var tag = TAG[k]; if (v == null || !tag) return; var unit = k === "eps_d" ? "USD/shares" : k === "sh_d" ? "shares" : "USD", o = F[tag] ? Object.assign({}, F[tag]) : {};
      var row = { e: st.end, v: v, f: "8-K", d: st.filed, a: st.acc }; if (!inst) row.s = start;
      o[unit] = (o[unit] || []).concat([row]); F[tag] = o; }
    Object.keys(st.is).forEach(function (k) { add(k, st.is[k]); }); Object.keys(st.cf).forEach(function (k) { add(k, st.cf[k]); }); Object.keys(st.bs).forEach(function (k) { add(k, st.bs[k], true); });
    var M = E.build(Object.assign({}, co, { facts: F })), q = M.quarters[M.quarters.length - 1];
    if (!q || q.end !== st.end) return null;
    q.pr = { acc: st.acc, filed: st.filed, url: st.url }; q.fl = Object.assign({}, q.fl, { label: q.fl.label + "*" });
    M.base = M0; return M;
  }
  function prQuarter(t) {   /* rebuild a loaded company with its release quarter once the statements are read */
    var D = MEM[t], st = PRS[t]; if (!D || !D.M || !st || D.M.base) return;
    var M = withRelease(D.co, st); if (!M) return;
    D.M = M; D.V = E.verdicts(M, D.P); delete READY[t]; delete RC[t]; rerender();
  }
  /* ---- management commentary intelligence (owner, Nov 17 2026): every sentence of the release's narrative is read and sorted —
     positives in green, risks and negatives in red, guidance and capex in amber — tagged by topic (sector-aware), and the
     guidance figures are compared with consensus and with the quarter just reported. Rule-based; the sentences are the
     company's own words. ---- */
  var PRN = {};
  var TOPICS = [["AI", /\bAI\b|artificial intelligence|agentic|inference|training/i], ["Data center", /data cent/i], ["Cloud", /\bcloud\b|hyperscal/i], ["Gaming", /gaming/i], ["Automotive", /automotive|vehicle/i],
    ["Networking", /networking|ethernet|infiniband/i], ["China / export", /china|export (control|licen|restriction)/i], ["Tariffs", /tariff/i], ["Supply", /supply|capacity|shortage|constrain/i], ["Demand", /demand|orders|bookings|backlog/i],
    ["Margins", /margin/i], ["Pricing", /pric(e|ing)/i], ["Capex", /capital expenditure|capex|capital spending|purchases of property/i], ["Buybacks & dividends", /repurchase|buyback|dividend/i], ["Debt", /\bdebt\b|notes due|borrow/i],
    ["M&A", /acqui|merger|divest/i], ["Restructuring", /restructur|layoff|workforce reduction|impairment/i], ["Guidance", /outlook|guidance|expects?|expected to/i], ["Inventory", /inventor/i],
    ["Credit & lending", /net interest|deposits?|loans?|credit quality|provision for credit/i], ["Production", /production|barrels|output|volumes?/i], ["Regulatory", /\bFDA\b|approval|clinical|trial|regulator/i],
    ["Same-store sales", /comparable sales|same-store|traffic/i], ["Ag & commodities", /crush|origination|grain|oilseed|ethanol/i]];
  var POS = /record|increas|grew|growth|\bup \d|rose|strong|exceed|raised|expand|accelerat|robust|momentum|launch|ramp|beat|surpass|outperform|best|highest|improv|approved an increase/i;
  var NEG = /declin|decreas|\blower\b|headwind|challeng|\bweak|soft(er|ness)|impair|restructur|uncertain|tariff|export (control|restriction|licen)|not assuming|exclud(e|ing) .*china|charge|\bloss|delay|shortage|constrain|pressure|\bdown \d|reduced (revenue|guidance|outlook|demand|margin|forecast)|cautious|volatil|litigation|investigation|write-?down/i;
  var GUIDE = /outlook|guidance|expects?|expected to|anticipat|forecast|is targeting|plans? to/i;
  function prNotes(html) {
    var doc = new DOMParser().parseFromString(String(html).replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|div|li|h\d|tr|td|span|font|b|strong)>/gi, " </$1>").replace(/<(p|div|li|h\d)\b/gi, " <$1"), "text/html");
    [].forEach.call(doc.querySelectorAll("table,script,style"), function (n) { n.remove(); });
    var t = (doc.body ? doc.body.textContent : "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    var cut = t.search(/\b(About [A-Z][\w&.,' -]{2,40}(Corporation|Inc\.?|Company|Corp\.?)?\b [A-Z][\w&.,' -]{1,40} (is|was|has|provides|designs)|Forward-Looking Statements|Cautionary (Note|Statement)|Conference Call and Webcast|Use of Non-GAAP|Non-GAAP (Financial )?Measures)/);
    if (cut > 200) t = t.slice(0, cut);
    t = t.replace(/([.!?]["”]?)(["“]?[A-Z][a-z])/g, "$1 $2").replace(/•/g, " ");
    var S = t.split(/(?<=[.!?]["”]?)\s+(?=["“]?[A-Z])/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 40 && x.length <= 420 && !/^(EX-99|Document)\b/.test(x); });
    var seen = {}, out = { pos: [], neg: [], guide: [], capex: [], g: {} };
    S.forEach(function (x) {
      var k = x.slice(0, 60); if (seen[k]) return; seen[k] = 1;
      var tags = TOPICS.filter(function (T) { return T[1].test(x); }).map(function (T) { return T[0]; }).filter(function (n) { return n !== "Guidance"; }).slice(0, 4);
      var isG = GUIDE.test(x) && /\$|%|\bbillion\b|\bmillion\b/.test(x), isC = /capital expenditure|capex|capital spending/i.test(x), neg = NEG.test(x), pos = POS.test(x);
      var row = { t: x, tags: tags };
      if (isC) out.capex.push(row);
      if (neg && !(/record|increase of \$|approved an increase/i.test(x) && !/not assuming|declin|decreas/i.test(x))) out.neg.push(row);
      else if (isG) out.guide.push(row);
      else if (pos) out.pos.push(row);
    });
    /* guidance figures */
    var tl = t.replace(/,/g, "");
    var rv = tl.match(/revenue (?:is|are) expected to be (?:approximately |about )?\$([\d.]+) (billion|million)(?:,? plus or minus ([\d.]+)%)?/i) || tl.match(/revenue (?:is|are) expected to be (?:in the range of |between )\$([\d.]+) (billion|million)? ?(?:and|to) \$([\d.]+) (billion|million)/i);
    if (rv) { var mu = /billion/i.test(rv[2] || rv[4] || "") ? 1e9 : 1e6;
      if (rv.length === 4 || rv[3] && !rv[4]) { var mid = +rv[1] * mu, pm = rv[3] ? +rv[3] / 100 : 0; out.g.rev = { mid: mid, lo: mid * (1 - pm), hi: mid * (1 + pm), pm: rv[3] ? +rv[3] : null }; }
      else { var lo = +rv[1] * (/billion/i.test(rv[2] || rv[4]) ? 1e9 : 1e6), hi = +rv[3] * (/billion/i.test(rv[4]) ? 1e9 : 1e6); out.g.rev = { lo: lo, hi: hi, mid: (lo + hi) / 2 }; } }
    var gm = tl.match(/gross margins? (?:is|are) expected to be (?:between )?([\d.]+)% (?:and|to) ([\d.]+)%/i) || tl.match(/gross margins? (?:is|are) expected to be (?:approximately |about )?([\d.]+)%(?:,? plus or minus ([\d.]+) basis points)?/i);
    if (gm) { if (gm[2] && !/basis/.test(gm[0])) out.g.gm = { lo: +gm[1], hi: +gm[2], mid: (+gm[1] + +gm[2]) / 2 }; else { var bp = gm[2] ? +gm[2] / 100 : 0; out.g.gm = { mid: +gm[1], lo: +gm[1] - bp, hi: +gm[1] + bp }; } }
    var cx = tl.match(/capital expenditures? (?:for [^.]{0,60})?(?:is|are|of|to be|expected to be|will be)[^.$]{0,40}\$([\d.]+) (billion|million)(?: (?:to|and) \$([\d.]+) (billion|million))?/i);
    if (cx) { var cm = /billion/i.test(cx[2]) ? 1e9 : 1e6; out.g.capex = { lo: +cx[1] * cm, hi: cx[3] ? +cx[3] * (/billion/i.test(cx[4]) ? 1e9 : 1e6) : +cx[1] * cm }; }
    var fig = function (r) { return /\$[\d.]|\d%|\bup \d|record/i.test(r.t) ? 0 : 1; };
    out.pos = out.pos.map(function (r, i) { return [fig(r), i, r]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }).map(function (z) { return z[2]; });
    out.pos = out.pos.slice(0, 6); out.neg = out.neg.slice(0, 6); out.guide = out.guide.slice(0, 6); out.capex = out.capex.slice(0, 3);
    return out;
  }
  function intel(M, x, r, lab) {   /* "Smart read": the release's figures against consensus, the last quarters and its own guidance */
    var t = M.co.ticker, N = PRN[t], A = (MEM[t] && MEM[t].M) || M, Q = A.quarters, c = Q[Q.length - 1], p = Q[Q.length - 2], y = null, D = SD(M), B = [];
    for (var j = Q.length - 2; j >= 0; j--) { var dd = (Date.parse(c.end) - Date.parse(Q[j].end)) / 864e5; if (dd >= 350 && dd <= 380) { y = Q[j]; break; } }
    function v(q, k) { return q && q.m[k] ? q.m[k].v : null; }
    function g(a, b) { return a != null && b ? (a / b - 1) * 100 : null; }
    function pc2(z) { return (z >= 0 ? "+" : "−") + Math.abs(z).toFixed(1) + "%"; }
    function add(tone, txt) { B.push({ c: tone, t: txt }); }
    var rev = x && x.rev != null ? x.rev : r && r.revenueActual, pyr = x && x.py && x.py.rev;
    if (rev != null) { var yy = g(rev, pyr), qq = c && c.pr ? g(v(c, "rev"), v(p, "rev")) : null, sr = r && r.rev_surprise_pct;
      add((sr != null ? sr : yy) >= 0 ? "g" : "r", "Revenue " + m$(rev) + (yy != null ? " (" + pc2(yy) + " YoY" + (qq != null ? ", " + pc2(qq) + " QoQ" : "") + ")" : "") + (sr != null ? ", " + pc2(sr) + " vs consensus" : "") + "."); }
    var hs = D && D.hist && D.hist[D.hist.length - 1];
    if (r && r.eps_surprise_pct != null) add(r.eps_surprise_pct >= 0 ? "g" : "r", "EPS " + e$(r.epsActual) + " vs " + e$(r.epsEstimated) + " consensus (" + pc2(r.eps_surprise_pct) + ").");
    else if (hs && hs.surprise_pct != null && hs.q && Date.parse(hs.q) > Date.parse(L(M).end + "T12:00:00Z") + 45 * 864e5) add(hs.surprise_pct >= 0 ? "g" : "r", "Adjusted EPS " + e$(hs.actual) + " vs " + e$(hs.est) + " consensus (" + pc2(hs.surprise_pct) + ").");
    if (N && N.g.rev) { var nx = D && (D.trend || []).filter(function (z) { return z.period === "0q"; })[0], cons = nx && nx.rev && nx.rev.avg, vc = g(N.g.rev.mid, cons), vq = g(N.g.rev.mid, rev);
      add(vc == null ? (vq >= 0 ? "g" : "r") : vc >= 0 ? "g" : "r", "Next-quarter revenue guided to " + m$(N.g.rev.mid) + (N.g.rev.pm ? " ±" + N.g.rev.pm + "%" : N.g.rev.lo !== N.g.rev.hi ? " (" + m$(N.g.rev.lo) + "–" + m$(N.g.rev.hi) + ")" : "") + (vq != null ? ": " + pc2(vq) + " on this quarter" : "") + (vc != null ? ", " + pc2(vc) + " vs the " + m$(cons) + " consensus" : "") + "."); }
    var gmNow = x && x.gm != null ? x.gm : v(c, "gm");
    if (N && N.g.gm && gmNow != null) { var dgm = N.g.gm.mid - gmNow; add(dgm >= -0.3 ? "g" : "r", "Gross margin guided to " + (N.g.gm.lo !== N.g.gm.hi ? N.g.gm.lo.toFixed(1) + "–" + N.g.gm.hi.toFixed(1) + "%" : N.g.gm.mid.toFixed(1) + "%") + " vs " + gmNow.toFixed(1) + "% this quarter (" + (dgm >= 0 ? "+" : "−") + Math.abs(dgm).toFixed(1) + " pp)."); }
    var cpx = v(c, "capex"), cpp = v(p, "capex"), cpy = v(y, "capex");
    if (cpx != null) { var cq = g(cpx, cpp), cy = g(cpx, cpy); add("a", "Capex " + m$(cpx) + " this quarter" + (cq != null ? " (" + pc2(cq) + " QoQ" + (cy != null ? ", " + pc2(cy) + " YoY" : "") + ")" : "") + (v(c, "rev") ? " — " + (cpx / v(c, "rev") * 100).toFixed(1) + "% of revenue" : "") + (N && N.g.capex ? "; guided " + m$(N.g.capex.lo) + (N.g.capex.hi !== N.g.capex.lo ? "–" + m$(N.g.capex.hi) : "") : N && N.capex.length ? "; see capex commentary below" : "; no capex guidance in the release") + "."); }
    var ri = g(v(c, "rev"), v(p, "rev")), ii = g(v(c, "inv"), v(p, "inv")), ai = g(v(c, "ar"), v(p, "ar"));
    if (ii != null && ri != null) add(ii > ri + 10 ? "r" : "g", "Inventory " + m$(v(c, "inv")) + " (" + pc2(ii) + " QoQ) against revenue " + pc2(ri) + " QoQ" + (ii > ri + 10 ? " — building faster than sales." : " — in step with sales."));
    if (ai != null && ri != null) add(ai > ri + 10 ? "r" : "g", "Receivables " + m$(v(c, "ar")) + " (" + pc2(ai) + " QoQ)" + (v(c, "dso") != null ? ", DSO " + v(c, "dso").toFixed(0) + " days" + (v(p, "dso") != null ? " (" + (v(c, "dso") - v(p, "dso") >= 0 ? "+" : "−") + Math.abs(v(c, "dso") - v(p, "dso")).toFixed(0) + " d)" : "") : "") + (ai > ri + 10 ? " — customers taking longer to pay." : "."));
    var ret = (v(c, "buyback") || 0) + (v(c, "div") || 0); if (ret) add("g", "Returned " + m$(ret) + " to shareholders (buybacks " + m$(v(c, "buyback")) + ", dividends " + m$(v(c, "div")) + ").");
    return B;
  }
  function notesHTML(M, x, r, lab, meta) {
    var t = M.co.ticker, N = PRN[t], B = intel(M, x, r, lab);
    function li(row, cls) { return '<li class="' + cls + '"><span>“' + esc(row.t.replace(/^["“]+|["”]+$/g, "")) + "”</span>" + (row.tags.length ? '<em>' + row.tags.map(function (g) { return "<i>" + esc(g) + "</i>"; }).join("") + "</em>" : "") + "</li>"; }
    function col(h, cls, rows, empty) { return '<div class="mi-c ' + cls + '"><h4>' + h + " <small>" + rows.length + "</small></h4>" + (rows.length ? "<ul>" + rows.map(function (z) { return li(z, cls); }).join("") + "</ul>" : '<p class="rs-mn">' + empty + "</p>") + "</div>"; }
    var guide = N ? N.guide.concat(N.capex.filter(function (z) { return N.guide.indexOf(z) < 0; })) : [];
    return '<div class="rs-m"><div class="rs-mh">Smart read <small>figures from the release, filings and consensus — computed, not opinion</small></div>' +
      (B.length ? '<ul class="mi-b">' + B.map(function (b) { return '<li class="' + b.c + '">' + esc(b.t) + "</li>"; }).join("") + "</ul>" : "") +
      (N ? '<div class="rs-mh" style="margin-top:12px">Management commentary <small>the company’s own sentences, sorted · topic tags for ' + esc(M.sector) + "</small></div>" +
        '<div class="mi-g">' + col("Positives", "g", N.pos, "No positive statements with figures.") + col("Risks &amp; negatives", "r", N.neg, "No risks or negatives stated in the release.") + col("Guidance &amp; capex", "a", guide, "No guidance or capex outlook in the release.") + "</div>"
        : meta && meta.loading ? '<p class="rs-mn"><i class="ux-spin"></i> Reading the release…</p>' : "") + "</div>";
  }
  function prFor(M) { M = M.base || M; var P = window.DESK_EARN_PR || {}, a = P[M.co.ticker], b = LPR[M.co.ticker], q = L(M); b = b && b.nums ? b : null;
    var x = a && b ? (b.date > a.date ? b : a) : a || b; x = x && afterFiled(x.date, q.end) ? x : null;
    /* the full condensed income statement read from the same release wins over a summary-table read (exact, with its year-ago column) */
    var st = PRS[M.co.ticker], I = st && st.is;
    if (I && I.rev != null && st.filed && afterFiled(st.filed, q.end)) {
      var py = {}; ["rev", "gp", "gm", "opinc", "opm", "ni", "eps_d"].forEach(function (k) { if (st.py[k] != null) py[k] = st.py[k]; });
      x = Object.assign({}, x || { date: st.filed, acc: st.acc, exhibit: st.url }, { rev: I.rev, gp: I.gp, gm: I.gm, opinc: I.opinc, opm: I.opm, ni: I.ni, eps_d: I.eps_d, py: py });
    }
    return x; }
  var LPR = {}, PRQ = {};
  function prFetch(M) {
    M = M.base || M;
    var co = M.co, t = co.ticker, rel = E.latestRelease(co); if (!rel || !rel.accn || !worker() || !window.ELOCK || !ELOCK.parsePR) return;
    if (Date.now() - Date.parse(rel.filed + "T12:00:00Z") > 30 * 864e5 || PRQ[t + rel.accn]) return; PRQ[t + rel.accn] = 1;
    LPR[t] = { date: rel.filed, acc: rel.accn, loading: 1 };
    var A = fetch(worker() + "/exhibit?t=" + encodeURIComponent(t) + "&acc=" + encodeURIComponent(rel.accn)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    var B = fetch(worker() + "/filings?t=" + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([A, B]).then(function (x) {
      var j = x[0], f = x[1], ac = f && (f.releases || []).filter(function (r) { return r.accn === rel.accn; })[0], o = j && j.html ? ELOCK.parsePR(j.html) : null;
      var nums = !!(o && !o.unread && (o.rev != null || o.eps_d != null));
      LPR[t] = Object.assign({}, nums ? o : {}, { quotes: o && o.quotes || null, date: rel.filed, acc: rel.accn, exhibit: j && j.url || null, accepted: ac && ac.accepted || null, nums: nums, src: "browser" });
      if (j && j.html) try { PRN[t] = prNotes(j.html); } catch (e) {}
      if (j && j.html && afterFiled(rel.filed, L(M).end)) { try { var st = prStatements(j.html); st.acc = rel.accn; st.filed = rel.filed; st.url = j.url; PRS[t] = st; prQuarter(t); } catch (e) {} }
      delete READY[t]; delete RC[t]; rerender();
    });
  }
  function nextQ(q) { return q.fl.q === 4 ? { q: 1, fy: q.fl.fy + 1 } : { q: q.fl.q + 1, fy: q.fl.fy }; }
  function prStrip(M, k) {
    var x = prFor(M); if (!x || x[k] == null) return "";
    var q = L(M), n = nextQ(q), lab = "Q" + n.q + " FY" + String(n.fy).slice(2);
    var ly = M.quarters.filter(function (z) { return z.fl.q === n.q && z.fl.fy === n.fy - 1; })[0], lv = ly && ly.m[k] ? ly.m[k].v : null;
    var yo = lv == null ? "" : PCT[k] ? " · " + (x[k] - lv >= 0 ? "+" : "") + (x[k] - lv).toFixed(1) + " pp YoY" : lv ? " · " + ((x[k] / lv - 1) * 100 >= 0 ? "+" : "") + ((x[k] / lv - 1) * 100).toFixed(1) + "% YoY" : "";
    var td = x.date === new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return '<div class="cx-prs' + (td ? "" : " old") + '"><span class="cx-new-b">' + (td ? "RELEASED" : "LATEST") + '</span> ' + lab + " · " + esc(nm(k)) + " <b>" + fv(k, x[k]) + "</b>" + yo +
      ' <small>press release ' + esc(new Date(x.date + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })) + ", unaudited · full statements with the " + (n.q === 4 ? "10-K" : "10-Q") +
      (x.exhibit ? ' · <a href="' + (window.safeUrl ? safeUrl(x.exhibit) : "#") + '" target="_blank" rel="noopener noreferrer">exhibit 99.1 ↗</a>' : "") + "</small></div>";
  }
  window.addEventListener("desk:earnpr", function () { try { var a = document.getElementById("panel-earnings"); if (a && a.classList.contains("active")) rerender(); } catch (e) {} });
  /* red banner: results out (earnings calendar) before the quarter's 10-Q/10-K reaches XBRL */
  /* ---------------- latest results: one scorecard, each figure shaded by how it came out ---------------- */
  function calRow(M) {
    var co = M.co, q = L(M), D = window.EARNINGS && EARNINGS._data && EARNINGS._data(), C = D && D.calendar;
    var r = C && C.rows ? C.rows.filter(function (x) { return x.symbol === co.ticker && (x.epsActual != null || x.revenueActual != null); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0] : null;
    return r && Date.now() - Date.parse(r.date + "T12:00:00Z") <= 10 * 864e5 && afterFiled(r.date, q.end) ? r : null;
  }
  /* release time: SEC acceptance time when known, else the calendar slot (before the open / after the close), else the day */
  function relTime(x, meta, r) {
    var a = (meta && meta.accepted) || (x && x.at); if (a && !isNaN(Date.parse(a))) return { t: Date.parse(a), exact: 1 };
    if (r && r.date) return { t: Date.parse(r.date + (r.time === "bmo" ? "T13:00:00Z" : r.time === "amc" ? "T21:05:00Z" : "T12:00:00Z")), exact: r.time === "bmo" || r.time === "amc" };
    var d = (x && x.date) || (meta && meta.date); return d ? { t: Date.parse(d + "T12:00:00Z"), exact: 0, day: d } : null;
  }
  function ago(ms) { var h = ms / 36e5; return h < 1 ? Math.max(1, Math.round(ms / 6e4)) + " min ago" : h < 48 ? Math.round(h) + "h ago" : Math.round(h / 24) + " days ago"; }
  var TODAY = function () { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };
  /* ---- scorecard detail (owner, Nov 17 2026): click a figure → this quarter vs prior quarter (QoQ) and the same quarter a year
     earlier (YoY), and the median of the last five quarters, with the five quarters drawn and tabled ---- */
  var RSD = null;
  var RSK = { rev: "rev", eps_d: "eps_d", ni: "ni", gm: "gm", opinc: "opinc", opm: "opm" };
  function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; }
  function rsDetail(M, T, x, r, q, lab) {
    if (!T) return "";
    var k = T.k, pct = !!PCT[k], f = T.fmt, P = [];
    if (k === "eps") {   /* adjusted EPS against consensus: the Street history */
      ((SD(M) && SD(M).hist) || []).forEach(function (h) { if (h.actual != null) P.push({ lab: fl(M, h.q), v: h.actual, est: h.est }); });
      if (r && r.epsActual != null && (!P.length || P[P.length - 1].v !== r.epsActual)) P.push({ lab: lab, v: r.epsActual, est: r.epsEstimated });
    } else {
      var sk = RSK[k]; if (!sk) return "";
      M.quarters.forEach(function (z) { var m = z.m[sk]; if (m && m.v != null) P.push({ lab: z.fl.label, v: m.v, end: z.end }); });
      var cur = T.v, newer = !!(x && x[k] != null && x[k] === cur && afterFiled(x.date, q.end));
      if (newer) P.push({ lab: lab, v: cur, now: 1 }); else if (P.length && Math.abs(P[P.length - 1].v - cur) > Math.abs(cur) * 0.001 + 1e-9 && !(r && k === "rev")) P.push({ lab: lab, v: cur, now: 1 });
    }
    P = P.slice(-9); if (!P.length) return "";
    var c = P[P.length - 1], pq = P.length > 1 ? P[P.length - 2] : null, ya = P.length > 4 ? P[P.length - 5] : null;
    if (x && x.py && x.py[k] != null && c.now) ya = { lab: (ya && ya.lab) || "year ago", v: x.py[k] };   /* the release's own year-ago column, same basis as this quarter */
    var last5 = P.slice(-5), md = med(last5.map(function (z) { return z.v; }));
    function d(a, b) { if (a == null || b == null) return null; if (pct) { var dp = Math.round((a - b) * 10) / 10; return { t: (dp > 0 ? "+" : dp < 0 ? "−" : "") + Math.abs(dp).toFixed(1) + " pp", v: dp }; } if (!b) return null; var g = (a / b - 1) * 100 * (b < 0 ? -1 : 1); return { t: (g >= 0 ? "+" : "−") + Math.abs(g).toFixed(1) + "%", v: g }; }
    function box(l, ref, dd) { var z = dd; return '<div class="rd-b"><span>' + l + "</span><b>" + (ref ? f(ref.v) : "—") + "</b>" + (ref && ref.lab ? "<small>" + esc(ref.lab) + "</small>" : "") + (z ? '<i class="' + (z.v >= 0 ? "pos" : "neg") + '">' + esc(c.lab) + " " + z.t + "</i>" : "") + "</div>"; }
    var vs = [box("This quarter", c, null), box("vs prior quarter (QoQ)", pq, d(c.v, pq && pq.v)), box("vs year ago (YoY)", ya, d(c.v, ya && ya.v)), box("Median, last " + last5.length + " quarters", md == null ? null : { v: md, lab: last5.length + " quarters: " + last5[0].lab + "–" + c.lab }, d(c.v, md))].join("");
    /* bars: five quarters, the median dashed, the current bar highlighted */
    var vals = last5.map(function (z) { return z.v; }).concat(md != null ? [md] : []), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals);
    if (pct) { lo = Math.max(0, Math.min.apply(null, vals) - 5); hi = Math.max.apply(null, vals) + 3; } else hi *= 1.12;
    var W = window.innerWidth < 700 ? 340 : 520, H = window.innerWidth < 700 ? 190 : 170, PL = 8, PR = 8, PT = 18, PB = 26, pw = W - PL - PR, ph = H - PT - PB, n = last5.length, bw = pw / n;
    function Y(v) { return PT + ph * (1 - (v - lo) / ((hi - lo) || 1)); }
    var g = last5.map(function (z, i) { var cx = PL + bw * (i + 0.5), w = Math.min(56, bw * 0.55), y = Y(Math.max(z.v, lo)), y0 = Y(Math.max(0, lo));
      return '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + Math.min(y, y0).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.abs(y0 - y).toFixed(1) + '" rx="3" class="' + (i === n - 1 ? "rd-c" : "rd-p") + '"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (Math.min(y, y0) - 5).toFixed(1) + '" text-anchor="middle" class="rd-v">' + f(z.v) + '</text><text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="rd-x' + (i === n - 1 ? " c" : "") + '">' + esc(z.lab) + "</text>"; }).join("");
    if (md != null) g += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(md).toFixed(1) + '" y2="' + Y(md).toFixed(1) + '" class="rd-m"/>';
    var tb = '<div class="tbl-scroll"><table class="cx-t rd-t"><thead><tr><th>Quarter</th><th>' + esc(T.label) + "</th><th>QoQ</th><th>YoY</th>" + (k === "eps" ? "<th>Consensus</th><th>Surprise</th>" : "") + "</tr></thead><tbody>" +
      P.map(function (z, i) { if (i < P.length - 5) return ""; var a = d(z.v, P[i - 1] && P[i - 1].v), b = i === P.length - 1 ? d(z.v, ya && ya.v) : d(z.v, P[i - 4] && P[i - 4].v), sur = z.est ? (z.v / z.est - 1) * 100 * (z.est < 0 ? -1 : 1) : null;
        return "<tr" + (i === P.length - 1 ? ' class="rd-now"' : "") + "><td class=\"lbl\">" + esc(z.lab) + '</td><td data-l="' + esc(T.label) + '">' + f(z.v) + '</td><td data-l="QoQ" class="' + (a ? (a.v >= 0 ? "pos" : "neg") : "") + '">' + (a ? a.t : "—") + '</td><td data-l="YoY" class="' + (b ? (b.v >= 0 ? "pos" : "neg") : "") + '">' + (b ? b.t : "—") + "</td>" +
          (k === "eps" ? '<td data-l="Consensus">' + (z.est != null ? f(z.est) : "—") + '</td><td data-l="Surprise" class="' + (sur == null ? "" : sur >= 0 ? "pos" : "neg") + '">' + (sur == null ? "—" : (sur >= 0 ? "+" : "−") + Math.abs(sur).toFixed(1) + "%") + "</td>" : "") + "</tr>"; }).join("") + "</tbody></table></div>";
    var read = [];
    var dq = d(c.v, pq && pq.v), dy = d(c.v, ya && ya.v), dm = d(c.v, md);
    if (dm) read.push(esc(T.label) + " of " + f(c.v) + " is " + (Math.abs(dm.v) < (pct ? 0.1 : 0.5) ? "in line with" : dm.v > 0 ? "above" : "below") + " its five-quarter median of " + f(md) + (Math.abs(dm.v) < (pct ? 0.1 : 0.5) ? "." : " (" + dm.t + ")."));
    if (dq && dy) read.push((dq.v >= 0) === (dy.v >= 0) ? (dq.v >= 0 ? "Higher" : "Lower") + " than both the prior quarter (" + dq.t + ") and a year ago (" + dy.t + ")." : "Mixed: " + dq.t + " on the prior quarter, " + dy.t + " on a year ago.");
    return '<div class="rsd" role="region" aria-label="' + esc(T.label) + ' detail"><div class="rd-h"><b>' + esc(T.label) + '</b><span>QoQ · YoY · five-quarter median</span><button class="ue-btn" data-cocard="' + T.card + '">Open full card ›</button><button class="ue-btn" data-rsd="' + k + '" aria-label="Close">✕</button></div>' +
      '<div class="rd-g">' + vs + "</div>" + '<div class="rd-2"><div><svg class="rd-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(T.label) + ', last five quarters">' + g + "</svg>" + (md != null ? '<div class="legend"><span><span class="sw" style="background:#38b6c9"></span>This quarter</span><span><span class="sw" style="background:#3a4a60"></span>Earlier quarters</span><span><span class="sw" style="background:#e8a33d"></span>Median ' + f(md) + "</span></div>" : "") + "</div>" + tb + "</div>" +
      (read.length ? '<p class="rd-r">' + read.join(" ") + "</p>" : "") + '<div class="stamp">' + (k === "eps" ? "Adjusted EPS and consensus from the Street history." : "Filed quarters from SEC 10-Q/10-K; the newest quarter from the company’s press release until its 10-Q/10-K is on EDGAR.") + (pct ? " Margin changes are in percentage points." : "") + " Median = middle value of the last five quarters shown.</div></div>";
  }
  function results(M) {
    M = M.base || M;
    var co = M.co, q = L(M), r = calRow(M), x = prFor(M), meta = LPR[co.ticker] || {}, rel = E.latestRelease(co), n = nextQ(q), lab = "Q" + n.q + " FY" + String(n.fy).slice(2);
    if (!r && !x) return meta.loading && rel && afterFiled(rel.filed, q.end) ? '<div class="rs rs-ld"><i class="ux-spin"></i> Reading ' + esc(co.ticker) + "’s latest earnings release (8-K filed " + esc(rel.filed) + ")…</div>" : "";
    if (!r && Date.now() - Date.parse(x.date + "T12:00:00Z") > 21 * 864e5) return "";
    var py = (x && x.py) || {}, RT = relTime(x, meta, r), now = Date.now();
    /* no calendar row: the Street history's latest quarter, when it is the quarter just reported (ends after the last filed one) */
    var SH = SD(M) && SD(M).hist, sh0 = !r && SH && SH.length ? SH[SH.length - 1] : null;
    if (sh0 && !(sh0.q && Date.parse(sh0.q) > Date.parse(q.end + "T12:00:00Z") + 45 * 864e5 && sh0.actual != null && sh0.est != null)) sh0 = null;
    var fresh = RT && (RT.exact ? now - RT.t >= 0 && now - RT.t < 864e5 : RT.day === TODAY() || (r && r.date === TODAY()));
    function T(k, label, v, est, sur, prev, cardId, fmt) {
      if (v == null) return null;
      var tone = 0, tag = "", sub = [];
      if (sur != null) { tone = sur >= 1 ? 1 : sur <= -1 ? -1 : 0; tag = tone > 0 ? "BEAT " : tone < 0 ? "MISS " : "IN LINE "; tag += (sur > 0 ? "+" : "") + sur.toFixed(1) + "%"; if (est != null) sub.push("est " + fmt(est)); }
      if (prev != null) {
        if (PCT[k]) { var d = v - prev; if (sur == null) { tone = d >= 0.1 ? 1 : d <= -0.1 ? -1 : 0; tag = (d >= 0 ? "▲ +" : "▼ ") + d.toFixed(1) + " pp"; } sub.push((sur == null ? "" : (d >= 0 ? "+" : "") + d.toFixed(1) + " pp YoY · ") + "yr ago " + fmt(prev)); }
        else if (prev > 0) { var g = (v / prev - 1) * 100; if (sur == null) { tone = g >= 0.5 ? 1 : g <= -0.5 ? -1 : 0; tag = (g >= 0 ? "▲ +" : "▼ ") + g.toFixed(1) + "% YoY"; } sub.push((sur == null ? "" : (g >= 0 ? "+" : "") + g.toFixed(1) + "% YoY · ") + "yr ago " + fmt(prev)); }
        else if (prev < 0 && sur == null) { tone = v > prev ? 1 : -1; tag = v > prev ? "▲ IMPROVED" : "▼ WORSE"; sub.push("yr ago " + fmt(prev)); }
      }
      return { k: k, tone: tone, v: v, label: label, fmt: fmt, card: cardId, html: '<button class="rs-t ' + (tone > 0 ? "good" : tone < 0 ? "bad" : "neu") + (RSD === k ? " on" : "") + '" data-rsd="' + k + '" aria-expanded="' + (RSD === k) + '"><span class="l">' + label + "</span><span class=\"v\">" + fmt(v) + "</span>" +
        (tag ? '<span class="tg">' + tag + "</span>" : "") + '<span class="s">' + esc(sub.join(" · ") || "no comparison published") + "</span></button>" };
    }
    function fk(k) { return function (v) { return fv(k, v); }; }
    function d2(v) { return (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2); }
    var tiles = [
      T("rev", "Revenue", r && r.revenueActual != null ? r.revenueActual : x && x.rev, r && r.revenueEstimated, r && r.rev_surprise_pct, py.rev, "revenue", fk("rev")),
      r && r.epsActual != null ? T("eps", "EPS vs consensus", r.epsActual, r.epsEstimated, r.eps_surprise_pct, null, "est", d2) : sh0 ? T("eps", "EPS vs consensus · adjusted", sh0.actual, sh0.est, sh0.surprise_pct, null, "est", d2) : null,
      T("eps_d", "Diluted EPS · GAAP", x && x.eps_d, null, null, py.eps_d, "eps", d2),
      T("ni", "Net income", x && x.ni, null, null, py.ni, "eps", fk("ni")),
      T("gm", "Gross margin", x && x.gm, null, null, py.gm, "gross", fk("gm")),
      T("opinc", "Operating income", x && x.opinc, null, null, py.opinc, "operating", fk("opinc")),
      T("opm", "Operating margin", x && x.opm, null, null, py.opm, "operating", fk("opm"))].filter(Boolean);
    var up = tiles.filter(function (t) { return t.tone > 0; }).length, dn = tiles.filter(function (t) { return t.tone < 0; }).length;
    var Q = (x && x.quotes) || meta.quotes, mg;
    function ql(a) { return a.map(function (z) { return "<li>“" + esc(String(z).replace(/^[\s"“”']+|[\s"“”']+$/g, "")) + "”</li>"; }).join(""); }
    if (meta.loading) mg = '<p class="rs-mn"><i class="ux-spin"></i> Reading the release for management commentary…</p>';
    else if (Q && (Q.highlights.length || Q.guidance.length)) mg = (Q.highlights.length ? "<h4>Highlights</h4><ul>" + ql(Q.highlights) + "</ul>" : "") + (Q.guidance.length ? "<h4>Guidance &amp; outlook</h4><ul>" + ql(Q.guidance) + "</ul>" : "");
    else mg = '<p class="rs-mn">' + (meta.date ? "The release has no highlight or guidance sentences with figures." : "Management commentary is read from the press release; it was not available here.") + "</p>";
    var ex = (x && x.exhibit) || meta.exhibit, when = RT ? (RT.exact ? new Date(RT.t).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : new Date(RT.t).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })) : "";
    return '<section class="rs' + (fresh ? " fresh" : "") + '" aria-label="Latest results"><div class="rs-h"><span class="rs-b">' + (fresh ? "NEW · LAST 24H" : "LATEST RESULTS") + "</span><b>" + esc(co.ticker) + " " + lab + (n.q === 4 ? " (fiscal Q4)" : "") + " results</b>" +
      '<span class="rs-w">' + esc(when) + (RT ? " · " + ago(Math.max(0, now - RT.t)) : "") + "</span>" +
      '<span class="rs-sc"><i class="g">' + up + " better</i><i class=\"r\">" + dn + " worse</i></span></div>" +
      '<div class="rs-g">' + tiles.map(function (t) { return t.html; }).join("") + "</div>" + rsDetail(M, tiles.filter(function (t) { return t.k === RSD; })[0], x, r, q, lab) +
      (PRN[co.ticker] || !mg ? notesHTML(M, x, r, lab, meta) : '<div class="rs-m"><div class="rs-mh">Management <small>quoted verbatim from the release</small></div>' + mg + "</div>") +
      '<div class="rs-n">' + (r ? "Consensus from the desk’s earnings calendar. " : "") + (x ? "Figures from the company press release (GAAP, unaudited)" + (ex ? ' · <a href="' + (window.safeUrl ? safeUrl(ex) : "#") + '" target="_blank" rel="noopener noreferrer">exhibit 99.1 ↗</a>' : "") + ". " : "") +
      "Green = better than consensus or a year ago, red = worse. " + (MEM[co.ticker] && MEM[co.ticker].M && MEM[co.ticker].M.base ? "The tiles below show " + esc(lab) + "* from this release (balance sheet and cash flow included, unaudited) until the " + (n.q === 4 ? "10-K" : "10-Q") + " is on EDGAR; then they switch to the filed figures."
        : "The tiles below still show " + esc(q.fl.label) + " until the " + (n.q === 4 ? "10-K" : "10-Q") + " reaches EDGAR’s data feed; they update automatically then.") + "</div></section>";
  }
  /* ---------------- Street estimates & ownership (worker /street: analyst consensus and 13F ownership, on demand) ---------------- */
  var STR = {};
  function strFetch(t) {
    if (STR[t] || !worker()) return; STR[t] = { loading: 1 };
    fetch(worker() + "/street?t=" + encodeURIComponent(t)).then(function (r) { return r.json().then(function (j) { return r.ok ? j : { error: j.error || "HTTP " + r.status }; }); })
      .then(function (j) { STR[t] = j && !j.error ? { d: j, at: Date.now() } : { err: (j && j.error) || "unavailable" }; delete READY[t]; delete RC[t]; rerender(); })
      .catch(function (e) { STR[t] = { err: String(e && e.message || e) }; delete READY[t]; delete RC[t]; rerender(); });
  }
  function SD(M) { var x = STR[M.co.ticker]; return x && x.d ? x.d : null; }
  function fl(M, end) { return end ? E.fiscalLabel(end, M.co.fiscalYearEnd).label : ""; }
  var EV = { k: "eps", v: "both" };
  function m$(v) { if (v == null) return "—"; var a = Math.abs(v), s = v < 0 ? "−$" : "$"; return s + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(0) + "M" : a.toFixed(0)); }
  function e$(v) { return v == null ? "—" : (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2); }
  function pc(v, d) { if (v == null) return "—"; var dd = d == null ? (Math.abs(v) < 0.1 && v !== 0 ? 2 : 1) : d; return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dd) + "%"; }
  /* the reported quarters (SEC, else the press release, else the source's own actuals) and the forward consensus, one column each */
  function estCols(M) {
    var D = SD(M); if (!D) return [];
    var C = [], qs = M.quarters;
    function secQ(end) { var t = Date.parse(end + "T12:00:00Z"); return qs.filter(function (q) { return Math.abs(Date.parse(q.end + "T12:00:00Z") - t) < 20 * 864e5; })[0] || null; }
    function ago(end) { var t = Date.parse(end + "T12:00:00Z") - 365 * 864e5; return qs.filter(function (q) { return Math.abs(Date.parse(q.end + "T12:00:00Z") - t) < 25 * 864e5; })[0] || null; }
    (D.hist || []).forEach(function (h, i) {
      if (!h.q) return; var sq = secQ(h.q), yq = ago(h.q), pr = prFor(M), fin = (D.qfin || [])[i] || null;
      var rev = sq && sq.m.rev ? sq.m.rev.v : pr && pr.rev != null && !sq ? pr.rev : fin && fin.rev;
      var yrev = yq && yq.m.rev ? yq.m.rev.v : null;
      var hy = (D.hist || []).filter(function (z) { return z.q && Math.abs(Date.parse(z.q) - (Date.parse(h.q) - 365 * 864e5)) < 25 * 864e5; })[0];
      C.push({ lab: fl(M, h.q), end: h.q, past: true, eps: { avg: h.est, act: h.actual, sur: h.surprise_pct, yoy: hy && hy.actual ? (h.actual / hy.actual - 1) * 100 * (hy.actual < 0 ? -1 : 1) : null },
        rev: { act: rev, yoy: rev != null && yrev ? (rev / yrev - 1) * 100 : null } });
    });
    (D.trend || []).forEach(function (t) {
      if (!t.end) return; var fy = /y$/.test(t.period);
      C.push({ lab: fy ? "FY" + String(E.fiscalLabel(t.end, M.co.fiscalYearEnd).fy).slice(2) : fl(M, t.end), end: t.end, fy: fy, next: t.period === "0q",
        eps: t.eps && { avg: t.eps.avg, hi: t.eps.high, lo: t.eps.low, n: t.eps.n, ya: t.eps.year_ago, g: t.eps.growth != null ? t.eps.growth * 100 : null },
        rev: t.rev && { avg: t.rev.avg, hi: t.rev.high, lo: t.rev.low, n: t.rev.n, ya: t.rev.year_ago, g: t.rev.growth != null ? t.rev.growth * 100 : null }, tr: t.trend_eps, rv: t.rev30 });
    });
    return C;
  }
  function estChart(C, k) {
    var f = k === "eps" ? e$ : m$, P = C.filter(function (c) { return !c.fy && c[k]; }), vals = [];
    P.forEach(function (c) { var x = c[k]; [x.act, x.avg, x.hi, x.lo].forEach(function (v) { if (v != null) vals.push(v); }); });
    if (vals.length < 2) return "";
    var wide = window.innerWidth > 1100, W = wide ? 1100 : window.innerWidth < 700 ? 420 : 640, H = wide ? 260 : 220, PL = 10, PR = 70, PT = 14, PB = 30, pw = W - PL - PR, ph = H - PT - PB, lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals) * 1.08, n = P.length, bw = pw / n;
    function Y(v) { return PT + ph * (1 - (v - lo) / (hi - lo)); }
    var s = '<line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#2a3446"/>';
    for (var g = 1; g <= 4; g++) { var v = lo + (hi - lo) * g / 4; s += '<line x1="' + PL + '" x2="' + (PL + pw) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#141c28"/><text x="' + (PL + pw + 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" class="es-ax">' + f(v) + "</text>"; }
    P.forEach(function (c, i) {
      var x = c[k], cx = PL + bw * (i + 0.5), w = Math.min(34, bw * 0.5);
      if (x.act != null) { var y0 = Y(Math.max(0, Math.min(x.act, 0))), y1 = Y(Math.max(x.act, 0)); s += '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + Math.min(Y(x.act), Y(0)).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.abs(Y(x.act) - Y(0)).toFixed(1) + '" rx="2" class="' + (x.avg != null && x.act >= x.avg ? "es-bg" : x.avg != null ? "es-bb" : "es-bn") + '"/>'; }
      if (x.hi != null && x.lo != null) s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + Y(x.hi).toFixed(1) + '" y2="' + Y(x.lo).toFixed(1) + '" class="es-rg"/><line x1="' + (cx - 6) + '" x2="' + (cx + 6) + '" y1="' + Y(x.hi).toFixed(1) + '" y2="' + Y(x.hi).toFixed(1) + '" class="es-rg"/><line x1="' + (cx - 6) + '" x2="' + (cx + 6) + '" y1="' + Y(x.lo).toFixed(1) + '" y2="' + Y(x.lo).toFixed(1) + '" class="es-rg"/>';
      if (x.avg != null) s += '<rect x="' + (cx - w / 2 - 3).toFixed(1) + '" y="' + (Y(x.avg) - 1.5).toFixed(1) + '" width="' + (w + 6).toFixed(1) + '" height="3" class="es-cs"/>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 14) + '" class="es-xl' + (c.next ? " nx" : "") + '" text-anchor="middle">' + esc(c.lab) + "</text>" + (c.next ? '<text x="' + cx.toFixed(1) + '" y="' + (H - 3) + '" class="es-xl nx" text-anchor="middle">NEXT</text>' : "");
    });
    return '<svg class="es-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Actual vs consensus">' + s + "</svg>" +
      '<div class="legend"><span><span class="sw" style="background:#3fb97f"></span>Actual ≥ consensus</span><span><span class="sw" style="background:#e0453a"></span>Actual &lt; consensus</span><span><span class="sw" style="background:#e8a33d"></span>Consensus mean</span><span><span class="sw" style="background:#8fa3bf"></span>High–low range</span></div>';
  }
  function estCard(M) {
    var X = STR[M.co.ticker] || {}, C = estCols(M), k = EV.k;
    if (!SD(M)) return shell(M, "est", '<div class="ue-ph">' + (X.loading ? '<i class="ux-spin"></i> Loading consensus…' : "Consensus estimates are not available for " + esc(M.co.ticker) + (X.err ? " (" + esc(X.err) + ")" : "") + ".") + "</div>");
    var f = k === "eps" ? e$ : m$, rec = C.filter(function (c) { return c.past; }).slice(-1)[0];
    var fresh = rec && Date.now() - Date.parse(rec.end + "T12:00:00Z") < 120 * 864e5 && prFor(M) ? rec.end : null;
    function seg(attr, cur, opts) { return '<div class="seg mi-vs">' + opts.map(function (o) { return "<button " + attr + '="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>"; }
    var head = '<div class="es-bar">' + seg("data-esk", k, [["eps", "EPS"], ["rev", "Revenue"]]) + seg("data-esv", EV.v, [["table", "Table"], ["chart", "Chart"], ["both", "Both"]]) + "</div>";
    function row(lab, fn, cls) { return "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td>" + lab + "</td>" + C.map(function (c) { var x = c[k]; return '<td class="' + (c.next ? "es-nx " : "") + (c.fy ? "es-fy " : "") + (fresh && c.end === fresh ? "es-new " : "") + '">' + (x ? fn(x, c) : "—") + "</td>"; }).join("") + "</tr>"; }
    function sg(v, s2) { return v == null ? "—" : '<span class="' + (v >= 0 ? "pos" : "neg") + '">' + s2 + "</span>"; }
    var tbl = '<div class="tbl-scroll"><table class="cx-t es-t"><thead><tr><th>' + (k === "eps" ? "EPS (adjusted)" : "Revenue") + "</th>" + C.map(function (c) { return '<th class="' + (c.next ? "es-nx" : c.fy ? "es-fy" : fresh && c.end === fresh ? "es-new" : "") + '">' + esc(c.lab) + (c.next ? "<small>NEXT REPORT</small>" : fresh && c.end === fresh ? "<small>JUST REPORTED</small>" : c.past ? "<small>reported</small>" : c.fy ? "<small>fiscal year</small>" : "<small>following</small>") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      '<tr class="mx-h"><td colspan="' + (C.length + 1) + '">Wall St. consensus</td></tr>' +
      row("Mean", function (x) { return f(x.avg); }) + row("High", function (x) { return f(x.hi); }) + row("Low", function (x) { return f(x.lo); }) + row("Analysts", function (x) { return x.n == null ? "—" : String(x.n); }) +
      '<tr class="mx-h"><td colspan="' + (C.length + 1) + '">Actuals</td></tr>' +
      row("Actual", function (x) { return x.act == null ? "—" : "<b>" + f(x.act) + "</b>"; }, "es-act") +
      (k === "eps" ? row("Surprise", function (x) { return sg(x.sur, pc(x.sur)); }) : "") +
      row("YoY growth", function (x, c) { var g = c.past ? x.yoy : x.g; return sg(g, pc(g, 0)); }) +
      "</tbody></table></div>";
    var rv = C.filter(function (c) { return !c.past && c.tr; }).map(function (c) { var t = c.tr, ch = t.d30 ? (t.now / t.d30 - 1) * 100 : null, ch90 = t.d90 ? (t.now / t.d90 - 1) * 100 : null;
      return "<tr><td>" + esc(c.lab) + (c.next ? " · next" : "") + "</td><td>" + e$(t.now) + "</td><td>" + e$(t.d30) + "</td><td>" + sg(ch, pc(ch)) + "</td><td>" + e$(t.d90) + "</td><td>" + sg(ch90, pc(ch90)) + "</td><td>" + (c.rv ? '<span class="pos">▲ ' + (c.rv.up30 || 0) + '</span> <span class="neg">▼ ' + (c.rv.down30 || 0) + "</span>" : "—") + "</td></tr>"; }).join("");
    var D = SD(M), notes = [], nx = C.filter(function (c) { return c.next; })[0];
    if (rec && rec.eps && rec.eps.sur != null) notes.push(rec.lab + ": EPS " + e$(rec.eps.act) + " vs " + e$(rec.eps.avg) + " consensus (" + pc(rec.eps.sur) + (rec.eps.sur >= 0 ? " beat" : " miss") + ").");
    var beats = C.filter(function (c) { return c.past && c.eps && c.eps.sur != null; }), nb = beats.filter(function (c) { return c.eps.sur >= 0; }).length;
    if (beats.length) notes.push("Beat EPS consensus in " + nb + " of the last " + beats.length + " quarters.");
    if (nx && nx.rev && nx.rev.avg) notes.push(nx.lab + " consensus: revenue " + m$(nx.rev.avg) + " (" + m$(nx.rev.lo) + "–" + m$(nx.rev.hi) + ", " + nx.rev.n + " analysts), EPS " + e$(nx.eps && nx.eps.avg) + ".");
    return shell(M, "est", head + (EV.v !== "table" ? estChart(C, k) : "") + (EV.v !== "chart" ? tbl : "") +
      (rv ? '<h3 class="es-h3">EPS estimate revisions</h3><div class="tbl-scroll"><table class="cx-t es-t"><thead><tr><th>Period</th><th>Now</th><th>30 days ago</th><th>Change</th><th>90 days ago</th><th>Change</th><th>Revisions, 30 days</th></tr></thead><tbody>' + rv + "</tbody></table></div>" : "") +
      (notes.length ? '<div class="obs-box"><b>OBSERVATIONS</b><ul>' + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="stamp">Consensus: ' + esc(D.provider) + " · fetched " + esc(new Date(D.fetched_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET. EPS consensus and actual are on the analysts’ adjusted basis. Revenue actuals come from SEC filings (or the company’s press release before the 10-Q). " +
      "High and low for reported quarters are not published by the source, so they show “—”. Nothing is estimated here.</div>");
  }
  function ownCard(M) {
    var X = STR[M.co.ticker] || {}, D = SD(M), O = D && D.own;
    if (!O || (O.inst_pct == null && O.insiders_pct == null)) return shell(M, "own", '<div class="ue-ph">' + (X.loading ? '<i class="ux-spin"></i> Loading ownership…' : "Ownership data is not available for " + esc(M.co.ticker) + (X.err ? " (" + esc(X.err) + ")" : "") + ".") + "</div>");
    var ins = O.inst_pct, isd = O.insiders_pct, oth = ins != null && isd != null ? Math.max(0, 100 - ins - isd) : null;
    var B = [["Institutions", ins, "#e8a33d"], ["Insiders", isd, "#3b82f6"], ["Others", oth, "#5b6b82"]].filter(function (b) { return b[1] != null; });
    var R = 92, bub = B.map(function (b) { var r = Math.max(26, Math.sqrt(b[1] / 100) * R); return '<div class="ow-b" style="width:' + (2 * r).toFixed(0) + "px;height:" + (2 * r).toFixed(0) + "px;background:" + b[2] + '"><b>' + b[1].toFixed(2) + "%</b><span>" + b[0] + "</span></div>"; }).join("");
    function kv(l, v) { return v == null || v === "" ? "" : '<div><span>' + l + "</span><b>" + v + "</b></div>"; }
    function sh(v) { return v == null ? null : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : (v / 1e6).toFixed(1) + "M"; }
    var stats = '<div class="ow-k">' + kv("Institutions", ins != null ? ins.toFixed(2) + "% of shares" : null) + kv("Institutions, % of float", O.inst_float_pct != null ? O.inst_float_pct.toFixed(2) + "%" : null) + kv("Number of institutions", O.inst_count != null ? O.inst_count.toLocaleString("en-US") : null) +
      kv("Insiders", isd != null ? isd.toFixed(2) + "%" : null) + kv("Shares outstanding", sh(O.shares_out)) + kv("Float", sh(O.float)) + kv("Short interest", O.short_shares != null ? sh(O.short_shares) + (O.short_pct_float != null ? " · " + O.short_pct_float.toFixed(2) + "% of float" : "") : null) + "</div>";
    var H = (O.holders || []).filter(function (h) { return h.name; });
    var tb = H.length ? '<h3 class="es-h3">Largest institutional holders <small>13F filings</small></h3><div class="tbl-scroll"><table class="cx-t es-t ow-t"><thead><tr><th>Holder</th><th>% held</th><th>Shares</th><th>Value</th><th>Change in position</th><th>As of</th></tr></thead><tbody>' +
      H.map(function (h) { return "<tr><td>" + esc(h.name) + "</td><td>" + (h.pct != null ? h.pct.toFixed(2) + "%" : "—") + "</td><td>" + (sh(h.shares) || "—") + "</td><td>" + m$(h.value) + '</td><td class="' + (h.chg_pct > 0 ? "pos" : h.chg_pct < 0 ? "neg" : "") + '">' + pc(h.chg_pct) + "</td><td>" + esc(h.asof || "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "";
    return shell(M, "own", '<div class="ow-wrap"><div class="ow-bub">' + bub + "</div>" + stats + "</div>" + tb +
      '<div class="stamp">' + esc(D.provider) + ". Institutions = holders filing 13F reports (quarterly, up to 45 days after quarter end); insiders = officers, directors and 10% owners; others = the rest of the shares (retail and non-filers), calculated as 100% less the two. Value at the holder’s report date.</div>");
  }

  /* tiles: chart, table or both (remembered in this browser) */
  var TV = (function () { try { return localStorage.getItem("desk.coTiles") || "chart"; } catch (e) { return "chart"; } })();
  function miniT(M, k) {
    var a = S(M, k).slice(-5), y = S(M, k + "_yoy").slice(-5); if (!a.some(function (z) { return z.v != null; })) return "";
    return '<table class="cx-mt"><tbody>' + a.map(function (z, i) { var yy = y[i] && y[i].v; return "<tr><td>" + esc(z.label) + "</td><td>" + fv(k, z.v) + "</td><td>" + (yy == null ? "" : sgc(tone(k, yy), fv(k + "_yoy", yy))) + "</td></tr>"; }).reverse().join("") + "</tbody></table>";
  }
  /* ---- tile detail (owner, Nov 17 2026): every metric tile (receivables, inventory, margins, debt…) opens the same panel as the
     results scorecard — latest quarter vs prior quarter (QoQ) and year ago (YoY), median of the last five quarters ---- */
  var GD = null;
  function gDiff(k, a, b) { if (a == null || b == null) return null; var d = a - b; d = Math.round(d * (XR[k] ? 100 : 10)) / (XR[k] ? 100 : 10);
    if (PCT[k]) return { t: (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1) + " pp", v: d };
    if (DAYS[k]) return { t: (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1) + " d", v: d };
    if (XR[k]) return { t: (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(2) + "×", v: d };
    if (!b) return null; var g = (a / b - 1) * 100 * (b < 0 ? -1 : 1); return { t: (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g).toFixed(1) + "%", v: g }; }
  function gDetail(M, id, k, label, inCard) {
    var P = S(M, k).filter(function (z) { return z.v != null; }); if (!P.length) return "";
    var last5 = P.slice(-5), c = last5[last5.length - 1], pq = P.length > 1 ? P[P.length - 2] : null, ya = P.length > 4 ? P[P.length - 5] : null, md = med(last5.map(function (z) { return z.v; }));
    var f = function (v) { return fv(k, v); }, tn = function (x) { return x == null ? "" : tone(k, x.v) > 0.05 ? "pos" : tone(k, x.v) < -0.05 ? "neg" : ""; };
    function box(l, ref, dd) { return '<div class="rd-b"><span>' + l + "</span><b>" + (ref ? f(ref.v) : "—") + "</b>" + (ref && ref.label ? "<small>" + esc(ref.label) + "</small>" : "") + (dd ? '<i class="' + tn(dd) + '">' + esc(c.label) + " " + dd.t + "</i>" : "") + "</div>"; }
    var dq = gDiff(k, c.v, pq && pq.v), dy = gDiff(k, c.v, ya && ya.v), dm = gDiff(k, c.v, md);
    var vs = box("Latest quarter", c, null) + box("vs prior quarter (QoQ)", pq, dq) + box("vs year ago (YoY)", ya, dy) + box("Median, last " + last5.length + " quarters", md == null ? null : { v: md, label: last5[0].label + "–" + c.label }, dm);
    var vals = last5.map(function (z) { return z.v; }).concat(md != null ? [md] : []), lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (PCT[k] || DAYS[k] || XR[k]) { var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = (mx - mn) * 0.4 || Math.abs(mx) * 0.1 || 1; lo = Math.min(lo, mn - pad); if (mn > 0) lo = Math.max(0, mn - pad); hi = mx + pad * 0.6; } else hi *= 1.12;
    var W = window.innerWidth < 700 ? 340 : 520, H = window.innerWidth < 700 ? 190 : 170, PL = 8, PR = 8, PT = 18, PB = 26, pw = W - PL - PR, ph = H - PT - PB, n = last5.length, bw = pw / n;
    function Y(v) { return PT + ph * (1 - (v - lo) / ((hi - lo) || 1)); }
    var y0 = Y(Math.max(lo, Math.min(0, hi))), g = last5.map(function (z, i) { var cx = PL + bw * (i + 0.5), w = Math.min(56, bw * 0.55), y = Y(z.v);
      return '<rect x="' + (cx - w / 2).toFixed(1) + '" y="' + Math.min(y, y0).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - y)).toFixed(1) + '" rx="3" class="' + (i === n - 1 ? "rd-c" : "rd-p") + '"/>' +
        '<text x="' + cx.toFixed(1) + '" y="' + (Math.min(y, y0) - 5).toFixed(1) + '" text-anchor="middle" class="rd-v">' + f(z.v) + '</text><text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="rd-x' + (i === n - 1 ? " c" : "") + '">' + esc(z.label) + "</text>"; }).join("");
    if (md != null) g += '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(md).toFixed(1) + '" y2="' + Y(md).toFixed(1) + '" class="rd-m"/>';
    var idx = P.length - last5.length;
    var tb = '<div class="tbl-scroll"><table class="cx-t rd-t"><thead><tr><th>Quarter</th><th>' + esc(label) + "</th><th>QoQ</th><th>YoY</th></tr></thead><tbody>" + last5.map(function (z, i) {
      var a = gDiff(k, z.v, P[idx + i - 1] && P[idx + i - 1].v), b = gDiff(k, z.v, P[idx + i - 4] && P[idx + i - 4].v);
      return "<tr" + (i === n - 1 ? ' class="rd-now"' : "") + '><td class="lbl">' + esc(z.label) + '</td><td data-l="' + esc(label) + '">' + f(z.v) + '</td><td data-l="QoQ" class="' + tn(a) + '">' + (a ? a.t : "—") + '</td><td data-l="YoY" class="' + tn(b) + '">' + (b ? b.t : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>";
    var read = [];
    if (dm) read.push(esc(label) + " of " + f(c.v) + " is " + (Math.abs(dm.v) < 0.05 ? "in line with" : dm.v > 0 ? "above" : "below") + " its " + last5.length + "-quarter median of " + f(md) + (Math.abs(dm.v) < 0.05 ? "." : " (" + dm.t + ")."));
    if (dq && dy && dq.v && dy.v) read.push((dq.v > 0) === (dy.v > 0) ? (dq.v > 0 ? "Higher" : "Lower") + " than both the prior quarter (" + dq.t + ") and a year ago (" + dy.t + ")." : "Mixed: " + dq.t + " on the prior quarter, " + dy.t + " on a year ago.");
    else if (dq && dy) read.push((dq.v ? dq.t + " on the prior quarter" : "Unchanged on the prior quarter") + ", " + (dy.v ? dy.t + " on a year ago." : "unchanged on a year ago."));
    if (dy && Math.abs(tone(k, dy.v)) > 0.05) read.push("Year on year this is " + (tone(k, dy.v) > 0 ? "an improvement" : "a deterioration") + (DAYS[k] || /debt|ap$|cogs|capex/.test(k) ? " (for this line, lower is better)." : "."));
    return '<div class="rsd gd" role="region" aria-label="' + esc(label) + ' detail"><div class="rd-h"><b>' + esc(label) + '</b><span>QoQ · YoY · ' + last5.length + '-quarter median</span>' + (inCard ? "" : '<button class="ue-btn" data-cocard="' + id + '">Open full card ›</button><button class="ue-btn" data-cogd="' + id + '" aria-label="Close">✕</button>') + "</div>" +
      '<div class="rd-g">' + vs + '</div><div class="rd-2"><div><svg class="rd-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + ', last quarters">' + g + "</svg>" +
      (md != null ? '<div class="legend"><span><span class="sw" style="background:#38b6c9"></span>Latest quarter</span><span><span class="sw" style="background:#3a4a60"></span>Earlier quarters</span><span><span class="sw" style="background:#e8a33d"></span>Median ' + f(md) + "</span></div>" : "") + "</div>" + tb + "</div>" +
      (read.length ? '<p class="rd-r">' + read.join(" ") + "</p>" : "") + '<div class="stamp">From SEC 10-Q/10-K filings, calculated the same way as the full card. Green = better, red = worse for this line. Median = middle value of the quarters shown.</div></div>';
  }
  function grid(M, VV) {
    var q = L(M), co = M.co;
    function tv(id, l) { return '<button data-cotv="' + id + '" aria-pressed="' + (TV === id) + '">' + l + "</button>"; }
    return '<div class="cx-top"><div class="cx-id"><span class="tk">' + esc(co.ticker) + "</span><div><b>" + esc(co.name) + "</b><small>" + esc(M.sector) + (co.sicDescription ? " · " + esc(co.sicDescription) : "") + " · latest quarter " + esc(q.fl.label) + " (" + esc(q.end) + ')<span class="cx-prof">' + PROFILE_NAME[profileOf(M)] + " tiles</span></small></div></div>" +
      '<div class="cx-vw" role="group" aria-label="Tile view"><span>Tiles</span>' + tv("chart", "Chart") + tv("table", "Table") + tv("both", "Both") + "</div></div>" +
      results(M) + '<div class="tile">' +
      (M.model.note ? '<div class="ut-ask" style="margin:6px 0">' + esc(M.model.note) + "</div>" : "") +
      partsOf(M).map(function (p) {
        if (!p[1].some(function (c) { return BUILT[c[0]]; }))
          return '<div class="cx-part dim">' + p[0] + ' <span>— ' + (/only/.test(p[0]) ? "in the company’s own reports, not in SEC’s data feed" : "not available yet") + ": " + p[1].map(function (c) { return esc(c[1]); }).join(" · ") + "</span></div>";
        return '<div class="cx-part">' + p[0] + '</div><div class="cx-grid">' + p[1].map(function (c) {
        var b = BUILT[c[0]], k = c[3] === "opm" && E.val(q, "opm") == null ? "ebitm" : c[3], kv = "", sp = "", tb = "", tn = null;
        if (b && k) { var qx = q;   /* a line missing in the latest quarter (not in the release, or no longer tagged): the latest quarter that has it, labelled */
          if (!(q.m[k] && q.m[k].v != null)) for (var jj = M.quarters.length - 2; jj >= Math.max(0, M.quarters.length - 5); jj--) { if (M.quarters[jj].m[k] && M.quarters[jj].m[k].v != null) { qx = M.quarters[jj]; break; } }
          var m = qx.m[k], y = qx.m[k + "_yoy"], asof = qx !== q ? ' <span class="cx-asof">latest reported</span>' : "";
          kv = '<div class="k">' + fv(k, m && m.v) + "</div>" + (y ? '<div class="n">' + sgc(tone(k, y.v), fv(k + "_yoy", y.v)) + " YoY · " + esc(qx.fl.label) + asof + "</div>" : '<div class="n">' + esc(qx.fl.label) + asof + "</div>"); sp = TV !== "table" ? spark(S(M, k)) : ""; tb = TV !== "chart" ? miniT(M, k) : ""; tn = y ? tone(k, y.v) : null; }
        if (/^val-/.test(c[0])) { var VV2 = E.valuation(M, (MEM[M.co.ticker] || {}).P);
          kv = VV2 ? '<div class="k">$' + VV2.price.toFixed(2) + '</div><div class="n">' + (c[0] === "val-snap" ? "P/E " + (VV2.pe ? VV2.pe.toFixed(1) + "×" : "n/m") + (VV2.pe_core ? " · core " + VV2.pe_core.toFixed(1) + "×" : "") : c[0] === "val-rx" ? "close " + esc(VV2.date) : "price " + esc(VV2.date)) + "</div>" : '<div class="n">price history unavailable</div>'; }
        if (c[0] === "est") { var C2 = estCols(M), nx2 = C2.filter(function (z) { return z.next; })[0], rc2 = C2.filter(function (z) { return z.past; }).slice(-1)[0];
          kv = SD(M) ? '<div class="k">' + (nx2 && nx2.eps ? e$(nx2.eps.avg) : "—") + '</div><div class="n">' + (nx2 ? esc(nx2.lab) + " EPS consensus" + (nx2.eps && nx2.eps.n ? " · " + nx2.eps.n + " analysts" : "") : "") + "</div>" + (rc2 && rc2.eps && rc2.eps.sur != null ? '<div class="n">' + esc(rc2.lab) + " " + sgc(rc2.eps.sur, pc(rc2.eps.sur)) + (rc2.eps.sur >= 0 ? " beat" : " miss") + "</div>" : "") : '<div class="n">' + (STR[M.co.ticker] && STR[M.co.ticker].loading ? "loading…" : "not available") + "</div>";
          tn = rc2 && rc2.eps && rc2.eps.sur != null ? rc2.eps.sur : null; }
        if (c[0] === "own") { var O2 = SD(M) && SD(M).own; kv = O2 && O2.inst_pct != null ? '<div class="k">' + O2.inst_pct.toFixed(1) + '%</div><div class="n">held by ' + (O2.inst_count ? O2.inst_count.toLocaleString("en-US") + " " : "") + "institutions" + (O2.insiders_pct != null ? " · insiders " + O2.insiders_pct.toFixed(1) + "%" : "") + "</div>" : '<div class="n">' + (STR[M.co.ticker] && STR[M.co.ticker].loading ? "loading…" : "not available") + "</div>"; }
        if (c[0] === "maturity") { var mt = E.maturities(M); kv = '<div class="k">' + (mt && mt.buckets[0] ? money(mt.buckets[0].v) : "—") + '</div><div class="n">due within 12 months' + (mt ? " · " + esc(mt.label) : " · not tagged") + "</div>"; }
        if (c[0] === "warn") { var WW = E.warnings(M), act = WW.filter(function (w) { return w.status === "ACTIVE"; }); tn = act.length ? -1 : 1;
          kv = '<div class="k">' + act.length + ' <small style="font-size:12px;color:var(--muted)">active of 12</small></div><div class="n">' + (act.length ? act.map(function (w) { return '<span class="cx-vd ' + (w.severity === "WATCH" ? "WEAK" : "NEGATIVE") + '" style="font-size:9px;padding:1px 5px">' + w.id + "</span>"; }).join(" ") : "none triggered") + "</div>"; }
        if (c[0] === "verdicts") kv = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' + VV.verdicts.map(function (v) { return '<span class="cx-vd ' + v.verdict + '" title="' + esc(v.name) + '">' + v.name.split(" ").map(function (w) { return w[0]; }).join("") + " " + v.verdict + "</span>"; }).join("") + "</div>";
        if (c[0] === "health") { var st = E.streak(VV.history, "eq"); kv = '<div class="n" style="margin-top:6px">' + VV.history.map(function (h) { return '<span class="cx-vd ' + h.eq + '" style="padding:1px 4px;font-size:9px">' + h.eq[0] + "</span>"; }).join(" ") + "</div>" + (st.n ? '<div class="n">' + st.n + " quarter" + (st.n > 1 ? "s" : "") + " " + (st.dir > 0 ? "improving" : "deteriorating") + "</div>" : ""); }
        var nd = b && has(M.co.ticker, c[0]) === false && !(k && S(M, k).some(function (z) { return z.v != null; })), cls = nd ? " nodata" : tn == null || Math.abs(tn) < 0.05 ? "" : tn > 0 ? " good" : " bad";
        var gk = b && !nd && k && S(M, k).filter(function (z) { return z.v != null; }).length ? k : null;
        return (GD && GD.id === c[0] ? "" : "") + '<button class="cx-card' + cls + (GD && GD.id === c[0] ? " on" : "") + '" ' + (gk ? 'data-cogd="' + c[0] + '" data-cok="' + gk + '" data-col="' + esc(c[1]) + '" aria-expanded="' + !!(GD && GD.id === c[0]) + '"' : 'data-cocard="' + c[0] + '"') + (b && !nd ? "" : " disabled") + (nd ? ' title="Not reported by this company"' : "") + '><span class="t">' + esc(c[1]) + "</span>" + kv + (sp ? "<div>" + sp + "</div>" : "") + tb + '<span class="q">' + esc(c[2] || "") + (b ? (nd ? " · not reported" : "") : " · next phase") + "</span></button>" + (GD && GD.id === c[0] ? gDetail(M, c[0], GD.k, c[1]) : ""); }).join("") + "</div>"; }).join("") +
      '<div class="stamp">Cards draw on SEC EDGAR filings fetched live — nothing is stored. Tile shading: green = better than a year ago, red = worse (for costs, debt and days, lower is better). Dimmed tiles have no figures for this company.</div></div>';
  }
  function shell(M, id, body) {
    return '<div class="tile"><div class="cx-h"><button class="ue-btn" data-cocard="">‹ All cards</button><h2>' + esc(cardTitle(id)) + '</h2><span class="cx-sub">' + esc(M.co.ticker) + " · " + esc(M.co.name) + "</span></div>" + body + "</div>";
  }

  /* ---------------- overview cards ---------------- */
  function snapCard(M, VV) {
    var q = L(M), co = M.co, rel = E.latestRelease(co), lastF = (co.filings || []).filter(function (f) { return /^10-[QK]/.test(f.form); })[0];
    var nxt = window.EARNINGS && EARNINGS._data && EARNINGS._data() && EARNINGS._data().calendar ? (EARNINGS._data().calendar.rows || []).filter(function (r) { return r.symbol === co.ticker && r.date >= new Date().toISOString().slice(0, 10); })[0] : null;
    function tile(k, label, extra) { var m = q.m[k], y = q.m[k + "_yoy"], p = q.m[k + "_qoq"];
      return '<div class="cx-tile"><div class="l">' + label + '</div><div class="v">' + fv(k, m && m.v) + '</div><div class="s">' + (y ? sgc(tone(k, y.v), (PCT[k] ? pp(y.v) : pc(y.v)) + " YoY") : "YoY —") + (p && !PCT[k] ? " · " + sgc(tone(k, p.v), pc(p.v) + " QoQ") : "") + "</div>" + (extra || "") + spark(S(M, k), PCT[k] ? C2 : C1) + "</div>"; }
    var hd = [["Exchange", co.exchange || (co.exchanges || [])[0] || "—"], ["Sector (SIC)", M.sector + " · " + (co.sicDescription || "")], ["Fiscal year-end", co.fiscalYearEnd ? co.fiscalYearEnd.slice(0, 2) + "/" + co.fiscalYearEnd.slice(2) : "—"], ["Reporting currency", "USD"],
      ["Latest quarter", q.fl.label + " (" + q.end + ")"], ["Latest 10-Q/10-K filed", lastF ? lastF.form + " · " + lastF.filed : "—"], ["Last earnings release", rel ? rel.filed + " (8-K 2.02)" : "—"], ["Next expected earnings", nxt ? nxt.date + " (FMP calendar)" : "UNAVAILABLE — not in the free calendar"]];
    var ttmTxt = function (k) { var t = ttmI(M, k); return t == null ? "" : '<div class="s">TTM ' + fv(k, t) + "</div>"; };
    return shell(M, "snap",
      '<dl class="ue-dl" style="grid-template-columns:auto 1fr auto 1fr;gap:4px 16px">' + hd.map(function (h) { return "<dt>" + h[0] + '</dt><dd style="text-align:left">' + esc(h[1]) + "</dd>"; }).join("") + "</dl>" +
      '<div class="cx-tiles">' + tile("rev", "Revenue", ttmTxt("rev")) + ('<div class="cx-tile"><div class="l">Revenue growth</div><div class="v">' + sgc(V(M, "rev_yoy"), pc(V(M, "rev_yoy"))) + '</div><div class="s">YoY · sequential ' + sgc(V(M, "rev_qoq"), pc(V(M, "rev_qoq"))) + "</div>" + spark(E.series(M, "rev_yoy", 8), C1) + "</div>") +
        tile("gm", "Gross margin") + tile("opm", "Operating margin") + tile("ni", "Net income", ttmTxt("ni")) + tile("eps_d", "Diluted EPS · GAAP", '<div class="s">Adjusted: UNAVAILABLE</div>') +
        tile("cfo", "Operating cash flow", ttmTxt("cfo")) + tile("fcf", "Free cash flow", ttmTxt("fcf")) + tile("gdebt", "Gross debt") + tile("ndebt", "Net debt") + "</div>" +
      '<div class="stamp">No composite score — the figures speak for themselves. Sparklines run over the last eight quarters; dashed or italic values are derived from year-to-date filings.</div>');
  }
  function verdictCard(M, VV) {
    return shell(M, "verdicts", '<div class="cx-vg">' + VV.verdicts.map(function (v) {
      function evl(a, cl) { return a.length ? a.map(function (e) { return '<div class="cx-ev ' + cl + '">' + esc(e.text) + ' <small>[' + esc(e.metric) + " · " + esc(e.period) + "]</small></div>"; }).join("") : '<div class="cx-ev" style="color:var(--faint)">none</div>'; }
      return '<div class="cx-v"><h3>' + esc(v.name) + ' <span class="cx-vd ' + v.verdict + '">' + v.verdict + '</span></h3><div class="qq">' + esc(v.q) + "</div>" +
        (v.verdict === "UNAVAILABLE" ? "" : '<div class="pi-l">Strongest support</div>' + evl(v.pos, "p") + '<div class="pi-l" style="margin-top:6px">Counterpoints &amp; risks</div>' + evl(v.neg, "n")) +
        '<div class="stamp">Direction ' + esc(v.direction || "—") + " · confidence " + esc(v.confidence || "—") + (v.inputs ? " · " + esc(v.inputs) : "") + (v.note ? "<br>" + esc(v.note) : "") + "</div></div>"; }).join("") + "</div>" +
      '<div class="stamp">Each verdict is independent and rule-based: every observation carries its metric and period, and the market verdict never feeds the fundamental ones.</div>');
  }
  function healthCard(M, VV) {
    var H = VV.history, sEQ = E.streak(H, "eq"), sFR = E.streak(H, "fr");
    function cell(v) { var bg = { STRONG: "rgba(63,185,127,.55)", SOLID: "rgba(63,185,127,.28)", MIXED: "rgba(176,189,207,.12)", WEAK: "rgba(232,163,61,.35)", STRETCHED: "rgba(232,163,61,.35)", NEGATIVE: "rgba(224,101,95,.5)" }[v];
      return '<td style="background:' + (bg || "transparent") + (bg ? "" : ";border:1px dashed var(--line2);color:var(--faint)") + '" title="' + v + '">' + (v === "UNAVAILABLE" ? "n/a" : v) + "</td>"; }
    function firstNeg(k) { var f = H.filter(function (h) { return h[k] === "NEGATIVE" || h[k] === "WEAK" || h[k] === "STRETCHED"; })[0]; return f ? f.label : null; }
    function resolved(k) { for (var j = H.length - 1; j > 0; j--) { if (/WEAK|NEGATIVE|STRETCHED/.test(H[j - 1][k]) && !/WEAK|NEGATIVE|STRETCHED/.test(H[j][k])) return H[j].label; } return null; }
    function line(nmx, k, st) { var fn = firstNeg(k), rs = resolved(k);
      return "<li><b>" + nmx + ":</b> " + (st.n ? st.n + " consecutive quarter" + (st.n > 1 ? "s" : "") + " " + (st.dir > 0 ? "of improvement" : "of deterioration") : "no consecutive run") + (fn ? " · first weak reading " + fn : " · no weak reading in the window") + (rs ? " · a weak reading resolved in " + rs : "") + "</li>"; }
    return shell(M, "health", '<div class="tbl-scroll"><table class="cx-hm"><thead><tr><th></th>' + H.map(function (h) { return "<th>" + esc(h.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      '<tr><td class="r">Earnings quality</td>' + H.map(function (h) { return cell(h.eq); }).join("") + "</tr>" +
      '<tr><td class="r">Financial resilience</td>' + H.map(function (h) { return cell(h.fr); }).join("") + "</tr>" +
      '<tr><td class="r">Forward outlook</td>' + H.map(function () { return cell("UNAVAILABLE"); }).join("") + "</tr>" +
      '<tr><td class="r">Market implication</td>' + H.map(function (h, i) { return cell(i === H.length - 1 ? VV.verdicts[3].verdict : "UNAVAILABLE"); }).join("") + "</tr></tbody></table></div>" +
      '<ul style="font-size:13px;line-height:1.6;margin:10px 0 0;padding-left:18px">' + line("Earnings quality", "eq", sEQ) + line("Financial resilience", "fr", sFR) + "</ul>" +
      '<div class="stamp">Each column re-runs the verdict rules using only the data filed up to that quarter, so a reading is what the filings said at the time. Outlook needs guidance and consensus (not free); market implication is only measured around the latest release.</div>');
  }

  /* ---------------- statement & cash-flow cards ---------------- */
  function page(M, id, k, main, tableKeys, annualKeys, extra, evKeys) {
    return shell(M, id, head(M, k) + '<div class="cx-sec">' + main + "</div>" +
      '<div class="cx-sec"><div class="pi-l">Eight-quarter history</div>' + table(M, tableKeys) + "</div>" +
      (annualKeys ? '<div class="cx-sec"><div class="pi-l">Annual history (10-K)</div>' + annualT(M, annualKeys) + "</div>" : "") +
      '<div class="cx-sec"><div class="pi-l">Industry comparison</div><div class="ue-ph">No peer benchmark yet — industry median, percentile and named competitors arrive with the industry-comparison phase. Nothing is shown rather than an invented benchmark.</div></div>' +
      '<div class="cx-sec"><div class="pi-l">Interpretation — rule-based, from the figures above</div>' + aiHTML(interp(M, k, extra)) + "</div>" + evidence(M, evKeys || tableKeys));
  }
  /* ---------------- quarterly matrix (owner's workbook view): metrics × quarters, fiscal-year totals, YoY / QoQ, FY vs FY ---------------- */
  var MX = "pl";
  var MXROWS = { pl: [["rev", "Total revenue", "$"], ["cogs", "Cost of revenue", "$"], ["gp", "Gross profit", "$"], ["gm", "Gross margin %", "%"], ["rnd", "R&D", "$"], ["sga", "SG&A", "$"], ["opx", "Total operating expenses", "$"],
      ["opinc", "Operating income", "$"], ["opm", "Operating margin %", "%"], ["oth", "Other income / (expense)", "$d"], ["pretax", "Pre-tax income", "$"], ["tax", "Tax provision", "$"], ["etr", "Effective tax rate %", "%"],
      ["ni", "Net income", "$"], ["nm", "Net margin %", "%"], ["eps_d", "Diluted EPS", "eps"], ["eps_b", "Basic EPS", "eps"], ["sh_d", "Diluted shares", "sh"]],
    bs: [["cash", "Cash & equivalents", "$"], ["sti", "Short-term investments", "$"], ["ar", "Accounts receivable", "$"], ["inv", "Inventory", "$"], ["ca", "Total current assets", "$"], ["assets", "Total assets", "$"],
      ["ap", "Accounts payable", "$"], ["accr", "Accrued liabilities", "$"], ["defrev", "Deferred revenue", "$"], ["stdebt", "Short-term debt", "$"], ["cl", "Total current liabilities", "$"], ["ltd_nc", "Long-term debt", "$"],
      ["oplease", "Operating lease liabilities", "$"], ["liab", "Total liabilities", "$"], ["eq", "Shareholders’ equity", "$"], ["gdebt", "Total debt", "$"], ["ndebt", "Net debt", "$d"], ["wcap", "Working capital", "$d"], ["cr", "Current ratio", "x"]],
    bpl: [["intinc", "Interest income", "$"], ["intexp_op", "Interest expense", "$"], ["nii", "Net interest income", "$"], ["nonii", "Non-interest income", "$"], ["rev", "Total net revenue", "$"], ["nonie", "Non-interest expense", "$"], ["eff", "Efficiency ratio %", "%"],
      ["prov", "Provision for credit losses", "$"], ["pretax", "Pre-tax income", "$"], ["tax", "Tax provision", "$"], ["ni", "Net income", "$"], ["eps_d", "Diluted EPS", "eps"], ["nim_a", "NII ÷ avg assets % (annualised)", "%"]],
    bbs: [["cash", "Cash & equivalents", "$"], ["loans_g", "Gross loans", "$"], ["acl", "Allowance for credit losses", "$"], ["npl", "Non-accrual loans", "$"], ["assets", "Total assets", "$"], ["deposits", "Deposits", "$"], ["ltd", "Long-term debt", "$"],
      ["liab", "Total liabilities", "$"], ["eq", "Shareholders’ equity", "$"], ["ldr", "Loan-to-deposit %", "%"], ["acl_pct", "Allowance ÷ loans %", "%"], ["npl_pct", "Non-accrual ÷ loans %", "%"], ["eq_a", "Equity ÷ assets %", "%"]],
    cf: [["cfo", "Operating cash flow", "$"], ["da", "Depreciation & amortisation", "$"], ["sbc", "Stock-based compensation", "$"], ["capex", "Capex (PP&E payments)", "$"], ["fcf", "Free cash flow", "$"], ["fcfm", "FCF margin %", "%"],
      ["acq", "Acquisitions", "$"], ["div", "Dividends paid", "$"], ["buyback", "Share buybacks", "$"], ["eqiss", "Stock issued", "$"], ["dissue", "Debt issued", "$"], ["drepay", "Debt repaid", "$"]] };
  function mxv(m, k) {   /* value + whether derived; operating expenses and other income are calculated when not tagged */
    var g = function (x) { return m[x] && m[x].v != null ? m[x].v : null; };
    if (k === "opx") { if (g("opex") != null) return { v: g("opex"), c: m.opex.st === "CALCULATED" }; if (g("gp") != null && g("opinc") != null) return { v: g("gp") - g("opinc"), c: true }; return null; }
    if (k === "oth") return g("pretax") != null && g("opinc") != null ? { v: g("pretax") - g("opinc"), c: true } : null;
    if (k === "stdebt") { var sd = ["stb", "cp", "dcur"].map(g).filter(function (x) { return x != null; }); return sd.length ? { v: sd.reduce(function (a, b) { return a + b; }, 0), c: sd.length > 1 } : null; }
    return g(k) == null ? null : { v: g(k), c: m[k].st === "CALCULATED" };
  }
  function fyTotals(M) {   /* a fiscal year counts only when all four quarters are on file; reported 10-K totals win where they exist */
    var by = {}; M.quarters.forEach(function (q) { (by[q.fl.fy] = by[q.fl.fy] || []).push(q); });
    return Object.keys(by).sort().filter(function (y) { return by[y].length === 4; }).map(function (y) {
      var Q4 = by[y], m = {}, sum = function (k) { var t = 0; for (var i = 0; i < 4; i++) { var x = mxv(Q4[i].m, k); if (!x) return null; t += x.v; } return t; };
      ["rev", "gp", "rnd", "sga", "opx", "opinc", "oth", "pretax", "tax", "ni", "eps_d", "cfo", "capex", "fcf"].forEach(function (k) { var v = sum(k); if (v != null) m[k] = { v: v, st: "CALCULATED" }; });
      var A = (M.annual || []).filter(function (a) { return String(a.fy) === String(y); })[0];
      if (A) Object.keys(A.m).forEach(function (k) { m[k] = { v: A.m[k].v, st: "REPORTED" }; });
      var r = m.rev && m.rev.v; if (r) [["gm", "gp"], ["opm", "opinc"], ["nm", "ni"], ["fcfm", "fcf"]].forEach(function (x) { if (m[x[1]]) m[x[0]] = { v: m[x[1]].v / r * 100, st: "CALCULATED" }; });
      if (m.tax && m.pretax && m.pretax.v) m.etr = { v: m.tax.v / m.pretax.v * 100, st: "CALCULATED" };
      return { fl: { label: "FY" + String(y).slice(2) }, fy: y, m: m, annual: !!A };
    });
  }
  function mxf(t, v) { if (v == null) return "—"; if (t === "%") return v.toFixed(1) + "%"; if (t === "eps") return (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2); if (t === "x") return v.toFixed(2) + "×";
    if (t === "sh") return (v / 1e6).toFixed(0) + "M";
    var a = Math.abs(v), s = v < 0 ? "−" : ""; return s + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(0) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(0)); }
  function mxd(t, a, b) {   /* change cell: % for amounts, pp for ratios, $ for small sign-flipping lines (other income) */
    if (a == null || b == null) return { s: "", v: null };
    if (t === "%") { var d = Math.round((a - b) * 10) / 10; return { s: (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1) + " pp", v: d }; }
    if (t === "x") { var dx = a - b; return { s: (dx > 0 ? "+" : dx < 0 ? "−" : "") + Math.abs(dx).toFixed(2) + "×", v: dx }; }
    if (t === "$d" || b === 0 || (a < 0) !== (b < 0)) { var d2 = a - b; return { s: (d2 > 0 ? "+" : d2 < 0 ? "−" : "") + mxf("$", Math.abs(d2)).replace("−", ""), v: d2 }; }
    var p = Math.round((a / b - 1) * 1000 * (b < 0 ? -1 : 1)) / 10; return { s: (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p).toFixed(1) + "%", v: p };
  }
  function matrixCard(M, kind) {
    MX = kind || "fy";
    var Q = M.quarters.slice(-10), FY = MX === "bs" ? [] : fyTotals(M).slice(-2), rows = MXROWS[profileOf(M) === "bank" && (MX === "pl" || MX === "bs") ? "b" + MX : MX === "fy" ? (profileOf(M) === "bank" ? "bpl" : "pl") : MX].filter(function (r) { return Q.some(function (q) { return mxv(q.m, r[0]); }); });   /* lines the company never files stay hidden */
    var yo = function (q) { var i = M.quarters.indexOf(q); for (var j = i - 1; j >= 0; j--) { var d = (Date.parse(q.end) - Date.parse(M.quarters[j].end)) / 864e5; if (d >= 350 && d <= 380) return M.quarters[j]; if (d > 380) break; } return null; };
    var pq = function (q) { var i = M.quarters.indexOf(q); return i > 0 ? M.quarters[i - 1] : null; };
    var tone = function (k, v) { return v == null || Math.abs(v) < 0.05 ? "" : (/^(rnd|sga|opx|tax|capex|etr|cogs|ap|accr|stdebt|cl|ltd_nc|oplease|liab|gdebt|ndebt|div|buyback|acq|drepay|sbc|sh_d)$/.test(k) ? -v : v) > 0 ? "pos" : "neg"; };
    var tabs = '<div class="seg mi-vs fin-tabs" style="margin:2px 0 10px"><span class="fin-cap">FINANCIALS</span>' + [["fin-is", "pl", "Income statement"], ["fin-bs", "bs", "Balance sheet"], ["fin-cf", "cf", "Cash flow"], ["matrix", "fy", "FY vs FY"]].map(function (x) { return '<button data-cocard="' + x[0] + '" aria-pressed="' + (MX === x[1]) + '">' + x[2] + "</button>"; }).join("") + "</div>";
    var body;
    if (MX === "fy") {
      if (FY.length < 2) body = '<div class="ue-ph">Two complete fiscal years (all four quarters on file) are needed for this view.</div>';
      else { var a = FY[0], b = FY[1], all = MXROWS.pl.concat(MXROWS.cf);
        body = '<div class="tbl-scroll"><table class="cx-t mx-t"><thead><tr><th>Metric</th><th>' + a.fl.label + "</th><th>" + b.fl.label + "</th><th>Change</th><th>Change %</th></tr></thead><tbody>" +
          all.map(function (r) { var x = a.m[r[0]], y = b.m[r[0]]; if (!x && !y) return ""; var xv = x && x.v, yv = y && y.v, d = xv != null && yv != null ? yv - xv : null, ch = mxd(r[2], yv, xv);
            return "<tr><td>" + esc(r[1]) + "</td><td>" + mxf(r[2], xv) + "</td><td>" + mxf(r[2], yv) + '</td><td class="' + tone(r[0], d) + '">' + (d == null ? "—" : r[2] === "%" ? ch.s : (d > 0 ? "+" : d < 0 ? "−" : "") + mxf(r[2], Math.abs(d)).replace("−", "")) + '</td><td class="' + tone(r[0], ch.v) + '">' + (r[2] === "%" || r[2] === "$d" ? "—" : ch.s || "—") + "</td></tr>"; }).join("") + "</tbody></table></div>"; }
    } else {
      var cols = Q.concat(FY), head = "<tr><th>Metric</th>" + cols.map(function (q) { return "<th" + (q.fy ? ' class="mx-fy"' : "") + ">" + esc(q.fl.label) + "</th>"; }).join("") + "</tr>";
      var blk = function (title, f) { return '<tr class="mx-h"><td colspan="' + (cols.length + 1) + '">' + title + "</td></tr>" + rows.map(function (r) { return "<tr><td>" + esc(r[1]) + "</td>" + cols.map(function (q) { return f(q, r); }).join("") + "</tr>"; }).join(""); };
      var cell = function (q, r) { var x = mxv(q.m, r[0]); return "<td" + (q.fy ? ' class="mx-fy"' : "") + (x && x.c ? ' data-calc="1" title="Calculated from reported lines"' : "") + ">" + mxf(r[2], x && x.v) + "</td>"; };
      var chg = function (ref) { return function (q, r) { var p = q.fy ? (ref === "y" ? FY.filter(function (f) { return f.fy === q.fy - 1; })[0] || fyTotals(M).filter(function (f) { return +f.fy === +q.fy - 1; })[0] : null) : ref === "y" ? yo(q) : pq(q);
        var x = mxv(q.m, r[0]), y = p && mxv(p.m, r[0]), c = mxd(r[2], x && x.v, y && y.v); return "<td" + (q.fy ? ' class="mx-fy ' : ' class="') + tone(r[0], c.v) + '">' + (c.s || "") + "</td>"; }; };
      body = '<div class="tbl-scroll"><table class="cx-t mx-t"><thead>' + head + "</thead><tbody>" + blk("Reported", cell) + blk("YoY — vs same quarter a year earlier", chg("y")) + blk("QoQ — vs prior quarter", chg("q")) + "</tbody></table></div>";
    }
    var lq = Q[Q.length - 1], ly = lq && yo(lq), rv = lq && mxv(lq.m, "rev"), ry = ly && mxv(ly.m, "rev"), notes = [];
    if (rv && ry) notes.push("Latest quarter " + lq.fl.label + ": revenue " + mxf("$", rv.v) + ", " + mxd("$", rv.v, ry.v).s + " YoY.");
    if (FY.length === 2 && FY[0].m.rev && FY[1].m.rev) notes.push(FY[1].fl.label + " revenue " + mxf("$", FY[1].m.rev.v) + " vs " + mxf("$", FY[0].m.rev.v) + " in " + FY[0].fl.label + " (" + mxd("$", FY[1].m.rev.v, FY[0].m.rev.v).s + ").");
    return shell(M, { pl: "fin-is", bs: "fin-bs", cf: "fin-cf", fy: "matrix" }[MX], tabs + body + (notes.length ? '<div class="obs-box"><b>OBSERVATIONS</b><ul>' + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div>" : "") +
      '<div class="stamp">From SEC 10-Q/10-K filings. ' + (MX === "bs" ? "Balance-sheet lines are quarter-end balances (no fiscal-year columns). " : "") + 'Italic = calculated (fourth quarter = annual less nine months; other income = pre-tax less operating income). Fiscal-year columns need all four quarters on file and use the 10-K total where one is reported. ' +
      "YoY on a margin is in percentage points; on other income it is the dollar change, since % moves on small, sign-flipping numbers mislead. Blank = no comparable period on file, never estimated. Segment and geography splits are not in SEC’s free data feed.</div>");
  }
  function revenueCard(M) {
    return page(M, "revenue", "rev",
      '<div class="cx-2"><div><div class="pi-l">Quarterly revenue</div>' + cols(S(M, "rev"), { label: "Quarterly revenue" }) + '</div><div><div class="pi-l">Year-on-year growth</div>' +
        lines([{ name: "Revenue YoY", color: C1, S: E.series(M, "rev_yoy", 8) }], { zero: true, label: "Revenue YoY growth" }) + "</div></div>" +
      '<div class="stamp">Two panels, one axis each: bars show the scale of the business, the line shows whether growth is accelerating. Sequential growth is in the table, never mixed with YoY.</div>',
      ["rev", "rev_yoy", "rev_qoq"], ["rev"], function (o, M2, q) {
        var g = E.val(q, "rev_yoy");
        if (g != null) (g >= 0 ? o.pos : o.neg).push("Revenue " + (g >= 0 ? "grew " : "fell ") + Math.abs(g).toFixed(1) + "% YoY [rev_yoy · " + q.fl.label + "].");
        o.gaps.push("Segment, geographic, organic, acquisition and FX splits are not in the structured filings — growth cannot be attributed between them here.");
        o.why.push("Volume, pricing, acquisitions or currency could each explain the change — the structured data does not separate them.");
        o.impl = g == null ? "Insufficient data." : g > 10 ? "The business is expanding at a double-digit pace; the question is whether margins and cash flow keep up (see the profitability and FCF cards)." : g < 0 ? "Revenue is contracting; check whether costs are falling as fast (gross and operating cards)." : "Growth is modest; profitability and cash conversion matter more for the investment case.";
        o.mon.push("Revenue YoY versus the prior two quarters, to confirm acceleration or slowdown.");
      }, ["rev"]);
  }
  function grossCard(M) {
    return page(M, "gross", "gm",
      '<div class="cx-2"><div><div class="pi-l">Gross margin</div>' + lines([{ name: "Gross margin", color: C1, S: S(M, "gm") }], { label: "Gross margin" }) + "</div>" +
        '<div><div class="pi-l">Revenue vs cost of revenue</div>' + lines([{ name: "Revenue", color: C1, S: S(M, "rev") }, { name: "Cost of revenue", color: C2, S: S(M, "cogs") }], { fmt: f$, label: "Revenue and cost of revenue" }) + "</div></div>",
      ["rev", "cogs", "gp", "gm"], ["rev", "gp"], function (o, M2, q) {
        var cg = E.val(q, "cogs_yoy"), rg = E.val(q, "rev_yoy"), d = E.val(q, "gm_yoy");
        if (M2.model.kind === "financial") o.gaps.unshift("Gross margin is not meaningful for this business model.");
        if (d != null) (d >= 0 ? o.pos : o.neg).push("Gross margin " + (d >= 0 ? "expanded " : "compressed ") + Math.abs(d).toFixed(1) + " pp YoY [gm_yoy · " + q.fl.label + "].");
        if (cg != null && rg != null) { (cg > rg ? o.neg : o.pos).push("Cost of revenue " + pc(cg) + " YoY against revenue " + pc(rg) + " [cogs_yoy, rev_yoy]."); if (cg > rg + 2) o.why.push("Input-cost inflation, discounting or mix shift toward lower-margin products."); if (rg > cg + 2) o.why.push("Pricing power, cheaper inputs or a richer product mix."); }
        o.gaps.push("Pricing, volume, freight and input-cost effects are only in management discussion, not the structured data.");
        o.impl = d == null ? "—" : d >= 0 ? "The company is retaining more of each revenue dollar after direct costs." : "Direct costs are absorbing more of revenue — watch whether pricing catches up.";
        o.mon.push("Gross margin against the same quarter last year (seasonality-safe comparison).");
      }, ["rev", "cogs", "gp", "gm"]);
  }
  function operatingCard(M) {
    var opx = ["sga", "rnd"].filter(function (k) { return S(M, k).some(function (s) { return s.v != null; }); });
    var hasOp = S(M, "opm").some(function (x) { return x.v != null; });
    return page(M, "operating", hasOp ? "opm" : "ebitm",
      '<div class="pi-l">Margins — one axis, percent of revenue</div>' + lines([{ name: "Gross", color: C1, S: S(M, "gm") }, { name: hasOp ? "Operating" : "EBIT (proxy)", color: C2, S: S(M, hasOp ? "opm" : "ebitm") }, { name: "EBITDA", color: C3, S: S(M, "ebitdam") }, { name: "Net", color: C4, S: S(M, "nm") }].filter(function (l) { return l.S.some(function (s) { return s.v != null; }); }), { label: "Margin trends", h: 220 }) +
      (opx.length ? '<div class="pi-l" style="margin-top:10px">Operating expense lines</div>' + lines(opx.map(function (k, i) { return { name: nm(k), color: [C2, C3][i], S: S(M, k) }; }), { fmt: f$, label: "Operating expenses" }) : ""),
      hasOp ? ["opinc", "opm", "ebitda", "ebitdam", "sga", "rnd", "da"] : ["ebit", "ebitm", "pretax", "intexp", "ebitda", "ebitdam", "sga", "da"], ["opinc"], function (o, M2, q) {
        if (!hasOp) o.gaps.unshift("This filer does not tag operating income; the card uses an EBIT proxy (pretax income + interest expense), which also includes non-operating items.");
        var d = E.val(q, "opm_yoy"), rg = E.val(q, "rev_yoy"), sg = E.val(q, "sga_yoy");
        if (d != null) (d >= 0 ? o.pos : o.neg).push("Operating margin " + (d >= 0 ? "widened " : "narrowed ") + Math.abs(d).toFixed(1) + " pp YoY [opm_yoy · " + q.fl.label + "].");
        if (sg != null && rg != null) { (sg > rg ? o.neg : o.pos).push("SG&A " + pc(sg) + " YoY vs revenue " + pc(rg) + " [sga_yoy, rev_yoy]" + (sg > rg ? " — costs growing faster than sales." : " — operating leverage.")); }
        if (E.val(q, "restr")) o.neg.push("Restructuring charges of " + money(E.val(q, "restr")) + " this quarter.");
        o.gaps.push("EBITDA here is operating income + D&A (calculated, non-GAAP); company-defined adjusted EBITDA is not in the structured filings.");
        o.why.push("Scale effects, cost programmes, wage or marketing inflation, or one-off charges.");
        o.impl = d == null ? "—" : d >= 0 ? "Revenue growth is reaching the operating line." : "Operating costs are taking a larger share of revenue.";
        o.mon.push("Whether operating expenses grow slower than revenue next quarter.");
      }, hasOp ? ["opinc", "opm", "ebitda", "da", "sga", "rnd"] : ["ebit", "ebitm", "pretax", "intexp", "ebitda", "da"]);
  }
  function epsCard(M) {
    return page(M, "eps", "eps_d",
      '<div class="cx-2"><div><div class="pi-l">Net income</div>' + cols(S(M, "ni"), { neg: "var(--red)", label: "Net income" }) + '<div class="pi-l">Net margin</div>' + lines([{ name: "Net margin", color: C4, S: S(M, "nm") }], { h: 140, zero: true }) + "</div>" +
        '<div><div class="pi-l">Diluted EPS — GAAP</div>' + cols(S(M, "eps_d"), { fmt: function (v) { return "$" + v.toFixed(2); }, neg: "var(--red)", label: "Diluted EPS" }) +
        '<div class="ue-ph" style="margin-top:8px">Adjusted (non-GAAP) EPS: UNAVAILABLE — not in the structured filings. GAAP and adjusted are never combined.</div></div></div>' +
        (S(M, "core_eps").some(function (x) { return x.v != null; }) ? '<div class="pi-l" style="margin-top:10px">Reported vs core EPS — core excludes gains/losses on equity investments</div>' +
          gbars(S(M, "eps_d").map(function (x) { return x.label + "|" + x.end; }), [{ name: "Reported diluted EPS", color: "#a9c1e8", vals: S(M, "eps_d").map(function (x) { return x.v; }) }, { name: "Core EPS (calculated)", color: WGT, vals: S(M, "core_eps").map(function (x) { return x.v; }) }],
            { fmt: function (v) { return "$" + v.toFixed(2); }, label: "Reported vs core EPS" }) : ""),
      ["pretax", "tax", "etr", "ni", "nm", "eps_d", "core_eps", "invgain", "sh_d", "sbc"], ["ni", "eps_d"], function (o, M2, q) {
        var ig = E.val(q, "invgain"); if (ig != null && E.val(q, "ni") && Math.abs(ig) > Math.abs(E.val(q, "ni")) * 0.1) (ig > 0 ? o.neg : o.pos).push("Equity-investment " + (ig > 0 ? "gains" : "losses") + " of " + money(Math.abs(ig)) + " moved net income this quarter — core EPS $" + (E.val(q, "core_eps") != null ? E.val(q, "core_eps").toFixed(2) : "—") + " vs reported $" + (E.val(q, "eps_d") != null ? E.val(q, "eps_d").toFixed(2) : "—") + ".");
        var ey = E.val(q, "eps_d_yoy"), ny = E.val(q, "ni_yoy"), sy = E.val(q, "sh_d_yoy"), et = E.val(q, "etr"), Q = M2.quarters, py = Q.length > 4 ? E.val(Q[Q.length - 5], "etr") : null;
        if (ey != null) (ey >= 0 ? o.pos : o.neg).push("Diluted EPS " + pc(ey) + " YoY [eps_d_yoy].");
        if (ey != null && ny != null && Math.abs(ey - ny) > 3) o.pos.push("EPS growth (" + pc(ey) + ") differs from net-income growth (" + pc(ny) + ") — the share count explains the gap [sh_d_yoy " + pc(sy) + "].");
        if (sy != null && sy > 1) o.neg.push("Diluted shares up " + sy.toFixed(1) + "% YoY — dilution [sh_d_yoy].");
        if (et != null && py != null && Math.abs(et - py) > 4) o.why.push("A tax-rate change (" + py.toFixed(0) + "% → " + et.toFixed(0) + "%) is moving net income independently of operations.");
        if (Q.slice(-8).some(function (x) { return x.m.eps_d && x.m.eps_d.approx; })) o.gaps.push("Some quarterly EPS is full year − nine months, which is approximate for per-share figures (≈).");
        o.gaps.push("Adjusted EPS, one-off items and adjustment dependence need the earnings release text — not yet parsed.");
        o.impl = ey == null ? "—" : ey > 0 && (ny == null || ny > 0) ? "Earnings per share are growing on reported (GAAP) numbers." : "Reported earnings per share are lower than a year ago.";
        o.mon.push("Effective tax rate and diluted share count next quarter.");
      }, ["ni", "eps_d", "sh_d", "tax", "pretax", "sbc"]);
  }
  function cfoCard(M) {
    var q = L(M), ni = E.val(q, "ni"), cfo = E.val(q, "cfo"), da = E.val(q, "da"), sbc = E.val(q, "sbc");
    var wc = (E.val(q, "d_ar") != null || E.val(q, "d_inv") != null || E.val(q, "d_ap") != null) ? -(E.val(q, "d_ar") || 0) - (E.val(q, "d_inv") || 0) + (E.val(q, "d_ap") || 0) : null;
    var bridge = ni != null && cfo != null ? waterfall([{ name: "Net income", v: ni, total: 1 }].concat(da != null ? [{ name: "D&A add-back", v: da }] : [], sbc != null ? [{ name: "Stock comp", v: sbc }] : [],
      wc != null ? [{ name: "Working capital", v: wc }] : [], [{ name: "Other items", v: cfo - ni - (da || 0) - (sbc || 0) - (wc || 0) }, { name: "Operating cash", v: cfo, total: 1 }])) : '<p class="note">Bridge needs net income and operating cash flow for ' + esc(q.fl.label) + ".</p>";
    return page(M, "cfo", "cfo",
      '<div class="cx-2"><div><div class="pi-l">Net income → operating cash flow · ' + esc(q.fl.label) + "</div>" + bridge + '<div class="stamp">Working capital = −Δreceivables − Δinventory + Δpayables as filed; “other” is the residual so the bridge always closes.</div></div>' +
        '<div><div class="pi-l">Operating cash flow, eight quarters</div>' + cols(S(M, "cfo"), { neg: "var(--red)", label: "Operating cash flow" }) + "</div></div>",
      ["ni", "cfo", "cfoni", "da", "sbc"], ["cfo"], function (o, M2, q2) {
        var t1 = E.ttm(M2.quarters, M2.quarters.length - 1, "cfo"), t2 = E.ttm(M2.quarters, M2.quarters.length - 1, "ni");
        if (t1 != null && t2 > 0) { var c = t1 / t2; (c >= 1 ? o.pos : o.neg).push("TTM operating cash flow is " + c.toFixed(2) + "× net income [cfo_ttm ÷ ni_ttm]."); }
        if (wc != null) (wc >= 0 ? o.pos : o.neg).push("Working capital " + (wc >= 0 ? "released " : "absorbed ") + money(Math.abs(wc)) + " in " + q2.fl.label + ".");
        o.why.push("Seasonal working-capital swings, timing of collections and supplier payments, or changes in non-cash charges.");
        o.impl = t1 != null && t2 > 0 ? (t1 / t2 >= 1 ? "Accounting profit is converting into cash." : "Cash generation trails reported profit — check receivables and inventory.") : "—";
        o.mon.push("Quarterly cash flow is seasonal — compare TTM, and the same quarter last year.");
      }, ["cfo", "ni", "da", "sbc"]);
  }
  function fcfCard(M) {
    return page(M, "fcf", "fcf",
      (function () { var A = M.annual.filter(function (a) { return a.m.cfo && a.m.capex; }), Qx = M.quarters, i = Qx.length - 1;
        var cats = A.map(function (a) { return "FY" + a.fy; }), cf = A.map(function (a) { return a.m.cfo.v; }), cx = A.map(function (a) { return a.m.capex.v; });
        var t1 = E.ttm(Qx, i, "cfo"), t2 = E.ttm(Qx, i, "capex"); if (t1 != null && t2 != null) { cats.push("TTM"); cf.push(t1); cx.push(t2); }
        if (!cats.length) return "";
        var gap = t1 != null && t2 != null ? (t2 >= t1 * 0.85 ? "Capex has caught up with cash flow" : "Cash flow covers capex comfortably") : "Operating cash flow vs capex";
        return '<h3 style="margin:0 0 2px;font-size:16px">' + gap + '</h3><div class="pi-l">Annual operating cash flow vs capex (10-K) plus trailing twelve months · capex guidance is not in the structured filings</div>' +
          gbars(cats, [{ name: "Operating cash flow", color: BASE, vals: cf }, { name: "Capex", color: "#d9734e", vals: cx }], { fmt: f$, lbl: money, label: "Annual OCF vs capex" }); })() +
      '<div class="pi-l" style="margin-top:10px">Operating cash flow, capex and free cash flow — quarterly</div>' + compo(S(M, "cfo"), S(M, "capex"), S(M, "fcf")) +
      '<div class="cx-2" style="margin-top:6px"><div><div class="pi-l">FCF margin</div>' + lines([{ name: "FCF margin", color: C3, S: S(M, "fcfm") }], { zero: true, h: 150 }) + '</div><div><div class="pi-l">Annual free cash flow</div>' +
        cols(M.annual.map(function (a) { return { label: "FY" + String(a.fy).slice(2), v: a.m.fcf ? a.m.fcf.v : null, st: "CALCULATED" }; }), { neg: "var(--red)", color: C3, h: 150 }) + "</div></div>",
      ["cfo", "capex", "fcf", "fcfm", "fcfconv", "capexint"], ["cfo", "capex", "fcf"], function (o, M2, q) {
        var Q = M2.quarters, i = Q.length - 1, f4 = E.ttm(Q, i, "fcf"), fy = E.val(q, "fcf_yoy"), cy = E.val(q, "capex_yoy"), oy = E.val(q, "cfo_yoy");
        if (M2.model.kind === "financial" || M2.model.kind === "insurer") o.gaps.unshift("Standard FCF is not meaningful for this business model.");
        if (f4 != null) (f4 > 0 ? o.pos : o.neg).push("TTM free cash flow " + money(f4) + " [fcf_ttm].");
        if (fy != null && fy > 0 && cy != null && cy < -10 && (oy == null || oy <= 0)) o.neg.push("FCF rose " + pc(fy) + " YoY mainly because capex fell " + pc(cy) + " while operating cash flow did not grow — lower investment, not stronger operations.");
        else if (fy != null && oy != null && oy > 0 && fy > 0) o.pos.push("FCF growth (" + pc(fy) + ") is backed by higher operating cash flow (" + pc(oy) + ").");
        var ci = E.val(q, "capexint"); if (ci != null && cy != null && cy > 20) o.why.push("Capex up " + pc(cy) + " (intensity " + ci.toFixed(1) + "% of revenue) — a deliberate investment phase or rising maintenance needs; the filings do not split growth and maintenance capex.");
        o.gaps.push("Company-defined FCF and growth vs maintenance capex need the earnings release / MD&A — not in the structured data.");
        o.impl = f4 == null ? "—" : f4 > 0 ? "The business funds its investment from operations and has cash left for shareholders and creditors." : "The business is consuming cash after investment — financing needs follow.";
        o.mon.push("Capex guidance and whether operating cash flow grows with it.");
      }, ["cfo", "capex", "fcf", "fcfm", "fcfconv"]);
  }


  /* ---------------- working capital ---------------- */
  function dayChart(M, keys) { return lines(keys.map(function (k, i) { return { name: nm(k), color: [C1, C2, C3, C4][i], S: S(M, k) }; }), { fmt: dfmt, label: keys.map(nm).join(", ") }); }
  function growthPair(M, a, b) { return lines([{ name: nm(a) + " YoY", color: C2, S: E.series(M, a + "_yoy", 8) }, { name: nm(b) + " YoY", color: C1, S: E.series(M, b + "_yoy", 8) }], { zero: true, label: nm(a) + " vs " + nm(b) + " growth" }); }
  function arCard(M) {
    return page(M, "wc-ar", "dso", '<div class="pi-l">Days sales outstanding</div>' + dayChart(M, ["dso"]) + '<div class="pi-l" style="margin-top:8px">Receivables growth vs revenue growth</div>' + growthPair(M, "ar", "rev"),
      ["ar", "ar_yoy", "rev_yoy", "dso", "allow", "ctrasset"], null, function (o, M2, q) {
        var a = E.val(q, "ar_yoy"), r = E.val(q, "rev_yoy"), dd = E.val(q, "dso_yoy");
        if (a != null && r != null) (a - r > 10 ? o.neg : a - r < -5 ? o.pos : o.pos).push("Receivables " + pc(a) + " YoY against revenue " + pc(r) + " [ar_yoy, rev_yoy]" + (a - r > 10 ? " — a widening gap." : "."));
        if (dd != null) (dd > 5 ? o.neg : dd < -3 ? o.pos : o.pos).push("DSO " + fv("dso_yoy", dd) + " versus a year ago [dso_yoy].");
        o.why.push("Longer payment terms, a quarter-end sales spike, acquisitions, customer mix or slower collections.");
        o.impl = dd == null ? "—" : dd > 5 ? "Customers are taking longer to pay — cash conversion may weaken unless this reverses." : "Collection speed is stable or improving.";
        o.mon.push("DSO against the same quarter next year (seasonality-safe), and the doubtful-accounts allowance.");
      }, ["ar", "dso", "allow", "ctrasset"]);
  }
  function invCard(M) {
    var comp = [["inv_raw", "Raw materials", C1], ["inv_wip", "Work in progress", C2], ["inv_fg", "Finished goods", C3]], hasComp = M.quarters.slice(-8).some(function (q) { return comp.some(function (c) { return E.val(q, c[0]); }); });
    return page(M, "wc-inv", "dio", '<div class="pi-l">Days inventory outstanding</div>' + dayChart(M, ["dio"]) + '<div class="pi-l" style="margin-top:8px">Inventory growth vs revenue growth</div>' + growthPair(M, "inv", "rev") +
      (hasComp ? '<div class="pi-l" style="margin-top:8px">Inventory composition</div>' + stack(M.quarters.slice(-8), comp, { label: "Inventory composition" }) : '<p class="note">Inventory composition (raw / WIP / finished) is not tagged by this filer.</p>'),
      ["inv", "inv_yoy", "rev_yoy", "dio", "inv_raw", "inv_wip", "inv_fg", "invwd"], null, function (o, M2, q) {
        if (!E.val(q, "inv")) { o.gaps.unshift("No inventory on the balance sheet — this card does not apply to the business model."); return; }
        var a = E.val(q, "inv_yoy"), r = E.val(q, "rev_yoy"), dd = E.val(q, "dio_yoy");
        if (a != null && r != null) (a - r > 10 ? o.neg : o.pos).push("Inventory " + pc(a) + " YoY against revenue " + pc(r) + " [inv_yoy, rev_yoy].");
        if (dd != null) (dd > 7 ? o.neg : o.pos).push("DIO " + fv("dio_yoy", dd) + " versus a year ago [dio_yoy].");
        if (E.val(q, "invwd")) o.neg.push("Inventory write-downs of " + money(E.val(q, "invwd")) + " this quarter.");
        o.why.push("A planned seasonal build, a product launch, supply-chain buffering, higher input prices carried in inventory value — or slowing sales.");
        o.impl = dd == null ? "—" : dd > 7 ? "Inventory is turning more slowly — watch for discounting or write-downs." : "Inventory is moving at a steady or faster pace.";
        o.mon.push("Whether DIO normalises next quarter, and any inventory write-downs.");
      }, ["inv", "dio", "inv_raw", "inv_wip", "inv_fg"]);
  }
  function apCard(M) {
    return page(M, "wc-ap", "dpo", '<div class="pi-l">Days payables outstanding</div>' + dayChart(M, ["dpo"]) + '<div class="pi-l" style="margin-top:8px">Payables growth vs cost-of-revenue growth</div>' + growthPair(M, "ap", "cogs"),
      ["ap", "ap_yoy", "cogs_yoy", "dpo", "accr"], null, function (o, M2, q) {
        var dd = E.val(q, "dpo_yoy"), a = E.val(q, "ap_yoy"), c = E.val(q, "cogs_yoy"), cfo = E.val(q, "cfo_yoy");
        if (dd != null) o[dd > 10 && cfo != null && cfo < 0 ? "neg" : "pos"].push("DPO " + fv("dpo_yoy", dd) + " versus a year ago [dpo_yoy]" + (dd > 10 && cfo != null && cfo < 0 ? " while operating cash flow fell — payments may be stretched to protect cash." : "."));
        if (a != null && c != null) o.pos.push("Payables " + pc(a) + " YoY vs cost of revenue " + pc(c) + ".");
        o.gaps.unshift("DPO uses cost of revenue as a proxy for supplier purchases (≈). Supplier-finance programmes are disclosed in notes, not the structured data.");
        o.why.push("Negotiated longer terms, supply-chain finance programmes, purchase timing — or delayed payments under cash pressure. Higher DPO is not automatically positive.");
        o.impl = dd == null ? "—" : "DPO " + (dd > 0 ? "lengthened" : "shortened") + "; read it alongside operating cash flow and DSO before calling it good or bad.";
        o.mon.push("DPO alongside cash flow: rising DPO with falling cash is the warning combination.");
      }, ["ap", "dpo", "cogs", "accr"]);
  }
  function cccCard(M) {
    var q = L(M), parts = ["dso", "dio", "dpo"].map(function (k) { return [k, E.val(q, k + "_yoy")]; });
    return page(M, "wc-ccc", "ccc", '<div class="pi-l">DSO, DIO and DPO — days</div>' + dayChart(M, ["dso", "dio", "dpo"]) + '<div class="pi-l" style="margin-top:8px">Cash conversion cycle</div>' + cols(S(M, "ccc"), { fmt: dfmt, neg: "var(--green)", color: C3, label: "Cash conversion cycle" }) +
      '<div class="pi-l" style="margin-top:8px">Working-capital cash effect (from the cash-flow statement)</div>' + cols(S(M, "wc_cf"), { neg: "var(--red)", color: "var(--green)", label: "Working capital cash effect" }),
      ["dso", "dio", "dpo", "ccc", "ccc_yoy", "wc_cf"], null, function (o, M2, q2) {
        var c = E.val(q2, "ccc_yoy");
        if (c != null) { (c > 5 ? o.neg : c < -5 ? o.pos : o.pos).push("Cash conversion cycle " + fv("ccc_yoy", c) + " versus a year ago [ccc_yoy].");
          var drv = parts.filter(function (x) { return x[1] != null; }).map(function (x) { return [x[0], x[0] === "dpo" ? -x[1] : x[1]]; }).sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); })[0];
          if (drv) o.pos.push("Largest driver: " + nm(drv[0]) + " (" + fv(drv[0] + "_yoy", E.val(q2, drv[0] + "_yoy")) + ")."); }
        var w = E.val(q2, "wc_cf"); if (w != null) (w >= 0 ? o.pos : o.neg).push("Working capital " + (w >= 0 ? "released " : "absorbed ") + money(Math.abs(w)) + " of cash in " + q2.fl.label + ".");
        o.impl = c == null ? "—" : c > 5 ? "More cash is tied up in operations than a year ago." : "Cash is cycling through operations as fast or faster than a year ago.";
        o.mon.push("Compare against the same quarter last year — working capital is seasonal.");
      }, ["dso", "dio", "dpo", "ccc", "wc_cf"]);
  }
  /* ---------------- capex & allocation ---------------- */
  function capexCard(M) {
    return page(M, "capex", "capex", '<div class="pi-l">Capex vs depreciation</div>' + lines([{ name: "Capex", color: C2, S: S(M, "capex") }, { name: "D&A", color: C1, S: S(M, "da") }], { fmt: f$, label: "Capex and D&A" }) +
      '<div class="pi-l" style="margin-top:8px">Capex intensity — % of revenue</div>' + lines([{ name: "Capex ÷ revenue", color: C2, S: S(M, "capexint") }], { h: 150, label: "Capex intensity" }),
      ["capex", "capex_yoy", "da", "capexda", "capexint", "rev_yoy"], ["capex"], function (o, M2, q) {
        var cd = E.val(q, "capexda"), cy = E.val(q, "capex_yoy"), r = E.val(q, "rev_yoy");
        if (cd != null) (cd > 1.2 ? o.pos : o.pos).push("Capex is " + cd.toFixed(2) + "× D&A [capexda] — " + (cd > 1.2 ? "net investment in the asset base." : cd < 0.8 ? "below the rate assets wear out." : "roughly maintaining the asset base."));
        if (cy != null && r != null && cy > 30 && r < 3) o.neg.push("Capex up " + pc(cy) + " YoY while revenue grew " + pc(r) + " — returns not yet visible.");
        o.gaps.unshift("Growth vs maintenance capex, capital commitments and capex guidance are not in the structured data — no split is inferred.");
        o.impl = cd == null ? "—" : cd > 1.5 ? "An investment phase: judge it by revenue, margin and returns in the quarters ahead." : "Investment broadly in line with depreciation.";
        o.mon.push("Revenue growth and ROIC over the next 4–8 quarters, to see whether the investment earns back.");
      }, ["capex", "da", "capexda", "capexint"]);
  }
  function allocCard(M) {
    var Q = M.quarters, i = Q.length - 1, t = function (k) { return E.ttm(Q, i, k); }, f4 = t("fcf");
    var steps = f4 == null ? null : [{ name: "FCF (TTM)", v: f4, total: 1 }].concat(
      [["div", "Dividends"], ["buyback", "Buybacks"], ["acq", "Acquisitions"]].filter(function (x) { return t(x[0]); }).map(function (x) { return { name: x[1], v: -t(x[0]) }; }),
      (t("dissue") != null || t("drepay") != null) ? [{ name: "Net debt flows", v: (t("dissue") || 0) - (t("drepay") || 0) }] : []);
    var gapsT = [["div", "dividends"], ["buyback", "buybacks"], ["acq", "acquisitions"]].filter(function (x) { return t(x[0]) == null && Q.slice(-4).some(function (q) { return E.val(q, x[0]) != null; }); }).map(function (x) { return x[1]; });
    if (steps) steps.push({ name: "Cash left", v: steps.reduce(function (a, s) { return s.total ? s.v : a + s.v; }, 0), total: 1 });
    return page(M, "alloc", "shret", '<div class="pi-l">Where the last twelve months of free cash flow went</div>' + (steps ? waterfall(steps) : '<p class="note">Needs four quarters of free cash flow.</p>') + (gapsT.length ? '<p class="note" style="color:var(--amber)">Not in the bridge: ' + gapsT.join(", ") + " — a quarter of the last four is not filed, so no TTM total is formed.</p>" : "") +
      '<div class="pi-l" style="margin-top:8px">Shareholder returns by quarter</div>' + stack(Q.slice(-8), [["div", "Dividends", C1], ["buyback", "Buybacks", C2]], { label: "Dividends and buybacks" }),
      ["fcf", "div", "buyback", "shret", "retained", "acq", "dissue", "drepay", "sbc", "sh_d"], null, function (o, M2, q) {
        var d4 = t("div") || 0, b4 = t("buyback") || 0, sb = t("sbc"), sy = E.val(q, "sh_d_yoy");
        if (f4 != null && f4 > 0) { var cov = (d4 + b4) / f4 * 100; (cov > 100 ? o.neg : o.pos).push("Dividends + buybacks were " + cov.toFixed(0) + "% of TTM FCF" + (cov > 100 ? " — funded partly by debt or cash balances." : ".")); }
        if (sb != null && b4) o[b4 >= sb ? "pos" : "neg"].push("Buybacks (" + money(b4) + " TTM) " + (b4 >= sb ? "exceed" : "fall short of") + " stock-based compensation (" + money(sb) + ")" + (sy != null ? "; diluted shares " + pc(sy) + " YoY." : "."));
        if (!b4) o.pos.push("No buybacks in the window — not a negative on its own.");
        o.impl = f4 == null ? "—" : f4 > 0 && d4 + b4 <= f4 ? "Distributions are covered by free cash flow." : "Distributions exceed free cash flow — sustainable only with balance-sheet capacity.";
        o.mon.push("FCF coverage of the dividend, and net share count.");
      }, ["div", "buyback", "acq", "dissue", "drepay", "sbc"]);
  }
  /* ---------------- debt ---------------- */
  function debtCard(M) {
    return page(M, "debt", "gdebt", '<div class="pi-l">Gross and net debt</div>' + lines([{ name: "Gross debt", color: C2, S: S(M, "gdebt") }, { name: "Net debt", color: C3, S: S(M, "ndebt") }, { name: "Cash", color: C1, S: S(M, "cash") }], { fmt: f$, zero: true, label: "Debt and cash" }) +
      '<div class="pi-l" style="margin-top:8px">Debt composition</div>' + stack(M.quarters.slice(-8), [["dcur", "Due within a year", C2], ["stb", "Short-term borrowings", C4], ["cp", "Commercial paper", C3], ["ltd_nc", "Long-term", C1]], { label: "Debt composition" }),
      ["gdebt", "gdebt_yoy", "ndebt", "cash", "sti", "dcur", "stb", "cp", "ltd_nc", "oplease", "finlease"], null, function (o, M2, q) {
        var g = E.val(q, "gdebt_yoy"), f = E.val(q, "fcf_yoy"), nd = E.val(q, "ndebt");
        if (nd != null) (nd < 0 ? o.pos : o.pos).push(nd < 0 ? "Net cash of " + money(-nd) + "." : "Net debt " + money(nd) + ".");
        if (g != null) (g > 15 ? o.neg : o.pos).push("Gross debt " + pc(g) + " YoY [gdebt_yoy]" + (f != null ? " against FCF " + pc(f) + "." : "."));
        o.gaps.unshift("Leases are shown separately and excluded from debt. Fixed/floating mix, currency and secured/unsecured split are in the notes, not structured data.");
        if (M2.model.kind !== "operating") o.gaps.unshift(M2.model.note);
        o.impl = g == null ? "—" : g > 15 ? "Debt is rising quickly — check whether cash generation and coverage keep pace (servicing card)." : "Debt is broadly stable.";
        o.mon.push("Debt growth against TTM free cash flow.");
      }, ["gdebt", "ndebt", "cash", "sti", "dcur", "stb", "cp", "ltd_nc", "oplease"]);
  }
  function costCard(M) {
    return page(M, "costdebt", "effcost", '<div class="pi-l">Borrowing cost — annualised, % of average gross debt</div>' + lines([{ name: "Effective interest cost", color: C2, S: S(M, "effcost") }, { name: "Cash borrowing cost", color: C1, S: S(M, "cashcost") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { label: "Borrowing cost" }) +
      '<div class="ue-ph" style="margin-top:8px">Weighted-average coupon and new-issue yield: UNAVAILABLE — they sit in the debt footnote tables, not the structured data. No rate is inferred from the balance alone.</div>',
      ["intexp", "intpaid", "gdebt", "effcost", "cashcost"], null, function (o, M2, q) {
        var e = E.val(q, "effcost"), ey = E.val(q, "effcost_yoy");
        if (ey != null) (ey > 0.5 ? o.neg : o.pos).push("Effective interest cost " + fv("effcost_yoy", ey) + " versus a year ago [effcost_yoy].");
        if (e != null && (e > 15 || e < 0.3)) o.gaps.unshift("An implausible rate (" + e.toFixed(1) + "%) usually means interest includes items outside the debt measured here (e.g. a finance arm or deposits) — treat with caution.");
        o.gaps.unshift("Average debt is the opening/closing average (≈); capitalised and lease interest are not separated in the structured data.");
        o.why.push("Refinancing maturing low-coupon debt at higher rates, floating-rate exposure, or a change in debt mix.");
        o.impl = ey == null ? "—" : ey > 0.5 ? "The financing burden is getting more expensive." : "Borrowing cost is stable or falling.";
        o.mon.push("Interest expense against average debt next quarter, and any new bond issues.");
      }, ["intexp", "intpaid", "gdebt", "effcost", "cashcost"]);
  }
  function maturityCard(M) {
    var mt = E.maturities(M), q = L(M);
    if (!mt) return shell(M, "maturity", '<div class="ue-ph">This filer does not tag its principal-maturity schedule in the structured data (it is in the debt footnote). No ladder is drawn rather than an estimated one.</div>');
    var lab = ["Next 12 months", "Year 2", "Year 3", "Year 4", "Year 5", "After year 5"], liq = (mt.cash || 0) + (mt.sti || 0);
    var m1 = mt.buckets[0] && mt.buckets[0].v, m23 = (mt.buckets[1] ? mt.buckets[1].v : 0) + (mt.buckets[2] ? mt.buckets[2].v : 0), tot = mt.buckets.reduce(function (a, b) { return a + (b ? b.v : 0); }, 0);
    var o = { cur: "", hist: "", ind: "No peer benchmark yet.", pos: [], neg: [], why: [], impl: "", mon: [], gaps: [] };
    o.cur = "As of " + mt.label + " (" + mt.end + "): " + money(m1) + " of principal due within 12 months, " + money(m23) + " in years 2–3, " + money(tot) + " scheduled in total.";
    o.hist = "The schedule is disclosed once a year in the 10-K, so there is no quarterly history.";
    if (m1 != null) (m1 <= liq ? o.pos : o.neg).push("Cash and short-term investments (" + money(liq) + ") " + (m1 <= liq ? "cover" : "do not cover") + " the next 12 months’ maturities.");
    if (mt.revolver != null) o.pos.push("Undrawn committed facilities: " + money(mt.revolver) + ".");
    else o.gaps.push("Undrawn credit capacity is not tagged — liquidity coverage counts cash only.");
    if (tot && m1 / tot > 0.25) o.neg.push(((m1 / tot) * 100).toFixed(0) + "% of scheduled principal falls due within a year — a near-term concentration.");
    o.impl = m1 == null ? "—" : m1 <= liq + (mt.revolver || 0) ? "Near-term maturities are covered by available liquidity." : "Near-term maturities exceed cash and undrawn facilities — refinancing access matters.";
    o.mon.push("Refinancing announcements and the next 10-K schedule."); o.gaps.push("Fixed/floating mix and covenants are footnote-only.");
    return shell(M, "maturity", '<div class="cx-hd"><div><div class="lab">Due within 12 months · ' + esc(mt.label) + '</div><div class="big">' + money(m1) + '</div></div><div><div class="lab">Cash + short-term investments</div><div class="m">' + money(liq) + '</div></div><div><div class="lab">Undrawn facilities</div><div class="m">' + money(mt.revolver) + "</div></div></div>" +
      '<div class="pi-l">Principal maturity ladder</div>' + bars(mt.buckets.map(function (b, i) { return { label: lab[i], v: b ? b.v : null, color: i === 0 ? C2 : C1 }; }).concat([{ label: "Cash + ST investments", v: liq, color: "var(--green)" }])) +
      '<div class="cx-sec"><div class="pi-l">Interpretation — rule-based, from the figures above</div>' + aiHTML(o) + "</div>" + evidence(M, ["cash", "sti", "revolver", "gdebt"]));
  }
  function serviceCard(M) {
    return page(M, "service", "int_cov", '<div class="pi-l">Interest coverage — TTM EBIT ÷ interest</div>' + lines([{ name: "Interest coverage", color: C1, S: S(M, "int_cov") }], { fmt: xfmt, h: 160 }) +
      '<div class="pi-l" style="margin-top:8px">Net debt ÷ TTM EBITDA</div>' + lines([{ name: "Net leverage", color: C2, S: S(M, "nd_ebitda") }], { fmt: xfmt, h: 160, zero: true }) +
      '<div class="pi-l" style="margin-top:8px">Cash interest burden — % of TTM operating cash flow</div>' + lines([{ name: "Cash interest burden", color: C4, S: S(M, "intburden") }], { h: 150 }),
      ["int_cov", "nd_ebitda", "intburden", "fcf_debt", "ebitda_ttm", "fcf_ttm"], null, function (o, M2, q) {
        var c = E.val(q, "int_cov"), l = E.val(q, "nd_ebitda"), cy = E.val(q, "int_cov_yoy"), ly = E.val(q, "nd_ebitda_yoy");
        if (M2.model.kind === "financial" || M2.model.kind === "insurer") o.gaps.unshift("EBITDA-based leverage is not meaningful for this business model.");
        if (cy != null) (cy < 0 ? o.neg : o.pos).push("Interest coverage " + fv("int_cov_yoy", cy) + " versus a year ago.");
        if (ly != null) (ly > 0.3 ? o.neg : o.pos).push("Net leverage " + fv("nd_ebitda_yoy", ly) + " versus a year ago.");
        o.impl = c == null ? "—" : c > 8 ? "Earnings carry the interest bill comfortably." : c < 3 ? "Interest absorbs a large share of operating earnings." : "Coverage is adequate.";
        o.mon.push("Debt growth against TTM FCF growth; coverage after the next quarter.");
      }, ["int_cov", "nd_ebitda", "intburden", "fcf_debt", "ebitda_ttm"]);
  }
  /* ---------------- ratios ---------------- */
  function liqCard(M) {
    return page(M, "liq", "cr", '<div class="pi-l">Liquidity ratios</div>' + lines([{ name: "Current", color: C1, S: S(M, "cr") }, { name: "Quick", color: C2, S: S(M, "qr") }, { name: "Cash", color: C3, S: S(M, "cashr") }], { fmt: function (v) { return v.toFixed(1) + "×"; }, ref: 1, label: "Liquidity ratios" }) +
      '<div class="stamp">Dashed line = 1.0×.</div><div class="pi-l" style="margin-top:8px">Current assets vs current liabilities</div>' + lines([{ name: "Current assets", color: C1, S: S(M, "ca") }, { name: "Current liabilities", color: C2, S: S(M, "cl") }], { fmt: f$ }),
      ["cr", "qr", "cashr", "ca", "cl", "wcap", "dcur"], null, function (o, M2, q) {
        var c = E.val(q, "cr"); if (c != null) (c >= 1.2 ? o.pos : c < 1 ? o.neg : o.pos).push("Current ratio " + c.toFixed(2) + "×.");
        if (E.val(q, "revolver")) o.pos.push("Plus undrawn facilities of " + money(E.val(q, "revolver")) + ".");
        o.impl = c == null ? "—" : c >= 1 ? "Short-term assets cover short-term obligations." : "Short-term obligations exceed short-term assets — reliance on operating cash or new borrowing.";
        o.mon.push("Current ratio and debt due within a year.");
      }, ["cr", "qr", "cashr", "ca", "cl"]);
  }
  function returnsCard(M) {
    return page(M, "returns", "roe", '<div class="pi-l">Returns on capital — TTM</div>' + lines([{ name: "ROE", color: C1, S: S(M, "roe") }, { name: "ROA", color: C2, S: S(M, "roa") }, { name: "ROIC (≈)", color: C3, S: S(M, "roic") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { zero: true, label: "Returns" }) +
      '<div class="pi-l" style="margin-top:8px">Margins</div>' + lines([{ name: "Gross", color: C1, S: S(M, "gm") }, { name: "Operating", color: C2, S: S(M, "opm") }, { name: "Net", color: C4, S: S(M, "nm") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { label: "Margins" }),
      ["roe", "roa", "roic", "gm", "opm", "nm"], null, function (o, M2, q) {
        var r = E.val(q, "roic"), ry = E.val(q, "roic_yoy"), e = E.val(q, "roe");
        if (ry != null) (ry >= 0 ? o.pos : o.neg).push("ROIC " + fv("roic_yoy", ry) + " versus a year ago (approximate) [roic_yoy].");
        if (e != null && r != null && e > r * 2.5) o.why.push("ROE well above ROIC points to leverage or buybacks shrinking equity rather than operating returns.");
        o.gaps.unshift("ROIC uses period-end capital and the effective tax rate (≈). No cost-of-capital comparison yet.");
        o.impl = r == null ? "—" : r > 15 ? "High returns on the capital deployed." : r < 6 ? "Returns are thin relative to typical capital costs." : "Moderate returns on capital.";
        o.mon.push("Whether incremental capex lifts ROIC over the next year.");
      }, ["roe", "roa", "roic", "eq", "assets"]);
  }
  function levCard(M) {
    function one(k, t, f) { return '<div class="pi-l" style="margin-top:6px">' + t + "</div>" + lines([{ name: t, color: C2, S: S(M, k) }], { fmt: f, h: 130, zero: true }); }
    return page(M, "lev", "nd_ebitda", one("nd_ebitda", "Net debt ÷ EBITDA", xfmt) + one("de", "Debt ÷ equity", xfmt) + one("int_cov", "Interest coverage", xfmt) + one("da_r", "Debt ÷ assets"),
      ["nd_ebitda", "de", "da_r", "int_cov", "gdebt", "ndebt", "eq"], null, function (o, M2, q) {
        var l = E.val(q, "nd_ebitda"), ly = E.val(q, "nd_ebitda_yoy");
        if (ly != null) (ly > 0.3 ? o.neg : o.pos).push("Net leverage " + fv("nd_ebitda_yoy", ly) + " YoY.");
        if (E.val(q, "eq") != null && E.val(q, "eq") < 0) o.gaps.unshift("Negative equity (often from buybacks) makes debt ÷ equity not meaningful.");
        o.impl = l == null ? "—" : l > 3 ? "Leverage is elevated — earnings growth must keep pace with debt." : "Leverage is moderate.";
        o.mon.push("Net leverage after the next quarter’s EBITDA.");
      }, ["nd_ebitda", "de", "da_r", "int_cov"]);
  }
  function effCard(M) {
    return page(M, "eff", "at", '<div class="pi-l">Turnover ratios — TTM</div>' + lines([{ name: "Inventory", color: C1, S: S(M, "invturn") }, { name: "Receivables", color: C2, S: S(M, "arturn") }, { name: "Payables", color: C3, S: S(M, "apturn") }].filter(function (l) { return l.S.some(function (x) { return x.v != null; }); }), { fmt: xfmt, label: "Turnover" }) +
      '<div class="pi-l" style="margin-top:8px">Asset turnover</div>' + lines([{ name: "Asset turnover", color: C4, S: S(M, "at") }], { fmt: function (v) { return v.toFixed(2) + "×"; }, h: 140 }),
      ["at", "invturn", "arturn", "apturn", "dso", "dio", "dpo", "ccc"], null, function (o, M2, q) {
        var a = E.val(q, "at_yoy"); if (a != null) (a >= 0 ? o.pos : o.neg).push("Asset turnover " + fv("at_yoy", a) + " YoY.");
        var c = E.val(q, "ccc_yoy"); if (c != null) (c <= 0 ? o.pos : o.neg).push("Cash conversion cycle " + fv("ccc_yoy", c) + " YoY.");
        o.impl = a == null ? "—" : a >= 0 ? "The asset base is generating as much or more revenue." : "Revenue per dollar of assets is falling — new assets may not yet be productive.";
        o.mon.push("Asset turnover as recent investment comes on line.");
      }, ["at", "invturn", "arturn", "apturn"]);
  }
  /* ---------------- early-warning engine ---------------- */
  function warnCard(M) {
    var W = E.warnings(M), order = { ACTIVE: 0, RESOLVED: 1, STALE: 2, "NOT TRIGGERED": 3, UNAVAILABLE: 4 };
    W.sort(function (a, b) { return (order[a.status] - order[b.status]) || ((b.severity ? E.SCALE.length : 0) - 0) || a.id - b.id; });
    var cls = { INFORMATIONAL: "MIXED", WATCH: "WEAK", CRITICAL: "NEGATIVE", "CONFIRMED DETERIORATION": "NEGATIVE" };
    function strip(h) { return '<div style="display:flex;gap:3px;margin:6px 0">' + h.map(function (x) { var bg = x.st === "C" ? "rgba(224,101,95,.65)" : x.st === "W" ? "rgba(232,163,61,.55)" : x.st === "ok" ? "rgba(63,185,127,.3)" : "transparent";
      return '<span title="' + esc(x.label + ": " + (x.text || x.st)) + '" style="flex:1;height:14px;border-radius:3px;background:' + bg + (x.st === "n/a" ? ";border:1px dashed var(--line2)" : "") + '"></span>'; }).join("") + "</div>"; }
    var act = W.filter(function (w) { return w.status === "ACTIVE"; }).length;
    return shell(M, "warn", '<div class="cx-hd"><div><div class="lab">Active signals</div><div class="big">' + act + ' <small style="font-size:14px;color:var(--muted)">of 12 rules</small></div></div><div class="m" style="max-width:520px;font-family:inherit;font-size:12.5px;color:var(--muted)">Each rule is re-run on every one of the last eight quarters using year-on-year comparisons (seasonality-safe). A signal escalates only when it persists; one quarter can reach CRITICAL but never CONFIRMED DETERIORATION.</div></div>' +
      W.map(function (w) {
        var badge = w.status === "ACTIVE" ? '<span class="cx-vd ' + cls[w.severity] + '">' + esc(w.severity) + "</span>" : '<span class="cx-vd ' + (w.status === "RESOLVED" ? "SOLID" : w.status === "NOT TRIGGERED" ? "STRONG" : "UNAVAILABLE") + '">' + esc(w.status) + "</span>";
        return '<details class="cx-evd" style="margin-top:8px"' + (w.status === "ACTIVE" ? " open" : "") + '><summary style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span><b style="color:var(--ink)">' + w.id + ". " + esc(w.title) + "</b>" + (w.text ? ' <span style="color:var(--faint)">— ' + esc(w.text) + "</span>" : "") + "</span>" + badge + "</summary>" +
          (w.history ? strip(w.history) + '<div class="stamp" style="margin-top:0;border:0;padding:0">' + w.history.map(function (h) { return esc(h.label); }).join(" · ") + " · orange = watch, red = critical, green = clear, dashed = no data</div>" : "") +
          '<dl class="ue-dl" style="grid-template-columns:auto 1fr;margin:8px 0">' +
          (w.status === "ACTIVE" ? "<dt>First observed</dt><dd style=\"text-align:left\">" + esc(w.first) + (w.first_ever !== w.first ? " (earlier episode " + esc(w.first_ever) + ")" : "") + "</dd><dt>Latest observed</dt><dd style=\"text-align:left\">" + esc(w.latest) + "</dd><dt>Persistence</dt><dd style=\"text-align:left\">" + w.persistence + " consecutive quarter" + (w.persistence > 1 ? "s" : "") + (w.escalated ? " — escalated for persistence" : "") + "</dd>" : "") +
          (w.status === "RESOLVED" ? '<dt>Resolution</dt><dd style="text-align:left">Last fired ' + esc(w.resolved_after) + "; clear in " + esc(w.latest) + "</dd>" : "") +
          (w.threshold ? '<dt>Threshold</dt><dd style="text-align:left">' + esc(w.threshold) + "</dd><dt>Comparison</dt><dd style=\"text-align:left\">" + esc(w.comp || "") + "</dd>" : "") +
          (w.alt ? '<dt>Alternative explanations</dt><dd style="text-align:left;font-family:inherit">' + esc(w.alt) + "</dd>" : "") +
          (w.note || w.partial ? '<dt>Data</dt><dd style="text-align:left;font-family:inherit">' + esc(w.note || w.partial) + "</dd>" : "") +
          '<dt>Confidence</dt><dd style="text-align:left">' + esc(w.confidence || "—") + '</dd><dt>Last reviewed</dt><dd style="text-align:left">' + esc(new Date().toISOString().slice(0, 10)) + " (live)</dd></dl></details>"; }).join("") +
      '<div class="stamp">Signals are recomputed from the filings on every visit; nothing is stored, so the audit trail is the eight-quarter strip rebuilt from what was filed at each quarter.</div>');
  }


  /* ---------------- valuation & market ---------------- */
  var SCN = {};   /* per-ticker scenario edits — page memory only */
  var BEAR = "#e0655f", BASE = "#4f86d9", BULL = "#3fb97f", WGT = "#2f4f8f";
  function noAdvice() { return '<div class="ut-ask" style="margin:0 0 10px;border-style:dashed">Analysis from the company’s filings and the assumptions shown — <b>not a price target, rating or recommendation</b>. Change the assumptions to test your own view.</div>'; }
  function vsnapCard(M, VV) {
    var D = MEM[M.co.ticker] || {}, V = E.valuation(M, D.P), q = L(M), Q = M.quarters;
    if (!V) return shell(M, "val-snap", '<div class="ue-ph">Price history did not load, so valuation cannot be computed. Filings-based cards still work.</div>');
    function t(l, v, sub) { return '<div class="cx-tile"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (sub || "") + "</div></div>"; }
    var pos = [], neg = [], watch = [];
    VV.verdicts.forEach(function (v) { var ev = v.evidence || []; ev.filter(function (e) { return e.sign > 0; }).slice(0, 2).forEach(function (e) { pos.push(e.text); }); ev.filter(function (e) { return e.sign < 0; }).slice(0, 2).forEach(function (e) { neg.push(e.text); }); });
    E.warnings(M).filter(function (w) { return w.status === "ACTIVE"; }).forEach(function (w) { neg.push(w.title + ": " + w.text + " (" + w.severity.toLowerCase() + ", " + w.persistence + "q)"); watch.push(w.title.toLowerCase() + " — does it persist next quarter?"); });
    var cx = E.val(q, "capex"), cf = E.val(q, "cfo");
    if (cx != null && cf != null && cx > cf) neg.push("Capex " + money(cx) + " exceeded operating cash flow " + money(cf) + " in " + q.fl.label + " — free cash flow " + money(cf - cx) + ".");
    var bbPrev = Q.slice(-5, -1).some(function (x) { return E.val(x, "buyback") > 0; }), bbNow = E.val(q, "buyback");
    if (bbPrev && !(bbNow > 0)) { neg.push("Buybacks paused in " + q.fl.label + " after repurchases in the prior year."); watch.push("whether buybacks resume"); }
    if (V.rpo != null) pos.push("Backlog (remaining performance obligations) " + money(V.rpo) + (V.rpo_yoy != null ? ", " + pc(V.rpo_yoy) + " YoY" : "") + ".");
    if (V.liquidity != null) pos.push("Cash and short-term investments of " + money(V.liquidity) + ".");
    var core = E.ttm(Q, Q.length - 1, "core_eps"), rep = E.ttm(Q, Q.length - 1, "eps_d");
    if (core != null && rep != null && Math.abs(rep - core) / Math.abs(core || 1) > 0.05) (rep > core ? neg : pos).push("Reported TTM EPS $" + rep.toFixed(2) + " vs core $" + core.toFixed(2) + " — " + (rep > core ? "flattered" : "depressed") + " by equity-investment gains/losses.");
    var nx = window.EARNINGS && EARNINGS._data && EARNINGS._data() && EARNINGS._data().calendar ? (EARNINGS._data().calendar.rows || []).filter(function (r) { return r.symbol === M.co.ticker && r.date >= new Date().toISOString().slice(0, 10); })[0] : null;
    watch.unshift(nx ? "next report " + nx.date : "next quarterly report (date not in the free calendar)");
    watch.push("capex vs operating cash flow next quarter", "revenue growth vs " + (E.val(q, "rev_yoy") != null ? pc(E.val(q, "rev_yoy")) : "—") + " this quarter");
    function list(a, cl) { return a.length ? a.slice(0, 7).map(function (x) { return '<div class="cx-ev ' + cl + '">' + esc(x) + "</div>"; }).join("") : '<div class="cx-ev" style="color:var(--faint)">none from the filed data</div>'; }
    return shell(M, "val-snap", noAdvice() +
      '<div class="cx-tiles">' + t("Price", "$" + V.price.toFixed(2), "close " + esc(V.date) + " · delayed") + t("Market cap", money(V.mcap), V.shares ? esc(V.shares.how.split(" (")[0]) : "shares n/a") +
        t("P/E (TTM)", V.pe ? V.pe.toFixed(1) + "×" : "n/m", "reported diluted EPS $" + (V.eps_ttm != null ? V.eps_ttm.toFixed(2) : "—")) + t("P/E on core EPS", V.pe_core ? V.pe_core.toFixed(1) + "×" : "—", V.core_eps_ttm != null ? "core EPS $" + V.core_eps_ttm.toFixed(2) : "no investment gains tagged") +
        t("EV / EBIT (TTM)", V.ev_ebit ? V.ev_ebit.toFixed(1) + "×" : "n/m", "EV " + money(V.ev)) + t("FCF yield (TTM)", V.fcf_yield != null ? V.fcf_yield.toFixed(1) + "%" : "—", "TTM FCF ÷ market cap") +
        t("Dividend yield", V.div_yield != null ? V.div_yield.toFixed(2) + "%" : "—", "TTM dividends ÷ market cap") + t("Backlog (RPO)", money(V.rpo), V.rpo_yoy != null ? pc(V.rpo_yoy) + " YoY" : "not tagged") +
        t("Cash + securities", money(V.liquidity), "period end " + esc(q.end)) + t("Latest quarter", esc(q.fl.label), "filed data") + "</div>" +
      '<div class="cx-vg" style="margin-top:12px"><div class="cx-v"><h3>The positives</h3>' + list(pos, "p") + '</div><div class="cx-v"><h3>The concerns</h3>' + list(neg, "n") + "</div></div>" +
      '<div class="cx-v" style="margin-top:10px"><h3>What to watch</h3>' + watch.slice(0, 6).map(function (w, i) { return '<div class="cx-ev">' + (i + 1) + ". " + esc(w) + "</div>"; }).join("") + "</div>" +
      '<div class="stamp">Every positive and concern is generated from the filed figures and the warning rules — nothing is written by hand. Segment growth, guidance and management commentary are not in the structured filings and are not invented. Price: Yahoo daily close (delayed). Shares: ' + esc(V.shares ? V.shares.how : "n/a") + ".</div>");
  }
  function scnState(M, V) { var t = M.co.ticker; if (!SCN[t]) SCN[t] = E.defaultScenarios(M, V); return SCN[t]; }
  function vscnCard(M) {
    var D = MEM[M.co.ticker] || {}, V = E.valuation(M, D.P);
    if (!V || !(V.core_eps_ttm > 0 || V.eps_ttm > 0)) return shell(M, "val-scn", '<div class="ue-ph">Needs a positive trailing EPS and price history — scenario values on earnings are not meaningful here.</div>');
    var st = scnState(M, V), R = E.scenarios(st.eps0, V.price, st.cases), col = { bear: BEAR, base: BASE, bull: BULL };
    var items = R.cases.map(function (c) { return { label: c.name, v: c.value, color: col[c.id], text: "$" + c.value.toFixed(0) + " (" + pc(c.upside, 0) + ")" }; })
      .concat([{ label: "Weighted", v: R.weighted.value, color: WGT, text: "$" + R.weighted.value.toFixed(0) + " (" + pc(R.weighted.upside, 0) + ")" }]);
    function inp(c, f, step) { return '<input type="number" step="' + step + '" data-scn="' + esc(M.co.ticker) + "|" + c.id + ":" + f + '" value="' + c[f] + '" style="width:72px;background:var(--bg);border:1px solid var(--line2);border-radius:6px;color:var(--ink);font:inherit;font-family:\'IBM Plex Mono\',monospace;padding:4px 6px;text-align:right">'; }
    return shell(M, "val-scn", noAdvice() + '<div class="pi-l">12-month value per share by scenario · dashed line = price on ' + esc(V.date) + " ($" + V.price.toFixed(2) + ")</div>" +
      vbars(items, { ref: V.price, refLabel: "price $" + V.price.toFixed(2), label: "Scenario values", axfmt: function (v) { return "$" + v.toFixed(0); } }) +
      '<div class="tbl-scroll" style="margin-top:8px"><table class="cx-t"><thead><tr><th>Scenario</th><th>EPS growth, next 12 m (%)</th><th>P/E multiple (×)</th><th>Weight (%)</th><th>Implied EPS</th><th>Value / share</th><th>vs price</th></tr></thead><tbody>' +
        R.cases.map(function (c, i) { var sc = st.cases[i]; return '<tr><td><b style="color:' + col[c.id] + '">' + c.name + "</b></td><td>" + inp(sc, "g", 1) + "</td><td>" + inp(sc, "pe", 0.5) + "</td><td>" + inp(sc, "p", 5) + "</td><td>$" + c.eps.toFixed(2) + "</td><td>$" + c.value.toFixed(2) + "</td><td>" + sgc(c.upside, pc(c.upside)) + "</td></tr>"; }).join("") +
        '<tr><td><b>Weighted</b></td><td colspan="3" style="text-align:left;font-family:inherit;font-size:12px;color:var(--faint)">weights sum to ' + R.weighted.probs_sum + "% (normalised)</td><td></td><td>$" + R.weighted.value.toFixed(2) + "</td><td>" + sgc(R.weighted.upside, pc(R.weighted.upside)) + "</td></tr></tbody></table></div>" +
      '<button class="ue-btn" data-scnreset="' + esc(M.co.ticker) + '" style="margin-top:8px">Reset to starting assumptions</button>' +
      '<div class="stamp">Value = starting EPS × (1 + growth) × P/E. Starting EPS: ' + esc(st.basis) + " = $" + st.eps0.toFixed(2) + ". Starting assumptions: " + esc(st.seed) + " Edits stay in this page only.</div>");
  }
  function vpeCard(M) {
    var D = MEM[M.co.ticker] || {}, V = E.valuation(M, D.P);
    if (!V || !(V.core_eps_ttm > 0 || V.eps_ttm > 0)) return shell(M, "val-pe", '<div class="ue-ph">Needs a positive trailing EPS and price history.</div>');
    var st = scnState(M, V), base = st.cases[1], ntm = st.eps0 * (1 + base.g / 100), Sn = E.sensitivity(ntm, base.pe, V.price);
    var items = Sn.rows.map(function (r) { return { label: r.pe + "×", v: r.value, color: r.center ? WGT : r.above ? BASE : "#7d8590", text: "$" + r.value.toFixed(0) }; });
    return shell(M, "val-pe", noAdvice() + '<h3 style="margin:0 0 2px;font-size:16px">Each turn of multiple is worth about $' + Sn.perTurn.toFixed(2) + " a share</h3>" +
      '<div class="pi-l">Value per share by P/E on base-case next-12-month EPS ($' + ntm.toFixed(2) + ") · dashed line = $" + V.price.toFixed(2) + "</div>" +
      vbars(items, { ref: V.price, refLabel: "price $" + V.price.toFixed(2), axfmt: function (v) { return "$" + v.toFixed(0); }, label: "Multiple sensitivity" }) +
      '<div class="cx-vg" style="margin-top:8px"><div class="cx-v"><h3>Break-even multiple</h3><div class="cx-ev">Today’s price implies <b>' + (Sn.breakEvenPE ? Sn.breakEvenPE.toFixed(1) + "×" : "—") + "</b> base-case next-12-month EPS.</div></div>" +
        '<div class="cx-v"><h3>Reading it</h3><div class="cx-ev">Grey bars sit below today’s price, blue above; the dark bar is the base-case multiple (' + base.pe + "×). Change the base case on the Scenario card and this chart follows.</div></div></div>" +
      '<div class="stamp">Base-case EPS = ' + esc(st.basis) + " × (1 + " + base.g + "%). Multiples are a sensitivity range, not a judgement of what the stock deserves.</div>");
  }
  function vrxCard(M) {
    var D = MEM[M.co.ticker] || {}, P = D.P;
    if (!P || !P.ticker) return shell(M, "val-rx", '<div class="ue-ph">Price history did not load.</div>');
    var RA = E.reactions(P, M.co.filings), R = RA.slice(-12), bm = E.bigMoves(P.ticker.ts, 5), last = P.ticker.ts[P.ticker.ts.length - 1][0];
    var yrs = ((Date.parse(last) - Date.parse(P.ticker.ts[0][0])) / 3.156e10).toFixed(1);
    var rxItems = R.map(function (r) { return { label: mon(r.date), v: r.pct, color: r.pct >= 0 ? BULL : BEAR, text: pc(r.pct, 1) }; });
    var worst = bm.worst.slice().reverse().map(function (w) { var isRx = RA.some(function (r) { return Math.abs(Date.parse(r.date) - Date.parse(w.date)) <= 2 * 864e5; });
      return { label: dayl(w.date), v: w.pct, color: isRx ? BEAR : "#7d8590", text: pc(w.pct, 1) }; });
    var avgAbs = R.length ? R.reduce(function (a, r) { return a + Math.abs(r.pct); }, 0) / R.length : null, latest = R[R.length - 1];
    return shell(M, "val-rx", '<div class="pi-l">Two-day move around each earnings release (8-K Item 2.02)</div>' + (R.length ? vbars(rxItems, { fmt: function (v) { return pc(v, 1); }, axfmt: function (v) { return pc(v, 1); }, label: "Earnings-day reactions" }) : '<p class="note">No earnings releases inside the price window.</p>') +
      '<div class="cx-vg" style="margin-top:6px"><div class="cx-v"><h3>Latest release</h3><div class="cx-ev">' + (latest ? esc(dayl(latest.date)) + ": " + pc(latest.pct, 1) + (latest.rel != null ? " — " + pc(latest.rel, 1).replace("%", " pp") + " versus the S&P 500" : "") : "—") + "</div>" +
        (avgAbs != null ? '<div class="cx-ev">Average absolute reaction over ' + R.length + " reports: " + avgAbs.toFixed(1) + "% — " + (latest && Math.abs(latest.pct) > avgAbs * 1.8 ? "the latest move was unusually large." : "the latest move was within the usual range.") + "</div>" : "") + "</div>" +
        '<div class="cx-v"><h3>Largest single-day drops (' + yrs + " years)</h3>" + bm.worst.map(function (w) { return '<div class="cx-ev n">' + esc(dayl(w.date)) + ": " + pc(w.pct, 1) + "</div>"; }).join("") + "</div></div>" +
      '<div class="pi-l" style="margin-top:10px">Worst days in the window — red where it was an earnings reaction</div>' + vbars(worst, { fmt: function (v) { return pc(v, 1); }, axfmt: function (v) { return pc(v, 1); }, label: "Worst days", h: 200 }) +
      '<div class="stamp">Release timing (before/after the bell) is not in the filing index, so each reaction is the close before the filing date to the close one session after. Daily closes from Yahoo (delayed), ' + yrs + " years. History before the window is not shown rather than quoted from elsewhere.</div>");
  }

  /* ---------------- public ---------------- */
  var CARDS = { snap: snapCard, verdicts: verdictCard, health: healthCard, revenue: revenueCard, gross: grossCard, operating: operatingCard, eps: epsCard, cfo: cfoCard, fcf: fcfCard,
    "wc-ar": arCard, "wc-inv": invCard, "wc-ap": apCard, "wc-ccc": cccCard, capex: capexCard, alloc: allocCard, debt: debtCard, costdebt: costCard, maturity: maturityCard, service: serviceCard,
    matrix: function (M) { return matrixCard(M, "fy"); }, "fin-is": function (M) { return matrixCard(M, "pl"); }, "fin-bs": function (M) { return matrixCard(M, "bs"); }, "fin-cf": function (M) { return matrixCard(M, "cf"); },
    est: estCard, own: ownCard, "b-nii": metricCard("b-nii", "nii"), "b-nim": metricCard("b-nim", "nim_a"), "b-fee": metricCard("b-fee", "nonii"), "b-eff": metricCard("b-eff", "eff"), "b-prov": metricCard("b-prov", "prov"),
    "b-loans": metricCard("b-loans", "loans_g"), "b-dep": metricCard("b-dep", "deposits"), "b-ldr": metricCard("b-ldr", "ldr"), "b-npl": metricCard("b-npl", "npl_pct"), "b-nco": metricCard("b-nco", "nco_pct"), "b-provr": metricCard("b-provr", "prov_pct"),
    "b-acl": metricCard("b-acl", "acl_pct"), "b-cov": metricCard("b-cov", "acl_npl"), "b-cap": metricCard("b-cap", "eq_a"), "b-roa": metricCard("b-roa", "roa"),
    "m-ebitda": metricCard("m-ebitda", "ebitdam"), "m-capint": metricCard("m-capint", "capexint"), "m-capda": metricCard("m-capda", "capexda"), "a-inv": metricCard("a-inv", "inv"), "a-wcap": metricCard("a-wcap", "wcap"), liq: liqCard, returns: returnsCard, lev: levCard, eff: effCard, warn: warnCard, "val-snap": vsnapCard, "val-scn": vscnCard, "val-pe": vpeCard, "val-rx": vrxCard };
  /* every new company opens on animated placeholders, one per section — never the previous company's numbers */
  function skeleton(t) {
    var sec = [["Company profile", 2], ["Price & valuation", 3], ["Revenue & profitability", 3], ["Cash flow", 3], ["Balance sheet", 3], ["Financial verdicts", 4], ["Historical charts", 0]];
    return '<div class="co-skel" aria-busy="true" aria-label="Loading ' + esc(t) + '"><div class="co-skh"><b>' + esc(t) + '</b> <span class="co-skt">Loading filings and prices for ' + esc(t) + "…</span></div>" +
      '<div class="co-skg">' + sec.map(function (x) { return '<div class="co-skc' + (x[1] ? "" : " wide") + '"><div class="co-skl">' + x[0] + "</div>" +
        (x[1] ? new Array(x[1] + 1).join('<i class="sk"></i>') : '<i class="sk ch"></i>') + "</div>"; }).join("") + "</div></div>";
  }
  function html(t) {
    if (!worker()) return '<div class="tile"><h2>Company research</h2><div class="ue-ph">Live search needs the AGRITrade SEC Worker. Once it is deployed, open the desk once with <code>?worker=https://&lt;name&gt;.workers.dev</code> — the address is remembered in this browser.</div></div>';
    var D = MEM[t]; if (!D) { load(t); D = MEM[t]; }
    if (D.loading) { dlg(t); return skeleton(t); }
    if (D.err) return '<div class="tile"><h2>' + esc(t) + '</h2><div class="unreach">⚠ Could not load ' + esc(t) + " <small>— " + esc(D.err) + '</small></div><button class="ue-btn" data-coretry="' + esc(t) + '" style="margin-top:8px">Try again</button></div>';
    if (!D.M.quarters.length) return '<div class="tile"><h2>' + esc(t) + '</h2><div class="ue-ph">' + esc(D.co.name) + " has no US-GAAP quarterly figures in SEC XBRL" + (D.co.ifrs ? " (it files under IFRS)" : "") + ".</div></div>";
    prFetch(D.M); strFetch(t); watch8k(t); if (Date.now() - Date.parse(D.at) > 20 * 6e4) refresh(t);
    if (!SHOWN[t]) { dlg(t); return skeleton(t); }   /* nothing is painted until every source has answered and the view is compiled */
    return card && CARDS[card] ? CARDS[card](D.M, D.V) : grid(D.M, D.V);
  }
  /* ---- search dialog (owner, Nov 17 2026): "Fetching info" while each source answers (ticked as it arrives), then
     "Compiling info" while statements, ratios, Smart read and commentary are built, then the whole view appears at once ---- */
  var SHOWN = {}, DLG = null, DT = {};
  function srcState(t) {
    var D = MEM[t] || {}, rel = D.co ? E.latestRelease(D.co) : null, needRel = !!(rel && Date.now() - Date.parse(rel.filed + "T12:00:00Z") <= 30 * 864e5);
    var S2 = STR[t], lp = LPR[t];
    return [["SEC filings & statements", D.loading ? 0 : D.err ? -1 : 1], ["Share prices", D.loading ? 0 : D.P ? 1 : -1],
      ["Analyst estimates & ownership", !S2 || S2.loading ? 0 : S2.d ? 1 : -1]].concat(needRel ? [["Latest earnings release (" + rel.filed + ")", !lp || lp.loading ? 0 : lp.date ? 1 : -1]] : []);
  }
  function dlg(t) {
    var pe = document.getElementById("panel-earnings"); if (pe && !pe.offsetParent) { if (DLG) DLG.hidden = true; return; }
    if (!DLG) { DLG = document.createElement("div"); DLG.id = "coDlg"; DLG.setAttribute("role", "status"); DLG.setAttribute("aria-live", "polite"); document.body.appendChild(DLG); }
    if (!DT[t]) DT[t] = Date.now();
    var D = MEM[t] || {}, L2 = srcState(t), pend = L2.some(function (x) { return x[1] === 0; }), late = Date.now() - DT[t] > 25000;
    var phase = D.err ? "err" : pend && !late ? "fetch" : "compile";
    var nm = (D.co && D.co.name) || "";
    DLG.innerHTML = '<div class="cd-box"><div class="cd-h"><i class="ux-spin"></i><b>' + (phase === "fetch" ? "Fetching info" : phase === "err" ? "Could not load" : "Compiling info") + "</b><span>" + esc(t) + (nm ? " · " + esc(nm) : "") + "</span></div>" +
      '<ul class="cd-l">' + L2.map(function (x) { return '<li class="' + (x[1] === 1 ? "ok" : x[1] === -1 ? "na" : "wt") + '"><span>' + (x[1] === 1 ? "✓" : x[1] === -1 ? "–" : "") + "</span>" + esc(x[0]) + (x[1] === -1 ? " <small>not available</small>" : "") + "</li>"; }).join("") +
      '<li class="' + (phase === "compile" ? "wt" : "") + '"><span></span>Statements, ratios, Smart read &amp; commentary</li></ul>' + (late && pend ? '<p class="cd-n">A source is slow — showing what has arrived.</p>' : "") + "</div>";
    DLG.hidden = false;
    if (D.err) { SHOWN[t] = 1; DLG.hidden = true; return; }
    if (phase === "compile" && D.M && !DLG._c) { DLG._c = t; setTimeout(function () { DLG._c = null; SHOWN[t] = 1; DLG.hidden = true; rerender(); }, 450); }
    if (pend && !late) { clearTimeout(DLG._r); DLG._r = setTimeout(function () { if (!SHOWN[t]) rerender(); }, 1500); }
  }
  /* results the moment they are filed (owner, Nov 17 2026): while a company is open, its earnings 8-Ks are checked every two
     minutes (SEC acceptance list, 60 s cache); a new release is read at once — scorecard, tiles, Smart read, commentary */
  var W8 = {};
  function watch8k(t) {
    var D = MEM[t]; if (!D || !D.co || !worker() || (W8[t] && Date.now() - W8[t] < 120000)) return; W8[t] = Date.now();
    fetch(worker() + "/filings?t=" + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var n = j && (j.releases || [])[0], D2 = MEM[t]; if (!n || !D2 || !D2.co) return;
      var F = D2.co.filings || []; if (F.some(function (f) { return f.accn === n.accn; })) return;
      D2.co = Object.assign({}, D2.co, { filings: [{ form: "8-K", filed: n.filed, period: n.period, accn: n.accn, items: n.items, url: n.url }].concat(F) });
      D2.M = E.build(D2.co); D2.V = E.verdicts(D2.M, D2.P); delete PRS[t]; delete PRN[t]; delete LPR[t]; delete READY[t]; delete RC[t]; rerender();
    }).catch(function () {});
  }
  setInterval(function () { try { var a = document.querySelector("#panel-earnings.active, #usm[data-mode=company]"); if (a) Object.keys(MEM).forEach(function (t) { if (MEM[t] && MEM[t].M) watch8k(t); }); } catch (e) {} }, 125000);
  /* a company stays open for hours: refetch quietly every 20 minutes so a new filing shows without a reload */
  function refresh(t) {
    var D = MEM[t]; if (!D || !D.M || D.bg) return; D.bg = 1;
    Promise.all([fetch(worker() + "/company?t=" + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : null; }), fetch(worker() + "/prices?r=5y&t=" + encodeURIComponent(t)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })])
      .then(function (x) { if (MEM[t] !== D) return; if (!co_ok(x[0], t)) { D.bg = 0; D.at = new Date().toISOString(); return; }
        var M = E.build(x[0]); MEM[t] = { co: x[0], M: M, P: x[1] || D.P, V: E.verdicts(M, x[1] || D.P), at: new Date().toISOString() }; delete READY[t]; delete RC[t]; rerender(); prQuarter(t); })
      .catch(function () { D.bg = 0; D.at = new Date().toISOString(); });
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-cogd]"); if (b && b.closest("#panel-earnings")) { var id0 = b.getAttribute("data-cogd"); GD = GD && GD.id === id0 ? null : { id: id0, k: b.getAttribute("data-cok") || (GD && GD.k) }; if (GD && !GD.k) GD = null; rerender(); return; }
    b = t.closest("[data-rsd]"); if (b) { var k0 = b.getAttribute("data-rsd"); RSD = RSD === k0 ? null : k0; rerender(); return; }
    b = t.closest("[data-esk],[data-esv]"); if (b) { if (b.hasAttribute("data-esk")) EV.k = b.getAttribute("data-esk"); else EV.v = b.getAttribute("data-esv"); rerender(); return; }
    b = t.closest("[data-cotv]"); if (b) { TV = b.getAttribute("data-cotv"); try { localStorage.setItem("desk.coTiles", TV); } catch (e) {} rerender(); return; }
    b = t.closest("[data-mxtab]"); if (b && b.closest("#panel-earnings")) { MX = b.getAttribute("data-mxtab"); rerender(); return; }
    b = t.closest("[data-coretry]"); if (b) { delete MEM[b.getAttribute("data-coretry")]; rerender(); }
    b = t.closest("[data-scnreset]"); if (b) { delete SCN[b.getAttribute("data-scnreset")]; rerender(); }
  });
  /* card tabs and card tiles: capture phase, so the card is set before the panel re-renders (a bubbling handler would see a
     detached button and miss it — the reason tabs did nothing) */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-cocard]"); if (!b || b.disabled || !b.closest("#panel-earnings, #usmTabs")) return;
    card = b.getAttribute("data-cocard") || null; var inTabs = !b.closest(".ut-main");
    setTimeout(function () { rerender(); var m = document.querySelector("#panel-earnings .ut-main"); if (!m) return;
      var nv = document.querySelector("#usmTabs .un-nav"); m.style.scrollMarginTop = (nv && getComputedStyle(nv.parentNode).position === "sticky" ? nv.offsetHeight + 12 + (parseFloat(nv.parentNode.style.top) || 0) : 8) + "px";
      var y = m.getBoundingClientRect().top; if (!inTabs || y < 0 || y > innerHeight * 0.5) m.scrollIntoView({ block: "start", behavior: "smooth" }); }, 0);
  }, true);
  document.addEventListener("change", function (ev) {
    var el = ev.target; if (!el || !el.getAttribute || !el.getAttribute("data-scn")) return;
    var parts = el.getAttribute("data-scn").split("|"), tk = parts[0];
    var a = parts[1].split(":"), st = SCN[tk]; if (!st) return;
    var c = st.cases.filter(function (x) { return x.id === a[0]; })[0], v = parseFloat(el.value); if (c && isFinite(v)) { c[a[1]] = v; rerender(); }
  });
  /* section tabs for the US Markets search bar: grey skeleton while loading, green once that section has data */
  var GROUPS = [["snap", "Overview", ["snap"]], ["verdicts", "Verdicts", ["verdicts", "warn"]], ["growth", "Revenue & margins", ["revenue", "gross", "operating", "eps"]],
    ["cash", "Cash flow", ["cfo", "fcf", "capex", "alloc"]], ["wc", "Working capital", ["wc-ar", "wc-inv", "wc-ap", "wc-ccc"]], ["bs", "Balance sheet & debt", ["debt", "costdebt", "maturity", "service", "liq", "lev"]],
    ["ratios", "Ratios & KPIs", ["matrix", "returns", "eff", "health"]], ["val", "Valuation", ["val-snap", "val-pe", "val-rx", "val-scn"]]];
  var READY = {};
  /* a section "has data" when its headline value is filled (not "—"); cards without a headline need a figure outside placeholders */
  function hasData(h) { if (!h) return false; var m = /class="big">([^<]*)/.exec(h); if (m) return !!m[1].trim() && m[1].trim() !== "—";
    var t = h.replace(/<div class="(ue-ph|unreach)"[\s\S]*?<\/div>/g, "").replace(/<[^>]+>/g, " "); return /[$%]\s?\d|\d\s?(%|x|d\b)|\d\.\d/.test(t); }
  function status(t) {
    var D = MEM[t]; if (!D || D.loading) return { state: "loading", groups: GROUPS.map(function (g) { return { id: g[0], label: g[1], first: g[2][0], ready: null }; }) };
    if (D.err) return { state: "err", err: D.err, groups: [] };
    var R = READY[t] || (READY[t] = {});
    return { state: "ready", at: D.at, groups: GROUPS.map(function (g) {
      if (R[g[0]] === undefined) { var ok = null; g[2].some(function (k) { try { var h = CARDS[k] && CARDS[k](D.M, D.V); if (hasData(h)) { ok = k; return true; } } catch (e) {} return false; }); R[g[0]] = ok; }
      return { id: g[0], label: g[1], first: R[g[0]] || g[2][0], ready: !!R[g[0]] }; }) };
  }
  /* per-card availability for the tabs: true = has figures, false = this company does not report it, null = still loading */
  var RC = {};
  function has(t, id) {
    var D = MEM[t]; if (!D || D.loading || D.err || !D.M) return null; if (!BUILT[id]) return false;
    var R = RC[t] || (RC[t] = {}); if (R[id] === undefined) { try { R[id] = id === "verdicts" || id === "health" || id === "warn" || id === "matrix" ? D.M.quarters.length > 0 :
      id === "est" || id === "own" ? (STR[t] && STR[t].loading ? null : id === "est" ? !!(SD(D.M) && SD(D.M).hist && (SD(D.M).hist.length || SD(D.M).trend.length)) : !!(SD(D.M) && SD(D.M).own && SD(D.M).own.inst_pct != null)) : hasData(CARDS[id] && CARDS[id](D.M, D.V)); } catch (e) { R[id] = false; } }
    return R[id];
  }
  window.COMPANY = { _m: function (t) { return MEM[t] && MEM[t].M; }, _prs: function (t) { return PRS[t]; }, status: status, has: has, name: function (t) { var D = MEM[t]; return D && D.co ? D.co.name : ""; }, card: function () { return card; }, parts: function (t) { var D = t && MEM[t]; return D && D.M ? partsOf(D.M) : PARTS; }, profile: function (t) { var D = t && MEM[t]; return D && D.M ? PROFILE_NAME[profileOf(D.M)] : ""; }, show: function (key) { card = key || null; rerender(); }, html: html, search: search, configured: function () { return !!worker(); }, reset: function (keep) { card = null; cancelAll(keep); }, retry: function (t) { delete MEM[t]; delete READY[t]; rerender(); }, _mem: MEM };
})();
