# Backtest: does the model find where tickets actually happen?

Trained on **2012–2016** only. Tested on **123 days of 2017** (2017-01, 2017-04, 2017-07, 2017-10) that the model never saw.
Grid: ~200 m cells (5,929 cells citywide). Metric: *capture@K* = share of that day's real tickets (with coordinates) that fall inside the K cells the model ranked highest for that date.

## All test days (123 days)

| Top-K cells | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **18.1%** | 17.4% | 22.2% | 0.4% |
| 50 | **28.8%** | 27.5% | 34.1% | 0.8% |
| 100 | **41.2%** | 40.1% | 49.3% | 1.7% |
| 250 | **61.0%** | 59.0% | 73.2% | 4.2% |

## Weekdays (Mon–Fri) (85 days)

| Top-K cells | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **16.0%** | 15.7% | 19.0% | 0.4% |
| 50 | **26.1%** | 25.9% | 30.0% | 0.8% |
| 100 | **38.7%** | 38.9% | 44.7% | 1.7% |
| 250 | **59.9%** | 59.4% | 69.1% | 4.2% |

## Weekends (38 days)

| Top-K cells | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **22.8%** | 21.1% | 29.3% | 0.4% |
| 50 | **34.8%** | 30.8% | 43.2% | 0.8% |
| 100 | **46.8%** | 42.7% | 59.7% | 1.7% |
| 250 | **63.5%** | 58.3% | 82.6% | 4.2% |

## Time-of-day windows (top 50 cells per 4-hour window)

| Window | Window-specific ranking | All-day ranking | Days scored |
|---|---|---|---|
| 12a–4a | 43.2% | 30.6% | 1 |
| 4a–8a | 29.3% | 13.5% | 33 |
| 8a–12p | 27.2% | 25.5% | 117 |
| 12p–4p | 30.4% | 29.9% | 119 |
| 4p–8p | 37.3% | 36.6% | 119 |
| 8p–12a | 39.6% | 35.3% | 108 |

"Best possible" picks the K busiest cells in hindsight, so it is the ceiling no forecast can beat. Days with under 200 tickets in a window are skipped for that window.
