# Runbook: network and firewall

## Reloading nftables

Until v0.1.49 `/etc/nftables.conf` started with `flush ruleset`: a reload or restart wiped every table
(CrowdSec bans, NetBird ACL and NAT, Docker chains, the IoT masquerade). It now starts with
`destroy table inet filter` and replaces only the static policy, atomically. Change it only with
`scripts/homepi-nft-apply` (automatic rollback after 3 minutes unless confirmed). If the other tables
were ever wiped:

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

## IoT egress NAT: stays in netfilter-persistent

The IoT masquerade stays in `/etc/iptables/rules.v4`. It worked; moving it to nftables would only
consolidate (one file, one tool). A move needs a proof that IoT egress still works, and the only honest
client is an IoT device: a phone on `Pi-IoT` would copy the shared WPA2 key to a general-purpose device
and its cloud backup. v0.1.50 added a second NAT in nftables before that proof existed; v0.1.51 reverts
it. The move will be done in one guarded step once the egress canary (an ESP32 that checks HTTPS egress
and IoT-to-LAN isolation, and reports over MQTT) exists.
