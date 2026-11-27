import { dailyTotals, levels, weekdayWeekend, calendarGrid } from '../src/energy/calendar.js'
let f = 0; const ok = (c, m) => { if (!c) f++; console.log(`${c ? 'ok ' : 'BAD'} ${m}`) }
const day = (y, m, d) => new Date(y, m, d).toISOString()
// 500 W constant on L1 for a full day = 288 means of 500 -> 12 kWh; L2 200 W but only after calibration
const sums = [{ _time: day(2026, 10, 23), _field: 'P_L1', _value: 288 * 500 }, { _time: day(2026, 10, 23), _field: 'P_L2', _value: 288 * 200 },
  { _time: day(2026, 10, 28), _field: 'P_L1', _value: 288 * 500 }, { _time: day(2026, 10, 28), _field: 'P_L2', _value: 144 * 200 }]
const counts = [{ _time: day(2026, 10, 23), _field: 'P_L1', _value: 288 }, { _time: day(2026, 10, 23), _field: 'P_L2', _value: 288 },
  { _time: day(2026, 10, 28), _field: 'P_L1', _value: 288 }, { _time: day(2026, 10, 28), _field: 'P_L2', _value: 144 }]
const legs = [{ field: 'P_L1', inTotal: true, since: null }, { field: 'P_L2', inTotal: true, since: new Date(2026, 10, 27, 12).getTime() }]
const d = dailyTotals(sums, counts, legs)
ok(Math.abs(d[0].kwh - 12) < 1e-9 && d[0].coverage === 1, `before L2 calibration: L1 only = ${d[0].kwh} kWh`)
ok(Math.abs(d[1].kwh - (12 + 144 * 200 * 5 / 60 / 1000)) < 1e-9 && d[1].coverage === 0.5, `after: L1 + L2, coverage = min of legs (${d[1].coverage})`)
const L = levels([...Array(20)].map((_, i) => ({ kwh: i + 1, coverage: 1 })))
ok(L.thresholds.join() === '5,10,15' && L.levelOf(0) === 0 && L.levelOf(3) === 1 && L.levelOf(20) === 4, `quartile levels ${L.thresholds}`)
const ww = weekdayWeekend([{ t: new Date(2026, 10, 27).getTime(), kwh: 10, coverage: 1 }, { t: new Date(2026, 10, 28).getTime(), kwh: 14, coverage: 1 }, { t: new Date(2026, 10, 29).getTime(), kwh: 9, coverage: 0.3 }])
ok(ww.weekday === 10 && ww.weekend === 14 && ww.nWeekend === 1, 'weekday Fri 10 vs weekend Sat 14, partial Sunday excluded')
const g = calendarGrid(new Date(2026, 10, 27).getTime())
ok(g.length === 53 && g[52][4]?.date === 27 && g[52][5] === null && g[0][0] && new Date(g[0][0].t).getDay() === 1, 'grid: 53 weeks, Monday first, ends on today (Friday)')
console.log('FAILS:', f); process.exit(f ? 1 : 0)
