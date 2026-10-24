import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { useDeviceLiveStatus } from '../hooks/useDeviceStatus.js'
import { statusColorForValue } from '../hooks/thresholds.js'
import { DeviceDetailModal } from '../components/DeviceDetailModal.jsx'

const API         = ''
const PAIRING_TTL = 60

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

// ── Pastilles de métriques temps réel — une par field disponible pour ce device.
// Couleur ET seuils dérivés de hooks/thresholds.js, contour fermé (border plein,
// pas de dash). Passe en gris si le device est silencieux (isLive=false) : une
// valeur périmée ne doit jamais afficher une couleur de statut trompeuse.
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

// ── Pairing Wizard ────────────────────────────────────────────
function PairingWizard({ onDone, onBack }) {
  const [phase,     setPhase]     = useState('idle')
  const [remaining, setRemaining] = useState(PAIRING_TTL)
  const [device,    setDevice]    = useState(null)
  const [error,     setError]     = useState('')
  const esRef = useRef(null)

  const cleanup = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
  }
  useEffect(() => () => cleanup(), [])

  async function openSession() {
    setPhase('opening'); setError('')
    try {
      const r = await fetch(`${API}/api/admin/pairing/open`, { method:'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setRemaining(d.ttl)
      setPhase('waiting')
      const es = new EventSource(`${API}/api/admin/pairing/stream/${d.session_id}`)
      esRef.current = es
      es.onmessage = e => {
        const data = JSON.parse(e.data)
        if (data.event === 'heartbeat')   setRemaining(data.remaining)
        if (data.event === 'device_seen') { setDevice(data); setPhase('seen'); cleanup() }
        if (data.event === 'expired')     { setPhase('expired'); cleanup() }
      }
      es.onerror = () => { setPhase('expired'); cleanup() }
    } catch(e) { setError(e.message); setPhase('idle') }
  }

  async function confirmDevice() {
    if (!device) return
    setPhase('confirming')
    try {
      const r = await fetch(
        `${API}/api/admin/devices/${device.device_id}/confirm`,
        { method:'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPhase('done')
      if (onDone) onDone()
    } catch(e) { setError(e.message); setPhase('seen') }
  }

  const wrap = children => (
    <div style={{ maxWidth:400, margin:'0 auto', width:'100%', padding:'0 16px' }}>
      <button onClick={onBack} style={{
        background:'none', border:'none', color:'var(--text2)',
        fontSize:12, cursor:'pointer', marginBottom:16, padding:0
      }}>← Back to fleet</button>
      <div style={{
        background:'var(--bg)', border:'0.5px solid var(--border)',
        borderRadius:12, padding:24
      }}>{children}</div>
    </div>
  )

  if (phase === 'idle') return wrap(<>
    <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Add a Device</div>
    <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.7, marginBottom:20 }}>
      Click <strong style={{color:'var(--text)'}}>Open window</strong>, then hold the
      button on your ESP32-C3 for <strong style={{color:'var(--text)'}}>2 seconds</strong>.
    </div>
    <div style={{
      background:'var(--bg2)', borderRadius:8, padding:'10px 14px',
      marginBottom:20, fontSize:12, color:'var(--text2)', lineHeight:1.9
    }}>
      <span style={{color:'var(--warn)'}}>●</span> Fast blink → pairing in progress<br/>
      <span style={{color:'var(--accent-vivid)'}}>●</span> Slow blink → waiting for confirmation<br/>
      <span style={{color:'var(--ok)'}}>●</span> Solid → MQTT mTLS active
    </div>
    {error && <div style={{ fontSize:12, color:'var(--danger)', marginBottom:12 }}>{error}</div>}
    <button onClick={openSession} style={{
      width:'100%', padding:'10px 0', borderRadius:8,
      border:'none', background:'var(--accent)', color:'#fff',
      fontSize:13, fontWeight:500, cursor:'pointer'
    }}>Open Pairing Window</button>
  </>)

  if (phase === 'opening') return wrap(
    <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13 }}>Opening…</div>
  )

  if (phase === 'waiting') return wrap(<>
    <div style={{ textAlign:'center', marginBottom:20 }}>
      <div style={{
        width:64, height:64, borderRadius:'50%', margin:'0 auto 16px',
        border:'2px solid var(--border)', display:'flex',
        alignItems:'center', justifyContent:'center',
        fontSize:22, fontWeight:500, fontFamily:'monospace', color:'var(--accent)'
      }}>{remaining}</div>
      <div style={{ fontSize:15, fontWeight:500, marginBottom:6 }}>Waiting…</div>
      <div style={{ fontSize:13, color:'var(--text2)' }}>
        Hold the button for <strong style={{color:'var(--text)'}}>2 seconds</strong>
      </div>
    </div>
    <button onClick={() => { cleanup(); setPhase('idle') }} style={{
      width:'100%', padding:'8px 0', borderRadius:8,
      border:'0.5px solid var(--border)', background:'transparent',
      color:'var(--text2)', fontSize:12, cursor:'pointer'
    }}>Cancel</button>
  </>)

  if (phase === 'seen') return wrap(<>
    <div style={{ fontSize:15, fontWeight:500, marginBottom:4 }}>Device Detected ✓</div>
    <div style={{ fontSize:12, color:'var(--text2)', marginBottom:16 }}>
      Verify before confirming
    </div>
    <div style={{
      background:'var(--bg2)', borderRadius:8,
      padding:'10px 14px', marginBottom:16
    }}>
      {[
        ['Device ID',  device?.device_id],
        ['Chip ID',    device?.chip_id],
        ['Firmware',   device?.fw_version],
        ['hw_model',   device?.hw_model],
        ['Sensors',    device?.capabilities?.join(', ')],
      ].map(([k,v]) => (
        <div key={k} style={{
          display:'flex', justifyContent:'space-between',
          padding:'5px 0', borderBottom:'0.5px solid var(--border)', fontSize:12
        }}>
          <span style={{ color:'var(--text2)' }}>{k}</span>
          <span style={{ fontFamily:'monospace', color:'var(--text)' }}>{v || '—'}</span>
        </div>
      ))}
    </div>
    {error && <div style={{ fontSize:12, color:'var(--danger)', marginBottom:10 }}>{error}</div>}
    <div style={{ display:'flex', gap:8 }}>
      <button onClick={() => { cleanup(); setPhase('idle') }} style={{
        flex:1, padding:'9px 0', borderRadius:8,
        border:'0.5px solid var(--border)', background:'transparent',
        color:'var(--text2)', fontSize:12, cursor:'pointer'
      }}>Cancel</button>
      <button onClick={confirmDevice} style={{
        flex:2, padding:'9px 0', borderRadius:8,
        border:'none', background:'var(--ok)', color:'#fff',
        fontSize:12, fontWeight:500, cursor:'pointer'
      }}>Confirm Device</button>
    </div>
  </>)

  if (phase === 'confirming') return wrap(
    <div style={{ textAlign:'center', color:'var(--text2)', fontSize:13 }}>
      Issuing mTLS certificate…
    </div>
  )

  if (phase === 'done') return wrap(<>
    <div style={{ textAlign:'center', padding:'8px 0 16px' }}>
      <div style={{ fontSize:32, marginBottom:12, color:'var(--ok)' }}>✓</div>
      <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>Device Activated</div>
      <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6, marginBottom:20 }}>
        mTLS certificate issued. The ESP32 will connect within 30s.<br/>
        LED will turn solid green.
      </div>
    </div>
    <button onClick={() => { setPhase('idle'); setDevice(null); onDone && onDone() }}
      style={{
        width:'100%', padding:'10px 0', borderRadius:8,
        border:'none', background:'var(--accent)', color:'#fff',
        fontSize:13, fontWeight:500, cursor:'pointer'
      }}>Done</button>
  </>)

  if (phase === 'expired') return wrap(<>
    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>Window Expired</div>
    <div style={{ fontSize:13, color:'var(--text2)', marginBottom:20, lineHeight:1.6 }}>
      No device detected in {PAIRING_TTL}s. Make sure the ESP32 is powered
      and connected to the IoT network.
    </div>
    <button onClick={() => setPhase('idle')} style={{
      width:'100%', padding:'10px 0', borderRadius:8,
      border:'none', background:'var(--accent)', color:'#fff',
      fontSize:13, fontWeight:500, cursor:'pointer'
    }}>Try Again</button>
  </>)
}

