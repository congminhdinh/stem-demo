import { expect, test, type Page } from '@playwright/test';
import { canvasState, expectBlockText, openProject, samples, worldToPage } from './helpers';

// Push button end to end (plan POC-12): holding the button on the canvas while
// running → RunSession.setContactInput → simulation → snapshot → the cap and
// the LED as rendered. The circuit is 3V3 → button → R → LED → GND and the
// program is empty: the button alone lights the LED.

/** The button cap and the LED as their renderers drew them. */
const rendered = async (page: Page) => {
  const { components } = await canvasState(page);
  return {
    closed: components.find((component) => component.id === 'button')?.closed,
    lit: components.find((component) => component.id === 'led')?.lit,
  };
};

/** The middle of the button body, clear of its port markers. */
async function buttonCenter(page: Page) {
  const { at } = await worldToPage(page);
  const button = (await canvasState(page)).components.find((component) => component.id === 'button');
  if (!button) {
    throw new Error('The button is not on the canvas');
  }
  return at(button.x, button.y);
}

const clickInPage = (page: Page, label: string) =>
  page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)?.click(), label);

test.beforeEach(async ({ page }) => {
  await openProject(page, samples.buttonDirect);
  await expectBlockText(page, 'forever');
});

test('holding the button lights the LED without a program, and releasing turns it off', async ({ page }) => {
  const status = page.getByTestId('run-status');
  const center = await buttonCenter(page);

  // While designing, a click selects the button like any other component.
  await page.mouse.click(center.x, center.y);
  expect((await canvasState(page)).components.find((component) => component.id === 'button')).toMatchObject({
    selected: true,
    closed: false,
  });

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status).toHaveText('Running');
  expect(await rendered(page)).toEqual({ closed: false, lit: false });

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect.poll(() => rendered(page)).toEqual({ closed: true, lit: true });
  await page.mouse.up();
  await expect.poll(() => rendered(page)).toEqual({ closed: false, lit: false });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toHaveText('Idle');
  // The presses were runtime state only: the document is still the sample (B2).
  expect(await page.evaluate(() => window.__stem?.getProject())).toEqual(samples.buttonDirect);
});

test('never leaves the button held: release outside the canvas, a cancelled pointer, Stop', async ({ page }) => {
  const status = page.getByTestId('run-status');
  const center = await buttonCenter(page);
  const program = await page.getByTestId('program-region').boundingBox();
  if (!program) {
    throw new Error('The program region is not visible');
  }
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status).toHaveText('Running');
  const press = async () => {
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await expect.poll(() => rendered(page)).toEqual({ closed: true, lit: true });
  };

  // Released over the Blockly panel: the canvas never sees the release.
  await press();
  await page.mouse.move(program.x + program.width / 2, program.y + program.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => rendered(page)).toEqual({ closed: false, lit: false });

  // The browser cancels the pointer (e.g. it takes the gesture over).
  await press();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')));
  await expect.poll(() => rendered(page)).toEqual({ closed: false, lit: false });
  await page.mouse.up();

  // Stop while the button is held: the press goes with the run.
  await press();
  await clickInPage(page, 'Stop');
  await expect(status).toHaveText('Idle');
  await page.mouse.up();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status).toHaveText('Running');
  expect(await rendered(page)).toEqual({ closed: false, lit: false });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toHaveText('Idle');
});
