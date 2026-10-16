import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

export const samples = {
  ledOn: readJson('../src/samples/led-on.project.json'),
  blink: readJson('../src/samples/blink.project.json'),
  buttonDirect: readJson('../src/samples/button-direct.project.json'),
  buttonLed: readJson('../src/samples/button-led.project.json'),
};

/** Opens the app and waits until it has opened its project (read from storage first) and rendered it. */
export async function openApp(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

/** Opens the app on a project other than the default sample, via the dev-only hook. */
export async function openProject(page: Page, project: unknown) {
  await openApp(page);
  await page.evaluate((document) => window.__stem?.loadProject(document), project);
}

/** The project document as the app holds it (dev-only hook). */
export const currentProject = (page: Page) => page.evaluate(() => window.__stem?.getProject());

/**
 * Every project record in IndexedDB, last saved first, read with the
 * browser's own API rather than through the app (plan §7: database
 * "stem-studio", table "projects").
 */
export const storedProjects = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ id: string; updatedAt: number; document: unknown }[]>((resolve, reject) => {
        const opening = indexedDB.open('stem-studio');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains('projects')) {
            db.close();
            resolve([]);
            return;
          }
          const reading = db.transaction('projects').objectStore('projects').getAll();
          reading.onerror = () => reject(reading.error);
          reading.onsuccess = () => {
            db.close();
            resolve(reading.result.sort((a, b) => b.updatedAt - a.updatedAt));
          };
        };
      }),
  );

/** Waits until IndexedDB holds the app's current document as its last project. */
export async function expectSaved(page: Page) {
  const project = await currentProject(page);
  await expect.poll(async () => (await storedProjects(page))[0]?.document).toEqual(project);
}

/** The LED state as the renderer drew it on the Konva node (plan §11.4), not as the store says. */
export const renderedLit = (page: Page, componentId = 'led') =>
  page.evaluate((id) => window.__stem?.getCanvasState()?.components.find((c) => c.id === id)?.lit, componentId);

/** Picks a value in a Blockly dropdown field showing `current`. */
export async function chooseInDropdown(page: Page, current: string, next: string, index = 0) {
  await page.getByTestId('blockly-panel').locator('.blocklyDropdownText', { hasText: current }).nth(index).click();
  await page.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: next }).click();
}

export async function expectBlockText(page: Page, text: string) {
  await expect(page.getByTestId('blockly-panel').locator('.blocklyText', { hasText: text })).toBeVisible();
}

/** What Konva rendered (dev-only hook), in world coordinates. */
export async function canvasState(page: Page) {
  const state = await page.evaluate(() => window.__stem?.getCanvasState());
  if (!state) {
    throw new Error('Canvas state is not available');
  }
  return state;
}

/** The cap of the push button `button` and the LED `led` as their renderers drew them. */
export async function buttonAndLed(page: Page) {
  const { components } = await canvasState(page);
  return {
    closed: components.find((component) => component.id === 'button')?.closed,
    lit: components.find((component) => component.id === 'led')?.lit,
  };
}

/** The middle of the body of the push button `button`, clear of its port markers. */
export async function buttonCenter(page: Page) {
  const { at } = await worldToPage(page);
  const button = (await canvasState(page)).components.find((component) => component.id === 'button');
  if (!button) {
    throw new Error('The button is not on the canvas');
  }
  return at(button.x, button.y);
}

/** World → page coordinates, through the stage's viewport (the identity in the standalone editor; a lab fits its circuit, N8s). */
export async function worldToPage(page: Page) {
  const box = await page.getByTestId('circuit-canvas').locator('canvas').first().boundingBox();
  if (!box) {
    throw new Error('The canvas is not visible');
  }
  const { viewport } = await canvasState(page);
  return { box, at: (x: number, y: number) => ({ x: box.x + viewport.x + x * viewport.scale, y: box.y + viewport.y + y * viewport.scale }) };
}

/**
 * Drags the first block labelled `blockLabel` from a toolbox category's flyout
 * into the statement input of the hat labelled `hatLabel`, as a user would.
 * It drops the block's top-left just inside the input; Blockly snaps it in.
 */
export async function dragFromFlyout(page: Page, category: string, blockLabel: string, hatLabel: string) {
  const panel = page.getByTestId('blockly-panel');
  await panel.locator('.blocklyToolboxCategory', { hasText: category }).click();
  await panel.locator('.blocklyFlyout .blocklyText', { hasText: blockLabel }).first().waitFor();
  const geometry = await page.evaluate(
    ([block, hat]) => {
      const box = (element: Element | null | undefined) => {
        const rect = element?.getBoundingClientRect();
        if (!rect) {
          throw new Error('A Blockly block is missing');
        }
        return { x: rect.x, y: rect.y, height: rect.height };
      };
      // Blockly renders label spaces as no-break spaces (U+00A0).
      const label = (text: Element) => text.textContent?.split(String.fromCharCode(0xa0)).join(' ');
      const texts = [...document.querySelectorAll('[data-testid=blockly-panel] .blocklyText')];
      const blockText = texts.find((text) => label(text) === block && text.closest('.blocklyFlyout'));
      const hatText = texts.find((text) => label(text) === hat && !text.closest('.blocklyFlyout'));
      return {
        blockText: box(blockText),
        block: box(blockText?.closest('.blocklyDraggable')),
        hatText: box(hatText),
        hat: box(hatText?.closest('.blocklyDraggable')),
      };
    },
    [blockLabel, hatLabel],
  );
  const grab = { x: geometry.blockText.x + 10, y: geometry.blockText.y + geometry.blockText.height / 2 };
  const drop = {
    x: geometry.hat.x + 16 + (grab.x - geometry.block.x),
    y: geometry.hatText.y + geometry.hatText.height + 12 + (grab.y - geometry.block.y),
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y + 10, { steps: 3 });
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await page.mouse.up();
}
