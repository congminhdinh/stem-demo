// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import pickPlace from '../../core/scenario/__fixtures__/pick-place.scenario.json';
import { loadScenario } from '../../core/scenario/scenario';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { HeldChip } from './HeldChip';
import { createRobotRunStore } from './robot-run-store';

// N19 E1: the HUD's chip "Đang giữ: khối đỏ", with a swatch of the object's colour and its colour-blind mark (red stripes, green grid, blue
// dots). It shows when the gripper holds an object and changes exactly when the held id does (the chip reads the id alone from the store,
// so the time moving renders nothing); its words are the check report's naming of the object in the round the view shows; it is no live
// region (the announcer says a grip once).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const naming = loadScenario(pickPlace);

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

async function setup(locale: 'vi' | 'en' = 'vi') {
  const fake = fakeSession(scenario, kit);
  const frames = fakeFrames();
  const store = createRobotRunStore(fake.session, { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame });
  store.getState().connect();
  const renders: number[] = [];
  await act(async () =>
    root.render(
      <TextProvider locale={locale}>
        <Profiler id="chip" onRender={() => void renders.push(renders.length)}>
          <HeldChip store={store} scenario={naming} />
        </Profiler>
      </TextProvider>,
    ),
  );
  /** The world at `t` s holding `heldId`, shown at a frame. */
  const show = async (t: number, heldId: string | null, gripper = true) => {
    const world = fake.world(t);
    await act(async () => {
      fake.publish({ status: 'running', world: gripper ? { ...world, robot: { ...world.robot, gripper: { clawDeg: 27, liftDeg: 60, heldId } } } : (world as RobotSnapshot) });
      frames.frame(t * 1000);
    });
  };
  return { ...fake, frames, store, renders, show };
}

const chip = () => host.querySelector<HTMLElement>('[data-testid=robot-held]');

describe('the chip of the held object (N19 E1)', () => {
  it('is there when the gripper holds an object, with its name as the check’s report says it, and gone when it lets go', async () => {
    const { show } = await setup();
    expect(chip()).toBeNull();
    await show(1, null);
    expect(chip()).toBeNull();
    await show(2, 'cube');
    expect(chip()!.textContent).toBe('Đang giữ: khối đỏ');
    await show(3, null);
    expect(chip()).toBeNull();
  });

  it('says it in English, and a base or a parcel as the report names it', async () => {
    const { show } = await setup('en');
    await show(1, 'cube');
    expect(chip()!.textContent).toBe('Holding: the red cube');
    await show(2, 'base');
    expect(chip()!.textContent).toBe('Holding: the yellow base');
    await show(3, 'parcel-2');
    expect(chip()!.textContent).toBe('Holding: parcel 2');
  });

  it('has a swatch in the object’s colour with its mark: red stripes, green a grid, blue dots, yellow and an uncoloured parcel none', async () => {
    const { show, store } = await setup();
    const look = () => {
      const swatch = chip()!.querySelector('svg')!;
      return [chip()!.dataset.color, chip()!.dataset.mark, swatch.querySelector('rect')!.getAttribute('fill'), swatch.getAttribute('aria-hidden'), swatch.querySelectorAll('[data-mark-part]').length > 0];
    };
    await show(1, 'cube');
    expect(look()).toEqual(['red', 'stripes', '#d32f2f', 'true', true]);
    // Round 2 and 3 of the scenario colour the cube green and blue.
    await act(async () => store.getState().setRound({ index: 1, count: 3, score: null }));
    expect(chip()!.textContent).toBe('Đang giữ: khối xanh lá');
    expect(look()).toEqual(['green', 'grid', '#388e3c', 'true', true]);
    await act(async () => store.getState().setRound({ index: 2, count: 3, score: null }));
    expect(chip()!.textContent).toBe('Đang giữ: khối xanh dương');
    expect(look()).toEqual(['blue', 'dots', '#1976d2', 'true', true]);
    await show(2, 'base');
    expect(look()).toEqual(['yellow', 'none', '#fbc02d', 'true', false]);
    await show(3, 'parcel-1');
    expect(chip()!.textContent).toBe('Đang giữ: kiện hàng 1');
    expect(chip()!.dataset.color).toBe('none');
    expect(chip()!.querySelector('svg rect')!.getAttribute('fill')).toBe('none');
  });

  it('changes exactly when the held id does: a run’s time moving renders nothing', async () => {
    const { show, renders } = await setup();
    const mounted = renders.length;
    for (const t of [1, 2, 3, 4, 5]) await show(t, null);
    expect(renders.length).toBe(mounted);
    await show(6, 'cube');
    expect(renders.length).toBe(mounted + 1);
    for (const t of [7, 8, 9]) await show(t, 'cube');
    expect(renders.length).toBe(mounted + 1);
    await show(10, 'base');
    expect(renders.length).toBe(mounted + 2);
    await show(11, null);
    expect(renders.length).toBe(mounted + 3);
  });

  it('is no live region: the announcer says a grip once, the chip only shows it', async () => {
    const { show } = await setup();
    await show(1, 'cube');
    const container = chip()!.closest('.robot-hud-row')!;
    expect(container.querySelector('[aria-live], [role=status], [role=alert], [role=log]')).toBeNull();
    expect(chip()!.hasAttribute('aria-live')).toBe(false);
    expect(chip()!.getAttribute('role')).toBeNull();
  });

  it('is not there for a robot with no gripper, or before a run', async () => {
    const { show } = await setup();
    await show(1, null, false);
    expect(chip()).toBeNull();
  });

  it('shows what a stopped run left, until Đặt lại: the object the robot got to hold', async () => {
    const { show, store } = await setup();
    await show(1, 'cube');
    await act(async () => store.getState().stop());
    // Dừng keeps the last world in view (the store's `held`), and the chip with it.
    expect(chip()?.textContent).toBe('Đang giữ: khối đỏ');
  });
});
