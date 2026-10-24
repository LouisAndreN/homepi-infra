import { useEffect, useState, useRef } from 'react'
import { usePromRange } from '../hooks/usePrometheus.js'
import { useFlux }      from '../hooks/useInflux.js'
import { Modal } from './Modal.jsx'

const TIME_WINDOWS = [
  { key:'h24', label:'24h',  ms:86400000,   step:'5m'  },
  { key:'d3',  label:'3d',   ms:259200000,  step:'15m' },
  { key:'w1',  label:'1w',   ms:604800000,  step:'1h'  },
  { key:'m1',  label:'1mo',  ms:2592000000, step:'6h'  },
  { key:'m3',  label:'3mo',  ms:7776000000, step:'12h' },
  { key:'y1',  label:'1y',   ms:31536000000,step:'1d'  },
]
const COLORS = ['var(--accent-vivid)','var(--ok)','var(--warn)','var(--danger)','var(--info)','#D85A30']

function LineChart({ series=[], height=260, unit='', yMin, yMax }) {
  const [show, setShow] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(()=>setShow(true)); return ()=>cancelAnimationFrame(id) }, [])

  if (!series.length || !series[0]?.points?.length) {
    return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)',fontSize:'var(--fs-sm)',flexDirection:'column',gap:'var(--sp-2)'}}>
      <span style={{fontSize:28,opacity:.2}}>◫</span>No data for this period
    </div>
  }

  const PAD={top:18,right:16,bottom:36,left:52}
  const W=600, H=height
  const allVals=series.flatMap(s=>s.points.map(p=>p.v)).filter(v=>!isNaN(v))
  const minV=yMin??Math.min(...allVals), maxV=yMax??Math.max(...allVals)
  const rangeV=maxV-minV||1
  const allTs=series.flatMap(s=>s.points.map(p=>p.t))
  const minT=Math.min(...allTs), maxT=Math.max(...allTs), rangeT=maxT-minT||1
  const pw=W-PAD.left-PAD.right, ph=H-PAD.top-PAD.bottom
  const px=t=>PAD.left+((t-minT)/rangeT)*pw
  const py=v=>PAD.top+(1-(v-minV)/rangeV)*ph
  const YTICKS=5
  const yVals=Array.from({length:YTICKS+1},(_,i)=>minV+i*(rangeV/YTICKS))
  const xTs=Array.from({length:5},(_,i)=>minT+(i/4)*rangeT)
  const fmtV=v=>{const a=Math.abs(v);if(a>=1e6)return(v/1e6).toFixed(1)+'M';if(a>=1e3)return(v/1e3).toFixed(1)+'k';if(a>=100)return v.toFixed(0);return v.toFixed(1)}
  const fmtT=ts=>{const d=new Date(ts);return rangeT>86400000*2?`${d.getMonth()+1}/${d.getDate()}`:`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`}
  const uid=useRef(`c${Math.random().toString(36).slice(2)}`)

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:'visible',display:'block'}}>
      <defs>
        {series.map((s,si)=>{const c=s.color||COLORS[si%COLORS.length];return(
          <linearGradient key={si} id={`${uid.current}-g${si}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity=".2"/>
            <stop offset="100%" stopColor={c} stopOpacity="0"/>
          </linearGradient>
        )})}
      </defs>
      {yVals.map((v,i)=><line key={i} x1={PAD.left} y1={py(v)} x2={PAD.left+pw} y2={py(v)} stroke="var(--border)" strokeWidth=".5"/>)}
      {yVals.map((v,i)=><text key={i} x={PAD.left-6} y={py(v)+3} textAnchor="end" fontSize="11" fill="var(--text3)" fontFamily="monospace">{fmtV(v)}</text>)}
      <text x={10} y={PAD.top+ph/2} textAnchor="middle" fontSize="10" fill="var(--text3)" transform={`rotate(-90,10,${PAD.top+ph/2})`}>{unit}</text>
      {xTs.map((t,i)=><text key={i} x={px(t)} y={PAD.top+ph+22} textAnchor="middle" fontSize="10" fill="var(--text3)" fontFamily="monospace">{fmtT(t)}</text>)}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top+ph} stroke="var(--border)" strokeWidth="1"/>
      <line x1={PAD.left} y1={PAD.top+ph} x2={PAD.left+pw} y2={PAD.top+ph} stroke="var(--border)" strokeWidth="1"/>
      <g style={{opacity:show?1:0,transition:'opacity 0.45s ease'}}>
        {series.map((s,si)=>{
          if(!s.points?.length)return null
          const c=s.color||COLORS[si%COLORS.length]
          const pts=s.points.map(p=>`${px(p.t)},${py(p.v)}`).join(' ')
          const area=`M${px(s.points[0].t)},${PAD.top+ph} ${s.points.map(p=>`L${px(p.t)},${py(p.v)}`).join(' ')} L${px(s.points.at(-1).t)},${PAD.top+ph} Z`
          return(<g key={si}><path d={area} fill={`url(#${uid.current}-g${si})`}/><polyline points={pts} fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></g>)
        })}
      </g>
    </svg>
  )
}

export function ChartModal({ open, onClose, title, unit='', promExpr, fluxExpr, yMin, yMax, initialWindow='h24' }) {
  const [visible,   setVisible]   = useState(false)
  const [windowKey, setWindowKey] = useState(initialWindow)
  const win = TIME_WINDOWS.find(w=>w.key===windowKey)||TIME_WINDOWS[0]

  useEffect(() => {
    if (open) requestAnimationFrame(()=>setVisible(true))
    else setVisible(false)
  }, [open])

  useEffect(() => { setWindowKey(initialWindow) }, [initialWindow])

  // ── Data fetch — re-runs when window changes ──────────────────────
  const promData = usePromRange(promExpr||null, win.ms, win.step, 999999999)
  const fluxData = useFlux(fluxExpr||null, 999999999)

  // Explicit refresh when window changes
  useEffect(() => {
    if (promExpr) promData.refresh?.()
    if (fluxExpr) fluxData.refresh?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, promExpr, fluxExpr])

  if (!open) return null

  const promSeries = (promData.data??[]).map((r,i)=>({
    label: Object.entries(r.metric||{}).filter(([k])=>k!=='__name__').map(([,v])=>v).join(' ')||`series ${i}`,
    color: COLORS[i%COLORS.length],
    points:(r.values??[]).map(v=>({t:v[0]*1000,v:parseFloat(v[1])})).filter(p=>!isNaN(p.v)),
  }))

  const byDev={}
  for(const row of fluxData.data??[]){
    const k=row.device_id||'sensor'
    if(!byDev[k])byDev[k]=[]
    if(row._time&&row._value)byDev[k].push({t:new Date(row._time).getTime(),v:parseFloat(row._value)})
  }
  const fluxSeries=Object.entries(byDev).map(([k,pts],i)=>({label:k,color:COLORS[i%COLORS.length],points:pts}))

  const series   = promExpr ? promSeries : fluxSeries
  const loading  = promExpr ? promData.loading : fluxData.loading
  const errMsg   = promExpr ? promData.error : fluxData.error
  const allVals  = series.flatMap(s=>s.points.map(p=>p.v))
  const stats    = allVals.length ? {min:Math.min(...allVals),max:Math.max(...allVals),avg:allVals.reduce((a,b)=>a+b,0)/allVals.length} : null

  const isDesktop = window.innerWidth >= 640
  const modalStyle = isDesktop ? {
    position:'fixed', top:'50%', left:'50%',
    transform:visible?'translate(-50%,-50%) scale(1)':'translate(-50%,-50%) scale(0.96)',
    opacity:visible?1:0, transition:'transform .22s cubic-bezier(.4,0,.2,1),opacity .22s',
    width:'min(720px,95vw)', maxHeight:'88vh', zIndex:201,
    background:'var(--bg-elev)', border:'0.5px solid var(--border-strong)', borderRadius:'var(--r-lg)',
    padding:'var(--sp-5)', overflow:'auto', boxShadow:'var(--shadow-3)',
  } : {
    position:'fixed', left:0, right:0, bottom:0,
    transform:visible?'translateY(0)':'translateY(100%)',
    transition:'transform .3s cubic-bezier(.4,0,.2,1)',
    maxHeight:'85vh', zIndex:201,
    background:'var(--bg-elev)', border:'0.5px solid var(--border-strong)',
    borderRadius:'var(--r-lg) var(--r-lg) 0 0', padding:'var(--sp-5) var(--sp-5) var(--sp-6)', overflow:'auto',
    boxShadow:'var(--shadow-3)',
  }

  return (
      <Modal onClose={onClose}>
        <div style={modalStyle}>
          {!isDesktop&&<div style={{width:36,height:3,borderRadius:2,background:'var(--border-strong)',margin:'0 auto var(--sp-4)'}}/>}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'var(--sp-4)'}}>
          <div>
            <div style={{fontSize:'var(--fs-md)',fontWeight:700}}>{title}</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginTop:2}}>
              {loading?'Loading…':errMsg?`Error: ${errMsg}`:`${series.reduce((s,sr)=>s+sr.points.length,0)} pts · ${win.label}`}
            </div>
          </div>
          <button onClick={onClose} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--text3)',fontSize:22,cursor:'pointer',lineHeight:1,padding:'2px 4px'}}>×</button>
        </div>

        {/* Time window */}
        <div style={{display:'flex',gap:'var(--sp-1)',marginBottom:'var(--sp-4)',flexWrap:'wrap'}}>
          {TIME_WINDOWS.map(w=>(
            <button key={w.key} onClick={()=>setWindowKey(w.key)} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',cursor:'pointer',border:windowKey===w.key?'none':'0.5px solid var(--border)',background:windowKey===w.key?'var(--accent-vivid)':'var(--bg2)',color:windowKey===w.key?'#fff':'var(--text2)',fontWeight:windowKey===w.key?700:500}}>{w.label}</button>
          ))}
        </div>

        {/* Legend */}
        {series.length>1&&(
          <div style={{display:'flex',gap:'var(--sp-3)',flexWrap:'wrap',marginBottom:'var(--sp-3)'}}>
            {series.map(s=>(
              <span key={s.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:'var(--fs-xs)',color:'var(--text2)'}}>
                <span style={{width:14,height:2,background:s.color,borderRadius:1,display:'inline-block'}}/>
                {s.label}
              </span>
            ))}
          </div>
        )}

        {/* Chart */}
        <div style={{minHeight:260}}>
          {loading
            ? <div style={{height:260,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text3)',fontSize:'var(--fs-sm)',gap:'var(--sp-3)'}}>
                <div style={{width:18,height:18,border:'2px solid var(--border)',borderTopColor:'var(--accent-vivid)',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
                Loading…
              </div>
            : <LineChart series={series} height={260} unit={unit} yMin={yMin} yMax={yMax}/>
          }
        </div>

        {/* Stats */}
        {stats&&(
          <div style={{display:'flex',gap:0,marginTop:'var(--sp-4)',paddingTop:'var(--sp-3)',borderTop:'0.5px solid var(--border)'}}>
            {[['Min',stats.min],['Max',stats.max],['Avg',stats.avg]].map(([l,v])=>(
              <div key={l} style={{flex:1,textAlign:'center'}}>
                <div className="hp-eyebrow">{l}</div>
                <div style={{fontSize:'var(--fs-md)',fontFamily:'var(--mono)',fontWeight:700,color:'var(--text)',marginTop:2}}>{v.toFixed(1)}{unit}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}