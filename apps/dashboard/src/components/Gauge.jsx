export function Gauge({ value, max = 100, min = 0, unit = '%', label, color, size = 110, thresholds, onClick }) {
  const isValid  = value !== null && value !== undefined && !isNaN(value)
  const clamped  = isValid ? Math.min(Math.max(value, min), max) : min
  const pct      = (max - min) === 0 ? 0 : (clamped - min) / (max - min)

  const r        = (size * 0.74) / 2
  const cx       = size / 2
  const cy       = size / 2
  const circ     = 2 * Math.PI * r
  const arcLen   = circ * 0.75
  const gap      = circ - arcLen
  const dashOff  = arcLen * (1 - pct)

  const resolveColor = () => {
    if (thresholds?.length) {
      let out = thresholds[0][1]
      for (const [thresh, c] of thresholds) {
        if (isValid && value >= thresh) out = c
      }
      return out
    }
    return color || (pct > 0.85 ? 'var(--danger)' : pct > 0.65 ? 'var(--warn)' : 'var(--accent-vivid)')
  }
  const c = resolveColor()

  const fmt = v => {
    if (!isValid) return '—'
    if (Math.abs(v) >= 1000) return v.toFixed(0)
    if (Math.abs(v) >= 100)  return v.toFixed(0)
    return v.toFixed(1)
  }

  return (
    <div
      onClick={onClick}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'var(--sp-1)',
        cursor: onClick ? 'pointer' : 'default' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="var(--border)" strokeWidth={size * 0.055}
          strokeDasharray={`${arcLen} ${gap}`}
          strokeLinecap="round"
          transform={`rotate(-225 ${cx} ${cy})`}/>
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={c} strokeWidth={size * 0.055}
          strokeDasharray={`${arcLen} ${gap}`}
          strokeDashoffset={dashOff}
          strokeLinecap="round"
          transform={`rotate(-225 ${cx} ${cy})`}
          style={{ transition:'stroke-dashoffset 0.65s var(--ease), stroke var(--dur-base)' }}/>
        <text x={cx} y={cy - 1} textAnchor="middle" dominantBaseline="middle"
          fontSize={size * 0.19} fontWeight="700" fill="var(--text)"
          fontFamily="var(--mono)">{fmt(value)}</text>
        <text x={cx} y={cy + size * 0.145} textAnchor="middle"
          fontSize={size * 0.1} fill="var(--text2)"
          fontFamily="var(--mono)">{unit}</text>
      </svg>
      {label && <span style={{ fontSize:'var(--fs-2xs)', color:'var(--text2)', letterSpacing:'.03em' }}>{label}</span>}
    </div>
  )
}