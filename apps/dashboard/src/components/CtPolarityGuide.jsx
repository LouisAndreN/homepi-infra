// CT polarity guide: animated distribution-board illustration.
// Japanese single-phase three-wire supply: L1 (R, red), N (white), L2 (T, black)
// come down from the meter to the main breaker. One CT per live leg, never on N.
// A CT reads positive power when its arrow / K->L marking points from the meter
// toward the breakers (the load). The reversed CT is shown being taken off,
// turned over and clamped back.
//
// Wire colours are the physical insulation colours, not data colours.

const WIRES = [
  { id: 'L1', x: 130, color: '#C8372D', label: 'L1 (R)' },
  { id: 'N', x: 180, color: '#E6E6E6', label: 'N' },
  { id: 'L2', x: 230, color: '#1E1E1E', label: 'L2 (T)' },
]
const CT_Y = 112

const CSS = `
.ctg-flow{stroke-dasharray:4 10;animation:ctg-flow 1.2s linear infinite}
@keyframes ctg-flow{to{stroke-dashoffset:-14}}
.ctg-bad{transform-box:fill-box;transform-origin:center;animation:ctg-flip 6s ease-in-out infinite}
@keyframes ctg-flip{
  0%,18%{transform:translate(0,0) rotate(0deg)}
  32%{transform:translate(44px,0) rotate(0deg)}
  52%{transform:translate(44px,0) rotate(180deg)}
  68%,100%{transform:translate(0,0) rotate(180deg)}
}
.ctg-arrow-bad{animation:ctg-color 6s step-end infinite}
@keyframes ctg-color{0%{fill:var(--danger)}68%{fill:var(--ok)}100%{fill:var(--danger)}}
.ctg-halo{transform-box:fill-box;transform-origin:center;animation:ctg-halo 6s ease-out infinite}
@keyframes ctg-halo{0%,18%{opacity:.9;transform:scale(1)}9%{opacity:.3;transform:scale(1.25)}20%,100%{opacity:0}}
@media (prefers-reduced-motion: reduce){
  .ctg-flow,.ctg-bad,.ctg-arrow-bad,.ctg-halo{animation:none}
}
`

// One CT clamp around a vertical cable, arrow pointing down (= toward the load)
// in its own frame. `reversed` draws it upside down and animates the fix.
function Ct({ x, label, state }) {
  const bad = state === 'reversed'
  const arrowFill = bad ? undefined : state === 'ok' ? 'var(--ok)' : 'var(--text3)'
  const body = (
    <g className={bad ? 'ctg-bad' : undefined}>
      <g transform={bad ? `rotate(180 ${x} ${CT_Y})` : undefined}>
        <rect x={x - 19} y={CT_Y - 13} width="38" height="26" rx="7" fill="var(--bg3)" stroke="var(--text2)" strokeWidth="1.5" />
        <rect x={x - 7} y={CT_Y - 13} width="14" height="26" fill="none" stroke="var(--border)" strokeWidth="1" />
        <path d={`M${x + 11},${CT_Y - 8} v11 h-4 l6,7 l6,-7 h-4 v-11 z`} className={bad ? 'ctg-arrow-bad' : undefined} fill={arrowFill} />
      </g>
    </g>
  )
  return (
    <g>
      {bad && <circle className="ctg-halo" cx={x} cy={CT_Y} r="26" fill="none" stroke="var(--danger)" strokeWidth="2" />}
      {body}
      {/* Label under the clamp, on a backing plate so it stays readable over the cable */}
      <rect x={x - 22} y={CT_Y + 18} width="44" height="14" rx="3" fill="var(--bg2)" />
      <text x={x} y={CT_Y + 28} textAnchor="middle" fontSize="10" fill={bad ? 'var(--danger)' : 'var(--text2)'} fontWeight="700">{label}</text>
    </g>
  )
}

