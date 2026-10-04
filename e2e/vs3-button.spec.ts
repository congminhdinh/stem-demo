import { expect, test, type Page } from '@playwright/test';
import { buttonAndLed, buttonCenter, chooseInDropdown, expectBlockText, openProject, samples } from './helpers';

// E2E-3 (plan §11.3, VS-3) — the closed loop through every boundary: the
// button held on the canvas (RunSession contact) → the program's digital read
// → if/else → digital write → simulation → the LED as rendered. The program
// is the button-led sample as Blockly shows it, saved and compiled at Run.

const storedProgram = (page: Page) => page.evaluate(() => window.__stem?.getProgramBlocks());

/** The sample's program with the levels its two digital writes set, then and else. */
const withLevels = (then: 'HIGH' | 'LOW', otherwise: 'HIGH' | 'LOW') => {
  const program = structuredClone(samples.buttonLed.program.blocks);
  const { inputs } = program.blocks.blocks[0].inputs.DO.block;
  inputs.DO0.block.fields.LEVEL = then;
  inputs.ELSE.block.fields.LEVEL = otherwise;
  return program;
};

type PressTiming = { pressToLitMs?: number };

/** From the next pointerdown (its event time) to the frame that shows the LED lit. */
const timeNextPressToLit = (page: Page) =>
  page.evaluate(() => {
    window.addEventListener(
      'pointerdown',
      (event) => {
        const check = () => {
          if (window.__stem?.getCanvasState()?.components.find((c) => c.id === 'led')?.lit) {
            (window as PressTiming).pressToLitMs = performance.now() - event.timeStamp;
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      },
      { once: true, capture: true },
    );
  });

test.beforeEach(async ({ page }) => {
  await openProject(page, samples.buttonLed);
  await expectBlockText(page, 'digital read');
  await expectBlockText(page, 'else');
});

test('holding the button lights the LED through the program, and releasing turns it off (VS-3)', async ({ page }) => {
  const status = page.getByTestId('run-status');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status).toHaveText('Running');
  // Run saved the workspace first: Blockly wrote the sample's JSON back unchanged,
  // the if/else mutator state included (R2).
  expect(await storedProgram(page)).toEqual(samples.buttonLed.program.blocks);
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: false, lit: false });

  const center = await buttonCenter(page);
  await page.mouse.move(center.x, center.y);
  await timeNextPressToLit(page);
  await page.mouse.down();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: true, lit: true });
  const pressToLitMs = await page.evaluate(() => (window as PressTiming).pressToLitMs);
  // Plan §2.5 (≤ 50 ms) is checked by a separate, sequential measurement; this
  // run shares the machine with other workers, so it is recorded, not asserted.
  test.info().annotations.push({ type: 'Press → LED lit', description: `${pressToLitMs?.toFixed(1)} ms` });

  await page.mouse.up();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: false, lit: false });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toHaveText('Idle');
  expect(await buttonAndLed(page)).toEqual({ closed: false, lit: false });
});

test('runs the program as edited in Blockly: swapping the levels inverts the button', async ({ page }) => {
  // else: LOW → HIGH, then: HIGH → LOW (the first of the two HIGH fields).
  await chooseInDropdown(page, 'LOW', 'HIGH');
  await chooseInDropdown(page, 'HIGH', 'LOW', 0);
  await expect.poll(() => storedProgram(page)).toEqual(withLevels('LOW', 'HIGH'));

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Running');
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: false, lit: true });

  const center = await buttonCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: true, lit: false });
  await page.mouse.up();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: false, lit: true });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Idle');
});
