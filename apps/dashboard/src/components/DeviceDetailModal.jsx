import { useState, useEffect } from 'react'
import { usePresenceWindow } from '../hooks/useDeviceStatus.js'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { statusColorForValue, METRIC_DOMAIN, METRIC_UNIT, METRIC_LABEL } from '../hooks/thresholds.js'
import { Modal } from './Modal.jsx'



const RANGE_CFG = {
  h24: { label:'24h', start:'-24h', every:'5m'  },
  d7:  { label:'7j',  start:'-7d',  every:'1h'  },
  d30: { label:'30j', start:'-30d', every:'6h'  },
}

const STATUS_META = {
  active:         { label:'Active',    color:'var(--ok)' },
  seen:           { label:'Seen',      color:'var(--accent-vivid)' },
  suspended:      { label:'Suspended', color:'var(--danger)' },
  pre_registered: { label:'Pre-reg',   color:'var(--info)' },
  bootstrapped:   { label:'Bootstrap', color:'var(--warn)' },
}

function ProvisioningBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: 'var(--text2)' }
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'2px 10px', borderRadius:99, fontSize:'var(--fs-2xs)', fontWeight:700,
      background:`color-mix(in srgb, ${m.color} 18%, transparent)`, color:m.color,
      textTransform:'uppercase', letterSpacing:'.04em',
    }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:m.color }}/>
      {m.label}
    </span>
  )
}

function LiveBadge({ isLive, lastSeen }) {
  const color = isLive ? 'var(--ok)' : 'var(--danger)'
  const label = isLive
    ? 'LIVE'
    : lastSeen
      ? `Silencieux depuis ${Math.round((Date.now() - lastSeen) / 60000)}min`
      : 'Aucune donnée'
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'2px 10px', borderRadius:99, fontSize:'var(--fs-2xs)', fontWeight:700,
      background:`color-mix(in srgb, ${color} 18%, transparent)`, color,
    }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:color }}/>
      {label}
    </span>
  )
}

