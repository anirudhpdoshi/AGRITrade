"""Manual check (workflow 'Symbol check'): which Yahoo symbols return fresh intraday bars from a GitHub runner.
Prints last value, bar time and prior close for each candidate - used to decide what can feed the desk live."""
import sys
from datetime import datetime, timezone
import yfinance as yf

C = sys.argv[1:] or ["^IRX", "^FVX", "^TNX", "^TYX", "2YY=F", "5YY=F", "10Y=F", "30Y=F", "ZT=F", "ZF=F", "ZN=F", "TN=F", "ZB=F", "UB=F",
                     "CGB=F", "CGF=F", "CGZ=F", "CGB.TO", "^CA10Y", "CA10Y=RR", "XBB.TO", "ZFL.TO", "CLF.TO"]
def out(line):
    print(line)
    print("::notice title=symbol::" + line)


for s in C:
    try:
        t = yf.Ticker(s)
        h = t.history(period="2d", interval="5m")
        d = t.history(period="7d", interval="1d")
        if h.empty:
            out(f"{s} NO INTRADAY BARS (daily rows: {len(d)})")
            continue
        ts = h.index[-1].to_pydatetime().astimezone(timezone.utc)
        age = (datetime.now(timezone.utc) - ts).total_seconds() / 60
        prev = float(d["Close"].iloc[-2]) if len(d) >= 2 else None
        out(f"{s} last {float(h['Close'].iloc[-1]):.4f} bar {ts:%Y-%m-%d %H:%M}Z ({age:.0f} min) prev close {prev}")
    except Exception as e:
        out(f"{s} ERROR {type(e).__name__}: {str(e)[:100]}")
