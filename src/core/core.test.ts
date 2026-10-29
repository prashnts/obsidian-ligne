import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graph, toText, type El } from './graph.ts'
import { nearest, octi, round, simplify, snap8, dist, type XY } from './geom.ts'

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
    { id: 'L', type: 'line', x: 10, y: 10, width: 0, height: 0, strokeColor: '#000', points: [[0, 0], [100, 0]],
      customData: { ligne: { kind: 'line', path: [[0, 0], [100, 0]], r: 0, style: 'trunk' } } },
    ...([['b', 80, 'J3 · FFC\npitch: 0.5mm'], ['a', 20, 'Head']] as const).flatMap(([id, x, text]): El[] => [
      { id, type: 'ellipse', x: x + 5, y: 5, width: 10, height: 10, groupIds: [id + 'g'],
        customData: { ligne: { kind: 'station', line: 'L', shape: 'stop' } } },
      { id: id + 't', type: 'text', x, y: 0, width: 0, height: 0, text, groupIds: [id + 'g'] }]),
  ]
  const g = graph(els)
  assert.deepEqual(g.stations.map(s => [s.label, s.km]), [['Head', 20], ['J3 · FFC', 80]])
  assert.deepEqual(g.stations[1].data, { pitch: '0.5mm' })
  assert.equal(toText(g), 'line L trunk #000\n  10,10 110,10\n  stop Head @30,10 km=20\n'
    + '  stop "J3 · FFC" @90,10 km=80 pitch=0.5mm\n')
})
