import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { GenDiagnosticCode } from '../codegen/yolobit/generate';
import type { LayerDiagnostic } from '../profiles/validity';
import type { YbcDiagnosticCode } from '../program/compile-ybc-program';
import { createRunConsole } from '../program/console';
import { add, idiv, num, print, program, repeat, setVar, text, getVar, join } from '../program/__fixtures__/ybc-blocks';
import { compileYbcProgram } from '../program/compile-ybc-program';
import { createBlockPackCatalog } from '../program/block-packs';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { runYbc } from '../program/__fixtures__/run-ybc';
import type { RuntimeFault } from '../program/values';
import type { StartFailureReason } from '../run/run-session';
import {
  boardContextDiagnosticCodes, compileDiagnosticCodes, diagnosticCodesByOrigin, generatorDiagnosticCodes, plannedCompileDiagnosticCodes,
  runtimeDiagnosticCodes, ybc2CompileDiagnosticCodes,
  type BoardContextDiagnosticCode, type CompileDiagnosticCode, type Diagnostic, type DiagnosticCode, type GeneratorDiagnosticCode,
  type RuntimeDiagnosticCode, type RuntimeError,
} from './index';

// YB-CP deliverable 5: one registry of diagnostic codes, tied to the code that emits them and to the plan.

const plan = readFileSync(new URL('../../../docs/yolobit-compatible-board-implementation-plan.md', import.meta.url), 'utf8');

/** The backticked codes of the §9.4 line that starts with `label` ("- compile:", "- runtime:", "- board context:"). */
function planCodes(label: string): string[] {
  const line = plan.split(/\r?\n/).find((candidate) => candidate.trimStart().startsWith(`- ${label}:`));
  if (!line) {
    throw new Error(`The plan has no "${label}" diagnostic list`);
  }
  return [...line.matchAll(/`([a-z-]+)`/g)].map((match) => match[1] as string);
}

describe('the registry against the plan (§9.4)', () => {
  it('lists exactly the compile, runtime and board-context codes of the plan', () => {
    expect([...plannedCompileDiagnosticCodes].sort()).toEqual(planCodes('compile').sort());
    expect([...runtimeDiagnosticCodes].sort()).toEqual(planCodes('runtime').sort());
    expect([...boardContextDiagnosticCodes].sort()).toEqual(planCodes('board context').sort());
  });

  it('has no code twice inside a list, and names the YB-2 additions apart from the planned ones', () => {
    for (const list of [compileDiagnosticCodes, runtimeDiagnosticCodes, boardContextDiagnosticCodes, generatorDiagnosticCodes]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(plannedCompileDiagnosticCodes.filter((code) => (ybc2CompileDiagnosticCodes as readonly string[]).includes(code))).toEqual([]);
  });

  it('files every code under the origin that emits it', () => {
    expect(diagnosticCodesByOrigin.compile).toBe(compileDiagnosticCodes);
    expect(diagnosticCodesByOrigin.runtime).toBe(runtimeDiagnosticCodes);
    expect(diagnosticCodesByOrigin['board-context']).toBe(boardContextDiagnosticCodes);
    expect(diagnosticCodesByOrigin.generator).toBe(generatorDiagnosticCodes);
  });
});

describe('the registry against the code that emits the diagnostics (types tie them, so a new code cannot slip in)', () => {
  it('covers every code the YBC compiler can report', () => {
    expectTypeOf<YbcDiagnosticCode>().toExtend<CompileDiagnosticCode>();
  });

  it('is exactly the fault codes of the YBC interpreter', () => {
    expectTypeOf<RuntimeFault['code']>().toEqualTypeOf<RuntimeDiagnosticCode>();
  });

  it('is exactly the codes of the Python generator', () => {
    expectTypeOf<GenDiagnosticCode>().toEqualTypeOf<GeneratorDiagnosticCode>();
  });

  it('covers the validity layers and the reasons a run does not start', () => {
    expectTypeOf<LayerDiagnostic['code']>().toExtend<BoardContextDiagnosticCode | CompileDiagnosticCode>();
    expectTypeOf<Exclude<StartFailureReason, 'compile-error'>>().toExtend<BoardContextDiagnosticCode>();
  });

  it('has a diagnostic shape that fits every code, and an error shape that carries only runtime codes', () => {
    const board: Diagnostic = { severity: 'error', code: 'incompatible-devices', message: 'x', componentIds: ['a'] };
    const compile: Diagnostic = { severity: 'warning', code: 'ignored-block', message: 'x', blockId: 'b' };
    const error: RuntimeError = { message: 'Division by zero.', blockId: 'b', code: 'zero-division' };
    expect([board.code, compile.code, error.code]).toEqual(['incompatible-devices', 'ignored-block', 'zero-division']);
    expectTypeOf<RuntimeError['code']>().toEqualTypeOf<RuntimeDiagnosticCode | undefined>();
    expectTypeOf<DiagnosticCode>().toExtend<string>();
  });
});

describe('real faults and diagnostics carry registered codes', () => {
  const registry = createDeviceRegistry(localDeviceDefinitions);
  const packs = createBlockPackCatalog(registry);
  const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

  const faultOf = async (blocks: unknown) => {
    const compiled = compileYbcProgram(blocks, exposed);
    if (!compiled.ok) {
      throw new Error(JSON.stringify(compiled.diagnostics));
    }
    const outcome = await runYbc(compiled.ir, { sleep: async () => {}, console: createRunConsole() }).done;
    return outcome.status === 'error' ? outcome : null;
  };

  it('reports zero-division, out-of-domain and limit-exceeded with the block, in the shape of RuntimeError', async () => {
    const division = await faultOf(program([print(idiv(num(1), num(0)))]));
    const overflow = await faultOf(program([setVar('x', num(Number.MAX_SAFE_INTEGER)), print(add(getVar('x'), num(1)))]));
    const tooMuchText = await faultOf(program([print(join(text('a'.repeat(600)), text('b'.repeat(600))))]));
    const badRepeat = await faultOf(program([setVar('x', num(1_000_001)), repeat(getVar('x'), [])]));
    for (const [fault, code] of [[division, 'zero-division'], [overflow, 'out-of-domain'], [tooMuchText, 'limit-exceeded'], [badRepeat, 'out-of-domain']] as const) {
      expect(fault?.code).toBe(code);
      expect(runtimeDiagnosticCodes).toContain(fault?.code);
      const error: RuntimeError = { message: fault?.message ?? '', ...(fault?.blockId ? { blockId: fault.blockId } : {}), code: fault?.code ?? 'internal-error' };
      expect(error.blockId).toEqual(expect.any(String));
    }
  });

  it('reports compile problems with registered codes and the block', () => {
    const compiled = compileYbcProgram(program([setVar('x', text('hi'))]), exposed);
    expect(compiled.ok).toBe(false);
    for (const diagnostic of compiled.diagnostics) {
      expect(compileDiagnosticCodes).toContain(diagnostic.code);
      expect(diagnostic.blockId).toEqual(expect.any(String));
    }
  });
});
