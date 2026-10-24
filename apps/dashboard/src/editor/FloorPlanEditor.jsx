import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useStore, useT }    from '../store/index.jsx'
import { setEditorMode }     from '../editorMode.js'
import { useFlux, FLUX }     from '../hooks/useInflux.js'
import {
  STATUS_RANGES, statusColorForValue, statusHexForValue,
  normalizeValue, METRIC_DOMAIN, METRIC_LABEL, METRIC_SERIES_COLOR, METRIC_UNIT,
  COMFORT_METRICS, STATUS_HEX_COMPOSITE, colorForExcess,
} from '../hooks/thresholds.js'
import { ComfortScoreCard } from '../components/ComfortScoreCard.jsx'
import { ComfortMonthChart } from '../components/ComfortMonthChart.jsx'
import { AnalysisPanel } from './AnalysisPanel.jsx'

// ─── Constants ────────────────────────────────────────────────────────────────
const CM_PER_PX=2
const pxToCm=px=>Math.round(Math.abs(px)*CM_PER_PX)
const cmToPx=cm=>cm/CM_PER_PX
const fmtDist=px=>{const cm=pxToCm(px);return cm>=100?`${(cm/100).toFixed(2)}m`:`${cm}cm`}
const mkId=()=>`e${Date.now()}${Math.random().toString(36).slice(2,5)}`

const EMPTY_FLOOR={id:mkId(),name:'Ground Floor',level:0,wallThickness:10,orientationDeg:0,walls:[],openings:[],stairs:[],appliances:[],furniture:[],sensors:[]}
const DEF_DB={buildings:[{id:mkId(),name:'My Home',apartments:[{id:mkId(),name:'Apartment',contractId:null,floors:[EMPTY_FLOOR]}]}]}

// ─── Widgets déplaçables (boussole, D-pad, légende, barre d'échelle, chronologie) ──
const WIDGET_POS_KEY='homepi_fp_widgetpos'
function loadWidgetPos(key,fallback){
  try{
    const all=JSON.parse(localStorage.getItem(WIDGET_POS_KEY)||'{}')
    if(all[key]&&typeof all[key].x==='number')return all[key]
  }catch{}
  return fallback
}
function persistWidgetPos(key,pos){
  try{
    const all=JSON.parse(localStorage.getItem(WIDGET_POS_KEY)||'{}')
    all[key]=pos
    localStorage.setItem(WIDGET_POS_KEY,JSON.stringify(all))
  }catch{}
}
function Movable({posKey,defaultPos,containerRef,approxW=80,approxH=40,children}){
  const[pos,setPos]=useState(()=>loadWidgetPos(posKey,defaultPos))
  const dragRef=useRef(null)
  const selfRef=useRef(null)
  const measuredRef=useRef({w:approxW,h:approxH})

  const clampToContainer=useCallback((x,y)=>{
    const rect=containerRef.current?.getBoundingClientRect()
    if(!rect)return{x,y}
    const{w,h}=measuredRef.current
    return{
      x:Math.min(Math.max(x,4),Math.max(4,rect.width-w-4)),
      y:Math.min(Math.max(y,4),Math.max(4,rect.height-h-4)),
    }
  },[containerRef])

  useEffect(()=>{
    if(!selfRef.current)return
    const ro=new ResizeObserver(entries=>{
      const e=entries[0];if(!e)return
      measuredRef.current={w:e.contentRect.width||approxW,h:e.contentRect.height||approxH}
    })
    ro.observe(selfRef.current)
    return()=>ro.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  useEffect(()=>{
    const fn=()=>setPos(p=>clampToContainer(p.x,p.y))
    window.addEventListener('resize',fn)
    return()=>window.removeEventListener('resize',fn)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  const move=useCallback(e=>{
    if(!dragRef.current)return
    if(e.touches)e.preventDefault()
    const pt=e.touches?e.touches[0]:e
    const dx=pt.clientX-dragRef.current.sx,dy=pt.clientY-dragRef.current.sy
    const next=clampToContainer(dragRef.current.ox+dx,dragRef.current.oy+dy)
    setPos(next)
  },[clampToContainer])
  const end=useCallback(()=>{
    if(!dragRef.current)return
    dragRef.current=null
    setPos(p=>{persistWidgetPos(posKey,p);return p})
    window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',end)
    window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[posKey,move])
  const start=e=>{
    if(e.target.closest?.('[data-widget-interactive]'))return
    e.stopPropagation()
    const pt=e.touches?e.touches[0]:e
    dragRef.current={sx:pt.clientX,sy:pt.clientY,ox:pos.x,oy:pos.y}
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',end)
    window.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end)
  }

  return(
    <div ref={selfRef} onMouseDown={start} onTouchStart={start}
      style={{position:'absolute',left:pos.x,top:pos.y,zIndex:55,cursor:'grab',touchAction:'none'}}>
      {children}
    </div>
  )
}

const WIDGET_COLLAPSE_KEY='homepi_fp_widgetcollapse'
function loadCollapsed(key,fallback=false){
  try{
    const all=JSON.parse(localStorage.getItem(WIDGET_COLLAPSE_KEY)||'{}')
    return typeof all[key]==='boolean'?all[key]:fallback
  }catch{return fallback}
}
function persistCollapsed(key,val){
  try{
    const all=JSON.parse(localStorage.getItem(WIDGET_COLLAPSE_KEY)||'{}')
    all[key]=val
    localStorage.setItem(WIDGET_COLLAPSE_KEY,JSON.stringify(all))
  }catch{}
}
function RetractableWidget({widgetKey,title,width=200,defaultCollapsed=false,onCloseAll,children}){
  const[collapsed,setCollapsed]=useState(()=>loadCollapsed(widgetKey,defaultCollapsed))
  const toggle=()=>setCollapsed(c=>{persistCollapsed(widgetKey,!c);return!c})
  return(
    <div className="hp-card hp-card--elevated" style={{width,boxShadow:'var(--shadow-3)',overflow:'hidden'}}>
      <div data-widget-interactive="1" onClick={toggle} className="hp-focus-visible" style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',
        padding:'var(--sp-2) var(--sp-3)',borderBottom:collapsed?'none':'0.5px solid var(--border)',
        background:'var(--bg3)',userSelect:'none',
      }}>
        <span className="hp-eyebrow">{title}</span>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:10,color:'var(--text3)',transform:collapsed?'rotate(-90deg)':'none',transition:'transform var(--dur-fast) var(--ease)'}}>▾</span>
          {onCloseAll&&<button onClick={e=>{e.stopPropagation();onCloseAll()}} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}>×</button>}
        </div>
      </div>
      {!collapsed&&<div style={{maxHeight:'60vh',overflow:'auto'}}>{children}</div>}
    </div>
  )
}

// ─── Sync ──────────────────────────────────────────────────────────────────────
const LOCAL_KEY='homepi_fpdb_v5'
const SYNC_URL='/api/admin/floorplans'

function useFloorPlanDB(){
  const[s,setS]=useState({db:DEF_DB,status:'loading'})
  const timer=useRef(null)
  const past=useRef([])
  const future=useRef([])
  const HISTORY_CAP=50
  useEffect(()=>{
    async function load(){
      try{const r=await fetch(SYNC_URL);if(r.ok){const d=await r.json();if(d?.buildings){setS({db:d,status:'synced'});localStorage.setItem(LOCAL_KEY,JSON.stringify(d));return}}}catch{}
      try{const l=localStorage.getItem(LOCAL_KEY);if(l){setS({db:JSON.parse(l),status:'offline'});return}}catch{}
      setS({db:DEF_DB,status:'offline'})
    }
    load()
  },[])
  const scheduleSync=next=>{
    localStorage.setItem(LOCAL_KEY,JSON.stringify(next))
    if(timer.current)clearTimeout(timer.current)
    timer.current=setTimeout(async()=>{
      try{const r=await fetch(SYNC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});setS(p=>({...p,status:r.ok?'synced':'offline'}))}
      catch{setS(p=>({...p,status:'offline'}))}
    },800)
  }
  const save=useCallback(fn=>{
    setS(prev=>{
      const next=typeof fn==='function'?fn(prev.db):fn
      past.current=[...past.current.slice(-(HISTORY_CAP-1)),prev.db]
      future.current=[]
      scheduleSync(next)
      return{db:next,status:'syncing'}
    })
  },[])
  const undo=useCallback(()=>{
    if(!past.current.length)return
    setS(prev=>{
      const prevDb=past.current.pop()
      future.current=[prev.db,...future.current].slice(0,HISTORY_CAP)
      scheduleSync(prevDb)
      return{db:prevDb,status:'syncing'}
    })
  },[])
  const redo=useCallback(()=>{
    if(!future.current.length)return
    setS(prev=>{
      const nextDb=future.current.shift()
      past.current=[...past.current,prev.db].slice(-HISTORY_CAP)
      scheduleSync(nextDb)
      return{db:nextDb,status:'syncing'}
    })
  },[])
  return{db:s.db,save,undo,redo,canUndo:()=>past.current.length>0,canRedo:()=>future.current.length>0,syncStatus:s.status}
}

// ─── Geometry ──────────────────────────────────────────────────────────────────
function d2(ax,ay,bx,by){return Math.sqrt((bx-ax)**2+(by-ay)**2)}
function snapG(v,g){return Math.round(v/g)*g}
function hitTestElement(floor,wx,wy){
  for(const s of floor.sensors||[]){
    if(d2(wx,wy,s.x,s.y)<=14)return s
  }
  for(const a of floor.appliances||[]){
    if(wx>=a.x&&wx<=a.x+a.w&&wy>=a.y&&wy<=a.y+a.h)return a
  }
  for(const f of floor.furniture||[]){
    if(wx>=f.x&&wx<=f.x+f.w&&wy>=f.y&&wy<=f.y+f.h)return f
  }
  return null
}
function nearestSensor(floor,wx,wy,maxDist=500){
  let best=null,bestDist=maxDist
  for(const s of floor.sensors||[]){
    const d=d2(wx,wy,s.x,s.y)
    if(d<bestDist){best=s;bestDist=d}
  }
  return best
}
function wallUV(w){const l=d2(w.x1,w.y1,w.x2,w.y2)||1;return{ux:(w.x2-w.x1)/l,uy:(w.y2-w.y1)/l,len:l}}
export function raySegIntersect(ox,oy,dx,dy,ax,ay,bx,by){
  const sdx=bx-ax,sdy=by-ay,cross=dx*sdy-dy*sdx
  if(Math.abs(cross)<1e-6){
    const wlen=Math.hypot(sdx,sdy)||1
    const nx=-sdy/wlen, ny=sdx/wlen
    const relOx=ox-ax, relOy=oy-ay
    const perpDist=Math.abs(relOx*nx+relOy*ny)
    if(perpDist>3)return null
    const tAlong=(relOx*sdx+relOy*sdy)/(wlen*wlen)
    if(tAlong<-0.05||tAlong>1.05)return null
    return 0.001
  }
  const t=((ax-ox)*sdy-(ay-oy)*sdx)/cross,u=((ax-ox)*dy-(ay-oy)*dx)/cross
  if(t>=0&&u>=0&&u<=1)return t
  return null
}
function snapObstacles(x,y,walls,elements,dist){
  let bx=x,by=y,bd=dist
  for(const w of walls){
    for(const pt of [{x:w.x1,y:w.y1},{x:w.x2,y:w.y2},{x:(w.x1+w.x2)/2,y:(w.y1+w.y2)/2}]){
      const d=d2(x,y,pt.x,pt.y);if(d<bd){bd=d;bx=pt.x;by=pt.y}
    }
    const dx=w.x2-w.x1,dy=w.y2-w.y1,l2=dx*dx+dy*dy
    if(l2){const t=Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/l2));const cx=w.x1+t*dx,cy=w.y1+t*dy,dd=d2(x,y,cx,cy);if(dd<bd){bd=dd;bx=cx;by=cy}}
  }
  for(const el of elements){
    const xs=[el.x,el.x+(el.w||0)],ys=[el.y,el.y+(el.h||0)]
    for(const ex of xs)if(Math.abs(x-ex)<bd)bx=ex
    for(const ey of ys)if(Math.abs(y-ey)<bd)by=ey
  }
  return{x:bx,y:by}
}
function axisDistances(el,walls){
  if(!el?.w||!el?.h)return[]
  const{x,y,w,h}=el,cx=x+w/2,cy=y+h/2,maxD=400
  return[{ox:x,oy:cy,dx:-1,dy:0},{ox:x+w,oy:cy,dx:1,dy:0},{ox:cx,oy:y,dx:0,dy:-1},{ox:cx,oy:y+h,dx:0,dy:1}].flatMap(ray=>{
    let minT=maxD
    for(const wall of walls){const t=raySegIntersect(ray.ox,ray.oy,ray.dx,ray.dy,wall.x1,wall.y1,wall.x2,wall.y2);if(t!==null&&t>4&&t<minT)minT=t}
    if(minT>=maxD-5)return[]
    return[{from:{x:ray.ox,y:ray.oy},to:{x:ray.ox+ray.dx*minT,y:ray.oy+ray.dy*minT},d:minT}]
  })
}

// ─── IAQ heatmap ──────────────────────────────────────────────────────────────
const HM_STEP=18

function hexRgb(h){return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}}
function lerpRgb(a,b,t){return{r:Math.round(a.r+(b.r-a.r)*t),g:Math.round(a.g+(b.g-a.g)*t),b:Math.round(a.b+(b.b-a.b)*t)}}

const METRIC_THRESHOLDS={
  co2:[800,1000],
  iaq:[50,100],
  temperature:[20,26,30],
  humidity:[30,60],
  lux:[15,30,130],
}
const TIMELINE_RANGES={
  h24:{label:'24h', start:'-24h', every:'5m',  totalMs:86400000},
  d7: {label:'7j',  start:'-7d',  every:'1h',  totalMs:604800000},
  d30:{label:'30j', start:'-30d', every:'6h',  totalMs:2592000000},
}

function metricLineColor(metric){
  return METRIC_SERIES_COLOR[metric] || 'var(--accent-vivid)'
}
function axisTicks(rangeKey){
  const totalMs=TIMELINE_RANGES[rangeKey]?.totalMs||86400000
  const N=4
  const now=Date.now()
  const fmtAt=t=>{
    const d=new Date(t)
    if(rangeKey==='h24')return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    if(rangeKey==='d7')return d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'2-digit'})
    return d.toLocaleDateString([],{day:'2-digit',month:'2-digit'})
  }
  return Array.from({length:N+1},(_,i)=>{
    const t=now-totalMs*(1-i/N)
    return{pct:i/N,label:fmtAt(t)}
  })
}

