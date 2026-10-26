import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinLowTierChainOff } from './robot-chain';

// N19 E1-E3: the gripper car's UI in the robot lab, drawn by SwiftShader (playwright.config.ts, project chromium-robot). No gripper lesson
// ships yet (plan D4), so e2e/robot-lab-gripper-ui.html opens the app as the LMS does (?embed=1&lab=robot&template=rb-sandbox) with that key's
// scenario swapped for a test arena on ref-uno-gripper@0: an empty floor, the robot facing +x, one red foam cube in reach of the lowered claw.
//   - E3: Q, E, R and F move the claw and the arm (the snapshot's robot.gripper follows), the four buttons are beside the D-pad, the view's name
//     says the keys.
//   - E2: the "Cổng & chân" tab shows the gripper's angles with mở or đóng, the IR sensor's pin and the colour sensor's pins SDA A4 and SCL A5.
//   - E1: after a grab by hand the HUD's chip says "Đang giữ: khối đỏ" with its swatch and mark, the polite region says "Đã gắp khối đỏ." and then
//     "Đã thả khối đỏ.", and the chip goes when the claw lets go.
// The raw R G B C of the colour sensor and the IR's level before B3/B4 give the world's sensors are not asserted here (see the report).
// Screenshots go to GRIPPER_UI_SHOTS_DIR, or under test-results.

const shots = process.env.GRIPPER_UI_SHOTS_DIR ?? join('test-results', 'robot-lab-gripper-ui');
const labUrl = '/e2e/robot-lab-gripper-ui.html?embed=1&lab=robot&template=rb-sandbox';

type GripperView = { t: number; status: string; robot: { xCm: number; gripper?: { clawDeg: number; liftDeg: number; heldId: string | null } } };

// N18 bt-lab-fix: under a suite's load SwiftShader draws a run slowly, so the waits in this file are for a condition, not for a time.
test.describe.configure({ timeout: 180_000 });

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function openLab(page: Page) {
  await page.goto(labUrl);
  await page.getByTestId('robot-lab').waitFor();
  await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await pinLowTierChainOff(page);
}

const view = (page: Page) => page.evaluate(() => window.__stem?.robot.getSnapshot() as GripperView | null);
const gripper = async (page: Page) => (await view(page))?.robot.gripper;
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** Starts teleop, which gives the view the focus, and waits for its world. */
async function startTeleop(page: Page) {
  await page.getByTestId('robot-tool-teleop').click();
  await expect(page.getByTestId('robot-status')).toHaveText('Đang lái tay');
  await expect.poll(async () => (await view(page))?.status, { timeout: 60_000 }).toBe('running');
}

