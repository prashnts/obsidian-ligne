// The ligne drawing tool: a transparent layer over an Excalidraw canvas. Works on the plain
// Excalidraw API, so the web page and the Obsidian Excalidraw plugin mount the same thing.
//
// Click to place stops; between them the line runs octilinear (one straight + one 45° leg),
// traced dotted up to the pointer. Shift: free leg snapped to 8 directions. F flips the leg order.
// Click the last stop again (or double-click, Enter) to end; end on the first stop to close the
// shape into a zone, sent to the back. Backspace undoes a stop, Esc cancels (leaves when idle).
// Start on a line to branch off it, on its end to extend it; drag a waypoint to move it.
// Beside a line the pointer snaps to its lanes (touching parallels): along a lane the new line
// follows that line bend for bend, around the same centres, and leaves it where clicked away.
// Lines sharing lanes form a stack (an Excalidraw group: click = the stack, double-click = one
// line); moving a line's waypoint carries the lines on its lanes along.
// Colour, width, dash, sloppiness, fill, arrowheads come from Excalidraw's own style panel (ligne
// keeps its line or arrow tool selected meanwhile), remembered for ligne apart from other shapes.
// S switches to stations: click a line to drop one, its label holds `key: value` data. Drag a
// station along its line, or its label alone. G copies the graph as text.
import { beside, concentric, dist, kept, lastDir, nearest, octi, offsetAt, round, same, snap8,
  type XY } from './core/geom.ts'
