// Blocks: the nodes lines run between. Flowchart symbols (process, decision, terminator, data,
// document, database), a folder, a table, a text, an icon; each with four ports (the middles of its
// sides) where lines leave and arrive square to the side. Devices (an MCU, a board, a PC, any
// device) have named pins along their sides instead, from a typed spec: 'RP2040; e: USB, SDA, SCL'.
import type { XY } from './geom.ts'

export type DeviceKind = 'mcu' | 'board' | 'pc' | 'device'
export type BlockKind = 'process' | 'decision' | 'terminator' | 'data' | 'document' | 'database' | 'folder' | 'table'
  | 'text' | 'icon' | DeviceKind
export const DEVICES: DeviceKind[] = ['mcu', 'board', 'pc', 'device']
/** In key order (1–9, 0): devices before the folder, table, text and icon. */
export const BLOCKS: BlockKind[] = ['process', 'decision', 'terminator', 'data', 'document', 'database', ...DEVICES, 'folder',
  'table', 'text', 'icon']
export const isDevice = (k: BlockKind): k is DeviceKind => (DEVICES as string[]).includes(k)
export type Side = 'n' | 'e' | 's' | 'w'
export const SIDES: Side[] = ['n', 'e', 's', 'w']
/** A side's middle ('e'), or a named pin on it by index ('e2'). */
export type Port = Side | `${Side}${number}`
export const PORTS: Port[] = SIDES
/** Pin names per side, pin 1 first: top and bottom left to right, the sides top down. */
export type Pins = Partial<Record<Side, string[]>>
/** customData.ligne of a block's shape: its kind and block id (kept on paste, like a line's lid); a
 *  device's pins and the spec they came from. */
export interface BlockData { kind: 'block', shape: BlockKind, bid: string, rows?: number, cols?: number, pins?: Pins,
  spec?: string }
/** A line's end on a block: which block, which port. */
export interface Dock { block: string, port: Port }

/** Default size, px. */
export const SIZE: Record<BlockKind, [number, number]> = {
  process: [160, 72], decision: [140, 100], terminator: [150, 56], data: [170, 72], document: [160, 84],
  database: [120, 100], folder: [150, 96], table: [200, 120], text: [140, 40], icon: [64, 64],
  mcu: [120, 120], board: [180, 120], pc: [180, 120], device: [160, 96],
}

const BAND = 22                                   // px: the band top and bottom pin names take
const OUT: Record<Side, XY> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }
/** The side a port is on. */
export const sideOf = (p: Port) => p[0] as Side
/** The way out of a port. */
export const outOf = (p: Port): XY => OUT[sideOf(p)]

/** A device's ports: its pins, and the middle of each side without any. */
export const portsOf = (pins?: Pins): Port[] => SIDES.flatMap(s => pins?.[s]?.length
  ? pins[s]!.map((_, i) => `${s}${i}` as Port) : [s])

/** A port's point on a box x, y, w, h (a parallelogram's slanted sides: their middles); pin i of k
 *  on a side at the middle of its k-th share of it. */
export function portAt(box: [number, number, number, number], p: Port, pins?: Pins): XY {
  const [x, y, w, h] = box, s = sideOf(p), k = pins?.[s]?.length ?? 0, i = p.length > 1 ? +p.slice(1) : -1
  const t = k && i >= 0 && i < k ? (i + .5) / k : .5
  if (s === 'n' || s === 's') return [x + w * t, s === 'n' ? y : y + h]
  // down the sides, clear of the top and bottom pins' names
  const top = pins?.n?.length ? BAND : 0, low = pins?.s?.length ? BAND : 0
  return [s === 'e' ? x + w : x, y + top + (h - top - low) * t]
}

/** The port of a box nearest q, and its distance. */
export function nearestPort(box: [number, number, number, number], q: XY, pins?: Pins): { port: Port, at: XY, d: number } {
  let best = { port: 'n' as Port, at: portAt(box, 'n'), d: Infinity }
  for (const p of portsOf(pins)) {
    const at = portAt(box, p, pins), d = Math.hypot(at[0] - q[0], at[1] - q[1])
    if (d < best.d) best = { port: p, at, d }
  }
  return best
}

