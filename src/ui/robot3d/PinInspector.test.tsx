// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno, type PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { TextProvider } from '../i18n/text';
import { fakeSession } from './__fixtures__/fake-session';
import { PinInspector } from './PinInspector';
import { createRobotRunStore } from './robot-run-store';
import { idleSnapshot } from './scene-math';

// N18 R4.5: the hub panel, rendered in jsdom on a run store the test publishes to: the board, the cards and the table agree, show the
// plan's example for motor.set(motorLeft, 50), and show nothing but the mapping before a run.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = productionKits.get(referenceKitRef) as Kit;
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

/** The kit's world after `calls`, with what a test adds. */
function worldAfter(calls: (modules: ReturnType<typeof createModuleIO>) => void, changes: (pins: readonly PinState[], base: RobotSnapshot) => Partial<RobotSnapshot> = () => ({})): RobotSnapshot {
  let us = 0;
  const uno = createVirtualUno(unoR3Board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  const modules = createModuleIO(kit, uno);
  calls(modules);
  const base = { ...idleSnapshot(scenario, kit), t: 1, status: 'running' as const, pins: uno.pins() };
  return { ...base, ...changes(base.pins, base) };
}

function setup(locale: 'vi' | 'en' = 'vi', active = true) {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session, { requestFrame: (callback) => setTimeout(() => callback(0), 0) as unknown as number, cancelFrame: (handle) => clearTimeout(handle) });
  const stop = store.getState().connect();
  const render = (isActive = active) =>
    act(() =>
      root.render(
        <TextProvider locale={locale}>
          <PinInspector store={store} kit={kit} board={unoR3Board} active={isActive} />
        </TextProvider>,
      ),
    );
  return { ...fake, store, render, stop };
}

