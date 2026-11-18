/* Analyse Actions - interface */
"use strict";

// ================================================================= stockage
const store = {
  get(k, d) { try { const v = localStorage.getItem("aa:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("aa:" + k, JSON.stringify(v)); } catch {} },
};
const watchlist = () => store.get("watchlist", ["GOOGL", "MC.PA", "ASML.AS"]);
const setWatchlist = (w) => store.set("watchlist", [...new Set(w)]);
const notes = () => store.get("notes", {});
const noteOf = (s) => notes()[s] || {};
const setNote = (s, n) => { const all = notes(); all[s] = { ...(all[s] || {}), ...n, updated: new Date().toISOString() }; store.set("notes", all); };
const portfolio = () => store.get("portfolio", []);
const setPortfolio = (p) => store.set("portfolio", p);
// Noms des sociétés déjà rencontrés, pour afficher « LVMH » plutôt que « MC.PA » partout
const knownNames = () => store.get("names", {});
const rememberName = (sym, name) => {
  if (!sym || !name || name.toUpperCase() === String(sym).toUpperCase()) return;
  const all = knownNames(); if (all[sym] === name) return;
  all[sym] = name; store.set("names", all);
};
const fullName = (sym, name) => (name && name.toUpperCase() !== String(sym).toUpperCase() ? name : knownNames()[sym] || sym);
// Version courte pour les légendes et tableaux : sans forme juridique (SE, S.A., Inc., plc…)
const LEGAL = /[\s,]+(soci[ée]t[ée] europ[ée]enne|soci[ée]t[ée] anonyme|s\.?\s?a\.?|s\.?e\.?|se|sa|inc\.?|incorporated|corp\.?|corporation|co\.?|company|plc|p\.l\.c\.|n\.?v\.?|ag|a\/s|as|asa|ab|\(publ\)|oyj|spa|s\.p\.a\.|ltd\.?|limited|gmbh|kgaa|& co\.?|class [a-c])\s*$/i;
const shortName = (sym, name) => {
  let n = fullName(sym, name);
  if (n === sym) return n;
  for (let i = 0; i < 4; i++) { const m = n.replace(LEGAL, "").trim(); if (m === n || m.length < 2) break; n = m; }
  n = n.replace(/\s+-\s+/g, " ").replace(/[,\s]+$/, "");
  return n.length > 32 ? n.slice(0, 30).trim() + "…" : n;
};
const pushRecent = (s) => { const r = store.get("recent", []).filter((x) => x !== s); r.unshift(s); store.set("recent", r.slice(0, 12)); };

// ================================================================= theme
(function initTheme() {
  const t = store.get("theme", null);
  if (t) document.documentElement.dataset.theme = t;
  document.getElementById("theme-btn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nx = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nx;
    store.set("theme", nx);
    route();
  };
})();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ================================================================= format
const nf = (d = 2) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const isNum = (x) => typeof x === "number" && isFinite(x);
const fmt = (x, d = 2) => (isNum(x) ? nf(d).format(x) : "–");
const pct = (x, d = 1, sign = false) => (isNum(x) ? (sign && x > 0 ? "+" : "") + nf(d).format(x * 100) + " %" : "–");
const CUR = { USD: "$", EUR: "€", GBP: "£", GBp: "p", JPY: "¥", CHF: "CHF", CNY: "¥", HKD: "HK$", CAD: "C$", SEK: "kr", DKK: "kr", NOK: "kr" };
const money = (x, c, d = 2) => (isNum(x) ? nf(d).format(x) + " " + (CUR[c] || c || "") : "–");
const big = (x, c = "") => {
  if (!isNum(x)) return "–";
  const a = Math.abs(x), s = c ? " " + (CUR[c] || c) : "";
  if (a >= 1e12) return nf(2).format(x / 1e12) + " T" + s;
  if (a >= 1e9) return nf(1).format(x / 1e9) + " Md" + s;
  if (a >= 1e6) return nf(1).format(x / 1e6) + " M" + s;
  if (a >= 1e3) return nf(1).format(x / 1e3) + " k" + s;
  return nf(0).format(x) + s;
};
const mult = (x, d = 1) => (isNum(x) ? "x" + nf(d).format(x) : "–");
const dfr = (s) => { if (!s) return "–"; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }); };
const cls = (x) => (isNum(x) ? (x >= 0 ? "up" : "down") : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content; };

// ================================================================= api
const memo = new Map();
async function api(path, { force = false } = {}) {
  if (!force && memo.has(path)) return memo.get(path);
  const p = fetch(path).then(async (r) => {
    if (r.status === 401) { location.href = "/login"; throw new Error("Connexion requise"); }
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
    return r.json();
  });
  memo.set(path, p);
  p.catch(() => memo.delete(path));
  return p;
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message, symbol: items[k] }; } }
  }));
  return out;
}

// ================================================================= charts
const charts = [];
function chart(el) {
  const c = echarts.init(el, null, { renderer: "canvas" });
  const orig = c.setOption.bind(c);
  c.setOption = (o, ...r) => {
    (Array.isArray(o.series) ? o.series : []).forEach((s) => {
      const col = s.lineStyle && s.lineStyle.color;
      if (col && !(s.itemStyle && s.itemStyle.color)) s.itemStyle = { ...(s.itemStyle || {}), color: col };
    });
    return orig(o, ...r);
  };
  charts.push(c);
  return c;
}
function disposeCharts() { while (charts.length) { try { charts.pop().dispose(); } catch {} } }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
function baseOpt() {
  const ink = css("--ink"), muted = css("--muted"), line = css("--line");
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: ink },
    grid: { left: 54, right: 18, top: 26, bottom: 32, containLabel: false },
    tooltip: { trigger: "axis", backgroundColor: css("--card"), borderColor: line, textStyle: { color: ink, fontSize: 12 } },
    legend: { textStyle: { color: muted, fontSize: 11 }, top: 0, type: "scroll" },
    xAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: muted, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: line, type: "dashed" } } },
  };
}
const palette = () => ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(css);

// ================================================================= search
(function initSearch() {
  const inp = document.getElementById("search"), box = document.getElementById("search-results");
  let timer, items = [], active = -1;
  const close = () => { box.hidden = true; active = -1; };
  const go = (sym) => { close(); inp.value = ""; location.hash = "#/action/" + encodeURIComponent(sym); };
  const render = () => {
    box.innerHTML = items.map((r, i) => `<div class="sr ${i === active ? "active" : ""}" data-s="${esc(r.symbol)}"><span class="sym">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span><span class="ex">${esc(r.exchange || "")} · ${esc(r.type || "")}</span></div>`).join("")
      || `<div class="sr"><span class="nm muted">Aucun résultat. Entrée pour ouvrir « ${esc(inp.value.toUpperCase())} »</span></div>`;
    box.hidden = false;
    box.querySelectorAll(".sr[data-s]").forEach((el) => (el.onmousedown = () => go(el.dataset.s)));
  };
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (!q) return close();
    timer = setTimeout(async () => { try { items = await api("/api/search?q=" + encodeURIComponent(q)); active = -1; render(); } catch { items = []; render(); } }, 220);
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter") { const q = inp.value.trim(); if (active >= 0 && items[active]) go(items[active].symbol); else if (items[0]) go(items[0].symbol); else if (q) go(q.toUpperCase()); }
    else if (e.key === "Escape") close();
  });
  inp.addEventListener("blur", () => setTimeout(close, 150));
})();

// ================================================================= scoring
const PROFILES = {
  croissance: { label: "Croissance", w: { growth: 35, valuation: 20, quality: 25, dividend: 0, risk: 20 } },
  equilibre: { label: "Équilibré", w: { growth: 25, valuation: 25, quality: 25, dividend: 10, risk: 15 } },
  rendement: { label: "Rendement / dividendes", w: { growth: 10, valuation: 20, quality: 25, dividend: 30, risk: 15 } },
  value: { label: "Value (décote)", w: { growth: 15, valuation: 35, quality: 25, dividend: 10, risk: 15 } },
  defensif: { label: "Défensif", w: { growth: 15, valuation: 20, quality: 30, dividend: 10, risk: 25 } },
};
const AXES = [
  ["growth", "Croissance"], ["valuation", "Valorisation"], ["quality", "Qualité"], ["dividend", "Rentes"], ["risk", "Risque"],
];
function axisScores(scores, symbol) {
  const s = { ...scores };
  const moat = Number(noteOf(symbol).moat);
  if (moat >= 1 && moat <= 5) s.quality = isNum(s.quality) ? 0.7 * s.quality + 0.3 * moat : moat;
  return s;
}
function totalScore(scores, symbol, profile = store.get("profile", "croissance")) {
  const s = axisScores(scores, symbol), w = PROFILES[profile].w;
  let num = 0, den = 0;
  for (const [k] of AXES) if (isNum(s[k]) && w[k] > 0) { num += w[k] * s[k]; den += w[k]; }
  return den ? (num / den / 5) * 100 : null;
}
const scoreLabel = (x) => (!isNum(x) ? ["–", "soft"] : x >= 80 ? ["Excellent", "green"] : x >= 65 ? ["Bon", "green"] : x >= 50 ? ["Correct", "blue"] : x >= 35 ? ["Faible", "orange"] : ["Mauvais", "red"]);
function heat(x, lo, hi, invert = false) {
  if (!isNum(x)) return "";
  let t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  if (invert) t = 1 - t;
  const c = t > 0.5 ? css("--up") : css("--down");
  const a = Math.round(Math.abs(t - 0.5) * 2 * 26) + 6;
  return `background:color-mix(in srgb, ${c} ${a}%, transparent)`;
}

