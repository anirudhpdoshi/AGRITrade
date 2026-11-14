"""Shared network hygiene for every desk job: one place that knows the secrets and how to keep them out of
logs, error messages and the public data files.

redact(text)   strips every secret value (and any key-like URL parameter) from text before it is printed or stored.
sec_ua(...)    the SEC fair-access User-Agent; the contact comes from the SEC_CONTACT secret, never from the repo.
"""
import os
import re

# Every secret the workflows pass in. Add new ones here and they are redacted everywhere.
SECRET_ENV = ("FMP", "FINNHUB_API_KEY", "BEA_API_KEY", "ALPHAVANTAGE_API_KEY", "CONGRESS_API_KEY", "FAS_API_KEY",
              "DESK_PASSCODE", "SEC_CONTACT")
_PARAM = re.compile(r"(?i)(apikey|api_key|token|key|userid)=[^&\s'\"]+")
SEC_BASE = "AGRITrade desk"


def redact(text):
    """Strip every secret value from text that may reach logs or the public data files."""
    text = str(text)
    for n in SECRET_ENV:
        v = os.environ.get(n, "").strip()
        if len(v) >= 4:
            text = text.replace(v, "***")
    return _PARAM.sub(r"\1=***", text)


def sec_contact():
    return os.environ.get("SEC_CONTACT", "").strip()


def sec_ua(**extra):
    """User-Agent for sec.gov / data.sec.gov. Without the secret it is just the desk name (SEC then refuses, by design)."""
    return {"User-Agent": (SEC_BASE + " " + sec_contact()).strip(), **extra}
