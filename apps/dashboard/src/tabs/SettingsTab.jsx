import { useState } from 'react'
import { useStore, useT } from '../store/index.jsx'
import { LANGUAGES }      from '../i18n/index.js'

export function SettingsTab(){
  const {state,setSettingsBulk}=useStore()
  const t=useT()

  // Local draft — only committed on Apply
  const [draft,setDraft]=useState({...state.settings})
  const [applied,setApplied]=useState(false)
  const [confirmReset,setConfirmReset]=useState(false)

  const set=(k,v)=>setDraft(d=>({...d,[k]:v}))

  function apply(){
    setSettingsBulk(draft)
    setApplied(true)
    setTimeout(()=>setApplied(false),2000)
  }

  const S={padding:'var(--sp-2) var(--sp-3)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text)',fontSize:'var(--fs-base)',outline:'none',minWidth:140}
  const Row=({label,sub,children})=>(
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'var(--sp-3) 0',borderBottom:'0.5px solid var(--border)'}}>
      <div>
        <div style={{fontSize:'var(--fs-base)',color:'var(--text2)'}}>{label}</div>
        {sub&&<div style={{fontSize:'var(--fs-xs)',color:'var(--text3)',marginTop:2}}>{sub}</div>}
      </div>
      {children}
    </div>
  )

  return(
    <div style={{height:'100%',overflow:'auto',padding:'var(--sp-5) var(--sp-6)'}}>

      <div className="hp-card" style={{fontSize:'var(--fs-sm)',color:'var(--text3)',marginBottom:'var(--sp-4)',padding:'var(--sp-2) var(--sp-3)'}}>
        Changes are applied only when you click <strong style={{color:'var(--text)'}}>Apply changes</strong>.
        Utility contracts are managed in the <strong style={{color:'#BA7517'}}>Energy</strong> tab.
      </div>

      {/* General */}
      <div style={{marginBottom:'var(--sp-6)'}}>
        <div className="hp-eyebrow" style={{marginBottom:'var(--sp-3)',paddingBottom:'var(--sp-1)',borderBottom:'0.5px solid var(--border)'}}>General</div>

        <Row label={t.settings.language} sub="Applies instantly without reload">
          <select style={S} value={draft.language} onChange={e=>set('language',e.target.value)}>
            {Object.entries(LANGUAGES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </Row>

        <Row label={t.settings.theme}>
          <select style={S} value={draft.theme} onChange={e=>set('theme',e.target.value)}>
            <option value="dark">{t.settings.dark}</option>
            <option value="light">{t.settings.light}</option>
            <option value="auto">{t.settings.auto}</option>
          </select>
        </Row>

        <Row label={t.settings.refreshInterval} sub="How often metrics refresh">
          <input type="number" min="5" max="300" style={{...S,minWidth:80}} value={draft.refreshInterval} onChange={e=>set('refreshInterval',parseInt(e.target.value)||15)}/>
        </Row>

        <Row label={t.settings.defaultWindow} sub="Default chart time window">
          <select style={S} value={draft.defaultTimeWindow} onChange={e=>set('defaultTimeWindow',e.target.value)}>
            {[['h24','24h'],['d3','3 days'],['w1','1 week'],['m1','1 month'],['m3','3 months'],['y1','1 year']].map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </Row>
      </div>

      {/* Apply button */}
      <button onClick={apply} className="hp-focus-visible" style={{width:'100%',padding:'var(--sp-3) 0',borderRadius:'var(--r-md)',border:'none',background: applied?'var(--ok)':'var(--accent-vivid)',color:'#fff',fontSize:'var(--fs-md)',fontWeight:700,cursor:'pointer',transition:'background var(--dur-base)',marginBottom:'var(--sp-6)',boxShadow:'var(--shadow-1)'}}>
        {applied ? t.settings.applied : t.settings.apply}
      </button>

      {/* Danger zone */}
      <div style={{marginBottom:'var(--sp-6)'}}>
        <div className="hp-eyebrow" style={{marginBottom:'var(--sp-3)',paddingBottom:'var(--sp-1)',borderBottom:'0.5px solid var(--border)'}}>
          {t.settings.dangerZone}
        </div>
        {confirmReset
          ?<div style={{background:'color-mix(in srgb, var(--danger) 8%, transparent)',border:'0.5px solid color-mix(in srgb, var(--danger) 27%, transparent)',borderRadius:'var(--r-md)',padding:'var(--sp-4)'}}>
              <div style={{fontSize:'var(--fs-base)',color:'var(--text2)',marginBottom:'var(--sp-3)'}}>{t.settings.confirmReset}</div>
              <div style={{display:'flex',gap:'var(--sp-2)'}}>
                <button className="hp-focus-visible" style={{padding:'var(--sp-2) var(--sp-4)',borderRadius:'var(--r-sm)',border:'0.5px solid var(--border)',background:'var(--bg2)',color:'var(--text2)',cursor:'pointer',fontSize:'var(--fs-base)'}} onClick={()=>setConfirmReset(false)}>{t.common.cancel}</button>
                <button className="hp-focus-visible" style={{padding:'var(--sp-2) var(--sp-4)',borderRadius:'var(--r-sm)',border:'none',background:'var(--danger)',color:'#fff',cursor:'pointer',fontSize:'var(--fs-base)',fontWeight:700}} onClick={()=>{localStorage.clear();window.location.reload()}}>{t.settings.resetAll}</button>
              </div>
            </div>
          :<button className="hp-focus-visible" style={{padding:'var(--sp-3) var(--sp-4)',borderRadius:'var(--r-sm)',border:'0.5px solid color-mix(in srgb, var(--danger) 27%, transparent)',background:'transparent',color:'var(--danger)',cursor:'pointer',fontSize:'var(--fs-base)'}} onClick={()=>setConfirmReset(true)}>{t.settings.resetAll}</button>
        }
      </div>

    </div>
  )
}