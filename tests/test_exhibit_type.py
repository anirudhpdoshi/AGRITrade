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
