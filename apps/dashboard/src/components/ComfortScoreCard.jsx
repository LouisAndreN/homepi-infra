import { useComfortScore } from '../hooks/useComfortScore.js'

// Le chiffre central du dashboard — "quelle proportion du temps mon appart
// est-il dans un état de confort acceptable, sur toutes les métriques
// simultanément". Score global (tout l'appart) — le filtrage par zone se fait
// désormais via le mode Analyse (AnalysisPanel), pas ici.
export function ComfortScoreCard({ start='-24h', every='10m', label='24h' }) {
  const { score, loading } = useComfortScore(start, every)
  const color = score == null ? 'var(--text3)' : score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--danger)'
  return (
    <div className="hp-card" style={{ padding:'var(--sp-4)', textAlign:'center' }}>
      <div className="hp-eyebrow" style={{ marginBottom:'var(--sp-2)' }}>Confort environnemental · {label}</div>
      {loading
        ? <div style={{ fontSize:'var(--fs-xl)', color:'var(--text3)' }}>…</div>
        : <div style={{ fontSize:'var(--fs-xl)', fontFamily:'var(--mono)', fontWeight:700, color }}>
            {score != null ? `${score.toFixed(0)}%` : '—'}
          </div>
      }
      <div style={{ fontSize:'var(--fs-2xs)', color:'var(--text3)', marginTop:4 }}>
        du temps toutes métriques dans la zone acceptable
      </div>
    </div>
  )
}