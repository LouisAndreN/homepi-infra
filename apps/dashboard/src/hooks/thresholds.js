// Source unique de vérité pour les seuils vert/jaune/rouge par métrique.
// Utilisé par FloorPlanEditor (heatmap + graphe normalisé), SensorsTab et FleetTab/DeviceDetailModal.
// Toute modification de seuil se fait ICI UNIQUEMENT — ne jamais redéfinir localement.

export const STATUS_RANGES = {
  temperature: { lowRed:18, lowYellow:20, highYellow:26, highRed:30 },
  humidity:    { lowRed:25, lowYellow:30, highYellow:60, highRed:70 },
  co2:         { highYellow:800, highRed:1000 },
  lux:         { lowRed:15, lowYellow:30, highYellow:130 },
  iaq:         { highYellow:50, highRed:100 },
}

export function statusColorForValue(metric, value) {
  const r = STATUS_RANGES[metric]
  if (!r || value == null || isNaN(value)) return 'var(--text2)'
  if (r.lowRed != null && value < r.lowRed) return 'var(--danger)'
  if (r.lowYellow != null && value < r.lowYellow) return 'var(--warn)'
  if (r.highRed != null && value >= r.highRed) return 'var(--danger)'
  if (r.highYellow != null && value >= r.highYellow) return 'var(--warn)'
  return 'var(--ok)'
}

// Hex bruts correspondant aux tokens CSS --ok/--warn/--danger/--text3 — nécessaires
// pour tout rendu pixel par pixel (canvas), où les CSS var() ne sont pas résolues.
export const STATUS_HEX = { ok:'#1D9E75', warn:'#EF9F27', danger:'#E24B4A', neutral:'#656c8c' }

export function statusHexForValue(metric, value) {
  const c = statusColorForValue(metric, value)
  if (c === 'var(--ok)') return STATUS_HEX.ok
  if (c === 'var(--warn)') return STATUS_HEX.warn
  if (c === 'var(--danger)') return STATUS_HEX.danger
  return STATUS_HEX.neutral
}

// Normalise une valeur en [-1, +1] par rapport aux limites acceptables de la métrique.
// -1 = limite basse acceptable, +1 = limite haute acceptable (même convention que le
// tableau de bord de référence). Quand la métrique n'a pas de lowRed défini (CO2, IAQ —
// qui n'ont pas de "trop bas" physiquement significatif), le plancher du domaine
// d'affichage (METRIC_DOMAIN) sert de repère bas, par convention d'affichage, pas comme
// seuil réel. Léger dépassement autorisé au-delà de ±1 (clampé à ±1.5) pour visualiser
// les dépassements, plutôt qu'un clamp strict qui écraserait l'info visuellement.
export function normalizeValue(metric, value) {
  const r = STATUS_RANGES[metric]
  if (!r || value == null || isNaN(value)) return null
  const domain = METRIC_DOMAIN[metric]
  const low  = r.lowRed  ?? domain?.[0] ?? value
  const high = r.highRed ?? domain?.[1] ?? value
  if (high === low) return 0
  const n = (2 * (value - low)) / (high - low) - 1
  return Math.max(-1.5, Math.min(1.5, n))
}

export const METRIC_DOMAIN = { temperature:[15,32], humidity:[0,100], co2:[400,1500], lux:[0,150] }
export const METRIC_UNIT  = { temperature:'°C', humidity:'%', co2:'ppm', lux:'lx', iaq:'', pressure:'hPa' }
export const METRIC_LABEL = { temperature:'Température', humidity:'Humidité', co2:'CO₂', lux:'Luminosité', iaq:'IAQ', pressure:'Pression' }

// Palette fixe par métrique pour l'identité des séries dans les graphes multi-courbes
// (NormalizedMultiChart) — distincte de statusColorForValue (qui code un statut de
// dangerosité), ici c'est une identité visuelle constante par métrique.
export const METRIC_SERIES_COLOR = {
  temperature: '#D85A30',
  humidity:    '#378ADD',
  co2:         '#1D9E75',
  lux:         '#EF9F27',
  iaq:         '#7F77DD',
  pressure:    '#9990EE',
}


// Métriques comptant pour le score de confort composite — luminosité exclue
// (pas de "zone acceptable" universelle, sert à la détection d'événements,
// pas au confort), pression exclue (suit la météo extérieure, non-actionnable
// par l'occupant, ajoute du bruit au score sans info utile).
export const COMFORT_METRICS = ['co2','temperature','humidity','iaq']

export const STATUS_HEX_COMPOSITE = { ok:'#1D9E75', warn:'#EF9F27', bad:'#E07B39', danger:'#E24B4A', neutral:'#3a3f52' }

// Score de confort composite pour un point/pixel donné : moyenne de l'excès
// au-delà des limites acceptables sur toutes les métriques de confort
// disponibles à ce point. 0 = parfaitement dans les clous partout,
// plus la valeur grimpe plus les dépassements sont sévères ou nombreux.
// Pondéré par la gravité (pas juste un comptage binaire) pour éviter qu'un
// léger dépassement isolé ne fasse basculer tout le score en alerte.
export function compositeExcess(valuesByMetric) {
  let total = 0, count = 0
  for (const m of COMFORT_METRICS) {
    const v = valuesByMetric[m]
    if (v == null || isNaN(v)) continue
    const n = normalizeValue(m, v)
    if (n == null) continue
    count++
    total += Math.max(0, Math.abs(n) - 1)
  }
  if (count === 0) return null
  return total / count
}

export function colorForExcess(excess) {
  if (excess == null) return STATUS_HEX_COMPOSITE.neutral
  if (excess < 0.05) return STATUS_HEX_COMPOSITE.ok
  if (excess < 0.25) return STATUS_HEX_COMPOSITE.warn
  if (excess < 0.6)  return STATUS_HEX_COMPOSITE.bad
  return STATUS_HEX_COMPOSITE.danger
}

// % de temps (ou de mesures) où TOUTES les métriques de confort disponibles
// sont simultanément dans leur zone acceptable — la mesure "CV" centrale.
// points : tableau de { valuesByMetric } — une entrée par instant échantillonné.
export function comfortScorePct(points) {
  if (!points.length) return null
  let goodCount = 0, validCount = 0
  for (const p of points) {
    const excess = compositeExcess(p.valuesByMetric)
    if (excess == null) continue
    validCount++
    if (excess < 0.05) goodCount++ // seuil "acceptable" = même seuil que le vert de la heatmap
  }
  if (validCount === 0) return null
  return (goodCount / validCount) * 100
}