describe('PinInspector (N18 R4.5)', () => {
  it('before a run shows the kit’s wiring and no values: the pads unlit, the cards with a dash, the table with ports and pins only', async () => {
    const { render } = setup();
    await render();
    expect(attr('pin-inspector', 'data-live')).toBe('false');
    expect(host.querySelector('[data-testid=hub-idle]')?.hasAttribute('hidden')).toBe(false);
    expect(text('hub-idle')).toBe('Hãy chạy chương trình để xem giá trị trực tiếp. Trước đó, đây là cách nối các bộ phận.');
    expect(attr('hub-pad-D5', 'data-state')).toBe('idle');
    expect(text('hub-part-D5')).toBe('Motor trái EN');
    expect(text('hub-value-motorLeft')).toBe('—');
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.textContent).toBe('Motor trái' + 'M1' + 'D5END7IN1D8IN2');
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.getAttribute('title')).toBe('Motor trái → M1 → D5, D7, D8');
  });

  it('draws the board without a wordmark: only the pin names, and the parts on them with the signal of a part that has several pins', async () => {
    const { render } = setup();
    await render();
    const labels = [...host.querySelectorAll('[data-testid=hub-board] text')].map((element) => element.textContent ?? '');
    const pins = [...Array.from({ length: 14 }, (_, index) => `D${index}`), ...Array.from({ length: 6 }, (_, index) => `A${index}`)];
    const parts = [
      'Motor trái EN', 'Motor trái IN1', 'Motor trái IN2', 'Motor phải EN', 'Motor phải IN1', 'Motor phải IN2', 'Siêu âm TRIG', 'Siêu âm ECHO',
      'Line trái', 'Line giữa', 'Line phải', 'Servo', 'Đèn LED', 'Còi', 'Nút bấm',
    ];
    expect(labels.filter((label) => !pins.includes(label) && !parts.includes(label))).toEqual([]);
    expect(labels.filter((label) => pins.includes(label)).sort()).toEqual([...pins].sort());
    // The pins of the kit carry the name of their part, each of a motor's three its own signal; the others carry none.
    expect(labels.filter((label) => parts.includes(label)).sort()).toEqual([...parts].sort());
    expect(host.querySelectorAll('[data-testid=hub-board] .hub-pad-part')).toHaveLength(15);
    expect(host.querySelector('[data-testid=hub-pad-D0] .hub-pad-part')).toBeNull();
    expect(['D5', 'D7', 'D8', 'D11', 'D12', 'A1'].map((pin) => text(`hub-part-${pin}`))).toEqual(['Motor trái EN', 'Motor trái IN1', 'Motor trái IN2', 'Siêu âm ECHO', 'Siêu âm TRIG', 'Line giữa']);
    // The signal is a span of its own, so that it can be set lighter than the name.
    expect(host.querySelector('[data-testid=hub-part-D5] .hub-pad-signal')?.textContent).toBe('EN');
    expect(host.querySelector('[data-testid=hub-part-A1] .hub-pad-signal')).toBeNull();
  });

  it('motor.set(motorLeft, 50): the table says Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW, and the card and the board agree', async () => {
    const { render, publish } = setup();
    await render();
    act(() => publish({ status: 'running', world: worldAfter((modules) => modules.call('motorLeft', 'motor.set', [50])) }));
    await frame();
    expect(attr('pin-inspector', 'data-live')).toBe('true');
    expect(host.querySelector('[data-testid=hub-idle]')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.getAttribute('title')).toBe('Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW');
    expect(text('hub-row-value-motorLeft')).toBe('50 %');
    expect(text('hub-chip-D5')).toBe('D5ENPWM 128');
    expect(text('hub-chip-D7')).toBe('D7IN1HIGH');
    expect(text('hub-chip-D8')).toBe('D8IN2LOW');
    // The card: the dial's percent and the direction.
    expect(text('hub-value-motorLeft')).toBe('50 %');
    expect(text('hub-direction-motorLeft')).toBe('tiến');
    expect(text('hub-value-motorRight')).toBe('0 %');
    expect(text('hub-direction-motorRight')).toBe('dừng');
    // The board: D5 is lit by its duty, D7 fully, D8 not at all.
    expect(attr('hub-pad-D5', 'data-state')).toBe('pwm');
    expect(host.querySelector<SVGCircleElement>('[data-testid=hub-pad-D5] .hub-pad-lit')?.style.fillOpacity).toBe('0.63');
    expect(attr('hub-pad-D7', 'data-state')).toBe('high');
    expect(host.querySelector<SVGCircleElement>('[data-testid=hub-pad-D7] .hub-pad-lit')?.style.fillOpacity).toBe('1');
    expect(attr('hub-pad-D8', 'data-state')).toBe('low');
    expect(host.querySelector<SVGCircleElement>('[data-testid=hub-pad-D8] .hub-pad-lit')?.style.fillOpacity).toBe('0');
    expect(host.querySelector('[data-testid=hub-pad-D5] title')?.textContent).toBe('Chân D5: PWM 128 (Motor trái, chân EN của cổng M1)');
  });

  it('says it in English when the lab is read in English', async () => {
    const { render, publish } = setup('en');
    await render();
    act(() => publish({ status: 'running', world: worldAfter((modules) => modules.call('motorLeft', 'motor.set', [-30])) }));
    await frame();
    expect(host.querySelector('[data-testid=hub-row-motorLeft]')?.getAttribute('title')).toBe('Left motor -30 % → M1 → D5 PWM 77, D7 LOW, D8 HIGH');
    expect(text('hub-direction-motorLeft')).toBe('backward');
    expect(text('hub-idle')).toContain('Run the program');
  });

  it('shows the sensors, the servo, the LED, the buzzer and the button of a run', async () => {
    const { render, publish } = setup();
    await render();
    const world = worldAfter(
      () => {},
      (pins, base) => ({
        sensors: [
          { role: 'ultrasonic', kind: 'ultrasonic', cm: 23.4, hitId: 'wall' },
          { role: 'lineLeft', kind: 'line-sensor', reflectance: 0.05, dark: true, spotCm: [1, 1] },
          { role: 'lineCenter', kind: 'line-sensor', reflectance: 0.9, dark: false, spotCm: [1, 1] },
          { role: 'lineRight', kind: 'line-sensor', reflectance: 0.05, dark: true, spotCm: [1, 1] },
        ],
        robot: { ...base.robot, servoDeg: { servo1: 45 } },
        leds: { led1: true },
        pins: pins.map((pin) => (pin.pin === 'D10' ? { ...pin, toneHz: 440 } : pin.pin === 'D3' ? { ...pin, level: 0 as const } : pin)),
      }),
    );
    act(() => publish({ status: 'running', world }));
    await frame();
    expect(text('hub-value-ultrasonic')).toBe('23,4 cm');
    expect(text('hub-note-ultrasonic')?.trim()).toBe('');
    expect(['lineLeft', 'lineCenter', 'lineRight'].map((role) => attr(`hub-eye-${role}`, 'data-dark'))).toEqual(['true', 'false', 'true']);
    expect(text('hub-eye-lineLeft')).toBe('Line tráitối');
    expect(text('hub-value-servo1')).toBe('45°');
    expect(text('hub-value-led1')).toBe('bật');
    expect(attr('hub-card-led1', 'data-kind')).toBe('led');
    expect(host.querySelector('[data-testid=hub-card-led1] .hub-lamp')?.getAttribute('data-lit')).toBe('true');
    expect(text('hub-value-buzzer')).toBe('440 Hz');
    expect(text('hub-value-button1')).toBe('đang nhấn');
    expect(host.querySelector('[data-testid=hub-row-buzzer]')?.getAttribute('title')).toBe('Còi 440 Hz → BZ1 → D10 âm 440 Hz');
    expect(attr('hub-pad-D10', 'data-state')).toBe('tone');
    expect(attr('hub-pad-D9', 'data-state')).toBe('servo');
    // An input is marked as one on the board and in the table.
    expect(attr('hub-pad-D3', 'data-input')).toBe('true');
    expect(attr('hub-chip-D3', 'data-input')).toBe('true');
    expect(attr('hub-pad-D13', 'data-input')).toBe('false');
  });

  it('says when the ultrasonic hears nothing', async () => {
    const { render, publish } = setup();
    await render();
    const world = worldAfter(
      () => {},
      (_pins, base) => ({ sensors: [{ role: 'ultrasonic', kind: 'ultrasonic', cm: 400, hitId: null }, ...base.sensors] }),
    );
    act(() => publish({ status: 'running', world }));
    await frame();
    expect(text('hub-value-ultrasonic')).toBe('400 cm');
    expect(text('hub-note-ultrasonic')).toBe('không thấy vật');
  });

  it('goes back to the static mapping when the run is reset', async () => {
    const { render, publish, store } = setup();
    await render();
    act(() => publish({ status: 'running', world: worldAfter((modules) => modules.call('motorLeft', 'motor.set', [50])) }));
    await frame();
    expect(text('hub-value-motorLeft')).toBe('50 %');
    act(() => store.getState().stop());
    await frame();
    // Dừng keeps the last frame, as the 3D view does.
    expect(text('hub-value-motorLeft')).toBe('50 %');
    await act(async () => store.getState().resetRobot());
    await frame();
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(text('hub-value-motorLeft')).toBe('—');
    expect(attr('pin-inspector', 'data-live')).toBe('false');
  });

  it('does not follow the run while its tab is not shown, and shows the latest when it is', async () => {
    const { render, publish } = setup('vi', false);
    await render(false);
    act(() => publish({ status: 'running', world: worldAfter((modules) => modules.call('motorLeft', 'motor.set', [70])) }));
    await frame();
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
    expect(text('hub-value-motorLeft')).toBe('—');
    await render(true);
    expect(text('hub-value-motorLeft')).toBe('70 %');
  });
});
