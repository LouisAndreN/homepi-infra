import { createPortal } from 'react-dom'

// Generic portal: renders its content directly into document.body rather
// than in the current React tree. Needed because App.jsx applies a
// `transform:translateX` to the tab container for horizontal swipe;
// a transform on an ancestor traps every descendant `position:fixed` inside
// its box, whatever the active tab, the orientation or the
// screen size. The portal avoids this trap once and for all: every
// modal of the app must go through here rather than render its overlay in place.
export function Modal({ children, onClose }) {
  return createPortal(
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.7)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--sp-4)',
    }}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  )
}