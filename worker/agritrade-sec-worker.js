/* AGRITrade — SEC company-data Worker (Cloudflare Workers, free plan).

   Why it exists: the desk is a static GitHub Pages site. SEC EDGAR and Yahoo do not allow browser (CORS) requests, so
   live ticker search needs a tiny server in between. This Worker fetches on demand and STORES NOTHING: no database, no
   KV, no logs of what was searched. The only caching is Cloudflare's normal short-lived HTTP edge cache (ticker list
   24 h, company data 1 h, prices 15 min) so repeated clicks do not re-hit SEC.

   Routes (GET only, JSON):
     /search?q=adm            ticker / company-name search over SEC's list of US-listed companies (top 12)
     /company?t=ADM           SEC submissions (identity, SIC, fiscal year-end, filings) + all US-GAAP XBRL facts from
                              10-Q/10-K filings, last ~5 years
     /prices?t=ADM&r=5y       Yahoo daily closes (r = 1y default, 2y, 5y, 10y, max) for the ticker and the S&P 500
     /filings?t=ADM           the company's earnings-release 8-Ks (Item 2.02), newest first, with SEC acceptance time
                              (fresh: 60 s cache) — the desk polls this only for the up-to-3 stocks a user locks for earnings
     /exhibit?t=ADM&acc=…     that 8-K's press release (exhibit 99.1) as HTML, scripts and styles removed (cached 1 day)
     /health                  {ok:true}

   SEC fair-access policy: every request names a contact in the User-Agent, and SEC allows ≤10 requests/second; a
   lookup here makes at most 3. Only the desk's own origin may call it (ALLOWED_ORIGINS).

   The contact is the Worker secret SEC_CONTACT (Settings → Variables and Secrets), not in this file.
   Smart placement runs the Worker near SEC's servers, so every request leaves from the same well-behaved region.
   Deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker → paste this file → Deploy. */

let CONTACT = "AGRITrade desk";   // contact email comes from the Cloudflare secret SEC_CONTACT (never in this public repo)
const ALLOWED_ORIGINS = ["https://anirudhpdoshi.github.io", "http://127.0.0.1", "http://localhost"];
const YEARS = 5;
const FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT", "10-QT"]);

/* Every us-gaap tag is passed through (last ~5 years, 10-Q/10-K only), so new desk cards never need this Worker
   re-deployed. Responses are gzip-compressed by Cloudflare. */
const DEI = ["EntityCommonStockSharesOutstanding"];

