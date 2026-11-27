// NILM calibration math (dashboard wizard). Pure functions, no React, unit-tested with node.
//
// Raw values come from firmware v3 (window means published by the bridge every ~1.5 s):
//   V_n, Ik_n, Pk_n, Qk_n in ADC full-scale units.
// The Pi applies (homepi-nilm-calibrate):
//   Pk = V_scale * Ik_scale * (Pk_n cos(phik) + Qk_n sin(phik))
//
// CT calibration is DIFFERENTIAL: baseline (kettle off), kettle on, baseline again. The kettle's
// contribution is the step of the (Pn, Qn) vector on the CT that carries it, so the rest of the house
// can keep running. Requirements checked: the house load did not change during the test (before vs
// after), the step shows on one CT only, and the readings were steady.

export const NOMINAL_MAINS_V = 100          // Japan
export const LIMITS = {
  minPoints: 5,             // per phase, ~1.5 s each
  maxBaselineNoise: 0.03,   // baseline std / kettle step
  maxBaselineDrift: 0.03,   // |mean(before) - mean(after)| / kettle step
  maxOnNoise: 0.03,         // std while on / kettle step
  maxOtherCt: 0.10,         // step on the other CT / step on this CT
  minStepN: 0.01,           // |step| in normalised units (~120 W at nominal gains): smaller is not a kettle
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length
const std = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) }

// InfluxDB rows {_time,_field,_value} -> time-sorted [{t, V_n, I1_n, ...}] (complete points only)
export function pivotRaw(rows, fields = ['V_n', 'I1_n', 'I2_n', 'P1_n', 'Q1_n', 'P2_n', 'Q2_n']) {
  const byT = new Map()
  for (const r of rows) {
    if (!fields.includes(r._field)) continue
    const t = Date.parse(r._time), v = parseFloat(r._value)
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue
    let e = byT.get(t)
    if (!e) { e = { t }; byT.set(t, e) }
    e[r._field] = v
  }
  return [...byT.values()].filter(e => fields.every(f => f in e)).sort((a, b) => a.t - b.t)
}

export const slice = (pts, fromMs, toMs) => pts.filter(p => p.t >= fromMs && p.t <= toMs)

export function computeVoltage(points, referenceV, method) {
  if (points.length < LIMITS.minPoints) throw new Error(`only ${points.length} readings: wait for data and retry`)
  const vn = points.map(p => p.V_n)
  const V_n = mean(vn)
  const noise = std(vn) / V_n
  if (noise > 0.01) throw new Error(`voltage unsteady (${(noise * 100).toFixed(1)}%): retry`)
  return { V_scale: referenceV / V_n, reference_V: referenceV, method, V_n }
}

// Reference active power of the kettle, from what the user measured.
//  clamp_meter: current on the kettle cord, resistive load -> P = V * I
//  plug_wattmeter: reading in W
//  nameplate: rated W at 100 V, scaled to the measured voltage (resistive: P ~ V^2)
export function referencePower(ref, voltsDuringTest) {
  switch (ref.method) {
    case 'clamp_meter':    return { ...ref, unit: 'A', P_ref_W: voltsDuringTest * ref.value }
    case 'plug_wattmeter': return { ...ref, unit: 'W', P_ref_W: ref.value }
    case 'nameplate':      return { ...ref, unit: 'W', P_ref_W: ref.value * (voltsDuringTest / NOMINAL_MAINS_V) ** 2 }
    default: throw new Error(`unknown reference method ${ref.method}`)
  }
}

// before/on/after: point arrays (see pivotRaw). Returns which CT carried the kettle and its calibration.
export function computeCt({ before, on, after }, V_scale, ref) {
  for (const [name, a] of [['before', before], ['on', on], ['after', after]]) {
    if (a.length < LIMITS.minPoints) throw new Error(`only ${a.length} readings while ${name === 'on' ? 'the kettle was on' : `kettle off (${name})`}: retry`)
  }
  const base = [...before, ...after]
  const step = k => {
    const P = `P${k}_n`, Q = `Q${k}_n`
    const dP = mean(on.map(p => p[P])) - mean(base.map(p => p[P]))
    const dQ = mean(on.map(p => p[Q])) - mean(base.map(p => p[Q]))
    return { k, dP, dQ, mag: Math.hypot(dP, dQ) }
  }
  const s1 = step(1), s2 = step(2)
  const [hit, other] = s1.mag >= s2.mag ? [s1, s2] : [s2, s1]
  if (hit.mag < LIMITS.minStepN) throw new Error('no clear step: was the kettle really on during the measurement?')
  const ctKey = String(hit.k), P = `P${hit.k}_n`
  const otherRatio = other.mag / hit.mag
  const baselineNoise = std(base.map(p => p[P])) / hit.mag
  const drift = Math.abs(mean(before.map(p => p[P])) - mean(after.map(p => p[P]))) / hit.mag
  const onNoise = std(on.map(p => p[P])) / hit.mag
  const checks = [
    { ok: otherRatio <= LIMITS.maxOtherCt, label: 'Step on one CT only', value: `${(otherRatio * 100).toFixed(1)}% on the other CT` },
    { ok: drift <= LIMITS.maxBaselineDrift, label: 'House load unchanged (before vs after)', value: `${(drift * 100).toFixed(1)}% of the step` },
    { ok: baselineNoise <= LIMITS.maxBaselineNoise, label: 'Steady baseline', value: `${(baselineNoise * 100).toFixed(1)}% of the step` },
    { ok: onNoise <= LIMITS.maxOnNoise, label: 'Steady while on', value: `${(onNoise * 100).toFixed(1)}% of the step` },
  ]
  const voltsDuringTest = mean(on.map(p => p.V_n)) * V_scale
  const reference = referencePower(ref, voltsDuringTest)
  const I_scale = reference.P_ref_W / (V_scale * hit.mag)
  const phi_deg = Math.atan2(hit.dQ, hit.dP) * 180 / Math.PI
  return {
    ctKey, checks, ok: checks.every(c => c.ok), voltsDuringTest,
    cal: {
      I_scale, phi_deg, reference,
      measured: { dP_n: hit.dP, dQ_n: hit.dQ, baseline_std_ratio: Math.max(baselineNoise, drift),
        other_ct_ratio: otherRatio, points_on: on.length, points_off: base.length },
    },
    reversed: Math.abs(phi_deg) > 90,
  }
}

// End-to-end check after saving: the CALIBRATED P_Lk field written by the Pi processor.
export function verifyStep({ before, on, after }, field, P_ref_W) {
  const base = [...before, ...after].map(p => p[field]), onv = on.map(p => p[field])
  if (base.length < LIMITS.minPoints || onv.length < LIMITS.minPoints) throw new Error('not enough calibrated readings yet: retry')
  const dP = mean(onv) - mean(base)
  return { dP, errorPct: 100 * (dP - P_ref_W) / P_ref_W }
}