// ================================================================= router
const app = document.getElementById("app");
function setNav(k) { document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === k)); }
function loading(msg = "Chargement…") { app.innerHTML = `<div class="loader"><div class="spinner"></div>${esc(msg)}</div>`; }
async function route() {
  disposeCharts();
  window.scrollTo(0, 0);
  const hsh = location.hash.replace(/^#\/?/, "");
  const [page, arg] = hsh.split("/");
  try {
    if (page === "action" && arg) { setNav(""); await pageStock(decodeURIComponent(arg)); }
    else if (page === "suivi") { setNav("suivi"); await pageTable("suivi"); }
    else if (page === "classement") { setNav("classement"); await pageTable("classement"); }
    else if (page === "portefeuille") { setNav("portefeuille"); await pagePortfolio(); }
    else if (page === "calendrier") { setNav("calendrier"); await pageCalendar(); }
    else if (page === "reglages") { setNav("reglages"); await pageSettings(); }
    else { setNav("home"); await pageHome(); }
  } catch (e) {
    app.innerHTML = `<div class="err"><b>Erreur :</b> ${esc(e.message)}<div class="note">Vérifie que le serveur tourne (fenêtre « lancer.bat ») et ta connexion internet.</div></div>`;
  }
}
window.addEventListener("hashchange", route);

// ================================================================= accueil
async function pageHome() {
  app.innerHTML = `
    <div class="hero"><div><div class="big">Vue d'ensemble des marchés</div><div class="muted">Indices, matières premières, taux d'intérêt et devises.</div></div>
    <div class="seg"><button class="btn" onclick="location.hash='#/classement'">Trouver des actions en solde →</button></div></div>
    <div id="mk"><div class="loader"><div class="spinner"></div>Chargement des marchés…</div></div>
    <div class="section-title">Ma liste de suivi <small><a href="#/suivi">tout voir</a></small></div>
    <div id="wl" class="grid g4"></div>`;
  renderWatchCards(document.getElementById("wl"));
  try {
    const m = await api("/api/market");
    const groups = [["indices", "Indices"], ["commodities", "Matières premières"], ["rates", "Taux d'intérêt (rendement des obligations d'État US)"], ["fx", "Devises & crypto"]];
    const mk = document.getElementById("mk");
    mk.innerHTML = groups.map(([k, t]) => `<div class="section-title">${t}</div><div class="grid g4">${(m[k] || []).map((r, i) => `
      <div class="card mkt" ${r.symbol.startsWith("^") || r.symbol.includes(".") || /^[A-Z]{2,5}$/.test(r.symbol) ? `style="cursor:pointer" onclick="location.hash='#/action/${encodeURIComponent(r.symbol)}'"` : ""}>
        <div class="top"><span class="nm">${esc(r.label)}</span><span class="muted" style="font-size:11px">${esc(r.symbol)}</span></div>
        <div class="last">${k === "rates" ? fmt(r.last, 2) + " %" : fmt(r.last, r.last > 1000 ? 0 : 2)}</div>
        <div class="row"><span>Jour <b class="${cls(r.change)}">${pct(r.change, 2, true)}</b></span><span>YTD <b class="${cls(r.ytd)}">${pct(r.ytd, 1, true)}</b></span><span>1 an <b class="${cls(r.y1)}">${pct(r.y1, 1, true)}</b></span></div>
        <div class="chart xs" id="sp-${k}-${i}"></div>
      </div>`).join("")}</div>`).join("");
    for (const [k] of groups) (m[k] || []).forEach((r, i) => {
      if (!r.spark) return;
      const c = chart(document.getElementById(`sp-${k}-${i}`));
      const col = (r.y1 ?? 0) >= 0 ? css("--up") : css("--down");
      c.setOption({ grid: { left: 0, right: 0, top: 4, bottom: 0 }, xAxis: { type: "category", show: false, data: r.spark.map((_, j) => j) }, yAxis: { type: "value", show: false, scale: true },
        series: [{ type: "line", data: r.spark, showSymbol: false, lineStyle: { width: 1.6, color: col }, areaStyle: { color: col, opacity: 0.08 } }] });
    });
  } catch (e) { document.getElementById("mk").innerHTML = `<div class="err">Marchés indisponibles : ${esc(e.message)}</div>`; }
}
async function renderWatchCards(el) {
  const wl = watchlist();
  if (!wl.length) { el.innerHTML = `<div class="card empty" style="grid-column:1/-1">Ta liste est vide. Recherche une action et clique sur ☆ Suivre.</div>`; return; }
  el.innerHTML = wl.map((s) => `<div class="card mkt" style="cursor:pointer" data-s="${esc(s)}" onclick="location.hash='#/action/${encodeURIComponent(s)}'"><div class="top"><span class="nm">${esc(shortName(s))}</span></div><div class="muted">chargement…</div></div>`).join("");
  pool(wl, 3, async (s) => {
    const r = await api("/api/summary/" + encodeURIComponent(s));
    const card = el.querySelector(`[data-s="${CSS.escape(s)}"]`);
    if (!card) return;
    rememberName(s, r.name);
    const sc = totalScore(r.scores, s), [lab, col] = scoreLabel(sc);
    card.innerHTML = `<div class="top"><span class="nm" title="${esc(fullName(s, r.name))} (${esc(s)})">${esc(shortName(s, r.name))}</span><span class="badge ${col}">${isNum(sc) ? Math.round(sc) : "–"}/100</span></div>
      <div class="last">${money(r.price, r.currency)} <span class="pill ${cls(r.change)}">${pct(r.change, 2, true)}</span></div>
      <div class="row"><span>Croiss. <b>${pct(r.growth, 1, true)}</b></span><span>Risque <b>${pct(r.risk, 0)}</b></span><span>${isNum(r.discount) ? (r.discount < 0 ? "Décote" : "Surcote") : "PE"} <b class="${isNum(r.discount) ? (r.discount < 0 ? "up" : "down") : ""}">${isNum(r.discount) ? pct(Math.abs(r.discount), 0) : mult(r.peNtm)}</b></span></div>`;
  });
}

// ================================================================= fiche action
const RANGES = [["5J", 7], ["1M", 31], ["6M", 183], ["YTD", "ytd"], ["1A", 365], ["5A", 1826], ["10A", 3652], ["20A", 7305], ["MAX", "max"]];
const BENCH = [["^GSPC", "S&P 500"], ["^FCHI", "CAC 40"], ["^STOXX", "STOXX 600"], ["URTH", "MSCI World"], ["^NDX", "Nasdaq 100"]];

async function pageStock(sym, force = false) {
  loading(`Analyse de ${fullName(sym)} en cours… (récupération de toutes les données disponibles, 10 à 30 s la première fois)`);
  const d = await api("/api/stock/" + encodeURIComponent(sym) + (force ? "?refresh=1" : ""), { force });
  const p = d.profile, cur = p.currency, S = p.symbol;
  rememberName(S, p.name);
  p.name = fullName(S, p.name);
  pushRecent(S);
  document.title = `${p.name} (${S}) · Analyse Actions`;
  const inWl = watchlist().includes(S);
  const domain = (p.website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const logo = domain ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${esc(p.name[0] || "?")}'}))">` : `<span class="ph">${esc(p.name[0] || "?")}</span>`;
  const cal = d.calendar || {};
  const nextEarn = Array.isArray(cal["Earnings Date"]) ? cal["Earnings Date"][0] : cal["Earnings Date"];
  const lastEarn = [...(d.earningsDates || [])].reverse().find((e) => e.reported != null);
  const ind = d.indicators, val = d.valuation, dv = d.dividends, q = d.quality, o = d.outlook;
  const isEq = p.type === "EQUITY";

  app.innerHTML = `
  ${p.partial ? `<div class="warn-box">Yahoo ne transmet pour l'instant que les cours à ce serveur : profil, résultats, analystes et valorisation sont momentanément incomplets. Réessaie dans quelques minutes avec <b>↻ Actualiser</b>.</div>` : ""}
  <div class="grid g-side">
    <div class="card idcard">
      <div class="logo">${logo}</div>
      <div class="nm">${esc(p.name)}</div>
      <div class="px">${money(p.price, cur)}</div>
      <div><span class="pill ${cls(p.change)}">${pct(p.change, 2, true)}</span></div>
      <div class="chips">
        ${p.capCategory ? `<span class="badge purple">${p.capCategory}</span>` : ""}
        ${p.peaEligible === true ? `<span class="badge green" title="Siège dans l'UE/EEE : éligibilité PEA probable (à vérifier auprès de ton courtier)">PEA probable</span>` : p.peaEligible === false ? `<span class="badge soft">CTO</span>` : ""}
        ${p.type !== "EQUITY" ? `<span class="badge blue">${esc(p.type)}</span>` : ""}
      </div>
      <div class="kv"><span>Ticker</span><b>${esc(S)}</b></div>
      <div class="kv"><span>ISIN</span><b>${esc(p.isin || "–")}</b></div>
      <div class="kv"><span>Pays</span><b>${esc(p.country || "–")}</b></div>
      <div class="kv"><span>Place</span><b>${esc(p.exchange || "–")}</b></div>
      <div class="kv"><span>Capitalisation</span><b>${big(p.marketCap, cur)}</b></div>
      <div class="kv"><span>Secteur</span><b>${esc(p.sector || "–")}</b></div>
      <div class="kv"><span>Industrie</span><b>${esc(p.industry || "–")}</b></div>
      <div class="kv"><span>Prochaine publication</span><b>${dfr(nextEarn)}</b></div>
      <div class="kv"><span>Dernière publication</span><b>${lastEarn ? dfr(lastEarn.date) : "–"}</b></div>
      <div class="kv"><span>Plus haut / bas 52 sem.</span><b>${fmt(p.high52)} / ${fmt(p.low52)}</b></div>
      <div class="kv"><span>Effectifs</span><b>${isNum(p.employees) ? nf(0).format(p.employees) : "–"}</b></div>
      <div style="display:flex;gap:6px;justify-content:center;margin-top:12px;flex-wrap:wrap">
        <button class="btn ${inWl ? "" : "primary"}" id="wl-btn">${inWl ? "★ Suivie" : "☆ Suivre"}</button>
        <button class="btn" id="refresh-btn" title="Recharger les données">↻ Actualiser</button>
      </div>
      <div class="note">Mis à jour ${new Date(p.updated).toLocaleString("fr-FR")}</div>
    </div>
    <div class="card">
      <div class="hero">
        <div><div class="co-name">${esc(p.name)} <small>${esc(S)}</small></div><div class="big">${money(p.price, cur)} <span class="pill ${cls(p.change)}" id="range-perf"></span></div></div>
        <div class="seg" id="ranges">${RANGES.map(([l]) => `<button data-r="${l}" class="${l === "20A" ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="toggles" id="toggles">
        ${[["reg", "Régression", 1], ["div", "Dividendes réinvestis", 0], ["an", "Analystes", 0], ["dcf", "DCF", 0], ["mine", "Mes cibles", 0], ["earn", "Résultats", 0], ["log", "Échelle log", 1], ["bench", "Indice", 0]]
          .map(([k, l, on]) => `<label class="${on ? "on" : ""}"><input type="checkbox" data-t="${k}" ${on ? "checked" : ""}>${l}</label>`).join("")}
        <select class="inp" id="bench-sel" style="font-size:12px;padding:3px 6px">${BENCH.map(([s, l]) => `<option value="${s}">${l}</option>`).join("")}</select>
      </div>
      <div class="seg" id="trend-win" style="font-size:12px"><span class="muted" style="font-size:12px;margin-right:4px">Tendance sur</span>${[["3", "3 ans"], ["5", "5 ans"], ["10", "10 ans"], ["max", "Max"]].map(([k, l]) => `<button data-w="${k}" class="${k === "max" ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="trend-txt" id="trend-txt"></div>
      <div class="chart tall" id="price-chart"></div>
    </div>
  </div>

  <div class="section-title">Indicateurs clés <small>4 indicateurs simplifiés : perspective de croissance, risque, solde (valorisation), rentes</small></div>
  <div class="grid g4">
    <div class="card ind">
      <div class="ind-head"><span class="ico green">⚡</span><div><div class="t">Croissance<br>BPA anticipée</div><div class="s">Années à venir</div></div></div>
      <div class="val ${cls(ind.growth.value)}">${pct(ind.growth.value, 1, true)}/an</div>
      <div class="desc">${esc(ind.growth.method || "Bénéfice par action attendu par les analystes")}</div>
      <div class="foot2">${isNum(ind.growth.past) ? `<span class="badge orange">passé ${ind.growth.pastYears} ans : ${pct(ind.growth.past, 1, true)}/an</span>` : ""}
        ${isNum(ind.growth.revenue) ? `<span class="badge soft">CA attendu ${pct(ind.growth.revenue, 1, true)}/an</span>` : ""}
        ${isNum(ind.growth.ltg) ? `<span class="badge soft">LT ${pct(ind.growth.ltg, 1, true)}/an</span>` : ""}</div>
    </div>
    <div class="card ind">
      <div class="ind-head"><span class="ico orange">⛨</span><div><div class="t">Risque estimé</div><div class="s">Sur 6 mois</div></div></div>
      <div class="val">${pct(ind.risk.value, 2)}</div>
      <div class="desc">${esc(ind.risk.source || "")}</div>
      <div class="foot2">${ind.risk.label ? `<span class="badge ${ind.risk.label === "Faible" ? "green" : ind.risk.label === "Modéré" ? "blue" : ind.risk.label === "Élevé" ? "red" : "orange"}">${ind.risk.label}</span>` : ""}
        ${isNum(ind.risk.move6m) ? `<span class="badge soft" title="Fourchette à ±1 écart-type (≈68 % de probabilité)">6 mois : ${fmt(ind.risk.rangeLow, 0)} – ${fmt(ind.risk.rangeHigh, 0)} (±${pct(ind.risk.move6m, 0)})</span>` : ""}</div>
    </div>
    <div class="card ind">
      <div class="ind-head"><span class="ico navy">◎</span><div><div class="t">Valorisation</div><div class="s" id="val-sub">PE Ratio NTM ajusté</div></div></div>
      <div class="val" id="val-v"></div>
      <div class="desc" id="val-d"></div>
      <div class="seg" id="val-mode" style="margin-top:6px"><button data-m="pub">Publié</button><button data-m="adj" class="on">Ajusté</button></div>
      <div class="foot2" id="val-f"></div>
    </div>
    <div class="card ind">
      <div class="ind-head"><span class="ico blue">◔</span><div><div class="t">Dividendes</div><div class="s">Annuel estimé</div></div></div>
      <div class="val">${isNum(dv.annual) && dv.annual > 0 ? money(dv.annual, cur) : "Aucun"}</div>
      <div class="desc">Rendement : <b>${pct(dv.yield, 2)}</b>${isNum(dv.payout) ? ` · Distribution : ${pct(dv.payout, 0)} des bénéfices` : ""}${dv.exDate ? `<br>Détachement : ${dfr(dv.exDate)}` : ""}</div>
      <div class="foot2">${isNum(dv.cagr5) ? `<span class="badge blue">croissance 5 ans : ${pct(dv.cagr5, 1, true)}/an</span>` : ""}${dv.growthStreak ? `<span class="badge soft">${dv.growthStreak} ans sans baisse</span>` : ""}</div>
    </div>
  </div>

  <div class="grid g3 mt">
    <div class="card" id="score-card"></div>
    <div class="card" id="outlook-card"></div>
    <div class="card" id="holders-card"></div>
  </div>

  <div class="section-title"><span class="ico navy">⌁</span>Analyse technique <small>graphique TradingView interactif et signaux calculés sur les cours quotidiens</small></div>
  <div class="grid g-tech">
    <div class="card"><div class="tv-bar" id="tv-bar"></div><div class="tv-box" id="tv-box"></div></div>
    <div class="card" id="tech-card"></div>
  </div>

  ${isEq ? `
  <div class="section-title"><span class="ico green">✦</span>Analystes <small>recommandations et prix cibles</small></div>
  <div class="card" id="analysts-card"></div>
  <div id="fmp-sec"></div>

  <div class="section-title"><span class="ico navy">▤</span>Activité, résultats &amp; estimations</div>
  <div class="grid g2">
    <div class="card"><h3>Chiffre d'affaires &amp; bénéfice net</h3><div class="sub">Historique annuel + estimations des analystes (zone claire)</div><div class="chart" id="rev-chart"></div></div>
    <div class="card"><h3>Bénéfice par action (BPA)</h3><div class="sub">Publié (comptable) vs récurrent / ajusté (hors éléments exceptionnels) + estimations</div><div class="chart" id="eps-chart"></div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>Publications : attentes battues ou manquées</h3><div class="sub">BPA publié vs consensus, surprise en %</div><div class="chart small" id="surprise-chart"></div></div>
    <div class="card" id="estimates-card"></div>
  </div>

  <div class="section-title"><span class="ico orange">%</span>Marges, rentabilité &amp; dette</div>
  <div class="grid g3">
    <div class="card"><h3>Marges</h3><div class="sub">Brute, opérationnelle, nette, free cash-flow</div><div class="chart small" id="margin-chart"></div></div>
    <div class="card"><h3>Rentabilité des capitaux</h3><div class="sub">ROE et ROIC</div><div class="chart small" id="roe-chart"></div></div>
    <div class="card"><h3>Dette</h3><div class="sub">Dette nette et levier (dette nette / EBITDA)</div><div class="chart small" id="debt-chart"></div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card" id="quality-card"></div>
    <div class="card"><h3>Cash-flow &amp; retour à l'actionnaire</h3><div class="sub">Free cash-flow, rachats d'actions, dividendes versés</div><div class="chart small" id="cash-chart"></div></div>
  </div>

  <div class="section-title"><span class="ico navy">◎</span>Valorisation &amp; valeur intrinsèque</div>
  <div class="grid g2">
    <div class="card"><h3>Historique du PE</h3><div class="sub">Comparer la valorisation actuelle à sa moyenne</div><div class="chart" id="pe-chart"></div></div>
    <div class="card" id="dcf-card"></div>
  </div>` : ""}

  <div class="section-title"><span class="ico orange">⛨</span>Risque &amp; drawdowns</div>
  <div class="grid g2">
    <div class="card"><h3>Baisses depuis les plus hauts (drawdowns)</h3><div class="sub">Profondeur des chutes historiques</div><div class="chart small" id="dd-chart"></div></div>
    <div class="card" id="risk-card"></div>
  </div>

  <div class="section-title"><span class="ico blue">◔</span>Dividendes</div>
  <div class="grid g2">
    <div class="card"><h3>Dividende par action et par année</h3><div class="sub">Somme des versements de l'année civile</div><div class="chart small" id="div-chart"></div></div>
    <div class="card" id="insiders-card"></div>
  </div>

  <div class="section-title"><span class="ico purple">✎</span>Mon analyse</div>
  <div class="grid g2">
    <div class="card" id="mynote-card"></div>
    <div class="card"><h3>L'entreprise</h3><div class="sub">${esc(p.sector || "")} · ${esc(p.industry || "")} ${p.website ? `· <a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(domain)}</a>` : ""}</div><div class="desc-txt">${esc(p.summary || "Pas de description disponible.")}</div>
      <div class="note">${isUsSymbol(S) ? "La répartition du chiffre d'affaires par division et par région s'affiche dans « Données complémentaires » si l'action fait partie de l'offre gratuite de Financial Modeling Prep (clé à saisir dans Réglages)." : "La répartition du chiffre d'affaires par région et par division n'est pas fournie gratuitement pour les actions hors États-Unis."}</div></div>
  </div>

  <div class="section-title"><span class="ico navy">✉</span>Actualités</div>
  <div class="card news">${(d.news || []).map((n) => `<a href="${esc(n.url || "#")}" target="_blank" rel="noopener"><b>${esc(n.title)}</b><br><small>${esc(n.publisher || "")} · ${dfr(n.date)}</small></a>`).join("") || `<div class="empty">Aucune actualité.</div>`}</div>
  `;

  document.getElementById("wl-btn").onclick = () => {
    const w = watchlist();
    setWatchlist(w.includes(S) ? w.filter((x) => x !== S) : [...w, S]);
    pageStock(S);
  };
  document.getElementById("refresh-btn").onclick = () => { memo.clear(); pageStock(S, true); };

  renderPriceChart(d);
  renderValuationCard(d, "adj");
  document.querySelectorAll("#val-mode button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("#val-mode button").forEach((x) => x.classList.toggle("on", x === b));
    renderValuationCard(d, b.dataset.m);
  }));
  renderScoreCard(d);
  renderOutlookCard(d);
  renderHolders(d);
  renderTradingView(d);
  renderTechCard(d);
  if (isEq) {
    renderAnalysts(d);
    renderFmp(d);
    renderFinancialCharts(d);
    renderEstimates(d);
    renderQuality(d);
    renderPE(d);
    renderDCF(d);
  }
  renderRisk(d);
  renderDividends(d);
  renderInsiders(d);
  renderMyNote(d);
}

// ---------------------------------------------------------------- graphique de cours
function linreg(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  let ss = 0; for (let i = 0; i < n; i++) ss += (ys[i] - a - b * xs[i]) ** 2;
  return { a, b, sd: Math.sqrt(ss / Math.max(1, n - 2)) };
}
function renderPriceChart(d) {
  const H = d.history, p = d.profile, el = document.getElementById("price-chart");
  if (!H.dates.length) { el.innerHTML = `<div class="empty">Pas d'historique de cours.</div>`; return; }
  const c = chart(el);
  const st = { range: "20A", win: "max", t: { reg: true, div: false, an: false, dcf: false, mine: false, earn: false, log: true, bench: false }, bench: "^GSPC" };
  const T = H.dates.map((s) => Date.parse(s));
  let benchData = null;

  const draw = async () => {
    const series = H.dates.map((_, i) => (st.t.div ? H.adj[i] : H.close[i]));
    const lastT = T[T.length - 1];
    let start;
    const r = RANGES.find((x) => x[0] === st.range)[1];
    if (r === "max") start = T[0];
    else if (r === "ytd") start = Date.UTC(new Date(lastT).getUTCFullYear(), 0, 1);
    else start = lastT - r * 864e5;
    let i0 = T.findIndex((t) => t >= start); if (i0 < 0) i0 = 0;
    const data = []; for (let i = i0; i < T.length; i++) data.push([T[i], series[i]]);
    const perf = series[T.length - 1] / series[i0] - 1;
    const rp = document.getElementById("range-perf"); rp.textContent = pct(perf, 1, true) + " (" + st.range + ")"; rp.className = "pill " + cls(perf);

    const ser = [{ name: shortName(p.symbol, p.name), type: "line", data, showSymbol: false, sampling: "lttb", lineStyle: { width: 1.6, color: css("--c1") },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: css("--c1") + "55" }, { offset: 1, color: css("--c1") + "05" }]) }, z: 3, markLine: { symbol: "none", silent: false, data: [] } }];
    const ml = ser[0].markLine.data;
    // régression log-linéaire
    const tt = document.getElementById("trend-txt");
    document.getElementById("trend-win").style.display = st.t.reg ? "" : "none";
    if (st.t.reg) {
      const wy = st.win === "max" ? 1e9 : +st.win;
      const ws = lastT - wy * 365.25 * 864e5;
      let j0 = T.findIndex((t) => t >= ws); if (j0 < 0) j0 = 0;
      const xs = [], ys = [];
      for (let i = j0; i < T.length; i++) if (series[i] > 0) { xs.push((T[i] - T[j0]) / (365.25 * 864e5)); ys.push(Math.log(series[i])); }
      if (xs.length > 20) {
        const { a, b, sd } = linreg(xs, ys);
        const yrs = xs[xs.length - 1];
        const resid = ys[ys.length - 1] - (a + b * xs[xs.length - 1]);
        tt.innerHTML = `Tendance <b class="${cls(b)}">${pct(Math.exp(b) - 1, 1, true)}/an</b> sur ${nf(0).format(yrs)} ans · cours actuel <b>${pct(Math.exp(resid) - 1, 1, true)}</b> ${resid >= 0 ? "au-dessus" : "en dessous"} de la tendance (${resid >= 0 ? "+" : ""}${nf(1).format(resid / sd)} σ)`;
        const mk = (k, dash, col) => {
          const pts = [];
          for (let i = Math.max(j0, i0); i < T.length; i += Math.max(1, Math.floor((T.length - Math.max(j0, i0)) / 200))) pts.push([T[i], Math.exp(a + b * (T[i] - T[j0]) / (365.25 * 864e5) + k * sd)]);
          pts.push([lastT, Math.exp(a + b * yrs + k * sd)]);
          // même nom pour la tendance et ses 4 bandes : un clic sur « Tendance » dans la légende les retire toutes
          return { name: "Tendance", id: "trend" + k, type: "line", data: pts, showSymbol: false, silent: true, lineStyle: { width: k ? 1 : 1.4, type: dash, color: col }, z: 2, tooltip: { show: false } };
        };
        ser.push(mk(0, "solid", css("--ink")), mk(1, "dashed", css("--muted")), mk(-1, "dashed", css("--muted")), mk(2, "dotted", css("--muted")), mk(-2, "dotted", css("--muted")));
      } else tt.textContent = "";
    } else tt.textContent = "";
    const hline = (y, name, col, dash = "dashed") => isNum(y) && ml.push({ yAxis: y, name, lineStyle: { color: col, type: dash, width: 1.4 }, label: { formatter: `${name} ${fmt(y)}`, position: "insideEndTop", color: col, fontSize: 11 } });
    if (st.t.an) { hline(d.outlook.targetMean, "Cible moy.", css("--accent")); hline(d.outlook.targetHigh, "Haute", css("--up"), "dotted"); hline(d.outlook.targetLow, "Basse", css("--down"), "dotted"); }
    if (st.t.dcf) hline(d.dcf.value, "DCF", css("--c4"));
    if (st.t.mine) { const n = noteOf(p.symbol); hline(+n.t1 || null, "Ma cible 1 an", css("--warn")); hline(+n.t5 || null, "Ma cible 5 ans", css("--c5")); }
    if (st.t.earn) {
      const pts = (d.earningsDates || []).filter((e) => e.reported != null && Date.parse(e.date) >= T[i0]).map((e) => {
        const t = Date.parse(e.date); let k = T.findIndex((x) => x >= t); if (k < 0) k = T.length - 1;
        return { value: [t, series[k]], e };
      });
      ser.push({ name: "Résultats", id: "earn", type: "scatter", data: pts.map((x) => ({ value: x.value, itemStyle: { color: isNum(x.e.surprise) ? (x.e.surprise >= 0 ? css("--up") : css("--down")) : css("--muted") }, e: x.e })), symbolSize: 8, z: 4,
        tooltip: { trigger: "item", formatter: (pp) => { const e = pp.data.e; return `Publication ${dfr(e.date)}<br>BPA ${fmt(e.reported)} vs attendu ${fmt(e.estimate)}<br>Surprise ${isNum(e.surprise) ? fmt(e.surprise, 1) + " %" : "–"}`; } } });
    }
    if (st.t.bench) {
      try {
        if (!benchData || benchData.sym !== st.bench) benchData = { sym: st.bench, h: await api("/api/history/" + encodeURIComponent(st.bench)) };
        const bh = benchData.h, bT = bh.dates.map((s) => Date.parse(s));
        let k0 = bT.findIndex((t) => t >= T[i0]);
        if (k0 >= 0) {
          const base = bh.close[k0], s0 = series[i0];
          const bd = []; for (let k = k0; k < bT.length; k++) bd.push([bT[k], (bh.close[k] / base) * s0]);
          const bperf = bh.close[bh.close.length - 1] / base - 1;
          ser.push({ name: (BENCH.find((x) => x[0] === st.bench) || [0, st.bench])[1] + ` (${pct(bperf, 1, true)}, rebasé)`, id: "bench", type: "line", data: bd, showSymbol: false, sampling: "lttb", lineStyle: { width: 1.3, color: css("--c3") }, z: 2 });
        }
      } catch {}
    }
    const o = baseOpt();
    c.setOption({
      ...o, grid: { left: 60, right: 20, top: 30, bottom: 50 },
      legend: { ...o.legend, data: [...new Set(ser.map((s) => s.name))] },
      xAxis: { ...o.xAxis, type: "time", axisPointer: { label: { formatter: (a) => new Date(a.value).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }) } } },
      yAxis: { ...o.yAxis, type: st.t.log ? "log" : "value", scale: true, logBase: 10, min: (v) => v.min * 0.92, max: (v) => v.max * 1.05, axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => fmt(v, v >= 100 ? 0 : 2) } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "transparent", textStyle: { color: css("--muted") } }],
      tooltip: { ...o.tooltip, valueFormatter: (v) => fmt(v) },
      series: ser,
    }, true);
  };
  document.querySelectorAll("#ranges button").forEach((b) => (b.onclick = () => { st.range = b.dataset.r; document.querySelectorAll("#ranges button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  document.querySelectorAll("#trend-win button").forEach((b) => (b.onclick = () => { st.win = b.dataset.w; document.querySelectorAll("#trend-win button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  const setToggle = (k, on) => {
    st.t[k] = on;
    const i = document.querySelector(`#toggles input[data-t="${k}"]`);
    if (i) { i.checked = on; i.parentElement.classList.toggle("on", on); }
    draw();
  };
  document.querySelectorAll("#toggles input").forEach((i) => (i.onchange = () => setToggle(i.dataset.t, i.checked)));
  // Un clic dans la légende sur Tendance / Indice / Résultats équivaut au bouton correspondant (les deux restent synchronisés)
  c.on("legendselectchanged", (e) => {
    const s = (c.getOption().series || []).find((x) => x.name === e.name);
    const k = s && (String(s.id).startsWith("trend") ? "reg" : s.id === "bench" ? "bench" : s.id === "earn" ? "earn" : null);
    if (k && !e.selected[e.name]) setToggle(k, false);
  });
  document.getElementById("bench-sel").onchange = (e) => { st.bench = e.target.value; if (st.t.bench) draw(); };
  draw();
}

// ---------------------------------------------------------------- valorisation
function renderValuationCard(d, mode) {
  const v = d.valuation, adj = mode === "adj";
  const pe = adj ? v.peNtm : v.peTtm, avg = adj ? v.peNtmAvg5y : v.peTtmAvg5y, disc = adj ? v.discountAdjusted : v.discountReported;
  document.getElementById("val-sub").textContent = adj ? "PE Ratio NTM ajusté" : "PE Ratio publié (12 derniers mois)";
  document.getElementById("val-v").textContent = mult(pe, 2);
  document.getElementById("val-d").innerHTML = isNum(avg) ? `vs moy. 5 ans (${mult(avg, 1)}) : <b class="${disc < 0 ? "up" : "down"}">${disc < 0 ? "décote" : "surcote"} de ${pct(Math.abs(disc), 0)}</b>` : `Moyenne 5 ans indisponible`;
  document.getElementById("val-f").innerHTML = `<span class="badge soft">${adj ? "Bénéfices anticipés (12 prochains mois)" : "Bénéfice comptable publié"}</span>${isNum(v.peg) ? `<span class="badge soft" title="PE / croissance attendue">PEG ${fmt(v.peg, 2)}</span>` : ""}`;
}

// ---------------------------------------------------------------- score
function renderScoreCard(d) {
  const el = document.getElementById("score-card"), S = d.profile.symbol;
  const prof = store.get("profile", "croissance");
  const s = axisScores(d.scores, S), tot = totalScore(d.scores, S, prof), [lab, col] = scoreLabel(tot), w = PROFILES[prof].w;
  const colors = { growth: css("--accent"), valuation: css("--c1"), quality: css("--up"), dividend: css("--info"), risk: css("--warn") };
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><h3>Score</h3><div class="scorebox"><span class="huge">${isNum(tot) ? Math.round(tot) : "–"}</span><span class="muted">/100</span> <span class="badge ${col}">${lab}</span></div></div>
    <div class="form-row" style="margin:4px 0"><label>Profil <select class="inp" id="prof-sel">${Object.entries(PROFILES).map(([k, v]) => `<option value="${k}" ${k === prof ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
    <div class="chart small" id="radar"></div>
    ${AXES.map(([k, l]) => `<div class="axis-row"><div><span class="dot" style="background:${colors[k]}"></span>${l}<small>${isNum(s[k]) ? `poids ${w[k]} %` : "sans objet, non compté"}</small></div><b>${isNum(s[k]) ? fmt(s[k], 1) + "/5" : "–"}</b></div>`).join("")}
    <div class="note">Notes calculées automatiquement à partir des données publiques (croissance attendue, décote, PEG, rendement FCF, ROE, ROIC, marges, dette, volatilité, dividendes). ${noteOf(S).moat ? "Ta note « moat » est intégrée à la qualité." : ""}</div>`;
  document.getElementById("prof-sel").onchange = (e) => { store.set("profile", e.target.value); renderScoreCard(d); };
  const c = chart(document.getElementById("radar"));
  c.setOption({
    radar: { indicator: AXES.map(([, l]) => ({ name: l, max: 5 })), radius: "65%", splitNumber: 5, axisName: { color: css("--muted"), fontSize: 11 }, splitLine: { lineStyle: { color: css("--line") } }, splitArea: { show: false }, axisLine: { lineStyle: { color: css("--line") } } },
    series: [{ type: "radar", data: [{ value: AXES.map(([k]) => (isNum(s[k]) ? +s[k].toFixed(2) : 0)), areaStyle: { color: css("--c1"), opacity: 0.25 }, lineStyle: { color: css("--c1") }, itemStyle: { color: css("--c1") } }] }],
  });
}

// ---------------------------------------------------------------- perspectives
function renderOutlookCard(d) {
  const o = d.outlook, p = d.profile, cur = p.currency, n = noteOf(p.symbol), el = document.getElementById("outlook-card");
  const lo = o.targetLow, hi = o.targetHigh, px = p.price;
  let rangeHtml = "";
  if (isNum(lo) && isNum(hi) && hi > lo) {
    const mn = Math.min(lo, px) * 0.97, mx = Math.max(hi, px) * 1.03, pos = (x) => ((x - mn) / (mx - mn)) * 100;
    rangeHtml = `<div class="range"><div class="track"></div>
      <div class="mk" style="left:${pos(lo)}%"><i></i>${fmt(lo, 0)}</div>
      <div class="mk mean" style="left:${pos(o.targetMean)}%"><i></i><b>${fmt(o.targetMean, 0)}</b></div>
      <div class="mk" style="left:${pos(hi)}%"><i></i>${fmt(hi, 0)}</div>
      <div class="mk" style="left:${pos(px)}%;top:-10px;color:var(--warn)">▼ cours</div></div>`;
  }
  const up1 = +n.t1 ? +n.t1 / px - 1 : null, up5 = +n.t5 ? Math.pow(+n.t5 / px, 1 / 5) - 1 : null;
  const reco = { strong_buy: "Achat fort", buy: "Achat", hold: "Conserver", underperform: "Sous-performance", sell: "Vente", none: "–" }[o.recommendation] || o.recommendation || "–";
  el.innerHTML = `<h3><span class="ico green">↗</span>Perspectives</h3><div class="sub">Prix cibles des analystes, projection à 5 ans, valeur intrinsèque</div>
    <div class="kv"><span>Objectif moyen des analystes</span><b>${money(o.targetMean, cur)} <span class="${cls(o.upsideMean)}">(${pct(o.upsideMean, 1, true)})</span></b></div>
    ${rangeHtml}
    <div class="kv"><span>Fourchette basse / haute</span><b><span class="${cls(o.upsideLow)}">${pct(o.upsideLow, 0, true)}</span> / <span class="${cls(o.upsideHigh)}">${pct(o.upsideHigh, 0, true)}</span></b></div>
    <div class="kv"><span>Consensus</span><b>${esc(reco)} ${isNum(o.analysts) ? `· ${o.analysts} analystes` : ""}</b></div>
    <div class="kv"><span title="${esc(o.price5yMethod)}">Cours estimé dans 5 ans ⓘ</span><b>${money(o.price5y, cur, 0)}</b></div>
    <div class="kv"><span>Espérance de rendement annuel (5 ans, dividendes inclus)</span><b class="${cls(o.return5yTotal)}">${pct(o.return5yTotal, 1, true)}/an</b></div>
    <div class="kv"><span>Valeur intrinsèque (DCF)</span><b>${money(d.dcf.value, cur)} ${isNum(d.dcf.value) ? `<span class="${cls(d.dcf.value / px - 1)}">(${pct(d.dcf.value / px - 1, 0, true)})</span>` : ""}</b></div>
    ${o.warning ? `<div class="note warn">⚠ ${esc(o.warning)}</div>` : ""}
    <div class="kv"><span>Ma cible 1 an</span><b>${+n.t1 ? `${money(+n.t1, cur)} <span class="${cls(up1)}">(${pct(up1, 1, true)})</span>` : `<a href="javascript:void(0)" onclick="document.getElementById('mynote-card').scrollIntoView({behavior:'smooth'})">définir</a>`}</b></div>
    <div class="kv"><span>Ma cible 5 ans</span><b>${+n.t5 ? `${money(+n.t5, cur)} <span class="${cls(up5)}">(${pct(up5, 1, true)}/an)</span>` : `<a href="javascript:void(0)" onclick="document.getElementById('mynote-card').scrollIntoView({behavior:'smooth'})">définir</a>`}</b></div>`;
}

// ---------------------------------------------------------------- actionnariat
function renderHolders(d) {
  const H = d.holders || {}, b = H.breakdown || {}, el = document.getElementById("holders-card");
  const ins = b.insidersPercentHeld, inst = b.institutionsPercentHeld;
  const rows = (H.institutions || []).slice(0, 8);
  el.innerHTML = `<h3><span class="ico blue">👥</span>Actionnariat</h3><div class="sub">Répartition des investisseurs</div>
    <div class="chart small" id="hold-pie" style="height:180px"></div>
    <div class="kv"><span>Initiés (dirigeants…)</span><b>${pct(ins, 2)}</b></div>
    <div class="kv"><span>Institutionnels</span><b>${pct(inst, 1)}</b></div>
    <div class="kv"><span>Nombre d'institutionnels</span><b>${isNum(b.institutionsCount) ? nf(0).format(b.institutionsCount) : "–"}</b></div>
    ${rows.length ? `<div class="table-wrap mt"><table class="tbl"><tr><th>Principaux détenteurs</th><th>%</th><th>Var.</th></tr>${rows.map((r) => `<tr><td class="l" style="max-width:170px;overflow:hidden;text-overflow:ellipsis">${esc(r.holder)}</td><td>${pct(r.pct, 2)}</td><td class="${cls(r.change)}">${pct(r.change, 1, true)}</td></tr>`).join("")}</table></div>` : ""}`;
  if (isNum(ins) || isNum(inst)) {
    const c = chart(document.getElementById("hold-pie"));
    const other = Math.max(0, 1 - (ins || 0) - (inst || 0));
    c.setOption({ tooltip: { trigger: "item", valueFormatter: (v) => pct(v, 1) }, color: [css("--c4"), css("--c1"), css("--c6")],
      series: [{ type: "pie", radius: ["45%", "75%"], label: { color: css("--muted"), fontSize: 11 }, data: [{ name: "Initiés", value: ins || 0 }, { name: "Institutionnels", value: inst || 0 }, { name: "Autres / particuliers", value: other }] }] });
  }
}

// ---------------------------------------------------------------- analystes
function renderAnalysts(d) {
  const A = d.analysts || {}, el = document.getElementById("analysts-card"), cur = d.profile.currency;
  const r = (A.recommendations || []).find((x) => x.period === "0m") || (A.recommendations || [])[0];
  let recoHtml = `<div class="empty">Pas de recommandations disponibles.</div>`;
  if (r) {
    const buy = (r.strongBuy || 0) + (r.buy || 0), hold = r.hold || 0, sell = (r.sell || 0) + (r.strongSell || 0), tot = buy + hold + sell || 1;
    const lab = buy / tot >= 0.6 ? "Achat" : sell / tot >= 0.4 ? "Vente" : "Conserver";
    recoHtml = `<div style="display:flex;justify-content:space-between;align-items:baseline"><div><div class="muted" style="font-size:12px">Recommandation des analystes</div><div class="big" style="color:${lab === "Achat" ? "var(--up)" : lab === "Vente" ? "var(--down)" : "var(--warn)"}">${lab}</div></div><div class="muted">${tot} analystes</div></div>
      <div class="bar" style="margin:8px 0;height:14px"><div style="width:${(buy / tot) * 100}%;background:var(--up)"></div><div style="width:${(hold / tot) * 100}%;background:var(--c6)"></div><div style="width:${(sell / tot) * 100}%;background:var(--down)"></div></div>
      <div style="font-size:12px"><b class="up">■</b> Achat ${buy} (${pct(buy / tot, 0)}, dont ${r.strongBuy || 0} achat fort) &nbsp; <b class="muted">■</b> Conserver ${hold} (${pct(hold / tot, 0)}) &nbsp; <b class="down">■</b> Vente ${sell} (${pct(sell / tot, 0)})</div>
      <div style="font-size:12px;margin-top:4px">Objectif moyen du consensus : <b>${money(d.outlook.targetMean, cur)}</b> (de ${fmt(d.outlook.targetLow, 0)} à ${fmt(d.outlook.targetHigh, 0)})</div>`;
  }
  const acts = (A.actions || []).filter((a) => isNum(a.target));
  el.innerHTML = `${recoHtml}
    <div class="chart tall mt" id="an-chart"></div>
    ${(A.actions || []).length ? `<div class="table-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><tr><th>Date</th><th class="l">Banque / courtier</th><th class="l">Action</th><th class="l">Recommandation</th><th>Objectif</th><th>Précédent</th></tr>
      ${[...A.actions].reverse().slice(0, 40).map((a) => `<tr><td>${dfr(a.date)}</td><td class="l">${esc(a.firm)}</td><td class="l">${esc({ up: "Relèvement", down: "Abaissement", main: "Maintien", init: "Initiation", reit: "Réitération" }[a.action] || a.action || "")}</td><td class="l">${esc(a.from && a.from !== a.to ? a.from + " → " : "")}${esc(a.to || "")}</td><td>${fmt(a.target, 0)}</td><td class="muted">${fmt(a.prior, 0)}</td></tr>`).join("")}</table></div>` : ""}`;
  const elc = document.getElementById("an-chart");
  if (!acts.length) { elc.innerHTML = `<div class="empty">Historique des prix cibles par banque indisponible.</div>`; elc.style.height = "auto"; return; }
  const since = Date.parse(acts[0].date) - 20 * 864e5;
  const H = d.history, priceSer = [];
  H.dates.forEach((s, i) => { const t = Date.parse(s); if (t >= since) priceSer.push([t, H.close[i]]); });
  const byFirm = {};
  acts.forEach((a) => (byFirm[a.firm] = byFirm[a.firm] || []).push([Date.parse(a.date), a.target]));
  const firms = Object.entries(byFirm).sort((a, b) => b[1].length - a[1].length).slice(0, 14);
  const pal = ["#2c7be5", "#1a2a6c", "#7b2ff7", "#c0392b", "#e84393", "#8e5a2b", "#a3b81a", "#56c26b", "#27ae60", "#3a8f7d", "#d9822b", "#6c5ce7", "#00a8a8", "#b33939"];
  const o = baseOpt();
  const c = chart(elc);
  c.setOption({ ...o, grid: { left: 54, right: 16, top: 50, bottom: 30 }, color: pal,
    xAxis: { ...o.xAxis, type: "time" }, yAxis: { ...o.yAxis, type: "value", scale: true },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (pp) => `${esc(pp.seriesName)}<br>${dfr(new Date(pp.value[0]))} : ${fmt(pp.value[1])}` },
    series: [
      { name: "Cours", type: "line", data: priceSer, showSymbol: false, lineStyle: { color: css("--muted"), width: 1.2 }, z: 1, tooltip: { trigger: "axis" } },
      ...firms.map(([f, pts]) => ({ name: f, type: "line", step: "end", data: pts, symbolSize: 6, lineStyle: { width: 1.6 } })),
      { name: "Objectif moyen", type: "line", data: [], markLine: { symbol: "none", data: isNum(d.outlook.targetMean) ? [{ yAxis: d.outlook.targetMean }] : [], lineStyle: { color: css("--accent"), type: "dashed" }, label: { formatter: "Consensus {c}", color: css("--accent"), position: "insideStartTop" } } },
    ] });
}

// ---------------------------------------------------------------- financiers
function finSeries(d, key) { return (d.ratios || []).map((r) => [r.date.slice(0, 4), r[key]]); }
function renderFinancialCharts(d) {
  const R = d.ratios || [], E = d.estimates || {}, o = baseOpt(), cur = d.profile.financialCurrency || d.profile.currency;
  const years = R.map((r) => r.date.slice(0, 4));
  // CA & bénéfice + estimations
  const rev = R.map((r) => r.revenue), ni = R.map((r) => r.netIncome);
  const estYears = [], estRev = [], estNi = [];
  const lastY = years.length ? +years[years.length - 1] : new Date().getFullYear() - 1;
  const fy = Math.max(d.profile.lastFiscalYearEnd ? +d.profile.lastFiscalYearEnd.slice(0, 4) : 0, years.length ? lastY : 0) || lastY;
  [["0y", 1], ["+1y", 2]].forEach(([k, off]) => {
    const rv = E.revenue && E.revenue[k], ep = E.eps && E.eps[k];
    if (rv && isNum(rv.avg)) { estYears.push(String(fy + off) + "e"); estRev.push(rv.avg); const sh = R.length ? R[R.length - 1].shares : null; estNi.push(ep && isNum(ep.avg) && sh ? ep.avg * sh : null); }
  });
  const c1 = chart(document.getElementById("rev-chart"));
  const allY = [...years, ...estYears];
  c1.setOption({ ...o, grid: { ...o.grid, left: 74 }, xAxis: { ...o.xAxis, type: "category", data: allY }, yAxis: { ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => big(v) } },
    tooltip: { ...o.tooltip, valueFormatter: (v) => big(v, cur) }, legend: { ...o.legend, data: ["Chiffre d'affaires", "Bénéfice net"] },
    series: [
      { name: "Chiffre d'affaires", type: "bar", data: [...rev, ...estRev.map((v) => ({ value: v, itemStyle: { opacity: 0.45 } }))], itemStyle: { color: css("--c1"), borderRadius: [4, 4, 0, 0] } },
      { name: "Bénéfice net", type: "bar", data: [...ni, ...estNi.map((v) => ({ value: v, itemStyle: { opacity: 0.45 } }))], itemStyle: { color: css("--c2"), borderRadius: [4, 4, 0, 0] } },
    ] });
  // BPA publié vs ajusté (+ TTM ajusté issu des publications)
  const c2 = chart(document.getElementById("eps-chart"));
  const ttm = d.ttmEps || [];
  const estPts = [];
  [["0y", 1], ["+1y", 2]].forEach(([k, off]) => { const ep = E.eps && E.eps[k]; if (ep && isNum(ep.avg)) estPts.push([Date.UTC(fy + off, 11, 31), ep.avg]); });
  c2.setOption({ ...o, xAxis: { ...o.xAxis, type: "time" }, yAxis: { ...o.yAxis, type: "value", scale: true },
    tooltip: { ...o.tooltip, valueFormatter: (v) => fmt(v) },
    series: [
      { name: "BPA ajusté (12 mois glissants)", type: "line", data: ttm.map((x) => [Date.parse(x.date), x.eps]), showSymbol: false, lineStyle: { color: css("--c2"), width: 2 } },
      { name: "BPA publié (annuel)", type: "line", data: R.map((r) => [Date.parse(r.date), r.epsReported]), symbolSize: 7, lineStyle: { color: css("--c1") } },
      { name: "BPA récurrent (annuel)", type: "line", data: R.map((r) => [Date.parse(r.date), r.epsAdjusted]), symbolSize: 7, lineStyle: { color: css("--c4"), type: "dashed" } },
      { name: "Estimations", type: "scatter", data: estPts, symbol: "diamond", symbolSize: 12, itemStyle: { color: css("--warn") } },
    ] });
  // surprises
  const ed = (d.earningsDates || []).filter((e) => e.reported != null && isNum(e.surprise)).slice(-16);
  const c3 = chart(document.getElementById("surprise-chart"));
  c3.setOption({ ...o, xAxis: { ...o.xAxis, type: "category", data: ed.map((e) => e.date.slice(0, 7)) }, yAxis: { ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: "{value} %" } },
    tooltip: { ...o.tooltip, formatter: (ps) => { const e = ed[ps[0].dataIndex]; return `${dfr(e.date)}<br>BPA ${fmt(e.reported)} vs ${fmt(e.estimate)} attendu<br>Surprise ${fmt(e.surprise, 1)} %`; } },
    series: [{ type: "bar", data: ed.map((e) => ({ value: e.surprise, itemStyle: { color: e.surprise >= 0 ? css("--up") : css("--down"), borderRadius: 3 } })) }] });
  if (!ed.length) document.getElementById("surprise-chart").innerHTML = `<div class="empty">Historique des publications indisponible.</div>`;
  // marges
  const pctAxis = { ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => nf(0).format(v * 100) + " %" } };
  const line = (name, key, col) => ({ name, type: "line", data: R.map((r) => r[key]), symbolSize: 6, lineStyle: { color: col, width: 2 }, itemStyle: { color: col } });
  chart(document.getElementById("margin-chart")).setOption({ ...o, xAxis: { ...o.xAxis, type: "category", data: years }, yAxis: pctAxis, tooltip: { ...o.tooltip, valueFormatter: (v) => pct(v, 1) },
    series: [line("Brute", "grossMargin", css("--c1")), line("Opérationnelle", "operatingMargin", css("--c2")), line("Nette", "netMargin", css("--c3")), line("FCF", "fcfMargin", css("--c4"))] });
  chart(document.getElementById("roe-chart")).setOption({ ...o, xAxis: { ...o.xAxis, type: "category", data: years }, yAxis: pctAxis, tooltip: { ...o.tooltip, valueFormatter: (v) => pct(v, 1) },
    series: [line("ROE", "roe", css("--c2")), line("ROIC", "roic", css("--c1"))] });
  chart(document.getElementById("debt-chart")).setOption({ ...o, grid: { ...o.grid, left: 74, right: 50 }, xAxis: { ...o.xAxis, type: "category", data: years },
    yAxis: [{ ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => big(v) } }, { ...o.yAxis, type: "value", splitLine: { show: false }, axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => "x" + fmt(v, 1) } }],
    tooltip: { ...o.tooltip },
    series: [
      { name: "Dette nette", type: "bar", data: R.map((r) => r.netDebt), itemStyle: { color: css("--c3"), borderRadius: 3 }, tooltip: { valueFormatter: (v) => big(v, cur) } },
      { name: "Trésorerie", type: "bar", data: R.map((r) => r.cash), itemStyle: { color: css("--c2"), borderRadius: 3 }, tooltip: { valueFormatter: (v) => big(v, cur) } },
      { name: "Dette nette / EBITDA", type: "line", yAxisIndex: 1, data: R.map((r) => r.netDebtEbitda), lineStyle: { color: css("--c5") }, itemStyle: { color: css("--c5") }, tooltip: { valueFormatter: (v) => mult(v, 2) } },
    ] });
  chart(document.getElementById("cash-chart")).setOption({ ...o, grid: { ...o.grid, left: 74 }, xAxis: { ...o.xAxis, type: "category", data: years }, yAxis: { ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => big(v) } },
    tooltip: { ...o.tooltip, valueFormatter: (v) => big(v, cur) },
    series: [
      { name: "Free cash-flow", type: "bar", data: R.map((r) => r.fcf), itemStyle: { color: css("--c1"), borderRadius: 3 } },
      { name: "Rachats d'actions", type: "bar", data: R.map((r) => (isNum(r.buyback) ? -r.buyback : null)), itemStyle: { color: css("--c4"), borderRadius: 3 } },
      { name: "Dividendes versés", type: "bar", data: R.map((r) => (isNum(r.dividendsPaid) ? -r.dividendsPaid : null)), itemStyle: { color: css("--info"), borderRadius: 3 } },
      { name: "Capex", type: "line", data: R.map((r) => (isNum(r.capex) ? -r.capex : null)), lineStyle: { color: css("--warn") }, itemStyle: { color: css("--warn") } },
    ] });
  if (!R.length) ["rev-chart", "margin-chart", "roe-chart", "debt-chart", "cash-chart"].forEach((id) => (document.getElementById(id).innerHTML = `<div class="empty">États financiers indisponibles.</div>`));
}

