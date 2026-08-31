/* Alpha Technical Centre — Situation Room
   Toggle AUTH_ENABLED to true before putting this on a public host. */
const AUTH_ENABLED = true;
const AUTH_CODE = "alpha-internal";

const FALLBACK = {
  "CL=F": { name: "WTI", price: 82.93, change: 0.70, pct: 0.86, unit: "$/bbl" },
  "BZ=F": { name: "Brent", price: 89.13, change: 1.29, pct: 1.47, unit: "$/bbl" },
  "NG=F": { name: "Henry Hub", price: 2.98, change: 0.11, pct: 3.67, unit: "$/MMBtu" },
  "RB=F": { name: "RBOB", price: 3.35, change: 0.03, pct: 0.77, unit: "$/gal" },
  "HO=F": { name: "ULSD / HO", price: 4.21, change: -0.05, pct: -1.28, unit: "$/gal" },
  "GC=F": { name: "Gold", price: 4575, change: -19, pct: -0.41, unit: "$/oz" },
  "SI=F": { name: "Silver", price: 68.19, change: 0.09, pct: 0.14, unit: "$/oz" },
  "HG=F": { name: "Copper", price: 6.57, change: -0.03, pct: -0.46, unit: "$/lb" },
  "DX-Y.NYB": { name: "DXY", price: 98.4, change: 0.12, pct: 0.12, unit: "" },
  "^VIX": { name: "VIX", price: 18.6, change: 0.4, pct: 2.2, unit: "" }
};

const SYMBOLS = Object.keys(FALLBACK);
let quotes = JSON.parse(JSON.stringify(FALLBACK));

const ASSETS = [
  {
    id: "gulf",
    name: "US Gulf Coast",
    tag: "Operated",
    pill: "ops",
    pillText: "Producing",
    blurb: "Texas / offshore conventional. Acquire-and-exploit focus: workovers, waterflood, lifting-cost discipline, FCF over activity for its own sake.",
    meta: ["TPIC / Alpha", "Operator"],
    lat: 29.76, lng: -95.37
  },
  {
    id: "venezuela",
    name: "Venezuela",
    tag: "Watch",
    pill: "eval",
    pillText: "Screening",
    blurb: "Mature conventional inventory — Lake Maracaibo / Zulia clusters and Boscan-type heavy oil. Entry thesis is brownfield turnaround, not exploration.",
    meta: ["Alpha LatAm watch", "PSA / JV path"],
    lat: 10.48, lng: -71.64
  },
  {
    id: "uk",
    name: "United Kingdom",
    tag: "Licence",
    pill: "watch",
    pillText: "Option",
    blurb: "York Energy UK — onshore gas optionality (Weaverthorpe / PL081 farmout option). North Sea gas tightness still sets the regional bid.",
    meta: ["York Energy UK", "25% Weaverthorpe"],
    lat: 54.2, lng: -0.4
  },
  {
    id: "ukraine",
    name: "Ukraine",
    tag: "PSA",
    pill: "risk",
    pillText: "Conflict risk",
    blurb: "Ichnyanskaya 50-year PSA. 515k acres, ~90 mmbbl resource potential on the corporate site. Operations constrained by security and infrastructure.",
    meta: ["York / Alpha", "50-yr PSA"],
    lat: 50.86, lng: 32.39
  }
];

const CHOKES = [
  { name: "Strait of Hormuz", status: "critical", note: "Flows still a fraction of pre-war ~20 mb/d. Visible tanker transits remain suppressed.", share: "~20% oil liquids" },
  { name: "Bab el-Mandeb / Red Sea", status: "elevated", note: "Houthi interdiction + Hormuz reroute load. Cape of Good Hope remains the long-haul alternative.", share: "Asia–Europe oil" },
  { name: "Suez Canal", status: "elevated", note: "Red Sea spillover. Product and container ton-miles inflated vs. 2023 baseline.", share: "~12% trade hist." },
  { name: "Kerch / Black Sea", status: "critical", note: "Ukraine strikes on Azov / Novorossiysk shipping and CPC-adjacent loadings.", share: "Rus/Kaz crude" },
  { name: "Strait of Malacca", status: "watch", note: "Open. Strategic for Asia crude and products; political toll talk is noise so far.", share: "~22% seaborne" },
  { name: "Panama Canal", status: "stable", note: "Draft restrictions eased vs. 2023–24 drought peak. Not the binding energy constraint.", share: "USGC–Asia" },
  { name: "Lake Maracaibo approaches", status: "watch", note: "Infrastructure, theft, and export-terminal integrity are the operational questions — not geology.", share: "VE heavy" }
];

