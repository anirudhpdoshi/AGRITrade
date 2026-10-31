# Grain & USD/CAD Desk — live

Live page: https://anirudhpdoshi.github.io/AGRITrade/

Four tabs (Corn ZCZ26, Wheat ZWZ26, Soybeans ZSX26, USD/CAD) rendered from one static `index.html`, with a live layer on top.

## How the data flows

```
GitHub Action (every 15 min, weekdays)          browser
  scripts/update_data.py ──► data.json ──Pages──► index.html renders baked snapshot
    BoC Valet, US Treasury, CFTC,                  live.js ─ re-polls data.json every 5 min, re-renders on change
    Yahoo (delayed), Google News RSS               live.js ─ USD/CAD ticks (Finnhub stream, or keyless ~30s reference poll)
```

- **`index.html`**: renderers plus an embedded copy of the data. That copy is the fallback if `data.json` can't load.
- **`data.json`**: `{DATA, NEWS}`. `DATA.meta.asof` holds the last observation time per source, and the freshness pills read it.
- **`live.js`**: status strip (ET clock, FX/CBOT sessions, countdown to the next high-impact event), freshness pills, the streaming spot rate with sparkline and level-cross toasts, and live forwards and level check.
- **`scripts/update_data.py`**: patches each source independently. A failed source keeps its old values and old as-of time, so its pill turns amber or red. `python scripts/update_data.py --only news,fx_spot --dry-run` is useful when debugging.

## What refreshes automatically vs what is still manual

| Auto (Action) | Manual drop-in (no free source / model output) |
|---|---|
| USD/CAD mid, BoC daily closes, 20/50D ranges, pivot | Grain settlements and σ-fan math, options chains, roll, spreads |
| US–Canada 2Y/5Y/10Y/30Y spreads, Treasury curve, BoC overnight | 1Y and 20Y spread rows (no matching Canada benchmark; marked "stored") |
| CFTC: CAD leveraged funds, grains managed money | Export sales, Fed odds, CORRA futures, retail sentiment, FX options |
| Grain delayed quotes (fan live anchor), WTI/Brent, DXY and crosses | Forecast, scenarios, bias, trade template, economic calendar |
| News rails (Google News RSS) | |

## Intel tab — Global Commodity Intelligence

`scripts/intel.py` (hourly on weekdays, `intel.yml`) → `intel.json` on the `intel` branch → `intel-ui.js`.

| Layer | Sources | Cadence |
|---|---|---|
| Official data (VERIFIED) | World Bank Pink Sheet monthly prices; IMF PCPS as backup + cross-check; FAO Food Price Index (cereals, veg oils) | monthly |
| Publications | World Bank Commodity Markets Outlook (Apr/Oct), OECD–FAO Outlook (Jul), FAO / IMF / Pink Sheet release calendar | on publication |
| Headlines (inference) | Google News RSS: World Bank, IMF, FAO, OECD–FAO, AMIS, export bans / weather, logistics, fertilizer, trade | hourly |

Each item carries category (agriculture · energy & fertilizer · macro & trade · supply disruption · long-term outlook), crops, region,
key change, per-crop read, confidence, evidence, and a "Why this matters to my market" panel that separates the verified fact from the
inference and lists what to confirm (curve, WASDE, export sales, basis) before it becomes a trade. Reads are rule-based and shown with
their evidence; nothing is a signal on its own.

Fallback ladder: GitHub API → raw mirror → last good copy in the browser → "can't be reached". On the server each source fails
independently and keeps its last good copy (flagged), and a World Bank series that fails is served from the IMF (labelled). Surprises are
z-scores against each series' own 24-month history; revisions only against a value stored on an earlier run. Local debug without
publishing: `INTEL_DRY=1 INTEL_OUT=/tmp/intel.json python scripts/intel.py`.

## US Earnings tab — prototype (locked)

`scripts/us_earnings.py` → `earnings.json` on the `earnings` branch → `earnings-ui.js`. Provider: Financial Modeling Prep
(`search-name`, `quote`, `profile`), key in the repository secret `FMP` — never in the page.

- **Locked:** the tab is hidden. Open the preview with `?preview=earnings` (remembered in that browser), close it with
  `?preview=off`. Go-live = set `EARNINGS_LIVE = true` in `earnings-ui.js`.
- **Manual only:** the *US earnings (prototype)* Action has no schedule and is not on the scheduler clock.
- **Call budget:** quotes only when a new price can exist (market open and ≥10 min since the last, or the stored quote
  predates the close), profiles cached 7 days, names searched once; 200/day and 40/run caps; stops at the first 401/403/429.
  The first run is ~20 calls for the 10-name watchlist; a weekend re-run is 0. Plan without calling:
  `EARN_NO_PREV=1 python scripts/us_earnings.py --dry-run`.
- **Plan coverage:** quote returns HTTP 402 on this key for the watchlist, so price/change/volume come from `profile`
  (one call per symbol, quote not retried for 30 days). The tab's *FMP plan coverage* table shows each endpoint as in plan /
  some symbols / not in plan with the fallback in use; tick *Check which FMP endpoints my plan allows* on a run (~4 calls)
  to probe search-name, quote (AAPL), earnings-calendar and earnings.
- **Terminal layout (phase 1, market side):** header strip (Dow, Nasdaq Composite, Russell 2000, VIX, ICE DXY as the
  disclosed stand-in for Bloomberg BBDXY) read from `world.json` — no new fetch; ticker search + lock (the lock never freezes
  market data or the feed, and a feed click never silently replaces a locked company); left section nav; right earnings feed
  (released · awaiting · today · tomorrow · this week · next week) from the one daily earnings-calendar call; seasonality
  heatmap from `scripts/us_market.py` (Yahoo month-end closes, price return, `market.json` on the `earnings` branch, no FMP).
  Phase 2: SEC EDGAR company workspaces for a pre-built universe, rule-based interpretation.
- Watchlist: `scripts/data/earnings_watchlist.json`.

## Turning on the true streaming tick

1. Get a free API key at https://finnhub.io.
2. In `index.html`, set `window.LIVE_CONFIG = { finnhubKey: "YOUR_KEY", ... }`.

The key is visible in the page source, so use a free-tier key only. Without a key, the page polls a keyless reference rate every ~30 s.

## Notes

- Yahoo continuous contracts (`ZC=F` etc.) follow the front month. Check them at each roll; for example, `ZS=F` moves from X26 to F27 in late October/November.
- GitHub Pages caches for about 10 minutes. `live.js` fetches `data.json?t=<now>` to bypass the cache.
- Scheduled Actions can run 5–15 minutes late. Actions → *Refresh desk data* → **Run workflow** forces a refresh.
