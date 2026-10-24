import { useState } from 'react'
import { usePromInstant, usePromRange, Q, scalar, series } from '../hooks/usePrometheus.js'
import { GrafanaBar, Sparkline, StatCard }                  from '../components/Charts.jsx'
import { ChartModal }                                        from '../components/ChartModal.jsx'
import { useT }                                              from '../store/index.jsx'

function Card({children,style}){return<div className="hp-card" style={style}>{children}</div>}
function Section({title,children}){return<div style={{marginBottom:'var(--sp-5)'}}><div className="hp-eyebrow" style={{marginBottom:'var(--sp-3)',paddingBottom:'var(--sp-1)',borderBottom:'0.5px solid var(--border)'}}>{title}</div>{children}</div>}

function SparkCard({label,vals,loading,color,unit,onClick}){
  return(
    <Card style={{cursor:'pointer'}} onClick={onClick}>
      {loading && vals.length<2
        ?<div style={{height:50,display:'flex',alignItems:'center',justifyContent:'center',gap:8,color:'var(--text3)',fontSize:12}}>
          <div style={{width:14,height:14,border:'2px solid var(--border)',borderTopColor:color,borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
          Loading…
        </div>
        :<Sparkline values={vals} color={color} unit={unit} label={label} showLast/>
      }
    </Card>
  )
}

export function SystemTab(){
  const t=useT()
  const [modal,setModal]=useState(null)

  const cpu    = usePromInstant(Q.cpu,      10000)
  const ram    = usePromInstant(Q.ram,      10000)
  const disk   = usePromInstant(Q.disk,     30000)
  const cpuT   = usePromInstant(Q.cpuTemp,  10000)
  const nvmeT  = usePromInstant(Q.nvmeTemp, 15000)
  const uptime = usePromInstant(Q.uptime,   60000)
  const netIn  = usePromInstant(Q.netIn,    10000)
  const netOut = usePromInstant(Q.netOut,   10000)

  const cpuH  = usePromRange(Q.cpu,     3600000,'60s',30000)
  const ramH  = usePromRange(Q.ram,     3600000,'60s',30000)
  const cpuTH = usePromRange(Q.cpuTemp, 3600000,'60s',30000)
  const netH  = usePromRange(Q.netIn,   3600000,'60s',30000)

  const uptH   = scalar(uptime.value)
  const days   = Math.floor(uptH/24)
  const hours  = Math.floor(uptH%24)

  const BARS=[
    {label:t.system.cpu,     value:scalar(cpu.value),  min:0, max:100,unit:'%', thresholds:[[0,'var(--ok)'],[70,'var(--warn)'],[85,'var(--danger)']],expr:Q.cpu,    yMin:0,yMax:100},
    {label:t.system.ram,     value:scalar(ram.value),  min:0, max:100,unit:'%', thresholds:[[0,'var(--info)'],[70,'var(--warn)'],[88,'var(--danger)']],expr:Q.ram,    yMin:0,yMax:100},
    {label:t.system.disk,    value:scalar(disk.value), min:0, max:100,unit:'%', thresholds:[[0,'var(--ok)'],[75,'var(--warn)'],[90,'var(--danger)']],expr:Q.disk,   yMin:0,yMax:100},
    {label:t.system.cpuTemp, value:scalar(cpuT.value), min:30,max:85, unit:'°C',thresholds:[[0,'var(--ok)'],[60,'var(--warn)'],[75,'var(--danger)']],expr:Q.cpuTemp},
    {label:'NVMe Temp',      value:scalar(nvmeT.value),min:20,max:75, unit:'°C',thresholds:[[0,'var(--ok)'],[50,'var(--warn)'],[65,'var(--danger)']],expr:Q.nvmeTemp},
  ]

  return(
    <div style={{height:'100%',overflow:'auto',padding:'var(--sp-4) var(--sp-5)'}}>

      <Section title={t.system.clickHint}>
        <Card>
          {BARS.map(b=>(
            <GrafanaBar key={b.label} label={b.label} value={b.value} min={b.min} max={b.max}
              unit={b.unit} thresholds={b.thresholds}
              onClick={()=>setModal({title:b.label,unit:b.unit,expr:b.expr,yMin:b.yMin,yMax:b.yMax})}/>
          ))}
        </Card>
      </Section>

      <Section title="Overview">
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'var(--sp-2)'}}>
          <StatCard label={t.system.uptime}  value={`${days}d ${hours}h`}                     color="var(--accent-vivid)"/>
          <StatCard label={t.system.netIn}   value={(scalar(netIn.value)/1024).toFixed(1)}  unit=" KB/s" color="var(--ok)"/>
          <StatCard label={t.system.netOut}  value={(scalar(netOut.value)/1024).toFixed(1)} unit=" KB/s" color="var(--accent-vivid)"/>
        </div>
      </Section>

      <Section title="1h Trends — click to expand">
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'var(--sp-3)'}}>
          <SparkCard label={t.system.cpu}     vals={series(cpuH.data)}  loading={cpuH.loading}  color="var(--accent-vivid)" unit="%" onClick={()=>setModal({title:t.system.cpu,    unit:'%',  expr:Q.cpu,    yMin:0,yMax:100})}/>
          <SparkCard label={t.system.cpuTemp} vals={series(cpuTH.data)} loading={cpuTH.loading} color="#D85A30" unit="°C" onClick={()=>setModal({title:t.system.cpuTemp,unit:'°C', expr:Q.cpuTemp})}/>
          <SparkCard label={t.system.ram}     vals={series(ramH.data)}  loading={ramH.loading}  color="var(--info)" unit="%" onClick={()=>setModal({title:t.system.ram,    unit:'%',  expr:Q.ram,    yMin:0,yMax:100})}/>
          <SparkCard label={t.system.netIn}   vals={series(netH.data)}  loading={netH.loading}  color="var(--ok)" unit="B/s" onClick={()=>setModal({title:t.system.netIn, unit:'B/s',expr:Q.netIn})}/>
        </div>
      </Section>

      {/* Mount fresh on each open so hooks re-run */}
      {modal&&(
        <ChartModal key={modal.expr} open={true} onClose={()=>setModal(null)}
          title={modal.title} unit={modal.unit} promExpr={modal.expr}
          yMin={modal.yMin} yMax={modal.yMax}/>
      )}
    </div>
  )
}