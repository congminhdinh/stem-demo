// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankFrame } from '../../core/capabilities/frame';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../../core/simulation/peripherals/light';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';
import { DisplayText } from './DisplayText';
import { RuntimeControls } from './RuntimeControls';

// The controls are input adapters: these tests drive their native elements with DOM events (pointer, key,
// focus, input) and read what they send to the run, which is all they do.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const definition = createDeviceRegistry(localDeviceDefinitions).get('ybc-board');
const controls = ['button-a', 'button-b', 'light'];

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

type Sent = [string, ComponentInput];

function setup(active = true) {
  const sent: Sent[] = [];
  const onInput = (componentId: string, input: ComponentInput) => sent.push([componentId, input]);
  const controlsElement = (isActive: boolean, key?: string): ReactElement => (
    <RuntimeControls key={key} boardId="board-1" definition={definition} controls={controls} active={isActive} onInput={onInput} />
  );
  const render = (isActive: boolean, key?: string) => act(async () => root.render(controlsElement(isActive, key)));
  return { sent, render, ready: render(active) };
}

const byTestId = <T extends HTMLElement>(testId: string) => {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`No element with data-testid ${testId}`);
  }
  return element;
};
const buttonA = () => byTestId<HTMLButtonElement>('control-button-a');
const slider = () => byTestId<HTMLInputElement>('control-light');

const fire = (element: Element, event: Event) => act(async () => void element.dispatchEvent(event));
const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init });
const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) =>
  new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
const hold = (closed: boolean): ComponentInput => ({ kind: 'hold', closed });

