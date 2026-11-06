# Game day 2026-11-06: dead man's switch

## Hypothesis

If the alerting chain on the Pi breaks while the Pi itself stays up (the failure mode of the
2026-11-01 incident), the CloudWatch alarm homepi-heartbeat-missing e-mails from outside the Pi
within 25 minutes of the last heartbeat, and returns to OK within 15 minutes of the repair.

## Method

Alertmanager stopped on the Pi (Prometheus, network, DNS and AWS left working), alarm state polled
every 30 s from the laptop with SSO, Alertmanager started again after the ALARM. Times are accurate
to the polling interval (30 s). Release under test: v0.1.27.

## Timeline

| Event | Time |
|---|---|
| Last heartbeat accepted by CloudWatch | 2026-11-06 23:36:52 JST |
| Alertmanager stopped | 2026-11-06 23:41:12 JST |
| Alarm in ALARM state | 2026-11-07 00:03:06 JST |
| Alertmanager started | 2026-11-07 00:03:06 JST |
| Alarm back to OK | 2026-11-07 00:05:14 JST |

## Results

| Measure | Value | Target |
|---|---|---|
| Detection delay (last heartbeat to ALARM) | 26 min | 25 min or less |
| Recovery delay (restart to OK) | 2 min | 15 min or less |
| Heartbeats published by the relay since its start | 2 | |
| Failed publishes | 0 | 0 |

Result: FAIL

## What this proves and what it does not

- Proven: a broken alerting chain on a running Pi is detected from outside the Pi, through a path
  that depends neither on the Pi's DNS nor on Slack, and the recovery is reported too.
- Not proven yet: a full power loss or network loss of the Pi (same mechanism, to record on video
  for step E5), and the Slack path itself (step A4).

Human confirmation: ALARM e-mail received: y, OK e-mail received: y
