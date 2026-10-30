// Line elements: a ligne line is one Excalidraw line (or arrow) over its rounded waypoints, plus
// extras drawn with it (the second strand of a twisted pair, direction ticks), grouped. Lines that
// follow a lane of another line are rebuilt when that line changes (restack).
import { concentric, dist, offsetAt, round, twist, type XY } from './core/geom.ts'
import type { LineData } from './core/graph.ts'
import { bump, groupId, styleOf, type Convert, type Style } from './make.ts'

/** A line to build: like its customData, with absolute waypoints and a radius for each. */
export type Spec = Omit<LineData, 'path' | 'radii' | 'box'> & { path: XY[], radii: number[] }

export const dataOf = (e: any) => e.customData?.ligne as LineData | undefined
export const isLine = (e: any, zones = false) =>
  !e.isDeleted && (dataOf(e)?.kind === 'line' || zones && dataOf(e)?.kind === 'zone')
export const pathOf = (e: any) => dataOf(e)!.path.map(([x, y]) => [x + e.x, y + e.y] as XY)
export const radiiOf = (e: any) => { const d = dataOf(e)!; return d.radii ?? d.path.map(() => d.r) }
export const specOf = (e: any): Spec => ({ ...dataOf(e)!, path: pathOf(e), radii: radiiOf(e) })
const extraOf = (e: any, id: string) => !e.isDeleted && (e.customData?.ligne?.of === id)

/** Points bounding box: x, y, width, height. */
function box(pts: XY[]): [number, number, number, number] {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys)
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]
}

/** The line's elements: main first, then its extras. `base`: the element it replaces (same id). */
export function lineEls(convert: Convert, spec: Spec, st: Style, base?: any): any[] {
  const { path, radii, kind } = spec, w = st.strokeWidth as number
  // a zone starts mid first leg so that its first corner is rounded too
  const mid: XY = [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2]
  const drawn = kind === 'zone' ? round([mid, ...path.slice(1), mid], [0, ...radii.slice(1), 0]) : round(path, radii)
  const [a, b] = spec.twist ? twist(drawn, w * 1.2 + 1, Math.max(24, w * 8)) : [drawn]
  const [x, y] = path[0], rel = (p: XY): XY => [p[0] - x, p[1] - y]
  const own = spec.twist || spec.ticks ? spec.own ?? groupId() : undefined
  const groupIds = [...(own ? [own] : []),
    ...(base?.groupIds ?? []).filter((g: string) => g !== spec.own && g !== spec.stack),
    ...(spec.stack ? [spec.stack] : [])]
  const arrow = spec.arrow && kind === 'line'
  const data: LineData = { ...spec, path: path.map(rel), radii, own, box: box(a.map(rel)) }
  if (!spec.links?.some(Boolean)) delete data.links
  // a zone without a fill of its own is tinted with its stroke colour
  const tint = kind === 'zone' && !base && st.backgroundColor === 'transparent' && /^#[0-9a-f]{6}$/i.test(st.strokeColor)
  const [made] = convert([{ type: arrow ? 'arrow' : 'line', x, y, points: a.map(rel), ...st, roundness: null,
    startArrowhead: arrow ? st.startArrowhead : null, endArrowhead: arrow ? st.endArrowhead ?? 'arrow' : null,
    ...(tint ? { backgroundColor: st.strokeColor + '33', fillStyle: 'solid' } : {}),
    groupIds, customData: { ligne: data } }])
  const main = base ? { ...made, id: base.id, version: base.version + 1 } : made
  const extra = (skel: object, kind: string) =>
    ({ ...skel, roughness: st.roughness, opacity: st.opacity, roundness: null, groupIds,
      customData: { ligne: { kind, of: main.id } } })
  const extras: any[] = []
  if (b) extras.push(extra({ type: 'line', x, y, points: b.map(rel), strokeWidth: w, strokeStyle: st.strokeStyle,
    strokeColor: st.backgroundColor === 'transparent' ? st.strokeColor : st.backgroundColor }, 'strand'))
  if (spec.ticks) for (let i = 0; i < path.length - 1; i++) {
    // a small arrow beside the middle of every long enough leg, on the right of travel
    const p = path[i], q = path[i + 1], l = dist(p, q), u: XY = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]
    if (l < 60 + (radii[i] ?? 0) + (radii[i + 1] ?? 0)) continue
    const o = w / 2 + (spec.twist ? w : 0) + 8, c: XY = [(p[0] + q[0]) / 2 + u[1] * o, (p[1] + q[1]) / 2 - u[0] * o]
    extras.push(extra({ type: 'arrow', x: c[0] - u[0] * 7, y: c[1] - u[1] * 7, points: [[0, 0], [u[0] * 14, u[1] * 14]],
      strokeWidth: 1, strokeColor: st.strokeColor, startArrowhead: null, endArrowhead: 'arrow' }, 'tick'))
  }
  return [main, ...convert(extras)]
}

/** scene with the line els[0] (same id) and its extras swapped in, old extras deleted. */
export function replace(scene: readonly any[], els: any[]): any[] {
  const [main, ...extras] = els
  return scene.flatMap(e => e.id === main.id ? [main, ...extras] : extraOf(e, main.id) ? [bump(e, { isDeleted: true })] : [e])
}

/** Rebuilds the lines following lanes of line `id` (and theirs), after it changed in `scene`. */
export function restack(convert: Convert, scene: any[], id: string, depth = 0): any[] {
  const base = scene.find(e => e.id === id)
  if (!base || depth > 8) return scene
  const bp = pathOf(base), br = radiiOf(base)
  for (const e of scene.filter(e => isLine(e) && dataOf(e)!.links?.some(l => l?.of === id))) {
    const s = specOf(e)
    s.links!.forEach((l, j) => {
      if (l?.of !== id) return
      s.path[j] = offsetAt(bp, l.i, l.t, l.d)
      if (l.t === 0 && l.i > 0 && l.i < bp.length - 1) s.radii[j] = concentric(bp, br, l.d)[l.i]
    })
    scene = restack(convert, replace(scene, lineEls(convert, s, styleOf(e), e)), e.id, depth + 1)
  }
  return scene
}

/** Lines resized in Excalidraw: their waypoints are mapped onto the new box of the drawn points. */
export function resized(scene: readonly any[]): any[] | undefined {
  let hit = false
  const out = scene.map(e => {
    const d = isLine(e, true) ? dataOf(e)! : undefined
    if (!d?.box) return e
    const [x0, y0, w0, h0] = d.box, [x, y, w, h] = box(e.points)
    if (Math.abs(w - w0) < .5 && Math.abs(h - h0) < .5 && Math.abs(x - x0) < .5 && Math.abs(y - y0) < .5) return e
    const sx = w0 ? w / w0 : 1, sy = h0 ? h / h0 : 1
    hit = true
    const path = d.path.map(([px, py]) => [x + (px - x0) * sx, y + (py - y0) * sy] as XY)
    return bump(e, { customData: { ...e.customData, ligne: { ...d, path, box: [x, y, w, h] } } })
  })
  return hit ? out : undefined
}
