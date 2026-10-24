import { usePromInstant, Q, scalar, allSeries } from '../hooks/usePrometheus.js'
import { useDevices } from '../hooks/useDevices.js'

const GRAFANA_SOC = '/grafana/d/ioxg69q/security?kiosk=tv&theme=dark'

function StatusBanner({ allUp, localThreats }) {
  const ok = allUp && localThreats === 0
  return (
    <div className="hp-card hp-card--elevated" style={{
      background: ok ? 'color-mix(in srgb, var(--ok) 10%, transparent)' : 'color-mix(in srgb, var(--warn) 10%, transparent)',
      borderColor: ok ? 'var(--ok)' : 'var(--warn)',
      display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-5)',
    }}>
      <div style={{ fontSize: 32 }}>{ok ? '🛡️' : '⚠️'}</div>
      <div>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: ok ? 'var(--ok)' : 'var(--warn)' }}>
          {ok ? 'Votre maison est protégée' : 'Activité à vérifier'}
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>
          {allUp ? 'Tous les systèmes de sécurité sont actifs' : 'Un service de sécurité est arrêté'}
        </div>
      </div>
    </div>
  )
}

function DevicesSummary() {
  const { devices, loading, counts } = useDevices(30000)
  if (loading && !devices.length) return null

  const total = devices.length
  const active = counts.active || 0
  const expiringSoon = devices.filter(d => {
    if (!d.cert_expiry) return false
    const days = (new Date(d.cert_expiry) - Date.now()) / 86400000
    return days < 14
  })
  const allGood = total > 0 && active === total && expiringSoon.length === 0

  return (
    <div className="hp-card" style={{ marginTop: 'var(--sp-4)', padding: 'var(--sp-5)' }}>
      <div className="hp-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Appareils connectés</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <span style={{ fontSize: 24 }}>{allGood ? '✅' : '⚠️'}</span>
        <div>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>
            {active}/{total} appareils connectés en sécurité
          </div>
          {expiringSoon.length > 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--warn)' }}>
              {expiringSoon.length} certificat(s) à renouveler bientôt
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SecurityTab() {
  const svcs  = usePromInstant(Q.secServices, 30000)
  const local = usePromInstant(Q.bansLocal,   60000)

  const svcList      = allSeries(svcs.value ?? [])
  const allUp        = svcList.length > 0 && svcList.every(s => s.last === 1)
  const localThreats = scalar(local.value)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 'var(--sp-4) var(--sp-5)' }}>
      <StatusBanner allUp={allUp} localThreats={localThreats} />

      <div className="hp-card" style={{ marginTop: 'var(--sp-4)', padding: 'var(--sp-5)', textAlign: 'center' }}>
        <div className="hp-eyebrow">Tentatives bloquées cette semaine</div>
        <div className="hp-kpi-value--hero" style={{ marginTop: 8 }}>{localThreats}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', marginTop: 4 }}>
          Depuis votre réseau uniquement — n'inclut pas la protection communautaire mondiale
        </div>
      </div>

      <DevicesSummary />

      <a href={GRAFANA_SOC} target="_blank" rel="noopener noreferrer" className="hp-focus-visible" style={{
        display: 'block', marginTop: 'var(--sp-4)', textAlign: 'center', padding: 'var(--sp-3)',
        borderRadius: 'var(--r-md)', border: '0.5px solid var(--border)', color: 'var(--text2)', textDecoration: 'none',
      }}>
        Voir le détail technique →
      </a>
    </div>
  )
}