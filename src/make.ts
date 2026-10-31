// Excalidraw element skeletons ligne adds: station marks with labels, net flags, legend, paper frames.
// Everything goes through the host's convertToExcalidrawElements, then text ids are shortened.
import type { XY } from './core/geom.ts'
import type { LabelData, Shape, StationData } from './core/graph.ts'

/** Excalidraw's convertToExcalidrawElements, from whichever bundle the host ships. */
export type Convert = (skeletons: any[]) => any[]

/** The element props ligne takes from Excalidraw's current item style. */
export type Style = Record<(typeof STYLE)[number], any>
export const STYLE = ['strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle',
  'roughness', 'opacity', 'startArrowhead', 'endArrowhead'] as const
const cap = (k: string) => k[0].toUpperCase() + k.slice(1)
export const fromState = (s: any) => Object.fromEntries(STYLE.map(k => [k, s['currentItem' + cap(k)]])) as Style
export const toState = (st: Partial<Style>) =>
  Object.fromEntries(Object.entries(st).map(([k, v]) => ['currentItem' + cap(k), v]))
export const styleOf = (e: any) => Object.fromEntries(STYLE.map(k => [k, e[k]])) as Style

/** Label font: Excalidraw's current one (family, size), dark text. */
export interface Font { fontFamily: number, fontSize: number }
export const fontOf = (s: any): Font => ({ fontFamily: s.currentItemFontFamily, fontSize: s.currentItemFontSize })
const ink = (f: Font) => ({ ...f, strokeColor: '#1e1e1e' })
const ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const shortId = () => Array.from({ length: 8 }, () => ID[Math.random() * ID.length | 0]).join('')
export const groupId = () => Math.random().toString(36).slice(2, 10)

/** New element version, so Excalidraw's history and sync see the change. */
export const bump = (e: any, patch: object = {}) =>
  ({ ...e, ...patch, version: e.version + 1, versionNonce: Math.random() * 2 ** 31 | 0, updated: Date.now() })

/** Text elements get 8-char ids: the Obsidian Excalidraw plugin renames longer ones on save,
 *  and undo then misses the renamed text (it stayed on the canvas). */
function shortTextIds(els: any[]) {
  const ids = new Map(els.filter(e => e.type === 'text').map(e => [e.id, shortId()]))
  const re = (id: string) => ids.get(id) ?? id
  return els.map(e => ({ ...e, id: re(e.id), containerId: e.containerId && re(e.containerId),
    boundElements: e.boundElements?.map((b: any) => ({ ...b, id: re(b.id) })) ?? null }))
}
export const make = (convert: Convert, skeletons: any[]) => shortTextIds(convert(skeletons))

/** Station mark: diameter, outline, filled with the line colour. */
export const DOT: Record<Exclude<Shape, 'net'>, { d: number, w: number, fill: boolean }> = {
  stop: { d: 12, w: 2, fill: false }, interchange: { d: 20, w: 3, fill: false }, commit: { d: 14, w: 2, fill: true },
}

/** A station at `at` on `line`, grouped with its label: plain or boxed text beside a dot, or a net
 *  flag (KiCad global label) starting at `at` and pointing to `dir` (+1 right, -1 left). */
export function station(convert: Convert, o: { at: XY, shape: Shape, color: string, text: string,
  font: Font, line?: string, boxed?: boolean, dir?: 1 | -1 }): any[] {
  const g = groupId(), data: StationData = { kind: 'station', line: o.line, shape: o.shape }
  const [x, y] = o.at, tag = { groupIds: [g], customData: { ligne: data } }
  if (o.shape === 'net') {
    const [t] = make(convert, [{ type: 'text', x: 0, y: 0, text: o.text, ...ink(o.font) }])
    const dir = o.dir ?? 1, h = t.height + 8, len = t.width + 12 + h / 2
    const pts: XY[] = [[0, 0], [0, -h / 2], [len - h / 2, -h / 2], [len, 0], [len - h / 2, h / 2], [0, h / 2], [0, 0]]
    const flag = make(convert, [{ type: 'line', x, y, points: pts.map(([px, py]) => [px * dir, py]),
      strokeColor: o.color, backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 2, roughness: 0,
      roundness: null, ...tag }])
    return [...flag, { ...t, x: dir > 0 ? x + 6 : x - 6 - t.width, y: y - t.height / 2, groupIds: [g] }]
  }
  const dot = DOT[o.shape], r = dot.d / 2
  const mark = { type: 'ellipse', x: x - r, y: y - r, width: dot.d, height: dot.d, strokeColor: o.color,
    backgroundColor: dot.fill ? o.color : '#ffffff', fillStyle: 'solid', strokeWidth: dot.w, roughness: 0, ...tag }
  const label = o.boxed
    ? { type: 'rectangle', x: x + dot.d, y: y - dot.d - 36, strokeColor: o.color, backgroundColor: '#ffffff',
      fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: { type: 3 }, groupIds: [g],
      label: { text: o.text, ...ink(o.font) } }
    : { type: 'text', x: x + dot.d, y: y - dot.d - o.font.fontSize * 1.25, text: o.text, ...ink(o.font), groupIds: [g] }
  const els = make(convert, [mark, label])
  return els.map(e => ({ ...e, groupIds: [g] }))         // bound text too
}

