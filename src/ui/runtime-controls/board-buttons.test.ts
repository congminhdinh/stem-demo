import { describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { fixtureDocument } from '../../core/profiles/__fixtures__/test-profiles';
import { buttonPresses, num, print, program, wait } from '../../core/program/__fixtures__/ybc-blocks';
import { createRunSession } from '../../core/run/run-session';
import { createOnboardCapabilities } from '../../core/simulation/peripherals/onboard-capabilities';
import { createButtonHolds } from './board-buttons';

// N17 B4: the buttons of a board are held by more than one hand: the panel's buttons (a pointer, a key), the panel's A+B, and the
// buttons drawn on the board. They share one state per button: it is closed while anything holds it, and the run is told only
// when that changes, so a press on the drawing and on the panel at once is one press, and every control shows the same state.

const A = 'board-1/button-a';
const B = 'board-1/button-b';

function setup() {
  const changes: [string, boolean][] = [];
  const holds = createButtonHolds((componentId, closed) => changes.push([componentId, closed]));
  return { holds, changes };
}

describe('the holds of the board’s buttons', () => {
  it('close a button for the first hand that holds it and open it when the last lets go, telling each change once', () => {
    const { holds, changes } = setup();
    holds.hold(A, 'board/pointer:1');
    holds.hold(A, 'panel:button-a/pointer:2');
    expect(holds.isClosed(A)).toBe(true);
    holds.release(A, 'board/pointer:1');
    expect(holds.isClosed(A)).toBe(true);
    holds.release(A, 'panel:button-a/pointer:2');
    expect(holds.isClosed(A)).toBe(false);
    expect(changes).toEqual([[A, true], [A, false]]);
  });

  it('keep A and B apart, and say nothing for a hand that lets go of what it never held', () => {
    const { holds, changes } = setup();
    holds.hold(A, 'board/pointer:1');
    holds.release(B, 'board/pointer:1');
    holds.release(A, 'board/pointer:7');
    holds.hold(A, 'board/pointer:1');
    expect(changes).toEqual([[A, true]]);
    expect(holds.isClosed(B)).toBe(false);
  });

  it('let go of everything one owner holds (a control that loses focus, the drawing), and leave the other owners’ holds', () => {
    const { holds, changes } = setup();
    holds.hold(A, 'panel:button-ab/pointer:1');
    holds.hold(B, 'panel:button-ab/pointer:1');
    holds.hold(B, 'board/pointer:2');
    holds.releaseOwner('panel:button-ab');
    expect(holds.isClosed(A)).toBe(false);
    expect(holds.isClosed(B)).toBe(true);
    // An owner whose name another starts with is another owner.
    holds.hold(A, 'panel:button-a/key: ');
    holds.releaseOwner('panel:button');
    expect(holds.isClosed(A)).toBe(true);
    expect(changes).toEqual([[A, true], [B, true], [A, false], [A, true]]);
  });

  it('let go of everything when the run ends', () => {
    const { holds, changes } = setup();
    holds.hold(A, 'board/pointer:1');
    holds.hold(B, 'panel:button-b/pointer:2');
    holds.releaseAll();
    holds.releaseAll();
    expect(changes).toEqual([[A, true], [B, true], [A, false], [B, false]]);
  });

  it('tell their listeners after each change, and only then', () => {
    const { holds } = setup();
    const listener = vi.fn();
    const unsubscribe = holds.subscribe(listener);
    holds.hold(A, 'board/pointer:1');
    holds.hold(A, 'board/pointer:2');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    holds.releaseAll();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('give the run one press for a press on the drawing and the panel at once: get_presses counts it once', async () => {
    vi.useFakeTimers();
    try {
      const registry = createDeviceRegistry(localDeviceDefinitions);
      const session = createRunSession(registry, { capabilities: createOnboardCapabilities });
      session.start(fixtureDocument('ybc-basic', { blocks: program([wait(num(100)), print(buttonPresses('A'))]) }));
      const part = 'ybc-board-1/button-a';
      const holds = createButtonHolds((componentId, closed) => session.setComponentInput(componentId, { kind: 'hold', closed }));
      holds.hold(part, 'board/pointer:1');
      holds.hold(part, 'panel:button-a/pointer:2');
      holds.release(part, 'board/pointer:1');
      holds.release(part, 'panel:button-a/pointer:2');
      holds.hold(part, 'board/pointer:3');
      holds.release(part, 'board/pointer:3');
      await vi.advanceTimersByTimeAsync(150);
      expect(session.getSnapshot().console?.lines).toEqual(['2']);
      session.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
