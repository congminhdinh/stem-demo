import { chromium, expect, firefox, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { robotSolutions, type BlocklyJson } from '../src/samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../src/samples/robot-templates';
import type { SensorOverlayProbe } from '../src/ui/robot3d/parts/sensor-overlay';
import type { ArenaPropsProbe } from '../src/ui/robot3d/arena-props-state';
import type { TopViewGripperState } from '../src/ui/robot3d/top-view-gripper-state';
import type { TopViewSensorsState } from '../src/ui/robot3d/top-view-sensors-state';
import type { ZoneTagsProbe } from '../src/ui/robot3d/zone-tags-state';
import { pinLowTierChainOff } from './robot-chain';
import { basicSkip } from '../tests/basic-skip';

basicSkip(test.skip, 'the gripper car’s lessons');

// N19 E10: the gripper lab on the real lessons (rb-grip-pick, rb-grip-sort: the scenarios the LMS opens by key, with the programs of
// src/samples/robot-solutions.ts; e2e/robot-lab-gripper-ui.spec.ts is the test arena's), drawn by SwiftShader (playwright.config.ts, project
// chromium-robot; Firefox runs what needs no WebGL). The lab is opened by its URL, as the LMS's frame does (?embed=1&lab=robot&template=<key>).
//   - Chạy: the reference of rb-grip-pick holds the cube and puts it down in the drop zone; the HUD's chip "Đang giữ: khối vàng" comes and
//     goes; the lab says "Đã gắp khối vàng." and "Đã thả khối vàng."; N19 final fix (G2 I1): the sensors' tag has no "Màu" line (the lesson
//     has no colour block).
//   - Kiểm tra Nhanh: the card of the reference (100/100 and its three goals) and of a program that pushes the cube (15/100, the reasons in
//     Vietnamese, "Khối vàng bị đẩy chứ không được gắp lúc … s ở lượt …"); the same card with no WebGL (Review Focus 5).
//   - Kiểm tra at 4×: nothing is said of a grab or a release; Lái tay is not offered, its keys do nothing, and the rounds end in the very
//     worlds a Kiểm tra without a key gives.
//   - Lái tay: Q E R F open and close the claw, raise and lower the arm.
//   - N19 final fix (G1 c2): in the LMS's lab frame at 1440 × 900 every lesson's header keeps Kiểm tra on the row of the run's controls;
//     minor round m1: a shortened title is a Tab stop whose popover (opened by the keyboard or a tap) shows the whole title.
//   - N19 final fix (G1 M1): Lái tay in the LMS's lab frame at 1366 × 768 keeps the free camera near (its distance at most 1.5 × the
//     distance with Lái tay off), although the pad with the gripper's buttons reaches past the short view's middle.
//   - Xem lại lượt 2 and 3 of rb-grip-sort, whose rounds paint the cube green, red and blue: in the round shown the 2D map's cube, the 3D
//     prop (the scene's state), the cube's tag and the chip's name, and the zone lit for the goal, are that round's colour; the 2D map's
//     cube marks are green's grid, red's stripes and blue's dots (read from the map's own state). The zones' marks are only the pattern table
//     the map paints from (zone-pattern.ts `zonePatternOf`): no state reader says what the map painted of a zone, and pixels are not read here.
//   - No WebGL: the 2D map draws the jaws closed on the cube, the ring round it, and the cube where it ends.
// What a canvas drew is read from the state the lab keeps of it (src/ui/robot3d/*-state.ts, loaded from the dev server), never from pixels.
// The programs come from robotSolutions, so no hash of a world is written in this file.

// Under a suite's load SwiftShader draws a run slowly: the waits are for a condition, and a test's limit is for a hang.
test.describe.configure({ timeout: 240_000 });

const labUrl = (key: RobotTemplateKey) => `/?embed=1&lab=robot&template=${key}`;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** Opens a lesson. `scene`: waits for the 3D scene's first frame (not on a computer without WebGL, nor where the 3D view is not looked at). */
async function openLesson(page: Page, key: RobotTemplateKey, scene = true) {
  await page.goto(labUrl(key));
  await page.getByTestId('robot-lab').waitFor();
  if (scene) await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await pinLowTierChainOff(page);
}

type Gripper = { clawDeg: number; liftDeg: number; heldId: string | null };
type World = { t: number; status: string; robot: { xCm: number; gripper?: Gripper }; pins: { pin: string; servoDeg: number | null }[]; objects: { id: string; pose: { xCm: number; yCm: number; zCm: number } }[] };
const world = async (page: Page) => (await page.evaluate(() => window.__stem?.robot.getSnapshot())) as World | null;
const servo = async (page: Page, pin: 'D9' | 'D10') => (await world(page))?.pins.find((state) => state.pin === pin)?.servoDeg;

type Exploit = Exclude<RobotTemplateKey, 'rb-sandbox'>;
/** The reference of a lesson, or the exploit of that name. */
function programOf(key: Exploit, which: 'reference' | string): BlocklyJson {
  const solution = robotSolutions[key];
  const blocks = which === 'reference' ? solution.reference : solution.exploits?.find((exploit) => exploit.name === which)?.program;
  if (blocks === undefined) throw new Error(`${key} has no program ${which}`);
  return blocks;
}
/** The program with its left turns right and its right turns left: the sort reference then sends red to blue's zone and blue to red's. */
const withTurnsSwapped = (program: BlocklyJson): BlocklyJson =>
  JSON.parse(JSON.stringify(program).replaceAll('"spinLeft"', '"swap"').replaceAll('"spinRight"', '"spinLeft"').replaceAll('"swap"', '"spinRight"')) as BlocklyJson;
const loadProgram = (page: Page, key: Exploit, program: BlocklyJson) => page.evaluate((document) => window.__stem?.loadProject(document), { ...robotStarterDocument(key), program: { blocks: program } });

/**
 * From now on keeps what the HUD's chip said (its text, null for none) and what the lab said politely (the live region), in the page, so
 * that a chip that is there for a second is not missed by a poll. `said` is every message, in order.
 */
async function record(page: Page) {
  await page.evaluate(() => {
    const record = { chips: [] as (string | null)[], said: [] as string[] };
    (window as unknown as { __record: typeof record }).__record = record;
    const chip = () => document.querySelector('[data-testid=robot-held]')?.textContent ?? null;
    record.chips.push(chip());
    new MutationObserver(() => {
      const now = chip();
      if (now !== record.chips[record.chips.length - 1]) record.chips.push(now);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    const live = document.querySelector('[data-testid=robot-check-announce]')!;
    new MutationObserver(() => {
      const text = live.textContent ?? '';
      if (text !== '') record.said.push(text);
    }).observe(live, { childList: true, subtree: true, characterData: true });
  });
}
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __record: { chips: (string | null)[]; said: string[] } }).__record);
const grabbed = (said: string[]) => said.filter((text) => /^Đã (gắp|thả) /.test(text));

