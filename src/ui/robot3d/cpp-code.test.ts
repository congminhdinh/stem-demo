import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { productionKits } from '../../core/hardware';
import { productionProfiles } from '../../core/profiles';
import { motorSet, packs, registry } from '../../core/program/__fixtures__/uno-blocks';
import { num, print, program } from '../../core/program/__fixtures__/ybc-blocks';
import { unoDocument } from '../../core/profiles/__fixtures__/uno-document';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { sketchFileName, sketchOf } from './cpp-code';

// N18 R4.5: the code of the C++ tab is C1's sketch of the project: the golden of a pilot lesson's reference solution for that, the layer
// and the diagnostics when there is none.

const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const golden = (key: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'robot-solutions', `${key}.ino`), 'utf8');

describe('sketchOf (N18 R4.5)', () => {
  it.each(['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow'] as const)('is the golden sketch of the reference solution of %s', (key) => {
    const project = { ...robotStarterDocument(key), program: { blocks: robotSolutions[key].reference } };
    const sketch = sketchOf(project, rules, { key, version: 1 });
    expect(sketch.ok && sketch.source).toBe(golden(key));
  });

  it('gives the lines of the sketch, and C1’s map of each block to its lines', () => {
    const project = { ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } };
    const sketch = sketchOf(project, rules, { key: 'rb-drive-to-zone', version: 1 });
    if (!sketch.ok) throw new Error(JSON.stringify(sketch.diagnostics));
    expect(sketch.lines.join('\n') + '\n').toBe(sketch.source);
    expect(sketch.lines[0]).toBe('// Scenario: rb-drive-to-zone@1, kit: ref-uno-rover@0, board: uno-r3@0');
    // The wait block of the solution is the one line `delay(5000L);`.
    const wait = sketch.lineMap.find((entry) => entry.blockId === 'drive-time');
    expect(wait).toBeDefined();
    expect(sketch.lines[wait!.from - 1]).toBe('  delay(5000L);');
    expect(wait!.to).toBe(wait!.from);
  });

  it('is the diagnostics and the layer that stopped a program that does not compile, never a sketch', () => {
    const broken = unoDocument('uno-basic', { program: { blocks: program([print(num(2 ** 40))], undefined, ['x']) } });
    const sketch = sketchOf(broken, rules, { key: 'rb-sandbox', version: 1 });
    expect(sketch).toEqual({
      ok: false,
      layer: 'L-3',
      diagnostics: [expect.objectContaining({ severity: 'error', code: 'value-out-of-range', message: 'A number must be between -2147483648 and 2147483647.' })],
    });
  });

  it('is the diagnostics of an unknown kit (L-1), and of a project that is not a robot’s', () => {
    const unknownKit = unoDocument('uno-basic', { kit: { id: 'nope', version: '9' }, program: { blocks: program([motorSet('motorLeft', num(40))], undefined, ['x']) } });
    expect(sketchOf(unknownKit, rules, { key: 'rb-sandbox', version: 1 })).toMatchObject({ ok: false, layer: 'L-1', diagnostics: [{ code: 'unknown-kit' }] });
    expect(sketchOf(createNewProject('generic'), rules, { key: 'rb-sandbox', version: 1 })).toMatchObject({ ok: false, layer: 'L-1', diagnostics: [{ code: 'no-code-target' }] });
  });
});

describe('sketchFileName', () => {
  it('is the scenario’s key with the Arduino extension', () => {
    expect(sketchFileName({ key: 'rb-drive-to-zone' })).toBe('rb-drive-to-zone.ino');
  });
});
