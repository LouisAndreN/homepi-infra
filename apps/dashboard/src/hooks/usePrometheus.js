import { useState, useEffect, useCallback } from 'react'

const BASE = '/prom-api'

async function query(expr) {
  const r = await fetch(`${BASE}/query?` + new URLSearchParams({ query: expr }))
  if (!r.ok) throw new Error(`Prometheus ${r.status}`)
  const d = await r.json()
  return d.data?.result ?? []
}

async function queryRange(expr, start, end, step = '60s') {
  const r = await fetch(`${BASE}/query_range?` + new URLSearchParams({ query: expr, start, end, step }))
  if (!r.ok) throw new Error(`Prometheus ${r.status}`)
  const d = await r.json()
  return d.data?.result ?? []
}

export function usePromInstant(expr, interval = 10000) {
  const [value,   setValue]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const run = useCallback(async () => {
    if (!expr) return
    try {
      setValue(await query(expr))
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [expr])

  useEffect(() => {
    run()
    const t = setInterval(run, interval)
    return () => clearInterval(t)
  }, [run, interval])

  return { value, loading, error, refresh: run }
}

export function usePromRange(expr, rangeMs = 3600000, step = '60s', interval = 30000) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const run = useCallback(async () => {
    if (!expr) return
    const now   = Math.floor(Date.now() / 1000)
    const start = now - Math.floor(rangeMs / 1000)
    try {
      setData(await queryRange(expr, start, now, step))
      setError(null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [expr, rangeMs, step])

  useEffect(() => {
    run()
    const t = setInterval(run, interval)
    return () => clearInterval(t)
  }, [run, interval])

  return { data, loading, error, refresh: run }
}

export function scalar(result)      { return parseFloat(result?.[0]?.value?.[1] ?? 0) }
export function series(result, idx) { return result?.[idx]?.values?.map(v => parseFloat(v[1])) ?? [] }
export function allSeries(result) {
  return result.map(r => ({
    labels: r.metric,
    last: parseFloat(r.value?.[1] ?? 0),   // r.value, not r.values
  }))
}

export const Q = {
  cpu:        '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  cpuTemp:    'node_thermal_zone_temp{zone="0"}',
  ram:        '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
  disk:       '100 * ((node_filesystem_size_bytes{mountpoint="/"} - node_filesystem_free_bytes{mountpoint="/"}) / node_filesystem_size_bytes{mountpoint="/"})',
  nvmeTemp:   'node_hwmon_temp_celsius{chip="nvme_nvme0", sensor="temp1"}',
  uptime:     '(time() - node_boot_time_seconds) / 3600',
  load5:      'node_load5',
  netIn:      'rate(node_network_receive_bytes_total{device="eth0"}[5m])',
  netOut:     'rate(node_network_transmit_bytes_total{device="eth0"}[5m])',
  services:   'up',
  bansTotal:  'sum(cs_active_decisions)',
  bansByReason:'sum by (reason) (cs_active_decisions)',
  secServices:'node_systemd_unit_state{name=~"crowdsec.service|auditd.service|netbird.service|crowdsec-firewall-bouncer.service",state="active"}',
  bouncerCalls:'sum by (bouncer) (cs_lapi_bouncer_requests_total)',
  logsAnalyzed:'sum by (source) (cs_filesource_hits_total)',
  bansLocal:         'sum(cs_active_decisions{origin!="CAPI"} or vector(0))',
  bansCommunity:     'sum(cs_active_decisions{origin="CAPI"} or vector(0))',
  bansByReasonLocal: 'sum by (reason) (cs_active_decisions{origin!="CAPI"})',
}