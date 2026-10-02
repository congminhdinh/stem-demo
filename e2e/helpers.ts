import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

export const samples = {
  ledOn: readJson('../src/samples/led-on.project.json'),
  blink: readJson('../src/samples/blink.project.json'),
};

/** Opens the app on a project other than the default sample, via the dev-only hook. */
export async function openProject(page: Page, project: unknown) {
  await page.goto('/');
  await page.evaluate((document) => window.__stem?.loadProject(document), project);
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
