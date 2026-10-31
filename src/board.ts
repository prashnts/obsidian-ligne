// Perfboards and parts on them, in the style of limn's perfboard plans: a 2.54 mm hole grid true to
// size × scale, parts lying over the holes (resistors, caps, diodes, LEDs, pin headers and sockets,
// DIPs, TO-92) and
// module zones. Lines drawn over a board snap to its holes: wires. Parts are Excalidraw groups, so
// Excalidraw moves and turns them; ligne puts pin 1 back on a hole after a move.
import { MM } from './core/flat.ts'
import { dist, unit, type XY } from './core/geom.ts'
import { groupId, make, turned, type Convert, type Font } from './make.ts'

export type PartKind = 'board' | 'R' | 'C' | 'D' | 'LED' | 'J' | 'F' | 'DIP' | 'TO92' | 'module'
/** In key order: 1–9, then 0. */
export const PARTS: PartKind[] = ['board', 'R', 'C', 'D', 'LED', 'J', 'F', 'DIP', 'TO92', 'module']
export const PART_NAMES: Record<PartKind, string> = { board: 'perfboard', R: 'resistor', C: 'capacitor',
  D: 'diode', LED: 'LED', J: 'pin header (male)', F: 'socket (female)', DIP: 'DIP', TO92: 'TO-92', module: 'module' }
/** Clicks a part takes: one (TO-92), else two (the ends; a DIP: pin 1 and the last of its row). */
export const clicks = (k: PartKind) => k === 'TO92' ? 1 : 2

export const pitchOf = (scale: number) => 2.54 * MM * scale

/** customData.ligne of a board's base: holes `cols` x `rows`, `pitch` apart, the first `o` from
 *  its top-left. Of a part's body: its kind, ref, value, pins relative to the body's middle (unturned). */
export interface BoardData { kind: 'board', cols: number, rows: number, pitch: number, o: XY }
export interface PartData { kind: 'part', part: PartKind, ref: string, value: string, pins: XY[] }

const INK = '#1d1d1f', LEAD = '#9a9a9a'

/** A board with its first hole at `at`. */
export function board(convert: Convert, at: XY, cols: number, rows: number, pitch: number, font: Font): any[] {
  const g = groupId(), m = pitch * 0.9, [x0, y0] = at, P = pitch
  const data: BoardData = { kind: 'board', cols, rows, pitch, o: [m, m] }
  const base = { type: 'rectangle', x: x0 - m, y: y0 - m, width: (cols - 1) * P + 2 * m, height: (rows - 1) * P + 2 * m,
    strokeColor: '#b9a77a', backgroundColor: '#efe3c4', fillStyle: 'solid', strokeWidth: 1, roughness: 0,
    roundness: { type: 3 }, groupIds: [g], customData: { ligne: data } }
  const d = P * 0.32, holes: any[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) holes.push({ type: 'ellipse', x: x0 + c * P - d / 2,
    y: y0 + r * P - d / 2, width: d, height: d, strokeColor: '#c9b68a', backgroundColor: '#ffffff', fillStyle: 'solid',
    strokeWidth: 1, roughness: 0, groupIds: [g] })
  // numbers every 5 holes in the margins
  const fs = Math.max(6, P * 0.42), num = (text: string, x: number, y: number) => ({ type: 'text', x, y, text,
    fontFamily: font.fontFamily, fontSize: fs, strokeColor: '#8a8a8e', groupIds: [g] })
  const nums = make(convert, [
    ...Array.from({ length: Math.floor((cols - 1) / 5) + 1 }, (_, k) => num(String(k * 5), x0 + k * 5 * P, y0 - m)),
    ...Array.from({ length: Math.floor((rows - 1) / 5) + 1 }, (_, k) => num(String(k * 5), x0 - m, y0 + k * 5 * P)),
  ]).map(t => ({ ...t, x: t.y === y0 - m ? t.x - t.width / 2 : t.x + (m - t.width) / 2 - 1,
    y: t.y === y0 - m ? t.y + (m - t.height) / 2 : t.y - t.height / 2 }))
  return [...make(convert, [base, ...holes]), ...nums]
}

