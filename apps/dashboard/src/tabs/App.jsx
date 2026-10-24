import { useState, useRef } from 'react'
import { GrafanaFrame }  from './components/GrafanaFrame.jsx'
import { EnergyTab }     from './tabs/EnergyTab.jsx'
import { FleetTab }      from './tabs/FleetTab.jsx'
import { GRAFANA_DASHBOARDS } from './config.js'

// ── Design tokens ──────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --bg:     #0d0f14;
    --bg2:    #141720;
    --bg3:    #1a1e2b;
    --text:   #e2e4ec;
    --text2:  #8b90a8;
    --text3:  #565c72;
    --border: rgba(255,255,255,.07);
    --accent: #378ADD;
    --font:   'Inter', system-ui, sans-serif;
    --mono:   'JetBrains Mono', monospace;
    --header: 44px;
    --tabs:   48px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:     #f5f6f9;
      --bg2:    #ffffff;
      --bg3:    #eef0f5;
      --text:   #111218;
      --text2:  #6b7280;
      --text3:  #9ca3af;
      --border: rgba(0,0,0,.07);
    }
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    height: 100dvh;
    overflow: hidden;
  }

  button, input { font-family: var(--font); }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`

// ── Tabs definition ────────────────────────────────────────────
const TABS = [
  { id: 'system',   label: 'Système',   icon: '▣', color: '#378ADD' },
  { id: 'security', label: 'Sécurité',  icon: '⬡', color: '#D85A30' },
  { id: 'sensors',  label: 'Capteurs',  icon: '◈', color: '#1D9E75' },
  { id: 'energy',   label: 'Énergie',   icon: '◎', color: '#BA7517' },
  { id: 'fleet',    label: 'Appareils', icon: '◉', color: '#7F77DD' },
]

// ── System status indicator (top bar) ─────────────────────────
function StatusDot({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text3)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }}/>
      {label}
    </span>
  )
}

export default function App() {
  const [tab,   setTab]   = useState(0)
  const [theme, setTheme] = useState('system')
  const touchX = useRef(null)
  const current = TABS[tab]

  // Swipe detection
  function onTouchStart(e) { touchX.current = e.touches[0].clientX }
  function onTouchEnd(e) {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) > 55) {
      if (dx < 0) setTab(t => Math.min(t + 1, TABS.length - 1))
      else         setTab(t => Math.max(t - 1, 0))
    }
    touchX.current = null
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>

        {/* ── Top bar ────────────────────────────────────────── */}
        <div style={{
          height: 'var(--header)', display: 'flex', alignItems: 'center',
          padding: '0 16px', borderBottom: '0.5px solid var(--border)',
          background: 'var(--bg)', flexShrink: 0, gap: 12, zIndex: 20,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: `linear-gradient(135deg, ${current.color}cc, ${current.color}55)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: '#fff', flexShrink: 0,
            }}>{current.icon}</div>
            <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>HomePi</span>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              homepi.internal
            </span>
          </div>

          {/* Status indicators */}
          <div style={{ display: 'flex', gap: 12, marginLeft: 8 }}>
            <StatusDot color="#1D9E75" label="MQTT"/>
            <StatusDot color="#1D9E75" label="InfluxDB"/>
            <StatusDot color="#1D9E75" label="Grafana"/>
          </div>

          {/* Right actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>{current.label}</span>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              style={{
                padding: '4px 8px', borderRadius: 6,
                border: '0.5px solid var(--border)', background: 'var(--bg2)',
                color: 'var(--text2)', fontSize: 11, cursor: 'pointer',
              }}>
              {theme === 'dark' ? '☀' : '☽'}
            </button>
          </div>
        </div>

        {/* ── Tab bar ────────────────────────────────────────── */}
        <div style={{
          height: 'var(--tabs)', display: 'flex',
          borderBottom: '0.5px solid var(--border)',
          background: 'var(--bg)', flexShrink: 0, overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          {TABS.map((t, i) => {
            const active = tab === i
            return (
              <button key={t.id} onClick={() => setTab(i)} style={{
                flex: 1, minWidth: 80, border: 'none',
                background: 'transparent', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 3, position: 'relative',
                color: active ? t.color : 'var(--text3)',
                transition: 'color 0.15s',
              }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>{t.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.03em' }}>{t.label}</span>
                {active && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: '12%', right: '12%',
                    height: 2, borderRadius: 2, background: t.color,
                    transition: 'background 0.2s',
                  }}/>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Content ────────────────────────────────────────── */}
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        >
          <div style={{
            display: 'flex', width: `${TABS.length * 100}%`, height: '100%',
            transform: `translateX(-${tab * (100 / TABS.length)}%)`,
            transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}>
            {TABS.map(t => (
              <div key={t.id} style={{ width: `${100 / TABS.length}%`, height: '100%', overflow: 'hidden' }}>
                {t.id === 'system'   && <GrafanaFrame dash={GRAFANA_DASHBOARDS.system}/>}
                {t.id === 'security' && <GrafanaFrame dash={GRAFANA_DASHBOARDS.security}/>}
                {t.id === 'sensors'  && <GrafanaFrame dash={GRAFANA_DASHBOARDS.sensors}/>}
                {t.id === 'energy'   && <EnergyTab/>}
                {t.id === 'fleet'    && <FleetTab/>}
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
