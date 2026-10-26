// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { TextProvider } from '../i18n/text';
import { ModuleCards } from './ModuleCards';
import { hubMap, idleHubValues, type HubValues, type ModuleView } from './pin-map';

// N19 E2: the cards of the gripper car in the hub panel, exact in Vietnamese: the gripper's claw (its angle, mở or đóng) and arm (its angle) on
// two dials, the IR sensor's pin level with "có vật" or "không", the colour sensor's swatch (with its colour-blind mark), colour name and raw
// R G B C, and which pins it is on (SDA A4 · SCL A5). Before a run they show the part with a dash; the rover's cards are as they were.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get(referenceKitRef) as Kit;
const map = hubMap(gripperKit, unoR3Board);

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

const show = (values: HubValues, locale: 'vi' | 'en' = 'vi', cardsOf = map) =>
  act(async () =>
    root.render(
      <TextProvider locale={locale}>
        <ModuleCards map={cardsOf} values={values} />
      </TextProvider>,
    ),
  );
const live = (modules: Record<string, ModuleView>): HubValues => ({ live: true, pins: {}, modules });
const text = (testId: string) => host.querySelector(`[data-testid=${testId}]`)?.textContent ?? null;
const attr = (testId: string, name: string) => host.querySelector(`[data-testid=${testId}]`)?.getAttribute(name) ?? null;

describe('the gripper’s card (N19 E2)', () => {
  it('shows the claw’s angle with mở or đóng and the arm’s angle, each on a dial', async () => {
    await show(live({ gripper: { kind: 'gripper', clawDeg: 27, liftDeg: 45 } }));
    expect(text('hub-card-gripper')).toContain('Tay gắp');
    expect(attr('hub-card-gripper', 'data-kind')).toBe('gripper');
    expect([text('hub-label-gripper-claw'), text('hub-value-gripper-claw'), text('hub-note-gripper-claw')]).toEqual(['Kẹp', '27°', 'đóng']);
    expect([text('hub-label-gripper-lift'), text('hub-value-gripper-lift'), text('hub-note-gripper-lift')]).toEqual(['Tay nâng', '45°', ' ']);
    expect(host.querySelectorAll('[data-testid=hub-card-gripper] svg.hub-dial')).toHaveLength(2);
    expect(host.querySelector('[data-testid=hub-card-gripper] .hub-card-port')!.textContent).toBe('GR1');
    await show(live({ gripper: { kind: 'gripper', clawDeg: 0, liftDeg: 90 } }));
    expect([text('hub-value-gripper-claw'), text('hub-note-gripper-claw'), text('hub-value-gripper-lift')]).toEqual(['0°', 'mở', '90°']);
  });

  it('is a dash and no state before a run', async () => {
    await show(idleHubValues);
    expect([text('hub-value-gripper-claw'), text('hub-note-gripper-claw'), text('hub-value-gripper-lift')]).toEqual(['—', ' ', '—']);
    expect(attr('hub-card-gripper', 'data-live')).toBe('false');
  });

  it('says it in English', async () => {
    await show(live({ gripper: { kind: 'gripper', clawDeg: 80, liftDeg: 0 } }), 'en');
    expect([text('hub-label-gripper-claw'), text('hub-value-gripper-claw'), text('hub-note-gripper-claw'), text('hub-label-gripper-lift'), text('hub-value-gripper-lift')]).toEqual(['Claw', '80°', 'closed', 'Lift arm', '0°']);
  });
});

describe('the IR sensor’s card (N19 E2)', () => {
  it('shows the pin level and “có vật” while it sees an object (the lamp lit), HIGH and “không” when it does not', async () => {
    await show(live({ irClaw: { kind: 'ir-obstacle', level: 'low', detected: true } }));
    expect(text('hub-card-irClaw')).toContain('Hồng ngoại ở càng');
    expect([text('hub-value-irClaw'), text('hub-note-irClaw'), attr('hub-lamp-irClaw', 'data-lit')]).toEqual(['LOW', 'có vật', 'true']);
    await show(live({ irClaw: { kind: 'ir-obstacle', level: 'high', detected: false } }));
    expect([text('hub-value-irClaw'), text('hub-note-irClaw'), attr('hub-lamp-irClaw', 'data-lit')]).toEqual(['HIGH', 'không', 'false']);
  });

  it('is a dash and an unlit lamp of no state before a run', async () => {
    await show(idleHubValues);
    expect([text('hub-value-irClaw'), text('hub-note-irClaw'), attr('hub-lamp-irClaw', 'data-lit')]).toEqual(['—', ' ', 'unknown']);
    expect(host.querySelector('[data-testid=hub-card-irClaw] .hub-card-port')!.textContent).toBe('IR1');
  });
});

