// Deterministic ticket-hotspot model. No randomness: the same date and window always give the same ranking.
//
//   expected(cell, date, window) = Σ over bins in window of avgPerDay[cell][weekday(date)][bin]
//                                  × monthFactor[month(date)] × trendFactor(year(date))
//
// avgPerDay is the historical mean number of tickets in that ~200 m cell for that weekday and 4-hour bin.
// monthFactor and trendFactor are citywide multipliers, so they change the expected COUNTS but never the
// RANKING of cells. The ranking is driven by (cell, weekday, time window) alone.
// Used both by the browser (predict.html) and Node (scripts/backtest.mjs) so they can't disagree.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TicketModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const BINS = 6, BIN_HOURS = 4;

  // raw: contents of model.json. Returns an indexed model ready for predict().
  function load(raw) {
    const n = raw.cells.length;
    const cube = []; // cube[dow][bin] = Float64Array(n) of average tickets per day
    for (let d = 0; d < 7; d++) cube.push(Array.from({ length: BINS }, () => new Float64Array(n)));
    const r = raw.rows;
    for (let i = 0; i < r.length; i += 4) cube[r[i + 1]][r[i + 2]][r[i]] = r[i + 3] / raw.dowDays[r[i + 1]];
    return { raw, cube, n };
  }

  function trendFactor(raw, year) {
    const t = raw.trend;
    return Math.max(0.5, (t.intercept + t.slope * year) / t.meanYearly);
  }

  // date: {y, m, d}. bins: array of bin indexes (0..5) or null for the whole day.
  function predict(model, date, bins, topK) {
    const { raw, cube, n } = model;
    const dow = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay(); // 0 = Sunday
    const use = bins && bins.length ? bins : [0, 1, 2, 3, 4, 5];
    const scale = raw.monthFactor[date.m - 1] * trendFactor(raw, date.y);
    const score = new Float64Array(n);
    for (const b of use) {
      const a = cube[dow][b];
      for (let c = 0; c < n; c++) score[c] += a[c];
    }
    const order = Array.from({ length: n }, (_, i) => i).filter((c) => score[c] > 0);
    order.sort((x, y) => score[y] - score[x] || x - y); // index tie-break keeps it deterministic
    const ranked = order.slice(0, topK || order.length).map((c) => ({
      cell: c,
      expected: score[c] * scale,
      lat: raw.cells[c][0] * raw.grid,
      lon: raw.cells[c][1] * raw.grid,
      addr: raw.cells[c][2],
    }));
    return { dow, scale, ranked, totalExpected: score.reduce((s, v) => s + v, 0) * scale };
  }

  const binLabel = (b) => {
    const f = (h) => `${h % 12 || 12}${h % 24 < 12 ? "a" : "p"}`;
    return `${f(b * BIN_HOURS)}–${f(b * BIN_HOURS + BIN_HOURS)}`;
  };

  return { BINS, BIN_HOURS, load, predict, trendFactor, binLabel };
});
