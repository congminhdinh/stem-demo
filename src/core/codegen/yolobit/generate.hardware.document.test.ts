import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ledOnSample from '../../../samples/led-on.project.json';
import { projectDocumentSchema, type ProjectDocument } from '../../circuit/document';
import { boardTargetOf } from '../../devices/board-pins';
import ybcBoardDefinition from '../../devices/definitions/ybc-board.json';
import { localDeviceDefinitions } from '../../devices/local-catalog';
import { createDeviceRegistry } from '../../devices/registry';
import { productionProfiles } from '../../profiles';
import { resolveBoardContext } from '../../profiles/board-context';
import { createFixtureEnvironment, fixtureDocument } from '../../profiles/__fixtures__/test-profiles';
import { reportLayers } from '../../profiles/validity';
import { createBlockPackCatalog } from '../../program/block-packs';
import { compileYbcProgram } from '../../program/compile-ybc-program';
import {
  bool, buttonPressed, buttonPresses, clearDisplay, images, lightLevel, num, playNote, print, program, rest, scrollNumber, scrollText, showImage,
  text, wait, whileLoop, type Json,
} from '../../program/__fixtures__/ybc-blocks';
import { createRunSession } from '../../run/run-session';
import { compileBlocks, packs, registry } from './__fixtures__/compile-case';
import { caseIsIn, hardwareCases } from './__fixtures__/hardware-cases';
import { generateYbcMicroPython } from './generate';
import { generateForDocument } from './generate-document';

// L-4 for the onboard hardware (plan §8.6, §9.2 YB-3 item 11): a real document of Basic or Advanced is walked through the same
// layers as Run, and then the generator has to say ok. A hardware program that the simulator runs is never refused at L-4;
// one whose board lacks the part is refused at L-3 with `capability-unavailable`, in the very words Run gives; one whose profile
// does not show the pack is refused at L-2. A generic document has no Python at all.

const profileIds = ['ybc-basic', 'ybc-advanced'] as const;
const document = (blocks: Json, profile: string = 'ybc-basic') => fixtureDocument(profile, { blocks });
const generate = (project: ProjectDocument) => generateForDocument(project, registry, productionProfiles, packs);

