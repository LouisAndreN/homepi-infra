# Game day 2026-11-07: storage drift drill

## Context

The hourly check timer runs the deployed tag in check mode. The `storage` role reports drift by
failing the run, and until v0.1.43 no rule watched `homepi_gitops_check_success`: drift was detected
every hour and nobody was told. v0.1.43 added `GitopsCheckFailing`.

## Hypothesis

If a managed boot-critical file is changed by hand, the next check fails, `GitopsCheckFailing`
reaches Slack, and the documented repair (`storage.yml`) clears it.

## Method

A comment line, ignored by systemd, appended to `/etc/systemd/system/mnt-data-archives.mount`. The
check run was started by hand instead of waiting for the hourly timer.

## Timeline (JST)

| Time | Event |
|---|---|
| 15:29:29 | Drift created |
| about 15:31 | Check run failed: `Storage drift detected: subvolume mount units`, `homepi_gitops_check_success 0` |
| 15:36:49 | `GitopsCheckFailing` firing, 440 s after the drift (check run, scrape, `for: 5m`) |
| then | `storage.yml` changed only the unit; no drill line left; check run passed, 0 changed task |
| 169 s after the repair started | Alert resolved in Prometheus |
| 15:42 | `[RESOLVED] WARNING - GitopsCheckFailing` seen in Slack by a human |

## Result: PASS

## Limits

The drill started the check by hand. In real use the drift waits for the next hourly run
(`OnCalendar=hourly`, `RandomizedDelaySec=300`): worst case about 1 h 12 min from the change to the
alert.
