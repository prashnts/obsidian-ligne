import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graph, toText, type El } from './graph.ts'
import { beside, carry, concentric, diagFirst, dist, isDiag, nearest, octi, octiPoint, offset, offsetAt, pointAt, resample, round,
  simplify, snap8, snapDir, upright, type XY } from './geom.ts'

const near = (a: XY, b: XY) => assert.ok(dist(a, b) < 1e-6, `${a} ≉ ${b}`)
const angles = (pts: XY[]) => pts.slice(1).map((p, i) => Math.atan2(p[1] - pts[i][1], p[0] - pts[i][0]))

test('snap8 keeps 45° multiples', () => {
  near(snap8([0, 0], [10, 1]), [10, 0])
  near(snap8([0, 0], [10, 9]), [9.5, 9.5])
})

test('octi: one straight and one diagonal leg', () => {
  assert.deepEqual(octi([0, 0], [10, 4]), [[0, 0], [6, 0], [10, 4]])
  assert.deepEqual(octi([0, 0], [10, 4], true), [[0, 0], [4, 4], [10, 4]])
  assert.deepEqual(octi([0, 0], [5, 5]), [[0, 0], [5, 5]])
  // coming in going down, the diagonal turns less than going right
  assert.deepEqual(octi([0, 0], [10, 4], undefined, [0, 1]), [[0, 0], [4, 4], [10, 4]])
  for (const a of angles(octi([3, 7], [-20, 41]))) assert.ok(Math.abs(Math.round(a / (Math.PI / 4)) * Math.PI / 4 - a) < 1e-9)
})

test('simplify joins collinear legs', () => {
  assert.deepEqual(simplify([[0, 0], [5, 0], [5, 0], [10, 0], [10, 5]]), [[0, 0], [10, 0], [10, 5]])
})

test('round: arc tangent to both legs, radius clamped', () => {
  const r = round([[0, 0], [10, 0], [10, 10]], 4)
  near(r[0], [0, 0]); near(r[1], [6, 0]); near(r[r.length - 2], [10, 4]); near(r[r.length - 1], [10, 10])
  for (const p of r.slice(1, -1)) assert.ok(Math.abs(dist(p, [6, 4]) - 4) < 1e-6)
  // short middle leg: two bends share it, so each gets at most half of it
  const z = round([[0, 0], [10, 0], [10, 2], [20, 2]], 5)
  for (const p of z) assert.ok(p[0] >= -1e-9 && p[0] <= 20 + 1e-9)
})

test('nearest finds the segment', () => {
  const n = nearest([[0, 0], [10, 0], [10, 10]], [12, 5])
  assert.equal(n.i, 1); near(n.q, [10, 5]); assert.equal(n.d, 2)
})

test('graph: stations ordered along their line, labels carry data', () => {
  const els: El[] = [
    { id: 'L', type: 'line', x: 10, y: 10, width: 0, height: 0, strokeColor: '#000', strokeWidth: 4, points: [[0, 0], [100, 0]],
      customData: { ligne: { kind: 'line', path: [[0, 0], [100, 0]], r: 0, style: 'trunk' } } },
    ...([['b', 80, 'J3 · FFC\npitch: 0.5mm'], ['a', 20, 'Head']] as const).flatMap(([id, x, text]): El[] => [
      { id, type: 'ellipse', x: x + 5, y: 5, width: 10, height: 10, groupIds: [id + 'g'],
        customData: { ligne: { kind: 'station', line: 'L', shape: 'stop' } } },
      { id: id + 't', type: 'text', x, y: 0, width: 0, height: 0, text, groupIds: [id + 'g'] }]),
  ]
  const g = graph(els)
  assert.deepEqual(g.labels, [])
  assert.deepEqual(g.stations.map(s => [s.label, s.km]), [['Head', 20], ['J3 · FFC', 80]])
  assert.deepEqual(g.stations[1].data, { pitch: '0.5mm' })
  assert.equal(toText(g), 'line L #000 w=4\n  10,10 110,10\n  stop Head @30,10 km=20\n'
    + '  stop "J3 · FFC" @90,10 km=80 pitch=0.5mm\n')
})

