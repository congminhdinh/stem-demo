import { expect, test, type Page } from '@playwright/test';
import {
  acceleration, add, buttonPresses, buttonPressed, clearDisplay, clearPixel, cmp, colour, gestureIs, getVar, ifElif, ifThen, images, legacyShowImage,
  lightLevel, num, playMelody, playNote, playPitch, print, program, randomInt, rest, runningTime, scrollNumber, scrollText, scrollTextIn, setAll, setPixel,
  setVar, showIcon, showImage, showImageIn, stopSound, temperature, text, wait, type ImageRows,
} from '../src/core/program/__fixtures__/ybc-blocks';
import { canvasState, currentProject, expectSaved, openApp, openProject, readJson } from './helpers';

// YB-3 (YB plan §14 lessons B1-B4, §18.4): a Yolo:Bit-compatible project drives the onboard display, buttons, light sensor
// and buzzer. The tests read what the canvas RENDERED (the Konva nodes, plan §11.4) and what the controls show, never the
// store. The run is the only source of what the board does; a control only sends an input to it. Opened through the
// dev-only hook, as a stored document would arrive (there is no New for these projects until YB-6).

const ybcBoard = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } };
/** The builders leave the hats without a place; Blockly saves one, so give them what it would, and a reload compares equal. */
const placed = (blocks: unknown) => {
  const workspace = blocks as { blocks: { blocks: Record<string, unknown>[] } };
  return { ...workspace, blocks: { ...workspace.blocks, blocks: workspace.blocks.blocks.map((block) => ({ x: 0, y: 0, ...block })) } };
};
const project = (blocks: unknown, profile = 'ybc-basic') => ({
  schemaVersion: 1,
  id: `ybc-hardware-${profile}`,
  name: 'Hardware',
  profile,
  circuit: { components: [ybcBoard], wires: [] },
  program: { blocks: placed(blocks) },
});

const runStatus = (page: Page) => page.getByTestId('run-status');
const consoleLines = (page: Page) => page.getByTestId('console-lines');
const blank: ImageRows = ['00000', '00000', '00000', '00000', '00000'];

/** The five rows of the display as the canvas drew it: '1' for a lit light, '0' for one that is off. */
async function displayRows(page: Page): Promise<string[] | undefined> {
  const cells = (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board')?.display;
  return cells && Array.from({ length: 5 }, (_, row) => cells.slice(row * 5, row * 5 + 5).map((cell) => (cell === null ? '0' : '1')).join(''));
}
const expectDisplay = (page: Page, rows: readonly string[], timeout = 5_000) =>
  expect.poll(() => displayRows(page), { timeout }).toEqual([...rows]);

/**
 * Waits for the sound indicator to say `text`. `toHaveText` polls less and less often (100, 250, 500, 1000 ms), and a
 * note lasts only 250-500 ms, so a fixed fine interval is what makes a short state certain to be seen.
 */
const expectSounding = (page: Page, text: string) =>
  expect.poll(() => page.getByTestId('sound-indicator').textContent(), { intervals: [25], timeout: 8_000 }).toBe(text);

const run = (page: Page) => page.getByRole('button', { name: 'Run' }).click();
const stop = (page: Page) => page.getByRole('button', { name: 'Stop' }).click();

/** Holds a control with the mouse until `release` is called. */
async function holdWithMouse(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`${testId} is not visible`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  return () => page.mouse.up();
}

test.describe('P1 (B1): a picture of its own, then a text', () => {
  test('shows the ring, waits, scrolls "Hi" across and ends on an empty display', async ({ page }) => {
    await openProject(page, project(program([showImage(images.RING), wait(num(1000)), scrollText(text('Hi'))])));
    await expectDisplay(page, blank);

    await run(page);

    // Lit lights are red, and the cell at column x, row y is where the picture put it.
    await expectDisplay(page, images.RING);
    expect((await canvasState(page)).components.find((c) => c.deviceType === 'ybc-board')?.display?.[0]).toBe('#FF0000');
    await expect(page.getByTestId('display-text')).toHaveText(['#####', '#...#', '#...#', '#...#', '#####'].join('\n'));

    // The text scrolls: the picture is replaced, then at the end the display is empty and the program is done.
    await expect.poll(() => displayRows(page), { timeout: 5_000 }).not.toEqual([...images.RING]);
    await expect(runStatus(page)).toHaveText('Program finished — board powered', { timeout: 10_000 });
    await expectDisplay(page, blank);
    await stop(page);
    await expect(runStatus(page)).toHaveText('Idle');
    await expectDisplay(page, blank);
  });

  test('scrolls a number, and keeps a one-character text still', async ({ page }) => {
    await openProject(page, project(program([scrollText(text('A')), wait(num(100)), scrollNumber(num(7))])));

    await run(page);

    // 'A' stays at once; the digit 7 stays too (a single character does not scroll).
    await expect.poll(() => displayRows(page)).not.toEqual([...blank]);
    await expect(runStatus(page)).toHaveText('Program finished — board powered');
    await expect(page.getByTestId('display-text')).toHaveText(['#####', '....#', '...#.', '..#..', '..#..'].join('\n'));
    await stop(page);
  });
});

test.describe('P2 (B3): buttons A and B change the picture', () => {
  const buttons = program([], [ifElif([[buttonPressed('A'), [showImage(images.CROSS)]], [buttonPressed('B'), [showImage(images.RING)]]], [clearDisplay()])]);

  test('polls the buttons: held with the mouse the picture follows, released it clears', async ({ page }) => {
    await openProject(page, project(buttons));
    await expect(page.getByTestId('control-button-a')).toBeDisabled();

    await run(page);
    await expect(page.getByTestId('control-button-a')).toBeEnabled();
    await expectDisplay(page, blank);

    const releaseA = await holdWithMouse(page, 'control-button-a');
    await expectDisplay(page, images.CROSS);
    await expect(page.getByTestId('control-button-a')).toHaveAttribute('aria-pressed', 'true');
    await releaseA();
    await expectDisplay(page, blank);
    await expect(page.getByTestId('control-button-a')).toHaveAttribute('aria-pressed', 'false');

    const releaseB = await holdWithMouse(page, 'control-button-b');
    await expectDisplay(page, images.RING);
    await releaseB();
    await expectDisplay(page, blank);
    await stop(page);
  });

  test('is operable from the keyboard: Space holds the focused button, key repeat does not release it', async ({ page }) => {
    await openProject(page, project(buttons));
    await run(page);

    await page.getByTestId('control-button-a').focus();
    await page.keyboard.down('Space');
    await page.keyboard.down('Space'); // a repeating key
    await expectDisplay(page, images.CROSS);
    await page.keyboard.up('Space');
    await expectDisplay(page, blank);

    await page.getByTestId('control-button-b').focus();
    await page.keyboard.down('Enter');
    await expectDisplay(page, images.RING);
    await page.keyboard.up('Enter');
    await expectDisplay(page, blank);
    await stop(page);
  });

  test('releases a held button when focus leaves it, so it never sticks', async ({ page }) => {
    await openProject(page, project(buttons));
    await run(page);

    await page.getByTestId('control-button-a').focus();
    await page.keyboard.down('Space');
    await expectDisplay(page, images.CROSS);
    await page.getByTestId('control-button-b').focus();
    await expectDisplay(page, blank);
    await page.keyboard.up('Space');
    await stop(page);
  });

  test('gives the controls nothing to do before Run and after Stop', async ({ page }) => {
    await openProject(page, project(buttons));
    for (const id of ['control-button-a', 'control-button-b', 'control-light']) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }
    await run(page);
    await stop(page);
    for (const id of ['control-button-a', 'control-button-b', 'control-light']) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }
    await expectDisplay(page, blank);
  });
});

