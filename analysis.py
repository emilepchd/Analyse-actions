"""Collecte des donnees et calcul des indicateurs pour une action."""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

log = logging.getLogger("analyse")


class NotFound(Exception):
    pass


# =================================================================== utils
def clean(o):
    """Rend un objet serialisable JSON (NaN -> None, numpy -> python)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    if isinstance(o, np.bool_):
        return bool(o)
    if o is pd.NaT:
        return None
    return o


def num(x):
    try:
        if x is None:
            return None
        f = float(x)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def safe(fn, default=None, label=""):
    try:
        v = fn()
        return default if v is None else v
    except Exception as e:  # noqa: BLE001
        log.info("donnee indisponible %s: %s", label, str(e)[:160])
        return default


def ratio(a, b):
    a, b = num(a), num(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def cagr(start, end, years):
    start, end = num(start), num(end)
    if start is None or end is None or years is None or years <= 0 or start <= 0 or end <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def lerp_score(x, points):
    """Interpolation lineaire d'une note (0-5) a partir de points [(x, note)], x croissant."""
    x = num(x)
    if x is None:
        return None
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return None


def ts(epoch):
    try:
        if epoch is None:
            return None
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc).date().isoformat()
    except Exception:  # noqa: BLE001
        return None


def df_rows(df: pd.DataFrame | None, rows: list[str], limit: int | None = None):
    """Extrait des lignes d'un etat financier yfinance -> {ligne: [{date, value}...]} trie par date croissante."""
    out = {}
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return out
    cols = sorted(df.columns)
    if limit:
        cols = cols[-limit:]
    for r in rows:
        if r in df.index:
            series = []
            for c in cols:
                v = num(df.at[r, c]) if not isinstance(df.at[r, c], pd.Series) else num(df.at[r, c].iloc[0])
                series.append({"date": pd.Timestamp(c).date().isoformat(), "value": v})
            out[r] = series
    return out


EU_EEA = {
    "France", "Germany", "Netherlands", "Belgium", "Luxembourg", "Italy", "Spain", "Portugal", "Ireland",
    "Austria", "Finland", "Sweden", "Denmark", "Greece", "Poland", "Czech Republic", "Czechia", "Hungary",
    "Slovakia", "Slovenia", "Croatia", "Romania", "Bulgaria", "Estonia", "Latvia", "Lithuania", "Malta",
    "Cyprus", "Norway", "Iceland", "Liechtenstein",
}

_fx_cache: dict[str, float] = {}


def fx_rate(src: str | None, dst: str = "USD") -> float | None:
    """Taux de change approximatif src -> dst (gere GBp/ZAc en centimes)."""
    if not src:
        return None
    div = 1.0
    if src in ("GBp", "GBX"):
        src, div = "GBP", 100.0
    elif src in ("ZAc", "ILA"):
        src, div = ("ZAR" if src == "ZAc" else "ILS"), 100.0
    if src == dst:
        return 1.0 / div
    key = f"{src}{dst}"
    if key not in _fx_cache:
        r = safe(lambda: yf.Ticker(f"{src}{dst}=X").fast_info["lastPrice"], None, "fx")
        if r:
            _fx_cache[key] = float(r)
    r = _fx_cache.get(key)
    return r / div if r else None


def cap_category(mcap_usd):
    if mcap_usd is None:
        return None
    if mcap_usd >= 200e9:
        return "Mega Cap"
    if mcap_usd >= 10e9:
        return "Large Cap"
    if mcap_usd >= 2e9:
        return "Mid Cap"
    if mcap_usd >= 300e6:
        return "Small Cap"
    return "Micro Cap"


# ============================================================ TradingView
# suffixe Yahoo -> prefixe de place TradingView
TV_SUFFIX = {
    "PA": "EURONEXT", "AS": "EURONEXT", "BR": "EURONEXT", "LS": "EURONEXT", "IR": "EURONEXT",
    "DE": "XETR", "F": "FWB", "BE": "BER", "DU": "DUS", "MU": "MUN", "HM": "HAM", "SG": "SWB",
    "MI": "MIL", "SW": "SIX", "MC": "BME", "VI": "VIE", "WA": "GPW", "AT": "ATHEX", "PR": "PSECZ",
    "CO": "OMXCOP", "ST": "OMXSTO", "HE": "OMXHEX", "OL": "OSL", "IC": "OMXICE",
    "L": "LSE", "IL": "LSIN",
    "TO": "TSX", "V": "TSXV", "NE": "NEO", "CN": "CSE",
    "HK": "HKEX", "T": "TSE", "AX": "ASX", "NZ": "NZX", "KS": "KRX", "KQ": "KRX", "SS": "SSE", "SZ": "SZSE",
    "NS": "NSE", "BO": "BSE", "TW": "TWSE", "TWO": "TPEX", "SI": "SGX", "SA": "BMFBOVESPA", "MX": "BMV",
    "JO": "JSE", "IS": "BIST", "TA": "TASE",
}
# code de place Yahoo (info["exchange"]) -> prefixe TradingView pour les actions sans suffixe
TV_US = {"NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ", "NAS": "NASDAQ", "NYQ": "NYSE", "NYS": "NYSE",
         "ASE": "AMEX", "PCX": "AMEX", "BTS": "CBOE", "PNK": "OTC", "OQB": "OTC", "OQX": "OTC", "OEM": "OTC"}
# places que les widgets gratuits n'affichent pas (« disponible uniquement sur TradingView »)
TV_NO_WIDGET = {"LSE", "LSIN"}
TV_INDEX = {"^GSPC": "SP:SPX", "^NDX": "NASDAQ:NDX", "^IXIC": "NASDAQ:IXIC", "^DJI": "DJ:DJI",
            "^FCHI": "EURONEXT:PX1", "^GDAXI": "XETR:DAX", "^STOXX50E": "TVC:SX5E", "^STOXX": "TVC:SXXP",
            "^FTSE": "TVC:UKX", "^N225": "TVC:NI225", "^HSI": "TVC:HSI", "^VIX": "TVC:VIX"}


def tv_symbol(symbol: str, exch: str | None = None) -> dict | None:
    """Symbole TradingView equivalent au symbole Yahoo, et s'il peut s'afficher dans le widget gratuit."""
    s = (symbol or "").upper()
    if not s or "=" in s:
        return None
    if s.startswith("^"):
        tv = TV_INDEX.get(s)
        if not tv:
            return None
        prefix = tv.split(":")[0]
    else:
        base, _, suf = s.rpartition(".") if "." in s else (s, "", "")
        if suf:
            prefix = TV_SUFFIX.get(suf)
            if not prefix:
                return None
        else:
            prefix = TV_US.get((exch or "").upper())
        if prefix in ("OMXCOP", "OMXSTO", "OMXHEX", "OMXICE"):
            base = base.replace("-", "_")            # NOVO-B -> NOVO_B
        elif prefix == "HKEX":
            base = base.lstrip("0") or "0"           # 0700 -> 700
        else:
            base = base.replace("-", ".")            # BRK-B -> BRK.B, RCI-B -> RCI.B
        if prefix == "LSE" and len(base) < 3 and "." not in base:
            base += "."                              # BA -> BA.
        tv = f"{prefix}:{base}" if prefix else base
    page = tv.replace(":", "-")
    return {"symbol": tv, "widget": prefix not in TV_NO_WIDGET,
            "url": f"https://fr.tradingview.com/symbols/{page}/"}


# ============================================================ price history
def price_history(t: yf.Ticker):
    h = t.history(period="max", interval="1d", auto_adjust=False, actions=True)
    if h is None or h.empty:
        return {"dates": [], "close": [], "adj": [], "dividends": [], "splits": []}
    h = h[~h.index.duplicated(keep="last")]
    h = h.dropna(subset=["Close"])
    idx = [d.date().isoformat() for d in h.index]
    close = [round(float(x), 4) for x in h["Close"]]
    adj = [round(float(x), 4) for x in (h["Adj Close"] if "Adj Close" in h else h["Close"])]
    divs = []
    if "Dividends" in h:
        for d, v in h["Dividends"].items():
            if v and v > 0:
                divs.append({"date": d.date().isoformat(), "value": float(v)})
    splits = []
    if "Stock Splits" in h:
        for d, v in h["Stock Splits"].items():
            if v and v > 0:
                splits.append({"date": d.date().isoformat(), "value": float(v)})
    return {"dates": idx, "close": close, "adj": adj, "dividends": divs, "splits": splits}



