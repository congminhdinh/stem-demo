import { describe, expect, it } from 'vitest';
import { createNewProject, projectDocumentSchema } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { readStoredProject } from '../core/persistence/project-repository';
import { createDefaultProgram } from '../core/program/blocks';
import blinkSample from './blink.project.json';
import buttonDirectSample from './button-direct.project.json';
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { createTemplateProject, isTemplateKey, labOfTemplate, templateKeys, templateKeysOf, type TemplateKey } from './templates';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('templates (S1)', () => {
  it('are exactly the keys of the launch contract', () => {
    expect(templateKeys).toEqual([
      'blink',
      'led-on',
      'button-direct',
      'button-led',
      'empty',
      'ybc-heart',
      'ybc-button-ab',
      'ybc-night-light',
      'ybc-melody',
      'ybc-empty',
      'ybc-rainbow',
      'ybc-thermometer',
      'ybc-dice',
      'ybc-servo-gate',
    ]);
  });

  it('opens the ybc-* templates in a Yolo:Bit lab and every other one in a Blockly lab', () => {
    expect(templateKeysOf('blockly')).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
    expect(templateKeysOf('yolobit')).toEqual([
      'ybc-heart',
      'ybc-button-ab',
      'ybc-night-light',
      'ybc-melody',
      'ybc-empty',
      'ybc-rainbow',
      'ybc-thermometer',
      'ybc-dice',
      'ybc-servo-gate',
    ]);
    expect(labOfTemplate('blink')).toBe('blockly');
    expect(labOfTemplate('ybc-empty')).toBe('yolobit');
  });

  it.each<[TemplateKey, unknown]>([
    ['blink', blinkSample],
    ['led-on', ledOnSample],
    ['button-direct', buttonDirectSample],
    ['button-led', buttonLedSample],
  ])('%s opens the bundled sample of that name', (key, sample) => {
    expect(createTemplateProject(key)).toEqual(projectDocumentSchema.parse(sample));
  });

  it('empty opens what New opens, with a fixed id so every launch is the same', () => {
    expect(createTemplateProject('empty')).toEqual(createNewProject('template-empty'));
    expect(createTemplateProject('empty')).toEqual({
      schemaVersion: 1,
      id: 'template-empty',
      name: 'Untitled',
      circuit: { components: [], wires: [] },
      program: { blocks: createDefaultProgram() },
    });
  });

  it.each(templateKeys)('%s is a project the editor can open (schema, I1–I3, known devices)', (key) => {
    expect(readStoredProject(createTemplateProject(key), registry, () => true)).not.toBeNull();
  });

  it.each(templateKeys)('%s is fresh on every call: an edit of one launch never reaches the next', (key) => {
    const first = createTemplateProject(key);
    const pristine = structuredClone(first);

    first.name = 'Edited';
    first.circuit.components.push({ id: 'extra', deviceType: 'led', position: { x: 0, y: 0 } });
    (first.program.blocks as { blocks: { blocks: unknown[] } }).blocks.blocks.length = 0;

    expect(createTemplateProject(key)).toEqual(pristine);
  });

  it('never hands out the bundled sample’s own objects', () => {
    const document = createTemplateProject('button-led');

    expect(document.program.blocks).not.toBe(buttonLedSample.program.blocks);
    expect(document.circuit.components[0]).not.toBe(buttonLedSample.circuit.components[0]);
  });

  it.each(templateKeys)('accepts the key %s', (key) => {
    expect(isTemplateKey(key)).toBe(true);
  });

  it.each(['', 'Blink', 'BLINK', ' blink', 'blink ', 'sample-blink', 'button_led', 'constructor', '__proto__', 'toString', 'YBC-HEART', 'ybc_heart', 'ybc-'])(
    'refuses %j: keys match exactly',
    (value) => {
      expect(isTemplateKey(value)).toBe(false);
    },
  );
});
