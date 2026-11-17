"""Exhibit 99.1 found by its type in the filing index when the file is not named ex99 (NVIDIA: q3fy27pr.htm)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import pr_parse as P

H = ('<table><tr><td>1</td><td>8-K</td><td><a href="/Archives/x/nvda-20261117.htm">nvda-20261117.htm</a></td><td>8-K</td></tr>'
     '<tr><td>2</td><td>PR</td><td><a href="/Archives/x/q3fy27pr.htm">q3fy27pr.htm</a></td><td>EX-99.1</td></tr>'
     '<tr><td>3</td><td>CFO</td><td><a href="/Archives/x/q3fy27cfocommentary.htm">c</a></td><td>EX-99.2</td></tr></table>')
assert P.exhibit_by_type(H) == "q3fy27pr.htm"
assert P.exhibit_by_type(H.replace("EX-99.1", "EX-99.3")) == "q3fy27cfocommentary.htm"
assert P.exhibit_by_type("") is None
print("test_exhibit_type: 3/3 passed")

# NVIDIA-style release: a summary table in $ billions with gross margin in %, then the full statement in $ millions
NV = ("<table><tr><td>($ in billions, except earnings per share)</td><td>Q3 FY27</td><td>Q3 FY26</td></tr>"
      "<tr><td>Revenue</td><td>$115.8</td><td>$57.0</td></tr><tr><td>Gross margin</td><td>74.8%</td><td>73.4%</td></tr>"
      "<tr><td>Net income</td><td>$65.3</td><td>$31.9</td></tr></table>"
      "<table><tr><td>(In millions, except per share data)</td><td>Oct 25, 2026</td><td>Oct 26, 2025</td></tr>"
      "<tr><td>Revenue</td><td>$ 115,844</td><td>$ 57,006</td></tr><tr><td>Cost of revenue</td><td>29,190</td><td>15,157</td></tr>"
      "<tr><td>Gross profit</td><td>86,654</td><td>41,849</td></tr><tr><td>Net income</td><td>$ 65,312</td><td>$ 31,910</td></tr>"
      "<tr><td>Net income per share:</td></tr><tr><td>Diluted</td><td>$ 2.70</td><td>$ 1.30</td></tr></table>")
o = P.parse(NV)
assert abs(o["rev"] - 115.844e9) < 1e6 and abs(o["ni"] - 65.312e9) < 1e6, o
assert abs(o["gm"] - 74.8) < 0.1 and o["eps_d"] == 2.7, o
print("test_exhibit_type: NVIDIA layout passed")
