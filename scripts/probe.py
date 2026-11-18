"""Ad-hoc source diagnostics (no secrets). Output lands on the sec-audit branch as probe.txt."""
import json, requests
UA = {"User-Agent": "Mozilla/5.0 AGRITrade desk"}
B = "https://www150.statcan.gc.ca/t1/wds/rest/"
for pid in (20100056, 20100067, 14100287, 14100355):
    try:
        r = requests.post(B + "getCubeMetadata", json=[{"productId": pid}], headers=UA, timeout=30)
        o = r.json()[0].get("object") or {}
        print(pid, r.status_code, o.get("cubeTitleEn"), "| archived", o.get("archiveStatusEn"), "| end", o.get("cubeEndDate"), "| released", o.get("releaseTime"))
        if pid in (20100056, 20100067):
            for m in (o.get("member") or [])[:0]: pass
            for d in o.get("dimension", []):
                print("   dim", d.get("dimensionPositionId"), d.get("dimensionNameEn"), [(x.get("memberId"), x.get("memberNameEn")) for x in d.get("member", [])[:12]])
    except Exception as e:
        print(pid, "ERR", e)
    try:
        r = requests.get(B + f"getFullTableDownloadCSV/{pid}/en", headers=UA, timeout=30)
        print("   csv", r.status_code, r.text[:160])
    except Exception as e:
        print("   csv ERR", e)
