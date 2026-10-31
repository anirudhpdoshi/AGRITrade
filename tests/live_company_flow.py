"""Live end-to-end check of the US Earnings company workspace on the PUBLISHED site (run in GitHub Actions).
Opens the page, clears the desk gate in-page (test only — no passcode is entered), searches a ticker through the live
SEC Worker, locks it, opens each research card and saves screenshots + a log of errors and failed requests."""
import asyncio, os, sys, json
SITE = os.environ.get("SITE", "https://anirudhpdoshi.github.io/AGRITrade/?preview=earnings")
TICK = os.environ.get("TICK", "GOOGL").split(",")
CARDS = ["snap", "verdicts", "health", "revenue", "gross", "operating", "eps", "wc-ccc", "cfo", "fcf", "capex", "alloc", "debt", "maturity", "service", "returns", "warn"]
OUT = "shots"; os.makedirs(OUT, exist_ok=True)
from playwright.async_api import async_playwright
async def main():
    log = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for t in TICK:
          try:
            pg = await b.new_page(viewport={"width": 1500, "height": 1000})
            pg.on("pageerror", lambda e: log.append(f"[{t}] pageerror: {e}"))
            pg.on("requestfailed", lambda r: log.append(f"[{t}] request failed: {r.url[:120]} {r.failure}") if "workers.dev" in r.url else None)
            pg.on("response", lambda r: log.append(f"[{t}] {r.status} {r.url[:110]}") if "workers.dev" in r.url else None)
            await pg.goto(SITE, wait_until="networkidle")
            await pg.evaluate("window.DESK_LOCKED=false;document.body.classList.remove('locked');var o=document.getElementById('gateOverlay');if(o)o.style.display='none';window.dispatchEvent(new Event('desk:unlock'))")
            await pg.wait_for_timeout(1500)
            await pg.click("#tabbtn-earnings"); await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f"{OUT}/{t}_0_market.png")
            await pg.fill("[data-utq]", t.lower()); await pg.wait_for_selector("[data-utpick]", timeout=20000)
            await pg.screenshot(path=f"{OUT}/{t}_1_search.png")
            await pg.keyboard.press("Enter"); await pg.wait_for_timeout(400)
            await pg.click("[data-utlock]")
            await pg.wait_for_selector(".cx-grid", timeout=45000); await pg.wait_for_timeout(1500)
            main = await pg.query_selector(".ut-main"); await main.screenshot(path=f"{OUT}/{t}_2_grid.png")
            for c in CARDS:
                await pg.click(f".ut-main [data-cocard='{c}']"); await pg.wait_for_timeout(700)
                txt = await pg.inner_text(".ut-main")
                bad = [w for w in ("NaN", "undefined", "Infinity") if w in txt]
                log.append(f"[{t}] card {c}: {'BAD ' + ','.join(bad) if bad else 'ok'} · {len(txt)} chars")
                await (await pg.query_selector(".ut-main")).screenshot(path=f"{OUT}/{t}_c_{c}.png")
                await pg.click(".ut-main [data-cocard='']"); await pg.wait_for_timeout(300)
            await pg.close()
          except Exception as e:
            log.append(f"[{t}] FAILED: {str(e)[:300]}")
            try: await pg.screenshot(path=f"{OUT}/{t}_ERROR.png", full_page=False); log.append(f"[{t}] search box / dropdown: " + str(await pg.evaluate("(()=>{var d=document.querySelector('.ut-dd');return d?d.innerText.slice(0,200):'no dropdown'})()")))
            except Exception: pass
        await b.close()
    open(f"{OUT}/log.txt", "w").write("\n".join(log) + "\n")
    print("\n".join(log))
asyncio.run(main())
