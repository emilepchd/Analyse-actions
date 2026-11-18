"""
Analyse Actions - serveur local.

Recupere les donnees publiques (Yahoo Finance via yfinance ; Financial Modeling Prep
gratuit en option, voir fmp.py) pour une action
et calcule les indicateurs : croissance du BPA anticipee, risque (volatilite
implicite Black-Scholes ou historique), valorisation (PE NTM vs moyenne 5 ans),
dividendes, score /100, perspectives, DCF, analystes, actionnariat, etc.

Lancement : python server.py  (ou double-clic sur lancer.bat sous Windows)
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import mimetypes
import os
import threading
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import yfinance as yf
from urllib.parse import parse_qs

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

import analysis as an
import fmp

mimetypes.add_type("application/manifest+json", ".webmanifest")
log = logging.getLogger("analyse")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "127.0.0.1")
# mode en ligne (hebergeur) : mot de passe obligatoire, pas de navigateur a ouvrir
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
ONLINE = HOST not in ("127.0.0.1", "localhost") or bool(os.environ.get("RENDER"))


@asynccontextmanager
async def lifespan(_app):
    url = f"http://127.0.0.1:{PORT}"
    if ONLINE:
        print(f"  Analyse Actions en ligne sur le port {PORT} (mot de passe {'actif' if APP_PASSWORD else 'ABSENT'})", flush=True)
    else:
        print(f"\n  Analyse Actions est prete : {url}\n  (fermer cette fenetre pour arreter)\n", flush=True)
        if not os.environ.get("NO_BROWSER"):
            threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    yield


app = FastAPI(title="Analyse Actions", lifespan=lifespan)

# ---------------------------------------------------------------- mot de passe (mode en ligne)
COOKIE = "aa_auth"
PUBLIC = ("/login", "/api/health", "/static/manifest.webmanifest", "/static/icon-192.png", "/static/icon-512.png",
          "/static/apple-touch-icon.png", "/static/favicon.png", "/favicon.ico")


def _token() -> str:
    return hmac.new(("aa-v1:" + APP_PASSWORD).encode(), b"analyse-actions", hashlib.sha256).hexdigest()


def _authed(request: Request) -> bool:
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), _token())


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if ONLINE and not APP_PASSWORD and path not in PUBLIC:
        return HTMLResponse("<h3>Analyse Actions</h3><p>Définis la variable APP_PASSWORD chez l'hébergeur pour protéger l'accès.</p>", 503)
    if APP_PASSWORD and path not in PUBLIC and not _authed(request):
        if path.startswith("/api/"):
            return JSONResponse({"detail": "Connexion requise"}, 401)
        return RedirectResponse("/login", 303)
    resp = await call_next(request)
    if ONLINE:
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
    return resp


LOGIN_HTML = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Analyse Actions</title><link rel="icon" href="/static/favicon.png"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
<link rel="manifest" href="/static/manifest.webmanifest"><meta name="theme-color" content="#1e4155">
<style>:root{--bg:#eef2f5;--card:#fff;--ink:#15232d;--muted:#61717d;--line:#dfe6eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f171d;--card:#17222a;--ink:#e4ecf1;--muted:#93a4b0;--line:#26343e}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;width:100%;max-width:360px;text-align:center}
img{width:64px;height:64px;border-radius:14px}h1{font-size:20px;margin:10px 0 4px}p{color:var(--muted);margin:0 0 18px;font-size:13px}
input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:16px}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:10px;background:#2c5a73;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.err{color:#d14b4b;margin-top:10px;font-size:13px}</style></head><body>
<form method="post" action="/login"><img src="/static/icon-192.png" alt=""><h1>Analyse Actions</h1><p>Accès protégé</p>
<input type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" autofocus required>
<button type="submit">Entrer</button>__ERR__</form></body></html>"""


@app.get("/login")
def login_page():
    return HTMLResponse(LOGIN_HTML.replace("__ERR__", ""))


@app.post("/login")
async def login(request: Request):
    form = parse_qs((await request.body()).decode("utf-8", "replace"))
    pwd = (form.get("password") or [""])[0]
    if APP_PASSWORD and hmac.compare_digest(pwd.encode(), APP_PASSWORD.encode()):
        resp = RedirectResponse("/", 303)
        resp.set_cookie(COOKIE, _token(), max_age=180 * 86400, httponly=True, secure=ONLINE, samesite="lax")
        return resp
    await asyncio.sleep(1.5)  # freine les essais en serie
    return HTMLResponse(LOGIN_HTML.replace("__ERR__", '<div class="err">Mot de passe incorrect.</div>'), 401)


@app.get("/logout")
def logout():
    resp = RedirectResponse("/login", 303)
    resp.delete_cookie(COOKIE)
    return resp
POOL = ThreadPoolExecutor(max_workers=12)

# ---------------------------------------------------------------- cache
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def cached(key: str, ttl: float, fn, short=None, short_ttl: float = 120):
    """Memoire temporaire. short(val) vrai = resultat incomplet, garde seulement short_ttl secondes."""
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    stamp = time.time()
    if short and short(val):
        stamp -= max(0, ttl - short_ttl)
    with _lock:
        _cache[key] = (stamp, val)
        if len(_cache) > 300:  # memoire limitee chez l'hebergeur gratuit : on oublie les plus anciennes
            for k, _v in sorted(_cache.items(), key=lambda kv: kv[1][0])[:60]:
                _cache.pop(k, None)
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
        data = _analysis(symbol)
    except an.NotFound as e:
        raise HTTPException(404, str(e)) from e
    return ok(data)


