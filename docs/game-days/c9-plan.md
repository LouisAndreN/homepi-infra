# Game day C9: plan and verdict rules, written before the drill

Written 2026-11-25, before T0. Nothing in this file changes once the drill has started; the report
(`docs/game-days/<date>-c9.md`) quotes it.

## Why C9

v1.1.0 is a minor that changed the restore procedure: R6 no longer fails on SLO alerts
(docs/versioning.md: a minor that changes the restore procedure is followed by a drill). C8 ran on
v0.4.4. What changed since, and what C9 proves about it:

| Since C8 | Expected in C9 |
|---|---|
| v1.0.1 alert inhibition; the precheck runs the alert tests and `inhibit-test` | R4TAG about a minute longer than in C8 (5 min 56 s); the precheck passes on the rebuilt Pi |
| v1.1.0 SLOs; R6 prints SLO alerts and does not fail on them | R6 PASS on the rebuilt Pi (new TSDB: the SLO history starts there) and on production after R8, where the fast ingestion burn is expected to fire |
| v1.1.1 the SLO rules in one group | 1 SLO rule group on both Pis |
| v1.1.3 `release` fails on a refused push | a refused push in R4TAG now stops the phase instead of passing |
| v1.1.4 the drill tag is listed in `CHANGELOG.md` (R4SOPS, R4TAG) | the CI run of the drill tag passes its `changelog` job |

## Scenario

Same as C8: production NVMe (Micron 2200) removed and kept intact, the platform rebuilt on the spare
(Samsung 990 PRO) from the signed GitHub repository and the age-encrypted S3 archives only, then R7,
R9, R8 and the SOPS step that removes the drill key.

    scripts/restore/homepi-restore start --devices 7 --model "990 PRO"

## Verdict rules (unchanged since C7)

The drill is **clean** only if, from R0 to the SOPS step of R8: no code changes, no phase runs
twice, no step is redone. Any fix during the drill makes it not clean; it is then published with its
numbers as not clean.

## Measures, with the result decided now

| Measure | PASS when | If not |
|---|---|---|
| RTO, T0 to R6 PASS | under 4 h | FAIL |
| R0 to R6 phases at their first attempt | all | not clean |
| R7, R9, R8, SOPS step at their first attempt | all | not clean |
| Sensor data lost (newest delta to T0) | under 1 h | FAIL |
| State lost / native series lost | under 24 h each | FAIL |
| Certificates re-issued; ESP32s back on both Pis | 0; 7 and 7 | FAIL |
| R6 on the rebuilt Pi and on production | PASS, SLO alerts only as info | not clean |
| SLO rule groups on production after R8 | exactly `slo` | not clean |
| CI runs of the drill tag and of the SOPS tag | 5 jobs green each | recorded as a defect (CI is not the release gate) |
| Production ingestion budget after R8 | above 0 (not exhausted) | FAIL of the SLO design |

Recorded, not judged: the budget the drill spends. `docs/slo.md` predicts about 30% of the 28-day
ingestion budget for an hour off (60 of 202 minutes) and about 15% of the device API budget. A value
outside 25 to 40% (ingestion) means the prediction in docs/slo.md is wrong and is corrected in the
report.
