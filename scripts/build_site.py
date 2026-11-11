#!/usr/bin/env python3
"""Publish step (GitHub Actions only): copy the site into _site/ and write config.js.

Browser keys are NEVER published in plain text. The Finnhub key is sealed with AES-256-GCM under a key derived from the
desk passcode (PBKDF2-HMAC-SHA256, 600,000 iterations, random salt) — the page decrypts it in memory only after the
correct passcode is entered and wipes it on lock. The same vault is the passcode check: no hash of the passcode is
published. The build fails if a raw key appears anywhere in the output."""
import base64, hashlib, json, os, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
FILES = ["index.html", "live.js", "direct.js", "motion.js", "fwd.js", "world-ui.js", "kb.js", "gg-ui.js", "events-ui.js", "fed-ui.js", "cpi-ui.js", "pricechart-ui.js", "narrative-ui.js", "nav-ui.js", "macro-table.js", "usm-nav.js", "health-ui.js", "intel-ui.js", "policy-ui.js", "briefing-ui.js", "glossary.js", "season.js", "feed-rail.js", "grains-ui.js", "rows-ui.js", "obs-ui.js", "swot-ui.js", "tabs-ui.js", "optflow-ui.js", "macro-ind.js", "earnings-ui.js", "tracker-ui.js", "treasury-ui.js", "co-engine.js", "company-ui.js", "world-paths.json", "data.json"]


def b64(b):
    return base64.b64encode(b).decode()


ITER = 600000   # PBKDF2-HMAC-SHA256 work factor (OWASP 2023 guidance)


def seal(pw, key):
    """The passcode gate and the stream key share one sealed vault: the page opens only if the passcode decrypts it
    (AES-256-GCM is authenticated, so a wrong passcode fails). No hash of the passcode is published anywhere.
    No DESK_PASSCODE secret -> no vault -> the desk stays locked (fails closed)."""
    if not pw:
        print("::warning title=desk gate::DESK_PASSCODE secret missing - desk cannot be unlocked")
        return None
    payload = {"gate": 1}
    if not key:
        print("::notice title=stream key::not set - live stream disabled")
    elif not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", key):
        print("::notice title=stream key::unexpected format - not published")
    else:
        payload["finnhub"] = key
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    salt, iv = os.urandom(16), os.urandom(12)
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode())
    ct = AESGCM(k).encrypt(iv, json.dumps(payload).encode(), b"desk-vault-v1")
    print("::notice title=desk gate::sealed (PBKDF2 " + str(ITER) + ", AES-256-GCM" + (", stream key inside" if "finnhub" in payload else "") + ")")
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


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


def stamp_version():
    """Code version = hash of the published code files (not data). The page compares it with version.json every
    two minutes and offers a one-click reload when a newer build is live, so an open tab never runs stale code."""
    h = hashlib.sha256()
    for f in FILES:
        if f != "data.json":
            h.update((ROOT / f).read_bytes())
    v = h.hexdigest()[:12]
    page = (OUT / "index.html").read_text()
    page, n = re.subn(r'window\.DESK_BUILD="[^"]*"', 'window.DESK_BUILD="' + v + '"', page, count=1)
    if n != 1:
        sys.exit("ABORT: DESK_BUILD marker not found in index.html")
    (OUT / "index.html").write_text(page)
    (OUT / "version.json").write_text(json.dumps({"v": v}) + "\n")
    print("::notice title=version::" + v)


def main():
    OUT.mkdir(exist_ok=True)
    for f in FILES:
        shutil.copy(ROOT / f, OUT / f)
    refresh_fallback()
    stamp_version()
    key = os.environ.get("FINNHUB_API_KEY", "").strip()
    pw = os.environ.get("DESK_PASSCODE", "").strip()
    vault = seal(pw, key)
    (OUT / "config.js").write_text("window.DESK_VAULT=" + json.dumps(vault) + ";\n")
    # hard guard: no secret may appear in anything we publish
    secrets_ = [key, pw, os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()]
    if pw:   # nor any plain hash of the passcode
        secrets_ += [hashlib.sha256(pw.encode()).hexdigest(), hashlib.sha1(pw.encode()).hexdigest(), hashlib.md5(pw.encode()).hexdigest()]
    for s in filter(None, secrets_):
        for p in OUT.rglob("*"):
            if p.is_file() and s in p.read_text(errors="ignore"):
                sys.exit(f"ABORT: a secret value was found in {p.name} - nothing published")
    print("::notice title=published::", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
