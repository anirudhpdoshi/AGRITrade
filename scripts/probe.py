"""Ad-hoc source diagnostics (no secrets). Output lands on the sec-audit branch as probe.txt."""
import requests, time
P = "https://agritrade-statcan.anirudh-p-doshi.workers.dev"
time.sleep(5)
for i in range(3):
    try:
        r = requests.post(P + "/wds/getCubeMetadata", json=[{"productId": 14100287}], timeout=40)
        print("meta", r.status_code, r.text[:200].replace("\n", " ")); break
    except Exception as e:
        print("ERR", e); time.sleep(10)
r = requests.get(P + "/wds/getFullTableDownloadCSV/20100056/en", timeout=40); print("csv", r.status_code, r.text[:200])
try:
    u = r.json()["object"]; z = requests.get(P + "/file", params={"u": u}, timeout=120, stream=True); print("zip", z.status_code, z.headers.get("content-length"), z.headers.get("content-type"))
except Exception as e:
    print("zip ERR", e)
