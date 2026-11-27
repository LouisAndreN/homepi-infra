import { pivotRaw, computeVoltage, computeCt, referencePower, verifyStep } from '../src/energy/calibrationMath.js'
let fails = 0
const ok = (c, m) => { if (!c) fails++; console.log(`${c ? 'ok ' : 'BAD'} ${m}`) }
const rad = d => d * Math.PI / 180
// Hardware truth (unknown to the wizard)
const TRUE = { Vs: 198.69, I1s: 59.22, I2s: 58.10, phi1: -1.47, phi2: 178.2 }
const Vreal = 101.3
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5 }
// a load on CT k: V (V), I (A), theta (deg) -> raw contribution
const raw = (k, I, th) => {
  const s = k === 1 ? TRUE.I1s : TRUE.I2s, phi = k === 1 ? TRUE.phi1 : TRUE.phi2
  const Vn = Vreal / TRUE.Vs, In = I / s, a = rad(th + phi)
  return { P: Vn * In * Math.cos(a), Q: Vn * In * Math.sin(a) }
}
function points(t0, n, loads, noise = 0.002) {
  const out = []
  for (let i = 0; i < n; i++) {
    const p = { t: t0 + i * 1500, V_n: Vreal / TRUE.Vs * (1 + 0.001 * rnd()), I1_n: 0, I2_n: 0, P1_n: 0, Q1_n: 0, P2_n: 0, Q2_n: 0 }
    for (const L of loads) { const r = raw(L.k, L.I, L.th); p[`P${L.k}_n`] += r.P * (1 + noise * rnd()); p[`Q${L.k}_n`] += r.Q * (1 + noise * rnd()) }
    out.push(p)
  }
  return out
}
const house = [{ k: 1, I: 1.2, th: 45.6 }, { k: 2, I: 0.8, th: 20 }]      // fridge on L1, misc on L2
const kettleL2 = { k: 2, I: 12.3, th: 0 }
// voltage
const vcal = computeVoltage(points(0, 8, house), Vreal, 'multimeter')
ok(Math.abs(vcal.V_scale - TRUE.Vs) / TRUE.Vs < 0.002, `V_scale ${vcal.V_scale.toFixed(2)} (true ${TRUE.Vs})`)
// CT on L2 (reversed), reference by clamp meter 12.3 A
const run = { before: points(0, 12, house), on: points(30000, 12, [...house, kettleL2]), after: points(60000, 12, house) }
const r = computeCt(run, vcal.V_scale, { method: 'clamp_meter', value: 12.3 })
ok(r.ctKey === '2', `kettle detected on CT ${r.ctKey}`)
ok(r.ok, `checks: ${r.checks.map(c => `${c.label}=${c.ok}`).join(', ')}`)
ok(Math.abs(r.cal.I_scale - TRUE.I2s) / TRUE.I2s < 0.005, `I_scale ${r.cal.I_scale.toFixed(2)} (true ${TRUE.I2s})`)
ok(Math.abs(r.cal.phi_deg - TRUE.phi2) < 0.5, `phi ${r.cal.phi_deg.toFixed(2)} (true ${TRUE.phi2}) reversed=${r.reversed}`)
// Pi conversion of a fridge-like load on L2 with the computed calibration
const fr = raw(2, 1.0, 45.6), g = vcal.V_scale * r.cal.I_scale, ph = rad(r.cal.phi_deg)
const P = g * (fr.P * Math.cos(ph) + fr.Q * Math.sin(ph)), Pt = Vreal * 1.0 * Math.cos(rad(45.6))
ok(Math.abs(P - Pt) / Pt < 0.01, `reactive load on reversed CT2 after calibration: ${P.toFixed(1)} W (true ${Pt.toFixed(1)} W)`)
// nameplate scaling
const np = referencePower({ method: 'nameplate', value: 1250 }, 101.3)
ok(Math.abs(np.P_ref_W - 1250 * 1.013 ** 2) < 0.01, `nameplate 1250 W at 101.3 V -> ${np.P_ref_W.toFixed(1)} W`)
// rejections
const drift = { before: points(0, 12, house), on: points(30000, 12, [...house, kettleL2]), after: points(60000, 12, [...house, { k: 2, I: 3, th: 0 }]) }
ok(!computeCt(drift, vcal.V_scale, { method: 'plug_wattmeter', value: 1240 }).ok, 'rejects a load switching during the test')
const both = { before: points(0, 12, house), on: points(30000, 12, [...house, kettleL2, { k: 1, I: 5, th: 0 }]), after: points(60000, 12, house) }
ok(!computeCt(both, vcal.V_scale, { method: 'plug_wattmeter', value: 1240 }).ok, 'rejects a step on both CTs')
let threw = false; try { computeCt({ before: run.before, on: run.before, after: run.after }, vcal.V_scale, { method: 'plug_wattmeter', value: 1240 }) } catch { threw = true }
ok(threw, 'rejects a run with no kettle step')
// pivot
const rows = [{ _time: '2026-11-28T00:00:00Z', _field: 'V_n', _value: '0.5' }, { _time: '2026-11-28T00:00:00Z', _field: 'I1_n', _value: '0.1' }]
ok(pivotRaw(rows).length === 0 && pivotRaw(rows, ['V_n', 'I1_n']).length === 1, 'pivot keeps complete points only')
// verify
const vr = verifyStep({ before: [{ P_L2: 100 }, { P_L2: 101 }, { P_L2: 99 }, { P_L2: 100 }, { P_L2: 100 }], on: Array(5).fill({ P_L2: 1346 }), after: Array(5).fill({ P_L2: 100 }) }, 'P_L2', 1246)
ok(Math.abs(vr.errorPct) < 0.1, `verification error ${vr.errorPct.toFixed(2)}%`)
console.log('FAILS:', fails); process.exit(fails ? 1 : 0)
