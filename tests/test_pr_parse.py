"""Press-release statement reader: labels, units, prior-year-first column order, derived margins."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import pr_parse as P  # noqa: E402

h = """<p>(In millions, except per share amounts)</p><table><tr><td></td><td>Three Months Ended September 30,</td></tr><tr><td></td><td>2025</td><td>2026</td></tr>
<tr><td>Total net sales</td><td>$</td><td>158,877</td><td>$</td><td>180,169</td></tr><tr><td>Cost of sales</td><td>80,000</td><td>88,670</td></tr>
<tr><td>Operating income</td><td>17,411</td><td>17,422</td></tr><tr><td>Net earnings attributable to controlling interests</td><td>(15)</td><td>21,187</td></tr>
<tr><td>Diluted earnings per share</td><td>1.6</td><td>1.95</td></tr></table>"""
o = P.parse(h)
checks = [(o.get("rev") == 180169e6, "latest-year column when the prior year comes first"), (o.get("gp") == 91499e6, "gross profit derived from revenue - cost"),
          (o.get("ni") == 21187e6, "'net earnings attributable to' read as net income"), (o.get("eps_d") == 1.95, "diluted EPS"), (o.get("gm") == 50.79, "gross margin %")]
h2 = h.replace("<td>2025</td><td>2026</td>", "<td>2026</td><td>2025</td>").replace("158,877</td><td>$</td><td>180,169", "180,169</td><td>$</td><td>158,877")
checks.append((P.parse(h2).get("rev") == 180169e6, "current-year-first order too"))
for c, m in checks:
    print(("PASS " if c else "FAIL ") + m)
print(f"{sum(c for c, _ in checks)}/{len(checks)} passed")
sys.exit(0 if all(c for c, _ in checks) else 1)
