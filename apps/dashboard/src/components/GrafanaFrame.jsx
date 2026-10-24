import { useState } from 'react'
import { GRAFANA_BASE, GRAFANA_KIOSK } from '../config.js'

export function GrafanaFrame({ dash }) {
  const [loaded, setLoaded] = useState(false)
  const url = `${GRAFANA_BASE}/d/${dash.uid}/${dash.slug}?orgId=1&${GRAFANA_KIOSK}`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!loaded && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg)', gap: 14,
        }}>
          <div style={{
            width: 28, height: 28,
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}/>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            Chargement {dash.label}…
          </span>
        </div>
      )}
      <iframe
        key={dash.uid}
        src={url}
        onLoad={() => setLoaded(true)}
        title={dash.label}
        allow="fullscreen"
        style={{
          width: '100%', height: '100%', border: 'none',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.4s',
        }}
      />
    </div>
  )
}
