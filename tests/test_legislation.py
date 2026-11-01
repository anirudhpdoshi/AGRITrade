"""Legislation parsers (no network): Commons sitting calendar, LEGISinfo rows, House floor pages, Congress.gov bills."""
import datetime as dt, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
os.environ["CONGRESS_API_KEY"] = "TESTKEY"
import legislation as L

n = 0
def ok(c, m):
    global n
    assert c, m
    n += 1

H = ('<li> For November 2026: <ul class="list-unstyled" aria-label="Sitting days:"> <li>Monday, November 2</li> <li>Friday, November 6</li> '
     '<li>Monday, November 16</li> </ul> </li> <li> For December 2026: <ul class="list-unstyled" aria-label="Adjournment tabling days:"> <li>Wednesday, December 16</li> </ul> '
     '<ul class="list-unstyled" aria-label="Sitting days:"> <li>Tuesday, December 1</li> <li>Friday, December 11</li> </ul> </li> <li> For January 2027: <ul class="list-unstyled" aria-label="Sitting days:"> <li>Monday, January 25</li> </ul></li>')
C = L.ca_calendar(H, dt.date(2026, 11, 1))
ok(C["next"][:2] == ["2026-11-02", "2026-11-06"] and C["last"] == "2027-01-25", f"sitting days parsed per month, adjournment days ignored: {C}")
ok(any(b["returns"] == "2026-11-16" for b in C["breaks"]) and any(b["returns"] == "2027-01-25" for b in C["breaks"]), "constituency weeks and the winter break found")
now = dt.datetime(2026, 11, 1, 12)
rows = [{"NumberCode": "C-15", "ShortTitle": "Budget Implementation Act, 2026", "IsGovernmentBill": True, "LatestCompletedMajorStageNameWithChamberSuffix": "Second reading in the House of Commons",
         "PassedHouseSecondReadingDateTime": "2026-10-28T15:00:00-04:00", "ParliamentNumber": 45, "SessionNumber": 1},
        {"NumberCode": "C-294", "ShortTitle": "Hungarian Heritage Month Act", "IsGovernmentBill": False, "PassedHouseFirstReadingDateTime": "2026-09-01T11:00:00-04:00", "LatestBillEventDateTime": "0001-01-01T00:00:00"},
        {"NumberCode": "C-4", "ShortTitle": "Customs Tariff amendments", "IsGovernmentBill": True, "ReceivedRoyalAssentDateTime": "2026-06-20T10:00:00-04:00", "ParliamentNumber": 45, "SessionNumber": 1}]
B = L.ca_bills(rows, now)
ok([b["code"] for b in B] == ["C-15", "C-4"], f"government bills kept, idle private bills dropped, recently moved first: {[b['code'] for b in B]}")
ok(B[0]["moved"] and "Budget & tax" in B[0]["topics"] and B[0]["url"].endswith("/45-1/c-15"), "topic, movement flag and LEGISinfo link")
ok("Trade & tariffs" in B[1]["topics"] and B[1]["assent"], "royal assent flagged")
ml = ("<h1>Daily Schedule</h1> <p>TUESDAY, OCTOBER 27</p><p>On Tuesday, the House will meet at 10:00 a.m.</p> Legislation Considered Under Suspension of the Rules: "
      "H.R. 9497 – Water Resources Development Act of 2026, as amended (Sponsored by Rep. Graves) H.R. 5334 – Sanctioning Russia Act (Sponsored by Rep. X)")
F = L.house_floor_ml(ml, dt.date(2026, 10, 29))
ok(F and not F["stale"] and F["items"][0]["code"] == "H.R. 9497" and "Transport" in F["items"][0]["topics"], f"Majority Leader schedule parsed: {F}")
ok(L.house_floor_ml(ml, dt.date(2026, 11, 20))["stale"], "a schedule older than a week is marked stale (House not sitting)")
xml = '<?xml version="1.0"?><floorschedule><category><floor-items><floor-item><legis-num>H.R. 1</legis-num><floor-text>Farm, Food, and National Security Act</floor-text></floor-item></floor-items></category></floorschedule>'
ok(L.house_floor_xml(xml)[0]["topics"] == ["Agriculture"] or "Agriculture" in L.house_floor_xml(xml)[0]["topics"], "docs.house.gov XML parsed")
items = [{"type": "HR", "number": "7954", "congress": 119, "title": "Farm bill extension", "originChamber": "House", "latestAction": {"actionDate": "2026-10-29", "text": "Passed House by voice vote."}},
         {"type": "S", "number": "2667", "congress": 119, "title": "Something", "latestAction": {"actionDate": "2025-08-01", "text": "Read twice and referred"}},
         {"type": "HRES", "number": "1", "congress": 119, "title": "Honoring a team", "latestAction": {"actionDate": "2026-10-30", "text": "Agreed to without objection."}}]
U = L.us_bills(items, dt.date(2026, 11, 1))
ok(len(U) == 1 and U[0]["code"] == "H.R. 7954" and U[0]["url"] == "https://www.congress.gov/bill/119th-congress/house-bill/7954", f"recent significant actions only, commemorative resolutions dropped: {U}")
ok("TESTKEY" not in L.scrub(RuntimeError("401 for url ?api_key=TESTKEY")), "key scrubbed from errors")
print(f"{n}/{n} passed")
