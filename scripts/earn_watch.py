"""Earnings release watch (runs inside the fast lane, scripts/live_loop.py).

For every top-100 / watchlist company that reports today (from earnings.json, FMP calendar: BMO / AMC), the watch opens
at the company's release slot and polls
    every 10 s for the first 2 minutes, then every 30 s until its numbers are in (window closes 90 min after the slot).
Numbers come from SEC EDGAR (free): the moment the earnings 8-K (Item 2.02) is accepted, its press release (exhibit 99.1)
is read in the same poll. FMP supplies only what EDGAR has not: the schedule and the analyst estimates (already in
earnings.json), plus a fallback read every 2 min while no readable 8-K exists.
FMP calls are capped per day (EW_BUDGET, default 120, at most half per session (BMO / AMC); the 15-min earnings job keeps its own budget lower) and the key
never reaches a log line (us_earnings.fmp scrubs it). The slot is BMO -> 7:00 ET, AMC -> 4:00 pm ET, unknown -> 4:00 pm:
the free calendar gives the session, not the minute.
"""
import json, os, re, subprocess, time
from datetime import datetime, timedelta

import requests

import us_earnings as UE
import pr_parse as PP

EW_BUDGET = int(os.environ.get("EW_BUDGET", "120"))
# SEC fair-access rule: automated requests must name a contact email. It comes from the SEC_CONTACT secret (never in the repo).
SEC_UA = {"User-Agent": ("AGRITrade desk " + os.environ.get("SEC_CONTACT", "").strip()).strip(), "Accept-Encoding": "gzip, deflate"}
FAST_S, SLOW_S, FAST_FOR, WINDOW = 10, 30, timedelta(minutes=2), timedelta(minutes=90)


def slot(row, day, tor):
    """Release slot (America/New_York == Toronto time): before the open 6:00, after the close 16:00, unknown 6:00."""
    h, m = (16, 0) if row.get("time") == "amc" else (6, 0)
    return datetime(day.year, day.month, day.day, h, m, tzinfo=tor)


def slot_end(row, day, tor):
    """Watching stops here for the day (a release can come late; the 15-min earnings job keeps looking after)."""
    return datetime(day.year, day.month, day.day, 23, 0, tzinfo=tor) if row.get("time") == "amc" else datetime(day.year, day.month, day.day, 20, 0, tzinfo=tor)


