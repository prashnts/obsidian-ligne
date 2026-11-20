// ligne's colours: a metro set (eight line colours of even weight, apart at a glance) and signal
// colours by use (power, ground, data, clock, …), which net names map onto. The data and clock
// colours are the user's own convention: light navy for data, mid-light green for clock.

export interface Swatch { name: string, color: string }

/** Metro lines: even weight, told apart at a glance, fine on white and in print. */
export const METRO: Swatch[] = [
  { name: 'red', color: '#d9480f' }, { name: 'blue', color: '#1c7ed6' }, { name: 'green', color: '#2f9e44' },
  { name: 'yellow', color: '#f59f00' }, { name: 'purple', color: '#7048e8' }, { name: 'teal', color: '#0c8599' },
  { name: 'pink', color: '#d6336c' }, { name: 'brown', color: '#8d5a2b' },
]

export type Signal = 'power' | 'ground' | 'data' | 'clock' | 'analog' | 'control' | 'rf'
/** Signal colours by use. */
export const SIGNALS: Record<Signal, string> = {
  power: '#e03131', ground: '#343a40', data: '#5e9cd4', clock: '#69db7c', analog: '#f08c00', control: '#ae3ec9',
  rf: '#c2255c',
}
export const SIGNAL_NAMES = Object.keys(SIGNALS) as Signal[]

/** Net names to uses (upper case, digits and a trailing +/- or N/P dropped where it helps). */
const NETS: [RegExp, Signal][] = [
  [/^(GND|AGND|DGND|PGND|VSS|0V|COM)$/, 'ground'],
  [/^(V(CC|DD|IN|BUS|BAT|SYS|MOT|REF)?|\+?\d+V\d*|\d+V\d+|3V3|1V8|VCC_?\w*|VDD_?\w*|\+V\w*|PWR|VM)$/, 'power'],
  [/^(SCL|SCK|SCLK|CLK\w*|\w*_CLK|BCLK|MCLK|LRCK|WS|XTAL\w*|XIN|XOUT|TCK|SWCLK|PCLK)$/, 'clock'],
  [/^(SDA|MOSI|MISO|COPI|CIPO|SDI|SDO|DIN|DOUT|DQ|DATA\w*|D[+-]|D[PN]|TXD?|RXD?|TX\d|RX\d|CAN_?[HL]|TDI|TDO|TMS|SWDIO|SD\d|DAT\d|D\d{1,2}|IO\d+)$/, 'data'],
  [/^(A\d+|AIN\d*|ADC\w*|SENSE\w*|VOUT|AOUT|OUT[+-]?|IN[+-]|E[+-]|S[+-]|SIG)$/, 'analog'],
  [/^(CS\d*|NCS|SS|NSS|EN|NEN|RST|NRST|RESET|INT\d*|IRQ\w*|ALERT|BOOT\w*|DRDY|BUSY|STEP|DIR|PWM\w*|LED\w*)$/, 'control'],
  [/^(ANT\w*|RF\w*|SMA)$/, 'rf'],
]

/** The use a net name implies, if any. */
export function signalOf(name: string): Signal | undefined {
  const n = name.trim().toUpperCase().replace(/^[~/!]/, 'N')
  for (const [re, s] of NETS) if (re.test(n)) return s
}

/** The colour a net name implies, if any. */
export const netColor = (name: string) => { const s = signalOf(name); return s && SIGNALS[s] }

/** A cable's own wire colours (specs, see wireColor): as set, else the signal colours in Qwiic order
 *  (ground, power, data, clock), then the rest. */
export function ownColors(n: number, colors?: string[]): string[] {
  const order = [SIGNALS.ground, SIGNALS.power, SIGNALS.data, SIGNALS.clock, SIGNALS.analog, SIGNALS.control, SIGNALS.rf]
  return Array.from({ length: n }, (_, j) => colors?.[j] ?? order[j % order.length])
}

/** A pastel set for lines and jackets: soft, still told apart. */
export const PASTEL: Swatch[] = [
  { name: 'rose', color: '#f4a6a6' }, { name: 'peach', color: '#fdc89a' }, { name: 'butter', color: '#fde58a' },
  { name: 'mint', color: '#a8dcb0' }, { name: 'sky', color: '#a5c8ee' }, { name: 'lilac', color: '#c6b6f2' },
  { name: 'aqua', color: '#9ed9e0' }, { name: 'blush', color: '#f7b7cf' }, { name: 'sand', color: '#d9c3a5' },
  { name: 'fog', color: '#c4c9ce' }, { name: 'slate', color: '#7d8590' }, { name: 'chalk', color: '#f8f9fa' },
]

/** Insulation colours by name: true, then pastel. */
export const WIRES: Record<string, [string, string]> = {
  black: ['#1e1e1e', '#5c5f66'], brown: ['#8b4513', '#c4a484'], red: ['#e03131', '#f4a6a6'],
  orange: ['#fd7e14', '#fdc89a'], yellow: ['#fab005', '#fde58a'], green: ['#2f9e44', '#a8dcb0'],
  blue: ['#1c7ed6', '#a5c8ee'], violet: ['#7048e8', '#c6b6f2'], grey: ['#868e96', '#c4c9ce'],
  white: ['#f1f3f5', '#fbfbfc'], pink: ['#e64980', '#f7b7cf'], turquoise: ['#0c8599', '#9ed9e0'],
  copper: ['#b87333', '#e0b48c'], silver: ['#adb5bd', '#dee2e6'],
}
export const WIRE_NAMES = Object.keys(WIRES)
const SHORT: Record<string, string> = { bk: 'black', blk: 'black', br: 'brown', bn: 'brown', rd: 'red', or: 'orange',
  og: 'orange', ye: 'yellow', yl: 'yellow', gn: 'green', grn: 'green', bu: 'blue', bl: 'blue', blu: 'blue', vt: 'violet',
  vi: 'violet', purple: 'violet', gy: 'grey', gray: 'grey', wh: 'white', wt: 'white', pk: 'pink', tq: 'turquoise',
  teal: 'turquoise', cu: 'copper', bare: 'copper', drain: 'silver', tin: 'silver' }

const softHex = (c: string) => {
  const m = c.match(/^#([0-9a-f]{6})$/i)?.[1]
  return m ? '#' + [0, 2, 4].map(i => Math.round(parseInt(m.slice(i, i + 2), 16) * .55 + 255 * .45)
    .toString(16).padStart(2, '0')).join('') : c
}
/** A colour name (or short: rd, bk, y for yellow…) or #hex, in true or pastel tone. */
export function tone(c: string, pastel = false): string {
  const k = c.trim().toLowerCase(), n = WIRES[k] ? k : SHORT[k] ?? (k === 'y' ? 'yellow' : k === 'g' ? 'green' : '')
  if (n) return WIRES[n][pastel ? 1 : 0]
  return pastel ? softHex(k) : k
}
/** A wire spec: 'red', '#e03131', 'white/orange' (striped), 'green/yellow'. */
export function wireColor(spec: string, pastel = false): { color: string, stripe?: string } {
  const [a, b] = spec.split('/')
  return { color: tone(a, pastel), ...(b ? { stripe: tone(b, pastel) } : {}) }
}
/** Wire specs typed by hand: commas or spaces between wires. */
export const parseWires = (s: string) => s.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
