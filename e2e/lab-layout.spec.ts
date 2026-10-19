import { expect, test, type Locator, type Page } from '@playwright/test';
import { ybcSolutionDocument } from '../src/samples/ybc-solutions';
import { canvasState, worldToPage } from './helpers';

// N8s: how a lab launch (`lab=`) lays itself out in the frame of a lesson page: the program the wider part, a
// separator and a fold for the circuit, the circuit fitted into its canvas, the starter blocks in sight; in a
// frame narrower than 800 px, tabs. (The standalone editor and the legacy S1 lab keep their layout.)

async function openLab(page: Page, query: string) {
  await page.goto(`/?embed=1&${query}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

test.describe('a lab fits its circuit into the canvas', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('shows every port of the Blink circuit inside the canvas, shrunk to fit the narrower circuit column', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { box, at } = await worldToPage(page);
    const { ports, viewport } = await canvasState(page);
    expect(viewport.scale).toBeLessThan(1);
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

/** The page box of `locator`, which must be on screen. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Not on screen');
  }
  return box;
}

/** Whether `inner` lies inside `outer`, whole. */
const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The block of the workspace (not the flyout) whose label is `label`. */
const workspaceBlock = (page: Page, label: string) =>
  page.getByTestId('blockly-panel').locator('.blocklyWorkspace > .blocklyBlockCanvas .blocklyDraggable', { has: page.locator('.blocklyText', { hasText: label }) }).first();

/** The page never scrolls: everything is inside the frame. */
const pageScrolls = (page: Page) => page.evaluate(() => document.scrollingElement !== null && document.scrollingElement.scrollHeight > window.innerHeight);

test.describe('a lab in a wide frame (1000 × 640, a lesson column)', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('gives the program the wider part, with the starter block in sight and nothing to scroll', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    const program = await boxOf(page.getByTestId('program-region'));
    const circuit = await boxOf(page.getByRole('region', { name: 'Mạch' }));
    expect(program.width).toBeGreaterThan(circuit.width * 1.4);
    expect(inside(await boxOf(workspaceBlock(page, 'hiển thị hình')), await boxOf(page.getByTestId('blockly-panel')))).toBe(true);
    // The Python panel starts folded to its title bar; it opens on demand.
    await expect(page.getByTestId('python-source')).toHaveCount(0);
    await page.getByTestId('python-panel').getByRole('button', { name: 'Hiện' }).click();
    await expect(page.getByTestId('python-source')).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
  });

  test('moves the separator with the keyboard and the pointer', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const separator = page.getByRole('separator', { name: 'Đổi độ rộng của mạch và chương trình' });
    await expect(separator).toHaveAttribute('aria-valuenow', '38');
    const before = await boxOf(page.getByTestId('circuit-canvas'));

    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '48');
    await expect.poll(async () => (await boxOf(page.getByTestId('circuit-canvas'))).width).toBeGreaterThan(before.width + 80);
    await page.keyboard.press('Home');
    await expect(separator).toHaveAttribute('aria-valuenow', '20');

    const handle = await boxOf(separator);
    const workspace = await boxOf(page.getByTestId('lab-workspace'));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(workspace.x + workspace.width * 0.5, handle.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  test('folds the circuit away for the blocks, and unfolds it for a run', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const width = (await boxOf(page.getByTestId('program-region'))).width;
    await page.getByRole('button', { name: 'Thu gọn mạch' }).click();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeHidden();
    await expect.poll(async () => (await boxOf(page.getByTestId('program-region'))).width).toBeGreaterThan(width + 300);

    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thu gọn mạch' })).toBeVisible();
  });
});

test.describe('a lab whose starter is wider than its program column (820 × 600)', () => {
  test.use({ viewport: { width: 820, height: 600 } });

  test('shrinks the blocks until every one is in sight, and saves nothing for it', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-button-ab&profile=ybc-basic');
    const before = await page.evaluate(() => window.__stem?.getProject());
    const panel = await boxOf(page.getByTestId('blockly-panel'));
    const tops = page.getByTestId('blockly-panel').locator('.blocklyWorkspace > .blocklyBlockCanvas > .blocklyDraggable');
    expect(await tops.count()).toBe(3);
    for (const top of await tops.all()) {
      expect(inside(await boxOf(top), panel)).toBe(true);
    }
    // Only the view changed: the document is the template, as opened.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__stem?.getProject())).toEqual(before);
  });
});

test.describe('a lab in a narrow frame (670 × 600, a tablet in portrait)', () => {
  test.use({ viewport: { width: 670, height: 600 } });

  test('shows the program or the circuit, in tabs, with nothing to scroll', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    const programTab = page.getByRole('tab', { name: 'Chương trình' });
    const circuitTab = page.getByRole('tab', { name: 'Mạch' });
    await expect(programTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('program-region')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeHidden();
    expect(inside(await boxOf(workspaceBlock(page, 'hiển thị hình')), await boxOf(page.getByTestId('blockly-panel')))).toBe(true);
    expect(await pageScrolls(page)).toBe(false);

    await circuitTab.click();
    await expect(circuitTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('program-region')).toBeHidden();
    const frame = { x: 0, y: 0, width: 670, height: 600 };
    expect(inside(await boxOf(page.getByTestId('circuit-canvas')), frame)).toBe(true);
    expect(inside(await boxOf(page.getByTestId('board-panel')), frame)).toBe(true);
    // The whole board is drawn inside its canvas.
    const { box, at } = await worldToPage(page);
    for (const port of (await canvasState(page)).ports) {
      const shown = at(port.x, port.y);
      expect(inside({ ...shown, width: 0, height: 0 }, box), `${port.componentId}/${port.portId}`).toBe(true);
    }
    expect(await pageScrolls(page)).toBe(false);
  });

  test('turns to the circuit when the program runs', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByRole('tab', { name: 'Mạch' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-panel')).toBeVisible();
    // The starter prints nothing: the empty console takes no room from the workspace.
    await expect(page.getByTestId('run-status')).toHaveText('Đang chạy');
    await expect(page.getByTestId('console')).toBeHidden();
  });
});

test.describe('a frame that changes size (a tablet turned)', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('switches between the split and the tabs, keeping the blocks and the circuit', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    await expect(page.getByRole('separator')).toBeVisible();

    await page.setViewportSize({ width: 670, height: 600 });
    await expect(page.getByRole('tab', { name: 'Chương trình' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('separator')).toHaveCount(0);
    await expect(workspaceBlock(page, 'hiển thị hình')).toBeVisible();
    await page.getByRole('tab', { name: 'Mạch' }).click();
    const { box, at } = await worldToPage(page);
    for (const port of (await canvasState(page)).ports) {
      expect(inside({ ...at(port.x, port.y), width: 0, height: 0 }, box), `${port.componentId}/${port.portId}`).toBe(true);
    }

    await page.setViewportSize({ width: 1000, height: 640 });
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByTestId('circuit-canvas')).toBeVisible();
    await expect(workspaceBlock(page, 'hiển thị hình')).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
  });
});

/*
 * The lab layout fix (2026-10-20): the runtime controls of N17 (A, B, A+B, the light and temperature sliders, the tilt pad, the
 * sound switch) under the circuit took the whole height of a lesson's frame and left the board about 10 px tall. The canvas keeps
 * at least 260 px (the board fitted into it); the board panel takes what is left and scrolls on its own.
 */
const shortFrames = [
  { width: 1440, height: 620 },
  { width: 1280, height: 600 },
  { width: 1024, height: 700 },
  // What the LMS gives the lab of the lesson "Đèn ngủ thông minh" in a 1440 × 900 window.
  { width: 1022, height: 581 },
];

/** The whole board is drawn inside its canvas: every port of the circuit, at the fitted scale. */
async function expectBoardInCanvas(page: Page) {
  const { box, at } = await worldToPage(page);
  for (const port of (await canvasState(page)).ports) {
    expect(inside({ ...at(port.x, port.y), width: 0, height: 0 }, box), `${port.componentId}/${port.portId}`).toBe(true);
  }
}

for (const size of shortFrames) {
  test.describe(`a Yolo:Bit lab with every runtime control in a short frame (${size.width} × ${size.height})`, () => {
    test.use({ viewport: size });

    test('keeps the board at least 240 px tall and whole, the goals and the toolbar in sight, and scrolls the controls on their own', async ({ page }) => {
      await openLab(page, 'lab=yolobit&template=ybc-thermometer&profile=ybc-advanced');
      const frame = { x: 0, y: 0, ...size };
      const canvas = await boxOf(page.getByTestId('circuit-canvas'));
      expect(canvas.height).toBeGreaterThanOrEqual(240);
      expect(inside(canvas, frame)).toBe(true);
      await expectBoardInCanvas(page);

      for (const name of ['Chạy', 'Dừng', 'Kiểm tra', 'Đặt lại']) {
        expect(inside(await boxOf(page.getByRole('button', { name, exact: true })), frame), name).toBe(true);
      }
      expect(inside(await boxOf(page.getByTestId('challenge-panel')), frame)).toBe(true);

      // The panel is inside the frame and the page never scrolls; the last control is reached by scrolling the panel alone.
      const panel = page.getByTestId('board-panel');
      expect(inside(await boxOf(panel), frame)).toBe(true);
      expect(await pageScrolls(page)).toBe(false);
      const sound = page.getByRole('button', { name: 'Tắt âm thanh' });
      await sound.scrollIntoViewIfNeeded();
      expect(inside(await boxOf(sound), await boxOf(panel))).toBe(true);
      expect(await pageScrolls(page)).toBe(false);
      expect((await boxOf(page.getByTestId('circuit-canvas'))).height).toBe(canvas.height);

      // Blockly was resized to its panel (svgResize), and the blocks are in sight.
      const blocks = await boxOf(page.getByTestId('blockly-panel'));
      const svg = await boxOf(page.getByTestId('blockly-panel').locator('svg.blocklySvg').first());
      expect(Math.abs(svg.width - blocks.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(svg.height - blocks.height)).toBeLessThanOrEqual(1);
      await expect(workspaceBlock(page, 'lặp mãi mãi')).toBeVisible();
    });
  });
}

test.describe('the night light in the frame the LMS gives it (1022 × 581)', () => {
  test.use({ viewport: { width: 1022, height: 581 } });

  test('runs with the light slider in sight under a board that keeps its size, and lights the display in the dark', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-night-light&profile=ybc-advanced');
    await page.evaluate((document) => window.__stem?.loadProject(document), { ...ybcSolutionDocument('ybc-night-light'), profile: 'ybc-advanced' });
    const before = await boxOf(page.getByTestId('circuit-canvas'));
    await page.getByRole('button', { name: 'Chạy', exact: true }).click();
    const light = page.getByTestId('control-light');
    await expect(light).toBeEnabled();
    expect(inside(await boxOf(light), await boxOf(page.getByTestId('board-panel')))).toBe(true);
    await light.fill('10');
    await expect.poll(async () => (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board')?.display?.every((cell) => cell !== null)).toBe(true);
    expect(await boxOf(page.getByTestId('circuit-canvas'))).toEqual(before);
    expect(before.height).toBeGreaterThanOrEqual(240);
    await expectBoardInCanvas(page);
    await page.getByRole('button', { name: 'Dừng', exact: true }).click();
  });
});

test.describe('outside a lab', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('keeps the standalone layout: no tabs, no separator, the circuit the wider part', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    await expect(page.getByTestId('lab-workspace')).toHaveCount(0);
    await expect(page.getByRole('separator')).toHaveCount(0);
    const program = await boxOf(page.getByTestId('program-region'));
    const circuit = await boxOf(page.getByRole('region', { name: 'Circuit' }));
    expect(circuit.width).toBeGreaterThan(program.width);
    expect((await canvasState(page)).viewport).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