const holeOf = (b: any) => {
  const d = b.customData.ligne as BoardData
  return { ...d, x0: b.x + d.o[0], y0: b.y + d.o[1] }
}

/** The hole of a board nearest p, if p is over a board (the topmost). */
export function holeAt(scene: readonly any[], p: XY): { q: XY, board: any, c: number, r: number } | undefined {
  for (let k = scene.length - 1; k >= 0; k--) {
    const b = scene[k]
    if (b.isDeleted || b.customData?.ligne?.kind !== 'board') continue
    const h = holeOf(b), P = h.pitch
    if (p[0] < b.x || p[1] < b.y || p[0] > b.x + b.width || p[1] > b.y + b.height) continue
    const c = Math.max(0, Math.min(h.cols - 1, Math.round((p[0] - h.x0) / P)))
    const r = Math.max(0, Math.min(h.rows - 1, Math.round((p[1] - h.y0) / P)))
    return { q: [h.x0 + c * P, h.y0 + r * P], board: b, c, r }
  }
}

/** A board from corner hole a to b (hole positions on a pitch lattice from a). */
export function span(a: XY, b: XY, pitch: number) {
  const cols = Math.max(2, Math.round(Math.abs(b[0] - a[0]) / pitch) + 1)
  const rows = Math.max(2, Math.round(Math.abs(b[1] - a[1]) / pitch) + 1)
  const at: XY = [b[0] < a[0] ? a[0] - (cols - 1) * pitch : a[0], b[1] < a[1] ? a[1] - (rows - 1) * pitch : a[1]]
  return { at, cols, rows }
}

/** Parts in a single row of pins: headers and sockets. */
const row = (k: PartKind) => k === 'J' || k === 'F'

/** The pins of a part placed from hole a to hole b: two leads; a header's pins along the row or
 *  column; a DIP's two rows 0.3" apart (the second to the right of travel); TO-92 three in a row. */
export function pinsOf(kind: PartKind, a: XY, b: XY, P: number): XY[] {
  if (kind === 'TO92') return [[a[0] - P, a[1]], a, [a[0] + P, a[1]]]
  if (!row(kind) && kind !== 'DIP') return [a, b]
  // along the dominant axis, whole holes
  const dx = b[0] - a[0], dy = b[1] - a[1], horiz = Math.abs(dx) >= Math.abs(dy)
  const n = Math.max(kind === 'DIP' ? 2 : 1, Math.round(Math.abs(horiz ? dx : dy) / P) + 1)
  const u: XY = horiz ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]
  const line = Array.from({ length: n }, (_, k) => [a[0] + u[0] * k * P, a[1] + u[1] * k * P] as XY)
  if (row(kind)) return line
  const side: XY = [u[1] * 3 * P, -u[0] * 3 * P]
  return [...line, ...line.slice().reverse().map(p => [p[0] + side[0], p[1] + side[1]] as XY)]
}

