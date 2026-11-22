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

## MQTT sessions and point time (C4, 2026-11-22)

Before C4 both `mqtt_consumer` inputs subscribed with QoS 0, without a session: every message published
while Telegraf was stopped was lost (five stops of 2 to 20 minutes on 2026-11-21/22), and every
reconnection stored the retained `status` message of each device again, at the reconnection time with
a `ts` days old (6 false points a day per device).

| Input | client_id | Session | QoS | Point time |
|---|---|---|---|---|
| sensors, status, ems (`iot_sensors`) | `telegraf-sensors` | persistent | 1 | device `ts` when plausible (`homepi_time.conf`), else arrival |
| NILM (`nilm_readings`) | `telegraf-nilm` | persistent | 1 | arrival |

- Devices publish sensors and NILM with QoS 1 (homepi-firmware `sensors.c`, `nilm_bridge.c`): the
  broker queues them for the persistent session while Telegraf is down. Telegraf acknowledges a message
  only after InfluxDB accepted it, so an InfluxDB outage loses nothing either.
- Queue: the Mosquitto default, 1000 messages per client: about 2 hours of sensors, about 32 minutes of
  NILM (0.5 message/s). A longer Telegraf outage drops the oldest NILM messages. Raising
  `max_queued_messages` is a broker change (role `pki` only verifies `homepi_iot.conf`).
- Telegraf 1.40.3 subscribes again at every connection (`onConnect`), session or not: retained status
  messages still arrive at each reconnection. Timed by their own `ts`, they rewrite their original
  point instead of adding one.
- `ts` is in seconds. Two messages of one device in the same second become one point: 0.3 % of sensor
  messages; 5.7 % of NILM messages, which is why NILM keeps the arrival time. Its queued messages are
  therefore stored late by the length of the outage. Fix: a millisecond timestamp in the firmware
  (OTA, reversible), then the same processor for NILM.
- A `ts` before 2023-11-14 or more than 5 minutes ahead of the Pi clock (a device without NTP time)
  keeps the arrival time: `json_time_key` would have stored it in 1970, outside the retention.
- Readings a device buffered offline (`data_buffer_flush`, QoS 0, `buffered: true`) now land at their
  own time; as QoS 0 they are still lost if Telegraf is down at that moment.

The role's test run sets `TELEGRAF_MQTT_TEST=-test` and `TELEGRAF_MQTT_PERSISTENT=false`: another
client id and no session. With the production id it would take over the session of the running
Telegraf, and acknowledge (and drop) its queued messages.
