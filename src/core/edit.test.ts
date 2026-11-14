import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropBend, dropJogs, jog, roomBends, roomy, shiftLeg, spliceAlong, tidyAlong } from './edit.ts'
import { dist, type XY } from './geom.ts'

const near = (a: XY, b: XY) => assert.ok(dist(a, b) < 1e-6, `${a} ≉ ${b}`)
const all = (a: XY[], b: XY[]) => { assert.equal(a.length, b.length); a.forEach((p, i) => near(p, b[i])) }

test('shiftLeg: neighbours stretch along their own direction', () => {
  // ⌐ shape: right, down, right; the middle (down) leg moves right by 4
  const p: XY[] = [[0, 0], [10, 0], [10, 10], [20, 10]]
  // leg 1 runs down (+y); on screen (y down) its left normal is -x, so -4 moves it right
  const r = shiftLeg(p, 1, -4)!
  all(r.pts, [[0, 0], [14, 0], [14, 10], [20, 10]])
  // a 45° neighbour: the bend slides along it
  const q: XY[] = [[0, 0], [10, 10], [20, 10]]
  const s = shiftLeg(q, 1, 2)!                      // leg 1 runs +x, its left is +y: down
  all(s.pts, [[0, 0], [12, 12], [20, 12]])
})

test('shiftLeg: clamps so a neighbour does not turn back; pinned ends refuse', () => {
  const p: XY[] = [[0, 0], [10, 0], [10, 10], [20, 10]]
  const r = shiftLeg(p, 1, -30)!
  assert.equal(r.d, -10)                             // the last leg is 10 long: it shrinks to 0
  near(r.pts[2], [20, 10])
  assert.equal(shiftLeg([[0, 0], [10, 0]], 0, 3, { pinned: i => i === 0 }), undefined)
  all(shiftLeg([[0, 0], [10, 0]], 0, 3)!.pts, [[0, 3], [10, 3]])
})

test('shiftLeg: a zone wraps around', () => {
  const z: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
  const r = shiftLeg(z, 0, -2)!                     // top leg (runs +x), its left is +y: -2 is up
  all(r.pts, [[0, -2], [10, -2], [10, 10], [0, 10], [0, -2]])
})

test('jog: a 45° step, the rest of the leg moved over', () => {
  const p: XY[] = [[0, 0], [20, 0], [20, 10]]
  const r = jog(p, 0, [5, 0], 3)!                   // left of +x is +y: down by 3
  all(r, [[0, 0], [5, 0], [8, 3], [20, 3], [20, 10]])
  assert.equal(jog(p, 0, [19, 0], 3), undefined)   // no room for the step
})

test('dropBend: only when the shortcut is on the grid', () => {
  all(dropBend([[0, 0], [10, 0], [10, 10]], 1)!, [[0, 0], [10, 10]])
  assert.equal(dropBend([[0, 0], [10, 0], [15, 5]], 1), undefined)
})

test('roomy: the bend before the end slides back for the fitting', () => {
  // right 20, down 20, right 4: the last leg needs 10
  const p: XY[] = [[0, 0], [20, 0], [20, 20], [24, 20]]
  const r = roomy(p, 0, 10)
  all(r.pts, [[0, 0], [14, 0], [14, 20], [24, 20]])
  assert.deepEqual(r.short, [0, 0])
  // one bend only: nothing to move without moving an end
  const s = roomy([[0, 0], [20, 0], [20, 3]], 0, 10)
  assert.equal(s.short[1], 7)
  // the start: the first bend slides on
  const t = roomy([[0, 0], [3, 0], [3, 20], [20, 20]], 10, 0)
  all(t.pts, [[0, 0], [10, 0], [10, 20], [20, 20]])
})

test('spliceAlong and tidyAlong keep per-point data in step', () => {
  const al = spliceAlong({ radii: [1, 2, 3], links: [null, null, null] }, 1, 0, 2, 9)
  assert.deepEqual(al.radii, [1, 9, 9, 2, 3])
  const t = tidyAlong([[0, 0], [5, 0], [5, 0], [10, 0], [10, 5]], { radii: [0, 1, 2, 3, 4] })
  assert.deepEqual(t.pts, [[0, 0], [10, 0], [10, 5]])
  assert.deepEqual(t.al.radii, [0, 3, 4])
})

test('roomBends: a leg too short for its two arcs grows', () => {
  // right, down 10, right: two 90° bends of radius 8 need 16 down
  const p: XY[] = [[0, 0], [20, 0], [20, 10], [40, 10], [40, 40]]
  const r = roomBends(p, [0, 8, 8, 8, 0])
  assert.ok(dist(r[1], r[2]) >= 16 - 1e-6, `${dist(r[1], r[2])}`)
  near(r[0], [0, 0]); near(r[4], [40, 40])
})

test('dropJogs: a tiny step between parallel legs goes', () => {
  const p: XY[] = [[0, 0], [20, 0], [22, 2], [40, 2], [40, 30]]
  const r = tidyAlong(dropJogs(p, 4), { radii: [0, 1, 1, 1, 0] }).pts
  all(r, [[0, 0], [40, 0], [40, 30]])
})
