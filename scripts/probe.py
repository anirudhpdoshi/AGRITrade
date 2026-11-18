"""Ad-hoc source diagnostics (no secrets). Output lands on the sec-audit branch as probe.txt."""
import requests
U = "https://www150.statcan.gc.ca/t1/wds/rest/getCubeMetadata"
HS = {"none": {}, "requests": None, "desk": {"User-Agent": "AGRITrade desk research (github.com/anirudhpdoshi/AGRITrade)"},
      "chrome": {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
                 "Accept": "application/json, text/plain, */*", "Accept-Language": "en-CA,en;q=0.9"}}
for k, h in HS.items():
    for meth in ("post", "get"):
        try:
            if meth == "post":
                r = requests.post(U, json=[{"productId": 14100287}], headers=h, timeout=30)
            else:
                r = requests.get("https://www150.statcan.gc.ca/t1/wds/rest/getSeriesInfoFromVector", headers=h, timeout=30)
            print(k, meth, r.status_code, r.text[:90].replace("\n", " "))
        except Exception as e:
            print(k, meth, "ERR", e)
for url in ("https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410028701", "https://www.statcan.gc.ca/en/start", "https://api.statcan.gc.ca/"):
    try:
        r = requests.get(url, timeout=30); print(url, r.status_code, r.text[:80].replace("\n", " "))
    except Exception as e:
        print(url, "ERR", e)