function sunTimesForWindow(rangeKey,lat,lon){
  if(lat==null||lon==null||isNaN(lat)||isNaN(lon))return[]
  const totalMs=TIMELINE_RANGES[rangeKey]?.totalMs||86400000
  const now=Date.now(),windowStart=now-totalMs
  const days=Math.ceil(totalMs/86400000)+1
  const marks=[]
  for(let i=0;i<=days;i++){
    const day=new Date(now-i*86400000)
    const{sunrise,sunset}=sunTimes(day,lat,lon)
    for(const t of[sunrise,sunset]){
      if(t&&t.getTime()>=windowStart&&t.getTime()<=now)marks.push(t.getTime())
    }
  }
  return marks
}
function AxisChart({values,label,metric,rangeKey='h24',height=76,lat,lon}){
  if(!values||values.length<2)return null
  const nums=values.map(Number).filter(v=>!isNaN(v))
  const[domMin,domMax]=METRIC_DOMAIN[metric]||[Math.min(...nums),Math.max(...nums)]
  const range=(domMax-domMin)||1
  const W=200,PAD={left:4,right:4,top:4,bottom:14}
  const pw=W-PAD.left-PAD.right,ph=height-PAD.top-PAD.bottom
  const color=metricLineColor(metric)
  const yOf=v=>PAD.top+(1-(Math.max(domMin,Math.min(domMax,v))-domMin)/range)*ph
  const pts=nums.map((v,i)=>`${PAD.left+(i/(nums.length-1))*pw},${yOf(v)}`).join(' ')
  const last=nums.at(-1)
  const ticks=axisTicks(rangeKey)
  const r=STATUS_RANGES[metric]
  const zones=[]
  if(r){
    const bounds=[domMin,r.lowRed,r.lowYellow,r.highYellow,r.highRed,domMax].filter(v=>v!=null&&v>=domMin&&v<=domMax)
    const uniq=[...new Set(bounds)].sort((a,b)=>a-b)
    for(let i=0;i<uniq.length-1;i++){
      const mid=(uniq[i]+uniq[i+1])/2
      zones.push({y0:yOf(uniq[i+1]),y1:yOf(uniq[i]),color:statusColorForValue(metric,mid)})
    }
  }
  const sunMarks=sunTimesForWindow(rangeKey,lat,lon)
  const totalMs=TIMELINE_RANGES[rangeKey]?.totalMs||86400000
  const windowStart=Date.now()-totalMs
  const xOfTime=t=>PAD.left+((t-windowStart)/totalMs)*pw
  return(
    <div style={{marginTop:'var(--sp-2)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:2}}>
        <span style={{fontSize:'var(--fs-2xs)',color:'#fff',fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em'}}>{label}</span>
        <span style={{fontSize:'var(--fs-xs)',color:statusColorForValue(metric,last),fontFamily:'var(--mono)',fontWeight:700}}>{last.toFixed(1)}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        {zones.map((z,i)=>(
          <rect key={i} x={PAD.left} y={z.y0} width={pw} height={Math.max(0,z.y1-z.y0)} fill={z.color} opacity="0.13"/>
        ))}
        {sunMarks.map((t,i)=>(
          <line key={i} x1={xOfTime(t)} y1={PAD.top} x2={xOfTime(t)} y2={PAD.top+ph} stroke="#F5A623" strokeWidth="0.6" strokeDasharray="2 2" opacity="0.55"/>
        ))}
        {ticks.map((t,i)=>(
          <text key={i} x={PAD.left+t.pct*pw} y={height-2} textAnchor={i===0?'start':i===ticks.length-1?'end':'middle'} fontSize="10" fill="var(--text3)" fontFamily="var(--mono)">{t.label}</text>
        ))}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx={PAD.left+pw} cy={yOf(last)} r="2" fill={color}/>
      </svg>
    </div>
  )
}

// Pondération spatiale partagée entre le rendu canvas, l'échantillonnage au
// curseur ET le panneau d'analyse de zone (AnalysisPanel).
export function weightedSample(wx,wy,sd,walls){
  let wS=0,vS=0
  let nearCount=0
  for(const s of sd) if(d2(wx,wy,s.x,s.y) < s.radius*2) nearCount++
  const power = nearCount>=3 ? 2.5 : nearCount===2 ? 2.0 : 1.5
  for(const s of sd){
    const dist=d2(wx,wy,s.x,s.y)
    let hasLOS=true
    for(const w of walls){
      const buffer=(w.thickness||10)/2+1
      const t=raySegIntersect(wx,wy,(s.x-wx)/(dist||1),(s.y-wy)/(dist||1),w.x1,w.y1,w.x2,w.y2)
      if(t!==null&&t<dist-buffer){hasLOS=false;break}
    }
    if (!hasLOS) continue
    const ww=1/(1+(dist/s.radius)**power)
    wS+=ww;vS+=ww*s.value
  }
  if(wS<1e-6)return null
  return{value:vS/wS,conf:Math.min(1,wS*2)}
}
const HM_MAX_SPAN=6000
function useHeatmap(sensors,deviceReadings,metric,walls,enabled,pan,zoom,containerRef,mode='single'){
  const[colorUrl,setColorUrl]=useState(null)
  const[confUrl,setConfUrl]=useState(null)
  const[bounds,setBounds]=useState({x0:-1000,y0:-1000,imgW:4000,imgH:3000})
  const sdRef=useRef([]),wallsRef=useRef([])
  const computedRectRef=useRef(null)
  const debounceRef=useRef(null)
  const modeRef=useRef(mode)
  useEffect(()=>{modeRef.current=mode},[mode])
  const sKey=useMemo(()=>JSON.stringify(sensors.map(s=>({...s,v:deviceReadings[s.deviceId]?.[metric]}))),[sensors,deviceReadings,metric])
  const wKey=useMemo(()=>JSON.stringify(walls.map(w=>({x1:w.x1,y1:w.y1,x2:w.x2,y2:w.y2}))),[walls])

  const renderTexture=useCallback((x0,y0,x1,y1)=>{
    const sd=sdRef.current,wallsArg=wallsRef.current
    const cw=Math.ceil((x1-x0)/HM_STEP),ch=Math.ceil((y1-y0)/HM_STEP)
    const cc=document.createElement('canvas');cc.width=cw;cc.height=ch
    const rc=document.createElement('canvas');rc.width=cw;rc.height=ch
    const cCtx=cc.getContext('2d'),rCtx=rc.getContext('2d')
    const cImg=cCtx.createImageData(cw,ch),rImg=rCtx.createImageData(cw,ch)
    for(let xi=0;xi<cw;xi++)for(let yi=0;yi<ch;yi++){
      const wx=x0+xi*HM_STEP,wy=y0+yi*HM_STEP
      const idx=(yi*cw+xi)*4
      if (modeRef.current === 'composite') {
        let totalExcess=0, activeCount=0, maxConf=0
        for (const m of COMFORT_METRICS) {
          const sample = weightedSample(wx,wy,sd[m]||[],wallsArg)
          if (!sample) continue
          const n = normalizeValue(m, sample.value)
          if (n == null) continue
          activeCount++
          totalExcess += Math.max(0, Math.abs(n)-1)
          maxConf = Math.max(maxConf, sample.conf)
        }
        if (activeCount===0) continue
        const excess = totalExcess/activeCount
        const col = hexRgb(colorForExcess(excess))
        const alpha=Math.round(Math.min(1,maxConf*2.2)*210)
        cImg.data[idx]=col.r;cImg.data[idx+1]=col.g;cImg.data[idx+2]=col.b;cImg.data[idx+3]=alpha
        const gray=Math.round(maxConf*220);rImg.data[idx]=gray;rImg.data[idx+1]=gray;rImg.data[idx+2]=gray;rImg.data[idx+3]=Math.round((1-maxConf)*155)
      } else {
        const sample=weightedSample(wx,wy,sd,wallsArg)
        if(!sample)continue
        const{value,conf}=sample
        const col=hexRgb(statusHexForValue(metric,value))
        const alpha=Math.round(Math.min(1,conf*2.2)*210)
        cImg.data[idx]=col.r;cImg.data[idx+1]=col.g;cImg.data[idx+2]=col.b;cImg.data[idx+3]=alpha
        const gray=Math.round(conf*220);rImg.data[idx]=gray;rImg.data[idx+1]=gray;rImg.data[idx+2]=gray;rImg.data[idx+3]=Math.round((1-conf)*155)
      }
    }
    cCtx.putImageData(cImg,0,0);rCtx.putImageData(rImg,0,0)
    setColorUrl(cc.toDataURL());setConfUrl(rc.toDataURL())
    setBounds({x0,y0,imgW:x1-x0,imgH:y1-y0})
    computedRectRef.current={x0,y0,x1,y1}
  },[metric,mode])

  const viewportRect=useCallback(()=>{
    const rect=containerRef.current?.getBoundingClientRect()
    if(!rect||!rect.width)return null
    const vw=Math.min(rect.width/zoom,HM_MAX_SPAN/3),vh=Math.min(rect.height/zoom,HM_MAX_SPAN/3)
    const cx=(-pan.x+rect.width/2)/zoom,cy=(-pan.y+rect.height/2)/zoom
    return{x0:cx-vw*1.5,y0:cy-vh*1.5,x1:cx+vw*1.5,y1:cy+vh*1.5}
  },[pan,zoom,containerRef])

  useEffect(()=>{
    if(!enabled){setColorUrl(null);setConfUrl(null);sdRef.current=[];computedRectRef.current=null;return}
    let sd
    if (mode==='composite') {
      sd = {}
      for (const m of COMFORT_METRICS) {
        sd[m] = sensors.map(s=>{const v=parseFloat(deviceReadings[s.deviceId]?.[m]);return isNaN(v)?null:{x:s.x,y:s.y,value:v,radius:s.radius||200}}).filter(Boolean)
      }
      sdRef.current=sd;wallsRef.current=walls
      const anyData = COMFORT_METRICS.some(m=>sd[m].length)
      if(!anyData){setColorUrl(null);setConfUrl(null);computedRectRef.current=null;return}
    } else {
      sd=sensors.map(s=>{const v=parseFloat(deviceReadings[s.deviceId]?.[metric]);return isNaN(v)?null:{x:s.x,y:s.y,value:v,radius:s.radius||200}}).filter(Boolean)
      sdRef.current=sd;wallsRef.current=walls
      if(!sd.length){setColorUrl(null);setConfUrl(null);computedRectRef.current=null;return}
    }
    const vp=viewportRect()
    if(vp){renderTexture(vp.x0,vp.y0,vp.x1,vp.y1);return}
    const pts=[...(mode==='composite'?[]:sd.map(s=>({x:s.x,y:s.y}))),...walls.flatMap(w=>[{x:w.x1,y:w.y1},{x:w.x2,y:w.y2}])]
    const PAD=1000
    const x0=pts.length?Math.min(...pts.map(p=>p.x))-PAD:-1000
    const y0=pts.length?Math.min(...pts.map(p=>p.y))-PAD:-1000
    const x1=pts.length?Math.max(...pts.map(p=>p.x))+PAD:3000
    const y1=pts.length?Math.max(...pts.map(p=>p.y))+PAD:2000
    renderTexture(x0,y0,x1,y1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sKey,wKey,enabled,mode])

  useEffect(()=>{
    if(!enabled||!sdRef.current)return
    clearTimeout(debounceRef.current)
    debounceRef.current=setTimeout(()=>{
      const cr=computedRectRef.current
      const rect=containerRef.current?.getBoundingClientRect()
      if(!cr||!rect||!rect.width)return
      const vw=rect.width/zoom,vh=rect.height/zoom
      const vx0=-pan.x/zoom,vy0=-pan.y/zoom,vx1=vx0+vw,vy1=vy0+vh
      const margin=Math.min(vw,vh)*0.15
      if(vx0<cr.x0+margin||vy0<cr.y0+margin||vx1>cr.x1-margin||vy1>cr.y1-margin){
        const vp=viewportRect()
        if(vp)renderTexture(vp.x0,vp.y0,vp.x1,vp.y1)
      }
    },150)
    return()=>clearTimeout(debounceRef.current)
  },[pan,zoom,enabled,viewportRect,renderTexture])

  const sampleAt=useCallback((wx,wy)=>{
    if (modeRef.current==='composite') {
      let totalExcess=0,activeCount=0
      for (const m of COMFORT_METRICS) {
        const s = weightedSample(wx,wy,sdRef.current[m]||[],wallsRef.current)
        if(!s)continue
        const n=normalizeValue(m,s.value); if(n==null)continue
        activeCount++; totalExcess+=Math.max(0,Math.abs(n)-1)
      }
      if(activeCount===0)return null
      return { value: totalExcess/activeCount, conf: 1, isComposite:true }
    }
    return weightedSample(wx,wy,sdRef.current,wallsRef.current)
  },[])
  return{colorUrl,confUrl,x0:bounds.x0,y0:bounds.y0,imgW:bounds.imgW,imgH:bounds.imgH,sampleAt}
}

// ─── Wall layer ────────────────────────────────────────────────────────────────
function WallLayer({walls,openings,selectedIds,tool,onWallClick,onOpeningClick,onOpeningSelect}){
  return(
    <g>
      {walls.map(wall=>{
        const ops=(openings||[]).filter(o=>o.wallId===wall.id).sort((a,b)=>a.t-b.t)
        const{ux,uy,len}=wallUV(wall),thick=wall.thickness||10,isSel=selectedIds.has(wall.id)
        let segs=[],last=0
        for(const op of ops){
          const half=(op.width/2)/(len||1),s=Math.max(0,op.t-half),e=Math.min(1,op.t+half)
          if(s>last+0.001)segs.push({type:'wall',from:last,to:s})
          segs.push({type:op.type,from:s,to:e,op})
          last=e
        }
        if(last<0.999)segs.push({type:'wall',from:last,to:1})
        const pt=t=>({x:wall.x1+ux*t*len,y:wall.y1+uy*t*len})
        return(
          <g key={wall.id}>
            {segs.map((seg,si)=>{
              const a=pt(seg.from),b=pt(seg.to)
              if(seg.type==='wall')return(
                <g key={si} onClick={e=>{e.stopPropagation();onWallClick(wall,e)}} style={{cursor:'pointer'}}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isSel?'var(--accent)':'var(--text)'} strokeWidth={thick} strokeLinecap="square"/>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={Math.max(thick,22)}/>
                </g>
              )
              if(seg.type.startsWith('door'))return<DoorSym key={si} x1={a.x} y1={a.y} x2={b.x} y2={b.y} wall={wall} op={seg.op} isSel={selectedIds.has(seg.op.id)} tool={tool} onSelect={onOpeningSelect} onErase={onOpeningClick}/>
              return<WinSym key={si} x1={a.x} y1={a.y} x2={b.x} y2={b.y} wall={wall} op={seg.op} isSel={selectedIds.has(seg.op.id)} tool={tool} onSelect={onOpeningSelect} onErase={onOpeningClick}/>
            })}
            {isSel&&<text x={(wall.x1+wall.x2)/2} y={(wall.y1+wall.y2)/2-16} textAnchor="middle" fontSize="11" fill="var(--accent)" fontFamily="monospace" style={{pointerEvents:'none'}}>{fmtDist(len)} · {pxToCm(thick)}cm</text>}
          </g>
        )
      })}
    </g>
  )
}
function DoorSym({x1,y1,x2,y2,wall,op,isSel,tool,onSelect,onErase}){
  const w=d2(x1,y1,x2,y2);if(w<1)return null
  const{ux,uy}=wallUV(wall),nx=-uy,ny=ux,s=op.opensLeft?-1:1
  const ex=x1+nx*s*w,ey=y1+ny*s*w,cx=(x1+x2)/2,cy=(y1+y2)/2
  return(<g onClick={e=>{e.stopPropagation();tool==='erase'?onErase(op.id):onSelect(op,e)}} style={{cursor:'pointer'}}>
    {op.type==='door-sliding'
      ?<><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text2)" strokeWidth="2.5"/><line x1={x1+nx*5} y1={y1+ny*5} x2={x2+nx*5} y2={y2+ny*5} stroke="var(--text3)" strokeWidth="1" strokeDasharray="4 3"/></>
      :<><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text3)" strokeWidth="1" strokeDasharray="3 2"/><line x1={x1} y1={y1} x2={ex} y2={ey} stroke="var(--text2)" strokeWidth="2"/><path d={`M${x1},${y1} A${w},${w} 0 0,${op.opensLeft?0:1} ${ex},${ey}`} fill="none" stroke="var(--text3)" strokeWidth="1" strokeDasharray="3 2"/></>}
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="22"/>
    {isSel&&<circle cx={cx} cy={cy} r="6" fill="var(--accent)" opacity="0.9" style={{pointerEvents:'none'}}/>}
  </g>)
}
function WinSym({x1,y1,x2,y2,wall,op,isSel,tool,onSelect,onErase}){
  const{ux,uy}=wallUV(wall),nx=-uy,ny=ux,d=5,cx=(x1+x2)/2,cy=(y1+y2)/2
  return(<g onClick={e=>{e.stopPropagation();tool==='erase'?onErase(op.id):onSelect(op,e)}} style={{cursor:'pointer'}}>
    <line x1={x1+nx*d} y1={y1+ny*d} x2={x2+nx*d} y2={y2+ny*d} stroke="#87CEEB" strokeWidth="2.5"/>
    <line x1={x1-nx*d} y1={y1-ny*d} x2={x2-nx*d} y2={y2-ny*d} stroke="#87CEEB" strokeWidth="2.5"/>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#87CEEB" strokeWidth="1" strokeDasharray="3 2"/>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="22"/>
    {isSel&&<circle cx={cx} cy={cy} r="6" fill="var(--accent)" opacity="0.9" style={{pointerEvents:'none'}}/>}
  </g>)
}

// ─── Wall endpoint drag handles ───────────────────────────────────────────────
function WallHandles({wall,onEndpointDown}){
  return(
    <g>
      {[[wall.x1,wall.y1,'start'],[wall.x2,wall.y2,'end']].map(([x,y,ep])=>(
        <rect key={ep} x={x-6} y={y-6} width={12} height={12} fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" rx="2"
          style={{cursor:'move'}}
          onMouseDown={e=>{e.stopPropagation();onEndpointDown(e,wall,ep)}}
          onTouchStart={e=>{e.stopPropagation();onEndpointDown({clientX:e.touches[0].clientX,clientY:e.touches[0].clientY},wall,ep)}}/>
      ))}
    </g>
  )
}

// ─── Opening (door/window) resize handles ─────────────────────────────────────
function OpeningHandles({op,wall,onHandleDown}){
  if(!wall)return null
  const{ux,uy,len}=wallUV(wall)
  const half=(op.width/2)/(len||1)
  const s=Math.max(0,op.t-half),e=Math.min(1,op.t+half)
  const mx=wall.x1+ux*op.t*len,my=wall.y1+uy*op.t*len
  const x1=wall.x1+ux*s*len,y1=wall.y1+uy*s*len
  const x2=wall.x1+ux*e*len,y2=wall.y1+uy*e*len
  const HS=6
  return(
    <g>
      <circle cx={mx} cy={my} r="7" fill="var(--accent)" opacity="0.9" style={{cursor:'move'}}
        onMouseDown={e=>{e.stopPropagation();onHandleDown(e,op,'move')}}
        onTouchStart={e=>{e.stopPropagation();onHandleDown({clientX:e.touches[0].clientX,clientY:e.touches[0].clientY},op,'move')}}/>
      {[[x1,y1,'start'],[x2,y2,'end']].map(([x,y,ep])=>(
        <rect key={ep} x={x-HS} y={y-HS} width={HS*2} height={HS*2} fill="#EF9F27" stroke="var(--accent)" strokeWidth="1.5" rx="2"
          style={{cursor:'ew-resize'}}
          onMouseDown={e=>{e.stopPropagation();onHandleDown(e,op,ep)}}
          onTouchStart={e=>{e.stopPropagation();onHandleDown({clientX:e.touches[0].clientX,clientY:e.touches[0].clientY},op,ep)}}/>
      ))}
    </g>
  )
}

// ─── Rect resize handles ───────────────────────────────────────────────────────
function ResizeHandles({el,onHandleDown}){
  if(!el?.w||!el?.h)return null
  const cx=el.x+el.w/2,cy=el.y+el.h/2
  const hs=[
    {id:'nw',hx:el.x,      hy:el.y,      c:'nw-resize'},{id:'n', hx:cx,        hy:el.y,      c:'n-resize'},
    {id:'ne',hx:el.x+el.w, hy:el.y,      c:'ne-resize'},{id:'e', hx:el.x+el.w, hy:cy,         c:'e-resize'},
    {id:'se',hx:el.x+el.w, hy:el.y+el.h, c:'se-resize'},{id:'s', hx:cx,        hy:el.y+el.h,  c:'s-resize'},
    {id:'sw',hx:el.x,      hy:el.y+el.h, c:'sw-resize'},{id:'w', hx:el.x,      hy:cy,          c:'w-resize'},
  ]
  return(
    <g transform={`rotate(${el.rotation||0},${cx},${cy})`}>
      <rect x={el.x-3} y={el.y-3} width={el.w+6} height={el.h+6} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 2" style={{pointerEvents:'none'}}/>
      {hs.map(h=>(
        <rect key={h.id} x={h.hx-5} y={h.hy-5} width={10} height={10} fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" rx="1"
          style={{cursor:h.c}}
          onMouseDown={e=>{e.stopPropagation();onHandleDown(e,h.id,el)}}
          onTouchStart={e=>{e.stopPropagation();onHandleDown({clientX:e.touches[0].clientX,clientY:e.touches[0].clientY,altKey:false},h.id,el)}}/>
      ))}
    </g>
  )
}

// ─── Element components ────────────────────────────────────────────────────────
function ApplianceEl({a,isSelected,tool,onSelect,onStartDrag,onErase}){
  const cx=a.x+a.w/2,cy=a.y+a.h/2,color=a.color||'#378ADD'
  const handle=e=>{e.stopPropagation();if(tool==='erase')onErase(a.id);else onSelect(a,e)}
  return(
    <g transform={`rotate(${a.rotation||0},${cx},${cy})`}
       onClick={handle}
       onMouseDown={e=>{e.stopPropagation();if(tool==='select')onStartDrag(e,a,false)}}
       style={{cursor:tool==='erase'?'pointer':'grab'}}>
      <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={color} fillOpacity={0.18} stroke={isSelected?'var(--accent)':color} strokeWidth={isSelected?2:1} rx="2"/>
      <line x1={a.x} y1={a.y} x2={a.x+a.w} y2={a.y+a.h} stroke={color} strokeWidth="0.7" opacity="0.45"/>
      <line x1={a.x+a.w} y1={a.y} x2={a.x} y2={a.y+a.h} stroke={color} strokeWidth="0.7" opacity="0.45"/>
    </g>
  )
}
function FurnitureEl({f,isSelected,tool,onSelect,onStartDrag,onErase}){
  const cx=f.x+f.w/2,cy=f.y+f.h/2,color=f.color||'#7F77DD'
  const handle=e=>{e.stopPropagation();if(tool==='erase')onErase(f.id);else onSelect(f,e)}
  return(
    <g transform={`rotate(${f.rotation||0},${cx},${cy})`}
       onClick={handle}
       onMouseDown={e=>{e.stopPropagation();if(tool==='select')onStartDrag(e,f,false)}}
       style={{cursor:tool==='erase'?'pointer':'grab',opacity:f.opacity||0.7}}>
      <rect x={f.x} y={f.y} width={f.w} height={f.h} fill={color} fillOpacity={0.15} stroke={isSelected?'var(--accent)':color} strokeWidth={isSelected?2:0.8} rx="2"/>
      <line x1={f.x} y1={f.y} x2={f.x+f.w} y2={f.y+f.h} stroke={color} strokeWidth="0.5" opacity="0.4"/>
      <line x1={f.x+f.w} y1={f.y} x2={f.x} y2={f.y+f.h} stroke={color} strokeWidth="0.5" opacity="0.4"/>
    </g>
  )
}
function SensorEl({s,isSelected,walls,tool,onSelect,onStartDrag,onErase}){
  const color='#1D9E75' // vert fixe — cohérent avec appliances (bleu) et furniture (violet), une couleur par catégorie d'élément
  const handle=e=>{e.stopPropagation();if(tool==='erase')onErase(s.id);else onSelect(s,e)}
  return(
    <g onClick={handle}
      onMouseDown={e=>{e.stopPropagation();if(tool==='select')onStartDrag(e,s,true)}} style={{cursor:'pointer'}}>
      <circle cx={s.x} cy={s.y} r={isSelected?9:6} fill={color} fillOpacity={0.85} stroke={isSelected?'var(--accent-vivid)':'none'} strokeWidth={isSelected?2:0}/>
    </g>
  )
}
function StairsEl({s,isSelected,tool,onSelect,onErase}){
  const n=s.stepCount||8,sh=s.h/n
  const handle=e=>{e.stopPropagation();if(tool==='erase')onErase(s.id);else onSelect(s,e)}
  return(
    <g onClick={handle} style={{cursor:'pointer'}}>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="rgba(186,117,23,.08)" stroke={isSelected?'var(--accent)':'#BA7517'} strokeWidth={isSelected?2:0.8}/>
      {Array.from({length:n},(_,i)=><line key={i} x1={s.x} y1={s.y+i*sh} x2={s.x+s.w} y2={s.y+i*sh} stroke="#BA7517" strokeWidth="0.5" opacity="0.6"/>)}
      <text x={s.x+s.w/2} y={s.y+s.h/2} textAnchor="middle" dominantBaseline="middle" fontSize="20" fill="#BA7517" opacity="0.5" style={{pointerEvents:'none',userSelect:'none'}}>{s.direction==='up'?'↑':'↓'}</text>
    </g>
  )
}

// ─── Graphique combiné normalisé avec axes réels par métrique ─────────────────
function NormalizedMultiChart({ deviceId, availableMetrics, rangeKey='h24', height=260, cursorTs=null, onScrub=null }) {
  const cfg = TIMELINE_RANGES[rangeKey]
  const hist = useFlux(deviceId ? FLUX.metricsHistoryForDevice(deviceId, cfg.start, cfg.every) : null, 60000)
  const svgRef = useRef(null)
  const scrubDataRef = useRef({tMin:0,tMax:0,W:0})
  const handleScrubRef = useRef(null)
  const pickTargetRef = useRef(null)

  const [cursorA, setCursorA] = useState(null)
  const [cursorB, setCursorB] = useState(null)
  const dragTargetRef = useRef(null)

  useEffect(() => {
    const moveCmp  = e => { if (dragTargetRef.current) handleScrubRef.current?.(e.clientX, dragTargetRef.current) }
    const upCmp    = () => { dragTargetRef.current = null }
    window.addEventListener('mousemove', moveCmp)
    window.addEventListener('mouseup', upCmp)
    const touchMove = e => {
      if (dragTargetRef.current) { e.preventDefault(); const t=e.touches[0]; if(t) handleScrubRef.current?.(t.clientX, dragTargetRef.current) }
    }
    const touchEnd = () => { dragTargetRef.current=null }
    window.addEventListener('touchmove', touchMove, { passive:false })
    window.addEventListener('touchend', touchEnd)
    window.addEventListener('touchcancel', touchEnd)
    return () => {
      window.removeEventListener('mousemove', moveCmp)
      window.removeEventListener('mouseup', upCmp)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', touchEnd)
    }
  }, [])

  const byMetric = {}
  for (const row of hist.data ?? []) {
    if (!availableMetrics.includes(row._field)) continue
    if (!byMetric[row._field]) byMetric[row._field] = []
    const v = parseFloat(row._value)
    if (isNaN(v)) continue
    byMetric[row._field].push({ t: new Date(row._time).getTime(), v })
  }
  for (const m in byMetric) byMetric[m].sort((a,b)=>a.t-b.t)
  const metrics = availableMetrics.filter(m => byMetric[m]?.length > 1)

  if (hist.loading) return <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>Chargement…</div>
  if (!metrics.length) return <div style={{ height, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12 }}>Pas assez de données</div>

  const AXIS_W = 62
  const W = 340 + metrics.length*AXIS_W
  const PAD = { left:8, right:8, top:22, bottom:40 }
  const plotW = 340 - PAD.left - PAD.right
  const ph = height - PAD.top - PAD.bottom
  const yOf = n => PAD.top + (1 - (Math.max(-1.5,Math.min(1.5,n))+1.5)/3) * ph

  const tMax = Date.now()
  const tMin = tMax - cfg.totalMs
  const xOf = t => PAD.left + ((t - tMin)/(tMax - tMin || 1)) * plotW
  scrubDataRef.current = { tMin, tMax, W }

  function nearestPoint(series, t) {
    let n = series[0]
    for (const p of series) if (Math.abs(p.t-t) < Math.abs(n.t-t)) n = p
    return n
  }

  function handleScrub(clientX, target=null) {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const { tMin:tm, tMax:tM, W:w } = scrubDataRef.current
    const scaleX = w / rect.width
    const localX = (clientX - rect.left) * scaleX
    const t = Math.max(tm, Math.min(tM, tm + (localX-PAD.left)/plotW*(tM-tm)))
    if (target === 'A') setCursorA(t)
    else if (target === 'B') setCursorB(t)
    else onScrub?.(t)
  }
  handleScrubRef.current = handleScrub

  const cursorX = cursorTs != null ? xOf(Math.max(tMin,Math.min(tMax,cursorTs))) : null
  const xA = cursorA != null ? xOf(cursorA) : null
  const xB = cursorB != null ? xOf(cursorB) : null

  const xTicks = [tMin, tMax]
  const fmtXTick = t => {
    const d = new Date(t)
    if (cfg.totalMs <= 86400000) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    return d.toLocaleDateString([],{day:'2-digit',month:'2-digit'})
  }
  const fmtCursorTime = t => {
    const d = new Date(t)
    return cfg.totalMs <= 86400000
      ? d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
      : d.toLocaleDateString([],{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:6, alignItems:'center' }}>
        {metrics.map(m => (
          <span key={m} style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'var(--text2)' }}>
            <span style={{ width:10, height:2, background:METRIC_SERIES_COLOR[m]||'var(--accent-vivid)', display:'inline-block' }}/>
            {METRIC_LABEL[m]}
          </span>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', gap:4 }}>
          <button data-widget-interactive="1" onClick={()=>setCursorA(cursorA==null?(tMin+(tMax-tMin)*0.35):null)}
            style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:'var(--r-sm)', cursor:'pointer',
              border:'1px solid var(--accent-vivid)', background:cursorA!=null?'var(--accent-vivid)':'transparent', color:cursorA!=null?'#fff':'var(--accent-vivid)' }}>A</button>
          <button data-widget-interactive="1" onClick={()=>setCursorB(cursorB==null?(tMin+(tMax-tMin)*0.65):null)}
            style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:'var(--r-sm)', cursor:'pointer',
              border:'1px solid var(--warn)', background:cursorB!=null?'var(--warn)':'transparent', color:cursorB!=null?'#fff':'var(--warn)' }}>B</button>
        </div>
      </div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none"
        style={{cursor:'default', touchAction:'none'}}>

        <rect x={PAD.left} y={PAD.top} width={plotW} height={yOf(1)-PAD.top} fill="var(--danger)" opacity="0.05"/>
        <rect x={PAD.left} y={yOf(-1)} width={plotW} height={PAD.top+ph-yOf(-1)} fill="var(--danger)" opacity="0.05"/>
        <line x1={PAD.left} y1={yOf(1)}  x2={PAD.left+plotW} y2={yOf(1)}  stroke="var(--danger)" strokeWidth="1" strokeDasharray="4 3" opacity="0.5"/>
        <line x1={PAD.left} y1={yOf(-1)} x2={PAD.left+plotW} y2={yOf(-1)} stroke="var(--danger)" strokeWidth="1" strokeDasharray="4 3" opacity="0.5"/>
        <line x1={PAD.left} y1={yOf(0)}  x2={PAD.left+plotW} y2={yOf(0)}  stroke="var(--border)" strokeWidth="0.5"/>

        <line x1={PAD.left} y1={PAD.top+ph} x2={PAD.left+plotW} y2={PAD.top+ph} stroke="var(--border)" strokeWidth="1"/>
        {xTicks.map((t,i)=>(
          <text key={i} x={xOf(t)} y={height-16} textAnchor={i===0?'start':'end'} fontSize="8" fill="var(--text3)" fontFamily="var(--mono)" opacity="0.6">{fmtXTick(t)}</text>
        ))}

        {metrics.map(m => {
          const series = byMetric[m]
          const color = METRIC_SERIES_COLOR[m]||'var(--accent-vivid)'
          const dts = series.slice(1).map((p,i)=>p.t-series[i].t).sort((a,b)=>a-b)
          const medianDt = dts[Math.floor(dts.length/2)] || 60000
          const segments = []
          for (let i=0;i<series.length-1;i++) {
            const a=series[i], b=series[i+1]
            if (b.t-a.t > medianDt*4) continue
            const xa=xOf(a.t), xb=xOf(b.t)
            const na=normalizeValue(m,a.v)??0, nb=normalizeValue(m,b.v)??0
            const aOut=Math.abs(na)>1, bOut=Math.abs(nb)>1
            const push=(x1,y1,x2,y2,out)=>segments.push({x1,y1,x2,y2,stroke:out?color:'var(--text3)',opacity:out?0.95:0.35,width:out?1.8:1.2})
            if (aOut===bOut) push(xa,yOf(na),xb,yOf(nb),aOut)
            else {
              const boundary = na>1||nb>1 ? 1 : -1
              const frac=(boundary-na)/(nb-na)
              const xc=xa+frac*(xb-xa), yc=yOf(boundary)
              push(xa,yOf(na),xc,yc,aOut)
              push(xc,yc,xb,yOf(nb),bOut)
            }
          }
          return <g key={m}>{segments.map((s,i)=>(
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.width} opacity={s.opacity} strokeLinecap="round"/>
          ))}</g>
        })}

        {cursorX != null && (
          <g>
            <line x1={cursorX} y1={PAD.top} x2={cursorX} y2={PAD.top+ph} stroke="#fff" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5"/>
            {metrics.map(m => {
              const n = normalizeValue(m, nearestPoint(byMetric[m],cursorTs).v) ?? 0
              const out = Math.abs(n) > 1
              const c = out ? (METRIC_SERIES_COLOR[m]||'var(--accent-vivid)') : 'var(--text2)'
              return <circle key={m} cx={cursorX} cy={yOf(n)} r="3" fill={c} stroke="#fff" strokeWidth="0.8"/>
            })}
          </g>
        )}

        {(() => {
          function pickTarget(clientX) {
            const rect = svgRef.current?.getBoundingClientRect()
            if (!rect) return null
            const scaleX = W / rect.width
            const localX = (clientX - rect.left) * scaleX
            const candidates = []
            if (xA != null && Math.abs(localX - xA) < 16) candidates.push({ t:'A', d:Math.abs(localX-xA) })
            if (xB != null && Math.abs(localX - xB) < 16) candidates.push({ t:'B', d:Math.abs(localX-xB) })
            if (!candidates.length) return null
            return candidates.sort((a,b)=>a.d-b.d)[0].t
          }
          pickTargetRef.current = pickTarget
          return null
        })()}

        {xA != null && <g>
          <line x1={xA} y1={PAD.top} x2={xA} y2={PAD.top+ph} stroke="var(--accent-vivid)" strokeWidth="1" strokeDasharray="2 2"/>
          <polygon points={`${xA-6},${PAD.top+ph+4} ${xA+6},${PAD.top+ph+4} ${xA},${PAD.top+ph+12}`} fill="var(--accent-vivid)" style={{pointerEvents:'none'}}/>
          <text x={xA} y={PAD.top+ph+22} textAnchor="middle" fontSize="9" fill="var(--accent-vivid)" fontFamily="var(--mono)" style={{pointerEvents:'none'}}>{fmtCursorTime(cursorA)}</text>
        </g>}
        {xB != null && <g>
          <line x1={xB} y1={PAD.top} x2={xB} y2={PAD.top+ph} stroke="var(--warn)" strokeWidth="1" strokeDasharray="2 2"/>
          <polygon points={`${xB-6},${PAD.top+ph+4} ${xB+6},${PAD.top+ph+4} ${xB},${PAD.top+ph+12}`} fill="var(--warn)" style={{pointerEvents:'none'}}/>
          <text x={xB} y={PAD.top+ph+22} textAnchor="middle" fontSize="9" fill="var(--warn)" fontFamily="var(--mono)" style={{pointerEvents:'none'}}>{fmtCursorTime(cursorB)}</text>
        </g>}

        <rect data-widget-interactive="1" x={PAD.left} y={PAD.top} width={plotW} height={ph}
         fill="transparent" style={{cursor:'ew-resize'}}
          onMouseDown={e=>{
            const target = pickTargetRef.current?.(e.clientX)
            if (target) { e.stopPropagation(); dragTargetRef.current = target }
          }}
          onTouchStart={e=>{
            const t=e.touches[0]; if(!t) return
            const target = pickTargetRef.current?.(t.clientX)
            if (target) { e.stopPropagation(); dragTargetRef.current = target }
          }}/>

        {metrics.map((m,mi) => {
          const ax = PAD.left+plotW+8+mi*AXIS_W
          const r = STATUS_RANGES[m]
          const domain = METRIC_DOMAIN[m] || [0,100]
          const low  = r?.lowRed  ?? domain[0]
          const high = r?.highRed ?? domain[1]
          const identityColor = METRIC_SERIES_COLOR[m]||'var(--accent-vivid)'
          const yOfReal = v => yOf(normalizeValue(m,v)??0)
          const ticks3 = [low, (low+high)/2, high]
          const series = byMetric[m]
          const refTs = cursorTs ?? series.at(-1)?.t
          const nearest = nearestPoint(series, refTs)
          const statusColorMain = statusColorForValue(m, nearest.v)

          const ptA = cursorA!=null ? nearestPoint(series, cursorA) : null
          const ptB = cursorB!=null ? nearestPoint(series, cursorB) : null

          let compareBlock = null
          if (ptA && ptB) {
            const [earlier, later] = cursorA <= cursorB ? [ptA,ptB] : [ptB,ptA]
            const nEarlier = normalizeValue(m, earlier.v) ?? 0, nLater = normalizeValue(m, later.v) ?? 0
            const outEarlier = Math.abs(nEarlier) > 1, outLater = Math.abs(nLater) > 1
            const pct = earlier.v !== 0 ? ((later.v - earlier.v) / Math.abs(earlier.v)) * 100 : 0
            const arrow = later.v > earlier.v ? '▲' : later.v < earlier.v ? '▼' : '—'
            const sign = later.v >= earlier.v ? '+' : '-'
            let deltaColor
            if (!outEarlier && !outLater) deltaColor = '#fff'
            else if (outEarlier && !outLater) deltaColor = 'var(--ok)'
            else if (!outEarlier && outLater) deltaColor = 'var(--danger)'
            else {
              const sevEarlier = Math.abs(nEarlier)-1, sevLater = Math.abs(nLater)-1
              deltaColor = sevLater > sevEarlier ? 'var(--danger)' : '#fff'
            }
            compareBlock = (
              <g>
                <rect x={ax-2} y={yOfReal(ptA.v)-7} width={AXIS_W-6} height={13} rx="2" fill="var(--bg-elev)" stroke="var(--accent-vivid)" strokeWidth="1"/>
                <text x={ax+2} y={yOfReal(ptA.v)+3} fontSize="11" fill="var(--accent-vivid)" fontFamily="var(--mono)" fontWeight="700">{ptA.v.toFixed(1)}</text>
                <rect x={ax-2} y={yOfReal(ptB.v)-7} width={AXIS_W-6} height={13} rx="2" fill="var(--bg-elev)" stroke="var(--warn)" strokeWidth="1"/>
                <text x={ax+2} y={yOfReal(ptB.v)+3} fontSize="11" fill="var(--warn)" fontFamily="var(--mono)" fontWeight="700">{ptB.v.toFixed(1)}</text>
                <text x={ax} y={height-4} fontSize="10.5" fontFamily="var(--mono)" fontWeight="700" fill={deltaColor}>{arrow} {sign}{Math.abs(pct).toFixed(1)}%</text>
              </g>
            )
          }

          return (
            <g key={m}>
              <line x1={ax} y1={PAD.top} x2={ax} y2={PAD.top+ph} stroke="var(--text2)" strokeWidth="0.6" opacity="0.5"/>
              {ticks3.map((v,i)=>(
                <g key={i}>
                  <line x1={ax-2} y1={yOfReal(v)} x2={ax+2} y2={yOfReal(v)} stroke="var(--text2)" strokeWidth="0.6"/>
                  <text x={ax+4} y={yOfReal(v)+3} fontSize="11" fill="var(--text2)" fontFamily="var(--mono)">{Math.round(v)}</text>
                </g>
              ))}
              <text x={ax} y={PAD.top-10} fontSize="11" fill={identityColor} fontFamily="var(--mono)" fontWeight="700">{METRIC_UNIT[m]||m.slice(0,3)}</text>
              {compareBlock || (
                <g>
                  <rect x={ax-2} y={yOfReal(nearest.v)-7} width={AXIS_W-6} height={13} rx="2" fill="var(--bg-elev)" stroke={statusColorMain} strokeWidth="1"/>
                  <text x={ax+2} y={yOfReal(nearest.v)+3} fontSize="12" fill={statusColorMain} fontFamily="var(--mono)" fontWeight="700">{nearest.v.toFixed(1)}</text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Navigate detail panel ─────────────────────────────────────────────────────
function NavDetailPanel({ el, activeContract, onClose, rangeKey='h24', cursorTs=null, onScrub=null }) {
  if (!el) return null
  const isApp = el.watts != null
  const isSensorEl = !!el.deviceId
  const rate = activeContract?.utilities?.electricity?.tiers?.[0]?.ratePerKwh || 31
  const costDay = isApp ? el.watts*24/1000*rate : 0
  const availableMetrics = isSensorEl ? (el.metrics || []) : []
  const [panelTab, setPanelTab] = useState('detail')
  const initialWidth = isSensorEl ? Math.min(700, 320 + availableMetrics.length*95) : 280

  return(
    <div key={el.id} style={{width:initialWidth,minWidth:300,minHeight:140,resize:isSensorEl?'both':'none',overflow:'auto'}}
      className="hp-card hp-card--elevated">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'var(--sp-3)',cursor:'grab'}}>
        <div>
          <div style={{fontSize:'var(--fs-md)',fontWeight:700}}>{el.label}</div>
          {isApp&&<div style={{fontSize:'var(--fs-sm)',color:'var(--warn)',marginTop:2}}>{el.watts}W</div>}
          {isSensorEl&&(
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',fontFamily:'var(--mono)',marginTop:2}}>{el.deviceId}</div>
          )}
        </div>
        <button data-widget-interactive="1" onClick={onClose} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:20,lineHeight:1}}>×</button>
      </div>

      {isSensorEl && (
        <div data-widget-interactive="1" style={{display:'flex',gap:4,marginBottom:'var(--sp-3)'}}>
          {[['detail','Capteur'],['comfort','Confort 24h'],['month','Tendance 30j']].map(([k,l])=>(
            <button key={k} onClick={()=>setPanelTab(k)} className="hp-focus-visible" style={{
              flex:1,padding:'4px 0',borderRadius:'var(--r-sm)',border:'none',cursor:'pointer',
              fontSize:10,fontWeight:700,
              background:panelTab===k?'var(--accent-soft)':'var(--bg3)',
              color:panelTab===k?'var(--accent-vivid)':'var(--text3)',
            }}>{l}</button>
          ))}
        </div>
      )}

      <div data-widget-interactive="1">
        {isApp&&(
          <div style={{background:'var(--bg3)',borderRadius:'var(--r-sm)',padding:'var(--sp-2) var(--sp-3)',marginBottom:'var(--sp-2)'}}>
            {[['Daily',`¥${Math.round(costDay)}`],['Monthly',`¥${Math.round(costDay*30)}`]].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-sm)',marginBottom:3}}>
                <span style={{color:'var(--text3)'}}>{l}</span>
                <span style={{fontFamily:'var(--mono)',color:'var(--text)',fontWeight:700}}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {isSensorEl && panelTab==='detail' && (
          availableMetrics.length
            ? <NormalizedMultiChart deviceId={el.deviceId} availableMetrics={availableMetrics} rangeKey={rangeKey} cursorTs={cursorTs} onScrub={onScrub}/>
            : <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)'}}>Aucune métrique déclarée pour ce capteur — édite-le pour en ajouter.</div>
        )}

        {isSensorEl && panelTab==='comfort' && (
          <ComfortScoreCard start="-24h" every="10m" label="24h"/>
        )}

        {isSensorEl && panelTab==='month' && (
          <ComfortMonthChart days={30}/>
        )}
      </div>
    </div>
  )
}

// ─── Hierarchy sidebar ─────────────────────────────────────────────────────────
function HierarchySidebar({db,save,sel,setSel}){
  const[editing,setEditing]=useState(null)
  const[name,setName]=useState('')
  const confirm=(type,bId,aId,fId)=>{
    save(db=>{const d=JSON.parse(JSON.stringify(db))
      if(type==='b')d.buildings.find(b=>b.id===bId).name=name
      if(type==='a')d.buildings.find(b=>b.id===bId).apartments.find(a=>a.id===aId).name=name
      if(type==='f')d.buildings.find(b=>b.id===bId).apartments.find(a=>a.id===aId).floors.find(f=>f.id===fId).name=name
      return d
    });setEditing(null)
  }
  const add=(type,bId,aId)=>{
    if(type==='b'){const b={id:mkId(),name:'New Building',apartments:[{id:mkId(),name:'Apartment',contractId:null,floors:[{...EMPTY_FLOOR,id:mkId()}]}]};save(d=>({...d,buildings:[...d.buildings,b]}));setSel({bId:b.id,aId:b.apartments[0].id,fId:b.apartments[0].floors[0].id})}
    if(type==='a'){const a={id:mkId(),name:'New Apartment',contractId:null,floors:[{...EMPTY_FLOOR,id:mkId()}]};save(d=>({...d,buildings:d.buildings.map(b=>b.id===bId?{...b,apartments:[...b.apartments,a]}:b)}));setSel({bId,aId:a.id,fId:a.floors[0].id})}
    if(type==='f'){const f={...EMPTY_FLOOR,id:mkId(),name:'New Floor'};save(d=>({...d,buildings:d.buildings.map(b=>b.id===bId?{...b,apartments:b.apartments.map(a=>a.id===aId?{...a,floors:[...a.floors,f]}:a)}:b)}));setSel({bId,aId,fId:f.id})}
  }
  const del=(type,bId,aId,fId)=>{
    if(!window.confirm('Delete this and all its content?'))return
    save(d=>{const c=JSON.parse(JSON.stringify(d))
      if(type==='b')c.buildings=c.buildings.filter(b=>b.id!==bId)
      if(type==='a')c.buildings=c.buildings.map(b=>b.id===bId?{...b,apartments:b.apartments.filter(a=>a.id!==aId)}:b)
      if(type==='f')c.buildings=c.buildings.map(b=>b.id===bId?{...b,apartments:b.apartments.map(a=>a.id===aId?{...a,floors:a.floors.filter(f=>f.id!==fId)}:a)}:b)
      return c
    })
  }
  const ne=(id,label,onCfm)=>editing===id
    ?<input autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={onCfm} onKeyDown={e=>{if(e.key==='Enter')onCfm();if(e.key==='Escape')setEditing(null)}} style={{fontSize:'var(--fs-xs)',background:'transparent',border:'none',borderBottom:'1px solid var(--accent-vivid)',color:'var(--text)',outline:'none',width:'100%',padding:'1px'}}/>
    :<span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'var(--fs-xs)',cursor:'pointer'}} onDoubleClick={()=>{setEditing(id);setName(label)}}>{label}</span>
  const mb=(onClick,ch,c)=><button onClick={onClick} className="hp-focus-visible" style={{background:'none',border:'none',color:c||'var(--text3)',cursor:'pointer',fontSize:'var(--fs-sm)',padding:'1px 5px',flexShrink:0,lineHeight:1}}>{ch}</button>
  return(
    <div style={{borderBottom:'0.5px solid var(--border)'}}>
      <div style={{padding:'var(--sp-2) var(--sp-2)',borderBottom:'0.5px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span className="hp-eyebrow">Structure</span>
        {mb(()=>add('b'),'+ Building','var(--accent-vivid)')}
      </div>
      {db.buildings.map(bld=>(
        <div key={bld.id}>
          <div style={{padding:'var(--sp-2) var(--sp-2)',display:'flex',alignItems:'center',gap:4}}>
            <span style={{fontSize:'var(--fs-sm)',flexShrink:0}}>🏢</span>
            {ne(bld.id,bld.name,()=>confirm('b',bld.id))}
            {mb(()=>add('a',bld.id),'+')}{mb(()=>del('b',bld.id),'✕','var(--danger)')}
          </div>
          {bld.apartments.map(apt=>(
            <div key={apt.id}>
              <div style={{padding:'var(--sp-1) var(--sp-2) var(--sp-1) 22px',display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:'var(--fs-xs)',flexShrink:0}}>🏠</span>
                {ne(apt.id,apt.name,()=>confirm('a',bld.id,apt.id))}
                {mb(()=>add('f',bld.id,apt.id),'+')}{mb(()=>del('a',bld.id,apt.id),'✕','var(--danger)')}
              </div>
              {apt.floors.map(fl=>{
                const isSel=sel.fId===fl.id&&sel.aId===apt.id&&sel.bId===bld.id
                return(
                  <div key={fl.id} onClick={()=>setSel({bId:bld.id,aId:apt.id,fId:fl.id})}
                    style={{padding:'var(--sp-1) var(--sp-2) var(--sp-1) 36px',display:'flex',alignItems:'center',gap:4,cursor:'pointer',background:isSel?'var(--accent-soft)':'transparent',borderLeft:isSel?'2px solid var(--accent-vivid)':'2px solid transparent'}}>
                    <span style={{fontSize:'var(--fs-2xs)',color:isSel?'var(--accent-vivid)':'var(--text3)'}}>■</span>
                    {ne(fl.id,fl.name,()=>confirm('f',bld.id,apt.id,fl.id))}
                    {mb(e=>{e.stopPropagation();del('f',bld.id,apt.id,fl.id)},'✕','var(--danger)')}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Properties panels ─────────────────────────────────────────────────────────
function PropsPanel({selected,floor,onUpdate,onClose,rightOffset=8}){
  if(!selected)return null
  const allEls=[...(floor.appliances||[]),(floor.furniture||[]),(floor.sensors||[]),(floor.stairs||[])].flat()
  const el=allEls.find(e=>e.id===selected.id)
  const wall=(floor.walls||[]).find(w=>w.id===selected.id)
  const opening=(floor.openings||[]).find(o=>o.id===selected.id)
  if(!el&&!wall&&!opening)return null

  const S={width:'100%',padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:'var(--fs-sm)',fontFamily:'var(--mono)',outline:'none'}
  const Row=({label,children})=><div style={{marginBottom:'var(--sp-2)'}}><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:4}}>{label}</div>{children}</div>

  const Wrap=({title,children})=>(
    <div className="hp-card hp-card--elevated" style={{position:'absolute',right:rightOffset,top:'var(--sp-2)',width:224,padding:'var(--sp-4)',zIndex:50,boxShadow:'var(--shadow-3)',maxHeight:'85%',overflow:'auto',transition:'right var(--dur-base) var(--ease)'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'var(--sp-3)'}}>
        <span style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--text2)'}}>{title}</span>
        <button onClick={onClose} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:20,lineHeight:1}}>×</button>
      </div>
      {children}
    </div>
  )

  if(wall)return(
    <Wrap title="Wall">
      <Row label="Thickness (cm) — updates all walls">
        <input type="number" min="5" max="60" step="5" value={pxToCm(wall.thickness||10)}
          onChange={e=>{const v=cmToPx(parseFloat(e.target.value)||10);onUpdate({...wall,thickness:v})}} style={S}/>
      </Row>
      <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)'}}>{fmtDist(d2(wall.x1,wall.y1,wall.x2,wall.y2))} · Drag square handles to move endpoints</div>
    </Wrap>
  )

  if(opening){
    const owWall=(floor.walls||[]).find(w=>w.id===opening.wallId)
    const owLen=owWall?wallUV(owWall).len:200
    return(
      <Wrap title={opening.type.startsWith('door')?'Door':'Window'}>
        <Row label="Width (cm)">
          <input type="number" min="20" max={pxToCm(owLen*0.8)} value={pxToCm(opening.width)}
            onChange={e=>onUpdate({...opening,width:cmToPx(parseFloat(e.target.value)||40)})} style={S}/>
        </Row>
        <Row label="Type">
          <select value={opening.type} onChange={e=>onUpdate({...opening,type:e.target.value})} style={S}>
            <option value="door-hinged">🚪 Hinged door</option>
            <option value="door-sliding">⇌ Sliding door</option>
            <option value="window-fixed">◫ Fixed window</option>
            <option value="window-sliding">↔ Sliding window</option>
            <option value="window-casement">◬ Casement window</option>
          </select>
        </Row>
        {opening.type.startsWith('door')&&(
          <Row label="Direction">
            <button onClick={()=>onUpdate({...opening,opensLeft:!opening.opensLeft})} className="hp-focus-visible" style={{padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-sm)',cursor:'pointer',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)'}}>
              {opening.opensLeft?'← Opens left':'→ Opens right'}
            </button>
          </Row>
        )}
        <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginTop:4}}>Drag orange handles to resize · Blue center to move</div>
      </Wrap>
    )
  }

  const isApp=!!(floor.appliances||[]).find(a=>a.id===el.id)
  const isSens=!!(floor.sensors||[]).find(s=>s.id===el.id)
  return(
    <Wrap title="Properties">
      <Row label="Label"><input value={el.label||''} onChange={e=>onUpdate({...el,label:e.target.value})} style={S}/></Row>
      {!isSens&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:'var(--sp-2)'}}>
        <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:4}}>W (cm)</div><input type="number" min="5" value={pxToCm(el.w||0)} onChange={e=>onUpdate({...el,w:Math.max(5,cmToPx(parseFloat(e.target.value)||10))})} style={S}/></div>
        <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:4}}>H (cm)</div><input type="number" min="5" value={pxToCm(el.h||0)} onChange={e=>onUpdate({...el,h:Math.max(5,cmToPx(parseFloat(e.target.value)||10))})} style={S}/></div>
      </div>}
      {isSens&&<>
        <Row label="Device ID"><input value={el.deviceId||''} onChange={e=>onUpdate({...el,deviceId:e.target.value})} style={S}/></Row>
        <Row label="Metrics (comma-sep)"><input value={(el.metrics||[]).join(',')} onChange={e=>onUpdate({...el,metrics:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})} placeholder="temperature,co2" style={S}/></Row>
        <Row label="Detection radius (cm)"><input type="number" min="20" value={pxToCm(el.radius||120)} onChange={e=>onUpdate({...el,radius:cmToPx(parseFloat(e.target.value)||60)})} style={S}/></Row>
      </>}
      {isApp&&<Row label="Watts"><input type="number" min="0" value={el.watts||0} onChange={e=>onUpdate({...el,watts:parseInt(e.target.value)||0})} style={S}/></Row>}
      {!isSens&&<Row label="Rotation (°)"><input type="number" min="0" max="360" step="15" value={el.rotation||0} onChange={e=>onUpdate({...el,rotation:parseFloat(e.target.value)||0})} style={S}/></Row>}
      {!isSens&&<Row label="Color">
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <input type="color" value={el.color||'#378ADD'} onChange={e=>onUpdate({...el,color:e.target.value})} style={{width:40,height:30,padding:2,borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',cursor:'pointer'}}/>
          <span style={{fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',color:'var(--text2)'}}>{el.color||'#378ADD'}</span>
        </div>
      </Row>}
      {!isApp&&!isSens&&<Row label="Opacity"><input type="range" min="0.1" max="1" step="0.05" value={el.opacity||0.7} onChange={e=>onUpdate({...el,opacity:parseFloat(e.target.value)})} style={{width:'100%'}}/></Row>}
    </Wrap>
  )
}

// ─── Layers panel ──────────────────────────────────────────────────────────────
function LayersPanel({showAppl,setShowAppl,showFurn,setShowFurn,showSens,setShowSens,showIAQ,setShowIAQ,showRel,setShowRel,iaqMet,setIaqMet,heatmapMode,setHeatmapMode}){
  const tog=(label,val,fn,c)=>(
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'var(--sp-2) 0',borderBottom:'0.5px solid var(--border)'}}>
      <span style={{fontSize:'var(--fs-sm)',color:c||'var(--text2)'}}>{label}</span>
      <button onClick={()=>fn(!val)} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',fontWeight:600,cursor:'pointer',border:val?'none':'0.5px solid var(--border)',background:val?'var(--accent-vivid)':'transparent',color:val?'#fff':'var(--text3)'}}>{val?'ON':'OFF'}</button>
    </div>
  )
  return(
    <div style={{padding:'var(--sp-2) var(--sp-3)',borderTop:'0.5px solid var(--border)'}}>
      <div className="hp-eyebrow" style={{marginBottom:'var(--sp-2)'}}>Layers</div>
      {tog('Appliances',showAppl,setShowAppl,'var(--accent-vivid)')}
      {tog('Furniture', showFurn,setShowFurn,'var(--info)')}
      {tog('Sensors',   showSens,setShowSens,'var(--ok)')}
      {tog('IAQ Heatmap',showIAQ,setShowIAQ,'var(--warn)')}
      {showIAQ&&<>
        <div style={{display:'flex',gap:4,paddingTop:'var(--sp-2)'}}>
          {['composite','single'].map(md=>(
            <button key={md} onClick={()=>setHeatmapMode(md)} className="hp-focus-visible" style={{flex:1,padding:'4px 0',borderRadius:'var(--r-sm)',fontSize:'var(--fs-2xs)',fontWeight:700,cursor:'pointer',border:'none',background:heatmapMode===md?'var(--accent-vivid)':'var(--bg3)',color:heatmapMode===md?'#fff':'var(--text3)'}}>{md==='composite'?'Confort':'Métrique'}</button>
          ))}
        </div>
        {heatmapMode==='single' && (
          <div style={{paddingTop:'var(--sp-2)'}}>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:'var(--sp-2)'}}>Metric</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
              {['temperature','humidity','co2','iaq'].map(m=>(
                <button key={m} onClick={()=>setIaqMet(m)} className="hp-focus-visible" style={{padding:'3px var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-2xs)',cursor:'pointer',border:iaqMet===m?'none':'0.5px solid var(--border)',background:iaqMet===m?'var(--accent-vivid)':'transparent',color:iaqMet===m?'#fff':'var(--text3)',fontFamily:'var(--mono)'}}>{m}</button>
              ))}
            </div>
          </div>
        )}
        {tog('Reliability',showRel,setShowRel)}
      </>}
    </div>
  )
}

// ─── Tool sub-menus ────────────────────────────────────────────────────────────
const TOOL_GROUPS=[
  {id:'structure',label:'Walls',tools:[{id:'wall',label:'▬ Wall'}]},
  {id:'openings', label:'Openings',tools:[
    {id:'door-hinged',   label:'🚪 Hinged door'},
    {id:'door-sliding',  label:'⇌ Sliding door'},
    {id:'window-fixed',  label:'◫ Fixed window'},
    {id:'window-sliding',label:'↔ Sliding window'},
    {id:'window-casement',label:'◬ Casement window'},
  ]},
]
function useOrientation(){
  const[landscape,setLandscape]=useState(()=>typeof window!=='undefined'?window.matchMedia('(orientation: landscape)').matches:true)
  useEffect(()=>{
    const mq=window.matchMedia('(orientation: landscape)')
    const fn=e=>setLandscape(e.matches)
    mq.addEventListener?.('change',fn)
    return()=>mq.removeEventListener?.('change',fn)
  },[])
  return landscape
}
function ToolMenu({tool,setTool,openMenu,setOpenMenu}){
  const landscape=useOrientation()
  return(
    <div style={{display:'flex',gap:4}}>
      {TOOL_GROUPS.map(group=>{
        const active=group.tools.find(t=>t.id===tool)
        return(
          <div key={group.id} style={{position:'relative'}}>
            <button onClick={()=>setOpenMenu(m=>m===group.id?null:group.id)} className="hp-focus-visible"
              style={{padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-sm)',cursor:'pointer',display:'flex',alignItems:'center',gap:4,border:active?'none':'0.5px solid var(--border)',background:active?'var(--accent-vivid)':'var(--bg2)',color:active?'#fff':'var(--text2)'}}>
              {active?active.label:group.label} {group.tools.length>1&&'▾'}
            </button>
            {openMenu===group.id&&(
              <div className="hp-card hp-card--elevated" style={landscape?{
                position:'absolute',top:0,right:'calc(100% + 4px)',padding:4,zIndex:200,minWidth:210,boxShadow:'var(--shadow-3)',display:'flex',flexDirection:'column',gap:2,
              }:{
                position:'absolute',bottom:'calc(100% + 4px)',left:0,padding:4,zIndex:200,boxShadow:'var(--shadow-3)',display:'flex',flexDirection:'row',gap:2,
              }}>
                {group.tools.map(t=>(
                  <button key={t.id} onClick={()=>{setTool(t.id);setOpenMenu(null)}} className="hp-focus-visible"
                    style={{display:'block',width:landscape?'100%':'auto',whiteSpace:'nowrap',padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',border:'none',background:tool===t.id?'var(--accent-soft)':'transparent',color:tool===t.id?'var(--accent-vivid)':'var(--text2)',textAlign:'left',cursor:'pointer',fontSize:'var(--fs-sm)'}}>{t.label}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Boussole d'orientation ────────────────────────────────────────────────────
const SUN_RAD=Math.PI/180
function sunTimes(date,lat,lon){
  const N1=Math.floor(275*(date.getMonth()+1)/9)
  const N2=Math.floor((date.getMonth()+3)/12)
  const N3=1+Math.floor((date.getFullYear()-4*Math.floor(date.getFullYear()/4)+2)/3)
  const N=N1-(N2*N3)+date.getDate()-30
  const lngHour=lon/15
  function calc(isRise){
    const t=N+((isRise?6:18)-lngHour)/24
    const M=(0.9856*t)-3.289
    let L=M+(1.916*Math.sin(SUN_RAD*M))+(0.020*Math.sin(2*SUN_RAD*M))+282.634
    L=(L+360)%360
    let RA=(180/Math.PI)*Math.atan(0.91764*Math.tan(SUN_RAD*L))
    RA=(RA+360)%360
    const Lq=Math.floor(L/90)*90,RAq=Math.floor(RA/90)*90
    RA=(RA+(Lq-RAq))/15
    const sinDec=0.39782*Math.sin(SUN_RAD*L)
    const cosDec=Math.cos(Math.asin(sinDec))
    const cosH=(Math.cos(SUN_RAD*90.833)-(sinDec*Math.sin(SUN_RAD*lat)))/(cosDec*Math.cos(SUN_RAD*lat))
    if(cosH>1||cosH<-1)return null
    let H=isRise?360-((180/Math.PI)*Math.acos(cosH)):(180/Math.PI)*Math.acos(cosH)
    H/=15
    const T=H+RA-(0.06571*t)-6.622
    let UT=(T-lngHour+24)%24
    const dd=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()))
    dd.setUTCHours(0,0,0,0)
    dd.setUTCMinutes(Math.round(UT*60))
    return dd
  }
  return{sunrise:calc(true),sunset:calc(false)}
}

function CompassWidget({deg,onChange,timeLabel,lat,lon,onSetGPS}){
  const ref=useRef(null)
  const dragging=useRef(false)

  const angleFromEvent=(clientX,clientY)=>{
    const rect=ref.current.getBoundingClientRect()
    const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2
    const a=Math.atan2(clientY-cy,clientX-cx)*180/Math.PI+90
    return Math.round(((a%360)+360)%360)
  }
  const start=e=>{dragging.current=true;e.stopPropagation()}
  const move=e=>{
    if(!dragging.current)return
    const pt=e.touches?e.touches[0]:e
    onChange(angleFromEvent(pt.clientX,pt.clientY))
  }
  const end=()=>{dragging.current=false}
  const[showGPS,setShowGPS]=useState(false)
  const[latInput,setLatInput]=useState(lat??'')
  const[lonInput,setLonInput]=useState(lon??'')
  const hasGPS=lat!=null&&lon!=null&&!isNaN(lat)&&!isNaN(lon)
  const times=hasGPS?sunTimes(new Date(),lat,lon):null
  const fmtT=d=>d?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'

  useEffect(()=>{
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',end)
    window.addEventListener('touchmove',move);window.addEventListener('touchend',end)
    return()=>{
      window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',end)
      window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[deg])

  return(
    <div className="hp-card hp-card--elevated" style={{padding:'var(--sp-2)',boxShadow:'var(--shadow-3)',userSelect:'none'}}>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:2}}>
        <button data-widget-interactive="1" onClick={()=>setShowGPS(s=>!s)} className="hp-focus-visible" title="Coordonnées GPS (pour les horaires de lever/coucher)"
          style={{background:'none',border:'none',color:hasGPS?'var(--accent-vivid)':'var(--text3)',cursor:'pointer',fontSize:11,padding:0}}>⚙ GPS</button>
      </div>
      {showGPS&&(
        <div data-widget-interactive="1" style={{display:'flex',flexDirection:'column',gap:4,marginBottom:6,padding:'var(--sp-2)',background:'var(--bg3)',borderRadius:'var(--r-sm)'}}>
          <input type="number" step="0.0001" placeholder="Latitude" value={latInput} onChange={e=>setLatInput(e.target.value)}
            style={{width:'100%',padding:'3px 6px',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:11,fontFamily:'var(--mono)'}}/>
          <input type="number" step="0.0001" placeholder="Longitude" value={lonInput} onChange={e=>setLonInput(e.target.value)}
            style={{width:'100%',padding:'3px 6px',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:11,fontFamily:'var(--mono)'}}/>
          <button onClick={()=>{onSetGPS(parseFloat(latInput),parseFloat(lonInput));setShowGPS(false)}} className="hp-focus-visible"
            style={{padding:'4px 0',borderRadius:'var(--r-sm)',border:'none',background:'var(--accent-vivid)',color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>Valider</button>
        </div>
      )}
      <div ref={ref} data-widget-interactive="1" onMouseDown={start} onTouchStart={start} title="Glisser pour régler l'orientation (informatif uniquement)"
        style={{width:56,height:56,borderRadius:'50%',border:'0.5px solid var(--border-strong)',background:'var(--bg3)',position:'relative',cursor:'grab',touchAction:'none',margin:'0 auto'}}>
        <div style={{position:'absolute',inset:0,transform:`rotate(${deg}deg)`}}>
          <div style={{position:'absolute',left:'50%',top:4,width:0,height:0,transform:'translateX(-50%)',borderLeft:'5px solid transparent',borderRight:'5px solid transparent',borderBottom:'12px solid var(--danger)'}}/>
          <div style={{position:'absolute',left:'50%',bottom:4,width:2,height:16,background:'var(--text3)',transform:'translateX(-50%)'}}/>
        </div>
        <span style={{position:'absolute',left:'50%',top:2,transform:'translateX(-50%)',fontSize:8,color:'var(--text3)',fontWeight:700}}>N</span>
      </div>
      <div style={{textAlign:'center',fontSize:'var(--fs-2xs)',color:'var(--text3)',fontFamily:'var(--mono)',marginTop:4}}>{deg}°</div>
      {hasGPS&&times&&(
        <div style={{display:'flex',justifyContent:'center',gap:8,fontSize:'var(--fs-2xs)',fontFamily:'var(--mono)',marginTop:2}}>
          <span style={{color:'#F5A623'}}>☀ {fmtT(times.sunrise)}</span>
          <span style={{color:'var(--danger)'}}>☾ {fmtT(times.sunset)}</span>
        </div>
      )}
      {timeLabel&&<div style={{textAlign:'center',fontSize:'var(--fs-2xs)',color:'var(--text2)',fontFamily:'var(--mono)',fontWeight:600,marginTop:2,borderTop:'0.5px solid var(--border)',paddingTop:3}}>{timeLabel}</div>}
    </div>
  )
}

// ─── D-pad de précision ─────────────────────────────────────────────────────────
function DPad({onNudge}){
  const btn={width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:15,borderRadius:'var(--r-sm)',touchAction:'none'}
  const repeatRef=useRef(null),timeoutRef=useRef(null),activeRef=useRef(false)

  const startRepeat=(dx,dy)=>{
    if(activeRef.current)return
    activeRef.current=true
    onNudge(dx,dy)
    timeoutRef.current=setTimeout(()=>{
      repeatRef.current=setInterval(()=>onNudge(dx,dy),80)
    },350)
  }
  const stopRepeat=()=>{
    activeRef.current=false
    clearTimeout(timeoutRef.current)
    clearInterval(repeatRef.current)
  }
  useEffect(()=>{
    window.addEventListener('mouseup',stopRepeat)
    window.addEventListener('touchend',stopRepeat)
    window.addEventListener('touchcancel',stopRepeat)
    return()=>{
      stopRepeat()
      window.removeEventListener('mouseup',stopRepeat)
      window.removeEventListener('touchend',stopRepeat)
      window.removeEventListener('touchcancel',stopRepeat)
    }
  },[])

  const dirButton=(dx,dy,label)=>(
    <button className="hp-focus-visible" data-widget-interactive="1" style={{...btn,WebkitTouchCallout:'none',WebkitUserSelect:'none',userSelect:'none'}}
      onMouseDown={e=>{e.preventDefault();startRepeat(dx,dy)}}
      onTouchStart={e=>{e.preventDefault();startRepeat(dx,dy)}}
      onContextMenu={e=>e.preventDefault()}
    >{label}</button>
  )

  return(
    <div className="hp-card hp-card--elevated" style={{padding:'var(--sp-2)',boxShadow:'var(--shadow-3)',userSelect:'none'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,34px)',gridTemplateRows:'repeat(3,34px)',gap:2}}>
        <div/>{dirButton(0,-1,'↑')}<div/>
        {dirButton(-1,0,'←')}
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)'}}>1cm</div>
        {dirButton(1,0,'→')}
        <div/>{dirButton(0,1,'↓')}<div/>
      </div>
    </div>
  )
}

// ─── Barre chronologique ─────────────────────────────────────────────────────
function fmtScrubTs(ts,rangeKey){
  const d=new Date(ts)
  if(rangeKey==='h24')return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  return d.toLocaleDateString([],{day:'2-digit',month:'2-digit'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
}
function TimelineScrubber({rangeKey,setRangeKey,scrubPct,setScrubPct,scrubTs,loading,sunTimesToday}){
  const isLive=scrubPct>=99.5
  const TICKS=6
  const stop=e=>e.stopPropagation()
  const rangeCfg=TIMELINE_RANGES[rangeKey]
  const windowStart=Date.now()-rangeCfg.totalMs
  const pctOfTime=t=>Math.max(0,Math.min(100,((t-windowStart)/rangeCfg.totalMs)*100))
  const sunMarks=(rangeKey==='h24'&&sunTimesToday)?[
    sunTimesToday.sunrise&&{t:sunTimesToday.sunrise.getTime(),color:'#F5A623'},
    sunTimesToday.sunset&&{t:sunTimesToday.sunset.getTime(),color:'var(--danger)'},
  ].filter(Boolean):[]
  return(
    <div style={{width:'min(420px,74vw)',userSelect:'none'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5,padding:'0 2px'}}>
        <span style={{fontSize:'var(--fs-2xs)',fontWeight:700,color:isLive?'var(--ok)':'var(--warn)',fontFamily:'var(--mono)',background:'rgba(0,0,0,.65)',padding:'2px var(--sp-2)',borderRadius:'var(--r-sm)'}}>
          {loading?'…':isLive?'● LIVE':fmtScrubTs(scrubTs,rangeKey)}
        </span>
        <div data-widget-interactive="1" onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} style={{display:'flex',gap:3}}>
          {Object.entries(TIMELINE_RANGES).map(([k,cfg])=>(
            <button key={k} onClick={()=>{setRangeKey(k);setScrubPct(100)}} className="hp-focus-visible" style={{padding:'1px var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:9,fontWeight:700,cursor:'pointer',border:'none',background:rangeKey===k?'rgba(255,255,255,.28)':'rgba(0,0,0,.55)',color:rangeKey===k?'#fff':'var(--text3)'}}>{cfg.label}</button>
          ))}
        </div>
      </div>
      <div style={{position:'relative',height:26}}>
        <div style={{position:'absolute',left:0,right:0,top:9,height:1,background:'rgba(255,255,255,.5)'}}/>
        {Array.from({length:TICKS+1},(_,i)=>(
          <div key={i} style={{position:'absolute',left:`${(i/TICKS)*100}%`,top:7,width:3,height:3,borderRadius:'50%',background:'rgba(255,255,255,.65)',transform:'translateX(-50%)',pointerEvents:'none'}}/>
        ))}
        {sunMarks.map((m,i)=>(
          <div key={i} style={{position:'absolute',left:`${pctOfTime(m.t)}%`,top:3,width:9,height:9,borderRadius:'50%',background:m.color,border:'1px solid #fff',transform:'translateX(-50%)',pointerEvents:'none'}}/>
        ))}
        <input type="range" min="0" max="100" step="0.5" value={scrubPct} onChange={e=>setScrubPct(parseFloat(e.target.value))}
          data-widget-interactive="1" onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop}
          style={{position:'absolute',inset:0,width:'100%',height:20,margin:0,opacity:0,cursor:'pointer'}}/>
        <div style={{position:'absolute',left:`${scrubPct}%`,top:10,width:13,height:13,borderRadius:'50%',background:isLive?'var(--ok)':'var(--accent-vivid)',border:'2px solid #fff',transform:'translate(-50%,-50%)',pointerEvents:'none',boxShadow:'0 1px 5px rgba(0,0,0,.6)'}}/>
      </div>
    </div>
  )
}

// ─── Main FloorPlanEditor ──────────────────────────────────────────────────────
export function FloorPlanEditor({deviceReadings={},onRangeChange}){
  const{state,activeContract,setEditorSetting}=useStore()
  const edSet=state.settings.editor
  const{db,save,undo,redo,canUndo,canRedo,syncStatus}=useFloorPlanDB()
  const canUndoNow=canUndo(), canRedoNow=canRedo()

  const[sel,setSel]=useState(()=>{const b=db.buildings[0],a=b?.apartments[0],f=a?.floors[0];return{bId:b?.id,aId:a?.id,fId:f?.id}})
  const currentBuilding=db.buildings.find(b=>b.id===sel.bId)
  const updateBuildingGPS=(lat,lon)=>{
    if(isNaN(lat)||isNaN(lon))return
    save(d=>({...d,buildings:d.buildings.map(b=>b.id===sel.bId?{...b,gpsLat:lat,gpsLon:lon}:b)}))
  }
  const selInitialized=useRef(false)
  useEffect(()=>{
    if(selInitialized.current||!db.buildings.length)return
    selInitialized.current=true
    let saved=null
    try{saved=JSON.parse(localStorage.getItem('homepi_fp_lastsel')||'null')}catch{}
    const isValid=saved&&db.buildings.find(b=>b.id===saved.bId)?.apartments.find(a=>a.id===saved.aId)?.floors.find(f=>f.id===saved.fId)
    if(isValid){setSel(saved);return}
    const firstB=db.buildings[0],firstA=firstB?.apartments[0],firstF=firstA?.floors[0]
    if(firstB)setSel({bId:firstB.id,aId:firstA?.id,fId:firstF?.id})
  },[db])
  useEffect(()=>{
    if(sel.bId&&sel.aId&&sel.fId)try{localStorage.setItem('homepi_fp_lastsel',JSON.stringify(sel))}catch{}
  },[sel])
  const floor=useMemo(()=>{const b=db.buildings.find(b=>b.id===sel.bId);const a=b?.apartments.find(a=>a.id===sel.aId);return a?.floors.find(f=>f.id===sel.fId)||EMPTY_FLOOR},[db,sel])

  const unplacedSensors=useMemo(()=>{
    const placedIds=new Set()
    for(const b of db.buildings)for(const a of b.apartments)for(const f of a.floors)for(const s of (f.sensors||[]))if(s.deviceId)placedIds.add(s.deviceId)
    return Object.keys(deviceReadings).filter(id=>!placedIds.has(id))
  },[db,deviceReadings])
  const updateFloor=useCallback(fn=>{save(db=>({...db,buildings:db.buildings.map(b=>b.id===sel.bId?{...b,apartments:b.apartments.map(a=>a.id===sel.aId?{...a,floors:a.floors.map(f=>f.id===sel.fId?fn(f):f)}:a)}:b)}))},[save,sel])

  const[mode,setMode]=useState('edit')
  const[tool,setTool]=useState('select')
  const[openMenu,setOpenMenu]=useState(null)
  const[showSidebar,setShowSidebar]=useState(true)
  const[showLayers,setShowLayers]=useState(true)
  const[showEdSet,setShowEdSet]=useState(false)
  const[navDetail,setNavDetail]=useState(null)
  const[hoverDetail,setHoverDetail]=useState(null)
  const[heatCursor,setHeatCursor]=useState(null)
  const[staticCursor,setStaticCursor]=useState(null)

  // ── Mode analyse de zone — rectangle(s) tracé(s) librement sur le plan ──
  const[analysisRects,setAnalysisRects]=useState([])
  const[drawingAnalysis,setDrawingAnalysis]=useState(null)

  useEffect(()=>{ setEditorMode(mode) },[mode])

  const[showAppl,setShowAppl]=useState(true)
  const[showFurn,setShowFurn]=useState(true)
  const[showSens,setShowSens]=useState(true)
  const[showIAQ,setShowIAQ]=useState(true)
  const[heatmapMode,setHeatmapMode]=useState('composite')
  const[showRel,setShowRel]=useState(false)
  const[iaqMet,setIaqMet]=useState('co2')
  const[gridCm,setGridCm]=useState(edSet.defaultGridCm||20)

  const showGrid=edSet.showGrid
  const showMeas=edSet.showMeasurements
  const snapOn  =edSet.snapEnabled

  const GRID_PX   =useMemo(()=>Math.max(1,Math.round(gridCm/CM_PER_PX)),[gridCm])
  const GRID_MAJOR=GRID_PX*5

  const[zoom,setZoom]=useState(edSet.defaultZoom||1.5)
  const[pan,setPan]=useState({x:200,y:80})
  const isPanning=useRef(false)
  const panStart =useRef(null)
  const spaceDown=useRef(false)
  const pinchRef =useRef(null)
  const svgRef   =useRef(null)
  const canvasWrapRef=useRef(null)
  const heatCursorPending=useRef(null)
  const heatCursorRAF=useRef(null)

  const[selectedIds,setSelectedIds]=useState(new Set())
  const[boxSel,     setBoxSel]     =useState(null)
  const[resizing,   setResizing]   =useState(null)
  const[wallEpDrag, setWallEpDrag] =useState(null)
  const[opDrag,     setOpDrag]     =useState(null)
  const[drawing,    setDrawing]    =useState(null)
  const[dragging,   setDragging]   =useState(null)
  const[hovWall,    setHovWall]    =useState(null)
  const[placingOp,  setPlacingOp]  =useState(null)

  const[timelineRange,setTimelineRange]=useState('h24')
  useEffect(()=>{onRangeChange?.(timelineRange)},[timelineRange,onRangeChange])
  const[scrubPct,setScrubPct]=useState(100)
  const rangeCfg=TIMELINE_RANGES[timelineRange]
  const metricHist=useFlux(showIAQ?FLUX.metricHistory(iaqMet,rangeCfg.start,rangeCfg.every):null,60000)

  const histByDevice=useMemo(()=>{
    const byDev={}
    for(const row of metricHist.data??[]){
      const dId=row.device_id;if(!dId||!row._time||row._value==='')continue
      if(!byDev[dId])byDev[dId]=[]
      byDev[dId].push({t:new Date(row._time).getTime(),v:parseFloat(row._value)})
    }
    for(const k in byDev)byDev[k].sort((a,b)=>a.t-b.t)
    return byDev
  },[metricHist.data])

  const scrubTs=Date.now()-rangeCfg.totalMs*(1-scrubPct/100)
  const isLiveScrub=scrubPct>=99.5

  const scrubRAFPending = useRef(null)
  const scrubRAFHandle = useRef(null)
  const scrubRAF = useCallback((t) => {
    scrubRAFPending.current = t
    if (scrubRAFHandle.current) return
    scrubRAFHandle.current = requestAnimationFrame(() => {
      scrubRAFHandle.current = null
      const tt = scrubRAFPending.current
      setScrubPct(Math.max(0,Math.min(100,((tt-(Date.now()-rangeCfg.totalMs))/rangeCfg.totalMs)*100)))
    })
  },[rangeCfg.totalMs])

  const scrubReadings=useMemo(()=>{
    if(isLiveScrub)return deviceReadings
    const out={}
    for(const dId in histByDevice){
      const series=histByDevice[dId];if(!series.length)continue
      let nearest=series[0]
      for(const pt of series){if(Math.abs(pt.t-scrubTs)<Math.abs(nearest.t-scrubTs))nearest=pt}
      out[dId]={...deviceReadings[dId],[iaqMet]:nearest.v}
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[histByDevice,scrubTs,isLiveScrub,iaqMet])

  const{colorUrl,confUrl,x0:hmX0,y0:hmY0,imgW:hmW,imgH:hmH,sampleAt}=useHeatmap(floor.sensors||[],scrubReadings,iaqMet,floor.walls||[],showIAQ,pan,zoom,canvasWrapRef,heatmapMode)

  useEffect(()=>{
    if(!sampleAt)return
    setHeatCursor(prev=>{
      if(!prev)return prev
      const s=sampleAt(prev.x,prev.y)
      return s?{...prev,value:s.value}:null
    })
    setStaticCursor(prev=>{
      if(!prev)return prev
      const s=sampleAt(prev.x,prev.y)
      return{...prev,value:s?s.value:null}
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scrubReadings,iaqMet,sampleAt])

  const getWorld=useCallback((cx,cy,doSnap=true)=>{
    const rect=svgRef.current?.getBoundingClientRect();if(!rect)return{x:0,y:0}
    let x=(cx-rect.left-pan.x)/zoom,y=(cy-rect.top-pan.y)/zoom
    if(doSnap){
      if(snapOn){x=snapG(x,GRID_PX);y=snapG(y,GRID_PX)}
      else{const all=[...(floor.appliances||[]),(floor.furniture||[])].flat();const s=snapObstacles(x,y,floor.walls||[],all,edSet.snapDist/zoom);x=s.x;y=s.y}
    }
    return{x,y}
  },[pan,zoom,snapOn,GRID_PX,floor,edSet.snapDist])

  const getCenter=useCallback(()=>{
    const rect=svgRef.current?.getBoundingClientRect();if(!rect)return{x:300,y:250}
    return{x:snapG((rect.width/2-pan.x)/zoom,GRID_PX),y:snapG((rect.height/2-pan.y)/zoom,GRID_PX)}
  },[pan,zoom,GRID_PX])

  const fitToContent=useCallback(()=>{
    const pts=[...(floor.walls||[]).flatMap(w=>[{x:w.x1,y:w.y1},{x:w.x2,y:w.y2}]),...(floor.appliances||[]).map(a=>({x:a.x+a.w/2,y:a.y+a.h/2})),...(floor.furniture||[]).map(f=>({x:f.x+f.w/2,y:f.y+f.h/2}))]
    if(!pts.length){setZoom(1.5);setPan({x:200,y:80});return}
    const minX=Math.min(...pts.map(p=>p.x))-80,maxX=Math.max(...pts.map(p=>p.x))+80
    const minY=Math.min(...pts.map(p=>p.y))-80,maxY=Math.max(...pts.map(p=>p.y))+80
    const rect=svgRef.current?.getBoundingClientRect();if(!rect)return
    const nz=Math.min(5,Math.max(0.2,Math.min(rect.width/(maxX-minX),rect.height/(maxY-minY))*0.88))
    setZoom(nz);setPan({x:rect.width/2-(minX+maxX)/2*nz,y:rect.height/2-(minY+maxY)/2*nz})
  },[floor])

  const findEl=useCallback(id=>[...(floor.appliances||[]),(floor.furniture||[]),(floor.sensors||[]),(floor.stairs||[])].flat().find(e=>e.id===id)||(floor.walls||[]).find(w=>w.id===id)||(floor.openings||[]).find(o=>o.id===id),[floor])
  const primaryEl=useMemo(()=>selectedIds.size===1?findEl([...selectedIds][0]):null,[selectedIds,findEl])
  const primaryIsRect=primaryEl&&primaryEl.w!=null&&!(floor.walls||[]).find(w=>w.id===primaryEl.id)&&!(floor.openings||[]).find(o=>o.id===primaryEl.id)
  const primaryWall  =primaryEl&&(floor.walls||[]).find(w=>w.id===primaryEl.id)
  const primaryOp    =primaryEl&&(floor.openings||[]).find(o=>o.id===primaryEl.id)
  const primaryDistLines=useMemo(()=>primaryIsRect&&showMeas?axisDistances(primaryEl,floor.walls||[]):[]
  ,[primaryEl,primaryIsRect,showMeas,floor.walls])

  useEffect(()=>{
    const el=svgRef.current;if(!el)return
    const fn=e=>{e.preventDefault();const delta=e.deltaY>0?0.9:1.1;const nz=Math.min(7,Math.max(0.1,zoom*delta));const rect=el.getBoundingClientRect();const mx=e.clientX-rect.left,my=e.clientY-rect.top;setPan(p=>({x:mx-(mx-p.x)*(nz/zoom),y:my-(my-p.y)*(nz/zoom)}));setZoom(nz)}
    el.addEventListener('wheel',fn,{passive:false});return()=>el.removeEventListener('wheel',fn)
  },[zoom])

  useEffect(()=>{
    const dn=e=>{
      if(e.code==='Space'){spaceDown.current=true;e.preventDefault()}
      if(e.code==='Escape'){setDrawing(null);setPlacingOp(null);setSelectedIds(new Set());setBoxSel(null);setOpenMenu(null);setNavDetail(null);setDrawingAnalysis(null)}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey){e.preventDefault();undo();return}
      if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.key.toLowerCase()==='z'&&e.shiftKey))){e.preventDefault();redo();return}
      if(e.key==='Delete'&&selectedIds.size>0){
        const ids=selectedIds
        updateFloor(f=>({...f,
          walls:(f.walls||[]).filter(w=>!ids.has(w.id)),
          openings:(f.openings||[]).filter(o=>!ids.has(o.id)),
          appliances:(f.appliances||[]).filter(a=>!ids.has(a.id)),
          furniture:(f.furniture||[]).filter(fu=>!ids.has(fu.id)),
          sensors:(f.sensors||[]).filter(s=>!ids.has(s.id)),
          stairs:(f.stairs||[]).filter(s=>!ids.has(s.id)),
        }))
        setSelectedIds(new Set())
      }
    }
    const up=e=>{if(e.code==='Space')spaceDown.current=false}
    window.addEventListener('keydown',dn);window.addEventListener('keyup',up)
    return()=>{window.removeEventListener('keydown',dn);window.removeEventListener('keyup',up)}
  },[selectedIds,updateFloor,undo,redo])

  function interactStart(cx,cy,target,shiftKey){
    if(mode==='navigate')return
    const{x,y}=getWorld(cx,cy)
    if(tool==='wall'){setDrawing({x1:x,y1:y,x2:x,y2:y});return}
    if(tool==='stairs'){const c=getCenter();updateFloor(f=>({...f,stairs:[...(f.stairs||[]),{id:mkId(),x:c.x-30,y:c.y-50,w:60,h:100,direction:'up',stepCount:8}]}));return}
    const isOpTool=['door-hinged','door-sliding','window-fixed','window-sliding','window-casement'].includes(tool)
    if(isOpTool){
      let nearest=null,minD=28/zoom
      for(const w of floor.walls){const dx=w.x2-w.x1,dy=w.y2-w.y1,l2=dx*dx+dy*dy;const t=l2?Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/l2)):0;const dist=d2(x,y,w.x1+t*dx,w.y1+t*dy);if(dist<minD){minD=dist;nearest={wall:w,t}}}
      if(nearest)setPlacingOp({wallId:nearest.wall.id,startT:nearest.t,endT:nearest.t,type:tool})
      return
    }
    if(tool==='select'&&(target===svgRef.current||target?.dataset?.bg)){
      if(!shiftKey){setSelectedIds(new Set());setNavDetail(null);const{x:rx,y:ry}=getWorld(cx,cy,false);setBoxSel({x1:rx,y1:ry,x2:rx,y2:ry})}
    }
  }

  function interactMove(cx,cy){
    if(isPanning.current&&panStart.current){setPan({x:panStart.current.pan.x+(cx-panStart.current.cx),y:panStart.current.pan.y+(cy-panStart.current.cy)});return}

    if(wallEpDrag){
      const{x,y}=getWorld(cx,cy)
      updateFloor(f=>({...f,walls:f.walls.map(w=>w.id===wallEpDrag.wallId?{...w,...(wallEpDrag.ep==='start'?{x1:x,y1:y}:{x2:x,y2:y})}:w)}))
      return
    }

    if(opDrag){
      const{x,y}=getWorld(cx,cy,false)
      const wall=floor.walls?.find(w=>w.id===opDrag.op.wallId);if(!wall)return
      const{ux,uy,len}=wallUV(wall)
      const t=Math.max(0,Math.min(1,((x-wall.x1)*ux+(y-wall.y1)*uy)/len))
      if(opDrag.handle==='move'){
        updateFloor(f=>({...f,openings:f.openings.map(o=>o.id===opDrag.op.id?{...o,t}:o)}))
      } else {
        const curT=opDrag.op.t
        const dt=Math.abs(t-curT)
        const newWidth=Math.max(cmToPx(20),Math.min(dt*2*len,len*0.85))
        updateFloor(f=>({...f,openings:f.openings.map(o=>o.id===opDrag.op.id?{...o,width:newWidth}:o)}))
      }
      return
    }

    if(resizing){
      const{x,y}=getWorld(cx,cy,false)
      if(resizing.rotating){
        const angle=Math.atan2(y-resizing.cy,x-resizing.cx),delta=(angle-resizing.startAngle)*180/Math.PI
        const newRot=Math.round(((resizing.startRot+delta)%360+360)%360)
        updateFloor(f=>({...f,appliances:f.appliances.map(a=>a.id===resizing.id?{...a,rotation:newRot}:a),furniture:f.furniture.map(fu=>fu.id===resizing.id?{...fu,rotation:newRot}:fu)}))
        return
      }
      const dx=x-resizing.startX,dy=y-resizing.startY,{handle,origEl}=resizing
      let{x:ex,y:ey,w,h}=origEl
      if(handle.includes('e'))w=Math.max(10,origEl.w+dx)
      if(handle.includes('w')){ex=origEl.x+dx;w=Math.max(10,origEl.w-dx)}
      if(handle.includes('s'))h=Math.max(10,origEl.h+dy)
      if(handle.includes('n')){ey=origEl.y+dy;h=Math.max(10,origEl.h-dy)}
      if(snapOn){ex=snapG(ex,GRID_PX);ey=snapG(ey,GRID_PX);w=snapG(w,GRID_PX)||10;h=snapG(h,GRID_PX)||10}
      updateFloor(f=>({...f,appliances:f.appliances.map(a=>a.id===resizing.id?{...a,x:ex,y:ey,w,h}:a),furniture:f.furniture.map(fu=>fu.id===resizing.id?{...fu,x:ex,y:ey,w,h}:fu)}))
      return
    }

    if(drawing){
      let{x,y}=getWorld(cx,cy)
      setDrawing(d=>({...d,x2:x,y2:y}));return
    }

    if(placingOp){
      const{x,y}=getWorld(cx,cy,false)
      const wall=floor.walls?.find(w=>w.id===placingOp.wallId)
      if(wall){const dx=wall.x2-wall.x1,dy=wall.y2-wall.y1,l2=dx*dx+dy*dy;const t=l2?Math.max(0,Math.min(1,((x-wall.x1)*dx+(y-wall.y1)*dy)/l2)):0;setPlacingOp(op=>({...op,endT:t}))}
      return
    }

    if(boxSel){const{x,y}=getWorld(cx,cy,false);setBoxSel(b=>({...b,x2:x,y2:y}));return}

    if(dragging){
      const{x,y}=getWorld(cx,cy)
      updateFloor(f=>({...f,appliances:f.appliances.map(a=>a.id===dragging.id?{...a,x:x-dragging.ox,y:y-dragging.oy}:a),furniture:f.furniture.map(fu=>fu.id===dragging.id?{...fu,x:x-dragging.ox,y:y-dragging.oy}:fu),sensors:f.sensors.map(s=>s.id===dragging.id?{...s,x,y}:s),stairs:f.stairs.map(s=>s.id===dragging.id?{...s,x:x-dragging.ox,y:y-dragging.oy}:s)}))
      return
    }

    const isOpTool=['door-hinged','door-sliding','window-fixed','window-sliding','window-casement'].includes(tool)
    if(isOpTool){
      const{x,y}=getWorld(cx,cy,false)
      let near=null,md=22/zoom
      for(const w of floor.walls){const dx=w.x2-w.x1,dy=w.y2-w.y1,l2=dx*dx+dy*dy;const t=l2?Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/l2)):0;const dist=d2(x,y,w.x1+t*dx,w.y1+t*dy);if(dist<md){md=dist;near=w.id}}
      setHovWall(near)
    }else setHovWall(null)
  }

  function interactEnd(cx,cy){
    if(isPanning.current){isPanning.current=false;panStart.current=null;return}
    if(wallEpDrag){setWallEpDrag(null);return}
    if(opDrag){setOpDrag(null);return}
    if(resizing){setResizing(null);return}

    if(drawing&&tool==='wall'){
      if(d2(drawing.x1,drawing.y1,drawing.x2,drawing.y2)>GRID_PX){
        updateFloor(f=>({...f,walls:[...(f.walls||[]),{id:mkId(),x1:drawing.x1,y1:drawing.y1,x2:drawing.x2,y2:drawing.y2,thickness:floor.wallThickness||10}]}))
      }
      setDrawing(null)
    }

    if(placingOp){
      const wall=floor.walls?.find(w=>w.id===placingOp.wallId)
      if(wall){const{len}=wallUV(wall);const s=Math.min(placingOp.startT,placingOp.endT),e2=Math.max(placingOp.startT,placingOp.endT);const width=Math.max(20,Math.min((e2-s)*len,len*0.85));if(width>15)updateFloor(f=>({...f,openings:[...(f.openings||[]),{id:mkId(),wallId:placingOp.wallId,t:(s+e2)/2,width,type:placingOp.type,opensLeft:false}]}))}
      setPlacingOp(null)
    }

    if(boxSel){
      const minX=Math.min(boxSel.x1,boxSel.x2||boxSel.x1),maxX=Math.max(boxSel.x1,boxSel.x2||boxSel.x1)
      const minY=Math.min(boxSel.y1,boxSel.y2||boxSel.y1),maxY=Math.max(boxSel.y1,boxSel.y2||boxSel.y1)
      if(Math.abs(maxX-minX)>8&&Math.abs(maxY-minY)>8){
        const ids=new Set()
        for(const a of floor.appliances||[])if(a.x>=minX&&a.x+a.w<=maxX&&a.y>=minY&&a.y+a.h<=maxY)ids.add(a.id)
        for(const f2 of floor.furniture||[])if(f2.x>=minX&&f2.x+f2.w<=maxX&&f2.y>=minY&&f2.y+f2.h<=maxY)ids.add(f2.id)
        for(const s of floor.sensors||[])if(s.x>=minX&&s.x<=maxX&&s.y>=minY&&s.y<=maxY)ids.add(s.id)
        setSelectedIds(ids)
      } else if(showIAQ&&sampleAt){
        const s=sampleAt(boxSel.x1,boxSel.y1)
        setStaticCursor({x:boxSel.x1,y:boxSel.y1,value:s?s.value:null})
        if(s){
          const near=nearestSensor(floor,boxSel.x1,boxSel.y1,Infinity)
          if(near)setNavDetail(near)
        }
      }
      setBoxSel(null);return
    }
    setDragging(null)
  }

  function onMouseDown(e){
    if(e.button===1||(e.button===0&&spaceDown.current)){isPanning.current=true;panStart.current={cx:e.clientX,cy:e.clientY,pan};return}
    if(mode==='navigate'){
      if (drawingAnalysis && e.button===0) {
        const{x,y}=getWorld(e.clientX,e.clientY,false)
        setDrawingAnalysis({x0:x,y0:y,x1:x,y1:y,active:true})
        return
      }
      if(e.button===0&&showIAQ&&sampleAt&&(e.target===svgRef.current||e.target?.dataset?.bg)){
        const{x,y}=getWorld(e.clientX,e.clientY,false)
        const s=sampleAt(x,y)
        setStaticCursor({x,y,value:s?s.value:null})
        if(s){
          const near=nearestSensor(floor,x,y,Infinity)
          if(near)setNavDetail(near)
        }
      }
      return
    }
    interactStart(e.clientX,e.clientY,e.target,e.shiftKey)
  }
  function sampleMouseAt(cx,cy){
    heatCursorPending.current={cx,cy}
    if(heatCursorRAF.current)return
    heatCursorRAF.current=requestAnimationFrame(()=>{
      heatCursorRAF.current=null
      const p=heatCursorPending.current
      if(!p)return
      const{x,y}=getWorld(p.cx,p.cy,false)
      setHoverDetail(hitTestElement(floor,x,y))
      if(showIAQ&&sampleAt){
        const s=sampleAt(x,y)
        setHeatCursor(s?{x,y,screenX:p.cx,screenY:p.cy,value:s.value}:null)
      }
    })
  }
  function onMouseMove(e){
    if(isPanning.current&&panStart.current){setPan({x:panStart.current.pan.x+(e.clientX-panStart.current.cx),y:panStart.current.pan.y+(e.clientY-panStart.current.cy)});return}
    if (drawingAnalysis?.active) {
      const{x,y}=getWorld(e.clientX,e.clientY,false)
      setDrawingAnalysis(d=>({...d,x1:x,y1:y}))
      return
    }
    sampleMouseAt(e.clientX,e.clientY)
    if(drawing&&e.shiftKey){
      const{x,y}=getWorld(e.clientX,e.clientY)
      const dx2=x-drawing.x1,dy2=y-drawing.y1
      const ang=Math.round(Math.atan2(dy2,dx2)/(Math.PI/4))*(Math.PI/4)
      const len=Math.sqrt(dx2*dx2+dy2*dy2)
      setDrawing(d=>({...d,x2:snapG(drawing.x1+Math.cos(ang)*len,GRID_PX),y2:snapG(drawing.y1+Math.sin(ang)*len,GRID_PX)}))
      return
    }
    interactMove(e.clientX,e.clientY)
  }
  function onMouseUp(e){
    if (drawingAnalysis?.active) {
      const {x0,y0,x1,y1} = drawingAnalysis
      // Magnétisme sur les murs existants pour les 2 coins — aide à aligner le
      // rectangle sur les limites réelles d'une pièce sans détection de contour.
      const corner1 = snapObstacles(x0,y0,floor.walls||[],[],30)
      const corner2 = snapObstacles(x1,y1,floor.walls||[],[],30)
      const rect = { x0:Math.min(corner1.x,corner2.x), y0:Math.min(corner1.y,corner2.y), x1:Math.max(corner1.x,corner2.x), y1:Math.max(corner1.y,corner2.y) }
      if (rect.x1-rect.x0 > 10 && rect.y1-rect.y0 > 10) {
        setAnalysisRects(prev => [...prev, {...rect, id: mkId()}])
      }
      setDrawingAnalysis(null)
      return
    }
    interactEnd(e.clientX,e.clientY)
  }

  function onTouchStart(e){
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY
      const cx=(e.touches[0].clientX+e.touches[1].clientX)/2
      const cy=(e.touches[0].clientY+e.touches[1].clientY)/2
      const rect=svgRef.current?.getBoundingClientRect()
      const worldX = rect ? ((cx-rect.left)-pan.x)/zoom : 0
      const worldY = rect ? ((cy-rect.top)-pan.y)/zoom : 0
      pinchRef.current={d0:Math.hypot(dx,dy),zoom0:zoom,worldX,worldY}
      isPanning.current=false;return
    }
    pinchRef.current=null
    const t=e.touches[0]
    if(mode==='navigate'){
      if (drawingAnalysis) {
        const{x,y}=getWorld(t.clientX,t.clientY,false)
        setDrawingAnalysis({x0:x,y0:y,x1:x,y1:y,active:true})
        return
      }
      isPanning.current=false
    } else {
      isPanning.current=false
      interactStart(t.clientX,t.clientY,e.target,false)
    }
  }
  function onTouchMove(e){
    if(e.touches.length===2&&pinchRef.current){
      const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY
      const dist=Math.hypot(dx,dy)
      const rect=svgRef.current?.getBoundingClientRect()
      if(rect){
        const {d0,zoom0,worldX,worldY}=pinchRef.current
        const nz=Math.min(7,Math.max(0.1, zoom0*(dist/d0)))
        const newCx=(e.touches[0].clientX+e.touches[1].clientX)/2 - rect.left
        const newCy=(e.touches[0].clientY+e.touches[1].clientY)/2 - rect.top
        setZoom(nz)
        setPan({ x:newCx-worldX*nz, y:newCy-worldY*nz })
      }
      return
    }
    if(e.touches.length===1){
      if (drawingAnalysis?.active) {
        const{x,y}=getWorld(e.touches[0].clientX,e.touches[0].clientY,false)
        setDrawingAnalysis(d=>({...d,x1:x,y1:y}))
        return
      }
      sampleMouseAt(e.touches[0].clientX,e.touches[0].clientY);interactMove(e.touches[0].clientX,e.touches[0].clientY)
    }
  }
  function onTouchEnd(e){
    pinchRef.current=null
    if (drawingAnalysis?.active) {
      const {x0,y0,x1,y1} = drawingAnalysis
      const corner1 = snapObstacles(x0,y0,floor.walls||[],[],30)
      const corner2 = snapObstacles(x1,y1,floor.walls||[],[],30)
      const rect = { x0:Math.min(corner1.x,corner2.x), y0:Math.min(corner1.y,corner2.y), x1:Math.max(corner1.x,corner2.x), y1:Math.max(corner1.y,corner2.y) }
      if (rect.x1-rect.x0 > 10 && rect.y1-rect.y0 > 10) {
        setAnalysisRects(prev => [...prev, {...rect, id: mkId()}])
      }
      setDrawingAnalysis(null)
      isPanning.current=false;panStart.current=null
      return
    }
    interactEnd(e.changedTouches[0]?.clientX||0,e.changedTouches[0]?.clientY||0)
    isPanning.current=false;panStart.current=null
  }

  function selectEl(el,e){
    if(mode==='navigate'){setNavDetail(el);return}
    if(el.deviceId){setNavDetail(el)}
    if(e?.shiftKey)setSelectedIds(ids=>{const n=new Set(ids);n.has(el.id)?n.delete(el.id):n.add(el.id);return n})
    else setSelectedIds(new Set([el.id]))
  }
  function eraseEl(id){
    updateFloor(f=>({...f,walls:(f.walls||[]).filter(w=>w.id!==id),openings:(f.openings||[]).filter(o=>o.wallId!==id&&o.id!==id),appliances:(f.appliances||[]).filter(a=>a.id!==id),furniture:(f.furniture||[]).filter(fu=>fu.id!==id),sensors:(f.sensors||[]).filter(s=>s.id!==id),stairs:(f.stairs||[]).filter(s=>s.id!==id)}))
    setSelectedIds(ids=>{const n=new Set(ids);n.delete(id);return n})
  }
  function eraseOpening(id){updateFloor(f=>({...f,openings:(f.openings||[]).filter(o=>o.id!==id)}));setSelectedIds(ids=>{const n=new Set(ids);n.delete(id);return n})}
  function updateElement(el){
    if((floor.walls||[]).find(w=>w.id===el.id)){
      const newThick=el.thickness
      updateFloor(f=>({...f,wallThickness:newThick,walls:f.walls.map(w=>w.id===el.id?el:{...w,thickness:newThick})}))
    } else {
      updateFloor(f=>({...f,appliances:f.appliances.map(a=>a.id===el.id?el:a),furniture:f.furniture.map(fu=>fu.id===el.id?el:fu),sensors:f.sensors.map(s=>s.id===el.id?el:s),stairs:f.stairs.map(s=>s.id===el.id?el:s),openings:f.openings.map(o=>o.id===el.id?el:o)}))
    }
  }
  const primaryElRef=useRef(primaryEl)
  useEffect(()=>{primaryElRef.current=primaryEl},[primaryEl])
  function nudgeElement(dx,dy){
    const el=primaryElRef.current
    if(!el)return
    const step=cmToPx(1)
    updateElement({...el,x:(el.x||0)+dx*step,y:(el.y||0)+dy*step})
  }
  function startDrag(e,el,isPoint){
    if(tool!=='select'||mode!=='edit')return
    const{x,y}=getWorld(e.clientX,e.clientY)
    setDragging({id:el.id,ox:isPoint?0:x-(el.x||0),oy:isPoint?0:y-(el.y||0)})
  }
  function startHandleDown(e,handle,el){
    const{x,y}=getWorld(e.clientX,e.clientY,false)
    const corners=['nw','ne','se','sw']
    if(corners.includes(handle)&&(e.altKey||e.metaKey)){setResizing({rotating:true,id:el.id,origEl:{...el},cx:el.x+el.w/2,cy:el.y+el.h/2,startAngle:Math.atan2(y-(el.y+el.h/2),x-(el.x+el.w/2)),startRot:el.rotation||0})}
    else{setResizing({id:el.id,handle,origEl:{...el},startX:x,startY:y})}
  }
  function startWallEndpointDown(e,wall,ep){
    setWallEpDrag({wallId:wall.id,ep})
    setSelectedIds(new Set([wall.id]))
  }
  function startOpHandleDown(e,op,handle){
    setOpDrag({op:{...op},handle})
    setSelectedIds(new Set([op.id]))
  }

  function addAppliance(){const lbl=prompt('Name:');if(!lbl)return;const watts=parseInt(prompt('Watts:','100')||'0');const c=getCenter();updateFloor(f=>({...f,appliances:[...(f.appliances||[]),{id:mkId(),x:c.x-50,y:c.y-30,w:100,h:60,label:lbl,watts,sensorId:null,rotation:0,color:'#378ADD'}]}))}
  function addFurniture(){const lbl=prompt('Name:');if(!lbl)return;const c=getCenter();updateFloor(f=>({...f,furniture:[...(f.furniture||[]),{id:mkId(),x:c.x-60,y:c.y-40,w:120,h:80,label:lbl,type:'other',rotation:0,opacity:0.5,color:'#7F77DD'}]}))}
  function addSensor(){const devId=prompt('Device ID:');if(!devId)return;const metrics=(prompt('Metrics:','temperature,humidity,co2')||'').split(',').map(s=>s.trim()).filter(Boolean);const c=getCenter();updateFloor(f=>({...f,sensors:[...(f.sensors||[]),{id:mkId(),x:c.x,y:c.y,deviceId:devId,label:devId.slice(-6),metrics,radius:100}]}))}

  function placeDetectedSensor(deviceId){
    const c=getCenter()
    const availableMetrics=Object.keys(deviceReadings[deviceId]||{}).filter(k=>['temperature','humidity','co2','lux','iaq','pressure'].includes(k))
    updateFloor(f=>({...f,sensors:[...(f.sensors||[]),{id:mkId(),x:c.x,y:c.y,deviceId,label:deviceId.slice(-6),metrics:availableMetrics.length?availableMetrics:['temperature'],radius:100}]}))
  }

  const niceCms=[10,20,50,100,200,500,1000,2000]
  const scaleCm=niceCms.find(c=>c/CM_PER_PX*zoom>=80)||1000
  const scaleBarPx=scaleCm/CM_PER_PX*zoom
  const scaleLabel=scaleCm>=100?`${scaleCm/100}m`:`${scaleCm}cm`

  const syncMeta={synced:{c:'var(--ok)',l:'Synced'},syncing:{c:'var(--warn)',l:'Saving…'},offline:{c:'var(--danger)',l:'Local only'},loading:{c:'var(--text3)',l:'…'}}[syncStatus]||{}

  const placingPreview=placingOp&&(()=>{
    const wall=floor.walls?.find(w=>w.id===placingOp.wallId);if(!wall)return null
    const{ux,uy,len}=wallUV(wall),s=Math.min(placingOp.startT,placingOp.endT),e2=Math.max(placingOp.startT,placingOp.endT)
    const x1=wall.x1+ux*s*len,y1=wall.y1+uy*s*len,x2=wall.x1+ux*e2*len,y2=wall.y1+uy*e2*len,pxW=d2(x1,y1,x2,y2)
    return(<g style={{pointerEvents:'none'}}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={wall.thickness||10} strokeLinecap="square" opacity="0.75"/>
      {pxW>10&&<><rect x={(x1+x2)/2-26} y={(y1+y2)/2-9} width={52} height={16} rx="3" fill="rgba(0,0,0,.8)"/><text x={(x1+x2)/2} y={(y1+y2)/2+1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="white" fontFamily="monospace">{fmtDist(pxW)}</text></>}
    </g>)
  })()

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

      <div style={{padding:'var(--sp-2) var(--sp-3)',borderBottom:'0.5px solid var(--border)',display:'flex',gap:4,alignItems:'center',flexWrap:'wrap',flexShrink:0,background:'var(--bg)'}}>

        <button onClick={()=>setShowSidebar(s=>!s)} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-sm)',border:'0.5px solid var(--border)',background:showSidebar?'var(--bg3)':'var(--bg2)',color:'var(--text2)',cursor:'pointer'}}>☰</button>

        <button onClick={()=>setMode(m=>{const next=m==='edit'?'navigate':'edit';setEditorMode(next);return next})} className="hp-focus-visible"
          style={{padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-sm)',cursor:'pointer',border:'none',background:mode==='navigate'?'var(--info)':'var(--accent-vivid)',color:'#fff',fontWeight:700}}>
          {mode==='navigate'?'🧭 Navigate':'✏️ Edit'}
        </button>

        {mode==='edit'&&<>
          <div style={{width:1,height:22,background:'var(--border)',flexShrink:0}}/>
          <ToolMenu tool={tool} setTool={setTool} openMenu={openMenu} setOpenMenu={setOpenMenu}/>
          {[['select','↖ Select'],['erase','✕ Erase']].map(([t2,l])=>(
            <button key={t2} onClick={()=>{setTool(t2);setOpenMenu(null)}} className="hp-focus-visible" style={{padding:'var(--sp-2) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-sm)',cursor:'pointer',border:tool===t2?'none':'0.5px solid var(--border)',background:tool===t2?'var(--accent-vivid)':'var(--bg2)',color:tool===t2?'#fff':'var(--text2)'}}>{l}</button>
          ))}
          <div style={{width:1,height:22,background:'var(--border)',flexShrink:0}}/>
          <button onClick={addAppliance} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--accent-vivid)'}}>+ Appl</button>
          <button onClick={addFurniture} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--info)'}}>+ Furn</button>
          <button onClick={addSensor}    className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--ok)'}}>+ Sensor</button>
          <div style={{width:1,height:22,background:'var(--border)',flexShrink:0}}/>
          {[
            ['Grid',showGrid, ()=>setEditorSetting('showGrid',         !showGrid)],
            ['Snap',snapOn,   ()=>setEditorSetting('snapEnabled',       !snapOn)],
            ['Dim', showMeas, ()=>setEditorSetting('showMeasurements',  !showMeas)],
          ].map(([l,v,fn])=>(
            <button key={l} onClick={fn} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',fontFamily:'var(--mono)',fontWeight:600,border:v?'none':'0.5px solid var(--border)',background:v?'var(--accent-soft)':'transparent',color:v?'var(--accent-vivid)':'var(--text3)'}}>{l}</button>
          ))}
          <div style={{display:'flex',alignItems:'center',gap:3}}>
            <span style={{fontSize:'var(--fs-xs)',color:'var(--text3)'}}>⊞</span>
            <input type="number" value={gridCm} min="5" max="500" step="5" onChange={e=>setGridCm(Math.max(5,parseInt(e.target.value)||20))} style={{width:52,padding:'3px 6px',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',outline:'none'}}/>
            <span style={{fontSize:'var(--fs-xs)',color:'var(--text3)'}}>cm</span>
          </div>
        </>}

        {mode==='navigate'&&<span style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginLeft:4}}>Click elements to view details · Two fingers to zoom/pan</span>}

        {mode==='navigate'&&(
          <button onClick={()=>{setDrawingAnalysis(d=>d===null?{}:null)}} className="hp-focus-visible" style={{
            padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',
            border:drawingAnalysis!==null?'none':'0.5px solid var(--border)',
            background:drawingAnalysis!==null?'var(--accent-vivid)':'transparent',color:drawingAnalysis!==null?'#fff':'var(--text3)',
          }}>▦ Analyser une zone</button>
        )}

        <button onClick={()=>setShowLayers(l=>!l)} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',cursor:'pointer',border:showLayers?'none':'0.5px solid var(--border)',background:showLayers?'color-mix(in srgb, var(--warn) 20%, transparent)':'transparent',color:showLayers?'var(--warn)':'var(--text3)'}}>Layers</button>

        <div style={{display:'flex',gap:4,alignItems:'center',marginLeft:'auto'}}>
          <button onClick={undo} disabled={!canUndoNow} title="Annuler (Ctrl+Z)" className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:canUndoNow?'var(--text2)':'var(--text3)',cursor:canUndoNow?'pointer':'default',opacity:canUndoNow?1:.45}}>↶</button>
          <button onClick={redo} disabled={!canRedoNow} title="Rétablir (Ctrl+Y)" className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:canRedoNow?'var(--text2)':'var(--text3)',cursor:canRedoNow?'pointer':'default',opacity:canRedoNow?1:.45}}>↷</button>
          <button onClick={fitToContent} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer'}}>⊡ Fit</button>
          <button onClick={()=>setZoom(z=>Math.max(0.1,z-0.25))} className="hp-focus-visible" style={{padding:'3px var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-md)'}}>−</button>
          <span style={{fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',color:'var(--text3)',minWidth:42,textAlign:'center'}}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>Math.min(7,z+0.25))} className="hp-focus-visible" style={{padding:'3px var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-md)'}}>+</button>
          <button onClick={()=>setShowEdSet(s=>!s)} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',border:'0.5px solid var(--border)',background:showEdSet?'var(--bg3)':'transparent',color:'var(--text3)',cursor:'pointer'}}>⚙</button>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:syncMeta.c}}/>
          <span style={{fontSize:'var(--fs-xs)',color:syncMeta.c,fontFamily:'var(--mono)',fontWeight:600}}>{syncMeta.l}</span>
        </div>
      </div>

      <div style={{padding:'3px var(--sp-3)',fontSize:'var(--fs-xs)',color:'var(--text3)',borderBottom:'0.5px solid var(--border)',flexShrink:0,background:'var(--bg)'}}>
        {mode==='navigate'?(drawingAnalysis!==null?'Dessine un rectangle sur le plan pour analyser cette zone':'Navigate — tap elements for details · Two fingers to pan/zoom')
        :tool==='select'?'Select · Shift+click multi-select · Drag empty area = box select · Del to erase · Alt+drag corner = rotate'
        :tool==='wall'  ?`Drag to draw wall · Shift = angle snap · ${gridCm}cm grid`
        :['door-hinged','door-sliding'].includes(tool)?'Click wall, drag to set door width'
        :['window-fixed','window-sliding','window-casement'].includes(tool)?'Click wall, drag to set window width'
        :tool==='erase' ?'Click any element to erase (openings delete independently from wall)':''}
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        <div ref={canvasWrapRef} style={{flex:1,position:'relative',overflow:'hidden'}}>

          {showSidebar&&(
            <Movable posKey="widget-structure" defaultPos={{x:16,y:16}} containerRef={canvasWrapRef} approxW={200} approxH={260}>
              <RetractableWidget widgetKey="structure" title="Structure" width={200}>
                <HierarchySidebar db={db} save={save} sel={sel} setSel={setSel}/>
                {mode==='edit'&&unplacedSensors.length>0&&(
                  <div style={{padding:'var(--sp-2) var(--sp-3)',borderTop:'0.5px solid var(--border)'}}>
                    <div className="hp-eyebrow" style={{marginBottom:'var(--sp-2)'}}>Capteurs non placés ({unplacedSensors.length})</div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {unplacedSensors.map(devId=>(
                        <button key={devId} onClick={()=>placeDetectedSensor(devId)} className="hp-focus-visible" style={{
                          display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,
                          padding:'var(--sp-2) var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',
                          background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',
                        }}>
                          <span style={{display:'flex',alignItems:'center',gap:6,overflow:'hidden'}}>
                            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--ok)',flexShrink:0}}/>
                            <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{devId}</span>
                          </span>
                          <span style={{color:'var(--accent-vivid)',fontWeight:700,flexShrink:0}}>+ placer</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </RetractableWidget>
            </Movable>
          )}

          {showLayers&&(
            <Movable posKey="widget-layers" defaultPos={{x:16,y:290}} containerRef={canvasWrapRef} approxW={200} approxH={220}>
              <RetractableWidget widgetKey="layers" title="Layers" width={200} onCloseAll={()=>setShowLayers(false)}>
                <LayersPanel showAppl={showAppl} setShowAppl={setShowAppl} showFurn={showFurn} setShowFurn={setShowFurn} showSens={showSens} setShowSens={setShowSens} showIAQ={showIAQ} setShowIAQ={setShowIAQ} showRel={showRel} setShowRel={setShowRel} iaqMet={iaqMet} setIaqMet={setIaqMet} heatmapMode={heatmapMode} setHeatmapMode={setHeatmapMode}/>
              </RetractableWidget>
            </Movable>
          )}

          {showEdSet&&(
            <Movable posKey="widget-edsettings" defaultPos={{x:230,y:16}} containerRef={canvasWrapRef} approxW={200} approxH={280}>
              <RetractableWidget widgetKey="edsettings" title="Editor Settings" width={200} onCloseAll={()=>setShowEdSet(false)}>
                <div style={{padding:'var(--sp-2) var(--sp-3)'}}>
                  <div style={{marginBottom:'var(--sp-2)'}}>
                    <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:4}}>Wall thickness (cm) — all walls</div>
                    <input type="number" min="5" max="60" step="5" value={pxToCm(floor?.wallThickness||10)}
                      onChange={e=>{const v=Math.max(5,parseFloat(e.target.value)||10),px=cmToPx(v);updateFloor(f=>({...f,wallThickness:px,walls:(f.walls||[]).map(w=>({...w,thickness:px}))}))}}
                      style={{width:'100%',padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',outline:'none'}}/>
                  </div>
                  <div style={{marginBottom:'var(--sp-3)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:4}}>
                      <span>Grid (cm)</span><span style={{fontFamily:'var(--mono)',color:'var(--text2)'}}>{gridCm}cm</span>
                    </div>
                    <input type="range" min="5" max="200" step="5" value={Math.min(gridCm,200)} onChange={e=>setGridCm(parseInt(e.target.value))}
                      style={{width:'100%',marginBottom:6,accentColor:'var(--accent-vivid)'}}/>
                    <input type="number" min="5" max="500" step="5" value={gridCm} onChange={e=>setGridCm(Math.max(5,parseInt(e.target.value)||20))} style={{width:'100%',padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:'var(--fs-xs)',fontFamily:'var(--mono)',outline:'none'}}/>
                  </div>
                  {[['Snap',snapOn,'snapEnabled'],['Measurements',showMeas,'showMeasurements'],['Grid',showGrid,'showGrid']].map(([l,v,k])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-2)'}}>
                      <span style={{fontSize:'var(--fs-sm)',color:'var(--text2)'}}>{l}</span>
                      <button onClick={()=>setEditorSetting(k,!v)} className="hp-focus-visible" style={{padding:'3px var(--sp-2)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',fontWeight:600,cursor:'pointer',border:v?'none':'0.5px solid var(--border)',background:v?'var(--accent-vivid)':'transparent',color:v?'#fff':'var(--text3)'}}>{v?'ON':'OFF'}</button>
                    </div>
                  ))}
                </div>
              </RetractableWidget>
            </Movable>
          )}

          <svg ref={svgRef} width="100%" height="100%"
            style={{display:'block',cursor:spaceDown.current||isPanning.current?'grabbing':mode==='navigate'?(drawingAnalysis!==null?'crosshair':'grab'):tool==='wall'?'crosshair':'default',background:'var(--bg)',touchAction:'none'}}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onPointerMove={e=>{if(e.pointerType==='mouse')sampleMouseAt(e.clientX,e.clientY)}}
            onMouseLeave={()=>{setDragging(null);isPanning.current=false;setPlacingOp(null);setResizing(null);setWallEpDrag(null);setOpDrag(null);setHeatCursor(null);setHoverDetail(null);if(heatCursorRAF.current){cancelAnimationFrame(heatCursorRAF.current);heatCursorRAF.current=null}}}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>

            {showGrid&&<>
              <defs>
                <pattern id="fp-fg" width={GRID_PX*zoom} height={GRID_PX*zoom} patternUnits="userSpaceOnUse" x={pan.x%(GRID_PX*zoom)} y={pan.y%(GRID_PX*zoom)}>
                  <path d={`M ${GRID_PX*zoom} 0 L 0 0 0 ${GRID_PX*zoom}`} fill="none" stroke="var(--text)" strokeWidth="0.2" opacity="0.6"/>
                </pattern>
                <pattern id="fp-mg" width={GRID_MAJOR*zoom} height={GRID_MAJOR*zoom} patternUnits="userSpaceOnUse" x={pan.x%(GRID_MAJOR*zoom)} y={pan.y%(GRID_MAJOR*zoom)}>
                  <path d={`M ${GRID_MAJOR*zoom} 0 L 0 0 0 ${GRID_MAJOR*zoom}`} fill="none" stroke="var(--text)" strokeWidth="0.6" opacity="0.4"/>
                </pattern>
              </defs>
              <rect data-bg="1" width="100%" height="100%" fill="url(#fp-fg)"/>
              <rect data-bg="1" width="100%" height="100%" fill="url(#fp-mg)"/>
            </>}

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              <rect data-bg="1" x={-99999} y={-99999} width={199998} height={199998} fill="transparent"/>

              {showIAQ&&colorUrl&&<>
                <image href={colorUrl} x={hmX0} y={hmY0} width={hmW} height={hmH} style={{pointerEvents:'none'}}/>
              </>}
              {showIAQ&&showRel&&confUrl&&<image href={confUrl} x={hmX0} y={hmY0} width={hmW} height={hmH} style={{pointerEvents:'none'}}/>}

              {showFurn&&(floor.furniture||[]).map(f=><FurnitureEl key={f.id} f={f} isSelected={selectedIds.has(f.id)} tool={tool} onSelect={selectEl} onStartDrag={startDrag} onErase={eraseEl}/>)}

              <WallLayer walls={floor.walls||[]} openings={floor.openings||[]} selectedIds={selectedIds} tool={tool}
                onWallClick={(w,e)=>{if(tool==='erase')eraseEl(w.id);else selectEl(w,e)}}
                onOpeningClick={eraseOpening} onOpeningSelect={selectEl}/>

              {primaryWall&&tool==='select'&&mode==='edit'&&<WallHandles wall={primaryWall} onEndpointDown={startWallEndpointDown}/>}

              {primaryOp&&tool==='select'&&mode==='edit'&&<OpeningHandles op={primaryOp} wall={(floor.walls||[]).find(w=>w.id===primaryOp.wallId)} onHandleDown={startOpHandleDown}/>}

              {hovWall&&(()=>{const w=floor.walls?.find(w=>w.id===hovWall);if(!w)return null;return<line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="var(--accent)" strokeWidth={(w.thickness||10)+8} opacity="0.3" strokeLinecap="square" style={{pointerEvents:'none'}}/>})()}

              {placingPreview}

              {(floor.stairs||[]).map(s=><StairsEl key={s.id} s={s} isSelected={selectedIds.has(s.id)} tool={tool} onSelect={selectEl} onErase={eraseEl}/>)}
              {showAppl&&(floor.appliances||[]).map(a=><ApplianceEl key={a.id} a={a} isSelected={selectedIds.has(a.id)} tool={tool} onSelect={selectEl} onStartDrag={startDrag} onErase={eraseEl}/>)}
              {showSens&&(floor.sensors||[]).map(s=><SensorEl key={s.id} s={s} isSelected={selectedIds.has(s.id)} walls={floor.walls||[]} tool={tool} onSelect={selectEl} onStartDrag={startDrag} onErase={eraseEl}/>)}

              {drawing&&<>
                <line x1={drawing.x1} y1={drawing.y1} x2={drawing.x2} y2={drawing.y2} stroke="var(--accent)" strokeWidth={floor.wallThickness||10} strokeLinecap="round" opacity="0.7"/>
                {d2(drawing.x1,drawing.y1,drawing.x2,drawing.y2)>10&&<><rect x={(drawing.x1+drawing.x2)/2-26} y={(drawing.y1+drawing.y2)/2-9} width={52} height={16} rx="3" fill="rgba(0,0,0,.8)"/><text x={(drawing.x1+drawing.x2)/2} y={(drawing.y1+drawing.y2)/2+1} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="white" fontFamily="monospace">{fmtDist(d2(drawing.x1,drawing.y1,drawing.x2,drawing.y2))}</text></>}
              </>}

              {boxSel&&<rect x={Math.min(boxSel.x1,boxSel.x2||boxSel.x1)} y={Math.min(boxSel.y1,boxSel.y2||boxSel.y1)} width={Math.abs((boxSel.x2||boxSel.x1)-boxSel.x1)} height={Math.abs((boxSel.y2||boxSel.y1)-boxSel.y1)} fill="rgba(55,138,221,0.08)" stroke="var(--accent)" strokeWidth={1/zoom} strokeDasharray={`${4/zoom} ${3/zoom}`} style={{pointerEvents:'none'}}/>}

              {drawingAnalysis?.active&&<rect x={Math.min(drawingAnalysis.x0,drawingAnalysis.x1)} y={Math.min(drawingAnalysis.y0,drawingAnalysis.y1)}
                width={Math.abs(drawingAnalysis.x1-drawingAnalysis.x0)} height={Math.abs(drawingAnalysis.y1-drawingAnalysis.y0)}
                fill="rgba(79,163,255,0.12)" stroke="var(--accent-vivid)" strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom} ${3/zoom}`} style={{pointerEvents:'none'}}/>}
              {analysisRects.map(r=>(
                <rect key={r.id} x={r.x0} y={r.y0} width={r.x1-r.x0} height={r.y1-r.y0}
                  fill="rgba(79,163,255,0.08)" stroke="var(--accent-vivid)" strokeWidth={1.5/zoom} style={{pointerEvents:'none'}}/>
              ))}

              {primaryIsRect&&tool==='select'&&selectedIds.size===1&&mode==='edit'&&<ResizeHandles el={primaryEl} onHandleDown={startHandleDown}/>}

              {showMeas&&primaryDistLines.map((l,i)=>{
                const mx=(l.from.x+l.to.x)/2,my=(l.from.y+l.to.y)/2
                return(<g key={i}><line x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" strokeDasharray="3 2"/><rect x={mx-20} y={my-7} width={40} height={13} rx="3" fill="rgba(0,0,0,0.7)"/><text x={mx} y={my+1} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="white" fontFamily="monospace">{fmtDist(l.d)}</text></g>)
              })}
            </g>
          </svg>

          <Movable posKey="scalebar" defaultPos={{x:16,y:520}} containerRef={canvasWrapRef} approxW={Math.max(80,scaleBarPx+24)} approxH={40}>
            <div style={{pointerEvents:'none',userSelect:'none'}}>
              <div style={{background:'rgba(0,0,0,.7)',borderRadius:'var(--r-sm)',padding:'5px var(--sp-3)',display:'inline-block'}}>
                <div style={{position:'relative',width:scaleBarPx,marginBottom:2}}>
                  <div style={{position:'absolute',top:-14,left:'50%',transform:'translateX(-50%)',fontSize:'var(--fs-xs)',color:'white',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{scaleLabel}</div>
                  <div style={{height:1,background:'white',width:'100%',marginTop:16}}/>
                  <div style={{position:'absolute',left:0,top:10,width:1,height:8,background:'white'}}/>
                  <div style={{position:'absolute',right:0,top:10,width:1,height:8,background:'white'}}/>
                </div>
              </div>
            </div>
          </Movable>

          {showIAQ&&(()=>{
            if (heatmapMode==='composite') {
              return (
                <Movable posKey="legend" defaultPos={{x:900,y:16}} containerRef={canvasWrapRef} approxW={80} approxH={140}>
                  <div className="hp-card hp-card--elevated" style={{padding:'var(--sp-2)',display:'flex',flexDirection:'column',gap:4,userSelect:'none'}}>
                    <span style={{fontSize:9,color:'var(--text3)',fontWeight:700,marginBottom:2}}>CONFORT</span>
                    {[['Bon','ok'],['Léger écart','warn'],['Dégradé','bad'],['Mauvais','danger']].map(([label,key])=>(
                      <div key={key} style={{display:'flex',alignItems:'center',gap:6}}>
                        <span style={{width:10,height:10,borderRadius:2,background:STATUS_HEX_COMPOSITE[key]}}/>
                        <span style={{fontSize:9,color:'var(--text2)'}}>{label}</span>
                      </div>
                    ))}
                  </div>
                </Movable>
              )
            }
            const[domMin,domMax]=METRIC_DOMAIN[iaqMet]||[0,100]
            const unit={temperature:'°C',humidity:'%',co2:'ppm',lux:'lx',iaq:'',pressure:'hPa'}[iaqMet]||''
            const thresholds=METRIC_THRESHOLDS[iaqMet]||[]
            const pctOf=v=>Math.max(0,Math.min(1,(v-domMin)/(domMax-domMin)))*100
            const activeCursor=staticCursor||heatCursor
            const cursorColor=activeCursor?statusColorForValue(iaqMet,activeCursor.value):'var(--accent-vivid)'
            return(
              <Movable posKey="legend" defaultPos={{x:900,y:16}} containerRef={canvasWrapRef} approxW={64} approxH={220}>
                <div className="hp-card hp-card--elevated" style={{padding:'var(--sp-2) var(--sp-2)',boxShadow:'var(--shadow-2)',display:'flex',flexDirection:'column',alignItems:'center',height:220,userSelect:'none'}}>
                  <span style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',fontFamily:'var(--mono)',marginBottom:6}}>{domMax}{unit}</span>
                  <div style={{position:'relative',flex:1,width:14}}>
                    <div style={{position:'absolute',inset:0,borderRadius:'var(--r-sm)',overflow:'hidden',border:'0.5px solid var(--border-strong)',display:'flex',flexDirection:'column-reverse'}}>
                      <div style={{flex:1,background:'var(--ok)'}}/>
                      <div style={{flex:1,background:'var(--warn)'}}/>
                      <div style={{flex:1,background:'var(--danger)'}}/>
                    </div>
                    {thresholds.map(v=>(
                      <div key={v} style={{position:'absolute',left:-3,right:-3,bottom:`${pctOf(v)}%`,height:1,background:'rgba(0,0,0,.5)',boxShadow:'0 0 0 1px rgba(255,255,255,.4)'}}>
                        <span style={{position:'absolute',left:20,top:-6,fontSize:9,color:'var(--text3)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>{v}</span>
                      </div>
                    ))}
                    {activeCursor&&activeCursor.value!=null&&(
                      <div style={{position:'absolute',left:-5,right:-5,bottom:`${pctOf(activeCursor.value)}%`,height:2,background:cursorColor,boxShadow:'0 0 0 1px #fff'}}>
                        <span style={{position:'absolute',right:20,top:-7,fontSize:10,color:cursorColor,fontFamily:'var(--mono)',fontWeight:700,whiteSpace:'nowrap',background:'var(--bg-elev)',padding:'1px 4px',borderRadius:'var(--r-sm)'}}>{activeCursor.value.toFixed(1)}{unit}</span>
                      </div>
                    )}
                  </div>
                  <span style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',fontFamily:'var(--mono)',marginTop:6}}>{domMin}{unit}</span>
                  <span style={{fontSize:'var(--fs-2xs)',color:'var(--text2)',fontFamily:'var(--mono)',marginTop:8,writingMode:'vertical-rl',textOrientation:'mixed',letterSpacing:'.05em'}}>{iaqMet}</span>
                </div>
              </Movable>
            )
          })()}

          {showIAQ&&heatCursor&&(()=>{
            const rect=canvasWrapRef.current?.getBoundingClientRect()
            if(!rect)return null
            const unit={temperature:'°C',humidity:'%',co2:'ppm',lux:'lx',iaq:'',pressure:'hPa'}[iaqMet]||''
            const c=statusColorForValue(iaqMet,heatCursor.value)
            return(
              <div style={{position:'absolute',left:heatCursor.screenX-rect.left,top:heatCursor.screenY-rect.top+20,transform:'translateX(-50%)',pointerEvents:'none',zIndex:60}}>
                <div style={{background:'rgba(0,0,0,.85)',border:`0.5px solid ${c}`,borderRadius:'var(--r-sm)',padding:'2px var(--sp-2)',fontSize:11,fontFamily:'var(--mono)',fontWeight:700,color:c,whiteSpace:'nowrap'}}>
                  {heatCursor.value.toFixed(1)}{unit}
                </div>
              </div>
            )
          })()}

          {showIAQ&&staticCursor&&(()=>{
            const sx=staticCursor.x*zoom+pan.x,sy=staticCursor.y*zoom+pan.y
            const unit={temperature:'°C',humidity:'%',co2:'ppm',lux:'lx',iaq:'',pressure:'hPa'}[iaqMet]||''
            const c=staticCursor.value!=null?statusColorForValue(iaqMet,staticCursor.value):'var(--text3)'
            const timeLabel=isLiveScrub?'LIVE':fmtScrubTs(scrubTs,timelineRange)
            return(
              <div style={{position:'absolute',left:0,top:0,width:'100%',height:'100%',pointerEvents:'none'}}>
                <svg width="100%" height="100%" style={{position:'absolute',inset:0}}>
                  <circle cx={sx} cy={sy} r={7} fill="none" stroke="#fff" strokeWidth={2}/>
                  <circle cx={sx} cy={sy} r={2} fill="#fff"/>
                </svg>
                {staticCursor.value!=null&&(
                  <div style={{position:'absolute',left:sx+11,top:sy-9,background:'rgba(0,0,0,.85)',border:`0.5px solid ${c}`,borderRadius:'var(--r-sm)',padding:'2px var(--sp-2)',textAlign:'center'}}>
                    <div style={{fontSize:11,fontFamily:'var(--mono)',fontWeight:700,color:c,whiteSpace:'nowrap'}}>{staticCursor.value.toFixed(1)}{unit}</div>
                    <div style={{fontSize:9,fontFamily:'var(--mono)',color:'var(--text3)',whiteSpace:'nowrap',marginTop:1}}>{timeLabel}</div>
                  </div>
                )}
              </div>
            )
          })()}

          {navDetail&&(
              <Movable posKey="detailpanel" defaultPos={{x:820,y:40}} containerRef={canvasWrapRef} approxW={Math.min(700,320+(navDetail?.metrics?.length||0)*95)} approxH={320}>
              <NavDetailPanel el={navDetail} activeContract={activeContract} onClose={()=>setNavDetail(null)} rangeKey={timelineRange}
                cursorTs={isLiveScrub?null:scrubTs}
                onScrub={scrubRAF}
              />
            </Movable>
          )}

          {analysisRects.length>0&&(
            <Movable posKey="analysispanel" defaultPos={{x:820,y:400}} containerRef={canvasWrapRef} approxW={340} approxH={280}>
              <AnalysisPanel selectionRects={analysisRects} sensors={floor.sensors||[]} walls={floor.walls||[]}
                weightedSample={weightedSample}
                onClose={()=>{setAnalysisRects([]);setDrawingAnalysis(null)}}
                onRemoveRect={id=>setAnalysisRects(prev=>prev.filter(r=>r.id!==id))}/>
            </Movable>
          )}

          {!navDetail&&hoverDetail&&!(mode==='edit'&&selectedIds.has(hoverDetail.id))&&(()=>{
            const isPointEl=hoverDetail.w==null
            const anchorWx=isPointEl?hoverDetail.x:hoverDetail.x+hoverDetail.w/2
            const anchorWy=isPointEl?hoverDetail.y:hoverDetail.y
            const sx=anchorWx*zoom+pan.x,sy=anchorWy*zoom+pan.y
            const lines=[
              hoverDetail.label||hoverDetail.deviceId?.slice(-8)||'sensor',
              !isPointEl?`${pxToCm(hoverDetail.w)}×${pxToCm(hoverDetail.h)}cm`:null,
              hoverDetail.watts>0?`${hoverDetail.watts}W`:null,
              !isPointEl?`${hoverDetail.rotation||0}°`:(hoverDetail.metrics||[]).join('·')||null,
            ].filter(Boolean)
            const w=Math.max(70,Math.max(...lines.map(l=>String(l).length))*6.2+16)
            const h=lines.length*13+8
            return(
              <div style={{position:'absolute',left:sx-w/2,top:sy-h-14,width:w,pointerEvents:'none',zIndex:58}}>
                <div style={{background:'rgba(0,0,0,.88)',border:'0.5px solid rgba(255,255,255,.15)',borderRadius:'var(--r-sm)',padding:'4px 0'}}>
                  {lines.map((l,i)=>(
                    <div key={i} style={{textAlign:'center',fontSize:10,color:'#fff',fontFamily:'var(--mono)',lineHeight:'13px'}}>{l}</div>
                  ))}
                </div>
              </div>
            )
          })()}

          <Movable posKey="compass" defaultPos={{x:16,y:16}} containerRef={canvasWrapRef} approxW={80} approxH={130}>
            <CompassWidget deg={floor.orientationDeg||0} onChange={d=>updateFloor(f=>({...f,orientationDeg:d}))}
              timeLabel={showIAQ?(isLiveScrub?'LIVE':fmtScrubTs(scrubTs,timelineRange)):null}
              lat={currentBuilding?.gpsLat} lon={currentBuilding?.gpsLon} onSetGPS={updateBuildingGPS}/>
          </Movable>

          {showIAQ&&(
            <Movable posKey="timeline" defaultPos={{x:24,y:60}} containerRef={canvasWrapRef} approxW={260} approxH={44}>
              <TimelineScrubber rangeKey={timelineRange} setRangeKey={setTimelineRange}
                scrubPct={scrubPct} setScrubPct={setScrubPct} scrubTs={scrubTs} loading={metricHist.loading}
                sunTimesToday={currentBuilding?.gpsLat!=null?sunTimes(new Date(),currentBuilding.gpsLat,currentBuilding.gpsLon):null}/>
            </Movable>
          )}

          {mode==='edit'&&selectedIds.size===1&&tool==='select'&&primaryEl&&!primaryWall&&!primaryOp&&
            <Movable posKey="dpad" defaultPos={{x:16,y:400}} containerRef={canvasWrapRef} approxW={112} approxH={112}>
              <DPad onNudge={nudgeElement}/>
            </Movable>}

          {selectedIds.size>1&&(
            <div className="hp-card hp-card--elevated" style={{position:'absolute',bottom:16,right:16,boxShadow:'var(--shadow-3)',padding:'var(--sp-2) var(--sp-3)',display:'flex',gap:'var(--sp-2)',alignItems:'center',fontSize:'var(--fs-sm)',color:'var(--text2)'}}>
              {selectedIds.size} selected
              <button onClick={()=>{[...selectedIds].forEach(id=>eraseEl(id));setSelectedIds(new Set())}} className="hp-focus-visible" style={{padding:'var(--sp-1) var(--sp-2)',borderRadius:'var(--r-sm)',border:'0.5px solid color-mix(in srgb, var(--danger) 27%, transparent)',background:'transparent',color:'var(--danger)',cursor:'pointer',fontSize:'var(--fs-xs)',fontWeight:600}}>Delete all</button>
              <button onClick={()=>setSelectedIds(new Set())} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
            </div>
          )}

          {openMenu&&<div style={{position:'fixed',inset:0,zIndex:99}} onClick={()=>setOpenMenu(null)}/>}
        </div>
      </div>
    </div>
  )
}