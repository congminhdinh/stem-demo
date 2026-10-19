// Every colour the circuit canvas draws with (N6a S5), in one place: the Konva renderers read them from here
// instead of writing their own. The values are the ones the renderers had, so the canvas looks as before; a
// theme changes this file only. The chrome around the canvas uses the CSS tokens of app.css.

export const canvasPalette = {
  /** The dashed frame of the selected component, and the wire being drawn. */
  selection: '#2680c2',
  /** The frame of a component this kind of project cannot use. */
  incompatible: '#d64545',
  wire: { normal: '#334e68', selected: '#2680c2' },
  port: {
    gpio: '#2680c2',
    power: '#d64545',
    ground: '#1f2933',
    passive: '#7b8794',
    outline: '#ffffff',
    highlighted: '#f0b429',
    label: '#52606d',
  },
  generic: { body: '#e4e7eb', outline: '#9aa5b1', label: '#334e68' },
  led: { lit: '#ff3b30', dark: '#7f1d1d', outline: '#5c1010', glow: '#ff3b30', base: '#9aa5b1' },
  potentiometer: { body: '#3e4c59', outline: '#1f2933', knob: '#cbd2d9', knobOutline: '#52606d', pointer: '#1f2933', label: '#e4e7eb' },
  /** N17 B5: a 180° servo seen from above: a blue case, its mounting tabs, a white arm on a light hub, the arm's travel, the angle. */
  servo: { body: '#1e5aa8', outline: '#12355f', tab: '#2a6cc0', hub: '#e4e7eb', horn: '#f8f9fa', track: '#9fb3c8', label: '#334e68' },
  pushButton: { body: '#3e4c59', outline: '#1f2933', pressed: '#147d64', released: '#3ebd93', capOutline: '#0c6b58', shadow: '#000000' },
  ybcBoard: {
    shell: '#1f4e5f',
    shellOutline: '#143642',
    part: '#2c7a8c',
    label: '#e6f4f7',
    sounding: '#f0b429',
    cellOff: '#10292f',
    /**
     * The rim of a lit cell (N17 B1): a dark colour of the palette (indigo #4B0082, purple, blue) is close to `cellOff` on this
     * board, so every lit cell gets a light rim and a glow of its own colour, and lit never reads as off.
     */
    cellLitRim: '#e6f4f7',
    /** A part a lab's check is pressing (N8s): the pressed colour of the controls (app.css `--stem-color-pressed`). */
    pressed: '#147d64',
    /** The quiet line of the sensors' readings under the display while a run is on (N17 B2). */
    readout: '#a9d6df',
  },
} as const;

/**
 * The colour `t` of the way from `from` to `to` (two `#rrggbb`), channel by channel: `from` at 0 and `to` at 1, exactly (N17 B5: an
 * LED as bright as its PWM duty).
 */
export function mixHex(from: string, to: string, t: number): string {
  if (t <= 0) {
    return from;
  }
  if (t >= 1) {
    return to;
  }
  const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * t));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
