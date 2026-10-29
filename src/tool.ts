// The ligne drawing tool: a transparent layer over an Excalidraw canvas. Works on the plain
// Excalidraw API, so the web page and the Obsidian Excalidraw plugin mount the same thing.
//
// Click to place stops; between them the line runs octilinear (one straight + one 45° leg),
// traced dotted up to the pointer. Shift: free leg snapped to 8 directions. F flips the leg order.
// Start on an existing ligne line to branch off it, on its end to extend it. Double-click / Enter
// ends, Backspace undoes a stop, Esc cancels (and leaves the tool when nothing is drawn).
// S switches to stations: click a line to drop one, its label (grouped text) holds `key: value` data.
// G copies the graph as text.
import { lastDir, nearest, octi, round, simplify, snap8, same, type XY } from './core/geom.ts'
import { graph, toText, type LineData, type Shape, type StationData, type Style } from './core/graph.ts'

/** The slice of the Excalidraw imperative API ligne uses. */
export interface Api {
  getAppState(): any
  getSceneElements(): readonly any[]
  updateScene(scene: { elements?: readonly any[], captureUpdate?: any }): void
  onChange(cb: (elements: readonly any[], state: any) => void): () => void
  setActiveTool(tool: { type: string }): void
}
/** Excalidraw's convertToExcalidrawElements, from whichever bundle the host ships. */
export type Convert = (skeletons: any[]) => any[]

export const WIDTH: Record<Style, number> = { trunk: 6, branch: 2, dotted: 2 }

/** Station dot: diameter, outline, filled with the line colour. */
const DOT: Record<Shape, { d: number, w: number, fill: boolean }> = {
  stop: { d: 12, w: 2, fill: false }, interchange: { d: 20, w: 3, fill: false }, commit: { d: 14, w: 2, fill: true },
}
const NS = 'http://www.w3.org/2000/svg'
const SNAP = 10                                   // px on screen

export class Ligne {
  active = false
  mode: 'line' | 'station' = 'line'
  style: Style = 'trunk'
  shape: Shape = 'stop'
  r = 24
  private pts: XY[] = []
  private cursor?: XY
  private flip?: boolean
  private from?: string
  private editing?: string
  readonly layer: SVGSVGElement
  private panel: HTMLDivElement
  private off: (() => void)[] = []

