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
  pushButton: { body: '#3e4c59', outline: '#1f2933', pressed: '#147d64', released: '#3ebd93', capOutline: '#0c6b58', shadow: '#000000' },
  ybcBoard: { shell: '#1f4e5f', shellOutline: '#143642', part: '#2c7a8c', label: '#e6f4f7', sounding: '#f0b429', cellOff: '#10292f' },
} as const;
