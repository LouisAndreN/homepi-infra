import { useState, useMemo, useEffect, useRef } from 'react'
import { useStore, computeElecCost, buildCostCurve, useT, DEFAULT_CONTRACT } from '../store/index.jsx'
import { ChartModal } from '../components/ChartModal.jsx'
import { Modal } from '../components/Modal.jsx'

// ─── Japan tariff periods ──────────────────────────────────────────────────────
// Based on TEPCO Smart Life plan pattern
const JAPAN_PERIODS = [
  { from:0,  to:8,  label:'夜間 Off-peak', color:'#3B82F6', textColor:'#60A5FA' }, // Blue
  { from:8,  to:13, label:'昼間 Standard', color:'#d4d4d8', textColor:'#e2e4ec' }, // White
  { from:13, to:17, label:'ピーク Peak',   color:'#EF4444', textColor:'#F87171' }, // Red
  { from:17, to:22, label:'昼間 Standard', color:'#d4d4d8', textColor:'#e2e4ec' }, // White
  { from:22, to:24, label:'夜間 Off-peak', color:'#3B82F6', textColor:'#60A5FA' }, // Blue
]

function getCurrentPeriod(){
  const h=new Date().getHours()
  return JAPAN_PERIODS.find(p=>h>=p.from&&h<p.to)||JAPAN_PERIODS[1]
}

// ─── Simulated consumption profile ────────────────────────────────────────────
// 5-minute intervals (288 per day), watts
function generateProfile(seed=0){
  return Array.from({length:288},(_,i)=>{
    const h=i*5/60
    let w=120 // base load
    if(h>=6.5&&h<=9)   w+=600*Math.sin(((h-6.5)/2.5)*Math.PI)
    if(h>=11.5&&h<=13) w+=250*Math.sin(((h-11.5)/1.5)*Math.PI)
    if(h>=17&&h<=22)   w+=700*Math.sin(((h-17)/5)*Math.PI)
    w+=Math.sin(i*0.8+seed)*60+Math.sin(i*3.1+seed*2)*25
    return{min:i*5,watts:Math.max(80,w)}
  })
}

function computeCumulative(profile){
  let kwh=0
  return profile.map(r=>({min:r.min,kwh:(kwh+=r.watts/1000*(5/60))}))
}

