/**
 * HomePi Dashboard — Configuration centrale
 * Edit only this file to adapt to your environment.
 *
 * GRAFANA UIDs: find them in the URL when you open a dashboard
 * Exemple : /grafana/d/AbCdEfGh/mon-dashboard → uid = "AbCdEfGh"
 */

export const GRAFANA_BASE = '/grafana'
export const GRAFANA_KIOSK = 'kiosk=tv&refresh=10s&theme=dark'

export const GRAFANA_DASHBOARDS = {
  // system: {
  //   uid:   'iogjbsq',   // Dashboard Pi + NVMe
  //   slug:  'pi-system',
  //   label: 'System',
  // },
  security: {
    uid:   'ioxg69q', // Dashboard CrowdSec + Auditd
    slug:  'security',
    label: 'Sécurité',
  },
  sensors: {
    uid:   'io2k8lp', // IoT sensors dashboard
    slug:  'iot-sensors',
    label: 'Capteurs',
  },
}

// Provisioning API (proxied via Nginx)
export const API_BASE = ''

// Prometheus (proxied via Nginx sous /metrics-proxy)
export const PROMETHEUS_BASE = '/metrics-proxy'

// Pairing window duration (seconds): must match SESSION_TTL in provisioning_api.py

// Flat floor plan: adapt the rooms and appliances to your home
export const ROOMS = [
  { id: 'salon',    label: 'Salon',      x: 40,  y: 40,  w: 220, h: 180 },
  { id: 'chambre',  label: 'Chambre',    x: 280, y: 40,  w: 160, h: 180 },
  { id: 'cuisine',  label: 'Cuisine',    x: 40,  y: 240, w: 140, h: 120 },
  { id: 'sdb',      label: 'Salle de bain', x: 200, y: 240, w: 100, h: 120 },
  { id: 'bureau',   label: 'Bureau',     x: 320, y: 240, w: 120, h: 120 },
]

export const APPLIANCES = [
  { id: 'tv',      room: 'salon',   label: 'TV',           watts: 120, x: 80,  y: 110 },
  { id: 'box',     room: 'salon',   label: 'Box',          watts: 15,  x: 140, y: 110 },
  { id: 'clim',    room: 'salon',   label: 'Clim',         watts: 1200,x: 200, y: 110 },
  { id: 'pc',      room: 'bureau',  label: 'PC',           watts: 200, x: 350, y: 280 },
  { id: 'frigo',   room: 'cuisine', label: 'Frigo',        watts: 80,  x: 80,  y: 280 },
  { id: 'micro',   room: 'cuisine', label: 'Micro-ondes',  watts: 900, x: 140, y: 280 },
  { id: 'machine', room: 'sdb',     label: 'Lave-linge',   watts: 500, x: 230, y: 280 },
  { id: 'pi',      room: 'bureau',  label: 'HomePi',       watts: 12,  x: 410, y: 280 },
]

// Energy tab (NILM whole-home metering). Values in nilm_readings are already
// calibrated server-side (W, V, A): the dashboard never applies a scale factor.
export const ENERGY = {
  bucket:      'iot-hot',
  measurement: 'nilm_readings',
  // Metered legs (single-phase three-wire). inTotal: summed into the whole-home
  // figure. A leg stays out of the total until its CT polarity and scale are
  // validated with a known load: on 2026-11-27 P_L2 integrated to -0.99 kWh over
  // the day (CT reversed / polarity not set), which would have under-reported
  // the home by ~1 kWh. Fix the polarity server-side (nilm_calibration.json),
  // then set validated and inTotal to true.
  legs: [
    // wire: which cable the CT is clamped on (L1 = R/red, L2 = T/black), used by the polarity guide
    // Defaults until the CT is calibrated on the Pi (then the calibration file decides).
    // trustUncalibratedHistory: keep this leg's readings from before its calibration (L1 from
    // firmware v2 was roughly right; L2 had the wrong sign, so its old history is ignored).
    { field: 'P_L1', label: 'L1', wire: 'L1', validated: true,  inTotal: true,  trustUncalibratedHistory: true },
    { field: 'P_L2', label: 'L2', wire: 'L2', validated: false, inTotal: false, trustUncalibratedHistory: false },
  ],
  // Reversed-CT detection. Without generation (no PV, no battery), sustained
  // negative active power on a leg can only mean a reversed CT or polarity.
  // Set hasGeneration: true if export ever becomes possible: detection turns off.
  polarity: {
    hasGeneration: false,
    windowMin:     15,   // look-back on the 1-min means
    minW:          15,   // |mean| below this is noise: state "unknown"
    minNegFrac:    0.7,  // share of minutes below -minW to call it reversed
  },
  historyDays:  7,    // reference days for the prediction and the daily bars
  minCoverage:  0.8,  // a day needs >= 80% of its 5-min windows to be used as reference
  staleAfterS:  120,  // live figures are hidden when the last sample is older than this
}
