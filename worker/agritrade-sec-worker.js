/* AGRITrade — SEC company-data Worker (Cloudflare Workers, free plan).

   Why it exists: the desk is a static GitHub Pages site. SEC EDGAR and Yahoo do not allow browser (CORS) requests, so
   live ticker search needs a tiny server in between. This Worker fetches on demand and STORES NOTHING: no database, no
   KV, no logs of what was searched. The only caching is Cloudflare's normal short-lived HTTP edge cache (ticker list
   24 h, company data 1 h, prices 15 min) so repeated clicks do not re-hit SEC.

   Routes (GET only, JSON):
     /search?q=adm            ticker / company-name search over SEC's list of US-listed companies (top 12)
     /company?t=ADM           SEC submissions (identity, SIC, fiscal year-end, filings) + XBRL facts trimmed to the
                              tags the desk uses, last ~5 years
     /prices?t=ADM            Yahoo daily closes, 1 year, for the ticker and the S&P 500 (price-reaction context)
     /health                  {ok:true}

   SEC fair-access policy: every request names a contact in the User-Agent, and SEC allows ≤10 requests/second; a
   lookup here makes at most 3. Only the desk's own origin may call it (ALLOWED_ORIGINS).

   Deploy: dash.cloudflare.com → Workers & Pages → Create → Create Worker → paste this file → Deploy. */

const CONTACT = "AGRITrade desk anirudh.p.doshi@gmail.com";
const ALLOWED_ORIGINS = ["https://anirudhpdoshi.github.io", "http://127.0.0.1", "http://localhost"];
const YEARS = 5;
const FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A", "10-KT", "10-QT"]);

/* XBRL tags the desk reads — keep in step with co-engine.js (a test checks every engine tag is listed here). */
const TAGS = [
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
  "CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfServices", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
  "GrossProfit", "OperatingExpenses", "SellingGeneralAndAdministrativeExpense", "ResearchAndDevelopmentExpense", "SellingAndMarketingExpense",
  "GeneralAndAdministrativeExpense", "CostsAndExpenses", "OperatingIncomeLoss", "RestructuringCharges",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeTaxExpenseBenefit", "NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss",
  "EarningsPerShareBasic", "EarningsPerShareDiluted", "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic",
  "DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation",
  "ShareBasedCompensation", "AllocatedShareBasedCompensationExpense",
  "InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestPaidNet", "InterestPaid",
  "NetCashProvidedByUsedInOperatingActivities", "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
  "PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsForRepurchaseOfCommonStock",
  "ProceedsFromIssuanceOfLongTermDebt", "RepaymentsOfLongTermDebt",
  "IncreaseDecreaseInAccountsReceivable", "IncreaseDecreaseInInventories", "IncreaseDecreaseInAccountsPayable",
  "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "ShortTermInvestments",
  "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  "AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "InventoryNet", "AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent",
  "AssetsCurrent", "LiabilitiesCurrent", "Assets", "Liabilities", "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "ShortTermBorrowings", "CommercialPaper", "DebtCurrent", "LongTermDebtCurrent", "LongTermDebtNoncurrent", "LongTermDebt",
  "OperatingLeaseLiability", "FinanceLeaseLiability", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsCurrent", "DebtLongtermAndShorttermCombinedAmount",
];
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
  const r = await fetch(url, { headers: { "User-Agent": CONTACT, "Accept": "application/json" }, cf: { cacheTtl: ttl, cacheEverything: true } });
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
  for (const tag of TAGS) {
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

async function prices(req, t) {
  t = (t || "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
  const one = async (sym) => {
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`, 900);
    const r = j.chart && j.chart.result && j.chart.result[0]; if (!r) return null;
    const c = r.indicators.quote[0].close;
    return { symbol: sym, tz: r.meta.exchangeTimezoneName, ts: r.timestamp.map((x, i) => [new Date(x * 1000).toISOString().slice(0, 10), c[i]]).filter((x) => x[1] != null) };
  };
  const [a, b] = await Promise.all([one(t.replace(".", "-")).catch(() => null), one("^GSPC").catch(() => null)]);
  return json(req, { ticker: a, spx: b, provider: "Yahoo Finance daily closes (delayed)", fetched_at: new Date().toISOString() }, 200, 900);
}

export default {
  async fetch(req) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    if (req.method !== "GET") return json(req, { error: "GET only" }, 405);
    try {
      if (u.pathname === "/health") return json(req, { ok: true, contact: CONTACT.split(" ").pop() }, 200, 60);
      if (u.pathname === "/search") return await search(req, u.searchParams.get("q"));
      if (u.pathname === "/company") return await company(req, u.searchParams.get("t"));
      if (u.pathname === "/prices") return await prices(req, u.searchParams.get("t"));
      return json(req, { error: "unknown route", routes: ["/search?q=", "/company?t=", "/prices?t=", "/health"] }, 404);
    } catch (e) {
      return json(req, { error: String(e && e.message || e) }, 502, 30);
    }
  },
};
