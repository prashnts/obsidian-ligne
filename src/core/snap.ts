// Snapping the pointer onto lanes: the free parallels beside drawn lines, touching them.
import { beside, dist, nearest, offsetAt, unit, type XY } from './geom.ts'

/** A drawn line as snapping sees it: waypoints, rounded centre line, body width, cable or not. */
export interface Body { id: string, path: XY[], drawn: XY[], width: number, cable: boolean }
/** A spot on a lane of line `id`: leg i, fraction t, offset d to the left, the point q. */
export interface LaneHit { id: string, i: number, t: number, d: number, q: XY }
/** The lane being followed and the leg last seen on it. */
export interface Track { of: string, d: number, i: number }

/** Centre to centre distance of two touching lines; cables keep a gap between them. */
export function gap(a: { width: number, cable: boolean }, b: { width: number, cable: boolean }) {
  const m = Math.min(a.width, b.width)
  return (a.width + b.width) / 2 + (a.cable || b.cable ? Math.max(4, m / 2) : Math.max(1, m / 2))
}

/** A bend is leg i at t = 0, never leg i - 1 at t = 1. */
function norm(path: XY[], i: number, t: number): [number, number] {
  return t > 1 - 1e-6 && i + 1 < path.length - 1 ? [i + 1, 0] : [i, t]
}

/** Lane spot nearest p, within tol of it (or `wide` where the lane runs along `dir`, so a leg
 *  drawn beside a line falls into its lane rather than just off it). While following `track`, it
 *  holds on to that lane up to `leave` away, searched only around the leg last seen, so the pointer
 *  never jumps to another part of the line or to another line's lane. A lane already taken by a
 *  line is not offered. `me.extra`: a wider gap, to set a line a little apart. */
export function laneAt(lines: Body[], p: XY, me: { width: number, cable: boolean, extra?: number }, o: {
  tol: number, wide?: number, dir?: XY, leave?: number, track?: Track }): LaneHit | undefined {
  const tr = o.track, held = tr && lines.find(l => l.id === tr.of)
  if (tr && held) {
    const a = Math.max(0, tr.i - 1), b = Math.min(held.path.length - 1, tr.i + 2)
    const r = beside(held.path.slice(a, b + 1), p), [i, t] = norm(held.path, r.i + a, r.t)
    const q = offsetAt(held.path, i, t, tr.d)
    if (dist(p, q) < (o.leave ?? 2 * o.tol)) return { id: held.id, i, t, d: tr.d, q }
  }
  let best: LaneHit | undefined, bd = Infinity
  for (const l of lines) {
    const r = beside(l.path, p), [i, t] = norm(l.path, r.i, r.t), d = (Math.sign(r.d) || 1) * (gap(l, me) + (me.extra ?? 0))
    const q = offsetAt(l.path, i, t, d), e = dist(p, q)
    const leg = unit([l.path[r.i + 1]?.[0] - l.path[r.i][0], l.path[r.i + 1]?.[1] - l.path[r.i][1]])
    const along = o.dir && Math.abs(leg[0] * o.dir[1] - leg[1] * o.dir[0]) < 1e-3
    if (e >= (along ? o.wide ?? o.tol : o.tol) || e >= bd) continue
    if (lines.some(m => m !== l && nearest(m.drawn, q).d < gap(m, me) * 0.75)) continue
    best = { id: l.id, i, t, d, q }; bd = e
  }
  return best
}
