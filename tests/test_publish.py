"""Every local script / data file the page loads must be in scripts/build_site.py FILES, or the live site never gets it
(cpi-ui.js shipped missing on Nov 10: the page worked locally and was blank live)."""
import re, sys, ast
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text()
src = (ROOT / "scripts" / "build_site.py").read_text()
files = set(ast.literal_eval(re.search(r"^FILES = (\[.*?\])", src, re.M | re.S).group(1)))
refs = set(re.findall(r'src="([a-z0-9-]+\.js)', html)) | set(re.findall(r'\.src="([a-z0-9-]+\.js)', html))
refs.discard("config.js")   # written by build_site.py itself
missing = sorted(r for r in refs if r not in files)
# the passcode check is the sealed vault; no passcode hash may ship in the page (unsalted SHA-256 was removed Nov 10)
if re.search(r"var HASH=|\b[0-9a-f]{64}\b", html[html.find("gateOverlay") - 2000:html.find("gateOverlay") + 8000]):
    print("FAIL passcode hash found near the gate"); missing.append("gate-hash")
for r in sorted(refs):
    print(("FAIL " if r in missing else "PASS ") + r)
print(f"{len(refs) - len(missing)}/{len(refs)} passed")
sys.exit(1 if missing else 0)
