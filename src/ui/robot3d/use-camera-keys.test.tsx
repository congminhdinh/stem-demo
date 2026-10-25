// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCameraCommands, type CameraCommand } from './camera-commands';
import { useCameraKeys } from './use-camera-keys';

// N18 R8: the camera's keys are read only where the 3D view has the focus (or the stage that holds it) and never from a field.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const commands = createCameraCommands();
const stage = createRef<HTMLDivElement>();

function Stage() {
  useCameraKeys(stage, commands);
  return (
    <div ref={stage} className="robot-stage" tabIndex={-1} data-testid="stage">
      <div data-view-focus="" tabIndex={0} data-testid="view">
        <canvas data-testid="canvas" />
      </div>
      <button type="button" data-testid="button">
        Chạy
      </button>
      <input data-testid="field" />
      <input type="range" data-testid="slider" />
      <div className="injectionDiv">
        <div data-testid="blockly" tabIndex={0} />
      </div>
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
let seen: CameraCommand[];
let stop: () => void;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Stage />));
  seen = [];
  stop = commands.subscribe((command) => seen.push(command));
});
afterEach(() => {
  stop();
  act(() => root.unmount());
  host.remove();
});

const press = (testId: string, init: KeyboardEventInit) => {
  const target = host.querySelector(`[data-testid=${testId}]`)!;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('the camera’s keys in the robot lab (N18 R8)', () => {
  it('act when the 3D view has the focus, or the stage that holds it, and stop the page from taking the key', () => {
    const view = press('view', { key: '2', code: 'Digit2' });
    expect(view.defaultPrevented).toBe(true);
    press('canvas', { key: '+', code: 'Equal', shiftKey: true });
    press('stage', { key: 'Home', code: 'Home' });
    press('view', { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    expect(seen).toEqual([{ kind: 'mode', mode: 'follow' }, { kind: 'zoom', direction: 'in' }, { kind: 'reset' }, { kind: 'orbit', dx: 1, dy: 0 }]);
  });

  it('do nothing for a key typed into a field, a slider’s own, or the block editor', () => {
    for (const testId of ['field', 'blockly']) {
      const event = press(testId, { key: '1', code: 'Digit1' });
      expect(event.defaultPrevented).toBe(false);
    }
    press('field', { key: '-', code: 'Minus' });
    press('slider', { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true });
    expect(seen).toEqual([]);
  });

  it('leave a button of the controls its keys: only the view takes them', () => {
    const event = press('button', { key: '3', code: 'Digit3' });
    expect(event.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
  });

  it('leave a key somebody took (the tools’) and a plain arrow, which drives the robot', () => {
    const took = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp', code: 'ArrowUp', shiftKey: true });
    host.querySelector('[data-testid=view]')!.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    host.querySelector('[data-testid=view]')!.dispatchEvent(took);
    press('view', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(seen).toEqual([]);
  });

  it('stop listening when the lab goes away', () => {
    const view = host.querySelector('[data-testid=view]')!;
    act(() => root.unmount());
    view.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '1' }));
    expect(seen).toEqual([]);
    root = createRoot(host);
  });
});
