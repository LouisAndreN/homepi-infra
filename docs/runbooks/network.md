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

A failed network service is drift too, so the release precheck refuses every tag while it lasts,
including the tag that fixes it (C4, 2026-11-22: dnsmasq down after a boot race refused v0.1.143,
which carried the fix). Restore the service as an operation (`systemctl start <unit>`), check it,
then release. Never bypass the precheck.

## IoT egress NAT: stays in netfilter-persistent

The IoT masquerade stays in `/etc/iptables/rules.v4`. It worked; moving it to nftables would only
consolidate (one file, one tool). A move needs a proof that IoT egress still works, and the only honest
client is an IoT device: a phone on `Pi-IoT` would copy the shared WPA2 key to a general-purpose device
and its cloud backup. v0.1.50 added a second NAT in nftables before that proof existed; v0.1.51 reverts
it. The move will be done in one guarded step once the egress canary (an ESP32 that checks HTTPS egress
and IoT-to-LAN isolation, and reports over MQTT) exists.

## DNS DNAT for NetBird peers

`rules.v4` (netfilter-persistent) holds `-d 100.116.35.149 --dport 53 -j DNAT --to 127.0.0.1`
(UDP and TCP): a NetBird peer that asks the Pi's NetBird address for DNS is answered by Unbound,
which sees the peer's 100.x source and serves the `netbird` view (homepi.internal ->
100.116.35.149). It works only with `net.ipv4.conf.wt0.route_localnet=1`, set by
`/etc/sysctl.d/99-netbird-localnet.conf` (applied by systemd when wt0 appears), verified by the
network role since v0.1.92. In use: the UDP counter rose from 11 to 12 between two reads on
2026-11-10 (an earlier note called it dead). It moves to nftables with the IoT NAT, in the same
guarded step (`scripts/homepi-nft-apply`) once the egress canary exists.

## LAN address: static, reserved twice

Since v0.1.134 eth0 has a static address (`ansible/roles/network/files/netplan-10-network.yaml`):
192.168.0.151/24, default route via 192.168.0.1, no DHCP. The router also keeps a reservation for the
Pi's MAC, so that it never hands the address to another device. Before, the address was a plain DHCP
lease: after the disk change of the C3 game day (2026-11-21) the Pi came back on another address and,
for a night, had no SSH from the LAN and no DNS at all (Unbound bound only to the missing address).

What depends on the address, and how it now behaves when the address is missing:

| Component | Binding | Without 192.168.0.151 |
|---|---|---|
| sshd (`ssh.socket`) | every address (no `ListenAddress`, role `sshd`) | still answers on every other address; nftables limits port 22 to the LAN and `wt0` |
| Unbound | `interface: 127.0.0.1` and `192.168.0.151`, `ip-freebind: yes` | starts anyway; the system resolver (127.0.0.1) keeps working |
| nftables, the DNS check, the house DNS setting | the literal address | broken until the address is back: this is why the address is static |

### Changing the netplan file

The `network` role never writes `/etc/netplan/10-network.yaml`; it fails on any difference. So the order
is fixed: **production first, release second**. A release that changes the file before production has it
is refused by `homepi-precheck` (network drift), as v0.1.134 was on its first try.

1. Copy the new file to the Pi, keep the old one under `/root/netplan.before-<change>/` (root 0700).
2. `sudo netplan generate`, then `sudo netplan try --timeout 120` and press Enter when asked. Without
   Enter (the session froze), netplan reverts on its own; put the old file back and `netplan apply`.
3. From the laptop, a new SSH connection and a DNS query must work.
4. Then `release`: the precheck compares the live file with the repository and passes.

A rebuilt Pi gets the file in R1 (`homepi-r1-layout`), before its first boot.

## SSH (role `sshd`)

`/etc/ssh/sshd_config` is managed since v0.1.134: keys only, `PermitRootLogin no`, no `ListenAddress`.
Ubuntu 24.04 starts sshd through `ssh.socket`; `sshd-socket-generator` turns `ListenAddress` lines into
`/run/systemd/generator/ssh.socket.d/addresses.conf` at `daemon-reload`. With no `ListenAddress` that
file does not exist and the socket listens on `0.0.0.0:22` and `[::]:22`.

The role is guarded: the file is checked with `sshd -t` before it replaces the live one, the socket is
regenerated and restarted, then a new TCP connection must get the `SSH-2.0` banner on 127.0.0.1 and on
every local IPv4 address. If one address does not answer, the previous file
(`/root/sshd_config.before-role`, kept from the first run) comes back and the run fails. Open sessions
survive the socket restart. The banner check does not test a login: before `PermitRootLogin no`, the
journal showed no root login over SSH in 60 days and `/root/.ssh/authorized_keys` held no key.

Manual rollback, from a console or an open session:

    sudo cp /root/sshd_config.before-role /etc/ssh/sshd_config
    sudo systemctl daemon-reload && sudo systemctl restart ssh.socket
