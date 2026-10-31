// Cables: n strands of width w along a line, twisted (round or zigzag) or side by side with colour
// checks. Each end may fan out into legs, one per strand, each to its own point. Output is plain
// pieces (polylines and filled polygons) in two colours, for any host to draw.
import { dist, lengths, normals, octi, pointAt, resample, round, type XY } from './geom.ts'

export type CableStyle = 'round' | 'zigzag' | 'checks'
export const STYLES: CableStyle[] = ['round', 'zigzag', 'checks']

/** Per end, per strand: where its leg goes, relative to that end of the line (null: straight on). */
export interface Legs { start?: (XY | null)[], end?: (XY | null)[] }
/** `pitch`: length of one full twist, or of two checks. */
export interface Cable { style: CableStyle, n: number, pitch: number, legs?: Legs }

/** A polyline stroked w wide, or with `fill` a polygon; colour 0 is the line's, 1 the second one. */
export interface Piece { pts: XY[], color: 0 | 1, fill?: boolean }

/** Strand offsets, side by side and touching. */
export const offsets = (n: number, w: number) => Array.from({ length: n }, (_, j) => (j - (n - 1) / 2) * w)
const amp = (n: number, w: number) => (n - 1) * w / 2 + w / 4

/** Overall width of the cable body. */
export const cableWidth = (c: Cable, w: number) => c.style === 'checks' ? c.n * w : 2 * amp(c.n, w) + w

const wave = (x: number, zig: boolean) => zig ? 2 / Math.PI * Math.asin(Math.sin(x)) : Math.sin(x)
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

/** A strand: its points and, at each, the length along the cable (negative on the start legs). */
interface Strand { pts: XY[], s: number[] }

/** The cable over the (rounded) line `drawn`. Twists straighten out over half a pitch at both
 *  ends, so legs leave side by side. */
export function cable(drawn: XY[], c: Cable, w: number): { pieces: Piece[], tips: { start: XY[], end: XY[] } } {
  const L = lengths(drawn).at(-1) ?? 0, P = Math.max(4, c.pitch), zig = c.style === 'zigzag'
  const twisted = c.style !== 'checks', A = amp(c.n, w), os = offsets(c.n, w)
  const body = resample(drawn, Math.min(P / 12, 6)), ns = normals(body.pts)
  const strands: Strand[] = os.map((o, j) => {
    const f = (s: number) => {
      if (!twisted) return o
      const k = smooth(Math.min(s, L - s) / (P / 2))
      return o * (1 - k) + A * wave(2 * Math.PI * (s / P + j / c.n), zig) * k
    }
    return { pts: body.pts.map((p, i) => [p[0] + ns[i][0] * f(body.s[i]), p[1] + ns[i][1] * f(body.s[i])]), s: body.s }
  })
  // legs: from each strand's end out to its point, leaving along the line, then octilinear
  const legOut = (st: Strand, at: 'start' | 'end', to: XY | null | undefined) => {
    if (!to) return
    const k = at === 'start' ? 0 : st.pts.length - 1, e = st.pts[k], end = at === 'start' ? drawn[0] : drawn.at(-1)!
    const u = pointAt(drawn, at === 'start' ? 0 : L).u, dir: XY = at === 'start' ? [-u[0], -u[1]] : u
    const target: XY = [end[0] + to[0], end[1] + to[1]]
    if (dist(e, target) < 1e-6) return
    const leg = resample(round(octi(e, target, undefined, dir), 2 * w), Math.min(P / 12, 6))
    const s0 = st.s[k], sg = at === 'start' ? -1 : 1, pts = leg.pts.slice(1), s = leg.s.slice(1).map(v => s0 + sg * v)
    if (at === 'start') { st.pts.unshift(...pts.reverse()); st.s.unshift(...s.reverse()) }
    else { st.pts.push(...pts); st.s.push(...s) }
  }
  strands.forEach((st, j) => { legOut(st, 'start', c.legs?.start?.[j]); legOut(st, 'end', c.legs?.end?.[j]) })
  const pieces: Piece[] = strands.map((st, j) => ({ pts: st.pts, color: twisted ? (j % 2) as 0 | 1 : 0 }))
  // checks: every other check of every strand in the second colour, shifted strand to strand;
  // a twisted pair: the first strand back on top at every other crossing (over, under, over)
  const over = twisted
    ? c.n === 2 ? ribbons([strands[0]], w, P / 2, P / 4, k => k % 2 === 0) : []
    : ribbons(strands, w, P / 2, 0, (k, j) => (k + j) % 2 !== 0, j => os[j] < 0 ? 1 : -1)
  for (const pts of over) pieces.push({ pts, color: twisted ? 0 : 1, fill: true })
  return { pieces, tips: { start: strands.map(st => st.pts[0]), end: strands.map(st => st.pts.at(-1)!) } }
}