const TAPE_SEED = [
  { t: "25 Aug", src: "Reuters", text: "Nearly half of global oil supply now originates in conflict-affected countries (~43% of 2025 output)." },
  { t: "26 Aug", src: "War on the Rocks", text: "EIA: Hormuz oil flows ~4.9 mb/d in Q2 2026 vs 21.6 mb/d two quarters earlier. LNG through the strait nearly ceased." },
  { t: "27 Aug", src: "Markets", text: "Brent holding high-$80s; WTI low-$80s. Henry Hub bid on late-summer heat, still sub-$3." },
  { t: "25 Aug", src: "Reuters", text: "Ukraine campaign against Russian refining continues to tighten product balances; Moscow has restricted gasoline/diesel exports." },
  { t: "Q2–Q3", src: "Context", text: "Gulf disruption estimates still cluster around 5–7 mb/d versus pre-war seaborne crude from the region." },
  { t: "2026", src: "Public tape", text: "Venezuela exports recovered earlier in the year off a very low base; US policy and offtake terms remain the binding constraint." },
  { t: "Jul–Aug", src: "Black Sea", text: "CPC / Novorossiysk loadings hit by strikes — Kazakhstan export risk layered on Russian product outages." },
  { t: "Ops", src: "ATC", text: "For conventional operators the bid is not the print — it is differential, freight, insurance, and whether barrels can actually move." }
];

function $(id) { return document.getElementById(id); }

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function chgClass(n) { return n >= 0 ? "up" : "down"; }
function signed(n, d = 2) { return (n >= 0 ? "+" : "") + fmt(n, d); }

/* ---------- auth (optional) ---------- */
function checkAuth() {
  if (!AUTH_ENABLED) return true;
  if (sessionStorage.getItem("atc_sr_ok") === "1") return true;
  $("gate").classList.add("show");
  $("gate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("gate-pass").value.trim();
    if (v === AUTH_CODE) {
      sessionStorage.setItem("atc_sr_ok", "1");
      $("gate").classList.remove("show");
    } else {
      $("gate-err").textContent = "Access denied.";
    }
  });
  return false;
}

/* ---------- clocks ---------- */
function tickClocks() {
  const zones = [
    ["clk-hou", "America/Chicago"],
    ["clk-lon", "Europe/London"],
    ["clk-ccs", "America/Caracas"],
    ["clk-iev", "Europe/Kyiv"]
  ];
  const now = new Date();
  zones.forEach(([id, tz]) => {
    const el = $(id);
    if (!el) return;
    el.textContent = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  });
  const stamp = $("asof");
  if (stamp) {
    stamp.textContent = now.toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false }) + " CT";
  }
}

/* ---------- markets ---------- */
async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const proxies = [
    url,
    "https://corsproxy.io/?" + encodeURIComponent(url),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url)
  ];
  for (const u of proxies) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || !meta.regularMarketPrice) continue;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || meta.previousClose || price;
      const change = price - prev;
      const pct = prev ? (change / prev) * 100 : 0;
      return { price, change, pct };
    } catch (_) { /* try next */ }
  }
  return null;
}

async function loadQuotes() {
  const tasks = SYMBOLS.map(async (sym) => {
    const live = await fetchYahoo(sym);
    if (live) {
      quotes[sym] = { ...quotes[sym], ...live, live: true };
    }
  });
  await Promise.allSettled(tasks);
  renderMarkets();
}

function renderMarkets() {
  const order = ["CL=F", "BZ=F", "NG=F", "RB=F", "HO=F", "GC=F", "DX-Y.NYB", "^VIX"];
  const ticker = $("ticker-track");
  const board = $("market-board");
  if (ticker) {
    const bits = order.concat(order).map((sym) => {
      const q = quotes[sym];
      return `<div class="tick"><span class="sym">${q.name}</span><span class="px">${fmt(q.price, q.price > 100 ? 1 : 2)}</span><span class="chg ${chgClass(q.pct)}">${signed(q.pct, 2)}%</span></div>`;
    }).join("");
    ticker.innerHTML = bits;
  }
  if (board) {
    board.innerHTML = order.map((sym) => {
      const q = quotes[sym];
      return `<div class="mkt-row">
        <div class="n">${q.name}${q.live ? "" : " · ref"}</div>
        <div>${fmt(q.price, q.price > 200 ? 0 : 2)} <span class="n">${q.unit}</span></div>
        <div class="${chgClass(q.pct)}">${signed(q.pct, 2)}%</div>
      </div>`;
    }).join("");
  }

  const wti = quotes["CL=F"];
  const brent = quotes["BZ=F"];
  $("kpi-wti").textContent = fmt(wti.price);
  $("kpi-wti-chg").textContent = signed(wti.pct) + "%";
  $("kpi-wti-chg").className = "hint " + chgClass(wti.pct);
  $("kpi-brent").textContent = fmt(brent.price);
  $("kpi-spread").textContent = fmt(brent.price - wti.price);
  $("kpi-hh").textContent = fmt(quotes["NG=F"].price);
  $("kpi-hh-chg").textContent = signed(quotes["NG=F"].pct) + "%";
  $("kpi-hh-chg").className = "hint " + chgClass(quotes["NG=F"].pct);
}

