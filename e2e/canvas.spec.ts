import { expect, test, type Page } from '@playwright/test';
import { canvasState, openProject, samples, worldToPage } from './helpers';

const componentIds = async (page: Page) => (await canvasState(page)).components.map((component) => component.id);
const componentById = async (page: Page, id: string) =>
  (await canvasState(page)).components.find((component) => component.id === id);
const wirePoints = async (page: Page, id: string) =>
  (await canvasState(page)).wires.find((wire) => wire.id === id)?.points;

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

test('moves, adds and deletes components with the mouse and keyboard', async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);
  const { box, at } = await worldToPage(page);

  // Drag the LED by its body (centered at 420,160) by (+37, +23).
  await page.mouse.move(at(420, 160).x, at(420, 160).y);
  await page.mouse.down();
  await page.mouse.move(at(440, 170).x, at(440, 170).y, { steps: 4 });
  await page.mouse.move(at(457, 183).x, at(457, 183).y, { steps: 4 });
  // While dragging, the wire already ends on the moving anode (offset −10, +30), off the grid.
  const [, , anodeX = 0, anodeY = 0] = (await wirePoints(page, 'wire-d13-anode')) ?? [];
  expect(anodeX).toBeCloseTo(447, 0);
  expect(anodeY).toBeCloseTo(213, 0);
  await page.mouse.up();

  // Dropped on the grid, selected; both wires end on the moved ports.
  expect(await componentById(page, 'led')).toMatchObject({ x: 460, y: 180, selected: true });
  expect(await wirePoints(page, 'wire-d13-anode')).toEqual([310, 110, 450, 210]);
  expect(await wirePoints(page, 'wire-cathode-gnd')).toEqual([470, 210, 310, 90]);

  // Add an LED from the palette: it lands on the grid in the middle of the canvas, selected.
  await page.getByRole('button', { name: 'Add LED' }).click();
  const snap = (value: number) => Math.round(value / 10) * 10;
  expect(await componentById(page, 'led-1')).toMatchObject({
    deviceType: 'led',
    x: snap(box.width / 2),
    y: snap(box.height / 2),
    selected: true,
  });
  expect(await componentById(page, 'led')).toMatchObject({ selected: false });

  // Esc clears the selection, so Delete does nothing.
  await page.mouse.click(at(460, 180).x, at(460, 180).y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  expect(await componentIds(page)).toEqual(['board', 'led', 'led-1']);

  // Select the moved LED and delete it: its two wires go with it (I4).
  await page.mouse.click(at(460, 180).x, at(460, 180).y);
  await page.keyboard.press('Delete');
  expect(await componentIds(page)).toEqual(['board', 'led-1']);
  expect((await canvasState(page)).wires).toEqual([]);

  // Loading a project (here one with the same ids) starts without a selection.
  await page.mouse.click(at(200, 220).x, at(200, 220).y);
  expect(await componentById(page, 'board')).toMatchObject({ selected: true });
  await page.evaluate((project) => window.__stem?.loadProject(project), samples.ledOn);
  await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);
  expect(await componentById(page, 'board')).toMatchObject({ selected: false });
});

test('locks the circuit while a program runs', async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);
  const { at } = await worldToPage(page);
  // Selected before Run: the selection must not survive into the run.
  await page.mouse.click(at(420, 160).x, at(420, 160).y);
  expect(await componentById(page, 'led')).toMatchObject({ selected: true });

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
  await expect(page.getByRole('button', { name: 'Add LED' })).toBeDisabled();

  // Neither a drag nor Delete (with the canvas focused again) changes anything.
  await page.mouse.move(at(420, 160).x, at(420, 160).y);
  await page.mouse.down();
  await page.mouse.move(at(480, 220).x, at(480, 220).y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Delete');
  expect(await componentById(page, 'led')).toMatchObject({ x: 420, y: 160, selected: false });
  expect(await componentIds(page)).toEqual(['board', 'led']);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Add LED' })).toBeEnabled();
});

/** Clicks a toolbar or palette button from page code, e.g. in the same task as another click. */
const clickButtonsInOneTask = (page: Page, names: string[]) =>
  page.evaluate((labels) => {
    const buttons = [...document.querySelectorAll('button')];
    return labels.map((label) => {
      const button = buttons.find((b) => (b.getAttribute('aria-label') ?? b.textContent) === label);
      const enabled = button?.disabled === false;
      button?.click();
      return enabled;
    });
  }, names);