/** The `ybc-board` without the onboard parts of one capability, as a device in another registry (the board of a different make). */
const board = ybcBoardDefinition as { board: { onboard: { capability: string }[] } };
function registryWithout(capability: string) {
  const variant = { ...ybcBoardDefinition, board: { ...board.board, onboard: board.board.onboard.filter((part) => part.capability !== capability) } };
  const devices = createDeviceRegistry([...localDeviceDefinitions.filter((definition) => (definition as { id?: string }).id !== 'ybc-board'), variant]);
  return { registry: devices, packs: createBlockPackCatalog(devices) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a hardware program of a real Basic or Advanced document passes L-2 to L-4 and is the Python of its IR', () => {
  describe.each(profileIds)('%s', (profile) => {
    const cases = hardwareCases.filter((hardwareCase) => caseIsIn(hardwareCase, profile));
    it.each(cases)('$name: is generated, and is exactly what the generator writes for the compiled program', ({ blocks }) => {
      const project = document(blocks, profile);
      const generated = generate(project);
      const direct = generateYbcMicroPython(compileBlocks(blocks));
      expect(generated).toMatchObject({ ok: true });
      expect(direct.ok).toBe(true);
      expect(generated).toEqual(direct);
    });

    it.each(cases)('$name: L-2 and L-3 hold (the layers say nothing, the program compiles), and Run starts it', ({ blocks }) => {
      const project = document(blocks, profile);
      const context = resolveBoardContext(project, registry, productionProfiles);
      expect(reportLayers(project, context, packs)).toEqual({ profileCompatible: [], runtimeReady: [] });
      const capabilities = context.readiness.ok ? context.readiness.capabilities : undefined;
      expect(capabilities).toEqual(['digital', 'analogIn', 'display', 'buttons', 'light', 'sound', 'temperature', 'motion']);
      const target = context.readiness.ok ? boardTargetOf(registry.get(context.readiness.board.deviceType), context.readiness.capabilities) : undefined;
      expect(compileYbcProgram(project.program.blocks, packs.typesOf(context.blockPacks), undefined, target).ok).toBe(true);
      const session = createRunSession(registry);
      expect(session.start(project)).toEqual({ ok: true });
      session.stop();
    });
  });

  it.each(hardwareCases.filter((hardwareCase) => profileIds.every((profile) => caseIsIn(hardwareCase, profile))))('$name: Basic and Advanced write the same bytes', ({ blocks }) => {
    const [basic, advanced] = profileIds.map((profile) => generate(document(blocks, profile)));
    expect(basic).toMatchObject({ ok: true });
    expect(advanced).toEqual(basic);
  });

  it.each(hardwareCases.filter((hardwareCase) => !caseIsIn(hardwareCase, 'ybc-basic')))('$name: a Basic document is refused at L-2, before any Python (N17 B2: the sensors are Advanced)', ({ blocks }) => {
    const project = document(blocks, 'ybc-basic');
    const context = resolveBoardContext(project, registry, productionProfiles);
    expect(reportLayers(project, context, packs).profileCompatible.map((diagnostic) => diagnostic.code)).toContain('not-in-profile');
    expect(generate(project)).toMatchObject({ ok: false });
  });

  it('maps the lines of the Python to the hardware blocks that produced them, from the document', () => {
    const picture = showImage(images.RING);
    const pause = wait(num(1000));
    const scroll = scrollText(text('Hi'));
    const generated = generate(document(program([picture, pause, scroll])));
    if (!generated || !generated.ok) {
      throw new Error(JSON.stringify(generated));
    }
    const lines = generated.source.split('\n');
    expect(generated.lineMap.map((entry) => entry.blockId)).toEqual([picture.id, pause.id, scroll.id]);
    expect(generated.lineMap.map((entry) => lines[entry.line - 1])).toEqual([
      'display.show(Image("11111:10001:10001:10001:11111"))',
      'time.sleep_ms(1000)',
      "display.scroll('Hi')",
    ]);
  });

  it('refuses at L-4 a hardware program nested deeper than the Python can safely be, while Run still runs it', () => {
    let body: Json = clearDisplay();
    for (let level = 0; level < 70; level += 1) {
      body = whileLoop(bool(false), [body]);
    }
    const project = document(program([body]));
    const session = createRunSession(registry);
    expect(session.start(project)).toEqual({ ok: true });
    session.stop();
    const generated = generate(project);
    expect(generated).toMatchObject({ ok: false, layer: 'L-4', diagnostics: [{ code: 'limit-exceeded' }] });
    expect(generated && 'source' in generated).toBe(false);
  });
});

