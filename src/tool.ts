// The ligne drawing tool: a transparent layer over an Excalidraw canvas. Works on the plain
// Excalidraw API, so the web page and the Obsidian Excalidraw plugin mount the same thing.
//
// Click to place stops; between them the line runs octilinear (one straight + one 45° leg), drawn
// rounded as it will be. Which leg comes first follows the way the pointer leaves the last stop;
// B swaps. Shift: free leg snapped to 8 directions. Click the last stop again (or double-click,
// Enter) to end; end on the first stop to close the shape into a zone, under the lines it crosses.
// Backspace (or Ctrl/Cmd-Z) undoes a stop, Esc cancels (leaves when idle).
// Start on a line to branch off it, on its end to extend it; drag a waypoint to move it.
// Beside a line the pointer snaps to its free lanes (touching parallels): along a lane the new line
// follows that line bend for bend and leaves it where clicked away. Lines sharing lanes form a
// stack (an Excalidraw group); moving a line's waypoint carries the lines on its lanes along.
// Double-click a line to select just it, even inside a stack.
// Colour, width, dash, sloppiness, fill, arrowheads come from Excalidraw's own style panel (ligne
// keeps its line or arrow tool selected meanwhile), remembered for ligne apart from other shapes.
// W makes cables: twisted (round, zigzag), colour checks or a chevron band (git-flow style); flat
// ones (ribbon, FFC) true to size, folded over with B, split at an end, ending in connectors.
// Stops line up with what is drawn (guides), with the grid (G: square, isometric) and with a
// perfboard's holes. S stations, T labels (text, boxes, net labels), X perfboards and parts.
import { STYLES, cableWidth, fanLeg, isSheathed, type Cable, type CableStyle } from './core/cable.ts'
import { BLOCKS, SIZE, nearestPort, outOf, portAt, type BlockKind, type Dock, type Port } from './core/block.ts'
import { COAX, COAX_KINDS, type CoaxKind } from './core/coax.ts'
import { CONNS, CONN_NAMES, FFC_PITCH, GAUGES, SETS, across, endOf, flatTips, isFlat, swatch, wire, wirePitch,
  type Conn } from './core/flat.ts'
import { JOINTS, JOINT_NAMES, jointReach, type JointKind } from './core/joint.ts'
import { beside, carry, concentric, diagFirst, dist, isDiag, kept, lastDir, nearest, octi, octiPoint, offsetAt, simplify,
  pointAt, round, same, snapDir, unit, upright, type Grid, type XY } from './core/geom.ts'
import { dropBend, dropJogs, jog, legNormal, roomBends, roomy, shiftLeg, spliceAlong, tidyAlong, type Along } from './core/edit.ts'
import { bendOf, needs } from './core/lead.ts'
import { METRO, SIGNALS, SIGNAL_NAMES, netColor, ownColors } from './core/palette.ts'
import { graph, middle, toText, type Cap, type Link, type Shape } from './core/graph.ts'
import { align, aligned, isoLines, lattice, type Guide } from './core/guides.ts'
import { clear, edgeOut, type Box } from './core/place.ts'
import { laneAt, type Track } from './core/snap.ts'
import { diagram } from './diagram.ts'
import { PARTS, PART_NAMES, clicks, board, holeAt, part, pinsAt, pinsOf, pitchOf, seat, span,
  type PartKind } from './board.ts'
import { EXTRAS, bodyOf, bodyWidth, cableOf, centre, dataOf, findLine, isLine, layered, lidOf, lineEls, pathOf, radiiOf, relink, replace,
  onLanes, resized, restack, specOf, stale, type Spec } from './lines.ts'
import { DOT, FONTS, LABELS, PAPER, SIZES, block, blockBox, bump, capsule, fromState, groupId, label, legend, paper, station, styleOf, toState,
  turned, type Convert, type Font, type LabelDir, type LabelType, type Style } from './make.ts'
import { Panel, type Btn, type Item, type Menu } from './ui.ts'

export type { Convert }

/** The slice of the Excalidraw imperative API ligne uses. */
export interface Api {
  getAppState(): any
  getSceneElements(): readonly any[]
  updateScene(scene: { elements?: readonly any[], appState?: any, captureUpdate?: any }): void
  onChange(cb: (elements: readonly any[], state: any) => void): () => void
  setActiveTool(tool: { type: string }): void
  getFiles?(): any
}
/** Excalidraw's exportToSvg, from whichever bundle the host ships. */
export type ExportSvg = (o: { elements: readonly any[], appState: any, files: any }) => Promise<SVGSVGElement>

const NS = 'http://www.w3.org/2000/svg'
const SNAP = 10                                   // px on screen: ends, first/last stop, waypoints
const GUIDE = 6                                   // px on screen: onto a guide
const NEAR = 240                                  // px on screen: diagonal guides reach this far
const ON = 6                                      // px on screen: onto a lane
const WIDE = 14                                   // px on screen: onto a lane the leg runs along
const JOG = 10                                    // px on screen: shorter legs are a near miss, dropped
const LEAD = 24                                   // px on screen: the pointer's way out of a stop sets the bend
const DRAG = 4                                    // px on screen before a press is a drag
const DOUBLE = 450                                // ms: presses closer in time and place are a double-click
const SAVED = 'ligne-style', OPTS = 'ligne-opts'
const DEFAULT: Partial<Style> = { strokeWidth: 4, roughness: 0, strokeStyle: 'solid', opacity: 100 }
const SHAPES: Record<string, Shape> = { '1': 'stop', '2': 'interchange', '3': 'commit', '4': 'net' }
type Mode = 'line' | 'station' | 'label' | 'board' | 'block' | 'select'
type GridMode = 'off' | 'square' | 'iso'
const GRIDS: GridMode[] = ['off', 'square', 'iso']
const PREFIX: Record<PartKind, string> = { board: '', R: 'R', C: 'C', D: 'D', LED: 'LED', J: 'J', F: 'J', DIP: 'U', TO92: 'Q',
  module: 'M' }
/** Keys Excalidraw has with Ctrl / Cmd, forwarded to it when the focus is on ligne's own layer. */
const FORWARD = 'zyxcvdag'

const HELP: [string, string][] = [
  ['V / Esc · L · S · T · X · Q', 'select · lines · stations · labels · perfboard · blocks (again: back to lines)'],
  ['click', 'stop · on a line: branch (peels off, trunk style) · on its end: extend (same style)'],
  ['beside a line', 'its free lanes: joins and leaves at 45° in a curve, follows it bend for bend'],
  ['- / =', 'lane gap: set the line a little further out · select mode: the selected lines'],
  ['guides', 'stops line up with waypoints, stations and shapes (dashed) · over a perfboard: its holes'],
  ['G', 'grid: off, square (Excalidraw\'s), isometric (legs at 30°, 90°, 150°)'],
  ['bends', 'the first leg goes the way you leave the stop · B swaps'],
  ['Ctrl / Cmd held · N', 'no snapping: place anywhere'],
  ['[ / ] · slider', 'bend radius (0: sharp), shown as you draw; idle: the selected lines'],
  ['click last stop', 'end the line (also double-click, Enter)'],
  ['click first stop', 'close into a zone, under the lines it crosses'],
  ['drag', 'waypoint (both legs stay on the grid) · a leg: sideways (⇧: a jog) · cable leg tip · station · label'],
  ['double-click a bend', 'take it out (when a straight leg fits) · a leg pushed flush also drops its bends'],
  ['select mode', 'a line not selected: drag edits it, click selects just it · a selected one: Excalidraw moves it'],
  ['double-click a line', 'select just it, even in a stack'],
  ['Shift / ⇧ button', 'free leg, along the grid\'s directions'],
  ['Backspace / Ctrl-Z · Esc', 'undo a stop · cancel'], ['Alt-click / I', "take a line's style"],
  ['W · ⇧W', 'body on/off · round, zigzag, checks (2nd colour: Excalidraw background), ribbon, FFC, jacket, chevron'],
  ['twisted', 'popover: fan out at the start / end / both, spread and length (strands end side by side)'],
  ['jacket', 'round sheathed cable true to size: wires inside, shield, ends stripped, in a housing or a plug'],
  ['J', 'join: start on a line\'s end (a ribbon\'s wire, a jacket\'s next wire): the new line goes on from it, under a heat-shrink, boot or splice'],
  ['coax', '1.13 mm to LMR-400 true to size · stripped, SMA / RP-SMA plug or jack, U.FL, MMCX, N, F, BNC'],
  ['ribbon / FFC', 'true size × scale · wire colours in the popover · E gauge / pitch'],
  ['B · ⇧B (flat)', 'fold at the next corner: turns over, the back shows · bend the other way'],
  ['C', 'connector: Dupont F / M, JST PH, SH, MX, ZIF, USB-C / A / micro-B, barrel, 3.5 mm, RJ45 · over an end: it'],
  ['popover', 'edits the selected lines if any ("For"), else sets up the next line'],
  ['flat cable end', 'click a wire: a bundle of it goes on (click another: up to it; all: the cable) · ⇧-click: the cable'],
  ['', 'drag a wire: fan it out · click a fanned wire: a plain line goes on from it'],
  ['⇧T', 'the label tool, "along": click a line, its text repeats along it'],
  ['A / D', 'arrowheads · direction chevrons (the way it was drawn)'],
  ['colours popover', 'metro and signal colours (selected lines take them) · by net name · next colour per line'],
  ['ends popover', 'each end: bar, open dot, disc · casing: paper-coloured band under the line, gaps at crossings'],
  ['style', "Excalidraw's panel: colour, width, dash, arrowheads"],
  ['S · 1–4 · B', 'stations: stop, interchange, commit, net flag · labels in a box'],
  ['interchange', 'click a stack: a capsule across all its lines, at its angle · drag from line to line: one between them'],
  ['T · 1–7 · B · F', 'labels: text, box, rounded, net label, flag, along the line, pill · on a line / beside it · solid'],
  ['beside a line', 'labels and station names: pointer\'s side, off the stack\'s edge, clear of others · level / along / across'],
  ['Q · 1–9, 0', 'blocks: process, decision, terminator, data, document, database, folder, table, text, icon · lines dock on their sides and follow them'],
  ['X · 1–9, 0', 'perfboard (drag its size), R, C, diode, LED, pin header, socket, DIP, TO-92, module: click holes'],
  ['R / ⇧R', 'select mode: turn the selection 90° / 45° (parts about pin 1)'],
  ['Y', 'tidy the selected lines (else all): even bends, tiny jogs out, room for arcs, connectors and joints · Enter keeps, Esc drops'],
  ['K', 'legend (again: rebuild)'], ['P / ⇧P · O', 'A5 / A6 sheet · landscape'],
  ['⇧C', 'copy the selection (else all) as SVG'], ['M', 'ligne on / off'], ['?', 'this help'],
]

/** A stop: its bend radius, on another line's lane where, whether a flat cable folds there. */
interface Meta { r: number, link: Link | null, fold?: boolean }
/** A lane beside a line: that line, where along it, the offset, the snapped point. */
interface Lane { el: any, path: XY[], radii: number[], i: number, t: number, d: number, q: XY }
/** A ligne line in the scene: element, waypoints, radii, rounded centre line, body width. */
interface Ln { el: any, path: XY[], radii: number[], drawn: XY[], width: number }

/** Whether leg i of path is a "straight" one of the grid (see isDiag). */
const straight = (path: XY[], i: number, grid: Grid = 'octi') => {
  const a = path[Math.min(i, path.length - 2)], b = path[Math.min(i, path.length - 2) + 1]
  return !isDiag([b[0] - a[0], b[1] - a[1]], grid)
}
/** A line's style for Excalidraw's panel: a flat cable's fill and outline width are its own. */
const lookOf = (e: any): Partial<Style> => {
  const { backgroundColor, fillStyle, strokeWidth, ...st } = styleOf(e)
  return isFlat(cableOf(e)) ? st : styleOf(e)
}
const groupOf = (els: readonly any[], m: any) => els.filter(e => e.groupIds?.some((g: string) => m.groupIds?.includes(g)))