/** The readers of what the views drew (the very instances the lab runs on, from the dev server). */
async function installReaders(page: Page) {
  await page.evaluate(async () => {
    const paths = {
      props: '/src/ui/robot3d/arena-props-state.ts',
      tags: '/src/ui/robot3d/zone-tags-state.ts',
      overlay: '/src/ui/robot3d/sensor-overlay-state.ts',
      map: '/src/ui/robot3d/top-view-gripper-state.ts',
      mapSensors: '/src/ui/robot3d/top-view-sensors-state.ts',
      zonePattern: '/src/ui/robot3d/zone-pattern.ts',
    };
    const readers: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(paths)) readers[name] = await import(/* @vite-ignore */ path);
    (window as unknown as { __readers: unknown }).__readers = readers;
  });
}
type Readers = {
  props: { readArenaProps(): ArenaPropsProbe | null };
  tags: { readZoneTags(): ZoneTagsProbe | null };
  overlay: { readSensorOverlay(): SensorOverlayProbe | null };
  map: { readTopViewGripper(): TopViewGripperState | null };
  mapSensors: { readTopViewSensors(): TopViewSensorsState | null };
};
const props = (page: Page) => page.evaluate(() => (window as unknown as { __readers: Readers }).__readers.props.readArenaProps());
const tags = (page: Page) => page.evaluate(() => (window as unknown as { __readers: Readers }).__readers.tags.readZoneTags());
const overlay = (page: Page) => page.evaluate(() => (window as unknown as { __readers: Readers }).__readers.overlay.readSensorOverlay());
const map = (page: Page) => page.evaluate(() => (window as unknown as { __readers: Readers }).__readers.map.readTopViewGripper());
const mapSensors = (page: Page) => page.evaluate(() => (window as unknown as { __readers: Readers }).__readers.mapSensors.readTopViewSensors());

