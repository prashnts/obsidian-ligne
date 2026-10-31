// ligne's controls in Excalidraw's own look: a tool button at the end of its toolbar and, while
// active, an island of options just below the toolbar. Falls back to the top of the host.

const ICONS: Record<string, string> = {
  ligne: '<path d="M2 15h5l6-6h5"/><circle cx="7" cy="15" r="2"/><circle cx="13" cy="9" r="2"/>',
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
  twist: '<path d="M2 7c4 0 4 6 8 6s4-6 8-6M2 13c4 0 4-6 8-6s4 6 8 6"/>',
  finish: '<path d="M4 10l4 4 8-8"/>',
  undo: '<path d="M8 5L3 10l5 5M3 10h9a5 5 0 0 1 0 10"/>',
  cancel: '<path d="M5 5l10 10M15 5L5 15"/>',
  pick: '<path d="M13 3l4 4-2 2-4-4zM11 5l-7 7v4h4l7-7"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 13V5a1 1 0 0 1 1-1h8"/>',
}
export const icon = (name: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"`
  + ` stroke-linejoin="round">${ICONS[name]}</svg>`

/** A button: icon, title with its shortcut in brackets, the shortcut in the corner. */
export interface Btn { icon: string, title: string, key?: string, on?: boolean, text?: string,
  click: (e: MouseEvent) => void }
export type Item = Btn | HTMLElement | 'sep'

export class Panel {
  private tool = document.createElement('button')
  private box = document.createElement('div')

  constructor(private host: HTMLElement, toggle: () => void) {
    this.tool.className = 'ToolIcon ToolIcon_type_toggle ToolIcon_size_medium ligne-tool'
    this.tool.type = 'button'
    this.tool.title = this.tool.ariaLabel = 'ligne — metro lines [M]'
    this.tool.innerHTML = `<div class="ToolIcon__icon">${icon('ligne')}<span class="ToolIcon__keybinding">M</span></div>`
    this.tool.onclick = toggle
    this.box.className = 'Island ligne-panel'
  }

  /** (Re)attaches to the toolbar: React may re-create it, so this runs on every scene change. */
  mount() {
    const bar = this.host.querySelector<HTMLElement>('.App-toolbar'), stack = bar?.querySelector('.Stack_horizontal')
    if (stack && this.tool.parentElement !== stack) stack.append(this.tool)
    const at = bar ?? this.host
    if (this.box.parentElement !== at) at.append(this.box)
    this.box.classList.toggle('loose', !bar)
  }

  destroy() { this.tool.remove(); this.box.remove() }

  /** `help`: shortcut rows shown in a card under the bar. */
  render(active: boolean, items: Item[], help?: [string, string][]) {
    this.mount()
    this.tool.classList.toggle('ToolIcon--checked', active)
    this.box.classList.toggle('on', active)
    this.box.replaceChildren(...(active ? items.map(i => i === 'sep' ? sep() : i instanceof HTMLElement ? i : btn(i)) : []))
    if (!active || !help) return
    const card = document.createElement('div')
    card.className = 'Island ligne-help'
    card.append(...help.flatMap(([k, t]) => [Object.assign(document.createElement('kbd'), { textContent: k }),
      Object.assign(document.createElement('span'), { textContent: t })]))
    this.box.append(card)
  }
}

function btn(b: Btn) {
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'ligne-btn' + (b.on ? ' on' : '')
  x.title = b.title + (b.key ? ` [${b.key}]` : '')
  x.innerHTML = icon(b.icon) + (b.text ? `<b>${b.text}</b>` : '') + (b.key ? `<kbd>${b.key}</kbd>` : '')
  x.onclick = b.click
  return x
}
const sep = () => Object.assign(document.createElement('span'), { className: 'sep' })
