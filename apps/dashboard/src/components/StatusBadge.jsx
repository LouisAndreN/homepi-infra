const META = {
  active:    { label: 'Actif',      bg: 'color-mix(in srgb, var(--ok) 18%, transparent)',     color: 'var(--ok)' },
  seen:      { label: 'Vu',         bg: 'color-mix(in srgb, var(--accent-vivid) 18%, transparent)', color: 'var(--accent-vivid)' },
  suspended: { label: 'Suspendu',   bg: 'color-mix(in srgb, var(--danger) 18%, transparent)',  color: 'var(--danger)' },
  pre_registered: { label: 'Pré-enregistré', bg: 'color-mix(in srgb, var(--info) 18%, transparent)', color: 'var(--info)' },
  bootstrapped:   { label: 'Bootstrap',      bg: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' },
}

export function StatusBadge({ status }) {
  const m = META[status] || { label: status, bg: 'rgba(136,135,128,.18)', color: 'var(--text2)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)',
      padding: '2px var(--sp-3)', borderRadius: 99,
      fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.04em',
      background: m.bg, color: m.color,
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color, flexShrink: 0 }}/>
      {m.label}
    </span>
  )
}
