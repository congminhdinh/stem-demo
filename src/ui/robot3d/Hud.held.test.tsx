// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import pickPlace from '../../core/scenario/__fixtures__/pick-place.scenario.json';
import { loadScenario } from '../../core/scenario/scenario';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { Hud } from './Hud';
import { createRobotRunStore } from './robot-run-store';

// N19 E1: the held-object chip stands in the HUD, under the status row and the badges and over the score; the rover's HUD has none of it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
const roverScenario = scenarioCatalog.get('rb-drive-to-zone')!;
const pickScenario = loadScenario(pickPlace);

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
});

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

async function setup(scenario = pickScenario) {
  const fake = fakeSession(roverScenario, kit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  store.getState().connect();
  await act(async () =>
    root.render(
      <TextProvider locale="vi">
        <Hud store={store} scenario={scenario} />
      </TextProvider>,
    ),
  );
  const show = async (heldId: string | null | undefined) => {
    const world = fake.world(1);
    await act(async () => {
      fake.publish({ status: 'running', world: heldId === undefined ? world : { ...world, robot: { ...world.robot, gripper: { clawDeg: 27, liftDeg: 60, heldId } } } });
      frames.frame(16);
    });
  };
  return { show };
}

const rows = () => [...host.querySelectorAll('[data-testid=robot-hud] > *')].map((row) => (row as HTMLElement).querySelector('[data-testid]')?.getAttribute('data-testid') ?? row.className);

describe('the HUD’s held-object chip (N19 E1)', () => {
  it('stands in its own row after the status and before the score and goals', async () => {
    const { show } = await setup();
    await show(null);
    expect(rows()).toEqual(['robot-status', 'robot-score', 'robot-goals']);
    await show('cube');
    expect(rows()).toEqual(['robot-status', 'robot-held', 'robot-score', 'robot-goals']);
    expect(host.querySelector('[data-testid=robot-hud] [data-testid=robot-held]')!.textContent).toBe('Đang giữ: khối đỏ');
    await show(null);
    expect(rows()).toEqual(['robot-status', 'robot-score', 'robot-goals']);
  });

  it('a rover’s run has no chip and no row for it', async () => {
    const { show } = await setup(roverScenario);
    await show(undefined);
    expect(host.querySelector('[data-testid=robot-held]')).toBeNull();
    expect(rows()).toEqual(['robot-status', 'robot-score', 'robot-goals']);
  });
});
