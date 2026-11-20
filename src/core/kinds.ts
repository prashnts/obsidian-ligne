// Everyday jacketed cables as presets: wire set, plugs at each end, jacket colour, and the
// thicknesses they come in (mm across, from makers' sheets; typical, not exact).
import type { Cable } from './cable.ts'
import type { Conn, WireSet } from './flat.ts'

export interface Kind {
  name: string, set: WireSet, conn: [Conn, Conn], color: string, sizes: Record<string, number>, shield?: boolean
}

export const KINDS: Record<string, Kind> = {
  usbc: { name: 'USB-C', set: 'usb', conn: ['usbc', 'usbc'], color: 'black', sizes: { thin: 3, std: 4, '100 W': 4.8 },
    shield: true },
  usbac: { name: 'USB A–C', set: 'usb', conn: ['usba', 'usbc'], color: 'black', sizes: { thin: 3, std: 4 }, shield: true },
  usbmicro: { name: 'USB A–micro', set: 'usb', conn: ['usba', 'microb'], color: 'black', sizes: { thin: 2.8, std: 3.5 } },
  usbmini: { name: 'USB A–mini', set: 'usb', conn: ['usba', 'minib'], color: 'black', sizes: { std: 3.5 } },
  usbb: { name: 'USB A–B', set: 'usb', conn: ['usba', 'usbb'], color: 'grey', sizes: { std: 4.5, thick: 5.5 }, shield: true },
  hdmi: { name: 'HDMI', set: 'hdmi', conn: ['hdmi', 'hdmi'], color: 'black', sizes: { slim: 4.2, std: 7.3, thick: 9 },
    shield: true },
  hdmimicro: { name: 'HDMI–micro', set: 'hdmi', conn: ['hdmi', 'microhdmi'], color: 'black', sizes: { slim: 4.2, std: 6 },
    shield: true },
  hdmimini: { name: 'HDMI–mini', set: 'hdmi', conn: ['hdmi', 'minihdmi'], color: 'black', sizes: { slim: 4, std: 6 },
    shield: true },
  dp: { name: 'DisplayPort', set: 'hdmi', conn: ['dp', 'dp'], color: 'black', sizes: { slim: 5, std: 7 }, shield: true },
  ethernet: { name: 'Ethernet', set: 't568b', conn: ['rj45', 'rj45'], color: 'blue',
    sizes: { slim: 3.8, Cat5e: 5.2, Cat6: 6, Cat6A: 7.5 } },
  dc: { name: 'DC barrel', set: 'power', conn: ['barrel', 'strip'], color: 'black', sizes: { thin: 3, std: 3.5, '5 A': 4.5 } },
  audio: { name: 'Audio 3.5', set: 'audio', conn: ['trs', 'trs'], color: 'black', sizes: { thin: 3, std: 4 }, shield: true },
  mains: { name: 'Mains', set: 'mains', conn: ['strip', 'strip'], color: 'grey',
    sizes: { '0.75 mm²': 6.4, '1 mm²': 6.9, '1.5 mm²': 7.9 } },
  stepper: { name: 'Stepper', set: 'stepper', conn: ['jst', 'dupont'], color: 'black', sizes: { std: 4.5 } },
  servo: { name: 'Servo', set: 'servo', conn: ['dupont', 'strip'], color: 'brown', sizes: { std: 3 } },
  qwiic: { name: 'Qwiic', set: 'qwiic', conn: ['sh', 'sh'], color: 'black', sizes: { std: 2.5 } },
}
export const KIND_IDS = Object.keys(KINDS)

/** The standard thickness of a kind (else its middle one). */
export function stdSize(k: Kind): string {
  const names = Object.keys(k.sizes)
  return names.includes('std') ? 'std' : names[Math.floor(names.length / 2)]
}

/** A jacket of kind `id`, `size` thick: the cable patch (the wire count from its set). */
export function kindCable(id: string, size: string | undefined, n: number): Partial<Cable> {
  const k = KINDS[id], mm = k.sizes[size ?? stdSize(k)] ?? k.sizes[stdSize(k)]
  return { style: 'jacket', kind: id, n, mm, set: k.set, shield: k.shield, conn: { start: k.conn[0], end: k.conn[1] } }
}
