import { useState, useRef, useEffect } from 'react'
import { fluxQuery } from '../hooks/useInflux.js'
import { API_BASE, ENERGY } from '../config.js'
import { pivotRaw, slice, computeVoltage, computeCt, verifyStep, NOMINAL_MAINS_V } from '../energy/calibrationMath.js'

// NILM calibration wizard. Order: prerequisites -> voltage -> CT on one leg -> CT on the other leg
// -> review and save -> end-to-end verification on the calibrated values written by the Pi.
// Measurements are differential (kettle off / on / off), so the rest of the house keeps running.
// Windows are absolute timestamps: the browser and the Pi are both on NTP.

const DATA_DELAY_MS = 12000   // bridge window 1.5 s + Telegraf flush (default 10 s)
const T = { baseline: 20, settleOn: 4, on: 16, settleOff: 3, off: 16, voltage: 10 }
const RAW_FIELDS = ['V_n', 'I1_n', 'I2_n', 'P1_n', 'Q1_n', 'P2_n', 'Q2_n']

const sleep = ms => new Promise(r => setTimeout(r, ms))
const iso = ms => new Date(ms).toISOString()

async function queryWindow(fromMs, toMs, fields) {
  const set = fields.map(f => `"${f}"`).join(', ')
  return fluxQuery(`
from(bucket: "${ENERGY.bucket}")
  |> range(start: time(v: "${iso(fromMs)}"), stop: time(v: "${iso(toMs)}"))
  |> filter(fn: (r) => r._measurement == "${ENERGY.measurement}")
  |> filter(fn: (r) => contains(value: r._field, set: [${set}]))
  |> group(columns: ["_field"])
  |> keep(columns: ["_time", "_field", "_value"])`)
}

// ── UI atoms ──────────────────────────────────────────────────────────────────
const btn = (primary, disabled) => ({
  padding: 'var(--sp-2) var(--sp-4)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', fontWeight: 700,
  border: primary ? 'none' : '0.5px solid var(--border)', cursor: disabled ? 'not-allowed' : 'pointer',
  background: primary ? 'var(--accent-vivid)' : 'var(--bg2)', color: primary ? '#fff' : 'var(--text2)', opacity: disabled ? 0.5 : 1,
})
const input = { padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)', width: 120 }
const P = ({ children, muted }) => <p style={{ fontSize: 'var(--fs-sm)', color: muted ? 'var(--text3)' : 'var(--text2)', lineHeight: 1.6, margin: '0 0 var(--sp-2)' }}>{children}</p>
const Err = ({ msg }) => msg ? <div role="alert" style={{ margin: 'var(--sp-2) 0', padding: 'var(--sp-2) var(--sp-3)', border: '0.5px solid var(--danger)', borderRadius: 'var(--r-sm)', color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>⚠ {msg}</div> : null
const Kv = ({ k, v }) => <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '2px 0' }}><span style={{ color: 'var(--text3)' }}>{k}</span><span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{v}</span></div>

function Checks({ checks }) {
  return checks.map(c => (
    <div key={c.label} style={{ display: 'flex', gap: 6, fontSize: 'var(--fs-xs)', color: c.ok ? 'var(--text2)' : 'var(--danger)', lineHeight: 1.7 }}>
      <span aria-hidden="true" style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)' }}>{c.ok ? '✓' : '✗'}</span>
      <span>{c.label}</span><span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{c.value}</span>
    </div>
  ))
}

const STEPS = ['Check', 'Voltage', 'CT A', 'CT B', 'Save', 'Verify']

