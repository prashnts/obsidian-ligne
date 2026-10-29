// The ligne drawing tool: a transparent layer over an Excalidraw canvas. Works on the plain
// Excalidraw API, so the web page and the Obsidian Excalidraw plugin mount the same thing.
//
// Click to place stops; between them the line runs octilinear (one straight + one 45° leg),
// traced dotted up to the pointer. Shift: free leg snapped to 8 directions. F flips the leg order.
// Start on an existing ligne line to branch off it. Double-click / Enter ends, Backspace undoes
// a stop, Esc cancels (and leaves the tool when nothing is drawn).
import { lastDir, nearest, octi, round, simplify, snap8, type XY } from './core/geom.ts'

/** The slice of the Excalidraw imperative API ligne uses. */
export interface Api {
  getAppState(): any
  getSceneElements(): readonly any[]
  updateScene(scene: { elements?: readonly any[], captureUpdate?: any }): void
  onChange(cb: (elements: readonly any[], state: any) => void): () => void
}
/** Excalidraw's convertToExcalidrawElements, from whichever bundle the host ships. */
export type Convert = (skeletons: any[]) => any[]

export type Style = 'trunk' | 'branch' | 'dotted'
export const WIDTH: Record<Style, number> = { trunk: 6, branch: 2, dotted: 2 }

/** customData.ligne of a line element: waypoints relative to the element's x, y. */
export interface LineData { kind: 'line', path: XY[], r: number, style: Style, from?: string }

const NS = 'http://www.w3.org/2000/svg'
const SNAP = 10                                   // px on screen

export class Ligne {
  active = false
  style: Style = 'trunk'
  r = 24
  private pts: XY[] = []
  private cursor?: XY
  private flip?: boolean
  private from?: string
  private svg: SVGSVGElement
  private panel: HTMLDivElement
  private off: (() => void)[] = []

