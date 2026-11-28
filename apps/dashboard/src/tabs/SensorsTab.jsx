import { RoomTimeline } from '../components/RoomTimeline.jsx'
import { useNilmLegs } from '../hooks/useNilmLegs.js'

// Sensors: the Timeline (moved from Energy in v1.6.0). One panel per metric on one shared time axis, one
// line per room, the event strip at the bottom. The gauges and per-device cards that were here are gone:
// the floor plan and the Devices tab already show the latest values per sensor.
export function SensorsTab() {
  const { legs } = useNilmLegs()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <RoomTimeline legs={legs} />
    </div>
  )
}