// Off / on / off sequence driven by the user's clicks. Returns absolute windows.
function useKettleSequence() {
  const [phase, setPhase] = useState('idle')   // idle | baseline | waitOn | on | waitOff | off | data | done
  const [left, setLeft] = useState(0)
  const marks = useRef({})
  const resolver = useRef(null)
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  async function countdown(s) {
    for (let i = s; i > 0; i--) { if (cancelled.current) throw new Error('cancelled'); setLeft(i); await sleep(1000) }
    setLeft(0)
  }
  const waitClick = next => new Promise(res => { resolver.current = res; setPhase(next) })
  const click = () => { const r = resolver.current; resolver.current = null; r && r() }

  async function run() {
    const m = marks.current = {}
    setPhase('baseline'); m.b0 = Date.now(); await countdown(T.baseline); m.b1 = Date.now()
    await waitClick('waitOn')
    setPhase('on'); await countdown(T.settleOn); m.o0 = Date.now(); await countdown(T.on); m.o1 = Date.now()
    await waitClick('waitOff')
    setPhase('off'); await countdown(T.settleOff); m.a0 = Date.now(); await countdown(T.off); m.a1 = Date.now()
    setPhase('data'); await countdown(DATA_DELAY_MS / 1000)
    setPhase('done')
    return { ...m }
  }
  return { phase, left, run, click, reset: () => setPhase('idle') }
}

function SequencePanel({ seq, onStart, disabled }) {
  const msg = {
    idle: null,
    baseline: `Kettle OFF. Measuring the house baseline… ${seq.left} s`,
    waitOn: 'Switch the kettle ON now, then click.',
    on: `Kettle ON. Measuring… ${seq.left} s`,
    waitOff: 'Switch the kettle OFF now, then click.',
    off: `Kettle OFF. Measuring the baseline again… ${seq.left} s`,
    data: `Waiting for the readings to reach InfluxDB… ${seq.left} s`,
    done: null,
  }[seq.phase]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap', margin: 'var(--sp-3) 0' }}>
      {(seq.phase === 'idle' || seq.phase === 'done') && <button style={btn(true, disabled)} disabled={disabled} onClick={onStart}>{seq.phase === 'done' ? 'Measure again' : 'Start measurement'}</button>}
      {seq.phase === 'waitOn' && <button style={btn(true)} onClick={seq.click}>The kettle is ON</button>}
      {seq.phase === 'waitOff' && <button style={btn(true)} onClick={seq.click}>The kettle is OFF</button>}
      {msg && <span style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)', color: 'var(--text2)' }} aria-live="polite">{msg}</span>}
    </div>
  )
}

function ReferenceInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', margin: 'var(--sp-2) 0' }}>
      <select value={value.method} onChange={e => onChange({ ...value, method: e.target.value })} style={{ ...input, width: 'auto', fontFamily: 'var(--font)' }}>
        <option value="clamp_meter">Clamp meter on the kettle cord (A), best</option>
        <option value="plug_wattmeter">Plug-in wattmeter (W)</option>
        <option value="nameplate">Nameplate rating (W at 100 V), least precise</option>
      </select>
      <input type="number" step="0.01" min="0" style={input} value={value.value} placeholder={value.method === 'clamp_meter' ? 'A' : 'W'}
        onChange={e => onChange({ ...value, value: e.target.value })} aria-label="Reference value" />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{value.method === 'clamp_meter' ? 'A, read while the kettle is on' : 'W'}</span>
    </div>
  )
}