test('P3 (B2): a picture blinks with show, wait and clear', async ({ page }) => {
  await openProject(page, project(program([], [showImage(images.DOT), wait(num(300)), clearDisplay(), wait(num(300))])));

  await run(page);

  // Three phases seen in order: on, off, on again.
  await expectDisplay(page, images.DOT);
  await expectDisplay(page, blank);
  await expectDisplay(page, images.DOT);
  await stop(page);
});

test.describe('P4 (B6): a night light on the light level', () => {
  const nightLight = program([], [ifThen(cmp('LT', lightLevel(), num(30)), [showImage(images.FULL)], [clearDisplay()])]);

  test('lights up when the slider goes below 30, and starts every run half way', async ({ page }) => {
    await openProject(page, project(nightLight));
    await run(page);

    const slider = page.getByTestId('control-light');
    await expect(slider).toHaveValue('50');
    await expectDisplay(page, blank);

    await slider.fill('10');
    await expect(page.getByTestId('control-light-value')).toHaveText('10');
    await expectDisplay(page, images.FULL);
    await slider.fill('80');
    await expectDisplay(page, blank);
    await slider.fill('29');
    await expectDisplay(page, images.FULL);
    await slider.fill('30');
    await expectDisplay(page, blank);

    // Inputs belong to a run: the next run is half way again, not where the slider was left.
    await slider.fill('5');
    await expectDisplay(page, images.FULL);
    await stop(page);
    await run(page);
    await expect(page.getByTestId('control-light')).toHaveValue('50');
    await expect(page.getByTestId('control-light-value')).toHaveText('50');
    await expectDisplay(page, blank);
    await stop(page);
  });
});

test.describe('get_presses (C-13)', () => {
  test('counts three clicks made during one wait, then starts again from 0', async ({ page }) => {
    await openProject(page, project(program([wait(num(1500)), print(buttonPresses('A')), print(buttonPresses('A'))])));
    await run(page);

    const buttonA = page.getByTestId('control-button-a');
    await buttonA.click();
    await buttonA.click();
    await buttonA.click();

    await expect(consoleLines(page)).toHaveText('3\n0', { timeout: 10_000 });
    await stop(page);
  });

  test('keeps A and B apart', async ({ page }) => {
    await openProject(page, project(program([wait(num(1200)), print(buttonPresses('B')), print(buttonPresses('A'))])));
    await run(page);

    await page.getByTestId('control-button-b').click();
    await page.getByTestId('control-button-b').click();
    await page.getByTestId('control-button-a').click();

    await expect(consoleLines(page)).toHaveText('2\n1', { timeout: 10_000 });
    await stop(page);
  });

  test('a counter that adds the presses of A shows the count once a click has come', async ({ page }) => {
    const counter = program(
      [setVar('x', num(0))],
      [setVar('x', add(getVar('x'), buttonPresses('A'))), ifThen(cmp('GT', getVar('x'), num(0)), [scrollNumber(getVar('x'))])],
    );
    await openProject(page, project(counter));
    await run(page);
    await expectDisplay(page, blank);

    await page.getByTestId('control-button-a').click();

    // The digit 1 of the project's own font.
    await expectDisplay(page, ['00100', '01100', '00100', '00100', '01110']);
    await stop(page);
  });
});

type AudioLog = { contexts: number; started: number[]; stopped: number; resumes: boolean[]; state: string | null };

/**
 * Counts what the page asks of the browser's audio, without replacing it (N17 B3: and every resume, with whether it came inside a
 * user gesture, and the state of the newest context). Blockly makes contexts of its own when it starts, so tests compare with what
 * the log says once the page is up.
 */
