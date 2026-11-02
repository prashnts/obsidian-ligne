// A line as data both editors keep, and the line through it: Excalidraw (customData.ligne, this repo) and Penpot
// (plugin data "ligne", ~/repo/vellum/plugins-src/ligne). One shape, JSON, so a line drawn in one reads in the other.
// In Excalidraw the colour, width and dash also live on the element; in Penpot only here (the drawn path is
// the user's own, the line is made from it). Dependency-free like the rest of core/.
import { lastDir, octi, round, simplify, type Grid, type XY } from './geom.ts'
import type { LineData } from './graph.ts'

export interface LineStyle { color: string, width: number, dash: 'solid' | 'dashed' | 'dotted' }

/** LineData with its style; `path` optional (Penpot: the source path is the geometry), stations at the stops,
 *  labels one a stop. */
export interface PortableLine extends Omit<LineData, 'path'> {
  path?: XY[], style: LineStyle, stations?: boolean, labels?: string[]
}

export const DEFAULT_LINE: PortableLine = {
  kind: 'line', r: 16, grid: 'octi', style: { color: '#E3242B', width: 6, dash: 'solid' }, stations: true, labels: [],
}

/** Read from JSON (customData or plugin data), defaults filled in; null when there's none. */
export function readLine(json: string | null | undefined): PortableLine | null {
  if (!json) return null
  const d = JSON.parse(json)
  return { ...DEFAULT_LINE, ...d, style: { ...DEFAULT_LINE.style, ...d.style } }
}

/** The line through the stops: between two stops legs on the grid (one bend at most), the bends rounded. */
export function lineThrough(stops: readonly XY[], r: number, grid: Grid = 'octi'): XY[] {
  const pts: XY[] = stops.length ? [stops[0]] : []
  for (let i = 1; i < stops.length; i++)
    pts.push(...octi(pts[pts.length - 1], stops[i], undefined, lastDir(pts), grid).slice(1))
  return round(simplify(pts), r)
}
