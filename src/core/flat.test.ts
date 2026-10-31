import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cable } from './cable.ts'
import { MM, flat, flatTips, flatWidth, mix, sides, wire } from './flat.ts'
import { dist, type XY } from './geom.ts'

const near = (a: XY, b: XY, e = 1e-6) => assert.ok(dist(a, b) < e, `${a} ≉ ${b}`)
const ribbon = (more: Partial<Cable> = {}): Cable => ({ style: 'ribbon', n: 4, pitch: 16, awg: 28, ...more })

test('sizes: true to size at 96 dpi, times the scale', () => {
  assert.ok(Math.abs(flatWidth(ribbon()) - 4 * 1.1 * MM) < 1e-9)
  assert.ok(Math.abs(flatWidth({ style: 'ffc', n: 20, pitch: 16, mm: .5, scale: 2 }) - 21 * .5 * MM * 2) < 1e-9)
})

test('sides and wires: a fold turns it over, a split keeps its parent wires', () => {
  assert.deepEqual(sides(ribbon({ folds: [false, true, false, true] }), 4), [1, -1, -1, 1])
  assert.deepEqual(sides(ribbon({ folds: [true] }), 2), [-1, -1])
  assert.deepEqual([0, 1].map(j => wire(ribbon(), j, '#000').stripe), [true, false])
  assert.equal(wire(ribbon({ set: 'qwiic', pick: [2, 3] }), 0, '#000').color, '#1c7ed6')
  assert.equal(mix('#000', '#ffffff', .5), '#808080')
})

test('a straight ribbon: band, wires, the stripe on wire 1', () => {
  const ps = flat([[0, 0], [200, 0]], [0, 0], ribbon(), '#1e1e1e', '#fff')
  assert.equal(ps.length, 1 + 4 + 1)
  assert.ok(ps[0].fill && ps[0].stroke === '#1e1e1e')
  near(ps[0].pts[0], ps[0].pts.at(-1)!)                    // closed, so Excalidraw fills it
})

test('a fold on a bend: two bands meeting on the crease, wires mirrored across it', () => {
  const c = ribbon({ folds: [false, true, false] }), ps = flat([[0, 0], [100, 0], [100, 100]], [0, 0, 0], c, '#000', '#fff')
  const bands = ps.filter(p => p.fill), wires = ps.filter(p => !p.fill && !p.dash && p.color !== '#fff')
  assert.equal(bands.length, 2)
  // wire j's end on the first leg is its start on the second, on the 45° crease through the corner
  for (let j = 0; j < 4; j++) {
    const a = wires[j].pts.at(-1)!, b = wires[4 + j].pts[0]
    near(a, b); assert.ok(Math.abs((a[0] - 100) - (a[1] - 0)) < 1e-6)
  }
  // the stripe is on the back past the fold: dashed
  assert.ok(ps.some(p => p.dash))
  // tips at the end are mirrored: wire 0 on the other edge
  const L: XY[] = [[0, 0], [100, 0], [100, 100]], x = (c: Cable) => flatTips(L, c).end.map(p => p[0])
  assert.ok(x(ribbon())[0] > x(ribbon())[3] && x(c)[0] < x(c)[3])
})

test('a fold on a straight: a half twist, wires cross', () => {
  const ps = flat([[0, 0], [100, 0], [200, 0]], [0, 0, 0], ribbon({ folds: [false, true, false] }), '#000', '#fff')
  const w0 = ps.filter(p => !p.fill)[5]                    // after 4 wires + stripe of the first section
  assert.ok(w0.pts[0][1] * w0.pts.at(-1)![1] < 0)
})

test('a connector: body stops short, mating face at the line end', () => {
  const ps = flat([[0, 0], [300, 0]], [0, 0], ribbon({ conn: { end: 'dupont' } }), '#000', '#fff')
  const xs = ps.flatMap(p => p.pts.map(q => q[0]))
  assert.ok(Math.abs(Math.max(...xs) - 300) < 1e-6)
  assert.ok(Math.max(...ps[0].pts.map(q => q[0])) < 300 - 14 * MM)
})

test('legs: fanned wires, a housing on each', () => {
  const end = [[40, -40], null, null, null] as (XY | null)[]
  const c = ribbon({ legs: { end }, conn: { end: 'jst' } })
  near(flatTips([[0, 0], [100, 0]], c).end[0], [140, -40])
  const ps = flat([[0, 0], [100, 0]], [0, 0], c, '#000', '#fff')
  assert.equal(ps.filter(p => p.color === '#f4f1e8').length, 4)
})
