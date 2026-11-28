import { useMemo, useState } from 'react'
import { SEQ } from './EnergyCalendar.jsx'
import { iconOf, WEATHER_KINDS } from '../energy/weather.js'
import { monthCost, tierAt } from '../energy/tariff.js'

// Month view of the daily energy calendar: same colours and levels as the year grid (quartiles of the
// complete days of the year), bigger cells that carry the date, the energy and the weather icons of the day.
// The month total and its cost sit above the grid. Days without data count as zero: when a month has
// missing or partial days, its energy and cost are lower bounds, and the summary says so.

const pad2 = n => String(n).padStart(2, '0')
const keyOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const INK = ['var(--text)', '#ffffff', '#ffffff', '#0b1020', '#0b1020']     // readable text on each level
const isNum = v => v != null && Number.isFinite(v)
const fmtKwh = (v, d = 1) => isNum(v) ? `${v.toFixed(d)} kWh` : '—'
const fmtYen = v => isNum(v) ? `¥${Math.round(v).toLocaleString()}` : '—'

function Stat({ label, value, sub }) {
  return (
    <div className="hp-card" style={{ padding: 'var(--sp-3)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginBottom: 'var(--sp-1)' }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-md)', fontFamily: 'var(--mono)', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function MonthCalendar({ energy, weatherKinds, contract, minCoverage = 0.8 }) {
  const { byKey, lv, archiveSince, days } = energy
  const now = new Date()
  const [offset, setOffset] = useState(0)                     // 0 = this month, -1 = last month...
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const y = first.getFullYear(), m = first.getMonth()
  const nDays = new Date(y, m + 1, 0).getDate()
  const isCurrent = offset === 0
  const elapsed = isCurrent ? now.getDate() : nDays
  const oldest = days[0]?.t ?? archiveSince ?? now.getTime()
  const canBack = new Date(y, m, 1).getTime() > new Date(new Date(oldest).getFullYear(), new Date(oldest).getMonth(), 1).getTime()

  const sum = useMemo(() => {
    let kwh = 0, measured = 0, complete = 0, completeKwh = 0
    for (let d = 1; d <= elapsed; d++) {
      const e = byKey.get(keyOf(y, m, d))
      if (!e) continue
      kwh += e.kwh; measured++
      // today is never "complete" (still running): it would drag the daily mean down
      if (e.coverage >= minCoverage && !(isCurrent && d === elapsed)) { complete++; completeKwh += e.kwh }
    }
    const mean = complete ? completeKwh / complete : null
    // Projection: today counts as at least a mean day, every remaining day as a mean day
    const todayKwh = isCurrent ? byKey.get(keyOf(y, m, elapsed))?.kwh ?? 0 : 0
    const proj = isCurrent && isNum(mean) ? kwh - todayKwh + Math.max(todayKwh, mean) + mean * (nDays - elapsed) : null
    return { kwh, measured, complete, mean, proj }
  }, [byKey, y, m, elapsed, nDays, isCurrent, minCoverage])
  const cost = monthCost(sum.kwh, elapsed, contract)
  const projCost = isNum(sum.proj) ? monthCost(sum.proj, nDays, contract) : null
  const tier = isCurrent ? tierAt(sum.kwh, contract) : null
  const missing = elapsed - sum.measured
  const partial = sum.measured - sum.complete - (isCurrent && byKey.get(keyOf(y, m, elapsed)) ? 1 : 0)

  // Grid: Monday first, leading blanks before the 1st
  const lead = (first.getDay() + 6) % 7
  const cells = [...Array(lead).fill(null), ...Array.from({ length: nDays }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const [tip, setTip] = useState(null)
  const label = first.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
  const navBtn = enabled => ({ padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)',
    color: enabled ? 'var(--text)' : 'var(--text3)', cursor: enabled ? 'pointer' : 'default', fontSize: 'var(--fs-sm)', opacity: enabled ? 1 : 0.4 })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
        <button style={navBtn(canBack)} disabled={!canBack} onClick={() => setOffset(o => o - 1)} aria-label="Previous month" className="hp-focus-visible">‹</button>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{label}</div>
        <button style={navBtn(!isCurrent)} disabled={isCurrent} onClick={() => setOffset(o => Math.min(0, o + 1))} aria-label="Next month" className="hp-focus-visible">›</button>
        {!isCurrent && <button style={{ ...navBtn(true), marginLeft: 'auto', fontSize: 'var(--fs-xs)' }} onClick={() => setOffset(0)} className="hp-focus-visible">This month</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <Stat label={isCurrent ? 'Energy so far' : 'Energy'} value={fmtKwh(sum.kwh)} sub={`${sum.measured} of ${elapsed} day${elapsed > 1 ? 's' : ''} measured`} />
        <Stat label={isCurrent ? 'Cost so far' : 'Cost'} value={cost ? fmtYen(cost.total) : '—'}
          sub={cost ? `energy ${fmtYen(cost.energy)} + standing ${fmtYen(cost.standing)}` : 'no contract with electricity'} />
        <Stat label="Daily mean" value={fmtKwh(sum.mean)} sub={`${sum.complete} complete day${sum.complete === 1 ? '' : 's'} (≥${Math.round(minCoverage * 100)}% data)`} />
        {isCurrent && <Stat label="Month projection" value={fmtKwh(sum.proj)} sub={projCost ? `${fmtYen(projCost.total)} · daily mean × remaining days` : 'not enough complete days'} />}
      </div>
      {(missing > 0 || partial > 0) && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)', marginBottom: 'var(--sp-2)' }}>
          ⚠ {[missing > 0 && `${missing} day${missing > 1 ? 's' : ''} without data`, partial > 0 && `${partial} partial day${partial > 1 ? 's' : ''}`].filter(Boolean).join(', ')}:
          energy and cost are lower bounds (missing readings count as zero).
        </div>
      )}

      <div data-no-swipe style={{ position: 'relative' }} onPointerLeave={() => setTip(null)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 4 }}>
          {WEEKDAYS.map(d => <div key={d} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)', textAlign: 'center', paddingBottom: 2 }}>{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />
            const k = keyOf(y, m, d)
            const e = byKey.get(k)
            const future = isCurrent && d > elapsed
            const today = isCurrent && d === elapsed
            const l = e ? lv.levelOf(e.kwh) : 0
            const part = e && e.coverage < minCoverage
            const kinds = weatherKinds?.get(k) || []
            return (
              <div key={k} onPointerEnter={() => setTip({ k, d, e, kinds, i })}
                style={{ position: 'relative', minHeight: 62, borderRadius: 'var(--r-sm)', padding: '4px 5px', display: 'flex', flexDirection: 'column',
                  background: e ? SEQ[l] : 'var(--bg2)', color: e ? INK[l] : 'var(--text3)', opacity: future ? 0.35 : 1,
                  border: today ? '1.5px solid var(--text)' : part ? '1px dashed var(--text2)' : '0.5px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, fontFamily: 'var(--mono)' }}>{d}</span>
                  <span aria-label={kinds.map(x => WEATHER_KINDS[x].label).join(', ')} style={{ fontSize: 12, lineHeight: 1.1, textAlign: 'right', letterSpacing: -1, wordBreak: 'break-all' }}>
                    {kinds.map(x => iconOf(x)).join('')}
                  </span>
                </div>
                <div style={{ marginTop: 'auto', fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
                  {e ? e.kwh.toFixed(1) : future ? '' : '—'}
                </div>
              </div>
            )
          })}
        </div>
        {tip && (
          <div style={{ position: 'absolute', left: `${((tip.i % 7) + 0.5) / 7 * 100}%`, top: `calc(${Math.floor(tip.i / 7) + 1} * 66px + 18px)`,
            transform: tip.i % 7 > 3 ? 'translateX(-100%)' : 'none', pointerEvents: 'none', background: 'var(--bg2)', border: '0.5px solid var(--border)',
            borderRadius: 'var(--r-sm)', padding: '5px 8px', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-3)', zIndex: 2 }}>
            <div style={{ fontWeight: 700 }}>{new Date(y, m, tip.d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div style={{ fontFamily: 'var(--mono)' }}>{tip.e ? `${tip.e.kwh.toFixed(2)} kWh · coverage ${Math.round(tip.e.coverage * 100)}%` : 'no data'}</div>
            {tip.kinds.length > 0 && <div>{tip.kinds.map(x => `${iconOf(x)} ${WEATHER_KINDS[x].label}`).join(' · ')}</div>}
          </div>
        )}
      </div>

      {tier && contract?.utilities?.electricity?.tiers?.length > 0 && (
        <div className="hp-card" style={{ marginTop: 'var(--sp-3)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 'var(--sp-2)' }}>Pricing tiers (monthly kWh) — {contract.name}</div>
          {contract.utilities.electricity.tiers.map((t, i, arr) => (
            <div key={t.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-1) 0', borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none', fontSize: 'var(--fs-base)' }}>
              <span style={{ color: t === tier ? 'var(--text)' : 'var(--text2)', fontWeight: t === tier ? 700 : 400 }}>{t === tier ? '▸ ' : ''}{t.label} · {t.from}–{t.to ?? '∞'} kWh</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>¥{t.ratePerKwh}/kWh</span>
            </div>
          ))}
          {(contract.utilities.electricity.standingChargePerDay || 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
              <span>Standing charge</span><span style={{ fontFamily: 'var(--mono)' }}>¥{contract.utilities.electricity.standingChargePerDay}/day</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
