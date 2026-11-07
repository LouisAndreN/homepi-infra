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
