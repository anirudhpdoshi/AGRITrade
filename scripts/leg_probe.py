"""One-off probe of the legislation sources (annotations; never prints the key)."""
import os, re, json, requests
K = os.environ.get("CONGRESS_API_KEY", "").strip()
UA = {"User-Agent": "Mozilla/5.0 (desk briefing)"}
def note(t, body):
    b = " ".join(str(body).split()).replace("%", "%25").replace(":", "%3A").replace(",", "%2C").replace("\r", "")
    print(f"::notice title={t.replace(':', '').replace(',', ' ')}::{b[:3500]}")
j = requests.get("https://www.parl.ca/legisinfo/en/bills/json", headers=UA, timeout=40).json()
note("legisinfo keys n=%d" % len(j), json.dumps({k: v for k, v in j[-1].items() if not k.endswith("Fr")})[:3400])
h = requests.get("https://www.ourcommons.ca/en/sitting-calendar", headers=UA, timeout=30).text
i = h.find("November"); note("commons calendar", re.sub(r"\s+", " ", h[i-1500:i+1500]))
ml = requests.get("https://www.majorityleader.gov/schedule/", headers=UA, timeout=30).text
t = re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", ml)); i = t.find("House will")
note("majority leader", t[max(0,i-400):i+1500])
if K:
    for path in ["bill?format=json&limit=2&sort=updateDate+desc", "committee-meeting/119?format=json&limit=2", "house-vote/119/2?format=json&limit=2", "daily-congressional-record?format=json&limit=1"]:
        r = requests.get("https://api.congress.gov/v3/" + path, params={"api_key": K}, timeout=25)
        note(f"congress {path[:30]} {r.status_code}", r.text[:2500])
else:
    note("congress", "no key")
