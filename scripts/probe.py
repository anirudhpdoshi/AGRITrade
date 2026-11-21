"""Ad-hoc source diagnostics (no secrets). Output lands on the sec-audit branch as probe.txt."""
import requests, time
B = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
for q in [dict(reporterCode="124", period="2024", partnerCode="0", flowCode="X", cmdCode="7108"),
          dict(reporterCode="124", period="2024", flowCode="X", cmdCode="7108"),
          dict(reporterCode="124", period="2023,2024", partnerCode="0", flowCode="X", cmdCode="7108,7106"),
          dict(reporterCode="124", period="2025", partnerCode="0", flowCode="X", cmdCode="7108"),
          dict(reporterCode="124", period="2024", flowCode="X", cmdCode="7108", partnerCode=None)]:
    q = {k: v for k, v in q.items() if v is not None}
    try:
        r = requests.get(B, params=q, timeout=60); print("CT", q, r.status_code, r.text[:400].replace("\n", " "))
    except Exception as e:
        print("CT ERR", e)
    time.sleep(4)
r = requests.get("https://comtradeapi.un.org/public/v1/preview/C/M/HS", params=dict(reporterCode="124", period="202608", partnerCode="0", flowCode="X", cmdCode="7108"), timeout=60)
print("CTM", r.status_code, r.text[:300])
for u in ["https://prod-natural-resources.azure.cloud.nrcan-rncan.gc.ca/maps-tools-publications/publications/mineral-trade",
          "https://natural-resources.canada.ca/maps-tools-publications/publications/mineral-trade"]:
    try:
        r = requests.get(u, timeout=60, headers={"User-Agent": "Mozilla/5.0"}); print("NR", u, r.status_code, len(r.text))
        import re
        for h in sorted(set(re.findall(r'href="([^"]+)"', r.text))):
            if re.search(r"xls|csv|trade|pdf|minerals", h, re.I): print("   ", h)
    except Exception as e:
        print("NR ERR", u, e)
