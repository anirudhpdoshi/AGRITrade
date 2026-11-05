import json,os,re,time,urllib.request as U
def get(u,h=None):
    r=U.Request(u,headers=h or {"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537"});return U.urlopen(r,timeout=30).read()
try:
    t=get("https://www.ici.org/research/stats/combined_flows").decode("utf8","ignore");print("ICI",len(t));i=t.find("<table");print(re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",t[i:i+5000]))[:1500]);print(sorted(set(re.findall(r'href="([^"]+\.(?:xlsx?|csv|pdf))"',t)))[:8])
except Exception as e: print("ICI fail",e)
try:
    h=get("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv").decode().splitlines();print(h[0],len(h))
except Exception as e: print(e)
import yfinance as yf
syms=[l.split(",")[0].replace(".","-") for l in h[1:]];t0=time.time()
d=yf.download(syms,period="13mo",interval="1d",auto_adjust=False,progress=False,threads=True)["Close"];print("yf",d.shape,round(time.time()-t0),"s lastrow nonnull",int(d.iloc[-1].notna().sum()),d.index[-1])
UA={"User-Agent":"AGRITrade desk "+os.environ.get("SEC_CONTACT",""),"Accept-Encoding":"identity"}
for cik,n in (("0000789019","MSFT"),("0001769628","CRWV"),("0001341439","ORCL")):
    try:
        f=json.loads(get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",UA))["facts"]["us-gaap"]
        for tag in ["LongTermDebt","LongTermDebtNoncurrent","DebtInstrumentCarryingAmount","LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths","LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo","LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive","ProceedsFromIssuanceOfLongTermDebt","ProceedsFromIssuanceOfDebt","ProceedsFromIssuanceOfCommonStock","InterestExpense","InterestExpenseDebt","DebtWeightedAverageInterestRate","LongTermDebtFairValue"]:
            x=f.get(tag);v=(x or {}).get("units",{}).get("USD") or (x or {}).get("units",{}).get("pure")
            print(n,tag,(v[-1]["end"],v[-1]["val"],v[-1].get("form")) if v else None)
    except Exception as e: print(n,"fail",e)
    time.sleep(.3)