/** A part's elements over its pins (scene points), body first; ref and value as small text. */
export function part(convert: Convert, kind: Exclude<PartKind, 'board'>, pins: XY[], P: number, ref: string,
  value: string, font: Font): any[] {
  const g = groupId(), a = pins[0], b = pins[1] ?? a, n = pins.length
  const mid: XY = kind === 'DIP' ? [(pins[0][0] + pins[n - 1][0] + pins[n / 2 - 1][0] + pins[n / 2][0]) / 4,
    (pins[0][1] + pins[n - 1][1] + pins[n / 2 - 1][1] + pins[n / 2][1]) / 4]
    : row(kind) ? [(a[0] + pins[n - 1][0]) / 2, (a[1] + pins[n - 1][1]) / 2] : kind === 'TO92' ? a
    : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const far = row(kind) || kind === 'DIP' ? pins[row(kind) ? n - 1 : n / 2 - 1] : b
  const u = dist(a, far) > 1e-6 ? unit([far[0] - a[0], far[1] - a[1]]) : [1, 0] as XY
  const ang = Math.atan2(u[1], u[0]), L = dist(a, far)
  const fs = Math.max(6, P * 0.5), base = { roughness: 0, strokeWidth: 1, fillStyle: 'solid', groupIds: [g] }
  // the body, laid along x about mid, turned afterwards
  const rect = (w: number, h: number, fill: string, stroke: string, extra: object = {}) => ({ type: 'rectangle',
    x: mid[0] - w / 2, y: mid[1] - h / 2, width: w, height: h, backgroundColor: fill, strokeColor: stroke, ...base, ...extra })
  const oval = (w: number, h: number, fill: string, stroke: string, at = mid) => ({ type: 'ellipse', x: at[0] - w / 2,
    y: at[1] - h / 2, width: w, height: h, backgroundColor: fill, strokeColor: stroke, ...base })
  let body: any, more: any[] = []
  const lead = row(kind) || kind === 'DIP' || kind === 'module' ? [] : [{ type: 'line', x: a[0], y: a[1],
    points: [[0, 0], [b[0] - a[0], b[1] - a[1]]], strokeColor: LEAD, strokeWidth: Math.max(1, P * 0.12), roughness: 0,
    roundness: null, groupIds: [g] }]
  switch (kind) {
    case 'R': body = rect(Math.max(P * 1.2, Math.min(L - P * 0.7, P * 2.6)), P * 0.5, '#e9d3a3', '#8a6d3b',
      { roundness: { type: 3 } }); break
    case 'C': body = oval(P * 0.8, P * 0.55, '#4b7bd1', '#23458a'); break
    case 'LED': body = oval(P * 1.1, P * 1.1, '#ff8787', '#c92a2a'); break
    case 'D': {
      const w = Math.max(P * 1.1, Math.min(L - P * 0.8, P * 1.9))
      body = rect(w, P * 0.45, '#2b2b2b', '#000000')
      // the cathode band at pin 2's end
      more = [rect(P * 0.18, P * 0.45, '#ced4da', '#ced4da', { x: mid[0] + w / 2 - P * 0.35, y: mid[1] - P * 0.225 })]
      break
    }
    // black plastic: a male header's square gold pins, a socket's openings
    case 'J': case 'F': body = rect(L + P, P, '#212529', '#000000'); break
    case 'DIP': {
      body = rect(L + P * 0.8, P * 2.1, '#2b2b2b', '#000000')
      more = [oval(P * 0.5, P * 0.5, '#495057', '#495057', [mid[0] - (L + P * 0.8) / 2 + P * 0.1, mid[1]])]
      break
    }
    case 'TO92': {
      // a D: flat face down (toward the reader), round back up
      const R = P * 1.35, k = 12, arc = Array.from({ length: k + 1 }, (_, i) => {
        const t = Math.PI + Math.PI * i / k
        return [mid[0] + R * Math.cos(t), mid[1] + P * 0.35 + R * 0.9 * Math.sin(t)] as XY
      })
      const pts = [...arc, arc[0]]
      body = { type: 'line', x: pts[0][0], y: pts[0][1], points: pts.map(p => [p[0] - pts[0][0], p[1] - pts[0][1]]),
        backgroundColor: '#3a3a3a', strokeColor: '#1d1d1f', roundness: null, ...base }
      break
    }
    case 'module': {
      const [x0, x1] = [Math.min(a[0], b[0]) - P / 2, Math.max(a[0], b[0]) + P / 2]
      const [y0, y1] = [Math.min(a[1], b[1]) - P / 2, Math.max(a[1], b[1]) + P / 2]
      body = { type: 'rectangle', x: x0, y: y0, width: x1 - x0, height: y1 - y0, backgroundColor: '#fbf6ea',
        strokeColor: '#8a8a8e', strokeStyle: 'dashed', ...base, roundness: { type: 3 },
        label: { text: [ref, value].filter(Boolean).join('\n') || 'module', fontFamily: font.fontFamily,
          fontSize: Math.max(8, P * 0.7), strokeColor: INK } }
      break
    }
  }
  const sq = kind === 'J' || kind === 'F', d = kind === 'J' ? P * 0.26 : kind === 'F' ? P * 0.4 : P * 0.36
  const dots = kind === 'module' ? [] : pins.map((p, i) => ({ type: sq || i === 0 && kind === 'DIP' ? 'rectangle' : 'ellipse',
    x: p[0] - d / 2, y: p[1] - d / 2, width: d, height: d, strokeColor: kind === 'F' ? '#495057' : 'transparent',
    backgroundColor: kind === 'J' ? '#e0b44a' : kind === 'F' ? '#0b0b0c' : kind === 'DIP' ? '#d9d9d9' : LEAD, ...base }))
  // the body and its marks turn with the part; leads and pin dots are placed where they are
  const turn = (els: any[]) => kind === 'module' || kind === 'TO92' ? els : turned(els, mid, ang)
  const [b0, ...bs] = make(convert, [body, ...more])
  const data: PartData = { kind: 'part', part: kind, ref, value, pins: [] }
  const placed = turn([b0, ...bs.filter(e => e.type !== 'text')])
  const main = placed[0], c: XY = [main.x + main.width / 2, main.y + main.height / 2], ca = Math.cos(-main.angle || 0)
  const sa = Math.sin(-main.angle || 0)
  data.pins = pins.map(p => [(p[0] - c[0]) * ca - (p[1] - c[1]) * sa, (p[0] - c[0]) * sa + (p[1] - c[1]) * ca])
  placed[0] = { ...main, customData: { ligne: data } }
  const bound = bs.filter(e => e.type === 'text')
  // ref and value beside the body, upright
  const tag = kind === 'module' || !(ref || value) ? [] : make(convert, [{ type: 'text', x: 0, y: 0,
    text: [ref, value].filter(Boolean).join(' '), fontFamily: font.fontFamily, fontSize: fs, strokeColor: INK,
    groupIds: [g] }]).map(t => {
      const side = kind === 'DIP' ? [mid[0] - t.width / 2, mid[1] - t.height / 2]
        : Math.abs(u[0]) >= Math.abs(u[1]) ? [mid[0] - t.width / 2, mid[1] - P * (kind === 'LED' ? 0.6 : kind === 'TO92' ? 1.1 : 0.35) - t.height]
          : [mid[0] + P * 0.45, mid[1] - t.height / 2]
      return { ...t, x: side[0], y: side[1], strokeColor: kind === 'DIP' ? '#f1f3f5' : INK }
    })
  return [...placed, ...bound.map(t => ({ ...t, groupIds: [g] })), ...make(convert, lead), ...make(convert, dots), ...tag]
}

