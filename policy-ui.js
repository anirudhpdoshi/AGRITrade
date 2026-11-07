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

  /* ---------- 2. stance monitor: one panel per bank — the committee's latest statement, then every document since, newest first ---------- */
  function monitorHTML() {
    var L = docs(), banks = Object.keys(J.banks).filter(function (b) { return V.bank === "all" || V.bank === b; });
    var panels = banks.map(function (b) {
      var D = L.filter(function (d) { return d.bank === b; }).sort(function (x, y) { return (y.published_at || "") < (x.published_at || "") ? -1 : 1; });
      var st = D.filter(function (d) { return d.type === "statement" && d.speaker === "Committee"; })[0];
      var head = '<div class="pm-h"><div class="pm-b">' + fl(J.banks[b].cc) + " <b>" + esc(bname(b)) + "</b></div>" +
        (st ? '<div class="pm-s"><span class="pi-badge ' + lcls(st.label) + '">' + sgn(st.score) + '</span> <span class="pm-l ' + lcls(st.label) + '">' + esc((st.label || "").toLowerCase()) + "</span>" +
          '<span class="pm-g">' + esc(st.guidance.next_action) + "</span><span class=\"pm-d\">statement " + esc(day(st.published_at)) + "</span></div>" : '<div class="pm-s"><span class="neu">no committee statement read yet</span></div>') + "</div>";
      var rows = D.slice(0, 8).map(function (d) {
        var sb = d.baseline.speaker || (d.type !== "statement" ? d.baseline.institution : null);
        return '<li class="pm-r" data-pidoc="' + d.id + '" title="Open the evidence"><span class="pm-dt">' + esc(day(d.published_at)) + '</span><span class="pm-ty">' + esc(TYPE[d.type] || d.type) + "</span>" +
          '<span class="pm-ti"><b>' + esc(d.speaker) + "</b> — " + esc(d.title) + (d.dissent && d.dissent.length ? ' <span class="evc" style="--ec:#e8b93d">DISSENT</span>' : "") + "</span>" +
          '<span class="pm-sc"><span class="pi-badge ' + lcls(d.label) + '">' + sgn(d.score) + "</span></span>" +
          '<span class="pm-vs">' + (sb && sb.change != null ? '<span class="' + (sb.change >= 1 ? "hawk" : sb.change <= -1 ? "dove" : "neu") + '" title="' + (sb.change >= 1 ? "more hawkish" : sb.change <= -1 ? "more dovish" : "little change") + ' than ' + (d.baseline.speaker ? "this speaker\u2019s own baseline" : "the bank\u2019s statement") + '">' + sgn(sb.change) + "</span>" + ' <small>vs ' + (d.baseline.speaker ? "own" : "bank") + "</small>" : '<small class="neu">first read</small>') + "</span></li>"; }).join("");
      return '<div class="pm-card">' + head + guidanceHTML(b, D, st) + (rows ? '<ul class="pm-list">' + rows + "</ul>" : '<p class="note">No documents yet.</p>') + (D.length > 8 ? '<div class="pm-more">+' + (D.length - 8) + " older — open Transcript intelligence</div>" : "") + "</div>";
    }).join("");
    return '<div class="tile wide"><h2>Stance monitor <span class="h2note">— per bank: the committee\u2019s latest statement, then every statement, minute and speech since · score −10 dovish … +10 hawkish · click a line for the evidence</span></h2>' +
      '<div class="pm-grid">' + panels + "</div></div>";
  }

  /* Toward the next decision: every remark since the meeting statement (speech, testimony, presser), time-stamped, with its tone,
     its explicit guidance sentence and direction; then what that adds up to for the next meeting, beside market pricing. */
  function guidanceHTML(b, D, st) {
    var since = st ? D.filter(function (d) { return d.type !== "statement" && d.type !== "minutes" && (d.published_at || "") > (st.published_at || ""); }) : [];
    var nx = (J.calendar || []).filter(function (c) { return c.bank === b && c.kind === "decision" && c.date >= new Date().toISOString().slice(0, 10); }).sort(function (x, y) { return x.date < y.date ? -1 : 1; })[0];
    var DIR = { tighten: ["HIKE", "hawk"], ease: ["CUT", "dove"], hold: ["HOLD", "neu"] }, KEY = { HIKE: "tighten", CUT: "ease", HOLD: "hold" };
    function tm(iso) { return iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—"; }
    var votes = { HIKE: 0, CUT: 0, HOLD: 0 }, toneD = [];
    var rows = since.map(function (d) {
      var g = d.guidance || {}, dir = DIR[g.direction], ch = d.baseline && d.baseline.institution && d.score != null ? d.score - d.baseline.institution.score : null;
      if (dir) votes[dir[0]]++; if (ch != null && d.policy_relevant !== false) toneD.push(ch);   /* off-topic talks do not move the tone read */
      return '<li class="pg-r"><span class="pg-t">' + esc(tm(d.published_at)) + '</span><span class="pg-w"><b>' + esc(d.speaker || "") + "</b> · " + esc(TYPE[d.type] || d.type) + "</span>" +
        '<span class="pg-s"><span class="pi-badge ' + lcls(d.label) + '">' + sgn(d.score) + "</span>" + (ch != null ? ' <small class="' + (ch >= 1 ? "hawk" : ch <= -1 ? "dove" : "neu") + '">' + (ch >= 0 ? "+" : "−") + Math.abs(ch).toFixed(1) + " vs meeting</small>" : "") + "</span>" +
        (dir ? '<span class="pg-g ' + dir[1] + '">' + dir[0] + (g.conditional ? " (conditional)" : "") + "</span>" : '<span class="pg-g neu">' + (d.policy_relevant === false ? "not about policy" : "no explicit guidance") + "</span>") +
        (g.quote ? '<q class="pg-q">' + esc(g.quote) + "</q>" : "") + "</li>";
    }).join("");
    var mk = "", P = (window.DATA && DATA.fx && DATA.fx.policy) || {};
    if (b === "fed" && P.fed && P.fed[0]) { var f = P.fed[0]; mk = "Market: " + Math.round(f.hike_pct) + "% hike · " + Math.round(f.no_change_pct) + "% hold · " + Math.round(f.ease_pct) + "% cut for " + esc(f.meeting) + " (fed funds futures)"; }
    if (b === "boc" && P.corra && P.corra[0] && P.corra_now != null) { var bp = Math.round((P.corra[0].implied_rate_pct - (+P.corra_now)) * 100); mk = "Market: CORRA futures imply " + (bp > 0 ? "+" : "") + bp + " bp by " + esc(P.corra[0].month) + " (" + (bp >= 13 ? "a hike priced" : bp <= -13 ? "a cut priced" : "no change priced") + ")"; }
    var n = votes.HIKE + votes.CUT + votes.HOLD, lead = n ? Object.keys(votes).sort(function (x, y) { return votes[y] - votes[x]; })[0] : null;
    var mt = toneD.length ? toneD.reduce(function (a, c) { return a + c; }, 0) / toneD.length : null;
    var exp = !since.length ? "No remarks since the meeting yet — the statement is the latest guidance."
      : (n ? 'Remarks lean <b class="' + DIR[KEY[lead]][1] + '">' + lead + "</b> (" + votes[lead] + " of " + n + " with explicit guidance)" : "No explicit rate guidance in the remarks") +
        (mt != null ? " · tone " + (mt >= 0 ? "+" : "−") + Math.abs(mt).toFixed(1) + " vs the meeting statement (" + (mt >= 1 ? "more hawkish" : mt <= -1 ? "more dovish" : "about the same") + ")" : "") + ".";
    return '<div class="pg"><div class="pg-h">Toward the next decision' + (nx ? " · " + esc(day(nx.date + "T12:00:00Z")) : "") + " · " + since.length + " remark" + (since.length === 1 ? "" : "s") + " since the meeting</div>" +
      '<div class="pg-x">' + exp + (mk ? '<div class="pg-m">' + mk + "</div>" : "") + "</div>" +
      (rows ? '<ul class="pg-l">' + rows + "</ul>" : "") + "</div>";
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
        "</div></div>" +
      '<div class="pi-3"><div><div class="pi-l">1 · What was said (rhetoric score)</div><div class="pi-big ' + lcls(d.label) + '">' + sgn(d.score) + " <small>" + esc(d.label) + "</small></div><div class=\"pi-sub\">hawkish weight " + d.hawk_n + " · dovish " + d.dove_n + " · confidence <b>" + esc(d.confidence.level) + "</b>" + (d.confidence.why.length ? " (" + esc(d.confidence.why.join(", ")) + ")" : "") + "</div></div>" +
        '<div><div class="pi-l">2 · What changed</div>' + (d.baseline.speaker ? '<div class="pi-sub">vs ' + esc(d.speaker) + "’s own baseline (" + d.baseline.speaker.n + " item" + (d.baseline.speaker.n > 1 ? "s" : "") + " since " + esc(d.baseline.speaker.since) + (d.baseline.speaker.low_confidence ? ", thin — extended past 60 days" : "") + "): " + chg(d.baseline.speaker.change) + "</div>" : '<div class="pi-sub">first item on record for this speaker</div>') +
          (d.baseline.institution && d.type !== "statement" ? '<div class="pi-sub">vs the bank’s last statement (' + esc(d.baseline.institution.date) + ", " + sgn(d.baseline.institution.score) + "): " + chg(d.baseline.institution.change) + "</div>" : "") +
          (d.dissent && d.dissent.length ? '<div class="pi-l" style="margin-top:8px">Disagreement on record</div>' + d.dissent.map(function (x) { return '<blockquote class="pi-q g">“' + esc(x.q) + "” <small>¶" + x.para + "</small></blockquote>"; }).join("") : "") +
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
      (V.bank !== "all" ? '<button data-pib="all">Show all banks ✕</button>' : "") + '</div><div class="stamp">Updated ' + esc(new Date(J.updated_at).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " ET</div></div>" +
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
  /* every minute while the tab is open; every 5 minutes in the background so new statements reach the Events feed */
  setInterval(function () { if (P.classList.contains("active") || Date.now() - lastTry > 300000) poll(); }, 60000);
  window.addEventListener("desk:unlock", function () { poll(true); });
  window.POLICY = { render: render, poll: poll, _data: function () { return J; },
    open: function (id) { V.doc = id; V.sub = "transcript"; save(); render(); } };
  render(); if (window.DESK_LOCKED === false) poll(true);
  var pmcss = document.createElement("style");
  pmcss.textContent = ".pg{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0;background:rgba(155,140,255,.05)}.pg-h{font:700 11px 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#b9aefc}.pg-x{font-size:13px;margin-top:4px}.pg-m{font:11.5px 'IBM Plex Mono',monospace;color:var(--muted);margin-top:3px}.pg-l{list-style:none;margin:6px 0 0;padding:0;max-height:260px;overflow:auto}.pg-r{display:grid;grid-template-columns:120px 1fr auto auto;gap:4px 8px;align-items:center;padding:5px 0;border-top:1px dashed var(--line);font-size:12.5px}.pg-t{font:11px 'IBM Plex Mono',monospace;color:var(--faint)}.pg-g{font:700 10.5px 'IBM Plex Mono',monospace}.pg-g.hawk,.pg-x b.hawk{color:#ff8a84}.pg-g.dove,.pg-x b.dove{color:#7dd8e6}.pg-g.neu{color:var(--muted);font-weight:400}.pg-q{grid-column:1/-1;color:#d4deea;font-style:italic}.pm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:14px}.pm-card{border:1px solid var(--line);border-radius:10px;background:var(--panel2);padding:12px 14px}" +
    ".pm-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}.pm-b{font-size:15px;display:flex;align-items:center;gap:6px}" +
    ".pm-s{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12.5px}.pm-l{font:600 11.5px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.06em}.pm-g{color:var(--muted)}.pm-d{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint)}" +
    ".pm-list{list-style:none;margin:6px 0 0;padding:0}.pm-r{display:grid;grid-template-columns:52px 112px minmax(0,1fr) 54px 84px;gap:10px;align-items:center;padding:7px 4px;border-bottom:1px dashed var(--line);cursor:pointer;font-size:13px}" +
    ".pm-r:hover{background:rgba(56,182,201,.07)}.pm-dt{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint)}.pm-ty{font:600 11px 'IBM Plex Mono',monospace;color:var(--cyan);text-transform:uppercase;letter-spacing:.04em}" +
    ".pm-ti{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}.pm-ti b{color:var(--ink);font-weight:600}.pm-sc{text-align:right}.pm-vs{font:12px 'IBM Plex Mono',monospace;text-align:right}.pm-vs small{color:var(--faint)}" +
    ".pm-more{font:11.5px 'IBM Plex Mono',monospace;color:var(--faint);margin-top:6px}" +
    "@media (max-width:760px){.pm-grid{grid-template-columns:minmax(0,1fr)}.pm-card{min-width:0;overflow-wrap:anywhere}.pm-r{grid-template-columns:48px minmax(0,1fr) 52px}.pm-ty,.pm-vs{display:none}}";
  document.head.appendChild(pmcss);
})();
