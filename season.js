/* season.js — seasonal header: the desk's banner follows Canadian and US holidays and the grain calendar.
   Holidays win over seasons; each theme sets the header's colours, an emblem, a greeting and — where it matters to the
   desk — a market note (exchanges closed / early close). Toronto dates. Dismiss hides the greeting for the day. */
(function () {
  "use strict";
  var H = document.querySelector("header.topbar"); if (!H) return;
  function et(d) { var p = {}; new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).forEach(function (x) { p[x.type] = +x.value; }); return p; }
  var T = et(new Date()), Y = T.year, today = new Date(Date.UTC(Y, T.month - 1, T.day));
  function D(m, d, y) { return new Date(Date.UTC(y || Y, m - 1, d)); }
  function nth(m, wd, n, y) { var d = D(m, 1, y); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 7 * (n - 1)); return d; }
  function last(m, wd, y) { var d = D(m + 1, 0, y); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() - 1); return d; }
  function add(d, n) { var x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return D(mo, da, y); }
  function victoria(y) { var d = D(5, 24, y); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1); return d; }
  var E = easter(Y), usTg = nth(11, 4, 4);
  /* [from, to, theme, title, note]   note = what it means for the desk's markets */
  var HOL = [
    [D(12, 31, Y - 1), D(1, 2), "newyear", "Happy New Year", "Jan 1: US and Canadian exchanges closed"],
    [D(12, 31), D(12, 31), "newyear", "Happy New Year's Eve", "Early closes on some markets today"],
    [add(nth(2, 1, 3), -1), nth(2, 1, 3), "family", "Family Day (Canada) · Presidents' Day (US)", "CBOT closed; Canadian markets closed in most provinces"],
    [D(2, 14), D(2, 14), "valentine", "Happy Valentine's Day", ""],
    [D(3, 17), D(3, 17), "stpat", "Happy St. Patrick's Day", ""],
    [add(E, -2), add(E, 1), "easter", "Happy Easter", "Good Friday: CBOT and Canadian exchanges closed"],
    [add(victoria(Y), -2), victoria(Y), "victoria", "Victoria Day weekend", "Monday: Canadian markets closed, CBOT open"],
    [add(last(5, 1), -2), last(5, 1), "memorial", "Memorial Day weekend (US)", "Monday: CBOT closed"],
    [D(6, 19), D(6, 19), "memorial", "Juneteenth (US)", "CBOT closed"],
    [D(6, 30), D(7, 1), "canada", "Happy Canada Day", "Jul 1: Canadian markets closed"],
    [D(7, 3), D(7, 4), "july4", "Happy Independence Day (US)", "Jul 4: CBOT closed"],
    [add(nth(8, 1, 1), -2), nth(8, 1, 1), "summer", "Civic Holiday long weekend (Canada)", "Monday: most Canadian markets closed"],
    [add(nth(9, 1, 1), -2), nth(9, 1, 1), "labour", "Labour Day · Labor Day", "Monday: CBOT and Canadian exchanges closed"],
    [D(9, 30), D(9, 30), "orange", "National Day for Truth and Reconciliation", "Federal holiday in Canada"],
    [add(nth(10, 1, 2), -2), nth(10, 1, 2), "thanks", "Happy Thanksgiving, Canada", "Monday: Canadian markets closed, CBOT open"],
    [D(10, 25), D(10, 31), "halloween", "Happy Halloween", ""],
    [D(11, 8), D(11, 11), "remember", "Remembrance Day · Veterans Day — Lest we forget", "Nov 11: US bond market closed; CBOT open"],
    [add(usTg, -3), add(usTg, 1), "thanksus", "Happy Thanksgiving (US)", "Thanksgiving Thursday: CBOT closed · Friday: early close"],
    [D(12, 15), D(12, 26), "xmas", "Season's greetings", "Dec 25: markets closed · Dec 26: Boxing Day, Canadian markets closed"]
  ];
  var SEAS = [
    [D(4, 15), D(6, 10), "planting", "Planting season", "Weekly crop progress (Mon 4 pm ET) sets the pace — corn vs soybean acres in focus"],
    [D(6, 11), D(9, 14), "growing", "Growing season — the weather market", "Crop conditions and the forecast drive price; WASDE yield updates matter most"],
    [D(9, 15), D(11, 20), "harvest", "Harvest season", "Harvest pace, basis and export sales lead — seasonal supply pressure on prices"],
    [D(11, 21), D(12, 31), "winter", "Winter marketing season", "Export demand, South American planting and the roll into March lead"],
    [D(1, 1), D(4, 14), "winter", "Winter marketing season", "South American harvest, Prospective Plantings (Mar 31) and the March–May roll lead"]
  ];
  function pick(L) { for (var i = 0; i < L.length; i++) if (today >= L[i][0] && today <= L[i][1]) return L[i]; return null; }
  var h = pick(HOL), s = pick(SEAS), th = h || s; if (!th) return;
  var EMB = { newyear: "🎆", family: "👨‍👩‍👧", valentine: "💝", stpat: "☘️", easter: "🐣", victoria: "👑", memorial: "🇺🇸", canada: "🍁", july4: "🎇", summer: "☀️", labour: "🛠️", orange: "🧡",
              thanks: "🦃", halloween: "🎃", remember: "🌺", thanksus: "🦃", xmas: "🎄", planting: "🌱", growing: "🌽", harvest: "🌾", winter: "❄️" };
  var COL = { newyear: ["#1b1446", "#6c5ce7"], family: ["#12283a", "#38b6c9"], valentine: ["#3a1424", "#e05a8a"], stpat: ["#10301f", "#3fb97f"], easter: ["#2b2140", "#c9a3ff"],
              victoria: ["#1d2142", "#7b8cff"], memorial: ["#14223d", "#6ea8ff"], canada: ["#3a1212", "#e0453a"], july4: ["#141f3d", "#e0453a"], summer: ["#2f2810", "#f5c542"],
              labour: ["#1e2632", "#9aa8bb"], orange: ["#3a2110", "#f08a24"], thanks: ["#3a2412", "#e8a33d"], halloween: ["#2c1608", "#ff7a1a"], remember: ["#2a1014", "#d9363e"],
              thanksus: ["#3a2412", "#e8a33d"], xmas: ["#0f2a1a", "#e0453a"], planting: ["#10261a", "#5cc98a"], growing: ["#1c2a10", "#a3d14a"], harvest: ["#2e2210", "#e8a33d"], winter: ["#0f2232", "#8fd3f4"] };
  var c = COL[th[2]] || COL.winter, hid = false; try { hid = localStorage.getItem("desk.seasonHide") === T.year + "-" + T.month + "-" + T.day; } catch (e) {}
  H.classList.add("ss-on"); H.style.setProperty("--ss1", c[0]); H.style.setProperty("--ss2", c[1]);
  var bar = document.createElement("div"); bar.className = "ss-bar"; if (hid) bar.hidden = true;
  bar.innerHTML = '<span class="ss-em no-invert" aria-hidden="true">' + EMB[th[2]] + '</span><span class="ss-t"><b>' + th[3] + "</b>" + (th[4] ? " · " + th[4] : "") +
    (h && s ? ' <span class="ss-s">' + EMB[s[2]] + " " + s[3] + "</span>" : "") + '</span><button class="ss-x" type="button" aria-label="Hide for today" title="Hide for today">×</button>';
  var sub = H.querySelector(".sub"); H.insertBefore(bar, sub ? sub.nextSibling : null);
  bar.querySelector(".ss-x").addEventListener("click", function () { bar.hidden = true; try { localStorage.setItem("desk.seasonHide", T.year + "-" + T.month + "-" + T.day); } catch (e) {} });
  var css = document.createElement("style");
  css.textContent = ".topbar.ss-on{background:linear-gradient(100deg,var(--ss1) 0%,rgba(10,15,22,0) 70%);border-radius:0 0 14px 14px;padding-bottom:10px;position:relative}" +
    ".topbar.ss-on h1{background:linear-gradient(90deg,#fff 40%,var(--ss2));-webkit-background-clip:text;background-clip:text;color:transparent}" +
    ".ss-bar{display:flex;align-items:center;gap:10px;margin-top:8px;padding:6px 10px 6px 8px;border:1px solid color-mix(in srgb,var(--ss2) 45%,transparent);border-left:3px solid var(--ss2);border-radius:8px;background:color-mix(in srgb,var(--ss1) 70%,transparent);max-width:980px;font-size:13px;color:var(--ink)}" +
    ".ss-em{font-size:20px;line-height:1;animation:ssb 3.2s ease-in-out infinite}@keyframes ssb{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px) rotate(-6deg)}}" +
    ".ss-t{flex:1;min-width:0;line-height:1.4}.ss-t b{color:var(--ss2);font-weight:700}.ss-s{color:var(--muted);margin-left:6px;white-space:nowrap}" +
    ".ss-x{appearance:none;border:0;background:transparent;color:var(--faint);font-size:16px;cursor:pointer;padding:0 4px}.ss-x:hover{color:var(--ink)}" +
    "@media (prefers-reduced-motion:reduce){.ss-em{animation:none}}@media (max-width:760px){.ss-s{display:block;margin:2px 0 0}}";
  document.head.appendChild(css);
  /* ---------- motion: particles drifting through the header + a themed cursor with a light trail (switchable, off for reduced motion) ---------- */
  var PART = { newyear: "✨🎉", valentine: "💗", stpat: "☘️", easter: "🌸🥚", canada: "🍁", july4: "✨⭐", summer: "☀️", thanks: "🍂🍁", halloween: "🦇🍂", remember: "🌺",
               thanksus: "🍂🍁", xmas: "❄️✨", planting: "🌱💧", growing: "🌽🌿", harvest: "🌾🍂", winter: "❄️", orange: "🧡", family: "✨", memorial: "⭐", victoria: "✨", labour: "✨" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, FX = "desk.seasonFx";
  var fxOn = !reduce; try { if (localStorage.getItem(FX) === "0") fxOn = false; } catch (e) {}
  var chars = Array.from(PART[th[2]] || "✨"), sky = document.createElement("div"); sky.className = "ss-sky no-invert"; sky.setAttribute("aria-hidden", "true");
  for (var i = 0; i < 14; i++) { var sp = document.createElement("span"); sp.textContent = chars[i % chars.length];
    sp.style.left = (Math.random() * 100).toFixed(1) + "%"; sp.style.animationDelay = (-Math.random() * 14).toFixed(1) + "s"; sp.style.animationDuration = (9 + Math.random() * 8).toFixed(1) + "s";
    sp.style.fontSize = (10 + Math.random() * 9).toFixed(0) + "px"; sp.style.setProperty("--dx", ((Math.random() - .5) * 120).toFixed(0) + "px"); sky.appendChild(sp); }
  H.insertBefore(sky, H.firstChild);
  var em = EMB[th[2]] || "✨", cur = "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><text x="2" y="22" font-size="20">' + em + "</text></svg>") + "\") 4 4, auto";
  var last = 0, pool = 0;
  function trail(e) {
    var now = performance.now(); if (now - last < 70 || pool > 12) return; last = now; pool++;
    var t = document.createElement("span"); t.className = "ss-tr no-invert"; t.textContent = chars[Math.floor(Math.random() * chars.length)];
    t.style.left = e.clientX + "px"; t.style.top = e.clientY + "px"; t.style.setProperty("--dx", ((Math.random() - .5) * 40).toFixed(0) + "px");
    document.body.appendChild(t); setTimeout(function () { t.remove(); pool--; }, 900);
  }
  function apply() {
    document.documentElement.classList.toggle("ss-fx", fxOn); document.documentElement.style.setProperty("--ss-cur", fxOn ? cur : "auto");
    document.removeEventListener("mousemove", trail); if (fxOn) document.addEventListener("mousemove", trail, { passive: true });
    var b = bar.querySelector(".ss-fxb"); if (b) { b.textContent = fxOn ? "✨ Effects on" : "Effects off"; b.setAttribute("aria-pressed", fxOn); }
  }
  var fb = document.createElement("button"); fb.type = "button"; fb.className = "ss-fxb"; fb.title = "Seasonal cursor and animations"; bar.insertBefore(fb, bar.querySelector(".ss-x"));
  fb.addEventListener("click", function () { fxOn = !fxOn; try { localStorage.setItem(FX, fxOn ? "1" : "0"); } catch (e) {} apply(); });
  apply();
  var css2 = document.createElement("style");
  css2.textContent = ".ss-sky{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit;z-index:0;display:none}.ss-fx .ss-sky{display:block}" +
    ".ss-sky span{position:absolute;top:-24px;opacity:.55;animation:ssfall linear infinite;filter:saturate(.9)}" +
    "@keyframes ssfall{0%{transform:translate(0,0) rotate(0)}100%{transform:translate(var(--dx),190px) rotate(260deg);opacity:0}}" +
    ".topbar.ss-on>*:not(.ss-sky):not(.theme-sw){position:relative;z-index:1}.topbar.ss-on>.theme-sw{z-index:2}" +
    ".topbar.ss-on::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,var(--ss2),transparent);background-size:50% 100%;background-repeat:no-repeat;animation:sssweep 6s ease-in-out infinite;opacity:.8}" +
    "@keyframes sssweep{0%{background-position:-50% 0}100%{background-position:150% 0}}" +
    ".topbar.ss-on h1{background-size:200% 100%;animation:ssshine 8s ease-in-out infinite}@keyframes ssshine{0%,100%{background-position:0 0}50%{background-position:100% 0}}" +
    ".ss-fx body,.ss-fx main{cursor:var(--ss-cur)}.ss-fx a,.ss-fx button,.ss-fx [role=tab],.ss-fx [data-evgo],.ss-fx .gl{cursor:pointer}.ss-fx input,.ss-fx textarea,.ss-fx select{cursor:auto}" +
    ".ss-tr{position:fixed;z-index:99;pointer-events:none;font-size:13px;transform:translate(-50%,-50%);animation:sstr .9s ease-out forwards}" +
    "@keyframes sstr{0%{opacity:.9;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + 26px)) scale(.5) rotate(90deg)}}" +
    ".ss-fxb{appearance:none;border:1px solid color-mix(in srgb,var(--ss2) 50%,transparent);background:transparent;color:var(--muted);font:600 11px 'IBM Plex Mono',monospace;border-radius:10px;padding:2px 8px;cursor:pointer;white-space:nowrap}" +
    ".ss-fxb[aria-pressed=true]{color:var(--ss2)}" +
    "@media (prefers-reduced-motion:reduce){.ss-sky,.topbar.ss-on::after{display:none}.topbar.ss-on h1{animation:none}}";
  document.head.appendChild(css2);
  window.SEASON = { theme: th[2], title: th[3], fx: function () { return fxOn; } };
})();