  /** `focused`: whether keys are for this canvas (several may be open, e.g. Obsidian panes). */
  constructor(readonly api: Api, private host: HTMLElement, private convert: Convert,
    private focused: () => boolean = () => true) {
    host.style.position ||= 'relative'
    this.layer = document.createElementNS(NS, 'svg')
    this.layer.classList.add('ligne-layer')
    this.panel = document.createElement('div')
    this.panel.className = 'ligne-panel'
    host.append(this.layer, this.panel)
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void) => {
      // capture: keys reach ligne before Excalidraw's own shortcuts (1, 2, 3 pick its tools)
      t.addEventListener(k, f as EventListener, true)
      this.off.push(() => t.removeEventListener(k, f as EventListener, true))
    }
    on(this.layer, 'pointermove', e => { this.cursor = this.scene(e); this.draw(e.shiftKey) })
    on(this.layer, 'pointerdown', e => this.down(e))
    on(this.layer, 'dblclick', () => this.finish())
    on(this.layer, 'wheel', e => this.canvas()?.dispatchEvent(new WheelEvent('wheel', e)))
    on(window, 'keydown', e => this.key(e))
    this.off.push(api.onChange(() => this.draw()))
    this.panelUI()
    this.setActive(false)
  }

  destroy() { this.off.forEach(f => f()); this.layer.remove(); this.panel.remove() }

  setActive(on: boolean) {
    this.active = on
    this.layer.style.pointerEvents = on ? 'all' : 'none'
    this.panel.classList.toggle('on', on)
    if (!on) this.reset()
    this.panelUI()
  }

  // --- coordinates: scene = (client - canvas offset) / zoom - scroll; the layer sits in host ---
  private scene(e: MouseEvent): XY {
    const s = this.api.getAppState(), z = s.zoom.value
    return [(e.clientX - s.offsetLeft) / z - s.scrollX, (e.clientY - s.offsetTop) / z - s.scrollY]
  }
  private screen(p: XY): XY {
    const s = this.api.getAppState(), z = s.zoom.value, b = this.host.getBoundingClientRect()
    return [(p[0] + s.scrollX) * z + s.offsetLeft - b.left, (p[1] + s.scrollY) * z + s.offsetTop - b.top]
  }
  private canvas() { return this.host.querySelector('canvas.interactive') }

  /** ligne lines in the scene: waypoints and drawn points, absolute. */
  private lines() {
    const abs = (e: any, ps: XY[]) => ps.map(([x, y]) => [x + e.x, y + e.y] as XY)
    return this.api.getSceneElements().filter(e => e.customData?.ligne?.kind === 'line' && !e.isDeleted)
      .map(e => ({ el: e, path: abs(e, (e.customData.ligne as LineData).path), drawn: abs(e, e.points) }))
  }

  /** Snaps p onto a nearby ligne line; `end` when it is on one of the line's ends. */
  private snapLine(p: XY) {
    const tol = SNAP / this.api.getAppState().zoom.value
    let best: { q: XY, el: any, path: XY[], d: number, end?: 'start' | 'end' } | undefined
    for (const l of this.lines()) {
      const n = nearest(l.drawn, p), [a, b] = [l.path[0], l.path[l.path.length - 1]]
      const end = Math.hypot(p[0] - a[0], p[1] - a[1]) < tol ? 'start' : Math.hypot(p[0] - b[0], p[1] - b[1]) < tol ? 'end' : undefined
      if (n.d < tol && (!best || n.d < best.d))
        best = { q: end ? (end === 'start' ? a : b) : n.q, el: l.el, path: l.path, d: n.d, end }
    }
    return best
  }

  /** Stops so far plus the leg(s) out to the pointer. */
  private route(free = false): XY[] {
    if (!this.cursor) return this.pts
    const last = this.pts[this.pts.length - 1]
    if (!last || this.mode === 'station') return this.pts
    const c = this.snapLine(this.cursor)?.q ?? this.cursor
    const leg = free ? [last, snap8(last, c)] : octi(last, c, this.flip, lastDir(this.pts))
    return [...this.pts, ...leg.slice(1)]
  }

  private draw(free = false) {
    if (!this.active) { this.layer.replaceChildren(); return }
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
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y))
      c.setAttribute('r', String(this.mode === 'station' ? DOT[this.shape].d * z / 2 : hit.end ? 8 : 6))
      c.setAttribute('class', 'ligne-snap' + (hit.end && !this.pts.length ? ' end' : ''))
      kids.push(c)
    }
    this.layer.replaceChildren(...kids)
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || e.detail > 1) return
    const p = this.scene(e)
    if (this.mode === 'station') return this.station(p)
    if (!this.pts.length) {
      const hit = this.snapLine(p)
      if (hit?.end) {
        // extend: carry on from that end, the element is replaced (same id) on finish
        const d = hit.el.customData.ligne as LineData
        this.pts = hit.end === 'end' ? hit.path : hit.path.slice().reverse()
        this.editing = hit.el.id; this.from = d.from; this.style = d.style; this.r = d.r
        this.panelUI()
      } else {
        this.pts = [hit?.q ?? p]
        this.from = hit?.el.id
      }
    } else {
      this.cursor = p
      this.pts = this.route(e.shiftKey)
    }
    this.flip = undefined
    this.draw()
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName) || !this.focused()) return
    if (!this.active) {
      if (e.key === 'm' && !e.ctrlKey && !e.metaKey) this.setActive(true)
      return
    }
    const k = e.key
    if (k === 'Escape') this.pts.length ? this.reset() : this.setActive(false)
    else if (k === 'Enter') this.finish()
    else if (k === 'Backspace') this.pts.pop()
    else if (k === 'f') this.flip = !(this.flip ?? false)
    else if (k === 's') { this.reset(); this.mode = this.mode === 'line' ? 'station' : 'line'; this.panelUI() }
    else if (k === 'g') this.copy()
    else if (k in KEYS && this.mode === 'line') { this.style = KEYS[k]; this.panelUI() }
    else if (k in SHAPES && this.mode === 'station') { this.shape = SHAPES[k]; this.panelUI() }
    else return
    e.preventDefault(); e.stopImmediatePropagation()
    // a host listening before us (Obsidian's Excalidraw plugin) may still have picked a tool by that key
    setTimeout(() => this.api.setActiveTool({ type: 'selection' }))
    this.draw(e.shiftKey)
  }

  private reset() { this.pts = []; this.from = this.editing = this.flip = undefined; this.draw() }

  graph() { return graph(this.api.getSceneElements()) }
  text() { return toText(this.graph()) }

  private copy() {
    navigator.clipboard?.writeText(this.text())
    this.panel.querySelector('.copy')?.classList.add('done')
    setTimeout(() => this.panel.querySelector('.copy')?.classList.remove('done'), 800)
  }

  /** Drops a station dot on the nearest line (or where clicked), grouped with its label. */
  private station(p: XY) {
    const hit = this.snapLine(p), at = hit?.q ?? p, dot = DOT[this.shape]
    const color = hit?.el.strokeColor ?? this.api.getAppState().currentItemStrokeColor
    const g = Math.random().toString(36).slice(2, 10), n = this.graph().stations.length + 1
    const data: StationData = { kind: 'station', line: hit?.el.id, shape: this.shape }
    const els = this.convert([
      { type: 'ellipse', x: at[0] - dot.d / 2, y: at[1] - dot.d / 2, width: dot.d, height: dot.d,
        strokeColor: color, backgroundColor: dot.fill ? color : '#ffffff', fillStyle: 'solid',
        strokeWidth: dot.w, roughness: 0, groupIds: [g], customData: { ligne: data } },
      { type: 'text', x: at[0] + dot.d, y: at[1] - dot.d - 20, text: `S${n}`, fontSize: 16, fontFamily: 2,
        strokeColor: '#1e1e1e', groupIds: [g] },
    ])
    this.api.updateScene({ elements: [...this.api.getSceneElements(), ...els], captureUpdate: 'IMMEDIATELY' })
  }

  /** Commits the drawn line as one Excalidraw line element carrying its waypoints. */
  private finish() {
    const pts = simplify(this.pts)
    if (pts.length < 2 || same(pts[0], pts[pts.length - 1]) && pts.length < 3) return this.reset()
    const [x, y] = pts[0], rel = (p: XY): XY => [p[0] - x, p[1] - y]
    const data: LineData = { kind: 'line', path: pts.map(rel), r: this.r, style: this.style, from: this.from }
    const s = this.api.getAppState()
    const [el] = this.convert([{
      type: 'line', x, y, points: round(pts, this.r).map(rel),
      strokeColor: s.currentItemStrokeColor, strokeWidth: WIDTH[this.style], roughness: 0,
      strokeStyle: this.style === 'dotted' ? 'dotted' : 'solid', roundness: null, customData: { ligne: data },
    }])
    const rest = this.api.getSceneElements().filter(e => e.id !== this.editing)
    this.api.updateScene({ elements: [...rest, this.editing ? { ...el, id: this.editing } : el], captureUpdate: 'IMMEDIATELY' })
    this.reset()
  }

  private panelUI() {
    const b = (label: string, on: boolean, f: () => void, title = '') => {
      const x = document.createElement('button')
      x.textContent = label; x.title = title; x.classList.toggle('on', on); x.onclick = f
      return x
    }
    const pick = <T extends string>(keys: Record<string, T>, cur: T, set: (v: T) => void) => Object.keys(keys)
      .map(k => b(keys[k], cur === keys[k], () => { set(keys[k]); this.panelUI() }, `key ${k}`))
    const mode = (m: typeof this.mode) => b(m, this.mode === m, () => { this.reset(); this.mode = m; this.panelUI() }, 'key s')
    const opts = this.mode === 'line' ? pick(KEYS, this.style, v => this.style = v) : pick(SHAPES, this.shape, v => this.shape = v)
    const r = document.createElement('input')
    Object.assign(r, { type: 'range', min: '0', max: '80', value: String(this.r), title: 'bend radius' })
    r.oninput = () => { this.r = +r.value; this.draw() }
    this.panel.replaceChildren(b('ligne', this.active, () => this.setActive(!this.active), 'key m'),
      ...(this.active ? [mode('line'), mode('station'), sep(), ...opts, ...(this.mode === 'line' ? [r] : []),
        sep(), Object.assign(b('copy graph', false, () => this.copy(), 'key g'), { className: 'copy' })] : []))
  }
}

const KEYS: Record<string, Style> = { '1': 'trunk', '2': 'branch', '3': 'dotted' }
const SHAPES: Record<string, Shape> = { '1': 'stop', '2': 'interchange', '3': 'commit' }
const sep = () => Object.assign(document.createElement('span'), { className: 'sep' })
