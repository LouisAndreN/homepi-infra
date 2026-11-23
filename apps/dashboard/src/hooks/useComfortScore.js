import { useMemo } from 'react'
import { useFlux, FLUX } from './useInflux.js'
import { comfortScorePct, compositeExcess } from './thresholds.js'
import { detectZones, assignSensorsToZones } from '../editor/zoneDetection.js'

// Groups the CSV rows by rounded timestamp (aggregation bucket), averages
// all devices together for each metric at that instant: approximates
// "the average state of the flat" at that moment. Accepted simplification: it does not
// distinguish rooms; a future refinement could weight by the device
// most representative of a zone rather than a flat average.
function groupByTimestamp(rows) {
  const byTs = {}
  for (const r of rows) {
    if (!r._time || !r._field || r._value === '') continue
    const ts = r._time
    if (!byTs[ts]) byTs[ts] = {}
    if (!byTs[ts][r._field]) byTs[ts][r._field] = []
    const v = parseFloat(r._value)
    if (!isNaN(v)) byTs[ts][r._field].push(v)
  }
  return Object.entries(byTs).map(([ts, fields]) => {
    const valuesByMetric = {}
    for (const f in fields) valuesByMetric[f] = fields[f].reduce((a,b)=>a+b,0)/fields[f].length
    return { t: new Date(ts).getTime(), valuesByMetric }
  }).sort((a,b)=>a.t-b.t)
}

// Composite comfort score over a sliding window: % of the time when all
// comfort metrics are within their acceptable zone at once.
export function useComfortScore(start='-24h', every='10m', interval=60000) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(start, every), interval)
  const points = useMemo(() => groupByTimestamp(data ?? []), [data])
  const score = useMemo(() => comfortScorePct(points), [points])
  return { score, points, loading }
}

// Daily aggregation: one score value per day over the last N
// days. Needed for the monthly chart: the raw metric smoothed over 30
// days says nothing (day/night cycles drown everything), whereas the daily aggregate of the
// composite score shows a real trend.
export function useComfortScoreDaily(days=30) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(`-${days}d`, '15m', 300000), 300000)
  const daily = useMemo(() => {
    const points = groupByTimestamp(data ?? [])
    const byDay = {}
    for (const p of points) {
      const dayKey = new Date(p.t).toISOString().slice(0,10)
      if (!byDay[dayKey]) byDay[dayKey] = []
      byDay[dayKey].push(p)
    }
    return Object.entries(byDay).map(([day, pts]) => ({
      day,
      t: new Date(day).getTime(),
      score: comfortScorePct(pts),
      // Standard deviation of the day's excesses: gives an idea of the within-day stability,
      // can be drawn as a band around the main line.
      stdExcess: (() => {
        const excesses = pts.map(p=>compositeExcess(p.valuesByMetric)).filter(e=>e!=null)
        if (excesses.length < 2) return null
        const mean = excesses.reduce((a,b)=>a+b,0)/excesses.length
        const variance = excesses.reduce((a,b)=>a+(b-mean)**2,0)/excesses.length
        return Math.sqrt(variance)
      })(),
    })).sort((a,b)=>a.t-b.t)
  }, [data])
  return { daily, loading }
}

// Comfort score filtered on the devices of a given zone. zoneDeviceIds:
// list of device_id belonging to the zone (computed once via
// assignSensorsToZones, passed as a stable dependency, not recomputed here).
export function useComfortScoreForZone(zoneDeviceIds, start='-24h', every='10m', interval=60000) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(start, every), interval)
  const points = useMemo(() => {
    const filtered = (data ?? []).filter(r => zoneDeviceIds.includes(r.device_id))
    return groupByTimestamp(filtered)
  }, [data, zoneDeviceIds])
  const score = useMemo(() => comfortScorePct(points), [points])
  return { score, points, loading }
}