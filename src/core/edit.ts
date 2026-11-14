// Editing a drawn line: a leg moved sideways (its neighbours stretch, keeping their directions), a
// jog put into a leg, a bend taken out, and room made for the fittings at the ends (a connector
// needs a straight run before the first bend).
import { dirsOf, dist, kept, snapDir, unit, type Grid, type XY } from './geom.ts'

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const add = (p: XY, v: XY, k = 1): XY => [p[0] + v[0] * k, p[1] + v[1] * k]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const left = (u: XY): XY => [-u[1], u[0]]
const EPS = 1e-6

/** Waypoint data that travels with the waypoints: per-point arrays, kept in step on edits. */
export interface Along { radii: number[], links?: (any | null)[], folds?: boolean[] }

/** Leg k's left normal. */
export const legNormal = (pts: XY[], k: number): XY => left(unit(sub(pts[k + 1], pts[k])))

/** How a waypoint at the end of leg k moves when the leg goes d sideways: along its other leg (so
 *  that leg keeps its direction), or straight across at an end of the line. `pin`: it may not move. */
function slide(pts: XY[], k: number, j: number, closed: boolean) {
  const n = pts.length, nk = legNormal(pts, k)
  // the other leg at waypoint j, as a direction pointing away from leg k
  let o: number | undefined = j === k ? j - 1 : j + 1
  if (closed && o < 0) o = n - 2
  if (closed && o > n - 1) o = 1
  if (o < 0 || o > n - 1) return { v: nk, per: 1, len: Infinity }       // an end: straight across
  const v = unit(sub(pts[j], pts[o])), c = dot(v, nk)
  if (Math.abs(c) < EPS) return undefined                                 // along leg k: cannot take it
  // moving d across moves j by d / c along v; the other leg's length grows by that much
  return { v, per: 1 / c, len: dist(pts[j], pts[o]) }
}

/** Leg k moved d to its left (clamped so that no neighbouring leg gets shorter than `min`). Ends of
 *  the line move straight across with it unless pinned (then nothing moves: undefined). A closed
 *  path (zone, first point = last) wraps around. */
export function shiftLeg(pts: XY[], k: number, d: number, o: { pinned?: (i: number) => boolean, min?: number } = {}):
  { pts: XY[], d: number } | undefined {
  const n = pts.length, closed = n > 3 && dist(pts[0], pts[n - 1]) < EPS, min = o.min ?? 0
  if (k < 0 || k > n - 2) return
  const ends = [k, k + 1].map(j => ({ j, s: slide(pts, k, j, closed) }))
  if (ends.some(e => !e.s)) return
  if (ends.some(({ j }) => o.pinned?.(j))) return
  // clamp: each other leg stays at least min long
  let lo = -Infinity, hi = Infinity
  for (const { s } of ends) {
    if (s!.len === Infinity) continue
    // its length becomes len + d * per >= min
    const lim = (min - s!.len) / s!.per
    if (s!.per > 0) lo = Math.max(lo, lim); else hi = Math.min(hi, lim)
  }
  if (lo > hi) return
  d = Math.max(lo, Math.min(hi, d))
  const out = pts.slice()
  for (const { j, s } of ends) {
    const q = add(pts[j], s!.v, d * s!.per)
    out[j] = q
    if (closed && j === 0) out[n - 1] = q
    if (closed && j === n - 1) out[0] = q
  }
  return { pts: out, d }
}

/** The grid direction a step d sideways off leg direction u takes: the one most along u that goes
 *  that way across (45° on the octilinear grid, 60° or 30° on the isometric one). */
function stepDir(u: XY, d: number, grid: Grid): XY {
  const nl = left(u), side = Math.sign(d) || 1
  let best: XY = nl, b = -Infinity
  for (const v of dirsOf(grid)) {
    const across = dot(v, nl) * side, on = dot(v, u)
    if (across > EPS && on > EPS && on > b) { b = on; best = v }
  }
  return best
}

