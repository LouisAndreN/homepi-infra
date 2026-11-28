# Weather at home (v1.6.0, JMA AMeDAS since v1.6.1)

Hourly weather for the Energy tab: icons per day (week chart, month and year calendars), weather by hour,
sunrise and sunset on the cumulative chart.

## Privacy: nothing about the location leaves the Pi

Like the local DNS resolver, the Pi asks only questions that are the same for everyone, and answers the
local question itself:

- `https://www.jma.go.jp/bosai/amedas/const/amedastable.json`: the national station table (once a day);
- `https://www.jma.go.jp/bosai/amedas/data/latest_time.txt`: the latest observation time;
- `https://www.jma.go.jp/bosai/amedas/data/map/YYYYMMDDHHMMSS.json`: every AMeDAS station of Japan at one time.

The nearest stations are chosen on the Pi from the location in SOPS. Sunrise and sunset are computed on
the Pi (NOAA solar position, about a minute), with no request. JMA sees the Pi's IP asking for national
files, as any visitor of its website does. These JSON files feed JMA's own web pages: they are not a
documented API and can change without notice (the collector then logs an error and the dashboard says
"No weather data"). Source shown in the dashboard: 出典: 気象庁 (Government of Japan Standard Terms of Use).

## Data path

`/usr/local/sbin/homepi-weather` (role telegraf) is run by Telegraf `inputs.exec` every 15 min, as the
`telegraf` user. A state file (`/var/lib/homepi/weather/state.json`: last hour written, station table of
the day) keeps a run to one file or none; after an outage it catches up the last 24 hours. Telegraf writes
to `iot-hot`; the hourly task `downsample_iot_hot_to_archives` (part 3) copies the last 3 days to
`iot-archives` (8760 h).

| Measurement | Point | Fields |
|---|---|---|
| `weather` (tag `source=jma-amedas`) | one per hour, stamped at the hour start | `precip` (mm in the hour), `sun` (hours of sunshine in the hour), `temp` (°C at the hour end), `is_day` (≥ 30 min of daylight), `dist_km` (farthest station used), `code` (WMO, derived) |
| `weather_daily` (tag `source=local`) | one per local day, 00:00 Asia/Tokyo | `sunrise`, `sunset` (Unix seconds) |

Each element comes from the nearest station that measured it that hour (within 40 km): about 1,300
stations measure precipitation, about 840 also temperature; sunshine is measured at fewer stations.

## Local archive of the national files

Every national file the collector fetches is also kept, gzipped and unchanged:
`/var/lib/homepi/weather/amedas/YYYY/MM/DDHH.json.gz` (one per hour), plus `tables/amedastable-YYYYMMDD-<hash>.json.gz`
each time the station table changes (stations move or close: an old file is read with the table of its time).
JMA keeps these files only a few days; the archive lets the weather be recomputed later (a better rule,
more fields such as humidity or wind, another location after a move) with no request at all:

```bash
sudo env $(sudo grep '^HOMEPI_WEATHER_' /var/lib/secrets/telegraf.env | xargs) \
  /usr/local/sbin/homepi-weather --reprocess 2026-12-01 2026-12-31 > /tmp/weather-reprocess.lp
```

Size: estimated at a few hundred MB a year (about 1,300 stations per hour, gzip); measure it after a week
with `sudo du -sh /var/lib/homepi/weather/amedas`. It is excluded from the nightly state backup (it would
grow every backup): the derived points are in InfluxDB and covered by its backups; the raw archive is a
bonus that a disk loss would take with it. A write error (full disk) is logged and never stops the weather.

## Weather code (derived from observations)

- Precipitation ≥ 0.5 mm in the hour (gauge resolution): rain (61/63/65 by intensity), or snow (71/73/75)
  at 1.5 °C or below. A rule of thumb: sleet near the threshold can go either way.
- Dry, with at least 30 min of daylight: sunshine over the daylight part of the hour: ≥ 70 % clear,
  ≥ 20 % partly cloudy, otherwise cloudy.
- Dry at night: no code. Cloud cover is not observed, so nothing is claimed; the dashboard shows no icon,
  and the tooltip says "Dry (night: cloud cover not observed)".
