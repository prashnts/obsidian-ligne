// The ligne web page: Excalidraw with the ligne tool, the scene kept in localStorage.
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { createRoot } from 'react-dom/client'
import { Ligne } from '../tool.ts'

const KEY = 'ligne-scene'
const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
let timer = 0
const host = document.getElementById('app')!

createRoot(host).render(
  <Excalidraw
    initialData={{ elements: saved?.elements ?? [], appState: { viewBackgroundColor: '#fff' } }}
    excalidrawAPI={api => { (window as any).ligne = new Ligne(api, host, convertToExcalidrawElements) }}
    onChange={elements => {
      clearTimeout(timer)
      timer = window.setTimeout(() => localStorage.setItem(KEY, JSON.stringify({ elements })), 500)
    }}
  />,
)
