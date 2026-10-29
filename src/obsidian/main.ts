// ligne in Obsidian: mounts the tool on every open drawing of the Excalidraw plugin, using that
// plugin's own Excalidraw API and bundle (window.ExcalidrawLib). Nothing of Excalidraw is shipped.
import { Notice, Plugin } from 'obsidian'
import { Ligne } from '../tool.ts'

export default class LignePlugin extends Plugin {
  private tools = new Map<any, Ligne>()            // per Excalidraw view

  onload() {
    // the view's API comes and goes (file switch, reload): check once a second, cheap
    this.registerInterval(window.setInterval(() => this.sync(), 1000))
    this.app.workspace.onLayoutReady(() => this.sync())
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.sync()))
    this.addCommand({ id: 'toggle', name: 'Toggle the line tool', checkCallback: c => this.withTool(c, t => t.setActive(!t.active)) })
    this.addCommand({ id: 'copy-graph', name: 'Copy the graph as text', checkCallback: c => this.withTool(c, t => {
      navigator.clipboard.writeText(t.text()); new Notice('ligne: graph copied')
    }) })
  }

  onunload() { this.tools.forEach(t => t.destroy()); this.tools.clear() }

  private activeView() { return (this.app.workspace as any).activeLeaf?.view }

  private withTool(checking: boolean, f: (t: Ligne) => void) {
    const t = this.tools.get(this.activeView())
    if (t && !checking) f(t)
    return !!t
  }

  private sync() {
    const lib = (window as any).ExcalidrawLib, seen = new Set<any>()
    for (const leaf of this.app.workspace.getLeavesOfType('excalidraw')) {
      const v: any = leaf.view, api = v.excalidrawAPI, host = v.contentEl?.querySelector('.excalidraw')
      if (!api || !host || !lib) continue
      seen.add(v)
      const t = this.tools.get(v)
      if (t && t.api === api && host.contains(t.layer)) continue
      t?.destroy()
      this.tools.set(v, new Ligne(api, host, lib.convertToExcalidrawElements, () => this.activeView() === v))
    }
    for (const [v, t] of this.tools) if (!seen.has(v)) { t.destroy(); this.tools.delete(v) }
  }
}
