import { expect, test, type Page } from '@playwright/test';
import {
  add, bool, cmp, countUp, getVar, idiv, ifElif, ifThen, join, num, print, program, repeat, setVar, text, wait, whileLoop,
} from '../src/core/program/__fixtures__/ybc-blocks';
import { currentProject, expectBlockText, expectSaved, openApp, openProject } from './helpers';

// YB-2a (YB plan §9.4, §18.3): a Yolo:Bit-compatible project runs the typed language and
// prints to the console. Opened through the dev-only hook, as a stored document would be.

const ybcBoard = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } };
const project = (blocks: unknown, profile = 'ybc-basic') => ({
  schemaVersion: 1,
  id: `ybc-language-${profile}`,
  name: 'Language',
  profile,
  circuit: { components: [ybcBoard], wires: [] },
  program: { blocks },
});

const consoleLines = (page: Page) => page.getByTestId('console-lines');
const runStatus = (page: Page) => page.getByTestId('run-status');

test('runs x = 1; x = x + 2; print(x), and shows 3 on the console', async ({ page }) => {
  await openProject(page, project(program([setVar('x', num(1)), setVar('x', add(getVar('x'), num(2))), print(getVar('x'))])));
  await expectBlockText(page, 'print');

  await page.getByRole('button', { name: 'Run' }).click();

  await expect(consoleLines(page)).toHaveText('3');
  await expect(runStatus(page)).toHaveText('Program finished — board powered');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(runStatus(page)).toHaveText('Idle');
  await expect(page.getByTestId('console')).toHaveCount(0);
});

test('branches, prints Python-style division, and keeps forever printing until Stop', async ({ page }) => {
  await openProject(
    page,
    project(program([print(idiv(num(-7), num(2))), ifThen(cmp('GT', num(2), num(1)), [print(text('yes'))], [print(text('no'))])], [print(text('tick'))])),
  );

  await page.getByRole('button', { name: 'Run' }).click();

  await expect(consoleLines(page)).toContainText('-4\nyes\ntick\ntick');
  await expect(runStatus(page)).toHaveText('Running');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(runStatus(page)).toHaveText('Idle');
});

test('names the block and the fault when a program divides by zero, keeping the earlier output', async ({ page }) => {
  await openProject(page, project(program([print(text('before')), print(idiv(num(1), num(0)))])));

  await page.getByRole('button', { name: 'Run' }).click();

  await expect(runStatus(page)).toHaveText('Error');
  await expect(page.getByTestId('run-messages')).toContainText('Division by zero.');
  await expect(consoleLines(page)).toHaveText('before');
});

test('does not start a program with a type mistake, and says so', async ({ page }) => {
  await openProject(page, project(program([setVar('x', text('hi'))])));

  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('run-messages')).toContainText('The program has errors.');
  await expect(page.getByTestId('run-messages')).toContainText('needs a whole number');
  await expect(runStatus(page)).toHaveText('Idle');
});

test('keeps at most 500 lines when a program prints without end', async ({ page }) => {
  await openProject(page, project(program([], [print(num(1))])));

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('console-hidden')).toBeVisible({ timeout: 20_000 });
  const lines = await consoleLines(page).innerText();
  expect(lines.split('\n').length).toBeLessThanOrEqual(500);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(runStatus(page)).toHaveText('Idle');
});

