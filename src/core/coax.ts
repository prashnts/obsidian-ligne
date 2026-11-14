// Coaxial cables for antenna and RF links: the common types true to size (1.13 mm pigtails up to
// LMR-400) and their connectors seen from the side: SMA and RP-SMA plugs and jacks, U.FL, MMCX,
// N, F (satellite), BNC; or a stripped end (braid, dielectric, centre conductor). The sheath is
// drawn as a jacket's (jacket.ts); this adds the ends.
import { box, type Cable, type Piece } from './cable.ts'
import { MM } from './flat.ts'
import type { XY } from './geom.ts'

export type CoaxKind = '1.13' | 'rg178' | 'rg316' | 'rg174' | 'lmr100' | 'rg58' | 'lmr195' | 'lmr240' | 'lmr400'
/** Outer diameter in mm and the sheath's usual colour. */
export const COAX: Record<CoaxKind, { mm: number, color: string, name: string }> = {
  '1.13': { mm: 1.13, color: '#495057', name: '1.13 mm' },
  rg178: { mm: 1.8, color: '#8b5a2b', name: 'RG178' },
  rg316: { mm: 2.5, color: '#a8743f', name: 'RG316' },
  rg174: { mm: 2.8, color: '#212529', name: 'RG174' },
  lmr100: { mm: 2.79, color: '#212529', name: 'LMR-100' },
  rg58: { mm: 4.95, color: '#212529', name: 'RG58' },
  lmr195: { mm: 4.95, color: '#212529', name: 'LMR-195' },
  lmr240: { mm: 6.1, color: '#212529', name: 'LMR-240' },
  lmr400: { mm: 10.29, color: '#212529', name: 'LMR-400' },
}
export const COAX_KINDS = Object.keys(COAX) as CoaxKind[]

export type CoaxConn = 'sma' | 'smaf' | 'rpsma' | 'rpsmaf' | 'ufl' | 'mmcx' | 'n' | 'f' | 'bnc'
export const COAX_CONNS: CoaxConn[] = ['sma', 'smaf', 'rpsma', 'rpsmaf', 'ufl', 'mmcx', 'n', 'f', 'bnc']
export const COAX_NAMES: Record<CoaxConn, string> = {
  sma: 'SMA plug', smaf: 'SMA jack', rpsma: 'RP-SMA plug', rpsmaf: 'RP-SMA jack', ufl: 'U.FL', mmcx: 'MMCX',
  n: 'N plug', f: 'F (sat)', bnc: 'BNC' }
export const isCoaxConn = (k?: string): k is CoaxConn => !!k && (COAX_CONNS as string[]).includes(k)

const GOLD = { fill: '#e0b84a', line: '#a07d1c' }, STEEL = { fill: '#ced4da', line: '#868e96' }
const COPPER = '#d9822b', DIELECTRIC = '#f8f9fa', BRAID = { fill: '#c9b48a', line: '#8c7b5e' }

/** Each connector as parts from the sheath on, in mm: length along, width across (D: the
 *  cable's diameter), metal, and a look: hex (a nut's faces), knurl, thread, ring (RP marking). */
type Part = { l: number, w: number | ((D: number) => number), m: typeof GOLD, look?: 'hex' | 'knurl' | 'thread' | 'ring' }
const PARTS: Record<CoaxConn, Part[]> = {
  sma: [{ l: 7, w: D => Math.max(D + 1, 4), m: GOLD }, { l: 3, w: 6, m: GOLD }, { l: 7, w: 8, m: GOLD, look: 'hex' }],
  smaf: [{ l: 7, w: D => Math.max(D + 1, 4), m: GOLD }, { l: 4, w: 8, m: GOLD, look: 'hex' }, { l: 8, w: 6.35, m: GOLD, look: 'thread' }],
  rpsma: [{ l: 7, w: D => Math.max(D + 1, 4), m: GOLD }, { l: 3, w: 6, m: GOLD, look: 'ring' }, { l: 7, w: 8, m: GOLD, look: 'hex' }],
  rpsmaf: [{ l: 7, w: D => Math.max(D + 1, 4), m: GOLD }, { l: 4, w: 8, m: GOLD, look: 'hex' },
    { l: 8, w: 6.35, m: GOLD, look: 'thread' }, { l: .8, w: 4, m: GOLD, look: 'ring' }],
  ufl: [{ l: 1.5, w: 1.6, m: STEEL }, { l: 2, w: 2, m: GOLD }],
  mmcx: [{ l: 5, w: D => D + 1, m: GOLD }, { l: 7, w: 3.6, m: GOLD }],
  n: [{ l: 10, w: D => D + 2, m: STEEL }, { l: 6, w: 14, m: STEEL }, { l: 18, w: 20.6, m: STEEL, look: 'knurl' }],
  f: [{ l: 8, w: D => D + 2, m: STEEL, look: 'hex' }, { l: 7, w: 11, m: STEEL, look: 'hex' }],
  bnc: [{ l: 10, w: D => Math.max(D, 5), m: { fill: '#343a40', line: '#000000' } }, { l: 6, w: 8, m: STEEL },
    { l: 12, w: 14.5, m: STEEL, look: 'knurl' }],
}
/** A stripped end, mm: braid, dielectric, centre conductor. */
const STRIP = { braid: 3, diel: 4, core: 3 }

