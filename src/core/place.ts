// Where labels go beside lines: off the outer edge of a stack (not the centre line of the line
// clicked), and clear of the labels already there.
import { nearest, type XY } from './geom.ts'

/** A turned rectangle: centre, width along its angle, height across. */
export interface Box { c: XY, w: number, h: number, a: number }

const axes = (b: Box): [XY, XY] => [[Math.cos(b.a), Math.sin(b.a)], [-Math.sin(b.a), Math.cos(b.a)]]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]

/** Whether two turned rectangles overlap (separating axes), `pad` apart counted as touching. */
export function overlap(a: Box, b: Box, pad = 0): boolean {
  const d: XY = [b.c[0] - a.c[0], b.c[1] - a.c[1]]
  // half their extent along an axis: their own two axes weighed by it
  const r = (x: Box, ax: XY) => { const [u, v] = axes(x); return Math.abs(dot(u, ax)) * x.w / 2 + Math.abs(dot(v, ax)) * x.h / 2 }
  for (const ax of [...axes(a), ...axes(b)]) if (Math.abs(dot(d, ax)) > r(a, ax) + r(b, ax) + pad) return false
  return true
}

/** How far from point q (on a line) the drawn lines reach along n, stepping over the lines that
 *  touch it side by side (a stack): the outer edge, from q. `own`: half the clicked line's width. */
export function edgeOut(lines: { drawn: XY[], width: number }[], q: XY, n: XY, own: number, gap = 3): number {
  let edge = own
  for (let k = 0; k < 24; k++) {
    const probe: XY = [q[0] + n[0] * (edge + gap), q[1] + n[1] * (edge + gap)]
    let next = edge
    for (const l of lines) {
      const m = nearest(l.drawn, probe)
      if (m.d > l.width / 2 + gap) continue
      // this line lies against the edge: the edge moves out past it
      const at = dot([m.q[0] - q[0], m.q[1] - q[1]], n)
      next = Math.max(next, at + l.width / 2)
    }
    if (next <= edge + 1e-6) break
    edge = next
  }
  return edge
}

/** A spot for box b clear of `taken`: as it is, else slid along u (both ways, by steps of its own
 *  size), else pushed further out along n. */
export function clear(b: Box, taken: Box[], u: XY, n: XY, pad = 2): Box {
  const free = (x: Box) => !taken.some(t => overlap(x, t, pad))
  if (free(b)) return b
  const step = Math.max(b.w, b.h) * .6
  for (let out = 0; out < 3; out++) for (let k = 1; k <= 6; k++) for (const s of [1, -1]) {
    const c: XY = [b.c[0] + u[0] * s * k * step + n[0] * out * b.h, b.c[1] + u[1] * s * k * step + n[1] * out * b.h]
    if (free({ ...b, c })) return { ...b, c }
  }
  return b
}