async function watchAudio(page: Page) {
  await page.addInitScript(() => {
    const log = { contexts: 0, started: [] as number[], stopped: 0, resumes: [] as boolean[] };
    const made: AudioContext[] = [];
    Object.assign(window, { __audioLog: log, __audioContexts: made });
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        log.contexts += 1;
        made.push(this);
      }
      override resume() {
        log.resumes.push(navigator.userActivation.isActive);
        return super.resume();
      }
      override createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          const stopNode = oscillator.stop.bind(oscillator);
        oscillator.start = (when?: number) => {
          log.started.push(oscillator.frequency.value);
          start(when);
        };
        oscillator.stop = (when?: number) => {
          log.stopped += 1;
          stopNode(when);
        };
        return oscillator;
      }
    };
  });
}
const audioLog = (page: Page): Promise<AudioLog> =>
  page.evaluate(() => {
    const { __audioLog: log, __audioContexts: made } = window as unknown as { __audioLog: Omit<AudioLog, 'state'>; __audioContexts: AudioContext[] };
    return { ...log, state: made.at(-1)?.state ?? null };
  });

test.describe('sound (C-50, C-51)', () => {
  // Each sound lasts long enough (250-500 ms) for the polling of the assertions to see it.
  const melody = program([playNote('C4', 4), rest(2), playNote('A4', 4), wait(num(100))]);

  test('is on from the start and starts with the click of Run, in that gesture: no other click; the text says each note, silent between and after', async ({ page }) => {
    await watchAudio(page);
    await openProject(page, project(melody));
    const indicator = page.getByTestId('sound-indicator');
    await expect(indicator).toHaveText('Silent');
    // On from the start (N17 B3); the label says what a click does and changes with the state, so there is no aria-pressed as well.
    const toggle = page.getByRole('button', { name: 'Turn sound off' });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveAttribute('aria-pressed');
    const before = await audioLog(page);

    await run(page);

    // The visual sign does not depend on sound being on: C4 is 262 Hz, then a rest, then A4 is 440 Hz.
    await expectSounding(page, 'Playing 262 Hz');
    expect((await canvasState(page)).components.find((c) => c.deviceType === 'ybc-board')?.tone).toBe(262);
    await expectSounding(page, 'Silent');
    await expectSounding(page, 'Playing 440 Hz');
    await expect(runStatus(page)).toHaveText('Program finished — board powered', { timeout: 10_000 });
    await expect(indicator).toHaveText('Silent');
    // One context for the buzzer, made and resumed inside the click of Run (the user activation the browser asks for), running,
    // and the two notes heard.
    const after = await audioLog(page);
    expect(after.contexts).toBe(before.contexts + 1);
    const resumes = after.resumes.slice(before.resumes.length);
    expect(resumes.length).toBeGreaterThan(0);
    expect(resumes.every((active) => active)).toBe(true);
    expect(after.state).toBe('running');
    expect(after.started).toEqual(expect.arrayContaining([262, 440]));
    await stop(page);
  });

  test('turned off with the switch, Run makes no sound while the text still says what plays; the choice stays for the tab', async ({ page }) => {
    await watchAudio(page);
    await openProject(page, project(melody));
    await page.getByRole('button', { name: 'Turn sound off' }).click();
    await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible();
    const before = await audioLog(page);

    await run(page);
    // It says what plays, and that it is not heard (Fix 6, N17 c6).
    await expectSounding(page, 'Playing 262 Hz (sound off)');
    await expectSounding(page, 'Playing 440 Hz (sound off)');
    await expect(runStatus(page)).toHaveText('Program finished — board powered', { timeout: 10_000 });
    const after = await audioLog(page);
    expect(after.contexts).toBe(before.contexts);
    expect(after.started).toEqual([]);
    await stop(page);

    // A reload of the tab keeps the choice (sessionStorage).
    await page.reload();
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    await page.evaluate((document) => window.__stem?.loadProject(document), project(melody));
    await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible();
  });

  test('plays at the tone of the note, and Stop silences it at once', async ({ page }) => {
    await watchAudio(page);
    await openProject(page, project(program([playNote('C4', 4), playNote('C4', 4), playNote('C4', 4)])));

    await run(page);
    await expect(page.getByTestId('sound-indicator')).toHaveText('Playing 262 Hz');
    await expect.poll(async () => (await audioLog(page)).started.at(-1)).toBe(262);

    const before = await audioLog(page);
    await stop(page);
    await expect(page.getByTestId('sound-indicator')).toHaveText('Silent');
    await expect(runStatus(page)).toHaveText('Idle');
    // Every oscillator that was started has been stopped, and none is started afterwards.
    await expect.poll(async () => (await audioLog(page)).stopped).toBeGreaterThanOrEqual(before.started.length);
    const after = await audioLog(page);
    await page.waitForTimeout(800);
    expect((await audioLog(page)).started).toEqual(after.started);
    expect((await canvasState(page)).components.find((c) => c.deviceType === 'ybc-board')?.tone).toBeUndefined();
  });

  test('a rest is silent', async ({ page }) => {
    await openProject(page, project(program([rest(4), wait(num(50))])));
    await run(page);
    await page.waitForTimeout(200);
    await expect(page.getByTestId('sound-indicator')).toHaveText('Silent');
    await stop(page);
  });
});

