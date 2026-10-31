// Snapping guides: the pointer lines up with points already drawn (waypoints, stations, shapes),
// along the grid's directions, as smart guides do; and lattice snapping (square or isometric).
import { dirsOf, dist, type Grid, type XY } from './geom.ts'

/** A guide: from the reference point to the snapped point. */
export type Guide = [XY, XY]

const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]

/** p moved onto the guide lines through `refs` within tol (one, or where two cross), the grid's
 *  directions taken both ways once. Horizontal and vertical guides reach across; the others only
 *  from refs within `near` (far diagonals line up by chance, not by intent). */
export function align(p: XY, refs: readonly XY[], tol: number, grid: Grid = 'octi', near = Infinity):
  { q: XY, guides: Guide[] } {
  const ds = dirsOf(grid).slice(0, dirsOf(grid).length / 2)
  const hits: { r: XY, u: XY, d: number }[] = []
  for (const u of ds) {
    let best: { r: XY, u: XY, d: number } | undefined
    const axis = Math.abs(u[0]) < 1e-9 || Math.abs(u[1]) < 1e-9
    for (const r of refs) {
      if (!axis && dist(p, r) > near) continue
      const d = Math.abs(cross([p[0] - r[0], p[1] - r[1]], u))
      if (d < tol && dist(p, r) > tol && (!best || d < best.d)) best = { r, u, d }
    }
    if (best) hits.push(best)
  }
  if (!hits.length) return { q: p, guides: [] }
  hits.sort((a, b) => a.d - b.d)
  const [a, b] = hits, foot = (h: typeof a): XY => {
    const t = (p[0] - h.r[0]) * h.u[0] + (p[1] - h.r[1]) * h.u[1]
    return [h.r[0] + h.u[0] * t, h.r[1] + h.u[1] * t]
  }
  if (!b) { const q = foot(a); return { q, guides: [[a.r, q]] } }
  // where both guide lines cross: a.r + s a.u = b.r + t b.u
  const w: XY = [b.r[0] - a.r[0], b.r[1] - a.r[1]], s = cross(w, b.u) / cross(a.u, b.u)
  const q: XY = [a.r[0] + a.u[0] * s, a.r[1] + a.u[1] * s]
  return dist(q, p) < tol * 1.5 ? { q, guides: [[a.r, q], [b.r, q]] } : { q: foot(a), guides: [[a.r, foot(a)]] }
}

/** The guides q already sits on (within eps): for showing alignment that came from elsewhere. */
export function aligned(q: XY, refs: readonly XY[], eps: number, grid: Grid = 'octi', near = Infinity): Guide[] {
  const ds = dirsOf(grid).slice(0, dirsOf(grid).length / 2), out: Guide[] = []
  for (const u of ds) {
    const axis = Math.abs(u[0]) < 1e-9 || Math.abs(u[1]) < 1e-9
    // the farthest reference on each line: one guide per direction
    let far: XY | undefined
    for (const r of refs) {
      const on = Math.abs(cross([q[0] - r[0], q[1] - r[1]], u)) < eps && dist(q, r) > eps
      if (on && (axis || dist(q, r) <= near) && (!far || dist(q, r) > dist(q, far))) far = r
    }
    if (far) out.push([far, q])
  }
  return out
}

/** Lattice point nearest p: a square grid of `size`, or an isometric one (vertical lines `size`
 *  apart along 30°, points `size` apart on them). */
export function lattice(p: XY, kind: 'square' | 'iso', size: number): XY {
  if (kind === 'square') return [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size]
  const dx = size * Math.sqrt(3) / 2, i0 = Math.round(p[0] / dx)
  let best: XY = p, bd = Infinity
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const off = i % 2 ? size / 2 : 0, q: XY = [i * dx, Math.round((p[1] - off) / size) * size + off]
    if (dist(p, q) < bd) { bd = dist(p, q); best = q }
  }
  return best
}

/** Isometric lattice lines over a box [x0, y0, x1, y1] (scene units): verticals and both slopes. */
export function isoLines(box: [number, number, number, number], size: number): [XY, XY][] {
  const [x0, y0, x1, y1] = box, dx = size * Math.sqrt(3) / 2, k = Math.tan(Math.PI / 6), out: [XY, XY][] = []
  for (let i = Math.floor(x0 / dx); i * dx <= x1; i++) out.push([[i * dx, y0], [i * dx, y1]])
  // y = ±k x + c, c on the lattice: c = n size; spans the box's c range
  for (const sg of [1, -1]) {
    const cs = [y0 - sg * k * x0, y0 - sg * k * x1, y1 - sg * k * x0, y1 - sg * k * x1]
    for (let n = Math.floor(Math.min(...cs) / size); n * size <= Math.max(...cs); n++) {
      const c = n * size
      out.push([[x0, sg * k * x0 + c], [x1, sg * k * x1 + c]])
    }
  }
  return out
}
