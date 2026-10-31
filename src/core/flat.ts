// Flat cables: ribbons of round wires (silicone, one wire striped, or a colour set) and FFC, drawn
// true to size × scale at 96 dpi, so folds show as they will be. A fold at a waypoint turns the
// cable over: a sharp crease on a bend (the outer corner cut off), a half twist on a straight. The
// far side shows the back: wires mirrored, a lighter shade, the stripe dashed, an FFC's stiffener.
// Ends fan out into legs (ribbon) or end in a connector housing; Excalidraw-free pieces as cable.ts.
import { dist, lengths, normals, octi, resample, round, unit, type XY } from './geom.ts'
import type { Cable, Piece } from './cable.ts'

export const MM = 96 / 25.4                               // px per mm at Excalidraw's 96 dpi
/** Silicone wire outer diameter in mm by AWG, representative (ribbon pitch = diameter). */
export const AWG: Record<number, number> = { 32: 0.7, 30: 0.9, 28: 1.1, 26: 1.4 }
export const GAUGES = [32, 30, 28, 26]
export const FFC_PITCH = [0.5, 1]

export type WireSet = 'mono' | 'qwiic' | 'grove' | 'rainbow' | 'usb'
export const SETS: WireSet[] = ['mono', 'qwiic', 'grove', 'rainbow', 'usb']
/** Pin 1 first: Qwiic GND 3V3 SDA SCL, Grove SCL SDA VCC GND, rainbow ribbon brown to black, USB VBUS
 *  D- D+ GND. */
const COLORS: Record<Exclude<WireSet, 'mono'>, string[]> = {
  qwiic: ['#1e1e1e', '#e03131', '#1c7ed6', '#fab005'],
  usb: ['#e03131', '#f1f3f5', '#2f9e44', '#1e1e1e'],
  grove: ['#fab005', '#f1f3f5', '#e03131', '#1e1e1e'],
  rainbow: ['#8b4513', '#e03131', '#fd7e14', '#fab005', '#2f9e44', '#1c7ed6', '#7048e8', '#868e96', '#f1f3f5',
    '#1e1e1e'],
}

/** Wire colours of a set, for a sample (mono: the line colour, striped). */
export const swatch = (set: WireSet, base: string) => set === 'mono' ? [base, '#ffffff', base, base] : COLORS[set]

/** Cable ends: wire housings (Dupont female / male, JST PH, SH, MX), an FFC's ZIF, a jacket's
 *  stripped end or its plugs (jacket.ts). */
export type Conn = 'none' | 'dupont' | 'dupontm' | 'jst' | 'sh' | 'mx' | 'zif' | Plug
export type Plug = 'strip' | 'usbc' | 'usba' | 'microb' | 'barrel' | 'trs' | 'rj45'
const WIRED: Conn[] = ['dupont', 'dupontm', 'jst', 'sh', 'mx']
export const CONNS: Record<'ribbon' | 'ffc' | 'jacket', Conn[]> = {
  ribbon: ['none', ...WIRED], ffc: ['none', 'zif'],
  jacket: ['none', 'strip', ...WIRED, 'usbc', 'usba', 'microb', 'barrel', 'trs', 'rj45'] }
export const CONN_NAMES: Record<Conn, string> = {
  none: 'none', dupont: 'Dupont F', dupontm: 'Dupont M', jst: 'JST PH', sh: 'SH', mx: 'MX 1.25', zif: 'ZIF',
  strip: 'stripped', usbc: 'USB-C', usba: 'USB-A', microb: 'micro-B', barrel: 'barrel 5.5', trs: '3.5 mm',
  rj45: 'RJ45' }
/** Wire housings: the wires close up to their pitch and go into one. */
export const isHousing = (k?: Conn) => !!k && WIRED.includes(k)
/** Housings in mm: pin pitch, width beyond the outer pins' centres, depth along the wires (JST = PH,
 *  MX = Molex PicoBlade style 1.25, zif: the FFC's pitch). */