test('offset: parallels bend at the same place, around the same centres', () => {
  const p: XY[] = [[0, 0], [100, 0], [100, 100]]
  // left of travel is +y here (screen axes); the bend turns towards it, so that side is inside
  assert.deepEqual(offset(p, 5).map(q => q.map(Math.round)), [[0, 5], [95, 5], [95, 100]])
  assert.deepEqual(concentric(p, [0, 20, 0], 5), [0, 15, 0])
  assert.deepEqual(concentric(p, [0, 20, 0], -5), [0, 25, 0])
  near(offsetAt(p, 0, 0.5, -5), [50, -5])
  assert.deepEqual(beside(p, [40, -6]), { i: 0, t: 0.4, d: -6 })
})

test('diagFirst: least turn from the incoming direction, straight first without one', () => {
  assert.equal(diagFirst([0, 0], [10, 4]), false)
  assert.equal(diagFirst([0, 0], [10, 4], [0, 1]), true)
  assert.equal(diagFirst([0, 0], [10, 4], [1, 0]), false)
})

test('isDiag and upright', () => {
  assert.equal(isDiag([10, 1]), false); assert.equal(isDiag([10, 9]), true); assert.equal(isDiag([-3, 4]), true)
  assert.ok(Math.abs(upright([-1, 0])) < 1e-9)                       // right to left reads left to right
  assert.ok(Math.abs(upright([0, -1]) - Math.PI / 2) < 1e-9)         // up reads like down
  assert.ok(Math.abs(upright([1, 1]) - Math.PI / 4) < 1e-9)
})

test('octiPoint: both legs stay octilinear', () => {
  const prev: XY = [0, 0], next: XY = [100, 40]
  const q = octiPoint([52, 37], prev, next)
  for (const [a, b] of [[prev, q], [q, next]]) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)
    assert.ok(Math.abs(ang - Math.round(ang)) < 1e-9, `${a} → ${b}`)
  }
  assert.ok(dist(q, [52, 37]) < 20)
  near(octiPoint([10, 3], [0, 0]), [10, 0])
})

test('carry: free neighbours shift so their legs keep directions', () => {
  // vertical leg up from the moved point, then a horizontal one: shifting right moves only the next
  const pts: XY[] = [[0, 0], [0, 50], [100, 50]]
  const out = carry(pts, 0, [3, 0], () => false)
  near(out[1], [3, 50]); near(out[2], [100, 50])
  // pinned neighbours stay
  near(carry(pts, 0, [3, 0], i => i === 1)[1], [0, 50])
})

test('resample and pointAt', () => {
  const r = resample([[0, 0], [10, 0], [10, 10]], 4)
  assert.deepEqual(r.s.map(Math.round), [0, 3, 7, 10, 13, 17, 20])
  const { p, u } = pointAt([[0, 0], [10, 0], [10, 10]], 15)
  near(p, [10, 5]); near(u, [0, 1])
})

test('iso: legs at 30°, 90°, 150°', () => {
  const r3 = Math.sqrt(3)
  for (const b of [[10, 4], [-7, 20], [3, -9], [-12, -1]] as XY[]) for (const d of [true, false]) {
    const pts = octi([0, 0], b, d, undefined, 'iso')
    near(pts.at(-1)!, b)
    for (const a of angles(pts)) {
      const k = (a - Math.PI / 6) / (Math.PI / 3)
      assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `${b} ${a}`)
    }
  }
  near(snapDir([0, 0], [10, 6], 'iso'), [r3 / 2 * (10 * r3 / 2 + 3), (10 * r3 / 2 + 3) / 2])
  const q = octiPoint([10, 3], [0, 0], [20, 0], 'iso')
  for (const a of angles([[0, 0], q, [20, 0]])) assert.ok(Math.abs(Math.abs(a) - Math.PI / 6) < 1e-9)
})
