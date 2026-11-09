# Packages

No role installed packages until v0.1.91: every package and third-party apt source was installed by
hand (inventory 2026-11-10: about 40 platform packages from 10 apt sources). Role `packages` is the
rebuild manifest (C1, phase R1).

## Installed but disabled

| Service | Why disabled, not removed |
|---|---|
| docker.socket, docker.service, containerd.service | no container (one old image); Docker wrote 19 DOCKER chains into iptables next to the nftables firewall that isolates the IoT network. Kept installed by decision (2026-11-10). |

The DOCKER chains already in the kernel stay until the next reboot, or longer if
`/etc/iptables/rules.v4` (netfilter-persistent) holds them.

## Not to reinstall on a rebuild (to confirm when the manifest is written)

isc-dhcp-server (masked; dnsmasq serves DHCP), nmap, stress, fio, lxd-installer, the stale
`influxdata.list.ucf-old`.

## API tests

`python3 -m pip install -r apps/api/requirements-dev.txt` in the repository virtualenv installs the
Pi's locked API packages plus pytest and httpx; before 2026-11-10 no test executed the application.
