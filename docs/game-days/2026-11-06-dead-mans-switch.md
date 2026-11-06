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

## Analysis and follow-up (added 2026-11-07)

- The mechanism worked: ALARM and OK e-mails received, recovery in 2 minutes. The detection target
  was missed, and the result stays FAIL. CloudWatch history: ALARM at 00:02:44 JST, 25 min 52 s
  after the last heartbeat; OK at 00:04:44.
- Cause: 3 periods of 5 minutes with a heartbeat every 5 to 6 minutes. The theoretical ALARM was
  around 23:55; CloudWatch adds an evaluation delay on missing data (about 8 minutes here) and the
  design had no margin for it.
- First fix: alarm on 1 minute periods, 8 empty out of 10 (commit 2e1c10d), and Alertmanager
  repeat_interval 1m (v0.1.28).
- Sequencing incident during the fix: the alarm change was applied before the Pi cadence change.
  CloudWatch history: false ALARM at 00:12:29, OK at 00:16:29 once v0.1.28 was deployed. Lesson: a
  change that depends on another must check it in code, not in the instructions.
- Second finding, by measurement: v0.1.28 produced one heartbeat every 2 minutes, not every
  minute, because Alertmanager only checks repeat_interval at each group_interval tick. That left
  about 5 empty minutes out of 10 against a threshold of 8. v0.1.29 uses 30s and 30s: measured
  10 heartbeats in 10 minutes.
- The game day 2 precondition check (cadence) blocked a first attempt before anything was
  stopped, which is how the 2-minute cadence was found.
- Retest: 2026-11-07-dead-mans-switch-2.md.
