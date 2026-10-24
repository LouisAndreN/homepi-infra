import { useState, useMemo, useRef } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { COMFORT_METRICS, normalizeValue } from '../hooks/thresholds.js'

// Grille dédiée à l'analyse — pas besoin de la finesse de la heatmap visuelle
// (HM_STEP), juste une estimation statistique raisonnable sur une région.
const ANALYSIS_GRID_STEP = 20

// Nombre max de pas de temps sur lesquels on relance le calcul spatial complet
// (grille × métriques × occlusion par pixel) — au-delà, on sous-échantillonne
// uniformément plutôt que de calculer sur chaque point Influx. Le calcul
// spatial est le poste de coût dominant, pas la récupération des données —
// Influx garde sa résolution 15m, seul le nombre d'évaluations spatiales est
// plafonné. 24 pas sur une fenêtre de 24h = un point par heure en moyenne ;
// sur 30 jours ça reste 24 points répartis sur tout le mois — suffisant pour
// une moyenne représentative sans exploser le coût de calcul.
const MAX_ANALYSIS_SAMPLES = 24

function throttleSeries(series, maxSamples) {
  if (series.length <= maxSamples) return series
  const step = series.length / maxSamples
  const out = []
  for (let i = 0; i < maxSamples; i++) {
    out.push(series[Math.floor(i*step)])
  }
  return out
}

// Calcule le score composite moyen sur une (ou plusieurs) région(s) rectangulaire(s),
// en réutilisant EXACTEMENT le même modèle spatial que la heatmap visuelle
// (weightedSample par métrique + occlusion par les murs) — pas un filtrage de
// capteurs par position. Un pixel sans ligne de vue vers aucun capteur est
// naturellement exclu du calcul (weightedSample renvoie null), donc une
// sélection qui déborde dans une pièce sans donnée n'y ajoute pas de fausse
// estimation.
function computeZoneScore(rects, sensorsByMetric, walls, weightedSample) {
  let totalExcess = 0, validPixels = 0
  for (const rect of rects) {
    for (let x = rect.x0; x <= rect.x1; x += ANALYSIS_GRID_STEP) {
      for (let y = rect.y0; y <= rect.y1; y += ANALYSIS_GRID_STEP) {
        let pixelExcess = 0, pixelActive = 0
        for (const m of COMFORT_METRICS) {
          const sample = weightedSample(x, y, sensorsByMetric[m]||[], walls)
          if (!sample) continue
          const n = normalizeValue(m, sample.value)
          if (n == null) continue
          pixelActive++
          pixelExcess += Math.max(0, Math.abs(n)-1)
        }
        if (pixelActive === 0) continue // aucune métrique estimable ici — pixel exclu, pas compté comme "bon" par défaut
        totalExcess += pixelExcess / pixelActive
        validPixels++
      }
    }
  }
  if (validPixels === 0) return { score: null, coverage: 0 }
  const avgExcess = totalExcess / validPixels
  return {
    score: avgExcess < 0.05 ? 100 : Math.max(0, 100 - avgExcess*80),
    coverage: validPixels,
  }
}