class Watch:
    def __init__(self, tor, state=None):
        self.tor, self.key = tor, os.environ.get("FMP", "").strip()
        self.st = state if state is not None else {}
        self.rows, self.cik, self.loaded = {}, {}, None

    # ------------------------------------------------------------------ setup
    def load(self, now, root):
        """Today's pending reporters from earnings.json (earnings branch); refreshed every 30 min."""
        if self.loaded and now - self.loaded < timedelta(minutes=30):
            return
        self.loaded = now
        try:
            subprocess.run(["git", "fetch", "-q", "--depth", "1", "origin", "earnings"], cwd=root, check=True, capture_output=True)
            E = json.loads(subprocess.run(["git", "show", "FETCH_HEAD:earnings.json"], cwd=root, check=True, capture_output=True, text=True).stdout)
        except Exception as e:
            print("[earn watch] earnings.json unavailable:", type(e).__name__)
            return
        day = now.astimezone(self.tor).date()
        if self.st.get("day") != day.isoformat():
            self.st.clear()
            self.st.update({"day": day.isoformat(), "calls": 0, "done": {}, "filed": {}})
        # universe: every S&P 500 company the Nasdaq schedule has for today, plus watchlist / top-100 names from the FMP calendar;
        # FMP fields (estimates, actuals) are merged where FMP covers the company
        fmp = {r["symbol"]: r for r in (E.get("calendar") or {}).get("rows") or [] if r.get("date") == day.isoformat()}
        rows = {}
        for x in ((E.get("sp_schedule") or {}).get("days") or {}).get(day.isoformat(), []):
            rows[x["s"]] = {"symbol": x["s"], "date": day.isoformat(), "time": x.get("time"), "name": x.get("n"), "fq": x.get("fq"),
                            "eps_f": x.get("eps_f"), "ests": x.get("ests"), "mcap": x.get("mcap"), "sp": True}
        for sym, r in fmp.items():
            if sym in rows or r.get("top") or r.get("w"):
                rows[sym] = dict(rows.get(sym, {"symbol": sym, "date": day.isoformat()}), **{k: v for k, v in r.items() if v is not None})
        self.rows = rows
        for s, r in self.rows.items():
            if r.get("epsActual") is not None or r.get("revenueActual") is not None:
                self.st["done"].setdefault(s, {"seen_at": r.get("seen_at") or now.isoformat(), "src": "calendar"})

    def pending(self, now):
        day = now.astimezone(self.tor).date()
        return {s: r for s, r in self.rows.items() if s not in self.st.get("done", {}) and slot(r, day, self.tor) <= now <= slot_end(r, day, self.tor)}

    def interval(self, now):
        """Seconds to the next poll, or None when no company is inside its window."""
        P = self.pending(now)
        if not P:
            return None
        day = now.astimezone(self.tor).date()
        return FAST_S if any(now - slot(r, day, self.tor) < FAST_FOR for r in P.values()) else SLOW_S

    def current_8k(self, now):
        """One request for the whole market: EDGAR's latest 8-K filings (Atom). {cik: filing} for today's Item 2.02 filings."""
        if len(SEC_UA["User-Agent"]) <= len("AGRITrade desk"):
            return {}
        t = requests.get("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&start=0&count=100&output=atom",
                         headers=dict(SEC_UA, Accept="application/atom+xml"), timeout=15).text
        out, today = {}, now.astimezone(self.tor).date().isoformat()
        for blk in re.findall(r"<entry>.*?</entry>", t, re.S):
            m = re.search(r'href="(https://www\.sec\.gov/Archives/edgar/data/(\d+)/(\d+)/([\d-]+)-index\.htm)"', blk)
            if not m or "2.02" not in blk or today not in blk:
                continue
            up = re.search(r"<updated>([^<]+)</updated>", blk)
            out[int(m.group(2))] = {"acc": m.group(4), "at": up.group(1) if up else "", "url": m.group(1)}
        return out

    # ------------------------------------------------------------------ sources
    def _cik(self, sym):
        if not self.cik:
            try:
                j = requests.get("https://www.sec.gov/files/company_tickers.json", headers=SEC_UA, timeout=20).json()
                self.cik = {v["ticker"].upper(): int(v["cik_str"]) for v in j.values()}
            except Exception as e:
                print("[earn watch] SEC ticker map unavailable:", type(e).__name__)
        return self.cik.get(sym.replace(".", "-")) or self.cik.get(sym)

    def edgar(self, sym, now):
        """Today's earnings 8-K (Item 2.02) for one company, or None."""
        cik = self._cik(sym)
        if not cik:
            return None
        j = requests.get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", headers=SEC_UA, timeout=15).json()
        R = j.get("filings", {}).get("recent", {})
        today = now.astimezone(self.tor).date().isoformat()
        for i, form in enumerate(R.get("form", [])[:40]):
            if form == "8-K" and "2.02" in (R["items"][i] or "") and R["filingDate"][i] == today:
                acc = R["accessionNumber"][i]
                return {"acc": acc, "at": R.get("acceptanceDateTime", [""] * 40)[i],
                        "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{acc}-index.htm"}
        return None

    def fmp_today(self, now, sess="amc"):
        """Half the day's budget per session, so a slow morning reporter can never starve the after-close window."""
        bys = self.st.setdefault("by_sess", {})
        if not self.key or self.st.get("calls", 0) >= EW_BUDGET or bys.get(sess, 0) >= EW_BUDGET // 2:
            return []
        d = now.astimezone(self.tor).date().isoformat()
        self.st["calls"] = self.st.get("calls", 0) + 1
        bys[sess] = bys.get(sess, 0) + 1
        res = UE.fmp("earnings-calendar", {"from": d, "to": d}, self.key)
        return res if isinstance(res, list) else []

    # ------------------------------------------------------------------ one poll
    def read_pr(self, s, f):
        """Statement lines from the 8-K's exhibit 99.1, or {}."""
        u = PP.exhibit_url(lambda x: requests.get(x, headers=SEC_UA, timeout=20), self._cik(s), f["acc"])
        return (dict(PP.parse(requests.get(u, headers=SEC_UA, timeout=20).text), exhibit=u) if u else {})

    def _numbers(self, s, row, x, now, src, alerts, live):
        """Record one company's numbers (x: epsActual / revenueActual) against the calendar estimates in row."""
        ee, re_ = row.get("epsEstimated"), row.get("revenueEstimated")
        if ee is None and row.get("eps_f") is not None:
            ee = row["eps_f"]
        # consensus EPS is on the adjusted basis; a GAAP figure from the press release is not comparable -> no EPS surprise
        e = None if src.startswith("SEC") else UE.surprise(x.get("epsActual"), ee)
        v = UE.surprise(x.get("revenueActual"), re_)
        self.st["done"][s] = {"seen_at": now.isoformat(), "src": src}
        live[s] = {"symbol": s, "date": row.get("date"), "epsActual": x.get("epsActual"), "epsEstimated": ee,
                   "revenueActual": x.get("revenueActual"), "revenueEstimated": re_, "eps_surprise_pct": e, "rev_surprise_pct": v,
                   "seen_at": now.isoformat(), "top": row.get("top"), "w": row.get("w"), "src": src}
        if e is not None:
            imp = "Bullish" if e >= 1 and (v is None or v >= 0) else "Bearish" if e <= -1 and (v is None or v <= 0) else "Mixed"
        else:
            imp = "Bullish" if v is not None and v >= 1 else "Bearish" if v is not None and v <= -1 else "Mixed"
        alerts.append({"id": f"earn|{s}|{row.get('date')}", "kind": "news", "tag": "earn", "t": now.isoformat(), "mt": x.get("at") or now.isoformat(),
                       "head": f"BREAKING – {s} earnings: " + (f"EPS {x.get('epsActual')} vs est {ee}" if e is not None else f"GAAP EPS {x.get('epsActual')}" if x.get("epsActual") is not None else "results out"),
                       "trigger": (f"EPS ${x.get('epsActual')} vs est ${ee} ({e:+.1f}%)" if e is not None else f"GAAP diluted EPS ${x.get('epsActual')} (consensus ${ee} is adjusted — not comparable)" if x.get("epsActual") is not None and ee is not None else f"GAAP diluted EPS ${x.get('epsActual')}" if x.get("epsActual") is not None else "") +
                                  (f" · revenue {money(x.get('revenueActual'))}" + (f" vs est {money(re_)}" if re_ is not None else "") if x.get("revenueActual") is not None else "") +
                                  (f" · 8-K accepted {fmt_t(x['at'], self.tor)}" if x.get("at") else ""),
                       "impact": f"{imp} {s}", "why": "", "src": src, "url": x.get("url", "")})

    def poll(self, now):
        """Returns (alerts, live rows, press-release rows). EDGAR is the source of the numbers: the moment the earnings 8-K
        is accepted, exhibit 99.1 is read in the same poll. FMP is only a fallback (every 2 min while no readable 8-K)."""
        P = self.pending(now)
        if not P:
            return [], {}, {}
        alerts, live, prs = [], {}, {}
        need_fmp = []
        try:
            cur = self.current_8k(now)
        except Exception as e:
            print("[earn watch] EDGAR current filings:", type(e).__name__)
            cur = {}
        chk = self.st.setdefault("sub_at", {})
        for s, row in P.items():
            try:
                f = self.st["filed"].get(s) or cur.get(self._cik(s) or -1)
                if not f and (not chk.get(s) or (now - datetime.fromisoformat(chk[s])).total_seconds() >= 120):
                    chk[s] = now.isoformat()   # per-company filing index, at most every 2 min (the Atom list covers the rest)
                    f = self.edgar(s, now)
            except Exception as e:
                print(f"[earn watch] EDGAR {s}: {type(e).__name__}")
                need_fmp.append(s); continue
            if not f:
                need_fmp.append(s); continue
            self.st["filed"][s] = f
            try:
                vals = self.read_pr(s, f) if not f.get("pr_failed") else {}
            except Exception as e:
                print(f"[earn watch] press release {s}: {type(e).__name__}")
                vals = {}
            if vals.get("eps_d") is not None or vals.get("rev"):
                prs[s] = dict(vals, date=row.get("date"), acc=f["acc"], at=f.get("at"), url=f["url"], read_at=now.isoformat(), pv=PP.VERSION)
                self._numbers(s, row, {"epsActual": vals.get("eps_d"), "revenueActual": vals.get("rev"), "at": f.get("at"), "url": f["url"]},
                              now, "SEC EDGAR 8-K press release (GAAP, unaudited)", alerts, live)
            else:
                f["pr_failed"] = True
                need_fmp.append(s)
                if not any(a["id"].startswith(f"earn8k|{s}|") for a in alerts):
                    t = f.get("at") or now.isoformat()
                    alerts.append({"id": f"earn8k|{s}|{f['acc']}", "kind": "news", "tag": "earn", "t": now.isoformat(), "mt": t,
                                   "head": f"BREAKING – {s} files its earnings release with the SEC",
                                   "trigger": f"8-K Item 2.02 accepted by EDGAR {fmt_t(t, self.tor)}; its tables could not be read, numbers follow from the calendar feed.",
                                   "impact": "Mixed", "why": "", "src": "SEC EDGAR", "url": f["url"]})
        last = self.st.get("fmp_at")
        if need_fmp and (not last or (now - datetime.fromisoformat(last)).total_seconds() >= 120):
            self.st["fmp_at"] = now.isoformat()
            try:
                rows = self.fmp_today(now, "bmo" if all(P[s].get("time") == "bmo" for s in need_fmp) else "amc")
            except Exception as e:   # Fatal / network: message already scrubbed of the key
                print("[earn watch] FMP:", str(e)[:120])
                rows = []
            for x in rows:
                s = x.get("symbol")
                if s in need_fmp and (x.get("epsActual") is not None or x.get("revenueActual") is not None):
                    self._numbers(s, dict(P[s], epsEstimated=x.get("epsEstimated", P[s].get("epsEstimated")), revenueEstimated=x.get("revenueEstimated", P[s].get("revenueEstimated"))),
                                  {"epsActual": x.get("epsActual"), "revenueActual": x.get("revenueActual")}, now, "FMP earnings calendar", alerts, live)
        return alerts, live, prs


