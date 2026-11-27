import { useState, useMemo, useEffect } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { ENERGY } from '../config.js'
import { sumLegs } from '../energy/legs.js'
import { roomsFromPlan, ROOM_COLORS } from '../energy/rooms.js'
import { eventIntervals, findGaps, classifyGaps, KIND_LABEL } from '../energy/timelineEvents.js'

// Timeline: small multiples on ONE shared time axis (one panel per quantity, one line per room),
// then the event strip. One y-axis per panel: different units never share a scale, and nothing is
// normalised to a common "relative state" axis (it hides the real values and invites misreading).
// NILM data gaps and Teensy updates are shaded on the power panel only (the environmental sensors
// are not affected by a Teensy flash), labelled, never filled.

const RANGES = [
  { key: 'h6', label: '6 h', ms: 6 * 3600e3, every: '1m', gapEvery: '10s', gapS: 30 },
  { key: 'h24', label: '24 h', ms: 24 * 3600e3, every: '5m', gapEvery: '15s', gapS: 45 },
  { key: 'd3', label: '3 days', ms: 72 * 3600e3, every: '15m', gapEvery: '1m', gapS: 150 },
  { key: 'd7', label: '7 days', ms: 168 * 3600e3, every: '30m', gapEvery: '2m', gapS: 300 },
]
const METRICS = [
  { field: 'temperature', label: 'Temperature', unit: '°C', digits: 1 },
  { field: 'humidity', label: 'Humidity', unit: '%RH', digits: 0 },
  { field: 'co2', label: 'CO₂', unit: 'ppm', digits: 0 },
  { field: 'lux', label: 'Light', unit: 'lux', digits: 0 },
]
const W = 640, PAD = { l: 52, r: 12, t: 8, b: 6 }, PW = W - PAD.l - PAD.r
const pad2 = n => String(n).padStart(2, '0')
const fmtT = (ms, long) => { const d = new Date(ms); return long ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

function niceScale(lo, hi, n = 3) {
  if (!(hi > lo)) { hi = lo + 1 }
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) }
}

function Bands({ bands, x, H }) {
  return bands.map((b, i) => {
    const x0 = Math.max(PAD.l, x(b.start)), x1 = Math.min(PAD.l + PW, x(b.end))
    if (x1 <= x0) return null
    const update = b.cause === 'teensy_update' || b.kind === 'teensy_update'
    return <rect key={i} x={x0} y={0} width={Math.max(1, x1 - x0)} height={H}
      fill={b.kind === 'suspect' ? 'var(--warn)' : update ? 'var(--warn)' : 'var(--text3)'} opacity={b.kind === 'suspect' ? 0.08 : update ? 0.16 : 0.12}>
      <title>{b.kind === 'suspect' ? b.detail : update ? `Teensy update: no readings, values around it may be wrong` : 'No NILM readings'}</title>
    </rect>
  })
}

function Panel({ title, unit, digits, series, from, to, hoverT, setHoverT, bands, note, H = 96 }) {
  const all = series.flatMap(s => s.pts.map(p => p.v))
  const sc = niceScale(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1)
  const x = t => PAD.l + ((t - from) / (to - from)) * PW
  const y = v => PAD.t + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - PAD.t - PAD.b)
  const step = series[0]?.pts.length > 1 ? (to - from) / Math.max(1, series[0].pts.length) * 3 : 600000
  const segs = pts => { const out = []; let cur = []; for (let i = 0; i < pts.length; i++) { if (i && pts[i].t - pts[i - 1].t > step) { out.push(cur); cur = [] } cur.push(`${x(pts[i].t).toFixed(1)},${y(pts[i].v).toFixed(1)}`) } if (cur.length) out.push(cur); return out.map(c => c.join(' ')) }
  const valueAt = s => { if (hoverT == null || !s.pts.length) return null; let b = s.pts[0]; for (const p of s.pts) if (Math.abs(p.t - hoverT) < Math.abs(b.t - hoverT)) b = p; return Math.abs(b.t - hoverT) <= step ? b.v : null }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-xs)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</div>
        <div style={{ color: 'var(--text3)' }}>{unit}</div>
        {series.length > 1 || hoverT != null ? series.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text2)', marginTop: 2 }}>
            <span style={{ width: 10, height: 3, background: s.color, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 96 }} title={s.label}>{s.short || s.label}</span>
            {hoverT != null && <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--text)' }}>{valueAt(s) != null ? valueAt(s).toFixed(digits) : '—'}</span>}
          </div>
        )) : null}
        {note && <div style={{ color: 'var(--text3)', marginTop: 4, lineHeight: 1.4 }}>{note}</div>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', touchAction: 'pan-y' }} role="img" aria-label={`${title} by room`}
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const t = from + ((px - PAD.l) / PW) * (to - from); setHoverT(t >= from && t <= to ? t : null) }}
        onPointerLeave={() => setHoverT(null)}>
        <Bands bands={bands} x={x} H={H} />
        {sc.ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + PW} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth=".5" />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="monospace">{+v.toFixed(2)}</text>
          </g>
        ))}
        {series.map(s => segs(s.pts).map((pts, i) => <polyline key={s.label + i} points={pts} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinejoin="round" />))}
        {!series.some(s => s.pts.length) && <text x={PAD.l + PW / 2} y={H / 2} textAnchor="middle" fontSize="10" fill="var(--text3)">no data in this range</text>}
        {hoverT != null && <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={H} stroke="var(--text2)" strokeWidth=".8" />}
      </svg>
    </div>
  )
}