import { graph, toText, type Link, type Shape } from './core/graph.ts'
import { lineEls, isLine, dataOf, pathOf, radiiOf, replace, resized, restack, specOf, type Spec } from './lines.ts'
import { DOT, PAPER, bump, fontOf, fromState, groupId, legend, make, paper, station, styleOf, toState,
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
const ON = 6                                      // px on screen: onto a line, onto a lane
const DRAG = 4                                    // px on screen before a press is a drag
const SAVED = 'ligne-style'
const DEFAULT: Partial<Style> = { strokeWidth: 4, roughness: 0, strokeStyle: 'solid', opacity: 100 }
const SHAPES: Record<string, Shape> = { '1': 'stop', '2': 'interchange', '3': 'commit', '4': 'net' }

const HELP: [string, string][] = [
  ['click', 'stop · on a line: branch (peels off, trunk style) · on its end: extend'],
  ['beside a line', 'its lanes: joins and leaves at 45° in a curve, follows it bend for bend'],
  ['Ctrl / Cmd held · N', 'no snapping: place anywhere'],
  ['[ / ]', 'bend radius: the line drawn, else lines selected before M'],
  ['click last stop', 'end the line (also double-click, Enter)'],
  ['click first stop', 'close into a zone, at the back'],
  ['drag', 'waypoint (its lanes follow) · station along its line · label'],
  ['stack', 'click: whole stack · double-click: one line (Excalidraw groups)'],
  ['Shift / ⇧ button', 'free leg, 8 directions'], ['F', 'flip the leg order'],
  ['Backspace / Esc', 'undo a stop / cancel, leave'], ['Alt-click / I', "take a line's style"],
  ['A / D / T', 'arrowheads · direction ticks · twisted pair'],
  ['style', "Excalidraw's panel: colour, width, dash, arrowheads, font"],
  ['S', 'lines ⇄ stations'], ['1–4', 'stop, interchange, commit, net flag'], ['B', 'labels in a box'],
  ['K', 'legend (again: rebuild)'], ['P / ⇧P', 'A5 / A6 sheet'], ['O', 'sheets in landscape'],
  ['G', 'copy the graph as text'], ['M', 'ligne on / off'], ['?', 'this help'],
]

/** A stop: its bend radius and, on another line's lane, where. */
interface Meta { r: number, link: Link | null }
/** A lane beside a line: that line, where along it, the offset, the snapped point. */
interface Lane { el: any, path: XY[], radii: number[], i: number, t: number, d: number, q: XY }

/** Whether leg i of path runs along an axis (else it is diagonal). */
const straight = (path: XY[], i: number) => {
  const a = path[Math.min(i, path.length - 2)], b = path[Math.min(i, path.length - 2) + 1]
  return Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6
}

type Grab =
  | { kind: 'station', mark: any, group: any[] }
  | { kind: 'label', group: any[] }
  | { kind: 'point', el: any, i: number }

export class Ligne {
  active = false
  mode: 'line' | 'station' = 'line'
  shape: Shape = 'stop'
  boxed = false
  landscape = false
  help = false
  arrow = false
  ticks = false
  twist = false
  free = false                                     // sticky Shift
  snap = true                                      // onto lines and lanes; Ctrl/Cmd held: off
  private mod = false
  private sel: string[] = []                       // lines selected when ligne was turned on
  picking = false                                  // next click takes a line's style
  r = 24
  private pts: XY[] = []
  private meta: Meta[] = []
  private cursor?: XY
  private flip?: boolean
  private from?: string
  private editing?: { id: string, reversed: boolean, n: number }
  private fork?: { u: XY, back: number, fwd: number } // branching: the trunk's leg at the first stop
  private press?: { at: XY, grab?: Grab, dragging?: boolean, start: any[] }
  private outside?: Partial<Style>                 // Excalidraw's style while ligne is active
  private tool = ''
  private colors = new Map<string, string>()        // line id → stroke colour last seen
  readonly layer: SVGSVGElement
  private panel: Panel
  private off: (() => void)[] = []

  /** `focused`: whether keys are for this canvas (several may be open, e.g. Obsidian panes). */
  constructor(readonly api: Api, private host: HTMLElement, private convert: Convert,
    private focused: () => boolean = () => true) {
    host.style.position ||= 'relative'
    this.layer = document.createElementNS(NS, 'svg')
    this.layer.classList.add('ligne-layer')
    this.panel = new Panel(host, () => this.setActive(!this.active))
    host.append(this.layer)
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void) => {
      // capture: keys reach ligne before Excalidraw's own shortcuts (1, 2, 3 pick its tools)
      t.addEventListener(k, f as EventListener, true)
      this.off.push(() => t.removeEventListener(k, f as EventListener, true))
    }
    on(this.layer, 'pointermove', e => this.move(e))
    on(this.layer, 'pointerdown', e => this.down(e))
    on(this.layer, 'pointerup', e => this.up(e))
    on(this.layer, 'dblclick', () => this.finish())
    on(this.layer, 'wheel', e => this.canvas()?.dispatchEvent(new WheelEvent('wheel', e)))
    on(window, 'keydown', e => this.key(e))
    this.off.push(api.onChange((_, s) => this.changed(s)))
    this.follow()                                   // learns the line colours
    this.setActive(false)
  }

  destroy() { this.setActive(false); this.off.forEach(f => f()); this.layer.remove(); this.panel.destroy() }

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
    this.follow()
    if (resized(this.api.getSceneElements())) setTimeout(() => {
      const els = resized(this.api.getSceneElements())
      if (els) this.api.updateScene({ elements: els, captureUpdate: 'NEVER' })
    })
    const t = s.activeTool?.type
    if (this.active && this.tool === this.held() && t !== this.held()) this.setActive(false)
    this.tool = t
    if (!this.press?.dragging) this.draw()
  }

  /** A line recoloured in Excalidraw (or by undo) takes its stations' marks along: whatever in
   *  their groups had the old colour. Not in history: undo recolours the line, this follows again. */
  private follow() {
    const els = this.api.getSceneElements(), moved = new Map<string, [string, string]>()
    for (const e of els) {
      if (!isLine(e)) continue
      const was = this.colors.get(e.id)
      if (was && was !== e.strokeColor) moved.set(e.id, [was, e.strokeColor])
      this.colors.set(e.id, e.strokeColor)
    }
    if (!moved.size) return
    const recolor = new Map<string, [string, string]>()
    for (const m of els) {
      const c = m.customData?.ligne?.kind === 'station' && moved.get(m.customData.ligne.line)
      if (c) for (const e of els) if (e.groupIds?.some((g: string) => m.groupIds?.includes(g))) recolor.set(e.id, c)
    }
    const swap = (e: any, [a, b]: [string, string]) => bump(e, {
      ...(e.strokeColor === a && e.type !== 'text' ? { strokeColor: b } : {}),
      ...(e.backgroundColor === a ? { backgroundColor: b } : {}) })
    // after Excalidraw has recorded the recolour, else its history entry is lost
    if (recolor.size) setTimeout(() => this.api.updateScene({ captureUpdate: 'NEVER',
      elements: this.api.getSceneElements().map(e => recolor.has(e.id) ? swap(e, recolor.get(e.id)!) : e) }))
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
  private live() { return this.api.getSceneElements().filter(e => !e.isDeleted) }

  /** ligne lines (and zones) in the scene: waypoints, bend radii and drawn points, absolute. */
  private lines(zones = false) {
    return this.live().filter(e => isLine(e, zones)).map(e => ({ el: e, path: pathOf(e), radii: radiiOf(e),
      drawn: e.points.map(([x, y]: XY) => [x + e.x, y + e.y] as XY) as XY[] }))
  }

  private snapping() { return this.snap && !this.mod }

  /** Snaps p onto a nearby ligne line; `end` when it is on one of the line's ends. `always`:
   *  even with snapping off (picking a line, not placing a stop). */
  private snapLine(p: XY, always = false) {
    if (!always && !this.snapping()) return
    const tol = SNAP / this.zoom(), on = ON / this.zoom()
    let best: { q: XY, el: any, path: XY[], d: number, end?: 'start' | 'end' } | undefined
    for (const l of this.lines()) {
      const n = nearest(l.drawn, p), [a, b] = [l.path[0], l.path[l.path.length - 1]]
      const end = dist(p, a) < tol ? 'start' : dist(p, b) < tol ? 'end' : undefined
      if ((end ? n.d < tol : n.d < on) && (!best || n.d < best.d))
        best = { q: end ? (end === 'start' ? a : b) : n.q, el: l.el, path: l.path, d: n.d, end }
    }
    return best
  }

  /** The lane nearest p beside a line: its k-th parallel (k = ±1, ±2), touching with a small gap. */
  private lane(p: XY): Lane | undefined {
    if (!this.snapping()) return
    const w = this.api.getAppState().currentItemStrokeWidth, tol = ON / this.zoom()
    let best: Lane | undefined, off = Infinity
    for (const l of this.lines()) {
      const lw = l.el.strokeWidth, pitch = (lw + w) / 2 + Math.max(1, Math.min(lw, w) / 2)
      let { i, t, d } = beside(l.path, p)
      const k = Math.round(d / pitch), o = Math.abs(d - k * pitch)
      if (k === 0 || Math.abs(k) > 2 || o > Math.min(tol, pitch / 2) || o >= off) continue
      if (t > 1 - 1e-6 && i + 1 < l.path.length - 1) { i++; t = 0 }
      off = o
      best = { el: l.el, path: l.path, radii: l.radii, i, t, d: k * pitch, q: offsetAt(l.path, i, t, k * pitch) }
    }
    return best
  }

  /** A stop on lane ln: on a bend it takes the bend's concentric radius. */
  private onLane(ln: Lane): Meta {
    const bend = ln.t < 1e-6 && ln.i > 0 && ln.i < ln.path.length - 1
    return { r: bend ? concentric(ln.path, ln.radii, ln.d)[ln.i] : this.r,
      link: { of: ln.el.id, i: ln.i, t: ln.t, d: ln.d } }
  }

  /** Stops so far plus the leg(s) out to the pointer: along the lane the last stop is on, or
   *  octilinear (closing onto the first stop, snapping to lanes and lines). */
  private route(free = false): { pts: XY[], meta: Meta[] } {
    const n = this.pts.length, last = this.pts[n - 1], c = this.cursor
    if (!c || !last || this.mode === 'station') return { pts: this.pts, meta: this.meta }
    free ||= this.free
    if (this.fork && n === 1) return this.branch(c, free)
    const ln = this.closing(c) ? undefined : this.lane(c), prev = this.meta[n - 1].link
    let legs: XY[], meta: Meta[]
    if (ln && prev && !free && prev.of === ln.el.id && prev.d === ln.d) {
      // follow: the lane's bends between the two stops, then the stop
      const { path, d } = ln, conc = concentric(path, ln.radii, d), ks: number[] = []
      if (prev.i + prev.t <= ln.i + ln.t) for (let k = prev.i + 1; k <= (ln.t < 1e-6 ? ln.i - 1 : ln.i); k++) ks.push(k)
      else for (let k = prev.t < 1e-6 ? prev.i - 1 : prev.i; k > ln.i; k--) ks.push(k)
      legs = [...ks.map(k => offsetAt(path, k, 0, d)), ln.q]
      meta = [...ks.map(k => ({ r: conc[k], link: { of: ln.el.id, i: k, t: 0, d } })), this.onLane(ln)]
    } else {
      // leaving a lane, the first leg is at 45° to it (it peels off at the stop); joining one, the
      // last (it curves onto it); F swaps
      const to = this.closing(c) ? this.pts[0] : ln?.q ?? this.snapLine(c)?.q ?? c, f = !!this.flip
      const away = prev && this.live().find(e => e.id === prev.of)
      const diagFirst = away ? straight(pathOf(away), prev.i) !== f : ln ? !straight(ln.path, ln.i) !== f : this.flip
      legs = (free ? [last, snap8(last, to)] : octi(last, to, diagFirst, lastDir(this.pts))).slice(1)
      meta = legs.map((_, i) => i === legs.length - 1 && ln && !free ? this.onLane(ln) : { r: this.r, link: null })
    }
    return { pts: [...this.pts, ...legs], meta: [...this.meta, ...meta] }
  }
  /** First leg of a branch: it starts back along the trunk by up to a bend radius, so the bend at
   *  the fork rounds off the trunk; it leaves towards the pointer's side of the trunk. */
  private branch(c: XY, free: boolean): { pts: XY[], meta: Meta[] } {
    const j = this.pts[0], { u, back, fwd } = this.fork!
    const ahead = (c[0] - j[0]) * u[0] + (c[1] - j[1]) * u[1] >= 0, s = ahead ? 1 : -1
    const dir: XY = [u[0] * s, u[1] * s], b = Math.min(this.r, ahead ? back : fwd)
    const tail: XY = [j[0] - dir[0] * b, j[1] - dir[1] * b]
    const to = this.snapLine(c)?.q ?? c
    // it leaves at the fork: first the leg at 45° to the trunk (F swaps)
    const legs = (free ? [j, snap8(j, to)] : octi(j, to, straight([[0, 0], u], 0) !== !!this.flip)).slice(1)
    const r = { r: this.r, link: null }
    return { pts: [tail, j, ...legs], meta: [r, r, ...legs.map(() => r)] }
  }

  private near(p: XY, q?: XY) { return !!q && dist(p, q) < SNAP / this.zoom() }
  private closing(p: XY) { return this.pts.length >= 2 && this.near(p, this.pts[0]) }

  private draw(free = false) {
    if (!this.active) { this.layer.replaceChildren(); return }
    const s = this.api.getAppState(), z = s.zoom.value
    const path = (pts: XY[], cls: string, w = s.currentItemStrokeWidth * z) => {
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', pts.length ? 'M' + pts.map(q => this.screen(q).join(',')).join('L') : '')
      p.setAttribute('class', cls)
      p.style.stroke = s.currentItemStrokeColor
      p.style.strokeWidth = String(w)
      return p
    }
    const dot = (q: XY, r: number, cls: string) => {
      const c = document.createElementNS(NS, 'circle'), [x, y] = this.screen(q)
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', String(r))
      c.setAttribute('class', cls)
      return c
    }
    const r = this.route(free), n = this.pts.length
    const kids: SVGElement[] = [path(round(this.pts, this.meta.map(m => m.r)), 'ligne-done'),
      path(r.pts.slice(Math.max(0, n - 1)), 'ligne-trace')]
    const c = this.cursor, ln = c && this.mode === 'line' && this.lane(c)
    if (ln) kids.push(path(round(ln.path.map((_, i) => offsetAt(ln.path, i, 0, ln.d)),
      concentric(ln.path, ln.radii, ln.d)), 'ligne-guide', 1.5), dot(ln.q, 5, 'ligne-snap lane'))
    if (c && n && (this.closing(c) || this.near(c, this.pts[n - 1])))
      kids.push(dot(this.closing(c) ? this.pts[0] : this.pts[n - 1], 8, 'ligne-snap end'))
    else if (c && !n && !ln && this.grab(c)?.kind === 'point') {
      const g = this.grab(c) as Extract<Grab, { kind: 'point' }>
      kids.push(dot(pathOf(g.el)[g.i], 6, 'ligne-snap point'))
    } else if (!ln) {
      const hit = c && this.snapLine(c)
      if (hit) kids.push(dot(hit.q, this.mode === 'station' ? (DOT[this.shape as 'stop']?.d ?? 8) * z / 2
        : hit.end ? 8 : 6, 'ligne-snap' + (hit.end && !n ? ' end' : '')))
    }
    this.layer.replaceChildren(...kids)
  }

  // --- pointer: while drawing a press adds a stop; idle, it is a click or a drag of what it grabbed ---
  private down(e: PointerEvent) {
    if (e.button !== 0 || e.detail > 1) return
    const p = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    if (e.altKey || this.picking) return this.pick(p)
    if (this.pts.length) return this.stop(p, e.shiftKey)
    this.layer.setPointerCapture(e.pointerId)
    this.press = { at: p, grab: this.grab(p), start: this.api.getSceneElements().slice() }
  }

  private move(e: PointerEvent) {
    this.cursor = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    const pr = this.press
    if (pr?.grab && (pr.dragging || dist(pr.at, this.cursor) * this.zoom() > DRAG)) {
      pr.dragging = true
      this.drag(pr.grab, this.cursor, e.shiftKey, 'EVENTUALLY')
    }
    this.draw(e.shiftKey)
  }

  private up(e: PointerEvent) {
    const pr = this.press
    this.press = undefined
    if (!pr) return
    if (pr.dragging) this.drag(pr.grab!, this.scene(e), e.shiftKey, 'IMMEDIATELY')
    else if (this.mode === 'station') this.station(pr.at)
    else this.start(pr.at)
    this.draw()
  }

  /** What a press at p would drag: a station mark, a station label, a waypoint of a line or zone. */
  private grab(p: XY): Grab | undefined {
    const tol = SNAP / this.zoom(), els = this.live()
    const inside = (e: any, pad = 0) =>
      p[0] >= e.x - pad && p[0] <= e.x + e.width + pad && p[1] >= e.y - pad && p[1] <= e.y + e.height + pad
    const group = (m: any) => els.filter(e => e.groupIds?.some((g: string) => m.groupIds?.includes(g)))
    const marks = els.filter(e => e.customData?.ligne?.kind === 'station')
    const mark = marks.find(m => inside(m, tol / 2))
    if (mark) return { kind: 'station', mark, group: group(mark) }
    for (const m of marks) {
      const label = group(m).filter(e => e !== m)
      if (label.some(e => inside(e))) return { kind: 'label', group: label }
    }
    if (this.mode !== 'line') return
    for (const l of this.lines(true)) {
      const i = l.path.findIndex(q => dist(p, q) < tol)
      if (i >= 0) return { kind: 'point', el: l.el, i }
    }
  }

  /** Drags a grab to p, from the scene as it was at the press. */
  private drag(g: Grab, p: XY, free: boolean, capture: string) {
    const start = this.press?.start ?? this.api.getSceneElements(), byId = new Map(start.map(e => [e.id, e]))
    let scene: any[]
    if (g.kind === 'point') {
      // the waypoint leaves any lane it was on; lines on this line's lanes follow it
      const el = byId.get(g.el.id), s = specOf(el), n = s.path.length, ref = s.path[g.i > 0 ? g.i - 1 : 1]
      s.path[g.i] = free || !ref ? p : snap8(ref, p)
      if (s.kind === 'zone' && (g.i === 0 || g.i === n - 1)) s.path[n - 1 - g.i] = s.path[g.i]
      if (s.links) s.links[g.i] = null
      scene = restack(this.convert, replace(start, lineEls(this.convert, s, styleOf(el), el)), el.id)
    } else {
      const m = g.kind === 'station' ? byId.get(g.mark.id) : undefined
      const line = m && this.lines().find(l => l.el.id === m.customData.ligne.line)
      const at: XY = line ? nearest(line.drawn, p).q : p
      // the mark's anchor: a net flag's first point, else the centre
      const d0 = this.press!.at, c: XY = !m ? d0 : m.type === 'line' ? [m.x + m.points[0][0], m.y + m.points[0][1]]
        : [m.x + m.width / 2, m.y + m.height / 2]
      const d: XY = m ? [at[0] - c[0], at[1] - c[1]] : [p[0] - d0[0], p[1] - d0[1]]
      const moved = new Map(g.group.map(e => byId.get(e.id)).map(e => [e.id, bump(e, { x: e.x + d[0], y: e.y + d[1] })]))
      scene = start.map(e => moved.get(e.id) ?? e)
    }
    this.api.updateScene({ elements: scene, captureUpdate: capture })
  }

  /** Alt-click (or the pick button): the clicked line's style becomes ligne's style. */
  private pick(p: XY) {
    const hit = this.snapLine(p, true)
    if (hit) this.api.updateScene({ appState: toState(styleOf(hit.el)) })
    this.picking = false
    this.panelUI()
  }

  /** First stop: on a line's end the line is extended (replaced on finish), on a lane it starts
   *  following that line, on a line it branches. */
  private start(p: XY) {
    const hit = this.snapLine(p), ln = !hit?.end && this.lane(p)
    this.flip = undefined
    if (hit?.end) {
      const s = specOf(hit.el), rev = hit.end === 'start', o = <T>(a: T[]) => rev ? a.slice().reverse() : a
      this.pts = o(s.path); this.meta = o(s.path.map((_, i) => ({ r: s.radii[i], link: s.links?.[i] ?? null })))
      this.editing = { id: hit.el.id, reversed: rev, n: s.path.length }; this.from = s.from; this.r = s.r
      this.panelUI()
    } else if (ln) {
      this.pts = [ln.q]; this.meta = [this.onLane(ln)]
    } else {
      this.pts = [hit?.q ?? p]; this.meta = [{ r: this.r, link: null }]
      this.from = hit?.el.id
      if (hit) {
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
    this.flip = undefined
    if (closing) return this.finish()
    this.draw()
  }

  /** Bend radius r for the stops drawn so far (bar bends nested in another line's), else for the
   *  lines selected when ligne was turned on (lines on their lanes follow). */
  private radius(r: number, capture: string) {
    this.r = Math.max(0, Math.min(60, r))
    const own = (l: Link | null | undefined) => !l || l.t > 0
    for (const m of this.meta) if (own(m.link)) m.r = this.r
    if (!this.pts.length && this.sel.length) {
      let scene = this.api.getSceneElements().slice()
      for (const id of this.sel) {
        const el = scene.find(e => e.id === id)
        if (!el || !isLine(el, true)) continue
        const s = specOf(el)
        s.r = this.r
        s.radii = s.radii.map((v, j) => own(s.links?.[j]) ? this.r : v)
        scene = restack(this.convert, replace(scene, lineEls(this.convert, s, styleOf(el), el)), id)
      }
      this.api.updateScene({ elements: scene, captureUpdate: capture })
    }
    this.draw()
  }

  private undoStop() { this.pts.pop(); this.meta.pop(); this.draw() }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName) || !this.focused()) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (!this.active) {
      if (e.key === 'm') { this.setActive(true); e.preventDefault(); e.stopImmediatePropagation() }
      return
    }
    const k = e.key, act = this.actions[k]
    if (k === 'Escape') this.pts.length ? this.reset() : this.setActive(false)
    else if (k === 'm') this.setActive(false)
    else if (k in SHAPES && this.mode === 'station') { this.shape = SHAPES[k]; this.panelUI() }
    else if (act) act()
    else return
    e.preventDefault(); e.stopImmediatePropagation()
    // a host listening before us (Obsidian's Excalidraw plugin) may still have picked a tool by that key
    if (this.active) setTimeout(() => this.api.setActiveTool({ type: this.held() }))
    this.draw(e.shiftKey)
  }

  /** Key → action; the panel buttons run the same. */
  private actions: Record<string, () => void> = {
    Enter: () => this.finish(), Backspace: () => this.undoStop(),
    f: () => { this.flip = !(this.flip ?? false) },
    s: () => this.setMode(this.mode === 'line' ? 'station' : 'line'),
    b: () => this.toggle('boxed'), o: () => this.toggle('landscape'), '?': () => this.toggle('help'),
    h: () => this.toggle('help'), i: () => this.toggle('picking'), d: () => this.toggle('ticks'),
    t: () => this.toggle('twist'),
    a: () => { this.toggle('arrow'); this.api.setActiveTool({ type: this.held() }) },
    n: () => this.toggle('snap'),
    '[': () => { this.radius(this.r - 4, 'IMMEDIATELY'); this.panelUI() },
    ']': () => { this.radius(this.r + 4, 'IMMEDIATELY'); this.panelUI() },
    g: () => this.copy(), k: () => this.legend(), p: () => this.paper('A5'), P: () => this.paper('A6'),
  }
  private toggle(k: 'boxed' | 'landscape' | 'help' | 'picking' | 'ticks' | 'twist' | 'arrow' | 'free' | 'snap') {
    this[k] = !this[k]
    this.panelUI()
  }

  private setMode(m: typeof this.mode) { this.reset(); this.mode = m; this.panelUI() }
  private reset() {
    this.pts = []; this.meta = []
    this.from = this.editing = this.flip = this.fork = undefined
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
      at: hit?.q ?? p, shape: this.shape, line: hit?.el.id, boxed: this.boxed, font: fontOf(this.api.getAppState()),
      color: hit?.el.strokeColor ?? this.api.getAppState().currentItemStrokeColor,
      text: this.shape === 'net' ? `NET${n}` : `S${n}`, dir: tip.length && tip[1][0] < tip[0][0] ? -1 : 1,
    }))
  }

  /** Commits the drawn stops: a line, or a zone at the back when it ends on its first stop. A line
   *  on lanes of others joins their stack; lines on its own lanes are rebuilt to follow it. */
  private finish() {
    const keep = kept(this.pts)
    let pts = keep.map(i => this.pts[i]), meta = keep.map(i => this.meta[i])
    const closed = pts.length > 3 && same(pts[0], pts[pts.length - 1])
    if (pts.length < 2 || same(pts[0], pts[pts.length - 1]) && !closed) return this.reset()
    const ed = this.editing, base = ed && this.live().find(e => e.id === ed.id)
    // extended at its start: back to its own direction, so lines on its lanes keep their legs
    if (ed?.reversed) { pts = pts.reverse(); meta = meta.reverse() }
    let scene = this.api.getSceneElements().slice()
    const d = base ? dataOf(base)! : undefined
    const of = new Set(meta.map(m => m.link?.of).filter(Boolean) as string[])
    let stack = d?.stack
    for (const id of of) stack ??= dataOf(scene.find(e => e.id === id))?.stack
    if (of.size) {
      stack ??= groupId()
      scene = scene.map(e => of.has(e.id) || of.has(e.customData?.ligne?.of) ? this.join(e, stack!) : e)
    }
    const spec: Spec = { kind: closed ? 'zone' : 'line', path: pts, radii: meta.map(m => m.r),
      links: meta.map(m => m.link), r: this.r, from: this.from, stack,
      twist: d?.twist ?? this.twist, ticks: d?.ticks ?? this.ticks, arrow: d?.arrow ?? this.arrow, own: d?.own }
    const els = lineEls(this.convert, spec, base ? styleOf(base) : fromState(this.api.getAppState()), base)
    if (base) {
      const shift = ed.reversed ? pts.length - ed.n : 0
      if (shift) scene = scene.map(e => this.shiftLinks(e, base.id, shift))
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

  private panelUI() {
    const line = this.mode === 'line', A = this.actions
    const r = document.createElement('label')
    r.className = 'ligne-range'
    r.title = 'bend radius'
    r.title = 'Bend radius: the line being drawn, else the lines selected before M [ [ ] ]'
    const range = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '60', value: String(this.r) })
    const val = Object.assign(document.createElement('span'), { textContent: String(this.r) })
    range.oninput = () => { this.radius(+range.value, 'EVENTUALLY'); val.textContent = range.value }
    range.onchange = () => this.radius(+range.value, 'IMMEDIATELY')
    r.append(range, val)
    const items: Item[] = [
      { icon: 'line', title: 'Lines', key: 'S', on: line, click: () => this.setMode('line') },
      { icon: 'station', title: 'Stations', key: 'S', on: !line, click: () => this.setMode('station') },
      'sep',
      ...(line ? [
        { icon: 'free', title: 'Free legs, 8 directions (or hold Shift)', key: '⇧', on: this.free,
          click: () => this.toggle('free') },
        { icon: 'magnet', title: 'Snap to lines and lanes (hold Ctrl/Cmd: off)', key: 'N', on: this.snap, click: A.n },
        { icon: 'flip', title: 'Flip the leg order', key: 'F', click: A.f }, r,
        { icon: 'arrow', title: 'Arrowheads (Excalidraw\'s arrow style)', key: 'A', on: this.arrow, click: A.a },
        { icon: 'ticks', title: 'Direction ticks', key: 'D', on: this.ticks, click: A.d },
        { icon: 'twist', title: 'Twisted pair (2nd strand: background colour)', key: 'T', on: this.twist, click: A.t },
        'sep' as const,
        { icon: 'finish', title: 'End the line', key: '⏎', click: A.Enter },
        { icon: 'undo', title: 'Undo a stop', key: '⌫', click: A.Backspace },
        { icon: 'cancel', title: 'Cancel the line', key: 'Esc', click: () => this.reset() },
      ] : [
        ...Object.entries(SHAPES).map(([k, v]) => ({ icon: v, title: v[0].toUpperCase() + v.slice(1), key: k,
          on: this.shape === v, click: () => { this.shape = v; this.panelUI() } })),
        { icon: 'boxed', title: 'Labels in a box', key: 'B', on: this.boxed, click: A.b },
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
