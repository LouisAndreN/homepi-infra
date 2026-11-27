import "date"
import "timezone"

option location = timezone.location(name: "Asia/Tokyo")

// One-shot backfill (v1.4.0): daily NILM energy for every local day still in iot-hot (30 days).
// The first day is partial (retention cuts it) and is dropped; today is written and the hourly task
// overwrites it. Run once with WRITE=1 replaced, see the runbook.
start = date.add(d: 1d, to: date.truncate(t: date.sub(d: 30d, from: now()), unit: 1d))
nilm5 = from(bucket: "iot-hot")
  |> range(start: start)
  |> filter(fn: (r) => r["_measurement"] == "nilm_readings")
  |> filter(fn: (r) => r["_field"] == "P_L1" or r["_field"] == "P_L2")
  |> group(columns: ["_field"])
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)

wh = nilm5
  |> aggregateWindow(every: 1d, fn: sum, createEmpty: false, timeSrc: "_start")
  |> group()
  |> map(fn: (r) => ({_time: r._time, _measurement: "nilm_daily", leg: r._field, _field: "wh", _value: r._value * 5.0 / 60.0}))
n5 = nilm5
  |> aggregateWindow(every: 1d, fn: count, createEmpty: false, timeSrc: "_start")
  |> group()
  |> map(fn: (r) => ({_time: r._time, _measurement: "nilm_daily", leg: r._field, _field: "n5", _value: float(v: r._value)}))

union(tables: [wh, n5])
  |> sort(columns: ["_time", "leg", "_field"])
  |> yield(name: "daily")