// ── OTA Panel (device individuel) ─────────────────────────────
function OTAPanel({ deviceId }) {
  const [ver,  setVer]  = useState('')
  const [url,  setUrl]  = useState('')
  const [sha,  setSha]  = useState('')
  const [msg,  setMsg]  = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!ver || !url || !sha) { setMsg('All fields required'); return }
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`${API}/api/admin/devices/${deviceId}/ota`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ version:ver, url, checksum:sha }),
      })
      setMsg(r.ok ? `✓ OTA sent → v${ver}` : `Error HTTP ${r.status}`)
      if (r.ok) { setVer(''); setUrl(''); setSha('') }
    } catch(e) { setMsg(`Network error: ${e.message}`) }
    setBusy(false)
  }

  const inp = {
    width:'100%', padding:'7px 10px', borderRadius:7,
    border:'0.5px solid var(--border)', fontSize:12,
    fontFamily:'monospace', background:'var(--bg2)',
    color:'var(--text)', outline:'none'
  }

  return (
    <div style={{ borderTop:'0.5px solid var(--border)', paddingTop:14, marginTop:14 }}>
      <div style={{
        fontSize:9, color:'var(--text3)', textTransform:'uppercase',
        letterSpacing:'.07em', marginBottom:10
      }}>Manual OTA</div>
      <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
        <input style={inp} placeholder="Version (e.g. 2.1.0)"
          value={ver} onChange={e => setVer(e.target.value)}/>
        <input style={inp} placeholder="HTTPS URL to .bin"
          value={url} onChange={e => setUrl(e.target.value)}/>
        <input style={inp} placeholder="SHA256 checksum"
          value={sha} onChange={e => setSha(e.target.value)}/>
        <button onClick={send} disabled={busy} style={{
          padding:'8px 0', borderRadius:7, border:'none',
          background:'var(--accent-vivid)', color:'#fff', fontSize:12,
          fontWeight:500, cursor:busy?'not-allowed':'pointer',
          opacity:busy?.7:1
        }}>{busy ? 'Sending…' : 'Send OTA Command'}</button>
        {msg && <div style={{
          fontSize:11, color:msg.startsWith('✓')?'var(--ok)':'var(--danger)'
        }}>{msg}</div>}
      </div>
    </div>
  )
}