/** A jog into leg k at `at` (on the leg): from there the rest of the leg runs d to its left, after
 *  a step along the grid. Two waypoints are put in after waypoint k; their data is `fill`. */
export function jog(pts: XY[], k: number, at: XY, d: number, grid: Grid = 'octi'): XY[] | undefined {
  const n = pts.length, closed = n > 3 && dist(pts[0], pts[n - 1]) < EPS
  const a = pts[k], b = pts[k + 1], L = dist(a, b), u = unit(sub(b, a)), t = dot(sub(at, a), u)
  if (t <= EPS || t >= L - EPS || Math.abs(d) < EPS) return
  const v = stepDir(u, d, grid), nl = left(u), q0 = add(a, u, t), q1 = add(q0, v, d / dot(v, nl))
  if (dot(sub(q1, a), u) >= L - EPS) return
  // the leg's far end moves d across, along the leg after it (an end of the line: straight across)
  const s = slide(pts, k, k + 1, closed)
  if (!s || s.len + d * s.per < 0) return
  const b1 = add(b, s.v, d * s.per), out = [...pts.slice(0, k + 1), q0, q1, b1, ...pts.slice(k + 2)]
  if (closed && k + 1 === n - 1) out[0] = b1
  return out
}

/** Interior waypoint i taken out, when the leg from its neighbour before to the one after runs on
 *  the grid; else undefined. */
export function dropBend(pts: XY[], i: number, grid: Grid = 'octi'): XY[] | undefined {
  if (i <= 0 || i >= pts.length - 1) return
  const a = pts[i - 1], b = pts[i + 1]
  if (dist(snapDir(a, b, grid), b) > 1e-3 * Math.max(1, dist(a, b))) return
  return [...pts.slice(0, i), ...pts.slice(i + 1)]
}

/** Per-point data with waypoints inserted after index k (n of them) or removed at i. */
export function spliceAlong(al: Along, at: number, remove: number, insert: number, r: number): Along {
  const f = <T>(arr: T[] | undefined, v: T) => {
    if (!arr) return arr
    const c = arr.slice()
    c.splice(at, remove, ...Array(insert).fill(v))
    return c
  }
  return { radii: f(al.radii, r)!, links: f(al.links, null), folds: f(al.folds, false) }
}

/** Repeated and collinear waypoints dropped after an edit, their data along. Pinned points (links,
 *  folds) stay. */
export function tidyAlong(pts: XY[], al: Along): { pts: XY[], al: Along } {
  const keep = kept(pts, i => !!al.links?.[i] || !!al.folds?.[i])
  const pick = <T>(arr: T[] | undefined) => arr && keep.map(i => arr[i])
  return { pts: keep.map(i => pts[i]), al: { radii: pick(al.radii)!, links: pick(al.links), folds: pick(al.folds) } }
}

/** Room for the fittings: the first leg at least need0 long, the last need1, by moving the leg
 *  next to it (its far bend slides along the short leg, legs keep their directions). Ends stay put.
 *  Returns the points and what is still missing at each end. */
export function roomy(pts: XY[], need0: number, need1: number, pinned: (i: number) => boolean = () => false):
  { pts: XY[], short: [number, number] } {
  let out = pts.slice()
  const n = out.length, pin = (i: number) => i === 0 || i === n - 1 || pinned(i)
  const fix = (end: 0 | 1, need: number) => {
    if (need <= 0 || out.length < 3) return
    const [e, b, k] = end ? [n - 1, n - 2, n - 3] : [0, 1, 1]
    const L = dist(out[e], out[b]), miss = need - L
    if (miss <= EPS) return
    // the bend b slides away from the end by miss, along the short leg
    const u = unit(sub(out[b], out[e])), nk = legNormal(out, k), want = miss * dot(u, nk)
    const r = shiftLeg(out, k, want, { pinned: pin })
    if (r) out = r.pts
  }
  fix(0, need0)
  fix(1, need1)
  const first = dist(out[0], out[1]), last = dist(out[n - 1], out[n - 2])
  return { pts: out, short: [Math.max(0, need0 - first), Math.max(0, need1 - last)] }
}
