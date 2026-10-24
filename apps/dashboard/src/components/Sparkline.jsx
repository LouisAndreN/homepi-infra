/**
 * Sparkline SVG — graphique de tendance léger
 * Aucune dépendance externe
 */
export function Sparkline({ data, color = '#378ADD', width = 200, height = 48, unit = '' }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height, background: 'var(--bg2)', borderRadius: 6 }}/>
  }

  const values = data.map(Number).filter(v => !isNaN(v))
  const min    = Math.min(...values)
  const max    = Math.max(...values)
  const range  = max - min || 1

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 8) - 4
    return `${x},${y}`
  }).join(' ')

  const last = values[values.length - 1]

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {/* Area fill */}
        <polygon
          points={`0,${height} ${pts} ${width},${height}`}
          fill={`url(#grad-${color.replace('#','')})`}
        />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        {/* Last value dot */}
        <circle
          cx={(values.length - 1) / (values.length - 1) * width}
          cy={height - ((last - min) / range) * (height - 8) - 4}
          r="3" fill={color}
        />
      </svg>
      <div style={{
        position: 'absolute', right: 0, top: 0,
        fontSize: 11, fontFamily: 'monospace', color,
      }}>
        {last.toFixed(1)}{unit}
      </div>
    </div>
  )
}