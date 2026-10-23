"""Temporary: which official sources allow browser (CORS) access, and the StatCan vector IDs behind retail/trade."""
import sys, os, requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_data as U
O = {"Origin": "https://anirudhpdoshi.github.io", "User-Agent": "Mozilla/5.0"}
URLS = {
 "valet": "https://www.bankofcanada.ca/valet/observations/CPI_TRIM,V39079/json?recent=2",
 "fredgraph": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL&cosd=2026-01-01",
 "fredapi": "https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&file_type=json",
 "bls_v1": "https://api.bls.gov/publicAPI/v1/timeseries/data/CUSR0000SA0",
 "census_marts": "https://api.census.gov/data/timeseries/eits/marts?get=cell_value,data_type_code,category_code,seasonally_adj,time_slot_id&time=from+2026",
 "census_ftd": "https://api.census.gov/data/timeseries/eits/ftd?get=cell_value,data_type_code,category_code,seasonally_adj&time=from+2026",
 "treasury": "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1?sort=-record_date&page[size]=2",
 "dol_ar539": "https://oui.doleta.gov/unemploy/csv/ar539.csv",
 "umich": "https://www.sca.isr.umich.edu/files/tbmics.csv",
 "cftc_dis": "https://publicreporting.cftc.gov/resource/72hh-3qpy.json?$limit=1",
 "cftc_tff": "https://publicreporting.cftc.gov/resource/gpe5-46if.json?$limit=1",
 "fiscal_monitor": "https://www.canada.ca/en/department-finance/services/publications/fiscal-monitor/2026/07.html",
 "yahoo": "https://query1.finance.yahoo.com/v8/finance/chart/ZCZ26.CBT?range=5d&interval=1d",
 "bea": "https://apps.bea.gov/api/data?method=GETDATASETLIST&ResultFormat=JSON",
 "statcan_cube": "https://www150.statcan.gc.ca/t1/wds/rest/getAllCubesListLite",
}
for k, u in URLS.items():
    try:
        r = requests.get(u, headers=O, timeout=30)
        print(f"::notice title=cors {k}::HTTP {r.status_code} ACAO={r.headers.get('Access-Control-Allow-Origin')} type={r.headers.get('Content-Type','')[:40]} len={len(r.content)} head={r.text[:140]!r}")
    except Exception as e:
        print(f"::notice title=cors {k}::ERR {e}"[:300])
try:
    r = requests.options("https://api.bls.gov/publicAPI/v2/timeseries/data/", headers={**O, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}, timeout=30)
    print(f"::notice title=cors bls_v2_preflight::HTTP {r.status_code} ACAO={r.headers.get('Access-Control-Allow-Origin')} ACAM={r.headers.get('Access-Control-Allow-Methods')}")
except Exception as e:
    print(f"::notice title=cors bls_v2_preflight::ERR {e}")
# StatCan vectors for trade (12-10-0011) and retail (20-10-0056)
vec = {}
for row in U._sc_table(12100011):
    if row.get("GEO") != "Canada": continue
    tr, ba, sa, pa = row.get("Trade", ""), row.get("Basis", ""), row.get("Seasonal adjustment", ""), row.get("Principal trading partners", "")
    if "balance of payments" not in ba.lower() or not sa.lower().startswith("seasonally adjusted") or pa.lower() not in ("all countries", "united states"): continue
    vec[f"trade|{tr}|{pa}"] = row.get("VECTOR")
for row in U._sc_table(20100056):
    if row.get("GEO") != "Canada" or (row.get("Adjustments", "").lower() != "seasonally adjusted"): continue
    nai = next((row[c] for c in row if c.startswith("North American Industry")), "")
    sales = row.get("Sales") or ""
    n = nai.lower()
    if (sales.lower().startswith("total retail") and (n.startswith("retail trade [44-45]") or "[441]" in n or "[457]" in n)) or (sales.lower().startswith("retail e-commerce") and n.startswith("retail trade [44-45]")):
        vec[f"retail|{sales}|{nai}"] = row.get("VECTOR")
print("::notice title=vectors::" + " ;; ".join(f"{k}={v}" for k, v in sorted(vec.items()))[:3900])
