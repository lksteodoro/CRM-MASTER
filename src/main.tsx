import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { clearStaleChunkReloadGuard, installStaleChunkReload } from './lib/staleChunkReload'

// Precisa ser instalado antes de qualquer import() sob demanda acontecer —
// por isso entra logo no topo, antes até da renderização do React.
installStaleChunkReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Espera a página carregar por completo (mais uma folga) antes de liberar a
// guarda de recarregamento único. Se liberássemos logo após o render(), um
// import() que falha nos primeiros milissegundos poderia disparar o reload,
// a guarda seria removida por esta mesma linha antes do navegador de fato
// recarregar, e um segundo problema no reload viraria um loop.
window.addEventListener('load', () => {
  window.setTimeout(clearStaleChunkReloadGuard, 2000)
})