test.describe('the toolbox and the dropdowns', () => {
  const flyoutTexts = async (page: Page, category: string) => {
    const panel = page.getByTestId('blockly-panel');
    await panel.locator('.blocklyToolboxCategory', { hasText: category }).click();
    await panel.locator('.blocklyFlyout .blocklyText').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(200);
    return (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ').replaceAll(String.fromCharCode(0xa0), ' ');
  };

  for (const profile of ['ybc-basic', 'ybc-advanced']) {
    test(`${profile} offers the display, input and sound blocks and nothing excluded`, async ({ page }) => {
      await openProject(page, project(program([]), profile));

      const display = await flyoutTexts(page, 'Display');
      expect(display).toMatch(/show image/);
      expect(display).toMatch(/scroll text/);
      expect(display).toMatch(/scroll number/);
      expect(display).toMatch(/clear display/);
      // N17 B1: the RGB display, with the colour block red and the heart as the presets.
      expect(display).toMatch(/show icon \| heart/);
      expect(display).toMatch(/set light at column/);
      expect(display).toMatch(/turn off light at column/);
      expect(display).toMatch(/set all lights to/);
      expect(display).toMatch(/\bred\b/);
      expect(display).not.toMatch(/brightness|graph/i);

      const input = await flyoutTexts(page, 'Input');
      expect(input).toMatch(/is pressed/);
      expect(input).toMatch(/presses of button/);
      expect(input).toMatch(/light level/);
      expect(input).not.toMatch(/A\+B|running time/i);
      // N17 B2: the sensors of the Advanced board join its Input category; Basic has none of them.
      if (profile === 'ybc-advanced') {
        expect(input).toMatch(/temperature \(°C\)/);
        expect(input).toMatch(/acceleration \| x \| \(mg\)/);
        expect(input).toMatch(/gesture is \| shaken/);
        expect(input).toMatch(/gesture is \| tilted left/);
      } else {
        expect(input).not.toMatch(/shake|temperature|acceleration|gesture/i);
      }

      const sound = await flyoutTexts(page, 'Sound');
      expect(sound).toMatch(/play note/);
      expect(sound).toMatch(/rest for/);
      expect(sound).not.toMatch(/tempo/i);
      // N17 B3: the melodies, the tone and stop of Advanced join its Sound category; Basic has none of them.
      if (profile === 'ybc-advanced') {
        expect(sound).toMatch(/play melody \| Happy Birthday \| until done/);
        expect(sound).toMatch(/play melody \| jump up \| in the background/);
        expect(sound).toMatch(/start tone/);
        expect(sound).toMatch(/Hz for/);
        expect(sound).toMatch(/stop sound/);
      } else {
        expect(sound).not.toMatch(/pitch|tone|stop|melody/i);
      }
    });
  }

  test('offers the buttons A, B and (N17 B4) A+B, the 15 natural notes and the lengths 1, 2 and 4', async ({ page }) => {
    // Blockly does not open a dropdown inside the flyout, so the blocks are placed in the workspace.
    await openProject(page, project(program([ifThen(buttonPressed('A'), [playNote('C4', 4), rest(2)])])));
    const panel = page.getByTestId('blockly-panel');
    const optionsOf = async (current: RegExp) => {
      await panel.locator('.blocklyDropdownText', { hasText: current }).first().click();
      const options = await page.locator('.blocklyDropDownDiv .blocklyMenuItem').allInnerTexts();
      await page.keyboard.press('Escape');
      return options;
    };

    expect(await optionsOf(/^A$/)).toEqual(['A', 'B', 'A+B']);
    expect(await optionsOf(/^C4$/)).toEqual(['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
    expect(await optionsOf(/^4$/)).toEqual(['1', '2', '4']);
    expect(await optionsOf(/^2$/)).toEqual(['1', '2', '4']);
  });
});

// N17 B1: the RGB display. Colours, one light, all lights and the built-in pictures, read off what the canvas drew.
test.describe('the RGB display (N17 B1)', () => {
  /** The 25 colours the canvas drew, '.' for a light that is off, row by row. */
  async function displayColours(page: Page): Promise<string[] | undefined> {
    const cells = (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board')?.display;
    return cells && Array.from({ length: 5 }, (_, row) => cells.slice(row * 5, row * 5 + 5).map((cell) => cell ?? '.').join(' '));
  }
  const B = '#0000FF';
  const G = '#00FF00';

  test('fills the display blue, lights one green light at column 2, row 3, then turns it off, then shows the heart', async ({ page }) => {
    await openProject(
      page,
      project(program([setAll(colour('#0000ff')), setPixel(num(2), num(3), colour('#00ff00')), wait(num(800)), clearPixel(num(2), num(3)), wait(num(800)), showIcon('HEART')])),
    );
    await run(page);
    await expect.poll(() => displayColours(page)).toEqual([`${B} ${B} ${B} ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`, `${B} ${B} ${G} ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`]);
    await expect.poll(() => displayColours(page)).toEqual([`${B} ${B} ${B} ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`, `${B} ${B} . ${B} ${B}`, `${B} ${B} ${B} ${B} ${B}`]);
    await expectDisplay(page, ['01010', '11111', '11111', '01110', '00100']);
    expect((await displayColours(page))?.join(' ').replaceAll('.', '').trim().split(/\s+/).every((cell) => cell === '#FF0000')).toBe(true);
    await stop(page);
    await expectDisplay(page, blank);
  });

  test('shows a picture in yellow and scrolls a green text; a picture saved before N17 is still red', async ({ page }) => {
    await openProject(page, project(program([showImageIn(images.CROSS, '#ffff00'), wait(num(600)), scrollTextIn(text('A'), colour('#00ff00')), wait(num(600)), legacyShowImage(images.DOT)])));
    await run(page);
    await expect.poll(async () => (await displayColours(page))?.[0]).toBe('#FFFF00 . . . #FFFF00');
    await expect.poll(async () => (await displayColours(page))?.[2]).toBe(`${G} ${G} ${G} ${G} ${G}`);
    await expect.poll(async () => (await displayColours(page))?.[2]).toBe('. . #FF0000 . .');
    await stop(page);
  });

  test('writes the Python of the RGB display: set_pixel, set_all, clear_pixel, Image.HEART, a palette digit and a coloured scroll', async ({ page }) => {
    await openProject(
      page,
      project(program([setPixel(num(2), num(3), colour('#00ff00')), setAll(colour('#0000ff')), clearPixel(num(0), num(0)), showIcon('HEART'), showImageIn(images.DOT, '#ffa500'), scrollTextIn(text('Hi'), colour('#ffff00'))])),
    );
    const source = page.getByTestId('python-source');
    await expect(source).toContainText("display.set_pixel(2, 3, '#00ff00')");
    await expect(source).toContainText("display.set_all('#0000ff')");
    await expect(source).toContainText('display.clear_pixel(0, 0)');
    await expect(source).toContainText('display.show(Image.HEART)');
    await expect(source).toContainText('display.show(Image("00000:00000:00200:00000:00000"))');
    await expect(source).toContainText("display.scroll('Hi', color='#ffff00')");
  });

  test('runs a stored colour that is not one in red, and says so as a warning, not an error', async ({ page }) => {
    // A program the editor did not write: Blockly itself would put red in the dropdown, so the warning comes from the compiler's reading of the document.
    await openProject(page, project(program([setAll({ ...colour('#00ff00'), fields: { COLOUR: 'red' } })])));
    await run(page);
    await expect.poll(async () => (await displayColours(page))?.[0]).toBe('#FF0000 #FF0000 #FF0000 #FF0000 #FF0000');
    await expect(runStatus(page)).not.toContainText(/error/i);
    await stop(page);
  });

  test('chooses another colour in the colour block of the workspace', async ({ page }) => {
    await openProject(page, project(program([setAll(colour('#ff0000'))])));
    await page.getByTestId('blockly-panel').locator('.blocklyDropdownText', { hasText: 'red' }).first().click();
    const options = await page.locator('.blocklyDropDownDiv .blocklyMenuItem').allInnerTexts();
    expect(options).toEqual(['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple', 'white']);
    await page.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'purple' }).click();
    await run(page);
    await expect.poll(async () => (await displayColours(page))?.[4]).toBe('#800080 #800080 #800080 #800080 #800080');
    await stop(page);
    await expect(page.getByTestId('python-source')).toContainText("display.set_all('#800080')");
  });
});

// N17 B2: the temperature sensor and the accelerometer of the Advanced board. The controls send what the board senses; the board
// writes it under the display while a run is on; the program reads it. Read off what the canvas drew and what the controls show.
test.describe('the sensors of the Advanced board (N17 B2)', () => {
  const advanced = (blocks: unknown) => project(blocks, 'ybc-advanced');
  const boardState = async (page: Page) => (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board');
  const gesture = (page: Page) => page.getByTestId('control-accelerometer-gesture');

  test('the temperature slider (−10..50 °C, 25 °C at the start): the program reads it, the board writes it under the display', async ({ page }) => {
    await openProject(page, advanced(program([], [ifThen(cmp('GT', temperature(), num(30)), [showImage(images.FULL)], [clearDisplay()])])));
    const slider = page.getByTestId('control-temperature');
    await expect(slider).toBeDisabled();
    expect((await boardState(page))?.temperature).toBeUndefined();

    await run(page);
    await expect(slider).toBeEnabled();
    await expect(slider).toHaveAttribute('min', '-10');
    await expect(slider).toHaveAttribute('max', '50');
    await expect(page.getByTestId('control-temperature-value')).toHaveText('25 °C');
    await expect.poll(async () => (await boardState(page))?.temperature).toBe(25);
    await expectDisplay(page, blank);

    await slider.fill('35');
    await expect(page.getByTestId('control-temperature-value')).toHaveText('35 °C');
    await expectDisplay(page, images.FULL);
    await expect.poll(async () => (await boardState(page))?.temperature).toBe(35);
    await slider.fill('-5');
    await expectDisplay(page, blank);
    await stop(page);
    // Readings belong to the run: none is drawn once it is stopped, and the next run starts at 25 °C again.
    await expect.poll(async () => (await boardState(page))?.temperature).toBeUndefined();
    await run(page);
    await expect(page.getByTestId('control-temperature-value')).toHaveText('25 °C');
    await stop(page);
  });

  test('the tilt pad: the arrow keys and a drag tilt the board, the gesture is named, and the program sees it', async ({ page }) => {
    await openProject(
      page,
      advanced(program([], [ifElif([[gestureIs('tilt_left'), [showImage(images.CROSS)]], [gestureIs('logo_down'), [showImage(images.RING)]]], [clearDisplay()])])),
    );
    await run(page);
    await expect(gesture(page)).toHaveText('Face up');
    await expect.poll(async () => (await boardState(page))?.acceleration).toEqual({ x: 0, y: 0, z: -1024 });

    const pad = page.getByTestId('control-accelerometer');
    await pad.focus();
    for (let press = 0; press < 4; press++) {
      await page.keyboard.press('ArrowLeft');
    }
    await expect(gesture(page)).toHaveText('Tilted left');
    await expectDisplay(page, images.CROSS);
    await expect.poll(async () => (await boardState(page))?.acceleration).toEqual({ x: -512, y: 0, z: -887 });
    await page.keyboard.press('Home');
    await expect(gesture(page)).toHaveText('Face up');
    await expectDisplay(page, blank);

    // A drag to the top edge: the logo edge goes down.
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    if (!box) {
      throw new Error('The pad is not visible');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 4 });
    await page.mouse.up();
    await expect(gesture(page)).toHaveText('Logo down');
    await expectDisplay(page, images.RING);
    expect((await boardState(page))?.acceleration?.y).toBeGreaterThan(400);
    await stop(page);
  });

  test('"Face down" turns the board over: z is positive and the program sees face down', async ({ page }) => {
    await openProject(page, advanced(program([], [ifThen(gestureIs('face_down'), [showImage(images.FULL)], [clearDisplay()])])));
    await run(page);
    await page.getByTestId('control-accelerometer-face-down').click();
    await expect(page.getByTestId('control-accelerometer-face-down')).toHaveAttribute('aria-pressed', 'true');
    await expect(gesture(page)).toHaveText('Face down');
    await expectDisplay(page, images.FULL);
    await expect.poll(async () => (await boardState(page))?.acceleration).toEqual({ x: 0, y: 0, z: 1024 });
    await stop(page);
  });

  test('"Shake": the program sees a shake for 1 s, the gesture says so, and the board is drawn shaken meanwhile', async ({ page }) => {
    await openProject(page, advanced(program([], [ifThen(gestureIs('shake'), [showImage(images.FULL)], [clearDisplay()])])));
    await run(page);
    await expectDisplay(page, blank);
    await page.getByTestId('control-accelerometer-shake').click();
    await expectDisplay(page, images.FULL, 900);
    await expect(gesture(page)).toHaveText('Shaken');
    expect((await boardState(page))?.shaking).toBe(true);
    // 1 s later it is over: the display clears and the board is still again.
    await expectDisplay(page, blank, 3_000);
    await expect(gesture(page)).toHaveText('Face up');
    await expect.poll(async () => (await boardState(page))?.shaking).toBe(false);
    await stop(page);
  });

  test('prints the readings: whole degrees and whole mg on every axis', async ({ page }) => {
    await openProject(page, advanced(program([], [print(temperature()), print(acceleration('x')), print(acceleration('z')), wait(num(200))])));
    await run(page);
    await expect(consoleLines(page)).toContainText('25');
    await expect(consoleLines(page)).toContainText('-1024');
    await stop(page);
  });

  test('writes the Python of the sensors: int(temperature()), accelerometer.get_x() and is_gesture("shake")', async ({ page }) => {
    await openProject(page, advanced(program([], [ifThen(gestureIs('shake'), [scrollNumber(temperature())]), print(acceleration('x'))])));
    const source = page.getByTestId('python-source');
    await expect(source).toContainText('if accelerometer.is_gesture("shake"):');
    await expect(source).toContainText('display.scroll(int(temperature()))');
    await expect(source).toContainText('print(accelerometer.get_x())');
  });

  test('a Basic board has no sensor control, and a sensor block in a Basic project does not run', async ({ page }) => {
    await openProject(page, project(program([print(temperature())]), 'ybc-basic'));
    await expect(page.getByTestId('control-light')).toBeVisible();
    await expect(page.getByTestId('control-temperature')).toHaveCount(0);
    await expect(page.getByTestId('control-accelerometer')).toHaveCount(0);
    await run(page);
    await expect(page.getByTestId('run-messages')).toContainText('not available in the ybc-basic profile');
  });
});

// N17 B3: the built-in melodies, the tone and stop of the Advanced board. The text under the board says what the buzzer plays; the
// sound is heard (sound is on from the start, Run starts it), and Stop silences everything at once (Review Focus 1).
test.describe('the melodies, the tone and stop of the Advanced board (N17 B3)', () => {
  const advanced = (blocks: unknown) => project(blocks, 'ybc-advanced');

  test('a melody in the background plays while the program goes on, is heard, and Stop silences it at once', async ({ page }) => {
    await watchAudio(page);
    await openProject(page, advanced(program([playMelody('BIRTHDAY', 'background'), showImage(images.FULL), print(text('after')), wait(num(20_000))])));
    await run(page);
    await expect(consoleLines(page)).toContainText('after');
    await expectDisplay(page, images.FULL);
    // Happy birthday: C4, C4, then D4 at 500 ms, while the program has long gone on to its wait.
    await expectSounding(page, 'Playing 262 Hz');
    await expectSounding(page, 'Playing 294 Hz');
    await expect.poll(async () => (await audioLog(page)).started).toEqual(expect.arrayContaining([262, 294]));

    const before = await audioLog(page);
    await stop(page);
    await expect(page.getByTestId('sound-indicator')).toHaveText('Silent');
    await expect(runStatus(page)).toHaveText('Idle');
    await expect.poll(async () => (await audioLog(page)).stopped).toBeGreaterThanOrEqual(before.started.length);
    const after = await audioLog(page);
    await page.waitForTimeout(800);
    expect((await audioLog(page)).started).toEqual(after.started);
    await expect(page.getByTestId('sound-indicator')).toHaveText('Silent');
  });

  test('a melody that waits holds the program until its last note; a tone does not wait, and stop silences it', async ({ page }) => {
    await openProject(
      page,
      advanced(program([playMelody('JUMP_UP', 'wait'), print(text('done')), playPitch(num(880), num(60_000)), wait(num(600)), stopSound(), print(text('quiet')), wait(num(5_000))])),
    );
    await run(page);
    await expectSounding(page, 'Playing 523 Hz');
    // JUMP_UP lasts 625 ms: the line after it is not printed yet.
    expect(await consoleLines(page).textContent()).not.toContain('done');
    await expectSounding(page, 'Playing 880 Hz');
    await expect(consoleLines(page)).toContainText('done');
    await expectSounding(page, 'Silent');
    await expect(consoleLines(page)).toContainText('quiet');
    await stop(page);
  });

  test('writes the Python of the melodies, the tone and stop', async ({ page }) => {
    await openProject(page, advanced(program([playMelody('BIRTHDAY', 'background'), playPitch(num(440), num(500)), stopSound(), playMelody('ODE', 'wait')])));
    const source = page.getByTestId('python-source');
    await expect(source).toContainText('music.play(music.BIRTHDAY, wait=False)');
    await expect(source).toContainText('music.pitch(440, 500)');
    await expect(source).toContainText('music.stop()');
    await expect(source).toContainText('music.play(music.ODE, wait=True)');
  });

  test('a Basic board has no melody, tone or stop: a melody block in a Basic project does not run', async ({ page }) => {
    await openProject(page, project(program([playMelody('ODE', 'wait')]), 'ybc-basic'));
    await run(page);
    await expect(page.getByTestId('run-messages')).toContainText('not available in the ybc-basic profile');
  });
});

test.describe('Python (YB-3 owns the Python of its constructs)', () => {
  test('shows the headers and the exact forms of the contract', async ({ page }) => {
    await openProject(
      page,
      project(program([showImage(images.RING), scrollText(text('Hi'))], [ifThen(buttonPressed('A'), [playNote('C4', 4), rest(1)])])),
    );

    const source = page.getByTestId('python-source');
    await expect(source).toContainText(
      [
        'import time',
        'from yolobit import *',
        'button_a.on_pressed = None',
        'button_b.on_pressed = None',
        'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
        'import music',
        'music.set_tempo(4, 120)',
      ].join('\n'),
    );
    await expect(source).toContainText('display.show(Image("11111:10001:10001:10001:11111"))');
    await expect(source).toContainText("display.scroll('Hi')");
    await expect(source).toContainText('if button_a.is_pressed():');
    await expect(source).toContainText("music.play(['C4:4'], wait=True)");
    await expect(source).toContainText("music.play(['R:1'], wait=True)");
  });

  test('a program with no hardware has no yolobit import (only the modules used are imported)', async ({ page }) => {
    await openProject(page, project(program([print(num(1))])));
    await expect(page.getByTestId('python-source')).toContainText('print(1)');
    await expect(page.getByTestId('python-source')).not.toContainText('yolobit');
    await expect(page.getByTestId('python-source')).not.toContainText('music');
  });
});

test.describe('the project and the generic editor', () => {
  test('a hardware program comes back from a reload as it was saved, with its controls', async ({ page }) => {
    await openProject(page, project(program([showImage(images.CROSS)])));
    await expectSaved(page);
    const saved = await currentProject(page);

    await page.reload();
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

    expect(await currentProject(page)).toEqual(saved);
    await expect(page.getByTestId('runtime-controls')).toBeVisible();
    await run(page);
    await expectDisplay(page, images.CROSS);
    await stop(page);
  });

  test('a run does not change the saved document: nothing of the display, the buttons or the tone is stored', async ({ page }) => {
    await openProject(page, project(program([showImage(images.RING), playNote('C4', 1)])));
    const before = await currentProject(page);
    await run(page);
    await expectDisplay(page, images.RING);
    await stop(page);
    expect(await currentProject(page)).toEqual(before);
    expect(JSON.stringify(await currentProject(page))).not.toMatch(/"frame"|"hz"|"pixels"/);
  });

  test('replaces a run by loading another project: the old picture does not stay', async ({ page }) => {
    await openProject(page, project(program([showImage(images.RING)])));
    await run(page);
    await expectDisplay(page, images.RING);
    await stop(page);

    await page.evaluate((next) => window.__stem?.loadProject(next), project(program([showImage(images.CROSS)])));
    await expectDisplay(page, blank);
    await run(page);
    await expectDisplay(page, images.CROSS);
    await stop(page);
  });

  test('the generic editor has no controls, no sound indicator, no display text and the PoC toolbox', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('runtime-controls')).toHaveCount(0);
    await expect(page.getByTestId('sound-indicator')).toHaveCount(0);
    await expect(page.getByTestId('display-text')).toHaveCount(0);
    expect(await page.getByTestId('blockly-panel').locator('.blocklyToolboxCategory').allInnerTexts()).toEqual(['Events', 'Pins', 'Logic', 'Time']);
  });

  test('without a board there is nothing to control, and Run says it needs a board', async ({ page }) => {
    await openProject(page, { ...project(program([showImage(images.RING)])), circuit: { components: [], wires: [] } });
    await expect(page.getByTestId('runtime-controls')).toHaveCount(0);
    await run(page);
    await expect(page.getByTestId('run-messages')).toContainText('The circuit needs a board.');
  });
});

