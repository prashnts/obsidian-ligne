import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needs } from './lead.ts'
import type { Cable } from './cable.ts'

test('needs: a housed end asks for its fitting plus the bend', () => {
  const c: Cable = { style: 'ribbon', n: 4, pitch: 16, awg: 28, scale: 1, conn: { start: 'jst', end: 'none' } }
  const [a, b] = needs([[0, 0], [10, 0], [10, 100]], [0, 24, 0], c)
  assert.equal(b, 0)
  assert.ok(a > 24 + 6 * 96 / 25.4, `${a}`)                 // more than the bend and the housing's depth
  assert.deepEqual(needs([[0, 0], [10, 0]], [0, 0], undefined), [0, 0])
})
