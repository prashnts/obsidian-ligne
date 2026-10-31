import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pinsOf, span } from './board.ts'

test('span: holes between two corners, either way round', () => {
  assert.deepEqual(span([0, 0], [95, 40], 10), { at: [0, 0], cols: 11, rows: 5 })
  assert.deepEqual(span([100, 50], [0, 0], 10), { at: [0, 0], cols: 11, rows: 6 })
})

test('pinsOf: header along the row, DIP rows 0.3" apart, TO-92 in a row', () => {
  assert.equal(pinsOf('J', [0, 0], [42, 3], 10).length, 5)
  const dip = pinsOf('DIP', [0, 0], [0, 30], 10)
  assert.equal(dip.length, 8)
  assert.deepEqual(dip[4], [30, 30])                     // pin 5 across from pin 4, counting back up
  assert.deepEqual(pinsOf('TO92', [50, 50], [50, 50], 10), [[40, 50], [50, 50], [60, 50]])
})
