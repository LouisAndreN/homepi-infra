import { useState } from 'react'
import { useFlux, FLUX } from '../hooks/useInflux.js'
import { statusColorForValue } from '../hooks/thresholds.js'
import { Gauge } from '../components/Gauge.jsx'
import { Sparkline, StatCard } from '../components/Charts.jsx'

function Card({ children, style }) {
  return <div className="hp-card" style={style}>{children}</div>
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <div className="hp-eyebrow" style={{ marginBottom: 'var(--sp-3)', paddingBottom: 'var(--sp-1)', borderBottom: '0.5px solid var(--border)' }}>{title}</div>
      {children}
    </div>
  )
}

// Qualitative labels derived from the SAME thresholds as the Gauge/chips: no separate
// palette. A single source of truth (hooks/thresholds.js) for the colour AND the label.
function qualLabel(metric, value) {
  const color = statusColorForValue(metric, value)
  if (color === 'var(--ok)') return 'Good'
  if (color === 'var(--warn)') return 'Moderate'
  if (color === 'var(--danger)') return 'Poor'
  return '—'
}

function comfortColor(v) { return v >= 80 ? 'var(--ok)' : v >= 60 ? 'var(--warn)' : 'var(--danger)' }

function DeviceCard({ deviceId, readings, selected, onClick }) {
  const temp     = parseFloat(readings.temperature ?? NaN)
  const humidity = parseFloat(readings.humidity    ?? NaN)
  const co2      = parseFloat(readings.co2         ?? NaN)
  const lux      = parseFloat(readings.lux         ?? NaN)
  const iaq      = parseFloat(readings.iaq         ?? NaN)
  const pressure = parseFloat(readings.pressure    ?? NaN)

  const isSelected = selected === deviceId
  const isSCD = !isNaN(co2)
  const isBME = !isNaN(iaq)

  return (
    <div onClick={() => onClick(isSelected ? null : deviceId)} className="hp-card hp-card--interactive" style={{
      borderColor: isSelected ? 'var(--accent-vivid)' : undefined,
      boxShadow: isSelected ? 'var(--shadow-2), 0 0 0 1px var(--accent-vivid)' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{deviceId}</div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)', marginTop: 2 }}>
            {isSCD && 'SCD41'}{isSCD && isBME && ' · '}{isBME && 'BME688'} · BH1750
          </div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }}/>
      </div>

      {/* Gauges: thresholds aligned with hooks/thresholds.js (same bounds as the FloorPlan
          heatmap and the FleetTab chips, no duplicated palette). */}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {!isNaN(temp) && (
          <Gauge value={temp} min={15} max={35} unit="°C" label="Temp"
            thresholds={[[0,'var(--accent-vivid)'],[26,'var(--warn)'],[30,'var(--danger)']]} size={90}/>
        )}
        {!isNaN(humidity) && (
          <Gauge value={humidity} max={100} unit="%" label="Humidity" color="var(--accent-vivid)" size={90}/>
        )}
        {!isNaN(co2) && (
          <Gauge value={co2} max={2000} unit="ppm" label="CO₂"
            thresholds={[[0,'var(--ok)'],[800,'var(--warn)'],[1000,'var(--danger)']]} size={90}/>
        )}
        {!isNaN(iaq) && (
          <Gauge value={iaq} max={150} unit="IAQ" label="Air Quality"
            thresholds={[[0,'var(--ok)'],[50,'var(--warn)'],[100,'var(--danger)']]} size={90}/>
        )}
        {!isNaN(lux) && (
          <Gauge value={lux} max={1000} unit="lx" label="Lux" color="#BA7517" size={90}/>
        )}
        {!isNaN(pressure) && (
          <Gauge value={pressure} min={960} max={1040} unit="hPa" label="Pressure" color="var(--info)" size={90}/>
        )}
      </div>

      {/* Quality badges: colour AND label derived from statusColorForValue, no more
          local HEX palette or different steps (the old co2Color went up to
          1500 with an intermediate 'amber' step that does not exist in STATUS_RANGES). */}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {!isNaN(co2) && (() => {
          const c = statusColorForValue('co2', co2)
          return (
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight:600, padding: '2px var(--sp-2)', borderRadius: 99,
              background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c, border: `0.5px solid ${c}` }}>
              CO₂ {qualLabel('co2', co2)}
            </span>
          )
        })()}
        {!isNaN(iaq) && (() => {
          const c = statusColorForValue('iaq', iaq)
          return (
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight:600, padding: '2px var(--sp-2)', borderRadius: 99,
              background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c, border: `0.5px solid ${c}` }}>
              IAQ {qualLabel('iaq', iaq)}
            </span>
          )
        })()}
      </div>
    </div>
  )
}

