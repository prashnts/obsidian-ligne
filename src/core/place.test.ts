import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clear, edgeOut, overlap } from './place.ts'

test('overlap: turned boxes', () => {
  assert.ok(overlap({ c: [0, 0], w: 10, h: 4, a: 0 }, { c: [8, 0], w: 10, h: 4, a: 0 }))
  assert.ok(!overlap({ c: [0, 0], w: 10, h: 4, a: 0 }, { c: [11, 0], w: 10, h: 4, a: 0 }))
  // a box at 45° over a flat one reaches down to y = 4 - 4.24; 7 above, it is clear
  assert.ok(overlap({ c: [0, 0], w: 10, h: 2, a: 0 }, { c: [0, 4], w: 10, h: 2, a: Math.PI / 4 }))
  assert.ok(!overlap({ c: [0, 0], w: 10, h: 2, a: 0 }, { c: [0, 7], w: 10, h: 2, a: Math.PI / 4 }))
})

test('edgeOut: steps over a stack', () => {
  const line = (y: number) => ({ drawn: [[0, y], [100, y]] as [number, number][], width: 4 })
  // lines at y = 0, 6, 12 touch side by side; from y = 0 going +y the edge is past the third
  assert.equal(edgeOut([line(0), line(6), line(12)], [50, 0], [0, 1], 2), 14)
  assert.equal(edgeOut([line(0), line(6), line(12)], [50, 0], [0, -1], 2), 2)
})

test('clear: slides along the line off a taken spot', () => {
  const b = clear({ c: [0, 0], w: 20, h: 8, a: 0 }, [{ c: [0, 0], w: 20, h: 8, a: 0 }], [1, 0], [0, -1])
  assert.ok(!overlap(b, { c: [0, 0], w: 20, h: 8, a: 0 }, 2))
  assert.equal(b.c[1], 0)
})
