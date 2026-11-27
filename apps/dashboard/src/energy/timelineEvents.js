// Events and data gaps for the timeline and the charts. Pure functions, unit-tested with node.
//
// Events arrive on MQTT iot/<device_id>/event as JSON {kind, phase, ref, detail} and Telegraf stores
// them in measurement homepi_events (tag kind, string fields phase/ref/detail). phase is "start",
// "end" or "instant"; a start and its end share the same ref. Kinds in use:
//   teensy_update   NILM Teensy firmware being written (FlasherX through the bridge)
//   ota             ESP32 OTA of a device
//   capture         appliance capture session (Layer 1 dataset)
//   appliance       appliance running (NILM Layer 1 output, later)
//
// A data gap is a stretch of NILM readings longer than gapS without a point. It is NOT filled: the
// charts shade it. A gap overlapping a teensy_update is labelled as such; readings in the
// SUSPECT_AFTER_S after an update ends are flagged as possibly wrong.

export const KIND_LABEL = {
  teensy_update: 'Teensy update', ota: 'ESP32 OTA', capture: 'Capture session',
  appliance: 'Appliance', gap: 'NILM data gap',
}
export const SUSPECT_AFTER_S = 30

// rows: {_time, _field, _value, kind, device_id} from homepi_events (pivoted per point by field)
export function eventIntervals(rows, nowMs) {
  const pts = new Map()
  for (const r of rows) {
    const key = `${r._time}|${r.kind}|${r.device_id}`
    let e = pts.get(key)
    if (!e) { e = { t: Date.parse(r._time), kind: r.kind, device: r.device_id }; pts.set(key, e) }
    e[r._field] = r._value
  }
  const sorted = [...pts.values()].filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t)
  const open = new Map(), out = []
  for (const e of sorted) {
    const k = `${e.kind}|${e.device}|${e.ref || ''}`
    if (e.phase === 'start') open.set(k, e)
    else if (e.phase === 'end') {
      const s = open.get(k)
      out.push({ kind: e.kind, device: e.device, start: s ? s.t : e.t, end: e.t, detail: e.detail || s?.detail || '', ok: e.ok, openStart: !s })
      open.delete(k)
    } else out.push({ kind: e.kind, device: e.device, start: e.t, end: e.t, detail: e.detail || '', instant: true })
  }
  for (const s of open.values()) out.push({ kind: s.kind, device: s.device, start: s.t, end: nowMs, detail: s.detail || '', ongoing: true })
  return out.sort((a, b) => a.start - b.start)
}

// times: sorted ms timestamps of NILM points. Returns gaps [{start, end}] longer than gapS,
// including a leading/trailing gap against [fromMs, toMs].
export function findGaps(times, fromMs, toMs, gapS = 15) {
  const gaps = [], g = gapS * 1000
  let prev = fromMs
  for (const t of times) {
    if (t - prev > g) gaps.push({ start: prev, end: t })
    prev = t
  }
  if (toMs - prev > g) gaps.push({ start: prev, end: toMs, ongoing: true })
  return gaps
}

// Labels gaps caused by a Teensy update, and adds the "suspect" window after each update.
export function classifyGaps(gaps, events) {
  const updates = events.filter(e => e.kind === 'teensy_update')
  const overlaps = (a, b) => a.start <= b.end && b.start <= a.end
  const out = gaps.map(g => {
    const u = updates.find(e => overlaps(g, e))
    return { kind: 'gap', ...g, cause: u ? 'teensy_update' : null, detail: u ? `Teensy update ${u.detail}`.trim() : '' }
  })
  const suspect = updates.filter(u => !u.ongoing).map(u => ({ kind: 'suspect', start: u.end, end: u.end + SUSPECT_AFTER_S * 1000, detail: 'Readings right after a Teensy update may be wrong' }))
  return { gaps: out, suspect }
}
