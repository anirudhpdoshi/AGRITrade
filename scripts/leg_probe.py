"""One-off probe of the legislation sources (prints status and the start of each response; never prints the key)."""
import os, requests, datetime as dt
K = os.environ.get("CONGRESS_API_KEY", "").strip()
UA = {"User-Agent": "Mozilla/5.0 (desk briefing)"}
mon = dt.date.today() + dt.timedelta(days=(7 - dt.date.today().weekday()) % 7)
mon0 = dt.date.today() - dt.timedelta(days=dt.date.today().weekday())
def note(t, body):
    b = " ".join(str(body).split()).replace("%", "%25").replace(":", "%3A").replace(",", "%2C")
    print(f"::notice title={t.replace(':', '').replace(',', ' ')}::{b}")


U = [
    "https://www.parl.ca/legisinfo/en/bills/json",
    "https://www.parl.ca/legisinfo/en/bills/json?parlsession=45-1",
    "https://www.parl.ca/LegisInfo/en/overview/json",
    "https://www.ourcommons.ca/en/sitting-calendar",
    "https://www.ourcommons.ca/DocumentViewer/en/house/latest/projected-order-of-business",
    "https://sencanada.ca/en/calendar/",
    f"https://docs.house.gov/floor/Download.aspx?file=/billsthisweek/{mon:%Y%m%d}/{mon:%Y%m%d}.xml",
    f"https://docs.house.gov/floor/Download.aspx?file=/billsthisweek/{mon0:%Y%m%d}/{mon0:%Y%m%d}.xml",
    "https://www.senate.gov/legislative/schedule/floor_schedule.htm",
    "https://www.majorityleader.gov/schedule/",
]
for u in U:
    try:
        r = requests.get(u, headers=UA, timeout=25)
        note(f"{u[-60:]} {r.status_code} {r.headers.get('Content-Type')} {len(r.content)}", r.text[:600])
    except Exception as e:
        note(u[-60:], type(e).__name__)
if K:
    for path in ["bill?format=json&limit=3&sort=updateDate+desc", "committee-meeting/119?format=json&limit=3", "house-vote/119/1?format=json&limit=2"]:
        r = requests.get("https://api.congress.gov/v3/" + path, params={"api_key": K}, timeout=25)
        note(f"congress {path[:40]} {r.status_code}", r.text[:900])
else:
    print("no CONGRESS_API_KEY")