const add = (p: XY, v: XY, k = 1): XY => [p[0] + v[0] * k, p[1] + v[1] * k]
const left = (u: XY): XY => [-u[1], u[0]]
const px = (c: Cable) => MM * (c.scale ?? 1)

/** How long a coax end's fitting is along the cable, px (0: none or not a coax one). */
export function coaxFitting(c: Cable, conn?: string): number {
  const k = px(c)
  if (conn === 'strip') return (STRIP.braid + STRIP.diel + STRIP.core) * k
  if (!isCoaxConn(conn)) return 0
  return PARTS[conn].reduce((s, p) => s + p.l, 0) * k + (conn === 'f' ? 2 * k : 0)
}

/** A coax end from `at` (where the sheath stops) on along u. */
export function coaxFit(c: Cable, conn: string | undefined, at: XY, u: XY, line: number): Piece[] {
  const k = px(c), D = (c.mm ?? 2.5), n = left(u), out: Piece[] = []
  if (conn === 'strip') {
    // the braid, the dielectric, then the bare centre conductor
    const b0 = at, d0 = add(b0, u, STRIP.braid * k), c0 = add(d0, u, STRIP.diel * k)
    out.push(box(b0, u, STRIP.braid * k, D * .92 * k, BRAID.fill, BRAID.line, line))
    for (let i = 1; i < 6; i++) {
      const x = STRIP.braid * k * i / 6, a0 = add(add(b0, u, x - D * .2 * k), n, D * .42 * k)
      out.push({ pts: [a0, add(add(b0, u, x + D * .2 * k), n, -D * .42 * k)], color: BRAID.line, width: line })
    }
    out.push(box(d0, u, STRIP.diel * k, D * .62 * k, DIELECTRIC, '#adb5bd', line))
    out.push(box(c0, u, STRIP.core * k, Math.max(.3, D * .2) * k, COPPER, '#a0522d', line / 2, .1 * k))
    return out
  }
  if (!isCoaxConn(conn)) return out
  let p0 = at
  for (const p of PARTS[conn]) {
    const L = p.l * k, W = (typeof p.w === 'number' ? p.w : p.w(D)) * k
    out.push(box(p0, u, L, W, p.m.fill, p.m.line, line, p.look === 'ring' ? 0 : Math.min(.4 * k, W / 4)))
    if (p.look === 'hex') for (const o of [-.25, .25])
      out.push({ pts: [add(add(p0, n, W * o), u, .2 * k), add(add(p0, n, W * o), u, L - .2 * k)], color: p.m.line, width: line })
    if (p.look === 'knurl' || p.look === 'thread') {
      const step = (p.look === 'knurl' ? 1 : .7) * k
      for (let x = step; x < L - step / 2; x += step)
        out.push({ pts: [add(add(p0, u, x), n, W * .48), add(add(p0, u, x), n, -W * .48)], color: p.m.line, width: line * .7 })
    }
    if (p.look === 'ring') out.push(box(add(p0, u, L * .35), u, L * .3 || .3 * k, W, '#343a40', '#343a40', line / 2))
    p0 = add(p0, u, L)
  }
  // F: the centre conductor is the pin
  if (conn === 'f') out.push(box(p0, u, 2 * k, .8 * k, COPPER, '#a0522d', line / 2))
  return out
}
