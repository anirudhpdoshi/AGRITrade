"""U.S. Treasury blocks: debt maturity wall and the debt dashboard (Fiscal Data).

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

import ud_common as UDC
from ud_common import ROOT, _fred, _num, get, iso, redact
from ud_fx import yields

# ------------------------------------------------------------------ US Treasury debt maturity wall (official, no key)
FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
UST_TYPES = [("Bills", "Treasury Bills"), ("Notes", "Treasury Notes"), ("Bonds", "Treasury Bonds"),
             ("Treasury Inflation-Protected Securities", "Treasury Inflation-Protected Securities (TIPS)"), ("Floating Rate Notes", "Floating Rate Notes (FRN)")]


def _fd(path, **params):
    q = "&".join(f"{k.replace('[', '%5B').replace(']', '%5D')}={v}" for k, v in params.items())
    return get(FISCAL + path + "?" + q).json().get("data") or []


def ust(D, N):
    """Debt to the Penny (daily) + Monthly Statement of the Public Debt (every marketable security with its maturity) +
    average interest rates. Everything on the tab is computed from these official figures; nothing is modelled."""
    meta = D["meta"]
    last = meta.get("ust_checked")
    if last and UDC.NOW - datetime.fromisoformat(last) < timedelta(hours=6):
        print("  checked <6h ago - skipping")
        return False
    pen = _fd("v2/accounting/od/debt_to_penny", sort="-record_date", **{"page[size]": 1})[0]
    t1 = _fd("v1/debt/mspd/mspd_table_1", sort="-record_date", **{"page[size]": 40})
    rd = t1[0]["record_date"]
    t1 = [r for r in t1 if r["record_date"] == rd]
    rates = [r for r in _fd("v2/accounting/od/avg_interest_rates", sort="-record_date", **{"page[size]": 40}) if r["security_type_desc"] == "Marketable"]
    rrd = rates[0]["record_date"] if rates else None
    rates = {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in rates if r["record_date"] == rrd}
    rows = _fd("v1/debt/mspd/mspd_table_3_market", filter=f"record_date:eq:{rd}", **{"page[size]": 10000})
    asof = datetime.fromisoformat(rd).date()
    sec = []
    for r in rows:
        amt, mat, cls = _num(r.get("outstanding_amt")), r.get("maturity_date"), r.get("security_class1_desc") or ""
        if amt is None or not mat or mat == "null" or not re.fullmatch(r"[0-9A-Z]{9}", r.get("security_class2_desc") or ""):
            continue   # subtotal / header lines
        cl = cls.lower()
        typ = "Treasury Inflation-Protected Securities" if "inflation" in cl else "Floating Rate Notes" if "floating" in cl else \
              next((k for k in ("Bills", "Notes", "Bonds") if cl.startswith(k.lower())), None)
        if not typ:
            continue
        sec.append((typ, datetime.fromisoformat(mat).date(), amt / 1000.0))   # $ millions -> $ billions
    if len(sec) < 200:
        raise RuntimeError(f"MSPD table 3 looks incomplete ({len(sec)} securities)")
    tot = lambda typ=None: sum(a for t, m, a in sec if (typ is None or t == typ) and m > asof)   # outstanding at the statement date
    marketable = tot()
    ref = asof   # windows run from the statement date: a consistent snapshot (bills maturing since were rolled into new bills not yet in MSPD)
    months = lambda d: (d.year - ref.year) * 12 + d.month - ref.month + (d.day - ref.day) / 30.4
    due = lambda n, typ=None: sum(a for t, m, a in sec if (typ is None or t == typ) and 0 < months(m) <= n)
    live = [(t, m, a) for t, m, a in sec if m > ref]
    wam = sum(a * months(m) for t, m, a in live) / sum(a for t, m, a in live)
    wall = {}
    for t, m, a in sec:
        if 0 < months(m) <= 24.99:
            k = m.strftime("%Y-%m")
            wall[k] = wall.get(k, 0) + a
    buckets = [("< 6M", 0, 6), ("6–12M", 6, 12), ("1–2Y", 12, 24), ("2–5Y", 24, 60), ("5–10Y", 60, 120), ("> 10Y", 120, 9999)]
    prof = [{"label": l, "bn": round(sum(a for t, m, a in sec if lo < months(m) <= hi), 1)} for l, lo, hi in buckets]
    d24 = due(24)
    rate_of = lambda k: next((v for d_, v in rates.items() if ("inflation" in d_.lower()) == ("Inflation" in k) and ("floating" in d_.lower()) == ("Floating" in k)
                              and (k.split()[0].lower() in d_.lower() or "Inflation" in k or "Floating" in k)), None)
    comp = [{"type": lab, "rate": rate_of(k), "due24": round(due(24, k), 1), "pct24": round(due(24, k) / d24 * 100, 1) if d24 else None,
             "out": round(tot(k), 1)} for k, lab in UST_TYPES]
    D["ust"] = {"asof": rd, "penny_date": pen["record_date"], "rates_date": rrd,
                "total_debt_t": round(float(pen["tot_pub_debt_out_amt"]) / 1e12, 3), "public_t": round(float(pen["debt_held_public_amt"]) / 1e12, 3),
                "intragov_t": round(float(pen["intragov_hold_amt"]) / 1e12, 3), "marketable_t": round(marketable / 1000, 3),
                "due12_t": round(due(12) / 1000, 3), "due24_t": round(d24 / 1000, 3), "wam_months": round(wam, 1),
                "wa_rate": rates.get("Total Marketable"), "wall": {k: round(v, 1) for k, v in sorted(wall.items())},
                "profile": prof, "composition": comp, "n_securities": len(sec),
                "src": {"penny": "Treasury Fiscal Data — Debt to the Penny", "mspd": "Monthly Statement of the Public Debt (MSPD), tables 1 and 3",
                        "rates": "Average Interest Rates on U.S. Treasury Securities"}}
    meta["ust_checked"] = iso(UDC.NOW)
    meta["asof"]["ust"] = iso(UDC.NOW)
    print(f"  ust: debt ${D['ust']['total_debt_t']}T, marketable ${D['ust']['marketable_t']}T, 24M ${D['ust']['due24_t']}T, WAM {wam:.1f} mo, {len(sec)} securities")
    return True


# ------------------------------------------------------------------ US Treasury debt dashboard (us-debt-dashboard.json)
# Official sources only (FiscalData, FRED via fredgraph.csv, CBO carried forward).
# Fast sections (Debt to the Penny, MSPD snapshot, TGA, FRED yields, average rates) re-check
# every 6h like ust(); the MTS / annual-history extension re-checks monthly and only extends
# when a new fiscal year has completed AND its MTS + GDP are published; the CBO Feb 2026
# baseline is carried forward verbatim — a new CBO baseline is a manual update, never fetched.
# Fail-soft: the file is written once, at the end, after validation; any failure raises before
# the write, so the last good JSON stays live and main() logs the error.
DASH_PATH = ROOT / "us-debt-dashboard.json"
DASH_FRED_YIELDS = ("DGS2", "DGS5", "DGS10", "DGS30", "T5YIE", "DTWEXBGS", "BAMLH0A0HYM2", "BAA10Y", "DTB3", "DGS1")
# Blended refinancing yield: bills at live DTB3, notes at live mean(DGS2, DGS5). The FRN / TIPS /
# bond legs have no live series in this dashboard's source set, so they stay the fixed assumptions
# from the Nov 2026 research build, labelled with their vintage in the methods text.
DASH_REFI_FIXED = {"Floating Rate Notes": 4.15, "Inflation-Protected Securities": 4.50, "Bonds": 5.00}


def _fd_paged(path, **params):
    """All pages of a FiscalData query (research used page[size]=10000, 0.2s between pages)."""
    import urllib.parse
    out, page = [], 1
    while True:
        p = dict(params); p["page[size]"] = 10000; p["page[number]"] = page
        d = get(FISCAL + path + "?" + urllib.parse.urlencode(p)).json()
        out.extend(d.get("data") or [])
        if page >= (d.get("meta") or {}).get("total-pages", 1):
            return out
        page += 1
        time.sleep(0.2)


def _fy_end_bday(fy):
    """Sep 30 of a fiscal year, or the preceding Friday when Sep 30 falls on a weekend
    (Debt to the Penny publishes business days only: FY2017 Sat -> Sep 29, FY2018 Sun -> Sep 28,
    FY2023 Sat -> Sep 29)."""
    d = datetime(fy, 9, 30).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _mspd_months(mat, ref):
    return (mat.year - ref.year) * 12 + (mat.month - ref.month) + (mat.day - ref.day) / 30.44


def _mspd_snapshot(rows, ref):
    """Aggregate a security-level MSPD Table 3 pull (marketable only) the way the Nov 2026
    research did (compute_annual.py): marketable outstanding, WAM, maturities by fiscal year
    and by month, and the 12M/24M refinancing class profile with WA coupon. Amounts are
    $ millions in the file, $ billions here."""
    tot, wam_num, wam_den = 0.0, 0.0, 0.0
    by_fy, by_month = {}, {}
    prof = {w: {"cls": {}, "cw": 0.0, "cb": 0.0, "tot": 0.0} for w in ("12M", "24M")}
    for r in rows:
        amt = _num(r.get("outstanding_amt"))
        mat_s = r.get("maturity_date")
        if amt is None or not mat_s or mat_s == "null":
            continue
        amt_b = amt / 1000.0
        mat = datetime.fromisoformat(mat_s).date()
        tot += amt_b
        fy_label = mat.year + 1 if mat.month >= 10 else mat.year
        by_fy[fy_label] = by_fy.get(fy_label, 0.0) + amt_b
        by_month[mat_s[:7]] = by_month.get(mat_s[:7], 0.0) + amt_b
        m = _mspd_months(mat, ref)
        if m > 0:
            wam_num += amt_b * m; wam_den += amt_b
        for win, hi in (("12M", 12), ("24M", 24)):
            if 0 < m <= hi:
                p = prof[win]
                p["tot"] += amt_b
                cls = r.get("security_class1_desc") or "?"
                p["cls"][cls] = p["cls"].get(cls, 0.0) + amt_b
                c = _num(r.get("interest_rate_pct"))
                if c is not None:
                    p["cw"] += amt_b * c; p["cb"] += amt_b
    out = {"marketable_B": round(tot, 3), "wam_months": round(wam_num / wam_den, 2) if wam_den else None,
           "by_fy_B": {str(k): round(v, 3) for k, v in sorted(by_fy.items())},
           "by_month_B": {k: round(v, 3) for k, v in sorted(by_month.items())},
           "profile": {}}
    for win in ("12M", "24M"):
        p = prof[win]
        out["profile"][win] = {"principal_B": round(p["tot"], 1),
                               "by_class_B": {k: round(v, 1) for k, v in sorted(p["cls"].items(), key=lambda x: -x[1])},
                               "coupon_bearing_B": round(p["cb"], 1),
                               "wa_coupon_pct": round(p["cw"] / p["cb"], 2) if p["cb"] else None}
    return out


def _dash_window_total(by_month, start_ym, end_ym):
    return sum(v for k, v in by_month.items() if start_ym <= k <= end_ym)


def _dtp_on(date_s):
    rows = _fd("v2/accounting/od/debt_to_penny", filter=f"record_date:eq:{date_s}",
               fields="record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt")
    return rows[0] if rows else None


def _air_on(date_s):
    rows = _fd("v2/accounting/od/avg_interest_rates", filter=f"record_date:eq:{date_s}",
               fields="record_date,security_desc,avg_interest_rate_amt", **{"page[size]": 50})
    return {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in rows}


def _auctions_fy_gross(fy):
    """Gross marketable issuance in a fiscal year: sum of auction awards (total_accepted)
    by issue date, FiscalData auctions API. $ billions."""
    rows = _fd_paged("v1/accounting/od/auctions_query",
                     filter=f"issue_date:gte:{fy-1}-10-01,issue_date:lte:{fy}-09-30",
                     fields="auction_date,issue_date,total_accepted")
    return round(sum(_num(r.get("total_accepted")) or 0 for r in rows) / 1e9, 3)


def _mts_fy(fy_end):
    """MTS Table 5 at a fiscal year-end (Sep 30): the four totals the dashboard needs.
    Receipts are not a Table 5 row — they are the identity outlays + surplus (the research
    cross-checked that identity to FRED FYFR)."""
    rows = _fd_paged("v1/accounting/mts/mts_table_5", filter=f"record_date:eq:{fy_end}",
                     fields="record_date,classification_desc,current_fytd_net_outly_amt")
    want = {"Total--Interest on Treasury Debt Securities (Gross)": "gross_interest",
            "Total--Interest Received by Trust Funds": "trust_interest",
            "Total Surplus (+) or Deficit (-)": "surplus",
            "Total Outlays": "outlays"}
    out = {}
    for r in rows:
        k = want.get(r.get("classification_desc"))
        if k:
            out[k] = _num(r.get("current_fytd_net_outly_amt"))
    return out


class _DashNotReady(Exception):
    """A source the extension needs is not published yet (expected, e.g. MTS mid-October
    or BEA Q3 GDP late October) — retry next month, not an error."""


def _dash_annual_row(fy, prev_total_T, prior_mspd):
    """Build one annual-history row for a completed fiscal year, from the live official
    sources, with the research's exact formulas (compute_annual.py + assemble_dashboard.py).
    Returns None (via _DashNotReady) when a source is not published yet."""
    fy_end = _fy_end_bday(fy)
    dtp = _dtp_on(str(fy_end))
    if not dtp:
        raise _DashNotReady(f"Debt to the Penny for FY{fy}-end {fy_end} not published yet")
    total_T = float(dtp["tot_pub_debt_out_amt"]) / 1e12
    held_T = float(dtp["debt_held_public_amt"]) / 1e12
    air = _air_on(str(fy_end))
    wa = air.get("Total Marketable")
    if wa is None:
        raise _DashNotReady(f"average interest rates for FY{fy}-end {fy_end} not published yet")
    gross_B = _auctions_fy_gross(fy)
    net_T = total_T - prev_total_T
    refi_T = gross_B / 1000.0 - net_T
    sched_T = None
    if prior_mspd is not None:
        sched_T = prior_mspd["by_fy_B"].get(str(fy), 0) / 1000.0
    mts = _mts_fy(str(fy_end))
    if not all(k in mts and mts[k] is not None for k in ("gross_interest", "trust_interest", "surplus", "outlays")):
        raise _DashNotReady(f"MTS Table 5 for FY{fy}-end {fy_end} not published yet")
    outlays_T = mts["outlays"] / 1e12
    deficit_T = -mts["surplus"] / 1e12
    receipts_T = (mts["outlays"] + mts["surplus"]) / 1e12
    gross_int_T = mts["gross_interest"] / 1e12
    net_int_T = (mts["gross_interest"] + mts["trust_interest"]) / 1e12
    gdp_obs = dict(_fred("GDP", f"{fy-2}-01-01"))
    qs = [f"{fy-1}-10-01", f"{fy}-01-01", f"{fy}-04-01", f"{fy}-07-01"]
    vals = [gdp_obs[q] for q in qs if q in gdp_obs]
    if len(vals) < 4:
        raise _DashNotReady(f"BEA/FRED quarterly GDP for FY{fy} incomplete ({len(vals)}/4 quarters)")
    fy_gdp_T = sum(vals) / len(vals) / 1000.0
    for sid, ours, label in (("FYFR", receipts_T, "receipts"), ("FYONET", outlays_T, "outlays"), ("FYFSD", -deficit_T, "surplus")):
        try:
            fobs = dict(_fred(sid, f"{fy-1}-10-01"))
            fval = fobs.get(f"{fy}-09-30")
            if fval is not None and abs(fval / 1e6 - ours) > max(0.005, abs(ours) * 0.005):
                print(f"  WARNING: FRED {sid} {label} {fval/1e6:.3f}T vs MTS {ours:.3f}T — keeping MTS")
        except Exception as e:
            print(f"  WARNING: FRED {sid} cross-check failed ({redact(str(e))}) — keeping MTS")
    return {
        "fiscal_year": fy, "fy_end": str(fy_end),
        "total_debt_T": round(total_T, 3), "debt_held_public_T": round(held_T, 3),
        "debt_held_public_pct_gdp": round(held_T / fy_gdp_T * 100, 1) if fy_gdp_T else None,
        "total_debt_pct_gdp": round(total_T / fy_gdp_T * 100, 1) if fy_gdp_T else None,
        "fy_nominal_gdp_T": round(fy_gdp_T, 3),
        "wa_marketable_rate_pct": wa,
        "gross_marketable_issuance_T": round(gross_B / 1000.0, 3),
        "net_new_borrowing_T": round(net_T, 3),
        "refinancing_issuance_T": round(refi_T, 3),
        "maturities_actual_T": round(refi_T, 3),
        "scheduled_maturities_at_prior_year_end_T": round(sched_T, 3) if sched_T is not None else None,
        "receipts_T": round(receipts_T, 3), "outlays_T": round(outlays_T, 3), "deficit_T": round(deficit_T, 3),
        "gross_interest_T": round(gross_int_T, 3), "net_interest_T": round(net_int_T, 3),
        "primary_deficit_T": round(deficit_T - net_int_T, 3),
        "net_interest_pct_receipts": round(net_int_T / receipts_T * 100, 2) if receipts_T else None,
    }


def _dash_refi_cost(snap, rates, rates_date, yields):
    """Refinancing cost from an MSPD snapshot profile + latest average rates + live FRED yields.
    Blended yield: bills at live DTB3, notes at live mean(DGS2, DGS5); FRN/TIPS/bond legs are the
    fixed assumptions from the Nov 2026 build. Existing cost: bills at the latest WA bill rate,
    coupon-bearing debt at its WA coupon from the snapshot. Returns (cost_dict, legs) or
    (None, legs) when a live input is missing — the caller then keeps the stored section."""
    wa_mkt = rates.get("Total Marketable")
    wa_bill = rates.get("Treasury Bills")
    dtb3 = yields.get("DTB3", (None, None))[0]
    d2, d5 = yields.get("DGS2", (None, None))[0], yields.get("DGS5", (None, None))[0]
    notes_y = (d2 + d5) / 2 if d2 is not None and d5 is not None else None
    legs = {"dtb3": dtb3, "notes": notes_y,
            "yield_date": None}
    _yd = max([d for _, d in (yields.get("DTB3", (None, None)), yields.get("DGS2", (None, None)), yields.get("DGS5", (None, None))) if d] or [None])
    if _yd:
        legs["yield_date"] = datetime.fromisoformat(_yd).strftime("%b %d, %Y").replace(" 0", " ")

    def blended(win):
        cls = snap["profile"][win]["by_class_B"]
        w = {"Bills Maturity Value": dtb3, "Notes": notes_y,
             "Floating Rate Notes": DASH_REFI_FIXED["Floating Rate Notes"],
             "Inflation-Protected Securities": DASH_REFI_FIXED["Inflation-Protected Securities"],
             "Bonds": DASH_REFI_FIXED["Bonds"]}
        num = sum(cls.get(k, 0) * v for k, v in w.items() if v is not None)
        den = sum(cls.get(k, 0) for k, v in w.items() if v is not None)
        return round(num / den, 2) if den else None

    def exist_cost(win):
        cls = snap["profile"][win]["by_class_B"]
        tot = snap["profile"][win]["principal_B"]
        bills = cls.get("Bills Maturity Value", 0)
        cb = snap["profile"][win]["coupon_bearing_B"]
        wc = snap["profile"][win]["wa_coupon_pct"]
        if wa_bill is None or wc is None or not tot:
            return None
        return round((bills * wa_bill + cb * wc) / tot, 2)

    def incr(principal, old, new):
        return round(principal * (new - old) / 100, 1) if old is not None and new is not None else None

    b12, b24 = blended("12M"), blended("24M")
    e12, e24 = exist_cost("12M"), exist_cost("24M")
    if None in (b12, b24, e12, e24, wa_mkt, wa_bill):
        return None, legs
    p12 = snap["profile"]["12M"]["principal_B"]
    p24 = snap["profile"]["24M"]["principal_B"]
    return {
        "existing_wa_marketable_rate_pct": wa_mkt,
        "existing_wa_marketable_rate_date": rates_date,
        "wa_bill_rate_pct": wa_bill,
        "wa_bill_rate_date": rates_date,
        "maturing_12M": {"principal_B": p12,
                         "wa_coupon_pct_coupon_bearing_only": snap["profile"]["12M"]["wa_coupon_pct"],
                         "coupon_bearing_B": snap["profile"]["12M"]["coupon_bearing_B"],
                         "estimated_existing_cost_pct": e12, "blended_refinancing_yield_pct": b12,
                         "incremental_annual_interest_B": incr(p12, e12, b12),
                         "incremental_vs_all_marketable_avg_B": incr(p12, wa_mkt, b12)},
        "maturing_24M": {"principal_B": p24,
                         "wa_coupon_pct_coupon_bearing_only": snap["profile"]["24M"]["wa_coupon_pct"],
                         "coupon_bearing_B": snap["profile"]["24M"]["coupon_bearing_B"],
                         "estimated_existing_cost_pct": e24, "blended_refinancing_yield_pct": b24,
                         "incremental_annual_interest_B": incr(p24, e24, b24)},
        "sensitivity_12M_B_per_year": {"+50bps": round(p12 * 0.005, 1), "+100bps": round(p12 * 0.01, 1), "+200bps": round(p12 * 0.02, 1)},
        "sensitivity_24M_B_per_year": {"+50bps": round(p24 * 0.005, 1), "+100bps": round(p24 * 0.01, 1), "+200bps": round(p24 * 0.02, 1)},
        "cumulative_2yr_incremental_B": round(incr(p12, e12, b12) + incr(p24 - p12, e24, b24), 1),
    }, legs


def ust_dashboard(D, N):
    """Regenerate us-debt-dashboard.json (Treasury tab) from the official sources.
    Fast sections (Debt to the Penny, MSPD snapshot, TGA, FRED yields, average rates) re-check
    every 6h like ust(); the MTS / annual-history extension re-checks monthly and only extends
    when a new fiscal year has completed AND its MTS + GDP are published; the CBO Feb 2026
    baseline is carried forward verbatim. Each fast sub-section is attempted independently — a
    dead feed keeps its stored values (with a warning) instead of failing the block. The file is
    written once, at the end, after validation; any structural failure raises before the write,
    so the last good JSON stays live and main() logs the error."""
    meta = D["meta"]
    last6 = meta.get("ust_dashboard_checked")
    last_mts = meta.get("ust_dashboard_mts_checked")
    do_fast = not last6 or UDC.NOW - datetime.fromisoformat(last6) >= timedelta(hours=6)
    do_mts = not last_mts or UDC.NOW - datetime.fromisoformat(last_mts) >= timedelta(days=30)
    if not do_fast and not do_mts:
        print("  checked <6h ago (MTS <30d) - skipping")
        return False
    if not DASH_PATH.exists():
        raise RuntimeError("us-debt-dashboard.json not found — a full rebuild is a manual research step, not a pipeline refresh")
    stored = json.loads(DASH_PATH.read_text(encoding="utf-8"))
    new = json.loads(json.dumps(stored))
    src_dates = []

    def _window_ym(ref_date, n_months):
        y, m = ref_date.year, ref_date.month
        out = []
        for _ in range(n_months):
            m += 1
            if m > 12:
                m = 1; y += 1
            out.append(f"{y:04d}-{m:02d}")
        return out

    # ---- fast sections (6h) ----
    if do_fast:
        # Debt to the Penny, latest
        try:
            pen = _fd("v2/accounting/od/debt_to_penny", sort="-record_date", **{"page[size]": 1})[0]
            total_T = float(pen["tot_pub_debt_out_amt"]) / 1e12
            old_total = (stored.get("current_snapshot_crosscheck") or {}).get("total_debt_T")
            if old_total and abs(total_T - old_total) / old_total > 0.01:
                raise RuntimeError(f"Debt to the Penny jumped {old_total}T -> {total_T}T — refusing to publish")
            if not (30 < total_T < 60):
                raise RuntimeError(f"Debt to the Penny implausible: {total_T}T")
            new["current_snapshot_crosscheck"]["total_debt_T"] = round(total_T, 3)
            new["current_snapshot_crosscheck"]["total_debt_date"] = pen["record_date"]
            src_dates.append(pen["record_date"])
            print(f"  debt to the penny: ${total_T:.3f}T at {pen['record_date']}")
        except Exception as e:
            print(f"  WARNING: debt to the penny refresh failed ({redact(str(e))}) — keeping stored")
        # MSPD: Table 1 gives the latest statement date cheaply; Table 3 only re-fetches on a new statement
        snap = None
        snap_date = (stored.get("current_snapshot_crosscheck") or {}).get("mspd_date")
        try:
            t1 = _fd("v1/debt/mspd/mspd_table_1", sort="-record_date", **{"page[size]": 40})
            rd = t1[0]["record_date"]
            t1_mkt = sum((_num(r.get("total_mil_amt")) or 0) for r in t1
                         if r["record_date"] == rd and r.get("security_type_desc") == "Marketable") / 1000.0
            if snap_date and rd <= snap_date:
                print(f"  MSPD still {snap_date} — forward schedule unchanged")
            else:
                rows = _fd_paged("v1/debt/mspd/mspd_table_3",
                                 filter=f"record_date:eq:{rd},security_type_desc:eq:Marketable",
                                 fields="record_date,security_type_desc,security_class1_desc,security_class2_desc,security_class3_desc,interest_rate_pct,issue_date,maturity_date,issued_amt,outstanding_amt")
                ref = datetime.fromisoformat(rd).date()
                snap = _mspd_snapshot(rows, ref)
                if abs(snap["marketable_B"] - t1_mkt) / t1_mkt > 0.01:
                    raise RuntimeError(f"MSPD Table 3 (${snap['marketable_B']:,.1f}B) vs Table 1 (${t1_mkt:,.1f}B) disagree >1%")
                first_fy = ref.year + 1 if ref.month >= 10 else ref.year
                months24 = _window_ym(ref, 24)
                w12 = _dash_window_total(snap["by_month_B"], months24[0], months24[11])
                w24 = _dash_window_total(snap["by_month_B"], months24[0], months24[23])
                if abs(w12 - snap["profile"]["12M"]["principal_B"]) > 0.5 or abs(w24 - snap["profile"]["24M"]["principal_B"]) > 0.5:
                    raise RuntimeError(f"MSPD window totals {w12:.1f}/{w24:.1f}B disagree with class profile "
                                       f"{snap['profile']['12M']['principal_B']:.1f}/{snap['profile']['24M']['principal_B']:.1f}B")
                if snap["wam_months"] is None or not (20 <= snap["wam_months"] <= 150):
                    raise RuntimeError(f"MSPD WAM implausible: {snap['wam_months']}")
                label = ref.strftime("%b %d, %Y")
                new["forward_maturity_schedule"] = {
                    "snapshot": f"MSPD Table 3, {label} (marketable securities only)",
                    "total_marketable_B": snap["marketable_B"],
                    "wam_months": snap["wam_months"],
                    "maturing_12M_B": snap["profile"]["12M"]["principal_B"],
                    "maturing_24M_B": snap["profile"]["24M"]["principal_B"],
                    "maturing_by_fiscal_year_B": {str(fy): snap["by_fy_B"].get(str(fy), 0.0) for fy in range(first_fy, first_fy + 4)},
                    "maturing_by_month_B": {k: v for k, v in sorted(snap["by_month_B"].items()) if k in months24},
                    "maturity_profile_by_tenor_B": {"0-12M": snap["profile"]["12M"]["principal_B"],
                                                    "12-24M": round(snap["profile"]["24M"]["principal_B"] - snap["profile"]["12M"]["principal_B"], 1)},
                    "refinancing_profile": snap["profile"],
                }
                cc = new["current_snapshot_crosscheck"]
                cc["marketable_T"] = round(snap["marketable_B"] / 1000, 3)
                cc["marketable_date"] = rd
                cc["maturing_12M_T"] = round(snap["profile"]["12M"]["principal_B"] / 1000, 3)
                cc["maturing_24M_T"] = round(snap["profile"]["24M"]["principal_B"] / 1000, 3)
                cc["wam_months"] = round(snap["wam_months"], 1)
                cc["mspd_date"] = rd
                snap_date = rd
                src_dates.append(rd)
                print(f"  MSPD {rd}: marketable ${snap['marketable_B']:,.1f}B, 12M ${snap['profile']['12M']['principal_B']:,.1f}B, WAM {snap['wam_months']} mo")
        except Exception as e:
            print(f"  WARNING: MSPD refresh failed ({redact(str(e))}) — keeping stored forward schedule")
            snap = None
        # Average interest rates, latest month
        rates, rates_date = {}, None
        try:
            arr = _fd("v2/accounting/od/avg_interest_rates", sort="-record_date", **{"page[size]": 40})
            rates_date = arr[0]["record_date"]
            rates = {r["security_desc"]: _num(r["avg_interest_rate_amt"]) for r in arr if r["record_date"] == rates_date}
            src_dates.append(rates_date)
        except Exception as e:
            print(f"  WARNING: average interest rates refresh failed ({redact(str(e))}) — keeping stored")
        # FRED market yields, latest (fredgraph.csv, no key — same as _fred)
        yields = {}
        start = (UDC.NOW - timedelta(days=40)).date().isoformat()
        for sid in DASH_FRED_YIELDS:
            try:
                obs = _fred(sid, start)
                if obs:
                    d, v = obs[-1]
                    old = (stored.get("risk_indicators") or {}).get(sid) or {}
                    if not old.get("date") or d >= old["date"]:
                        new["risk_indicators"][sid] = {"value": v, "date": d}
                        yields[sid] = (v, d)
                        src_dates.append(d)
            except Exception as e:
                print(f"  WARNING: FRED {sid} refresh failed ({redact(str(e))}) — keeping stored")
        # Refinancing cost from the current snapshot profile + live rates + live yields
        try:
            prof = (new.get("forward_maturity_schedule") or {}).get("refinancing_profile") or (stored.get("forward_maturity_schedule") or {}).get("refinancing_profile")
            if prof and rates and yields:
                cost, legs = _dash_refi_cost({"profile": prof}, rates, rates_date, yields)
                if cost is not None:
                    new["refinancing_cost"] = cost
                    if legs.get("yield_date"):
                        new["methods"]["blended_refinancing_yield"] = (
                            "Estimate, not an official figure. Weights the " + legs["yield_date"] + " market yields by the maturing "
                            "principal by class: bills at the 3-month bill rate (DTB3 " +
                            (f"{legs['dtb3']:.2f}%" if legs.get("dtb3") is not None else "n/a") + "), notes at the mean of 2Y/5Y (" +
                            (f"{legs['notes']:.2f}%" if legs.get("notes") is not None else "n/a") + "), FRNs at 4.15% (fixed assumption, "
                            "Nov 2026), TIPS at 4.50% (nominal-equivalent, fixed assumption, Nov 2026), bonds at 5.00% (fixed "
                            "assumption, Nov 2026). See refinancing_cost for the components.")
                    new["methods"]["existing_cost_of_maturing_stock"] = (
                        "Estimate. Bills at the WA bill rate (" + f"{rates.get('Treasury Bills'):.2f}%, FiscalData avg_interest_rates " +
                        (datetime.fromisoformat(rates_date).strftime("%b %Y") if rates_date else "n/a") + "); coupon-bearing maturing debt at its WA coupon (MSPD-derived). Bills' true issue "
                        "yields are not in the MSPD (discount instruments), so this is an approximation, labelled as such.")
                    print(f"  refinancing cost: 12M blended {cost['maturing_12M']['blended_refinancing_yield_pct']}% vs existing "
                          f"{cost['maturing_12M']['estimated_existing_cost_pct']}% -> +${cost['maturing_12M']['incremental_annual_interest_B']}B/yr")
                else:
                    print("  WARNING: refinancing cost inputs incomplete — keeping stored")
            else:
                print("  WARNING: refinancing cost inputs incomplete — keeping stored")
        except Exception as e:
            print(f"  WARNING: refinancing cost refresh failed ({redact(str(e))}) — keeping stored")
        # TGA cash balance, latest (Daily Treasury Statement; close_today_bal is null — open_today_bal is the balance)
        try:
            tga = _fd("v1/accounting/dts/operating_cash_balance",
                      filter="account_type:eq:Treasury General Account (TGA) Closing Balance",
                      sort="-record_date", **{"page[size]": 1})[0]
            bal = _num(tga.get("open_today_bal"))
            if bal is not None:
                svc = new["servicing_capacity"]
                if not svc.get("tga_balance_date") or tga["record_date"] >= svc["tga_balance_date"]:
                    svc["tga_balance_B"] = round(bal / 1000, 3)  # DTS amounts are $ millions
                    svc["tga_balance_date"] = tga["record_date"]
                    src_dates.append(tga["record_date"])
                    print(f"  TGA: ${bal/1000:.3f}B at {tga['record_date']}")
        except Exception as e:
            print(f"  WARNING: TGA refresh failed ({redact(str(e))}) — keeping stored")
        # Forward borrowing need: MSPD-derived parts move with the live snapshot; CBO parts are carried
        try:
            hist = new.get("annual_history_fy2015_2026") or []
            latest_fy = max((r["fiscal_year"] for r in hist), default=None)
            if latest_fy:
                last_row = next(r for r in hist if r["fiscal_year"] == latest_fy)
                intra_B = round((last_row["total_debt_T"] - last_row["debt_held_public_T"]) * 1000, 0)
                fwd_sched = new.get("forward_maturity_schedule") or {}
                by_fy = fwd_sched.get("maturing_by_fiscal_year_B") or {}
                for key, fwd in (new.get("forward_borrowing_need") or {}).items():
                    fy = int(key[2:])
                    if str(fy) not in by_fy or "cbo_deficit_B" not in fwd or "debt_held_public_B" not in fwd:
                        continue
                    fwd["principal_maturing_B"] = round(by_fy[str(fy)], 1)
                    fwd["expected_gross_issuance_B"] = round(by_fy[str(fy)] + abs(fwd["cbo_deficit_B"]), 1)
                    fwd["total_debt_estimate_B"] = int(round(fwd["debt_held_public_B"] + intra_B + 200 * (fy - latest_fy), 0))
                new["methods"]["total_debt_forward_estimate"] = (
                    "CBO projects debt held by the public only. Total debt shown = CBO debt held by the public + "
                    f"intragovernmental holdings (${intra_B:,.0f}B at Sep 30, {latest_fy}) grown ~$0.2T/yr (recent trend). "
                    "Labelled estimate, not a CBO figure.")
        except Exception as e:
            print(f"  WARNING: forward borrowing need refresh failed ({redact(str(e))}) — keeping stored")
        # Cross-check note + data vintage
        try:
            cc = new["current_snapshot_crosscheck"]
            cc["wa_rate_pct"] = rates.get("Total Marketable", cc.get("wa_rate_pct"))
            _md = datetime.fromisoformat(cc["mspd_date"]).strftime("%b %d, %Y").replace(" 0", " ") if cc.get("mspd_date") else "n/a"
            _fs = new.get("forward_maturity_schedule") or {}
            _m12 = _fs.get("maturing_12M_B", (cc.get("maturing_12M_T") or 0) * 1000)
            _m24 = _fs.get("maturing_24M_B", (cc.get("maturing_24M_T") or 0) * 1000)
            cc["note"] = ("Reproduced exactly from the MSPD " + _md + " snapshot "
                          f"(12M ${_m12:,.1f}B, 24M ${_m24:,.1f}B, "
                          f"WAM {cc.get('wam_months')} mo, WA rate {cc.get('wa_rate_pct')}%).")
        except Exception as e:
            print(f"  WARNING: cross-check note refresh failed ({redact(str(e))}) — keeping stored")
        # Servicing notes (derived text — regenerated from the current figures every run)
        try:
            svc = new["servicing_capacity"]
            fy = svc["fiscal_year"]
            cbo = new.get("cbo_baseline") or {}
            cbo_fy = cbo.get(f"fy{fy}") or cbo.get("fy2026_projection") or {}
            if cbo_fy.get("outlays_B") and svc.get("outlays_T"):
                gap = round(svc["outlays_T"] * 1000 - cbo_fy["outlays_B"], 0)
                svc["mandatory_note"] = (
                    f"CBO Feb 2026 baseline projection for FY{fy}, not an MTS actual; the MTS does not publish a "
                    "mandatory/discretionary split. Actual FY" + str(fy) + " outlays "
                    f"(${svc['outlays_T']*1000:,.0f}B) came in ${abs(gap):,.0f}B {'below' if gap < 0 else 'above'} "
                    f"CBO's ${cbo_fy['outlays_B']:,.0f}B projection.")
            if svc.get("tga_balance_B") and svc.get("deficit_T") and svc.get("primary_deficit_T"):
                yrs = svc["tga_balance_B"] / (svc["deficit_T"] * 1000)
                svc["cash_after_interest_note"] = (
                    f"Primary deficit (-${svc['primary_deficit_T']*1000:,.0f}B) is the cash shortfall before interest; "
                    f"the total deficit (-${svc['deficit_T']*1000:,.0f}B) is after interest. The TGA balance "
                    f"(${svc['tga_balance_B']:,.0f}B) covers ~{yrs:.2f} years of the total deficit at the FY{fy} run-rate.")
        except Exception as e:
            print(f"  WARNING: servicing notes refresh failed ({redact(str(e))}) — keeping stored")
        # Gaps that carry live numbers (the structural caveats stay verbatim)
        try:
            gaps = new.get("gaps_and_unverified") or []
            fwd = new.get("forward_borrowing_need") or {}
            fwd_keys = sorted(fwd.keys())
            if len(fwd_keys) >= 2 and len(gaps) > 0:
                fy2 = int(fwd_keys[1][2:])
                _sd = datetime.fromisoformat(snap_date).strftime("%b %d, %Y").replace(" 0", " ") if snap_date else "n/a"
                gaps[0] = (f"Forward FY{fy2} maturities (${fwd[fwd_keys[1]].get('principal_maturing_B', 0):,.0f}B) are CONFIRMED "
                           f"maturities only — securities outstanding as of {_sd}. Bills issued during FY{fy2-1} that "
                           f"mature in FY{fy2} are not in the snapshot, so the FY{fy2} maturity and gross-issuance figures will rise "
                           "as new bills are issued. The 12M/24M windows have the same property.")
            hist = new.get("annual_history_fy2015_2026") or []
            if hist and len(gaps) > 9:
                last_row = hist[-1]
                cbo = new.get("cbo_baseline") or {}
                proj = cbo.get(f"fy{last_row['fiscal_year']}") or cbo.get("fy2026_projection") or {}
                if proj.get("debt_held_public_B") and proj.get("deficit_B") is not None:
                    held_actual = round(last_row["debt_held_public_T"] * 1000, 0)
                    miss = round(held_actual - proj["debt_held_public_B"], 0)
                    def_gap = round(last_row["deficit_T"] * 1000 + proj["deficit_B"], 0)
                    gaps[9] = (f"CBO's debt-held-by-the-public projection for FY{last_row['fiscal_year']} "
                               f"(${proj['debt_held_public_B']:,.0f}B) came in ${abs(miss):,.0f}B "
                               f"{'below' if miss > 0 else 'above'} the actual (${held_actual:,.0f}B) because the actual "
                               f"FY{last_row['fiscal_year']} deficit (${last_row['deficit_T']*1000:,.0f}B) "
                               f"{'exceeded' if def_gap > 0 else 'came in below'} CBO's projection (${-proj['deficit_B']:,.0f}B).")
            new["gaps_and_unverified"] = gaps
        except Exception as e:
            print(f"  WARNING: gaps refresh failed ({redact(str(e))}) — keeping stored")
        # Latest MTS month (for the MTS gap note) + GFDEBTN lag check
        try:
            mts_latest = _fd("v1/accounting/mts/mts_table_5", sort="-record_date", **{"page[size]": 1})[0]["record_date"]
            gaps = new.get("gaps_and_unverified") or []
            if len(gaps) > 7:
                nxt = datetime.fromisoformat(mts_latest)
                nm = (nxt.replace(day=1) + timedelta(days=32)).replace(day=1)
                hist = new.get("annual_history_fy2015_2026") or []
                last_fy = hist[-1]["fiscal_year"] if hist else None
                gaps[7] = (f"MTS for {nm.strftime('%B %Y')} is not yet published (as of {UDC.NOW.date().strftime('%b %d, %Y').replace(' 0', ' ')}), so the "
                           f"annual figures in this file run through FY{last_fy} (Oct {last_fy-1}–Sep {last_fy})." if last_fy else gaps[7])
            try:
                gf = _fred("GFDEBTN", f"{(new.get('annual_history_fy2015_2026') or [{}])[-1].get('fiscal_year', 2026)-1}-01-01")
                if gf and len(gaps) > 5:
                    last_gf_date = gf[-1][0]
                    fy_end_s = (new.get("annual_history_fy2015_2026") or [{}])[-1].get("fy_end", "")
                    if fy_end_s and last_gf_date >= fy_end_s:
                        gaps[5] = ("FRED GFDEBTN (quarterly total debt) now covers the latest fiscal year-end; "
                                   "FiscalData Debt to the Penny remains the authoritative source for it.")
            except Exception:
                pass
            new["gaps_and_unverified"] = gaps
        except Exception as e:
            print(f"  WARNING: MTS recency check failed ({redact(str(e))}) — keeping stored gaps")
        new["prepared"] = UDC.NOW.date().isoformat()
        if src_dates:
            new["data_as_of"] = max(src_dates)
        meta["ust_dashboard_checked"] = iso(UDC.NOW)

    # ---- monthly MTS / annual-history extension ----
    if do_mts:
        try:
            hist = new.get("annual_history_fy2015_2026") or []
            last_fy = max((r["fiscal_year"] for r in hist), default=None)
            today = UDC.NOW.date()
            latest_completed_fy = today.year if today >= datetime(today.year, 9, 30).date() else today.year - 1
            if last_fy is None or latest_completed_fy <= last_fy:
                print(f"  annual history already through FY{last_fy} — no extension due")
            else:
                new_fy = last_fy + 1
                prev_total = hist[-1]["total_debt_T"]
                try:  # unrounded prior year-end total avoids a $1M rounding bias in net/refinancing
                    _prev_dtp = _dtp_on(str(_fy_end_bday(last_fy)))
                    if _prev_dtp:
                        prev_total = float(_prev_dtp["tot_pub_debt_out_amt"]) / 1e12
                except Exception as e:
                    print(f"  WARNING: prior FY-end Debt to the Penny unavailable ({redact(str(e))}) — using stored rounded total")
                prior_end = _fy_end_bday(new_fy - 1)
                prior_rows = _fd_paged("v1/debt/mspd/mspd_table_3",
                                       filter=f"record_date:eq:{prior_end},security_type_desc:eq:Marketable",
                                       fields="record_date,security_type_desc,security_class1_desc,security_class2_desc,security_class3_desc,interest_rate_pct,issue_date,maturity_date,issued_amt,outstanding_amt")
                prior_snap = _mspd_snapshot(prior_rows, prior_end)
                row = _dash_annual_row(new_fy, prev_total, prior_snap)
                hist.append(row)
                new["annual_history_fy2015_2026"] = hist
                print(f"  annual history extended: FY{new_fy} debt ${row['total_debt_T']}T, net interest ${row['net_interest_T']}T "
                      f"({row['net_interest_pct_receipts']}% of receipts)")
                # Roll servicing capacity to the new fiscal year (CBO split carried if the baseline lacks the year)
                svc = new["servicing_capacity"]
                cbo = new.get("cbo_baseline") or {}
                cbo_fy = cbo.get(f"fy{new_fy}") or {}
                if not cbo_fy:
                    print(f"  WARNING: CBO baseline has no FY{new_fy} — servicing mandatory/discretionary carried from FY{svc['fiscal_year']}")
                svc.update({
                    "fiscal_year": new_fy, "receipts_T": row["receipts_T"], "outlays_T": row["outlays_T"],
                    "deficit_T": row["deficit_T"], "gross_interest_T": row["gross_interest_T"],
                    "net_interest_T": row["net_interest_T"], "primary_deficit_T": row["primary_deficit_T"],
                    "net_interest_pct_receipts": row["net_interest_pct_receipts"],
                    "gross_interest_pct_receipts": round(row["gross_interest_T"] / row["receipts_T"] * 100, 2),
                    "mandatory_B_cbo_baseline": cbo_fy.get("mandatory_B", svc.get("mandatory_B_cbo_baseline")),
                    "discretionary_B_cbo_baseline": cbo_fy.get("discretionary_B", svc.get("discretionary_B_cbo_baseline")),
                    "derived_mandatory_actual_B": round(row["outlays_T"] * 1000 - svc.get("discretionary_B_cbo_baseline", 0) - row["net_interest_T"] * 1000, 0),
                })
                new["methods"]["mandatory_discretionary_actual"] = (
                    "The MTS does not publish a mandatory/discretionary split. FY" + str(new_fy) + " mandatory/discretionary "
                    "shown are CBO Feb 2026 baseline projections; a derived actual mandatory is also given (actual outlays "
                    "minus CBO discretionary minus actual net interest) and labelled derived.")
            meta["ust_dashboard_mts_checked"] = iso(UDC.NOW)
        except _DashNotReady as e:
            print(f"  FY extension not ready yet: {e} — retrying next month")
            meta["ust_dashboard_mts_checked"] = iso(UDC.NOW)
        except Exception:
            raise

    # ---- validate the combined file before writing ----
    hist = new.get("annual_history_fy2015_2026") or []
    prev = None
    for r in hist:
        if abs(r["refinancing_issuance_T"] - (r["gross_marketable_issuance_T"] - r["net_new_borrowing_T"])) > 0.011:
            raise RuntimeError(f"annual history FY{r['fiscal_year']}: refinancing != gross - net")
        if prev is not None and abs(r["net_new_borrowing_T"] - (r["total_debt_T"] - prev)) > 0.011:
            raise RuntimeError(f"annual history FY{r['fiscal_year']}: net borrowing != change in total debt")
        prev = r["total_debt_T"]
    fwd_sched = new.get("forward_maturity_schedule") or {}
    if not (5000 < fwd_sched.get("maturing_12M_B", 0) < 20000):
        raise RuntimeError(f"forward 12M maturities implausible: {fwd_sched.get('maturing_12M_B')}")
    if not (20 <= (fwd_sched.get("wam_months") or 0) <= 150):
        raise RuntimeError(f"forward WAM implausible: {fwd_sched.get('wam_months')}")
    risk = new.get("risk_indicators") or {}
    for sid in DASH_FRED_YIELDS:
        v = (risk.get(sid) or {}).get("value")
        if v is None or not isinstance(v, (int, float)):
            raise RuntimeError(f"risk indicator {sid} has no value")
    rc = new.get("refinancing_cost") or {}
    for win in ("maturing_12M", "maturing_24M"):
        if not (0 < (rc.get(win) or {}).get("principal_B", 0)):
            raise RuntimeError(f"refinancing_cost {win} has no principal")
        if not (0 <= (rc.get(win) or {}).get("blended_refinancing_yield_pct", -1) <= 15):
            raise RuntimeError(f"refinancing_cost {win} blended yield implausible")

    old_text = json.dumps(stored, sort_keys=True)
    new_text = json.dumps(new, sort_keys=True)
    if old_text != new_text:
        if "--dry-run" in sys.argv:
            print("  dry run — us-debt-dashboard.json not written")
        else:
            tmp = DASH_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(new, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            tmp.replace(DASH_PATH)
            print("  us-debt-dashboard.json written")
    else:
        print("  dashboard unchanged")
    meta.setdefault("asof", {})["ust_dashboard"] = iso(UDC.NOW)
    return True