function renderEstimates(d) {
  const E = d.estimates || {}, el = document.getElementById("estimates-card");
  const per = { "0q": "Trimestre en cours", "+1q": "Trimestre suivant", "0y": "Exercice en cours", "+1y": "Exercice suivant" };
  const eps = E.eps || {}, rev = E.revenue || {}, tr = E.trend || {}, rv = E.revisions || {};
  const keys = Object.keys(per).filter((k) => eps[k] || rev[k]);
  el.innerHTML = `<h3>Estimations des analystes</h3><div class="sub">BPA et chiffre d'affaires attendus, révisions récentes</div>
    ${keys.length ? `<div class="table-wrap"><table class="tbl"><tr><th>Période</th><th>BPA moy.</th><th>Bas – haut</th><th>Croiss.</th><th>CA moy.</th><th>Croiss. CA</th><th>Nb</th></tr>
    ${keys.map((k) => { const e = eps[k] || {}, r = rev[k] || {}; return `<tr><td>${per[k]}</td><td><b>${fmt(e.avg)}</b></td><td class="muted">${fmt(e.low)} – ${fmt(e.high)}</td><td class="${cls(e.growth)}">${pct(e.growth, 1, true)}</td><td>${big(r.avg)}</td><td class="${cls(r.growth)}">${pct(r.growth, 1, true)}</td><td>${isNum(e.numberOfAnalysts) ? e.numberOfAnalysts : "–"}</td></tr>`; }).join("")}</table></div>` : `<div class="empty">Pas d'estimations disponibles.</div>`}
    ${Object.keys(tr).length ? `<div class="table-wrap mt"><table class="tbl"><tr><th>Évolution du consensus BPA</th><th>Actuel</th><th>-7 j</th><th>-30 j</th><th>-90 j</th><th>Révisions ↑/↓ (30 j)</th></tr>
    ${["0y", "+1y"].filter((k) => tr[k]).map((k) => { const t = tr[k], r = rv[k] || {}; const ch = isNum(t.current) && isNum(t["90daysAgo"]) && t["90daysAgo"] ? t.current / t["90daysAgo"] - 1 : null; return `<tr><td>${per[k]} <span class="${cls(ch)}">${pct(ch, 1, true)}</span></td><td>${fmt(t.current)}</td><td>${fmt(t["7daysAgo"])}</td><td>${fmt(t["30daysAgo"])}</td><td>${fmt(t["90daysAgo"])}</td><td><span class="up">${isNum(r.upLast30days) ? r.upLast30days : "–"}</span> / <span class="down">${isNum(r.downLast30days) ? r.downLast30days : (isNum(r.downLast30Days) ? r.downLast30Days : "–")}</span></td></tr>`; }).join("")}</table></div>` : ""}`;
}

function renderQuality(d) {
  const q = d.quality, cur = d.profile.financialCurrency || d.profile.currency, el = document.getElementById("quality-card");
  const row = (l, v, tip = "") => `<div class="kv"><span ${tip ? `title="${esc(tip)}"` : ""}>${l}${tip ? " ⓘ" : ""}</span><b>${v}</b></div>`;
  el.innerHTML = `<h3><span class="ico green">✓</span>Qualité de l'entreprise</h3><div class="sub">Rentabilité, marges et solidité du bilan (derniers chiffres)</div>
    ${row("ROE (rentabilité des fonds propres)", pct(q.roe, 1))}
    ${row("ROIC (rentabilité du capital investi)", pct(q.roic, 1), "Résultat opérationnel après impôt / capital investi")}
    ${row("Marge brute", pct(q.grossMargin, 1))}
    ${row("Marge opérationnelle", pct(q.operatingMargin, 1))}
    ${row("Marge nette", pct(q.netMargin, 1))}
    ${row("Stabilité de la marge op. (écart-type)", isNum(q.marginStability) ? fmt(q.marginStability * 100, 1) + " pts" : "–", "Plus c'est bas, plus les marges sont régulières")}
    ${row("Dette nette", big(q.netDebt, cur) + (isNum(q.netDebt) && q.netDebt < 0 ? " (trésorerie nette)" : ""))}
    ${row("Dette nette / EBITDA", mult(q.netDebtEbitda, 2), "Années d'EBITDA pour rembourser la dette nette. < 2 confortable, > 3,5 élevé")}
    ${row("Dette / fonds propres", mult(q.debtEquity, 2))}
    ${row("Couverture des intérêts", mult(q.interestCoverage, 1), "Résultat opérationnel / charges d'intérêts")}
    ${row("Liquidité générale (current ratio)", fmt(q.currentRatio, 2))}
    ${row("Conversion du bénéfice en cash (FCF / RN)", pct(q.fcfConversion, 0))}
    ${row("Free cash-flow (12 mois)", big(q.fcf, cur))}`;
}

function renderPE(d) {
  const v = d.valuation, el = document.getElementById("pe-chart"), o = baseOpt();
  const H = v.history || {};
  const ser = [];
  const add = (name, pts, col) => pts && pts.length && ser.push({ name, type: "line", data: pts.map((p) => [Date.parse(p.date), p.value]), showSymbol: pts.length < 40, symbolSize: 5, lineStyle: { color: col, width: 2 }, itemStyle: { color: col } });
  add("PE ajusté (cours / BPA ajusté 12 m)", (H.adjustedPE || []).filter((p) => p.value < 200), css("--c2"));
  add("PE forward (Yahoo)", H.forwardPE, css("--c1"));
  add("PE publié (Yahoo)", H.trailingPE, css("--c3"));
  if (!ser.length) { el.innerHTML = `<div class="empty">Historique de valorisation indisponible.</div>`; return; }
  ser[0].markLine = { symbol: "none", data: [isNum(v.peNtmAvg5y) ? { yAxis: v.peNtmAvg5y, name: "Moy. 5 ans" } : null, isNum(v.peNtm) ? { yAxis: v.peNtm, name: "NTM actuel" } : null].filter(Boolean),
    label: { formatter: (pp) => `${pp.name} x${fmt(pp.value, 1)}`, color: css("--muted"), fontSize: 11, position: "insideStartTop" }, lineStyle: { type: "dashed", color: css("--muted") } };
  chart(el).setOption({ ...o, grid: { ...o.grid, top: 40 }, xAxis: { ...o.xAxis, type: "time" }, yAxis: { ...o.yAxis, type: "value", scale: true, axisLabel: { ...o.yAxis.axisLabel, formatter: "x{value}" } },
    tooltip: { ...o.tooltip, valueFormatter: (x) => mult(x, 1) }, dataZoom: [{ type: "inside" }], series: ser });
}

function renderDCF(d) {
  const D = { ...d.dcf }, p = d.profile, cur = p.currency, el = document.getElementById("dcf-card");
  if (!isNum(D.fcf) || !isNum(D.shares)) { el.innerHTML = `<h3>Valeur intrinsèque (DCF)</h3><div class="empty">Free cash-flow ou nombre d'actions indisponible.</div>`; return; }
  let base = "avg3";
  const calc = () => {
    const fcf = base === "avg3" ? D.fcfAvg3 || D.fcf : D.fcf, g = D.growth, r = D.discount, tg = D.terminal, nd = D.netDebt || 0;
    if (!(fcf > 0) || r <= tg) return null;
    let pv = 0, f = fcf;
    for (let y = 1; y <= 10; y++) { const gy = y <= 5 ? g : g + ((tg - g) * (y - 5)) / 5; f *= 1 + gy; pv += f / (1 + r) ** y; }
    pv += (f * (1 + tg)) / (r - tg) / (1 + r) ** 10;
    return (pv - nd) / D.shares;
  };
  const sliders = [["growth", "Croissance FCF (5 ans)", -0.05, 0.3, 0.005], ["discount", "Taux d'actualisation", 0.05, 0.15, 0.0025], ["terminal", "Croissance à l'infini", 0, 0.04, 0.0025]];
  const draw = () => {
    const v = calc(), mos = isNum(v) ? v / p.price - 1 : null;
    el.querySelector("#dcf-out").innerHTML = `<div class="big">${money(v, cur)}</div><div>${isNum(mos) ? `<span class="pill ${cls(mos)}">${mos >= 0 ? "Marge de sécurité" : "Au-dessus de la valeur"} ${pct(Math.abs(mos), 0)}</span>` : `<span class="muted">FCF négatif : DCF non pertinent</span>`}</div>`;
    sliders.forEach(([k]) => (el.querySelector(`#dv-${k}`).textContent = pct(D[k], 1)));
  };
  el.innerHTML = `<h3>Valeur intrinsèque (DCF interactif)</h3><div class="sub">Actualisation des free cash-flows sur 10 ans + valeur terminale, moins la dette nette. Ajuste les hypothèses.</div>
    <div id="dcf-out" style="margin:8px 0 12px"></div>
    ${sliders.map(([k, l, mn, mx, st]) => `<div class="slider-row"><span>${l}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${D[k]}" data-k="${k}"><b id="dv-${k}"></b></div>`).join("")}
    <div class="form-row"><label>Base de free cash-flow <select class="inp" id="dcf-base"><option value="avg3">Moyenne 3 derniers exercices (${big(D.fcfAvg3, cur)})</option><option value="ttm">12 derniers mois (${big(D.fcf, cur)})</option></select></label></div>
    <div class="kv"><span>Actions en circulation</span><b>${big(D.shares)}</b></div>
    <div class="kv"><span>Dette nette</span><b>${big(D.netDebt, cur)}</b></div>
    <div class="note">Croissance initiale proposée = croissance du BPA attendue par les analystes (bornée à 25 %), qui ralentit ensuite vers la croissance à l'infini.</div>`;
  el.querySelectorAll("input[type=range]").forEach((i) => (i.oninput = () => { D[i.dataset.k] = +i.value; draw(); }));
  el.querySelector("#dcf-base").onchange = (e) => { base = e.target.value; draw(); };
  draw();
}

