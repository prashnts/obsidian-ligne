// Octilinear geometry: legs run at multiples of 45°, bends are rounded by circular arcs.
export type XY = [number, number]

const EPS = 1e-6
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const len = (v: XY) => Math.hypot(v[0], v[1])
const unit = (v: XY): XY => { const l = len(v) || 1; return [v[0] / l, v[1] / l] }
export const dist = (a: XY, b: XY) => len(sub(a, b))
export const same = (a: XY, b: XY) => dist(a, b) < EPS

/** Projects p onto the nearest of the 8 compass directions out of a. */
export function snap8(a: XY, p: XY): XY {
  const d = sub(p, a), k = Math.round(Math.atan2(d[1], d[0]) / (Math.PI / 4)) * Math.PI / 4
  const u: XY = [Math.round(Math.cos(k) * 1e9) / 1e9, Math.round(Math.sin(k) * 1e9) / 1e9]
  const t = d[0] * u[0] + d[1] * u[1]
  return [a[0] + u[0] * t, a[1] + u[1] * t]
}

/** a → b as one straight and one 45° leg. Which one comes first: `diagFirst`, or else the one
 *  turning least from the incoming direction `inDir` (metro lines avoid sharp turns). */
export function octi(a: XY, b: XY, diagFirst?: boolean, inDir?: XY): XY[] {
  const d = sub(b, a), m = Math.min(Math.abs(d[0]), Math.abs(d[1]))
  const diag: XY = [Math.sign(d[0]) * m, Math.sign(d[1]) * m]
  const viaDiag: XY = [a[0] + diag[0], a[1] + diag[1]], viaStraight: XY = [b[0] - diag[0], b[1] - diag[1]]
  if (diagFirst === undefined) {
    if (!inDir) diagFirst = false
    else {
      const turn = (p: XY) => { const u = unit(sub(p, a)); return -(u[0] * inDir[0] + u[1] * inDir[1]) }
      diagFirst = turn(viaDiag) < turn(viaStraight)
    }
  }
  const mid = diagFirst ? viaDiag : viaStraight
  return same(mid, a) || same(mid, b) ? [a, b] : [a, mid, b]
}

/** Unit direction of the last leg, if any. */
export const lastDir = (pts: XY[]): XY | undefined =>
  pts.length < 2 ? undefined : unit(sub(pts[pts.length - 1], pts[pts.length - 2]))

/** Indices of the points kept when dropping repeated points and joining collinear legs. */
export function kept(pts: XY[]): number[] {
  const out: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], at = (k: number) => pts[out[out.length - k]]
    if (out.length && same(at(1), p)) continue
    if (out.length >= 2) {
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

/** Twisted pair along a (rounded) polyline: two strands crossing every `pitch`, ±amp apart. */
export function twist(pts: XY[], amp: number, pitch: number): [XY[], XY[]] {
  const a: XY[] = [], b: XY[] = [], step = pitch / 8
  let s = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], l = dist(p, pts[i + 1]), u = unit(sub(pts[i + 1], p)), nl = left(u)
    for (let x = 0; x < l || (i === pts.length - 2 && x <= l); x += step) {
      const k = Math.min(x, l), w = amp * Math.sin(Math.PI * (s + k) / pitch)
      const q: XY = [p[0] + u[0] * k, p[1] + u[1] * k]
      a.push([q[0] + nl[0] * w, q[1] + nl[1] * w]); b.push([q[0] - nl[0] * w, q[1] - nl[1] * w])
      if (k === l) break
    }
    s += l
  }
  return [a, b]
}
