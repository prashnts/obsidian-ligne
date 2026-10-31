import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cable, cableWidth, chevrons, offsets, ribbons } from './cable.ts'
import { dist, type XY } from './geom.ts'

const near = (a: XY, b: XY, e = 1e-6) => assert.ok(dist(a, b) < e, `${a} ≉ ${b}`)
const line: XY[] = [[0, 0], [200, 0]]

test('offsets: strands side by side, touching', () => {
  assert.deepEqual(offsets(2, 4), [-2, 2])
  assert.deepEqual(offsets(3, 2), [-2, 0, 2])
  assert.equal(cableWidth({ style: 'checks', n: 4, pitch: 16 }, 3), 12)
  assert.equal(cableWidth({ style: 'round', n: 2, pitch: 16 }, 4), 10)
})

test('twisted pair: strands end side by side, cross in between, first strand back on top', () => {
  const { pieces, tips } = cable(line, { style: 'round', n: 2, pitch: 40 }, 4)
  near(tips.start[0], [0, -2]); near(tips.start[1], [0, 2]); near(tips.end[1], [200, 2])
  const [a, b, over] = pieces
  assert.deepEqual([a.color, b.color, over.color, !!over.fill], [0, 1, 0, true])
  // mid cable the strands swap sides
  const y = (pts: XY[], x: number) => pts.reduce((m, p) => Math.abs(p[0] - x) < Math.abs(m[0] - x) ? p : m)[1]
  assert.ok(y(a.pts, 90) * y(a.pts, 110) < 0)
  assert.ok(y(a.pts, 90) * y(b.pts, 90) < 0)
})

test('checks: one stroke colour, every other check of each strand in the second, offset strand to strand', () => {
  const { pieces } = cable(line, { style: 'checks', n: 2, pitch: 20 }, 4)
  assert.deepEqual(pieces.map(p => [p.color, !!p.fill]), [[0, false], [0, false], [1, true], [1, true]])
  for (const p of pieces.slice(2)) near(p.pts[0], p.pts[p.pts.length - 1])   // closed, so Excalidraw fills it
  // strand 0 (y < 0) is checked on 10..20, strand 1 (y > 0) on 0..10
  const has = (poly: XY[], x: number, y: number) => poly.some(p => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6)
  assert.ok(has(pieces[2].pts, 10, -4) && has(pieces[2].pts, 20, 0) && has(pieces[3].pts, 0, 4) && has(pieces[3].pts, 10, 0))
})

test('legs: each strand fans out to its own point, octilinear', () => {
  const end: (XY | null)[] = [[30, -30], null]
  const { pieces, tips } = cable(line, { style: 'checks', n: 2, pitch: 20, legs: { end } }, 4)
  near(tips.end[0], [230, -30]); near(tips.end[1], [200, 2])
  assert.ok(pieces[0].pts.length > pieces[1].pts.length)
})

test('ribbons: nothing on, nothing drawn', () => {
  assert.deepEqual(ribbons([{ pts: line, s: [0, 200] }], 4, 10, 0, () => false), [])
  // the outline encloses the stretches only: shoelace area = 2 stretches of 10 × 4
  const [poly] = ribbons([{ pts: [[0, 0], [40, 0]], s: [0, 40] }], 4, 10, 0, k => k % 2 === 1)
  const area = poly.slice(1).reduce((a, p, i) => a + poly[i][0] * p[1] - p[0] * poly[i][1], 0) / 2
  assert.ok(Math.abs(Math.abs(area) - 80) < 1e-6, String(area))
})

test('chevrons: evenly along, pointing the way', () => {
  const vs = chevrons(line, 4, 50)
  assert.equal(vs.length, 4)
  near(vs[0][1], [27, 0]); assert.ok(vs[0][0][0] < vs[0][1][0])
})
