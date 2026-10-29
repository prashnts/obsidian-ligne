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

/** Drops repeated points and joins collinear legs. */
export function simplify(pts: XY[]): XY[] {
  const out: XY[] = []
  for (const p of pts) {
    if (out.length && same(out[out.length - 1], p)) continue
    if (out.length >= 2) {
      const u = unit(sub(out[out.length - 1], out[out.length - 2])), v = unit(sub(p, out[out.length - 1]))
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) < EPS && u[0] * v[0] + u[1] * v[1] > 0) out.pop()
    }
    out.push(p)
  }
  return out
}

/** Polyline with every bend replaced by an arc of radius ≤ r, sampled every ≤ `step` radians.
 *  The radius shrinks where legs are too short to hold it (two bends share a leg half and half). */
export function round(pts: XY[], r: number, step = Math.PI / 16): XY[] {
  if (pts.length < 3 || r <= 0) return pts.slice()
  const out: XY[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, v, n] = [pts[i - 1], pts[i], pts[i + 1]]
    const u1 = unit(sub(v, p)), u2 = unit(sub(n, v))
    const cross = u1[0] * u2[1] - u1[1] * u2[0], th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    if (th < EPS || Math.PI - th < EPS) { out.push(v); continue }
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
