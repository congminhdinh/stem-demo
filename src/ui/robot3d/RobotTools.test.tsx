// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotStarterDocument } from '../../samples/robot-templates';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { createRobotRunStore } from './robot-run-store';
import { createRobotToolsStore } from './robot-tools-store';
import { RobotTools } from './RobotTools';
import { idleSnapshot } from './scene-math';

// N18 R4.8: the 3D view's tool strip, in jsdom. Lái tay (teleop) with the D-pad, the speed and the keys of the view; Thước đo with its
// reading; Di chuyển robot with Q/E, the arrows and Enter; all of it off and hidden during Kiểm tra, off during a replay, and Lái tay
// disabled with a reason for a kit without the drive. Fix round 1: icon toggles named by their labels, small panels that fold.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const project = robotStarterDocument('rb-drive-to-zone');

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.replaceChildren();
});

/** Animation frames that run only when the test says so. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  return {
    requestFrame: (callback: (now: number) => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelFrame: (handle: number) => void pending.delete(handle),
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

async function setup(options: { drivable?: boolean; locale?: 'vi' | 'en' } = {}) {
  const fake = fakeSession(scenario, kit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit });
  const stage = createRef<HTMLDivElement>();
  await act(async () =>
    root.render(
      <TextProvider locale={options.locale ?? 'vi'}>
        <div className="robot-stage" tabIndex={-1} ref={stage} data-testid="stage">
          <RobotTools store={store} tools={tools} scenario={scenario} drivable={options.drivable ?? true} stage={stage} />
        </div>
        <button type="button" data-testid="outside">ngoài</button>
      </TextProvider>,
    ),
  );
  return { ...fake, frames, store, tools, stage: () => stage.current! };
}

const el = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(async () => el(testId)!.click());
const key = (target: Element, type: 'keydown' | 'keyup', init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })));
const commands = (session: ReturnType<typeof fakeSession>['session']) => session.teleop.mock.calls.map(([command]) => command);
const forward = { op: 'move', direction: 'forward', speed: 50 } as const;
const stop = { op: 'stop' } as const;

describe('the tool strip (N18 R4.8)', () => {
  it('is a labelled group of three icon toggles, each named by its label, pressed or not, its tooltip saying what it does', async () => {
    await setup();
    const strip = el('robot-tools-strip')!;
    expect([strip.getAttribute('role'), strip.getAttribute('aria-label')]).toEqual(['group', 'Công cụ']);
    const toggles = [...strip.querySelectorAll<HTMLButtonElement>('button')];
    expect(toggles.map((button) => [button.getAttribute('aria-label'), button.textContent, button.getAttribute('aria-pressed'), button.getAttribute('aria-disabled')])).toEqual([
      ['Lái tay', '', 'false', 'false'],
      ['Thước đo', '', 'false', 'false'],
      ['Di chuyển robot', '', 'false', 'false'],
    ]);
    expect(el('robot-tool-teleop')!.title).toContain('Phím: ↑ hoặc W tiến, ↓ hoặc S lùi, ← hoặc A quay trái, → hoặc D quay phải, phím cách dừng');
    expect(el('robot-tool-ruler')!.title).toMatch(/^Thước đo: Bấm hai điểm trên sa bàn/);
    expect(el('robot-tool-move')!.title).toContain('dịch bằng phím mũi tên rồi bấm Enter; Q và E xoay 15°');
  });

  it('Lái tay starts teleop, shows the D-pad (four arrows, a stop, its fold) and the speed at 50 %, and gives the view the focus', async () => {
    const { session, store, stage } = await setup();
    await click('robot-tool-teleop');
    expect(session.startTeleop).toHaveBeenCalledTimes(1);
    expect(el('robot-tool-teleop')!.getAttribute('aria-pressed')).toBe('true');
    expect([...el('robot-teleop')!.querySelectorAll('.robot-pad button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Tiến', 'Quay trái', 'Quay phải', 'Lùi', 'Dừng', 'Thu gọn bàn lái']);
    expect(el('robot-teleop-speed')!.getAttribute('aria-label')).toBe('Tốc độ');
    expect(el('robot-teleop')!.querySelector('output')?.textContent).toBe('50 %');
    expect(document.activeElement).toBe(stage());
    await click('robot-tool-teleop');
    expect(store.getState().teleop).toBe(false);
    expect(el('robot-teleop')).toBeNull();
  });

  it('folds the D-pad into one button that shows it again; the keys still drive while it is folded', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    await click('robot-teleop-fold');
    expect(el('robot-pad-forward')).toBeNull();
    expect(el('robot-teleop-fold')!.getAttribute('aria-label')).toBe('Hiện bàn lái');
    expect(el('robot-teleop-fold')!.getAttribute('aria-expanded')).toBe('false');
    expect(el('robot-teleop')!.querySelector('output')?.textContent).toBe('50 %');
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(commands(session)).toEqual([forward]);
    await click('robot-teleop-fold');
    expect(el('robot-pad-forward')).not.toBeNull();
  });

  it('without the drive, Lái tay is disabled and says why', async () => {
    const { session } = await setup({ drivable: false });
    expect(el('robot-tool-teleop')!.getAttribute('aria-disabled')).toBe('true');
    expect(el('robot-tool-teleop')!.title).toBe('Lái tay: Robot này không lái tay được: cần đủ hai động cơ.');
    await click('robot-tool-teleop');
    expect(session.startTeleop).not.toHaveBeenCalled();
  });

  it('is off and hidden during Kiểm tra (the lock), and comes back off after it', async () => {
    const { store, tools } = await setup();
    await click('robot-tool-ruler');
    expect(tools.getState().tool).toBe('ruler');
    await act(async () => store.getState().setLocked(true));
    expect(el('robot-tools')).toBeNull();
    expect(tools.getState().tool).toBeNull();
    await act(async () => store.getState().setLocked(false));
    expect(el('robot-tool-ruler')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('a replay of a check’s round turns the ruler or the move tool off and keeps every tool disabled until it is over', async () => {
    const { store, tools, publish, world, frames } = await setup();
    await click('robot-tool-ruler');
    await act(async () => tools.getState().pick({ xCm: 80, yCm: 40 }));
    await act(async () => store.getState().replay(project, { index: 0, count: 2, score: null }));
    expect(tools.getState()).toMatchObject({ tool: null, ruler: [] });
    expect(['robot-tool-teleop', 'robot-tool-ruler', 'robot-tool-move'].map((id) => el(id)!.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true']);
    await click('robot-tool-ruler');
    expect(tools.getState().tool).toBeNull();
    await act(async () => {
      publish({ world: world(3), end: { reason: 'time-limit', atS: 3 } });
      frames.frame(16);
    });
    expect(el('robot-tool-ruler')!.getAttribute('aria-disabled')).toBe('false');
  });
});

describe('driving by hand (N18 R4.8)', () => {
  it('drives with the keys on the view: the last key held drives, letting it go drives the one under it, then stops; Space stops', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp', repeat: true });
    await key(stage(), 'keydown', { key: 'a', code: 'KeyA' });
    await key(stage(), 'keyup', { key: 'a', code: 'KeyA' });
    await key(stage(), 'keyup', { key: 'ArrowUp', code: 'ArrowUp' });
    await key(stage(), 'keydown', { key: 's', code: 'KeyS' });
    await key(stage(), 'keydown', { key: ' ', code: 'Space' });
    expect(commands(session)).toEqual([
      forward,
      { op: 'move', direction: 'spinLeft', speed: 50 },
      forward,
      stop,
      { op: 'move', direction: 'backward', speed: 50 },
      stop,
    ]);
  });

  it('the speed slider sets the speed, and a direction held is sent again at the new one', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    await key(stage(), 'keydown', { key: 'd', code: 'KeyD' });
    const slider = el('robot-teleop-speed') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(slider, '80');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(commands(session)).toEqual([
      { op: 'move', direction: 'spinRight', speed: 50 },
      { op: 'move', direction: 'spinRight', speed: 80 },
    ]);
    expect(el('robot-teleop')!.querySelector('output')?.textContent).toBe('80 %');
  });

  it('the speed slider keeps the arrows that move it, and W A S D and Space drive from it; set with the pointer, it gives the view the focus back', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    const slider = el('robot-teleop-speed')!;
    slider.focus();
    await key(slider, 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(commands(session)).toEqual([]);
    await key(slider, 'keydown', { key: 'w', code: 'KeyW' });
    await key(slider, 'keydown', { key: ' ', code: 'Space' });
    expect(commands(session)).toEqual([forward, stop]);
    await act(async () => void slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 2 })));
    expect(document.activeElement).toBe(stage());
  });

  it('never takes a key from the block editor or the page outside the view', async () => {
    const { session } = await setup();
    await click('robot-tool-teleop');
    const blockly = document.createElement('div');
    blockly.className = 'injectionDiv';
    blockly.tabIndex = 0;
    document.body.append(blockly);
    await key(blockly, 'keydown', { key: 'w', code: 'KeyW' });
    await key(document.body, 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    await key(el('outside')!, 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(commands(session)).toEqual([]);
  });

  it('lets go of what is held when the focus leaves the view, when the window loses the focus, and when the pointer is taken away', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    // The focus goes to something outside the view.
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    await act(async () => void stage().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: el('outside') })));
    // Inside the view, the focus moving between its buttons lets go of nothing.
    await key(stage(), 'keydown', { key: 'a', code: 'KeyA' });
    await act(async () => void stage().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: el('robot-pad-stop') })));
    // The window loses the focus (another app, another tab).
    await act(async () => void window.dispatchEvent(new Event('blur')));
    // The pointer holding an arrow is taken away (a touch the browser turns into a scroll, a stylus out of range).
    await act(async () => void el('robot-pad-backward')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 5 })));
    await act(async () => void el('robot-pad-backward')!.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, button: 0, pointerId: 5 })));
    expect(commands(session)).toEqual([forward, stop, { op: 'move', direction: 'spinLeft', speed: 50 }, stop, { op: 'move', direction: 'backward', speed: 50 }, stop]);
    // Nothing is stuck: a key let go after all that sends nothing.
    await key(stage(), 'keyup', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(commands(session)).toHaveLength(6);
  });

  it('the D-pad drives while an arrow is held by the pointer or by Enter, and its middle stops', async () => {
    const { session } = await setup();
    await click('robot-tool-teleop');
    const pad = (direction: string) => el(`robot-pad-${direction}`)!;
    await act(async () => void pad('forward').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 3 })));
    expect(pad('forward').getAttribute('aria-pressed')).toBe('true');
    await act(async () => void pad('forward').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 3 })));
    await key(pad('spinLeft'), 'keydown', { key: 'Enter', code: 'Enter' });
    await key(pad('spinLeft'), 'keyup', { key: 'Enter', code: 'Enter' });
    // Space on an arrow holds that arrow (a button's key), it is not the view's stop.
    await key(pad('backward'), 'keydown', { key: ' ', code: 'Space' });
    await click('robot-pad-stop');
    expect(commands(session)).toEqual([forward, stop, { op: 'move', direction: 'spinLeft', speed: 50 }, stop, { op: 'move', direction: 'backward', speed: 50 }, stop]);
  });

  it('a Run (Chạy) turns teleop off: the D-pad goes, and the keys drive nothing', async () => {
    const { session, store, stage } = await setup();
    await click('robot-tool-teleop');
    await act(async () => store.getState().run(project));
    expect(el('robot-teleop')).toBeNull();
    expect(el('robot-tool-teleop')!.getAttribute('aria-pressed')).toBe('false');
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(commands(session)).toEqual([]);
  });
});

describe('the ruler and the move tool in the strip (N18 R4.8)', () => {
  it('reads the distance (vi decimal comma) and the angle to the robot’s heading on one row; the two points fold out; Esc on the view clears it', async () => {
    const { tools, stage } = await setup();
    await click('robot-tool-ruler');
    expect(el('robot-ruler')!.textContent).toBe('Bấm điểm thứ nhất trên sa bàn.');
    await act(async () => tools.getState().pick({ xCm: 25.4, yCm: 40.2 }));
    expect(el('robot-ruler')!.textContent).toBe('Bấm điểm thứ hai.');
    await act(async () => tools.getState().pick({ xCm: 55, yCm: 80 }));
    expect(el('robot-ruler-distance')!.textContent).toBe('50,0 cm');
    expect(el('robot-ruler-angle')!.textContent).toBe('53,1° sang trái');
    expect(el('robot-ruler-from')).toBeNull();
    expect(el('robot-ruler-points')!.getAttribute('aria-label')).toBe('Xem hai điểm');
    await click('robot-ruler-points');
    expect(el('robot-ruler-from')!.textContent).toBe('tâm robot (x 25,0 · y 40,0 cm)');
    expect(el('robot-ruler-to')!.textContent).toBe('x 55,0 · y 80,0 cm');
    expect(el('robot-ruler-points')!.getAttribute('aria-expanded')).toBe('true');
    expect(el('robot-ruler-clear')!.getAttribute('aria-label')).toBe('Xoá phép đo');
    await key(stage(), 'keydown', { key: 'Escape', code: 'Escape' });
    expect(tools.getState().ruler).toEqual([]);
  });

  it('says the angle in English, to the right', async () => {
    const { tools } = await setup({ locale: 'en' });
    await click('robot-tool-ruler');
    await act(async () => tools.getState().pick({ xCm: 80, yCm: 40 }));
    await act(async () => tools.getState().pick({ xCm: 110, yCm: 10 }));
    expect(el('robot-ruler-distance')!.textContent).toBe('42.4 cm');
    expect(el('robot-ruler-angle')!.textContent).toBe('45.0° to the right');
  });

  it('turns the robot with Q and E on the view, shows where it stands, and is disabled while a run goes on', async () => {
    const { session, store, stage } = await setup();
    await click('robot-tool-move');
    expect(el('robot-move-pose')!.textContent).toBe('x 25,0 · y 40,0 cm · 0°');
    await key(stage(), 'keydown', { key: 'q', code: 'KeyQ' });
    expect(session.placeRobot).toHaveBeenLastCalledWith({ xCm: 25, yCm: 40, yawDeg: 15 });
    expect(el('robot-move-pose')!.textContent).toBe('x 25,0 · y 40,0 cm · 15°');
    await key(stage(), 'keydown', { key: 'e', code: 'KeyE' });
    expect(session.placeRobot).toHaveBeenLastCalledWith({ xCm: 25, yCm: 40, yawDeg: 0 });
    await act(async () => store.getState().run(project));
    expect(el('robot-move')).toBeNull();
    expect(el('robot-tool-move')!.getAttribute('aria-disabled')).toBe('true');
    expect(el('robot-tool-move')!.title).toBe('Di chuyển robot: Dừng lượt chạy để di chuyển robot.');
  });

  it('moves the robot by the keyboard: the arrows nudge a ghost 1 cm (Shift: 5 cm), Enter places it, Esc drops a ghost first', async () => {
    const { session, stage, tools } = await setup();
    await click('robot-tool-move');
    await key(stage(), 'keydown', { key: 'ArrowRight', code: 'ArrowRight' });
    await key(stage(), 'keydown', { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true });
    expect(tools.getState().ghost).toEqual({ pose: { xCm: 26, yCm: 45, yawDeg: 0 }, clear: true });
    expect(el('robot-move-pose')!.textContent).toBe('x 26,0 · y 45,0 cm · 0°');
    await key(stage(), 'keydown', { key: 'Enter', code: 'Enter' });
    expect(session.placeRobot).toHaveBeenLastCalledWith({ xCm: 26, yCm: 45, yawDeg: 0 });
    // Enter on a button of the panel is the button's.
    await key(stage(), 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft' });
    await key(el('robot-move-left')!, 'keydown', { key: 'Enter', code: 'Enter' });
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
    await key(stage(), 'keydown', { key: 'Escape', code: 'Escape' });
    expect(tools.getState().ghost).toBeNull();
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
    // Into the wall: the ghost is red, the panel says so, and Enter places nothing.
    for (let i = 0; i < 8; i++) await key(stage(), 'keydown', { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true });
    expect(el('robot-move-status')!.textContent).toBe('Robot không đứng ở đó được.');
    await key(stage(), 'keydown', { key: 'Enter', code: 'Enter' });
    expect(session.placeRobot).toHaveBeenCalledTimes(1);
  });
});
