# Versioning

Every release is a tag `vMAJOR.MINOR.PATCH`, signed with my key and applied by the GitOps agent on the
Pi. The agent deploys the highest version whose signature it trusts and refuses any tag older than the
one already deployed, so the numbers are also the deployment order.

## Rules (from v0.2.0)

| Part | Raised when | Examples |
|---|---|---|
| PATCH | A release the Pi applies through GitOps with no action from the operator | a rule, a role fix, a dependency upgrade |
| MINOR | The operator's contract changes: a procedure to run differently, a manual step, a data migration, a change the device firmware or an API client must follow | a new restore phase, a secret rotation, an MQTT topic change |
| MAJOR (1.0.0) | The platform is proven, not only built | see below |

The device firmware has its own numbers (`v2.x.y`, homepi-firmware): a firmware release reaches the
devices by staged OTA, independently of these tags.

## 1.0.0

1.0.0 is earned by a measurement, not given on a date:

- a restore drill on a blank disk that runs **without any error**: no code change during the drill,
  no phase run twice, no step redone by hand, and its RTO within the 4 hour target;
- the follow-up items of the last drill closed;
- a written answer for who acts on a critical alert at night.

A drill that needs a fix or a second attempt is published with its numbers as not clean, and 1.0.0
waits for the next one. C5 (2026-11-24) needed a fix. C6 (2026-11-24) had no defect and no code
change but two operator errors (a step redone, a phase run twice); the criterion was tightened after
C6, by decision, to cover them, so C6 does not count either.

## History

- v0.1.0 to v0.1.149: every release raised the patch, including releases that changed the restore
  procedure or required a secret rotation. In practice the patch was a deployment counter.
- v0.2.0: first release under these rules. It marks the restore procedure changed in v0.1.149 (R1
  erases the disk cryptographically, R9 erases the spare after a drill, R5B backs the rebuilt
  system up before R6), which under these rules is a minor change. C5 runs on this baseline.

Tooling that computes a tag (the restore orchestrator, `next_tag`) raises the patch of the highest
tag; a minor or major is always chosen by hand in `release`.