# ============================================================ nom de la societe
_NAMES: dict[str, str] = {}  # memoire des noms deja trouves (ils ne changent pas)


def _history_meta(t: yf.Ticker) -> dict:
    """Infos renvoyees avec les cours (nom, devise, place). Cette source repond meme quand Yahoo refuse le reste."""
    try:
        m = t.get_history_metadata()
        return {k: m.get(k) for k in ("longName", "shortName", "currency", "fullExchangeName", "exchangeName",
                                      "instrumentType", "regularMarketPrice")}
    except Exception:  # noqa: BLE001
        return {}


def _search_name(symbol: str) -> str | None:
    try:
        for q in yf.Search(symbol, max_results=8, news_count=0).quotes or []:
            if (q.get("symbol") or "").upper() == symbol.upper():
                return q.get("longname") or q.get("shortname")
    except Exception:  # noqa: BLE001
        return None
    return None


def company_name(symbol: str, info: dict | None = None, meta: dict | None = None) -> str:
    """Nom complet de la societe : profil Yahoo, sinon donnees des cours, sinon recherche Yahoo, sinon le symbole."""
    info, meta = info or {}, meta or {}
    for cand in (info.get("longName"), meta.get("longName"), _NAMES.get(symbol), info.get("shortName"), meta.get("shortName")):
        if cand and str(cand).strip() and str(cand).strip().upper() != symbol.upper():
            _NAMES[symbol] = str(cand).strip()
            return _NAMES[symbol]
    found = _search_name(symbol)
    if found:
        _NAMES[symbol] = found.strip()
        return _NAMES[symbol]
    return symbol


def info_complete(info: dict) -> bool:
    """Faux quand Yahoo n'a renvoye qu'un profil vide (limitation temporaire du serveur)."""
    return bool(info) and len(info) > 8 and bool(info.get("quoteType"))


# ============================================================ sub-fetchers
def now_naive() -> pd.Timestamp:
    return pd.Timestamp.now(tz="UTC").tz_localize(None)


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_price(S, K, T, r, q, sig, call=True):
    """Prix d'une option europeenne (Black-Scholes-Merton avec dividende continu q)."""
    if sig <= 0 or T <= 0:
        return max(0.0, (S - K) if call else (K - S))
    st = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / st
    d2 = d1 - st
    if call:
        return S * math.exp(-q * T) * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    return K * math.exp(-r * T) * _norm_cdf(-d2) - S * math.exp(-q * T) * _norm_cdf(-d1)


def bs_implied_vol(price, S, K, T, r, q, call=True):
    """Inverse Black-Scholes-Merton par dichotomie. None si le prix est incoherent."""
    if not price or price <= 0 or T <= 0:
        return None
    lo_p, hi_p = bs_price(S, K, T, r, q, 1e-4, call), bs_price(S, K, T, r, q, 4.0, call)
    if not (lo_p < price < hi_p):
        return None
    lo, hi = 1e-4, 4.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_price(S, K, T, r, q, mid, call) > price:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def _implied_vol(t: yf.Ticker, spot: float | None, div_yield: float | None = None, rate: float = 0.04):
    """Volatilite implicite des options a ~6 mois, proches de la monnaie.

    Recalculee a partir des prix (milieu bid/ask, sinon dernier cours) en inversant le modele
    de Black-Scholes & Merton : les volatilites fournies par Yahoo sont souvent fausses
    quand le marche americain est ferme.
    """
    if not spot:
        return None
    exps = list(t.options or [])
    if not exps:
        return None
    today = now_naive().normalize()
    best, best_gap = None, 1e9
    for e in exps:
        days = (pd.Timestamp(e) - today).days
        if days < 30:
            continue
        gap = abs(days - 182)
        if gap < best_gap:
            best, best_gap = (e, days), gap
    if not best:
        return None
    T = best[1] / 365.0
    q = div_yield or 0.0
    chain = t.option_chain(best[0])
    ivs, yahoo_ivs = [], []
    for df, call in ((chain.calls, True), (chain.puts, False)):
        if df is None or df.empty:
            continue
        near = df[(df["strike"] >= spot * 0.85) & (df["strike"] <= spot * 1.15)]
        for _, o in near.iterrows():
            K = num(o.get("strike"))
            if not K:
                continue
            # options hors de la monnaie (plus liquides) + celles tres proches de la monnaie
            if (call and K < spot * 0.97) or ((not call) and K > spot * 1.03):
                continue
            bid, ask, last = num(o.get("bid")) or 0, num(o.get("ask")) or 0, num(o.get("lastPrice")) or 0
            px = (bid + ask) / 2 if (bid > 0 and ask > 0 and ask >= bid and (ask - bid) / ((ask + bid) / 2) < 0.5) else last
            iv = bs_implied_vol(px, spot, K, T, rate, q, call)
            if iv and 0.05 < iv < 2.5:
                ivs.append(iv)
            yv = num(o.get("impliedVolatility"))
            if yv and 0.05 < yv < 2.5:
                yahoo_ivs.append(yv)
    src = ivs if len(ivs) >= 3 else yahoo_ivs
    if len(src) < 3:
        return None
    return {"iv": float(np.median(src)), "expiry": best[0], "days": best[1], "n": len(src),
            "method": "recalculee (Black-Scholes)" if src is ivs else "Yahoo"}


def _hist_vol(close: list[float], days=252):
    if len(close) < 60:
        return None
    arr = np.array(close[-(days + 1):], dtype=float)
    arr = arr[arr > 0]
    r = np.diff(np.log(arr))
    if len(r) < 30:
        return None
    return float(np.std(r, ddof=1) * math.sqrt(252))


def _max_drawdown(close: list[float]):
    if not close:
        return None, None
    arr = np.array(close, dtype=float)
    peak = np.maximum.accumulate(arr)
    dd = arr / peak - 1
    return float(dd.min()), float(dd[-1])


def _earnings_dates(t: yf.Ticker):
    df = t.get_earnings_dates(limit=100)
    if df is None or df.empty:
        return []
    out = []
    for d, row in df.iterrows():
        out.append({
            "date": pd.Timestamp(d).tz_localize(None).date().isoformat() if pd.Timestamp(d).tzinfo else pd.Timestamp(d).date().isoformat(),
            "estimate": num(row.get("EPS Estimate")),
            "reported": num(row.get("Reported EPS")),
            "surprise": num(row.get("Surprise(%)")),
        })
    out.sort(key=lambda x: x["date"])
    # dedoublonne (meme jour)
    ded = {}
    for e in out:
        ded[e["date"]] = e
    return list(ded.values())


def _ttm_eps_series(edates: list[dict]):
    """Serie du BPA ajuste sur 12 mois glissants a partir des publications."""
    rep = [e for e in edates if e["reported"] is not None]
    if len(rep) < 5:
        return []
    dates = pd.to_datetime([e["date"] for e in rep])
    gaps = np.diff(dates.values).astype("timedelta64[D]").astype(int)
    med = float(np.median(gaps)) if len(gaps) else 91
    n = 2 if med > 140 else 4  # semestriel vs trimestriel
    out = []
    for i in range(n - 1, len(rep)):
        window = rep[i - n + 1:i + 1]
        span = (pd.Timestamp(window[-1]["date"]) - pd.Timestamp(window[0]["date"])).days
        if span > (n - 1) * 120 + 40:  # trou dans les donnees
            continue
        out.append({"date": rep[i]["date"], "eps": sum(w["reported"] for w in window)})
    return out