/** A block's outline in the box (closed), for the kinds drawn as one polygon. */
export function outline(kind: BlockKind, w: number, h: number): XY[] | undefined {
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): XY[] =>
    Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] })
  const close = (pts: XY[]) => [...pts, pts[0]]
  if (kind === 'terminator') {
    const r = h / 2
    return close([...arc(w - r, r, r, r, -Math.PI / 2, Math.PI / 2), ...arc(r, r, r, r, Math.PI / 2, Math.PI * 1.5)])
  }
  if (kind === 'data') { const s = h * .35; return close([[s, 0], [w, 0], [w - s, h], [0, h]]) }
  if (kind === 'document') {
    // a wavy bottom edge
    const wave: XY[] = Array.from({ length: 17 }, (_, i) => { const t = i / 16; return [w * (1 - t), h * .88 + Math.sin(t * Math.PI * 2) * h * .08] })
    return close([[0, 0], [w, 0], ...wave.slice(0, -1), [0, h * .88]])
  }
  if (kind === 'database') {
    const ry = Math.min(h * .14, w * .2)
    return close([...arc(w / 2, ry, w / 2, ry, Math.PI, 2 * Math.PI), ...arc(w / 2, h - ry, w / 2, ry, 0, Math.PI)])
  }
  if (kind === 'folder') {
    const t = Math.min(h * .18, 18), tw = Math.min(w * .4, 70)
    return close([[0, t], [0, 0], [tw * .8, 0], [tw, t], [w, t], [w, h], [0, h]])
  }
}

/** Extra strokes inside a block: a database's lid, a table's grid. */
export function inner(kind: BlockKind, w: number, h: number, rows = 3, cols = 2): XY[][] {
  if (kind === 'database') {
    const ry = Math.min(h * .14, w * .2)
    return [Array.from({ length: 13 }, (_, i) => { const a = Math.PI * i / 12; return [w / 2 + Math.cos(a) * w / 2, ry + Math.sin(a) * ry] as XY })]
  }
  if (kind === 'table') {
    const out: XY[][] = []
    for (let r = 1; r < rows; r++) out.push([[0, h * r / rows], [w, h * r / rows]])
    for (let c = 1; c < cols; c++) out.push([[w * c / cols, h / rows], [w * c / cols, h]])
    return out
  }
  return []
}

const SIDE_WORDS: Record<string, Side> = { n: 'n', top: 'n', e: 'e', right: 'e', s: 's', bottom: 's', w: 'w', left: 'w' }
/** A device spec: its title, then pins per side ('e: USB, SDA, SCL' — commas, else spaces between
 *  pins), parts apart by ';' or new lines. Lines without a side join the title. */
export function parseDevice(spec: string): { title: string, pins: Pins } {
  const title: string[] = [], pins: Pins = {}
  for (const part of spec.split(/[;\n]/).map(t => t.trim()).filter(Boolean)) {
    const m = part.match(/^(n|e|s|w|top|right|bottom|left)\s*:\s*(.*)$/i)
    if (!m) { title.push(part); continue }
    const side = SIDE_WORDS[m[1].toLowerCase()], list = m[2].includes(',') ? m[2].split(',') : m[2].split(/\s+/)
    pins[side] = [...pins[side] ?? [], ...list.map(t => t.trim()).filter(Boolean)]
  }
  return { title: title.join('\n'), pins }
}

/** A device's size for its title and pins: a pin row every `pitch` px down the sides, the top and
 *  bottom pins wide enough for their names; `cw`: a character's width. */
export function deviceSize(kind: DeviceKind, title: string, pins: Pins, cw = 7.5, pitch = 24): [number, number] {
  const longest = (s: Side) => Math.max(0, ...(pins[s] ?? []).map(t => t.length))
  const lines = title.split('\n'), tw = Math.max(...lines.map(t => t.length)) * cw * 1.25
  const across = Math.max(pins.n?.length ?? 0, pins.s?.length ?? 0), down = Math.max(pins.e?.length ?? 0, pins.w?.length ?? 0)
  const w = Math.max(SIZE[kind][0], tw + (longest('e') + longest('w')) * cw + 40,
    across * (Math.max(longest('n'), longest('s')) * cw + 14))
  const bands = ((pins.n?.length ? 1 : 0) + (pins.s?.length ? 1 : 0)) * BAND
  const h = Math.max(SIZE[kind][1], down * pitch + 16 + bands, lines.length * 22 + (across ? 2 * 26 : 16))
  return [Math.ceil(w / 10) * 10, Math.ceil(h / 10) * 10]
}
