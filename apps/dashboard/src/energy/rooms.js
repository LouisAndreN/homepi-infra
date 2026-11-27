// Rooms for the timeline, derived from the floor plan editor (no second source of truth):
// zones come from the walls (detectZones, flood fill), sensors and appliances are assigned to the
// zone containing them. A zone is named after the appliances and furniture it contains when the plan
// has any ("Zone 2 · Fridge, Microwave"), otherwise "Zone N".
import { detectZones, assignSensorsToZones } from '../editor/zoneDetection.js'
import { raySegIntersect } from '../editor/FloorPlanEditor.jsx'

const d2 = (ax, ay, bx, by) => Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)

function zoneOfPoint(x, y, zones) {
  let best = null, bestD = Infinity
  for (const z of zones) for (const c of z.cells) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2
    if (d < bestD) { bestD = d; best = z.id }
  }
  return best
}

// db: the floorplans document ({buildings:[{apartments:[{floors:[...]}]}]}).
// Returns [{key, label, floor, deviceIds:[...], appliances:[{label, watts}]}], rooms with at
// least one sensor first (they are the only ones with environmental data).
export function roomsFromPlan(db) {
  const rooms = []
  for (const b of db?.buildings || []) for (const a of b.apartments || []) for (const f of a.floors || []) {
    const zones = detectZones(f, raySegIntersect, d2)
    if (!zones.length) continue
    const sensorZone = assignSensorsToZones((f.sensors || []).filter(s => s.deviceId), zones)
    zones.forEach((z, i) => {
      const inZone = el => zoneOfPoint(el.x + (el.w || 0) / 2, el.y + (el.h || 0) / 2, zones) === z.id
      const appliances = (f.appliances || []).filter(inZone).map(x => ({ label: x.label, watts: x.watts }))
      const furniture = (f.furniture || []).filter(inZone).map(x => x.label)
      const deviceIds = Object.entries(sensorZone).filter(([, zid]) => zid === z.id).map(([id]) => id)
      const names = [...appliances.map(x => x.label), ...furniture].filter(Boolean).slice(0, 3)
      rooms.push({
        key: `${f.id || f.name}:${i}`,
        label: names.length ? `Zone ${i + 1} · ${names.join(', ')}` : `Zone ${i + 1}`,
        floor: f.name || '',
        deviceIds, appliances,
      })
    })
  }
  return rooms.sort((x, y) => (y.deviceIds.length > 0) - (x.deviceIds.length > 0))
}

// Fixed categorical order (dark-surface steps of the validated palette): a room keeps its colour
// whatever the metric or the range, colour follows the entity, never its rank.
export const ROOM_COLORS = ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263']
