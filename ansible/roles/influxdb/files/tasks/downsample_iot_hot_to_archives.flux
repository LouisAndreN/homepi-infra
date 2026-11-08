option task = {name: "downsample_iot_hot_to_archives", every: 1h, offset: 5m}

from(bucket: "iot-hot")
  |> range(start: -task.every)
  |> filter(fn: (r) => r["_measurement"] == "iot_sensors")
  |> filter(fn: (r) => contains(value: r["_field"], set: ["temperature", "humidity", "co2", "pressure", "lux", "iaq", "voc_raw", "nox_raw", "rssi"]))
  |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
  |> set(key: "downsampled", value: "true")
  |> set(key: "agg_window", value: "5m")
  |> to(bucket: "iot-archives", org: "iot-org")
