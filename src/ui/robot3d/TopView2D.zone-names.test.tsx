// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unoR3Board } from '../../core/hardware/catalog';
import { translate } from '../i18n/messages';
import { TextProvider } from '../i18n/text';
import { gripperKit, gripperTestScenario } from './__fixtures__/gripper-scene';
import { fakeSession } from './__fixtures__/fake-session';
import { installFakeCanvas2d } from './__fixtures__/fake-canvas-2d';
import type { FloorBox, PaintedZoneName } from './ground-paint';
import { createRobotRunStore } from './robot-run-store';
import { robotModel } from './robot-model';
import { TopView2D } from './TopView2D';
import { zoneLabelOf } from './zone-label';

// N19 E8 fix round 1 (review F3): on the 2D map a named zone's name keeps clear of the HUD, measured as over the 3D view (hud-corner.ts):
// its outer edge, else the other one, else its middle. The fixture's "Kho" (x 20–62, y 56–76 cm of a 120 × 90 arena) sits under the
// HUD's corner; its top is its outer edge.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vi_ = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('vi', key, params);

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  installFakeCanvas2d();
  host = document.createElement('div');
  host.className = 'robot-stage';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The map of the fixture (600 × 400 px: 3.84 px a cm, the arena's top left at 69.6, 14 px) under a HUD `hudWidth` × `hudHeight` px. */
function mount(hudWidth: number | null, hudHeight = 0) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'robot-hud') return new DOMRect(0, 0, hudWidth ?? 0, hudHeight);
    return new DOMRect(0, 0, 600, 400);
  });
  const fake = fakeSession(gripperTestScenario, gripperKit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  act(() =>
    root.render(
      <TextProvider locale="vi">
        {hudWidth !== null && <div data-testid="robot-hud" />}
        <TopView2D scenario={gripperTestScenario} kit={gripperKit} model={robotModel(gripperKit, unoR3Board)} store={store} zoneLabel={(zone) => zoneLabelOf(vi_, zone)} reason="no-webgl" />
      </TextProvider>,
    ),
  );
}

const mat = () => Konva.stages.find((candidate) => candidate.container().closest('[data-testid=robot-topview]') !== null)!.findOne<Konva.Group>('.topview-mat')!;
const kho = () => (mat().getAttr('zoneNames') as PaintedZoneName[]).find((name) => name.zoneId === 'kho')!;
const middleY = (box: FloorBox) => (box.minY + box.maxY) / 2;
const meets = (a: FloorBox, b: FloorBox) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

describe('a named zone’s name on the 2D map keeps clear of the HUD (N19 E8)', () => {
  it('by its outer edge with no HUD: Kho’s top (a 16 px font, 3 cm inside it)', () => {
    mount(null);
    // react-konva leaves a null attribute unset.
    expect(mat().getAttr('hudOnArena') ?? null).toBeNull();
    expect(middleY(kho().box)).toBeCloseTo(73, 5);
  });

  it('by its other edge when the HUD covers the outer one, and at its middle when it covers both', () => {
    // A HUD to 300 × 100 px with its 8 px gap: left of x 60 cm, above y 67.7 cm. Kho's top name (y 71–75) is under it, its bottom one
    // (57–61) is not.
    mount(292, 92);
    const hud = mat().getAttr('hudOnArena') as { maxX: number; minY: number };
    expect(hud).toEqual({ maxX: 60, minY: 67.5 });
    const covered: FloorBox = { minX: -Infinity, maxX: hud.maxX, minY: hud.minY, maxY: Infinity };
    expect(middleY(kho().box)).toBeCloseTo(59, 5);
    expect(meets(kho().box, covered)).toBe(false);
    act(() => root.unmount());
    vi.restoreAllMocks();
    installFakeCanvas2d();
    root = createRoot(host);
    // To 300 × 150 px: above y 54.7 cm, over both edges' names: the middle (66), as before E8.
    mount(292, 142);
    expect(middleY(kho().box)).toBeCloseTo(66, 5);
  });
});
