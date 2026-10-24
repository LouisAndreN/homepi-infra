import { createPortal } from 'react-dom'

// Portail générique — rend son contenu directement dans document.body plutôt
// que dans l'arbre React courant. Nécessaire car App.jsx applique un
// `transform:translateX` sur le conteneur des tabs pour le swipe horizontal ;
// un transform sur un ancêtre piège tout `position:fixed` descendant à
// l'intérieur de sa boîte, peu importe l'onglet actif, l'orientation ou la
// taille d'écran. Le portail contourne ce piège une fois pour toutes — tout
// modal de l'app doit passer par ici plutôt que rendre son overlay en place.
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