import { expect, test } from '@playwright/test';
import { openProject, samples } from './helpers';

test('renders the led-on sample on the canvas from the document', async ({ page }) => {
  await openProject(page, samples.ledOn);

  await expect(page.getByTestId('circuit-canvas').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('program-region')).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.__stem?.getCanvasState()?.components.length ?? 0))
    .toBe(2);
  const state = await page.evaluate(() => window.__stem?.getCanvasState());
  if (!state) {
    throw new Error('Canvas state is not available');
  }

  expect(state.components.map((component) => component.deviceType).sort()).toEqual(['board', 'led']);
  expect(state.wires.map((wire) => wire.id).sort()).toEqual(['wire-cathode-gnd', 'wire-d13-anode']);

  // Port markers sit where core geometry puts them (board at 200,220; LED at 420,160).
  expect(state.ports).toContainEqual({ componentId: 'board', portId: 'd13', x: 310, y: 110 });
  expect(state.ports).toContainEqual({ componentId: 'board', portId: 'gnd', x: 310, y: 90 });
  expect(state.ports).toContainEqual({ componentId: 'led', portId: 'anode', x: 410, y: 190 });
  expect(state.ports).toContainEqual({ componentId: 'led', portId: 'cathode', x: 430, y: 190 });

  // Every wire end lands exactly on a rendered port marker.
  for (const wire of state.wires) {
    const [x1, y1, x2, y2] = wire.points;
    for (const end of [{ x: x1, y: y1 }, { x: x2, y: y2 }]) {
      expect(state.ports.some((port) => port.x === end.x && port.y === end.y)).toBe(true);
    }
  }
});
