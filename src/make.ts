// Excalidraw element skeletons ligne adds: station marks with labels, net flags, legend, paper frames.
// Everything goes through the host's convertToExcalidrawElements, then text ids are shortened.
import type { XY } from './core/geom.ts'
import { inner, outline, type BlockData, type BlockKind } from './core/block.ts'
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
  font: Font, line?: string, boxed?: boolean, dir?: 1 | -1, angle?: number, away?: XY, off?: number,
  span?: [XY, XY], thick?: number }): any[] {
  const g = groupId(), data: StationData = { kind: 'station', line: o.line, shape: o.shape, ...(o.span ? { span: true } : {}) }
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
  if (o.span) {
    // an interchange across a stack (or between stacks): a white capsule with a dark outline
    const [a, b] = o.span, T = o.thick ?? 16, pts = capsule(a, b, T / 2)
    const [m] = make(convert, [{ type: 'line', x: pts[0][0], y: pts[0][1], points: pts.map(p => [p[0] - pts[0][0], p[1] - pts[0][1]]),
      strokeColor: '#1e1e1e', backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: Math.max(2, T / 6), roughness: 0,
      roundness: null, ...tag }])
    const lab = o.away ? label(convert, { type: o.boxed ? 'round' : 'text', at: o.at, angle: o.angle ?? 0, text: o.text,
      font: o.font, color: o.boxed ? o.color : '#1e1e1e', paper: '#ffffff', line: '-', on: false, off: (o.off ?? 0) + 2,
      away: o.away }) : []
    return [{ ...m, groupIds: [g] }, ...lab.map(e => ({ ...e, groupIds: [g], customData: undefined }))]
  }
  const dot = DOT[o.shape], r = dot.d / 2
  const mark = { type: 'ellipse', x: x - r, y: y - r, width: dot.d, height: dot.d, strokeColor: o.color,
    backgroundColor: dot.fill ? o.color : '#ffffff', fillStyle: 'solid', strokeWidth: dot.w, roughness: 0, ...tag }
  if (o.away) {
    // beside its line, off the stack's edge, read level, along or across it
    const lab = label(convert, { type: o.boxed ? 'round' : 'text', at: o.at, angle: o.angle ?? 0, text: o.text, font: o.font,
      color: o.boxed ? o.color : '#1e1e1e', paper: '#ffffff', line: o.line ?? '-', on: false,
      off: Math.max(o.off ?? 0, r) + 2, away: o.away })
    const [m] = make(convert, [mark])
    return [{ ...m, groupIds: [g] }, ...lab.map(e => ({ ...e, groupIds: [g], customData: undefined }))]
  }
  const text = o.boxed
    ? { type: 'rectangle', x: x + dot.d, y: y - dot.d - 36, strokeColor: o.color, backgroundColor: '#ffffff',
      fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: { type: 3 }, groupIds: [g],
      label: { text: o.text, ...ink(o.font) } }
    : { type: 'text', x: x + dot.d, y: y - dot.d - o.font.fontSize * 1.25, text: o.text, ...ink(o.font), groupIds: [g] }
  const els = make(convert, [mark, text])
  return els.map(e => ({ ...e, groupIds: [g] }))         // bound text too
}

/** A capsule round the segment a – b, r its radius: a closed outline. */
export function capsule(a: XY, b: XY, r: number): XY[] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = d > 1e-9 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0, pts: XY[] = []
  for (const [c, a0] of [[b, ang - Math.PI / 2], [a, ang + Math.PI / 2]] as const)
    for (let i = 0; i <= 10; i++) { const t = a0 + Math.PI * i / 10; pts.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]) }
  return [...pts, pts[0]]
}

/** Label types: plain text (on a line: knocked out), a box, a rounded box, KiCad's net label
 *  (text on the wire) and global label (a flag pointing away); `along`: text repeated along a line,
 *  part of the line (lines.ts). */
