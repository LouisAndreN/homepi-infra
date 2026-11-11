# Runbook: apt sources, pending upgrades and their alerts

## What installs itself and what does not

Unattended upgrades install Ubuntu security updates only. Every third-party package (Authelia,
CrowdSec and its bouncer, NetBird, Grafana, Alloy, Telegraf, InfluxDB CLI, step, Docker, Node.js) is
installed by hand, after a check of the service. Measured 2026-11-11: 15 third-party upgrades
pending, among them Authelia 4.39.19 to 4.39.28, NetBird 0.71.4 to 0.82.1 and CrowdSec 1.7.8 to 1.8.2.

Two Allowed-Origins entries carry a doubled `$$` (`$${distro_id}`), so they match nothing; one of
them was meant to allow `-updates`. Left as is until decided.

## Metrics and alerts (homepi-wifi-check, boot_chain.yml)

- `homepi_apt_update_success_timestamp_seconds`: mtime of `/var/lib/apt/periodic/update-success-stamp`,
  written by APT only when every source refreshed. AptSourcesFailing after 48 hours.
- `homepi_apt_upgradable_packages{class}` and `homepi_apt_upgrade_pending_oldest_seconds{class}`, from
  an `apt-get -s dist-upgrade` simulation (no lock, no cache write); first-seen times in
  `/var/lib/homepi/apt-pending.tsv`, so the age is counted from the first check that saw the
  version, not from its publication. ThirdPartyUpgradesPending after 14 days,
  UbuntuSecurityUpgradesPending after 2 days.

## Correction of the v0.1.97 commit message

v0.1.97 states that apt-get update has no warning. When it ran (2026-11-11, around 07:45 JST),
apt-get update reported "no longer has a Release file" for apt.authelia.com and for the CrowdSec
packagecloud source; the release block printed the errors without stopping. Both are hosted by
packagecloud; an hour later both answered 200 from the Pi and the laptop and apt-get update was
clean, so it was a transient outage and no source or key changed. The release blocks now have to
stop on any Err or E line.