/** Label types: plain text (on a line: knocked out), a box, a rounded box, KiCad's net label
 *  (text on the wire) and global label (a flag pointing away); `along`: text repeated along a line,
 *  part of the line (lines.ts). */
export type LabelType = 'text' | 'box' | 'round' | 'net' | 'flag' | 'along'
export const LABELS: LabelType[] = ['text', 'box', 'round', 'net', 'flag', 'along']
/** Excalidraw font families ligne offers: Cascadia (mono), Liberation Sans, Excalifont (hand). */
export const FONTS = { mono: 3, sans: 9, hand: 5 } as const
export const SIZES = [12, 16, 20, 28]

/** els turned by angle a about point c, as Excalidraw turns a group: centres move, angles add. */
export function turned(els: any[], c: XY, a: number): any[] {
  const cos = Math.cos(a), sin = Math.sin(a)
  return els.map(e => {
    // the middle Excalidraw turns an element about: of its points' box, for lines
    const xs = e.points?.map((p: XY) => p[0]) ?? [0, e.width], ys = e.points?.map((p: XY) => p[1]) ?? [0, e.height]
    const m: XY = [e.x + (Math.min(...xs) + Math.max(...xs)) / 2, e.y + (Math.min(...ys) + Math.max(...ys)) / 2]
    const mx = m[0] - c[0], my = m[1] - c[1]
    const dx = c[0] + mx * cos - my * sin - m[0], dy = c[1] + mx * sin + my * cos - m[1]
    return { ...e, x: e.x + dx, y: e.y + dy, angle: (((e.angle ?? 0) + a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) }
  })
}

/** els moved so that the middle of el `m` lands on c. */
const centred = (els: any[], m: any, c: XY) => {
  const dx = c[0] - (m.x + m.width / 2), dy = c[1] - (m.y + m.height / 2)
  return els.map(e => ({ ...e, x: e.x + dx, y: e.y + dy }))
}

/** A label at `at`, turned to read along `angle`, grouped, its text last. On a line (`line`) a text
 *  label is knocked out of it (`on`) or set beside it, `off` from its centre; boxes sit on it or
 *  beside it; a net label sits on the wire from `at`; a flag starts at `at` and points away (`dir`).
 *  `solid`: boxes filled with the colour, the text in the paper colour. Boxes are Excalidraw
 *  containers, so double-click edits the text, and Excalidraw turns and moves them as one. */
export function label(convert: Convert, o: { type: LabelType, at: XY, angle: number, text: string, font: Font,
  color: string, paper: string, line?: string, on: boolean, off: number, solid?: boolean, dir?: 1 | -1 }): any[] {
  const g = groupId(), data: LabelData = { kind: 'label', line: o.line, on: o.on, type: o.type }
  const tag = { groupIds: [g], customData: { ligne: data } }, n: XY = [Math.sin(o.angle), -Math.cos(o.angle)]
  const fg = o.solid ? o.paper : o.type === 'text' ? o.color : '#1e1e1e'
  const [t] = make(convert, [{ type: 'text', x: 0, y: 0, text: o.text, ...o.font, strokeColor: fg }])
  const lift = (k: number): XY => [o.at[0] + n[0] * k, o.at[1] + n[1] * k]
  let els: any[], c: XY
  if (o.type === 'text' || o.type === 'net') {
    // net: from the point, a hair above the wire
    const k = o.type === 'net' ? o.off + t.height / 2 + 1 : o.on && o.line ? 0 : o.line ? o.off + t.height / 2 + 2 : 0
    c = lift(k)
    if (o.type === 'net') c = [c[0] + Math.cos(o.angle) * t.width / 2, c[1] + Math.sin(o.angle) * t.width / 2]
    els = [{ ...t, ...tag }]
    if (o.type === 'text' && o.on && o.line) {
      // the knockout only breaks the line itself (off: half its width), not its neighbours
      const pw = t.width + t.height * 0.6, ph = Math.min(t.height + 2, 2 * o.off + 2)
      const [knock] = convert([{ type: 'rectangle', x: 0, y: 0, width: pw, height: ph, strokeColor: 'transparent',
        backgroundColor: o.paper, fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: { type: 3 }, ...tag }])
      els = [...centred([knock], knock, c), ...centred(els, t, c)]
      return turned(els, c, o.angle)
    }
    return turned(centred(els, t, c), c, o.angle)
  }
  if (o.type === 'flag') {
    const dir = o.dir ?? 1, h = t.height + 6, len = t.width + 10 + h / 2
    const pts: XY[] = [[0, 0], [h / 2, -h / 2], [len, -h / 2], [len, h / 2], [h / 2, h / 2], [0, 0]]
    const [flag] = make(convert, [{ type: 'line', x: o.at[0], y: o.at[1], points: pts.map(([px, py]) => [px * dir, py]),
      strokeColor: o.color, backgroundColor: o.solid ? o.color : o.paper, fillStyle: 'solid', strokeWidth: 1.5,
      roughness: 0, roundness: null, ...tag }])
    c = [o.at[0] + dir * (h / 2 + len) / 2, o.at[1]]
    return turned([flag, ...centred([{ ...t, ...tag }], t, c)], o.at, o.angle)
  }
  const els2 = make(convert, [{ type: 'rectangle', x: 0, y: 0, strokeColor: o.color,
    backgroundColor: o.solid ? o.color : o.paper, fillStyle: 'solid', strokeWidth: 1.5, roughness: 0,
    roundness: o.type === 'round' ? { type: 3 } : null, ...tag,
    label: { text: o.text, ...o.font, strokeColor: fg } }]).map(e => ({ ...e, ...tag }))
  const box = els2[0]
  c = o.on || !o.line ? o.at : lift(o.off + box.height / 2 + 2)
  return turned(centred(els2, box, c), c, o.angle)
}

/** Legend: one row per line style (a sample and its name), framed, all grouped.
 *  `rows`: style key, the style, the name to show. */
export function legend(convert: Convert, at: XY, font: Font,
  rows: { key: string, style: Style, name: string }[]): any[] {
  const g = groupId(), [x, y] = at, pad = 12, rowH = font.fontSize * 1.75
  const skel = rows.flatMap((r, i) => {
    const row = groupId(), cy = y + pad + rowH * i + rowH / 2
    return [
      { type: 'line', x: x + pad, y: cy, points: [[0, 0], [48, 0]], ...r.style, roundness: null,
        startArrowhead: null, endArrowhead: null,
        groupIds: [row, g], customData: { ligne: { kind: 'legend', key: r.key } } },
      { type: 'text', x: x + pad + 60, y: cy - font.fontSize * 0.625, text: r.name, ...ink(font), groupIds: [row, g] },
    ]
  })
  const els = make(convert, skel)
  const w = Math.max(...els.filter(e => e.type === 'text').map(e => e.x + e.width)) - x + pad
  const [box] = make(convert, [{ type: 'rectangle', x, y, width: w, height: pad * 2 + rowH * rows.length,
    strokeColor: '#1e1e1e', backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 1, roughness: 0,
    roundness: { type: 3 }, groupIds: [g], customData: { ligne: { kind: 'legend' } } }])
  return [box, ...els]
}

/** Paper sizes in mm, portrait. */
export const PAPER = { A5: [148, 210], A6: [105, 148] } as const
const MM = 96 / 25.4                                       // px per mm at Excalidraw's 96 dpi

/** A frame of a paper sheet centred on `at`, true to size at 96 dpi, for plotting. */
export function paper(convert: Convert, at: XY, size: keyof typeof PAPER, landscape = false): any[] {
  const [a, b] = PAPER[size], mm = landscape ? [b, a] : [a, b], [w, h] = mm.map(v => v * MM)
  return convert([{ type: 'frame', x: at[0] - w / 2, y: at[1] - h / 2, width: w, height: h, children: [],
    name: `${size}${landscape ? ' landscape' : ''}`, customData: { ligne: { kind: 'paper', size, mm } } }])
}
