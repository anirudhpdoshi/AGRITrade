"""Shared plumbing for the desk data blocks: paths, time zone, run clock, HTTP get and the helpers more than one area uses.

Split out of update_data.py (Nov 2026). Functions were moved unchanged; update_data.py re-exports every name, so
`import update_data as U; U.<name>` keeps working. The run clock lives in ud_common.NOW (read here as UDC.NOW) so the
live loop can advance it for every module at once.
"""

import argparse, csv, io, json, os, re, statistics, sys, time, traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote_plus, urlparse
from zoneinfo import ZoneInfo

import requests


ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data.json"
TOR = ZoneInfo("America/Toronto")
UA = {"User-Agent": "agritrade-desk/1.0 (+https://github.com/anirudhpdoshi/AGRITrade)"}
NOW = datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(TOR).isoformat(timespec="seconds")


from desknet import redact, SECRET_ENV  # noqa: E402,F401  (shared: every job redacts the same secrets)


def get(url, headers=None, **kw):
    r = requests.get(url, headers={**UA, **(headers or {})}, timeout=25, **kw)
    r.raise_for_status()
    return r


def yf():
    import yfinance  # imported lazily so non-Yahoo blocks still run if it's missing
    return yfinance


def yahoo_last(symbol, interval="5m"):
    """(last price, bar time UTC, previous close) from Yahoo intraday bars."""
    t = yf().Ticker(symbol)
    h = t.history(period="2d", interval=interval)
    if h.empty:
        raise RuntimeError(f"no bars for {symbol}")
    last_ts = h.index[-1].to_pydatetime().astimezone(timezone.utc)
    d = t.history(period="7d", interval="1d")
    prev = None
    if len(d) >= 2:
        # previous session's close = the last daily bar dated before the latest bar's date
        days = [i for i in d.index if i.date() < h.index[-1].date()]
        prev = float(d.loc[days[-1], "Close"]) if days else float(d["Close"].iloc[-2])
    return float(h["Close"].iloc[-1]), last_ts, prev


def pctile(values, x):
    vals = [v for v in values if v is not None]
    return round(100.0 * sum(1 for v in vals if v <= x) / len(vals), 1) if vals else None


def valet(path):
    return get("https://www.bankofcanada.ca/valet/" + path).json()


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None  # BLS prints "-" for months it never published


def _fred(sid, start):
    if "/" in sid:   # calculated ratio of two FRED series on matching dates, in % (e.g. TOTALSL/PI)
        a, b = sid.split("/")
        a, k = (a.split(":") + ["1"])[:2]   # "TOTALSL:1000" = numerator is in millions, divide to match a billions denominator
        den = dict(_fred(b, start))
        return [(d, v / float(k) / den[d] * 100) for d, v in _fred(a, start) if den.get(d)]
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"
    rows = list(csv.reader(io.StringIO(get(url).text)))
    return [(r[0], float(r[1])) for r in rows[1:] if len(r) > 1 and _num(r[1]) is not None]


def _valet_series(sid, n, start=None):
    j = valet(f"observations/{sid}/json?" + (f"start_date={start}" if start else f"recent={n}"))
    return sorted((o["d"], _num(o.get(sid, {}).get("v"))) for o in j["observations"] if _num(o.get(sid, {}).get("v")) is not None)


def _release_times(D, kind):
    """Scheduled release instants (aware datetimes) in the last 8 days for a block."""
    today = NOW.astimezone(TOR).date()
    days = [today - timedelta(days=i) for i in range(8)]
    at = lambda d, h, m: datetime(d.year, d.month, d.day, h, m, tzinfo=TOR)
    if kind == "macro":
        out = []
        for v in (D.get("release_cal") or {}).values():
            for s_ in v.get("dates", []):
                try:
                    out.append(datetime.fromisoformat(s_).replace(tzinfo=TOR))
                except ValueError:
                    pass
            if v.get("rule") == "thu0830":
                out += [at(d, 8, 30) for d in days if d.weekday() == 3]
        return out
    if kind == "exports":
        return [at(d, 8, 30) for d in days if d.weekday() == 3]
    if kind == "cftc":
        return [at(d, 15, 30) for d in days if d.weekday() == 4]
    if kind == "wasde":
        return [at(datetime.fromisoformat(d).date(), 12, 0) for d in WASDE_DATES]
    return []


def recent_release(D, kind, hours=3):
    """True while a scheduled release for this block happened within the last `hours` —
    the 2-6 h 'checked recently' throttles are lifted so new numbers land within minutes."""
    return any(NOW - timedelta(hours=hours) <= t <= NOW for t in _release_times(D, kind))
WASDE_DATES = ["2026-01-12", "2026-02-10", "2026-03-10", "2026-04-09", "2026-05-12", "2026-06-11", "2026-07-10",
               "2026-08-12", "2026-09-11", "2026-10-09", "2026-11-10", "2026-12-10"]
