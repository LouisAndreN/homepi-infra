// Automatic detection of zones (rooms) from the wall geometry:
// flood fill on a discretised grid rather than polygon reconstruction,
// more robust to the flaws of a hand-drawn plan (walls that do not
// meet exactly to the pixel, open corners). The cost is paid
// once per geometry change (walls/openings), not per frame.

const ZONE_GRID_STEP = 24 // coarser than HM_STEP (heatmap): enough for the topology, fewer cells to visit

function segBlocked(x1,y1,x2,y2,walls,raySegIntersect,d2){
  const dist = d2(x1,y1,x2,y2)
  if (dist < 0.01) return false
  const dx=(x2-x1)/dist, dy=(y2-y1)/dist
  for (const w of walls) {
    const buffer = (w.thickness||10)/2 + 1
    const t = raySegIntersect(x1,y1,dx,dy,w.x1,w.y1,w.x2,w.y2)
    if (t !== null && t < dist - buffer) return true
  }
  return false
}

// Computes the connected zones for a given floor. Returns an array of zones,
// chacune { id, cells:[{x,y}...], bounds:{minX,maxX,minY,maxY} }.
export function detectZones(floor, raySegIntersect, d2) {
  const walls = floor.walls || []
  if (!walls.length) return []

  const xs = walls.flatMap(w=>[w.x1,w.x2])
  const ys = walls.flatMap(w=>[w.y1,w.y2])
  const minX = Math.min(...xs)-40, maxX = Math.max(...xs)+40
  const minY = Math.min(...ys)-40, maxY = Math.max(...ys)+40
  const cols = Math.ceil((maxX-minX)/ZONE_GRID_STEP)
  const rows = Math.ceil((maxY-minY)/ZONE_GRID_STEP)
  if (cols*rows > 40000) return [] // safeguard: abnormally large plan, avoids an explosive computation

  const cellX = i => minX + i*ZONE_GRID_STEP + ZONE_GRID_STEP/2
  const cellY = j => minY + j*ZONE_GRID_STEP + ZONE_GRID_STEP/2
  const idx = (i,j) => j*cols+i

  const visited = new Uint8Array(cols*rows)
  const zoneOf = new Int32Array(cols*rows).fill(-1)
  const zones = []

  for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) {
    const k = idx(i,j)
    if (visited[k]) continue
    // BFS from this cell
    const queue = [k]
    visited[k] = 1
    const cells = []
    while (queue.length) {
      const cur = queue.pop()
      const ci = cur % cols, cj = Math.floor(cur/cols)
      cells.push({x:cellX(ci), y:cellY(cj), i:ci, j:cj})
      const neighbors = [[ci+1,cj],[ci-1,cj],[ci,cj+1],[ci,cj-1]]
      for (const [ni,nj] of neighbors) {
        if (ni<0||ni>=cols||nj<0||nj>=rows) continue
        const nk = idx(ni,nj)
        if (visited[nk]) continue
        if (segBlocked(cellX(ci),cellY(cj),cellX(ni),cellY(nj),walls,raySegIntersect,d2)) continue
        visited[nk] = 1
        queue.push(nk)
      }
    }
    if (cells.length < 3) continue // noise: an isolated cell stuck between walls, not a real room
    const zoneId = zones.length
    for (const c of cells) zoneOf[idx(c.i,c.j)] = zoneId
    const cxs = cells.map(c=>c.x), cys = cells.map(c=>c.y)
    zones.push({
      id: zoneId,
      cells,
      bounds: { minX:Math.min(...cxs), maxX:Math.max(...cxs), minY:Math.min(...cys), maxY:Math.max(...cys) },
    })
  }
  return zones
}

// Assigns each sensor to its zone: looks for the cell closest to the
// sensor position among all detected zones.
export function assignSensorsToZones(sensors, zones) {
  const assignment = {} // deviceId -> zoneId
  for (const s of sensors) {
    let bestZone = null, bestDist = Infinity
    for (const z of zones) {
      for (const c of z.cells) {
        const d = (c.x-s.x)**2 + (c.y-s.y)**2
        if (d < bestDist) { bestDist = d; bestZone = z.id }
      }
    }
    if (bestZone != null && s.deviceId) assignment[s.deviceId] = bestZone
  }
  return assignment
}

// Default readable name for a zone, based on its relative size for lack of
// anything better (the user can rename it by hand later if needed).
export function labelZones(zones) {
  return zones.map((z,i) => ({ ...z, label: `Zone ${i+1}` }))
}