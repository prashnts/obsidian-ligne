import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signalOf } from './palette.ts'

test('signalOf: net names to uses', () => {
  const want: Record<string, string | undefined> = { SDA: 'data', scl: 'clock', GND: 'ground', '3V3': 'power', '+5V': 'power',
    '12V': 'power', VBUS: 'power', MOSI: 'data', SCK: 'clock', 'D+': 'data', TX: 'data', CS: 'control', '~RST': 'control',
    A0: 'analog', ANT: 'rf', 'E+': 'analog', TOOL_ID: undefined }
  for (const [n, s] of Object.entries(want)) assert.equal(signalOf(n), s, n)
})
