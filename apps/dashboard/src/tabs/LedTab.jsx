import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLedControl } from '../hooks/useLedControl.js'
import { StripPreview } from '../components/StripPreview.jsx'
import { PresetPreview } from '../components/PresetPreview.jsx'
import { Modal } from '../components/Modal.jsx'

function ColorSwatch({ value, onChange }) {
  return (
    <input type="color" value={value} onChange={e => onChange(e.target.value)}
      style={{ width: 40, height: 32, padding: 2, borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', cursor: 'pointer' }}/>
  )
}

function Slider({ label, value, min, max, step, onChange, unit = '' }) {
  return (
    <div style={{ marginBottom: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-2xs)', color: 'var(--text3)', marginBottom: 2 }}>
        <span>{label}</span><span style={{ fontFamily: 'var(--mono)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent-vivid)' }}/>
    </div>
  )
}

function LayerCard({ layer, index, total, patternTypes, onUpdate, onRemove, onDuplicate, onMoveUp, onMoveDown }) {
  const patternDef = patternTypes.find(p => p.id === layer.pattern)
  const hasParam = (p) => patternDef?.params.includes(p)
  const hasMotion = ['wave','blink','chase','rainbow'].includes(layer.pattern)

  return (
    <div className="hp-card" style={{ opacity: layer.enabled ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <button onClick={() => onUpdate({ enabled: !layer.enabled })} className="hp-focus-visible"
          style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
                   background: layer.enabled ? 'var(--ok)' : 'var(--bg3)', color: '#fff', fontSize: 11 }}>
          {layer.enabled ? '●' : '○'}
        </button>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, flex: 1 }}>Layer {index + 1}</span>
        <button onClick={onMoveUp} disabled={index === 0} className="hp-focus-visible"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', opacity: index === 0 ? 0.3 : 1, fontSize: 12 }}>▲</button>
        <button onClick={onMoveDown} disabled={index === total - 1} className="hp-focus-visible"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', opacity: index === total - 1 ? 0.3 : 1, fontSize: 12 }}>▼</button>
        <button onClick={onDuplicate} className="hp-focus-visible"
          style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13 }}>⧉</button>
        <button onClick={onRemove} className="hp-focus-visible"
          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      <div style={{ marginBottom: 'var(--sp-2)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--bg3)' }}>
        <StripPreview layers={[layer]} numLeds={50} height={22}/>
      </div>

      <select value={layer.pattern} onChange={e => onUpdate({ pattern: e.target.value })}
        style={{ width: '100%', padding: 'var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', marginBottom: 'var(--sp-2)', fontSize: 'var(--fs-xs)' }}>
        {patternTypes.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {hasParam('color') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>Couleur</span>
          <ColorSwatch value={layer.color} onChange={c => onUpdate({ color: c })}/>
        </div>
      )}
      {hasParam('brightness') && <Slider label="Luminosité" value={layer.brightness} min={0} max={255} step={1} onChange={v => onUpdate({ brightness: v })}/>}
      <Slider label="Opacité" value={layer.opacity ?? 1} min={0} max={1} step={0.05} onChange={v => onUpdate({ opacity: v })}/>
      {hasParam('speed') && <Slider label="Vitesse" value={layer.speed} min={0} max={5} step={0.1} onChange={v => onUpdate({ speed: v })} unit=" Hz"/>}
      {hasParam('amplitude') && <Slider label="Amplitude" value={layer.amplitude} min={0} max={1} step={0.05} onChange={v => onUpdate({ amplitude: v })}/>}
      {hasParam('frequency') && <Slider label="Fréquence spatiale" value={layer.frequency} min={0.1} max={10} step={0.1} onChange={v => onUpdate({ frequency: v })}/>}
      {hasParam('tailLength') && <Slider label="Longueur de traîne" value={layer.tailLength ?? 3} min={1} max={15} step={1} onChange={v => onUpdate({ tailLength: v })}/>}
      {hasParam('smooth') && <Slider label="Fondu (smooth)" value={layer.smooth ?? 0.5} min={0} max={1} step={0.05} onChange={v => onUpdate({ smooth: v })}/>}

      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        {hasMotion && (
          <button onClick={() => onUpdate({ direction: (layer.direction ?? 1) === 1 ? -1 : 1 })} className="hp-focus-visible"
            style={{ flex: 1, padding: 'var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}>
            {(layer.direction ?? 1) === 1 ? '→ Normal' : '← Inversé'}
          </button>
        )}
        <button onClick={() => onUpdate({ replaceBelow: !layer.replaceBelow })} className="hp-focus-visible"
          style={{ flex: 1, padding: 'var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)',
                   background: layer.replaceBelow ? 'var(--accent-soft)' : 'var(--bg2)',
                   color: layer.replaceBelow ? 'var(--accent-vivid)' : 'var(--text2)', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}>
          {layer.replaceBelow ? '■ Remplace' : '☀ S\'ajoute'}
        </button>
      </div>
    </div>
  )
}

export function LedTab() {
  const {
    devices, deviceId, setDeviceId,
    layers, presets, selectedPresetId, editingPresetId,
    loading, saveError, saveSuccess, pushError,
    addLayer, duplicateLayer, removeLayer, updateLayer, reorderLayers,
    selectPreset, startFresh, saveCurrentAsPreset, updatePreset, duplicatePreset, deletePreset,
    movePreset,
    PATTERN_TYPES,
  } = useLedControl()

  const [presetNameInput, setPresetNameInput] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [activeLayerId, setActiveLayerId] = useState(layers[0]?.id ?? null)

  useEffect(() => {
    if (!layers.find(l => l.id === activeLayerId)) setActiveLayerId(layers[0]?.id ?? null)
  }, [layers, activeLayerId])

  const [isLandscape, setIsLandscape] = useState(() => window.matchMedia('(orientation: landscape)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)')
    const fn = e => setIsLandscape(e.matches)
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [])

  const activeLayer = layers.find(l => l.id === activeLayerId)
  const activeIndex = layers.findIndex(l => l.id === activeLayerId)
  const editingPreset = presets.find(p => p.id === editingPresetId)

  const compositionBlock = (
    <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
      {devices.length > 1 && (
        <select value={deviceId || ''} onChange={e => setDeviceId(e.target.value)}
          style={{ width: '100%', marginBottom: 'var(--sp-3)', padding: 'var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' }}>
          {devices.map(d => <option key={d.device_id} value={d.device_id}>{d.device_id}</option>)}
        </select>
      )}

      {pushError && (
        <div style={{ marginBottom: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>
          Erreur d'envoi : {pushError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)' }}/>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Composition</span>
          {editingPreset && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)' }}>(édition "{editingPreset.name}")</span>}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
          {editingPresetId && (
            <>
              <button onClick={() => updatePreset(editingPresetId, layers)} disabled={loading} className="hp-focus-visible"
                style={{ padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--ok)', cursor: 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                ↻ Update
              </button>
              <button onClick={startFresh} className="hp-focus-visible"
                style={{ padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}>
                + Nouveau
              </button>
            </>
          )}
          <button onClick={() => setShowSaveDialog(true)} className="hp-focus-visible"
            style={{ padding: 'var(--sp-1) var(--sp-2)', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--accent-vivid)', color: '#fff', cursor: 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
            💾 Enregistrer
          </button>
        </div>
      </div>

      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text3)', marginBottom: 'var(--sp-2)' }}>
        Layer du haut = fond · Layer du bas = premier plan
      </div>

      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 'var(--sp-2)', paddingBottom: 4 }}>
        {layers.map((layer, i) => (
          <button key={layer.id} onClick={() => setActiveLayerId(layer.id)} className="hp-focus-visible"
            style={{ flexShrink: 0, padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer',
                     border: activeLayerId === layer.id ? 'none' : '0.5px solid var(--border)',
                     background: activeLayerId === layer.id ? 'var(--accent-vivid)' : 'var(--bg2)',
                     color: activeLayerId === layer.id ? '#fff' : 'var(--text2)',
                     opacity: layer.enabled ? 1 : 0.4 }}>
            {i + 1}
          </button>
        ))}
        <button onClick={addLayer} className="hp-focus-visible"
          style={{ flexShrink: 0, padding: 'var(--sp-1) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--accent-vivid)', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
          +
        </button>
      </div>

      {activeLayer && (
        <LayerCard layer={activeLayer} index={activeIndex} total={layers.length}
          patternTypes={PATTERN_TYPES}
          onUpdate={(patch) => updateLayer(activeLayer.id, patch)}
          onRemove={() => removeLayer(activeLayer.id)}
          onDuplicate={() => duplicateLayer(activeLayer.id)}
          onMoveUp={() => reorderLayers(activeIndex, activeIndex - 1)}
          onMoveDown={() => reorderLayers(activeIndex, activeIndex + 1)}/>
      )}
      {layers.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--sp-5)', color: 'var(--text3)', fontSize: 'var(--fs-sm)' }}>
          Aucune layer — clique "+" pour commencer
        </div>
      )}
    </div>
  )

  const presetsBlock = (
    <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
      <div className="hp-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Compositions enregistrées</div>
      {presets.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--sp-5)', color: 'var(--text3)', fontSize: 'var(--fs-sm)' }}>
          Aucun preset sauvegardé pour le moment
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--sp-3)' }}>
        {presets.map((preset, i) => (
          <div key={preset.id} onClick={() => selectPreset(preset)} className="hp-card hp-card--interactive"
            style={{ borderColor: selectedPresetId === preset.id ? 'var(--accent-vivid)' : undefined,
                     boxShadow: selectedPresetId === preset.id ? 'var(--shadow-2), 0 0 0 1px var(--accent-vivid)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{preset.name}</span>
              <div style={{ display: 'flex', gap: 2 }}>
                <button onClick={(e) => { e.stopPropagation(); movePreset(i, i - 1) }} disabled={i === 0} className="hp-focus-visible"
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                <button onClick={(e) => { e.stopPropagation(); movePreset(i, i + 1) }} disabled={i === presets.length - 1} className="hp-focus-visible"
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 12, opacity: i === presets.length - 1 ? 0.3 : 1 }}>▼</button>
                <button onClick={(e) => { e.stopPropagation(); duplicatePreset(preset) }} className="hp-focus-visible"
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14 }}>⧉</button>
                <button onClick={(e) => { e.stopPropagation(); deletePreset(preset.id) }} className="hp-focus-visible"
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}>✕</button>
              </div>
            </div>
            <PresetPreview layers={preset.layers}/>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              {preset.layers.map((l, li) => (
                <span key={li} style={{ fontSize: 'var(--fs-2xs)', padding: '2px var(--sp-2)', borderRadius: 99,
                  background: 'var(--bg3)', color: 'var(--text2)' }}>{l.pattern}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {devices.length === 0 && (
        <div style={{ padding: 'var(--sp-4)', textAlign: 'center', color: 'var(--text3)', fontSize: 'var(--fs-sm)' }}>
          Aucun device LED détecté — vérifie qu'un strip est bien enrollé (hw_model="led-strip")
        </div>
      )}

      {devices.length > 0 && (
        <>
          <div style={{ background: 'var(--bg3)' }}>
            <StripPreview layers={layers} numLeds={50} height={50} scrollable/>
          </div>

          <div style={{ display: 'flex', flexDirection: isLandscape ? 'row' : 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: isLandscape ? '0 0 45%' : 'none', overflow: 'auto', borderRight: isLandscape ? '0.5px solid var(--border)' : 'none', borderBottom: isLandscape ? 'none' : '0.5px solid var(--border)' }}>
              {compositionBlock}
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {presetsBlock}
            </div>
          </div>
        </>
      )}

      {showSaveDialog && createPortal(
        <Modal onClose={() => setShowSaveDialog(false)}>
          <div className="hp-card hp-card--elevated" style={{ width: 320, padding: 'var(--sp-5)' }}>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>Nom de la composition</div>
            <input autoFocus value={presetNameInput} onChange={e => setPresetNameInput(e.target.value)}
              placeholder="ex: Ambiance soirée"
              style={{ width: '100%', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', marginBottom: 'var(--sp-3)' }}/>
            {saveError && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-2)' }}>Erreur : {saveError}</div>}
            {saveSuccess && <div style={{ color: 'var(--ok)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-2)' }}>✓ Enregistré</div>}
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <button onClick={() => setShowSaveDialog(false)} className="hp-focus-visible"
                style={{ flex: 1, padding: 'var(--sp-2) 0', borderRadius: 'var(--r-sm)', border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', cursor: 'pointer' }}>Annuler</button>
              <button onClick={async () => { await saveCurrentAsPreset(presetNameInput || 'Sans nom'); setPresetNameInput(''); setShowSaveDialog(false) }}
                disabled={loading} className="hp-focus-visible"
                style={{ flex: 2, padding: 'var(--sp-2) 0', borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--accent-vivid)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {loading ? '...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </Modal>,
        document.body
      )}
    </div>
  )
}