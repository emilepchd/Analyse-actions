"""
Financial Modeling Prep (FMP) - source complementaire, offre GRATUITE uniquement.

Offre gratuite (Basic, sans carte bancaire) :
  - 250 requetes par jour, 500 Mo sur 30 jours glissants, 5 ans d'historique ;
  - la plupart des donnees ne sont servies que pour une liste fixe d'environ 90 grandes
    actions americaines (AAPL, TSLA, AMZN...) ; aucune action europeenne.

Principes :
  - aucune requete pour une action non americaine (symbole Yahoo avec suffixe, ex. MC.PA) ;
  - une action americaine hors de la liste gratuite est memorisee 7 jours (1 seule requete perdue) ;
  - cache disque par donnee (1 a 7 jours) et compteur journalier plafonne a 240 requetes ;
  - la cle reste sur le PC (dossier de donnees local, hors OneDrive et hors Git) et n'est jamais journalisee.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

log = logging.getLogger("analyse.fmp")

BASE_URL = "https://financialmodelingprep.com/stable/"
DAILY_LIMIT = 250          # quota officiel de l'offre gratuite
SOFT_LIMIT = 240           # marge de securite
NOT_COVERED_TTL = 7 * 86400
REGISTER_URL = "https://site.financialmodelingprep.com/register"

# donnee -> (chemin, parametres supplementaires, duree de cache en secondes)
ENDPOINTS = {
    "targets": ("price-target-consensus", {}, 86400),
    "segProduct": ("revenue-product-segmentation", {"period": "annual"}, 7 * 86400),
    "segGeo": ("revenue-geographic-segmentation", {"period": "annual"}, 7 * 86400),
    "estimates": ("analyst-estimates", {"period": "annual", "page": "0", "limit": "10"}, 3 * 86400),
    "grades": ("grades", {}, 86400),
    "scores": ("financial-scores", {}, 7 * 86400),
    "dcf": ("discounted-cash-flow", {}, 86400),
    "rating": ("ratings-snapshot", {}, 86400),
}

_lock = threading.RLock()


# ---------------------------------------------------------------- stockage local
def data_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    d = os.path.join(base, "AnalyseActions")
    os.makedirs(d, exist_ok=True)
    return d


def _path(name: str) -> str:
    return os.path.join(data_dir(), name)


def _read_json(name: str, default):
    try:
        with open(_path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(name: str, value) -> None:
    tmp = _path(name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False)
    os.replace(tmp, _path(name))


# ---------------------------------------------------------------- cle
def get_key() -> tuple[str | None, str | None]:
    env = (os.environ.get("FMP_API_KEY") or "").strip()
    if env:
        return env, "env"
    k = (_read_json("config.json", {}).get("fmp_key") or "").strip()
    return (k, "file") if k else (None, None)


def set_key(key: str | None) -> None:
    with _lock:
        cfg = _read_json("config.json", {})
        if key:
            cfg["fmp_key"] = key.strip()
        else:
            cfg.pop("fmp_key", None)
        _write_json("config.json", cfg)
        # une nouvelle cle remet a zero les diagnostics "non couvert" et "cle invalide"
        cache = _read_json("fmp_cache.json", {})
        for k in [k for k in cache if k.startswith("cov:")]:
            cache.pop(k, None)
        _write_json("fmp_cache.json", cache)
        u = _usage()
        u.pop("invalid", None)
        _write_json("fmp_usage.json", u)


def key_hint(key: str | None) -> str | None:
    if not key:
        return None
    return key[:4] + "…" + key[-4:] if len(key) > 10 else "…"


# ---------------------------------------------------------------- quota
def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _usage() -> dict:
    u = _read_json("fmp_usage.json", {})
    if u.get("date") != _today():
        u = {"date": _today(), "calls": 0, **({"invalid": u["invalid"]} if u.get("invalid") else {})}
    return u


def usage() -> dict:
    with _lock:
        u = _usage()
    return {"date": u["date"], "calls": u.get("calls", 0), "limit": DAILY_LIMIT, "softLimit": SOFT_LIMIT,
            "limitReached": bool(u.get("limitHit")) or u.get("calls", 0) >= SOFT_LIMIT}


def _take_call() -> bool:
    with _lock:
        u = _usage()
        if u.get("limitHit") or u.get("calls", 0) >= SOFT_LIMIT:
            return False
        u["calls"] = u.get("calls", 0) + 1
        _write_json("fmp_usage.json", u)
        return True


def _flag(name: str, value=True) -> None:
    with _lock:
        u = _usage()
        u[name] = value
        _write_json("fmp_usage.json", u)


# ---------------------------------------------------------------- cache disque
def _cache_get(key: str, ttl: float):
    with _lock:
        hit = _read_json("fmp_cache.json", {}).get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    return None


def _cache_put(key: str, value) -> None:
    with _lock:
        cache = _read_json("fmp_cache.json", {})
        cache[key] = [time.time(), value]
        # menage : on oublie ce qui a plus de 30 jours
        old = time.time() - 30 * 86400
        cache = {k: v for k, v in cache.items() if v[0] > old}
        _write_json("fmp_cache.json", cache)


# ---------------------------------------------------------------- appel HTTP
class FmpError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind  # invalid_key | not_covered | limit | error


def _classify(status: int, body) -> FmpError | None:
    msg = ""
    if isinstance(body, dict):
        msg = str(body.get("Error Message") or body.get("error") or body.get("message") or "")
    elif isinstance(body, str):
        msg = body
    low = msg.lower()
    if status == 401 or "invalid api key" in low:
        return FmpError("invalid_key", "Clé FMP invalide.")
    if status == 429 or "limit reach" in low:
        return FmpError("limit", "Quota journalier FMP atteint.")
    if status in (402, 403) or "premium" in low or "subscription" in low or "not available" in low or "legacy" in low:
        return FmpError("not_covered", "Donnée non incluse dans l'offre gratuite FMP.")
    if status >= 400 or msg:
        return FmpError("error", f"Erreur FMP (HTTP {status}).")
    return None


def call(path: str, params: dict, key: str, flag: bool = True):
    if not _take_call():
        raise FmpError("limit", "Quota journalier FMP atteint (compteur local).")
    q = urllib.parse.urlencode({**params, "apikey": key})
    req = urllib.request.Request(BASE_URL + path + "?" + q, headers={"User-Agent": "AnalyseActions/1.0", "Accept": "application/json"})
    status, raw = 0, b""
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read() or b""
    except Exception as e:  # noqa: BLE001
        raise FmpError("error", "FMP injoignable (" + type(e).__name__ + ").") from None
    text = raw.decode("utf-8", "replace")
    try:
        body = json.loads(text) if text.strip() else None
    except ValueError:
        body = text.strip()
    err = _classify(status, body)
    if err:
        if err.kind == "limit":
            _flag("limitHit")
        if err.kind == "invalid_key" and flag:
            _flag("invalid")
        raise err
    if flag:
        with _lock:
            u = _usage()
            if u.pop("invalid", None):
                _write_json("fmp_usage.json", u)
    return body


# ---------------------------------------------------------------- normalisation
def _num(x):
    try:
        v = float(x)
        return v if v == v and abs(v) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _first(row: dict, *names):
    for n in names:
        if n in row and row[n] is not None:
            return row[n]
    return None


def _one(body):
    if isinstance(body, list):
        return body[0] if body and isinstance(body[0], dict) else None
    return body if isinstance(body, dict) else None


def _segments(body) -> list:
    """[{year, date, items:{nom: montant}}] du plus ancien au plus recent (format stable ou ancien)."""
    out = []
    for row in body if isinstance(body, list) else []:
        if not isinstance(row, dict):
            continue
        if isinstance(row.get("data"), dict):
            date = row.get("date")
            year = row.get("fiscalYear") or (str(date)[:4] if date else None)
            items = row["data"]
        elif len(row) == 1 and isinstance(next(iter(row.values())), dict):  # ancien format {date: {...}}
            date, items = next(iter(row.items()))
            year = str(date)[:4]
        else:
            continue
        items = {str(k): _num(v) for k, v in items.items() if _num(v) is not None and _num(v) > 0}
        if items:
            out.append({"year": str(year) if year else None, "date": date, "items": items})
    out.sort(key=lambda r: str(r.get("date") or r.get("year") or ""))
    out = out[-6:]
    # les libelles changent d'une annee a l'autre ("Server Products And Cloud Services" puis
    # "Server products and cloud services", "Linked In Corporation" puis "LinkedIn") : on les regroupe
    labels = {}
    for r in out:
        for name in r["items"]:
            labels[_seg_key(name)] = _seg_label(name)  # le libelle le plus recent l'emporte
    for r in out:
        merged = {}
        for name, v in r["items"].items():
            lab = labels[_seg_key(name)]
            merged[lab] = merged.get(lab, 0) + v
        r["items"] = merged
    return out


def _seg_key(name: str) -> str:
    k = re.sub(r"[^a-z0-9]", "", name.lower())
    for suf in ("segment", "corporation", "inc"):
        if k.endswith(suf) and len(k) > len(suf):
            k = k[: -len(suf)]
    return k


def _seg_label(name: str) -> str:
    lab = re.sub(r"\s+segment$", "", name.strip(), flags=re.I)
    if lab.isupper() and len(lab) > 4:
        lab = lab.title()
    return lab


def _estimates(body) -> list:
    out = []
    for r in body if isinstance(body, list) else []:
        if not isinstance(r, dict) or not r.get("date"):
            continue
        out.append({
            "date": r["date"],
            "year": str(r["date"])[:4],
            "revenue": _num(_first(r, "revenueAvg", "estimatedRevenueAvg")),
            "revenueLow": _num(_first(r, "revenueLow", "estimatedRevenueLow")),
            "revenueHigh": _num(_first(r, "revenueHigh", "estimatedRevenueHigh")),
            "eps": _num(_first(r, "epsAvg", "estimatedEpsAvg")),
            "epsLow": _num(_first(r, "epsLow", "estimatedEpsLow")),
            "epsHigh": _num(_first(r, "epsHigh", "estimatedEpsHigh")),
            "netIncome": _num(_first(r, "netIncomeAvg", "estimatedNetIncomeAvg")),
            "ebitda": _num(_first(r, "ebitdaAvg", "estimatedEbitdaAvg")),
            "analystsEps": _first(r, "numAnalystsEps", "numberAnalystsEstimatedEps"),
            "analystsRevenue": _first(r, "numAnalystsRevenue", "numberAnalystEstimatedRevenue"),
        })
    out.sort(key=lambda r: r["date"])
    return out


def _grades(body) -> list:
    out = []
    for r in body if isinstance(body, list) else []:
        if not isinstance(r, dict) or not r.get("date"):
            continue
        out.append({
            "date": str(r["date"])[:10],
            "firm": _first(r, "gradingCompany", "analystCompany", "company"),
            "from": r.get("previousGrade"),
            "to": r.get("newGrade"),
            "action": r.get("action"),
        })
    out.sort(key=lambda r: r["date"], reverse=True)
    return out[:40]


def _normalize(raw: dict) -> dict:
    t = _one(raw.get("targets")) or {}
    s = _one(raw.get("scores")) or {}
    d = _one(raw.get("dcf")) or {}
    rt = _one(raw.get("rating")) or {}
    return {
        "targets": {
            "consensus": _num(t.get("targetConsensus")), "median": _num(t.get("targetMedian")),
            "high": _num(t.get("targetHigh")), "low": _num(t.get("targetLow")),
        } if t else None,
        "segments": {"product": _segments(raw.get("segProduct")), "geo": _segments(raw.get("segGeo"))},
        "estimates": _estimates(raw.get("estimates")),
        "grades": _grades(raw.get("grades")),
        "scores": {"altman": _num(s.get("altmanZScore")), "piotroski": _num(s.get("piotroskiScore"))} if s else None,
        "dcf": {"value": _num(d.get("dcf")), "price": _num(_first(d, "Stock Price", "stockPrice", "price")), "date": d.get("date")} if d else None,
        "rating": {
            "rating": rt.get("rating"), "score": _num(rt.get("overallScore")),
            "details": {k: _num(rt.get(k)) for k in ("discountedCashFlowScore", "returnOnEquityScore", "returnOnAssetsScore",
                                                      "debtToEquityScore", "priceToEarningsScore", "priceToBookScore") if rt.get(k) is not None},
        } if rt else None,
    }


# ---------------------------------------------------------------- point d'entree
def is_us_symbol(symbol: str) -> bool:
    return bool(symbol) and "." not in symbol and not symbol.startswith("^") and "=" not in symbol


def status() -> dict:
    key, src = get_key()
    with _lock:
        invalid = bool(_usage().get("invalid"))
    return {"configured": bool(key), "source": src, "keyHint": key_hint(key), "invalid": invalid,
            "usage": usage(), "registerUrl": REGISTER_URL}


def test_key(key: str) -> dict:
    """Verifie une cle avec 1 requete sur AAPL (incluse dans l'offre gratuite)."""
    try:
        body = call("price-target-consensus", {"symbol": "AAPL"}, key, flag=False)
    except FmpError as e:
        if e.kind == "not_covered":  # la cle est valide, seule la donnee est restreinte
            return {"ok": True, "message": "Clé valide."}
        return {"ok": False, "kind": e.kind, "message": str(e)}
    return {"ok": True, "message": "Clé valide." if body is not None else "Clé acceptée."}


def get(symbol: str, refresh: bool = False, pool: ThreadPoolExecutor | None = None) -> dict:
    symbol = symbol.upper().strip()
    base = {"symbol": symbol, "source": "Financial Modeling Prep (offre gratuite)"}
    key, _src = get_key()
    if not key:
        return {**base, "status": "no_key", "usage": usage()}
    if not is_us_symbol(symbol):
        return {**base, "status": "not_covered", "reason": "non_us", "usage": usage()}
    if not refresh and _cache_get(f"cov:{symbol}", NOT_COVERED_TTL) == "no":
        return {**base, "status": "not_covered", "reason": "free_list", "usage": usage()}

    raw, errors, todo = {}, {}, []
    for name, (_path_, _params, ttl) in ENDPOINTS.items():
        hit = None if refresh else _cache_get(f"{name}:{symbol}", ttl)
        if hit is not None:
            raw[name] = hit
        else:
            todo.append(name)

    def fetch(name):
        path, params, _ttl = ENDPOINTS[name]
        body = call(path, {"symbol": symbol, **params}, key)
        _cache_put(f"{name}:{symbol}", body if body is not None else [])
        return body

    stop = None
    if todo:
        # 1re requete seule : elle sert de test de couverture avant de depenser le reste du quota
        first = todo.pop(0)
        try:
            raw[first] = fetch(first)
        except FmpError as e:
            if e.kind == "not_covered" and not raw:
                _cache_put(f"cov:{symbol}", "no")
                return {**base, "status": "not_covered", "reason": "free_list", "usage": usage()}
            if e.kind in ("invalid_key", "limit"):
                stop = e
            else:
                errors[first] = str(e)
        if not stop and todo:
            ex = pool or ThreadPoolExecutor(max_workers=4)
            futs = {n: ex.submit(fetch, n) for n in todo}
            for n, f in futs.items():
                try:
                    raw[n] = f.result(timeout=40)
                except FmpError as e:
                    if e.kind in ("invalid_key", "limit"):
                        stop = stop or e
                    errors[n] = str(e)
                except Exception as e:  # noqa: BLE001
                    errors[n] = "Erreur FMP (" + type(e).__name__ + ")."
            if pool is None:
                ex.shutdown(wait=False)

    if stop and not raw:
        return {**base, "status": stop.kind, "message": str(stop), "usage": usage()}
    if raw and all(v in (None, [], {}) for v in raw.values()) and len(errors) == 0 and not stop:
        # reponses vides partout : symbole inconnu de FMP
        _cache_put(f"cov:{symbol}", "no")
        return {**base, "status": "not_covered", "reason": "empty", "usage": usage()}
    out = {**base, "status": "ok", **_normalize(raw), "errors": errors, "usage": usage(),
           "fetched": datetime.now(timezone.utc).isoformat()}
    if stop:
        out["warning"] = str(stop) + " Certaines données manquent, réessaie demain."
    return out
