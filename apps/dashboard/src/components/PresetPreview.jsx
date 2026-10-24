import { StripPreview } from './StripPreview.jsx'

export function PresetPreview({ layers, numLeds = 50 }) {
  return <StripPreview layers={layers} numLeds={numLeds} height={28}/>
}