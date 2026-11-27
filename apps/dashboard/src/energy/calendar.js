// Daily energy calendar (GitHub-style). Pure functions, unit-tested with node.
//
// Input: per-day, per-leg sums and counts of 5-min power means (Flux aggregateWindow 1d in local time).
//   energy kWh = sum(5-min means) * 5/60 / 1000 ; coverage = count / 288.
// The whole-home day total uses the legs in the total; a leg with a `since` (calibrated later, old
// history not trusted) only counts on days that start after it.

const pad2 = n => String(n).padStart(2, '0')
export const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// rows: {_time, _field, _value} with _time = local day start; sums and counts from two queries
export function dailyTotals(sumRows, countRows, legs) {
  const days = new Map()
  const get = t => {
    const d = new Date(t); const k = dayKey(d)
    if (!days.has(k)) days.set(k, { key: k, t: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), sums: {}, counts: {} })
    return days.get(k)
  }
  for (const r of sumRows) { const v = parseFloat(r._value); if (Number.isFinite(v)) get(Date.parse(r._time)).sums[r._field] = v }
  for (const r of countRows) { const v = parseFloat(r._value); if (Number.isFinite(v)) get(Date.parse(r._time)).counts[r._field] = v }
  const out = []
  for (const d of days.values()) {
    const counted = legs.filter(l => l.inTotal && !(l.since && d.t < l.since) && l.field in d.sums)
    if (!counted.length) continue
    const kwh = counted.reduce((s, l) => s + d.sums[l.field], 0) * 5 / 60 / 1000
    const coverage = Math.min(1, Math.min(...counted.map(l => d.counts[l.field] ?? 0)) / 288)
    out.push({ key: d.key, t: d.t, kwh, coverage })
  }
  return out.sort((a, b) => a.t - b.t)
}

// Merge the archived days (iot-archives nilm_daily: wh and n5 per leg) with the live days computed
// from iot-hot. Both describe the same 5-min means; the live value wins for a day and leg it has
// (fresher: the archive of today lags up to an hour). Output is in the dailyTotals input format.
export function mergeDaily(archiveRows, liveSums, liveCounts) {
  const sums = new Map(), counts = new Map()
  const k = (t, f) => `${dayKey(new Date(Date.parse(t)))}|${f}`
  for (const r of archiveRows) {
    const v = parseFloat(r._value); if (!Number.isFinite(v) || !r.leg) continue
    if (r._field === 'wh') sums.set(k(r._time, r.leg), { _time: r._time, _field: r.leg, _value: v * 60 / 5 })
    else if (r._field === 'n5') counts.set(k(r._time, r.leg), { _time: r._time, _field: r.leg, _value: v })
  }
  for (const r of liveSums) sums.set(k(r._time, r._field), r)
  for (const r of liveCounts) counts.set(k(r._time, r._field), r)
  return { sumRows: [...sums.values()], countRows: [...counts.values()] }
}

// Four levels from the quartiles of the complete days (coverage >= minCoverage), like GitHub's
// contribution graph. Partial days get a level too but are marked partial.
export function levels(days, minCoverage = 0.8) {
  const full = days.filter(d => d.coverage >= minCoverage && d.kwh > 0).map(d => d.kwh).sort((a, b) => a - b)
  if (!full.length) return { thresholds: [], levelOf: () => 0 }
  const q = p => full[Math.min(full.length - 1, Math.floor(p * (full.length - 1)))]
  const thresholds = [q(0.25), q(0.5), q(0.75)]
  return { thresholds, levelOf: kwh => kwh <= 0 ? 0 : kwh <= thresholds[0] ? 1 : kwh <= thresholds[1] ? 2 : kwh <= thresholds[2] ? 3 : 4 }
}

// Mean kWh of complete days, weekdays vs weekend (Sat, Sun)
export function weekdayWeekend(days, minCoverage = 0.8) {
  const full = days.filter(d => d.coverage >= minCoverage)
  const mean = a => a.length ? a.reduce((s, d) => s + d.kwh, 0) / a.length : null
  const wk = full.filter(d => { const g = new Date(d.t).getDay(); return g >= 1 && g <= 5 })
  const we = full.filter(d => { const g = new Date(d.t).getDay(); return g === 0 || g === 6 })
  return { weekday: mean(wk), weekend: mean(we), nWeekday: wk.length, nWeekend: we.length }
}

// GitHub grid: columns are weeks (Monday first), rows Mon..Sun, ending with the current week.
export function calendarGrid(endMs, weeks = 53) {
  const end = new Date(endMs); end.setHours(0, 0, 0, 0)
  const dow = (end.getDay() + 6) % 7
  const start = new Date(end); start.setDate(end.getDate() - dow - (weeks - 1) * 7)
  const cols = []
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let r = 0; r < 7; r++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + r)
      col.push(d.getTime() > end.getTime() ? null : { key: dayKey(d), t: d.getTime(), month: d.getMonth(), date: d.getDate() })
    }
    cols.push(col)
  }
  return cols
}
