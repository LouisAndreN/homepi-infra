# Runbook: network and firewall

## Do not reload nftables (until B2b)

`/etc/nftables.conf` starts with `flush ruleset`, and `systemctl reload nftables` runs that file. A
reload or restart wipes every table, not only the static policy: the CrowdSec bans, the NetBird ACL and
NAT, the Docker chains and the IoT masquerade loaded by netfilter-persistent. If it happened:

    sudo systemctl restart netfilter-persistent crowdsec-firewall-bouncer netbird docker

## Layers (measured 2026-11-07)

| Table | Owner | Source |
|---|---|---|
| `inet filter` (policy drop) | static policy | `/etc/nftables.conf`, plus three `iifname "wt0" accept` rules injected by NetBird |
| `ip netbird` | NetBird | runtime (peer ACL, set of allowed peers) |
| `ip crowdsec`, `ip6 crowdsec6` | CrowdSec bouncer | runtime |
| `ip filter`, `ip nat`, `ip6 filter`, `ip6 nat` | iptables-nft | `/etc/iptables/rules.v4` and `rules.v6` (netfilter-persistent): Docker chains, IoT masquerade, an unused DNAT on 100.116.35.149:53 |

Access over `wt0` is decided by the NetBird ACL: the injected accept rules come before the explicit
"Netbird" rules of `inet filter`. NetBird routes nothing for peers (`Networks: -`).

## Model

The `network` role (B2a) verifies the files and services in check mode and fails on drift; it never
writes or reloads. Changes will go through the guarded tools of B2b (atomic table replacement, automatic
rollback after 3 minutes unless confirmed), with physical access to the Pi.
