# Shell helpers for the laptop. Load them with: . ~/homepi-infra/scripts/lib.sh

# B11: the repository venv (built from ansible/requirements.txt) comes first, never the system Ansible
if [ -x "$HOME/homepi-infra/.venv/bin/ansible-playbook" ]; then
  case ":$PATH:" in *":$HOME/homepi-infra/.venv/bin:"*) ;; *) export PATH="$HOME/homepi-infra/.venv/bin:$PATH" ;; esac
fi

# B11: run the HEAD commit in check mode on the Pi with the Pi's own runtime (unsigned, check mode only,
# nothing applied), and refuse a laptop whose ansible-core differs from the Pi's.
homepi_precheck() {
  local out rc lv pv
  # The helper is root-only (0750): test it with sudo, like every root-owned file on the Pi
  if ! ssh homepi 'sudo test -x /usr/local/sbin/homepi-precheck' < /dev/null; then
    if [ "${HOMEPI_PRECHECK_BOOTSTRAP:-}" = 1 ]; then echo "WARNING: homepi-precheck not installed yet (bootstrap release), Pi check skipped"; return 0; fi
    echo "STOPPED: /usr/local/sbin/homepi-precheck missing on the Pi"; return 1
  fi
  out=$(git -C ~/homepi-infra archive --format=tar HEAD | ssh homepi 'sudo /usr/local/sbin/homepi-precheck' 2>&1); rc=$?
  echo "$out"
  lv=$(ansible --version 2>/dev/null | head -n 1); pv=$(echo "$out" | sed -n 's/^precheck runtime: \(ansible \[core [^]]*\]\).*/\1/p')
  [ "$lv" = "$pv" ] || { echo "STOPPED: the laptop runs '$lv', the Pi runs '$pv'"; return 1; }
  { [ "$rc" -eq 0 ] && echo "$out" | grep -qE '^homepi +:.* unreachable=0 +failed=0 '; } || { echo "STOPPED: the Pi's own runtime rejects this commit, no tag created"; return 1; }
  echo "Pi precheck: OK ($pv)"
}

# Commit the given paths, then sign, verify and push a release tag to the Pi.
# Every step can be resumed: an existing commit with the same subject is reused,
# and an existing tag stops the function before anything is pushed.
# Usage: release "<commit subject>" "<commit body>" <tag> "<tag message>" <path>...
release() {
  local subject="$1" body="$2" tag="$3" tagmsg="$4" rc
  shift 4
  [ "$(hostname)" = "DESKTOP-581OMPC" ] || { echo "STOPPED: run this on the laptop"; return 1; }
  cd ~/homepi-infra || return 1
  if [ "$(git log -1 --format=%s)" != "$subject" ]; then
    { git add -- "$@" && ! git diff --cached --quiet; } || { echo "STOPPED: nothing staged for this commit"; cd ~; return 1; }
    git commit -q -m "$subject" -m "$body" || { echo "STOPPED: the commit failed (run release again)"; cd ~; return 1; }
  fi
  if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then echo "STOPPED: tag $tag already exists"; cd ~; return 1; fi
  homepi_precheck || { cd ~; return 1; }
  git tag -s "$tag" -m "$tagmsg" && git tag -v "$tag" > /dev/null 2>&1 && echo "tag verified" && git push pi main "refs/tags/$tag" 2>&1 | tail -2
  rc=$?
  cd ~
  return $rc
}

# Load the homepi AWS profile for Terraform. Opens a new SSO session when the current one expired,
# refuses the management account, and passes the account ID to Terraform without storing it in the repository.
awsenv() {
  local me mgmt root
  export AWS_PROFILE=homepi-admin
  aws sts get-caller-identity > /dev/null 2>&1 || aws sso login --no-browser || return 1
  me=$(aws sts get-caller-identity --query Account --output text) || return 1
  mgmt=$(aws organizations describe-organization --query Organization.MasterAccountId --output text) || return 1
  [ "$me" != "$mgmt" ] || { echo "STOPPED: this profile points at the management account"; return 1; }
  export TF_VAR_homepi_account_id="$me"
  # heartbeat.tf needs the alert address: it stays in SOPS and reaches Terraform through the
  # environment only, never argv, never printed
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  TF_VAR_alert_email=$(sops -d --extract '["alert_email"]' "$root/ansible/secrets/aws.sops.yaml") || { echo "STOPPED: could not decrypt alert_email from SOPS"; return 1; }
  [ -n "$TF_VAR_alert_email" ] || { echo "STOPPED: alert_email is empty in SOPS"; return 1; }
  export TF_VAR_alert_email
  echo "AWS profile homepi-admin ready (workload account, region $(aws configure get region))"
}

# Management account session for the organization roots (terraform/aws/mgmt-bootstrap, org).
# The SSO profile homepi-mgmt must point at the management account; the root e-mail addresses of
# the member accounts stay in SOPS and reach Terraform through the environment only.
awsmgmt() {
  local me mgmt root
  export AWS_PROFILE=homepi-mgmt
  aws sts get-caller-identity > /dev/null 2>&1 || aws sso login --no-browser || return 1
  me=$(aws sts get-caller-identity --query Account --output text) || return 1
  mgmt=$(aws organizations describe-organization --query Organization.MasterAccountId --output text) || return 1
  [ "$me" = "$mgmt" ] || { echo "STOPPED: profile homepi-mgmt does not point at the management account"; return 1; }
  export TF_VAR_management_account_id="$me"
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  TF_VAR_log_archive_email=$(sops -d --extract '["log_archive_email"]' "$root/ansible/secrets/aws.sops.yaml") || { echo "STOPPED: log_archive_email missing from SOPS"; return 1; }
  TF_VAR_backup_vault_email=$(sops -d --extract '["backup_vault_email"]' "$root/ansible/secrets/aws.sops.yaml") || { echo "STOPPED: backup_vault_email missing from SOPS"; return 1; }
  [ -n "$TF_VAR_log_archive_email" ] && [ -n "$TF_VAR_backup_vault_email" ] || { echo "STOPPED: an account e-mail is empty in SOPS"; return 1; }
  export TF_VAR_log_archive_email TF_VAR_backup_vault_email
  echo "AWS profile homepi-mgmt ready (management account, region $(aws configure get region))"
}

tfinit_mgmt() {
  [ -n "${TF_VAR_management_account_id:-}" ] || { echo "STOPPED: run awsmgmt first"; return 1; }
  terraform init -input=false -no-color -backend-config="bucket=homepi-tfstate-${TF_VAR_management_account_id}" "$@"
}

# Initialise a Terraform root on the shared S3 backend. The bucket name contains the account ID,
# so it is passed here instead of being written in the repository. Run awsenv first.
tfinit() {
  [ -n "${TF_VAR_homepi_account_id:-}" ] || { echo "STOPPED: run awsenv first"; return 1; }
  terraform init -input=false -no-color -backend-config="bucket=homepi-tfstate-${TF_VAR_homepi_account_id}" "$@"
}
