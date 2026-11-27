// Per-leg logic shared by the Energy tabs (overview, per-device, timeline).
import { ENERGY } from '../config.js'

export const LEG_FIELDS = ENERGY.legs.map(l => l.field)   // fetched and shown per circuit
export const ctKeyOf = field => field.replace('P_L', '')

// Per-leg state: the Pi calibration file (admin API) decides when it exists. A CT with a calibration
// entry is in the total; before its calibrated_at its history is ignored unless the config trusts it
// (L1 values from firmware v2 were roughly right, L2 had the wrong sign). Without the API, config.js.
export function resolveLegs(calibration) {
  return ENERGY.legs.map(l => {
    const c = calibration?.cts?.[ctKeyOf(l.field)]
    if (!c) return { ...l, calibrated: false, since: null }
    return { ...l, calibrated: true, validated: true, inTotal: true,
      since: l.trustUncalibratedHistory ? null : Date.parse(c.calibrated_at),
      I_scale: c.I_scale, phi_deg: c.phi_deg, calibrated_at: c.calibrated_at, reference: c.reference }
  })
}

// InfluxDB rows {_time,_field,_value} -> time-sorted [{t, legs:{P_L1,P_L2}, w}]
// w = sum of the legs in the total that are active at t (after their `since`). A point is kept only if
// every such leg is present: both legs arrive in the same message, a half point is a parse problem.
// Legs outside the total are optional (an uncalibrated CT has no P_Lk field on firmware v3).
export function sumLegs(rows, legs) {
  const byT = new Map()
  for (const r of rows) {
    if (!LEG_FIELDS.includes(r._field)) continue
    const t = Date.parse(r._time), v = parseFloat(r._value)
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue
    let e = byT.get(t)
    if (!e) { e = { t, legs: {} }; byT.set(t, e) }
    e.legs[r._field] = v
  }
  const out = []
  for (const e of byT.values()) {
    let ok = true, w = 0
    for (const l of legs) {
      const counted = l.inTotal && !(l.since && e.t < l.since)
      if (!(l.field in e.legs)) { if (counted) { ok = false; break } e.legs[l.field] = null; continue }
      if (counted) w += e.legs[l.field]
    }
    if (!ok) continue
    e.w = w
    out.push(e)
  }
  return out.sort((a, b) => a.t - b.t)
}

