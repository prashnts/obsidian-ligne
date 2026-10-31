// The ligne drawing tool: a transparent layer over an Excalidraw canvas. Works on the plain
// Excalidraw API, so the web page and the Obsidian Excalidraw plugin mount the same thing.
//
// Click to place stops; between them the line runs octilinear (one straight + one 45° leg), drawn
// rounded as it will be. Which leg comes first follows the way the pointer leaves the last stop;
// B swaps. Shift: free leg snapped to 8 directions. Click the last stop again (or double-click,
// Enter) to end; end on the first stop to close the shape into a zone, sent to the back.
// Backspace (or Ctrl/Cmd-Z) undoes a stop, Esc cancels (leaves when idle).
// Start on a line to branch off it, on its end to extend it; drag a waypoint to move it.
// Beside a line the pointer snaps to its free lanes (touching parallels): along a lane the new line
// follows that line bend for bend and leaves it where clicked away. Lines sharing lanes form a
// stack (an Excalidraw group); moving a line's waypoint carries the lines on its lanes along.
// Double-click a line to select just it, even inside a stack.
// Colour, width, dash, sloppiness, fill, arrowheads come from Excalidraw's own style panel (ligne
// keeps its line or arrow tool selected meanwhile), remembered for ligne apart from other shapes.
// T makes cables: twisted (round, zigzag) or colour checks, legs at their ends dragged into place.
// S switches to stations, L to labels on lines. G copies the graph as text.
import { STYLES, cableWidth, type Cable } from './core/cable.ts'
import { beside, concentric, diagFirst, dist, isDiag, kept, lastDir, nearest, octi, octiPoint, offsetAt,
  pointAt, round, same, snap8, unit, upright, type XY } from './core/geom.ts'
import { graph, toText, type Link, type Shape } from './core/graph.ts'
import { laneAt, type Track } from './core/snap.ts'
import { bodyOf, bodyWidth, cableOf, centre, dataOf, findLine, isLine, lidOf, lineEls, pathOf, radiiOf, relink, replace,
  resized, restack, specOf, stale, type Spec } from './lines.ts'
import { DOT, PAPER, bump, fontOf, fromState, groupId, legend, lineLabel, make, paper, station, styleOf, toState,
  type Convert, type Style } from './make.ts'
import { Panel, type Item } from './ui.ts'

export type { Convert }

/** The slice of the Excalidraw imperative API ligne uses. */
export interface Api {
  getAppState(): any
  getSceneElements(): readonly any[]
  updateScene(scene: { elements?: readonly any[], appState?: any, captureUpdate?: any }): void
  onChange(cb: (elements: readonly any[], state: any) => void): () => void
  setActiveTool(tool: { type: string }): void
}

const NS = 'http://www.w3.org/2000/svg'
const SNAP = 10                                   // px on screen: ends, first/last stop, waypoints
const ON = 6                                      // px on screen: onto a lane
const WIDE = 14                                   // px on screen: onto a lane the leg runs along
const JOG = 10                                    // px on screen: shorter legs are a near miss, dropped
const LEAD = 24                                   // px on screen: the pointer's way out of a stop sets the bend
const DRAG = 4                                    // px on screen before a press is a drag
const SAVED = 'ligne-style', OPTS = 'ligne-opts'
const DEFAULT: Partial<Style> = { strokeWidth: 4, roughness: 0, strokeStyle: 'solid', opacity: 100 }
const SHAPES: Record<string, Shape> = { '1': 'stop', '2': 'interchange', '3': 'commit', '4': 'net' }
type Mode = 'line' | 'station' | 'label'

const HELP: [string, string][] = [
  ['click', 'stop · on a line: branch (peels off, trunk style) · on its end: extend (same style)'],
  ['beside a line', 'its free lanes: joins and leaves at 45° in a curve, follows it bend for bend'],
  ['bends', 'the first leg goes the way you leave the stop · B swaps'],
  ['Ctrl / Cmd held · N', 'no snapping: place anywhere'],
  ['[ / ] · slider', 'bend radius (0: sharp), shown as you draw; idle: the selected lines'],
  ['click last stop', 'end the line (also double-click, Enter)'],
  ['click first stop', 'close into a zone, at the back'],
  ['drag', 'waypoint (both legs stay at 45°) · cable leg tip · station · label'],
  ['double-click a line', 'select just it, even in a stack'],
  ['Shift / ⇧ button', 'free leg, 8 directions'],
  ['Backspace / Ctrl-Z · Esc', 'undo a stop · cancel, leave'], ['Alt-click / I', "take a line's style"],
  ['T · ⇧T', 'cable on/off · round, zigzag, checks (2nd colour: Excalidraw background)'],
  ['A / D', 'arrowheads · direction chevrons (the way it was drawn)'],
  ['style', "Excalidraw's panel: colour, width, dash, arrowheads, font"],
  ['S · 1–4 · B', 'stations: stop, interchange, commit, net flag · labels in a box'],
  ['L · B', 'labels on lines: click a line, type · on it / beside it'],
  ['K', 'legend (again: rebuild)'], ['P / ⇧P · O', 'A5 / A6 sheet · landscape'],
  ['G', 'copy the graph as text'], ['M', 'ligne on / off'], ['?', 'this help'],
]

/** A stop: its bend radius and, on another line's lane, where. */
interface Meta { r: number, link: Link | null }
/** A lane beside a line: that line, where along it, the offset, the snapped point. */
interface Lane { el: any, path: XY[], radii: number[], i: number, t: number, d: number, q: XY }
/** A ligne line in the scene: element, waypoints, radii, rounded centre line, body width. */
interface Ln { el: any, path: XY[], radii: number[], drawn: XY[], width: number }

/** Whether leg i of path runs along an axis (else it is diagonal). */
const straight = (path: XY[], i: number) => {
  const a = path[Math.min(i, path.length - 2)], b = path[Math.min(i, path.length - 2) + 1]
  return Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6
}
const groupOf = (els: readonly any[], m: any) => els.filter(e => e.groupIds?.some((g: string) => m.groupIds?.includes(g)))

type Grab =
  | { kind: 'station', mark: any, group: any[] }
  | { kind: 'label', group: any[] }
  | { kind: 'tag', group: any[], line?: any }
  | { kind: 'point', el: any, i: number }
  | { kind: 'leg', el: any, end: 'start' | 'end', j: number }

export class Ligne {
  active = false
  mode: Mode = 'line'
  shape: Shape = 'stop'
  boxed = false
  onLine = true                                    // labels: on the line (knocked out) or beside it
  landscape = false
  help = false
  arrow = false
  ticks = false
  twist = false                                    // cable
  cable: Cable = { style: 'checks', n: 2, pitch: 16 }
  free = false                                     // sticky Shift
  snap = true                                      // onto lines and lanes; Ctrl/Cmd held: off
  bend = false                                     // B: the other leg first
  private mod = false
  private sel: string[] = []                       // lines selected when ligne was turned on
  picking = false                                  // next click takes a line's style
  r = 24
  private pts: XY[] = []
  private meta: Meta[] = []
  private cursor?: XY
  private lead?: boolean                           // the pointer left the last stop diagonally
  private track?: Track                            // the lane being followed
  private from?: string
  private editing?: { id: string, reversed: boolean, n: number }
  private fork?: { u: XY, back: number, fwd: number } // branching: the trunk's leg at the first stop
  private press?: { at: XY, grab?: Grab, dragging?: boolean, start: any[] }
  private outside?: Partial<Style>                 // Excalidraw's style while ligne is active
  private tool = ''
  private looks = new Map<string, string>()         // line id → its style last seen
  private cache?: { els: readonly any[], lines: Ln[] }
  readonly layer: SVGSVGElement
  private panel: Panel
  private input?: HTMLInputElement
  private off: (() => void)[] = []

