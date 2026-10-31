// Cables: n strands of width w along a line, twisted (round or zigzag) or side by side with colour
// checks; ribbons and FFC (flat.ts), jacketed round cables (jacket.ts), chevron bands. Each end may
// fan out into legs, one per strand, each to its own point, or all fanned out evenly. Output is plain pieces (polylines and filled polygons), for any host to draw.
import { MM, flatWidth, isFlat, type Conn, type WireSet } from './flat.ts'
import { dist, lengths, normals, octi, pointAt, resample, round, unit, type XY } from './geom.ts'

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]

export type CableStyle = 'round' | 'zigzag' | 'checks' | 'ribbon' | 'ffc' | 'jacket' | 'chevron'
export const STYLES: CableStyle[] = ['round', 'zigzag', 'checks', 'ribbon', 'ffc', 'jacket', 'chevron']

/** Per end, per strand: where its leg goes, relative to that end of the line (null: straight on). */
export interface Legs { start?: (XY | null)[], end?: (XY | null)[] }
/** `pitch`: length of one full twist, or of two checks. Flat cables (ribbon, ffc): `awg` (ribbon)
 *  or `mm` (FFC pitch), true size × `scale`; ribbon colours `set`, of which a split takes the wires
 *  `pick`; `folds` per waypoint (the first: starts back up); a connector at each end. A jacket: `mm`
 *  across, n wires inside, `shield` braid. Twisted ends `fan` out evenly: `gap` apart, `len` long. */
export interface Cable {
  style: CableStyle, n: number, pitch: number, legs?: Legs,
  awg?: number, mm?: number, scale?: number, set?: WireSet, pick?: number[], folds?: boolean[],
  conn?: { start?: Conn, end?: Conn }, shield?: boolean,
  fan?: { start?: boolean, end?: boolean, gap: number, len: number },
}

/** A polyline stroked w wide (or `width`), or with `fill` a polygon outlined in `stroke`; colour 0
 *  is the line's, 1 the second one, else as given. */
export interface Piece { pts: XY[], color: 0 | 1 | string, fill?: boolean, width?: number, stroke?: string, dash?: boolean }

/** Strand offsets, side by side and touching. */
export const offsets = (n: number, w: number) => Array.from({ length: n }, (_, j) => (j - (n - 1) / 2) * w)
const amp = (n: number, w: number) => (n - 1) * w / 2 + w / 4

/** Overall width of the cable body. */
export const cableWidth = (c: Cable, w: number) => isFlat(c) ? flatWidth(c) : c.style === 'chevron' ? c.pitch
  : c.style === 'jacket' ? (c.mm ?? 4) * MM * (c.scale ?? 1)
  : c.style === 'checks' ? c.n * w : 2 * amp(c.n, w) + w

/** The centre line of a band `width` wide: bends no tighter than its width allows (the inner edge
 *  would fold over), arcs sampled finely enough for a wide outline. */
export const bandLine = (path: XY[], radii: readonly number[], width: number) =>
  round(path, radii.map(r => r > 0 ? Math.max(r, width * 0.75) : 0), Math.PI / 64)

/** Both edges of a band `width` wide along `drawn`, mitred on bends. */
export function edges(drawn: XY[], width: number): [XY[], XY[]] {
  const ns = normals(drawn), at = (k: number) => drawn.map((p, i) => [p[0] + ns[i][0] * k, p[1] + ns[i][1] * k] as XY)
  return [at(width / 2), at(-width / 2)]
}

/** A chevron band (git-flow style): `width` wide along the line (see bandLine), a notched tail and a
 *  pointed head ending at the line's end. One polygon. */
export function chevronBand(drawn: XY[], width: number): XY[] {
  const s = lengths(drawn), L = s.at(-1) ?? 0, h = Math.min(width / 2, L / 3)
  const pts = [...drawn.filter((_, i) => s[i] < L - h), pointAt(drawn, L - h).p]
  const [l, r] = edges(pts, width)
  const u = pointAt(drawn, 0).u, notch: XY = [drawn[0][0] + u[0] * h, drawn[0][1] + u[1] * h]
  return [notch, ...l, drawn[drawn.length - 1], ...r.reverse(), notch]
}

/** Where strand j of n leaves to at an end when the end fans out: `len` on, set `gap` apart across,
 *  relative to that end of `drawn`. */
export function fanLeg(c: Cable, drawn: XY[], end: 'start' | 'end', j: number): XY | null {
  const f = c.fan
  if (!f?.[end]) return null
  const L = lengths(drawn).at(-1) ?? 0, { u } = pointAt(drawn, end === 'start' ? 0 : L)
  const out: XY = end === 'start' ? [-u[0], -u[1]] : u, nl: XY = [-u[1], u[0]], o = (j - (c.n - 1) / 2) * f.gap
  return [out[0] * f.len + nl[0] * o, out[1] * f.len + nl[1] * o]
}

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
  // a fanned leg goes out at 45° first, then on beside the others
  const legOut = (st: Strand, at: 'start' | 'end', to: XY | null | undefined, fan = false) => {
    if (!to) return
    const k = at === 'start' ? 0 : st.pts.length - 1, e = st.pts[k], end = at === 'start' ? drawn[0] : drawn.at(-1)!
    const u = pointAt(drawn, at === 'start' ? 0 : L).u, dir: XY = at === 'start' ? [-u[0], -u[1]] : u
    const target: XY = [end[0] + to[0], end[1] + to[1]]
    if (dist(e, target) < 1e-6) return
    // fanned: the leg order that ends running along the line, so the fanned strands end side by side
    const along = (pts: XY[]) => { const v = unit(sub(pts[pts.length - 1], pts[pts.length - 2]))
      return Math.abs(v[0] * dir[1] - v[1] * dir[0]) < 1e-6 }
    const both = [octi(e, target, true), octi(e, target, false)], legs = fan ? both.find(along) ?? both[0]
      : octi(e, target, undefined, dir)
    const leg = resample(round(legs, 2 * w), Math.min(P / 12, 6))
    const s0 = st.s[k], sg = at === 'start' ? -1 : 1, pts = leg.pts.slice(1), s = leg.s.slice(1).map(v => s0 + sg * v)
    if (at === 'start') { st.pts.unshift(...pts.reverse()); st.s.unshift(...s.reverse()) }
    else { st.pts.push(...pts); st.s.push(...s) }
  }
  strands.forEach((st, j) => (['start', 'end'] as const).forEach(end => {
    const own = c.legs?.[end]?.[j]
    legOut(st, end, own ?? fanLeg(c, drawn, end, j), !own)
  }))
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
  // on a bend one would twist: the nearest spot along where the line runs straight, else none
  const bent = (s: number) => {
    const a = pointAt(drawn, s - h).u, b = pointAt(drawn, s + h).u
    return a[0] * b[0] + a[1] * b[1] < 0.9999
  }
  for (let k = 0; k < n; k++) {
    const mid = (L - (n - 1) * every) / 2 + k * every
    const tries = [0, ...Array.from({ length: 8 }, (_, i) => (i + 1) * every / 16).flatMap(d => [d, -d])]
    const at = tries.map(d => mid + d).find(v => v > h && v < L - h && !bent(v))
    if (at === undefined) continue
    const { p, u } = pointAt(drawn, at), v: XY = [-u[1], u[0]]
    const back: XY = [p[0] - u[0] * h / 2, p[1] - u[1] * h / 2]
    out.push([[back[0] + v[0] * h, back[1] + v[1] * h], [p[0] + u[0] * h / 2, p[1] + u[1] * h / 2],
      [back[0] - v[0] * h, back[1] - v[1] * h]])
  }
  return out
}