def board(w, now, prs, live):
    """Today's S&P 500 reporting board: UPCOMING -> REFRESHING -> NEW (only on a read, official release)."""
    day = now.astimezone(w.tor).date()
    items = []
    for sym, r in w.rows.items():
        sl, en = slot(r, day, w.tor), slot_end(r, day, w.tor)
        f, d, pr, lv = (w.st.get("filed") or {}).get(sym), (w.st.get("done") or {}).get(sym), prs.get(sym), live.get(sym) or {}
        fmp_act = r.get("epsActual") is not None or r.get("revenueActual") is not None
        st = "new" if (pr or d or fmp_act) else "refreshing" if now >= sl else "upcoming"
        if st == "refreshing" and now > en:
            st = "not_detected"
        ee = r.get("epsEstimated")
        it = {"s": sym, "n": r.get("name") or sym, "time": r.get("time"), "slot": sl.isoformat(), "status": st, "fq": r.get("fq"),
              "mcap": r.get("mcap"), "sp": bool(r.get("sp")), "top": bool(r.get("top")), "w": bool(r.get("w")),
              "est": {"eps": ee if ee is not None else r.get("eps_f"), "eps_src": "FMP consensus" if ee is not None else "Nasdaq consensus" if r.get("eps_f") is not None else None,
                      "ests": r.get("ests"), "rev": r.get("revenueEstimated")}}
        if f:
            it["filing"] = {"at": f.get("at"), "url": f.get("url"), "acc": f.get("acc")}
        if pr:
            it["pr"] = {k: pr.get(k) for k in ("rev", "eps_d", "eps_adj", "ni", "opinc", "gp", "gm", "opm", "nm", "rev_yoy", "ni_yoy", "eps_d_yoy", "eps_adj_yoy", "opinc_yoy", "py", "quotes", "exhibit", "read_at")}
            ea, ce = pr.get("eps_adj"), it["est"]["eps"]
            if ea is not None and ce not in (None, 0) and (ea / ce > 3 or ea / ce < 1 / 3 or ea * ce < 0):
                it["pr"]["eps_adj"] = None   # far from consensus: almost certainly a misread line (full-year figure, per-ADS, …)
                it["pr"]["eps_adj_note"] = "adjusted EPS line not reliably read"
            elif ea is not None and ce not in (None, 0):
                it["eps_pct"] = UE.surprise(ea, ce)   # company-reported adjusted EPS vs consensus: same basis
        if fmp_act or lv.get("src", "").startswith("FMP"):
            a = lv if lv.get("src", "").startswith("FMP") else r
            it["adj"] = {"eps": a.get("epsActual"), "eps_est": a.get("epsEstimated"), "rev": a.get("revenueActual"), "rev_est": a.get("revenueEstimated"),
                         "eps_pct": a.get("eps_surprise_pct"), "rev_pct": a.get("rev_surprise_pct"), "src": "FMP earnings calendar"}
        avd = ((w.st.get("av") or {}).get("got") or {}).get(sym) or {}
        if avd.get("eps") is not None:
            it["av"] = avd
            if it.get("eps_pct") is None and (it.get("adj") or {}).get("eps_pct") is None:
                it["eps_pct"] = avd["pct"] if avd.get("pct") is not None else UE.surprise(avd["eps"], avd.get("est"))
        rv = (it.get("pr") or {}).get("rev") or (it.get("adj") or {}).get("rev")
        if rv is not None and r.get("revenueEstimated"):
            it["rev_pct"] = UE.surprise(rv, r["revenueEstimated"])
        it["detected_at"] = (d or {}).get("seen_at") or (pr or {}).get("read_at") or r.get("seen_at")
        items.append(it)
    order = {"new": 0, "refreshing": 1, "upcoming": 2, "not_detected": 3}
    items.sort(key=lambda x: (order[x["status"]], -(x.get("mcap") or 0)))
    return {"day": day.isoformat(), "asof": now.isoformat(), "sec": len(SEC_UA["User-Agent"]) > len("AGRITrade desk"), "items": items}


