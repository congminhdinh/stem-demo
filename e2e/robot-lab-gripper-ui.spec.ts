import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SensorOverlayProbe } from '../src/ui/robot3d/parts/sensor-overlay';
import type { TopViewGripperState } from '../src/ui/robot3d/top-view-gripper-state';
import type { ZoneTagsProbe } from '../src/ui/robot3d/zone-tags-state';
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

type GripperView = {
  t: number;
  status: string;
  robot: { xCm: number; gripper?: { clawDeg: number; liftDeg: number; heldId: string | null } };
  pins: { pin: string; servoDeg: number | null }[];
};

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
/** The angle the claw (D9) or the lift (D10) is told: exact, whole degrees (the arm itself is a hair off, and slow). */
const servo = async (page: Page, pin: 'D9' | 'D10') => (await view(page))?.pins.find((state) => state.pin === pin)?.servoDeg;
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

    // F lowers the arm 15° a press: two presses are exactly 60° (D10 is told 60), and the world follows it down (a servo is slow: a wait for the condition).
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(60);
    // The arm comes down from 90°, so it is above 59.5° from the start: the wait is for it to be below 60.5° (it arrives), not for the lower bound.
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(60.5);
    expect((await gripper(page))!.liftDeg).toBeGreaterThan(59.5);
    // R raises it a step (75); four more reach the top (90) and stay there.
    await page.keyboard.press('r');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(75);
    for (let step = 0; step < 4; step++) await page.keyboard.press('r');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(90);
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(89);
    // E closes the claw all the way (nothing is between the jaws up here): D9 is told 80, Q opens it: 0.
    await page.keyboard.press('e');
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(80);
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeGreaterThan(70);
    await page.keyboard.press('q');
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(0);
    await expect.poll(async () => (await gripper(page))!.clawDeg, { timeout: 60_000 }).toBeLessThan(5);

    // The buttons do the same: a click is exactly one step (a double step would tell D10 60), and the claw's two close and open it (the arm is
    // still up, clear of the cube).
    await page.getByTestId('robot-gripper-down').click();
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(75);
    await expect.poll(async () => (await gripper(page))!.liftDeg, { timeout: 60_000 }).toBeLessThan(75.5);
    expect((await gripper(page))!.liftDeg).toBeGreaterThan(74.5);
    await page.getByTestId('robot-gripper-close').click();
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(80);
    await page.getByTestId('robot-gripper-open').click();
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(0);
    // A held press on the arm's button repeats its step until the arm is down (the open claw comes down round the cube).
    const box = (await page.getByTestId('robot-gripper-down').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(0);
    await page.mouse.up();
    // A held R steps at 10 a second by itself (the browser's own key repeat is ignored): up to the top, and it stops when the key is let go.
    await page.locator('.robot-stage').focus();
    await page.keyboard.down('r');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(90);
    await page.keyboard.up('r');
    await page.keyboard.press('f');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(75);
    await page.waitForTimeout(800);
    expect(await servo(page, 'D10')).toBe(75);
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

// N19 E4/E5: the gripper car on the 2D map and its overlays and tags in the 3D view, on the test arena with the pick-and-place lessons'
// named zones (?arena=pick: a pickup area round the red cube, a warehouse, a red zone, a drop zone, and goals that name the red cube and a
// blue cube by the warehouse).
//   - The 3D view: the zones' tags in Vietnamese whatever their kind, the objects' tags ("Khối đỏ", "Khối xanh dương": the red cube's, at the
//     car's nose, the layout keeps off the car; it is hidden while held), the IR beam seeing the cube, the colour spot reading it red, and
//     their tag saying so; a car at rest holding the cube draws no frame for them (N18 P2).
//   - The 2D map, chosen ("Xem 2D") and on a computer without WebGL (Review Focus 5): the jaws closed on the cube, the ring round it, the IR
//     beam and the spot with their tag, the named zones' names on the mat.
const pickUrl = `${labUrl}&arena=pick`;

/** The readers of what the view drew (the very instances the lab runs on, from the dev server). */
async function installReaders(page: Page) {
  await page.evaluate(async () => {
    const w = window as unknown as { __overlay: unknown; __tags: unknown; __map: unknown };
    const [overlayPath, tagsPath, mapPath] = ['/src/ui/robot3d/sensor-overlay-state.ts', '/src/ui/robot3d/zone-tags-state.ts', '/src/ui/robot3d/top-view-gripper-state.ts'];
    w.__overlay = await import(/* @vite-ignore */ overlayPath);
    w.__tags = await import(/* @vite-ignore */ tagsPath);
    w.__map = await import(/* @vite-ignore */ mapPath);
  });
}
const overlay = (page: Page) => page.evaluate(() => (window as unknown as { __overlay: { readSensorOverlay(): SensorOverlayProbe | null } }).__overlay.readSensorOverlay());
const tags = (page: Page) => page.evaluate(() => (window as unknown as { __tags: { readZoneTags(): ZoneTagsProbe | null } }).__tags.readZoneTags());
const map = (page: Page) => page.evaluate(() => (window as unknown as { __map: { readTopViewGripper(): TopViewGripperState | null } }).__map.readTopViewGripper());

/** By hand: the arm down round the cube (it is open from setup()), the claw closed on it, until the world holds it. */
async function grabCube(page: Page) {
  await page.locator('.robot-stage').focus();
  for (let step = 0; step < 6; step++) await page.keyboard.press('f');
  await expect.poll(async () => (await gripper(page))?.liftDeg ?? 90, { timeout: 60_000 }).toBeLessThan(1);
  await page.keyboard.press('e');
  await expect.poll(async () => (await gripper(page))?.heldId, { timeout: 60_000 }).toBe('cube');
}

const zoneWords = ['Khu lấy hàng', 'Kho', 'Vùng đỏ', 'Vùng thả'];

test.describe('the gripper car’s overlays, tags and 2D map (N19 E4/E5)', () => {
  test('3D: the named zones’ tags in Vietnamese, the cube’s tag hidden while held, the IR and colour overlays and their tag', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(pickUrl);
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await pinLowTierChainOff(page);
    await installReaders(page);
    // The tags come a frame after the first: every named zone has one with its Vietnamese name, whatever its kind (the pickup area is an
    // `area`), the unnamed garage its kind's word, and the cube one with its name.
    await expect.poll(async () => (await tags(page))?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    const before = (await tags(page))!;
    expect(before.filter((tag) => tag.kind === 'zone').map((tag) => tag.text)).toEqual(['Đích', ...zoneWords]);
    expect(before.filter((tag) => tag.kind === 'object').map(({ id, text }) => [id, text])).toEqual([
      ['cube', 'Khối đỏ'],
      ['cube-blue', 'Khối xanh dương'],
    ]);
    await expect.poll(async () => (await tags(page))!.filter((tag) => tag.visible).map((tag) => tag.text), { timeout: 30_000 }).toEqual(expect.arrayContaining([...zoneWords, 'Khối xanh dương']));
    await screenshot(page, '07-pick-tags.png');

    await startTeleop(page);
    await grabCube(page);
    // Held: the cube's tag is not shown (the HUD's chip names the cube now); the blue cube's and the zones' stay.
    await expect.poll(async () => (await tags(page))!.find((tag) => tag.id === 'cube')?.visible, { timeout: 30_000 }).toBe(false);
    // The layout keeps a tag off the car and the jaws, which move as the cube is taken: it settles in a frame or more.
    await expect.poll(async () => (await tags(page))!.find((tag) => tag.id === 'cube-blue')?.visible, { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId('robot-held')).toHaveText('Đang giữ: khối đỏ');
    // The IR between the jaws sees the cube, the colour sensor reads it red (once its first window is in), and their tag says so.
    await expect.poll(async () => (await overlay(page))?.gripper?.color?.color, { timeout: 30_000 }).toBe('red');
    const probe = (await overlay(page))!.gripper!;
    expect(probe.ir).toEqual({ role: 'irClaw', visible: true, detected: true });
    expect(probe.color).toMatchObject({ role: 'color1', visible: true, hit: true, color: 'red' });
    expect(probe.label).toEqual(['IR: có vật', 'Màu: đỏ']);
    await screenshot(page, '08-pick-held-overlays.png');
    // Let go: the claw opens, the IR still sees the cube between the jaws.
    await page.keyboard.press('q');
    await expect.poll(async () => (await gripper(page))?.heldId, { timeout: 60_000 }).toBeNull();
    expect((await overlay(page))!.gripper!.ir).toEqual({ role: 'irClaw', visible: true, detected: true });
    expect(errors).toEqual([]);
  });

  test('3D: a gripper car at rest holding the cube draws no frame for its overlays; one when “Hiện cảm biến” is turned, then rest again', async ({ page }) => {
    await page.goto(pickUrl);
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await pinLowTierChainOff(page);
    await installReaders(page);
    await page.evaluate(() => {
      // Counts the canvas's draws to the screen: three clears WebGL's default framebuffer once per render (robot-lab-sensors.spec.ts).
      const gl = (document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement).getContext('webgl2')!;
      const counter = window as unknown as { __draws: number };
      counter.__draws = 0;
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) counter.__draws += 1;
        clear(mask);
      };
    });
    const draws = () => page.evaluate(() => (window as unknown as { __draws: number }).__draws);
    await startTeleop(page);
    await grabCube(page);
    // The arm all the way up (at its stop: the steadiest pose), the cube held.
    for (let step = 0; step < 6; step++) await page.keyboard.press('r');
    await expect.poll(async () => (await gripper(page))?.liftDeg ?? 0, { timeout: 60_000 }).toBeGreaterThan(89);
    await expect.poll(async () => (await overlay(page))?.gripper?.color?.color, { timeout: 30_000 }).toBe('red');
    // Held still (teleop runs, nothing moves: the world the same to a hundredth of a cm and a degree, 400 ms apart), the scene and its
    // overlays draw nothing more.
    await settled(async () => {
      const world = (await page.evaluate(() => window.__stem?.robot.getSnapshot())) as { robot: { xCm: number; gripper?: { clawDeg: number; liftDeg: number } }; objects: { pose: { xCm: number; zCm: number } }[] } | null;
      return world && [world.robot.xCm, world.robot.gripper?.clawDeg, world.robot.gripper?.liftDeg, world.objects[0]?.pose.xCm, world.objects[0]?.pose.zCm].map((value) => Math.round((value ?? 0) * 100));
    });
    // A held car creeps: in yaw, by a few millionths of a radian a second, which crosses the scene's threshold for a changed picture (scene-math.ts
    // SAME_QUAT, 1e-5) about every 4.5 s of the world's time, and the scene then draws a pair of frames (measured: draws at 5.5, 10.1, 14.6, 19.1 s
    // ..., on the world's clock, load or none). The windows below are in the world's time, from the end of a pair, so that the next one is more than
    // 2 s off: with wall time (400 ms, 1.5 s) they landed on a pair when a loaded machine ran the world's clock behind the page's.
    const rested = await drawsAtRest(page, draws);
    await worldAdvances(page, 1.5);
    expect(await draws()).toBe(rested);
    expect((await overlay(page))!.gripper!.ir).toEqual({ role: 'irClaw', visible: true, detected: true });
    await page.getByTestId('robot-sensors').click();
    await expect.poll(draws, { timeout: 30_000 }).toBeGreaterThan(rested);
    // The toggle's own frames come within a few of the page's; the creep's pair after them.
    await worldAdvances(page, 0.5);
    const after = await drawsAtRest(page, draws);
    await worldAdvances(page, 1.2);
    expect(await draws()).toBe(after);
  });

  test('2D (“Xem 2D”): the jaws closed on the cube, the ring round it, the IR beam, the red spot and their tag, the zones’ Vietnamese names', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(pickUrl);
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await pinLowTierChainOff(page);
    await installReaders(page);
    await page.getByTestId('robot-viewmode').click();
    await page.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await map(page))?.gripper?.liftDeg, { timeout: 30_000 }).toBe(90);
    expect((await map(page))!.zoneLabels).toEqual(['Xuất phát', 'Đích', ...zoneWords]);
    expect((await map(page))!.objects).toEqual([
      { id: 'cube', fill: '#d32f2f', mark: 'stripes' },
      { id: 'cube-blue', fill: '#1976d2', mark: 'dots' },
    ]);
    await startTeleop(page);
    await grabCube(page);
    await expectHeldOnMap(page);
    await screenshot(page, '09-map-held.png');
    expect(errors).toEqual([]);
  });

  test('WebGL off: the 2D map stands in, and shows the jaws, the held cube with its ring and the gripper’s sensors (Review Focus 5)', async ({ baseURL }) => {
    const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    try {
      const page = await (await browser.newContext({ baseURL: baseURL ?? '', viewport: { width: 1280, height: 720 } })).newPage();
      const errors = collectErrors(page);
      await page.goto(pickUrl);
      await page.getByTestId('robot-lab').waitFor();
      expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'))).toBeNull();
      await expect(page.getByTestId('robot-topview')).toHaveAttribute('data-reason', 'no-webgl', { timeout: 60_000 });
      await expect(page.getByTestId('robot-canvas')).toHaveCount(0);
      await installReaders(page);
      await expect.poll(async () => (await map(page))?.gripper?.liftDeg, { timeout: 30_000 }).toBe(90);
      expect((await map(page))!.zoneLabels).toEqual(['Xuất phát', 'Đích', ...zoneWords]);
      await startTeleop(page);
      await grabCube(page);
      await expectHeldOnMap(page);
      await screenshot(page, '10-no-webgl-map-held.png');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

test.describe('the objects in the colours of the run’s world (N19 E4/E5, ruling 8)', () => {
  test('a run whose round paints the red cube green: the map, the 3D tag and the colour sensor all say green; before it and after Đặt lại, the arena’s red', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${pickUrl}&recolour=1`);
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await pinLowTierChainOff(page);
    await installReaders(page);
    // Nothing run: the arena's own red.
    await page.getByTestId('robot-viewmode').click();
    await page.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await map(page))?.objects.find((object) => object.id === 'cube'), { timeout: 30_000 }).toEqual({ id: 'cube', fill: '#d32f2f', mark: 'stripes' });
    // A run: its world's cube is green; the map paints it so, with green's grid, and the colour sensor between the jaws reads it green.
    await startTeleop(page);
    await expect.poll(async () => (await map(page))?.objects.find((object) => object.id === 'cube'), { timeout: 30_000 }).toEqual({ id: 'cube', fill: '#388e3c', mark: 'grid' });
    await page.locator('.robot-stage').focus();
    for (let step = 0; step < 6; step++) await page.keyboard.press('f');
    await expect.poll(async () => (await map(page))?.color?.color, { timeout: 60_000 }).toBe('green');
    await screenshot(page, '11-run-round-colour-map.png');
    // The 3D view: the tag names the cube as the run's world paints it.
    await page.getByTestId('robot-viewmode').click();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await expect.poll(async () => (await tags(page))?.find((tag) => tag.id === 'cube')?.text, { timeout: 30_000 }).toBe('Khối xanh lá');
    await expect.poll(async () => (await overlay(page))?.gripper?.color?.color, { timeout: 30_000 }).toBe('green');
    await screenshot(page, '12-run-round-colour-3d.png');
    // Teleop off: its last world stays in view (as any run's does), the cube green in it; Đặt lại robot goes back to the start, the arena's red.
    await page.getByTestId('robot-tool-teleop').click();
    await page.getByTestId('robot-reset').click();
    await page.getByTestId('robot-viewmode').click();
    await page.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await map(page))?.objects.find((object) => object.id === 'cube'), { timeout: 30_000 }).toEqual({ id: 'cube', fill: '#d32f2f', mark: 'stripes' });
    expect(errors).toEqual([]);
  });
});

/** The 2D map of the car holding the cube lowered: the jaws closed on it (turned in from 12°), the ring round the cube, the sensors and their tag. */
async function expectHeldOnMap(page: Page) {
  await expect.poll(async () => (await map(page))?.held?.visible, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await map(page))?.color?.color, { timeout: 30_000 }).toBe('red');
  const drawn = (await map(page))!;
  const world = (await view(page))!;
  expect(drawn.gripper).toMatchObject({ heldId: 'cube' });
  expect(drawn.gripper!.liftDeg).toBeLessThan(1);
  // The claw clamped on the cube short of its 80° (B2: about 26°): the fingers nearly straight, both turned in from 12°.
  expect(drawn.gripper!.clawDeg).toBeGreaterThan(15);
  expect(drawn.gripper!.clawDeg).toBeLessThan(40);
  expect(drawn.gripper!.jaws.map((jaw) => jaw.side)).toEqual([1, -1]);
  expect(drawn.gripper!.jaws[0]!.turnDeg).toBeCloseTo(12 - 0.445 * drawn.gripper!.clawDeg, 6);
  expect(drawn.gripper!.jaws[1]!.turnDeg).toBeCloseTo(-(12 - 0.445 * drawn.gripper!.clawDeg), 6);
  // Lowered: the boom's reach is 5·cos 40° (within the arm's last hundredths of a degree).
  expect(drawn.gripper!.reachCm).toBeCloseTo(5 * Math.cos((40 * Math.PI) / 180), 2);
  // The ring round the cube, at the cube: between the jaws' tips and hinges.
  expect(drawn.held).toMatchObject({ visible: true, id: 'cube' });
  expect(drawn.held!.radiusCm).toBeCloseTo(2 * Math.SQRT2 + 0.8, 9);
  const [left, right] = drawn.gripper!.jaws;
  expect(drawn.held!.xCm).toBeGreaterThan(left!.hinge.xCm);
  expect(drawn.held!.xCm).toBeLessThan(left!.tip.xCm);
  expect(drawn.held!.yCm).toBeLessThan(left!.hinge.yCm);
  expect(drawn.held!.yCm).toBeGreaterThan(right!.hinge.yCm);
  expect(world.robot.xCm).toBeLessThan(drawn.held!.xCm);
  // The IR sees the cube; the spot reads it red; the tag says both.
  expect(drawn.ir).toMatchObject({ visible: true, detected: true, hitId: 'cube', end: true });
  expect(drawn.color).toMatchObject({ rayVisible: true, spotVisible: true, color: 'red', tint: '#d32f2f' });
  expect(drawn.label).toEqual({ visible: true, lines: ['IR: có vật', 'Màu: đỏ'] });
}

/** Reads `read` until it gives the same value twice, 400 ms apart (robot-lab-sensors.spec.ts). */
async function settled<T>(read: () => Promise<T>): Promise<T> {
  let last: { value: T } | null = null;
  await expect
    .poll(
      async () => {
        const value = await read();
        const same = last !== null && JSON.stringify(last.value) === JSON.stringify(value);
        last = { value };
        return same;
      },
      { timeout: 30_000, intervals: [400] },
    )
    .toBe(true);
  return (last as { value: T } | null)!.value;
}

/** The world's clock, s (the snapshot's `t`): it goes on at the speed the lab runs at, however long the page takes to draw. */
const worldTime = async (page: Page) => ((await page.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0;

/** Resolves once the world's clock has gone on `seconds` more. */
async function worldAdvances(page: Page, seconds: number) {
  const from = await worldTime(page);
  await expect.poll(async () => (await worldTime(page)) - from, { timeout: 180_000, intervals: [100] }).toBeGreaterThanOrEqual(seconds);
}

/**
 * The count of draws (`read`) just after the scene's last burst of them, so that the next is a whole period away: waits for the next burst, or
 * 6 s of the world's clock without one (a world that does not creep draws none), then for 0.3 s of the clock with none more (the pair's second).
 */
async function drawsAtRest(page: Page, read: () => Promise<number>): Promise<number> {
  const start = { value: await read(), t: await worldTime(page) };
  let last = start;
  await expect
    .poll(
      async () => {
        const value = await read();
        const t = await worldTime(page);
        if (value !== last.value) last = { value, t };
        const burst = last !== start;
        return burst ? t - last.t >= 0.3 : t - start.t >= 6.3;
      },
      { timeout: 180_000, intervals: [100] },
    )
    .toBe(true);
  return last.value;
}
