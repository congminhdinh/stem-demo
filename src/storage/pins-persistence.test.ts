import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { openLastProject } from '../core/persistence/project-repository';
import { fixtureDocument } from '../core/profiles/__fixtures__/test-profiles';
import { num, print, program, wait } from '../core/program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from '../core/program/__fixtures__/ybc-pin-blocks';
import { createTemplateProject } from '../samples/templates';
import { createDexieProjectRepository } from './dexie-project-repository';

// A project with the header pins (YB-4) comes back from IndexedDB as it was saved: the potentiometer and its
// wires, the pin blocks with their dropdown values, the profile. Runtime state (the knob position, a pin level)
// is never in the document (B2), so there is nothing of it to come back.

const registry = createDeviceRegistry(localDeviceDefinitions);
let databaseCount = 0;

const at = { x: 40, y: 80 };
const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});
const withKnob = (profile: string) => ({
  ...fixtureDocument(profile, {
    blocks: program([pinWrite('P2', false)], [pinWrite('P0', true), print(pinAnalog('P1')), print(pinRead('P0')), wait(num(20))]),
    components: [
      { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } },
      { id: 'potentiometer-1', deviceType: 'potentiometer', position: at },
      { id: 'led-1', deviceType: 'led', position: { x: 10, y: 10 } },
      { id: 'resistor-1', deviceType: 'resistor', position: { x: 20, y: 20 } },
      { id: 'push-button-1', deviceType: 'push-button', position: { x: 30, y: 30 } },
    ],
  }),
  circuit: {
    components: [
      { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } },
      { id: 'potentiometer-1', deviceType: 'potentiometer', position: at },
      { id: 'led-1', deviceType: 'led', position: { x: 10, y: 10 } },
      { id: 'resistor-1', deviceType: 'resistor', position: { x: 20, y: 20 } },
      { id: 'push-button-1', deviceType: 'push-button', position: { x: 30, y: 30 } },
    ],
    wires: [
      wire('k1', ['potentiometer-1', 'vcc'], ['ybc-board-1', '3v3']),
      wire('k2', ['potentiometer-1', 'gnd'], ['ybc-board-1', 'gnd']),
      wire('k3', ['potentiometer-1', 'out'], ['ybc-board-1', 'p1']),
      wire('l1', ['ybc-board-1', 'p0'], ['resistor-1', 'a']),
    ],
  },
});

async function reload(document: ReturnType<typeof withKnob>) {
  const name = `stem-studio-pins-${++databaseCount}`;
  await createDexieProjectRepository(name).save(document);
  return openLastProject(createDexieProjectRepository(name), registry, {
    sample: () => createTemplateProject('blink'),
    newId: () => 'new',
    canOpenProgram: () => true,
  });
}

describe('a project with pins and a potentiometer survives a save and a reload', () => {
  it.each(['ybc-basic', 'ybc-advanced'])('%s: deep-equal, no notice, still savable', async (profile) => {
    const document = withKnob(profile);
    const opened = await reload(document);
    expect(opened).toEqual({ document, notice: null, canSave: true });
  });

  it('keeps the dropdown values exactly as Blockly wrote them: the pins as "P0".."P2", the levels as "1" and "0"', async () => {
    const opened = await reload(withKnob('ybc-basic'));
    const text = JSON.stringify(opened.document.program.blocks);
    expect(text).toContain('"PIN":"P2","LEVEL":"0"');
    expect(text).toContain('"PIN":"P0","LEVEL":"1"');
    expect(text).toContain('"type":"ybc_pin_analog"');
  });

  it('carries no runtime state: no knob position, no pin level, no signal in the stored document', async () => {
    const stored = JSON.stringify((await reload(withKnob('ybc-basic'))).document);
    for (const runtime of ['sliders', 'pinOutputs', 'analogPercent', 'pinReads', '"value":', 'slider']) {
      expect(stored, runtime).not.toContain(runtime);
    }
  });
});
