# Service level objectives

Two SLOs, over a 28-day rolling window, computed by Prometheus on the Pi
(`ansible/roles/observability_core/files/prometheus/rules/slo.yml`, tests in `tests/slo_test.yml`).
They exist since v1.1.0 (2026-11-25); before that HomePi had alerts, an RTO and an RPO, but no
objective for the service over time.

| SLO | SLI (one sample per minute) | Target | Error budget in 28 days |
|---|---|---|---|
| Ingestion | the minute is good when InfluxDB accepted at least one Telegraf write in the last 2 minutes | 99.5% | 202 minutes (3 h 22 min) |
| Device API | the minute is good when `homepi-api.service` is active | 99% | 403 minutes (6 h 43 min) |

## How the error ratio is computed

Bad minutes in a window = minutes elapsed in the window minus good samples. A minute without a sample
counts as bad: the Pi off, Prometheus down or an evaluation missed are not "no data", they are minutes
nobody can show were good. The minutes before the SLO rules first ran on this TSDB
(`homepi:slo_start_timestamp_seconds`) count as good, so the budget is a fixed number of minutes from
the first day, not a percentage of a few days of history.

All SLO rules, recording rules and alerts, are one rule group evaluated every minute, in file order:
each rule reads only series an earlier rule of the same evaluation wrote. Until v1.1.1 they were in
three groups (5 min, 1 min, 15 s); which group ran first at a given instant decided whether a rule saw
this minute's sample or the previous one, and the tests failed at random on the Pi (the v1.1.1
precheck refused to sign: a 28-day count off by one minute).

## Why these targets

The targets follow from what the platform can deliver with its design, not from a wish:

- **Device API 99%.** Nobody acts at night (docs/adr/0001-no-night-response.md). One overnight outage is
  about 8 hours, more than the 403-minute budget. The 2026-11-22 incident (the API down about 9 hours)
  would have spent it by a third more (`slo_test.yml` replays it). The target says the same thing as the
  ADR in numbers: with nobody at night, availability comes from prevention (the tag hold, the rebuild
  tests), not from response.
- **Ingestion 99.5%.** The ESP32s buffer readings while the network is down (`buffered: true`), so a short
  ingestion stop loses no data, but the dashboard and the alerts that read InfluxDB are blind meanwhile.
  202 minutes allow a controlled reboot every week and one restore drill.

## Alerts

Multiwindow, multi-burn-rate (Google SRE workbook, chapter 5), for each SLO:

| Alert | Fires when | Severity | Means |
|---|---|---|---|
| `Slo...BurnFast` | 1 h and 5 min error ratios above 14.4x the budget rate, for 2 min | critical | about 2% of the 28-day budget in one hour |
| `Slo...BurnSlow` | 6 h and 30 min error ratios above 6x, for 15 min | warning | about 5% in six hours |
| `Slo...BudgetExhausted` | 28-day budget at or below 0, for 1 h | warning | the release policy below applies |

The short window stops an alert as soon as the problem stops; the long window keeps a blip from
alerting. The fast burn detects an ingestion stop in about 10 minutes (`InfluxWritesStopped` needs 25)
and a flapping API that `HomepiApiDown` (5 minutes in a row) never sees. Once the cause alert fires,
Alertmanager inhibits the fast burn (`HomepiApiDown` of the device API, `InfluxDBDown`,
`InfluxWritesStopped`): one notification per outage. The slow burn and the spent budget are not
inhibited: they say how much the outage cost, which the cause alert does not.

Every SLO alert carries an `slo` label. R6 (`homepi-r6-verify`) prints them but does not fail on them:
an error budget is history, and the return of production after a drill always spends some (the fast
burn fires once on production after a drill: expected, it is the price of the drill).

## Policy

- Budget exhausted: no release that is not a fix for that SLO, and no restore drill, until the budget
  is positive again.
- A restore drill costs ingestion budget: production is off about an hour (59 min 53 s in C8), about
  30% of the 28-day ingestion budget. Drills are planned when the budget can pay for one.

## Limits

- The SLIs are measured on the Pi. While the Pi is down nothing is measured; the minutes are counted
  as bad when Prometheus runs again, and the dead man's switch (CloudWatch) is what alerts during the
  outage.
- After a real disk loss the Prometheus TSDB is not restored (it is not backed up): the SLO history
  restarts on the rebuilt Pi, and the outage before the rebuild is not in it.
- During a drill the rebuilt spare ingests the data while production is off: the production SLI
  counts the whole hour as bad, more than the service really lost.
- The device API SLI is the unit being active, not requests answered: an API that runs and answers
  errors counts as good. A request-based SLI (from the nginx access log) is the next step.
- The ingestion SLI is the whole pipeline: one silent sensor among seven is not seen by it
  (`DeviceSilent` is the per-device alert).
