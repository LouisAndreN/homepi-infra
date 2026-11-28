import { kindOf, parseWeather, dayKinds, weatherRuns, hourAt, iconOf } from '../src/energy/weather.js'
import { energyCost, dayCost, monthCost, tierAt } from '../src/energy/tariff.js'
import { buildWeek, mondayOf } from '../src/energy/week.js'
let f = 0; const ok = (c, m) => { if (!c) f++; console.log(`${c ? 'ok ' : 'BAD'} ${m}`) }

// WMO codes -> kinds
ok([0, 1, 2, 3, 45, 53, 63, 81, 73, 95, 4].map(kindOf).join() === 'clear,clear,partly,cloudy,fog,drizzle,rain,rain,snow,thunder,', 'WMO codes folded into kinds')
ok(iconOf('clear', false) === '🌙' && iconOf('clear') === '☀️' && iconOf('cloudy', false) === '☁️', 'night icon only where one exists')

// Rows as InfluxDB returns them, the same point twice (iot-hot and iot-archives)
const T0 = new Date(2026, 10, 28, 0, 0).getTime(), H = 3600e3
const iso = t => new Date(t).toISOString()
const rows = []
const codes = [0, 0, 0, 0, 0, 0, 2, 0, 0, 3, 3, 3, 61, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0]   // 24 h of one day
codes.forEach((c, h) => { rows.push({ _time: iso(T0 + h * H), _measurement: 'weather', _field: 'code', _value: String(c) }) })
codes.forEach((c, h) => { rows.push({ _time: iso(T0 + h * H), _measurement: 'weather', _field: 'code', _value: String(c) }) })
codes.forEach((c, h) => { rows.push({ _time: iso(T0 + h * H), _measurement: 'weather', _field: 'is_day', _value: h >= 7 && h < 17 ? '1' : '0' }) })
rows.push({ _time: iso(T0 + 5 * H), _measurement: 'weather', _field: 'temp', _value: '6.5' })
rows.push({ _time: iso(T0), _measurement: 'weather_daily', _field: 'sunrise', _value: String((T0 + 6.5 * H) / 1000) })
rows.push({ _time: iso(T0), _measurement: 'weather_daily', _field: 'sunset', _value: String((T0 + 16.5 * H) / 1000) })
const { hours, sun } = parseWeather(rows)
ok(hours.length === 24 && hours[5].temp === 6.5 && hours[8].isDay === true && hours[2].isDay === false, 'duplicates merged, fields joined per hour')
const s = sun.get('2026-11-28')
ok(s && s.sunrise === T0 + 6.5 * H && s.sunset === T0 + 16.5 * H, 'sunrise and sunset per local day, in ms')

// One hour of partly cloudy is noise, one hour of rain is not; order = first appearance
const k = dayKinds(hours).get('2026-11-28')
ok(k.join() === 'clear,cloudy,rain', `day kinds ${k}`)
ok(dayKinds([{ t: T0, kind: 'partly' }]).get('2026-11-28').join() === 'partly', 'a day with a single hour still gets its icon')

// Strip runs inside the day, broken by kind, by day/night and by a missing hour
const runs = weatherRuns(hours, T0, T0 + 24 * H)
ok(runs[0].kind === 'clear' && runs[0].m0 === 0 && runs[0].m1 === 360 && !runs[0].isDay, 'first run: clear night 00:00-06:00')
ok(runs.find(r => r.kind === 'rain').m0 === 720 && runs.find(r => r.kind === 'rain').m1 === 780, 'rain 12:00-13:00')
const gapRuns = weatherRuns(hours.filter(h => h.t !== T0 + 2 * H), T0, T0 + 24 * H)
ok(gapRuns[0].m1 === 120 && gapRuns[1].m0 === 180, 'a missing hour breaks the run')
ok(hourAt(hours, T0 + 12 * H + 1800e3).kind === 'rain' && hourAt([], T0) === null && hourAt(hours.slice(0, 1), T0 + 3 * H) === null, 'hour under the cursor, none when stale')

// A dry night hour has no code (cloud cover is not observed): kept for its temperature, never an icon
const dry = parseWeather([{ _time: iso(T0 + 3 * H), _measurement: 'weather', _field: 'temp', _value: '4.2' },
  { _time: iso(T0 + 3 * H), _measurement: 'weather', _field: 'dist_km', _value: '7.9' }]).hours
ok(dry.length === 1 && !dry[0].kind && dry[0].temp === 4.2 && dry[0].distKm === 7.9, 'hour without a code kept, with temperature and station distance')
ok(!dayKinds(dry).size && !weatherRuns(dry, T0, T0 + 24 * H).length && hourAt(dry, T0 + 3.5 * H).temp === 4.2, 'no icon, no run; the tooltip still finds the hour')

// Tariff: monthly tiers, standing charge per day
const contract = { utilities: { electricity: { enabled: true, standingChargePerDay: 30, tiers: [{ from: 0, to: 120, ratePerKwh: 30 }, { from: 120, to: 300, ratePerKwh: 36 }, { from: 300, to: null, ratePerKwh: 40 }] } } }
ok(energyCost(100, 130, contract) === 20 * 30 + 10 * 36, 'a day that crosses into tier 2')
ok(dayCost(10, 0, contract) === 330 && dayCost(null, 0, contract) === null, 'day cost = energy + one standing charge')
const mc = monthCost(310, 28, contract)
ok(mc.energy === 120 * 30 + 180 * 36 + 10 * 40 && mc.standing === 840 && mc.total === mc.energy + 840, `month cost ${mc.total}`)
ok(tierAt(150, contract).ratePerKwh === 36 && tierAt(1e6, contract).ratePerKwh === 40, 'current tier')

// Week: Monday first, future days empty, last week compared at the same point
const now = new Date(2026, 10, 26, 12, 0).getTime()    // Thursday 12:00
ok(mondayOf(now).getDate() === 23 && mondayOf(new Date(2026, 10, 29, 23).getTime()).getDate() === 23, 'Monday of the week (Sunday stays in it)')
const tot = { '2026-11-23': 10, '2026-11-24': 12, '2026-11-25': 11, '2026-11-26': 5, '2026-11-16': 9, '2026-11-17': 9, '2026-11-18': 9, '2026-11-19': 14, '2026-11-20': 8 }
const w = buildWeek(now, key => key in tot ? { kwh: tot[key], coverage: 1 } : null, (key, m) => key === '2026-11-19' ? 6 : null, 720)
ok(w.days.length === 7 && w.days[3].partial && w.days[4].future && w.days[4].kwh === null && w.days[4].prevKwh === 8, 'Thursday partial, Friday future with last week shown')
ok(w.thisSoFar === 38 && w.lastAtPoint === 9 + 9 + 9 + 6 && w.lastFull === 49 && w.prevDays === 5, `this week ${w.thisSoFar} vs last week at this point ${w.lastAtPoint}`)

console.log(f ? `${f} FAILED` : 'all ok'); process.exit(f ? 1 : 0)
