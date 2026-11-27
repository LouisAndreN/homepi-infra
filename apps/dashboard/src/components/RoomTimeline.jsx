import { useState, useMemo, useEffect, useCallback } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { sumLegs } from '../energy/legs.js'
import { roomsFromPlan, ROOM_COLORS } from '../energy/rooms.js'
import { eventIntervals, findGaps, classifyGaps, luxStepEvents, KIND_LABEL } from '../energy/timelineEvents.js'
import { expandRoutines } from '../energy/routines.js'
import { RoutinesEditor } from './RoutinesEditor.jsx'
import { Modal } from './Modal.jsx'
import { API_BASE } from '../config.js'

// Timeline: small multiples on ONE shared time axis (one panel per quantity, one line per room).
// One y-axis per panel: different units never share a scale, nothing is normalised to a common
// "relative state" axis (it hides the real values and invites misreading).
//  - The range selector (top) and the event strip (bottom) float over the charts while scrolling.
//  - Every event's start and end are drawn through all panels.
//  - Missing NILM readings are hatched grey on the power panel, never filled.
//  - Hover moves a cursor; a click pins it (values stay in the legends), Esc or a click on the pin clears it.
//  - Each legend always shows the latest value, and the value under the cursor when there is one.
//  - Routines (declared recurring events) are drawn like events, but outlined: declared, not measured.
//  - Charts are marked data-no-swipe: sliding a finger reads values instead of changing tab (App.jsx).
//    On touch, lifting the finger pins the cursor where it was.

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
  { field: 'lux', label: 'Light', unit: 'lux', digits: 0, compact: true },
]
const EVENT_COLOR = { teensy_update: 'var(--warn)', ota: 'var(--accent)', capture: 'var(--ok)', appliance: 'var(--ok)', light: '#d28e05', routine: '#9887ef' }
const W = 640, PAD = { l: 52, r: 12, t: 8, b: 6 }, PW = W - PAD.l - PAD.r
const LEGEND_W = 190
const pad2 = n => String(n).padStart(2, '0')
const fmtT = (ms, long) => { const d = new Date(ms); return long ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

function niceScale(lo, hi, n = 3) {
  if (!(hi > lo)) hi = lo + 1
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step) }
}

const nearest = (pts, t, maxDt) => {
  if (t == null || !pts.length) return null
  let b = pts[0]
  for (const p of pts) if (Math.abs(p.t - t) < Math.abs(b.t - t)) b = p
  return Math.abs(b.t - t) <= maxDt ? b.v : null
}

// Pointer position -> time, shared by every panel and the strip
function useTimeFromPointer(from, to) {
  return useCallback(e => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const t = from + ((px - PAD.l) / PW) * (to - from)
    return t >= from && t <= to ? t : null
  }, [from, to])
}

function EventMarks({ events, x, H }) {
  return events.map((ev, i) => {
    const x0 = x(ev.start), x1 = x(ev.end), c = EVENT_COLOR[ev.kind] || 'var(--text2)'
    if (x1 < PAD.l || x0 > PAD.l + PW) return null
    return (
      <g key={i} pointerEvents="none">
        {!ev.instant && x1 - x0 > 1 && !ev.declared && <rect x={Math.max(PAD.l, x0)} y={0} width={Math.min(PAD.l + PW, x1) - Math.max(PAD.l, x0)} height={H} fill={c} opacity="0.06" />}
        <line x1={x0} x2={x0} y1={0} y2={H} stroke={c} strokeWidth="1" strokeDasharray={ev.declared ? '1 3' : '3 3'} opacity="0.8" />
        {!ev.instant && !ev.ongoing && <line x1={x1} x2={x1} y1={0} y2={H} stroke={c} strokeWidth="1" strokeDasharray={ev.declared ? '1 3' : '3 3'} opacity="0.8" />}
      </g>
    )
  })
}

