# Park Sight: project summary (for another agent)

## What this is
A static website ("Park Sight", hackathon project, Hack for Humanity) that visualizes and forecasts **Philadelphia street parking tickets**.
Goal: help the Philadelphia Parking Authority (PPA) see where and when tickets happen and target hotspot blocks more efficiently.
No backend. Plain HTML/JS, Leaflet maps. Deployed as static assets (Cloudflare Workers config exists locally but is deliberately not committed: `wrangler.jsonc`, gitignored).

## Critical data fact
- Source: City of Philadelphia "Parking Violations" via Carto SQL API `https://phl.carto.com/api/v2/sql`, table `parking_violations`.
- **The table only contains 2012-01-01 to 2017-12-31 (9,412,858 tickets).** OpenDataPhilly advertises a "2018-present" download, but that query returns 0 rows; the city never published later data. A Right-to-Know request to the PPA is drafted in `docs/ppa-records-request-draft.md` (not sent).
- ~8% of tickets (753,203) have no lat/lon and cannot be mapped. Everything citywide-count related (chart) includes them; maps do not.
- Columns: anon_ticket_number, issue_datetime (local time stored as UTC "Z"), state, anon_plate_id, division, location (street address), violation_desc, fine, issuing_agency, lat, lon, gps, zip_code.
- SQL gotchas on Carto: `day` and `location` as bare aliases are syntax errors (use `dt`, `AS addr`); heavy queries time out, so aggregate per year/month.

## Pages (all in `web/`)
| File | Purpose |
|---|---|
| `index.html` | Homepage with cards linking the pages below |
| `heatmap.html` + `app.js` + `style.css` | Leaflet heatmap: month slider, play, Month / Rolling 12 mo / All time, time-of-day slider (Month mode, avg tickets per day for that hour; fetched live from Carto and cached per month). At zoom 16+ optional **Heatmap** and **Individual tickets** toggles use live API queries for the visible area (exact-point heat; one dot per ticket, same-coordinate tickets fanned out ~2.5 m) |
| `chart.html` | Monthly ticket line chart + yearly totals (inline SVG), from `data/monthly_totals.json` |
| `predict.html` + `predict.js` + `predict.css` + `model.js` | **Hotspot forecast**: pick date + 4-hour window, ranks street blocks, map + table + CSV export |
| `backtest.html` + `backtest.md` | Text view of backtest results |

## Forecast model (deterministic, `web/model.js`)
`expected(block, date, window) = Σ_bins avgPerDay[block][weekday][bin] × monthFactor[month] × trendFactor(year)`
- Zones are **street blocks**: address rounded down to the hundred + zip (e.g. `1500 WALNUT ST|19102`), positioned at the **median lat/lon of the block's tickets** so markers sit on streets (an earlier 0.002° grid version put markers between streets).
- 6 four-hour bins, 7 weekdays. Blocks with < 30 training tickets are dropped (10,255 blocks).
- monthFactor / trendFactor are citywide multipliers: they change expected counts, never the ranking. Trend is a linear fit extrapolated past 2017, so later years are speculative.
- `model.js` is a UMD file shared by the browser and Node (`scripts/backtest.mjs`), so they cannot disagree.
- No holidays, weather, events, or staffing inputs. Tickets reflect where enforcement happened, not pure parking demand (feedback-loop caveat).

## Backtest (`docs/backtest.md`, `scripts/backtest.mjs`)
Trained on 2012-2016, tested on 123 days of 2017 (Jan, Apr, Jul, Oct), never seen by the model.
Top 50 blocks capture ~15.8% of a day's tickets (best possible in hindsight ~21.2%, random ~0.6%). Weekday awareness adds little on weekdays, more on weekends (21.9% vs 18.8% static at top 50). Window-specific ranking beats all-day ranking in every window.
(An earlier 200 m grid version scored 28.8% vs 34.1% ceiling; not comparable because blocks are a finer unit.)

## Data files (`web/data/`)
- `tickets.json` (6.6 MB): per-month ~100 m heat tiles `[latE3, lonE3, count, ...]`, bbox lat 39.8-40.2, lon -75.4 to -74.9. Built by `scripts/build-data.mjs`.
- `monthly_totals.json`: all tickets per month (incl. no-coordinate ones).
- `model.json` (3.5 MB): `{cells:[[lat,lon,block,zip]], rows:[cellIdx,dow,bin,count,...], dowDays, monthFactor, trend}`. Built by `scripts/build-model.mjs`.

## Commands (Node 24, no npm deps)
```
node scripts/build-data.mjs                                   # web/data/tickets.json (~1-2 min)
node scripts/build-model.mjs --through 2017                   # web/data/model.json
node scripts/build-model.mjs --through 2016 --out scripts/.cache/model_2016.json   # backtest model (gitignored dir)
node scripts/backtest.mjs                                     # writes docs/backtest.md and web/backtest.md
python -m http.server 8000 --directory web                    # serve locally
```

## Repo state / caveats
- Remote: github.com/rbandi31415-beep/hackathon-proj--hackforhumanity, branch `main`. Two commits pushed so far. **Uncommitted:** the "Park Sight" rename, homepage tweaks, and the block-based forecast rebuild (`scripts/build-model.mjs`, `scripts/backtest.mjs`, `web/model.js`, `web/predict.*`, `web/data/model.json`, docs/backtest.md, web/backtest.md). `parking_violations/` (an empty shapefile the user downloaded) is untracked and should not be committed.
- Basemap is OpenStreetMap tiles (CARTO's basemaps now require an API key; don't switch back).
- Known rough edge: the forecast map fits to the top 20 blocks, which can include far-flung ones (e.g. Manayunk, Old York Rd), so the initial view can be wide.
- Heat tiles are ~100 m and snapped to a lattice; at street zoom the exact-point heat (zoom 16+) is the accurate one.
- Live features (time-of-day slider, individual tickets) depend on the Carto API being up; the all-day heatmap, chart and forecast run from saved files.
