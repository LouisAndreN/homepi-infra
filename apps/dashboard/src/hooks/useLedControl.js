import { useState, useEffect, useCallback, useRef } from 'react'

const API = ''

const PATTERN_TYPES = [
  { id: 'solid',   label: 'Uni',        params: ['color', 'brightness'] },
  { id: 'wave',    label: 'Vague',      params: ['color', 'brightness', 'speed', 'amplitude', 'frequency'] },
  { id: 'blink',   label: 'Clignotant', params: ['color', 'brightness', 'speed'] },
  { id: 'chase',   label: 'Chenillard', params: ['color', 'brightness', 'speed', 'tailLength', 'smooth'] },
  { id: 'rainbow', label: 'Arc-en-ciel',params: ['brightness', 'speed'] },
]

function genId() {
  return `l${Date.now()}${Math.random().toString(36).slice(2, 10)}`
}

function mkLayer(overrides = {}) {
  return {
    id: genId(),
    enabled: true, pattern: 'solid',
    color: '#FFFFFF', brightness: 200, speed: 1.0, amplitude: 1.0, frequency: 1.0,
    opacity: 1.0, direction: 1, tailLength: 3, smooth: 0.5, replaceBelow: false,
    ...overrides,
  }
}

export function useLedControl() {
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState(null)
  const [layers, setLayers] = useState([mkLayer()])
  const [presets, setPresets] = useState([])
  const [selectedPresetId, setSelectedPresetId] = useState(null)
  const [editingPresetId, setEditingPresetId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [pushError, setPushError] = useState(null)

  const loadDevices = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/admin/devices`)
      const d = await r.json()
      const ledDevices = (d.devices || []).filter(dev => dev.hw_model === 'led-strip')
      setDevices(ledDevices)
      setDeviceId(prev => prev || (ledDevices[0]?.device_id ?? null))
    } catch (e) { console.error('Erreur chargement devices:', e) }
  }, [])

  useEffect(() => { loadDevices() }, [loadDevices])

  const loadPresets = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/admin/led/presets`)
      const d = await r.json()
      setPresets(d.presets || [])
    } catch (e) { console.error('Erreur chargement presets:', e) }
  }, [])

  useEffect(() => { loadPresets() }, [loadPresets])

  const pushComposition = useCallback(async (layersToSend) => {
    if (!deviceId) { setPushError('Aucun device LED sélectionné'); return }
    setPushError(null)
    try {
      const r = await fetch(`${API}/api/admin/led/${deviceId}/composition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: layersToSend }),
      })
      if (!r.ok) {
        const body = await r.text()
        throw new Error(`HTTP ${r.status}: ${body}`)
      }
    } catch (e) {
      console.error('Erreur publication composition:', e)
      setPushError(e.message)
    }
  }, [deviceId])

  const pushTimeoutRef = useRef(null)
  const pendingLayersRef = useRef(null)

  const pushCompositionThrottled = useCallback((layersToSend) => {
    pendingLayersRef.current = layersToSend
    if (pushTimeoutRef.current) return
    pushTimeoutRef.current = setTimeout(() => {
      pushComposition(pendingLayersRef.current)
      pushTimeoutRef.current = null
    }, 100)
  }, [pushComposition])

  const updateLayers = useCallback((newLayers) => {
    setLayers(newLayers)
    pushCompositionThrottled(newLayers)
  }, [pushCompositionThrottled])

  const addLayer = useCallback(() => {
    updateLayers([...layers, mkLayer()])
  }, [layers, updateLayers])

  const duplicateLayer = useCallback((id) => {
    const original = layers.find(l => l.id === id)
    if (!original) return
    const idx = layers.findIndex(l => l.id === id)
    const copy = { ...original, id: genId() }
    const next = [...layers]
    next.splice(idx + 1, 0, copy)
    updateLayers(next)
  }, [layers, updateLayers])

  const removeLayer = useCallback((id) => {
    updateLayers(layers.filter(l => l.id !== id))
  }, [layers, updateLayers])

  const updateLayer = useCallback((id, patch) => {
    updateLayers(layers.map(l => l.id === id ? { ...l, ...patch } : l))
  }, [layers, updateLayers])

  const reorderLayers = useCallback((fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= layers.length) return
    const next = [...layers]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    updateLayers(next)
  }, [layers, updateLayers])

  const selectPreset = useCallback((preset) => {
    setLayers(preset.layers)
    setSelectedPresetId(preset.id)
    setEditingPresetId(preset.id)
    pushComposition(preset.layers)
  }, [pushComposition])

  const startFresh = useCallback(() => {
    setSelectedPresetId(null)
    setEditingPresetId(null)
  }, [])

  const saveCurrentAsPreset = useCallback(async (name) => {
    setLoading(true); setSaveError(null)
    try {
      const r = await fetch(`${API}/api/admin/led/presets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, layers }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadPresets()
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (e) { setSaveError(e.message) }
    finally { setLoading(false) }
  }, [layers, loadPresets])

  const updatePreset = useCallback(async (id, layersToSave) => {
    setLoading(true); setSaveError(null)
    try {
      const r = await fetch(`${API}/api/admin/led/presets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: layersToSave }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadPresets()
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (e) { setSaveError(e.message) }
    finally { setLoading(false) }
  }, [loadPresets])

  const duplicatePreset = useCallback(async (preset) => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/admin/led/presets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${preset.name} (copie)`, layers: preset.layers }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await loadPresets()
    } finally { setLoading(false) }
  }, [loadPresets])

  const deletePreset = useCallback(async (id) => {
    await fetch(`${API}/api/admin/led/presets/${id}`, { method: 'DELETE' })
    if (editingPresetId === id) startFresh()
    await loadPresets()
  }, [loadPresets, editingPresetId, startFresh])

  const reorderPresets = useCallback(async (newOrderedPresets) => {
    setPresets(newOrderedPresets)
    try {
      await fetch(`${API}/api/admin/led/presets/reorder`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: newOrderedPresets.map(p => p.id) }),
      })
    } catch (e) { console.error('Erreur reorder:', e); loadPresets() }
  }, [loadPresets])

  const movePreset = useCallback((fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= presets.length) return
    const next = [...presets]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    reorderPresets(next)
  }, [presets, reorderPresets])

  return {
    devices, deviceId, setDeviceId,
    layers, presets, setPresets, selectedPresetId, editingPresetId,
    loading, saveError, saveSuccess, pushError,
    addLayer, duplicateLayer, removeLayer, updateLayer, reorderLayers,
    selectPreset, startFresh, saveCurrentAsPreset, updatePreset, duplicatePreset, deletePreset,
    reorderPresets, movePreset,
    PATTERN_TYPES,
  }
}