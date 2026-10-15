import { describe, expect, it } from 'vitest';
import type { ButtonId } from '../../capabilities/io';
import type { ComponentInput } from '../simulate-circuit';
import { createButtonIO, type ButtonParts } from './buttons';

// The two onboard buttons (contract §5, C-12 and C-13). `is_pressed()` is true while the button is held at the call;
// `get_presses()` is whatever the run counted since the last read. The buttons keep nothing of their own.

/** The parts of a run, recorded: what was asked of which button, with the answers the test gives. */
function recordedParts(inputs: Partial<Record<ButtonId, ComponentInput>>, presses: number[] = []) {
  const asked: string[] = [];
  const parts: ButtonParts = {
    input(button) {
      asked.push(`input ${button}`);
      return inputs[button];
    },
    takePresses(button) {
      asked.push(`takePresses ${button}`);
      return presses.shift() ?? 0;
    },
  };
  return { parts, asked };
}

describe('isPressed (C-12)', () => {
  it('is true for a button that is held', () => {
    const { parts } = recordedParts({ a: { kind: 'hold', closed: true } });
    expect(createButtonIO(parts).isPressed('a')).toBe(true);
  });

  it('is false for a button that is not held, and for a button that was never touched', () => {
    const { parts } = recordedParts({ a: { kind: 'hold', closed: false } });
    const buttons = createButtonIO(parts);
    expect(buttons.isPressed('a')).toBe(false);
    expect(buttons.isPressed('b')).toBe(false);
  });

  it('keeps A and B apart: holding one does not press the other', () => {
    const { parts } = recordedParts({ a: { kind: 'hold', closed: true }, b: { kind: 'hold', closed: false } });
    const buttons = createButtonIO(parts);
    expect(buttons.isPressed('a')).toBe(true);
    expect(buttons.isPressed('b')).toBe(false);

    const swapped = createButtonIO(recordedParts({ a: { kind: 'hold', closed: false }, b: { kind: 'hold', closed: true } }).parts);
    expect(swapped.isPressed('a')).toBe(false);
    expect(swapped.isPressed('b')).toBe(true);
  });

  it('is true only for a hold: an input of another kind does not press a button', () => {
    // Not what the run delivers to a button (the run keeps the kind a button takes), but the answer must not depend on it.
    for (const input of [{ kind: 'slider', value: 100 }, { kind: 'tilt', x: 1, y: 1 }, { kind: 'gesture' }] as const) {
      expect(createButtonIO(recordedParts({ a: input }).parts).isPressed('a'), input.kind).toBe(false);
    }
    const lookalike = { kind: 'slider', value: 1, closed: true } as unknown as ComponentInput;
    expect(createButtonIO(recordedParts({ a: lookalike }).parts).isPressed('a')).toBe(false);
  });

  it('reads the input at every call: it is not latched', () => {
    let input: ComponentInput | undefined = { kind: 'hold', closed: true };
    const buttons = createButtonIO({ input: () => input, takePresses: () => 0 });
    expect(buttons.isPressed('a')).toBe(true);
    input = { kind: 'hold', closed: false };
    expect(buttons.isPressed('a')).toBe(false);
    input = { kind: 'hold', closed: true };
    expect(buttons.isPressed('a')).toBe(true);
  });

  it('asks the run for the input of the button, and does not use up the presses', () => {
    const { parts, asked } = recordedParts({ b: { kind: 'hold', closed: true } }, [4]);
    createButtonIO(parts).isPressed('b');
    expect(asked).toEqual(['input b']);
  });
});

describe('takePresses (C-13)', () => {
  it('returns what the run counted, for the button that was asked', () => {
    const { parts, asked } = recordedParts({}, [3, 5]);
    const buttons = createButtonIO(parts);
    expect(buttons.takePresses?.('a')).toBe(3);
    expect(buttons.takePresses?.('b')).toBe(5);
    expect(asked).toEqual(['takePresses a', 'takePresses b']);
  });

  it('delegates every read to the run, which starts the count again from 0: 3, then 0', () => {
    const { parts } = recordedParts({}, [3]);
    const buttons = createButtonIO(parts);
    expect(buttons.takePresses?.('a')).toBe(3);
    expect(buttons.takePresses?.('a')).toBe(0);
  });

  it('counts nothing itself: it does not read the input, and a held button counts as nothing here', () => {
    const { parts, asked } = recordedParts({ a: { kind: 'hold', closed: true } });
    expect(createButtonIO(parts).takePresses?.('a')).toBe(0);
    expect(asked).toEqual(['takePresses a']);
  });
});
