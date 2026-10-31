// Jacketed round cables (USB, power, audio, network): one sheath `mm` across, true to size × scale,
// with n wires inside. An end is plain, stripped (the shield's braid, then the wires spread out to
// tinned tips), into a wire housing (Dupont, JST, …), or a moulded plug, all seen from above.
import type { Cable, Piece } from './cable.ts'
import { bandLine, edges } from './cable.ts'
import { HOUSING, MM, housing, isHousing, mix, wire, type Plug } from './flat.ts'
import { lengths, pointAt, type XY } from './geom.ts'

type End = 'start' | 'end'
const add = (p: XY, v: XY, k = 1): XY => [p[0] + v[0] * k, p[1] + v[1] * k]
const left = (u: XY): XY => [-u[1], u[0]]

/** Plugs in mm, from the cable: strain relief, overmould w x l, the metal (or contacts) w x l. */
const PLUGS: Record<Exclude<Plug, 'strip'>, { w: number, l: number, mw: number, ml: number, round?: boolean }> = {
  usbc: { w: 11, l: 16, mw: 8.4, ml: 6.6, round: true },
  usba: { w: 16, l: 18, mw: 12, ml: 12 },
  microb: { w: 10, l: 14, mw: 6.9, ml: 5.5 },
  barrel: { w: 9, l: 14, mw: 5.5, ml: 9.5, round: true },
  trs: { w: 6, l: 16, mw: 3.5, ml: 14, round: true },
  rj45: { w: 11.7, l: 21, mw: 0, ml: 0 },
}
const RELIEF = 4, BRAID = 3, LEAD = 10, TIN = 2                 // mm

const px = (c: Cable) => MM * (c.scale ?? 1)
export const jacketWidth = (c: Cable) => (c.mm ?? 4) * px(c)

/** A rectangle from `at` (middle of its back edge) d along u, w across; `r`: rounded ends. */
function box(at: XY, u: XY, d: number, w: number, fill: string, stroke: string, width: number, r = 0): Piece {
  const n = left(u), c = (s: number, o: number) => add(add(at, u, s), n, o)
  if (r <= 0) return { pts: [c(0, w / 2), c(d, w / 2), c(d, -w / 2), c(0, -w / 2), c(0, w / 2)], color: fill, fill: true,
    stroke, width }
  // rounded corners: quarter arcs of radius r, round the box
  r = Math.min(r, d / 2, w / 2)
  const arc = (cx: number, co: number, a0: number) => Array.from({ length: 7 }, (_, i) => {
    const a = a0 + Math.PI / 2 * i / 6
    return c(cx + Math.cos(a) * r, co + Math.sin(a) * r)
  })
  const pts = [...arc(d - r, w / 2 - r, 0), ...arc(r, w / 2 - r, Math.PI / 2), ...arc(r, -w / 2 + r, Math.PI),
    ...arc(d - r, -w / 2 + r, -Math.PI / 2)]
  return { pts: [...pts, pts[0]], color: fill, fill: true, stroke, width }
}

/** How long an end's fitting is along the cable, px. */
function fitting(c: Cable, end: End): number {
  const k = px(c), conn = c.conn?.[end] ?? 'none', D = jacketWidth(c)
  if (conn === 'none') return 0
  const braid = c.shield ? BRAID * k : 0
  if (conn === 'strip') return braid + LEAD * k
  if (isHousing(conn)) {
    const h = HOUSING[conn as 'dupont']
    return braid + Math.max(3 * k, 1.5 * Math.max(0, (c.n - 1) * h.pitch * k - D)) + 4 * k + h.depth * k
  }
  const p = PLUGS[conn as 'usbc']
  return (RELIEF + p.l + p.ml) * k
}

/** The jacketed cable over waypoints `path` (radii); `base`: the jacket's colour. The first piece is
 *  the sheath, the line's own element. */
export function jacket(path: XY[], radii: readonly number[], c: Cable, base: string): Piece[] {
  const k = px(c), D = jacketWidth(c), line = Math.max(.5, .12 * k), dark = mix(base, '#000000', .35)
  const drawn = bandLine(path, radii, D), s = lengths(drawn), L = s.at(-1) ?? 0
  // the sheath stops where the fittings begin (a short line keeps a little of it)
  const f0 = fitting(c, 'start'), f1 = fitting(c, 'end'), keep = Math.min(1, Math.max(0, L - 2) / (f0 + f1 || 1))
  const a = f0 * keep, b = L - f1 * keep
  const body = [pointAt(drawn, a).p, ...drawn.filter((_, i) => s[i] > a && s[i] < b), pointAt(drawn, b).p]
  const [l, r] = edges(body, D)
  // the sheath (its outline is the line's colour), its edges drawn darker over it
  const out: Piece[] = [{ pts: [...l, ...r.slice().reverse(), l[0]], color: base, fill: true, stroke: base, width: line },
    { pts: l, color: dark, width: line }, { pts: r, color: dark, width: line }]
  // a sheen along it, so it reads round
  const [sheen] = edges(body, D * .45)
  out.push({ pts: sheen, color: mix(base, '#ffffff', .35), width: D * .12 })
  for (const end of ['start', 'end'] as const) {
    const at = end === 'start' ? body[0] : body[body.length - 1], { u: t } = pointAt(drawn, end === 'start' ? a : b)
    const u: XY = end === 'start' ? [-t[0], -t[1]] : t
    out.push(...fit(c, end, at, u, base, dark, line))
  }
  return out
}