/**
 * The free camera's distance from what it looks at (m, the canvas's dev `data-camera`) once it stops moving: the same value three reads
 * running, two animation frames between the reads of each (as robot-lab-a11y.spec.ts waits for a glide's end).
 */
async function settledDistance(page: Page) {
  const read = async () => (await page.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera')) ?? '';
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await read();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const later = await read();
        const same = later !== '' && now === later && now === last;
        last = later;
        return same;
      },
      { timeout: 30_000, intervals: [300] },
    )
    .toBe(true);
  return Number(last.split(' ')[0]);
}

/** What a card shows of its goals: the id, whether it passed, its label, its points and the reasons under it. */
const goalLines = (page: Page) =>
  page.locator('[data-testid=robot-check-goals] > li').evaluateAll((items) =>
    items.map((item) => ({
      id: item.getAttribute('data-goal'),
      passed: item.getAttribute('data-passed'),
      label: item.querySelector('.robot-check-goal-label')?.firstChild?.textContent ?? null,
      points: item.querySelector('.robot-check-points')?.textContent ?? null,
      why: [...item.querySelectorAll('.robot-check-why')].map((why) => why.textContent),
    })),
  );
const rounds = (page: Page) =>
  page.locator('[data-testid=robot-check-rounds] > li').evaluateAll((items) => items.map((item) => ({ round: item.getAttribute('data-round'), passed: item.getAttribute('data-passed'), hash: item.getAttribute('data-world-hash'), replay: item.querySelector('button') !== null })));

/** Kiểm tra at `speed`, until its card is there. */
async function check(page: Page, speed: 'fast' | '4x') {
  await page.getByTestId('robot-check-results').waitFor({ state: 'detached' }).catch(() => undefined);
  await page.locator(`[data-testid=robot-check-speed] [data-speed="${speed}"]`).click();
  await page.getByTestId('robot-check-start').click();
  await page.getByTestId('robot-check-results').waitFor({ timeout: 180_000 });
}
const closeCard = async (page: Page) => {
  await page.getByTestId('robot-check-close').click();
  await expect(page.getByTestId('robot-check-results')).toHaveCount(0);
};

/** The card of the rb-grip-pick reference: passed, 100/100, its three goals (the points are the scenario's: 40 + 45 + 15). */
async function expectPickPassed(page: Page) {
  await expect(page.getByTestId('robot-check-verdict')).toHaveText('Đạt');
  await expect(page.getByTestId('robot-check-score')).toHaveText('100/100 điểm');
  expect(await goalLines(page)).toEqual([
    { id: 'grab-cube', passed: 'true', label: 'Gắp và nhấc khối lên', points: '40 điểm', why: [] },
    { id: 'place-cube', passed: 'true', label: 'Đặt khối vào vùng thả', points: '45 điểm', why: [] },
    { id: 'no-crash', passed: 'true', label: 'Không chạm tường', points: '15 điểm', why: [] },
  ]);
  expect((await rounds(page)).map(({ round, passed, replay }) => [round, passed, replay])).toEqual([
    ['1', 'true', false],
    ['2', 'true', false],
    ['3', 'true', false],
  ]);
}

/** The card of the program that pushes the cube: 15/100, and the reasons in Vietnamese plan 4.5 gives. */
async function expectPickPushed(page: Page) {
  await expect(page.getByTestId('robot-check-verdict')).toHaveText('Chưa đạt');
  await expect(page.getByTestId('robot-check-score')).toHaveText('15/100 điểm');
  const goals = await goalLines(page);
  expect(goals.map(({ id, passed, label, points }) => ({ id, passed, label, points }))).toEqual([
    { id: 'grab-cube', passed: 'false', label: 'Gắp và nhấc khối lên', points: '40 điểm' },
    { id: 'place-cube', passed: 'false', label: 'Đặt khối vào vùng thả', points: '45 điểm' },
    { id: 'no-crash', passed: 'true', label: 'Không chạm tường', points: '15 điểm' },
  ]);
  expect(goals[0]!.why).toEqual(['Xe chưa gắp giữ được khối vàng ở lượt 1', 'Xe chưa gắp giữ được khối vàng ở lượt 2', 'Xe chưa gắp giữ được khối vàng ở lượt 3']);
  // The cube was pushed, not picked up: the moment is the run's (a number of this engine), the sentence is plan 4.5's.
  expect(goals[1]!.why).toHaveLength(3);
  goals[1]!.why.forEach((why, i) => expect(why).toMatch(new RegExp(`^Khối vàng bị đẩy chứ không được gắp lúc \\d+,\\d s ở lượt ${i + 1}$`)));
  expect(goals[2]!.why).toEqual([]);
  expect((await rounds(page)).map(({ round, passed, replay }) => [round, passed, replay])).toEqual([
    ['1', 'false', true],
    ['2', 'false', true],
    ['3', 'false', true],
  ]);
}

