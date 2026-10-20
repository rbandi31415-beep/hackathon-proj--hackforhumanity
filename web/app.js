const map = L.map("map").setView([39.9526, -75.1652], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

const $ = (id) => document.getElementById(id);
const hourOn = $("hourOn"), hourSlider = $("hourSlider"), hourLabel = $("hourLabel"), hourNote = $("hourNote");
const heatOn = $("heatOn"), slider = $("slider"), playBtn = $("play"), label = $("label"), stats = $("stats");
let rawHeatOn = false, heatZoom = null;
let keys = [], months = {}, step = 0.001, maxCount = 1, heat, timer = null;

// Sum cell counts across a list of month keys into {cellKey: [lat, lon, count]}.
function aggregate(monthKeys) {
  const cells = new Map();
  for (const k of monthKeys) {
    const a = months[k];
    for (let i = 0; i < a.length; i += 3) {
      const id = a[i] * 100000 + a[i + 1];
      const c = cells.get(id);
      if (c) c[2] += a[i + 2];
      else cells.set(id, [a[i] * step, a[i + 1] * step, a[i + 2]]);
    }
  }
  return [...cells.values()];
}

function selection() {
  const i = +slider.value;
  const mode = document.querySelector("input[name=mode]:checked").value;
  if (mode === "all") return { ks: keys, text: `${keys[0]} – ${keys.at(-1)}` };
  if (mode === "year") {
    const ks = keys.slice(Math.max(0, i - 11), i + 1);
    return { ks, text: `${ks[0]} – ${ks.at(-1)}` };
  }
  return { ks: [keys[i]], text: keys[i] };
}

// Heat radius in pixels should track a fixed distance on the ground, so blobs keep covering the same
// streets as you zoom (metres-per-pixel at Philly's latitude is ~119900 / 2^zoom).
function styleHeat(groundMetres, max) {
  const mpp = 119900 / 2 ** map.getZoom();
  const radius = Math.max(8, Math.min(35, groundMetres / mpp));
  heat.setOptions({ radius, blur: radius * 0.8, max });
}

// --- Time of day (Month mode only) ---
// For the selected month we fetch tiles split by hour once (cached), then the slider is instant.
// Values are AVERAGE tickets per day in that hour (month total for the hour / days in the month).
const hourCache = new Map(); // month key -> { tiles: Map(hour -> [[lat, lon, count]...]), scale }
const hourSel = () =>
  hourOn.checked && document.querySelector("input[name=mode]:checked").value === "month" ? +hourSlider.value : null;
const daysIn = (key) => new Date(+key.slice(0, 4), +key.slice(5), 0).getDate();
const hourText = (h) => {
  const f = (x) => `${x % 12 || 12} ${x % 24 < 12 ? "AM" : "PM"}`;
  return `${f(h)} – ${f(h + 1)}`;
};

async function loadHours(key) {
  if (hourCache.has(key)) return hourCache.get(key);
  const start = `${key}-01`, end = nextMonth(key);
  const rows = await carto(`SELECT date_part('hour', issue_datetime)::int h, round(lat::numeric*1000)::int a,
      round(lon::numeric*1000)::int b, count(*)::int c
    FROM parking_violations WHERE issue_datetime >= '${start}' AND issue_datetime < '${end}'
      AND lat BETWEEN 39.8 AND 40.2 AND lon BETWEEN -75.4 AND -74.9 GROUP BY 1,2,3`);
  const tiles = new Map();
  for (const r of rows) {
    if (!tiles.has(r.h)) tiles.set(r.h, []);
    tiles.get(r.h).push([r.a * step, r.b * step, r.c]);
  }
  // One colour scale for all 24 hours of the month so hours are comparable (99.5th percentile tile).
  const counts = rows.map((r) => r.c).sort((x, y) => x - y);
  const scale = counts[Math.floor(counts.length * 0.995)] || 1;
  const entry = { tiles, scale, days: daysIn(key) };
  hourCache.set(key, entry);
  return entry;
}

let renderSeq = 0;
async function render() {
  const { ks, text } = selection();
  const h = hourSel();
  hourSlider.disabled = !hourOn.checked || document.querySelector("input[name=mode]:checked").value !== "month";
  hourLabel.textContent = hourOn.checked ? hourText(+hourSlider.value) : "";
  hourNote.textContent = hourOn.checked && hourSlider.disabled ? "Time of day applies to Month mode only" : "";
  let cells, pts, statsText;
  if (h === null) {
    cells = aggregate(ks);
    const total = cells.reduce((s, c) => s + c[2], 0);
    // Keep one fixed colour scale per mode so changes over time stay comparable.
    const scale = maxCount * ks.length;
    pts = cells.map(([lat, lon, n]) => [lat, lon, Math.min(1, n / scale)]);
    statsText = `${total.toLocaleString()} tickets in ${cells.length.toLocaleString()} map tiles`;
  } else {
    const seq = ++renderSeq;
    if (!hourCache.has(ks[0])) stats.textContent = `Loading ${ks[0]} by hour…`;
    let data;
    try {
      data = await loadHours(ks[0]);
    } catch (e) {
      stats.textContent = "Failed to load hourly data: " + e.message;
      return;
    }
    if (seq !== renderSeq) return; // a newer render superseded this one
    cells = data.tiles.get(h) || [];
    const total = cells.reduce((s, c) => s + c[2], 0);
    pts = cells.map(([lat, lon, n]) => [lat, lon, Math.min(1, n / data.scale)]);
    statsText = `${total.toLocaleString()} tickets issued ${hourText(h)} in ${ks[0]} (avg ${(total / data.days).toFixed(0)} per day)`;
  }
  styleHeat(70, 1);
  heatZoom = map.getZoom();
  heat.setLatLngs(heatOn.checked ? pts : []);
  label.textContent = h === null ? text : `${text}, ${hourText(h)}`;
  stats.textContent = statsText;
}

function setPlaying(on) {
  clearInterval(timer);
  timer = null;
  playBtn.textContent = on ? "⏸ Pause" : "▶ Play";
  if (!on) return;
  timer = setInterval(() => {
    slider.value = (+slider.value + 1) % keys.length;
    render();
  }, 400);
}

fetch("data/tickets.json")
  .then((r) => r.json())
  .then((d) => {
    months = d.months;
    step = d.gridDegrees;
    keys = Object.keys(months).sort();
    // Scale against a high percentile of single-month tile counts, not the max, so outliers don't wash out the map.
    const all = keys.flatMap((k) => months[k].filter((_, i) => i % 3 === 2)).sort((a, b) => a - b);
    maxCount = all[Math.floor(all.length * 0.995)] || 1;
    heat = L.heatLayer([], { radius: 14, blur: 16, minOpacity: 0.25, max: 1 }).addTo(map);
    slider.max = keys.length - 1;
    slider.value = keys.length - 1;
    slider.disabled = playBtn.disabled = false;
    render();
  })
  .catch((e) => (stats.textContent = "Failed to load data: " + e.message));

slider.addEventListener("input", render);
hourOn.addEventListener("change", () => { render(); loadRaw(); });
hourSlider.addEventListener("input", render);
hourSlider.addEventListener("change", loadRaw);
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", render));
playBtn.addEventListener("click", () => setPlaying(!timer));

// --- Detail layers (zoom 16+): exact-point heat and one dot per individual ticket ---
// Both come from the live city API for the visible area and selected period, and can be toggled
// independently. Tickets on the same block share one coordinate, so in the dot layer the tickets that
// share a point are fanned out in a tiny spiral (~2.5 m steps) so each one is visible and clickable.
// The popup shows each ticket's true coordinates.
const MIN_RAW_ZOOM = 16, RAW_LIMIT = 20000;
const rawBox = $("raw"), rawStatus = $("rawStatus");
map.createPane("rawPane").style.zIndex = 650; // keep dots above the heat canvas
const rawRenderer = L.canvas({ pane: "rawPane" }); // canvas handles tens of thousands of dots
const rawLayer = L.layerGroup().addTo(map);
let rawReq = 0;

function nextMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

const carto = async (q) => {
  const res = await fetch(`https://phl.carto.com/api/v2/sql?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).rows;
};

// Offset the k-th ticket at a shared point along a spiral so overlapping tickets separate.
function fan(lat, lon, k) {
  if (k === 0) return [lat, lon];
  const r = 2.5 * Math.sqrt(k), a = k * 2.399963; // metres, golden angle
  return [lat + (r * Math.sin(a)) / 111320, lon + (r * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180))];
}

async function loadRaw() {
  rawLayer.clearLayers();
  rawStatus.textContent = "";
  if (!keys.length) return;
  const wantDetail = (heatOn.checked || rawBox.checked) && map.getZoom() >= MIN_RAW_ZOOM;
  if (!wantDetail) {
    ++rawReq; // drop any in-flight detail request
    // Restore the coarse ~100 m heat only when needed (exact heat was on, or zoom changed its radius).
    if (rawHeatOn || map.getZoom() !== heatZoom) render();
    rawHeatOn = false;
    if (rawBox.checked) rawStatus.textContent = `Zoom in to level ${MIN_RAW_ZOOM}+ (now ${map.getZoom()})`;
    return;
  }
  const { ks } = selection();
  const start = `${ks[0]}-01`, end = nextMonth(ks.at(-1));
  const b = map.getBounds();
  const h = hourSel();
  const where = `issue_datetime >= '${start}' AND issue_datetime < '${end}'
    ${h === null ? "" : `AND date_part('hour', issue_datetime) = ${h}`}
    AND lat BETWEEN ${b.getSouth()} AND ${b.getNorth()} AND lon BETWEEN ${b.getWest()} AND ${b.getEast()}`;
  const groupedQ = `SELECT lat, lon, count(*)::int n FROM parking_violations WHERE ${where}
    GROUP BY lat, lon ORDER BY n DESC LIMIT ${RAW_LIMIT}`;
  const ticketsQ = `SELECT lat, lon, location AS addr, issue_datetime AS at, violation_desc AS viol, fine
    FROM parking_violations WHERE ${where} ORDER BY lat, lon, issue_datetime LIMIT ${RAW_LIMIT}`;
  const id = ++rawReq;
  rawStatus.style.color = "#444";
  rawStatus.textContent = "Loading tickets…";
  try {
    const [grouped, tickets] = await Promise.all([carto(groupedQ), rawBox.checked ? carto(ticketsQ) : []]);
    if (id !== rawReq) return; // a newer request superseded this one
    const total = grouped.reduce((s, r) => s + r.n, 0);
    const period = `${ks[0]}${ks.length > 1 ? " – " + ks.at(-1) : ""}${h === null ? "" : ", " + hourText(h)}`;

    rawHeatOn = true;
    heatZoom = map.getZoom();
    styleHeat(25, 8); // exact-point heat: weight = tickets at that point
    heat.setLatLngs(heatOn.checked ? grouped.map((r) => [r.lat, r.lon, r.n]) : []);

    let stacked = 0, k = 0, prev = "";
    const day = (s) => s.replace("T", " ").replace("Z", "");
    for (const t of tickets) {
      const key = t.lat + "," + t.lon;
      k = key === prev ? k + 1 : 0;
      prev = key;
      const [la, lo] = fan(t.lat, t.lon, k);
      if (k > 0) stacked++;
      L.circleMarker([la, lo], {
        renderer: rawRenderer, radius: 4, color: "#fff", weight: 1, fillColor: "#e41a1c", fillOpacity: 0.9,
      })
        .bindPopup(
          `<b>${t.addr}</b><br>${t.viol} ($${t.fine})<br>${day(t.at)}` +
            `<br><small>city-recorded point: ${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}</small>`
        )
        .addTo(rawLayer);
    }
    const base = `${total.toLocaleString()} tickets at ${grouped.length.toLocaleString()} locations in view for ${period}`;
    if (grouped.length === RAW_LIMIT) {
      rawStatus.textContent = `Showing the ${RAW_LIMIT.toLocaleString()} busiest locations (${total.toLocaleString()} tickets) for ${period}; zoom in or pick one month to see all`;
    } else if (rawBox.checked && tickets.length === RAW_LIMIT) {
      rawStatus.textContent = `${base}. Dots capped at the first ${RAW_LIMIT.toLocaleString()} tickets; zoom in to see the rest`;
    } else {
      rawStatus.textContent = base + (rawBox.checked ? `. ${stacked.toLocaleString()} share a point with another ticket and are fanned out slightly` : "");
    }
  } catch (e) {
    if (id === rawReq) { rawStatus.style.color = "#a33"; rawStatus.textContent = "Failed to load tickets: " + e.message; }
  }
}

rawBox.addEventListener("change", loadRaw);
heatOn.addEventListener("change", () => { render(); loadRaw(); });
map.on("moveend", loadRaw);
slider.addEventListener("change", loadRaw);
document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", loadRaw));