/** An end's fitting from `at` (where the sheath stops) on along u. */
function fit(c: Cable, end: End, at: XY, u: XY, base: string, dark: string, line: number): Piece[] {
  const conn = c.conn?.[end] ?? 'none', k = px(c), D = jacketWidth(c), n = left(u), out: Piece[] = []
  if (conn === 'none') return out
  if (conn !== 'strip' && !isHousing(conn)) {
    const p = PLUGS[conn as 'usbc'], w = p.w * k
    // strain relief: tapering from the sheath to the overmould
    const rel = [add(at, n, D / 2), add(add(at, u, RELIEF * k), n, w * .42), add(add(at, u, RELIEF * k), n, -w * .42),
      add(at, n, -D / 2), add(at, n, D / 2)]
    out.push({ pts: rel, color: base, fill: true, stroke: dark, width: line })
    const m0 = add(at, u, RELIEF * k)
    if (conn === 'rj45') {
      // clear body, eight gold contacts at the far end, the latch on top
      out.push(box(m0, u, p.l * k, w, '#e9ecef', '#adb5bd', line, k))
      for (let j = 0; j < 8; j++) {
        const c0 = add(add(m0, u, (p.l - 4) * k), n, (j - 3.5) * 1.02 * k)
        out.push({ pts: [c0, add(c0, u, 3.5 * k)], color: '#d4a72c', width: .5 * k })
      }
      out.push(box(add(m0, u, 4 * k), u, 9 * k, 6 * k, '#dee2e6', '#adb5bd', line))
      return out
    }
    out.push(box(m0, u, p.l * k, w, base, dark, line, 1.5 * k))
    const m1 = add(m0, u, p.l * k), mw = p.mw * k
    out.push(box(m1, u, p.ml * k, mw, '#ced4da', '#868e96', line, p.round ? Math.min(mw / 2, 1.3 * k) : .3 * k))
    if (conn === 'usba') for (const o of [-1, 1])
      out.push(box(add(add(m1, u, p.ml * k * .55), n, o * mw * .22), u, 2.5 * k, 2 * k, '#495057', '#495057', line / 2))
    if (conn === 'trs') for (const t of [.45, .7])
      out.push(box(add(m1, u, p.ml * k * t), u, .8 * k, mw, '#343a40', '#343a40', line / 2))
    return out
  }
  // stripped: the braid, then the wires out of the middle of the sheath, spread to their pitch
  let p0 = at
  if (c.shield) {
    out.push(box(at, u, BRAID * k, D * .9, '#c9b48a', '#8c7b5e', line))
    for (let i = 1; i < 6; i++) {
      const x = BRAID * k * i / 6, a0 = add(add(at, u, x - D * .2), n, D * .44), a1 = add(add(at, u, x + D * .2), n, -D * .44)
      out.push({ pts: [a0, a1], color: '#8c7b5e', width: line })
    }
    p0 = add(at, u, BRAID * k)
  }
  const h = isHousing(conn) ? HOUSING[conn as 'dupont'] : undefined, cp = h ? h.pitch * k : Math.max(D / c.n, 1.2 * k)
  const ww = Math.min(D / c.n * .8, cp * .8, 1.3 * k), inner = (j: number) => (j - (c.n - 1) / 2) * ww * 1.05
  const F = h ? Math.max(3 * k, 1.5 * Math.max(0, (c.n - 1) * cp - D)) : LEAD * k * .5
  const smooth = (x: number) => x * x * (3 - 2 * x)
  for (let j = 0; j < c.n; j++) {
    const w = wire(c, j, base), o0 = inner(j), o1 = (j - (c.n - 1) / 2) * cp
    const pts = Array.from({ length: 13 }, (_, i) => add(add(p0, u, F * i / 12), n, o0 + (o1 - o0) * smooth(i / 12)))
    const run = h ? 4 * k : LEAD * k - F
    pts.push(add(add(p0, u, F + run), n, o1))
    out.push({ pts, color: w.color, width: ww })
    if (!h) out.push({ pts: [add(add(p0, u, F + run - TIN * k), n, o1), add(add(p0, u, F + run), n, o1)],
      color: '#adb5bd', width: ww * .7 })
  }
  if (h) out.push(...housing(add(p0, u, F + 4 * k), u, n, 1, c, conn, cp, h.depth * k, (c.n - 1) * cp + h.edge * k))
  return out
}