function Panel({ id, title, unit, digits, series, from, to, cursor, onHover, onPin, onPinAt, gaps, events, note, zeroFloor, H = 96 }) {
  const toT = useTimeFromPointer(from, to)
  const all = series.flatMap(s => s.pts.map(p => p.v))
  const lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1
  const sc = niceScale(zeroFloor ? 0 : lo, hi)
  const x = t => PAD.l + ((t - from) / (to - from)) * PW
  const y = v => PAD.t + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - PAD.t - PAD.b)
  const n = Math.max(...series.map(s => s.pts.length), 2)
  const step = (to - from) / n * 3
  const segs = pts => {
    const out = []; let cur = []
    for (let i = 0; i < pts.length; i++) {
      if (i && pts[i].t - pts[i - 1].t > step) { out.push(cur); cur = [] }
      cur.push(`${x(pts[i].t).toFixed(1)},${y(pts[i].v).toFixed(1)}`)
    }
    if (cur.length) out.push(cur)
    return out.map(c => c.join(' '))
  }
  const hatch = `hatch-${id}`
  const ct = cursor.t
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${LEGEND_W}px 1fr`, borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-xs)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span><b style={{ color: 'var(--text)' }}>{title}</b> <span style={{ color: 'var(--text3)' }}>{unit}</span></span>
          <span style={{ color: 'var(--text3)', fontSize: 'var(--fs-2xs)' }}>{ct != null ? (cursor.pinned ? 'pinned · now' : 'cursor · now') : 'now'}</span>
        </div>
        {series.map(s => {
          const last = s.pts.length ? s.pts[s.pts.length - 1].v : null
          const atC = nearest(s.pts, ct, step)
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text2)', marginTop: 2 }}>
              <span style={{ width: 10, height: 3, background: s.color, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={s.label}>{s.label}</span>
              {ct != null && <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)', minWidth: 38, textAlign: 'right' }}>{atC != null ? atC.toFixed(digits) : '—'}</span>}
              <span style={{ fontFamily: 'var(--mono)', color: ct != null ? 'var(--text3)' : 'var(--text)', minWidth: 38, textAlign: 'right' }}>{last != null ? last.toFixed(digits) : '—'}</span>
            </div>
          )
        })}
        {note && <div style={{ color: 'var(--text3)', marginTop: 4, lineHeight: 1.4, fontSize: 'var(--fs-2xs)' }}>{note}</div>}
      </div>
      <svg data-no-swipe viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', touchAction: 'pan-y', cursor: 'crosshair' }} role="img" aria-label={`${title} by room`}
        onPointerMove={e => onHover(toT(e))} onPointerLeave={() => onHover(null)}
        onPointerUp={e => { if (e.pointerType === 'touch') { onPinAt(toT(e)); onHover(null) } }}
        onClick={e => { if (e.nativeEvent.pointerType !== 'touch') onPin(toT(e)) }}>
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text3)" strokeWidth="2" opacity="0.55" />
          </pattern>
        </defs>
        {gaps.map((g, i) => {
          const x0 = Math.max(PAD.l, x(g.start)), x1 = Math.min(PAD.l + PW, x(g.end))
          return x1 > x0 ? <rect key={i} x={x0} y={0} width={Math.max(1, x1 - x0)} height={H} fill={`url(#${hatch})`}><title>{g.cause ? 'Teensy update: no NILM readings' : 'No NILM readings (not filled)'}</title></rect> : null
        })}
        <EventMarks events={events} x={x} H={H} />
        {sc.ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + PW} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth=".5" />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="monospace">{+v.toFixed(2)}</text>
          </g>
        ))}
        {series.map(s => segs(s.pts).map((pts, i) => <polyline key={s.label + i} points={pts} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinejoin="round" />))}
        {!series.some(s => s.pts.length) && <text x={PAD.l + PW / 2} y={H / 2} textAnchor="middle" fontSize="10" fill="var(--text3)">no data in this range</text>}
        {ct != null && <>
          <line x1={x(ct)} x2={x(ct)} y1={0} y2={H} stroke="var(--text)" strokeWidth={cursor.pinned ? 1.2 : 0.8} strokeDasharray={cursor.pinned ? 'none' : '3 2'} opacity="0.8" />
          {series.map(s => { const v = nearest(s.pts, ct, step); return v != null ? <circle key={s.label} cx={x(ct)} cy={y(v)} r="3.5" fill={s.color} stroke="var(--bg)" strokeWidth="1.5" /> : null })}
        </>}
      </svg>
    </div>
  )
}

