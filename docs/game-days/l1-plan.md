# Game day L1: release without the laptop. Plan and verdict rules, written before the drill

Written 2026-11-25, before T0. Nothing here changes once the drill has started; the report
(`docs/game-days/<date>-l1.md`) quotes it.

## Why L1

`docs/disaster-recovery.md` says a lost laptop is recovered with GitHub, the paper key and the
escrow USB key, and that a new release signer "goes into `allowed_signers` by hand on the Pi":
documented, never done. The inventory of 2026-11-25 (`docs/known-limits.md`) found that everything
but one thing already works without the laptop: the phone logs in to the Pi (its own SSH key,
through NetBird) and to AWS SSO (MFA on the phone). The one thing missing is a release:
`allowed_signers` holds one key, the laptop's, so without the laptop GitOps stays on the deployed
tag. L1 proves a release made from the phone alone, signed by a new key, applied by GitOps and
checked by CI.

Decided by the owner before the drill: the phone key **stays** a release signer after L1 (second
signer, passphrase-protected), and the phone uses GitHub during the drill (`gh auth login`, the
token revoked at the end).

## Before T0 (not timed)

- C9 done, and the release that manages `authorized_keys` (`sshd` role) deployed: L1 runs on the
  access list it will rely on.
- Termux on the phone with `git`, `openssh`, `gh`; NetBird connected; `ssh homepi` works from the
  phone. Nothing else installed, no file copied from the laptop to the phone.

## Scenario (T0: the laptop is lost)

At T0 the laptop is closed and not used again until the end of the drill. From the phone only:

1. New signing key on the phone (`ssh-keygen -t ed25519`, passphrase typed).
2. Its public key added to `/etc/homepi-gitops/allowed_signers` on the Pi by hand, over SSH from the
   phone; the laptop key stays (the laptop is lost in the scenario, not stolen).
3. `gh auth login` (device flow, push scope), clone of the repository from GitHub.
4. One commit: `docs/release-signers.md` (the signers in `allowed_signers`, by fingerprint) and
   `CHANGELOG.md` listing the tag (`scripts/changelog --next`).
5. Precheck on the Pi from the phone (`git archive HEAD | ssh homepi sudo homepi-precheck`).
6. Tag signed with the phone key, verified locally, pushed to GitHub with `main`.
7. GitOps on the Pi fetches the tag from GitHub, verifies it against `allowed_signers`, applies it.
8. CI run of the tag.
9. `gh auth logout`; the token revoked on GitHub (Settings, Applications).

## Verdict rules

The drill is **clean** only if, from T0 to step 9: the laptop is not used, no step is redone, and
nothing but the planned commit changes.

| Measure | PASS when | If not |
|---|---|---|
| Laptop used between T0 and step 9 | never | FAIL |
| Phone-signed tag deployed by GitOps (`/var/lib/homepi-gitops/deployed`) | yes, without any push to the Pi | FAIL |
| Precheck on the Pi | `failed=0` | FAIL (no tag is made) |
| CI run of the tag | 5 jobs green | recorded as a defect (CI is not the gate) |
| T0 to the tag deployed | under 2 h | FAIL |
| gh token revoked at the end | yes, checked on GitHub | FAIL |
| Steps redone | 0 | not clean |

Recorded, not judged: time per step, what had to be typed on the phone, and what the laptop must do
when it comes back (fetch, `main` fast-forward to the phone commit).

## Known gaps L1 does not cover

- A **stolen** laptop: the laptop key would also leave `allowed_signers`, `authorized_keys` would
  change through a release from the phone (`sshd_required_fingerprints` changes with it), and every
  secret rotates (`docs/known-limits.md`). Not drilled.
- The laptop age key: a release without SOPS changes needs none; a release that changes a secret
  without the laptop needs the paper key typed on the replacement machine. Not drilled.
