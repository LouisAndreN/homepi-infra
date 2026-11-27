import { useState } from 'react'
import { API_BASE } from '../config.js'
import { ROUTINE_KINDS, DAY_LABELS } from '../energy/routines.js'

// Routines editor: declared recurring events (leave for work, come home, sleep...), with days and times.
// Saved through the admin API (/api/admin/routines); shown on the Timeline as declared context.
const input = { padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 'var(--fs-sm)' }
const btn = primary => ({ padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
  border: primary ? 'none' : '0.5px solid var(--border)', background: primary ? 'var(--accent-vivid)' : 'var(--bg2)', color: primary ? '#fff' : 'var(--text2)' })
const mkId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRESETS = [
  { label: 'Leave for work', kind: 'away', days: [0, 1, 2, 3, 4], start: '07:45', end: null },
  { label: 'At work', kind: 'away', days: [0, 1, 2, 3, 4], start: '08:30', end: '18:00' },
  { label: 'Come home', kind: 'home', days: [0, 1, 2, 3, 4], start: '18:45', end: null },
  { label: 'Sleep', kind: 'sleep', days: [0, 1, 2, 3, 4, 5, 6], start: '23:30', end: '07:00' },
]

export function RoutinesEditor({ routines, onSaved, onClose }) {
  const [list, setList] = useState(() => JSON.parse(JSON.stringify(routines || [])))
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const upd = (i, patch) => setList(l => l.map((r, j) => j === i ? { ...r, ...patch } : r))
  const add = p => setList(l => [...l, { id: mkId(), enabled: true, ...p }])

  async function save() {
    setErr(null)
    for (const r of list) {
      if (!r.label.trim()) return setErr('every routine needs a name')
      if (!r.days.length) return setErr(`"${r.label}": pick at least one day`)
      if (!r.start) return setErr(`"${r.label}": start time missing`)
    }
    setBusy(true)
    try {
      const body = { routines: list.map(r => ({ ...r, label: r.label.trim(), end: r.end || null })) }
      const res = await fetch(`${API_BASE}/api/admin/routines`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`)
      onSaved(await res.json()); onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="hp-card hp-card--elevated" style={{ boxShadow: 'var(--shadow-3)', padding: 'var(--sp-5)', width: 'min(640px,100%)', maxHeight: '88vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>Routines</div>
        <button onClick={onClose} aria-label="Close" className="hp-focus-visible" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 'var(--fs-md)' }}>✕</button>
      </div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', margin: '0 0 var(--sp-3)', lineHeight: 1.5 }}>
        Recurring events you declare. They appear on the Timeline and through every chart, marked as declared (not measured).
        Leave the end empty for a moment (leave, arrive); an end before the start crosses midnight.
      </p>

      {list.map((r, i) => (
        <div key={r.id} className="hp-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-2)', opacity: r.enabled === false ? 0.55 : 1 }}>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: 1, minWidth: 140 }} value={r.label} maxLength={60} placeholder="Name" onChange={e => upd(i, { label: e.target.value })} aria-label="Routine name" />
            <select style={input} value={r.kind} onChange={e => upd(i, { kind: e.target.value })} aria-label="Kind">
              {ROUTINE_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={r.enabled !== false} onChange={e => upd(i, { enabled: e.target.checked })} /> on
            </label>
            <button onClick={() => setList(l => l.filter((_, j) => j !== i))} aria-label="Delete" className="hp-focus-visible" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {DAY_LABELS.map((d, k) => {
              const on = r.days.includes(k)
              return <button key={d} onClick={() => upd(i, { days: on ? r.days.filter(x => x !== k) : [...r.days, k].sort() })} className="hp-focus-visible" aria-pressed={on}
                style={{ padding: '4px 8px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', cursor: 'pointer', border: '0.5px solid var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--bg2)', color: on ? 'var(--text)' : 'var(--text3)', fontWeight: on ? 700 : 400 }}>{d}</button>
            })}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text2)', flexWrap: 'wrap' }}>
            <span>from</span><input type="time" style={input} value={r.start} onChange={e => upd(i, { start: e.target.value })} aria-label="Start time" />
            <span>to</span><input type="time" style={input} value={r.end || ''} onChange={e => upd(i, { end: e.target.value || null })} aria-label="End time" />
            {r.end && <button onClick={() => upd(i, { end: null })} style={{ ...btn(false), padding: '2px 8px', fontSize: 'var(--fs-2xs)' }}>no end (moment)</button>}
            {r.end && r.end <= r.start && <span style={{ color: 'var(--text3)' }}>ends the next day</span>}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', margin: 'var(--sp-2) 0' }}>
        <button style={btn(false)} onClick={() => add({ label: '', kind: 'other', days: [0, 1, 2, 3, 4], start: '08:00', end: null })}>+ New routine</button>
        {PRESETS.filter(p => !list.some(r => r.label === p.label)).map(p => (
          <button key={p.label} style={{ ...btn(false), fontWeight: 400 }} onClick={() => add(p)}>+ {p.label}</button>
        ))}
      </div>
      {err && <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)', margin: 'var(--sp-2) 0' }}>⚠ {err}</div>}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <button style={btn(false)} onClick={onClose}>Cancel</button>
        <button style={btn(true)} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
