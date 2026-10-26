// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// N19 E3: the gripper car's keys and buttons in teleop, in jsdom. Q E R F on the view and four buttons beside the D-pad (only for a kit with a
// gripper) send `{op:'gripper', part, deg}`; a held R or F repeats; nothing is taken from a field or the block editor, from Ctrl, Meta or Alt, or
// while teleop is off; the rover's pad is the one it was: no buttons, and Q E R F mean nothing there.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
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
  vi.useRealTimers();
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

async function setup(kit: Kit, options: { gripper?: boolean; locale?: 'vi' | 'en' } = {}) {
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
          <RobotTools store={store} tools={tools} scenario={scenario} drivable gripper={options.gripper ?? kit === gripperKit} stage={stage} />
        </div>
      </TextProvider>,
    ),
  );
  return { ...fake, frames, store, tools, stage: () => stage.current! };
}

const el = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(async () => el(testId)!.click());
const key = (target: Element, type: 'keydown' | 'keyup', init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })));
const pointer = (testId: string, type: 'pointerdown' | 'pointerup' | 'pointercancel') =>
  act(async () => void el(testId)!.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7 })));
const commands = (session: ReturnType<typeof fakeSession>['session']) => session.teleop.mock.calls.map(([command]) => command);
const claw = (deg: number) => ({ op: 'gripper', part: 'claw', deg }) as const;
const lift = (deg: number) => ({ op: 'gripper', part: 'lift', deg }) as const;

