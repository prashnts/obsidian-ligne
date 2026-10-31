// ligne's controls in Excalidraw's own look: a tool button at the end of its toolbar and, while
// active, an island of options just below the toolbar. Falls back to the top of the host.

const ICONS: Record<string, string> = {
  ligne: '<path d="M3 15h4l6-6h4"/>',
  select: '<path d="M5 3l11 7-5 1-2 5z"/>',
  sheets: '<path d="M6 3h6l3 3v11H6zM3 6v12h9"/>',
  line: '<path d="M3 15l5-5h5l4-4"/>',
  station: '<path d="M2 10h16"/><circle cx="10" cy="10" r="3.5" fill="var(--island-bg-color, #fff)"/>',
  stop: '<circle cx="10" cy="10" r="4"/>',
  interchange: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.5"/>',
  commit: '<circle cx="10" cy="10" r="4.5" fill="currentColor"/>',
  net: '<path d="M3 6h10l4 4-4 4H3z"/>',
  boxed: '<rect x="2.5" y="5" width="15" height="10" rx="4"/><path d="M7 10h6"/>',
  radius: '<path d="M4 17v-6a7 7 0 0 1 7-7h6"/>',
  bend: '<path d="M4 17V9l4-4h9M14 2l3 3-3 3"/>',
  label: '<path d="M2 13h4M14 13h4"/><path d="M7 15l3-8 3 8M8.2 12.5h3.6"/>',
  round: '<path d="M2 7c4 0 4 6 8 6s4-6 8-6M2 13c4 0 4-6 8-6s4 6 8 6"/>',
  zigzag: '<path d="M2 7l4 6 4-6 4 6 4-6M2 13l4-6 4 6 4-6 4 6"/>',
  checks: '<path d="M2 8h4M10 8h4M6 12h4M14 12h4" stroke-width="3" stroke-linecap="butt"/>',
  strands: '<path d="M3 6h14M3 10h14M3 14h14"/>',
  legend: '<path d="M3 6h4M3 10h4M3 14h4M10 6h7M10 10h7M10 14h7"/>',
  paper: '<path d="M5 2h7l3 3v13H5zM12 2v3h3"/>',
  landscape: '<rect x="2" y="5" width="16" height="10" rx="1"/>',
  help: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.5M10 14.5v.1"/>',
  magnet: '<path d="M5 3v7a5 5 0 0 0 10 0V3h-3v7a2 2 0 0 1-4 0V3zM5 6h3M12 6h3"/>',
  free: '<path d="M3 17L17 3M3 17h6M3 17v-6"/>',
  arrow: '<path d="M3 15l5-5h8M13 7l3 3-3 3"/>',
  ticks: '<path d="M2 14h16M5 8h4M7 6l2 2-2 2M12 8h4M14 6l2 2-2 2"/>',
  ribbon: '<path d="M2 6h16M2 9h16M2 12h16M2 15h16"/>',
  ffc: '<rect x="2" y="5" width="16" height="10" rx="1"/><path d="M5 8v4M8 8v4M11 8v4M14 8v4"/>',
  gauge: '<circle cx="10" cy="10" r="2.5"/><circle cx="10" cy="10" r="7"/>',
  set: '<path d="M4 4v12M8 4v12M12 4v12M16 4v12"/>',
  scale: '<path d="M3 17L17 3M11 3h6v6M3 11v6h6"/>',
  fold: '<path d="M2 6h9l6 6v6M11 6v6h6"/>',
  conn: '<rect x="9" y="4" width="8" height="12" rx="1"/><path d="M2 8h7M2 12h7M12 8h2M12 12h2"/>',
  split: '<path d="M2 10h7l7-5M9 10l7 5"/>',
  twist: '<path d="M2 7c4 0 4 6 8 6s4-6 8-6M2 13c4 0 4-6 8-6s4 6 8 6"/>',
  finish: '<path d="M4 10l4 4 8-8"/>',
  undo: '<path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 0 10"/>',
  cancel: '<path d="M5 5l10 10M15 5L5 15"/>',
  pick: '<path d="M13 3l4 4-2 2-4-4zM11 5l-7 7v4h4l7-7"/>',
  grid: '<path d="M3 7h14M3 13h14M7 3v14M13 3v14"/>',
  iso: '<path d="M10 2v16M3 6l14 8M3 14l14-8"/>',
  gap: '<path d="M3 7h14M3 13h14M10 8.5v3M8.5 10h3"/>',
  board: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="6.5" cy="8" r=".9"/><circle cx="10" cy="8" r=".9"/><circle cx="13.5" cy="8" r=".9"/><circle cx="6.5" cy="12" r=".9"/><circle cx="10" cy="12" r=".9"/><circle cx="13.5" cy="12" r=".9"/>',
  R: '<path d="M2 10h3M15 10h3"/><rect x="5" y="7.5" width="10" height="5" rx="2"/>',
  C: '<path d="M2 10h4M14 10h4"/><ellipse cx="10" cy="10" rx="4" ry="3"/>',
  D: '<path d="M2 10h4M14 10h4"/><rect x="6" y="7.5" width="8" height="5"/><path d="M12 7.5v5"/>',
  LED: '<circle cx="10" cy="10" r="5"/><path d="M14 4l2-2M16 6l2-2"/>',
  J: '<rect x="2" y="7" width="16" height="6" rx="1"/><path d="M5 10h.1M10 10h.1M15 10h.1" stroke-width="2.5"/>',
  F: '<rect x="2" y="7" width="16" height="6" rx="1"/><rect x="4" y="9" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/><rect x="14" y="9" width="2" height="2"/>',
  jacket: '<path d="M2 8h16M2 12h16" stroke-width="1.5"/><path d="M2 10h16" stroke-width="4" opacity=".35"/>',
  fan: '<path d="M2 10h6M8 10l4-5h6M8 10h10M8 10l4 5h6"/>',
  shield: '<path d="M3 7l3 6M7 7l3 6M11 7l3 6M15 7l2 4"/><path d="M2 7h16M2 13h16"/>',
  DIP: '<rect x="5" y="3" width="10" height="14" rx="1"/><path d="M2 6h3M2 10h3M2 14h3M15 6h3M15 10h3M15 14h3"/>',
  TO92: '<path d="M4 13a6 6 0 0 1 12 0z"/><path d="M7 13v4M10 13v4M13 13v4"/>',
  module: '<rect x="3" y="4" width="14" height="12" rx="2" stroke-dasharray="2 2"/>',
  text: '<path d="M5 5h10M10 5v11"/>',
  box: '<rect x="2.5" y="6" width="15" height="8"/><path d="M7 10h6"/>',
  rounded: '<rect x="2.5" y="6" width="15" height="8" rx="4"/><path d="M7 10h6"/>',
  netlabel: '<path d="M2 14h16M4 11h8"/>',
  flag: '<path d="M2 10l4-4h12v8H6z"/>',
  solid: '<rect x="2.5" y="6" width="15" height="8" rx="4" fill="currentColor"/>',
  font: '<path d="M4 16l5-12h2l5 12M6.5 11h7"/>',
  chevron: '<path d="M2 6h11l4 4-4 4H2l4-4z"/>',
  linetext: '<path d="M2 10h3M15 10h3"/><path d="M7 7h6M10 7v6"/>',
  svg: '<path d="M4 3h8l4 4v10H4z"/><path d="M7 13l2-4 2 4 2-4"/>',
  rotate: '<path d="M15 9a5 5 0 1 0-1.5 4.5M15 4v5h-5"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 13V5a1 1 0 0 1 1-1h8"/>',
}
export const icon = (name: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"`
  + ` stroke-linejoin="round">${ICONS[name]}</svg>`

/** A button: icon and / or text (or colour stripes), title with its shortcut in brackets, the
 *  shortcut in the corner. */
export interface Btn { icon?: string, title: string, key?: string, on?: boolean, text?: string, swatch?: string[],
  click: (e: MouseEvent) => void }
/** A button opening a popover of labelled rows below it, as Excalidraw's own. */
export interface Menu extends Btn { open: boolean, rows: { label: string, items: Item[] }[] }
export type Item = Btn | Menu | HTMLElement | 'sep'

export class Panel {
  private tool = document.createElement('button')
  private box = document.createElement('div')

  constructor(private host: HTMLElement, toggle: () => void) {
    this.tool.className = 'ToolIcon ToolIcon_type_toggle ToolIcon_size_medium ligne-tool'
    this.tool.type = 'button'
    this.tool.title = this.tool.ariaLabel = 'ligne — metro lines [M]'
    this.tool.innerHTML = `<div class="ToolIcon__icon">${icon('ligne')}<span class="ToolIcon__keybinding">M</span></div>`
    this.tool.onclick = toggle
    noFocus(this.tool)
    this.box.className = 'Island ligne-panel'
  }

  /** (Re)attaches to the toolbar: React may re-create it, so this runs on every scene change. */
  mount() {
    const bar = this.host.querySelector<HTMLElement>('.App-toolbar'), stack = bar?.querySelector('.Stack_horizontal')
    if (stack && this.tool.parentElement !== stack) stack.append(this.tool)
    const at = bar ?? this.host
    if (this.box.parentElement !== at) at.append(this.box)
    this.box.classList.toggle('loose', !bar)
    this.box.style.maxWidth = `${this.host.clientWidth - 32}px`     // wraps in a narrow pane
  }

  destroy() { this.tool.remove(); this.box.remove() }

  /** `help`: shortcut rows shown in a card under the bar. */
  render(active: boolean, items: Item[], help?: [string, string][]) {
    this.mount()
    this.tool.classList.toggle('ToolIcon--checked', active)
    this.box.classList.toggle('on', active)
    this.box.replaceChildren(...(active ? items.map(item) : []))
    if (!active || !help) return
    const card = document.createElement('div')
    card.className = 'Island ligne-help'
    card.append(...help.flatMap(([k, t]) => [Object.assign(document.createElement('kbd'), { textContent: k }),
      Object.assign(document.createElement('span'), { textContent: t })]))
    this.box.append(card)
  }
}

const item = (i: Item): HTMLElement => i === 'sep' ? sep() : i instanceof HTMLElement ? i : 'rows' in i ? menu(i) : btn(i)

function btn(b: Btn) {
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'ligne-btn' + (b.on ? ' on' : '')
  x.title = b.title + (b.key ? ` [${b.key}]` : '')
  const sw = b.swatch?.map(c => `<i style="background:${c}"></i>`).join('')
  x.innerHTML = (b.icon ? icon(b.icon) : '') + (sw ? `<span class="sw">${sw}</span>` : '')
    + (b.text ? `<b>${b.text}</b>` : '') + (b.key ? `<kbd>${b.key}</kbd>` : '')
  x.onclick = b.click
  noFocus(x)
  return x
}

/** Pressing it leaves the focus where it was (Excalidraw's canvas): no Space / Enter re-clicks,
 *  keys keep reaching ligne and Excalidraw. */
export function noFocus(x: HTMLElement) {
  x.tabIndex = -1
  x.addEventListener('pointerdown', e => e.preventDefault())
}

function menu(m: Menu) {
  const at = document.createElement('span'), b = btn(m)
  at.className = 'ligne-menu'
  b.classList.add('drop')
  b.classList.toggle('open', m.open)
  at.append(b)
  if (!m.open) return at
  const pop = document.createElement('div')
  pop.className = 'Island ligne-pop'
  for (const r of m.rows) {
    const row = document.createElement('div')
    row.className = 'row'
    row.append(Object.assign(document.createElement('label'), { textContent: r.label }), ...r.items.map(item))
    pop.append(row)
  }
  at.append(pop)
  // kept inside the window: opens leftwards when it would run off the right
  requestAnimationFrame(() => {
    if (pop.getBoundingClientRect().right > window.innerWidth - 8) Object.assign(pop.style, { left: 'auto', right: '0' })
  })
  return at
}
const sep = () => Object.assign(document.createElement('span'), { className: 'sep' })
