// A nomnoml diagram into the scene: its nodes as blocks, its links as ligne lines docked on their
// ports (arrowheads, dashes, labels at the ends), laid out in layers around a point.
import { SIZE, outOf, portAt, type Port } from './core/block.ts'
import { octi, simplify, type XY } from './core/geom.ts'
import { layers, parse, place, type Head, type NGraph } from './core/nomnoml.ts'
import { lineEls, layered } from './lines.ts'
import { block, label, make, shortId, type Convert, type Font, type Style } from './make.ts'

const HEAD: Record<Head, string | null> = { none: null, arrow: 'arrow', triangle: 'triangle', diamond: 'diamond', dot: 'dot' }

/** Elements for nomnoml `src` centred on `at`; `style`: the lines' look, `r` their bend radius. */
export function diagram(convert: Convert, src: string, at: XY, font: Font, style: Style, r = 16): any[] {
  const g: NGraph = parse(src)
  if (!g.nodes.length) return []
  // sizes from the text: room round the title (and each compartment of a table)
  const text = (t: string) => make(convert, [{ type: 'text', x: 0, y: 0, text: t || ' ', ...font }])[0]
  const size = new Map<string, [number, number]>(), parts = new Map<string, string[]>()
  for (const n of g.nodes) {
    const t = text(n.title), [w0, h0] = SIZE[n.kind]
    if (n.kind === 'table') {
      const ps = n.parts.slice(1).map(p => p.join('\n')), ts = ps.map(text)
      parts.set(n.id, ps)
      size.set(n.id, [Math.max(120, t.width + 32, ...ts.map(x => x.width + 24)),
        t.height + 12 + ts.reduce((s, x) => s + x.height + 12, 0)])
    } else if (n.kind === 'icon') size.set(n.id, [48, 48])
    else size.set(n.id, [Math.max(w0 * .75, t.width + (n.kind === 'decision' ? 80 : 40)), Math.max(h0 * .75, t.height + 28)])
  }
  const centre = place(g, size), out: any[] = [], box = new Map<string, [number, number, number, number]>()
  const xs = [...centre].map(([id, c]) => [c[0] - size.get(id)![0] / 2, c[0] + size.get(id)![0] / 2]).flat()
  const ys = [...centre].map(([id, c]) => [c[1] - size.get(id)![1] / 2, c[1] + size.get(id)![1] / 2]).flat()
  const dx = at[0] - (Math.min(...xs) + Math.max(...xs)) / 2, dy = at[1] - (Math.min(...ys) + Math.max(...ys)) / 2
  const bids = new Map<string, string>()
  for (const n of g.nodes) {
    const [cx, cy] = centre.get(n.id)!, [w, h] = size.get(n.id)!, b: [number, number, number, number] = [cx - w / 2 + dx, cy - h / 2 + dy, w, h]
    box.set(n.id, b)
    const els = block(convert, { kind: n.kind, box: b, text: n.kind === 'icon' ? (n.classifier === 'actor' ? '☺' : '●') : n.title,
      color: style.strokeColor, font, parts: parts.get(n.id) })
    bids.set(n.id, els.find(e => e.customData?.ligne?.kind === 'block').customData.ligne.bid)
    out.push(...els)
  }
  // links: down (right) the layers from the far side to the near one; across a layer side to side;
  // back up a layer round the outside
  const { rank } = layers(g), down = g.dir === 'down', stub = r + 12
  for (const e of g.edges) {
    const ra = rank.get(e.from)!, rb = rank.get(e.to)!, A = box.get(e.from)!, B = box.get(e.to)!
    let pa: Port, pb: Port
    if (rb > ra) [pa, pb] = down ? ['s', 'n'] : ['e', 'w']
    else if (rb < ra) [pa, pb] = down ? ['e', 'e'] : ['s', 's']
    else {
      const before = down ? A[0] < B[0] : A[1] < B[1]
      ;[pa, pb] = down ? (before ? ['e', 'w'] : ['w', 'e']) : (before ? ['s', 'n'] : ['n', 's'])
    }
    const a = portAt(A, pa), b = portAt(B, pb), oa = outOf(pa), ob = outOf(pb)
    const sa: XY = [a[0] + oa[0] * stub, a[1] + oa[1] * stub], sb: XY = [b[0] + ob[0] * stub, b[1] + ob[1] * stub]
    const path = simplify([a, ...octi(sa, sb, undefined, oa), b])
    const arrow = e.start !== 'none' || e.end !== 'none'
    const st: Style = { ...style, strokeStyle: e.dashed ? 'dashed' : style.strokeStyle, startArrowhead: HEAD[e.start],
      endArrowhead: HEAD[e.end] }
    const lid = shortId()
    const els = lineEls(convert, { kind: 'line', lid, path, radii: path.map(() => r), r, arrow,
      docks: { start: { block: bids.get(e.from)!, port: pa }, end: { block: bids.get(e.to)!, port: pb } } }, st)
    out.push(...layered(els))
    // labels at the ends, beside the stub
    e.labels.forEach((t, k) => {
      if (!t) return
      const p = k ? b : a, o = k ? ob : oa, side: XY = [-o[1], o[0]]
      out.push(...label(convert, { type: 'text', at: [p[0] + o[0] * stub * .6, p[1] + o[1] * stub * .6], angle: 0, text: t,
        font: { ...font, fontSize: Math.max(10, font.fontSize - 4) }, color: style.strokeColor, paper: '#ffffff', line: lid,
        on: false, off: style.strokeWidth / 2 + 2, away: side }))
    })
  }
  return out
}