function EventStrip({ lanes, from, to, hoverT, setHoverT, long }) {
  const [tip, setTip] = useState(null)
  const LH = 22, H = lanes.length * LH + 20
  const x = t => PAD.l + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * PW
  const ticks = Array.from({ length: 7 }, (_, i) => from + (i / 6) * (to - from))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', position: 'relative' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>
        {lanes.map(l => <div key={l.kind} style={{ height: LH, display: 'flex', alignItems: 'center', padding: '0 var(--sp-3)' }}>{l.label}</div>)}
      </div>
      <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Event timeline"
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const t = from + ((px - PAD.l) / PW) * (to - from); setHoverT(t >= from && t <= to ? t : null) }}
        onPointerLeave={() => { setHoverT(null); setTip(null) }}>
        {lanes.map((l, i) => (
          <g key={l.kind}>
            <rect x={PAD.l} y={i * LH + 4} width={PW} height={LH - 8} rx="3" fill="none" stroke="var(--border)" strokeDasharray="3 3" />
            {l.items.map((ev, j) => {
              const x0 = x(ev.start), x1 = x(ev.end)
              const color = ev.kind === 'gap' ? (ev.cause ? 'var(--warn)' : 'var(--text3)') : ev.kind === 'teensy_update' ? 'var(--warn)' : ev.kind === 'ota' ? 'var(--accent)' : 'var(--ok)'
              return ev.instant
                ? <line key={j} x1={x0} x2={x0} y1={i * LH + 3} y2={i * LH + LH - 3} stroke={color} strokeWidth="2" onPointerEnter={() => setTip({ ev, px: x0 })} />
                : <rect key={j} x={x0} y={i * LH + 5} width={Math.max(2, x1 - x0)} height={LH - 10} rx="2" fill={color} opacity={ev.ongoing ? 0.6 : 0.9}
                    onPointerEnter={() => setTip({ ev, px: (x0 + x1) / 2 })} />
            })}
          </g>
        ))}
        {ticks.map((t, i) => <text key={i} x={x(t)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="monospace">{fmtT(t, long)}</text>)}
        {hoverT != null && <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={H - 14} stroke="var(--text2)" strokeWidth=".8" />}
      </svg>
      {tip && (
        <div style={{ position: 'absolute', top: 0, left: `${(tip.px / W) * 100}%`, transform: tip.px > W * 0.6 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)', pointerEvents: 'none',
          background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 8px', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-3)', zIndex: 2 }}>
          <div style={{ fontWeight: 700 }}>{tip.ev.kind === 'gap' && tip.ev.cause ? 'Teensy update (no readings)' : KIND_LABEL[tip.ev.kind] || tip.ev.kind}{tip.ev.ongoing ? ' · ongoing' : ''}</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmtT(tip.ev.start, true)}{tip.ev.instant ? '' : ` → ${fmtT(tip.ev.end, true)} (${Math.round((tip.ev.end - tip.ev.start) / 1000)} s)`}</div>
          {(tip.ev.detail || tip.ev.device) && <div style={{ color: 'var(--text3)' }}>{[tip.ev.device, tip.ev.detail].filter(Boolean).join(' · ')}</div>}
        </div>
      )}
      </div>
    </div>
  )
}