def _valuation_history(t: yf.Ticker):
    df = t.get_valuation_measures(freq="quarterly", periods=None)
    if df is None or df.empty:
        return {}
    out = {}
    for row in df.index:
        key = str(row).lower()
        name = None
        if "forward" in key and "p/e" in key:
            name = "forwardPE"
        elif "trailing" in key and "p/e" in key:
            name = "trailingPE"
        elif "peg" in key:
            name = "peg"
        elif "price/sales" in key or "price to sales" in key:
            name = "ps"
        elif "price/book" in key or "price to book" in key:
            name = "pb"
        elif "ebitda" in key:
            name = "evEbitda"
        if not name:
            continue
        pts = []
        for c in df.columns:
            if c == "Current":
                continue
            v = num(df.at[row, c])
            try:
                d = pd.to_datetime(c).date().isoformat()
            except Exception:  # noqa: BLE001
                continue
            if v is not None:
                pts.append({"date": d, "value": v})
        pts.sort(key=lambda x: x["date"])
        out[name] = {"current": num(df.at[row, "Current"]) if "Current" in df.columns else None, "history": pts}
    return out


def _estimates(t: yf.Ticker):
    out = {}
    ee = safe(lambda: t.earnings_estimate, None, "earnings_estimate")
    if isinstance(ee, pd.DataFrame) and not ee.empty:
        out["eps"] = {p: {k: num(v) for k, v in row.items()} for p, row in ee.iterrows()}
    re_ = safe(lambda: t.revenue_estimate, None, "revenue_estimate")
    if isinstance(re_, pd.DataFrame) and not re_.empty:
        out["revenue"] = {p: {k: num(v) for k, v in row.items()} for p, row in re_.iterrows()}
    tr = safe(lambda: t.eps_trend, None, "eps_trend")
    if isinstance(tr, pd.DataFrame) and not tr.empty:
        out["trend"] = {p: {k: num(v) for k, v in row.items()} for p, row in tr.iterrows()}
    rv = safe(lambda: t.eps_revisions, None, "eps_revisions")
    if isinstance(rv, pd.DataFrame) and not rv.empty:
        out["revisions"] = {p: {k: num(v) for k, v in row.items()} for p, row in rv.iterrows()}
    ge = safe(lambda: t.growth_estimates, None, "growth_estimates")
    if isinstance(ge, pd.DataFrame) and not ge.empty:
        out["growth"] = {p: {k: num(v) for k, v in row.items()} for p, row in ge.iterrows()}
    eh = safe(lambda: t.earnings_history, None, "earnings_history")
    if isinstance(eh, pd.DataFrame) and not eh.empty:
        out["history"] = [
            {"date": pd.Timestamp(d).date().isoformat(), **{k: num(v) for k, v in row.items()}}
            for d, row in eh.iterrows()
        ]
    return out


def _analysts(t: yf.Ticker):
    out = {}
    rec = safe(lambda: t.recommendations, None, "recommendations")
    if isinstance(rec, pd.DataFrame) and not rec.empty:
        out["recommendations"] = [
            {k: (num(v) if k != "period" else v) for k, v in row.items()} for _, row in rec.iterrows()
        ]
    pt = safe(lambda: t.analyst_price_targets, None, "price_targets")
    if isinstance(pt, dict):
        out["targets"] = {k: num(v) for k, v in pt.items()}
    ud = safe(lambda: t.upgrades_downgrades, None, "upgrades")
    if isinstance(ud, pd.DataFrame) and not ud.empty:
        cutoff = now_naive() - pd.Timedelta(days=550)
        ud = ud[ud.index >= cutoff]
        items = []
        for d, row in ud.iterrows():
            items.append({
                "date": pd.Timestamp(d).date().isoformat(),
                "firm": row.get("Firm"),
                "to": row.get("ToGrade"),
                "from": row.get("FromGrade"),
                "action": row.get("Action"),
                "target": num(row.get("currentPriceTarget")),
                "prior": num(row.get("priorPriceTarget")),
                "targetAction": row.get("priceTargetAction"),
            })
        items.sort(key=lambda x: x["date"])
        out["actions"] = items
    return out


def _holders(t: yf.Ticker):
    out = {}
    mh = safe(lambda: t.major_holders, None, "major_holders")
    if isinstance(mh, pd.DataFrame) and not mh.empty:
        col = mh.columns[0]
        out["breakdown"] = {str(i): num(mh.at[i, col]) for i in mh.index}

    def tbl(df, n=12):
        if not isinstance(df, pd.DataFrame) or df.empty:
            return []
        rows = []
        for _, r in df.head(n).iterrows():
            rows.append({
                "holder": r.get("Holder"),
                "pct": num(r.get("pctHeld")),
                "shares": num(r.get("Shares")),
                "value": num(r.get("Value")),
                "change": num(r.get("pctChange")),
                "date": pd.Timestamp(r.get("Date Reported")).date().isoformat() if r.get("Date Reported") is not None and not pd.isna(r.get("Date Reported")) else None,
            })
        return rows

    out["institutions"] = tbl(safe(lambda: t.institutional_holders, None, "inst"))
    out["funds"] = tbl(safe(lambda: t.mutualfund_holders, None, "funds"))
    it = safe(lambda: t.insider_transactions, None, "insider_tx")
    if isinstance(it, pd.DataFrame) and not it.empty:
        rows = []
        for _, r in it.head(25).iterrows():
            d = r.get("Start Date")
            rows.append({
                "insider": r.get("Insider"),
                "position": r.get("Position"),
                "text": r.get("Text") or r.get("Transaction"),
                "shares": num(r.get("Shares")),
                "value": num(r.get("Value")),
                "date": pd.Timestamp(d).date().isoformat() if d is not None and not pd.isna(d) else None,
            })
        out["insiders"] = rows
    ip = safe(lambda: t.insider_purchases, None, "insider_purchases")
    if isinstance(ip, pd.DataFrame) and not ip.empty:
        out["insiderSummary"] = [{str(k): (num(v) if not isinstance(v, str) else v) for k, v in r.items()} for _, r in ip.iterrows()]
    return out


def _news(t: yf.Ticker):
    items = t.news or []
    out = []
    for n in items[:12]:
        c = n.get("content", n)
        url = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
        prov = (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher")
        date = c.get("pubDate") or (ts(c.get("providerPublishTime")) if c.get("providerPublishTime") else None)
        if c.get("title"):
            out.append({"title": c.get("title"), "url": url, "publisher": prov, "date": date, "summary": c.get("summary")})
    return out


def _calendar(t: yf.Ticker):
    cal = t.calendar or {}
    out = {}
    for k, v in cal.items():
        if isinstance(v, list):
            out[k] = [x.isoformat() if hasattr(x, "isoformat") else x for x in v]
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = num(v) if not isinstance(v, str) else v
    return out


ISIN_PREFIX = {
    "United States": "US", "France": "FR", "Netherlands": "NL", "Germany": "DE", "Belgium": "BE", "Italy": "IT",
    "Spain": "ES", "Portugal": "PT", "Ireland": "IE", "Luxembourg": "LU", "Switzerland": "CH", "United Kingdom": "GB",
    "Sweden": "SE", "Denmark": "DK", "Finland": "FI", "Norway": "NO", "Austria": "AT", "Japan": "JP", "Canada": "CA",
    "Australia": "AU", "China": "CN", "Hong Kong": "HK", "Taiwan": "TW", "South Korea": "KR", "India": "IN",
    "Brazil": "BR", "Greece": "GR", "Poland": "PL",
}


def _isin(t: yf.Ticker):
    v = t.isin
    return v if v and v != "-" and len(v) == 12 else None


def valid_isin(isin, country):
    """yfinance devine l'ISIN via un moteur de recherche externe et se trompe souvent : on ne garde
    que les ISIN dont le prefixe pays et la cle de controle sont coherents."""
    if not isin or len(isin) != 12 or not isin[:2].isalpha():
        return None
    exp = ISIN_PREFIX.get(country or "")
    # certaines societes sont immatriculees ailleurs (Irlande, Jersey, Pays-Bas...) : on tolere ces cas
    if exp and isin[:2] != exp and isin[:2] not in ("IE", "JE", "GG", "NL", "LU", "BM", "KY", "CH", "GB"):
        return None
    digits = "".join(str(int(c, 36)) for c in isin[:11].upper())
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return isin if (10 - total % 10) % 10 == int(isin[11]) else None


# ============================================================ financials
INCOME_ROWS = ["Total Revenue", "Cost Of Revenue", "Gross Profit", "Operating Income", "EBITDA", "Normalized EBITDA",
               "Net Income", "Net Income Common Stockholders", "Normalized Income", "Diluted EPS", "Basic EPS",
               "Interest Expense", "Pretax Income", "Tax Provision", "Research And Development",
               "Diluted Average Shares", "Total Unusual Items", "Selling General And Administration"]
BALANCE_ROWS = ["Total Debt", "Net Debt", "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
                "Stockholders Equity", "Total Assets", "Current Assets", "Current Liabilities", "Invested Capital",
                "Ordinary Shares Number", "Goodwill And Other Intangible Assets", "Long Term Debt"]
CASH_ROWS = ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow", "Repurchase Of Capital Stock",
             "Cash Dividends Paid", "Stock Based Compensation", "Issuance Of Debt", "Repayment Of Debt"]


