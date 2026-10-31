// Line elements: a ligne line is one Excalidraw line (or arrow) over its rounded waypoints, plus
// extras drawn with it in its own group (cable strands and checks, direction chevrons). Lines that
// follow a lane of another line are rebuilt when that line changes (restack). Lines are found by
// lid and groups, never by element id alone: Excalidraw re-ids elements on paste and duplicate.
import { cable, cableWidth, chevrons, type Cable, type Piece } from './core/cable.ts'
import { flat, isFlat } from './core/flat.ts'
import { carry, concentric, dist, offsetAt, round, type XY } from './core/geom.ts'
import type { LineData } from './core/graph.ts'
import type { Body } from './core/snap.ts'
import { bump, groupId, shortId, styleOf, type Convert, type Style } from './make.ts'

/** A line to build: like its customData, with absolute waypoints and a radius for each. */
export type Spec = Omit<LineData, 'path' | 'radii' | 'box' | 'np' | 'twist'> & { path: XY[], radii: number[] }

export const dataOf = (e: any) => e.customData?.ligne as LineData | undefined
export const isLine = (e: any, zones = false) =>
  !e.isDeleted && (dataOf(e)?.kind === 'line' || zones && dataOf(e)?.kind === 'zone')
export const lidOf = (e: any) => dataOf(e)?.lid ?? e.id
export const pathOf = (e: any) => dataOf(e)!.path.map(([x, y]) => [x + e.x, y + e.y] as XY)
export const radiiOf = (e: any) => { const d = dataOf(e)!; return d.radii ?? d.path.map(() => d.r) }

/** The line's cable, also from a twisted pair made before cables. */
export function cableOf(e: any): Cable | undefined {
  const d = dataOf(e)
  return d?.cable ?? (d?.twist ? { style: 'round', n: 2, pitch: Math.max(24, e.strokeWidth * 8) } : undefined)
}

/** Its own group and its stack group, read from the element: Excalidraw renames groups on paste. */
const groupsOf = (e: any) => {
  const d = dataOf(e)!, g: string[] = e.groupIds ?? []
  return { own: d.own ? g[0] : undefined, stack: d.stack ? g.at(-1) : undefined }
}

export const specOf = (e: any): Spec => {
  const { twist, np, box, ...d } = dataOf(e)!
  return { ...d, lid: lidOf(e), ...groupsOf(e), cable: cableOf(e), path: pathOf(e), radii: radiiOf(e) }
}

/** Edited outside ligne (points added or removed in Excalidraw's line editor): its waypoints no
 *  longer describe it, so ligne leaves it alone. */
export const stale = (e: any) => { const d = dataOf(e); return !!d?.np && e.points.length !== d.np }

/** Its rounded centre line, absolute. */
export const centre = (e: any) => round(pathOf(e), radiiOf(e))

/** Width it takes up: the cable's body, else the stroke. */
export const bodyWidth = (e: any) => { const c = cableOf(e); return c ? cableWidth(c, e.strokeWidth) : e.strokeWidth }

/** The line as snapping sees it. */
export const bodyOf = (e: any): Body =>
  ({ id: lidOf(e), path: pathOf(e), drawn: centre(e), width: bodyWidth(e), cable: !!cableOf(e) })

/** The line with lid `ref` (or element id, before lids); of copies, the one sharing a group with `near`. */
export function findLine(scene: readonly any[], ref: string, near?: any): any {
  const all = scene.filter(e => isLine(e, true) && (dataOf(e)!.lid === ref || e.id === ref))
  return all.find(e => e.groupIds?.some((g: string) => near?.groupIds?.includes(g))) ?? all[0]
}

/** Points bounding box: x, y, width, height. */
function box(pts: readonly XY[]): [number, number, number, number] {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys)
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]
}

/** A linear element over absolute points as Excalidraw keeps them: the first point at its x, y. */
function placed(pts: XY[]) {
  const [x, y] = pts[0], points = pts.map(p => [p[0] - x, p[1] - y] as XY), [, , width, height] = box(points)
  return { x, y, points, width, height }
}

/** The second colour of a cable: the background one, else white for checks, the stroke for twists. */
const second = (st: Style, c: Cable) =>
  st.backgroundColor !== 'transparent' ? st.backgroundColor : c.style === 'checks' ? '#ffffff' : st.strokeColor

