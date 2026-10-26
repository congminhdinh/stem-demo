// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { PinInspector } from './PinInspector';
import { createRobotRunStore } from './robot-run-store';
import { idleSnapshot } from './scene-math';

// N19 E2: the hub panel of the gripper car in jsdom, on a run store the test publishes to: before a run its wiring (the gripper on D9 and D10,
// the IR on A3, the colour sensor on A4 and A5 as SDA and SCL), then the live rows of the gripper, the IR sensor and the colour sensor, with the
// board, the cards and the table agreeing.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
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
});

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const attr = (testId: string, name: string) => host.querySelector(`[data-testid=${testId}]`)?.getAttribute(name) ?? null;

/** The gripper car's world after setup() and a claw at 80°, the arm at 15°, an object seen on A3, the sensors’ entries as B3/B4 will give them. */
function world(): RobotSnapshot {
  let us = 0;
  const uno = createVirtualUno(unoR3Board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  const modules = createModuleIO(kit, uno);
  modules.call('gripper', 'gripper.claw', [80]);
  modules.call('gripper', 'gripper.lift', [15]);
  const pins = uno.pins().map((pin) => (pin.pin === 'A3' ? { ...pin, level: 0 as const } : pin.pin === 'A4' || pin.pin === 'A5' ? { ...pin, mode: 'INPUT_PULLUP' as const, level: 1 as const } : pin));
  const base = idleSnapshot(scenario, kit);
  return {
    ...base,
    t: 1,
    status: 'running',
    pins,
    robot: { ...base.robot, gripper: { clawDeg: 26.97, liftDeg: 15, heldId: 'cube' } },
    sensors: [
      { role: 'ultrasonic', kind: 'ultrasonic', cm: 3.8, hitId: 'cube' },
      ...['lineLeft', 'lineCenter', 'lineRight'].map((role) => ({ role, kind: 'line-sensor' as const, reflectance: 0.9, dark: false, spotCm: [1, 1] as const })),
      { role: 'irClaw', kind: 'ir-obstacle', detected: true, hitId: 'cube' },
      { role: 'color1', kind: 'color-sensor', hitId: 'cube', distanceCm: 1, rgbc: { c: 9596, r: 8047, g: 1676, b: 1382 } },
    ] as unknown as RobotSnapshot['sensors'],
  };
}

function setup(locale: 'vi' | 'en' = 'vi') {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { requestFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number, cancelFrame: (handle) => clearTimeout(handle) });
  store.getState().connect();
  const render = () =>
    act(() =>
      root.render(
        <TextProvider locale={locale}>
          <PinInspector store={store} kit={kit} board={unoR3Board} active />
        </TextProvider>,
      ),
    );
  return { ...fake, render };
}

describe('PinInspector of the gripper car (N19 E2)', () => {
  it('before a run shows the wiring: Tay gắp on D9 and D10, the IR on A3, the colour sensor on A4 as SDA and A5 as SCL', async () => {
    const { render } = setup();
    await render();
    expect([text('hub-part-D9'), text('hub-part-D10'), text('hub-part-A3'), text('hub-part-A4'), text('hub-part-A5')]).toEqual(['Tay gắp CLAW', 'Tay gắp LIFT', 'Hồng ngoại ở càng', 'Cảm biến màu SDA', 'Cảm biến màu SCL']);
    expect(host.querySelector('[data-testid=hub-row-gripper]')!.getAttribute('title')).toBe('Tay gắp → GR1 → D9, D10');
    expect(host.querySelector('[data-testid=hub-row-irClaw]')!.getAttribute('title')).toBe('Hồng ngoại ở càng → IR1 → A3');
    expect(host.querySelector('[data-testid=hub-row-color1]')!.getAttribute('title')).toBe('Cảm biến màu → CS1 → A4, A5');
    expect([text('hub-chip-A4'), text('hub-chip-A5')]).toEqual(['A4SDA', 'A5SCL']);
    expect([text('hub-value-gripper-claw'), text('hub-value-irClaw'), text('hub-value-color1'), text('hub-wires-color1')]).toEqual(['—', '—', '—', 'SDA A4 · SCL A5']);
  });

  it('live: the gripper’s angles and state, the IR’s pin and object, the colour’s counts and name, in the cards, the table and the board', async () => {
    const { render, publish } = setup();
    await render();
    act(() => publish({ status: 'running', world: world() }));
    await frame();
    expect(attr('pin-inspector', 'data-live')).toBe('true');
    // Cards.
    expect([text('hub-value-gripper-claw'), text('hub-note-gripper-claw'), text('hub-value-gripper-lift')]).toEqual(['27°', 'đóng', '15°']);
    expect([text('hub-value-irClaw'), text('hub-note-irClaw')]).toEqual(['LOW', 'có vật']);
    expect([text('hub-value-color1'), text('hub-raw-color1')]).toEqual(['đỏ', 'R 8047 G 1676 B 1382 C 9596']);
    // Table.
    expect(host.querySelector('[data-testid=hub-row-gripper]')!.getAttribute('title')).toBe('Tay gắp kẹp 27° đóng · tay 15° → GR1 → D9 servo 80°, D10 servo 15°');
    expect(host.querySelector('[data-testid=hub-row-irClaw]')!.getAttribute('title')).toBe('Hồng ngoại ở càng LOW · có vật → IR1 → A3 LOW');
    expect(host.querySelector('[data-testid=hub-row-color1]')!.getAttribute('title')).toBe('Cảm biến màu R 8047 G 1676 B 1382 C 9596 · đỏ → CS1 → A4 HIGH, A5 HIGH');
    expect([text('hub-chip-D9'), text('hub-chip-D10'), text('hub-chip-A3')]).toEqual(['D9CLAWservo 80°', 'D10LIFTservo 15°', 'A3PINLOW']);
    // Board.
    expect([attr('hub-pad-D9', 'data-state'), attr('hub-pad-D10', 'data-state'), attr('hub-pad-A3', 'data-state'), attr('hub-pad-A4', 'data-state'), attr('hub-pad-A5', 'data-state')]).toEqual(['servo', 'servo', 'low', 'high', 'high']);
  });

  it('speaks English too', async () => {
    const { render, publish } = setup('en');
    await render();
    act(() => publish({ status: 'running', world: world() }));
    await frame();
    expect([text('hub-note-gripper-claw'), text('hub-note-irClaw'), text('hub-value-color1')]).toEqual(['closed', 'object', 'red']);
    expect(host.querySelector('[data-testid=hub-row-gripper]')!.getAttribute('title')).toBe('Gripper claw 27° closed · arm 15° → GR1 → D9 servo 80°, D10 servo 15°');
  });
});