def _financials(t: yf.Ticker):
    inc = safe(lambda: t.income_stmt, None, "income")
    bal = safe(lambda: t.balance_sheet, None, "balance")
    cf = safe(lambda: t.cash_flow, None, "cashflow")
    qinc = safe(lambda: t.quarterly_income_stmt, None, "qincome")
    qcf = safe(lambda: t.quarterly_cash_flow, None, "qcash")
    annual = {}
    annual.update(df_rows(inc, INCOME_ROWS))
    annual.update(df_rows(bal, BALANCE_ROWS))
    annual.update(df_rows(cf, CASH_ROWS))
    quarterly = {}
    quarterly.update(df_rows(qinc, INCOME_ROWS))
    quarterly.update(df_rows(qcf, CASH_ROWS))
    return {"annual": annual, "quarterly": quarterly}


def _val_at(series_map, row, i):
    s = series_map.get(row)
    if not s or i >= len(s) or i < -len(s):
        return None
    return s[i]["value"]


def derived_ratios(annual: dict):
    """Ratios par exercice : marges, ROE, ROIC, dette, couverture des interets, BPA recurrent."""
    ref = annual.get("Total Revenue") or annual.get("Net Income") or []
    dates = [p["date"] for p in ref]
    rows = []

    def get(row, d):
        for p in annual.get(row, []):
            if p["date"] == d:
                return p["value"]
        return None

    prev_eq = None
    for d in dates:
        rev = get("Total Revenue", d)
        gp = get("Gross Profit", d)
        op = get("Operating Income", d)
        ni = get("Net Income Common Stockholders", d) or get("Net Income", d)
        norm = get("Normalized Income", d)
        ebitda = get("Normalized EBITDA", d) or get("EBITDA", d)
        fcf = get("Free Cash Flow", d)
        eq = get("Stockholders Equity", d)
        debt = get("Total Debt", d)
        cash = get("Cash Cash Equivalents And Short Term Investments", d) or get("Cash And Cash Equivalents", d)
        intexp = get("Interest Expense", d)
        pretax = get("Pretax Income", d)
        tax = get("Tax Provision", d)
        invcap = get("Invested Capital", d)
        shares = get("Diluted Average Shares", d)
        capex = get("Capital Expenditure", d)
        buyback = get("Repurchase Of Capital Stock", d)
        divpaid = get("Cash Dividends Paid", d)
        taxrate = ratio(tax, pretax)
        if taxrate is None or taxrate < 0 or taxrate > 0.45:
            taxrate = 0.21
        nopat = op * (1 - taxrate) if op is not None else None
        net_debt = (debt - cash) if (debt is not None and cash is not None) else get("Net Debt", d)
        avg_eq = (eq + prev_eq) / 2 if (eq is not None and prev_eq is not None) else eq
        rows.append({
            "date": d,
            "revenue": rev, "grossProfit": gp, "operatingIncome": op, "netIncome": ni, "normalizedIncome": norm,
            "ebitda": ebitda, "fcf": fcf, "equity": eq, "debt": debt, "cash": cash, "netDebt": net_debt,
            "capex": capex, "buyback": buyback, "dividendsPaid": divpaid, "shares": shares,
            "grossMargin": ratio(gp, rev), "operatingMargin": ratio(op, rev), "netMargin": ratio(ni, rev),
            "fcfMargin": ratio(fcf, rev), "roe": ratio(ni, avg_eq) if (avg_eq and avg_eq > 0) else None,
            "roic": ratio(nopat, invcap) if (invcap and invcap > 0) else None,
            "netDebtEbitda": ratio(net_debt, ebitda) if (ebitda and ebitda > 0) else None,
            "debtEquity": ratio(debt, eq) if (eq and eq > 0) else None,
            "interestCoverage": ratio(op, abs(intexp)) if intexp else None,
            "fcfConversion": ratio(fcf, ni) if (ni and ni > 0) else None,
            "epsReported": get("Diluted EPS", d),
            "epsAdjusted": ratio(norm, shares),
        })
        prev_eq = eq if eq is not None else prev_eq
    return rows


