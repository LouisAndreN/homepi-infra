import { useState } from 'react'
import { FloorPlanEditor } from '../editor/FloorPlanEditor.jsx'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { useT } from '../store/index.jsx'

// Reflète TIMELINE_RANGES de FloorPlanEditor.jsx — dupliqué ici car ce fichier ne peut
// pas importer une const interne non exportée de l'éditeur. Si tu changes les plages
// là-bas, pense à les refléter ici aussi.
const RANGE_QUERY = {
  h24: { start: '-24h', every: '5m' },
  d7:  { start: '-7d',  every: '1h' },
  d30: { start: '-30d', every: '6h' },
}

export function FloorPlanTab() {
  const t = useT()
  const [rangeKey, setRangeKey] = useState('h24')
  const { start, every } = RANGE_QUERY[rangeKey] || RANGE_QUERY.h24

  // Données live des capteurs — mêmes requêtes que SensorsTab, pour que le
  // panneau de détail au clic dans le plan affiche des valeurs réelles et
  // non un objet vide (deviceReadings n'était jamais alimenté auparavant).
  const allLast  = useFlux(FLUX.allLast(),  10000)


  const byDevice = {}
  for (const row of allLast.data ?? []) {
    if (!row.device_id || !row._field || !row._value) continue
    if (!byDevice[row.device_id]) byDevice[row.device_id] = {}
    byDevice[row.device_id][row._field] = row._value
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <FloorPlanEditor deviceReadings={byDevice} onRangeChange={setRangeKey}/>
    </div>
  )
}
