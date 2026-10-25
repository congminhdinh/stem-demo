import { describe, expect, it } from 'vitest';
import { productionKits } from '../hardware';
import { productionProfiles } from '../profiles';
import { unoDocument } from '../profiles/__fixtures__/uno-document';
import { compileUnoProject } from './compile-uno-program';
import { compileYbcProgram } from './compile-ybc-program';
import { packs, registry } from './__fixtures__/uno-blocks';
import { getVar, num, print, program, setVar, type Json } from './__fixtures__/ybc-blocks';

// N18 R6.2 fix round 1 (controller ruling): in the uno family a program's variables have different names. A sketch has one variable of a
// name, and a check's programHash names the variables by their names (scenario/program-hash.ts), so two Blockly variables that share a name
// would be two programs with one identity. The second of a name is an error; the Yolo:Bit family (ybc) is unchanged.

/** A workspace that sets and prints the variables of `ids`, declared as `variables` ({ name, id }). */
function workspaceOf(variables: { name: string; id: string }[]): Json {
  const statements = variables.flatMap(({ id }, index) => [setVar(id, num(index + 1)), print(getVar(id))]);
  return { ...program(statements, undefined, []), variables };
}

const compileUno = (variables: { name: string; id: string }[]) =>
  compileUnoProject(unoDocument('uno-basic', { program: { blocks: workspaceOf(variables) } }), { registry, profiles: productionProfiles, packs, kits: productionKits });

describe('the variables of a uno program', () => {
  it('compile when their names differ, a difference of case included (C++ tells x from X)', () => {
    const result = compileUno([{ name: 'x', id: 'a' }, { name: 'X', id: 'b' }, { name: 'speed', id: 'c' }]);
    expect(result.ok && result.ir.variables.map((variable) => variable.name)).toEqual(['x', 'X', 'speed']);
  });

  it('refuse a second variable of a name, with an error naming it; the first of the name is fine', () => {
    const result = compileUno([{ name: 'x', id: 'a' }, { name: 'y', id: 'b' }, { name: 'x', id: 'c' }, { name: 'y', id: 'd' }, { name: 'x', id: 'e' }]);
    expect(result).toEqual({
      ok: false,
      reason: 'compile',
      diagnostics: [
        { severity: 'error', code: 'duplicate-variable', message: 'Two variables are named "x": rename one of them (a sketch has one variable of a name).' },
        { severity: 'error', code: 'duplicate-variable', message: 'Two variables are named "y": rename one of them (a sketch has one variable of a name).' },
        { severity: 'error', code: 'duplicate-variable', message: 'Two variables are named "x": rename one of them (a sketch has one variable of a name).' },
      ],
    });
  });

  it('a Yolo:Bit program (ybc family) keeps compiling with two variables of a name, as before', () => {
    const exposed = new Set(['stem_on_start', 'stem_forever', 'variables_set', 'variables_get', 'math_number', 'text_print']);
    const result = compileYbcProgram(workspaceOf([{ name: 'x', id: 'a' }, { name: 'x', id: 'b' }]), exposed);
    expect(result.ok && result.ir.variables).toEqual([{ id: 'a', name: 'x', type: 'int' }, { id: 'b', name: 'x', type: 'int' }]);
  });
});