export function SensorsTab() {
  const [selected, setSelected] = useState(null)

  const allLast   = useFlux(FLUX.allLast(),       10000)
  const co2Trend  = useFlux(FLUX.co2Trend(),      30000)
  const tempTrend = useFlux(FLUX.tempTrend(),     30000)
  const hum24h    = useFlux(FLUX.humidity24h(),   60000)
  const comfort   = useFlux(FLUX.comfort(),       30000)

  const byDevice = {}
  for (const row of allLast.data ?? []) {
    if (!row.device_id || !row._field || !row._value) continue
    if (!byDevice[row.device_id]) byDevice[row.device_id] = {}
    byDevice[row.device_id][row._field] = row._value
  }

  const deviceIds    = Object.keys(byDevice)
  const comfortScore = parseFloat(comfort.data?.[0]?.comfort ?? NaN)

  const co2Series  = {}
  const tempSeries = {}
  for (const row of co2Trend.data ?? []) {
    if (!row.device_id) continue
    if (!co2Series[row.device_id]) co2Series[row.device_id] = []
    co2Series[row.device_id].push(parseFloat(row._value))
  }
  for (const row of tempTrend.data ?? []) {
    if (!row.device_id) continue
    if (!tempSeries[row.device_id]) tempSeries[row.device_id] = []
    tempSeries[row.device_id].push(parseFloat(row._value))
  }

  const hum24hVals = (hum24h.data ?? []).map(r => parseFloat(r._value))
  const selectedData = selected ? byDevice[selected] : null

  if (deviceIds.length === 0 && !allLast.loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <div style={{ fontSize: 32, opacity: .3 }}>◈</div>
        <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text3)' }}>No active sensors</div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)' }}>Pair an ESP32 in the Devices tab</div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 'var(--sp-4) var(--sp-5)' }}>

      {deviceIds.length > 0 && (
        <Section title="Live Readings — Overview">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
            {(() => {
              const fields = ['temperature','humidity','co2','lux','iaq']
              return fields.map(f => {
                const vals = deviceIds.map(d => parseFloat(byDevice[d]?.[f])).filter(v => !isNaN(v))
                if (!vals.length) return null
                const mean = vals.reduce((s,v) => s+v, 0) / vals.length
                const color = statusColorForValue(f, mean)
                const units  = { temperature:'°C', humidity:'%', co2:'ppm', lux:'lx', iaq:'' }
                const labels = { temperature:'Temperature', humidity:'Humidity', co2:'CO₂', lux:'Luminosity', iaq:'IAQ Score' }
                return (
                  <StatCard key={f} label={labels[f]} value={mean.toFixed(1)}
                    unit={units[f]} color={color}
                    sub={vals.length > 1 ? `Mean of ${vals.length} sensors` : null}/>
                )
              })
            })()}

            {!isNaN(comfortScore) && (
              <StatCard label="Thermal Comfort" value={comfortScore.toFixed(0)} unit="/100"
                color={comfortColor(comfortScore)}
                sub="ASHRAE 55 simplified"/>
            )}
          </div>
        </Section>
      )}

      <Section title="Sensor Modules">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 'var(--sp-3)' }}>
          {deviceIds.map(d => (
            <DeviceCard key={d} deviceId={d} readings={byDevice[d]}
              selected={selected} onClick={setSelected}/>
          ))}
        </div>
      </Section>

      {selected && selectedData && (
        <Section title={`Trends — ${selected}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 'var(--sp-3)' }}>
            {co2Series[selected]?.length > 1 && (
              <Card>
                <Sparkline values={co2Series[selected]} color={statusColorForValue('co2', parseFloat(selectedData.co2 ?? 400))}
                  unit=" ppm" label="CO₂ trend (6h)"/>
              </Card>
            )}
            {tempSeries[selected]?.length > 1 && (
              <Card>
                <Sparkline values={tempSeries[selected]} color="#D85A30" unit="°C" label="Temperature trend (6h)"/>
              </Card>
            )}
            {hum24hVals.length > 1 && (
              <Card>
                <Sparkline values={hum24hVals} color="var(--accent-vivid)" unit="%" label="Humidity 24h"/>
              </Card>
            )}
          </div>
        </Section>
      )}

      <Section title="CO₂ Reference Thresholds">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 'var(--sp-2)' }}>
          {[
            ['< 800 ppm',  'Good',     statusColorForValue('co2', 500)],
            ['800–1000',   'Moderate', statusColorForValue('co2', 900)],
            ['> 1000 ppm', 'Poor',     statusColorForValue('co2', 1200)],
          ].map(([range, label, color]) => (
            <div key={range} style={{ background: `color-mix(in srgb, ${color} 11%, transparent)`, border: `0.5px solid ${color}`, borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)', fontWeight:600, color, marginBottom: 2 }}>{range}</div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text2)' }}>{label}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}