function cors(req) {
  const o = req.headers.get("Origin") || "";
  const ok = ALLOWED_ORIGINS.some((a) => o === a || o.startsWith(a + ":"));
  return { "Access-Control-Allow-Origin": ok ? o : ALLOWED_ORIGINS[0], "Vary": "Origin", "Access-Control-Allow-Methods": "GET" };
}
function json(req, body, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}`, ...cors(req) } });
}
async function getJSON(url, ttl) {
  const h = { "User-Agent": CONTACT, "Accept": "application/json", "Accept-Encoding": "gzip, deflate" };
  let r;
  for (let i = 0; i < 3; i++) {   // SEC answers 403/429 to bursts: back off and retry (still far under its 10 requests/second)
    r = await fetch(url, { headers: h, cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } } });
    if (r.ok || ![403, 429, 500, 502, 503].includes(r.status)) break;
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.json();
}

let TICKERS = null, TICKERS_AT = 0;   // per-isolate memory only; gone when the isolate recycles
async function tickers() {
  if (TICKERS && Date.now() - TICKERS_AT < 6 * 3600e3) return TICKERS;
  const j = await getJSON("https://www.sec.gov/files/company_tickers_exchange.json", 86400);
  const f = j.fields;   // ["cik","name","ticker","exchange"]
  TICKERS = j.data.map((r) => ({ cik: r[f.indexOf("cik")], name: r[f.indexOf("name")], ticker: r[f.indexOf("ticker")], exchange: r[f.indexOf("exchange")] }));
  TICKERS_AT = Date.now();
  return TICKERS;
}

async function search(req, q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return json(req, { results: [] });
  const L = await tickers(), out = [];
  const score = (t) => {
    const tk = t.ticker.toLowerCase(), nm = t.name.toLowerCase();
    if (tk === q) return 0;
    if (tk.startsWith(q)) return 1 + tk.length / 100;
    if (nm.startsWith(q)) return 2;
    if (nm.split(/[\s,.-]+/).some((w) => w.startsWith(q))) return 3;
    if (nm.includes(q)) return 4;
    return null;
  };
  for (const t of L) { const s = score(t); if (s != null) out.push([s, t]); }
  out.sort((a, b) => a[0] - b[0]);
  return json(req, { results: out.slice(0, 12).map((x) => x[1]), source: "SEC company_tickers_exchange.json" }, 200, 3600);
}

async function company(req, t) {
  t = (t || "").trim().toUpperCase();
  const hit = (await tickers()).find((x) => x.ticker === t);
  if (!hit) return json(req, { error: `${t} is not in SEC's list of US-listed companies` }, 404);
  const cik = String(hit.cik).padStart(10, "0");
  const [sub, facts] = await Promise.all([
    getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, 3600),
    getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 3600).catch((e) => ({ error: String(e.message || e) })),
  ]);
  const cutoff = new Date(Date.now() - (YEARS * 365 + 120) * 864e5).toISOString().slice(0, 10);
  const keep = {};
  const ug = (facts.facts && facts.facts["us-gaap"]) || {};
  for (const tag of Object.keys(ug)) {
    const u = ug[tag] && ug[tag].units; if (!u) continue;
    for (const unit of Object.keys(u)) {
      const rows = u[unit].filter((r) => r.end >= cutoff && FORMS.has(r.form))
        .map((r) => ({ s: r.start, e: r.end, v: r.val, f: r.form, d: r.filed, a: r.accn }));
      if (rows.length) (keep[tag] = keep[tag] || {})[unit] = rows;
    }
  }
  const dei = {};
  for (const tag of DEI) { const u = facts.facts && facts.facts.dei && facts.facts.dei[tag] && facts.facts.dei[tag].units;
    if (u) dei[tag] = Object.values(u)[0].filter((r) => r.end >= cutoff).map((r) => ({ e: r.end, v: r.val, d: r.filed })); }
  const rf = sub.filings && sub.filings.recent ? sub.filings.recent : {};
  const filings = [];
  for (let i = 0; i < (rf.form || []).length && filings.length < 60; i++) {
    const fm = rf.form[i];
    if (!["10-K", "10-Q", "10-K/A", "10-Q/A", "8-K", "20-F", "40-F", "6-K"].includes(fm)) continue;
    if (fm === "8-K" && !String(rf.items[i] || "").includes("2.02")) continue;   // 8-K only for earnings releases (Item 2.02)
    filings.push({ form: fm, filed: rf.filingDate[i], period: rf.reportDate[i], accn: rf.accessionNumber[i], items: rf.items[i] || "",
      url: `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${rf.accessionNumber[i].replace(/-/g, "")}/${rf.primaryDocument[i]}` });
  }
  const hasIfrs = !!(facts.facts && facts.facts["ifrs-full"]);
  return json(req, {
    ticker: t, cik, name: sub.name || hit.name, exchange: hit.exchange, sic: sub.sic, sicDescription: sub.sicDescription,
    fiscalYearEnd: sub.fiscalYearEnd, stateOfIncorporation: sub.stateOfIncorporation, category: sub.category,
    tickers: sub.tickers, exchanges: sub.exchanges, filings, facts: keep, dei, ifrs: hasIfrs,
    facts_error: facts.error || null, fetched_at: new Date().toISOString(),
    source: { submissions: `https://data.sec.gov/submissions/CIK${cik}.json`, facts: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json` },
  }, 200, 3600);
}

async function getText(url, ttl) {
  const r = await fetch(url, { headers: { "User-Agent": CONTACT, "Accept-Encoding": "gzip, deflate" }, cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } } });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.text();
}
async function hitFor(t) {
  t = (t || "").trim().toUpperCase();
  return (await tickers()).find((x) => x.ticker === t) || null;
}
async function filings8k(req, t) {
  const hit = await hitFor(t);
  if (!hit) return json(req, { error: `${t} is not in SEC's list of US-listed companies` }, 404);
  const cik = String(hit.cik).padStart(10, "0");
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, 60);
  const rf = sub.filings && sub.filings.recent ? sub.filings.recent : {}, out = [];
  for (let i = 0; i < (rf.form || []).length && out.length < 12; i++) {
    if (rf.form[i] !== "8-K" || !String(rf.items[i] || "").includes("2.02")) continue;
    out.push({ filed: rf.filingDate[i], accepted: (rf.acceptanceDateTime || [])[i] || null, period: rf.reportDate[i], accn: rf.accessionNumber[i], items: rf.items[i] || "",
      url: `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${rf.accessionNumber[i].replace(/-/g, "")}/${rf.primaryDocument[i]}` });
  }
  return json(req, { ticker: hit.ticker, name: sub.name || hit.name, exchange: hit.exchange, cik, fiscalYearEnd: sub.fiscalYearEnd, releases: out,
    source: `https://data.sec.gov/submissions/CIK${cik}.json`, fetched_at: new Date().toISOString() }, 200, 60);
}
async function exhibit(req, t, acc) {
  const hit = await hitFor(t);
  if (!hit) return json(req, { error: `${t} is not in SEC's list of US-listed companies` }, 404);
  if (!/^\d{10}-\d{2}-\d{6}$/.test(acc || "")) return json(req, { error: "bad accession number" }, 400);
  const base = `https://www.sec.gov/Archives/edgar/data/${hit.cik}/${acc.replace(/-/g, "")}/`;
  const idx = await getJSON(base + "index.json", 86400);
  const names = ((idx.directory && idx.directory.item) || []).map((i) => i.name).filter((n) => /\.html?$/i.test(n));
  let pick = names.find((n) => /ex-?99[._-]?0?1|ex991|exhibit991|ex99/i.test(n));
  if (!pick) {   /* not named ex99 (e.g. NVIDIA's q3fy27pr.htm): the document the filing index types EX-99.1 */
    const ih = await getText(base + acc + "-index.htm", 86400), hit2 = {};
    for (const r of ih.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const m = r.match(/href="[^"]*\/([^"\/]+\.html?)"/i), ty = r.match(/<td[^>]*>\s*(EX-99(?:\.\d+)?)\s*<\/td>/i);
      if (m && ty && !hit2[ty[1].toUpperCase()]) hit2[ty[1].toUpperCase()] = m[1];
    }
    pick = hit2["EX-99.1"] || Object.keys(hit2).sort().map((k) => hit2[k])[0];
  }
  if (!pick) return json(req, { error: "no exhibit 99.1 in this filing", files: names.slice(0, 20) }, 404);
  let html = await getText(base + pick, 86400);
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<img[^>]*>/gi, "").slice(0, 900000);
  return json(req, { ticker: hit.ticker, accn: acc, url: base + pick, html, fetched_at: new Date().toISOString() }, 200, 86400);
}

async function prices(req, t, rng) {
  t = (t || "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
  rng = ["1y", "2y", "5y", "10y", "max"].includes(rng) ? rng : "1y";
  const one = async (sym) => {
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${rng}&interval=1d`, 900);
    const r = j.chart && j.chart.result && j.chart.result[0]; if (!r) return null;
    const c = r.indicators.quote[0].close;
    return { symbol: sym, tz: r.meta.exchangeTimezoneName, ts: r.timestamp.map((x, i) => [new Date(x * 1000).toISOString().slice(0, 10), c[i]]).filter((x) => x[1] != null) };
  };
  const [a, b] = await Promise.all([one(t.replace(".", "-")).catch(() => null), one("^GSPC").catch(() => null)]);
  return json(req, { ticker: a, spx: b, range: rng, provider: "Yahoo Finance daily closes (delayed)", fetched_at: new Date().toISOString() }, 200, 900);
}

/* CME Daily Bulletin — only the three grain sections, never an open proxy. k = current (final, prior session) | preliminary_voi */
const CME_SEC = { "03": "Section03_Agricultural_Futures.pdf", "56": "Section56_Corn_Oat_RoughRice_Options.pdf", "57": "Section57_Soybean_Soymeal_Soyoil_SoybeanCrush_wheat_Options.pdf" };
async function cmeBulletin(req, s, k) {
  const f = CME_SEC[s]; const kind = k === "preliminary_voi" ? "preliminary_voi" : "current";
  if (!f) return json(req, { error: "unknown section" }, 400);
  const r = await fetch("https://www.cmegroup.com/daily_bulletin/" + kind + "/" + f, { headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/pdf,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.cmegroup.com/market-data/daily-bulletin.html" },
    cf: { cacheTtl: 900, cacheEverything: true } });
  if (!r.ok) return json(req, { error: "cme " + r.status }, 502);
  const h = new Headers(cors(req)); h.set("Content-Type", "application/pdf"); h.set("Cache-Control", "public, max-age=900");
  const lm = r.headers.get("Last-Modified"); if (lm) h.set("X-CME-Last-Modified", lm);
  return new Response(r.body, { status: 200, headers: h });
}

/* /street?t= — analyst estimates and ownership for one company (owner, Nov 17 2026), on demand only: Yahoo Finance
   quoteSummary (earningsTrend: consensus EPS and revenue avg/low/high and analyst counts for the current and next quarter
   and years; earningsHistory: estimate vs actual EPS for the last four quarters; majorHoldersBreakdown: insider / institution
   percentages; institutionOwnership: largest 13F holders). Yahoo needs a session cookie and a crumb, kept per isolate. */
const BUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let YC = null;
async function ycrumb(force) {
  if (YC && !force && Date.now() - YC.at < 3600e3) return YC;
  let ck = "";
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    const r = await fetch(u, { headers: { "User-Agent": BUA }, redirect: "manual" });
    const sc = r.headers.get("set-cookie") || ""; const m = sc.match(/(A3=[^;]+)/) || sc.match(/(A1=[^;]+)/);
    if (m) { ck = m[1]; break; }
  }
  const c = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": BUA, "Cookie": ck } });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.length > 40 || /</.test(crumb)) throw new Error("estimates source unavailable (crumb HTTP " + c.status + ")");
  YC = { ck, crumb, at: Date.now() }; return YC;
}
async function street(req, t) {
  t = (t || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").replace(".", "-");
  if (!t) return json(req, { error: "ticker required" }, 400);
  const mods = "earningsTrend,earningsHistory,majorHoldersBreakdown,institutionOwnership,earnings,defaultKeyStatistics";
  let j = null, st = 0;
  for (let i = 0; i < 2; i++) {
    const y = await ycrumb(i > 0);
    const r = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=${mods}&crumb=${encodeURIComponent(y.crumb)}`,
      { headers: { "User-Agent": BUA, "Cookie": y.ck, "Accept": "application/json" }, cf: { cacheTtl: 1800, cacheEverything: true, cacheTtlByStatus: { "200-299": 1800, "400-599": 0 } } });
    st = r.status; if (r.ok) { j = await r.json(); break; }
  }
  const R = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!R) return json(req, { error: "no estimates or ownership for " + t + " (HTTP " + st + ")" }, 404, 300);
  const v = (x) => (x && typeof x === "object" && "raw" in x ? x.raw : x == null || typeof x === "object" ? null : x);
  const trend = ((R.earningsTrend || {}).trend || []).map((p) => ({ period: p.period, end: p.endDate || null, growth: v(p.growth),
    eps: p.earningsEstimate && { avg: v(p.earningsEstimate.avg), low: v(p.earningsEstimate.low), high: v(p.earningsEstimate.high), n: v(p.earningsEstimate.numberOfAnalysts), year_ago: v(p.earningsEstimate.yearAgoEps), growth: v(p.earningsEstimate.growth) },
    rev: p.revenueEstimate && { avg: v(p.revenueEstimate.avg), low: v(p.revenueEstimate.low), high: v(p.revenueEstimate.high), n: v(p.revenueEstimate.numberOfAnalysts), year_ago: v(p.revenueEstimate.yearAgoRevenue), growth: v(p.revenueEstimate.growth) },
    rev30: p.epsRevisions && { up30: v(p.epsRevisions.upLast30days), down30: v(p.epsRevisions.downLast30days) },
    trend_eps: p.epsTrend && { now: v(p.epsTrend.current), d7: v(p.epsTrend["7daysAgo"]), d30: v(p.epsTrend["30daysAgo"]), d60: v(p.epsTrend["60daysAgo"]), d90: v(p.epsTrend["90daysAgo"]) } }));
  const hist = ((R.earningsHistory || {}).history || []).map((h) => ({ q: v(h.quarter) ? new Date(v(h.quarter) * 1000).toISOString().slice(0, 10) : null, period: h.period, actual: v(h.epsActual), est: v(h.epsEstimate), surprise_pct: v(h.surprisePercent) != null ? v(h.surprisePercent) * 100 : null }));
  const ec = (R.earnings || {}).earningsChart || {}, fc = (R.earnings || {}).financialsChart || {};
  const qeps = (ec.quarterly || []).map((x) => ({ q: x.date, actual: v(x.actual), est: v(x.estimate) }));
  const qfin = (fc.quarterly || []).map((x) => ({ q: x.date, rev: v(x.revenue), ni: v(x.earnings) }));
  const mh = R.majorHoldersBreakdown || {}, ks = R.defaultKeyStatistics || {};
  const own = { insiders_pct: v(mh.insidersPercentHeld) != null ? v(mh.insidersPercentHeld) * 100 : null, inst_pct: v(mh.institutionsPercentHeld) != null ? v(mh.institutionsPercentHeld) * 100 : null,
    inst_float_pct: v(mh.institutionsFloatPercentHeld) != null ? v(mh.institutionsFloatPercentHeld) * 100 : null, inst_count: v(mh.institutionsCount),
    shares_out: v(ks.sharesOutstanding), float: v(ks.floatShares), short_pct_float: v(ks.shortPercentOfFloat) != null ? v(ks.shortPercentOfFloat) * 100 : null, short_shares: v(ks.sharesShort),
    holders: ((R.institutionOwnership || {}).ownershipList || []).slice(0, 10).map((o) => ({ name: o.organization, pct: v(o.pctHeld) != null ? v(o.pctHeld) * 100 : null, shares: v(o.position), value: v(o.value), asof: v(o.reportDate) ? new Date(v(o.reportDate) * 1000).toISOString().slice(0, 10) : null, chg_pct: v(o.pctChange) != null ? v(o.pctChange) * 100 : null })) };
  return json(req, { ticker: t, trend, hist, qeps, qfin, next_q: ec.currentQuarterEstimateDate ? ec.currentQuarterEstimateDate + " " + (ec.currentQuarterEstimateYear || "") : null, own,
    provider: "Yahoo Finance analyst consensus and ownership (13F) data, delayed", fetched_at: new Date().toISOString() }, 200, 1800);
}

