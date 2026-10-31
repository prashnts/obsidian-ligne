import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyWidth, dataOf, findLine, lidOf, lineEls, pathOf, relink, replace, restack, specOf, stale, type Spec } from './lines.ts'
import type { Style } from './make.ts'

let n = 0
// a stand-in for Excalidraw's convertToExcalidrawElements
const convert = (skels: any[]) => skels.map(s => ({ id: `e${++n}`, version: 1, groupIds: [], angle: 0, ...s }))
const st: Style = { strokeColor: '#e8590c', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 4,
  strokeStyle: 'solid', roughness: 0, opacity: 100, startArrowhead: null, endArrowhead: null }
const spec = (path: [number, number][], more: Partial<Spec> = {}): Spec =>
  ({ kind: 'line', path, radii: path.map(() => 0), r: 0, ...more })

test('a plain line: one element, its own lid, waypoints relative to it', () => {
  const [e, ...rest] = lineEls(convert, spec([[10, 10], [110, 10]]), st)
  assert.equal(rest.length, 0)
  assert.match(lidOf(e), /^\w{8}$/)
  assert.deepEqual(pathOf(e), [[10, 10], [110, 10]])
  assert.equal(stale(e), false)
  assert.equal(stale({ ...e, points: [...e.points, [5, 5]] }), true)
})

test('a cable: strands and checks in its own group, second colour white', () => {
  const els = lineEls(convert, spec([[0, 0], [100, 0]], { cable: { style: 'checks', n: 2, pitch: 16 } }), st)
  assert.equal(els.length, 4)
  const own = els[0].groupIds[0]
  assert.ok(own && els.every(e => e.groupIds[0] === own))
  assert.equal(els[3].backgroundColor, '#ffffff')
  assert.equal(bodyWidth(els[0]), 8)
  // rebuilt: old extras go, by group, even after a re-id (paste)
  const pasted = els.map((e, i) => ({ ...e, id: `p${i}` }))
  const again = lineEls(convert, specOf(pasted[0]), st, pasted[0])
  const scene = replace(pasted, again)
  assert.equal(scene.filter(e => !e.isDeleted).length, 4)
})

test('chevrons with direction ticks', () => {
  const els = lineEls(convert, spec([[0, 0], [200, 0]], { ticks: true }), st)
  assert.equal(els.filter(e => e.customData.ligne.kind === 'tick').length, 4)
})

test('restack: a line on a lane follows its base, by lid after a re-id, legs kept octilinear', () => {
  const [base] = lineEls(convert, spec([[0, 0], [100, 0]]), st)
  const lid = lidOf(base)
  // B rides A's lane +6 from x=20, then turns down
  const [b] = lineEls(convert, spec([[20, 6], [60, 6], [60, 80]],
    { links: [{ of: lid, i: 0, t: 0.2, d: 6 }, { of: lid, i: 0, t: 0.6, d: 6 }, null] }), st)
  const pasted = { ...base, id: 'pasted' }
  assert.equal(findLine([pasted, b], lid), pasted)
  // A moves down by 10
  const moved = { ...pasted, y: pasted.y + 10, version: 2 }
  const out = restack(convert, [moved, b], 'pasted')
  const nb = out.find(e => e.id === b.id)!
  assert.deepEqual(pathOf(nb).map(p => p.map(Math.round)), [[20, 16], [60, 16], [60, 80]])
  assert.equal(dataOf(nb)!.lid, dataOf(b)!.lid)
})

test('relink: links to a line re-id\'d before lids are found again by where they sit', () => {
  const [a] = lineEls(convert, spec([[0, 0], [100, 0]]), st)
  const [b] = lineEls(convert, spec([[20, 6], [60, 6]], { links: [{ of: 'gone', i: 0, t: 0.2, d: 6 }, null] }), st)
  const old = { ...a, customData: { ligne: { ...dataOf(a), lid: undefined } } }
  const out = relink([old, b])!
  assert.equal(dataOf(out[0])!.lid, a.id)
  assert.equal(dataOf(out[1])!.links![0]!.of, a.id)
  assert.equal(relink(out), undefined)
})

test('restack: a line linked to its own lane is left alone', () => {
  const [a] = lineEls(convert, spec([[0, 0], [100, 0]]), st)
  const self = { ...a, customData: { ligne: { ...dataOf(a), links: [null, { of: lidOf(a), i: 0, t: 0.5, d: 6 }] } } }
  assert.deepEqual(pathOf(restack(convert, [self], self.id)[0]), [[0, 0], [100, 0]])
})
