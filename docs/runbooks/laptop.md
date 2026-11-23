# Runbook: laptop Ansible runtime

The laptop and the Pi run the same Ansible (B11): both install `ansible/requirements.txt` (ansible-core
and its libraries) and `ansible/requirements.yml` (collections). `ansible.cfg` ignores collections
bundled with a system Ansible. The runtime is not in Git; rebuild it from the repository root:

    python3 -m venv .venv
    .venv/bin/pip install -r ansible/requirements.txt
    (cd ansible && ../.venv/bin/ansible-galaxy collection install -r requirements.yml -p collections)

`. scripts/lib.sh` puts `.venv/bin` first in `PATH`. `release()` refuses to sign a tag when the Pi
rejects the commit in check mode with its own runtime (`homepi-precheck`), or when the laptop and the
Pi run different ansible-core versions.

To change a version: edit the requirement file, release; the Pi installs it through `gitops_runtime`,
then rebuild the laptop venv with the commands above. Never in the other order: a laptop already on the new
version makes `release()` refuse, since the Pi only gets it by applying that release (2026-11-22,
ansible-core 2.20.11).

## When a released tag fails to apply

Since v0.2.1 a tag whose apply fails twice in a row is **held**: the apply timer no longer retries it
(`homepi-gitops-sync`, docs/adr/0001-no-night-response.md) and `GitopsTagHeld` fires next to
`GitopsApplyFailing`. Production stays on the deployed tag. Before the hold, a failing tag was retried
every 10 minutes and each attempt stopped the provisioning API (2026-11-22, docs/incidents/
2026-11-22-api-outage.md).

1. Read why: `sudo journalctl -u homepi-gitops@apply --since -2h`, and the full playbook output in
   `/var/log/homepi-gitops/`. `cat /var/lib/homepi-gitops/failed-attempts` shows the tag, the commit
   and the count.
2. Bring an affected service back as an operation if the precheck needs it (a failed service is
   drift too), and note what was done (`logger -t homepi-ops ...`).
3. Fix in the repository and `release` a newer tag: a newer tag is not held, the timer applies it.
4. Or, when the cause was on the Pi (a full disk, a mirror down) and the same tag should run again:
   `sudo homepi-gitops-sync retry` (lifts the hold, then applies, 6 to 10 minutes).

If the attempts themselves do damage and the hold has not started yet (first failure), stopping the
timer still works: `sudo systemctl stop homepi-gitops-apply.timer`; the next apply restarts it
(`gitops_runtime`).