// ── Deployment Panel ──────────────────────────────────────────
function DeploymentPanel({ onBack }) {
  const [firmware,    setFirmware]  = useState([])
  const [deployments, setDeps]      = useState([])
  const [uploading,   setUploading] = useState(false)
  const [deploying,   setDeploying] = useState(false)
  const [msg,         setMsg]       = useState('')
  const [form,        setForm]      = useState({
    version:'', chip_target:'esp32c3', hw_model:'', notes:''
  })
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [fw, deps] = await Promise.all([
        fetch(`${API}/api/admin/firmware`).then(r => r.json()),
        fetch(`${API}/api/admin/deployments`).then(r => r.json()),
      ])
      setFirmware(fw.firmware || [])
      setDeps(deps.deployments || [])
    } catch(e) { console.error('load error', e) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  async function upload() {
    if (!fileRef.current?.files[0] || !form.version) {
      setMsg('File and version required'); return
    }
    setUploading(true); setMsg('')
    const fd = new FormData()
    fd.append('file',        fileRef.current.files[0])
    fd.append('version',     form.version)
    fd.append('chip_target', form.chip_target)
    fd.append('hw_model',    form.hw_model)
    fd.append('notes',       form.notes)
    try {
      const r = await fetch(`${API}/api/admin/firmware/upload`,
        { method:'POST', body:fd })
      const d = await r.json()
      setMsg(r.ok
        ? `✓ v${d.version} uploaded — ${d.sha256?.slice(0,12)}…`
        : `Error: ${d.detail}`)
      if (r.ok) {
        setForm(f => ({...f, version:'', notes:''}))
        fileRef.current.value = ''
        load()
      }
    } catch(e) { setMsg(`Network error: ${e.message}`) }
    setUploading(false)
  }

  async function deploy(version) {
    setDeploying(true); setMsg('')
    try {
      const r = await fetch(
        `${API}/api/admin/firmware/${version}/deploy?chip_target=esp32c3`,
        { method:'POST' })
      const d = await r.json()
      setMsg(r.ok
        ? `✓ Deployment started → v${version}`
        : `Error: ${d.detail}`)
      if (r.ok) load()
    } catch(e) { setMsg(`Network error: ${e.message}`) }
    setDeploying(false)
  }

  async function abort(id) {
    try {
      await fetch(`${API}/api/admin/deployments/${id}/abort`,
        { method:'POST' })
      load()
    } catch(e) { console.error(e) }
  }

  const STATUS_COLOR = {
    in_progress: 'var(--warn)', success:  'var(--ok)',
    aborted:     'var(--danger)', pending:  'var(--text3)'
  }

  const inp = {
    padding:'6px 9px', borderRadius:5,
    border:'0.5px solid var(--border)',
    background:'var(--bg2)', color:'var(--text)',
    fontSize:12, fontFamily:'monospace', outline:'none'
  }

  return (
    <div style={{ height:'100%', overflow:'auto', padding:'16px 20px' }}>
      <button onClick={onBack} style={{
        background:'none', border:'none', color:'var(--text2)',
        fontSize:12, cursor:'pointer', marginBottom:16, padding:0
      }}>← Back to fleet</button>

      <div style={{
        background:'var(--bg2)', borderRadius:10,
        border:'0.5px solid var(--border)',
        padding:'14px 16px', marginBottom:16
      }}>
        <div style={{
          fontSize:11, color:'var(--text3)', textTransform:'uppercase',
          letterSpacing:'.07em', marginBottom:12
        }}>Upload Firmware</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
          <div>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>Version</div>
            <input style={{...inp, width:'100%'}} placeholder="2.2.0"
              value={form.version}
              onChange={e => setForm(f => ({...f, version:e.target.value}))}/>
          </div>
          <div>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>Chip target</div>
            <select style={{...inp, width:'100%'}} value={form.chip_target}
              onChange={e => setForm(f => ({...f, chip_target:e.target.value}))}>
              <option value="esp32c3">esp32c3</option>
              <option value="esp32s3">esp32s3</option>
              <option value="esp32">esp32</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>
              hw_model (info)
            </div>
            <input style={{...inp, width:'100%'}} placeholder="bh1750+scd41"
              value={form.hw_model}
              onChange={e => setForm(f => ({...f, hw_model:e.target.value}))}/>
          </div>
          <div>
            <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3 }}>Notes</div>
            <input style={{...inp, width:'100%'}} placeholder="Optional"
              value={form.notes}
              onChange={e => setForm(f => ({...f, notes:e.target.value}))}/>
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".bin"
          style={{ fontSize:12, color:'var(--text2)', marginBottom:8, display:'block' }}/>
        <button onClick={upload} disabled={uploading} style={{
          padding:'8px 16px', borderRadius:7, border:'none',
          background:'var(--accent)', color:'#fff', fontSize:12,
          fontWeight:500, cursor:uploading?'not-allowed':'pointer',
          opacity:uploading?.7:1
        }}>{uploading ? 'Uploading…' : 'Upload .bin'}</button>
        {msg && <div style={{
          fontSize:11, marginTop:8,
          color:msg.startsWith('✓')?'var(--ok)':'var(--danger)'
        }}>{msg}</div>}
      </div>

      <div style={{
        background:'var(--bg2)', borderRadius:10,
        border:'0.5px solid var(--border)',
        marginBottom:16, overflow:'hidden'
      }}>
        <div style={{
          padding:'10px 14px', borderBottom:'0.5px solid var(--border)',
          fontSize:11, fontWeight:600, color:'var(--text2)'
        }}>Firmware Catalog</div>
        {firmware.length === 0
          ? <div style={{
              padding:20, color:'var(--text3)',
              fontSize:12, textAlign:'center'
            }}>No firmware uploaded yet</div>
          : firmware.map((fw, i) => (
            <div key={i} style={{
              padding:'10px 14px',
              borderBottom: i < firmware.length-1
                ? '0.5px solid var(--border)' : 'none',
              display:'flex', justifyContent:'space-between',
              alignItems:'center', gap:12
            }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                  <span style={{
                    fontFamily:'monospace', fontSize:13,
                    fontWeight:600, color:'var(--text)'
                  }}>v{fw.version}</span>
                  <span style={{ fontSize:11, color:'var(--text3)' }}>
                    {fw.chip_target}
                  </span>
                  {fw.hw_model && (
                    <span style={{ fontSize:10, color:'var(--text3)' }}>
                      · {fw.hw_model}
                    </span>
                  )}
                </div>
                <div style={{
                  fontSize:10, color:'var(--text3)', marginTop:2,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
                }}>
                  {fw.notes && `${fw.notes} · `}
                  SHA256: {fw.sha256?.slice(0,16)}…
                </div>
                <div style={{ fontSize:9, color:'var(--text3)', marginTop:1 }}>
                  {new Date(fw.uploaded_at).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => deploy(fw.version)} disabled={deploying}
                style={{
                  padding:'6px 14px', borderRadius:7, border:'none',
                  background:'var(--accent)', color:'#fff', fontSize:12,
                  cursor:deploying?'not-allowed':'pointer',
                  opacity:deploying?.7:1, flexShrink:0
                }}>
                {deploying ? '…' : '▶ Deploy'}
              </button>
            </div>
          ))
        }
      </div>

      <div style={{
        background:'var(--bg2)', borderRadius:10,
        border:'0.5px solid var(--border)', overflow:'hidden'
      }}>
        <div style={{
          padding:'10px 14px', borderBottom:'0.5px solid var(--border)',
          fontSize:11, fontWeight:600, color:'var(--text2)'
        }}>Deployment History</div>
        {deployments.length === 0
          ? <div style={{
              padding:20, color:'var(--text3)',
              fontSize:12, textAlign:'center'
            }}>No deployments yet</div>
          : deployments.map(dep => (
            <div key={dep.id} style={{
              padding:'10px 14px',
              borderBottom:'0.5px solid var(--border)'
            }}>
              <div style={{
                display:'flex', justifyContent:'space-between',
                alignItems:'center', marginBottom:6
              }}>
                <div>
                  <span style={{
                    fontFamily:'monospace', fontSize:13, fontWeight:600
                  }}>v{dep.version}</span>
                  <span style={{
                    marginLeft:8, fontSize:11, color:'var(--text3)'
                  }}>{dep.chip_target}</span>
                  <span style={{
                    marginLeft:8, fontSize:10, color:'var(--text3)'
                  }}>#{dep.id}</span>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{
                    fontSize:11, fontWeight:600,
                    color:STATUS_COLOR[dep.status]||'var(--text3)'
                  }}>
                    {dep.status?.replace('_',' ').toUpperCase()}
                  </span>
                  {dep.status === 'in_progress' && (
                    <button onClick={() => abort(dep.id)} style={{
                      padding:'3px 8px', borderRadius:5, fontSize:10,
                      border:'0.5px solid var(--danger)', background:'transparent',
                      color:'var(--danger)', cursor:'pointer'
                    }}>Abort</button>
                  )}
                </div>
              </div>

              <div style={{
                display:'flex', gap:12, fontSize:10,
                color:'var(--text3)', marginBottom:5
              }}>
                <span style={{ color:'var(--ok)' }}>✓ {dep.confirmed ?? 0}</span>
                <span style={{ color:'var(--warn)' }}>⟳ {dep.sent ?? 0}</span>
                <span style={{ color:'var(--danger)' }}>✕ {dep.rolled_back ?? 0}</span>
                <span>· {dep.total ?? 0} total</span>
              </div>

              {(dep.total ?? 0) > 0 && (
                <div style={{
                  height:5, background:'var(--bg3)',
                  borderRadius:3, overflow:'hidden', marginBottom:4
                }}>
                  <div style={{
                    height:'100%', borderRadius:3,
                    background: dep.status === 'aborted' ? 'var(--danger)' : 'var(--ok)',
                    width:`${((dep.confirmed ?? 0) / dep.total) * 100}%`,
                    transition:'width .5s ease'
                  }}/>
                </div>
              )}

              <div style={{ fontSize:9, color:'var(--text3)' }}>
                {new Date(dep.created_at).toLocaleString()}
                {dep.created_by && ` · by ${dep.created_by}`}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Main FleetTab ─────────────────────────────────────────────
export function FleetTab() {
  const [devices,         setDevices]         = useState([])
  const [pairing,         setPairing]         = useState(false)
  const [showDeployments, setShowDeployments] = useState(false)
  const [expanded,        setExpanded]        = useState(null) // actions provisioning (Confirm/Suspend/OTA) — séparé du modal détail
  const [detailDevice,    setDetailDevice]    = useState(null) // device pour DeviceDetailModal (lecture seule, télémétrie)
  const [filter,          setFilter]          = useState('all')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [actBusy,         setActBusy]         = useState(false)

  // ── Télémétrie temps réel — statut live + dernières valeurs par device_id ──
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

  if (pairing) return (
    <div style={{ height:'100%', overflow:'auto', paddingTop:20 }}>
      <PairingWizard
        onDone={() => { setPairing(false); load() }}
        onBack={() => setPairing(false)}/>
    </div>
  )

  if (showDeployments) return (
    <div style={{ height:'100%', overflow:'hidden' }}>
      <DeploymentPanel onBack={() => setShowDeployments(false)}/>
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
          <button onClick={() => setPairing(true)} style={{
            padding:'6px 14px', borderRadius:7,
            border:'none', background:'var(--accent)',
            color:'#fff', fontSize:12, fontWeight:500, cursor:'pointer'
          }}>+ Add Device</button>
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

              {/* Zone cliquable → ouvre le modal détail (télémétrie, lecture seule) */}
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

                {/* Row 4 : pastilles de métriques temps réel — vert/jaune/rouge selon
                    hooks/thresholds.js, gris si silencieux (isLive=false) */}
                <MetricPills readings={readingsByDevice[d.device_id]} isLive={live?.isLive}/>
              </div>

              {/* Actions de provisioning — expand séparé du modal détail, déclenché
                  par un bouton dédié pour ne pas mélanger "voir les données" et
                  "agir sur le device" dans le même geste. */}
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

                  {d.status === 'active' && <OTAPanel deviceId={d.device_id}/>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Modal détail — lecture seule : identité provisioning + statut live + graphes + timeline */}
      {detailDevice && (
        <DeviceDetailModal
          device={{ info: detailDevice, liveInfo: liveStatus[detailDevice.device_id] }}
          onClose={() => setDetailDevice(null)}
        />
      )}
    </div>
  )
}