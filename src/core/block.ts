// Blocks: the nodes lines run between. Flowchart symbols (process, decision, terminator, data,
// document, database), a folder, a table, a text, an icon; each with four ports (the middles of its
// sides) where lines leave and arrive square to the side.
import type { XY } from './geom.ts'

export type BlockKind = 'process' | 'decision' | 'terminator' | 'data' | 'document' | 'database' | 'folder' | 'table'
  | 'text' | 'icon'
export const BLOCKS: BlockKind[] = ['process', 'decision', 'terminator', 'data', 'document', 'database', 'folder', 'table',
  'text', 'icon']
export type Port = 'n' | 'e' | 's' | 'w'
export const PORTS: Port[] = ['n', 'e', 's', 'w']
/** customData.ligne of a block's shape: its kind and block id (kept on paste, like a line's lid). */
export interface BlockData { kind: 'block', shape: BlockKind, bid: string, rows?: number, cols?: number }
/** A line's end on a block: which block, which port. */
export interface Dock { block: string, port: Port }

/** Default size, px. */
export const SIZE: Record<BlockKind, [number, number]> = {
  process: [160, 72], decision: [140, 100], terminator: [150, 56], data: [170, 72], document: [160, 84],
  database: [120, 100], folder: [150, 96], table: [200, 120], text: [140, 40], icon: [64, 64],
}

const OUT: Record<Port, XY> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }
/** The way out of a port. */
export const outOf = (p: Port): XY => OUT[p]

/** A port's point on a box x, y, w, h (a parallelogram's slanted sides: their middles). */
export function portAt(box: [number, number, number, number], p: Port): XY {
  const [x, y, w, h] = box
  return p === 'n' ? [x + w / 2, y] : p === 's' ? [x + w / 2, y + h] : p === 'e' ? [x + w, y + h / 2] : [x, y + h / 2]
}

/** The port of a box nearest q, and its distance. */
export function nearestPort(box: [number, number, number, number], q: XY): { port: Port, at: XY, d: number } {
  let best = { port: 'n' as Port, at: portAt(box, 'n'), d: Infinity }
  for (const p of PORTS) {
    const at = portAt(box, p), d = Math.hypot(at[0] - q[0], at[1] - q[1])
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