export function CtPolarityDiagram({ legs, states }) {
  const byWire = Object.fromEntries(legs.map(l => [l.wire, l]))
  return (
    <svg viewBox="0 0 360 300" width="100%" style={{ display: 'block', maxWidth: 420, margin: '0 auto' }}
      role="img" aria-label={`Distribution board: ${legs.map(l => `CT ${l.label} ${states[l.field]?.state || 'unknown'}`).join(', ')}`}>
      <style>{CSS}</style>
      <text x="180" y="12" textAnchor="middle" fontSize="9" fill="var(--text3)">from the meter</text>
      {/* Board */}
      <rect x="40" y="40" width="280" height="250" rx="10" fill="var(--bg2)" stroke="var(--border)" strokeWidth="1.5" />
      <text x="52" y="58" fontSize="10" fill="var(--text3)">Board · 分電盤</text>
      {/* Cables down to the main breaker, with current flow toward the load */}
      {WIRES.map(w => (
        <g key={w.id}>
          <line x1={w.x} y1="18" x2={w.x} y2="176" stroke="var(--text3)" strokeWidth="7" strokeLinecap="round" />
          <line x1={w.x} y1="18" x2={w.x} y2="176" stroke={w.color} strokeWidth="5" strokeLinecap="round" />
          {w.id !== 'N' && <line x1={w.x} y1="22" x2={w.x} y2="172" stroke="var(--bg)" strokeWidth="1.5" className="ctg-flow" opacity="0.7" />}
          <text x={w.x} y="34" textAnchor="middle" fontSize="8" fill="var(--text2)">{w.label}</text>
        </g>
      ))}
      {/* Main breaker */}
      <rect x="104" y="176" width="152" height="34" rx="4" fill="var(--bg3)" stroke="var(--text3)" strokeWidth="1" />
      <text x="180" y="197" textAnchor="middle" fontSize="10" fill="var(--text2)">Main breaker · 主幹</text>
      {/* Branch breakers */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={74 + i * 36} y="232" width="28" height="38" rx="3" fill="var(--bg3)" stroke="var(--border)" strokeWidth="1" />
      ))}
      <text x="180" y="284" textAnchor="middle" fontSize="8" fill="var(--text3)">branch circuits (load)</text>
      {/* CTs */}
      {WIRES.filter(w => byWire[w.id]).map(w => (
        <Ct key={w.id} x={w.x} label={`CT ${byWire[w.id].label}`} state={states[byWire[w.id].field]?.state} />
      ))}
    </svg>
  )
}

export function CtPolarityGuide({ legs, states, onClose }) {
  const bad = legs.filter(l => states[l.field]?.state === 'reversed')
  return (
    <div className="hp-card hp-card--elevated" style={{ boxShadow: 'var(--shadow-3)', padding: 'var(--sp-5)', width: 'min(520px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>CT polarity</div>
        <button onClick={onClose} className="hp-focus-visible" aria-label="Close"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 'var(--fs-md)' }}>✕</button>
      </div>

      <CtPolarityDiagram legs={legs} states={states} />

      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)', marginTop: 'var(--sp-3)', lineHeight: 1.6 }}>
        {bad.length > 0
          ? <>CT {bad.map(l => l.label).join(' and ')} reads negative power ({bad.map(l => `${Math.round(states[l.field].meanW)} W`).join(', ')} over the last {states[bad[0].field].windowMin} min).
              A home without generation never exports, so the clamp is most likely mounted the wrong way round.</>
          : <>All CTs read positive power. Arrow (or K→L marking) toward the breakers is the correct orientation.</>}
      </div>

      {bad.length > 0 && (
        <ol style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)', lineHeight: 1.7, paddingLeft: 18, marginTop: 'var(--sp-3)' }}>
          <li><b>Preferred, no panel opening:</b> invert the polarity of {bad.map(l => l.label).join(', ')} server-side
            (<span style={{ fontFamily: 'var(--mono)' }}>/etc/homepi/nilm_calibration.json</span>, deployed by Ansible). New readings turn positive; history stays as recorded.</li>
          <li><b>Or physically:</b> open the clamp, turn it over and close it on the same cable, arrow pointing toward the breakers (animation).
            SCT-013 bodies are not always marked: note the orientation before removing it.</li>
        </ol>
      )}

      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warn)', marginTop: 'var(--sp-2)', lineHeight: 1.5 }}>
        ⚠ The cables above the main breaker stay live even with every breaker off. Opening the board is work for a qualified person.
      </div>
    </div>
  )
}
