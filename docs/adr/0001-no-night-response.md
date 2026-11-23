# ADR 0001: nobody acts on alerts at night; automation bounds the damage

Status: accepted, 2026-11-23. Revisit when the platform has a user other than me, or a service
someone depends on at night.

## Context

HomePi has one operator. On 2026-11-22 a release broke the provisioning API at 22:32; alerts fired
within 12 minutes and Slack received 79 notifications overnight, but nobody acted until the morning
(docs/incidents/2026-11-22-api-outage.md). Two questions came out of it: who acts at night, and why
did one bad release become a 9-hour outage.

The second answer is mechanical: GitOps retried the failing tag every 10 minutes, and every attempt
stopped the API for its rebuild. The API was never up long enough to keep its database files, and
the outage outlived the release.

A phone alert that wakes me up would answer the first question for a home platform at the cost of
on-call I do not want, and it would still leave the retry loop in place.

## Decision

1. No night response. Alerts go to Slack as today and are read in the morning; no paging.
2. The damage of a bad release is bounded by automation instead of a person:
   - a tag that fails to apply twice in a row is **held**: the apply timer no longer retries it until
     a newer tag is released or an operator runs `homepi-gitops-sync retry` (`GitopsTagHeld`);
   - every role that restarts a service has a rescue that restores the previous state (unchanged);
   - `HomepiApiDown` and the other critical rules say what broke, so the morning starts with a
     diagnosis, not a search.

## Consequences

- A bad release costs at most two attempts (about 20 minutes of disruption), then production stays
  on the deployed tag, unless the rescue itself fails.
- A failure the automation cannot undo lasts until the morning. Accepted for what it stops:
  provisioning, OTA rollouts, the admin API, the dashboard.
- Accepted with a known cost: if Mosquitto, Telegraf or InfluxDB stay down at night, sensor data is
  lost until the morning (the ESP32s keep no buffer). These units restart on failure; what restarting
  cannot fix waits.
- Not covered: a failure that is not a release (disk, power). The hardware watchdog and the restore
  procedure cover the worst of those; neither is faster at night.

## Alternatives rejected

- Phone push for `critical`: on-call for a home platform; it does not remove the retry loop.
- No retries at all: a transient failure (a mirror, a network blip) would hold every release; two
  attempts keep the transient case automatic.
