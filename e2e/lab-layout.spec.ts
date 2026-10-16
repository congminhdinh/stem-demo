import { expect, test, type Page } from '@playwright/test';
import { canvasState, worldToPage } from './helpers';

// N8s: how a lab launch (`lab=`) lays itself out in the frame of a lesson page: the circuit fitted into its
// canvas. (The standalone editor and the legacy S1 lab keep their layout; their E2E are unchanged.)

async function openLab(page: Page, query: string) {
  await page.goto(`/?embed=1&${query}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

test.describe('a lab fits its circuit into the canvas', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('shows every port of the Blink circuit inside the canvas, never enlarged', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { box, at } = await worldToPage(page);
    const { ports, viewport } = await canvasState(page);
    expect(viewport.scale).toBeLessThanOrEqual(1);
    for (const port of ports) {
      const shown = at(port.x, port.y);
      expect(shown.x, `${port.componentId}/${port.portId}`).toBeGreaterThan(box.x);
      expect(shown.x, `${port.componentId}/${port.portId}`).toBeLessThan(box.x + box.width);
      expect(shown.y, `${port.componentId}/${port.portId}`).toBeGreaterThan(box.y);
      expect(shown.y, `${port.componentId}/${port.portId}`).toBeLessThan(box.y + box.height);
    }
  });

  test('picks the port under the pointer at the fitted scale', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { at } = await worldToPage(page);
    const anode = (await canvasState(page)).ports.find((port) => port.componentId === 'led' && port.portId === 'anode');
    if (!anode) {
      throw new Error('The LED has no anode port');
    }
    const shown = at(anode.x, anode.y);
    await page.mouse.move(shown.x + 3, shown.y + 2);
    await expect.poll(async () => (await canvasState(page)).highlightedPorts).toEqual([{ componentId: 'led', portId: 'anode' }]);
  });
});
