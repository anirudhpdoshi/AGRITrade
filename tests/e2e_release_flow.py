"""End-to-end checks: what happens on the desk when scheduled data is released.

Runs the real page (index.html + every *-ui.js) in headless Chromium against the repo's data.json, with the clock fixed
and network sources blocked, then drives each way a release can reach the desk and asserts what the user must see:
the Events row says it landed (time + lag + value) and says where to look, the right tab turns "NEW", the right card is
marked, the Milestones feed records it, and nothing on any tab shows NaN / undefined / null or throws.

Usage:  python tests/e2e_release_flow.py            (needs: pip install playwright && python -m playwright install chromium)
"""
import asyncio, datetime as dt, http.server, json, os, socketserver, sys, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8799
CLOCK = "2026-10-29T15:00:00+00:00"          # Thu 11:00 ET
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  ← " + str(detail)[:300]))


def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    global PORT
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Q)   # any free port
    PORT = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# a controlled release calendar for the test day (times in the calendar's own zone: America/Denver = ET − 2 h)
EVENTS = [
    {"date": "2026-10-29", "time": "6:30am", "ccy": "USD", "event": "Advance GDP q/q", "impact": "High", "fc": "3.2%", "prev": "1.5%"},
    {"date": "2026-10-29", "time": "6:30am", "ccy": "USD", "event": "Core PCE Price Index m/m", "impact": "High", "fc": "0.3%", "prev": "0.2%"},
    {"date": "2026-10-29", "time": "6:30am", "ccy": "USD", "event": "CPI m/m", "impact": "High", "fc": "0.3%", "prev": "0.4%"},
    {"date": "2026-10-29", "time": "8:00am", "ccy": "USD", "event": "Pending Home Sales m/m", "impact": "Medium", "fc": "1.0%", "prev": "0.2%"},
    {"date": "2026-10-29", "time": "12:00pm", "ccy": "USD", "event": "Federal Funds Rate", "impact": "High", "fc": "4.00%", "prev": "4.00%"},
]
SETUP = """(function(E){
  DATA.fx.events = E; DATA.fx.events_tz = null;
  var g = mfind('us_gdp'); g.seen_at = '2026-10-29T09:12:00-04:00'; g.period = "Q3 '26"; g.value = 2.9;
  var p = mfind('us_core_pce'); p.seen_at = '2026-10-29T08:41:00-04:00';
  var c = mfind('us_cpi'); c.seen_at = '2026-10-20T08:31:00-04:00';          /* CPI not out on the desk yet -> awaiting */
  DATA.meta.asof.options = '2026-10-29T08:49:00-04:00';
  renderAllFull(); EVENTS.render(); EVENTS.decorate(); return true; })"""


