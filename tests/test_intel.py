"""Unit tests for scripts/intel.py (pure functions only; no network). Fixtures are small synthetic tables shaped like the
World Bank Pink Sheet and the FAO CSV, labelled as synthetic - they test parsing and arithmetic, not market facts."""
import datetime as dt
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import intel as I

n = fails = 0


def t(name, fn):
    global n, fails
    n += 1
    try:
        fn()
        print("  ok ", name)
    except Exception as e:
        fails += 1
        print("  FAIL", name, "->", repr(e))


def eq(a, b):
    assert a == b, (a, b)


def assert_(x):
    assert x


def close(a, b, eps=1e-6):
    assert a is not None and abs(a - b) <= eps, (a, b)


print("helpers")
t("month keys from every format the sources use", lambda: [eq(I.month_key(x), "2026-09") for x in ("2026M09", "2026-09", "2026-09-01", "9/1/2026", dt.date(2026, 9, 1))])
t("non-month labels are rejected", lambda: [eq(I.month_key(x), None) for x in ("Description", "", None, "2026M13")])
t("number parser: blanks, dashes, commas", lambda: (eq(I.num("…"), None), eq(I.num("-"), None), close(I.num("1,234.5"), 1234.5), eq(I.num(float("nan")), None)))
t("pct with zero / missing base -> None", lambda: (eq(I.pct(5, 0), None), eq(I.pct(5, None), None), close(I.pct(110, 100), 10.0)))
t("previous month across year end", lambda: (eq(I.prev_month("2026-01"), "2025-12"), eq(I.prev_month("2026-10"), "2026-09")))
t("n-th business day", lambda: eq(I.bizday(2026, 11, 2), dt.date(2026, 11, 3)))
t("first Friday", lambda: eq(I.first_weekday(2026, 11, 4), dt.date(2026, 11, 6)))

print("moves, surprises, revisions")
base = {f"{2024 + (i // 12)}-{i % 12 + 1:02d}": 200 + (i % 2) for i in range(30)}   # quiet series alternating 200/201


def mv_material():
    s = dict(base)
    s["2026-07"] = 230.0   # a large jump after a quiet history
    m = I.stats_move({k: v for k, v in s.items() if k <= "2026-07"})
    eq(m["month"], "2026-07")
    assert m["material"] and m["z"] > I.MATERIAL_Z, m


t("z-score flags a jump as material against its own history", mv_material)
t("short history -> z is None, never invented", lambda: eq(I.stats_move({"2026-08": 1.0, "2026-09": 2.0})["z"], None))
t("one month -> no move", lambda: eq(I.stats_move({"2026-09": 1.0}), None))
t("YoY when the year-ago month exists", lambda: close(I.stats_move({"2025-09": 100.0, "2026-08": 105.0, "2026-09": 110.0})["yoy_pct"], 10.0))
t("revision vs stored snapshot", lambda: eq(I.revisions({"2026-08": 101.0, "2026-09": 105.0}, {"2026-08": 100.0, "2026-09": 105.0}), [{"month": "2026-08", "prev": 100.0, "new": 101.0, "pct": 1.0}]))
t("no stored snapshot -> no revisions", lambda: eq(I.revisions({"2026-08": 101.0}, {}), []))

print("impact rules")


def urea_up():
    imp, overall, conf = I.impact_from_move(I.IND["urea"], {"chg_pct": 8.0, "material": True})
    eq(imp["corn"]["bias"], "bullish")
    eq(imp["soybeans"]["bias"], "bearish")
    eq(overall, "mixed")
    eq(conf, "Medium")   # material but only indirect channels


t("urea up: new-crop corn supportive, soybeans pressured (acreage shift) -> mixed", urea_up)


def maize_material():
    imp, overall, conf = I.impact_from_move(I.IND["maize"], {"chg_pct": -6.0, "material": True})
    eq(imp["corn"]["bias"], "bearish")
    eq(imp["corn"]["strength"], "direct")
    eq(conf, "High")


t("maize down materially: direct bearish corn, High confidence", maize_material)
t("tiny move is neutral", lambda: eq(I.impact_from_move(I.IND["crude"], {"chg_pct": 0.2, "material": False})[1], "neutral"))
t("context series has no crop read", lambda: eq(I.impact_from_move(I.IND["fao_ffpi"], {"chg_pct": 3.0, "material": False})[0], {}))

print("headline classifier")


def h(title):
    return I.classify_headline(title)