type Grab =
  | { kind: 'station', mark: any, group: any[] }
  | { kind: 'label', group: any[] }
  | { kind: 'tag', group: any[], line?: any }
  | { kind: 'point', el: any, i: number }
  | { kind: 'leg', el: any, end: 'start' | 'end', j: number }
  | { kind: 'seg', el: any, k: number, at: XY, jog: boolean }

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
  ends: { start: Cap, end: Cap } = { start: 'none', end: 'none' }
  casing = 0                                       // px of paper colour either side, under the line
  byNet = true                                     // a net label or flag on a line colours it by its name
  nextColor = false                                // each new line takes the next metro colour
  joinMode = false                                 // J: a line started on a line's end goes on from it, under a sleeve
  jointKind: JointKind = 'shrink'
  private joining?: { el: any, end: 'start' | 'end' } // the line being drawn goes on from this end
  private tidying?: { n: number, before: XY[][] }   // a tidy shown, not yet kept: what it changed
  cable: Cable = { style: 'checks', n: 2, pitch: 16 }
  free = false                                     // sticky Shift
  snap = true                                      // onto lines and lanes; Ctrl/Cmd held: off
  bend = false                                     // B: the other leg first
  flip = false                                     // flat cables: fold at the next corner
  private mod = false
  picking = false                                  // next click takes a line's style
  r = 24
  spread = 0                                       // lane gap beyond touching
  gridMode: GridMode = 'off'
  labelType: LabelType = 'text'
  labelDir: LabelDir = 'along'                     // labels and station names: level, along the line, across it
  blockKind: BlockKind = 'process'
  private dockStart?: Dock                         // the line being drawn left this block's port
  private blockBoxes = new Map<string, string>()   // block id → its box last seen, to move docked line ends
  solid = false                                    // labels: filled with the colour
  font: keyof typeof FONTS = 'mono'
  size = 16
  partKind: PartKind = 'board'
  scale = 2                                        // perfboard: true size ×
  private pin?: XY                                 // a part's first hole
  private guides: Guide[] = []                     // shown with the pointer
  private refCache?: { els: readonly any[], pts: XY[] }
  private pts: XY[] = []
  private meta: Meta[] = []
  private cursor?: XY
  private lead?: boolean                           // the pointer left the last stop diagonally
  private track?: Track                            // the lane being followed
  private from?: string
  private editing?: { id: string, reversed: boolean, n: number }
  private fork?: { u: XY, back: number, fwd: number } // branching: the trunk's leg at the first stop
  private split?: { el: any, end: 'start' | 'end', q0: number, q1: number, pick?: number[] } // wires by position
  private startBack = false                        // extending a cable at its start that starts back up
  private press?: { at: XY, grab?: Grab, dragging?: boolean, start: any[], refs?: XY[] }
  private outside?: Partial<Style>                 // Excalidraw's style while ligne is active
  private tool = ''
  private looks = new Map<string, string>()         // line id → its style last seen
  private cache?: { els: readonly any[], lines: Ln[] }
  readonly layer: SVGSVGElement
  private panel: Panel
  private input?: HTMLInputElement
  private menu?: string                            // the panel's open popover
  private drawn: Mode = 'line'                     // the mode before select
  private ended?: { t: number, at: XY }            // when and where (on screen) a click last ended a line
  private off: (() => void)[] = []

  /** `focused`: whether keys are for this canvas (several may be open, e.g. Obsidian panes). */
  constructor(readonly api: Api, private host: HTMLElement, private convert: Convert,
    private focused: () => boolean = () => true, private exportSvg?: ExportSvg) {
    host.style.position ||= 'relative'
    this.layer = document.createElementNS(NS, 'svg')
    this.layer.classList.add('ligne-layer')
    this.layer.style.pointerEvents = 'none'          // until on: Excalidraw gets every press
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
    // select mode: a line not selected is edited by dragging it, not moved with its group
    on(host, 'pointerdown', e => this.selectDown(e))
    // select mode, double-click on a line: a bend goes, else just the line is selected (Excalidraw's
    // own line editor would leave ligne's waypoints behind)
    on(host, 'dblclick', e => {
      if (!this.active || this.mode !== 'select' || !(e.target instanceof HTMLCanvasElement)) return
      const p = this.scene(e), l = this.lineAt(p)
      if (!l && !this.editGrab(p)) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (!this.dropAt(p) && l) this.select(l.el)
    })
    // Excalidraw's own double-click into a stack: select the line nearest the pointer, not the top one
    on(host, 'dblclick', e => { if (!this.active || this.mode === 'select') setTimeout(() => this.refine(this.scene(e))) },
      false)
    this.off.push(api.onChange((_, s) => this.changed(s)))
    this.follow()                                   // learns the line styles
    this.changed(api.getAppState())                 // relinks a drawing made before lids
    this.setActive(false)
  }

  destroy() {
    this.setActive(false); this.off.forEach(f => f()); this.layer.remove(); this.panel.destroy(); this.input?.remove()
  }

  /** The Excalidraw tool held while active: its style panel is ligne's. */
  private held() { return this.mode === 'select' ? 'selection' : this.arrow ? 'arrow' : 'line' }
  /** The leg directions lines are drawn in. */
  private gridDirs(): Grid { return this.gridMode === 'iso' ? 'iso' : 'octi' }
  private labelFont(): Font { return { fontFamily: FONTS[this.font], fontSize: this.size } }

  /** On: ligne's remembered style goes into Excalidraw's style panel; off: Excalidraw's comes back. */
  setActive(on: boolean) {
    if (on === this.active) return this.panelUI()
    this.active = on
    this.menu = undefined
    this.layer.style.pointerEvents = on && this.mode !== 'select' ? 'all' : 'none'
    const s = this.api.getAppState()
    if (on) {
      this.outside = fromState(s)
      // Excalidraw's own smart guides for its shapes while ligne is on
      this.snapWas = !!s.objectsSnapModeEnabled
      this.api.updateScene({ appState: { objectsSnapModeEnabled: true } })
      const first = this.live().find(e => e.id === this.selLines()[0])
      if (first) this.r = dataOf(first)!.r
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') ?? DEFAULT
      this.api.updateScene({ appState: toState(saved) })
      this.api.setActiveTool({ type: this.held() })
      this.container()?.focus({ preventScroll: true })
    } else {
      this.reset()
      if (this.outside) {
        localStorage.setItem(SAVED, JSON.stringify(fromState(s)))
        this.api.updateScene({ appState: { ...toState(this.outside), objectsSnapModeEnabled: this.snapWas } })
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
    this.followBlocks()
    // parts are put back on their holes once Excalidraw is done moving or turning them
    const busy = (st: any) => st.selectedElementsAreBeingDragged || st.isRotating || st.isResizing
    const fix = (els: readonly any[]) => resized(els) ?? relink(els) ?? (busy(this.api.getAppState()) ? undefined : seat(els))
    if (fix(this.api.getSceneElements())) setTimeout(() => {
      const els = fix(this.api.getSceneElements())
      if (els) this.put(els, 'NEVER')
    })
    // a scene update may drop the focus (to the body): take it back, else Excalidraw hears no keys
    if (this.active) setTimeout(() => {
      if (this.focused() && !this.input && document.activeElement === document.body)
        this.container()?.focus({ preventScroll: true })
    })
    const t = s.activeTool?.type
    if (this.active && this.tool === this.held() && t !== this.held()) this.setActive(false)
    // the popover says what it edits: kept in step with the selection
    const picked = Object.keys(s.selectedElementIds ?? {}).join()
    if (this.active && picked !== this.picked) { this.picked = picked; if (this.menu) this.panelUI() }
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
      this.put(scene, 'NEVER')
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

  /** The scene becomes els. Elements changed from what is on the canvas get a version past it (a
   *  drag rebuilds every frame from the scene at the press: same versions, so Excalidraw's history
   *  saw no change and undo took back the step before); elements left out stay, deleted. */
  private put(els: readonly any[], capture: string) {
    // Excalidraw 0.18 leaves elements with uncommitted (EVENTUALLY) changes out of an IMMEDIATELY
    // capture: the scene from before them goes back quietly first, then the end state is one step
    let now = this.api.getSceneElements()
    if (capture === 'EVENTUALLY') this.base ??= now
    else if (this.base) {
      if (capture === 'IMMEDIATELY') this.api.updateScene({ elements: this.base, captureUpdate: 'NEVER' })
      now = this.api.getSceneElements()
      this.base = undefined
    }
    const byId = new Map(now.map(e => [e.id, e])), seen = new Set<string>()
    const out = els.map(e => {
      seen.add(e.id)
      const c = byId.get(e.id)
      return c && c !== e && e.version <= c.version
        ? { ...e, version: c.version + 1, versionNonce: Math.random() * 2 ** 31 | 0, updated: Date.now() } : e
    })
    for (const c of now) if (!seen.has(c.id) && !c.isDeleted) out.push(bump(c, { isDeleted: true }))
    this.api.updateScene({ elements: out, captureUpdate: capture })
  }

  /** ligne lines (and zones) in the scene, bar those edited outside ligne. Cached per scene. */
  private lines(zones = false): Ln[] {
    const els = this.api.getSceneElements()
    if (this.cache?.els !== els) this.cache = { els, lines: els.filter(e => isLine(e, true) && !stale(e)).map(e =>
      ({ el: e, path: pathOf(e), radii: radiiOf(e), drawn: centre(e), width: bodyWidth(e) })) }
    return zones ? this.cache.lines : this.cache.lines.filter(l => isLine(l.el))
  }

  private snapping() { return this.snap && !this.mod }

  /** Points stops line up with: ligne waypoints, stations, the middles of other shapes (not the
   *  holes and parts of perfboards, nor ligne's extras). Cached per scene. */
  private refs(): XY[] {
    const els = this.api.getSceneElements()
    if (this.refCache?.els === els) return this.refCache.pts
    // perfboards and parts: their holes and pins are snapped to by holeAt
    const boards = new Set(els.filter(e => ['board', 'part'].includes(e.customData?.ligne?.kind)).map(e => e.groupIds?.[0]))
    const pts: XY[] = []
    for (const e of els) {
      const k = e.customData?.ligne?.kind
      if (e.isDeleted || boards.has(e.groupIds?.[0]) || e.containerId) continue
      if (isLine(e, true) && !stale(e)) pts.push(...pathOf(e))
      else if (k === 'station' && e.type !== 'line') pts.push([e.x + e.width / 2, e.y + e.height / 2])
      else if (!k && e.type !== 'text' && e.type !== 'freedraw')
        pts.push(...(e.points && !e.angle ? e.points.map((q: XY) => [q[0] + e.x, q[1] + e.y] as XY)
          : [[e.x + e.width / 2, e.y + e.height / 2] as XY]))
    }
    this.refCache = { els, pts }
    return pts
  }

  /** Where a free stop at c goes: a perfboard's hole under it, else the grid's lattice point, else
   *  lined up with what is drawn (guides). */
  private placed(c: XY, refs?: XY[]): { q: XY, guides: Guide[] } {
    if (!this.snapping()) return { q: c, guides: [] }
    const hole = holeAt(this.live(), c)
    if (hole) return { q: hole.q, guides: [] }
    if (this.gridMode !== 'off') return { q: lattice(c, this.gridMode, this.gridSize()), guides: [] }
    return align(c, refs ?? [...this.refs(), ...this.pts.slice(0, -1)], GUIDE / this.zoom(), this.gridDirs(), NEAR / this.zoom())
  }
  private gridSize() { return this.api.getAppState().gridSize || 20 }

  /** G: grid off, square (Excalidraw's own, shown by it), isometric (shown by ligne). */
  private setGrid(g: GridMode) {
    this.gridMode = g
    this.api.updateScene({ appState: { gridModeEnabled: g === 'square' } })
    this.save()
    this.panelUI()
  }
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
    const me = { width: this.width(), cable: this.twist, extra: this.spread }
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
    const z = this.zoom(), inDir = lastDir(this.pts), prev = this.meta[n - 1].link, g = this.gridDirs()
    const closing = this.closing(c), hit = closing ? undefined : this.snapLine(c)
    // the way the leg would run, for lanes along it
    const rough = octi(last, c, this.order(last, c, prev), undefined, g), dir = unit([rough.at(-1)![0] - rough.at(-2)![0],
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
      const port = closing || ln || hit ? undefined : this.portAt(c)
      const spot = closing || ln || hit || port ? undefined : this.placed(c)
      this.guides = spot?.guides ?? []
      // into a block's port: square to its side, after a short stub
      const o = port && outOf(port.port), stub = this.stub()
      const pre: XY | undefined = port && [port.at[0] + o![0] * stub, port.at[1] + o![1] * stub]
      const to = closing ? this.pts[0] : ln?.q ?? hit?.q ?? pre ?? spot!.q, diag = this.order(last, to, prev, ln)
      legs = free ? [last, snapDir(last, to, g)] : octi(last, to, diag, undefined, g)
      if (port) legs = [...legs, port.at]
      // never double straight back on the incoming leg
      const first = legs.length === 3 && unit([legs[1][0] - last[0], legs[1][1] - last[1]])
      if (!free && inDir && first && first[0] * inDir[0] + first[1] * inDir[1] < -0.5) legs = octi(last, to, !diag, undefined, g)
      // a near miss: a leg too short to see is a jog off the flow, so the stop lines up instead
      const short = legs.length === 3 && Math.min(dist(legs[0], legs[1]), dist(legs[1], legs[2])) * z < JOG
      if (!free && spot?.q === c && short) legs = [last, snapDir(last, c, g)]
      legs = legs.slice(1)
      meta = legs.map((_, i) => i === legs.length - 1 && ln && !free ? this.onLane(ln) : { r: this.r, link: null })
    }
    const all = [...this.meta, ...meta]
    if (this.flip && this.flat()) {
      // the first corner of the leg being drawn: its own bend, else the last stop
      const i = legs.length > 1 ? n : n - 1, fold = !all[i].fold
      all[i] = { ...all[i], fold, r: fold ? 0 : this.r }
    }
    return { pts: [...this.pts, ...legs], meta: all }
  }

  /** Whether a flat cable (ribbon, FFC) is being drawn. */
  private flat() { return this.twist && isFlat(this.cable) }

  /** Stops moved so that a cable's fittings get a straight run at the drawn start (and, `end`, at
   *  the end): the bend next to a short end leg slides back along it. Bends on lanes or folds stay. */
  private room(pts: XY[], meta: Meta[], end: boolean): { pts: XY[], short: [number, number] } {
    const c = this.twist ? this.cable : undefined
    if (!c?.conn || pts.length < 3) return { pts, short: [0, 0] }
    // drawn from a line's start (extending it there): its ends swap
    const rev = this.editing?.reversed, cc = rev ? { ...c, conn: { start: c.conn.end, end: c.conn.start } } : c
    const [n0, n1] = needs(pts, meta.map(m => m.r), cc)
    return roomy(pts, n0, end ? n1 : 0, i => !!meta[i]?.link || !!meta[i]?.fold)
  }

  /** Whether the leg from `last` to `to` starts with its 45° leg: the way the pointer left the
   *  stop; else off a lane at 45° to it (it peels off), onto one with the 45° leg last (it curves
   *  on), or the order turning least. B swaps. */
  private order(last: XY, to: XY, prev: Link | null, ln?: Lane) {
    const away = prev && findLine(this.live(), prev.of), g = this.gridDirs()
    const auto = this.lead ?? (away ? straight(pathOf(away), prev.i, g) : ln ? !straight(ln.path, ln.i, g)
      : diagFirst(last, to, lastDir(this.pts), g))
    return auto !== this.bend
  }

  /** First leg of a branch: it starts back along the trunk by up to a bend radius, so the bend at
   *  the fork rounds off the trunk; it leaves towards the pointer's side of the trunk. */
  private branch(c: XY, free: boolean): { pts: XY[], meta: Meta[] } {
    const j = this.pts[0], { u, back, fwd } = this.fork!
    const ahead = (c[0] - j[0]) * u[0] + (c[1] - j[1]) * u[1] >= 0, s = ahead ? 1 : -1
    const dir: XY = [u[0] * s, u[1] * s], b = Math.min(this.r, ahead ? back : fwd)
    const tail: XY = [j[0] - dir[0] * b, j[1] - dir[1] * b]
    const to = this.snapLine(c)?.q ?? this.placed(c).q, g = this.gridDirs()
    // it leaves at the fork: first the leg at 45° to the trunk (B swaps)
    const legs = (free ? [j, snapDir(j, to, g)] : octi(j, to, straight([[0, 0], u], 0, g) !== this.bend, undefined, g))
      .slice(1)
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
    if (isFlat(c)) {
      const t = flatTips(path, c)
      return (['start', 'end'] as const).flatMap(end => t[end].map((at, j) => ({ end, j, at })))
    }
    const tip = (end: 'start' | 'end', j: number): XY => {
      const at = end === 'start' ? path[0] : path[path.length - 1], to = c.legs?.[end]?.[j] ?? fanLeg(c, drawn, end, j)
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
    if (this.gridMode === 'iso') {
      // the isometric lattice, faint, over the view (not when too dense to read)
      const size = this.gridSize(), x0 = -s.scrollX, y0 = -s.scrollY
      if (size * z >= 8) kids.push(...isoLines([x0, y0, x0 + s.width / z, y0 + s.height / z], size)
        .map(([a, b]) => path([a, b], 'ligne-iso', 1, '#adb5bd')))
    }
    if (!this.press?.dragging) this.guides = []
    if (this.mode === 'line') {
      // the line as it will be: rounded, cable wide, the leg to the pointer included
      const r = this.route(free), rm = this.room(r.pts, r.meta, true)
      kids.push(path(round(rm.pts, r.meta.map(m => m.r)), 'ligne-live', this.width() * z))
      // an end leg still too short for its connector
      for (const [k, a, b] of [[0, 0, 1], [1, rm.pts.length - 1, rm.pts.length - 2]] as const)
        if (rm.short[k] > 0.5) kids.push(path([rm.pts[a], rm.pts[b]], 'ligne-short', 2, '#e03131'))
      r.pts = rm.pts
      // bends that line up with what is drawn
      if (n) for (let i = n; i < r.pts.length - 1; i++)
        this.guides.push(...aligned(r.pts[i], this.refs(), 0.75 / z, this.gridDirs(), NEAR / z))
      kids.push(...r.pts.flatMap((q, i) => i < n || r.meta[i].fold
        ? [dot(q, r.meta[i].fold ? 4 : 2.5, 'ligne-stop' + (r.meta[i].fold ? ' fold' : ''))] : []))
    }
    const ln = c && n && this.mode === 'line' ? this.lane(c) : undefined
    if (ln) kids.push(path(round(ln.path.map((_, i) => offsetAt(ln.path, i, 0, ln.d)),
      concentric(ln.path, ln.radii, ln.d)), 'ligne-guide', 1.5), dot(ln.q, 5, 'ligne-snap lane'))
    const g = c && !n ? this.grab(c) : undefined
    const jn = c && !n && this.mode === 'line' && this.joinMode ? this.joinAt(c) : undefined
    const port = c && this.mode === 'line' && !jn && !this.snapLine(c) ? this.portAt(c) : undefined
    if (port) kids.push(dot(port.at, 6, 'ligne-snap end'))
    if (jn) kids.push(dot(jn.at, 6, 'ligne-snap end'))
    else if (c && n && (this.closing(c) || this.near(c, this.pts[n - 1])))
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
      if (!cableOf(l.el) || ['chevron', 'jacket', 'coax'].includes(cableOf(l.el)!.style) || nearest(l.drawn, c).d > 60 / z) continue
      for (const t of this.tips(l.el)) kids.push(dot(t.at, 4, 'ligne-snap tip' + (g?.kind === 'leg'
        && g.el === l.el && g.end === t.end && g.j === t.j ? ' end' : '')))
    }
    if (c && !n && this.mode === 'line' && !this.press && !this.lineAt(c) && !this.snapLine(c)) {
      const at = this.placed(c)
      this.guides = at.guides
      if (at.q !== c) kids.push(dot(at.q, 3.5, 'ligne-snap'))
    }
    if (this.mode === 'board' && c) kids.push(...this.boardPreview(c, path, dot))
    // a tidy on show: the lines as they were, dashed
    for (const b of this.tidying?.before ?? []) kids.push(path(b, 'ligne-short', 1.5, '#e03131'))
    const pr = this.press
    if (this.mode === 'station' && this.shape === 'interchange' && pr && !pr.grab && c && dist(pr.at, c) * z > DRAG * 3) {
      const a = this.snapLine(pr.at)?.q ?? pr.at, b = snapDir(a, this.snapLine(c)?.q ?? c, this.gridDirs())
      kids.push(path(capsule(a, b, Math.max(16, 4 * 2.5) / 2), 'ligne-live', 2, '#1e1e1e'))
    }
    for (const [a, b] of this.guides) {
      // past both ends a little, the reference point crossed
      const u = unit([b[0] - a[0], b[1] - a[1]]), e = 12 / z
      kids.push(path([[a[0] - u[0] * e, a[1] - u[1] * e], [b[0] + u[0] * e, b[1] + u[1] * e]], 'ligne-align', 1, '#e64980'))
      const k = 3 / z
      kids.push(path([[a[0] - k, a[1] - k], [a[0] + k, a[1] + k]], 'ligne-align x', 1.5, '#e64980'),
        path([[a[0] - k, a[1] + k], [a[0] + k, a[1] - k]], 'ligne-align x', 1.5, '#e64980'))
    }
    // what a click does here, by the pointer
    const hint = c && this.press?.dragging !== true ? this.intent(c) : undefined
    if (hint) {
      const t = document.createElementNS(NS, 'text'), [x, y] = this.screen(c!)
      t.setAttribute('x', String(x + 14)); t.setAttribute('y', String(y + 24)); t.setAttribute('class', 'ligne-hint')
      t.textContent = hint
      kids.push(t)
    }
    this.layer.replaceChildren(...kids)
  }

  /** Perfboard mode: the board being dragged out (its size), or the part from its first hole to
   *  the hole under the pointer. */
  private boardPreview(c: XY, path: (pts: XY[], cls: string, w?: number, color?: string) => SVGElement,
    dot: (q: XY, r: number, cls: string) => SVGElement): SVGElement[] {
    const P = pitchOf(this.scale), z = this.zoom(), out: SVGElement[] = []
    const hole = holeAt(this.live(), c)?.q
    if (this.partKind === 'board') {
      if (!this.press) return out
      const b = span(this.press.at, c, P), [x, y] = b.at, w = (b.cols - 1) * P, h = (b.rows - 1) * P, m = P * 0.9
      out.push(path([[x - m, y - m], [x + w + m, y - m], [x + w + m, y + h + m], [x - m, y + h + m], [x - m, y - m]],
        'ligne-board', 1.5, '#b9a77a'))
      this.hintText = `${b.cols} × ${b.rows} holes · ${(b.cols * 2.54).toFixed(1)} × ${(b.rows * 2.54).toFixed(1)} mm`
      return out
    }
    const P2 = holeAt(this.live(), c)?.board.customData.ligne.pitch ?? P
    if (this.pin) {
      const pins = pinsOf(this.partKind, this.pin, hole ?? c, P2)
      out.push(path(this.partKind === 'module' ? [pins[0], [pins[1][0], pins[0][1]], pins[1], [pins[0][0], pins[1][1]],
        pins[0]] : pins, 'ligne-board', 2, '#1971c2'))
      out.push(...pins.map(q => dot(q, 3.5, 'ligne-snap')))
      if (['J', 'F', 'DIP'].includes(this.partKind)) this.hintText = `${pins.length} pins`
    } else if (hole) out.push(dot(hole, Math.max(3, P2 * z * 0.25), 'ligne-snap'))
    return out
  }
  private hintText?: string
  private picked = ''                              // the selection last seen
  private base?: readonly any[]                    // the scene before uncommitted (EVENTUALLY) updates
  private snapWas = false

  /** What a click at p would do, in a few words. */
  private intent(p: XY): string | undefined {
    if (this.mode === 'board') {
      const t = this.hintText
      this.hintText = undefined
      if (t) return t
      const name = PART_NAMES[this.partKind]
      if (this.partKind === 'board') return 'drag: a perfboard · click: 30 × 20'
      return this.pin ? `click: ${name}, last ${this.partKind === 'DIP' ? 'pin of the row' : 'hole'}`
        : `${name}: click ${clicks(this.partKind) === 1 ? 'its middle hole' : 'its first hole'}`
    }
    if (this.mode === 'label') return this.lineAt(p) ? `${this.labelType} label on the line` : `${this.labelType} label`
    if (this.mode === 'station') return this.snapLine(p)?.el ? 'station on the line' : 'station'
    if (this.mode === 'block') return `${this.blockKind}: click, or drag its box`
    if (this.mode !== 'line') return
    if (this.pts.length) {
      const sp = this.split, t = sp && this.pts.length === 2 && this.wireAt(p)
      if (t && t.el.id === sp!.el.id && t.end === sp!.end) return `bundle up to wire ${t.j + 1}`
      if (this.closing(p)) return 'close: zone'
      if (!this.snapLine(p) && this.portAt(p)) return 'into the block, square to its side'
      if (this.near(p, this.pts[this.pts.length - 1])) return 'end the line'
      return
    }
    const jn = this.joinMode && this.joinAt(p)
    if (jn) return `join: a line goes on from here, under a ${JOINT_NAMES[this.jointKind]}`
    const g = this.grab(p)
    if (g?.kind === 'point') return 'drag: move the bend · double-click: take it out'
    if (g && g.kind !== 'leg' && g.kind !== 'seg') return 'drag: move'
    if (this.legAt(p)) return 'click: the wire goes on · drag: move'
    const w = this.wireAt(p)
    if (w) return `click: wire ${w.j + 1} goes on (⇧: the cable) · drag: fan out`
    const hit = this.snapLine(p)
    if (hit?.end) return 'extend'
    if (this.lane(p)) return 'beside it'
    if (hit?.el) return 'click: branch · drag: move the leg (⇧: jog)'
    if (this.portAt(p)) return 'from the block, square to its side'
    return 'new line'
  }

  // --- pointer: while drawing a press adds a stop; idle, it is a click or a drag of what it grabbed ---
  private down(e: PointerEvent) {
    // keys go to Excalidraw's container, so its undo, delete, copy keep working
    this.container()?.focus({ preventScroll: true })
    if (this.menu) return this.openMenu()
    if (this.tidying) this.tidyEnd(true)
    if (e.button !== 0) return
    // the second press of a double-click whose first ended a line (pointer events carry no click count)
    if (this.justEnded(e)) return
    const p = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    if (e.altKey || this.picking) return this.pick(p)
    if (this.pts.length) {
      // a line ended by this press (not a stop just started): its double-click is not one on the canvas
      const had = this.pts.length
      this.stop(p, e.shiftKey)
      if (!this.pts.length && had > 1) this.ended = { t: performance.now(), at: [e.clientX, e.clientY] }
      return
    }
    this.layer.setPointerCapture(e.pointerId)
    this.press = { at: p, grab: this.grab(p, e.shiftKey), start: this.api.getSceneElements().slice() }
  }

  private move(e: PointerEvent) {
    const c = this.cursor = this.scene(e)
    this.mod = e.ctrlKey || e.metaKey
    // the way the pointer leaves the last stop picks the leg order; back at the stop, it picks again
    const last = this.pts[this.pts.length - 1], z = this.zoom()
    if (last && dist(c, last) * z < LEAD / 3) this.lead = undefined
    else if (last && this.lead === undefined && dist(c, last) * z > LEAD) this.lead = isDiag([c[0] - last[0], c[1] - last[1]], this.gridDirs())
    const pr = this.press
    if (pr?.grab && (pr.dragging || dist(pr.at, c) * z > DRAG)) {
      pr.dragging = true
      this.drag(pr.grab, c, e.shiftKey, 'EVENTUALLY')
    }
    this.draw(e.shiftKey)
  }

  private up(e: PointerEvent) {
    const pr = this.press
    if (!pr) return
    // the drag's last step still reads the press (refs it lined up with)
    if (pr.dragging) this.drag(pr.grab!, this.scene(e), e.shiftKey, 'IMMEDIATELY')
    this.press = undefined
    if (pr.dragging) return this.draw()
    const to = this.scene(e)
    if (this.mode === 'station' && this.shape === 'interchange' && dist(pr.at, to) * this.zoom() > DRAG * 3)
      this.interchange(pr.at, to)
    else if (this.mode === 'station') this.station(pr.at)
    else if (this.mode === 'label') this.label(pr.at)
    else if (this.mode === 'board') this.placePart(pr.at, this.scene(e))
    else if (this.mode === 'block') this.placeBlock(pr.at, this.scene(e))
    else this.start(pr.at, e.shiftKey)
    this.draw()
  }

  /** Double-click: ends the line being drawn; on a line just started (a click of the double-click),
   *  selects the line under the pointer instead. */
  private dbl(e: MouseEvent) {
    if (this.justEnded(e)) return
    const fresh = this.editing ? this.pts.length === this.editing.n : this.pts.length <= 1
    if (!fresh) return this.finish()
    this.reset()
    if (this.dropAt(this.scene(e))) return
    const l = this.lineAt(this.scene(e))
    if (l) this.select(l.el)
  }

  /** Whether e is a second click where a click just ended a line. */
  private justEnded(e: MouseEvent) {
    const end = this.ended
    return !!end && performance.now() - end.t < DOUBLE && dist(end.at, [e.clientX, e.clientY]) < DRAG
  }

  /** Selects line el alone, inside its groups, as the lines ligne's radius and cable act on. */
  private select(el: any) {
    const s = specOf(el)
    this.api.updateScene({ appState: { selectedElementIds: { [el.id]: true }, selectedGroupIds: {},
      editingGroupId: s.own ?? s.stack ?? null } })
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
  private grab(p: XY, shift = false): Grab | undefined {
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
    const tip = this.lines().filter(l => cableOf(l.el) && !['ffc', 'chevron', 'jacket', 'coax'].includes(cableOf(l.el)!.style))
      .flatMap(l => this.tips(l.el).map(t => ({ ...t, el: l.el })))
      .map(t => ({ t, d: dist(p, t.at) })).sort((a, b) => a.d - b.d)[0]
    if (tip && tip.d < tol * 0.6) return { kind: 'leg', el: tip.t.el, end: tip.t.end, j: tip.t.j }
    return this.editGrab(p, shift)
  }

  /** A waypoint of a line at p, else one of its legs (⇧: to put a jog in). */
  private editGrab(p: XY, shift = false): Grab | undefined {
    const tol = SNAP / this.zoom()
    for (const l of this.lines(true)) {
      const i = l.path.findIndex(q => dist(p, q) < tol)
      if (i >= 0) return { kind: 'point', el: l.el, i }
    }
    const l = this.lineAt(p)
    if (!l) return
    const k = Math.min(nearest(l.path, p).i, l.path.length - 2), q = nearest(l.path.slice(k, k + 2), p).q
    return { kind: 'seg', el: l.el, k, at: q, jog: shift }
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
        // lined up with what is drawn, the line's own other waypoints included
        const refs = this.press!.refs ??= [...this.refs().filter(r => !same(r, s.path[i])), ...s.path.filter((_, k) => k !== i)]
        const q = this.placed(p, refs)
        this.guides = q.guides
        s.path[i] = free ? q.q : octiPoint(q.q, prev, next, s.grid ?? 'octi')
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
    } else if (g.kind === 'seg') {
      const el = byId.get(g.el.id), s = specOf(el)
      const moved = this.editSeg(s, g, p)
      scene = moved ? restack(this.convert, replace(start, lineEls(this.convert, moved, styleOf(el), el)), el.id) : start.slice()
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
      const line = m && !m.customData.ligne.span && findLine(this.lines().map(l => l.el), m.customData.ligne.line)
      const at: XY = line ? nearest(centre(line), p).q : p
      // the mark's anchor: a net flag's first point, else the centre
      const d0 = this.press!.at, c: XY = !m ? d0 : m.customData.ligne.shape === 'net' ? [m.x + m.points[0][0], m.y + m.points[0][1]]
        : middle(m)
      const d: XY = m ? [at[0] - c[0], at[1] - c[1]] : [p[0] - d0[0], p[1] - d0[1]]
      const moved = new Map(g.group.map(e => byId.get(e.id)).map(e => [e.id, bump(e, { x: e.x + d[0], y: e.y + d[1] })]))
      scene = start.map(e => moved.get(e.id) ?? e)
    }
    this.put(scene, capture)
  }

  /** Line s with leg g.k moved (or a jog put in at g.at) so that it passes the pointer p, lined up
   *  with what is drawn; legs pushed flush drop out. Its moved waypoints leave any lanes. */
  private editSeg(s: Spec, g: Extract<Grab, { kind: 'seg' }>, p: XY): Spec | undefined {
    const grid = s.grid ?? 'octi', nk = legNormal(s.path, g.k)
    const refs = this.press!.refs ??= this.refs().filter(r => !s.path.some(q => same(q, r)))
    const q = this.placed(p, refs)
    this.guides = q.guides
    const d = (q.q[0] - g.at[0]) * nk[0] + (q.q[1] - g.at[1]) * nk[1]
    let al: Along = { radii: s.radii, links: s.links, folds: s.cable?.folds }, pts: XY[] | undefined, moved: number[]
    if (g.jog) {
      pts = jog(s.path, g.k, g.at, d, grid)
      if (pts) al = spliceAlong(al, g.k + 1, 0, 2, s.r)
      moved = [g.k + 1, g.k + 2, g.k + 3]
    } else {
      pts = shiftLeg(s.path, g.k, d)?.pts
      moved = [g.k, g.k + 1]
    }
    if (!pts) return
    if (al.links) al = { ...al, links: al.links.map((l, i) => moved.includes(i) ? null : l) }
    const t = tidyAlong(pts, al)
    return { ...s, path: t.pts, radii: t.al.radii, links: t.al.links,
      cable: s.cable && { ...s.cable, folds: t.al.folds } }
  }

  /** Double-click on a bend: it goes, when a straight leg on the grid can take its place. */
  private dropAt(p: XY): boolean {
    const g = this.editGrab(p)
    if (g?.kind !== 'point') return false
    const s = specOf(g.el), pts = dropBend(s.path, g.i, s.grid ?? 'octi')
    if (!pts) { this.flash('no straight leg fits: drag a leg instead'); return true }
    const al = spliceAlong({ radii: s.radii, links: s.links, folds: s.cable?.folds }, g.i, 1, 0, s.r)
    const sp: Spec = { ...s, path: pts, radii: al.radii, links: al.links, cable: s.cable && { ...s.cable, folds: al.folds } }
    this.put(restack(this.convert, replace(this.api.getSceneElements(), lineEls(this.convert, sp, styleOf(g.el), g.el)),
      g.el.id), 'IMMEDIATELY')
    return true
  }

  /** Select mode: a press on a line that is not selected edits it (drag a bend or a leg) or, a
   *  click, selects just it; a selected line is left to Excalidraw (moving it). */
  private selectDown(e: PointerEvent) {
    if (!this.active || this.mode !== 'select' || e.button !== 0 || e.altKey || e.ctrlKey || e.metaKey) return
    if (!(e.target instanceof HTMLCanvasElement)) return
    const p = this.scene(e), g = this.editGrab(p, e.shiftKey)
    if (!g || g.kind !== 'point' && g.kind !== 'seg') return
    if (this.api.getAppState().selectedElementIds?.[g.el.id]) return
    e.preventDefault(); e.stopImmediatePropagation()
    this.press = { at: p, grab: g, start: this.api.getSceneElements().slice() }
    const z = this.zoom()
    const move = (m: PointerEvent) => {
      m.stopImmediatePropagation()
      const pr = this.press, c = this.cursor = this.scene(m)
      this.mod = m.ctrlKey || m.metaKey
      if (pr?.grab && (pr.dragging || dist(pr.at, c) * z > DRAG)) {
        pr.dragging = true
        this.drag(pr.grab, c, m.shiftKey, 'EVENTUALLY')
        this.draw()
      }
    }
    const up = (u: PointerEvent) => {
      u.stopImmediatePropagation()
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      const pr = this.press
      // the drag's last step still reads the press (refs it lined up with)
      if (pr?.dragging) this.drag(pr.grab!, this.scene(u), u.shiftKey, 'IMMEDIATELY')
      else this.select(g.el)
      this.press = undefined
      this.guides = []
      this.draw()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
  }

  /** Alt-click (or the pick button): the clicked line's style (and cable) becomes ligne's. */
  private pick(p: XY) {
    const hit = this.lineAt(p)
    if (hit) {
      this.api.updateScene({ appState: toState(lookOf(hit.el)) })
      this.takeOptions(hit.el)
    }
    this.picking = false
    this.panelUI()
  }

  /** ligne's toggles from a line: cable, ticks, arrow. */
  private takeOptions(el: any) {
    const c = cableOf(el), d = dataOf(el)!
    this.twist = !!c
    if (c) { const { legs, folds, pick, ...rest } = c; this.cable = rest }
    this.ticks = !!d.ticks
    this.ends = { start: d.ends?.start ?? 'none', end: d.ends?.end ?? 'none' }
    this.casing = d.casing ?? 0
    if (this.arrow !== !!d.arrow) { this.arrow = !!d.arrow; this.api.setActiveTool({ type: this.held() }) }
  }

  /** First stop: on a line's end the line is extended (in its own style, replaced on finish), on a
   *  lane it starts following that line, on a line it branches. */
  private start(p: XY, shift = false) {
    const jn = this.joinMode && this.joinAt(p)
    if (jn) return this.startJoin(jn)
    const port = !this.snapLine(p) ? this.portAt(p) : undefined
    if (port) {
      // out of a block's port, square to its side
      this.reset()
      const o = outOf(port.port), lead = this.stub()
      this.pts = [port.at, [port.at[0] + o[0] * lead, port.at[1] + o[1] * lead]]
      this.meta = [{ r: this.r, link: null }, { r: this.r, link: null }]
      this.dockStart = { block: port.bid, port: port.port }
      return
    }
    // a flat cable's end: a fanned wire goes on; a wire starts a bundle of it (⇧: the whole cable goes on)
    const leg = this.legAt(p), t = !leg && this.wireAt(p)
    if (leg) return this.fromLeg(leg)
    if (t) return shift ? this.extend(t.el, t.end) : this.splitFrom(t)
    // a free lane spot nearer than a line's end wins: stacked lines start a lane's width apart
    let hit = this.snapLine(p), ln = (!hit || hit.end) && this.lane(p)
    if (hit?.end && ln && dist(p, ln.q) < dist(p, hit.q)) hit = undefined
    else if (hit) ln = undefined
    this.bend = false
    this.lead = undefined
    // drawing: settings go to this line now, not to lines selected before
    if (Object.keys(this.api.getAppState().selectedElementIds ?? {}).length)
      this.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null } })
    if (hit?.end) this.extend(hit.el, hit.end)
    else if (ln) {
      this.pts = [ln.q]; this.meta = [this.onLane(ln)]
      this.track = { of: lidOf(ln.el), d: ln.d, i: ln.i }
    } else {
      this.pts = [hit?.q ?? this.placed(p).q]; this.meta = [{ r: this.r, link: null, fold: this.flat() && this.flip }]
      this.flip = false
      this.from = hit?.el && lidOf(hit.el)
      if (hit?.el) {
        // a branch, as on the tube map: same style as the trunk, peeling off it in a curve
        const path = pathOf(hit.el), { i, t } = beside(path, hit.q), l = dist(path[i], path[i + 1])
        const u: XY = [(path[i + 1][0] - path[i][0]) / l, (path[i + 1][1] - path[i][1]) / l]
        this.fork = { u, back: t * l, fwd: (1 - t) * l }
        this.api.updateScene({ appState: toState(lookOf(hit.el)) })
      }
    }
  }

  /** A line's end at p to join a new line to: where the new line starts (a flat cable's wire there,
   *  a sheathed cable's next free wire, else the end itself), the way out, its offset across the
   *  end (left of travel) and the wire's colour. */
  private joinAt(p: XY) {
    const w = this.wireAt(p)
    const at = w ? { el: w.el, end: w.end } : this.endAt(p) ?? (() => {
      const h = this.snapLine(p)
      return h?.el && h.end ? { el: h.el, end: h.end } : undefined
    })()
    if (!at) return
    const el = at.el, path = pathOf(el), c = cableOf(el), lid = lidOf(el), base = el.strokeColor
    const n = path.length, a = at.end === 'end' ? path[n - 1] : path[0], b = at.end === 'end' ? path[n - 2] : path[1]
    const out = unit([a[0] - b[0], a[1] - b[1]]), u: XY = at.end === 'end' ? out : [-out[0], -out[1]], nl: XY = [-u[1], u[0]]
    let d = 0, color: string | undefined
    if (w && c) {
      d = across(c, endOf(path, c, w.end).side, w.j)
      color = wire(c, w.j, base).color
    } else if (c && isSheathed(c) && c.n > 1) {
      // the next wire out of the sheath, spread across it
      const taken = this.lines().filter(l => dataOf(l.el)!.links?.[0]?.of === lid
        && (dataOf(l.el)!.links![0]!.t > 0.5) === (at.end === 'end')).length, j = taken % c.n
      d = (j - (c.n - 1) / 2) * bodyWidth(el) / c.n * .8
      color = wire(c, j, base).color
    }
    return { el, end: at.end, at: [a[0] + nl[0] * d, a[1] + nl[1] * d] as XY, out, d, color }
  }

  /** Starts a line going on from a line's end (see joinAt): in ligne's own body, a plain wire in the
   *  wire's colour; its first stop stays on that end, its first leg runs straight out under the sleeve. */
  private startJoin(j: NonNullable<ReturnType<Ligne['joinAt']>>) {
    this.reset()
    const path = pathOf(j.el), n = path.length
    if (!this.twist && j.color) this.api.updateScene({ appState: { currentItemStrokeColor: j.color } })
    const reach = jointReach({ kind: this.jointKind }, bodyWidth(j.el), cableOf(j.el)?.scale ?? 1).f
    const lead = reach + Math.max(this.width(), 2 * SNAP / this.zoom())
    this.pts = [j.at, [j.at[0] + j.out[0] * lead, j.at[1] + j.out[1] * lead]]
    this.meta = [{ r: this.r, link: { of: lidOf(j.el), i: j.end === 'end' ? n - 2 : 0, t: j.end === 'end' ? 1 : 0, d: j.d } },
      { r: this.r, link: null }]
    this.from = lidOf(j.el)
    this.joining = { el: j.el, end: j.end }
    this.panelUI()
    this.draw()
  }

  /** Goes on drawing line el from its end (in its own style, replaced on finish). */
  private extend(el: any, end: 'start' | 'end') {
    this.reset()
    const s = specOf(el), rev = end === 'start', o = <T>(a: T[]) => rev ? a.slice().reverse() : a
    this.pts = o(s.path); this.meta = o(s.path.map((_, i) => ({ r: s.radii[i], link: s.links?.[i] ?? null })))
    this.editing = { id: el.id, reversed: rev, n: s.path.length }; this.from = s.from; this.r = s.r
    // a flat cable's folds; its end is a corner now (extended at its start: it keeps its side)
    const f = s.cable?.folds, last = this.meta.length - 1
    if (f) this.meta.forEach((m, i) => { m.fold = f[rev ? f.length - 1 - i : i] })
    this.startBack = rev && !!this.meta[last].fold
    this.meta[last].fold = false
    this.api.updateScene({ appState: toState(lookOf(el)) })
    this.takeOptions(el)
    this.panelUI()
  }

  /** Next stop: on the last stop it ends the line, on the first it closes it into a zone. */
  private stop(p: XY, free: boolean) {
    const t = this.split && this.pts.length === 2 && this.wireAt(p)
    if (t && t.el.id === this.split!.el.id && t.end === this.split!.end) {
      this.split!.q1 = t.q
      return this.splitFrom()
    }
    if (this.near(p, this.pts[this.pts.length - 1])) return this.finish()
    const closing = this.closing(p)
    this.cursor = p
    ;({ pts: this.pts, meta: this.meta } = this.route(free))
    this.pts = this.room(this.pts, this.meta, false).pts
    this.bend = this.flip = false
    this.lead = undefined
    if (closing) return this.finish()
    this.draw()
  }

  /** ligne lines selected in Excalidraw now (never a selection remembered from before: settings
   *  changed with none go to the next line only). */
  private selLines() {
    const ids = this.api.getAppState().selectedElementIds ?? {}
    return this.live().filter(e => ids[e.id] && isLine(e, true) && !stale(e)).map(e => e.id)
  }

  /** Changes the selected lines (lines on their lanes follow); false when none. */
  private applySel(f: (s: Spec) => void, capture: string) {
    const ids = this.selLines()
    if (this.pts.length || !ids.length) return false
    let scene = this.api.getSceneElements().slice()
    for (const id of ids) {
      const el = scene.find(e => e.id === id)
      if (!el || !isLine(el, true) || stale(el)) continue
      const s = specOf(el)
      f(s)
      scene = restack(this.convert, replace(scene, lineEls(this.convert, s, styleOf(el), el)), id)
    }
    this.put(scene, capture)
    return true
  }

  /** Bend radius r for the stops drawn so far (bar bends nested in another line's), else for the
   *  selected lines. */
  private radius(r: number, capture: string) {
    this.r = Math.max(0, Math.min(60, r))
    const own = (l: Link | null | undefined) => !l || l.t > 0
    for (const m of this.meta) if (own(m.link) && !m.fold) m.r = this.r
    this.applySel(s => {
      s.r = this.r; s.radii = s.radii.map((v, j) => own(s.links?.[j]) && !s.cable?.folds?.[j] ? this.r : v)
    }, capture)
    this.save()
    this.draw()
  }

  /** Cable settings changed (`patch`, else turned on / off): for the line being drawn, else for the
   *  selected lines, which keep their legs, folds, connectors (bar those in the patch). */
  private cabling(patch?: Partial<Cable>, capture = 'IMMEDIATELY', ui = true) {
    if (patch) this.cable = { ...this.cable, ...patch }
    this.applySel(s => {
      if (s.kind !== 'line') return
      // other wire counts drop the split's pick and the legs; a new fan, the hand-placed legs
      const o = s.cable, other = patch?.n !== undefined && patch.n !== o?.n ? { pick: undefined, legs: undefined }
        : patch?.fan ? { legs: undefined } : {}
      s.cable = !this.twist ? undefined : o && patch ? { ...o, ...patch, ...other }
        : { ...this.cable, legs: o?.legs, folds: o?.folds, conn: o?.conn ?? this.cable.conn }
    }, capture)
    this.save()
    if (ui) this.panelUI()
  }

  /** Next cable style; into flat ones with their defaults, wire counts to suit. */
  private restyle(style: CableStyle) {
    const was = this.cable, flat = style === 'ribbon' || style === 'ffc', fits = isFlat(was) === flat
    const conn: Conn = 'none'
    this.twist = true
    if (style === 'chevron') return this.cabling({ style, n: 1, pitch: was.style === 'chevron' ? was.pitch : 24 })
    // a jacket: USB-like, 4 mm across, 4 wires inside, at twice true size
    if (style === 'jacket') return this.cabling({ style, n: was.style === 'jacket' ? was.n : 4, mm: 4,
      set: 'usb', scale: was.scale ?? 2, conn: { start: conn, end: conn } })
    // coax: RG316 at twice true size, in its own colour
    if (style === 'coax') {
      const kind: CoaxKind = was.style === 'coax' ? was.coax ?? 'rg316' : 'rg316'
      if (was.style !== 'coax') this.pickColor(COAX[kind].color)
      return this.cabling({ style, n: 1, coax: kind, mm: COAX[kind].mm, scale: was.scale ?? 2, shield: undefined,
        conn: { start: conn, end: conn } })
    }
    const odd = was.style === 'chevron' || was.style === 'jacket' || was.style === 'coax'
    this.cabling({ style, n: fits && !odd ? was.n : style === 'ffc' ? 20 : flat ? 6 : 2,
      ...(odd ? { pitch: 16 } : {}),
      ...(flat ? { awg: was.awg ?? 28, mm: was.mm ?? .5, set: was.set ?? 'mono', scale: was.scale ?? 1 } : {}),
      ...(flat && was.style !== style ? { conn: { start: conn, end: conn } } : {}) })
  }

  /** The end of a flat or jacketed cable near p: the line, which end. */
  private endAt(p: XY) {
    const tol = 2 * SNAP / this.zoom()
    let best: { el: any, end: 'start' | 'end' } | undefined, bd = Infinity
    for (const l of this.lines()) {
      const c = cableOf(l.el)
      if (!isFlat(c) && !isSheathed(c)) continue
      for (const end of ['start', 'end'] as const) {
        const d = dist(p, endOf(l.path, c!, end).at) - cableWidth(c!, 0) / 2
        if (d < tol && d < bd) { best = { el: l.el, end }; bd = d }
      }
    }
    return best
  }

  /** C: the next connector, at the end of a flat cable under the pointer, else at both ends of what
   *  is drawn next and of the selected lines. */
  private connect(hover = true) {
    const at = hover && this.mode === 'line' && this.cursor && !this.pts.length ? this.endAt(this.cursor) : undefined
    const c = at ? cableOf(at.el)! : this.cable
    const list = CONNS[c.style === 'ffc' || c.style === 'jacket' || c.style === 'coax' ? c.style : 'ribbon']
    const next = (k?: Conn) => list[(list.indexOf(k ?? 'none') + 1) % list.length]
    if (!at) {
      const k = next(c.conn?.end)
      return this.cabling({ conn: { start: k, end: k } })
    }
    const s = specOf(at.el)
    s.cable = { ...c, conn: { ...c.conn, [at.end]: next(c.conn?.[at.end]) } }
    const scene = replace(this.api.getSceneElements(), lineEls(this.convert, s, styleOf(at.el), at.el))
    this.put(restack(this.convert, scene, at.el.id), 'IMMEDIATELY')
  }

  /** The wire of a flat cable's end at p: line, end, wire, its position across (from the left). */
  private wireAt(p: XY) {
    const tol = SNAP / this.zoom()
    let best: { el: any, end: 'start' | 'end', j: number, q: number } | undefined, bd = Infinity
    for (const l of this.lines()) {
      const c = cableOf(l.el)
      if (!isFlat(c)) continue
      const home = flatTips(l.path, { ...c!, legs: undefined })
      for (const end of ['start', 'end'] as const) home[end].forEach((at, j) => {
        const d = dist(p, at), side = endOf(l.path, c!, end).side
        if (d >= Math.max(tol * .6, wirePitch(c!) / 2) || d >= bd) return
        best = { el: l.el, end, j, q: side > 0 ? j : c!.n - 1 - j }; bd = d
      })
    }
    return best
  }

  /** A fanned-out wire's tip at p (a ribbon leg moved out): line, end, wire, where. */
  private legAt(p: XY) {
    const tol = SNAP / this.zoom() * .6
    for (const l of this.lines()) {
      const c = cableOf(l.el)
      if (c?.style !== 'ribbon') continue
      const tips = flatTips(l.path, c)
      for (const end of ['start', 'end'] as const) {
        const j = tips[end].findIndex((at, j) => c.legs?.[end]?.[j] && dist(p, at) < Math.max(tol, wirePitch(c) / 2))
        if (j >= 0) return { el: l.el, c, end, j, at: tips[end][j] }
      }
    }
  }

  /** A plain line going on from a fanned-out wire: its colour and width, ligne's cable off. */
  private fromLeg(g: { el: any, c: Cable, j: number, at: XY }) {
    this.twist = this.ticks = false
    this.api.updateScene({ appState: toState({ strokeColor: wire(g.c, g.j, g.el.strokeColor).color,
      strokeWidth: wirePitch(g.c) * .84, strokeStyle: 'solid', roughness: 0, backgroundColor: 'transparent' }) })
    this.pts = [g.at]; this.meta = [{ r: this.r, link: null }]
    this.from = lidOf(g.el)
    this.panelUI()
  }

  /** Starts (or, with `t` unset, widens) a split: a bundle of the wires at positions q0..q1 of a flat
   *  cable's end, going on from there with those wires, the same side up. */
  private splitFrom(t?: { el: any, end: 'start' | 'end', q: number }) {
    if (t) {
      this.reset()
      this.takeOptions(t.el)
      this.split = { el: t.el, end: t.end, q0: t.q, q1: t.q }
    }
    const sp = this.split!, c = cableOf(sp.el)!, e = endOf(pathOf(sp.el), c, sp.end), n = c.n, P = wirePitch(c)
    const a = Math.min(sp.q0, sp.q1), b = Math.max(sp.q0, sp.q1), k = b - a + 1
    if (k === n) return this.extend(sp.el, sp.end)                // all of them: the cable itself goes on
    const across = ((a + b) / 2 - (n - 1) / 2) * P, at: XY = [e.at[0] + e.nl[0] * across, e.at[1] + e.nl[1] * across]
    // wires in order from the bundle's left (at the start it runs the other way); back up: reversed
    let qs = Array.from({ length: k }, (_, i) => a + i).map(q => e.side > 0 ? q : n - 1 - q)
    if (sp.end === 'start') qs = qs.reverse()
    if (e.side < 0) qs = qs.reverse()
    sp.pick = qs.map(j => c.pick?.[j] ?? j)
    this.cable = { ...this.cable, n: k }
    const lead = Math.max(3 * P, 2 * SNAP / this.zoom())
    this.pts = [at, [at[0] + e.out[0] * lead, at[1] + e.out[1] * lead]]
    this.meta = [{ r: this.r, link: null, fold: e.side < 0 }, { r: this.r, link: null }]
    this.from = lidOf(sp.el)
    this.panelUI()
    this.draw()
  }

  private save() {
    const { r, cable, onLine, spread, gridMode, labelType, solid, font, size, partKind, scale, ends, casing, byNet,
      nextColor, jointKind, labelDir, blockKind } = this
    localStorage.setItem(OPTS, JSON.stringify({ r, cable, onLine, spread, gridMode, labelType, solid, font, size, partKind,
      scale, ends, casing, byNet, nextColor, jointKind, labelDir, blockKind }))
  }

  private undoStop() {
    this.pts.pop(); this.meta.pop(); this.lead = undefined
    if (!this.pts.length) this.reset()
    this.draw()
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    // only where text is typed: a slider or button keeps ligne's and Excalidraw's keys working
    const typing = t.isContentEditable || /TEXTAREA|SELECT/.test(t.tagName)
      || t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|color)$/.test((t as HTMLInputElement).type)
    if (typing || !this.focused()) return
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation() }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd-Z while drawing takes back a stop; all else is Excalidraw's (undo, copy, …)
      if (this.active && this.pts.length && e.key.toLowerCase() === 'z' && !e.shiftKey) { this.undoStop(); stop() }
      // focus on ligne's layer (or nowhere): Excalidraw's own shortcuts are handed to it; the host's
      // (Obsidian's Ctrl-P, …) are left alone
      const box = this.container()
      if (this.active && box && !box.contains(t) && FORWARD.includes(e.key.toLowerCase())
        && (t === document.body || this.host.contains(t))) {
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
    if (this.tidying && (k === 'Enter' || k === 'Escape')) this.tidyEnd(k === 'Enter')
    else if (k === 'Escape' && this.menu) this.openMenu()
    else if (k === 'Escape' && this.mode === 'select') {
      // clears the selection; with none, back to drawing
      if (Object.keys(this.api.getAppState().selectedElementIds ?? {}).length)
        this.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null } })
      else this.setMode(this.drawn)
    } else if (k === 'Escape') this.pts.length || this.pin ? this.reset() : this.setMode('select')
    else if (k === 'm') this.setActive(false)
    else if (this.mode === 'select' && (k === 'Backspace' || k === 'Delete')) return
    else if ((k === 'Backspace' || k === 'Delete') && !this.pts.length) return  // Excalidraw deletes the selection
    else if (/^[0-9]$/.test(k) && this.digit(+k || 10)) this.panelUI()
    else if (act) act()
    else return
    stop()
    // a host listening before us (Obsidian's Excalidraw plugin) may still have picked a tool by that key
    if (this.active) setTimeout(() => this.api.setActiveTool({ type: this.held() }))
    this.draw(e.shiftKey)
  }

  /** 1–9, 0 (n = 10): the station shape, label type or part of the mode; false where they mean nothing. */
  private digit(n: number) {
    if (this.mode === 'station' && SHAPES[n]) this.shape = SHAPES[n]
    else if (this.mode === 'label' && LABELS[n - 1]) this.labelType = LABELS[n - 1]
    else if (this.mode === 'board' && PARTS[n - 1]) { this.partKind = PARTS[n - 1]; this.pin = undefined }
    else if (this.mode === 'block' && BLOCKS[n - 1]) this.blockKind = BLOCKS[n - 1]
    else return false
    this.save()
    return true
  }

  /** Key → action; the panel buttons run the same. */
  private actions: Record<string, () => void> = {
    Enter: () => this.finish(), Backspace: () => this.undoStop(), Delete: () => this.undoStop(),
    b: () => this.mode === 'station' ? this.toggle('boxed') : this.mode === 'label' ? this.toggle('onLine')
      : this.toggle(this.flat() ? 'flip' : 'bend'),
    B: () => this.toggle('bend'),
    l: () => this.setMode('line'),
    s: () => this.setMode(this.mode === 'station' ? 'line' : 'station'),
    t: () => this.setMode(this.mode === 'label' ? 'line' : 'label'),
    x: () => this.setMode(this.mode === 'board' ? 'line' : 'board'),
    q: () => this.setMode(this.mode === 'block' ? 'line' : 'block'),
    v: () => this.setMode('select'),
    T: () => { this.setMode('label'); this.labelType = 'along'; this.save(); this.panelUI() },
    o: () => this.toggle('landscape'), '?': () => this.toggle('help'),
    h: () => this.toggle('help'), i: () => this.toggle('picking'), d: () => this.toggle('ticks'),
    f: () => this.toggle('solid'),
    w: () => { this.twist = !this.twist; this.cabling() },
    j: () => this.toggle('joinMode'),
    y: () => this.tidying ? this.tidyEnd(true) : this.tidy(),
    W: () => this.restyle(STYLES[(STYLES.indexOf(this.cable.style) + 1) % STYLES.length]),
    c: () => this.connect(), C: () => { this.copySvg() },
    e: () => this.cabling(this.cable.style === 'ffc'
      ? { mm: FFC_PITCH[(FFC_PITCH.indexOf(this.cable.mm ?? .5) + 1) % FFC_PITCH.length] }
      : { awg: GAUGES[(GAUGES.indexOf(this.cable.awg ?? 28) + 1) % GAUGES.length] }),
    a: () => { this.toggle('arrow'); this.api.setActiveTool({ type: this.held() }) },
    n: () => this.toggle('snap'),
    g: () => this.setGrid(GRIDS[(GRIDS.indexOf(this.gridMode) + 1) % GRIDS.length]),
    '[': () => { this.radius(this.r - 4, 'IMMEDIATELY'); this.panelUI() },
    ']': () => { this.radius(this.r + 4, 'IMMEDIATELY'); this.panelUI() },
    '-': () => this.gap(-2), '=': () => this.gap(2), '+': () => this.gap(2),
    r: () => this.rotate(Math.PI / 2), R: () => this.rotate(Math.PI / 4),
    k: () => this.legend(), p: () => this.paper('A5'), P: () => this.paper('A6'),
  }
  private toggle(k: 'boxed' | 'landscape' | 'help' | 'picking' | 'ticks' | 'arrow' | 'free' | 'snap' | 'bend' | 'onLine'
    | 'flip' | 'solid' | 'joinMode') {
    this[k] = !this[k]
    if (k === 'ticks') this.applySel(s => { s.ticks = this.ticks }, 'IMMEDIATELY')
    if (k === 'onLine' || k === 'solid') this.save()
    this.panelUI()
  }

  /** Lines, stations, labels, perfboards; or select: Excalidraw's selection tool, ligne's keys and
   *  panel still on. */
  private setMode(m: Mode) {
    this.reset()
    if (m === 'select' && this.mode !== 'select') this.drawn = this.mode
    this.mode = m
    this.layer.style.pointerEvents = this.active && m !== 'select' ? 'all' : 'none'
    if (this.active) this.api.setActiveTool({ type: this.held() })
    this.panelUI()
  }
  private reset() {
    this.pts = []; this.meta = []
    this.from = this.editing = this.fork = this.lead = this.track = this.split = this.pin = this.joining = this.dockStart = undefined
    this.bend = this.flip = this.startBack = false
    this.guides = []
    this.draw()
  }

  /** - / =: in select mode, the selected lines' lanes move out (or in) by k; else the lane gap of
   *  lines drawn next. */
  private gap(k: number) {
    const sel = this.mode === 'select' && this.applySel(s => {
      if (!s.links?.some(Boolean)) return
      s.links = s.links.map(l => l && { ...l, d: Math.sign(l.d) * Math.max(0, Math.abs(l.d) + k) })
      onLanes(this.api.getSceneElements(), s)
    }, 'IMMEDIATELY')
    if (!sel) this.spread = Math.max(0, Math.min(40, this.spread + k))
    this.save()
    this.panelUI()
  }

  /** R: the selection turned by a, group by group: a part about its pin 1, else about its middle.
   *  ligne's lines stay (their waypoints would no longer describe them). */
  private rotate(a: number) {
    const s = this.api.getAppState(), ids = new Set(Object.keys(s.selectedElementIds ?? {}))
    const els = this.live(), drawn = new Set(['line', 'zone', ...EXTRAS])
    const pick = els.filter(e => (ids.has(e.id) || ids.has(e.containerId)) && !drawn.has(e.customData?.ligne?.kind))
    if (!pick.length) return
    const groups = new Map<string, any[]>()
    for (const e of pick) {
      const g = e.groupIds?.at(-1) ?? e.containerId ?? e.id
      groups.set(g, [...groups.get(g) ?? [], e])
    }
    const moved = new Map<string, any>()
    for (const g of groups.values()) {
      const body = g.find(e => e.customData?.ligne?.kind === 'part')
      const xs = g.flatMap(e => [e.x, e.x + e.width]), ys = g.flatMap(e => [e.y, e.y + e.height])
      const c: XY = body ? pinsAt(body)[0] : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
      for (const e of turned(g, c, a)) moved.set(e.id, bump(e, { x: e.x, y: e.y, angle: e.angle }))
    }
    this.put(this.api.getSceneElements().map(e => moved.get(e.id) ?? e), 'IMMEDIATELY')
  }

  /** The label tool's "along": text repeated along line `el` (empty: none), asked in place at p. */
  private alongText(el: any, p: XY) {
    this.ask(p, text => {
      const sp = specOf(el)
      sp.text = text ? { text, font: FONTS[this.font], size: Math.min(this.size, 14),
        paper: this.api.getAppState().viewBackgroundColor ?? '#ffffff' } : undefined
      this.put(restack(this.convert, replace(this.api.getSceneElements(), lineEls(this.convert, sp, styleOf(el), el)), el.id),
        'IMMEDIATELY')
    }, dataOf(el)?.text?.text ?? '', true)
  }

  /** ⇧C: the selection (else everything) as SVG on the clipboard, as Excalidraw exports it. */
  private async copySvg() {
    if (!this.exportSvg) return this.flash('SVG export not available here')
    const s = this.api.getAppState(), ids = new Set(Object.keys(s.selectedElementIds ?? {})), live = this.live()
    const elements = ids.size ? live.filter(e => ids.has(e.id) || ids.has(e.containerId)) : live
    const svg = await this.exportSvg({ elements, files: this.api.getFiles?.() ?? {}, appState: { exportBackground: true,
      viewBackgroundColor: s.viewBackgroundColor ?? '#ffffff', exportWithDarkMode: false, exportEmbedScene: false } })
    const text = new XMLSerializer().serializeToString(svg)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }),
        'image/svg+xml': new Blob([text], { type: 'image/svg+xml' }) })])
    } catch { await navigator.clipboard.writeText(text) }
    this.flash(`SVG copied: ${ids.size ? 'the selection' : 'everything'}`)
  }

  /** A short note under the panel. */
  private flash(text: string) {
    const t = Object.assign(document.createElement('div'), { className: 'ligne-toast', textContent: text })
    this.host.append(t)
    setTimeout(() => t.remove(), 1800)
  }

  graph() { return graph(this.api.getSceneElements()) }
  text() { return toText(this.graph()) }

  private copy() { navigator.clipboard?.writeText(this.text()).then(() => this.flash('graph copied as text')) }

  private add(els: any[], back = false) {
    const all = this.api.getSceneElements()
    this.put(back ? [...els, ...all] : [...all, ...els], 'IMMEDIATELY')
  }

  /** Drops a station on the nearest line (or where clicked); a net flag points away from a line end. */
  private station(p: XY) {
    const hit = this.snapLine(p), n = this.graph().stations.length + 1
    if (this.shape === 'interchange' && hit?.el && !hit.end) return this.interchange(p)
    const tip = hit?.end === 'end' ? hit.path.slice(-2) : hit?.end === 'start' ? hit.path.slice(0, 2).reverse() : []
    // on a line's body: the name beside it, on the side of the pointer, off the stack's edge
    const side = hit?.el && !hit.end && this.shape !== 'net' ? this.beside(hit.el, p) : undefined
    const els = station(this.convert, {
      at: hit?.q ?? p, shape: this.shape, line: hit?.el && lidOf(hit.el), boxed: this.boxed,
      font: this.labelFont(),
      color: hit?.el?.strokeColor ?? this.api.getAppState().currentItemStrokeColor,
      text: this.shape === 'net' ? `NET${n}` : `S${n}`, dir: tip.length && tip[1][0] < tip[0][0] ? -1 : 1,
      ...(side ? { angle: side.angle, away: side.away, off: side.off } : {}),
    })
    this.add(side ? this.unclutter(els, side.u, side.away, els.slice(1)) : els)
  }

  /** The blocks in the scene: shape element, id, box. */
  private blocks() {
    return this.live().filter(e => e.customData?.ligne?.kind === 'block')
      .map(e => ({ el: e, bid: e.customData.ligne.bid as string, box: blockBox(e) }))
  }

  /** A block's port near p (inside the block, or just outside it): block id, port, its point. */
  private portAt(p: XY) {
    if (!this.snapping() || this.mode !== 'line') return
    const tol = 2 * SNAP / this.zoom()
    for (const b of this.blocks()) {
      const [x, y, w, h] = b.box
      if (p[0] < x - tol || p[0] > x + w + tol || p[1] < y - tol || p[1] > y + h + tol) continue
      const n = nearestPort(b.box, p)
      return { bid: b.bid, port: n.port, at: n.at }
    }
  }

  /** The straight bit a line leaves or enters a port with. */
  private stub() { return Math.max(this.r + 8, 2 * SNAP / this.zoom()) }

  /** A finished line's docks: where it left a port, where it ends on one (an extended line keeps
   *  those of its other end). */
  private docksOf(pts: XY[], had?: { start?: Dock, end?: Dock }) {
    const end = (q: XY): Dock | undefined => {
      for (const b of this.blocks()) for (const port of ['n', 'e', 's', 'w'] as Port[])
        if (dist(portAt(b.box, port), q) < 1e-6) return { block: b.bid, port }
    }
    const rev = this.editing?.reversed
    const start = rev ? end(pts[0]) : this.dockStart ?? had?.start ?? end(pts[0])
    const fin = rev ? had?.end ?? end(pts[pts.length - 1]) : end(pts[pts.length - 1])
    return start || fin ? { start, end: fin } : undefined
  }

  /** Blocks mode: a block at p (a click: its usual size, centred; a drag: that box), then its text. */
  private placeBlock(p: XY, to: XY) {
    const kind = this.blockKind, [w0, h0] = SIZE[kind]
    const dragged = dist(p, to) * this.zoom() > DRAG * 3
    const a = this.placed(p).q, b = this.placed(to).q
    const box: [number, number, number, number] = dragged
      ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(24, Math.abs(b[0] - a[0])), Math.max(24, Math.abs(b[1] - a[1]))]
      : [a[0] - w0 / 2, a[1] - h0 / 2, w0, h0]
    const s = this.api.getAppState()
    this.ask([box[0] + box[2] / 2, box[1] + box[3] / 2], text => this.add(block(this.convert, { kind, box, text,
      color: s.currentItemStrokeColor, font: this.labelFont() })), kind === 'icon' ? '★' : '', true)
  }

  /** Blocks moved (by Excalidraw or undo): the ends of lines docked on them follow, their stubs with
   *  them, the legs after carried along so that they keep their directions. Not in history: undo moves
   *  the block back and this follows again. */
  private followBlocks() {
    const now = new Map(this.blocks().map(b => [b.bid, b.box.map(v => Math.round(v * 100) / 100).join()]))
    const moved = [...now].filter(([id, k]) => this.blockBoxes.has(id) && this.blockBoxes.get(id) !== k).map(([id]) => id)
    this.blockBoxes = now
    if (!moved.length) return
    const boxes = new Map(this.blocks().map(b => [b.bid, b.box]))
    setTimeout(() => {
      let scene = this.api.getSceneElements().slice(), hit = false
      for (const e of scene.filter(e => isLine(e) && !stale(e) && dataOf(e)!.docks)) {
        const s = specOf(e), dk = s.docks!, n = s.path.length
        let changed = false
        for (const [end, j, k] of [['start', 0, 1], ['end', n - 1, n - 2]] as const) {
          const d = dk[end], box = d && moved.includes(d.block) && boxes.get(d.block)
          if (!d || !box) continue
          const to = portAt(box, d.port), by: XY = [to[0] - s.path[j][0], to[1] - s.path[j][1]]
          if (Math.hypot(...by) < 1e-6) continue
          // the stub moves whole; the legs after it shift by the part of the move across them
          s.path[j] = to
          if (n > 2) {
            s.path[k] = [s.path[k][0] + by[0], s.path[k][1] + by[1]]
            const far = end === 'start' ? n - 1 : 0
            s.path = carry(s.path, k, by, i => i === j || i === far && !!dk[end === 'start' ? 'end' : 'start'] || !!s.links?.[i])
          }
          changed = true
        }
        if (!changed) continue
        // legs that left the grid: the line is routed afresh between its stubs
        const g = s.grid ?? 'octi', onGrid = s.path.every((q, i) => i === 0 || dist(snapDir(s.path[i - 1], q, g), q) < 1e-3)
        if (!onGrid) {
          const ends = (['start', 'end'] as const).map(end => {
            const d = dk[end], box = d && boxes.get(d.block), at = end === 'start' ? s.path[0] : s.path[n - 1]
            if (!d || !box) return { at, stub: at }
            const o = outOf(d.port), p = portAt(box, d.port), k = this.stub()
            return { at: p, stub: [p[0] + o[0] * k, p[1] + o[1] * k] as XY, out: o }
          })
          const [a, b] = ends, mid = octi(a.stub, b.stub, undefined, a.out, g)
          const pts = simplify([a.at, ...mid, b.at])
          s.path = pts; s.radii = pts.map(() => s.r); s.links = undefined
        }
        scene = restack(this.convert, replace(scene, lineEls(this.convert, s, styleOf(e), e)), e.id)
        hit = true
      }
      if (hit) this.put(scene, 'NEVER')
    })
  }

  /** An interchange: across the stack at p (a ring on a lone line), or, dragged out to `to`, a
   *  capsule from p's line to there (on the grid's directions), its name beside it. */
  private interchange(p: XY, to?: XY) {
    const hit = this.snapLine(p), n = this.graph().stations.length + 1, wmax = Math.max(4, ...this.lines().map(l => l.width))
    const T = Math.max(16, wmax * 2.5)
    let a: XY, b: XY, away: XY, off: number, angle = 0
    if (to) {
      a = hit?.q ?? p
      b = snapDir(a, this.snapLine(to)?.q ?? to, this.gridDirs())
      away = dist(a, b) > 1e-6 ? unit([b[0] - a[0], b[1] - a[1]]) : [0, -1]
      const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      off = dist(a, b) / 2 + T / 2
      p = m
    } else {
      const sd = this.beside(hit!.el, p), nl: XY = [-sd.u[1], sd.u[0]], w = bodyWidth(hit!.el)
      const e1 = edgeOut(this.lines(), sd.q, nl, w / 2), e2 = edgeOut(this.lines(), sd.q, [-nl[0], -nl[1]], w / 2)
      a = [sd.q[0] - nl[0] * (e2 - w / 2), sd.q[1] - nl[1] * (e2 - w / 2)]
      b = [sd.q[0] + nl[0] * (e1 - w / 2), sd.q[1] + nl[1] * (e1 - w / 2)]
      away = sd.away
      const far = away[0] * nl[0] + away[1] * nl[1] > 0 ? e1 : e2
      off = far - w / 2 + T / 2
      angle = sd.angle
      p = sd.q
    }
    const els = station(this.convert, { at: p, shape: 'interchange', line: hit?.el && lidOf(hit.el), boxed: this.boxed,
      font: this.labelFont(), color: hit?.el?.strokeColor ?? '#1e1e1e', text: `S${n}`, span: [a, b], thick: T,
      away, off, angle })
    this.add(this.unclutter(els, [-away[1], away[0]], away, els.slice(1)))
  }

  /** Where a label beside line el goes for pointer p: the leg's direction there, the side of the
   *  pointer (else above, or right of a vertical), how far out the stack's edge is, the angle it reads at. */
  private beside(el: any, p: XY) {
    const drawn = centre(el), m = nearest(drawn, p), a = drawn[m.i], b = drawn[m.i + 1] ?? a
    const u = unit([b[0] - a[0], b[1] - a[1]]), nl: XY = [-u[1], u[0]]
    const s = (p[0] - m.q[0]) * nl[0] + (p[1] - m.q[1]) * nl[1]
    const def = Math.abs(nl[1]) > 1e-6 ? (nl[1] < 0 ? 1 : -1) : (nl[0] > 0 ? 1 : -1)
    const k = Math.abs(s) > 1 ? Math.sign(s) : def, away: XY = [nl[0] * k, nl[1] * k]
    const off = edgeOut(this.lines(), m.q, away, bodyWidth(el) / 2)
    const angle = this.labelDir === 'flat' ? 0 : upright(this.labelDir === 'across' ? nl : u)
    return { q: m.q, u, away, off, angle }
  }

  /** els (a label, or a station and its label: `body` the part to keep clear) moved along u, or
   *  further out along n, off the labels and texts already drawn. */
  private unclutter(els: any[], u: XY, n: XY, body = els): any[] {
    const boxOf = (e: any): Box => ({ c: [e.x + e.width / 2, e.y + e.height / 2], w: e.width, h: e.height, a: e.angle ?? 0 })
    const big = body.filter(e => e.type !== 'text' || !e.containerId).sort((a, b) => b.width * b.height - a.width * a.height)[0]
    if (!big) return els
    const mine = new Set(els.map(e => e.id))
    const taken = this.live().filter(e => !mine.has(e.id) && (e.type === 'text' && !e.containerId
      || e.customData?.ligne?.kind === 'label' && e.type !== 'text')).map(boxOf)
    const b = boxOf(big), to = clear(b, taken, u, n), d: XY = [to.c[0] - b.c[0], to.c[1] - b.c[1]]
    if (!d[0] && !d[1]) return els
    const move = new Set(body.map(e => e.id))
    return els.map(e => move.has(e.id) ? { ...e, x: e.x + d[0], y: e.y + d[1] } : e)
  }

  /** The line nearest p within reach (beside it, not only on it). */
  private lineNear(p: XY, reach = 40): Ln | undefined {
    const tol = reach / this.zoom()
    let best: Ln | undefined, bd = Infinity
    for (const l of this.lines()) {
      const d = nearest(l.drawn, p).d - l.width / 2
      if (d < tol && d < bd) { best = l; bd = d }
    }
    return best
  }

  /** A label at p, of the type picked: on the line there (along it), else where clicked; a flag at a
   *  line's end points away from it. Asks for the text in place. */
  private label(p: XY) {
    const s = this.api.getAppState(), l = this.lineAt(p)
    if (this.labelType === 'along') return l && this.alongText(l.el, p)
    const end = this.labelType === 'flag' ? this.snapLine(p) : undefined
    // beside lines: a line within reach, the label on the pointer's side off its stack's edge
    const by = !this.onLine && this.labelType !== 'net' && !end?.end ? this.lineNear(p) : undefined
    const sd = by && this.beside(by.el, p)
    let at = this.placed(p).q, angle = 0, dir: 1 | -1 = 1
    if (end?.end && end.el) {
      const [a, b] = end.end === 'end' ? end.path.slice(-2) : end.path.slice(0, 2).reverse(), v = unit([b[0] - a[0], b[1] - a[1]])
      at = b; angle = upright(v); dir = Math.cos(angle) * v[0] + Math.sin(angle) * v[1] > 0 ? 1 : -1
    } else if (sd) {
      at = sd.q; angle = sd.angle
    } else if (l) {
      const n = nearest(l.drawn, p), a = l.drawn[n.i], b = l.drawn[n.i + 1] ?? a, u = unit([b[0] - a[0], b[1] - a[1]])
      at = n.q; angle = this.labelType === 'net' || this.labelDir === 'along' ? upright(u)
        : this.labelDir === 'across' ? upright([-u[1], u[0]]) : 0
    }
    const line = end?.el ?? (sd ? by!.el : l?.el)
    this.ask(at, text => {
      // a net name on a line colours it by its use (power, ground, data, clock, …)
      const net = this.byNet && line && (this.labelType === 'net' || this.labelType === 'flag') ? netColor(text) : undefined
      const els = label(this.convert, { type: this.labelType, at, angle, text, font: this.labelFont(),
        color: net ?? line?.strokeColor ?? s.currentItemStrokeColor, paper: s.viewBackgroundColor ?? '#ffffff',
        line: line && lidOf(line), on: this.onLine && !sd, off: sd ? sd.off : line ? bodyWidth(line) / 2 : 0,
        solid: this.labelType === 'pill' ? !this.solid : this.solid, dir, away: sd?.away })
      this.add(sd ? this.unclutter(els, sd.u, sd.away) : els)
      if (net && net !== line.strokeColor) this.recolor([line.id], net)
    })
  }

  /** Perfboard mode: a board dragged out from p to `to` (a click: 30 x 20 holes), at the back; or a
   *  part from its first hole (a click) to its last (the next click), then its ref and value. */
  private placePart(p: XY, to: XY) {
    const P0 = pitchOf(this.scale), kind = this.partKind
    if (kind === 'board') {
      const b = dist(p, to) * this.zoom() > DRAG ? span(p, to, P0) : { at: p, cols: 30, rows: 20 }
      return this.add(board(this.convert, b.at, b.cols, b.rows, P0, this.labelFont()), true)
    }
    const h = holeAt(this.live(), p), q = h?.q ?? p, P = h?.board.customData.ligne.pitch ?? P0
    if (!this.pin && clicks(kind) === 2) { this.pin = q; return }
    const pins = pinsOf(kind, this.pin ?? q, q, P)
    this.pin = undefined
    // refs count on per prefix (headers and sockets are both J)
    const n = this.live().filter(e => e.customData?.ligne?.kind === 'part' && PREFIX[e.customData.ligne.part as PartKind]
      === PREFIX[kind]).length
    this.ask(pins[0], text => {
      const [ref = '', ...value] = text.split(/\s+/)
      this.add(part(this.convert, kind, pins, P, ref, value.join(' '), this.labelFont()))
    }, `${PREFIX[kind]}${n + 1} `)
  }

  /** Asks for a nomnoml diagram and puts it in the middle of the view, in ligne's line style. */
  private importNomnoml() {
    const box = document.createElement('div'), area = document.createElement('textarea')
    box.className = 'Island ligne-dialog'
    area.placeholder = '[Sensor] reads -> [<database> Log]\n[Sensor] -> [<choice> OK?]\n#direction: right'
    area.value = localStorage.getItem('ligne-nomnoml') ?? ''
    const go = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Insert (Ctrl-Enter)' })
    const no = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' })
    const end = (keep: boolean) => {
      box.remove()
      this.container()?.focus({ preventScroll: true })
      if (!keep || !area.value.trim()) return
      localStorage.setItem('ligne-nomnoml', area.value)
      const s = this.api.getAppState(), z = s.zoom.value
      const els = diagram(this.convert, area.value, [s.width / 2 / z - s.scrollX, s.height / 2 / z - s.scrollY], this.labelFont(),
        fromState(s), this.r)
      if (!els.length) return this.flash('nomnoml: no nodes found')
      this.add(els)
      this.flash(`nomnoml: ${els.filter(e => e.customData?.ligne?.kind === 'block').length} blocks`)
    }
    go.onclick = () => end(true); no.onclick = () => end(false)
    area.onkeydown = e => {
      e.stopPropagation()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) end(true)
      if (e.key === 'Escape') end(false)
    }
    const row = document.createElement('div')
    row.append(go, no)
    box.append(Object.assign(document.createElement('b'), { textContent: 'nomnoml' }), area, row)
    this.host.append(box)
    setTimeout(() => area.focus())
  }

  /** A small text box at scene point p; Enter (or leaving it) gives its text, Esc drops it. */
  private ask(p: XY, done: (text: string) => void, value = '', empty = false) {
    this.input?.remove()
    const i = this.input = document.createElement('input'), [x, y] = this.screen(p)
    i.className = 'ligne-input'
    i.placeholder = 'label'
    i.value = value
    Object.assign(i.style, { left: `${x}px`, top: `${y}px` })
    let over = false
    const end = (keep: boolean) => {
      if (over) return
      over = true
      i.remove()
      if (this.input === i) this.input = undefined
      if (keep && (empty || i.value.trim())) done(i.value.trim())
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
    this.pts = this.room(this.pts, this.meta, true).pts
    const keep = kept(this.pts, i => !!this.meta[i].fold)
    let pts = keep.map(i => this.pts[i]), meta = keep.map(i => this.meta[i])
    const closed = pts.length > 3 && same(pts[0], pts[pts.length - 1])
    if (pts.length < 2 || same(pts[0], pts[pts.length - 1]) && !closed) return this.reset()
    const ed = this.editing, base = ed && this.live().find(e => e.id === ed.id)
    // ending on a line (not a lane): a junction, as a branch starts on one
    const endHit = !closed && !meta.at(-1)!.link ? this.lines().find(l => l.el !== base
      && nearest(l.drawn, pts.at(-1)!).d < l.width / 2 + 1) : undefined
    // extended at its start: back to its own direction, so lines on its lanes keep their legs
    if (ed?.reversed) { pts = pts.reverse(); meta = meta.reverse() }
    if (ed?.reversed && isFlat(this.cable)) {
      // the part drawn before keeps the side it showed: the new start turns over if needed
      const J = Math.max(0, pts.length - ed.n), back = meta.slice(0, J + 1).filter(m => m.fold).length % 2 === 1
      if (back !== this.startBack) meta[0] = { ...meta[0], fold: !meta[0].fold }
    }
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
      cable: this.twist ? this.made(meta, d?.cable) : undefined, ticks: this.ticks, arrow: this.arrow, own: d?.own,
      grid: this.gridDirs() === 'iso' ? 'iso' : undefined, text: d?.text, ...this.endsSpec(),
      docks: this.docksOf(pts, d?.docks) }
    const els = lineEls(this.convert, spec, fromState(this.api.getAppState()), base)
    if (base) {
      const shift = ed.reversed ? pts.length - ed.n : 0
      if (shift) scene = scene.map(e => this.shiftLinks(e, lidOf(base), shift))
      scene = restack(this.convert, replace(scene, els), base.id)
    } else if (closed) {
      // a zone goes under the lines it crosses, else on top (not behind boards, images, frames)
      const box = (ps: XY[]) => [Math.min(...ps.map(p => p[0])), Math.min(...ps.map(p => p[1])),
        Math.max(...ps.map(p => p[0])), Math.max(...ps.map(p => p[1]))]
      const [x0, y0, x1, y1] = box(pts), k = scene.findIndex(e => {
        if (!isLine(e) || stale(e)) return false
        const [a0, b0, a1, b1] = box(pathOf(e))
        return a0 <= x1 && a1 >= x0 && b0 <= y1 && b1 >= y0
      })
      scene = k < 0 ? [...scene, ...els] : [...scene.slice(0, k), ...els, ...scene.slice(k)]
    } else if (this.joining && scene.some(e => e.id === this.joining!.el.id)) {
      // a line going on from another's end: under it (its sleeve covers the start); that end gets the joint
      const jn = this.joining, k = scene.findIndex(e => e.id === jn.el.id), parent = scene[k], ps = specOf(parent)
      scene = [...scene.slice(0, k), ...layered(els), ...scene.slice(k)]
      const was = ps.joints?.[jn.end], wide = Math.max(was?.w ?? 0, bodyWidth(els[0]), bodyWidth(parent))
      ps.joints = { ...ps.joints, [jn.end]: { kind: was?.kind ?? this.jointKind, w: wide } }
      if (ps.cable?.conn?.[jn.end]) ps.cable = { ...ps.cable, conn: { ...ps.cable.conn, [jn.end]: 'none' } }
      // room for the sleeve on the line that ends
      const [n0, n1] = needs(ps.path, ps.radii, ps.cable, ps.joints, bodyWidth(parent))
      ps.path = roomy(ps.path, jn.end === 'start' ? n0 : 0, jn.end === 'end' ? n1 : 0,
        i => !!ps.links?.[i] || !!ps.cable?.folds?.[i]).pts
      scene = restack(this.convert, replace(scene, lineEls(this.convert, ps, styleOf(parent), parent)), parent.id)
    } else scene = [...scene, ...layered(els)]
    const sp = this.split, parent = sp && scene.find(e => e.id === sp.el.id), pc = parent && cableOf(parent)
    if (sp && pc?.conn?.[sp.end] && pc.conn[sp.end] !== 'none') {
      // a split end has no connector of its own
      const s = specOf(parent)
      s.cable = { ...pc, conn: { ...pc.conn, [sp.end]: 'none' } }
      scene = replace(scene, lineEls(this.convert, s, styleOf(parent), parent))
    }
    this.put(scene, 'IMMEDIATELY')
    // the next new line in the next metro colour
    if (this.nextColor && !base && !this.from) {
      const now = this.api.getAppState().currentItemStrokeColor, i = METRO.findIndex(m => m.color === now)
      this.api.updateScene({ appState: { currentItemStrokeColor: METRO[(i + 1) % METRO.length].color } })
    }
    this.reset()
  }

  /** Y: the selected lines (else all) tidied, shown before it is kept (Enter, Y) or dropped (Esc):
   *  own bends at the radius most of them have, tiny jogs out, legs long enough for their arcs,
   *  room for connectors and joints. */
  private tidy() {
    const sel = this.selLines(), live = this.live()
    const scope = (sel.length ? live.filter(e => sel.includes(e.id)) : live).filter(e => isLine(e) && !stale(e))
    const own = (s: Spec, i: number) => i > 0 && i < s.path.length - 1 && !s.links?.[i] && !s.cable?.folds?.[i]
    const count = new Map<number, number>()
    for (const e of scope) { const s = specOf(e); s.radii.forEach((v, i) => own(s, i) && v > 0 && count.set(v, (count.get(v) ?? 0) + 1)) }
    const r = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? this.r
    let scene = this.api.getSceneElements().slice(), n = 0
    const before: XY[][] = []
    for (const e0 of scope) {
      const el = scene.find(e => e.id === e0.id)
      if (!el) continue
      const s = specOf(el), pinned = (i: number) => !!s.links?.[i] || !!s.cable?.folds?.[i]
      const radii = s.radii.map((v, i) => own(s, i) && v > 0 ? r : v)
      let pts = dropJogs(s.path, JOG / this.zoom(), pinned)
      pts = roomBends(pts, radii.map(v => bendOf(s.cable, v)), pinned)
      const [n0, n1] = needs(pts, radii, s.cable, s.joints, bodyWidth(el))
      pts = roomy(pts, n0, n1, pinned).pts
      const t = tidyAlong(pts, { radii, links: s.links, folds: s.cable?.folds })
      const same = t.pts.length === s.path.length && t.pts.every((q, i) => dist(q, s.path[i]) < 1e-6)
        && t.al.radii.every((v, i) => v === s.radii[i])
      if (same) continue
      before.push(centre(el))
      const sp: Spec = { ...s, r, path: t.pts, radii: t.al.radii, links: t.al.links,
        cable: s.cable && { ...s.cable, folds: t.al.folds } }
      scene = restack(this.convert, replace(scene, lineEls(this.convert, sp, styleOf(el), el)), el.id)
      n++
    }
    if (!n) return this.flash('tidy: nothing to change')
    this.tidying = { n, before }
    this.put(scene, 'EVENTUALLY')
    this.flash(`tidy: ${n} line${n > 1 ? 's' : ''} · Enter / Y keeps, Esc drops`)
    this.panelUI()
    this.draw()
  }

  /** The tidy on show kept (one undo step), or dropped. */
  private tidyEnd(keep: boolean) {
    if (keep) this.put(this.api.getSceneElements(), 'IMMEDIATELY')
    else if (this.base) { this.api.updateScene({ elements: this.base, captureUpdate: 'NEVER' }); this.base = undefined }
    this.tidying = undefined
    this.panelUI()
    this.draw()
  }

  /** Lines `ids` in colour c (their extras, stations and labels follow). */
  private recolor(ids: string[], c: string) {
    const set = new Set(ids)
    this.put(this.api.getSceneElements().map(e => set.has(e.id) ? bump(e, { strokeColor: c }) : e), 'IMMEDIATELY')
  }

  /** A colour picked from ligne's palette: the selected lines take it, and the lines drawn next. */
  private pickColor(c: string) {
    this.api.updateScene({ appState: { currentItemStrokeColor: c } })
    const ids = this.selLines()
    if (ids.length) this.recolor(ids, c)
    this.panelUI()
  }

  /** A finished line's ends and casing, from ligne's settings (the paper colour for both). */
  private endsSpec() {
    const none = this.ends.start === 'none' && this.ends.end === 'none'
    return { ends: none ? undefined : { ...this.ends }, casing: this.casing || undefined,
      paper: none && !this.casing ? undefined : this.api.getAppState().viewBackgroundColor ?? '#ffffff' }
  }

  /** Line ends or casing changed: for the line being drawn (on finish), else for the selected lines. */
  private finishing(patch: { ends?: { start: Cap, end: Cap }, casing?: number }, capture = 'IMMEDIATELY', ui = true) {
    Object.assign(this, patch)
    this.applySel(s => {
      if (s.kind !== 'line') return
      Object.assign(s, this.endsSpec())
    }, capture)
    this.save()
    if (ui) this.panelUI()
  }

  /** The cable of a line being finished: ligne's settings; an extended line keeps its legs and
   *  connectors, a split its wires; folds from the stops. */
  private made(meta: Meta[], had?: Cable): Cable {
    const folds = isFlat(this.cable) && meta.some(m => m.fold) ? meta.map(m => !!m.fold) : undefined
    const sp = this.split, conn = sp ? { start: 'none' as const, end: this.cable.conn?.end } : this.cable.conn
    return { ...this.cable, legs: had?.legs, conn: had?.conn ?? conn, pick: had?.pick ?? sp?.pick, folds }
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
    this.api.updateScene({ elements: [...all, ...legend(this.convert, at, this.labelFont(), [...rows.values()])],
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
    // let go: the focus goes back to the canvas, so keys go on working there
    input.onchange = () => { set(+input.value, 'IMMEDIATELY'); input.blur(); this.container()?.focus({ preventScroll: true }) }
    r.append(input, val)
    return r
  }

  private panelUI() {
    const mode = this.mode, A = this.actions, c = this.cable, ffc = c.style === 'ffc'
    const radius = this.range('Bend radius (0: sharp): the line being drawn, else the selected lines [ [ ] ]',
      0, 60, this.r, (v, cap) => this.radius(v, cap))
    const opt = <T>(label: string, vals: T[], now: T, set: (v: T) => void, text = (v: T) => String(v),
      more: (v: T) => Partial<Btn> = () => ({})): Item[] => vals.map(v => ({ title: `${label}: ${text(v)}`, text: text(v),
      on: v === now, click: () => set(v), ...more(v) }))
    const kind = this.twist ? c.style : 'plain'
    // wire colour sets; 'own': each wire's colour picked from the signal colours (Qwiic order to start)
    const base = this.api.getAppState().currentItemStrokeColor, cycle = SIGNAL_NAMES.map(n => SIGNALS[n])
    const own = (n: number) => ownColors(n, c.colors)
    const wireRows = (def: string): Menu['rows'] => [
      { label: 'Colours', items: opt('Wire colours', SETS, c.set ?? def as any, set => this.cabling(set === 'own'
        ? { set, colors: own(c.n) } : { set }), v => v, v => ({ swatch: swatch(v, base, own(c.n)) })) },
      ...(c.set === 'own' ? [{ label: 'Wires', items: own(Math.min(c.n, 16)).map((col, j) => ({
        title: `Wire ${j + 1}: ${SIGNAL_NAMES.find(n => SIGNALS[n] === col) ?? col} (click: next signal colour)`,
        swatch: [col], text: String(j + 1), click: () => {
          const all = own(c.n)
          all[j] = cycle[(cycle.indexOf(col) + 1) % cycle.length]
          this.cabling({ colors: all })
        } })) }] : [])]
    const types = ['plain', ...STYLES] as const
    // what the popover edits: the selected lines, else the lines drawn next
    const sel = this.selLines().length
    const target = Object.assign(document.createElement('span'), { className: 'ligne-for',
      textContent: sel ? `the ${sel} selected line${sel > 1 ? 's' : ''}` : 'the next line' })
    const rows: Menu['rows'] = [{ label: 'For', items: [target] }, { label: 'Body', items: types.map(k => ({ icon: k === 'plain' ? 'line' : k,
      title: k === 'plain' ? 'A plain line [W]' : `${k} [⇧W]`, on: k === kind,
      click: () => k === 'plain' ? (this.twist = false, this.cabling()) : this.restyle(k) })) }]
    if (this.twist && c.style === 'chevron') rows.push({ label: 'Width', items: [this.range('Band width', 6, 80, c.pitch,
      (v, cap) => this.cabling({ pitch: v }, cap, false))] })
    else if (this.twist && c.style === 'jacket') rows.push(
      { label: 'Wires', items: [this.range('Wires inside', 1, 12, c.n, (v, cap) => this.cabling({ n: v }, cap, false))] },
      { label: 'Across', items: opt('Jacket across', [2.5, 3, 4, 5, 6, 8], c.mm ?? 4, mm => this.cabling({ mm }),
        v => `${v} mm`) },
      ...wireRows('usb'),
      { label: 'Size', items: [...opt('True size ×', [1, 2, 4], c.scale ?? 2, scale => this.cabling({ scale }), v => `×${v}`),
        { icon: 'shield', text: 'shield', title: 'Shielded: braid under the jacket, shown where stripped', on: !!c.shield,
          click: () => this.cabling({ shield: !c.shield }) }] },
      ...([['Ends', CONNS.jacket.slice(0, 7)], ['Plugs', CONNS.jacket.slice(7)]] as const).map(([label, ks]) => ({ label,
        items: opt('Both ends [C; over an end: that end]', [...ks], c.conn?.end ?? 'none',
          k => this.cabling({ conn: { start: k, end: k } }), v => CONN_NAMES[v]) })))
    else if (this.twist && c.style === 'coax') rows.push(
      { label: 'Type', items: opt('Coax type (its usual colour)', COAX_KINDS, c.coax ?? 'rg316', k => {
        this.pickColor(COAX[k].color)
        this.cabling({ coax: k, mm: COAX[k].mm })
      }, v => `${COAX[v].name}`) },
      { label: 'Size', items: opt('True size ×', [1, 2, 4], c.scale ?? 2, scale => this.cabling({ scale }), v => `×${v}`) },
      ...([['Ends', CONNS.coax.slice(0, 6)], ['', CONNS.coax.slice(6)]] as const).map(([label, ks]) => ({ label,
        items: opt('Both ends [C; over an end: that end]', [...ks], c.conn?.end ?? 'none',
          k => this.cabling({ conn: { start: k, end: k } }), v => CONN_NAMES[v]) })))
    else if (this.twist && !isFlat(c)) {
      const f = c.fan ?? { gap: 12, len: 60 }, ends = f.start && f.end ? 'both' : f.start ? 'start' : f.end ? 'end' : 'off'
      rows.push(
        { label: 'Strands', items: opt('Strands', [2, 3, 4], c.n, n => this.cabling({ n })) },
        { label: 'Twist', items: [this.range('Twist / check length', 4, 80, c.pitch,
          (v, cap) => this.cabling({ pitch: v }, cap, false))] },
        { label: 'Fan out', items: opt('Strands fan out at 45°, then run side by side', ['off', 'start', 'end', 'both'], ends,
          v => this.cabling({ fan: { ...f, start: v === 'start' || v === 'both', end: v === 'end' || v === 'both' } })) },
        ...(ends === 'off' ? [] : [
          { label: 'Spread', items: [this.range('Fanned strands apart', 4, 60, f.gap,
            (v, cap) => this.cabling({ fan: { ...f, gap: v } }, cap, false))] },
          { label: 'Length', items: [this.range('Fanned length', 10, 240, f.len,
            (v, cap) => this.cabling({ fan: { ...f, len: v } }, cap, false))] }]))
    }
    if (this.flat()) rows.push(
      { label: 'Wires', items: [this.range('Wires', 1, 40, c.n, (v, cap) => this.cabling({ n: v }, cap, false))] },
      ffc ? { label: 'Pitch', items: opt('FFC pitch [E]', FFC_PITCH, c.mm ?? .5, mm => this.cabling({ mm }), v => `${v} mm`) }
        : { label: 'Gauge', items: opt('Silicone wire [E]', GAUGES, c.awg ?? 28, awg => this.cabling({ awg }),
          v => `${v} AWG`) },
      ...(ffc ? [] : wireRows('mono')),
      { label: 'Size', items: opt('True size ×', [1, 2, 4], c.scale ?? 1, scale => this.cabling({ scale }), v => `×${v}`) },
      { label: 'Ends', items: opt('Connector at both ends [C; over an end: that end]', CONNS[ffc ? 'ffc' : 'ribbon'],
        c.conn?.end ?? 'none', k => this.cabling({ conn: { start: k, end: k } }), v => CONN_NAMES[v]) },
      { label: 'Draw', items: [
        { icon: 'fold', text: 'fold', title: 'Fold at the next corner: the cable turns over', key: 'B', on: this.flip,
          click: A.b }] })
    const capNames: Record<Cap, string> = { none: 'none', bar: 'bar', dot: 'open dot', disc: 'disc' }
    const endRow = (end: 'start' | 'end') => opt(`${end === 'start' ? 'Start' : 'End'}`, ['none', 'bar', 'dot', 'disc'] as Cap[],
      this.ends[end], v => this.finishing({ ends: { ...this.ends, [end]: v } }), v => capNames[v],
      v => ({ icon: v === 'none' ? 'line' : 'cap-' + v, text: undefined }))
    const now = this.api.getAppState().currentItemStrokeColor
    const colors: Menu = { icon: 'palette', title: 'ligne colours: metro lines, signals by use', open: this.menu === 'colors',
      click: () => this.openMenu('colors'), swatch: [now], rows: [
        { label: 'For', items: [target.cloneNode(true) as HTMLElement] },
        { label: 'Metro', items: METRO.map(m => ({ title: m.name, swatch: [m.color], on: m.color === now,
          click: () => this.pickColor(m.color) })) },
        { label: 'Signal', items: SIGNAL_NAMES.map(n => ({ title: n, swatch: [SIGNALS[n]], text: n, on: SIGNALS[n] === now,
          click: () => this.pickColor(SIGNALS[n]) })) },
        { label: 'Auto', items: [
          { icon: 'netlabel', text: 'by net', title: 'A net label or flag on a line colours it by its name (SDA: data, SCL: clock, GND, 3V3, …)',
            on: this.byNet, click: () => { this.byNet = !this.byNet; this.save(); this.panelUI() } },
          { icon: 'line', text: 'next', title: 'Each new line takes the next metro colour', on: this.nextColor,
            click: () => { this.nextColor = !this.nextColor; this.save(); this.panelUI() } }] }] }
    const ends: Menu = { icon: 'cap-bar', title: 'Line ends (bar, open dot, disc) and casing', open: this.menu === 'ends',
      on: this.ends.start !== 'none' || this.ends.end !== 'none' || this.casing > 0, click: () => this.openMenu('ends'),
      rows: [{ label: 'For', items: [target.cloneNode(true) as HTMLElement] }, { label: 'Start', items: endRow('start') },
        { label: 'End', items: endRow('end') },
        { label: 'Joint', items: opt('Joint where a line goes on from another (J): the selected lines\' joints too', JOINTS,
          this.jointKind, k => {
            this.jointKind = k
            this.applySel(s => {
              for (const e of ['start', 'end'] as const) if (s.joints?.[e]) s.joints = { ...s.joints, [e]: { ...s.joints[e]!, kind: k } }
            }, 'IMMEDIATELY')
            this.save(); this.panelUI()
          }, v => JOINT_NAMES[v]) },
        { label: 'Casing', items: [this.range('Casing: a band of the paper colour either side, under the line (gaps where lines cross)',
          0, 8, this.casing, (v, cap) => this.finishing({ casing: v }, cap, false))] }] }
    const cable: Menu = { icon: this.twist ? c.style : 'twist', title: 'Line body: plain, cable, chevron band', key: 'W',
      on: this.twist, open: this.menu === 'cable', rows, click: () => this.openMenu('cable') }
    const font: Menu = { icon: 'font', title: 'Label font and size', open: this.menu === 'font',
      click: () => this.openMenu('font'), rows: [
        { label: 'Font', items: opt('Font', Object.keys(FONTS) as (keyof typeof FONTS)[], this.font,
          f => { this.font = f; this.save(); this.panelUI() }) },
        { label: 'Size', items: opt('Size', SIZES, this.size, v => { this.size = v; this.save(); this.panelUI() }) }] }
    const sheets: Menu = { icon: 'sheets', title: 'Sheets, legend, export', open: this.menu === 'sheets',
      click: () => this.openMenu('sheets'), rows: [
        { label: 'Sheet', items: [{ icon: 'paper', title: 'A5 sheet', key: 'P', text: 'A5', click: A.p },
          { icon: 'paper', title: 'A6 sheet', key: '⇧P', text: 'A6', click: A.P },
          { icon: 'landscape', title: 'Sheets in landscape', key: 'O', on: this.landscape, click: A.o }] },
        { label: 'Legend', items: [{ icon: 'legend', title: 'Legend (again: rebuild)', key: 'K', click: A.k }] },
        { label: 'Import', items: [{ icon: 'b-process', text: 'nomnoml', title: 'A nomnoml diagram: its nodes as blocks, its links as lines',
          click: () => { this.openMenu(); this.importNomnoml() } }] },
        { label: 'Copy', items: [{ icon: 'svg', text: 'SVG', title: 'Copy the selection (else all) as SVG', key: '⇧C',
          click: A.C }, { icon: 'copy', text: 'graph', title: 'Copy the graph as text: lines, stations, labels',
          click: () => this.copy() }] }] }
    const dirs: Btn[] = (['flat', 'along', 'across'] as const).map(d => ({ icon: 'dir-' + d, on: this.labelDir === d,
      title: { flat: 'Labels read level', along: 'Labels read along the line (45° on diagonals, 90° on verticals)',
        across: 'Labels read across the line' }[d], click: () => { this.labelDir = d; this.save(); this.panelUI() } }))
    const grid: Btn = { icon: this.gridMode === 'iso' ? 'iso' : 'grid', key: 'G', on: this.gridMode !== 'off',
      title: `Grid: ${this.gridMode} (off, square, isometric)`, click: A.g }
    const items: Item[] = [
      { icon: 'select', title: 'Select (Excalidraw\'s selection, ligne stays on; Esc too)', key: 'V', on: mode === 'select',
        click: () => this.setMode('select') },
      { icon: 'line', title: 'Lines', key: 'L', on: mode === 'line', click: () => this.setMode('line') },
      { icon: 'station', title: 'Stations', key: 'S', on: mode === 'station', click: () => this.setMode('station') },
      { icon: 'label', title: 'Labels', key: 'T', on: mode === 'label', click: () => this.setMode('label') },
      { icon: 'board', title: 'Perfboard and parts', key: 'X', on: mode === 'board', click: () => this.setMode('board') },
      { icon: 'b-process', title: 'Blocks: flowchart shapes, folder, table, text, icon; lines dock on their sides', key: 'Q',
        on: mode === 'block', click: () => this.setMode('block') },
      'sep',
      ...(mode === 'line' ? [
        { icon: 'free', title: 'Free legs, along the grid\'s directions (or hold Shift)', key: '⇧', on: this.free,
          click: () => this.toggle('free') },
        { icon: 'magnet', title: 'Snap: lines, lanes, guides, holes (hold Ctrl/Cmd: off)', key: 'N', on: this.snap,
          click: A.n },
        grid,
        { icon: 'bend', title: 'Bend the other way (the other leg first)', key: this.flat() ? '⇧B' : 'B', on: this.bend,
          click: A.B }, radius,
        this.range('Lane gap: a line beside another, set a little further out [- =]', 0, 40, this.spread,
          v => { this.spread = v; this.save() }),
        'sep' as const,
        { icon: 'arrow', title: 'Arrowheads (Excalidraw\'s arrow style)', key: 'A', on: this.arrow, click: A.a },
        { icon: 'ticks', title: 'Direction chevrons, the way the line was drawn', key: 'D', on: this.ticks, click: A.d },
        colors, cable, ends,
        { icon: 'tidy', title: 'Tidy the selected lines (else all): even bends, tiny jogs out, room for arcs and connectors; shown first, Enter keeps, Esc drops',
          key: 'Y', on: !!this.tidying, click: A.y },
        { icon: 'joint', title: `Join: start on a line's end, the new line goes on from it under a ${JOINT_NAMES[this.jointKind]} (kind: ends popover)`,
          key: 'J', on: this.joinMode, click: A.j },
        { icon: 'linetext', title: 'Text along a line, repeated: the label tool\'s "along"', key: '⇧T', click: A.T },
        'sep' as const,
        { icon: 'finish', title: 'End the line', key: '⏎', click: A.Enter },
        { icon: 'undo', title: 'Undo a stop', key: '⌫', click: A.Backspace },
        { icon: 'cancel', title: 'Cancel the line', key: 'Esc', click: () => this.reset() },
      ] : mode === 'station' ? [
        ...Object.entries(SHAPES).map(([k, v]) => ({ icon: v, title: v[0].toUpperCase() + v.slice(1), key: k,
          on: this.shape === v, click: () => { this.shape = v; this.panelUI() } })),
        { icon: 'boxed', title: 'Labels in a box', key: 'B', on: this.boxed, click: A.b },
        'sep' as const, ...dirs,
      ] : mode === 'label' ? [
        ...LABELS.map((t, i) => ({ icon: { text: 'text', box: 'box', round: 'rounded', net: 'netlabel', flag: 'flag',
          along: 'linetext', pill: 'pill' }[t],
          title: { text: 'Text', box: 'Box', round: 'Rounded box', net: 'Net label (KiCad local): on the wire',
            flag: 'Flag (KiCad global label): at a line end, pointing away',
            along: 'Along the line: click a line, its text repeats along it (empty: none)',
            pill: 'Pill: a capsule in the line colour (F: outlined)' }[t], key: String(i + 1),
          on: this.labelType === t, click: () => { this.digit(i + 1); this.panelUI() } })),
        'sep' as const,
        { icon: 'boxed', title: this.onLine ? 'On the line (click: beside it)' : 'Beside the line (click: on it)',
          key: 'B', on: this.onLine, click: A.b },
        { icon: 'solid', title: 'Solid: filled with the line colour', key: 'F', on: this.solid, click: A.f },
        ...dirs, font, grid,
      ] : mode === 'board' ? [
        ...PARTS.map((k, i) => ({ icon: k, title: PART_NAMES[k][0].toUpperCase() + PART_NAMES[k].slice(1),
          key: String((i + 1) % 10),
          on: this.partKind === k, click: () => { this.digit(i + 1); this.panelUI() } })),
        'sep' as const,
        ...opt('Perfboard: 2.54 mm true size ×', [1, 2, 4], this.scale, v => { this.scale = v; this.save(); this.panelUI() },
          v => `×${v}`),
        font,
      ] : mode === 'block' ? [
        ...BLOCKS.map((k, i) => ({ icon: 'b-' + k, title: `${k[0].toUpperCase() + k.slice(1)}: click (its size) or drag a box`,
          key: String((i + 1) % 10), on: this.blockKind === k, click: () => { this.digit(i + 1); this.panelUI() } })),
        'sep' as const, colors, font,
      ] : [colors, cable, ends, { icon: 'tidy', title: 'Tidy the selected lines (else all); Enter keeps, Esc drops', key: 'Y',
          on: !!this.tidying, click: A.y }, { icon: 'rotate', title: 'Turn the selection 90° (⇧R: 45°); parts about pin 1', key: 'R', click: A.r },
        { icon: 'gap', title: 'Move the selected lines out on their lanes (- in)', key: '=', click: A['='] }]),
      { icon: 'pick', title: 'Take a line\'s style (or Alt-click)', key: 'I', on: this.picking, click: A.i },
      'sep', sheets,
      { icon: 'svg', title: 'Copy the selection (else all) as SVG', key: '⇧C', click: A.C },
      { icon: 'help', title: 'Help', key: '?', on: this.help, click: A['?'] },
    ]
    this.panel.render(this.active, items, this.help ? HELP : undefined)
  }

  /** Opens a popover of the panel (or closes it, when open). */
  private openMenu(m?: string) {
    this.menu = m && this.menu !== m ? m : undefined
    this.panelUI()
  }
}
