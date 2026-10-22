# Grain & USD/CAD Desk — live

Live page: https://anirudhpdoshi.github.io/usd-cad-desk-live/

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

## Turning on the true streaming tick

1. Get a free API key at https://finnhub.io.
2. In `index.html`, set `window.LIVE_CONFIG = { finnhubKey: "YOUR_KEY", ... }`.

The key is visible in the page source, so use a free-tier key only. Without a key, the page polls a keyless reference rate every ~30 s.

## Notes

- Yahoo continuous contracts (`ZC=F` etc.) follow the front month. Check them at each roll; for example, `ZS=F` moves from X26 to F27 in late October/November.
- GitHub Pages caches for about 10 minutes. `live.js` fetches `data.json?t=<now>` to bypass the cache.
- Scheduled Actions can run 5–15 minutes late. Actions → *Refresh desk data* → **Run workflow** forces a refresh.