t("export ban -> disruption, bullish wheat, Black Sea", lambda: (lambda c: (eq(c["cat"], "disruption"), eq(c["bias"], "bullish"), eq(c["crops"], ["wheat"]), eq(c["regions"], ["Black Sea"])))(h("Russia weighs wheat export ban as harvest disappoints")))
t("ban lifted reads bearish, not bullish", lambda: eq(h("India lifts export ban on wheat flour")["bias"], "bearish"))
t("record crop -> bearish soybeans, Brazil", lambda: (lambda c: (eq(c["bias"], "bearish"), eq(c["crops"], ["soybeans"]), eq(c["regions"], ["Brazil"])))(h("Conab sees record Brazil soybean crop")))
t("forecast cut -> bullish", lambda: eq(h("FAO cuts world cereal production forecast")["bias"], "bullish"))
t("fertilizer price rise maps through acreage channel", lambda: (lambda imp: (eq(imp["corn"]["bias"], "bullish"), eq(imp["soybeans"]["bias"], "bearish")))(I.headline_impact(h("Urea prices jump as China curbs fertilizer exports"))))
t("'despite drought' with a big harvest reads bearish", lambda: eq(h("Virginia corn harvest exceeds expectations despite drought")["bias"], "bearish"))
t("drought insurance / tolerance is not a supply cut", lambda: (eq(h("Government plans drought insurance, 600k-tonne drought grain buffer")["bias"], "neutral"), eq(h("Corn byproduct boosts drought tolerance in tea plants")["bias"], "neutral")))
t("drought damaging a crop reads bullish", lambda: eq(h("Drought slashes Argentine wheat crop")["bias"], "bullish"))
t("falling imports weigh against supply-disruption talk", lambda: eq(h("Turkey wheat imports could fall 56% amid Black Sea supply disruptions")["bias"], "mixed"))
t("no directional phrase -> watch, with no invented direction", lambda: eq(I.overall_of(I.headline_impact(h("World Bank publishes commodity report on wheat"))), "watch"))
t("near-duplicate headlines cluster", lambda: assert_(I.similar("Russia weighs wheat export ban as harvest disappoints", "Russia weighs a wheat export ban as its harvest disappoints")))
t("different stories do not cluster", lambda: assert_(not I.similar("Russia weighs wheat export ban", "Brazil soybean planting runs ahead of pace")))


print("parsers (synthetic fixtures)")
PINK = [["World Bank Commodity Price Data (The Pink Sheet)"], [None], [None, "Crude oil, average", "Natural gas, Europe", "Maize", "Wheat, US HRW", "Soybeans", "Soybean oil", "Palm oil", "Urea ", "DAP"],
        [None, "($/bbl)", "($/mmbtu)", "($/mt)", "($/mt)", "($/mt)", "($/mt)", "($/mt)", "($/mt)", "($/mt)"],
        ["2026M08", 70.1, 11.2, 190.5, 230.0, 400.0, 1100.0, 1000.0, 380.0, 600.0],
        ["2026M09", 68.4, 11.9, 188.0, "…", 405.5, 1120.0, 1010.0, 395.0, 610.0]]


def pink():
    s = I.parse_pinksheet(PINK)
    close(s["maize"]["2026-09"], 188.0)
    close(s["crude"]["2026-08"], 70.1)
    close(s["urea"]["2026-09"], 395.0)          # 'Urea ' header has a trailing space in the source
    assert "2026-09" not in s["wheat"]           # '…' is missing, not zero
    assert "imf_food" not in s


t("Pink Sheet: header found by 'Maize', units row skipped, '…' left missing", pink)
FAO = "FAO Food Price Index\nnominal\nDate,Food Price Index,Meat,Dairy,Cereals,Oils,Sugar\n2026-08,130.1,120,140,110.2,170.4,100\n2026-09,131.0,121,139,111.0,172.0,98\n"


def fao():
    s = I.parse_fao_csv(FAO)
    close(s["fao_cereals"]["2026-09"], 111.0)
    close(s["fao_oils"]["2026-08"], 170.4)
    close(s["fao_ffpi"]["2026-09"], 131.0)


t("FAO CSV: header found by 'Cereals', oils and headline index mapped", fao)
t("FAO next-release date parsed from page text", lambda: eq(I.parse_fao_next("<p>Next release: 6 November 2026</p>"), "2026-11-06"))


def merge():
    wb = {"series": {"maize": {"2026-08": 190.0, "2026-09": 188.0}}}
    imf = {"series": {"maize": {"2026-09": 196.0}, "soybeans": {"2026-09": 405.0}, "imf_food": {"2026-09": 130.0}}}
    m, used, ck = I.merge_series(wb, imf, None)
    eq(used["maize"], "World Bank")
    eq(used["soybeans"], "IMF (backup)")
    eq(used["imf_food"], "IMF")
    eq(ck[0]["flag"], True)                      # 196 vs 188 is > 3%


t("World Bank primary, IMF backup, disagreement flagged", merge)

print(f"\n{n - fails}/{n} passed")
sys.exit(1 if fails else 0)
