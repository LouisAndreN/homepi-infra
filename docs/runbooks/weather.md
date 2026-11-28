# Weather at home (v1.6.0)

Hourly weather for the Energy tab: icons per day (week chart, month and year calendars), weather by hour,
sunrise and sunset on the cumulative chart.

## Data path

`/usr/local/sbin/homepi-weather` (role telegraf) is run by Telegraf `inputs.exec` every 15 min, as the
`telegraf` user. It calls Open-Meteo over HTTPS (no key; CC BY 4.0, credited in the dashboard) for the
2 previous days and today, and prints line protocol. Telegraf writes it to `iot-hot`; the hourly task
`downsample_iot_hot_to_archives` (part 3) copies the last 3 days to `iot-archives` (8760 h).

| Measurement | Point | Fields |
|---|---|---|
| `weather` | one per hour that has started (no forecast) | `code` (WMO), `temp` (°C), `precip` (mm), `cloud` (%), `is_day` |
| `weather_daily` | one per local day, 00:00 Asia/Tokyo | `sunrise`, `sunset` (Unix seconds) |

Tag `source=open-meteo`. Each run rewrites the recent hours at the same timestamps: the model analysis
of an hour converges in place, and the archive copy overwrites the same points.

## Location

`ansible/secrets/weather.sops.yaml`, keys `weather_lat` and `weather_lon` (decimal degrees). The role
checks they are plain numbers and writes them to `/var/lib/secrets/telegraf.env` (root, 0600, read by
systemd). The script rounds them to 2 decimals (about 1 km) before any request. They are never in the
repository, in the data or in a log line (a failed request names `LAT`/`LON`, not the values).

Create it once, on the laptop, before the release that adds the role change:

```bash
cd ~/homepi-infra
printf 'weather_lat: "35.68"\nweather_lon: "139.77"\n' > ansible/secrets/weather.sops.yaml \
  && sops --encrypt --in-place ansible/secrets/weather.sops.yaml \
  && sops -d ansible/secrets/weather.sops.yaml
```

Without this file the run fails at the SOPS lookup (precheck), the release is held, nothing changes.

## Checks

```bash
# Telegraf runs it without error (an Open-Meteo outage shows here as "fetch failed", retried every 15 min)
sudo journalctl -u telegraf --since "-1h" | grep -i weather
# Latest hours in iot-hot (operator token)
sudo bash -c 'INFLUX_TOKEN=$(cat /var/lib/secrets/influx-operator.token) influx query --host http://127.0.0.1:8086 --org iot-org \
  "from(bucket: \"iot-hot\") |> range(start: -3h) |> filter(fn: (r) => r._measurement == \"weather\" and r._field == \"code\")"'
```

## Backfill (once, after the upgrade)

The year calendar has weather only from the release on. Past days come from the Open-Meteo historical
forecast archive (same models as the live API), written straight into `iot-archives`:

```bash
# 1. Line protocol for the past year up to 3 days ago (the live collector covers the rest). Dry run: count and look.
END=$(date -d '-3 days' +%F); START=$(date -d '-365 days' +%F)
sudo env $(sudo grep '^HOMEPI_WEATHER_' /var/lib/secrets/telegraf.env | xargs) \
  /usr/local/sbin/homepi-weather --backfill "$START" "$END" > /tmp/weather-backfill.lp
wc -l /tmp/weather-backfill.lp; head -3 /tmp/weather-backfill.lp; grep -c '^weather_daily' /tmp/weather-backfill.lp
# 2. Write (admin token from its file, never on the command line)
sudo bash -c 'INFLUX_TOKEN=$(cat /var/lib/secrets/influx-admin.token) influx write --host http://127.0.0.1:8086 \
  --org iot-org --bucket iot-archives --precision ns --file /tmp/weather-backfill.lp' && rm /tmp/weather-backfill.lp
```

Expect about 24 lines per day plus one `weather_daily` per day. Running it twice is harmless (same points).

## Limits

- Model weather, not a station at home: a short local shower can be missed, and the code of an hour is
  the model's (Open-Meteo "best match", JMA models for Japan).
- Backups: the nightly line-protocol export covers both measurements.
