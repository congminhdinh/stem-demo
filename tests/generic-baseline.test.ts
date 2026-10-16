import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../src/core/circuit/document';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { readStoredProject } from '../src/core/persistence/project-repository';
import disabledHat from '../src/core/program/__fixtures__/disabled-hat.json';
import disabledStatement from '../src/core/program/__fixtures__/disabled-statement.json';
import duplicateOnStart from '../src/core/program/__fixtures__/duplicate-on-start.json';
import ifElseIf from '../src/core/program/__fixtures__/if-else-if.json';
import missingCondition from '../src/core/program/__fixtures__/missing-condition.json';
import orphanBlock from '../src/core/program/__fixtures__/orphan-block.json';
import {
  blockTypes,
  buildBlockDefinitions,
  builtInBlockTypes,
  createDefaultProgram,
  toolbox,
} from '../src/core/program/blocks';
import { compileProgram } from '../src/core/program/compile-program';
import { createRunSession, type RunSnapshot } from '../src/core/run/run-session';
import blinkSample from '../src/samples/blink.project.json';
import buttonDirectSample from '../src/samples/button-direct.project.json';
import buttonLedSample from '../src/samples/button-led.project.json';
import ledOnSample from '../src/samples/led-on.project.json';
import { createTemplateProject, genericTemplateKeys, templateKeys } from '../src/samples/templates';
import { productionProfiles } from '../src/core/profiles';
import { resolveBoardContext } from '../src/core/profiles/board-context';
import { paletteItems } from '../src/ui/canvas/palette-model';

// Generic baseline (YB plan §16, GB1–GB4, GB6, GB9, GB11, GB12). Captured at
// the start of YB-1 from the code as it was, BEFORE any board/profile
// architecture changed. The snapshots in __snapshots__ are the expected
// output; they must never be regenerated to make a YB change pass.

const registry = createDeviceRegistry(localDeviceDefinitions);
const genericPins = registry.get('board').board?.pins.map((pin) => pin.name) ?? [];

const samples = {
  blink: projectDocumentSchema.parse(blinkSample),
  'led-on': projectDocumentSchema.parse(ledOnSample),
  'button-direct': projectDocumentSchema.parse(buttonDirectSample),
  'button-led': projectDocumentSchema.parse(buttonLedSample),
};

describe('GB1: generic device definitions', () => {
  it.each(['board', 'led', 'resistor', 'push-button'])('%s is unchanged', (id) => {
    expect(registry.get(id)).toMatchSnapshot();
  });
});

describe('GB9: generic palette', () => {
  it('lists the four generic devices, in this order', () => {
    const context = resolveBoardContext({ circuit: { components: [], wires: [] } }, registry, productionProfiles);
    expect(paletteItems(registry, context)).toMatchSnapshot();
  });
});

describe('GB2: generic blocks and toolbox', () => {
  it('keeps the block definitions, the toolbox and the default program', () => {
    expect({
      blockTypes,
      builtInBlockTypes,
      definitions: buildBlockDefinitions(genericPins),
      toolbox,
      defaultProgram: createDefaultProgram(),
    }).toMatchSnapshot();
  });
});

/** Every key anywhere in a value: the legacy IR never gets a typed `type` field (plan §9.0). */
function keysOf(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => keysOf(item, keys));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      keysOf(child, keys);
    }
  }
  return keys;
}

describe('GB3 / GB11: legacy IR golden', () => {
  const programs: [string, unknown][] = [
    ...Object.entries(samples).map(([name, document]): [string, unknown] => [name, document.program.blocks]),
    ['empty template', createTemplateProject('empty').program.blocks],
    ['fixture disabled-hat', disabledHat],
    ['fixture disabled-statement', disabledStatement],
    ['fixture duplicate-on-start', duplicateOnStart],
    ['fixture if-else-if', ifElseIf],
    ['fixture missing-condition', missingCondition],
    ['fixture orphan-block', orphanBlock],
  ];

  it.each(programs)('compiles %s to the captured IR', (_, blocks) => {
    expect(compileProgram(blocks, genericPins)).toMatchSnapshot();
  });

  it.each(programs)('%s: no IR node has a `type` field', (_, blocks) => {
    const result = compileProgram(blocks, genericPins);
    expect(keysOf(result.ok ? result.ir : null).has('type')).toBe(false);
  });
});

describe('GB4 / GB11: generic run traces', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Everything a run publishes, with the button held from 100 ms to 300 ms when the sample has one. */
  async function trace(document: ProjectDocument) {
    const session = createRunSession(registry);
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    expect(session.start(document)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(100);
    if (document.circuit.components.some((component) => component.id === 'button')) {
      session.setContactInput('button', true);
      await vi.advanceTimersByTimeAsync(200);
      session.setContactInput('button', false);
    }
    await vi.advanceTimersByTimeAsync(2400);
    session.stop();
    return published;
  }

  it.each(Object.entries(samples))('%s publishes the captured snapshots', async (_, document) => {
    expect(await trace(document)).toMatchSnapshot();
  });
});

describe('GB6 / GB12: generic editing states', () => {
  const anyProgram = () => true;
  const board = (id: string) => ({ id, deviceType: 'board', position: { x: 100, y: 100 } });

  it('opens a project with no board (the empty template) and Run says no-board', () => {
    const empty = createTemplateProject('empty');
    expect(readStoredProject(structuredClone(empty), registry, anyProgram)).toEqual(empty);
    expect(createRunSession(registry).start(empty)).toEqual({ ok: false, reason: 'no-board', diagnostics: [] });
  });

  it('opens a project with several boards and Run says multiple-boards', () => {
    const two = createNewProject('two-boards');
    two.circuit.components.push(board('board-1'), board('board-2'));
    expect(readStoredProject(structuredClone(two), registry, anyProgram)).toEqual(two);
    expect(createRunSession(registry).start(two)).toEqual({ ok: false, reason: 'multiple-boards', diagnostics: [] });
  });

  it('keeps every generic template key, first in the list (the ybc-* keys of N6a come after them)', () => {
    expect(genericTemplateKeys).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
    expect(templateKeys.slice(0, genericTemplateKeys.length)).toEqual([...genericTemplateKeys]);
  });
});
