// Builds the hotspot model table from the city's Carto API.
//   node scripts/build-model.mjs [--through 2017] [--out web/data/model.json]
// Zones are STREET BLOCKS (address rounded down to the hundred, plus zip code, e.g. "1500 WALNUT ST"),
// placed at the median lat/lon of their tickets so markers sit on the street. Bins are 4-hour blocks; day of week 0 = Sunday.
import { readFile, writeFile } from "node:fs/promises";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const THROUGH = +(args.through ?? 2017);
const OUT = new URL("../" + (args.out ?? "web/data/model.json"), import.meta.url);
const API = "https://phl.carto.com/api/v2/sql";
const BBOX = "lat BETWEEN 39.8 AND 40.2 AND lon BETWEEN -75.4 AND -74.9";
const MIN_TICKETS = 30; // drop blocks with fewer tickets than this over the whole training period
// SQL for the block key; exported so backtest.mjs groups the held-out tickets identically.
export const BLOCK_SQL = `CASE WHEN location ~ '^[0-9]+ ' THEN ((substring(location from '^[0-9]+')::int/100)*100)::text || substring(location from '^[0-9]+(.*)$') ELSE location END`;

export async function query(q, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${API}?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(res.status + " " + JSON.stringify(body.error ?? ""));
      return body.rows;
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function main() {
  const counts = new Map(); // "block|zip|dow|bin" -> tickets over the training period
  const pos = new Map(); // "block|zip" -> { lat, lon, year } from the most recent year the block appears in
  const total = new Map(); // "block|zip" -> tickets over the training period
  for (let y = 2012; y <= THROUGH; y++) {
    const range = `issue_datetime >= '${y}-01-01' AND issue_datetime < '${y + 1}-01-01' AND ${BBOX}`;
    const rows = await query(`SELECT ${BLOCK_SQL} blk, zip_code z, extract(dow from issue_datetime)::int d,
        floor(extract(hour from issue_datetime)/4)::int k, count(*)::int c
      FROM parking_violations WHERE ${range} GROUP BY 1,2,3,4`);
    for (const r of rows) {
      const bk = `${r.blk}|${r.z ?? ""}`;
      counts.set(`${bk}|${r.d}|${r.k}`, (counts.get(`${bk}|${r.d}|${r.k}`) ?? 0) + r.c);
      total.set(bk, (total.get(bk) ?? 0) + r.c);
    }
    // Median position (robust to a few bad geocodes); later years overwrite earlier ones.
    const prow = await query(`SELECT ${BLOCK_SQL} blk, zip_code z,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) la, percentile_cont(0.5) WITHIN GROUP (ORDER BY lon) lo
      FROM parking_violations WHERE ${range} GROUP BY 1,2`);
    for (const r of prow) pos.set(`${r.blk}|${r.z ?? ""}`, { lat: r.la, lon: r.lo });
    console.log(y, rows.length, "count rows,", prow.length, "blocks");
  }

  const cellIndex = new Map(), cells = [], rows = [];
  for (const [key, c] of counts) {
    const [blk, z, d, k] = key.split("|");
    const bk = `${blk}|${z}`;
    if (total.get(bk) < MIN_TICKETS) continue;
    if (!cellIndex.has(bk)) {
      const p = pos.get(bk);
      cellIndex.set(bk, cells.length);
      cells.push([+p.lat.toFixed(6), +p.lon.toFixed(6), blk, z]);
    }
    rows.push(cellIndex.get(bk), +d, +k, c);
  }

  // How many of each weekday fall in the training period (Jan 1 2012 .. Dec 31 THROUGH).
  const dowDays = Array(7).fill(0);
  for (let t = Date.UTC(2012, 0, 1); t < Date.UTC(THROUGH + 1, 0, 1); t += 864e5) dowDays[new Date(t).getUTCDay()]++;

  // Citywide scale factors from monthly totals (all tickets, including those without coordinates).
  const monthly = JSON.parse(await readFile(new URL("../web/data/monthly_totals.json", import.meta.url), "utf8"));
  const dim = (y, m) => new Date(y, m, 0).getDate();
  let tot = 0, days = 0;
  const perMonth = Array.from({ length: 12 }, () => ({ t: 0, d: 0 }));
  const yearly = {};
  for (const [k, v] of Object.entries(monthly)) {
    const y = +k.slice(0, 4), m = +k.slice(5);
    if (y > THROUGH) continue;
    tot += v; days += dim(y, m);
    perMonth[m - 1].t += v; perMonth[m - 1].d += dim(y, m);
    yearly[y] = (yearly[y] ?? 0) + v;
  }
  const monthFactor = perMonth.map((p) => p.t / p.d / (tot / days));
  const ys = Object.keys(yearly).map(Number), vs = ys.map((y) => yearly[y]);
  const my = ys.reduce((s, v) => s + v, 0) / ys.length, mv = vs.reduce((s, v) => s + v, 0) / vs.length;
  const slope = ys.reduce((s, y, i) => s + (y - my) * (vs[i] - mv), 0) / ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const trend = { slope, intercept: mv - slope * my, meanYearly: mv, years: ys };

  await writeFile(OUT, JSON.stringify({
    through: THROUGH, bins: 6, cells, rows, dowDays, monthFactor, trend,
    source: `City of Philadelphia parking violations 2012-${THROUGH}`,
  }));
  console.log("cells", cells.length, "rows", rows.length / 4, "->", OUT.pathname);
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("build-model.mjs")) await main();
