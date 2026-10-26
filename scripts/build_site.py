#!/usr/bin/env python3
"""Publish step (GitHub Actions only): copy the site into _site/ and write config.js.

Browser keys are NEVER published in plain text. The Finnhub key is sealed with AES-256-GCM under a key derived from the
desk passcode (PBKDF2-HMAC-SHA256, 310,000 iterations, random salt) — the page decrypts it in memory only after the
correct passcode is entered and wipes it on lock. If the passcode secret is missing or does not match the gate, nothing
is published. The build fails if a raw key appears anywhere in the output."""
import base64, hashlib, json, os, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
FILES = ["index.html", "live.js", "direct.js", "motion.js", "fwd.js", "world-ui.js", "kb.js", "data.json"]


def b64(b):
    return base64.b64encode(b).decode()


def refresh_fallback():
    """index.html embeds a copy of DATA/NEWS that is used only if data.json cannot be fetched. Overwrite that copy
    with the current data.json at publish time so the fallback is never older than the latest deploy."""
    doc = json.loads((ROOT / "data.json").read_text())
    page = (OUT / "index.html").read_text()
    for name in ("DATA", "NEWS"):
        if name not in doc:
            continue
        blob = json.dumps(doc[name], ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        page, n = re.subn(r"(?m)^var " + name + r" = .*;$", lambda _m: "var " + name + " = " + blob + ";", page, count=1)
        if n != 1:
            sys.exit(f"ABORT: embedded {name} fallback not found in index.html")
    (OUT / "index.html").write_text(page)
    print("::notice title=fallback::embedded DATA/NEWS refreshed from data.json")


def main():
    OUT.mkdir(exist_ok=True)
    for f in FILES:
        shutil.copy(ROOT / f, OUT / f)
    refresh_fallback()
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    pw = os.environ.get("DESK_PASSCODE", "").strip()
    gate = re.search(r'var HASH="([0-9a-f]{64})"', (ROOT / "index.html").read_text()).group(1)
    vault = None
    if not key:
        print("::notice title=stream key::not set - live stream disabled")
    elif not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", key):
        print("::notice title=stream key::unexpected format - not published")
    elif not pw:
        print("::notice title=stream key::DESK_PASSCODE secret missing - key NOT published")
    elif hashlib.sha256(pw.encode()).hexdigest() != gate:
        print("::notice title=stream key::DESK_PASSCODE does not match the desk passcode - key NOT published")
    else:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes
        salt, iv, it = os.urandom(16), os.urandom(12), 310000
        k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode())
        ct = AESGCM(k).encrypt(iv, json.dumps({"finnhub": key}).encode(), b"desk-vault-v1")
        vault = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": it, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}
        print("::notice title=stream key::sealed (AES-256-GCM, passcode-derived key)")
    (OUT / "config.js").write_text("window.DESK_VAULT=" + json.dumps(vault) + ";\n")
    # hard guard: no secret may appear in anything we publish
    for s in filter(None, [key, pw, os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()]):
        for p in OUT.rglob("*"):
            if p.is_file() and s in p.read_text(errors="ignore"):
                sys.exit(f"ABORT: a secret value was found in {p.name} - nothing published")
    print("::notice title=published::", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
