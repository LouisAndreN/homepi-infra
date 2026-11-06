# Game day 2026-11-07: dead man's switch, retest

## Context

Game day 1 (2026-11-06-dead-mans-switch.md) detected the broken chain but missed the detection
target by 1 minute. Changes under test: alarm on 1 minute periods, 8 empty out of 10 (commit
2e1c10d), and a Watchdog heartbeat at about one per minute (v0.1.29, measured 10 of 10 minutes).
Same hypothesis, method and targets as game day 1.

## Hypothesis

If the alerting chain on the Pi breaks while the Pi itself stays up, the CloudWatch alarm
homepi-heartbeat-missing e-mails from outside the Pi within 25 minutes of the last heartbeat, and
returns to OK within 15 minutes of the repair.

## Preconditions, checked by the test before starting

| Check | Value |
|---|---|
| AWS SSO session and Alertmanager | valid, active |
| Alarm state | OK |
| Alarm configuration (period, evaluation periods, datapoints to alarm) | 60 10 8 |
| Heartbeats in CloudWatch, last 10 complete minutes | ########## (0 empty, largest gap 1 min) |

## Timeline

| Event | Time |
|---|---|
| Last heartbeat accepted by CloudWatch | 2026-11-07 07:51:22 JST |
| Alertmanager stopped | 2026-11-07 07:52:13 JST |
| Alarm in ALARM state (seen by polling) | 2026-11-07 08:05:43 JST |
| Alertmanager started | 2026-11-07 08:05:43 JST |
| Alarm back to OK (seen by polling) | 2026-11-07 08:09:53 JST |

Alarm history recorded by CloudWatch:

| Time | Change |
|---|---|
| 2026-11-07 08:05:29 JST | Alarm updated from OK to ALARM |
| 2026-11-07 08:09:29 JST | Alarm updated from ALARM to OK |

## Results

| Measure | Value | Target |
|---|---|---|
| Detection delay (last heartbeat to ALARM) | 14 min | 25 min or less |
| Recovery delay (restart to OK) | 4 min | 15 min or less |
| Failed publishes since the relay started | 0 | 0 |

Result: PASS

Delays are measured by polling every 30 s; the CloudWatch history above gives the exact times.

Human confirmation: ALARM e-mail received: y, OK e-mail received: y