// ─── Cumulative energy chart ───────────────────────────────────────────────────
function CumulativeChart({todayCum,prevCum,predictColor,currentMin,avgKw,h=170}){
  const W=600,H=h,PAD={top:14,right:16,bottom:28,left:48}
  const pw=W-PAD.left-PAD.right,ph=H-PAD.top-PAD.bottom

  const maxKwh=Math.max((prevCum.at(-1)?.kwh||0),(todayCum.at(-1)?.kwh||0)+avgKw*((1440-currentMin)/60),0.5)*1.15

  const mx=min=>PAD.left+(min/1440)*pw
  const ky=kwh=>PAD.top+(1-kwh/maxKwh)*ph

  // Build polyline points
  const todayPts=todayCum.map(r=>`${mx(r.min)},${ky(r.kwh)}`).join(' ')
  const prevPts =prevCum.map(r=>`${mx(r.min)},${ky(r.kwh)}`).join(' ')

  const curKwh=todayCum.at(-1)?.kwh||0
  const predEndKwh=curKwh+avgKw*((1440-currentMin)/60)
  const predPts=`${mx(currentMin)},${ky(curKwh)} ${mx(1440)},${ky(predEndKwh)}`

  // Y axis ticks
  const yTicks=4
  const yStep=maxKwh/yTicks

  // X axis labels
  const xLabels=[0,6,12,18,24]

  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:'block'}}>
      {/* Grid */}
      {Array.from({length:yTicks+1},(_,i)=>(
        <line key={i} x1={PAD.left} y1={ky(i*yStep)} x2={PAD.left+pw} y2={ky(i*yStep)} stroke="var(--border)" strokeWidth=".5"/>
      ))}
      {/* Y labels */}
      {Array.from({length:yTicks+1},(_,i)=>(
        <text key={i} x={PAD.left-5} y={ky(i*yStep)+3} textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="monospace">{(i*yStep).toFixed(1)}</text>
      ))}
      <text x={10} y={PAD.top+ph/2} textAnchor="middle" fontSize="9" fill="var(--text3)" transform={`rotate(-90,10,${PAD.top+ph/2})`}>kWh</text>
      {/* X labels */}
      {xLabels.map(h=>(
        <text key={h} x={mx(h*60)} y={H-4} textAnchor="middle" fontSize="9" fill="var(--text3)" fontFamily="monospace">{h}:00</text>
      ))}
      {/* Axes */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top+ph} stroke="var(--border)" strokeWidth="1"/>
      <line x1={PAD.left} y1={PAD.top+ph} x2={PAD.left+pw} y2={PAD.top+ph} stroke="var(--border)" strokeWidth="1"/>

      {/* Yesterday reference */}
      <polyline points={prevPts} fill="none" stroke="white" strokeWidth="1" strokeDasharray="5 4" opacity="0.18"/>

      {/* Today area fill */}
      {todayCum.length>1&&(
        <polygon
          points={`${mx(0)},${PAD.top+ph} ${todayPts} ${mx(currentMin)},${PAD.top+ph}`}
          fill={predictColor} opacity="0.08"/>
      )}

      {/* Today actual line */}
      {todayCum.length>1&&<polyline points={todayPts} fill="none" stroke={predictColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}

      {/* Prediction dashed */}
      <polyline points={predPts} fill="none" stroke={predictColor} strokeWidth="1.5" strokeDasharray="7 5" opacity="0.65"/>

      {/* Current time vertical line */}
      <line x1={mx(currentMin)} y1={PAD.top} x2={mx(currentMin)} y2={PAD.top+ph} stroke="white" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.35"/>

      {/* End prediction dot */}
      <circle cx={mx(1440)} cy={ky(predEndKwh)} r="4" fill={predictColor} opacity="0.7"/>

      {/* Current position dot */}
      {todayCum.length>0&&(
        <circle cx={mx(currentMin)} cy={ky(curKwh)} r="5" fill={predictColor}/>
      )}
    </svg>
  )
}

