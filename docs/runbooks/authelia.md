# Authelia

Package `authelia` (4.39.19), unit from the package, listens on 127.0.0.1:9091 behind nginx
(`auth_request`). Default policy deny, one rule: `homepi.internal` two_factor.

## Secrets: which copy is real (measured 2026-11-08)

Three different values existed for each secret (JWT, session, storage encryption key):
`configuration.yml`, `/etc/authelia/secrets.txt` and `/var/lib/secrets/authelia.env`. Authelia
uses the environment (`AUTHELIA_*` variables override the file). `authelia storage encryption
check` returned SUCCESS with `authelia.env` and FAILURE with the `configuration.yml` value only:
restoring `/etc/authelia` without `authelia.env` would leave the database unreadable and force
every user to enroll 2FA again.

## Managed (v0.1.76, adoption without change)

- `/var/lib/secrets/authelia.env` (root 0600) and `/etc/authelia/users_database.yml`
  (authelia 0640) from `ansible/secrets/authelia.sops.yaml`, byte-identical to the adopted files.
- Drop-in `authelia.service.d/secrets.conf` (`EnvironmentFile=`).

## Next (v0.1.77)

`configuration.yml` as a template without any secret; archive `secrets.txt`,
`docker-compose.yml`, `config/` (unused second users file), `configuration.yml.dpkg-old`,
`/var/lib/authelia/db.sqlite3.bak`; new random JWT and session secrets (sessions end); the storage
key stays (it sits next to the database and in the same backups, so rotating it would not reduce
exposure).

## Notes

- Notifier: filesystem, `/var/lib/authelia/notification.txt` (0600). 2FA enrollment and reset
  links are written there in clear.
