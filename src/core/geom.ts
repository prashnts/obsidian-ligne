// Octilinear geometry: legs run at multiples of 45°, bends are rounded by circular arcs.
export type XY = [number, number]

const EPS = 1e-6
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const len = (v: XY) => Math.hypot(v[0], v[1])
export const unit = (v: XY): XY => { const l = len(v) || 1; return [v[0] / l, v[1] / l] }
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
export const dist = (a: XY, b: XY) => len(sub(a, b))
export const same = (a: XY, b: XY) => dist(a, b) < EPS

/** The leg directions: octilinear (45° multiples) or isometric (30°, 90°, 150° and back). */
export type Grid = 'octi' | 'iso'
const ring = (n: number, from: number): XY[] => Array.from({ length: n }, (_, k) => {
  const a = from + k * 2 * Math.PI / n
  return [Math.round(Math.cos(a) * 1e12) / 1e12, Math.round(Math.sin(a) * 1e12) / 1e12]
})
const DIRS: Record<Grid, XY[]> = { octi: ring(8, 0), iso: ring(6, Math.PI / 6) }
export const dirsOf = (g: Grid = 'octi') => DIRS[g]

/** Projects p onto the nearest leg direction out of a. */
export function snapDir(a: XY, p: XY, grid: Grid = 'octi'): XY {
  const d = sub(p, a)
  let u = DIRS[grid][0], best = -Infinity
  for (const v of DIRS[grid]) if (dot(d, v) > best) { best = dot(d, v); u = v }
  return [a[0] + u[0] * best, a[1] + u[1] * best]
}
export const snap8 = (a: XY, p: XY) => snapDir(a, p, 'octi')

/** Whether direction v (snapped to the grid) is a "diagonal" leg: octilinear, off the axes;
 *  isometric, off the vertical. */
export function isDiag(v: XY, grid: Grid = 'octi'): boolean {
  const u = sub(snapDir([0, 0], v, grid), [0, 0]), ax = Math.abs(u[0]) < EPS || Math.abs(u[1]) < EPS
  return grid === 'octi' ? !ax : Math.abs(u[0]) > EPS
}

/** The two corners a → b can bend at, over the two leg directions either side of b - a: after the
 *  "diagonal" leg (see isDiag), or after the other one. */
function corners(a: XY, b: XY, grid: Grid = 'octi'): [XY, XY] {
  const d = sub(b, a), ds = DIRS[grid], n = ds.length
  for (let k = 0; k < n; k++) {
    const u = ds[k], v = ds[(k + 1) % n], den = u[0] * v[1] - u[1] * v[0]
    const s = (d[0] * v[1] - d[1] * v[0]) / den, t = (u[0] * d[1] - u[1] * d[0]) / den
    if (s < -EPS || t < -EPS) continue
    const viaU: XY = [a[0] + u[0] * s, a[1] + u[1] * s], viaV: XY = [a[0] + v[0] * t, a[1] + v[1] * t]
    // two sloped legs (isometric): the rising one counts as the diagonal
    const uDiag = isDiag(u, grid) && !(isDiag(v, grid) && u[1] >= v[1])
    return uDiag ? [viaU, viaV] : [viaV, viaU]
  }
  return [b, b]
}

/** Whether a → b should start with its diagonal leg: the order turning least from the incoming
 *  direction `inDir` (metro lines avoid sharp turns); straight first without one. */
export function diagFirst(a: XY, b: XY, inDir?: XY, grid: Grid = 'octi'): boolean {
  if (!inDir) return false
  const turn = (p: XY) => same(p, a) ? 0 : -dot(unit(sub(p, a)), inDir)
  const [viaDiag, viaStraight] = corners(a, b, grid)
  return turn(viaDiag) < turn(viaStraight)
}

/** a → b as two legs on the grid; `diag`: the diagonal one first (default: see diagFirst). */
export function octi(a: XY, b: XY, diag?: boolean, inDir?: XY, grid: Grid = 'octi'): XY[] {
  const [viaDiag, viaStraight] = corners(a, b, grid)
  const mid = diag ?? diagFirst(a, b, inDir, grid) ? viaDiag : viaStraight
  return same(mid, a) || same(mid, b) ? [a, b] : [a, mid, b]
}

/** Angle of direction u turned to read left to right: in (-90°, 90°]. */
export function upright(u: XY): number {
  const a = Math.atan2(u[1], u[0])
  return a > Math.PI / 2 + EPS ? a - Math.PI : a <= -Math.PI / 2 + EPS ? a + Math.PI : a
}