async def main():
    from playwright.async_api import async_playwright
    httpd = serve()
    data = open(os.path.join(ROOT, "data.json")).read()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for vw in (1440, 390):
            tag = "desktop" if vw > 900 else "mobile"
            ctx = await b.new_context(viewport={"width": vw, "height": 1000})
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.clock.install(time=dt.datetime.fromisoformat(CLOCK))
            await pg.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            await pg.route("**/data.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=data))
            await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
            await pg.wait_for_timeout(1200)
            await pg.evaluate("document.getElementById('gateOverlay').style.display='none';document.body.classList.remove('locked');window.DESK_LOCKED=false;window.dispatchEvent(new Event('desk:unlock'));0")
            await pg.wait_for_timeout(1500)
            await pg.evaluate("window.DESK_LOCKED=false;0")
            await pg.evaluate(SETUP + "(" + json.dumps(EVENTS) + ")")
            await pg.click("#tabbtn-events"); await pg.wait_for_timeout(400)
            if os.environ.get("SHOT"):
                await pg.screenshot(path=os.path.join(os.environ["SHOT"], f"e2e_events_{tag}.png"), full_page=False)
            rows = await pg.evaluate("[].map.call(document.querySelectorAll('#panel-events .evr'),r=>r.innerText.replace(/\\s+/g,' '))")
            gdp = next((r for r in rows if "Advance GDP" in r), "")
            check(f"[{tag}] landed release shows time, lag and value", "On the desk 9:12" in gdp and "+42 min" in gdp and "2.9" in gdp, gdp)
            check(f"[{tag}] landed release says where to look", "See it: USD/CAD · Macro" in gdp, gdp)
            cpi = next((r for r in rows if "CPI m/m" in r), "")
            check(f"[{tag}] released but not on the desk says 'awaiting desk'", "awaiting desk" in cpi, cpi)
            phs = next((r for r in rows if "Pending Home Sales" in r), "")
            check(f"[{tag}] untracked release is marked calendar-only", "calendar only" in phs, phs)
            fed = next((r for r in rows if "Federal Funds Rate" in r), "")
            check(f"[{tag}] upcoming release still counts down", ":" in fed and "On the desk" not in fed, fed)
            check(f"[{tag}] tab with a landed release is coloured NEW", await pg.evaluate("document.getElementById('tabbtn-fx').classList.contains('tab-today')"))
            check(f"[{tag}] tab title lists what landed", "GDP" in (await pg.evaluate("document.getElementById('tabbtn-fx').title")))
            check(f"[{tag}] options run marks the grain tabs NEW", await pg.evaluate("document.getElementById('tabbtn-corn').classList.contains('tab-today')"))
            # "See it" jumps to the exact card and marks it
            await pg.evaluate("[].filter.call(document.querySelectorAll('#panel-events .evgo.see'),b=>/Macro/.test(b.textContent))[0].click()")
            await pg.wait_for_timeout(700)
            check(f"[{tag}] 'See it' opens the USD/CAD tab", await pg.evaluate("document.getElementById('panel-fx').classList.contains('active')"))
            await pg.evaluate("document.getElementById('tabbtn-fx').click()"); await pg.wait_for_timeout(300)   # a redraw must keep the marks
            check(f"[{tag}] the released card carries a NEW-today ribbon (and keeps it after a redraw)", await pg.evaluate("!!document.querySelector('#panel-fx .upd-today[data-upd*=\"NEW today\"]')"))
            if os.environ.get("SHOT"):
                await pg.screenshot(path=os.path.join(os.environ["SHOT"], f"e2e_seeit_{tag}.png"), full_page=False)
            check(f"[{tag}] the jumped-to card is flashed", await pg.evaluate("!!document.querySelector('#panel-fx .flash-find')"))
            # a release arriving with the next data refresh reaches the Milestones feed
            await pg.evaluate("""(function(){ window.DESK_LOCKED=false; EVENTS._diff(); var c=mfind('us_cpi'); c.period="Sep '26"; c.value=3.9; c.seen_at='2026-10-29T10:59:00-04:00';
              DATA.meta.asof.options='2026-10-29T10:58:00-04:00'; DATA.grains.corn.near.rows[5][1]+=777; EVENTS._diff(); EVENTS.decorate(); return 1; })()""")
            feed = await pg.evaluate("EVENTS._feed().map(m=>m.h.replace(/<[^>]+>/g,'')).join(' || ')")
            check(f"[{tag}] new macro print is logged in the feed", "US CPI" in feed and "3.9" in feed, feed[:300])
            check(f"[{tag}] options refresh is logged in the feed", "Options open interest" in feed, feed[:300])
            # central-bank decision via the fast lane
            await pg.evaluate("""(function(){ window.DESK_LOCKED=false; DATA.policy_watch={log:[],fed:{bank:'fed',date:'2026-10-29',t_sched:'2026-10-29T14:00:00-04:00',status:'out',rate:4.0,lo:3.75,prev:4.0,fc:4.0,
              change_bp:0,decision:'HOLD',surprise_bp:0,tone:'NEUTRAL',score:0.5,parts:{decision:0,surprise:0,language:0.5},hawk:['inflation remains elevated'],dove:[],t_seen:'2026-10-29T18:00:27Z',lag_min:0.4}};
              EVENTS._diff(); return 1; })()""")
            feed = await pg.evaluate("EVENTS._feed().map(m=>m.h.replace(/<[^>]+>/g,'')).join(' || ')")
            check(f"[{tag}] central-bank decision is logged with its tone", "Federal Reserve: HOLD" in feed and "NEUTRAL" in feed, feed[:300])
            # option wall shift is tracked against the morning pull
            await pg.evaluate("var n=DATA.grains.corn.near, w=(n.wall_pull&&n.wall_pull.pw||n.put_wall)[0]; DATA.grains.corn.fan.intraday[0]=Math.min(w, n.put_wall[0], DATA.grains.corn.fan.intraday[0])-0.12; renderGrain('corn'); 0")   # below the morning wall, whatever today's data
            ws = await pg.evaluate("JSON.stringify(DATA.grains.corn.near.wall_shift)")
            check(f"[{tag}] put wall shift is detected when price breaks the old wall", ws and '"put"' in ws, ws)
            # every tab renders without broken values or script errors
            bad = {}
            for t in ("corn", "wheat", "soybeans", "fx", "world", "events", "intel", "policy"):
                if not await pg.query_selector(f"#tabbtn-{t}"):
                    continue
                await pg.evaluate(f"document.getElementById('tabbtn-{t}').click()")
                await pg.wait_for_timeout(250)
                txt = await pg.inner_text(f"#panel-{t}")
                hit = [w for w in ("NaN", "undefined", "[object Object]") if w in txt]
                if hit: bad[t] = hit
            check(f"[{tag}] no NaN / undefined on any tab", not bad, bad)
            check(f"[{tag}] no script errors", not errs, errs[:3])
            await ctx.close()
        await b.close()
    httpd.shutdown()
    n_ok = sum(1 for r in results if r[1])
    print(f"{n_ok}/{len(results)} passed")
    sys.exit(0 if n_ok == len(results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