# ============================================================ main analysis
def full_analysis(symbol: str, pool: ThreadPoolExecutor):
    t = yf.Ticker(symbol)
    info = safe(lambda: t.info, {}, "info") or {}
    if not info_complete(info):  # Yahoo refuse parfois une premiere fois : on retente une fois
        info = safe(lambda: yf.Ticker(symbol).info, {}, "info") or info
    hist = safe(lambda: price_history(t), None, "history")
    meta = _history_meta(t) if hist and hist["close"] else {}
    partial = not info_complete(info)
    if partial:
        log.warning("%s : profil Yahoo incomplet (%d champs), donnees detaillees indisponibles pour l'instant", symbol, len(info))
        for k_info, k_meta in (("currency", "currency"), ("fullExchangeName", "fullExchangeName"), ("regularMarketPrice", "regularMarketPrice")):
            if not info.get(k_info) and meta.get(k_meta):
                info[k_info] = meta[k_meta]
        if not info.get("quoteType") and meta.get("instrumentType"):
            info["quoteType"] = meta["instrumentType"]
    if (not hist or not hist["close"]) and not info.get("regularMarketPrice") and not info.get("currentPrice"):
        raise NotFound(f"Aucune donnée trouvée pour « {symbol} ». Vérifie le symbole (ex : AAPL, MC.PA, AIR.PA, ASML.AS) ou utilise la barre de recherche.")
    hist = hist or {"dates": [], "close": [], "adj": [], "dividends": [], "splits": []}

    price = num(info.get("currentPrice")) or num(info.get("regularMarketPrice")) or (hist["close"][-1] if hist["close"] else None)
    prev = num(info.get("regularMarketPreviousClose")) or num(info.get("previousClose")) or (hist["close"][-2] if len(hist["close"]) > 1 else None)
    qtype = info.get("quoteType", "EQUITY")
    is_equity = qtype == "EQUITY"

    jobs = {
        "edates": lambda: _earnings_dates(t),
        "valuation": lambda: _valuation_history(t),
        "estimates": lambda: _estimates(t),
        "analysts": lambda: _analysts(t),
        "holders": lambda: _holders(t),
        "news": lambda: _news(t),
        "calendar": lambda: _calendar(t),
        "financials": lambda: _financials(t),
        "iv": lambda: _implied_vol(t, price, ratio(info.get("dividendRate"), price)),
        "isin": lambda: _isin(t),
    }
    if not is_equity:
        for k in ("edates", "valuation", "estimates", "analysts", "financials"):
            jobs.pop(k)
    futs = {k: pool.submit(safe, fn, None, k) for k, fn in jobs.items()}
    res = {}
    for k, f in futs.items():
        try:
            res[k] = f.result(timeout=8 if k == "isin" else 45)
        except FutTimeout:
            res[k] = None
        except Exception:  # noqa: BLE001
            res[k] = None

    currency = info.get("currency")
    fin_currency = info.get("financialCurrency") or currency
    fx_fin = 1.0
    if fin_currency and currency and fin_currency != currency:
        fx_fin = fx_rate(fin_currency, currency) or 1.0

    mcap = num(info.get("marketCap"))
    fxusd = fx_rate(currency, "USD") if currency else None
    mcap_usd = mcap * fxusd if (mcap and fxusd) else mcap

    financials = res.get("financials") or {"annual": {}, "quarterly": {}}
    ratios = derived_ratios(financials.get("annual", {}))
    estimates = res.get("estimates") or {}
    analysts = res.get("analysts") or {}
    edates = res.get("edates") or []
    valuation_hist = res.get("valuation") or {}
    holders = res.get("holders") or {}
    calendar = res.get("calendar") or {}

    # ------------------------------------------------ profil
    country = info.get("country")
    profile = {
        "symbol": symbol,
        "name": company_name(symbol, info, meta),
        "shortName": info.get("shortName") or meta.get("shortName"),
        "partial": partial,
        "type": qtype,
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "currency": currency,
        "financialCurrency": fin_currency,
        "country": country,
        "sector": info.get("sectorDisp") or info.get("sector"),
        "industry": info.get("industryDisp") or info.get("industry"),
        "website": info.get("website"),
        "summary": info.get("longBusinessSummary"),
        "employees": info.get("fullTimeEmployees"),
        "isin": valid_isin(res.get("isin"), country),
        "marketCap": mcap,
        "marketCapUSD": mcap_usd,
        "capCategory": cap_category(mcap_usd),
        "enterpriseValue": num(info.get("enterpriseValue")),
        "peaEligible": (country in EU_EEA) if country else None,
        "price": price,
        "previousClose": prev,
        "change": ratio(price - prev, prev) if (price and prev) else None,
        "dayHigh": num(info.get("dayHigh")),
        "dayLow": num(info.get("dayLow")),
        "high52": num(info.get("fiftyTwoWeekHigh")),
        "low52": num(info.get("fiftyTwoWeekLow")),
        "volume": num(info.get("volume")),
        "avgVolume": num(info.get("averageVolume")),
        "beta": num(info.get("beta")),
        "sharesOutstanding": num(info.get("sharesOutstanding")),
        "floatShares": num(info.get("floatShares")),
        "lastFiscalYearEnd": ts(info.get("lastFiscalYearEnd")),
        "nextFiscalYearEnd": ts(info.get("nextFiscalYearEnd")),
        "marketState": info.get("marketState"),
        "tradingview": tv_symbol(symbol, info.get("exchange") or meta.get("exchangeName")),
        "updated": datetime.now(timezone.utc).isoformat(),
    }

    # ------------------------------------------------ croissance BPA anticipee
    eps_est = estimates.get("eps", {})
    e0 = num((eps_est.get("0y") or {}).get("avg"))
    e1 = num((eps_est.get("+1y") or {}).get("avg"))
    e_prev = num((eps_est.get("0y") or {}).get("yearAgoEps"))
    stmt_eps = None  # dernier BPA annuel recurrent (etats financiers), converti en devise de cotation
    for r_ in reversed(ratios):
        v_ = r_.get("epsAdjusted") or r_.get("epsReported")
        if v_:
            stmt_eps = v_ * fx_fin
            break
    growth_fwd = None
    growth_method = None
    if e_prev and stmt_eps and stmt_eps > 0 and not (0.65 < e_prev / stmt_eps < 1.5):
        # le "BPA il y a un an" du consensus est incoherent avec les comptes publies : on prend les comptes
        e_prev = stmt_eps
        growth_method_base = "BPA attendu dans 2 ans vs dernier BPA récurrent publié (comptes annuels)"
    else:
        growth_method_base = "BPA attendu dans 2 ans vs dernier exercice publié (consensus des analystes)"
    if e_prev and e1 and e_prev > 0 and e1 > 0:
        growth_fwd = (e1 / e_prev) ** 0.5 - 1
        growth_method = growth_method_base
    elif e0 and e1 and e0 > 0:
        growth_fwd = e1 / e0 - 1
        growth_method = "BPA de l'exercice suivant vs exercice en cours (consensus)"
    ltg = None
    ge = estimates.get("growth", {})
    for k in ("LTG", "+5y"):
        if k in ge and ge[k].get("stockTrend") is not None:
            ltg = ge[k]["stockTrend"]
    if growth_fwd is None and ltg is not None:
        growth_fwd, growth_method = ltg, "Croissance à long terme attendue (consensus)"
    if growth_fwd is None:
        eg = num(info.get("earningsGrowth"))
        if eg is not None:
            growth_fwd, growth_method = eg, "Croissance des bénéfices du dernier trimestre (pas d'estimations disponibles)"

    rev_est = estimates.get("revenue", {})
    rev_growth_fwd = None
    r1 = num((rev_est.get("+1y") or {}).get("avg"))
    r_prev = num((rev_est.get("0y") or {}).get("yearAgoRevenue"))
    if r1 and r_prev and r_prev > 0:
        rev_growth_fwd = (r1 / r_prev) ** 0.5 - 1

    # croissance passee du BPA (ajuste) : publications trimestrielles sur 10 ans, sinon etats financiers
    ttm = _ttm_eps_series(edates)
    ref_eps = stmt_eps or num(info.get("trailingEps"))
    if ttm and ref_eps and ref_eps > 0 and not (0.55 < ttm[-1]["eps"] / ref_eps < 1.8):
        log.info("%s: BPA 12 mois issus des publications incoherents (%.2f vs %.2f), ignores", symbol, ttm[-1]["eps"], ref_eps)
        ttm = []
    past_growth, past_years = None, None
    if len(ttm) >= 8:
        last = ttm[-1]
        target_date = pd.Timestamp(last["date"]) - pd.DateOffset(years=10)
        cands = [p for p in ttm if pd.Timestamp(p["date"]) <= target_date + pd.Timedelta(days=60)]
        first = cands[-1] if cands else ttm[0]
        yrs = (pd.Timestamp(last["date"]) - pd.Timestamp(first["date"])).days / 365.25
        if yrs >= 2:
            past_growth, past_years = cagr(first["eps"], last["eps"], yrs), round(yrs)
    if past_growth is None:
        pts = [(r_["date"], r_.get("epsAdjusted") or r_.get("epsReported")) for r_ in ratios]
        pts = [p_ for p_ in pts if p_[1]]
        if len(pts) >= 2:
            yrs = (pd.Timestamp(pts[-1][0]) - pd.Timestamp(pts[0][0])).days / 365.25
            if yrs >= 1.5:
                past_growth, past_years = cagr(pts[0][1], pts[-1][1], yrs), round(yrs)

    # ------------------------------------------------ risque
    ivd = res.get("iv")
    hv = _hist_vol(hist["close"])
    mdd, cur_dd = _max_drawdown(hist["adj"] or hist["close"])
    if ivd:
        risk_vol, risk_src = ivd["iv"], f"Volatilité implicite des options (modèle de Black-Scholes & Merton), échéance {ivd['expiry']}"
    else:
        risk_vol, risk_src = hv, "Volatilité historique sur 1 an (pas d'options cotées sur ce titre)"
    move6m = risk_vol * math.sqrt(0.5) if risk_vol else None
    risk_label = None
    if risk_vol is not None:
        risk_label = "Faible" if risk_vol < 0.22 else "Modéré" if risk_vol < 0.32 else "À surveiller" if risk_vol < 0.50 else "Élevé"

    # ------------------------------------------------ valorisation
    lfy = info.get("lastFiscalYearEnd")
    frac = None
    if lfy:
        frac = (datetime.now(timezone.utc).timestamp() - float(lfy)) / (365.25 * 86400)
        frac = min(max(frac, 0.0), 1.0)
    eps_ntm = None
    if e0 is not None and e1 is not None and frac is not None:
        eps_ntm = (1 - frac) * e0 + frac * e1
    elif e1 is not None:
        eps_ntm = e1
    elif num(info.get("forwardEps")):
        eps_ntm = num(info.get("forwardEps"))
    pe_ntm = ratio(price, eps_ntm) if (eps_ntm and eps_ntm > 0) else None
    pe_ttm = num(info.get("trailingPE")) or (ratio(price, info.get("trailingEps")) if num(info.get("trailingEps")) and num(info.get("trailingEps")) > 0 else None)

    fpe_hist = (valuation_hist.get("forwardPE") or {}).get("history", [])
    tpe_hist = (valuation_hist.get("trailingPE") or {}).get("history", [])
    five_years_ago = (now_naive() - pd.DateOffset(years=5)).date().isoformat()

    def avg_hist(h):
        vals = [p["value"] for p in h if p["date"] >= five_years_ago and p["value"] and 0 < p["value"] < 300]
        return (float(np.mean(vals)), len(vals)) if len(vals) >= 4 else (None, len(vals))

    def coherent(hist_pts, current_yahoo, ours):
        """Ecarte un historique Yahoo dont le niveau actuel ne colle pas a notre calcul."""
        if not hist_pts or not ours:
            return hist_pts
        ref = current_yahoo or hist_pts[-1]["value"]
        return hist_pts if (ref and 0.6 < ref / ours < 1.65) else []

    fpe_hist = coherent(fpe_hist, (valuation_hist.get("forwardPE") or {}).get("current"), pe_ntm)
    tpe_hist = coherent(tpe_hist, (valuation_hist.get("trailingPE") or {}).get("current"), pe_ttm)
    pe_fwd_avg, nf = avg_hist(fpe_hist)
    pe_ttm_avg, nt = avg_hist(tpe_hist)

    # repli : PE mensuel = cours / dernier BPA annuel connu (publie ~75 jours apres la cloture)
    def pe_from_statements(key):
        pts = [(pd.Timestamp(r_["date"]) + pd.Timedelta(days=75), (r_.get(key) or 0) * fx_fin) for r_ in ratios if r_.get(key)]
        if len(pts) < 2 or not hist["dates"]:
            return []
        px_ = pd.Series(hist["close"], index=pd.to_datetime(hist["dates"]))
        out_ = []
        for m in pd.date_range(end=px_.index[-1], periods=12 * 6, freq="ME"):
            known = [e for d_, e in pts if d_ <= m]
            p_ = px_[px_.index <= m]
            if not known or p_.empty or known[-1] <= 0:
                continue
            out_.append({"date": m.date().isoformat(), "value": float(p_.iloc[-1] / known[-1])})
        return out_

    pe_stmt_adj = pe_from_statements("epsAdjusted")
    pe_stmt_pub = pe_from_statements("epsReported")

    # PE ajuste historique calcule = cours / BPA ajuste 12 mois glissants (publications)
    pe_adj_hist = []
    if ttm and hist["dates"]:
        px = pd.Series(hist["close"], index=pd.to_datetime(hist["dates"]))
        eps_s = pd.Series([p["eps"] for p in ttm], index=pd.to_datetime([p["date"] for p in ttm]))
        months = pd.date_range(end=px.index[-1], periods=12 * 10, freq="ME")
        for m in months:
            if m < eps_s.index[0]:
                continue
            e = eps_s[eps_s.index <= m]
            p = px[px.index <= m]
            if e.empty or p.empty or e.iloc[-1] <= 0:
                continue
            pe_adj_hist.append({"date": m.date().isoformat(), "value": float(p.iloc[-1] / e.iloc[-1])})
    pe_adj_avg, _ = avg_hist(pe_adj_hist)
    pe_stmt_adj_avg, _ = avg_hist(pe_stmt_adj)
    pe_stmt_pub_avg, _ = avg_hist(pe_stmt_pub)

    def sane(avg, cur):
        return avg if (avg and (not cur or 0.4 < avg / cur < 2.5)) else None

    ref_adj, src_adj = None, None
    for cand, lab in ((pe_fwd_avg, "PE forward historique (Yahoo)"),
                      (pe_adj_avg, "PE ajusté calculé (cours / BPA ajusté 12 mois glissants)"),
                      (pe_stmt_adj_avg, "PE calculé sur les BPA récurrents annuels (comptes publiés)")):
        if sane(cand, pe_ntm):
            ref_adj, src_adj = cand, lab
            break
    ref_pub = sane(pe_ttm_avg, pe_ttm) or sane(pe_stmt_pub_avg, pe_ttm)
    discount_adj = (pe_ntm / ref_adj - 1) if (pe_ntm and ref_adj) else None
    discount_pub = (pe_ttm / ref_pub - 1) if (pe_ttm and ref_pub) else None
    peg = ratio(pe_ntm, growth_fwd * 100) if (pe_ntm and growth_fwd and growth_fwd > 0) else None

    fcf_ttm = num(info.get("freeCashflow"))
    fcf_yield = ratio(fcf_ttm * fx_fin, mcap) if (fcf_ttm and mcap) else None

    valuation = {
        "peNtm": pe_ntm, "epsNtm": eps_ntm, "peTtm": pe_ttm,
        "peNtmAvg5y": ref_adj, "peNtmAvgSource": src_adj,
        "peTtmAvg5y": ref_pub,
        "discountAdjusted": discount_adj, "discountReported": discount_pub,
        "peg": peg, "pb": num(info.get("priceToBook")), "ps": num(info.get("priceToSalesTrailing12Months")),
        "evEbitda": num(info.get("enterpriseToEbitda")), "evRevenue": num(info.get("enterpriseToRevenue")),
        "fcfYield": fcf_yield, "earningsYield": ratio(1, pe_ntm) if pe_ntm else None,
        "history": {"forwardPE": fpe_hist, "trailingPE": tpe_hist, "adjustedPE": pe_adj_hist or pe_stmt_adj},
        "fiscalYearFraction": frac,
    }

    # ------------------------------------------------ dividendes
    divs = hist.get("dividends", [])
    div_rate = num(info.get("dividendRate"))
    last12 = [d for d in divs if d["date"] >= (now_naive() - pd.DateOffset(months=12)).date().isoformat()]
    ttm_div = sum(d["value"] for d in last12) if last12 else None
    if not div_rate:
        div_rate = ttm_div
    by_year = {}
    for d in divs:
        y = int(d["date"][:4])
        by_year[y] = by_year.get(y, 0) + d["value"]
    this_year = datetime.now().year
    full_years = sorted(y for y in by_year if y < this_year)
    div_cagr5 = None
    if len(full_years) >= 6 and by_year.get(full_years[-6]):
        div_cagr5 = cagr(by_year[full_years[-6]], by_year[full_years[-1]], 5)
    streak = 0
    for a_, b_ in zip(reversed(full_years[:-1]), reversed(full_years[1:])):
        if b_ - a_ == 1 and by_year[b_] >= by_year[a_] * 0.999:
            streak += 1
        else:
            break
    dividends = {
        "annual": div_rate, "yield": ratio(div_rate, price) if div_rate else 0.0,
        "ttm": ttm_div, "payout": num(info.get("payoutRatio")),
        "cagr5": div_cagr5, "growthStreak": streak,
        "exDate": ts(info.get("exDividendDate")),
        "avgYield5y": (num(info.get("fiveYearAvgDividendYield")) or 0) / 100 if info.get("fiveYearAvgDividendYield") else None,
        "byYear": [{"year": y, "value": by_year[y]} for y in sorted(by_year)][-25:],
    }

    # ------------------------------------------------ qualite
    last_r = ratios[-1] if ratios else {}
    roe = num(info.get("returnOnEquity")) if info.get("returnOnEquity") is not None else last_r.get("roe")
    op_margin = num(info.get("operatingMargins")) if info.get("operatingMargins") is not None else last_r.get("operatingMargin")
    gross_margin = num(info.get("grossMargins")) if info.get("grossMargins") is not None else last_r.get("grossMargin")
    net_margin = num(info.get("profitMargins")) if info.get("profitMargins") is not None else last_r.get("netMargin")
    total_debt, total_cash, ebitda = num(info.get("totalDebt")), num(info.get("totalCash")), num(info.get("ebitda"))
    net_debt = (total_debt - total_cash) if (total_debt is not None and total_cash is not None) else last_r.get("netDebt")
    nd_ebitda = ratio(net_debt, ebitda) if (ebitda and ebitda > 0 and net_debt is not None) else last_r.get("netDebtEbitda")
    roic = last_r.get("roic")
    # stabilite des marges
    margins = [r["operatingMargin"] for r in ratios if r.get("operatingMargin") is not None]
    margin_stab = float(np.std(margins)) if len(margins) >= 3 else None
    quality = {
        "roe": roe, "roic": roic, "grossMargin": gross_margin, "operatingMargin": op_margin, "netMargin": net_margin,
        "netDebt": net_debt, "netDebtEbitda": nd_ebitda, "totalDebt": total_debt, "totalCash": total_cash,
        "debtEquity": (num(info.get("debtToEquity")) / 100) if info.get("debtToEquity") is not None else last_r.get("debtEquity"),
        "currentRatio": num(info.get("currentRatio")), "interestCoverage": last_r.get("interestCoverage"),
        "fcfConversion": last_r.get("fcfConversion"), "marginStability": margin_stab,
        "fcf": fcf_ttm, "ebitda": ebitda,
    }

    # ------------------------------------------------ perspectives
    tg = analysts.get("targets", {})
    t_mean = tg.get("mean") or num(info.get("targetMeanPrice"))
    t_low = tg.get("low") or num(info.get("targetLowPrice"))
    t_high = tg.get("high") or num(info.get("targetHighPrice"))
    n_an = num(info.get("numberOfAnalystOpinions"))
    pe_target = min(x for x in [pe_ntm, ref_adj] if x) if (pe_ntm or ref_adj) else None
    g5 = growth_fwd
    if g5 is not None:
        g5 = max(min(g5, 0.30), -0.10)
    price5 = eps_ntm * (1 + g5) ** 5 * pe_target if (eps_ntm and eps_ntm > 0 and g5 is not None and pe_target) else None
    ret5 = cagr(price, price5, 5) if price5 else None
    outlook = {
        "targetMean": t_mean, "targetLow": t_low, "targetHigh": t_high, "targetMedian": tg.get("median"),
        "analysts": n_an, "upsideMean": ratio(t_mean - price, price) if (t_mean and price) else None,
        "upsideLow": ratio(t_low - price, price) if (t_low and price) else None,
        "upsideHigh": ratio(t_high - price, price) if (t_high and price) else None,
        "recommendation": info.get("recommendationKey"), "recommendationMean": num(info.get("recommendationMean")),
        "price5y": price5, "return5y": ret5,
        "return5yTotal": (ret5 + (dividends["yield"] or 0)) if ret5 is not None else None,
        "warning": " ".join(w for w in [
            "Écart très important entre l'objectif des analystes et le cours : vérifie la devise ou la fraîcheur des objectifs."
            if (t_mean and price and not (0.6 < t_mean / price < 1.6)) else "",
            "Croissance attendue exceptionnelle (plus de 40 %/an) : probable rebond après une mauvaise année ou estimations à vérifier."
            if (growth_fwd is not None and growth_fwd > 0.40) else "",
        ] if w) or None,
        "price5yMethod": "BPA des 12 prochains mois x (1 + croissance attendue)^5 x min(PE actuel, PE moyen 5 ans)",
    }

    # ------------------------------------------------ DCF (donnees, calcul interactif cote navigateur)
    fcf_hist = [r["fcf"] for r in ratios if r.get("fcf") is not None]
    fcf_base = fcf_ttm if fcf_ttm else (fcf_hist[-1] if fcf_hist else None)
    if fcf_hist and len(fcf_hist) >= 3:
        fcf_avg3 = float(np.mean(fcf_hist[-3:]))
    else:
        fcf_avg3 = fcf_base
    dcf = {
        "fcf": fcf_base * fx_fin if fcf_base else None,
        "fcfAvg3": fcf_avg3 * fx_fin if fcf_avg3 else None,
        "shares": num(info.get("sharesOutstanding")) or (last_r.get("shares")),
        "netDebt": net_debt * fx_fin if net_debt is not None else None,
        # hypothese prudente : la croissance des free cash-flows est bornee a 15 %/an (les BPA de
        # sociétés cycliques peuvent rebondir fortement d'une année sur l'autre)
        "growth": max(min(growth_fwd if growth_fwd is not None else 0.05, 0.15), -0.02),
        "discount": 0.09, "terminal": 0.025,
    }
    dcf["value"] = dcf_value(dcf)

    # ------------------------------------------------ scores (0-5)
    s_growth = None
    if growth_fwd is not None:
        s_growth = lerp_score(growth_fwd, [(-0.05, 0.5), (0.0, 1.2), (0.05, 2.2), (0.10, 3.2), (0.15, 4.0), (0.22, 4.8), (0.30, 5)])
        if rev_growth_fwd is not None:
            s_growth = 0.75 * s_growth + 0.25 * lerp_score(rev_growth_fwd, [(-0.05, 0.5), (0.0, 1.2), (0.05, 2.5), (0.10, 3.5), (0.20, 5)])
    subs = []
    disc = discount_adj if discount_adj is not None else discount_pub
    if disc is not None:
        subs.append(lerp_score(-disc, [(-0.5, 0.5), (-0.25, 1.5), (0.0, 3.0), (0.2, 4.2), (0.4, 5)]))
    if peg is not None:
        subs.append(lerp_score(-peg, [(-4, 0.8), (-3, 1.5), (-2, 2.8), (-1.5, 3.6), (-1, 4.5), (-0.6, 5)]))
    if fcf_yield is not None:
        subs.append(lerp_score(fcf_yield, [(0, 1), (0.02, 2), (0.04, 3), (0.06, 4), (0.09, 5)]))
    s_val = float(np.mean(subs)) if subs else None
    qsubs = []
    if roe is not None:
        qsubs.append(lerp_score(roe, [(0, 0.5), (0.08, 2), (0.15, 3.5), (0.22, 4.5), (0.30, 5)]))
    if roic is not None:
        qsubs.append(lerp_score(roic, [(0, 0.5), (0.06, 2), (0.12, 3.5), (0.20, 4.5), (0.28, 5)]))
    if op_margin is not None:
        qsubs.append(lerp_score(op_margin, [(0, 0.5), (0.08, 2), (0.15, 3.2), (0.25, 4.5), (0.35, 5)]))
    if gross_margin is not None:
        qsubs.append(lerp_score(gross_margin, [(0.15, 1), (0.30, 2.5), (0.50, 4), (0.65, 5)]))
    if nd_ebitda is not None:
        qsubs.append(lerp_score(-nd_ebitda, [(-5, 0.5), (-3, 1.8), (-2, 3), (-1, 4), (0, 5)]))
    if margin_stab is not None:
        qsubs.append(lerp_score(-margin_stab, [(-0.15, 1), (-0.08, 2.5), (-0.04, 3.8), (-0.015, 5)]))
    s_quality = float(np.mean(qsubs)) if qsubs else None
    s_div = None
    if dividends["yield"] and dividends["yield"] > 0.003:
        dsub = [lerp_score(dividends["yield"], [(0.005, 1), (0.015, 2), (0.025, 3), (0.04, 4), (0.06, 5)])]
        if div_cagr5 is not None:
            dsub.append(lerp_score(div_cagr5, [(-0.05, 0.5), (0, 1.5), (0.04, 3), (0.08, 4), (0.12, 5)]))
        pr = dividends["payout"]
        if pr is not None:
            dsub.append(lerp_score(pr, [(0.2, 5), (0.5, 4.5), (0.7, 3.5), (0.9, 2), (1.2, 0.5)]))
        if streak:
            dsub.append(lerp_score(streak, [(0, 1), (5, 3), (10, 4), (20, 5)]))
        s_div = float(np.mean(dsub))
    s_risk = None
    if risk_vol is not None:
        s_risk = lerp_score(-risk_vol, [(-0.80, 0.5), (-0.55, 1.5), (-0.40, 2.6), (-0.32, 3.3), (-0.24, 4.2), (-0.15, 5)])
        if nd_ebitda is not None and nd_ebitda > 3:
            s_risk = max(0.5, s_risk - 0.5)
    scores = {
        "growth": s_growth, "valuation": s_val, "quality": s_quality, "dividend": s_div, "risk": s_risk,
        "details": {"valuationSubs": subs, "qualitySubs": qsubs},
    }

    indicators = {
        "growth": {"value": growth_fwd, "method": growth_method, "past": past_growth, "pastYears": past_years,
                   "ltg": ltg, "revenue": rev_growth_fwd},
        "risk": {"value": risk_vol, "source": risk_src, "label": risk_label, "move6m": move6m,
                 "rangeLow": price * math.exp(-move6m) if (price and move6m) else None,
                 "rangeHigh": price * math.exp(move6m) if (price and move6m) else None,
                 "implied": ivd, "historical": hv, "maxDrawdown": mdd, "currentDrawdown": cur_dd,
                 "beta": num(info.get("beta"))},
    }

    return {
        "profile": profile,
        "history": hist,
        "indicators": indicators,
        "valuation": valuation,
        "dividends": dividends,
        "quality": quality,
        "outlook": outlook,
        "dcf": dcf,
        "scores": scores,
        "estimates": estimates,
        "analysts": analysts,
        "holders": holders,
        "calendar": calendar,
        "earningsDates": edates,
        "ttmEps": ttm,
        "financials": financials,
        "ratios": ratios,
        "news": res.get("news") or [],
    }


