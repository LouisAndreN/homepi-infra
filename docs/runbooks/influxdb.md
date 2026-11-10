# InfluxDB

InfluxDB 2.9.1, listens on 127.0.0.1:8086, data on `lv-influxdb` (XFS, encrypted volume).
Organization `iot-org`.

## State inside InfluxDB (checked by `homepi-influx-check` on every apply and check)

| Kind | Name | Detail |
|---|---|---|
| Bucket | `iot-hot` | 720 h |
| Bucket | `iot-archives` | 8760 h |
| Task | `downsample_iot_hot_to_archives` | every 1 h, offset 5 min, 5 min means of the `iot_sensors` fields; script in `roles/influxdb/files/tasks/` |
| Authorization | `telegraf-write` | write `iot-hot` (Telegraf) |
| Authorization | `grafana-read` | read `iot-hot`, `iot-archives` (Grafana data source) |
| Authorization | `downsample-task-v2` | read `iot-hot`, write `iot-archives` (the task) |
| Authorization | `homepi-dashboard via nginx (read iot-hot)` | dashboard through nginx |
| Authorization | `cli-admin` | all organization permissions; token in SOPS `influx_admin_token`, used by Ansible |
| Authorization | `homepi-operator (backup)` | operator (instance-wide), created with `influxd recovery auth create-operator` on 2026-11-10; SOPS `influx_operator_token`, on the Pi only in `/var/lib/secrets/influx-operator.token` (root 0600), used by native backups |

Measured 2026-11-08: every token found on the Pi was tested (read, write, authorizations seen).
The two CLI `default` profiles and `INFLUX_TOKEN` in `api.env` are dead (401) and their
authorizations no longer exist; nothing uses them.

The file `/etc/influxdb/tasks/downsample_iot.flux` is stale (old measurement names): the
repository holds the live script.

## Rebuild

`influx setup` creates a new operator; then recreate the buckets, the task from the repository
and one authorization per row above, put the new tokens into SOPS and apply. Data comes back from
the line-protocol export.

## Operator token (v0.1.93)

No authorization had operator rights (the setup tokens were lost), so `influx backup` failed with
`read:authorizations is unauthorized`. `influxd recovery auth create-operator` (influxd stopped,
run as influxdb) created one. A native backup keeps buckets, tasks and authorizations, so a rebuild
keeps every token; the line-protocol export stays as the portable fallback.