test('offers the language blocks, a variables category without "change by", and the onboard hardware categories', async ({ page }) => {
  await openProject(page, project(program([])));
  const panel = page.getByTestId('blockly-panel');
  const flyoutTexts = async (category: string) => {
    await panel.locator('.blocklyToolboxCategory', { hasText: category }).click();
    await panel.locator('.blocklyFlyout .blocklyText').first().waitFor();
    return (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ');
  };

  const logic = await flyoutTexts('Logic');
  expect(logic).toContain('if');
  expect(logic).toMatch(/and/);
  expect(logic).toMatch(/not/);
  const math = await flyoutTexts('Math');
  expect(math).toContain('//');
  // "remainder of a ÷ b" is Blockly's own wording for %; there is no division or power block.
  expect(math).not.toMatch(/\^|sqrt|round|random/);
  const variables = await flyoutTexts('Variables');
  expect(variables).toMatch(/Create variable/);
  expect(variables).toMatch(/set/);
  expect(variables).not.toMatch(/change/i);
  // The hardware categories: YB-3's onboard parts (Display, Input, Sound) and YB-4's header pins (C-23…C-25).
  expect(await panel.locator('.blocklyToolboxCategory').allInnerTexts()).toEqual(['Program', 'Display', 'Input', 'Sound', 'Pins', 'Logic', 'Loops', 'Time', 'Math', 'Text', 'Variables']);
  const pins = await flyoutTexts('Pins');
  expect(pins).toMatch(/set\spin/);
  expect(pins).toMatch(/digital\sread\spin/);
  expect(pins).toMatch(/analog\sread\spin/);
  expect(pins).not.toMatch(/pwm|analog write|servo|pulse|display|button|light|sound|temperature|random/i);
});

test('saves the program, not the run: a reload brings the same document back, with no console', async ({ page }) => {
  await openProject(page, project(program([print(num(42))])));
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(consoleLines(page)).toHaveText('42');
  await expectSaved(page);
  const saved = await currentProject(page);

  await page.reload();
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

  expect(await currentProject(page)).toEqual(saved);
  expect(JSON.stringify(saved)).not.toContain('console');
  await expect(page.getByTestId('console')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(consoleLines(page)).toHaveText('42');
});

test('leaves the generic editor as it was: no console, the PoC toolbox', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('console')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop' }).click();
  expect(await page.getByTestId('blockly-panel').locator('.blocklyToolboxCategory').allInnerTexts()).toEqual(['Events', 'Pins', 'Logic', 'Time']);
});

test('the arithmetic block offers + − × and nothing else, and each operator runs', async ({ page }) => {
  await openProject(page, project(program([print(add(num(6), num(3)))])));
  const panel = page.getByTestId('blockly-panel');

  await panel.locator('.blocklyDropdownText', { hasText: '+' }).first().click();
  const menu = page.locator('.blocklyDropDownDiv .blocklyMenuItem');
  expect(await menu.allInnerTexts()).toEqual(['+', '−', '×']);

  await menu.filter({ hasText: '×' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(consoleLines(page)).toHaveText('18');
});

// --- YB-2b: loops, wait, else-if, and Stop ---------------------------------------------------------

const withVariables = (statements: unknown[], forever?: unknown[]) =>
  program(statements as never[], forever as never[] | undefined, ['x', 'y', 'z', 'i']);

test('runs repeat, while, count up and else-if, and prints their results', async ({ page }) => {
  await openProject(
    page,
    project(
      withVariables([
        repeat(num(3), [setVar('x', add(getVar('x'), num(1)))]),
        whileLoop(cmp('LT', getVar('y'), num(4)), [setVar('y', add(getVar('y'), num(2)))]),
        countUp('i', num(1), num(7), 3, [print(join(text('i='), getVar('i')))]),
        ifElif([[cmp('GT', getVar('x'), num(5)), [print(text('big'))]], [cmp('EQ', getVar('x'), num(3)), [print(text('three'))]]], [print(text('other'))]),
        print(getVar('x')),
        print(getVar('y')),
      ]),
    ),
  );

  await page.getByRole('button', { name: 'Run' }).click();

  await expect(consoleLines(page)).toHaveText('i=1\ni=4\ni=7\nthree\n3\n4');
  await expect(runStatus(page)).toHaveText('Program finished — board powered');
});

test('waits, and is still Running (and stoppable) while it waits', async ({ page }) => {
  await openProject(page, project(withVariables([print(text('before')), wait(num(60_000)), print(text('after'))])));

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(consoleLines(page)).toHaveText('before');
  await page.waitForTimeout(300);
  await expect(runStatus(page)).toHaveText('Running');
  await expect(consoleLines(page)).toHaveText('before');

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(runStatus(page)).toHaveText('Idle');
});

test('keeps the page responsive and stops a tight while true at once', async ({ page }) => {
  await openProject(page, project(withVariables([whileLoop(bool(true), [])])));

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(runStatus(page)).toHaveText('Running');
  await page.waitForTimeout(300);
  // The page answers while the loop runs: the click below is served by the same main thread.
  const before = Date.now();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(runStatus(page)).toHaveText('Idle');
  expect(Date.now() - before).toBeLessThan(2_000);
});

test('stops a million-step count up, nested repeats and a forever with a tight loop', async ({ page }) => {
  const programs = [
    withVariables([countUp('i', num(0), num(1_000_000), 1, [setVar('x', add(getVar('x'), num(1)))]), whileLoop(bool(true), [])]),
    withVariables([repeat(num(1_000_000), [repeat(num(1_000_000), [setVar('x', add(getVar('x'), num(1)))])])]),
    withVariables([], [whileLoop(bool(true), [print(num(1))])]),
  ];
  for (const blocks of programs) {
    await openProject(page, project(blocks));
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(runStatus(page)).toHaveText('Running');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(runStatus(page)).toHaveText('Idle');
  }
});

test('shows the faults of the new constructs: a bad repeat count and a bad wait', async ({ page }) => {
  await openProject(page, project(withVariables([print(text('go')), repeat(add(num(2_000_000), num(0)), [])])));
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(runStatus(page)).toHaveText('Error');
  await expect(page.getByTestId('run-messages')).toContainText('must be between');
  await expect(consoleLines(page)).toHaveText('go');

  await openProject(page, project(withVariables([wait(num(60_001))])));
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('run-messages')).toContainText('The program has errors.');
  await expect(page.getByTestId('run-messages')).toContainText('between 0 and 60000');
});

test('offers the loop, time and join blocks, with no "repeat until" and nothing else', async ({ page }) => {
  await openProject(page, project(withVariables([])));
  const panel = page.getByTestId('blockly-panel');
  const flyout = async (category: string) => {
    await panel.locator('.blocklyToolboxCategory', { hasText: category }).click();
    await panel.locator('.blocklyFlyout .blocklyText').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(200);
    return (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ');
  };

  const loops = await flyout('Loops');
  expect(loops).toMatch(/repeat/);
  expect(loops).toMatch(/while/);
  expect(loops).toMatch(/count\s+up/); // Blockly writes a no-break space
  expect(loops).not.toMatch(/until|break|continue|for\s+each/i);
  expect(await flyout('Time')).toMatch(/wait/);
  expect(await flyout('Text')).toMatch(/create\s+text\s+with/); // Blockly's label for the join block
});
