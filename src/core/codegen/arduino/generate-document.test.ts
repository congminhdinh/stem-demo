import { describe, expect, it } from 'vitest';
import { createNewProject } from '../../circuit/document';
import { productionKits } from '../../hardware';
import { productionProfiles } from '../../profiles';
import { unoDocument } from '../../profiles/__fixtures__/uno-document';
import { compileUnoProject } from '../../program/compile-uno-program';
import { motorSet, packs, registry } from '../../program/__fixtures__/uno-blocks';
import { num, print, program, text } from '../../program/__fixtures__/ybc-blocks';
import { createTemplateProject } from '../../../samples/templates';
import { generateCodeForDocument, generateForDocument } from '../yolobit/generate-document';
import { generateUnoSketch } from './generate';

// N18 C1: the code of a document is chosen by its board family's `codeTarget` (devices/definitions/*.json): MicroPython for a Yolo:Bit
// (`generateForDocument`, byte for byte as before), the Arduino sketch for the UNO (compileUnoProject, then generateUnoSketch), none for
// a generic project. The layer that stopped a document is reported, as for Python.

const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const robot = (onStart: Parameters<typeof program>[0], extra: Parameters<typeof unoDocument>[1] = {}) =>
  unoDocument('uno-basic', { program: { blocks: program(onStart, undefined, ['x']) }, ...extra });

describe('generateCodeForDocument (N18 C1)', () => {
  it('writes the Arduino sketch of a uno document, as compileUnoProject and generateUnoSketch do', () => {
    const document = robot([motorSet('motorLeft', num(40)), print(text('go'))]);
    const compiled = compileUnoProject(document, rules);
    if (!compiled.ok) {
      throw new Error(JSON.stringify(compiled.diagnostics));
    }
    const code = generateCodeForDocument(document, rules);
    expect(code).toEqual({ codeTarget: 'arduino-avr', generation: generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board }) });
    expect(code?.generation.ok && code.generation.source).toContain('  motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 40L);\n');
  });

  it('names the scenario it is given in the header', () => {
    const code = generateCodeForDocument(robot([]), { ...rules, scenario: { key: 'rb-drive-to-zone', version: 1 } });
    expect(code?.generation.ok && code.generation.source.split('\n')[0]).toBe('// Scenario: rb-drive-to-zone@1, kit: ref-uno-rover@0, board: uno-r3@0');
  });

  it('gives the Python of a Yolo:Bit document exactly as generateForDocument does', () => {
    const document = { ...createTemplateProject('ybc-empty'), program: { blocks: program([print(num(7))]) } };
    expect(generateCodeForDocument(document, rules)).toEqual({ codeTarget: 'yolobit-micropython', generation: generateForDocument(document, registry, productionProfiles, packs) });
  });

  it('has no code for a generic project, and generateForDocument still has no Python for a uno one', () => {
    expect(generateCodeForDocument(createNewProject('g'), rules)).toBeNull();
    expect(generateForDocument(robot([]), registry, productionProfiles, packs)).toBeNull();
  });

  it('says which layer stopped a uno document: an unknown kit (L-1), no board and a program that does not compile (L-3)', () => {
    expect(generateCodeForDocument(robot([], { kit: { id: 'nope', version: '9' } }), rules)).toEqual({
      codeTarget: 'arduino-avr',
      generation: { ok: false, layer: 'L-1', diagnostics: [{ layer: 'L-1', severity: 'error', code: 'unknown-kit', message: 'The robot kit "nope@9" is not one this app knows.' }] },
    });
    const boardless = generateCodeForDocument(robot([], { circuit: { components: [], wires: [] } }), rules);
    expect(boardless).toMatchObject({ codeTarget: 'arduino-avr', generation: { ok: false, layer: 'L-3', diagnostics: [{ code: 'no-board' }] } });
    const broken = generateCodeForDocument(robot([print(num(2 ** 40))]), rules);
    expect(broken).toEqual({
      codeTarget: 'arduino-avr',
      generation: { ok: false, layer: 'L-3', diagnostics: [expect.objectContaining({ severity: 'error', code: 'value-out-of-range', message: 'A number must be between -2147483648 and 2147483647.' })] },
    });
  });
});
