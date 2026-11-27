import { useState, useEffect, useCallback } from 'react'
import { ENERGY } from '../config.js'

const INFLUX_ORG   = 'iot-org'
const BASE         = '/influx'  // nginx adds the read-only token (v0.1.61)

// Splits ONE CSV line while respecting quoted fields (RFC 4180):
// a comma inside a pair of quotes ("bme688,bh1750") must
// NOT be treated as a column separator. A naive split(',') shifts all
// following columns as soon as a field such as active_sensors contains an
// inner comma, which corrupted device_id (e.g. it literally became
// bh1750" with the stray quote) and merged two distinct physical devices
// under a single key in byDevice downstream.
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        // Doubled quote inside a quoted field = escaped literal quote
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// Parses the InfluxDB CSV response: handles several annotated blocks in one response.
// A grouped query (e.g. group(columns:["device_id","_field"])) can produce
// tables with different columns; InfluxDB then repeats a header line
// (",result,table,...") at the start of each new block. We adopt this new header
// every time we meet it, whether it is the very first block or a later
// block with different columns.
function parseCSV(csv) {
  if (!csv?.trim()) return []
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  if (lines.length < 2) return []

  const isHeaderLine = l => l.startsWith(',result,') || l.startsWith('result,')
  const rows = []
  let headers = null

  for (const line of lines) {
    if (isHeaderLine(line)) {
      headers = splitCsvLine(line).map(h => h.trim())
      continue
    }
    if (!headers) continue // data row before any known header: should not happen, but we skip it rather than guess
    const vals = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() ?? '' })
    rows.push(row)
  }

  return rows.filter(r => r._value !== '' && r._value !== undefined)
}

export async function fluxQuery(flux) {
  const r = await fetch(`${BASE}/api/v2/query?org=${INFLUX_ORG}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/vnd.flux',
      'Accept':        'application/csv',
    },
    body: flux.trim(),
  })
  if (!r.ok) throw new Error(`InfluxDB ${r.status}`)
  return parseCSV(await r.text())
}

export function useFlux(flux, interval = 15000) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const run = useCallback(async () => {
    if (!flux) return
    try {
      const res = await fluxQuery(flux)
      setData(res)
      setError(null)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }, [flux])

  useEffect(() => {
    run()
    const t = setInterval(run, interval)
    return () => clearInterval(t)
  }, [run, interval])

  return { data, loading, error, refresh: run }
}

// Flux queries used by the tabs
export const FLUX = {
  // Presence of NILM readings (count per window), for gap detection. rssi exists in every bridge
  // message whatever the firmware version.
  nilmPresence: (start, every, bucket = ENERGY.bucket) => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._measurement == "${ENERGY.measurement}" and r._field == "rssi")
  |> group()
  |> aggregateWindow(every: ${every}, fn: count, createEmpty: false)
  |> keep(columns: ["_time", "_value"])`,

  // Platform events (MQTT iot/<id>/event -> Telegraf -> homepi_events): Teensy updates, OTA, captures
  homepiEvents: (start, bucket = ENERGY.bucket) => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._measurement == "homepi_events")
  |> keep(columns: ["_time", "_field", "_value", "kind", "device_id"])`,

  // Power from the NILM bridge, one series per configured leg (total and per-circuit views).
  // every=null returns raw samples (~1 Hz); otherwise window means stamped at the
  // window START (timeSrc), so a window is attributed to the day it belongs to.
  // start/stop are Flux expressions: '-2m', 'now()', 'time(v: "...")'.
  nilmPower: (start, stop, every, bucket = ENERGY.bucket) => `
from(bucket: "${bucket}")
  |> range(start: ${start}, stop: ${stop})
  |> filter(fn: (r) => r._measurement == "${ENERGY.measurement}")
  |> filter(fn: (r) => ${ENERGY.legs.map(l => `r._field == "${l.field}"`).join(' or ')})
  |> group(columns: ["_field"])${every ? `
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false, timeSrc: "_start")` : ''}
  |> keep(columns: ["_time", "_field", "_value"])`,

  lastByDevice: (field, bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._field == "${field}")
  |> last()
  |> group(columns: ["device_id"])`,

  history: (field, start = '-1h', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)`,

  allLast: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) =>
      r._field == "temperature" or
      r._field == "humidity" or
      r._field == "co2" or
      r._field == "lux" or
      r._field == "iaq" or
      r._field == "pressure")
  |> last()
  |> group(columns: ["device_id", "_field"])`,

  // Last point seen per device, all fields together: feeds the real-time "Live"
  // badge (FleetTab / DeviceDetailModal).
  lastSeenAll: (start = '-10m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) =>
      r._field == "temperature" or
      r._field == "humidity" or
      r._field == "co2" or
      r._field == "lux" or
      r._field == "iaq" or
      r._field == "pressure")
  |> group(columns: ["device_id"])
  |> last()
  |> keep(columns: ["device_id", "_time", "_field", "_value"])`,

  // Presence/absence segments over a window: feed the timeline bar
  // of DeviceDetailModal. createEmpty:true is CRITICAL: without it Flux drops the
  // empty buckets and the connectivity gap disappears silently.
  presenceWindow: (deviceId, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r.device_id == "${deviceId}")
  |> filter(fn: (r) => r._field == "temperature" or r._field == "co2" or r._field == "humidity")
  |> aggregateWindow(every: ${every}, fn: count, createEmpty: true)
  |> keep(columns: ["_time", "_value"])`,

  // CO2 trend
  co2Trend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "co2")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Temperature trend
  tempTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "temperature")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Humidity trend
  humidityTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "humidity")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Light trend
  luxTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "lux")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // History of any metric, grouped by device_id: used by the timeline
  // bar of the plan (FloorPlanEditor, heatmap scrubber) and by SensorsTab/DeviceDetailModal.
  metricHistory: (field, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> group(columns: ["device_id"])`,

  // History of ALL available metrics for ONE device in a single query:
  // feeds the combined normalised chart of the FloorPlanEditor detail panel. One
  // query rather than one per metric: avoids calling useFlux() a variable number of
  // times depending on the clicked sensor (it would break the rules of hooks).
  metricsHistoryForDevice: (deviceId, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r.device_id == "${deviceId}")
  |> filter(fn: (r) =>
      r._field == "temperature" or r._field == "humidity" or
      r._field == "co2" or r._field == "lux" or
      r._field == "iaq" or r._field == "pressure")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value"])`,

  // Humidity 24h
  humidity24h: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._field == "humidity")
  |> aggregateWindow(every: 15m, fn: mean, createEmpty: false)`,

  // Comfort index (simplified ASHRAE 55, as in the Grafana dashboard)
  comfort: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
  |> last()
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> map(fn: (r) => ({
    r with comfort:
      if r.temperature < 20.0 then 95.0
      else if r.temperature < 22.0 then 85.0
      else if r.temperature < 26.0 then 70.0
      else 40.0
  }))
  |> keep(columns: ["_time", "device_id", "comfort"])`,

  // Status devices (last seen)
  deviceStatus: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "device_status")
  |> filter(fn: (r) => r._field == "rssi")
  |> last()
  |> group(columns: ["device_id"])`,


  // Multi-metric history of ALL DEVICES together over a window: used for the
  // temporal composite comfort score (comfortScorePct). Unlike
  // metricsHistoryForDevice (a single device), this one brings the whole flat:
  // the composite score must reflect the global state, not one sensor.
  allMetricsHistory: (start='-24h', every='10m', bucket='iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) =>
      r._field == "temperature" or r._field == "humidity" or
      r._field == "co2" or r._field == "iaq")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value", "device_id"])`,
}