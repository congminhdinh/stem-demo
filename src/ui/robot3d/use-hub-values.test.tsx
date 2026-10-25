// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { hubMap, type HubValues } from './pin-map';
import { idleSnapshot } from './scene-math';
import { HUB_INTERVAL_MS, useHubValues, type WorldSource } from './use-hub-values';

// N18 R4.5: the hub panel's values follow the run's snapshots at most ten times a second, so that React stays cheap while the robot
// runs at the screen's rate, and always end on the latest snapshot.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
const map = hubMap(kit, unoR3Board);
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;

/** The world with the left motor at `speed` %. */
function worldAt(speed: number): RobotSnapshot {
  let us = 0;
  const uno = createVirtualUno(unoR3Board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  createModuleIO(kit, uno).call('motorLeft', 'motor.set', [speed]);
  return { ...idleSnapshot(scenario, kit), t: speed, status: 'running', pins: uno.pins() };
}

/** A source the test publishes to, as the run store is. */
function fakeSource(initial: RobotSnapshot | null = null) {
  let world = initial;
  const listeners = new Set<() => void>();
  const source: WorldSource = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => ({ latestWorld: () => world }),
  };
  return {
    source,
    listeners,
    publish(next: RobotSnapshot | null) {
      world = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

let host: HTMLElement;
let root: Root;
let renders: HubValues[];
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  renders = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Probe({ source, active }: { source: WorldSource; active: boolean }) {
  const values = useHubValues(source, map, active);
  renders.push(values);
  return <p data-testid="motor">{values.modules.motorLeft?.kind === 'dc-motor' ? values.modules.motorLeft.percent : 'none'}</p>;
}
const mount = (source: WorldSource, active = true) => act(() => root.render(<Probe source={source} active={active} />));
const shown = () => host.querySelector('[data-testid=motor]')?.textContent;

describe('useHubValues (N18 R4.5)', () => {
  it('reads the world it is mounted on, and the static mapping when there is none', () => {
    const { source } = fakeSource(worldAt(50));
    mount(source);
    expect(shown()).toBe('50');
    const idle = fakeSource(null);
    mount(idle.source);
    expect(shown()).toBe('none');
  });

  it('is at most ten renders a second while snapshots come at the frame rate, and ends on the latest one', () => {
    const { source, publish } = fakeSource(null);
    mount(source);
    const before = renders.length;
    // One second of 60 snapshots a second, a different speed on each.
    for (let frame = 1; frame <= 60; frame++) {
      act(() => {
        publish(worldAt(frame));
        vi.advanceTimersByTime(1000 / 60);
      });
    }
    const during = renders.length - before;
    expect(during).toBeGreaterThanOrEqual(8);
    expect(during).toBeLessThanOrEqual(11);
    // The last snapshot of the second is on the screen within one interval.
    act(() => vi.advanceTimersByTime(HUB_INTERVAL_MS));
    expect(shown()).toBe('60');
  });

  it('shows the first snapshot after a quiet time at once', () => {
    const { source, publish } = fakeSource(null);
    mount(source);
    act(() => vi.advanceTimersByTime(5000));
    act(() => publish(worldAt(40)));
    expect(shown()).toBe('40');
  });

  it('renders nothing for a snapshot that says the same: a resting robot’s clock is no change', () => {
    const first = worldAt(50);
    const { source, publish } = fakeSource(first);
    mount(source);
    const before = renders.length;
    for (let tick = 0; tick < 30; tick++) {
      act(() => {
        publish({ ...first, t: first.t + tick / 10 });
        vi.advanceTimersByTime(HUB_INTERVAL_MS);
      });
    }
    expect(renders.length).toBe(before);
  });

  it('follows nothing while its tab is not shown, and catches up the moment it is', () => {
    const { source, publish, listeners } = fakeSource(worldAt(10));
    mount(source, false);
    expect(listeners.size).toBe(0);
    act(() => publish(worldAt(70)));
    act(() => vi.advanceTimersByTime(1000));
    expect(shown()).toBe('10');
    mount(source, true);
    expect(shown()).toBe('70');
    expect(listeners.size).toBe(1);
    mount(source, false);
    expect(listeners.size).toBe(0);
  });

  it('goes back to the static mapping when the run is cleared', () => {
    const { source, publish } = fakeSource(worldAt(50));
    mount(source);
    act(() => publish(null));
    act(() => vi.advanceTimersByTime(HUB_INTERVAL_MS));
    expect(shown()).toBe('none');
  });

  it('stops listening, and leaves nothing pending, when it unmounts', () => {
    const { source, publish, listeners } = fakeSource(null);
    mount(source);
    act(() => publish(worldAt(20)));
    act(() => publish(worldAt(30)));
    act(() => root.unmount());
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});
