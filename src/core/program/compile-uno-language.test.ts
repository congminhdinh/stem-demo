import { describe, expect, it } from 'vitest';
import { unoContract } from '../compat/uno-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { add, cmp, countUp, getVar, num, print, program, repeat, setVar, text, wait, whileLoop, bool, type Json } from './__fixtures__/ybc-blocks';
import { compileUno } from './__fixtures__/uno-language';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { INT32_COUNT_UP_MAX_END, INT32_MAX, INT32_MIN } from './limits';
import { loopPauseUsOf, numericOf, YBC_LOOP_PAUSE_US } from './ybc-ir';

// N18 R2.3: the compiler writes the numeric model and the loop pause of the board family into the IR (robot plan §4.4), and checks
// the typed-in values of the uno family against the domains of contract UNO §3. The uno block packs are R2.2's: these tests expose
// only the language blocks they use (__fixtures__/uno-language.ts).

const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'i']);
const ybcExposed = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions)).typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const errorsOf = (result: ReturnType<typeof compileUno>) => result.diagnostics.filter((d) => d.severity === 'error').map(({ code, message }) => ({ code, message }));

describe('the IR of a board family', () => {
  it('writes cxx-int32 and no loop pause for the uno family', () => {
    const result = compileUno(prog([print(add(num(1), num(2)))], [wait(num(10))]));
    expect(result.ok).toBe(true);
    expect(result.ok && { numeric: result.ir.numeric, loopPauseUs: result.ir.loopPauseUs }).toEqual({ numeric: 'cxx-int32', loopPauseUs: 0 });
    expect(result.ok && JSON.parse(JSON.stringify(result.ir))).toEqual(result.ok && result.ir);
  });

  it('leaves a ybc IR as it has been since YB-2, which means python and a 10 000 µs pause', () => {
    const result = compileYbcProgram(prog([print(add(num(1), num(2)))], []), ybcExposed);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(Object.keys(result.ir)).toEqual(['onStart', 'forever', 'variables']);
    expect([numericOf(result.ir), loopPauseUsOf(result.ir), YBC_LOOP_PAUSE_US]).toEqual(['python', 10_000, 10_000]);
    expect(compileYbcProgram(prog([]), ybcExposed, undefined, undefined, 'ybc')).toEqual(compileYbcProgram(prog([]), ybcExposed));
  });

  it('compiles the same language to the same statements for both families: only the model, the pause and (N18 R2.4) the name of the forever hat differ', () => {
    const blocks = prog([countUp('i', num(1), num(3), 1, [print(getVar('i'))]), repeat(num(2), [setVar('x', add(getVar('x'), num(1)))])], [wait(num(5))]);
    const uno = compileUno(blocks);
    const ybc = compileYbcProgram(blocks, ybcExposed);
    expect(uno.ok && ybc.ok).toBe(true);
    if (uno.ok && ybc.ok) {
      const { numeric, loopPauseUs, foreverBlockId, ...rest } = uno.ir;
      expect([numeric, loopPauseUs, foreverBlockId]).toEqual(['cxx-int32', 0, 'forever']);
      expect(rest).toEqual(ybc.ir);
    }
  });
});

describe('the domains of the uno family (contract UNO §3)', () => {
  it('takes a literal of the whole int32 range and refuses one beyond it (U-04)', () => {
    for (const value of [INT32_MIN, -1, 0, INT32_MAX]) {
      expect(compileUno(prog([print(num(value))])).ok, String(value)).toBe(true);
    }
    for (const value of [INT32_MAX + 1, INT32_MIN - 1, 2 ** 40]) {
      expect(errorsOf(compileUno(prog([print(num(value))])))).toEqual([
        { code: 'value-out-of-range', message: 'A number must be between -2147483648 and 2147483647.' },
      ]);
    }
    // Python's ints are not 32 bits: the same literal is fine on Yolo:Bit.
    expect(compileYbcProgram(prog([print(num(INT32_MAX + 1))]), ybcExposed).ok).toBe(true);
  });

  it('takes any int32 count for repeat: N <= 0 runs none, there is no other limit (U-12)', () => {
    for (const value of [INT32_MIN, -5, 0, 1_000_001, INT32_MAX]) {
      expect(compileUno(prog([repeat(num(value), [])])).ok, String(value)).toBe(true);
    }
    expect(compileYbcProgram(prog([repeat(num(1_000_001), [])]), ybcExposed).ok).toBe(false);
  });

  it('counts up from any int32, to 2147483646 at most, by 1, and refuses a typed-in descending range (U-14)', () => {
    expect(INT32_COUNT_UP_MAX_END).toBe(unoContract.constants.COUNT_UP_MAX_END);
    expect(compileUno(prog([countUp('i', num(INT32_MIN), num(INT32_COUNT_UP_MAX_END), 1, [])])).ok).toBe(true);
    expect(compileUno(prog([countUp('i', num(-5), num(-1), 1, [])])).ok).toBe(true);
    expect(errorsOf(compileUno(prog([countUp('i', num(0), num(INT32_MAX), 1, [])])))).toEqual([
      { code: 'value-out-of-range', message: 'The end must be between -2147483648 and 2147483646.' },
    ]);
    expect(errorsOf(compileUno(prog([countUp('i', num(5), num(1), 1, [])])))).toEqual([
      { code: 'descending-range-not-supported', message: '"count up" cannot count down; use "repeat" and a variable.' },
    ]);
    expect(errorsOf(compileUno(prog([countUp('i', num(0), num(10), 2, [])])))).toEqual([
      { code: 'value-out-of-range', message: '"count up" counts by 1 on this board.' },
    ]);
  });

  it('keeps the wait domain 0..60000 ms (U-18)', () => {
    expect(compileUno(prog([wait(num(60_000))])).ok).toBe(true);
    expect(errorsOf(compileUno(prog([wait(num(60_001))])))).toEqual([{ code: 'value-out-of-range', message: 'A wait must be between 0 and 60000.' }]);
  });

  it('prints text but never compares it: a text is only printed on the UNO (contract UNO §3.1)', () => {
    expect(compileUno(prog([print(text('Xin chào'))])).ok).toBe(true);
    expect(compileUno(prog([whileLoop(cmp('EQ', bool(true), bool(false)), [])])).ok).toBe(true);
    expect(errorsOf(compileUno(prog([whileLoop(cmp('EQ', text('a'), text('b')), [])])))).toEqual([
      { code: 'type-mismatch', message: '"==" compares numbers or true / false values here; a text can only be printed.' },
    ]);
    expect(compileYbcProgram(prog([whileLoop(cmp('EQ', text('a'), text('b')), [])]), ybcExposed).ok).toBe(true);
  });
});