test('fits the lesson frame: the board, its controls and the sound switch are all in view at 1100x640', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 640 });
  await openProject(page, project(program([showImage(images.RING)])));

  for (const locator of [
    page.getByTestId('control-button-a'),
    page.getByTestId('control-button-b'),
    page.getByTestId('control-button-ab'),
    page.getByTestId('control-light'),
    page.getByTestId('sound-indicator'),
    page.getByRole('button', { name: 'Turn sound off' }),
  ]) {
    const box = await locator.boundingBox();
    expect(box, 'a control is visible').not.toBeNull();
    expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1100 && box.y + box.height <= 640).toBe(true);
  }
});

test('touch: a tap on a button holds it for the tap and releases it', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1100, height: 640 } });
  const page = await context.newPage();
  try {
    await openProject(page, project(program([], [ifThen(buttonPressed('A'), [showImage(images.FULL)], [clearDisplay()])])));
    await run(page);
    await page.getByTestId('control-button-a').tap();
    // A quick tap may be over before the next poll; the press is only guaranteed to leave the button open afterwards.
    await expectDisplay(page, blank);
    await expect(page.getByTestId('control-button-a')).toHaveAttribute('aria-pressed', 'false');
    await stop(page);
  } finally {
    await context.close();
  }
});

// N17 B4: A and B pressed on the drawing of the board (they share one state with the panel's buttons), A+B, the running time and
// random numbers. The board's parts are where the board's data puts them, around the middle of its body.
test.describe('pressing the board, A+B, the running time and random numbers (N17 B4)', () => {
  const parts = readJson('../src/core/devices/definitions/ybc-board.json').board.onboard as { id: string; at: { x: number; y: number; width: number; height: number } }[];
  const buttons = program([], [ifElif([[buttonPressed('A+B'), [showImage(images.FULL)]], [buttonPressed('A'), [showImage(images.CROSS)]], [buttonPressed('B'), [showImage(images.RING)]]], [clearDisplay()])]);

  /** The middle of a part drawn on the board, in page pixels: the board's place and the part's, through the canvas's viewport. */
  async function partCentre(page: Page, partId: string) {
    const state = await canvasState(page);
    const board = state.components.find((component) => component.deviceType === 'ybc-board');
    const at = parts.find((part) => part.id === partId)?.at;
    const canvas = await page.getByTestId('circuit-canvas').boundingBox();
    if (!board || !at || !canvas) {
      throw new Error(`No ${partId} on the board`);
    }
    const { scale, x, y } = state.viewport;
    return { x: canvas.x + x + (board.x + at.x + at.width / 2) * scale, y: canvas.y + y + (board.y + at.y + at.height / 2) * scale };
  }
  const pressedParts = async (page: Page) => (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board')?.pressedParts;

  test('A held on the drawing: the program sees it and both A buttons show it; dragged off the board before the release, it does not stick', async ({ page }) => {
    await openProject(page, project(buttons));
    await run(page);
    await expectDisplay(page, blank);

    const a = await partCentre(page, 'button-a');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await expectDisplay(page, images.CROSS);
    await expect(page.getByTestId('control-button-a')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pressedParts(page)).toEqual(['button-a']);

    // Review Focus 2: the pointer leaves the board while still down, and is released far away.
    await page.mouse.move(a.x - 400, a.y - 300, { steps: 8 });
    await expectDisplay(page, blank);
    await expect(page.getByTestId('control-button-a')).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.up();
    await expect.poll(() => pressedParts(page)).toEqual([]);

    // B pressed and released on the drawing.
    const b = await partCentre(page, 'button-b');
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await expectDisplay(page, images.RING);
    await page.mouse.up();
    await expectDisplay(page, blank);
    await stop(page);
  });

  test('the drawing takes no press before Run, and after Stop', async ({ page }) => {
    await openProject(page, project(buttons));
    const a = await partCentre(page, 'button-a');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.up();
    await run(page);
    await stop(page);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await expect.poll(() => pressedParts(page)).toEqual([]);
    await page.mouse.up();
  });

  test('A+B: the panel button holds both; A on the drawing with B held on the panel is A+B too', async ({ page }) => {
    await openProject(page, project(buttons));
    await run(page);

    const releaseBoth = await holdWithMouse(page, 'control-button-ab');
    await expectDisplay(page, images.FULL);
    for (const id of ['control-button-a', 'control-button-b', 'control-button-ab']) {
      await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'true');
    }
    await releaseBoth();
    await expectDisplay(page, blank);

    // A held on the drawing by the mouse, then B by the keyboard on the panel. (Pressing the drawing focuses the canvas, so a
    // panel button held by a key lets go first, as it does whenever it loses focus: that is why the mouse comes first here.)
    const a = await partCentre(page, 'button-a');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await expectDisplay(page, images.CROSS);
    await page.getByTestId('control-button-b').focus();
    await page.keyboard.down('Space');
    await expectDisplay(page, images.FULL);
    await expect(page.getByTestId('control-button-ab')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('Space');
    await expectDisplay(page, images.CROSS);
    await page.mouse.up();
    await expectDisplay(page, blank);
    await stop(page);
  });

  test('the running time and a random number: printed, in range, in both profiles', async ({ page }) => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      await openProject(page, project(program([wait(num(300)), print(runningTime()), ...Array.from({ length: 12 }, () => print(randomInt(num(6), num(1))))]), profile));
      await run(page);
      await expect(runStatus(page)).toHaveText('Program finished — board powered');
      const lines = ((await consoleLines(page).textContent()) ?? '').split('\n').map(Number);
      expect(lines, profile).toHaveLength(13);
      expect(lines[0], profile).toBeGreaterThanOrEqual(300);
      expect(lines[0], profile).toBeLessThan(5000);
      expect(lines.slice(1).every((value) => Number.isInteger(value) && value >= 1 && value <= 6), profile).toBe(true);
      await stop(page);
    }
  });

  test('writes the Python of A+B, the running time and a random number, with import random once', async ({ page }) => {
    await openProject(page, project(program([setVar('x', randomInt(num(6), num(1))), print(runningTime())], [ifThen(buttonPressed('A+B'), [scrollNumber(getVar('x'))])])));
    const source = page.getByTestId('python-source');
    await expect(source).toContainText('button_a.on_pressed_ab = button_b.on_pressed_ab = -1\nimport random\n');
    await expect(source).toContainText('x = random.randint(1, 6)');
    await expect(source).toContainText('print(running_time())');
    await expect(source).toContainText('if button_a.is_pressed() and button_b.is_pressed():');
    expect(((await source.textContent()) ?? '').match(/import random/g)).toHaveLength(1);
  });
});