export const HOUSING: Record<'dupont' | 'dupontm' | 'jst' | 'sh' | 'mx' | 'zif', { pitch: number, edge: number, depth: number, body: string,
  line: string, slot: string }> = {
  dupont: { pitch: 2.54, edge: 2.54, depth: 14, body: '#1e1e1e', line: '#000000', slot: '#868e96' },
  dupontm: { pitch: 2.54, edge: 2.54, depth: 14, body: '#1e1e1e', line: '#000000', slot: '#868e96' },
  jst: { pitch: 2, edge: 3.9, depth: 6, body: '#f4f1e8', line: '#8a8371', slot: '#5c574a' },
  sh: { pitch: 1, edge: 3, depth: 4.25, body: '#f4f1e8', line: '#8a8371', slot: '#5c574a' },
  mx: { pitch: 1.25, edge: 3.2, depth: 5, body: '#f4f1e8', line: '#8a8371', slot: '#5c574a' },
  zif: { pitch: 0, edge: 3, depth: 4, body: '#2b2b2b', line: '#000000', slot: '#c8b68e' },
}

type End = 'start' | 'end'
export const isFlat = (c?: Cable) => c?.style === 'ribbon' || c?.style === 'ffc'
const px = (c: Cable) => MM * (c.scale ?? 1)
/** Centre to centre distance of neighbouring wires (conductors), px. */
export const wirePitch = (c: Cable) => (c.style === 'ffc' ? c.mm ?? 0.5 : AWG[c.awg ?? 28] ?? 1.1) * px(c)
/** Overall width: the wires side by side; an FFC has half a pitch of film either side. */
export const flatWidth = (c: Cable) => (c.style === 'ffc' ? c.n + 1 : c.n) * wirePitch(c)
const offsets = (n: number, p: number) => Array.from({ length: n }, (_, j) => (j - (n - 1) / 2) * p)

/** Side up on each leg (+1 front, -1 back): a fold at waypoint i turns it over from leg i on. */
export function sides(c: Cable, legs: number): number[] {
  let s = 1
  return Array.from({ length: legs }, (_, i) => (s *= c.folds?.[i] ? -1 : 1))
}

/** Wire j's colour (a split keeps its parent's wires: `pick`) and whether it has the stripe. */
export function wire(c: Cable, j: number, base: string): { color: string, stripe: boolean } {
  const k = c.pick?.[j] ?? j, set = c.set ?? 'mono'
  if (set === 'mono') return { color: base, stripe: k === 0 }
  const cs = COLORS[set]
  return { color: cs[k % cs.length], stripe: false }
}

/** #rgb / #rrggbb mixed t of the way to `to`; other colours as they are. */
export function mix(a: string, to: string, t: number): string {
  const rgb = (h: string) => {
    const m = h.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
    const f = m && (m.length === 3 ? [...m].map(x => x + x).join('') : m)
    return f ? [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)) : undefined
  }
  const x = rgb(a), y = rgb(to)
  if (!x || !y) return a
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

const left = (u: XY): XY => [-u[1], u[0]]
const add = (p: XY, v: XY, k = 1): XY => [p[0] + v[0] * k, p[1] + v[1] * k]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const legDir = (a: XY, b: XY) => unit([b[0] - a[0], b[1] - a[1]])
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

/** An end of the cable: its point, the way out, the travel's left normal, the side up there. */
export function endOf(path: XY[], c: Cable, end: End) {
  const n = path.length, s = sides(c, n - 1)
  const u = end === 'start' ? legDir(path[0], path[1]) : legDir(path[n - 2], path[n - 1])
  return { at: end === 'start' ? path[0] : path[n - 1], out: end === 'start' ? [-u[0], -u[1]] as XY : u,
    nl: left(u), side: end === 'start' ? s[0] : s[n - 2] }
}