describe('the colour sensor’s card (N19 E2)', () => {
  it('shows its colour name, a swatch of it, the raw R G B C and the pins it is on', async () => {
    await show(live({ color1: { kind: 'color-sensor', rgbc: { r: 8047, g: 1676, b: 1382, c: 9596 }, color: 'red' } }));
    expect(text('hub-card-color1')).toContain('Cảm biến màu');
    expect([text('hub-value-color1'), text('hub-raw-color1'), text('hub-wires-color1')]).toEqual(['đỏ', 'R 8047 G 1676 B 1382 C 9596', 'SDA A4 · SCL A5']);
    expect([attr('hub-swatch-color1', 'data-color'), attr('hub-swatch-color1', 'data-mark')]).toEqual(['red', 'stripes']);
    expect(host.querySelector('[data-testid=hub-swatch-color1] svg rect')!.getAttribute('fill')).toBe('#d32f2f');
    expect(host.querySelector('[data-testid=hub-card-color1] .hub-card-port')!.textContent).toBe('CS1');
  });

  it('draws green with its grid and blue with its dots, white and black plain, and “không rõ” with no fill', async () => {
    const looks: [ModuleView, string, string, string][] = [
      [{ kind: 'color-sensor', rgbc: { r: 1209, g: 4838, b: 1209, c: 7257 }, color: 'green' }, 'xanh lá', 'grid', '#388e3c'],
      [{ kind: 'color-sensor', rgbc: { r: 1008, g: 2016, b: 5040, c: 8064 }, color: 'blue' }, 'xanh dương', 'dots', '#1976d2'],
      [{ kind: 'color-sensor', rgbc: { r: 4435, g: 3830, b: 806, c: 9072 }, color: 'yellow' }, 'vàng', 'none', '#fbc02d'],
      [{ kind: 'color-sensor', rgbc: { r: 5000, g: 5000, b: 5000, c: 15000 }, color: 'white' }, 'trắng', 'none', '#ffffff'],
      [{ kind: 'color-sensor', rgbc: { r: 1000, g: 1000, b: 1000, c: 3000 }, color: 'black' }, 'đen', 'none', '#212121'],
      [{ kind: 'color-sensor', rgbc: { r: 0, g: 0, b: 0, c: 0 }, color: 'unknown' }, 'không rõ', 'none', 'none'],
    ];
    for (const [view, name, mark, fill] of looks) {
      await show(live({ color1: view }));
      expect([text('hub-value-color1'), attr('hub-swatch-color1', 'data-mark'), host.querySelector('[data-testid=hub-swatch-color1] svg rect')!.getAttribute('fill')]).toEqual([name, mark, fill]);
    }
  });

  it('says there is no reading yet when the run has none to show, and is a dash before a run; the pins it is on show either way', async () => {
    await show(live({ color1: { kind: 'color-sensor', rgbc: null, color: null } }));
    expect([text('hub-value-color1'), text('hub-raw-color1'), attr('hub-swatch-color1', 'data-color')]).toEqual(['—', 'chưa có số đọc', 'none']);
    await show(idleHubValues);
    expect([text('hub-value-color1'), text('hub-raw-color1'), text('hub-wires-color1')]).toEqual(['—', ' ', 'SDA A4 · SCL A5']);
  });

  it('says it in English', async () => {
    await show(live({ color1: { kind: 'color-sensor', rgbc: { r: 8047, g: 1676, b: 1382, c: 9596 }, color: 'red' } }), 'en');
    expect([text('hub-value-color1'), text('hub-raw-color1')]).toEqual(['red', 'R 8047 G 1676 B 1382 C 9596']);
  });
});

describe('the rover’s cards are as they were', () => {
  it('a rover has no gripper, IR or colour card', async () => {
    await show(idleHubValues, 'vi', hubMap(rover, unoR3Board));
    expect([...host.querySelectorAll('.hub-card')].map((card) => card.getAttribute('data-kind'))).toEqual(['dc-motor', 'dc-motor', 'ultrasonic', 'line-sensor', 'servo', 'led', 'buzzer', 'button']);
  });
});
