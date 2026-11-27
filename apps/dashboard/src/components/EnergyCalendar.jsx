import { useMemo, useState } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { dailyTotals, mergeDaily, levels, weekdayWeekend, calendarGrid } from '../energy/calendar.js'

// GitHub-style calendar of daily whole-home energy: one cell per day, columns are weeks (Monday first).
// Colour = quartile of the complete days (sequential, one hue, brighter = more). Partial days (data
// coverage < 80%) are outlined; days without data stay empty. The last 30 days are computed from the
// live readings (iot-hot), older days come from the daily archive (iot-archives, one year).

const SEQ = ['var(--bg3)', '#173a61', '#1f5a9c', '#2f7fd8', '#7fb8ff']   // level 0..4, validated hue (blue)
const CELL = 11, GAP = 3, LEFT = 26, TOP = 14
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const RETENTION_DAYS = 30

export function EnergyCalendar({ legs }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const sums = useFlux(useMemo(() => FLUX.nilmDaily('sum', RETENTION_DAYS + 1, tz), [tz]), 30 * 60000)
  const counts = useFlux(useMemo(() => FLUX.nilmDaily('count', RETENTION_DAYS + 1, tz), [tz]), 30 * 60000)
  const archive = useFlux(useMemo(() => FLUX.nilmDailyArchive(372), []), 60 * 60000)
  const days = useMemo(() => {
    const m = mergeDaily(archive.data, sums.data, counts.data)
    return dailyTotals(m.sumRows, m.countRows, legs)
  }, [archive.data, sums.data, counts.data, legs])
  const byKey = useMemo(() => new Map(days.map(d => [d.key, d])), [days])
  const lv = useMemo(() => levels(days), [days])
  const ww = useMemo(() => weekdayWeekend(days), [days])
  const grid = useMemo(() => calendarGrid(Date.now()), [days.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tip, setTip] = useState(null)
  const archiveSince = useMemo(() => {
    const t = archive.data.reduce((m, r) => { const v = Date.parse(r._time); return Number.isFinite(v) && v < m ? v : m }, Infinity)
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null
  }, [archive.data])

  const W = LEFT + grid.length * (CELL + GAP), H = TOP + 7 * (CELL + GAP)
  const monthLabels = []
  grid.forEach((col, i) => { const first = col.find(Boolean); if (first && first.date <= 7) monthLabels.push({ i, m: first.month }) })
  const fmt = v => v == null ? '—' : `${v.toFixed(1)} kWh`

  return (
    <div>
      <div data-no-swipe style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W * 1.25} style={{ display: 'block', maxWidth: 'none' }} role="img"
          aria-label={`Daily energy calendar, ${days.length} days with data`} onPointerLeave={() => setTip(null)}>
          {monthLabels.map(({ i, m }) => <text key={i} x={LEFT + i * (CELL + GAP)} y={9} fontSize="8" fill="var(--text3)">{MONTHS[m]}</text>)}
          {DAYS.map((d, r) => d && <text key={r} x={0} y={TOP + r * (CELL + GAP) + CELL - 2} fontSize="8" fill="var(--text3)">{d}</text>)}
          {grid.map((col, i) => col.map((c, r) => {
            if (!c) return null
            const d = byKey.get(c.key)
            const l = d ? lv.levelOf(d.kwh) : 0
            const partial = d && d.coverage < 0.8
            return (
              <rect key={c.key} x={LEFT + i * (CELL + GAP)} y={TOP + r * (CELL + GAP)} width={CELL} height={CELL} rx="2"
                fill={d ? SEQ[l] : 'var(--bg2)'} stroke={partial ? 'var(--text2)' : 'var(--border)'} strokeWidth={partial ? 1 : 0.5}
                strokeDasharray={partial ? '2 1.5' : 'none'}
                onPointerEnter={() => setTip({ c, d, x: LEFT + i * (CELL + GAP), y: TOP + r * (CELL + GAP) })} />
            )
          }))}
        </svg>
        {tip && (
          <div style={{ position: 'absolute', left: tip.x * 1.25, top: (tip.y + CELL) * 1.25 + 4, transform: tip.x > W * 0.6 ? 'translateX(-100%)' : 'none',
            pointerEvents: 'none', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '5px 8px',
            fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-3)', zIndex: 2 }}>
            <div style={{ fontWeight: 700 }}>{new Date(tip.c.t).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
            <div style={{ fontFamily: 'var(--mono)' }}>{tip.d ? fmt(tip.d.kwh) : 'no data'}{tip.d ? ` · coverage ${Math.round(tip.d.coverage * 100)}%` : ''}</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', marginTop: 'var(--sp-2)', fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          Less
          {SEQ.map((c, i) => <span key={i} title={i === 0 ? '0' : lv.thresholds.length ? `≤ ${lv.thresholds[i - 1]?.toFixed(1) ?? '>' + lv.thresholds[2].toFixed(1)} kWh` : ''}
            style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '0.5px solid var(--border)', display: 'inline-block' }} />)}
          More
        </span>
        {lv.thresholds.length > 0 && <span style={{ fontFamily: 'var(--mono)' }}>quartiles {lv.thresholds.map(t => t.toFixed(1)).join(' / ')} kWh</span>}
        <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '1px dashed var(--text2)', borderRadius: 2, verticalAlign: 'middle', marginRight: 3 }} />partial day</span>
        {(ww.weekday != null || ww.weekend != null) && (
          <span style={{ color: 'var(--text2)' }}>Weekdays <b style={{ fontFamily: 'var(--mono)' }}>{fmt(ww.weekday)}</b> ({ww.nWeekday} d) · Weekend <b style={{ fontFamily: 'var(--mono)' }}>{fmt(ww.weekend)}</b> ({ww.nWeekend} d)</span>
        )}
      </div>
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)', marginTop: 4 }}>
        Last {RETENTION_DAYS} days from the live readings; older days from the daily archive (kept one year, since {archiveSince || 'v1.4.0'}).
      </div>
    </div>
  )
}
