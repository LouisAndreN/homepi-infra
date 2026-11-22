# Telegraf

Telegraf 1.38 bridges MQTT to InfluxDB. `telegraf.conf` is empty on purpose: the agent runs on
defaults and the only configuration is `telegraf.d/` (role `telegraf`).

| File | Content |
|---|---|
| `telegraf.d/homepi_mqtt.conf` | `iot/+/sensors`, `iot/+/status`, `iot/+/ems` -> `iot_sensors`; the InfluxDB v2 output (`iot-hot`) |
| `telegraf.d/nilm.conf` | `iot/+/nilm` -> `nilm_readings` (same output) |
| `/var/lib/secrets/telegraf.env` | `TELEGRAF_MQTT_PASSWORD`, `TELEGRAF_INFLUX_TOKEN` (root 0600, from SOPS) |
| `telegraf.service.d/secrets.conf` | loads the file above |
| `telegraf.service.d/20-after-mosquitto.conf` | ordering (role `service_ordering`) |

Credentials:
- MQTT user `telegraf-bridge`, read only on `iot/#` (`services.acl`), listener 127.0.0.1:1883.
  Password in SOPS `pki.sops.yaml: mqtt_telegraf_password`; the broker hash is written by
  `homepi-mqtt-passwd` (stdin only, verifies before rewriting).
- InfluxDB token `telegraf-write` (write `iot-hot`), SOPS `influx.sops.yaml: influx_telegraf_token`.

Until v0.1.79 Telegraf loaded `/etc/homepi/api.env`, which put the homepi-api MQTT password
(write on `iot/#` and `homepi/#`, i.e. device commands) into a process that parses device
payloads. The telegraf-bridge password was also in a world-readable file; it was rotated.

## Rotate the MQTT password

`sops set` a new `mqtt_telegraf_password`, release, apply. The role rewrites the broker hash,
reloads Mosquitto, runs a Telegraf test connection with the new configuration, then restarts it.

## Alerts on the write path (pipeline.yml)

`DeviceSilent` reads the device API, a separate MQTT subscriber: it says a device publishes, not
that its data is stored. Two rules watch InfluxDB's own write counter
(`http_api_requests_total{path="/api/v2/write"}`, scraped by the `influxdb` job):

| Alert | Fires when | First checks |
|---|---|---|
| `InfluxWritesStopped` (critical) | no write from Telegraf accepted for 10 minutes, for 15 minutes (also when the series is absent) | `systemctl status telegraf`, `homepi-telegraf-check`, `df -h /var/lib/influxdb` |
| `InfluxWritesRejected` (warning) | any 4XX or 5XX on `/api/v2/write` for 10 minutes | 401/403: the `telegraf-write` token (SOPS `influx_telegraf_token`); 5XX: `journalctl -u influxdb` |

Unit tests: `cd ansible/roles/observability_core/files/prometheus/tests && promtool test rules pipeline_test.yml`.

## Known gap: messages lost while Telegraf restarts (C4, open)

Both `mqtt_consumer` inputs subscribe with `qos = 0`, without `persistent_session` and without a
`client_id`. The broker keeps nothing for such a client: every message published while Telegraf is
stopped or reconnecting is lost, before any backup can see it. Measured 2026-11-21/22: five Telegraf
stops, from 2 to 20 minutes. The output buffer (10 000 points, in memory) only covers InfluxDB being
down while Telegraf runs (the Sunday export, 04:18: no loss).

A fix needs all of: a distinct `client_id` per input (they share the `telegraf-bridge` account),
`persistent_session = true` and `qos = 1`; a broker queue that holds about 20 minutes (QoS 0
publishers need `queue_qos0_messages`, or the devices publish with QoS 1); and the device `ts` field as
the point time (`json_time_key`), or late messages are stored at their arrival time.
