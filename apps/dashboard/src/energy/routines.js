// Routines (declared recurring events) -> occurrences in a time range, in local time.
// A routine: {id, label, kind, days:[0=Mon..6=Sun], start:"HH:MM", end:"HH:MM"|null, enabled}.
// An end earlier than (or equal to) the start crosses midnight: the occurrence belongs to the day it starts.
export const ROUTINE_KINDS = [
  { key: 'away', label: 'Away' }, { key: 'home', label: 'Home' }, { key: 'sleep', label: 'Sleep' },
  { key: 'meal', label: 'Meal' }, { key: 'other', label: 'Other' },
]
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const atTime = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(day); d.setHours(h, m, 0, 0); return d.getTime()
}

export function expandRoutines(routines, fromMs, toMs) {
  const out = []
  const first = new Date(fromMs); first.setHours(0, 0, 0, 0); first.setDate(first.getDate() - 1)  // overnight from the day before
  for (let d = new Date(first); d.getTime() <= toMs; d.setDate(d.getDate() + 1)) {
    const dow = (d.getDay() + 6) % 7    // JS: 0 = Sunday -> 6
    for (const r of routines || []) {
      if (r.enabled === false || !r.days?.includes(dow)) continue
      const start = atTime(d, r.start)
      let end = r.end ? atTime(d, r.end) : start
      if (r.end && end <= start) end += 24 * 3600e3
      if (end < fromMs || start > toMs) continue
      out.push({ kind: 'routine', routineKind: r.kind, start, end, instant: !r.end, detail: r.label, declared: true, id: `${r.id}@${start}` })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