test.describe('the gripper car in the robot lab (N19 E1-E3)', () => {
  test('Q E R F move the claw and the arm, and the four buttons are beside the D-pad', async ({ page }) => {
    const errors = collectErrors(page);
    await openLab(page);
    await startTeleop(page);
    // The view says the keys to whoever focuses it, and the tool's tooltip lists them.
    await expect(page.locator('.robot-stage')).toHaveAttribute('aria-label', /Q mở kẹp, E đóng kẹp, R nâng tay, F hạ tay/);
    await expect(page.getByTestId('robot-tool-teleop')).toHaveAttribute('title', /Tay gắp: Q mở kẹp, E đóng kẹp, R nâng tay, F hạ tay/);
    const buttons = page.getByTestId('robot-gripper-pad').locator('button');
    await expect(buttons).toHaveText(['', '', '', '']);
    expect(await buttons.evaluateAll((all) => all.map((button) => button.getAttribute('aria-label')))).toEqual(['Mở kẹp', 'Đóng kẹp', 'Nâng tay', 'Hạ tay']);
    const small = await page.locator('[data-testid=robot-tools] button, [data-testid=robot-tools] input').evaluateAll((all) => all.map((element) => element.getBoundingClientRect()).filter((box) => box.width < 44 || box.height < 44).length);
    expect(small).toBe(0);
    await screenshot(page, '01-teleop-gripper-pad.png');

    // setup() leaves the claw open and the arm up.
    await expect.poll(async () => (await gripper(page))?.liftDeg ?? 0).toBeGreaterThan(89);
    expect((await gripper(page))!.clawDeg).toBeLessThan(1);

    // F lowers the arm 15° a press: two presses are 60°, and the world follows it down (a servo is slow: a wait for the condition).
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(61);
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(59);
    // R raises it a step; held past the top it stays at 90°.
    await page.keyboard.press('r');
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(74);
    for (let step = 0; step < 4; step++) await page.keyboard.press('r');
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(89);
    // E closes the claw all the way (nothing is between the jaws up here), Q opens it.
    await page.keyboard.press('e');
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeGreaterThan(70);
    await page.keyboard.press('q');
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeLessThan(5);

    // The buttons do the same: a click lowers the arm a step, the claw's two close and open it (the arm is still up, clear of the cube).
    await page.getByTestId('robot-gripper-down').click();
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(76);
    await page.getByTestId('robot-gripper-close').click();
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeGreaterThan(70);
    await page.getByTestId('robot-gripper-open').click();
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeLessThan(5);
    // A held press on the arm's button repeats its step until the arm is down (the open claw comes down round the cube).
    const box = (await page.getByTestId('robot-gripper-down').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(1);
    await page.mouse.up();
    expect(errors).toEqual([]);
  });

  test('"Cổng & chân" shows the gripper’s angles with mở or đóng, the IR sensor’s pin and the colour sensor’s SDA and SCL', async ({ page }) => {
    const errors = collectErrors(page);
    await openLab(page);
    await page.getByRole('tab', { name: 'Cổng & chân' }).click();
    // Before a run: the wiring.
    await expect(page.getByTestId('hub-part-D9')).toHaveText('Tay gắp CLAW');
    await expect(page.getByTestId('hub-part-D10')).toHaveText('Tay gắp LIFT');
    await expect(page.getByTestId('hub-part-A3')).toHaveText('Hồng ngoại ở càng');
    await expect(page.getByTestId('hub-part-A4')).toHaveText('Cảm biến màu SDA');
    await expect(page.getByTestId('hub-part-A5')).toHaveText('Cảm biến màu SCL');
    await expect(page.getByTestId('hub-row-gripper')).toHaveAttribute('title', 'Tay gắp → GR1 → D9, D10');
    await expect(page.getByTestId('hub-row-irClaw')).toHaveAttribute('title', 'Hồng ngoại ở càng → IR1 → A3');
    await expect(page.getByTestId('hub-row-color1')).toHaveAttribute('title', 'Cảm biến màu → CS1 → A4, A5');
    await expect(page.getByTestId('hub-wires-color1')).toHaveText('SDA A4 · SCL A5');
    // No name written under the board is cut off by the drawing's edge ("Hồng ngoại ở càng" and "Cảm biến màu SDA" are the long ones).
    const clipped = await page.locator('[data-testid=hub-board] .hub-pad-part').evaluateAll((labels) => {
      const board = labels[0]!.closest('svg')!.getBoundingClientRect();
      return labels.map((label) => label.getBoundingClientRect()).filter((box) => box.bottom > board.bottom + 0.5 || box.top < board.top - 0.5).length;
    });
    expect(clipped).toBe(0);
    // Tall enough to see the cards in the shot.
    await page.setViewportSize({ width: 1280, height: 1500 });
    await screenshot(page, '02-inspector-before-run.png');

    await startTeleop(page);
    // setup(): claw 0° (mở), arm 90°.
    await expect(page.getByTestId('hub-value-gripper-claw')).toHaveText('0°');
    await expect(page.getByTestId('hub-note-gripper-claw')).toHaveText('mở');
    await expect(page.getByTestId('hub-value-gripper-lift')).toHaveText('90°');
    await expect(page.getByTestId('hub-row-gripper')).toHaveAttribute('title', 'Tay gắp kẹp 0° mở · tay 90° → GR1 → D9 servo 0°, D10 servo 90°');
    // The IR sensor shows its pin level and whether it sees an object; the colour sensor its pins (A4 and A5 are the bus).
    await expect(page.getByTestId('hub-value-irClaw')).toHaveText(/^(LOW|HIGH)$/);
    await expect(page.getByTestId('hub-note-irClaw')).toHaveText(/^(có vật|không)$/);
    await expect(page.getByTestId('hub-chip-A4')).toContainText('SDA');
    await expect(page.getByTestId('hub-chip-A5')).toContainText('SCL');
    await expect(page.getByTestId('hub-card-color1')).toBeVisible();

    // The arm and the claw by the keys: the card follows (the panel renders at most ten times a second).
    await page.locator('.robot-stage').focus();
    for (let step = 0; step < 6; step++) await page.keyboard.press('f');
    await page.keyboard.press('e');
    await expect(page.getByTestId('hub-value-gripper-lift')).toHaveText('0°', { timeout: 60_000 });
    await expect(page.getByTestId('hub-note-gripper-claw')).toHaveText('đóng', { timeout: 60_000 });
    await expect(page.getByTestId('hub-value-gripper-claw')).toHaveText(/^(7\d|80)°$/, { timeout: 60_000 });
    await expect(page.getByTestId('hub-chip-D9')).toContainText('servo 80°');
    await expect(page.getByTestId('hub-chip-D10')).toContainText('servo 0°');
    await screenshot(page, '03-inspector-live.png');
    expect(errors).toEqual([]);
  });

  test('a grab by hand: the HUD’s chip says what is held, the lab says it once, and both go when the claw lets go', async ({ page }) => {
    const errors = collectErrors(page);
    await openLab(page);
    await startTeleop(page);
    await expect(page.getByTestId('robot-held')).toHaveCount(0);
    // The arm down over the cube (the claw is open), then the claw closed on it.
    for (let step = 0; step < 6; step++) await page.keyboard.press('f');
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(1);
    await screenshot(page, '04-arm-down.png');
    await page.keyboard.press('e');
    await expect.poll(async () => (await gripper(page))!.heldId, { timeout: 60_000 }).toBe('cube');
    const chip = page.getByTestId('robot-held');
    await expect(chip).toHaveText('Đang giữ: khối đỏ');
    await expect(chip).toHaveAttribute('data-color', 'red');
    await expect(chip).toHaveAttribute('data-mark', 'stripes');
    await expect(chip.locator('svg rect')).toHaveAttribute('fill', '#d32f2f');
    // The chip is no live region; the lab's own polite one says the grab.
    await expect(chip.locator('xpath=ancestor-or-self::*[@aria-live]')).toHaveCount(0);
    await expect(page.getByTestId('robot-check-announce')).toHaveText('Đã gắp khối đỏ.');
    // The inspector says it too: the claw is closed on the cube, short of the 80° it is told.
    await page.getByRole('tab', { name: 'Cổng & chân' }).click();
    await expect(page.getByTestId('hub-note-gripper-claw')).toHaveText('đóng');
    await expect(page.getByTestId('hub-value-gripper-claw')).toHaveText(/^(2\d|3[0-4])°$/);
    await screenshot(page, '05-holding-cube.png');

    // Lift it: the cube goes up with the claw and the chip stays.
    await page.locator('.robot-stage').focus();
    for (let step = 0; step < 6; step++) await page.keyboard.press('r');
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(89);
    expect((await gripper(page))!.heldId).toBe('cube');
    await expect(chip).toBeVisible();

    // Q lets go: the chip goes and the lab says it (at most 1.5 s after the grab: it may wait for the end of that window).
    await page.keyboard.press('q');
    await expect.poll(async () => (await gripper(page))!.heldId, { timeout: 60_000 }).toBeNull();
    await expect(page.getByTestId('robot-held')).toHaveCount(0);
    await expect(page.getByTestId('robot-check-announce')).toHaveText('Đã thả khối đỏ.', { timeout: 10_000 });
    await screenshot(page, '06-released.png');
    expect(errors).toEqual([]);
  });

  test('the keys do nothing while teleop is off, or from a field of the page', async ({ page }) => {
    const errors = collectErrors(page);
    await openLab(page);
    // Teleop off: no run exists, and Q E R F make none.
    await page.locator('.robot-stage').focus();
    await page.keyboard.press('f');
    await page.keyboard.press('e');
    expect(await view(page)).toBeNull();
    await expect(page.getByTestId('robot-gripper-pad')).toHaveCount(0);
    await startTeleop(page);
    // A field inside the view takes its own keys: nothing moves.
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.dataset.testid = 'probe-field';
      document.querySelector('.robot-stage')!.append(field);
    });
    await page.getByTestId('probe-field').focus();
    await page.keyboard.type('fff');
    await page.waitForTimeout(500);
    expect((await gripper(page))!.liftDeg).toBeGreaterThan(89);
    expect(errors).toEqual([]);
  });
});

test.describe('the rover’s tools are as they were (N19 E3)', () => {
  test('the D-pad has no gripper buttons and Q E R F drive nothing on the rover’s sandbox', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await pinLowTierChainOff(page);
    await page.getByTestId('robot-tool-teleop').click();
    await expect(page.getByTestId('robot-teleop')).toBeVisible();
    await expect(page.getByTestId('robot-gripper-pad')).toHaveCount(0);
    await expect(page.locator('.robot-stage')).toHaveAttribute('aria-label', 'Khung nhìn 3D của robot: phím mũi tên hoặc W A S D để lái, phím cách để dừng');
    for (const key of ['q', 'e', 'r', 'f']) await page.keyboard.press(key);
    await expect(page.getByTestId('robot-held')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
