// Honest backtest: train on 2012-2016 (scripts/.cache/model_2016.json), predict days of 2017 the model never saw,
// and score against the real tickets. Run build-model.mjs --through 2016 first.
//   node scripts/backtest.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { query } from "./build-model.mjs";

const require = createRequire(import.meta.url);
const TM = require("../web/model.js");
const raw = JSON.parse(await readFile(new URL("./.cache/model_2016.json", import.meta.url), "utf8"));
const model = TM.load(raw);
const cellKey = new Map(raw.cells.map((c, i) => [`${c[0]}|${c[1]}`, i]));
const TEST_MONTHS = ["2017-01", "2017-04", "2017-07", "2017-10"]; // one per season
const KS = [25, 50, 100, 250];
const GRID = raw.grid, BBOX = "lat BETWEEN 39.8 AND 40.2 AND lon BETWEEN -75.4 AND -74.9";

// actual[date] = { cellKeyOrNull: Float64Array(6) } built from real tickets
const actual = new Map();
for (const month of TEST_MONTHS) {
  const [y, m] = month.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  for (let d = 1; d <= dim; d += 7) {
    const from = `${month}-${String(d).padStart(2, "0")}`;
    const to = new Date(Date.UTC(y, m - 1, Math.min(d + 7, dim + 1))).toISOString().slice(0, 10);
    const rows = await query(`SELECT to_char(issue_datetime,'YYYY-MM-DD') dt, round(lat::numeric/${GRID})::int a,
        round(lon::numeric/${GRID})::int b, floor(extract(hour from issue_datetime)/4)::int k, count(*)::int c
      FROM parking_violations WHERE issue_datetime >= '${from}' AND issue_datetime < '${to}' AND ${BBOX} GROUP BY 1,2,3,4`);
    for (const r of rows) {
      if (!actual.has(r.dt)) actual.set(r.dt, new Map());
      const cm = actual.get(r.dt), key = `${r.a}|${r.b}`;
      if (!cm.has(key)) cm.set(key, new Float64Array(6));
      cm.get(key)[r.k] += r.c;
    }
  }
  console.log("fetched", month);
}

// Static baseline: rank cells by all-time total, ignoring weekday and time. Shows what weekday/time modelling adds.
const staticScore = new Float64Array(raw.cells.length);
for (let i = 0; i < raw.rows.length; i += 4) staticScore[raw.rows[i]] += raw.rows[i + 3];
const staticOrder = [...staticScore.keys()].sort((a, b) => staticScore[b] - staticScore[a] || a - b);

const sum = (a) => a.reduce((s, v) => s + v, 0);
const dayStats = [];
for (const [day, cm] of [...actual].sort()) {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const perCell = new Map([...cm].map(([k, v]) => [k, sum(v)]));
  const total = sum([...perCell.values()]);
  const pred = TM.predict(model, { y, m, d }, null, Math.max(...KS));
  const sorted = [...perCell.values()].sort((a, b) => b - a);
  const row = { day, dow, total, cap: {}, base: {}, oracle: {}, rand: {} };
  for (const k of KS) {
    row.cap[k] = sum(pred.ranked.slice(0, k).map((p) => perCell.get(`${raw.cells[p.cell][0]}|${raw.cells[p.cell][1]}`) ?? 0)) / total;
    row.base[k] = sum(staticOrder.slice(0, k).map((c) => perCell.get(`${raw.cells[c][0]}|${raw.cells[c][1]}`) ?? 0)) / total;
    row.oracle[k] = sum(sorted.slice(0, k)) / total;
    row.rand[k] = k / raw.cells.length;
  }
  // Time-window check: for each 4-hour bin, does the model's bin-specific ranking beat the all-day ranking?
  row.bins = [];
  for (let b = 0; b < 6; b++) {
    const binTotal = sum([...cm.values()].map((v) => v[b]));
    if (binTotal < 200) { row.bins.push(null); continue; }
    const pb = TM.predict(model, { y, m, d }, [b], 50).ranked;
    const hit = (list) => sum(list.map((c) => cm.get(`${raw.cells[c][0]}|${raw.cells[c][1]}`)?.[b] ?? 0)) / binTotal;
    row.bins.push({ specific: hit(pb.map((p) => p.cell)), allDay: hit(pred.ranked.slice(0, 50).map((p) => p.cell)) });
  }
  dayStats.push(row);
}

const avg = (rows, f) => (rows.length ? sum(rows.map(f)) / rows.length : NaN);
const pct = (v) => (v * 100).toFixed(1) + "%";
const groups = { "All test days": dayStats, "Weekdays (Mon–Fri)": dayStats.filter((r) => r.dow >= 1 && r.dow <= 5), "Weekends": dayStats.filter((r) => r.dow === 0 || r.dow === 6) };

let md = `# Backtest: does the model find where tickets actually happen?\n\n`;
md += `Trained on **2012–2016** only. Tested on **${dayStats.length} days of 2017** (${TEST_MONTHS.join(", ")}) that the model never saw.\n`;
md += `Grid: ~200 m cells (${raw.cells.length.toLocaleString()} cells citywide). Metric: *capture@K* = share of that day's real tickets (with coordinates) that fall inside the K cells the model ranked highest for that date.\n\n`;
for (const [name, rows] of Object.entries(groups)) {
  md += `## ${name} (${rows.length} days)\n\n| Top-K cells | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |\n|---|---|---|---|---|\n`;
  for (const k of KS) md += `| ${k} | **${pct(avg(rows, (r) => r.cap[k]))}** | ${pct(avg(rows, (r) => r.base[k]))} | ${pct(avg(rows, (r) => r.oracle[k]))} | ${pct(avg(rows, (r) => r.rand[k]))} |\n`;
  md += "\n";
}
md += `## Time-of-day windows (top 50 cells per 4-hour window)\n\n| Window | Window-specific ranking | All-day ranking | Days scored |\n|---|---|---|---|\n`;
for (let b = 0; b < 6; b++) {
  const rows = dayStats.map((r) => r.bins[b]).filter(Boolean);
  md += `| ${TM.binLabel(b)} | ${pct(avg(rows, (r) => r.specific))} | ${pct(avg(rows, (r) => r.allDay))} | ${rows.length} |\n`;
}
md += `\n"Best possible" picks the K busiest cells in hindsight, so it is the ceiling no forecast can beat. Days with under 200 tickets in a window are skipped for that window.\n`;
await writeFile(new URL("../docs/backtest.md", import.meta.url), md);
await writeFile(new URL("../web/backtest.md", import.meta.url), md); // served copy for web/backtest.html
console.log(md);
