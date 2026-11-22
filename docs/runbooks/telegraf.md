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

Before C4 both `mqtt_consumer` inputs subscribed with QoS 0, without a session: messages Telegraf had
received but not yet written were lost at each stop, every reconnection stored the retained `status`
message of each device again, at the reconnection time with a `ts` days old (6 false points a day per
device), and readings a device buffered offline were stored at their arrival time.

| Input | client_id | Session | QoS | Point time |
|---|---|---|---|---|
| sensors, status, ems (`iot_sensors`) | `telegraf-sensors` | persistent | 1 | device `ts` when plausible (`homepi_time.conf`), else arrival |
| NILM (`nilm_readings`) | `telegraf-nilm` | persistent | 1 | arrival |

- Devices publish sensors and NILM with QoS 1 (homepi-firmware `sensors.c`, `nilm_bridge.c`).
  Telegraf acknowledges a message only after InfluxDB accepted it: messages in flight when Telegraf or
  InfluxDB stops are delivered again (proven 2026-11-22: five NILM points measured before a stop were
  stored at the restart).
- What is published while Telegraf is away is NOT queued. Proven on the production binary: mosquitto
  2.0.18 with `per_listener_settings true` queued 0 of 20 messages for an offline durable client in a
  throwaway broker, 20 of 20 without that option (`ansible/roles/pki/tests/broker-config-test`; upstream
  fix in 2.0.23, "Fix handling of disconnected sessions for per_listener_settings true"). Ubuntu 24.04
  ships 2.0.18, 26.04 ships 2.0.22.
- Kept on purpose (C4 decision): dropping `per_listener_settings` would let a certificate named like a
  service account (`homepi-api`) command every device over 8883; Docker for a newer broker would move
  mTLS, CRL and ACL sync into a container. Both cost more than the gap they close: Telegraf stops while
  the broker runs only when its configuration changes (a restart, about a second). The long outages
  measured on 2026-11-21/22 were whole-Pi stops, when the broker was down too: those are covered by the
  devices' offline buffer, which the time processor now stores at the right time.
- Revisit when the Ubuntu package reaches 2.0.23: run `broker-config-test` on the production
  configuration; a PASS on check 4 means the session also covers Telegraf restarts.
- Telegraf 1.40.3 subscribes again at every connection (`onConnect`), session or not: retained status
  messages still arrive at each reconnection. Timed by their own `ts`, they rewrite their original
  point instead of adding one.
- `ts` is in seconds. Two messages of one device in the same second become one point: 0.3 % of sensor
  messages; 5.7 % of NILM messages, which is why NILM keeps the arrival time (redelivered messages are
  stored a few seconds late). Fix: a millisecond timestamp in the firmware
  (OTA, reversible), then the same processor for NILM.
- A `ts` before 2023-11-14 or more than 5 minutes ahead of the Pi clock (a device without NTP time)
  keeps the arrival time: `json_time_key` would have stored it in 1970, outside the retention.
- Readings a device buffered offline (`data_buffer_flush`, QoS 0, `buffered: true`) now land at their
  own time; as QoS 0 they are still lost if Telegraf is down at that moment.

The role's test run works on a copy in `/run` where `client_id` gets `-test` and `persistent_session`
is `false`. With the production id it would take over the session of the running Telegraf, and
acknowledge (and drop) its queued messages. Environment variables cannot do this: since Telegraf 1.38
they are substituted inside strings only (strict handling), so `persistent_session = ${...}` is not
valid TOML; the first attempt failed exactly so in the C4 preflight.