function EventStrip({ lanes, from, to, cursor, onHover, onPin, onPinAt, long }) {
  const [tip, setTip] = useState(null)
  const toT = useTimeFromPointer(from, to)
  const LH = 20, H = lanes.length * LH + 18
  const x = t => PAD.l + ((Math.min(Math.max(t, from), to) - from) / (to - from)) * PW
  const ticks = Array.from({ length: 7 }, (_, i) => from + (i / 6) * (to - from))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${LEGEND_W}px 1fr` }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>
        {lanes.map(l => <div key={l.kind} style={{ height: LH, display: 'flex', alignItems: 'center', padding: '0 var(--sp-3)' }}>{l.label}</div>)}
      </div>
      <div style={{ position: 'relative' }}>
        <svg data-no-swipe viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }} role="img" aria-label="Event timeline"
          onPointerMove={e => onHover(toT(e))} onPointerLeave={() => { onHover(null); setTip(null) }}
          onPointerUp={e => { if (e.pointerType === 'touch') { onPinAt(toT(e)); onHover(null) } }}
          onClick={e => { if (e.nativeEvent.pointerType !== 'touch') onPin(toT(e)) }}>
          <defs>
            <pattern id="hatch-strip" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text3)" strokeWidth="2" opacity="0.7" />
            </pattern>
          </defs>
          {lanes.map((l, i) => (
            <g key={l.kind}>
              <rect x={PAD.l} y={i * LH + 3} width={PW} height={LH - 6} rx="3" fill="none" stroke="var(--border)" strokeDasharray="3 3" />
              {l.items.map((ev, j) => {
                const x0 = x(ev.start), x1 = x(ev.end)
                const fill = ev.kind === 'gap' ? (ev.cause ? EVENT_COLOR.teensy_update : 'url(#hatch-strip)') : EVENT_COLOR[ev.kind] || 'var(--text2)'
                return ev.instant
                  ? <line key={j} x1={x0} x2={x0} y1={i * LH + 2} y2={i * LH + LH - 2} stroke={fill} strokeWidth="2" onPointerEnter={() => setTip({ ev, px: x0 })} />
                  : <rect key={j} x={x0} y={i * LH + 4} width={Math.max(2, x1 - x0)} height={LH - 8} rx="2"
                      fill={ev.declared ? 'none' : fill} stroke={ev.declared ? fill : 'none'} strokeWidth={ev.declared ? 1.5 : 0} opacity={ev.ongoing ? 0.6 : 0.9}
                      onPointerEnter={() => setTip({ ev, px: (x0 + x1) / 2 })} />
              })}
            </g>
          ))}
          {ticks.map((t, i) => <text key={i} x={x(t)} y={H - 3} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="monospace">{fmtT(t, long)}</text>)}
          {cursor.t != null && <line x1={x(cursor.t)} x2={x(cursor.t)} y1={0} y2={H - 13} stroke="var(--text)" strokeWidth={cursor.pinned ? 1.2 : 0.8} strokeDasharray={cursor.pinned ? 'none' : '3 2'} opacity="0.8" />}
        </svg>
        {tip && (
          <div style={{ position: 'absolute', bottom: '100%', left: `${(tip.px / W) * 100}%`, transform: tip.px > W * 0.6 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)', pointerEvents: 'none',
            background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 8px', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-3)', zIndex: 3 }}>
            <div style={{ fontWeight: 700 }}>{tip.ev.kind === 'gap' && tip.ev.cause ? 'Teensy update (no readings)' : tip.ev.kind === 'routine' ? `${tip.ev.detail} (declared)` : KIND_LABEL[tip.ev.kind] || tip.ev.kind}{tip.ev.ongoing ? ' · ongoing' : ''}</div>
            <div style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{fmtT(tip.ev.start, true)}{tip.ev.instant ? '' : ` → ${tip.ev.ongoing ? 'now' : fmtT(tip.ev.end, true)} (${Math.round((tip.ev.end - tip.ev.start) / 60000)} min)`}</div>
            {tip.ev.kind !== 'routine' && (tip.ev.detail || tip.ev.device) && <div style={{ color: 'var(--text3)' }}>{[tip.ev.device, tip.ev.detail].filter(Boolean).join(' · ')}</div>}
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

  // Cursor: hover follows the pointer; a click pins it; Esc or a click near the pin clears it
  const [hoverT, setHoverT] = useState(null)
  const [pinT, setPinT] = useState(null)
  const onPinAt = t => setPinT(t)
  const onPin = t => setPinT(p => (t == null || (p != null && Math.abs(p - t) < (to - from) / 150)) ? null : t)
  useEffect(() => { const k = e => { if (e.key === 'Escape') setPinT(null) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  useEffect(() => { setPinT(null) }, [rangeKey])
  const cursor = hoverT != null ? { t: hoverT, pinned: false } : { t: pinT, pinned: pinT != null }

  const [routines, setRoutines] = useState([])
  const [editRoutines, setEditRoutines] = useState(false)
  useEffect(() => { fetch(`${API_BASE}/api/admin/routines`).then(r => r.ok ? r.json() : null).then(d => setRoutines(d?.routines || [])).catch(() => {}) }, [])
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
  const { gaps } = useMemo(() => {
    const times = presence.data.map(r => Date.parse(r._time)).filter(Number.isFinite).sort((a, b) => a - b)
    return classifyGaps(findGaps(times, from, to, R.gapS), evs)
  }, [presence.data, evs]) // eslint-disable-line react-hooks/exhaustive-deps

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
      return { key: String(key), label: room ? room.label : `Unplaced · ${String(key).slice(-8)}`, color: room ? ROOM_COLORS[key % ROOM_COLORS.length] : 'var(--text3)',
        pts: [...m2.entries()].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t, v: a.reduce((s, x) => s + x, 0) / a.length })) }
    }).sort((a, b) => a.label.localeCompare(b.label))
    return { m, series }
  }).filter(p => p.series.length)

  // Lights switched on/off: steps in each room's lux curve become events (daylight drifts are not steps)
  const luxEvents = useMemo(() => {
    const lux = envPanels.find(p => p.m.field === 'lux')
    return lux ? lux.series.flatMap(s => luxStepEvents(s.pts, now).map(e => ({ ...e, detail: s.label }))) : []
  }, [envPanels.find(p => p.m.field === 'lux')?.series, now]) // eslint-disable-line react-hooks/exhaustive-deps

  const routineEvents = useMemo(() => expandRoutines(routines, from, to), [routines, from, to])
  const allEvents = [...evs, ...luxEvents, ...routineEvents]
  const appliancesByRoom = rooms.filter(r => r.appliances.length).map(r => `${r.label.split(' · ')[0]}: ${r.appliances.map(a => a.label).join(', ')}`)
  const kinds = ['gap', 'teensy_update', 'ota', 'capture', 'appliance', 'light', 'routine']
  const lanes = kinds.map(k => ({ kind: k, label: KIND_LABEL[k], items: k === 'gap' ? gaps : allEvents.filter(e => e.kind === k) }))
    .filter(l => l.kind === 'gap' || l.kind === 'teensy_update' || l.kind === 'routine' || l.items.length)
  const long = R.ms > 24 * 3600e3
  const panelProps = { from, to, cursor, onHover: setHoverT, onPin, onPinAt }

  const overlay = { position: 'sticky', zIndex: 2, background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }
  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      {/* Range selector: floats over the charts */}
      <div style={{ ...overlay, top: 0, padding: 'var(--sp-2) var(--sp-4)', display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', borderBottom: '0.5px solid var(--border)', flexWrap: 'wrap' }}>
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRangeKey(r.key)} className="hp-focus-visible"
            style={{ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
              border: '0.5px solid var(--border)', background: r.key === rangeKey ? 'var(--bg3)' : 'var(--bg2)', color: r.key === rangeKey ? 'var(--text)' : 'var(--text3)' }}>{r.label}</button>
        ))}
        <button onClick={() => setEditRoutines(true)} className="hp-focus-visible"
          style={{ marginLeft: 'var(--sp-2)', padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>
          Routines{routines.length ? ` (${routines.filter(r => r.enabled !== false).length})` : ''}
        </button>
        {pinT != null && (
          <button onClick={() => setPinT(null)} className="hp-focus-visible" title="Esc"
            style={{ marginLeft: 'var(--sp-2)', padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>
            📌 {fmtT(pinT, true)} ✕
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
          {plan ? `${rooms.length} zone${rooms.length === 1 ? '' : 's'} from the floor plan` : 'floor plan unavailable: sensors shown individually'} · click or lift your finger to pin the cursor
        </span>
      </div>

      <div style={{ padding: '0 var(--sp-2)' }}>
        <Panel id="power" title="Power" unit="W · whole home" digits={0} series={powerSeries} gaps={gaps} events={allEvents} zeroFloor {...panelProps}
          note={`Per-room energy needs NILM Layer 1 (appliance labels).${appliancesByRoom.length ? ` On the plan: ${appliancesByRoom.join(' · ')}` : ''}`} />
        {envPanels.map(({ m, series }) => (
          <Panel key={m.field} id={m.field} title={m.label} unit={m.unit} digits={m.digits} series={series} gaps={[]} events={allEvents}
            zeroFloor={m.field === 'lux'} H={m.compact ? 64 : 96} {...panelProps} />
        ))}
        <div style={{ height: 'var(--sp-2)' }} />
      </div>

      {/* Event strip: floats at the bottom, its marks are drawn through every chart above */}
      <div style={{ ...overlay, bottom: 0, padding: 'var(--sp-1) var(--sp-2) 0', borderTop: '0.5px solid var(--border)' }}>
        <EventStrip lanes={lanes} long={long} {...panelProps} />
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', padding: '2px var(--sp-3) var(--sp-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
          <span><svg width="14" height="8" aria-hidden="true"><rect width="14" height="8" fill="url(#hatch-strip)" /></svg> no NILM readings (not filled)</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'var(--warn)', verticalAlign: 'middle', marginRight: 4 }} />Teensy update: values around it may be wrong</span>
          <span>Light: lux steps (switching), daylight drift ignored · coarse at {R.every} resolution</span>
          <span><svg width="14" height="8" aria-hidden="true"><rect x="1" y="1" width="12" height="6" fill="none" stroke="#9887ef" strokeWidth="1.5" /></svg> routine (declared, not measured)</span>
        </div>
      </div>

      {editRoutines && (
        <Modal onClose={() => setEditRoutines(false)}>
          <RoutinesEditor routines={routines} onSaved={d => setRoutines(d.routines || [])} onClose={() => setEditRoutines(false)} />
        </Modal>
      )}
    </div>
  )
}
