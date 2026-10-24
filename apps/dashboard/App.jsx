import { useState } from 'react'
import { SystemTab } from './tabs/SystemTab.jsx'
import { SecurityTab } from './tabs/SecurityTab.jsx'
import { SensorsTab } from './tabs/SensorsTab.jsx'
import { EnergyTab } from './tabs/EnergyTab.jsx'
import { FleetTab } from './tabs/FleetTab.jsx'
import { FloorPlanEditor } from './components/FloorPlanEditor.jsx'
import { SettingsTab } from './tabs/SettingsTab.jsx'

const TABS = [
  { id: 'system',    label: 'System',    icon: '▣', color: '#378ADD' },
  { id: 'security',  label: 'Security',  icon: '⬡', color: '#D85A30' },
  { id: 'sensors',   label: 'Sensors',   icon: '◈', color: '#1D9E75' },
  { id: 'energy',    label: 'Energy',    icon: '◎', color: '#BA7517' },
  { id: 'floorplan', label: 'Floor Plan',icon: '⌂', color: '#7F77DD' },
  { id: 'fleet',     label: 'Devices',   icon: '◉', color: '#5BA8F5' },
  { id: 'settings',  label: 'Settings',  icon: '⚙', color: '#9CA3AF' },
]

export default function App() {
  const [tab, setTab] = useState(0)
  const [theme, setTheme] = useState('dark')

  const current = TABS[tab]

  return (
    <>
      <style>{`
        :root { --bg: #0d0f14; --bg2: #141720; --accent: #378ADD; }
        [data-theme="light"] { --bg: #f8f9fc; --bg2: #ffffff; }
      `}</style>

      <div data-theme={theme} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, sans-serif' }}>
        {/* Top Bar */}
        <div style={{ height: 52, borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 20px', background: 'var(--bg2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: current.color + '22', color: current.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
              {current.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>HomePi</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>homepi.internal</div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '0.5px solid var(--border)', background: 'var(--bg2)' }}>
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTab(i)}
              style={{
                padding: '14px 20px',
                borderBottom: tab === i ? `3px solid ${t.color}` : '3px solid transparent',
                color: tab === i ? t.color : 'var(--text2)',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: tab === i ? 600 : 500,
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {current.id === 'system' && <SystemTab />}
          {current.id === 'security' && <SecurityTab />}
          {current.id === 'sensors' && <SensorsTab />}
          {current.id === 'energy' && <EnergyTab />}
          {current.id === 'floorplan' && <FloorPlanEditor />}
          {current.id === 'fleet' && <FleetTab />}
          {current.id === 'settings' && <SettingsTab />}
        </div>
      </div>
    </>
  )
}