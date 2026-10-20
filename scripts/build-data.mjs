// Aggregates Philly parking tickets (2012-2017) from the city's Carto API into
// per-month ~100m grid cells and writes web/data/tickets.json.
// Each month is a flat array: [latE3, lonE3, count, latE3, lonE3, count, ...]
import { writeFile } from "node:fs/promises";

const API = "https://phl.carto.com/api/v2/sql";
const BBOX = "lat BETWEEN 39.8 AND 40.2 AND lon BETWEEN -75.4 AND -74.9";

async function query(q, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`${API}?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).rows;
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const months = {};
for (let y = 2012; y <= 2017; y++) {
  for (let m = 1; m <= 12; m++) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const rows = await query(
      `SELECT round(lat::numeric*1000)::int a, round(lon::numeric*1000)::int b, count(*)::int c
       FROM parking_violations
       WHERE issue_datetime >= '${start}' AND issue_datetime < '${end}' AND ${BBOX}
       GROUP BY 1,2`
    );
    const key = start.slice(0, 7);
    months[key] = rows.flatMap((r) => [r.a, r.b, r.c]);
    console.log(key, rows.length, "cells");
  }
}

await writeFile(
  new URL("../web/data/tickets.json", import.meta.url),
  JSON.stringify({ gridDegrees: 0.001, source: "City of Philadelphia, Parking Violations (2012-2017)", months })
);
console.log("done");
