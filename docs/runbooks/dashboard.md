# Dashboard (v0.1.62)

Source: `apps/dashboard` at the deployed tag. The `dashboard` role builds it on
the Pi as `homepi-build` (no login shell) with `npm ci --ignore-scripts`
(lockfile integrity, no install scripts) and `npm run build`, then checks the
build (`files/check-dashboard-build.py`: every asset referenced by index.html
exists, no InfluxDB token is embedded).

Serving: `/var/www/homepi-dashboard` is a symlink to a root-owned release
directory `/var/www/homepi-dashboard-releases/<content hash>`, switched
atomically (`ln -sfn` + `mv -T`). The release holds `.homepi-source` (content hash
of apps/dashboard, `files/source-hash.py`: the precheck runs on an exported
copy without .git): the hourly check reports drift when the served dashboard is
not the deployed source. Any failure points the symlink back to the previous
release; the first rollback target is `legacy-2026-09-27`, the hand-deployed
directory (files were srvpi-owned, some world-writable, until the 2026-11-08
containment).

Retired: `/opt/homepi-dashboard` (copy of the sources frozen on 2026-09-27,
identical to v0.1.59), `/usr/local/bin/deploy-dashboard` (`cp -r` without
removal, `chown www-data`), `.env.local` (`VITE_INFLUX_TOKEN` compiled into the
bundle; nginx injects the token since v0.1.61).

Fixed with the role: `sw.js` used `__BUILD_TIME__`, which Vite does not replace
in `public/` (the service worker failed to install); `service-worker.js` was
never registered; `site.webmanifest` had been edited by hand in the web root.

## Served files readable by nginx (v0.1.69)

Measured on 2026-11-08: the v0.1.64 release served 403 to every browser
without a cached shell ("open() index.html failed (13: Permission denied)").
The build user's umask made Vite write index.html, the JS and the CSS 0600
and assets/ 0700; `copy` with `remote_src` applies `mode` to the top
directory only and kept those modes below it. Files from `public/` kept
0644, so /sw.js and /site.webmanifest answered 200, and the `/ -> 302`
health check only saw the Authelia redirect, never the file.

Fix: the release and the rollback target were made readable (chmod
u=rwX,go=rX, root-owned trees only). The role builds with umask 022,
reapplies u=rwX,go=rX recursively after the copy, and checks in apply and
check mode that www-data can read every served file (find -readable as
www-data); in apply a failure rolls back to the previous release.
