import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../config.js'
import { resolveLegs } from '../energy/legs.js'

// NILM calibration (on the Pi) -> the legs to sum. Shared by Energy and Sensors (Timeline).
export function useNilmLegs() {
  const [calibration, setCalibration] = useState(null)
  const [error, setError] = useState(null)
  async function reload() {
    try {
      const r = await fetch(`${API_BASE}/api/admin/nilm/calibration`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setCalibration(await r.json()); setError(null)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { reload() }, [])
  const legs = useMemo(() => resolveLegs(calibration), [calibration])
  return { legs, calibration, setCalibration, error, reload }
}