function renderRisk(d) {
  const H = d.history, r = d.indicators.risk, el = document.getElementById("risk-card"), cur = d.profile.currency;
  el.innerHTML = `<h3><span class="ico orange">⛨</span>Mesures de risque</h3><div class="sub">Variations attendues et historiques</div>
    <div class="kv"><span>Volatilité implicite (options, Black-Scholes)</span><b>${r.implied ? pct(r.implied.iv, 1) + ` <span class="muted">(échéance ${dfr(r.implied.expiry)}, ${r.implied.n} options)</span>` : "– (pas d'options)"}</b></div>
    <div class="kv"><span>Volatilité historique 1 an</span><b>${pct(r.historical, 1)}</b></div>
    <div class="kv"><span title="Fourchette à ±1 écart-type, environ 2 chances sur 3">Fourchette probable à 6 mois ⓘ</span><b>${money(r.rangeLow, cur, 0)} – ${money(r.rangeHigh, cur, 0)}</b></div>
    <div class="kv"><span>Variation typique sur 6 mois</span><b>±${pct(r.move6m, 1)}</b></div>
    <div class="kv"><span>Bêta (sensibilité au marché)</span><b>${fmt(r.beta, 2)}</b></div>
    <div class="kv"><span>Pire chute historique (max drawdown)</span><b class="down">${pct(r.maxDrawdown, 1)}</b></div>
    <div class="kv"><span>Baisse actuelle depuis le plus haut</span><b class="${(r.currentDrawdown ?? 0) < -0.1 ? "down" : ""}">${pct(r.currentDrawdown, 1)}</b></div>
    <div class="note">Le risque affiché dans l'indicateur clé est la volatilité annualisée : en gros, l'action varie de ±(risque × √0,5) sur 6 mois dans 2 cas sur 3.</div>`;
  const src = H.adj.length ? H.adj : H.close;
  if (!src.length) return;
  let peak = -Infinity; const dd = [];
  const step = Math.max(1, Math.floor(src.length / 1500));
  for (let i = 0; i < src.length; i++) { peak = Math.max(peak, src[i]); if (i % step === 0 || i === src.length - 1) dd.push([Date.parse(H.dates[i]), src[i] / peak - 1]); }
  const o = baseOpt();
  chart(document.getElementById("dd-chart")).setOption({ ...o, xAxis: { ...o.xAxis, type: "time" }, yAxis: { ...o.yAxis, type: "value", max: 0, axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => nf(0).format(v * 100) + " %" } },
    tooltip: { ...o.tooltip, valueFormatter: (v) => pct(v, 1) }, dataZoom: [{ type: "inside" }],
    series: [{ name: "Drawdown", type: "line", data: dd, showSymbol: false, lineStyle: { color: css("--down"), width: 1 }, areaStyle: { color: css("--down"), opacity: 0.18 } }] });
}

