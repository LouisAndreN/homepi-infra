import { expandRoutines } from '../src/energy/routines.js'
let f = 0; const ok = (c, m) => { if (!c) f++; console.log(`${c ? 'ok ' : 'BAD'} ${m}`) }
// Friday 2026-11-27 local, range Fri 00:00 -> Mon 00:00
const fri = new Date(2026, 10, 27, 0, 0), mon = new Date(2026, 10, 30, 0, 0)
const R = [
  { id: 'out', label: 'Leave for work', kind: 'away', days: [0, 1, 2, 3, 4], start: '07:45', end: null },
  { id: 'back', label: 'At work', kind: 'away', days: [0, 1, 2, 3, 4], start: '08:30', end: '18:00' },
  { id: 'sleep', label: 'Sleep', kind: 'sleep', days: [0, 1, 2, 3, 4, 5, 6], start: '23:30', end: '07:00' },
  { id: 'off', label: 'Disabled', kind: 'other', days: [4], start: '12:00', end: '13:00', enabled: false },
]
const occ = expandRoutines(R, fri.getTime(), mon.getTime())
const of = id => occ.filter(o => o.id.startsWith(id + '@'))
ok(of('out').length === 1 && of('out')[0].instant, 'weekday instant only on Friday in a Fri-Sun range')
ok(of('back').length === 1 && new Date(of('back')[0].end).getHours() === 18, 'work 08:30-18:00 on Friday')
const sl = of('sleep')
ok(sl.length === 4, `sleep: Thu night (ends Fri 07:00) + Fri, Sat, Sun nights = ${sl.length}`)
ok(new Date(sl[0].start).getDate() === 26 && new Date(sl[0].end).getDate() === 27, 'overnight occurrence from the day before kept')
ok(of('off').length === 0, 'disabled routine ignored')
console.log('FAILS:', f); process.exit(f ? 1 : 0)
