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

/** A cable's own wire colours: as set, else the signal colours in Qwiic order (ground, power,
 *  data, clock), then the rest. */
export function ownColors(n: number, colors?: string[]): string[] {
  const order = [SIGNALS.ground, SIGNALS.power, SIGNALS.data, SIGNALS.clock, SIGNALS.analog, SIGNALS.control, SIGNALS.rf]
  return Array.from({ length: n }, (_, j) => colors?.[j] ?? order[j % order.length])
}