// Barre temporelle avec fenêtre glissante et redimensionnable — sert à choisir
// la période exacte à analyser pour la zone sélectionnée. Glisser le bloc entier
// = déplacer la période sans changer sa durée. Glisser un bord = redimensionner.
function AnalysisTimeWindow({ totalRangeMs, windowStart, windowMs, onChange, loading }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null) // { mode:'move'|'left'|'right', startWindowStart, startWindowMs, startT }

  const now = Date.now()
  const rangeStart = now - totalRangeMs
  const pctOf = t => ((t - rangeStart) / totalRangeMs) * 100
  const tOfPct = pct => rangeStart + (pct/100) * totalRangeMs

  function handleMove(clientX) {
    if (!dragRef.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(100, ((clientX-rect.left)/rect.width)*100))
    const t = tOfPct(pct)
    const { mode, startWindowStart, startWindowMs, startT } = dragRef.current
    if (mode === 'move') {
      const delta = t - startT
      let ns = startWindowStart + delta
      ns = Math.max(rangeStart, Math.min(now-startWindowMs, ns))
      onChange(ns, startWindowMs)
    } else if (mode === 'left') {
      const ns = Math.min(t, startWindowStart+startWindowMs-60000)
      const clamped = Math.max(rangeStart,ns)
      onChange(clamped, startWindowStart+startWindowMs-clamped)
    } else if (mode === 'right') {
      const ne = Math.max(t, startWindowStart+60000)
      onChange(startWindowStart, Math.min(now,ne)-startWindowStart)
    }
  }

  function startDrag(mode, clientX) {
    const rect = trackRef.current.getBoundingClientRect()
    const pct = ((clientX-rect.left)/rect.width)*100
    dragRef.current = { mode, startWindowStart:windowStart, startWindowMs:windowMs, startT: tOfPct(pct) }
    const move = e => handleMove(e.touches?e.touches[0].clientX:e.clientX)
    const up = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, {passive:false})
    window.addEventListener('touchend', up)
  }

  const fmtT = t => new Date(t).toLocaleString([], totalRangeMs<=86400000
    ? {hour:'2-digit',minute:'2-digit'}
    : {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})

  const left = pctOf(windowStart), width = pctOf(windowStart+windowMs)-left

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text3)',marginBottom:4,fontFamily:'var(--mono)'}}>
        <span>{fmtT(windowStart)}</span>
        <span>{loading?'…':`${Math.round(windowMs/60000)} min`}</span>
        <span>{fmtT(windowStart+windowMs)}</span>
      </div>
      <div ref={trackRef} style={{position:'relative',height:36,background:'var(--bg3)',borderRadius:'var(--r-sm)',touchAction:'none'}}>
        <div
          onMouseDown={e=>{e.stopPropagation();startDrag('move',e.clientX)}}
          onTouchStart={e=>{e.stopPropagation();startDrag('move',e.touches[0].clientX)}}
          style={{position:'absolute',left:`${left}%`,width:`${width}%`,top:0,bottom:0,background:'var(--accent-soft)',border:'1px solid var(--accent-vivid)',borderRadius:'var(--r-sm)',cursor:'grab'}}/>
        <div onMouseDown={e=>{e.stopPropagation();startDrag('left',e.clientX)}} onTouchStart={e=>{e.stopPropagation();startDrag('left',e.touches[0].clientX)}}
          style={{position:'absolute',left:`calc(${left}% - 5px)`,width:10,top:0,bottom:0,cursor:'ew-resize',zIndex:2}}/>
        <div onMouseDown={e=>{e.stopPropagation();startDrag('right',e.clientX)}} onTouchStart={e=>{e.stopPropagation();startDrag('right',e.touches[0].clientX)}}
          style={{position:'absolute',left:`calc(${left+width}% - 5px)`,width:10,top:0,bottom:0,cursor:'ew-resize',zIndex:2}}/>
      </div>
    </div>
  )
}

