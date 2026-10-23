"""Temporary probe 3."""
import json, requests
O = {"Origin": "https://anirudhpdoshi.github.io", "User-Agent": "Mozilla/5.0"}
def show(t, r):
    print(f"::notice title={t}::HTTP {r.status_code} ACAO={r.headers.get('Access-Control-Allow-Origin')} {r.text[:900]!r}")
try:
    r = requests.post("https://api.bls.gov/publicAPI/v1/timeseries/data/", headers={**O, "Content-Type": "text/plain"}, data=json.dumps({"seriesid": ["CUSR0000SA0", "LNS14000000", "CES0000000001"], "startyear": "2025", "endyear": "2026"}), timeout=40)
    j = r.json(); print(f"::notice title=bls_post_textplain::HTTP {r.status_code} ACAO={r.headers.get('Access-Control-Allow-Origin')} status={j.get('status')} msg={j.get('message')} series={[ (s['seriesID'], s['data'][0] if s.get('data') else None) for s in j.get('Results',{}).get('series',[])]}"[:1500])
except Exception as e: print(f"::notice title=bls_post_textplain::ERR {e}")
for t, u in [("nyfed", "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json"),
             ("fedfeed", "https://www.federalreserve.gov/feeds/press_monetary.xml"),
             ("mts1", "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1?filter=record_date:eq:2026-09-30&page[size]=40&fields=record_date,classification_desc,current_month_gross_rcpt_amt,current_month_gross_outly_amt,current_month_dfct_sur_amt,sequence_number_cd,record_type_cd")]:
    try: show(t, requests.get(u, headers=O, timeout=40))
    except Exception as e: print(f"::notice title={t}::ERR {e}")
