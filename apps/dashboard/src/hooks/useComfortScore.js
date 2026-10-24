import { useMemo } from 'react'
import { useFlux, FLUX } from './useInflux.js'
import { comfortScorePct, compositeExcess } from './thresholds.js'
import { detectZones, assignSensorsToZones } from '../editor/zoneDetection.js'

// Regroupe les lignes CSV par timestamp arrondi (bucket d'agrégation), moyenne
// tous les devices ensemble pour chaque métrique à cet instant — approxime
// "l'état moyen de l'appart" à ce moment-là. Simplification assumée : ne
// distingue pas les pièces, un futur raffinement pourrait pondérer par device
// le plus représentatif d'une zone plutôt qu'une moyenne plate.
function groupByTimestamp(rows) {
  const byTs = {}
  for (const r of rows) {
    if (!r._time || !r._field || r._value === '') continue
    const ts = r._time
    if (!byTs[ts]) byTs[ts] = {}
    if (!byTs[ts][r._field]) byTs[ts][r._field] = []
    const v = parseFloat(r._value)
    if (!isNaN(v)) byTs[ts][r._field].push(v)
  }
  return Object.entries(byTs).map(([ts, fields]) => {
    const valuesByMetric = {}
    for (const f in fields) valuesByMetric[f] = fields[f].reduce((a,b)=>a+b,0)/fields[f].length
    return { t: new Date(ts).getTime(), valuesByMetric }
  }).sort((a,b)=>a.t-b.t)
}

// Score de confort composite sur une fenêtre glissante — % du temps où toutes
// les métriques de confort sont simultanément dans leur zone acceptable.
export function useComfortScore(start='-24h', every='10m', interval=60000) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(start, every), interval)
  const points = useMemo(() => groupByTimestamp(data ?? []), [data])
  const score = useMemo(() => comfortScorePct(points), [points])
  return { score, points, loading }
}

// Agrégation journalière — une valeur de score par jour, sur les N derniers
// jours. Nécessaire pour le graphe mensuel : la métrique brute lissée sur 30
// jours ne dit rien (cycles jour/nuit noient tout), l'agrégat journalier du
// score composite, lui, montre une vraie tendance.
export function useComfortScoreDaily(days=30) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(`-${days}d`, '15m', 300000), 300000)
  const daily = useMemo(() => {
    const points = groupByTimestamp(data ?? [])
    const byDay = {}
    for (const p of points) {
      const dayKey = new Date(p.t).toISOString().slice(0,10)
      if (!byDay[dayKey]) byDay[dayKey] = []
      byDay[dayKey].push(p)
    }
    return Object.entries(byDay).map(([day, pts]) => ({
      day,
      t: new Date(day).getTime(),
      score: comfortScorePct(pts),
      // Écart-type des excès du jour — donne une idée de la stabilité intra-journée,
      // affichable comme bande autour de la ligne principale.
      stdExcess: (() => {
        const excesses = pts.map(p=>compositeExcess(p.valuesByMetric)).filter(e=>e!=null)
        if (excesses.length < 2) return null
        const mean = excesses.reduce((a,b)=>a+b,0)/excesses.length
        const variance = excesses.reduce((a,b)=>a+(b-mean)**2,0)/excesses.length
        return Math.sqrt(variance)
      })(),
    })).sort((a,b)=>a.t-b.t)
  }, [data])
  return { daily, loading }
}

// Score de confort filtré sur les devices d'une zone donnée. zoneDeviceIds :
// liste de device_id appartenant à la zone (calculée une fois via
// assignSensorsToZones, passée en dépendance stable — pas recalculée ici).
export function useComfortScoreForZone(zoneDeviceIds, start='-24h', every='10m', interval=60000) {
  const { data, loading } = useFlux(FLUX.allMetricsHistory(start, every), interval)
  const points = useMemo(() => {
    const filtered = (data ?? []).filter(r => zoneDeviceIds.includes(r.device_id))
    return groupByTimestamp(filtered)
  }, [data, zoneDeviceIds])
  const score = useMemo(() => comfortScorePct(points), [points])
  return { score, points, loading }
}