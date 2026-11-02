import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineThrough, readLine } from './portable.ts'

test('readLine fills defaults, keeps what is set', () => {
  const l = readLine('{"r": 4, "style": {"color": "#00f"}}')!
  assert.equal(l.r, 4)
  assert.equal(l.style.color, '#00f')
  assert.equal(l.style.width, 6)
  assert.equal(readLine(''), null)
})

test('lineThrough keeps the stops and bends on the grid', () => {
  const pts = lineThrough([[0, 0], [100, 50]], 0)
  assert.deepEqual(pts[0], [0, 0])
  assert.deepEqual(pts.at(-1), [100, 50])
  assert.equal(pts.length, 3)
  const [a, b, c] = pts, ang = (p: number[], q: number[]) => Math.round(Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI)
  for (const g of [ang(a, b), ang(b, c)]) assert.equal(g % 45, 0)
})