export default {
  async fetch(req, env) {
    if (env && env.SEC_CONTACT) CONTACT = "AGRITrade desk " + String(env.SEC_CONTACT).trim();
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    if (req.method !== "GET") return json(req, { error: "GET only" }, 405);
    try {
      if (u.pathname === "/health") return json(req, { ok: true, contact_set: CONTACT.includes("@") }, 200, 60);
      if (u.pathname === "/search") return await search(req, u.searchParams.get("q"));
      if (u.pathname === "/company") return await company(req, u.searchParams.get("t"));
      if (u.pathname === "/prices") return await prices(req, u.searchParams.get("t"), u.searchParams.get("r"));
      if (u.pathname === "/filings") return await filings8k(req, u.searchParams.get("t"));
      if (u.pathname === "/cme") return await cmeBulletin(req, u.searchParams.get("s"), u.searchParams.get("k"));
      if (u.pathname === "/street") return await street(req, u.searchParams.get("t"));
      if (u.pathname === "/exhibit") return await exhibit(req, u.searchParams.get("t"), u.searchParams.get("acc"));
      return json(req, { error: "unknown route", routes: ["/search?q=", "/company?t=", "/prices?t=&r=", "/health"] }, 404);
    } catch (e) {
      return json(req, { error: String(e && e.message || e) }, 502, 30);
    }
  },
};