AV_CAP, AV_EVERY = 12, timedelta(minutes=4)   # 12 of the free key's 25/day (USD/CAD backup keeps 12); one call per pass (≤ 5/min)


def av_pass(w, now, items):
    """Alpha Vantage EARNINGS for today's biggest released companies whose own release gave no usable adjusted EPS:
    reported (adjusted) EPS vs estimate from a second, independent source. Third-party data, labelled as such."""
    key = os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()
    av = w.st.setdefault("av", {})
    if not key or av.get("n", 0) >= AV_CAP or (av.get("at") and now - datetime.fromisoformat(av["at"]) < AV_EVERY):
        return None
    done = av.setdefault("got", {})
    todo = sorted([x for x in items if x["status"] == "new" and x["s"] not in done and (x.get("pr") or {}).get("eps_adj") is None
                   and (x.get("adj") or {}).get("eps") is None], key=lambda x: -(x.get("mcap") or 0))
    if not todo:
        return None
    sym = todo[0]["s"]
    av["at"], av["n"] = now.isoformat(), av.get("n", 0) + 1
    try:
        j = requests.get("https://www.alphavantage.co/query", params={"function": "EARNINGS", "symbol": sym, "apikey": key}, timeout=20).json()
    except Exception as e:
        print("[alpha vantage]", sym, type(e).__name__)   # never the URL: it carries the key
        return None
    q = (j.get("quarterlyEarnings") or [None])[0]
    if not q:
        print("[alpha vantage]", sym, "no data:", str(j.get("Note") or j.get("Information") or "")[:80].replace(key, "***"))
        done[sym] = {"none": True}
        return None
    if q.get("reportedDate") != now.astimezone(w.tor).date().isoformat():
        done[sym] = {"stale": q.get("reportedDate")}   # today's quarter not in yet at Alpha Vantage: not retried (budget)
        return None
    f = lambda v: None if v in (None, "", "None") else float(v)
    done[sym] = {"eps": f(q.get("reportedEPS")), "est": f(q.get("estimatedEPS")), "pct": f(q.get("surprisePercentage")),
                 "period": q.get("fiscalDateEnding"), "at": now.isoformat(), "src": "Alpha Vantage (third-party, adjusted basis)"}
    return sym


