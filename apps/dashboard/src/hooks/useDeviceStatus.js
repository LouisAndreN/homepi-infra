import { useMemo } from 'react'
import { useFlux, FLUX } from './useInflux.js'

const LIVE_THRESHOLD_MS = 90000 // 3× l'intervalle de publication (30s)

export function useDeviceLiveStatus() {
  const { data, loading, error } = useFlux(FLUX.allLast(), 20000)
  const byDevice = useMemo(() => {
    const out = {}
    for (const row of data ?? []) {
      if (!row.device_id || !row._time) continue
      const t = new Date(row._time).getTime()
      if (!out[row.device_id] || t > out[row.device_id]) out[row.device_id] = t
    }
    const now = Date.now()
    return Object.fromEntries(
      Object.entries(out).map(([id, t]) => [id, { lastSeen: t, isLive: now - t < LIVE_THRESHOLD_MS }])
    )
  }, [data])
  return { byDevice, loading, error }
}

export function usePresenceWindow(deviceId, rangeKey = 'h24') {
  const cfg = { h24:{start:'-24h',every:'5m'}, d7:{start:'-7d',every:'1h'}, d30:{start:'-30d',every:'6h'} }[rangeKey]
  const { data, loading } = useFlux(deviceId ? FLUX.presenceWindow(deviceId, cfg.start, cfg.every) : null, 60000)
  const segments = (data ?? []).map(r => ({
    t: new Date(r._time).getTime(),
    connected: parseFloat(r._value) > 0,
  }))
  return { segments, loading }
}