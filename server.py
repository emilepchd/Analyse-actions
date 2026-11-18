"""
Analyse Actions - serveur local.

Recupere les donnees publiques (Yahoo Finance via yfinance) pour une action
et calcule les indicateurs : croissance du BPA anticipee, risque (volatilite
implicite Black-Scholes ou historique), valorisation (PE NTM vs moyenne 5 ans),
dividendes, score /100, perspectives, DCF, analystes, actionnariat, etc.

Lancement : python server.py  (ou double-clic sur lancer.bat sous Windows)
"""
from __future__ import annotations

import logging
import os
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import analysis as an

log = logging.getLogger("analyse")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8765"))

@asynccontextmanager
async def lifespan(_app):
    url = f"http://127.0.0.1:{PORT}"
    print(f"\n  Analyse Actions est prete : {url}\n  (fermer cette fenetre pour arreter)\n", flush=True)
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    yield


app = FastAPI(title="Analyse Actions", lifespan=lifespan)
POOL = ThreadPoolExecutor(max_workers=12)

# ---------------------------------------------------------------- cache
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def cached(key: str, ttl: float, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time(), val)
    return val


def ok(data):
    return JSONResponse(an.clean(data))


# ---------------------------------------------------------------- routes
@app.get("/api/search")
def search(q: str):
    q = q.strip()
    if not q:
        return ok([])

    def run():
        try:
            res = yf.Search(q, max_results=12, news_count=0, enable_fuzzy_query=True).quotes
        except Exception as e:  # noqa: BLE001
            log.warning("search failed: %s", e)
            res = []
        out = []
        for r in res:
            if r.get("quoteType") not in ("EQUITY", "ETF", "INDEX", "MUTUALFUND"):
                continue
            out.append({
                "symbol": r.get("symbol"),
                "name": r.get("longname") or r.get("shortname") or r.get("symbol"),
                "exchange": r.get("exchDisp") or r.get("exchange"),
                "type": r.get("typeDisp") or r.get("quoteType"),
                "sector": r.get("sectorDisp") or r.get("sector"),
            })
        return out

    return ok(cached(f"search:{q.lower()}", 3600, run))


@app.get("/api/stock/{symbol}")
def stock(symbol: str, refresh: int = 0):
    symbol = symbol.upper().strip()
    key = f"stock:{symbol}"
    if refresh:
        _cache.pop(key, None)
    try:
        data = cached(key, 20 * 60, lambda: an.full_analysis(symbol, POOL))
    except an.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return ok(data)


@app.get("/api/summary/{symbol}")
def summary(symbol: str):
    symbol = symbol.upper().strip()
    try:
        data = cached(f"stock:{symbol}", 20 * 60, lambda: an.full_analysis(symbol, POOL))
    except an.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return ok(an.summary_of(data))


@app.get("/api/history/{symbol}")
def history(symbol: str):
    symbol = symbol.upper().strip()
    return ok(cached(f"hist:{symbol}", 30 * 60, lambda: an.price_history(yf.Ticker(symbol))))


@app.get("/api/market")
def market():
    return ok(cached("market", 10 * 60, an.market_overview))


@app.get("/api/fx/{currency}")
def fx(currency: str):
    return ok({"currency": currency, "rate": cached(f"fx:{currency}", 3600, lambda: an.fx_rate(currency, "EUR"))})


@app.get("/api/suivi-fichier")
def watch_file():
    """Symboles du fichier suivi.txt (un par ligne, # pour les commentaires)."""
    path = os.path.join(BASE, "suivi.txt")
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                tok = line.split("#", 1)[0].strip().split()
                if tok:
                    out.append(tok[0].upper())
    return ok(out)


@app.get("/api/universe/{name}")
def universe(name: str):
    return ok(an.UNIVERSES.get(name, []))


@app.get("/api/universes")
def universes():
    return ok([{"id": k, "label": an.UNIVERSE_LABELS.get(k, k), "count": len(v)} for k, v in an.UNIVERSES.items()])


@app.get("/api/health")
def health():
    return ok({"ok": True, "time": datetime.now(timezone.utc).isoformat(), "yfinance": yf.__version__})


app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(BASE, "static", "index.html"))


if __name__ == "__main__":
    import uvicorn

    print("\n  Demarrage d'Analyse Actions...", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
