import { useState, useEffect, useCallback, useMemo } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { useDeviceLiveStatus } from '../hooks/useDeviceStatus.js'
import { statusColorForValue } from '../hooks/thresholds.js'
import { DeviceDetailModal } from '../components/DeviceDetailModal.jsx'

const API         = ''

function timeSince(iso) {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso)) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s/60)}m ago`
  if (s < 86400) return `${Math.round(s/3600)}h ago`
  return `${Math.round(s/86400)}d ago`
}

function certDaysLeft(certExpiry) {
  if (!certExpiry) return null
  const expiry = new Date(certExpiry)
  if (isNaN(expiry)) return null
  return Math.floor((expiry - Date.now()) / 86400000)
}

const STATUS_META = {
  active:         { label:'Active',    bg:'color-mix(in srgb, var(--ok) 15%, transparent)',     color:'var(--ok)' },
  seen:           { label:'Seen',      bg:'color-mix(in srgb, var(--accent-vivid) 15%, transparent)', color:'var(--accent-vivid)' },
  suspended:      { label:'Suspended', bg:'color-mix(in srgb, var(--danger) 15%, transparent)',  color:'var(--danger)' },
  pre_registered: { label:'Pre-reg',   bg:'color-mix(in srgb, var(--info) 15%, transparent)',    color:'var(--info)' },
  bootstrapped:   { label:'Bootstrap', bg:'color-mix(in srgb, var(--warn) 15%, transparent)',    color:'var(--warn)' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || {
    label:status, bg:'rgba(128,128,128,.15)', color:'var(--text2)'
  }
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'2px var(--sp-2)', borderRadius:99, fontSize:'var(--fs-2xs)',
      fontWeight:700, background:m.bg, color:m.color,
      textTransform:'uppercase', letterSpacing:'.04em'
    }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:m.color, flexShrink:0 }}/>
      {m.label}
    </span>
  )
}

// ── Real-time metric chips: one per field available for this device.
// Colour AND thresholds derived from hooks/thresholds.js, closed outline (solid border,
// no dash). Turns grey if the device is silent (isLive=false): a
// stale value must never show a misleading status colour.
const METRIC_KEYS = ['temperature','humidity','co2','lux','iaq','pressure']

function MetricPills({ readings, isLive }) {
  const present = METRIC_KEYS.filter(m => readings?.[m] != null && readings[m] !== '')
  if (!present.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
      {present.map(m => {
        const val = parseFloat(readings[m])
        const color = isLive ? statusColorForValue(m, val) : 'var(--text3)'
        return (
          <div key={m} title={`${m}: ${val}${isLive ? '' : ' (stale)'}`} style={{
            width:22, height:22, borderRadius:'50%',
            border:`2px solid ${color}`, background:'var(--bg2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:8, fontFamily:'var(--mono)', fontWeight:700, color,
            flexShrink:0,
          }}>
            {m.slice(0,2).toUpperCase()}
          </div>
        )
      })}
    </div>
  )
}

// ── OTA (v0.1.120) ────────────────────────────────────────────
// An OTA command only comes from a rollout of a signed image: images are signed on the operator's
// laptop (homepi-firmware tools/ota-sign.sh) and uploaded from there. The dashboard starts, follows
// and aborts rollouts; it never sends a URL and a checksum to a device.
function OTAInfo({ device }) {
  return (
    <div style={{ borderTop:'0.5px solid var(--border)', paddingTop:14, marginTop:14,
                  fontSize:11, color:'var(--text3)' }}>
      <div style={{ fontSize:9, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>OTA</div>
      Project <span style={{ fontFamily:'monospace', color:'var(--text2)' }}>{device.project || 'unknown'}</span>
      {' · '}firmware <span style={{ fontFamily:'monospace', color:'var(--text2)' }}>{device.fw_version || '?'}</span>
      <div style={{ marginTop:4 }}>Updates go through a rollout of a signed image (Deployments).</div>
    </div>
  )
}

const ROLLOUT_COLOR = {
  in_progress:'var(--warn)', success:'var(--ok)', aborted:'var(--danger)',
  pending:'var(--text3)', sent:'var(--warn)', confirmed:'var(--ok)', failed:'var(--danger)',
}

function RolloutPanel({ onBack }) {
  const [firmware, setFirmware] = useState([])
  const [rollouts, setRollouts] = useState([])
  const [busy,     setBusy]     = useState(false)
  const [msg,      setMsg]      = useState('')

  const load = useCallback(async () => {
    try {
      const [fw, ro] = await Promise.all([
        fetch(`${API}/api/admin/firmware`).then(r => r.json()),
        fetch(`${API}/api/admin/rollouts`).then(r => r.json()),
      ])
      setFirmware(fw.firmware || [])
      setRollouts(ro.rollouts || [])
    } catch(e) { console.error('load error', e) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  async function start(fw) {
    if (!window.confirm(`Start a staged rollout of ${fw.project} ${fw.version} (canary, then a quarter, then the rest)?`)) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${API}/api/admin/rollouts`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ project: fw.project, version: fw.version }),
      })
      const d = await r.json()
      setMsg(r.ok ? `✓ Rollout #${d.rollout} started: ${fw.project} ${fw.version}` : `Error: ${d.detail}`)
      if (r.ok) load()
    } catch(e) { setMsg(`Network error: ${e.message}`) }
    setBusy(false)
  }

  async function abort(id) {
    try { await fetch(`${API}/api/admin/rollouts/${id}/abort`, { method:'POST' }); load() }
    catch(e) { console.error(e) }
  }

  const box = { background:'var(--bg2)', borderRadius:10, border:'0.5px solid var(--border)',
                marginBottom:16, overflow:'hidden' }
  const head = { padding:'10px 14px', borderBottom:'0.5px solid var(--border)', fontSize:11,
                 fontWeight:600, color:'var(--text2)' }
  const row = (i, n) => ({ padding:'10px 14px', borderBottom: i < n - 1 ? '0.5px solid var(--border)' : 'none' })

  return (
    <div style={{ height:'100%', overflow:'auto', padding:'16px 20px' }}>
      <button onClick={onBack} style={{ background:'none', border:'none', color:'var(--text2)',
        fontSize:12, cursor:'pointer', marginBottom:16, padding:0 }}>← Back to fleet</button>

      {msg && <div style={{ fontSize:11, marginBottom:12,
        color: msg.startsWith('✓') ? 'var(--ok)' : 'var(--danger)' }}>{msg}</div>}

      <div style={box}>
        <div style={head}>Signed images</div>
        {firmware.length === 0
          ? <div style={{ padding:20, color:'var(--text3)', fontSize:12, textAlign:'center' }}>
              No signed image yet: sign and upload from the laptop (tools/ota-sign.sh)</div>
          : firmware.map((fw, i) => (
            <div key={`${fw.project}-${fw.version}`} style={{ ...row(i, firmware.length), display:'flex',
              justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ minWidth:0, flex:1 }}>
                <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:600, color:'var(--text)' }}>{fw.version}</span>
                <span style={{ marginLeft:8, fontSize:11, color:'var(--text2)' }}>{fw.project}</span>
                <span style={{ marginLeft:8, fontSize:11, color:'var(--text3)' }}>{fw.chip_target}</span>
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>
                  sha256 {fw.sha256?.slice(0,16)}… · signed · {new Date(fw.uploaded_at).toLocaleDateString()}
                  {fw.notes && ` · ${fw.notes}`}
                </div>
              </div>
              <button onClick={() => start(fw)} disabled={busy} style={{ padding:'6px 14px', borderRadius:7,
                border:'none', background:'var(--accent)', color:'#fff', fontSize:12,
                cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .7 : 1, flexShrink:0 }}>▶ Roll out</button>
            </div>
          ))}
      </div>

      <div style={box}>
        <div style={head}>Rollouts</div>
        {rollouts.length === 0
          ? <div style={{ padding:20, color:'var(--text3)', fontSize:12, textAlign:'center' }}>No rollout yet</div>
          : rollouts.map((ro, i) => (
            <div key={ro.id} style={row(i, rollouts.length)}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div>
                  <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:600 }}>{ro.version}</span>
                  <span style={{ marginLeft:8, fontSize:11, color:'var(--text2)' }}>{ro.project}</span>
                  <span style={{ marginLeft:8, fontSize:10, color:'var(--text3)' }}>#{ro.id} · phase {ro.phase}</span>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ fontSize:11, fontWeight:600, color: ROLLOUT_COLOR[ro.status] || 'var(--text3)' }}>
                    {ro.status?.replace('_',' ').toUpperCase()}</span>
                  {ro.status === 'in_progress' && (
                    <button onClick={() => abort(ro.id)} style={{ padding:'3px 8px', borderRadius:5, fontSize:10,
                      border:'0.5px solid var(--danger)', background:'transparent', color:'var(--danger)',
                      cursor:'pointer' }}>Abort</button>)}
                </div>
              </div>
              {ro.reason && <div style={{ fontSize:10, color:'var(--danger)', marginBottom:5 }}>{ro.reason}</div>}
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {(ro.devices || []).map(d => (
                  <span key={d.device_id} title={d.detail || d.status} style={{ fontSize:10, fontFamily:'monospace',
                    padding:'2px 6px', borderRadius:4, border:`0.5px solid ${ROLLOUT_COLOR[d.status] || 'var(--border)'}`,
                    color: ROLLOUT_COLOR[d.status] || 'var(--text3)' }}>
                    P{d.phase} {d.device_id.replace('esp32-','')} {d.status}</span>
                ))}
              </div>
              <div style={{ fontSize:9, color:'var(--text3)', marginTop:5 }}>
                {new Date(ro.created_at).toLocaleString()} · soak {ro.soak_minutes} min · timeout {ro.timeout_minutes} min
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Main FleetTab ─────────────────────────────────────────────
export function FleetTab() {
  const [devices,         setDevices]         = useState([])
  const [showDeployments, setShowDeployments] = useState(false)
  const [expanded,        setExpanded]        = useState(null) // provisioning actions (Confirm/Suspend/OTA): separate from the device
  const [detailDevice,    setDetailDevice]    = useState(null) // detail modal, DeviceDetailModal (read-only, telemetry)
  const [filter,          setFilter]          = useState('all')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [actBusy,         setActBusy]         = useState(false)

  // ── Real-time telemetry: live status + latest values per device_id ──
  const { byDevice: liveStatus } = useDeviceLiveStatus()
  const allLast = useFlux(FLUX.allLast(), 10000)
  const readingsByDevice = useMemo(() => {
    const out = {}
    for (const row of allLast.data ?? []) {
      if (!row.device_id || !row._field || row._value === '') continue
      if (!out[row.device_id]) out[row.device_id] = {}
      out[row.device_id][row._field] = row._value
    }
    return out
  }, [allLast.data])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`${API}/api/admin/devices`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setDevices(d.devices || [])
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  async function doAction(fn) {
    setActBusy(true)
    try { await fn(); await load() } catch(e) { console.error(e) }
    setActBusy(false)
  }

  const counts   = devices.reduce((a, d) => {
    a[d.status] = (a[d.status] || 0) + 1; return a
  }, {})
  const filtered = devices.filter(d =>
    filter === 'all' || d.status === filter)

  if (showDeployments) return (
    <div style={{ height:'100%', overflow:'hidden' }}>
      <RolloutPanel onBack={() => setShowDeployments(false)}/>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* Stats bar */}
      <div style={{
        padding:'10px 20px', borderBottom:'0.5px solid var(--border)',
        display:'flex', gap:20, alignItems:'center', flexShrink:0
      }}>
        {[
          ['Total',     devices.length,       'var(--text)'],
          ['Active',    counts.active    || 0, 'var(--ok)'],
          ['Seen',      counts.seen      || 0, 'var(--accent-vivid)'],
          ['Suspended', counts.suspended || 0, 'var(--danger)'],
        ].map(([l,v,c]) => (
          <div key={l} style={{ display:'flex', flexDirection:'column', gap:1 }}>
            <span style={{
              fontSize:9, color:'var(--text3)',
              textTransform:'uppercase', letterSpacing:'.06em'
            }}>{l}</span>
            <span style={{
              fontSize:18, fontWeight:500,
              fontFamily:'monospace', color:c
            }}>{v}</span>
          </div>
        ))}

        <div style={{
          marginLeft:'auto', display:'flex',
          gap:8, alignItems:'center'
        }}>
          {loading && (
            <span style={{ fontSize:10, color:'var(--text3)' }}>
              syncing…
            </span>
          )}
          {error && (
            <span style={{ fontSize:10, color:'var(--danger)' }}>
              API error: {error}
            </span>
          )}
          <button onClick={load} style={{
            padding:'5px 10px', borderRadius:6,
            border:'0.5px solid var(--border)',
            background:'transparent', color:'var(--text2)',
            fontSize:11, cursor:'pointer'
          }}>Refresh</button>
          <span title="Devices are provisioned on the bench (provision_device.sh), then enroll with their IDevID" style={{ fontSize:12, color:'var(--text2)' }}>Add devices on the bench</span>
          <button onClick={() => setShowDeployments(true)} style={{
            padding:'5px 10px', borderRadius:6,
            border:'0.5px solid var(--border)',
            background:'transparent', color:'var(--text2)',
            fontSize:11, cursor:'pointer'
          }}>⬆ OTA Deploy</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding:'8px 20px', borderBottom:'0.5px solid var(--border)',
        display:'flex', gap:6, flexShrink:0
      }}>
        {[
          ['all',       'All'],
          ['active',    'Active'],
          ['seen',      'Seen'],
          ['suspended', 'Suspended'],
        ].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding:'3px 10px', borderRadius:6, fontSize:11,
            cursor:'pointer',
            border:   filter===v ? 'none' : '0.5px solid var(--border)',
            background: filter===v ? 'var(--accent)' : 'transparent',
            color:      filter===v ? '#fff' : 'var(--text2)',
          }}>
            {l}{v !== 'all' && counts[v] ? ` (${counts[v]})` : ''}
          </button>
        ))}
      </div>

      {/* Device list */}
      <div style={{ flex:1, overflow:'auto' }}>
        {filtered.length === 0 && !loading && !error && (
          <div style={{
            padding:40, textAlign:'center',
            color:'var(--text3)', fontSize:13
          }}>
            {filter === 'all'
              ? <>No devices yet — click <strong>+ Add Device</strong></>
              : 'No devices in this filter'}
          </div>
        )}

        {filtered.map(d => {
          const isExpanded = expanded === d.device_id
          const offline = d.status === 'active' && d.last_seen
            && (Date.now() - new Date(d.last_seen)) > 120000
          const days    = certDaysLeft(d.cert_expiry)
          const certColor = days === null ? null
            : days < 7 ? 'var(--danger)' : days < 30 ? 'var(--warn)' : 'var(--ok)'
          const live = liveStatus[d.device_id]

          return (
            <div key={d.device_id}
              style={{
                padding:'12px 20px',
                borderBottom:'0.5px solid var(--border)',
                background: isExpanded ? 'var(--bg2)' : 'transparent',
                transition:'background .1s'
              }}>

              {/* Clickable area -> opens the detail modal (telemetry, read-only) */}
              <div onClick={() => setDetailDevice(d)} style={{ cursor:'pointer' }}>
                {/* Row 1 : device_id + badges */}
                <div style={{
                  display:'flex', justifyContent:'space-between',
                  marginBottom:5
                }}>
                  <span style={{
                    fontFamily:'monospace', fontSize:13, fontWeight:500
                  }}>{d.device_id}</span>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    {offline && (
                      <span style={{ fontSize:10, color:'var(--danger)' }}>
                        ⚠ offline
                      </span>
                    )}
                    <StatusBadge status={d.status}/>
                    {certColor && (
                      <span style={{
                        fontSize:10, padding:'2px 7px', borderRadius:99,
                        background:`color-mix(in srgb, ${certColor} 18%, transparent)`, color:certColor,
                        border:`0.5px solid ${certColor}`,
                        fontFamily:'monospace'
                      }}>cert {days}d</span>
                    )}
                  </div>
                </div>

                {/* Row 2 : metadata */}
                <div style={{
                  fontSize:11, color:'var(--text3)',
                  display:'flex', gap:14, flexWrap:'wrap', marginBottom:4
                }}>
                  {d.hw_model && (
                    <span style={{ color:'var(--text2)', fontFamily:'monospace' }}>
                      {d.hw_model}
                    </span>
                  )}
                  <span>fw {d.fw_version || '?'}</span>
                  <span>chip {(d.chip_id || '—').slice(-8)}</span>
                  {d.last_seen && <span>{timeSince(d.last_seen)}</span>}
                  {d.confirmed_by && <span>by {d.confirmed_by}</span>}
                </div>

                {/* Row 3 : capabilities */}
                <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                  {(Array.isArray(d.capabilities)
                    ? d.capabilities
                    : JSON.parse(d.capabilities || '[]')
                  ).map(c => (
                    <span key={c} style={{
                      fontSize:9, background:'var(--bg3)',
                      color:'var(--text3)', padding:'1px 5px',
                      borderRadius:3, fontFamily:'monospace',
                      border:'0.5px solid var(--border)'
                    }}>{c}</span>
                  ))}
                </div>

                {/* Row 4: real-time metric chips, green/yellow/red according to
                    hooks/thresholds.js, grey if silent (isLive=false) */}
                <MetricPills readings={readingsByDevice[d.device_id]} isLive={live?.isLive}/>
              </div>

              {/* Provisioning actions: an expand separate from the detail modal, opened
                  by a dedicated button so as not to mix "see the data" and
                  "act on the device" in the same gesture. */}
              <div style={{ marginTop:8 }}>
                <button onClick={e => { e.stopPropagation(); setExpanded(isExpanded ? null : d.device_id) }}
                  style={{
                    background:'none', border:'none', color:'var(--text3)',
                    fontSize:10, cursor:'pointer', padding:0, textDecoration:'underline'
                  }}>{isExpanded ? 'Hide actions' : 'Actions'}</button>
              </div>

              {isExpanded && (
                <div style={{ marginTop:14 }} onClick={e => e.stopPropagation()}>
                  {d.cert_fingerprint && (
                    <div style={{
                      fontSize:10, fontFamily:'monospace',
                      color:'var(--text3)', marginBottom:10,
                      wordBreak:'break-all'
                    }}>mTLS: {d.cert_fingerprint}</div>
                  )}

                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {d.status === 'seen' && (
                      <button disabled={actBusy}
                        onClick={() => doAction(() => fetch(
                          `${API}/api/admin/devices/${d.device_id}/confirm`,
                          { method:'POST' }))}
                        style={{
                          padding:'6px 14px', borderRadius:6,
                          border:'none', background:'var(--ok)',
                          color:'#fff', fontSize:11, cursor:'pointer'
                        }}>Confirm</button>
                    )}
                    {d.status === 'active' && (
                      <button disabled={actBusy}
                        onClick={() => doAction(() => fetch(
                          `${API}/api/admin/devices/${d.device_id}/suspend`,
                          { method:'POST' }))}
                        style={{
                          padding:'6px 14px', borderRadius:6,
                          border:'0.5px solid var(--danger)',
                          background:'transparent', color:'var(--danger)',
                          fontSize:11, cursor:'pointer'
                        }}>Suspend</button>
                    )}
                    {d.status === 'active' && (
                      <button disabled={actBusy}
                        onClick={() => doAction(() => fetch(
                          `${API}/api/admin/devices/${d.device_id}/renew`,
                          { method:'POST' }))}
                        style={{
                          padding:'6px 14px', borderRadius:6,
                          border:'none', background:'var(--info)',
                          color:'#fff', fontSize:11, cursor:'pointer'
                        }}>Renew cert</button>
                    )}
                    {d.status === 'suspended' && (
                      <button disabled={actBusy}
                        onClick={() => doAction(() => fetch(
                          `${API}/api/admin/devices/${d.device_id}/confirm`,
                          { method:'POST' }))}
                        style={{
                          padding:'6px 14px', borderRadius:6,
                          border:'none', background:'var(--accent-vivid)',
                          color:'#fff', fontSize:11, cursor:'pointer'
                        }}>Reactivate</button>
                    )}
                  </div>

                  {d.status === 'active' && <OTAInfo device={d}/>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Detail modal, read-only: provisioning identity + live status + charts + timeline */}
      {detailDevice && (
        <DeviceDetailModal
          device={{ info: detailDevice, liveInfo: liveStatus[detailDevice.device_id] }}
          onClose={() => setDetailDevice(null)}
        />
      )}
    </div>
  )
}