  constructor(private api: Api, private host: HTMLElement, private convert: Convert) {
    host.style.position ||= 'relative'
    this.svg = document.createElementNS(NS, 'svg')
    this.svg.classList.add('ligne-layer')
    this.panel = document.createElement('div')
    this.panel.className = 'ligne-panel'
    host.append(this.svg, this.panel)
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void) => {
      // capture: keys reach ligne before Excalidraw's own shortcuts (1, 2, 3 pick its tools)
      t.addEventListener(k, f as EventListener, true)
      this.off.push(() => t.removeEventListener(k, f as EventListener, true))
    }
    on(this.svg, 'pointermove', e => { this.cursor = this.scene(e); this.draw(e.shiftKey) })
    on(this.svg, 'pointerdown', e => this.down(e))
    on(this.svg, 'dblclick', () => this.finish())
    on(this.svg, 'wheel', e => this.canvas()?.dispatchEvent(new WheelEvent('wheel', e)))
    on(window, 'keydown', e => this.key(e))
    this.off.push(api.onChange(() => this.draw()))
    this.panelUI()
    this.setActive(false)
  }

  destroy() { this.off.forEach(f => f()); this.svg.remove(); this.panel.remove() }

  setActive(on: boolean) {
    this.active = on
    this.svg.style.pointerEvents = on ? 'all' : 'none'
    this.panel.classList.toggle('on', on)
    if (!on) this.reset()
    this.panelUI()
  }

  // --- coordinates: scene = (client - offset) / zoom - scroll ---
  private scene(e: MouseEvent): XY {
    const s = this.api.getAppState(), b = this.host.getBoundingClientRect(), z = s.zoom.value
    return [(e.clientX - b.left) / z - s.scrollX, (e.clientY - b.top) / z - s.scrollY]
  }
  private screen(p: XY): XY {
    const s = this.api.getAppState(), z = s.zoom.value
    return [(p[0] + s.scrollX) * z, (p[1] + s.scrollY) * z]
  }
  private canvas() { return this.host.querySelector('canvas.interactive') }

  /** ligne lines in the scene, with absolute waypoints. */
  private lines() {
    return this.api.getSceneElements().filter(e => e.customData?.ligne?.kind === 'line' && !e.isDeleted)
      .map(e => ({ el: e, path: (e.customData.ligne as LineData).path.map(([x, y]) => [x + e.x, y + e.y] as XY) }))
  }

  /** Snaps p onto a nearby ligne line (to branch off it or end on it). */
  private snapLine(p: XY): { q: XY, id: string } | undefined {
    const tol = SNAP / this.api.getAppState().zoom.value
    let best: { q: XY, id: string, d: number } | undefined
    for (const l of this.lines()) {
      const n = nearest(l.path, p)
      if (n.d < tol && (!best || n.d < best.d)) best = { q: n.q, id: l.el.id, d: n.d }
    }
    return best
  }

  /** Stops so far plus the leg(s) out to the pointer. */
  private route(free = false): XY[] {
    if (!this.cursor) return this.pts
    const last = this.pts[this.pts.length - 1]
    if (!last) return []
    const c = this.snapLine(this.cursor)?.q ?? this.cursor
    const leg = free ? [last, snap8(last, c)] : octi(last, c, this.flip, lastDir(this.pts))
    return [...this.pts, ...leg.slice(1)]
  }

  private draw(free = false) {
    if (!this.active) { this.svg.replaceChildren(); return }
    const z = this.api.getAppState().zoom.value, color = this.api.getAppState().currentItemStrokeColor
    const path = (pts: XY[], cls: string) => {
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', pts.length ? 'M' + pts.map(q => this.screen(q).join(',')).join('L') : '')
      p.setAttribute('class', cls)
      p.style.stroke = color
      p.style.strokeWidth = String(WIDTH[this.style] * z)
      return p
    }
    const all = this.route(free), kids: SVGElement[] = []
    kids.push(path(round(simplify(this.pts), this.r), 'ligne-done'))
    kids.push(path(all.slice(Math.max(0, this.pts.length - 1)), 'ligne-trace'))
    const hit = this.cursor && this.snapLine(this.cursor)
    if (hit) {
      const c = document.createElementNS(NS, 'circle'), [x, y] = this.screen(hit.q)
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', '6')
      c.setAttribute('class', 'ligne-snap')
      kids.push(c)
    }
    this.svg.replaceChildren(...kids)
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || e.detail > 1) return
    const p = this.scene(e)
    if (!this.pts.length) {
      const hit = this.snapLine(p)
      this.pts = [hit?.q ?? p]
      this.from = hit?.id
    } else {
      this.cursor = p
      this.pts = this.route(e.shiftKey)
    }
    this.flip = undefined
    this.draw()
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName)) return
    if (!this.active) {
      if (e.key === 'm' && !e.ctrlKey && !e.metaKey) this.setActive(true)
      return
    }
    const k = e.key
    if (k === 'Escape') this.pts.length ? this.reset() : this.setActive(false)
    else if (k === 'Enter') this.finish()
    else if (k === 'Backspace') this.pts.pop()
    else if (k === 'f') this.flip = !(this.flip ?? false)
    else if (k in KEYS) { this.style = KEYS[k]; this.panelUI() }
    else return
    e.preventDefault(); e.stopPropagation()
    this.draw(e.shiftKey)
  }

  private reset() { this.pts = []; this.from = undefined; this.flip = undefined; this.draw() }

  /** Commits the drawn line as one Excalidraw line element carrying its waypoints. */
  private finish() {
    const pts = simplify(this.pts)
    if (pts.length < 2) return this.reset()
    const [x, y] = pts[0], rel = (p: XY): XY => [p[0] - x, p[1] - y]
    const data: LineData = { kind: 'line', path: pts.map(rel), r: this.r, style: this.style, from: this.from }
    const s = this.api.getAppState()
    const [el] = this.convert([{
      type: 'line', x, y, points: round(pts, this.r).map(rel),
      strokeColor: s.currentItemStrokeColor, strokeWidth: WIDTH[this.style], roughness: 0,
      strokeStyle: this.style === 'dotted' ? 'dotted' : 'solid', roundness: null, customData: { ligne: data },
    }])
    this.api.updateScene({ elements: [...this.api.getSceneElements(), el], captureUpdate: 'IMMEDIATELY' })
    this.reset()
  }

  private panelUI() {
    const b = (label: string, on: boolean, f: () => void, title = '') => {
      const x = document.createElement('button')
      x.textContent = label; x.title = title; x.classList.toggle('on', on); x.onclick = f
      return x
    }
    const styles = (Object.keys(KEYS) as (keyof typeof KEYS)[])
      .map(k => b(KEYS[k], this.style === KEYS[k], () => { this.style = KEYS[k]; this.panelUI() }, `key ${k}`))
    const r = document.createElement('input')
    Object.assign(r, { type: 'range', min: '0', max: '80', value: String(this.r), title: 'bend radius' })
    r.oninput = () => { this.r = +r.value; this.draw() }
    this.panel.replaceChildren(b('ligne', this.active, () => this.setActive(!this.active), 'key m'),
      ...(this.active ? [...styles, r] : []))
  }
}

const KEYS: Record<string, Style> = { '1': 'trunk', '2': 'branch', '3': 'dotted' }