def _analysis(symbol: str):
    # Fiche incomplete (Yahoo a refuse le profil) : on la garde 2 minutes seulement pour reessayer vite.
    return cached(f"stock:{symbol}", 20 * 60, lambda: an.full_analysis(symbol, POOL),
                  short=lambda d: d["profile"].get("partial"))


@app.get("/api/summary/{symbol}")
def summary(symbol: str):
    symbol = symbol.upper().strip()
    try:
        data = _analysis(symbol)
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


# ---------------------------------------------------------------- Financial Modeling Prep (offre gratuite)
@app.get("/api/fmp/{symbol}")
def fmp_data(symbol: str, refresh: int = 0):
    return ok(fmp.get(symbol, bool(refresh), POOL))


@app.get("/api/settings")
def settings():
    return ok({"fmp": fmp.status()})


@app.post("/api/settings/fmp")
def settings_fmp(payload: dict = Body(...)):
    key = str(payload.get("key") or "").strip()
    if not key:
        fmp.set_key(None)
        return ok({"ok": True, "message": "Clé supprimée.", "fmp": fmp.status()})
    if len(key) < 10 or len(key) > 100 or not key.isalnum():
        raise HTTPException(400, "Cette clé ne ressemble pas à une clé FMP (lettres et chiffres uniquement).")
    res = fmp.test_key(key)
    if not res["ok"]:
        if res.get("kind") == "limit":
            raise HTTPException(429, "Quota du jour atteint : réessaie demain.")
        raise HTTPException(400, res["message"] + " Vérifie que tu as copié la clé en entier.")
    fmp.set_key(key)
    return ok({"ok": True, "message": res["message"], "fmp": fmp.status()})


def _yahoo_check():
    try:
        px = yf.Ticker("MC.PA").fast_info["lastPrice"]
        return {"ok": bool(px), "symbol": "MC.PA", "price": float(px) if px else None}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": type(e).__name__ + ": " + str(e)[:200]}


def _yahoo_deep_check():
    """Teste chaque type de donnee Yahoo utilise par la fiche (profil, historique, estimations, options)."""
    out = {}
    t = yf.Ticker("AAPL")
    tests = {
        "profil": lambda: bool((t.info or {}).get("longName")),
        "historique": lambda: len(t.history(period="1y")) > 100,
        "estimations": lambda: t.earnings_estimate is not None and len(t.earnings_estimate) > 0,
        "analystes": lambda: t.recommendations is not None and len(t.recommendations) > 0,
        "options": lambda: len(t.options or ()) > 0,
        "europe": lambda: bool((yf.Ticker("AI.PA").info or {}).get("longName")),
    }
    msgs: list[str] = []

    class _Grab(logging.Handler):
        def emit(self, record):
            m = record.getMessage()[:200]
            if m not in msgs and len(msgs) < 6:
                msgs.append(m)

    grab = _Grab(level=logging.WARNING)
    ylog = logging.getLogger("yfinance")
    ylog.addHandler(grab)
    try:
        for name, fn in tests.items():
            try:
                out[name] = "ok" if fn() else "vide"
            except Exception as e:  # noqa: BLE001
                out[name] = "erreur : " + type(e).__name__ + " " + str(e)[:120]
    finally:
        ylog.removeHandler(grab)
    out["nom"] = an.company_name("MC.PA", {}, an._history_meta(yf.Ticker("MC.PA")))
    if msgs:
        out["messages"] = msgs
    return out


@app.get("/api/health")
def health(yahoo: int = 0):
    out = {"ok": True, "time": datetime.now(timezone.utc).isoformat(), "yfinance": yf.__version__,
           "online": ONLINE, "password": bool(APP_PASSWORD)}
    if yahoo:  # diagnostic : Yahoo repond-il depuis cette machine ?
        out["yahoo"] = cached("yahoo-check", 300, _yahoo_check)
    if yahoo >= 2:
        out["yahooDetail"] = cached("yahoo-deep", 600, _yahoo_deep_check)
    return ok(out)


app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(BASE, "static", "index.html"))


@app.get("/favicon.ico")
def favicon():
    return FileResponse(os.path.join(BASE, "static", "favicon.png"))


def _already_running() -> bool:
    """Vrai si l'application tourne deja sur ce PC (double-clic sur le raccourci alors qu'elle est ouverte)."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=1.5) as r:
            return r.status == 200 and b"yfinance" in r.read()
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    import uvicorn

    if not ONLINE and _already_running():
        print("\n  Analyse Actions est deja ouverte : ouverture du navigateur.", flush=True)
        if not os.environ.get("NO_BROWSER"):
            webbrowser.open(f"http://127.0.0.1:{PORT}")
        raise SystemExit(0)
    print("\n  Demarrage d'Analyse Actions...", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning", proxy_headers=True, forwarded_allow_ips="*")
