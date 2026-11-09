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