def dcf_value(d):
    fcf, shares, nd = d.get("fcfAvg3") or d.get("fcf"), d.get("shares"), d.get("netDebt") or 0
    g, r, tg = d["growth"], d["discount"], d["terminal"]
    if not fcf or fcf <= 0 or not shares or r <= tg:
        return None
    pv, f = 0.0, fcf
    for year in range(1, 11):
        gy = g if year <= 5 else g + (tg - g) * (year - 5) / 5
        f *= 1 + gy
        pv += f / (1 + r) ** year
    tv = f * (1 + tg) / (r - tg)
    pv += tv / (1 + r) ** 10
    return (pv - nd) / shares


def summary_of(a: dict):
    p, ind, v, q, o, dv = a["profile"], a["indicators"], a["valuation"], a["quality"], a["outlook"], a["dividends"]
    nxt = None
    cal = a.get("calendar") or {}
    ed = cal.get("Earnings Date")
    if isinstance(ed, list) and ed:
        nxt = ed[0]
    elif isinstance(ed, str):
        nxt = ed
    return {
        "symbol": p["symbol"], "name": p["name"], "partial": p.get("partial", False), "currency": p["currency"], "price": p["price"], "change": p["change"],
        "sector": p["sector"], "country": p["country"], "capCategory": p["capCategory"], "marketCap": p["marketCap"],
        "peaEligible": p["peaEligible"], "website": p["website"],
        "growth": ind["growth"]["value"], "risk": ind["risk"]["value"], "riskLabel": ind["risk"]["label"],
        "peNtm": v["peNtm"], "peAvg": v["peNtmAvg5y"], "discount": v["discountAdjusted"] if v["discountAdjusted"] is not None else v["discountReported"],
        "dividendYield": dv["yield"], "upside": o["upsideMean"], "return5y": o["return5yTotal"],
        "roe": q["roe"], "operatingMargin": q["operatingMargin"], "netDebtEbitda": q["netDebtEbitda"],
        "scores": {k: a["scores"][k] for k in ("growth", "valuation", "quality", "dividend", "risk")},
        "nextEarnings": nxt, "exDividend": dv["exDate"], "dividendAnnual": dv["annual"],
        "dcf": a["dcf"]["value"], "targetMean": o["targetMean"],
    }