/** Where wire j is across the cable at an end, from the travel's left (side flips it). */
export const across = (c: Cable, side: number, j: number) => side * offsets(c.n, wirePitch(c))[j]

/** Each wire's tip per end: its leg's point, else beside the line's end. */
export function flatTips(path: XY[], c: Cable): Record<End, XY[]> {
  const tips = (end: End) => {
    const e = endOf(path, c, end)
    return Array.from({ length: c.n }, (_, j) => {
      const to = c.style === 'ribbon' && c.legs?.[end]?.[j]
      return to ? add(e.at, to) : add(e.at, e.nl, across(c, e.side, j))
    })
  }
  return { start: tips('start'), end: tips('end') }
}

/** The part of a polyline between lengths a and b. */
function cut(pts: XY[], a: number, b: number): XY[] {
  const s = lengths(pts), at = (v: number): XY => {
    const i = Math.max(0, s.findIndex(x => x >= v) - 1), l = s[i + 1] - s[i], t = l ? (v - s[i]) / l : 0
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]
  }
  return [at(a), ...pts.filter((_, i) => s[i] > a && s[i] < b), at(b)]
}

/** The flat cable over waypoints `path` (bend radii `radii`). `base`: the mono wire colour, `light`
 *  the stripe's. Pieces in drawing order, the first a band (the cable's outline). */
