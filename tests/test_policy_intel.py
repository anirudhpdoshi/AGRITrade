"""Scoring, forward-guidance and parsing checks for scripts/policy_intel.py (no network)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import policy_intel as P

n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1

a = P.analyse("There could be a need to raise the policy rate further, but we will proceed carefully. Inflation remains elevated.")
ok(a["score"] > 0 and a["guidance"]["direction"] == "tighten" and a["guidance"]["conditional"], "conditional tightening is hawkish but conditional")
ok("not a commitment" in a["guidance"]["next_action"], "conditional tightening is not a predicted hike")
b = P.analyse("Inflation has moderated and is close to the target. Unemployment has risen. Further easing may be warranted.")
ok(b["score"] <= -2 and b["guidance"]["direction"] == "ease", "dovish text scores dovish")
c = P.analyse("Inflation is no longer elevated.")
ok(c["score"] < 0, "negation flips a hawkish phrase")
ok(all(e["q"] in "Inflation has moderated and is close to the target. Unemployment has risen. Further easing may be warranted." for e in b["evidence"]), "evidence is exact text")
ok(P.classify("Federal Reserve issues FOMC statement") == "statement", "statement type")
ok(P.classify("Speech by Governor Waller on the outlook") == "speech", "speech type")
ok(P.classify("Agencies announce enforcement action") is None, "non-policy items skipped")
ok(P.speaker_of("Speech by Governor Waller on the outlook", "", "speech") == "Waller", "speaker surname")
ok(P.speaker_of("x", "", "statement") == "Committee", "statements are committee documents")
ok(P.parse_date("Wed, 28 Oct 2026 18:00:00 GMT").startswith("2026-10-28T18:00"), "RSS date")
j = P.analyse("Guideline for money market operations (an 8-1 majority vote). The Bank will encourage the uncollateralized overnight call rate to remain at around 1.25 percent. If the outlook is realized, the Bank will continue to raise the policy interest rate.")
ok(j["relevance"] >= 2 and j["dissent"] and j["guidance"]["direction"] == "tighten" and j["guidance"]["conditional"], "BoJ wording: call-rate guideline, majority vote, conditional hikes")
ok(P.page_text(P.PDF_MARK + "plain text") == "plain text", "PDF text passes through untouched")
H = ('<tr><td><a href="/en/mopo/mpmdeci/mpr_2026/k261030a.pdf">Oct. 29 (Thurs.), 30 (Fri.) [PDF 172KB]</a></td><td><a href="/en/mopo/outlook/gor2610a.pdf">Oct. 30 (Fri.) [PDF 247KB]</a></td><td>Nov. 10 (Tues.)</td></tr>'
     '<tr><td><a href="/en/mopo/mpmdeci/mpr_2026/k260918a.pdf">Sept. 17 (Thurs.), 18 (Fri.) [PDF 204KB]</a></td><td>-</td><td><a href="/en/mopo/mpmsche_minu/opinion_2026/opi260918.pdf">Oct. 1 (Thurs.) [PDF 227KB]</a></td></tr>')
T = {i["link"].rsplit("/", 1)[1]: (i["title"], i["date"][:10]) for i in P.boj_table(H, "x")}
ok(T == {"k261030a.pdf": ("Statement on Monetary Policy", "2026-10-30"), "gor2610a.pdf": ("Outlook for Economic Activity and Prices (The Bank's View)", "2026-10-30"),
         "k260918a.pdf": ("Statement on Monetary Policy", "2026-09-18"), "opi260918.pdf": ("Summary of Opinions at the Monetary Policy Meeting", "2026-10-01")}, f"BoJ MPM table parsed: {T}")
ok(P.classify("Outlook for Economic Activity and Prices (The Bank's View)") == "statement", "Outlook Report is a committee document")
print(f"{n}/{n} passed")
