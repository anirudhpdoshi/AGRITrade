/* Policy tab — Central Bank Policy Intelligence (Fed, ECB, BoE, BoC, BoJ).
   Reads policy.json from the `policyintel` branch (built by scripts/policy_intel.py from the banks' own sites).
   Four views: calendar · stance monitor · transcript intelligence · policy & markets.
   Rhetoric scores are inferences from the text; market pricing is observed data — the two are always shown apart. */
(function () {
  "use strict";
  var P = document.getElementById("panel-policy"); if (!P) return;
  var REPO = "anirudhpdoshi/AGRITrade", API = "https://api.github.com/repos/" + REPO + "/contents/policy.json?ref=policyintel",
      RAW = "https://raw.githubusercontent.com/" + REPO + "/policyintel/policy.json", TZ = "America/Toronto";
  var J = null, err = null, etag = "", lastTry = 0;
  var V = (function () { try { return JSON.parse(localStorage.getItem("desk.policyView") || "{}"); } catch (e) { return {}; } })();
  V.sub = V.sub || "monitor"; V.bank = V.bank || "all"; V.sort = V.sort || "date";
  function save() { try { localStorage.setItem("desk.policyView", JSON.stringify(V)); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fl(cc) { try { return window.WORLD && WORLD.flag ? WORLD.flag(cc) : ""; } catch (e) { return ""; } }
  function bname(b) { return (J && J.banks[b] && J.banks[b].name) || b.toUpperCase(); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) : "—"; }
  function sgn(v) { return v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1); }
  function lcls(l) { return /HAWK/.test(l || "") ? "hawk" : /DOV/.test(l || "") ? "dove" : "neu"; }
  function chg(v) { return v == null ? '<span class="neu">—</span>' : '<span class="' + (v >= 1 ? "hawk" : v <= -1 ? "dove" : "neu") + '">' + sgn(v) + (v >= 1 ? " more hawkish" : v <= -1 ? " more dovish" : " little change") + "</span>"; }
  var TYPE = { statement: "Policy statement", minutes: "Minutes / accounts", press_conference: "Press conference", speech: "Speech", testimony: "Testimony", interview: "Interview" };

  function poll(force) {
    if (window.DESK_LOCKED) return; if (!force && Date.now() - lastTry < 60000) return; lastTry = Date.now();
    var h = { Accept: "application/vnd.github.raw+json" }; if (etag) h["If-None-Match"] = etag;
    fetch(API, { headers: h, cache: "no-store" }).then(function (r) { if (r.status === 304) return null; if (!r.ok) throw r.status; etag = r.headers.get("ETag") || ""; return r.json(); })
      .then(function (j) { if (j) { J = j; err = null; render(); } })
      .catch(function () { fetch(RAW + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
        .then(function (j) { J = j; err = null; render(); }).catch(function () { err = 1; if (!J) render(); }); });
  }
  function docs() { return ((J && J.docs) || []).filter(function (d) { return V.bank === "all" || d.bank === V.bank; }); }
  function calTime(c) { if (!c.time || !window.zonedMs) return null; var p = c.date.split("-"), h = c.time.split(":"), tz = c.tz === "Europe/Frankfurt" ? "Europe/Berlin" : c.tz;
    try { return zonedMs(+p[0], +p[1], +p[2], +h[0], +h[1], tz); } catch (e) { return null; } }

  /* ---------- top strip: one card per bank ---------- */
  function strip() {
    var now = Date.now();
    return '<div class="pi-strip">' + Object.keys(J.banks).map(function (b) {
      var s = J.stance[b] || {}, st = s.statement, nx = (J.calendar || []).filter(function (c) { return c.bank === b && c.kind === "decision" && (calTime(c) || Date.parse(c.date + "T23:59:00Z")) > now; })[0];
      var chgS = st && s.speeches_mean != null ? s.speeches_mean - st.score : null;
      return '<button class="pi-card ' + (V.bank === b ? "on" : "") + '" data-pib="' + b + '"><div class="pi-ch">' + fl(J.banks[b].cc) + " " + esc(bname(b)) + "</div>" +
        (st ? '<div class="pi-sc ' + lcls(st.label) + '">' + sgn(st.score) + ' <small>' + esc(st.label.toLowerCase()) + "</small></div><div class=\"pi-sub\">last statement " + day(st.published_at) + "</div>" : '<div class="pi-sc neu">—</div><div class="pi-sub">no statement read yet</div>') +
        '<div class="pi-sub">' + (s.speeches_since ? s.speeches_since + " remark" + (s.speeches_since > 1 ? "s" : "") + " since: " + chg(chgS) : "no remarks since") + "</div>" +
        '<div class="pi-sub">next decision <b>' + (nx ? esc(day(nx.date + "T12:00:00Z")) : "—") + "</b></div></button>"; }).join("") + "</div>";
  }

  /* ---------- 1. calendar ---------- */
  function calendarHTML() {
    var now = Date.now(), rows = (J.calendar || []).filter(function (c) { return V.bank === "all" || c.bank === V.bank; });
    return '<div class="tile wide"><h2>Policy calendar <span class="h2note">— decisions, minutes and reports · official schedules as of ' + esc(J.calendar_asof) + ' (schedules can change; the source page is rechecked on each build)</span></h2>' +
      '<div class="tbl-scroll"><table class="oi-mtab pi-tab"><thead><tr><th>Bank</th><th>Date</th><th>Local time</th><th>Toronto (ET)</th><th>Event</th><th>Countdown</th></tr></thead><tbody>' +
      rows.map(function (c) { var t = calTime(c), past = t ? t < now : Date.parse(c.date + "T23:59:00Z") < now;
        return '<tr class="' + (past ? "pi-past" : "") + '"><td>' + fl(J.banks[c.bank].cc) + " " + esc(bname(c.bank)) + "</td><td>" + esc(new Date(c.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })) + "</td><td>" +
          (c.time ? esc(c.time) + " <small>" + esc(({ "Europe/Berlin": "Frankfurt", "Europe/Frankfurt": "Frankfurt" })[c.tz] || c.tz.split("/")[1].replace("_", " ")) + "</small>" : "time TBA") + "</td><td>" + (t ? new Date(t).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "—") + "</td><td>" + esc(c.what) +
          (c.kind === "decision" ? ' <span class="evc" style="--ec:#e8b93d">DECISION</span>' : "") + "</td><td>" + (t && !past ? '<span class="countdown" data-t="' + t + '">' + (window.cdText ? cdText(t - now) : "") + "</span>" : past ? "done" : "") + "</td></tr>"; }).join("") +
      "</tbody></table></div></div>";
  }

  /* ---------- 2. stance monitor (sortable) ---------- */
  function monitorHTML() {
    var L = docs().slice(), k = V.sort;
    L.sort(function (a, b) { var f = { date: function (d) { return d.published_at || ""; }, score: function (d) { return d.score; }, change: function (d) { return (d.baseline.speaker || d.baseline.institution || {}).change || 0; },
      bank: function (d) { return d.bank; }, speaker: function (d) { return d.speaker; } }[k] || function (d) { return d.published_at; }; var x = f(a), y = f(b); return x < y ? 1 : x > y ? -1 : 0; });
    if (k === "bank" || k === "speaker") L.reverse();
    function th(id, l) { return '<th><button class="pi-sort' + (V.sort === id ? " on" : "") + '" data-pisort="' + id + '">' + l + (V.sort === id ? " ▾" : "") + "</button></th>"; }
    return '<div class="tile wide"><h2>Stance monitor <span class="h2note">— every statement, minute and speech read from the official sites · click a row for the evidence</span></h2>' +
      (L.length ? '<div class="tbl-scroll"><table class="oi-mtab pi-tab"><thead><tr>' + th("bank", "Bank") + th("speaker", "Speaker") + "<th>Type</th><th>Voting</th>" + th("score", "Score") + th("change", "vs own baseline") + "<th>vs bank statement</th><th>Guidance</th><th>Confidence</th>" + th("date", "Date") + "</tr></thead><tbody>" +
        L.map(function (d) { var sb = d.baseline.speaker, ib = d.baseline.institution;
          return '<tr class="pi-row" data-pidoc="' + d.id + '"><td>' + fl(J.banks[d.bank].cc) + " " + esc(d.bank.toUpperCase()) + "</td><td><b>" + esc(d.speaker) + '</b><small class="pi-t">' + esc(d.title.slice(0, 70)) + "</small></td><td>" + esc(TYPE[d.type] || d.type) + "</td><td><small>" + esc(d.voting_status.replace("_", " ").toLowerCase()) + "</small></td>" +
            '<td><span class="pi-badge ' + lcls(d.label) + '">' + sgn(d.score) + "</span></td><td>" + (sb ? chg(sb.change) + '<small class="pi-t">n=' + sb.n + " since " + esc(sb.since) + (sb.low_confidence ? " · thin" : "") + "</small>" : '<span class="neu">first on record</span>') + "</td>" +
            "<td>" + (ib && d.type !== "statement" ? chg(ib.change) : '<span class="neu">—</span>') + "</td><td><small>" + esc(d.guidance.next_action) + "</small></td><td>" + esc(d.confidence.level) + "</td><td>" + esc(day(d.published_at)) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="note">No documents yet' + (V.bank !== "all" ? " for " + esc(bname(V.bank)) : "") + " — the engine reads each bank’s feeds every hour (every 15 minutes on decision days).</p>") + "</div>";
  }

  /* ---------- 3. transcript intelligence ---------- */
  function themeBars(t, cmp) {
    var keys = ["inflation", "employment", "growth", "financial", "guidance"], mx = 1;
    keys.forEach(function (k) { mx = Math.max(mx, Math.abs(t[k] || 0), cmp ? Math.abs(cmp[k] || 0) : 0); });
    return '<div class="pi-th">' + keys.map(function (k) { var v = t[k] || 0, c = cmp ? cmp[k] || 0 : null;
      function bar(x, cl) { var w = Math.abs(x) / mx * 50; return '<span class="pi-bar ' + cl + '" style="' + (x >= 0 ? "left:50%" : "right:50%") + ";width:" + w.toFixed(1) + '%"></span>'; }
      return '<div class="pi-tr"><span class="pi-tk">' + k + '</span><span class="pi-track">' + (c != null ? bar(c, "prev") : "") + bar(v, v >= 0 ? "hawk" : "dove") + '</span><span class="pi-tv">' + sgn(v) + (c != null ? ' <small>(' + sgn(c) + ")</small>" : "") + "</span></div>"; }).join("") + "</div>";
  }
  function quotes(d) {
    return d.evidence.length ? d.evidence.map(function (e) { return '<blockquote class="pi-q ' + e.dir + '"><span>' + (e.dir === "hawk" ? "Hawkish" : "Dovish") + " · " + esc(e.theme) + (e.cond ? " · conditional (½ weight)" : "") + " · ¶" + e.para + "</span>“" + esc(e.q) + "”</blockquote>"; }).join("") : '<p class="note">No sentence matched the policy lexicon strongly enough to quote.</p>';
  }
  function transcriptHTML() {
    var L = docs(), d = L.filter(function (x) { return x.id === V.doc; })[0] || L[0];
    if (!d) return '<div class="tile wide"><p class="note">No documents yet.</p></div>';
    var prev = L.filter(function (x) { return x.id !== d.id && x.bank === d.bank && (x.published_at || "") < (d.published_at || "") && (d.speaker !== "Committee" ? x.speaker === d.speaker : x.type === d.type); })[0];
    var opts = L.slice(0, 60).map(function (x) { return '<option value="' + x.id + '"' + (x.id === d.id ? " selected" : "") + ">" + esc(x.bank.toUpperCase() + " · " + day(x.published_at) + " · " + x.speaker + " — " + x.title.slice(0, 70)) + "</option>"; }).join("");
    var g = d.guidance;
    return '<div class="tile wide"><h2>Transcript intelligence <span class="h2note">— what was said, what changed, what it may mean</span></h2><select class="pi-sel" data-pisel>' + opts + "</select>" +
      '<div class="pi-doc"><div class="pi-dh">' + fl(J.banks[d.bank].cc) + " <b>" + esc(d.title) + '</b><div class="pi-sub">' + esc(bname(d.bank)) + " · " + esc(TYPE[d.type] || d.type) + " · " + esc(d.speaker) + " · voting " + esc(d.voting_status.replace("_", " ").toLowerCase()) + " · published " + esc(day(d.published_at)) + " · " + d.words + " words · v" + d.version +
        (/^https:\/\//.test(d.url) ? ' · <a href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">official text ↗</a>' : "") + "</div></div>" +
      '<div class="pi-3"><div><div class="pi-l">1 · What was said (rhetoric score)</div><div class="pi-big ' + lcls(d.label) + '">' + sgn(d.score) + " <small>" + esc(d.label) + "</small></div><div class=\"pi-sub\">hawkish weight " + d.hawk_n + " · dovish " + d.dove_n + " · confidence <b>" + esc(d.confidence.level) + "</b>" + (d.confidence.why.length ? " (" + esc(d.confidence.why.join(", ")) + ")" : "") + "</div></div>" +
        '<div><div class="pi-l">2 · What changed</div>' + (d.baseline.speaker ? '<div class="pi-sub">vs ' + esc(d.speaker) + "’s own baseline (" + d.baseline.speaker.n + " item" + (d.baseline.speaker.n > 1 ? "s" : "") + " since " + esc(d.baseline.speaker.since) + (d.baseline.speaker.low_confidence ? ", thin — extended past 60 days" : "") + "): " + chg(d.baseline.speaker.change) + "</div>" : '<div class="pi-sub">first item on record for this speaker</div>') +
          (d.baseline.institution && d.type !== "statement" ? '<div class="pi-sub">vs the bank’s last statement (' + esc(d.baseline.institution.date) + ", " + sgn(d.baseline.institution.score) + "): " + chg(d.baseline.institution.change) + "</div>" : "") +
          (d.revised_from ? '<div class="pi-sub">⚠ the official text was revised after first publication (score was ' + sgn(d.revised_from.score) + ")</div>" : "") + "</div>" +
        '<div><div class="pi-l">3 · What it may mean (inference)</div><div class="pi-sub"><b>' + esc(g.next_action) + "</b></div>" + (g.quote ? '<blockquote class="pi-q g">“' + esc(g.quote) + "”</blockquote>" : "") + '<div class="pi-sub">Guidance is read separately from the score: conditional language is never treated as a commitment.</div></div></div>' +
      '<div class="pi-2"><div><div class="pi-l">Themes' + (prev ? " — this item vs the previous comparable one (" + esc(day(prev.published_at)) + ", in brackets)" : "") + "</div>" + themeBars(d.themes, prev && prev.themes) + "</div>" +
        '<div><div class="pi-l">Evidence — exact sentences from the official text</div>' + quotes(d) + "</div></div>" +
      (prev ? '<details class="pi-prev"><summary>Previous comparable item: ' + esc(prev.title.slice(0, 90)) + " (" + esc(day(prev.published_at)) + ", " + sgn(prev.score) + ")</summary>" + quotes(prev) + "</details>" : "") + "</div></div>";
  }

  /* ---------- 4. policy & markets ---------- */
  function marketsHTML() {
    var F = (window.DATA && DATA.fx && DATA.fx.policy) || {}, fed = (F.fed || []).slice(0, 3), corra = F.corra || [];
    var rh = function (b) { var s = (J.stance || {})[b]; return s && s.statement ? '<span class="pi-badge ' + lcls(s.statement.label) + '">' + sgn(s.statement.score) + "</span> " + esc(s.statement.label.toLowerCase()) + " (statement " + day(s.statement.published_at) + ")" + (s.speeches_mean != null ? " · remarks since " + sgn(s.speeches_mean) : "") : "no statement read yet"; };
    return '<div class="tile wide"><h2>Policy &amp; markets <span class="h2note">— rhetoric (inferred from text) shown apart from market pricing (observed)</span></h2><div class="pi-2">' +
      '<div class="pi-mk"><div class="pi-l">' + fl("us") + " Federal Reserve</div><div class=\"pi-sub\"><b>Rhetoric:</b> " + rh("fed") + '</div><div class="pi-sub"><b>Market pricing</b> (fed funds futures): ' + (fed.length ? "" : "not loaded") + "</div>" +
        fed.map(function (m) { return '<div class="pi-sub">' + esc(day(m.meeting + "T12:00:00Z")) + ": hold " + m.no_change_pct + "% · hike " + m.hike_pct + "% · cut " + m.ease_pct + "%</div>"; }).join("") + "</div>" +
      '<div class="pi-mk"><div class="pi-l">' + fl("ca") + " Bank of Canada</div><div class=\"pi-sub\"><b>Rhetoric:</b> " + rh("boc") + '</div><div class="pi-sub"><b>Market pricing</b> (CORRA futures' + (F.corra_asof ? ", " + esc(F.corra_asof) : "") + "): current " + (F.corra_now != null ? F.corra_now.toFixed(2) + "%" : "—") + "</div>" +
        corra.map(function (c) { return '<div class="pi-sub">' + esc(c.month) + ": implied " + c.implied_rate_pct.toFixed(2) + "% (" + sgn((c.implied_rate_pct - (F.corra_now || 0)) * 100).replace(".0", "") + " bp)</div>"; }).join("") + "</div>" +
      ["ecb", "boe", "boj"].map(function (b) { return '<div class="pi-mk"><div class="pi-l">' + fl(J.banks[b].cc) + " " + esc(bname(b)) + '</div><div class="pi-sub"><b>Rhetoric:</b> ' + rh(b) + '</div><div class="pi-sub neu">Market pricing (OIS) not connected yet — next phase.</div></div>'; }).join("") +
      '</div><div class="stamp">A hawkish-sounding speech that markets already expected moves pricing little; a genuine surprise reprices the path. Scores are a phrase-based reading of official text, not a forecast or trading advice.</div></div>';
  }

  function render() {
    if (!J) { P.innerHTML = '<div class="tile wide">' + (err ? '<div class="unreach">⚠ Sorry, we can’t be reached now <small>— policy intelligence did not load; retrying every minute</small></div>' : '<p class="note">Loading policy intelligence…</p>') + "</div>"; return; }
    var subs = [["monitor", "Stance monitor"], ["transcript", "Transcript intelligence"], ["calendar", "Policy calendar"], ["markets", "Policy & markets"]];
    var src = Object.keys(J.status || {}).map(function (b) { var s = J.status[b], ok = Object.keys(s.sources || {}).filter(function (u) { return s.sources[u] === 200; }).length, n = Object.keys(s.sources || {}).length;
      return esc(b.toUpperCase()) + " " + ok + "/" + n; }).join(" · ");
    P.innerHTML = '<div class="tile wide pi-head"><h2>Central bank policy intelligence <span class="h2note">— Fed · ECB · BoE · BoC · BoJ, read from the banks’ own sites</span></h2>' + strip() +
      '<div class="pi-nav">' + subs.map(function (s) { return '<button data-pisub="' + s[0] + '" aria-pressed="' + (V.sub === s[0]) + '">' + s[1] + "</button>"; }).join("") +
      (V.bank !== "all" ? '<button data-pib="all">Show all banks ✕</button>' : "") + '</div><div class="stamp">Updated ' + esc(new Date(J.updated_at).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET · official sources reachable: " + src + "</div></div>" +
      (V.sub === "calendar" ? calendarHTML() : V.sub === "transcript" ? transcriptHTML() : V.sub === "markets" ? marketsHTML() : monitorHTML()) +
      '<div class="tile wide"><div class="stamp">Method: ' + esc(J.method || "") + " Evidence is quoted word-for-word with its paragraph number and the official link; voting status is shown only where it is certain for that date (BoC decides by consensus).</div></div>";
  }
  P.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var b = t.closest("[data-pib]"); if (b) { V.bank = b.getAttribute("data-pib"); save(); render(); return; }
    b = t.closest("[data-pisub]"); if (b) { V.sub = b.getAttribute("data-pisub"); save(); render(); return; }
    b = t.closest("[data-pisort]"); if (b) { V.sort = b.getAttribute("data-pisort"); save(); render(); return; }
    b = t.closest("[data-pidoc]"); if (b && !t.closest("a")) { V.doc = b.getAttribute("data-pidoc"); V.sub = "transcript"; save(); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  P.addEventListener("change", function (ev) { var s = ev.target.closest && ev.target.closest("[data-pisel]"); if (s) { V.doc = s.value; save(); render(); } });
  document.addEventListener("click", function (ev) { if (ev.target.closest && ev.target.closest("#tabbtn-policy")) { render(); poll(true); } });
  setInterval(function () { if (P.classList.contains("active")) poll(); }, 60000);
  window.addEventListener("desk:unlock", function () { poll(true); });
  window.POLICY = { render: render, poll: poll, _data: function () { return J; } };
  render(); if (window.DESK_LOCKED === false) poll(true);
})();