/** The line's elements: main first, then its extras. `base`: the element it replaces (same id). */
export function lineEls(convert: Convert, spec: Spec, st: Style, base?: any): any[] {
  const { path, radii, kind } = spec, w = st.strokeWidth as number, c = kind === 'line' ? spec.cable : undefined
  // a zone starts mid first leg so that its first corner is rounded too
  const mid: XY = [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2]
  const drawn = kind === 'zone' ? round([mid, ...path.slice(1), mid], [0, ...radii.slice(1), 0]) : round(path, radii)
  // a flat cable's colours are its own: the main element is its first band, outlined in the line colour
  const fl = isFlat(c), pieces: Piece[] = !c ? [{ pts: drawn, color: 0 }]
    : fl ? flat(path, radii, c, st.strokeColor, '#ffffff') : cable(drawn, c, w).pieces
  const own = pieces.length > 1 || spec.ticks ? spec.own ?? groupId() : undefined
  const groupIds = [...(own ? [own] : []),
    ...(base?.groupIds ?? []).filter((g: string) => g !== spec.own && g !== spec.stack),
    ...(spec.stack ? [spec.stack] : [])]
  const arrow = spec.arrow && kind === 'line' && !c
  const at = placed(pieces[0].pts), rel = (p: XY): XY => [p[0] - at.x, p[1] - at.y]
  const data: LineData = { ...spec, lid: spec.lid ?? shortId(), path: path.map(rel), radii, own, np: at.points.length,
    box: box(at.points) }
  if (!spec.links?.some(Boolean)) delete data.links
  // a zone without a fill of its own is tinted with its stroke colour
  const tint = kind === 'zone' && !base && st.backgroundColor === 'transparent' && /^#[0-9a-f]{6}$/i.test(st.strokeColor)
  const [made] = convert([{ type: arrow ? 'arrow' : 'line', ...at, ...st,
    roundness: null, startArrowhead: arrow ? st.startArrowhead : null, endArrowhead: arrow ? st.endArrowhead ?? 'arrow' : null,
    ...(tint ? { backgroundColor: st.strokeColor + '33', fillStyle: 'solid' } : {}),
    ...(fl ? { backgroundColor: pieces[0].color, fillStyle: 'solid', strokeWidth: pieces[0].width, strokeStyle: 'solid',
      roughness: 0 } : {}),
    groupIds, customData: { ligne: data } }])
  const main = base ? { ...made, id: base.id, version: base.version + 1 } : made
  const extra = (pts: XY[], skel: object, kind: string) => ({ type: 'line', ...placed(pts), roughness: st.roughness, ...skel,
    opacity: st.opacity, roundness: null, groupIds, startArrowhead: null, endArrowhead: null,
    customData: { ligne: { kind, of: main.id } } })
  const extras: any[] = []
  if (c) for (const p of pieces.slice(1)) {
    const color = typeof p.color === 'string' ? p.color : p.color ? second(st, c) : st.strokeColor
    extras.push(extra(p.pts, p.fill
      ? { strokeColor: p.stroke ?? 'transparent', backgroundColor: color, fillStyle: 'solid', strokeWidth: p.width ?? 1,
        roughness: 0 }
      : { strokeColor: color, strokeWidth: p.width ?? w, strokeStyle: p.dash ? 'dashed' : fl ? 'solid' : st.strokeStyle,
        ...(fl ? { roughness: 0 } : {}) }, 'strand'))
  }
  if (spec.ticks) {
    // chevrons on the line, pointing the way it was drawn: light on thick lines, in its colour on thin ones
    const bw = c ? cableWidth(c, w) : w, thick = bw >= 4
    const light = st.backgroundColor !== 'transparent' && !c ? st.backgroundColor : '#ffffff'
    for (const v of chevrons(drawn, thick ? bw * 0.35 : 4, Math.max(48, bw * 12)))
      extras.push(extra(v, { strokeColor: thick ? light : st.strokeColor,
        strokeWidth: thick ? Math.max(1, bw / 4) : 1.5, strokeStyle: 'solid' }, 'tick'))
  }
  return [main, ...convert(extras)]
}

/** Whether e is an extra drawn with line `main`: in its own group (or, before that, by id). */
function extraOf(e: any, main: any) {
  const k = e.customData?.ligne?.kind
  if (e.isDeleted || (k !== 'strand' && k !== 'tick')) return false
  const own = dataOf(main)?.own && main.groupIds?.[0]
  return own ? e.groupIds?.[0] === own : e.customData.ligne.of === main.id
}

/** scene with the line els[0] (same id) and its extras swapped in, old extras deleted. */
export function replace(scene: readonly any[], els: any[]): any[] {
  const [main, ...extras] = els, old = scene.find(e => e.id === main.id)
  return scene.flatMap(e => e.id === main.id ? [main, ...extras]
    : old && extraOf(e, old) ? [bump(e, { isDeleted: true })] : [e])
}

/** Rebuilds the lines following lanes of line `id` (and theirs), after it changed in `scene`. A
 *  waypoint on a lane goes where the lane went; its free neighbours shift with it so that their
 *  legs keep their directions. */
export function restack(convert: Convert, scene: any[], id: string, depth = 0): any[] {
  const base = scene.find(e => e.id === id)
  if (!base || depth > 8) return scene
  const lid = lidOf(base), bp = pathOf(base), br = radiiOf(base)
  const on = (e: any) => dataOf(e)!.links?.some(l => l?.of === lid && findLine(scene, lid, e) === base)
  for (const e of scene.filter(e => e !== base && isLine(e) && !stale(e) && on(e))) {
    const s = specOf(e), links = s.links!
    links.forEach((l, j) => {
      if (!l || l.of !== lid) return
      const to = offsetAt(bp, l.i, l.t, l.d), by: XY = [to[0] - s.path[j][0], to[1] - s.path[j][1]]
      s.path = carry(s.path, j, by, i => !!links[i])
      s.path[j] = to
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
    const d = isLine(e, true) && !stale(e) ? dataOf(e)! : undefined
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

/** Lines from before lids get one (their id), and links whose line is gone (an older paste re-id'd
 *  it) are found again by where they sit: the line whose lane passes through the waypoint. */
export function relink(scene: readonly any[]): any[] | undefined {
  const lines = scene.filter(e => isLine(e, true) && !stale(e))
  let hit = false
  const out = scene.map(e => {
    if (!lines.includes(e)) return e
    const d = dataOf(e)!, path = pathOf(e)
    const lost = d.links?.some(l => l && !findLine(lines, l.of, e))
    if (d.lid && !lost) return e
    const find = (l: NonNullable<LineData['links']>[number], j: number) => {
      if (!l || findLine(lines, l.of, e)) return l
      const m = lines.find(o => o !== e && dist(offsetAt(pathOf(o), l.i, l.t, l.d), path[j]) < 1)
      return m ? { ...l, of: lidOf(m) } : null
    }
    hit = true
    return bump(e, { customData: { ...e.customData, ligne: { ...d, lid: d.lid ?? e.id,
      ...(lost ? { links: d.links!.map(find) } : {}) } } })
  })
  return hit ? out : undefined
}