export function flat(path: XY[], radii: readonly number[], c: Cable, base: string, light: string): Piece[] {
  const ffc = c.style === 'ffc', P = wirePitch(c), W = flatWidth(c), os = offsets(c.n, P), last = path.length - 1
  const side = sides(c, last), out: Piece[] = [], k = px(c)
  const lift = (col: string, s: number, t: number) => s > 0 ? col : mix(col, '#ffffff', t)
  const film = (s: number) => s > 0 ? '#ece6d2' : '#d9cfae'
  const band = (s: number) => ffc ? film(s) : lift(mix(c.set && c.set !== 'mono' ? '#b0b0b0' : base, '#ffffff', .3), s, .3)
  const ww = ffc ? P * .45 : P * .84, line = Math.max(.5, .15 * k)
  // sections between folds inside the line; each runs one side up
  const cuts = [0, ...path.map((_, i) => i).filter(i => i > 0 && i < last && c.folds?.[i]), last]
  const conns = { start: c.conn?.start ?? 'none', end: c.conn?.end ?? 'none' }
  const fanned = (end: End) => !ffc && !!c.legs?.[end]?.some(Boolean)
  const housed = (end: End) => !ffc && isHousing(conns[end]) && !fanned(end)
  const fan = (end: End) => {
    const h = HOUSING[conns[end] as 'dupont'], cp = h.pitch * k
    const d = Math.max(...os.map((o, j) => Math.abs(o - (j - (c.n - 1) / 2) * cp)))
    return { h, cp, F: Math.max(1.5 * k, 1.5 * d), D: h.depth * k }
  }
  const ends: Partial<Record<End, { at: XY, u: XY, nl: XY, side: number }>> = {}, short = { start: 0, end: 0 }
  for (let q = 0; q < cuts.length - 1; q++) {
    const a = cuts[q], b = cuts[q + 1], s = side[a]
    // a flat cable bends in its plane no tighter than its width allows
    let drawn = round(path.slice(a, b + 1), radii.slice(a, b + 1).map(r => r > 0 ? Math.max(r, W / 2 + P) : 0))
    const L = lengths(drawn).at(-1) ?? 0
    // a connector housing ends the cable: the body stops short for the fan and the housing
    // (a short line keeps a little body: the housing then reaches beyond its end)
    const want = (end: End, on: boolean) => on && housed(end) ? fan(end).F + fan(end).D : 0
    const t0 = want('start', a === 0), t1 = want('end', b === last), keep = Math.min(1, Math.max(0, L - 2) / (t0 + t1 || 1))
    if (t0 || t1) drawn = cut(drawn, t0 * keep, L - t1 * keep)
    if (a === 0) short.start = t0 * keep
    if (b === last) short.end = t1 * keep
    // a fold on a straight: half a twist over a cable's width at the start of the next section
    const turn = (i: number) => {
      const u1 = legDir(path[i - 1], path[i]), u2 = legDir(path[i], path[i + 1])
      return { u1, u2, twist: Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) < .2 && dot(u1, u2) > 0 }
    }
    const into = a > 0 ? turn(a) : undefined, onto = b < last ? turn(b) : undefined
    const body = into?.twist ? resample(drawn, W / 8) : { pts: drawn, s: lengths(drawn) }
    const ns = normals(body.pts), f = (i: number) => into?.twist ? -1 + 2 * smooth(body.s[i] / W) : 1
    // on a crease the ends meet on the crease line through the waypoint (across both legs' middle)
    const crease = (t: { u1: XY, u2: XY }, nl: XY, o: number, v: XY) => {
      const sum: XY = [t.u1[0] + t.u2[0], t.u1[1] + t.u2[1]]
      const d = Math.hypot(...sum) < 1e-6 ? left(t.u1) : unit(sum), m = dot(nl, d)
      return Math.abs(m) < 1e-6 ? add(v, nl, o) : add(v, d, o / m)
    }
    const at = (o: number) => {
      const pts = body.pts.map((p, i) => add(p, ns[i], o * f(i)))
      if (into && !into.twist) pts[0] = crease(into, ns[0], o, path[a])
      if (onto && !onto.twist) pts[pts.length - 1] = crease(onto, ns[ns.length - 1], o, path[b])
      return pts
    }
    const l = at(W / 2), r = at(-W / 2)
    out.push({ pts: [...l, ...r.reverse(), l[0]], color: band(s), fill: true, stroke: base, width: line })
    for (let j = 0; j < c.n; j++) {
      const w = wire(c, j, base), pts = at(s * os[j])
      out.push({ pts, color: ffc ? '#a8a08a' : lift(w.color, s, .2), width: ww })
      if (w.stripe && !ffc) out.push({ pts, color: light, width: P * .28, dash: s < 0 })
    }
    if (a === 0) ends.start = { at: body.pts[0], u: legDir(body.pts[1], body.pts[0]), nl: ns[0], side: s }
    if (b === last) {
      const n = body.pts.length
      ends.end = { at: body.pts[n - 1], u: legDir(body.pts[n - 2], body.pts[n - 1]), nl: ns[n - 1], side: s }
    }
  }
  for (const end of ['start', 'end'] as const) {
    const e = ends[end]!, conn = conns[end]
    if (ffc) {
      // contacts on the front at both ends; from the back, the stiffener
      const E = 4 * k, z = conn === 'zif' ? HOUSING.zif.depth * k : 0
      const back = (o: number, d: number) => add(add(e.at, e.nl, o), e.u, -d)
      if (e.side > 0) for (const o of os) out.push({ pts: [back(o, E), back(o, 0)], color: '#c3c7cc', width: P * .6 })
      else out.push(rect(back(0, E), e.u, e.nl, E, W, '#3b6fd1', '#2b55a8', line))
      if (z) out.push(...housing(back(0, z), e.u, e.nl, e.side, c, conn, P, z, (c.n + 1) * P + HOUSING.zif.edge * k))
      continue
    }
    const tips = flatTips(path, c)[end]
    if (fanned(end)) {
      // legs: from each wire's end, leaving along the line, then octilinear to its point
      for (let j = 0; j < c.n; j++) {
        const from = add(e.at, e.nl, e.side * os[j]), w = wire(c, j, base)
        const pts = dist(from, tips[j]) > 1e-6 ? round(octi(from, tips[j], undefined, e.u), 2 * P) : [from]
        if (pts.length > 1) {
          out.push({ pts, color: lift(w.color, e.side, .2), width: ww })
          if (w.stripe) out.push({ pts, color: light, width: P * .28, dash: e.side < 0 })
        }
        if (!isHousing(conn)) continue
        const u = pts.length > 1 ? legDir(pts[pts.length - 2], pts[pts.length - 1]) : e.u, h = HOUSING[conn as 'dupont']
        out.push(...housing(add(tips[j], u, -h.depth * k), u, left(u), 1, { ...c, n: 1, pick: [c.pick?.[j] ?? j] },
          conn, h.pitch * k, h.depth * k, h.edge * k))
      }
    } else if (housed(end)) {
      // the wires close up (or spread) to the pins, then the housing, in line with the end leg
      const { h, cp, F, D } = fan(end), x = endOf(path, c, end)
      Object.assign(e, { at: add(x.at, x.out, -short[end]), u: x.out, nl: x.nl })
      for (let j = 0; j < c.n; j++) {
        const o = e.side * os[j], p = e.side * (j - (c.n - 1) / 2) * cp, w = wire(c, j, base)
        const pts = Array.from({ length: 13 }, (_, i) => add(add(e.at, e.u, F * i / 12), e.nl, o + (p - o) * smooth(i / 12)))
        out.push({ pts, color: lift(w.color, e.side, .2), width: Math.min(ww, cp * .84) })
        if (w.stripe) out.push({ pts, color: light, width: Math.min(ww, cp * .84) / 3, dash: e.side < 0 })
      }
      out.push(...housing(add(e.at, e.u, F), e.u, e.nl, e.side, c, conn, cp, D, (c.n - 1) * cp + h.edge * k))
    }
  }
  return out
}