function renderDividends(d) {
  const by = (d.dividends.byYear || []), el = document.getElementById("div-chart"), o = baseOpt();
  if (!by.length) { el.innerHTML = `<div class="empty">Aucun dividende versé.</div>`; return; }
  const yNow = new Date().getFullYear();
  chart(el).setOption({ ...o, xAxis: { ...o.xAxis, type: "category", data: by.map((x) => x.year) }, yAxis: { ...o.yAxis, type: "value" },
    tooltip: { ...o.tooltip, valueFormatter: (v) => money(v, d.profile.currency, 3) },
    series: [{ type: "bar", data: by.map((x) => ({ value: x.value, itemStyle: { color: css("--info"), opacity: x.year === yNow ? 0.45 : 1, borderRadius: [4, 4, 0, 0] } })) }] });
}

function renderInsiders(d) {
  const ins = (d.holders || {}).insiders || [], el = document.getElementById("insiders-card");
  el.innerHTML = `<h3><span class="ico purple">◉</span>Transactions des dirigeants (initiés)</h3><div class="sub">Achats et ventes déclarés récemment</div>
    ${ins.length ? `<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="tbl"><tr><th>Date</th><th class="l">Initié</th><th class="l">Opération</th><th>Actions</th><th>Montant</th></tr>${ins.map((r) => `<tr><td>${dfr(r.date)}</td><td class="l">${esc(r.insider)}<br><small class="muted">${esc(r.position || "")}</small></td><td class="l" style="white-space:normal;max-width:220px;font-size:12px">${esc(r.text || "")}</td><td>${big(r.shares)}</td><td>${big(r.value)}</td></tr>`).join("")}</table></div>` : `<div class="empty">Aucune transaction disponible (souvent le cas hors États-Unis).</div>`}`;
}

