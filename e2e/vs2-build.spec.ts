import { expect, test, type Page } from '@playwright/test';
import { createDefaultProgram } from '../src/core/program/blocks';
import {
  canvasState,
  dragFromFlyout,
  expectBlockText,
  openProject,
  readJson,
  renderedLit,
  samples,
  worldToPage,
} from './helpers';

// E2E-2 (plan §11.3, VS-2) — the M2 demo: New → add Board, Resistor and LED
// from the palette → drag them into place → wire D13 → R.a, R.b → LED.anode,
// LED.cathode → GND with the mouse → drag "digital write D13 HIGH" from the
// flyout into "on start" → Run → LED lit → Stop → delete a wire → Run → LED off.

const storedOnStart = (page: Page) =>
  page.evaluate(() => {
    const program = window.__stem?.getProgramBlocks() as {
      blocks: { blocks: { type: string; inputs?: { DO?: { block?: unknown } } }[] };
    };
    return program.blocks.blocks.find((block) => block.type === 'stem_on_start')?.inputs?.DO?.block;
  });

test('builds, programs and runs a circuit from an empty project (VS-2)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New' }).click();
  await expectBlockText(page, 'on start');
  await expectBlockText(page, 'forever');
  await expect.poll(async () => (await canvasState(page)).components).toEqual([]);
  const { at } = await worldToPage(page);

  // Each device lands in the middle of the canvas; drag it by its body to its place.
  const place = async (name: string, target: { x: number; y: number }) => {
    await page.getByRole('button', { name: `Add ${name}` }).click();
    const added = (await canvasState(page)).components.at(-1);
    if (!added) {
      throw new Error(`${name} was not added`);
    }
    await page.mouse.move(at(added.x, added.y).x, at(added.x, added.y).y);
    await page.mouse.down();
    await page.mouse.move(at(target.x, target.y).x, at(target.x, target.y).y, { steps: 6 });
    await page.mouse.up();
    expect((await canvasState(page)).components.find((component) => component.id === added.id)).toMatchObject(
      target,
    );
    return added.id;
  };
  const board = await place('STEM Board', { x: 200, y: 220 });
  const resistor = await place('Resistor', { x: 480, y: 270 });
  const led = await place('LED', { x: 600, y: 240 });

  // Wire port to port with two clicks, at the positions the canvas rendered.
  const ports = (await canvasState(page)).ports;
  const port = (componentId: string, portId: string) => {
    const found = ports.find((candidate) => candidate.componentId === componentId && candidate.portId === portId);
    if (!found) {
      throw new Error(`No port ${componentId}/${portId}`);
    }
    return at(found.x, found.y);
  };
  const connections: [{ x: number; y: number }, { x: number; y: number }][] = [
    [port(board, 'd13'), port(resistor, 'a')],
    [port(resistor, 'b'), port(led, 'anode')],
    [port(led, 'cathode'), port(board, 'gnd')],
  ];
  for (const [from, to] of connections) {
    await page.mouse.click(from.x, from.y);
    await page.mouse.click(to.x, to.y);
  }
  const wires = (await canvasState(page)).wires;
  expect(wires.map((wire) => wire.points)).toEqual([
    [310, 110, 440, 270],
    [520, 270, 590, 270],
    [610, 270, 310, 90],
  ]);

  // Program it in Blockly the way a user does.
  await dragFromFlyout(page, 'Pins', 'digital write', 'on start');
  await expect
    .poll(() => storedOnStart(page))
    .toMatchObject({ type: 'stem_digital_write', fields: { PIN: 'D13', LEVEL: 'HIGH' } });

  const status = page.getByTestId('run-status');
  const run = page.getByRole('button', { name: 'Run' });
  const stop = page.getByRole('button', { name: 'Stop' });

  await run.click();
  await expect.poll(() => renderedLit(page, led)).toBe(true);
  await expect(status).toHaveText('Running');
  // Editing is locked while the program runs.
  await expect(page.getByRole('button', { name: 'New' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add LED' })).toBeDisabled();
  await stop.click();
  await expect(status).toHaveText('Idle');
  await expect.poll(() => renderedLit(page, led)).toBe(false);

  // Delete the D13 → R.a wire (click halfway along it), run again: the LED stays off.
  await page.mouse.click(at(375, 190).x, at(375, 190).y);
  await page.keyboard.press('Delete');
  expect((await canvasState(page)).wires).toHaveLength(2);
  await run.click();
  await expect(status).toHaveText('Running');
  // The program writes D13 before the first frame shows "Running", so this is its result.
  expect(await renderedLit(page, led)).toBe(false);
  await stop.click();
  await expect(status).toHaveText('Idle');
});

// Why a Run did not start belongs to the project that was run, not to the new one.
test.describe('New starts without the Run messages of the previous project', () => {
  const messages = (page: Page) => page.getByTestId('run-messages');

  const expectNewProject = async (page: Page) => {
    await expect.poll(async () => (await canvasState(page)).components).toEqual([]);
    expect((await canvasState(page)).wires).toEqual([]);
    expect(await page.evaluate(() => window.__stem?.getProgramBlocks())).toEqual(createDefaultProgram());
    await expectBlockText(page, 'on start');
    await expectBlockText(page, 'forever');
    await expect(page.getByTestId('run-status')).toHaveText('Idle');
    await expect(messages(page)).toBeHidden();
  };

  test('after a circuit that cannot run', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByRole('button', { name: 'Add STEM Board' }).click();
    await page.getByRole('button', { name: 'Add STEM Board' }).click();
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page)).toHaveText('The circuit can have only one board.');

    await page.getByRole('button', { name: 'New' }).click();

    await expectNewProject(page);
  });

  test('after a program with compile errors', async ({ page }) => {
    await openProject(page, { ...samples.ledOn, program: { blocks: readJson('../src/core/program/__fixtures__/duplicate-on-start.json') } });
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(messages(page).locator('li')).toHaveText([
      'The program has errors.',
      'Error: Only one "stem_on_start" block is allowed.',
    ]);

    await page.getByRole('button', { name: 'New' }).click();

    await expectNewProject(page);
  });
});