/** A filled rectangle from `at` (middle of its back edge) d along u, w across. */
function rect(at: XY, u: XY, nl: XY, d: number, w: number, fill: string, stroke: string, width: number): Piece {
  const c = (s: number, o: number) => add(add(at, u, s), nl, o)
  return { pts: [c(0, w / 2), c(d, w / 2), c(d, -w / 2), c(0, -w / 2), c(0, w / 2)], color: fill, fill: true, stroke, width }
}

/** A connector housing from `at` (its back, where the wires go in) D deep along u: body, pin slots
 *  near the mating face (a triangle at pin 1), dividers between Dupont pins, a ZIF's actuator. */
export function housing(at: XY, u: XY, nl: XY, side: number, c: Cable, conn: Conn, cp: number, D: number, w: number): Piece[] {
  const h = HOUSING[conn as 'dupont'], line = Math.max(.5, .15 * px(c))
  const out = [rect(at, u, nl, D, w, h.body, h.line, line)]
  if (conn === 'zif') return [...out, rect(at, u, nl, D * .3, w, h.slot, h.line, line)]
  for (let j = 0; j < c.n; j++) {
    const o = side * (j - (c.n - 1) / 2) * cp, m = add(add(at, u, D - cp * .7), nl, o), r = cp * .22
    // pin 1: a triangle pointing to the mating face
    const tri = [add(m, nl, -r * 1.3), add(m, u, r * 1.6), add(m, nl, r * 1.3), add(m, nl, -r * 1.3)].map(p => add(p, u, -r * .3))
    out.push((c.pick?.[j] ?? j) === 0 ? { pts: tri, color: h.slot, fill: true, stroke: h.slot, width: line / 2 }
      : rect(add(m, u, -r), u, nl, 2 * r, 2 * r, h.slot, h.slot, line / 2))
    // a male housing: square pins out of the mating face
    if (conn === 'dupontm') {
      const b = add(add(at, u, D), nl, o)
      out.push({ pts: [b, add(b, u, 6 * px(c))], color: '#d4a72c', width: .64 * px(c) })
    }
    if ((conn === 'dupont' || conn === 'dupontm') && j) {
      const b = add(at, nl, o - side * cp / 2)
      out.push({ pts: [b, add(b, u, D)], color: '#495057', width: line })
    }
  }
  return out
}