def pr_pass(w, now, store):
    """Press-release statement lines for every company reporting today (watched or not): once its earnings 8-K is on
    EDGAR, read exhibit 99.1 (unaudited condensed statements). EDGAR is free; each symbol is checked at most once a minute."""
    new = {}
    last = w.st.setdefault("pr_try", {})
    for s, r in w.rows.items():
        if s not in (w.st.get("done") or {}):
            continue   # undetected companies are handled by poll(); this pass only adds press-release lines to calendar-detected ones
        if s in store or (last.get(s) and (now - datetime.fromisoformat(last[s])).total_seconds() < 60):
            continue
        day = now.astimezone(w.tor).date()
        if now < slot(r, day, w.tor) - timedelta(hours=3 if r.get("time") == "bmo" else 6):
            continue
        last[s] = now.isoformat()
        try:
            f = (w.st.get("filed") or {}).get(s) or w.edgar(s, now)   # the 8-K alert itself stays with poll()
            if not f:
                continue
            cik = w._cik(s)
            u = PP.exhibit_url(lambda x: requests.get(x, headers=SEC_UA, timeout=20), cik, f["acc"])
            vals = PP.parse(requests.get(u, headers=SEC_UA, timeout=20).text) if u else {}
            if vals.get("rev"):
                new[s] = dict(vals, date=r["date"], acc=f["acc"], at=f.get("at"), url=f["url"], exhibit=u, read_at=now.isoformat(), pv=PP.VERSION)
                print(f"::notice title=press release::{s} " + " ".join(f"{k}={v:,.2f}" for k, v in vals.items()))
        except Exception as e:
            print(f"[earn watch] press release {s}: {type(e).__name__}")
    return new


def money(v):
    if v is None:
        return "n/a"
    return f"${v / 1e9:.2f}B" if abs(v) >= 1e9 else f"${v / 1e6:.0f}M"


def fmt_t(t, tor):
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(tor).strftime("%-I:%M:%S %p ET")
    except Exception:
        return t
