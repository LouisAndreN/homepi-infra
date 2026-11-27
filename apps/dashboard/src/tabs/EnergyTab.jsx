import { useState, useMemo, useEffect, useRef } from 'react'
import { useStore, DEFAULT_CONTRACT } from '../store/index.jsx'
import { Modal } from '../components/Modal.jsx'
import { CtPolarityGuide } from '../components/CtPolarityGuide.jsx'
import { NilmCalibrationWizard } from '../components/NilmCalibrationWizard.jsx'
import { RoomTimeline } from '../components/RoomTimeline.jsx'
import { eventIntervals, findGaps, classifyGaps } from '../energy/timelineEvents.js'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { ENERGY, API_BASE } from '../config.js'
import { LEG_FIELDS, ctKeyOf, resolveLegs, sumLegs } from '../energy/legs.js'

// Energy tab: live whole-home figures from the NILM pipeline
// (Teensy -> XIAO ESP32-S3 -> MQTT iot/<id>/nilm -> Telegraf -> iot-hot/nilm_readings).
// Every number on this tab comes from InfluxDB. No simulated data.
//
// Energy is integrated in the browser from fixed-width window means
// (1 min for today, 5 min for history): energy = mean W x window length.
// A window with no sample contributes nothing. Flux integral() would draw a
// straight line across a gap and invent the energy of a bridge outage, so it
// is deliberately not used. Coverage is shown instead so a gap stays visible.

const DAY_MIN = 1440

// ─── Small helpers ─────────────────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0')
const dayKeyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const monthKeyOf = key => key.slice(0, 7)
function midnightOf(d) { const m = new Date(d); m.setHours(0, 0, 0, 0); return m }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const fluxTime = ms => `time(v: "${new Date(ms).toISOString()}")`

