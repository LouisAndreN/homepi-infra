// Weather at home (JMA AMeDAS observations picked on the Pi, measurements weather and weather_daily,
// docs/runbooks/weather.md). A dry hour without daylight has no code: cloud cover is not observed.
// Pure functions, unit-tested with node (tests/weather.test.mjs).
//
// WMO weather codes are folded into a few kinds, each with one icon. A day shows every kind it had
// (in the order they appeared), as long as it lasted: 2 hours or more, or 1 hour for anything wet
// (drizzle, rain, snow, thunder). A single model hour of "partly cloudy" between two clear hours is noise.

const pad2 = n => String(n).padStart(2, '0')
export const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

export const WEATHER_KINDS = {
  clear:   { icon: '☀️', night: '🌙', label: 'Clear' },
  partly:  { icon: '⛅', night: '☁️', label: 'Partly cloudy' },
  cloudy:  { icon: '☁️', label: 'Cloudy' },
  fog:     { icon: '🌫️', label: 'Fog' },
  drizzle: { icon: '🌦️', label: 'Drizzle', wet: true },
  rain:    { icon: '🌧️', label: 'Rain', wet: true },
  snow:    { icon: '🌨️', label: 'Snow', wet: true },
  thunder: { icon: '⛈️', label: 'Thunderstorm', wet: true },
}

export function kindOf(code) {
  const c = Number(code)
  if (!Number.isFinite(c)) return null
  if (c <= 1) return 'clear'
  if (c === 2) return 'partly'
  if (c === 3) return 'cloudy'
  if (c === 45 || c === 48) return 'fog'
  if (c >= 51 && c <= 57) return 'drizzle'
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain'
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow'
  if (c >= 95 && c <= 99) return 'thunder'
  return null
}

export const iconOf = (kind, isDay = true) => !kind ? '' : (!isDay && WEATHER_KINDS[kind].night) || WEATHER_KINDS[kind].icon

// Flux rows {_time, _measurement, _field, _value} (weather and weather_daily, any bucket, duplicates allowed:
// iot-hot and iot-archives hold the same points) -> hours sorted by time, and sunrise/sunset per local day.
export function parseWeather(rows) {
  const hours = new Map(), sun = new Map()
  for (const r of rows || []) {
    const t = Date.parse(r._time), v = parseFloat(r._value)
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue
    if (r._measurement === 'weather_daily') {
      const k = dayKey(new Date(t))
      const s = sun.get(k) || {}
      if (r._field === 'sunrise' || r._field === 'sunset') s[r._field] = v * 1000
      sun.set(k, s)
      continue
    }
    const h = hours.get(t) || { t }
    if (r._field === 'code') { h.code = v; h.kind = kindOf(v) }
    else if (r._field === 'is_day') h.isDay = v === 1
    else if (r._field === 'temp') h.temp = v
    else if (r._field === 'precip') h.precip = v
    else if (r._field === 'sun') h.sun = v
    else if (r._field === 'dist_km') h.distKm = v
    hours.set(t, h)
  }
  return { hours: [...hours.values()].sort((a, b) => a.t - b.t), sun }
}

// Kinds of each local day, in the order they first appeared (see the rule at the top)
export function dayKinds(hours, maxIcons = 4) {
  const days = new Map()
  for (const h of hours) {
    if (!h.kind) continue
    const k = dayKey(new Date(h.t))
    if (!days.has(k)) days.set(k, new Map())
    const m = days.get(k)
    const e = m.get(h.kind) || { kind: h.kind, n: 0, first: h.t }
    e.n++; m.set(h.kind, e)
  }
  const out = new Map()
  for (const [k, m] of days) {
    const all = [...m.values()]
    let kept = all.filter(e => e.n >= 2 || (WEATHER_KINDS[e.kind].wet && e.n >= 1))
    if (!kept.length) kept = [all.sort((a, b) => b.n - a.n)[0]]
    out.set(k, kept.sort((a, b) => a.first - b.first).slice(0, maxIcons).map(e => e.kind))
  }
  return out
}

// Contiguous runs of the same kind (and same day/night for the icon) inside [fromMs, toMs), in minutes
// from fromMs: the weather strip above the day chart. An hour without data breaks the run.
export function weatherRuns(hours, fromMs, toMs) {
  const runs = []
  for (const h of hours) {
    if (!h.kind || h.t < fromMs || h.t >= toMs) continue
    const m0 = (h.t - fromMs) / 60000, m1 = Math.min((toMs - fromMs) / 60000, m0 + 60)
    const isDay = h.isDay !== false
    const last = runs.at(-1)
    if (last && last.kind === h.kind && last.isDay === isDay && Math.abs(last.m1 - m0) < 1) { last.m1 = m1; last.hours.push(h) }
    else runs.push({ kind: h.kind, isDay, m0, m1, hours: [h] })
  }
  return runs
}

// The hour containing t (null when that hour has no data)
export function hourAt(hours, t) {
  for (let i = hours.length - 1; i >= 0; i--) if (hours[i].t <= t) return t - hours[i].t < 3600e3 ? hours[i] : null
  return null
}