// Panneau d'analyse — reçoit une liste de rectangles de sélection (en
// coordonnées monde du plan) et calcule le score de confort composite sur ces
// zones, en réutilisant le modèle spatial exact de la heatmap (weightedSample
// + occlusion par les murs), pas un simple filtrage de capteurs.
export function AnalysisPanel({ selectionRects, sensors, walls, weightedSample, onClose, onRemoveRect }) {
  const [totalRangeMs] = useState(30*86400000)
  const [windowStart, setWindowStart] = useState(Date.now()-86400000)
  const [windowMs, setWindowMs] = useState(86400000)

  const startIso = `-${Math.ceil((Date.now()-windowStart)/60000)}m`
  const { data, loading } = useFlux(
    selectionRects.length ? FLUX.allMetricsHistory(startIso, '15m') : null,
    30000
  )

  // Regroupe les lectures par timestamp puis par métrique, avec la position de
  // chaque device — nécessaire pour reconstruire sensorsByMetric à chaque
  // instant échantillonné dans la fenêtre temporelle choisie.
  const result = useMemo(() => {
    if (!data?.length || !selectionRects.length) return { series: [] }
    const byTs = {}
    for (const r of data) {
      if (!r._time || !r._field || r._value==='' || !r.device_id) continue
      const t = new Date(r._time).getTime()
      if (t < windowStart || t > windowStart+windowMs) continue
      if (!byTs[t]) byTs[t] = {}
      if (!byTs[t][r._field]) byTs[t][r._field] = {}
      const v = parseFloat(r._value)
      if (!isNaN(v)) byTs[t][r._field][r.device_id] = v
    }
    const series = Object.entries(byTs).map(([t, fields]) => {
      const sensorsByMetric = {}
      for (const m of COMFORT_METRICS) {
        sensorsByMetric[m] = sensors
          .filter(s => fields[m]?.[s.deviceId] != null)
          .map(s => ({ x:s.x, y:s.y, value:fields[m][s.deviceId], radius:s.radius||200 }))
      }
      return { t:Number(t), sensorsByMetric }
    }).sort((a,b)=>a.t-b.t)
    return { series }
  }, [data, sensors, windowStart, windowMs])

  const avgResult = useMemo(() => {
    if (!result.series.length) return { score:null, coverage:0 }
    const sampled = throttleSeries(result.series, MAX_ANALYSIS_SAMPLES)
    const scores = sampled.map(pt => computeZoneScore(selectionRects, pt.sensorsByMetric, walls, weightedSample))
      .filter(r => r.score != null)
    if (!scores.length) return { score:null, coverage:0 }
    return {
      score: scores.reduce((s,r)=>s+r.score,0)/scores.length,
      coverage: Math.round(scores.reduce((s,r)=>s+r.coverage,0)/scores.length),
    }
  }, [result.series, selectionRects, walls, weightedSample])

  return (
    <div className="hp-card hp-card--elevated" style={{ width:340, padding:'var(--sp-4)' }}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-3)'}}>
        <span style={{fontSize:'var(--fs-md)',fontWeight:700}}>Analyse de zone</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:20}}>×</button>
      </div>

      <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:'var(--sp-3)'}}>
        {selectionRects.map((r,i) => (
          <span key={r.id} style={{fontSize:10,padding:'2px 6px',borderRadius:'var(--r-sm)',background:'var(--bg3)',color:'var(--text2)',display:'flex',alignItems:'center',gap:4}}>
            Zone {i+1}
            <button onClick={()=>onRemoveRect(r.id)} style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:11,padding:0}}>✕</button>
          </span>
        ))}
      </div>

      {selectionRects.length === 0 ? (
        <div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'var(--sp-4) 0'}}>
          Dessine une zone sur le plan pour l'analyser.
        </div>
      ) : (
        <>
          <div style={{textAlign:'center',marginBottom:'var(--sp-3)'}}>
            {loading
              ? <div style={{fontSize:'var(--fs-xl)',color:'var(--text3)'}}>…</div>
              : <div style={{fontSize:'var(--fs-xl)',fontFamily:'var(--mono)',fontWeight:700,
                  color: avgResult.score==null?'var(--text3)':avgResult.score>=85?'var(--ok)':avgResult.score>=60?'var(--warn)':'var(--danger)'}}>
                  {avgResult.score!=null?`${avgResult.score.toFixed(0)}%`:'—'}
                </div>}
            <div style={{fontSize:10,color:'var(--text3)'}}>confort moyen sur la sélection · {avgResult.coverage} points de mesure/pas de temps</div>
            <div style={{fontSize:9,color:'var(--text3)',marginTop:2}}>
              calculé sur {Math.min(result.series.length, MAX_ANALYSIS_SAMPLES)} instants répartis sur la période
            </div>
          </div>
          <AnalysisTimeWindow totalRangeMs={totalRangeMs} windowStart={windowStart} windowMs={windowMs}
            onChange={(s,m)=>{setWindowStart(s);setWindowMs(m)}} loading={loading}/>
        </>
      )}
    </div>
  )
}