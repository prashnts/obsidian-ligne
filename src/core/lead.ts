// Room at a cable's ends: a connector (or an FFC's stiffener) needs a straight run before the
// first bend, else it wraps round the corner. Lines are drawn and edited with that run kept free.
import type { Cable } from './cable.ts'
import { MM, flatFitting, flatWidth, isFlat, wirePitch } from './flat.ts'
import { fitting, jacketWidth } from './jacket.ts'
import { dist, type XY } from './geom.ts'

type End = 'start' | 'end'

/** The fitting's length along the line at an end, px (0: none). */
export function fittingOf(c: Cable | undefined, end: End): number {
  if (!c) return 0
  if (isFlat(c)) return flatFitting(c, end)
  if (c.style === 'jacket') return fitting(c, end)
  return 0
}

/** The radius a cable bends at for a set radius r: no tighter than its width allows. */
export function bendOf(c: Cable | undefined, r: number): number {
  if (!c || r <= 0) return r
  if (isFlat(c)) return Math.max(r, flatWidth(c) / 2 + wirePitch(c))
  if (c.style === 'jacket') return Math.max(r, jacketWidth(c) * 0.75)
  return r
}

/** The straight run each end of a line needs, px: its fitting, a little cable, and the part of
 *  the leg the first bend's arc takes. 0 at an end without a fitting. */
export function needs(path: XY[], radii: readonly number[], c: Cable | undefined): [number, number] {
  const n = path.length
  const at = (end: End, b: number) => {
    const f = fittingOf(c, end)
    if (!f) return 0
    const body = 4 * MM * (c!.scale ?? 1)
    if (b <= 0 || b >= n - 1) return f + body
    // the arc at bend b starts r tan(turn / 2) before it
    const [p, v, q] = [path[b - 1], path[b], path[b + 1]]
    const u1 = [(v[0] - p[0]) / dist(p, v), (v[1] - p[1]) / dist(p, v)], u2 = [(q[0] - v[0]) / dist(v, q), (q[1] - v[1]) / dist(v, q)]
    const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    return f + body + bendOf(c, radii[b] ?? 0) * Math.tan(th / 2)
  }
  return [at('start', 1), at('end', n - 2)]
}
