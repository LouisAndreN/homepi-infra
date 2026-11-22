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
then rebuild the laptop venv with the commands above.

## When a released tag fails to apply

GitOps retries the newest tag every 10 minutes (`homepi-gitops-apply.timer`). When each attempt has a
cost (2026-11-22: every attempt stopped the provisioning API for a rebuild, docs/incidents/
2026-11-22-api-outage.md), stop the retries first:

1. `sudo systemctl stop homepi-gitops-apply.timer` on the Pi; let the running apply end
   (`systemctl is-active homepi-gitops@apply`), its rescue restores the previous state.
2. Bring the affected service back as an operation if the precheck needs it (a failed service is
   drift too), and note what was done (`logger -t homepi-ops ...`).
3. Fix in the repository, `release` (the precheck runs on a quiet system).
4. `sudo systemctl start homepi-gitops@apply` (blocking, 6 to 10 minutes), check the result, then
   `sudo systemctl start homepi-gitops-apply.timer`. The next apply also restarts the timer
   (`gitops_runtime`), so a forgotten step 4 cannot leave GitOps off for good.
