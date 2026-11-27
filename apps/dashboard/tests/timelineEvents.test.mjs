import { eventIntervals, findGaps, classifyGaps } from '../src/energy/timelineEvents.js'
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
console.log('FAILS:', f); process.exit(f ? 1 : 0)
