// Single source of truth for the green/yellow/red thresholds per metric.
// Used by FloorPlanEditor (heatmap + normalised chart), SensorsTab and FleetTab/DeviceDetailModal.
// Every threshold change is made HERE ONLY: never redefine one locally.

export const STATUS_RANGES = {
  temperature: { lowRed:18, lowYellow:20, highYellow:26, highRed:30 },
  humidity:    { lowRed:25, lowYellow:30, highYellow:60, highRed:70 },
  co2:         { highYellow:800, highRed:1000 },
  lux:         { lowRed:15, lowYellow:30, highYellow:130 },
  iaq:         { highYellow:50, highRed:100 },
}

export function statusColorForValue(metric, value) {
  const r = STATUS_RANGES[metric]
  if (!r || value == null || isNaN(value)) return 'var(--text2)'
  if (r.lowRed != null && value < r.lowRed) return 'var(--danger)'
  if (r.lowYellow != null && value < r.lowYellow) return 'var(--warn)'
  if (r.highRed != null && value >= r.highRed) return 'var(--danger)'
  if (r.highYellow != null && value >= r.highYellow) return 'var(--warn)'
  return 'var(--ok)'
}

// Raw hex values matching the CSS tokens --ok/--warn/--danger/--text3: needed
// for any pixel-by-pixel rendering (canvas), where CSS var() is not resolved.
export const STATUS_HEX = { ok:'#1D9E75', warn:'#EF9F27', danger:'#E24B4A', neutral:'#656c8c' }

export function statusHexForValue(metric, value) {
  const c = statusColorForValue(metric, value)
  if (c === 'var(--ok)') return STATUS_HEX.ok
  if (c === 'var(--warn)') return STATUS_HEX.warn
  if (c === 'var(--danger)') return STATUS_HEX.danger
  return STATUS_HEX.neutral
}

// Normalises a value to [-1, +1] relative to the acceptable limits of the metric.
// -1 = lower acceptable limit, +1 = upper acceptable limit (same convention as the
// reference dashboard). When the metric has no lowRed defined (CO2, IAQ,
// which have no physically meaningful "too low"), the floor of the display
// domain (METRIC_DOMAIN) is used as the lower mark, as a display convention, not as a
// real threshold. A slight overshoot beyond ±1 is allowed (clamped to ±1.5) to show
// overshoots, rather than a strict clamp that would flatten the information visually.
export function normalizeValue(metric, value) {
  const r = STATUS_RANGES[metric]
  if (!r || value == null || isNaN(value)) return null
  const domain = METRIC_DOMAIN[metric]
  const low  = r.lowRed  ?? domain?.[0] ?? value
  const high = r.highRed ?? domain?.[1] ?? value
  if (high === low) return 0
  const n = (2 * (value - low)) / (high - low) - 1
  return Math.max(-1.5, Math.min(1.5, n))
}

export const METRIC_DOMAIN = { temperature:[15,32], humidity:[0,100], co2:[400,1500], lux:[0,150] }
export const METRIC_UNIT  = { temperature:'°C', humidity:'%', co2:'ppm', lux:'lx', iaq:'', pressure:'hPa' }
export const METRIC_LABEL = { temperature:'Température', humidity:'Humidité', co2:'CO₂', lux:'Luminosité', iaq:'IAQ', pressure:'Pression' }

// Fixed palette per metric for series identity in multi-line charts
// (NormalizedMultiChart), distinct from statusColorForValue (which encodes a
// danger status); here it is a constant visual identity per metric.
export const METRIC_SERIES_COLOR = {
  temperature: '#D85A30',
  humidity:    '#378ADD',
  co2:         '#1D9E75',
  lux:         '#EF9F27',
  iaq:         '#7F77DD',
  pressure:    '#9990EE',
}


// Metrics counted in the composite comfort score: light excluded
// (no universal "acceptable zone", used for event detection,
// not comfort), pressure excluded (follows the outdoor weather, not actionable
// by the occupant, adds noise to the score without useful information).
export const COMFORT_METRICS = ['co2','temperature','humidity','iaq']

export const STATUS_HEX_COMPOSITE = { ok:'#1D9E75', warn:'#EF9F27', bad:'#E07B39', danger:'#E24B4A', neutral:'#3a3f52' }

// Composite comfort score for a given point/pixel: average of the excess
// beyond the acceptable limits over all comfort metrics
// available at this point. 0 = fully within limits everywhere;
// the higher the value, the more severe or numerous the overshoots.
// Weighted by severity (not just a binary count) so that a
// slight isolated overshoot does not tip the whole score into alert.
export function compositeExcess(valuesByMetric) {
  let total = 0, count = 0
  for (const m of COMFORT_METRICS) {
    const v = valuesByMetric[m]
    if (v == null || isNaN(v)) continue
    const n = normalizeValue(m, v)
    if (n == null) continue
    count++
    total += Math.max(0, Math.abs(n) - 1)
  }
  if (count === 0) return null
  return total / count
}

export function colorForExcess(excess) {
  if (excess == null) return STATUS_HEX_COMPOSITE.neutral
  if (excess < 0.05) return STATUS_HEX_COMPOSITE.ok
  if (excess < 0.25) return STATUS_HEX_COMPOSITE.warn
  if (excess < 0.6)  return STATUS_HEX_COMPOSITE.bad
  return STATUS_HEX_COMPOSITE.danger
}

// % of time (or of measurements) when ALL available comfort metrics
// are within their acceptable zone at once: the central "CV" measure.
// points: array of { valuesByMetric }, one entry per sampled instant.
export function comfortScorePct(points) {
  if (!points.length) return null
  let goodCount = 0, validCount = 0
  for (const p of points) {
    const excess = compositeExcess(p.valuesByMetric)
    if (excess == null) continue
    validCount++
    if (excess < 0.05) goodCount++ // "acceptable" threshold = the same threshold as the heatmap green
  }
  if (validCount === 0) return null
  return (goodCount / validCount) * 100
}