# ============================================================ market overview
MARKET = {
    "indices": [
        ("^FCHI", "CAC 40", "FR"), ("^GSPC", "S&P 500", "US"), ("^NDX", "Nasdaq 100", "US"), ("^DJI", "Dow Jones", "US"),
        ("^STOXX50E", "Euro Stoxx 50", "EU"), ("^STOXX", "STOXX Europe 600", "EU"), ("^GDAXI", "DAX", "DE"),
        ("^FTSE", "FTSE 100", "GB"), ("^N225", "Nikkei 225", "JP"), ("ASHR", "Chine CSI 300 (ETF)", "CN"),
        ("^HSI", "Hang Seng", "HK"), ("URTH", "MSCI World (ETF)", "WORLD"), ("EEM", "Marchés émergents (ETF)", "EM"),
        ("^VIX", "VIX (volatilité S&P 500)", "US"),
    ],
    "commodities": [
        ("GC=F", "Or", ""), ("SI=F", "Argent", ""), ("BZ=F", "Pétrole Brent", ""), ("CL=F", "Pétrole WTI", ""),
        ("NG=F", "Gaz naturel", ""), ("HG=F", "Cuivre", ""), ("ZW=F", "Blé", ""),
    ],
    "rates": [
        ("^IRX", "US 3 mois", ""), ("^FVX", "US 5 ans", ""), ("^TNX", "US 10 ans", ""), ("^TYX", "US 30 ans", ""),
    ],
    "fx": [
        ("EURUSD=X", "EUR/USD", ""), ("EURGBP=X", "EUR/GBP", ""), ("EURJPY=X", "EUR/JPY", ""), ("EURCHF=X", "EUR/CHF", ""),
        ("BTC-EUR", "Bitcoin (EUR)", ""), ("ETH-EUR", "Ethereum (EUR)", ""),
    ],
}