/** Pins of a part in the scene, from its body. */
export function pinsAt(body: any): XY[] {
  const d = body.customData.ligne as PartData, c: XY = [body.x + body.width / 2, body.y + body.height / 2]
  const a = body.angle ?? 0, ca = Math.cos(a), sa = Math.sin(a)
  return d.pins.map(p => [c[0] + p[0] * ca - p[1] * sa, c[1] + p[0] * sa + p[1] * ca])
}

/** Parts moved off the holes by Excalidraw (a drag, a turn): each goes onto the hole nearest its
 *  pin 1 when within half a pitch. undefined when none moved. */
export function seat(scene: readonly any[]): any[] | undefined {
  const moves = new Map<string, XY>()
  for (const e of scene) {
    if (e.isDeleted || e.customData?.ligne?.kind !== 'part') continue
    const [p] = pinsAt(e), h = p && holeAt(scene, p)
    if (!h) continue
    const d: XY = [h.q[0] - p[0], h.q[1] - p[1]], P = h.board.customData.ligne.pitch
    if (Math.hypot(...d) > 1e-3 && Math.hypot(...d) < P / 2) moves.set(e.groupIds?.[0], d)
  }
  if (!moves.size) return
  return scene.map(e => {
    const d = moves.get(e.groupIds?.[0])
    return d ? { ...e, x: e.x + d[0], y: e.y + d[1], version: e.version + 1, versionNonce: Math.random() * 2 ** 31 | 0 } : e
  })
}
