// Drive a running Obsidian started with --remote-debugging-port.
//   node tools/cdp.mjs eval "<js expression>"     (awaited, result printed as JSON)
//   node tools/cdp.mjs shot out.png
//   node tools/cdp.mjs reload                      (disable+enable the plugin after a build)
// PORT env (default 9334), SIZE env for shots (default 1400x900).
import { writeFileSync } from 'node:fs'

const port = process.env.PORT ?? 9334
const [cmd, arg] = process.argv.slice(2)
const pages = await (await fetch(`http://localhost:${port}/json/list`)).json()
const page = pages.find(p => p.type === 'page' && p.url.startsWith('app://obsidian.md'))
if (!page) throw new Error('no Obsidian page on port ' + port)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails))
  return r.result?.result?.value
}

if (cmd === 'eval') console.log(JSON.stringify(await evaluate(arg), null, 1))
else if (cmd === 'reload') console.log(await evaluate(`app.plugins.disablePlugin('ligne').then(() => app.plugins.enablePlugin('ligne')).then(() => 'reloaded')`))
else if (cmd === 'shot') {
  const [w, h] = (process.env.SIZE ?? '1400x900').split('x').map(Number)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await evaluate(`new Promise(r => setTimeout(r, 600))`)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(arg ?? 'shot.png', Buffer.from(r.result.data, 'base64'))
  console.log('saved', arg)
} else if (cmd === 'size') {
  const [w, h] = (arg ?? '1400x900').split('x').map(Number)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  console.log('size', w, h)
} else if (cmd === 'mouse') {
  // node tools/cdp.mjs mouse x,y [click]  — real input events (hover state, page preview)
  const [x, y] = arg.split(',').map(Number)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  if (process.argv[4] === 'click') {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  console.log('mouse', x, y)
} else if (cmd === 'drag') {
  // node tools/cdp.mjs drag x1,y1 x2,y2  — press, move in steps, release (a pan)
  const [x1, y1] = arg.split(',').map(Number), [x2, y2] = process.argv[4].split(',').map(Number)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
  console.log('drag', x1, y1, '->', x2, y2)
} else if (cmd === 'do') {
  // node tools/cdp.mjs do "key m; click 400,300; dbl 500,300; move 600,300"  — real input, in order
  const mouse = (type, x, y, n = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: n })
  for (const step of arg.split(';').map(s => s.trim()).filter(Boolean)) {
    const [op, a = ''] = step.split(/\s+/), [x, y] = a.split(',').map(Number)
    if (op === 'key') {
      const text = a.length === 1 ? a : undefined
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: a, text, windowsVirtualKeyCode: a === 'Enter' ? 13 : a === 'Escape' ? 27 : 0 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: a })
    } else if (op === 'move') await mouse('mouseMoved', x, y)
    else for (let n = 1; n <= (op === 'dbl' ? 2 : 1); n++) { await mouse('mousePressed', x, y, n); await mouse('mouseReleased', x, y, n) }
  }
  console.log('done')
} else console.log('usage: eval <js> | shot <file> | reload | size WxH | mouse x,y [click] | drag x1,y1 x2,y2 | do "<steps>"')
ws.close()
