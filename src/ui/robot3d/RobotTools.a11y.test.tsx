// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { createRobotRunStore } from './robot-run-store';
import { createRobotToolsStore } from './robot-tools-store';
import { RobotTools } from './RobotTools';
import { idleSnapshot } from './scene-math';

// N18 R8: the view tools' panels are no live regions; what they used to say as they changed is said once to the lab's announcer when it
// happens (the ruler's reading, the ghost where the robot cannot stand, where it was placed, a teleop run that is over), Esc ends teleop
// when no tool is on, and Shift with an arrow is the camera's, not teleop's.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;

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

async function setup(locale: 'vi' | 'en' = 'vi') {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { requestFrame: () => 1, cancelFrame: () => {}, startView: (pose) => idleSnapshot({ ...scenario, start: pose }, kit) });
  store.getState().connect();
  const tools = createRobotToolsStore({ runStore: store, scenario, kit });
  const stage = createRef<HTMLDivElement>();
  const announce = vi.fn();
  await act(async () =>
    root.render(
      <TextProvider locale={locale}>
        <div className="robot-stage" tabIndex={-1} ref={stage} data-testid="stage">
          <RobotTools store={store} tools={tools} scenario={scenario} drivable stage={stage} announce={announce} />
        </div>
      </TextProvider>,
    ),
  );
  return { ...fake, store, tools, announce, stage: () => stage.current! };
}

const el = (testId: string) => host.querySelector<HTMLElement>(`[data-testid=${testId}]`);
const click = (testId: string) => act(async () => el(testId)!.click());
const key = (target: Element, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

describe('the tools tell the announcer (N18 R8)', () => {
  it('says the ruler’s reading once, when the second point is picked, and not again as the robot’s heading changes under it', async () => {
    const { tools, announce, publish, world } = await setup();
    await click('robot-tool-ruler');
    await act(async () => tools.getState().pick({ xCm: 25.4, yCm: 40.2 }));
    expect(announce).not.toHaveBeenCalled();
    await act(async () => tools.getState().pick({ xCm: 55, yCm: 80 }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Đã đo 50,0 cm, 53,1° sang trái.');
    // The robot turns while the ruler stays: the angle on screen follows, nothing is said.
    await act(async () => publish({ status: 'running', world: world(1, 25, { robot: { ...world(1).robot, yawDeg: 40 } }) }));
    expect(announce).toHaveBeenCalledTimes(1);
    // A new measurement is said.
    await act(async () => tools.getState().pick({ xCm: 80, yCm: 40 }));
    await act(async () => tools.getState().pick({ xCm: 110, yCm: 10 }));
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('says it in English with its point', async () => {
    const { tools, announce } = await setup('en');
    await click('robot-tool-ruler');
    await act(async () => tools.getState().pick({ xCm: 80, yCm: 40 }));
    await act(async () => tools.getState().pick({ xCm: 110, yCm: 10 }));
    expect(announce).toHaveBeenCalledWith('Measured 42.4 cm, 45.0° to the right.');
  });

  it('says that the robot cannot stand where the ghost is, and where the robot was placed or sent back', async () => {
    const { announce, stage, tools, session } = await setup();
    await click('robot-tool-move');
    expect(announce).not.toHaveBeenCalled();
    await key(stage(), { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    await key(stage(), { key: 'Enter', code: 'Enter' });
    expect(session.placeRobot).toHaveBeenLastCalledWith({ xCm: 30, yCm: 40, yawDeg: 0 });
    expect(announce).toHaveBeenLastCalledWith('Đã đặt robot: x 30,0 · y 40,0 cm · 0°.');
    for (let i = 0; i < 12; i++) await key(stage(), { key: 'ArrowDown', code: 'ArrowDown', shiftKey: true });
    expect(announce).toHaveBeenLastCalledWith('Robot không đứng ở đó được.');
    const blocked = announce.mock.calls.filter(([words]) => words === 'Robot không đứng ở đó được.').length;
    expect(blocked).toBe(1);
    await key(stage(), { key: 'Escape', code: 'Escape' });
    await act(async () => void tools.getState().toStart());
    expect(announce).toHaveBeenLastCalledWith('Robot đã về chỗ xuất phát của bài.');
  });

  it('says that a teleop run is over, once', async () => {
    const { announce, store } = await setup();
    await click('robot-tool-teleop');
    expect(announce).not.toHaveBeenCalled();
    const over = { ...store.getState().snapshot, status: 'finished' as const, end: { reason: 'time-limit' as const, atS: 600 } };
    await act(async () => store.setState({ snapshot: over }));
    expect(el('robot-teleop-over')?.textContent).toBe('Lượt đã kết thúc. Bấm Đặt lại robot để lái tiếp.');
    expect(announce.mock.calls).toEqual([['Lượt đã kết thúc. Bấm Đặt lại robot để lái tiếp.']]);
    // Still over a moment later: not said again.
    await act(async () => store.setState({ snapshot: { ...over } }));
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('has no live role on any note of its panels', async () => {
    await setup();
    await click('robot-tool-teleop');
    await click('robot-tool-ruler');
    expect(host.querySelectorAll('[aria-live], [role=status], [role=alert]')).toHaveLength(0);
  });
});

describe('the keys of the view (N18 R8)', () => {
  it('Escape ends teleop when no tool is on, and leaves a tool’s own Escape to the tool', async () => {
    const { store, stage, session } = await setup();
    await click('robot-tool-teleop');
    expect(store.getState().teleop).toBe(true);
    await key(stage(), { key: 'Escape', code: 'Escape' });
    expect(store.getState().teleop).toBe(false);
    expect(session.stop).toHaveBeenCalled();
    // With the ruler on, Escape clears the ruler (and a second one, with teleop on, ends it).
    await click('robot-tool-ruler');
    await click('robot-tool-teleop');
    await key(stage(), { key: 'Escape', code: 'Escape' });
    expect(store.getState().teleop).toBe(true);
  });

  it('does not drive for Shift with an arrow (the camera orbits), and drives for a plain one', async () => {
    const { session, stage } = await setup();
    await click('robot-tool-teleop');
    session.teleop.mockClear();
    await key(stage(), { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true });
    await key(stage(), { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true });
    expect(session.teleop).not.toHaveBeenCalled();
    await key(stage(), { key: 'ArrowUp', code: 'ArrowUp' });
    expect(session.teleop).toHaveBeenCalledWith({ op: 'move', direction: 'forward', speed: 50 });
    // W with Shift (a capital letter) still drives.
    session.teleop.mockClear();
    await key(stage(), { key: 'S', code: 'KeyS', shiftKey: true });
    expect(session.teleop).toHaveBeenCalledWith({ op: 'move', direction: 'backward', speed: 50 });
  });
});
