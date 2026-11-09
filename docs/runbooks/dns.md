# DNS

## Unbound (v0.1.87)

Recursive resolver from the root servers (no third-party forwarder), DNSSEC validated
(`auto-trust-anchor-file`), `harden-dnssec-stripped`, 0x20 (`use-caps-for-id`). Listens on
127.0.0.1 and the LAN address; refuses everyone except the views:

| View | Clients | homepi.internal |
|---|---|---|
| lan | 127.0.0.0/8 (also dnsmasq for the IoT network), 192.168.0.0/24 | 192.168.0.151 |
| netbird | 100.64.0.0/10 | 100.116.35.149 |

`netbird.cloud` is forwarded to NetBird's resolver (100.116.35.149:53). Record TTLs are honoured
(`cache-min-ttl: 0`, was 3600); `serve-expired` answers from the stale cache only when the
upstream does not answer within 1.8 s (RFC 8767). `homepi-dns-check` checks each view, the IoT
path and DNSSEC (positive and negative) on every apply and check; external probes are skipped
when the root servers are unreachable.