// ── Barre chronologique de connectivité ─────────────────────────────────────
// Segments dérivés de presenceWindow (count() par fenêtre, createEmpty:true).
// Un segment "rouge" signifie absence de télémétrie — cause possible : le device
// a perdu le réseau, OU une panne côté Pi (homepi-api/Telegraf/InfluxDB) a
// empêché l'ingestion. Ce composant ne peut pas distinguer les deux cas.
function PresenceTimeline({ deviceId, rangeKey, setRangeKey }) {
  const { segments, loading } = usePresenceWindow(deviceId, rangeKey)
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <span style={{ fontSize:'var(--fs-xs)', color:'var(--text3)', fontWeight:600 }}>Connectivité</span>
        <div style={{ display:'flex', gap:3 }}>
          {Object.entries(RANGE_CFG).map(([k, c]) => (
            <button key={k} onClick={() => setRangeKey(k)} className="hp-focus-visible" style={{
              padding:'2px 8px', borderRadius:'var(--r-sm)', fontSize:9, fontWeight:700, cursor:'pointer',
              border:'none',
              background: rangeKey === k ? 'var(--accent-vivid)' : 'var(--bg3)',
              color: rangeKey === k ? '#fff' : 'var(--text3)',
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display:'flex', height:20, borderRadius:'var(--r-sm)', overflow:'hidden', gap:1 }}>
        {loading
          ? <div style={{ flex:1, background:'var(--bg3)' }}/>
          : segments.length === 0
            ? <div style={{ flex:1, background:'var(--bg3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'var(--text3)' }}>Pas de données</div>
            : segments.map((s, i) => (
              <div key={i} title={new Date(s.t).toLocaleString()} style={{
                flex:1, background: s.connected ? 'var(--ok)' : 'var(--danger)', opacity:0.85,
              }}/>
            ))
        }
      </div>

      <div style={{ fontSize:9, color:'var(--text3)', marginTop:4, lineHeight:1.4 }}>
        Résolution {RANGE_CFG[rangeKey].every} · un segment rouge peut aussi venir d'une panne
        API/InfluxDB côté Pi, pas uniquement d'une perte réseau du module.
      </div>
    </div>
  )
}

// ── Mini graphe axé métrique — version allégée d'AxisChart (FloorPlanEditor),
// mêmes seuils/domaines partagés via hooks/thresholds.js, sans les marqueurs solaires.
function MiniAxisChart({ series, metric, height = 130 }) {
  if (!series.length) return null
  const vals = series.map(p => p.v)
  const [domMin, domMax] = METRIC_DOMAIN[metric] || [Math.min(...vals), Math.max(...vals)]
  const range = (domMax - domMin) || 1
  const W = 400, PAD = { left:8, right:8, top:8, bottom:8 }
  const pw = W - PAD.left - PAD.right, ph = height - PAD.top - PAD.bottom
  const yOf = v => PAD.top + (1 - (Math.max(domMin, Math.min(domMax, v)) - domMin) / range) * ph
  const pts = series.map((p, i) => `${PAD.left + (i / (series.length - 1)) * pw},${yOf(p.v)}`).join(' ')
  const last = series.at(-1).v
  const color = statusColorForValue(metric, last)

  return (
    <div>
      <div style={{ textAlign:'right', fontFamily:'var(--mono)', fontWeight:700, color, marginBottom:4, fontSize:'var(--fs-sm)' }}>
        {last.toFixed(1)}{METRIC_UNIT[metric] || ''}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  )
}

// ── Tabs par métrique — dérivées dynamiquement des champs réellement publiés
// par CE device (readings), jamais d'une liste statique. Un SCD41 n'a pas de
// pressure, un BME688 n'a pas de co2 — afficher un tab vide serait trompeur.
function MetricTabs({ deviceId, readings, rangeKey }) {
  const METRICS = Object.keys(METRIC_LABEL).filter(m => readings?.[m] != null && readings[m] !== '')
  const [shown, setShown] = useState(METRICS[0] || null)

  useEffect(() => {
    if (METRICS.length && !METRICS.includes(shown)) setShown(METRICS[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [METRICS.join(',')])

  const cfg = RANGE_CFG[rangeKey]
  const hist = useFlux(shown ? FLUX.metricHistory(shown, cfg.start, cfg.every) : null, 30000)

  if (!METRICS.length) {
    return (
      <div style={{ height:130, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>
        Aucune métrique disponible
      </div>
    )
  }

  const series = (hist.data ?? [])
    .filter(r => r.device_id === deviceId)
    .map(r => ({ t: new Date(r._time).getTime(), v: parseFloat(r._value) }))
    .filter(p => !isNaN(p.v))

  return (
    <div>
      <div style={{ display:'flex', gap:4, marginBottom:10, flexWrap:'wrap' }}>
        {METRICS.map(m => (
          <button key={m} onClick={() => setShown(m)} className="hp-focus-visible" style={{
            flex:'1 1 60px', padding:'4px 0', borderRadius:'var(--r-sm)', border:'none', cursor:'pointer',
            fontSize:10, fontWeight:700,
            background: shown === m ? 'var(--accent-soft)' : 'var(--bg3)',
            color: shown === m ? 'var(--accent-vivid)' : 'var(--text3)',
          }}>{METRIC_LABEL[m]}</button>
        ))}
      </div>
      {series.length < 2
        ? <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>Pas assez de données</div>
        : <MiniAxisChart series={series} metric={shown}/>
      }
    </div>
  )
}

// ── Modal principal ──────────────────────────────────────────────────────────
// Vue lecture seule : identité provisioning + statut live + graphes par métrique
// + timeline de connectivité. Les actions (Confirm/Suspend/OTA) restent dans
// FleetTab (expand inline), volontairement séparées de ce composant.
export function DeviceDetailModal({ device, readings, onClose }) {
  const [rangeKey, setRangeKey] = useState('h24')
  if (!device) return null

  const info = device.info
  const liveInfo = device.liveInfo

  return (
    <Modal onClose={onClose}>
      <div className="hp-card hp-card--elevated" style={{
        width:'min(480px,100%)', maxHeight:'88vh', overflow:'auto',
        padding:'var(--sp-5)', boxShadow:'var(--shadow-3)',
      }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'var(--sp-4)' }}>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:'var(--fs-md)', fontWeight:700 }}>{info.device_id}</div>
            <div style={{ display:'flex', gap:8, marginTop:6, flexWrap:'wrap' }}>
              <ProvisioningBadge status={info.status}/>
              <LiveBadge isLive={liveInfo?.isLive} lastSeen={liveInfo?.lastSeen}/>
            </div>
          </div>
          <button onClick={onClose} className="hp-focus-visible" style={{
            background:'none', border:'none', color:'var(--text3)', fontSize:20, cursor:'pointer', lineHeight:1,
          }}>×</button>
        </div>

        {/* Identité provisioning */}
        <div style={{ background:'var(--bg3)', borderRadius:'var(--r-sm)', padding:'var(--sp-2) var(--sp-3)', marginBottom:'var(--sp-4)' }}>
          {[
            ['hw_model',  info.hw_model],
            ['Firmware',  info.fw_version],
            ['Chip ID',   info.chip_id],
            ['Cert exp.', info.cert_expiry ? new Date(info.cert_expiry).toLocaleDateString() : null],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', fontSize:11 }}>
              <span style={{ color:'var(--text3)' }}>{k}</span>
              <span style={{ fontFamily:'var(--mono)', color:'var(--text2)' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Graphes par métrique */}
        <div style={{ marginBottom:'var(--sp-4)' }}>
          <MetricTabs deviceId={info.device_id} readings={readings} rangeKey={rangeKey}/>
        </div>

        {/* Timeline de connectivité */}
        <PresenceTimeline deviceId={info.device_id} rangeKey={rangeKey} setRangeKey={setRangeKey}/>
      </div>
    </Modal>
  )
}