/** Unit direction of the last leg, if any. */
export const lastDir = (pts: XY[]): XY | undefined =>
  pts.length < 2 ? undefined : unit(sub(pts[pts.length - 1], pts[pts.length - 2]))

/** Indices of the points kept when dropping repeated points and joining collinear legs; pinned
 *  points stay even between collinear legs. */
export function kept(pts: XY[], pinned: (i: number) => boolean = () => false): number[] {
  const out: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], at = (k: number) => pts[out[out.length - k]]
    if (out.length && same(at(1), p)) continue
    if (out.length >= 2 && !pinned(out[out.length - 1])) {
      const u = unit(sub(at(1), at(2))), v = unit(sub(p, at(1)))
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) < EPS && u[0] * v[0] + u[1] * v[1] > 0) out.pop()
    }
    out.push(i)
  }
  return out
}

/** Drops repeated points and joins collinear legs. */
export const simplify = (pts: XY[]): XY[] => kept(pts).map(i => pts[i])

/** Polyline with every bend replaced by an arc of radius ≤ r (one for all, or per point), sampled
 *  every ≤ `step` radians. The radius shrinks where legs are too short to hold it (two bends share
 *  a leg half and half). */
export function round(pts: XY[], radius: number | readonly number[], step = Math.PI / 16): XY[] {
  const rs = typeof radius === 'number' ? pts.map(() => radius) : radius
  if (pts.length < 3) return pts.slice()
  const out: XY[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, v, n] = [pts[i - 1], pts[i], pts[i + 1]], r = rs[i] ?? 0
    const u1 = unit(sub(v, p)), u2 = unit(sub(n, v))
    const cross = u1[0] * u2[1] - u1[1] * u2[0], th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    if (th < EPS || Math.PI - th < EPS || r <= 0) { out.push(v); continue }
    const half = (k: number) => i + k === 0 || i + k === pts.length - 1 ? 1 : 0.5
    const t = Math.min(r * Math.tan(th / 2), dist(p, v) * half(-1), dist(v, n) * half(1))
    const rr = t / Math.tan(th / 2), sg = Math.sign(cross)
    const s: XY = [v[0] - u1[0] * t, v[1] - u1[1] * t]
    const c: XY = [s[0] - sg * u1[1] * rr, s[1] + sg * u1[0] * rr]
    const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), k = Math.max(1, Math.ceil(th / step))
    for (let j = 0; j <= k; j++) {
      const a = a0 + sg * th * j / k
      out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)])
    }
  }
  out.push(pts[pts.length - 1])
  return simplify(out)
}

/** Nearest point on a polyline: segment index, the point, its distance. */
export function nearest(pts: XY[], p: XY): { i: number, q: XY, d: number } {
  let best = { i: 0, q: pts[0], d: Infinity }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], ab = sub(pts[i + 1], a), l2 = ab[0] ** 2 + ab[1] ** 2
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0
    const q: XY = [a[0] + ab[0] * t, a[1] + ab[1] * t], d = dist(p, q)
    if (d < best.d) best = { i, q, d }
  }
  return best
}


const left = (u: XY): XY => [-u[1], u[0]]
const turn = (pts: XY[], i: number) => {
  const u1 = unit(sub(pts[i], pts[i - 1])), u2 = unit(sub(pts[i + 1], pts[i]))
  return u1[0] * u2[1] - u1[1] * u2[0]
}

/** The point at fraction t of leg i, moved d to the left of travel; on a bend (t = 0) the corner
 *  of the two moved legs, so that parallel lines bend at the same place. */
export function offsetAt(pts: XY[], i: number, t: number, d: number): XY {
  const n = pts.length - 1
  if (i >= n) { i = n - 1; t = 1 }
  const a = pts[i], b = pts[i + 1], u = unit(sub(b, a)), nl = left(u)
  const on: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const corner = (k: number) => {
    // bend k: along the mean normal, d / cos(half the turn) out
    const n1 = left(unit(sub(pts[k], pts[k - 1]))), n2 = left(unit(sub(pts[k + 1], pts[k])))
    const m = unit([n1[0] + n2[0], n1[1] + n2[1]]), c = m[0] * n1[0] + m[1] * n1[1]
    return [pts[k][0] + m[0] * d / c, pts[k][1] + m[1] * d / c] as XY
  }
  if (t < EPS && i > 0) return corner(i)
  if (t > 1 - EPS && i + 1 < n) return corner(i + 1)
  return [on[0] + nl[0] * d, on[1] + nl[1] * d]
}

