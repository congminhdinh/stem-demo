import { describe, expect, it } from 'vitest';
import { bodyColor, bodyKindColors, bodyPalette, GRIPPER_FINGER_COLOR, rgbOf } from './body-colors';
import { colorReflectance } from './ground-paint';

// N19 B3 (plan §4.4): the colours the sensors read off a body: its own (`color`, authored or a variant's) or its kind's default, the one the
// renderer paints a body of that kind without a colour of its own (src/ui/robot3d/colors.ts; tests/body-colors-renderer.test.ts holds the
// two together).

describe('body colours (N19 B3)', () => {
  it('gives a body its own colour, or its kind’s default', () => {
    expect(bodyKindColors).toEqual({ wall: '#b8c4d4', box: '#d9a066', cylinder: '#e07a5f', object: '#f2c14e' });
    expect(bodyColor('object', '#D32F2F')).toBe('#D32F2F');
    expect(bodyColor('object', undefined)).toBe('#f2c14e');
    expect(bodyColor('wall', undefined)).toBe('#b8c4d4');
    expect(bodyColor('box', undefined)).toBe('#d9a066');
    expect(bodyColor('cylinder', undefined)).toBe('#e07a5f');
  });

  it('reads a colour’s sRGB components, whatever the case of its digits', () => {
    expect(rgbOf(bodyPalette.red)).toEqual({ r: 211, g: 47, b: 47 });
    expect(rgbOf('#FBC02D')).toEqual({ r: 251, g: 192, b: 45 });
    expect(rgbOf('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbOf('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('gives the gripper’s fingers the rubber of their pads, which the IR sees (luma ≥ 0.15) and a black foam cube is not', () => {
    expect(GRIPPER_FINGER_COLOR).toBe('#2b2e33');
    expect(colorReflectance(GRIPPER_FINGER_COLOR)).toBeCloseTo(0.1793, 4);
    expect(colorReflectance('#212121')).toBeCloseTo(0.1294, 4);
    // Every palette colour reflects enough for the IR (plan §4.1 minReflectance 0.15).
    expect(Object.values(bodyPalette).map((hex) => Math.round(colorReflectance(hex) * 1e4) / 1e4)).toEqual([0.321, 0.4619, 0.4113, 0.7605]);
  });
});