describe('the gripper’s keys (N19 E3)', () => {
  it('Q opens the claw, E closes it, R raises the arm, F lowers it 15°, matched by the key’s place', async () => {
    const { session, stage } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await key(stage(), 'keydown', { key: 'a', code: 'KeyQ' });
    await key(stage(), 'keydown', { key: 'e', code: 'KeyE' });
    await key(stage(), 'keydown', { key: 'r', code: 'KeyR' });
    await key(stage(), 'keydown', { key: 'f', code: 'KeyF' });
    await key(stage(), 'keydown', { key: 'f', code: 'KeyF' });
    // The arm starts up (90°): R stays at the top, F steps 75 then 60.
    expect(commands(session)).toEqual([claw(0), claw(80), lift(90), lift(75), lift(60)]);
  });

  it('a held R or F repeats its step, and the lift stops at 0° and 90°', async () => {
    const { session, stage } = await setup(gripperKit);
    await click('robot-tool-teleop');
    for (let repeat = 0; repeat < 8; repeat++) await key(stage(), 'keydown', { key: 'f', code: 'KeyF', repeat: repeat > 0 });
    for (let repeat = 0; repeat < 2; repeat++) await key(stage(), 'keydown', { key: 'r', code: 'KeyR', repeat: repeat > 0 });
    expect(commands(session)).toEqual([lift(75), lift(60), lift(45), lift(30), lift(15), lift(0), lift(0), lift(0), lift(15), lift(30)]);
  });

  it('keeps the camera’s and the drive’s keys: they drive and orbit as before, and take no gripper step', async () => {
    const { session, stage } = await setup(gripperKit);
    await click('robot-tool-teleop');
    for (const [name, code] of [['w', 'KeyW'], ['a', 'KeyA'], ['1', 'Digit1'], ['+', 'Equal'], ['0', 'Digit0']] as const) await key(stage(), 'keydown', { key: name, code });
    await key(stage(), 'keydown', { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true });
    expect(commands(session).map((command) => command.op)).toEqual(['move', 'move']);
  });

  it('takes nothing while teleop is off, from a field or the block editor, or with Ctrl, Meta or Alt (the browser’s)', async () => {
    const { session, stage } = await setup(gripperKit);
    await key(stage(), 'keydown', { key: 'q', code: 'KeyQ' });
    expect(commands(session)).toEqual([]);
    await click('robot-tool-teleop');
    const field = document.createElement('input');
    stage().append(field);
    const blockly = document.createElement('div');
    blockly.className = 'injectionDiv';
    blockly.tabIndex = 0;
    document.body.append(blockly);
    await key(field, 'keydown', { key: 'r', code: 'KeyR' });
    await key(blockly, 'keydown', { key: 'r', code: 'KeyR' });
    await key(stage(), 'keydown', { key: 'r', code: 'KeyR', ctrlKey: true });
    await key(stage(), 'keydown', { key: 'r', code: 'KeyR', metaKey: true });
    await key(stage(), 'keydown', { key: 'f', code: 'KeyF', altKey: true });
    expect(commands(session)).toEqual([]);
    // And once off again, nothing more.
    await click('robot-tool-teleop');
    await key(stage(), 'keydown', { key: 'e', code: 'KeyE' });
    expect(commands(session)).toEqual([]);
  });

  it('a new teleop world (Đặt lại robot) starts as setup() leaves the gripper, so the next F steps from 90°', async () => {
    const { session, stage, store, tools } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await key(stage(), 'keydown', { key: 'f', code: 'KeyF' });
    await key(stage(), 'keydown', { key: 'e', code: 'KeyE' });
    expect(tools.getState().gripper).toEqual({ clawDeg: 80, liftDeg: 75 });
    await act(async () => store.getState().resetRobot());
    expect(tools.getState().gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
    await key(stage(), 'keydown', { key: 'f', code: 'KeyF' });
    expect(commands(session).at(-1)).toEqual(lift(75));
  });

  it('the move tool keeps Q and E for turning the robot, and sends the gripper nothing', async () => {
    const { session, stage } = await setup(gripperKit);
    await click('robot-tool-move');
    await key(stage(), 'keydown', { key: 'q', code: 'KeyQ' });
    expect(session.placeRobot).toHaveBeenCalledWith({ xCm: 25, yCm: 40, yawDeg: 15 });
    expect(commands(session)).toEqual([]);
  });
});

describe('the gripper’s buttons (N19 E3)', () => {
  it('stand beside the D-pad for a kit with a gripper: the claw’s two, the arm’s two, each named and with its key', async () => {
    await setup(gripperKit);
    await click('robot-tool-teleop');
    const pad = el('robot-gripper-pad')!;
    expect([pad.getAttribute('role'), pad.getAttribute('aria-label')]).toEqual(['group', 'Tay gắp']);
    expect([...pad.querySelectorAll('button')].map((button) => [button.getAttribute('aria-label'), button.getAttribute('aria-keyshortcuts'), button.title, button.textContent])).toEqual([
      ['Mở kẹp', 'Q', 'Mở kẹp (Q)', ''],
      ['Đóng kẹp', 'E', 'Đóng kẹp (E)', ''],
      ['Nâng tay', 'R', 'Nâng tay (R)', ''],
      ['Hạ tay', 'F', 'Hạ tay (F)', ''],
    ]);
    // The D-pad itself is the rover's: its six buttons, in the same place.
    expect([...el('robot-teleop')!.querySelectorAll('.robot-pad button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Tiến', 'Quay trái', 'Quay phải', 'Lùi', 'Dừng', 'Thu gọn bàn lái']);
    expect(el('robot-tool-teleop')!.title).toContain('Phím: ↑ hoặc W tiến');
    expect(el('robot-tool-teleop')!.title).toContain('Tay gắp: Q mở kẹp, E đóng kẹp, R nâng tay, F hạ tay');
    expect(el('robot-teleop')!.title).toContain('Tay gắp: Q mở kẹp, E đóng kẹp, R nâng tay, F hạ tay');
  });

  it('a click sends the claw or the arm its command, as the key does (a keyboard activation, Enter or Space on the button)', async () => {
    const { session } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await click('robot-gripper-close');
    await click('robot-gripper-open');
    await click('robot-gripper-down');
    await click('robot-gripper-up');
    expect(commands(session)).toEqual([claw(80), claw(0), lift(75), lift(90)]);
  });

  it('holding the arm’s button with the pointer steps at once, then again after 0.4 s and every 0.1 s until it is let go or taken away', async () => {
    vi.useFakeTimers();
    const { session } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await pointer('robot-gripper-down', 'pointerdown');
    expect(commands(session)).toEqual([lift(75)]);
    await act(async () => void vi.advanceTimersByTime(399));
    expect(commands(session)).toEqual([lift(75)]);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(commands(session)).toEqual([lift(75), lift(60)]);
    await act(async () => void vi.advanceTimersByTime(200));
    expect(commands(session)).toEqual([lift(75), lift(60), lift(45), lift(30)]);
    await pointer('robot-gripper-down', 'pointerup');
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(commands(session)).toHaveLength(4);
    // The pointer's click after the press is no second step (a pointer click has a detail; a keyboard's has none).
    await act(async () => void el('robot-gripper-down')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    expect(commands(session)).toHaveLength(4);
    // A pointer taken away (a touch turned into a scroll) lets go as well.
    await pointer('robot-gripper-up', 'pointerdown');
    await pointer('robot-gripper-up', 'pointercancel');
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(commands(session)).toEqual([lift(75), lift(60), lift(45), lift(30), lift(45)]);
  });

  it('a claw button acts once however long it is held', async () => {
    vi.useFakeTimers();
    const { session } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await pointer('robot-gripper-close', 'pointerdown');
    await act(async () => void vi.advanceTimersByTime(2000));
    await pointer('robot-gripper-close', 'pointerup');
    expect(commands(session)).toEqual([claw(80)]);
  });

  it('go quiet when the run is over (a crash or its cap) until Đặt lại robot, and fold away with the D-pad', async () => {
    const { session, publish, world, frames } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await click('robot-teleop-fold');
    expect(el('robot-gripper-pad')).toBeNull();
    await click('robot-teleop-fold');
    await act(async () => {
      publish({ status: 'finished', world: world(3, 60, { status: 'finished' }), end: { reason: 'contact', atS: 3, tag: 'wall' } });
      frames.frame(16);
    });
    expect(['robot-gripper-open', 'robot-gripper-close', 'robot-gripper-up', 'robot-gripper-down'].map((id) => el(id)!.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true', 'true']);
    await pointer('robot-gripper-down', 'pointerdown');
    expect(commands(session)).toEqual([]);
  });

  it('are not there for the rover: its pad is as it was, and Q E R F do nothing in teleop', async () => {
    const { session, stage } = await setup(rover);
    await click('robot-tool-teleop');
    expect(el('robot-gripper-pad')).toBeNull();
    expect(el('robot-teleop')!.querySelector('.robot-pad-row')).toBeNull();
    expect(el('robot-teleop')!.firstElementChild!.className).toBe('robot-pad');
    expect(el('robot-tool-teleop')!.title).not.toContain('Tay gắp');
    expect(el('robot-teleop')!.title).toBe('Phím: ↑ hoặc W tiến, ↓ hoặc S lùi, ← hoặc A quay trái, → hoặc D quay phải, phím cách dừng');
    for (const code of ['KeyQ', 'KeyE', 'KeyR', 'KeyF']) await key(stage(), 'keydown', { key: code.slice(3).toLowerCase(), code });
    expect(commands(session)).toEqual([]);
  });

  it('say their names in English', async () => {
    await setup(gripperKit, { locale: 'en' });
    await click('robot-tool-teleop');
    expect([...el('robot-gripper-pad')!.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Open the claw', 'Close the claw', 'Raise the arm', 'Lower the arm']);
    expect(el('robot-gripper-pad')!.getAttribute('aria-label')).toBe('Gripper');
  });

  it('a Run turns teleop off and the buttons go with the pad', async () => {
    const { session, store } = await setup(gripperKit);
    await click('robot-tool-teleop');
    await act(async () => store.getState().run(project));
    expect(el('robot-gripper-pad')).toBeNull();
    expect(commands(session)).toEqual([]);
  });
});
