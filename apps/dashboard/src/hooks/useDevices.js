import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config.js'

export function useDevices(refreshInterval = 15000) {
  const [devices, setDevices]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [error,   setError]     = useState(null)
  const [lastSync, setLastSync] = useState(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API_BASE}/api/admin/devices`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setDevices(d.devices || [])
      setLastSync(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch_()
    const t = setInterval(fetch_, refreshInterval)
    return () => clearInterval(t)
  }, [fetch_, refreshInterval])

  const refresh = fetch_

  const approve = useCallback(async (deviceId) => {
    const r = await fetch(`${API_BASE}/api/admin/devices/${deviceId}/confirm`, { method: 'POST' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    await fetch_()
  }, [fetch_])

  const suspend = useCallback(async (deviceId) => {
    const r = await fetch(`${API_BASE}/api/admin/devices/${deviceId}/suspend`, { method: 'POST' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    await fetch_()
  }, [fetch_])

  // v0.1.120: no manual OTA (unsigned): updates go through rollouts of signed images

  const counts = devices.reduce((a, d) => {
    a[d.status] = (a[d.status] || 0) + 1
    return a
  }, {})

  return { devices, loading, error, lastSync, refresh, approve, suspend, counts }
}
