"""Unit tests for scripts/global_grains.py (pure functions; CONAB fixture = real Oct 2026 survey rows, labelled as recorded data)."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import global_grains as G
FX = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "conab_oct2026.json")))
n = fails = 0
def t(name, fn):
    global n, fails
    n += 1
    try:
        fn(); print("  ok ", name)
    except Exception as e:
        fails += 1; print("  FAIL", name, "->", repr(e))
def close(a, b, eps=1e-6): assert a is not None and abs(a - b) <= eps, (a, b)

print("arithmetic")
t("share = part / total x 100", lambda: close(G.share(43000, 210719), 20.41, 0.01))
t("share with no total -> None (never 0)", lambda: (G.share(5, 0) is None) or (_ for _ in ()).throw(AssertionError()))
t("YoY change", lambda: close(G.pct_change(407281, 430896), -5.48, 0.01))
t("YoY with missing previous -> None", lambda: (G.pct_change(10, None) is None) or (_ for _ in ()).throw(AssertionError()))
t("stocks-to-use = ending / (domestic + exports)", lambda: close(G.stocks_to_use(50, 400), 12.5))
t("revision vs stored snapshot", lambda: (lambda r: (close(r["d"], 2.5), close(r["pct"], 1.82, 0.01)))(G.revision(140.0, 137.5)))
t("no stored snapshot -> no revision (not invented)", lambda: (G.revision(140.0, None) is None) or (_ for _ in ()).throw(AssertionError()))
t("market-year label 2026 -> 2026/27", lambda: (G.season_label(2026) == "2026/27") or (_ for _ in ()).throw(AssertionError()))
t("number parser: comma decimals, blanks", lambda: (close(G.num("5,5"), 5.5), G.num("") is None))

print("apply_revisions")
def ar():
    blk = {"release": "2026-11", "world": {"prod": 300.0}, "countries": [{"code": "BR", "cur": {"prod": 140.0, "exp": 45.0}}, {"code": "XX", "cur": {"prod": 10.0, "exp": 0.0}}]}
    G.apply_revisions(blk, {"BR": {"prod": 139.0, "exp": 43.0}}, "2026-10")
    close(blk["countries"][0]["rev_prod"]["d"], 1.0); close(blk["countries"][0]["rev_exp"]["d"], 2.0)
    assert blk["countries"][1]["rev_prod"] is None, "country missing from snapshot -> no revision"
    assert blk["rev_vs"] == "2026-10" and blk["rev_note"] is None
t("revisions from the earlier release, per country", ar)
def ar0():
    blk = {"release": "2026-10", "world": {"prod": 1.0}, "countries": [{"code": "BR", "cur": {"prod": 1.0, "exp": 1.0}}]}
    G.apply_revisions(blk, None, None); assert blk["countries"][0]["rev_prod"] is None and "next USDA release" in blk["rev_note"]
t("first capture: no revision, clear note", ar0)

print("CONAB parsing (recorded Oct 2026 1st survey)")
def corn():
    p = G.parse_conab_sheet(FX["milho_total"]); b = p["rows"]["BRASIL"]
    assert p["seasons"] == ["25/26", "26/27"], p["seasons"]
    close(b["prod"][0], 144499, 0.5); close(b["prod"][1], 148015.9, 0.5); close(b["area"][1], 23704.7, 0.5)
    assert "MT" in p["rows"] and "PR" in p["rows"]
t("corn total: Brazil row, both seasons, states", corn)
t("soybeans: Brazil 2026/27 = 181,616.6 kt", lambda: close(G.parse_conab_sheet(FX["soja"])["rows"]["BRASIL"]["prod"][1], 181616.6, 0.5))
t("wheat: calendar-year seasons 2025 / 2026", lambda: (G.parse_conab_sheet(FX["trigo"])["seasons"] == ["2025", "2026"]) or (_ for _ in ()).throw(AssertionError()))
def sup():
    m = G.parse_conab_supply(FX["suprimento"], "MILHO")
    last = m[-1]; assert last["season"] == "2026/27" and last["survey"] == "out/26", last
    close(last["prod"], 148015.9, 0.5); close(last["end"], 165760.2 - 150827.9, 0.5)
    w = G.parse_conab_supply(FX["suprimento"], "TRIGO")
    assert [r["survey"] for r in w[-2:]] == ["set/26", "out/26"], "wheat keeps both surveys (revision source)"
    assert w[-1]["season"] == w[-2]["season"], "blank season cell inherits the row above"
t("supply sheet: corn block, ending stocks, wheat survey rows", sup)
def soy():
    s = G.parse_conab_soy_supply(FX["suprimento_soja"])
    k = [x for x in s if "estoque inicial" in x][0]; close(s[k]["2026/27"], 9529.67, 0.05)
t("soy supply sheet: beginning stocks 2026/27", soy)
def _raises(f):
    try: f(); return False
    except ValueError: return True
t("missing header -> clear error", lambda: _raises(lambda: G.parse_conab_sheet([["x"], ["y"]])) or (_ for _ in ()).throw(AssertionError()))
print("\n%d/%d passed" % (n - fails, n)); sys.exit(1 if fails else 0)