const isNum = v => v != null && Number.isFinite(v)
const fmtKwh = (v, digits = 2) => isNum(v) ? `${v.toFixed(digits)} kWh` : '—'
const fmtW = v => !isNum(v) ? '—' : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`
const fmtYen = v => isNum(v) ? `¥${Math.round(v).toLocaleString()}` : '—'
const fmtHM = m => `${pad2(Math.floor(m / 60) % 24)}:${pad2(Math.floor(m % 60))}`
const fmtPct = v => isNum(v) ? `${Math.round(v * 100)}%` : '—'

function median(a) {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y), k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}
function percentile(a, p) {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}

// ─── Data shaping ──────────────────────────────────────────────────────────────
// Leg logic (calibration state, totals): ../energy/legs.js

// Window means (t = window start) -> one object per local calendar day:
// kwh[i] = energy of slot i, cum[i] = energy before slot i, coverage = filled slots / slots.
function buildDays(points, stepMin, nowMs = Infinity) {
  const slots = DAY_MIN / stepMin
  const days = new Map()
  for (const p of points) {
    const d = new Date(p.t)
    const key = dayKeyOf(d)
    let day = days.get(key)
    if (!day) {
      day = { key, midnight: midnightOf(d).getTime(), step: stepMin,
        kwh: new Array(slots).fill(0), has: new Array(slots).fill(false),
        legKwh: Object.fromEntries(LEG_FIELDS.map(f => [f, 0])) }
      days.set(key, day)
    }
    const i = Math.floor((p.t - day.midnight) / 60000 / stepMin)
    if (i < 0 || i >= slots) continue
    // The window still in progress only counts for the part already elapsed
    const elapsed = Math.max(0, Math.min(1, (nowMs - p.t) / (stepMin * 60000)))
    const h = (stepMin / 60) * elapsed
    day.kwh[i] = p.w * h / 1000
    day.has[i] = true
    for (const f of LEG_FIELDS) if (p.legs[f] != null) day.legKwh[f] += p.legs[f] * h / 1000
  }
  for (const day of days.values()) {
    day.cum = [0]
    for (let i = 0; i < slots; i++) day.cum.push(day.cum[i] + day.kwh[i])
    day.total = day.cum[slots]
    day.filled = day.has.filter(Boolean).length
    day.coverage = day.filled / slots
  }
  return days
}

// Cumulative kWh of a day at minute m (linear inside the slot containing m)
function cumAt(day, m) {
  const n = day.kwh.length, s = day.step
  const i = Math.max(0, Math.min(n, Math.floor(m / s)))
  if (i >= n) return day.cum[n]
  return day.cum[i] + day.kwh[i] * Math.max(0, Math.min(1, (m - i * s) / s))
}

// ─── Tariff ────────────────────────────────────────────────────────────────────
// Contract tiers are MONTHLY kWh bands (Japanese 従量電灯). The marginal cost of a
// day therefore depends on where the month already stands: a day that pushes the
// month into tier 2 costs more than the same day on the 1st.
function energyCost(fromKwh, toKwh, contract) {
  const el = contract?.utilities?.electricity
  if (!el?.enabled || !(toKwh > fromKwh)) return 0
  let c = 0
  for (const t of el.tiers || []) {
    const lo = Math.max(fromKwh, t.from || 0), hi = Math.min(toKwh, t.to ?? Infinity)
    if (hi > lo) c += (hi - lo) * t.ratePerKwh
  }
  return c
}
function dayCost(kwh, monthBefore, contract) {
  const el = contract?.utilities?.electricity
  if (!el?.enabled || !isNum(kwh) || !isNum(monthBefore)) return null
  return energyCost(monthBefore, monthBefore + kwh, contract) + (el.standingChargePerDay || 0)
}
function tierAt(kwh, contract) {
  const tiers = contract?.utilities?.electricity?.tiers || []
  return tiers.find(t => kwh >= (t.from || 0) && kwh < (t.to ?? Infinity)) || tiers.at(-1) || null
}

// ─── Japan tariff periods ──────────────────────────────────────────────────────
// Based on TEPCO Smart Life plan pattern
const JAPAN_PERIODS = [
  { from:0,  to:8,  label:'夜間 Off-peak', color:'#3B82F6', textColor:'#60A5FA' }, // Blue
  { from:8,  to:13, label:'昼間 Standard', color:'#d4d4d8', textColor:'#e2e4ec' }, // White
  { from:13, to:17, label:'ピーク Peak',   color:'#EF4444', textColor:'#F87171' }, // Red
  { from:17, to:22, label:'昼間 Standard', color:'#d4d4d8', textColor:'#e2e4ec' }, // White
  { from:22, to:24, label:'夜間 Off-peak', color:'#3B82F6', textColor:'#60A5FA' }, // Blue
]

function getCurrentPeriod(){
  const h=new Date().getHours()
  return JAPAN_PERIODS.find(p=>h>=p.from&&h<p.to)||JAPAN_PERIODS[1]
}

// ─── Charts ────────────────────────────────────────────────────────────────────
// Plain SVG on the shared tokens. Series identity: Today = accent solid,
// Yesterday = neutral dashed, Prediction = accent dashed + range band.
// Status colours (ok/danger) are kept for the prediction verdict badge only.
const CW = 600, CPAD = { top: 12, right: 14, bottom: 24, left: 50 }

// Axis scale: step from {1, 2, 2.5, 5} x 10^k giving about 4 intervals,
// so ticks read 0 / 500 / 1000 / 1500 instead of 0 / 625 / 1250.
function niceScale(v, intervals = 4) {
  const raw = Math.max(v, 1e-6) / intervals
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(st => st >= raw)
  const max = Math.ceil(v / step) * step || step
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) }
}

// Split [{m,v}] into polylines wherever two samples are more than gapM apart,
// so a data gap renders as a gap instead of a straight line across it.
function toSegments(pts, mx, vy, gapM) {
  const segs = []
  let cur = []
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].m - pts[i - 1].m > gapM) { if (cur.length) segs.push(cur); cur = [] }
    cur.push(`${mx(pts[i].m).toFixed(1)},${vy(pts[i].v).toFixed(1)}`)
  }
  if (cur.length) segs.push(cur)
  return segs.map(s => s.join(' '))
}

function ChartTooltip({ x, rows, title }) {
  if (!rows?.length) return null
  const left = `${(x / CW) * 100}%`
  const flip = x > CW * 0.62
  return (
    <div style={{ position: 'absolute', top: 4, left, transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
      pointerEvents: 'none', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 'var(--r-sm)',
      padding: '6px 8px', fontSize: 'var(--fs-2xs)', color: 'var(--text)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-3)', zIndex: 2 }}>
      <div style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', marginBottom: 3 }}>{title}</div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.6 }}>
          <svg width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={r.stroke} strokeWidth="2" strokeDasharray={r.dash || 'none'} /></svg>
          <span style={{ color: 'var(--text2)' }}>{r.label}</span>
          <span style={{ marginLeft: 'auto', paddingLeft: 10, fontFamily: 'var(--mono)', fontWeight: 700 }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function useMinuteHover() {
  const [hm, setHm] = useState(null)
  const pw = CW - CPAD.left - CPAD.right
  const handlers = {
    onPointerMove: e => {
      const r = e.currentTarget.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * CW
      const m = ((x - CPAD.left) / pw) * DAY_MIN
      setHm(m >= 0 && m <= DAY_MIN ? m : null)
    },
    onPointerLeave: () => setHm(null),
  }
  return [hm, handlers]
}

function TimeAxes({ H, yMax, ticks, unit, fmtTick }) {
  const pw = CW - CPAD.left - CPAD.right, ph = H - CPAD.top - CPAD.bottom
  const mx = m => CPAD.left + (m / DAY_MIN) * pw
  const vy = v => CPAD.top + (1 - v / yMax) * ph
  return (
    <g>
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={CPAD.left} y1={vy(v)} x2={CPAD.left + pw} y2={vy(v)} stroke="var(--border)" strokeWidth=".5" />
          <text x={CPAD.left - 5} y={vy(v) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="monospace">{fmtTick(v)}</text>
        </g>
      ))}
      <text x={10} y={CPAD.top + ph / 2} textAnchor="middle" fontSize="9" fill="var(--text3)" transform={`rotate(-90,10,${CPAD.top + ph / 2})`}>{unit}</text>
      {[0, 6, 12, 18, 24].map(h => (
        <text key={h} x={mx(h * 60)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="monospace">{h}:00</text>
      ))}
    </g>
  )
}

function CumulativeChart({ todayDay, nowMin, yesterday, pred, H = 190 }) {
  const [hm, hover] = useMinuteHover()
  const pw = CW - CPAD.left - CPAD.right, ph = H - CPAD.top - CPAD.bottom

  const todayPts = useMemo(() => {
    if (!todayDay) return []
    const end = Math.min(DAY_MIN, Math.floor(nowMin) + 1)
    return Array.from({ length: end + 1 }, (_, m) => ({ m, v: todayDay.cum[m] }))
  }, [todayDay, nowMin])
  const yPts = useMemo(() => yesterday ? yesterday.cum.map((v, i) => ({ m: i * yesterday.step, v })) : [], [yesterday])

  const { max: yMax, ticks } = niceScale(Math.max(yesterday?.total || 0, pred?.hi || 0, todayPts.at(-1)?.v || 0, 0.5))
  const mx = m => CPAD.left + (m / DAY_MIN) * pw
  const vy = v => CPAD.top + (1 - v / yMax) * ph

  const band = pred?.curve?.length > 1
    ? `${pred.curve.map(p => `${mx(p.m)},${vy(p.hi)}`).join(' ')} ${[...pred.curve].reverse().map(p => `${mx(p.m)},${vy(p.lo)}`).join(' ')}`
    : null
  const predLine = pred?.curve?.map(p => `${mx(p.m)},${vy(p.mid)}`).join(' ')
  const curKwh = todayPts.at(-1)?.v

  const rows = hm == null ? null : [
    hm <= nowMin && todayDay && { label: 'Today', value: fmtKwh(cumAt(todayDay, hm)), stroke: 'var(--accent)' },
    hm > nowMin && pred && { label: 'Prediction', value: fmtKwh(interpPred(pred.curve, hm)), stroke: 'var(--accent)', dash: '4 3' },
    yesterday && { label: 'Yesterday', value: fmtKwh(cumAt(yesterday, hm)), stroke: 'var(--text3)', dash: '4 3' },
  ].filter(Boolean)

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${CW} ${H}`} style={{ display: 'block', touchAction: 'pan-y' }} {...hover}
        role="img" aria-label={`Cumulative energy today ${fmtKwh(curKwh)}${yesterday ? `, yesterday ${fmtKwh(yesterday.total)}` : ''}`}>
        <TimeAxes H={H} yMax={yMax} ticks={ticks} unit="kWh" fmtTick={v => v.toFixed(yMax < 5 ? 1 : 0)} />
        {band && <polygon points={band} fill="var(--accent-soft)" opacity="0.6" />}
        {yPts.length > 1 && <polyline points={yPts.map(p => `${mx(p.m)},${vy(p.v)}`).join(' ')} fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7" />}
        {todayPts.length > 1 && <polyline points={todayPts.map(p => `${mx(p.m)},${vy(p.v)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {predLine && <polyline points={predLine} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.8" />}
        <line x1={mx(nowMin)} y1={CPAD.top} x2={mx(nowMin)} y2={CPAD.top + ph} stroke="var(--text3)" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.6" />
        {isNum(curKwh) && <circle cx={mx(nowMin)} cy={vy(curKwh)} r="4" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />}
        {pred && <circle cx={mx(DAY_MIN)} cy={vy(pred.total)} r="4" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />}
        {hm != null && <line x1={mx(hm)} y1={CPAD.top} x2={mx(hm)} y2={CPAD.top + ph} stroke="var(--text2)" strokeWidth="0.8" />}
      </svg>
      {hm != null && <ChartTooltip x={mx(hm)} title={fmtHM(hm)} rows={rows} />}
    </div>
  )
}

function interpPred(curve, m) {
  if (!curve?.length) return null
  if (m <= curve[0].m) return curve[0].mid
  for (let i = 1; i < curve.length; i++) {
    if (m <= curve[i].m) {
      const a = curve[i - 1], b = curve[i], f = (m - a.m) / ((b.m - a.m) || 1)
      return a.mid + (b.mid - a.mid) * f
    }
  }
  return curve.at(-1).mid
}

function PowerChart({ pts, nowMin, baseW, bands = [], H = 150 }) {
  const [hm, hover] = useMinuteHover()
  const pw = CW - CPAD.left - CPAD.right, ph = H - CPAD.top - CPAD.bottom
  const maxW = Math.max(...pts.map(p => p.v), 100)
  const { max: yMax, ticks } = niceScale(maxW)
  const mx = m => CPAD.left + (m / DAY_MIN) * pw
  const vy = v => CPAD.top + (1 - Math.max(0, v) / yMax) * ph
  const segs = toSegments(pts, mx, vy, 2.5)

  let hv = null
  if (hm != null && pts.length) {
    const near = pts.reduce((b, p) => Math.abs(p.m - hm) < Math.abs(b.m - hm) ? p : b, pts[0])
    if (Math.abs(near.m - hm) <= 2) hv = near
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${CW} ${H}`} style={{ display: 'block', touchAction: 'pan-y' }} {...hover}
        role="img" aria-label={`Whole-home power today, 1-minute mean, peak ${fmtW(maxW)}`}>
        <TimeAxes H={H} yMax={yMax} ticks={ticks} unit="W" fmtTick={v => v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : Math.round(v)} />
        {bands.map((b, i) => {
          const x0 = mx(Math.max(0, b.m0)), x1 = mx(Math.min(DAY_MIN, b.m1))
          if (x1 <= x0) return null
          return <rect key={`b${i}`} x={x0} y={CPAD.top} width={Math.max(1, x1 - x0)} height={ph} fill={b.update ? 'var(--warn)' : 'var(--text3)'} opacity={b.suspect ? 0.08 : b.update ? 0.18 : 0.12}>
            <title>{b.suspect ? 'Readings right after a Teensy update may be wrong' : b.update ? 'Teensy update: no readings (not filled)' : 'No NILM readings (not filled)'}</title>
          </rect>
        })}
        {isNum(baseW) && <line x1={CPAD.left} y1={vy(baseW)} x2={CPAD.left + pw} y2={vy(baseW)} stroke="var(--text3)" strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />}
        {segs.map((s, i) => <polyline key={i} points={s} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />)}
        <line x1={mx(nowMin)} y1={CPAD.top} x2={mx(nowMin)} y2={CPAD.top + ph} stroke="var(--text3)" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.6" />
        {hv && <>
          <line x1={mx(hv.m)} y1={CPAD.top} x2={mx(hv.m)} y2={CPAD.top + ph} stroke="var(--text2)" strokeWidth="0.8" />
          <circle cx={mx(hv.m)} cy={vy(hv.v)} r="4" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />
        </>}
      </svg>
      {hv && <ChartTooltip x={mx(hv.m)} title={fmtHM(hv.m)} rows={[
        { label: 'Power (1 min mean)', value: fmtW(hv.v), stroke: 'var(--accent)' },
        ...(isNum(baseW) ? [{ label: 'Base load', value: fmtW(baseW), stroke: 'var(--text3)', dash: '2 3' }] : []),
      ]} />}
    </div>
  )
}

function DailyBars({ bars, H = 140 }) {
  const [hi, setHi] = useState(null)
  const pw = CW - CPAD.left - CPAD.right, ph = H - CPAD.top - CPAD.bottom
  const { max: yMax, ticks } = niceScale(Math.max(...bars.map(b => b.kwh || 0), 0.5), 3)
  const slot = pw / Math.max(1, bars.length), bw = Math.min(46, slot - 8)
  const vy = v => CPAD.top + (1 - v / yMax) * ph

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${CW} ${H}`} style={{ display: 'block' }} role="img" aria-label="Daily energy, last days">
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={CPAD.left} y1={vy(v)} x2={CPAD.left + pw} y2={vy(v)} stroke="var(--border)" strokeWidth=".5" />
            <text x={CPAD.left - 5} y={vy(v) + 3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="monospace">{v.toFixed(yMax < 5 ? 1 : 0)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = CPAD.left + i * slot + (slot - bw) / 2
          const v = b.kwh || 0, y = vy(v), h = Math.max(0, CPAD.top + ph - y)
          const r = Math.min(4, h / 2, bw / 2)
          const path = h > 0
            ? `M${x},${CPAD.top + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${CPAD.top + ph} Z`
            : null
          return (
            <g key={b.key} onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)} style={{ cursor: 'default' }}>
              <rect x={CPAD.left + i * slot} y={CPAD.top} width={slot} height={ph} fill="transparent" />
              {path && <path d={path} fill="var(--accent)" opacity={b.partial ? 0.45 : (b.coverage < ENERGY.minCoverage ? 0.6 : 1)} />}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={b.partial ? 'var(--text2)' : 'var(--text3)'} fontFamily="monospace">{b.label}</text>
            </g>
          )
        })}
        <line x1={CPAD.left} y1={CPAD.top + ph} x2={CPAD.left + pw} y2={CPAD.top + ph} stroke="var(--border)" strokeWidth="1" />
      </svg>
      {hi != null && (
        <ChartTooltip x={CPAD.left + hi * slot + slot / 2} title={bars[hi].key + (bars[hi].partial ? ' · so far' : '')} rows={[
          { label: 'Energy', value: fmtKwh(bars[hi].kwh), stroke: 'var(--accent)' },
          { label: 'Data coverage', value: fmtPct(bars[hi].coverage), stroke: 'transparent' },
        ]} />
      )}
    </div>
  )
}

// ─── 24h Japan tariff timeline ─────────────────────────────────────────────────
function PeakTimeline24h(){
  const now=new Date()
  const currentHour=now.getHours()+now.getMinutes()/60
  const curPeriod=getCurrentPeriod()

  return(
    <div className="hp-card" style={{marginBottom:'var(--sp-3)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-3)'}}>
        <div className="hp-eyebrow">24h Tariff · Japan</div>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:curPeriod.textColor}}>
          {curPeriod.label} · Now
        </div>
      </div>

      {/* Hour bars */}
      <div style={{display:'flex',height:28,borderRadius:'var(--r-sm)',overflow:'hidden',gap:1,marginBottom:'var(--sp-2)'}}>
        {Array.from({length:24},(_,h)=>{
          const period=JAPAN_PERIODS.find(p=>h>=p.from&&h<p.to)
          const isCurrent=h===Math.floor(currentHour)
          return(
            <div key={h} title={`${h}:00 — ${period?.label}`}
              style={{flex:1,background:period?.color||'#565c72',opacity:isCurrent?1:0.45,outline:isCurrent?`2px solid white`:'none',position:'relative',zIndex:isCurrent?1:0}}/>
          )
        })}
      </div>

      {/* X labels */}
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
        {[0,6,12,18,23].map(h=><span key={h} style={{fontSize:9,color:'var(--text3)',fontFamily:'monospace'}}>{h}:00</span>)}
      </div>

      {/* Legend */}
      <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
        {[['#3B82F6','夜間 Off-peak','22:00–08:00'],['#d4d4d8','昼間 Standard','08:00–13:00, 17:00–22:00'],['#EF4444','ピーク Peak','13:00–17:00']].map(([c,l,t])=>(
          <span key={l} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'var(--text2)'}}>
            <span style={{width:10,height:10,borderRadius:2,background:c,display:'inline-block',flexShrink:0}}/>
            <span>{l}</span>
            <span style={{color:'var(--text3)'}}>({t})</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Contract editor modal ─────────────────────────────────────────────────────
function ContractModal({contract,onSave,onCancel}){
  const [form,setForm]=useState(JSON.parse(JSON.stringify(contract||{
    name:'',validFrom:new Date().toISOString().slice(0,10),currency:'JPY',
    scope:{type:'global',id:null},
    utilities:{
      electricity:{enabled:true,standingChargePerDay:50,
        tiers:[{id:`t${Date.now()}`,label:'Tier 1',from:0,to:null,ratePerKwh:31}],
        peakSchedule:[]},
      water:{enabled:false,ratePerM3:300,standingChargePerDay:0},
      gas:{enabled:false,ratePerM3:120,standingChargePerDay:0},
    }
  })))

  const mkTierId=()=>`t${Date.now()}`
  const S={width:'100%',padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:'var(--fs-sm)',fontFamily:'var(--mono)',outline:'none'}
  const el=form.utilities.electricity

  return(
    <Modal onClose={onCancel}>
      <div className="hp-card hp-card--elevated" style={{boxShadow:'var(--shadow-3)',padding:'var(--sp-5)',width:'min(500px,100%)',maxHeight:'88vh',overflow:'auto'}}>
        <div style={{fontSize:'var(--fs-md)',fontWeight:700,marginBottom:'var(--sp-4)'}}>Edit Contract</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'var(--sp-2)',marginBottom:'var(--sp-4)'}}>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Name</div>
            <input style={S} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. TEPCO Standard"/></div>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Valid from</div>
            <input type="date" style={S} value={form.validFrom} onChange={e=>setForm(f=>({...f,validFrom:e.target.value}))}/></div>
        </div>

        {/* Electricity section */}
        <div style={{marginBottom:'var(--sp-4)'}}>
          <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--warn)',marginBottom:'var(--sp-3)'}}>⚡ Electricity</div>
          <div style={{marginBottom:'var(--sp-2)'}}>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Standing charge / day (¥)</div>
            <input type="number" style={{...S,width:120}} value={el.standingChargePerDay} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,standingChargePerDay:parseFloat(e.target.value)||0}}}))}/>
          </div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:'var(--sp-2)'}}>Consumption tiers</div>
          {el.tiers.map((tier,i)=>(
            <div key={tier.id} style={{display:'grid',gridTemplateColumns:'1fr 55px 55px 70px 24px',gap:4,marginBottom:'var(--sp-1)'}}>
              <input style={{...S,fontSize:'var(--fs-xs)'}} value={tier.label} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,label:e.target.value}:t)}}}))} placeholder="Label"/>
              <input type="number" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.from} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,from:parseFloat(e.target.value)||0}:t)}}}))}/>
              <input type="number" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.to??''} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,to:e.target.value===''?null:parseFloat(e.target.value)}:t)}}}))} placeholder="∞"/>
              <input type="number" step="0.01" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.ratePerKwh} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,ratePerKwh:parseFloat(e.target.value)||0}:t)}}}))} placeholder="¥/kWh"/>
              {el.tiers.length>1&&<button onClick={()=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.filter((_,j)=>j!==i)}}}))} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:'var(--fs-base)'}}>✕</button>}
            </div>
          ))}
          <button onClick={()=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:[...f.utilities.electricity.tiers,{id:mkTierId(),label:`Tier ${f.utilities.electricity.tiers.length+1}`,from:f.utilities.electricity.tiers.at(-1)?.to||0,to:null,ratePerKwh:31}]}}}))}
            className="hp-focus-visible" style={{fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--text3)',background:'none',border:'none',cursor:'pointer',marginBottom:'var(--sp-3)'}}>+ Add tier</button>
        </div>

        <div style={{display:'flex',gap:'var(--sp-2)'}}>
          <button className="hp-focus-visible" style={{flex:1,padding:'var(--sp-3) 0',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-sm)'}} onClick={onCancel}>Cancel</button>
          <button className="hp-focus-visible" style={{flex:2,padding:'var(--sp-3) 0',borderRadius:'var(--r-sm)',border:'none',background:'var(--accent-vivid)',color:'#fff',cursor:'pointer',fontSize:'var(--fs-sm)',fontWeight:700}} onClick={()=>onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  )
}


// ─── UI atoms ──────────────────────────────────────────────────────────────────
function Kpi({ icon, label, value, sub }) {
  return (
    <div className="hp-card" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 'var(--sp-1)' }}>{icon} {label}</div>
      <div style={{ fontSize: 'var(--fs-md)', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-3)', fontSize: 'var(--fs-2xs)', color: 'var(--text3)', flexWrap: 'wrap' }}>
      {items.map(it => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {it.band
            ? <span style={{ width: 16, height: 8, background: 'var(--accent-soft)', display: 'inline-block', borderRadius: 2 }} />
            : <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke={it.stroke} strokeWidth="2" strokeDasharray={it.dash || 'none'} /></svg>}
          {it.label}
        </span>
      ))}
    </div>
  )
}

function Section({ title, right, children, last }) {
  return (
    <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: last ? 'none' : '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontWeight: 600 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function LiveDot({ stale }) {
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
    background: stale ? 'var(--danger)' : 'var(--ok)' }} />
}

// ─── Main EnergyTab ────────────────────────────────────────────────────────────
export function EnergyTab() {
  const { activeContract, addContract, updateContract } = useStore()
  const [editingContract, setEditingContract] = useState(null)
  const [subTab, setSubTab] = useState('overview')
  const [showCtGuide, setShowCtGuide] = useState(false)
  const [showCalib, setShowCalib] = useState(false)
  const [calibration, setCalibration] = useState(null)
  const [calibError, setCalibError] = useState(null)
  async function loadCalibration() {
    try {
      const r = await fetch(`${API_BASE}/api/admin/nilm/calibration`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setCalibration(await r.json()); setCalibError(null)
    } catch (e) { setCalibError(e.message) }
  }
  useEffect(() => { loadCalibration() }, [])
  const legs = useMemo(() => resolveLegs(calibration), [calibration])

  const SUB_TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'devices', label: 'Per-device' },
    { key: 'timeline', label: 'Timeline' },
  ]

  // Clock: drives "now" markers and the midnight rollover of the queries
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  const today = midnightOf(new Date(now))
  const todayMs = today.getTime()
  const todayKey = dayKeyOf(today)
  const nowMin = Math.min(DAY_MIN, (now - todayMs) / 60000)
  const histStartMs = Math.min(addDays(today, -ENERGY.historyDays).getTime(),
    new Date(today.getFullYear(), today.getMonth(), 1).getTime())

  // ── Queries (all through nginx, read-only token on iot-hot)
  const qLive = useMemo(() => FLUX.nilmPower('-2m', 'now()', null), [])
  const qToday = useMemo(() => FLUX.nilmPower(fluxTime(todayMs), 'now()', '1m'), [todayMs])
  const qHist = useMemo(() => FLUX.nilmPower(fluxTime(histStartMs), fluxTime(todayMs), '5m'), [histStartMs, todayMs])
  const live = useFlux(qLive, 5000)
  const tday = useFlux(qToday, 60000)
  const hist = useFlux(qHist, 15 * 60000)
  const errors = [live.error && `live: ${live.error}`, tday.error && `today: ${tday.error}`, hist.error && `history: ${hist.error}`].filter(Boolean)

  // ── Live power: mean of the last 30 s of raw samples
  const livePts = useMemo(() => sumLegs(live.data, legs), [live.data, legs])
  const tdayPts = useMemo(() => sumLegs(tday.data, legs), [tday.data, legs])
  const lastT = livePts.at(-1)?.t ?? null
  const ageS = lastT != null ? Math.max(0, (now - lastT) / 1000) : null
  const stale = ageS == null || ageS > ENERGY.staleAfterS
  const recent = lastT != null ? livePts.filter(p => p.t >= lastT - 30000) : []
  const mean = (arr, f) => arr.length ? arr.reduce((s, p) => s + f(p), 0) / arr.length : null
  const liveW = stale ? null : mean(recent, p => p.w)
  const liveLegs = Object.fromEntries(LEG_FIELDS.map(f => { const r = recent.filter(p => p.legs[f] != null); return [f, stale || !r.length ? null : mean(r, p => p.legs[f])] }))
  const rateHz = livePts.length > 1 ? (livePts.length - 1) / ((livePts.at(-1).t - livePts[0].t) / 1000) : null

  // ── Today (1 min windows)
  const todayDay = useMemo(() => buildDays(tdayPts, 1, now).get(todayKey) || null, [tdayPts, todayKey, now])
  const todayKwh = todayDay?.total ?? (tday.loading ? null : 0)
  const todayCoverage = todayDay ? todayDay.filled / Math.max(1, Math.ceil(nowMin)) : null
  const powerPts = useMemo(() => tdayPts.map(p => ({ m: (p.t - todayMs) / 60000, v: p.w })), [tdayPts, todayMs])
  const evToday = useFlux(useMemo(() => FLUX.homepiEvents(fluxTime(todayMs)), [todayMs]), 60000)
  const todayBands = useMemo(() => {
    const evs = eventIntervals(evToday.data, now)
    const { gaps, suspect } = classifyGaps(findGaps(tdayPts.map(p => p.t + 60000), todayMs, Math.min(now, todayMs + DAY_MIN * 60000), 150), evs)
    const toM = t => (t - todayMs) / 60000
    return [...gaps.map(g => ({ m0: toM(g.start), m1: toM(g.end), update: !!g.cause })), ...suspect.map(g => ({ m0: toM(g.start), m1: toM(g.end), update: true, suspect: true }))]
  }, [evToday.data, tdayPts, todayMs, Math.floor(now / 60000)]) // eslint-disable-line react-hooks/exhaustive-deps
  const peak = useMemo(() => powerPts.reduce((b, p) => (!b || p.v > b.v) ? p : b, null), [powerPts])
  const baseW = useMemo(() => percentile(powerPts.map(p => p.v), 0.05), [powerPts])

  // ── CT polarity: per leg, over the last windowMin of 1-min means
  const polarity = useMemo(() => {
    const cfg = ENERGY.polarity, out = {}
    const recentMin = tdayPts.filter(p => p.t >= now - cfg.windowMin * 60000)
    for (const l of legs) {
      const v = recentMin.map(p => p.legs[l.field]).filter(x => x != null)
      if (cfg.hasGeneration || v.length < cfg.windowMin * 0.6) { out[l.field] = { state: 'unknown', meanW: null, windowMin: cfg.windowMin }; continue }
      const meanW = v.reduce((a, b) => a + b, 0) / v.length
      const negFrac = v.filter(x => x < -cfg.minW).length / v.length
      const state = meanW < -cfg.minW && negFrac >= cfg.minNegFrac ? 'reversed' : Math.abs(meanW) < cfg.minW ? 'unknown' : 'ok'
      out[l.field] = { state, meanW, windowMin: cfg.windowMin }
    }
    return out
  }, [tdayPts, now, legs])
  const reversedLegs = legs.filter(l => polarity[l.field]?.state === 'reversed')

  // ── History (5 min windows): yesterday, reference days, month to date
  const histDays = useMemo(() => buildDays(sumLegs(hist.data, legs), 5), [hist.data, legs])
  const yesterday = histDays.get(dayKeyOf(addDays(today, -1))) || null
  const refDays = useMemo(() => {
    const out = []
    for (let i = 1; i <= ENERGY.historyDays; i++) {
      const d = histDays.get(dayKeyOf(addDays(today, -i)))
      if (d && d.coverage >= ENERGY.minCoverage) out.push(d)
    }
    return out
  }, [histDays, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prediction: today so far + median of what the reference days still used
  // after this time of day. The range is the min..max of those days.
  const pred = useMemo(() => {
    if (!refDays.length || !isNum(todayKwh)) return null
    const inc = (d, m) => cumAt(d, m) - cumAt(d, nowMin)
    const rem = refDays.map(d => inc(d, DAY_MIN))
    const curve = [{ m: nowMin, mid: todayKwh, lo: todayKwh, hi: todayKwh }]
    for (let m = Math.ceil(nowMin / 5) * 5; m <= DAY_MIN; m += 5) {
      if (m <= nowMin) continue
      const v = refDays.map(d => inc(d, m))
      curve.push({ m, mid: todayKwh + median(v), lo: todayKwh + Math.min(...v), hi: todayKwh + Math.max(...v) })
    }
    return { total: todayKwh + median(rem), lo: todayKwh + Math.min(...rem), hi: todayKwh + Math.max(...rem), n: refDays.length, curve }
  }, [refDays, nowMin, todayKwh])

  // Month to date before a given day (tiers are monthly). partial = the month
  // starts before the oldest day still in iot-hot (720 h retention).
  const oldestKey = useMemo(() => [...histDays.keys()].sort()[0] || null, [histDays])
  const monthBefore = key => {
    let s = 0
    for (const d of histDays.values()) if (monthKeyOf(d.key) === monthKeyOf(key) && d.key < key) s += d.total
    const firstOfMonth = `${monthKeyOf(key)}-01`
    return { kwh: s, partial: !oldestKey || oldestKey > firstOfMonth }
  }
  const mtdToday = monthBefore(todayKey)
  const yKey = dayKeyOf(addDays(today, -1))
  const mtdYesterday = monthBefore(yKey)

  const costToday = dayCost(todayKwh, mtdToday.kwh, activeContract)
  const costPred = pred ? dayCost(pred.total, mtdToday.kwh, activeContract) : null
  const costYesterday = yesterday ? dayCost(yesterday.total, mtdYesterday.kwh, activeContract) : null
  const monthNow = isNum(todayKwh) ? mtdToday.kwh + todayKwh : null
  const curTier = isNum(monthNow) ? tierAt(monthNow, activeContract) : null

  const ySameTime = yesterday ? cumAt(yesterday, nowMin) : null
  const verdict = !pred || !yesterday || !(yesterday.total > 0) ? null
    : pred.total < yesterday.total * 0.95 ? { kind: 'below', icon: '✓', color: 'var(--ok)', text: `${((1 - pred.total / yesterday.total) * 100).toFixed(0)}% below yesterday` }
    : pred.total > yesterday.total * 1.05 ? { kind: 'above', icon: '⚠', color: 'var(--danger)', text: `${((pred.total / yesterday.total - 1) * 100).toFixed(0)}% above yesterday` }
    : { kind: 'similar', icon: '→', color: 'var(--text2)', text: 'In line with yesterday' }

  // Daily bars: reference window + today (partial)
  const bars = useMemo(() => {
    const out = []
    for (let i = ENERGY.historyDays; i >= 1; i--) {
      const dt = addDays(today, -i), k = dayKeyOf(dt), d = histDays.get(k)
      out.push({ key: k, label: `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}`, kwh: d?.total ?? 0, coverage: d?.coverage ?? 0 })
    }
    out.push({ key: todayKey, label: 'Today', kwh: todayKwh ?? 0, coverage: todayCoverage ?? 0, partial: true })
    return out
  }, [histDays, todayKey, todayKwh, todayCoverage]) // eslint-disable-line react-hooks/exhaustive-deps

  const curPeriod = getCurrentPeriod()

  function handleSaveContract(form) {
    if (editingContract === 'new') addContract(form)
    else updateContract({ ...form, id: editingContract.id })
    setEditingContract(null)
  }

  const legSub = legs.filter(l => l.inTotal).map(l => `${l.label} ${fmtW(liveLegs[l.field])}`).join(' + ')
  const excluded = legs.filter(l => !l.inTotal).map(l => l.label)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ padding: 'var(--sp-2) var(--sp-4)', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexShrink: 0, background: 'var(--bg)', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>⚡ Electricity</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
          <LiveDot stale={stale} />
          {stale
            ? (ageS == null ? 'No NILM data in the last 2 min' : `Stale · last sample ${Math.round(ageS)} s ago`)
            : `Live · ${Math.round(ageS)} s ago`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{activeContract?.name}</span>
          <button onClick={() => setEditingContract(activeContract || DEFAULT_CONTRACT)} className="hp-focus-visible"
            style={{ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>⚙ Contract</button>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div style={{ padding: '0 var(--sp-4)', borderBottom: '0.5px solid var(--border)', display: 'flex', gap: 'var(--sp-1)', flexShrink: 0, background: 'var(--bg)' }}>
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} className="hp-focus-visible"
            style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 'var(--fs-sm)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
              color: subTab === t.key ? 'var(--text)' : 'var(--text3)',
              borderBottom: subTab === t.key ? '2px solid var(--accent-vivid)' : '2px solid transparent', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {errors.length > 0 && (
        <div role="alert" style={{ margin: 'var(--sp-2) var(--sp-4) 0', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)' }}>
          ⚠ InfluxDB query failed ({errors.join(' · ')}). Figures below may be incomplete.
        </div>
      )}

      {reversedLegs.length > 0 && (
        <div role="alert" style={{ margin: 'var(--sp-2) var(--sp-4) 0', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--danger)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
          <span aria-hidden="true" style={{ color: 'var(--danger)' }}>⚠</span>
          <span style={{ fontWeight: 700 }}>CT {reversedLegs.map(l => l.label).join(' + ')} looks reversed</span>
          <span style={{ color: 'var(--text3)', fontSize: 'var(--fs-xs)' }}>
            {reversedLegs.map(l => `${Math.round(polarity[l.field].meanW)} W`).join(', ')} mean over {ENERGY.polarity.windowMin} min ·{' '}
            {reversedLegs.some(l => l.inTotal) ? 'whole-home figures are wrong until fixed' : 'excluded from the whole-home total'}
          </span>
          <button onClick={() => setShowCtGuide(true)} className="hp-focus-visible"
            style={{ marginLeft: 'auto', padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 700, border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer' }}>Show fix</button>
        </div>
      )}

      {subTab === 'overview' && (
        <div style={{ flex: 1, overflow: 'auto' }}>

          {/* KPI row */}
          <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <Kpi icon="⚡" label="Current load" value={fmtW(liveW)} sub={stale ? 'no recent sample' : `30 s mean · ${legSub}`} />
              <Kpi icon="📊" label="Today so far" value={fmtKwh(todayKwh)} sub={`${fmtYen(costToday)} · coverage ${fmtPct(todayCoverage)}`} />
              <Kpi icon="🎯" label="Day prediction" value={pred ? fmtKwh(pred.total) : '—'}
                sub={pred ? `${fmtKwh(pred.lo, 1)}–${fmtKwh(pred.hi, 1)} · ${fmtYen(costPred)}` : (hist.loading ? 'loading history…' : 'not enough history yet')} />
              <Kpi icon="📅" label="Yesterday" value={yesterday ? fmtKwh(yesterday.total) : '—'}
                sub={yesterday ? `${fmtKwh(ySameTime)} at this time · ${fmtYen(costYesterday)}` : (hist.loading ? 'loading…' : 'no data')} />
              <Kpi icon="⏫" label="Peak today" value={peak ? fmtW(peak.v) : '—'} sub={peak ? `at ${fmtHM(peak.m)} · 1 min mean` : '—'} />
              <Kpi icon="🌙" label="Base load" value={fmtW(baseW)} sub="5th percentile today · always-on" />
            </div>

            {verdict && (
              <div style={{ padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', background: 'var(--bg2)', border: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)', flexWrap: 'wrap' }}>
                <span aria-hidden="true" style={{ color: verdict.color, fontSize: 16 }}>{verdict.icon}</span>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>Projected {verdict.text}</span>
                <span style={{ color: 'var(--text3)', marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
                  median of the last {pred.n} day{pred.n > 1 ? 's' : ''} with ≥{Math.round(ENERGY.minCoverage * 100)}% data
                </span>
              </div>
            )}
          </div>

          <Section title="Cumulative energy today" right={
            <Legend items={[
              { label: 'Today', stroke: 'var(--accent)' },
              { label: 'Yesterday', stroke: 'var(--text3)', dash: '5 4' },
              { label: 'Prediction', stroke: 'var(--accent)', dash: '6 4' },
              { label: 'Range of past days', band: true },
            ]} />}>
            <CumulativeChart todayDay={todayDay} nowMin={nowMin} yesterday={yesterday} pred={pred} />
          </Section>

          <Section title="Power today (1 min mean)" right={<Legend items={[
            { label: 'Whole home', stroke: 'var(--accent)' },
            { label: 'Base load', stroke: 'var(--text3)', dash: '2 3' },
          ]} />}>
            <PowerChart pts={powerPts} nowMin={nowMin} baseW={baseW} bands={todayBands} />
          </Section>

          <Section title={`Daily energy · last ${ENERGY.historyDays} days`} right={
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>faded = partial day or &lt;{Math.round(ENERGY.minCoverage * 100)}% data</span>}>
            <DailyBars bars={bars} />
          </Section>

          {/* Month to date + tiers */}
          {activeContract?.utilities?.electricity?.tiers?.length > 0 && (
            <Section title="Month to date">
              <div className="hp-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-2)', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>{fmtKwh(monthNow, 1)}</span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                    {curTier ? `now in ${curTier.label} · ¥${curTier.ratePerKwh}/kWh` : ''}{mtdToday.partial ? ' · month starts before the 30-day retention: partial' : ''}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>Pricing tiers (monthly kWh) — {activeContract.name}</div>
                {activeContract.utilities.electricity.tiers.map((tier, i, arr) => (
                  <div key={tier.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-1) 0', borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none', fontSize: 'var(--fs-base)' }}>
                    <span style={{ color: tier === curTier ? 'var(--text)' : 'var(--text2)', fontWeight: tier === curTier ? 700 : 400 }}>{tier === curTier ? '▸ ' : ''}{tier.label} · {tier.from}–{tier.to ?? '∞'} kWh</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 700 }}>¥{tier.ratePerKwh}/kWh</span>
                  </div>
                ))}
                {(activeContract.utilities.electricity.standingChargePerDay || 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                    <span>Standing charge</span><span style={{ fontFamily: 'var(--mono)' }}>¥{activeContract.utilities.electricity.standingChargePerDay}/day</span>
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section title="Tariff periods">
            <PeakTimeline24h />
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
              Now: {curPeriod.label}. Reference pattern only: costs above use the contract tiers, not these periods.
            </div>
          </Section>

          {/* Data provenance: what the numbers are made of */}
          <Section title="Data source" last>
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
              <div>{ENERGY.bucket}/{ENERGY.measurement} · total = {legs.filter(l => l.inTotal).map(l => l.field).join(' + ') || '—'} · {isNum(rateHz) ? `${rateHz.toFixed(2)} Hz` : '—'} · history {histDays.size} day{histDays.size === 1 ? '' : 's'} loaded</div>
              <div>Energy = window mean × window length (1 min today, 5 min history); windows without data count as 0 and lower the coverage.</div>
              {excluded.length > 0 && <div style={{ color: 'var(--warn)' }}>⚠ Whole-home figures exclude {excluded.join(', ')}: CT polarity and calibration not validated yet (see Per-device).</div>}
            </div>
          </Section>
        </div>
      )}

      {subTab === 'timeline' && <RoomTimeline legs={legs} />}

      {subTab === 'devices' && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Section title="Per circuit (measured)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 'var(--sp-2)' }}>
              {legs.map(l => (
                <div key={l.field} className="hp-card" style={{ padding: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 'var(--sp-1)' }}>
                    <span>Circuit {l.label}</span>
                    <span style={{ color: l.validated ? 'var(--text3)' : 'var(--warn)' }}>{l.calibrated ? '✓ calibrated on the Pi' : l.validated ? '✓ firmware v2 scale' : '⚠ not calibrated'}{l.inTotal ? '' : ' · not in total'}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-md)', fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmtW(liveLegs[l.field])}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 2 }}>today {fmtKwh(todayDay?.legKwh?.[l.field])}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)', color: polarity[l.field]?.state === 'reversed' ? 'var(--danger)' : 'var(--text3)' }}>
                    Polarity: {{ ok: '✓ OK', reversed: '⚠ reversed', unknown: '— load too low to tell' }[polarity[l.field]?.state || 'unknown']}
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Calibration (on the Pi)" right={
            <button onClick={() => setShowCalib(true)} className="hp-focus-visible"
              style={{ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 700, border: 'none', background: 'var(--accent-vivid)', color: '#fff', cursor: 'pointer' }}>Calibrate NILM</button>}>
            {calibError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)' }}>⚠ Calibration state unavailable ({calibError}): config.js defaults in use.</div>}
            {calibration && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--mono)', lineHeight: 1.8 }}>
                <div>version {calibration.version || 0}{calibration.updated_at ? ` · ${calibration.updated_at}` : ' · never calibrated'}</div>
                <div>V_scale {calibration.V_scale ? calibration.V_scale.toFixed(3) : '—'}{calibration.voltage ? ` (${calibration.voltage.method}, ${calibration.voltage.reference_V} V)` : ''}</div>
                {legs.map(l => (
                  <div key={l.field}>CT {ctKeyOf(l.field)} ({l.label}): {l.calibrated
                    ? `I_scale ${l.I_scale.toFixed(3)} · φ ${l.phi_deg.toFixed(2)}°${Math.abs(l.phi_deg) > 90 ? ' (mounted reversed, corrected in software)' : ''} · ${l.reference?.method || ''}`
                    : 'not calibrated'}</div>
                ))}
              </div>
            )}
          </Section>
          <Section title="CT orientation" right={
            <button onClick={() => setShowCtGuide(true)} className="hp-focus-visible"
              style={{ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>Open guide</button>}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
              Checked continuously: sustained negative power on a leg (no generation configured) means the CT is mounted the wrong way round.
            </div>
          </Section>
          <div style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220, gap: 'var(--sp-2)', textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>🔌</div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text2)' }}>Per-appliance breakdown</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', maxWidth: 380 }}>
              Waiting for NILM Layer 1 (event detection + classification). The whole-home signal above is live;
              appliances will appear here once the classifier publishes its labels.
            </div>
          </div>
        </div>
      )}

      {showCtGuide && (
        <Modal onClose={() => setShowCtGuide(false)}>
          <CtPolarityGuide legs={legs} states={polarity} onClose={() => setShowCtGuide(false)} />
        </Modal>
      )}

      {showCalib && (
        <Modal onClose={() => {}}>
          <NilmCalibrationWizard current={calibration} onClose={() => setShowCalib(false)} onSaved={s => setCalibration(s)} />
        </Modal>
      )}

      {editingContract && (
        <ContractModal
          contract={editingContract === 'new' ? null : editingContract}
          onSave={handleSaveContract}
          onCancel={() => setEditingContract(null)} />
      )}
    </div>
  )
}
