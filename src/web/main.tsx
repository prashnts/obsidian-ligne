// The ligne web page: Excalidraw with the ligne tool, the scene kept in localStorage. A first visit
// (or ?sample) opens the sample drawing, ?blank an empty one.
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { createRoot } from 'react-dom/client'
import { Ligne } from '../tool.ts'

const KEY = 'ligne-scene'
const q = new URLSearchParams(location.search), sample = q.has('sample') || q.has('blank')
const saved = sample ? null : JSON.parse(localStorage.getItem(KEY) ?? 'null')
const initial = saved
  ? { elements: saved.elements }
  : q.has('blank') ? { elements: [] } : fetch('sample.json').then(r => r.ok ? r.json() : { elements: [] }).catch(() => ({ elements: [] }))
let timer = 0
const host = document.getElementById('app')!

createRoot(host).render(
  <Excalidraw
    initialData={Promise.resolve(initial).then(d => ({ elements: d.elements, scrollToContent: true,
      appState: { viewBackgroundColor: '#fff' } }))}
    excalidrawAPI={api => { (window as any).ligne = new Ligne(api, host, convertToExcalidrawElements) }}
    onChange={elements => {
      clearTimeout(timer)
      timer = window.setTimeout(() => localStorage.setItem(KEY, JSON.stringify({ elements })), 500)
    }}
  />,
)