test('refuses a circuit edit made in the same task as Run', async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);

  // React has not re-rendered between the two clicks, so Add LED is still enabled.
  expect(await clickButtonsInOneTask(page, ['Run', 'Add LED'])).toEqual([true, true]);

  await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
  expect(await componentIds(page)).toEqual(['board', 'led']);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Idle');
  expect(await componentIds(page)).toEqual(['board', 'led']);
});

test('cancels a drag that a Run interrupts, also after Stop', async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);
  const { at } = await worldToPage(page);

  await page.mouse.move(at(420, 160).x, at(420, 160).y);
  await page.mouse.down();
  await page.mouse.move(at(457, 183).x, at(457, 183).y, { steps: 4 });
  expect((await componentById(page, 'led'))?.x).toBeCloseTo(457, 0);

  // Run while the mouse button is still held.
  await clickButtonsInOneTask(page, ['Run']);
  await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
  expect(await componentById(page, 'led')).toMatchObject({ x: 420, y: 160 });

  // The rest of the gesture moves nothing and the drop commits nothing.
  await page.mouse.move(at(480, 220).x, at(480, 220).y, { steps: 4 });
  await page.mouse.up();
  expect(await componentById(page, 'led')).toMatchObject({ x: 420, y: 160 });

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('Idle');
  expect(await componentById(page, 'led')).toMatchObject({ x: 420, y: 160 });
  expect(await wirePoints(page, 'wire-d13-anode')).toEqual([310, 110, 410, 190]);
});

// Wiring, on the led-on sample: board at (200,220) with GND (310,90), D13 (310,110),
// D12 (310,130); LED at (420,160) with anode (410,190) and cathode (430,190).

