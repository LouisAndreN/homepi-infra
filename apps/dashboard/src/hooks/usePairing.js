import { useState, useRef, useEffect, useCallback } from 'react'
import { API_BASE, PAIRING_TTL } from '../config.js'

export function usePairing(onSuccess) {
  const [phase,     setPhase]     = useState('idle')
  const [remaining, setRemaining] = useState(PAIRING_TTL)
  const [device,    setDevice]    = useState(null)
  const [error,     setError]     = useState('')
  const esRef = useRef(null)

  const cleanup = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  const open = useCallback(async () => {
    setPhase('opening'); setError('')
    try {
      const r = await fetch(`${API_BASE}/api/admin/pairing/open`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setRemaining(d.ttl)
      setPhase('waiting')

      const es = new EventSource(`${API_BASE}/api/admin/pairing/stream/${d.session_id}`)
      esRef.current = es

      es.onmessage = e => {
        const data = JSON.parse(e.data)
        if (data.event === 'heartbeat')   setRemaining(data.remaining)
        if (data.event === 'device_seen') { setDevice(data); setPhase('seen'); cleanup() }
        if (data.event === 'expired')     { setPhase('expired'); cleanup() }
      }
      es.onerror = () => { setPhase('expired'); cleanup() }
    } catch(e) {
      setError(e.message); setPhase('idle')
    }
  }, [cleanup])

  const confirm = useCallback(async () => {
    if (!device) return
    setPhase('confirming')
    try {
      const r = await fetch(`${API_BASE}/api/admin/devices/${device.device_id}/confirm`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPhase('done')
      if (onSuccess) onSuccess()
    } catch(e) {
      setError(e.message); setPhase('seen')
    }
  }, [device, onSuccess])

  const cancel = useCallback(() => {
    cleanup()
    setPhase('idle')
    setDevice(null)
    setError('')
  }, [cleanup])

  const reset = useCallback(() => {
    cancel()
  }, [cancel])

  return { phase, remaining, device, error, open, confirm, cancel, reset }
}
