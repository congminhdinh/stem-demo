import { expect, test, type Page } from '@playwright/test';
import { cmp, ifThen, num, print, program, wait } from '../src/core/program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from '../src/core/program/__fixtures__/ybc-pin-blocks';
import { canvasState, currentProject, dragFromFlyout, expectBlockText, openProject } from './helpers';

// YB-4 (YB plan §14 B8–B10, contract P7): the header pins through the whole stack. A potentiometer on P1 and an
// LED on P0 are wired in the project; the program reads the knob (native scale 0..4095) and drives the LED. The
// slider is the runtime control, its position goes to the run as a `slider` input, the program reads it through
// the pin, and the LED is read back from what Konva rendered. Opened through the dev-only hook (YB-6 brings New).

const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});
const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } };
const knob = { id: 'potentiometer-1', deviceType: 'potentiometer', position: { x: 100, y: 120 } };
const resistor = { id: 'resistor-1', deviceType: 'resistor', position: { x: 120, y: 300 } };
const led = { id: 'led-1', deviceType: 'led', position: { x: 40, y: 300 } };
const knobWires = [
  wire('k1', ['potentiometer-1', 'vcc'], ['ybc-board-1', '3v3']),
  wire('k2', ['potentiometer-1', 'gnd'], ['ybc-board-1', 'gnd']),
  wire('k3', ['potentiometer-1', 'out'], ['ybc-board-1', 'p1']),
];
const ledWires = [
  wire('l1', ['ybc-board-1', 'p0'], ['resistor-1', 'a']),
  wire('l2', ['resistor-1', 'b'], ['led-1', 'anode']),
  wire('l3', ['led-1', 'cathode'], ['ybc-board-1', 'gnd']),
];
const project = (blocks: unknown, circuit: { components: unknown[]; wires: unknown[] }, profile = 'ybc-basic') => ({
  schemaVersion: 1,
  id: `ybc-pins-${profile}`,
  name: 'Pins',
  profile,
  circuit,
  program: { blocks },
});
/** P7: when the knob is above the middle of its travel (2048 of 4095), the LED is on. */
const knobAndLed = (profile = 'ybc-basic') =>
  project(program([], [ifThen(cmp('GT', pinAnalog('P1'), num(2048)), [pinWrite('P0', true)], [pinWrite('P0', false)]), wait(num(20))]), {
    components: [board, knob, resistor, led],
    wires: [...knobWires, ...ledWires],
  }, profile);

const status = (page: Page) => page.getByTestId('run-status');
const slider = (page: Page) => page.getByRole('slider', { name: 'Potentiometer 1' });
const rendered = async (page: Page, id: string) => (await canvasState(page)).components.find((component) => component.id === id);

