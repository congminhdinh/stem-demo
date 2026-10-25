import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { boardLayout, padLook } from './board-layout';
import { hubMap } from './pin-map';

// N18 R4.5: where the pins of the generic UNO-compatible board are on the hub panel's drawing. The drawing is our own: a board with
// the digital header along the top, D13 at the left to D0 at the right with the gap a real header has after D8, and the analog header
// along the bottom right. No logo, no wordmark.

const layout = boardLayout(hubMap(productionKits.get(referenceKitRef) as Kit, unoR3Board));
const pad = (id: string) => layout.pads.find((candidate) => candidate.id === id)!;

describe('boardLayout (N18 R4.5)', () => {
  it('places every pin of the board once: D0 to D13 along the top, A0 to A5 along the bottom', () => {
    expect(layout.pads.map((candidate) => candidate.id).sort()).toEqual(unoR3Board.pins.map((pin) => pin.id).sort());
    expect(layout.pads.filter((candidate) => candidate.side === 'top').map((candidate) => candidate.id).sort()).toEqual(
      Array.from({ length: 14 }, (_, index) => `D${index}`).sort(),
    );
    expect(layout.pads.filter((candidate) => candidate.side === 'bottom').map((candidate) => candidate.id)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
  });

  it('runs the digital header from D13 at the left to D0 at the right, one pitch apart, with a wider gap between D8 and D7', () => {
    const top = Array.from({ length: 14 }, (_, index) => pad(`D${13 - index}`));
    for (let index = 1; index < top.length; index++) {
      const step = top[index]!.x - top[index - 1]!.x;
      expect(step, `${top[index - 1]!.id} → ${top[index]!.id}`).toBe(index === 6 ? layout.pitch + layout.gap : layout.pitch);
    }
    expect(new Set(top.map((candidate) => candidate.y)).size).toBe(1);
  });

  it('runs the analog header from A0 to A5, ending under D0', () => {
    expect(layout.pads.filter((candidate) => candidate.side === 'bottom').map((candidate) => candidate.x)).toEqual([0, 1, 2, 3, 4, 5].map((index) => pad('A0').x + index * layout.pitch));
    expect(pad('A5').x).toBe(pad('D0').x);
    expect(pad('A0').y).toBeGreaterThan(pad('D0').y);
  });

  it('keeps every pad inside the board and the board inside the drawing', () => {
    const { body } = layout;
    expect(body.x).toBeGreaterThanOrEqual(0);
    expect(body.x + body.width).toBeLessThanOrEqual(layout.width);
    expect(body.y + body.height).toBeLessThanOrEqual(layout.height);
    for (const candidate of layout.pads) {
      expect(candidate.x - layout.padRadius, candidate.id).toBeGreaterThanOrEqual(body.x);
      expect(candidate.x + layout.padRadius, candidate.id).toBeLessThanOrEqual(body.x + body.width);
      expect(candidate.y - layout.padRadius, candidate.id).toBeGreaterThanOrEqual(body.y);
      expect(candidate.y + layout.padRadius, candidate.id).toBeLessThanOrEqual(body.y + body.height);
    }
  });

  it('leaves room outside the board, above the top header and below the bottom one, for the names of the parts', () => {
    expect(layout.body.y).toBeGreaterThanOrEqual(layout.labelRoom);
    expect(layout.height - (layout.body.y + layout.body.height)).toBeGreaterThanOrEqual(layout.labelRoom);
    expect(pad('D5').label).toEqual({ x: pad('D5').x, y: layout.body.y - 6, rotate: -90 });
    expect(pad('A0').label).toEqual({ x: pad('A0').x, y: layout.body.y + layout.body.height + 6, rotate: 90 });
  });

  it('puts the name of a pin inside the board, next to the pad: under a top pad, over a bottom one', () => {
    expect(pad('D5').name.y).toBeGreaterThan(pad('D5').y);
    expect(pad('A0').name.y).toBeLessThan(pad('A0').y);
  });

  it('draws only the pins it knows how to place when a board has others', () => {
    const other = boardLayout({ ...hubMap(productionKits.get(referenceKitRef) as Kit, unoR3Board), board: [{ id: 'X1', index: 0, pwm: false, analog: false }] });
    expect(other.pads).toEqual([]);
  });
});

describe('padLook: how a pad is lit', () => {
  it('is unlit and neutral before a run, when the snapshot says nothing of the pin', () => {
    expect(padLook(undefined, 255)).toEqual({ state: 'idle', glow: 0, input: false });
  });

  it('is dark for LOW and fully lit for HIGH', () => {
    expect(padLook({ reading: { kind: 'low' }, input: false }, 255)).toEqual({ state: 'low', glow: 0, input: false });
    expect(padLook({ reading: { kind: 'high' }, input: false }, 255)).toEqual({ state: 'high', glow: 1, input: false });
  });

  it('is as bright as its duty for PWM, never fainter than a quarter, so a duty of 1 can still be seen', () => {
    expect(padLook({ reading: { kind: 'pwm', duty: 128 }, input: false }, 255)).toEqual({ state: 'pwm', glow: 0.63, input: false });
    expect(padLook({ reading: { kind: 'pwm', duty: 1 }, input: false }, 255)).toEqual({ state: 'pwm', glow: 0.25, input: false });
    expect(padLook({ reading: { kind: 'pwm', duty: 254 }, input: false }, 255)).toEqual({ state: 'pwm', glow: 1, input: false });
  });

  it('is fully lit while a tone plays or a servo is held, and says it is an input', () => {
    expect(padLook({ reading: { kind: 'tone', hz: 440 }, input: false }, 255)).toEqual({ state: 'tone', glow: 1, input: false });
    expect(padLook({ reading: { kind: 'servo', deg: 90 }, input: false }, 255)).toEqual({ state: 'servo', glow: 1, input: false });
    expect(padLook({ reading: { kind: 'high' }, input: true }, 255)).toEqual({ state: 'high', glow: 1, input: true });
  });
});