/** A range input changes by its value setter and an input event, as the browser does. */
async function dragTo(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('what is shown', () => {
  it('has a native button for each of A and B and a labelled range for the light, in a group', async () => {
    const { ready } = setup();
    await ready;

    expect(byTestId('runtime-controls').getAttribute('role')).toBe('group');
    expect(buttonA().tagName).toBe('BUTTON');
    expect(buttonA().type).toBe('button');
    expect(buttonA().textContent).toBe('Button A');
    expect(byTestId('control-button-b').textContent).toBe('Button B');
    expect(slider().type).toBe('range');
    expect(container.querySelector(`label[for="${slider().id}"]`)?.textContent).toBe('Light level');
  });

  it('gives the slider the range of the light sensor and starts it at the initial level, which is shown', async () => {
    await setup().ready;

    expect(slider().min).toBe(String(LIGHT_LEVEL_MIN));
    expect(slider().max).toBe(String(LIGHT_LEVEL_MAX));
    expect(slider().value).toBe(String(LIGHT_LEVEL_INITIAL));
    expect(byTestId('control-light-value').textContent).toBe(String(LIGHT_LEVEL_INITIAL));
  });

  it('shows nothing for a board with no controls in the profile', async () => {
    await act(async () =>
      root.render(<RuntimeControls boardId="b" definition={definition} controls={[]} active onInput={() => undefined} />),
    );

    expect(container.innerHTML).toBe('');
  });

  it('disables every control while no run is active, and enables them while one is', async () => {
    const { render, ready } = setup(false);
    await ready;

    for (const testId of ['control-button-a', 'control-button-b', 'control-light']) {
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(true);
    }

    await render(true);
    for (const testId of ['control-button-a', 'control-button-b', 'control-light']) {
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(false);
    }
  });
});

describe('while a lab’s check drives the run (N8s)', () => {
  const renderScripted = (scripted: Record<string, ComponentInput>) =>
    act(async () =>
      root.render(<RuntimeControls boardId="board-1" definition={definition} controls={controls} active onInput={() => undefined} scripted={scripted} />),
    );

  it('shows the buttons the check holds as pressed, and takes no press of the learner', async () => {
    await renderScripted({ 'board-1/button-a': hold(true), 'board-1/button-b': hold(false) });

    expect(buttonA().getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('control-button-b').getAttribute('aria-pressed')).toBe('false');
    for (const testId of ['control-button-a', 'control-button-b', 'control-light']) {
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(true);
    }
  });

  it('shows the light level the check gives, and the initial level before it gives one', async () => {
    await renderScripted({});
    expect(slider().value).toBe(String(LIGHT_LEVEL_INITIAL));

    await renderScripted({ 'board-1/light': { kind: 'slider', value: 10 } });
    expect(slider().value).toBe('10');
    expect(byTestId('control-light-value').textContent).toBe('10');
  });
});

describe('a button held with the pointer', () => {
  it('sends closed once on pointerdown and open once on pointerup, for the part of the board', async () => {
    const { sent, ready } = setup();
    await ready;

    await fire(buttonA(), pointer('pointerdown'));
    expect(buttonA().getAttribute('aria-pressed')).toBe('true');
    await fire(buttonA(), pointer('pointerup'));

    expect(buttonA().getAttribute('aria-pressed')).toBe('false');
    expect(sent).toEqual([
      ['board-1/button-a', hold(true)],
      ['board-1/button-a', hold(false)],
    ]);
  });

  it('captures the pointer, so the release arrives wherever the pointer is', async () => {
    await setup().ready;
    const capture = vi.fn();
    buttonA().setPointerCapture = capture;

    await fire(buttonA(), pointer('pointerdown', { pointerId: 7 }));

    expect(capture).toHaveBeenCalledWith(7);
  });

  it('still holds when the pointer cannot be captured', async () => {
    const { sent, ready } = setup();
    await ready;
    buttonA().setPointerCapture = () => {
      throw new DOMException('no such pointer', 'NotFoundError');
    };

    await fire(buttonA(), pointer('pointerdown'));
    await fire(buttonA(), pointer('pointerup'));

    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
  });

  it('ignores a secondary mouse button', async () => {
    const { sent, ready } = setup();
    await ready;

    await fire(buttonA(), pointer('pointerdown', { button: 2 }));
    await fire(buttonA(), pointer('pointerup', { button: 2 }));

    expect(sent).toEqual([]);
  });

  it.each(['pointercancel', 'lostpointercapture'])('lets go on %s, once, even when pointerup follows', async (type) => {
    const { sent, ready } = setup();
    await ready;

    await fire(buttonA(), pointer('pointerdown'));
    await fire(buttonA(), pointer(type));
    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
    expect(buttonA().getAttribute('aria-pressed')).toBe('false');

    await fire(buttonA(), pointer('pointerup'));
    await fire(buttonA(), pointer('lostpointercapture'));
    expect(sent).toHaveLength(2);
  });

  it('keeps the button closed until the last of two touches lets go', async () => {
    const { sent, ready } = setup();
    await ready;

    await fire(buttonA(), pointer('pointerdown', { pointerId: 1 }));
    await fire(buttonA(), pointer('pointerdown', { pointerId: 2 }));
    await fire(buttonA(), pointer('pointerup', { pointerId: 1 }));
    expect(sent).toHaveLength(1);
    await fire(buttonA(), pointer('pointerup', { pointerId: 2 }));

    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
  });

  it('holds A and B independently', async () => {
    const { sent, ready } = setup();
    await ready;

    await fire(buttonA(), pointer('pointerdown', { pointerId: 1 }));
    await fire(byTestId('control-button-b'), pointer('pointerdown', { pointerId: 2 }));
    await fire(buttonA(), pointer('pointerup', { pointerId: 1 }));
    await fire(byTestId('control-button-b'), pointer('pointerup', { pointerId: 2 }));

    expect(sent).toEqual([
      ['board-1/button-a', hold(true)],
      ['board-1/button-b', hold(true)],
      ['board-1/button-a', hold(false)],
      ['board-1/button-b', hold(false)],
    ]);
  });
});

describe('a button held with the keyboard', () => {
  it.each([' ', 'Enter'])('closes on keydown of %j, ignores key repeat, and opens on keyup', async (pressed) => {
    const { sent, ready } = setup();
    await ready;
    const down = key('keydown', { key: pressed });
    const repeated = key('keydown', { key: pressed, repeat: true });

    await fire(buttonA(), down);
    await fire(buttonA(), repeated);
    await fire(buttonA(), key('keyup', { key: pressed }));

    // The page does not scroll on Space and the button does not click: the keys are the control's.
    expect(down.defaultPrevented).toBe(true);
    expect(repeated.defaultPrevented).toBe(true);
    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
  });

  it('leaves other keys alone', async () => {
    const { sent, ready } = setup();
    await ready;
    const tab = key('keydown', { key: 'Tab' });
    const letter = key('keydown', { key: 'a' });

    await fire(buttonA(), tab);
    await fire(buttonA(), letter);
    await fire(buttonA(), key('keyup', { key: 'a' }));

    expect(tab.defaultPrevented).toBe(false);
    expect(letter.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it('lets go when the button loses focus, once; a keyup that comes later changes nothing', async () => {
    const { sent, ready } = setup();
    await ready;
    await act(async () => buttonA().focus());

    await fire(buttonA(), key('keydown', { key: ' ' }));
    await act(async () => buttonA().blur());

    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
    expect(buttonA().getAttribute('aria-pressed')).toBe('false');

    await fire(buttonA(), key('keyup', { key: ' ' }));
    expect(sent).toHaveLength(2);
  });
});

describe('a held button when the run ends', () => {
  it('is let go once when the controls are disabled, and does not send again', async () => {
    const { sent, render, ready } = setup();
    await ready;
    await fire(buttonA(), pointer('pointerdown'));

    await render(false);

    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
    expect(buttonA().disabled).toBe(true);
    expect(buttonA().getAttribute('aria-pressed')).toBe('false');
  });

  it('is let go once when the controls go away', async () => {
    const { sent, ready } = setup();
    await ready;
    await fire(buttonA(), pointer('pointerdown'));

    await act(async () => root.render(<div />));

    expect(sent.map(([, input]) => input)).toEqual([hold(true), hold(false)]);
  });

  it('sends nothing for a button that was not held', async () => {
    const { sent, render, ready } = setup();
    await ready;

    await render(false);
    await act(async () => root.render(<div />));

    expect(sent).toEqual([]);
  });
});

describe('the light slider', () => {
  it('sends the new integer level for the part of the board', async () => {
    const { sent, ready } = setup();
    await ready;

    await dragTo(slider(), '80');

    expect(sent).toEqual([['board-1/light', { kind: 'slider', value: 80 }]]);
    expect(byTestId('control-light-value').textContent).toBe('80');
  });

  it('sends each value once, and not the level it already has', async () => {
    const { sent, ready } = setup();
    await ready;

    await dragTo(slider(), String(LIGHT_LEVEL_INITIAL));
    await dragTo(slider(), '20');
    await dragTo(slider(), '20');
    await dragTo(slider(), '100');

    expect(sent.map(([, input]) => input)).toEqual([
      { kind: 'slider', value: 20 },
      { kind: 'slider', value: 100 },
    ]);
  });

  it('starts every run from the initial level: a new key is a new run', async () => {
    const { sent, render, ready } = setup();
    await ready;
    await dragTo(slider(), '90');

    await render(true, 'run-2');

    expect(slider().value).toBe(String(LIGHT_LEVEL_INITIAL));
    expect(byTestId('control-light-value').textContent).toBe(String(LIGHT_LEVEL_INITIAL));
    // Resetting the control sends nothing: a run without input already reads the initial level.
    expect(sent).toEqual([['board-1/light', { kind: 'slider', value: 90 }]]);
  });
});

describe('the display as text', () => {
  const textOf = () => byTestId('display-text').textContent;

  it('shows the frame as 5 lines of 5 characters', async () => {
    const pixels = blankFrame().pixels.map((_, index) => (index % 6 === 0 ? ('#FF0000' as const) : null));

    await act(async () => root.render(<DisplayText display={{ frame: { pixels } }} />));

    expect(textOf()).toBe(['#....', '.#...', '..#..', '...#.', '....#'].join('\n'));
  });

  it('is all off while idle, has an accessible name, and is not in a live region', async () => {
    await act(async () => root.render(<DisplayText display={undefined} />));

    expect(textOf()).toBe(['.....', '.....', '.....', '.....', '.....'].join('\n'));
    expect(byTestId('display-text').getAttribute('aria-label')).toBe('Display text');
    expect(byTestId('display-text').closest('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();
  });
});

// --- N17 B2: the temperature and the accelerometer of the Advanced board ------------------------------------------

describe('the sensors of the Advanced board (N17 B2)', () => {
  const advancedControls = ['button-a', 'button-b', 'light', 'temperature', 'accelerometer'];
  const shake: ComponentInput = { kind: 'gesture' };

  function setupAdvanced(active = true, scripted?: Record<string, ComponentInput>, scriptedEvents?: Record<string, number>) {
    const sent: Sent[] = [];
    const render = (isActive: boolean, given = scripted, events = scriptedEvents, key?: string) =>
      act(async () =>
        root.render(
          <RuntimeControls
            key={key}
            boardId="board-1"
            definition={definition}
            controls={advancedControls}
            active={isActive}
            onInput={(componentId, input) => sent.push([componentId, input])}
            {...(given ? { scripted: given } : {})}
            {...(events ? { scriptedEvents: events } : {})}
          />,
        ),
      );
    return { sent, render, ready: render(active) };
  }
  const pad = () => byTestId<HTMLDivElement>('control-accelerometer');
  const gesture = () => byTestId('control-accelerometer-gesture').textContent;
  const shakeButton = () => byTestId<HTMLButtonElement>('control-accelerometer-shake');
  const faceDown = () => byTestId<HTMLButtonElement>('control-accelerometer-face-down');
  const press = (keyName: string) => fire(pad(), key('keydown', { key: keyName }));

  it('shows a temperature slider of −10..50 °C from 25 °C, with its unit, and sends whole degrees', async () => {
    const { sent, ready } = setupAdvanced();
    await ready;
    const temperature = byTestId<HTMLInputElement>('control-temperature');
    expect([temperature.min, temperature.max, temperature.step, temperature.value]).toEqual(['-10', '50', '1', '25']);
    expect(byTestId('control-temperature-value').textContent).toBe('25 °C');
    expect(container.querySelector(`label[for="${temperature.id}"]`)?.textContent).toBe('Temperature');

    await dragTo(temperature, '-4');
    expect(sent).toEqual([['board-1/temperature', { kind: 'slider', value: -4 }]]);
    expect(byTestId('control-temperature-value').textContent).toBe('-4 °C');
  });

  it('shows the pad lying flat, face up, with its name, the gesture it makes and a hint, in a group', async () => {
    await setupAdvanced().ready;
    expect(pad().closest('[role="group"]')?.textContent).toContain('Tilt');
    expect([pad().dataset.x, pad().dataset.y, pad().dataset.z]).toEqual(['0', '0', '-1024']);
    expect(pad().getAttribute('aria-valuetext')).toBe('x 0, y 0, z -1024 mg');
    expect(gesture()).toBe('Face up');
    expect(pad().tabIndex).toBe(0);
    expect(shakeButton().textContent).toBe('Shake');
    expect(faceDown().getAttribute('aria-pressed')).toBe('false');
  });

  it('moves with the arrow keys, 128 mg a press, says the gesture once beyond 400 mg, and Home lays it flat again', async () => {
    const { sent, ready } = setupAdvanced();
    await ready;
    for (let press_ = 0; press_ < 4; press_++) {
      await press('ArrowLeft');
    }
    expect(sent.map(([, input]) => input)).toEqual([-128, -256, -384, -512].map((x) => ({ kind: 'tilt', x, y: 0 })));
    expect(sent.every(([componentId]) => componentId === 'board-1/accelerometer')).toBe(true);
    expect(gesture()).toBe('Tilted left');
    expect(pad().dataset.x).toBe('-512');

    await press('ArrowUp');
    await press('ArrowUp');
    await press('ArrowUp');
    expect(sent.at(-1)?.[1]).toEqual({ kind: 'tilt', x: -512, y: 384 });
    // x has the first say.
    expect(gesture()).toBe('Tilted left');

    await press('Home');
    expect(sent.at(-1)?.[1]).toEqual({ kind: 'tilt', x: 0, y: 0 });
    expect(gesture()).toBe('Face up');
    // A key that does nothing sends nothing.
    const before = sent.length;
    await press('Enter');
    await press('Home');
    expect(sent).toHaveLength(before);
  });

  it('follows a drag with the pointer, captured, in steps of 32 mg, and stops when it is let go', async () => {
    const { sent, ready } = setupAdvanced();
    await ready;
    const element = pad();
    element.getBoundingClientRect = () => ({ left: 100, top: 100, width: 80, height: 80, right: 180, bottom: 180, x: 100, y: 100, toJSON: () => ({}) });
    const capture = vi.fn();
    element.setPointerCapture = capture;

    await fire(element, pointer('pointerdown', { clientX: 140, clientY: 140 }));
    expect(capture).toHaveBeenCalledWith(1);
    // The centre is flat: nothing changed, nothing sent.
    expect(sent).toEqual([]);
    await fire(element, pointer('pointermove', { clientX: 180, clientY: 140 }));
    expect(sent.at(-1)?.[1]).toEqual({ kind: 'tilt', x: 1024, y: 0 });
    expect(gesture()).toBe('Tilted right');
    await fire(element, pointer('pointermove', { clientX: 140, clientY: 110 }));
    expect(sent.at(-1)?.[1]).toEqual({ kind: 'tilt', x: 0, y: 768 });
    expect(gesture()).toBe('Logo down');
    await fire(element, pointer('pointerup', { clientX: 140, clientY: 110 }));
    const count = sent.length;
    await fire(element, pointer('pointermove', { clientX: 100, clientY: 180 }));
    expect(sent).toHaveLength(count);
    // The dot stays where it was let go.
    expect(pad().dataset.y).toBe('768');
  });

  it('turns the board face down and back: the run gets the z of face down, and the gesture says so', async () => {
    const { sent, ready } = setupAdvanced();
    await ready;
    await act(async () => faceDown().click());
    expect(sent).toEqual([['board-1/accelerometer', { kind: 'tilt', x: 0, y: 0, z: 1024 }]]);
    expect(faceDown().getAttribute('aria-pressed')).toBe('true');
    expect(gesture()).toBe('Face down');
    await act(async () => faceDown().click());
    expect(sent.at(-1)?.[1]).toEqual({ kind: 'tilt', x: 0, y: 0 });
    expect(gesture()).toBe('Face up');
  });

  describe('the shake button', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends a shake, says "Shaken" for 1 s, then the tilt’s gesture again; the tilt is not sent again', async () => {
      const { sent, ready } = setupAdvanced();
      await ready;
      await act(async () => shakeButton().click());
      expect(sent).toEqual([['board-1/accelerometer', shake]]);
      expect(gesture()).toBe('Shaken');
      await act(async () => void vi.advanceTimersByTime(999));
      expect(gesture()).toBe('Shaken');
      await act(async () => void vi.advanceTimersByTime(1));
      expect(gesture()).toBe('Face up');
    });

    it('starts the second again when it is pressed during a shake', async () => {
      const { ready } = setupAdvanced();
      await ready;
      await act(async () => shakeButton().click());
      await act(async () => void vi.advanceTimersByTime(800));
      await act(async () => shakeButton().click());
      await act(async () => void vi.advanceTimersByTime(900));
      expect(gesture()).toBe('Shaken');
      await act(async () => void vi.advanceTimersByTime(100));
      expect(gesture()).toBe('Face up');
    });
  });

  it('does nothing while no run is active: the pad takes no key and no pointer, the buttons are disabled', async () => {
    const { sent, ready } = setupAdvanced(false);
    await ready;
    expect(pad().tabIndex).toBe(-1);
    expect(pad().getAttribute('aria-disabled')).toBe('true');
    expect(shakeButton().disabled).toBe(true);
    expect(faceDown().disabled).toBe(true);
    expect(byTestId<HTMLInputElement>('control-temperature').disabled).toBe(true);
    await press('ArrowLeft');
    await fire(pad(), pointer('pointerdown', { clientX: 0, clientY: 0 }));
    expect(sent).toEqual([]);
  });

  it('shows what a check gives: its temperature, its tilt and its shake, and takes nothing of the learner', async () => {
    vi.useFakeTimers();
    try {
      const { sent, render, ready } = setupAdvanced(true, {
        'board-1/temperature': { kind: 'slider', value: 30 },
        'board-1/accelerometer': { kind: 'tilt', x: -800, y: 0 },
      });
      await ready;
      expect(byTestId('control-temperature-value').textContent).toBe('30 °C');
      expect(pad().dataset.x).toBe('-800');
      expect(gesture()).toBe('Tilted left');
      expect(shakeButton().disabled).toBe(true);
      await press('ArrowRight');
      expect(sent).toEqual([]);

      await render(true, { 'board-1/accelerometer': { kind: 'tilt', x: -800, y: 0 } }, { 'board-1/accelerometer': 1 });
      expect(gesture()).toBe('Shaken');
      await act(async () => void vi.advanceTimersByTime(1000));
      expect(gesture()).toBe('Tilted left');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts every run lying flat and not shaken: a new key is a new run', async () => {
    const { render, ready } = setupAdvanced();
    await ready;
    await press('ArrowRight');
    await press('ArrowRight');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(gesture()).toBe('Tilted right');
    await render(true, undefined, undefined, 'run-2');
    expect(gesture()).toBe('Face up');
    expect(pad().dataset.x).toBe('0');
  });
});