test('the knob decides the LED through the program: P7 end to end (digital write, analog read, runtime slider)', async ({ page }) => {
  await openProject(page, knobAndLed());
  await expect.poll(async () => (await canvasState(page)).components.map((c) => c.deviceType)).toEqual(['ybc-board', 'potentiometer', 'resistor', 'led']);
  const before = (await currentProject(page)) as { circuit: unknown; profile: string; id: string; name: string };

  // The control exists while a run does: not before Run, and not after Stop.
  await expect(page.getByTestId('runtime-controls')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status(page)).toHaveText('Running');
  await expect(slider(page)).toBeVisible();
  await expect(slider(page)).toHaveValue('0');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(false);
  await expect.poll(async () => (await rendered(page, 'potentiometer-1'))?.value).toBe(0);

  // The knob turns up: the snapshot says so, the renderer draws it, and the program lights the LED.
  await slider(page).fill('100');
  await expect.poll(async () => (await rendered(page, 'potentiometer-1'))?.value).toBe(100);
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(true);

  // 2048 on the native scale is 50 %: not above it. 51 % is.
  await slider(page).fill('50');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(false);
  await slider(page).fill('51');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(true);
  await slider(page).fill('0');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(false);

  // The knob is a keyboard control too.
  await slider(page).focus();
  await page.keyboard.press('End');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(true);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status(page)).toHaveText('Idle');
  await expect(page.getByTestId('runtime-controls')).toHaveCount(0);
  // The run's inputs are not the document's (B2): the circuit, the profile and the identity are as they were.
  // (Run saves the Blockly workspace first, which may write the blocks' positions; the circuit is not Blockly's.)
  const after = (await currentProject(page)) as typeof before;
  expect({ circuit: after.circuit, profile: after.profile, id: after.id, name: after.name }).toEqual({ circuit: before.circuit, profile: before.profile, id: before.id, name: before.name });

  // And the next run starts with the knob at rest and the LED out.
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(slider(page)).toHaveValue('0');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(false);
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('the same project runs in Advanced', async ({ page }) => {
  await openProject(page, knobAndLed('ybc-advanced'));
  await page.getByRole('button', { name: 'Run' }).click();
  await slider(page).fill('100');
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(true);
  await page.getByRole('button', { name: 'Stop' }).click();
});

test('offers the parts of the pins in the palette and the three blocks in the Pins category', async ({ page }) => {
  await openProject(page, project(program([], []), { components: [board], wires: [] }));
  await expect(page.getByRole('toolbar', { name: 'Add a device' }).getByRole('button')).toHaveText([
    '+ Bit-compatible Board',
    '+ LED',
    '+ Resistor',
    '+ Push Button',
    '+ Potentiometer',
  ]);
  const panel = page.getByTestId('blockly-panel');
  await panel.locator('.blocklyToolboxCategory', { hasText: 'Pins' }).click();
  for (const label of ['set pin', 'digital read pin', 'analog read pin']) {
    await expect(panel.locator('.blocklyFlyout .blocklyText', { hasText: label }).first()).toBeVisible();
  }
  // Nothing the contract excludes: no analog write / PWM, no servo, no pulse.
  await expect(panel.locator('.blocklyFlyout .blocklyText', { hasText: /pwm|servo|pulse|analog write/i })).toHaveCount(0);
});

test('a pin the circuit leaves open stops the program at that block, and says so in words', async ({ page }) => {
  await openProject(page, project(program([print(num(1)), print(pinRead('P1'))], []), { components: [board], wires: [] }));
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(status(page)).toHaveText('Error');
  await expect(page.getByTestId('run-messages')).toContainText('Pin P1 is not connected to anything, so it cannot be read.');
  // The board stays powered after an error (E7): Stop is still the way out.
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status(page)).toHaveText('Idle');
});

test('shows the MicroPython of the pins: the yolobit import, its preamble and the three forms', async ({ page }) => {
  await openProject(page, knobAndLed());
  const source = page.getByTestId('python-source');
  await expect(source).toContainText(['import time', 'from yolobit import *', 'button_a.on_pressed = None', 'button_b.on_pressed = None', 'button_a.on_pressed_ab = button_b.on_pressed_ab = -1'].join('\n'));
  await expect(source).toContainText('if int(pin1.read_analog()) > 2048:');
  await expect(source).toContainText('pin0.write_digital(1)');
  await expect(source).toContainText('pin0.write_digital(0)');
  await expect(source).toContainText('time.sleep_ms(20)');
});

test('builds a pin block from the toolbox, with its real dropdowns, and the LED follows it', async ({ page }) => {
  await openProject(page, project({ blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'on-start', x: 40, y: 40 }] } }, { components: [board, resistor, led], wires: ledWires }));
  await expectBlockText(page, 'on start');
  await dragFromFlyout(page, 'Pins', 'set pin', 'on start');
  await expect.poll(async () => JSON.stringify(await page.evaluate(() => window.__stem?.getProgramBlocks()))).toContain('ybc_pin_write');

  // The dropdown shows its default, P0 and ON; the LED is wired to P0.
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(async () => (await rendered(page, 'led-1'))?.lit).toBe(true);
  await page.getByRole('button', { name: 'Stop' }).click();
  expect(JSON.stringify(await page.evaluate(() => window.__stem?.getProgramBlocks()))).toContain('"PIN":"P0"');
});
