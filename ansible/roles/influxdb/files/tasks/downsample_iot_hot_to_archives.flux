import "date"
import "timezone"

option task = {name: "downsample_iot_hot_to_archives", every: 1h, offset: 5m}

// Local days for the daily energy (the 5 min windows below are not affected: +09:00 is whole hours)
option location = timezone.location(name: "Asia/Tokyo")

// 1) 5 min means of the environment sensors
from(bucket: "iot-hot")
  |> range(start: -task.every)
  |> filter(fn: (r) => r["_measurement"] == "iot_sensors")
  |> filter(fn: (r) => contains(value: r["_field"], set: ["temperature", "humidity", "co2", "pressure", "lux", "iaq", "voc_raw", "nox_raw", "rssi"]))
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  |> set(key: "downsampled", value: "true")
  |> set(key: "agg_window", value: "5m")
  |> to(bucket: "iot-archives", org: "iot-org")

// 2) Daily NILM energy per leg (v1.4.0): measurement nilm_daily, tag leg, fields wh (sum of the
// 5 min means x 5/60, gaps count as zero) and n5 (number of 5 min windows with data, 288 = full day).
// Recomputed every hour for the day before yesterday, yesterday and today: late points are counted
// and each run overwrites the same points (same series, same day-start timestamp).
nilm5 = from(bucket: "iot-hot")
  |> range(start: date.sub(d: 2d, from: date.truncate(t: now(), unit: 1d)))
  |> filter(fn: (r) => r["_measurement"] == "nilm_readings")
  |> filter(fn: (r) => r["_field"] == "P_L1" or r["_field"] == "P_L2")
  |> group(columns: ["_field"])
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)

nilm5
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group()
  |> map(fn: (r) => ({_time: r._time, _measurement: "nilm_daily", leg: r._field, _field: "wh", _value: r._value * 5.0 / 60.0}))
  |> to(bucket: "iot-archives", org: "iot-org", tagColumns: ["leg"])

nilm5
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false, timeSrc: "_start")
  |> group()
  |> map(fn: (r) => ({_time: r._time, _measurement: "nilm_daily", leg: r._field, _field: "n5", _value: float(v: r._value)}))
  |> to(bucket: "iot-archives", org: "iot-org", tagColumns: ["leg"])
