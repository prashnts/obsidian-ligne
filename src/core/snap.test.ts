import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gap, laneAt, type Body } from './snap.ts'
import { dist, round, type XY } from './geom.ts'

const body = (id: string, path: XY[], width = 4): Body => ({ id, path, drawn: round(path, 0), width, cable: false })
const me = { width: 4, cable: false }
const A = body('A', [[0, 0], [100, 0], [100, 100]])

test('gap: touching lines, cables kept apart', () => {
  assert.equal(gap(me, me), 6)
  assert.equal(gap({ width: 8, cable: true }, { width: 8, cable: true }), 12)
})

test('laneAt: beside the line, on its nearest side', () => {
  const h = laneAt([A], [50, 6.5], me, { tol: 2 })!
  assert.deepEqual([h.id, h.i, h.d], ['A', 0, 6])
  assert.ok(dist(h.q, [50, 6]) < 1e-9)
  assert.equal(laneAt([A], [50, -6], me, { tol: 2 })!.d, -6)
})

test('laneAt: not past the end of a line (the lane is where the pointer is)', () => {
  assert.equal(laneAt([body('B', [[0, 0], [100, 0]])], [300, 6], me, { tol: 2 }), undefined)
})

test('laneAt: a lane already taken is not offered; the next one out is', () => {
  const B = body('B', [[0, 6], [100, 6]])
  const h = laneAt([A, B], [50, 6.5], me, { tol: 2 })
  assert.ok(!h || h.id === 'B' && h.d !== -6, JSON.stringify(h))
  assert.deepEqual(laneAt([A, B], [50, 12.5], me, { tol: 2 })?.id, 'B')
})

test('laneAt: wider along the leg being drawn', () => {
  assert.equal(laneAt([A], [50, 10], me, { tol: 2 }), undefined)
  assert.equal(laneAt([A], [50, 10], me, { tol: 2, wide: 6, dir: [1, 0] })?.d, 6)
  assert.equal(laneAt([A], [50, 10], me, { tol: 2, wide: 6, dir: [0, 1] }), undefined)
})

test('laneAt: a followed lane holds, around the leg last seen, through the bend', () => {
  const track = { of: 'A', d: 6, i: 0 }
  // drifted off more than tol but less than leave: still on it
  assert.equal(laneAt([A], [60, 9], me, { tol: 2, leave: 5, track })?.d, 6)
  const h = laneAt([A], [94, 40], me, { tol: 2, leave: 5, track })!
  assert.deepEqual([h.i, h.d], [1, 6])
})
