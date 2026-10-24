import { useEffect, useRef, useState } from 'react'

export function Sparkline({ values = [], color = 'var(--accent-vivid)', height = 40, unit = '', showLast = true, label }) {
  if (!values || values.length < 2) return <div style={{ height, background:'var(--bg2)', borderRadius:'var(--r-sm)', opacity:.4 }}/>
  const nums  = values.map(Number).filter(v => !isNaN(v))
  const min   = Math.min(...nums)
  const max   = Math.max(...nums)
  const range = max - min || 1
  const w     = 200
  const pts   = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * w
    const y = height - ((v - min) / range) * (height - 6) - 3
    return `${x},${y}`
  }).join(' ')
  const last = nums.at(-1)
  const gradId = `sg-${color.replace(/[^a-zA-Z0-9]/g,'')}`
  return (
    <div>
      {label && <div className="hp-eyebrow" style={{ marginBottom:'var(--sp-1)' }}>{label}</div>}
      <div style={{ position:'relative' }}>
        <svg width="100%" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity=".3"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${pts} ${w},${height}`} fill={`url(#${gradId})`}/>
          <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {showLast && <div style={{ position:'absolute', right:0, top:0, fontSize:'var(--fs-sm)', fontFamily:'var(--mono)', fontWeight:600, color }}>{last.toFixed(1)}{unit}</div>}
      </div>
    </div>
  )
}

export function MiniChart({ series = [], height = 80 }) {
  if (!series.length) return null
  const allVals = series.flatMap(s => s.values)
  const min = Math.min(...allVals), max = Math.max(...allVals)
  const range = max - min || 1
  const w = 300
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      {series.map((s, si) => {
        if (!s.values?.length) return null
        const pts = s.values.map((v, i) => {
          const x = (i / (s.values.length - 1)) * w
          const y = height - ((v - min) / range) * (height - 4) - 2
          return `${x},${y}`
        }).join(' ')
        return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
      })}
    </svg>
  )
}

export function StatCard({ label, value, unit = '', color = 'var(--text)', sub, icon, trend }) {
  const trendUp = trend > 0
  return (
    <div className="hp-card" style={{ padding:'var(--sp-3) var(--sp-4)' }}>
      <div className="hp-eyebrow" style={{ marginBottom:'var(--sp-2)' }}>{label}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:'var(--sp-1)' }}>
        {icon && <span style={{ fontSize:'var(--fs-base)' }}>{icon}</span>}
        <span className="hp-kpi-value" style={{ color }}>{value ?? '—'}</span>
        <span style={{ fontSize:'var(--fs-xs)', color:'var(--text2)' }}>{unit}</span>
        {trend !== undefined && <span style={{ fontSize:'var(--fs-xs)', color:trendUp?'var(--danger)':'var(--ok)', marginLeft:'var(--sp-1)', fontWeight:600 }}>{trendUp?'▲':'▼'} {Math.abs(trend).toFixed(1)}%</span>}
      </div>
      {sub && <div style={{ fontSize:'var(--fs-xs)', color:'var(--text3)', marginTop:'var(--sp-1)' }}>{sub}</div>}
    </div>
  )
}

// ─── Grafana-style metric bar with color thresholds ───────────────────────────
export function GrafanaBar({ value, min = 0, max = 100, thresholds = [], label, unit = '', onClick, sub }) {
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1) * 100

  // Determine fill color from thresholds (sorted ascending)
  const sorted = [...thresholds].sort((a, b) => a[0] - b[0])
  let fillColor = sorted[0]?.[1] || 'var(--ok)'
  for (const [thresh, color] of sorted) {
    if (value >= thresh) fillColor = color
  }

  return (
    <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', marginBottom: 'var(--sp-4)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'var(--sp-2)' }}>
        <span style={{ fontSize:'var(--fs-xs)', color:'var(--text2)', fontWeight:600 }}>{label}</span>
        <div style={{ display:'flex', alignItems:'baseline', gap:'var(--sp-1)' }}>
          <span style={{ fontSize:'var(--fs-md)', fontFamily:'var(--mono)', fontWeight:700, color: fillColor }}>{typeof value === 'number' ? value.toFixed(1) : value}</span>
          <span style={{ fontSize:'var(--fs-2xs)', color:'var(--text3)' }}>{unit}</span>
        </div>
      </div>

      {/* Bar track */}
      <div style={{ position:'relative', height:10, background:'var(--bg3)', borderRadius:'var(--r-sm)', overflow:'hidden' }}>
        {/* Threshold zone backgrounds */}
        {sorted.map(([thresh, color], i) => {
          const nextThresh = sorted[i+1]?.[0] ?? max
          const startPct = ((thresh - min) / (max - min)) * 100
          const widthPct = ((nextThresh - thresh) / (max - min)) * 100
          return (
            <div key={i} style={{ position:'absolute', top:0, bottom:0, left:`${startPct}%`, width:`${widthPct}%`, background:color, opacity:0.2 }}/>
          )
        })}
        {/* Value fill */}
        <div style={{ position:'absolute', top:0, left:0, bottom:0, width:`${pct}%`, background:fillColor, borderRadius:'var(--r-sm)', transition:'width .6s var(--ease), background var(--dur-base)' }}/>
        {/* Threshold markers */}
        {sorted.slice(1).map(([thresh]) => {
          const markerPct = ((thresh - min) / (max - min)) * 100
          return <div key={thresh} style={{ position:'absolute', top:0, bottom:0, left:`${markerPct}%`, width:1.5, background:'rgba(0,0,0,0.4)' }}/>
        })}
      </div>

      {/* Threshold labels */}
      <div style={{ position:'relative', height:13, marginTop:'var(--sp-1)' }}>
        {sorted.slice(1).map(([thresh, color]) => {
          const markerPct = ((thresh - min) / (max - min)) * 100
          return (
            <span key={thresh} style={{ position:'absolute', left:`${markerPct}%`, transform:'translateX(-50%)', fontSize:'var(--fs-2xs)', color, fontFamily:'var(--mono)', fontWeight:700 }}>
              {thresh}{unit}
            </span>
          )
        })}
      </div>

      {sub && <div style={{ fontSize:'var(--fs-xs)', color:'var(--text3)', marginTop:'var(--sp-1)' }}>{sub}</div>}
    </div>
  )
}

export function BarGauge({ value, max = 100, label, unit = '%', color }) {
  const pct = Math.min(Math.max(value / max, 0), 1)
  const c   = color || (pct > .85 ? 'var(--danger)' : pct > .65 ? 'var(--warn)' : 'var(--ok)')
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'var(--sp-2)', marginBottom:'var(--sp-1)' }}>
      <span style={{ fontSize:'var(--fs-2xs)', color:'var(--text3)', width:80, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ flex:1, height:5, background:'var(--border)', borderRadius:'var(--r-sm)' }}>
        <div style={{ width:`${pct*100}%`, height:'100%', background:c, borderRadius:'var(--r-sm)', transition:'width .5s var(--ease)' }}/>
      </div>
      <span style={{ fontSize:'var(--fs-2xs)', fontFamily:'var(--mono)', color:c, width:36, textAlign:'right', fontWeight:600 }}>{value.toFixed(0)}{unit}</span>
    </div>
  )
}