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
import json, os, subprocess, time
from datetime import datetime, timedelta

import requests

import us_earnings as UE
import pr_parse as PP

EW_BUDGET = int(os.environ.get("EW_BUDGET", "120"))
SEC_UA = {"User-Agent": "AGRITrade-desk/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)", "Accept-Encoding": "gzip, deflate"}
FAST_S, SLOW_S, FAST_FOR, WINDOW = 10, 30, timedelta(minutes=2), timedelta(minutes=90)


def slot(row, day, tor):
    h, m = (7, 0) if row.get("time") == "bmo" else (16, 0)
    return datetime(day.year, day.month, day.day, h, m, tzinfo=tor)


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
        self.rows = {r["symbol"]: r for r in (E.get("calendar") or {}).get("rows") or []
                     if r.get("date") == day.isoformat() and (r.get("top") or r.get("w"))}
        for s, r in self.rows.items():
            if r.get("epsActual") is not None or r.get("revenueActual") is not None:
                self.st["done"].setdefault(s, {"seen_at": r.get("seen_at") or now.isoformat(), "src": "calendar"})

    def pending(self, now):
        day = now.astimezone(self.tor).date()
        return {s: r for s, r in self.rows.items() if s not in self.st.get("done", {}) and slot(r, day, self.tor) <= now <= slot(r, day, self.tor) + WINDOW}

    def interval(self, now):
        """Seconds to the next poll, or None when no company is inside its window."""
        P = self.pending(now)
        if not P:
            return None
        day = now.astimezone(self.tor).date()
        return FAST_S if any(now - slot(r, day, self.tor) < FAST_FOR for r in P.values()) else SLOW_S

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
        e, v = UE.surprise(x.get("epsActual"), ee), UE.surprise(x.get("revenueActual"), re_)
        self.st["done"][s] = {"seen_at": now.isoformat(), "src": src}
        live[s] = {"symbol": s, "date": row.get("date"), "epsActual": x.get("epsActual"), "epsEstimated": ee,
                   "revenueActual": x.get("revenueActual"), "revenueEstimated": re_, "eps_surprise_pct": e, "rev_surprise_pct": v,
                   "seen_at": now.isoformat(), "top": row.get("top"), "w": row.get("w"), "src": src}
        imp = "Mixed" if e is None else "Bullish" if e >= 1 and (v is None or v >= 0) else "Bearish" if e <= -1 and (v is None or v <= 0) else "Mixed"
        alerts.append({"id": f"earn|{s}|{row.get('date')}", "kind": "news", "tag": "earn", "t": now.isoformat(), "mt": x.get("at") or now.isoformat(),
                       "head": f"BREAKING – {s} earnings: EPS {x.get('epsActual')}" + (f" vs est {ee}" if ee is not None else ""),
                       "trigger": f"EPS ${x.get('epsActual')}" + (f" vs est ${ee} ({e:+.1f}%)" if e is not None else "") +
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
        for s, row in P.items():
            try:
                f = self.st["filed"].get(s) or self.edgar(s, now)
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
                prs[s] = dict(vals, date=row.get("date"), acc=f["acc"], at=f.get("at"), url=f["url"], read_at=now.isoformat())
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


def pr_pass(w, now, store):
    """Press-release statement lines for every company reporting today (watched or not): once its earnings 8-K is on
    EDGAR, read exhibit 99.1 (unaudited condensed statements). EDGAR is free; each symbol is checked at most once a minute."""
    new = {}
    last = w.st.setdefault("pr_try", {})
    for s, r in w.rows.items():
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
                new[s] = dict(vals, date=r["date"], acc=f["acc"], at=f.get("at"), url=f["url"], exhibit=u, read_at=now.isoformat())
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
