// nomnoml text to a graph, laid out in layers: nodes ([A], [<kind> A], [A|fields|methods]) and the
// links between them ([A] -> [B], [A] label - label [B], --> dashed, <-> both ways, -:> inherits,
// o-> / +-> aggregate / compose), `#direction: right`. No dependencies; the subset that turns into
// blocks and ligne lines. Nesting inside a node is read as text.
import type { BlockKind } from './block.ts'

export interface NNode { id: string, kind: BlockKind, title: string, parts: string[][], classifier: string }
export type Head = 'none' | 'arrow' | 'triangle' | 'diamond' | 'dot'
export interface NEdge { from: string, to: string, start: Head, end: Head, dashed: boolean, labels: [string, string] }
export interface NGraph { nodes: NNode[], edges: NEdge[], dir: 'down' | 'right' }

/** nomnoml classifiers to block kinds. */
const KINDS: Record<string, BlockKind> = {
  class: 'process', abstract: 'process', instance: 'process', reference: 'process', frame: 'process', sync: 'process',
  note: 'document', package: 'folder', database: 'database', start: 'icon', end: 'icon', state: 'terminator',
  usecase: 'terminator', choice: 'decision', input: 'data', sender: 'data', receiver: 'data', transceiver: 'data',
  actor: 'icon', label: 'text', hidden: 'text', table: 'table', lollipop: 'icon', socket: 'icon',
}

/** The text inside the outer brackets of a node, from i (at '['): the text and the index after ']'. */
function bracket(s: string, i: number): [string, number] {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '[') depth++
    else if (s[j] === ']' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return [s.slice(i + 1), s.length]
}

/** A node's text: optional <classifier>, then compartments split by | (lines by ;). */
function node(body: string): Omit<NNode, 'id'> {
  const m = body.match(/^\s*<(\w+)>\s*([\s\S]*)$/), classifier = m ? m[1].toLowerCase() : 'class', rest = m ? m[2] : body
  const parts = rest.split('|').map(p => p.split(';').map(l => l.trim()).filter(Boolean))
  const title = parts[0]?.join(' ') ?? ''
  let kind = KINDS[classifier] ?? 'process'
  if (kind === 'process' && parts.length > 1) kind = 'table'
  return { kind, title, parts, classifier }
}

/** An association between two nodes: `label1 <arrow> label2`. */
function link(mid: string): Omit<NEdge, 'from' | 'to'> | undefined {
  const m = mid.match(/^(.*?)\s*([<o+]?[:]?-{1,2}[:]?[>o+]?)\s*(.*)$/)
  if (!m) return
  const [, a, arrow, b] = m
  const head = (c: string, colon: boolean): Head => c === 'o' ? 'diamond' : c === '+' ? 'diamond'
    : c === '<' || c === '>' ? (colon ? 'triangle' : 'arrow') : 'none'
  const l = arrow.match(/^([<o+]?)(:?)(-{1,2})(:?)([>o+]?)$/)
  if (!l) return
  return { start: head(l[1], !!l[2]), end: head(l[5], !!l[4]), dashed: l[3] === '--', labels: [a.trim(), b.trim()] }
}

export function parse(src: string): NGraph {
  const nodes = new Map<string, NNode>(), edges: NEdge[] = []
  let dir: NGraph['dir'] = 'down'
  const add = (body: string) => {
    const n = node(body), id = n.title || body.trim()
    if (!nodes.has(id)) nodes.set(id, { id, ...n })
    else if (n.parts.length > nodes.get(id)!.parts.length || n.classifier !== 'class') nodes.set(id, { id, ...n })
    return id
  }
  // statements: lines, minus comments; a node may span lines inside its brackets
  const text = src.replace(/\/\/[^\n]*/g, '')
  for (const raw of text.split(/\n(?![^[]*\])/)) {
    const line = raw.trim()
    if (!line) continue
    const d = line.match(/^#direction:\s*(\w+)/i)
    if (d) { dir = d[1].toLowerCase() === 'right' ? 'right' : 'down'; continue }
    if (line.startsWith('#')) continue
    // [A] mid [B] mid [C] …
    let i = line.indexOf('['), prev: string | undefined, lastEnd = 0
    while (i >= 0) {
      const [body, after] = bracket(line, i), id = add(body)
      if (prev) {
        const mid = line.slice(lastEnd, i).trim(), l = link(mid)
        if (l) edges.push({ from: prev, to: id, ...l })
      }
      prev = id
      lastEnd = after
      i = line.indexOf('[', after)
    }
  }
  return { nodes: [...nodes.values()], edges, dir }
}

/** Layers: each node's rank (longest path from the sources, links back up a cycle ignored) and
 *  its order in the rank (barycentres, a few sweeps). */
export function layers(g: NGraph): { rank: Map<string, number>, order: string[][] } {
  const ids = g.nodes.map(n => n.id), out = new Map(ids.map(id => [id, [] as string[]])), back = new Set<NEdge>()
  // drop the links that close cycles (depth-first)
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const e of g.edges.filter(e => e.from === id)) {
      const s = state.get(e.to) ?? 0
      if (s === 1) back.add(e)
      else if (s === 0) visit(e.to)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!state.get(id)) visit(id)
  for (const e of g.edges) if (!back.has(e) && e.from !== e.to) out.get(e.from)!.push(e.to)
  const rank = new Map<string, number>()
  const depth = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!
    rank.set(id, 0)
    const ins = g.edges.filter(e => e.to === id && !back.has(e) && e.from !== e.to)
    const r = ins.length ? Math.max(...ins.map(e => depth(e.from) + 1)) : 0
    rank.set(id, r)
    return r
  }
  for (const id of ids) depth(id)
  const n = Math.max(0, ...rank.values()) + 1
  const order: string[][] = Array.from({ length: n }, () => [])
  for (const id of ids) order[rank.get(id)!].push(id)
  // barycentres: down, up, down
  const pos = () => new Map(order.flatMap(r => r.map((id, i) => [id, i] as const)))
  const near = (id: string, up: boolean) => g.edges.filter(e => !back.has(e) && (up ? e.to === id : e.from === id))
    .map(e => up ? e.from : e.to)
  for (const up of [true, false, true]) {
    const p = pos(), rs = up ? order.slice(1) : order.slice(0, -1).reverse()
    for (const r of rs) {
      const bc = new Map(r.map(id => { const ns = near(id, up); return [id, ns.length ? ns.reduce((s, x) => s + p.get(x)!, 0) / ns.length : p.get(id)!] }))
      r.sort((a, b) => bc.get(a)! - bc.get(b)!)
    }
  }
  return { rank, order }
}

/** Positions (centres) for nodes of the given sizes, rank after rank along the direction. */
export function place(g: NGraph, size: Map<string, [number, number]>, gap = 60, step = 90): Map<string, [number, number]> {
  const { order } = layers(g), at = new Map<string, [number, number]>(), down = g.dir === 'down'
  let along = 0
  for (const r of order) {
    const deep = Math.max(...r.map(id => size.get(id)![down ? 1 : 0]))
    const widths = r.map(id => size.get(id)![down ? 0 : 1]), total = widths.reduce((s, w) => s + w, 0) + gap * (r.length - 1)
    let across = -total / 2
    r.forEach((id, i) => {
      const c = across + widths[i] / 2
      at.set(id, down ? [c, along + deep / 2] : [along + deep / 2, c])
      across += widths[i] + gap
    })
    along += deep + step
  }
  return at
}
