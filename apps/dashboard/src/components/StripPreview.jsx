import { useEffect, useRef } from 'react'

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  let r, g, b
  if (h < 60)       [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else              [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

export function StripPreview({ layers, numLeds = 50, height = 60, scrollable = false }) {
  const canvasRef = useRef(null)
  const width = scrollable ? Math.max(800, numLeds * 16) : 800

  useEffect(() => {
    let raf
    let phase = 0
    let lastTime = performance.now()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    function computePixel(i) {
      let r = 0, g = 0, b = 0
      for (const l of layers) {
        if (!l.enabled) continue
        const hex = l.color.replace('#', '')
        const cr = parseInt(hex.slice(0,2),16), cg = parseInt(hex.slice(2,4),16), cb = parseInt(hex.slice(4,6),16)
        const bscale = (l.brightness/255) * (l.opacity ?? 1)
        const dphase = phase * (l.direction ?? 1)
        let lr=0, lg=0, lb=0

        if (l.pattern==='solid') {
          lr=cr*bscale; lg=cg*bscale; lb=cb*bscale
        } else if (l.pattern==='wave') {
          const w = (Math.sin((i/numLeds*l.frequency + dphase)*2*Math.PI)+1)/2
          const inten = 1 - l.amplitude + l.amplitude*w
          lr=cr*bscale*inten; lg=cg*bscale*inten; lb=cb*bscale*inten
        } else if (l.pattern==='blink') {
          if (((dphase % 1) + 1) % 1 < 0.5) { lr=cr*bscale; lg=cg*bscale; lb=cb*bscale }
        } else if (l.pattern==='chase') {
          let pos = Math.floor(dphase*numLeds) % numLeds
          if (pos < 0) pos += numLeds
          let dist = i - pos
          if (dist < 0) dist += numLeds
          const tailLength = l.tailLength ?? 3
          if (dist < tailLength) {
            let fade = 1 - (dist / tailLength)
            const sharpness = 1 + (1 - (l.smooth ?? 0.5)) * 4
            fade = Math.pow(fade, sharpness)
            lr=cr*bscale*fade; lg=cg*bscale*fade; lb=cb*bscale*fade
          }
        } else if (l.pattern==='rainbow') {
          let hue = ((i/numLeds + dphase)%1)
          if (hue < 0) hue += 1
          const [rr,gg,bb] = hsvToRgb(hue*360, 1, bscale)
          lr=rr; lg=gg; lb=bb
        }
        r += lr; g += lg; b += lb
      }
      return [Math.min(255,r), Math.min(255,g), Math.min(255,b)]
    }

    function frame(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.2)
      lastTime = now
      phase += 0.3 * dt   // ★ 0.3 unité/seconde — doit matcher exactement le firmware (speed * 0.3 * dt)

      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(10, height/2); ctx.lineTo(width-10, height/2); ctx.stroke()

      const spacing = (width - 20) / (numLeds - 1)
      for (let i = 0; i < numLeds; i++) {
        const [r,g,b] = computePixel(i)
        const x = 10 + i*spacing
        ctx.beginPath()
        ctx.arc(x, height/2, 5, 0, Math.PI*2)
        ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`
        const brightness = (r+g+b)/3
        ctx.shadowBlur = brightness > 20 ? 8 : 0
        ctx.shadowColor = `rgb(${r|0},${g|0},${b|0})`
        ctx.fill()
      }
      ctx.shadowBlur = 0
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [layers, numLeds, height, width])

  return (
    <div style={{ overflowX: scrollable ? 'auto' : 'hidden', width: '100%' }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ display: 'block', minWidth: scrollable ? width : '100%' }}/>
    </div>
  )
}