describe('a board that lacks the part is refused at L-3 with capability-unavailable, and has no source', () => {
  // [the capability the board lacks, the blocks that need it, the program that uses only what remains]
  const lacks: [string, () => Json[], () => Json][] = [
    ['buttons', () => [buttonPressed('A'), buttonPresses('B')], () => program([showImage(images.DOT), print(lightLevel())])],
    ['display', () => [showImage(images.DOT), clearDisplay(), scrollText(text('Hi')), scrollNumber(num(5))], () => program([print(buttonPresses('A')), playNote('C4', 1)])],
    ['light', () => [lightLevel()], () => program([showImage(images.DOT), print(buttonPressed('A')), rest(1)])],
    ['sound', () => [playNote('C4', 1), rest(2)], () => program([showImage(images.DOT), print(lightLevel())])],
  ];

  describe.each(lacks)('without %s', (capability, needing, remaining) => {
    const without = registryWithout(capability);
    const generateWithout = (project: ProjectDocument) => generateForDocument(project, without.registry, productionProfiles, without.packs);

    it('has no such capability in the board context (the variant is the board it says it is)', () => {
      const context = resolveBoardContext(document(program([])), without.registry, productionProfiles);
      const capabilities = context.readiness.ok ? context.readiness.capabilities : [];
      expect(capabilities).not.toContain(capability);
      expect(capabilities).toContain('digital');
    });

    it.each(profileIds)('%s: every block that needs it is an L-3 error on its own block, and nothing is generated', (profile) => {
      for (const block of needing()) {
        // A read is an expression, so it is printed; a statement stands by itself.
        const statement = block.type === 'ybc_button_pressed' || block.type === 'ybc_button_presses' || block.type === 'ybc_light_level' ? print(block) : block;
        const project = document(program([statement]), profile);
        const generated = generateWithout(project);
        expect(generated, String(block.type)).toMatchObject({ ok: false, layer: 'L-3', diagnostics: [{ code: 'capability-unavailable', blockId: block.id }] });
        expect(generated && 'source' in generated, String(block.type)).toBe(false);
        // Run says the same: the same code on the same block.
        const session = createRunSession(without.registry);
        expect(session.start(project)).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'capability-unavailable', blockId: block.id }] });
        expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
        // The same program on the full board is fine: it is the board, not the program.
        expect(generate(project)).toMatchObject({ ok: true });
      }
    });

    it('reports each offending block, and only those', () => {
      const blocks = needing().map((block) => (block.type === 'ybc_button_pressed' || block.type === 'ybc_button_presses' || block.type === 'ybc_light_level' ? print(block) : block));
      const generated = generateWithout(document(program([print(text('ok')), ...blocks, print(text('ok'))])));
      if (!generated || generated.ok) {
        throw new Error('expected a refusal');
      }
      expect(generated.layer).toBe('L-3');
      expect(generated.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(blocks.map(() => 'capability-unavailable'));
      expect(generated.diagnostics).toHaveLength(blocks.length);
    });

    it('still generates a program that uses only the parts the board has', () => {
      const generated = generateWithout(document(remaining()));
      expect(generated).toMatchObject({ ok: true });
    });
  });

  it('does not look at the capability when the program has no hardware at all', () => {
    for (const capability of ['buttons', 'display', 'light', 'sound']) {
      const without = registryWithout(capability);
      expect(generateForDocument(document(program([print(num(1))])), without.registry, productionProfiles, without.packs)).toMatchObject({ ok: true });
    }
  });
});

describe('a hardware block in a profile that does not show its pack is L-2 not-in-profile', () => {
  const environment = createFixtureEnvironment();
  const generateIn = (project: ProjectDocument) =>
    generateForDocument(project, environment.registry, environment.profiles, environment.packs, environment.noopBlockTypes);

  // One block of each of the three packs of YB-3.
  const hardware: [string, Json][] = [
    ['ybc.display', showImage(images.RING)],
    ['ybc.display (clear)', clearDisplay()],
    ['ybc.input', print(buttonPressed('A'))],
    ['ybc.sound', playNote('C4', 1)],
    ['ybc.sound (rest)', rest(1)],
  ];

  it.each(['test-base', 'test-extended'])('%s: refuses each, naming the block, and generates nothing', (profile) => {
    for (const [label, block] of hardware) {
      // A read is an expression, so it sits in a print; the print is out of the profile too (the language packs are not in it).
      const inner = label.startsWith('ybc.input') ? buttonPressed('A') : block;
      const statement = label.startsWith('ybc.input') ? print(inner) : block;
      const generated = generateIn(fixtureDocument(profile, { blocks: program([statement]) }));
      if (!generated || generated.ok) {
        throw new Error(`${label}: expected a refusal`);
      }
      expect(generated.layer, label).toBe('L-2');
      expect(generated.diagnostics.every((diagnostic) => diagnostic.code === 'not-in-profile'), label).toBe(true);
      expect(generated.diagnostics.map((diagnostic) => diagnostic.blockId), label).toContain(inner.id);
      expect('source' in generated, label).toBe(false);
    }
  });

  it('is the same refusal as Run gives, and the document keeps its blocks (nothing is removed or migrated)', () => {
    const shown = showImage(images.RING);
    const project = fixtureDocument('test-base', { blocks: program([shown]) });
    const before = JSON.stringify(project);
    expect(generateIn(project)).toMatchObject({ ok: false, layer: 'L-2' });
    const session = createRunSession(environment.registry, { profiles: environment.profiles, packs: environment.packs, noopBlockTypes: environment.noopBlockTypes });
    expect(session.start(project)).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'not-in-profile', blockId: shown.id }] });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('Basic and Advanced show all three packs, so the same blocks are not refused there', () => {
    for (const profile of profileIds) {
      const shown = productionProfiles.get(profile);
      expect(shown?.blockPacks).toEqual(expect.arrayContaining(['ybc.display', 'ybc.input', 'ybc.sound']));
    }
  });
});

