# Runbook: who can log in

`srvpi` (passwordless sudo) accepts the keys of `sshd_authorized_keys`
(`ansible/roles/sshd/defaults/main.yml`) and nothing else; root accepts no key. The `sshd` role
writes the file on every apply, so a key added by hand on the Pi is removed by the next release,
and drift detection reports it within the hour.

| Key | Fingerprint | Where the private part lives |
|---|---|---|
| laptop | `SHA256:JwgCCawhiNm3uygLRgZXpkzJnXWRty5TVAGpVE+mJ/A` | `~/.ssh/id_ed25519` (passphrase) |
| phone | `SHA256:OnAQYyz9+TO3ChqKW2NOksC3DMRQ2RjffupIQybgtBI` | termux on the phone, used through NetBird |

## Add or remove a key

Commit the change to `sshd_authorized_keys`, then release. The role refuses to write a file that
does not hold every fingerprint of `sshd_required_fingerprints` (the laptop key, the one Ansible
connects with) or that has a line `ssh-keygen` does not read as a public key: the live file is
then left as it was.

## Laptop lost

The phone key still logs in. A list without the laptop key needs `sshd_required_fingerprints`
changed in the same commit, and that release is made from the replacement machine
(docs/game-days/l1-plan.md, once written).

## History

Until 2026-11-25 no role wrote this file: R1 copied it from the microSD system and R3 restored it
from the archive. Two keys of unknown origin had survived every rebuild (`SHA256:ODhK...` labelled
`louis@DESKTOP-581OMPC`, whose private part is on no file of the laptop, and `SHA256:nOUi...`
labelled `root@homepi`). The sshd log of 2026-10-25 to 2026-11-25 showed 73 key logins, all as
`srvpi`, all with the laptop or the phone key: neither was used in that month. Both are removed by
the release that brought this role.
