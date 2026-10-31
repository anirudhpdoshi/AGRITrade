/* Real-data validation of co-engine.js against live SEC EDGAR filings (run in GitHub Actions; nothing is stored).
   Shapes the data exactly as the Worker does, builds each company, and prints an audit:
   quarter labels, coverage of the key metrics, how each latest-quarter value was obtained, the four verdicts, and a
   reconciliation check (sum of the last four derived quarters vs the reported fiscal year where they line up).
   Usage: node scripts/sec_validate.js META GOOGL ...      (exit code 1 if any company fails a hard check) */
const E = require("../co-engine.js");
const UA = { "User-Agent": "AGRITrade desk anirudh.p.doshi@gmail.com", Accept: "application/json" };
const FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT", "10-QT"]);
const TAGS = [...new Set([].concat(...Object.values(E.DUR), ...Object.values(E.INST)))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(u) { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(u + " HTTP " + r.status); await sleep(150); return r.json(); }

async function company(t, list) {
  const hit = list.find((x) => x.ticker === t); if (!hit) throw new Error(t + " not in SEC list");
  const cik = String(hit.cik).padStart(10, "0");
  const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`), cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const cutoff = new Date(Date.now() - (5 * 365 + 120) * 864e5).toISOString().slice(0, 10), keep = {}, ug = (cf.facts && cf.facts["us-gaap"]) || {};
  for (const tag of TAGS) { const u = ug[tag] && ug[tag].units; if (!u) continue;
    for (const unit of Object.keys(u)) { const rows = u[unit].filter((r) => r.end >= cutoff && FORMS.has(r.form)).map((r) => ({ s: r.start, e: r.end, v: r.val, f: r.form, d: r.filed, a: r.accn }));
      if (rows.length) (keep[tag] = keep[tag] || {})[unit] = rows; } }
  const rf = sub.filings.recent, filings = [];
  for (let i = 0; i < rf.form.length && filings.length < 60; i++) { if (rf.form[i] === "8-K" && !String(rf.items[i] || "").includes("2.02")) continue;
    filings.push({ form: rf.form[i], filed: rf.filingDate[i], period: rf.reportDate[i], items: rf.items[i] || "" }); }
  return { ticker: t, cik, name: sub.name, sic: sub.sic, sicDescription: sub.sicDescription, fiscalYearEnd: sub.fiscalYearEnd, filings, facts: keep, ifrs: !!(cf.facts && cf.facts["ifrs-full"]) };
}

(async () => {
  const tick = process.argv.slice(2);
  const raw = await get("https://www.sec.gov/files/company_tickers_exchange.json"), f = raw.fields;
  const list = raw.data.map((r) => ({ cik: r[f.indexOf("cik")], ticker: r[f.indexOf("ticker")], name: r[f.indexOf("name")] }));
  console.log(`SEC list: ${list.length} US-listed tickers`);
  const KEY = ["rev", "gp", "opinc", "ni", "eps_d", "cfo", "capex", "fcf", "cash", "gdebt", "ar", "inv"];
  let bad = 0;
  for (const t of tick) {
    try {
      const co = await company(t, list), M = E.build(co), Q = M.quarters.slice(-8), L = Q[Q.length - 1];
      const V = E.verdicts(M, null);
      console.log(`\n=== ${t} · ${co.name} · SIC ${co.sic} ${co.sicDescription} · FYE ${co.fiscalYearEnd} · model ${M.model.kind}`);
      console.log("quarters: " + Q.map((q) => q.fl.label + "(" + q.end + ")").join(" "));
      const cov = KEY.map((k) => k + " " + Q.filter((q) => q.m[k] && q.m[k].v != null).length + "/8").join(" · ");
      console.log("coverage: " + cov);
      console.log("latest " + L.fl.label + ": " + ["rev", "gm", "opm", "ni", "eps_d", "cfo", "fcf", "ndebt"].map((k) => {
        const m = L.m[k]; return k + "=" + (m && m.v != null ? (["gm", "opm"].includes(k) ? m.v.toFixed(1) + "%" : k === "eps_d" ? m.v.toFixed(2) : E.fmt(m.v)) + "[" + m.st[0] + (m.tag ? ":" + m.tag.slice(0, 28) : "") + "]" : "—"); }).join(" "));
      console.log("rev: " + Q.map((q) => q.m.rev ? E.fmt(q.m.rev.v) + q.m.rev.st[0] : "—").join(" ") + "   cfo: " + Q.map((q) => q.m.cfo ? E.fmt(q.m.cfo.v) + q.m.cfo.st[0] : "—").join(" "));
      /* reconciliation: four derived quarters ending at a fiscal year end must sum to the filed full year */
      for (const a of M.annual.slice(-2)) {
        const i = M.quarters.findIndex((q) => Math.abs(Date.parse(q.end) - Date.parse(a.end)) < 7 * 864e5);
        if (i >= 3 && a.m.rev) { const s = E.ttm(M.quarters, i, "rev"); const d = s == null ? null : (s / a.m.rev.v - 1) * 100;
          console.log(`reconcile FY${a.fy} revenue: quarters ${E.fmt(s)} vs filed ${E.fmt(a.m.rev.v)} → ${d == null ? "n/a" : d.toFixed(3) + "%"}`);
          if (d != null && Math.abs(d) > 0.5) { bad++; console.log("  !! reconciliation off by more than 0.5%"); } }
        if (i >= 3 && a.m.cfo) { const s = E.ttm(M.quarters, i, "cfo"); const d = s == null ? null : (s / a.m.cfo.v - 1) * 100;
          console.log(`reconcile FY${a.fy} CFO: quarters ${E.fmt(s)} vs filed ${E.fmt(a.m.cfo.v)} → ${d == null ? "n/a" : d.toFixed(3) + "%"}`);
          if (d != null && Math.abs(d) > 0.5) { bad++; console.log("  !! CFO reconciliation off by more than 0.5%"); } }
      }
      console.log("verdicts: " + V.verdicts.map((v) => v.name.split(" ").map((w) => w[0]).join("") + "=" + v.verdict + "(" + (v.confidence || "-") + ")").join(" ") +
        " · history EQ " + V.history.map((h) => h.eq[0]).join("") + " FR " + V.history.map((h) => h.fr[0]).join(""));
      console.log("eq evidence: " + V.verdicts[0].evidence.map((e) => (e.sign > 0 ? "+" : e.sign < 0 ? "−" : "·") + e.text).join(" | "));
      if (!L.m.rev && M.model.kind === "operating") { bad++; console.log("  !! no latest revenue for an operating company"); }
      if (Q.length < 8) console.log("  note: only " + Q.length + " quarters in the 5-year window");
    } catch (e) { bad++; console.log(`\n=== ${t} FAILED: ${e.message}`); }
  }
  console.log(`\n${tick.length - bad >= 0 ? "" : ""}done: ${bad} problem(s)`);
  process.exit(bad ? 1 : 0);
})();
