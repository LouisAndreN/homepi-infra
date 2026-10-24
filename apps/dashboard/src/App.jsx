import { useState, useRef, useEffect } from 'react'
import { StoreProvider, useStore, useT } from './store/index.jsx'
// import { SystemTab }    from './tabs/SystemTab.jsx'
import { SecurityTab }  from './tabs/SecurityTab.jsx'
import { SensorsTab }   from './tabs/SensorsTab.jsx'
import { EnergyTab }    from './tabs/EnergyTab.jsx'
import { FloorPlanTab } from './tabs/FloorPlanTab.jsx'
import { FleetTab }     from './tabs/FleetTab.jsx'
import { LedTab }       from './tabs/LedTab.jsx'
import { SettingsTab }  from './tabs/SettingsTab.jsx'
import { currentEditorMode } from './editorMode.js'
import './styles/tokens.css'
import { createPortal } from 'react-dom'

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body,#root{height:100%;overflow:hidden;}
  body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:var(--fs-base);-webkit-font-smoothing:antialiased;}
  button,input,select,textarea{font-family:var(--font);font-size:inherit;color:inherit;}
  button{-webkit-tap-highlight-color:transparent;}
  @keyframes spin{to{transform:rotate(360deg);}}
  ::-webkit-scrollbar{width:3px;height:3px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  /* Breakpoints — 3 régimes de navigation, pas de zone ambiguë */
  .hp-shell{ display:flex; height:100dvh; background:var(--bg); color:var(--text); }
  .hp-nav-desktop{ display:none; }
  .hp-nav-compact{ display:none; }
  .hp-nav-mobile{ display:none; }
  .hp-topbar{ display:none; }

  /* Mobile < 768 : bottom tabs, seul choix ergonomique (zone de pouce) */
  @media (max-width: 767px){
    .hp-nav-mobile{ display:flex; }
    .hp-topbar{ display:flex; }
    .hp-main{ padding-bottom: var(--bottomnav-h); }
  }

  /* Tablette 768–1023 : sidebar compacte à icônes — une pleine sidebar
     mangerait ~25% de la largeur utile en portrait pour du texte redondant */
  @media (min-width: 768px) and (max-width: 1023px){
    .hp-nav-compact{ display:flex; }
    .hp-topbar{ display:flex; }
  }

  /* Desktop ≥ 1024 : sidebar pleine, labels visibles, persistante */
  @media (min-width: 1024px){
    .hp-nav-desktop{ display:flex; }
  }
`

const TABS_META=[
  // {id:'system',   icon:'▣',color:'#378ADD'},
  {id:'security', icon:'⬡',color:'#D85A30'},
  {id:'sensors',  icon:'◈',color:'#1D9E75'},
  {id:'energy',   icon:'◎',color:'#BA7517'},
  {id:'floorPlan',icon:'▦',color:'#7F77DD'},
  {id:'led',      icon:'☀',color:'#F5A623'},
  {id:'devices',  icon:'◉',color:'#5BA8F5'},
  {id:'settings', icon:'⚙',color:'#8b90a8'},
]

// ─── Sidebar pleine (desktop ≥1024px) — rétractable ────────────────────────
function SidebarDesktop({ tabs, active, onSelect, collapsed, onToggleCollapse }) {
  return (
    <nav className="hp-nav-desktop" style={{
      width: collapsed ? 'var(--sidebar-w-compact)' : 'var(--sidebar-w)', flexShrink:0, flexDirection:'column',
      borderRight:'0.5px solid var(--border)', background:'var(--bg2)',
      transition:'width var(--dur-base) var(--ease)', overflow:'hidden',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding: collapsed ? '0 12px' : '0 var(--sp-4)', height:'var(--header-h)', borderBottom:'0.5px solid var(--border)' }}>
        <Logo/>
        {!collapsed && <span style={{ fontSize:'var(--fs-md)', fontWeight:700, letterSpacing:'-.02em', whiteSpace:'nowrap' }}>HomePi</span>}
      </div>
      <div style={{ flex:1, overflow:'auto', padding:'var(--sp-3) var(--sp-2)', display:'flex', flexDirection:'column', gap:2 }}>
        {tabs.map((t,i) => {
          const isActive = active === i
          return (
            <button key={t.id} onClick={() => onSelect(i)} title={collapsed ? t.label : undefined} className="hp-focus-visible" style={{
              display:'flex', alignItems:'center', gap:12, padding: collapsed ? '10px' : '10px 12px', justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius:'var(--r-sm)', border:'none', cursor:'pointer', textAlign:'left',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              color: isActive ? t.color : 'var(--text2)',
              transition:'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
            }}>
              <span style={{ fontSize:16, width:18, textAlign:'center', flexShrink:0 }}>{t.icon}</span>
              {!collapsed && <span style={{ fontSize:'var(--fs-base)', fontWeight: isActive?600:500, whiteSpace:'nowrap' }}>{t.label}</span>}
              {!collapsed && isActive && <span style={{ marginLeft:'auto', width:5, height:5, borderRadius:'50%', background:t.color, flexShrink:0 }}/>}
            </button>
          )
        })}
      </div>
      <button onClick={onToggleCollapse} className="hp-focus-visible" title={collapsed ? 'Étendre' : 'Rétracter'} style={{
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        border:'none', borderTop:'0.5px solid var(--border)', background:'transparent',
        color:'var(--text3)', cursor:'pointer', padding:'var(--sp-2)', fontSize:14,
      }}>
        {collapsed ? '»' : '« Réduire'}
      </button>
      {!collapsed && (
        <div style={{ padding:'var(--sp-2) var(--sp-4)', borderTop:'0.5px solid var(--border)', fontSize:'var(--fs-2xs)', color:'var(--text3)' }}>
          homepi.internal · Zero-Trust IoT
        </div>
      )}
    </nav>
  )
}

// ─── Sidebar compacte icônes (tablette 768–1023px) ─────────────────────────
function SidebarCompact({ tabs, active, onSelect }) {
  return (
    <nav className="hp-nav-compact" style={{
      width:'var(--sidebar-w-compact)', flexShrink:0, flexDirection:'column', alignItems:'center',
      borderRight:'0.5px solid var(--border)', background:'var(--bg2)', paddingTop:'var(--sp-2)', gap:2,
    }}>
      {tabs.map((t,i) => {
        const isActive = active === i
        return (
          <button key={t.id} onClick={() => onSelect(i)} title={t.label} className="hp-focus-visible" style={{
            width:44, height:44, display:'flex', alignItems:'center', justifyContent:'center',
            borderRadius:'var(--r-sm)', border:'none', cursor:'pointer',
            background: isActive ? 'var(--accent-soft)' : 'transparent',
            color: isActive ? t.color : 'var(--text2)', fontSize:18,
          }}>
            {t.icon}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Bottom tabs (mobile < 768px) ──────────────────────────────────────────
function NavMobile({ tabs, active, onSelect }) {
  return (
    <nav className="hp-nav-mobile" style={{
      position:'fixed', left:0, right:0, bottom:0, height:'var(--bottomnav-h)',
      borderTop:'0.5px solid var(--border)', background:'var(--bg2)', zIndex:30,
      paddingBottom:'env(safe-area-inset-bottom)',
    }}>
      {tabs.map((t,i) => {
        const isActive = active === i
        return (
          <button key={t.id} onClick={() => onSelect(i)} className="hp-focus-visible" style={{
            flex:1, border:'none', background:'transparent', cursor:'pointer',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3,
            color: isActive ? t.color : 'var(--text3)', position:'relative',
          }}>
            <span style={{ fontSize:17, lineHeight:1 }}>{t.icon}</span>
            <span style={{ fontSize:'var(--fs-2xs)', fontWeight:500, letterSpacing:'.02em' }}>{t.label}</span>
            {isActive && <div style={{ position:'absolute', top:0, left:'28%', right:'28%', height:2, borderRadius:2, background:t.color }}/>}
          </button>
        )
      })}
    </nav>
  )
}

// ─── Logo — badge simple, pas de gradient décoratif ────────────────────────
function Logo(){
  return (
    <div style={{
      width:28, height:28, borderRadius:'var(--r-sm)', flexShrink:0,
      background:'var(--bg3)', border:'0.5px solid var(--border-strong)',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:13, fontWeight:700, color:'var(--accent)', fontFamily:'var(--mono)',
    }}>P</div>
  )
}

// ─── Topbar — mobile + tablette uniquement ──────────────────────────────────
function Topbar({ current }){
  return (
    <div className="hp-topbar" style={{
      height:'var(--header-h)', alignItems:'center', padding:'0 var(--sp-4)',
      borderBottom:'0.5px solid var(--border)', flexShrink:0, gap:'var(--sp-3)',
      background:'var(--bg)', position:'sticky', top:0, zIndex:20,
    }}>
      <Logo/>
      <span style={{ fontSize:'var(--fs-md)', fontWeight:700, letterSpacing:'-.02em' }}>HomePi</span>
      <div style={{ width:1, height:16, background:'var(--border)', marginLeft:2 }}/>
      <span style={{ fontSize:'var(--fs-base)', color:'var(--text2)' }}>{current.label}</span>
    </div>
  )
}

function AppInner(){
  const{state}=useStore()
  const t=useT()
  const[tab,setTab]=useState(0)
  const[sidebarCollapsed,setSidebarCollapsed]=useState(()=>{
    try{ return localStorage.getItem('homepi_sidebar_collapsed')==='1' }catch{ return false }
  })
  const touchStartX=useRef(null)

  const theme=state.settings.theme==='auto'
    ?(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')
    :state.settings.theme

  const TABS=TABS_META.map(m=>({...m,label:t.tabs[m.id]}))
  const current=TABS[tab]

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => { try{ localStorage.setItem('homepi_sidebar_collapsed', sidebarCollapsed?'1':'0') }catch{} }, [sidebarCollapsed])

  function onTouchStart(e){
    if(e.target.closest?.('input[type="range"], input[type="color"]')){ touchStartX.current=null; return }
    touchStartX.current=e.touches[0].clientX
  }
  function onTouchEnd(e){
    if(touchStartX.current===null)return
    if(TABS[tab].id==='floorPlan'&&currentEditorMode==='edit'){ touchStartX.current=null; return }
    const dx=e.changedTouches[0].clientX-touchStartX.current
    if(Math.abs(dx)>65){
      if(dx<0)setTab(tt=>Math.min(tt+1,TABS.length-1))
      else     setTab(tt=>Math.max(tt-1,0))
    }
    touchStartX.current=null
  }

  return(
    <>
      <style>{CSS}</style>
      <div data-theme={theme} className="hp-shell">

        <SidebarDesktop tabs={TABS} active={tab} onSelect={setTab} collapsed={sidebarCollapsed} onToggleCollapse={()=>setSidebarCollapsed(c=>!c)}/>
        <SidebarCompact tabs={TABS} active={tab} onSelect={setTab}/>

        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
          <Topbar current={current}/>

          <div className="hp-main" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
            style={{flex:1,overflow:'hidden',position:'relative'}}>
            <div style={{display:'flex',width:`${TABS.length*100}%`,height:'100%',transform:`translateX(-${tab*(100/TABS.length)}%)`,transition:'transform 0.28s var(--ease)'}}>
              {TABS.map(t2=>(
                <div key={t2.id} style={{width:`${100/TABS.length}%`,height:'100%',overflow:'hidden',flexShrink:0}}>
                  {/* {t2.id==='system'    &&<SystemTab/>} */}
                  {t2.id==='security'  &&<SecurityTab/>}
                  {t2.id==='sensors'   &&<SensorsTab/>}
                  {t2.id==='energy'    &&<EnergyTab/>}
                  {t2.id==='floorPlan' &&<FloorPlanTab/>}
                  {t2.id==='led'       &&<LedTab/>}
                  {t2.id==='devices'   &&<FleetTab/>}
                  {t2.id==='settings'  &&<SettingsTab/>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <NavMobile tabs={TABS} active={tab} onSelect={setTab}/>
      </div>
    </>
  )
}

export default function App(){
  return <StoreProvider><AppInner/></StoreProvider>
}