/* ---------- news tape ---------- */
async function loadNews() {
  const q = encodeURIComponent("oil OR Brent OR Hormuz OR Venezuela oil OR Ukraine refinery");
  const rss = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const url = "https://api.allorigins.win/raw?url=" + encodeURIComponent(rss);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("rss");
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const items = [...doc.querySelectorAll("item")].slice(0, 10).map((it) => {
      const title = it.querySelector("title")?.textContent || "";
      const date = new Date(it.querySelector("pubDate")?.textContent || Date.now());
      const t = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
      return { t, src: "Wire", text: title.replace(/ - [^-]+$/, "") };
    });
    if (items.length) {
      renderTape(items.concat(TAPE_SEED.slice(0, 4)));
      return;
    }
  } catch (_) { /* seed only */ }
  renderTape(TAPE_SEED);
}

function renderTape(items) {
  const el = $("tape");
  if (!el) return;
  el.innerHTML = items.map((it) => `
    <div class="tape-item">
      <div class="t">${it.t}<div class="src">${it.src}</div></div>
      <p>${it.text}</p>
    </div>`).join("");
}

/* ---------- assets + chokes ---------- */
function renderAssets() {
  const box = $("assets");
  box.innerHTML = ASSETS.map((a) => `
    <div class="asset" data-id="${a.id}">
      <div class="row"><div class="name">${a.name}</div><span class="tag">${a.tag}</span></div>
      <p>${a.blurb}</p>
      <div class="meta">
        <span class="pill ${a.pill}">${a.pillText}</span>
        ${a.meta.map((m) => `<span>${m}</span>`).join("")}
      </div>
    </div>`).join("");
  box.querySelectorAll(".asset").forEach((el) => {
    el.addEventListener("click", () => {
      box.querySelectorAll(".asset").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      const a = ASSETS.find((x) => x.id === el.dataset.id);
      if (a && window._map) window._map.flyTo([a.lat, a.lng], 5, { duration: 0.8 });
    });
  });
}

function renderChokes() {
  $("chokes").innerHTML = CHOKES.map((c) => `
    <div class="choke-row">
      <div>${c.name}<div class="note" style="margin:2px 0 0">${c.note}</div></div>
      <div class="note">${c.share}</div>
      <div class="status ${c.status}">${c.status}</div>
    </div>`).join("");
}

/* ---------- map ---------- */
function initMap() {
  const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([24, -20], 2.3);
  window._map = map;
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OSM &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 18
  }).addTo(map);

  const chokePts = [
    { name: "Hormuz", lat: 26.57, lng: 56.25, s: "critical" },
    { name: "Bab el-Mandeb", lat: 12.58, lng: 43.33, s: "elevated" },
    { name: "Suez", lat: 30.45, lng: 32.35, s: "elevated" },
    { name: "Malacca", lat: 2.5, lng: 101.9, s: "watch" },
    { name: "Kerch", lat: 45.26, lng: 36.45, s: "critical" },
    { name: "Panama", lat: 9.1, lng: -79.7, s: "stable" }
  ];
  const color = { critical: "#e85d5d", elevated: "#e0a354", watch: "#6cb6ff", stable: "#3dd68c", asset: "#c9a227" };

  chokePts.forEach((p) => {
    L.circleMarker([p.lat, p.lng], {
      radius: 7, color: color[p.s], weight: 2, fillColor: color[p.s], fillOpacity: 0.35
    }).addTo(map).bindPopup(`<strong>${p.name}</strong><br>Status: ${p.s}`);
  });

  ASSETS.forEach((a) => {
    L.circleMarker([a.lat, a.lng], {
      radius: 8, color: color.asset, weight: 2, fillColor: color.asset, fillOpacity: 0.8
    }).addTo(map).bindPopup(`<strong>${a.name}</strong><br>${a.pillText}`);
  });
}

/* ---------- quakes (context, not core) ---------- */
async function loadQuakes() {
  try {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const n = data.features?.length || 0;
    const el = $("kpi-eq");
    if (el) el.textContent = String(n);
    if (window._map && data.features) {
      data.features.slice(0, 25).forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        L.circleMarker([lat, lng], {
          radius: Math.max(3, f.properties.mag),
          color: "#8b9bb0", weight: 1, fillOpacity: 0.2
        }).addTo(window._map).bindPopup(`M${f.properties.mag} · ${f.properties.place}`);
      });
    }
  } catch (_) {
    const el = $("kpi-eq");
    if (el) el.textContent = "—";
  }
}

function init() {
  checkAuth();
  tickClocks();
  setInterval(tickClocks, 1000);
  renderAssets();
  renderChokes();
  renderTape(TAPE_SEED);
  renderMarkets();
  initMap();
  loadQuotes();
  loadNews();
  loadQuakes();
  setInterval(loadQuotes, 180000);
}

document.addEventListener("DOMContentLoaded", init);