def market_overview():
    syms = [s for grp in MARKET.values() for s, _, _ in grp]
    data = yf.download(syms, period="2y", interval="1d", group_by="ticker", auto_adjust=False, threads=True, progress=False)
    out = {}
    jan1 = pd.Timestamp(datetime.now().year, 1, 1)
    for grp, items in MARKET.items():
        rows = []
        for s, label, flag in items:
            try:
                c = data[s]["Close"].dropna()
            except Exception:  # noqa: BLE001
                c = pd.Series(dtype=float)
            if len(c) < 30:
                c2 = safe(lambda: yf.Ticker(s).history(period="2y", interval="1d")["Close"].dropna(), None, f"market {s}")
                if c2 is not None and len(c2) > len(c):
                    c = c2
            if c.empty:
                rows.append({"symbol": s, "label": label, "flag": flag})
                continue
            c.index = pd.to_datetime(c.index).tz_localize(None) if getattr(c.index, "tz", None) else pd.to_datetime(c.index)
            last, prev = float(c.iloc[-1]), float(c.iloc[-2]) if len(c) > 1 else None
            ytd_base = c[c.index < jan1]
            y1 = c[c.index <= c.index[-1] - pd.DateOffset(years=1)]
            spark = c[c.index >= c.index[-1] - pd.DateOffset(years=1)]
            step = max(1, len(spark) // 80)
            rows.append({
                "symbol": s, "label": label, "flag": flag, "last": last, "date": c.index[-1].date().isoformat(),
                "change": (last / prev - 1) if prev else None,
                "ytd": (last / float(ytd_base.iloc[-1]) - 1) if not ytd_base.empty else None,
                "y1": (last / float(y1.iloc[-1]) - 1) if not y1.empty else None,
                "spark": [round(float(x), 4) for x in spark.iloc[::step]],
            })
        out[grp] = rows
    return out


# ============================================================ univers pour le classement
UNIVERSES = {
    "cac40": ["AC.PA", "AI.PA", "AIR.PA", "MT.AS", "CS.PA", "BNP.PA", "EN.PA", "CAP.PA", "CA.PA", "ACA.PA",
              "BN.PA", "DSY.PA", "EDEN.PA", "ENGI.PA", "EL.PA", "ERF.PA", "RMS.PA", "KER.PA", "OR.PA", "LR.PA",
              "MC.PA", "ML.PA", "ORA.PA", "RI.PA", "PUB.PA", "RNO.PA", "SAF.PA", "SGO.PA", "SAN.PA", "SU.PA",
              "GLE.PA", "STLAP.PA", "STMPA.PA", "TEP.PA", "HO.PA", "TTE.PA", "URW.PA", "VIE.PA", "DG.PA", "VIV.PA"],
    "eurostoxx": ["ASML.AS", "SAP.DE", "MC.PA", "SIE.DE", "TTE.PA", "ALV.DE", "SAN.PA", "OR.PA", "AIR.PA", "SU.PA",
                  "IBE.MC", "DTE.DE", "AI.PA", "BNP.PA", "SAN.MC", "EL.PA", "ENEL.MI", "INGA.AS", "MUV2.DE", "RMS.PA",
                  "CS.PA", "SAF.PA", "ABI.BR", "ISP.MI", "UCG.MI", "BBVA.MC", "ITX.MC", "DG.PA", "ADYEN.AS", "PRX.AS"],
    "us_mega": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK-B", "LLY", "JPM", "V", "MA",
                "UNH", "XOM", "COST", "HD", "PG", "JNJ", "NFLX", "ADBE", "CRM", "ORCL", "AMD", "ASML", "KO", "PEP",
                "MCD", "NKE", "ABBV"],
}
UNIVERSE_LABELS = {"cac40": "CAC 40", "eurostoxx": "Grandes valeurs européennes", "us_mega": "Géants américains"}
