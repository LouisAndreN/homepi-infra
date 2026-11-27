import { eventIntervals, findGaps, classifyGaps, luxStepEvents } from '../src/energy/timelineEvents.js'
let f = 0; const ok = (c, m) => { if (!c) f++; console.log(`${c ? 'ok ' : 'BAD'} ${m}`) }
const T = s => new Date(Date.UTC(2026, 10, 28, 10, 0, s)).toISOString()
const rows = [
  { _time: T(0), kind: 'teensy_update', device_id: 'esp32-690be854', _field: 'phase', _value: 'start' },
  { _time: T(0), kind: 'teensy_update', device_id: 'esp32-690be854', _field: 'ref', _value: 'u1' },
  { _time: T(0), kind: 'teensy_update', device_id: 'esp32-690be854', _field: 'detail', _value: 'v3.1' },
  { _time: T(40), kind: 'teensy_update', device_id: 'esp32-690be854', _field: 'phase', _value: 'end' },
  { _time: T(40), kind: 'teensy_update', device_id: 'esp32-690be854', _field: 'ref', _value: 'u1' },
  { _time: T(100), kind: 'ota', device_id: 'esp32-819fe250', _field: 'phase', _value: 'start' },
]
const ev = eventIntervals(rows, Date.parse(T(200)))
ok(ev.length === 2 && ev[0].kind === 'teensy_update' && ev[0].end - ev[0].start === 40000 && ev[0].detail === 'v3.1', 'start/end paired by ref')
ok(ev[1].ongoing && ev[1].end === Date.parse(T(200)), 'unfinished event stays open until now')
const times = []; for (let s = 0; s <= 300; s += 1.5) if (s < 2 || s > 45) times.push(Date.parse(T(0)) + s * 1000)
const gaps = findGaps(times, Date.parse(T(0)), Date.parse(T(300)))
ok(gaps.length === 1 && gaps[0].end - gaps[0].start > 40000, `one gap found (${(gaps[0].end - gaps[0].start) / 1000} s)`)
const c = classifyGaps(gaps, ev)
ok(c.gaps[0].cause === 'teensy_update' && c.suspect.length === 1, 'gap attributed to the Teensy update, suspect window added')
ok(findGaps(times.slice(0, 1), Date.parse(T(0)), Date.parse(T(300)))[0].ongoing, 'trailing gap is open')
// lux: night 0, lamp on 20:00 (180 lux), off 23:00; daylight ramp 0 -> 400 over 2 h in 5-min steps
const t0 = Date.parse('2026-11-28T00:00:00Z'), P = (m, v) => ({ t: t0 + m * 60000, v })
const night = [P(0, 0), P(5, 0), P(10, 180), P(15, 182), P(20, 179), P(25, 3), P(30, 2)]
const le = luxStepEvents(night, t0 + 999e5)
ok(le.length === 1 && le[0].start === t0 + 10 * 60000 && le[0].end === t0 + 25 * 60000, 'lamp on/off detected as one light event')
const dawn = []; for (let m = 0; m <= 120; m += 5) dawn.push(P(m, Math.round(400 * Math.min(1, Math.max(0, (m - 10) / 110)) ** 1.2)))
ok(luxStepEvents(dawn, 0).length === 0, `daylight ramp ignored (${dawn.map(p => p.v).slice(0, 6).join(',')}...)`)
const onNow = luxStepEvents([P(0, 1), P(5, 250)], t0 + 3600e3)
ok(onNow.length === 1 && onNow[0].ongoing, 'light still on: ongoing event')
console.log('FAILS:', f); process.exit(f ? 1 : 0)
