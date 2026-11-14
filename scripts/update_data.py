#!/usr/bin/env python3
"""Refresh data.json for the Grain & USD/CAD desk.

Run by .github/workflows/refresh-data.yml every 15 minutes on weekdays.
Each source is patched independently: if one feed is down or changes shape,
its block keeps the previous values (and its old as-of time, so the page's
freshness pill goes amber/red) while every other block still updates.

What it refreshes                         Source (all free, no key)
  fx.feed (USD/CAD mid)                    Yahoo Finance CAD=X, ~delayed
  fx.closes, fx.spot.ref, fx.levels        Bank of Canada Valet FXUSDCAD + Yahoo prior-day OHLC (pivot)
  fx.rates, fx.treasury, fx.widest         US Treasury daily par curve + BoC Valet benchmark yields
  fx.policy.corra_now                      BoC Valet V39079 (target for the overnight rate)
  fx.pos (CAD leveraged funds)             CFTC TFF futures-only (Socrata gpe5-46if)
  grains.*.cftc (managed money)            CFTC disaggregated futures-only (Socrata 72hh-3qpy)
  grains.*.fan.intraday                    Yahoo ZC=F / ZW=F / ZS=F, delayed
  fx.energy (WTI, Brent), fx.wcs_diff      Yahoo CL=F / BZ=F (WCS leg stays as stored)
  fx.fxcross                               Yahoo DX-Y.NYB, EURUSD=X, JPY=X, CAD=X
  NEWS                                     Google News RSS search
Left as stored (no free source / model output): grain settlements & fan math,
options chains, roll, export sales, Fed odds, CORRA futures, retail sentiment,
FX options, forecast/scenarios/bias, trade template, calendar.

Usage:  python scripts/update_data.py [--only fx_spot,news] [--dry-run]
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
from ud_common import (  # noqa: F401  (re-exported: live_loop, tests and other jobs use update_data.<name>)
    ROOT, DATA_PATH, TOR, UA, iso, redact, SECRET_ENV, get,
    yf, yahoo_last, pctile, valet, _num, _fred, _valet_series, _release_times,
    recent_release, WASDE_DATES)
from ud_fx import (  # noqa: F401  (re-exported: live_loop, tests and other jobs use update_data.<name>)
    fx_spot, fx_closes, US_COLS, CA_LABEL, us_curve, ca_curve, yields, socrata,
    _daily_closes, _week_means, _fund_basis, _tag_prices, _fieldnum, _pos_kpis, cftc_fx, fx_alpha,
    FF_FEEDS, CAL_TZ, calendar, _closes_yf, fx_model, _month_code, fed_odds, GRAIN_CFTC,
    cftc_grains, GRAIN_YF)
from ud_grains import (  # noqa: F401  (re-exported: live_loop, tests and other jobs use update_data.<name>)
    MCODE, GRAIN_MONTHS, US_HOL, _bday, contract_dates, next_contract, last_trade, archive_pair,
    merge_follow, expired_track, season_contract, season_month, seasonality_track, roll_fronts, grains_quote, option_month_quotes,
    YIELD_YF, YIELD_PROXY, PROXY_MIN_R2, PROXY_MAX_BP, fit_sensitivity, _proxy_fits, _proxy_estimate, yields_live,
    energy, crosses, NEWS_Q, news, MONTHS, _set_release, releases, _yahoo_settles,
    _fan_from, settles, _yahoo_hl, optflow, FAS, ESR_MATCH, _ESR_COUNTRIES, _destinations,
    exports, PSD, PSD_CODE, BU_PER_MT, HA_TO_AC, SD_ROWS, _psd_us, _PSD_REF,
    _LAST_PSD, _sd_values, wasde, sd_hist, INPUT_FRED, WB_COLS, _weekly, _worldbank_monthly,
    inputs, grain_long)
from ud_macro import (  # noqa: F401  (re-exported: live_loop, tests and other jobs use update_data.<name>)
    MACRO, VALET_TO_STATCAN, MACRO_LONG, BLS_SRC, BLS_KEY, _KeepNewer, _bls_batch, BEA_KEY,
    BEA_SRC, _bea, _statcan, _statcan1, _label, _freq, _transform, _track,
    ca_retail, _MN, _ISM_CACHE, _ism, _ivey, _bizday, FF_MAP, FF_UNIT,
    _ffnum, pmi_calendar, macro, EXT_FRED, MONTHS_FULL, _ca_trade, _ca_fiscal, _fm_components,
    external, SC_CROP, SC_PRICE, SC_GEOS, _sc_table, _sc_release_times, AAFC_INDEX, _MDY,
    _strip_html, ca_calendar, _num0, canada, policy_watch, cpi_detail, cpi_detail_ca, release_hist)
from ud_treasury import (  # noqa: F401  (re-exported: live_loop, tests and other jobs use update_data.<name>)
    FISCAL, UST_TYPES, _fd, ust, DASH_PATH, DASH_FRED_YIELDS, DASH_REFI_FIXED, _fd_paged,
    _fy_end_bday, _mspd_months, _mspd_snapshot, _dash_window_total, _dtp_on, _air_on, _auctions_fy_gross, _mts_fy,
    _DashNotReady, _dash_annual_row, _dash_refi_cost, ust_dashboard)


class _Module(sys.modules[__name__].__class__):
    """update_data.NOW reads and sets the one run clock in ud_common, so `U.NOW = ...` reaches every block."""
    @property
    def NOW(self):
        return UDC.NOW

    @NOW.setter
    def NOW(self, v):
        UDC.NOW = v


sys.modules[__name__].__class__ = _Module

BLOCKS = [("seasonality_track", seasonality_track), ("expired_track", expired_track), ("policy_watch", policy_watch), ("fx_spot", fx_spot), ("fx_alpha", fx_alpha), ("fx_closes", fx_closes), ("yields", yields), ("cftc_fx", cftc_fx),
          ("cftc_grains", cftc_grains), ("grains_quote", grains_quote), ("yields_live", yields_live), ("energy", energy),
          ("crosses", crosses), ("news", news), ("calendar", calendar), ("fed_odds", fed_odds), ("releases", releases), ("macro", macro), ("cpi_detail", cpi_detail), ("grain_long", grain_long), ("release_hist", release_hist), ("cpi_detail_ca", cpi_detail_ca), ("settles", settles), ("exports", exports), ("wasde", wasde), ("canada", canada), ("ca_calendar", ca_calendar), ("sd_hist", sd_hist), ("inputs", inputs), ("ext", external), ("ca_retail", ca_retail), ("fx_model", fx_model), ("optflow", optflow), ("ust", ust), ("ust_dashboard", ust_dashboard)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated block names")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="ignore the 'checked recently' throttle for the --only blocks")
    a = ap.parse_args()
    doc = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    D, N = doc["DATA"], doc["NEWS"]
    before = json.dumps(doc, sort_keys=True)
    only = set(a.only.split(",")) if a.only else None
    if a.force and only:
        for name in only:
            D["meta"].pop(f"{name}_checked", None)
    ok, failed, errors = [], [], {}
    for k_, old_, new_ in roll_fronts(D):
        print(f"[roll] {k_}: {old_} past its hard exit -> front is now {new_}")
    for name, fn in BLOCKS:
        if only and name not in only:
            continue
        print(f"[{name}]")
        snapshot = json.dumps({"D": D, "N": N})
        try:
            fn(D, N)
            ok.append(name)
        except Exception as e:  # restore this block's partial edits, keep going
            restored = json.loads(snapshot)
            D.clear(); D.update(restored["D"]); N.clear(); N.update(restored["N"])
            failed.append(name)
            errors[name] = redact(f"{type(e).__name__}: {e}")[:1200]
            print(f"  FAILED: {redact(e)}")
            print(redact(traceback.format_exc(limit=1)))
    try:   # a decision read from the official statement is the current rate until the daily series catch up
        import policy_watch as PW
        if PW.apply_decisions(D):
            print("[policy decisions] current rates updated from the statements read today")
    except Exception as e:
        print("  policy decisions not applied:", e)
    if errors:
        D["meta"]["last_errors"] = errors  # no timestamp: a repeating failure won't commit every run
    else:
        D["meta"].pop("last_errors", None)
    if json.dumps(doc, sort_keys=True) == before:
        print("no changes")
        return 1 if not ok else 0
    D["meta"]["updated_at"] = iso(UDC.NOW)
    D["meta"]["updated_by"] = "GitHub Action refresh"
    D["meta"]["last_run"] = {"ok": ok, "failed": failed, "at": iso(UDC.NOW)}
    if a.dry_run:
        print("dry run — not writing")
    else:
        DATA_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("ok:", ok, "| failed:", failed)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
