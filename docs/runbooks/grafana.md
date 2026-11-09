# Grafana

Grafana 13 listens on a unix socket, `/run/grafana/grafana.sock`, mode 0660, group `grafana-web`
(members: `grafana`, `www-data`). `/run/grafana` is 0751. Nothing listens on TCP 3000.

Why: `[auth.proxy]` trusts `X-WEBAUTH-USER`. Over TCP 127.0.0.1 with `whitelist = 127.0.0.1`, any
local process could send that header and become Grafana admin (proved 2026-11-09 as `nobody`).
On the socket, only nginx can send it, and nginx sets it from Authelia.

| Client | Path | Authentication |
|---|---|---|
| Browser | nginx `/grafana/` -> socket | Authelia (2FA); nginx sets `X-WEBAUTH-USER`, clears `Remote-Role` |
| Prometheus | nginx 127.0.0.1:3001 `/grafana/metrics` -> socket | Grafana metrics basic auth |
| Terraform | nginx 127.0.0.1:3001 `/grafana/` -> socket | Grafana service account token |

The loopback server on 3001 strips `X-WEBAUTH-USER` and `Remote-Role`, so a local process that
reaches it still needs Grafana credentials. Roles are no longer read from a header.

Secrets (`/etc/grafana/secrets`, root:grafana 0640, read through `$__file{}`):
`secret_key` (SOPS `grafana.sops.yaml: grafana_secret_key`; it encrypts data source secrets in
grafana.db: changing it needs a re-encryption, never a plain replacement), `admin_password`
(`grafana_admin_password`, only used when the database is created), `metrics_password`
(`monitoring.sops.yaml: grafana_scrape_password`).

`homepi-grafana-check` runs on every apply and check: health over the socket, www-data reaches it,
nobody does not, a forged identity through 3001 gets 401, the InfluxDB data source answers.

Known: `[geomap] default_baselayer_config` is not valid JSON (kept as found; Grafana falls back to
its default base layer).

## Rollback

`/var/backups/grafana/grafana.ini.pre-v0.1.80` (root 0600) is the file before v0.1.80. Restore it,
revert the release, apply.
