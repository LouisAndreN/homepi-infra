/**
 * HomePi Dashboard — Configuration centrale
 * Modifie uniquement ce fichier pour adapter à ton environnement.
 *
 * GRAFANA UIDs : trouve-les dans l'URL quand tu ouvres un dashboard
 * Exemple : /grafana/d/AbCdEfGh/mon-dashboard → uid = "AbCdEfGh"
 */

export const GRAFANA_BASE = '/grafana'
export const GRAFANA_KIOSK = 'kiosk=tv&refresh=10s&theme=dark'

export const GRAFANA_DASHBOARDS = {
  // system: {
  //   uid:   'iogjbsq',   // Dashboard Pi + NVMe
  //   slug:  'pi-system',
  //   label: 'Système',
  // },
  security: {
    uid:   'ioxg69q', // Dashboard CrowdSec + Auditd
    slug:  'security',
    label: 'Sécurité',
  },
  sensors: {
    uid:   'io2k8lp', // Dashboard IoT capteurs
    slug:  'iot-sensors',
    label: 'Capteurs',
  },
}

// Provisioning API (proxied via Nginx)
export const API_BASE = ''

// Prometheus (proxied via Nginx sous /metrics-proxy)
export const PROMETHEUS_BASE = '/metrics-proxy'

// Pairing window duration (secondes) — doit correspondre à SESSION_TTL dans provisioning_api.py

// Plan d'appartement — adapte les pièces et appareils à ton logement
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