describe('what has no Python, and what has the plainest Python', () => {
  it('returns null for a generic document, also one whose program holds the blocks of the hardware', () => {
    expect(generate(fixtureDocument(undefined, { components: [] }))).toBeNull();
    expect(generate(fixtureDocument(undefined, { blocks: program([showImage(images.RING), playNote('C4', 1)]) }))).toBeNull();
    expect(generate(projectDocumentSchema.parse(ledOnSample))).toBeNull();
  });

  it('generates an empty program of both profiles: the idle loop and `import time`, nothing of the hardware', () => {
    for (const profile of profileIds) {
      for (const blocks of [fixtureDocument(profile).program.blocks, program([]), program([], [])]) {
        const generated = generate(document(blocks as Json, profile));
        if (!generated || !generated.ok) {
          throw new Error(JSON.stringify(generated));
        }
        expect(generated.source).toContain('import time\n');
        expect(generated.source).toContain('while True:\n    time.sleep_ms(10)\n');
        expect(generated.source).not.toMatch(/yolobit|music|display|button|light_level|on_pressed/);
      }
    }
  });

  it('writes a program that has only `on start` hardware, with no forever, and ends it in the idle loop', () => {
    const generated = generate(document(program([showImage(images.DOT)])));
    if (!generated || !generated.ok) {
      throw new Error(JSON.stringify(generated));
    }
    expect(generated.source.endsWith('while True:\n    time.sleep_ms(10)\n')).toBe(true);
    expect(generated.source).toContain('display.show(Image("00000:00000:00100:00000:00000"))\n');
  });
});

describe('the Python of a hardware program is a text of the document and nothing of a run', () => {
  const hardware = hardwareCases.map((c) => c.blocks);

  it.each(hardware)('a result has exactly the keys of the panel and no console, simulation or state of the display or the buzzer', (blocks) => {
    const generated = generate(document(blocks, 'ybc-advanced'));
    if (!generated || !generated.ok) {
      throw new Error(JSON.stringify(generated));
    }
    expect(Object.keys(generated).sort()).toEqual(['diagnostics', 'lineMap', 'names', 'ok', 'source']);
    expect(generated.diagnostics).toEqual([]);
    expect(JSON.stringify(generated)).not.toMatch(/console|simulation|status|"frame"|"hz"|pixels|running(?!_time\(\))/);
    expect(typeof generated.source).toBe('string');
    // It is plain data: it survives a round trip through JSON unchanged.
    expect(JSON.parse(JSON.stringify(generated))).toEqual(generated);
  });

  it('does not touch the document or a run that is going on with the same document: no snapshot is published and none changes', async () => {
    const project = document(program([showImage(images.RING), scrollText(text('Hi')), print(text('done'))], [print(lightLevel())]));
    const before = JSON.stringify(project);
    const session = createRunSession(registry);
    const published: unknown[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    expect(session.start(project)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = session.getSnapshot();
    const shown = JSON.stringify(snapshot);
    const notices = published.length;

    expect(generate(project)).toMatchObject({ ok: true });
    expect(generate(project)).toMatchObject({ ok: true });

    expect(published).toHaveLength(notices);
    expect(session.getSnapshot()).toBe(snapshot);
    expect(JSON.stringify(session.getSnapshot())).toBe(shown);
    expect(JSON.stringify(project)).toBe(before);
    session.stop();
  });

  it('is the same text before, during and after a run of the same document', async () => {
    const project = document(caseOf('melody'));
    const first = generate(project);
    const session = createRunSession(registry);
    session.start(project);
    await vi.advanceTimersByTimeAsync(300);
    const during = generate(project);
    session.stop();
    const after = generate(project);
    expect(during).toEqual(first);
    expect(after).toEqual(first);
  });
});

function caseOf(name: string): Json {
  const found = hardwareCases.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no hardware case ${name}`);
  }
  return found.blocks;
}