  /** `focused`: whether keys are for this canvas (several may be open, e.g. Obsidian panes). */
  constructor(readonly api: Api, private host: HTMLElement, private convert: Convert,
    private focused: () => boolean = () => true) {
    host.style.position ||= 'relative'
    this.layer = document.createElementNS(NS, 'svg')
    this.layer.classList.add('ligne-layer')
    this.panel = new Panel(host, () => this.setActive(!this.active))
    host.append(this.layer)
    Object.assign(this, JSON.parse(localStorage.getItem(OPTS) ?? '{}'))
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void, cap = true) => {
      // capture: keys reach ligne before Excalidraw's own shortcuts (1, 2, 3 pick its tools)
      t.addEventListener(k, f as EventListener, cap)
      this.off.push(() => t.removeEventListener(k, f as EventListener, cap))
    }
    on(this.layer, 'pointermove', e => this.move(e))
    on(this.layer, 'pointerdown', e => this.down(e))
    on(this.layer, 'pointerup', e => this.up(e))
    on(this.layer, 'dblclick', e => this.dbl(e))
    on(this.layer, 'wheel', e => this.canvas()?.dispatchEvent(new WheelEvent('wheel', e)))
    on(window, 'keydown', e => this.key(e))
    // Excalidraw's own double-click into a stack: select the line nearest the pointer, not the top one
    on(host, 'dblclick', e => { if (!this.active) setTimeout(() => this.refine(this.scene(e))) }, false)
    this.off.push(api.onChange((_, s) => this.changed(s)))
    this.follow()                                   // learns the line styles
    this.changed(api.getAppState())                 // relinks a drawing made before lids
    this.setActive(false)
  }

  destroy() {
    this.setActive(false); this.off.forEach(f => f()); this.layer.remove(); this.panel.destroy(); this.input?.remove()
  }

  /** The Excalidraw tool held while active: its style panel is ligne's. */
  private held() { return this.arrow ? 'arrow' : 'line' }

  /** On: ligne's remembered style goes into Excalidraw's style panel; off: Excalidraw's comes back. */
  setActive(on: boolean) {
    if (on === this.active) return this.panelUI()
    this.active = on
    this.layer.style.pointerEvents = on ? 'all' : 'none'
    const s = this.api.getAppState()
    if (on) {
      this.outside = fromState(s)
      this.sel = Object.keys(s.selectedElementIds ?? {})
        .filter(id => this.live().some(e => e.id === id && isLine(e, true)))
      const first = this.live().find(e => e.id === this.sel[0])
      if (first) this.r = dataOf(first)!.r
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') ?? DEFAULT
      this.api.updateScene({ appState: toState(saved) })
      this.api.setActiveTool({ type: this.held() })
      this.container()?.focus({ preventScroll: true })
    } else {
      this.reset()
      if (this.outside) {
        localStorage.setItem(SAVED, JSON.stringify(fromState(s)))
        this.api.updateScene({ appState: toState(this.outside) })
        this.outside = undefined
        if (s.activeTool?.type === this.held()) this.api.setActiveTool({ type: 'selection' })
      }
    }
    this.panelUI()
  }

  /** Scene changed: re-attach the controls, keep derived data in step, leave when another
   *  Excalidraw tool is picked. */
  private changed(s: any) {
    this.panel.mount()
    if (!this.press?.dragging) this.follow()
    const fix = (els: readonly any[]) => resized(els) ?? relink(els)
    if (fix(this.api.getSceneElements())) setTimeout(() => {
      const els = fix(this.api.getSceneElements())
      if (els) this.api.updateScene({ elements: els, captureUpdate: 'NEVER' })
    })
    // a scene update may drop the focus (to the body): take it back, else Excalidraw hears no keys
    if (this.active) setTimeout(() => {
      if (this.focused() && !this.input && document.activeElement === document.body)
        this.container()?.focus({ preventScroll: true })
    })
    const t = s.activeTool?.type
    if (this.active && this.tool === this.held() && t !== this.held()) this.setActive(false)
    this.tool = t
    if (!this.press?.dragging) this.draw()
  }

  /** A line restyled in Excalidraw (or by undo): its extras are redrawn in the new style, and its
   *  stations and labels take a new colour along. Not in history: undo restyles the line, this
   *  follows again. */
  private follow() {
    const els = this.api.getSceneElements(), moved = new Map<string, [string, string]>(), redo: any[] = []
    for (const e of els) {
      if (!isLine(e) || stale(e)) continue
      const look = [e.strokeColor, e.backgroundColor, e.strokeWidth, e.strokeStyle, e.opacity, e.roughness].join(' ')
      const was = this.looks.get(e.id)
      this.looks.set(e.id, look)
      if (!was || was === look) continue
      const old = was.split(' ')[0]
      if (old !== e.strokeColor) moved.set(lidOf(e), [old, e.strokeColor]), moved.set(e.id, [old, e.strokeColor])
      if (dataOf(e)!.own) redo.push(e)
    }
    if (!moved.size && !redo.length) return
    const recolor = new Map<string, [string, string]>()
    for (const m of els) {
      const k = m.customData?.ligne?.kind, c = (k === 'station' || k === 'label') && moved.get(m.customData.ligne.line)
      if (c) for (const e of groupOf(els, m)) recolor.set(e.id, c)
    }
    const swap = (e: any, [a, b]: [string, string]) => bump(e, {
      ...(e.strokeColor === a && (e.type !== 'text' || e.customData?.ligne?.kind === 'label') ? { strokeColor: b } : {}),
      ...(e.backgroundColor === a ? { backgroundColor: b } : {}) })
    // after Excalidraw has recorded the change, else its history entry is lost
    setTimeout(() => {
      let scene = this.api.getSceneElements().map(e => recolor.has(e.id) ? swap(e, recolor.get(e.id)!) : e)
      for (const e of redo) {
        const now = scene.find(x => x.id === e.id)
        if (now) scene = replace(scene, lineEls(this.convert, specOf(now), styleOf(now), now))
      }
      this.api.updateScene({ captureUpdate: 'NEVER', elements: scene })
    })
  }

  // --- coordinates: scene = (client - canvas offset) / zoom - scroll; the layer sits in host ---
  private zoom() { return this.api.getAppState().zoom.value as number }
  private scene(e: MouseEvent): XY {
    const s = this.api.getAppState(), z = s.zoom.value
    return [(e.clientX - s.offsetLeft) / z - s.scrollX, (e.clientY - s.offsetTop) / z - s.scrollY]
  }
  private screen(p: XY): XY {
    const s = this.api.getAppState(), z = s.zoom.value, b = this.host.getBoundingClientRect()
    return [(p[0] + s.scrollX) * z + s.offsetLeft - b.left, (p[1] + s.scrollY) * z + s.offsetTop - b.top]
  }
  private canvas() { return this.host.querySelector('canvas.interactive') }
  /** Excalidraw's focusable container: its shortcuts (undo, delete, copy) only work with focus in it. */
  private container() {
    return (this.host.classList.contains('excalidraw') ? this.host : this.host.querySelector('.excalidraw')) as HTMLElement | null
  }
  private live() { return this.api.getSceneElements().filter(e => !e.isDeleted) }

  /** ligne lines (and zones) in the scene, bar those edited outside ligne. Cached per scene. */
  private lines(zones = false): Ln[] {
    const els = this.api.getSceneElements()
    if (this.cache?.els !== els) this.cache = { els, lines: els.filter(e => isLine(e, true) && !stale(e)).map(e =>
      ({ el: e, path: pathOf(e), radii: radiiOf(e), drawn: centre(e), width: bodyWidth(e) })) }
    return zones ? this.cache.lines : this.cache.lines.filter(l => isLine(l.el))
  }

  private snapping() { return this.snap && !this.mod }
  /** Width of what is being drawn: the cable's body, else the stroke. */
  private width() {
    const w = this.api.getAppState().currentItemStrokeWidth
    return this.twist ? cableWidth(this.cable, w) : w
  }

  /** Snaps p onto a line: its end (within SNAP), or its body. With the line being drawn as a line
   *  too, so a wire can loop back onto itself. `always`: even with snapping off (picking a line). */
  private snapLine(p: XY, always = false) {
    if (!always && !this.snapping()) return
    const z = this.zoom(), tol = SNAP / z
    let best: { q: XY, el?: any, path: XY[], d: number, end?: 'start' | 'end' } | undefined
    const own = this.pts.length > 2 ? [{ el: undefined, path: this.pts.slice(0, -1), width: this.width(),
      drawn: round(this.pts.slice(0, -1), this.meta.slice(0, -1).map(m => m.r)) }] : []
    for (const l of [...this.lines().filter(l => l.el.id !== this.editing?.id), ...own]) {
      const n = nearest(l.drawn, p), [a, b] = [l.path[0], l.path[l.path.length - 1]]
      const end = !l.el ? undefined : dist(p, a) < tol ? 'start' : dist(p, b) < tol ? 'end' : undefined
      if ((end ? n.d < tol : n.d < Math.max(l.width / 2 + 1 / z, 3 / z)) && (!best || n.d < best.d))
        best = { q: end ? (end === 'start' ? a : b) : n.q, el: l.el, path: l.path, d: n.d, end }
    }
    return best
  }

  /** The free lane spot near p (see laneAt); `dir`: the way the leg to it runs. */
  private lane(p: XY, dir?: XY): Lane | undefined {
    if (!this.snapping()) return
    // never onto a lane of the line being extended
    const z = this.zoom(), ls = this.lines().filter(l => l.el.id !== this.editing?.id)
    const me = { width: this.width(), cable: this.twist }
    const hit = laneAt(ls.map(l => bodyOf(l.el)), p, me, { tol: ON / z, wide: WIDE / z, dir, leave: WIDE / z,
      track: this.pts.length ? this.track : undefined })
    this.track = hit && this.pts.length ? { of: hit.id, d: hit.d, i: hit.i } : undefined
    const l = hit && ls.find(l => lidOf(l.el) === hit.id)
    return l && { el: l.el, path: l.path, radii: l.radii, i: hit.i, t: hit.t, d: hit.d, q: hit.q }
  }

  /** A stop on lane ln: on a bend it takes the bend's concentric radius. */
  private onLane(ln: Lane): Meta {
    const bend = ln.t < 1e-6 && ln.i > 0 && ln.i < ln.path.length - 1
    return { r: bend ? concentric(ln.path, ln.radii, ln.d)[ln.i] : this.r,
      link: { of: lidOf(ln.el), i: ln.i, t: ln.t, d: ln.d } }
  }

  /** Stops so far plus the leg(s) out to the pointer: along the lane the last stop is on, or
   *  octilinear (closing onto the first stop, snapping to lines and lanes). */
  private route(free = false): { pts: XY[], meta: Meta[] } {
    const n = this.pts.length, last = this.pts[n - 1], c = this.cursor
    if (!c || !last || this.mode !== 'line') return { pts: this.pts, meta: this.meta }
    free ||= this.free
    if (this.fork && n === 1) return this.branch(c, free)
    const z = this.zoom(), inDir = lastDir(this.pts), prev = this.meta[n - 1].link
    const closing = this.closing(c), hit = closing ? undefined : this.snapLine(c)
    // the way the leg would run, for lanes along it
    const rough = octi(last, c, this.order(last, c, prev)), dir = unit([rough.at(-1)![0] - rough.at(-2)![0],
      rough.at(-1)![1] - rough.at(-2)![1]])
    const ln = closing || hit && !hit.end ? undefined : this.lane(c, dir)
    let legs: XY[], meta: Meta[]
    if (ln && prev && !free && prev.of === lidOf(ln.el) && Math.abs(prev.d - ln.d) < 1e-6) {
      // follow: the lane's bends between the two stops, then the stop
      const { path, d } = ln, conc = concentric(path, ln.radii, d), ks: number[] = [], of = lidOf(ln.el)
      if (prev.i + prev.t <= ln.i + ln.t) for (let k = prev.i + 1; k <= (ln.t < 1e-6 ? ln.i - 1 : ln.i); k++) ks.push(k)
      else for (let k = prev.t < 1e-6 ? prev.i - 1 : prev.i; k > ln.i; k--) ks.push(k)
      legs = [...ks.map(k => offsetAt(path, k, 0, d)), ln.q]
      meta = [...ks.map(k => ({ r: conc[k], link: { of, i: k, t: 0, d } })), this.onLane(ln)]
    } else {
      const to = closing ? this.pts[0] : ln?.q ?? hit?.q ?? c, diag = this.order(last, to, prev, ln)
      legs = free ? [last, snap8(last, to)] : octi(last, to, diag)
      // never double straight back on the incoming leg
      const first = legs.length === 3 && unit([legs[1][0] - last[0], legs[1][1] - last[1]])
      if (!free && inDir && first && first[0] * inDir[0] + first[1] * inDir[1] < -0.5) legs = octi(last, to, !diag)
      // a near miss: a leg too short to see is a jog off the flow, so the stop lines up instead
      const short = legs.length === 3 && Math.min(dist(legs[0], legs[1]), dist(legs[1], legs[2])) * z < JOG
      if (!free && to === c && short) legs = [last, snap8(last, c)]
      legs = legs.slice(1)
      meta = legs.map((_, i) => i === legs.length - 1 && ln && !free ? this.onLane(ln) : { r: this.r, link: null })
    }
    return { pts: [...this.pts, ...legs], meta: [...this.meta, ...meta] }
  }

  /** Whether the leg from `last` to `to` starts with its 45° leg: the way the pointer left the
   *  stop; else off a lane at 45° to it (it peels off), onto one with the 45° leg last (it curves
   *  on), or the order turning least. B swaps. */
  private order(last: XY, to: XY, prev: Link | null, ln?: Lane) {
    const away = prev && findLine(this.live(), prev.of)
    const auto = this.lead ?? (away ? straight(pathOf(away), prev.i) : ln ? !straight(ln.path, ln.i)
      : diagFirst(last, to, lastDir(this.pts)))
    return auto !== this.bend
  }

  /** First leg of a branch: it starts back along the trunk by up to a bend radius, so the bend at
   *  the fork rounds off the trunk; it leaves towards the pointer's side of the trunk. */
  private branch(c: XY, free: boolean): { pts: XY[], meta: Meta[] } {
    const j = this.pts[0], { u, back, fwd } = this.fork!
    const ahead = (c[0] - j[0]) * u[0] + (c[1] - j[1]) * u[1] >= 0, s = ahead ? 1 : -1
    const dir: XY = [u[0] * s, u[1] * s], b = Math.min(this.r, ahead ? back : fwd)
    const tail: XY = [j[0] - dir[0] * b, j[1] - dir[1] * b]
    const to = this.snapLine(c)?.q ?? c
    // it leaves at the fork: first the leg at 45° to the trunk (B swaps)
    const legs = (free ? [j, snap8(j, to)] : octi(j, to, straight([[0, 0], u], 0) !== this.bend)).slice(1)
    const r = { r: this.r, link: null }
    return { pts: [tail, j, ...legs], meta: [r, r, ...legs.map(() => r)] }
  }

  private near(p: XY, q?: XY) { return !!q && dist(p, q) < SNAP / this.zoom() }
  private closing(p: XY) { return this.pts.length >= 2 && this.near(p, this.pts[0]) }

  /** The line under p (nearest centre line), for hover, selection and labels. */
  private lineAt(p: XY): Ln | undefined {
    const tol = SNAP / this.zoom()
    let best: Ln | undefined, bd = Infinity
    for (const l of this.lines()) {
      const d = nearest(l.drawn, p).d - l.width / 2
      if (d < Math.max(tol / 2, 0) && d < bd) { best = l; bd = d }
    }
    return best
  }

  /** Where each strand of a cable ends (its leg tip), per end. */
  private tips(el: any) {
    const c = cableOf(el)!, w = el.strokeWidth, path = pathOf(el), drawn = centre(el)
    const tip = (end: 'start' | 'end', j: number): XY => {
      const at = end === 'start' ? path[0] : path[path.length - 1], to = c.legs?.[end]?.[j]
      if (to) return [at[0] + to[0], at[1] + to[1]]
      const { u } = pointAt(drawn, end === 'start' ? 0 : Infinity), o = (j - (c.n - 1) / 2) * w
      return [at[0] - u[1] * o, at[1] + u[0] * o]
    }
    return (['start', 'end'] as const).flatMap(end => Array.from({ length: c.n }, (_, j) => ({ end, j, at: tip(end, j) })))
  }

  private draw(free = false) {
    if (!this.active) { this.layer.replaceChildren(); return }
    const s = this.api.getAppState(), z = s.zoom.value
    const path = (pts: XY[], cls: string, w = s.currentItemStrokeWidth * z, color = s.currentItemStrokeColor) => {
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', pts.length ? 'M' + pts.map(q => this.screen(q).join(',')).join('L') : '')
      p.setAttribute('class', cls)
      p.style.stroke = color
      p.style.strokeWidth = String(w)
      return p
    }
    const dot = (q: XY, r: number, cls: string) => {
      const c = document.createElementNS(NS, 'circle'), [x, y] = this.screen(q)
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', String(r))
      c.setAttribute('class', cls)
      return c
    }
    const n = this.pts.length, c = this.cursor, kids: SVGElement[] = []
    if (this.mode === 'line') {
      // the line as it will be: rounded, cable wide, the leg to the pointer included
      const r = this.route(free)
      kids.push(path(round(r.pts, r.meta.map(m => m.r)), 'ligne-live', this.width() * z))
      kids.push(...r.pts.slice(0, n).map(q => dot(q, 2.5, 'ligne-stop')))
    }
    const ln = c && n && this.mode === 'line' ? this.lane(c) : undefined
    if (ln) kids.push(path(round(ln.path.map((_, i) => offsetAt(ln.path, i, 0, ln.d)),
      concentric(ln.path, ln.radii, ln.d)), 'ligne-guide', 1.5), dot(ln.q, 5, 'ligne-snap lane'))
    const g = c && !n ? this.grab(c) : undefined
    if (c && n && (this.closing(c) || this.near(c, this.pts[n - 1])))
      kids.push(dot(this.closing(c) ? this.pts[0] : this.pts[n - 1], 8, 'ligne-snap end'))
    else if (g?.kind === 'point') kids.push(dot(pathOf(g.el)[g.i], 6, 'ligne-snap point'))
    else if (c && !n && this.mode !== 'station') {
      // idle: the line under the pointer (double-click selects it); in labels mode where the text goes
      const l = this.lineAt(c), lane = !l && this.mode === 'line' ? this.lane(c) : undefined
      if (l) kids.push(path(l.drawn, 'ligne-hover', l.width * z + 6, '#1971c2'))
      if (l && this.mode === 'label') kids.push(dot(nearest(l.drawn, c).q, 4, 'ligne-snap'))
      else if (lane) kids.push(dot(lane.q, 5, 'ligne-snap lane'))
      else if (!l) {
        const hit = this.snapLine(c)
        if (hit?.end) kids.push(dot(hit.q, 8, 'ligne-snap end'))
      }
    } else if (c && !ln) {
      const hit = this.snapLine(c)
      if (hit) kids.push(dot(hit.q, this.mode === 'station' ? (DOT[this.shape as 'stop']?.d ?? 8) * z / 2
        : hit.end ? 8 : 6, 'ligne-snap'))
    }
    // cable leg tips near the pointer: drag them into place
    if (c && !n && this.mode === 'line') for (const l of this.lines()) {
      if (!cableOf(l.el) || nearest(l.drawn, c).d > 60 / z) continue
      for (const t of this.tips(l.el)) kids.push(dot(t.at, 4, 'ligne-snap tip' + (g?.kind === 'leg'
        && g.el === l.el && g.end === t.end && g.j === t.j ? ' end' : '')))
    }
    this.layer.replaceChildren(...kids)
  }

  // --- pointer: while drawing a press adds a stop; idle, it is a click or a drag of what it grabbed ---
  private down(e: PointerEvent) {
    // keys go to Excalidraw's container, so its undo, delete, copy keep working
    this.container()?.focus({ preventScroll: true })
    if (e.button !== 0 || e.detail > 1) return
    const p = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    if (e.altKey || this.picking) return this.pick(p)
    if (this.pts.length) return this.stop(p, e.shiftKey)
    this.layer.setPointerCapture(e.pointerId)
    this.press = { at: p, grab: this.grab(p), start: this.api.getSceneElements().slice() }
  }

  private move(e: PointerEvent) {
    const c = this.cursor = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    // the way the pointer leaves the last stop picks the leg order; back at the stop, it picks again
    const last = this.pts[this.pts.length - 1], z = this.zoom()
    if (last && dist(c, last) * z < LEAD / 3) this.lead = undefined
    else if (last && this.lead === undefined && dist(c, last) * z > LEAD) this.lead = isDiag([c[0] - last[0], c[1] - last[1]])
    const pr = this.press
    if (pr?.grab && (pr.dragging || dist(pr.at, c) * z > DRAG)) {
      pr.dragging = true
      this.drag(pr.grab, c, e.shiftKey, 'EVENTUALLY')
    }
    this.draw(e.shiftKey)
  }

  private up(e: PointerEvent) {
    const pr = this.press
    this.press = undefined
    if (!pr) return
    if (pr.dragging) this.drag(pr.grab!, this.scene(e), e.shiftKey, 'IMMEDIATELY')
    else if (this.mode === 'station') this.station(pr.at)
    else if (this.mode === 'label') this.label(pr.at)
    else this.start(pr.at)
    this.draw()
  }

  /** Double-click: ends the line being drawn; on a line just started (a click of the double-click),
   *  selects the line under the pointer instead. */
  private dbl(e: MouseEvent) {
    const fresh = this.editing ? this.pts.length === this.editing.n : this.pts.length <= 1
    if (!fresh) return this.finish()
    this.reset()
    const l = this.lineAt(this.scene(e))
    if (l) this.select(l.el)
  }

  /** Selects line el alone, inside its groups, as the lines ligne's radius and cable act on. */
  private select(el: any) {
    const s = specOf(el)
    this.api.updateScene({ appState: { selectedElementIds: { [el.id]: true }, selectedGroupIds: {},
      editingGroupId: s.own ?? s.stack ?? null } })
    this.sel = [el.id]
    this.r = s.r
    this.panelUI()
  }

  /** After Excalidraw's double-click into a stack (it picks the topmost line in reach): the line
   *  nearest p instead, with its own group (a cable's strands) as Excalidraw would select it. */
  private refine(p: XY) {
    const s = this.api.getAppState(), g = s.editingGroupId, ids = Object.keys(s.selectedElementIds ?? {})
    const els = this.live()
    if (!g || !ids.length || !ids.every(id => els.find(e => e.id === id)?.customData?.ligne)) return
    const best = this.lines().filter(l => l.el.groupIds?.includes(g))
      .map(l => ({ el: l.el, d: nearest(l.drawn, p).d - l.width / 2 })).sort((a, b) => a.d - b.d)[0]
    if (!best || best.d > SNAP / this.zoom() || ids.includes(best.el.id)) return
    const own = specOf(best.el).own, pick = own ? els.filter(e => e.groupIds?.[0] === own) : [best.el]
    this.api.updateScene({ appState: { selectedElementIds: Object.fromEntries(pick.map(e => [e.id, true])),
      selectedGroupIds: own ? { [own]: true } : {} } })
  }

  /** What a press at p would drag: a station mark or label, a line label, a cable leg tip, a waypoint. */
  private grab(p: XY): Grab | undefined {
    const tol = SNAP / this.zoom(), els = this.live()
    const inside = (e: any, pad = 0) => {
      // in the element's own frame, as it may be turned
      const cx = e.x + e.width / 2, cy = e.y + e.height / 2, a = -(e.angle ?? 0)
      const dx = p[0] - cx, dy = p[1] - cy, x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a)
      return Math.abs(x) <= e.width / 2 + pad && Math.abs(y) <= e.height / 2 + pad
    }
    const marks = els.filter(e => e.customData?.ligne?.kind === 'station')
    const mark = marks.find(m => inside(m, tol / 2))
    if (mark) return { kind: 'station', mark, group: groupOf(els, mark) }
    for (const m of marks) {
      const label = groupOf(els, m).filter(e => e !== m)
      if (label.some(e => inside(e))) return { kind: 'label', group: label }
    }
    const tag = els.find(e => e.customData?.ligne?.kind === 'label' && inside(e))
    if (tag) return { kind: 'tag', group: groupOf(els, tag), line: findLine(els, tag.customData.ligne.line) }
    if (this.mode !== 'line') return
    // the nearest leg tip: a cable's tips sit a strand width apart
    const tip = this.lines().filter(l => cableOf(l.el)).flatMap(l => this.tips(l.el).map(t => ({ ...t, el: l.el })))
      .map(t => ({ t, d: dist(p, t.at) })).sort((a, b) => a.d - b.d)[0]
    if (tip && tip.d < tol * 0.6) return { kind: 'leg', el: tip.t.el, end: tip.t.end, j: tip.t.j }
    for (const l of this.lines(true)) {
      const i = l.path.findIndex(q => dist(p, q) < tol)
      if (i >= 0) return { kind: 'point', el: l.el, i }
    }
  }

  /** Drags a grab to p, from the scene as it was at the press. */
  private drag(g: Grab, p: XY, free: boolean, capture: string) {
    const start = this.press?.start ?? this.api.getSceneElements(), byId = new Map(start.map(e => [e.id, e]))
    let scene: any[]
    if (g.kind === 'point' || g.kind === 'leg') {
      const el = byId.get(g.el.id), s = specOf(el), n = s.path.length
      if (g.kind === 'point') {
        // the waypoint leaves any lane it was on and keeps both legs at 45°; lines on its lanes follow
        const zone = s.kind === 'zone', i = g.i
        const prev = i > 0 ? s.path[i - 1] : zone ? s.path[n - 2] : undefined
        const next = i < n - 1 ? s.path[i + 1] : zone ? s.path[1] : undefined
        s.path[i] = free ? p : octiPoint(p, prev, next)
        if (zone && (i === 0 || i === n - 1)) s.path[n - 1 - i] = s.path[i]
        if (s.links) s.links[i] = null
      } else {
        // a leg tip: anywhere; dropped back at its strand's end, the leg goes
        const at = g.end === 'start' ? s.path[0] : s.path[n - 1], c = s.cable!, legs = c.legs ?? {}
        const home = this.tips({ ...el, customData: { ligne: { ...dataOf(el), cable: { ...c, legs: {} } } } })
          .find(t => t.end === g.end && t.j === g.j)!.at
        const list = (legs[g.end] ?? []).slice()
        list[g.j] = dist(p, home) < SNAP / this.zoom() ? null : [p[0] - at[0], p[1] - at[1]]
        s.cable = { ...c, legs: { ...legs, [g.end]: list } }
      }
      scene = restack(this.convert, replace(start, lineEls(this.convert, s, styleOf(el), el)), el.id)
    } else if (g.kind === 'tag') {
      // along its line, turned to read along it
      const line = g.line && this.lines().find(l => l.el.id === g.line.id)
      const n = line ? nearest(line.drawn, p) : undefined
      const u = n ? unit([line!.drawn[n.i + 1][0] - line!.drawn[n.i][0], line!.drawn[n.i + 1][1] - line!.drawn[n.i][1]]) : undefined
      const angle = u ? upright(u) : g.group[0].angle ?? 0, on = g.group[0].customData.ligne.on
      const k = on || !line ? 0 : line.width / 2 + 2, nn: XY = [Math.sin(angle), -Math.cos(angle)]
      const moved = new Map(g.group.map(e => byId.get(e.id)).map(e => {
        const h = on ? 0 : k + (e.height ?? 0) / 2 + 2
        const c: XY = n ? [n.q[0] + nn[0] * h, n.q[1] + nn[1] * h] : p
        return [e.id, bump(e, { x: c[0] - e.width / 2, y: c[1] - e.height / 2, angle })]
      }))
      scene = start.map(e => moved.get(e.id) ?? e)
    } else {
      const m = g.kind === 'station' ? byId.get(g.mark.id) : undefined
      const line = m && findLine(this.lines().map(l => l.el), m.customData.ligne.line)
      const at: XY = line ? nearest(centre(line), p).q : p
      // the mark's anchor: a net flag's first point, else the centre
      const d0 = this.press!.at, c: XY = !m ? d0 : m.type === 'line' ? [m.x + m.points[0][0], m.y + m.points[0][1]]
        : [m.x + m.width / 2, m.y + m.height / 2]
      const d: XY = m ? [at[0] - c[0], at[1] - c[1]] : [p[0] - d0[0], p[1] - d0[1]]
      const moved = new Map(g.group.map(e => byId.get(e.id)).map(e => [e.id, bump(e, { x: e.x + d[0], y: e.y + d[1] })]))
      scene = start.map(e => moved.get(e.id) ?? e)
    }
    this.api.updateScene({ elements: scene, captureUpdate: capture })
  }

  /** Alt-click (or the pick button): the clicked line's style (and cable) becomes ligne's. */
  private pick(p: XY) {
    const hit = this.lineAt(p)
    if (hit) {
      this.api.updateScene({ appState: toState(styleOf(hit.el)) })
      this.takeOptions(hit.el)
    }
    this.picking = false
    this.panelUI()
  }

  /** ligne's toggles from a line: cable, ticks, arrow. */
  private takeOptions(el: any) {
    const c = cableOf(el), d = dataOf(el)!
    this.twist = !!c
    if (c) this.cable = { style: c.style, n: c.n, pitch: c.pitch }
    this.ticks = !!d.ticks
    if (this.arrow !== !!d.arrow) { this.arrow = !!d.arrow; this.api.setActiveTool({ type: this.held() }) }
  }

  /** First stop: on a line's end the line is extended (in its own style, replaced on finish), on a
   *  lane it starts following that line, on a line it branches. */
  private start(p: XY) {
    // a free lane spot nearer than a line's end wins: stacked lines start a lane's width apart
    let hit = this.snapLine(p), ln = (!hit || hit.end) && this.lane(p)
    if (hit?.end && ln && dist(p, ln.q) < dist(p, hit.q)) hit = undefined
    else if (hit) ln = undefined
    this.bend = false
    this.lead = undefined
    if (hit?.end) {
      const s = specOf(hit.el), rev = hit.end === 'start', o = <T>(a: T[]) => rev ? a.slice().reverse() : a
      this.pts = o(s.path); this.meta = o(s.path.map((_, i) => ({ r: s.radii[i], link: s.links?.[i] ?? null })))
      this.editing = { id: hit.el.id, reversed: rev, n: s.path.length }; this.from = s.from; this.r = s.r
      this.api.updateScene({ appState: toState(styleOf(hit.el)) })
      this.takeOptions(hit.el)
      this.panelUI()
    } else if (ln) {
      this.pts = [ln.q]; this.meta = [this.onLane(ln)]
      this.track = { of: lidOf(ln.el), d: ln.d, i: ln.i }
    } else {
      this.pts = [hit?.q ?? p]; this.meta = [{ r: this.r, link: null }]
      this.from = hit?.el && lidOf(hit.el)
      if (hit?.el) {
        // a branch, as on the tube map: same style as the trunk, peeling off it in a curve
        const path = pathOf(hit.el), { i, t } = beside(path, hit.q), l = dist(path[i], path[i + 1])
        const u: XY = [(path[i + 1][0] - path[i][0]) / l, (path[i + 1][1] - path[i][1]) / l]
        this.fork = { u, back: t * l, fwd: (1 - t) * l }
        this.api.updateScene({ appState: toState(styleOf(hit.el)) })
      }
    }
  }

  /** Next stop: on the last stop it ends the line, on the first it closes it into a zone. */
  private stop(p: XY, free: boolean) {
    if (this.near(p, this.pts[this.pts.length - 1])) return this.finish()
    const closing = this.closing(p)
    this.cursor = p
    ;({ pts: this.pts, meta: this.meta } = this.route(free))
    this.bend = false
    this.lead = undefined
    if (closing) return this.finish()
    this.draw()
  }

  /** Changes the lines selected when ligne was turned on (lines on their lanes follow). */
  private applySel(f: (s: Spec) => void, capture: string) {
    if (this.pts.length || !this.sel.length) return false
    let scene = this.api.getSceneElements().slice()
    for (const id of this.sel) {
      const el = scene.find(e => e.id === id)
      if (!el || !isLine(el, true) || stale(el)) continue
      const s = specOf(el)
      f(s)
      scene = restack(this.convert, replace(scene, lineEls(this.convert, s, styleOf(el), el)), id)
    }
    this.api.updateScene({ elements: scene, captureUpdate: capture })
    return true
  }

  /** Bend radius r for the stops drawn so far (bar bends nested in another line's), else for the
   *  selected lines. */
  private radius(r: number, capture: string) {
    this.r = Math.max(0, Math.min(60, r))
    const own = (l: Link | null | undefined) => !l || l.t > 0
    for (const m of this.meta) if (own(m.link)) m.r = this.r
    this.applySel(s => { s.r = this.r; s.radii = s.radii.map((v, j) => own(s.links?.[j]) ? this.r : v) }, capture)
    this.save()
    this.draw()
  }

  /** Cable settings changed: for the line being drawn, else for the selected lines. */
  private cabling(capture = 'IMMEDIATELY') {
    this.applySel(s => { if (s.kind === 'line') s.cable = this.twist ? { ...this.cable, legs: s.cable?.legs } : undefined },
      capture)
    this.save()
    this.panelUI()
  }

  private save() {
    localStorage.setItem(OPTS, JSON.stringify({ r: this.r, cable: this.cable, onLine: this.onLine }))
  }

  private undoStop() {
    this.pts.pop(); this.meta.pop(); this.lead = undefined
    if (!this.pts.length) this.reset()
    this.draw()
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName) || !this.focused()) return
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation() }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd-Z while drawing takes back a stop; all else is Excalidraw's (undo, copy, …)
      if (this.active && this.pts.length && e.key.toLowerCase() === 'z' && !e.shiftKey) { this.undoStop(); stop() }
      // focus left Excalidraw (clicks on ligne's layer): hand the shortcut to it
      const box = this.container()
      if (this.active && box && !box.contains(t)) {
        stop()
        box.focus({ preventScroll: true })
        box.dispatchEvent(new KeyboardEvent('keydown', e))
      }
      return
    }
    if (e.altKey) return
    if (!this.active) {
      if (e.key === 'm') { this.setActive(true); stop() }
      return
    }
    const k = e.key, act = this.actions[k]
    if (k === 'Escape') this.pts.length ? this.reset() : this.setActive(false)
    else if (k === 'm') this.setActive(false)
    else if ((k === 'Backspace' || k === 'Delete') && !this.pts.length) return  // Excalidraw deletes the selection
    else if (k in SHAPES && this.mode === 'station') { this.shape = SHAPES[k]; this.panelUI() }
    else if (act) act()
    else return
    stop()
    // a host listening before us (Obsidian's Excalidraw plugin) may still have picked a tool by that key
    if (this.active) setTimeout(() => this.api.setActiveTool({ type: this.held() }))
    this.draw(e.shiftKey)
  }

  /** Key → action; the panel buttons run the same. */
  private actions: Record<string, () => void> = {
    Enter: () => this.finish(), Backspace: () => this.undoStop(), Delete: () => this.undoStop(),
    b: () => this.mode === 'station' ? this.toggle('boxed') : this.mode === 'label' ? this.toggle('onLine')
      : this.toggle('bend'),
    s: () => this.setMode(this.mode === 'station' ? 'line' : 'station'),
    l: () => this.setMode(this.mode === 'label' ? 'line' : 'label'),
    o: () => this.toggle('landscape'), '?': () => this.toggle('help'),
    h: () => this.toggle('help'), i: () => this.toggle('picking'), d: () => this.toggle('ticks'),
    t: () => { this.twist = !this.twist; this.cabling() },
    T: () => {
      this.cable = { ...this.cable, style: STYLES[(STYLES.indexOf(this.cable.style) + 1) % STYLES.length] }
      this.twist = true
      this.cabling()
    },
    a: () => { this.toggle('arrow'); this.api.setActiveTool({ type: this.held() }) },
    n: () => this.toggle('snap'),
    '[': () => { this.radius(this.r - 4, 'IMMEDIATELY'); this.panelUI() },
    ']': () => { this.radius(this.r + 4, 'IMMEDIATELY'); this.panelUI() },
    g: () => this.copy(), k: () => this.legend(), p: () => this.paper('A5'), P: () => this.paper('A6'),
  }
  private toggle(k: 'boxed' | 'landscape' | 'help' | 'picking' | 'ticks' | 'arrow' | 'free' | 'snap' | 'bend' | 'onLine') {
    this[k] = !this[k]
    if (k === 'ticks') this.applySel(s => { s.ticks = this.ticks }, 'IMMEDIATELY')
    if (k === 'onLine') this.save()
    this.panelUI()
  }

  private setMode(m: Mode) { this.reset(); this.mode = m; this.panelUI() }
  private reset() {
    this.pts = []; this.meta = []
    this.from = this.editing = this.fork = this.lead = this.track = undefined
    this.bend = false
    this.draw()
  }

  graph() { return graph(this.api.getSceneElements()) }
  text() { return toText(this.graph()) }

  private copy() { navigator.clipboard?.writeText(this.text()) }

  private add(els: any[], back = false) {
    const all = this.api.getSceneElements()
    this.api.updateScene({ elements: back ? [...els, ...all] : [...all, ...els], captureUpdate: 'IMMEDIATELY' })
  }

  /** Drops a station on the nearest line (or where clicked); a net flag points away from a line end. */
  private station(p: XY) {
    const hit = this.snapLine(p), n = this.graph().stations.length + 1
    const tip = hit?.end === 'end' ? hit.path.slice(-2) : hit?.end === 'start' ? hit.path.slice(0, 2).reverse() : []
    this.add(station(this.convert, {
      at: hit?.q ?? p, shape: this.shape, line: hit?.el && lidOf(hit.el), boxed: this.boxed,
      font: fontOf(this.api.getAppState()),
      color: hit?.el?.strokeColor ?? this.api.getAppState().currentItemStrokeColor,
      text: this.shape === 'net' ? `NET${n}` : `S${n}`, dir: tip.length && tip[1][0] < tip[0][0] ? -1 : 1,
    }))
  }

  /** Text on the line at p: asks for it in place, then sets it along the line. */
  private label(p: XY) {
    const l = this.lineAt(p)
    if (!l) return
    const n = nearest(l.drawn, p), a = l.drawn[n.i], b = l.drawn[n.i + 1] ?? a
    const angle = upright(unit([b[0] - a[0], b[1] - a[1]])), s = this.api.getAppState()
    this.ask(n.q, text => this.add(lineLabel(this.convert, { at: n.q, angle, text, font: fontOf(s),
      color: l.el.strokeColor, paper: s.viewBackgroundColor ?? '#ffffff', line: lidOf(l.el), on: this.onLine,
      off: l.width / 2 })))
  }

  /** A small text box at scene point p; Enter (or leaving it) gives its text, Esc drops it. */
  private ask(p: XY, done: (text: string) => void) {
    this.input?.remove()
    const i = this.input = document.createElement('input'), [x, y] = this.screen(p)
    i.className = 'ligne-input'
    i.placeholder = 'label'
    Object.assign(i.style, { left: `${x}px`, top: `${y}px` })
    let over = false
    const end = (keep: boolean) => {
      if (over) return
      over = true
      i.remove()
      if (this.input === i) this.input = undefined
      if (keep && i.value.trim()) done(i.value.trim())
      this.container()?.focus({ preventScroll: true })
    }
    i.onkeydown = e => {
      e.stopPropagation()
      if (e.key === 'Enter') end(true)
      if (e.key === 'Escape') end(false)
    }
    i.onblur = () => end(true)
    this.host.append(i)
    setTimeout(() => i.focus())
  }

  /** Commits the drawn stops: a line, or a zone at the back when it ends on its first stop. A line
   *  on lanes of others joins their stack; lines on its own lanes are rebuilt to follow it. */
  private finish() {
    const keep = kept(this.pts)
    let pts = keep.map(i => this.pts[i]), meta = keep.map(i => this.meta[i])
    const closed = pts.length > 3 && same(pts[0], pts[pts.length - 1])
    if (pts.length < 2 || same(pts[0], pts[pts.length - 1]) && !closed) return this.reset()
    const ed = this.editing, base = ed && this.live().find(e => e.id === ed.id)
    // ending on a line (not a lane): a junction, as a branch starts on one
    const endHit = !closed && !meta.at(-1)!.link ? this.lines().find(l => l.el !== base
      && nearest(l.drawn, pts.at(-1)!).d < l.width / 2 + 1) : undefined
    // extended at its start: back to its own direction, so lines on its lanes keep their legs
    if (ed?.reversed) { pts = pts.reverse(); meta = meta.reverse() }
    let scene = this.api.getSceneElements().slice()
    const d = base ? specOf(base) : undefined
    const of = new Set(meta.map(m => m.link?.of).filter(Boolean) as string[])
    const on = [...of].map(id => findLine(scene, id)).filter(Boolean)
    let stack = d?.stack
    for (const e of on) stack ??= specOf(e).stack
    if (on.length) {
      stack ??= groupId()
      const owns = new Set(on.map(e => specOf(e).own).filter(Boolean))
      scene = scene.map(e => on.includes(e) || owns.has(e.groupIds?.[0]) && !isLine(e, true) ? this.join(e, stack!) : e)
    }
    const spec: Spec = { kind: closed ? 'zone' : 'line', lid: d?.lid, path: pts, radii: meta.map(m => m.r),
      links: meta.map(m => m.link), r: this.r, from: this.from, to: endHit ? lidOf(endHit.el) : d?.to, stack,
      cable: this.twist ? { ...this.cable, legs: d?.cable?.legs } : undefined, ticks: this.ticks, arrow: this.arrow,
      own: d?.own }
    const els = lineEls(this.convert, spec, fromState(this.api.getAppState()), base)
    if (base) {
      const shift = ed.reversed ? pts.length - ed.n : 0
      if (shift) scene = scene.map(e => this.shiftLinks(e, lidOf(base), shift))
      scene = restack(this.convert, replace(scene, els), base.id)
    } else scene = closed ? [...els, ...scene] : [...scene, ...els]
    this.api.updateScene({ elements: scene, captureUpdate: 'IMMEDIATELY' })
    this.reset()
  }

  /** e with stack group g (outermost) when it has none yet. */
  private join(e: any, g: string) {
    const d = e.customData.ligne
    if (d.stack || e.groupIds?.includes(g)) return e
    return bump(e, { groupIds: [...(e.groupIds ?? []), g],
      customData: { ...e.customData, ligne: d.kind === 'line' || d.kind === 'zone' ? { ...d, stack: g } : d } })
  }

  /** Links of e onto line `of` moved `k` legs on (that line grew k waypoints at its start). */
  private shiftLinks(e: any, of: string, k: number) {
    const d = isLine(e) && dataOf(e)
    if (!d || !d.links?.some(l => l?.of === of)) return e
    const links = d.links.map(l => l?.of === of ? { ...l, i: l.i + k } : l)
    return bump(e, { customData: { ...e.customData, ligne: { ...d, links } } })
  }

  /** (Re)builds the legend: one row per line style, names kept, in place or top-left of the view. */
  private legend() {
    const els = this.live(), old = els.filter(e => e.customData?.ligne?.kind === 'legend')
    const names = new Map(old.filter(e => e.customData.ligne.key).map(e => [e.customData.ligne.key,
      els.find(t => t.type === 'text' && t.groupIds?.[0] === e.groupIds?.[0])?.text]))
    const rows = new Map<string, { key: string, style: Style, name: string }>()
    for (const l of this.lines()) {
      const style = styleOf(l.el), key = [style.strokeColor, style.strokeWidth, style.strokeStyle].join(' ')
      if (!rows.has(key)) rows.set(key, { key, style, name: names.get(key) ?? `line ${rows.size + 1}` })
    }
    if (!rows.size) return
    const s = this.api.getAppState(), z = s.zoom.value
    const box = old.find(e => e.type === 'rectangle')
    const at: XY = box ? [box.x, box.y] : [60 / z - s.scrollX, 100 / z - s.scrollY]
    const gone = new Set(els.filter(e => old.some(o => e.groupIds?.includes(o.groupIds?.at(-1)))).map(e => e.id))
    const all = this.api.getSceneElements().map(e => gone.has(e.id) ? bump(e, { isDeleted: true }) : e)
    this.api.updateScene({ elements: [...all, ...legend(this.convert, at, fontOf(s), [...rows.values()])],
      captureUpdate: 'IMMEDIATELY' })
  }

  /** A paper frame centred in the view. */
  private paper(size: keyof typeof PAPER) {
    const s = this.api.getAppState(), z = s.zoom.value
    this.add(paper(this.convert, [s.width / 2 / z - s.scrollX, s.height / 2 / z - s.scrollY], size, this.landscape), true)
  }

  private range(title: string, min: number, max: number, value: number, set: (v: number, capture: string) => void) {
    const r = document.createElement('label')
    r.className = 'ligne-range'
    r.title = title
    const input = Object.assign(document.createElement('input'), { type: 'range', min: String(min), max: String(max),
      value: String(value) })
    const val = Object.assign(document.createElement('span'), { textContent: String(value) })
    input.oninput = () => { set(+input.value, 'EVENTUALLY'); val.textContent = input.value }
    input.onchange = () => set(+input.value, 'IMMEDIATELY')
    r.append(input, val)
    return r
  }

  private panelUI() {
    const mode = this.mode, A = this.actions
    const radius = this.range('Bend radius (0: sharp): the line being drawn, else the selected lines [ [ ] ]',
      0, 60, this.r, (v, c) => this.radius(v, c))
    const pitch = this.range('Twist / check length', 4, 80, this.cable.pitch, (v, c) => {
      this.cable = { ...this.cable, pitch: v }; this.applySel(s => { if (s.cable) s.cable = { ...s.cable, pitch: v } }, c)
      this.save()
    })
    const cableItems: Item[] = this.twist ? [
      { icon: this.cable.style, title: `Cable: ${this.cable.style} (round, zigzag, checks)`, key: '⇧T', click: A.T },
      { icon: 'strands', title: 'Strands', text: '×' + this.cable.n,
        click: () => { this.cable = { ...this.cable, n: this.cable.n >= 4 ? 2 : this.cable.n + 1 }; this.cabling() } }, pitch,
    ] : []
    const items: Item[] = [
      { icon: 'line', title: 'Lines', key: 'S', on: mode === 'line', click: () => this.setMode('line') },
      { icon: 'station', title: 'Stations', key: 'S', on: mode === 'station', click: () => this.setMode('station') },
      { icon: 'label', title: 'Labels on lines', key: 'L', on: mode === 'label', click: () => this.setMode('label') },
      'sep',
      ...(mode === 'line' ? [
        { icon: 'free', title: 'Free legs, 8 directions (or hold Shift)', key: '⇧', on: this.free,
          click: () => this.toggle('free') },
        { icon: 'magnet', title: 'Snap to lines and lanes (hold Ctrl/Cmd: off)', key: 'N', on: this.snap, click: A.n },
        { icon: 'bend', title: 'Bend the other way (the other leg first)', key: 'B', on: this.bend, click: A.b }, radius,
        { icon: 'arrow', title: 'Arrowheads (Excalidraw\'s arrow style)', key: 'A', on: this.arrow, click: A.a },
        { icon: 'ticks', title: 'Direction chevrons, the way the line was drawn', key: 'D', on: this.ticks, click: A.d },
        { icon: 'twist', title: 'Cable (2nd colour: Excalidraw\'s background)', key: 'T', on: this.twist, click: A.t },
        ...cableItems,
        'sep' as const,
        { icon: 'finish', title: 'End the line', key: '⏎', click: A.Enter },
        { icon: 'undo', title: 'Undo a stop', key: '⌫', click: A.Backspace },
        { icon: 'cancel', title: 'Cancel the line', key: 'Esc', click: () => this.reset() },
      ] : mode === 'station' ? [
        ...Object.entries(SHAPES).map(([k, v]) => ({ icon: v, title: v[0].toUpperCase() + v.slice(1), key: k,
          on: this.shape === v, click: () => { this.shape = v; this.panelUI() } })),
        { icon: 'boxed', title: 'Labels in a box', key: 'B', on: this.boxed, click: A.b },
      ] : [
        { icon: 'boxed', title: this.onLine ? 'On the line (click: beside it)' : 'Beside the line (click: on it)',
          key: 'B', on: this.onLine, click: A.b },
      ]),
      { icon: 'pick', title: 'Take a line\'s style (or Alt-click)', key: 'I', on: this.picking, click: A.i },
      'sep',
      { icon: 'legend', title: 'Legend', key: 'K', click: A.k },
      { icon: 'paper', title: 'A5 sheet', key: 'P', text: 'A5', click: A.p },
      { icon: 'paper', title: 'A6 sheet', key: '⇧P', text: 'A6', click: A.P },
      { icon: 'landscape', title: 'Sheets in landscape', key: 'O', on: this.landscape, click: A.o },
      'sep',
      { icon: 'copy', title: 'Copy the graph as text', key: 'G', click: A.g },
      { icon: 'help', title: 'Help', key: '?', on: this.help, click: A['?'] },
    ]
    this.panel.render(this.active, items, this.help ? HELP : undefined)
  }
}

