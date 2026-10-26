import { describe, expect, it, vi } from 'vitest';
import { createLowTierControl } from './low-tier-control';

// N18 P2 fix round 1 (C1): the dev hooks' hold on the low tier's chain: a mode ('auto' by default, or 'off') and forced steps.

describe('the low tier’s chain control (N18 P2 fix round 1)', () => {
  it('is auto at first, tells each new mode and each forced step, and nothing once a listener stops', () => {
    const control = createLowTierControl();
    expect(control.mode()).toBe('auto');
    const heard = vi.fn();
    const stop = control.subscribe(heard);
    control.setMode('off');
    control.force('cap');
    control.force('offer');
    expect(control.mode()).toBe('off');
    expect(heard.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'mode', mode: 'off' },
      { kind: 'step', step: 'cap' },
      { kind: 'step', step: 'offer' },
    ]);
    stop();
    control.setMode('auto');
    expect(heard).toHaveBeenCalledTimes(3);
    expect(() => control.setMode('never' as 'off')).toThrow(RangeError);
    expect(() => control.force('lift' as 'cap')).toThrow(RangeError);
  });
});
