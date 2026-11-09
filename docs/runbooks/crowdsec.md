# CrowdSec

Agent (LAPI on 127.0.0.1:8080) and the nftables bouncer (sets `crowdsec-blacklists*`,
`crowdsec6-blacklists*`). Role `crowdsec` manages the console options, the acquisition files and
the collection list; the credential files are checked for presence and mode only.

## What leaves the Pi

The instance is enrolled in the CrowdSec console (community plan) and shares signals with the
central API: for each alert, the attacking IP, the scenario and the time. That is the price of the
community blocklist, received in return. Since v0.1.89 `share_context` is false: no excerpt of the
triggering log lines (paths, user names) is sent. Manual, tainted and custom decisions are shared;
the console cannot push decisions (`console_management: false`).

## What is watched

| Source | Collection | Why |
|---|---|---|
| journal: ssh, hostapd, netbird | crowdsecurity/sshd, linux | SSH brute force (reachable through NetBird only) |
| /var/log/syslog, kern.log | crowdsecurity/linux | generic |
| journal: authelia.service | LePresidente/authelia | brute force on the login portal |

SSH was read twice until v0.1.89 (the journal and `/var/log/auth.log`): every failure counted
double and the ban threshold was effectively halved. Only the journal is read now.

Not enabled: crowdsecurity/nginx and the HTTP scenarios. nginx accepts only the LAN and NetBird
(`allow`/`deny all`); crawl and scan scenarios add little there and could ban the owner's own
devices (dashboard polling, bursts of 404). To revisit if nginx is ever exposed further.

`homepi-crowdsec-check` runs on every apply and check: agent and bouncer active, bouncer pull under
5 minutes, nftables sets present, `share_context: false`, collections installed.
