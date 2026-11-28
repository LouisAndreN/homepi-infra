import { useState, useEffect } from 'react'
import { API_BASE } from '../config.js'

// Declared routines (admin API). setRoutines after a save keeps every view in step without a refetch.
export function useRoutines() {
  const [routines, setRoutines] = useState([])
  useEffect(() => {
    fetch(`${API_BASE}/api/admin/routines`).then(r => r.ok ? r.json() : null).then(d => setRoutines(d?.routines || [])).catch(() => {})
  }, [])
  return [routines, setRoutines]
}