/** Per strand, one polygon of its stretches where on(k, j): k counts stretches of length `half`
 *  (shifted by `shift`) along strand j. A single filled element draws them all: the outline walks
 *  the strand's outer edge (side ±1) out and back, looping round each stretch on the way, so the
 *  joins have no area and their hairline falls outside the cable. */
export function ribbons(strands: Strand[], w: number, half: number, shift: number,
  on: (k: number, j: number) => boolean, side: (j: number) => number = () => 1): XY[][] {
  const out: XY[][] = []
  strands.forEach((st, j) => {
    // cut at every stretch boundary, so stretches end square
    const pts: XY[] = [st.pts[0]], s = [st.s[0]]
    const idx = (v: number) => Math.floor((v + shift) / half)
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i], sa = st.s[i - 1], sb = st.s[i]
      for (let k = Math.min(idx(sa), idx(sb)) + 1; k <= Math.max(idx(sa), idx(sb)); k++) {
        const v = k * half - shift, t = (v - sa) / (sb - sa)
        if (t > 1e-9 && t < 1 - 1e-9) { pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s.push(v) }
      }
      pts.push(b); s.push(sb)
    }
    const ns = normals(pts), sg = side(j)
    const at = (i: number, d: number): XY => [pts[i][0] + ns[i][0] * d, pts[i][1] + ns[i][1] * d]
    const edge = (i: number) => at(i, sg * w / 2), inner = (i: number) => at(i, -sg * w / 2)
    // runs of points whose segments are on (a segment belongs to the stretch of its middle)
    const runs: number[][] = []
    let run: number[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      if (on(idx((s[i] + s[i + 1]) / 2), j)) { if (!run.length) run.push(i); run.push(i + 1); continue }
      if (run.length) runs.push(run)
      run = []
    }
    if (run.length) runs.push(run)
    if (!runs.length) return
    const poly: XY[] = [edge(0)]
    let k = 0
    for (const r of runs) {
      for (let i = k + 1; i <= r[0]; i++) poly.push(edge(i))
      poly.push(...r.slice(1).map(edge), ...r.slice().reverse().map(inner), edge(r[0]))
      k = r[0]
    }
    for (let i = k - 1; i >= 0; i--) poly.push(edge(i))
    out.push(poly)
  })
  return out
}

/** Direction chevrons along a line: one every `every`, pointing along, h tall. */
export function chevrons(drawn: XY[], h: number, every: number): XY[][] {
  const L = lengths(drawn).at(-1) ?? 0, n = Math.floor(L / every), out: XY[][] = []
  for (let k = 0; k < n; k++) {
    const { p, u } = pointAt(drawn, (L - (n - 1) * every) / 2 + k * every), v: XY = [-u[1], u[0]]
    const back: XY = [p[0] - u[0] * h / 2, p[1] - u[1] * h / 2]
    out.push([[back[0] + v[0] * h, back[1] + v[1] * h], [p[0] + u[0] * h / 2, p[1] + u[1] * h / 2],
      [back[0] - v[0] * h, back[1] - v[1] * h]])
  }
  return out
}