// ── Wizard ────────────────────────────────────────────────────────────────────
export function NilmCalibrationWizard({ current, onClose, onSaved }) {
  const [step, setStep] = useState(0)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState(null)
  const [voltRef, setVoltRef] = useState({ method: 'multimeter', value: '' })
  const [voltage, setVoltage] = useState(null)          // result of computeVoltage, or null = keep current
  const [ref, setRef] = useState({ method: 'clamp_meter', value: '' })
  const [ctResults, setCtResults] = useState([])        // accepted computeCt results
  const [pending, setPending] = useState(null)          // last computeCt result, not yet accepted
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(null)
  const [verify, setVerify] = useState({})              // ctKey -> {errorPct} | {error}
  const seq = useKettleSequence()

  const V_scale = voltage?.V_scale ?? current?.V_scale ?? null
  const fail = e => setErr(e?.message || String(e))

  async function runCheck() {
    setErr(null); setBusy(true)
    try {
      const rows = await fluxQuery(`
from(bucket: "${ENERGY.bucket}")
  |> range(start: -2m)
  |> filter(fn: (r) => r._measurement == "${ENERGY.measurement}")
  |> filter(fn: (r) => r._field == "fw_teensy" or r._field == "V_n" or r._field == "cycles" or r._field == "V_rms")
  |> last()
  |> keep(columns: ["_time", "_field", "_value"])`)
      const get = f => rows.find(r => r._field === f)
      const fw = get('fw_teensy') ? +get('fw_teensy')._value : null
      const last = Math.max(...rows.map(r => Date.parse(r._time)).filter(Number.isFinite))
      const ageS = Number.isFinite(last) ? (Date.now() - last) / 1000 : null
      setCheck({ fw, ageS, cycles: get('cycles') ? +get('cycles')._value : null, legacy: !!get('V_rms') && !get('V_n') })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  useEffect(() => { runCheck() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const checkOk = check && check.fw >= 300 && check.ageS != null && check.ageS < 30

  async function measureVoltage() {
    setErr(null); setBusy(true)
    try {
      const refV = voltRef.method === 'nominal' ? NOMINAL_MAINS_V : parseFloat(voltRef.value)
      if (!(refV > 80 && refV < 130)) throw new Error('enter the voltage read on the multimeter (between 80 and 130 V)')
      const t0 = Date.now()
      await sleep(T.voltage * 1000)
      const t1 = Date.now()
      await sleep(DATA_DELAY_MS)
      const pts = pivotRaw(await queryWindow(t0, t1, ['V_n']), ['V_n'])
      setVoltage(computeVoltage(pts, refV, voltRef.method))
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  async function measureCt() {
    setErr(null); setPending(null)
    const refVal = parseFloat(ref.value)
    if (!(refVal > 0)) { setErr('enter the reference value first (you can read the clamp meter during the ON phase and type it before the end)'); return }
    try {
      const m = await seq.run()
      const pts = pivotRaw(await queryWindow(m.b0, m.a1, RAW_FIELDS))
      const r = computeCt({ before: slice(pts, m.b0, m.b1), on: slice(pts, m.o0, m.o1), after: slice(pts, m.a0, m.a1) },
        V_scale, { method: ref.method, value: parseFloat(ref.value) })
      if (ctResults.some(c => c.ctKey === r.ctKey)) throw new Error(`the kettle showed on CT ${r.ctKey} again: plug it into an outlet on the other leg`)
      setPending(r)
    } catch (e) { if (e.message !== 'cancelled') fail(e) }
  }

  async function save() {
    setErr(null); setBusy(true)
    try {
      const body = { note, cts: Object.fromEntries(ctResults.map(c => [c.ctKey, c.cal])) }
      if (voltage) body.voltage = voltage
      const r = await fetch(`${API_BASE}/api/admin/nilm/calibration`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`)
      const s = await r.json()
      setSaved(s); onSaved?.(s); setStep(5)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  async function runVerify(ctKey, P_ref_W) {
    setErr(null)
    try {
      const m = await seq.run()
      const field = `P_L${ctKey}`
      const rows = await queryWindow(m.b0, m.a1, [field, 'calib_version'])
      const pts = pivotRaw(rows, [field, 'calib_version']).filter(p => p.calib_version === saved.version)
      const v = verifyStep({ before: slice(pts, m.b0, m.b1), on: slice(pts, m.o0, m.o1), after: slice(pts, m.a0, m.a1) }, field, P_ref_W)
      setVerify(x => ({ ...x, [ctKey]: v }))
    } catch (e) { if (e.message !== 'cancelled') setVerify(x => ({ ...x, [ctKey]: { error: e.message } })) }
  }

  const running = !['idle', 'done'].includes(seq.phase)
  const ctStep = step === 2 || step === 3
  const ctIndex = step - 2

  return (
    <div className="hp-card hp-card--elevated" style={{ boxShadow: 'var(--shadow-3)', padding: 'var(--sp-5)', width: 'min(600px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>NILM calibration</div>
        <button onClick={onClose} className="hp-focus-visible" aria-label="Close" disabled={busy || running}
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 'var(--fs-md)' }}>✕</button>
      </div>

      {/* Stepper */}
      <ol style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, margin: '0 0 var(--sp-4)' }}>
        {STEPS.map((s, i) => (
          <li key={s} style={{ flex: 1, textAlign: 'center', fontSize: 'var(--fs-2xs)', fontWeight: i === step ? 700 : 400,
            color: i === step ? 'var(--text)' : i < step ? 'var(--text2)' : 'var(--text3)',
            borderTop: `3px solid ${i <= step ? 'var(--accent-vivid)' : 'var(--border)'}`, paddingTop: 4 }}>
            {i < step ? '✓ ' : ''}{s}
          </li>
        ))}
      </ol>

      {step === 0 && (<>
        <P>You need: a kettle (resistive, about 1–1.4 kW), and ideally a multimeter and a clamp meter. The rest of the house can keep running; avoid starting big appliances during each 1-minute measurement.</P>
        {check && (
          <div className="hp-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
            <Kv k="Last NILM reading" v={check.ageS == null ? 'none in 2 min' : `${Math.round(check.ageS)} s ago`} />
            <Kv k="Teensy firmware" v={check.fw ? `v${Math.floor(check.fw / 100)}.${check.fw % 100}` : (check.legacy ? 'v2.x (calibrated on the Teensy)' : 'unknown')} />
            <Kv k="Cycles per published window" v={check.cycles ?? '—'} />
          </div>
        )}
        {check && !checkOk && <Err msg={check.fw == null || check.fw < 300 ? 'Calibration on the Pi needs Teensy firmware v3.0 and the v3 bridge: flash them first.' : 'No recent NILM data: check the bridge.'} />}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <button style={btn(false, busy)} disabled={busy} onClick={runCheck}>Check again</button>
          <button style={btn(true, !checkOk)} disabled={!checkOk} onClick={() => setStep(1)}>Next</button>
        </div>
      </>)}

      {step === 1 && (<>
        <P>Measure the voltage between a live pin and neutral of any 100 V outlet with the multimeter, and type it. It sets <b>V_scale</b>; every power figure depends on it.</P>
        {current?.V_scale && <P muted>Current: V_scale {current.V_scale.toFixed(3)} ({current.voltage?.method || '?'}, {current.voltage?.calibrated_at || '?'}).</P>}
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" step="0.1" style={input} value={voltRef.value} disabled={voltRef.method === 'nominal'} placeholder="V"
            onChange={e => setVoltRef({ ...voltRef, value: e.target.value })} aria-label="Measured voltage" />
          <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={voltRef.method === 'nominal'} onChange={e => setVoltRef({ ...voltRef, method: e.target.checked ? 'nominal' : 'multimeter' })} />
            No multimeter: assume 100 V (flagged as an estimate; real mains is 95–107 V)
          </label>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <button style={btn(true, busy)} disabled={busy} onClick={measureVoltage}>{busy ? 'Measuring (~25 s)…' : 'Measure'}</button>
          {current?.V_scale && <button style={btn(false, busy)} disabled={busy} onClick={() => { setVoltage(null); setStep(2) }}>Keep current voltage</button>}
        </div>
        {voltage && (
          <div className="hp-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
            <Kv k="V_scale" v={voltage.V_scale.toFixed(3)} />
            <Kv k="Raw V_n" v={voltage.V_n.toFixed(5)} />
            <div style={{ marginTop: 'var(--sp-2)' }}><button style={btn(true)} onClick={() => setStep(2)}>Next</button></div>
          </div>
        )}
      </>)}

      {ctStep && (<>
        <P>{ctIndex === 0
          ? 'Plug the kettle into any outlet. The wizard finds which CT carries it.'
          : <>Now plug the kettle into an outlet on the <b>other leg</b> (another breaker; try another room if the same CT reacts). If only one CT is installed, skip.</>}</P>
        <P muted>Reference: the clamp meter around ONE wire of the kettle cord (a cord splitter helps) gives the best result.</P>
        <ReferenceInput value={ref} onChange={setRef} />
        <SequencePanel seq={seq} onStart={measureCt} disabled={!V_scale} />
        {pending && (
          <div className="hp-card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 'var(--sp-2)' }}>Kettle detected on CT {pending.ctKey} ({ENERGY.legs.find(l => l.field === `P_L${pending.ctKey}`)?.label})</div>
            <Checks checks={pending.checks} />
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <Kv k="Reference power" v={`${pending.cal.reference.P_ref_W.toFixed(1)} W at ${pending.voltsDuringTest.toFixed(1)} V`} />
              <Kv k="I_scale" v={pending.cal.I_scale.toFixed(3)} />
              <Kv k="Phase correction" v={`${pending.cal.phi_deg.toFixed(2)}°`} />
            </div>
            {pending.reversed && <P muted>This CT is mounted the other way round. No need to touch it: the phase correction (≈180°) fixes it on the Pi.</P>}
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
              <button style={btn(true, !pending.ok)} disabled={!pending.ok}
                onClick={() => { setCtResults(r => [...r, pending]); setPending(null); seq.reset(); setStep(step + 1) }}>Accept</button>
              {!pending.ok && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', alignSelf: 'center' }}>A check failed: measure again.</span>}
            </div>
          </div>
        )}
        {ctIndex === 1 && !running && <div style={{ marginTop: 'var(--sp-2)' }}><button style={btn(false)} onClick={() => { setPending(null); seq.reset(); setStep(4) }}>Skip: only one CT installed</button></div>}
      </>)}

      {step === 4 && (<>
        <P>Review. Saving writes the calibration file on the Pi; the Telegraf processor applies it within seconds, without restart. The previous version stays in the history.</P>
        <div className="hp-card" style={{ padding: 'var(--sp-3)' }}>
          <Kv k="V_scale" v={`${V_scale?.toFixed(3)} ${voltage ? `(new, ${voltage.method})` : '(unchanged)'}`} />
          {ctResults.map(c => <Kv key={c.ctKey} k={`CT ${c.ctKey}`} v={`I_scale ${c.cal.I_scale.toFixed(3)} · φ ${c.cal.phi_deg.toFixed(2)}°${c.reversed ? ' (reversed)' : ''}`} />)}
        </div>
        <input style={{ ...input, width: '100%', marginTop: 'var(--sp-3)', fontFamily: 'var(--font)' }} placeholder="Note (optional): kettle model, meters used…" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
        <div style={{ marginTop: 'var(--sp-3)' }}><button style={btn(true, busy || (!voltage && !ctResults.length))} disabled={busy || (!voltage && !ctResults.length)} onClick={save}>{busy ? 'Saving…' : 'Save calibration'}</button></div>
      </>)}

      {step === 5 && saved && (<>
        <P>Saved as version {saved.version}. Last step: check it end to end. Switch the kettle on and off once more on each calibrated CT; the wizard reads the <b>calibrated</b> power written by the Pi and compares it with your reference.</P>
        {ctResults.map(c => {
          const v = verify[c.ctKey]
          return (
            <div key={c.ctKey} className="hp-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>CT {c.ctKey}: kettle on that leg</div>
              <SequencePanel seq={seq} onStart={() => runVerify(c.ctKey, c.cal.reference.P_ref_W)} disabled={running} />
              {v?.error && <Err msg={v.error} />}
              {v && !v.error && (
                <Checks checks={[{ ok: Math.abs(v.errorPct) <= 3, label: `Measured step ${v.dP.toFixed(0)} W vs reference ${c.cal.reference.P_ref_W.toFixed(0)} W`, value: `${v.errorPct >= 0 ? '+' : ''}${v.errorPct.toFixed(1)}%` }]} />
              )}
            </div>
          )
        })}
        <button style={btn(true, running)} disabled={running} onClick={onClose}>Done</button>
      </>)}

      <Err msg={err} />
    </div>
  )
}