/** pts moved d to the left, bend for bend. */
export const offset = (pts: XY[], d: number): XY[] => pts.map((_, i) => offsetAt(pts, i, 0, d))

/** Radii for a parallel d to the left: same centres, so bends nest (inside smaller, outside larger). */
export const concentric = (pts: XY[], rs: readonly number[], d: number): number[] =>
  pts.map((_, i) => i === 0 || i === pts.length - 1 ? rs[i] : Math.max(0, rs[i] - Math.sign(turn(pts, i)) * d))

/** Where p sits beside pts: leg index, fraction along it, signed distance to the left. */
export function beside(pts: XY[], p: XY): { i: number, t: number, d: number } {
  const n = nearest(pts, p), a = pts[n.i], b = pts[n.i + 1] ?? a, l = dist(a, b)
  const u = unit(sub(b, a)), nl = left(u)
  return { i: n.i, t: l ? dist(a, n.q) / l : 0, d: (p[0] - n.q[0]) * nl[0] + (p[1] - n.q[1]) * nl[1] }
}

/** Cumulative length at each point of a polyline. */
export function lengths(pts: XY[]): number[] {
  const out = [0]
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]))
  return out
}

/** Left normal at each point, mitred on bends so that offsets keep their distance from both legs. */
export function normals(pts: XY[]): XY[] {
  const legs = pts.slice(1).map((p, i) => left(unit(sub(p, pts[i]))))
  return pts.map((_, i) => {
    const a = legs[Math.max(0, i - 1)] ?? [0, 1], b = legs[Math.min(legs.length - 1, i)] ?? a
    const m = unit([a[0] + b[0], a[1] + b[1]]), c = Math.max(0.5, dot(m, a))
    return [m[0] / c, m[1] / c] as XY
  })
}

/** pts with points added so that no leg is longer than step; `s`: length along at each. */
export function resample(pts: XY[], step: number): { pts: XY[], s: number[] } {
  const out: XY[] = pts.length ? [pts[0]] : [], s: number[] = pts.length ? [0] : []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = dist(a, b), k = Math.max(1, Math.ceil(l / step)), s0 = s[s.length - 1]
    for (let j = 1; j <= k; j++) {
      out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); s.push(s0 + l * j / k)
    }
  }
  return { pts: out, s }
}

/** Point and unit direction at length s along a polyline (clamped to its ends). */
export function pointAt(pts: XY[], s: number): { p: XY, u: XY } {
  let i = 0
  for (; i < pts.length - 2; i++) {
    const l = dist(pts[i], pts[i + 1])
    if (s <= l) break
    s -= l
  }
  const a = pts[i], b = pts[i + 1] ?? a, l = dist(a, b), t = l ? Math.max(0, Math.min(1, s / l)) : 0
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], u: unit(sub(b, a)) }
}

/** The point nearest p from which both prev and next are reached by one octilinear leg (a waypoint
 *  moved between two others keeps both its legs at 45° multiples). */
export function octiPoint(p: XY, prev?: XY, next?: XY, grid: Grid = 'octi'): XY {
  if (!prev || !next) return prev ?? next ? snapDir((prev ?? next)!, p, grid) : p
  const ds = DIRS[grid].slice(0, DIRS[grid].length / 2)
  let best: XY = snapDir(prev, p, grid), bd = Infinity
  for (const u of ds) for (const v of ds) {
    const den = u[0] * v[1] - u[1] * v[0]
    if (Math.abs(den) < EPS) continue
    // prev + u a = next + v b
    const w = sub(next, prev), a = (w[0] * v[1] - w[1] * v[0]) / den, q: XY = [prev[0] + u[0] * a, prev[1] + u[1] * a]
    if (dist(q, p) < bd) { bd = dist(q, p); best = q }
  }
  return best
}

/** Waypoint j moved by `by`: its unpinned neighbours, run by run, shift by the part of the move
 *  across their leg, so legs keep their directions (a leg along the move just stretches). */
export function carry(pts: XY[], j: number, by: XY, pinned: (i: number) => boolean): XY[] {
  const out = pts.slice()
  for (const step of [-1, 1]) {
    let d = by
    for (let i = j + step; i >= 0 && i < pts.length && !pinned(i); i += step) {
      const u = unit(sub(pts[i], pts[i - step])), n = left(u), k = dot(d, n)
      if (Math.abs(k) < 1e-6) break
      d = [n[0] * k, n[1] * k]
      out[i] = [pts[i][0] + d[0], pts[i][1] + d[1]]
    }
  }
  return out
}
