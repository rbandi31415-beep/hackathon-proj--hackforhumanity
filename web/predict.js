const $ = (id) => document.getElementById(id);
const map = L.map("map").setView([39.9526, -75.1652], 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
const layer = L.layerGroup().addTo(map);
let model, current = [];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
$("win").innerHTML = '<option value="all">All day</option>' +
  Array.from({ length: TicketModel.BINS }, (_, b) => `<option value="${b}">${TicketModel.binLabel(b)}</option>`).join("");
const today = new Date();
$("date").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

function run() {
  if (!model || !$("date").value) return;
  const [y, m, d] = $("date").value.split("-").map(Number);
  const w = $("win").value, k = +$("topk").value;
  const res = TicketModel.predict(model, { y, m, d }, w === "all" ? null : [+w], k);
  current = res.ranked;
  const top = current.reduce((s, r) => s + r.expected, 0);
  $("summary").textContent = `${DOW[res.dow]} ${$("date").value}${w === "all" ? "" : ", " + TicketModel.binLabel(+w)}: ` +
    `top ${k} zones expect ~${Math.round(top).toLocaleString()} of ~${Math.round(res.totalExpected).toLocaleString()} mapped tickets (${(100 * top / res.totalExpected).toFixed(0)}%)`;

  layer.clearLayers();
  const max = current[0]?.expected || 1;
  $("table").innerHTML = '<tr><th>#</th><th>Where (typical block)</th><th class="n">Exp. tickets</th></tr>' +
    current.map((r, i) => `<tr data-i="${i}"><td>${i + 1}</td><td>${r.addr || "—"}</td><td class="n">${r.expected.toFixed(1)}</td></tr>`).join("");
  current.forEach((r, i) => {
    const size = 18 + 12 * Math.sqrt(r.expected / max);
    const icon = L.divIcon({ className: "", html: `<div class="rank" style="width:${size}px;height:${size}px">${i < 20 ? i + 1 : ""}</div>`, iconSize: [size, size] });
    L.marker([r.lat, r.lon], { icon }).bindPopup(
      `<b>#${i + 1} ${r.addr || "zone"}</b><br>~${r.expected.toFixed(1)} expected tickets<br><small>zone centre ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} (≈200 m square)</small>`
    ).addTo(layer);
  });
  if (current.length) map.fitBounds(L.latLngBounds(current.slice(0, 20).map((r) => [r.lat, r.lon])).pad(0.2)); // fit the top zones; farther ones stay reachable by panning
}

$("table").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-i]");
  if (!tr) return;
  const r = current[+tr.dataset.i];
  map.setView([r.lat, r.lon], 17);
});
$("csv").addEventListener("click", () => {
  const lines = ["rank,address,lat,lon,expected_tickets"].concat(
    current.map((r, i) => `${i + 1},"${(r.addr || "").replaceAll('"', '""')}",${r.lat.toFixed(5)},${r.lon.toFixed(5)},${r.expected.toFixed(2)}`));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `hotspots_${$("date").value}_${$("win").value}.csv`;
  a.click();
});
["date", "win", "topk"].forEach((id) => $(id).addEventListener("change", run));

fetch("data/model.json").then((r) => r.json()).then((raw) => { model = TicketModel.load(raw); run(); })
  .catch((e) => ($("summary").textContent = "Failed to load model: " + e.message));
