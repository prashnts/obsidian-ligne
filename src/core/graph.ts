// The metro graph read back out of drawn elements, and its text form.
// Elements are Excalidraw-shaped, but only these fields are read, so any host with them works.
import { nearest, type XY } from './geom.ts'

export type Shape = 'stop' | 'interchange' | 'commit' | 'net'

/** Where a waypoint sits on another line's lane: that line, leg, fraction along it, offset left. */
export interface Link { of: string, i: number, t: number, d: number }

/** customData.ligne of a line or zone: waypoints relative to the element's x, y, a bend radius per
 *  waypoint (else r), waypoints that follow a lane of another line, extras drawn with it. */
export interface LineData {
  kind: 'line' | 'zone', path: XY[], r: number, radii?: number[], links?: (Link | null)[], from?: string,
  twist?: boolean, ticks?: boolean, arrow?: boolean, own?: string, stack?: string,
  box?: [number, number, number, number],
}
/** customData.ligne of a station dot; its label is the text element in the same group. */
export interface StationData { kind: 'station', line?: string, shape: Shape }

export interface El {
  id: string, type: string, x: number, y: number, width: number, height: number, isDeleted?: boolean
  strokeColor?: string, strokeWidth?: number, strokeStyle?: string, backgroundColor?: string, points?: readonly XY[], text?: string, groupIds?: readonly string[], customData?: any
}

export interface Line { id: string, color: string, width: number, dash: string, path: XY[], from?: string }
export interface Zone { id: string, color: string, fill: string, path: XY[] }
export interface Station {
  id: string, line?: string, shape: Shape, at: XY, label: string, data: Record<string, string>, km?: number
}
export interface Graph { lines: Line[], stations: Station[], zones: Zone[] }

const abs = (e: El, ps: readonly XY[]) => ps.map(([x, y]) => [x + e.x, y + e.y] as XY)
const kind = (e: El) => !e.isDeleted && e.customData?.ligne?.kind

/** Label = first line of the text; `key: value` or `key=value` lines below it are data. */
export function parseLabel(text: string): { label: string, data: Record<string, string> } {
  const [label = '', ...rest] = text.split('\n'), data: Record<string, string> = {}
  for (const l of rest) {
    const m = l.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/)
    if (m) data[m[1]] = m[2]
  }
  return { label: label.trim(), data }
}

/** Distance along a polyline up to the point nearest p. */
function along(pts: XY[], p: XY) {
  const n = nearest(pts, p)
  let s = 0
  for (let i = 0; i < n.i; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  return s + Math.hypot(n.q[0] - pts[n.i][0], n.q[1] - pts[n.i][1])
}

export function graph(elements: readonly El[]): Graph {
  const lines: Line[] = [], zones: Zone[] = [], drawn = new Map<string, XY[]>()
  for (const e of elements) {
    const d = e.customData?.ligne as LineData, k = kind(e)
    if (k === 'zone')
      zones.push({ id: e.id, color: e.strokeColor ?? '', fill: e.backgroundColor ?? '', path: abs(e, d.path) })
    if (k !== 'line') continue
    lines.push({ id: e.id, color: e.strokeColor ?? '', width: e.strokeWidth ?? 2, dash: e.strokeStyle ?? 'solid',
      path: abs(e, d.path), from: d.from })
    drawn.set(e.id, abs(e, e.points ?? d.path))
  }
  const texts = elements.filter(e => e.type === 'text' && !e.isDeleted)
  const stations: Station[] = []
  for (const e of elements) {
    if (kind(e) !== 'station') continue
    const d = e.customData.ligne as StationData
    const at: XY = d.shape === 'net' && e.points ? abs(e, [e.points[0]])[0] : [e.x + e.width / 2, e.y + e.height / 2]
    const t = texts.find(t => t.groupIds?.some(g => e.groupIds?.includes(g)))
    const pts = d.line ? drawn.get(d.line) : undefined
    stations.push({ id: e.id, line: d.line, shape: d.shape, at, ...parseLabel(t?.text ?? ''),
      km: pts && Math.round(along(pts, at)) })
  }
  // stations in order along their line
  stations.sort((a, b) => (a.line ?? '').localeCompare(b.line ?? '') || (a.km ?? 0) - (b.km ?? 0))
  return { lines, stations, zones }
}

const xy = (p: XY) => `${Math.round(p[0])},${Math.round(p[1])}`
const q = (s: string) => /[\s"=]/.test(s) || !s ? JSON.stringify(s) : s

/** One block per line: its waypoints, then its stations in order; loose stations last.
 *    line Ab3 #1e1e1e w=4 dashed from=Xy9
 *      200,200 400,200 500,300
 *      interchange "J3 · FFC 20p" @400,200 km=200 pitch=0.5mm
 */
export function toText(g: Graph): string {
  const st = (s: Station) => `  ${s.shape} ${q(s.label)} @${xy(s.at)}` + (s.km === undefined ? '' : ` km=${s.km}`)
    + Object.entries(s.data).map(([k, v]) => ` ${q(k)}=${q(v)}`).join('')
  const out: string[] = []
  for (const l of g.lines) {
    const dash = l.dash === 'solid' ? '' : ' ' + l.dash, from = l.from ? ` from=${l.from}` : ''
    out.push(`line ${l.id} ${l.color} w=${l.width}${dash}${from}`, '  ' + l.path.map(xy).join(' '))
    out.push(...g.stations.filter(s => s.line === l.id).map(st))
  }
  const loose = g.stations.filter(s => !s.line || !g.lines.some(l => l.id === s.line))
  if (loose.length) out.push('stations', ...loose.map(st))
  for (const z of g.zones) out.push(`zone ${z.id} ${z.color} fill=${z.fill}`, '  ' + z.path.map(xy).join(' '))
  return out.join('\n') + '\n'
}
