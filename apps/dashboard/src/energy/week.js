// Week view (Monday first): daily energy of this week next to the same weekday of last week.
// Pure functions, unit-tested with node (tests/week.test.mjs).
const pad2 = n => String(n).padStart(2, '0')
export const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function mondayOf(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (d.getDay() + 6) % 7)
  return d
}

// totalOf(key) -> {kwh, coverage} | null for any local day key; today is the partial day.
// cumBefore(key, minute) -> kWh of that day before `minute` (for "last week at this point").
export function buildWeek(nowMs, totalOf, cumBefore, nowMin) {
  const mon = mondayOf(nowMs), todayK = dayKey(new Date(nowMs))
  const days = []
  let thisSoFar = 0, lastAtPoint = 0, lastFull = 0, prevDays = 0, passedToday = false
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    const p = new Date(mon); p.setDate(mon.getDate() + i - 7)
    const key = dayKey(d), prevKey = dayKey(p)
    const isToday = key === todayK, future = passedToday
    const cur = future ? null : totalOf(key), prev = totalOf(prevKey)
    days.push({ key, prevKey, label: WEEKDAYS[i], date: `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`, t: d.getTime(),
      kwh: cur?.kwh ?? null, coverage: cur?.coverage ?? 0, partial: isToday, future,
      prevKwh: prev?.kwh ?? null, prevCoverage: prev?.coverage ?? 0 })
    if (!future && cur) thisSoFar += cur.kwh
    if (prev) {
      prevDays++
      lastFull += prev.kwh
      if (!future) lastAtPoint += isToday ? (cumBefore(prevKey, nowMin) ?? 0) : prev.kwh
    }
    if (isToday) passedToday = true
  }
  return { days, thisSoFar, lastAtPoint, lastFull, prevDays }
}
