import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceSize, nearestPort, parseDevice, portAt, portsOf } from './block.ts'
import { kindCable } from './kinds.ts'

test('a device spec: title, pins per side (commas, else spaces)', () => {
  const d = parseDevice('Pi 4; e: USB0, USB1, ETH; left: GPIO; s: USB-C HDMI0 HDMI1')
  assert.equal(d.title, 'Pi 4')
  assert.deepEqual(d.pins, { e: ['USB0', 'USB1', 'ETH'], w: ['GPIO'], s: ['USB-C', 'HDMI0', 'HDMI1'] })
  assert.deepEqual(portsOf(d.pins), ['n', 'e0', 'e1', 'e2', 's0', 's1', 's2', 'w0'])
  const [w, h] = deviceSize('board', d.title, d.pins)
  assert.ok(w >= 180 && h >= 3 * 24)
})

test('pins: evenly along their side; the nearest one docks', () => {
  const box: [number, number, number, number] = [0, 0, 100, 90], pins = { e: ['a', 'b', 'c'] }
  assert.deepEqual(portAt(box, 'e1', pins), [100, 45])
  assert.deepEqual(portAt(box, 'e0', pins), [100, 15])
  assert.equal(nearestPort(box, [104, 70], pins).port, 'e2')
  assert.equal(nearestPort(box, [50, -3], pins).port, 'n')
})

test('cable kinds: plugs per end, thickness by name', () => {
  const c = kindCable('hdmimicro', 'slim', 13)
  assert.deepEqual(c.conn, { start: 'hdmi', end: 'microhdmi' })
  assert.equal(c.mm, 4.2)
  assert.equal(kindCable('ethernet', undefined, 8).mm, 6)
})
