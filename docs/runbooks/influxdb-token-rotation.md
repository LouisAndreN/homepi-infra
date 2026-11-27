# Rotating an InfluxDB token without an outage (v1.4.2)

Written after the v1.4.0 rotation of the dashboard token (2026-11-27/28), which cost a night of
dashboard without data. What went wrong, each with its fix below:

| What happened | Why it hurt | Rule |
|---|---|---|
| The creation step ran twice and made two authorizations with the same description | `homepi-influx-check` saw 7 active for 6 expected: the release precheck failed twice and the agent HELD it | Create only if no active authorization has the description (guard below) |
| The old authorization was deleted before the release that switches nginx was applied | nginx kept injecting a deleted token until the apply | Delete the old one only after the switching release is applied |
| The expected list jumped from the old description to the new one in one release | No live state matches both the deployed and the new release at once | Two releases: one expecting both (tagged after the creation), one expecting the new one only (tagged after the deletion) |
| Commands typed in the wrong terminal (laptop instead of Pi, twice) | Harmless here, but a script must refuse to run on the wrong host | Every Pi script starts with `[ "$(hostname)" = "homepi" ] \|\| exit 1` |
| `influx auth inactive --id ...` returned `401 could not find auth` with the admin token while `delete` worked (influx CLI 2.x) | A reversible step was not available | Prove which authorization is in use by testing the token, not by deactivating |

InfluxDB cannot add permissions to an existing authorization and `auth list` no longer returns token
values (only `create` does), so a rotation is always: new authorization, secret switch, old one deleted.

## Procedure (example: the dashboard token)

`D_OLD` and `D_NEW` are the old and new descriptions; each must be unique. The rule that orders the
steps: a release's precheck compares InfluxDB with that release's expected list, so the live state
must already match the release being tagged. The checks of the release still deployed fail in
between (a few minutes, no outage); the pending release's precheck passes.

1. **Pi: create the new authorization, once** (script copied with scp, run with `sudo bash`):

       #!/bin/bash
       [ "$(hostname)" = "homepi" ] || { echo "not on the Pi"; exit 1; }
       export INFLUX_TOKEN=$(cat /var/lib/secrets/influx-admin.token)
       D_NEW="homepi-dashboard via nginx (read iot-hot, iot-archives)"
       n=$(influx auth list --org iot-org --json | python3 -c "import sys,json; print(sum(1 for a in json.load(sys.stdin) if a.get('status')=='active' and a.get('description')=='$D_NEW'))")
       [ "$n" = 0 ] || { echo "already $n active with this description: stop"; exit 1; }
       HOT=$(influx bucket list --org iot-org --name iot-hot --hide-headers | cut -f1)
       ARC=$(influx bucket list --org iot-org --name iot-archives --hide-headers | cut -f1)
       umask 077
       influx auth create --org iot-org --read-bucket "$HOT" --read-bucket "$ARC" --description "$D_NEW" --json \
         | python3 -c "import sys,json; d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; print(d['token'])" > /root/new.token
       install -m 600 -o srvpi -g srvpi /root/new.token /home/srvpi/new.token && shred -u /root/new.token
       echo "token bytes: $(wc -c < /home/srvpi/new.token)"

2. **Laptop: SOPS** (no sudo, no tty, so nothing but the token is captured):

       TOK=$(ssh homepi 'cat ~/new.token' | tr -d '\r\n'); echo "length ${#TOK}"   # 88
       [ ${#TOK} -eq 88 ] && sops set ansible/secrets/influx.sops.yaml '["influx_dashboard_token"]' "\"$TOK\""; unset TOK
       ssh homepi 'shred -u ~/new.token'

   Test the secret against InfluxDB, token on stdin only:

       sops -d --extract '["influx_dashboard_token"]' ansible/secrets/influx.sops.yaml | ssh homepi '
       read -r T; for b in iot-hot iot-archives; do
         printf "Authorization: Token %s\nContent-Type: application/vnd.flux\n" "$T" | curl -s -o /dev/null \
           -w "$b: HTTP %{http_code}\n" -H @- -XPOST "http://127.0.0.1:8086/api/v2/query?org=iot-org" \
           --data "from(bucket: \"$b\") |> range(start: -1h) |> limit(n: 1)"; done; unset T'

3. **Release N (patch)**: the SOPS change, and `influxdb_expected.authorizations` listing both
   `D_OLD` and `D_NEW` (live: both). nginx switches to the new token at this apply. Wait for
   `apply finished`, check the dashboard shows data.

4. **Pi: delete the old authorization** by description (after N is applied), then
   **release N+1 (patch)**: expected list holds `D_NEW` only. Wait for `apply finished` and a check
   with `drift: none`.

No step leaves nginx with a token that does not exist, and every release's precheck sees the state
its expected list describes. Cost: two patches instead of one minor.

## If a release is HELD

`homepi-gitops: HELD: vX failed 2 times in a row`. Find the cause in the first two attempts
(`journalctl -u homepi-gitops@apply` around `apply: vX`), fix it, then retry detached so that an
interrupted terminal cannot kill it:

    sudo systemd-run --unit homepi-gitops-retry --collect /usr/local/sbin/homepi-gitops-sync retry
    sudo journalctl -u homepi-gitops-retry -u homepi-gitops@apply -f
