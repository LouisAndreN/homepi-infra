import { useState, useEffect, useCallback } from 'react'

const INFLUX_ORG   = 'iot-org'
const INFLUX_TOKEN = import.meta.env.VITE_INFLUX_TOKEN ?? ''
const BASE         = '/influx'

// Découpe UNE ligne CSV en respectant les champs entre guillemets (RFC 4180) —
// une virgule à l'intérieur d'une paire de guillemets ("bme688,bh1750") ne doit
// PAS être traitée comme séparateur de colonne. split(',') naïf décale toutes
// les colonnes suivantes dès qu'un champ comme active_sensors contient une
// virgule interne, ce qui corrompait device_id (ex: devenait littéralement
// bh1750" avec le guillemet parasite) et fusionnait deux appareils physiques
// distincts sous une seule clé dans byDevice en aval.
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        // Guillemet doublé à l'intérieur d'un champ quoté = guillemet littéral échappé
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// Parse la réponse InfluxDB CSV — gère plusieurs blocs annotés dans une même réponse.
// Une requête groupée (ex. group(columns:["device_id","_field"])) peut produire des
// tables aux colonnes hétérogènes ; InfluxDB répète alors une ligne d'en-tête
// (",result,table,...") au début de chaque nouveau bloc. On adopte ce nouvel en-tête
// à chaque fois qu'on le rencontre, qu'il s'agisse du tout premier bloc ou d'un bloc
// ultérieur aux colonnes différentes.
function parseCSV(csv) {
  if (!csv?.trim()) return []
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  if (lines.length < 2) return []

  const isHeaderLine = l => l.startsWith(',result,') || l.startsWith('result,')
  const rows = []
  let headers = null

  for (const line of lines) {
    if (isHeaderLine(line)) {
      headers = splitCsvLine(line).map(h => h.trim())
      continue
    }
    if (!headers) continue // ligne de données avant tout en-tête connu — ne devrait pas arriver, mais on ignore plutôt que de deviner
    const vals = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() ?? '' })
    rows.push(row)
  }

  return rows.filter(r => r._value !== '' && r._value !== undefined)
}

export async function fluxQuery(flux) {
  const r = await fetch(`${BASE}/api/v2/query?org=${INFLUX_ORG}`, {
    method:  'POST',
    headers: {
      'Authorization': `Token ${INFLUX_TOKEN}`,
      'Content-Type':  'application/vnd.flux',
      'Accept':        'application/csv',
    },
    body: flux.trim(),
  })
  if (!r.ok) throw new Error(`InfluxDB ${r.status}`)
  return parseCSV(await r.text())
}

export function useFlux(flux, interval = 15000) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const run = useCallback(async () => {
    if (!flux) return
    try {
      const res = await fluxQuery(flux)
      setData(res)
      setError(null)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }, [flux])

  useEffect(() => {
    run()
    const t = setInterval(run, interval)
    return () => clearInterval(t)
  }, [run, interval])

  return { data, loading, error, refresh: run }
}

// Flux queries exactes de tes dashboards Grafana
// Flux queries exactes de tes dashboards Grafana
export const FLUX = {
  lastByDevice: (field, bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._field == "${field}")
  |> last()
  |> group(columns: ["device_id"])`,

  history: (field, start = '-1h', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)`,

  allLast: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) =>
      r._field == "temperature" or
      r._field == "humidity" or
      r._field == "co2" or
      r._field == "lux" or
      r._field == "iaq" or
      r._field == "pressure")
  |> last()
  |> group(columns: ["device_id", "_field"])`,

  // Dernier point vu par device, tous champs confondus — alimente le badge "Live"
  // temps réel (FleetTab / DeviceDetailModal).
  lastSeenAll: (start = '-10m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) =>
      r._field == "temperature" or
      r._field == "humidity" or
      r._field == "co2" or
      r._field == "lux" or
      r._field == "iaq" or
      r._field == "pressure")
  |> group(columns: ["device_id"])
  |> last()
  |> keep(columns: ["device_id", "_time", "_field", "_value"])`,

  // Segments présence/absence sur une fenêtre — alimente la barre chronologique
  // du DeviceDetailModal. createEmpty:true est CRITIQUE : sans lui Flux omet les
  // buckets vides et le gap de connectivité disparaît silencieusement.
  presenceWindow: (deviceId, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r.device_id == "${deviceId}")
  |> filter(fn: (r) => r._field == "temperature" or r._field == "co2" or r._field == "humidity")
  |> aggregateWindow(every: ${every}, fn: count, createEmpty: true)
  |> keep(columns: ["_time", "_value"])`,

  // CO2 trend
  co2Trend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "co2")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Température trend
  tempTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "temperature")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Humidité trend
  humidityTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "humidity")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Luminosité trend
  luxTrend: (start = '-6h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "lux")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)`,

  // Historique d'une métrique quelconque, groupé par device_id — utilisé par la barre
  // chronologique du plan (FloorPlanEditor, heatmap scrubber) et par SensorsTab/DeviceDetailModal.
  metricHistory: (field, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> group(columns: ["device_id"])`,

  // Historique de TOUTES les métriques disponibles pour UN device en une seule requête —
  // alimente le graphe combiné normalisé du panneau de détail FloorPlanEditor. Une seule
  // query plutôt qu'une par métrique : évite d'appeler useFlux() un nombre variable de
  // fois selon le sensor cliqué (violerait les rules-of-hooks).
  metricsHistoryForDevice: (deviceId, start = '-24h', every = '5m', bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) => r.device_id == "${deviceId}")
  |> filter(fn: (r) =>
      r._field == "temperature" or r._field == "humidity" or
      r._field == "co2" or r._field == "lux" or
      r._field == "iaq" or r._field == "pressure")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value"])`,

  // Humidité 24h
  humidity24h: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._field == "humidity")
  |> aggregateWindow(every: 15m, fn: mean, createEmpty: false)`,

  // Comfort index (simplifié ASHRAE 55 comme dans ton Grafana)
  comfort: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._field == "temperature" or r._field == "humidity")
  |> last()
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> map(fn: (r) => ({
    r with comfort:
      if r.temperature < 20.0 then 95.0
      else if r.temperature < 22.0 then 85.0
      else if r.temperature < 26.0 then 70.0
      else 40.0
  }))
  |> keep(columns: ["_time", "device_id", "comfort"])`,

  // Status devices (last seen)
  deviceStatus: (bucket = 'iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "device_status")
  |> filter(fn: (r) => r._field == "rssi")
  |> last()
  |> group(columns: ["device_id"])`,


  // Historique multi-métriques TOUS DEVICES confondus sur une fenêtre — sert au
  // calcul du score de confort composite temporel (comfortScorePct). Contrairement
  // à metricsHistoryForDevice (un seul device), celle-ci ramène tout l'appart :
  // le score composite doit refléter l'état global, pas un seul capteur.
  allMetricsHistory: (start='-24h', every='10m', bucket='iot-hot') => `
from(bucket: "${bucket}")
  |> range(start: ${start})
  |> filter(fn: (r) =>
      r._field == "temperature" or r._field == "humidity" or
      r._field == "co2" or r._field == "iaq")
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_field", "_value", "device_id"])`,
}