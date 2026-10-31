import { test } from 'node:test'
import assert from 'node:assert/strict'
import { align, aligned, lattice } from './guides.ts'
import { dist, type XY } from './geom.ts'

const near = (a: XY, b: XY) => assert.ok(dist(a, b) < 1e-6, `${a} ≉ ${b}`)

test('align: onto one guide, onto two where they cross', () => {
  const one = align([103, 250], [[100, 0]], 6)
  near(one.q, [100, 250]); assert.equal(one.guides.length, 1)
  const two = align([103, 52], [[100, 0], [0, 50]], 6)
  near(two.q, [100, 50]); assert.equal(two.guides.length, 2)
  near(align([200, 200], [[100, 0]], 6).q, [200, 200])
})

test('align: diagonals only from nearby points', () => {
  near(align([51, 49], [[0, 0]], 6).q, [50, 50])
  near(align([501, 499], [[0, 0]], 6, 'octi', 240).q, [501, 499])
})

test('aligned: the guides a point already sits on', () => {
  assert.equal(aligned([100, 50], [[100, 0], [0, 50], [7, 9]], .5).length, 2)
})

test('lattice: square and isometric', () => {
  near(lattice([23, 38], 'square', 20), [20, 40])
  const q = lattice([19, 13], 'iso', 20), dx = 20 * Math.sqrt(3) / 2
  near(q, [dx, 10])
})