function renderMyNote(d) {
  const S = d.profile.symbol, n = noteOf(S), el = document.getElementById("mynote-card"), cur = d.profile.currency;
  el.innerHTML = `<h3>Ma note d'analyse</h3><div class="sub">Ton avis personnel et tes prix cibles (enregistrés dans ton navigateur)</div>
    <div class="form-row">
      <label>Ma cible à 1 an (${esc(CUR[cur] || cur)})<input class="inp" id="n-t1" type="number" step="any" value="${esc(n.t1 || "")}" style="width:130px"></label>
      <label>Ma cible à 5 ans<input class="inp" id="n-t5" type="number" step="any" value="${esc(n.t5 || "")}" style="width:130px"></label>
      <label>Moat / avantage concurrentiel<select class="inp" id="n-moat"><option value="">–</option>${[1, 2, 3, 4, 5].map((k) => `<option ${+n.moat === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
    </div>
    <textarea id="n-text" placeholder="Thèse d'investissement, points forts, risques, catalyseurs…">${esc(n.text || "")}</textarea>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn primary" id="n-save">Enregistrer</button><span class="muted" id="n-msg">${n.updated ? "Dernière modification : " + new Date(n.updated).toLocaleString("fr-FR") : ""}</span></div>`;
  document.getElementById("n-save").onclick = () => {
    setNote(S, { t1: document.getElementById("n-t1").value, t5: document.getElementById("n-t5").value, moat: document.getElementById("n-moat").value, text: document.getElementById("n-text").value });
    document.getElementById("n-msg").textContent = "Enregistré ✓";
    renderOutlookCard(d); renderScoreCard(d);
  };
}

// ================================================================= tableaux suivi / classement
const COLS = [
  ["name", "Action", (r) => `<b title="${esc(fullName(r.symbol, r.name))}">${esc(shortName(r.symbol, r.name))}</b><br><small class="muted">${esc(r.symbol)}</small>`, (r) => shortName(r.symbol, r.name).toLowerCase()],
  ["price", "Cours", (r) => `${money(r.price, r.currency)}<br><small class="${cls(r.change)}">${pct(r.change, 2, true)}</small>`, (r) => r.change],
  ["score", "Score", (r) => { const s = totalScore(r.scores, r.symbol), [, c] = scoreLabel(s); return `<span class="badge ${c}">${isNum(s) ? Math.round(s) : "–"}</span>`; }, (r) => totalScore(r.scores, r.symbol)],
  ["quality", "Qualité", (r) => `<span class="heat" style="${heat(r.scores.quality, 1, 5)}">${fmt(r.scores.quality, 1)}</span>`, (r) => r.scores.quality],
  ["growth", "Croiss. BPA", (r) => `<span class="heat" style="${heat(r.growth, -0.05, 0.25)}">${pct(r.growth, 1, true)}</span>`, (r) => r.growth],
  ["risk", "Risque", (r) => `<span class="heat" style="${heat(r.risk, 0.15, 0.6, true)}">${pct(r.risk, 0)}</span>`, (r) => r.risk],
  ["pe", "PE NTM", (r) => `${mult(r.peNtm)}<br><small class="muted">moy. ${mult(r.peAvg)}</small>`, (r) => r.peNtm],
  ["discount", "Solde", (r) => `<span class="heat" style="${heat(r.discount, -0.4, 0.4, true)}">${isNum(r.discount) ? (r.discount < 0 ? "−" : "+") + pct(Math.abs(r.discount), 0) : "–"}</span>`, (r) => r.discount],
  ["div", "Rdt div.", (r) => pct(r.dividendYield, 2), (r) => r.dividendYield],
  ["upside", "Potentiel analystes", (r) => `<span class="${cls(r.upside)}">${pct(r.upside, 0, true)}</span>`, (r) => r.upside],
  ["ret5", "Espérance 5 ans", (r) => `<span class="${cls(r.return5y)}">${pct(r.return5y, 1, true)}/an</span>`, (r) => r.return5y],
  ["mine", "Mes cibles 1a / 5a", (r) => { const n = noteOf(r.symbol); const a = +n.t1 ? +n.t1 / r.price - 1 : null, b = +n.t5 ? Math.pow(+n.t5 / r.price, 0.2) - 1 : null; return `<span class="${cls(a)}">${pct(a, 0, true)}</span> / <span class="${cls(b)}">${pct(b, 1, true)}</span>`; }, (r) => { const n = noteOf(r.symbol); return +n.t1 ? +n.t1 / r.price - 1 : null; }],
  ["earn", "Proch. publication", (r) => dfr(r.nextEarnings), (r) => r.nextEarnings],
];

async function pageTable(kind) {
  const isWl = kind === "suivi";
  const unis = isWl ? [] : await api("/api/universes");
  app.innerHTML = `
    <div class="hero"><div><div class="big">${isWl ? "Liste de suivi" : "Recherche & classement"}</div><div class="muted">${isWl ? "Tes actions suivies avec leurs indicateurs. Clique sur un en-tête pour trier." : "Analyse un ensemble d'actions et classe-les par solde, qualité, croissance, risque ou dividende."}</div></div>
      <div class="form-row">
        ${isWl ? `<label>Ajouter (symbole)<input class="inp" id="add-sym" placeholder="ex : AAPL, AI.PA"></label><button class="btn primary" id="add-btn">Ajouter</button>` :
        `<label>Univers<select class="inp" id="uni">${unis.map((u) => `<option value="${u.id}">${esc(u.label)} (${u.count})</option>`).join("")}<option value="__wl">Ma liste de suivi</option><option value="__custom">Liste personnalisée…</option></select></label>
         <label id="custom-wrap" hidden>Symboles séparés par des virgules<input class="inp" id="custom" style="width:260px" value="${esc(store.get("custom", ""))}"></label>
         <label><span><input type="checkbox" id="pea-only"> PEA uniquement</span></label>
         <button class="btn primary" id="run">Lancer l'analyse</button>`}
        <label>Profil de score<select class="inp" id="prof">${Object.entries(PROFILES).map(([k, v]) => `<option value="${k}" ${k === store.get("profile", "croissance") ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      </div></div>
    <div class="progress" id="prog" hidden><div style="width:0"></div></div>
    <div class="card mt"><div class="table-wrap" id="tbl"><div class="empty">${isWl ? "Chargement…" : "Choisis un univers puis « Lancer l'analyse ». La première analyse prend environ 2 à 5 secondes par action."}</div></div></div>`;
  let rows = [], sortKey = isWl ? "score" : "discount", sortDir = isWl ? -1 : 1;
  const renderT = () => {
    const pea = !isWl && document.getElementById("pea-only")?.checked;
    const col = COLS.find((c) => c[0] === sortKey);
    const vis = rows.filter((r) => r && !r.error && (!pea || r.peaEligible));
    vis.sort((a, b) => { const x = col[3](a), y = col[3](b); if (!isNum(x) && typeof x !== "string") return 1; if (!isNum(y) && typeof y !== "string") return -1; return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    const errs = rows.filter((r) => r && r.error);
    document.getElementById("tbl").innerHTML = `<table class="tbl"><tr>${COLS.map(([k, l]) => `<th class="sort" data-k="${k}">${l}${k === sortKey ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}${isWl ? "<th></th>" : ""}</tr>
      ${vis.map((r) => `<tr class="click" data-s="${esc(r.symbol)}">${COLS.map((c) => `<td>${c[2](r)}</td>`).join("")}${isWl ? `<td><button class="btn sm" data-rm="${esc(r.symbol)}">✕</button></td>` : ""}</tr>`).join("")}</table>
      ${errs.length ? `<div class="note">Non trouvées : ${errs.map((e) => esc(e.symbol)).join(", ")}</div>` : ""}${vis.some((r) => r.partial) ? `<div class="note">Données incomplètes pour ${vis.filter((r) => r.partial).map((r) => esc(shortName(r.symbol, r.name))).join(", ")} : Yahoo limite momentanément ce serveur, réessaie dans quelques minutes.</div>` : ""}${!vis.length && !errs.length ? `<div class="empty">Aucune action.</div>` : ""}`;
    document.querySelectorAll("#tbl th.sort").forEach((th) => (th.onclick = () => { if (sortKey === th.dataset.k) sortDir *= -1; else { sortKey = th.dataset.k; sortDir = ["discount", "risk", "pe"].includes(sortKey) ? 1 : -1; } renderT(); }));
    document.querySelectorAll("#tbl tr.click").forEach((tr) => (tr.onclick = (e) => { if (e.target.dataset.rm) { setWatchlist(watchlist().filter((x) => x !== e.target.dataset.rm)); rows = rows.filter((r) => r.symbol !== e.target.dataset.rm); renderT(); return; } location.hash = "#/action/" + encodeURIComponent(tr.dataset.s); }));
  };
  const load = async (syms) => {
    rows = []; const prog = document.getElementById("prog"); prog.hidden = false; let done = 0;
    await pool(syms, 4, async (s) => {
      let r; try { r = await api("/api/summary/" + encodeURIComponent(s)); rememberName(s, r.name); } catch (e) { r = { error: e.message, symbol: s }; }
      rows.push(r); done++; prog.firstElementChild.style.width = (done / syms.length) * 100 + "%"; renderT();
    });
    prog.hidden = true;
  };
  document.getElementById("prof").onchange = (e) => { store.set("profile", e.target.value); renderT(); };
  if (isWl) {
    const add = () => { const v = document.getElementById("add-sym").value.trim().toUpperCase(); if (!v) return; setWatchlist([...watchlist(), ...v.split(/[,; ]+/).filter(Boolean)]); pageTable("suivi"); };
    document.getElementById("add-btn").onclick = add;
    document.getElementById("add-sym").onkeydown = (e) => e.key === "Enter" && add();
    if (watchlist().length) await load(watchlist()); else document.getElementById("tbl").innerHTML = `<div class="empty">Liste vide.</div>`;
  } else {
    const uni = document.getElementById("uni");
    uni.onchange = () => (document.getElementById("custom-wrap").hidden = uni.value !== "__custom");
    document.getElementById("pea-only").onchange = renderT;
    document.getElementById("run").onclick = async () => {
      let syms;
      if (uni.value === "__wl") syms = watchlist();
      else if (uni.value === "__custom") { const v = document.getElementById("custom").value; store.set("custom", v); syms = v.split(/[,; ]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); }
      else syms = await api("/api/universe/" + uni.value);
      load(syms);
    };
  }
}

// ================================================================= portefeuille
async function pagePortfolio() {
  const P = portfolio();
  app.innerHTML = `
    <div class="hero"><div><div class="big">Portefeuille</div><div class="muted">Saisis tes lignes ou importe un fichier CSV (symbole ; quantité ; prix de revient). Données stockées dans ton navigateur.</div></div>
    <div class="form-row">
      <label>Symbole<input class="inp" id="p-sym" placeholder="ex : MC.PA" style="width:110px"></label>
      <label>Quantité<input class="inp" id="p-qty" type="number" step="any" style="width:90px"></label>
      <label>Prix de revient<input class="inp" id="p-pru" type="number" step="any" style="width:110px"></label>
      <button class="btn primary" id="p-add">Ajouter</button>
      <label class="btn" style="flex-direction:row;color:var(--ink)">Importer CSV<input type="file" id="p-file" accept=".csv,.txt" hidden></label>
      <button class="btn" id="p-clear">Vider</button>
    </div></div>
    <div id="pf">${P.length ? `<div class="loader"><div class="spinner"></div>Analyse des lignes…</div>` : `<div class="card empty">Aucune ligne. Ajoute une position ci-dessus.<br><small>Format CSV accepté : une ligne par position, colonnes symbole, quantité, prix de revient (séparateur ; ou ,). Les symboles Yahoo sont nécessaires (ex : TTE.PA, ASML.AS, AAPL).</small></div>`}</div>`;
  document.getElementById("p-add").onclick = () => {
    const s = document.getElementById("p-sym").value.trim().toUpperCase(), q = +document.getElementById("p-qty").value, pru = +document.getElementById("p-pru").value;
    if (!s || !q) return;
    const p = portfolio(); const ex = p.find((x) => x.symbol === s);
    if (ex) { const tot = ex.qty + q; ex.pru = pru ? (ex.pru * ex.qty + pru * q) / tot : ex.pru; ex.qty = tot; } else p.push({ symbol: s, qty: q, pru: pru || null });
    setPortfolio(p); pagePortfolio();
  };
  document.getElementById("p-clear").onclick = () => { if (confirm("Supprimer toutes les lignes du portefeuille ?")) { setPortfolio([]); pagePortfolio(); } };
  document.getElementById("p-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text(); const p = portfolio(); let n = 0;
    txt.split(/\r?\n/).forEach((line) => {
      const parts = line.split(/[;,\t]/).map((x) => x.trim().replace(/^"|"$/g, ""));
      if (parts.length < 2) return;
      const q = parseFloat(parts[1].replace(",", ".")); if (!isFinite(q) || !/^[A-Za-z0-9.\-^=]+$/.test(parts[0])) return;
      const pru = parts[2] ? parseFloat(parts[2].replace(",", ".")) : null;
      p.push({ symbol: parts[0].toUpperCase(), qty: q, pru: isFinite(pru) ? pru : null }); n++;
    });
    setPortfolio(p); alert(n + " lignes importées"); pagePortfolio();
  };
  if (!P.length) return;
  const sums = await pool(P.map((x) => x.symbol), 4, async (s) => { const r = await api("/api/summary/" + encodeURIComponent(s)); rememberName(s, r.name); return r; });
  const curs = [...new Set(sums.filter((s) => s && !s.error).map((s) => s.currency))];
  const fx = {}; await Promise.all(curs.map(async (c) => { try { fx[c] = (await api("/api/fx/" + encodeURIComponent(c))).rate; } catch { fx[c] = null; } }));
  const lines = P.map((l, i) => {
    const s = sums[i] || {}; const rate = fx[s.currency] ?? 1;
    const value = isNum(s.price) ? s.price * l.qty * rate : null, cost = isNum(l.pru) ? l.pru * l.qty * rate : null;
    return { ...l, s, value, cost, pnl: isNum(value) && isNum(cost) ? value - cost : null };
  });
  const total = lines.reduce((a, l) => a + (l.value || 0), 0), cost = lines.reduce((a, l) => a + (l.cost || 0), 0);
  const wavg = (fn) => { let n = 0, dd = 0; lines.forEach((l) => { const v = fn(l); if (isNum(v) && l.value) { n += v * l.value; dd += l.value; } }); return dd ? n / dd : null; };
  const wScore = wavg((l) => totalScore(l.s.scores || {}, l.symbol));
  const income = lines.reduce((a, l) => a + (isNum(l.s.dividendYield) && l.value ? l.s.dividendYield * l.value : 0), 0);
  const kpi = (l, v, sub = "") => `<div class="card"><div class="muted" style="font-size:12px">${l}</div><div class="big">${v}</div><div class="muted" style="font-size:12px">${sub}</div></div>`;
  document.getElementById("pf").innerHTML = `
    <div class="grid g4">
      ${kpi("Valeur totale", money(total, "EUR", 0), isNum(cost) && cost ? `<span class="${cls(total - cost)}">${money(total - cost, "EUR", 0)} (${pct(total / cost - 1, 1, true)})</span>` : "")}
      ${kpi("Risque moyen pondéré", pct(wavg((l) => l.s.risk), 1), "volatilité annuelle moyenne des lignes (sans effet de diversification)")}
      ${kpi("Croissance BPA attendue", pct(wavg((l) => l.s.growth), 1, true) + "/an", "moyenne pondérée")}
      ${kpi("Potentiel analystes", pct(wavg((l) => l.s.upside), 1, true), "objectif moyen combiné sur chaque ligne")}
      ${kpi("Espérance de rendement 5 ans", pct(wavg((l) => l.s.return5y), 1, true) + "/an", "croissance + valorisation + dividendes")}
      ${kpi("Selon mes cibles 1 an", pct(wavg((l) => { const n = noteOf(l.symbol); return +n.t1 && l.s.price ? +n.t1 / l.s.price - 1 : null; }), 1, true), "lignes avec une cible définie")}
      ${kpi("Score moyen", isNum(wScore) ? Math.round(wScore) + "/100" : "–", PROFILES[store.get("profile", "croissance")].label)}
      ${kpi("Dividendes annuels estimés", money(income, "EUR", 0), pct(total ? income / total : null, 2) + " de rendement")}
    </div>
    <div class="grid g3 mt">
      <div class="card"><h3>Répartition par ligne</h3><div class="chart small" id="pie-l"></div></div>
      <div class="card"><h3>Par secteur</h3><div class="chart small" id="pie-s"></div></div>
      <div class="card"><h3>Par pays</h3><div class="chart small" id="pie-c"></div></div>
    </div>
    <div class="card mt"><div class="table-wrap"><table class="tbl" id="pf-tbl"><tr><th>Ligne</th><th>Qté</th><th>PRU</th><th>Cours</th><th>Valeur (€)</th><th>Poids</th><th>+/- value</th><th>Score</th><th>Risque</th><th>Croiss.</th><th>Solde</th><th>Potentiel</th><th>Esp. 5 ans</th><th></th></tr>
      ${lines.map((l, i) => { const s = l.s, sc = totalScore(s.scores || {}, l.symbol), [, c] = scoreLabel(sc); return `<tr class="click" data-s="${esc(l.symbol)}"><td><b title="${esc(fullName(l.symbol, s.name))}">${esc(shortName(l.symbol, s.name))}</b><br><small class="muted">${esc(l.symbol)}${s.error ? " · " + esc(s.error.slice(0, 40)) : ""}</small></td><td>${fmt(l.qty, l.qty % 1 ? 3 : 0)}</td><td>${fmt(l.pru)}</td><td>${money(s.price, s.currency)}</td><td>${money(l.value, "EUR", 0)}</td><td>${pct(total ? l.value / total : null, 1)}</td><td class="${cls(l.pnl)}">${money(l.pnl, "EUR", 0)}</td><td><span class="badge ${c}">${isNum(sc) ? Math.round(sc) : "–"}</span></td><td><span class="heat" style="${heat(s.risk, 0.15, 0.6, true)}">${pct(s.risk, 0)}</span></td><td>${pct(s.growth, 1, true)}</td><td><span class="heat" style="${heat(s.discount, -0.4, 0.4, true)}">${isNum(s.discount) ? (s.discount < 0 ? "−" : "+") + pct(Math.abs(s.discount), 0) : "–"}</span></td><td class="${cls(s.upside)}">${pct(s.upside, 0, true)}</td><td class="${cls(s.return5y)}">${pct(s.return5y, 1, true)}</td><td><button class="btn sm" data-rm="${i}">✕</button></td></tr>`; }).join("")}</table></div>
      <div class="note">Les montants sont convertis en euros au taux du jour. Clique sur une ligne pour l'analyse détaillée.</div></div>`;
  document.querySelectorAll("#pf-tbl tr.click").forEach((tr) => (tr.onclick = (e) => { if (e.target.dataset.rm != null) { const p = portfolio(); p.splice(+e.target.dataset.rm, 1); setPortfolio(p); pagePortfolio(); return; } location.hash = "#/action/" + encodeURIComponent(tr.dataset.s); }));
  const pie = (id, groups) => {
    const c = chart(document.getElementById(id));
    c.setOption({ tooltip: { trigger: "item", formatter: (p) => `${esc(p.name)} : ${money(p.value, "EUR", 0)} (${fmt(p.percent, 1)} %)` }, color: [...palette(), "#9b59b6", "#16a085", "#e67e22", "#2980b9"],
      series: [{ type: "pie", radius: ["40%", "72%"], label: { color: css("--muted"), fontSize: 11 }, data: Object.entries(groups).map(([name, value]) => ({ name, value })) }] });
  };
  const grp = (fn) => { const g = {}; lines.forEach((l) => { if (l.value) { const k = fn(l) || "Autre"; g[k] = (g[k] || 0) + l.value; } }); return g; };
  pie("pie-l", grp((l) => shortName(l.symbol, l.s.name))); pie("pie-s", grp((l) => l.s.sector)); pie("pie-c", grp((l) => l.s.country));
}

// ================================================================= calendrier
async function pageCalendar() {
  const syms = [...new Set([...watchlist(), ...portfolio().map((p) => p.symbol)])];
  app.innerHTML = `<div class="big">Calendrier</div><div class="muted">Prochaines publications de résultats et détachements de dividende pour ta liste de suivi et ton portefeuille.</div>
    <div class="card mt" id="cal"><div class="loader"><div class="spinner"></div>Chargement…</div></div>`;
  if (!syms.length) { document.getElementById("cal").innerHTML = `<div class="empty">Ajoute des actions à ta liste de suivi.</div>`; return; }
  const sums = (await pool(syms, 4, (s) => api("/api/summary/" + encodeURIComponent(s)))).filter((s) => s && !s.error);
  const today = new Date().toISOString().slice(0, 10);
  const ev = [];
  sums.forEach((s) => {
    if (s.nextEarnings) ev.push({ date: s.nextEarnings.slice(0, 10), type: "Publication des résultats", s });
    if (s.exDividend) ev.push({ date: s.exDividend, type: `Détachement du dividende (${money(s.dividendAnnual, s.currency)} / an)`, s });
  });
  ev.sort((a, b) => a.date.localeCompare(b.date));
  const fut = ev.filter((e) => e.date >= today), past = ev.filter((e) => e.date < today).reverse().slice(0, 10);
  const tbl = (arr) => `<table class="tbl"><tr><th>Date</th><th class="l">Action</th><th class="l">Événement</th></tr>${arr.map((e) => `<tr class="click" onclick="location.hash='#/action/${encodeURIComponent(e.s.symbol)}'"><td>${dfr(e.date)}</td><td class="l"><b title="${esc(fullName(e.s.symbol, e.s.name))}">${esc(shortName(e.s.symbol, e.s.name))}</b> <small class="muted">${esc(e.s.symbol)}</small></td><td class="l">${esc(e.type)}</td></tr>`).join("")}</table>`;
  document.getElementById("cal").innerHTML = `<h3>À venir</h3>${fut.length ? tbl(fut) : `<div class="empty">Rien de prévu.</div>`}${past.length ? `<h3 class="mt">Récents</h3>${tbl(past)}` : ""}`;
}

// ================================================================= analyse technique (TradingView + signaux calculés)
const TV_STUDIES = [
  ["ma50", "MM 50 j", { id: "MASimple@tv-basicstudies", inputs: { length: 50 } }],
  ["ma200", "MM 200 j", { id: "MASimple@tv-basicstudies", inputs: { length: 200 } }],
  ["bb", "Bollinger", { id: "BB@tv-basicstudies" }],
  ["rsi", "RSI", { id: "RSI@tv-basicstudies" }],
  ["macd", "MACD", { id: "MACD@tv-basicstudies" }],
  ["stoch", "Stochastique", { id: "Stochastic@tv-basicstudies" }],
  ["ichimoku", "Ichimoku", { id: "IchimokuCloud@tv-basicstudies" }],
]; // toutes au format objet : le widget ignore les identifiants texte mélangés à des objets
const tvPrefs = () => ({ enabled: true, studies: ["ma50", "ma200", "rsi", "macd"], ...store.get("tv", {}) });
const setTvPrefs = (p) => store.set("tv", { ...tvPrefs(), ...p });
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";

function mountTradingView(box, tvSym) {
  box.innerHTML = "";
  const w = document.createElement("div");
  w.className = "tradingview-widget-container";
  w.style.cssText = "height:100%;width:100%";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  inner.style.cssText = "height:100%;width:100%";
  w.appendChild(inner);
  const sel = tvPrefs().studies;
  const sc = document.createElement("script");
  sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  sc.async = true;
  sc.textContent = JSON.stringify({
    autosize: true, symbol: tvSym, interval: "D", timezone: "Europe/Paris", theme: isDark() ? "dark" : "light",
    style: "1", locale: "fr", withdateranges: true, allow_symbol_change: true, hide_side_toolbar: false,
    save_image: true, calendar: false, details: false,
    studies: TV_STUDIES.filter(([k]) => sel.includes(k)).map(([, , s]) => s),
    support_host: "https://www.tradingview.com",
  });
  sc.onerror = () => { box.innerHTML = `<div class="empty">Impossible de charger TradingView : vérifie ta connexion internet ou un éventuel bloqueur de publicités.</div>`; };
  w.appendChild(sc);
  box.appendChild(w);
}

function renderTradingView(d) {
  const tv = d.profile.tradingview, box = document.getElementById("tv-box"), bar = document.getElementById("tv-bar");
  if (!box) return;
  const link = tv ? `<a class="btn sm" href="${esc(tv.url)}" target="_blank" rel="noopener">Ouvrir sur TradingView ↗</a>` : "";
  if (!tv || !tv.widget) {
    bar.innerHTML = link;
    box.classList.add("off");
    box.innerHTML = `<div class="empty">${tv ? `Les cours de cette place (${esc(tv.symbol.split(":")[0])}) ne sont pas fournis dans le graphique gratuit de TradingView. Le bouton ci-dessus ouvre le graphique complet sur leur site.` : "Pas d'équivalent TradingView connu pour ce symbole."}<br>Les signaux techniques calculés à droite restent disponibles.</div>`;
    return;
  }
  const P = tvPrefs();
  bar.innerHTML = `<div class="toggles" style="margin:0">${TV_STUDIES.map(([k, l]) => `<label class="${P.studies.includes(k) ? "on" : ""}"><input type="checkbox" data-k="${k}" ${P.studies.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</div>${link}`;
  bar.querySelectorAll("input[data-k]").forEach((inp) => (inp.onchange = () => {
    const cur = new Set(tvPrefs().studies);
    inp.checked ? cur.add(inp.dataset.k) : cur.delete(inp.dataset.k);
    inp.parentElement.classList.toggle("on", inp.checked);
    setTvPrefs({ studies: [...cur] });
    if (tvPrefs().enabled) mountTradingView(box, tv.symbol);
  }));
  if (!P.enabled) {
    box.classList.add("off");
    box.innerHTML = `<div class="empty">Graphique TradingView masqué (Réglages).<br><button class="btn mt" id="tv-show">Afficher pour cette fois</button></div>`;
    document.getElementById("tv-show").onclick = () => { box.classList.remove("off"); mountTradingView(box, tv.symbol); };
    return;
  }
  box.innerHTML = `<div class="loader"><div class="spinner"></div>Chargement du graphique TradingView…</div>`;
  // chargement seulement quand la zone approche de l'écran (le widget est lourd)
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { io.disconnect(); mountTradingView(box, tv.symbol); }
  }, { rootMargin: "400px" });
  io.observe(box);
}

// -- indicateurs calculés sur les clôtures quotidiennes
const smaAt = (a, n, end = a.length) => { if (end < n) return null; let s = 0; for (let i = end - n; i < end; i++) s += a[i]; return s / n; };
function emaArr(a, n) { const k = 2 / (n + 1), out = new Array(a.length); let e = a[0]; for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; out[i] = e; } return out; }
function rsiOf(a, n = 14) {
  if (a.length <= n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const dd = a[i] - a[i - 1]; g += Math.max(dd, 0); l += Math.max(-dd, 0); }
  g /= n; l /= n;
  for (let i = n + 1; i < a.length; i++) { const dd = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(dd, 0)) / n; l = (l * (n - 1) + Math.max(-dd, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function technicalSignals(H) {
  const n = H.close.length;
  if (n < 60) return null;
  const c = H.close.slice(-800), dates = H.dates.slice(-800), last = c[c.length - 1], L = c.length;
  const ma = [];
  for (const k of [20, 50, 100, 200]) {
    const v = smaAt(c, k);
    if (isNum(v)) ma.push({ label: `Moyenne mobile ${k} j`, value: v, vote: last > v ? 1 : -1, txt: last > v ? `cours au-dessus (${pct(last / v - 1, 1, true)})` : `cours en dessous (${pct(last / v - 1, 1, true)})` });
  }
  let cross = null;
  if (L >= 201) {
    const s50 = smaAt(c, 50), s200 = smaAt(c, 200), golden = s50 > s200;
    let when = null;
    for (let e = L - 1; e >= 201; e--) {
      const a = smaAt(c, 50, e) > smaAt(c, 200, e);
      if (a !== golden) { when = dates[e]; break; }
    }
    cross = { golden, when };
    ma.push({ label: "MM 50 j vs MM 200 j", value: null, vote: golden ? 1 : -1, txt: (golden ? "croisement doré (tendance haussière)" : "croisement de la mort (tendance baissière)") + (when ? ` depuis le ${dfr(when)}` : "") });
  }
  const osc = [];
  const r = rsiOf(c.slice(-300));
  if (isNum(r)) osc.push({ label: "RSI 14 j", value: r, vote: r < 30 ? 1 : r > 70 ? -1 : 0, txt: `${fmt(r, 1)} · ${r < 30 ? "survente" : r > 70 ? "surachat" : "zone neutre (30-70)"}` });
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26), macd = c.map((_, i) => e12[i] - e26[i]), sig = emaArr(macd, 9);
  const m = macd[L - 1], s = sig[L - 1];
  osc.push({ label: "MACD (12, 26, 9)", value: m, vote: m > s ? 1 : -1, txt: `${m > s ? "au-dessus" : "en dessous"} de sa ligne de signal (histogramme ${fmt(m - s, 2)})` });
  const roc = c[L - 11] ? last / c[L - 11] - 1 : null;
  if (isNum(roc)) osc.push({ label: "Momentum 10 j", value: roc, vote: roc > 0 ? 1 : roc < 0 ? -1 : 0, txt: pct(roc, 1, true) });
  const m20 = smaAt(c, 20);
  if (isNum(m20)) {
    let v = 0; for (let i = L - 20; i < L; i++) v += (c[i] - m20) ** 2;
    const sd = Math.sqrt(v / 20), pb = sd ? (last - (m20 - 2 * sd)) / (4 * sd) : 0.5;
    osc.push({ label: "Bandes de Bollinger (20, 2)", value: pb, vote: pb < 0 ? 1 : pb > 1 ? -1 : 0, txt: pb < 0 ? "sous la bande basse (excès de baisse)" : pb > 1 ? "au-dessus de la bande haute (excès de hausse)" : `dans les bandes (position ${pct(pb, 0)})` });
  }
  const all = [...ma, ...osc], score = all.reduce((t, x) => t + x.vote, 0) / all.length;
  const verdict = score >= 0.5 ? ["Achat fort", "up"] : score >= 0.1 ? ["Achat", "up"] : score <= -0.5 ? ["Vente forte", "down"] : score <= -0.1 ? ["Vente", "down"] : ["Neutre", "muted"];
  const perf = (days) => { const t = Date.parse(dates[L - 1]) - days * 864e5; const i = dates.findIndex((x) => Date.parse(x) >= t); return i >= 0 && i < L - 1 ? last / c[i] - 1 : null; };
  const hi52 = Math.max(...c.slice(-252)), lo52 = Math.min(...c.slice(-252));
  return { ma, osc, score, verdict, cross, counts: [all.filter((x) => x.vote > 0).length, all.filter((x) => x.vote === 0).length, all.filter((x) => x.vote < 0).length],
    perf: { m1: perf(30), m3: perf(91), m6: perf(182), y1: perf(365) }, fromHigh: last / hi52 - 1, fromLow: last / lo52 - 1 };
}
function renderTechCard(d) {
  const el = document.getElementById("tech-card");
  if (!el) return;
  const T = technicalSignals(d.history);
  if (!T) { el.innerHTML = `<h3>Signaux techniques</h3><div class="empty">Historique trop court pour calculer les indicateurs.</div>`; return; }
  const row = (x) => `<div class="kv"><span>${esc(x.label)}<small style="display:block;font-size:11px">${x.txt}</small></span><b class="${x.vote > 0 ? "up" : x.vote < 0 ? "down" : "muted"}">${x.vote > 0 ? "Achat" : x.vote < 0 ? "Vente" : "Neutre"}</b></div>`;
  const pos = ((T.score + 1) / 2) * 100;
  el.innerHTML = `<h3>Signaux techniques</h3><div class="sub">Calculés sur les clôtures quotidiennes (Yahoo Finance)</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="big ${T.verdict[1]}">${T.verdict[0]}</div><div class="muted" style="font-size:12px"><span class="up">${T.counts[0]} achat</span> · ${T.counts[1]} neutre · <span class="down">${T.counts[2]} vente</span></div></div>
    <div class="range" style="margin-top:4px"><div class="track"></div><div class="mk mean" style="left:${pos}%"><i></i></div></div>
    <div style="display:flex;justify-content:space-between;font-size:11px" class="muted"><span>Vente forte</span><span>Neutre</span><span>Achat fort</span></div>
    <div class="section-sub">Tendance (moyennes mobiles)</div>${T.ma.map(row).join("")}
    <div class="section-sub">Oscillateurs</div>${T.osc.map(row).join("")}
    <div class="section-sub">Performance</div>
    <div class="kv"><span>1 mois · 3 mois · 6 mois · 1 an</span><b><span class="${cls(T.perf.m1)}">${pct(T.perf.m1, 1, true)}</span> · <span class="${cls(T.perf.m3)}">${pct(T.perf.m3, 1, true)}</span> · <span class="${cls(T.perf.m6)}">${pct(T.perf.m6, 1, true)}</span> · <span class="${cls(T.perf.y1)}">${pct(T.perf.y1, 1, true)}</span></b></div>
    <div class="kv"><span>Écart au plus haut / plus bas 52 sem.</span><b><span class="down">${pct(T.fromHigh, 1, true)}</span> / <span class="up">${pct(T.fromLow, 1, true)}</span></b></div>
    <div class="note">Indication mécanique de tendance, pas une prévision ni un conseil.</div>`;
}

// ================================================================= Financial Modeling Prep (offre gratuite, complément)
const isUsSymbol = (s) => !/[.^=]/.test(s);
function fmpSectionHtml(inner) {
  return `<div class="section-title"><span class="ico blue">◈</span>Données complémentaires <small>Financial Modeling Prep, offre gratuite</small></div>${inner}`;
}
async function renderFmp(d, force = false) {
  const el = document.getElementById("fmp-sec");
  if (!el) return;
  const S = d.profile.symbol;
  if (!isUsSymbol(S)) { el.innerHTML = ""; return; } // l'offre gratuite ne couvre aucune action hors États-Unis
  el.innerHTML = fmpSectionHtml(`<div class="card"><div class="loader"><div class="spinner"></div>Interrogation de Financial Modeling Prep…</div></div>`);
  let f;
  try { f = await api("/api/fmp/" + encodeURIComponent(S) + (force ? "?refresh=1" : ""), { force }); }
  catch (e) { el.innerHTML = fmpSectionHtml(`<div class="card note">FMP indisponible : ${esc(e.message)}</div>`); return; }
  if (!document.body.contains(el)) return;
  const msg = {
    no_key: `Ajoute ta clé gratuite Financial Modeling Prep dans <a href="#/reglages">Réglages</a> pour voir ici la répartition du chiffre d'affaires par division et par région, les estimations sur plusieurs années, l'historique des recommandations et les scores de solidité financière (Altman, Piotroski). C'est gratuit, sans carte bancaire, et ça couvre environ 90 grandes actions américaines.`,
    not_covered: `Cette action ne fait pas partie de la liste d'environ 90 grandes actions américaines couvertes par l'offre gratuite de Financial Modeling Prep. Les données Yahoo Finance de la fiche restent complètes.`,
    invalid_key: `La clé Financial Modeling Prep enregistrée est refusée. Vérifie-la dans <a href="#/reglages">Réglages</a>.`,
    limit: `Le quota gratuit du jour (250 requêtes) est atteint. Les données Financial Modeling Prep reviendront demain.`,
    error: `Financial Modeling Prep n'a pas répondu (${esc(f.message || "erreur")}). Réessaie plus tard.`,
  }[f.status];
  if (msg) { el.innerHTML = fmpSectionHtml(`<div class="card note" style="margin-top:0">${msg}</div>`); return; }

  const cur = d.profile.financialCurrency || d.profile.currency, px = d.profile.price;
  const segP = f.segments?.product || [], segG = f.segments?.geo || [];
  const today = new Date().toISOString().slice(0, 10);
  const est = (f.estimates || []).filter((e) => e.date >= today); // exercices pas encore clos
  let cagr = null;
  if (est.length >= 2 && est[0].eps > 0 && est[est.length - 1].eps > 0) cagr = Math.pow(est[est.length - 1].eps / est[0].eps, 1 / (est.length - 1)) - 1;
  const sc = f.scores || {}, rt = f.rating || {}, dcf = f.dcf || {}, tg = f.targets || {};
  const altZone = !isNum(sc.altman) ? null : sc.altman > 2.99 ? ["Zone sûre", "green"] : sc.altman >= 1.81 ? ["Zone grise", "orange"] : ["Zone de détresse", "red"];
  const pioZone = !isNum(sc.piotroski) ? null : sc.piotroski >= 7 ? ["Solide", "green"] : sc.piotroski >= 4 ? ["Moyen", "blue"] : ["Fragile", "red"];
  const row = (l, v, tip = "") => `<div class="kv"><span ${tip ? `title="${esc(tip)}"` : ""}>${l}${tip ? " ⓘ" : ""}</span><b>${v}</b></div>`;
  const ACT = { upgrade: "Relèvement", downgrade: "Abaissement", maintain: "Maintien", initialize: "Initiation", initiate: "Initiation", reiterate: "Réitération", init: "Initiation", up: "Relèvement", down: "Abaissement" };
  el.innerHTML = fmpSectionHtml(`
    <div class="grid g2">
      <div class="card"><h3>Chiffre d'affaires par division</h3><div class="sub">Répartition annuelle publiée (${esc(cur || "")})</div><div class="chart" id="seg-prod"></div></div>
      <div class="card"><h3>Chiffre d'affaires par région</h3><div class="sub">Répartition géographique annuelle publiée (${esc(cur || "")})</div><div class="chart" id="seg-geo"></div></div>
    </div>
    <div class="grid g3 mt">
      <div class="card"><h3>Estimations sur plusieurs années</h3><div class="sub">Consensus annuel des analystes, au-delà des 2 ans de Yahoo</div>
        ${est.length ? `<div class="table-wrap"><table class="tbl"><tr><th>Exercice</th><th>CA estimé</th><th>BPA estimé</th><th>Bas – haut</th><th>Nb</th></tr>
          ${est.map((e) => `<tr><td>${esc(e.year)}</td><td>${big(e.revenue)}</td><td><b>${fmt(e.eps)}</b></td><td class="muted">${fmt(e.epsLow)} – ${fmt(e.epsHigh)}</td><td>${e.analystsEps ?? "–"}</td></tr>`).join("")}</table></div>
          ${isNum(cagr) ? `<div class="note">Croissance annuelle moyenne du BPA attendue de ${esc(est[0].year)} à ${esc(est[est.length - 1].year)} : <b class="${cls(cagr)}">${pct(cagr, 1, true)}/an</b>. Les années lointaines reposent sur peu d'analystes.</div>` : ""}`
          : `<div class="empty">Pas d'estimations pluriannuelles.</div>`}
      </div>
      <div class="card"><h3>Solidité financière</h3><div class="sub">Scores calculés par FMP sur les comptes publiés</div>
        ${row("Altman Z-score", isNum(sc.altman) ? `${fmt(sc.altman, 2)} <span class="badge ${altZone[1]}">${altZone[0]}</span>` : "–", "Risque de défaillance à 2 ans. Au-dessus de 3 : sûr ; 1,8 à 3 : zone grise ; sous 1,8 : détresse. Peu pertinent pour les banques et assurances.")}
        ${row("Piotroski F-score", isNum(sc.piotroski) ? `${fmt(sc.piotroski, 0)}/9 <span class="badge ${pioZone[1]}">${pioZone[0]}</span>` : "–", "9 critères de rentabilité, d'endettement et d'efficacité. 7 à 9 : solide ; 0 à 3 : fragile.")}
        ${row("Note FMP", rt.rating ? `${esc(rt.rating)}${isNum(rt.score) ? ` (${fmt(rt.score, 0)}/5)` : ""}` : "–", "Note synthétique de FMP (DCF, ROE, ROA, dette, PE, valeur comptable).")}
        ${row("Valeur DCF selon FMP", isNum(dcf.value) ? `${money(dcf.value, d.profile.currency)} <span class="${cls(px && dcf.value / px - 1)}">${px ? pct(dcf.value / px - 1, 0, true) : ""}</span>` : "–", "Modèle d'actualisation des flux de trésorerie de FMP, à comparer au DCF de la fiche.")}
        ${row("Objectif des analystes (FMP)", isNum(tg.consensus) ? `${money(tg.consensus, d.profile.currency)} <span class="${cls(px && tg.consensus / px - 1)}">${px ? pct(tg.consensus / px - 1, 0, true) : ""}</span>` : "–")}
        ${isNum(tg.low) ? row("Fourchette des objectifs", `${fmt(tg.low, 0)} – ${fmt(tg.high, 0)}${isNum(tg.median) ? ` (médiane ${fmt(tg.median, 0)})` : ""}`) : ""}
      </div>
      <div class="card"><h3>Dernières recommandations</h3><div class="sub">Relèvements et abaissements par banque</div>
        ${(f.grades || []).length ? `<div class="table-wrap" style="max-height:330px;overflow:auto"><table class="tbl"><tr><th>Date</th><th class="l">Banque</th><th class="l">Action</th><th class="l">Note</th></tr>
          ${f.grades.slice(0, 25).map((g) => `<tr><td>${dfr(g.date)}</td><td class="l">${esc(g.firm || "")}</td><td class="l ${g.action === "upgrade" ? "up" : g.action === "downgrade" ? "down" : ""}">${esc(ACT[(g.action || "").toLowerCase()] || g.action || "")}</td><td class="l">${esc(g.from && g.from !== g.to ? g.from + " → " : "")}${esc(g.to || "")}</td></tr>`).join("")}</table></div>`
          : `<div class="empty">Pas d'historique de recommandations.</div>`}
      </div>
    </div>
    <div class="note">Source : Financial Modeling Prep, offre gratuite. Requêtes utilisées aujourd'hui : ${f.usage?.calls ?? "–"} / ${f.usage?.limit ?? 250}. Données gardées en mémoire 1 à 7 jours pour économiser le quota.
      ${f.warning ? `<span class="warn">${esc(f.warning)}</span>` : ""} <button class="btn sm" id="fmp-refresh" title="Consomme environ 8 requêtes">↻ Recharger depuis FMP</button></div>`);
  document.getElementById("fmp-refresh").onclick = () => renderFmp(d, true);
  renderSegments("seg-prod", segP, cur);
  renderSegments("seg-geo", segG, cur);
}
const SEG_FR = { "united states": "États-Unis", "us": "États-Unis", "u.s.": "États-Unis", "non us": "Hors États-Unis", "non-us": "Hors États-Unis",
  "international": "International", "americas": "Amériques", "north america": "Amérique du Nord", "latin america": "Amérique latine",
  "europe": "Europe", "emea": "Europe, Moyen-Orient, Afrique", "europe, middle east and africa": "Europe, Moyen-Orient, Afrique",
  "greater china": "Grande Chine", "china": "Chine", "japan": "Japon", "taiwan": "Taïwan", "rest of asia pacific": "Reste de l'Asie-Pacifique",
  "asia pacific": "Asie-Pacifique", "other countries": "Autres pays", "other": "Autres", "rest of world": "Reste du monde", "canada": "Canada" };
const segLabel = (k) => SEG_FR[k.toLowerCase()] || k;
function renderSegments(id, rows, cur) {
  const el = document.getElementById(id);
  if (!rows.length) { el.style.height = "auto"; el.innerHTML = `<div class="empty">Répartition non publiée pour cette entreprise.</div>`; return; }
  // chaque année garde ses propres libellés (les divisions sont parfois renommées) ; les plus grosses ont leur couleur
  const tot = {};
  rows.forEach((r, i) => Object.entries(r.items).forEach(([k, v]) => (tot[k] = (tot[k] || 0) + v * (1 + i / rows.length))));
  const names = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  const keep = names.slice(0, 9), others = new Set(names.slice(9));
  const cats = rows.map((r) => r.year || String(r.date).slice(0, 4));
  const series = keep.map((k) => ({ name: segLabel(k), type: "bar", stack: "t", data: rows.map((r) => r.items[k] ?? null), emphasis: { focus: "series" } }));
  if (others.size) series.push({ name: "Autres", type: "bar", stack: "t", data: rows.map((r) => [...others].reduce((t, k) => t + (r.items[k] || 0), 0) || null) });
  const o = baseOpt(), c = chart(el);
  c.setOption({ ...o, color: [...palette(), "#b07d48", "#4f7cac", "#9c6b98", "#9aa9b4"], grid: { left: 64, right: 12, top: 56, bottom: 28 },
    legend: { ...o.legend, top: 0 },
    tooltip: { ...o.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => { const tot = ps.reduce((t, p) => t + (p.value || 0), 0); return `<b>${esc(ps[0].axisValue)}</b> · total ${big(tot, cur)}<br>` + ps.filter((p) => p.value).map((p) => `${p.marker}${esc(p.seriesName)} : ${big(p.value, cur)} (${pct(p.value / tot, 0)})`).join("<br>"); } },
    xAxis: { ...o.xAxis, type: "category", data: cats }, yAxis: { ...o.yAxis, type: "value", axisLabel: { ...o.yAxis.axisLabel, formatter: (v) => big(v) } }, series });
}

// ================================================================= réglages
async function pageSettings() {
  app.innerHTML = `<div class="big">Réglages</div><div class="muted">Sources de données complémentaires et affichage.</div>
    <div class="grid g2 mt">
      <div class="card" id="set-fmp"><div class="loader"><div class="spinner"></div>Chargement…</div></div>
      <div class="card" id="set-tv"></div>
    </div>`;
  renderTvSettings();
  await renderFmpSettings();
}
async function renderFmpSettings(flash = "") {
  const el = document.getElementById("set-fmp");
  let st;
  try { st = (await api("/api/settings", { force: true })).fmp; } catch (e) { el.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const u = st.usage || {};
  el.innerHTML = `<h3><span class="ico blue">◈</span>Financial Modeling Prep (gratuit)</h3>
    <div class="sub">Données fondamentales en plus de Yahoo Finance, offre gratuite uniquement</div>
    <div class="kv"><span>État</span><b>${st.configured ? (st.invalid ? `<span class="down">Clé refusée par FMP</span>` : `<span class="up">Clé enregistrée</span> (${esc(st.keyHint || "")})`) : "Aucune clé"}</b></div>
    <div class="kv"><span>Requêtes utilisées aujourd'hui</span><b>${u.calls ?? 0} / ${u.limit ?? 250}</b></div>
    ${st.source === "env" ? `<div class="note">La clé vient de la variable d'environnement FMP_API_KEY.</div>` : `
    <div class="form-row"><label style="flex:1">Ta clé API FMP<input class="inp" id="fmp-key" type="password" autocomplete="off" placeholder="Colle ta clé ici" style="width:100%"></label>
      <button class="btn primary" id="fmp-save">Enregistrer et tester</button>${st.configured ? `<button class="btn" id="fmp-del">Supprimer</button>` : ""}</div>`}
    <div class="note" id="fmp-msg">${flash}</div>
    <h3 class="mt" style="font-size:14px">Obtenir ta clé gratuite (2 minutes)</h3>
    <ol class="steps">
      <li>Ouvre la <a href="${esc(st.registerUrl)}" target="_blank" rel="noopener">page d'inscription de Financial Modeling Prep</a> et crée un compte avec ton e-mail. Aucune carte bancaire n'est demandée. Si on te propose des offres, garde l'offre gratuite « Basic » et ignore les offres payantes.</li>
      <li>Confirme ton e-mail si on te le demande, puis connecte-toi et ouvre ton tableau de bord (« Dashboard », en haut à droite).</li>
      <li>Copie ta clé (« API Key »), colle-la dans le champ ci-dessus et clique sur « Enregistrer et tester ».</li>
    </ol>
    <div class="note">La clé reste sur ton PC, dans un fichier local hors OneDrive et hors GitHub. Le test consomme 1 requête.</div>
    <h3 class="mt" style="font-size:14px">Ce que couvre l'offre gratuite</h3>
    <ul class="steps">
      <li>250 requêtes par jour et 5 ans d'historique. L'application en garde une marge et met les réponses en mémoire 1 à 7 jours : ouvrir une fiche coûte environ 8 requêtes la première fois, puis rien.</li>
      <li>Seulement une liste fixe d'environ 90 grandes actions américaines (Apple, Microsoft, Amazon, Tesla…). Aucune action européenne : pour celles-ci, l'application continue avec Yahoo Finance, sans dépenser de requête.</li>
      <li>Ce qu'elle ajoute sur ces actions : chiffre d'affaires par division et par région, estimations sur plusieurs années, historique des relèvements et abaissements, scores Altman et Piotroski, note et DCF de FMP.</li>
    </ul>`;
  const save = document.getElementById("fmp-save"), del = document.getElementById("fmp-del"), m = document.getElementById("fmp-msg");
  const post = async (key) => {
    const r = await fetch("/api/settings/fmp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || r.statusText);
    return j;
  };
  if (save) save.onclick = async () => {
    const key = document.getElementById("fmp-key").value.trim();
    if (!key) { m.innerHTML = `<span class="down">Colle d'abord ta clé.</span>`; return; }
    save.disabled = true; m.textContent = "Test de la clé auprès de FMP…";
    try { await post(key); [...memo.keys()].filter((k) => k.startsWith("/api/fmp/")).forEach((k) => memo.delete(k)); await renderFmpSettings(`<span class="up">Clé valide et enregistrée ✓</span> Ouvre une grande action américaine (ex : <a href="#/action/MSFT">MSFT</a>) pour voir les données.`); }
    catch (e) { m.innerHTML = `<span class="down">${esc(e.message)}</span>`; save.disabled = false; }
  };
  if (del) del.onclick = async () => {
    try { await post(""); [...memo.keys()].filter((k) => k.startsWith("/api/fmp/")).forEach((k) => memo.delete(k)); await renderFmpSettings("Clé supprimée."); } catch (e) { m.textContent = e.message; }
  };
}
function renderTvSettings() {
  const el = document.getElementById("set-tv"), P = tvPrefs();
  el.innerHTML = `<h3><span class="ico navy">⌁</span>Graphique TradingView</h3><div class="sub">Widget gratuit intégré à chaque fiche action</div>
    <label class="kv" style="cursor:pointer"><span>Afficher le graphique TradingView dans les fiches</span><input type="checkbox" id="tv-en" ${P.enabled ? "checked" : ""}></label>
    <div class="note" style="margin-bottom:6px">Indicateurs affichés par défaut (modifiables aussi au-dessus du graphique) :</div>
    <div class="toggles" id="tv-def">${TV_STUDIES.map(([k, l]) => `<label class="${P.studies.includes(k) ? "on" : ""}"><input type="checkbox" data-k="${k}" ${P.studies.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</div>
    <ul class="steps">
      <li>Cours en différé fournis par TradingView. Les actions de Paris, Amsterdam, Bruxelles, Francfort (Xetra), Milan, Madrid, Zurich, Copenhague et des bourses américaines s'affichent.</li>
      <li>La Bourse de Londres n'est pas fournie dans le widget gratuit : la fiche propose alors un lien vers le graphique complet sur TradingView.</li>
      <li>Dans le graphique, le bouton « Indicateurs » permet d'en ajouter d'autres pour la séance en cours (ils ne sont pas mémorisés).</li>
      <li>La carte « Signaux techniques » à côté du graphique est calculée par l'application et fonctionne pour toutes les actions.</li>
    </ul>`;
  document.getElementById("tv-en").onchange = (e) => setTvPrefs({ enabled: e.target.checked });
  el.querySelectorAll("#tv-def input").forEach((inp) => (inp.onchange = () => {
    const cur = new Set(tvPrefs().studies);
    inp.checked ? cur.add(inp.dataset.k) : cur.delete(inp.dataset.k);
    inp.parentElement.classList.toggle("on", inp.checked);
    setTvPrefs({ studies: [...cur] });
  }));
}

// les symboles de suivi.txt sont ajoutés une seule fois (un symbole retiré ensuite n'est pas réajouté)
(async function syncWatchFile() {
  try {
    const syms = await api("/api/suivi-fichier");
    // corrections : symboles ajoutés par erreur lors d'une version précédente du fichier
    const REMOVED = ["EL.PA", "EXA.PA", "DESN.SW"];
    const fixed = store.get("fileFix1", false);
    if (!fixed) { setWatchlist(watchlist().filter((s) => !REMOVED.includes(s) || syms.includes(s))); store.set("fileFix1", true); }
    const seen = new Set(store.get("fileSeen", []));
    const fresh = syms.filter((s) => !seen.has(s));
    if (fresh.length) {
      setWatchlist([...watchlist(), ...fresh]);
      store.set("fileSeen", [...seen, ...fresh]);
      if (/^#\/?(suivi)?$/.test(location.hash) || !location.hash) route();
    }
  } catch {}
})();

// en ligne avec mot de passe : lien « Se déconnecter »
api("/api/health").then((h) => { if (h.password) document.getElementById("logout-link").hidden = false; }).catch(() => {});

route();