export type LabelType = 'text' | 'box' | 'round' | 'net' | 'flag' | 'along' | 'pill'
export const LABELS: LabelType[] = ['text', 'box', 'round', 'net', 'flag', 'along', 'pill']
/** How labels read: level, along the line (45° on diagonals, 90° on verticals), across it. */
export type LabelDir = 'flat' | 'along' | 'across'
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
  color: string, paper: string, line?: string, on: boolean, off: number, solid?: boolean, dir?: 1 | -1, away?: XY }): any[] {
  const g = groupId(), data: LabelData = { kind: 'label', line: o.line, on: o.on, type: o.type }
  // beside a line it goes off `away` (default: up from its baseline), by its own extent that way
  const tag = { groupIds: [g], customData: { ligne: data } }, n: XY = o.away ?? [Math.sin(o.angle), -Math.cos(o.angle)]
  const ext = (w: number, h: number) => Math.abs(n[0] * Math.cos(o.angle) + n[1] * Math.sin(o.angle)) * w / 2
    + Math.abs(-n[0] * Math.sin(o.angle) + n[1] * Math.cos(o.angle)) * h / 2
  const fg = o.solid || o.type === 'pill' && o.solid !== false ? o.paper : o.type === 'text' ? o.color : '#1e1e1e'
  const [t] = make(convert, [{ type: 'text', x: 0, y: 0, text: o.text, ...o.font, strokeColor: fg }])
  const lift = (k: number): XY => [o.at[0] + n[0] * k, o.at[1] + n[1] * k]
  let els: any[], c: XY
  if (o.type === 'text' || o.type === 'net') {
    // net: from the point, a hair above the wire
    const k = o.type === 'net' ? o.off + t.height / 2 + 1 : o.on && o.line ? 0 : o.line ? o.off + ext(t.width, t.height) + 2 : 0
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
  if (o.type === 'pill') {
    // a capsule: round ends, filled with the line colour (outlined when not solid), the text inside
    const h = t.height + 8, w = t.width + h * .8, r = h / 2, pts: XY[] = []
    for (const [cx, a0] of [[w / 2 - r, -Math.PI / 2], [-w / 2 + r, Math.PI / 2]] as const)
      for (let i = 0; i <= 8; i++) { const a = a0 + Math.PI * i / 8; pts.push([cx + Math.cos(a) * r, Math.sin(a) * r]) }
    pts.push(pts[0])
    c = o.on || !o.line ? o.at : lift(o.off + ext(w, h) + 2)
    const fill = o.solid === false ? o.paper : o.color
    const [pill] = make(convert, [{ type: 'line', x: c[0] + pts[0][0], y: c[1] + pts[0][1],
      points: pts.map(([px, py]) => [px - pts[0][0], py - pts[0][1]]), strokeColor: o.color, backgroundColor: fill,
      fillStyle: 'solid', strokeWidth: 1.5, roughness: 0, roundness: null, ...tag }])
    return turned([pill, ...centred([{ ...t, ...tag, strokeColor: o.solid === false ? o.color : o.paper }], t, c)], c, o.angle)
  }
  const els2 = make(convert, [{ type: 'rectangle', x: 0, y: 0, strokeColor: o.color,
    backgroundColor: o.solid ? o.color : o.paper, fillStyle: 'solid', strokeWidth: 1.5, roughness: 0,
    roundness: o.type === 'round' ? { type: 3 } : null, ...tag,
    label: { text: o.text, ...o.font, strokeColor: fg } }]).map(e => ({ ...e, ...tag }))
  const box = els2[0]
  c = o.on || !o.line ? o.at : lift(o.off + ext(box.width, box.height) + 2)
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

/** A block in box x, y, w, h: its shape (customData: kind block, its id) and its text, grouped.
 *  Process, decision and icon are Excalidraw containers (double-click edits the text); the other
 *  shapes are one outline with the text over it; a table is a grid with its title in the top row. */
export function block(convert: Convert, o: { kind: BlockKind, box: [number, number, number, number], text: string,
  color: string, font: Font, rows?: number, cols?: number, parts?: string[] }): any[] {
  const g = groupId(), [x, y, w, h] = o.box, bid = shortId()
  const data: BlockData = { kind: 'block', shape: o.kind, bid, ...(o.kind === 'table' ? { rows: o.rows ?? 3, cols: o.cols ?? 2 } : {}) }
  const look = { strokeColor: o.color, backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 2, roughness: 0 }
  const tag = { groupIds: [g], customData: { ligne: data } }, ink = { ...o.font, strokeColor: '#1e1e1e' }
  const text = (t: string, cx: number, cy: number) => {
    const [e] = make(convert, [{ type: 'text', x: 0, y: 0, text: t, ...ink, textAlign: 'center' }])
    return { ...e, x: cx - e.width / 2, y: cy - e.height / 2, groupIds: [g] }
  }
  if (o.kind === 'text') {
    const t = text(o.text || 'text', x + w / 2, y + h / 2)
    return [{ ...t, ...tag }]
  }
  if (o.kind === 'process' || o.kind === 'decision' || o.kind === 'icon') {
    const type = o.kind === 'process' ? 'rectangle' : o.kind === 'decision' ? 'diamond' : 'ellipse'
    const els = make(convert, [{ type, x, y, width: w, height: h, ...look, roundness: o.kind === 'process' ? { type: 3 } : null,
      ...tag, label: { text: o.text, ...ink, ...(o.kind === 'icon' ? { fontSize: Math.round(h * .45) } : {}) } }])
    return els.map(e => ({ ...e, groupIds: [g] }))
  }
  if (o.kind === 'table' && o.parts) {
    // compartments (nomnoml): the title in the head, then one row per compartment, its lines left
    const [frame] = make(convert, [{ type: 'rectangle', x, y, width: w, height: h, ...look, roundness: null,
      ...tag, customData: { ligne: { ...data, rows: o.parts.length + 1, cols: 1 } } }])
    const tx = (t: string) => make(convert, [{ type: 'text', x: 0, y: 0, text: t, ...ink }])[0]
    const head = tx(o.text), hh = head.height + 12, out: any[] = [frame]
    out.push(...make(convert, [{ type: 'rectangle', x, y, width: w, height: hh, ...look, backgroundColor: mix(o.color),
      roundness: null, groupIds: [g] }]), { ...head, x: x + w / 2 - head.width / 2, y: y + 6, groupIds: [g] })
    let cy = y + hh
    for (const part of o.parts) {
      const t = tx(part)
      out.push(make(convert, [{ type: 'line', x, y: cy, points: [[0, 0], [w, 0]], strokeColor: o.color, strokeWidth: 1,
        roughness: 0, roundness: null, groupIds: [g] }])[0], { ...t, x: x + 8, y: cy + 6, groupIds: [g] })
      cy += t.height + 12
    }
    return out
  }
  if (o.kind === 'table') {
    const rows = o.rows ?? 3, cols = o.cols ?? 2
    const [frame] = make(convert, [{ type: 'rectangle', x, y, width: w, height: h, ...look, roundness: null, ...tag }])
    const [head] = make(convert, [{ type: 'rectangle', x, y, width: w, height: h / rows, ...look, backgroundColor: mix(o.color),
      roundness: null, groupIds: [g] }])
    const lines = inner('table', w, h, rows, cols).map(l => make(convert, [{ type: 'line', x: x + l[0][0], y: y + l[0][1],
      points: l.map(p => [p[0] - l[0][0], p[1] - l[0][1]]), strokeColor: o.color, strokeWidth: 1, roughness: 0,
      roundness: null, groupIds: [g] }])[0])
    return [frame, head, ...lines, text(o.text, x + w / 2, y + h / rows / 2)]
  }
  const pts = outline(o.kind, w, h)!, extra = inner(o.kind, w, h)
  const [shape] = make(convert, [{ type: 'line', x: x + pts[0][0], y: y + pts[0][1], points: pts.map(p => [p[0] - pts[0][0],
    p[1] - pts[0][1]]), ...look, roundness: null, ...tag }])
  const more = extra.map(l => make(convert, [{ type: 'line', x: x + l[0][0], y: y + l[0][1],
    points: l.map(p => [p[0] - l[0][0], p[1] - l[0][1]]), strokeColor: o.color, strokeWidth: 2, roughness: 0,
    roundness: null, groupIds: [g] }])[0])
  // the text in the body: below a database's lid, below a folder's tab
  const cy = o.kind === 'database' ? y + h * .55 : o.kind === 'folder' ? y + h * .58 : o.kind === 'document' ? y + h * .44 : y + h / 2
  return [shape, ...more, ...(o.text ? [text(o.text, x + w / 2, cy)] : [])]
}

/** A light tint of a #rrggbb colour (table headers). */
const mix = (c: string) => /^#[0-9a-f]{6}$/i.test(c) ? c + '22' : '#f1f3f5'

/** A block's box: of its points for an outline, else its own. */
export function blockBox(e: any): [number, number, number, number] {
  if (!e.points?.length) return [e.x, e.y, e.width, e.height]
  const xs = e.points.map((p: XY) => p[0]), ys = e.points.map((p: XY) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  return [e.x + x0, e.y + y0, Math.max(...xs) - x0, Math.max(...ys) - y0]
}
