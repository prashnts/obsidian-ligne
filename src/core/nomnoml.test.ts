import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layers, parse, place } from './nomnoml.ts'

test('parse: nodes, classifiers, compartments, links', () => {
  const g = parse(`#direction: right
// a comment
[<database> Store] <- [Api|url;token|get()]
[Api] reads --> 0..* [<note> Cache]
[Api] -:> [<abstract> Base]`)
  assert.equal(g.dir, 'right')
  const by = new Map(g.nodes.map(n => [n.id, n]))
  assert.equal(by.get('Store')!.kind, 'database')
  assert.equal(by.get('Api')!.kind, 'table')
  assert.deepEqual(by.get('Api')!.parts, [['Api'], ['url', 'token'], ['get()']])
  assert.equal(by.get('Cache')!.kind, 'document')
  assert.deepEqual(g.edges.map(e => [e.from, e.to, e.start, e.end, e.dashed]), [
    ['Store', 'Api', 'arrow', 'none', false], ['Api', 'Cache', 'none', 'arrow', true], ['Api', 'Base', 'none', 'triangle', false]])
  assert.deepEqual(g.edges[1].labels, ['reads', '0..*'])
})

test('layers and place: ranks follow the links, cycles broken', () => {
  const g = parse('[A] -> [B]\n[B] -> [C]\n[C] -> [A]\n[A] -> [D]')
  const { rank } = layers(g)
  assert.equal(rank.get('A'), 0); assert.equal(rank.get('B'), 1); assert.equal(rank.get('C'), 2); assert.equal(rank.get('D'), 1)
  const at = place(g, new Map(g.nodes.map(n => [n.id, [100, 40]])))
  assert.ok(at.get('C')![1] > at.get('B')![1] && at.get('B')![1] > at.get('A')![1])
})
