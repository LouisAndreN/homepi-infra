import { useState, useEffect, useCallback } from 'react'

export function useLoki(logQL, limit = 200, rangeMs = 86400000, interval = 30000) {
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const run = useCallback(async () => {
    if (!logQL) return
    try {
      const now   = Date.now()
      const start = (now - rangeMs) * 1e6
      const end   = now * 1e6
      const params = new URLSearchParams({ query: logQL, limit, start, end, direction: 'backward' })
      const r = await fetch(`/loki-api/query_range?${params}`)
      if (!r.ok) throw new Error(`Loki ${r.status}`)
      const d = await r.json()
      const entries = (d.data?.result ?? []).flatMap(stream =>
        (stream.values ?? []).map(([ts, line]) => ({
          ts:     Math.floor(parseInt(ts) / 1e6),
          line,
          labels: stream.stream,
        }))
      ).sort((a, b) => b.ts - a.ts)
      setLogs(entries)
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [logQL, limit, rangeMs])

  useEffect(() => {
    run()
    const t = setInterval(run, interval)
    return () => clearInterval(t)
  }, [run, interval])

  return { logs, loading, error, refresh: run }
}