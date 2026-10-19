import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { createBlockPackCatalog } from '../program/block-packs';
import { compileYbcProgram } from '../program/compile-ybc-program';
import { createRunConsole } from '../program/console';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_WAIT_MS } from '../program/limits';
import { add, countUp, num, program, repeat, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { runYbc } from '../program/__fixtures__/run-ybc';
import { evaluatePred } from './contract-validation';
import { yolobitContract } from './yolobit-contract';
// YB-3: the onboard hardware.
import type { Frame } from '../capabilities/frame';
import type { Capabilities } from '../capabilities/io';
import { DISPLAY_CHAR_FROM, DISPLAY_CHAR_TO, IMAGE_SIZE, isDisplayText } from '../constructs/ybc.display';
import { buttonNames, isButtonName } from '../constructs/ybc.input';
import { noteNames, noteTicks, PITCH_MAX_HZ, PITCH_MAX_MS, PITCH_MIN_HZ } from '../constructs/ybc.sound';
import { buttonPressed, buttonPresses, playNote, playPitch, rest, scrollText, text } from '../program/__fixtures__/ybc-blocks';
import type { Expr, YbcProgramIR, YbcStatement } from '../program/ybc-ir';
import type { Pred } from './contract-types';

// The limits of the loops and of wait are named constants in limits.ts (the compiler and the interpreter
// use them), and the contract holds the same limits as predicates (section 21, invariant 10). A contract
// edit must not make them drift apart silently: these tests run the real compiler and interpreter at the
// boundary values the predicates name, and require the same verdict.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const prog = (statements: Json[]) => program(statements, undefined, ['x', 'y', 'z', 'i']);
const row = (id: string) => {
  const found = yolobitContract.constructs.find((construct) => construct.id === id);
  if (!found?.domain) {
    throw new Error(`No domain for ${id}`);
  }
  return found.domain;
};

/** Whether the contract's predicate allows `values`, at run time (the arguments as evaluated). */
const runtimeAllows = (id: string, values: Record<string, number>) => evaluatePred(row(id).runtime, { values });

/** What the compiler says about typed-in numbers: true when it accepts them. */
const compiles = (statement: Json) => compileYbcProgram(prog([statement]), exposed).ok;

/** What the interpreter says about computed numbers (a literal plus 0 is computed): true when it ran without a domain fault. */
async function runs(statement: Json) {
  const compiled = compileYbcProgram(prog([statement]), exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const outcome = await runYbc(compiled.ir, {
    sleep: () => Promise.resolve(),
    console: createRunConsole(),
    yieldNow: () => Promise.resolve(),
  }).done;
  return outcome.status === 'finished';
}
const computed = (value: number) => add(num(value), num(0));

describe('the constants are the contract constants', () => {
  it('has the same repeat and range limits', () => {
    expect(MAX_REPEAT_ABS).toBe(yolobitContract.constants.MAX_REPEAT_ABS);
    expect(MAX_RANGE_VALUE).toBe(yolobitContract.constants.MAX_RANGE_VALUE);
  });
});

describe('wait (C-04): compiler and interpreter agree with the contract predicate', () => {
  const values = [-1, 0, 1, MAX_WAIT_MS - 1, MAX_WAIT_MS, MAX_WAIT_MS + 1];

  it('pins the limit: the predicate allows exactly 0..60000', () => {
    expect(values.filter((ms) => runtimeAllows('C-04', { ms }))).toEqual([0, 1, MAX_WAIT_MS - 1, MAX_WAIT_MS]);
  });

  it.each(values)('%d ms', async (ms) => {
    const allowed = runtimeAllows('C-04', { ms });
    expect(compiles(wait(num(ms)))).toBe(allowed);
    expect(await runs(wait(computed(ms)))).toBe(allowed);
  });
});

describe('repeat (C-37): compiler and interpreter agree with the contract predicate', () => {
  const values = [-MAX_REPEAT_ABS - 1, -MAX_REPEAT_ABS, -1, 0, 1, MAX_REPEAT_ABS, MAX_REPEAT_ABS + 1];

  it.each(values)('%d times', async (n) => {
    const allowed = runtimeAllows('C-37', { n });
    expect(compiles(repeat(num(n), []))).toBe(allowed);
    // Only a count the contract allows is run in full: the bodies are empty, so the large ones are quick.
    if (allowed) {
      expect(await runs(repeat(computed(n), []))).toBe(true);
    } else {
      expect(await runs(repeat(computed(n), []))).toBe(false);
    }
  });
});

describe('count up (C-39): compiler and interpreter agree with the contract predicate', () => {
  const bounds = [-1, 0, 1, MAX_RANGE_VALUE - 1, MAX_RANGE_VALUE, MAX_RANGE_VALUE + 1];

  it.each(bounds)('start %d', async (start) => {
    // A typed-in start above the end is refused for another reason; the end 1 000 000 avoids that.
    const end = MAX_RANGE_VALUE;
    const inDomain = runtimeAllows('C-39', { start, end });
    expect(compiles(countUp('i', num(start), num(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
    expect(await runs(countUp('i', computed(start), computed(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
  });

  it.each(bounds)('end %d', async (end) => {
    const start = 0;
    const inDomain = runtimeAllows('C-39', { start, end });
    expect(compiles(countUp('i', num(start), num(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
    expect(await runs(countUp('i', computed(start), computed(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
  });

  it('keeps the step a typed-in number in 1..MAX_RANGE_VALUE: the contract requires a literal', () => {
    const rules = row('C-39').compileTime;
    expect(rules.some((rule) => 'literal' in rule.when && rule.diagnostic === 'literal-required')).toBe(true);
    for (const step of [0, 1, MAX_RANGE_VALUE, MAX_RANGE_VALUE + 1]) {
      const allowed = rules
        .filter((rule) => rule.diagnostic === 'value-out-of-range' && JSON.stringify(rule.when).includes('"step"'))
        .every((rule) => evaluatePred(rule.when, { values: { step }, literals: new Set(['step']) }));
      expect(compiles(countUp('i', num(1), num(5), step, [])), `step ${step}`).toBe(allowed);
    }
  });

  it('evaluates the start before the end, each once: the contract order is the interpreter order', () => {
    expect(row('C-39').evaluation).toEqual({
      order: ['start', 'end'],
      once: true,
      checkEach: 'after-own-evaluation',
      temporaries: 'unless-all-literal',
    });
  });
});

// --- YB-3: the onboard hardware ---------------------------------------------------------------------------
// The same discipline for the rows the display, the buttons and the sound add. The predicates of the contract are the
// truth; the compiler (typed-in values, as Blockly saves them), the interpreter (values the program computed, here
// handed over in forged IR, which the compiler would have refused) and the constants of the constructs must all give
// the verdict of the predicate.

/** The values of the `oneOf` rule on `arg` in the runtime predicate of a row. */
function oneOfValues(id: string, arg: string): readonly (number | string)[] {
  const search = (pred: Pred): readonly (number | string)[] | undefined => {
    if ('oneOf' in pred) {
      return pred.oneOf.arg === arg ? pred.oneOf.values : undefined;
    }
    if ('all' in pred) {
      return pred.all.map(search).find((values) => values !== undefined);
    }
    return undefined;
  };
  const values = search(row(id).runtime);
  if (!values) {
    throw new Error(`No oneOf rule for ${arg} in ${id}`);
  }
  return values;
}

/** Whether every rule the compiler applies to typed-in values allows them: the verdict of the row for a literal. */
const compileTimeAllows = (id: string, values: Record<string, number | string>) =>
  row(id).compileTime.every((rule) => evaluatePred(rule.when, { values }));

/** Runs forged IR (a statement a compiler would not have produced) against fake parts, and tells what the parts were asked. */
async function runForged(statement: YbcStatement, extra: Partial<Capabilities> = {}) {
  const frames: Frame[] = [];
  const tones: number[] = [];
  const sleeps: number[] = [];
  const capabilities: Capabilities = {
    display: { setFrame: (frame) => void frames.push(frame) },
    sound: { startTone: (hz) => void tones.push(hz), stopTone: () => undefined },
    buttons: { isPressed: () => true, takePresses: () => 0 },
    ...extra,
  };
  const ir: YbcProgramIR = { onStart: [statement], forever: null, variables: [] };
  const sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  const outcome = await runYbc(ir, { sleep, console: createRunConsole(), yieldNow: () => Promise.resolve() }, capabilities).done;
  return { outcome, frames, tones, sleeps };
}

const where = { blockId: 'forged' };
const strExpr = (value: string): Expr => ({ ...where, kind: 'str', type: 'str', value });
/** A text the program computes: a join, so the compiler could not have looked at its characters. */
const dynamicText = (value: string): Expr => ({ ...where, kind: 'join', type: 'str', parts: [strExpr(value)] });

describe('the constants of the hardware constructs are the contract constants', () => {
  it('has the display charset of the contract: ASCII 0x20 to 0x7E', () => {
    expect(DISPLAY_CHAR_FROM).toBe(yolobitContract.constants.DISPLAY_CHARSET.from);
    expect(DISPLAY_CHAR_TO).toBe(yolobitContract.constants.DISPLAY_CHARSET.to);
    const rule = row('C-07').runtime;
    expect('ascii' in rule && rule.ascii).toMatchObject({ arg: 'text', from: DISPLAY_CHAR_FROM, to: DISPLAY_CHAR_TO });
  });

  it('has the 5 x 5 display of the contract', () => {
    expect(IMAGE_SIZE).toBe(yolobitContract.display.width);
    expect(IMAGE_SIZE).toBe(yolobitContract.display.height);
  });

  it('offers the buttons, the notes and the lengths that the predicates list, in the same order', () => {
    expect([...buttonNames]).toEqual(oneOfValues('C-12', 'button'));
    expect([...buttonNames]).toEqual(oneOfValues('C-13', 'button'));
    expect([...noteNames]).toEqual(oneOfValues('C-50', 'note'));
    expect([...noteTicks]).toEqual(oneOfValues('C-50', 'ticks'));
    expect([...noteTicks]).toEqual(oneOfValues('C-51', 'ticks'));
  });

  it('applies to a typed-in value the very predicate it applies to a computed one', () => {
    const conjuncts = (pred: Pred): readonly Pred[] => ('all' in pred ? pred.all : [pred]);
    for (const id of ['C-07', 'C-12', 'C-13', 'C-50', 'C-51']) {
      expect(row(id).compileTime.map((rule) => rule.when), id).toEqual(conjuncts(row(id).runtime));
    }
  });
});

describe('display text (C-07): compiler and interpreter agree with the contract predicate', () => {
  // The edges of the charset and a few beyond: the control character below it, space, ~, DEL, a C1 control, Latin-1, an emoji.
  const codes = [0x00, 0x09, 0x1f, 0x20, 0x21, 0x41, 0x7d, 0x7e, 0x7f, 0x80, 0xa0, 0xe9, 0x1f600];
  const characterOf = (code: number) => String.fromCodePoint(code);
  const hex = (code: number) => `0x${code.toString(16)}`;

  it('pins the charset: the predicate allows exactly 0x20 to 0x7E among those characters', () => {
    expect(codes.filter((code) => evaluatePred(row('C-07').runtime, { values: { text: characterOf(code) } }))).toEqual([0x20, 0x21, 0x41, 0x7d, 0x7e]);
  });

  it.each(codes.map((code) => [hex(code), code] as const))('the character %s', async (_name, code) => {
    const character = characterOf(code);
    const allowed = evaluatePred(row('C-07').runtime, { values: { text: character } });

    // The helper of the construct is the predicate.
    expect(isDisplayText(character)).toBe(allowed);
    expect(isDisplayText(`a${character}b`)).toBe(allowed);
    expect(compileTimeAllows('C-07', { text: character })).toBe(allowed);

    // Typed in: the compiler refuses what the predicate refuses, and nothing else.
    expect(compiles(scrollText(text(character)))).toBe(allowed);
    expect(compiles(scrollText(text(`a${character}b`)))).toBe(allowed);

    // Computed: the interpreter refuses it as out-of-domain, before any light is lit.
    for (const value of [character, `a${character}`]) {
      const { outcome, frames } = await runForged({ ...where, kind: 'call', op: 'display.scrollText', args: [dynamicText(value)] });
      if (allowed) {
        expect(outcome, `${hex(code)} in ${JSON.stringify(value)}`).toEqual({ status: 'finished' });
        expect(frames.length, `${hex(code)} in ${JSON.stringify(value)}`).toBeGreaterThan(0);
      } else {
        expect(outcome, `${hex(code)} in ${JSON.stringify(value)}`).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: 'forged' });
        expect(frames, `${hex(code)} in ${JSON.stringify(value)}`).toEqual([]);
      }
    }
  });

  it('names display-char-unsupported for a typed-in character outside ASCII that is not a control character, as the contract does', () => {
    expect(row('C-07').compileTime.map((rule) => rule.diagnostic)).toEqual(['display-char-unsupported']);
    for (const value of ['é', 'café', '€', '😀']) {
      const result = compileYbcProgram(prog([scrollText(text(value))]), exposed);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code), value).toEqual(['display-char-unsupported']);
    }
  });

  it('shows a number as str(n): ASCII digits and a minus sign, always inside the charset', async () => {
    for (const value of [0, 7, -7, 42, -2_147_483_648, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(isDisplayText(String(value)), String(value)).toBe(true);
      const { outcome } = await runForged({ ...where, kind: 'call', op: 'display.scrollNumber', args: [{ ...where, kind: 'int', type: 'int', value }] });
      expect(outcome, String(value)).toEqual({ status: 'finished' });
    }
  });
});

describe('buttons (C-12, C-13): compiler and interpreter agree with the contract predicate', () => {
  const buttons = ['A', 'B', 'AB', 'A+B', 'C', 'a', 'b', '', ' A', 'B ', 'AA', '0'];

  it('pins the domain: the predicate allows exactly A and B', () => {
    for (const id of ['C-12', 'C-13']) {
      expect(buttons.filter((button) => evaluatePred(row(id).runtime, { values: { button } })), id).toEqual(['A', 'B']);
    }
  });

  it.each(buttons)('the button %j', async (button) => {
    for (const [id, make, op] of [['C-12', buttonPressed, 'button.isPressed'], ['C-13', buttonPresses, 'button.getPresses']] as const) {
      const allowed = evaluatePred(row(id).runtime, { values: { button } });
      expect(isButtonName(button), id).toBe(allowed);
      expect(compileTimeAllows(id, { button }), id).toBe(allowed);

      // Typed in: the field of the block, as Blockly would save the text of an option.
      expect(compiles({ type: 'text_print', id: 'p', inputs: { TEXT: { block: { ...make('A'), fields: { BUTTON: button } } } } }), `${id} ${JSON.stringify(button)}`).toBe(allowed);

      // The interpreter's own check on the IR it is given: it reads only A and B.
      const read = { ...where, kind: 'read', op, type: op === 'button.isPressed' ? 'bool' : 'int', operand: { kind: 'button', button } } as unknown as Expr;
      const { outcome } = await runForged({ ...where, kind: 'print', value: read });
      expect(outcome.status === 'finished', `${id} ${JSON.stringify(button)}`).toBe(allowed);
    }
  });
});

describe('notes (C-50): compiler and interpreter agree with the contract predicate on every combination', () => {
  const notes = [...noteNames, 'C2', 'C6', 'B#3', 'DB4', 'C#4', 'E9', 'c4', 'R', ''];
  const lengths = [-1, 0, 1, 2, 3, 4, 8, 16];

  it('pins the domain: the predicate allows exactly the 15 notes with 1, 2 or 4 ticks', () => {
    const allowed = notes.flatMap((note) => lengths.filter((ticks) => evaluatePred(row('C-50').runtime, { values: { note, ticks } })).map((ticks) => `${note}:${ticks}`));
    expect(allowed).toEqual(noteNames.flatMap((note) => noteTicks.map((ticks) => `${note}:${ticks}`)));
    expect(allowed).toHaveLength(45);
  });

  it('gives the verdict of the predicate for every combination of the notes and lengths above', async () => {
    let checked = 0;
    for (const note of notes) {
      for (const ticks of lengths) {
        const allowed = evaluatePred(row('C-50').runtime, { values: { note, ticks } });
        const label = `${JSON.stringify(note)} for ${ticks}`;
        expect(compileTimeAllows('C-50', { note, ticks }), label).toBe(allowed);

        // Typed in: Blockly saves the length as the text of its option.
        const literal = { ...playNote('C4', 4), fields: { NOTE: note, TICKS: String(ticks) } };
        const compiled = compileYbcProgram(prog([literal]), exposed);
        expect(compiled.ok, label).toBe(allowed);
        if (!allowed) {
          const named = new Set<string>(row('C-50').compileTime.map((rule) => rule.diagnostic));
          expect(compiled.diagnostics.every((diagnostic) => named.has(diagnostic.code)), label).toBe(true);
        }

        // Computed: the interpreter plays what the predicate allows, for as long as the length says, and nothing else.
        const forged = { ...where, kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note, ticks } } as unknown as YbcStatement;
        const { outcome, tones, sleeps } = await runForged(forged);
        expect(outcome.status === 'finished', label).toBe(allowed);
        expect(tones.length, label).toBe(allowed ? 1 : 0);
        expect(sleeps, label).toEqual(allowed ? [ticks * 125] : []);
        checked += 1;
      }
    }
    expect(checked).toBe(notes.length * lengths.length);
  });
});

describe('rests (C-51): compiler and interpreter agree with the contract predicate', () => {
  const lengths = [-1, 0, 1, 2, 3, 4, 8, 16];

  it('pins the domain: the predicate allows exactly 1, 2 and 4 ticks', () => {
    expect(lengths.filter((ticks) => evaluatePred(row('C-51').runtime, { values: { ticks } }))).toEqual([1, 2, 4]);
  });

  it.each(lengths)('%d ticks', async (ticks) => {
    const allowed = evaluatePred(row('C-51').runtime, { values: { ticks } });
    expect(compileTimeAllows('C-51', { ticks })).toBe(allowed);
    expect(compiles({ ...rest(1), fields: { TICKS: String(ticks) } })).toBe(allowed);

    const forged = { ...where, kind: 'call', op: 'sound.rest', operand: { kind: 'rest', ticks } } as unknown as YbcStatement;
    const { outcome, tones, sleeps } = await runForged(forged);
    expect(outcome.status === 'finished').toBe(allowed);
    expect(tones).toEqual([]);
    expect(sleeps).toEqual(allowed ? [ticks * 125] : []);
  });
});

describe('a tone (C-21, N17 B3): compiler and interpreter agree with the contract predicate', () => {
  const advanced = packs.typesOf(productionProfiles.get('ybc-advanced')?.blockPacks ?? []);
  // A buzzer that hears everything and a scheduler that keeps nothing: the tone itself is the session tests' (run-session.music).
  const silent: Capabilities = { sound: { startTone: () => undefined, stopTone: () => undefined } };
  const noTimers = { schedule: () => () => undefined, dispose: () => undefined, disposed: false };
  const compilesTone = (hz: number, ms: number) => compileYbcProgram(prog([playPitch(num(hz), num(ms))]), advanced).ok;
  async function runsTone(hz: number, ms: number) {
    const compiled = compileYbcProgram(prog([playPitch(add(num(hz), num(0)), add(num(ms), num(0)))]), advanced);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    const outcome = await runYbc(
      compiled.ir,
      { sleep: () => Promise.resolve(), console: createRunConsole(), yieldNow: () => Promise.resolve(), scheduler: noTimers },
      silent,
    ).done;
    return outcome.status === 'finished';
  }
  const hzValues = [19, 20, 21, 19_999, 20_000, 20_001];
  const msValues = [-1, 0, 1, 59_999, 60_000, 60_001];

  it('pins the limits: 20..20000 Hz and 0..60000 ms', () => {
    expect(hzValues.filter((hz) => evaluatePred(row('C-21').runtime, { values: { hz, ms: 100 } }))).toEqual([20, 21, 19_999, 20_000]);
    expect(msValues.filter((ms) => evaluatePred(row('C-21').runtime, { values: { hz: 440, ms } }))).toEqual([0, 1, 59_999, 60_000]);
    expect([PITCH_MIN_HZ, PITCH_MAX_HZ, PITCH_MAX_MS]).toEqual([20, 20_000, 60_000]);
  });

  it.each([...hzValues.map((hz) => [hz, 100] as const), ...msValues.map((ms) => [440, ms] as const)])('%d Hz for %d ms', async (hz, ms) => {
    const allowed = evaluatePred(row('C-21').runtime, { values: { hz, ms } });
    expect(compilesTone(hz, ms)).toBe(allowed);
    expect(await runsTone(hz, ms)).toBe(allowed);
  });
});
