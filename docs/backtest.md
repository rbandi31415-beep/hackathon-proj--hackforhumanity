# Backtest: does the model find where tickets actually happen?

Trained on **2012–2016** only. Tested on **123 days of 2017** (2017-01, 2017-04, 2017-07, 2017-10) that the model never saw.
Zones: street blocks, e.g. "1500 WALNUT ST" (8,847 blocks with enough history). Metric: *capture@K* = share of that day's real tickets (with coordinates) that fall inside the K blocks the model ranked highest for that date.

## All test days (123 days)

| Top-K blocks | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **9.6%** | 9.4% | 13.2% | 0.3% |
| 50 | **15.8%** | 14.6% | 21.2% | 0.6% |
| 100 | **24.6%** | 22.7% | 32.7% | 1.1% |
| 250 | **40.7%** | 38.4% | 53.5% | 2.8% |

## Weekdays (Mon–Fri) (85 days)

| Top-K blocks | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **7.7%** | 7.8% | 10.0% | 0.3% |
| 50 | **13.1%** | 12.8% | 16.8% | 0.6% |
| 100 | **21.1%** | 20.7% | 27.0% | 1.1% |
| 250 | **37.1%** | 36.8% | 46.7% | 2.8% |

## Weekends (38 days)

| Top-K blocks | Model | Static ranking (ignores weekday) | Best possible (hindsight) | Random picks |
|---|---|---|---|---|
| 25 | **13.8%** | 13.0% | 20.2% | 0.3% |
| 50 | **21.9%** | 18.8% | 31.2% | 0.6% |
| 100 | **32.6%** | 27.1% | 45.5% | 1.1% |
| 250 | **48.6%** | 42.0% | 68.7% | 2.8% |

## Time-of-day windows (top 50 blocks per 4-hour window)

| Window | Window-specific ranking | All-day ranking | Days scored |
|---|---|---|---|
| 12a–4a | 27.2% | 25.2% | 1 |
| 4a–8a | 21.0% | 5.1% | 33 |
| 8a–12p | 14.6% | 12.1% | 117 |
| 12p–4p | 17.0% | 16.6% | 119 |
| 4p–8p | 23.3% | 22.5% | 119 |
| 8p–12a | 25.0% | 19.3% | 108 |

"Best possible" picks the K busiest blocks in hindsight, so it is the ceiling no forecast can beat. Days with under 200 tickets in a window are skipped for that window.
