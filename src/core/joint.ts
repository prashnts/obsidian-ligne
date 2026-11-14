// Joints in a harness: where a line ends and others go on from it (a ribbon into loose wires, a
// jacket into a pigtail, coax to coax), a sleeve covers the change: heat-shrink tube, a moulded
// breakout boot, or a crimped butt splice. The sleeve belongs to the line that ends; the lines going
// on start under it.
import { box, type Piece } from './cable.ts'
import { MM } from './flat.ts'
import { pointAt, type XY } from './geom.ts'

export type JointKind = 'shrink' | 'boot' | 'splice'
export const JOINTS: JointKind[] = ['shrink', 'boot', 'splice']
export const JOINT_NAMES: Record<JointKind, string> = { shrink: 'heat-shrink', boot: 'boot', splice: 'splice' }
/** A joint at a line's end: its kind, how wide it has to be (the widest line through it). */
export interface Joint { kind: JointKind, w?: number }

const add = (p: XY, v: XY, k = 1): XY => [p[0] + v[0] * k, p[1] + v[1] * k]
const left = (u: XY): XY => [-u[1], u[0]]

/** How far a joint reaches back over the line that ends (b) and on over the lines going on (f), px.
 *  `w`: the width it covers, `scale`: true size × (cables), 1 for plain lines. */
export function jointReach(j: Joint, w: number, scale = 1): { b: number, f: number } {
  const k = MM * scale, W = Math.max(w, j.w ?? 0)
  if (j.kind === 'splice') return { b: Math.max(4 * k, W * 1.5), f: Math.max(4 * k, W * 1.5) }
  if (j.kind === 'boot') return { b: Math.max(5 * k, W * 1.2), f: Math.max(8 * k, W * 1.6) }
  return { b: Math.max(6 * k, W * 1.5), f: Math.max(6 * k, W * 1.5) }
}

/** The joint's pieces at an end of `drawn` (the line's drawn centre line), `w` wide. */
export function joint(drawn: XY[], end: 'start' | 'end', j: Joint, w: number, color: string, scale = 1): Piece[] {
  const { p, u: t } = pointAt(drawn, end === 'start' ? 0 : Infinity), u: XY = end === 'start' ? [-t[0], -t[1]] : t
  const n = left(u), k = MM * scale, W = Math.max(w, j.w ?? 0), { b, f } = jointReach(j, w, scale)
  const line = Math.max(.5, .12 * k), back = add(p, u, -b)
  if (j.kind === 'shrink') {
    const wall = Math.max(.6 * k, W * .12), D = W + 2 * wall
    return [box(back, u, b + f, D, '#25262b', '#000000', line, D / 2.5),
      { pts: [add(add(back, n, D * .22), u, D * .3), add(add(back, n, D * .22), u, b + f - D * .3)], color: '#5c5f66',
        width: Math.max(.5, D * .08) }]
  }
  if (j.kind === 'boot') {
    // tapers from the cable that ends out to the spread of the ones going on
    const a = W * .5 + .8 * k, c = W * .75 + 1.2 * k, s = Math.min(b * .5, 2 * k)
    const pts: XY[] = [add(back, n, a * .8), add(add(back, u, s), n, a), add(add(p, u, f * .2), n, a),
      add(add(p, u, f), n, c), add(add(p, u, f), n, -c), add(add(p, u, f * .2), n, -a), add(add(back, u, s), n, -a),
      add(back, n, -a * .8)]
    return [{ pts: [...pts, pts[0]], color: color, fill: true, stroke: '#000000', width: line },
      { pts: [add(add(back, u, s), n, a * .45), add(add(p, u, f * .9), n, c * .55)], color: '#ffffff', width: line * 1.5 }]
  }
  // a butt splice: a clear sleeve, the metal barrel inside, crimp marks
  const D = W + 2 * Math.max(.8 * k, W * .2)
  const out: Piece[] = [box(back, u, b + f, D, '#e9ecef', '#adb5bd', line, D / 3),
    box(add(back, u, b * .35), u, (b + f) - b * .7, W + .6 * k, '#ced4da', '#868e96', line)]
  for (const x of [b * .6, b + f * .4]) out.push({ pts: [add(add(back, u, x), n, (W + .6 * k) / 2),
    add(add(back, u, x), n, -(W + .6 * k) / 2)], color: '#868e96', width: line * 2 })
  return out
}