export function RoomTimeline({ legs }) {
  const [rangeKey, setRangeKey] = useState('h24')
  const R = RANGES.find(r => r.key === rangeKey)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t) }, [])
  const to = now, from = now - R.ms
  const [hoverT, setHoverT] = useState(null)

  // Rooms from the floor plan editor's document (same API as the editor)
  const [plan, setPlan] = useState(null)
  useEffect(() => { fetch('/api/admin/floorplans').then(r => r.ok ? r.json() : null).then(setPlan).catch(() => setPlan(null)) }, [])
  const rooms = useMemo(() => roomsFromPlan(plan), [plan])
  const roomOfDevice = useMemo(() => { const m = {}; rooms.forEach((r, i) => r.deviceIds.forEach(d => { m[d] = i })); return m }, [rooms])

  const start = `-${Math.round(R.ms / 1000)}s`
  const power = useFlux(FLUX.nilmPower(start, 'now()', R.every), 60000)
  const presence = useFlux(FLUX.nilmPresence(start, R.gapEvery), 60000)
  const events = useFlux(FLUX.homepiEvents(start), 60000)
  const env = METRICS.map(m => ({ m, q: useFlux(FLUX.metricHistory(m.field, start, R.every), 120000) })) // eslint-disable-line react-hooks/rules-of-hooks

  const evs = useMemo(() => eventIntervals(events.data, now), [events.data, now])
  const { gaps, suspect } = useMemo(() => {
    const times = presence.data.map(r => Date.parse(r._time)).filter(Number.isFinite).sort((a, b) => a - b)
    return classifyGaps(findGaps(times, from, to, R.gapS), evs)
  }, [presence.data, evs]) // eslint-disable-line react-hooks/exhaustive-deps
  const bands = [...gaps, ...suspect, ...evs.filter(e => e.kind === 'teensy_update')]

  const powerSeries = [{ label: 'Whole home', color: ROOM_COLORS[0], pts: sumLegs(power.data, legs).map(p => ({ t: p.t, v: p.w })) }]
  const envPanels = env.map(({ m, q }) => {
    const byRoom = new Map()
    for (const r of q.data) {
      const ri = roomOfDevice[r.device_id]
      const key = ri ?? `dev:${r.device_id}`
      const t = Date.parse(r._time), v = parseFloat(r._value)
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      if (!byRoom.has(key)) byRoom.set(key, new Map())
      const m2 = byRoom.get(key); const a = m2.get(t) || []; a.push(v); m2.set(t, a)
    }
    const series = [...byRoom.entries()].map(([key, m2]) => {
      const room = typeof key === 'number' ? rooms[key] : null
      const label = room ? room.label : `Not on the plan · ${String(key).slice(-8)}`
      const color = room ? ROOM_COLORS[key % ROOM_COLORS.length] : 'var(--text3)'
      return { label, short: room ? label : 'Unplaced', color,
        pts: [...m2.entries()].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t, v: a.reduce((s, x) => s + x, 0) / a.length })) }
    }).sort((a, b) => a.label.localeCompare(b.label))
    return { m, series }
  }).filter(p => p.series.length)

  const appliancesByRoom = rooms.filter(r => r.appliances.length).map(r => `${r.label.split(' · ')[0]}: ${r.appliances.map(a => a.label).join(', ')}`)
  const kinds = ['gap', 'teensy_update', 'ota', 'capture', 'appliance']
  const lanes = kinds.map(k => ({ kind: k, label: KIND_LABEL[k], items: k === 'gap' ? gaps : evs.filter(e => e.kind === k) }))
    .filter(l => l.kind === 'gap' || l.kind === 'teensy_update' || l.items.length)
  const long = R.ms > 24 * 3600e3

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ padding: 'var(--sp-2) var(--sp-4)', display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', borderBottom: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRangeKey(r.key)} className="hp-focus-visible"
            style={{ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
              border: '0.5px solid var(--border)', background: r.key === rangeKey ? 'var(--bg3)' : 'var(--bg2)', color: r.key === rangeKey ? 'var(--text)' : 'var(--text3)' }}>{r.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
          {plan ? `${rooms.length} zone${rooms.length === 1 ? '' : 's'} from the floor plan` : 'floor plan unavailable: sensors shown individually'}
          {hoverT != null ? ` · ${fmtT(hoverT, true)}` : ''}
        </span>
      </div>

      <div style={{ padding: '0 var(--sp-2)' }}>
        <Panel title="Power" unit="W · whole home" digits={0} series={powerSeries} from={from} to={to} hoverT={hoverT} setHoverT={setHoverT} bands={bands}
          note={`Per-room energy needs NILM Layer 1 (appliance labels).${appliancesByRoom.length ? ` Appliances on the plan: ${appliancesByRoom.join(' · ')}` : ''}`} />
        {envPanels.map(({ m, series }) => (
          <Panel key={m.field} title={m.label} unit={m.unit} digits={m.digits} series={series} from={from} to={to} hoverT={hoverT} setHoverT={setHoverT} bands={[]} />
        ))}
        <EventStrip lanes={lanes} from={from} to={to} hoverT={hoverT} setHoverT={setHoverT} long={long} />
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
          <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'var(--text3)', opacity: 0.35, verticalAlign: 'middle', marginRight: 4 }} />no NILM readings (not filled)</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'var(--warn)', opacity: 0.45, verticalAlign: 'middle', marginRight: 4 }} />Teensy update: values around it may be wrong</span>
          <span>One line per zone; a zone with several sensors shows their mean.</span>
        </div>
      </div>
    </div>
  )
}