// ─── 24h Japan tariff timeline ─────────────────────────────────────────────────
function PeakTimeline24h(){
  const now=new Date()
  const currentHour=now.getHours()+now.getMinutes()/60
  const curPeriod=getCurrentPeriod()

  return(
    <div className="hp-card" style={{marginBottom:'var(--sp-3)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-3)'}}>
        <div className="hp-eyebrow">24h Tariff · Japan</div>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:curPeriod.textColor}}>
          {curPeriod.label} · Now
        </div>
      </div>

      {/* Hour bars */}
      <div style={{display:'flex',height:28,borderRadius:'var(--r-sm)',overflow:'hidden',gap:1,marginBottom:'var(--sp-2)'}}>
        {Array.from({length:24},(_,h)=>{
          const period=JAPAN_PERIODS.find(p=>h>=p.from&&h<p.to)
          const isCurrent=h===Math.floor(currentHour)
          return(
            <div key={h} title={`${h}:00 — ${period?.label}`}
              style={{flex:1,background:period?.color||'#565c72',opacity:isCurrent?1:0.45,outline:isCurrent?`2px solid white`:'none',position:'relative',zIndex:isCurrent?1:0}}/>
          )
        })}
      </div>

      {/* X labels */}
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
        {[0,6,12,18,23].map(h=><span key={h} style={{fontSize:9,color:'var(--text3)',fontFamily:'monospace'}}>{h}:00</span>)}
      </div>

      {/* Legend */}
      <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
        {[['#3B82F6','夜間 Off-peak','22:00–08:00'],['#d4d4d8','昼間 Standard','08:00–13:00, 17:00–22:00'],['#EF4444','ピーク Peak','13:00–17:00']].map(([c,l,t])=>(
          <span key={l} style={{display:'flex',alignItems:'center',gap:5,fontSize:10,color:'var(--text2)'}}>
            <span style={{width:10,height:10,borderRadius:2,background:c,display:'inline-block',flexShrink:0}}/>
            <span>{l}</span>
            <span style={{color:'var(--text3)'}}>({t})</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Contract editor modal ─────────────────────────────────────────────────────
function ContractModal({contract,onSave,onCancel}){
  const [form,setForm]=useState(JSON.parse(JSON.stringify(contract||{
    name:'',validFrom:new Date().toISOString().slice(0,10),currency:'JPY',
    scope:{type:'global',id:null},
    utilities:{
      electricity:{enabled:true,standingChargePerDay:50,
        tiers:[{id:`t${Date.now()}`,label:'Tier 1',from:0,to:null,ratePerKwh:31}],
        peakSchedule:[]},
      water:{enabled:false,ratePerM3:300,standingChargePerDay:0},
      gas:{enabled:false,ratePerM3:120,standingChargePerDay:0},
    }
  })))

  const mkTierId=()=>`t${Date.now()}`
  const S={width:'100%',padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg3)',color:'var(--text)',fontSize:'var(--fs-sm)',fontFamily:'var(--mono)',outline:'none'}
  const el=form.utilities.electricity

  return(
    <Modal onClose={onCancel}>
      <div className="hp-card hp-card--elevated" style={{boxShadow:'var(--shadow-3)',padding:'var(--sp-5)',width:'min(500px,100%)',maxHeight:'88vh',overflow:'auto'}}>
        <div style={{fontSize:'var(--fs-md)',fontWeight:700,marginBottom:'var(--sp-4)'}}>Edit Contract</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'var(--sp-2)',marginBottom:'var(--sp-4)'}}>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Name</div>
            <input style={S} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. TEPCO Standard"/></div>
          <div><div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Valid from</div>
            <input type="date" style={S} value={form.validFrom} onChange={e=>setForm(f=>({...f,validFrom:e.target.value}))}/></div>
        </div>

        {/* Electricity section */}
        <div style={{marginBottom:'var(--sp-4)'}}>
          <div style={{fontSize:'var(--fs-sm)',fontWeight:700,color:'var(--warn)',marginBottom:'var(--sp-3)'}}>⚡ Electricity</div>
          <div style={{marginBottom:'var(--sp-2)'}}>
            <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:3}}>Standing charge / day (¥)</div>
            <input type="number" style={{...S,width:120}} value={el.standingChargePerDay} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,standingChargePerDay:parseFloat(e.target.value)||0}}}))}/>
          </div>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginBottom:'var(--sp-2)'}}>Consumption tiers</div>
          {el.tiers.map((tier,i)=>(
            <div key={tier.id} style={{display:'grid',gridTemplateColumns:'1fr 55px 55px 70px 24px',gap:4,marginBottom:'var(--sp-1)'}}>
              <input style={{...S,fontSize:'var(--fs-xs)'}} value={tier.label} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,label:e.target.value}:t)}}}))} placeholder="Label"/>
              <input type="number" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.from} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,from:parseFloat(e.target.value)||0}:t)}}}))}/>
              <input type="number" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.to??''} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,to:e.target.value===''?null:parseFloat(e.target.value)}:t)}}}))} placeholder="∞"/>
              <input type="number" step="0.01" style={{...S,fontSize:'var(--fs-xs)'}} value={tier.ratePerKwh} onChange={e=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.map((t,j)=>j===i?{...t,ratePerKwh:parseFloat(e.target.value)||0}:t)}}}))} placeholder="¥/kWh"/>
              {el.tiers.length>1&&<button onClick={()=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:f.utilities.electricity.tiers.filter((_,j)=>j!==i)}}}))} className="hp-focus-visible" style={{background:'none',border:'none',color:'var(--danger)',cursor:'pointer',fontSize:'var(--fs-base)'}}>✕</button>}
            </div>
          ))}
          <button onClick={()=>setForm(f=>({...f,utilities:{...f.utilities,electricity:{...f.utilities.electricity,tiers:[...f.utilities.electricity.tiers,{id:mkTierId(),label:`Tier ${f.utilities.electricity.tiers.length+1}`,from:f.utilities.electricity.tiers.at(-1)?.to||0,to:null,ratePerKwh:31}]}}}))}
            className="hp-focus-visible" style={{fontSize:'var(--fs-xs)',fontWeight:600,color:'var(--text3)',background:'none',border:'none',cursor:'pointer',marginBottom:'var(--sp-3)'}}>+ Add tier</button>
        </div>

        <div style={{display:'flex',gap:'var(--sp-2)'}}>
          <button className="hp-focus-visible" style={{flex:1,padding:'var(--sp-3) 0',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-sm)'}} onClick={onCancel}>Cancel</button>
          <button className="hp-focus-visible" style={{flex:2,padding:'var(--sp-3) 0',borderRadius:'var(--r-sm)',border:'none',background:'var(--accent-vivid)',color:'#fff',cursor:'pointer',fontSize:'var(--fs-sm)',fontWeight:700}} onClick={()=>onSave(form)}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main EnergyTab ────────────────────────────────────────────────────────────
export function EnergyTab(){
  const{state,activeContract,addContract,updateContract,deleteContract,setActiveContract}=useStore()
  const contracts=state.contracts
  const[windowKey,setWindowKey]=useState('h24')
  const[editingContract,setEditingContract]=useState(null)
  const[modal,setModal]=useState(null)
  const[subTab,setSubTab]=useState('overview')

  const SUB_TABS=[
    {key:'overview',label:'Overview'},
    {key:'devices', label:'Per-device'},
  ]

  const now=new Date()
  const currentMin=now.getHours()*60+now.getMinutes()

  // Generate simulated data once per session
  const todayProfile  =useMemo(()=>generateProfile(0),[])
  const prevProfile   =useMemo(()=>generateProfile(42),[])

  // Cumulative curves
  const todayFull =useMemo(()=>computeCumulative(todayProfile),[todayProfile])
  const prevFull  =useMemo(()=>computeCumulative(prevProfile),[prevProfile])

  // Today only up to current time (+ small real-time delta using a ticker)
  const[tick,setTick]=useState(0)
  useEffect(()=>{const t=setInterval(()=>setTick(k=>k+1),60000);return()=>clearInterval(t)},[])

  const todayCum=useMemo(()=>todayFull.filter(r=>r.min<=currentMin),[todayFull,currentMin,tick])

  // Current stats
  const currentKwh=todayCum.at(-1)?.kwh||0
  const prevSameTimeKwh=(prevFull.find(r=>r.min>=currentMin)||prevFull.at(-1))?.kwh||0
  const prevTotalKwh=prevFull.at(-1)?.kwh||0

  // Recent avg power for prediction (last 30 min of simulated data)
  const recentPts=todayProfile.filter(r=>r.min>=currentMin-30&&r.min<=currentMin)
  const avgKw=recentPts.length?(recentPts.reduce((s,r)=>s+r.watts,0)/recentPts.length/1000):0.3

  // Predicted total
  const predTotal=currentKwh+avgKw*((1440-currentMin)/60)
  // Hex literal here (not var()): concatenated with an alpha suffix below; same
  // value as --ok/--danger/--text, duplicated in hex out of technical necessity.
  const predictColor=predTotal<prevTotalKwh*0.95?'#1D9E75':predTotal>prevTotalKwh*1.05?'#E24B4A':'#eef0f7'

  // Cost
  const elecRate=activeContract?.utilities?.electricity?.tiers?.[0]?.ratePerKwh||31
  const currentCost=computeElecCost(currentKwh,activeContract)
  const predCost=computeElecCost(predTotal,activeContract)

  // Current period
  const curPeriod=getCurrentPeriod()

  const TIME_WINDOWS=[
    {key:'h24',label:'Today'},
    {key:'d3', label:'3 days'},
    {key:'w1', label:'1 week'},
    {key:'m1', label:'Month'},
  ]

  function handleSaveContract(form){
    if(editingContract==='new')addContract(form)
    else updateContract({...form,id:editingContract.id})
    setEditingContract(null)
  }

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

      {/* Top bar */}
      <div style={{padding:'var(--sp-2) var(--sp-4)',borderBottom:'0.5px solid var(--border)',display:'flex',gap:'var(--sp-1)',alignItems:'center',flexShrink:0,background:'var(--bg)'}}>
        <div style={{fontSize:'var(--fs-sm)',fontWeight:700}}>⚡ Electricity</div>
        <div style={{marginLeft:'var(--sp-2)',fontSize:'var(--fs-xs)',color:curPeriod.textColor,fontFamily:'var(--mono)',fontWeight:700}}>
          {curPeriod.label}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:'var(--sp-2)',alignItems:'center'}}>
          <span style={{fontSize:'var(--fs-xs)',color:'var(--text3)'}}>{activeContract?.name}</span>
          <button onClick={()=>setEditingContract(activeContract||DEFAULT_CONTRACT)} className="hp-focus-visible"
            style={{padding:'var(--sp-1) var(--sp-3)',borderRadius:'var(--r-sm)',fontSize:'var(--fs-xs)',fontWeight:600,border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer'}}>⚙ Contract</button>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div style={{padding:'0 var(--sp-4)',borderBottom:'0.5px solid var(--border)',display:'flex',gap:'var(--sp-1)',flexShrink:0,background:'var(--bg)'}}>
        {SUB_TABS.map(t=>(
          <button key={t.key} onClick={()=>setSubTab(t.key)} className="hp-focus-visible"
            style={{padding:'var(--sp-2) var(--sp-3)',fontSize:'var(--fs-sm)',fontWeight:600,
              background:'none',border:'none',cursor:'pointer',
              color:subTab===t.key?'var(--text)':'var(--text3)',
              borderBottom:subTab===t.key?'2px solid var(--accent-vivid)':'2px solid transparent',
              marginBottom:-1}}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab==='overview'&&(
      <div style={{flex:1,overflow:'auto'}}>

        {/* KPI row */}
        <div style={{padding:'var(--sp-3) var(--sp-4)',borderBottom:'0.5px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'var(--sp-2)',marginBottom:'var(--sp-3)'}}>
            {[
              {icon:'⚡',label:'Current load',value:`${(avgKw*1000).toFixed(0)}W`,sub:`${avgKw.toFixed(2)} kW avg`,color:'var(--warn)'},
              {icon:'📊',label:'Today so far',value:`${currentKwh.toFixed(2)} kWh`,sub:`¥${Math.round(currentCost).toLocaleString()}`,color:'var(--accent-vivid)'},
              {icon:'🎯',label:'Day prediction',value:`${predTotal.toFixed(2)} kWh`,sub:`¥${Math.round(predCost).toLocaleString()}`,color:predictColor},
              {icon:'📅',label:'Yesterday total',value:`${prevTotalKwh.toFixed(2)} kWh`,sub:`vs ${prevSameTimeKwh.toFixed(2)} same time`,color:'var(--text3)'},
            ].map(k=>(
              <div key={k.label} className="hp-card" style={{padding:'var(--sp-3) var(--sp-3)'}}>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginBottom:'var(--sp-1)'}}>{k.icon} {k.label}</div>
                <div style={{fontSize:'var(--fs-md)',fontFamily:'var(--mono)',fontWeight:700,color:k.color}}>{k.value}</div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginTop:2}}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Prediction status */}
          <div style={{padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',background:`${predictColor}18`,border:`0.5px solid ${predictColor}44`,display:'flex',alignItems:'center',gap:'var(--sp-2)',fontSize:'var(--fs-sm)'}}>
            <span style={{color:predictColor,fontSize:16}}>{predTotal<prevTotalKwh*0.95?'✓':predTotal>prevTotalKwh*1.05?'⚠':'→'}</span>
            <span style={{color:predictColor,fontWeight:700}}>
              {predTotal<prevTotalKwh*0.95?`Saving ${((1-predTotal/prevTotalKwh)*100).toFixed(0)}% vs yesterday`
              :predTotal>prevTotalKwh*1.05?`+${((predTotal/prevTotalKwh-1)*100).toFixed(0)}% above yesterday's consumption`
              :'Tracking yesterday\'s consumption'}
            </span>
            <span style={{color:'var(--text3)',marginLeft:'auto',fontSize:'var(--fs-xs)'}}>
              Predicted ¥{Math.round(predCost).toLocaleString()} vs yesterday ¥{Math.round(computeElecCost(prevTotalKwh,activeContract)).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Cumulative chart */}
        <div style={{padding:'var(--sp-3) var(--sp-4)',borderBottom:'0.5px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'var(--sp-2)'}}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',fontWeight:600}}>Cumulative energy today</div>
            <div style={{display:'flex',gap:'var(--sp-3)',fontSize:'var(--fs-2xs)',color:'var(--text3)'}}>
              <span><span style={{display:'inline-block',width:20,height:2,background:predictColor,verticalAlign:'middle',marginRight:4}}/>Today</span>
              <span><span style={{display:'inline-block',width:20,height:1,background:'white',opacity:.3,verticalAlign:'middle',marginRight:4,borderTop:'1px dashed white'}}/>Yesterday</span>
              <span><span style={{display:'inline-block',width:20,height:1,background:predictColor,opacity:.6,verticalAlign:'middle',marginRight:4,borderTop:'1px dashed'}}>‒ ‒</span>Prediction</span>
            </div>
          </div>
          <CumulativeChart
            todayCum={todayCum}
            prevCum={prevFull}
            predictColor={predictColor}
            currentMin={currentMin}
            avgKw={avgKw}/>
          <div style={{fontSize:'var(--fs-2xs)',color:'var(--text3)',marginTop:6,display:'flex',alignItems:'center',gap:5}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--warn)',flexShrink:0}}/>
            Real-time requires Shelly EM · Simulated from nominal appliance wattage
          </div>
        </div>

        {/* 24h tariff */}
        <div style={{padding:'var(--sp-3) var(--sp-4)',borderBottom:'0.5px solid var(--border)'}}>
          <PeakTimeline24h/>
        </div>

        {/* Contract tiers summary */}
        {activeContract?.utilities?.electricity?.tiers?.length>0&&(
          <div style={{padding:'var(--sp-3) var(--sp-4)'}}>
            <div className="hp-card">
              <div style={{fontSize:'var(--fs-sm)',fontWeight:600,marginBottom:'var(--sp-2)'}}>Pricing tiers — {activeContract.name}</div>
              {activeContract.utilities.electricity.tiers.map((tier,i)=>{
                const colors=['var(--accent-vivid)','var(--text2)','var(--danger)']
                return(
                  <div key={tier.id} style={{display:'flex',justifyContent:'space-between',padding:'var(--sp-1) 0',borderBottom:i<activeContract.utilities.electricity.tiers.length-1?'0.5px solid var(--border)':'none',fontSize:'var(--fs-base)'}}>
                    <span style={{color:'var(--text2)'}}>{tier.label} · {tier.from}–{tier.to??'∞'} kWh</span>
                    <span style={{fontFamily:'var(--mono)',color:colors[i%3],fontWeight:700}}>¥{tier.ratePerKwh}/kWh</span>
                  </div>
                )
              })}
              {(activeContract.utilities.electricity.standingChargePerDay||0)>0&&(
                <div style={{display:'flex',justifyContent:'space-between',paddingTop:'var(--sp-2)',fontSize:'var(--fs-xs)',color:'var(--text3)'}}>
                  <span>Standing charge</span><span style={{fontFamily:'var(--mono)'}}>¥{activeContract.utilities.electricity.standingChargePerDay}/day</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {subTab==='devices'&&(
      <div style={{flex:1,overflow:'auto'}}>
        {/* Placeholder: will be replaced by the real chart once the
            NILM telemetry (Teensy -> ESP32-S3 -> MQTT -> InfluxDB) is in place.
            See useInflux.js / EnergyTab for the planned integration point. */}
        <div style={{padding:'var(--sp-4)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:300,gap:'var(--sp-2)',textAlign:'center'}}>
          <div style={{fontSize:32}}>🔌</div>
          <div style={{fontSize:'var(--fs-md)',fontWeight:700,color:'var(--text2)'}}>Per-device breakdown</div>
          <div style={{fontSize:'var(--fs-sm)',color:'var(--text3)',maxWidth:360}}>
            En attente de la télémétrie NILM en direct (Teensy → ESP32-S3 → MQTT → InfluxDB).
            Ce panneau affichera la consommation par appareil une fois le pipeline en place.
          </div>
        </div>
      </div>
      )}

      {/* Contract editor */}
      {editingContract&&(
        <ContractModal
          contract={editingContract==='new'?null:editingContract}
          onSave={handleSaveContract}
          onCancel={()=>setEditingContract(null)}/>
      )}

      {modal&&<ChartModal key={modal.title} open={true} onClose={()=>setModal(null)} title={modal.title} unit={modal.unit} initialWindow={windowKey}/>}
    </div>
  )
}