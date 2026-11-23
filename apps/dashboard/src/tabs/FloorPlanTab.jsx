import { useState } from 'react'
import { FloorPlanEditor } from '../editor/FloorPlanEditor.jsx'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { useT } from '../store/index.jsx'

// Mirrors TIMELINE_RANGES of FloorPlanEditor.jsx; duplicated here because this file cannot
// import an internal, non-exported const of the editor. If you change the ranges
// there, remember to mirror them here too.
const RANGE_QUERY = {
  h24: { start: '-24h', every: '5m' },
  d7:  { start: '-7d',  every: '1h' },
  d30: { start: '-30d', every: '6h' },
}

export function FloorPlanTab() {
  const t = useT()
  const [rangeKey, setRangeKey] = useState('h24')
  const { start, every } = RANGE_QUERY[rangeKey] || RANGE_QUERY.h24

  // Live sensor data: the same queries as SensorsTab, so that the
  // detail panel opened by a click on the plan shows real values and
  // not an empty object (deviceReadings was never fed before).
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
