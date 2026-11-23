import { useComfortScoreDaily } from '../hooks/useComfortScore.js'

// One bar per day: the only view that makes sense over 30 days (a raw smoothed
// curve at this scale would only show the day/night cycle repeated
// 30 times, without saying whether the overall trend is improving).
export function ComfortMonthChart({ days=30, height=180 }) {
  const { daily, loading } = useComfortScoreDaily(days)
  if (loading) return <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>Chargement…</div>
  const valid = daily.filter(d => d.score != null)
  if (!valid.length) return <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>Pas assez de données</div>

  const W = 600, PAD = { left:36, right:8, top:12, bottom:24 }
  const pw = W - PAD.left - PAD.right, ph = height - PAD.top - PAD.bottom
  const barW = pw / valid.length * 0.7
  const xOf = i => PAD.left + (i/(valid.length-1||1))*pw
  const yOf = pct => PAD.top + (1 - pct/100)*ph
  const colorFor = pct => pct >= 85 ? 'var(--ok)' : pct >= 60 ? 'var(--warn)' : 'var(--danger)'

  // 7-day moving average drawn as an overlaid line: separates the trend from the
  // day-to-day noise (weather, weekend vs weekday).
  const trend = valid.map((d,i) => {
    const window = valid.slice(Math.max(0,i-6), i+1)
    return window.reduce((s,w)=>s+w.score,0)/window.length
  })
  const trendPts = trend.map((v,i)=>`${xOf(i)},${yOf(v)}`).join(' ')

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        {[0,25,50,75,100].map(p=>(
          <g key={p}>
            <line x1={PAD.left} y1={yOf(p)} x2={PAD.left+pw} y2={yOf(p)} stroke="var(--border)" strokeWidth="0.5"/>
            <text x={PAD.left-6} y={yOf(p)+3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--mono)">{p}%</text>
          </g>
        ))}
        {valid.map((d,i)=>(
          <rect key={d.day} x={xOf(i)-barW/2} y={yOf(d.score)} width={barW} height={PAD.top+ph-yOf(d.score)}
            fill={colorFor(d.score)} opacity="0.75" rx="1"/>
        ))}
        <polyline points={trendPts} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.8" strokeLinecap="round"/>
        {valid.filter((_,i)=>i%Math.ceil(valid.length/6)===0).map((d,i)=>(
          <text key={d.day} x={xOf(valid.indexOf(d))} y={height-6} textAnchor="middle" fontSize="8" fill="var(--text3)" fontFamily="var(--mono)">
            {new Date(d.t).toLocaleDateString([],{day:'2-digit',month:'2-digit'})}
          </text>
        ))}
      </svg>
      <div style={{ fontSize:'var(--fs-2xs)', color:'var(--text3)', marginTop:4 }}>
        Barres = score journalier · ligne blanche = moyenne mobile 7 jours
      </div>
    </div>
  )
}