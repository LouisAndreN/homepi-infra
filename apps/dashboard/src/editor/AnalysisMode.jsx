import { useState, useRef, useMemo } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { comfortScorePct } from '../hooks/thresholds.js'

// Timeline bar with a sliding, resizable window: used to choose
// the exact period to analyse for the selected zone. Dragging the whole block
// = moving the period without changing its length. Dragging an edge = resizing.
function AnalysisTimeWindow({ totalRangeMs, windowStart, windowMs, onChange, loading }) {
  const trackRef = useRef(null)
  const dragRef = useRef(null) // { mode:'move'|'left'|'right', startX, startWindowStart, startWindowMs }

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
      onChange(Math.max(rangeStart,ns), startWindowStart+startWindowMs-Math.max(rangeStart,ns))
    } else if (mode === 'right') {
      const ne = Math.max(t, startWindowStart+60000)
      onChange(startWindowStart, Math.min(now,ne)-startWindowStart)
    }
  }

  function startDrag(mode, clientX) {
    dragRef.current = { mode, startWindowStart:windowStart, startWindowMs:windowMs, startT: tOfPct(((clientX-trackRef.current.getBoundingClientRect().left)/trackRef.current.getBoundingClientRect().width)*100) }
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
        {/* Resize handles */}
        <div onMouseDown={e=>{e.stopPropagation();startDrag('left',e.clientX)}} onTouchStart={e=>{e.stopPropagation();startDrag('left',e.touches[0].clientX)}}
          style={{position:'absolute',left:`calc(${left}% - 5px)`,width:10,top:0,bottom:0,cursor:'ew-resize',zIndex:2}}/>
        <div onMouseDown={e=>{e.stopPropagation();startDrag('right',e.clientX)}} onTouchStart={e=>{e.stopPropagation();startDrag('right',e.touches[0].clientX)}}
          style={{position:'absolute',left:`calc(${left+width}% - 5px)`,width:10,top:0,bottom:0,cursor:'ew-resize',zIndex:2}}/>
      </div>
    </div>
  )
}

// Analysis panel: receives a rectangle (in plan world coordinates) and the
// list of all sensors of the floor; filters by itself those whose position
// falls in the rectangle, then computes the composite comfort score over the
// chosen time window.
export function AnalysisPanel({ selectionRect, sensors, onClose }) {
  const [totalRangeMs] = useState(30*86400000) // 30 days of total navigable range; the window itself can be shorter
  const [windowStart, setWindowStart] = useState(Date.now()-86400000)
  const [windowMs, setWindowMs] = useState(86400000)

  const includedSensors = useMemo(() => {
    if (!selectionRect) return []
    const {x0,y0,x1,y1} = selectionRect
    return sensors.filter(s => s.x>=x0 && s.x<=x1 && s.y>=y0 && s.y<=y1)
  }, [selectionRect, sensors])

  const deviceIds = includedSensors.map(s=>s.deviceId).filter(Boolean)

  const startIso = `-${Math.ceil((Date.now()-windowStart)/60000)}m`
  const { data, loading } = useFlux(
    deviceIds.length ? FLUX.allMetricsHistory(startIso, '5m') : null,
    30000
  )

  const score = useMemo(() => {
    if (!data?.length) return null
    const filtered = data.filter(r => deviceIds.includes(r.device_id) && new Date(r._time).getTime() <= windowStart+windowMs)
    const byTs = {}
    for (const r of filtered) {
      if (!r._time || !r._field || r._value==='') continue
      if (!byTs[r._time]) byTs[r._time] = {}
      const v = parseFloat(r._value)
      if (!isNaN(v)) byTs[r._time][r._field] = v
    }
    const points = Object.values(byTs).map(valuesByMetric => ({ valuesByMetric }))
    return comfortScorePct(points)
  }, [data, deviceIds, windowStart, windowMs])

  if (!selectionRect) return null

  return (
    <div className="hp-card hp-card--elevated" style={{ width:340, padding:'var(--sp-4)' }}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-3)'}}>
        <span style={{fontSize:'var(--fs-md)',fontWeight:700}}>Analyse de zone</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:20}}>×</button>
      </div>

      <div style={{fontSize:11,color:'var(--text3)',marginBottom:'var(--sp-3)'}}>
        {includedSensors.length} capteur{includedSensors.length>1?'s':''} détecté{includedSensors.length>1?'s':''} dans la sélection
        {includedSensors.length>0 && <span style={{display:'block',marginTop:2,fontFamily:'var(--mono)'}}>{includedSensors.map(s=>s.deviceId).join(', ')}</span>}
      </div>

      {includedSensors.length === 0 ? (
        <div style={{fontSize:12,color:'var(--text3)',textAlign:'center',padding:'var(--sp-4) 0'}}>
          Aucun capteur dans cette zone — élargis la sélection.
        </div>
      ) : (
        <>
          <div style={{textAlign:'center',marginBottom:'var(--sp-3)'}}>
            {loading
              ? <div style={{fontSize:'var(--fs-xl)',color:'var(--text3)'}}>…</div>
              : <div style={{fontSize:'var(--fs-xl)',fontFamily:'var(--mono)',fontWeight:700,
                  color: score==null?'var(--text3)':score>=85?'var(--ok)':score>=60?'var(--warn)':'var(--danger)'}}>
                  {score!=null?`${score.toFixed(0)}%`:'—'}
                </div>}
            <div style={{fontSize:10,color:'var(--text3)'}}>confort sur la période sélectionnée</div>
          </div>
          <AnalysisTimeWindow totalRangeMs={totalRangeMs} windowStart={windowStart} windowMs={windowMs}
            onChange={(s,m)=>{setWindowStart(s);setWindowMs(m)}} loading={loading}/>
        </>
      )}
    </div>
  )
}