test.describe('the gripper lab on the real lessons (N19 E10)', () => {
  test('Chạy rb-grip-pick’s reference: the chip “Đang giữ: khối vàng” comes and goes, the lab says the grab and the release, the cube ends in the drop zone', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'draws the 3D scene');
    const errors = collectErrors(page);
    await openLesson(page, 'rb-grip-pick');
    await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'reference'));
    await expect(page.getByTestId('robot-held')).toHaveCount(0);
    await record(page);
    await page.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
    await page.getByTestId('robot-run').click();
    await expect(page.getByTestId('robot-status')).toHaveText('Chương trình đã chạy xong', { timeout: 120_000 });
    // The lab says a grab at most once in 1.5 s, and a release that comes inside that window when the window ends: at 4× the run can be over
    // by then, so the release may come after the run's end (lab-announcements.ts, GRIP_INTERVAL_MS): wait for both.
    await expect.poll(async () => (await recorded(page)).said, { timeout: 30_000 }).toEqual(expect.arrayContaining(['Chương trình đã chạy xong.', 'Đã thả khối vàng.']));
    const { chips, said } = await recorded(page);
    // The chip: not there, there with the cube's name, gone.
    expect(chips).toEqual([null, 'Đang giữ: khối vàng', null]);
    await expect(page.getByTestId('robot-held')).toHaveCount(0);
    // The lab says the run's start, the grab, then the release and the run's end (in either order, as above), once each.
    expect(said.slice(0, 2)).toEqual(['Đã bắt đầu chạy.', 'Đã gắp khối vàng.']);
    expect(said.slice(2).sort()).toEqual(['Chương trình đã chạy xong.', 'Đã thả khối vàng.']);
    expect(grabbed(said)).toEqual(['Đã gắp khối vàng.', 'Đã thả khối vàng.']);
    // The cube is not held and lies in the drop zone (x 108..148, y 25..65 in rb-grip-pick.json).
    const ended = (await world(page))!;
    expect(ended.status).toBe('finished');
    expect(ended.robot.gripper!.heldId).toBeNull();
    const drop = (JSON.parse(readFileSync('src/samples/robot-scenarios/rb-grip-pick.json', 'utf8')) as { arena: { paint: { zones: { id: string; polygonCm: [number, number][] }[] } } }).arena.paint.zones.find((zone) => zone.id === 'drop')!.polygonCm;
    const [xs, ys] = [drop.map(([x]) => x), drop.map(([, y]) => y)];
    const cube = ended.objects.find((object) => object.id === 'cube')!.pose;
    expect(cube.xCm).toBeGreaterThan(Math.min(...xs));
    expect(cube.xCm).toBeLessThan(Math.max(...xs));
    expect(cube.yCm).toBeGreaterThan(Math.min(...ys));
    expect(cube.yCm).toBeLessThan(Math.max(...ys));
    // N19 final fix (G2 I1): the lesson has no colour block, so the program never begins the colour sensor: the sensors' tag says the IR
    // alone, with no "Màu" line, in 3D and on the 2D map.
    await installReaders(page);
    await expect.poll(async () => (await overlay(page))?.gripper?.label, { timeout: 30_000 }).toEqual([expect.stringMatching(/^IR: /)]);
    await page.getByTestId('robot-viewmode').click();
    await page.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await map(page))?.label?.lines, { timeout: 30_000 }).toEqual([expect.stringMatching(/^IR: /)]);
    expect(errors).toEqual([]);
  });

  test('Kiểm tra Nhanh: the reference passes with 100/100 and its three goals; a program that pushes the cube gets 15/100 and the reasons in Vietnamese', async ({ page }) => {
    const errors = collectErrors(page);
    await openLesson(page, 'rb-grip-pick', false);
    await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'reference'));
    await check(page, 'fast');
    await expectPickPassed(page);
    await closeCard(page);
    await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'push-in'));
    await check(page, 'fast');
    await expectPickPushed(page);
    expect(errors).toEqual([]);
  });

  test('Kiểm tra at 4×: nothing is said of a grab or a release, Lái tay is not offered and its keys do nothing: the rounds end in the worlds of a Kiểm tra without a key', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'draws the 3D scene');
    const errors = collectErrors(page);
    await openLesson(page, 'rb-grip-pick');
    await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'reference'));
    await record(page);
    await page.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await page.getByTestId('robot-check-start').click();
    // The check holds the lab: the tools (Lái tay among them) and the gripper's buttons are not there.
    await expect(page.getByTestId('robot-check-round')).toHaveText('Lượt 1/3');
    await expect(page.getByTestId('robot-tool-teleop')).toHaveCount(0);
    await expect(page.getByTestId('robot-gripper-pad')).toHaveCount(0);
    // The keys, on the view and on the page, through the check's rounds.
    await page.locator('.robot-stage').focus();
    const sent = ['q', 'e', 'r', 'f'];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(sent[i % 4]!);
      await page.waitForTimeout(150);
    }
    await page.getByTestId('robot-check-results').waitFor({ timeout: 180_000 });
    await expectPickPassed(page);
    const keyed = (await rounds(page)).map((round) => round.hash);
    // A grab and a release happened in every round (the chip shows it), and the lab did not say a word of them.
    const { chips, said } = await recorded(page);
    expect(chips.filter((chip) => chip === 'Đang giữ: khối vàng').length).toBeGreaterThan(0);
    expect(said.length).toBeGreaterThan(0);
    expect(grabbed(said)).toEqual([]);
    expect(said.at(-1)).toBe('Kết quả kiểm tra: Đạt, 100/100 điểm');
    // The same check with no key at all ends each round in the same world.
    await closeCard(page);
    await check(page, 'fast');
    expect((await rounds(page)).map((round) => round.hash)).toEqual(keyed);
    expect(keyed.every((hash) => typeof hash === 'string' && hash.length > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Lái tay on a lesson: Q opens the claw, E closes it, R raises the arm and F lowers it', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'draws the 3D scene');
    const errors = collectErrors(page);
    await openLesson(page, 'rb-grip-pick');
    await page.getByTestId('robot-tool-teleop').click();
    await expect(page.getByTestId('robot-status')).toHaveText('Đang lái tay');
    await expect.poll(async () => (await world(page))?.status, { timeout: 60_000 }).toBe('running');
    await expect(page.getByTestId('robot-gripper-pad')).toBeVisible();
    await page.locator('.robot-stage').focus();
    // setup(): the claw open (D9 0°), the arm up (D10 90°).
    await expect.poll(async () => (await world(page))!.robot.gripper!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(89);
    expect((await world(page))!.robot.gripper!.clawDeg).toBeLessThan(1);
    // F lowers the arm 15° a press, R raises it as much.
    await page.keyboard.press('f');
    await page.keyboard.press('f');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(60);
    await expect.poll(async () => (await world(page))!.robot.gripper!.liftDeg, { timeout: 60_000 }).toBeLessThan(60.5);
    expect((await world(page))!.robot.gripper!.liftDeg).toBeGreaterThan(59.5);
    await page.keyboard.press('r');
    await expect.poll(() => servo(page, 'D10'), { timeout: 60_000 }).toBe(75);
    await expect.poll(async () => (await world(page))!.robot.gripper!.liftDeg, { timeout: 60_000 }).toBeGreaterThan(74.5);
    // E closes the claw on nothing, all the way (D9 80°); Q opens it.
    await page.keyboard.press('e');
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(80);
    await expect.poll(async () => (await world(page))!.robot.gripper!.clawDeg, { timeout: 60_000 }).toBeGreaterThan(70);
    await page.keyboard.press('q');
    await expect.poll(() => servo(page, 'D9'), { timeout: 60_000 }).toBe(0);
    await expect.poll(async () => (await world(page))!.robot.gripper!.clawDeg, { timeout: 60_000 }).toBeLessThan(5);
    expect(errors).toEqual([]);
  });

  test('the LMS’s lab frame at 1440 × 900 (1022 × 582): every gripper lesson keeps its run’s controls and Kiểm tra on one row, a long title shortened, its whole text in a popover the keyboard and a tap open (G1 c2, minor round m1)', async ({ page, browser }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1022, height: 582 });
    const rows: [string, boolean, boolean, string | null][] = [];
    for (const key of ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'] as const) {
      await openLesson(page, key, false);
      const [run, check] = [await page.getByTestId('robot-run').boundingBox(), await page.getByTestId('robot-check').boundingBox()];
      const title = page.getByTestId('robot-scenario');
      const shortened = await title.evaluate((element) => element.scrollWidth > element.clientWidth);
      rows.push([key, Math.abs(run!.y - check!.y) < 4, shortened, await title.getAttribute('tabindex')]);
    }
    // Shortened, a title is a Tab stop; one that fits is not.
    expect(rows).toEqual([
      ['rb-grip-pick', true, false, null],
      ['rb-grip-deliver', true, true, '0'],
      ['rb-grip-sort', true, true, '0'],
      ['rb-grip-stack', true, false, null],
    ]);
    // The keyboard: Tab reaches the title before Chạy; its popover shows the whole title, on the page and not under the view; Esc hides it.
    await openLesson(page, 'rb-grip-sort', false);
    const full = page.getByTestId('robot-scenario-full');
    await expect(full).toBeHidden();
    await page.getByTestId('robot-run').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('robot-scenario')).toBeFocused();
    await expect(full).toBeVisible();
    await expect(full).toHaveText('Phân loại theo màu');
    // Under the title, inside the window, and over whatever it covers (the element at its corner is itself).
    const [box, heading] = [await full.boundingBox(), await page.getByTestId('robot-scenario').boundingBox()];
    expect(box!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1022);
    expect(await full.evaluate((element) => document.elementFromPoint(element.getBoundingClientRect().left + 4, element.getBoundingClientRect().top + 4) === element)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(full).toBeHidden();
    await page.getByTestId('robot-run').focus();
    await expect(full).toBeHidden();
    // A tap (a touch screen): the title takes the focus and its popover shows.
    const touch = await browser.newContext({ viewport: { width: 1022, height: 582 }, hasTouch: true });
    const tablet = await touch.newPage();
    await openLesson(tablet, 'rb-grip-deliver', false);
    await tablet.getByTestId('robot-scenario').tap();
    await expect(tablet.getByTestId('robot-scenario-full')).toBeVisible();
    await expect(tablet.getByTestId('robot-scenario-full')).toHaveText('Giao hàng theo vạch');
    await touch.close();
    expect(errors).toEqual([]);
  });

  test('Lái tay in the LMS’s lab frame at 1366 × 768 (948 × 450): the free camera stays within 1.5 × its distance with Lái tay off, the robot beside the pad (G1 M1: it went 8.4 m away)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'draws the 3D scene');
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 948, height: 450 });
    for (const key of ['rb-grip-pick', 'rb-grip-sort'] as const) {
      await openLesson(page, key);
      // The short view G1 measured at this size (569 × 368): the pad with the gripper's column reaches past its middle.
      expect(Math.round((await page.getByTestId('robot-scene').boundingBox())!.height)).toBeLessThanOrEqual(400);
      const off = await settledDistance(page);
      await page.getByTestId('robot-tool-teleop').click();
      await expect(page.getByTestId('robot-gripper-pad')).toBeVisible();
      const on = await settledDistance(page);
      expect(on, key).toBeLessThanOrEqual(1.5 * off);
      expect(on, key).not.toBe(off);
    }
    expect(errors).toEqual([]);
  });

  test('Xem lại lượt 2 and 3 of rb-grip-sort: the 2D map, the 3D prop, the tag, the chip and the lit zone are the round’s colour; the 2D map’s cube marks are red’s stripes, green’s grid, blue’s dots', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'draws the 3D scene');
    test.setTimeout(360_000);
    const errors = collectErrors(page);
    await openLesson(page, 'rb-grip-sort');
    await installReaders(page);
    await record(page);
    const cube = async () => ({ prop: (await props(page))?.find((entry) => entry.id === 'cube')?.shown, tag: (await tags(page))?.find((tag) => tag.id === 'cube')?.text, zone: (await overlay(page))?.zone });

    // Before any run: round 1's colour, the arena's own, green, with its grid on the 2D map.
    await expect.poll(cube, { timeout: 30_000 }).toEqual({ prop: ['#388e3c'], tag: 'Khối xanh lá', zone: 'green-zone' });
    await page.getByTestId('robot-viewmode').click();
    await page.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await map(page))?.objects, { timeout: 30_000 }).toEqual([{ id: 'cube', fill: '#388e3c', mark: 'grid' }]);
    await page.getByTestId('robot-viewmode').click();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    // The pattern table for the zones the lesson names (zone-pattern.ts `zonePatternOf`, what ground-paint.ts paints the map's zones from): this checks
    // the table, not the map's pixels or any state of its zones; the 2D map's own state is checked below through the cube's fill and mark.
    const zonePatterns = await page.evaluate(async () => {
      const { zonePatternOf } = (window as unknown as { __readers: { zonePattern: typeof import('../src/ui/robot3d/zone-pattern') } }).__readers.zonePattern;
      return Object.fromEntries((['red', 'green', 'blue'] as const).map((name) => [name, zonePatternOf({ kind: 'target', name })]));
    });
    expect(zonePatterns).toEqual({
      red: { kind: 'hatch', anglesDeg: [0], spacingCm: 2.6, widthCm: 0.32 },
      green: { kind: 'hatch', anglesDeg: [0, 90], spacingCm: 3.2, widthCm: 0.32 },
      blue: { kind: 'dots', spacingCm: 4.4, radiusCm: 0.9 },
    });

    // The reference with its turns swapped: green goes straight on (round 1 passes), red goes to blue's zone and blue to red's.
    await loadProgram(page, 'rb-grip-sort', withTurnsSwapped(programOf('rb-grip-sort', 'reference')));
    await check(page, 'fast');
    await expect(page.getByTestId('robot-check-score')).toHaveText('40/100 điểm');
    expect((await rounds(page)).map(({ round, passed, replay }) => [round, passed, replay])).toEqual([
      ['1', 'true', false],
      ['2', 'false', true],
      ['3', 'false', true],
    ]);
    expect((await goalLines(page))[1]!.why).toEqual(['Khối đỏ nằm ở vùng xanh dương ở lượt 2', 'Khối xanh dương nằm ở vùng đỏ ở lượt 3']);

    for (const round of [
      { n: 2, color: 'red', hex: '#d32f2f', mark: 'stripes', tag: 'Khối đỏ', chip: 'Đang giữ: khối đỏ', zone: 'red-zone' },
      { n: 3, color: 'blue', hex: '#1976d2', mark: 'dots', tag: 'Khối xanh dương', chip: 'Đang giữ: khối xanh dương', zone: 'blue-zone' },
    ]) {
      await test.step(`Xem lại lượt ${round.n} (${round.color})`, async () => {
        // A replay folds the card to its verdict (it is there to be opened again): unfold it for the next round's button.
        if ((await page.getByTestId('robot-check-results').getAttribute('data-open')) === 'false') await page.getByTestId('robot-check-fold').click();
        await page.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
        const before = (await recorded(page)).chips.length;
        await page.getByTestId(`robot-check-replay-${round.n}`).click();
        await expect(page.getByTestId('robot-status')).toHaveText('Chương trình đã chạy xong', { timeout: 180_000 });
        // The chip named the cube in this round's colour while the car held it.
        const chips = (await recorded(page)).chips.slice(before - 1);
        expect(chips).toEqual([null, round.chip, null]);
        // 3D, from the scene's state: the prop in this round's colour, the cube's tag naming it so, the goal's zone lit.
        await expect.poll(cube, { timeout: 30_000 }).toEqual({ prop: [round.hex], tag: round.tag, zone: round.zone });
        // 2D: the cube's fill and mark, the zone lit for the goal.
        await page.getByTestId('robot-viewmode').click();
        await page.getByTestId('robot-topview').waitFor();
        await expect.poll(async () => (await map(page))?.objects, { timeout: 30_000 }).toEqual([{ id: 'cube', fill: round.hex, mark: round.mark }]);
        await expect.poll(async () => (await mapSensors(page))?.zone, { timeout: 30_000 }).toBe(round.zone);
        expect((await map(page))!.zoneLabels).toEqual(['Xuất phát', 'Vùng đỏ', 'Vùng xanh lá', 'Vùng xanh dương']);
        // Back to the 3D view for the next round.
        await page.getByTestId('robot-viewmode').click();
        await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
      });
    }

    expect(errors).toEqual([]);
  });

  for (const browserName of ['chromium', 'firefox'] as const) {
    test(`no WebGL (${browserName}): the 2D map draws the jaws closed on the cube and the ring round it, and Kiểm tra still works (Review Focus 5)`, async ({ baseURL, browserName: running }) => {
      test.skip(running !== browserName, `runs in ${browserName}`);
      let browser: Browser | null = null;
      try {
        browser = browserName === 'chromium' ? await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] }) : await firefox.launch({ firefoxUserPrefs: { 'webgl.disabled': true } });
        const page = await (await browser.newContext({ baseURL: baseURL ?? '', viewport: { width: 1280, height: 720 } })).newPage();
        const errors = collectErrors(page);
        await openLesson(page, 'rb-grip-pick', false);
        expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'))).toBeNull();
        await expect(page.getByTestId('robot-topview')).toHaveAttribute('data-reason', 'no-webgl', { timeout: 60_000 });
        await expect(page.getByTestId('robot-canvas')).toHaveCount(0);
        await installReaders(page);
        // Before the run: the gripper as setup() leaves it (arm up, claw open), the cube lying there, no ring.
        await expect.poll(async () => (await map(page))?.gripper?.liftDeg, { timeout: 30_000 }).toBe(90);
        expect((await map(page))!.gripper).toMatchObject({ heldId: null });
        expect((await map(page))!.gripper!.jaws.map((jaw) => jaw.side)).toEqual([1, -1]);
        expect((await map(page))!.objects).toEqual([{ id: 'cube', fill: '#fbc02d', mark: null }]);
        // Chạy the reference: a sampler on the page's frames keeps what the map shows of the jaws and the ring whenever it changes.
        await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'reference'));
        await page.evaluate(() => {
          const read = (window as unknown as { __readers: Readers }).__readers.map.readTopViewGripper;
          const samples: { heldId: string | null; ring: boolean; jaws: number[]; held: { xCm: number; yCm: number } | null }[] = [];
          (window as unknown as { __samples: typeof samples }).__samples = samples;
          let last = '';
          const sample = () => {
            const state = read();
            if (state?.gripper) {
              const entry = { heldId: state.gripper.heldId, ring: state.held?.visible === true, jaws: state.gripper.jaws.map((jaw) => Math.round(jaw.turnDeg)), held: state.held?.visible ? { xCm: state.held.xCm, yCm: state.held.yCm } : null };
              const key = JSON.stringify([entry.heldId, entry.ring, entry.jaws]);
              if (key !== last) samples.push(entry);
              last = key;
            }
            requestAnimationFrame(sample);
          };
          sample();
        });
        await record(page);
        await page.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
        await page.getByTestId('robot-run').click();
        await expect(page.getByTestId('robot-status')).toHaveText('Chương trình đã chạy xong', { timeout: 120_000 });
        await expect.poll(async () => (await recorded(page)).said, { timeout: 30_000 }).toEqual(expect.arrayContaining(['Chương trình đã chạy xong.', 'Đã thả khối vàng.']));
        expect((await recorded(page)).chips).toEqual([null, 'Đang giữ: khối vàng', null]);
        const samples = await page.evaluate(() => (window as unknown as { __samples: { heldId: string | null; ring: boolean; jaws: number[]; held: { xCm: number; yCm: number } | null }[] }).__samples);
        // The jaws opened wide (12° each way) at setup(), closed on the cube (turned in from 12°) with the ring round it while held, and let go.
        const heldNow = samples.filter((sample) => sample.heldId === 'cube' && sample.ring);
        expect(heldNow.length).toBeGreaterThan(0);
        expect(heldNow.some((sample) => Math.abs(sample.jaws[0]!) < 12 && Math.abs(sample.jaws[1]!) < 12 && sample.jaws[0] === -sample.jaws[1]!)).toBe(true);
        expect(samples[0]).toMatchObject({ heldId: null, ring: false, jaws: [12, -12] });
        expect(samples.at(-1)).toMatchObject({ heldId: null, ring: false });
        // The cube ended in the drop zone (x 108..148): the map's cube moved with the car.
        const ended = (await world(page))!;
        expect(ended.robot.gripper!.heldId).toBeNull();
        expect(ended.objects.find((object) => object.id === 'cube')!.pose.xCm).toBeGreaterThan(108);
        // Kiểm tra Nhanh works as with the 3D view.
        await check(page, 'fast');
        await expectPickPassed(page);
        await closeCard(page);
        await loadProgram(page, 'rb-grip-pick', programOf('rb-grip-pick', 'push-in'));
        await check(page, 'fast');
        await expectPickPushed(page);
        expect(errors).toEqual([]);
      } finally {
        await browser?.close();
      }
    });
  }
});
