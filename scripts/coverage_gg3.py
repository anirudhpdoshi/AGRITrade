"""Coverage round 3: Comex Stat with backoff + smaller query; CONAB 'Suprimento' sheet; crop-progress page structure."""
import io, json, os, re, time, datetime as dt
import requests, openpyxl
OUT = os.path.join(os.path.dirname(__file__), "..", "coverage")
UA = {"User-Agent": "Mozilla/5.0 (desk coverage check)", "Accept": "application/json"}
R = {"run_at": dt.datetime.utcnow().isoformat() + "Z", "comex": {}, "suprimento": None, "progress": {}}
C = "https://api-comexstat.mdic.gov.br"
for ncm, name in [("12019000", "soybeans"), ("10059010", "corn"), ("10019900", "wheat")]:
    body = {"flow": "export", "monthDetail": False, "period": {"from": "2026-01", "to": "2026-09"},
            "filters": [{"filter": "ncm", "values": [ncm]}], "details": ["country"], "metrics": ["metricFOB", "metricKG"]}
    for i in range(5):
        r = requests.post(C + "/general?language=en", json=body, headers=UA, timeout=120)
        if r.status_code != 429: break
        time.sleep(15 * (i + 1))
    d = {"status": r.status_code, "retry_after": r.headers.get("Retry-After"), "tries": i + 1}
    try:
        js = r.json(); lst = js.get("data", {}).get("list") if isinstance(js.get("data"), dict) else js.get("data")
        d["n"] = len(lst or []); d["top"] = sorted(lst or [], key=lambda x: -float(x.get("metricKG") or 0))[:6]
    except Exception as e:
        d["body"] = r.text[:300]
    R["comex"][name] = d; time.sleep(10)
u = "https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/safra-de-graos/boletim-da-safra-de-graos/1o-levantamento-safra-2026-27/site_previsao_de_safra-por_produto-out-2026.xlsx"
wb = openpyxl.load_workbook(io.BytesIO(requests.get(u, headers=UA, timeout=60).content), read_only=True, data_only=True)
R["suprimento"] = [[("" if v is None else str(v))[:22] for v in row[:10]] for i, row in enumerate(wb["Suprimento"].iter_rows(values_only=True)) if i < 70]
u = "https://www.gov.br/conab/pt-br/atuacao/informacoes-agropecuarias/safras/progresso-de-safra/acompanhamento-das-lavouras-12-10-a-18-10-26"
r = requests.get(u, headers={"User-Agent": UA["User-Agent"]}, timeout=60)
m = re.search(r'id="content-core"(.*?)(id="viewlet-below-content|<footer)', r.text, re.S)
body = m.group(1) if m else r.text
R["progress"] = {"status": r.status_code, "has_table": "<table" in body, "imgs": re.findall(r'src="([^"]+)"', body)[:8],
                 "links": re.findall(r'href="([^"]+)"', body)[:20], "text": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))[:1500]}
open(os.path.join(OUT, "coverage3.json"), "w").write(json.dumps(R, indent=1, default=str))