test.describe('wires', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page, samples.ledOn);
    await expect.poll(() => componentIds(page)).toEqual(['board', 'led']);
  });

  const wireIds = async (page: Page) => (await canvasState(page)).wires.map((wire) => wire.id);

  test('draws a wire from port to port, picking the nearest port of an off-target click', async ({ page }) => {
    const { at } = await worldToPage(page);

    // 3 px off D12, with D13 and D11 only 20 px away: hover and click both pick D12.
    await page.mouse.move(at(313, 130).x, at(313, 130).y);
    expect((await canvasState(page)).highlightedPorts).toEqual([{ componentId: 'board', portId: 'd12' }]);
    await page.mouse.click(at(313, 130).x, at(313, 130).y);

    // The preview runs from the port to the pointer.
    await page.mouse.move(at(380, 170).x, at(380, 170).y, { steps: 3 });
    expect((await canvasState(page)).wirePreview).toEqual([310, 130, 380, 170]);

    await page.mouse.click(at(412, 191).x, at(412, 191).y);
    expect((await canvasState(page)).wirePreview).toBeNull();
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd', 'wire-1']);
    expect(await wirePoints(page, 'wire-1')).toEqual([310, 130, 410, 190]);
  });

  test('refuses an invalid wire with a message, and cancels on Esc or an empty click', async ({ page }) => {
    const { at } = await worldToPage(page);
    const message = page.getByTestId('canvas-message');

    // D13 → anode already exists.
    await page.mouse.click(at(310, 110).x, at(310, 110).y);
    await page.mouse.click(at(410, 190).x, at(410, 190).y);
    await expect(message).toHaveText('These ports are already connected.');
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd']);
    expect((await canvasState(page)).wirePreview).toBeNull();

    // The same port twice.
    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    await expect(message).toBeHidden();
    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    await expect(message).toHaveText('A wire needs two different ports.');

    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    expect((await canvasState(page)).wirePreview).not.toBeNull();
    await page.keyboard.press('Escape');
    expect((await canvasState(page)).wirePreview).toBeNull();

    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    await page.mouse.click(at(600, 500).x, at(600, 500).y);
    expect((await canvasState(page)).wirePreview).toBeNull();
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd']);
  });

  test('never drags a component from a port, nor while a wire is being drawn', async ({ page }) => {
    const { at } = await worldToPage(page);

    // (302,110) is on the board body, 8 px from D13 (outside its 4 px marker, inside
    // the 12 px pick radius): pressing there starts a wire, not a drag; releasing
    // away from a port ends that wire.
    await page.mouse.move(at(302, 110).x, at(302, 110).y);
    await page.mouse.down();
    await page.mouse.move(at(250, 180).x, at(250, 180).y, { steps: 4 });
    expect((await canvasState(page)).wirePreview).toEqual([310, 110, 250, 180]);
    expect(await componentById(page, 'board')).toMatchObject({ x: 200, y: 220 });
    await page.mouse.up();
    expect((await canvasState(page)).wirePreview).toBeNull();
    expect(await componentById(page, 'board')).toMatchObject({ x: 200, y: 220 });

    // While a wire is drawn, pressing on the LED body drags nothing; the release ends the wire.
    await page.mouse.click(at(310, 110).x, at(310, 110).y);
    expect((await canvasState(page)).wirePreview).not.toBeNull();
    await page.mouse.move(at(420, 150).x, at(420, 150).y);
    await page.mouse.down();
    await page.mouse.move(at(470, 200).x, at(470, 200).y, { steps: 4 });
    await page.mouse.up();
    expect((await canvasState(page)).wirePreview).toBeNull();
    expect(await componentById(page, 'led')).toMatchObject({ x: 420, y: 160 });
  });

  test('ends the wire being drawn when the user turns to the palette or Blockly', async ({ page }) => {
    const { at } = await worldToPage(page);
    const preview = async () => (await canvasState(page)).wirePreview;

    // Palette: the wire ends; back on the canvas a port click starts a new one.
    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    expect(await preview()).not.toBeNull();
    await page.getByRole('button', { name: 'Add LED' }).click();
    expect(await preview()).toBeNull();
    expect(await componentIds(page)).toEqual(['board', 'led', 'led-1']);
    await page.mouse.click(at(310, 110).x, at(310, 110).y);
    expect((await preview())?.slice(0, 2)).toEqual([310, 110]);
    await page.keyboard.press('Escape');

    // Blockly: the same, and components drag again.
    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    expect(await preview()).not.toBeNull();
    await page.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'on start' }).click();
    expect(await preview()).toBeNull();
    await page.mouse.move(at(420, 150).x, at(420, 150).y);
    await page.mouse.down();
    await page.mouse.move(at(460, 190).x, at(460, 190).y, { steps: 4 });
    await page.mouse.up();
    expect(await componentById(page, 'led')).toMatchObject({ x: 460, y: 200 });
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd']);
  });

  test('selects a wire with a click and deletes it with Delete', async ({ page }) => {
    const { at } = await worldToPage(page);
    const isSelected = async (id: string) => (await canvasState(page)).wires.find((wire) => wire.id === id)?.selected;

    // (360,150) is halfway along D13 → anode, away from any port or body.
    await page.mouse.click(at(360, 150).x, at(360, 150).y);
    expect(await isSelected('wire-d13-anode')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await isSelected('wire-d13-anode')).toBe(false);

    await page.mouse.click(at(360, 150).x, at(360, 150).y);
    await page.keyboard.press('Delete');
    expect(await wireIds(page)).toEqual(['wire-cathode-gnd']);
    expect(await componentIds(page)).toEqual(['board', 'led']);
  });

  test('a Run cancels the wire being drawn, also after Stop', async ({ page }) => {
    const { at } = await worldToPage(page);

    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    expect((await canvasState(page)).wirePreview).not.toBeNull();
    await clickButtonsInOneTask(page, ['Run']);
    await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
    expect((await canvasState(page)).wirePreview).toBeNull();

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Idle');
    expect((await canvasState(page)).wirePreview).toBeNull();
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd']);
  });

  test('changes nothing on canvas clicks while a program runs', async ({ page }) => {
    const { at } = await worldToPage(page);
    await page.mouse.click(at(420, 150).x, at(420, 150).y);
    expect(await componentById(page, 'led')).toMatchObject({ selected: true });
    await clickButtonsInOneTask(page, ['Run']);
    await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');

    // No highlight, no wire started, no wire selected or deleted, no deselection.
    await page.mouse.move(at(310, 130).x, at(310, 130).y);
    expect((await canvasState(page)).highlightedPorts).toEqual([]);
    await page.mouse.click(at(310, 130).x, at(310, 130).y);
    expect((await canvasState(page)).wirePreview).toBeNull();
    await page.mouse.click(at(360, 150).x, at(360, 150).y);
    await page.keyboard.press('Delete');
    await page.mouse.click(at(600, 500).x, at(600, 500).y);
    expect(await wireIds(page)).toEqual(['wire-d13-anode', 'wire-cathode-gnd']);

    // After Stop the selection is the one from before Run.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('run-status')).toHaveText('Idle');
    expect(await componentById(page, 'led')).toMatchObject({ selected: true });
    expect((await canvasState(page)).wires.every((wire) => !wire.selected)).toBe(true);
    expect((await canvasState(page)).wirePreview).toBeNull();
  });
});