- Not observable at all: fog, drizzle, thunderstorms.

## Release steps when the task Flux changes

The influxdb role only checks the downsample task (`homepi-influx-check`): it never rewrites it. A release
that changes `downsample_iot_hot_to_archives.flux` needs the live task updated first, or its precheck fails
with `flux DIFFERENT` (what held v1.6.0 at first). With the new file in the repository:

```bash
# laptop
scp ansible/roles/influxdb/files/tasks/downsample_iot_hot_to_archives.flux homepi:/tmp/downsample.flux
# on the Pi (ssh homepi), as root (sudo -i)
export INFLUX_TOKEN=$(cat /var/lib/secrets/influx-admin.token) INFLUX_HOST=http://127.0.0.1:8086 INFLUX_ORG=iot-org
TID=$(influx task list --json | python3 -c 'import json,sys; print(next(t["id"] for t in json.load(sys.stdin) if t["name"]=="downsample_iot_hot_to_archives"))')
influx task update --id "$TID" --file /tmp/downsample.flux > /dev/null
influx task list --json | python3 -c 'import json,sys; t=next(t for t in json.load(sys.stdin) if t["name"]=="downsample_iot_hot_to_archives"); print("identical" if t["flux"].strip()==open("/tmp/downsample.flux").read().strip() else "DIFFERENT")'
rm /tmp/downsample.flux; exit
```

## Location

`ansible/secrets/weather.sops.yaml`, keys `weather_lat` and `weather_lon` (decimal degrees). The role
checks they are plain numbers and writes them to `/var/lib/secrets/telegraf.env` (root, 0600, read by
systemd). The script refuses a location outside Japan (AMeDAS covers Japan only).

```bash
cd ~/homepi-infra
printf 'weather_lat: "35.68"\nweather_lon: "139.77"\n' > ansible/secrets/weather.sops.yaml \
  && sops --encrypt --in-place ansible/secrets/weather.sops.yaml \
  && sops -d ansible/secrets/weather.sops.yaml
```

Without this file the run fails at the SOPS lookup (precheck), the release is held, nothing changes
(what happened to v1.6.0).

## Checks

```bash
sudo journalctl -u telegraf --since "-1h" | grep -i weather          # errors only; silence is good
sudo cat /var/lib/homepi/weather/state.json | python3 -c 'import json,sys,datetime as d; s=json.load(sys.stdin); print("last hour end", d.datetime.fromtimestamp(s["last_end"]), "table", s["table_day"])'
sudo bash -c 'INFLUX_TOKEN=$(cat /var/lib/secrets/influx-operator.token) influx query --host http://127.0.0.1:8086 --org iot-org \
  "from(bucket: \"iot-hot\") |> range(start: -6h) |> filter(fn: (r) => r._measurement == \"weather\") |> last()"'
```

## Backfill (once, after the upgrade)

JMA keeps the national files only for a short time (days, not months): the backfill fills what is still
served and reports how many hours were not. Older days cannot be backfilled privately: the per-station
history would tell JMA which station (an area of about 15 km) is asked for, so it is not done.

```bash
END=$(date -d '-1 day' +%F); START=$(date -d '-14 days' +%F)
sudo env $(sudo grep '^HOMEPI_WEATHER_' /var/lib/secrets/telegraf.env | xargs) \
  /usr/local/sbin/homepi-weather --backfill "$START" "$END" > /tmp/weather-backfill.lp
wc -l /tmp/weather-backfill.lp; head -3 /tmp/weather-backfill.lp
sudo bash -c 'INFLUX_TOKEN=$(cat /var/lib/secrets/influx-admin.token) influx write --host http://127.0.0.1:8086 \
  --org iot-org --bucket iot-archives --precision ns --file /tmp/weather-backfill.lp' && rm /tmp/weather-backfill.lp
```

Running it twice is harmless (same points).

## Limits

- Stations are 5 to 20 km away: a local shower can be missed or seen where it did not fall at home.
- Sunshine-based kinds exist in daytime only; the night shows rain or snow, nothing else.
- Backups: the nightly line-protocol export covers both measurements.
